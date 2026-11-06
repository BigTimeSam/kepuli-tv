// @ts-check
// A Stalker (Ministra) middleware portal as a catalogue: the same
// questions js/api.js answers for an Xtream account, asked of the portal a
// MAG set-top box talks to.
//
// The portal knows the box by its MAC address, which the provider has
// registered, and nothing else: no user name, no password. The box says it
// in a cookie, "mac=00:1A:79:…", and introduces itself as a MAG250 in its
// User-Agent; many portals turn away a request without both. A page cannot
// set either header on a fetch, so they are set by a session rule of
// declarativeNetRequest for the portal's host alone (portalRule below), and
// the rule goes when the browser closes. The rest is what the box does:
//
//  1. handshake — a token for the session, Authorization: Bearer from then on
//  2. get_profile — the box's details; the portal checks the MAC here
//  3. the lists — genres and channels, the film and series categories, a
//     category's titles one page of 14 or so at a time
//  4. create_link — a stream's address is asked for when it is played: the
//     catalogue holds a "cmd" ("ffrt http://localhost/ch/123_"), the
//     portal turns it into the real address, often with a token that is
//     good for one connection
//
// The answers are JSON in a "js" member. The endpoint is portal.php on most
// portals and server/load.php under stalker_portal on Ministra's own; which
// one it is, the handshake finds out (endpoints below).
//
// What is not here: the archive (tv_archive's create_link takes a programme
// id that only some portals give), and the portal's own XMLTV ids — the
// programmes come from the portal itself.

import { t } from './i18n.js';
import { ApiError, safeUrl } from './api.js';
import { releaseYear } from './mediafilters.js';
import { providerRating } from './rating.js';
import { api as ext } from './browser.js';

const REQUEST_MS = 20000;
const USER_AGENT = 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3';
const X_USER_AGENT = 'Model: MAG250; Link: WiFi';
// A list of a whole type is read this many pages at a time.
const PAGE_WORKERS = 6;
// And no further than this: 30,000 titles at 14 a page.
const MAX_PAGES = 2200;

/** "00:1a:79:ab:cd:ef", "001A79ABCDEF", "00-1A-79-AB-CD-EF" → "00:1A:79:AB:CD:EF", or null. */
export function normalizeMac(value) {
  const hex = String(value || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
  if (hex.length !== 12 || !/^[0-9A-F]{12}$/.test(hex)) return null;
  return hex.match(/../g).join(':');
}

/**
 * The portal's address as the provider gave it, made whole: a scheme
 * when there is none, and the path up to the folder the box loads its
 * page from ("…/c/"). Null when it is no address.
 */
export function normalizePortal(value) {
  let text = String(value || '').trim();
  if (!text) return null;
  if (!/^https?:\/\//i.test(text)) text = `http://${text}`;
  let url;
  try { url = new URL(text); } catch { return null; }
  if (!url.hostname) return null;
  let path = url.pathname.replace(/\/(index\.html?|portal\.php|load\.php)$/i, '/');
  if (!path.endsWith('/')) path += '/';
  return `${url.origin}${path}`;
}

/**
 * The API addresses to try, the likeliest first: the one beside the box's
 * page ("/c/" → "/server/load.php"), then portal.php at the root, then
 * Ministra's own.
 */
export function endpoints(portal) {
  const url = new URL(portal);
  const out = [];
  const path = url.pathname;
  if (/\/c\/$/.test(path)) out.push(`${url.origin}${path.replace(/c\/$/, '')}server/load.php`);
  if (/\/stalker_portal\//.test(path)) out.push(`${url.origin}/stalker_portal/server/load.php`);
  out.push(`${url.origin}${path === '/' || /\/c\/$/.test(path) ? '/' : path}portal.php`);
  out.push(`${url.origin}/portal.php`);
  out.push(`${url.origin}/stalker_portal/server/load.php`);
  return [...new Set(out)];
}

/**
 * The address in a create_link answer, or in a channel's own cmd:
 * "ffmpeg http://…", "ffrt3 http://…", "auto http://…" → "http://…".
 */
export function cmdAddress(cmd) {
  const text = String(cmd || '').trim();
  const m = /(https?:\/\/\S+)/i.exec(text);
  return m ? m[1] : null;
}

/** Whether a cmd names a real stream rather than the portal's placeholder. */
export const cmdIsDirect = (cmd) => {
  const address = cmdAddress(cmd);
  return Boolean(address) && !/^https?:\/\/localhost[:/]/i.test(address);
};

/** A 31-bit hash, for the session rule's id. */
function ruleId(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return 1000 + ((h >>> 0) % 1000000);
}

/**
 * The cookie and the User-Agent of a MAG box on every request to the
 * portal's host, the streams' own included, until the browser closes.
 * False where the browser has no declarativeNetRequest; the portal may
 * still answer, but most turn a box without its cookie away.
 */
export async function portalRule(portal, mac) {
  const dnr = ext?.declarativeNetRequest;
  if (!dnr?.updateSessionRules) return false;
  const host = new URL(portal).hostname;
  const id = ruleId(host);
  // The extension's own requests only: a page elsewhere in the browser
  // asking the portal's host gets no MAC address put on its request.
  const self = new URL(ext.runtime.getURL('')).hostname;
  // One portal at a time: a rule left from another account goes.
  const before = (await dnr.getSessionRules()).map((rule) => rule.id).filter((other) => other !== id);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London';
  const cookie = `mac=${encodeURIComponent(mac)}; stb_lang=en; timezone=${encodeURIComponent(zone)}`;
  await dnr.updateSessionRules({
    removeRuleIds: [id, ...before],
    addRules: [{
      id,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          { header: 'Cookie', operation: 'set', value: cookie },
          { header: 'User-Agent', operation: 'set', value: USER_AGENT },
          { header: 'Referer', operation: 'set', value: portal },
        ],
      },
      condition: { requestDomains: [host], initiatorDomains: [self], resourceTypes: ['xmlhttprequest', 'media', 'other'] },
    }],
  });
  return true;
}

/** No portal's rule left: the account in use is not a Stalker portal. */
export async function clearPortalRules() {
  const dnr = ext?.declarativeNetRequest;
  if (!dnr?.getSessionRules) return;
  const ids = (await dnr.getSessionRules()).map((rule) => rule.id);
  if (ids.length) await dnr.updateSessionRules({ removeRuleIds: ids });
}

function deadline(signal, ms = REQUEST_MS) {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/** The portal's "js" member, which is sometimes a list and sometimes { data }. */
const rowsOf = (js) => (Array.isArray(js) ? js : Array.isArray(js?.data) ? js.data : []);

/** A picture's address: whole, or relative to the portal's folder of them. */
function pictureOf(value, origin) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (/^https?:\/\//i.test(text)) return safeUrl(text);
  if (text.startsWith('/')) return safeUrl(`${origin}${text}`);
  return null;
}

/** "2026-11-03" in the browser's zone. */
function day(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** A programme from the portal: its own timestamps are in seconds. */
export function stalkerProgramme(p) {
  return {
    id: String(p.id ?? p.start_timestamp ?? ''),
    title: String(p.name ?? p.title ?? ''),
    description: String(p.descr ?? p.description ?? ''),
    start: Number(p.start_timestamp) * 1000,
    stop: Number(p.stop_timestamp) * 1000,
  };
}

/** A channel row from get_all_channels or get_ordered_list. */
export function stalkerChannel(ch, origin) {
  return {
    id: String(ch.id),
    k: 0,
    n: String(ch.name || ''),
    logo: pictureOf(ch.logo, origin),
    cats: ch.tv_genre_id != null ? [String(ch.tv_genre_id)] : [],
    // The programmes are asked of the portal by the channel's own id; the
    // guide asks only a channel that has something here.
    epgId: String(ch.xmltv_id || ch.id),
    archive: 0,
    direct: null,
    cmd: String(ch.cmd || ch.cmds?.[0]?.url || ''),
    num: Number(ch.number) || 0,
  };
}

/** A film from a category's page. */
export function stalkerMovie(v, categoryId, origin) {
  const address = cmdAddress(v.cmd);
  const ext = address ? (/\.([a-z0-9]{2,4})(?:[?#]|$)/i.exec(new URL(address, 'http://x').pathname)?.[1] || '').toLowerCase() : '';
  return {
    id: String(v.id),
    k: 1,
    n: String(v.name || ''),
    logo: pictureOf(v.screenshot_uri || v.cover_big || v.pic, origin),
    cats: [String(categoryId ?? v.category_id ?? '')],
    ext: ext || 'mp4',
    durationSec: (Number(v.time) || 0) * 60,
    year: releaseYear(String(v.year || ''), v.name),
    genre: String(v.genres_str || ''),
    rating: providerRating({ rating: v.rating_imdb || v.rating_kinopoisk }),
    ratingScale: 10,
    direct: null,
    cmd: String(v.cmd || ''),
    plot: String(v.description || ''),
    num: 0,
  };
}

export class StalkerSource {
  /** @param {{ url: string, mac: string }} config */
  constructor(config) {
    this.config = config;
    this.portal = normalizePortal(config.url);
    this.mac = normalizeMac(config.mac);
    this.origin = this.portal ? new URL(this.portal).origin : '';
    this.endpoint = null;
    this.token = null;
    this.ready = null;
    this.meta = new Map();      // a film's or a series' row, for its details
  }

  /**
   * The session: the header rule, the handshake and the profile, once.
   * @param {import('./api.js').RequestOptions} [options]
   */
  session({ signal } = {}) {
    if (!this.ready) {
      this.ready = this.open({ signal }).catch((err) => { this.ready = null; throw err; });
    }
    return this.ready;
  }

  async open({ signal }) {
    if (!this.portal) throw new ApiError('muoto', t('stalker.badurl'));
    if (!this.mac) throw new ApiError('muoto', t('stalker.badmac'));
    await portalRule(this.portal, this.mac).catch((err) => console.warn('[iptv] the portal header rule failed', err));
    let hello = null;
    let reached = false;
    for (const endpoint of endpoints(this.portal)) {
      try {
        const answer = await this.raw(endpoint, { type: 'stb', action: 'handshake', token: '', prehash: '0' }, { signal, token: null });
        reached = true;
        if (answer?.js?.token) { this.endpoint = endpoint; hello = answer.js; break; }
      } catch (err) {
        if (err?.name === 'AbortError') throw err;
        if (err instanceof ApiError && err.kind === 'http') reached = true;
        // Every endpoint is on the same host: one that cannot be reached at
        // all will not answer the next path either, and trying all five
        // kept the viewer waiting for a hundred seconds.
        if (err instanceof ApiError && err.kind === 'verkko' && !reached) break;
      }
    }
    if (!hello) throw new ApiError(reached ? 'muoto' : 'verkko', t(reached ? 'stalker.noportal' : 'api.unreachable'));
    this.token = hello.token;
    const profile = await this.call({
      type: 'stb', action: 'get_profile', hd: '1', ver: 'ImageDescription: 0.2.18-r23-250; PORTAL version: 5.6.2; API Version: JS API version: 343',
      num_banks: '2', sn: '', stb_type: 'MAG250', image_version: '218', video_out: 'hdmi', device_id: '', device_id2: '',
      signature: '', auth_second_step: '1', hw_version: '1.7-BD-00', not_valid_token: '0', client_type: 'STB',
      hw_version_2: '', timestamp: String(Math.floor(Date.now() / 1000)), api_signature: '262', prehash: '',
      metrics: JSON.stringify({ mac: this.mac, sn: '', type: 'STB', model: 'MAG250', uid: '', random: hello.random || '' }),
    }, { signal, retry: false });
    const p = profile?.js;
    if (!p || p.blocked === '1' || p.status === 1 || (typeof p === 'object' && !Array.isArray(p) && !p.id && !p.mac && p.status != null && Number(p.status) !== 0)) {
      throw new ApiError('tunnistus', t('stalker.rejected'));
    }
    return p;
  }

  /** One request to the portal; the answer as JSON. */
  async raw(endpoint, params, { signal, token }) {
    const url = `${endpoint}?${new URLSearchParams({ ...params, JsHttpRequest: '1-xml' })}`;
    const headers = { 'X-User-Agent': X_USER_AGENT };
    if (token) headers.Authorization = `Bearer ${token}`;
    let res;
    let text;
    try {
      res = await fetch(url, { headers, signal: deadline(signal), cache: 'no-store', credentials: 'omit' });
      text = await res.text();
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      if (err?.name === 'TimeoutError') throw new ApiError('verkko', t('api.timeout', { seconds: REQUEST_MS / 1000 }));
      throw new ApiError('verkko', t('api.unreachable'));
    }
    if (res.status === 401 || res.status === 403) throw new ApiError('tunnistus', t('stalker.rejected'));
    if (!res.ok) throw new ApiError('http', t('api.status', { status: res.status }));
    try {
      return JSON.parse(text.replace(/^﻿/, '').trim());
    } catch {
      // "Authorization failed." and the like, as plain text.
      if (/authori[sz]ation failed|unauthori[sz]ed/i.test(text)) throw new ApiError('tunnistus', t('stalker.rejected'));
      throw new ApiError('muoto', t('stalker.noportal'));
    }
  }

  /**
   * A request in the session; a token the portal has let go is renewed once.
   * @param {Record<string, string>} params
   * @param {{signal?: AbortSignal, retry?: boolean}} [options]
   */
  async call(params, { signal, retry = true } = {}) {
    if (!this.token) await this.session({ signal });
    try {
      return await this.raw(this.endpoint, params, { signal, token: this.token });
    } catch (err) {
      if (!retry || !(err instanceof ApiError) || err.kind !== 'tunnistus') throw err;
      this.token = null;
      this.ready = null;
      await this.session({ signal });
      return this.raw(this.endpoint, params, { signal, token: this.token });
    }
  }

  /**
   * @param {import('./api.js').RequestOptions} [options]
   */
  async account({ signal } = {}) {
    await this.session({ signal });
    let info = {};
    try { info = (await this.call({ type: 'account_info', action: 'get_main_info' }, { signal }))?.js || {}; } catch (err) {
      if (err?.name === 'AbortError') throw err;
    }
    const end = Date.parse(String(info.end_date || info.expire_billing_date || '').replace(' ', 'T'));
    return {
      kind: 'stalker',
      status: 'Active',
      trial: false,
      expiresAt: Number.isFinite(end) ? end : null,
      createdAt: null,
      maxConnections: null,
      activeConnections: 0,
      outputFormats: [],
      serverTimezone: null,
      serverTimeOffsetMs: 0,
      serverUtcOffsetMs: 0,
      serverZone: null,
      mac: this.mac,
      portal: this.portal,
    };
  }

  /**
   * @param {string} type
   * @param {import('./api.js').RequestOptions} [options]
   */
  async categories(type, { signal } = {}) {
    const params = type === 'live' ? { type: 'itv', action: 'get_genres' }
      : { type: type === 'movie' ? 'vod' : 'series', action: 'get_categories' };
    let rows;
    try { rows = rowsOf((await this.call(params, { signal }))?.js); } catch (err) {
      // A portal without series answers the question with nothing useful.
      if (type === 'series' && err instanceof ApiError && err.kind !== 'verkko') return [];
      throw err;
    }
    return rows
      .filter((c) => c && c.id != null && String(c.id) !== '*')
      .map((c) => ({ id: String(c.id), name: String(c.title || c.name || '') || t('categories.unnamed') }));
  }

  /**
   * @param {string} type
   * @param {string|null} categoryId
   * @param {import('./api.js').StreamOptions} [options]
   */
  async streams(type, categoryId, { signal, onProgress } = {}) {
    if (type === 'live') return this.channels(categoryId, { signal, onProgress });
    const kind = type === 'movie' ? 'vod' : 'series';
    const rows = await this.pages({ type: kind, action: 'get_ordered_list', category: categoryId || '*', sortby: 'added' }, { signal, onProgress });
    const out = [];
    for (const v of rows) {
      if (!v || v.id == null) continue;
      if (type === 'movie') {
        if (String(v.is_series) === '1') continue;
        const item = stalkerMovie(v, categoryId ?? v.category_id, this.origin);
        this.meta.set(`1:${item.id}`, v);
        out.push(item);
      } else {
        const item = {
          id: String(v.id),
          k: 2,
          n: String(v.name || ''),
          logo: pictureOf(v.screenshot_uri || v.cover_big, this.origin),
          cats: [String(categoryId ?? v.category_id ?? '')],
          plot: String(v.description || ''),
          genre: String(v.genres_str || ''),
          rating: providerRating({ rating: v.rating_imdb }),
          ratingScale: 10,
          year: releaseYear(String(v.year || ''), v.name),
          num: 0,
        };
        this.meta.set(`2:${item.id}`, v);
        out.push(item);
      }
    }
    return out;
  }

  /** The channels: all at once where the portal allows it, else genre by genre. */
  async channels(categoryId, { signal, onProgress }) {
    let rows = [];
    if (!this.allChannels) {
      try {
        rows = rowsOf((await this.call({ type: 'itv', action: 'get_all_channels' }, { signal }))?.js);
      } catch (err) {
        if (err?.name === 'AbortError') throw err;
      }
      if (rows.length) this.allChannels = rows;
    }
    rows = this.allChannels || [];
    if (!rows.length) {
      rows = await this.pages({ type: 'itv', action: 'get_ordered_list', genre: categoryId || '*', fav: '0', sortby: 'number' }, { signal, onProgress });
    } else if (onProgress) onProgress(1, 1);
    const list = rows.filter((ch) => ch && ch.id != null).map((ch) => stalkerChannel(ch, this.origin));
    return categoryId && this.allChannels ? list.filter((it) => it.cats.includes(String(categoryId))) : list;
  }

  /**
   * Every page of a paged list, a few at a time.
   * @param {Record<string, string>} params
   * @param {import('./api.js').StreamOptions} [options]
   */
  async pages(params, { signal, onProgress } = {}) {
    const first = (await this.call({ ...params, p: '1' }, { signal }))?.js || {};
    const rows = rowsOf(first);
    const per = Number(first.max_page_items) || rows.length || 14;
    const total = Number(first.total_items) || rows.length;
    const count = Math.min(MAX_PAGES, Math.max(1, Math.ceil(total / per)));
    const results = new Array(count);
    results[0] = rows;
    let next = 2;
    let done = 1;
    if (onProgress) onProgress(done, count);
    const worker = async () => {
      while (next <= count) {
        const page = next++;
        // One failed page of a few hundred lost the whole list; it is asked
        // once more before the list gives up.
        const ask = () => this.call({ ...params, p: String(page) }, { signal });
        const answer = await ask().catch((err) => { if (err?.name === 'AbortError') throw err; return ask(); });
        results[page - 1] = rowsOf(answer?.js);
        done++;
        if (onProgress) onProgress(done, count);
      }
    };
    await Promise.all(Array.from({ length: Math.min(PAGE_WORKERS, count - 1) }, worker));
    return results.flat();
  }

  /**
   * @param {string|number} seriesId
   * @param {import('./api.js').RequestOptions} [options]
   */
  async seriesInfo(seriesId, { signal } = {}) {
    const row = this.meta.get(`2:${seriesId}`) || {};
    const seasons = await this.pages({ type: 'series', action: 'get_ordered_list', movie_id: String(seriesId), season_id: '0', episode_id: '0' }, { signal });
    const episodes = [];
    seasons.forEach((season, index) => {
      const number = Number(/(\d+)/.exec(String(season.name || ''))?.[1]) || index + 1;
      const parts = Array.isArray(season.series) ? season.series : [];
      for (const part of parts) {
        episodes.push({
          id: `${season.id}:${part}`,
          k: 3,
          n: t('api.episode', { number: part }),
          season: number,
          episode: Number(part) || 0,
          ext: '',
          logo: pictureOf(season.screenshot_uri, this.origin),
          plot: '',
          durationSec: 0,
          airDate: '',
          video: null,
          audio: null,
          bitrate: 0,
          direct: null,
          cmd: String(season.cmd || ''),
          part: String(part),
        });
      }
    });
    episodes.sort((a, b) => a.season - b.season || a.episode - b.episode);
    return {
      plot: String(row.description || ''),
      cast: String(row.actors || ''),
      director: String(row.director || ''),
      genre: String(row.genres_str || ''),
      releaseDate: String(row.year || ''),
      cover: pictureOf(row.screenshot_uri, this.origin),
      rating: providerRating({ rating: row.rating_imdb }),
      ratingScale: 10,
      episodes,
    };
  }

  async vodInfo(vodId) {
    const v = this.meta.get(`1:${vodId}`) || {};
    return {
      plot: String(v.description || ''),
      cast: String(v.actors || ''),
      director: String(v.director || ''),
      genre: String(v.genres_str || ''),
      releaseDate: String(v.year || ''),
      cover: pictureOf(v.screenshot_uri, this.origin),
      rating: providerRating({ rating: v.rating_imdb }),
      ratingScale: 10,
      durationSec: (Number(v.time) || 0) * 60,
      ext: null,
      video: null,
      audio: null,
      bitrate: 0,
    };
  }

  /**
   * @param {string|number} streamId
   * @param {number} [limit]
   * @param {import('./api.js').RequestOptions} [options]
   */
  async shortEpg(streamId, limit = 4, { signal } = {}) {
    const data = await this.call({ type: 'itv', action: 'get_short_epg', ch_id: String(streamId), size: String(Math.max(limit, 4)) }, { signal });
    const now = Date.now();
    return rowsOf(data?.js).map(stalkerProgramme).filter((p) => p.stop > now && p.title).slice(0, limit);
  }

  /**
   * Today's programmes, the past ones included, and tomorrow's. Not
   * yesterday's: without the archive there is nothing to do with them.
   * @param {string|number} streamId
   * @param {import('./api.js').RequestOptions} [options]
   */
  async fullEpg(streamId, { signal } = {}) {
    const byStart = new Map();
    for (const date of [day(Date.now()), day(Date.now() + 86400e3)]) {
      try {
        const rows = await this.pages({ type: 'itv', action: 'get_simple_data_table', ch_id: String(streamId), date }, { signal });
        for (const p of rows.map(stalkerProgramme)) if (p.title && p.stop > p.start) byStart.set(p.start, p);
      } catch (err) {
        if (err?.name === 'AbortError') throw err;
      }
    }
    if (!byStart.size) return this.shortEpg(streamId, 20, { signal });
    return [...byStart.values()].sort((a, b) => a.start - b.start);
  }

  /**
   * The address to play an item from, asked of the portal now: its links
   * carry a token that may be good for one connection only.
   * @param {object} item
   * @param {import('./api.js').RequestOptions} [options]
   */
  async resolveUrl(item, { signal } = {}) {
    const cmd = item.cmd || '';
    if (!cmd) throw new ApiError('muoto', t('stalker.nolink'));
    const live = item.k === 0;
    let address = null;
    try {
      const data = await this.call({
        type: live ? 'itv' : 'vod', action: 'create_link', cmd, series: live ? '' : String(item.part || ''),
        forced_storage: 'undefined', disable_ad: '0', download: '0',
      }, { signal });
      address = cmdAddress(data?.js?.cmd);
    } catch (err) {
      if (err?.name === 'AbortError' || !cmdIsDirect(cmd)) throw err;
    }
    if (!address && cmdIsDirect(cmd)) address = cmdAddress(cmd);
    if (!address) throw new ApiError('muoto', t('stalker.nolink'));
    return address;
  }
}
