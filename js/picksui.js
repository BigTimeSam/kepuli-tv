// On your channels now and soon: the picks on the empty player's page
// (chosen by js/picks.js), drawn as cards, with a reminder or playback a
// click away, and the page drawn again every minute while it shows.
//
// Moved out of app.js. It takes the player's state, and the parts app.js
// builds, from js/state.js.

import { clock, dayLabel, progressOf } from './format.js';
import { pickProgrammes, programmeKey } from './picks.js';
import { poster } from './poster.js';
import { reminderKey, reminders, toggleReminder } from './remindersui.js';
import { shownName } from './coversui.js';
import { t } from './i18n.js';
import { state } from './state.js';
import { playFromHome } from './idlehome.js';
import { renderIdleOverlay } from './languageui.js';
import { el } from './dom.js';

// What is on now and coming up on the viewer's channels (js/picks.js): the
// favourites and the channels watched lately, as many as PICK_CHANNELS.
const PICK_CHANNELS = 24;
const PICK_RECENT = 12;
const PICKS = 8;
// The channels the picks were last worked out from, for onEpgUpdated: a
// channel's programmes arriving repaint the page.
export let pickIds = new Set();
let idleRefresh = null;
let idleTicker = null;
/** Draws the empty player's page again every minute while it shows, and stops when it does not. */
export function tickIdlePage(redraw) {
  clearInterval(idleTicker);
  idleTicker = redraw ? setInterval(() => { if (!redraw()) clearInterval(idleTicker); }, 60e3) : null;
}

function pickChannels() {
  const out = new Map();
  for (const item of state.favorites.values()) if (item.k === 0) out.set(String(item.id), { item, favorite: true, rank: null });
  let rank = 0;
  for (const item of state.recents) {
    if (item.k !== 0) continue;
    const id = String(item.id);
    const had = out.get(id);
    if (had) { if (had.rank == null) had.rank = rank; }
    else if (rank < PICK_RECENT) out.set(id, { item, favorite: false, rank });
    rank++;
  }
  return [...out.values()].slice(0, PICK_CHANNELS);
}

/**
 * The picks, from the programme data in memory; the channels whose data is
 * not there yet are asked for it, and the page is drawn again when it
 * arrives (onEpgUpdated). With the programme data switched off there are
 * none.
 */
export function currentPicks() {
  const epg = state.epg;
  if (!epg || !epg.enabled) { pickIds = new Set(); return []; }
  const channels = pickChannels();
  pickIds = new Set(channels.map((c) => String(c.item.id)));
  epg.keep(channels.map((c) => c.item));
  const reminded = new Set([...reminders.values()].map((r) => programmeKey(r.title)));
  return pickProgrammes({ channels, listings: (item) => epg.listings(item.id), notes: state.interests, reminded, limit: PICKS });
}

/** The page drawn again a moment after programme data arrives, once for a burst. */
export function refreshIdleSoon() {
  // Only the idle page is drawn again: the overlay may be saying something
  // else — an error, a wait — and that is not to be painted over.
  const idle = () => !state.playing && !el.overlay.hidden && !el.overlay.classList.contains('loading') && el.overlayTitle.textContent === t('player.idle');
  if (idleRefresh || !idle()) return;
  idleRefresh = setTimeout(() => {
    idleRefresh = null;
    if (idle()) renderIdleOverlay();
  }, 400);
}

/** A pick: the programme, its channel, when, and why it was picked. */
export function pickCard(pick) {
  const { channel, programme, on, why } = pick;
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'idle-pick' + (on ? ' on' : '');
  const reminded = reminders.has(reminderKey(channel, programme));
  if (reminded) card.classList.add('reminded');
  const name = shownName(channel);
  card.title = on ? t('picks.play', { channel: name }) : t(reminded ? 'picks.reminded' : 'picks.remind');
  const logo = poster('idle-pick-logo', channel.logo, 'channel');
  const body = document.createElement('span');
  body.className = 'idle-pick-body';
  const when = document.createElement('span');
  when.className = 'idle-pick-when';
  when.textContent = on ? t('picks.now', { time: clock(programme.stop) })
    : dayLabel(programme.start) === t('day.today') ? t('picks.today', { time: clock(programme.start) })
    : `${dayLabel(programme.start)} ${clock(programme.start)}`;
  if (!on) {
    const bell = document.createElement('i');
    bell.className = 'idle-pick-bell';
    bell.setAttribute('aria-hidden', 'true');
    when.prepend(bell);
  }
  const title = document.createElement('span');
  title.className = 'idle-pick-title';
  title.textContent = programme.title;
  const where = document.createElement('span');
  where.className = 'idle-pick-where';
  where.textContent = `${name}, ${t(`picks.why.${why}`)}`;
  body.append(when, title, where);
  card.append(logo, body);
  if (on) {
    const bar = document.createElement('div');
    bar.className = 'row-progress';
    const fill = document.createElement('i');
    fill.style.width = `${Math.round((progressOf(programme) || 0) * 100)}%`;
    bar.appendChild(fill);
    card.appendChild(bar);
  }
  card.addEventListener('click', () => {
    if (on) { playFromHome(channel); return; }
    toggleReminder(channel, programme);
    renderIdleOverlay();
  });
  return card;
}
