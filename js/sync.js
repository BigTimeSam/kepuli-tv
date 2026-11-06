// @ts-check
// Sync between computers: the accounts, the settings and each account's
// favourites, channel lists, reminders, history and resume points carried
// in the browser's own storage.sync, which Chrome and Firefox keep in the
// viewer's browser account and bring to every computer signed in to it.
// Nothing goes to any server of ours; there is none.
//
// storage.sync is small and rationed: 100 kB in all, 8 kB a row, 120
// writes a minute. So:
//  - each record (the accounts, the settings, one list of one account) is
//    JSON, deflated and base64'd, in rows of CHUNK characters, with a row
//    of its own saying what it is, when it was written and its hash
//  - the history and the resume points go up trimmed to their newest
//  - writes wait a moment and go together, the busy lists longer
//  - only one open player tab syncs: the one holding the lock
//
// Who wins when two computers changed the same thing: the later write, as
// a whole record — except where joining is plainly right. The history and
// the resume points are joined entry by entry, the newest of each kept;
// and the first sync of a computer joins its accounts and favourites with
// what the others have, so that turning sync on loses nothing.
//
// Passwords go only when the viewer asks for them: without, an Xtream
// account arrives without its password (and keeps the one it has where it
// is known already), and a playlist whose address carries credentials does
// not go at all.

import { api } from './browser.js';
import { accountKey, PERSONAL, isConfigured } from './config.js';
import { shortHash } from './m3u.js';

const CHUNK = 7000;
const LOCK = 'kepuli-tv-sync';
const QUICK_MS = 3000;          // the accounts, the settings, favourites
const SLOW_MS = 60000;          // the history and the resume points
const KEEP = { recents: 25, resume: 100 };
const QUOTA = 100 * 1024;

const area = () => api.storage.sync;

/* --------------------------------------------------------------- coding */

async function pack(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const packed = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = '';
  for (let i = 0; i < packed.length; i += 0x8000) binary += String.fromCharCode(...packed.subarray(i, i + 0x8000));
  return btoa(binary);
}

async function unpack(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return JSON.parse(await new Response(stream).text());
}

const rowKey = (name) => `r${shortHash(name)}`;
const chunkKey = (name, i) => `${rowKey(name)}_${i}`;

/* ------------------------------------------------------------- records */

const itemKey = (item) => `${item.k}:${item.id}`;
const hasCredentialsInAddress = (url) => /[?&](password|pass|pwd|token|key)=/i.test(String(url || '')) || /\/\/[^/@]+:[^/@]+@/.test(String(url || ''));

/**
 * The accounts as they go up: without passwords unless asked for. Without,
 * an Xtream account goes with its password blank, a guide address that
 * carries credentials goes blank, and a playlist whose own address carries
 * them does not go at all — nor do its lists (localRecords).
 */
export function outgoingAccounts(accounts, passwords) {
  if (passwords) return accounts;
  return accounts
    // A Stalker portal knows its viewer by the MAC address alone, which is
    // as good as a password: such an account stays home, its lists with it.
    .filter((a) => a.type !== 'stalker')
    .filter((a) => a.type !== 'm3u' || !hasCredentialsInAddress(a.url))
    .map((a) => {
      const out = a.type === 'm3u' ? { ...a } : { ...a, password: '' };
      if (hasCredentialsInAddress(out.epgUrl)) out.epgUrl = '';
      return out;
    });
}

/**
 * A list's items as they go up without passwords: the stream addresses
 * left behind (direct, an archive's cu), since a provider's carry the user
 * name and the password in their path. The computer they come to finds them
 * again in its own catalogue when the item is played (withCurrentAddress in
 * js/app.js). A reminder's channel the same.
 */
export function strippedItems(list, value) {
  const strip = (item) => {
    if (!item || typeof item !== 'object') return item;
    const { direct, cu, ...rest } = item;
    return rest;
  };
  if (list === 'favorites' || list === 'recents') return (value || []).map(strip);
  if (list === 'reminders') return (value || []).map((r) => (r && r.channel ? { ...r, channel: strip(r.channel) } : r));
  return value;
}

/**
 * The name a list goes up under: the list and a hash of the account's key,
 * never the key itself — a playlist's key is its address, and an Xtream
 * account's names the server and the user.
 */
export const syncName = (list, key) => `${list}:${shortHash(key)}`;

/**
 * The accounts as they come down, joined with the ones here: a password
 * the incoming one lacks is kept from here. On a first sync (join) the
 * ones only here stay as well.
 */
export function incomingAccounts(remote, local, { join = false } = {}) {
  const here = new Map(local.map((a) => [a.id, a]));
  const byKey = new Map(local.map((a) => [accountKey(a), a]));
  const out = remote.map((a) => {
    const mine = here.get(a.id) || byKey.get(accountKey(a));
    return mine && !a.password && mine.password ? { ...a, password: mine.password } : a;
  });
  if (join) {
    const ids = new Set(out.map((a) => a.id));
    const keys = new Set(out.map((a) => accountKey(a)));
    for (const a of local) if (!ids.has(a.id) && !keys.has(accountKey(a))) out.push(a);
  }
  return out;
}

/** The history joined entry by entry: the latest watch of each, newest first. */
export function joinRecents(a = [], b = [], limit = 60) {
  const best = new Map();
  for (const entry of [...a, ...b]) {
    const key = itemKey(entry);
    const had = best.get(key);
    if (!had || (entry.watchedAt || 0) > (had.watchedAt || 0)) best.set(key, entry);
  }
  return [...best.values()].sort((x, y) => (y.watchedAt || 0) - (x.watchedAt || 0)).slice(0, limit);
}

/** The resume points joined: the later of each, the newest `limit` kept. */
export function joinResume(a = {}, b = {}, limit = 400) {
  const out = { ...a };
  for (const [key, point] of Object.entries(b)) if (!out[key] || (point.at || 0) > (out[key].at || 0)) out[key] = point;
  return Object.fromEntries(Object.entries(out).sort((x, y) => (y[1].at || 0) - (x[1].at || 0)).slice(0, limit));
}

/** Favourites joined on a first sync: every one from either side, once. */
export function joinFavorites(a = [], b = []) {
  const seen = new Set();
  const out = [];
  for (const item of [...a, ...b]) {
    const key = itemKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/** What a list goes up as: the busy ones trimmed to their newest. */
function trimmed(name, value) {
  if (name === 'recents') return (value || []).slice(0, KEEP.recents);
  if (name === 'resume') return joinResume(value || {}, {}, KEEP.resume);
  return value;
}

/* ---------------------------------------------------------------- sync */

/**
 * The sync of this browser, run by the one tab that holds the lock.
 * prefs: { enabled, passwords } from storage.local 'sync'.
 */
export class Sync {
  /** @param {{onStatus?: (status: object) => void}} [options] */
  constructor({ onStatus } = {}) {
    this.onStatus = onStatus || (() => {});
    this.prefs = { enabled: false, passwords: false };
    this.leader = false;
    this.timers = new Map();      // record name → timer
    this.dirty = new Set();
    this.state = {};              // record name → { at, h }: what was last synced
    this.busy = Promise.resolve();
    this.status = { at: null, error: null };
  }

  /** Becomes the syncing tab when no other is; returns at once either way. */
  start() {
    if (!area() || !globalThis.navigator?.locks) return;
    navigator.locks.request(LOCK, () => new Promise((hold) => {
      this.leader = true;
      this.release = hold;
      this.begin();
    }));
  }

  async begin() {
    const data = await api.storage.local.get(['sync', 'syncState', 'syncStatus']);
    this.prefs = { enabled: false, passwords: false, ...(data.sync || {}) };
    this.state = data.syncState || {};
    this.status = data.syncStatus || { at: null, error: null };
    api.storage.onChanged.addListener((changes, where) => this.onChanged(changes, where));
    if (this.prefs.enabled) await this.run(() => this.pullAll()).then(() => this.pushAll());
  }

  /** The viewer's choices, from Settings. Turning sync on syncs now. */
  async setPrefs(prefs) {
    // Only written: the tab that holds the lock — this one or another —
    // hears the change through storage and acts on it in onChanged, where
    // the choice before and after are both known.
    const { sync } = await api.storage.local.get('sync');
    await api.storage.local.set({ sync: { enabled: false, passwords: false, ...(sync || {}), ...prefs } });
  }

  onChanged(changes, where) {
    if (!this.leader) return;
    if (where === 'local') {
      if (changes.sync) {
        const before = this.prefs;
        this.prefs = { enabled: false, passwords: false, ...(changes.sync.newValue || {}) };
        if (this.prefs.enabled && !before.enabled) {
          // A first sync of this computer joins, see the top of the file.
          this.state = {};
          this.run(() => this.pullAll({ join: true })).then(() => this.pushAll());
        } else if (this.prefs.enabled && this.prefs.passwords !== before.passwords) {
          // Every record again, in the form the choice now asks for: turned
          // off, what went up with its addresses must not stay up there.
          this.run(() => this.push(null));
        }
        else if (!this.prefs.enabled && before.enabled) this.stop();
        return;
      }
      if (!this.prefs.enabled) return;
      for (const key of Object.keys(changes)) {
        const name = recordOf(key);
        if (name) this.schedule(name, /^(recents|resume):/.test(name) ? SLOW_MS : QUICK_MS);
      }
    } else if (where === 'sync' && this.prefs.enabled) {
      if (Object.keys(changes).some((key) => /^r[0-9a-z]+$/.test(key))) this.run(() => this.pullAll());
    }
  }

  stop() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.dirty.clear();
  }

  schedule(name, ms) {
    this.dirty.add(name);
    if (this.timers.has(name)) return;
    this.timers.set(name, setTimeout(() => {
      this.timers.delete(name);
      this.run(() => this.push([...this.dirty].filter((n) => !this.timers.has(n))));
    }, ms));
  }

  /** One sync job at a time, in order. */
  run(job) {
    this.busy = this.busy.then(job).catch((err) => this.report(err));
    return this.busy;
  }

  async report(err) {
    console.warn('[iptv] sync', err);
    this.status = { at: this.status.at, error: String(err?.message || err) };
    await api.storage.local.set({ syncStatus: this.status });
    this.onStatus(this.status);
  }

  async ok() {
    this.status = { at: Date.now(), error: null };
    await api.storage.local.set({ syncStatus: this.status, syncState: this.state });
    this.onStatus(this.status);
  }

  /** Every record there is here, by name, as it would go up. */
  async localRecords(names = null) {
    const data = await api.storage.local.get(null);
    const accounts = Array.isArray(data.accounts) ? data.accounts : [];
    const out = new Map();
    const want = (name) => !names || names.includes(name);
    const going = outgoingAccounts(accounts.filter(isConfiguredLoose), this.prefs.passwords);
    if (want('accounts')) out.set('accounts', going);
    if (want('settings') && data.settings) out.set('settings', data.settings);
    // The lists of the accounts that go, and only those: a playlist kept
    // back for the credentials in its address keeps its lists back too.
    const keys = new Set(going.map((a) => accountKey(a)));
    for (const key of Object.keys(data)) {
      const colon = key.indexOf(':');
      const list = key.slice(0, colon);
      const account = key.slice(colon + 1);
      if (colon < 0 || !PERSONAL.includes(list) || !keys.has(account)) continue;
      const name = syncName(list, account);
      if (!want(name)) continue;
      const value = trimmed(list, data[key]);
      out.set(name, this.prefs.passwords ? value : strippedItems(list, value));
    }
    return out;
  }

  async pushAll() { await this.run(() => this.push(null)); }

  /** The records named (or all) up where they differ from what was last synced. */
  async push(names) {
    if (!this.prefs.enabled) return;
    for (const name of names || []) this.dirty.delete(name);
    const records = await this.localRecords(names);
    const set = {};
    const remove = [];
    const current = await area().get(null);
    for (const [name, value] of records) {
      const json = JSON.stringify(value);
      const h = shortHash(json);
      if (this.state[name]?.h === h) continue;
      const text = await pack(value);
      const parts = Math.ceil(text.length / CHUNK) || 1;
      const at = Date.now();
      set[rowKey(name)] = { n: name, at, h, c: parts };
      for (let i = 0; i < parts; i++) set[chunkKey(name, i)] = text.slice(i * CHUNK, (i + 1) * CHUNK);
      const before = current[rowKey(name)];
      for (let i = parts; before && i < before.c; i++) remove.push(chunkKey(name, i));
      this.state[name] = { at, h };
    }
    if (names == null) remove.push(...(await this.leftovers(current, records)));
    if (!Object.keys(set).length && !remove.length) { await this.ok(); return; }
    const size = new Blob([JSON.stringify({ ...current, ...set })]).size;
    if (size > QUOTA) throw new Error('quota');
    if (Object.keys(set).length) await area().set(set);
    if (remove.length) await area().remove(remove);
    await this.ok();
  }

  /**
   * The rows up there that should not be: a list named the way 1.5.0 named
   * them, by the account's own key — a playlist's address — and the lists of
   * an account this computer knows but keeps home now (a playlist whose
   * address carries credentials, without "Include passwords"). A list of an
   * account this computer does not know is left alone: it is another
   * computer's.
   */
  async leftovers(current, records) {
    const data = await api.storage.local.get('accounts');
    const known = new Set((data.accounts || []).map((a) => shortHash(accountKey(a))));
    const going = new Set((records.get('accounts') || []).map((a) => shortHash(accountKey(a))));
    const remove = [];
    for (const [key, meta] of Object.entries(current)) {
      if (!/^r[0-9a-z]+$/.test(key) || !meta || !meta.n || !meta.n.includes(':')) continue;
      const name = meta.n;
      const hash = name.slice(name.indexOf(':') + 1);
      const oldForm = !/^[a-z]+:[0-9a-z]+$/.test(name);
      const keptHome = known.has(hash) && !going.has(hash);
      if (!oldForm && !keptHome) continue;
      remove.push(key);
      for (let i = 0; i < (meta.c || 0); i++) remove.push(chunkKey(name, i));
      delete this.state[name];
    }
    return remove;
  }

  /** Everything up there that is newer than what this computer last took. */
  async pullAll({ join = false } = {}) {
    if (!this.prefs.enabled) return;
    const remote = await area().get(null);
    const local = await api.storage.local.get(null);
    const set = {};
    // The accounts first: a list's name says only a hash of its account's
    // key, and the key it is kept under here is found among the accounts.
    const metas = Object.entries(remote)
      .filter(([key, meta]) => /^r[0-9a-z]+$/.test(key) && meta && meta.n)
      .sort(([, a], [, b]) => Number(b.n === 'accounts') - Number(a.n === 'accounts'));
    for (const [, meta] of metas) {
      const name = meta.n;
      const mine = this.state[name];
      if (mine && (mine.h === meta.h || mine.at >= meta.at)) continue;
      const target = name === 'accounts' || name === 'settings' ? name : this.localKey(name, set.accounts || local.accounts);
      if (!target) continue;          // an account this computer does not have
      let text = '';
      for (let i = 0; i < meta.c; i++) text += remote[chunkKey(name, i)] || '';
      let value;
      try { value = await unpack(text); } catch { continue; }      // half written: the rest is on its way
      set[target] = this.merge(target, value, local[target], { join: join || !mine });
      this.state[name] = { at: meta.at, h: meta.h };
    }
    if (Object.keys(set).length) await api.storage.local.set(set);
    await this.ok();
  }

  /** The storage.local key of a list that came down under its sync name, or null. */
  localKey(name, accounts) {
    const colon = name.indexOf(':');
    const list = name.slice(0, colon);
    const hash = name.slice(colon + 1);
    if (!PERSONAL.includes(list)) return null;
    const account = (accounts || []).map((a) => accountKey(a)).find((key) => shortHash(key) === hash);
    return account ? `${list}:${account}` : null;
  }

  /** What a record becomes here, from what came down and what was here. */
  merge(name, remote, local, { join }) {
    if (name === 'accounts') return incomingAccounts(remote || [], local || [], { join });
    if (name === 'settings') return { ...(local || {}), ...(remote || {}) };
    const list = name.slice(0, name.indexOf(':'));
    if (list === 'recents') return joinRecents(keepAddresses(list, remote, local), local);
    if (list === 'resume') return joinResume(local, remote);
    if (list === 'favorites' && join) return joinFavorites(local, keepAddresses(list, remote, local));
    return keepAddresses(list, remote, local);
  }
}

/**
 * Items that came without their stream addresses (strippedItems) given back
 * the ones this computer already knows for them.
 */
export function keepAddresses(list, remote, local) {
  if (!Array.isArray(remote) || !Array.isArray(local)) return remote;
  const known = new Map();
  const of = (entry) => (list === 'reminders' ? entry && entry.channel : entry);
  for (const entry of local) { const item = of(entry); if (item && item.direct) known.set(itemKey(item), item); }
  if (!known.size) return remote;
  const fill = (item) => {
    if (!item || item.direct) return item;
    const had = known.get(itemKey(item));
    return had ? { ...item, direct: had.direct, ...(had.cu ? { cu: had.cu } : {}) } : item;
  };
  return remote.map((entry) => (list === 'reminders' ? (entry && entry.channel ? { ...entry, channel: fill(entry.channel) } : entry) : fill(entry)));
}

/** A configuration with somewhere to go, password or not. */
const isConfiguredLoose = (a) => isConfigured({ ...a, password: a.password || 'x' });

/** The record a storage.local key goes up as, or null. */
function recordOf(key) {
  if (key === 'accounts' || key === 'settings') return key;
  const colon = key.indexOf(':');
  if (colon > 0 && PERSONAL.includes(key.slice(0, colon))) return syncName(key.slice(0, colon), key.slice(colon + 1));
  return null;
}

/** The viewer's sync choices and how it went, for Settings. */
export async function loadSyncInfo() {
  const data = await api.storage.local.get(['sync', 'syncStatus']);
  return { prefs: { enabled: false, passwords: false, ...(data.sync || {}) }, status: data.syncStatus || { at: null, error: null } };
}

export const syncAvailable = () => Boolean(area());
