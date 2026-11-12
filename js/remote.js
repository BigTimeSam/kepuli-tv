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

import { $, el } from './dom.js';
import { state, vlist } from './state.js';
import { towards } from './listnavigation.js';
import { gridColumns } from './coversui.js';
import { enterFullscreen, togglePause } from './playercontrols.js';
import { remote } from './caret.js';
import { dismissToast } from './toast.js';

export { remote };

const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
// What the focus may go to. The stars and the menus inside rows are left
// out, as they are from the tab order: OK held down reaches them.
const CONTROLS = 'a[href], button, input, select, textarea, summary, [tabindex]';
// The layers that walk their own items with the arrows.
const OWN_ARROWS = '.picker-pop, .row-menu, #topmenu-pop, #more-pop';
const HOLD_MS = 600;
const BANNER_MS = 5000;
const SEEK_S = 10;

let hooks = null;
// OK going down on a row, until it comes up or has been held long enough.
let held = null;

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
  if (!remote) return;
  hooks = app;
  document.documentElement.classList.add('tv');
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('keyup', onKeyUp, true);
  // A field the focus arrives at keeps the keyboard down until OK asks for it.
  document.addEventListener('focusin', (e) => { if (!typing && isText(e.target)) /** @type {HTMLElement} */ (e.target).inputMode = 'none'; }, true);
  // The app sent to the background stops the picture (the television's
  // Home, or Back from the list); brought back, it goes on by itself, as a
  // television does, rather than standing still until OK is found.
  let wasPlaying = false;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) wasPlaying = !el.video.paused;
    else if (wasPlaying && el.video.paused) togglePause();
  });
  // Out of full screen the keys go back to the list the channel came from.
  document.addEventListener('fullscreenchange', () => { showBanner(); if (!document.fullscreenElement) focusList(); });
}

// A field being handed to the television's keyboard, in onKeyDown.
let typing = false;
const isText = (node) => node instanceof HTMLTextAreaElement
  || (node instanceof HTMLInputElement && !['checkbox', 'radio', 'range', 'button', 'submit', 'file', 'color'].includes(node.type));

// What a folded section holds still has a box (content-visibility), and
// took the arrow without taking the focus: checkVisibility knows better.
const visible = (node) => node.getClientRects().length > 0 && node.checkVisibility({ visibilityProperty: true });
const listShown = () => visible(el.list);
const focusList = () => { if (listShown()) el.list.focus({ preventScroll: true }); };

/** The layer the focus is kept in: the topmost menu or dialog, else the page. */
function layer() {
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
  const next = nodes[towards(from, nodes.map((node) => node.getBoundingClientRect()), way)];
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

function seek(seconds) {
  const { video } = el;
  if (!Number.isFinite(video.duration)) return;
  video.currentTime = Math.max(0, Math.min(video.duration - 1, video.currentTime + seconds));
}

const swallow = (e) => { e.preventDefault(); e.stopPropagation(); };

function onKeyDown(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const active = /** @type {HTMLElement} */ (document.activeElement || document.body);

  switch (e.key) {
    case 'MediaPlayPause': case 'MediaPlay': case 'MediaPause': swallow(e); togglePause(); return;
    case 'MediaFastForward': swallow(e); seek(3 * SEEK_S); return;
    case 'MediaRewind': swallow(e); seek(-3 * SEEK_S); return;
    case 'MediaTrackNext': case 'ChannelUp': swallow(e); hooks.zap(1); showBanner(); return;
    case 'MediaTrackPrevious': case 'ChannelDown': swallow(e); hooks.zap(-1); showBanner(); return;
    default: break;
  }

  // The picture full screen: the keys are the picture's.
  if (document.fullscreenElement === el.videowrap && !document.querySelector(':popover-open')) {
    if (e.key === 'ArrowDown') { swallow(e); hooks.zap(1); showBanner(); }
    else if (e.key === 'ArrowUp') { swallow(e); hooks.zap(-1); showBanner(); }
    else if (e.key === 'ArrowRight') { swallow(e); seek(SEEK_S); }
    else if (e.key === 'ArrowLeft') { swallow(e); seek(-SEEK_S); }
    else if (e.key === 'Enter') { swallow(e); if (!e.repeat) { togglePause(); showBanner(); } }
    return;
  }

  const zone = zoneOf(active);

  if (e.key === 'Escape') {
    // Whatever is open closes itself on Escape; a field gives its text up
    // first. Only a page with nothing open is ours to step back from.
    if (document.fullscreenElement || layer() !== document.body || !el.listProgress.hidden) return;
    if (el.toast.contains(active)) { swallow(e); dismissToast(); return; }
    if (active.matches('input, textarea, select')) { setTimeout(() => { if (document.activeElement === active) focusList(); }, 0); return; }
    swallow(e);
    if (hooks.back()) return;
    if (zone !== 'list' && listShown()) focusList();
    else window.close();
    return;
  }

  if (e.key === 'Enter') {
    const holdable = zone === 'list' || zone === 'groups' || active.matches('.chip-main');
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
      if (e.repeat || held) return;
      held = { active, zone, timer: setTimeout(() => { held.timer = 0; if (zone === 'list') hooks.menu(); else hooks.star(); }, HOLD_MS) };
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
