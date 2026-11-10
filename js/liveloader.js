// @ts-check
// A live MPEG-TS channel read over one connection after another, as a
// standalone IPTV player reads it.
//
// mpegts.js reads a live channel over a single fetch. When the provider's
// server closes it mid-broadcast — measured on a real provider, after 55
// seconds of a channel that went on — mpegts.js says LOADING_COMPLETE and
// reads nothing more. The picture then played out the little buffer it had,
// stood still until the watchdog gave up on it after 14 seconds, and
// started over: a freeze of some twenty seconds, which players that simply
// ask again for the channel never show on the same provider.
//
// This loader asks again at once, while the buffer is still playing, and
// hands the new connection's bytes to the same demuxer as if nothing had
// happened. A server that goes quiet under an open connection is treated the
// same way after QUIET_MS. Only what happens before the first byte is left
// as mpegts.js's own loader reports it, so that a channel the provider turns
// away is still told apart from one that dropped (js/playback.js).
//
// Transport stream packets are 188 bytes and the demuxer expects them whole:
// the tail of a cut connection, a partial packet, is dropped, and a new
// connection is read from its first sync byte.
//
// A new connection opens with a burst of what the server holds of the last
// seconds — measured, eleven seconds' worth in the first second — most of
// which the connection before has already brought. Handed on as it is, the
// picture would play those seconds twice. The server sends the same bytes
// to every connection, so the new one is searched for the last packets the
// old one brought, and read from just after them. Not found in the burst
// (a server that starts each connection at the present), it is read whole.

const PACKET = 188;
const SYNC = 0x47;
// mpegts.js's LoaderStatus and LoaderErrors, which it does not export.
const STATUS = { idle: 0, connecting: 1, buffering: 2, error: 3, complete: 4 };
const ERRORS = { exception: 'Exception', httpStatus: 'HttpStatusCodeInvalid' };
// The waits before each new attempt in a row that brings no data. The
// first is next to nothing: the server closed the connection itself, so it
// no longer counts it against the account. Together they span about as
// long as the buffer lasts; after them the player's own recovery takes over.
const RETRY_MS = [0, 400, 1000, 2000, 3000, 4000];
// No byte for this long under an open connection: the server has gone
// quiet, and another connection is asked for while the buffer still plays.
const QUIET_MS = 8000;
// The packets that mark where the last connection ended, and how long, or
// how much, of a new connection is held while they are looked for.
const TAIL_PACKETS = 8;
const MATCH_MS = 1500;
const MATCH_BYTES = 48 * 1024 * 1024;
const NULL_PID = 0x1fff;

/**
 * The index of the first packet boundary in data, where a sync byte is
 * followed by more at the packet's distance; -1 when there is none yet.
 * @param {Uint8Array} data
 */
export function syncOffset(data) {
  for (let i = 0; i + PACKET < data.length && i < PACKET * 4; i++) {
    if (data[i] !== SYNC) continue;
    if (data[i + PACKET] !== SYNC) continue;
    if (i + 2 * PACKET < data.length && data[i + 2 * PACKET] !== SYNC) continue;
    return i;
  }
  return -1;
}

/**
 * Where data continues after the last packet of tail, found at a packet
 * boundary with the packets before it in tail matching as far back as data
 * goes; -1 when data does not hold it. A burst that overlaps by a single
 * packet is found as well as one that overlaps by seconds.
 * @param {Uint8Array} data whole packets
 * @param {Uint8Array} tail whole packets
 */
export function afterTail(data, tail) {
  const count = tail.length / PACKET;
  if (!count) return -1;
  const last = tail.subarray(tail.length - PACKET);
  for (let at = 0; at + PACKET <= data.length; at += PACKET) {
    // The packet's header and the first bytes of its payload say no at once.
    if (data[at + 1] !== last[1] || data[at + 2] !== last[2] || data[at + 3] !== last[3] || data[at + 8] !== last[8]) continue;
    let same = true;
    for (let back = 0; same && back < count && at - back * PACKET >= 0; back++) {
      const d = at - back * PACKET;
      const t = tail.length - (back + 1) * PACKET;
      for (let i = 0; i < PACKET; i++) if (data[d + i] !== tail[t + i]) { same = false; break; }
    }
    if (same) return at + PACKET;
  }
  return -1;
}

/**
 * Whether packets say anything at all: stuffing (PID 0x1FFF) is the same
 * packet over and over, and a tail of it would be found anywhere.
 * @param {Uint8Array} packets
 */
function meaningful(packets) {
  for (let at = 0; at + PACKET <= packets.length; at += PACKET) {
    if ((((packets[at + 1] & 0x1f) << 8) | packets[at + 2]) !== NULL_PID) return true;
  }
  return false;
}

export class ReconnectingLiveLoader {
  /**
   * @param {any} seekHandler mpegts.js's, which builds the request's address
   * @param {any} config mpegts.js's configuration; onLiveReconnect and
   *   onLiveSkip, when given, are told each new connection (a count) and
   *   the bytes of the bursts left out, for the player to note
   */
  constructor(seekHandler, config) {
    this._type = 'kepuli-live-loader';
    this._status = STATUS.idle;
    this._seekHandler = seekHandler;
    this._config = config || {};
    this.onContentLengthKnown = null;
    this.onURLRedirect = null;
    /** @type {((chunk: ArrayBuffer, byteStart: number, received: number) => void)|null} */
    this.onDataArrival = null;
    /** @type {((type: string, info: {code: number, msg: string}) => void)|null} */
    this.onError = null;
    /** @type {((from: number, to: number) => void)|null} */
    this.onComplete = null;
    this._aborted = false;
    /** @type {AbortController|null} */
    this._controller = null;
    this._received = 0;          // bytes handed on, over every connection
    this._everData = false;      // a byte has come at all
    this._failures = 0;          // attempts in a row that brought no data
    this._reconnects = 0;
    /** @type {Uint8Array} */
    this._carry = new Uint8Array(0);
    this._aligned = false;
    this._quietTimer = 0;
    this._retryTimer = 0;
    this._url = '';
    this._headers = {};
    /** @type {Uint8Array} */
    this._tail = new Uint8Array(0);       // the last packets handed on
    this._matching = false;               // a new connection's start, held while the tail is looked for
    /** @type {Uint8Array} */
    this._pending = new Uint8Array(0);
    this._matchFrom = 0;
    this.skipped = 0;                     // bytes of the bursts already had, left out
  }

  get type() { return this._type; }
  get status() { return this._status; }
  get needStashBuffer() { return true; }
  get reconnects() { return this._reconnects; }

  isWorking() { return this._status === STATUS.connecting || this._status === STATUS.buffering; }

  destroy() {
    if (this.isWorking()) this.abort();
    this._status = STATUS.idle;
    this.onContentLengthKnown = this.onURLRedirect = this.onDataArrival = this.onError = this.onComplete = null;
  }

  /**
   * @param {{url: string}} dataSource
   * @param {{from: number, to: number}} range
   */
  open(dataSource, range) {
    // The address as first given, never a redirect's: a provider redirects
    // to an address with a token of its own, which a new connection may
    // not be allowed to use again.
    const request = this._seekHandler.getConfig(dataSource.url, range);
    this._url = request.url;
    this._headers = { ...(request.headers || {}), ...(this._config.headers || {}) };
    this._connect();
  }

  abort() {
    this._aborted = true;
    clearTimeout(this._quietTimer);
    clearTimeout(this._retryTimer);
    try { this._controller?.abort(); } catch { /* already gone */ }
    this._status = STATUS.complete;
  }

  _connect() {
    if (this._aborted) return;
    this._status = STATUS.connecting;
    const controller = new AbortController();
    this._controller = controller;
    this._carry = new Uint8Array(0);
    this._aligned = false;
    this._matching = this._everData && meaningful(this._tail);
    this._pending = new Uint8Array(0);
    this._matchFrom = Date.now();
    let gotData = false;
    this._watchQuiet(controller);
    fetch(this._url, { headers: this._headers, mode: 'cors', cache: 'no-store', signal: controller.signal, referrerPolicy: 'no-referrer-when-downgrade' })
      .then(async (response) => {
        if (this._aborted || controller.signal.aborted) { response.body?.cancel().catch(() => {}); return; }
        if (!response.ok || !response.body) {
          response.body?.cancel().catch(() => {});
          // Before the first byte, a refusal is the player's to judge.
          if (!this._everData) return this._fail(ERRORS.httpStatus, { code: response.status, msg: response.statusText });
          return this._again(controller);
        }
        const reader = response.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (this._aborted || controller.signal.aborted) { reader.cancel().catch(() => {}); return; }
          if (done) break;
          if (!value || !value.length) continue;
          gotData = true;
          this._failures = 0;
          this._status = STATUS.buffering;
          this._watchQuiet(controller);
          this._deliver(value);
        }
        // Closed before a byte: the server turning the channel away, said
        // as mpegts.js's own loader says it (js/playback.js judges it).
        if (!this._everData) {
          this._status = STATUS.complete;
          if (this.onComplete) this.onComplete(0, this._received - 1);
          return;
        }
        // The server closed the connection: the channel has not ended.
        this._again(controller, gotData);
      })
      .catch((err) => {
        if (this._aborted) return;
        // Our own abort of a quiet connection has already asked again.
        if (controller.signal.aborted) return;
        if (!this._everData) return this._fail(ERRORS.exception, { code: -1, msg: String(err?.message || err) });
        this._again(controller, gotData);
      });
  }

  /**
   * A server quiet for QUIET_MS under an open connection is let go and
   * asked again.
   * @param {AbortController} controller
   */
  _watchQuiet(controller) {
    clearTimeout(this._quietTimer);
    if (!this._everData) return;     // the start's own timeouts are the player's
    this._quietTimer = setTimeout(() => {
      if (this._aborted || controller !== this._controller) return;
      try { controller.abort(); } catch { /* gone */ }
      this._again(controller);
    }, QUIET_MS);
  }

  /**
   * Another connection, after the wait its place in the row asks for.
   * @param {AbortController} controller the connection that ended
   * @param {boolean} [gotData] whether it brought anything
   */
  _again(controller, gotData = false) {
    if (this._aborted || controller !== this._controller) return;
    clearTimeout(this._quietTimer);
    if (!gotData) this._failures++;
    if (this._failures >= RETRY_MS.length) {
      return this._fail(ERRORS.exception, { code: -1, msg: `the live stream did not come back after ${this._failures} attempts` });
    }
    const wait = RETRY_MS[Math.min(this._failures, RETRY_MS.length - 1)];
    this._reconnects++;
    console.info(`[iptv] live stream closed by the server; connection ${this._reconnects + 1} in ${wait} ms`);
    try { this._config.onLiveReconnect?.(this._reconnects); } catch { /* the hook is only told */ }
    this._status = STATUS.connecting;
    clearTimeout(this._retryTimer);
    this._retryTimer = setTimeout(() => this._connect(), wait);
  }

  /**
   * @param {string} type
   * @param {{code: number, msg: string}} info
   */
  _fail(type, info) {
    clearTimeout(this._quietTimer);
    this._status = STATUS.error;
    if (this.onError) this.onError(type, info);
  }

  /**
   * Whole packets on to the demuxer; a part packet waits for the rest, and
   * a connection is read from its first packet boundary.
   * @param {Uint8Array} value
   */
  _deliver(value) {
    let data = value;
    if (this._carry.length) {
      const joined = new Uint8Array(this._carry.length + value.length);
      joined.set(this._carry);
      joined.set(value, this._carry.length);
      data = joined;
    }
    if (!this._aligned) {
      const at = syncOffset(data);
      if (at < 0) {
        // Keep what might hold the boundary, not a whole stray response.
        this._carry = data.length > PACKET * 8 ? data.slice(data.length - PACKET * 3) : data.slice();
        return;
      }
      data = data.subarray(at);
      this._aligned = true;
    }
    const whole = data.length - (data.length % PACKET);
    this._carry = data.slice(whole);
    if (!whole) return;
    let packets = data.subarray(0, whole);
    if (this._matching) {
      const held = new Uint8Array(this._pending.length + packets.length);
      held.set(this._pending);
      held.set(packets, this._pending.length);
      const at = afterTail(held, this._tail);
      if (at >= 0) {
        this.skipped += at;
        packets = held.subarray(at);
        console.info(`[iptv] the new connection repeated ${at} bytes already had; read from after them`);
        try { this._config.onLiveSkip?.(this.skipped); } catch { /* the hook is only told */ }
      } else if (held.length < MATCH_BYTES && Date.now() - this._matchFrom < MATCH_MS) {
        this._pending = held;
        return;
      } else packets = held;
      this._matching = false;
      this._pending = new Uint8Array(0);
      if (!packets.length) return;
    }
    this._everData = true;
    this._tail = packets.length >= PACKET * TAIL_PACKETS ? packets.slice(packets.length - PACKET * TAIL_PACKETS)
      : (() => { const joined = new Uint8Array(Math.min(PACKET * TAIL_PACKETS, this._tail.length + packets.length));
        const keep = joined.length - packets.length;
        joined.set(this._tail.subarray(this._tail.length - keep));
        joined.set(packets, keep);
        return joined; })();
    const chunk = packets.slice().buffer;
    const start = this._received;
    this._received += packets.length;
    if (this.onDataArrival) this.onDataArrival(chunk, start, this._received);
  }
}
