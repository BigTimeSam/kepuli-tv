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
const CACHE_PREFIX = 'probe:';
const CACHE_TTL = 90 * 24 * 60 * 60 * 1000;   // the container does not change under the file

/* ------------------------------------------------------------ memory cache */

// List rows need the result synchronously while painting, so the contents
// of IndexedDB are mirrored into memory once when the connection opens.
const memory = new Map();

export async function warmCache() {
  try {
    for (const [key, value] of await cacheGetAll(CACHE_PREFIX)) memory.set(key, value);
  } catch (err) {
    console.warn('[iptv] probe-välimuistin lataus epäonnistui', err);
  }
  return memory.size;
}

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

/* ---------------------------------------------------------------- sarjoitus */

// One connection at a time. The chain does not break if one probe fails.
let queue = Promise.resolve();

function serialize(task) {
  const run = queue.then(task, task);
  queue = run.then(() => {}, () => {});
  return run;
}

/* ----------------------------------------------------------------- fetch */

/**
 * @param {string} url
 * @param {{signal?: AbortSignal, force?: boolean}} opts
 * @returns {Promise<object>} see describe() — always an object, errors included
 */
export async function probe(url, { signal, force } = {}) {
  const key = cacheKey(url);
  if (!force) {
    const hit = memory.get(key) ?? await cacheGet(key, CACHE_TTL);
    if (hit) { memory.set(key, hit); return hit; }
  }
  const info = await serialize(() => readHeader(url, signal).then(parse, (err) => ({
    container: 'unknown',
    error: err && err.message ? err.message : String(err),
  })));
  info.at = Date.now();
  // A network error is not worth remembering: it may come from the single
  // connection being busy.
  if (!info.error) { memory.set(key, info); cachePut(key, info); }
  return info;
}

async function readHeader(url, signal) {
  const ctrl = new AbortController();
  const relay = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) throw new Error('peruttu');
    signal.addEventListener('abort', relay, { once: true });
  }
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      cache: 'no-store',
      credentials: 'omit',
      headers: { Range: `bytes=0-${HEADER_BYTES - 1}` },
    });
    if (!res.ok) throw new Error(`palvelin vastasi ${res.status}`);
    const reader = res.body.getReader();
    const parts = [];
    let total = 0;
    while (total < HEADER_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      total += value.byteLength;
    }
    // The connection must be released before returning, or the next request
    // is refused.
    try { ctrl.abort(); } catch { /* the body had already ended */ }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
    return bytes;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', relay);
  }
}

/* ------------------------------------------------------------------ tunnistus */

function parse(bytes) {
  if (bytes.length < 16) return { container: 'unknown', error: 'liian vähän tavuja' };
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
  if (v.path === 'native' || v.path === 'mpegts') return null;
  if (v.path === 'unknown') return null;
  if (v.path === 'remux') return { text: 'MKV', title: v.reason, level: 'warn' };
  if (v.path === 'silent') return { text: t('probe.badge.silent'), title: v.reason, level: 'warn' };
  return { text: t('probe.badge.none'), title: v.reason, level: 'warn' };
}

/** The subtitle tracks in brief: "5 subtitles · fin, swe, eng". */
export function subtitleSummary(info) {
  if (!info || !info.subtitles || !info.subtitles.length) return null;
  const text = info.subtitles.filter((s) => s.text);
  const langs = [...new Set(text.map((s) => shortLanguage(s.language)))].filter((l) => l !== 'und');
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
