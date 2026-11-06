// @ts-check
// The help dialog: the keyboard shortcuts, the guide's keys, and the note on
// why the browser's back button leaves the player.
//
// Moved out of app.js. It takes the player's state, and the parts app.js
// builds, from js/state.js.

import { $ } from './dom.js';
import { t } from './i18n.js';

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
 * The help, inside the app. It used to be a link to an 83 kB page written for
 * whoever builds the player, opened in another tab at the moment the viewer
 * was least sure of themselves — and the thirteen keys the player answers to
 * were named nowhere the player itself could show them.
 */
export function openHelp() {
  const rows = (list) => list.flatMap(([key, id]) => {
    const dt = document.createElement('dt');
    dt.textContent = key;
    const dd = document.createElement('dd');
    dd.textContent = t(id);
    return [dt, dd];
  });
  $('help-keys').replaceChildren(...rows(SHORTCUTS));
  $('help-keys-more').replaceChildren(...rows(MORE_SHORTCUTS));
  const dialog = /** @type {HTMLDialogElement} */ ($('help'));
  if (!dialog.open) dialog.showModal();
}
