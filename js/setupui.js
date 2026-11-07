// Settings: the dialog's form (the connection, its kinds and fields, the
// settings, the subtitles' preview), Account & data (sync between
// computers, the storage used, the version and its update, resetting
// everything), and the wiring of all of it.
//
// Moved out of app.js. It takes the player's state, and the parts app.js
// builds, from js/state.js; what runs while the modules load here is the
// Sync object, built from js/sync.js alone; everything else waits until the
// player calls in.

import { $, el } from './dom.js';
import { caretWelcome } from './caret.js';
import { DEFAULT_LIFT, DEFAULT_SCALE, pictureHeight, subtitleLook } from './subdisplay.js';
import { LANGUAGES, localeTag, t } from './i18n.js';
import { Sync, loadSyncInfo, syncAvailable } from './sync.js';
import { api } from './browser.js';
import { applyLanguage, renderIdleOverlay } from './languageui.js';
import { applySubtitleLook, chooseSubtitleLook, lookOf, showSubtitleSize, toggleSubtitleLook } from './tracksui.js';
import { autoNext, renderStatBadge } from './nextepisode.js';
import { cacheClear, storageEstimate, wipeStorage } from './db.js';
import { canRecord, renderRecordingState } from './recordingsui.js';
import { clock, dateFmt, dateTimeFmt, megabytes, nf } from './format.js';
import { normalizeMac, normalizePortal } from './stalker.js';
import { parsePlaylistUrl, parseServer, pastedKind } from './xtream.js';
import { playback, tabs } from './playing.js';
import { playlistAddress } from './m3u.js';
import { refreshGuidePreview } from './guideui.js';
import { THEMES, renderTheme, resolveTheme } from './theme.js';
import { renderAccountList } from './accountsui.js';
import { hasAccess, requestAccess, requestAccessFor } from './permissions.js';
import { toast } from './toast.js';
import { wireModal } from './modal.js';
import * as store from './config.js';
import { accountAddress, adoptAccount, connect, offerLists, refreshRows, renderSidebar, resetting, same, startReset, state } from './state.js';

const FIELDS = ['scheme', 'host', 'port', 'username', 'password'];

/** Whether there is anything to connect with yet. */
export const configured = () => store.isConfigured(state.config);

/** "Automatic (dark)": the theme the system's mode comes to now, said again when it changes. */
export function renderThemeAuto() {
  $('f-theme').options[0].textContent = t('setup.theme.auto', { example: t(`setup.theme.${resolveTheme('system')}`).toLocaleLowerCase(localeTag()) });
}

/**
 * The settings, or — before there are any credentials — the one thing
 * that matters then. With nothing to connect with, sections would offer a
 * choice of rooms in a house with no door: the rail is left out, the title
 * says what the dialog is for, and Connection is all there is.
 *
 * Every open reads a fresh draft from saved values. Tab changes retain
 * it; Save commits it and Cancel discards it.
 */
export function openSetup({ section, adding = false } = {}) {
  editAccount(adding ? 'new' : 'current', { render: false });
  renderLanguageOptions();
  $('f-lang').value = state.settings.lang in LANGUAGES ? state.settings.lang : 'auto';
  renderThemeAuto();
  $('f-theme').value = THEMES.includes(state.settings.theme) ? state.settings.theme : 'system';
  renderClockOptions();
  $('f-clock').value = ['24', '12'].includes(state.settings.clock) ? state.settings.clock : 'auto';
  $('f-epg').checked = state.settings.epgEnabled;
  $('f-resume').checked = state.settings.resumeEnabled;
  $('f-autonext').checked = state.settings.autoNext;
  $('f-stats').checked = state.settings.statsEnabled;
  $('f-record').checked = state.settings.recordingEnabled === true;
  $('f-home-picks').checked = state.settings.homePicks !== false;
  $('f-home-continue').checked = state.settings.homeContinue !== false;
  $('f-home-recent').checked = state.settings.homeRecent !== false;
  $('f-record').disabled = !canRecord;
  $('f-international').checked = state.settings.showInternational;
  setupInitial = { ...state.settings, subtitleStyle: subtitleLook(state.settings).style, subtitleScale: subtitleLook(state.settings).scale, subtitleLift: subtitleLook(state.settings).lift };
  applySubtitleLook(state.settings);
  previewSetupLook();
  $('setup-error').hidden = true;
  $('setup-discard').hidden = true;
  renderAccountBox();
  const first = !configured();
  el.setup.classList.toggle('firstrun', first);
  el.setupTabs.hidden = first;
  $('setup-title').textContent = t(first ? 'setup.title.connect' : 'setup.title');
  // The first run is the one moment the dialog has to say what it is for.
  $('connection-intro').textContent = t(first ? 'setup.first.intro' : 'setup.connection.intro');
  renderAccountList();
  showPassword(false);
  showSetupSection(first ? 'connection' : (section || 'connection'));
  if (!el.setup.open) el.setup.showModal();
  focusSetupSection();
}

// Every open starts with the connection; edits survive tab changes only.
export let setupSection = 'connection';
// Which account the connection form shows, picked in the list above it:
// 'current' (the one in use), 'new' (one being added) or another one's id;
// setupBase is its configuration, a blank one for a new account.
export let setupEditing = 'current';
export let setupAdding = false;
let setupBase = null;

/** The configuration the form edits for a choice in the list. */
function accountFor(target) {
  if (target === 'new') return store.blankConfig();
  if (target === 'current') return state.config;
  return (state.accounts || []).find((a) => a.id === target) || state.config;
}

/** Whether the form is on an account of the list other than the one in use. */
const editingOther = () => setupEditing !== 'current' && setupEditing !== 'new' && setupEditing !== state.config.id;

/**
 * The connection form on one account of the list: the one in use, a new
 * one, or another — the list above it is the way between them, so there is
 * no view of its own to find the way back from.
 */
export function editAccount(target, { render = true } = {}) {
  setupEditing = target === state.config.id ? 'current' : target;
  setupAdding = setupEditing === 'new';
  setupBase = accountFor(setupEditing);
  // An account being made (the first run, or one being added) opens on the
  // playlist address: most providers send one long address, and that field
  // puts an Xtream subscription's or a portal's into its own form. The base
  // says so too, or the untouched form would count as edited and a synced
  // account could not take its place (adoptSyncedAccount).
  // A synced account that came without its password is no new one: it
  // opens on its own form, waiting for the password (adoptSyncedAccount).
  const making = setupAdding || (!configured() && !setupBase.host && !setupBase.url);
  if (making) setupBase = { ...setupBase, sourceMode: 'm3u' };
  // ...and an Xtream one waits on the server's form, where the password
  // is, even when it was made from a playlist address (sourceMode m3u).
  else if (!configured() && setupBase.host && (setupBase.type || 'xtream') === 'xtream') setupBase = { ...setupBase, sourceMode: 'xtream' };
  for (const f of FIELDS) $(`f-${f}`).value = setupBase[f] ?? '';
  $('f-name').value = setupBase.name || '';
  $('f-paste').value = setupBase.type === 'm3u' ? setupBase.url || '' : '';
  $('f-epgurl').value = setupBase.epgUrl || '';
  $('f-portal').value = setupBase.type === 'stalker' ? setupBase.url || '' : '';
  $('f-mac').value = setupBase.type === 'stalker' ? setupBase.mac || '' : '';
  // The permission prompt to come is said beforehand (updateGrantNote).
  $('setup-grant-note').hidden = !making;
  showPlaylistError(false);
  showSourceMode(baseMode(setupBase));
  showPassword(false);
  if (!render) return;
  $('setup-error').hidden = true;
  renderAccountList();
  updateSetupActions();
  focusSetupSection();
}

/** Another account picked in the list: the form follows, unless it has edits unsaved. */
export function pickAccount(target) {
  if (setupConnectionChanged()) { setupError('setup.maintenance.pending'); return; }
  editAccount(target);
}
let setupInitial = null;
let setupSaving = false;

function readSetupSettings() {
  return {
    lang: $('f-lang').value,
    theme: $('f-theme').value,
    clock: $('f-clock').value,
    epgEnabled: $('f-epg').checked,
    resumeEnabled: $('f-resume').checked,
    autoNext: $('f-autonext').checked,
    statsEnabled: $('f-stats').checked,
    recordingEnabled: $('f-record').checked,
    homePicks: $('f-home-picks').checked,
    homeContinue: $('f-home-continue').checked,
    homeRecent: $('f-home-recent').checked,
    showInternational: $('f-international').checked,
    subtitleStyle: $('f-substyle').value,
    subtitleScale: Number($('f-subsize').value),
    subtitleLift: Number($('f-sublift').value),
  };
}

function setupSettingsPatch() {
  return Object.fromEntries(Object.entries(readSetupSettings()).filter(([key, value]) => value !== setupInitial?.[key]));
}

/**
 * The connection as the form has it: an Xtream server from the fields, or
 * — in the M3U form, with an address that is not an Xtream subscription —
 * a playlist. An Xtream subscription's address is read into the fields, as
 * it always was: its server answers one list at a time, which a playlist
 * of the same account cannot.
 */
function readConnection() {
  const name = $('f-name').value.trim();
  const pasted = $('f-paste').value.trim();
  if (sourceMode() === 'stalker') {
    const typed = $('f-portal').value.trim();
    return { type: 'stalker', url: normalizePortal(typed) || typed, mac: normalizeMac($('f-mac').value) || $('f-mac').value.trim(), name, sourceMode: 'stalker' };
  }
  if (sourceMode() === 'm3u' && pasted && !parsePlaylistUrl(pasted)) {
    return { type: 'm3u', url: playlistAddress(pasted) || pasted, epgUrl: $('f-epgurl').value.trim(), name, sourceMode: 'm3u' };
  }
  return { type: 'xtream', ...readSetup(), name, sourceMode: sourceMode() };
}

/** The keys that say where the connection goes, for the form's kind. */
const connectionKeys = (c) => ['type', ...(c.type === 'm3u' ? ['url', 'epgUrl'] : c.type === 'stalker' ? ['url', 'mac'] : FIELDS)];

/** The form an account opens in. */
const baseMode = (c) => (c.type === 'm3u' ? 'm3u' : c.type === 'stalker' ? 'stalker' : c.sourceMode === 'stalker' ? 'xtream' : c.sourceMode);

/** Whether the form points somewhere else than the configuration it edits. */
function connectionTargetChanged() {
  const c = readConnection();
  const base = setupBase || state.config;
  return connectionKeys(c).some((key) => String(c[key] ?? '') !== String((key === 'type' ? base.type || 'xtream' : base[key]) ?? ''));
}

function setupConnectionChanged() {
  const base = setupBase || state.config;
  if (setupAdding) {
    const c = readConnection();
    return Boolean(c.name || (c.type === 'm3u' || c.type === 'stalker' ? c.url || c.mac : c.host || c.username || c.password) || $('f-paste').value.trim());
  }
  return connectionTargetChanged() || $('f-name').value.trim() !== (base.name || '')
    || sourceMode() !== baseMode(base)
    || (base.type !== 'm3u' && sourceMode() !== 'stalker' && Boolean($('f-paste').value.trim()));
}

export function setupDirty() {
  return setupConnectionChanged() || Object.keys(setupSettingsPatch()).length > 0;
}

export function updateSetupActions() {
  const dirty = setupDirty();
  const first = !configured();
  const reconnect = setupAdding || connectionTargetChanged();
  $('f-save').disabled = setupSaving || (!first && !dirty);
  $('f-save').textContent = t(setupSaving ? 'setup.saving' : first || setupAdding ? 'setup.connect' : 'setup.save');
  // Account & data holds the only two controls in the dialog that act at
  // once, so the line under them must not promise that nothing does.
  el.setupNoteText.textContent = t(dirty ? (reconnect && !first ? 'setup.reconnect' : 'setup.pending')
    : setupSection === 'account' ? 'setup.account.immediate' : 'setup.unchanged');
  el.setupNote.classList.toggle('pending', dirty);
  if (!dirty) $('setup-discard').hidden = true;
  updateGrantNote();
}

// The latest check of updateGrantNote: an answer to an older one is dropped.
let grantCheck = 0;

/**
 * The note that the browser is about to ask for access, shown only where
 * Connect or Save will ask: for an account being made, or one changed to
 * another server, unless that server is allowed already. Before an address
 * is entered on the first run it stands, as the prompt is then certain.
 */
async function updateGrantNote() {
  const check = ++grantCheck;
  const making = setupAdding || !configured();
  if (!making && !connectionTargetChanged()) { $('setup-grant-note').hidden = true; return; }
  const patch = readConnection();
  const addresses = (patch.type === 'm3u' ? [patch.url, patch.epgUrl] : [accountAddress(patch)]).filter(Boolean);
  if (!addresses.length) { $('setup-grant-note').hidden = !making; return; }
  const allowed = (await Promise.all(addresses.map(hasAccess))).every(Boolean);
  if (check === grantCheck) $('setup-grant-note').hidden = allowed;
}

function previewSetupLook() {
  const look = subtitleLook(readSetupSettings());
  const preview = document.querySelector('#panel-subs .sublook');
  preview.dataset.substyle = look.style;
  preview.style.setProperty('--sub-scale', String(look.scale / 100));
  preview.style.setProperty('--sub-lift', String(look.lift / 100));
  showSubtitleSize('f', look);
  fitSubtitlePreview();
}

/**
 * The frame stands in for the picture: the sample is the same share of its
 * height as the subtitles will be of the film's. Only a sample too wide
 * for a narrow frame is scaled down to fit.
 */
/**
 * The preview is a 16:9 picture, as large as the room under the controls
 * allows: a frame stretched to the room's own shape was not a picture, and
 * the text did not look the share of it that it is of a film's.
 */
function fitSubtitlePreview() {
  const frame = document.querySelector('#panel-subs .sublook-preview');
  const room = frame.parentElement;
  const sample = frame.querySelector('.subdisplay');
  // The room less the controls and the heading above the frame, and their gaps.
  const above = [...room.children].filter((node) => node !== frame);
  const gap = parseFloat(getComputedStyle(room).rowGap) || 0;
  const height = room.clientHeight - above.reduce((sum, node) => sum + /** @type {HTMLElement} */ (node).offsetHeight + gap, 0);
  const width = Math.floor(Math.min(room.clientWidth, Math.max(0, height) * 16 / 9));
  frame.style.width = `${width}px`;
  frame.style.height = `${Math.floor(width * 9 / 16)}px`;
  if (!frame.clientWidth || !frame.clientHeight) return;
  frame.style.setProperty('--pic-h', `${Math.round(pictureHeight(frame.clientWidth, frame.clientHeight))}px`);
  if (!sample.offsetWidth) return;
  const scale = Math.min(1, Math.max(0, frame.clientWidth - 32) / sample.offsetWidth,
    Math.max(0, frame.clientHeight - 32) / sample.offsetHeight);
  frame.style.setProperty('--sub-preview-scale', String(scale));
}

function closeSetup() {
  if (setupSaving) return;
  if (setupDirty()) {
    $('setup-discard').hidden = false;
    $('f-keep').focus();
    return;
  }
  el.setup.close();
}

export function setupError(key, field, params) {
  $('setup-error').textContent = t(key, params);
  $('setup-error').hidden = false;
  if (field) { showSetupSection('connection'); $(field).focus(); }
}

export function showSetupSection(name) {
  setupSection = name;
  for (const button of el.setupTabs.children) {
    const on = button.dataset.panel === name;
    button.classList.toggle('active', on);
    button.setAttribute('aria-selected', String(on));
    button.tabIndex = on ? 0 : -1;
  }
  for (const panel of document.querySelectorAll('.setup-panel')) {
    panel.hidden = panel.id !== `panel-${name}`;
  }
  updateSetupActions();
}

/**
 * The first field of the section on show, so the keyboard starts where the
 * eye does. Buttons are not fields: the Account section's are the two that
 * throw things away, and focus does not belong on those.
 */
function focusSetupSection() {
  const panel = document.querySelector('.setup-panel:not([hidden])');
  if (!panel) return;
  if (!caretWelcome()) return;
  const shown = (node) => node.getClientRects().length;
  // A field to type in before a menu to choose from: on the connection
  // panel the first control is the protocol, which almost nobody changes,
  // and starting there put the caret one Tab away from the server address
  // every single time.
  // The account's name is optional and never where the caret starts. A new
  // account's first field is the playlist's address.
  const field = [...panel.querySelectorAll('input:not([type="radio"]):not(#f-name)')].find(shown)
    ?? [...panel.querySelectorAll('select')].find(shown);
  if (field) field.focus();
}

/** The password in the clear, or back behind its dots. */
function showPassword(on) {
  const input = $('f-password');
  const button = $('f-password-show');
  input.type = on ? 'text' : 'password';
  button.setAttribute('aria-pressed', String(on));
  button.classList.toggle('on', on);
  const label = t(on ? 'setup.password.hide' : 'setup.password.show');
  button.title = label;
  button.setAttribute('aria-label', label);
  button.dataset.i18nLabel = button.dataset.i18nTitle = on ? 'setup.password.hide' : 'setup.password.show';
}

/**
 * The connection mode changes only which form is visible. Credentials parsed
 * from a URL land in the same fields as ones typed by hand, so switching
 * mode loses nothing and neither route is more official than the other.
 */
function showSourceMode(mode) {
  const chosen = mode === 'm3u' || mode === 'stalker' ? mode : 'xtream';
  for (const radio of document.querySelectorAll('input[name="source"]')) {
    radio.checked = radio.value === chosen;
  }
  $('src-xtream').hidden = chosen !== 'xtream';
  $('src-m3u').hidden = chosen !== 'm3u';
  $('src-stalker').hidden = chosen !== 'stalker';
  // The note on HTTP is about a user name and a password.
  $('connection-security').hidden = chosen === 'stalker';
  showGuideField();
}

/** The guide's address belongs to a playlist, not to an Xtream subscription's address. */
function showGuideField() {
  const pasted = $('f-paste').value.trim();
  $('src-epg').hidden = sourceMode() !== 'm3u' || !pasted || Boolean(parsePlaylistUrl(pasted));
}

/** The M3U field says only what is wrong; what is right, it shows. */
function showPlaylistError(bad) {
  $('playlist-status').textContent = bad ? t('setup.m3u.bad') : '';
  showGuideField();
  $('playlist-status').hidden = !bad;
  $('f-paste').setAttribute('aria-invalid', String(bad));
}

const sourceMode = () => (document.querySelector('input[name="source"]:checked') || {}).value || 'xtream';

/* ---------------------------------------------------------------- sync */

export const sync = new Sync({ onStatus: () => renderSyncBox() });

/** The sync section of Account & data: the two switches, and how it went. */
export async function renderSyncBox() {
  const box = $('sync-box');
  box.hidden = !syncAvailable();
  if (box.hidden) return;
  const { prefs, status } = await loadSyncInfo();
  $('f-sync').checked = prefs.enabled;
  $('f-sync-passwords').checked = prefs.passwords;
  $('f-sync-passwords').disabled = !prefs.enabled;
  const line = $('sync-status');
  line.classList.toggle('error', Boolean(prefs.enabled && status.error));
  line.textContent = !prefs.enabled ? ''
    : status.error ? t(status.error === 'quota' ? 'sync.status.quota' : 'sync.status.error', { message: status.error })
    : status.at ? t('sync.status.at', { time: dateTimeFmt.format(new Date(status.at)) })
    : t('sync.status.waiting');
}

/**
 * Settings that arrived from another computer (js/sync.js) or another tab,
 * applied where they show: the theme, the language, the subtitles.
 */
export async function showStoredSettings(next) {
  if (!next || resetting) return;
  const before = state.settings;
  const settings = await store.loadSettings();
  if (same(settings, before)) return;
  state.settings = settings;
  if (settings.theme !== before.theme) renderTheme(settings.theme);
  if (settings.lang !== before.lang || settings.clock !== before.clock) await applyLanguage(store.interfaceLanguage(settings));
  applySubtitleLook(settings);
  renderStatBadge();
  renderRecordingState();
  refreshGuidePreview();
  if (!state.playing && !el.overlay.hidden && el.overlayTitle.textContent === t('player.idle')) renderIdleOverlay();
  if (state.epg) state.epg.enabled = settings.epgEnabled;
}

/**
 * A computer that has no account of its own yet takes one that came from
 * sync: the first that can connect as it is, or — when every one is an
 * Xtream account that came without its password — the first, in the form,
 * waiting for the password.
 */
export async function adoptSyncedAccount(accounts) {
  if (configured() || !accounts.length || resetting) return false;
  if (el.setup.open && setupDirty()) return false;
  // Only what sync brought: without sync, a list with no account in use is
  // a reset in another tab half-way done, not an account to take.
  if (!(await loadSyncInfo()).prefs.enabled) return false;
  const ready = accounts.find((a) => store.isConfigured(a));
  const config = await store.switchConfig(ready || accounts[0]);
  await adoptAccount(config);
  if (!ready) {
    openSetup();
    toast(t('sync.password.needed', { name: store.accountLabel(config) }), { long: true });
    return true;
  }
  if (el.setup.open) el.setup.close();
  await connect();
  return true;
}

export async function renderAccountBox() {
  const box = $('account-box');
  const a = state.account;
  renderSyncBox();
  // A section that is simply empty tells the viewer nothing about why.
  $('account-none').hidden = Boolean(a);
  if (!a) { box.hidden = true; return; }
  box.hidden = false;
  const estimate = await storageEstimate();
  box.replaceChildren();
  const head = document.createElement('div');
  const status = document.createElement('b');
  status.textContent = a.kind === 'm3u' ? t('accounts.kind.m3u') : a.kind === 'stalker' ? t('accounts.kind.stalker') : a.status + (a.trial ? t('account.trial') : '');
  head.append(`${t('account.title')} `, status);
  box.appendChild(head);
  const cols = document.createElement('div');
  cols.className = 'cols';
  // A playlist has no subscription to describe: what it holds, where its
  // guide comes from and when it was read are what there is to say.
  const rows = a.kind === 'stalker' ? [
    [t('account.valid.label'), a.expiresAt ? dateFmt.format(new Date(a.expiresAt)) : '–'],
    [t('account.cache'), estimate ? megabytes(estimate.usage || 0) : '–'],
  ] : a.kind === 'm3u' ? [
    [t('account.channels'), nf.format(a.counts.live)],
    [t('account.movies'), nf.format(a.counts.movie)],
    [t('account.series'), nf.format(a.counts.series)],
    [t('account.guide'), a.guide.length ? a.guide.map((url) => { try { return new URL(url).hostname; } catch { return url; } }).join(', ') : t('account.none')],
    [t('account.read'), a.loadedAt ? dateTimeFmt.format(new Date(a.loadedAt)) : '–'],
    [t('account.cache'), estimate ? megabytes(estimate.usage || 0) : '–'],
  ] : [
    [t('account.connections.label'), a.maxConnections ? `${a.activeConnections} / ${a.maxConnections}` : '–'],
    [t('account.valid.label'), a.expiresAt ? dateFmt.format(new Date(a.expiresAt)) : '–'],
    [t('account.cache'), estimate ? megabytes(estimate.usage || 0) : '–'],
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
 * Back to the initial state: credentials, settings, favourites, history,
 * resume points and the whole cache gone. The page is reloaded at the end,
 * because the state in memory — loaded lists, an open playback, the chosen
 * group — corresponds to nothing after the wipe, and a fresh load starts
 * from the welcome view.
 */
/**
 * The version line under Account & data, and the update when one is waiting:
 * the line names what this page runs, the button takes what the browser has
 * fetched.
 */
function renderVersion() {
  const line = $('app-version');
  line.textContent = `Kepuli-TV ${store.runningVersion()}`;
  if (!updateReady) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ghost';
  button.textContent = t('update.install', { version: updateReady });
  button.addEventListener('click', applyUpdate);
  line.append(' ', button);
}

let updateReady = null;

export function offerUpdate(version) {
  if (!version || version === store.runningVersion()) return;
  updateReady = version;
  renderVersion();
  toast(t('update.ready', { version }), { action: { label: t('update.now'), onClick: applyUpdate } });
}

function applyUpdate() { store.reloadForUpdate(location.hash); }

async function resetEverything() {
  startReset();
  playback.stop();
  await api.storage.local.clear();
  // What sync put in the browser's account goes too: "everything" is
  // everything the player stored, here or carried elsewhere.
  await api.storage.sync?.clear().catch(() => {});
  await wipeStorage();
  location.reload();
}

function readSetup() {
  const patch = {};
  for (const f of FIELDS) patch[f] = $(`f-${f}`).value.trim();
  // A whole address in the Server field is split into its parts here as
  // well as on leaving the field, so that Connect never sees one.
  Object.assign(patch, parseServer(patch.host) || {});
  return patch;
}

/** An address pasted into the Server field lands in the fields it belongs in. */
function splitServerField() {
  const parsed = parseServer($('f-host').value);
  if (!parsed) return;
  for (const f of FIELDS) if (parsed[f] != null) $(`f-${f}`).value = parsed[f];
}

/**
 * The languages, each in its own name, after the one that follows the
 * browser: that one says which language it comes to now, in the language
 * of the interface, since the viewer may not know what the browser asks for.
 */
function renderLanguageOptions() {
  const option = (value, label) => Object.assign(document.createElement('option'), { value, textContent: label });
  const languages = Object.entries(LANGUAGES).sort((a, b) => a[1].localeCompare(b[1], localeTag()));
  $('f-lang').replaceChildren(
    option('auto', t('setup.language.auto', { name: LANGUAGES[store.browserLanguage()] })),
    ...languages.map(([value, label]) => option(value, label)),
  );
}

/**
 * The clock's choices, each with an evening time written its way, so that
 * the viewer sees what they pick; the automatic one shows what it comes to.
 */
function renderClockOptions() {
  const option = (value, label) => Object.assign(document.createElement('option'), { value, textContent: label });
  const evening = new Date(2026, 0, 1, 22, 30);
  const sample = (cycle) => new Intl.DateTimeFormat(localeTag(), { hour: cycle === 'h12' ? 'numeric' : '2-digit', minute: '2-digit', hourCycle: cycle }).format(evening);
  $('f-clock').replaceChildren(
    option('auto', t('setup.clock.auto', { example: sample(store.hourCycle({ ...state.settings, clock: 'auto' })) })),
    option('24', t('setup.clock.24', { example: sample('h23') })),
    option('12', t('setup.clock.12', { example: sample('h12') })),
  );
}

export function wireSetup() {
  renderVersion();
  // Each ? is described by the setting or heading it stands beside: nine
  // buttons named "Help" alone said nothing about which help.
  for (const button of el.setup.querySelectorAll('.hint-btn')) {
    const beside = button.previousElementSibling;
    if (!beside) continue;
    beside.id ||= `${button.getAttribute('aria-controls')}-for`;
    button.setAttribute('aria-describedby', beside.id);
  }
  // A ? beside a setting opens its explanation under it, and closes it.
  el.setup.addEventListener('click', (event) => {
    const button = /** @type {Element} */ (event.target).closest('.hint-btn');
    if (!button) return;
    const open = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(open));
    $(button.getAttribute('aria-controls')).hidden = !open;
  });
  new ResizeObserver(fitSubtitlePreview).observe(document.querySelector('#panel-subs .sublook'));
  // Dialog controls edit a draft. Only the local subtitle sample previews it.
  for (const event of ['input', 'change']) {
    el.setup.querySelector('form').addEventListener(event, () => {
      $('setup-error').hidden = true;
      previewSetupLook();
      updateSetupActions();
    });
  }
  // The player's Aa popover remains a direct adjustment during playback.
  $('p-substyle').addEventListener('change', () => chooseSubtitleLook('p'));
  $('p-sublift').addEventListener('input', () => applySubtitleLook(lookOf('p')));
  $('p-sublift').addEventListener('change', () => chooseSubtitleLook('p'));
  $('p-sublift-reset').addEventListener('click', () => { $('p-sublift').value = String(DEFAULT_LIFT); chooseSubtitleLook('p'); $('p-sublift').focus(); });
  $('f-sublift-reset').addEventListener('click', () => {
    const slider = $('f-sublift');
    slider.value = String(DEFAULT_LIFT);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.focus();
  });
  $('p-subsize').addEventListener('input', () => applySubtitleLook({
    subtitleStyle: $('p-substyle').value, subtitleScale: Number($('p-subsize').value), subtitleLift: Number($('p-sublift').value),
  }));
  $('p-subsize').addEventListener('change', () => chooseSubtitleLook('p'));
  // Back to the size the picture asks for: in the player at once, in the
  // settings as part of the draft, like the slider beside it.
  $('p-subsize-reset').addEventListener('click', () => { $('p-subsize').value = String(DEFAULT_SCALE); chooseSubtitleLook('p'); $('p-subsize').focus(); });
  $('f-subsize-reset').addEventListener('click', () => {
    const slider = $('f-subsize');
    slider.value = String(DEFAULT_SCALE);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.focus();
  });
  el.sublook.addEventListener('click', () => toggleSubtitleLook());

  for (const radio of document.querySelectorAll('input[name="source"]')) {
    radio.addEventListener('change', () => showSourceMode(radio.value));
  }

  // Pasting an address is a way of filling the fields, not a mode of its
  // own: the fields it filled are what the viewer wants to see, so the
  // dialog goes there rather than reporting the fill and offering a button.
  // A portal's address here goes to the portal's form, which then asks
  // for the MAC address: pasted or dropped at once, typed when it is left
  // (change, which also comes before a press of Save takes the focus).
  const toPortal = (field) => {
    if (parsePlaylistUrl(field.value) || pastedKind(field.value) !== 'stalker') return false;
    $('f-portal').value = field.value.trim();
    field.value = '';
    showPlaylistError(false);
    showSourceMode('stalker');
    updateSetupActions();
    $('f-mac').focus();
    return true;
  };
  $('f-paste').addEventListener('change', (e) => toPortal(e.target));
  $('f-paste').addEventListener('input', (e) => {
    const parsed = parsePlaylistUrl(e.target.value);
    // An address with no credentials in it is a playlist of its own, kept
    // as it is; only text that is no address at all is wrong.
    showPlaylistError(Boolean(e.target.value.trim()) && !parsed && !playlistAddress(e.target.value));
    if ((e.inputType === 'insertFromPaste' || e.inputType === 'insertFromDrop') && toPortal(e.target)) return;
    if (!parsed) return;
    for (const f of FIELDS) if (parsed[f] != null) $(`f-${f}`).value = parsed[f];
    // An address that arrived whole has been said in full. One being typed
    // parses at the first letter of its password already, and taking the
    // field away then would swallow the rest of it.
    if (e.inputType !== 'insertFromPaste' && e.inputType !== 'insertFromDrop') return;
    showSourceMode('xtream');
    updateSetupActions();
    $('f-host').focus();
  });
  $('f-host').addEventListener('change', splitServerField);
  $('f-add-account').addEventListener('click', () => pickAccount('new'));
  // Sync is a choice about this browser and acts at once (see player.html).
  $('f-sync').addEventListener('change', async (e) => {
    await sync.setPrefs({ enabled: e.target.checked });
    renderSyncBox();
  });
  $('f-sync-passwords').addEventListener('change', async (e) => {
    await sync.setPrefs({ passwords: e.target.checked });
    renderSyncBox();
  });
  $('f-password-show').addEventListener('click', () => showPassword($('f-password').type === 'password'));
  wireModal(el.setup, closeSetup);
  $('f-done').addEventListener('click', () => { if (!setupSaving) el.setup.close(); });
  $('f-keep').addEventListener('click', () => { $('setup-discard').hidden = true; focusSetupSection(); });
  $('f-discard').addEventListener('click', () => el.setup.close());
  el.setup.addEventListener('close', () => { $('setup-discard').hidden = true; });
  el.setupTabs.addEventListener('keydown', (event) => {
    const tabs = [...el.setupTabs.querySelectorAll('[role="tab"]')];
    const index = tabs.indexOf(event.target);
    if (index < 0) return;
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    showSetupSection(tabs[next].dataset.panel);
    tabs[next].focus();
  });
  el.setupTabs.addEventListener('click', (e) => {
    const button = e.target.closest('button[data-panel]');
    if (!button) return;
    showSetupSection(button.dataset.panel);
  });
  el.setup.querySelector('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (setupSaving || (configured() && !setupAdding && !setupDirty())) return;
    const other = editingOther();
    const connectionEdited = setupConnectionChanged() || !configured() || setupAdding;
    // An Xtream account entered as its address can save other preferences
    // without pasting the address again. Any newly entered address must be
    // complete: an Xtream subscription's is read into the fields, any other
    // is a playlist.
    const pasted = $('f-paste').value.trim();
    if (sourceMode() === 'm3u' && (connectionEdited || pasted)) {
      const parsed = parsePlaylistUrl(pasted);
      if (parsed) {
        for (const f of FIELDS) if (parsed[f] != null) $(`f-${f}`).value = parsed[f];
      } else if (!playlistAddress(pasted)) { setupError('setup.m3u.bad', 'f-paste'); return; }
      const guide = $('f-epgurl').value.trim();
      if (!parsed && guide && !playlistAddress(guide)) { setupError('setup.epgurl.bad', 'f-epgurl'); return; }
    }
    const patch = readConnection();
    const changed = setupAdding || connectionTargetChanged();
    if (connectionEdited && !store.isConfigured(patch)) {
      if (patch.type === 'm3u') setupError('setup.m3u.bad', 'f-paste');
      else if (patch.type === 'stalker') {
        if (!normalizePortal(patch.url)) setupError('stalker.badurl', 'f-portal');
        else setupError('stalker.badmac', 'f-mac');
      }
      else setupError('setup.incomplete', !patch.host ? 'f-host' : !patch.username ? 'f-username' : 'f-password');
      return;
    }
    const settingsPatch = setupSettingsPatch();
    $('setup-error').hidden = true;
    setupSaving = true;
    updateSetupActions();
    el.setup.querySelector('form').inert = true;
    el.setup.setAttribute('aria-busy', 'true');
    let saved = false;
    try {
      // Permission must be requested before the first await, while the
      // submit still carries the user's gesture. Denial leaves the draft.
      // A playlist and its guide are often on different hosts: one dialog
      // asks for both.
      const granted = !changed || (patch.type === 'm3u'
        ? await requestAccessFor([patch.url, patch.epgUrl].filter(Boolean))
        : await requestAccess(accountAddress(patch)));
      if (!granted) {
        // Named as the button reads, which is Connect for a new account
        // and Save for a changed one.
        setupError('setup.nogrant', null, { button: t(!configured() || setupAdding ? 'setup.connect' : 'setup.save') });
        return;
      }
      const previous = state.config;
      // A new account is a whole configuration of its own, with an id of
      // its own; the one in use keeps its id and is changed in place.
      // Another account of the list is changed in the list only: the one
      // in use stays, and nothing reconnects.
      const configPatch = other ? null : setupAdding ? { ...store.blankConfig(), ...patch } : connectionEdited ? patch : null;
      const next = await store.saveSetup(configPatch, settingsPatch, { replace: setupAdding });
      if (other && connectionEdited) await store.recordAccount({ ...setupBase, ...patch });
      saved = true;
      // Another account: what is playing stops before anything else of
      // the new one is in place, so that no retry, wait or history entry
      // of the old stream is made against the new account.
      const moved = Boolean(next.config) && store.accountKey(next.config) !== store.accountKey(previous);
      if (moved) await adoptAccount(next.config);
      else if (next.config) state.config = next.config;
      state.settings = next.settings;
      el.setup.close();
      if (state.epg) state.epg.enabled = state.settings.epgEnabled;
      applySubtitleLook(state.settings);
      renderStatBadge();
      renderRecordingState();
      refreshGuidePreview();
      if (!state.playing && !el.overlay.hidden && el.overlayTitle.textContent === t('player.idle')) renderIdleOverlay();
      if (settingsPatch.theme) renderTheme(state.settings.theme);
      if (settingsPatch.lang || settingsPatch.clock) await applyLanguage(store.interfaceLanguage(state.settings));
      // The international channels shown or hidden repaint the channel
      // list where it stands; a changed connection is about to load it
      // again anyway.
      if ('showInternational' in settingsPatch && (!changed || other)) {
        renderSidebar();
        await refreshRows({ keepScroll: true });
      }
      state.accounts = await store.loadAccounts();
      if (changed && !other) {
        await connect();
        if (moved && !setupAdding) offerLists(previous, state.config);
      } else {
        toast(other ? t('accounts.saved', { name: store.accountLabel({ ...setupBase, ...patch }) }) : t('setup.saved'));
      }
    } catch (err) {
      console.error('[iptv] settings save failed', err);
      if (!saved) setupError('setup.failed');
      else toast(t('error.unexpected', { message: err.message }), { kind: 'error' });
    } finally {
      setupSaving = false;
      el.setup.querySelector('form').inert = false;
      el.setup.removeAttribute('aria-busy');
      updateSetupActions();
    }
  });
  $('f-clear').addEventListener('click', async () => {
    if (setupDirty()) { setupError('setup.maintenance.pending'); return; }
    await cacheClear();
    if (state.lib) await state.lib.reset();
    toast(t('setup.cleared'));
    el.setup.close();
    await connect({ silent: true });
  });

  // A reset cannot be undone, so the button asks for confirmation itself: a
  // second dialog opened on top of the settings dialog would end up beneath
  // it. The armed state lapses on its own, so the button is not left waiting
  // in confirmation mode for the next click that happens to land on it.
  let armed = null;
  const disarm = (button) => {
    clearTimeout(armed);
    armed = null;
    button.textContent = t('setup.reset');
    button.classList.remove('armed');
  };
  $('f-reset').addEventListener('click', (e) => {
    if (setupDirty()) { setupError('setup.maintenance.pending'); return; }
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
      toast(t('setup.reset.failed'), { kind: 'error' });
    });
  });

}
