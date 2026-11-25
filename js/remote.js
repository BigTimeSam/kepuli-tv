// The player driven by a television's remote control: four arrows, OK and
// Back, and the media keys a remote may have.
//
// A keyboard reaches everything with Tab and the player's letters (f, s,
// g, n…); a remote has neither. Here the arrows carry the focus instead:
// an arrow goes to the nearest control that way, wherever it is on the
// page. The parts that have arrows of their own keep them up to their
// edge — the list and the sidebar walk their rows, the guide its grid, a
// text field its caret — and at the edge the arrow leaves for whatever
// lies beyond. OK presses what has the focus; held down, it opens the
// row's menu, or stars a country or a topic. Back is Escape: it closes
// what is open, then returns to the list, and from the list it leaves the
// app (window.close(), which the Android app answers by stepping back).
//
// With the picture full screen the arrows are the picture's: up and down
// change the channel, left and right move ten seconds in a film, OK pauses,
// and what is on is named over the picture for a moment, since the full
// screen covers the head and the strip that say it.
//
// A text field with the focus would bring up the television's keyboard,
// which takes the arrows to itself: the focus passes through a field
// without it (inputmode none), and OK on the field brings the keyboard up.
//
// All of it is off unless the page is opened as player.html?tv=1, which is
// how the Android TV app opens it (android/), and how a test opens it in a
// desktop browser. Nothing here runs for a viewer with a keyboard.
//
// The Android app on a phone or a tablet opens player.html?app=1 instead:
// touch drives the player there as it does in Firefox for Android, and its
// Back, which that app sends as Escape too, is js/androidapp.js's.

import { $, el } from './dom.js';
import { state, vlist } from './state.js';
import { scrubStep, towards } from './listnavigation.js';
import { gridColumns } from './coversui.js';
import { enterFullscreen, togglePause } from './playercontrols.js';
import { nativePlace, nativePlaying, nativeRunning, nativeSeek } from './nativeplayer.js';
import { remote } from './platform.js';
import { dismissToast, toast } from './toast.js';
import { t } from './i18n.js';


const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
// What the focus may go to. The stars and the menus inside rows are left
// out, as they are from the tab order: OK held down reaches them.
const CONTROLS = 'a[href], button, input, select, textarea, summary, [tabindex]';
// The layers that walk their own items with the arrows.
const OWN_ARROWS = '.picker-pop, .row-menu, #topmenu-pop, #more-pop';
const HOLD_MS = 600;
const BANNER_MS = 5000;

let hooks = null;
// OK going down on a row, until it comes up or has been held long enough.
let held = null;

// Back from the list leaves the app only when pressed again within this
// time: Back is pressed several times in a row to get out of the picture
// or a menu, and one press too many put the viewer out of the app.
const LEAVE_MS = 3000;
let leaving = 0;

/**
 * @param {object} app what the remote asks of the player:
 *   open() plays or opens the list's row, first() puts the cursor on the
 *   list's first row, group(index) the sidebar's cursor on a row that is
 *   there, menu() opens the row's menu, star()
 *   stars the country or the topic with the focus, zap(delta) changes the
 *   channel, back() closes the guide or a series' page and says whether it
 *   did, guideRow() is the guide's row while the guide is open, else -1.
 */
export function wireRemote(app) {
  hooks = app;
  if (!remote) return;
  document.documentElement.classList.add('tv');
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('keyup', onKeyUp, true);
  // A field the focus arrives at keeps the keyboard down until OK asks for it.
  document.addEventListener('focusin', (e) => { if (!typing && isText(e.target)) /** @type {HTMLElement} */ (e.target).inputMode = 'none'; }, true);
  // The app sent to the background stops the picture (the television's
  // Home, or Back from the list); brought back, it goes on by itself, as a
  // television does, rather than standing still until OK is found.
  // The app's own picture (js/nativeplayer.js) does not stop with the
  // page as the page's does: it is paused here, and goes on the same way.
  let wasPlaying = false;
  const running = () => nativeRunning() ?? !el.video.paused;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { wasPlaying = running(); if (wasPlaying && nativePlaying()) togglePause(); }
    else if (wasPlaying && !running()) togglePause();
  });
  // Out of full screen the keys go back to the list the channel came from.
  document.addEventListener('fullscreenchange', () => { showBanner(); if (!document.fullscreenElement) { endScrub(false); focusList(); } });
}

// A field being handed to the television's keyboard, in onKeyDown.
let typing = false;
export const isText = (node) => node instanceof HTMLTextAreaElement
  || (node instanceof HTMLInputElement && !['checkbox', 'radio', 'range', 'button', 'submit', 'file', 'color'].includes(node.type));

// What a folded section holds still has a box (content-visibility), and
// took the arrow without taking the focus: checkVisibility knows better.
const visible = (node) => node.getClientRects().length > 0 && node.checkVisibility({ visibilityProperty: true });
const listShown = () => visible(el.list);
const focusList = () => { if (listShown()) el.list.focus({ preventScroll: true }); };

/**
 * A country, a genre or a topic was chosen with the remote: the cursor
 * stands on the first row of what it lists, since the rows are what a
 * viewer wants next. The topics are drawn again by the choice, so the
 * focus was on nothing at all afterwards; their fold closes as well.
 * @param {Promise<unknown>} listed the list being drawn
 * @param {boolean} [fold] the choice was made in the channels' fold
 */
export async function listChosen(listed, fold = false) {
  if (!remote) return;
  await listed;
  if (fold) $('channel-filters').open = false;
  if (!listShown()) return;
  focusList();
  if (state.cursor < 0) hooks.first();
}

/** The layer the focus is kept in: the topmost menu or dialog, else the page. */
export function layer() {
  const pops = document.querySelectorAll(':popover-open');
  if (pops.length) return pops[pops.length - 1];
  for (const pop of [el.morePop, el.sublookPop, document.getElementById('topmenu-pop')]) if (pop && !pop.hidden) return pop;
  const dialogs = document.querySelectorAll('dialog[open]');
  if (dialogs.length) return dialogs[dialogs.length - 1];
  return document.fullscreenElement || document.body;
}

/** The part that has rows of its own under the focus: 'list', 'groups', 'guide' or ''. */
function zoneOf(active) {
  if (hooks.guideRow() >= 0 && (active === document.body || active.id === 'epg-scroll')) return 'guide';
  if (active === el.groups) return 'groups';
  if ((active === el.list || active === document.body) && listShown()) return 'list';
  return '';
}

/** Whether the part with the focus still has somewhere to go that way itself. */
function ownsArrow(active, zone, [dx, dy]) {
  if (zone === 'guide') return !(dy < 0 && hooks.guideRow() === 0);
  if (zone === 'groups') {
    const to = state.groupCursor + dy;
    return dy !== 0 && to >= 0 && to < el.groups.children.length;
  }
  if (zone === 'list') {
    const count = state.rows.length;
    if (dy) { const to = state.cursor + dy * gridColumns; return to >= 0 && to < count; }
    if (gridColumns < 2) return false;
    const column = state.cursor % gridColumns;
    return dx < 0 ? column > 0 : column < gridColumns - 1 && state.cursor + 1 < count;
  }
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    if (active.type === 'range') return dx !== 0;
    if (!dx || active.type === 'checkbox' || active.type === 'radio') return false;
    // The caret moves within the text and leaves the field from its end.
    try {
      return dx < 0 ? active.selectionStart > 0 : active.selectionEnd < active.value.length;
    } catch { return false; /* a type without a caret to ask about */ }
  }
  return false;
}

/** The box the way is measured from: the row the cursor is on, in a list. */
function boxOf(node, zone) {
  if (zone === 'list') {
    const box = (vlist.nodes.get(state.cursor) || el.list).getBoundingClientRect();
    const frame = el.list.getBoundingClientRect();
    return box.bottom > frame.top && box.top < frame.bottom ? box : frame;
  }
  if (zone === 'groups') return (el.groups.children[state.groupCursor] || el.groups).getBoundingClientRect();
  return node.getBoundingClientRect();
}

/** Every control in the layer that an arrow may land on. */
function controls(root, active) {
  return [...root.querySelectorAll(CONTROLS)].filter((node) => {
    if (node === active || node.disabled || node.closest('[inert], [hidden]')) return false;
    if (node.matches('.skip-link, video')) return false;
    // A topic's star and a start page card's are not stops of their own:
    // OK held down on the topic or the card is its star, as on a row.
    if (node.matches('.chip-star, .idle-star')) return false;
    // A list is one stop, and its rows are its own.
    const within = node.closest('#list, #groups, #epg-scroll');
    if (within && within !== node) return false;
    if (node.tabIndex < 0 && !node.matches('button, #epg-scroll')) return false;
    return visible(node);
  });
}

function move(active, zone, way) {
  const from = boxOf(active, zone);
  const [dx] = way;
  // What a pane has scrolled out of sight is reached from within the pane,
  // by a control in line with it: from the bar under the list, Down led to
  // the far end of the details beside it, which lay below the window.
  const reachable = (box) => (box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth)
    || (dx ? box.bottom > from.top && box.top < from.bottom : box.right > from.left && box.left < from.right);
  const nodes = controls(layer(), active).filter((node) => reachable(node.getBoundingClientRect()));
  // A dialog that took the focus itself as it opened (js/modal.js) has
  // every control inside its own box and none in any direction from it:
  // the hidden channels' list could not be entered with a remote at all.
  // The first arrow there lands on its first control, the cross last.
  const next = active instanceof HTMLDialogElement
    ? nodes.find((node) => !node.matches('.modal-close')) || nodes[0]
    : nodes[towards(from, nodes.map((node) => node.getBoundingClientRect()), way)];
  if (!next) return false;
  if (isText(next)) next.inputMode = 'none';
  // A list just filled has no row chosen, and OK would press nothing.
  if (next === el.list && state.cursor < 0) hooks.first();
  // The sidebar's cursor may stand past the end of a list since narrowed.
  if (next === el.groups) hooks.group(state.groupCursor);
  if (next === el.list || next === el.groups || next.id === 'epg-scroll') next.focus({ preventScroll: true });
  else { next.focus(); next.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
  return true;
}

// The head over the picture and the strip under it, watched while the
// banner shows: the name is there at once, the programme a moment later.
let bannerTimer = 0;
let bannerWatch = null;

/** What is on, over the full-screen picture, for a few seconds. */
function showBanner() {
  const zap = $('zap');
  const head = $('now-title').closest('.stagehead');
  const strip = $('infostrip');
  const copy = (node) => { const twin = /** @type {HTMLElement} */ (node.cloneNode(true)); twin.removeAttribute('id'); return twin; };
  const paint = () => {
    const text = document.createElement('div');
    text.className = 'zap-text';
    text.append(copy($('now-title')), copy($('now-sub')));
    const programme = strip.querySelector('.epgnow');
    if (programme) text.append(copy(programme));
    zap.replaceChildren(copy($('now-logo')), text);
  };
  const hide = () => { zap.hidden = true; bannerWatch?.disconnect(); bannerWatch = null; };
  hide();
  if (document.fullscreenElement !== el.videowrap) return;
  paint();
  zap.hidden = false;
  bannerWatch = new MutationObserver(paint);
  for (const node of [head, strip]) bannerWatch.observe(node, { subtree: true, childList: true, characterData: true, attributes: true });
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(hide, BANNER_MS);
}

// Left and right in a film aim before they jump. A jump for every press
// made the picture stop to buffer at each, and a key held down got
// nowhere: the place aimed at is shown on a bar, a held key moves it in
// longer and longer steps (scrubStep), and the picture goes there once,
// when the keys have rested or OK is pressed. Back lets the aim go.
const SCRUB_REST_MS = 1000;
const SCRUB_EVERY_MS = 120;
/** @type {{ target: number, since: number, last: number, timer: number }|null} */
let scrub = null;

const stamp = (s) => {
  const whole = Math.max(0, Math.round(s));
  const two = (n) => String(n).padStart(2, '0');
  return `${Math.floor(whole / 3600)}:${two(Math.floor(whole / 60) % 60)}:${two(whole % 60)}`;
};

/** Where the picture is and how long it is: the app's own player's (js/nativeplayer.js), else the page's. */
function place() {
  const held = nativePlace();
  return held ? { now: held.position, length: held.duration ?? NaN } : { now: el.video.currentTime, length: el.video.duration };
}

function paintScrub() {
  const { now, length } = place();
  $('scrub-time').textContent = stamp(scrub.target);
  $('scrub-length').textContent = stamp(length);
  $('scrub-fill').style.width = `${(scrub.target / length) * 100}%`;
  $('scrub-now').style.left = `${(now / length) * 100}%`;
  $('scrub').hidden = false;
}

/** One step towards the end (1) or the start (-1); `steps` for the remote's own winding keys. */
function seek(way, steps = 1) {
  const video = { currentTime: place().now, duration: place().length };
  if (!Number.isFinite(video.duration) || !video.duration) return;
  const now = performance.now();
  // A key held down repeats faster than the eye follows the bar.
  if (scrub && now - scrub.last < SCRUB_EVERY_MS) return;
  // Presses that follow one another without a rest are one holding.
  if (!scrub) scrub = { target: video.currentTime, since: now, last: now, timer: 0 };
  else if (now - scrub.last > 400) scrub.since = now;
  scrub.last = now;
  scrub.target = Math.max(0, Math.min(video.duration - 1, scrub.target + way * steps * scrubStep(now - scrub.since)));
  clearTimeout(scrub.timer);
  scrub.timer = setTimeout(endScrub, SCRUB_REST_MS, true);
  paintScrub();
}

/** The aim taken (jump) or let go. */
function endScrub(jump) {
  if (!scrub) return;
  clearTimeout(scrub.timer);
  const { target } = scrub;
  scrub = null;
  $('scrub').hidden = true;
  if (jump && !nativeSeek(target) && Number.isFinite(el.video.duration)) el.video.currentTime = target;
}

export const swallow = (e) => { e.preventDefault(); e.stopPropagation(); };

function onKeyDown(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const active = /** @type {HTMLElement} */ (document.activeElement || document.body);

  switch (e.key) {
    case 'MediaPlayPause': case 'MediaPlay': case 'MediaPause': swallow(e); togglePause(); return;
    case 'MediaFastForward': swallow(e); seek(1, 3); return;
    case 'MediaRewind': swallow(e); seek(-1, 3); return;
    case 'MediaTrackNext': case 'ChannelUp': swallow(e); hooks.zap(1); showBanner(); return;
    case 'MediaTrackPrevious': case 'ChannelDown': swallow(e); hooks.zap(-1); showBanner(); return;
    default: break;
  }

  // The picture full screen: the keys are the picture's.
  if (document.fullscreenElement === el.videowrap && !document.querySelector(':popover-open')) {
    if (e.key === 'ArrowDown') { swallow(e); hooks.zap(1); showBanner(); }
    else if (e.key === 'ArrowUp') { swallow(e); hooks.zap(-1); showBanner(); }
    else if (e.key === 'ArrowRight') { swallow(e); seek(1); }
    else if (e.key === 'ArrowLeft') { swallow(e); seek(-1); }
    else if (e.key === 'Enter') { swallow(e); if (scrub) endScrub(true); else if (!e.repeat) { togglePause(); showBanner(); } }
    else if (e.key === 'Escape' && scrub) { swallow(e); endScrub(false); }
    return;
  }

  const zone = zoneOf(active);

  if (e.key === 'Escape') {
    // Whatever is open closes itself on Escape; a field gives its text up
    // first. Only a page with nothing open is ours to step back from.
    // A dialog is closed here rather than by the engine: GeckoView 160
    // fell over (a null pointer in libxul, on a Bravia and on the
    // emulator alike) when Escape closed the help, which has no cancel
    // handler of its own, and gave the focus back to the button that
    // opened it. The dialog is asked first, as the engine would ask it:
    // Settings holds on to unsaved changes that way.
    const top = layer();
    if (top instanceof HTMLDialogElement && !document.fullscreenElement) {
      swallow(e);
      if (top.dispatchEvent(new Event('cancel', { cancelable: true }))) top.close();
      return;
    }
    if (document.fullscreenElement || top !== document.body || !el.listProgress.hidden) return;
    if (el.toast.contains(active)) { swallow(e); dismissToast(); return; }
    if (active.matches('input, textarea, select')) { setTimeout(() => { if (document.activeElement === active) focusList(); }, 0); return; }
    swallow(e);
    if (hooks.back()) return;
    if (zone !== 'list' && listShown()) focusList();
    else if (Date.now() - leaving < LEAVE_MS) window.close();
    else { leaving = Date.now(); toast(t('remote.back.again'), { duration: LEAVE_MS }); }
    return;
  }

  if (e.key === 'Enter') {
    // A key still down after it was held: a remote control repeats it, and
    // the menu it opened has its first choice in the focus by then. On a
    // television the menu flashed and the channel was starred by the one
    // press. Nothing more comes of the press until it is let go.
    if (held) { swallow(e); return; }
    // The star that stands beside what has the focus (a start page's card).
    const beside = active.parentElement?.querySelector(':scope > .idle-star');
    const holdable = zone === 'list' || zone === 'groups' || active.matches('.chip-main') || Boolean(beside);
    if (isText(active) && active.inputMode === 'none') {
      // The keyboard comes up for a field as it takes the focus, so the
      // field takes it again, this time as one to be typed into.
      swallow(e);
      typing = true;
      active.removeAttribute('inputmode');
      active.blur();
      active.focus();
      typing = false;
    } else if (holdable) {
      swallow(e);
      if (e.repeat) return;
      held = { active, zone, timer: setTimeout(() => { held.timer = 0; if (zone === 'list') hooks.menu(); else if (beside) beside.click(); else hooks.star(); }, HOLD_MS) };
    } else if (active.matches('input[type="checkbox"], input[type="radio"]')) {
      // A remote has no Space, which is the key these answer to.
      swallow(e);
      if (!e.repeat) active.click();
    }
    return;
  }

  const way = ARROWS[e.key];
  if (!way) return;
  if (active.closest(OWN_ARROWS)) return;
  if (ownsArrow(active, zone, way)) {
    // A field's caret and a slider move by the browser's own hand; the
    // player's handler must not also move the list under them.
    if (!zone) e.stopPropagation();
    return;
  }
  // No way out that way: the page stays as it is rather than the list
  // moving under a button, but a text may still scroll.
  // A closed menu would step to its next choice instead.
  if (move(active, zone, way) || active instanceof HTMLSelectElement) e.preventDefault();
  e.stopPropagation();
}

function onKeyUp(e) {
  if (e.key !== 'Enter' || !held) return;
  const { active, zone, timer } = held;
  held = null;
  swallow(e);
  if (!timer) return;
  clearTimeout(timer);
  if (zone === 'list') {
    // OK on the channel already playing brings its picture to full screen.
    const item = state.rows[state.cursor];
    const playing = state.playing;
    if (item && playing && item.k === playing.k && String(item.id) === String(playing.id)) enterFullscreen();
    else if (state.cursor < 0) hooks.first();
    else hooks.open();
  } else if (zone === 'groups') el.groups.children[state.groupCursor]?.click();
  else active.click();
}
