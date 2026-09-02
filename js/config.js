// Asetukset, suosikit, historia ja katselukohdat chrome.storage.localissa.
// Huom: salasana tallentuu selkokielisenä laajennuksen omaan tallennustilaan.
//
// Suosikit ja historia tallennetaan kokonaisina kohteina eikä pelkkinä
// tunnisteina, jotta ne voi näyttää ilman että mitään listaa on ladattu.
// Poikkeus on suosikkikategoria (k = 'c'), jonka sisältö on nimenomaan se
// mikä saa muuttua: siitä talteen menee vain tunniste, ks. app.js.

const CONNECTION_DEFAULTS = {
  scheme: 'http', host: '', port: '8080', username: '', password: '',
  streamMode: 'auto',
  // Kumpi lomake asetuksissa avataan. Ei vaikuta yhteyteen: kummastakin
  // syntyy sama palvelin ja samat tunnukset.
  sourceMode: 'xtream',     // xtream | m3u
};

const SETTINGS_DEFAULTS = {
  // Käyttöliittymän kieli, ks. js/i18n.js. Oletus on englanti.
  lang: 'en',
  epgEnabled: true,
  resumeEnabled: true,
  // Tekstityskieli valitaan kerran ja se pätee seuraaviin jaksoihin.
  // 'off' = ei tekstitystä; muuten kaksikirjaiminen koodi.
  subtitleLang: 'fi',
  subtitleSize: 'small',    // small | medium | large
};

const MAX_RECENTS = 60;
const MAX_RESUME = 400;

export const itemKey = (item) => `${item.k}:${item.id}`;

async function read(key, fallback) {
  const data = await chrome.storage.local.get(key);
  return data[key] === undefined ? fallback : data[key];
}

export async function loadConfig() {
  return { ...CONNECTION_DEFAULTS, ...(await read('config', {})) };
}

export async function saveConfig(patch) {
  const next = { ...(await loadConfig()), ...patch };
  await chrome.storage.local.set({ config: next });
  return next;
}

export async function loadSettings() {
  return { ...SETTINGS_DEFAULTS, ...(await read('settings', {})) };
}

export async function saveSettings(patch) {
  const next = { ...(await loadSettings()), ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

export async function loadUiState() { return read('ui', {}); }

export async function saveUiState(patch) {
  const ui = { ...(await loadUiState()), ...patch };
  await chrome.storage.local.set({ ui });
}

/* ------------------------------------------------------------ suosikit */

export async function loadFavorites() {
  const list = await read('favorites', []);
  return new Map(list.map((item) => [itemKey(item), item]));
}

export async function saveFavorites(map) {
  await chrome.storage.local.set({ favorites: [...map.values()] });
}

/* ------------------------------------------------------------- historia */

export async function loadRecents() { return read('recents', []); }

export async function pushRecent(item) {
  const key = itemKey(item);
  const list = (await loadRecents()).filter((r) => itemKey(r) !== key);
  list.unshift({ ...item, watchedAt: Date.now() });
  const trimmed = list.slice(0, MAX_RECENTS);
  await chrome.storage.local.set({ recents: trimmed });
  return trimmed;
}

export async function removeRecent(key) {
  const list = (await loadRecents()).filter((r) => itemKey(r) !== key);
  await chrome.storage.local.set({ recents: list });
  return list;
}

export async function clearRecents() {
  await chrome.storage.local.set({ recents: [] });
}

/* -------------------------------------------------------- katselukohdat */

export async function loadResume() {
  return new Map(Object.entries(await read('resume', {})));
}

export async function saveResume(map) {
  // Vanhimmat karsitaan, jottei tallennustila kasva rajatta.
  const entries = [...map.entries()].sort((a, b) => b[1].at - a[1].at).slice(0, MAX_RESUME);
  await chrome.storage.local.set({ resume: Object.fromEntries(entries) });
}
