// @ts-check
// An M3U playlist as a catalogue: the same questions js/api.js answers for
// an Xtream account — the account, the categories, the lists, a series'
// episodes, the programmes — answered from one downloaded file.
//
// The playlist is read once and kept in the cache for PLAYLIST_TTL, the
// channels, films and series in one row and each series' episodes in a row
// of their own, so that a provider's 286,000-line list (measured) is not
// downloaded again for every category and the episodes of 12,000 series
// are not held in memory to show one of them.
//
// What a row of the playlist becomes:
//  - a channel: k 0, played from its address (direct), its programmes from
//    the XMLTV guide (js/guide.js) through tvg-id or its name
//  - a film: k 1
//  - an episode: k 3, gathered under a series (k 2) by the name it shares
//    with the others, "Show S01 E02" (episodeOf in js/m3u.js)
// The category is group-title, as the provider's panel files them; the
// player splits "Sweden - News" into a group and a topic as it does an
// Xtream category name (js/library.js).
//
// An item's id is a hash of what names it in the list rather than of its
// address: a provider that puts a token in its addresses changes them every
// day, and favourites, history and resume points must still find the item.
// The address goes with the item and is brought up to date from the list
// when it is played (withCurrentAddress in js/app.js).

import { t } from './i18n.js';
import { cacheEntry, cacheGet, cachePutMany } from './db.js';
import { safeUrl, ApiError } from './api.js';
import { streamText } from './fetchtext.js';
import { M3uParser, classify, episodeOf, extensionOf, isDivider, shortHash, catchupAddress } from './m3u.js';
import { XmltvGuide } from './guide.js';
import { releaseYear } from './mediafilters.js';
import { providerRating } from './rating.js';

export const PLAYLIST_TTL = 12 * 3600e3;
const TYPES = ['live', 'movie', 'series'];

/**
 * The catalogue a playlist's entries make: categories and items per type,
 * and each series' episodes. Pure, so that it can be checked without a
 * browser; `noGroup` names the category of rows that have none.
 */
export function buildCatalogue(entries, header = {}, noGroup = 'Other') {
  const cats = { live: new Map(), movie: new Map(), series: new Map() };
  const items = { live: [], movie: [], series: [] };
  const episodes = new Map();       // series id → episodes
  const seriesById = new Map();
  const ids = new Set();
  const unique = (base) => {
    let id = base;
    for (let n = 2; ids.has(id); n++) id = `${base}~${n}`;
    ids.add(id);
    return id;
  };
  const category = (type, group) => {
    const name = group || noGroup;
    let cat = cats[type].get(name);
    if (!cat) { cat = { id: shortHash(`${type}|${name}`), name }; cats[type].set(name, cat); }
    return cat.id;
  };
  let num = 0;
  for (const entry of entries) {
    if (isDivider(entry.name)) continue;
    const a = entry.attrs || {};
    const type = classify(entry);
    const logo = safeUrl(a['tvg-logo'] || a.logo || '');
    if (type === 'live') {
      num++;
      const item = {
        id: unique(shortHash(`l|${a['tvg-id'] || ''}|${entry.name}|${entry.group}`)),
        k: 0,
        n: entry.name,
        logo,
        cats: [category('live', entry.group)],
        // Every channel is worth asking the guide about: one with no tvg-id
        // may still be found there by its name.
        epgId: a['tvg-id'] || a['tvg-name'] || entry.name,
        direct: entry.url,
        num: Number(a['tvg-chno']) || num,
      };
      if (a['tvg-name'] && a['tvg-name'] !== entry.name) item.tvgName = a['tvg-name'];
      if (a['tvg-shift']) item.shift = Number(a['tvg-shift']) || 0;
      const mode = (a.catchup || a['catchup-type'] || header.catchup || '').toLowerCase();
      const days = Number(a['catchup-days'] || a.timeshift || a['tvg-rec'] || header.catchupDays) || 0;
      if (mode && days > 0) {
        item.archive = days;
        item.cu = { mode, source: a['catchup-source'] || header.catchupSource || '' };
      } else item.archive = 0;
      items.live.push(item);
    } else if (type === 'movie') {
      items.movie.push({
        id: unique(shortHash(`m|${entry.name}|${entry.group}`)),
        k: 1,
        n: entry.name,
        logo,
        cats: [category('movie', entry.group)],
        ext: extensionOf(entry.url) || 'mp4',
        durationSec: entry.duration > 0 ? Math.round(entry.duration) : 0,
        year: releaseYear('', entry.name),
        genre: '',
        rating: providerRating({}),
        ratingScale: 10,
        direct: entry.url,
        num: 0,
      });
    } else {
      const ep = episodeOf(entry.name) || { series: entry.name, season: 0, episode: 0, title: '' };
      const seriesKey = `s|${ep.series}|${entry.group}`;
      let series = seriesById.get(seriesKey);
      if (!series) {
        series = {
          id: unique(shortHash(seriesKey)),
          k: 2,
          n: ep.series,
          logo,
          cats: [category('series', entry.group)],
          plot: '',
          genre: '',
          rating: providerRating({}),
          ratingScale: 10,
          year: releaseYear('', ep.series),
          num: 0,
        };
        seriesById.set(seriesKey, series);
        items.series.push(series);
        episodes.set(series.id, []);
      }
      // The cover is the first one any episode carries.
      if (!series.logo && logo) series.logo = logo;
      const list = episodes.get(series.id);
      list.push({
        id: shortHash(`e|${series.id}|${ep.season}|${ep.episode}|${entry.name}`),
        k: 3,
        n: ep.title || (ep.episode ? t('api.episode', { number: ep.episode }) : entry.name),
        season: ep.season,
        episode: ep.episode || list.length + 1,
        ext: extensionOf(entry.url) || 'mp4',
        logo,
        plot: '',
        durationSec: entry.duration > 0 ? Math.round(entry.duration) : 0,
        airDate: '',
        video: null,
        audio: null,
        bitrate: 0,
        direct: entry.url,
      });
    }
  }
  for (const list of episodes.values()) list.sort((a, b) => a.season - b.season || a.episode - b.episode);
  return {
    categories: Object.fromEntries(TYPES.map((type) => [type, [...cats[type].values()]])),
    items,
    episodes,
  };
}

export class M3uSource {
  /**
   * @param {{ url: string, epgUrl?: string }} config
   * @param {string} scope the cache prefix: the account's key and "|"
   */
  constructor(config, scope = '') {
    this.config = config;
    this.scope = scope;
    this.catalogue = null;     // { categories, items, guides, at }
    this.loading = null;
    this.guide = null;
    // Set by the caller for the download's progress: (received, total).
    this.onProgress = null;
  }

  /**
   * The playlist, from the cache or downloaded. Shared by concurrent callers.
   * @param {{signal?: AbortSignal, force?: boolean}} [options]
   */
  load({ signal, force = false } = {}) {
    if (this.catalogue && !force) return Promise.resolve(this.catalogue);
    if (!this.loading) this.loading = this.fetchCatalogue({ signal, force }).finally(() => { this.loading = null; });
    return this.loading;
  }

  async fetchCatalogue({ signal, force }) {
    const key = `${this.scope}m3u:catalogue`;
    if (!force) {
      const cached = await cacheEntry(key, PLAYLIST_TTL);
      if (cached && cached.value.url === this.config.url) {
        this.useCatalogue(cached.value, cached.at);
        return this.catalogue;
      }
    }
    const entries = [];
    const parser = new M3uParser(this.config.url, (entry) => entries.push(entry));
    let sawText = false;
    await streamText(this.config.url, {
      signal,
      onProgress: this.onProgress,
      onText: (text) => { if (text) sawText = true; parser.push(text); },
    });
    const { header } = parser.end();
    if (!entries.length) {
      // A page of HTML, a JSON error, an empty answer: not a playlist.
      throw new ApiError('muoto', t(sawText ? 'm3u.notplaylist' : 'm3u.empty'));
    }
    const built = buildCatalogue(entries, header, t('m3u.nogroup'));
    const value = {
      url: this.config.url,
      categories: built.categories,
      items: built.items,
      guides: header.guides,
    };
    const rows = [...built.episodes].map(([id, list]) => [`${this.scope}m3u:eps:${id}`, list]);
    rows.push([key, value]);
    // The episodes stay in memory only if the cache would not take them.
    this.episodes = (await cachePutMany(rows)) ? null : built.episodes;
    this.useCatalogue(value, Date.now());
    return this.catalogue;
  }

  useCatalogue(value, at) {
    this.catalogue = { ...value, at };
    this.byId = null;
    const urls = this.config.epgUrl ? [this.config.epgUrl] : value.guides || [];
    if (!this.guide || this.guide.urls.join() !== urls.join()) {
      this.guide = new XmltvGuide(urls, this.scope, [navigator.language || 'en', 'en']);
    }
  }

  /**
   * The playlist downloaded again, and the guide with it.
   * @param {import('./api.js').RequestOptions} [options]
   */
  async reload({ signal } = {}) {
    this.episodes = null;
    await this.load({ signal, force: true });
    if (this.guide?.available) this.guide.ready({ force: true }).catch(() => {});
  }

  /**
   * The account: a playlist has no subscription to describe, only what it holds.
   * @param {import('./api.js').RequestOptions} [options]
   */
  async account({ signal } = {}) {
    const c = await this.load({ signal });
    return {
      kind: 'm3u',
      status: 'Active',
      trial: false,
      expiresAt: null,
      createdAt: null,
      maxConnections: null,
      activeConnections: 0,
      outputFormats: [],
      serverTimezone: null,
      serverTimeOffsetMs: 0,
      serverUtcOffsetMs: 0,
      serverZone: null,
      counts: { live: c.items.live.length, movie: c.items.movie.length, series: c.items.series.length },
      guide: this.guide?.available ? this.guide.urls : [],
      loadedAt: c.at,
    };
  }

  /**
   * @param {string} type
   * @param {import('./api.js').RequestOptions} [options]
   */
  async categories(type, { signal } = {}) {
    const c = await this.load({ signal });
    return c.categories[type].map((cat) => ({ ...cat }));
  }

  /**
   * @param {string} type
   * @param {string|null} categoryId
   * @param {import('./api.js').StreamOptions} [options]
   */
  async streams(type, categoryId, { signal, onProgress } = {}) {
    const c = await this.load({ signal });
    const list = c.items[type];
    if (onProgress) onProgress(1, 1);
    // Copies: the library writes logos and details onto its items.
    return (categoryId ? list.filter((it) => it.cats.includes(categoryId)) : list).map((it) => ({ ...it }));
  }

  /**
   * @param {string|number} seriesId
   * @param {import('./api.js').RequestOptions} [options]
   */
  async seriesInfo(seriesId, { signal } = {}) {
    const c = await this.load({ signal });
    const series = c.items.series.find((s) => s.id === seriesId);
    const episodes = this.episodes?.get(seriesId) || (await cacheGet(`${this.scope}m3u:eps:${seriesId}`)) || [];
    return {
      plot: '', cast: '', director: '', genre: '', releaseDate: '',
      cover: series?.logo || null,
      rating: providerRating({}),
      ratingScale: 10,
      episodes: episodes.map((ep) => ({ ...ep })),
    };
  }

  /**
   * @param {string|number} vodId
   * @param {import('./api.js').RequestOptions} [options]
   */
  async vodInfo(vodId, { signal } = {}) {
    const c = await this.load({ signal });
    const movie = c.items.movie.find((m) => m.id === vodId);
    return {
      plot: '', cast: '', director: '', genre: '', releaseDate: '',
      cover: movie?.logo || null,
      rating: providerRating({}),
      ratingScale: 10,
      durationSec: movie?.durationSec || 0,
      ext: movie?.ext || null,
      video: null,
      audio: null,
      bitrate: 0,
    };
  }

  channel(streamId) {
    if (!this.catalogue) return null;
    if (!this.byId) this.byId = new Map(this.catalogue.items.live.map((it) => [it.id, it]));
    return this.byId.get(String(streamId)) || null;
  }

  /**
   * @param {string|number} streamId
   * @param {import('./api.js').RequestOptions} [options]
   */
  async programmesOf(streamId, { signal } = {}) {
    await this.load({ signal });
    const item = this.channel(streamId);
    if (!item || !this.guide?.available) return [];
    const list = await this.guide.programmes(item, { signal });
    return list.map((p) => ({ id: String(p.start), title: p.title, description: p.description, start: p.start, stop: p.stop }));
  }

  /**
   * The programmes from the one on now on, as many as asked for.
   * @param {string|number} streamId
   * @param {number} [limit]
   * @param {import('./api.js').RequestOptions} [options]
   */
  async shortEpg(streamId, limit = 4, { signal } = {}) {
    const now = Date.now();
    return (await this.programmesOf(streamId, { signal })).filter((p) => p.stop > now).slice(0, limit);
  }

  /**
   * @param {string|number} streamId
   * @param {import('./api.js').RequestOptions} [options]
   */
  async fullEpg(streamId, { signal } = {}) {
    return this.programmesOf(streamId, { signal });
  }

  /** A programme's address in the channel's archive, or null. */
  catchupUrl(item, startMs, minutes) {
    return catchupAddress(item, startMs, startMs + minutes * 60000);
  }
}
