// A long text download — an M3U playlist, an XMLTV guide — read a piece at
// a time as it arrives, and gunzipped on the way when it is gzip.
//
// A guide is often served as guide.xml.gz without a Content-Encoding, so
// the browser hands over the compressed bytes: the file's first two bytes
// (1f 8b) say it, whatever the address or the headers claim.
//
// The time limit runs between pieces, as for the Xtream lists in
// js/api.js: a download of tens of megabytes may take longer than any limit
// as a whole, but one that stops arriving is a dead connection.

import { t } from './i18n.js';
import { ApiError } from './api.js';

const IDLE_MS = 20000;

/**
 * Fetches the address and hands its text to onText piece by piece.
 * onProgress(received, total) gets the bytes as they arrive (compressed
 * ones, when the file is gzip: those are what the total counts).
 */
export async function streamText(url, { signal, onText, onProgress } = {}) {
  const ctrl = new AbortController();
  const quiet = () => ctrl.abort(new DOMException('no data within the limit', 'TimeoutError'));
  let idle = setTimeout(quiet, IDLE_MS);
  const both = signal ? AbortSignal.any([signal, ctrl.signal]) : ctrl.signal;
  try {
    let res;
    try {
      res = await fetch(url, { signal: both, cache: 'no-store', credentials: 'omit' });
    } catch (err) { throw fetchError(err); }
    if (res.status === 401 || res.status === 403 || res.status === 512) throw new ApiError('tunnistus', t('m3u.denied', { status: res.status }));
    if (!res.ok) throw new ApiError('http', t('api.status', { status: res.status }));
    const total = Number(res.headers.get('content-length')) || 0;
    const reader = res.body.getReader();
    let received = 0;
    let lastTick = 0;
    // The first piece decides how the rest is read.
    let first;
    try { first = await reader.read(); } catch (err) { throw fetchError(err); }
    const gzip = !first.done && first.value.length >= 2 && first.value[0] === 0x1f && first.value[1] === 0x8b;
    const decoder = new TextDecoder('utf-8');
    let writer = null;
    let inflated = null;
    if (gzip) {
      const inflate = new DecompressionStream('gzip');
      writer = inflate.writable.getWriter();
      const out = inflate.readable.pipeThrough(new TextDecoderStream()).getReader();
      inflated = (async () => {
        for (;;) {
          const { done, value } = await out.read();
          if (done) return;
          onText(value);
        }
      })();
      // A broken file rejects both ends; the reading end is the one awaited.
      inflated.catch(() => {});
    }
    const take = async (bytes) => {
      received += bytes.byteLength;
      if (gzip) await writer.write(bytes).catch(() => {});
      else onText(decoder.decode(bytes, { stream: true }));
      const now = performance.now();
      if (onProgress && now - lastTick > 100) { lastTick = now; onProgress(received, total); }
    };
    if (!first.done) await take(first.value);
    for (;;) {
      let piece;
      try { piece = await reader.read(); } catch (err) { throw fetchError(err); }
      if (piece.done) break;
      clearTimeout(idle);
      idle = setTimeout(quiet, IDLE_MS);
      await take(piece.value);
    }
    if (gzip) {
      await writer.close().catch(() => {});
      try { await inflated; } catch { throw new ApiError('muoto', t('m3u.badgzip')); }
    } else {
      const tail = decoder.decode();
      if (tail) onText(tail);
    }
    onProgress?.(received, total);
    return { received, gzip };
  } finally {
    clearTimeout(idle);
  }
}

function fetchError(err) {
  if (err instanceof ApiError) return err;
  if (err && err.name === 'AbortError') return err;
  if (err && err.name === 'TimeoutError') return new ApiError('verkko', t('api.timeout', { seconds: IDLE_MS / 1000 }));
  console.warn('[iptv] the address could not be reached:', err);
  return new ApiError('verkko', t('api.unreachable'));
}
