// Xtream Codes player_api.php client.
//
// Quirks of the API that are accounted for here:
//  - a wrong password answers with HTTP 512, not 401
//  - an unknown action returns the account details rather than an error, so
//    the shape of the answer must be checked and the status code cannot be
//    trusted
//  - the EPG title and description are base64 that must be decoded as UTF-8
//  - of the timestamps only *_timestamp is unambiguous; start/end are in
//    the server's time zone (here Europe/Ljubljana)

import { t } from './i18n.js';

const TEXT_DECODER = new TextDecoder();

// A request that gets no answer within this is given up: a server that
// accepts the connection and then goes quiet raises no error by itself,
// and without a limit the progress dialog would stay open for good. For a
// list download the limit is between chunks, not over the whole download.
const REQUEST_MS = 20000;

/** The caller's signal, if any, and the time limit as one signal. */
function deadline(signal, ms = REQUEST_MS) {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/** A failed fetch as the error the caller sees. A cancellation is the
 *  caller's own and passes through as it is. */
function networkError(err) {
  if (err && err.name === 'AbortError') return err;
  if (err && err.name === 'TimeoutError') return new ApiError('verkko', t('api.timeout', { seconds: REQUEST_MS / 1000 }));
  return new ApiError('verkko', t('api.unreachable', { message: err && err.message ? err.message : String(err) }));
}

/** base64 → UTF-8. A bare atob() would mangle non-ASCII letters. */
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
    let text;
    try {
      res = await fetch(this.url(action, params), { signal: deadline(signal), cache: 'no-store', credentials: 'omit' });
      if (res.status === 512 || res.status === 401 || res.status === 403) {
        throw new ApiError('tunnistus', t('api.rejected'));
      }
      if (!res.ok) throw new ApiError('http', t('api.status', { status: res.status, statusText: res.statusText }));
      text = await res.text();
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw networkError(err);
    }
    try {
      return JSON.parse(text);
    } catch {
      console.warn('[iptv] the answer was not JSON:', text.slice(0, 200));
      throw new ApiError('muoto', t('api.notxtream'));
    }
  }

  /** Account and server details. Doubles as a connection test. */
  async account({ signal } = {}) {
    const data = await this.call('', null, { signal });
    if (!data || !data.user_info) {
      console.warn('[iptv] the answer had no user_info:', JSON.stringify(data).slice(0, 200));
      throw new ApiError('muoto', t('api.notxtream'));
    }
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
      // The catch-up URL's timestamp is the server's local time; the offset
      // comes from comparing the time_now string with the unix timestamp.
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
   * Streams by type; categoryId narrows the fetch to one category.
   * onProgress receives the bytes loaded — fetching the whole list is in
   * the megabyte class, so progress has to be shown to the user.
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

  /**
   * Like call(), but reports download progress. The time limit runs
   * between chunks: a list of megabytes may take longer than the limit as
   * a whole, but a body that stops arriving is a dead connection.
   */
  async callStreaming(action, params, { signal, onProgress }) {
    const ctrl = new AbortController();
    const quiet = () => ctrl.abort(new DOMException('no data within the limit', 'TimeoutError'));
    let idle = setTimeout(quiet, REQUEST_MS);
    const parts = [];
    let received = 0;
    let total = 0;
    try {
      const res = await fetch(this.url(action, params), {
        signal: signal ? AbortSignal.any([signal, ctrl.signal]) : ctrl.signal, cache: 'no-store', credentials: 'omit',
      });
      if (res.status === 512 || res.status === 401 || res.status === 403) {
        throw new ApiError('tunnistus', t('api.rejected'));
      }
      if (!res.ok) throw new ApiError('http', t('api.status', { status: res.status, statusText: res.statusText }));

      total = Number(res.headers.get('content-length')) || 0;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let lastTick = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        clearTimeout(idle);
        idle = setTimeout(quiet, REQUEST_MS);
        received += value.byteLength;
        parts.push(decoder.decode(value, { stream: true }));
        const now = performance.now();
        if (now - lastTick > 100) { lastTick = now; onProgress(received, total); }
      }
      parts.push(decoder.decode());
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw networkError(err);
    } finally {
      clearTimeout(idle);
    }
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

  /** The upcoming programmes for one channel. */
  async shortEpg(streamId, limit = 4, { signal } = {}) {
    const data = await this.call('get_short_epg', { stream_id: streamId, limit }, { signal });
    return (data.epg_listings || []).map(normalizeProgramme);
  }

  /** A channel's whole EPG window, past programmes included (for catch-up). */
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

// The provider points channel logos at GitHub HTML pages
// (github.com/…/blob/…?raw=true). Those redirect to the raw server, and
// GitHub throttles concurrent requests, which leaves most logos unloaded.
// The URL is rewritten straight to its final form.
const RE_GITHUB_BLOB = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+?)(?:\?.*)?$/i;

/** Some of the server's stream_icon values are junk ("[", "[\"\"]"). */
function safeUrl(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  const gh = RE_GITHUB_BLOB.exec(trimmed);
  if (gh) return `https://raw.githubusercontent.com/${gh[1]}/${gh[2]}/${gh[3]}`;
  return trimmed;
}

/** The server returns the whole ffprobe dump; only the essentials are kept. */
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
