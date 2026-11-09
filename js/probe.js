// @ts-check
// Reading a media file's header: what the container really holds.
//
// Xtream's metadata cannot be trusted. get_vod_info returns no codecs at
// all (400 empty results in a sample of 400 movies), and get_series_info
// reports png or mjpeg as the video codec for 4.7% of episodes — that is
// the cover image, which ffprobe sees as the first track. The file
// extension in turn says nothing about the audio track, and audio is
// exactly what decides: of the mkv episodes around 42% are aac and 53%
// ac3/eac3/dts, which Chrome will not decode by any route.
//
// One 256 kB Range read is enough. Matroska's Tracks element sits at the
// start of the file and holds the tracks with their codecs and languages.
// The server answers a Range request with 206, so the whole file is not
// downloaded.
//
// The account allows one concurrent connection: requests are serialised and
// the body is cut off as soon as the bytes have been read, otherwise the
// next request gets HTTP 400.

import { cacheGet, cachePut, cacheGetAll } from './db.js';
import { t } from './i18n.js';
import { hasEncoder } from './transcode.js';
import { parseHeader, TRACK_TYPE } from './ebml.js';
import { AUDIO_MIME, AUDIO_NAME, describe, preferred, route, supports } from './audio.js';
import { shortLanguage, trackLanguage } from './lang.js';

const HEADER_BYTES = 256 * 1024;
const TIMEOUT_MS = 15000;
const ANSWER_MS = 5000;
const CACHE_PREFIX = 'probe:';
const CACHE_TTL = 90 * 24 * 60 * 60 * 1000;   // the container does not change under the file

/* ------------------------------------------------------------ memory cache */

// List rows need the result synchronously while painting, so the contents
// of IndexedDB are mirrored into memory once when the connection opens.
const memory = new Map();

export async function warmCache() {
  try {
    for (const [key, value] of await cacheGetAll(CACHE_PREFIX, CACHE_TTL)) memory.set(key, value);
  } catch (err) {
    console.warn('[iptv] probe-välimuistin lataus epäonnistui', err);
  }
  return memory.size;
}

/** How long a cached row is good for, for db.js's cachePurge(); null for a key that is not a probe's. */
export const probeCacheTtl = (key) => (String(key).startsWith(CACHE_PREFIX) ? CACHE_TTL : null);

/** A ready result without touching the network, or undefined. */
export function peek(url) {
  return memory.get(cacheKey(url));
}

/**
 * An identifier from the URL without the credentials:
 * /series/USER/PASS/123.mkv → "probe:host:series:123.mkv". The password is
 * already in chrome.storage in the clear and there is no reason to copy it
 * into cache keys as well.
 */
function cacheKey(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    const file = parts[parts.length - 1] || u.pathname;
    const kind = parts.length >= 4 ? parts[0] : '';
    return `${CACHE_PREFIX}${u.host}:${kind}:${file}`;
  } catch {
    return `${CACHE_PREFIX}${url}`;
  }
}

/* ------------------------------------------------------------- serialisation */

// One connection at a time. The chain does not break if one probe fails.
let queue = Promise.resolve();

/**
 * @template T
 * @param {() => Promise<T>} task
 * @returns {Promise<T>}
 */
function serialize(task) {
  const run = queue.then(task, task);
  queue = run.then(() => {}, () => {});
  return run;
}

/* ----------------------------------------------------------------- fetch */

/**
 * @param {string} url
 * @param {{signal?: AbortSignal, force?: boolean,
 *          onProgress?: (loaded:number, total:number) => void}} opts
 *        onProgress is told the bytes of the header read as they come, and
 *        how many the read is after.
 * @returns {Promise<object>} see describe() — always an object, errors included
 */
export async function probe(url, { signal, force, onProgress } = {}) {
  const key = cacheKey(url);
  if (!force) {
    const hit = memory.get(key) ?? await cacheGet(key, CACHE_TTL);
    if (hit) { memory.set(key, hit); return hit; }
  }
  // What describe() found, or what went wrong, with the time it was read.
  /** @type {{error?: string, empty?: boolean, unavailable?: number, at?: number, [field: string]: unknown}} */
  const info = await serialize(() => readHeader(url, signal, onProgress).then(({ bytes, size }) => {
    const found = parse(bytes);
    return size && !found.error ? { ...found, size } : found;
  }, (err) => ({
    container: 'unknown',
    error: err && err.message ? err.message : String(err),
    ...(err && err.unavailable ? { unavailable: err.unavailable } : {}),
  })));
  // An empty answer is the provider saying it has no file for the title,
  // not a busy connection, and not worth remembering either: the file may
  // turn up. See emptyAnswer().
  if (info.empty) info.error = t('probe.empty');
  info.at = Date.now();
  // A network error is not worth remembering: it may come from the single
  // connection being busy.
  if (!info.error) { memory.set(key, info); cachePut(key, info); }
  return info;
}

/**
 * @param {string} url
 * @param {AbortSignal} [signal]
 * @param {(loaded: number, total: number) => void} [onProgress]
 */
async function readHeader(url, signal, onProgress = () => {}) {
  const ctrl = new AbortController();
  const relay = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) throw new Error('peruttu');
    signal.addEventListener('abort', relay, { once: true });
  }
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  // The server must answer within ANSWER_MS, the header itself may take
  // the whole TIMEOUT_MS to arrive: see ANSWER_MS in js/playback.js.
  let late = false;
  const unanswered = setTimeout(() => { late = true; ctrl.abort(); }, ANSWER_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      cache: 'no-store',
      credentials: 'omit',
      headers: { Range: `bytes=0-${HEADER_BYTES - 1}` },
    }).catch((err) => {
      throw late ? new Error(t('playback.reason.timeout')) : err;
    }).finally(() => clearTimeout(unanswered));
    if (!res.ok) {
      throw Object.assign(new Error(`the server answered ${res.status}`), { unavailable: refusedByFileServer(res) ? res.status : 0 });
    }
    const reader = res.body.getReader();
    const parts = [];
    let total = 0;
    // A file shorter than the header read says so in the answer's length.
    const length = Number(res.headers.get('content-length'));
    // The whole file's size, for the details: a 206 names it after the
    // slash of its Content-Range ("bytes 0-262143/4512345678").
    const size = Number(/\/(\d+)$/.exec(res.headers.get('content-range') || '')?.[1]) || 0;
    const wanted = length > 0 ? Math.min(HEADER_BYTES, length) : HEADER_BYTES;
    onProgress(0, wanted);
    while (total < HEADER_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      total += value.byteLength;
      onProgress(total, wanted);
    }
    // The connection must be released before returning, or the next request
    // is refused.
    ctrl.abort();
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
    return { bytes, size };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', relay);
  }
}

/* ------------------------------------------------------------------- detection */

/**
 * Whether an answer that said OK carried nothing to play. Measured on a
 * provider: a title it has no file for is answered "200 OK", text/html and
 * an empty body, where a playable one is a redirect to the file's server and
 * a 206. Nothing about the account is wrong then, and no engine or retry
 * will get a picture out of it.
 */
export const emptyAnswer = (bytes) => bytes.length < 16;

/**
 * Whether a refusal came from the file's own server. The provider's server
 * decides whether the account may open a stream, and a request it lets
 * through is redirected to the server that holds the file. Measured: a
 * title whose file that server cannot give is a 302 and then a 400, every
 * time, while the account's own refusal of a stream it still counts comes
 * before any redirect. A refusal after a redirect is the file's, and
 * waiting for a connection would not change it.
 */
export const refusedByFileServer = (res) => !res.ok && (res.redirected || providerError(res.status));

/* ------------------------------------------------------ ranged downloads */

// The MKV unpacker (js/remux.js) and the MP4 reader (js/mp4play.js) read a
// file in ranges the same way, with the helpers below.
//
// A read that yields nothing for this long is a dead connection: the server
// accepted and went quiet, or the network went away under an open socket,
// which raises no error at all. The wait is cut and treated as a break in
// the download, which resumes like any other; a server that is really gone
// then fails the resume, and that is reported. Without the limit the
// picture would run out the buffer and stop without a word.
const STALL_MS = 15000;

/**
 * A step of a download with a stall limit: reader.read() or the fetch
 * itself. Past the limit the controller is aborted, so the underlying
 * request ends too, and the rejection says why with the marks given.
 * @template T
 * @param {Promise<T>} promise
 * @param {AbortController} ctrl
 * @param {number} [ms]
 * @param {object} [marks]
 * @returns {Promise<T>}
 */
export function within(promise, ctrl, ms = STALL_MS, marks = { stalled: true }) {
  let timer;
  const stalled = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(Object.assign(new Error('the download stalled'), marks));
      ctrl.abort();
    }, ms);
  });
  return Promise.race([promise, stalled]).finally(() => clearTimeout(timer));
}

/**
 * One range of the file, on the controller given. A request the server has
 * not answered within ANSWER_MS is a break, as is a failed connection; a
 * refusal is marked as the connection's (most often the account's one
 * connection still counted, worth asking again after a moment) unless the
 * file's own server gave it after the redirect, see refusedByFileServer().
 * onAnswer is told as soon as there is an answer at all.
 * @param {string} url
 * @param {AbortController} ctrl
 * @param {number} from
 * @param {number|null} to
 * @param {() => void} onAnswer
 * @returns {Promise<Response>}
 */
export async function fetchRange(url, ctrl, from, to, onAnswer) {
  if (to == null && piecewise()) return inPieces(url, ctrl, from, onAnswer);
  const res = await askRange(url, ctrl, from, to, ANSWER_MS);
  onAnswer();
  return res;
}

/** @param {string} url @param {AbortController} ctrl @param {number} from @param {number|null} to @param {number} ms */
async function askRange(url, ctrl, from, to, ms) {
  let res;
  try {
    res = await within(fetch(url, {
      signal: ctrl.signal, cache: 'no-store', credentials: 'omit',
      headers: { Range: to != null ? `bytes=${from}-${to}` : `bytes=${from}-` },
    }), ctrl, ms);
  } catch (err) {
    if (err && err.name !== 'AbortError') err.connection = true;
    throw err;
  }
  if (res.ok) return res;
  const refused = refusedByFileServer(res);
  ctrl.abort();
  throw Object.assign(new Error(`the server answered ${res.status}`),
    { status: res.status, unavailable: refused ? res.status : 0, connection: !refused });
}

/**
 * Whether a download has to be asked for in pieces. Orion on the iPhone
 * hands an extension's fetch() its answer only once the whole of it has
 * arrived (measured: 4 MB came at once after 5.2 s, and "bytes=0-" of a
 * 1.9 GB episode gave nothing in 25 s), so the open-ended read every film
 * starts with never began. The iPhone is told by its MediaSource, of which
 * it has only the managed kind.
 */
export function piecewise() {
  return typeof MediaSource === 'undefined' && 'ManagedMediaSource' in globalThis;
}

// The first piece is small, for the picture to start soon and to come
// within ANSWER_MS; the others are sized to arrive in about PIECE_SECONDS
// at the speed measured, well inside STALL_MS.
export const FIRST_PIECE = 512 * 1024;
const PIECE_SECONDS = 4;
const MIN_PIECE = 256 * 1024;
const MAX_PIECE = 8 * 1024 * 1024;

/**
 * "From here to the end" as one answer whose body is read a bounded range
 * at a time. A piece is asked for only after the last one has come, so
 * an account allowed one connection never holds two; the stream asks for
 * the next while the reader is busy with the last (highWaterMark).
 * @param {string} url
 * @param {AbortController} ctrl
 * @param {number} from
 * @param {() => void} onAnswer
 * @returns {Promise<Response>}
 */
async function inPieces(url, ctrl, from, onAnswer) {
  let started = performance.now();
  const first = await askRange(url, ctrl, from, from + FIRST_PIECE - 1, ANSWER_MS);
  onAnswer();
  // A server that ignores the range sends the whole file: nothing to piece.
  if (first.status !== 206) return first;
  const total = Number(/\/(\d+)$/.exec(first.headers.get('content-range') || '')?.[1]) || 0;
  let size = FIRST_PIECE;
  let at = from;
  /** @param {Uint8Array} bytes */
  const took = (bytes) => {
    const seconds = Math.max(0.2, (performance.now() - started) / 1000);
    size = Math.min(MAX_PIECE, Math.max(MIN_PIECE, Math.round(bytes.byteLength / seconds * PIECE_SECONDS)));
    at += bytes.byteLength;
  };
  const body = new ReadableStream({
    async start(controller) {
      const bytes = new Uint8Array(await first.arrayBuffer());
      took(bytes);
      controller.enqueue(bytes);
      if (bytes.byteLength < FIRST_PIECE || (total && at >= total)) controller.close();
    },
    async pull(controller) {
      started = performance.now();
      const asked = size;
      let bytes;
      try {
        const res = await askRange(url, ctrl, at, at + asked - 1, STALL_MS);
        bytes = new Uint8Array(await res.arrayBuffer());
      } catch (err) {
        // Past the end a server may answer 416 rather than a short piece.
        if (/** @type {any} */ (err)?.status === 416) { controller.close(); return; }
        controller.error(err);
        return;
      }
      took(bytes);
      if (bytes.byteLength) controller.enqueue(bytes);
      if (bytes.byteLength < asked || (total && at >= total)) controller.close();
    },
  }, { highWaterMark: 2 });
  const headers = new Headers({ 'content-type': first.headers.get('content-type') || '' });
  if (total) {
    headers.set('content-length', String(total - from));
    headers.set('content-range', `bytes ${from}-${total - 1}/${total}`);
  }
  return new Response(body, { status: 206, headers });
}

/**
 * Whether an answer is the provider's server failing rather than the
 * account being refused. Measured: a film's address answered "502 Bad
 * Gateway" from the provider's proxy, before any redirect, while the
 * account had room — the fault was behind the proxy, and the account's
 * count, read after it, only had our own failed request in it. An account
 * that is full is refused with a 4xx. 509 is left out: some panels use
 * "Bandwidth Limit Exceeded" to say the connections are used up.
 */
export const serverFault = (status) => status >= 500 && status !== 509;

/**
 * Whether a status before any redirect is the provider's answer about the
 * title rather than about the account: a server fault, or a film or
 * episode it says is not there. Not for a live channel, whose 404 may
 * still be there as HLS (see CHANNEL_REFUSED in js/playback.js).
 */
export const providerError = (status) => serverFault(status) || status === 404 || status === 410;

/**
 * What the server says about the address right now: one byte asked for,
 * the redirect followed, the connection let go as soon as the headers are
 * in. For a failure the header read cannot explain because it is from
 * the cache, or found nothing wrong: a provider whose proxy fails now and
 * then answers the header read one minute and "502 Bad Gateway" the next
 * (measured). Resolves to { status, ok, redirected }, or { error } when
 * there was no answer at all.
 */
/**
 * @param {string} url
 * @param {{signal?: AbortSignal, timeout?: number}} [options]
 */
export async function answerOf(url, { signal, timeout = ANSWER_MS } = {}) {
  const ctrl = new AbortController();
  const relay = () => ctrl.abort();
  signal?.addEventListener('abort', relay, { once: true });
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store', credentials: 'omit', headers: { Range: 'bytes=0-0' } });
    return { status: res.status, ok: res.ok, redirected: res.redirected };
  } catch (err) {
    return { error: err && err.message ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', relay);
    ctrl.abort();
  }
}

function parse(bytes) {
  if (emptyAnswer(bytes)) return { container: 'unknown', error: 'empty', empty: true };
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return parseMatroska(bytes);
  }
  if (str(bytes, 4, 4) === 'ftyp') return parseMp4(bytes);
  // MPEG-TS: 188-byte packets, each starting with a sync byte.
  if (bytes[0] === 0x47 && bytes[188] === 0x47 && bytes[376] === 0x47) {
    return { container: 'mpegts', video: null, audio: [], subtitles: [] };
  }
  return { container: 'unknown', error: `tuntematon alku ${hex(bytes, 4)}` };
}

const str = (b, at, len) => {
  let out = '';
  for (let i = at; i < at + len && i < b.length; i++) out += String.fromCharCode(b[i]);
  return out;
};

const hex = (b, len) => [...b.slice(0, len)].map((x) => x.toString(16).padStart(2, '0')).join(' ');

/* --------------------------------------------------------------- Matroska */

function parseMatroska(bytes) {
  const head = parseHeader(bytes);
  const out = {
    container: 'matroska', video: null, audio: [], subtitles: [],
    duration: head.duration, writingApp: head.writingApp, truncated: head.truncated,
  };
  for (const track of head.tracks) {
    const kind = TRACK_TYPE[track.type];
    if (kind === 'video' && !out.video) out.video = videoTrack(track);
    else if (kind === 'audio') out.audio.push(audioTrack(track));
    else if (kind === 'subtitle') out.subtitles.push(subtitleTrack(track));
  }
  return out;
}

function videoTrack(track) {
  const mime = videoMime(track);
  return {
    codec: shortCodec(track.codecId),
    codecId: track.codecId || null,
    mime,
    supported: mime ? supports(`video/mp4; codecs="${mime}"`) : false,
    width: track.width || 0,
    height: track.height || 0,
  };
}

// The stored shape is audio.js's description plus the two fields the rest
// of the app has always read. `route` is written but never trusted on the
// way back: a result cached for 90 days outlives a browser update, so
// verdict() asks again.
function audioTrack(track) {
  const entry = describe(track);
  return { ...entry, mime: AUDIO_MIME[entry.codecId] || null, supported: entry.route === 'passthrough' };
}

/** Audio for the details: the active track, or the player's expected choice. */
export function audioDetails(info, { active = null, language = null } = {}) {
  // The engine reports the active track after setting up its audio path.
  if (active) return { ...active, supported: true };
  if (!info || info.error) return null;
  if (info.container !== 'matroska') return info.audio?.[0] || null;
  // Cached support flags describe native decoding, not the player's wasm
  // route, and can outlive changes to the browser's encoder support.
  const tracks = (info.audio || []).map((track) => {
    const path = route(track.codecId);
    return { ...track, route: path, supported: path === 'passthrough' || (path === 'decoded' && hasEncoder()) };
  });
  return preferred(tracks, language) || tracks.find((track) => track.default) || tracks[0] || null;
}

function subtitleTrack(track) {
  const format = SUBTITLE_FORMAT[track.codecId] || 'muu';
  return {
    format,
    codecId: track.codecId || null,
    text: format === 'srt' || format === 'ass' || format === 'vtt',
    language: trackLanguage(track),
    name: track.name || null,
    default: track.isDefault !== false,
    forced: Boolean(track.forced),
  };
}

/* ------------------------------------------------------------ codec map */

const VIDEO_NAME = {
  'V_MPEG4/ISO/AVC': 'h264', 'V_MPEGH/ISO/HEVC': 'hevc', 'V_VP8': 'vp8', 'V_VP9': 'vp9',
  'V_AV1': 'av1', 'V_MPEG4/ISO/ASP': 'mpeg4', 'V_MPEG4/ISO/SP': 'mpeg4',
  'V_MPEG4/MS/V3': 'msmpeg4', 'V_MPEG2': 'mpeg2', 'V_MS/VFW/FOURCC': 'vfw', 'V_THEORA': 'theora',
};

const SUBTITLE_FORMAT = {
  'S_TEXT/UTF8': 'srt', 'S_TEXT/ASS': 'ass', 'S_TEXT/SSA': 'ass', 'S_TEXT/WEBVTT': 'vtt',
  'S_VOBSUB': 'bittikartta', 'S_HDMV/PGS': 'bittikartta', 'S_HDMV/TEXTST': 'bittikartta',
  'S_DVBSUB': 'bittikartta', 'S_IMAGE/BMP': 'bittikartta',
};

function shortCodec(codecId) {
  if (!codecId) return 'tuntematon';
  return VIDEO_NAME[codecId] || AUDIO_NAME[codecId] || codecId.replace(/^[VAS]_/, '').toLowerCase();
}

/**
 * The exact codec string from CodecPrivate. The profile decides: Chrome
 * does not decode 10-bit H.264 (High 10, profile_idc 110), so a bare
 * "avc1" would give too hopeful an answer.
 */
export function videoMime(track) {
  const id = track.codecId;
  const priv = track.priv;
  if (id === 'V_MPEG4/ISO/AVC') {
    if (priv && priv.length >= 4) {
      const h = (n) => priv[n].toString(16).padStart(2, '0');
      return `avc1.${h(1)}${h(2)}${h(3)}`;
    }
    return 'avc1.42e01e';
  }
  if (id === 'V_MPEGH/ISO/HEVC') {
    if (priv && priv.length >= 13) {
      const profile = priv[1] & 0x1f;
      const tier = (priv[1] & 0x20) ? 'H' : 'L';
      return `hvc1.${profile}.6.${tier}${priv[12]}.B0`;
    }
    return 'hvc1.1.6.L93.B0';
  }
  if (id === 'V_VP9') return 'vp09.00.10.08';
  if (id === 'V_VP8') return 'vp8';
  if (id === 'V_AV1') return 'av01.0.05M.08';
  return null;                                  // mpeg4 asp, vfw, mpeg2 → no fMP4
}

/* ------------------------------------------------------------------- MP4 */

// Only skin-deep: mp4 plays natively, so what is interesting is whether
// subtitle tracks exist. The moov may sit at the end of the file, in which
// case it is not in the header — then the tracks stay unknown.
function parseMp4(bytes) {
  const out = { container: 'mp4', video: null, audio: [], subtitles: [], truncated: false, brand: str(bytes, 8, 4) };
  const handlers = [];
  let sawMoov = false;

  const walk = (start, end, depth) => {
    let p = start;
    while (p + 8 <= end && depth < 6) {
      const view = new DataView(bytes.buffer, bytes.byteOffset + p, Math.min(8, end - p));
      let size = view.getUint32(0);
      const type = str(bytes, p + 4, 4);
      let head = 8;
      if (size === 1) {
        if (p + 16 > end) return;
        const hi = new DataView(bytes.buffer, bytes.byteOffset + p + 8, 8).getUint32(0);
        const lo = new DataView(bytes.buffer, bytes.byteOffset + p + 8, 8).getUint32(4);
        size = hi * 4294967296 + lo;
        head = 16;
      } else if (size === 0) size = end - p;
      if (size < head) return;
      if (type === 'moov') sawMoov = true;
      if (CONTAINER_BOX.has(type)) walk(p + head, Math.min(end, p + size), depth + 1);
      else if (type === 'hdlr' && p + head + 12 <= end) handlers.push(str(bytes, p + head + 8, 4));
      else if (type === 'stsd' && p + head + 16 <= end) codecBox(str(bytes, p + head + 12, 4), out);
      if (p + size > end) { out.truncated = true; return; }
      p += size;
    }
  };
  walk(0, bytes.length, 0);

  // Without a moov in the header nothing is known about the tracks.
  if (!sawMoov) { out.truncated = true; return out; }
  for (const handler of handlers) {
    if ((handler === 'sbtl' || handler === 'text' || handler === 'subt') && !out.subtitles.length) {
      out.subtitles.push({ format: 'mov_text', codecId: handler, text: true, language: 'und', name: null, default: false, forced: false });
    }
  }
  return out;
}

const CONTAINER_BOX = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'udta']);

const MP4_VIDEO = { avc1: 'h264', avc3: 'h264', hvc1: 'hevc', hev1: 'hevc', vp09: 'vp9', av01: 'av1', mp4v: 'mpeg4' };
const MP4_AUDIO = { 'mp4a': 'aac', 'ac-3': 'ac3', 'ec-3': 'eac3', 'Opus': 'opus', 'fLaC': 'flac' };

function codecBox(fourcc, out) {
  if (MP4_VIDEO[fourcc] && !out.video) {
    out.video = { codec: MP4_VIDEO[fourcc], codecId: fourcc, mime: null, supported: true, width: 0, height: 0 };
  } else if (MP4_AUDIO[fourcc]) {
    const codec = MP4_AUDIO[fourcc];
    out.audio.push({
      codec, codecId: fourcc, mime: null,
      supported: codec !== 'ac3' && codec !== 'eac3',
      channels: 0, language: 'und', name: null, default: false,
    });
  }
}

/* --------------------------------------------------------------- verdict */

/**
 * What can be done with the file. Returns the route and a human-readable
 * reason.
 *
 * path:
 *   native    the browser's own player
 *   mpegts    mpegts.js
 *   remux     would suit MSE once repackaged
 *   silent    the picture would do, the audio track would not
 *   none      does not play in Chrome
 *   unknown   the header did not say enough
 */
export function verdict(info) {
  if (info && info.empty) return { path: 'empty', reason: t('probe.empty') };
  if (info && info.unavailable) return { path: 'unavailable', reason: t('probe.unavailable', { status: info.unavailable }) };
  if (!info || info.error) {
    return { path: 'unknown', reason: info && info.error ? t('probe.unread', { error: info.error }) : t('probe.untested') };
  }
  if (info.container === 'mp4') return { path: 'native', reason: t('probe.mp4') };
  if (info.container === 'mpegts') return { path: 'mpegts', reason: t('probe.mpegts') };
  if (info.container !== 'matroska') {
    return { path: 'none', reason: t('probe.container', { container: info.container }) };
  }
  if (info.truncated && !info.video) {
    return { path: 'unknown', reason: t('probe.truncated') };
  }

  const video = info.video;
  // The same choice the remuxer makes from the same header — see audio.js
  // — so what is written below the player is what will be heard. The route
  // is asked again rather than read from the cached result: a result kept
  // for 90 days outlives a browser update, and what the browser decodes is
  // the browser's business.
  const tracks = (info.audio || []).map((track) => ({ ...track, route: route(track.codecId) }));
  const audio = preferred(tracks, null);
  if (!video || !video.supported) {
    const name = video ? video.codec.toUpperCase() : t('probe.unknowncodec');
    return { path: 'none', video, audio, reason: t('probe.video', { codec: name }) };
  }
  if (!tracks.length) {
    return { path: 'silent', video, audio: null, reason: t('probe.noaudio') };
  }
  if (!audio) {
    // No route out of any of them. The one the file points at is named, so
    // that the reason says something the viewer can act on.
    const named = tracks.find((track) => track.default) || tracks[0];
    return {
      path: 'silent', video, audio: named,
      reason: t('probe.silent', { codec: String(named.codec).toUpperCase() }),
    };
  }
  // The browser decodes neither AC-3, E-AC-3 nor DTS, but the player does
  // (transcode.js). That holds only where the decoded audio has an encoder
  // to go through on its way to MediaSource: a browser without one
  // (Firefox 128, say, before WebCodecs audio) gets the honest verdict
  // rather than a promise the playback cannot keep.
  if (audio.route === 'decoded') {
    const size = video.height ? ` ${video.height}p` : '';
    if (!hasEncoder()) {
      return {
        path: 'silent', video, audio,
        reason: t('probe.noencoder', { codec: audio.codec.toUpperCase() }),
      };
    }
    return {
      path: 'remux', video, audio, decoded: true,
      reason: t('probe.decoded', { video: video.codec.toUpperCase() + size, audio: audio.codec.toUpperCase() }),
    };
  }
  return { path: 'remux', video, audio, reason: matroskaReason(video, audio) };
}

function matroskaReason(video, audio) {
  const size = video.height ? ` ${video.height}p` : '';
  return t('probe.remux', { video: video.codec.toUpperCase() + size, audio: audio.codec.toUpperCase() });
}

/** A short badge for a list row, or null when it plays normally. */
export function badge(info) {
  const v = verdict(info);
  if (v.path === 'native' || v.path === 'mpegts' || v.path === 'remux') return null;
  if (v.path === 'unknown') return null;
  if (v.path === 'silent') return { text: t('probe.badge.silent'), title: v.reason, level: 'warn' };
  return { text: t('probe.badge.none'), title: v.reason, level: 'warn' };
}

/** The subtitle tracks in brief: how many, and in which languages. */
export function subtitleSummary(info) {
  if (!info || !info.subtitles || !info.subtitles.length) return null;
  const text = info.subtitles.filter((s) => s.text);
  // 'und' is kept: a track whose language the file states as unknown is
  // still a track the selector offers, and the summary names it too.
  const langs = [...new Set(text.map((s) => shortLanguage(s.language)))];
  langs.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return {
    total: info.subtitles.length,
    text: text.length,
    bitmap: info.subtitles.length - text.length,
    languages: langs,
  };
}

// The library has episodes with more than 30 subtitle tracks, so the head
// of the list decides: it must hold the languages that are read here.
const PREFERRED = ['fi', 'sv', 'en', 'no', 'da'];
const rank = (lang) => {
  const at = PREFERRED.indexOf(lang);
  return at === -1 ? PREFERRED.length : at;
};
