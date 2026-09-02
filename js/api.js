// Xtream Codes player_api.php -asiakas.
//
// Rajapinnan kummallisuudet joihin on varauduttu:
//  - väärä salasana vastaa HTTP 512:lla, ei 401:llä
//  - tuntematon action palauttaa tilitiedot eikä virhettä, joten vastauksen
//    muoto on tarkistettava eikä statuskoodiin voi luottaa
//  - EPG:n title ja description ovat base64:ää, joka on purettava UTF-8:na
//  - aikaleimoista vain *_timestamp on yksiselitteinen; start/end ovat
//    palvelimen aikavyöhykkeessä (tässä Europe/Ljubljana)

import { t } from './i18n.js';

const TEXT_DECODER = new TextDecoder();

/** base64 → UTF-8. Pelkkä atob() rikkoisi ääkköset. */
export function decodeField(value) {
  if (!value) return '';
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return TEXT_DECODER.decode(bytes);
  } catch {
    return value;
  }
}

export class XtreamApi {
  constructor(config) {
    this.config = config;
    this.base = `${config.scheme || 'http'}://${config.host}${config.port ? ':' + config.port : ''}`;
    this.auth = `username=${encodeURIComponent(config.username)}&password=${encodeURIComponent(config.password)}`;
  }

  url(action, params) {
    const extra = params ? '&' + new URLSearchParams(params) : '';
    return `${this.base}/player_api.php?${this.auth}${action ? '&action=' + action : ''}${extra}`;
  }

  async call(action, params, { signal } = {}) {
    let res;
    try {
      res = await fetch(this.url(action, params), { signal, cache: 'no-store', credentials: 'omit' });
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      throw new ApiError('verkko', t('api.unreachable', { message: err.message }));
    }
    if (res.status === 512 || res.status === 401 || res.status === 403) {
      throw new ApiError('tunnistus', t('api.rejected'));
    }
    if (!res.ok) throw new ApiError('http', t('api.status', { status: res.status, statusText: res.statusText }));
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new ApiError('muoto', t('api.notjson', { head: text.slice(0, 80) }));
    }
  }

  /** Tilin ja palvelimen tiedot. Toimii myös yhteyden testinä. */
  async account({ signal } = {}) {
    const data = await this.call('', null, { signal });
    if (!data || !data.user_info) throw new ApiError('muoto', t('api.nouserinfo'));
    if (String(data.user_info.auth) !== '1') throw new ApiError('tunnistus', t('api.authfailed'));
    const u = data.user_info;
    const s = data.server_info || {};
    return {
      status: u.status,
      trial: u.is_trial === '1',
      expiresAt: u.exp_date ? Number(u.exp_date) * 1000 : null,
      createdAt: u.created_at ? Number(u.created_at) * 1000 : null,
      maxConnections: Number(u.max_connections) || null,
      activeConnections: Number(u.active_cons) || 0,
      outputFormats: Array.isArray(u.allowed_output_formats) ? u.allowed_output_formats : [],
      serverTimezone: s.timezone || null,
      serverTimeOffsetMs: s.timestamp_now ? Number(s.timestamp_now) * 1000 - Date.now() : 0,
      // Catchup-osoitteen aikaleima on palvelimen paikallista aikaa; offset
      // saadaan vertaamalla time_now-merkkijonoa unix-aikaleimaan.
      serverUtcOffsetMs: serverUtcOffset(s),
    };
  }

  async categories(type, { signal } = {}) {
    const action = { live: 'get_live_categories', movie: 'get_vod_categories', series: 'get_series_categories' }[type];
    const raw = await this.call(action, null, { signal });
    if (!Array.isArray(raw)) throw new ApiError('muoto', t('api.nocategories'));
    return raw.map((c) => ({ id: String(c.category_id), name: c.category_name || 'Nimetön' }));
  }

  /**
   * Striimit tyypeittäin; categoryId rajaa haun yhteen kategoriaan.
   * onProgress saa ladatut tavut — koko listan haku on megatavuluokkaa,
   * joten edistyminen on näytettävä käyttäjälle.
   */
  async streams(type, categoryId, { signal, onProgress } = {}) {
    const action = { live: 'get_live_streams', movie: 'get_vod_streams', series: 'get_series' }[type];
    const params = categoryId ? { category_id: categoryId } : null;
    const raw = onProgress
      ? await this.callStreaming(action, params, { signal, onProgress })
      : await this.call(action, params, { signal });
    if (!Array.isArray(raw)) throw new ApiError('muoto', t('api.nostreams'));
    return raw.map(type === 'series' ? normalizeSeries : type === 'movie' ? normalizeMovie : normalizeLive);
  }

  /** Kuten call(), mutta raportoi latauksen edistymisen. */
  async callStreaming(action, params, { signal, onProgress }) {
    let res;
    try {
      res = await fetch(this.url(action, params), { signal, cache: 'no-store', credentials: 'omit' });
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      throw new ApiError('verkko', t('api.unreachable', { message: err.message }));
    }
    if (res.status === 512 || res.status === 401 || res.status === 403) {
      throw new ApiError('tunnistus', t('api.rejected'));
    }
    if (!res.ok) throw new ApiError('http', t('api.status', { status: res.status, statusText: res.statusText }));

    const total = Number(res.headers.get('content-length')) || 0;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const parts = [];
    let received = 0;
    let lastTick = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      parts.push(decoder.decode(value, { stream: true }));
      const now = performance.now();
      if (now - lastTick > 100) { lastTick = now; onProgress(received, total); }
    }
    parts.push(decoder.decode());
    onProgress(received, total);
    try {
      return JSON.parse(parts.join(''));
    } catch {
      throw new ApiError('muoto', t('api.badjson'));
    }
  }

  async seriesInfo(seriesId, { signal } = {}) {
    const data = await this.call('get_series_info', { series_id: seriesId }, { signal });
    const info = data.info || {};
    const episodes = [];
    for (const [season, list] of Object.entries(data.episodes || {})) {
      for (const ep of list || []) {
        const meta = ep.info || {};
        episodes.push({
          id: String(ep.id),
          k: 3,
          n: ep.title || t('api.episode', { number: ep.episode_num }),
          season: Number(season) || Number(ep.season) || 0,
          episode: Number(ep.episode_num) || 0,
          ext: ep.container_extension || 'mp4',
          logo: safeUrl(meta.movie_image),
          plot: meta.plot || '',
          durationSec: Number(meta.duration_secs) || 0,
          airDate: meta.air_date || '',
          video: codecInfo(meta.video),
          audio: codecInfo(meta.audio),
          bitrate: Number(meta.bitrate) || 0,
          direct: ep.direct_source || null,
        });
      }
    }
    episodes.sort((a, b) => a.season - b.season || a.episode - b.episode);
    return {
      plot: info.plot || '',
      cast: info.cast || '',
      director: info.director || '',
      genre: info.genre || '',
      releaseDate: info.releaseDate || info.release_date || '',
      cover: safeUrl(info.cover),
      rating: info.rating || '',
      episodes,
    };
  }

  async vodInfo(vodId, { signal } = {}) {
    const data = await this.call('get_vod_info', { vod_id: vodId }, { signal });
    const info = data.info || {};
    const movie = data.movie_data || {};
    return {
      plot: info.plot || info.description || '',
      cast: info.cast || info.actors || '',
      director: info.director || '',
      genre: info.genre || '',
      releaseDate: info.releasedate || info.release_date || '',
      cover: safeUrl(info.movie_image) || safeUrl(info.cover_big),
      rating: info.rating || '',
      durationSec: Number(info.duration_secs) || 0,
      trailer: info.youtube_trailer || '',
      ext: movie.container_extension || null,
      video: codecInfo(info.video),
      audio: codecInfo(info.audio),
      bitrate: Number(info.bitrate) || 0,
    };
  }

  /** Seuraavat ohjelmat yhdelle kanavalle. */
  async shortEpg(streamId, limit = 4, { signal } = {}) {
    const data = await this.call('get_short_epg', { stream_id: streamId, limit }, { signal });
    return (data.epg_listings || []).map(normalizeProgramme);
  }

  /** Kanavan koko EPG-ikkuna, myös menneet ohjelmat (catchupia varten). */
  async fullEpg(streamId, { signal } = {}) {
    const data = await this.call('get_simple_data_table', { stream_id: streamId }, { signal });
    return (data.epg_listings || []).map(normalizeProgramme);
  }
}

export class ApiError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
  }
}

// Palveluntarjoaja osoittaa logoissa GitHubin HTML-sivuille
// (github.com/…/blob/…?raw=true). Ne uudelleenohjaavat raw-palvelimelle ja
// GitHub kuristaa rinnakkaiset pyynnöt, jolloin suurin osa logoista jää
// lataamatta. Osoite kirjoitetaan suoraan lopulliseen muotoon.
const RE_GITHUB_BLOB = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+?)(?:\?.*)?$/i;

/** Osa palvelimen stream_icon-arvoista on roskaa ("[", "[\"\"]"). */
function safeUrl(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  const gh = RE_GITHUB_BLOB.exec(trimmed);
  if (gh) return `https://raw.githubusercontent.com/${gh[1]}/${gh[2]}/${gh[3]}`;
  return trimmed;
}

/** Palvelin palauttaa koko ffprobe-dumpin; talteen vain oleellinen. */
function codecInfo(track) {
  if (!track || !track.codec_name) return null;
  const out = { codec: track.codec_name };
  if (track.width) { out.width = Number(track.width); out.height = Number(track.height) || 0; }
  if (track.channels) out.channels = Number(track.channels);
  return out;
}

function serverUtcOffset(s) {
  if (!s.timestamp_now || !s.time_now) return 0;
  const asUtc = Date.parse(String(s.time_now).replace(' ', 'T') + 'Z');
  if (!Number.isFinite(asUtc)) return 0;
  return asUtc - Number(s.timestamp_now) * 1000;
}

function normalizeProgramme(p) {
  return {
    id: String(p.id || ''),
    title: decodeField(p.title),
    description: decodeField(p.description),
    start: Number(p.start_timestamp) * 1000,
    stop: Number(p.stop_timestamp) * 1000,
  };
}

function normalizeLive(s) {
  return {
    id: String(s.stream_id),
    k: 0,
    n: s.name || '',
    logo: safeUrl(s.stream_icon),
    cats: categoryIds(s),
    epgId: s.epg_channel_id || null,
    archive: String(s.tv_archive) === '1' ? Number(s.tv_archive_duration) || 0 : 0,
    direct: s.direct_source || null,
    num: Number(s.num) || 0,
  };
}

function normalizeMovie(s) {
  return {
    id: String(s.stream_id),
    k: 1,
    n: s.name || '',
    logo: safeUrl(s.stream_icon),
    cats: categoryIds(s),
    ext: s.container_extension || 'mp4',
    rating: Number(s.rating_5based) || 0,
    direct: s.direct_source || null,
    num: Number(s.num) || 0,
  };
}

function normalizeSeries(s) {
  return {
    id: String(s.series_id),
    k: 2,
    n: s.name || '',
    logo: safeUrl(s.cover),
    cats: categoryIds(s),
    plot: s.plot || '',
    genre: s.genre || '',
    rating: Number(s.rating_5based) || 0,
    year: (s.releaseDate || s.release_date || '').slice(0, 4),
    num: Number(s.num) || 0,
  };
}

function categoryIds(s) {
  if (Array.isArray(s.category_ids) && s.category_ids.length) return s.category_ids.map(String);
  return s.category_id != null ? [String(s.category_id)] : [];
}
