#!/usr/bin/env node
// The Firefox development loop, the counterpart of dev/dev.mjs.
//
// Assembles firefox/dist/ from the shared source, starts Firefox with a
// profile of its own, loads the extension as a temporary add-on, opens the
// player, and on every change to the source rebuilds and reloads: the page
// alone for js/, css/ and player.html, the whole add-on when
// firefox/manifest.json or background.js changes. Everything goes over
// Marionette (firefox/marionette.mjs); nothing is installed.
//
//   node firefox/dev.mjs
//
// The profile is ~/.cache/kepuli-tv-firefox, separate from your own
// browser: credentials are entered once and then persist. A temporary
// add-on is gone when Firefox closes, so the next run installs it again —
// the profile's storage, credentials included, survives that.
// KEPULI_FIREFOX_PORT, KEPULI_FIREFOX_PROFILE and KEPULI_FIREFOX (the
// binary) override the defaults.

import { watch } from 'node:fs';
import { build, DIST, ROOT } from './build.mjs';
import { ensureFirefox, session, sleep } from './marionette.mjs';

const PAGE = 'player.html';
const NEEDS_ADDON_RELOAD = new Set(['background.js', 'firefox/manifest.json']);
const WATCHED = /\.(js|css|html|json)$/;

const log = (msg) => console.log(`${new Date().toTimeString().slice(0, 8)}  ${msg}`);

function watchSources(onChange) {
  watch(ROOT, { recursive: true }, (_event, file) => {
    if (!file) return;
    const path = file.replaceAll('\\', '/');
    if (path.startsWith('.') || path.includes('/.')) return;
    if (path.startsWith('dev/') || path.startsWith('icons/') || path.startsWith('docs/')) return;
    // The build's own copies, and the Chrome manifest, which Firefox does not read.
    if (path.startsWith('firefox/dist/') || path === 'manifest.json') return;
    if (path.startsWith('firefox/') && path !== 'firefox/manifest.json') return;
    if (!WATCHED.test(path)) return;
    onChange(path);
  });
}

/* -------------------------------------------------------------------- main */

let summary = build();
log(`firefox/dist: ${summary.files} files, version ${summary.version}`);
const started = await ensureFirefox();
if (started) log('Firefox started');
const firefox = await session();
let id = await firefox.installTemporary(DIST);
let url = await firefox.extensionUrl(id, PAGE);
await openPlayer();

/** The player into whichever tab is available, see ensureWindow. */
async function openPlayer() {
  await firefox.ensureWindow();
  await firefox.navigate(url);
}

console.log('');
log(`Add-on loaded: ${id}`);
log(`Player: ${url}`);
log('Watching for changes — stop with Ctrl+C');
console.log('');

const changed = new Set();
let pending = null;
let busy = false;

watchSources((path) => {
  changed.add(path);
  clearTimeout(pending);
  pending = setTimeout(apply, 120);
});

async function apply() {
  if (busy) { pending = setTimeout(apply, 200); return; }
  if (changed.size === 0) return;
  const paths = [...changed];
  changed.clear();
  busy = true;
  const label = paths.length === 1 ? paths[0] : `${paths[0]} (+${paths.length - 1})`;
  try {
    summary = build();
    if (paths.some((p) => NEEDS_ADDON_RELOAD.has(p))) {
      // Installing over the temporary add-on again is a reload — measured;
      // it closes the add-on's pages, which openPlayer allows for.
      log(`${label} → reloading the add-on`);
      id = await firefox.installTemporary(DIST);
      url = await firefox.extensionUrl(id, PAGE);
      await sleep(300);
      await openPlayer();
    } else {
      log(`${label} → reloading the page`);
      // The viewer may have closed the tab; then the player is opened afresh.
      await firefox.refresh().catch(() => openPlayer());
    }
  } catch (err) {
    log(`error: ${err.message}`);
  } finally {
    busy = false;
  }
}

process.on('SIGINT', () => {
  console.log('\nWatch stopped. Firefox stays open; the add-on stays until it closes.');
  firefox.close();
  process.exit(0);
});
