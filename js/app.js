import './testclock.js';
import { XtreamApi, ApiError } from './api.js';
import { M3uSource } from './m3usource.js';
import { StalkerSource, clearPortalRules } from './stalker.js';
import { installFetchTap } from './streamhub.js';

import { Library, sortItems, cacheTtl as libraryCacheTtl } from './library.js';
import { Epg } from './epg.js';

import { VirtualList, watchLength } from './vlist.js';
import { CatalogueSearch } from './cataloguesearch.js';
import { PlayerLayout } from './playerlayout.js';
import { categoryRow, emptyState, HISTORY_ICONS, KIND_ICONS, setStar } from './rows.js';
import { searchNameCleaner, searchKey, searchTerms, matchesTerms, labelCodes, homeCountryCodes, homeGroup, viewerTags } from './name.js';
import { poster } from './poster.js';
import { wireModal } from './modal.js';
import { MediaFilters } from './mediafilters.js';
import { listOrder, orderTitles } from './listorder.js';
import { bindTile, handleTileKey } from './tilekeys.js';

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
import { applyTheme, earlyTheme, onSystemTheme, renderTheme } from './theme.js';
import { wirePickers } from './picker.js';
import { nf } from './format.js';
import { t, applyStatic, setLanguage, loadLanguage } from './i18n.js';
import { askRecordingConsent, closeRecordingConsent, loadRecordingList, openRecordings, retryPlayback, toggleRecordNow } from './recordingsui.js';
import { offerXtream, renderAccountList } from './accountsui.js';
import { loadNotifying, loadReminders, reminders, setNotifying, showReminders, watchAsked } from './remindersui.js';
import { renderInfoStrip } from './infostrip.js';
import { applyListLayout, gridColumns, isWatched, nameCleanerFor, onEpgUpdated, renderRow, restoreListView, listName, shownName, toggleFavorite, toggleWatched, usesGrid, watchGridWidth } from './coversui.js';
import { closeDetail, crumbLabel, episodesOfSeason, openItem, openSeries, renderDetail } from './seriesui.js';
import { closeGuide, favoritesChanged, focusGrid, grid, guideFavorites, guideOpen, openGuide, programmeSearch, renderGuideGroups, restoreGuideFavorites, setGuideFavorites, toggleGuide, wirePhoneGuide } from './guideui.js';

import { ensureFull, orderList, renderEmptyState, renderListInfo, wireSubcatsKeys, wireSubcatsResize } from './topicbar.js';
import { askExternal, nameExternalItem, playExternal } from './externalui.js';
import { keepScreenOnWhilePlaying } from './wakelock.js';
import { $, el } from './dom.js';
import { state, TYPE_KIND, unit, kindLabel, KIND_ORDER, KIND_INDEX, kindGroup, ROW_H, setRowHeight, listNavigation, isCollection, tabType, isAbort, same, resetting, startReset, connecting, setConnecting, provide } from './state.js';
import { categoryCountsFor, collectionItems, favCategoryEntry, isFavorite, isUnfinished, kindIndex, loadGroupItems, openFavCategory, refreshCatalogue, refreshWhenStale, removeFromHistory, removeUpcoming, renderSubcats, upcomingCount, sectionsFor, toggleFavCategory } from './collections.js';
import { renderSecondItem, secondFor, secondOffered } from './secondui.js';
import { clickPicture, enterFullscreen, moreItems, renderScreenButton, renderSeriesFavorite, toggleFullscreen, toggleMoreMenu, togglePause, toggleScreen, wireMediaSession } from './playercontrols.js';
import { wireTopMenu } from './topmenu.js';
import { wireScrollHints } from './scrollhint.js';
import { channelsByFavourite, filterChannels, placeListFilters, wireListFilters } from './listfilters.js';
import { oneCopyEach, titleKey } from './titlemeta.js';
import { cancelProgress, hideProgress, progressCtrl, progressSignal, showProgress, updateProgress } from './progressdialog.js';
import { openHelp } from './help.js';
import { copyUrl, toast } from './toast.js';
import { applyLocale, renderIdleOverlay } from './languageui.js';
import { fitIdleHome, paintIdleStars, watchInterest } from './idlehome.js';
import { accountProblem, addOverlayAction, playItem, playback, renderNowSub, showOverlayActions, tabs } from './playing.js';
import { applySubtitleLook, chooseAudio, chooseSubtitle, cycleAudio, goHome, leavePlayback, stepSubtitleSize, toggleSubtitleLook } from './tracksui.js';
import { nextEpisode, playEpisode } from './nextepisode.js';
import { adoptSyncedAccount, configured, offerUpdate, openSetup, renderSyncBox, setupDirty, showStoredSettings, sync, wireSetup, renderThemeAuto } from './setupui.js';

// Live channels are read through js/streamhub.js, so that a recording of
// the channel on screen shares the player's connection.
installFetchTap();

let SEP_H = 32;

const catalogueSearch = new CatalogueSearch(el.search, $('search-clear'), {
  state, refresh: () => refreshRows(), renderSidebar, isCollection,
  onSearch: () => { if (!guideOpen) playerLayout.showBrowse(); },
});
const playerLayout = new PlayerLayout(el.main, {
  browse: $('compact-browse'), watch: $('compact-player'), list: el.list, video: el.video, closeGuide,
});
function updatePlayerLayout() {
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

async function connect({ silent = false } = {}) {
  const run = ++connectRun;
  const stale = () => run !== connectRun;
  programmeSearch.clear();
  if (guideOpen) closeGuide();
  // The strip of a connection being replaced: its requests are let go,
  // and the new one gets a strip of its own to cancel.
  if (connecting && progressCtrl) { progressCtrl.abort(); hideProgress(); }
  const config = state.config;
  try {
    if (!store.isConfigured(config)) { setConnecting(false); openSetup(); return false; }
    setConnecting(true);
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
    setConnecting(false);
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
    if (playlist && !problem) offerXtream(source.catalogue?.xtream).catch(() => {});
    return true;
  } catch (err) {
    if (stale()) return false;
    setConnecting(false);
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
function accountAddress(config) {
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


/**
 * A list that could not be fetched — a group, a series, the whole list —
 * is the list's business, not the player's: the overlay would cover a
 * picture that is playing perfectly well. Over rows a toast says what
 * happened; where there are no rows, the message takes their place with a
 * way to try again.
 */
function showListError(err, retry) {
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

function showListCancelled(retry) {
  finishListLoad();
  if (state.rows.length) { toast(t('progress.cancelled')); return; }
  el.list.querySelector('.empty')?.remove();
  el.list.appendChild(emptyState(t('progress.cancelled'), '', { label: t('player.retry'), onClick: retry }));
}

function beginListLoad({ keepScroll = false } = {}) {
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
  if (address) offerAccess(address, actions, () => connect(), { explain: true });
  console.error('[iptv] yhteysvirhe', err);
}

/**
 * A missing host permission looks like the same network error as a server
 * that is down, so the cause cannot be deduced — check the permission and
 * offer to grant it only when it really is missing.
 *
 * explain adds the reason to the overlay's text. Only the connection's
 * error asks for it: after a failed stream the account's own explanation
 * (explainFailure in js/playing.js) is still on its way and writes the text
 * only while it is the one it left, so a sentence added here first cost the
 * viewer the account's word and the Play here of another tab's stream.
 */
async function offerAccess(url, actions, onGranted, { stream = false, explain = false } = {}) {
  if (!url) return;
  if (!(await hasAccess(url))) {
    if (el.overlay.hidden) return;            // tilanne ehti vaihtua
    // "The server did not answer" over a button that asks for access would
    // leave the viewer to work out that the two belong together.
    const why = t('error.grant.why', { origin: hostOf(url) });
    if (explain && !el.overlayText.textContent.endsWith(why)) el.overlayText.textContent = `${el.overlayText.textContent} ${why}`.trim();
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
  state.seen = await store.loadSeen();
  state.channelPrefs = await store.loadChannelPreferences();
  state.interests = await store.loadInterests();
  await loadReminders();
}

/**
 * The tab moves to another account. What is playing stops first: its
 * address, its Retry, its resume point and the history entry it makes all
 * belong to the account being left, and the resume point is saved there.
 */
async function adoptAccount(config) {
  if (state.playing) leavePlayback();
  state.config = config;
  store.useAccount(config);
  lastChannel = previousChannel = null;
  await loadLists();
}


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
      else {
        // A copy starred in another tab may be the one a film's card should
        // now be (one card a title keeps the starred copy): the films' and
        // the series' lists are drawn again, the others repaint their stars.
        // Not when "Show only favourites" is on: favouriteChanged draws it.
        if ((state.tab === 'movie' || state.tab === 'series') && !mediaFilters.favouritesOnly) refreshRows({ keepScroll: true });
        else if (state.tab !== 'movie' && state.tab !== 'series' && !(state.tab === 'live' && channelsByFavourite())) vlist.refresh();
        renderCategories(); renderSubcats();
      }
      favouriteChanged();
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
  } else if (name === 'seen') {
    const marks = value || {};
    if (same(marks, Object.fromEntries(state.seen))) return;
    state.seen = new Map(Object.entries(marks));
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
  toast(t('account.elsewhere', { name: store.accountLabel(config) }), {
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


/**
 * Reset everything in another tab: storage has been emptied under this one.
 * What it holds in memory would be written straight back — the next resume
 * point, a favourite — so it starts again as well, empty.
 */
function storageCleared() {
  if (resetting) return;
  startReset();
  playback.stop();
  location.reload();
}

/**
 * A provider that moves — another domain, port or scheme — is the same
 * account to the viewer, but its lists are kept by address. The same user
 * name at a new address that has nothing of its own is offered the old
 * address's lists; they are copied, and stay under the old address too.
 */
async function offerLists(previous, config) {
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
        if (state.lib) await showChannelChoices();
        if (!state.playing && !el.idleHome.hidden) renderIdleOverlay();
        toast(t('setup.lists.brought'));
      },
    },
  });
}

/* ================================================================= views */


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
  // Each tab's group as well: only the open tab's used to be kept, and
  // Movies came back at its first country after a restart although Finland
  // had been chosen there. A group gone by then is dropped in activateTab.
  const groups = Object.fromEntries(Object.entries({ ...state.lastGroup, [state.tab]: state.group })
    .filter(([, group]) => group === null || typeof group === 'string'));
  const view = { tab: state.tab, group: state.group, sub: state.sub, kind: state.kind, groups };
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
 * #/favorites and #/favorites/- are not the same place.
 */
function currentRoute() {
  const own = ownRoute();
  if (own) return own;
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
  // The channel, while it is in the list on screen: another group or a
  // search leaves it out, and coming back puts it in again.
  if (state.tab === 'live' && !searching && !state.detail && state.routeChannel != null
    && state.rowIndex.has(`0:${state.routeChannel}`)) view.channel = state.routeChannel;
  if (state.tab === 'movie' && !searching && !state.detail && state.routeMovie != null
    && state.rowIndex.has(`1:${state.routeMovie}`)) view.movie = state.routeMovie;
  // The guide is a mode over the channel list, and the address names both.
  if (guideOpen && state.tab === 'live') view.guide = true;
  for (let detail = state.detail; detail; detail = detail.back) {
    if (detail.view === 'series') view.series = detail.item.id;
    else if (detail.view === 'category') view.cat = detail.entry.id;
  }
  return view;
}

// What is playing and the place it was started from, see ownRoute.
let started = { item: null, place: '' };

/**
 * The address of a film, a channel or a series opened from outside the
 * list on screen: a tile under the picture (another copy, a sequel), the
 * start page, a series from the channels' tab. It is in its own list, by
 * the group it is filed in, and a reload or a shared address stands on it
 * there. Without this the address named the list beside it and left the
 * film out, as the list did not hold it. It holds until the viewer goes
 * somewhere else in the sidebar; then the list is the place again.
 */
function ownRoute() {
  if (!state.lib || guideOpen || state.query) return null;
  const chain = [];
  for (let detail = state.detail; detail; detail = detail.back) chain.push(detail.view, detail.item?.id ?? detail.entry?.id);
  const place = JSON.stringify([state.tab, state.group, state.sub, state.kind, ...chain]);
  if (state.playing !== started.item) started = { item: state.playing, place };
  const groupOf = (type, item) => {
    const group = (item.cats || []).map((cat) => groupOfType(type).get(cat)).find(Boolean);
    return group && visibleGroups(type).some((g) => g.name === group) ? group : null;
  };
  const series = state.detail?.view === 'series' ? state.detail.item : null;
  if (series && !['series', 'fav', 'recent'].includes(state.tab)) {
    return { tab: 'series', group: groupOf('series', series), series: String(series.id) };
  }
  const item = state.playing;
  if (!item || state.detail || state.catchup || started.place !== place) return null;
  if (item.k === 1 && !(state.tab === 'movie' && state.rowIndex.has(`1:${item.id}`))) {
    return { tab: 'movie', group: groupOf('movie', item), movie: String(item.id) };
  }
  if (item.k === 0 && !(state.tab === 'live' && state.rowIndex.has(`0:${item.id}`))) {
    return { tab: 'live', group: groupOf('live', item), channel: String(item.id) };
  }
  return null;
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
function updateAddress() {
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

async function goToRoute(route) {
  if (guideOpen) closeGuide();
  catalogueSearch.reset({ restore: false });
  if (route.group === undefined) delete state.lastGroup[route.tab];
  else state.lastGroup[route.tab] = route.group;
  if (route.kind === undefined) delete state.lastKind[route.tab];
  else state.lastKind[route.tab] = route.kind;
  storedSub = route.sub ?? null;
  routeDetail = pendingDetail(route);
  const arrival = landing(route.tab);
  await activateTab(route.tab, { restore: true });
  await restoreDetail(arrival);
}

// The drill-down an address carried, waiting for the list it belongs to.
// Like the topic above, it belongs to the one restore that follows the
// load rather than to every tab switch after it.
let routeDetail = null;
const pendingDetail = (route) => (route.series || route.cat || route.channel || route.movie || route.guide
  ? { series: route.series ?? null, cat: route.cat ?? null, channel: route.channel ?? null, movie: route.movie ?? null, guide: route.guide === true }
  : null);
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
  // A channel: the list stands on it, without playing it (see route.js).
  if (pending.channel && state.tab === 'live') {
    const index = state.rowIndex.get(`0:${pending.channel}`);
    if (index != null) {
      state.routeChannel = pending.channel;
      state.cursor = index;
      vlist.scrollToIndex(index);
      vlist.refresh();
    }
  }
  // A film the same way: the list stands on it, and Enter plays it.
  if (pending.movie && state.tab === 'movie') {
    // Another copy of a title stands on the title's card, whose page has
    // the copies (one card a title, js/titlemeta.js).
    const copy = state.titleRows.find((x) => x.k === 1 && String(x.id) === pending.movie);
    const card = copy && state.rows.find((x) => x.k === 1 && titleKey(x) === titleKey(copy));
    if (card) pending.movie = String(card.id);
    const index = state.rowIndex.get(`1:${pending.movie}`);
    if (index != null) {
      state.routeMovie = pending.movie;
      state.cursor = index;
      vlist.scrollToIndex(index);
      vlist.refresh();
    }
  }
  // The guide, over the channel list the address named.
  if (pending.guide && state.tab === 'live') {
    await openGuide();
    return;
  }
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

async function activateTab(tab, { restore = false } = {}) {
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
  // The channels open at the browser's country when the catalogue has it
  // and the viewer has not chosen countries of their own, whose order is
  // theirs: with the browser in Finnish the list used to open at the first
  // country of the provider's order, which says nothing about the viewer.
  if (type && state.group == null && !chosen && state.lib && !state.lib.isFull(type)) {
    const groups = visibleGroups(type);
    if (groups.length) state.group = type === 'live' && !chosenCountries() ? homeGroup(groups, browserTags()) : groups[0].name;
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
async function refreshRows({ keepScroll = false, returnPosition = null, restoreFocus = false } = {}) {
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
      // heading three screens down is not where it is looked for. In the
      // history's name order the names decide alone, grouped by type as
      // the favourites are.
      // The reminders to come stay at the head through either order.
      const upcoming = rows.filter((it) => it.k === 'r');
      rows = rows.filter((it) => it.k !== 'r');
      if (state.tab === 'recent' && listOrder(state.settings, 'recent') === 'watched') rows = [...rows.filter(isUnfinished), ...rows.filter((it) => !isUnfinished(it))];
      else if (state.tab === 'recent' && state.kind == null) rows = [...rows].sort((a, b) => kindIndex(a) - kindIndex(b));
      rows = [...upcoming, ...rows];
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
      let items = await loadGroupItems(type, state.group, current);
      if (!current()) return null;
      // A group is said to be empty only once the whole list agrees: its
      // categories asked one by one came back empty for a country that was
      // full of channels (Finland, in Orion, on a first open), and the list
      // said "Category is empty" until All had been opened.
      if (!items.length && state.lib.group(type, state.group)?.cats.length && !state.lib.isFull(type)) {
        if (!(await ensureFull(type, t('progress.reason.all'), current)) || !current()) return notLoaded();
        items = await loadGroupItems(type, state.group, current);
        if (!current()) return null;
      }
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
  rows = visibleRows(rows, { everyGroup: searchesEveryGroup() });
  if (type === 'live' && !state.query && !state.detail && !isCollection()) {
    rows = filterChannels(withoutInternational(rows));
  }
  // The setting says where the list starts; the personal arrangement, made
  // in Organize channels, has the last word over it.
  if (channelList) {
    rows = sortChannels(rows, listOrder(state.settings, 'live'), channelLabel());
  }
  // The films and the series in the order chosen at their foot (A–Z is
  // the order the rows already have); a search keeps its hits' order.
  const titleList = orderList();
  if (titleList === 'movie' || titleList === 'series') {
    rows = orderTitles(rows, listOrder(state.settings, titleList), (item) => mediaFilters.factsOf(item));
  }
  const filterType = !isCollection() && !state.detail && (type === 'movie' || type === 'series') ? type : null;
  // One card a title: its other copies are on its own page (js/infostrip.js).
  state.titleRows = rows;
  if (filterType) rows = oneCopyEach(rows, isFavorite);
  rows = mediaFilters.apply(rows, filterType, { lengths: lengthsRead() });
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

const mediaFilters = new MediaFilters(/** @type {HTMLDetailsElement} */ ($('media-filters')), {
  onChange: ({ keepScroll = false } = {}) => { if (!keepScroll) state.cursor = -1; return refreshRows({ keepScroll }); },
  detailsFor: (item) => item.details || state.lib?.details.get(`${item.k === 1 ? 'vod' : 'series'}:v2:${item.id}`),
  activeHost: $('active-media-filters'),
  isFavourite: isFavorite,
  reading: () => Boolean(state.lib && (state.lib.movieWorkers > 0 || state.lib.movieQueue.length > 0)),
});

/**
 * After a star is given or taken anywhere (a list, the player, the start
 * page, another tab): the list follows when "Show only favourites" narrows
 * it, or when the starred film is a copy the list did not show (one card a
 * title keeps the starred copy, js/titlemeta.js); the start page's cards,
 * the series page's star and the guide's favourites follow. The one hook
 * for all of them.
 * @param {object} [item] the title starred, when it is one
 */
function favouriteChanged(item) {
  const copyAway = item && (item.k === 1 || item.k === 2) && !state.rowIndex.has(store.itemKey(item))
    && state.titleRows.some((row) => row.k === item.k && String(row.id) === String(item.id));
  if (mediaFilters.favouritesOnly || (channelsByFavourite() && state.tab === 'live') || copyAway) refreshRows({ keepScroll: true });
  paintIdleStars();
  renderSeriesFavorite();
  // The guide's favourites view follows as well (js/guideui.js).
  favoritesChanged();
}

/**
 * The rows on screen. Everything painted from them follows in one call, so
 * that nothing on screen can belong to a list that is no longer shown.
 */
function showRows(rows, { keepScroll = false, loading = false } = {}) {
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
  // The fold over the channels before the list measures itself: shown
  // after, it pushed the list down under a scroll already made, and the
  // row the list stood on went out of sight (it is hidden while a list
  // loads, see placeListFilters).
  renderSubcats();
  placeListFilters(rows);
  vlist.setCount(rows.length, {
    keepScroll,
    heightAt: state.sections.size ? (i) => ROW_H + (state.sections.has(i) ? SEP_H : 0) : null,
  });
  // The guide shows the same set as the list, so search and group selection
  // narrow it without a filter of its own.
  if (guideOpen && state.tab === 'live' && !guideFavorites) grid.setChannels(rows.filter((it) => it.k === 0));
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
function renderSidebar() {
  if (isCollection()) renderKinds();
  else renderCategories();
  markGroups();
  renderCountriesButton();
}

// The sidebar's old "Show favourites only" box, as stored before "Filter
// countries" took it in: read once, for the mode of a type that has none
// of its own yet (groupFilterMode).
let groupsFavOnly = false;

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
  const words = live ? 'countries' : 'categories';
  $('btn-countries-text').textContent = chosen && groupFilterMode(type) === 'favorites' ? t(`${words}.button.favorites`)
    : live ? (chosen ? t('countries.button.chosen', { count: chosen.size, n: nf.format(chosen.size), total }) : t('countries.button'))
    : (chosen ? t('categories.button.chosen', { n: nf.format(chosen.size), total }) : t('categories.button'));
  // The words may be cut short where the sidebar is narrow (css/layout.css).
  button.title = $('btn-countries-text').textContent;
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
  $('groups-empty').hidden = true;
  // What was watched or starred; the reminders to come are counted apart.
  const upcoming = upcomingCount();
  const items = collectionItems().filter((it) => it.k !== 'r');
  // An empty collection needs no filter: the empty-state text says more
  // than a row reading "All 0". The phone's menu goes with it: left as it
  // was, it went on offering the countries of the tab before (Orion).
  if (!items.length && !upcoming) {
    el.groups.replaceChildren();
    fillGroupPicker([], '');
    $('group-picker').hidden = true;
    paintGroupPickerStar(null);
    return;
  }

  const counts = new Map();
  for (const item of items) { const k = kindGroup(item.k); counts.set(k, (counts.get(k) || 0) + 1); }

  const frag = document.createDocumentFragment();
  frag.appendChild(categoryRow(
    { id: null, name: t('groups.all'), count: items.length, active: state.kind == null, all: true, icon: KIND_ICONS.all },
    selectKind,
  ));
  // The reminders set in the guide, a kind of the history's own: first
  // under All, as they are first in the list.
  if (upcoming) {
    frag.appendChild(categoryRow(
      { id: 'r', name: kindLabel('r'), count: upcoming, active: state.kind === 'r', icon: HISTORY_ICONS.upcoming },
      selectKind,
    ));
  }
  for (const kind of KIND_ORDER) {
    const count = counts.get(kind) || 0;
    if (count === 0) continue;
    frag.appendChild(categoryRow(
      { id: kind, name: kindLabel(kind), count, active: state.kind === kind, icon: KIND_ICONS[kind] },
      selectKind,
    ));
  }
  el.groups.replaceChildren(frag);
  fillGroupPicker([...(upcoming ? ['r'] : []), ...KIND_ORDER.filter((k) => counts.get(k))].map((k) => [kindLabel(k), String(k)]),
    state.kind == null ? '' : String(state.kind));
  paintGroupPickerStar(null);
}

/**
 * The bar under the picture on one line. With an audio track's selector
 * beside the format's and the subtitles', the row ran out of room and broke
 * onto a second line; the format's words ("Playback mode:") go first, and
 * its mark and value stay. Tried with the words each time anything changes,
 * so that they come back when there is room again.
 */
function fitNowbar() {
  const bar = /** @type {HTMLElement} */ (document.querySelector('.nowbar'));
  const row = bar?.querySelector('.now-actions');
  if (!bar || !row) return;
  // "Playback mode:" before the value, in the select's box: its left
  // padding follows the label's width, whatever the language; none where
  // the stylesheet leaves the label out.
  const modeLabel = $('mode-label');
  const pad = () => {
    el.mode.style.paddingLeft = modeLabel.offsetWidth ? `${modeLabel.offsetLeft + modeLabel.offsetWidth + 6}px` : '';
  };
  new ResizeObserver(pad).observe(modeLabel);
  // Whether the row holds its controls at their own widths, nothing
  // shrunk: the selectors may give way to a stub (css/playback.css), and a
  // row that fits only so had its values cut short while the words stayed.
  // The padding is set before the measure: left to the label's observer,
  // it came a moment after, the row was measured with the label shown but
  // without the room it takes, and "Playback mode:" stayed on a row too
  // short for it (CI, 1.10.1).
  const oneLine = () => {
    bar.classList.add('measuring');
    pad();
    const fits = row.scrollWidth <= row.clientWidth + 1;
    bar.classList.remove('measuring');
    return fits;
  };
  let pending = 0;
  const fit = () => {
    pending = 0;
    bar.classList.remove('tight');
    if (!oneLine()) { bar.classList.add('tight'); pad(); }
  };
  // In the next frame: the class changes the sizes being observed, and
  // changed inside the observer's callback that is a loop the browser warns of.
  const later = () => { if (!pending) pending = requestAnimationFrame(fit); };
  new ResizeObserver(later).observe(bar);
  new MutationObserver(later).observe(row, { subtree: true, attributes: true, attributeFilter: ['hidden'], childList: true });
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

function renderCategories() {
  // The favourites and the history list types, not groups: a favourite
  // changed while one of them is open (another tab, a sync) redrew the
  // countries here, and the phone's menu offered them under Favourites.
  if (isCollection()) { renderKinds(); return; }
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
  const groups = visibleGroups(type).filter((g) => (!filter
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
  // A filter that leaves nothing says so, rather than an empty column.
  const none = Boolean(filter) && !groups.length;
  $('groups-empty').hidden = !none;
  $('groups-empty').replaceChildren(...(none ? [emptyState(t('empty.nohits'), t('empty.nohits.text', { query: state.categoryFilter.trim() }), null, 'search')] : []));
  const starred = new Set(visibleGroups(type).filter((g) => isFavorite(favCategoryEntry(type, g.name, null))).map((g) => g.name));
  fillGroupPicker(visibleGroups(type).map((g) => [g.name, g.name]), state.group ?? '', starred, t(genres ? 'groups.genres.aria' : 'groups.aria'));
  paintGroupPickerStar(type);
}

/**
 * The sidebar's choice as a menu, for a window with no room for a sidebar.
 * Built from whatever the sidebar has just been built from, so the two can
 * never disagree about what is on offer or what is chosen.
 */
function fillGroupPicker(options, chosen, starred = new Set(), restLabel = '') {
  const picker = $('group-select');
  const option = ([label, value]) => new Option(label, value);
  // The favourites first, under a heading of their own, as the sidebar's
  // stars are seen at a glance: on a phone the menu is the only list of the
  // countries, and a favourite was otherwise found by scrolling past dozens.
  const favourites = options.filter(([, value]) => starred.has(value));
  const section = (label, items) => {
    const group = document.createElement('optgroup');
    group.label = label;
    group.append(...items.map(option));
    return group;
  };
  picker.replaceChildren(option([t('groups.all'), '']), ...(favourites.length
    ? [section(t('favs.title'), favourites), section(restLabel, options.filter(([, value]) => !starred.has(value)))]
    : options.map(option)));
  picker.value = String(chosen);
  $('group-picker').hidden = !state.lib && !isCollection();
}

/**
 * The star beside the menu: the chosen group's, as on its sidebar row. A
 * menu's options cannot hold a button, so in a window too narrow for the
 * sidebar there was no way to star a country at all (measured on a phone,
 * Orion). Unlike the rows' stars it is in the tab order: there is one.
 * @param {string|null} type 'live', 'movie' or 'series'; null where the sidebar lists types, not groups
 */
function paintGroupPickerStar(type) {
  const button = /** @type {HTMLButtonElement} */ ($('group-picker-star'));
  const name = type && state.group != null && state.lib && !isCollection() ? state.group : null;
  button.hidden = name == null;
  if (name == null) return;
  button.dataset.name = name;
  setStar(button, isFavorite(favCategoryEntry(type, name, null)));
}

async function selectGroup(name) {
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

function visibleGroups(type) {
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
 * What a search of `type` leaves out by "Filter countries" or "Filter
 * categories", in words ("Countries searched: 3/12"), or null when the
 * filter lets every group through. A search that finds nothing says it, so
 * that a channel of a country left out is not taken for one the provider
 * does not have, and offers a search of them all.
 */
function searchLimit(type) {
  const chosen = groupFilter(type);
  if (!chosen) return null;
  return t(type === 'live' ? 'search.limited.countries' : 'search.limited.categories',
    { n: nf.format(chosen.size), total: nf.format(state.lib.groups[type].length) });
}

/** The search on show asked to run past the groups' filter ("Search all"): the words it was asked for, per tab. */
function searchesEveryGroup() {
  return Boolean(state.query) && state.searchAll === `${state.tab}\n${state.query}`;
}

/**
 * The live groups the viewer watches, or null for all of them. A chosen
 * country the provider no longer has does not count: were it the only
 * one, nothing at all would be shown.
 */
function chosenCountries() {
  return groupFilter('live');
}

const MODE_PREFS = { live: 'countriesMode', movie: 'movieCategoriesMode', series: 'seriesCategoriesMode' };
const LIST_PREFS = { live: 'countries', movie: 'movieCategories', series: 'seriesCategories' };

/**
 * How a type's groups are filtered ("Filter countries", "Filter
 * categories"): all, the favourite ones, or those chosen. A type with no
 * mode stored is as it was before the modes: chosen when a list was, the
 * favourite ones when the sidebar's old box was ticked, all otherwise.
 */
function groupFilterMode(type) {
  const stored = state.channelPrefs[MODE_PREFS[type]];
  if (stored) return stored;
  return (state.channelPrefs[LIST_PREFS[type]] || []).length ? 'chosen' : groupsFavOnly ? 'favorites' : 'all';
}

/**
 * The groups a type's filter lets through, or null for all of them: the
 * chosen ones, or the favourite ones (a starred country, or one holding a
 * starred topic). One the provider no longer has does not count, and
 * nothing left counts as all — a filter with nothing in it would empty
 * every list.
 */
function groupFilter(type) {
  const groups = state.lib?.groups[type];
  if (!groups) return null;
  const mode = groupFilterMode(type);
  const names = mode === 'chosen' ? state.channelPrefs[LIST_PREFS[type]] || []
    : mode === 'favorites' ? [...state.favorites.values()].filter((f) => f.k === 'c' && f.t === type).map((f) => f.g)
      : [];
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
  return groupFilter(type);
}

/** Category id → the name of the film or series group it is in. */
const groupOfCatByType = new WeakMap();
function groupOfType(type) {
  const groups = state.lib?.groups[type] || [];
  let map = groupOfCatByType.get(groups);
  if (!map) groupOfCatByType.set(groups, map = new Map(groups.flatMap((g) => g.cats.map((c) => [c.id, g.name]))));
  return map;
}

const groupOfCategory = new WeakMap();
/** Category id → the name of the live group it is in. */
function liveGroupOf() {
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
function visibleRows(rows, { everyGroup = false } = {}) {
  const prefs = state.channelPrefs;
  const visible = visibilityFilter(prefs);
  const groups = new Set(visibleGroups('live').map((g) => g.name));
  // everyGroup: a search the viewer asked to run past "Filter countries"
  // and "Filter categories" (searchLimit); what is hidden stays hidden.
  const chosen = isCollection() || everyGroup ? null : chosenCountries();
  const groupOf = chosen ? liveGroupOf() : null;
  // The films' and the series' categories, the same way, in the browsing
  // and the search; a favourite or the history keeps what was picked.
  const picked = isCollection() || everyGroup ? {} : { 1: chosenCategories('movie'), 2: chosenCategories('series') };
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
function withoutInternational(rows) {
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

const countryPicker = new CountryPicker(({ mode, chosen }) => saveChannelChoices({ ...state.channelPrefs, countries: chosen, countriesMode: mode }));
const hiddenList = new HiddenList((prefs) => saveChannelChoices({ ...state.channelPrefs, ...prefs }));

/**
 * The languages that say where the viewer is (js/name.js viewerTags and
 * homeCountryCodes): a language chosen in Settings first, then the
 * browser's own tags with their regions.
 */
function browserTags() {
  return viewerTags(state.settings?.lang, navigator.languages?.length ? navigator.languages : [navigator.language || '']);
}

function openCountryPicker({ first = false } = {}) {
  if (!state.lib) return;
  const codes = homeCountryCodes(browserTags());
  const suggested = state.lib.groups.live.filter((g) => labelCodes(g.name).some((c) => codes.includes(c))).map((g) => g.name);
  countryPicker.show({
    groups: state.lib.groups.live,
    counts: state.lib.groupCounts('live'),
    chosen: state.channelPrefs.countries,
    // The first time starts at all of them, the browser's own countries
    // ticked below as a suggestion: a tick chooses them, Save keeps all.
    mode: first ? 'all' : groupFilterMode('live'),
    favorites: favoriteGroups('live'),
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
    mode: groupFilterMode(type),
    favorites: favoriteGroups(type),
    onSave: ({ mode, chosen }) => saveChannelChoices({ ...state.channelPrefs, [key]: chosen, [MODE_PREFS[type]]: mode }),
    texts: { title: 'categories.title', help: 'categories.help', filter: 'categories.filter', all: 'categories.all', words: 'categories' },
  });
}

/** The groups of a type with a star, or holding a starred topic, by name. */
function favoriteGroups(type) {
  return [...new Set([...state.favorites.values()].filter((f) => f.k === 'c' && f.t === type).map((f) => f.g))];
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

async function openHiddenList() {
  if (!state.lib) return;
  if (state.channelPrefs.hiddenChannels.length && !await ensureFull('live', t('hidden.loading'))) return;
  const full = state.lib.full.live || [];
  hiddenList.show(state.channelPrefs, (id) => full.find((item) => String(item.id) === id) || null,
    (id) => state.lib.categoryName('live', id));
}

/** Whether a row has a menu: a channel, a film, an entry of the history. */
const hasItemMenu = (item) => item.k === 0 || item.k === 1 || (state.tab === 'recent' && !state.detail && item.k !== 'c');

/**
 * The actions on a row: a film marked seen, out of the history when it is
 * in it, a channel into the second picture, and a channel hidden. Which
 * rows have a menu at all is hasItemMenu's to say.
 */
function openItemMenu(item, at) {
  // A reminder's row at the head of the history: to its channel, or the
  // reminder taken back.
  if (item.k === 'r') {
    openRowMenu(at, [
      { label: t('guide.watch'), onClick: () => openItem(item) },
      { label: t('guide.remind.cancel'), danger: true, onClick: () => removeUpcoming(item) },
    ], { label: item.n, returnFocus: el.list });
    return;
  }
  const prefs = state.channelPrefs;
  const id = String(item.id);
  const name = listName(item);
  // No favourite here: every row carries its star, and the same thing
  // twice made the menu longer without adding a way to do it.
  const items = [];
  // A film's ✓ by hand: one seen elsewhere, or one stopped near the end.
  if (item.k === 1) items.push({ label: t(isWatched(`1:${id}`) ? 'row.seen.unmark' : 'row.seen.mark'), onClick: () => toggleWatched(item) });
  if (state.tab === 'recent' && !state.detail) items.push({ label: t('row.remove.history'), onClick: () => removeFromHistory(item) });
  if (secondOffered(item)) items.push({ label: t('row.second'), onClick: () => secondFor(item, at) });
  if (item.k === 0) {
    items.push({
      label: t('row.hide'), danger: true,
      onClick: () => changeChannelChoices({ ...prefs, hiddenChannels: [...prefs.hiddenChannels, id] }, t('row.hidden', { name })),
    });
  }
  if (items.length) openRowMenu(at, items, { label: name, returnFocus: el.list });
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
  setRowHeight(watchLength('--row-h', ROW_H, (px) => { setRowHeight(px); resize(); }));
  SEP_H = watchLength('--sep-h', SEP_H, (px) => { SEP_H = px; resize(); });
  resize();
}

const vlist = new VirtualList(el.list, ROW_H, renderRow, {
  onPaint: () => listNavigation.sync(),
  onVisible: (first, last) => {
    // In guide mode the list is hidden, and its visible rows would take the
    // programme-data queue away from the grid.
    if (state.epg && !guideOpen) state.epg.setVisible(state.rows.slice(first, last));
    warmDurations(guideOpen ? [] : state.rows.slice(first, last));
  },
});

/**
 * The films' lengths read for the rows on screen, two at a time
 * (js/library.js): the provider gives a film's length with its details
 * only, one request a film. A length chosen does not read ahead: the films
 * of unknown length stay in the list, at its end, and drop out once their
 * lengths are known and do not fit (js/mediafilters.js).
 */
function warmDurations(visible) {
  const lib = state.lib;
  if (!lib) return;
  // The last length read: the list's spinner and its words stop.
  lib.onMoviesIdle = () => { if (state.lib === lib) mediaFilters.metadataChanged(); };
  // Across every film (All, or a search of them all) only the lengths kept
  // from before are put on the rows: a scroll through thousands of films
  // asked the provider for each one's details.
  lib.warmMovieDurations(visible, (id, info) => {
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
  }, { fetch: lengthsRead() });
}

/** Whether the films' lengths are read and filtered by: in a category, not across them all. */
function lengthsRead() {
  return state.group != null;
}

/* --------------------------------------------------------- Chromecast */

const cast = new Cast(el.video, renderCastState);

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
  if (item.k === 'r') return;                     // a reminder's row has no star
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
  // Delete on a reminder's row takes the reminder back, as its cross does.
  if (item.k === 'r') { removeUpcoming(item); return; }
  removeFromHistory(item);
  toast(t('row.removed.history', { name: shownName(item) }));
}

function moveCursor(delta) { listNavigation.move(delta, vlist); }

function playRelative(delta) {
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

function noteChannel(item) {
  state.routeChannel = String(item.id);
  if (lastChannel && String(lastChannel.id) !== String(item.id)) previousChannel = lastChannel;
  lastChannel = item;
}

/**
 * A channel in its own list: its country chosen in the sidebar, the list
 * standing on it, the guide closed. Playing goes on in the big player, or
 * starts if something else was playing. The guide's "Go to channel".
 */
async function goToChannel(channel) {
  if (guideOpen) closeGuide();
  playerLayout.showBrowse();
  const visible = visibleGroups('live');
  const group = (channel.cats || []).map((cat) => groupOfType('live').get(cat)).find(Boolean) ?? null;
  // A country the viewer has not chosen is not in the sidebar: All has it.
  const target = group && visible.some((g) => g.name === group) ? group : null;
  if (state.tab !== 'live') await activateTab('live');
  if (state.group !== target || state.sub != null || state.detail || state.query) await selectGroup(target);
  const id = String(channel.id);
  const index = state.rowIndex.get(`0:${id}`);
  if (index != null) {
    state.cursor = index;
    vlist.scrollToIndex(index);
    vlist.refresh();
  }
  if (!(state.playing?.k === 0 && !state.catchup && String(state.playing.id) === id)) await playItem(channel);
  state.routeChannel = id;
  updateAddress();
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
  // The skip link's way to the list: the guide covers it and a narrow
  // window may show the player's pane instead, so both make way first.
  $('skip-list').addEventListener('click', () => {
    if (guideOpen) closeGuide();
    playerLayout.showBrowse();
    el.list.focus();
  });
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


  let filterTimer = null;
  $('group-picker-star').addEventListener('click', () => {
    const type = tabType();
    if (!type || state.group == null) return;
    const entry = favCategoryEntry(type, state.group, null);
    toggleFavCategory(entry);
    toast(t(isFavorite(entry) ? 'fav.added' : 'fav.removed', { name: state.group }));
  });
  $('group-select').addEventListener('change', (e) => {
    const value = e.target.value;
    if (!isCollection()) return selectGroup(value || null);
    // The collections filter by type, and a type is 'c', 0, 1 or 2 — the
    // menu carries them as text and they go back as they came.
    return selectKind(value === '' ? null : ['r', ...KIND_ORDER].find((k) => String(k) === value) ?? null);
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
  $('btn-countries').addEventListener('click', () => (tabType() === 'live' ? openCountryPicker() : openCategoryPicker(tabType())));
  $('f-countries').addEventListener('click', () => openCountryPicker());
  new ResizeObserver(() => fitIdleHome()).observe(el.overlay);
  onSystemTheme(() => { renderTheme(state.settings.theme); renderThemeAuto(); });
  // The button turns what is on screen into the other one, and so leaves
  // "the system's" for a choice of its own; Settings has the way back.
  $('btn-theme').addEventListener('click', async () => {
    const theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    state.settings = { ...state.settings, theme };
    renderTheme(theme);
    state.settings = await store.saveSettings({ theme });
  });
  $('btn-screen').addEventListener('click', toggleScreen);
  wireTopMenu();
  wireScrollHints();
  document.addEventListener('fullscreenchange', renderScreenButton);
  renderScreenButton();
  wireModal($('help'), () => $('help').close());
  // The strip goes when the load stops, not when the key is pressed: a strip
  // that vanished on Esc would look as if the loading had finished.
  $('lp-cancel').addEventListener('click', cancelProgress);

  fitNowbar();
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
  wirePhoneGuide();
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
  $('btn-recordings-menu').addEventListener('click', openRecordings);
  $('recordings-close').addEventListener('click', () => $('recordings').close());
  $('f-record').addEventListener('change', askRecordingConsent);
  // The switch is the permission itself, asked of the browser in the click
  // and not kept with the settings: it shows what the browser answered.
  $('f-notify').addEventListener('change', async (event) => { event.target.checked = await setNotifying(event.target.checked); });
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

  el.more.addEventListener('click', () => { renderSecondItem(); toggleMoreMenu(); });
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
  // hang over the picture with no way back into it. Only a focus that has
  // gone somewhere: a tap on the menu's own button gives the button no
  // focus on the iPhone, the focus went to nothing, the menu closed — and
  // the same tap's click opened it again, so the button never closed it
  // (Orion). A press outside closes it below.
  el.morePop.addEventListener('focusout', (e) => {
    if (e.relatedTarget && !el.morePop.contains(e.relatedTarget) && e.relatedTarget !== el.more) toggleMoreMenu(false);
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
    // The guide's search the same way: the first Escape clears it and gives
    // the keys back to the grid, the next one closes the guide. The
    // browser's own clearing of a search field emptied the words and left
    // the results on screen.
    if (e.target === $('programme-query') && e.key === 'Escape' && guideOpen) {
      e.preventDefault();
      if (programmeSearch.active) { programmeSearch.clear(); focusGrid(); } else closeGuide();
      return;
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
    // A strip of tiles with the focus takes the keys that would otherwise
    // move or change the list: its own arrows, its tile's star and Delete.
    if (plain && handleTileKey(e)) { e.preventDefault(); return; }
    // The menu of the row the list stands on: the context-menu key, or
    // Shift+F10 where a keyboard has none.
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      const item = state.rows[state.cursor];
      if (item && hasItemMenu(item)) {
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
      if (e.key === 'Escape') {
        if (programmeSearch.active) { programmeSearch.clear(); focusGrid(); } else closeGuide();
        return;
      }
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

provide({
  vlist, mediaFilters, catalogueSearch, playerLayout, cast,
  refreshRows, showRows, renderSidebar, renderCategories, favouriteChanged, updateAddress, goToRoute, activateTab,
  visibleRows, visibleGroups, withoutInternational, groupOfType, liveGroupOf, chosenCountries, selectGroup,
  searchLimit, searchesEveryGroup, beginListLoad, showListError, showListCancelled, openItemMenu, openHiddenList,
  connect, adoptAccount, accountAddress, offerLists, offerAccess, browserTags,
  goToChannel, playRelative, noteChannel, updatePlayerLayout, sourceFor,
});

applyTheme(earlyTheme());
wirePickers();

async function init() {
  state.accounts = await store.loadAccounts();
  state.config = await store.loadConfig();
  await store.migrateAccountKeys(state.config);
  store.useAccount(state.config);
  state.settings = await store.loadSettings();
  renderTheme(state.settings.theme);
  const lang = store.interfaceLanguage(state.settings);
  await loadLanguage(lang);
  setLanguage(lang);
  nameExternalItem();
  applyLocale();
  applyStatic();
  catalogueSearch.render();
  updatePlayerLayout();

  watchRowHeights();
  wireSetup();
  wireUi();
  wireMediaSession();
  keepScreenOnWhilePlaying(el.video);
  wireSubcatsResize();
  wireSubcatsKeys();
  watchInterest();
  await loadLists();
  // Not waited for: the list of recordings has nothing to do with connecting.
  loadRecordingList().catch((err) => console.warn('[iptv] the recordings could not be read', err));
  store.watchStorage({ onList: showStoredList, onAccount: accountChangedElsewhere, onCleared: storageCleared });
  store.watchAccounts((accounts) => {
    state.accounts = accounts;
    if (el.setup.open) renderAccountList();
    adoptSyncedAccount(accounts);
  });
  store.watchSettings(showStoredSettings);
  store.watchSyncStatus(() => { if (el.setup.open) renderSyncBox(); });
  sync.start();
  el.mode.value = state.config.streamMode || 'auto';
  applySubtitleLook(state.settings);
  new SubtitleDisplay(el.video, el.subdisplay, el.videowrap);
  renderCastState();

  await loadNotifying();
  const ui = await store.loadUiState();
  groupsFavOnly = ui.groupsFavOnly === true;
  restoreGuideFavorites(ui.guideFavorites);
  // The address names this tab's place; the stored view names the place any
  // tab last settled on. A reload has an address and takes it, drill-down
  // and all. A player opened fresh from the toolbar icon has none, and the
  // stored view is what brings it back to where the last one was left.
  const route = parseRoute(location.hash);
  if (route) routeDetail = pendingDetail(route);
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
  // The other tabs' groups as they were left (rememberView); the address
  // or the stored view decides the open tab's.
  if (ui.groups && typeof ui.groups === 'object') {
    for (const [tab, group] of Object.entries(ui.groups)) if (group === null || typeof group === 'string') state.lastGroup[tab] = group;
  }
  if (start.group !== undefined) state.lastGroup[state.tab] = start.group;
  if (start.kind !== undefined) state.lastKind[state.tab] = start.kind;
  storedSub = start.sub ?? null;
  $('channel-tools').hidden = state.tab !== 'live' || !state.lib;
  if (typeof ui.subcatsHeight === 'number') state.subcatsHeight = ui.subcatsHeight;
  restoreListView(ui.listView);
  watchGridWidth();
  wireListFilters(ui, mediaFilters);
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
    renderEmptyState();
    openSetup();
    return;
  }
  await connect();
  // A reminder's notification may be what opened this player.
  watchAsked();
}

const CACHE_PURGE_DELAY_MS = 20000;

init();
