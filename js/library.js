// @ts-check
// Laiska datakerros.
//
// Principle: load as little as possible, as late as possible.
//   1. The categories are always fetched (43 kB for all three types).
//   2. Clicking a category fetches only its contents (~2 kB).
//   3. A type's whole list (0.6–2.9 MB) is fetched only when it is really
//      needed: on search or on the "All" selection. After that everything
//      is in memory and searching is instant.
// The whole list is stored in IndexedDB; per-category results are kept in
// memory only, because they are cheap to fetch again and then cannot hang
// around stale.

import { cacheGet, cacheEntry, cachePut, cacheClear } from './db.js';
import { localeTag } from './i18n.js';
import { channelLogo } from './logos.js';
import { internationalChannels } from './international.js';
import { labelCodes, searchKey, searchTerms } from './name.js';

/** @typedef {import('./api.js').CatalogueType} CatalogueType */
/** @typedef {import('./api.js').CatalogueItem} CatalogueItem */
/** @typedef {import('./api.js').Category} Category */
/** @typedef {import('./api.js').RequestOptions} RequestOptions */
/** @typedef {import('./api.js').StreamOptions} StreamOptions */

/**
 * What the library asks of a provider kind: js/api.js's XtreamApi, and the
 * M3U and Stalker sources that answer the same questions. reload() is a
 * playlist's: one file behind every list, downloaded again on Refresh.
 * @typedef {object} Provider
 * @property {(type: CatalogueType, options?: RequestOptions) => Promise<Category[]>} categories
 * @property {(type: CatalogueType, categoryId: string|null, options?: StreamOptions) => Promise<CatalogueItem[]>} streams
 * @property {(seriesId: string, options?: RequestOptions) => Promise<any>} seriesInfo
 * @property {(vodId: string, options?: RequestOptions) => Promise<any>} vodInfo
 * @property {(options?: RequestOptions) => Promise<unknown>} [reload]
 */

/**
 * A row of the category column: the provider's categories that share a
 * country or a subject, each with the topic after the dash (sub), see
 * buildGroups().
 * @typedef {{ name: string, cats: { id: string, name: string, sub: string|null }[] }} Group
 */

/**
 * One value per catalogue type.
 * @template V
 * @typedef {{ live: V, movie: V, series: V }} PerType
 */

/** @type {CatalogueType[]} */
export const TYPES = ['live', 'movie', 'series'];

// Every list in alphabetical order. The provider's own order is arbitrary —
// channels included, where it varies from one category to the next — and
// browsing a long list needs a predictable order.
//
// Built on demand: the language can change mid-session, and alphabetical
// order is a matter of language. A new Collator per call would be
// measurable load on a list of 55,000 names, so one is made per tag.
/** @type {string|null} */
let collatorTag = null;
/** @type {Intl.Collator|null} */
let collatorInstance = null;
/** @returns {Intl.Collator} */
function collator() {
  if (collatorTag !== localeTag()) {
    collatorTag = localeTag();
    collatorInstance = new Intl.Collator(collatorTag, { numeric: true, sensitivity: 'base' });
  }
  return collatorInstance;
}

// Punctuation at the start of a name ("|FI| Title", "- Title") is not a
// letter and must therefore not decide a place in the list.
const LEADING_JUNK = /^[^\p{L}\p{N}]+/u;

/**
 * @param {string} name
 * @returns {string}
 */
function sortKey(name) {
  return String(name || '').replace(LEADING_JUNK, '').trim();
}

/**
 * Returns a new, sorted array — the original is left alone, because the
 * same array is shared with several views.
 *
 * @template {{n: string}} T
 * @param {T[]} items
 * @param {((name: string, item: T) => string)|null} [label] what to sort by, when the
 *        visible name is something other than item.n (see name.js).
 * @returns {T[]}
 */
export function sortItems(items, label) {
  if (!items || items.length < 2) return items;
  const compare = collator();
  // The label is handed the item as well as its name: a name's tidy form
  // can depend on where the item is filed (js/name.js, searchNameCleaner).
  /** @type {[string, number, T][]} */
  const keyed = items.map((item, i) => [sortKey(label ? label(item.n, item) : item.n), i, item]);
  keyed.sort((a, b) => compare.compare(a[0], b[0]) || a[1] - b[1]);
  return keyed.map((entry) => entry[2]);
}

const TTL = {
  categories: 24 * 3600e3,
  full: 6 * 3600e3,
  seriesInfo: 24 * 3600e3,
  vodInfo: 7 * 24 * 3600e3,
};

/**
 * How long a cached row of the library's is good for, by its key — or null
 * for a key that is not the library's. For db.js's cachePurge(): a row past
 * its time is never read again, since every read asks for a fresher one.
 * @param {unknown} key
 * @returns {number|null} milliseconds
 */
export function cacheTtl(key) {
  const name = String(key).slice(String(key).indexOf('|') + 1);
  if (name.startsWith('cats:')) return TTL.categories;
  if (name.startsWith('full:')) return TTL.full;
  if (name.startsWith('series:')) return TTL.seriesInfo;
  if (name.startsWith('vod:')) return TTL.vodInfo;
  // An M3U playlist's rows and its guide's (js/m3usource.js, js/guide.js):
  // read as stale after twelve hours, gone after a day.
  if (name.startsWith('m3u:') || name.startsWith('xmltv:')) return 24 * 3600e3;
  return null;
}

export class Library {
  /**
   * @param {string} [account] the account the catalogue is cached under,
   *        see accountKey() in js/config.js. A request still running for the
   *        previous account, or another tab on another account, writes
   *        under its own name and cannot hand this one its lists.
   * @param {Provider} api
   */
  constructor(api, account = '') {
    this.api = api;
    this.scope = account ? `${account}|` : '';
    /** @type {PerType<Category[]>} */
    this.categories = { live: [], movie: [], series: [] };
    /** @type {PerType<Group[]>} */
    this.groups = { live: [], movie: [], series: [] };
    /** @type {PerType<CatalogueItem[]|null>} */
    this.full = { live: null, movie: null, series: null };
    /** @type {PerType<string[]|null>} */
    this.keys = { live: null, movie: null, series: null };
    /** @type {PerType<number|null>} */
    this.fullAt = { live: null, movie: null, series: null };
    /** @type {number|null} */
    this.categoriesAt = null;        // when the oldest of the categories was fetched
    /** @type {number|null} */
    this.listsAt = null;             // when the oldest list in byCategory was fetched
    /** @type {Map<string, string[]>} */
    this.catCodes = new Map();       // category id → the country codes it names
    /** @type {Set<string>|null} */
    this.globalIds = null;           // the international channels' ids, see international()
    /** @type {Map<string, CatalogueItem[]>} */
    this.byCategory = new Map();     // "live:3" → items (in memory)
    /** @type {Map<string, Promise<any>>} */
    this.pending = new Map();        // concurrent calls share one promise
    /** @type {Map<string, any>} */
    this.details = new Map();        // extra details for a series/movie
    /** @type {{ item: CatalogueItem, onUpdate: (id: string, info: any) => void }[]} */
    this.movieQueue = [];
    this.movieWorkers = 0;
    /** @type {Set<string>} */
    this.movieAttempts = new Set();
  }

  /* ------------------------------------------------------------ categories */

  /**
   * @param {{ force?: boolean, signal?: AbortSignal }} [options]
   * @returns {Promise<PerType<Category[]>>}
   */
  async loadCategories({ force = false, signal } = {}) {
    const times = await Promise.all(TYPES.map(async (type) => {
      const key = `${this.scope}cats:${type}`;
      if (!force) {
        const cached = await cacheEntry(key, TTL.categories);
        if (cached) { this.categories[type] = cached.value; return cached.at; }
      }
      const cats = await this.api.categories(type, { signal });
      this.categories[type] = cats;
      await cachePut(key, cats);
      return Date.now();
    }));
    this.categoriesAt = Math.min(...times);
    for (const type of TYPES) this.groups[type] = buildGroups(this.categories[type]);
    // The channel logos need to know which country a channel belongs to,
    // and the column it is filed under is where that is written down. The
    // group's name rather than the category's: it is the category name
    // with the topic and the repeated prefix already off it, so "Finland"
    // is what is read and not "Live: Finland - Sport".
    this.catCodes = new Map();
    for (const group of this.groups.live) {
      const codes = labelCodes(group.name);
      if (codes.length) for (const cat of group.cats) this.catCodes.set(cat.id, codes);
    }
    this.globalIds = null;
    return this.categories;
  }

  /**
   * @param {CatalogueType} type
   * @param {string} id
   * @returns {string}
   */
  categoryName(type, id) {
    const hit = this.categories[type].find((c) => c.id === id);
    return hit ? hit.name : id;
  }

  /**
   * A group's description, found by name.
   * @param {CatalogueType} type
   * @param {string} name
   * @returns {Group|null}
   */
  group(type, name) {
    return this.groups[type].find((g) => g.name === name) || null;
  }

  /**
   * One group's entire contents (e.g. "Sweden"): the channels of all its
   * sub-categories as a single list. Fetched once, after which switching
   * between sub-categories is pure filtering in memory.
   * @param {CatalogueType} type
   * @param {string} groupName
   * @param {StreamOptions} [options]
   * @returns {Promise<CatalogueItem[]>}
   */
  async groupItems(type, groupName, { onProgress, signal } = {}) {
    const group = this.group(type, groupName);
    if (!group) return [];
    if (this.full[type]) {
      const ids = new Set(group.cats.map((c) => c.id));
      return this.full[type].filter((it) => it.cats.some((c) => ids.has(c)));
    }
    const key = `group:${type}:${groupName}`;
    const hit = this.byCategory.get(key);
    if (hit) return hit;
    return this.share(key, async () => {
      const at = Date.now();
      const items = await this.fetchCategories(type, group.cats.map((c) => c.id), onProgress, signal);
      this.keepList(key, items, at);
      return items;
    });
  }

  /**
   * Fetches the categories concurrently but assembles the result in
   * category order, so that de-duplication does not depend on the order the
   * answers happen to arrive in. Finally the whole set is sorted.
   * @param {CatalogueType} type
   * @param {string[]} categoryIds
   * @param {((done: number, total: number) => void)|undefined} onProgress counts categories, not bytes
   * @param {AbortSignal|undefined} signal
   * @returns {Promise<CatalogueItem[]>}
   */
  async fetchCategories(type, categoryIds, onProgress, signal) {
    const results = new Array(categoryIds.length);
    let next = 0;
    let done = 0;
    const worker = async () => {
      for (;;) {
        const index = next++;
        if (index >= categoryIds.length) return;
        results[index] = this.withLogos(type, await this.api.streams(type, categoryIds[index], { signal }));
        done++;
        if (onProgress) onProgress(done, categoryIds.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, categoryIds.length) }, worker));

    const seen = new Set();
    /** @type {CatalogueItem[]} */
    const out = [];
    for (const items of results) {
      for (const item of items || []) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        out.push(item);
      }
    }
    return sortItems(out);
  }

  /**
   * Per-group counts — known only once the whole list has been fetched.
   * @param {CatalogueType} type
   * @returns {Map<string, number>|null}
   */
  groupCounts(type) {
    const counts = this.categoryCounts(type);
    if (!counts) return null;
    const out = new Map();
    for (const group of this.groups[type]) {
      let total = 0;
      for (const cat of group.cats) total += counts.get(cat.id) || 0;
      out.set(group.name, total);
    }
    return out;
  }

  /* ----------------------------------------------------------------- lists */

  /** @param {CatalogueType} type */
  isFull(type) { return this.full[type] != null; }

  /**
   * One category's contents. Uses the whole list when it is already in memory.
   * @param {CatalogueType} type
   * @param {string} categoryId
   * @param {RequestOptions} [options]
   * @returns {Promise<CatalogueItem[]>}
   */
  async categoryItems(type, categoryId, { signal } = {}) {
    if (this.full[type]) return this.full[type].filter((it) => it.cats.includes(categoryId));
    const key = `${type}:${categoryId}`;
    const hit = this.byCategory.get(key);
    if (hit) return hit;
    return this.share(key, async () => {
      const at = Date.now();
      const items = sortItems(this.withLogos(type, await this.api.streams(type, categoryId, { signal })));
      this.keepList(key, items, at);
      return items;
    });
  }

  /**
   * A category's or a group's list, kept in memory with the time it was asked for.
   * @param {string} key
   * @param {CatalogueItem[]} items
   * @param {number} at
   */
  keepList(key, items, at) {
    this.byCategory.set(key, items);
    if (this.listsAt == null || at < this.listsAt) this.listsAt = at;
  }

  /**
   * A type's whole list. Returns at once if already loaded or cached.
   * @param {CatalogueType} type
   * @param {StreamOptions & { force?: boolean }} [options]
   * @returns {Promise<CatalogueItem[]>}
   */
  async ensureFull(type, { onProgress, force = false, signal } = {}) {
    if (this.full[type] && !force) return this.full[type];
    return this.share(`full:${type}`, async () => {
      const key = `${this.scope}full:${type}`;
      if (!force) {
        const cached = await cacheEntry(key, TTL.full);
        if (cached) { this.setFull(type, cached.value, cached.at); return this.full[type]; }
      }
      const items = await this.api.streams(type, null, { onProgress, signal });
      this.setFull(type, items, Date.now());
      await cachePut(key, items);
      return this.full[type];
    });
  }

  /**
   * @param {CatalogueType} type
   * @param {CatalogueItem[]} items
   * @param {number} [at]
   */
  setFull(type, items, at) {
    this.full[type] = sortItems(this.withLogos(type, items));
    this.fullAt[type] = at || Date.now();
    // The search index once: folding 55,000 names per keystroke would be
    // visible stutter.
    this.keys[type] = this.full[type].map((it) => searchKey(it.n));
    this.byCategory.clear();
    this.listsAt = null;
    if (type === 'live') this.globalIds = null;
  }

  /**
   * Everything the viewer can see the catalogue through, fetched again: the
   * categories, the whole lists already loaded, and — the part Refresh
   * used to miss — the categories and groups opened this session, which
   * stayed in memory as they were first fetched. They are dropped rather
   * than fetched here: the caller asks again for the one on screen, and the
   * rest are fetched when they are next opened.
   *
   * The series' episode lists go too, from memory and from the cache: a
   * series still running is where new things appear. A film's details are
   * kept; they are a title's facts and do not change.
   * @param {StreamOptions} [options]
   */
  async refresh({ signal, onProgress } = {}) {
    // A playlist is one file behind every list: it is downloaded again
    // first, and the lists below are read from the new one.
    if (this.api.reload) await this.api.reload({ signal });
    await this.loadCategories({ force: true, signal });
    for (const type of TYPES) {
      if (this.full[type]) await this.ensureFull(type, { force: true, onProgress, signal });
    }
    this.byCategory.clear();
    this.listsAt = null;
    for (const key of [...this.details.keys()]) if (key.startsWith('series:')) this.details.delete(key);
    await cacheClear(`${this.scope}series:`);
  }

  /**
   * Whether anything in memory is older than the cache would have let it
   * be: a tab left open for a day still shows the day-old lists, because
   * nothing in memory is asked about again by itself.
   * @param {number} [now]
   * @returns {boolean}
   */
  isStale(now = Date.now()) {
    if (this.categoriesAt != null && now - this.categoriesAt > TTL.categories) return true;
    if (this.listsAt != null && now - this.listsAt > TTL.full) return true;
    return TYPES.some((type) => this.fullAt[type] != null && now - this.fullAt[type] > TTL.full);
  }

  /**
   * The ids of the live channels that are in many countries' lists, out of
   * the whole list (js/international.js); null until it is loaded. Worked
   * out once per list: 31,000 channels take some 40 ms.
   * @returns {Set<string>|null}
   */
  international() {
    if (!this.full.live) return null;
    if (!this.globalIds) this.globalIds = internationalChannels(this.full.live, this.groups.live);
    return this.globalIds;
  }

  /**
   * Searches the whole list; requires ensureFull().
   *
   * Matches are ordered by relevance: a plain substring search would put
   * "KYLE COLLECTION" and "Pink Style" ahead of the Yle channels for the
   * query "yle". A match at the start of a word therefore always beats one
   * found mid-word. Equally ranked matches keep the whole list's order,
   * which is alphabetical.
   * @param {CatalogueType} type
   * @param {string} query
   * @param {string|null} [categoryId]
   * @returns {CatalogueItem[]}
   */
  search(type, query, categoryId) {
    const items = this.full[type];
    if (!items) return [];
    const keys = this.keys[type];
    const terms = searchTerms(query);
    // The words back together, for the test that comes first: a name that
    // reads the way the query was typed is the better answer.
    const phrase = terms.join(' ');
    /** @type {[number, number][]} */
    const scored = [];
    for (let i = 0; i < items.length; i++) {
      if (categoryId && !items[i].cats.includes(categoryId)) continue;
      if (!terms.length) { scored.push([0, i]); continue; }
      const score = queryScore(keys[i], terms, phrase);
      if (score == null) continue;
      scored.push([score, i]);
    }
    scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return scored.map(([, i]) => items[i]);
  }

  /**
   * Per-category counts — known only once the whole list has been fetched.
   * @param {CatalogueType} type
   * @returns {Map<string, number>|null}
   */
  categoryCounts(type) {
    const items = this.full[type];
    if (!items) return null;
    const counts = new Map();
    for (const it of items) for (const c of it.cats) counts.set(c, (counts.get(c) || 0) + 1);
    return counts;
  }

  /* --------------------------------------------------------------- details */

  // v2 retains external title IDs and trailers missing from earlier cache entries.
  /**
   * @param {string} seriesId
   * @returns {Promise<any>} the series' details and episodes, see seriesInfo() in js/api.js
   */
  async seriesEpisodes(seriesId) {
    const key = `series:v2:${seriesId}`;
    if (this.details.has(key)) return this.details.get(key);
    return this.share(key, async () => {
      let info = await cacheGet(this.scope + key, TTL.seriesInfo);
      if (!info) { info = await this.api.seriesInfo(seriesId); await cachePut(this.scope + key, info); }
      this.details.set(key, info);
      return info;
    });
  }

  /**
   * @param {string} vodId
   * @returns {Promise<any>} the film's details, see vodInfo() in js/api.js
   */
  async movieDetails(vodId) {
    const key = `vod:v2:${vodId}`;
    if (this.details.has(key)) return this.details.get(key);
    return this.share(key, async () => {
      let info = await cacheGet(this.scope + key, TTL.vodInfo);
      if (!info) { info = await this.api.vodInfo(vodId); await cachePut(this.scope + key, info); }
      this.details.set(key, info);
      return info;
    });
  }

  /**
   * Only the current viewport needs durations; scrolling replaces the queue.
   * @param {CatalogueItem[]} items
   * @param {(id: string, info: any) => void} onUpdate
   */
  warmMovieDurations(items, onUpdate) {
    for (const item of items) {
      if (item.k !== 1 || item.details) continue;
      const cached = this.details.get(`vod:v2:${item.id}`);
      if (cached) {
        item.details = cached;
        item.durationSec = cached.durationSec;
        onUpdate(item.id, cached);
      }
    }
    this.movieQueue = items.filter(item => item.k === 1 && !item.durationSec && !item.details && !this.movieAttempts.has(item.id))
      .map(item => ({ item, onUpdate }));
    this.drainMovieDurations();
  }

  drainMovieDurations() {
    while (this.movieWorkers < 2 && this.movieQueue.length) {
      const { item, onUpdate } = this.movieQueue.shift();
      if (this.movieAttempts.has(item.id)) continue;
      this.movieAttempts.add(item.id);
      this.movieWorkers++;
      this.movieDetails(item.id).then(info => {
        item.details = info;
        item.durationSec = info.durationSec;
        onUpdate(item.id, info);
      }).catch(() => {
        // Optional metadata: leave the duration blank, and do not retry on every paint.
      }).finally(() => {
        this.movieWorkers--;
        this.drainMovieDurations();
      });
    }
  }

  /* ------------------------------------------------------------------ misc */

  /**
   * The channels' logos, from tv-logos rather than from the provider
   * (js/logos.js). Applied wherever channels enter the library, cached
   * lists included: the index ships with the app and a release may know
   * logos the list in IndexedDB was built without.
   *
   * A channel with no match keeps the address the provider sent.
   * @param {CatalogueType} type
   * @param {CatalogueItem[]} items
   * @returns {CatalogueItem[]} the same array
   */
  withLogos(type, items) {
    if (type !== 'live') return items;
    for (const item of items) {
      const logo = channelLogo(item.n, this.channelCodes(item));
      if (logo) item.logo = logo;
    }
    return items;
  }

  /**
   * The country codes a channel's categories name.
   * @param {CatalogueItem} item
   * @returns {string[]}
   */
  channelCodes(item) {
    const cats = item.cats || [];
    // Nearly every channel is in one category, and that category's codes
    // have been worked out already: there is nothing to merge.
    if (cats.length === 1) return this.catCodes.get(cats[0]) || [];
    /** @type {string[]} */
    const out = [];
    for (const id of cats) {
      for (const code of this.catCodes.get(id) || []) if (!out.includes(code)) out.push(code);
    }
    return out;
  }

  /**
   * Prevents the same fetch from running twice concurrently.
   * @template T
   * @param {string} key
   * @param {() => Promise<T>} factory
   * @returns {Promise<T>}
   */
  share(key, factory) {
    const running = this.pending.get(key);
    if (running) return running;
    const promise = factory().finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }

  async reset() {
    this.categories = { live: [], movie: [], series: [] };
    this.groups = { live: [], movie: [], series: [] };
    this.full = { live: null, movie: null, series: null };
    this.keys = { live: null, movie: null, series: null };
    this.fullAt = { live: null, movie: null, series: null };
    this.categoriesAt = null;
    this.listsAt = null;
    this.catCodes.clear();
    this.globalIds = null;
    this.byCategory.clear();
    this.details.clear();
    this.movieQueue = [];
    this.movieAttempts.clear();
    await cacheClear();
  }
}

// 0 = the name starts with the query, 1 = a word starts with it, 2 = found
// mid-word. Channel names often carry a country code up front ("FI: Yle
// TV1"), so a start right after such a tag also counts as a word start.
/**
 * How well a name answers the query, lower is better, null for no answer.
 *
 * A name carrying the words together and in the order they were typed is
 * scored by where they sit — the start of the name, the start of a word,
 * mid-word. A name carrying them all but scattered, "News CNN" for "cnn
 * news", answers too and scores below every contiguous one, so a viewer who
 * did type the name in order still sees it first.
 * @param {string} name the name's search key
 * @param {string[]} terms
 * @param {string} phrase
 * @returns {number|null}
 */
function queryScore(name, terms, phrase) {
  const at = name.indexOf(phrase);
  if (at !== -1) return matchScore(name, phrase, at);
  if (terms.length < 2) return null;
  let worst = 0;
  for (const term of terms) {
    const found = name.indexOf(term);
    if (found === -1) return null;
    worst = Math.max(worst, matchScore(name, term, found));
  }
  // Above every contiguous score, whatever the words did inside the name.
  return 3 + worst;
}

/**
 * @param {string} name
 * @param {string} query
 * @param {number} at
 * @returns {number}
 */
function matchScore(name, query, at) {
  if (at === 0) return 0;
  const before = name.charCodeAt(at - 1);
  const isBoundary = before === 32 || before === 58 || before === 45 || before === 40 || before === 46;
  return isBoundary ? 1 : 2;
}

/**
 * The provider's category names hold two levels encoded into one string:
 * "Sweden - Sport", "Movies: NL - Kids". They are split into a
 * country/subject and a topic, so that 519 categories fit into 81 rows.
 * @param {Category[]} categories
 * @returns {Group[]}
 */
export function buildGroups(categories) {
  const prefix = commonPrefix(categories.map((c) => c.name));
  /** @type {Map<string, Group>} */
  const map = new Map();
  for (const cat of categories) {
    const { group, sub } = splitCategoryName(cat.name, prefix);
    let entry = map.get(group);
    if (!entry) { entry = { name: group, cats: [] }; map.set(group, entry); }
    entry.cats.push({ id: cat.id, name: cat.name, sub });
  }
  return [...map.values()].sort((a, b) => collator().compare(a.name, b.name));
}

/**
 * A "Movies:"-style prefix shared by all of them is pure repetition.
 * @param {string[]} names
 * @returns {string|null}
 */
function commonPrefix(names) {
  if (names.length < 4) return null;
  const counts = new Map();
  for (const name of names) {
    const m = /^([^:]{1,20}):\s+/.exec(name);
    if (m) counts.set(m[1], (counts.get(m[1]) || 0) + 1);
  }
  for (const [prefix, count] of counts) {
    if (count >= names.length * 0.8) return `${prefix}: `;
  }
  return null;
}

/**
 * @param {string} name
 * @param {string|null} [prefix]
 * @returns {{ group: string, sub: string|null }}
 */
export function splitCategoryName(name, prefix) {
  let rest = prefix && name.startsWith(prefix) ? name.slice(prefix.length) : name;
  rest = rest.trim();
  const i = rest.indexOf(' - ');
  if (i === -1) return { group: rest, sub: null };
  return { group: rest.slice(0, i).trim(), sub: rest.slice(i + 3).trim() };
}
