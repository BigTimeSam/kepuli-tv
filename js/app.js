import { XtreamApi, ApiError } from './api.js';
import { Library, sortItems } from './library.js';
import { Epg } from './epg.js';
import { Playback } from './playback.js';
import { VirtualList } from './vlist.js';
import { itemRow, categoryRow, chipRow, favCategoryRow, sectionHeader, emptyState } from './rows.js';
import { nameCleaner } from './name.js';
import { EpgGrid, catchupAvailable } from './epggrid.js';
import { cacheClear, wipeStorage, storageEstimate } from './db.js';
import { parsePlaylistUrl, streamUrl, timeshiftUrl, baseUrl } from './xtream.js';
import { requestAccess, hasAccess } from './permissions.js';
import { externalLabel, handOff } from './external.js';
import { warmCache, peek, badge as probeBadge, subtitleSummary, shortLanguage } from './probe.js';
import * as store from './config.js';
import { nf, dateTimeFmt, dateFmt, stampFmt, dayLabel, clock, megabytes, duration, progressOf, setLocale } from './format.js';
import { t, applyStatic, setLanguage, localeTag, LANGUAGES } from './i18n.js';

const $ = (id) => document.getElementById(id);
const el = {
  tabs: $('tabs'), search: $('search'), groups: $('groups'), groupsCol: $('groups-col'),
  categoryFilter: $('category-filter'), groupsFilter: $('groups-filter'),
  list: $('list'), crumbs: $('crumbs'), detail: $('detail'),
  listinfo: $('listinfo'), main: $('main'), accountMeta: $('account-meta'), subcats: $('subcats'),
  video: $('video'), overlay: $('overlay'), overlayTitle: $('overlay-title'),
  overlayText: $('overlay-text'), overlayActions: $('overlay-actions'), statbadge: $('statbadge'),
  infostrip: $('infostrip'), nowTitle: $('now-title'), nowSub: $('now-sub'), mode: $('mode'),
  subs: $('subs'), subsize: $('subsize'),
  setup: $('setup'), progress: $('progress'),
  epg: $('epg'), epgPreview: $('epg-preview'),
  pTitle: $('p-title'), pFill: $('p-fill'), pText: $('p-text'), toast: $('toast'),
};

const TYPE_OF_TAB = { live: 'live', movie: 'movie', series: 'series' };
const TYPE_KIND = { live: 0, movie: 1, series: 2 };

/** "3 kanavaa" / "3 channels" — tyyppi valitsee avaimen, luku monikon. */
const unit = (type, count) => t(`unit.${type || 'generic'}`, { count, n: nf.format(count) });

// Suosikit ja historia eivät ole palvelimen listoja vaan käyttäjän omia
// kokoelmia: ne ovat aina muistissa, sekoittavat kaikkia neljää tyyppiä ja
// jäsentyvät sivupalkissa tyypin — eivät maan — mukaan.
const COLLECTIONS = new Set(['fav', 'recent']);
// 'c' = suosikkikategoria: ei toistettava kohde vaan portti listaan, ks.
// favCategoryEntry. Se on kokoelmassa oma tyyppinsä ja ensimmäisenä, koska
// yksi kategoriarivi kattaa kymmeniä kanavia.
const kindLabel = (kind) => t(`kind.${kind}`);
const KIND_ORDER = ['c', 0, 1, 2];
const KIND_INDEX = new Map(KIND_ORDER.map((kind, i) => [kind, i]));
// Kokoelmissa jakso on vain sarjan osa, joten se lasketaan ja otsikoidaan
// sarjaksi — muuten historia näyttäisi tyypin jota välilehdissä ei ole.
const kindGroup = (k) => (k === 3 ? 2 : k);
const ROW_H = 50;   // sama luku kuin --row-h player.css:ssä
const SEP_H = 26;   // sama luku kuin --sep-h player.css:ssä

const state = {
  config: null, settings: null, account: null,
  source: null, lib: null, epg: null,
  tab: 'live',
  group: null,            // valittu maa/aihe, null = kaikki
  sub: null,              // tarkenne ryhmän sisällä (category_id)
  groupItems: [],         // valitun ryhmän kaikki kohteet muistissa
  categoryFilter: '', query: '',
  cleanName: null,        // rivinimen siistijä, null = nimi sellaisenaan
  kind: null,             // kokoelmien tyyppisuodatin, null = kaikki
  rows: [], rowIndex: new Map(), sections: new Map(), cursor: -1,
  // Poraus listan sisään. Sarjalla ja suosikkikategorialla on sama paikka
  // ja sama paluunappi, joten ne ovat yksi tila kahdella muodolla:
  //   { view: 'series',   item, info, season, back }
  //   { view: 'category', entry, items, back }
  // back kantaa edellisen porauksen: suosikkikategoriasta avattu sarja
  // palaa kategoriaan, ei kokoelman juureen.
  detail: null,
  catCounts: null,        // suosikkikategorioiden koot, kun ne ovat tiedossa
  playing: null, playingSpec: null, catchup: null,
  subtitles: [],          // toistettavan tiedoston tekstitysraidat
  favorites: new Map(), recents: [], resume: new Map(),
  lastGroup: {}, lastKind: {},
};

const isCollection = () => COLLECTIONS.has(state.tab);

/* ================================================================ yhteys */

async function connect({ silent = false } = {}) {
  const config = state.config;
  try {
    if (!config.host || !config.username || !config.password) { openSetup(); return false; }
    state.source = new XtreamApi(config);

    if (!silent) showProgress(t('progress.connecting'), config.host);
    state.account = await state.source.account();
    state.lib = new Library(state.source);
    // Aiemmin luetut tiedosto-otsikot muistiin, jotta listarivit voivat
    // näyttää tuloksen ilman verkkopyyntöä piirron aikana.
    await warmCache();
    state.epg = new Epg(state.source, onEpgUpdated);
    state.epg.enabled = state.settings.epgEnabled;
    await state.lib.loadCategories();
    hideProgress();

    renderAccount();
    renderNowSub();
    renderSidebar();
    await activateTab(state.tab, { restore: true });
    return true;
  } catch (err) {
    hideProgress();
    showConnectionError(err);
    return false;
  }
}

function showConnectionError(err) {
  const apiError = err instanceof ApiError;
  el.overlay.hidden = false;
  el.overlay.classList.remove('loading');
  el.overlayTitle.textContent = t('error.connect.title');
  el.overlayText.textContent = apiError
    ? err.message
    : t('error.unexpected', { message: err.message });
  const actions = [{ label: t('btn.settings'), onClick: openSetup }];
  showOverlayActions(actions);
  if (state.config.host) {
    offerAccess(baseUrl(state.config), actions, () => connect());
  }
  console.error('[iptv] yhteysvirhe', err);
}

/**
 * Puuttuva host-oikeus näkyy samanlaisena verkkovirheenä kuin alhaalla oleva
 * palvelin, joten virheen syytä ei voi päätellä — tarkistetaan oikeus ja
 * tarjotaan sen myöntämistä vain jos se todella puuttuu.
 */
async function offerAccess(url, actions, onGranted) {
  if (!url || await hasAccess(url)) return;
  if (el.overlay.hidden) return;            // tilanne ehti vaihtua
  showOverlayActions([grantAction(url, onGranted), ...actions]);
}

/** Painike joka pyytää host-oikeuden ja jatkaa jos käyttäjä myöntää. */
function grantAction(url, onGranted) {
  let origin = url;
  try { origin = new URL(url).host; } catch { /* näytetään koko osoite */ }
  return {
    label: t('error.grant', { origin }),
    // requestAccess kutsutaan ennen ensimmäistä awaitia, muuten käyttäjän
    // ele on kulunut eikä Chrome näytä oikeusdialogia lainkaan.
    onClick: async () => {
      if (await requestAccess(url)) await onGranted();
      else toast(t('error.grant.denied'));
    },
  };
}

function renderAccount() {
  const a = state.account;
  if (!a) { el.accountMeta.textContent = ''; return; }
  const bits = [];
  if (a.maxConnections) bits.push(t('account.connections', { active: a.activeConnections, max: a.maxConnections }));
  if (a.expiresAt) {
    const days = Math.round((a.expiresAt - Date.now()) / 86400e3);
    bits.push(days < 14
      ? t('account.expiring', { days })
      : t('account.valid', { date: dateFmt.format(new Date(a.expiresAt)) }));
  }
  el.accountMeta.textContent = bits.join(' · ');
  el.accountMeta.classList.toggle('warn', a.status !== 'Active');
}

/* =============================================================== näkymät */

function tabType() { return TYPE_OF_TAB[state.tab] || null; }

async function activateTab(tab, { restore = false } = {}) {
  state.tab = tab;
  for (const button of el.tabs.children) button.classList.toggle('active', button.dataset.tab === tab);
  state.detail = null;
  state.cursor = -1;
  state.sub = null;
  state.group = restore ? (state.lastGroup[tab] ?? null) : null;
  state.kind = restore ? (state.lastKind[tab] ?? null) : null;

  const type = tabType();

  // Ensimmäinen avaus: valitaan ryhmä, jotta lista täyttyy muutamalla
  // kilotavulla sen sijaan että ladattaisiin koko tyypin lista heti.
  if (type && state.group == null && !state.lib.isFull(type)) {
    const groups = state.lib.groups[type];
    if (groups.length) state.group = groups[0].name;
  }

  store.saveUiState({ tab });
  renderSidebar();
  await refreshRows();
}

async function refreshRows({ keepScroll = false } = {}) {
  const type = tabType();
  let rows = [];
  renderDetail();   // sarjan tietopaneeli seuraa tilaa myös välilehteä vaihdettaessa

  try {
    if (state.detail) {
      rows = state.detail.view === 'category' ? state.detail.items : episodesOfSeason();
    } else if (isCollection()) {
      rows = collectionItems();
      if (state.kind != null) rows = rows.filter((it) => kindGroup(it.k) === state.kind);
      // Array.sort on vakaa, joten tyypeittäin ryhmittely ei sotke
      // kokoelman omaa järjestystä tyypin sisällä.
      else if (state.tab === 'fav') rows = [...rows].sort((a, b) => kindIndex(a) - kindIndex(b));
    } else if (state.query) {
      if (!(await ensureFull(type, t('progress.reason.search')))) return;
      rows = state.lib.search(type, state.query, null);
    } else if (state.group == null) {
      if (!(await ensureFull(type, t('progress.reason.all')))) return;
      rows = state.lib.full[type];
    } else {
      state.groupItems = await loadGroupItems(type, state.group);
      rows = state.sub
        ? state.groupItems.filter((it) => it.cats.includes(state.sub))
        : state.groupItems;
    }
  } catch (err) {
    hideProgress();
    showConnectionError(err);
    return;
  }

  if (state.query && isCollection()) {
    const q = state.query.toLowerCase();
    rows = rows.filter((it) => it.n.toLowerCase().includes(q));
  }

  // Näkyvä nimi ratkaisee järjestyksen: kun riviltä on karsittu etuliite,
  // kirjaston aakkostus ei enää vastaa sitä mitä lista näyttää.
  state.cleanName = nameCleanerFor(rows);
  if (state.cleanName) rows = sortItems(rows, state.cleanName);
  state.rows = rows;
  state.catCounts = categoryCountsFor(rows);
  state.rowIndex = new Map(rows.map((it, i) => [`${it.k}:${it.id}`, i]));
  state.sections = sectionsFor(rows);
  vlist.setCount(rows.length, {
    keepScroll,
    heightAt: state.sections.size ? (i) => ROW_H + (state.sections.has(i) ? SEP_H : 0) : null,
  });
  // Opas näyttää saman joukon kuin lista, joten haku ja ryhmävalinta
  // rajaavat sitä ilman omaa suodatinta.
  if (guideOpen && state.tab === 'live') grid.setChannels(rows.filter((it) => it.k === 0));
  renderSubcats();
  renderListInfo();
  renderEmptyState();
}

/* =========================================================== kokoelmat */

/** Suosikkien ja historian koko joukko ennen suodattimia. */
function collectionItems() {
  return state.tab === 'fav' ? favoritesNewestFirst() : state.recents;
}

/**
 * Suosikit tuoreusjärjestyksessä. Vanhoista merkinnöistä puuttuu addedAt,
 * joten ne pitävät tallennusjärjestyksensä uusien perässä.
 */
function favoritesNewestFirst() {
  return [...state.favorites.values()]
    .map((item, i) => ({ item, i }))
    .sort((a, b) => (b.item.addedAt || 0) - (a.item.addedAt || 0) || b.i - a.i)
    .map((entry) => entry.item);
}

const kindIndex = (item) => KIND_INDEX.get(kindGroup(item.k)) ?? KIND_ORDER.length;

/* ------------------------------------------------- suosikkikategoriat */

/**
 * Kategoriasuosikki mahtuu samaan säilöön kuin kohteet: se on kokoelmarivi
 * kuten muutkin, ja avain `${k}:${id}` erottaa sen omakseen. Siksi
 * config.js:n suosikkilista kelpaa sellaisenaan.
 *
 * Talteen menee tunniste, ei sisältö: "MTV Liiga" on suosikki nimenä ja
 * kategoriana, ja sen kanavat haetaan aina tuoreena — juuri siksi
 * kategoria on suosikkina eri asia kuin joukko yksittäisiä kanavia.
 *
 *   c   category_id, tai null jos suosikki on koko ryhmä ("Finland")
 *   g   ryhmän nimi, eli mistä sivupalkin kohdasta kategoria löytyy
 *   n   näkyvä nimi, full = palveluntarjoajan koko kategorianimi
 */
function favCategoryEntry(type, groupName, cat) {
  return cat
    ? { k: 'c', id: `${type}:${cat.id}`, t: type, c: cat.id, g: groupName, n: cat.sub || groupName, full: cat.name }
    : { k: 'c', id: `${type}:g:${groupName}`, t: type, c: null, g: groupName, n: groupName, full: null };
}

const isFavorite = (entry) => state.favorites.has(`${entry.k}:${entry.id}`);

/**
 * Rivin alateksti: mitä ja mistä. Tyyppi on tarpeen, koska kokoelmassa on
 * sekaisin kanava-, elokuva- ja sarjakategorioita; ryhmä siksi, että sama
 * tarkenne ("Sport") toistuu maasta toiseen.
 */
function favCategorySubtitle(entry) {
  const bits = [kindLabel(TYPE_KIND[entry.t])];
  if (entry.c == null) {
    const group = state.lib ? state.lib.group(entry.t, entry.g) : null;
    if (group && group.cats.length > 1) bits.push(t('list.topics', { n: group.cats.length }));
  } else if (entry.g && entry.g !== entry.n) bits.push(entry.g);
  return bits.join(' · ');
}

/**
 * Kategorioiden koot kerran per piirto, ei riviä kohti: laskenta käy koko
 * tyypin listan läpi ja rivit piirretään uudelleen joka vieritysruudulla.
 * Luku on tiedossa vain jos lista on jo ladattu — kategoriasuosikin idea on
 * juuri se, ettei sitä tarvitse ladata nähdäkseen suosikkinsa.
 */
function categoryCountsFor(rows) {
  if (!state.lib || !rows.some((it) => it.k === 'c')) return null;
  // Kumpikin laskenta käy koko tyypin listan läpi, joten tulos otetaan
  // talteen eikä sitä pyydetä kahdesti samalle tyypille.
  const cache = new Map();
  const source = (kind, type) => {
    const key = `${kind}:${type}`;
    if (!cache.has(key)) {
      cache.set(key, kind === 'groups' ? state.lib.groupCounts(type) : state.lib.categoryCounts(type));
    }
    return cache.get(key);
  };

  const counts = new Map();
  for (const row of rows) {
    if (row.k !== 'c') continue;
    const map = source(row.c == null ? 'groups' : 'cats', row.t);
    const count = map && map.get(row.c == null ? row.g : row.c);
    if (count != null) counts.set(`${row.k}:${row.id}`, count);
  }
  return counts.size ? counts : null;
}

/**
 * Avaa kategorian kokoelman sisällä: sama porautuminen kuin sarjaan, jotta
 * paluu suosikkeihin on yksi napautus eikä välilehden vaihto.
 */
async function openFavCategory(entry) {
  if (!state.lib) { toast(t('error.noserver')); return; }
  const back = state.detail;
  state.detail = { view: 'category', entry, items: [], back };
  state.cursor = -1;
  renderDetail();
  state.rows = [];
  state.sections = new Map();
  vlist.setCount(0);
  const open = state.detail;
  try {
    const items = entry.c == null
      ? await loadGroupItems(entry.t, entry.g)
      : await state.lib.categoryItems(entry.t, entry.c);
    if (state.detail !== open) return;
    state.detail.items = items;
    await refreshRows();
  } catch (err) {
    if (state.detail === open) { state.detail = back; renderDetail(); await refreshRows(); }
    showConnectionError(err);
  }
}

/**
 * Kategorian tähti selausnäkymissä. Suosikkilista on kokoelman oma näkymä,
 * joten sivupalkki ja tarkennesirut piirretään uusiksi vain kun ollaan
 * muualla — suosikeissa koko lista muuttuu.
 */
function toggleFavCategory(entry) {
  const key = `${entry.k}:${entry.id}`;
  if (state.favorites.has(key)) state.favorites.delete(key);
  else state.favorites.set(key, { ...entry, addedAt: Date.now() });
  store.saveFavorites(state.favorites);
  if (state.tab === 'fav') { renderSidebar(); refreshRows({ keepScroll: true }); }
  else { renderCategories(); renderSubcats(); }
}

/**
 * Väliotsikot: rivin indeksi → otsikko sen yläpuolelle. Historia jakautuu
 * päiviin, suosikit tyyppeihin — kummassakin otsikko kertoo sen mitä rivit
 * eivät itse näytä. Tyyppisuodatin tekee suosikkien otsikoista turhia.
 */
function sectionsFor(rows) {
  const sections = new Map();
  if (!isCollection() || state.detail) return sections;
  if (state.tab === 'fav' && state.kind != null) return sections;

  let previous = null;
  for (let i = 0; i < rows.length; i++) {
    const label = state.tab === 'recent' ? dayLabel(rows[i].watchedAt) : kindLabel(kindGroup(rows[i].k));
    if (label && label !== previous) sections.set(i, label);
    previous = label;
  }
  // Yksi tyyppiotsikko koko listan päällä ei jäsennä mitään, ja sivupalkki
  // kertoo saman. Päiväotsikko sen sijaan kertoo myös milloin — se jää.
  if (state.tab === 'fav' && sections.size < 2) return new Map();
  return sections;
}

async function removeFromHistory(item) {
  state.recents = await store.removeRecent(`${item.k}:${item.id}`);
  renderSidebar();
  await refreshRows({ keepScroll: true });
}

async function clearHistory() {
  await store.clearRecents();
  state.recents = [];
  state.kind = null;
  state.lastKind.recent = null;
  renderSidebar();
  await refreshRows();
  toast(t('history.cleared'));
}

/**
 * Ryhmän sisältö haetaan alakategoria kerrallaan. Sweden = 31 kategoriaa
 * á ~2 kt on yhä murto-osa koko listan 634 kilotavusta, ja tämän jälkeen
 * tarkenteiden välillä vaihtaminen ei vaadi verkkoa lainkaan.
 */
async function loadGroupItems(type, groupName) {
  const group = state.lib.group(type, groupName);
  const heavy = group && group.cats.length > 3 && !state.lib.isFull(type);
  if (heavy) showProgress(t('progress.group', { group: groupName }), t('progress.categories', { done: 0, total: group.cats.length }));
  try {
    return await state.lib.groupItems(type, groupName, {
      onProgress: (done, total) => {
        if (!heavy) return;
        el.pFill.parentElement.classList.remove('indeterminate');
        fillBar(done / total);
        el.pText.textContent = t('progress.categories', { done, total });
      },
    });
  } finally {
    if (heavy) hideProgress();
  }
}

/** Tarkennesuodattimet valitun ryhmän sisällä. */
function renderSubcats() {
  const type = tabType();
  const group = type && state.group ? state.lib.group(type, state.group) : null;
  if (!group || group.cats.length < 2 || state.detail || state.query) {
    el.subcats.hidden = true;
    el.subcats.replaceChildren();
    return;
  }
  const counts = new Map();
  for (const item of state.groupItems) {
    for (const cat of item.cats) counts.set(cat, (counts.get(cat) || 0) + 1);
  }
  // Painikkeet aakkosjärjestyksessä, mutta ryhmän oma yleiskategoria
  // ("Sweden" ilman tarkennetta) heti Kaikki-painikkeen perään: se ei ole
  // aihe muiden joukossa vaan maan pääkanavat.
  const ordered = [...group.cats].sort((a, b) => {
    if (!a.sub !== !b.sub) return a.sub ? 1 : -1;
    return (a.sub || '').localeCompare(b.sub || '', 'fi');
  });

  const frag = document.createDocumentFragment();
  // "Kaikki" on koko ryhmä, ja sen tähti on sivupalkin rivillä — kaksi
  // nappia samalle suosikille hämärtäisi kumpaakin.
  frag.appendChild(chipRow({
    label: t('subcats.all'), count: nf.format(state.groupItems.length), active: state.sub == null,
  }, () => selectSub(null)));
  for (const cat of ordered) {
    const count = counts.get(cat.id) || 0;
    if (count === 0) continue;
    const entry = favCategoryEntry(type, group.name, cat);
    frag.appendChild(chipRow({
      label: cat.sub || t('subcats.general'), count: nf.format(count), active: state.sub === cat.id, title: cat.name,
      favorite: isFavorite(entry),
      onFavorite: () => toggleFavCategory(entry),
    }, () => selectSub(cat.id)));
  }
  el.subcats.replaceChildren(frag);
  el.subcats.hidden = false;
}

async function selectSub(categoryId) {
  state.sub = categoryId;
  state.cursor = -1;
  await refreshRows();
}

async function ensureFull(type, reason) {
  if (state.lib.isFull(type)) return true;
  showProgress(t('progress.list', { what: t(`progress.list.${type}`) }), reason);
  try {
    await state.lib.ensureFull(type, {
      onProgress: (received, total) => updateProgress(received, total),
    });
    renderSidebar();
    return true;
  } catch (err) {
    hideProgress();
    showConnectionError(err);
    return false;
  } finally {
    hideProgress();
  }
}

function renderEmptyState() {
  const existing = el.list.querySelector('.empty');
  if (existing) existing.remove();
  if (state.rows.length > 0) return;
  const type = tabType();
  const browse = { label: t('empty.browse'), onClick: () => activateTab('live') };
  let node;
  if (state.query) node = emptyState(t('empty.nohits'), t('empty.nohits.text', { query: state.query }));
  else if (state.detail && state.detail.view === 'category') {
    node = emptyState(t('empty.category'), t('empty.category.text'));
  } else if (state.tab === 'fav') {
    node = emptyState(t('empty.fav'), t('empty.fav.text'), browse);
  } else if (state.tab === 'recent') {
    node = emptyState(t('empty.recent'), t('empty.recent.text'), browse);
  } else node = emptyState(t('empty.plain'), t('empty.plain.text'));
  el.list.appendChild(node);
}

function renderListInfo() {
  const type = tabType();
  const parts = [];
  const count = state.rows.length;
  if (state.detail && state.detail.view === 'category') {
    const entry = state.detail.entry;
    parts.push(unit(entry.t, count));
    parts.push(crumbLabel(entry));
  } else if (state.detail) {
    parts.push(t('list.episodes', { count, n: nf.format(count) }));
  } else if (isCollection()) {
    parts.push(t('list.items', { count, n: nf.format(count) }));
  } else {
    parts.push(unit(type, count));
  }
  if (isCollection() && state.kind != null) parts.push(kindLabel(state.kind).toLowerCase());
  if (state.group && !state.detail && !state.query) {
    const group = state.lib.group(type, state.group);
    parts.push(state.sub
      ? state.lib.categoryName(type, state.sub)
      : `${state.group}${group && group.cats.length > 1 ? ` · ${t('list.topics', { n: group.cats.length })}` : ''}`);
  }
  if (type && state.lib && !state.lib.isFull(type) && !state.detail) parts.push(t('list.partial'));

  el.listinfo.replaceChildren(document.createTextNode(parts.join(' · ')));
  if (state.tab === 'recent' && state.recents.length) {
    const spacer = document.createElement('span');
    spacer.className = 'spacer';
    el.listinfo.append(spacer, clearHistoryButton());
  }
}

/**
 * Historian tyhjennys on peruuttamaton, joten se vaatii toisen
 * napautuksen. Erillinen dialogi olisi tälle painoarvolle liikaa.
 */
function clearHistoryButton() {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = t('history.clear');
  let armed = false;
  let timer = null;
  button.addEventListener('click', () => {
    if (armed) { clearTimeout(timer); clearHistory(); return; }
    armed = true;
    button.textContent = t('history.clear.confirm');
    button.classList.add('armed');
    timer = setTimeout(() => {
      armed = false;
      button.textContent = t('history.clear');
      button.classList.remove('armed');
    }, 4000);
  });
  return button;
}

/* ============================================================ sivupalkki */

/**
 * Sivupalkki on sama laatikko kaikilla välilehdillä, mutta sen sisältö
 * vaihtuu: listoilla maat ja aiheet, kokoelmissa tyypit. Näin suosikit ja
 * historia saavat saman rakenteen kuin muutkin näkymät sen sijaan että
 * palkki jäisi tyhjäksi.
 */
function renderSidebar() {
  if (isCollection()) renderKinds();
  else renderCategories();
}

function renderKinds() {
  el.groupsFilter.hidden = true;
  const items = collectionItems();
  // Tyhjä kokoelma ei tarvitse suodatinta: tyhjätilan teksti kertoo enemmän
  // kuin rivi "Kaikki 0".
  if (!items.length) { el.groups.replaceChildren(); return; }

  const counts = new Map();
  for (const item of items) { const k = kindGroup(item.k); counts.set(k, (counts.get(k) || 0) + 1); }

  const frag = document.createDocumentFragment();
  frag.appendChild(categoryRow(
    { id: null, name: t('groups.all'), count: items.length, active: state.kind == null, all: true },
    selectKind,
  ));
  for (const kind of KIND_ORDER) {
    const count = counts.get(kind) || 0;
    if (count === 0) continue;
    frag.appendChild(categoryRow(
      { id: kind, name: kindLabel(kind), count, active: state.kind === kind },
      selectKind,
    ));
  }
  el.groups.replaceChildren(frag);
}

async function selectKind(kind) {
  state.kind = kind;
  // Sivupalkin valinta koskee kokoelmaa, ei sen sisään porautunutta
  // listaa — muuten napautus ei näyttäisi tekevän mitään.
  state.detail = null;
  state.cursor = -1;
  state.lastKind[state.tab] = kind;
  renderKinds();
  await refreshRows();
}

function renderCategories() {
  const type = tabType();
  el.groupsFilter.hidden = false;
  if (!type || !state.lib) { el.groups.replaceChildren(); return; }

  const counts = state.lib.groupCounts(type);
  const filter = state.categoryFilter.trim().toLowerCase();
  // Suodatin osuu myös alakategorioihin, jotta "sport" löytää maat joilla
  // sellainen on, vaikka maan nimessä ei lue sanaa.
  const groups = state.lib.groups[type].filter((g) => !filter
    || g.name.toLowerCase().includes(filter)
    || g.cats.some((c) => c.name.toLowerCase().includes(filter)));

  const frag = document.createDocumentFragment();
  if (!filter) {
    const total = state.lib.full[type] ? state.lib.full[type].length : null;
    const all = categoryRow(
      { id: null, name: t('groups.all'), count: total, active: state.group == null, all: true, indent: true },
      selectGroup,
    );
    if (total == null) all.title = t('groups.all.title');
    frag.appendChild(all);
  }
  for (const group of groups) {
    // Ryhmäsuosikki kattaa kaikki alakategoriat: "Finland" tuo koko maan
    // tarjonnan, myös sen mitä siihen ilmestyy vasta myöhemmin.
    const entry = favCategoryEntry(type, group.name, null);
    frag.appendChild(categoryRow({
      id: group.name, name: group.name,
      count: counts ? counts.get(group.name) || 0 : null,
      active: state.group === group.name,
      favorite: isFavorite(entry),
      onFavorite: () => toggleFavCategory(entry),
    }, selectGroup));
  }
  el.groups.replaceChildren(frag);
}

async function selectGroup(name) {
  state.group = name;
  state.sub = null;
  state.detail = null;
  state.cursor = -1;
  state.lastGroup[state.tab] = name;
  renderSidebar();
  await refreshRows();
}

/* ================================================================ rivit */

const vlist = new VirtualList(el.list, ROW_H, renderRow, {
  onVisible: (first, last) => {
    // Opastilassa lista on piilossa, ja sen näkymärivit veisivät
    // ohjelmatietojen työjonon ruudukolta.
    if (state.epg && !guideOpen) state.epg.setVisible(state.rows.slice(first, last));
  },
});

function renderRow(index) {
  const item = state.rows[index];
  const key = `${item.k}:${item.id}`;
  const row = item.k === 'c' ? favCategoryRow(item, {
    subtitle: favCategorySubtitle(item),
    count: state.catCounts && state.catCounts.has(key) ? nf.format(state.catCounts.get(key)) : null,
    selected: index === state.cursor,
    onOpen: () => { state.cursor = index; openFavCategory(item); },
    onFavorite: () => toggleFavCategory(item),
  }) : itemRow(item, {
    label: state.cleanName ? state.cleanName(item.n) : null,
    playing: state.playing && `${state.playing.k}:${state.playing.id}` === key,
    selected: index === state.cursor,
    favorite: state.favorites.has(key),
    epg: item.k === 0 && state.epg ? state.epg.nowNext(item.id) : null,
    resume: state.resume.get(key),
    tag: tagFor(item),
    probe: probeFor(item),
    onOpen: () => { state.cursor = index; openItem(item); },
    onFavorite: () => toggleFavorite(item),
    onRemove: state.tab === 'recent' ? () => removeFromHistory(item) : null,
    removeTitle: t('row.remove.history'),
  });

  const label = state.sections.get(index);
  if (!label) return row;
  // Otsikko kulkee rivin mukana samassa solmussa, jolloin virtualisointi
  // pysyy indeksipohjaisena eikä state.rows tarvitse otsikkoalkioita.
  const group = document.createElement('div');
  group.className = 'rowgroup';
  group.append(sectionHeader(label), row);
  return group;
}

/**
 * Kun maa tai kategoria on valittu, sivupalkki kertoo saman minkä jokainen
 * rivinimi toistaa: "US: NHL Ice Center Pass 3 FHD" on NHL:n alla vain
 * "Ice Center Pass 3 FHD". Haussa ja kokoelmissa rivit tulevat eri
 * ryhmistä, joten siellä etuliite erottelee — ja jää paikalleen.
 */
function nameCleanerFor(rows) {
  // Suosikkikategorian sisällä suodatin on tiedossa vaikka sivupalkki ei
  // sitä näytä, joten rivinimet siistiytyvät kuten selausnäkymässä.
  if (state.detail && state.detail.view === 'category') {
    const entry = state.detail.entry;
    return nameCleaner(entry.g && entry.g !== entry.n ? [entry.g, entry.n] : [entry.n], rows);
  }
  if (isCollection() || state.detail || state.query || state.group == null) return null;
  const type = tabType();
  const group = type && state.lib ? state.lib.group(type, state.group) : null;
  if (!group) return null;
  const labels = [group.name];
  if (state.sub) {
    const cat = group.cats.find((c) => c.id === state.sub);
    if (cat && cat.sub) labels.push(cat.sub);
  }
  return nameCleaner(labels, rows);
}

/**
 * Historian rivi kertoo kellonajan; päivä tulee väliotsikosta. Suosikeissa
 * tyyppi näkyy jo otsikossa ja sivupalkissa, joten rivi jää siltä osin
 * rauhaan — kapeassa sarakkeessa jokainen merkki on tilaa nimeltä pois.
 */
function tagFor(item) {
  if (state.tab !== 'recent' || !item.watchedAt) return null;
  return { text: clock(item.watchedAt), title: t('row.watched', { stamp: stampFmt.format(new Date(item.watchedAt)) }) };
}

/**
 * Aiemmin luettu tiedosto-otsikko, jos sellainen on. Riviä piirrettäessä ei
 * tehdä verkkopyyntöjä: otsikko luetaan vasta toistoa yritettäessä, ja
 * seuraavalla kerralla tulos on jo tallessa.
 */
function probeFor(item) {
  if (item.k !== 1 && item.k !== 3) return null;
  if (!state.config) return null;
  const url = streamUrl(state.config, item, 'ts');
  return url ? peek(url) : null;
}

function onEpgUpdated(ids) {
  for (const id of ids) {
    const index = state.rowIndex.get(`0:${id}`);
    if (index != null) vlist.refreshRow(index);
  }
  if (state.playing && state.playing.k === 0 && ids.includes(String(state.playing.id))) renderInfoStrip();
  if (guideOpen) grid.invalidate();
}

function toggleFavorite(item) {
  const key = `${item.k}:${item.id}`;
  if (state.favorites.has(key)) state.favorites.delete(key);
  else state.favorites.set(key, { ...stripItem(item), addedAt: Date.now() });
  store.saveFavorites(state.favorites);
  if (state.tab === 'fav') { renderSidebar(); refreshRows({ keepScroll: true }); }
  else vlist.refresh();
  renderFavButton();
}

/** Talteen vain kentät joita listan piirtoon tarvitaan. */
function stripItem(item) {
  const { id, k, n, logo, ext, season, episode, archive, epgId, direct, cats, durationSec } = item;
  return { id, k, n, logo, ext, season, episode, archive, epgId, direct, cats, durationSec };
}

/* =============================================================== sarjat */

async function openItem(item) {
  if (item.k === 'c') return openFavCategory(item);
  if (item.k === 2) return openSeries(item);
  await playItem(item);
}

async function openSeries(item) {
  // Suosikkikategoriasta avattu sarja jää kategorian sisään: paluu vie
  // takaisin listaan josta se valittiin.
  const back = state.detail && state.detail.view === 'category' ? state.detail : null;
  state.detail = { view: 'series', item, info: null, season: null, back };
  renderDetail();
  state.rows = [];
  state.sections = new Map();
  vlist.setCount(0);
  try {
    const info = await state.lib.seriesEpisodes(item.id);
    if (!state.detail || state.detail.view !== 'series' || state.detail.item.id !== item.id) return;
    state.detail.info = info;
    const seasons = seasonNumbers(info.episodes);
    state.detail.season = seasons[0] ?? null;
    renderDetail();
    await refreshRows();
  } catch (err) {
    showConnectionError(err);
  }
}

function seasonNumbers(episodes) {
  return [...new Set(episodes.map((e) => e.season))].sort((a, b) => a - b);
}

function episodesOfSeason() {
  const detail = state.detail;
  if (!detail || detail.view !== 'series' || !detail.info) return [];
  const eps = detail.info.episodes;
  return detail.season == null ? eps : eps.filter((e) => e.season === detail.season);
}

// Läpinäkyvä 1×1 GIF. Chrome piirtää ohuen kehyksen ja rikkinäisen kuvan
// merkin jokaiseen kuvaan jolla ei ole ladattua lähdettä — myös silloin kun
// src on poistettu kokonaan, joten pelkkä poisto ei riitä. Pikselin jälkeen
// näkyviin jää vain elementin oma pohja, joka on muutenkin puuttuvan kannen
// paikanpitäjä.
const BLANK_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

/**
 * Kansikuva, joka ei jätä rikkinäistä kuvaa näkyviin: osa kirjaston kansi- ja
 * logo-osoitteista on kuolleita. Listariveillä (rows.js) sama tilanne
 * hoidetaan piilottamalla kuva kokonaan, koska siellä ei ole pohjaa jonka
 * varaan jäädä.
 */
function coverImage(className, src) {
  const img = document.createElement('img');
  if (className) img.className = className;
  img.alt = '';
  img.src = src || BLANK_PIXEL;
  if (src) img.addEventListener('error', () => { img.src = BLANK_PIXEL; }, { once: true });
  return img;
}

function renderDetail() {
  const detail = state.detail;
  // Kategorialla ei ole juonta eikä kansikuvaa — sen sisältö on lista, ja
  // murupolku riittää kertomaan missä ollaan.
  el.detail.hidden = !detail || detail.view === 'category';
  el.crumbs.hidden = !detail;
  if (!detail) { el.detail.replaceChildren(); el.crumbs.replaceChildren(); return; }

  el.crumbs.replaceChildren();
  const back = document.createElement('button');
  back.type = 'button';
  back.textContent = t('crumbs.back');
  back.addEventListener('click', closeDetail);
  const label = document.createElement('span');
  label.textContent = detail.view === 'category' ? crumbLabel(detail.entry) : detail.item.n;
  el.crumbs.append(back, label);

  if (detail.view === 'category') { el.detail.replaceChildren(); return; }

  const info = detail.info;
  const main = document.createElement('div');
  main.className = 'detail-main';

  const cover = coverImage('detail-cover', (info && info.cover) || detail.item.logo);
  cover.loading = 'lazy';
  main.appendChild(cover);

  const body = document.createElement('div');
  body.className = 'detail-body';
  const title = document.createElement('div');
  title.className = 'detail-title';
  title.textContent = detail.item.n;
  body.appendChild(title);

  const meta = document.createElement('div');
  meta.className = 'detail-meta';
  const bits = [];
  if (info) {
    if (info.releaseDate) bits.push(String(info.releaseDate).slice(0, 4));
    if (info.genre) bits.push(info.genre);
    if (info.rating) bits.push(`★ ${info.rating}`);
    bits.push(t('list.episodes', { count: info.episodes.length, n: nf.format(info.episodes.length) }));
  } else bits.push(t('progress.loading'));
  for (const bit of bits) {
    const span = document.createElement('span');
    span.textContent = bit;
    meta.appendChild(span);
  }
  body.appendChild(meta);

  if (info && (info.plot || detail.item.plot)) {
    const plot = document.createElement('div');
    plot.className = 'detail-plot';
    plot.textContent = info.plot || detail.item.plot;
    body.appendChild(plot);
  }
  main.appendChild(body);
  el.detail.replaceChildren(main);

  if (info) {
    const seasons = seasonNumbers(info.episodes);
    if (seasons.length > 1) {
      const bar = document.createElement('div');
      bar.className = 'seasons';
      for (const season of seasons) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'season' + (season === detail.season ? ' active' : '');
        chip.textContent = t('season', { season });
        chip.addEventListener('click', () => {
          detail.season = season;
          renderDetail();
          refreshRows();
        });
        bar.appendChild(chip);
      }
      el.detail.appendChild(bar);
    }
  }
}

/** "Finland › MTV Liiga" — sama polku jolla kategoria selauksessa löytyy. */
function crumbLabel(entry) {
  return entry.g && entry.g !== entry.n ? `${entry.g} › ${entry.n}` : entry.n;
}

function closeDetail() {
  state.detail = (state.detail && state.detail.back) || null;
  state.cursor = -1;
  renderDetail();
  refreshRows();
}

/* =============================================================== toisto */

const playback = new Playback(el.video, onPlaybackState);

function onPlaybackState(s) {
  if (s.status === 'playing') {
    el.overlay.hidden = true;
    el.overlay.classList.remove('loading');
    showOverlayActions(null);
    renderNowSub(s.engine);
  } else if (s.status === 'loading') {
    el.overlay.hidden = false;
    el.overlay.classList.add('loading');
    el.overlayTitle.textContent = t('progress.connecting');
    el.overlayText.textContent = `${state.playing ? state.playing.n : ''} · ${s.engine}`;
    showOverlayActions(null);
  } else if (s.status === 'reconnecting') {
    el.overlay.hidden = false;
    el.overlay.classList.add('loading');
    el.overlayTitle.textContent = t('player.dropped');
    el.overlayText.textContent = (s.reason ? `${s.reason} · ` : '') + t('player.retrying', { attempt: s.attempt, max: s.max });
  } else if (s.status === 'notice') {
    // Toisto jatkuu, mutta katsojan on hyvä tietää miksi se päättyy kesken.
    toast(s.message);
  } else if (s.status === 'subtitles') {
    renderSubtitles(s.tracks, s.active);
    // Vaihto tuli selaimen omasta tekstitysvalikosta: sama valinta kuin
    // valitsimesta, joten kieli jää samalla tavalla muistiin.
    if (s.external) rememberSubtitleLanguage(s.active);
  } else if (s.status === 'probing') {
    el.overlay.hidden = false;
    el.overlay.classList.add('loading');
    el.overlayTitle.textContent = t('player.probing');
    el.overlayText.textContent = t('player.probing.text');
    showOverlayActions(null);
  } else if (s.status === 'blocked') {
    el.overlay.hidden = false;
    el.overlay.classList.remove('loading');
    el.overlayTitle.textContent = t('player.waiting');
    el.overlayText.textContent = s.message;
  } else if (s.status === 'error') {
    el.overlay.hidden = false;
    el.overlay.classList.remove('loading');
    el.overlayTitle.textContent = t('player.failed');
    el.overlayText.textContent = s.message;
    // Juuri tässä ulkoinen soitin on eniten arvoinen: selain on jo luovuttanut.
    const actions = [
      { label: t('player.retry'), onClick: () => state.playing && playItem(state.playing) },
      { label: t('ext.title'), onClick: playExternal },
      { label: t('player.copyurl'), onClick: copyUrl },
    ];
    // Kuva kelpaa mutta ääniraita ei: mykkä toisto on tarjolla, ei oletus.
    if (s.canSilent) {
      actions.unshift({
        label: t('player.silent'),
        onClick: () => state.playing && playItem(state.playing, { allowSilent: true }),
      });
    }
    showOverlayActions(actions);
    // Striimi voi osoittaa eri palvelimelle kuin rajapinta, joten oikeus
    // tarkistetaan juuri tämän striimin originille.
    if (state.playingSpec) {
      offerAccess(state.playingSpec.url, actions,
                  () => state.playing && playItem(state.playing));
    }
  }
}

function showOverlayActions(actions) {
  el.overlayActions.replaceChildren();
  el.overlayActions.hidden = !actions || !actions.length;
  for (const action of actions || []) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ghost';
    button.textContent = action.label;
    button.addEventListener('click', action.onClick);
    el.overlayActions.appendChild(button);
  }
}

async function playItem(item, { startAt, allowSilent } = {}) {
  const live = item.k === 0;
  const url = streamUrl(state.config, item, 'ts');
  if (!url) { toast(t('player.nourl')); return; }
  const key = `${item.k}:${item.id}`;
  const saved = state.resume.get(key);
  const spec = {
    url,
    hlsUrl: live && !item.direct ? streamUrl(state.config, item, 'm3u8') : null,
    live,
    ext: item.ext,
    mode: el.mode.value,
    allowSilent: Boolean(allowSilent),
    subtitleLang: state.settings.subtitleLang,
    startAt: startAt ?? (state.settings.resumeEnabled && !live && saved ? saved.position : 0),
  };

  state.playing = item;
  state.playingSpec = spec;
  state.catchup = null;
  // Edellisen tiedoston raidat pois: uudet tulevat vasta kun otsikko on luettu.
  renderSubtitles([], null);
  el.nowTitle.textContent = item.n;
  renderNowSub();
  renderFavButton();
  document.title = t('player.title', { name: item.n });
  if (guideOpen) grid.setPlaying(live ? item.id : null);

  playback.play(spec);
  vlist.refresh();

  if (live && state.epg) state.epg.want(item, { priority: true });
  renderInfoStrip();
  if (!live) loadVodDetails(item);
  state.recents = await store.pushRecent(stripItem(item));
  if (state.tab === 'recent') { renderSidebar(); refreshRows({ keepScroll: true }); }
}

function renderNowSub(engine) {
  const item = state.playing;
  if (!item) { el.nowSub.textContent = t('player.idle'); return; }
  const bits = [];
  const type = tabType();
  if (state.catchup) bits.push(t('player.catchup', { time: clock(state.catchup.start) }));
  if (item.cats && item.cats.length && state.lib && type) bits.push(state.lib.categoryName(type, item.cats[0]));
  if (item.k === 3) bits.push(`S${item.season} E${item.episode}`);
  if (engine || playback.engineName) bits.push(engine || playback.engineName);
  el.nowSub.textContent = bits.filter(Boolean).join(' · ') || '—';
}

/* --------------------------------------------------------- tekstitykset */

/**
 * Tekstitysvalitsin. Lista tulee purkajalta heti kun tiedoston otsikko on
 * luettu, ja sama kutsu palaa myös kun raita vaihtuu — myös silloin kun
 * vaihto tehtiin selaimen omasta tekstitysvalikosta.
 *
 * @param {object[]} tracks raidat, tyhjä jos tiedostossa ei ole tekstityksiä
 * @param {number|null} active näkyvissä olevan raidan numero
 */
function renderSubtitles(tracks, active) {
  const list = tracks || [];
  const select = el.subs;
  // Sama lista tulee uudelleen pelkän valinnan muuttuessa: valikkoa ei
  // rakenneta turhaan uudelleen katsojan nenän edessä.
  if (list !== state.subtitles) {
    state.subtitles = list;
    select.hidden = !list.length;
    // Koko on tarpeeton valinta silloin kun näytettävää ei ole.
    el.subsize.hidden = !list.length;
    const options = [];
    if (list.length) {
      const off = document.createElement('option');
      off.value = 'off';
      off.textContent = t('player.subs.off');
      options.push(off);
    }
    for (const track of list) {
      const option = document.createElement('option');
      option.value = String(track.number);
      option.textContent = track.label;
      option.title = `${track.language} · ${track.format}`;
      options.push(option);
    }
    select.replaceChildren(...options);
  }
  select.value = active == null ? 'off' : String(active);
}

/** Katsojan valinta valitsimesta: raita näkyviin ja kieli talteen. */
function chooseSubtitle() {
  const value = el.subs.value;
  const number = value === 'off' ? null : Number(value);
  playback.selectSubtitle(number);
  rememberSubtitleLanguage(number);
}

/** Tekstityksen koko: CSS lukee sen bodyn attribuutista, ks. player.css. */
function applySubtitleSize(size) {
  document.body.dataset.subsize = size || 'small';
  el.subsize.value = document.body.dataset.subsize;
}

async function chooseSubtitleSize() {
  applySubtitleSize(el.subsize.value);
  state.settings = await store.saveSettings({ subtitleSize: el.subsize.value });
}

/**
 * Kieli talteen seuraavia jaksoja varten — ei raidan numeroa, koska numerot
 * vaihtelevat tiedostosta toiseen.
 */
async function rememberSubtitleLanguage(number) {
  const track = state.subtitles.find((t) => t.number === number);
  const language = track ? shortLanguage(track.language) : 'off';
  if (state.settings.subtitleLang === language) return;
  state.settings = await store.saveSettings({ subtitleLang: language });
}

function renderFavButton() {
  const button = $('btn-fav');
  const item = state.playing;
  const on = item && state.favorites.has(`${item.k}:${item.id}`);
  button.textContent = on ? '★' : '☆';
  button.classList.toggle('on', !!on);
  button.disabled = !item;
}

/* ------------------------------------------------------- tietopaneeli */

function renderInfoStrip() {
  const item = state.playing;
  if (!item) { el.infostrip.hidden = true; return; }

  if (item.k === 0) {
    const entry = state.epg ? state.epg.nowNext(item.id) : null;
    if (!entry || (!entry.now && !entry.next)) { el.infostrip.hidden = true; return; }
    el.infostrip.hidden = false;
    const frag = document.createDocumentFragment();
    if (entry.now) {
      const head = document.createElement('div');
      head.className = 'epgnow';
      const time = document.createElement('span');
      time.className = 'epgnow-time';
      time.textContent = `${clock(entry.now.start)}–${clock(entry.now.stop)}`;
      const title = document.createElement('span');
      title.className = 'epgnow-title';
      title.textContent = entry.now.title;
      head.append(time, title);
      frag.appendChild(head);

      const share = progressOf(entry.now);
      if (share != null) {
        const bar = document.createElement('div');
        bar.className = 'epgbar';
        const fill = document.createElement('i');
        fill.style.width = `${Math.round(share * 100)}%`;
        bar.appendChild(fill);
        frag.appendChild(bar);
      }
      if (entry.now.description) {
        const desc = document.createElement('div');
        desc.className = 'epgdesc';
        desc.textContent = entry.now.description;
        frag.appendChild(desc);
      }
    }
    if (entry.next) {
      const next = document.createElement('div');
      next.className = 'epgnext';
      next.textContent = t('info.next', { time: clock(entry.next.start), title: entry.next.title });
      frag.appendChild(next);
    }
    el.infostrip.replaceChildren(frag);
    return;
  }

  const info = item.details;
  el.infostrip.hidden = false;
  const box = document.createElement('div');
  box.className = 'vodinfo';
  if (info && info.cover) box.appendChild(coverImage('', info.cover));
  const body = document.createElement('div');
  const meta = document.createElement('div');
  meta.className = 'meta';
  const bits = [];
  if (info) {
    if (info.releaseDate) bits.push(String(info.releaseDate).slice(0, 10));
    if (info.genre) bits.push(info.genre);
    if (info.rating) bits.push(`★ ${info.rating}`);
    if (info.durationSec) bits.push(duration(info.durationSec));
    if (info.video) bits.push(`${info.video.codec}${info.video.height ? ' ' + info.video.height + 'p' : ''}`);
  }
  if (item.ext) bits.push(item.ext.toUpperCase());
  // Luettu otsikko on tarkempi kuin API:n tiedot: se tuntee ääniraidan ja
  // tekstitykset, joista kumpaakaan rajapinta ei kerro.
  const probed = probeFor(item);
  if (probed && !probed.error) {
    if (probed.video) bits.push(`${probed.video.codec.toUpperCase()}${probed.video.height ? ' ' + probed.video.height + 'p' : ''}`);
    const track = probed.audio && probed.audio[0];
    if (track) bits.push(`${track.codec.toUpperCase()}${track.channels ? ' ' + track.channels + 'ch' : ''}${track.supported ? '' : t('info.unsupported')}`);
    const subs = subtitleSummary(probed);
    if (subs) {
      bits.push(subs.languages.length
        ? t('info.subs', { count: subs.total, n: subs.total, languages: subs.languages.slice(0, 5).join(', ') })
        : t('info.subs.count', { count: subs.total, n: subs.total }));
    }
  }
  for (const bit of bits) { const s = document.createElement('span'); s.textContent = bit; meta.appendChild(s); }
  body.appendChild(meta);
  if (info && info.plot) {
    const plot = document.createElement('div');
    plot.className = 'plot';
    plot.textContent = info.plot;
    body.appendChild(plot);
  }
  box.appendChild(body);
  el.infostrip.replaceChildren(box);
}

async function loadVodDetails(item) {
  if (item.k !== 1 || item.details) return;
  try {
    const info = await state.lib.movieDetails(item.id);
    item.details = info;
    if (state.playing === item) renderInfoStrip();
  } catch { /* lisätiedot ovat vapaaehtoisia */ }
}

/* --------------------------------------------------------- ohjelmaopas */

const grid = new EpgGrid({
  scroll: $('epg-scroll'), canvas: $('epg-canvas'),
  timesInner: $('epg-times-inner'), chansInner: $('epg-chans-inner'),
  corner: $('epg-corner'), days: $('epg-days'), clock: $('epg-clock'),
}, {
  label: (channel) => (state.cleanName ? state.cleanName(channel.n) : channel.n),
  onSelect: renderGuidePreview,
  onActivate: activateProgramme,
  onChannel: (channel) => channel && playItem(channel),
  onWindow: (items, from, to) => state.epg && state.epg.setVisibleWindow(items, from, to),
});

let guideOpen = false;

async function toggleGuide() {
  if (guideOpen) closeGuide(); else await openGuide();
}

async function openGuide() {
  if (guideOpen) return;
  if (!state.lib || !state.epg) { toast(t('guide.needserver')); return; }
  if (!state.epg.enabled) { toast(t('guide.epgoff')); return; }
  // Opas näyttää kanavarivit, joten se tarvitsee kanavavälilehden sisällön.
  if (state.tab !== 'live' || state.detail) await activateTab('live', { restore: true });

  const channels = state.rows.filter((it) => it.k === 0);
  if (!channels.length) { toast(t('guide.needgroup')); return; }

  guideOpen = true;
  el.main.classList.add('guide');
  el.epg.hidden = false;
  el.epgPreview.hidden = false;
  $('btn-guide').classList.add('on');

  renderGuideGroups();
  grid.epg = state.epg;
  grid.setPlaying(state.playing && state.playing.k === 0 ? state.playing.id : null);
  grid.setChannels(channels);
  grid.show();
  if (state.playing && state.playing.k === 0) grid.focusChannel(state.playing.id);
}

function closeGuide() {
  if (!guideOpen) return;
  guideOpen = false;
  grid.hide();
  el.main.classList.remove('guide');
  el.epg.hidden = true;
  el.epgPreview.hidden = true;
  $('btn-guide').classList.remove('on');
  vlist.refresh();
  renderInfoStrip();
}

/** Ryhmävalitsin oppaaseen: sivupalkki on piilossa opastilassa. */
function renderGuideGroups() {
  const select = $('epg-group');
  const frag = document.createDocumentFragment();
  const all = document.createElement('option');
  all.value = '';
  all.textContent = t('guide.allchannels');
  frag.appendChild(all);
  for (const group of state.lib.groups.live) {
    const option = document.createElement('option');
    option.value = group.name;
    option.textContent = group.name;
    frag.appendChild(option);
  }
  select.replaceChildren(frag);
  select.value = state.group ?? '';
}

function renderGuidePreview(channel, programme) {
  if (!channel) return;
  const logo = $('epgv-logo');
  logo.classList.toggle('blank', !channel.logo);
  if (channel.logo) logo.src = channel.logo; else logo.removeAttribute('src');

  $('epgv-name').textContent = channel.num
    ? `${String(channel.num).padStart(4, '0')} · ${channel.n}`
    : channel.n;

  const now = Date.now();
  const meta = [];
  if (channel.archive > 0) meta.push(t('guide.catchup', { days: channel.archive }));
  if (state.lib && channel.cats && channel.cats.length) meta.push(state.lib.categoryName('live', channel.cats[0]));
  if (programme) {
    const minutes = Math.round((programme.stop - programme.start) / 60000);
    if (minutes > 0) meta.push(duration(minutes * 60));
    if (programme.stop <= now) meta.push(t('guide.ended'));
    else if (programme.start > now) meta.push(t('guide.startsin', { when: relativeSoon(programme.start, now) }));
  }
  $('epgv-meta').textContent = meta.join(' · ');

  const slot = $('epgv-slot');
  slot.replaceChildren();
  if (programme) {
    slot.appendChild(document.createTextNode(`${clock(programme.start)}–${clock(programme.stop)}`));
    const title = document.createElement('b');
    title.textContent = programme.title;
    slot.appendChild(title);
  }

  $('epgv-desc').textContent = programme
    ? (programme.description || '')
    : t('guide.noepg.channel');

  const actions = $('epgv-actions');
  const buttons = [{ label: t('guide.watch'), primary: true, onClick: () => playItem(channel) }];
  if (catchupAvailable(channel, programme, now)) {
    buttons.unshift({ label: t('guide.watch.recording'), primary: true, onClick: () => playCatchup(channel, programme) });
    buttons[1].primary = false;
  }
  actions.replaceChildren(...buttons.map(({ label, primary, onClick }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = primary ? 'primary' : 'ghost';
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  }));
}

/** Enter tai kaksoisklikkaus ruudukossa. */
function activateProgramme(channel, programme) {
  if (!channel) return;
  const now = Date.now();
  if (programme && programme.stop <= now) {
    if (catchupAvailable(channel, programme, now)) playCatchup(channel, programme);
    else toast(t('guide.norecording'));
    return;
  }
  if (programme && programme.start > now) {
    toast(t('guide.starts', { title: programme.title, time: clock(programme.start) }));
    return;
  }
  playItem(channel);
}

/** Näppäimistöohjaus kuuluu ruudukolle, ei viimeksi painetulle napille. */
function focusGrid() {
  $('epg-scroll').focus({ preventScroll: true });
}

function relativeSoon(start, now) {
  const minutes = Math.round((start - now) / 60000);
  if (minutes < 60) return t('guide.minutes', { minutes });
  return t('guide.at', { time: clock(start) });
}

function playCatchup(item, programme) {
  const minutes = Math.max(1, Math.round((programme.stop - programme.start) / 60000));
  const url = timeshiftUrl(state.config, item.id, programme.start, minutes, state.account.serverUtcOffsetMs || 0);
  state.playing = { ...item, n: `${item.n} — ${programme.title}` };
  state.playingSpec = { url, live: true, mode: 'ts' };
  state.catchup = programme;
  el.nowTitle.textContent = state.playing.n;
  renderNowSub();
  if (guideOpen) grid.setPlaying(item.id);
  playback.play(state.playingSpec);
}

/* ------------------------------------------------- katselukohta & stats */

let lastResumeSave = 0;
el.video.addEventListener('timeupdate', () => {
  const item = state.playing;
  if (!item || item.k === 0 || !state.settings.resumeEnabled) return;
  const now = Date.now();
  if (now - lastResumeSave < 5000) return;
  lastResumeSave = now;
  const { currentTime, duration: total } = el.video;
  if (!Number.isFinite(total) || total <= 0 || currentTime < 20) return;
  const key = `${item.k}:${item.id}`;
  if (currentTime > total * 0.96) state.resume.delete(key);
  else state.resume.set(key, { position: currentTime, duration: total, at: now });
  store.saveResume(state.resume);
});

setInterval(() => {
  const stats = playback.stats();
  if (!stats) { el.statbadge.hidden = true; return; }
  el.statbadge.hidden = false;
  el.statbadge.textContent = [
    `${stats.width}×${stats.height}`,
    stats.kbps ? `${nf.format(stats.kbps)} kbit/s` : null,
    stats.engine,
  ].filter(Boolean).join(' · ');
}, 2000);

// EPG-palkki elää ajassa, joten se piirretään uudelleen vaikkei dataa tulisi.
setInterval(() => {
  if (state.playing && state.playing.k === 0) renderInfoStrip();
  if (state.epg && state.rows.some((it) => it.k === 0)) vlist.refresh();
}, 30000);

/* ============================================================ latausdialogi */

/** Palkin täyttö 0…1. Skaalaus, ei leveys — ks. .bar-fill player.css:ssä. */
function fillBar(ratio) {
  const clamped = Math.min(1, Math.max(0, ratio || 0));
  el.pFill.style.transform = `scaleX(${clamped.toFixed(4)})`;
}

function showProgress(title, text) {
  el.pTitle.textContent = title;
  el.pText.textContent = text || '';
  fillBar(0);
  el.pFill.parentElement.classList.add('indeterminate');
  if (!el.progress.open) el.progress.showModal();
}

function updateProgress(received, total) {
  if (total > 0) {
    el.pFill.parentElement.classList.remove('indeterminate');
    fillBar(received / total);
    el.pText.textContent = t('progress.bytes', { received: megabytes(received), total: megabytes(total) });
  } else {
    el.pText.textContent = t('progress.received', { received: megabytes(received) });
  }
}

function hideProgress() {
  if (el.progress.open) el.progress.close();
}

/* ============================================================= asetukset */

const FIELDS = ['scheme', 'host', 'port', 'username', 'password'];

function openSetup() {
  for (const f of FIELDS) $(`f-${f}`).value = state.config[f] ?? '';
  $('f-paste').value = '';
  $('f-lang').value = state.settings.lang;
  $('f-epg').checked = state.settings.epgEnabled;
  $('f-resume').checked = state.settings.resumeEnabled;
  showSourceMode(state.config.sourceMode);
  renderAccountBox();
  if (!el.setup.open) el.setup.showModal();
}

/**
 * Yhteystapa vaihtaa vain sen kumpi lomake on näkyvissä. Osoitteesta puretut
 * tunnukset menevät samoihin kenttiin kuin käsin kirjoitetut, joten tilan
 * vaihtaminen ei hukkaa mitään eikä kumpikaan reitti ole toistaan virallisempi.
 */
function showSourceMode(mode) {
  const m3u = mode === 'm3u';
  for (const radio of document.querySelectorAll('input[name="source"]')) {
    radio.checked = radio.value === (m3u ? 'm3u' : 'xtream');
  }
  $('src-xtream').hidden = m3u;
  $('src-m3u').hidden = !m3u;
}

const sourceMode = () => (document.querySelector('input[name="source"]:checked') || {}).value || 'xtream';

async function renderAccountBox() {
  const box = $('account-box');
  const a = state.account;
  if (!a) { box.hidden = true; return; }
  box.hidden = false;
  const estimate = await storageEstimate();
  box.innerHTML = '';
  const head = document.createElement('div');
  const status = document.createElement('b');
  status.textContent = a.status + (a.trial ? t('account.trial') : '');
  head.append(`${t('account.title')} `, status);
  box.appendChild(head);
  const cols = document.createElement('div');
  cols.className = 'cols';
  const loaded = ['live', 'movie', 'series'].filter((type) => state.lib && state.lib.isFull(type));
  const rows = [
    [t('account.connections.label'), a.maxConnections ? `${a.activeConnections} / ${a.maxConnections}` : '–'],
    [t('account.valid.label'), a.expiresAt ? dateFmt.format(new Date(a.expiresAt)) : '–'],
    [t('account.formats'), a.outputFormats.join(', ') || '–'],
    [t('account.servertime'), a.serverTimezone || '–'],
    [t('account.cache'), estimate ? megabytes(estimate.usage || 0) : '–'],
    [t('account.lists'), loaded.map((type) => kindLabel(TYPE_KIND[type])).join(', ') || t('account.none')],
  ];
  for (const [label, value] of rows) {
    const cell = document.createElement('div');
    cell.append(label, document.createElement('br'));
    const strong = document.createElement('b');
    strong.textContent = value;
    cell.appendChild(strong);
    cols.appendChild(cell);
  }
  box.appendChild(cols);
}

/**
 * Alkutila: tunnukset, asetukset, suosikit, historia, katselukohdat ja koko
 * välimuisti pois. Sivu ladataan lopuksi uudelleen, koska muistissa oleva
 * tila — ladatut listat, avoin toisto, valittu ryhmä — ei tyhjennyksen
 * jälkeen vastaa mitään, ja uusi lataus alkaa tervetulonäkymästä.
 */
async function resetEverything() {
  playback.stop();
  await chrome.storage.local.clear();
  await wipeStorage();
  location.reload();
}

function readSetup() {
  const patch = {};
  for (const f of FIELDS) patch[f] = $(`f-${f}`).value.trim();
  return patch;
}

function wireSetup() {
  $('f-lang').replaceChildren(...Object.entries(LANGUAGES).map(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    return option;
  }));
  // Kieli vaihtuu heti eikä vasta tallennettaessa: valinnan pitää näkyä
  // samassa dialogissa jossa se tehtiin, muuten sen vaikutusta ei näe.
  $('f-lang').addEventListener('change', () => applyLanguage($('f-lang').value));

  for (const radio of document.querySelectorAll('input[name="source"]')) {
    radio.addEventListener('change', () => showSourceMode(radio.value));
  }

  $('f-paste').addEventListener('input', (e) => {
    const parsed = parsePlaylistUrl(e.target.value);
    if (!parsed) return;
    for (const f of FIELDS) if (parsed[f] != null) $(`f-${f}`).value = parsed[f];
  });
  $('f-cancel').addEventListener('click', () => el.setup.close());
  $('f-save').addEventListener('click', async () => {
    // M3U-tilassa kentät täytetään osoitteesta vasta tässä, jotta liimattu
    // mutta kesken jäänyt osoite ei ehdi ylikirjoittaa vanhoja tunnuksia.
    if (sourceMode() === 'm3u') {
      const parsed = parsePlaylistUrl($('f-paste').value);
      if (!parsed) { toast(t('setup.m3u.bad')); return; }
      for (const f of FIELDS) if (parsed[f] != null) $(`f-${f}`).value = parsed[f];
    }
    const patch = { ...readSetup(), sourceMode: sourceMode() };
    // Host-oikeus pyydetään ennen ensimmäistä awaitia: käyttäjän ele kuluu
    // siihen, ja ilman elettä Chrome hylkää pyynnön näyttämättä dialogia.
    // Jo myönnetylle originille tämä palaa heti ilman dialogia.
    const granted = patch.host ? await requestAccess(baseUrl(patch)) : true;
    state.settings = await store.saveSettings({
      lang: $('f-lang').value,
      epgEnabled: $('f-epg').checked,
      resumeEnabled: $('f-resume').checked,
    });
    state.config = await store.saveConfig(patch);
    el.setup.close();
    if (!granted) toast(t('setup.nogrant'));
    await connect();
  });
  $('f-clear').addEventListener('click', async () => {
    await cacheClear();
    if (state.lib) await state.lib.reset();
    toast(t('setup.cleared'));
    el.setup.close();
    await connect({ silent: true });
  });

  // Palautus on peruuttamaton, joten nappi kysyy varmistuksen itse:
  // asetusdialogin päälle avattu toinen dialog jäisi sen alle. Aseteltu
  // tila raukeaa itsestään, jottei nappi jää varmistustilaan odottamaan
  // seuraavaa ohimennen osunutta klikkausta.
  let armed = null;
  const disarm = (button) => {
    clearTimeout(armed);
    armed = null;
    button.textContent = t('setup.reset');
    button.classList.remove('armed');
  };
  $('f-reset').addEventListener('click', (e) => {
    const button = e.currentTarget;
    if (!armed) {
      button.textContent = t('setup.reset.confirm');
      button.classList.add('armed');
      armed = setTimeout(() => disarm(button), 5000);
      return;
    }
    disarm(button);
    button.disabled = true;
    resetEverything().catch((err) => {
      button.disabled = false;
      console.error('[iptv] palautus epäonnistui', err);
      toast(t('setup.reset.failed'));
    });
  });

}

/* ================================================================ pikkuja */

let toastTimer = null;
function toast(text) {
  el.toast.textContent = text;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, 2800);
}

async function copyUrl() {
  if (!state.playingSpec) return;
  await navigator.clipboard.writeText(state.playingSpec.url);
  toast(t('player.copied'));
}

/* ------------------------------------------------- ulkoinen soitin */

/** Malli koskee vain mukautettua valintaa; presetit tuovat omansa. */
/**
 * Luovuttaa nykyisen virran ulkoiselle soittimelle.
 *
 * Toisto pysäytetään ensin: testitilillä yhtäaikaisia yhteyksiä sallitaan
 * yksi, joten selaimen auki pitämä virta jättäisi ulkoisen soittimen mykäksi.
 * Kaikki tässä on tahallaan synkronista — vieraan skeeman käynnistys vaatii
 * käyttäjän eleen, joka kuluisi ensimmäiseen awaitiin.
 */
function playExternal() {
  if (!state.playingSpec) { toast(t('ext.nothing')); return; }

  const name = state.playing ? state.playing.n : 'Stream';
  const spec = state.playingSpec;
  // Katselukohta siitä mihin selain ehti, ei siitä mistä toisto alkoi.
  const startAt = spec.live ? 0 : Math.floor(el.video.currentTime || spec.startAt || 0);
  playback.stop();
  handOff({ ...spec, startAt }, name);

  el.overlay.hidden = false;
  el.overlay.classList.remove('loading');
  el.overlayTitle.textContent = t('ext.handed');
  el.overlayText.textContent = t('ext.handed.text');
  showOverlayActions([
    { label: t('ext.continue'), onClick: () => state.playing && playItem(state.playing, { startAt }) },
    { label: t('player.copyurl'), onClick: copyUrl },
  ]);
}

function moveCursor(delta) {
  if (state.rows.length === 0) return;
  state.cursor = Math.max(0, Math.min(state.rows.length - 1, state.cursor + delta));
  vlist.scrollToIndex(state.cursor);
  vlist.refresh();
}

function playRelative(delta) {
  if (!state.playing) return;
  const index = state.rowIndex.get(`${state.playing.k}:${state.playing.id}`);
  if (index == null) return;
  const next = index + delta;
  if (next < 0 || next >= state.rows.length) return;
  state.cursor = next;
  vlist.scrollToIndex(next);
  openItem(state.rows[next]);
}

function wireUi() {
  el.tabs.addEventListener('click', (e) => {
    const button = e.target.closest('button[data-tab]');
    if (!button) return;
    closeGuide();
    activateTab(button.dataset.tab, { restore: true });
  });

  let searchTimer = null;
  el.search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.query = el.search.value.trim();
      // Haku kohdistuu koko listaan: kategoria- ja tyyppirajaus poistetaan
      // näkyvästi, jottei osumien puuttuminen jää selittämättömäksi.
      if (state.query && state.group != null) {
        state.group = null;
        state.sub = null;
        state.lastGroup[state.tab] = null;
        renderSidebar();
      }
      if (state.query && state.kind != null) {
        state.kind = null;
        state.lastKind[state.tab] = null;
        renderSidebar();
      }
      refreshRows();
    }, 180);
  });

  let filterTimer = null;
  el.categoryFilter.addEventListener('input', () => {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => { state.categoryFilter = el.categoryFilter.value; renderCategories(); }, 120);
  });

  $('btn-refresh').addEventListener('click', async () => {
    if (!state.lib) return connect();
    showProgress(t('progress.refresh'));
    try {
      await state.lib.loadCategories({ force: true });
      for (const type of ['live', 'movie', 'series']) {
        if (state.lib.isFull(type)) await state.lib.ensureFull(type, { force: true, onProgress: updateProgress });
      }
      if (state.epg) state.epg.clear();
      renderSidebar();
      await refreshRows({ keepScroll: true });
      toast(t('toast.refreshed'));
    } catch (err) { showConnectionError(err); } finally { hideProgress(); }
  });

  $('btn-settings').addEventListener('click', openSetup);
  // Listan lataus ei ole keskeytettävissä, joten Esc ei saa sulkea dialogia
  // kesken työn: suljettu dialogi näyttäisi siltä että lataus loppui.
  el.progress.addEventListener('cancel', (e) => e.preventDefault());

  el.mode.addEventListener('change', () => {
    store.saveConfig({ streamMode: el.mode.value });
    if (state.playing) playItem(state.playing);
  });
  el.subs.addEventListener('change', chooseSubtitle);
  el.subsize.addEventListener('change', chooseSubtitleSize);
  $('btn-reload').addEventListener('click', () => state.playing && playItem(state.playing));
  $('btn-guide').addEventListener('click', toggleGuide);
  $('epg-close').addEventListener('click', closeGuide);
  // Kuollut logo-osoite on kirjastossa tavallinen. Sama tapa kuin listarivillä
  // ja oppaan ruudukossa, mutta ilman once-lippua: elementti on pysyvä ja
  // vaihtaa lähdettä kanavan mukana.
  $('epgv-logo').addEventListener('error', (e) => e.target.classList.add('blank'));
  $('epg-now').addEventListener('click', () => { grid.goNow(); focusGrid(); });
  $('epg-prev').addEventListener('click', () => { grid.nudge(-30); focusGrid(); });
  $('epg-next').addEventListener('click', () => { grid.nudge(30); focusGrid(); });
  $('epg-in').addEventListener('click', () => { grid.zoomBy(1); focusGrid(); });
  $('epg-out').addEventListener('click', () => { grid.zoomBy(-1); focusGrid(); });
  $('epg-group').addEventListener('change', (e) => selectGroup(e.target.value || null));
  $('btn-fav').addEventListener('click', () => state.playing && toggleFavorite(state.playing));
  $('btn-copy').addEventListener('click', copyUrl);
  $('btn-ext').addEventListener('click', playExternal);
  $('btn-pip').addEventListener('click', async () => {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await el.video.requestPictureInPicture();
    } catch { toast(t('player.pip.unavailable')); }
  });

  document.addEventListener('keydown', (e) => {
    const tag = e.target.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON';
    if (e.key === '/' && !typing) { e.preventDefault(); el.search.focus(); el.search.select(); return; }
    if (e.target === el.search && e.key === 'Escape') {
      el.search.value = ''; state.query = ''; refreshRows(); el.search.blur(); return;
    }
    if (typing || e.target === el.video) return;
    if (el.setup.open || el.progress.open) return;
    if (guideOpen) {
      if (e.key === 'Escape') { closeGuide(); return; }
      if (grid.handleKey(e)) { e.preventDefault(); return; }
    }
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); moveCursor(1); break;
      case 'ArrowUp': e.preventDefault(); moveCursor(-1); break;
      case 'PageDown': e.preventDefault(); moveCursor(10); break;
      case 'PageUp': e.preventDefault(); moveCursor(-10); break;
      case 'Enter': if (state.cursor >= 0) openItem(state.rows[state.cursor]); break;
      case 'Backspace': if (state.detail) closeDetail(); break;
      case ' ': e.preventDefault(); el.video.paused ? el.video.play().catch(() => {}) : el.video.pause(); break;
      case 'f': document.fullscreenElement ? document.exitFullscreen() : el.video.requestFullscreen().catch(() => {}); break;
      case 'm': el.video.muted = !el.video.muted; break;
      case 'n': playRelative(1); break;
      case 'p': playRelative(-1); break;
      case 'g': toggleGuide(); break;
      case 'x': playExternal(); break;
      default: break;
    }
  });
}

/* ================================================================== kieli */

/**
 * Kieli vaihtuu kesken istunnon ilman sivun latausta.
 *
 * Kolme kerrosta on päivitettävä: merkkaukseen kirjoitetut tekstit, Intlin
 * muotoilijat ja tilasta piirretyt näkymät. Kolmas hoituu samoilla kutsuilla
 * joilla näkymät muutenkin syntyvät, joten kieli ei tarvitse omaa
 * piirtoreittiään — vain kutsun.
 */
async function applyLanguage(lang) {
  state.settings = await store.saveSettings({ lang: setLanguage(lang) });
  setLocale(localeTag());
  applyStatic();
  renderAccount();
  renderSidebar();
  renderNowSub();
  renderFavButton();
  renderInfoStrip();
  // Valitsin rakennetaan uudelleen vain jos lista on eri: nollataan se, jotta
  // "Ei tekstitystä" kääntyy vaikka raidat pysyvät samoina.
  const tracks = state.subtitles;
  const active = el.subs.value === 'off' || !el.subs.value ? null : Number(el.subs.value);
  state.subtitles = null;
  renderSubtitles(tracks, active);
  if (el.setup.open) renderAccountBox();
  if (guideOpen) { renderGuideGroups(); grid.invalidate(); }
  // Ennen yhteyttä ei ole listaa jota piirtää uudelleen, ja refreshRows
  // lähtisi hakemaan sitä palvelimelta jota ei vielä ole.
  if (state.lib) await refreshRows({ keepScroll: true });
  // Tyhjä soitin näyttää tervetulotekstiä, joka ei tule mistään piirrosta.
  if (!state.playing && !el.overlay.hidden && !el.overlay.classList.contains('loading')) renderIdleOverlay();
}

/** Soittimen lepotila: joko tervetulo tai kehotus valita kanava. */
function renderIdleOverlay() {
  const welcome = !state.config.host;
  el.overlayTitle.textContent = welcome ? t('setup.welcome') : t('player.idle');
  el.overlayText.textContent = welcome ? t('setup.welcome.text') : t('player.idle.text');
}

/* ================================================================== start */

async function init() {
  state.config = await store.loadConfig();
  state.settings = await store.loadSettings();
  setLanguage(state.settings.lang);
  setLocale(localeTag());
  applyStatic();

  wireSetup();
  wireUi();
  state.favorites = await store.loadFavorites();
  state.recents = await store.loadRecents();
  state.resume = await store.loadResume();
  el.mode.value = state.config.streamMode || 'auto';
  applySubtitleSize(state.settings.subtitleSize);
  renderFavButton();

  const ui = await store.loadUiState();
  if (ui.tab) state.tab = ui.tab;
  for (const button of el.tabs.children) button.classList.toggle('active', button.dataset.tab === state.tab);

  if (!state.config.host) {
    renderIdleOverlay();
    openSetup();
    return;
  }
  await connect();
}

init();
