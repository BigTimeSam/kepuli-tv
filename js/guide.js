// An XMLTV programme guide for an M3U playlist's channels.
//
// The guide is one file for every channel, so it is downloaded once and
// kept: each channel's programmes as a row of their own in IndexedDB, and an
// index of the guide's channels — ids and names — to match the playlist's
// channels against. A session that finds the guide fresh in the cache reads
// only the rows of the channels it shows.
//
// A playlist channel finds its programmes by its tvg-id; failing that, by
// its name against the guide's display names, folded the same way on both
// sides (channelMatchKey in js/xmltv.js), since a provider's tvg-id and the
// guide's id do not always agree on case or spelling.

import { cacheEntry, cacheGet, cachePutMany } from './db.js';
import { streamText } from './fetchtext.js';
import { XmltvParser, settle, channelMatchKey } from './xmltv.js';

export const GUIDE_TTL = 12 * 3600e3;
// Programmes further back than this are of no use: the longest catch-up a
// provider offers is a week or two.
const KEEP_PAST_MS = 14 * 86400e3;
const RETRY_MS = 5 * 60e3;

export class XmltvGuide {
  /**
   * @param {string[]} urls the guide's addresses, merged in order
   * @param {string} scope the cache prefix, the account's key and "|"
   * @param {string[]} languages the reader's languages, for titles given in several
   */
  constructor(urls, scope, languages = []) {
    this.urls = urls.filter(Boolean);
    this.scope = scope;
    this.languages = languages;
    this.index = null;          // { ids: Set, byLower: Map, byName: Map }
    this.memory = null;         // channel id → programmes, after a download this session
    this.loading = null;
    this.failed = null;
    this.failedAt = null;
    this.loadedAt = null;
  }

  get available() { return this.urls.length > 0; }

  /** The guide's index, from the cache or downloaded. Shared by concurrent callers. */
  ready({ signal, force = false } = {}) {
    if (!this.available) return Promise.resolve(false);
    if (this.index && !force && Date.now() - this.loadedAt < GUIDE_TTL) return Promise.resolve(true);
    // A guide that could not be read is not asked for again by every row
    // of the list: it waits RETRY_MS, or for a forced read (access granted).
    if (!force && !this.index && this.failedAt && Date.now() - this.failedAt < RETRY_MS) return Promise.resolve(false);
    if (!this.loading) {
      this.loading = this.load({ signal, force }).finally(() => { this.loading = null; });
    }
    return this.loading;
  }

  async load({ signal, force }) {
    const key = `${this.scope}xmltv:index`;
    if (!force) {
      const cached = await cacheEntry(key, GUIDE_TTL);
      if (cached && same(cached.value.urls, this.urls)) {
        this.useIndex(cached.value);
        this.loadedAt = cached.at;
        return true;
      }
    }
    const channels = new Map();          // id → names
    const programmes = new Map();        // id → list
    const parser = new XmltvParser({
      languages: this.languages,
      onChannel: (c) => {
        const names = channels.get(c.id) || [];
        for (const name of c.names) if (!names.includes(name)) names.push(name);
        channels.set(c.id, names);
      },
      onProgramme: (id, p) => {
        let list = programmes.get(id);
        if (!list) { list = []; programmes.set(id, list); }
        list.push(p);
      },
    });
    let read = 0;
    for (const url of this.urls) {
      try {
        await streamText(url, { signal, onText: (text) => parser.push(text) });
        read++;
      } catch (err) {
        if (err && err.name === 'AbortError') throw err;
        console.warn('[iptv] the programme guide could not be read', err);
        this.failed = err;
      }
    }
    parser.end();
    if (!read) { this.failedAt = Date.now(); return false; }
    this.failedAt = null;
    const oldest = Date.now() - KEEP_PAST_MS;
    for (const [id, list] of programmes) {
      const kept = settle(list).filter((p) => p.stop > oldest);
      if (kept.length) programmes.set(id, kept); else programmes.delete(id);
    }
    const index = {
      urls: this.urls,
      ids: [...new Set([...channels.keys(), ...programmes.keys()])],
      names: [...channels].map(([id, names]) => [id, names]),
    };
    this.useIndex(index);
    this.memory = programmes;
    this.loadedAt = Date.now();
    this.failed = null;
    // Written in one go, the index last, so that an index in the cache
    // always has its rows there too.
    const rows = [...programmes].map(([id, list]) => [`${this.scope}xmltv:p:${id}`, list]);
    for (const id of index.ids) if (!programmes.has(id)) rows.push([`${this.scope}xmltv:p:${id}`, []]);
    // Once kept, the rows are read from the cache like a later session's:
    // the whole guide need not stay in memory for the few channels shown.
    if (await cachePutMany(rows) && await cachePutMany([[key, index]])) this.memory = null;
    return true;
  }

  useIndex(index) {
    const ids = new Set(index.ids);
    const byLower = new Map();
    for (const id of ids) byLower.set(id.toLowerCase(), id);
    const byName = new Map();
    for (const [id, names] of index.names) {
      for (const name of names) {
        const k = channelMatchKey(name);
        if (k && !byName.has(k)) byName.set(k, id);
      }
      const k = channelMatchKey(id);
      if (k && !byName.has(k)) byName.set(k, id);
    }
    this.index = { ids, byLower, byName };
  }

  /** The guide's channel for a playlist channel, or null. */
  channelFor(item) {
    if (!this.index) return null;
    const { ids, byLower, byName } = this.index;
    const tvgId = item.epgId;
    if (tvgId) {
      if (ids.has(tvgId)) return tvgId;
      const lower = byLower.get(String(tvgId).toLowerCase());
      if (lower) return lower;
    }
    for (const name of [item.tvgName, item.n]) {
      const k = channelMatchKey(name);
      if (k && byName.has(k)) return byName.get(k);
    }
    return null;
  }

  /** A playlist channel's programmes, in time order, moved by its tvg-shift. */
  async programmes(item, { signal } = {}) {
    if (!(await this.ready({ signal }))) return [];
    const id = this.channelFor(item);
    if (!id) return [];
    let list = this.memory?.get(id);
    if (!list) list = (await cacheGet(`${this.scope}xmltv:p:${id}`)) || [];
    const shift = Number(item.shift) || 0;
    if (!shift) return list.slice();
    const ms = shift * 3600e3;
    return list.map((p) => ({ ...p, start: p.start + ms, stop: p.stop + ms }));
  }
}

const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => x === b[i]);
