// Choosing the playback engine, its life cycle and self-repair.
//
// Xtream serves live channels as an MPEG-TS stream, which <video> cannot
// play natively — mpegts.js demuxes it into fMP4 for MediaSource. If TS
// does not start, the same channel's HLS conversion is tried with hls.js.
// VOD plays natively; Chrome supports neither Matroska (.mkv) nor .avi.
//
// When the file extension does not promise playback — or when every engine
// has failed — the file header is read (probe.js) and the exact reason is
// reported. The header also reveals when the container is in fact something
// other than the extension claims: then playback succeeds even though the
// extension would have been rejected. The header is not read up front,
// because the account allows only one concurrent connection.

import { isPlayableExtension } from './xtream.js';
import { t } from './i18n.js';
import { probe, verdict } from './probe.js';
import { Remuxer } from './remux.js';
import { Mp4Player } from './mp4play.js';
import { isGecko } from './browser.js';

const MPEGTS_CONFIG = {
  enableWorker: false,        // the extension page's CSP blocks blob: workers
  enableWorkerForMSE: false,

  // A small input buffer smooths out network jitter. The price is as much
  // latency as the buffer holds — fractions of a second on an HD stream.
  enableStashBuffer: true,
  stashInitialSize: 256 * 1024,

  // Without this the MSE buffer grows without bound and Chrome's quota
  // fills: a long viewing ends in a QuotaExceeded error after an hour or
  // two.
  autoCleanupSourceBuffer: true,
  autoCleanupMaxBackwardDuration: 60,
  autoCleanupMinBackwardDuration: 30,

  // Latency chasing jumps forward as soon as buffer accumulates — and that
  // very buffer is what would carry the stream over a drop-out. Be more
  // generous.
  liveBufferLatencyChasing: true,
  liveBufferLatencyMaxLatency: 15,
  liveBufferLatencyMinRemain: 3,
  lazyLoad: false,
};

// A film or an episode as MPEG-TS is read a minute ahead, as the MKV
// unpacking reads it, and the download waits until half a minute is left.
// Read without the limit, mpegts.js took a 5 Mbit/s film at the server's
// full speed until Chrome's MediaSource quota was full — 194 MB, nearly
// four minutes, in half a minute — then cut the connection and never
// opened another: its suspension on a full buffer has no resume, only
// the lazy load's has. The picture froze without a word when the buffer
// ran out, and at 1080p bit rates the quota holds only a minute or two.
// A minute stays far below the quota at any of those rates. The archive
// keeps the old reading: resuming asks for a byte range, which the
// catch-up address is not known to answer.
const MPEGTS_VOD_CONFIG = {
  lazyLoad: true,
  lazyLoadMaxDuration: 60,
  lazyLoadRecoverDuration: 30,
};

const HLS_CONFIG = {
  enableWorker: false,        // same reason as above
  lowLatencyMode: false,
  backBufferLength: 30,
  manifestLoadingMaxRetry: 2,
  levelLoadingMaxRetry: 2,
  fragLoadingMaxRetry: 3,
};

// The server may accept the connection and then go quiet — for instance
// when the account's concurrent-connection limit is full — in which case no
// error event ever arrives.
const TIMEOUT_MS = { mpegts: 20000, hls: 20000, native: 30000, remux: 30000, mp4: 30000 };
// A live MPEG-TS stream from which not one byte has arrived by this time is
// taken for a full account that took the connection and says nothing (see
// finish() in runAttempt), and the account is asked then, rather than after
// the whole start timeout — some 21 seconds of a black picture on every
// zap into a full account. A channel that is merely slow to start is not
// cut short by it: a provider's stream starts sending at once, and what
// takes a slow channel its time is the first keyframe and the buffer
// behind it — once bytes are arriving, the full timeout above applies.
const LIVE_SILENCE_MS = 10000;
// The library engines are named as they are; the browser's own player and
// the MKV unpacking get a translated label, resolved when read so that a
// language switch mid-playback shows in the badge too.
const engineLabel = (name) => ({ mpegts: 'mpegts.js', hls: 'hls.js' })[name] || t(`engine.${name}`);

const STALL_CHECK_MS = 4000;
const STALL_LIMIT_MS = 14000;
// A film, an episode or an archive programme has no reconnecting of its
// own here, and a picture that stops is reported instead, with Retry —
// after longer than a live stream's limit, because a file's engines have
// slow work of their own to finish first: Chrome's loader asking again
// for a range, mpegts.js reopening after its lazy-load pause, the MKV
// unpacker's own resumes (see startProgressWatch).
const VOD_STALL_LIMIT_MS = 30000;
const MAX_RECONNECTS = 4;
// The first reconnect waits a few seconds, not one: the stream is let go as
// the wait begins, and the provider goes on counting it for a few seconds
// more. Asked for again within that, a one-connection account refuses it.
const RECONNECT_STEP_MS = 2500;
const RECONNECT_MAX_MS = 8000;

// How long playback has to run before the attempt counter is reset.
// Without this, a stream that dies every 48 seconds would retry forever and
// the viewer would never learn that the fault is in the source.
const STABLE_MS = 30000;

// How long the server may go on counting a connection after we have closed
// it. Measured on the provider's panel it is seconds; this is the outer
// bound within which a full account is suspected to be counting our own.
const RELEASE_LAG_MS = 30000;

export class Playback {
  /**
   * @param {HTMLVideoElement} video
   * @param {(state: object) => void} onState
   */
  constructor(video, onState) {
    this.video = video;
    this.onState = onState || (() => {});
    this.engine = null;
    this.engineKey = null;
    this.token = 0;
    this.cleanup = null;
    this.spec = null;
    this.reconnects = 0;
    this.watchdog = null;
    this.lastProgressAt = 0;
    this.lastTime = -1;
    this.wantPlaying = false;   // the viewer's intent, not the element's state
    this.guards = null;
    this.recovering = false;
    this.recoverTimer = null;
    this.stableTimer = null;
    this.probing = null;        // the header read under way, cut with the attempt
    // When a stream of ours was last let go. The server counts a closed
    // connection for a while after it has gone, so a full account just
    // after this moment may be counting our own previous stream.
    this.releasedAt = 0;
    this.openedAt = 0;
    this.releasedBeforeOpen = 0;
    this.sourceDone = false;    // a file's source has been read to its end
    this.lastTick = 0;
  }

  /**
   * Whether a stream or a header read of ours may be holding a connection —
   * or is about to take one again: a live stream waiting to reconnect has
   * let its connection go, but another tab that started in the meantime
   * would find the account full when the wait ends.
   */
  get holding() { return Boolean(this.engine || this.probing || this.recovering); }

  /**
   * Whether the latest attempt asked for its connection soon after one of
   * ours had been let go — then a full account may be the server still
   * counting the one we closed.
   */
  get followedRelease() {
    return this.releasedBeforeOpen > 0 && this.openedAt - this.releasedBeforeOpen < RELEASE_LAG_MS;
  }

  /** The moment an attempt asks for a connection, against the last release. */
  noteOpen() {
    this.openedAt = Date.now();
    this.releasedBeforeOpen = this.releasedAt;
  }

  /** The label of the engine in use, in the interface language. */
  get engineName() { return this.engineKey ? engineLabel(this.engineKey) : null; }

  stop() {
    this.token++;
    this.stopWatchdog();
    this.detachGuards();
    clearTimeout(this.stableTimer);
    clearTimeout(this.recoverTimer);
    this.wantPlaying = false;
    this.recovering = false;
    if (this.cleanup) { this.cleanup(); this.cleanup = null; }
    this.cutProbe();
    const engine = this.engine;
    this.engine = null;
    this.engineKey = null;
    this.spec = null;
    this.reconnects = 0;
    if (engine) {
      this.releasedAt = Date.now();
      try {
        if (engine.destroy) engine.destroy();
        if (engine.detachMediaElement) engine.detachMediaElement();
      } catch { /* the engine had already been torn down */ }
    }
    this.video.removeAttribute('src');
    this.video.load();
  }

  /**
   * @param {{url:string, hlsUrl?:string, live:boolean, ext?:string,
   *          startAt?:number, mode?:'auto'|'ts'|'hls'}} spec
   */
  play(spec) {
    this.stop();          // bumps the token and invalidates the previous attempt
    this.spec = spec;
    this.begin(spec, this.token);
  }

  /** The same source again without resetting the counters. */
  restart() {
    if (!this.spec) return;
    const spec = this.spec;
    this.stopWatchdog();
    // Detach the watchdogs before touching the video element: load() fires
    // a pause event that would look like the viewer pausing.
    this.detachGuards();
    clearTimeout(this.stableTimer);
    if (this.cleanup) { this.cleanup(); this.cleanup = null; }
    this.cutProbe();
    this.dropEngine();
    this.video.removeAttribute('src');
    this.video.load();
    this.token++;
    this.spec = spec;
    this.begin(spec, this.token);
  }

  /** The engine let go of, and the moment noted as a release. */
  dropEngine() {
    const engine = this.engine;
    this.engine = null;
    if (engine) { this.releasedAt = Date.now(); try { engine.destroy(); } catch { /* purettu */ } }
  }

  /** start() without the caller having to mind the returned promise. */
  begin(spec, token) {
    this.start(spec, token).catch((err) => {
      if (token !== this.token) return;
      console.error('[iptv] starting playback failed', err);
      this.onState({ status: 'error', message: t('playback.startfailed') });
    });
  }

  async start(spec, token) {
    let chain = buildChain(spec);
    this.noteOpen();
    // An extension is no proof of the container. Measured, the library's
    // .ts files are Matroska without exception (10/10 in the sample), which
    // would leave mpegts.js waiting out a 20-second timeout before the
    // reason emerged — so the header is read before the first attempt. The
    // extensions .mp4 and .mkv, on the other hand, always held true in the
    // sample, and they are not slowed down.
    if (chain.length === 0 || (!spec.live && !spec.catchup && chain[0] === 'mpegts')) {
      const known = await this.inspect(spec, token);
      if (!known) return;
      if (known.path === 'empty') return this.nothingThere(spec);
      if (known.path === 'native') chain = nativeChain(spec);
      else if (known.path === 'mpegts') chain = ['mpegts'];
      else if (known.path === 'remux') chain = ['remux'];
      // The audio track is AC-3 or DTS: the picture would do, but silent
      // playback is the viewer's choice, not the default.
      else if (known.path === 'silent') {
        if (!spec.allowSilent) return this.refuse(known, { canSilent: true });
        chain = ['remux'];
      }
      else if (known.path !== 'unknown') return this.refuse(known);
      else if (!chain.length) return this.refuse(known);
      // An unknown result does not stop us trying: reading the header may
      // have failed on the busy connection, which says nothing about the
      // file.
    }
    const attempt = (i) => {
      if (token !== this.token) return;
      if (i >= chain.length) return void this.explain(spec, token);
      const name = chain[i];
      this.onState({ status: 'loading', attempt: i });
      this.runAttempt(name, spec, token, () => attempt(i + 1));
    };
    attempt(0);
  }

  /**
   * Reads the file header and stores the result in the spec. Returns the
   * verdict, or null if the attempt went stale in the meantime.
   */
  async inspect(spec, token) {
    this.onState({ status: 'probing' });
    // Left running, a stale read would hold the connection under the next
    // attempt — and the next attempt need not read a header at all.
    const ctrl = new AbortController();
    this.probing = ctrl;
    const info = await probe(spec.url, { signal: ctrl.signal });
    if (this.probing === ctrl) this.probing = null;
    // A read that went to the network has just let go of its connection.
    if (!info.error && Date.now() - info.at < 1000) this.releasedAt = Date.now();
    if (token !== this.token) return null;
    const known = verdict(info);
    spec.probe = info;
    spec.verdict = known;
    this.onState({ status: 'metadata' });
    return known;
  }

  /** The header read of an attempt that is being given up. */
  cutProbe() {
    if (!this.probing) return;
    this.releasedAt = Date.now();
    this.probing.abort();
    this.probing = null;
  }

  /**
   * The provider answered and sent nothing: it has no file for the title.
   * Said at once and as it is — content, not the account: the account is
   * not asked (see content in js/app.js), since our own read of the empty
   * answer may still be counted there and would blame another viewer.
   */
  nothingThere(spec) {
    const verdict = { path: 'empty', reason: t('probe.empty') };
    spec.verdict = verdict;
    this.onState({ status: 'error', message: t('playback.empty'), verdict, content: true });
  }

  refuse(known, extra = {}) {
    this.onState({
      status: 'error',
      message: t('playback.hint.copy', { reason: known.reason }),
      canExternal: true,
      verdict: known,
      ...extra,
    });
  }

  /**
   * Every engine failed. The header says whether the fault was in the
   * format or in the source — a bare "it did not work" would leave the user
   * guessing. A live stream is not probed: reading it would take the single
   * allowed connection and would say nothing the extension does not.
   *
   * refused marks a live stream the server would not give: the app asks the
   * account before it shows the failure, and may ask for the stream again.
   */
  async explain(spec, token, { refused = false } = {}) {
    const generic = t('playback.nosource');
    if (spec.live || spec.catchup || spec.probe) { this.onState({ status: 'error', message: generic, verdict: spec.verdict, refused }); return; }
    const known = await this.inspect(spec, token);
    if (!known) return;
    if (known.path === 'empty') return this.nothingThere(spec);
    if (known.path === 'silent') return this.refuse(known, { canSilent: true });
    if (known.path === 'remux' || known.path === 'none') return this.refuse(known);
    this.onState({ status: 'error', message: generic, verdict: known });
  }

  runAttempt(name, spec, token, onFail) {
    const video = this.video;
    let settled = false;
    this.noteOpen();
    this.sourceDone = false;

    const finish = (ok, why, { refused = false, empty = false } = {}) => {
      if (token !== this.token) return;
      // The engine keeps reporting after the start has been settled, and a
      // failure then is a different event from a failed start.
      if (settled) { if (!ok) this.died(name, why, token); return; }
      settled = true;
      drop();
      if (ok) {
        this.engineKey = name;
        this.wantPlaying = true;
        // The attempt counter resets only once playback has really held:
        // reset immediately, a flaky source would never reach the limit.
        this.armStable(token);
        this.onState({ status: 'playing' });
        this.bindGuards(token);
        this.startWatchdog(token);
        // The element's own error event is listened to for the rest of the
        // session, so that a media error mid-film reaches died() too.
        const onLater = () => finish(false, t('playback.reason.media', { code: video.error ? video.error.code : '?' }));
        video.addEventListener('error', onLater);
        this.cleanup = () => video.removeEventListener('error', onLater);
        return;
      }
      console.warn('[iptv] engine %s did not start: %s', name, why);
      // An attempt that never started is not counted as a release: it may
      // have been refused outright, and a wait would then be for nothing.
      const engine = this.engine;
      this.engine = null;
      if (engine) { try { engine.destroy(); } catch { /* purettu */ } }
      // The server answered OK with nothing in it: no other engine gets a
      // picture out of that, see emptyAnswer() in js/probe.js.
      if (empty) return void this.nothingThere(spec);
      // The server answered and said no. For a live channel that is the
      // account's connections far more often than the format: the
      // provider goes on counting the stream just closed for a while, and a
      // zap lands inside that. Falling back to HLS then would trade a wait
      // of seconds for a session the provider holds until it times out —
      // there is no connection of HLS to close — and the next zap would
      // find the account full. The failure goes to the account check and
      // the wait for the release instead, and the same stream is asked for
      // again. A full account need not say no, either: it may take the
      // connection and send nothing, or close it at once — so for the live
      // MPEG-TS attempt a start that times out, a source that ends before
      // the picture and a network failure count as refused too (see
      // startMpegts), and only what speaks of the format falls back. The
      // archive has no second engine to fall back to: whatever stops it
      // goes to explain() in any case, and from there to the same check.
      if (refused && spec.live) return void this.explain(spec, token, { refused: true });
      onFail();
    };

    const onPlaying = () => finish(true);
    const onError = () => finish(false, t('playback.reason.media', { code: video.error ? video.error.code : '?' }));
    // The element can end up paused during start-up: mpegts attaches the
    // MediaSource only in load(), and the element's resource-selection
    // algorithm still fires a pause event after loadedmetadata — a play()
    // called before that is cancelled silently. No single event can be
    // trusted, then, so we retry until playback starts or the timeout is
    // reached.
    // The currentTime === 0 condition confines this to start-up: after that
    // a pause is the viewer's own and must not be overridden.
    const nudge = setInterval(() => {
      if (video.paused && video.currentTime === 0) this.tryPlay();
    }, 500);
    // A live MPEG-TS stream that stays silent is a full account far more
    // often than a format the engine cannot read; see finish().
    const liveTs = name === 'mpegts' && spec.live;
    const timer = setTimeout(() => finish(false, t('playback.reason.timeout'), { refused: liveTs }), TIMEOUT_MS[name]);
    let flowing = false;
    const silence = liveTs ? setTimeout(() => {
      if (!flowing) finish(false, t('playback.reason.timeout'), { refused: true });
    }, LIVE_SILENCE_MS) : null;

    video.addEventListener('playing', onPlaying);
    video.addEventListener('error', onError);
    const drop = () => {
      clearTimeout(timer);
      clearTimeout(silence);
      clearInterval(nudge);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('error', onError);
    };
    this.cleanup = drop;

    try {
      if (name === 'mpegts') {
        this.startMpegts(spec.url, spec.live, finish, {
          vod: !spec.live && !spec.catchup, started: () => settled, onData: () => { flowing = true; },
        });
      }
      else if (name === 'hls') this.startHls(spec.hlsUrl || spec.url, finish);
      else if (name === 'remux') this.startRemux(spec, finish);
      else if (name === 'mp4') this.startMp4(spec, finish);
      else this.startNative(spec);
    } catch (err) {
      finish(false, String(err && err.message));
    }
  }

  /**
   * The engine failed after playback had started: the download broke for
   * good, the SourceBuffer refused a segment, the element hit a media
   * error. A film or an episode stops with the reason on screen, and Retry
   * resumes from the position reached; left alone, the picture would run
   * out the buffer and freeze without a word. A live stream is not handled
   * here: its guards and watchdog own the reconnecting, and they let the
   * buffer play out first so that the viewer sees all the picture that
   * arrived.
   */
  died(name, why, token) {
    if (token !== this.token || !this.spec || this.spec.live) return;
    console.warn('[iptv] engine %s failed after start: %s', name, why);
    // Taken before the engine goes: tearing it down empties the element,
    // and Retry is to start from here.
    const position = this.video.currentTime;
    this.stopWatchdog();
    this.detachGuards();
    clearTimeout(this.stableTimer);
    if (this.cleanup) { this.cleanup(); this.cleanup = null; }
    this.dropEngine();
    const reason = /failed to fetch|networkerror|network error/i.test(String(why)) ? t('playback.reason.network') : why;
    this.onState({ status: 'error', message: t('playback.died', { reason }), verdict: this.spec.verdict, position });
  }

  startMpegts(url, isLive, finish, { vod = false, started = () => true, onData = () => {} } = {}) {
    if (typeof mpegts === 'undefined' || !mpegts.isSupported()) return finish(false, 'mpegts.js not supported');
    const player = mpegts.createPlayer({ type: 'mpegts', isLive, url }, {
      ...MPEGTS_CONFIG, liveBufferLatencyChasing: isLive, ...(vod ? MPEGTS_VOD_CONFIG : {}),
    });
    this.engine = player;
    // An HTTP status other than "not found" is the server refusing, not the
    // stream failing to be MPEG-TS; see finish() in runAttempt. For a live
    // channel any failure of the connection itself counts so — a full
    // account may drop it rather than answer with a status — and only a
    // media error, or a channel that is not there, says the format or the
    // address is wrong.
    // Bytes arriving, for the silence check in runAttempt: the stream's
    // description, parsed from its first packets, or a download speed
    // above nothing in the statistics the player reports twice a second.
    player.on(mpegts.Events.MEDIA_INFO, () => onData());
    player.on(mpegts.Events.STATISTICS_INFO, (info) => { if (info && info.speed > 0) onData(); });
    player.on(mpegts.Events.ERROR, (type, detail, info) => {
      const status = Number(info && info.code);
      const gone = status === 404 || status === 410;
      const refused = !gone && ((detail === 'HttpStatusCodeInvalid' && status >= 400)
        || (isLive && type === mpegts.ErrorTypes.NETWORK_ERROR));
      finish(false, `${type}/${detail}${status ? ` ${status}` : ''}`, { refused });
    });
    // A live source does not end by itself: this means the server cut the
    // connection. The buffer is still played to the end, and the ended
    // watchdog handles the reconnect — that way the viewer sees all the
    // picture that arrived. Cut before the picture ever started, it is the
    // server turning the stream away, and waiting out the start timeout
    // would only delay the account check.
    player.on(mpegts.Events.LOADING_COMPLETE, () => {
      // A file or a programme read to its end: a picture that stops at the
      // end of the buffer now is the end, not a freeze.
      if (!isLive) { this.sourceDone = true; return; }
      if (!started()) { finish(false, t('playback.reason.ended'), { refused: true }); return; }
      console.info('[iptv] source ended mid-live-stream');
    });
    player.attachMediaElement(this.video);
    player.load();
    this.tryPlay();
  }

  startHls(url, finish) {
    if (typeof Hls === 'undefined' || !Hls.isSupported()) return finish(false, 'hls.js not supported');
    const hls = new Hls(HLS_CONFIG);
    this.engine = hls;
    let recovered = 0;
    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (!data.fatal) return;
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR && recovered < 2) { recovered++; hls.recoverMediaError(); return; }
      finish(false, `${data.type}/${data.details}`);
    });
    hls.on(Hls.Events.MANIFEST_PARSED, () => this.tryPlay());
    hls.attachMedia(this.video);
    hls.loadSource(url);
  }

  /**
   * Matroska through MediaSource. The remuxer handles the downloading, the
   * demuxing and feeding the segments; life cycle and error forwarding are
   * enough here.
   */
  startRemux(spec, finish) {
    const remuxer = new Remuxer(this.video, spec.url, {
      startAt: spec.startAt || 0,
      // Each request after the first follows one of the unpacker's own,
      // let go a moment before — a seek's, a resume's. It counts as an
      // attempt asking for its connection, so that a failure soon after it
      // goes to the account check and the wait for a release (see
      // followedRelease) rather than straight to "every connection is in
      // use", which would blame another viewer for our own stream.
      onOpen: (again) => {
        if (this.engine !== remuxer) return;
        if (again) this.releasedAt = Date.now();
        this.noteOpen();
      },
      subtitleLang: spec.subtitleLang || null,
      audioLang: spec.audioLang || null,
      onFirstAppend: () => this.tryPlay(),
      onNotice: (message) => this.onState({ status: 'notice', message }),
      onSubtitles: (info) => this.onState({ status: 'subtitles', ...info }),
      onAudio: (info) => this.onState({ status: 'audio', ...info }),
      onError: (err) => finish(false, err && err.message ? err.message : t('playback.reason.demux')),
    });
    this.engine = remuxer;
    remuxer.start().catch((err) => finish(false, err && err.message ? err.message : String(err), { empty: Boolean(err && err.empty) }));
  }

  /** MP4 through MediaSource, see nativeChain() and js/mp4play.js. */
  startMp4(spec, finish) {
    const player = new Mp4Player(this.video, spec.url, {
      startAt: spec.startAt || 0,
      onOpen: (again) => {
        if (this.engine !== player) return;
        if (again) this.releasedAt = Date.now();
        this.noteOpen();
      },
      onFirstAppend: () => this.tryPlay(),
      onNotice: (message) => this.onState({ status: 'notice', message }),
      onError: (err) => finish(false, err && err.message ? err.message : t('playback.reason.demux')),
    });
    this.engine = player;
    player.start().catch((err) => finish(false, err && err.message ? err.message : String(err), { empty: Boolean(err && err.empty) }));
  }

  startNative(spec) {
    const video = this.video;
    // The browser's own player holds its connection through the element,
    // and an engine of its own makes it count like the others: it is
    // holding while it plays, its stop is a release, and a failed start
    // lets go of the file before explain() reads its header — left set,
    // the element would go on asking for it beside the read.
    this.engine = {
      destroy: () => { video.removeAttribute('src'); video.load(); },
    };
    if (spec.startAt > 0) {
      // The listener belongs to this attempt. Abandoned before the metadata
      // arrived — the viewer switched while the connection was busy — it
      // would otherwise fire on the next item's metadata and drag that to
      // this item's resume position.
      const token = this.token;
      const seek = () => {
        video.removeEventListener('loadedmetadata', seek);
        if (token !== this.token) return;
        if (Number.isFinite(video.duration) && spec.startAt < video.duration - 5) {
          try { video.currentTime = spec.startAt; } catch { /* the browser refused */ }
        }
      };
      video.addEventListener('loadedmetadata', seek);
      const drop = this.cleanup;
      this.cleanup = () => { video.removeEventListener('loadedmetadata', seek); if (drop) drop(); };
    }
    video.src = spec.url;
    this.tryPlay();
  }

  /**
   * Changing the subtitle track. Only the MKV path knows about subtitles:
   * the other engines have no tracks, so the call does nothing.
   */
  selectSubtitle(number) {
    const engine = this.engine;
    if (!engine || !engine.selectSubtitle) return null;
    return engine.selectSubtitle(number);
  }

  /**
   * Changing the audio track. Only the MKV path can: the browser offers no
   * audioTracks to pick from on the others, so a natively played file gets
   * whichever track it marks default, see js/audio.js.
   */
  selectAudio(number) {
    const engine = this.engine;
    if (!engine || !engine.selectAudio) return null;
    return engine.selectAudio(number);
  }

  tryPlay() {
    const started = this.video.play();
    if (started && started.catch) started.catch((err) => {
      if (err.name === 'NotAllowedError') {
        this.onState({ status: 'blocked', message: t('playback.autoplay') });
      }
    });
  }

  /**
   * The attempt counter resets once playback has really held, and so does
   * the app's one wait for a release (the 'stable' state). Held means the
   * picture advanced most of STABLE_MS, not that the time passed: a stream
   * that plays for a quarter of a minute and then freezes has not held.
   * Until it has, the check is made again.
   */
  armStable(token) {
    clearTimeout(this.stableTimer);
    const from = this.video.currentTime;
    this.stableTimer = setTimeout(() => {
      if (token !== this.token) return;
      if (this.video.currentTime - from >= STABLE_MS / 1000 * 0.75) {
        this.reconnects = 0;
        this.onState({ status: 'stable' });
      } else {
        this.armStable(token);
      }
    }, STABLE_MS);
  }

  /* --------------------------------------------------------- itsekorjaus */

  /**
   * The death of a live source shows up as three different states, and each
   * has to be recognised separately:
   *
   *   1. the server cuts the connection   mpegts: LOADING_COMPLETE
   *   2. the buffer is played out         <video>: ended (and paused)
   *   3. the connection stays open, data stops   currentTime does not advance
   *
   * At element level case 2 looks exactly like the viewer pressing pause.
   * The difference is in the intent, not the state — hence wantPlaying.
   */
  bindGuards(token) {
    this.detachGuards();
    if (!this.spec || !this.spec.live) return;
    const video = this.video;
    const onEnded = () => { if (token === this.token) this.recover(t('playback.reason.ended')); };
    const onPause = () => { if (token === this.token && !video.ended) this.wantPlaying = false; };
    const onPlay = () => { if (token === this.token) this.wantPlaying = true; };
    video.addEventListener('ended', onEnded);
    video.addEventListener('pause', onPause);
    video.addEventListener('play', onPlay);
    this.guards = () => {
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('play', onPlay);
    };
  }

  detachGuards() {
    if (this.guards) { this.guards(); this.guards = null; }
  }

  /** A single door to reconnecting, whatever the reason. */
  recover(reason) {
    if (!this.spec || !this.spec.live || this.recovering) return;
    this.recovering = true;
    this.stopWatchdog();
    this.detachGuards();
    // The picture stopped before playback had held: the reset of the
    // counter would otherwise still come, and a stream that freezes every
    // half a minute would reconnect for ever.
    clearTimeout(this.stableTimer);
    // The stream is let go now rather than when the wait ends: the buffer
    // has played out or the picture has frozen, so nothing is lost, and the
    // provider's count of the closed connection runs out during the wait
    // instead of after it.
    this.dropEngine();

    if (this.reconnects >= MAX_RECONNECTS) {
      this.recovering = false;
      this.onState({
        status: 'error',
        message: t('playback.gaveup', { reason, max: MAX_RECONNECTS }) + t('playback.gaveup.hint'),
      });
      return;
    }
    this.reconnects++;
    this.onState({ status: 'reconnecting', attempt: this.reconnects, max: MAX_RECONNECTS, reason });
    // Backing off lets the server release the previous connection: the
    // account allows only a few at a time, and a request repeated at once
    // is refused.
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_STEP_MS * this.reconnects);
    // The wait belongs to this channel: stop() clears it, and should the
    // viewer have switched channel meanwhile, the token says so and the
    // new channel is left alone — a restart on top of its fresh attempt
    // would open a second connection, which a one-connection account
    // refuses.
    const token = this.token;
    clearTimeout(this.recoverTimer);
    this.recoverTimer = setTimeout(() => {
      if (token !== this.token) return;
      this.recovering = false;
      if (this.spec) this.restart();
    }, delay);
  }

  /** The picture freezing — case 3 above. */
  startWatchdog(token) {
    this.stopWatchdog();
    if (!this.spec) return;
    if (!this.spec.live) { this.startProgressWatch(token); return; }
    this.lastTime = this.video.currentTime;
    this.lastProgressAt = Date.now();
    this.watchdog = setInterval(() => {
      if (token !== this.token) return this.stopWatchdog();
      const video = this.video;

      if (video.ended) return this.recover(t('playback.reason.buffer'));

      if (video.paused) {
        // The viewer's own pause is the one pause that is not repaired.
        if (!this.wantPlaying) { this.lastProgressAt = Date.now(); return; }
        this.tryPlay();
        return;
      }

      if (video.currentTime > this.lastTime + 0.05) {
        this.lastTime = video.currentTime;
        this.lastProgressAt = Date.now();
        return;
      }
      if (Date.now() - this.lastProgressAt < STALL_LIMIT_MS) return;
      this.recover(t('playback.reason.frozen'));
    }, STALL_CHECK_MS);
  }

  /**
   * The same freeze in a film, an episode or an archive programme, which
   * had no watch at all: the picture stopped at the end of the buffer and
   * stayed there without a word. The archive is the case that showed it.
   * It is read without mpegts.js's lazy load, whose resume asks for a byte
   * range the catch-up address is not known to answer, and so at the
   * server's full speed; once the buffer is full mpegts.js suspends the
   * download, and only the lazy load's suspension has a way back. A server
   * that keeps the connection open and stops sending ends the same way.
   *
   * Nothing is repaired here — a file has no live edge to rejoin, and the
   * engines' own retries have had their turn — but the viewer is told, and
   * Retry starts again from the position reached (see died()). The picture
   * standing still is not a freeze while the viewer has paused it, while
   * it seeks, at its end, while the tab is hidden and the browser holds
   * back its timers, or while the MKV unpacker is still retrying a
   * connection.
   */
  startProgressWatch(token) {
    const video = this.video;
    this.lastTime = video.currentTime;
    this.lastProgressAt = Date.now();
    this.lastTick = Date.now();
    this.lastBuffered = 0;
    this.watchdog = setInterval(() => {
      if (token !== this.token) return this.stopWatchdog();
      const now = Date.now();
      // A tick that comes late is a tab the browser throttled or a
      // computer that slept: the time in between says nothing about the
      // picture.
      const late = now - this.lastTick > STALL_CHECK_MS * 3;
      this.lastTick = now;
      const moved = Math.abs(video.currentTime - this.lastTime) > 0.05;
      this.lastTime = video.currentTime;
      // Data still arriving is a slow connection, not a frozen one: the
      // picture waits for it, and it is not ours to give up on.
      const ranges = video.buffered;
      const buffered = ranges.length ? ranges.end(ranges.length - 1) : 0;
      const arriving = buffered - this.lastBuffered > 0.05;
      this.lastBuffered = buffered;
      if (moved || arriving || late || video.paused || video.ended || video.seeking || document.hidden
          || this.atEnd() || (this.engine && this.engine.recovering)) {
        this.lastProgressAt = now;
        return;
      }
      if (now - this.lastProgressAt < VOD_STALL_LIMIT_MS) return;
      this.died(this.engineKey, t('playback.reason.frozen'), token);
    }, STALL_CHECK_MS);
  }

  /** Whether the picture stands at the end of what there is to play. */
  atEnd() {
    const video = this.video;
    if (Number.isFinite(video.duration) && video.duration - video.currentTime < 1) return true;
    if (!this.sourceDone) return false;
    const ranges = video.buffered;
    return !ranges.length || ranges.end(ranges.length - 1) - video.currentTime < 1;
  }

  stopWatchdog() {
    if (this.watchdog) { clearInterval(this.watchdog); this.watchdog = null; }
  }

  /** Technical details to display: resolution, engine, bitrate. */
  stats() {
    const video = this.video;
    if (!video.videoWidth) return null;
    const out = { width: video.videoWidth, height: video.videoHeight, engine: this.engineName };
    const engine = this.engine;
    if (engine && typeof Hls !== 'undefined' && engine instanceof Hls) {
      const level = engine.levels && engine.levels[engine.currentLevel];
      if (level && level.bitrate) out.kbps = Math.round(level.bitrate / 1000);
    } else if (engine && engine.statisticsInfo && engine.statisticsInfo.speed) {
      out.kbps = Math.round(engine.statisticsInfo.speed * 8);
    }
    return out;
  }
}

/**
 * A file the browser plays itself. Firefox upgrades an extension page's
 * http:// media to https:// and never falls back, so on a provider's
 * plain-HTTP port <video> does not open the film at all: there MP4 is read
 * with fetch() and fed to MediaSource instead (js/mp4play.js). The
 * browser's own player is no fallback there: it would fail the same way,
 * and in failing take a connection from the account check that follows.
 */
function nativeChain(spec) {
  return isGecko() && /^http:/i.test(spec.url) ? ['mp4'] : ['native'];
}

function buildChain(spec) {
  if (/\.m3u8($|\?)/i.test(spec.url)) return ['hls'];
  if (spec.live) {
    if (spec.mode === 'ts') return ['mpegts'];
    if (spec.mode === 'hls') return spec.hlsUrl ? ['hls', 'mpegts'] : ['mpegts'];
    return spec.hlsUrl ? ['mpegts', 'hls'] : ['mpegts'];
  }
  if (/\.(ts|flv)($|\?)/i.test(spec.url)) return ['mpegts'];
  if (/\.(mp4|m4v|mov)($|\?)/i.test(spec.url) || /^(mp4|m4v|mov)$/i.test(spec.ext || '')) return nativeChain(spec);
  if (isPlayableExtension(spec.ext) || /\.(webm|ogv)($|\?)/i.test(spec.url)) return ['native'];
  return [];
}
