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
import { LANGUAGES, DEFAULT_LANGUAGE, supportedLanguage } from './i18n.js';
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
export function browserLanguage() {
  const tags = navigator.languages?.length ? navigator.languages : [navigator.language || ''];
  for (const tag of tags) {
    const code = supportedLanguage(tag);
    if (code) return code;
  }
  return DEFAULT_LANGUAGE;
}

/**
 * The interface language a setting stands for. 'auto' — what every
 * viewer has until they choose one in Settings — follows the browser, and
 * keeps following it: a setting saved for some other reason (the theme, a
 * subtitle language) writes 'auto' back rather than the language it
 * happened to resolve to. A language chosen by hand is kept for good.
 */
export function interfaceLanguage(settings) {
  const lang = settings?.lang;
  return lang && lang !== 'auto' && Object.hasOwn(LANGUAGES, lang) ? lang : browserLanguage();
}

const SETTINGS_DEFAULTS = {
  epgEnabled: true,
  resumeEnabled: true,
  // When an episode ends, the next one starts after a countdown that can
  // be cancelled.
  autoNext: true,
  // The technical read-out over the picture — resolution, bit rate, the
  // engine carrying the stream. Diagnostics rather than viewing, so it is
  // asked for rather than given: see the stat badge in js/app.js.
  statsEnabled: false,
  // Where the channel list starts, before a personal arrangement:
  // az | za | num, see CHANNEL_SORTS in js/channelprefs.js.
  channelSort: 'az',
  // The global brands in a country's channel list — CNN, Discovery,
  // Stingray — beside its own; see js/international.js for how they are
  // told apart. Shown, because the provider files them there and a Finnish
  // feed of a global channel cannot be told from the channel itself.
  showInternational: true,
  // dark | light, from the button at the right end of the header. Dark
  // first: the app is for watching television, mostly in the evening.
  theme: 'dark',
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
  // subtitleScale, the size as a percentage of the default (100), is not
  // here: js/subdisplay.js reads it, and turns the pixels an older version
  // kept in subtitleSize into the same proportion.
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
 *
 * Written the same way however the address was given: a host name is the
 * same in any case, and a port left blank is the scheme's own — an address
 * pasted from an M3U link says ':80' where a typed one says nothing, and
 * the viewer's lists must not vanish over that.
 */
const DEFAULT_PORTS = { http: '80', https: '443' };

export function accountKey(c) {
  const scheme = String(c.scheme || 'http').trim().toLowerCase();
  const host = String(c.host || '').trim().toLowerCase();
  const port = String(c.port ?? '').trim().replace(/^0+(?=\d)/, '') || DEFAULT_PORTS[scheme] || '';
  return `${scheme}://${host}:${port}/${c.username || ''}`;
}

// The account this tab shows, set by useAccount() when the tab connects
// with a configuration — and only then. Reading or saving the stored
// configuration does not change it: another tab may have switched the
// stored one to another account, and this tab's favourites, history and
// resume points in memory are still the ones it connected with. Taken from
// storage instead, the next resume point saved here would have gone into
// the other account's lists.
let account = null;
// The account key this tab itself last wrote into the stored
// configuration, so that its own write is not taken for another tab's
// switch when the storage event arrives before useAccount().
let writtenAccount = null;

export function useAccount(config) {
  account = accountKey(config);
  writtenAccount = null;
  return account;
}

export const currentAccount = () => account;

export async function loadConfig() {
  return { ...CONNECTION_DEFAULTS, ...(await read('config', {})) };
}

export async function saveConfig(patch) {
  const prev = await loadConfig();
  const next = { ...prev, ...patch };
  if (accountKey(next) !== accountKey(prev)) await cacheClear();
  writtenAccount = accountKey(next);
  await api.storage.local.set({ config: next });
  return next;
}

/* ------------------------------------------------------ personal lists */

const PERSONAL = ['favorites', 'recents', 'resume', 'reminders', 'channels'];

const personalKey = (name, key = account) => (key ? `${name}:${key}` : name);

/**
 * The account's own copy of a list. A copy from before the lists were
 * per account — under the bare name — is adopted by the account in use
 * and the bare name retired, so that nothing the viewer collected is
 * lost in the update.
 */
async function readPersonal(name, fallback, key = personalKey(name)) {
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

/**
 * One change to one stored list: read, changed, written back, with no other
 * change of the player's — in this tab or another — in between. Each tab
 * used to write its whole list from memory, so two open tabs undid each
 * other's favourites and history: the last to save won. The lock is the
 * browser's, shared by every tab of the extension and let go when a tab
 * closes.
 *
 * The key is taken when the change is asked for, not when it runs, so that
 * a resume point saved on the way out of an account lands in that account.
 * Resolves to the new list, or null when the tab has moved to another
 * account meanwhile and the list changed is no longer the one it shows.
 */
const LOCK = 'kepuli-tv-lists';
let queue = Promise.resolve();
function exclusive(task) {
  if (globalThis.navigator?.locks) return navigator.locks.request(LOCK, task);
  const run = queue.then(task, task);
  queue = run.catch(() => {});
  return run;
}

function updatePersonal(name, fallback, change) {
  const owner = account;
  const key = personalKey(name, owner);
  return exclusive(async () => {
    const next = change(await readPersonal(name, fallback, key));
    await api.storage.local.set({ [key]: next });
    return account === owner ? next : null;
  });
}

/**
 * Another tab's changes, as they are stored: the lists of the account this
 * tab shows, a switch of the stored configuration to another account, and
 * the configuration taken away — the reset in Settings.
 */
export function watchStorage({ onList, onAccount, onCleared }) {
  api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.config) {
      const config = changes.config.newValue;
      if (config === undefined) { onCleared(); return; }
      const next = { ...CONNECTION_DEFAULTS, ...config };
      const key = accountKey(next);
      if (key !== account && key !== writtenAccount) onAccount(next);
    }
    if (!account) return;
    for (const name of PERSONAL) {
      const change = changes[personalKey(name)];
      if (change) onList(name, change.newValue);
    }
  });
}

/* ------------------------------------------------- the account's address */

/** "scheme://host:port/user" back into its parts, or null. */
function parseAccountKey(text) {
  const m = /^([^:/]+):\/\/([^/]*)\/(.*)$/s.exec(text);
  if (!m) return null;
  const colon = m[2].lastIndexOf(':');
  if (colon < 0) return null;
  return { scheme: m[1], host: m[2].slice(0, colon), port: m[2].slice(colon + 1), username: m[3] };
}

/**
 * The lists stored under an account key from before the keys were written
 * the one way, moved to the key they have now. Where two spellings of one
 * account both hold a list, the one the configuration in use was written
 * with wins — that is the copy the viewer has been looking at. `inUse` is
 * the configuration's key as the older versions wrote it.
 * Returns what to write and what to remove; reads nothing itself.
 */
export function accountKeyMigration(data, inUse) {
  const set = {};
  const remove = [];
  for (const key of Object.keys(data)) {
    const colon = key.indexOf(':');
    const name = key.slice(0, colon);
    if (colon < 0 || !PERSONAL.includes(name)) continue;
    const parsed = parseAccountKey(key.slice(colon + 1));
    if (!parsed) continue;
    const target = `${name}:${accountKey(parsed)}`;
    if (target === key) continue;
    // Two spellings of one account: the one in use wins the normalised
    // key. The other is left where it is rather than dropped — lists are
    // the viewer's, and a key nothing reads costs nothing.
    const taken = target in set || target in data;
    if (taken && key.slice(colon + 1) !== inUse) continue;
    remove.push(key);
    set[target] = data[key];
  }
  return { set, remove };
}

export async function migrateAccountKeys(config) {
  const inUse = `${config.scheme}://${config.host}:${config.port}/${config.username}`;
  const { set, remove } = accountKeyMigration(await api.storage.local.get(null), inUse);
  if (Object.keys(set).length) await api.storage.local.set(set);
  if (remove.length) await api.storage.local.remove(remove);
}

/**
 * The lists of one account, for bringing over to another: the same user
 * at a provider's new address. Copied only into lists the new address
 * does not have yet, and left in place under the old one.
 */
export async function accountHasLists(config) {
  const key = accountKey(config);
  const data = await api.storage.local.get(PERSONAL.map((name) => personalKey(name, key)));
  return PERSONAL.some((name) => {
    const value = data[personalKey(name, key)];
    if (name === 'channels') return value != null && Object.values(channelPreferences(value)).some((ids) => ids.length);
    return value != null && Object.keys(value).length > 0;
  });
}

export async function copyAccountLists(from, to) {
  const source = accountKey(from);
  const target = accountKey(to);
  await exclusive(async () => {
    const data = await api.storage.local.get(PERSONAL.flatMap((name) => [personalKey(name, source), personalKey(name, target)]));
    const set = {};
    for (const name of PERSONAL) {
      const value = data[personalKey(name, source)];
      if (value !== undefined && data[personalKey(name, target)] === undefined) set[personalKey(name, target)] = value;
    }
    if (Object.keys(set).length) await api.storage.local.set(set);
  });
}

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
  return { ...SETTINGS_DEFAULTS, lang: 'auto', subtitleLang: browserLanguage() };
}

export async function loadSettings() {
  return { ...settingsDefaults(), ...(await read('settings', {})) };
}

export async function saveSettings(patch) {
  const next = { ...(await loadSettings()), ...patch };
  await api.storage.local.set({ settings: next });
  return next;
}

/**
 * Commit all dialog changes together after Save. No draft reaches storage.
 * Without a connection patch the stored configuration is left as it is and
 * none is returned: another tab may have switched it meanwhile, and a save
 * of the subtitle size here is no reason to take that tab's account over.
 */
export async function saveSetup(configPatch, settingsPatch) {
  const settings = { ...(await loadSettings()), ...settingsPatch };
  if (!configPatch) {
    await api.storage.local.set({ settings });
    return { config: null, settings };
  }
  const prev = await loadConfig();
  const config = { ...prev, ...configPatch };
  if (accountKey(config) !== accountKey(prev)) await cacheClear();
  writtenAccount = accountKey(config);
  await api.storage.local.set({ config, settings });
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

/** One favourite added (item) or taken away (null), see updatePersonal. */
export function setFavorite(key, item) {
  return updatePersonal('favorites', [], (list) => {
    const at = list.findIndex((entry) => itemKey(entry) === key);
    if (!item) { if (at >= 0) list.splice(at, 1); }
    else if (at >= 0) list[at] = item;
    else list.push(item);
    return list;
  });
}

/* ------------------------------------------------------------- history */

export async function loadRecents() { return readPersonal('recents', []); }

export function pushRecent(item) {
  const key = itemKey(item);
  return updatePersonal('recents', [], (list) => {
    const rest = list.filter((r) => itemKey(r) !== key);
    rest.unshift({ ...item, watchedAt: Date.now() });
    return rest.slice(0, MAX_RECENTS);
  });
}

/** Fields of one history entry brought up to date, where it stands in the list. */
export function patchRecent(key, patch) {
  return updatePersonal('recents', [], (list) => list.map((r) => (itemKey(r) === key ? { ...r, ...patch } : r)));
}

export function removeRecent(key) {
  return updatePersonal('recents', [], (list) => list.filter((r) => itemKey(r) !== key));
}

export function clearRecents() {
  return updatePersonal('recents', [], () => []);
}

/* ----------------------------------------------------------- reminders */

// Programmes the viewer asked to be reminded of: { channel, title, start, stop }.
// The channel ids are the account's own, so the list is too.
export async function loadReminders() { return readPersonal('reminders', []); }

export const reminderKey = (r) => `${r.channel.id}:${r.start}`;

/** One reminder set (reminder) or cleared (null); those whose programme has ended go too. */
export function setReminder(key, reminder) {
  const now = Date.now();
  return updatePersonal('reminders', [], (list) => {
    const rest = list.filter((r) => r.stop > now && reminderKey(r) !== key);
    if (reminder) rest.push(reminder);
    return rest;
  });
}

/**
 * The reminders due by `until`, taken out of the list. Every open tab arms
 * the same timer, and the one that takes a reminder is the one that says
 * it: the others find it gone.
 */
export async function takeDueReminders(until) {
  let due = [];
  const left = await updatePersonal('reminders', [], (list) => {
    due = list.filter((r) => r.start <= until);
    return list.filter((r) => r.start > until);
  });
  return left ? due : [];
}

/* ------------------------------------------------------- resume points */

export async function loadResume() {
  return new Map(Object.entries(await readPersonal('resume', {})));
}

/** The resume points as stored: the oldest dropped, so that storage does not grow without bound. */
export function resumeObject(points) {
  const entries = Object.entries(points).sort((a, b) => b[1].at - a[1].at).slice(0, MAX_RESUME);
  return Object.fromEntries(entries);
}

/** One resume point kept (point) or forgotten (null). */
export function setResume(key, point) {
  return updatePersonal('resume', {}, (points) => {
    if (point) points[key] = point; else delete points[key];
    return resumeObject(points);
  });
}

/* -------------------------------------------------------------- updates */

/** The version this page is running, which an update waiting to be taken does not change. */
export const runningVersion = () => api.runtime.getManifest().version;

/**
 * The version background.js has been told is waiting, or null. Read at
 * start-up for an update that arrived before this page opened, and watched
 * for one that arrives while it is open.
 */
export async function loadUpdateReady() { return read('updateReady', null); }

export function watchUpdateReady(onReady) {
  api.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.updateReady?.newValue) onReady(changes.updateReady.newValue);
  });
}

/** Takes the update. The reload closes this page; background.js opens it again at `hash`. */
export async function reloadForUpdate(hash) {
  await api.storage.local.set({ reopenAfterUpdate: hash });
  api.runtime.reload();
}
