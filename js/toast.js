// The message strip at the bottom of the window (toast), with an optional
// action button, and copying a stream address to the clipboard.
//
// Moved out of app.js. It takes the player's state, and the parts app.js
// builds, from js/state.js.

import { duration } from './format.js';
import { el } from './dom.js';
import { t } from './i18n.js';
import { state } from './state.js';
import { remote } from './caret.js';

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
  const hide = () => {
    if (el.toast.matches(':hover, :focus-within')) toastTimer = setTimeout(hide, 1000);
    else { el.toast.hidden = true; next(); }
  };
  toastTimer = setTimeout(hide, duration ?? (long || action ? 7000 : 2800));
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
