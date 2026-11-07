// @ts-check
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
import { channelPreferences } from './channelprefs.js';
import { noteWatched } from './picks.js';

const CONNECTION_DEFAULTS = {
  // What the account is: an Xtream Codes server (the fields below), an
  // M3U playlist (url, and the programme guide's address in epgUrl when the
  // playlist does not name one itself) or a Stalker portal (url, and the
  // MAC address the provider registered in mac; js/stalker.js).
  type: 'xtream',           // xtream | m3u | stalker
  scheme: 'http', host: '', port: '8080', username: '', password: '',
  url: '', epgUrl: '', mac: '',
  // The name the viewer gave the account, for the account menu; empty
  // means one made from the address (accountLabel).
  name: '',
  // The account's place in the list of accounts, see loadAccounts().
  id: '',
  streamMode: 'auto',
  // Which form the settings dialog opens. For an Xtream server it does not
  // affect the connection: both produce the same server and credentials.
  sourceMode: 'xtream',     // xtream | m3u | stalker
};

/**
 * An account's connection as stored: every field of CONNECTION_DEFAULTS,
 * each a string.
 * @typedef {typeof CONNECTION_DEFAULTS} Config
 */

/**
 * An entry of Favourites or History: an item of a list as the provider
 * kinds give it (see CatalogueItem in js/api.js), stored whole. `k` is 'c'
 * for a favourite category, whose other fields are app.js's.
 * @typedef {{ k: number|string, id: string, watchedAt?: number } & Record<string, any>} ListItem
 */

/**
 * A programme the viewer asked to be reminded of.
 * @typedef {{ channel: { id: string } & Record<string, any>, title: string, start: number, stop: number } & Record<string, any>} Reminder
 */

/**
 * Where a film or an episode was left; `at` is when, for dropping the
 * oldest. The other fields are app.js's.
 * @typedef {{ at: number } & Record<string, any>} ResumePoint
 */

const MAC = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i;

/**
 * Whether the configuration has what it takes to connect.
 * @param {Partial<Config>|null} [c]
 * @returns {boolean}
 */
export function isConfigured(c) {
  if (!c) return false;
  if (c.type === 'm3u') return Boolean(c.url);
  if (c.type === 'stalker') return Boolean(c.url && MAC.test(c.mac || ''));
  return Boolean(c.host && c.username && c.password);
}

/**
 * The account as the account menu names it: its own name, or its address.
 * @param {Partial<Config>|null} [c]
 * @returns {string}
 */
export function accountLabel(c) {
  if (!c) return '';
  if (c.name && c.name.trim()) return c.name.trim();
  if (c.type === 'm3u' || c.type === 'stalker') {
    try { return new URL(c.url).hostname; } catch { return c.url || ''; }
  }
  // demo@example.tv: the form an account on a server is written in.
  return c.username ? `${c.username}@${c.host}` : c.host || '';
}

/**
 * The language the app opens in, from the browser's own list.
 *
 * English used to be the default for everyone, while the subtitle language
 * defaulted to Finnish — so a viewer got an English interface offering
 * Finnish subtitles, and neither had been asked for. The browser has already
 * been told which languages its owner reads; the first of them the app
 * speaks is the answer, and English is what is left when it speaks none.
 * @returns {string}
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
 * The browser's own English, when its first language is English of some
 * region: en-US, en-CA, en-AU. The app's English is en-GB by default (21:30,
 * day before month); a reader in the United States gets month before day
 * from this, and the 12-hour clock from hourCycle().
 * @returns {string|null}
 */
export function browserEnglish() {
  const tag = (navigator.languages?.length ? navigator.languages[0] : navigator.language) || '';
  return /^en-[a-z]{2}$/i.test(tag) ? tag : null;
}

/**
 * The clock a setting stands for, as Intl's hourCycle: '24' and '12' as
 * they say, and 'auto' — the default — the browser's own convention, but
 * only while the interface is in English. A television guide is read on
 * the 24-hour clock in most of the languages the app speaks even where the
 * language's own default is 12-hour (Greek, Albanian), while English
 * readers in the United States, Canada, Australia or India expect
 * 10:30 PM. A browser in American English with the interface in Finnish
 * once got 10:30 PM. Nor is a browser's English where the viewer lives:
 * many Finns keep it in en-US, so a time zone in Europe, where the
 * 24-hour clock is the rule, gets the 24-hour clock in English too.
 * @param {{ clock?: string, lang?: string }|null} [settings]
 * @param {string} [zone] the time zone, the system's by default
 * @returns {'h12'|'h23'}
 */
export function hourCycle(settings, zone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  if (settings?.clock === '12') return 'h12';
  if (settings?.clock === '24') return 'h23';
  const tag = interfaceLanguage(settings) === 'en' && !/^(Europe|Arctic)\//.test(zone || '') && browserEnglish();
  if (!tag) return 'h23';
  try {
    const cycle = new Intl.DateTimeFormat(tag, { hour: 'numeric' }).resolvedOptions().hourCycle;
    return cycle === 'h12' || cycle === 'h11' ? 'h12' : 'h23';
  } catch { return 'h23'; }
}

/**
 * The interface language a setting stands for. 'auto' — what every
 * viewer has until they choose one in Settings — follows the browser, and
 * keeps following it: a setting saved for some other reason (the theme, a
 * subtitle language) writes 'auto' back rather than the language it
 * happened to resolve to. A language chosen by hand is kept for good.
 * @param {{ lang?: string }|null} [settings]
 * @returns {string}
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
  // Recording, off until it is turned on in Settings, where turning it on
  // first says what may be recorded: a copy to keep is lawful only of what
  // the viewer has the right to, see the rec-consent dialog in js/app.js.
  recordingEnabled: false,
  // The sections of the empty player's page, each shown unless turned off:
  // the picks, Continue watching and the channels watched lately.
  homePicks: true,
  homeContinue: true,
  homeRecent: true,
  // Where the channel list starts, before a personal arrangement:
  // az | za | num, see CHANNEL_SORTS in js/channelprefs.js.
  channelSort: 'az',
  // The other lists' orders, each chosen at its list's foot and in
  // Settings; the choices are LIST_ORDERS in js/listorder.js. The
  // favourites: az | za | added (the latest added first).
  favoritesSort: 'az',
  // The films and the series: az | za | newest | oldest (by release year)
  // | rating | added (what the provider added lately first).
  movieSort: 'az',
  seriesSort: 'az',
  // The history: watched (the latest watched first, by day) | az | za.
  historySort: 'watched',
  // The global brands in a country's channel list — CNN, Discovery,
  // Stingray — beside its own; see js/international.js for how they are
  // told apart. Shown, because the provider files them there and a Finnish
  // feed of a global channel cannot be told from the channel itself.
  showInternational: true,
  // system | dark | light: the system's mode until the button at the right
  // end of the header or Settings chooses one.
  theme: 'system',
  // auto | 24 | 12, see hourCycle().
  clock: 'auto',
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

/**
 * The settings as stored: SETTINGS_DEFAULTS and the two languages, and
 * whatever other modules keep beside them (js/subdisplay.js's
 * subtitleScale among them), which this module does not name.
 * @typedef {typeof SETTINGS_DEFAULTS & { lang: string, subtitleLang: string } & Record<string, any>} Settings
 */

const MAX_RECENTS = 60;
const MAX_RESUME = 400;
const MAX_SEEN = 2000;

/** @param {{ k: number|string, id: string }} item */
export const itemKey = (item) => `${item.k}:${item.id}`;

/**
 * @param {string} key
 * @param {any} fallback what a key never written reads as
 * @returns {Promise<any>}
 */
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
/** @type {Record<string, string>} */
const DEFAULT_PORTS = { http: '80', https: '443' };

/**
 * @param {Partial<Config>} c
 * @returns {string}
 */
export function accountKey(c) {
  if (c.type === 'm3u') return `m3u:${String(c.url || '').trim()}`;
  if (c.type === 'stalker') return `stalker:${String(c.url || '').trim()}|${String(c.mac || '').toUpperCase()}`;
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
/** @type {string|null} */
let account = null;
// The account key this tab itself last wrote into the stored
// configuration, so that its own write is not taken for another tab's
// switch when the storage event arrives before useAccount().
/** @type {string|null} */
let writtenAccount = null;

/**
 * @param {Partial<Config>} config
 * @returns {string} the account's key
 */
export function useAccount(config) {
  account = accountKey(config);
  writtenAccount = null;
  return account;
}

export const currentAccount = () => account;

/** @returns {Promise<Config>} */
export async function loadConfig() {
  return { ...CONNECTION_DEFAULTS, ...(await read('config', {})) };
}

/**
 * @param {Partial<Config>} patch
 * @returns {Promise<Config>}
 */
export async function saveConfig(patch) {
  const prev = await loadConfig();
  const next = withId({ ...prev, ...patch });
  // The catalogue cache is kept per account (js/library.js, js/m3usource.js
  // write under the account's key), so a switch leaves the other account's
  // there for the switch back; the expired rows go by themselves.
  writtenAccount = accountKey(next);
  await api.storage.local.set({ config: next });
  await recordAccount(next);
  return next;
}

/* ------------------------------------------------------------ accounts */

/**
 * A configuration with nothing in it: the form for a new account.
 * @returns {Config}
 */
export const blankConfig = () => ({ ...CONNECTION_DEFAULTS });

/**
 * Another account of the list made the one in use, as it is stored: none
 * of the account being left is carried into it.
 * @param {Partial<Config>} config
 * @returns {Promise<Config>}
 */
export async function switchConfig(config) {
  const next = { ...CONNECTION_DEFAULTS, ...config };
  writtenAccount = accountKey(next);
  await api.storage.local.set({ config: next });
  return next;
}

// Every account the viewer has added, each a whole configuration with an
// id; `config` is the one in use. A version from before there was a list
// had only `config`, and it becomes the first account of the list the
// first time the list is read.

const newId = () => `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
/**
 * @template {Partial<Config>} C
 * @param {C} c
 * @returns {C}
 */
const withId = (c) => (c.id ? c : { ...c, id: newId() });

/** @returns {Promise<Config[]>} */
export async function loadAccounts() {
  const stored = await read('accounts', null);
  if (Array.isArray(stored)) return stored.map((a) => ({ ...CONNECTION_DEFAULTS, ...a }));
  const config = await loadConfig();
  if (!isConfigured(config)) return [];
  const first = withId(config);
  await api.storage.local.set({ accounts: [first], config: first });
  return [first];
}

/**
 * The account kept in the list as it is now: added, or its entry replaced.
 * @param {Config} config
 * @returns {Promise<void>}
 */
export function recordAccount(config) {
  if (!isConfigured(config)) return Promise.resolve();
  return exclusive(async () => {
    const list = (await read('accounts', null)) || [];
    const at = list.findIndex((a) => a.id === config.id);
    if (at >= 0) list[at] = config; else list.push(config);
    await api.storage.local.set({ accounts: list });
  });
}

/**
 * An account taken off the list, and its favourites, history and the rest
 * with it — unless another account in the list is the same account under
 * another name. The one in use cannot be removed: the caller switches first.
 * @param {string} id
 * @returns {Promise<Config[]>} the accounts left
 */
export function removeAccount(id) {
  return exclusive(async () => {
    const list = (await read('accounts', null)) || [];
    const gone = list.find((a) => a.id === id);
    if (!gone) return list;
    const rest = list.filter((a) => a.id !== id);
    await api.storage.local.set({ accounts: rest });
    const key = accountKey({ ...CONNECTION_DEFAULTS, ...gone });
    if (!rest.some((a) => accountKey({ ...CONNECTION_DEFAULTS, ...a }) === key)) {
      await api.storage.local.remove(PERSONAL.map((name) => personalKey(name, key)));
    }
    return rest;
  });
}

/**
 * The settings changed by another tab, or arrived from another computer.
 * @param {(settings: Settings|undefined) => void} onChange
 */
export function watchSettings(onChange) {
  api.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) onChange(changes.settings.newValue);
  });
}

/**
 * How the sync went, written by whichever tab syncs (js/sync.js).
 * @param {() => void} onChange
 */
export function watchSyncStatus(onChange) {
  api.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.syncStatus || changes.sync)) onChange();
  });
}

/**
 * Another tab's change to the list of accounts.
 * @param {(accounts: Config[]) => void} onChange
 */
export function watchAccounts(onChange) {
  api.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.accounts) onChange((changes.accounts.newValue || []).map((a) => ({ ...CONNECTION_DEFAULTS, ...a })));
  });
}

/* ------------------------------------------------------ personal lists */

export const PERSONAL = ['favorites', 'recents', 'resume', 'reminders', 'channels', 'interests', 'seen'];

/**
 * @param {string} name
 * @param {string|null} [key]
 * @returns {string}
 */
const personalKey = (name, key = account) => (key ? `${name}:${key}` : name);

/**
 * The account's own copy of a list. A copy from before the lists were
 * per account — under the bare name — is adopted by the account in use
 * and the bare name retired, so that nothing the viewer collected is
 * lost in the update.
 * @param {string} name
 * @param {any} fallback
 * @param {string} [key]
 * @returns {Promise<any>}
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

/**
 * @param {string} name
 * @param {any} value
 */
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
/** @type {Promise<unknown>} */
let queue = Promise.resolve();
/**
 * @template T
 * @param {() => Promise<T>} task
 * @returns {Promise<T>}
 */
function exclusive(task) {
  // The lock's promise settles with the task's own, not with the promise
  // the task returned, which DOM's declaration of request() does not say.
  if (globalThis.navigator?.locks) return /** @type {Promise<any>} */ (navigator.locks.request(LOCK, task));
  const run = queue.then(task, task);
  queue = run.catch(() => {});
  return run;
}

/**
 * @template T
 * @param {string} name
 * @param {T} fallback
 * @param {(value: T) => T} change
 * @returns {Promise<T|null>}
 */
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
 * @param {{ onList: (name: string, value: any) => void, onAccount: (config: Config) => void, onCleared: () => void }} handlers
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

/**
 * "scheme://host:port/user" back into its parts, or null.
 * @param {string} text
 * @returns {{ scheme: string, host: string, port: string, username: string }|null}
 */
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
 * @param {Record<string, any>} data
 * @param {string} inUse
 * @returns {{ set: Record<string, any>, remove: string[] }}
 */
export function accountKeyMigration(data, inUse) {
  /** @type {Record<string, any>} */
  const set = {};
  /** @type {string[]} */
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

/** @param {Config} config */
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
 * @param {Partial<Config>} config
 * @returns {Promise<boolean>}
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

/**
 * @param {Partial<Config>} from
 * @param {Partial<Config>} to
 */
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

/** @param {any} value */
export async function saveChannelPreferences(value) {
  await writePersonal('channels', channelPreferences(value));
}

/**
 * The defaults, with the two that depend on where the browser is. Read at
 * call time rather than at import: navigator.languages is not available to
 * a module while it is still being evaluated in every browser, and a stored
 * setting overrides both in any case.
 * @returns {Settings}
 */
function settingsDefaults() {
  return { ...SETTINGS_DEFAULTS, lang: 'auto', subtitleLang: browserLanguage() };
}

/** @returns {Promise<Settings>} */
export async function loadSettings() {
  return { ...settingsDefaults(), ...(await read('settings', {})) };
}

/**
 * @param {Partial<Settings>} patch
 * @returns {Promise<Settings>}
 */
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
 * @param {Partial<Config>|null} configPatch
 * @param {Partial<Settings>} settingsPatch
 * @param {{ replace?: boolean }} [options]
 * @returns {Promise<{ config: Config|null, settings: Settings }>}
 */
export async function saveSetup(configPatch, settingsPatch, { replace = false } = {}) {
  const settings = { ...(await loadSettings()), ...settingsPatch };
  if (!configPatch) {
    await api.storage.local.set({ settings });
    return { config: null, settings };
  }
  const prev = await loadConfig();
  // replace: a new account, nothing of the one in use carried over.
  const config = withId(replace ? { ...CONNECTION_DEFAULTS, ...configPatch, id: '' } : { ...prev, ...configPatch });
  writtenAccount = accountKey(config);
  await api.storage.local.set({ config, settings });
  await recordAccount(config);
  return { config, settings };
}

export async function loadUiState() { return read('ui', {}); }

// One write after another: each reads what the last one wrote. Three
// filters chosen in a row once read the same old state and the last write
// took the other two away.
let uiWrites = Promise.resolve();

/** @param {Record<string, any>} patch */
export function saveUiState(patch) {
  uiWrites = uiWrites.catch(() => {}).then(async () => {
    const ui = { ...(await loadUiState()), ...patch };
    await api.storage.local.set({ ui });
  });
  return uiWrites;
}

/* ---------------------------------------------------------- favourites */

/** @returns {Promise<Map<string, ListItem>>} */
export async function loadFavorites() {
  const list = await readPersonal('favorites', []);
  return new Map(list.map((item) => [itemKey(item), item]));
}

/**
 * One favourite added (item) or taken away (null), see updatePersonal.
 * @param {string} key
 * @param {ListItem|null} item
 */
export function setFavorite(key, item) {
  return updatePersonal('favorites', /** @type {ListItem[]} */ ([]), (list) => {
    const at = list.findIndex((entry) => itemKey(entry) === key);
    if (!item) { if (at >= 0) list.splice(at, 1); }
    else if (at >= 0) list[at] = item;
    else list.push(item);
    return list;
  });
}

/* ------------------------------------------------------------- history */

/** @returns {Promise<ListItem[]>} */
export async function loadRecents() { return readPersonal('recents', []); }

/** @param {ListItem} item */
export function pushRecent(item) {
  const key = itemKey(item);
  return updatePersonal('recents', /** @type {ListItem[]} */ ([]), (list) => {
    const before = list.find((r) => itemKey(r) === key);
    const rest = list.filter((r) => itemKey(r) !== key);
    // Seen to the end once stays seen when it is played again.
    rest.unshift({ ...item, ...(before?.seen ? { seen: before.seen } : {}), watchedAt: Date.now() });
    return rest.slice(0, MAX_RECENTS);
  });
}

/**
 * Fields of one history entry brought up to date, where it stands in the list.
 * @param {string} key
 * @param {Partial<ListItem>} patch
 */
export function patchRecent(key, patch) {
  return updatePersonal('recents', /** @type {ListItem[]} */ ([]), (list) => list.map((r) => (itemKey(r) === key ? { ...r, ...patch } : r)));
}

/** @param {string} key */
export function removeRecent(key) {
  return updatePersonal('recents', /** @type {ListItem[]} */ ([]), (list) => list.filter((r) => itemKey(r) !== key));
}

/**
 * Several history entries dropped at once: a film's, or every episode's of a series.
 * @param {Iterable<string>} keys
 */
export function removeRecents(keys) {
  const drop = new Set(keys);
  return updatePersonal('recents', /** @type {ListItem[]} */ ([]), (list) => list.filter((r) => !drop.has(itemKey(r))));
}

export function clearRecents() {
  return updatePersonal('recents', /** @type {ListItem[]} */ ([]), () => []);
}

/* ----------------------------------------------------------- reminders */

// Programmes the viewer asked to be reminded of: { channel, title, start, stop }.
// The channel ids are the account's own, so the list is too.
/** @returns {Promise<Reminder[]>} */
export async function loadReminders() { return readPersonal('reminders', []); }

/** @param {Reminder} r */
export const reminderKey = (r) => `${r.channel.id}:${r.start}`;

/**
 * One reminder set (reminder) or cleared (null); those whose programme has ended go too.
 * @param {string} key
 * @param {Reminder|null} reminder
 */
export function setReminder(key, reminder) {
  const now = Date.now();
  return updatePersonal('reminders', /** @type {Reminder[]} */ ([]), (list) => {
    const rest = list.filter((r) => r.stop > now && reminderKey(r) !== key);
    if (reminder) rest.push(reminder);
    return rest;
  });
}

/**
 * The reminders due by `until`, taken out of the list. Every open tab arms
 * the same timer, and the one that takes a reminder is the one that says
 * it: the others find it gone.
 * @param {number} until
 * @returns {Promise<Reminder[]>}
 */
export async function takeDueReminders(until) {
  /** @type {Reminder[]} */
  let due = [];
  const left = await updatePersonal('reminders', /** @type {Reminder[]} */ ([]), (list) => {
    due = list.filter((r) => r.start <= until);
    return list.filter((r) => r.start > until);
  });
  return left ? due : [];
}

/* ------------------------------------------------------------ interests */

// The programmes the viewer has watched, by title, for the picks on the
// empty player's page (js/picks.js). The channel ids and the titles are the
// account's own, so the notes are too.
/** @returns {Promise<Record<string, any>>} */
export async function loadInterests() { return readPersonal('interests', {}); }

/**
 * One more watch of a programme noted.
 * @param {string} title
 */
export function noteInterest(title) {
  return updatePersonal('interests', {}, (notes) => noteWatched(notes, title));
}

/* ---------------------------------------------------------- seen marks */

// Which films the viewer has seen, marked by the player at the end of one
// or by the viewer from the row's menu: { at, on } by item key, `on` false
// for one marked unwatched, so that the mark carries over sync like any
// other and the later of two computers' choices wins (js/sync.js). The
// history kept the mark before and still holds it for its entries, but it
// keeps sixty titles: a film seen a year ago lost its ✓.
/** @returns {Promise<Map<string, { at: number, on: boolean }>>} */
export async function loadSeen() {
  return new Map(Object.entries(await readPersonal('seen', {})));
}

/**
 * A title marked seen (true) or unwatched (false).
 * @param {string} key
 * @param {boolean} on
 */
export function setSeen(key, on) {
  return updatePersonal('seen', /** @type {Record<string, { at: number, on: boolean }>} */ ({}), (marks) => {
    marks[key] = { at: Date.now(), on };
    return resumeObject(marks, MAX_SEEN);
  });
}

/* ------------------------------------------------------- resume points */

/** @returns {Promise<Map<string, ResumePoint>>} */
export async function loadResume() {
  return new Map(Object.entries(await readPersonal('resume', {})));
}

/**
 * Entries kept by when they were written, the newest `max`: the resume
 * points and the seen marks, so that storage does not grow without bound.
 * @template {{ at: number }} T
 * @param {Record<string, T>} points
 * @returns {Record<string, T>}
 */
export function resumeObject(points, max = MAX_RESUME) {
  const entries = Object.entries(points).sort((a, b) => b[1].at - a[1].at).slice(0, max);
  return Object.fromEntries(entries);
}

/**
 * One resume point kept (point) or forgotten (null).
 * @param {string} key
 * @param {ResumePoint|null} point
 */
export function setResume(key, point) {
  return updatePersonal('resume', /** @type {Record<string, ResumePoint>} */ ({}), (points) => {
    if (point) points[key] = point; else delete points[key];
    return resumeObject(points);
  });
}

/**
 * Several resume points forgotten at once: a film's, or every episode's of a series.
 * @param {Iterable<string>} keys
 */
export function forgetResume(keys) {
  return updatePersonal('resume', /** @type {Record<string, ResumePoint>} */ ({}), (points) => {
    for (const key of keys) delete points[key];
    return resumeObject(points);
  });
}

/* -------------------------------------------------------------- updates */

/**
 * The version this page is running, which an update waiting to be taken does not change.
 * @returns {string}
 */
export const runningVersion = () => api.runtime.getManifest().version;

/**
 * The version background.js has been told is waiting, or null. Read at
 * start-up for an update that arrived before this page opened, and watched
 * for one that arrives while it is open.
 */
/** @returns {Promise<string|null>} */
export async function loadUpdateReady() { return read('updateReady', null); }

/** @param {(version: string) => void} onReady */
export function watchUpdateReady(onReady) {
  api.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.updateReady?.newValue) onReady(changes.updateReady.newValue);
  });
}

/**
 * Takes the update. The reload closes this page; background.js opens it again at `hash`.
 * @param {string} hash
 */
export async function reloadForUpdate(hash) {
  await api.storage.local.set({ reopenAfterUpdate: hash });
  api.runtime.reload();
}
