// @ts-check
// The help dialog: the keyboard shortcuts, the guide's keys, and the note on
// why the browser's back button leaves the player.
//
// Moved out of app.js. It takes the player's state, and the parts app.js
// builds, from js/state.js.

import { $ } from './dom.js';
import { t } from './i18n.js';
import { inApp, ios, remote } from './platform.js';

/**
 * The shortcuts, the few that nearly everyone needs first — the picture,
 * then finding something to watch — and the rest behind a fold. The key
 * column is written out rather than translated — ↑ is ↑ in every language —
 * and the sentence beside it is not.
 */
const SHORTCUTS = [
  ['Space', 'help.key.pause'],
  ['f', 'help.key.fullscreen'],
  ['m', 'help.key.mute'],
  ['/', 'help.key.search'],
  ['↑ ↓ PgUp PgDn', 'help.key.move'],
  ['Enter', 'help.key.open'],
  ['Backspace', 'help.key.back'],
  ['g', 'help.key.guide'],
];
const MORE_SHORTCUTS = [
  ['Tab', 'help.key.tab'],
  ['n  p', 'help.key.nextprev'],
  ['l', 'help.key.lastchannel'],
  ['a', 'help.key.audio'],
  ['+  −', 'help.key.subsize'],
  ['s', 'help.key.star'],
  ['Shift+F10', 'help.key.menu'],
  ['Delete', 'help.key.remove'],
  ['x', 'help.key.external'],
  ['c', 'help.key.cast'],
  ['?', 'help.key.help'],
];

/**
 * A television's remote has none of those keys: the help there names what
 * its few do (js/remote.js). A key that has a word for a name is given by
 * its string, the others as they are.
 */
const REMOTE_KEYS = [
  ['↑ ↓ ← →', 'help.remote.move'],
  ['OK', 'help.remote.ok'],
  ['help.remote.hold', 'help.remote.star'],
  ['help.remote.backkey', 'help.remote.back'],
  ['help.remote.full', 'help.remote.fullkeys'],
];

/**
 * The Android app on a phone or a tablet is driven by touch, and a list of
 * keys said nothing there about what a finger does that a mouse does not,
 * or about what the app does when it is left. The keys stay behind the
 * fold, for a tablet with a keyboard.
 */
const APP_HELP = [
  ['help.app.hold', 'help.app.menu'],
  ['help.remote.backkey', 'help.remote.back'],
  ['help.app.home', 'help.app.pip'],
  ['help.app.dark', 'help.app.sound'],
];

/**
 * The help, inside the app. It used to be a link to an 83 kB page written for
 * whoever builds the player, opened in another tab at the moment the viewer
 * was least sure of themselves — and the thirteen keys the player answers to
 * were named nowhere the player itself could show them.
 */
export function openHelp() {
  const rows = (list) => list.flatMap(([key, id]) => {
    const dt = document.createElement('dt');
    dt.textContent = key.startsWith('help.') ? t(key) : key;
    const dd = document.createElement('dd');
    dd.textContent = t(id);
    return [dt, dd];
  });
  const dialog = /** @type {HTMLDialogElement} */ ($('help'));
  // In an app the help begins with what a finger does (on the iPhone and
  // the iPad three sentences in player.html, on Android APP_HELP), and the
  // keys are for a keyboard joined to a tablet: on a phone the help was a
  // list of keys and nothing else. All of them wait behind the one fold,
  // named for what it holds, and open where something hovers: a trackpad,
  // which comes with most such keyboards.
  const app = ios || inApp;
  $('help-keys').replaceChildren(...rows(remote ? REMOTE_KEYS : ios ? [] : inApp ? APP_HELP : SHORTCUTS));
  if (remote) $('help-shortcuts').textContent = t('help.remote');
  $('help-keys-more').replaceChildren(...rows(app ? [...SHORTCUTS, ...MORE_SHORTCUTS] : MORE_SHORTCUTS));
  if (app) {
    const fold = /** @type {HTMLDetailsElement} */ (dialog.querySelector('.help-more'));
    const label = /** @type {HTMLElement} */ (fold.querySelector('.section-label'));
    label.dataset.i18n = 'help.shortcuts';
    label.textContent = t('help.shortcuts');
    if (!dialog.open) fold.open = matchMedia('(any-hover: hover)').matches;
  }
  if (!dialog.open) dialog.showModal();
}
