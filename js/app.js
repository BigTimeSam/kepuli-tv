import './testclock.js';
import { XtreamApi, ApiError } from './api.js';
import { M3uSource } from './m3usource.js';
import { StalkerSource, clearPortalRules } from './stalker.js';
import { installFetchTap } from './streamhub.js';

import { Library, sortItems, cacheTtl as libraryCacheTtl } from './library.js';
import { Epg } from './epg.js';

import { VirtualList, watchLength } from './vlist.js';
import { ListNavigation } from './listnavigation.js';
import { CatalogueSearch } from './cataloguesearch.js';
import { PlayerLayout } from './playerlayout.js';
import { categoryRow, emptyState, KIND_ICONS } from './rows.js';
import { searchNameCleaner, searchKey, searchTerms, matchesTerms, labelCodes } from './name.js';
import { poster } from './poster.js';
import { wireModal } from './modal.js';
import { MediaFilters } from './mediafilters.js';

import { sameChannels } from './epggrid.js';
import { CountryPicker, HiddenList } from './channelchoices.js';
import { openRowMenu } from './rowmenu.js';
import { channelPreferences, visibilityFilter, sortChannels } from './channelprefs.js';

import { cachePurge } from './db.js';
import { baseUrl } from './xtream.js';
import { formatRoute, parseRoute } from './route.js';

import { requestAccess, hasAccess, hasAccessEverywhere, requestAccessEverywhere, redirects } from './permissions.js';

import { Cast, supported as castSupported } from './cast.js';
import { warmCache, probeCacheTtl } from './probe.js';

import { SubtitleDisplay } from './subdisplay.js';
import { pickEncoder } from './transcode.js';
import * as store from './config.js';
import { applyTheme, earlyTheme, onSystemTheme } from './theme.js';
import { wirePickers } from './picker.js';
import { nf } from './format.js';
import { t, applyStatic, setLanguage, loadLanguage } from './i18n.js';
import { askRecordingConsent, closeRecordingConsent, loadRecordingList, openRecordings, retryPlayback, toggleRecordNow } from './recordingsui.js';
import { renderAccountList, renderAccountSwitcher } from './accountsui.js';
import { loadReminders, reminders, showReminders } from './remindersui.js';
import { renderInfoStrip } from './infostrip.js';
import { applyListLayout, gridColumns, nameCleanerFor, onEpgUpdated, renderRow, restoreListView, shownName, toggleFavorite, usesGrid, watchGridWidth } from './coversui.js';
import { closeDetail, crumbLabel, episodesOfSeason, openItem, openSeries, renderDetail } from './seriesui.js';
import { closeGuide, favoritesChanged, focusGrid, grid, guideFavorites, guideOpen, programmeSearch, renderGuideGroups, renderTheme, restoreGuideFavorites, setGuideFavorites, toggleGuide } from './guideui.js';

import { ensureFull, renderEmptyState, renderListInfo, wireSubcatsResize } from './topicbar.js';
import { askExternal, playExternal } from './externalui.js';
import { $, el } from './dom.js';
import { categoryCountsFor, collectionItems, favCategoryEntry, isFavorite, isUnfinished, kindIndex, loadGroupItems, openFavCategory, refreshCatalogue, refreshWhenStale, removeFromHistory, renderSubcats, sectionsFor, toggleFavCategory } from './collections.js';
import { clickPicture, enterFullscreen, moreItems, renderSeriesFavorite, toggleFullscreen, toggleMoreMenu, togglePause, wireMediaSession } from './playercontrols.js';
import { cancelProgress, hideProgress, progressCtrl, progressSignal, showProgress, updateProgress } from './progressdialog.js';
import { openHelp } from './help.js';
import { copyUrl, toast } from './toast.js';
import { applyLocale, renderIdleOverlay } from './languageui.js';
import { fitIdleHome, watchInterest } from './idlehome.js';
import { accountProblem, addOverlayAction, playItem, playback, renderNowSub, showOverlayActions, tabs } from './playing.js';
import { applySubtitleLook, chooseAudio, chooseSubtitle, cycleAudio, goHome, leavePlayback, stepSubtitleSize, toggleSubtitleLook } from './tracksui.js';
import { nextEpisode, playEpisode } from './nextepisode.js';
import { adoptSyncedAccount, configured, offerUpdate, openSetup, renderSyncBox, setupDirty, showStoredSettings, sync, wireSetup } from './setupui.js';

// Live channels are read through js/streamhub.js, so that a recording of
// the channel on screen shares the player's connection.
installFetchTap();

const TYPE_OF_TAB = { live: 'live', movie: 'movie', series: 'series' };
export const TYPE_KIND = { live: 0, movie: 1, series: 2 };

/** "3 channels" — the type picks the key, the number picks the plural. */
export const unit = (type, count) => t(`unit.${type || 'generic'}`, { count, n: nf.format(count) });

// Favourites and history are not the server's lists but the user's own
// collections: they are always in memory, mix all four types, and are
// organised in the sidebar by type rather than by country.
const COLLECTIONS = new Set(['fav', 'recent']);
// 'c' = a favourite category: not a playable item but a door into a list,
// see favCategoryEntry. In a collection it is a type of its own and comes
// first, because one category row covers dozens of channels.
export const kindLabel = (kind) => t(`kind.${kind}`);
export const KIND_ORDER = ['c', 0, 1, 2];
export const KIND_INDEX = new Map(KIND_ORDER.map((kind, i) => [kind, i]));
// In a collection an episode is only part of a series, so it is counted and
// labelled as a series — otherwise history would show a type that does not
// exist among the tabs.
export const kindGroup = (k) => (k === 3 ? 2 : k);
// The row heights are --row-h and --sep-h in player.css, written in rem so
// that they grow with the reader's own font setting. What they come to in
// pixels is therefore the browser's answer rather than a number written here,
// and it is asked again when the setting changes under a running page.
export let ROW_H = 50;
let SEP_H = 32;

export const listNavigation = new ListNavigation(el.list);

export const state = {
  config: null, settings: null, account: null,
  source: null, lib: null, epg: null,
  tab: 'live',
  group: null,            // the chosen country/subject, null = all
  sub: null,              // a topic within the group (category_id)
  groupItems: [],         // every item of the chosen group, in memory
  categoryFilter: '', query: '',
  cleanName: null,        // the row-name tidier, null = the name as it is
  listLoading: false,
  listError: null,
  listRequest: 0,
  kind: null,             // a collection's type filter, null = all
  rows: [], rowIndex: new Map(), sections: new Map(),
  get cursor() { return listNavigation.index; },
  set cursor(index) { listNavigation.select(index); },
  groupCursor: null,      // where the arrows stand in the sidebar, null = on whatever is chosen
  // A drill-down into the list. A series and a favourite category share the
  // same place and the same back button, so they are one state with two
  // shapes:
  //   { view: 'series',   item, info, season, back }
  //   { view: 'category', entry, items, back }
  // back carries the previous drill-down: a series opened from a favourite
  // category returns to the category, not to the collection's root.
  detail: null,
  catCounts: null,        // the sizes of favourite categories, when known
  playing: null, playingSpec: null, catchup: null,
  subtitles: [],          // the subtitle tracks of the file being played
  audioTracks: [],        // the audio tracks of the file being played, see js/audio.js
  activeAudio: null,      // the track confirmed by the playback engine
  playbackInfoLoading: false,
  subtitleInfo: null,     // what the file being played holds, once the player has looked: { tracks, bitmap }
  favorites: new Map(), recents: [], resume: new Map(),
  accounts: [],           // every account added, see loadAccounts() in js/config.js
  interests: {},          // the programmes watched, by title, for the picks (js/picks.js)
  channelPrefs: channelPreferences(),
  lastGroup: {}, lastKind: {},
  subcatsHeight: null,    // the topic bar's height when dragged, null = automatic
};

export const isCollection = () => COLLECTIONS.has(state.tab);
export const catalogueSearch = new CatalogueSearch(el.search, $('search-clear'), {
  state, refresh: () => refreshRows(), renderSidebar, isCollection,
  onSearch: () => { if (!guideOpen) playerLayout.showBrowse(); },
});
export const playerLayout = new PlayerLayout(el.main, {
  browse: $('compact-browse'), watch: $('compact-player'), list: el.list, video: el.video, closeGuide,
});
export function updatePlayerLayout() {
  playerLayout.update({ connected: Boolean(state.lib), playing: Boolean(state.playing) });
}

// The topic the last session ended on, waiting for the library. It belongs
// to the restore that follows the load, not to every tab switch after it,
// so it is taken once and gone.
let storedSub = null;
const takeStoredSub = () => { const id = storedSub; storedSub = null; return id; };

/* ============================================================ connection */

// Every connect() takes a number, and only the latest may write: Save in
// Settings, Clear cache and Retry can each start one while another is still
// waiting on the server, and the older one, finishing last, used to put its
// account, its library — or its failure — over the newer one's.
let connectRun = 0;
export let connecting = false;

export async function connect({ silent = false } = {}) {
  const run = ++connectRun;
  const stale = () => run !== connectRun;
  programmeSearch.clear();
  if (guideOpen) closeGuide();
  // The strip of a connection being replaced: its requests are let go,
  // and the new one gets a strip of its own to cancel.
  if (connecting && progressCtrl) { progressCtrl.abort(); hideProgress(); }
  const config = state.config;
  try {
    if (!store.isConfigured(config)) { connecting = false; openSetup(); return false; }
    connecting = true;
    const playlist = config.type === 'm3u';
    // A playlist is the whole catalogue in one file, read once and kept
    // (js/m3usource.js); an Xtream server is asked one list at a time, and
    // a Stalker portal the same, as a MAG box (js/stalker.js).
    const source = sourceFor(config);
    if (config.type !== 'stalker') clearPortalRules().catch(() => {});
    state.source = source;
    dropConnectedView();

    if (!silent) showProgress(t(playlist ? 'progress.playlist' : 'progress.connecting'), store.accountLabel(config));
    if (playlist && !silent) source.onProgress = (received, total) => { if (!stale()) updateProgress(received, total); };
    const account = await source.account({ signal: progressSignal() });
    if (stale()) return false;
    state.account = account;
    const lib = new Library(source, store.accountKey(config));
    state.lib = lib;
    // Which audio encoder the browser has is asked now, so that the answer
    // is in by the time the first list paints: a row whose AC-3 track the
    // player can decode is marked playable only where the decoded audio
    // has somewhere to go (probe.js). A browser without an encoder is no
    // reason to stop connecting.
    pickEncoder().catch(() => {});
    // File headers read earlier into memory, so that list rows can show the
    // result without a network request while painting.
    await warmCache();
    if (stale()) return false;
    const epg = new Epg(source, onEpgUpdated);
    state.epg = epg;
    epg.enabled = state.settings.epgEnabled;
    await lib.loadCategories({ signal: progressSignal() });
    if (stale()) return false;
    connecting = false;
    hideProgress();

    renderNowSub();
    renderSidebar();
    const arrival = landing(state.tab);
    await activateTab(state.tab, { restore: true });
    if (stale()) return false;
    await restoreDetail(arrival);
    if (stale()) return false;
    // A subscription that has already run out is worth saying now, rather
    // than leaving the first stream to fail and explain it.
    const problem = accountProblem(state.account);
    if (problem) toast(problem, { long: true, kind: 'warn' });
    if (!state.playing && !el.overlay.hidden) renderIdleOverlay();
    askCountriesOnce();
    if (playlist) warmGuide(source);
    return true;
  } catch (err) {
    if (stale()) return false;
    connecting = false;
    hideProgress();
    // The list was emptied for a connection that never arrived: it must not
    // be left spinning for one.
    showRows([]);
    if (isAbort(err)) showCancelled(); else showConnectionError(err);
    return false;
  }
}

/** The catalogue of an account: its playlist, its Xtream server or its portal. */
function sourceFor(config) {
  if (config.type === 'm3u') return new M3uSource(config, `${store.accountKey(config)}|`);
  if (config.type === 'stalker') return new StalkerSource(config);
  return new XtreamApi(config);
}

/** Where an account's catalogue comes from, for asking access to it. */
export function accountAddress(config) {
  if (config.type === 'm3u' || config.type === 'stalker') return config.url || null;
  return config.host ? baseUrl(config) : null;
}

/**
 * A playlist's guide, read now rather than when the first row asks for it.
 * The guide a playlist names in its header was not known when access was
 * asked for at Save, and its host may be another one: a guide that cannot
 * be read for want of access offers the access, which is all it needs.
 */
async function warmGuide(source) {
  const guide = source.guide;
  if (!guide?.available || !state.settings.epgEnabled) return;
  if (await guide.ready().catch(() => false)) return;
  if (state.source !== source) return;
  const url = guide.urls.find(Boolean);
  if (!url || await hasAccess(url)) return;
  let host = url;
  try { host = new URL(url).host; } catch { /* the address as it is */ }
  toast(t('m3u.guide.access', { host }), {
    long: true,
    action: {
      label: t('error.grant', { origin: host }),
      onClick: async () => {
        if (!(await requestAccess(url))) { toast(t('error.grant.denied'), { kind: 'error' }); return; }
        if (state.source !== source || !(await guide.ready({ force: true }).catch(() => false))) return;
        state.epg?.clear();
        refreshRows({ keepScroll: true });
      },
    },
  });
}

/**
 * Everything on screen belongs to the account that is going away, so it goes
 * with it — the same reason the list is emptied with the tab, one level up.
 *
 * Left there, the sidebar of the previous connection stays clickable while
 * the new one is still fetching its categories, and a group chosen in that
 * moment loads against a library connect() is about to replace. The load is
 * then dropped as stale, selectGroup restores the view it came from, and the
 * choice is undone with nothing said. Measured against the mock server, a
 * group clicked during a reconnect sprang back four times in six.
 */
function dropConnectedView() {
  state.lib = null;
  $('channel-tools').hidden = true;
  state.epg = null;
  state.account = null;
  state.detail = null;
  state.group = null;
  state.sub = null;
  state.groupItems = [];
  state.cursor = -1;
  mediaFilters.apply([], null);
  renderDetail();
  renderSidebar();
  showRows([], { loading: true });
}

export const isAbort = (err) => Boolean(err && err.name === 'AbortError');

/**
 * A list that could not be fetched — a group, a series, the whole list —
 * is the list's business, not the player's: the overlay would cover a
 * picture that is playing perfectly well. Over rows a toast says what
 * happened; where there are no rows, the message takes their place with a
 * way to try again.
 */
export function showListError(err, retry) {
  finishListLoad();
  const message = err instanceof ApiError ? err.message : t('error.unexpected', { message: err.message });
  state.listError = message;
  console.error('[iptv] the list could not be loaded', err);
  if (state.rows.length) { toast(message, { long: true, kind: 'error' }); return; }
  const existing = el.list.querySelector('.empty');
  if (existing) existing.remove();
  el.list.appendChild(emptyState(t('error.list'), message, retry ? { label: t('player.retry'), onClick: retry } : null));
}

function finishListLoad() {
  state.listLoading = false;
  el.list.setAttribute('aria-busy', 'false');
  el.list.querySelector('.list-loading')?.remove();
  renderListInfo();
}

export function showListCancelled(retry) {
  finishListLoad();
  if (state.rows.length) { toast(t('progress.cancelled')); return; }
  el.list.querySelector('.empty')?.remove();
  el.list.appendChild(emptyState(t('progress.cancelled'), '', { label: t('player.retry'), onClick: retry }));
}

export function beginListLoad({ keepScroll = false } = {}) {
  const request = ++state.listRequest;
  state.listError = null;
  showRows(keepScroll ? state.rows : [], { keepScroll, loading: true });
  return request;
}

/** The viewer cancelled connecting: nothing is wrong, and the way on is the same. */
function showCancelled() {
  el.overlay.hidden = false;
  el.overlay.classList.remove('loading');
  el.overlayTitle.textContent = t('progress.cancelled');
  el.overlayText.textContent = t('error.connect.cancelled');
  showOverlayActions([
    { label: t('player.retry'), onClick: () => connect() },
    { label: t('btn.settings'), onClick: openSetup },
  ]);
}

function showConnectionError(err) {
  const apiError = err instanceof ApiError;
  el.overlay.hidden = false;
  el.overlay.classList.remove('loading');
  el.overlayTitle.textContent = t('error.connect.title');
  el.overlayText.textContent = apiError
    ? err.message
    : t('error.unexpected', { message: err.message });
  const actions = [
    { label: t('player.retry'), onClick: () => connect() },
    { label: t('btn.settings'), onClick: openSetup },
  ];
  showOverlayActions(actions);
  const address = accountAddress(state.config);
  if (address) offerAccess(address, actions, () => connect());
  console.error('[iptv] yhteysvirhe', err);
}

/**
 * A missing host permission looks like the same network error as a server
 * that is down, so the cause cannot be deduced — check the permission and
 * offer to grant it only when it really is missing.
 */
export async function offerAccess(url, actions, onGranted, { stream = false } = {}) {
  if (!url) return;
  if (!(await hasAccess(url))) {
    if (el.overlay.hidden) return;            // tilanne ehti vaihtua
    // "The server did not answer" over a button that asks for access would
    // leave the viewer to work out that the two belong together.
    const why = t('error.grant.why', { origin: hostOf(url) });
    if (!el.overlayText.textContent.endsWith(why)) el.overlayText.textContent = `${el.overlayText.textContent} ${why}`.trim();
    showOverlayActions([grantAction(url, onGranted), ...actions]);
    return;
  }
  // The stream's own host is granted, and the stream may still have come
  // from another one: see redirects() in js/permissions.js. Asked only
  // after a failure, and only while the overlay still shows it.
  if (!stream || await hasAccessEverywhere()) return;
  const spec = state.playingSpec;
  const message = el.overlayText.textContent;
  if (!(await redirects(url))) return;
  if (el.overlay.hidden || state.playingSpec !== spec || !el.overlayText.textContent.startsWith(message)) return;
  addOverlayAction({
    label: t('error.grant.all'),
    title: t('error.grant.all.why'),
    onClick: async () => {
      if (await requestAccessEverywhere()) await onGranted();
      else toast(t('error.grant.denied'), { kind: 'error' });
    },
  }, { first: true });
}

/** The host an address names, or the whole address when it is none. */
function hostOf(url) {
  try { return new URL(url).host; } catch { return url; }
}

/** A button that asks for the host permission and continues if granted. */
function grantAction(url, onGranted) {
  const origin = hostOf(url);
  return {
    label: t('error.grant', { origin }),
    // requestAccess is called before the first await, otherwise the user
    // gesture is spent and Chrome shows no permission dialog at all.
    onClick: async () => {
      if (await requestAccess(url)) await onGranted();
      else toast(t('error.grant.denied'), { kind: 'error' });
    },
  };
}

/* ============================================== the account in this tab */

// Each open tab of the player shows the account it connected with, and
// keeps showing it when another tab switches the stored one: favourites,
// history and resume points in memory, the stream playing and the
// addresses of everything in the list all belong to that account. The
// lists in storage are shared, though, and every change to them is one
// entry read, changed and written back (js/config.js); what another tab
// changes arrives here through storage.onChanged and is shown.

/** The lists of the account this tab shows, read from storage. */
async function loadLists() {
  state.favorites = await store.loadFavorites();
  state.recents = await store.loadRecents();
  state.resume = await store.loadResume();
  state.channelPrefs = await store.loadChannelPreferences();
  state.interests = await store.loadInterests();
  await loadReminders();
}

/**
 * The tab moves to another account. What is playing stops first: its
 * address, its Retry, its resume point and the history entry it makes all
 * belong to the account being left, and the resume point is saved there.
 */
export async function adoptAccount(config) {
  if (state.playing) leavePlayback();
  state.config = config;
  store.useAccount(config);
  lastChannel = previousChannel = null;
  await loadLists();
  renderAccountSwitcher();
}

export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * A list of this account's changed in storage — by another tab, or by this
 * one, whose own change is then already on screen and nothing is redrawn.
 * Applied rather than skipped either way: a change of this tab's own, read
 * and written under the lock, can carry another tab's that arrived here a
 * moment before it.
 */
function showStoredList(name, value) {
  if (resetting) return;
  const connected = Boolean(state.lib);
  if (name === 'favorites') {
    const list = value || [];
    if (same(list, [...state.favorites.values()])) return;
    state.favorites = new Map(list.map((item) => [store.itemKey(item), item]));
    if (connected) {
      if (state.tab === 'fav') { renderSidebar(); refreshRows({ keepScroll: true }); }
      else { vlist.refresh(); renderFavStrip(state.rows); renderCategories(); renderSubcats(); }
      renderSeriesFavorite();
      favoritesChanged();
    }
  } else if (name === 'recents') {
    const list = value || [];
    if (same(list, state.recents)) return;
    state.recents = list;
    if (connected && state.tab === 'recent') { renderSidebar(); refreshRows({ keepScroll: true }); }
  } else if (name === 'resume') {
    const points = value || {};
    if (same(points, store.resumeObject(Object.fromEntries(state.resume)))) return;
    state.resume = new Map(Object.entries(points));
    vlist.refresh();
  } else if (name === 'reminders') {
    if (same((value || []).filter((r) => r.stop > Date.now()), [...reminders.values()])) return;
    showReminders(value);
    if (guideOpen) grid.invalidate();
  } else if (name === 'interests') {
    state.interests = value || {};
  } else if (name === 'channels') {
    const prefs = channelPreferences(value);
    if (same(prefs, state.channelPrefs)) return;
    state.channelPrefs = prefs;
    if (connected) showChannelChoices();
  }
  if (!state.playing && !el.idleHome.hidden) renderIdleOverlay();
}

/**
 * Another tab saved another account. This one stays with its own — the
 * viewer may be watching something on it — and says so, with the way to
 * follow. A tab that has not connected to anything has nothing to keep.
 */
function accountChangedElsewhere(config) {
  if (resetting) return;
  if (!configured()) {
    if (el.setup.open && !setupDirty()) el.setup.close();
    followAccount();
    return;
  }
  toast(t('account.elsewhere', { host: store.accountLabel(config) }), {
    long: true, action: { label: t('account.elsewhere.follow'), onClick: followAccount },
  });
}

async function followAccount() {
  const config = await store.loadConfig();
  if (store.accountKey(config) === store.currentAccount()) return;
  await adoptAccount(config);
  el.mode.value = state.config.streamMode || 'auto';
  await connect();
}

// Set while this tab wipes everything, or reloads because another tab did.
export let resetting = false;
/** This tab is about to wipe everything: nothing it holds may be written back meanwhile. */
export function startReset() { resetting = true; }

/**
 * Reset everything in another tab: storage has been emptied under this one.
 * What it holds in memory would be written straight back — the next resume
 * point, a favourite — so it starts again as well, empty.
 */
function storageCleared() {
  if (resetting) return;
  resetting = true;
  playback.stop();
  location.reload();
}

/**
 * A provider that moves — another domain, port or scheme — is the same
 * account to the viewer, but its lists are kept by address. The same user
 * name at a new address that has nothing of its own is offered the old
 * address's lists; they are copied, and stay under the old address too.
 */
export async function offerLists(previous, config) {
  if (!previous.host || previous.username !== config.username) return;
  if (await store.accountHasLists(config) || !(await store.accountHasLists(previous))) return;
  toast(t('setup.lists.left', { host: previous.host }), {
    long: true,
    action: {
      label: t('setup.lists.bring'),
      onClick: async () => {
        if (store.accountKey(state.config) !== store.accountKey(config)) return;
        await store.copyAccountLists(previous, config);
        await loadLists();
        if (state.lib) { await showChannelChoices(); renderFavStrip(state.rows); }
        if (!state.playing && !el.idleHome.hidden) renderIdleOverlay();
        toast(t('setup.lists.brought'));
      },
    },
  });
}

/* ================================================================= views */

export function tabType() { return TYPE_OF_TAB[state.tab] || null; }

/**
 * The view worth coming back to: the tab, the group and topic within it,
 * and a collection's type filter. It is written once the list has settled,
 * so that a reload — or the toolbar icon after the tab was closed — opens
 * where the viewer left off rather than at the first group of the first tab.
 *
 * A search is a detour rather than a place. While one is running the stored
 * view stays the group the search took over from, which is where clearing
 * the search returns anyway.
 */
let remembered = '';
function rememberView() {
  if (state.query) return;
  const view = { tab: state.tab, group: state.group, sub: state.sub, kind: state.kind };
  const key = JSON.stringify(view);
  if (key === remembered) return;
  remembered = key;
  store.saveUiState(view);
}

/* ---------------------------------------------------------- the address */

/**
 * The place the address bar names: the tab, the group and the topic within
 * it, a collection's type filter, and whatever has been drilled into. It is
 * written beside the stored view, and the two answer different questions —
 * the address is what a reload of this tab comes back to, the stored view
 * what the toolbar icon opens once the tab itself is gone.
 *
 * A collection has no groups, so its address carries no group segment:
 * #/fav and #/fav/- are not the same place.
 */
function currentRoute() {
  const view = { tab: state.tab };
  // A search is a detour rather than a place. It empties the group while it
  // runs, so the address stays on the group it took over from — which is
  // where clearing the search returns, and where a reload should therefore
  // arrive rather than on the whole list the search was reading.
  let searchOrigin = catalogueSearch.returnView;
  // Drilling into a search result suspends the query, but its parent group
  // still belongs in the reloadable address.
  for (let detail = state.detail; detail; detail = detail.back) {
    if (detail.returnSearch?.returnView) searchOrigin = detail.returnSearch.returnView;
  }
  const searching = searchOrigin?.tab === state.tab ? searchOrigin : null;
  if (!isCollection()) {
    view.group = searching ? searching.group : state.group;
    const sub = searching ? searching.sub : state.sub;
    if (sub != null) view.sub = sub;
  }
  const kind = searching ? searching.kind : state.kind;
  if (kind != null) view.kind = kind;
  // A series opened from a favourite category is inside it, and both
  // belong to the address: the back button returns to the category.
  for (let detail = state.detail; detail; detail = detail.back) {
    if (detail.view === 'series') view.series = detail.item.id;
    else if (detail.view === 'category') view.cat = detail.entry.id;
  }
  return view;
}

/** A topic by the name on its chip: "Sport", or "General" for a group's own. */
function topicLabel(id) {
  const type = tabType();
  const group = type && state.group ? state.lib?.group(type, state.group) : null;
  const cat = group?.cats.find((c) => c.id === id);
  return cat ? cat.sub || t('subcats.general') : null;
}

/**
 * "Channels › Finland › Sport" — the path the sidebar was clicked down,
 * in the language of the interface. The search is in it although it is not
 * in the address: while one is running it is where we are, and the title
 * says so without the reload promising to bring it back.
 */
function pathLabels() {
  const labels = [t(`tab.${state.tab}`)];
  if (state.kind != null) labels.push(kindLabel(state.kind));
  if (state.group) labels.push(state.group);
  if (state.sub != null) labels.push(topicLabel(state.sub));
  const chain = [];
  for (let detail = state.detail; detail; detail = detail.back) chain.unshift(detail);
  for (const detail of chain) {
    labels.push(detail.view === 'category' ? crumbLabel(detail.entry)
      : detail.cleanName ? detail.cleanName(detail.item.n) : detail.item.displayName || detail.item.n);
  }
  if (state.query) labels.push(t('title.search', { query: state.query }));
  return labels.filter(Boolean);
}

/**
 * The address bar and the tab's title, from the one place. The title is the
 * readable half of the address: what is playing comes first, because a tab
 * shows only its first characters and a stream that is running is the
 * answer to "which tab is that", and the path follows it.
 *
 * replaceState rather than a new history entry: the player's own back is
 * the breadcrumb, and a browser history one item deep per topic chip would
 * make the browser's back button useless for leaving the player.
 */
let address = '';
export function updateAddress() {
  if (state.lib) {
    const hash = formatRoute(currentRoute());
    address = hash;
    if (hash !== location.hash) history.replaceState(null, '', hash);
  }
  const name = state.playing ? el.nowTitle.textContent : '';
  const path = pathLabels().join(' › ');
  const title = name ? t('title.playing', { name, path })
    : state.lib ? t('title.path', { path })
    : t('title.plain');
  if (document.title !== title) document.title = title;
}

/**
 * An address that arrived from outside — typed into the bar, opened from a
 * link, or reached with the back button after a reload. Our own writes go
 * through replaceState, which raises no event, so nothing here is an echo
 * of them.
 */
function onAddressChanged() {
  if (!state.lib || location.hash === address) return;
  const route = parseRoute(location.hash);
  // An address the player cannot read is not a place to go to; the view
  // stays where it is and writes its own address back over it.
  if (!route) { updateAddress(); return; }
  goToRoute(route);
}

export async function goToRoute(route) {
  if (guideOpen) closeGuide();
  catalogueSearch.reset({ restore: false });
  if (route.group === undefined) delete state.lastGroup[route.tab];
  else state.lastGroup[route.tab] = route.group;
  if (route.kind === undefined) delete state.lastKind[route.tab];
  else state.lastKind[route.tab] = route.kind;
  storedSub = route.sub ?? null;
  routeDetail = route.series || route.cat ? { series: route.series ?? null, cat: route.cat ?? null } : null;
  const arrival = landing(route.tab);
  await activateTab(route.tab, { restore: true });
  await restoreDetail(arrival);
}

// The drill-down an address carried, waiting for the list it belongs to.
// Like the topic above, it belongs to the one restore that follows the
// load rather than to every tab switch after it.
let routeDetail = null;
const takeRouteDetail = () => { const detail = routeDetail; routeDetail = null; return detail; };

/**
 * The drill-down, once the list underneath it is on screen: the favourite
 * category first, so that a series opened from one returns to the category
 * rather than to the collection's root. What is no longer there is dropped
 * the same way a missing group is — the list underneath it is a place of
 * its own, and the address is rewritten from where we actually arrive.
 */
async function restoreDetail(arrival) {
  const pending = takeRouteDetail();
  if (!pending) return;
  // The list underneath is the restore's own only if nothing else has been
  // asked for since: a reload is slow on a big account, and a viewer who
  // clicked another tab, group or series meanwhile is not taken back into
  // the series the address named.
  if (!untouched(arrival)) return;
  // What the series opens over: the list itself, or the favourite category.
  let base = null;
  // A favourite category is a row of the favourites, and nothing else.
  if (pending.cat && state.tab === 'fav') {
    const entry = state.favorites.get(`c:${pending.cat}`);
    if (entry) {
      await openFavCategory(entry);
      // Anything the viewer did while the category loaded took its place.
      if (state.detail?.view !== 'category' || state.detail.entry !== entry || state.query) return;
      base = state.detail;
    }
  }
  if (pending.series && state.detail === base) {
    const item = findLoaded(2, pending.series);
    if (item) await openSeries(item);
  }
  updateAddress();
}

/**
 * Where the list stands as a restore sets off: the tab it is going to, the
 * library, and the number of the last list load. activateTab() makes
 * exactly one load of its own (refreshRows); one more is someone else's —
 * a click on another tab, group or row while the list was on its way.
 */
const landing = (tab) => ({ tab, request: state.listRequest, lib: state.lib });
const untouched = (arrival) => state.lib === arrival.lib && state.tab === arrival.tab
  && state.listRequest === arrival.request + 1 && !state.detail && !state.query;

/**
 * An item of a type and id, from whatever the restore has in memory — of
 * the tab the address names. A series is found in the series lists, or in
 * the favourites or the history when that is the tab; one of them standing
 * in another tab's address is not opened over that tab's list.
 */
function findLoaded(kind, id) {
  const same = (it) => it.k === kind && String(it.id) === String(id);
  if (state.tab === 'fav') return state.rows.find(same) || [...state.favorites.values()].find(same) || null;
  if (state.tab === 'recent') return state.rows.find(same) || state.recents.find(same) || null;
  const type = tabType();
  const full = (type && state.lib.full[type]) || [];
  return state.rows.find(same) || state.groupItems.find(same) || full.find(same) || null;
}

/**
 * Whether a group still offers a topic. A stored one may be gone: the
 * provider's categories change, the channel editor hides them, and the
 * stored view is not tied to an account.
 */
function groupHasTopic(type, groupName, id) {
  if (!type || !groupName) return false;
  if (type === 'live' && state.channelPrefs.hiddenCategories.includes(id)) return false;
  return Boolean(state.lib?.group(type, groupName)?.cats.some((cat) => cat.id === id));
}

/**
 * Which tab is on: the class that colours it, the state a screen reader
 * reads, the one stop the tab order gets, and the name the panel below
 * takes from it. Four things that must never disagree, so they are written
 * in one place.
 */
function markTabs(tab) {
  for (const button of el.tabs.children) {
    const on = button.dataset.tab === tab;
    button.classList.toggle('active', on);
    button.setAttribute('aria-selected', String(on));
    // A tab strip is one stop in the tab order and the arrows move inside
    // it; five stops would put four of them between the strip and the list.
    button.tabIndex = on ? 0 : -1;
    if (on) $('listcol').setAttribute('aria-labelledby', button.id);
  }
}

export async function activateTab(tab, { restore = false } = {}) {
  catalogueSearch.reset();
  playerLayout.showBrowse();
  state.tab = tab;
  // The guide needs a connection: before one, its button would only say so.
  $('channel-tools').hidden = tab !== 'live' || !state.lib;
  markTabs(tab);
  state.detail = null;
  state.cursor = -1;
  state.groupCursor = null;
  state.sub = restore ? takeStoredSub() : null;
  // No group is two different answers: "All", which the viewer chose and
  // which costs the whole list, and "none yet", which is where a first
  // open stands. The map tells them apart — a tab it has never heard of
  // has never been chosen for.
  let chosen = restore && Object.hasOwn(state.lastGroup, tab);
  state.group = chosen ? state.lastGroup[tab] : null;
  state.kind = restore ? (state.lastKind[tab] ?? null) : null;

  const type = tabType();

  // A group named by an earlier session may be gone by now, and the check
  // is worth making for every type, not only for the channels the editor
  // can hide: an unknown name would leave the list empty with the sidebar
  // pointing at nothing. What is gone was not chosen, so the first group
  // takes over rather than the whole list.
  if (type && state.group && !visibleGroups(type).some((g) => g.name === state.group)) { state.group = null; chosen = false; }
  // First open: pick a group, so the list fills from a few kilobytes rather
  // than by loading the type's whole list straight away.
  if (type && state.group == null && !chosen && state.lib && !state.lib.isFull(type)) {
    const groups = visibleGroups(type);
    if (groups.length) state.group = groups[0].name;
  }
  if (state.sub != null && !groupHasTopic(type, state.group, state.sub)) state.sub = null;

  renderSidebar();
  // The rows on screen belong to the tab that was open, and refreshRows
  // waits for the network before it can replace them. Left there they sit
  // clickable under the new tab's heading, and a click in that moment
  // opens an item from the tab the viewer has just left — measured, a
  // click on Channels followed by a click on the top row opened a series.
  // The list is therefore emptied with the tab, and fills a moment later.
  mediaFilters.apply([], null);
  await refreshRows();
}

/**
 * The list on screen, from the state. Resolves to false when the list
 * failed or was cancelled — what was asked for is not there, and the caller
 * may put back what was — and to null when a newer load took over: that
 * one owns the list now, and what this one was asked for is still asked
 * for. Told apart because a search must not be cleared for the second: a
 * filter changed, or a favourite starred, while the search's whole list was
 * still on its way used to throw the typed words away (js/cataloguesearch.js).
 */
export async function refreshRows({ keepScroll = false, returnPosition = null, restoreFocus = false } = {}) {
  const type = tabType();
  const library = state.lib;
  const request = beginListLoad({ keepScroll });
  const current = () => state.listRequest === request && state.lib === library;
  // ensureFull() is false both when the list failed and when a newer load
  // took over while it was coming; which it was is the current() check.
  const notLoaded = () => (current() ? false : null);
  let rows = [];
  renderDetail();   // the detail panel follows the state on a tab change too
  if (state.detail?.loading) return;
  // Without a connection there is nothing to fetch. The collections are the
  // viewer's own and are read from storage, but every other tab would ask a
  // library that is not there — before the first connection, and for as long
  // as a new one is being made.
  if (!library && !isCollection()) { showRows([]); return false; }

  try {
    if (state.detail) {
      rows = state.detail.view === 'category' ? state.detail.items : episodesOfSeason();
    } else if (isCollection()) {
      rows = collectionItems();
      if (state.kind != null) rows = rows.filter((it) => kindGroup(it.k) === state.kind);
      // Array.sort is stable, so grouping by type does not disturb the
      // collection's own order within a type.
      else if (state.tab === 'fav') rows = [...rows].sort((a, b) => kindIndex(a) - kindIndex(b));
      // What was left halfway comes first, under a heading of its own: the
      // resume point was kept so the film could be finished, and a day
      // heading three screens down is not where it is looked for.
      if (state.tab === 'recent') rows = [...rows.filter(isUnfinished), ...rows.filter((it) => !isUnfinished(it))];
    } else if (state.query) {
      if (!(await ensureFull(type, t('progress.reason.search'), current)) || !current()) return notLoaded();
      rows = state.lib.search(type, state.query, null);
    } else if (state.group == null) {
      if (!(await ensureFull(type, t('progress.reason.all'), current)) || !current()) return notLoaded();
      rows = state.lib.full[type];
    } else {
      // Telling the world's channels from a country's own takes every
      // country's list, see js/international.js.
      if (type === 'live' && !state.settings.showInternational
        && (!(await ensureFull(type, t('progress.reason.international'), current)) || !current())) return notLoaded();
      const items = await loadGroupItems(type, state.group, current);
      if (!current()) return null;
      state.groupItems = items;
      rows = state.sub
        ? state.groupItems.filter((it) => it.cats.includes(state.sub))
        : state.groupItems;
    }
  } catch (err) {
    if (!current()) return null;
    hideProgress();
    if (isAbort(err)) showListCancelled(() => refreshRows()); else showListError(err, () => refreshRows());
    return false;
  }

  if (state.query && (isCollection() || state.detail)) {
    // The collections are searched here rather than in the library: they are
    // the viewer's own rows and never went through its index.
    const terms = searchTerms(state.query);
    rows = rows.filter((it) => matchesTerms(searchKey(it.n), terms));
  }

  // The visible name decides the order: once a prefix has been stripped
  // from a row, the library's sorting no longer matches what the list
  // shows.
  state.cleanName = nameCleanerFor(rows);
  // Episode order comes from season/episode numbers, even when names are tidied.
  const channelList = (type === 'live' || state.detail?.entry?.t === 'live') && !state.query;
  // The favourites and the history keep their own order (newest first, by
  // day): their names are tidied, not sorted by.
  if (!channelList && state.cleanName && !state.query && state.detail?.view !== 'series' && !(isCollection() && !state.detail)) rows = sortItems(rows, (name, item) => state.cleanName(name, item));
  rows = visibleRows(rows);
  if (type === 'live' && !state.query && !state.detail && !isCollection()) rows = withoutInternational(rows);
  // The setting says where the list starts; the personal arrangement, made
  // in Organize channels, has the last word over it.
  if (channelList) {
    rows = sortChannels(rows, state.settings.channelSort, channelLabel());
  }
  const filterType = !isCollection() && !state.detail && (type === 'movie' || type === 'series') ? type : null;
  rows = mediaFilters.apply(rows, filterType);
  showRows(rows, { keepScroll });
  if (returnPosition) listNavigation.restore(vlist, returnPosition, {
    focus: typeof restoreFocus === 'function' ? restoreFocus() : restoreFocus,
  });
  // The view is stored where it has arrived, not where it was heading: a
  // group whose list failed or was cancelled is restored below and stored
  // from there instead.
  rememberView();
  updateAddress();
}

export const mediaFilters = new MediaFilters($('media-filters'), () => {
  state.cursor = -1;
  return refreshRows();
}, item => item.details || state.lib?.details.get(`${item.k === 1 ? 'vod' : 'series'}:v2:${item.id}`), $('active-media-filters'));

/**
 * The favourites among the rows on screen, folded away above the list: a
 * country of six hundred channels holds the viewer's five somewhere in it,
 * and this finds them without taking them out of the order below. Only in
 * a list being browsed — a search, a page opened from the list and the
 * collections are lists of their own. Open or folded is remembered. Its
 * heading is there with none in it as well, saying how one gets there: a
 * strip that appeared with the first star pushed the whole list down under
 * the hand that gave it.
 */
let favStripOpen = false;

export function renderFavStrip(rows) {
  const strip = $('fav-strip');
  const browsing = !isCollection() && !state.detail && !state.query && !state.listLoading;
  strip.hidden = !browsing || !['live', 'movie', 'series'].includes(state.tab);
  const items = $('fav-strip-items');
  if (strip.hidden) { items.replaceChildren(); return; }
  const favs = rows.filter((item) => state.favorites.has(`${item.k}:${item.id}`));
  $('fav-strip-count').textContent = nf.format(favs.length);
  $('fav-strip-toggle').setAttribute('aria-expanded', String(favStripOpen));
  items.hidden = !favStripOpen;
  if (!favStripOpen) { items.replaceChildren(); return; }
  if (!favs.length) {
    const hint = document.createElement('p');
    hint.className = 'fav-strip-empty';
    hint.textContent = t('favs.empty');
    items.replaceChildren(hint);
    return;
  }
  const playing = state.playing ? `${state.playing.k}:${state.playing.id}` : null;
  items.replaceChildren(...favs.map((item) => {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'fav-tile' + (playing === `${item.k}:${item.id}` ? ' playing' : '');
    const name = state.cleanName ? state.cleanName(item.n, item) : item.n;
    tile.title = item.n;
    const picture = item.k === 0 ? poster('fav-logo', item.logo, 'channel')
      : poster('fav-cover', item.logo, item.k === 2 ? 'series' : 'movie');
    const label = document.createElement('span');
    label.className = 'fav-name';
    label.textContent = name;
    tile.append(picture, label);
    tile.addEventListener('click', () => openItem(item));
    return tile;
  }));
}

async function toggleFavStrip() {
  favStripOpen = !favStripOpen;
  renderFavStrip(state.rows);
  await store.saveUiState({ favStripOpen });
}

/**
 * The rows on screen. Everything painted from them follows in one call, so
 * that nothing on screen can belong to a list that is no longer shown.
 */
export function showRows(rows, { keepScroll = false, loading = false } = {}) {
  state.listLoading = loading;
  el.list.setAttribute('aria-busy', String(loading));
  // The programme search reads the channels on show, and another set of
  // them ends it. The same set repainted — a star, the language, the
  // catalogue refreshed in the background — leaves it, and the guide, alone.
  if (!sameChannels(state.rows, rows)) programmeSearch.clear();
  listNavigation.setRows(rows, { loading, keepSelection: keepScroll });
  state.rows = rows;
  state.catCounts = categoryCountsFor(rows);
  state.rowIndex = new Map(rows.map((it, i) => [`${it.k}:${it.id}`, i]));
  state.sections = sectionsFor(rows);
  applyListLayout();
  vlist.setCount(rows.length, {
    keepScroll,
    heightAt: state.sections.size ? (i) => ROW_H + (state.sections.has(i) ? SEP_H : 0) : null,
  });
  // The guide shows the same set as the list, so search and group selection
  // narrow it without a filter of its own.
  if (guideOpen && state.tab === 'live' && !guideFavorites) grid.setChannels(rows.filter((it) => it.k === 0));
  renderSubcats();
  renderFavStrip(rows);
  renderListInfo();
  renderEmptyState();
  catalogueSearch.render();
  updatePlayerLayout();
}

/* =============================================================== sidebar */

/**
 * The sidebar is the same box on every tab, but its contents change: on the
 * lists, countries and topics; in the collections, types. That way
 * favourites and history get the same structure as the other views instead
 * of leaving the column empty.
 */
export function renderSidebar() {
  if (isCollection()) renderKinds();
  else renderCategories();
  markGroups();
  renderCountriesButton();
  renderGroupsFoot();
}

/** Favourites only, under the sidebar's filter on the channels, the films and the series. */
let groupsFavOnly = false;
function renderGroupsFoot() {
  const box = $('groups-favonly');
  $('groups-favonly-row').hidden = isCollection() || !state.lib;
  box.checked = groupsFavOnly;
}

/** "Choose countries", or how many are chosen, under the channels' sidebar. */
function renderCountriesButton() {
  const button = $('btn-countries');
  const type = tabType();
  button.hidden = !state.lib || isCollection() || !type;
  if (button.hidden) return;
  const live = type === 'live';
  const chosen = live ? chosenCountries() : chosenCategories(type);
  button.dataset.kind = live ? 'countries' : 'categories';
  const total = nf.format(state.lib.groups[type].length);
  $('btn-countries-text').textContent = live
    ? (chosen ? t('countries.button.chosen', { count: chosen.size, n: nf.format(chosen.size), total }) : t('countries.button'))
    : (chosen ? t('categories.button.chosen', { n: nf.format(chosen.size), total }) : t('categories.button'));
}

/**
 * The sidebar's rows, named so aria-activedescendant can point at one, and
 * the cursor placed. The cursor is kept across a repaint — starring a row
 * rebuilds the whole strip, and a cursor that jumped back to the chosen
 * group each time would make a second press land somewhere else. It is
 * seeded on the chosen row only when it has none, which is what a tab change
 * and a fresh choice both ask for by clearing it.
 */
function markGroups() {
  const rows = [...el.groups.children];
  rows.forEach((row, i) => { row.id = `grp-${i}`; });
  if (state.groupCursor == null || state.groupCursor >= rows.length) {
    const chosen = rows.findIndex((row) => row.getAttribute('aria-selected') === 'true');
    state.groupCursor = chosen >= 0 ? chosen : 0;
  }
  paintGroupCursor();
}

function paintGroupCursor() {
  const rows = [...el.groups.children];
  rows.forEach((row, i) => row.classList.toggle('cursor', i === state.groupCursor));
  const at = rows[state.groupCursor];
  if (at) el.groups.setAttribute('aria-activedescendant', at.id);
  else el.groups.removeAttribute('aria-activedescendant');
}

function moveGroupCursor(to) {
  const rows = [...el.groups.children];
  if (!rows.length) return;
  state.groupCursor = Math.max(0, Math.min(rows.length - 1, to));
  paintGroupCursor();
  rows[state.groupCursor].scrollIntoView({ block: 'nearest' });
}

function renderKinds() {
  el.groupsFilter.hidden = true;
  const items = collectionItems();
  // An empty collection needs no filter: the empty-state text says more
  // than a row reading "All 0".
  if (!items.length) { el.groups.replaceChildren(); return; }

  const counts = new Map();
  for (const item of items) { const k = kindGroup(item.k); counts.set(k, (counts.get(k) || 0) + 1); }

  const frag = document.createDocumentFragment();
  frag.appendChild(categoryRow(
    { id: null, name: t('groups.all'), count: items.length, active: state.kind == null, all: true, icon: KIND_ICONS.all },
    selectKind,
  ));
  for (const kind of KIND_ORDER) {
    const count = counts.get(kind) || 0;
    if (count === 0) continue;
    frag.appendChild(categoryRow(
      { id: kind, name: kindLabel(kind), count, active: state.kind === kind, icon: KIND_ICONS[kind] },
      selectKind,
    ));
  }
  el.groups.replaceChildren(frag);
  fillGroupPicker(KIND_ORDER.filter((k) => counts.get(k)).map((k) => [kindLabel(k), String(k)]),
    state.kind == null ? '' : String(state.kind));
}

async function selectKind(kind) {
  catalogueSearch.reset();
  state.kind = kind;
  // A sidebar choice concerns the collection, not the list drilled into
  // from it — otherwise the tap would appear to do nothing.
  state.detail = null;
  state.cursor = -1;
  state.groupCursor = null;
  state.lastKind[state.tab] = kind;
  renderKinds();
  await refreshRows();
}

export function renderCategories() {
  const type = tabType();
  el.groupsFilter.hidden = false;
  // Countries on the channel tab, genres on the other two. The field above
  // the sidebar named only the first, on every tab.
  const genres = type === 'movie' || type === 'series';
  el.categoryFilter.placeholder = t(genres ? 'groups.filter.genres' : 'groups.filter.placeholder');
  el.categoryFilter.setAttribute('aria-label', el.categoryFilter.placeholder);
  el.groups.setAttribute('aria-label', t(genres ? 'groups.genres.aria' : 'groups.aria'));
  if (!type || !state.lib) { el.groups.replaceChildren(); return; }

  let counts = state.lib.groupCounts(type);
  const full = state.lib.full[type];
  const visible = full ? (type === 'live' ? withoutInternational(visibleRows(full)) : visibleRows(full)) : full;
  if (type === 'live' && full) {
    const groupOf = new Map(visibleGroups(type).flatMap((g) => g.cats.map((c) => [c.id, g.name])));
    counts = new Map();
    for (const item of visible) {
      for (const group of new Set(item.cats.map((id) => groupOf.get(id)).filter(Boolean))) counts.set(group, (counts.get(group) || 0) + 1);
    }
  }
  const terms = searchTerms(state.categoryFilter);
  const filter = terms.length > 0;
  // The filter matches sub-categories too, so that "sport" finds the
  // countries that have one even when the country's name lacks the word.
  // Favourites only (the box under the sidebar's filter): the groups starred, and
  // those holding a starred topic; the group open stays, so that the list
  // beside it is not left without its row.
  const starred = groupsFavOnly ? new Set([...state.favorites.values()].filter((f) => f.k === 'c' && f.t === type).map((f) => f.g)) : null;
  const groups = visibleGroups(type).filter((g) => (!starred || starred.has(g.name) || state.group === g.name) && (!filter
    || matchesTerms(searchKey(g.name), terms)
    || g.cats.some((c) => matchesTerms(searchKey(c.name), terms))));

  const frag = document.createDocumentFragment();
  if (!filter) {
    const total = visible ? visible.length : null;
    const all = categoryRow(
      { id: null, name: t('groups.all'), count: total, active: state.group == null, all: true, indent: true },
      selectGroup,
    );
    if (total == null) all.title = t('groups.all.title');
    frag.appendChild(all);
  }
  for (const group of groups) {
    // A group favourite covers every sub-category: "Finland" brings the
    // country's whole offering, including what appears in it later.
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
  fillGroupPicker(visibleGroups(type).map((g) => [g.name, g.name]), state.group ?? '');
}

/**
 * The sidebar's choice as a menu, for a window with no room for a sidebar.
 * Built from whatever the sidebar has just been built from, so the two can
 * never disagree about what is on offer or what is chosen.
 */
function fillGroupPicker(options, chosen) {
  const picker = $('group-select');
  picker.replaceChildren(new Option(t('groups.all'), ''), ...options.map(([label, value]) => new Option(label, value)));
  picker.value = String(chosen);
  $('group-picker').hidden = !state.lib && !isCollection();
}

export async function selectGroup(name) {
  catalogueSearch.reset();
  programmeSearch.clear();
  const before = { group: state.group, sub: state.sub, rows: state.rows, groupItems: state.groupItems };
  const library = state.lib;
  state.group = name;
  state.sub = null;
  state.detail = null;
  state.cursor = -1;
  state.groupCursor = null;
  state.lastGroup[state.tab] = name;
  renderSidebar();
  const pending = refreshRows();
  const request = state.listRequest;
  if (await pending === false && request === state.listRequest && state.lib === library) {
    // Loading clears the rows. Restore the previous view on cancellation
    // or failure, unless a newer navigation already owns the list — or a new
    // connection does, whose account these rows and this group are not from.
    state.group = before.group;
    state.sub = before.sub;
    state.groupItems = before.groupItems;
    state.lastGroup[state.tab] = before.group;
    renderSidebar();
    showRows(before.rows);
    rememberView();
    if (state.listError) toast(state.listError, { long: true, kind: 'error' });
  }
}

export function visibleGroups(type) {
  const groups = state.lib?.groups[type] || [];
  if (type !== 'live') {
    const chosen = chosenCategories(type);
    return chosen ? groups.filter((g) => chosen.has(g.name)) : groups;
  }
  const hidden = new Set(state.channelPrefs.hiddenCategories);
  const chosen = chosenCountries();
  return groups.map((g) => ({ ...g, cats: g.cats.filter((c) => !hidden.has(c.id)) }))
    .filter((g) => g.cats.length && (!chosen || chosen.has(g.name)));
}

/**
 * The live groups the viewer watches, or null for all of them. A chosen
 * country the provider no longer has does not count: were it the only
 * one, nothing at all would be shown.
 */
export function chosenCountries() {
  const names = state.channelPrefs.countries;
  const groups = state.lib?.groups.live;
  if (!names.length || !groups) return null;
  const chosen = new Set(names.filter((name) => groups.some((g) => g.name === name)));
  return chosen.size ? chosen : null;
}

/**
 * The films' or the series' categories the viewer chose, or null for all
 * of them; as with the countries, one the provider no longer has does not
 * count, and nothing left counts as all.
 */
const CATEGORY_PREFS = { movie: 'movieCategories', series: 'seriesCategories' };
function chosenCategories(type) {
  const names = state.channelPrefs[CATEGORY_PREFS[type]] || [];
  const groups = state.lib?.groups[type];
  if (!names.length || !groups) return null;
  const chosen = new Set(names.filter((name) => groups.some((g) => g.name === name)));
  return chosen.size ? chosen : null;
}

/** Category id → the name of the film or series group it is in. */
const groupOfCatByType = new WeakMap();
export function groupOfType(type) {
  const groups = state.lib?.groups[type] || [];
  let map = groupOfCatByType.get(groups);
  if (!map) groupOfCatByType.set(groups, map = new Map(groups.flatMap((g) => g.cats.map((c) => [c.id, g.name]))));
  return map;
}

const groupOfCategory = new WeakMap();
/** Category id → the name of the live group it is in. */
export function liveGroupOf() {
  const groups = state.lib?.groups.live || [];
  let map = groupOfCategory.get(groups);
  if (!map) groupOfCategory.set(groups, map = new Map(groups.flatMap((g) => g.cats.map((c) => [c.id, g.name]))));
  return map;
}

/**
 * The rows the viewer's choices leave: hidden channels and categories out
 * everywhere, and the countries not chosen out of the browsing, the search
 * and the guide — but not out of the favourites and the history, which
 * hold what was picked by hand.
 */
export function visibleRows(rows) {
  const prefs = state.channelPrefs;
  const visible = visibilityFilter(prefs);
  const groups = new Set(visibleGroups('live').map((g) => g.name));
  const chosen = isCollection() ? null : chosenCountries();
  const groupOf = chosen ? liveGroupOf() : null;
  // The films' and the series' categories, the same way, in the browsing
  // and the search; a favourite or the history keeps what was picked.
  const picked = isCollection() ? {} : { 1: chosenCategories('movie'), 2: chosenCategories('series') };
  const pickedOf = { 1: picked[1] && groupOfType('movie'), 2: picked[2] && groupOfType('series') };
  return rows.filter((item) => {
    if (!visible(item)) return false;
    if (chosen && item.k === 0 && !(item.cats || []).some((id) => chosen.has(groupOf.get(id)))) return false;
    if (picked[item.k] && !(item.cats || []).some((id) => picked[item.k].has(pickedOf[item.k].get(id)))) return false;
    if (item.k !== 'c' || item.t !== 'live' || !prefs.hiddenCategories.length) return true;
    if (item.c != null) return !prefs.hiddenCategories.includes(item.c);
    return groups.has(item.g);
  });
}

/**
 * The channels found in many countries' lists taken out of a country's,
 * when the viewer has asked for that in Settings › Viewing. Browsing only:
 * a search, a favourite or a recent channel was asked for by name. Until
 * the whole list is in, nothing can be told apart and nothing goes.
 */
export function withoutInternational(rows) {
  if (state.settings.showInternational) return rows;
  const global = state.lib?.international();
  return global?.size ? rows.filter((item) => item.k !== 0 || !global.has(String(item.id))) : rows;
}

/**
 * The viewer's channel choices saved and shown: the sidebar, the topics,
 * the guide's groups and the list follow at once. A group that has just
 * been left out is left, for the first one still shown.
 */
async function saveChannelChoices(prefs) {
  await store.saveChannelPreferences(prefs);
  state.channelPrefs = channelPreferences(prefs);
  await showChannelChoices();
}

/** The choices in state.channelPrefs on screen — this tab's own, or another tab's. */
async function showChannelChoices() {
  if (state.tab === 'live' && state.group && !visibleGroups('live').some((g) => g.name === state.group)) {
    state.group = visibleGroups('live')[0]?.name ?? null;
    state.sub = null;
  }
  // A film or series category left out takes the open group with it.
  const type = tabType();
  if ((type === 'movie' || type === 'series') && state.group && !visibleGroups(type).some((g) => g.name === state.group)) {
    state.group = null;
    state.sub = null;
  }
  if (state.channelPrefs.hiddenCategories.includes(state.sub)) state.sub = null;
  if (state.tab === 'live') state.lastGroup.live = state.group;
  else if (type) state.lastGroup[state.tab] = state.group;
  renderSidebar();
  renderGuideGroups();
  await refreshRows({ keepScroll: true });
}

/** A change to the choices, with Undo in the message that says it was made. */
async function changeChannelChoices(prefs, message) {
  const before = state.channelPrefs;
  await saveChannelChoices(prefs);
  toast(message, { action: { label: t('row.undo'), onClick: () => saveChannelChoices(before) } });
}

const countryPicker = new CountryPicker((countries) => saveChannelChoices({ ...state.channelPrefs, countries }));
const hiddenList = new HiddenList((prefs) => saveChannelChoices({ ...state.channelPrefs, ...prefs }));

// The language a browser speaks, and the country whose list it most
// likely wants first; English says nothing about where its reader is.
const LANGUAGE_COUNTRY = { fi: 'fi', sv: 'se', nb: 'no', da: 'dk', de: 'de', nl: 'nl', fr: 'fr', es: 'es', pt: 'br', it: 'it', pl: 'pl', tr: 'tr', cs: 'cz', hu: 'hu', ro: 'ro', hr: 'hr', sq: 'al', el: 'gr', ru: 'ru', uk: 'ua', bg: 'bg', sk: 'sk', sl: 'si', sr: 'rs', lt: 'lt', lv: 'lv', et: 'ee', id: 'id', vi: 'vn' };

function openCountryPicker({ first = false } = {}) {
  if (!state.lib) return;
  const code = LANGUAGE_COUNTRY[store.browserLanguage()];
  const suggested = code ? state.lib.groups.live.filter((g) => labelCodes(g.name).includes(code)).map((g) => g.name) : [];
  countryPicker.show({
    groups: state.lib.groups.live,
    counts: state.lib.groupCounts('live'),
    chosen: state.channelPrefs.countries,
    suggested,
    first,
  });
}

/** "Which categories do you want to see?" — the films' or the series'. */
function openCategoryPicker(type) {
  if (!state.lib || !CATEGORY_PREFS[type]) return;
  const key = CATEGORY_PREFS[type];
  countryPicker.show({
    groups: state.lib.groups[type],
    counts: state.lib.groupCounts(type),
    chosen: state.channelPrefs[key],
    onSave: (names) => saveChannelChoices({ ...state.channelPrefs, [key]: names }),
    texts: { title: 'categories.title', help: 'categories.help', filter: 'categories.filter', all: 'categories.all' },
  });
}

/**
 * Asked once per account, after the first connection, when the provider
 * has so many countries that a list of all of them is in the way. The
 * answer — or Cancel — is not asked for again; the sidebar keeps the way
 * back in.
 */
const ASK_COUNTRIES_FROM = 20;
async function askCountriesOnce() {
  if (!state.lib || state.channelPrefs.countries.length) return;
  if (state.lib.groups.live.length < ASK_COUNTRIES_FROM) return;
  const asked = (await store.loadUiState()).countriesAsked || [];
  // The account as the rest of the player names it (js/config.js), so that
  // "example.tv" and "Example.TV:80" are asked once between them. The
  // older form, host:port/user as typed, still counts as asked: a viewer
  // who answered under it is not asked again by an update.
  const account = store.accountKey(state.config);
  const typed = `${state.config.host}:${state.config.port}/${state.config.username}`;
  if (asked.includes(account) || asked.includes(typed)) return;
  await store.saveUiState({ countriesAsked: [...asked, account] });
  if (document.querySelector('dialog[open]')) return;
  openCountryPicker({ first: true });
}

export async function openHiddenList() {
  if (!state.lib) return;
  if (state.channelPrefs.hiddenChannels.length && !await ensureFull('live', t('hidden.loading'))) return;
  const full = state.lib.full.live || [];
  hiddenList.show(state.channelPrefs, (id) => full.find((item) => String(item.id) === id) || null,
    (id) => state.lib.categoryName('live', id));
}

/**
 * The actions on a row: a favourite or not, out of the history when it is
 * in it, and a channel hidden.
 */
export function openItemMenu(item, at) {
  const prefs = state.channelPrefs;
  const id = String(item.id);
  const name = state.cleanName ? state.cleanName(item.n, item) : item.displayName || item.n;
  const favorite = state.favorites.has(`${item.k}:${item.id}`);
  const items = [{ label: t(favorite ? 'row.fav.remove' : 'row.fav.add'), onClick: () => toggleFavorite(item) }];
  if (state.tab === 'recent' && !state.detail) items.push({ label: t('row.remove.history'), onClick: () => removeFromHistory(item) });
  if (item.k === 0) {
    items.push({
      label: t('row.hide'), danger: true,
      onClick: () => changeChannelChoices({ ...prefs, hiddenChannels: [...prefs.hiddenChannels, id] }, t('row.hidden', { name })),
    });
  }
  openRowMenu(at, items, { label: name, returnFocus: el.list });
}

/**
 * The name a channel is put in order by, in the list and in the channel
 * editor alike: the visible one, tidied by its own group's rules. One
 * function for both, because the editor saves its order for every channel
 * at once, and a list sorted by other names would show the untouched ones
 * in another order than the editor did. Until the whole list is in, the
 * view's own tidier stands in; the editor always has the whole list.
 */
function channelLabel() {
  const lib = state.lib;
  return lib?.full.live ? searchNameCleaner(lib.groups.live, lib.full.live) : state.cleanName;
}

/* ================================================================== rows */

/** The list's own geometry, and the same again whenever the reader's font
 *  setting moves it. */
function watchRowHeights() {
  const resize = () => {
    if (usesGrid()) return;
    vlist.setRowHeight(ROW_H, state.sections.size ? (i) => ROW_H + (state.sections.has(i) ? SEP_H : 0) : null);
  };
  ROW_H = watchLength('--row-h', ROW_H, (px) => { ROW_H = px; resize(); });
  SEP_H = watchLength('--sep-h', SEP_H, (px) => { SEP_H = px; resize(); });
  resize();
}

export const vlist = new VirtualList(el.list, ROW_H, renderRow, {
  onPaint: () => listNavigation.sync(),
  onVisible: (first, last) => {
    // In guide mode the list is hidden, and its visible rows would take the
    // programme-data queue away from the grid.
    if (state.epg && !guideOpen) state.epg.setVisible(state.rows.slice(first, last));
    const lib = state.lib;
    if (lib) lib.warmMovieDurations(guideOpen ? [] : state.rows.slice(first, last), (id, info) => {
      if (state.lib !== lib) return;
      mediaFilters.metadataChanged();
      const index = state.rowIndex.get(`1:${id}`);
      if (index != null) {
        state.rows[index].details = info;
        state.rows[index].durationSec = info.durationSec;
        vlist.refreshRow(index);
      }
      if (state.playing?.k === 1 && state.playing.id === id) {
        state.playing.details = info;
        renderInfoStrip();
      }
    });
  },
});

/* --------------------------------------------------------- Chromecast */

export const cast = new Cast(el.video, renderCastState);

/**
 * The Cast button and the c key. A natively played file goes through the
 * Remote Playback API, which opens Chrome's device picker; the MediaSource
 * routes are outside its reach, and for them the overlay explains how
 * Chrome's own tab casting does the same once the player is full screen.
 * cast.js and CHROMECAST.md have the reasons.
 *
 * Synchronous up to prompt(): the picker needs the user gesture, and the
 * first await would spend it.
 */
function castCurrent() {
  if (!castSupported) return;
  if (!state.playingSpec) { toast(t('cast.nothing'), { kind: 'warn' }); return; }
  // Already casting: the same dialog is where Chrome lets the viewer stop.
  if (cast.busy) { cast.prompt().catch(() => {}); return; }
  if (!playback.engineKey) { toast(t('cast.loading')); return; }
  if (playback.engineKey !== 'native') { showCastHint(); return; }
  cast.prompt().catch((err) => {
    const name = err && err.name;
    if (name === 'NotAllowedError') return;                    // the picker was closed
    if (name === 'NotFoundError') { toast(t('cast.nodevice'), { kind: 'warn' }); return; }
    // NotSupportedError: this source will not remote after all. The tab
    // route still does.
    showCastHint();
  });
}

/** The tab route, over the picture; playback carries on beneath. */
function showCastHint() {
  el.overlay.hidden = false;
  el.overlay.classList.remove('loading');
  el.overlayTitle.textContent = t('cast.tab');
  el.overlayText.textContent = t('cast.tab.text');
  const close = () => { el.overlay.hidden = true; showOverlayActions(null); };
  showOverlayActions([
    { label: t('cast.fullscreen'), onClick: () => { close(); enterFullscreen(); } },
    { label: t('cast.close'), onClick: close },
  ]);
}

/**
 * The menu item: hidden without the API, lit while the device plays. The
 * hamburger is lit with it — the item's own colour is behind a press, and
 * casting is worth seeing without one.
 */
function renderCastState() {
  el.cast.hidden = !castSupported;
  el.cast.classList.toggle('on', cast.connected);
  el.more.classList.toggle('on', cast.connected);
  // The engine line carries the device; before anything plays it says "Not
  // connected", and that text is not this function's to change.
  if (state.playing) renderNowSub();
}

/**
 * The s key stars what the view is pointing at: a sidebar group or a topic
 * chip that has the focus, otherwise the row the list cursor stands on, and
 * failing that whatever is playing.
 *
 * Every star in the app is out of the tab order — a list of 55,000 films
 * would otherwise put 55,000 buttons between the list and the player, see
 * rows.js — so until this key there was no way to reach one without a
 * mouse, and the Favourites tab was a room with no door for anyone using a
 * keyboard. The name is said out loud the way the audio track's is: at that
 * moment the eye is on the picture, not on the row.
 */
function toggleFavoriteAtCursor() {
  // A starless sidebar row reserves the space with a plain div, so the
  // class alone does not promise a button.
  // A chip carries its own focus. The sidebar's rows are options, and the
  // listbox around them holds the focus, so its cursor says which row.
  const active = document.activeElement;
  const box = active?.closest('.group, .chip')
    ?? (active === el.groups ? el.groups.children[state.groupCursor] ?? null : null);
  const star = box?.querySelector('.group-star, .chip-star');
  if (star && star.tagName === 'BUTTON') { starFocusedRow(box, star); return; }

  const item = state.cursor >= 0 ? state.rows[state.cursor] : state.playing;
  if (!item) return;
  if (item.k === 'c') toggleFavCategory(item); else toggleFavorite(item);
  const on = state.favorites.has(`${item.k}:${item.id}`);
  toast(t(on ? 'fav.added' : 'fav.removed', { name: shownName(item) }));
}

/**
 * The star of a sidebar group or a topic chip that has the focus.
 *
 * Both strips are repainted whole when a favourite changes — the star is a
 * state of the row, and the row is rebuilt to show it — so the node holding
 * the focus is gone by the time the click returns. Left there, the focus
 * falls to the body and a second press reaches nothing at all: measured, the
 * key added a category and then did nothing, silently, for the rest of the
 * session. The focus goes back to the row standing in the same place, and
 * what that row now says is what is read out.
 */
function starFocusedRow(box, star) {
  const strip = box.parentElement;
  const at = [...strip.children].indexOf(box);
  const name = (box.querySelector('.group-name')?.textContent
    ?? box.querySelector('.chip-main')?.firstChild?.textContent ?? '').trim();
  star.click();
  const again = strip.children[at];
  const back = again?.querySelector('.group-star, .chip-star');
  if (!back) return;                       // the strip is not the one it was
  // A chip's own button had the focus and its replacement needs it back. A
  // sidebar row never had it — the listbox around it did, and still does.
  again.querySelector('.chip-main')?.focus();
  toast(t(back.classList.contains('on') ? 'fav.added' : 'fav.removed', { name }));
}

/**
 * Delete drops the history row the cursor is on. The × at the end of the row
 * is out of the tab order for the same reason the star is — a list of
 * thousands would put thousands of buttons in it — so without this the only
 * way to remove one entry from the keyboard was to clear the lot.
 */
function removeAtCursor() {
  if (state.tab !== 'recent' || state.detail || state.cursor < 0) return;
  const item = state.rows[state.cursor];
  if (!item) return;
  removeFromHistory(item);
  toast(t('row.removed.history', { name: shownName(item) }));
}

function moveCursor(delta) { listNavigation.move(delta, vlist); }

export function playRelative(delta) {
  if (!state.playing) return;
  const index = state.rowIndex.get(`${state.playing.k}:${state.playing.id}`);
  // An episode played from History or Favourites is not in the list on
  // screen; the next one is still the series' own next.
  if (index == null) {
    const item = state.playing;
    if (delta === 1 && item.k === 3) nextEpisode(item).then((episode) => episode && state.playing === item && playEpisode(episode)).catch(() => {});
    return;
  }
  const next = index + delta;
  if (next < 0 || next >= state.rows.length) return;
  state.cursor = next;
  vlist.scrollToIndex(next);
  openItem(state.rows[next]);
}

// The channel before this one, as a television's own "previous" button
// has it: two channels watched in turn are a key apart, wherever in the
// list either of them is. lastChannel is the live channel played most
// recently, previousChannel the one before it.
let lastChannel = null;
let previousChannel = null;

export function noteChannel(item) {
  if (lastChannel && String(lastChannel.id) !== String(item.id)) previousChannel = lastChannel;
  lastChannel = item;
}

/** From a channel, the one before it; from a film, an episode or a recording, the last channel. */
function playLastChannel() {
  const target = state.playing?.k === 0 && !state.catchup ? previousChannel : lastChannel;
  if (!target) { toast(t('player.nolastchannel')); return; }
  const index = state.rowIndex.get(`0:${target.id}`);
  if (index != null) { state.cursor = index; vlist.scrollToIndex(index); }
  playItem(target);
}

function wireUi() {
  // The arrows walk the strip and Home and End reach its ends, which is what
  // a tab strip promises the moment it calls itself one. The same keys are
  // the list's while the focus is elsewhere, so they are taken only here.
  el.tabs.addEventListener('keydown', (e) => {
    const tabs = [...el.tabs.children];
    const at = tabs.indexOf(e.target);
    if (at < 0) return;
    const next = e.key === 'ArrowRight' ? (at + 1) % tabs.length
      : e.key === 'ArrowLeft' ? (at + tabs.length - 1) % tabs.length
      : e.key === 'Home' ? 0
      : e.key === 'End' ? tabs.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    e.stopPropagation();
    closeGuide();
    // The focus follows the choice, as it does in the settings dialog: the
    // strip is small and every tab is one the viewer may be heading for.
    tabs[next].focus();
    activateTab(tabs[next].dataset.tab, { restore: true });
  });

  el.tabs.addEventListener('click', (e) => {
    const button = e.target.closest('button[data-tab]');
    if (!button) return;
    closeGuide();
    activateTab(button.dataset.tab, { restore: true });
  });

  el.groups.addEventListener('keydown', (e) => {
    const rows = el.groups.children;
    if (!rows.length) return;
    const last = rows.length - 1;
    if (e.key === 'ArrowDown') moveGroupCursor(state.groupCursor + 1);
    else if (e.key === 'ArrowUp') moveGroupCursor(state.groupCursor - 1);
    else if (e.key === 'PageDown') moveGroupCursor(state.groupCursor + 10);
    else if (e.key === 'PageUp') moveGroupCursor(state.groupCursor - 10);
    else if (e.key === 'Home') moveGroupCursor(0);
    else if (e.key === 'End') moveGroupCursor(last);
    else if (e.key === 'Enter' || e.key === ' ') rows[state.groupCursor]?.click();
    else return;
    e.preventDefault();
    // The same arrows move the list's cursor when the focus is elsewhere.
    e.stopPropagation();
  });

  // The filter panel used to open itself on every visit to Movies and
  // Series and take about 140 px off the top of the list, whether or not
  // anyone was filtering. It starts closed and stays however it was left.
  $('media-filters').addEventListener('toggle', () => store.saveUiState({ filtersOpen: $('media-filters').open }));

  let filterTimer = null;
  $('group-select').addEventListener('change', (e) => {
    const value = e.target.value;
    if (!isCollection()) return selectGroup(value || null);
    // The collections filter by type, and a type is 'c', 0, 1 or 2 — the
    // menu carries them as text and they go back as they came.
    return selectKind(value === '' ? null : KIND_ORDER.find((k) => String(k) === value) ?? null);
  });

  el.categoryFilter.addEventListener('input', () => {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => { state.categoryFilter = el.categoryFilter.value; renderCategories(); }, 120);
  });

  $('btn-refresh').addEventListener('click', () => (state.lib ? refreshCatalogue() : connect()));
  document.addEventListener('visibilitychange', refreshWhenStale);

  $('btn-settings').addEventListener('click', openSetup);
  $('btn-help').addEventListener('click', openHelp);
  $('btn-home').addEventListener('click', goHome);
  $('fav-strip-toggle').addEventListener('click', toggleFavStrip);
  $('btn-countries').addEventListener('click', () => (tabType() === 'live' ? openCountryPicker() : openCategoryPicker(tabType())));
  $('f-countries').addEventListener('click', () => openCountryPicker());
  new ResizeObserver(() => fitIdleHome()).observe(el.overlay);
  onSystemTheme(renderTheme);
  // The button turns what is on screen into the other one, and so leaves
  // "the system's" for a choice of its own; Settings has the way back.
  $('btn-theme').addEventListener('click', async () => {
    const theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    state.settings = { ...state.settings, theme };
    renderTheme();
    state.settings = await store.saveSettings({ theme });
  });
  wireModal($('help'), () => $('help').close());
  // The strip goes when the load stops, not when the key is pressed: a strip
  // that vanished on Esc would look as if the loading had finished.
  $('lp-cancel').addEventListener('click', cancelProgress);

  el.mode.addEventListener('change', () => {
    store.saveConfig({ streamMode: el.mode.value });
    if (state.playing) playItem(state.playing);
  });
  el.subs.addEventListener('change', chooseSubtitle);
  el.audio.addEventListener('change', chooseAudio);
  el.videowrap.addEventListener('click', clickPicture, true);
  $('btn-reload').addEventListener('click', retryPlayback);
  $('btn-live').addEventListener('click', () => state.catchup && playItem(state.catchup.channel));
  $('btn-guide').addEventListener('click', toggleGuide);
  $('epg-close').addEventListener('click', closeGuide);
  $('epg-now').addEventListener('click', () => { grid.goNow(); focusGrid(); });
  $('epg-prev').addEventListener('click', () => { grid.nudge(-30); focusGrid(); });
  $('epg-next').addEventListener('click', () => { grid.nudge(30); focusGrid(); });
  $('epg-in').addEventListener('click', () => { grid.zoomBy(1); focusGrid(); });
  $('epg-out').addEventListener('click', () => { grid.zoomBy(-1); focusGrid(); });
  $('epg-group').addEventListener('change', (e) => selectGroup(e.target.value || null));
  $('epg-favs').addEventListener('click', () => setGuideFavorites(!guideFavorites));
  $('btn-copy').addEventListener('click', copyUrl);
  $('btn-ext').addEventListener('click', playExternal);
  $('btn-record').addEventListener('click', toggleRecordNow);
  $('groups-favonly').addEventListener('change', (e) => {
    groupsFavOnly = e.target.checked;
    store.saveUiState({ groupsFavOnly });
    state.groupCursor = null;
    renderSidebar();
  });
  $('btn-recordings').addEventListener('click', openRecordings);
  $('btn-recordings-menu').addEventListener('click', openRecordings);
  $('recordings-close').addEventListener('click', () => $('recordings').close());
  $('f-record').addEventListener('change', askRecordingConsent);
  $('rec-consent-ok').addEventListener('click', () => closeRecordingConsent(true));
  $('rec-consent-cancel').addEventListener('click', () => closeRecordingConsent(false));
  wireModal($('rec-consent'), () => closeRecordingConsent(false));
  wireModal($('recordings'), () => $('recordings').close());
  el.cast.addEventListener('click', castCurrent);
  $('btn-pip').addEventListener('click', async () => {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await el.video.requestPictureInPicture();
    } catch { toast(t('player.pip.unavailable'), { kind: 'error' }); }
  });

  el.more.addEventListener('click', () => toggleMoreMenu());
  // The item's own handler has run by the time the click reaches the menu,
  // and none of them awaits before it spends the gesture — the clipboard,
  // the cast picker and the hand-off all need it.
  el.morePop.addEventListener('click', (e) => {
    if (e.target.closest('.popitem')) toggleMoreMenu(false, { focusButton: e.detail === 0 });
  });
  el.morePop.addEventListener('keydown', (e) => {
    const items = moreItems();
    const at = items.indexOf(document.activeElement);
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (step) { e.preventDefault(); items[(at + step + items.length) % items.length]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); items[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); items.at(-1)?.focus(); }
  });
  // Tab out of the menu closes it: a menu left open behind the focus would
  // hang over the picture with no way back into it.
  el.morePop.addEventListener('focusout', (e) => {
    if (!el.morePop.contains(e.relatedTarget) && e.relatedTarget !== el.more) toggleMoreMenu(false);
  });
  // Outside either panel closes it, as it does the dialog. The button that
  // opened it is excluded, or its own click would reopen what it closed.
  document.addEventListener('pointerdown', (e) => {
    if (!el.sublookPop.hidden && !el.sublookPop.contains(e.target) && !el.sublook.contains(e.target)) toggleSubtitleLook(false);
    if (!el.morePop.hidden && !el.morePop.contains(e.target) && !el.more.contains(e.target)) toggleMoreMenu(false);
  });

  // A mouse click leaves the focus on the button or the select it landed
  // on, and from then on the keys would go there: Space would press the
  // button again — reload the stream, say — and an arrow would change the
  // select. So the focus is given back after the click. A keyboard user's
  // click carries no detail and keeps the focus, and the dialogs keep
  // theirs as well.
  document.addEventListener('click', (e) => {
    const button = e.target.closest('button');
    if (!button || e.detail === 0 || button.closest('dialog')) return;
    setTimeout(() => { if (document.activeElement === button) button.blur(); }, 0);
  });
  const mousedSelects = new WeakSet();
  document.addEventListener('mousedown', (e) => { if (e.target.tagName === 'SELECT') mousedSelects.add(e.target); });
  document.addEventListener('change', (e) => {
    const select = e.target;
    if (select.tagName !== 'SELECT' || !mousedSelects.has(select) || select.closest('dialog')) return;
    mousedSelects.delete(select);
    select.blur();
  });

  document.addEventListener('keydown', (e) => {
    if ($('countries').open || $('hidden').open) return;
    const tag = e.target.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    // A key pressed with Ctrl, Cmd or Alt down belongs to the browser or to
    // the system, not to the app: Cmd+F and Ctrl+F open the browser's search
    // box and must not throw the picture to full screen the way a bare f
    // does. So every shortcut below answers to the plain key alone.
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
    if (e.key === 'Escape' && !el.sublookPop.hidden) { toggleSubtitleLook(false); el.sublook.focus(); return; }
    if (e.key === 'Escape' && !el.morePop.hidden) { toggleMoreMenu(false, { focusButton: true }); return; }
    // While the menu has the focus the keys are its own: an arrow steps
    // between its items rather than down the channel list.
    if (!el.morePop.hidden && el.morePop.contains(e.target)) return;
    if (e.key === '/' && !typing && plain) { e.preventDefault(); el.search.focus(); el.search.select(); return; }
    if (e.target === el.search && e.key === 'Escape') {
      e.preventDefault(); catalogueSearch.clear(); el.list.focus(); return;
    }
    // The list's own load answers Escape wherever the focus is, which the
    // dialog used to do for us by being modal.
    if (e.key === 'Escape' && !el.listProgress.hidden) { cancelProgress(); return; }
    // The video's own controls take the keys while the video has the
    // focus — after a click on the picture — except f, which used to be
    // the browser's full-screen key there and is now the app's.
    if (e.target === el.video && e.key === 'f' && plain) { toggleFullscreen(); return; }
    if (typing || e.target === el.video) return;
    if (el.setup.open || $('countries').open || $('hidden').open || $('help').open) return;
    // The menu of the row the list stands on: the context-menu key, or
    // Shift+F10 where a keyboard has none.
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      const item = state.rows[state.cursor];
      if (item && (item.k === 0 || (isCollection() && !state.detail && item.k !== 'c'))) {
        e.preventDefault();
        const node = vlist.nodes.get(state.cursor);
        openItemMenu(item, node?.querySelector('.row-more') || node || el.list);
      }
      return;
    }
    if (!plain) return;
    // A focused button takes Space and Enter itself; every other key is the player's.
    if (tag === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return;
    if (guideOpen) {
      if (e.key === 'Escape') { closeGuide(); return; }
      if (!$('programme-panel').hidden && e.key !== 'g') return;
      if (grid.handleKey(e)) { e.preventDefault(); return; }
    }
    switch (e.key) {
      // Among covers, up and down go a line and left and right a cover.
      case 'ArrowDown': e.preventDefault(); moveCursor(gridColumns); break;
      case 'ArrowUp': e.preventDefault(); moveCursor(-gridColumns); break;
      case 'ArrowRight': if (gridColumns > 1) { e.preventDefault(); moveCursor(1); } break;
      case 'ArrowLeft': if (gridColumns > 1) { e.preventDefault(); moveCursor(-1); } break;
      case 'PageDown': e.preventDefault(); moveCursor(gridColumns > 1 ? gridColumns * 3 : 10); break;
      case 'PageUp': e.preventDefault(); moveCursor(gridColumns > 1 ? -gridColumns * 3 : -10); break;
      case 'Enter': if (state.rows[state.cursor]) openItem(state.rows[state.cursor]); break;
      case 'Backspace': if (state.detail) closeDetail(); break;
      case ' ': e.preventDefault(); togglePause(); break;
      case 'f': toggleFullscreen(); break;
      case 'm': el.video.muted = !el.video.muted; break;
      case 'a': cycleAudio(); break;
      case 's': toggleFavoriteAtCursor(); break;
      case '+': case '=': e.preventDefault(); stepSubtitleSize(1); break;
      case '-': e.preventDefault(); stepSubtitleSize(-1); break;
      case '?': openHelp(); break;
      case 'Delete': removeAtCursor(); break;
      case 'n': playRelative(1); break;
      case 'p': playRelative(-1); break;
      case 'l': playLastChannel(); break;
      case 'g': toggleGuide(); break;
      case 'x': askExternal(); break;
      case 'c': castCurrent(); break;
      default: break;
    }
  });
}

/* ================================================================== start */

applyTheme(earlyTheme());
wirePickers();

async function init() {
  state.accounts = await store.loadAccounts();
  state.config = await store.loadConfig();
  await store.migrateAccountKeys(state.config);
  store.useAccount(state.config);
  state.settings = await store.loadSettings();
  renderTheme();
  const lang = store.interfaceLanguage(state.settings);
  await loadLanguage(lang);
  setLanguage(lang);
  applyLocale();
  applyStatic();
  catalogueSearch.render();
  updatePlayerLayout();

  watchRowHeights();
  wireSetup();
  wireUi();
  wireMediaSession();
  wireSubcatsResize();
  watchInterest();
  await loadLists();
  // Not waited for: the list of recordings has nothing to do with connecting.
  loadRecordingList().catch((err) => console.warn('[iptv] the recordings could not be read', err));
  store.watchStorage({ onList: showStoredList, onAccount: accountChangedElsewhere, onCleared: storageCleared });
  store.watchAccounts((accounts) => {
    state.accounts = accounts;
    renderAccountSwitcher();
    if (el.setup.open) renderAccountList();
    adoptSyncedAccount(accounts);
  });
  store.watchSettings(showStoredSettings);
  store.watchSyncStatus(() => { if (el.setup.open) renderSyncBox(); });
  renderAccountSwitcher();
  sync.start();
  el.mode.value = state.config.streamMode || 'auto';
  applySubtitleLook(state.settings);
  new SubtitleDisplay(el.video, el.subdisplay, el.videowrap);
  renderCastState();

  const ui = await store.loadUiState();
  favStripOpen = Boolean(ui.favStripOpen);
  groupsFavOnly = ui.groupsFavOnly === true;
  restoreGuideFavorites(ui.guideFavorites);
  // The address names this tab's place; the stored view names the place any
  // tab last settled on. A reload has an address and takes it, drill-down
  // and all. A player opened fresh from the toolbar icon has none, and the
  // stored view is what brings it back to where the last one was left.
  const route = parseRoute(location.hash);
  if (route) routeDetail = route.series || route.cat ? { series: route.series ?? null, cat: route.cat ?? null } : null;
  const start = route || {
    tab: ui.tab,
    ...(ui.group != null ? { group: ui.group } : {}),
    ...(ui.sub != null ? { sub: ui.sub } : {}),
    ...(ui.kind != null ? { kind: ui.kind } : {}),
  };
  if (start.tab) state.tab = start.tab;
  // The rest of the view waits for the library. connect() ends in
  // activateTab({ restore }), which takes the group and the type filter
  // from these two maps and the topic from storedSub, and drops any of
  // them the account no longer offers.
  if (start.group !== undefined) state.lastGroup[state.tab] = start.group;
  if (start.kind !== undefined) state.lastKind[state.tab] = start.kind;
  storedSub = start.sub ?? null;
  $('channel-tools').hidden = state.tab !== 'live' || !state.lib;
  if (typeof ui.subcatsHeight === 'number') state.subcatsHeight = ui.subcatsHeight;
  restoreListView(ui.listView);
  watchGridWidth();
  $('media-filters').open = ui.filtersOpen === true;
  markTabs(state.tab);

  window.addEventListener('hashchange', onAddressChanged);
  updateAddress();
  store.watchUpdateReady(offerUpdate);
  offerUpdate(await store.loadUpdateReady());

  // The cache's expired rows go a while after the start, out of the way of
  // the connection and the first list, which read from the same database.
  setTimeout(() => cachePurge((key) => probeCacheTtl(key) ?? libraryCacheTtl(key)), CACHE_PURGE_DELAY_MS);

  if (!configured()) {
    if (await adoptSyncedAccount(state.accounts)) return;
    renderIdleOverlay();
    openSetup();
    return;
  }
  await connect();
}

const CACHE_PURGE_DELAY_MS = 20000;

    renderEmptyState();
init();
