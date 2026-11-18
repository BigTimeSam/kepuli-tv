#!/usr/bin/env node
// The built extension driven in this Mac's Safari, by AppleScript.
//
//   node safari/drive.mjs start [unsigned]      Safari started with the extension on and the player open
//   node safari/drive.mjs off                   the extension turned off (before a rebuild: Safari reads its files when it is turned on)
//   node safari/drive.mjs eval '<expression>'   JavaScript run in the player's page; its value printed
//   node safari/drive.mjs press '<words>'       a real press on the page's element whose name holds the words
//   node safari/drive.mjs dialog ['<button>']   Safari's permission dialog: its text, or the button clicked
//
// Safari has no DevTools protocol to drive as the Chrome tools do, and
// WebDriver will not open an extension's page. What works (measured in
// Safari 26.5, safari/AGENTS.md has the whole of it): "do JavaScript" in
// the extension's tab once "Allow JavaScript from Apple Events" is on, and
// the accessibility API through System Events for everything that is
// Safari's own: its settings, its dialogs, and a press that counts as the
// viewer's (AXPress), which a click made by script does not.
//
// `eval` gives up after KEPULI_SAFARI_WAIT seconds (15): while Safari's
// permission dialog is up it answers no Apple Events at all, and the
// question would hang for two minutes.

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), 'scripts');
const WAIT = Number(process.env.KEPULI_SAFARI_WAIT || 15) * 1000;

/** One of the scripts run with its arguments: what it returned, or null when it gave no answer in time. */
export function script(name, args = [], timeout = 60000) {
  const done = spawnSync('osascript', [join(SCRIPTS, `${name}.applescript`), ...args], { encoding: 'utf8', timeout });
  if (done.error && /** @type {any} */ (done.error).code === 'ETIMEDOUT') return null;
  if (done.status !== 0) throw new Error((done.stderr || '').trim() || `${name} failed`);
  return done.stdout.replace(/\n$/, '');
}

/** `unsigned`: tick Safari's switch for an ad hoc signed extension first (safari/build.mjs without a team). */
export const start = (unsigned = false) => script('start', unsigned ? ['unsigned'] : [], 120000);
export const off = () => script('off', [], 90000);
export const evaluate = (expression) => script('eval', [expression], WAIT);
export const press = (words) => script('press', [words]);
export const dialog = (button) => script('dialog', button ? [button] : []);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, arg] = process.argv.slice(2);
  const run = { start: () => start(arg === 'unsigned'), off, eval: () => evaluate(arg), press: () => press(arg), dialog: () => dialog(arg) }[command];
  if (!run || (['eval', 'press'].includes(command) && !arg)) {
    console.error('usage: node safari/drive.mjs start [unsigned] | off | eval <expression> | press <words> | dialog [button]');
    process.exit(2);
  }
  const said = run();
  console.log(said === null ? 'no answer in time: is a dialog of Safari\'s up? (node safari/drive.mjs dialog)' : said);
  process.exit(said === null ? 1 : 0);
}
