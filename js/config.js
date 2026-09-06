// Settings, favourites, history and resume points in the extension's
// storage.local.
// Note: the password is stored in the clear in the extension's own storage.
//
// Favourites and history are stored as whole items rather than bare ids,
// so that they can be shown without any list having been loaded. The
// exception is a favourite category (k = 'c'), whose contents are exactly
// what is allowed to change: only its identifier is kept, see app.js.
//
// Favourites, history and resume points belong to the account: they are
// keyed by the server and the user name, so that a switch to another
// server does not show this server's favourites against that server's ids,
// nor resume that server's film 1234 where this server's was left.
// Switching back finds them again. Older versions kept one set for
// whatever account was in use; that set is adopted by the account in use
// the first time it is asked for.

import { api } from './browser.js';
import { LANGUAGES, DEFAULT_LANGUAGE } from './i18n.js';
import { cacheClear } from './db.js';
import { channelPreferences } from './channelprefs.js';

const CONNECTION_DEFAULTS = {
  scheme: 'http', host: '', port: '8080', username: '', password: '',
  streamMode: 'auto',
  // Which form the settings dialog opens. Does not affect the connection:
  // both produce the same server and the same credentials.
  sourceMode: 'xtream',     // xtream | m3u
};

/**
 * The language the app opens in, from the browser's own list.
 *
 * English used to be the default for everyone, while the subtitle language
 * defaulted to Finnish — so a viewer got an English interface offering
 * Finnish subtitles, and neither had been asked for. The browser has already
 * been told which languages its owner reads; the first of them the app
 * speaks is the answer, and English is what is left when it speaks none.
 */
function browserLanguage() {
  const tags = navigator.languages?.length ? navigator.languages : [navigator.language || ''];
  for (const tag of tags) {
    const base = String(tag).toLowerCase().split('-')[0];
    if (Object.hasOwn(LANGUAGES, base)) return base;
  }
  return DEFAULT_LANGUAGE;
}

const SETTINGS_DEFAULTS = {
  epgEnabled: true,
  resumeEnabled: true,
  // The technical read-out over the picture — resolution, bit rate, the
  // engine carrying the stream. Diagnostics rather than viewing, so it is
  // asked for rather than given: see the stat badge in js/app.js.
  statsEnabled: false,
  // Where the channel list starts, before a personal arrangement:
  // az | za | num, see CHANNEL_SORTS in js/channelprefs.js.
  channelSort: 'az',
  // The interface language and the subtitle language are not here: both
  // start from the browser's own, see settingsDefaults(). The subtitle one
  // is chosen once and applies to later episodes; 'off' = no subtitles,
  // otherwise a two-letter code.
  //
  // The audio track, when the file offers more than one. 'auto' = whatever
  // the file and the browser suit best, see js/audio.js; otherwise a
  // two-letter code.
  audioLang: 'auto',
  // How the subtitles are drawn — the looks and the sizes are in js/subdisplay.js.
  subtitleStyle: 'shadow',  // shadow | outline | yellow | box | contrast
  subtitleSize: 24,         // CSS pixels; older settings hold small | medium | large
};

const MAX_RECENTS = 60;
const MAX_RESUME = 400;

export const itemKey = (item) => `${item.k}:${item.id}`;

async function read(key, fallback) {
  const data = await api.storage.local.get(key);
  return data[key] === undefined ? fallback : data[key];
}

/**
 * What the catalogue cache and the personal lists belong to. The cache is
 * one database for whatever server is configured, so another server's
 * listing — or another account's on the same server — must not survive a
 * switch: its categories, covers and programme data would show until the
 * user found Clear cache. The password and the playback mode are not part
 * of it.
 */
const serverKey = (c) => `${c.scheme}://${c.host}:${c.port}/${c.username}`;

// The account in use, as loadConfig() and saveConfig() last saw it.
let account = null;

export async function loadConfig() {
  const config = { ...CONNECTION_DEFAULTS, ...(await read('config', {})) };
  account = serverKey(config);
  return config;
}

export async function saveConfig(patch) {
  const prev = await loadConfig();
  const next = { ...prev, ...patch };
  if (serverKey(next) !== serverKey(prev)) await cacheClear();
  await api.storage.local.set({ config: next });
  account = serverKey(next);
  return next;
}

/* ------------------------------------------------------ personal lists */

const personalKey = (name) => (account ? `${name}:${account}` : name);

/**
 * The account's own copy of a list. A copy from before the lists were
 * per account — under the bare name — is adopted by the account in use
 * and the bare name retired, so that nothing the viewer collected is
 * lost in the update.
 */
async function readPersonal(name, fallback) {
  const key = personalKey(name);
  const data = await api.storage.local.get([key, name]);
  if (data[key] !== undefined) return data[key];
  if (key !== name && data[name] !== undefined) {
    await api.storage.local.set({ [key]: data[name] });
    await api.storage.local.remove(name);
    return data[name];
  }
  return fallback;
}

const writePersonal = (name, value) => api.storage.local.set({ [personalKey(name)]: value });

export async function loadChannelPreferences() {
  return channelPreferences(await readPersonal('channels', {}));
}

export async function saveChannelPreferences(value) {
  await writePersonal('channels', channelPreferences(value));
}

/**
 * The defaults, with the two that depend on where the browser is. Read at
 * call time rather than at import: navigator.languages is not available to
 * a module while it is still being evaluated in every browser, and a stored
 * setting overrides both in any case.
 */
function settingsDefaults() {
  const lang = browserLanguage();
  return { ...SETTINGS_DEFAULTS, lang, subtitleLang: lang };
}

export async function loadSettings() {
  return { ...settingsDefaults(), ...(await read('settings', {})) };
}

export async function saveSettings(patch) {
  const next = { ...(await loadSettings()), ...patch };
  await api.storage.local.set({ settings: next });
  return next;
}

/** Commit all dialog changes together after Save. No draft reaches storage. */
export async function saveSetup(configPatch, settingsPatch) {
  const prev = await loadConfig();
  const config = { ...prev, ...configPatch };
  const settings = { ...(await loadSettings()), ...settingsPatch };
  if (serverKey(config) !== serverKey(prev)) await cacheClear();
  await api.storage.local.set({ config, settings });
  account = serverKey(config);
  return { config, settings };
}

export async function loadUiState() { return read('ui', {}); }

export async function saveUiState(patch) {
  const ui = { ...(await loadUiState()), ...patch };
  await api.storage.local.set({ ui });
}

/* ---------------------------------------------------------- favourites */

export async function loadFavorites() {
  const list = await readPersonal('favorites', []);
  return new Map(list.map((item) => [itemKey(item), item]));
}

export async function saveFavorites(map) {
  await writePersonal('favorites', [...map.values()]);
}

/* ------------------------------------------------------------- history */

export async function loadRecents() { return readPersonal('recents', []); }

export async function pushRecent(item) {
  const key = itemKey(item);
  const list = (await loadRecents()).filter((r) => itemKey(r) !== key);
  list.unshift({ ...item, watchedAt: Date.now() });
  const trimmed = list.slice(0, MAX_RECENTS);
  await writePersonal('recents', trimmed);
  return trimmed;
}

export async function removeRecent(key) {
  const list = (await loadRecents()).filter((r) => itemKey(r) !== key);
  await writePersonal('recents', list);
  return list;
}

export async function clearRecents() {
  await writePersonal('recents', []);
}

/* ------------------------------------------------------- resume points */

export async function loadResume() {
  return new Map(Object.entries(await readPersonal('resume', {})));
}

export async function saveResume(map) {
  // The oldest are dropped so that storage does not grow without bound.
  const entries = [...map.entries()].sort((a, b) => b[1].at - a[1].at).slice(0, MAX_RESUME);
  await writePersonal('resume', Object.fromEntries(entries));
}
