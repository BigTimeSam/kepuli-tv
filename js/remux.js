// @ts-check
// Playing MKV through MediaSource.
//
// Chrome will not take Matroska, but the H.264 or HEVC inside it is fine as
// it is. The file is read from the network as a stream, the clusters are
// demuxed (mkv.js) and the frames repackaged into fMP4 segments (mp4.js).
// The picture is neither decoded nor encoded — only the container changes,
// so the work is light.
//
// The constraints that shape the design:
//
// - The account allows one concurrent connection, so there is always
//   exactly one download open. Seeking cuts it and opens a new one.
// - The server does not expose content-range to JS, so the file size is
//   fetched separately with a Range-free request that is cut off right
//   after the headers.
// - In the measured files Cues sits at the end of the file (at the 366 MB
//   mark, for instance), so the seek table is fetched with its own request
//   and only when needed.

import { parseHeader, ID, Reader } from './ebml.js';
import { t } from './i18n.js';
import { BufferedBytes, frames } from './mkv.js';
import { initSegment, mediaSegment, decodeTimes, durations, VIDEO_TIMESCALE } from './mp4.js';
import { emptyAnswer, refusedByFileServer, videoMime } from './probe.js';
import { describeAll, passthroughMime, preferred as preferredAudio } from './audio.js';
import { AudioTranscoder, encoderSetup, RATE as DECODED_RATE, CHANNELS as DECODED_CHANNELS } from './transcode.js';
import { SubtitleTracks, isSubtitle, isTextSubtitle, preferred as preferredSubtitle } from './subs.js';

// Holes a damaged file leaves in the buffer: how often they are looked
// for while the picture waits, and the longest one jumped (watchHoles).
const HOLE_CHECK_MS = 400;
const MAX_HOLE_S = 180;
const HEADER_BYTES = 256 * 1024;
const CUES_BYTES = 4 * 1024 * 1024;

// How far ahead to buffer before the download waits.
const BUFFER_AHEAD = 60;
// How much of what has been watched is left behind before cleaning up.
const BUFFER_BEHIND = 30;
// The two above are in seconds, and what the browser limits is bytes:
// Chrome holds some 150 MB of picture in a SourceBuffer, and Firefox a
// similar amount. The demo episode's minute is barely a megabyte; a 1080p remux
// at 30 Mbit/s is 225 MB, and a 4K one twice that, so a minute ahead plus
// half a minute behind fills the buffer long before the download waits.
// The seconds are therefore cut down to what this many bytes of the film's
// own bit rate hold, measured from the segments as they go in — with a
// floor, so that a burst of high bit rate does not leave the picture
// living from hand to mouth.
const BUFFER_BYTES = 90 * 1024 * 1024;
const MIN_AHEAD = 10;
const MIN_BEHIND = 5;
// How many bytes the network may run ahead of the demuxer. A block larger
// than this still gets through: the demuxer says what it waits for, see
// BufferedBytes.hasRoom.
const MAX_PENDING_BYTES = 8 * 1024 * 1024;
// How many bytes of finished segments may wait in the append queues. The
// queues are held back by nothing else: while an append waits for room in
// a full buffer, the demuxer would go on queueing the rest of the film in
// memory behind it.
const MAX_QUEUED_BYTES = 16 * 1024 * 1024;
// How often an append the buffer had no room for is tried again, once the
// watched part has been dropped and playback has had time to use some of
// what lies ahead.
const QUOTA_RETRY_MS = 1000;

// A video segment is cut at a keyframe, but only once it holds enough
// frames: too short a segment would make the moof headers disproportionately
// expensive.
const MIN_SEGMENT_FRAMES = 48;
const AUDIO_SEGMENT_FRAMES = 100;

// A download can break mid-file: the server closes the connection, the
// network stutters. Playback resumes from the start of the last complete
// cluster, because half a cluster would leave the decoder with an
// incomplete group of pictures — VideoToolbox answers that with error
// -12909 and playback does not recover.
const MAX_RESUMES = 6;
const RESUME_DELAY_MS = 700;

// The seek table is read again after a failure, on the same growing delays
// as a resume, but within this time: a seek waits for the table, and a
// viewer waiting longer than this had rather see the file read through to
// the target. A failure that outlasts it leaves the table unread rather
// than missing, and the next seek asks for it again.
const CUES_RETRY_MS = 20000;

// A read that yields nothing for this long is a dead connection: the server
// accepted and went quiet, or the network went away under an open socket,
// which raises no error at all. The wait is cut and treated as a break in
// the download, which resumes like any other; a server that is really gone
// then fails the resume, and that is reported. Without the limit the
// picture would run out the buffer and stop without a word.
const STALL_MS = 15000;
// A request the server has not answered at all within this time is given
// up as a break, see ANSWER_MS in js/playback.js: measured, a provider
// answers within a second, refusals included.
const ANSWER_MS = 5000;

const AAC_FRAME_LENGTHS = [960, 1024, 1920, 2048];

// Silent playback stops by itself: Chrome treats an element without an
// audio track under the autoplay rules and pauses it from time to time. In
// a measured run the pause came at 17.8 seconds with readyState 4 and a
// 62-second buffer, preceded by no event at all. Episodes that play with an
// audio track never stop, so resuming is confined to this case.
const MAX_SILENT_RESUMES = 20;


export class Remuxer {
  /**
   * @param {HTMLVideoElement} video
   * @param {string} url
   * @param {{onError?:Function, onFirstAppend?:Function, onNotice?:Function,
   *          onSubtitles?:Function, onAudio?:Function, onOpen?:Function,
   *          onAnswer?:Function, startAt?:number, subtitleLang?:string|null,
   *          audioLang?:string|null}} opts
   *
   * onOpen(again) is called as each request goes out; again says that one
   * of ours was let go just before it, so that the server may still be
   * counting that one when it answers this. onAnswer() is called as the
   * server answers one, before its bytes.
   */
  constructor(video, url, {
    onError, onFirstAppend, onNotice, onSubtitles, onAudio, onOpen, onAnswer, startAt = 0, subtitleLang = null,
    audioLang = null,
  } = {}) {
    this.video = video;
    this.url = url;
    this.onError = onError || (() => {});
    this.onFirstAppend = onFirstAppend || (() => {});
    this.onNotice = onNotice || (() => {});
    this.onSubtitles = onSubtitles || (() => {});
    this.onAudio = onAudio || (() => {});
    this.onOpen = onOpen || (() => {});
    this.onAnswer = onAnswer || (() => {});
    this.opened = false;          // whether a request of ours has gone out before
    this.startAt = startAt;
    this.subtitleLang = subtitleLang;
    this.audioLang = audioLang;

    this.ms = null;
    this.objectUrl = null;
    this.connection = null;
    this.generation = 0;          // bumped on seek, invalidates the old pump
    this.destroyed = false;

    this.header = null;
    this.videoTrack = null;
    this.audioTrack = null;
    this.audioList = [];          // every audio track of the file, see audio.js
    this.audioChoices = [];       // those of them that can be played
    this.switching = null;        // the audio switch in flight, so two clicks do not race
    this.decodeTrack = null;      // the track we decode ourselves, when one is needed
    this.transcoder = null;
    this.subs = null;             // SubtitleTracks, when there are text tracks
    this.subtitleList = [];
    this.buffers = { video: null, audio: null };
    this.audioMime = null;        // what the audio buffer is parsing, for changeType
    this.queues = { video: Promise.resolve(), audio: Promise.resolve() };
    this.sequence = 1;
    this.audioNominal = 1024;
    this.audioDts = null;
    this.cues = null;
    this.cuesTried = false;
    this.cuesLoading = null;      // the fetch in flight, shared by every seek that waits for it
    this.pinned = null;           // its controller: closeConnection() leaves it alone
    this.noticedCues = false;
    this.noticedCuesFailed = false;
    // What the picture costs, for turning the read-ahead's seconds into
    // bytes: the bytes and the seconds of the recent video segments, each
    // older one weighing less, see readAhead().
    this.rate = { bytes: 0, seconds: 0 };
    this.quotaAhead = Infinity;   // the read-ahead the buffer turned out to hold, once it was full
    this.quotaWaits = 0;          // appends waiting for the buffer to make room
    this.queued = 0;              // bytes in the append queues
    this.stream = null;
    this.started = false;
    this.onSeeking = () => this.handleSeek();
    this.onPause = () => this.resumeSilent();
    this.silentResumes = 0;
    this.state = { phase: 'alku', pending: 0, lastPts: 0, segments: 0, reading: false, resumes: 0 };
    this.clusterAt = null;        // where the latest cluster sits in the file
    this.resumes = 0;
    // For the player's account of the start-up, see progress(): the bytes
    // this unpacker has had from the network, and the step of the start
    // whose size is known — from which count to which, and what it is.
    this.received = 0;
    this.step = null;
    this.size = 0;                // the whole file's, when the first answer says it
  }

  /**
   * What the download has come to: the bytes read; the step of the start
   * whose size is known — the header's quarter of a megabyte, the seek
   * table a resume point waits for — and none after it, since the first
   * segment ends at a keyframe nothing says the place of; and the file's
   * bit rate when its size and length are known, for telling a connection
   * too slow for the film.
   */
  progress() {
    const duration = this.header && this.header.duration;
    let bitrate = this.size && duration ? (this.size * 8) / duration : null;
    if (!bitrate && this.rate.seconds > 0) bitrate = (this.rate.bytes * 8) / this.rate.seconds;
    return { loaded: this.received, ...this.step, bitrate };
  }

  /* ------------------------------------------------------------ life cycle */

  async start() {
    this.ms = new MediaSource();
    this.objectUrl = URL.createObjectURL(this.ms);
    const open = new Promise((resolve) => this.ms.addEventListener('sourceopen', resolve, { once: true }));
    this.video.src = this.objectUrl;
    await open;
    if (this.destroyed) return;

    // The encoder measurement does not depend on the file and its result
    // is per page, so it is started alongside reading the header. Reading
    // the header leaves the connection open with the reader waiting, and it
    // is not worth stopping for the measurement — the account allows one
    // connection, so it cannot simply be opened again.
    encoderSetup().catch(() => { /* openTranscoder reports the reason */ });

    await this.readHeader();
    if (this.destroyed) return;

    // Before the source buffers: the decoder reports the audio track's
    // final format, which the init segment needs.
    await this.openTranscoder();
    if (this.destroyed) return;

    // The generation is pinned before the init segments: append() stamps
    // every addition with the generation of the moment, and a later bump
    // would discard the init segments just queued as stale. Without them
    // the SourceBuffer rejects the first media segment.
    const generation = ++this.generation;

    // The duration before the source buffers: MediaSource refuses a
    // duration while any buffer is mid-append. Without a duration, seekable
    // is limited to the buffered part and the browser clamps a seek to its
    // end.
    if (this.header.duration) {
      try {
        this.ms.duration = this.header.duration;
      } catch (err) {
        console.warn('[iptv] setting the duration failed', err);
      }
    }
    this.setupTracks();
    this.reportAudio();
    this.setupSubtitles();
    this.video.addEventListener('seeking', this.onSeeking);
    if (!this.audioTrack) this.video.addEventListener('pause', this.onPause);

    // When playing from the start we continue from the stream that read the
    // header. A resume point needs the seek table, and fetching it takes the
    // connection — then the stream is closed.
    let offset = 0;
    if (this.startAt > 1) {
      const target = await this.clusterFor(this.startAt);
      if (this.destroyed || generation !== this.generation) return;
      if (target != null) offset = target;
      else this.startAt = 0;
    }
    this.startPump(offset, generation);
  }

  /**
   * Whether the download is between connections: a break or a refused
   * request is being retried, and nothing has got through since. The
   * picture may stand still meanwhile, and the player's own watch for a
   * frozen picture leaves it to the retries — they end in playback or in
   * an error of their own.
   */
  get recovering() { return this.resumes > 0; }

  /**
   * Jumps the picture over the holes a damaged file leaves in the buffer
   * (onResync above): MediaSource does not play across a gap, and the
   * picture would wait at the end of one buffered stretch with the next one
   * already there. Watched only once a hole has been made, and only a hole
   * of a few minutes at most is jumped — anything longer is the viewer's
   * seek or a buffer still filling.
   */
  watchHoles() {
    if (this.holeTimer || this.destroyed) return;
    this.holesJumped = this.holesJumped || 0;
    this.holeTimer = setInterval(() => {
      if (this.destroyed) { clearInterval(this.holeTimer); this.holeTimer = null; return; }
      const v = this.video;
      if (v.paused || v.seeking || v.readyState >= 3) return;
      const at = v.currentTime;
      const ranges = v.buffered;
      for (let i = 0; i < ranges.length; i++) {
        const start = ranges.start(i);
        if (start <= at + 0.1) continue;
        // The first stretch after the picture: jumped to when the picture
        // stands at the end of the one it is in, or between stretches.
        const inRange = i > 0 && ranges.start(i - 1) <= at && at <= ranges.end(i - 1) + 0.05;
        const atEnd = !inRange || ranges.end(i - 1) - at < 0.35;
        if (atEnd && start - at < MAX_HOLE_S) {
          console.warn('[iptv] jumping a hole in the file from %s s to %s s', at.toFixed(2), start.toFixed(2));
          try { v.currentTime = start + 0.05; } catch { /* the element refused; the next tick tries again */ return; }
          // Said when the picture jumps rather than when the reader, far
          // ahead, found the damage: the first time in full — the fault is
          // the provider's copy of the file, not the connection or the
          // player — and after that only how much went.
          this.onNotice(this.holesJumped++
            ? t('remux.gap.again', { seconds: Math.max(1, Math.round(start - at)) })
            : t('remux.gap', { time: formatClock(at) }));
        }
        return;
      }
    }, HOLE_CHECK_MS);
  }

  destroy() {
    this.destroyed = true;
    this.generation++;
    if (this.holeTimer) { clearInterval(this.holeTimer); this.holeTimer = null; }
    this.video.removeEventListener('seeking', this.onSeeking);
    this.video.removeEventListener('pause', this.onPause);
    if (this.subs) { this.subs.destroy(); this.subs = null; }
    if (this.transcoder) { this.transcoder.close(); this.transcoder = null; }
    this.subtitleList = [];
    if (this.stream) {
      try { this.stream.ctrl.abort(); } catch { /* already closed */ }
      this.stream = null;
    }
    this.closeConnection();
    if (this.pinned) { try { this.pinned.abort(); } catch { /* already closed */ } this.pinned = null; }
    try {
      if (this.ms && this.ms.readyState === 'open') this.ms.endOfStream();
    } catch { /* already closed */ }
    if (this.objectUrl) { URL.revokeObjectURL(this.objectUrl); this.objectUrl = null; }
    this.ms = null;
  }

  fail(err) {
    if (this.destroyed) return;
    if (err && err.name === 'AbortError') return;
    console.warn('[iptv] remux failed', err);
    this.onError(err);
  }

  /* -------------------------------------------------------------- network */

  closeConnection() {
    const open = this.connection;
    this.connection = null;
    if (open) { try { open.abort(); } catch { /* already closed */ } }
  }

  /**
   * One download at a time: the previous one is always cut first. A pinned
   * read — the seek table — is the exception: it is not registered as the
   * connection, so a seek that comes while it is in flight does not cut it
   * but waits for it, and a pump that would open meanwhile waits too.
   */
  async openRange(from, to, { pinned = false } = {}) {
    if (!pinned && this.cuesLoading) await this.cuesLoading;
    // destroy() ends the seek-table read quietly, and the wait above then
    // returns as if all were well: opening now would hold a connection
    // under the next playback.
    if (this.destroyed) throw new DOMException('the unpacker is gone', 'AbortError');
    this.closeConnection();
    if (this.stream) {
      try { this.stream.ctrl.abort(); } catch { /* already closed */ }
      this.stream = null;
    }
    const ctrl = new AbortController();
    if (pinned) this.pinned = ctrl; else this.connection = ctrl;
    const range = to != null ? `bytes=${from}-${to}` : `bytes=${from}-`;
    // Every request but the first follows one of ours that has just been
    // let go, and a provider goes on counting a closed connection for a few
    // seconds: the player is told, so that a refusal now is taken for that
    // count before it is taken for someone else's stream.
    this.onOpen(this.opened);
    this.opened = true;
    let res;
    try {
      res = await within(fetch(this.url, {
        signal: ctrl.signal, cache: 'no-store', credentials: 'omit', headers: { Range: range },
      }), ctrl, ANSWER_MS);
    } catch (err) {
      if (err && err.name !== 'AbortError') err.connection = true;
      throw err;
    }
    this.onAnswer();
    if (!res.ok) {
      // Marked as the connection's failure rather than the file's: a
      // refusal is most often the account's one connection still counted,
      // and worth asking again after a moment, see startPump().
      // Refused after the redirect, by the server that holds the file: the
      // file's fault, not a connection still counted, see
      // refusedByFileServer().
      const refused = refusedByFileServer(res);
      const err = Object.assign(new Error(`the server answered ${res.status}`),
        { status: res.status, unavailable: refused ? res.status : 0, connection: !refused });
      try { ctrl.abort(); } catch { /* already closed */ }
      if (this.connection === ctrl) this.connection = null;
      if (this.pinned === ctrl) this.pinned = null;
      throw err;
    }
    return { res, ctrl };
  }

  async readRange(from, to, opts) {
    const { res, ctrl } = await this.openRange(from, to, opts);
    const reader = res.body.getReader();
    const parts = [];
    let total = 0;
    const cap = to != null ? to - from + 1 : Infinity;
    while (total < cap) {
      const { done, value } = await within(reader.read(), ctrl);
      if (done) break;
      parts.push(value);
      total += value.byteLength;
      this.received += value.byteLength;
    }
    try { ctrl.abort(); } catch { /* the body had already ended */ }
    if (this.connection === ctrl) this.connection = null;
    if (this.pinned === ctrl) this.pinned = null;
    const out = new Uint8Array(total);
    let at = 0;
    for (const part of parts) { out.set(part, at); at += part.byteLength; }
    return out;
  }

  /**
   * Reads the header from the start of the file and leaves the connection
   * open: the same stream continues into the clusters. A separate header
   * request would mean two connections back to back, and the account allows
   * one — the server cut the second after a few seconds.
   */
  async readHeader() {
    const from = this.received;
    this.step = { stage: 'media', from, need: from + HEADER_BYTES };
    const { res, ctrl } = await this.openRange(0, null);
    // Asked from the first byte to the last, the length of the answer is
    // the length of the file.
    const length = Number(res.headers.get('content-length'));
    if (length > 0) {
      this.size = length;
      this.step.need = from + Math.min(HEADER_BYTES, length);
    }
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    while (total < HEADER_BYTES) {
      const { done, value } = await within(reader.read(), ctrl);
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
      this.received += value.byteLength;
    }
    const bytes = new Uint8Array(total);
    let at = 0;
    for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }

    if (emptyAnswer(bytes)) {
      try { ctrl.abort(); } catch { /* already closed */ }
      throw Object.assign(new Error(t('probe.empty')), { empty: true });
    }
    const header = parseHeader(bytes);
    if (!header.ok) {
      try { ctrl.abort(); } catch { /* already closed */ }
      throw new Error('no track data found');
    }
    this.stream = { reader, ctrl, chunks, offset: 0 };
    this.header = header;

    const tracks = header.tracks;
    this.videoTrack = tracks.find((t) => t.type === 1 && videoMime(t)) || null;
    // A file may hold several audio tracks: the original and a dub, a
    // commentary, an audio description. Which one plays is audio.js's
    // decision — the same one probe.js reports below the player, so the
    // details and what is heard cannot disagree. The viewer's remembered
    // language decides first; failing that an untouched track beats a
    // decoded one, which is what saves discs carrying both AC-3 and AAC.
    this.audioList = describeAll(tracks);
    // What the viewer may choose between: the rest cannot be played at all.
    this.audioChoices = this.audioList.filter((entry) => entry.route);
    const wanted = preferredAudio(this.audioList, this.audioLang);
    const chosen = wanted ? tracks.find((t) => t.number === wanted.number) : null;
    this.audioTrack = wanted && wanted.route === 'passthrough' ? chosen : null;
    // A track we decode ourselves. Of the 45 measured ac3/eac3 episodes not
    // one had an alternative track Chrome supports, so without this they
    // would be left silent.
    this.decodeTrack = wanted && wanted.route === 'decoded' ? chosen : null;
    if (!this.videoTrack) throw new Error('no playable video track found');
  }

  /* --------------------------------------------------------- source buffers */

  setupTracks() {
    const videoType = `video/mp4; codecs="${videoMime(this.videoTrack)}"`;
    this.buffers.video = this.ms.addSourceBuffer(videoType);
    this.buffers.video.mode = 'segments';
    this.append('video', initSegment([{
      id: 1, kind: 'video', timescale: VIDEO_TIMESCALE,
      codec: this.videoTrack.codecId === 'V_MPEGH/ISO/HEVC' ? 'hevc' : 'h264',
      priv: this.videoTrack.priv, width: this.videoTrack.width, height: this.videoTrack.height,
    }]));

    if (this.audioTrack) {
      const { mime, init } = this.audioFormat();
      this.buffers.audio = this.ms.addSourceBuffer(`audio/mp4; codecs="${mime}"`);
      this.buffers.audio.mode = 'segments';
      this.audioMime = mime;
      this.append('audio', init);
    }
  }

  /**
   * The codec string and the init segment for the audio track in play.
   *
   * For a decoded track the format is transcode.js's fixed stereo 48 kHz
   * rather than the original track's, and the codec is whichever encoder
   * the browser has — AAC in Chrome, Opus in Firefox. The
   * AudioSpecificConfig comes from the encoder too, because Matroska's
   * CodecPrivate describes the decoded format, not the encoded one.
   */
  audioFormat() {
    const decoded = Boolean(this.transcoder);
    const rate = decoded ? DECODED_RATE : (this.audioTrack.outputRate || this.audioTrack.rate || 48000);
    const mime = decoded ? this.transcoder.mime : passthroughMime(this.audioTrack.codecId);
    return {
      mime,
      rate,
      init: initSegment([{
        id: 2, kind: 'audio', timescale: rate, codec: decoded ? this.transcoder.codec : 'aac',
        priv: decoded ? this.transcoder.description : this.audioTrack.priv,
        channels: decoded ? DECODED_CHANNELS : this.audioTrack.channels,
        rate,
      }]),
    };
  }

  /**
   * Opens the decoder for a track the browser will not decode. A failure
   * does not stop playback: the picture goes through without sound, and the
   * viewer is told why.
   */
  async openTranscoder() {
    if (!this.decodeTrack) return;
    try {
      if (!(await AudioTranscoder.available(this.decodeTrack.codecId))) {
        throw new Error('the browser has neither an AAC nor an Opus encoder');
      }
      const transcoder = await AudioTranscoder.open(this.decodeTrack.codecId, (err) => this.audioFailed(err));
      if (this.destroyed) { transcoder.close(); return; }
      this.transcoder = transcoder;
      this.audioTrack = this.decodeTrack;
    } catch (err) {
      console.warn('[iptv] audio track cannot be decoded', err);
      this.onNotice(t('remux.noaudio'));
    }
  }

  /**
   * The encoder failed mid-playback. The audio track has to be dropped
   * entirely: a starved source buffer would leave the picture waiting for
   * sound that is no longer coming.
   */
  audioFailed(err) {
    if (this.destroyed || !this.transcoder) return;
    console.warn('[iptv] audio encoding stopped', err);
    this.dropAudio(t('remux.audiostopped'));
  }

  /**
   * The sound goes, the picture stays. The selector goes with it: there is
   * nothing left to choose between once the buffer is gone.
   */
  dropAudio(message) {
    if (this.transcoder) { this.transcoder.close(); this.transcoder = null; }
    const sb = this.buffers.audio;
    this.buffers.audio = null;
    this.audioTrack = null;
    this.decodeTrack = null;
    this.audioChoices = [];
    try { if (sb && this.ms && this.ms.readyState === 'open') this.ms.removeSourceBuffer(sb); } catch { /* playback continues regardless */ }
    this.onNotice(message);
    this.reportAudio();
  }

  /**
   * The subtitle tracks for the element, with the one matching the language
   * choice shown. The tracks are created before the first cluster, so the
   * selector is in place the moment the picture starts — the cues trickle in
   * as the demuxing goes on.
   */
  setupSubtitles() {
    const tracks = this.header.tracks.filter(isTextSubtitle);
    // The bitmap tracks are counted for the details below the player: such
    // a file has subtitles, only none the player can show.
    this.bitmapSubtitles = this.header.tracks.filter(isSubtitle).length - tracks.length;
    if (!tracks.length) { this.report([], null); return; }
    // The callback fires only for a change that came from outside the app
    // — from the browser's own subtitle menu — because select() has already
    // recorded its own choice.
    this.subs = new SubtitleTracks(this.video, (active) => this.report(this.subtitleList, active, true));
    this.subtitleList = this.subs.setup(tracks);
    this.report(this.subtitleList, this.subs.select(preferredSubtitle(this.subtitleList, this.subtitleLang)));
  }

  report(tracks, active, external = false) {
    if (this.destroyed) return;
    this.onSubtitles({ tracks, active, external, bitmap: this.bitmapSubtitles || 0 });
  }

  /** Changing track from the viewer's choice. null hides the subtitles. */
  selectSubtitle(number) {
    if (!this.subs) return null;
    const active = this.subs.select(number);
    this.report(this.subtitleList, active);
    return active;
  }

  /* ------------------------------------------------------------------ audio */

  /**
   * The audio tracks and the one in play, for the selector. The same list
   * every time — only the choice changes — so the menu is not rebuilt
   * under the viewer's cursor on a change of track.
   */
  reportAudio() {
    if (this.destroyed) return;
    this.onAudio({
      tracks: this.audioChoices,
      active: this.audioTrack ? this.audioTrack.number : null,
    });
  }

  /**
   * Changing the audio track while the picture runs.
   *
   * The account allows one connection, so the alternative track is not on
   * the browser's side: it has to be read from the file again. The picture
   * is left where it is — the video buffer holds up to a minute ahead — and
   * only the sound is dropped and refilled from the cluster the playback
   * position sits in. What the viewer gets is a gap in the sound of about a
   * second, not a stall in the picture.
   *
   * A seek in the middle of this is not a problem: both bump the
   * generation, and whichever is later wins.
   */
  selectAudio(number) {
    if (this.destroyed || !this.buffers.audio) return null;
    const entry = this.audioList.find((e) => e.number === number && e.route);
    if (!entry) return this.audioTrack ? this.audioTrack.number : null;
    if (this.audioTrack && this.audioTrack.number === number) return number;
    // A second click while the first switch is still opening its decoder
    // would leave two pumps reading the same connection. Only the last
    // link of the chain clears it, or an earlier one would declare the
    // switching over while the next was still running.
    const chain = (this.switching || Promise.resolve())
      .then(() => this.switchAudio(entry))
      .catch((err) => this.fail(err))
      .finally(() => { if (this.switching === chain) this.switching = null; });
    this.switching = chain;
    return number;
  }

  async switchAudio(entry) {
    if (this.destroyed || !this.buffers.audio) return;
    const track = this.header.tracks.find((t) => t.number === entry.number);
    if (!track) return;
    const previous = { decode: this.decodeTrack, transcoder: this.transcoder };

    // The decoder for the new track is opened before anything is torn
    // down, so that a browser without an encoder leaves the track that is
    // playing alone rather than ending up with neither. A decoder belongs
    // to a codec, not to a track, so a switch between two tracks of the
    // same codec keeps the one that is open.
    let transcoder = null;
    if (entry.route === 'decoded') {
      if (previous.transcoder && previous.decode && previous.decode.codecId === entry.codecId) {
        transcoder = previous.transcoder;
      } else {
        try {
          if (!(await AudioTranscoder.available(entry.codecId))) {
            throw new Error('the browser has neither an AAC nor an Opus encoder');
          }
          transcoder = await AudioTranscoder.open(entry.codecId, (err) => this.audioFailed(err));
        } catch (err) {
          console.warn('[iptv] audio track cannot be decoded', err);
          this.onNotice(t('remux.noaudio'));
          this.reportAudio();       // the selector snaps back to what is playing
          return;
        }
      }
    }
    if (this.destroyed) {
      if (transcoder && transcoder !== previous.transcoder) transcoder.close();
      return;
    }

    const generation = ++this.generation;
    this.closeConnection();
    if (previous.transcoder && previous.transcoder !== transcoder) previous.transcoder.close();
    this.transcoder = transcoder;
    this.decodeTrack = transcoder ? track : null;
    this.audioTrack = track;

    // The buffer keeps its identity — the element's track set must not
    // change under a running playback — and changeType re-points its
    // parser. A new init segment follows either way: the sample rate and
    // the channel count differ from track to track even within one codec.
    const { mime, init } = this.audioFormat();
    await this.clearAudio();
    if (this.destroyed || generation !== this.generation) return;
    if (mime !== this.audioMime) {
      try {
        this.buffers.audio.changeType(`audio/mp4; codecs="${mime}"`);
        this.audioMime = mime;
      } catch (err) {
        // The picture must not stop with it: the pump below still runs,
        // and it now feeds the video buffer alone.
        console.warn('[iptv] the audio buffer would not take the new format', err);
        this.dropAudio(t('remux.audioswitchfailed'));
      }
    }
    this.sequence++;
    this.audioDts = null;
    this.resumes = 0;
    this.append('audio', init);
    this.reportAudio();
    // From the cluster the picture is at: the sound before that point is
    // gone with the buffer, and the viewer hears the new track from where
    // they are.
    const offset = (await this.clusterFor(this.video.currentTime)) ?? 0;
    if (this.destroyed || generation !== this.generation) return;
    this.startPump(offset, generation);
  }

  /** Drops the sound, and only the sound: the picture stays buffered. */
  async clearAudio() {
    await this.remove('audio', () => [0, Infinity]);
  }

  /**
   * Removes a stretch of a buffer in turn with the appends. A SourceBuffer
   * does one thing at a time: an append issued while a remove is under way
   * throws, and an append that throws stops playback. Run beside the queue,
   * the first eviction — some 35 seconds in — ended films with "SourceBuffer
   * rejected the segment", and the picture stopped once the minute already
   * buffered had played out. The stretch is asked for when its turn comes,
   * so that it is measured against the position of that moment.
   */
  remove(kind, span) {
    const sb = this.buffers[kind];
    if (!sb) return Promise.resolve();
    this.queues[kind] = this.queues[kind].then(() => {
      const [from, to] = span() || [];
      return from == null ? undefined : removeNow(sb, from, to);
    });
    return this.queues[kind];
  }

  /** Appends queued per track: a SourceBuffer accepts one at a time. */
  append(kind, data) {
    const sb = this.buffers[kind];
    if (!sb) return Promise.resolve();
    const generation = this.generation;
    const size = data.byteLength || 0;
    this.queued += size;
    this.queues[kind] = this.queues[kind].then(async () => {
      try {
        await this.appendFitting(kind, sb, data, generation);
      } finally {
        this.queued -= size;
      }
    });
    return this.queues[kind];
  }

  /**
   * One append, waiting for room when the buffer is full.
   *
   * A full buffer is not a failure: the browser's limit is in bytes, and a
   * film of a high enough bit rate reaches it with less than the minute
   * ahead that the download aims for. It once ended the film — the watched
   * part was dropped, the append tried once more, and the picture stopped
   * with "SourceBuffer rejected the segment" when that did not free enough.
   * Now the read-ahead is cut down to what the buffer turned out to hold,
   * the watched part goes, and the append waits for playback to use up
   * some of what lies ahead, trying again every second. The download waits
   * meanwhile (see waitForRoom); a server that closes the idle connection
   * under it is resumed like any other break.
   */
  async appendFitting(kind, sb, data, generation) {
    const stale = () => this.destroyed || generation !== this.generation || !this.ms
      || this.ms.readyState !== 'open' || this.buffers[kind] !== sb;
    let waiting = false;
    try {
      for (let tries = 0; ; tries++) {
        if (stale()) return;
        try {
          await this.appendOnce(sb, data);
          return;
        } catch (err) {
          if (!err || err.name !== 'QuotaExceededError') { this.fail(err); return; }
          if (!tries) this.noteQuota(kind);
          if (!waiting) { waiting = true; this.quotaWaits++; }
          this.state.phase = `the ${kind} buffer is full, waiting for playback to make room`;
          // In the queue already: removed at once rather than queued
          // behind this very append. Once the watched part is gone, only
          // playback moving on makes more room.
          // The first time the append is tried again at once; after that
          // only after a pause, or a removal that frees nothing would spin.
          const span = this.evictable(kind, true);
          if (span) await removeNow(sb, ...span);
          if (tries || !span) await new Promise((resolve) => setTimeout(resolve, QUOTA_RETRY_MS));
        }
      }
    } finally {
      if (waiting) this.quotaWaits--;
    }
  }

  /**
   * The buffer was full with this much ahead of the picture: the read-ahead
   * is held a quarter below it from now on, so that the download waits
   * before the buffer fills rather than after.
   */
  noteQuota(kind) {
    const ahead = this.bufferedAhead();
    const fits = Math.max(MIN_AHEAD, Math.floor(ahead * 0.75));
    if (fits < this.quotaAhead) {
      console.warn('[iptv] the %s buffer is full at %d s ahead; reading %d s ahead from now on', kind, Math.round(ahead), fits);
      this.quotaAhead = fits;
    }
  }

  /**
   * How far ahead to read and how much of the watched part to keep, in
   * seconds: BUFFER_AHEAD and BUFFER_BEHIND, or as much of them as
   * BUFFER_BYTES holds at the film's bit rate, and never more than the
   * buffer turned out to hold.
   */
  readAhead() {
    let ahead = BUFFER_AHEAD;
    let behind = BUFFER_BEHIND;
    const perSecond = this.rate.seconds > 0 ? this.rate.bytes / this.rate.seconds : 0;
    if (perSecond > 0) {
      const fits = BUFFER_BYTES / perSecond;
      behind = Math.min(BUFFER_BEHIND, Math.max(MIN_BEHIND, fits / 4));
      ahead = Math.min(BUFFER_AHEAD, Math.max(MIN_AHEAD, fits - behind));
    }
    return { ahead: Math.min(ahead, this.quotaAhead), behind };
  }

  appendOnce(sb, data) {
    return new Promise((resolve, reject) => {
      const done = () => { sb.removeEventListener('updateend', done); sb.removeEventListener('error', bad); resolve(); };
      const bad = () => { sb.removeEventListener('updateend', done); sb.removeEventListener('error', bad); reject(new Error('SourceBuffer rejected the segment')); };
      sb.addEventListener('updateend', done);
      sb.addEventListener('error', bad);
      // What appendBuffer throws is passed on as it is: QuotaExceededError
      // is the full buffer, which is waited out rather than reported. Run
      // through bad() it became "rejected the segment", and a full buffer
      // ended the film.
      try {
        sb.appendBuffer(data);
      } catch (err) {
        sb.removeEventListener('updateend', done);
        sb.removeEventListener('error', bad);
        reject(err);
      }
    });
  }

  /** Removes the watched part from the buffer, so memory does not grow
   *  without bound. */
  evict(kind) {
    return this.remove(kind, () => this.evictable(kind));
  }

  /** The watched stretch of a buffer that can go, or null. Aggressive is
   *  for a full buffer: then all but a few seconds go, a second at a time. */
  evictable(kind, aggressive = false) {
    const ranges = timeRanges(this.buffers[kind]);
    if (!ranges) return null;
    const keepFrom = Math.max(0, this.video.currentTime - (aggressive ? MIN_BEHIND : this.readAhead().behind));
    const start = ranges.start(0);
    return keepFrom - start < (aggressive ? 1 : 5) ? null : [start, keepFrom];
  }

  /* ------------------------------------------------------------------ pump */

  /**
   * Reads the file from the given offset, demuxes the clusters and feeds the
   * segments onward. The generation invalidates the run if a seek gets in
   * between.
   */
  async pump(offset, generation) {
    let reader;
    let ctrl;
    const bytes = new BufferedBytes();
    // Past the header the start's size is not known.
    this.step = null;
    if (this.stream && this.stream.offset === offset) {
      // The stream that read the header continues from here; the bytes
      // already read are handed to the demuxer again, because it starts
      // from the beginning of the file.
      ({ reader, ctrl } = this.stream);
      for (const chunk of this.stream.chunks) bytes.push(chunk);
      this.stream = null;
      this.connection = ctrl;
    } else {
      const opened = await this.openRange(offset, null);
      reader = opened.res.body.getReader();
      ctrl = opened.ctrl;
    }

    let complete = false;
    const network = (async () => {
      try {
        for (;;) {
          if (this.destroyed || generation !== this.generation) break;
          await this.waitForRoom(bytes, generation);
          const { done, value } = await within(reader.read(), ctrl);
          if (done) { complete = true; break; }
          this.received += value.byteLength;
          bytes.push(value);
        }
      } catch (err) {
        // Whatever ended the download — the server closing the connection,
        // a network error under it, a stall cut above, an abort of our own
        // — the stream ends cleanly here and the bytes that did arrive are
        // demuxed. What follows is decided below: a stale generation stops,
        // a live one resumes from the last cluster.
        this.state.netError = err && err.name ? `${err.name}: ${err.message}` : String(err);
      } finally {
        bytes.end();
      }
    })();

    this.clusterAt = offset;
    const onCluster = (at) => { this.clusterAt = offset + at; };
    // The stream running out is transient and resumable; an invalid id, on
    // the other hand, means the file itself is broken. In the measured case
    // the episode was followed by three megabytes of zeros and no cluster
    // at all — retrying gets nowhere with that.
    let damaged = null;
    const onStop = (reason, at) => {
      this.state.stop = `${reason} @ ${offset + at}`;
      if (!reason.startsWith('stream ended')) damaged = offset + at;
    };
    const tracks = new Map(this.header.tracks.map((t) => [t.number, t]));
    const videoNumber = this.videoTrack.number;
    const audioNumber = this.audioTrack ? this.audioTrack.number : -1;
    const rate = this.audioTrack ? (this.audioTrack.outputRate || this.audioTrack.rate || 48000) : 48000;

    let pendingVideo = [];
    let pendingAudio = [];
    // Where the oldest pending frame's cluster begins. A break in the
    // download is resumed from there rather than from the cluster being
    // read: the frames waiting for a keyframe or for a full audio segment
    // came from the cluster before, and read again from the current one
    // they would be gone, leaving a hole in the buffer that playback stops
    // at. Reading a cluster twice merely overwrites frames already there.
    let videoFrom = null;
    let audioFrom = null;
    let decodedFrames = 0;
    let broke = false;
    this.audioDts = null;
    // The resume point does not land on a frame boundary, and the audio
    // queued in the encoder no longer belongs at this point in the file.
    if (this.transcoder) await this.transcoder.restart();
    this.state.phase = 'purkaa';
    this.state.reading = true;

    // A damaged stretch skipped (resync in js/mkv.js): the group of pictures
    // it cut short is not fed — the decoder answers an incomplete group with
    // an error it does not recover from — and the picture starts again at
    // the next keyframe after it. The viewer is told once where.
    let awaitKey = false;
    const onResync = (at, skipped) => {
      console.warn('[iptv] damaged stretch of %d bytes at byte %d skipped', skipped, offset + at);
      pendingVideo = [];
      videoFrom = null;
      awaitKey = true;
      this.watchHoles();
    };

    try {
      for await (const frame of frames(bytes, { timestampScale: this.header.timestampScale, tracks, onCluster, onStop, onResync })) {
        if (this.destroyed || generation !== this.generation) break;
        this.state.pending = bytes.available;
        this.state.lastPts = frame.pts / 1e9;

        if (frame.track === videoNumber && awaitKey) {
          if (!frame.keyframe) continue;
          awaitKey = false;
        }
        if (frame.track === videoNumber) {
          if (frame.keyframe && pendingVideo.length >= MIN_SEGMENT_FRAMES) {
            this.flushVideo(pendingVideo, generation);
            pendingVideo = [];
            videoFrom = null;
          }
          if (!pendingVideo.length) videoFrom = this.clusterAt;
          pendingVideo.push(frame);
        } else if (frame.track === audioNumber) {
          if (this.transcoder) {
            await this.transcoder.push(frame);
            if (++decodedFrames >= AUDIO_SEGMENT_FRAMES) {
              this.flushDecoded(generation);
              decodedFrames = 0;
            }
          } else {
            if (!pendingAudio.length) audioFrom = this.clusterAt;
            pendingAudio.push(frame);
            if (pendingAudio.length >= AUDIO_SEGMENT_FRAMES) {
              this.flushAudio(pendingAudio, rate, generation);
              pendingAudio = [];
              audioFrom = null;
            }
          }
        } else if (this.subs && this.subs.has(frame.track)) {
          // Subtitles do not go through MediaSource but straight onto the
          // element's own track, so they need neither segmenting nor
          // queueing.
          this.subs.push(frame.track, frame.pts, frame.duration, frame.data);
        }
      }
      if (generation === this.generation && !this.destroyed) {
        // A group of pictures cut short is not fed onward: the decoder
        // would get an incomplete group and fail. It is read again on
        // resume.
        if (complete && pendingVideo.length) this.flushVideo(pendingVideo, generation);
        if (complete && pendingAudio.length) this.flushAudio(pendingAudio, rate, generation);
        if (this.transcoder) {
          // The last frames always stay in the encoder, and they have to
          // be emitted in an interrupted run too: the resume starts at the
          // beginning of a cluster, and the audio in between is not read
          // again. Flushing adds up to a partial frame of silence at the
          // end of the chain, but the next chain is anchored to its own PTS
          // — so no stretching accumulates, unlike if flushing were used
          // for back pressure. The decoder's tail belongs only to the real
          // end.
          if (complete) await this.transcoder.finish();
          else await this.transcoder.drain();
          this.flushDecoded(generation);
        }
        await this.queues.video;
        await this.queues.audio;
        if (complete) this.finish(generation);
      }
      this.state.phase = complete ? 'valmis' : damaged !== null ? 'file broken' : 'katkesi';
      if (damaged !== null && generation === this.generation && !this.destroyed) {
        // The last group of pictures is not fed: it was left incomplete,
        // and the decoder answers an incomplete group with error -12909,
        // from which playback does not recover. Playback therefore ends
        // cleanly at the last intact group.
        await this.queues.video;
        await this.queues.audio;
        this.finish(generation);
        console.warn('[iptv] file is cut off at byte %d (%s)', damaged, this.state.stop);
        this.onNotice(t('remux.truncated', { time: formatClock(this.bufferedEnd()) }));
      }
      broke = !complete && damaged === null && generation === this.generation && !this.destroyed;
    } finally {
      this.state.reading = false;
      try { ctrl.abort(); } catch { /* already closed */ }
      if (this.connection === ctrl) this.connection = null;
      await network.catch(() => {});
    }
    // Only after the connection is closed: the account allows one at a
    // time, so a new one must not be opened before the previous is
    // certainly shut.
    if (broke) {
      const from = Math.min(...[videoFrom, audioFrom, this.clusterAt].filter((at) => at != null));
      await this.resume(generation, from);
    }
  }

  /**
   * A pump whose first request may be turned away. Seeking or changing the
   * audio track cuts the one connection and asks for another at once, and
   * a provider that goes on counting the closed one for a few seconds
   * refuses it: on a one-connection account a drag of the scrubber ended
   * the film with "the server answered 400". The request is asked again on
   * the resume's growing delays instead, and only when those run out is it
   * reported — by then the player knows the request followed one of ours
   * (onOpen), and asks the account before it blames another viewer.
   * Anything but the connection failing is reported at once.
   */
  startPump(offset, generation) {
    this.pump(offset, generation)
      .catch((err) => {
        // Past the header, a file server's refusal is asked again like a
        // connection's: the file was there a moment ago, see
        // refusedByFileServer().
        if (!err || !(err.connection || err.unavailable) || this.destroyed || generation !== this.generation) throw err;
        console.warn('[iptv] the download could not be opened, asking again', err);
        this.state.netError = err.message || String(err);
        return this.resume(generation, offset);
      })
      .catch((err) => this.fail(err));
  }

  /**
   * Resumes downloading from the start of the last complete cluster. A
   * successful resume clears the counter, so a long film survives several
   * drops — only consecutive failures stop the retrying.
   */
  async resume(generation, from = this.clusterAt) {
    if (this.resumes >= MAX_RESUMES) {
      this.state.phase = 'broke for good';
      // Said to the viewer (playback.died), so in their language, and with
      // the last thing that broke it: "repeatedly" alone left them nothing
      // to tell a server gone from a network that drops.
      this.onError(new Error(t('playback.reason.broke', {
        count: this.resumes, cause: this.state.netError || t('playback.reason.network'),
      })));
      return;
    }
    this.resumes++;
    this.state.resumes = this.resumes;
    this.state.phase = `resuming from byte ${from} (${this.resumes}/${MAX_RESUMES})`;
    console.warn('[iptv] download broke, resuming from byte %d (%d/%d)', from, this.resumes, MAX_RESUMES);
    await new Promise((resolve) => setTimeout(resolve, RESUME_DELAY_MS * this.resumes));
    if (this.destroyed || generation !== this.generation) return;
    // The audio chain starts over, because the resume point does not land
    // on a frame boundary.
    this.audioDts = null;
    try {
      await this.pump(from, generation);
    } catch (err) {
      // The new connection could not be opened, or stalled before the
      // first byte: another break, counted like the rest, so that a server
      // that is really gone is reported after the last attempt.
      if (this.destroyed || generation !== this.generation || (err && err.name === 'AbortError')) return;
      console.warn('[iptv] resuming failed', err);
      this.state.netError = err && err.message ? err.message : String(err);
      await this.resume(generation, from);
    }
  }

  /** Waits until there is room in the buffer. Stops the whole file being
   *  downloaded. Room is counted three ways: the seconds buffered ahead of
   *  the picture (see readAhead), the segments still waiting in the append
   *  queues, and no append waiting for a full buffer — while one does,
   *  every byte read would only pile up in memory behind it. */
  async waitForRoom(bytes, generation) {
    for (;;) {
      if (this.destroyed || generation !== this.generation) return;
      const ahead = this.bufferedAhead();
      if (bytes.hasRoom(MAX_PENDING_BYTES) && ahead < this.readAhead().ahead
          && !this.quotaWaits && this.queued < MAX_QUEUED_BYTES) return;
      this.state.phase = `waiting for room (${Math.round(ahead)} s buffered, ${Math.round(bytes.available / 1024)} kB pending, ${Math.round(this.queued / 1024)} kB queued${this.quotaWaits ? ', buffer full' : ''})`;
      await this.evict('video');
      await this.evict('audio');
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  /** The last moment of buffered picture, in seconds. */
  bufferedEnd() {
    const ranges = timeRanges(this.buffers.video);
    return ranges ? ranges.end(ranges.length - 1) : 0;
  }

  /**
   * How far the buffers reach past the playback position — the shorter of
   * the two. Normally they run together, both filled from the same
   * clusters; after a change of audio track they do not, and the minute of
   * picture already buffered must not stop the download that the sound is
   * waiting for.
   */
  bufferedAhead() {
    const each = ['video', 'audio']
      .filter((kind) => this.buffers[kind])
      .map((kind) => aheadIn(timeRanges(this.buffers[kind]), this.video.currentTime));
    return each.length ? Math.min(...each) : 0;
  }

  flushVideo(list, generation) {
    if (generation !== this.generation) return;
    const ticks = list.map((f) => Math.round((f.pts * VIDEO_TIMESCALE) / 1e9));
    const { dts, cts } = decodeTimes(ticks);
    const fallback = this.videoTrack.defaultDuration
      ? Math.round((this.videoTrack.defaultDuration * VIDEO_TIMESCALE) / 1e9)
      : 3750;
    const durs = durations(dts, fallback);
    const samples = list.map((frame, i) => ({
      data: frame.data, dts: dts[i], cts: cts[i], duration: durs[i], keyframe: frame.keyframe,
    }));
    const segment = mediaSegment(this.sequence++, 1, samples);
    // The bit rate the read-ahead is measured against: recent segments
    // count the most, so that a film whose picture grows heavier halfway
    // through is soon read less far ahead.
    const seconds = durs.reduce((sum, d) => sum + d, 0) / VIDEO_TIMESCALE;
    if (seconds > 0) {
      this.rate.bytes = this.rate.bytes * 0.9 + segment.byteLength;
      this.rate.seconds = this.rate.seconds * 0.9 + seconds;
    }
    const appended = this.append('video', segment);
    this.state.segments++;
    this.resumes = 0;
    if (!this.started) {
      this.started = true;
      if (this.startAt > 1) appended.then(() => this.toStart(generation));
      else this.onFirstAppend();
    }
  }

  /**
   * A resume point: the reading began at the cluster it falls in, and the
   * picture is taken there once that cluster is in the buffer. Nothing else
   * moved it — the element stood at 0 in front of a buffer that began at
   * 48 s, waited for data that would never come, and said "Connecting…" for
   * good. The position is held inside what is buffered, so that the seek
   * this makes finds its data there and fetches nothing.
   */
  toStart(generation) {
    if (this.destroyed || generation !== this.generation) return;
    // The picture's own buffer, as isBuffered reads it: the element's is
    // where picture and sound overlap, and the sound has not come yet.
    const ranges = timeRanges(this.buffers.video);
    if (ranges && ranges.length) {
      const start = ranges.start(0);
      const end = ranges.end(ranges.length - 1);
      const at = Math.min(Math.max(this.startAt, start), Math.max(start, end - 0.6));
      try { this.video.currentTime = at; } catch { /* the element refused; playing from the buffer's start will do */ }
    }
    this.onFirstAppend();
  }

  /**
   * The audio is chained back to back at its nominal duration. Matroska's
   * timestamps have millisecond resolution, so an AAC frame's 21.333 ms
   * would round and the error would accumulate into seconds over an hour.
   */
  flushAudio(list, rate, generation) {
    if (generation !== this.generation || !this.buffers.audio) return;
    if (this.audioDts == null) {
      this.audioNominal = nominalFrame(list, rate);
      this.audioDts = Math.round((list[0].pts * rate) / 1e9);
    }
    const samples = [];
    for (const frame of list) {
      const wanted = Math.round((frame.pts * rate) / 1e9);
      // A large deviation means a gap or a seek: the series starts over.
      if (Math.abs(wanted - this.audioDts) > rate / 4) this.audioDts = wanted;
      samples.push({ data: frame.data, dts: this.audioDts, cts: 0, duration: this.audioNominal, keyframe: true });
      this.audioDts += this.audioNominal;
    }
    this.append('audio', mediaSegment(this.sequence++, 2, samples));
  }

  /**
   * The finished frames — AAC or Opus, whichever the browser encodes — into
   * the source buffer. The times arrive from the encoder already chained,
   * but a single media segment may only hold a contiguous run: the tfdt
   * states just the first time and the rest are derived from the durations.
   */
  flushDecoded(generation) {
    if (generation !== this.generation || !this.buffers.audio || !this.transcoder) return;
    let run = [];
    let next = null;
    const emit = () => {
      if (!run.length) return;
      this.append('audio', mediaSegment(this.sequence++, 2, run, this.transcoder.codec));
      run = [];
    };
    for (const chunk of this.transcoder.take()) {
      if (next != null && chunk.dts !== next) emit();
      run.push({ data: chunk.data, dts: chunk.dts, cts: 0, duration: chunk.duration, keyframe: true });
      next = chunk.dts + chunk.duration;
    }
    emit();
  }

  finish(generation) {
    if (generation !== this.generation || this.destroyed) return;
    try {
      if (this.ms && this.ms.readyState === 'open') this.ms.endOfStream();
    } catch { /* the browser had already closed it */ }
  }

  /* ---------------------------------------------------------------- seeking */

  /**
   * The Cues table from the end of the file. Fetched once, and only if a
   * seek happens. Seeks that arrive while the fetch is in flight — a
   * scrubber drag, two arrow presses — share the one fetch: cutting it
   * would lose the table for the rest of the file, and with it every later
   * seek. Only a table that is really not there is given up on for good;
   * one that could not be read is asked for again by the next seek.
   */
  loadCues() {
    if (this.cues || this.cuesTried) return Promise.resolve(this.cues);
    if (!this.cuesLoading) {
      this.cuesLoading = this.fetchCues().finally(() => { this.cuesLoading = null; });
    }
    return this.cuesLoading;
  }

  /**
   * One failed read once cost the whole film its seeking: the table was
   * marked as tried, every later seek read the file from the start, and
   * "Continue watching" began at 0:00. The read is the first request after
   * a seek has let the connection go, so a provider still counting that
   * one refuses it — the commonest failure is the most passing one. It is
   * therefore asked again on the resume's growing delays, for as long as
   * CUES_RETRY_MS allows, and a failure past that leaves the table to the
   * next seek. What ends the asking for good is an answer: a table read
   * and parsed, bytes that are not one, or a range past the end of the
   * file.
   */
  async fetchCues() {
    if (this.header.cuesPosition == null) { this.cuesTried = true; return null; }
    const from = this.header.segmentStart + this.header.cuesPosition;
    const until = Date.now() + CUES_RETRY_MS;
    for (let attempt = 1; ; attempt++) {
      let bytes;
      // A resume point waits for the table before its picture: the table is
      // then what the start is waiting for.
      if (!this.started) {
        const span = this.size ? Math.max(0, Math.min(CUES_BYTES, this.size - from)) : CUES_BYTES;
        this.step = { stage: 'index', from: this.received, need: this.received + span };
      }
      try {
        bytes = await this.readRange(from, from + CUES_BYTES - 1, { pinned: true });
      } catch (err) {
        // Only destroy() aborts a pinned read, and then nothing follows.
        if (this.destroyed || (err && err.name === 'AbortError')) return null;
        if (err && err.status === 416) {
          console.warn('[iptv] the seek table lies past the end of the file');
          this.cuesTried = true;
          return null;
        }
        const delay = RESUME_DELAY_MS * attempt;
        if (attempt >= MAX_RESUMES || Date.now() + delay > until) {
          console.warn('[iptv] reading the seek table failed; the next seek asks again', err);
          return null;
        }
        console.warn('[iptv] reading the seek table failed, asking again (%d/%d)', attempt, MAX_RESUMES, err);
        await new Promise((resolve) => setTimeout(resolve, delay));
        if (this.destroyed) return null;
        continue;
      }
      try {
        this.cues = parseCues(bytes, this.header.timestampScale, this.videoTrack.number);
      } catch (err) {
        console.warn('[iptv] the seek table could not be read', err);
        this.cues = null;
      }
      this.cuesTried = true;
      return this.cues;
    }
  }

  /**
   * Resumes silent playback that the browser paused of its own accord. The
   * viewer's pause always comes from a gesture, so userActivation tells them
   * apart; a pause from a media key lands in the wrong pile here, but that
   * is rarer than a picture stopping by itself.
   */
  resumeSilent() {
    if (this.destroyed || this.video.ended || this.video.seeking) return;
    if (this.silentResumes >= MAX_SILENT_RESUMES) return;
    if (navigator.userActivation && navigator.userActivation.isActive) return;
    this.silentResumes++;
    const started = this.video.play();
    if (started && started.catch) started.catch(() => { /* the viewer paused first */ });
  }

  /** The file offset where the given moment starts, or null. */
  async clusterFor(seconds) {
    const cues = await this.loadCues();
    if (!cues || !cues.length) return null;
    let best = cues[0];
    for (const cue of cues) {
      if (cue.time <= seconds + 0.001) best = cue; else break;
    }
    return this.header.segmentStart + best.position;
  }

  async handleSeek() {
    if (this.destroyed || !this.header) return;
    // A change of audio track is already on its way to re-read the file
    // from wherever the picture is, and it reads the position after
    // dropping the sound — so it lands on this seek's target by itself.
    // Letting the seek in as well would leave two pumps on one connection.
    if (this.switching) return;
    const target = this.video.currentTime;
    if (this.isBuffered(target)) return;

    // The generation is bumped before the first await. Fetching the seek
    // table takes the single connection, at which point the running pump
    // sees the stream end — being stale it no longer finishes the file with
    // endOfStream, which would clamp the duration to the end of the buffer
    // and wreck this very seek.
    const generation = ++this.generation;
    this.closeConnection();

    let offset = await this.clusterFor(target);
    if (this.destroyed || generation !== this.generation) return;
    if (offset == null) {
      // No seek table, or one that could not be read. The connection is
      // already cut and the old pump is stale, so something has to be
      // pumped or the picture stops at the end of the buffer for good.
      // Without the table the file is read through to the target: from the
      // current cluster when the target is ahead, from the start when it is
      // behind. Slow, but it arrives — and the viewer is told why.
      offset = target >= this.state.lastPts && this.clusterAt != null ? this.clusterAt : 0;
      // A table that is not there is said once. One that could not be
      // read just now is said once too, in its own words: the next seek
      // asks for it again (see fetchCues), and is quick again if it comes.
      if (this.cuesTried && !this.noticedCues) {
        this.noticedCues = true;
        this.onNotice(t('remux.nocues'));
      } else if (!this.cuesTried && !this.noticedCuesFailed) {
        this.noticedCuesFailed = true;
        this.onNotice(t('remux.cuesfailed'));
      }
    }
    // Drop the old segments around the seek point, or the buffer
    // fragments.
    await this.clear();
    if (this.destroyed || generation !== this.generation) return;
    this.sequence++;
    this.audioDts = null;
    this.resumes = 0;
    this.startPump(offset, generation);
  }

  isBuffered(time) {
    const ranges = timeRanges(this.buffers.video);
    if (!ranges) return false;
    for (let i = 0; i < ranges.length; i++) {
      if (time >= ranges.start(i) && time < ranges.end(i) - 0.5) return true;
    }
    return false;
  }

  async clear() {
    await this.remove('video', () => [0, Infinity]);
    await this.remove('audio', () => [0, Infinity]);
  }
}

/**
 * Removes a stretch of a buffer and waits for it to be gone. Never throws:
 * a buffer that cannot be read or has left its MediaSource has nothing to
 * remove.
 */
function removeNow(sb, from, to) {
  if (!timeRanges(sb)) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { sb.removeEventListener('updateend', done); resolve(); };
    sb.addEventListener('updateend', done);
    try { sb.remove(from, to); } catch { done(); }
  });
}

/* ------------------------------------------------------------- helpers */

const formatClock = (seconds) => {
  const total = Math.max(0, Math.round(seconds));
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
};

/**
 * A step of a download with a stall limit: reader.read() or the fetch
 * itself. Past the limit the controller is aborted, so the underlying
 * request ends too, and the rejection says why.
 */
function within(promise, ctrl, ms = STALL_MS) {
  let timer;
  const stalled = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(Object.assign(new Error('the download stalled'), { stalled: true }));
      try { ctrl.abort(); } catch { /* already closed */ }
    }, ms);
  });
  return Promise.race([promise, stalled]).finally(() => clearTimeout(timer));
}

/** How far a buffer's ranges reach past a moment, 0 when they do not cover it. */
function aheadIn(ranges, now) {
  if (!ranges) return 0;
  for (let i = 0; i < ranges.length; i++) {
    if (now >= ranges.start(i) - 0.5 && now <= ranges.end(i)) return ranges.end(i) - now;
  }
  // The playback position is outside the buffer: data is needed at once,
  // and the distance to some other range must not slow the download.
  return 0;
}

/**
 * A SourceBuffer's ranges, or null when the buffer cannot be read. When the
 * MediaSource closes, buffered throws — which happens normally when
 * playback is stopped mid-download.
 */
function timeRanges(sb) {
  if (!sb) return null;
  try {
    const ranges = sb.buffered;
    return ranges.length ? ranges : null;
  } catch {
    return null;
  }
}

/**
 * An AAC frame's length in samples. The difference between individual
 * timestamps would be unreliable because of millisecond rounding, so it is
 * computed over a long interval and rounded to the nearest standard value.
 */
function nominalFrame(list, rate) {
  if (list.length < 8) return 1024;
  const span = list[list.length - 1].pts - list[0].pts;
  const average = (span * rate) / 1e9 / (list.length - 1);
  let best = 1024;
  let distance = Infinity;
  for (const candidate of AAC_FRAME_LENGTHS) {
    const d = Math.abs(candidate - average);
    if (d < distance) { distance = d; best = candidate; }
  }
  return best;
}

/** CuePoint → { time (s), position (from the segment start) } for the
 *  video track. */
function parseCues(bytes, timestampScale, trackNumber) {
  const out = [];
  const r = new Reader(bytes);
  const first = r.vint(true);
  if (!first || first.value !== ID.Cues) return null;
  const size = r.vint(false);
  if (!size) return null;
  const end = size.unknown ? bytes.length : Math.min(bytes.length, r.p + size.value);

  while (r.p < end) {
    const id = r.vint(true);
    if (!id) break;
    const length = r.vint(false);
    if (!length) break;
    const start = r.p;
    const stop = Math.min(end, start + length.value);
    if (id.value === ID.CuePoint) {
      let time = null;
      let position = null;
      const inner = new Reader(bytes, start, stop);
      while (inner.p < stop) {
        const innerId = inner.vint(true);
        if (!innerId) break;
        const innerSize = inner.vint(false);
        if (!innerSize) break;
        const innerStart = inner.p;
        const innerStop = Math.min(stop, innerStart + innerSize.value);
        if (innerId.value === ID.CueTime) time = inner.uint(innerSize.value);
        else if (innerId.value === ID.CueTrackPositions) {
          let track = null;
          let cluster = null;
          const deep = new Reader(bytes, innerStart, innerStop);
          while (deep.p < innerStop) {
            const deepId = deep.vint(true);
            if (!deepId) break;
            const deepSize = deep.vint(false);
            if (!deepSize) break;
            if (deepId.value === ID.CueTrack) track = deep.uint(deepSize.value);
            else if (deepId.value === ID.CueClusterPosition) cluster = deep.uint(deepSize.value);
            deep.p += deepSize.value;
          }
          if (cluster != null && (track == null || track === trackNumber)) position = cluster;
        }
        inner.p = innerStop;
      }
      if (time != null && position != null) {
        out.push({ time: (time * timestampScale) / 1e9, position });
      }
    }
    r.p = stop;
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}
