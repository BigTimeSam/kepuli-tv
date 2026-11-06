// @ts-check
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
import { externalMetadata } from './titlelinks.js';
import { releaseYear } from './mediafilters.js';
import { providerRating } from './rating.js';
import { directSource, serverStamp } from './xtream.js';

// The shapes the provider kinds hand the rest of the player. The other two
// kinds (js/m3usource.js, js/stalker.js) answer with the same ones, so the
// library and the views can treat every account alike. What the provider
// sent is untrusted and loosely typed; these are the shapes after
// normalising.

/**
 * What a request takes from its caller: the signal that cancels it.
 * @typedef {object} RequestOptions
 * @property {AbortSignal} [signal]
 */

/**
 * A list download's options: progress is reported in bytes, with the
 * total when the server said it (0 when not).
 * @typedef {object} StreamOptions
 * @property {AbortSignal} [signal]
 * @property {(loaded: number, total: number) => void} [onProgress]
 */

/**
 * @typedef {'live'|'movie'|'series'} CatalogueType
 */

/**
 * @typedef {object} Category
 * @property {string} id
 * @property {string} name
 */

/**
 * An item of a list as every view reads it. `k` is its kind: 0 a live
 * channel, 1 a film, 2 a series, 3 an episode. The fields after `cats` are
 * the kind's own and missing on the others.
 * @typedef {object} CatalogueItem
 * @property {string} id
 * @property {number} k
 * @property {string} n the name as the provider gave it
 * @property {string|null} logo
 * @property {string[]} cats the ids of the categories it is filed under
 * @property {string|null} [epgId]
 * @property {number} [archive] the days of catch-up a channel keeps, 0 for none
 * @property {string|null} [direct] an address the provider gives besides its own
 * @property {number} [num]
 * @property {string} [ext]
 * @property {number} [durationSec]
 * @property {number|null} [year]
 * @property {string} [genre]
 * @property {string} [plot]
 * @property {number|null} [rating]
 * @property {number} [ratingScale]
 * @property {number} [added] when the provider added it, in milliseconds (films and series)
 * @property {object} [details] a film's details once they have been fetched, see js/library.js
 */

/**
 * One programme of a channel's guide; the times are milliseconds.
 * @typedef {object} Programme
 * @property {string} id
 * @property {string} title
 * @property {string} description
 * @property {number} start
 * @property {number} stop
 */

/**
 * The essentials of one track out of the server's ffprobe dump.
 * @typedef {object} CodecInfo
 * @property {string} codec
 * @property {number} [width]
 * @property {number} [height]
 * @property {number} [channels]
 */

// Fatal, so that bytes which are no UTF-8 throw instead of turning into
// replacement characters: a plain title that happens to be valid base64
// ("News", "Golf") decodes to such bytes, and the throw is what tells it
// apart from a real base64 title and keeps the words as they came.
const TEXT_DECODER = new TextDecoder('utf-8', { fatal: true });

// A request that gets no answer within this is given up: a server that
// accepts the connection and then goes quiet raises no error by itself,
// and without a limit the progress dialog would stay open for good. For a
// list download the limit is between chunks, not over the whole download.
const REQUEST_MS = 20000;

/**
 * The caller's signal, if any, and the time limit as one signal.
 * @param {AbortSignal} [signal]
 * @param {number} [ms]
 * @returns {AbortSignal}
 */
function deadline(signal, ms = REQUEST_MS) {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/** A failed fetch as the error the caller sees. A cancellation is the
 *  caller's own and passes through as it is.
 *  @param {any} err
 *  @returns {Error} */
function networkError(err) {
  if (err && err.name === 'AbortError') return err;
  if (err && err.name === 'TimeoutError') return new ApiError('network', t('api.timeout', { seconds: REQUEST_MS / 1000 }));
  // The browser's own words for it — "Failed to fetch", "NetworkError when
  // attempting to fetch resource" — are English in every language and say
  // no more than that the server was not reached, and a failed fetch has no
  // number to give. The sentence says it; the words go to the console.
  console.warn('[iptv] the server could not be reached:', err);
  return new ApiError('network', t('api.unreachable'));
}

/**
 * The statuses that say something about the account. 512 and 401 are the
 * credentials: Xtream's own refusal and the standard one. 403 is not —
 * it is what a firewall in front of the server, Cloudflare, a block by
 * country or a ban for too many requests answer with, and telling the
 * viewer to check a password that is right sends them the wrong way.
 * @param {number} status
 */
function rejected(status) {
  if (status === 512 || status === 401) throw new ApiError('auth', t('api.rejected'));
  if (status === 403) throw new ApiError('http', t('api.denied'));
}

/**
 * base64 → UTF-8. A bare atob() would mangle non-ASCII letters.
 * @param {string} [value]
 * @returns {string}
 */
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
  /** @param {import('./config.js').Config} config */
  constructor(config) {
    this.config = config;
    this.base = `${config.scheme || 'http'}://${config.host}${config.port ? ':' + config.port : ''}`;
    this.auth = `username=${encodeURIComponent(config.username)}&password=${encodeURIComponent(config.password)}`;
  }

  /**
   * @param {string} action
   * @param {Record<string, string|number>|null} [params]
   */
  url(action, params) {
    // URLSearchParams turns the numbers into their digits, as a query wants
    // them; its declared type asks for strings only.
    const extra = params ? '&' + new URLSearchParams(/** @type {Record<string, string>} */ (params)) : '';
    return `${this.base}/player_api.php?${this.auth}${action ? '&action=' + action : ''}${extra}`;
  }

  /**
   * @param {string} action
   * @param {Record<string, string|number>|null} params
   * @param {RequestOptions} [options]
   * @returns {Promise<any>} the answer as parsed JSON
   */
  async call(action, params, { signal } = {}) {
    let res;
    let text;
    try {
      res = await fetch(this.url(action, params), { signal: deadline(signal), cache: 'no-store', credentials: 'omit' });
      rejected(res.status);
      if (!res.ok) throw new ApiError('http', t('api.status', { status: res.status }));
      text = await res.text();
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw networkError(err);
    }
    try {
      return JSON.parse(text);
    } catch {
      console.warn('[iptv] the answer was not JSON:', text.slice(0, 200));
      throw new ApiError('format', t('api.notxtream'));
    }
  }

  /**
   * Account and server details. Doubles as a connection test.
   * @param {RequestOptions} [options]
   */
  async account({ signal } = {}) {
    const data = await this.call('', null, { signal });
    if (!data || !data.user_info) {
      console.warn('[iptv] the answer had no user_info:', JSON.stringify(data).slice(0, 200));
      throw new ApiError('format', t('api.notxtream'));
    }
    if (String(data.user_info.auth) !== '1') throw new ApiError('auth', t('api.authfailed'));
    const u = data.user_info;
    const s = data.server_info || {};
    const utcOffset = serverUtcOffset(s);
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
      serverUtcOffsetMs: utcOffset,
      // The zone gives the offset at any instant, the measured one only at
      // this one. It is used only when it agrees with the server's own clock
      // now: a zone the browser does not know, or one the panel names while
      // the clock keeps another, would move every catch-up address.
      serverZone: zoneAgrees(s.timezone, utcOffset, Number(s.timestamp_now) * 1000) ? s.timezone : null,
    };
  }

  /**
   * @param {CatalogueType} type
   * @param {RequestOptions} [options]
   * @returns {Promise<Category[]>}
   */
  async categories(type, { signal } = {}) {
    const action = { live: 'get_live_categories', movie: 'get_vod_categories', series: 'get_series_categories' }[type];
    const raw = await this.call(action, null, { signal });
    if (!Array.isArray(raw)) throw new ApiError('format', t('api.nocategories'));
    return raw.map((c) => ({ id: String(c.category_id), name: c.category_name || t('categories.unnamed') }));
  }

  /**
   * Streams by type; categoryId narrows the fetch to one category.
   * onProgress receives the bytes loaded — fetching the whole list is in
   * the megabyte class, so progress has to be shown to the user.
   * @param {CatalogueType} type
   * @param {string|null} categoryId
   * @param {StreamOptions} [options]
   * @returns {Promise<CatalogueItem[]>}
   */
  async streams(type, categoryId, { signal, onProgress } = {}) {
    const action = { live: 'get_live_streams', movie: 'get_vod_streams', series: 'get_series' }[type];
    const params = categoryId ? { category_id: categoryId } : null;
    const raw = onProgress
      ? await this.callStreaming(action, params, { signal, onProgress })
      : await this.call(action, params, { signal });
    if (!Array.isArray(raw)) throw new ApiError('format', t('api.nostreams'));
    return raw.map(type === 'series' ? normalizeSeries : type === 'movie' ? normalizeMovie : normalizeLive);
  }

  /**
   * Like call(), but reports download progress. The time limit runs
   * between chunks: a list of megabytes may take longer than the limit as
   * a whole, but a body that stops arriving is a dead connection.
   * @param {string} action
   * @param {Record<string, string|number>|null} params
   * @param {StreamOptions} options
   * @returns {Promise<any>}
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
      rejected(res.status);
      if (!res.ok) throw new ApiError('http', t('api.status', { status: res.status }));

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
      throw new ApiError('format', t('api.badjson'));
    }
  }

  /**
   * @param {string} seriesId
   * @param {RequestOptions} [options]
   */
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
          direct: directSource(ep.direct_source),
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
      country: info.country || '',
      age: info.age || info.mpaa_rating || '',
      originalTitle: info.o_name || info.original_name || '',
      ...externalMetadata(info),
      cover: safeUrl(info.cover),
      rating: providerRating(info),
      ratingScale: 10,
      episodes,
    };
  }

  /**
   * @param {string} vodId
   * @param {RequestOptions} [options]
   */
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
      country: info.country || '',
      age: info.age || info.mpaa_rating || '',
      originalTitle: info.o_name || info.original_name || '',
      cover: safeUrl(info.movie_image) || safeUrl(info.cover_big),
      rating: providerRating(info),
      ratingScale: 10,
      durationSec: movieDuration(info),
      ...externalMetadata(info, movie),
      ext: movie.container_extension || null,
      video: codecInfo(info.video),
      audio: codecInfo(info.audio),
      bitrate: Number(info.bitrate) || 0,
    };
  }

  /**
   * The upcoming programmes for one channel.
   * @param {string} streamId
   * @param {number} [limit]
   * @param {RequestOptions} [options]
   * @returns {Promise<Programme[]>}
   */
  async shortEpg(streamId, limit = 4, { signal } = {}) {
    const data = await this.call('get_short_epg', { stream_id: streamId, limit }, { signal });
    return (data.epg_listings || []).map(normalizeProgramme);
  }

  /**
   * A channel's whole EPG window, past programmes included (for catch-up).
   * @param {string} streamId
   * @param {RequestOptions} [options]
   * @returns {Promise<Programme[]>}
   */
  async fullEpg(streamId, { signal } = {}) {
    const data = await this.call('get_simple_data_table', { stream_id: streamId }, { signal });
    return (data.epg_listings || []).map(normalizeProgramme);
  }
}

export class ApiError extends Error {
  /**
   * @param {'network'|'auth'|'http'|'format'} kind what failed, for the caller
   *        to tell apart: the network, the credentials, an HTTP status, the
   *        answer's form
   * @param {string} message the sentence the viewer is shown
   */
  constructor(kind, message) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
  }
}

// The provider points its pictures at GitHub HTML pages
// (github.com/…/blob/…?raw=true). Those redirect to the raw server, and
// GitHub throttles concurrent requests, which leaves most of them
// unloaded. The URL is rewritten straight to its final form. For a channel
// this address is only the fallback — js/logos.js has the first say — but
// a film's cover comes from nowhere else.
const RE_GITHUB_BLOB = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+?)(?:\?.*)?$/i;

/**
 * Some of the server's stream_icon values are junk ("[", "[\"\"]").
 * @param {unknown} value
 * @returns {string|null}
 */
export function safeUrl(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  const gh = RE_GITHUB_BLOB.exec(trimmed);
  const url = gh ? `https://raw.githubusercontent.com/${gh[1]}/${gh[2]}/${gh[3]}` : trimmed;
  return namesAFile(url) ? url : null;
}

/**
 * Does the address end in a file name? Part of the provider's catalogue
 * stops at the folder — "https://image.tmdb.org/t/p/w600_and_h900_bestv2"
 * where a poster's path belongs, without the
 * "/cuFPxoFopAjFUz4oIMUzpzeTA8I.jpg" that would make it one — and every
 * row carrying one asked the CDN for a directory and got an error back.
 * The picture would have been hidden a moment later anyway; an address
 * that cannot name a picture is dropped before it is ever requested.
 *
 * The test is the last step of the path, not a list of image extensions: a
 * name is a name whatever it ends in. A query is not judged at all — the
 * name may well be in it, as in "…/logo.php?id=12" and "…/logo?ch=5" —
 * because the point here is to drop what is known to be incomplete, not to
 * guess at what might work.
 * @param {string} url
 * @returns {boolean}
 */
function namesAFile(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.search) return true;
  const path = parsed.pathname;
  return path.slice(path.lastIndexOf('/') + 1).includes('.');
}

/**
 * The server returns the whole ffprobe dump; only the essentials are kept.
 * @param {any} track
 * @returns {CodecInfo|null}
 */
function codecInfo(track) {
  if (!track || !track.codec_name) return null;
  const out = { codec: track.codec_name };
  if (track.width) { out.width = Number(track.width); out.height = Number(track.height) || 0; }
  if (track.channels) out.channels = Number(track.channels);
  const language = track.tags?.language || track.language;
  if (typeof language === 'string' && /^[a-z]{2,3}$/i.test(language)) out.language = language.toLowerCase();
  return out;
}

/**
 * @param {any} s the answer's server_info
 * @returns {number}
 */
function serverUtcOffset(s) {
  if (!s.timestamp_now || !s.time_now) return 0;
  const asUtc = Date.parse(String(s.time_now).replace(' ', 'T') + 'Z');
  if (!Number.isFinite(asUtc)) return 0;
  return asUtc - Number(s.timestamp_now) * 1000;
}

/**
 * Whether the named zone's wall clock at the instant is the one the server reported.
 * @param {unknown} zone
 * @param {number} offsetMs
 * @param {number} atMs
 * @returns {boolean}
 */
function zoneAgrees(zone, offsetMs, atMs) {
  if (typeof zone !== 'string' || !zone || !Number.isFinite(atMs) || atMs <= 0) return false;
  // The two clock readings may be taken a moment apart; offsets come in
  // quarter hours.
  const offset = Math.round(offsetMs / 900000) * 900000;
  const named = serverStamp(atMs, zone, null);
  return named !== null && named === serverStamp(atMs, null, offset);
}

/**
 * @param {any} p
 * @returns {Programme}
 */
function normalizeProgramme(p) {
  return {
    id: String(p.id || ''),
    title: decodeField(p.title),
    description: decodeField(p.description),
    start: Number(p.start_timestamp) * 1000,
    stop: Number(p.stop_timestamp) * 1000,
  };
}

/**
 * @param {any} s
 * @returns {CatalogueItem}
 */
function normalizeLive(s) {
  return {
    id: String(s.stream_id),
    k: 0,
    n: s.name || '',
    logo: safeUrl(s.stream_icon),
    cats: categoryIds(s),
    epgId: s.epg_channel_id || null,
    archive: String(s.tv_archive) === '1' ? Number(s.tv_archive_duration) || 0 : 0,
    direct: directSource(s.direct_source),
    num: Number(s.num) || 0,
  };
}

/**
 * @param {any} s
 * @returns {CatalogueItem}
 */
function normalizeMovie(s) {
  return {
    id: String(s.stream_id),
    k: 1,
    n: s.name || '',
    logo: safeUrl(s.stream_icon),
    cats: categoryIds(s),
    ext: s.container_extension || 'mp4',
    durationSec: movieDuration(s),
    year: releaseYear(s.year || s.releaseDate || s.release_date || s.releasedate, s.name),
    genre: s.genre || '',
    rating: providerRating(s),
    ratingScale: 10,
    direct: directSource(s.direct_source),
    num: Number(s.num) || 0,
    added: addedAt(s.added),
  };
}

/**
 * When the provider added a title, from its seconds since 1970; 0 when it
 * gives none or nonsense.
 * @param {any} value
 * @returns {number}
 */
function addedAt(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
}

/**
 * @param {any} info
 * @returns {number} seconds, 0 when the provider gave none
 */
function movieDuration(info) {
  const seconds = Number(info.duration_secs);
  if (Number.isFinite(seconds) && seconds > 0) return seconds;
  const parts = /^(\d+):([0-5]\d):([0-5]\d)$/.exec(String(info.duration || '').trim());
  return parts ? Number(parts[1]) * 3600 + Number(parts[2]) * 60 + Number(parts[3]) : 0;
}

/**
 * @param {any} s
 * @returns {CatalogueItem}
 */
function normalizeSeries(s) {
  return {
    id: String(s.series_id),
    k: 2,
    n: s.name || '',
    logo: safeUrl(s.cover),
    cats: categoryIds(s),
    plot: s.plot || '',
    genre: s.genre || '',
    rating: providerRating(s),
    ratingScale: 10,
    year: releaseYear(s.releaseDate || s.release_date || s.year, s.name),
    num: Number(s.num) || 0,
    added: addedAt(s.last_modified),
  };
}

/**
 * @param {any} s
 * @returns {string[]}
 */
function categoryIds(s) {
  if (Array.isArray(s.category_ids) && s.category_ids.length) return s.category_ids.map(String);
  return s.category_id != null ? [String(s.category_id)] : [];
}
