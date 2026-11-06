// One connection to a live channel, however many in the page want it.
//
// A provider counts connections, and many accounts allow one. Recording the
// channel on screen would otherwise open a second connection to the same
// channel, and the provider would refuse it — or drop the picture. So a
// live channel's MPEG-TS stream is read once here, and each of its readers
// gets the same bytes: the player (mpegts.js, through fetch — see
// installFetchTap) and the recorder (js/recorder.js, through tap).
//
// The connection is keyed by the channel, not by its address: a Stalker
// portal gives the same channel a new address with a new token every time
// it is asked (js/stalker.js), and the player and the recorder must still
// find each other's connection. The player says which address is which
// channel (shareAs) before it starts.
//
// A reader who joins a connection that is already running gets the stream
// from the next MPEG-TS packet on: the bytes are cut at a sync byte (0x47)
// that has another one 188 bytes on, so that what it gets parses from its
// first byte. The tables that say what the stream holds repeat several
// times a second, and a demuxer starting there finds them at once.
//
// When the last reader goes, the connection is closed. When the server
// ends it, every reader is told, and each one reconnects in its own way —
// the player through its watchdog, the recorder after a pause; the first
// to come back opens the connection and the other joins it.

const TS_PACKET = 188;
// A late joiner gives up looking for the packet boundary after this much:
// a stream that has none is no MPEG-TS, and is passed on as it is.
const SYNC_LIMIT = 64 * 1024;

const upstreams = new Map();   // channel key → Upstream
const aliases = new Map();     // address → channel key

/** The packet boundary in bytes: the first 0x47 with two more after it, or -1. */
export function syncOffset(bytes) {
  for (let i = 0; i + 2 * TS_PACKET < bytes.length; i++) {
    if (bytes[i] === 0x47 && bytes[i + TS_PACKET] === 0x47 && bytes[i + 2 * TS_PACKET] === 0x47) return i;
  }
  return -1;
}

/**
 * A reader's end of the connection. A late one holds back what comes until
 * it has found a packet boundary.
 */
class Reader {
  constructor({ onData, onEnd }, late) {
    this.onData = onData;
    this.onEnd = onEnd;
    this.pending = late ? [] : null;
    this.pendingBytes = 0;
  }

  push(chunk) {
    if (!this.pending) { this.onData(chunk); return; }
    this.pending.push(chunk);
    this.pendingBytes += chunk.byteLength;
    if (this.pendingBytes < 3 * TS_PACKET) return;
    const joined = new Uint8Array(this.pendingBytes);
    let at = 0;
    for (const part of this.pending) { joined.set(part, at); at += part.byteLength; }
    const offset = syncOffset(joined);
    if (offset < 0 && this.pendingBytes < SYNC_LIMIT) return;
    this.pending = null;
    this.onData(offset > 0 ? joined.subarray(offset) : joined);
  }

  end(err) { this.onEnd(err); }
}

class Upstream {
  constructor(key, url) {
    this.key = key;
    this.url = url;
    this.readers = new Set();
    this.ctrl = new AbortController();
    this.bytes = 0;
    this.done = false;
    this.head = null;
  }

  start(fetcher) {
    this.head = fetcher(this.url, { signal: this.ctrl.signal, cache: 'no-store', credentials: 'omit' }).then((res) => {
      const head = { ok: res.ok, status: res.status, statusText: res.statusText, type: res.headers.get('content-type') || '' };
      if (!res.ok || !res.body) {
        res.body?.cancel().catch(() => {});
        this.finish(null);
        return head;
      }
      this.pump(res.body.getReader());
      return head;
    }, (err) => {
      this.finish(err);
      throw err;
    });
  }

  async pump(reader) {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        this.bytes += value.byteLength;
        for (const r of [...this.readers]) {
          try { r.push(value); } catch (err) { console.warn('[iptv] a stream reader failed', err); }
        }
      }
      this.finish(null);
    } catch (err) {
      this.finish(err);
    }
  }

  add(reader) { this.readers.add(reader); }

  remove(reader) {
    if (!this.readers.delete(reader) || this.readers.size || this.done) return;
    this.ctrl.abort();
    this.finish(null, { quiet: true });
  }

  finish(err, { quiet = false } = {}) {
    if (this.done) return;
    this.done = true;
    if (upstreams.get(this.key) === this) upstreams.delete(this.key);
    if (quiet) return;
    for (const r of [...this.readers]) r.end(err);
    this.readers.clear();
  }
}

let plainFetch = (...args) => globalThis.fetch(...args);

/** The connection to a channel: the running one, or a new one to the address. */
function upstreamFor(key, url) {
  let up = upstreams.get(key);
  if (up && !up.done) return { up, late: up.bytes > 0 };
  up = new Upstream(key, url);
  upstreams.set(key, up);
  up.start(plainFetch);
  return { up, late: false };
}

/** The player's address for a channel, before the player asks for it. */
export function shareAs(url, key) {
  if (!url || !key) return;
  aliases.set(url, key);
  // The addresses of the channels watched earlier are of no more use.
  if (aliases.size > 50) aliases.delete(aliases.keys().next().value);
}

/**
 * A fetch() of a shared address answered from the channel's connection: a
 * Response like the network's, its body the bytes from now on.
 */
async function sharedResponse(key, url, signal) {
  if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
  const { up, late } = upstreamFor(key, url);
  let reader = null;
  let controller = null;
  const body = new ReadableStream({
    start(c) { controller = c; },
    cancel() { up.remove(reader); },
  });
  reader = new Reader({
    onData: (chunk) => { try { controller.enqueue(chunk); } catch { up.remove(reader); } },
    onEnd: (err) => { try { if (err) controller.error(err); else controller.close(); } catch { /* already closed */ } },
  }, late);
  up.add(reader);
  signal?.addEventListener('abort', () => {
    up.remove(reader);
    try { controller.error(new DOMException('The operation was aborted.', 'AbortError')); } catch { /* closed */ }
  }, { once: true });
  let head;
  try { head = await up.head; } catch (err) { up.remove(reader); throw err; }
  if (!head.ok) {
    up.remove(reader);
    const res = new Response(null, { status: head.status, statusText: head.statusText });
    Object.defineProperty(res, 'url', { value: url });
    return res;
  }
  // No Content-Length: the bytes a late reader gets are not the server's count.
  const res = new Response(body, { status: head.status, statusText: head.statusText, headers: head.type ? { 'Content-Type': head.type } : {} });
  Object.defineProperty(res, 'url', { value: url });
  return res;
}

/**
 * fetch() made to answer a shared address from the channel's connection.
 * Only a plain GET from the start: a probe's byte range or a HEAD goes to
 * the network as it is.
 */
export function installFetchTap() {
  if (globalThis.fetch.kepuliTap) return;
  const original = globalThis.fetch.bind(globalThis);
  plainFetch = original;
  const tapped = function fetch(input, init = {}) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url;
    const key = url && aliases.get(url);
    if (!key) return original(input, init);
    const method = String(init.method || (typeof input === 'object' && input.method) || 'GET').toUpperCase();
    const headers = new Headers(init.headers || (typeof input === 'object' ? input.headers : undefined) || {});
    const range = headers.get('Range');
    if (method !== 'GET' || (range && !/^bytes=0-$/.test(range.trim()))) return original(input, init);
    return sharedResponse(key, url, init.signal);
  };
  tapped.kepuliTap = true;
  globalThis.fetch = tapped;
}

/**
 * The recorder's way in: the channel's bytes from now on, from the running
 * connection or a new one to the address openUrl() gives. Resolves with the
 * server's answer once it is known; close() lets go.
 */
export async function tap(key, openUrl, { onData, onEnd }) {
  let entry = upstreams.get(key);
  let up;
  let late = false;
  if (entry && !entry.done) { up = entry; late = up.bytes > 0; } else {
    const url = await openUrl();
    ({ up, late } = upstreamFor(key, url));
  }
  const reader = new Reader({ onData, onEnd }, late);
  up.add(reader);
  const close = () => up.remove(reader);
  let head;
  try { head = await up.head; } catch (err) { close(); throw err; }
  if (!head.ok) close();
  return { head, close, url: up.url };
}
