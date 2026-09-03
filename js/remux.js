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
import { videoMime, passthroughMime } from './probe.js';
import { decodable } from './ffaudio.js';
import { AudioTranscoder, encoderSetup, RATE as DECODED_RATE, CHANNELS as DECODED_CHANNELS } from './transcode.js';
import { SubtitleTracks, isTextSubtitle, preferred } from './subs.js';

const HEADER_BYTES = 256 * 1024;
const CUES_BYTES = 4 * 1024 * 1024;

// How far ahead to buffer before the download waits.
const BUFFER_AHEAD = 60;
// How much of what has been watched is left behind before cleaning up.
const BUFFER_BEHIND = 30;
const MAX_PENDING_BYTES = 8 * 1024 * 1024;

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
   * @param {{onError:Function, onFirstAppend:Function, onNotice:Function,
   *          onSubtitles:Function, startAt:number, subtitleLang:string|null}} opts
   */
  constructor(video, url, {
    onError, onFirstAppend, onNotice, onSubtitles, startAt = 0, subtitleLang = null,
  } = {}) {
    this.video = video;
    this.url = url;
    this.onError = onError || (() => {});
    this.onFirstAppend = onFirstAppend || (() => {});
    this.onNotice = onNotice || (() => {});
    this.onSubtitles = onSubtitles || (() => {});
    this.startAt = startAt;
    this.subtitleLang = subtitleLang;

    this.ms = null;
    this.objectUrl = null;
    this.connection = null;
    this.generation = 0;          // bumped on seek, invalidates the old pump
    this.destroyed = false;

    this.header = null;
    this.videoTrack = null;
    this.audioTrack = null;
    this.decodeTrack = null;      // the track we decode ourselves, when one is needed
    this.transcoder = null;
    this.subs = null;             // SubtitleTracks, when there are text tracks
    this.subtitleList = [];
    this.buffers = { video: null, audio: null };
    this.queues = { video: Promise.resolve(), audio: Promise.resolve() };
    this.sequence = 1;
    this.audioNominal = 1024;
    this.audioDts = null;
    this.cues = null;
    this.cuesTried = false;
    this.stream = null;
    this.started = false;
    this.onSeeking = () => this.handleSeek();
    this.onPause = () => this.resumeSilent();
    this.silentResumes = 0;
    this.state = { phase: 'alku', pending: 0, lastPts: 0, segments: 0, reading: false, resumes: 0 };
    this.clusterAt = null;        // where the latest cluster sits in the file
    this.resumes = 0;
  }

  /* ------------------------------------------------------------ elinkaari */

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
    this.pump(offset, generation).catch((err) => this.fail(err));
  }

  destroy() {
    this.destroyed = true;
    this.generation++;
    this.video.removeEventListener('seeking', this.onSeeking);
    this.video.removeEventListener('pause', this.onPause);
    if (this.subs) { this.subs.destroy(); this.subs = null; }
    if (this.transcoder) { this.transcoder.close(); this.transcoder = null; }
    this.subtitleList = [];
    if (this.stream) {
      try { this.stream.ctrl.abort(); } catch { /* jo suljettu */ }
      this.stream = null;
    }
    this.closeConnection();
    try {
      if (this.ms && this.ms.readyState === 'open') this.ms.endOfStream();
    } catch { /* jo suljettu */ }
    if (this.objectUrl) { URL.revokeObjectURL(this.objectUrl); this.objectUrl = null; }
    this.ms = null;
  }

  fail(err) {
    if (this.destroyed) return;
    if (err && err.name === 'AbortError') return;
    console.warn('[iptv] remux failed', err);
    this.onError(err);
  }

  /* -------------------------------------------------------------- verkko */

  closeConnection() {
    const open = this.connection;
    this.connection = null;
    if (open) { try { open.abort(); } catch { /* jo suljettu */ } }
  }

  /** One download at a time: the previous one is always cut first. */
  async openRange(from, to) {
    this.closeConnection();
    if (this.stream) {
      try { this.stream.ctrl.abort(); } catch { /* jo suljettu */ }
      this.stream = null;
    }
    const ctrl = new AbortController();
    this.connection = ctrl;
    const range = to != null ? `bytes=${from}-${to}` : `bytes=${from}-`;
    const res = await fetch(this.url, {
      signal: ctrl.signal, cache: 'no-store', credentials: 'omit', headers: { Range: range },
    });
    if (!res.ok) throw new Error(`the server answered ${res.status}`);
    return { res, ctrl };
  }

  async readRange(from, to) {
    const { res, ctrl } = await this.openRange(from, to);
    const reader = res.body.getReader();
    const parts = [];
    let total = 0;
    const cap = to != null ? to - from + 1 : Infinity;
    while (total < cap) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      total += value.byteLength;
    }
    try { ctrl.abort(); } catch { /* the body had already ended */ }
    if (this.connection === ctrl) this.connection = null;
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
    const { res, ctrl } = await this.openRange(0, null);
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    while (total < HEADER_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
    }
    const bytes = new Uint8Array(total);
    let at = 0;
    for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }

    const header = parseHeader(bytes);
    if (!header.ok) {
      try { ctrl.abort(); } catch { /* jo suljettu */ }
      throw new Error('no track data found');
    }
    this.stream = { reader, ctrl, chunks, offset: 0 };
    this.header = header;

    const tracks = header.tracks;
    this.videoTrack = tracks.find((t) => t.type === 1 && videoMime(t)) || null;
    // A file may hold several audio tracks — take the first one that can go
    // to MediaSource as it is (AAC, see passthroughMime). This is exactly
    // what saves discs carrying both AC-3 and AAC: the default track alone
    // would often be the wrong one, and an untouched track always beats a
    // re-encoded one.
    this.audioTrack = tracks.find((t) => t.type === 2 && supportedAudio(t)) || null;
    // Otherwise a track we decode ourselves. Of the 45 measured ac3/eac3
    // episodes not one had an alternative track, so without this they would
    // be left silent.
    this.decodeTrack = this.audioTrack ? null
      : tracks.find((t) => t.type === 2 && decodable(t.codecId)) || null;
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
      // For a decoded track the format is transcode.js's fixed stereo
      // 48 kHz rather than the original track's, and the codec is whichever
      // encoder the browser has — AAC in Chrome, Opus in Firefox. The
      // AudioSpecificConfig comes from the encoder too, because Matroska's
      // CodecPrivate describes the decoded format, not the encoded one.
      const decoded = Boolean(this.transcoder);
      const rate = decoded ? DECODED_RATE : (this.audioTrack.outputRate || this.audioTrack.rate || 48000);
      const mime = decoded ? this.transcoder.mime : passthroughMime(this.audioTrack.codecId);
      this.buffers.audio = this.ms.addSourceBuffer(`audio/mp4; codecs="${mime}"`);
      this.buffers.audio.mode = 'segments';
      this.append('audio', initSegment([{
        id: 2, kind: 'audio', timescale: rate, codec: decoded ? this.transcoder.codec : 'aac',
        priv: decoded ? this.transcoder.description : this.audioTrack.priv,
        channels: decoded ? DECODED_CHANNELS : this.audioTrack.channels,
        rate,
      }]));
    }
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
    this.transcoder.close();
    this.transcoder = null;
    const sb = this.buffers.audio;
    this.buffers.audio = null;
    try { if (sb && this.ms && this.ms.readyState === 'open') this.ms.removeSourceBuffer(sb); } catch { /* playback continues regardless */ }
    this.onNotice(t('remux.audiostopped'));
  }

  /**
   * The subtitle tracks for the element, with the one matching the language
   * choice shown. The tracks are created before the first cluster, so the
   * selector is in place the moment the picture starts — the cues trickle in
   * as the demuxing goes on.
   */
  setupSubtitles() {
    const tracks = this.header.tracks.filter(isTextSubtitle);
    if (!tracks.length) { this.report([], null); return; }
    // The callback fires only for a change that came from outside the app
    // — from the browser's own subtitle menu — because select() has already
    // recorded its own choice.
    this.subs = new SubtitleTracks(this.video, (active) => this.report(this.subtitleList, active, true));
    this.subtitleList = this.subs.setup(tracks);
    this.report(this.subtitleList, this.subs.select(preferred(this.subtitleList, this.subtitleLang)));
  }

  report(tracks, active, external = false) {
    if (this.destroyed) return;
    this.onSubtitles({ tracks, active, external });
  }

  /** Changing track from the viewer's choice. null hides the subtitles. */
  selectSubtitle(number) {
    if (!this.subs) return null;
    const active = this.subs.select(number);
    this.report(this.subtitleList, active);
    return active;
  }

  /** Appends queued per track: a SourceBuffer accepts one at a time. */
  append(kind, data) {
    const sb = this.buffers[kind];
    if (!sb) return Promise.resolve();
    const generation = this.generation;
    this.queues[kind] = this.queues[kind].then(async () => {
      if (this.destroyed || generation !== this.generation || !this.ms || this.ms.readyState !== 'open') return;
      try {
        await this.appendOnce(sb, data);
      } catch (err) {
        if (err && err.name === 'QuotaExceededError') {
          await this.evict(kind, true);
          try { await this.appendOnce(sb, data); } catch (retry) { this.fail(retry); }
        } else this.fail(err);
      }
    });
    return this.queues[kind];
  }

  appendOnce(sb, data) {
    return new Promise((resolve, reject) => {
      const done = () => { sb.removeEventListener('updateend', done); sb.removeEventListener('error', bad); resolve(); };
      const bad = () => { sb.removeEventListener('updateend', done); sb.removeEventListener('error', bad); reject(new Error('SourceBuffer rejected the segment')); };
      sb.addEventListener('updateend', done);
      sb.addEventListener('error', bad);
      try { sb.appendBuffer(data); } catch (err) { bad(); reject(err); }
    });
  }

  /** Removes the watched part from the buffer, so memory does not grow
   *  without bound. */
  async evict(kind, aggressive = false) {
    const sb = this.buffers[kind];
    const ranges = timeRanges(sb);
    if (!ranges) return;
    const now = this.video.currentTime;
    const keepFrom = Math.max(0, now - (aggressive ? 5 : BUFFER_BEHIND));
    const start = ranges.start(0);
    if (keepFrom - start < 5) return;
    await new Promise((resolve) => {
      const done = () => { sb.removeEventListener('updateend', done); resolve(); };
      sb.addEventListener('updateend', done);
      try { sb.remove(start, keepFrom); } catch { done(); }
    });
  }

  /* ---------------------------------------------------------------- pumppu */

  /**
   * Reads the file from the given offset, demuxes the clusters and feeds the
   * segments onward. The generation invalidates the run if a seek gets in
   * between.
   */
  async pump(offset, generation) {
    let reader;
    let ctrl;
    const bytes = new BufferedBytes();
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
          const { done, value } = await reader.read();
          if (done) { complete = true; break; }
          bytes.push(value);
        }
      } catch (err) {
        this.state.netError = err && err.name ? `${err.name}: ${err.message}` : String(err);
        if (!(err && err.name === 'AbortError')) bytes.fail(err);
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
    let decodedFrames = 0;
    let broke = false;
    this.audioDts = null;
    // The resume point does not land on a frame boundary, and the audio
    // queued in the encoder no longer belongs at this point in the file.
    if (this.transcoder) await this.transcoder.restart();
    this.state.phase = 'purkaa';
    this.state.reading = true;

    try {
      for await (const frame of frames(bytes, { timestampScale: this.header.timestampScale, tracks, onCluster, onStop })) {
        if (this.destroyed || generation !== this.generation) break;
        this.state.pending = bytes.available;
        this.state.lastPts = frame.pts / 1e9;

        if (frame.track === videoNumber) {
          if (frame.keyframe && pendingVideo.length >= MIN_SEGMENT_FRAMES) {
            this.flushVideo(pendingVideo, generation);
            pendingVideo = [];
          }
          pendingVideo.push(frame);
        } else if (frame.track === audioNumber) {
          if (this.transcoder) {
            await this.transcoder.push(frame);
            if (++decodedFrames >= AUDIO_SEGMENT_FRAMES) {
              this.flushDecoded(generation);
              decodedFrames = 0;
            }
          } else {
            pendingAudio.push(frame);
            if (pendingAudio.length >= AUDIO_SEGMENT_FRAMES) {
              this.flushAudio(pendingAudio, rate, generation);
              pendingAudio = [];
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
      try { ctrl.abort(); } catch { /* jo suljettu */ }
      if (this.connection === ctrl) this.connection = null;
      await network.catch(() => {});
    }
    // Only after the connection is closed: the account allows one at a
    // time, so a new one must not be opened before the previous is
    // certainly shut.
    if (broke) await this.resume(generation);
  }

  /**
   * Resumes downloading from the start of the last complete cluster. A
   * successful resume clears the counter, so a long film survives several
   * drops — only consecutive failures stop the retrying.
   */
  async resume(generation) {
    if (this.resumes >= MAX_RESUMES) {
      this.state.phase = 'broke for good';
      this.onError(new Error('the download broke repeatedly'));
      return;
    }
    this.resumes++;
    this.state.resumes = this.resumes;
    const from = this.clusterAt;
    this.state.phase = `resuming from byte ${from} (${this.resumes}/${MAX_RESUMES})`;
    console.warn('[iptv] download broke, resuming from byte %d (%d/%d)', from, this.resumes, MAX_RESUMES);
    await new Promise((resolve) => setTimeout(resolve, RESUME_DELAY_MS * this.resumes));
    if (this.destroyed || generation !== this.generation) return;
    // The audio chain starts over, because the resume point does not land
    // on a frame boundary.
    this.audioDts = null;
    await this.pump(from, generation);
  }

  /** Waits until there is room in the buffer. Stops the whole file being
   *  downloaded. */
  async waitForRoom(bytes, generation) {
    for (;;) {
      if (this.destroyed || generation !== this.generation) return;
      const ahead = this.bufferedAhead();
      if (bytes.available < MAX_PENDING_BYTES && ahead < BUFFER_AHEAD) return;
      this.state.phase = `waiting for room (${Math.round(ahead)} s buffered, ${Math.round(bytes.available / 1024)} kB queued)`;
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

  bufferedAhead() {
    const sb = this.buffers.video;
    const ranges = timeRanges(sb);
    if (!ranges) return 0;
    const now = this.video.currentTime;
    for (let i = 0; i < ranges.length; i++) {
      if (now >= ranges.start(i) - 0.5 && now <= ranges.end(i)) return ranges.end(i) - now;
    }
    // The playback position is outside the buffer: data is needed at once,
    // and the distance to some other range must not slow the download.
    return 0;
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
    this.append('video', mediaSegment(this.sequence++, 1, samples));
    this.state.segments++;
    this.resumes = 0;
    if (!this.started) { this.started = true; this.onFirstAppend(); }
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

  /* ---------------------------------------------------------------- kelaus */

  /** The Cues table from the end of the file. Fetched once, and only if a
   *  seek happens. */
  async loadCues() {
    if (this.cues || this.cuesTried) return this.cues;
    this.cuesTried = true;
    if (this.header.cuesPosition == null) return null;
    const from = this.header.segmentStart + this.header.cuesPosition;
    try {
      const bytes = await this.readRange(from, from + CUES_BYTES - 1);
      this.cues = parseCues(bytes, this.header.timestampScale, this.videoTrack.number);
    } catch (err) {
      console.warn('[iptv] reading the seek table failed', err);
      this.cues = null;
    }
    return this.cues;
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
    if (started && started.catch) started.catch(() => { /* katsoja ehti painaa taukoa */ });
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
    const target = this.video.currentTime;
    if (this.isBuffered(target)) return;

    // The generation is bumped before the first await. Fetching the seek
    // table takes the single connection, at which point the running pump
    // sees the stream end — being stale it no longer finishes the file with
    // endOfStream, which would clamp the duration to the end of the buffer
    // and wreck this very seek.
    const generation = ++this.generation;
    this.closeConnection();

    const offset = await this.clusterFor(target);
    if (offset == null || this.destroyed || generation !== this.generation) return;
    // Drop the old segments around the seek point, or the buffer
    // fragments.
    await this.clear();
    if (this.destroyed || generation !== this.generation) return;
    this.sequence++;
    this.audioDts = null;
    this.resumes = 0;
    this.pump(offset, generation).catch((err) => this.fail(err));
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
    for (const kind of ['video', 'audio']) {
      const sb = this.buffers[kind];
      if (!timeRanges(sb)) continue;
      await new Promise((resolve) => {
        const done = () => { sb.removeEventListener('updateend', done); resolve(); };
        sb.addEventListener('updateend', done);
        try { sb.remove(0, this.ms.duration || Infinity); } catch { done(); }
      });
    }
    this.queues.video = Promise.resolve();
    this.queues.audio = Promise.resolve();
  }
}

/* ------------------------------------------------------------- apurit */

const formatClock = (seconds) => {
  const total = Math.max(0, Math.round(seconds));
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
};

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

// Only what the init segment can describe, see passthroughMime: AAC.
const supportedAudio = (track) => {
  const mime = passthroughMime(track.codecId);
  if (!mime) return false;
  try { return MediaSource.isTypeSupported(`audio/mp4; codecs="${mime}"`); } catch { return false; }
};

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
