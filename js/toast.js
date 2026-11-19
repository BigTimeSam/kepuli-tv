// The message strip at the bottom of the window (toast), with an optional
// action button, and copying a stream address to the clipboard.
//
// Moved out of app.js. It takes the player's state, and the parts app.js
// builds, from js/state.js.

import { duration } from './format.js';
import { el } from './dom.js';
import { t } from './i18n.js';
import { state } from './state.js';
import { remote } from './platform.js';

let toastTimer = null;
// A message that came while the viewer was on the strip's button (Undo,
// say): shown once they have left it or pressed it, not in its place. A
// later message had taken Undo away from under the keyboard's focus.
let waiting = null;
// With a remote control (js/remote.js) the strip's button takes the focus
// as it appears: there is no pointer to reach it with, and the arrows may
// be a list's own. This is where the focus came from, to go back to.
let returnTo = null;
function leave() {
  if (returnTo?.isConnected && el.toast.contains(document.activeElement)) returnTo.focus({ preventScroll: true });
  returnTo = null;
}

/**
 * Whether a drag of the strip, in pixels from where it began, puts it
 * away: sideways either way or downwards, far enough not to be a press
 * that slipped. Upwards is into what the strip lies over, and does nothing.
 */
export const swipedAway = (dx, dy) => Math.abs(dx) >= 48 || dy >= 24;

// The strip pushed away by a finger (or a mouse). A reminder's stays for
// a minute, and on a phone it lay over the bar under the picture all that
// time with no way of being rid of it but its own button, which starts
// the channel (the owner, on an iPhone, 2026-11-19). The strip follows
// the finger so that the gesture is seen to be taken; its button is left
// its press, as a drag that goes nowhere is no swipe.
let drag = null;
function settle() {
  drag = null;
  el.toast.style.translate = '';
  el.toast.style.opacity = '';
}
el.toast.addEventListener('pointerdown', (e) => {
  if (e.button > 0) return;
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
});
el.toast.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x;
  const dy = Math.max(0, e.clientY - drag.y);
  if (Math.abs(dx) < 6 && dy < 6) return;
  // Held from here on, so that the drag goes on outside the strip.
  if (!el.toast.hasPointerCapture(e.pointerId)) { try { el.toast.setPointerCapture(e.pointerId); } catch { /* the pointer is gone */ } }
  const sideways = Math.abs(dx) >= dy;
  el.toast.style.translate = sideways ? `${dx}px 0` : `0 ${dy}px`;
  el.toast.style.opacity = String(Math.max(0.3, 1 - Math.max(Math.abs(dx) / 160, dy / 80)));
});
el.toast.addEventListener('pointerup', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const away = swipedAway(e.clientX - drag.x, e.clientY - drag.y);
  settle();
  if (away) dismissToast();
});
el.toast.addEventListener('pointercancel', settle);
// The press that ends a swipe begun on the strip's button is not the button's.
el.toast.addEventListener('click', (e) => { if (el.toast.hidden) e.stopPropagation(); }, true);

/** The strip put away unpressed, as Back does on a remote control. */
export function dismissToast() {
  clearTimeout(toastTimer);
  leave();
  el.toast.hidden = true;
  next();
}

function next() {
  if (!waiting) return;
  const [text, options] = waiting;
  waiting = null;
  toast(text, options);
}
/**
 * The message strip at the bottom of the window. `kind` colours it: an error
 * arrives in red, a warning in yellow, and everything else keeps the panel's
 * own tone. Each kind brings its own icon, so the colour is never the only
 * thing that separates a failure from a note.
 */
export function toast(text, { long = false, kind = 'info', action = null, duration = null } = {}) {
  if (!el.toast.hidden && el.toast.querySelector('.toast-action') && el.toast.matches(':focus-within')) {
    waiting = [text, { long, kind, action, duration }];
    return;
  }
  el.toastText.textContent = text;
  // A message that names what is wrong can carry the thing that fixes it:
  // "Programme data is switched off in settings" said so and then left the
  // viewer to find the switch. One button is shorter than that sentence.
  el.toast.querySelector('.toast-action')?.remove();
  if (action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toast-action';
    button.textContent = action.label;
    button.addEventListener('click', () => { clearTimeout(toastTimer); leave(); el.toast.hidden = true; action.onClick(); next(); });
    el.toast.appendChild(button);
  }
  el.toast.classList.remove('info', 'warn', 'error');
  el.toast.classList.add(kind);
  // An error interrupts the reader; the rest can wait for a pause in speech.
  // Emptied first and filled a moment later, so that the same message
  // twice is announced twice.
  el.toastLive.setAttribute('aria-live', kind === 'error' ? 'assertive' : 'polite');
  el.toastLive.textContent = '';
  setTimeout(() => { el.toastLive.textContent = text; }, 50);
  el.toast.hidden = false;
  if (action && remote) {
    returnTo = /** @type {HTMLElement} */ (document.activeElement);
    /** @type {HTMLElement} */ (el.toast.querySelector('.toast-action')).focus();
  }
  clearTimeout(toastTimer);
  // An error deserves the time it takes to read it, and so does a message
  // with something in it to press. A strip that holds the pointer or the
  // focus stays until they leave it: seven seconds were too short to reach
  // Undo with the keyboard or a screen reader (WCAG 2.2.1).
  // Under a finger there is no pointer to leave it: WebKit keeps :hover on
  // what was touched last until something else is, so a strip that had
  // been touched (a swipe that fell short) never went by itself.
  const held = () => el.toast.matches(':focus-within') || (matchMedia('(hover: hover)').matches && el.toast.matches(':hover'));
  const hide = () => {
    if (held()) toastTimer = setTimeout(hide, 1000);
    else { el.toast.hidden = true; next(); }
  };
  toastTimer = setTimeout(hide, duration ?? (long || action ? 7000 : 2800));
}

/** The strip taken away before its time: what it offered was done another way. */
export function hideToast() {
  clearTimeout(toastTimer);
  el.toast.hidden = true;
  next();
}

/**
 * The address carries the account's user name and password in it, so the
 * message says so: it is about to be pasted somewhere. A write the browser
 * refuses — the page not in focus, the permission withheld — is said too,
 * rather than left looking like a copy that worked.
 */
export async function copyUrl() {
  if (!state.playingSpec) return;
  try {
    await navigator.clipboard.writeText(state.playingSpec.url);
  } catch (err) {
    console.warn('[iptv] the clipboard refused the address:', err);
    toast(t('player.copyfailed'), { kind: 'error' });
    return;
  }
  toast(t('player.copied'), { long: true });
}
