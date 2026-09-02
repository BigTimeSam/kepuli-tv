// Settings, favourites, history and resume points in the extension's
// storage.local.
// Note: the password is stored in the clear in the extension's own storage.
//
// Favourites and history are stored as whole items rather than bare ids,
// so that they can be shown without any list having been loaded. The
// exception is a favourite category (k = 'c'), whose contents are exactly
// what is allowed to change: only its identifier is kept, see app.js.

import { api } from './browser.js';
import { cacheClear } from './db.js';

const CONNECTION_DEFAULTS = {
  scheme: 'http', host: '', port: '8080', username: '', password: '',
  streamMode: 'auto',
  // Which form the settings dialog opens. Does not affect the connection:
  // both produce the same server and the same credentials.
  sourceMode: 'xtream',     // xtream | m3u
};

const SETTINGS_DEFAULTS = {
  // Interface language, see js/i18n.js. English by default.
  lang: 'en',
  epgEnabled: true,
  resumeEnabled: true,
  // The subtitle language is chosen once and applies to later episodes.
  // 'off' = no subtitles; otherwise a two-letter code.
  subtitleLang: 'fi',
  subtitleSize: 'small',    // small | medium | large
};

const MAX_RECENTS = 60;
const MAX_RESUME = 400;

export const itemKey = (item) => `${item.k}:${item.id}`;

async function read(key, fallback) {
  const data = await api.storage.local.get(key);
  return data[key] === undefined ? fallback : data[key];
}

export async function loadConfig() {
  return { ...CONNECTION_DEFAULTS, ...(await read('config', {})) };
}

/**
 * What the catalogue cache belongs to. The cache is one database for
 * whatever server is configured, so another server's listing — or another
 * account's on the same server — must not survive a switch: its categories,
 * covers and programme data would show until the user found Clear cache.
 * The password and the playback mode are not part of it.
 */
const serverKey = (c) => `${c.scheme}://${c.host}:${c.port}/${c.username}`;

export async function saveConfig(patch) {
  const prev = await loadConfig();
  const next = { ...prev, ...patch };
  if (serverKey(next) !== serverKey(prev)) await cacheClear();
  await api.storage.local.set({ config: next });
  return next;
}

export async function loadSettings() {
  return { ...SETTINGS_DEFAULTS, ...(await read('settings', {})) };
}

export async function saveSettings(patch) {
  const next = { ...(await loadSettings()), ...patch };
  await api.storage.local.set({ settings: next });
  return next;
}

export async function loadUiState() { return read('ui', {}); }

export async function saveUiState(patch) {
  const ui = { ...(await loadUiState()), ...patch };
  await api.storage.local.set({ ui });
}

/* ---------------------------------------------------------- favourites */

export async function loadFavorites() {
  const list = await read('favorites', []);
  return new Map(list.map((item) => [itemKey(item), item]));
}

export async function saveFavorites(map) {
  await api.storage.local.set({ favorites: [...map.values()] });
}

/* ------------------------------------------------------------- history */

export async function loadRecents() { return read('recents', []); }

export async function pushRecent(item) {
  const key = itemKey(item);
  const list = (await loadRecents()).filter((r) => itemKey(r) !== key);
  list.unshift({ ...item, watchedAt: Date.now() });
  const trimmed = list.slice(0, MAX_RECENTS);
  await api.storage.local.set({ recents: trimmed });
  return trimmed;
}

export async function removeRecent(key) {
  const list = (await loadRecents()).filter((r) => itemKey(r) !== key);
  await api.storage.local.set({ recents: list });
  return list;
}

export async function clearRecents() {
  await api.storage.local.set({ recents: [] });
}

/* ------------------------------------------------------- resume points */

export async function loadResume() {
  return new Map(Object.entries(await read('resume', {})));
}

export async function saveResume(map) {
  // The oldest are dropped so that storage does not grow without bound.
  const entries = [...map.entries()].sort((a, b) => b[1].at - a[1].at).slice(0, MAX_RESUME);
  await api.storage.local.set({ resume: Object.fromEntries(entries) });
}
