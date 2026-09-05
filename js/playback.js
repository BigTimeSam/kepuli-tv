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
const TIMEOUT_MS = { mpegts: 20000, hls: 20000, native: 30000, remux: 30000 };
// The library engines are named as they are; the browser's own player and
// the MKV unpacking get a translated label, resolved when read so that a
// language switch mid-playback shows in the badge too.
const engineLabel = (name) => ({ mpegts: 'mpegts.js', hls: 'hls.js' })[name] || t(`engine.${name}`);

const STALL_CHECK_MS = 4000;
const STALL_LIMIT_MS = 14000;
const MAX_RECONNECTS = 4;
const RECONNECT_STEP_MS = 1000;
const RECONNECT_MAX_MS = 8000;

// How long playback has to run before the attempt counter is reset.
// Without this, a stream that dies every 48 seconds would retry forever and
// the viewer would never learn that the fault is in the source.
const STABLE_MS = 30000;

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
    const engine = this.engine;
    this.engine = null;
    this.engineKey = null;
    this.spec = null;
    this.reconnects = 0;
    if (engine) {
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
    const engine = this.engine;
    this.engine = null;
    if (engine) { try { engine.destroy(); } catch { /* purettu */ } }
    this.video.removeAttribute('src');
    this.video.load();
    this.token++;
    this.spec = spec;
    this.begin(spec, this.token);
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
    // An extension is no proof of the container. Measured, the library's
    // .ts files are Matroska without exception (10/10 in the sample), which
    // would leave mpegts.js waiting out a 20-second timeout before the
    // reason emerged — so the header is read before the first attempt. The
    // extensions .mp4 and .mkv, on the other hand, always held true in the
    // sample, and they are not slowed down.
    if (chain.length === 0 || (!spec.live && chain[0] === 'mpegts')) {
      const known = await this.inspect(spec, token);
      if (!known) return;
      if (known.path === 'native') chain = ['native'];
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
      this.onState({ status: 'loading', engine: engineLabel(name), attempt: i });
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
    const info = await probe(spec.url);
    if (token !== this.token) return null;
    const known = verdict(info);
    spec.probe = info;
    spec.verdict = known;
    return known;
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
   */
  async explain(spec, token) {
    const generic = t('playback.nosource');
    if (spec.live || spec.probe) { this.onState({ status: 'error', message: generic, verdict: spec.verdict }); return; }
    const known = await this.inspect(spec, token);
    if (!known) return;
    if (known.path === 'silent') return this.refuse(known, { canSilent: true });
    if (known.path === 'remux' || known.path === 'none') return this.refuse(known);
    this.onState({ status: 'error', message: generic, verdict: known });
  }

  runAttempt(name, spec, token, onFail) {
    const video = this.video;
    let settled = false;

    const finish = (ok, why) => {
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
        clearTimeout(this.stableTimer);
        this.stableTimer = setTimeout(() => { this.reconnects = 0; }, STABLE_MS);
        this.onState({ status: 'playing', engine: this.engineName });
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
      const engine = this.engine;
      this.engine = null;
      if (engine) { try { engine.destroy(); } catch { /* purettu */ } }
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
    const timer = setTimeout(() => finish(false, 'aikakatkaisu'), TIMEOUT_MS[name]);

    video.addEventListener('playing', onPlaying);
    video.addEventListener('error', onError);
    const drop = () => {
      clearTimeout(timer);
      clearInterval(nudge);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('error', onError);
    };
    this.cleanup = drop;

    try {
      if (name === 'mpegts') this.startMpegts(spec.url, spec.live, finish);
      else if (name === 'hls') this.startHls(spec.hlsUrl || spec.url, finish);
      else if (name === 'remux') this.startRemux(spec, finish);
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
    this.stopWatchdog();
    this.detachGuards();
    clearTimeout(this.stableTimer);
    if (this.cleanup) { this.cleanup(); this.cleanup = null; }
    const engine = this.engine;
    this.engine = null;
    if (engine) { try { engine.destroy(); } catch { /* purettu */ } }
    const reason = /failed to fetch|networkerror|network error/i.test(String(why)) ? t('playback.reason.network') : why;
    this.onState({ status: 'error', message: t('playback.died', { reason }), verdict: this.spec.verdict });
  }

  startMpegts(url, isLive, finish) {
    if (typeof mpegts === 'undefined' || !mpegts.isSupported()) return finish(false, 'mpegts.js not supported');
    const player = mpegts.createPlayer({ type: 'mpegts', isLive, url }, MPEGTS_CONFIG);
    this.engine = player;
    player.on(mpegts.Events.ERROR, (type, detail) => finish(false, `${type}/${detail}`));
    // A live source does not end by itself: this means the server cut the
    // connection. The buffer is still played to the end, and the ended
    // watchdog handles the reconnect — that way the viewer sees all the
    // picture that arrived.
    player.on(mpegts.Events.LOADING_COMPLETE, () => {
      if (isLive) console.info('[iptv] source ended mid-live-stream');
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
      subtitleLang: spec.subtitleLang || null,
      audioLang: spec.audioLang || null,
      onFirstAppend: () => this.tryPlay(),
      onNotice: (message) => this.onState({ status: 'notice', message }),
      onSubtitles: (info) => this.onState({ status: 'subtitles', ...info }),
      onAudio: (info) => this.onState({ status: 'audio', ...info }),
      onError: (err) => finish(false, err && err.message ? err.message : t('playback.reason.demux')),
    });
    this.engine = remuxer;
    remuxer.start().catch((err) => finish(false, err && err.message ? err.message : String(err)));
  }

  startNative(spec) {
    const video = this.video;
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
    if (!this.spec || !this.spec.live) return;
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

function buildChain(spec) {
  if (/\.m3u8($|\?)/i.test(spec.url)) return ['hls'];
  if (spec.live) {
    if (spec.mode === 'ts') return ['mpegts'];
    if (spec.mode === 'hls') return spec.hlsUrl ? ['hls', 'mpegts'] : ['mpegts'];
    return spec.hlsUrl ? ['mpegts', 'hls'] : ['mpegts'];
  }
  if (/\.(ts|flv)($|\?)/i.test(spec.url)) return ['mpegts'];
  if (isPlayableExtension(spec.ext) || /\.(mp4|m4v|mov|webm|ogv)($|\?)/i.test(spec.url)) return ['native'];
  return [];
}
