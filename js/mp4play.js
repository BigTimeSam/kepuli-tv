// @ts-check
// Playing an MP4 film through MediaSource, for Firefox.
//
// Firefox upgrades an extension page's http:// media to https:// and does
// not fall back (see js/mp4file.js), so a film on a provider's plain-HTTP
// port never opens in <video>. fetch() is not upgraded: the file is read
// here, its index (moov) turned into sample tables, and the samples cut out
// of the media (mdat) and appended as fragments — the container changes,
// the picture and the sound are passed on untouched.
//
// The shape follows js/remux.js, for the same reasons:
//
// - The account allows one connection: there is one download at a time,
//   and seeking cuts it before it opens another. The request that reads a
//   fast-start file's index goes on into its media.
// - A provider goes on counting a closed connection for a few seconds, so
//   a request that follows one of ours may be refused: it is asked again on
//   growing delays, as a break in the download is resumed.
// - The download reads a minute ahead of the picture, less at a high bit
//   rate, and the watched part is dropped behind it; a full buffer is
//   waited out rather than reported.
//
// Seeking is simpler than in Matroska: the index says where every sample
// lies. A seek reads from the keyframe at or before the target.

import { t } from './i18n.js';
import { initSegment, mediaSegment } from './mp4.js';
import { boxHeader, parseMoov } from './mp4file.js';
import { emptyAnswer, fetchRange, within } from './probe.js';

const BUFFER_AHEAD = 60;
const BUFFER_BEHIND = 30;
const BUFFER_BYTES = 90 * 1024 * 1024;
const MIN_AHEAD = 10;
const MIN_BEHIND = 5;
const MAX_QUEUED_BYTES = 16 * 1024 * 1024;
const QUOTA_RETRY_MS = 1000;
const MIN_SEGMENT_FRAMES = 48;
const AUDIO_SEGMENT_SAMPLES = 100;
const MAX_RESUMES = 6;
const RESUME_DELAY_MS = 700;
// An index larger than this is not a film's: a two-hour film's is a few
// megabytes.
const MAX_MOOV_BYTES = 64 * 1024 * 1024;
const MAX_HOPS = 16;

export class Mp4Player {
  /**
   * @param {HTMLVideoElement} video
   * @param {string} url
   * @param {{onError?:Function, onFirstAppend?:Function, onNotice?:Function,
   *          onOpen?:Function, onAnswer?:Function, startAt?:number}} [opts]
   *
   * onAnswer() is called as the server answers a request, before its bytes.
   */
  constructor(video, url, { onError, onFirstAppend, onNotice, onOpen, onAnswer, startAt = 0 } = {}) {
    this.video = video;
    this.url = url;
    this.onError = onError || (() => {});
    this.onFirstAppend = onFirstAppend || (() => {});
    this.onNotice = onNotice || (() => {});
    this.onOpen = onOpen || (() => {});
    this.onAnswer = onAnswer || (() => {});
    this.startAt = startAt;
    this.opened = false;
    this.destroyed = false;
    this.generation = 0;
    this.connection = null;
    this.tracks = [];
    this.queues = [Promise.resolve(), Promise.resolve()];
    this.queued = 0;
    this.quotaWaits = 0;
    this.quotaAhead = Infinity;
    this.resumes = 0;
    this.appended = false;
    this.from = null;             // where the running download started, see handleSeek
    this.onSeeking = () => this.handleSeek();
    // For the player's account of the start-up, see progress().
    this.received = 0;
    this.step = null;
    this.bitrate = null;
    this.countBytes = (n) => { this.received += n; };
  }

  /**
   * What the download has come to: the bytes read; the step of the start
   * under way, each of a size known to the byte — the index ('index'),
   * whose box header gives it, then the media up to the samples that
   * complete the first segment of each track ('media'), which the index
   * gives; and the film's bit rate, from the index.
   */
  progress() {
    return { loaded: this.received, ...this.step, bitrate: this.bitrate };
  }

  /** A step of the start: `size` bytes from here, `held` of them already in. */
  stepOf(stage, size, held = 0) {
    const from = this.received - held;
    this.step = { stage, from, need: from + Math.max(0, size) };
  }

  /**
   * Where in the file the start's reading ends: at the sample that
   * completes the first video segment (the keyframe after
   * MIN_SEGMENT_FRAMES) and the first audio segment, whichever lies later.
   */
  startEnd(plan) {
    const video = this.tracks[0];
    let v = plan.skip[0] + MIN_SEGMENT_FRAMES;
    while (v < video.count && video.sync && !video.sync[v]) v++;
    v = Math.min(v, video.count - 1);
    let end = video.offset[v] + video.size[v];
    const audio = this.tracks[1];
    if (audio && audio.count) {
      const a = Math.min(plan.skip[1] + AUDIO_SEGMENT_SAMPLES, audio.count - 1);
      end = Math.max(end, audio.offset[a] + audio.size[a]);
    }
    return end;
  }

  /** Whether the download is between connections, see Remuxer.recovering. */
  get recovering() { return this.resumes > 0; }

  async start() {
    this.ms = new MediaSource();
    this.objectUrl = URL.createObjectURL(this.ms);
    const open = new Promise((resolve) => this.ms.addEventListener('sourceopen', resolve, { once: true }));
    this.video.src = this.objectUrl;
    await open;
    if (this.destroyed) return;

    const { moov, stream } = await this.readIndex();
    if (this.destroyed) { if (stream) stream.close(); return; }
    const movie = parseMoov(moov);
    this.chooseTracks(movie);

    const generation = ++this.generation;
    if (movie.duration) {
      try { this.ms.duration = movie.duration; } catch (err) { console.warn('[iptv] setting the duration failed', err); }
    }
    for (const track of this.tracks) {
      track.sb = this.ms.addSourceBuffer(track.mime);
      this.append(track, initSegment([{
        id: 1, kind: track.kind, timescale: track.timescale, entry: track.entry,
        width: track.width, height: track.height,
      }]), generation);
    }
    this.buildOrder();
    this.video.addEventListener('seeking', this.onSeeking);
    if (movie.duration > 0) {
      let bytes = 0;
      for (const track of this.tracks) for (let i = 0; i < track.count; i++) bytes += track.size[i];
      this.bitrate = (bytes * 8) / movie.duration;
    }

    if (this.startAt > 1) {
      // The resume point: read from its keyframe, and the picture moved
      // there once something is buffered (see append).
      if (stream) stream.close();
      this.video.currentTime = this.startAt;
      const plan = this.plan(this.startAt);
      this.stepOf('media', this.startEnd(plan) - this.offsetAt(plan.pos));
      this.run(plan, generation);
    } else {
      const plan = { pos: 0, skip: this.tracks.map(() => 0) };
      const end = this.startEnd(plan);
      if (stream) this.stepOf('media', end - stream.pos, stream.have);
      else this.stepOf('media', end - this.offsetAt(0));
      this.run(plan, generation, stream);
    }
  }

  destroy() {
    this.destroyed = true;
    this.generation++;
    this.video.removeEventListener('seeking', this.onSeeking);
    this.closeConnection();
    try {
      if (this.ms && this.ms.readyState === 'open') this.ms.endOfStream();
    } catch { /* already closed */ }
    if (this.objectUrl) { URL.revokeObjectURL(this.objectUrl); this.objectUrl = null; }
    this.ms = null;
  }

  fail(err) {
    if (this.destroyed || (err && err.name === 'AbortError')) return;
    console.warn('[iptv] MP4 playback failed', err);
    this.onError(err);
  }

  /* -------------------------------------------------------------- tracks */

  /**
   * The first video track the browser plays, and the first such audio
   * track. A film whose sound the browser cannot play plays without it,
   * and is said to.
   */
  chooseTracks(movie) {
    const playable = (track) => track.codec && MediaSource.isTypeSupported(this.mimeOf(track));
    const video = movie.tracks.find((tr) => tr.kind === 'video' && playable(tr));
    if (!video) {
      const found = movie.tracks.find((tr) => tr.kind === 'video');
      throw new Error(found ? `the video format ${found.codec || found.format} is not supported` : 'no video track found');
    }
    const audio = movie.tracks.find((tr) => tr.kind === 'audio' && playable(tr));
    if (!audio && movie.tracks.some((tr) => tr.kind === 'audio')) this.onNotice(t('remux.noaudio'));
    this.tracks = [video, audio].filter(Boolean).map((track) => ({ ...track, mime: this.mimeOf(track) }));
    this.movieDuration = movie.duration;
    const bytes = this.tracks.reduce((sum, tr) => sum + tr.size.reduce((a, b) => a + b, 0), 0);
    this.bytesPerSecond = movie.duration > 0 ? bytes / movie.duration : 0;
  }

  mimeOf(track) {
    return `${track.kind === 'video' ? 'video' : 'audio'}/mp4; codecs="${track.codec}"`;
  }

  /**
   * Every sample of the chosen tracks in the order it lies in the file,
   * and each sample's place in that order — the download reads the file
   * once, front to back, and takes what belongs to the tracks.
   */
  buildOrder() {
    const total = this.tracks.reduce((sum, tr) => sum + tr.count, 0);
    this.orderTrack = new Uint8Array(total);
    this.orderIndex = new Uint32Array(total);
    this.posOf = this.tracks.map((tr) => new Uint32Array(tr.count));
    const next = this.tracks.map(() => 0);
    for (let pos = 0; pos < total; pos++) {
      let best = -1;
      for (let k = 0; k < this.tracks.length; k++) {
        if (next[k] >= this.tracks[k].count) continue;
        if (best < 0 || this.tracks[k].offset[next[k]] < this.tracks[best].offset[next[best]]) best = k;
      }
      this.orderTrack[pos] = best;
      this.orderIndex[pos] = next[best];
      this.posOf[best][next[best]] = pos;
      next[best]++;
    }
    // The video track's keyframes and their times, for seeking.
    const video = this.tracks[0];
    const keys = [];
    for (let i = 0; i < video.count; i++) if (!video.sync || video.sync[i]) keys.push(i);
    this.keyIndex = Uint32Array.from(keys);
    this.keyTime = Float64Array.from(keys, (i) => this.timeOf(video, i));
  }

  /** Where the sample at a place in the file order lies. */
  offsetAt(pos) {
    return this.tracks[this.orderTrack[pos]].offset[this.orderIndex[pos]];
  }

  /** A sample's presentation time in seconds. */
  timeOf(track, i) {
    return (track.dts[i] + track.cts[i] - track.shift) / track.timescale;
  }

  /**
   * Where to read from to play from `time`: the keyframe at or before it,
   * and the sound from that keyframe's moment. The samples of either track
   * that lie in the file before its own starting point are passed over.
   */
  plan(time) {
    let lo = 0;
    let hi = this.keyTime.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.keyTime[mid] <= time + 0.01) lo = mid; else hi = mid - 1;
    }
    const skip = [this.keyIndex[lo]];
    let pos = this.posOf[0][skip[0]];
    const audio = this.tracks[1];
    if (audio) {
      const from = this.keyTime[lo];
      let a = 0;
      let b = audio.count - 1;
      while (a < b) {
        const mid = (a + b) >> 1;
        if ((audio.dts[mid] - audio.shift) / audio.timescale + audio.duration[mid] / audio.timescale <= from) a = mid + 1; else b = mid;
      }
      skip.push(a);
      pos = Math.min(pos, this.posOf[1][a]);
    }
    return { pos, skip };
  }

  /* ------------------------------------------------------------- network */

  closeConnection() {
    const open = this.connection;
    this.connection = null;
    if (open) open.abort();
  }

  /**
   * One request, the previous one cut first. A refusal or a failed
   * connection is marked as such: most often it is the provider still
   * counting the request just closed, and worth asking again.
   */
  async open(from, to = null) {
    if (this.destroyed) throw new DOMException('the player is gone', 'AbortError');
    this.closeConnection();
    const ctrl = new AbortController();
    this.connection = ctrl;
    this.onOpen(this.opened);
    this.opened = true;
    const res = await fetchRange(this.url, ctrl, from, to, () => this.onAnswer());
    // A server that ignores the range sends the file from its start; it is
    // read through to the place, slowly but correctly.
    const stream = new ByteStream(res.body.getReader(), ctrl, res.status === 206 || from === 0 ? from : 0, this.countBytes);
    if (stream.pos < from && !(await stream.skip(from - stream.pos))) throw Object.assign(new Error('the file ended early'), { connection: true });
    return stream;
  }

  /** open(), asked again on growing delays while the connection is what fails. */
  async openAgain(from, to, generation) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.open(from, to);
      } catch (err) {
        // The first request is not asked again (see readIndex); after it a
        // file server's refusal is, like a connection's: the file was there.
        if (!err || !(err.connection || err.unavailable) || this.destroyed || generation !== this.generation || attempt >= MAX_RESUMES) throw err;
        console.warn('[iptv] the MP4 request could not be opened, asking again', err);
        await sleep(RESUME_DELAY_MS * (attempt + 1));
        if (this.destroyed || generation !== this.generation) throw new DOMException('superseded', 'AbortError');
      }
    }
  }

  /**
   * The index, and — when it comes before the media — the open download
   * positioned after it, for the media to follow on the same connection.
   * An index at the end is found by stepping from box header to box header.
   */
  async readIndex() {
    const generation = this.generation;
    // The first request is not asked again here: refused, it goes to the
    // player's account check and its wait for the release, as the MKV
    // unpacker's header read does.
    const stream = await this.open(0);
    if (!(await stream.fill(16))) {
      stream.close();
      if (emptyAnswer(stream.peek(stream.have))) {
        throw Object.assign(new Error(t('probe.empty')), { empty: true });
      }
    }
    let at = 0;
    for (let hop = 0; hop < MAX_HOPS; hop++) {
      if (!(await stream.fill(16))) break;
      const header = boxHeader(stream.peek(16), 0);
      if (!header || header.size < header.header) break;
      // Not a box at all: the file is not MP4 whatever its name says —
      // measured, a provider's ".mp4" was MPEG-TS, whose first bytes read
      // as a 1.2 GB box and sent the index search past the file's end.
      if (!/^[\x20-\x7e]{4}$/.test(header.type)) break;
      if (header.type === 'moov') {
        if (header.size > MAX_MOOV_BYTES) break;
        this.stepOf('index', header.size, stream.have);
        const moov = await stream.take(header.size);
        if (!moov) break;
        return { moov, stream };
      }
      if (header.type === 'mdat' || header.size > 4 * 1024 * 1024) {
        // The media first: the index lies past it.
        stream.close();
        if (!Number.isFinite(header.size)) break;
        return { moov: await this.indexAt(at + header.size, generation), stream: null };
      }
      if (!(await stream.skip(header.size))) break;
      at += header.size;
    }
    stream.close();
    throw new Error('no MP4 index (moov) found');
  }

  async indexAt(at, generation) {
    for (let hop = 0; hop < MAX_HOPS; hop++) {
      const head = await this.readRange(at, at + 15, generation);
      const header = head && boxHeader(head, 0);
      if (!header || header.size < header.header) break;
      if (header.type === 'moov') {
        if (header.size > MAX_MOOV_BYTES) break;
        this.stepOf('index', header.size);
        const moov = await this.readRange(at, at + header.size - 1, generation);
        if (moov && moov.length === header.size) return moov;
        break;
      }
      at += header.size;
    }
    throw new Error('no MP4 index (moov) found');
  }

  async readRange(from, to, generation) {
    const stream = await this.openAgain(from, to, generation);
    try {
      await stream.fill(to - from + 1);
      return stream.take(Math.min(stream.have, to - from + 1));
    } finally {
      stream.close();
    }
  }

  /* ---------------------------------------------------------------- pump */

  /** A download from a plan; whatever stops it is resumed or reported. */
  run(plan, generation, stream = null) {
    this.from = plan.pos;
    this.pump(plan, generation, stream).catch((err) => this.fail(err));
  }

  /**
   * Reads the samples in file order from plan.pos and feeds them on. A
   * break in the download is resumed from the oldest sample not yet fed —
   * a group of pictures is fed whole or not at all, since a decoder given
   * half of one fails.
   */
  async pump(plan, generation, stream) {
    const stale = () => this.destroyed || generation !== this.generation;
    const total = this.orderTrack.length;
    let pos = plan.pos;
    const pending = this.tracks.map(() => []);
    const pendingFrom = this.tracks.map(() => null);
    const flush = (k) => {
      if (!pending[k].length) return;
      this.append(this.tracks[k], mediaSegment(this.sequence = (this.sequence || 0) + 1, 1, pending[k]), generation);
      pending[k] = [];
      pendingFrom[k] = null;
    };
    let broke = null;
    try {
      if (!stream) {
        const off = this.tracks[this.orderTrack[pos]].offset[this.orderIndex[pos]];
        stream = await this.openAgain(off, null, generation);
      }
      if (stale()) return;
      for (; pos < total; pos++) {
        if (stale()) return;
        await this.waitForRoom(generation);
        if (stale()) return;
        const k = this.orderTrack[pos];
        const i = this.orderIndex[pos];
        const track = this.tracks[k];
        const off = track.offset[i];
        if (off < stream.pos) continue;        // overlaps one already read
        if (!(await stream.skip(off - stream.pos))) { broke = 'ended'; break; }
        const data = await stream.take(track.size[i]);
        if (!data) { broke = 'ended'; break; }
        if (i < plan.skip[k]) continue;
        this.resumes = 0;
        const sample = {
          data, dts: track.dts[i], cts: track.cts[i] - track.shift, duration: track.duration[i],
          keyframe: !track.sync || track.sync[i] === 1,
        };
        if (track.kind === 'video') {
          if (sample.keyframe && pending[k].length >= MIN_SEGMENT_FRAMES) flush(k);
        } else if (pending[k].length >= AUDIO_SEGMENT_SAMPLES) {
          flush(k);
        }
        if (pendingFrom[k] == null) pendingFrom[k] = pos;
        pending[k].push(sample);
      }
    } catch (err) {
      if (stale()) return;
      broke = err;
    } finally {
      if (stream) stream.close();
    }
    if (stale()) return;
    if (!broke) {
      this.tracks.forEach((_, k) => flush(k));
      await Promise.all(this.queues);
      if (stale()) return;
      try { if (this.ms.readyState === 'open') this.ms.endOfStream(); } catch { /* already closed */ }
      return;
    }
    // Resumed from the oldest sample that did not go in.
    const from = Math.min(pos, ...pendingFrom.filter((p) => p != null));
    if (this.resumes >= MAX_RESUMES) {
      const cause = broke instanceof Error ? broke.message : t('playback.reason.network');
      this.fail(new Error(t('playback.reason.broke', { count: this.resumes, cause })));
      return;
    }
    this.resumes++;
    console.warn('[iptv] MP4 download broke, resuming (%d/%d)', this.resumes, MAX_RESUMES, broke);
    await sleep(RESUME_DELAY_MS * this.resumes);
    if (stale()) return;
    this.pump({ pos: from, skip: plan.skip }, generation, null).catch((err) => this.fail(err));
  }

  /** A seek outside the buffer reads from the target's keyframe. */
  handleSeek() {
    if (this.destroyed || !this.orderTrack) return;
    const target = this.video.currentTime;
    if (this.isBuffered(target)) return;
    const plan = this.plan(target);
    if (plan.pos === this.from && this.reading()) return;
    const generation = ++this.generation;
    this.closeConnection();
    this.resumes = 0;
    this.run(plan, generation);
  }

  /** Whether the running download has not got past its start yet. */
  reading() {
    return Boolean(this.connection);
  }

  isBuffered(time) {
    return this.tracks.every((track) => {
      const ranges = timeRanges(track.sb);
      if (!ranges) return false;
      for (let i = 0; i < ranges.length; i++) if (time >= ranges.start(i) && time < ranges.end(i) - 0.3) return true;
      return false;
    });
  }

  /* -------------------------------------------------------------- buffer */

  readAhead() {
    let ahead = BUFFER_AHEAD;
    let behind = BUFFER_BEHIND;
    if (this.bytesPerSecond > 0) {
      const fits = BUFFER_BYTES / this.bytesPerSecond;
      behind = Math.min(BUFFER_BEHIND, Math.max(MIN_BEHIND, fits / 4));
      ahead = Math.min(BUFFER_AHEAD, Math.max(MIN_AHEAD, fits - behind));
    }
    return { ahead: Math.min(ahead, this.quotaAhead), behind };
  }

  bufferedAhead() {
    const now = this.video.currentTime;
    const each = this.tracks.map((track) => {
      const ranges = timeRanges(track.sb);
      if (!ranges) return 0;
      for (let i = 0; i < ranges.length; i++) {
        if (now >= ranges.start(i) - 0.5 && now <= ranges.end(i)) return ranges.end(i) - now;
      }
      return 0;
    });
    return each.length ? Math.min(...each) : 0;
  }

  async waitForRoom(generation) {
    for (;;) {
      if (this.destroyed || generation !== this.generation) return;
      if (this.bufferedAhead() < this.readAhead().ahead && !this.quotaWaits && this.queued < MAX_QUEUED_BYTES) return;
      for (const track of this.tracks) await this.evict(track, false);
      await sleep(250);
    }
  }

  /** The watched part of a buffer dropped, all but the last seconds of it. */
  evict(track, aggressive) {
    const ranges = timeRanges(track.sb);
    if (!ranges) return Promise.resolve();
    const keepFrom = Math.max(0, this.video.currentTime - (aggressive ? MIN_BEHIND : this.readAhead().behind));
    const start = ranges.start(0);
    if (keepFrom - start < (aggressive ? 1 : 5)) return Promise.resolve();
    const k = this.tracks.indexOf(track);
    this.queues[k] = this.queues[k].then(() => removeNow(track.sb, start, keepFrom));
    return this.queues[k];
  }

  /** Appends queued per track: a SourceBuffer takes one at a time. */
  append(track, data, generation) {
    const k = this.tracks.indexOf(track);
    const size = data.byteLength;
    this.queued += size;
    this.queues[k] = this.queues[k].then(async () => {
      try {
        await this.appendFitting(track, data, generation);
      } finally {
        this.queued -= size;
      }
    });
    return this.queues[k];
  }

  /** One append, waiting for room when the buffer is full (see Remuxer.appendFitting). */
  async appendFitting(track, data, generation) {
    let waiting = false;
    try {
      for (let tries = 0; ; tries++) {
        if (this.destroyed || generation !== this.generation || !this.ms || this.ms.readyState === 'closed') return;
        try {
          await appendOnce(track.sb, data);
          if (!this.appended && track.kind === 'video' && timeRanges(track.sb)) {
            this.appended = true;
            this.onFirstAppend();
          }
          return;
        } catch (err) {
          if (!err || err.name !== 'QuotaExceededError') { this.fail(err); return; }
          if (!tries) {
            const fits = Math.max(MIN_AHEAD, Math.floor(this.bufferedAhead() * 0.75));
            if (fits < this.quotaAhead) this.quotaAhead = fits;
          }
          if (!waiting) { waiting = true; this.quotaWaits++; }
          const ranges = timeRanges(track.sb);
          const keepFrom = this.video.currentTime - MIN_BEHIND;
          if (ranges && keepFrom - ranges.start(0) >= 1) await removeNow(track.sb, ranges.start(0), keepFrom);
          await sleep(tries ? QUOTA_RETRY_MS : 0);
        }
      }
    } finally {
      if (waiting) this.quotaWaits--;
    }
  }
}

/* ------------------------------------------------------------- helpers */

/** The bytes of a response read in order, from a known place in the file. */
class ByteStream {
  /**
   * @param {ReadableStreamDefaultReader<Uint8Array>} reader
   * @param {AbortController} ctrl
   * @param {number} pos
   * @param {(bytes: number) => void} [onBytes]
   */
  constructor(reader, ctrl, pos, onBytes = () => {}) {
    this.reader = reader;
    this.ctrl = ctrl;
    this.pos = pos;
    this.onBytes = onBytes;
    this.chunks = [];
    this.have = 0;
    this.done = false;
  }

  /** Reads until n bytes are held or the response ends; true if they are. */
  async fill(n) {
    while (this.have < n && !this.done) {
      const { done, value } = await within(this.reader.read(), this.ctrl, undefined, { stalled: true, connection: true });
      if (done) { this.done = true; break; }
      if (value && value.byteLength) { this.chunks.push(value); this.have += value.byteLength; this.onBytes(value.byteLength); }
    }
    return this.have >= n;
  }

  /** The first n held bytes, left in place. */
  peek(n) {
    const out = new Uint8Array(Math.min(n, this.have));
    let at = 0;
    for (const chunk of this.chunks) {
      if (at >= out.length) break;
      const part = chunk.subarray(0, out.length - at);
      out.set(part, at);
      at += part.byteLength;
    }
    return out;
  }

  /** The next n bytes, or null if the response ends first. */
  async take(n) {
    if (!(await this.fill(n))) return null;
    const out = this.peek(n);
    this.drop(n);
    return out;
  }

  /** Passes over n bytes; false if the response ends first. */
  async skip(n) {
    while (n > 0) {
      if (!this.have && !(await this.fill(1))) return false;
      const step = Math.min(n, this.have);
      this.drop(step);
      n -= step;
    }
    return true;
  }

  drop(n) {
    this.pos += n;
    this.have -= n;
    while (n > 0) {
      const first = this.chunks[0];
      if (first.byteLength <= n) { this.chunks.shift(); n -= first.byteLength; }
      else { this.chunks[0] = first.subarray(n); n = 0; }
    }
  }

  close() {
    this.ctrl.abort();
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));


function timeRanges(sb) {
  if (!sb) return null;
  try {
    const ranges = sb.buffered;
    return ranges.length ? ranges : null;
  } catch {
    return null;
  }
}

function appendOnce(sb, data) {
  return new Promise((resolve, reject) => {
    const done = () => { sb.removeEventListener('updateend', done); sb.removeEventListener('error', bad); resolve(); };
    const bad = () => { sb.removeEventListener('updateend', done); sb.removeEventListener('error', bad); reject(new Error('SourceBuffer rejected the segment')); };
    sb.addEventListener('updateend', done);
    sb.addEventListener('error', bad);
    try {
      sb.appendBuffer(data);
    } catch (err) {
      sb.removeEventListener('updateend', done);
      sb.removeEventListener('error', bad);
      reject(err);
    }
  });
}

function removeNow(sb, from, to) {
  if (!timeRanges(sb)) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { sb.removeEventListener('updateend', done); resolve(); };
    sb.addEventListener('updateend', done);
    try { sb.remove(from, to); } catch { done(); }
  });
}
