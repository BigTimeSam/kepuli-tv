// @ts-check
/// <reference path="../dev/types/globals.d.ts" />
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
import { probe, verdict, serverFault, providerError, answerOf } from './probe.js';
import { Remuxer } from './remux.js';
import { Mp4Player } from './mp4play.js';
import { isGecko } from './browser.js';

/**
 * What is to be played, as app.js asks for it. The fields after `relink`
 * are this module's own, written into the spec as the attempts go: what
 * the header read found and which engines have been tried.
 * @typedef {object} PlaySpec
 * @property {string} url
 * @property {string} [hlsUrl] a live channel's HLS address, the fallback for MPEG-TS
 * @property {boolean} [live]
 * @property {boolean} [catchup] an archive programme
 * @property {boolean} [recording] a recording from the disk, see js/recorder.js
 * @property {string|null} [ext] the container the provider names
 * @property {number} [startAt] seconds
 * @property {'auto'|'ts'|'hls'|string} [mode] the stream mode setting
 * @property {boolean} [allowSilent] the viewer chose to play a file whose sound cannot be played
 * @property {string|null} [subtitleLang]
 * @property {string|null} [audioLang]
 * @property {() => Promise<string|null>} [relink] a new address for each start, see restart()
 * @property {any} [probe] the header read's result, see probe() in js/probe.js
 * @property {any} [verdict] what the header says of it, see verdict() in js/probe.js
 * @property {boolean} [probeFresh]
 * @property {boolean} [playedAgain]
 * @property {Set<string>} [tried]
 */

/**
 * What an engine's download has come to, see loadInfo(). stage, from and
 * need belong to a step of the start whose size is known.
 * @typedef {object} LoadInfo
 * @property {number|null} loaded bytes
 * @property {number|null} [need]
 * @property {number|null} bitrate bits per second
 * @property {string} [stage]
 * @property {number} [from]
 */

/**
 * How runAttempt()'s finish() was reached, besides ok and the reason: see
 * finish() for what each says. channel is the HTTP status of a refused
 * live channel, or true when the request got no answer the browser could
 * read.
 * @typedef {object} FinishFacts
 * @property {boolean} [refused]
 * @property {boolean} [empty]
 * @property {number} [unavailable]
 * @property {number|boolean} [channel]
 */

/**
 * @typedef {(ok: boolean, why?: string, facts?: FinishFacts) => void} Finish
 */

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
/** @type {Record<string, number>} */
const TIMEOUT_MS = { mpegts: 20000, hls: 20000, native: 30000, remux: 30000, mp4: 30000 };
// A source from which nothing at all has come by this time — no answer to
// the request, not one byte of a stream — is given up rather than waited on
// for the whole start timeout. Measured against a real provider, every
// answer came within a second, a refusal included; one that has said
// nothing in five has gone quiet. A live MPEG-TS stream that stays silent
// is still taken for a full account that took the connection and says
// nothing (see finish() in runAttempt), and the account is asked. A
// channel that is merely slow to start is not cut short by it: what takes
// it its time is the first keyframe and the buffer behind it, and once
// bytes are arriving, the full timeout above applies.
const ANSWER_MS = 5000;
// A live channel the provider will not give at all. Measured: refused at
// once, before any redirect, with 407 — for channels outside the
// subscription or off the air, every time, and never for a full account,
// whose provider let the new stream through and cut the oldest. A browser
// does not hand a 407 to the page (it is the proxy's status): fetch() fails
// as a network error. So a live stream that fails on the network before a
// single byte is a channel the provider will not give, as is a 407 that
// does come through. A channel not there as MPEG-TS (404, 410) may still be
// there as HLS and is tried as that; not there as HLS either, it is not
// there.
/** @type {{ mpegts: Set<number>, hls: Set<number> }} */
const CHANNEL_REFUSED = { mpegts: new Set([407]), hls: new Set([404, 407, 410]) };
// The library engines are named as they are; the browser's own player and
// the MKV unpacking get a translated label, resolved when read so that a
// language switch mid-playback shows in the badge too.
/** @param {string} name */
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

// The account of a start or a stall given to the viewer (the 'buffering'
// state): how often it is told, over how long a span the download speed is
// measured, and how much of that span has to have passed before the speed
// is set against the film's bit rate — the first second of a download says
// little about the rest.
const METER_MS = 500;
const SPEED_WINDOW_MS = 4000;
const SLOW_AFTER_MS = 3000;
// A picture that stops for less than this is not worth an overlay: a seek
// inside the buffer, a hiccup of the decoder.
const STALL_SHOW_MS = 700;
// Without a bit rate to set the speed against, a picture that has stopped
// to wait for data twice within this span is taken for a connection too
// slow for it.
const STALL_MEMORY_MS = 120000;
const SLOW_STALLS = 2;

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
   * @param {(state: Record<string, any>) => void} onState the playback's
   *        state as it changes: { status, … }, see app.js
   */
  constructor(video, onState) {
    this.video = video;
    this.onState = onState || (() => {});
    // mpegts.js's or hls.js's player, the MKV unpacker, the MP4 reader or
    // startNative()'s stand-in: each has its own few members, and they
    // are asked for by name where they are used.
    /** @type {any} */
    this.engine = null;
    /** @type {string|null} */
    this.engineKey = null;
    this.token = 0;
    /** @type {(() => void)|null} */
    this.cleanup = null;
    /** @type {PlaySpec|null} */
    this.spec = null;
    this.reconnects = 0;
    /** @type {ReturnType<typeof setInterval>|null} */
    this.watchdog = null;
    this.lastProgressAt = 0;
    this.lastTime = -1;
    this.wantPlaying = false;   // the viewer's intent, not the element's state
    /** @type {(() => void)|null} */
    this.guards = null;
    this.recovering = false;
    /** @type {ReturnType<typeof setTimeout>|null} */
    this.recoverTimer = null;
    /** @type {ReturnType<typeof setTimeout>|null} */
    this.stableTimer = null;
    /** @type {AbortController|null} */
    this.probing = null;        // the header read under way, cut with the attempt
    // When a stream of ours was last let go. The server counts a closed
    // connection for a while after it has gone, so a full account just
    // after this moment may be counting our own previous stream.
    this.releasedAt = 0;
    this.openedAt = 0;
    this.releasedBeforeOpen = 0;
    this.sourceDone = false;    // a file's source has been read to its end
    this.lastTick = 0;
    /** @type {ReturnType<typeof setInterval>|null} */
    this.meter = null;          // the timer of the 'buffering' account, see startMeter
    /** @type {'probe'|'start'|'stall'|null} */
    this.meterPhase = null;     // 'probe' | 'start' | 'stall' while it runs
    /** @type {[number, number][]} */
    this.samples = [];          // [time, bytes] of the download, for its speed
    /** @type {any} */
    this.sampleSource = null;   // whose bytes they count
    /** @type {number[]} */
    this.stalls = [];           // when the picture last stopped to wait for data
    /** @type {(() => LoadInfo)|null} */
    this.libLoad = null;        // the bytes mpegts.js or hls.js has read, see loadInfo
    /** @type {LoadInfo|null} */
    this.probeLoad = null;      // the header read's, while it runs
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
    this.stopMeter();
    this.stalls = [];
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

  /** @param {PlaySpec} spec */
  play(spec) {
    this.stop();          // bumps the token and invalidates the previous attempt
    this.spec = spec;
    this.begin(spec, this.token);
  }

  /** The same source again without resetting the counters. */
  restart() {
    if (!this.spec) return;
    const spec = this.spec;
    this.stopMeter();
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
    // A source whose addresses are good for one connection (a Stalker
    // portal's) gives a new one for every start: the old one would be
    // refused. Asked for failing, the old one is tried as it is.
    if (spec.relink) {
      const token = this.token;
      spec.relink().then((url) => { if (url) spec.url = url; }, (err) => console.warn('[iptv] a new address was not given', err))
        .then(() => { if (token === this.token) this.begin(spec, token); });
      return;
    }
    this.begin(spec, this.token);
  }

  /** The engine let go of, and the moment noted as a release. */
  dropEngine() {
    const engine = this.engine;
    this.engine = null;
    if (engine) { this.releasedAt = Date.now(); try { engine.destroy(); } catch { /* already torn down */ } }
  }

  /**
   * start() without the caller having to mind the returned promise.
   * @param {PlaySpec} spec
   * @param {number} token
   */
  begin(spec, token) {
    this.start(spec, token).catch((err) => {
      if (token !== this.token) return;
      console.error('[iptv] starting playback failed', err);
      this.onState({ status: 'error', message: t('playback.startfailed') });
    });
  }

  /**
   * @param {PlaySpec} spec
   * @param {number} token
   */
  async start(spec, token) {
    let chain = buildChain(spec);
    this.noteOpen();
    // An extension is no proof of the container. Measured, the library's
    // .ts files are Matroska without exception (10/10 in the sample), which
    // would leave mpegts.js waiting out a 20-second timeout before the
    // reason emerged — so the header is read before the first attempt. The
    // extensions .mp4 and .mkv, on the other hand, always held true in the
    // sample, and they are not slowed down.
    if (chain.length === 0 || (!spec.live && !spec.catchup && !spec.recording && chain[0] === 'mpegts')) {
      const known = await this.inspect(spec, token);
      if (!known) return;
      if (known.path === 'empty') return this.nothingThere(spec);
      if (known.path === 'unavailable') return this.fileRefused(spec, spec.probe.unavailable);
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
    spec.tried = new Set();
    this.runChain(chain, spec, token);
  }

  /**
   * The engines in turn, then explain() once every one has failed.
   * @param {string[]} chain
   * @param {PlaySpec} spec
   * @param {number} token
   */
  runChain(chain, spec, token) {
    /** @param {number} i */
    const attempt = (i) => {
      if (token !== this.token) return;
      if (i >= chain.length) return void this.explain(spec, token);
      const name = chain[i];
      spec.tried.add(name);
      this.onState({ status: 'loading', attempt: i });
      this.runAttempt(name, spec, token, () => attempt(i + 1));
    };
    attempt(0);
  }

  /**
   * The engines the header asks for that this playback has not tried yet.
   * An extension is trusted to spare the start a header read, and it can
   * lie: measured, a provider's ".mp4" film was MPEG-TS. The browser's own
   * player refuses that at once, and without this the failure would go on
   * to the account — whose count still has the header read just closed in
   * it — and to a wait for a connection that would bring nothing.
   * @param {{ path: string }} known
   * @param {PlaySpec} spec
   * @returns {string[]}
   */
  untried(known, spec) {
    const chain = known.path === 'native' ? nativeChain(spec)
      : known.path === 'mpegts' || known.path === 'remux' ? [known.path] : [];
    return chain.filter((name) => !spec.tried || !spec.tried.has(name));
  }

  /**
   * Reads the file header and stores the result in the spec. Returns the
   * verdict, or null if the attempt went stale in the meantime.
   * @param {PlaySpec} spec
   * @param {number} token
   */
  async inspect(spec, token) {
    this.onState({ status: 'probing' });
    // Left running, a stale read would hold the connection under the next
    // attempt — and the next attempt need not read a header at all.
    const ctrl = new AbortController();
    this.probing = ctrl;
    // On a slow connection the header's quarter of a megabyte takes its
    // time too, and is told like the start's bytes.
    this.probeLoad = null;
    /**
     * @param {number} loaded
     * @param {number} need
     */
    const onProgress = (loaded, need) => {
      if (token !== this.token || this.probing !== ctrl) return;
      this.probeLoad = { loaded, stage: 'probe', from: 0, need, bitrate: null };
      this.startMeter(token, 'probe');
    };
    const asked = Date.now();
    const info = await probe(spec.url, { signal: ctrl.signal, onProgress });
    // Whether the server was asked just now, or the answer is the cache's.
    spec.probeFresh = info.at >= asked;
    if (this.meterPhase === 'probe') this.stopMeter();
    this.probeLoad = null;
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
   * @param {PlaySpec} spec
   */
  nothingThere(spec) {
    const verdict = { path: 'empty', reason: t('probe.empty') };
    spec.verdict = verdict;
    this.onState({ status: 'error', message: t('playback.empty'), verdict, content: true });
  }

  /**
   * The file's own server refused the file, after the provider's server had
   * let the request through: see refusedByFileServer() in js/probe.js. Said
   * at once and as it is, like nothingThere(): the account is not asked,
   * and no wait for a connection would bring the file.
   * @param {PlaySpec} spec
   * @param {number} status
   */
  fileRefused(spec, status) {
    const verdict = { path: 'unavailable', reason: t('probe.unavailable', { status }) };
    spec.verdict = verdict;
    this.onState({ status: 'error', message: t('playback.servererror', { status }), verdict, content: true });
  }

  /**
   * A live channel the provider will not give, see CHANNEL_REFUSED: said at
   * once and as it is, and the account is not asked — the provider would
   * have let a stream through on a full account.
   * @param {PlaySpec} spec
   */
  channelRefused(spec, status = 0) {
    // With the HTTP status where the engine reported one; without it the
    // request did not get an answer the browser could read at all.
    const message = status ? t('playback.channelrefused', { status }) : t('playback.channelunreached');
    const verdict = { path: 'unavailable', reason: message };
    spec.verdict = verdict;
    this.onState({ status: 'error', message, verdict, content: true });
  }

  /**
   * @param {{ reason: string }} known
   * @param {Record<string, any>} [extra]
   */
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
   * @param {PlaySpec} spec
   * @param {number} token
   * @param {{ refused?: boolean }} [options]
   */
  async explain(spec, token, { refused = false } = {}) {
    if (spec.live || spec.catchup || spec.recording) { this.onState({ status: 'error', ...noSource(), verdict: spec.verdict, refused }); return; }
    if (spec.probe) return this.askServer(spec, token, spec.verdict);
    const known = await this.inspect(spec, token);
    if (!known) return;
    if (known.path === 'empty') return this.nothingThere(spec);
    if (known.path === 'unavailable') return this.fileRefused(spec, spec.probe.unavailable);
    // The file is not what its name said: the engine for what it is, once.
    // Failing again, explain() finds the header read and stops there.
    const next = this.untried(known, spec);
    if (next.length) return void this.runChain(next, spec, token);
    if (known.path === 'silent') return this.refuse(known, { canSilent: true });
    if (known.path === 'remux' || known.path === 'none') return this.refuse(known);
    // The header read from the cache says nothing about now, and one that
    // found the file sound does not say why it failed.
    if (!spec.probeFresh || !spec.playedAgain) return this.askServer(spec, token, known);
    this.onState({ status: 'error', message: t('playback.notplayed'), verdict: known, reachable: true });
  }

  /**
   * A failure the header cannot explain, put to the server once more (see
   * answerOf in js/probe.js). An error answer is said as it is — "the
   * provider's server answered 502" — rather than left to the account,
   * whose count then holds only our own request and would blame another
   * viewer. An answer that lets the request through says the account has a
   * connection free: the failure is the file's or the moment's, and the
   * account is not blamed for it (reachable). No answer at all leaves it to
   * the account, as before.
   * @param {PlaySpec} spec
   * @param {number} token
   * @param {any} known the verdict, see verdict() in js/probe.js
   */
  async askServer(spec, token, known) {
    const answer = await answerOf(spec.url);
    if (token !== this.token) return;
    if (!answer.error) this.releasedAt = Date.now();
    if (answer.status && !answer.ok && (providerError(answer.status) || answer.redirected)) return this.fileRefused(spec, answer.status);
    if (answer.ok) {
      // Let through now, the failure was the moment's: a proxy failing
      // now and then, or our own last connection still counted when the
      // stream was asked for. Played again once, from the start of the
      // chain; failing again, it is said as it is, and the account is not
      // blamed for it.
      if (!spec.playedAgain) {
        spec.playedAgain = true;
        spec.tried = new Set();
        return void this.runChain(buildChain(spec), spec, token);
      }
      this.onState({ status: 'error', message: t('playback.notplayed'), verdict: known, reachable: true });
      return;
    }
    this.onState({ status: 'error', ...noSource(), verdict: known });
  }

  /**
   * @param {string} name the engine
   * @param {PlaySpec} spec
   * @param {number} token
   * @param {() => void} onFail the next engine, when this one does not start
   */
  runAttempt(name, spec, token, onFail) {
    const video = this.video;
    let settled = false;
    this.noteOpen();
    this.sourceDone = false;
    this.libLoad = null;

    /** @type {Finish} */
    const finish = (ok, why, { refused = false, empty = false, unavailable = 0, channel = 0 } = {}) => {
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
        const unwatch = this.watchStalls(token);
        this.cleanup = () => { video.removeEventListener('error', onLater); unwatch(); };
        return;
      }
      console.warn('[iptv] engine %s did not start: %s', name, why);
      // An attempt that never started is not counted as a release: it may
      // have been refused outright, and a wait would then be for nothing.
      const engine = this.engine;
      this.engine = null;
      if (engine) { try { engine.destroy(); } catch { /* already torn down */ } }
      // The server answered OK with nothing in it: no other engine gets a
      // picture out of that, see emptyAnswer() in js/probe.js.
      if (empty) return void this.nothingThere(spec);
      if (unavailable) return void this.fileRefused(spec, unavailable);
      if (channel) return void this.channelRefused(spec, channel === true ? 0 : channel);
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
    // The server has answered: from here on the wait is for the picture's
    // bytes, and the viewer is told how they are coming.
    const answered = () => {
      flowing = true;
      if (!settled && token === this.token) this.startMeter(token, 'start');
    };
    const silence = setTimeout(() => {
      if (!flowing) finish(false, t('playback.reason.timeout'), { refused: liveTs });
    }, ANSWER_MS);
    // The browser's own player says nothing of the request: metadata or
    // bytes arriving are its answer.
    const nativeAnswers = ['loadedmetadata', 'progress', 'loadeddata'];
    if (name === 'native') for (const event of nativeAnswers) video.addEventListener(event, answered);

    video.addEventListener('playing', onPlaying);
    video.addEventListener('error', onError);
    const drop = () => {
      this.stopMeter();
      clearTimeout(timer);
      clearTimeout(silence);
      for (const event of nativeAnswers) video.removeEventListener(event, answered);
      clearInterval(nudge);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('error', onError);
    };
    this.cleanup = drop;

    try {
      if (name === 'mpegts') {
        this.startMpegts(spec.url, spec.live, finish, {
          vod: !spec.live && !spec.catchup, started: () => settled, onData: answered,
        });
      }
      else if (name === 'hls') this.startHls(spec.hlsUrl || spec.url, finish, { live: spec.live, onData: answered });
      else if (name === 'remux') this.startRemux(spec, finish, answered);
      else if (name === 'mp4') this.startMp4(spec, finish, answered);
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
   * @param {string} name
   * @param {string} why
   * @param {number} token
   */
  died(name, why, token) {
    if (token !== this.token || !this.spec || this.spec.live) return;
    console.warn('[iptv] engine %s failed after start: %s', name, why);
    // Taken before the engine goes: tearing it down empties the element,
    // and Retry is to start from here.
    const position = this.video.currentTime;
    this.stopMeter();
    this.stopWatchdog();
    this.detachGuards();
    clearTimeout(this.stableTimer);
    if (this.cleanup) { this.cleanup(); this.cleanup = null; }
    this.dropEngine();
    const reason = /failed to fetch|networkerror|network error/i.test(String(why)) ? t('playback.reason.network') : why;
    this.onState({ status: 'error', message: t('playback.died', { reason }), verdict: this.spec.verdict, position });
  }

  /**
   * @param {string} url
   * @param {boolean} isLive
   * @param {Finish} finish
   * @param {{ vod?: boolean, started?: () => boolean, onData?: () => void }} [options]
   */
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
    let flowing = false;
    const data = () => { flowing = true; onData(); };
    player.on(mpegts.Events.MEDIA_INFO, data);
    // The library counts its bytes but does not say the count, only the
    // speed of the last second: the bytes are summed from that.
    const load = { loaded: 0, at: Date.now() };
    this.libLoad = () => ({ loaded: Math.round(load.loaded), need: null, bitrate: null });
    player.on(mpegts.Events.STATISTICS_INFO, (info) => {
      const now = Date.now();
      if (info && info.speed > 0) {
        load.loaded += info.speed * 1024 * Math.min(2, (now - load.at) / 1000);
        data();
      }
      load.at = now;
    });
    player.on(mpegts.Events.ERROR, (type, detail, info) => {
      const status = Number(info && info.code);
      const why = `${type}/${detail}${status ? ` ${status}` : ''}`;
      // The provider's server failing, or a film it says is not there: said
      // as it is, and the account is not asked — see providerError().
      if (serverFault(status) || (!isLive && providerError(status))) return finish(false, why, { unavailable: status });
      if (isLive && (CHANNEL_REFUSED.mpegts.has(status)
        || (type === mpegts.ErrorTypes.NETWORK_ERROR && detail !== 'HttpStatusCodeInvalid' && !flowing))) {
        return finish(false, why, { channel: status > 0 ? status : true });
      }
      const gone = status === 404 || status === 410;
      const refused = !gone && ((detail === 'HttpStatusCodeInvalid' && status >= 400)
        || (isLive && type === mpegts.ErrorTypes.NETWORK_ERROR));
      finish(false, why, { refused });
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

  /**
   * @param {string} url
   * @param {Finish} finish
   * @param {{ live?: boolean, onData?: () => void }} [options]
   */
  startHls(url, finish, { live = false, onData = () => {} } = {}) {
    if (typeof Hls === 'undefined' || !Hls.isSupported()) return finish(false, 'hls.js not supported');
    const hls = new Hls(HLS_CONFIG);
    this.engine = hls;
    let recovered = 0;
    // The segment being read says its size as it comes: until the picture
    // starts, the first segment is what the start waits for.
    const load = { done: 0, frag: null };
    this.libLoad = () => {
      const stats = load.frag && load.frag.stats;
      const partial = stats ? stats.loaded || 0 : 0;
      const level = hls.levels && hls.levels[hls.loadLevel >= 0 ? hls.loadLevel : hls.currentLevel];
      const known = stats && stats.total > 0;
      return {
        loaded: load.done + partial,
        ...(known ? { stage: 'media', from: load.done, need: load.done + stats.total } : {}),
        bitrate: level && level.bitrate ? level.bitrate : null,
      };
    };
    hls.on(Hls.Events.FRAG_LOADING, (_e, data) => { load.frag = data.frag; });
    hls.on(Hls.Events.FRAG_LOADED, (_e, data) => {
      const stats = data.frag && data.frag.stats;
      load.done += stats ? stats.loaded || 0 : 0;
      if (load.frag === data.frag) load.frag = null;
    });
    hls.on(Hls.Events.MANIFEST_LOADED, () => onData());
    hls.on(Hls.Events.ERROR, (_e, data) => {
      const status = Number(data.response && data.response.code);
      const unreached = data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR && !status;
      if (live && (CHANNEL_REFUSED.hls.has(status) || unreached)) { finish(false, `${data.type}/${data.details} ${status}`, { channel: status > 0 ? status : true }); return; }
      if (!data.fatal) return;
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR && recovered < 2) { recovered++; hls.recoverMediaError(); return; }
      if (serverFault(status) || (!live && providerError(status))) { finish(false, `${data.type}/${data.details} ${status}`, { unavailable: status }); return; }
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
   * @param {PlaySpec} spec
   * @param {Finish} finish
   * @param {() => void} [onAnswer]
   */
  startRemux(spec, finish, onAnswer = () => {}) {
    const remuxer = new Remuxer(this.video, spec.url, {
      startAt: spec.startAt || 0,
      onAnswer,
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
      onError: (err) => finish(false, engineReason(err)),
    });
    this.engine = remuxer;
    remuxer.start().catch((err) => { console.warn('[iptv] the unpacker did not start', err); finish(false, engineReason(err), { empty: Boolean(err && err.empty), unavailable: (err && err.unavailable) || 0 }); });
  }

  /**
   * MP4 through MediaSource, see nativeChain() and js/mp4play.js.
   * @param {PlaySpec} spec
   * @param {Finish} finish
   * @param {() => void} [onAnswer]
   */
  startMp4(spec, finish, onAnswer = () => {}) {
    const player = new Mp4Player(this.video, spec.url, {
      startAt: spec.startAt || 0,
      onAnswer,
      onOpen: (again) => {
        if (this.engine !== player) return;
        if (again) this.releasedAt = Date.now();
        this.noteOpen();
      },
      onFirstAppend: () => this.tryPlay(),
      onNotice: (message) => this.onState({ status: 'notice', message }),
      onError: (err) => finish(false, engineReason(err)),
    });
    this.engine = player;
    player.start().catch((err) => { console.warn('[iptv] the MP4 reader did not start', err); finish(false, engineReason(err), { empty: Boolean(err && err.empty), unavailable: (err && err.unavailable) || 0 }); });
  }

  /** @param {PlaySpec} spec */
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
   * @param {number} number
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
   * @param {number} number
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
   * @param {number} token
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

  /* ---------------------------------------------------------- self-repair */

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
   * @param {number} token
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

  /**
   * A single door to reconnecting, whatever the reason.
   * @param {string} reason
   */
  recover(reason) {
    if (!this.spec || !this.spec.live || this.recovering) return;
    this.recovering = true;
    this.stopMeter();
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
    // Backing off lets the server release the previous connection: the
    // account allows only a few at a time, and a request repeated at once
    // is refused.
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_STEP_MS * this.reconnects);
    // The moment of the next attempt goes with the state, for the viewer to
    // see it counted down.
    this.onState({ status: 'reconnecting', attempt: this.reconnects, max: MAX_RECONNECTS, reason, at: Date.now() + delay });
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

  /**
   * The picture freezing — case 3 above.
   * @param {number} token
   */
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
   * @param {number} token
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

  /* ------------------------------------------------------------ loading */

  /**
   * What the download has come to, from whichever engine plays: the bytes
   * read; the step of the start under way when its size is known — what
   * it is (stage), and from which count of bytes to which (from, need);
   * the bit rate of what it reads when it knows that; and the seconds of
   * picture buffered ahead, the one figure the browser's own player gives.
   *
   * A start whose whole size is known at once has one step. One that
   * learns it as it goes — a film's index first, and from the index the
   * bytes to its first picture — has a step for each, so that the share
   * shown never goes back as the next size comes to be known.
   * @returns {LoadInfo & { ahead: number }}
   */
  loadInfo() {
    const engine = this.engine;
    /** @type {LoadInfo} */
    let info = { loaded: null, need: null, bitrate: null };
    if (this.meterPhase === 'probe' && this.probeLoad) info = this.probeLoad;
    else if (engine && typeof engine.progress === 'function') info = engine.progress();
    else if (this.libLoad) info = this.libLoad();
    const video = this.video;
    const ranges = video.buffered;
    let ahead = 0;
    for (let i = 0; i < ranges.length; i++) {
      if (ranges.start(i) <= video.currentTime + 0.1 && ranges.end(i) > video.currentTime) ahead = ranges.end(i) - video.currentTime;
    }
    return { ...info, ahead };
  }

  /**
   * The account of a start (from the server's answer to the picture), of
   * the file header's read before it ('probe'), or of a stall (from the
   * picture stopping to wait for data to it moving again), told as the
   * 'buffering' state every METER_MS.
   * @param {number} token
   * @param {'probe'|'start'|'stall'} phase
   */
  startMeter(token, phase) {
    if (this.meterPhase === phase) return;
    this.stopMeter();
    this.meterPhase = phase;
    const tick = () => {
      if (token !== this.token || this.recovering) return this.stopMeter();
      if (phase === 'stall' && this.stallOver()) {
        this.stopMeter();
        this.onState({ status: 'flowing' });
        return;
      }
      this.onState({ status: 'buffering', phase, ...this.measure(phase) });
    };
    this.meter = setInterval(tick, METER_MS);
    tick();
  }

  stopMeter() {
    if (this.meter) { clearInterval(this.meter); this.meter = null; }
    this.meterPhase = null;
  }

  /**
   * The figures of one tick. The bytes and their total are a start's: in a
   * stall the count since the start says nothing. A connection is called
   * too slow when its speed, measured over long enough, is below the bit
   * rate of what it carries — or, without a bit rate, when the picture has
   * stopped for data more than once lately.
   * @param {'probe'|'start'|'stall'} phase
   */
  measure(phase) {
    const info = this.loadInfo();
    const now = Date.now();
    let speed = null;
    let measured = 0;
    // The samples outlive one stall: a live stream that stops every other
    // second would otherwise never be measured over a whole one. They are
    // the count of one source, though — the header read's and an engine's
    // start from nothing each.
    const source = phase === 'probe' ? 'probe' : this.engine;
    if (source !== this.sampleSource) { this.samples = []; this.sampleSource = source; }
    if (info.loaded != null) {
      this.samples.push([now, info.loaded]);
      while (this.samples.length > 2 && now - this.samples[1][0] >= SPEED_WINDOW_MS) this.samples.shift();
      const [from, bytes] = this.samples[0];
      measured = now - from;
      if (measured >= 1000) speed = ((info.loaded - bytes) * 1000) / measured;
    }
    const bitrate = info.bitrate > 0 ? info.bitrate : null;
    const slow = bitrate
      ? speed != null && measured >= SLOW_AFTER_MS && speed * 8 < bitrate
      : this.recentStalls() >= SLOW_STALLS;
    const start = phase !== 'stall';
    // A step under way: its own bytes against its own size.
    const step = start && info.need > 0 && info.loaded != null && info.need > info.loaded;
    const from = step ? info.from || 0 : 0;
    return {
      loaded: start ? info.loaded - from : null,
      total: step ? info.need - from : null,
      stage: step ? info.stage || 'media' : null,
      speed,
      bitrate,
      slow,
      // The picture buffered ahead says something only where nothing else
      // does: the browser's own player counts no bytes.
      ahead: speed == null ? info.ahead : 0,
    };
  }

  recentStalls() {
    const now = Date.now();
    this.stalls = this.stalls.filter((at) => now - at < STALL_MEMORY_MS);
    return this.stalls.length;
  }

  /** Whether a stalled picture has what it needs again, or no longer wants it. */
  stallOver() {
    const video = this.video;
    if (video.ended || video.error) return true;
    if (video.seeking) return false;
    return video.paused || video.readyState >= 3;
  }

  /**
   * The picture stopping to wait for data once it has played: the element
   * says so with 'waiting', and a seek outside the buffer with 'seeking'.
   * A wait shorter than STALL_SHOW_MS is let pass. Returns the undoing.
   * @param {number} token
   * @returns {() => void}
   */
  watchStalls(token) {
    const video = this.video;
    /** @type {ReturnType<typeof setTimeout>|null} */
    let timer = null;
    const onWait = () => {
      if (token !== this.token || timer || this.meterPhase) return;
      const seeking = video.seeking;
      timer = setTimeout(() => {
        timer = null;
        if (token !== this.token || this.recovering || this.meterPhase || this.stallOver()) return;
        // A seek is the viewer's own doing, not the connection falling
        // behind, and is not counted against it.
        if (!seeking && !video.seeking) this.stalls.push(Date.now());
        this.startMeter(token, 'stall');
      }, STALL_SHOW_MS);
    };
    const onPlaying = () => {
      if (token !== this.token || this.meterPhase !== 'stall') return;
      this.stopMeter();
      this.onState({ status: 'flowing' });
    };
    video.addEventListener('waiting', onWait);
    video.addEventListener('seeking', onWait);
    video.addEventListener('playing', onPlaying);
    return () => {
      clearTimeout(timer);
      video.removeEventListener('waiting', onWait);
      video.removeEventListener('seeking', onWait);
      video.removeEventListener('playing', onPlaying);
      if (this.meterPhase === 'stall') this.stopMeter();
    };
  }

  /**
   * Technical details to display: resolution, engine, bitrate.
   * @returns {{ width: number, height: number, engine: string|null, kbps?: number }|null}
   */
  stats() {
    const video = this.video;
    if (!video.videoWidth) return null;
    /** @type {{ width: number, height: number, engine: string|null, kbps?: number }} */
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
 * What the unpacker's or the MP4 reader's failure says to the viewer: its
 * own message where it wrote one for the interface (marked `said`), else
 * the kind of failure in the interface's words. Their messages are for the
 * console ("SourceBuffer rejected the segment"), where the engines log them.
 * @param {unknown} err
 * @returns {string}
 */
export function engineReason(err) {
  const e = /** @type {{said?: boolean, connection?: boolean, stalled?: boolean, message?: string}|null} */ (err);
  if (e?.said && e.message) return e.message;
  return t(e?.connection || e?.stalled ? 'playback.reason.network' : 'playback.reason.demux');
}

/**
 * A stream that did not start, with what to try next. The cause is given on
 * its own as well: when the account turns out to be the reason (run out,
 * shut, every connection in use), the overlay says that in place of the
 * advice, since a different playback mode or another try cannot help then.
 * @returns {{ message: string, cause: string }}
 */
function noSource() {
  const cause = t('playback.nosource');
  return { message: `${cause} ${t('playback.nosource.next')}`, cause };
}

/**
 * A file the browser plays itself. Firefox upgrades an extension page's
 * http:// media to https:// and never falls back, so on a provider's
 * plain-HTTP port <video> does not open the film at all: there MP4 is read
 * with fetch() and fed to MediaSource instead (js/mp4play.js). The
 * browser's own player is no fallback there: it would fail the same way,
 * and in failing take a connection from the account check that follows.
 * @param {PlaySpec} spec
 * @returns {string[]}
 */
function nativeChain(spec) {
  return isGecko() && /^http:/i.test(spec.url) ? ['mp4'] : ['native'];
}

/**
 * The engines to try, in order; none when the extension promises nothing
 * and the header must say.
 * @param {PlaySpec} spec
 * @returns {string[]}
 */
export function buildChain(spec) {
  // A recording from the disk (js/recorder.js) is what it was recorded as.
  if (spec.recording) return spec.ext === 'mp4' ? ['native'] : ['mpegts'];
  if (/\.m3u8($|\?)/i.test(spec.url)) return ['hls'];
  if (spec.live) {
    if (spec.mode === 'ts') return ['mpegts'];
    if (spec.mode === 'hls') return spec.hlsUrl ? ['hls', 'mpegts'] : ['mpegts'];
    return spec.hlsUrl ? ['mpegts', 'hls'] : ['mpegts'];
  }
  // By the address or by the type the provider gave: neither browser plays
  // MPEG-TS or FLV itself, and a file named without its extension once
  // went to the native player and failed there.
  if (/\.(ts|flv)($|\?)/i.test(spec.url) || /^(ts|flv)$/i.test(spec.ext || '')) return ['mpegts'];
  if (/\.(mp4|m4v|mov)($|\?)/i.test(spec.url) || /^(mp4|m4v|mov)$/i.test(spec.ext || '')) return nativeChain(spec);
  if (isPlayableExtension(spec.ext) || /\.(webm|ogv)($|\?)/i.test(spec.url)) return ['native'];
  return [];
}
