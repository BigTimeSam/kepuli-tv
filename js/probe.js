// Mediatiedoston otsikon luku: mitä kontissa on oikeasti.
//
// Xtreamin metadataan ei voi luottaa. get_vod_info ei palauta koodekkeja
// lainkaan (400 elokuvan otoksessa 400 tyhjää), ja get_series_info kertoo
// 4,7 %:lle jaksoista videokoodekiksi png:n tai mjpegin — se on kansikuva,
// jonka ffprobe näkee ensimmäisenä raitana. Pelkkä pääte taas ei kerro
// ääniraidasta mitään, ja juuri ääni ratkaisee: mkv-jaksoista noin 42 % on
// aac ja 53 % ac3/eac3/dts, joita Chrome ei pura millään.
//
// Yksi 256 kt:n Range-luku riittää. Matroskan Tracks-elementti on tiedoston
// alussa ja sisältää raidat koodekkeineen ja kielineen. Palvelin vastaa
// Range-pyyntöön 206:lla, joten koko tiedostoa ei ladata.
//
// Tili sallii yhden yhtäaikaisen yhteyden: pyynnöt sarjoitetaan ja runko
// katkaistaan heti kun tavut on luettu, muuten seuraava pyyntö saa HTTP 400:n.

import { cacheGet, cachePut, cacheGetAll } from './db.js';
import { t } from './i18n.js';
import { decodable } from './ffaudio.js';
import { parseHeader, TRACK_TYPE } from './ebml.js';

const HEADER_BYTES = 256 * 1024;
const TIMEOUT_MS = 15000;
const CACHE_PREFIX = 'probe:';
const CACHE_TTL = 90 * 24 * 60 * 60 * 1000;   // kontti ei muutu tiedoston alla

/* ------------------------------------------------------------- muistivälimuisti */

// Listarivit tarvitsevat tuloksen synkronisesti piirron aikana, joten
// IndexedDB:n sisältö peilataan muistiin kerran yhteyden avauksessa.
const memory = new Map();

export async function warmCache() {
  try {
    for (const [key, value] of await cacheGetAll(CACHE_PREFIX)) memory.set(key, value);
  } catch (err) {
    console.warn('[iptv] probe-välimuistin lataus epäonnistui', err);
  }
  return memory.size;
}

/** Valmis tulos ilman verkkoa, tai undefined. */
export function peek(url) {
  return memory.get(cacheKey(url));
}

/**
 * Osoitteesta tunniste ilman tunnuksia: /series/USER/PASS/123.mkv →
 * "probe:host:series:123.mkv". Salasana on jo chrome.storagessa
 * selkokielisenä eikä sitä ole syytä monistaa välimuistin avaimiin.
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

// Yksi yhteys kerrallaan. Ketju ei katkea vaikka yksi luotaus epäonnistuisi.
let queue = Promise.resolve();

function serialize(task) {
  const run = queue.then(task, task);
  queue = run.then(() => {}, () => {});
  return run;
}

/* -------------------------------------------------------------------- haku */

/**
 * @param {string} url
 * @param {{signal?: AbortSignal, force?: boolean}} opts
 * @returns {Promise<object>} ks. describe() — aina objekti, myös virheessä
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
  // Verkkovirhettä ei kannata muistaa: se voi johtua varatusta yhteydestä.
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
    // Yhteys on vapautettava ennen paluuta, muuten seuraava pyyntö torjutaan.
    try { ctrl.abort(); } catch { /* runko oli jo loppu */ }
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
  // MPEG-TS: 188 tavun paketit, joiden alussa synkkitavu.
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

const language = (track) => (track.langBcp || track.lang || 'und').toLowerCase();

// Matroska merkitsee kielen joko ISO 639-2:lla (Language) tai BCP 47:llä
// (LanguageBCP47), ja saman kirjaston tiedostoissa esiintyy molempia — sama
// kieli näkyisi muuten kahtena ("fin" ja "fi"). Näytöllä käytetään lyhyttä
// muotoa ja alueosa jätetään pois.
const ISO3 = {
  fin: 'fi', swe: 'sv', nor: 'no', nob: 'no', nno: 'no', dan: 'da', isl: 'is',
  eng: 'en', ger: 'de', deu: 'de', fre: 'fr', fra: 'fr', spa: 'es', ita: 'it',
  dut: 'nl', nld: 'nl', por: 'pt', rus: 'ru', pol: 'pl', cze: 'cs', ces: 'cs',
  hun: 'hu', rum: 'ro', ron: 'ro', gre: 'el', ell: 'el', tur: 'tr', ara: 'ar',
  heb: 'he', hin: 'hi', jpn: 'ja', kor: 'ko', chi: 'zh', zho: 'zh', tha: 'th',
  vie: 'vi', ind: 'id', may: 'ms', msa: 'ms', ukr: 'uk', hrv: 'hr', srp: 'sr',
  slo: 'sk', slk: 'sk', slv: 'sl', bul: 'bg', est: 'et', lav: 'lv', lit: 'lt',
  cat: 'ca', baq: 'eu', eus: 'eu', glg: 'gl', fil: 'fil', und: 'und',
};

export function shortLanguage(code) {
  const base = String(code || 'und').toLowerCase().split('-')[0];
  return ISO3[base] || base;
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

function audioTrack(track) {
  const mime = AUDIO_MIME[track.codecId] || null;
  return {
    codec: shortCodec(track.codecId),
    codecId: track.codecId || null,
    mime,
    supported: mime ? supports(`audio/mp4; codecs="${mime}"`) : false,
    channels: track.channels || 0,
    language: language(track),
    name: track.name || null,
    default: track.isDefault !== false,
  };
}

function subtitleTrack(track) {
  const format = SUBTITLE_FORMAT[track.codecId] || 'muu';
  return {
    format,
    codecId: track.codecId || null,
    text: format === 'srt' || format === 'ass' || format === 'vtt',
    language: language(track),
    name: track.name || null,
    default: track.isDefault !== false,
    forced: Boolean(track.forced),
  };
}

/* ------------------------------------------------------------ koodekkikartta */

const VIDEO_NAME = {
  'V_MPEG4/ISO/AVC': 'h264', 'V_MPEGH/ISO/HEVC': 'hevc', 'V_VP8': 'vp8', 'V_VP9': 'vp9',
  'V_AV1': 'av1', 'V_MPEG4/ISO/ASP': 'mpeg4', 'V_MPEG4/ISO/SP': 'mpeg4',
  'V_MPEG4/MS/V3': 'msmpeg4', 'V_MPEG2': 'mpeg2', 'V_MS/VFW/FOURCC': 'vfw', 'V_THEORA': 'theora',
};

export const AUDIO_MIME = {
  'A_AAC': 'mp4a.40.2', 'A_AAC/MPEG4/LC': 'mp4a.40.2', 'A_AAC/MPEG4/LC/SBR': 'mp4a.40.5',
  'A_AAC/MPEG2/LC': 'mp4a.40.2', 'A_AAC/MPEG2/LC/SBR': 'mp4a.40.5',
  'A_AC3': 'ac-3', 'A_EAC3': 'ec-3', 'A_DTS': 'dtsc', 'A_DTS/EXPRESS': 'dtse',
  'A_DTS/LOSSLESS': 'dtsl', 'A_TRUEHD': 'mlpa', 'A_MPEG/L3': 'mp4a.69', 'A_MPEG/L2': 'mp4a.69',
  'A_OPUS': 'opus', 'A_VORBIS': 'vorbis', 'A_FLAC': 'flac',
};

const AUDIO_NAME = {
  'A_AAC': 'aac', 'A_AAC/MPEG4/LC': 'aac', 'A_AAC/MPEG4/LC/SBR': 'aac',
  'A_AAC/MPEG2/LC': 'aac', 'A_AAC/MPEG2/LC/SBR': 'aac',
  'A_AC3': 'ac3', 'A_EAC3': 'eac3', 'A_DTS': 'dts', 'A_DTS/EXPRESS': 'dts',
  'A_DTS/LOSSLESS': 'dts', 'A_TRUEHD': 'truehd', 'A_MPEG/L3': 'mp3', 'A_MPEG/L2': 'mp2',
  'A_OPUS': 'opus', 'A_VORBIS': 'vorbis', 'A_FLAC': 'flac', 'A_PCM/INT/LIT': 'pcm',
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
 * Tarkka koodekkimerkkijono CodecPrivatesta. Profiili ratkaisee: Chrome ei
 * pura 10-bittistä H.264:ää (High 10, profile_idc 110), joten pelkkä
 * "avc1" antaisi liian toiveikkaan vastauksen.
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
  return null;                                  // mpeg4 asp, vfw, mpeg2 → ei fMP4:ää
}

const supportCache = new Map();

function supports(type) {
  if (!supportCache.has(type)) {
    let ok = false;
    try { ok = typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(type); } catch { ok = false; }
    supportCache.set(type, ok);
  }
  return supportCache.get(type);
}

/* ------------------------------------------------------------------- MP4 */

// Vain pintapuolinen: mp4 toistuu natiivisti, joten kiinnostavaa on
// tekstitysraitojen olemassaolo. moov voi olla tiedoston lopussa, jolloin
// sitä ei näy otsikossa — silloin raidat jäävät tuntemattomiksi.
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

  // Ilman moovia otsikossa ei tiedetä raidoista mitään.
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

/* ---------------------------------------------------------------- päätelmä */

/**
 * Mitä tiedostolle voi tehdä. Palauttaa reitin ja ihmisluettavan syyn.
 *
 * path:
 *   native    selaimen oma toistin
 *   mpegts    mpegts.js
 *   remux     kelpaisi MSE:lle uudelleenpakattuna (ei vielä toteutettu)
 *   silent    kuva kelpaisi, ääniraita ei
 *   none      ei toistu Chromessa
 *   unknown   otsikko ei kertonut tarpeeksi
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
  const audio = bestAudio(info);
  if (!video || !video.supported) {
    const name = video ? video.codec.toUpperCase() : t('probe.unknowncodec');
    return { path: 'none', video, audio, reason: t('probe.video', { codec: name }) };
  }
  if (!audio) {
    return { path: 'silent', video, audio: null, reason: t('probe.noaudio') };
  }
  if (!audio.supported) {
    const others = info.audio.filter((a) => a.supported);
    if (others.length) {
      return { path: 'remux', video, audio: others[0], reason: matroskaReason(video, others[0]) };
    }
    // Chrome ei pura AC-3:a, E-AC-3:a eikä DTS:ää, mutta soitin purkaa
    // (transcode.js). Koskematon raita olisi silti parempi, joten tämä on
    // vasta kolmas vaihtoehto.
    if (decodable(audio.codecId)) {
      const size = video.height ? ` ${video.height}p` : '';
      return {
        path: 'remux', video, audio, decoded: true,
        reason: t('probe.decoded', { video: video.codec.toUpperCase() + size, audio: audio.codec.toUpperCase() }),
      };
    }
    return {
      path: 'silent', video, audio,
      reason: t('probe.silent', { codec: audio.codec.toUpperCase() }),
    };
  }
  return { path: 'remux', video, audio, reason: matroskaReason(video, audio) };
}

function matroskaReason(video, audio) {
  const size = video.height ? ` ${video.height}p` : '';
  return t('probe.remux', { video: video.codec.toUpperCase() + size, audio: audio.codec.toUpperCase() });
}

/** Paras ääniraita: ensisijaisesti tuettu, muuten oletusraita. */
function bestAudio(info) {
  if (!info.audio || !info.audio.length) return null;
  return info.audio.find((a) => a.supported && a.default)
      ?? info.audio.find((a) => a.supported)
      ?? info.audio.find((a) => a.default)
      ?? info.audio[0];
}

/** Lyhyt merkintä listariville, tai null jos toistuu normaalisti. */
export function badge(info) {
  const v = verdict(info);
  if (v.path === 'native' || v.path === 'mpegts') return null;
  if (v.path === 'unknown') return null;
  if (v.path === 'remux') return { text: 'MKV', title: v.reason, level: 'warn' };
  if (v.path === 'silent') return { text: t('probe.badge.silent'), title: v.reason, level: 'warn' };
  return { text: t('probe.badge.none'), title: v.reason, level: 'warn' };
}

/** Tekstitysraidat tiiviisti: "5 tekstitystä · fin, swe, eng". */
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

// Kirjastossa on jaksoja joissa on yli 30 tekstitysraitaa, joten listan
// alkupää ratkaisee: siellä on oltava ne kielet joita täällä luetaan.
const PREFERRED = ['fi', 'sv', 'en', 'no', 'da'];
const rank = (lang) => {
  const at = PREFERRED.indexOf(lang);
  return at === -1 ? PREFERRED.length : at;
};
