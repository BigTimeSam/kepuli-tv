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

import { cacheGet, cachePut, cacheAge, cacheClear } from './db.js';
import { localeTag } from './i18n.js';

export const TYPES = ['live', 'movie', 'series'];

// Every list in alphabetical order. The provider's own order is arbitrary —
// channels included, where it varies from one category to the next — and
// browsing a long list needs a predictable order.
//
// Built on demand: the language can change mid-session, and alphabetical
// order is a matter of language. A new Collator per call would be
// measurable load on a list of 55,000 names, so one is made per tag.
let collatorTag = null;
let collatorInstance = null;
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

function sortKey(name) {
  return String(name || '').replace(LEADING_JUNK, '').trim();
}

/**
 * Returns a new, sorted array — the original is left alone, because the
 * same array is shared with several views.
 *
 * @param {{n:string}[]} items
 * @param {((name: string) => string)|null} [label] what to sort by, when the
 *        visible name is something other than item.n (see name.js).
 */
export function sortItems(items, label) {
  if (!items || items.length < 2) return items;
  const compare = collator();
  const keyed = items.map((item, i) => [sortKey(label ? label(item.n) : item.n), i, item]);
  keyed.sort((a, b) => compare.compare(a[0], b[0]) || a[1] - b[1]);
  return keyed.map((entry) => entry[2]);
}

const TTL = {
  categories: 24 * 3600e3,
  full: 6 * 3600e3,
  seriesInfo: 24 * 3600e3,
  vodInfo: 7 * 24 * 3600e3,
};

export class Library {
  constructor(api) {
    this.api = api;
    this.categories = { live: [], movie: [], series: [] };
    this.groups = { live: [], movie: [], series: [] };
    this.full = { live: null, movie: null, series: null };
    this.lower = { live: null, movie: null, series: null };
    this.fullAt = { live: null, movie: null, series: null };
    this.byCategory = new Map();     // "live:3" → items (in memory)
    this.pending = new Map();        // concurrent calls share one promise
    this.details = new Map();        // extra details for a series/movie
  }

  /* ------------------------------------------------------------ categories */

  async loadCategories({ force = false, signal } = {}) {
    await Promise.all(TYPES.map(async (type) => {
      const key = `cats:${type}`;
      if (!force) {
        const cached = await cacheGet(key, TTL.categories);
        if (cached) { this.categories[type] = cached; return; }
      }
      const cats = await this.api.categories(type, { signal });
      this.categories[type] = cats;
      await cachePut(key, cats);
    }));
    for (const type of TYPES) this.groups[type] = buildGroups(this.categories[type]);
    return this.categories;
  }

  categoryName(type, id) {
    const hit = this.categories[type].find((c) => c.id === id);
    return hit ? hit.name : id;
  }

  /** A group's description, found by name. */
  group(type, name) {
    return this.groups[type].find((g) => g.name === name) || null;
  }

  /**
   * One group's entire contents (e.g. "Sweden"): the channels of all its
   * sub-categories as a single list. Fetched once, after which switching
   * between sub-categories is pure filtering in memory.
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
      const items = await this.fetchCategories(type, group.cats.map((c) => c.id), onProgress, signal);
      this.byCategory.set(key, items);
      return items;
    });
  }

  /**
   * Fetches the categories concurrently but assembles the result in
   * category order, so that de-duplication does not depend on the order the
   * answers happen to arrive in. Finally the whole set is sorted.
   */
  async fetchCategories(type, categoryIds, onProgress, signal) {
    const results = new Array(categoryIds.length);
    let next = 0;
    let done = 0;
    const worker = async () => {
      for (;;) {
        const index = next++;
        if (index >= categoryIds.length) return;
        results[index] = await this.api.streams(type, categoryIds[index], { signal });
        done++;
        if (onProgress) onProgress(done, categoryIds.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, categoryIds.length) }, worker));

    const seen = new Set();
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

  /** Per-group counts — known only once the whole list has been fetched. */
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

  isFull(type) { return this.full[type] != null; }

  /** One category's contents. Uses the whole list when it is already in memory. */
  async categoryItems(type, categoryId, { signal } = {}) {
    if (this.full[type]) return this.full[type].filter((it) => it.cats.includes(categoryId));
    const key = `${type}:${categoryId}`;
    const hit = this.byCategory.get(key);
    if (hit) return hit;
    return this.share(key, async () => {
      const items = sortItems(await this.api.streams(type, categoryId, { signal }));
      this.byCategory.set(key, items);
      return items;
    });
  }

  /** A type's whole list. Returns at once if already loaded or cached. */
  async ensureFull(type, { onProgress, force = false, signal } = {}) {
    if (this.full[type] && !force) return this.full[type];
    return this.share(`full:${type}`, async () => {
      const key = `full:${type}`;
      if (!force) {
        const cached = await cacheGet(key, TTL.full);
        if (cached) { this.setFull(type, cached, await cacheAge(key)); return this.full[type]; }
      }
      const items = await this.api.streams(type, null, { onProgress, signal });
      this.setFull(type, items, Date.now());
      await cachePut(key, items);
      return this.full[type];
    });
  }

  setFull(type, items, at) {
    this.full[type] = sortItems(items);
    this.fullAt[type] = at || Date.now();
    // The search index once: 55,000 toLowerCase calls per keystroke would
    // be visible stutter.
    this.lower[type] = this.full[type].map((it) => it.n.toLowerCase());
    this.byCategory.clear();
  }

  /**
   * Searches the whole list; requires ensureFull().
   *
   * Matches are ordered by relevance: a plain substring search would put
   * "KYLE COLLECTION" and "Pink Style" ahead of the Yle channels for the
   * query "yle". A match at the start of a word therefore always beats one
   * found mid-word. Equally ranked matches keep the whole list's order,
   * which is alphabetical.
   */
  search(type, query, categoryId) {
    const items = this.full[type];
    if (!items) return [];
    const lower = this.lower[type];
    const q = query.trim().toLowerCase();
    const scored = [];
    for (let i = 0; i < items.length; i++) {
      if (categoryId && !items[i].cats.includes(categoryId)) continue;
      if (!q) { scored.push([0, i]); continue; }
      const at = lower[i].indexOf(q);
      if (at === -1) continue;
      scored.push([matchScore(lower[i], q, at), i]);
    }
    scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return scored.map(([, i]) => items[i]);
  }

  /** Per-category counts — known only once the whole list has been fetched. */
  categoryCounts(type) {
    const items = this.full[type];
    if (!items) return null;
    const counts = new Map();
    for (const it of items) for (const c of it.cats) counts.set(c, (counts.get(c) || 0) + 1);
    return counts;
  }

  /* --------------------------------------------------------------- details */

  async seriesEpisodes(seriesId) {
    const key = `series:${seriesId}`;
    if (this.details.has(key)) return this.details.get(key);
    return this.share(key, async () => {
      let info = await cacheGet(key, TTL.seriesInfo);
      if (!info) { info = await this.api.seriesInfo(seriesId); await cachePut(key, info); }
      this.details.set(key, info);
      return info;
    });
  }

  async movieDetails(vodId) {
    const key = `vod:${vodId}`;
    if (this.details.has(key)) return this.details.get(key);
    return this.share(key, async () => {
      let info = await cacheGet(key, TTL.vodInfo);
      if (!info) { info = await this.api.vodInfo(vodId); await cachePut(key, info); }
      this.details.set(key, info);
      return info;
    });
  }

  /* ------------------------------------------------------------------ misc */

  /** Prevents the same fetch from running twice concurrently. */
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
    this.lower = { live: null, movie: null, series: null };
    this.fullAt = { live: null, movie: null, series: null };
    this.byCategory.clear();
    this.details.clear();
    await cacheClear();
  }
}

// 0 = the name starts with the query, 1 = a word starts with it, 2 = found
// mid-word. Channel names often carry a country code up front ("FI: Yle
// TV1"), so a start right after such a tag also counts as a word start.
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
 */
export function buildGroups(categories) {
  const prefix = commonPrefix(categories.map((c) => c.name));
  const map = new Map();
  for (const cat of categories) {
    const { group, sub } = splitCategoryName(cat.name, prefix);
    let entry = map.get(group);
    if (!entry) { entry = { name: group, cats: [] }; map.set(group, entry); }
    entry.cats.push({ id: cat.id, name: cat.name, sub });
  }
  return [...map.values()].sort((a, b) => collator().compare(a.name, b.name));
}

/** A "Movies:"-style prefix shared by all of them is pure repetition. */
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

export function splitCategoryName(name, prefix) {
  let rest = prefix && name.startsWith(prefix) ? name.slice(prefix.length) : name;
  rest = rest.trim();
  const i = rest.indexOf(' - ');
  if (i === -1) return { group: rest, sub: null };
  return { group: rest.slice(0, i).trim(), sub: rest.slice(i + 3).trim() };
}
