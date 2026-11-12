#!/usr/bin/env node
// The Chrome Web Store screenshots: five views of the player, with dummy
// content. Starts the mock Xtream server (dev/mock/server.mjs), points the
// development Chrome's copy of the extension at it, walks through the views
// and captures each at 1280x800 into brand/screenshots/. Nothing on the
// pictures is real — every channel, title and plot is invented there.
//
//   sh dev/mock/media.sh              once: renders the dummy media with ffmpeg
//   node dev/store-screenshots.mjs
//
// KEPULI_DEMO_URL=https://kepuli-demo.fly.dev runs the same walk against the
// deployed demo instead of a local server — the check that what the store
// reviewers get really works — and KEPULI_SHOTS_DIR sets where the pictures go.
//
// For dev/visualcheck.mjs's further reference views, three more switches;
// none is set for the store pictures, which stay dark, 1280 wide and all five:
//
//   KEPULI_SHOTS_THEME=light      the light theme instead of the dark one
//   KEPULI_SHOTS_WIDTH=600        a narrower viewport (dev/screenshot.mjs), as
//                                 600 px gives the one-pane narrow layout
//   KEPULI_SHOTS_VIEWS=01-channels,05-movie
//                                 only these views (names without .png); the
//                                 walk stops once the last of them is taken;
//                                 01-channels-browse, the channel list's own
//                                 pane of the narrow layout (the playing
//                                 channel's pane is 01-channels there), is
//                                 taken only when asked for here
//
// The extension in the development profile is left pointing at the mock
// server; its settings dialog takes it back to a real one.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMockServer, PORT as MOCK_PORT, USER, PASS } from './mock/server.mjs';
// The same five views in either browser, as dev/playcheck.mjs runs the same
// scenarios in either: KEPULI_BROWSER=firefox swaps the driver underneath.
const FIREFOX = process.env.KEPULI_BROWSER === 'firefox';
const { ensureChrome, openPlayer, session, setViewport, clearViewport, capture, sleep, evaluate, waitFor } =
  await import(FIREFOX ? '../firefox/playcheck-driver.mjs' : './screenshot.mjs');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.KEPULI_SHOTS_DIR ? resolve(process.env.KEPULI_SHOTS_DIR)
  : join(ROOT, 'brand', FIREFOX ? 'firefox-screenshots' : 'screenshots');
const DEMO = process.env.KEPULI_DEMO_URL ? new URL(process.env.KEPULI_DEMO_URL) : null;
const THEME = process.env.KEPULI_SHOTS_THEME || 'dark';
if (!['dark', 'light'].includes(THEME)) throw new Error(`KEPULI_SHOTS_THEME is dark or light, not ${THEME}`);
const ONLY = process.env.KEPULI_SHOTS_VIEWS ? new Set(process.env.KEPULI_SHOTS_VIEWS.split(',').map((v) => v.trim()).filter(Boolean)) : null;

/* ------------------------------------------------------------ page helpers */


/**
 * Clicks the element under root whose text is `text` (or starts with it),
 * retrying while the view is still being painted. The click bubbles up to
 * the row's own handler, so a leaf inside the row is a fine target.
 */
async function click(page, root, text, { gesture = false, timeout = 10000 } = {}) {
  const expression = `(() => {
    const nodes = [...document.querySelectorAll(${JSON.stringify(root + ' *')})];
    const node = nodes.find((n) => n.children.length === 0 && n.textContent.trim() === ${JSON.stringify(text)})
      || nodes.find((n) => n.children.length === 0 && n.textContent.trim().startsWith(${JSON.stringify(text)}));
    if (!node) return false;
    node.click();
    return true;
  })()`;
  const t0 = Date.now();
  for (;;) {
    if (await evaluate(page, expression, { gesture })) return;
    if (Date.now() - t0 > timeout) throw new Error(`nothing called "${text}" under ${root}`);
    await sleep(200);
  }
}

const PLAYING = `(() => { const v = document.getElementById('video'); return v.readyState >= 2 && v.currentTime > 0.3 && !v.paused; })()`;
const CONNECTED = `document.querySelectorAll('#groups .group').length > 1 && document.getElementById('list-progress').hidden`;
const ROWS = `document.querySelectorAll('#list .row').length > 0 && document.getElementById('list-progress').hidden`;

/* -------------------------------------------------------------------- main */

mkdirSync(OUT, { recursive: true });
// The mock's account allows two streams for these pictures: the first view
// shows two channels side by side.
if (!DEMO) process.env.KEPULI_MOCK_CONNECTIONS = '2';
const server = DEMO ? null : await startMockServer(MOCK_PORT);
console.log(DEMO ? `against ${DEMO.origin}` : `mock server on http://127.0.0.1:${MOCK_PORT}`);
const connection = DEMO
  ? { scheme: DEMO.protocol.replace(':', ''), host: DEMO.hostname, port: DEMO.port || (DEMO.protocol === 'https:' ? '443' : '80') }
  : { scheme: 'http', host: '127.0.0.1', port: String(MOCK_PORT) };
await ensureChrome(['--autoplay-policy=no-user-gesture-required']);
const target = await openPlayer();
const page = session(target.webSocketDebuggerUrl);

// KEPULI_MOCK_NOW (dev/visualcheck.mjs): the page is opened with
// ?testnow= at the same moment as the mock server's clock (js/testclock.js),
// so the guide, the rows' programmes and the guide's clock are the same on
// every run. Time still passes from there, so playback and timers work.
const FROZEN = process.env.KEPULI_MOCK_NOW ? Date.parse(process.env.KEPULI_MOCK_NOW) : null;
const playerUrl = (url) => url.split('#')[0].split('?')[0] + (FROZEN === null ? '' : `?testnow=${FROZEN}`);

// KEPULI_SHOTS_MASKS: beside each picture, <name>.masks.json lists the boxes
// whose content changes by itself from one run to the next — the moving
// picture, the subtitles over it, progress bars, the guide's now line — for
// the visual check to leave out. The guide's live programmes carry their
// share played as a fill (.epg-prog > i) rounded to a per cent, which the
// clock running on during the walk moved by a pixel on some runs.
const MASKED = ['#video', '#video2', '#subdisplay', '#epg-preview video', '.row-progress', '.bar-fill', '.epgbar', '.nowbar',
  '.epg-bar', '.overlay-bar', '.overlay-elapsed', '.epg-nowline', '.epg-nowhead', '.list-progress', '.epg-prog > i'];
// Thrown by shoot once every view KEPULI_SHOTS_VIEWS asks for is taken: the
// rest of the walk only sets up views nobody wants.
class AllTaken extends Error {}
const taken = new Set();
async function shoot(name) {
  const view = name.replace(/\.png$/, '');
  if (ONLY && !ONLY.has(view)) return;
  const file = join(OUT, name);
  if (process.env.KEPULI_SHOTS_MASKS) {
    // Whether the guide's grid has taken the focus yet, and so draws its
    // ring, depends on timing: no focus, for the comparison's sake.
    await evaluate(page, `document.activeElement?.blur()`);
    await sleep(150);
    const boxes = await evaluate(page, `[...document.querySelectorAll(${JSON.stringify(MASKED.join(','))})]
      .filter((e) => e.getClientRects().length).map((e) => { const r = e.getBoundingClientRect();
        return [Math.floor(r.left) - 2, Math.floor(r.top) - 2, Math.ceil(r.right) + 2, Math.ceil(r.bottom) + 2]; })`);
    writeFileSync(file.replace(/\.png$/, '.masks.json'), JSON.stringify(boxes));
  }
  await capture(page, file);
  taken.add(view);
  if (ONLY && [...ONLY].every((v) => taken.has(v))) throw new AllTaken();
}

try {
  await page.call('Page.bringToFront');
  await setViewport(page);

  // Point the extension at the server and start from a clean slate: the
  // settings from storage, and the catalogue cache emptied — it is not keyed
  // by server, and an earlier run against another server would otherwise
  // hand out that server's addresses. The databases can only be deleted
  // once the app has let go of them, so that is done from a page of the
  // extension's origin that runs no app at all.
  // Whatever the development profile was left with — countries chosen,
  // channels hidden, favourites and history per account — goes first: the
  // pictures show the app as a new viewer meets it.
  await evaluate(page, `chrome.storage.local.get(null).then((all) => chrome.storage.local.remove(Object.keys(all).filter((k) => k.includes(':'))))`);
  await evaluate(page, `chrome.storage.local.set({
    config: { ...${JSON.stringify(connection)}, username: ${JSON.stringify(USER)}, password: ${JSON.stringify(PASS)}, sourceMode: 'xtream', streamMode: 'auto' },
    settings: { lang: 'en', theme: ${JSON.stringify(THEME)}, epgEnabled: true, resumeEnabled: true, subtitleLang: 'eng' },
    // secondHint: the once-only word on the second picture is not for the pictures.
    ui: { tab: 'live', secondHint: true }, favorites: [], recents: [], resume: {},
  })`);
  // URL.origin is null for an extension scheme, and Firefox's is moz-extension
  // with a uuid rather than Chrome's [a-p]{32}.
  const origin = target.url.match(/^(?:chrome|moz)-extension:\/\/[^/]+/)[0];
  await page.call('Page.navigate', { url: `${origin}/css/player.css` });
  await sleep(500);
  const dropped = await evaluate(page, `indexedDB.databases().then((dbs) => Promise.all(dbs.map((d) => new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(d.name);
    req.onsuccess = () => resolve(d.name); req.onerror = () => resolve(d.name + ' (error)'); req.onblocked = () => resolve(d.name + ' (blocked)');
  }))))`);
  console.log(`cache dropped: ${dropped.length ? dropped.join(', ') : 'nothing to drop'}`);
  // Without the place the player writes into its address: the shots are
  // taken from the view this script sets up, not from wherever the tab
  // was last left.
  await page.call('Page.navigate', { url: playerUrl(target.url) });
  await sleep(1000);
  await waitFor(page, CONNECTED, 'the connection to the server');
  // The compositor adopts the 2x viewport lazily; a throwaway capture makes
  // sure the first real one is not taken mid-change.
  await page.call('Page.captureScreenshot', { format: 'png' });
  await sleep(500);

  // 1. Channels: a country with its topics, programme data on the rows, a channel playing.
  await click(page, '#groups', 'Finland');
  await waitFor(page, ROWS, 'the channel list');
  await sleep(1500);                                   // programme data lands on the rows
  await click(page, '#list', 'Aurora One', { gesture: true });
  await waitFor(page, PLAYING, 'the live stream');
  // A second channel beside it, from its row's menu, where the account
  // allows two streams (the mock does here; the hosted demo's one does not,
  // and its picture is of the one channel).
  const sideBySide = await evaluate(page, `(() => { const row = [...document.querySelectorAll('#list .row')].find((r) => [...r.querySelectorAll('*')].some((n) => n.children.length === 0 && n.textContent.trim() === 'Aurora Cinema'));
    row?.querySelector('.row-more')?.click();
    const item = [...document.querySelectorAll('.row-menu button')].find((b) => b.textContent === 'Play alongside');
    if (!item) { document.querySelector('.row-menu')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return false; }
    item.click(); return true; })()`, { gesture: true });
  if (sideBySide) await waitFor(page, `(() => { const v = document.getElementById('video2'); return v.readyState >= 2 && v.currentTime > 0.3 && !v.paused; })()`, 'the second picture');
  // The menu handed the focus back to the list: no ring around it in the picture.
  await evaluate(page, `document.activeElement?.blur()`);
  await sleep(2500);                                   // now/next below the player
  await shoot('01-channels.png');
  if (ONLY?.has('01-channels-browse')) {
    // In the narrow layout playback takes the one pane; Browse shows the
    // rows beside it, the same channels with their programmes.
    await evaluate(page, `document.getElementById('compact-browse').click()`);
    await waitFor(page, `getComputedStyle(document.getElementById('listcol')).display !== 'none'`, 'the browse pane');
    await sleep(500);
    await shoot('01-channels-browse.png');
    await evaluate(page, `document.getElementById('compact-player').click()`);
  }

  // The rest of the views are of one picture.
  await evaluate(page, `document.getElementById('second').hidden || document.getElementById('second-close').click()`);

  // 2. The programme guide over the same channels.
  await evaluate(page, `document.getElementById('btn-guide').click()`);
  await waitFor(page, `document.getElementById('main').classList.contains('guide') && document.querySelectorAll('#epg-canvas *').length > 20`, 'the guide grid');
  await sleep(3000);                                   // the grid's own programme fetches
  await shoot('02-guide.png');
  await evaluate(page, `document.getElementById('epg-close').click()`);
  await sleep(500);

  // 3. A series: cover, plot, seasons and episodes.
  await evaluate(page, `document.querySelector('#tabs [data-tab="series"]').click()`);
  await click(page, '#groups', 'Nordic Noir');
  await click(page, '#list', 'Silent Fjord');
  await waitFor(page, `!document.getElementById('detail').hidden && document.querySelector('#detail .detail-plot') && document.querySelectorAll('#list .row').length > 0`, 'the series page');
  await sleep(1500);                                   // covers
  await shoot('03-series.png');

  // 4. An episode from an MKV, with the subtitle selector and a cue on screen.
  await evaluate(page, `document.querySelector('#list .row').click()`, { gesture: true });
  await waitFor(page, PLAYING, 'the episode');
  await waitFor(page, `(() => { const s = document.getElementById('subs'); return !s.hidden && s.options.length > 1; })()`, 'the subtitle tracks');
  await evaluate(page, `(() => {
    const s = document.getElementById('subs');
    const o = [...s.options].find((o) => /english/i.test(o.textContent));
    if (o && s.value !== o.value) { s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); }
  })()`);
  await waitFor(page, `[...document.getElementById('video').textTracks].some((t) => t.mode === 'showing' && t.activeCues && t.activeCues.length)`, 'a subtitle cue');
  await sleep(1000);
  await shoot('04-subtitles.png');

  // 5. A movie with its details below the player.
  await evaluate(page, `document.querySelector('#tabs [data-tab="movie"]').click()`);
  await click(page, '#groups', 'Nordic');
  await click(page, '#list', 'Northern Lights', { gesture: true });
  await waitFor(page, PLAYING, 'the movie');
  await waitFor(page, `!document.getElementById('infostrip').hidden && !!document.querySelector('#infostrip .plot')`, 'the movie details');
  await sleep(1500);
  await shoot('05-movie.png');
} catch (e) {
  if (!(e instanceof AllTaken)) throw e;
} finally {
  await clearViewport(page).catch(() => {});
  page.close();
  // The paced live stream would keep the server, and this process, alive
  // for as long as the file lasts.
  if (server) { server.closeAllConnections(); server.close(); }
}
