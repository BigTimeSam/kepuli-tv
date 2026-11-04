// The programme guide in the player: opening and closing it over the list,
// its column with the channel's programmes and the small picture, the
// programme search, and the guide's favourites switch. The grid itself is
// js/epggrid.js.
//
// Moved out of app.js. It takes the player's state and helpers from app.js
// (a cycle that ES modules resolve: nothing here runs while the modules
// load, only when the player calls in).

import { EpgGrid, catchupAvailable } from './epggrid.js';
import { ProgrammeSearch } from './programmesearch.js';
import { applyTheme } from './theme.js';
import { clock, duration } from './format.js';
import { freshItem } from './coversui.js';
import { playCatchup, recordingOf, recordingOn, toggleProgrammeRecording } from './recordingsui.js';
import { poster } from './poster.js';
import { reminderKey, reminders, toggleReminder } from './remindersui.js';
import { renderInfoStrip } from './infostrip.js';
import { t } from './i18n.js';
import * as store from './config.js';
import { activateTab, state, visibleGroups, visibleRows, vlist } from './app.js';
import { openSetup } from './setupui.js';
import { playItem } from './playing.js';
import { toast } from './toast.js';
import { $, el } from './dom.js';

export const grid = new EpgGrid({
  scroll: $('epg-scroll'), canvas: $('epg-canvas'),
  timesInner: $('epg-times-inner'), chansInner: $('epg-chans-inner'),
  corner: $('epg-corner'), days: $('epg-days'), clock: $('epg-clock'),
}, {
  label: (channel) => (state.cleanName ? state.cleanName(channel.n, channel) : channel.n),
  onSelect: renderGuidePreview,
  onActivate: activateProgramme,
  onChannel: (channel) => channel && showGuideChannel(channel),
  onPlay: (channel) => channel && playItem(channel),
  onWindow: (items, from, to) => state.epg && state.epg.setVisibleWindow(items, from, to),
  reminded: (channel, programme) => reminders.has(reminderKey(channel, programme)),
});

export let guideOpen = false;

export const programmeSearch = new ProgrammeSearch({
  getEpg: () => state.epg,
  getChannels: async (scope, signal) => {
    if (scope === 'all') {
      const library = state.lib;
      const channels = await library.ensureFull('live', { signal });
      if (signal.aborted || library !== state.lib) throw new DOMException('Cancelled', 'AbortError');
      return visibleRows(channels);
    }
    return state.rows.filter((c) => c.k === 0);
  },
  onSelect: renderGuidePreview,
  onActivate: activateProgramme,
  onMode: (searching) => {
    $('epg-body').hidden = searching;
    if (searching) grid.hide();
    else if (guideOpen && !grid.open) grid.show();
  },
});

export async function toggleGuide() {
  if (guideOpen) closeGuide(); else await openGuide();
}

async function openGuide() {
  if (guideOpen) return;
  if (!state.lib || !state.epg) {
    toast(t('guide.needserver'), { kind: 'warn', action: { label: t('btn.settings'), onClick: openSetup } });
    return;
  }
  if (!state.epg.enabled) {
    toast(t('guide.epgoff'), { kind: 'warn', action: { label: t('guide.epgon'), onClick: switchEpgOn } });
    return;
  }
  // The guide shows channel rows, so it needs the channel tab's contents.
  if (state.tab !== 'live' || state.detail) await activateTab('live', { restore: true });

  if (guideFavorites && !favoriteChannels().length) guideFavorites = false;
  const channels = guideChannels();
  if (!channels.length) { toast(t('guide.needgroup'), { kind: 'warn' }); return; }

  guideOpen = true;
  el.main.classList.add('guide');
  el.epg.hidden = false;
  el.epgPreview.hidden = false;
  $('btn-guide').setAttribute('aria-expanded', 'true');

  renderGuideGroups();
  renderGuideFavorites();
  grid.epg = state.epg;
  grid.setPlaying(state.playing && state.playing.k === 0 ? state.playing.id : null);
  grid.setChannels(channels);
  grid.show();
  if (state.playing && state.playing.k === 0) grid.focusChannel(state.playing.id);
  focusGrid();
}

/** The switch the "programme data is off" message offers, and the guide after it. */
async function switchEpgOn() {
  state.settings = await store.saveSettings({ epgEnabled: true });
  if (state.epg) state.epg.enabled = true;
  await openGuide();
}

export function closeGuide() {
  if (!guideOpen) return;
  const restoreFocus = el.epg.contains(document.activeElement) || el.epgPreview.contains(document.activeElement)
    || document.activeElement === $('epg-close');
  guideOpen = false;
  programmeSearch.clear();
  grid.hide();
  el.main.classList.remove('guide');
  el.epg.hidden = true;
  el.epgPreview.hidden = true;
  $('btn-guide').setAttribute('aria-expanded', 'false');
  if (restoreFocus) $('btn-guide').focus();
  vlist.refresh();
  renderInfoStrip();
}

/** A group selector for the guide: the sidebar is hidden in guide mode. */
/**
 * The theme in force, and the button that changes it: the button shows
 * and names the theme it leads to, a sun in the dark and a moon in the
 * light, so that its label says what a press will do.
 */
export function renderTheme() {
  const theme = applyTheme(state.settings.theme);
  const button = $('btn-theme');
  const next = theme === 'light' ? 'dark' : 'light';
  button.dataset.next = next;
  button.dataset.i18nLabel = button.dataset.i18nTitle = `theme.to.${next}`;
  button.setAttribute('aria-label', t(`theme.to.${next}`));
  button.title = t(`theme.to.${next}`);
}

/* The guide's favourites. */

// The guide narrowed to the favourite channels, from every group at once,
// in the order they were starred. A choice of this browser's that stays
// from one opening of the guide to the next (ui.guideFavorites); the list
// beside the guide keeps the group it shows.
export let guideFavorites = false;
/** The guide's favourites switch as stored, at start-up. */
export function restoreGuideFavorites(on) { guideFavorites = Boolean(on); }

/** The favourite channels, as the library holds them now when it does. */
function favoriteChannels() {
  return [...state.favorites.values()].filter((f) => f.k === 0).map((f) => freshItem(f) || f);
}

/** The guide's channels: the favourites, or the list's own. */
function guideChannels() {
  return guideFavorites ? favoriteChannels() : state.rows.filter((it) => it.k === 0);
}

function renderGuideFavorites() {
  const button = $('epg-favs');
  button.setAttribute('aria-pressed', String(guideFavorites));
  // A group means nothing while the favourites are shown.
  $('epg-group').disabled = guideFavorites;
}

export async function setGuideFavorites(on) {
  if (on && !favoriteChannels().length) {
    toast(t('guide.favs.none'), { kind: 'warn' });
    on = false;
  }
  guideFavorites = on;
  renderGuideFavorites();
  store.saveUiState({ guideFavorites: on });
  if (!guideOpen) return;
  const channels = guideChannels();
  if (!channels.length) return;
  grid.setChannels(channels);
  if (state.playing && state.playing.k === 0) grid.focusChannel(state.playing.id);
}

/** A star given or taken while the guide shows the favourites: the guide follows. */
export function favoritesChanged() {
  if (!guideOpen || !guideFavorites) return;
  const channels = favoriteChannels();
  if (!channels.length) { setGuideFavorites(false); return; }
  grid.setChannels(channels);
}

export function renderGuideGroups() {
  const select = $('epg-group');
  const frag = document.createDocumentFragment();
  const all = document.createElement('option');
  all.value = '';
  all.textContent = t('guide.allchannels');
  frag.appendChild(all);
  for (const group of visibleGroups('live')) {
    const option = document.createElement('option');
    option.value = group.name;
    option.textContent = group.name;
    frag.appendChild(option);
  }
  select.replaceChildren(frag);
  select.value = state.group ?? '';
}

// The channel whose name was clicked in the guide: its panel lists what
// comes after the programme on now. Any other choice in the grid — a
// programme, an arrow key — is about one programme, and the list goes.
export let guideChannel = null;
const UPCOMING = 10;

export function showGuideChannel(channel) {
  guideChannel = String(channel.id);
  // The guide's own window is some twelve hours of programmes, which is
  // the ten that come next on all but the shortest of slots.
  state.epg?.want(channel, { priority: true, mode: 'grid' });
  renderGuidePreview(channel, state.epg?.nowNext(channel.id)?.now || null, { upcoming: true });
}

/** The programmes after the one shown, times and titles only. */
function renderUpcoming(channel, programme) {
  const list = $('epgv-next');
  const now = Date.now();
  const after = programme ? programme.stop : now;
  const items = (state.epg?.listings(channel.id) || []).filter((p) => p.start >= after).slice(0, UPCOMING);
  list.replaceChildren(...items.map((p) => {
    const li = document.createElement('li');
    const time = document.createElement('span');
    time.className = 'epgv-next-time';
    time.textContent = `${clock(p.start)}–${clock(p.stop)}`;
    const title = document.createElement('span');
    title.className = 'epgv-next-title';
    title.textContent = p.title;
    li.append(time, title);
    return li;
  }));
  list.hidden = !items.length;
}

// What the panel shows, for painting it again when a recording changes.
let guidePreview = null;

export function refreshGuidePreview() {
  if (guideOpen && guidePreview) renderGuidePreview(guidePreview.channel, guidePreview.programme, { upcoming: guidePreview.upcoming });
}

export function renderGuidePreview(channel, programme, { upcoming = false } = {}) {
  if (!channel) return;
  guidePreview = { channel, programme, upcoming };
  if (!upcoming) guideChannel = null;
  if (upcoming) renderUpcoming(channel, programme);
  else $('epgv-next').hidden = true;
  const logo = poster('epgv-logo', channel.logo, 'channel');
  logo.id = 'epgv-logo';
  $('epgv-logo').replaceWith(logo);

  $('epgv-name').textContent = state.cleanName ? state.cleanName(channel.n, channel) : channel.n;

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
  $('epgv-meta').textContent = meta.join(', ');

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

  // Said out loud when the cursor moves: the channel, and the programme it
  // has landed on. The panel above shows more, but a description read on
  // every arrow press would bury the one thing that changed.
  $('epg-announce').textContent = [
    $('epgv-name').textContent,
    programme ? `${clock(programme.start)}–${clock(programme.stop)}` : null,
    programme ? programme.title : t('guide.noepg.channel'),
  ].filter(Boolean).join(', ');

  const actions = $('epgv-actions');
  const buttons = [{ label: t('guide.watch'), primary: true, onClick: () => playItem(channel) }];
  if (catchupAvailable(channel, programme, now)) {
    buttons.unshift({ label: t(programme.stop > now ? 'guide.startover' : 'guide.watch.recording'), primary: true, onClick: () => playCatchup(channel, programme) });
    buttons[1].primary = false;
  }
  if (programme && programme.start > now) {
    const set = reminders.has(reminderKey(channel, programme));
    buttons.push({ label: t(set ? 'guide.remind.cancel' : 'guide.remind'), onClick: () => toggleReminder(channel, programme) });
  }
  if (programme && programme.stop > now && recordingOn()) {
    const planned = recordingOf(channel, programme);
    const label = !planned ? 'rec.record' : planned.state === 'recording' ? 'rec.stop' : 'rec.cancel';
    buttons.push({ label: t(label), onClick: () => toggleProgrammeRecording(channel, programme) });
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

/** Enter, or a double-click in the grid. */
function activateProgramme(channel, programme) {
  if (!channel) return;
  const now = Date.now();
  if (programme && programme.stop <= now) {
    if (catchupAvailable(channel, programme, now)) playCatchup(channel, programme);
    else toast(t('guide.norecording'), { kind: 'warn' });
    return;
  }
  if (programme && programme.start > now) {
    const action = reminders.has(reminderKey(channel, programme)) ? null
      : { label: t('guide.remind'), onClick: () => toggleReminder(channel, programme) };
    toast(t('guide.starts', { title: programme.title, time: clock(programme.start) }), { action });
    return;
  }
  playItem(channel);
}

/** Keyboard control belongs to the grid, not to the last button pressed. */
export function focusGrid() {
  $('epg-scroll').focus({ preventScroll: true });
}

function relativeSoon(start, now) {
  const minutes = Math.round((start - now) / 60000);
  if (minutes < 60) return t('guide.minutes', { minutes });
  return t('guide.at', { time: clock(start) });
}
