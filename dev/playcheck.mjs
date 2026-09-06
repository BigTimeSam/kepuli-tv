#!/usr/bin/env node
// Playback scenarios against the mock server, in the development Chrome:
// the demo episode is played through the MKV unpacker and something is done
// to it that used to leave the picture dead without a word.
//
//   node dev/playcheck.mjs            every scenario
//   node dev/playcheck.mjs seek       two seeks in quick succession while the
//                                     seek table is being fetched: playback
//                                     must continue past the second target
//   node dev/playcheck.mjs death      the server goes away mid-episode: the
//                                     error overlay must say so, with Retry,
//                                     rather than the picture freezing at the
//                                     end of the buffer
//   node dev/playcheck.mjs cancel     the whole channel list stalls and the
//                                     viewer presses Cancel: the dialog must
//                                     close and the sidebar return to the
//                                     group it was on, with no error
//   node dev/playcheck.mjs timeout    the same stall left alone: the request
//                                     limit must end it with a message, as a
//                                     toast over the rows, rather than the
//                                     dialog staying open for good
//   node dev/playcheck.mjs restore    the address follows the path and the
//                                     title says it in words; a refresh comes
//                                     back to the group, the topic and the
//                                     open series from the address alone, a
//                                     typed address navigates, and the stored
//                                     view brings the tab, group and topic
//                                     back to a player opened fresh, while a
//                                     search, an unknown topic and an unknown
//                                     group do not take the list with them
//   node dev/playcheck.mjs search     a search takes over from the group and
//                                     clearing it brings the group back
//   node dev/playcheck.mjs paste      a whole address pasted into the Server
//                                     field is split into its parts
//   node dev/playcheck.mjs keys       Esc and the arrows keep working after a
//                                     button has been clicked with the mouse,
//                                     and f alone goes to full screen while
//                                     Cmd+F and Ctrl+F are left to the browser
//   node dev/playcheck.mjs switching  a channel switch during the wait before
//                                     a reconnect leaves the new channel alone,
//                                     and the tab's title names what is playing
//                                     before the path the list stands on
//   node dev/playcheck.mjs resume     a film with a resume position, abandoned
//                                     before its metadata arrived for an
//                                     episode, does not drag the episode to
//                                     its position
//   node dev/playcheck.mjs reconnect  the download breaks once and resumes:
//                                     playback must carry on across the break
//   node dev/playcheck.mjs accounts   a favourite made under one account is
//                                     not shown under another
//   node dev/playcheck.mjs listerror  a group that cannot be fetched while a
//                                     channel plays: a toast, not the overlay
//   node dev/playcheck.mjs a11y       roles and names for assistive technology,
//                                     the cursor announced and marked
//   node dev/playcheck.mjs audio      the three-track episode: the automatic
//                                     choice is heard as the English track's
//                                     tone, the selector changes the track
//                                     mid-playback without stopping the
//                                     picture, and a remembered Finnish opens
//                                     the next playback on the Finnish track
//   node dev/playcheck.mjs settings   the settings dialog: drafts save on
//                                     demand without reconnecting, a slider
//                                     drag released outside does not close
//                                     it, a backdrop click guards edits, the Aa
//                                     popover sizes the real subtitles
//                                     without covering them, and the first
//                                     run is a connect dialog rather than
//                                     settings
//   node dev/playcheck.mjs subtitles  the cues are drawn by the layer, a
//                                     two-line cue in one box; the selector
//                                     changes the track and switches the
//                                     subtitles off without an error, and
//                                     the language it chose opens the next
//                                     episode; a double click takes the
//                                     wrapper to full screen with the
//                                     layer; a file without subtitles says
//                                     so in the details
//
// The driver is the one dev/store-screenshots.mjs uses, from the same
// profile (KEPULI_DEV_PROFILE) and port (KEPULI_DEV_PORT), and it needs the
// player tab visible: a minimised window leaves the tab hidden, and Chrome
// then throttles its timers to once a minute, which stalls the start-up.
// A private headless instance is the reliable way to run it:
//
//   KEPULI_DEV_PORT=9333 KEPULI_DEV_PROFILE=/tmp/kepuli-profile KEPULI_HEADLESS=1 node dev/playcheck.mjs
//
// with the profile copied from ~/.cache/kepuli-tv-dev so that the host
// permission for the mock server is already granted. The mock server sends
// the media slowly so that the seek targets lie outside the buffer and the
// download is still under way when the server is cut; KEPULI_THROTTLE sets
// the rate in bytes per second (60 kB/s). Exit code 0 when every scenario
// passes, 1 otherwise.

import { startMockServer, MULTI_EPISODES, PORT as MOCK_PORT } from './mock/server.mjs';
// Run the same scenarios in Firefox with KEPULI_BROWSER=firefox.
const { ensureChrome, openPlayer, session, sleep } = await import(
  process.env.KEPULI_BROWSER === 'firefox' ? '../firefox/playcheck-driver.mjs' : './screenshot.mjs');

const THROTTLE = Number(process.env.KEPULI_THROTTLE || 60 * 1024);
const CUES_DELAY_MS = 1500;
const PLAYING = `(() => { const v = document.getElementById('video'); return v.readyState >= 2 && v.currentTime > 0.3 && !v.paused; })()`;
const CONNECTED = `document.querySelectorAll('#groups .group').length > 1 && document.getElementById('list-progress').hidden`;

/* ------------------------------------------------------------ page helpers */

async function evaluate(page, expression, { gesture = false } = {}) {
  const { result, exceptionDetails } = await page.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: gesture });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
  return result.value;
}

async function waitFor(page, expression, what, timeout = 25000) {
  const t0 = Date.now();
  for (;;) {
    let value = false;
    try { value = await evaluate(page, expression); } catch { /* mid-reload */ }
    if (value) return value;
    if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for ${what}`);
    await sleep(200);
  }
}

async function click(page, root, text, { gesture = false, timeout = 10000 } = {}) {
  const expression = `(() => {
    const nodes = [...document.querySelectorAll(${JSON.stringify(root + ' *')})];
    const node = nodes.find((n) => n.children.length === 0 && n.textContent.trim() === ${JSON.stringify(text)})
      || nodes.find((n) => n.children.length === 0 && n.textContent.trim().startsWith(${JSON.stringify(text)}));
    if (!node) return false; node.click(); return true; })()`;
  const t0 = Date.now();
  for (;;) {
    if (await evaluate(page, expression, { gesture })) return;
    if (Date.now() - t0 > timeout) throw new Error(`nothing called "${text}" under ${root}`);
    await sleep(200);
  }
}

const videoState = (page) => evaluate(page, `(() => { const v = document.getElementById('video'); const ov = document.getElementById('overlay');
  return { t: +v.currentTime.toFixed(1), paused: v.paused, readyState: v.readyState,
    buffered: [...Array(v.buffered.length)].map((_, i) => v.buffered.start(i).toFixed(0) + '-' + v.buffered.end(i).toFixed(0)),
    overlay: ov && !ov.hidden ? ov.textContent.trim().replace(/\\s+/g, ' ').slice(0, 120) : null,
    actions: [...document.querySelectorAll('#overlay button')].map((b) => b.textContent.trim()) }; })()`);

// An error thrown from a control's own handler reaches no catch of the
// app's: the page carries on with the work half done and says nothing. The
// scenario has to listen for it, so that "the picture still runs" is not
// mistaken for "nothing went wrong".
const watchErrors = (page) => evaluate(page, `(() => { window.__thrown = [];
  addEventListener('error', (e) => window.__thrown.push((e.error && e.error.message) || e.message));
  addEventListener('unhandledrejection', (e) => window.__thrown.push(String((e.reason && e.reason.message) || e.reason)));
  return true; })()`);
const errorsSeen = (page) => evaluate(page, `window.__thrown.slice()`);

/** The viewer's own choice from the player's subtitle selector, by its name
 *  in the menu; the name chosen, or null when the menu does not offer it. */
const pickSubtitle = (page, name) => evaluate(page, `(() => { const select = document.getElementById('subs');
  const option = [...select.options].find((o) => o.textContent.startsWith(${JSON.stringify(name)}));
  if (!option) return null;
  select.value = option.value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return option.textContent; })()`, { gesture: true });

/** What the player shows: the choice in the menu, the track under the
 *  picture, and the boxes the layer is drawing. */
const subtitleState = (page) => evaluate(page, `(() => { const v = document.getElementById('video');
  return { picked: document.getElementById('subs').value,
    showing: [...v.textTracks].filter((t) => t.mode === 'showing').map((t) => t.label),
    boxes: document.querySelectorAll('#subdisplay .cue').length }; })()`);

/* ---------------------------------------------------------------- set-up */

async function checkModal(page, selector, name) {
  const state = await evaluate(page, `(() => {
    const dialog = document.querySelector(${JSON.stringify(selector)}), close = dialog.querySelector('.modal-head .modal-close');
    if (!close) return { error: 'missing shared close button' };
    const d = dialog.getBoundingClientRect(), r = close.getBoundingClientRect();
    return { width: r.width, height: r.height, label: close.getAttribute('aria-label'),
      visible: r.top >= d.top && r.bottom <= d.bottom && r.right <= d.right && r.left > d.left + d.width / 2,
      fits: d.left >= 0 && d.top >= 0 && d.right <= innerWidth && d.bottom <= innerHeight,
      radius: getComputedStyle(dialog).borderRadius };
  })()`);
  if (state.width !== 32 || state.height !== 32 || !state.label || !state.visible || !state.fits || state.radius !== '14px') {
    throw new Error(`${name} modal controls: ${JSON.stringify(state)}`);
  }
  if (process.env.KEPULI_MODAL_CAPTURE_DIR) {
    const fs = await import('node:fs');
    fs.mkdirSync(process.env.KEPULI_MODAL_CAPTURE_DIR, { recursive: true });
    const { data } = await page.call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`${process.env.KEPULI_MODAL_CAPTURE_DIR}/${name}.png`, Buffer.from(data, 'base64'));
  }
}

/** A fresh player pointed at the mock server, connected and throttled. */
/** The player's address without the place written into it: a fresh start. */
const bare = (url) => url.split('#')[0];

async function freshPlayer(target, page) {
  // Screenshot inspections may leave a narrow emulated viewport behind.
  await page.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  const { windowId } = await page.call('Browser.getWindowForTarget');
  await page.call('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
  await page.call('Page.bringToFront');
  const visibility = await evaluate(page, 'document.visibilityState');
  if (visibility !== 'visible') throw new Error('the player tab is not visible; raise the dev Chrome window or run headless');
  // The personal lists are kept per account, so every account's copy goes.
  await evaluate(page, `chrome.storage.local.get(null).then((all) => chrome.storage.local.remove(Object.keys(all).filter((k) => /^(favorites|recents|resume|channels)(:|$)/.test(k))))`);
  await evaluate(page, `chrome.storage.local.set({
    config: { scheme: 'http', host: '127.0.0.1', port: '${MOCK_PORT}', username: 'demo', password: 'demo', sourceMode: 'xtream', streamMode: 'auto' },
    settings: { lang: 'en', epgEnabled: true, resumeEnabled: false, subtitleLang: 'eng' },
    ui: { tab: 'series' } })`);
  // The catalogue cache is dropped as the screenshot script does: a run
  // against another server would otherwise hand out that server's addresses.
  const origin = target.url.match(/^(?:chrome|moz)-extension:\/\/[^/]+/)[0];
  await page.call('Page.navigate', { url: `${origin}/css/player.css` });
  await sleep(500);
  await evaluate(page, `indexedDB.databases().then((dbs) => Promise.all(dbs.map((d) => new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(d.name); req.onsuccess = req.onerror = req.onblocked = () => resolve(d.name); }))))`);
  await page.call('Page.navigate', { url: bare(target.url) });
  await sleep(1000);
  await waitFor(page, CONNECTED, 'the connection');
}

/**
 * The live tab's channel list, painted.
 *
 * Waiting for "some rows" is not enough and once made three scenarios
 * flaky: activateTab marks the tab active and only then waits for the
 * network, so for a moment the list still held the previous tab's rows —
 * measured, the wait was satisfied in 1 ms by a series row, and the click
 * that followed opened a series instead of playing a channel. js/app.js
 * empties the list with the tab now; this checks what arrived is really
 * the channel list rather than trusting the timing.
 */
async function openLiveList(page, minRows = 1) {
  await evaluate(page, `document.querySelector('#tabs [data-tab="live"]').click()`);
  await waitFor(page, `document.querySelectorAll('#list .row').length >= ${minRows}`, 'the channel rows');
}

/** The first channel of that list, playing. */
async function playFirstChannel(page) {
  await openLiveList(page, 2);
  await evaluate(page, `document.querySelectorAll('#list .row')[0].click()`, { gesture: true });
  await sleep(300);
  // A row that is not a channel opens a detail panel instead of playing.
  // Said at once, it beats waiting out the playback timeout and reporting
  // only that nothing happened.
  const opened = await evaluate(page, `(() => { const row = document.querySelector('#list .row');
    return { detail: !document.getElementById('detail').hidden,
      first: row ? row.textContent.trim().replace(/\s+/g, ' ').slice(0, 40) : null }; })()`);
  if (opened.detail) throw new Error(`the top row of the channel list opened a detail panel: "${opened.first}"`);
  await waitFor(page, PLAYING, 'the channel');
}

/** An episode of the demo series, playing. The first by default; the third
 *  is the one with three audio tracks, see dev/mock/media.sh. */
async function playEpisode(page, index = 0) {
  await evaluate(page, `document.querySelector('#tabs [data-tab="series"]').click()`);
  await click(page, '#groups', 'Nordic Noir');
  await click(page, '#list', 'Silent Fjord');
  await waitFor(page, `!document.getElementById('detail').hidden && document.querySelectorAll('#list .row').length > ${index}`, 'the series page');
  await evaluate(page, `document.querySelectorAll('#list .row')[${index}].click()`, { gesture: true });
  await waitFor(page, PLAYING, 'the episode');
  await sleep(3000);
}

/* -------------------------------------------------------------- scenarios */

async function seek(page) {
  const T1 = 90, T2 = 100;
  // Bounded range reads — the seek table — are slowed down so that the
  // second seek lands while the first one's fetch is in flight.
  await evaluate(page, `(() => { const orig = window.fetch.bind(window);
    window.fetch = async (url, init) => { const range = init && init.headers && init.headers.Range;
      const res = await orig(url, init);
      if (range && /^bytes=\\d+-\\d+$/.test(range)) await new Promise((r) => setTimeout(r, ${CUES_DELAY_MS}));
      return res; }; return true; })()`);
  await playEpisode(page);
  await evaluate(page, `document.getElementById('video').currentTime = ${T1}`);
  await sleep(400);
  await evaluate(page, `document.getElementById('video').currentTime = ${T2}`);
  let last = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) {
    last = await videoState(page);
    if (last.t > T2 + 1.5 && !last.paused) return { ok: true, detail: `playing at ${last.t} s, buffered ${last.buffered}` };
    await sleep(1000);
  }
  return { ok: false, detail: `stuck at ${last.t} s, buffered ${last.buffered}` };
}

async function death(page, { server }) {
  // The player's own warnings, for the report: they say which path was taken.
  await evaluate(page, `(() => { window.__log = []; for (const k of ['warn', 'error']) { const o = console[k].bind(console);
    console[k] = (...a) => { window.__log.push(a.map((x) => (x && x.message) || String(x)).join(' ').slice(0, 120)); o(...a); }; } return true; })()`);
  await playEpisode(page);
  // The server goes away under the open download: its sockets are cut and
  // it stops listening, so the resumes find nothing. (DevTools' offline
  // emulation would not do: it leaves a download in flight alone.)
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  let last = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 40000) {
    last = await videoState(page);
    if (last.overlay && /Playback stopped/.test(last.overlay)) {
      const retry = last.actions.some((a) => /try again|retry|yritä/i.test(a));
      return { ok: retry, detail: `after ${((Date.now() - t0) / 1000).toFixed(1)} s: "${last.overlay}" actions ${last.actions.join(' / ')}` };
    }
    await sleep(1000);
  }
  const log = await evaluate(page, 'window.__log.slice(-6)');
  return { ok: false, detail: `no message in 40 s; picture at ${last.t} s, overlay ${last.overlay}; log: ${JSON.stringify(log)}` };
}

// The row's name without the count that appears once the whole list is in.
const ACTIVE_GROUP = `((document.querySelector('#groups .active') || {}).textContent || '').trim().replace(/\\s*\\d+$/, '')`;
const OVERLAY = `(() => { const ov = document.getElementById('overlay'); return ov.hidden ? null : ov.textContent.trim().replace(/\\s+/g, ' ').slice(0, 100); })()`;

/** "All" on the Channels tab, which needs the whole list — slow to arrive here. */
async function loadAll(page) {
  await openLiveList(page);
  const before = await evaluate(page, ACTIVE_GROUP);
  await click(page, '#groups', 'All');
  await waitFor(page, `!document.getElementById('list-progress').hidden`, 'the loading strip', 5000);
  return before;
}

async function cancel(page) {
  let before;
  // The load lives in the list column now, not in a modal over everything, so
  // what has to keep working is Escape wherever the focus is, the strip's own
  // Cancel, and the player underneath being live throughout.
  for (const control of ['Escape', 'lp-cancel']) {
    before = await loadAll(page);
    const live = await evaluate(page, `(() => { const b = document.getElementById('btn-reload');
      return !b.disabled && b.getClientRects().length > 0 && document.elementFromPoint(
        Math.round(b.getBoundingClientRect().left + b.getBoundingClientRect().width / 2),
        Math.round(b.getBoundingClientRect().top + b.getBoundingClientRect().height / 2)) === b; })()`);
    if (!live) throw new Error('the loading strip left the player unreachable');
    if (control === 'Escape') await pressKey(page, 'Escape', 'Escape', 27);
    else await evaluate(page, `document.getElementById('${control}').click()`);
    await waitFor(page, `document.getElementById('list-progress').hidden`, `${control} cancels loading`, 5000);
    if (await evaluate(page, ACTIVE_GROUP) !== before) throw new Error(`${control} did not restore the previous group`);
  }
  await sleep(500);
  const after = await evaluate(page, `({ overlay: ${OVERLAY}, active: ${ACTIVE_GROUP}, rows: document.querySelectorAll('#list .row').length, toast: document.getElementById('toast').textContent.trim() })`);
  // The overlay may say "Nothing playing": only an error counts against.
  const ok = !/failed|error/i.test(after.overlay || '') && after.active === before && after.rows > 0;
  return { ok, detail: `Escape and Cancel abort loading with the player reachable throughout; group "${before}" → "${after.active}", ${after.rows} rows, overlay ${after.overlay}, toast "${after.toast}"` };
}

async function timeout(page) {
  const before = await loadAll(page);
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < 35000) {
    // The list's own error goes to a toast over the rows on screen (or to
    // the list's empty state when there are none), never over the player.
    last = await evaluate(page, `({ open: !document.getElementById('list-progress').hidden, overlay: ${OVERLAY}, active: ${ACTIVE_GROUP},
      toast: document.getElementById('toast').hidden ? '' : document.getElementById('toast').textContent.trim(),
      empty: (document.querySelector('#list .empty') || {}).textContent || '' })`);
    if (!last.open && /did not answer within/.test(last.toast + last.empty)) {
      const ok = !/failed/i.test(last.overlay || '') && last.active === before;
      return { ok, detail: `after ${((Date.now() - t0) / 1000).toFixed(1)} s: "${last.toast || last.empty}"; group "${before}" → "${last.active}", overlay ${last.overlay ? '"' + last.overlay + '"' : 'hidden'}` };
    }
    await sleep(500);
  }
  return { ok: false, detail: `after 35 s the strip is ${last.open ? 'still showing' : 'gone'}, toast "${last.toast}", overlay ${last.overlay}` };
}

/** A search takes over from the group, and the group comes back when the search is cleared. */
async function search(page) {
  await evaluate(page, `document.querySelector('#tabs [data-tab="live"]').click()`);
  await waitFor(page, `document.querySelectorAll('#groups .group').length > 1`, 'the sidebar');
  const before = await evaluate(page, ACTIVE_GROUP);
  const type = (text) => evaluate(page, `(() => { const s = document.getElementById('search'); s.value = ${JSON.stringify(text)}; s.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await type('aurora');
  await waitFor(page, `${ACTIVE_GROUP}.startsWith('All') && document.getElementById('list-progress').hidden && document.querySelectorAll('#list .row').length > 0`, 'the search results', 15000);
  const hits = await evaluate(page, `document.querySelectorAll('#list .row').length`);
  await type('');
  await sleep(600);
  const after = await evaluate(page, ACTIVE_GROUP);
  return { ok: after === before, detail: `"${before}" → search (${hits} rows under "All") → cleared → "${after}"` };
}

/** A whole address pasted into the Server field lands in the right fields. */
async function paste(page) {
  await evaluate(page, `document.getElementById('btn-settings').click()`);
  await waitFor(page, `document.getElementById('setup').open`, 'the settings dialog', 5000);
  await checkModal(page, '#setup', 'settings');
  // The fields live in their own section now, and that is where a viewer
  // pasting an address would be.
  await evaluate(page, `document.querySelector('#setup-tabs [data-panel="connection"]').click()`);
  await sleep(200);
  const address = `http://127.0.0.1:${MOCK_PORT}/player_api.php?username=demo&password=demo`;
  await evaluate(page, `(() => { const h = document.getElementById('f-host'); h.value = ${JSON.stringify(address)};
    h.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await sleep(300);
  const fields = await evaluate(page, `['scheme', 'host', 'port', 'username', 'password'].map((f) => document.getElementById('f-' + f).value)`);
  // Normalised fields still describe the saved account; closing is clean.
  await evaluate(page, `document.getElementById('f-close').click()`);
  const expected = ['http', '127.0.0.1', String(MOCK_PORT), 'demo', 'demo'];
  return { ok: JSON.stringify(fields) === JSON.stringify(expected), detail: `fields ${JSON.stringify(fields)}` };
}

/* A real mouse click and a real key, through DevTools' input domain: a
   click from the mouse leaves the focus on the button, which is the point. */
async function mouseClick(page, selector) {
  const r = await evaluate(page, `(() => { const b = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
  await page.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y });
  await page.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1 });
  await page.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', clickCount: 1 });
}
// DevTools' own bitmask for the keys held down with the key: Alt 1, Ctrl 2,
// Cmd 4, Shift 8.
const CTRL = 2;
const CMD = 4;
async function pressKey(page, key, code, keyCode, modifiers = 0) {
  await page.call('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode, modifiers });
  await page.call('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode, modifiers });
}

/**
 * The keys keep working after a button has been clicked with the mouse, and
 * a key held down with Cmd or Ctrl is left to the browser.
 */
async function keys(page) {
  await evaluate(page, `document.querySelector('#tabs [data-tab="live"]').click()`);
  await waitFor(page, `document.querySelectorAll('#list .row').length > 0`, 'the channel rows');
  // Guide with the mouse, then Esc.
  await mouseClick(page, '#btn-guide');
  await waitFor(page, `document.getElementById('main').classList.contains('guide')`, 'the guide', 10000);
  await sleep(500);
  await pressKey(page, 'Escape', 'Escape', 27);
  await sleep(500);
  const guideClosed = !(await evaluate(page, `document.getElementById('main').classList.contains('guide')`));
  // A tab with the mouse, then an arrow in the list.
  await mouseClick(page, '#tabs [data-tab="movie"]');
  await waitFor(page, `document.querySelectorAll('#list .row').length > 0 && document.querySelector('#tabs [data-tab="movie"]').classList.contains('active')`, 'the movie rows');
  await sleep(300);
  await pressKey(page, 'ArrowDown', 'ArrowDown', 40);
  await sleep(300);
  const cursorMoved = await evaluate(page, `Boolean(document.querySelector('#list .row.selected'))`);
  const focus = await evaluate(page, `document.activeElement.tagName + (document.activeElement.id ? '#' + document.activeElement.id : '')`);
  // Cmd+F and Ctrl+F are the browser's search box, not the app's: only the
  // bare f takes the picture to full screen. Each of the two is measured on
  // its own, because full screen is a toggle: pressed one after the other
  // they would undo each other and leave the state looking right.
  const fullscreen = async (key, modifiers) => {
    await pressKey(page, key, 'KeyF', 70, modifiers);
    await sleep(600);
    const id = await evaluate(page, `(document.fullscreenElement || {}).id || ''`);
    await evaluate(page, `document.fullscreenElement && document.exitFullscreen()`);
    await sleep(500);
    return id;
  };
  const withCmd = await fullscreen('f', CMD);
  const withCtrl = await fullscreen('f', CTRL);
  const bare = await fullscreen('f', 0);
  const fullscreenKey = !withCmd && !withCtrl && bare === 'videowrap';
  return { ok: guideClosed && cursorMoved && fullscreenKey, detail: `Esc after the Guide click ${guideClosed ? 'closed' : 'did not close'} the guide; ArrowDown after the tab click ${cursorMoved ? 'moved' : 'did not move'} the cursor; focus on ${focus}; Cmd+F went to ${withCmd || 'nothing'} and Ctrl+F to ${withCtrl || 'nothing'}, a bare f to ${bare || 'nothing'}` };
}

/**
 * A live channel dies and the viewer switches channel during the wait
 * before the reconnect. The wait must not restart the new channel: every
 * attempt begins with a request for the .ts address, so the new channel's
 * must be asked for once.
 */
async function switching(page, { requests }) {
  try {
    await playFirstChannel(page);
  } catch (err) {
    const st = await videoState(page);
    throw new Error(`${err.message}; overlay "${st.overlay}", readyState ${st.readyState}, requests ${requests.slice(-4).join(' ')}`);
  }
  const from = requests.length;
  // The stream "ends": the guards answer with a reconnect after a second.
  await evaluate(page, `document.getElementById('video').dispatchEvent(new Event('ended'))`);
  await sleep(200);
  await evaluate(page, `document.querySelectorAll('#list .row')[1].click()`, { gesture: true });
  await sleep(5000);
  // The stream address itself, not the HLS segments that follow it.
  const ts = requests.slice(from).filter((u) => /^\/live\/[^/]+\/[^/]+\/\d+\.ts(\?|$)/.test(u));
  // What is playing is the head of the tab's title, and the path where the
  // list stands follows it: a window of tabs says which one is the player
  // and what it is playing without being opened.
  const titled = await evaluate(page, `(() => { const name = document.getElementById('now-title').textContent;
    return { ok: document.title.startsWith(name + ' · Channels › '), title: document.title }; })()`);
  if (!titled.ok) return { ok: false, detail: `the title does not name what is playing: ${JSON.stringify(titled.title)}` };
  return { ok: ts.length === 1, detail: `${ts.length} stream request(s) after the switch: ${ts.join(' ')}; title ${JSON.stringify(titled.title)}` };
}

/**
 * A film with a resume position is abandoned before its metadata arrived,
 * for an episode. The episode must start from the beginning, not from the
 * film's position.
 */
async function resume(page) {
  const list = await (await fetch(`http://127.0.0.1:${MOCK_PORT}/player_api.php?username=demo&password=demo&action=get_vod_streams`)).json();
  const film = list.find((m) => /Northern Lights/.test(m.name));
  if (!film) throw new Error('the demo has no film called Northern Lights');
  await evaluate(page, `chrome.storage.local.get('settings').then((got) => chrome.storage.local.set({
    settings: { ...got.settings, resumeEnabled: true },
    resume: { ['1:' + ${JSON.stringify(String(film.stream_id))}]: { position: 60, duration: 120, at: Date.now() } } }))`);
  await page.call('Page.reload');
  await sleep(1000);
  await waitFor(page, CONNECTED, 'the connection after the reload');
  // Sent slowly, the film's metadata takes a second or two to arrive: time
  // enough to switch to the episode before it.
  process.env.KEPULI_MOCK_THROTTLE = String(THROTTLE);
  await evaluate(page, `document.querySelector('#tabs [data-tab="movie"]').click()`);
  await click(page, '#groups', 'Nordic');
  await click(page, '#list', 'Northern Lights', { gesture: true });
  await sleep(400);
  await evaluate(page, `document.querySelector('#tabs [data-tab="series"]').click()`);
  await click(page, '#groups', 'Nordic Noir');
  await click(page, '#list', 'Silent Fjord');
  await waitFor(page, `!document.getElementById('detail').hidden && document.querySelectorAll('#list .row').length > 0`, 'the series page');
  await evaluate(page, `document.querySelector('#list .row').click()`, { gesture: true });
  await waitFor(page, PLAYING, 'the episode');
  await sleep(2000);
  const st = await videoState(page);
  process.env.KEPULI_MOCK_THROTTLE = '';
  return { ok: st.t < 30, detail: `the episode is at ${st.t} s (the film's resume position was 60 s)` };
}

/**
 * The download breaks once, early in a cluster, and the server is there for
 * the resume. The frames that were waiting from the cluster before — audio
 * for a full segment, video for a keyframe — must be read again, or the
 * buffer keeps a hole that playback cannot cross.
 */
async function reconnect(page) {
  const { readFileSync } = await import('node:fs');
  const file = readFileSync(new URL('./mock/media/episode.mkv', import.meta.url));
  const id = Buffer.from([0x1f, 0x43, 0xb6, 0x75]);
  let at = -1, cluster = -1;
  while ((at = file.indexOf(id, at + 1)) !== -1) { if (at > 300000) { cluster = at; break; } }
  if (cluster < 0) throw new Error('no cluster after 300 kB in the demo episode');
  process.env.KEPULI_MOCK_CUT_AT = String(cluster + 6000);
  await playEpisode(page);
  // The break comes a few seconds in and the rest of the file follows the
  // resume; once it is all in, the buffer tells whether a hole was left.
  const ranges = () => evaluate(page, `(() => { const b = document.getElementById('video').buffered; return [...Array(b.length)].map((_, i) => [b.start(i), b.end(i)]); })()`);
  let got = [];
  for (let i = 0; i < 40; i++) {
    got = await ranges();
    if (got.length && got[got.length - 1][1] >= 110) break;
    await sleep(1000);
  }
  const holes = got.slice(1).map((r, i) => `${got[i][1].toFixed(1)}-${r[0].toFixed(1)}`);
  // Playback across the place of the break: a hole would stop it there.
  const target = got.length > 1 ? got[0][1] - 2 : 28;
  await evaluate(page, `document.getElementById('video').currentTime = ${target.toFixed(1)}`);
  let t = 0;
  for (let i = 0; i < 12; i++) { await sleep(1000); t = (await videoState(page)).t; if (t > target + 8) break; }
  const ok = got.length === 1 && t > target + 8;
  return { ok, detail: `${got.length} buffered range(s)${holes.length ? ', hole at ' + holes.join(', ') : ''}; from ${target.toFixed(1)} s playback reached ${t} s in 12 s` };
}

/**
 * The favourites belong to the account. The same mock on two ports is two
 * accounts to the player: a favourite made under one is not shown under
 * the other, and is back on the way back. The account is switched through
 * storage and a reload, the way the driver connects in the first place —
 * the Connect button would ask for the host permission, and headless
 * Chrome has no prompt to answer it with.
 */
async function accounts(page, { target }) {
  const OTHER_PORT = MOCK_PORT + 1;
  const other = await startMockServer(OTHER_PORT);
  try {
    const favCount = async () => {
      await evaluate(page, `document.querySelector('#tabs [data-tab="fav"]').click()`);
      await sleep(500);
      return evaluate(page, `document.querySelectorAll('#list .row').length`);
    };
    const reconnectOn = async (port) => {
      await evaluate(page, `chrome.storage.local.get('config').then((got) => chrome.storage.local.set({ config: { ...got.config, port: ${JSON.stringify(String(port))} }, ui: { tab: 'live' } }))`);
      // Without the place in it: two addresses that differ only in their
      // fragment are one document to the browser, and the player would go
      // on running with the previous account's lists in memory.
      await page.call('Page.navigate', { url: bare(target.url) });
      await sleep(1000);
      try {
        await waitFor(page, CONNECTED, `the connection on port ${port}`);
      } catch (err) {
        const st = await evaluate(page, `(async () => ({ overlay: ${OVERLAY}, progress: !document.getElementById('list-progress').hidden, groups: document.querySelectorAll('#groups .group').length, keys: Object.keys(await chrome.storage.local.get(null)) }))()`);
        throw new Error(`${err.message}: ${JSON.stringify(st)}`);
      }
    };
    await evaluate(page, `document.querySelector('#tabs [data-tab="live"]').click()`);
    await waitFor(page, `document.querySelectorAll('#list .row').length > 0`, 'the channel rows');
    await evaluate(page, `document.querySelector('#list .row button').click()`);   // the star
    const first = await favCount();
    await reconnectOn(OTHER_PORT);
    const elsewhere = await favCount();
    await reconnectOn(MOCK_PORT);
    const back = await favCount();
    return { ok: first === 1 && elsewhere === 0 && back === 1, detail: `favourites: ${first} on port ${MOCK_PORT}, ${elsewhere} on port ${OTHER_PORT}, ${back} back on ${MOCK_PORT}` };
  } finally {
    other.closeAllConnections();
    await new Promise((resolve) => other.close(resolve));
  }
}

/**
 * A group that cannot be fetched while a channel plays: the message must
 * not cover the picture, and the sidebar must return to the group whose
 * rows are on screen.
 */
async function listerror(page) {
  await playFirstChannel(page);
  // Playing does not change the group, so this is the one the failed
  // switch below has to come back to.
  const before = await evaluate(page, ACTIVE_GROUP);
  process.env.KEPULI_MOCK_FAIL_LISTS = '1';
  try {
    await click(page, '#groups', 'Finland');
    await sleep(1500);
    const st = await evaluate(page, `({ overlay: ${OVERLAY}, playing: ${PLAYING}, active: ${ACTIVE_GROUP}, toast: document.getElementById('toast').hidden ? '' : document.getElementById('toast').textContent.trim() })`);
    const ok = !st.overlay && st.playing && st.active === before && /500/.test(st.toast);
    return { ok, detail: `overlay ${st.overlay ? '"' + st.overlay + '"' : 'hidden'}, ${st.playing ? 'still playing' : 'not playing'}, group "${before}" → "${st.active}", toast "${st.toast}"` };
  } finally {
    process.env.KEPULI_MOCK_FAIL_LISTS = '';
  }
}

/** What assistive technology is told: roles, names, the cursor, the tabs. */
async function a11y(page) {
  await openLiveList(page, 2);
  await evaluate(page, `document.getElementById('list').focus()`);
  await pressKey(page, 'ArrowDown', 'ArrowDown', 40);
  await sleep(300);
  const st = await evaluate(page, `(() => {
    const list = document.getElementById('list');
    const groups = document.getElementById('groups');
    const selected = list.querySelector('.row.selected');
    const tabs = [...document.querySelectorAll('#tabs [role="tab"]')];
    const iconButtons = [...document.querySelectorAll('button[data-i18n-title]')].filter((b) => !/\\p{L}/u.test(b.textContent));
    const rows = [...groups.children];
    const cursor = groups.querySelector('.group.cursor');
    return {
      listRole: list.getAttribute('role'), listName: list.getAttribute('aria-label'),
      pointsAtCursor: Boolean(selected) && list.getAttribute('aria-activedescendant') === selected.id && selected.getAttribute('role') === 'option' && selected.getAttribute('aria-selected') === 'true',
      cursorMark: selected ? getComputedStyle(selected).boxShadow !== 'none' : false,
      tablist: document.getElementById('tabs').getAttribute('role'),
      selectedTabs: tabs.filter((b) => b.getAttribute('aria-selected') === 'true').map((b) => b.dataset.tab),
      // A tab strip is one stop in the tab order, and its panel takes its name.
      tabStops: tabs.filter((b) => b.tabIndex === 0).map((b) => b.dataset.tab),
      panelNamedBy: document.getElementById('listcol').getAttribute('aria-labelledby'),
      toastRole: document.getElementById('toast').getAttribute('role'),
      unnamedIcons: iconButtons.filter((b) => !b.getAttribute('aria-label')).map((b) => b.id || b.className),
      // The sidebar is a listbox of options, not a list of tabbable items.
      groupsRole: groups.getAttribute('role'), groupsTabbable: groups.tabIndex === 0,
      optionRoles: [...new Set(rows.map((r) => r.getAttribute('role')))],
      rowsTabbable: rows.filter((r) => r.tabIndex >= 0).length,
      pointsAtGroup: Boolean(cursor) && groups.getAttribute('aria-activedescendant') === cursor.id,
      target: rows[2] ? rows[2].textContent.trim().replace(/\\s*\\d+$/, '') : null,
      at: rows.indexOf(cursor),
    }; })()`);
  // A sidebar group by keyboard: one Tab into the listbox, the arrows to the
  // row, Enter to choose it.
  await evaluate(page, `document.getElementById('groups').focus()`);
  for (let i = st.at; i < 2; i++) await pressKey(page, 'ArrowDown', 'ArrowDown', 40);
  for (let i = st.at; i > 2; i--) await pressKey(page, 'ArrowUp', 'ArrowUp', 38);
  await sleep(200);
  await pressKey(page, 'Enter', 'Enter', 13);
  await sleep(800);
  const chosen = await evaluate(page, ACTIVE_GROUP);
  const ok = st.listRole === 'listbox' && Boolean(st.listName) && st.pointsAtCursor && st.cursorMark
    && st.tablist === 'tablist' && st.selectedTabs.length === 1 && st.selectedTabs[0] === 'live'
    && st.tabStops.length === 1 && st.tabStops[0] === 'live' && st.panelNamedBy === 'tab-live'
    && st.toastRole === 'status' && st.unnamedIcons.length === 0
    && st.groupsRole === 'listbox' && st.groupsTabbable && st.optionRoles.join() === 'option'
    && st.rowsTabbable === 0 && st.pointsAtGroup && chosen === st.target;
  return { ok, detail: `list ${st.listRole}/${st.listName}, cursor ${st.pointsAtCursor ? 'announced' : 'not announced'} and ${st.cursorMark ? 'marked' : 'unmarked'}, tabs ${st.tablist} selected ${st.selectedTabs.join(',')} with ${st.tabStops.length} stop naming ${st.panelNamedBy}, sidebar ${st.groupsRole} of ${st.optionRoles.join('/')} with ${st.rowsTabbable} tabbable rows, toast ${st.toastRole}, unnamed icon buttons ${st.unnamedIcons.length}, group by keyboard: "${st.target}" → "${chosen}"` };
}

/** The control stays with the video and preserves the subtitle overlay. */
async function fullscreenControl(page) {
  const assert = (ok, detail) => { if (!ok) throw new Error(detail); };
  assert(await evaluate(page, `document.getElementById('btn-fullscreen').hidden && document.getElementById('btn-fullscreen').getClientRects().length === 0`), 'empty player exposes fullscreen');
  await playEpisode(page);
  await waitFor(page, `document.querySelectorAll('#subdisplay .cue').length > 0`, 'a subtitle cue');
  await evaluate(page, `document.getElementById('video').pause()`);
  await sleep(250);
  const bounds = await evaluate(page, `(() => {
    const b = document.getElementById('btn-fullscreen'), r = b.getBoundingClientRect(), w = document.getElementById('videowrap').getBoundingClientRect();
    const cues = [...document.querySelectorAll('#subdisplay .cue')].map(c => c.getBoundingClientRect());
    return { inside: b.parentElement.id === 'videowrap' && r.left >= w.left && r.top >= w.top && r.right <= w.right && r.bottom <= w.bottom,
      topRight: Math.abs(r.top - w.top - 12) < 1 && Math.abs(w.right - r.right - 12) < 1,
      visible: getComputedStyle(b).opacity === '1', clear: cues.every(c => c.bottom <= r.top || c.top >= r.bottom || c.right <= r.left || c.left >= r.right), label: b.getAttribute('aria-label') };
  })()`);
  assert(bounds.inside && bounds.topRight && bounds.visible && bounds.clear && bounds.label === 'Full screen', `overlay control: ${JSON.stringify(bounds)}`);
  if (process.env.KEPULI_FULLSCREEN_CAPTURE) {
    const { data } = await page.call('Page.captureScreenshot', { format: 'png' });
    (await import('node:fs')).writeFileSync(process.env.KEPULI_FULLSCREEN_CAPTURE, Buffer.from(data, 'base64'));
  }
  await mouseClick(page, '#btn-fullscreen');
  await waitFor(page, `document.fullscreenElement?.id === 'videowrap' && document.getElementById('btn-fullscreen').getAttribute('aria-label') === 'Exit full screen'`, 'overlay fullscreen');
  assert(await evaluate(page, `document.body.dataset.subrender === 'overlay' && document.querySelectorAll('#subdisplay .cue').length > 0 && document.getElementById('video').paused`), 'fullscreen lost subtitles or changed playback');
  await mouseClick(page, '#btn-fullscreen');
  await waitFor(page, `!document.fullscreenElement && document.getElementById('btn-fullscreen').getAttribute('aria-label') === 'Full screen'`, 'exit via the same button');

  // Keyboard focus reveals the control even after the pointer controls fade.
  await evaluate(page, `document.getElementById('video').play()`);
  const center = await evaluate(page, `(() => {const r=document.getElementById('video').getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/3};})()`);
  await page.call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...center });
  await waitFor(page, `getComputedStyle(document.getElementById('btn-fullscreen')).opacity === '0'`, 'control fades during playback', 6000);
  await pressKey(page, 'Tab', 'Tab', 9);
  await evaluate(page, `document.getElementById('btn-fullscreen').focus()`);
  await waitFor(page, `getComputedStyle(document.getElementById('btn-fullscreen')).opacity === '1'`, 'keyboard focus reveals the control');
  // Native buttons activate on the Enter keypress, so include its text.
  await page.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
  await page.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await waitFor(page, `document.fullscreenElement?.id === 'videowrap'`, 'keyboard fullscreen');
  // Browser-owned Escape is not dispatched by headless CDP; exercise the
  // same fullscreenchange path through the browser's exit API.
  await evaluate(page, `document.exitFullscreen()`);
  await waitFor(page, `!document.fullscreenElement && document.getElementById('btn-fullscreen').title === 'Full screen'`, 'browser exit restores the button state');
  return { ok: true, detail: 'overlay is clear of subtitles; click enters/exits with subtitles and paused state preserved; fades during playback; keyboard focus and Enter work; browser exit restores the label' };
}

async function subtitles(page) {
  await playEpisode(page);
  await waitFor(page, `document.querySelectorAll('#subdisplay .cue').length > 0`, 'a cue in the layer');
  // One box per active cue, drawn by the layer while the track stays showing.
  const first = await evaluate(page, `(() => { const v = document.getElementById('video'); const shown = [...v.textTracks].filter((t) => t.mode === 'showing');
    return { render: document.body.dataset.subrender, showing: shown.length, active: shown[0] ? shown[0].activeCues.length : 0,
      boxes: document.querySelectorAll('#subdisplay .cue').length, meta: document.querySelector('#infostrip .playback-fact-subtitles dd').textContent }; })()`);
  if (first.render !== 'overlay' || first.showing !== 1 || !first.boxes || first.boxes !== first.active) return { ok: false, detail: `the layer: ${JSON.stringify(first)}` };
  if (!/^English, Finnish/.test(first.meta)) return { ok: false, detail: `the details say ${JSON.stringify(first.meta)}` };

  // The viewer's own choice from the selector, which nothing here used to
  // make: the track under the picture follows it, "No subtitles" empties
  // the layer, and neither leaves an error behind — a choice of track was
  // reported as taking the whole player down with it.
  await watchErrors(page);
  const finnish = await pickSubtitle(page, 'Finnish');
  if (!finnish) return { ok: false, detail: 'the selector offers no Finnish track' };
  await waitFor(page, `document.querySelectorAll('#subdisplay .cue').length > 0`, 'a cue from the chosen track');
  const chosen = await subtitleState(page);
  if (chosen.showing.length !== 1 || chosen.showing[0] !== finnish || chosen.picked === 'off') {
    return { ok: false, detail: `after choosing ${finnish}: ${JSON.stringify(chosen)}` };
  }
  await pickSubtitle(page, 'No subtitles');
  await waitFor(page, `document.querySelectorAll('#subdisplay .cue').length === 0`, 'the layer to empty');
  const off = await subtitleState(page);
  if (off.showing.length || off.picked !== 'off') return { ok: false, detail: `after switching off: ${JSON.stringify(off)}` };
  // Back on, so that the rest of the scenario has a track to work with.
  await pickSubtitle(page, 'English');
  await waitFor(page, `document.querySelectorAll('#subdisplay .cue').length > 0`, 'the cues to return');
  const broke = await errorsSeen(page);
  if (broke.length) return { ok: false, detail: `choosing a track threw: ${broke.join(' / ')}` };

  // A two-line cue is one box with the lines stacked inside it.
  const box = await evaluate(page, `(() => { const v = document.getElementById('video'); const tr = [...v.textTracks].find((t) => t.mode === 'showing');
    for (let i = tr.cues.length - 1; i >= 0; i--) tr.removeCue(tr.cues[i]);
    tr.addCue(new VTTCue(0, 100000, 'One line,\\nand another.'));
    return new Promise((r) => setTimeout(() => { const boxes = [...document.querySelectorAll('#subdisplay .cue')];
      const range = document.createRange(); range.selectNodeContents(boxes[0]);
      r({ boxes: boxes.length, lines: new Set([...range.getClientRects()].map((x) => Math.round(x.top))).size }); }, 500)); })()`);
  if (box.boxes !== 1 || box.lines !== 2) return { ok: false, detail: `a two-line cue: ${JSON.stringify(box)}` };
  // A double click takes the wrapper to full screen, and the layer with it.
  const at = await evaluate(page, `(() => { const r = document.getElementById('video').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  if (page.doubleClick) await page.doubleClick(at.x, at.y);
  else for (const clickCount of [1, 2]) {
    await page.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', clickCount });
    await page.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', clickCount });
  }
  await sleep(1000);
  const full = await evaluate(page, `(() => ({ element: document.fullscreenElement && document.fullscreenElement.id,
    boxes: document.querySelectorAll('#subdisplay .cue').length, render: document.body.dataset.subrender,
    nativeCues: [...document.getElementById('video').textTracks].filter(t => t.mode === 'showing').reduce((n,t) => n + (t.activeCues?.length || 0), 0) }))()`);
  await evaluate(page, `document.fullscreenElement && document.exitFullscreen()`);
  await sleep(600);
  const wrapper = full.element === 'videowrap' && full.boxes === 1 && full.render === 'overlay';
  // Firefox's native video controls can own the double click. Its native
  // text track must then render the cue; the overlay returns on exit.
  const native = process.env.KEPULI_BROWSER === 'firefox' && full.element === 'video'
    && full.render === 'native' && full.nativeCues > 0;
  if (!wrapper && !native) return { ok: false, detail: `full screen: ${JSON.stringify(full)}` };
  if (!await evaluate(page, `document.body.dataset.subrender === 'overlay' && document.querySelectorAll('#subdisplay .cue').length === 1`)) {
    return { ok: false, detail: 'subtitle overlay did not return after full screen' };
  }
  // The choice is a language, and the next episode opens on it: the track
  // numbers are the file's own and say nothing about the one after it.
  await pickSubtitle(page, 'Finnish');
  await sleep(500);
  await playEpisode(page, 2);
  await waitFor(page, `document.querySelectorAll('#subdisplay .cue').length > 0`, 'a cue in the next episode');
  const remembered = await subtitleState(page);
  if (!remembered.showing[0] || !remembered.showing[0].startsWith('Finnish')) {
    return { ok: false, detail: `the next episode opened on ${JSON.stringify(remembered)}` };
  }

  // A file with no subtitles: the details below the player say so.
  await evaluate(page, `document.querySelector('#tabs [data-tab="movie"]').click()`);
  await waitFor(page, `document.querySelectorAll('#groups .group').length > 1`, 'the movie groups');
  await evaluate(page, `document.querySelectorAll('#groups .group')[1].click()`);
  await click(page, '#list', 'Crossfire Alley', { gesture: true });
  await waitFor(page, PLAYING, 'the movie');
  await waitFor(page, `/No subtitles/.test((document.querySelector('#infostrip .playback-fact-subtitles dd') || {}).textContent || '')`, 'the details of the movie', 10000);
  return { ok: true, detail: `one box for ${first.active} cue, two lines in one box, the selector switches track and off without a word of complaint, full screen on ${full.element} with ${full.render} subtitles, ${remembered.showing[0]} remembered for the next episode, the movie says "No subtitles"` };
}

/**
 * Which audio track is heard. The demo episode's three tracks each carry a
 * tone of their own — English 440 Hz, Finnish 660 Hz, the English AC-3
 * commentary 880 Hz — so the choice can be measured rather than assumed:
 * the element's own output goes through an AnalyserNode and the loudest
 * bin says which track is playing.
 *
 * The automatic choice must take the English AAC: it is the file's default
 * and it goes through untouched. Asking for Finnish must move it to the
 * Finnish track, and the commentary must not be picked either way.
 */
async function audio(page, { requests, target }) {
  const MEASURE = `(() => {
    const v = document.getElementById('video');
    if (!window.__tone) {
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 8192;
      // The element has to stay connected to the destination as well, or
      // it falls silent the moment Web Audio takes its output.
      ctx.createMediaElementSource(v).connect(analyser);
      analyser.connect(ctx.destination);
      window.__tone = { ctx, analyser, data: new Float32Array(analyser.frequencyBinCount) };
    }
    const { ctx, analyser, data } = window.__tone;
    return ctx.resume().then(() => new Promise((done) => setTimeout(() => {
      analyser.getFloatFrequencyData(data);
      let peak = 1;
      for (let i = 2; i < data.length; i++) if (data[i] > data[peak]) peak = i;
      done({ hz: Math.round((peak * ctx.sampleRate) / analyser.fftSize), db: Math.round(data[peak]) });
    }, 1200)));
  })()`;

  const heard = async (index) => {
    await playEpisode(page, index);
    const tone = await evaluate(page, MEASURE);
    return tone;
  };

  const auto = await heard(2);
  const played = requests.filter((url) => /\/series\/.*\.mkv$/.test(url)).pop() || '';
  const id = played.slice(played.lastIndexOf('/') + 1, -4);
  if (!MULTI_EPISODES.has(id)) return { ok: false, detail: `the third row is episode ${id}, which is not the three-track one` };
  if (Math.abs(auto.hz - 440) > 12) return { ok: false, detail: `the automatic choice sounds at ${auto.hz} Hz (${auto.db} dB), expected the English track's 440 Hz` };

  // The selector offers all three, with the English one chosen.
  const menu = await evaluate(page, `(() => { const s = document.getElementById('audio');
    return { hidden: s.hidden, options: [...s.options].map((o) => o.textContent), value: s.value }; })()`);
  if (menu.hidden || menu.options.length !== 3) return { ok: false, detail: `the selector: ${JSON.stringify(menu)}` };
  // A third selector on a row that was already full: every button has to
  // stay on screen, at the narrowest width the layout is drawn for as well.
  for (const width of [1024, 1280, 1512]) {
    await page.call('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false });
    await sleep(300);
    const row = await evaluate(page, `(() => { const acts = document.querySelector('.now-actions');
      const edge = acts.closest('section').getBoundingClientRect().right;
      return { cutOff: Math.round(Math.max(...[...acts.children].filter((c) => !c.hidden).map((c) => c.getBoundingClientRect().right)) - edge),
        buttons: acts.querySelectorAll('button').length }; })()`);
    if (row.cutOff > 0) { await page.call('Emulation.clearDeviceMetricsOverride'); return { ok: false, detail: `at ${width} px the player's row runs ${row.cutOff} px past its column` }; }
  }
  await page.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await sleep(300);
  if (!/^English · AAC/.test(menu.options[0]) || !/^Finnish · AAC/.test(menu.options[1]) || !/Commentary/.test(menu.options[2])) {
    return { ok: false, detail: `the selector names them ${JSON.stringify(menu.options)}` };
  }

  // The change mid-playback: the picture must not go back to buffering,
  // and the sound must come back as the other track.
  const before = await videoState(page);
  await evaluate(page, `(() => { const s = document.getElementById('audio');
    s.value = [...s.options].find((o) => /Finnish/.test(o.textContent)).value;
    s.dispatchEvent(new Event('change')); return true; })()`, { gesture: true });
  const switched = await evaluate(page, MEASURE);
  const after = await videoState(page);
  if (Math.abs(switched.hz - 660) > 12) return { ok: false, detail: `after the change it sounds at ${switched.hz} Hz (${switched.db} dB), expected 660 Hz` };
  if (after.paused || after.t <= before.t) return { ok: false, detail: `the picture stopped at ${after.t} s (it was at ${before.t} s)` };
  // The commentary is AC-3: choosing it takes the decoded route, decoder
  // and encoder and all, which is the switch that changes the buffer's
  // format rather than only its contents.
  await evaluate(page, `(() => { const s = document.getElementById('audio');
    s.value = [...s.options].find((o) => /Commentary/.test(o.textContent)).value;
    s.dispatchEvent(new Event('change')); return true; })()`, { gesture: true });
  const commentary = await evaluate(page, MEASURE);
  if (Math.abs(commentary.hz - 880) > 12) return { ok: false, detail: `the commentary sounds at ${commentary.hz} Hz (${commentary.db} dB), expected 880 Hz` };

  // The remembered language, as the settings hold it between episodes.
  await evaluate(page, `chrome.storage.local.set({ settings: { lang: 'en', epgEnabled: true, resumeEnabled: false, subtitleLang: 'eng', audioLang: 'fi' } })`);
  await page.call('Page.navigate', { url: bare(target.url) });
  await sleep(1000);
  await waitFor(page, CONNECTED, 'the connection after the reload');
  const finnish = await heard(2);
  if (Math.abs(finnish.hz - 660) > 12) return { ok: false, detail: `with Finnish asked for it sounds at ${finnish.hz} Hz (${finnish.db} dB), expected the Finnish track's 660 Hz` };
  return { ok: true, detail: `episode ${id}: automatic ${auto.hz} Hz, switched to Finnish ${switched.hz} Hz with the picture running from ${before.t} to ${after.t} s, to the AC-3 commentary ${commentary.hz} Hz, audioLang fi opens at ${finnish.hz} Hz, and the row fits at 1024-1512 px` };
}

/** Drafts across tabs, cancellation, explicit save and the live Aa control. */
async function settings(page, { requests, target }) {
  const buttons = `[...document.querySelectorAll('#setup > form > .setup-actions button')].filter((b) => !b.hidden).map((b) => b.textContent.trim())`;
  const change = (id, value, checkbox = false) => evaluate(page, `(() => { const c = document.getElementById('${id}'); c.${checkbox ? 'checked' : 'value'} = ${JSON.stringify(value)}; c.dispatchEvent(new Event('input', { bubbles: true })); c.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  const open = () => evaluate(page, `document.getElementById('btn-settings').click()`, { gesture: true });
  const tab = (name) => evaluate(page, `document.querySelector('#setup-tabs [data-panel="${name}"]').click()`);
  const press = (id) => evaluate(page, `document.getElementById('${id}').click()`, { gesture: true });
  const assert = (ok, detail) => { if (!ok) throw new Error(detail); };
  const saved = () => evaluate(page, `chrome.storage.local.get(['settings', 'config'])`);
  const initial = await saved();
  const from = requests.length;
  await open();
  await waitFor(page, `document.getElementById('setup').open`, 'the settings dialog', 5000);
  const opened = await evaluate(page, `({ focus: document.activeElement.id, buttons: ${buttons}, disabled: document.getElementById('f-save').disabled,
    section: document.querySelector('#setup-tabs .active').dataset.panel })`);
  assert(opened.section === 'connection' && opened.focus === 'f-host' && opened.buttons.join() === 'Cancel,Save' && opened.disabled, `opened as ${JSON.stringify(opened)}`);
  await tab('general');
  await change('f-epg', false, true);
  await change('f-lang', 'fi');
  await tab('subs');
  await change('f-subsize', '36');
  await change('f-substyle', 'yellow');
  await press('f-close');
  assert(await evaluate(page, `document.getElementById('setup').open && !document.getElementById('setup-discard').hidden`), 'X discarded unsaved settings without confirmation');
  await press('f-keep');
  assert(JSON.stringify(await saved()) === JSON.stringify(initial), 'draft wrote to storage');
  assert(await evaluate(page, `document.documentElement.lang === 'en' && document.body.dataset.substyle === 'shadow' && document.querySelector('#panel-subs .sublook').dataset.substyle === 'yellow'`), 'draft changed runtime or failed to preview');
  await press('f-done');
  await open();
  assert(await evaluate(page, `document.getElementById('f-epg').checked && document.getElementById('f-lang').value === 'en' && document.getElementById('f-subsize').value === '24'`), 'Cancel retained a draft');
  await tab('general');
  await change('f-epg', false, true);
  await tab('subs');
  await change('f-subsize', '36');
  // A failed write must keep the dialog and draft without persisting either key.
  await evaluate(page, `window.originalSettingsSet = chrome.storage.local.set; chrome.storage.local.set = async () => { throw new Error('simulated write failure'); };`);
  await press('f-save');
  await waitFor(page, `!document.getElementById('setup-error').hidden && !document.getElementById('f-save').disabled`, 'save failure');
  assert(JSON.stringify(await saved()) === JSON.stringify(initial), 'failed save changed storage');
  await evaluate(page, `chrome.storage.local.set = window.originalSettingsSet; delete window.originalSettingsSet;`);
  await press('f-save');
  await waitFor(page, `!document.getElementById('setup').open`, 'saved settings');
  const committed = await saved();
  assert(committed.settings.epgEnabled === false && committed.settings.subtitleSize === 36, 'Save did not commit all tabs');
  const calls = requests.slice(from).filter((u) => u.includes('player_api.php')).length;
  assert(calls === 0, `preference save made ${calls} API calls`);
  await open();
  await tab('general');
  await change('f-lang', 'fi');
  await press('f-save');
  await waitFor(page, `document.documentElement.lang === 'fi'`, 'saved Finnish language');
  await open();
  await tab('general');
  await change('f-lang', 'en');
  await press('f-save');
  await waitFor(page, `document.documentElement.lang === 'en'`, 'restored English language');
  await open();
  await tab('general');
  await change('f-resume', true, true);

  // The size slider is dragged; letting go outside the dialog must not be
  // read as a click on the backdrop.
  await evaluate(page, `document.querySelector('#setup-tabs [data-panel="subs"]').click()`);
  await sleep(300);
  const at = await evaluate(page, `(() => { const r = document.getElementById('f-subsize').getBoundingClientRect(), d = document.querySelector('.setup').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), outX: Math.round(d.right + 60), outY: Math.round(d.bottom + 40) }; })()`);
  const mouse = (type, x, y) => page.call('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  await mouse('mousePressed', at.x, at.y);
  await mouse('mouseMoved', at.outX, at.outY);
  await mouse('mouseReleased', at.outX, at.outY);
  await sleep(300);
  if (!(await evaluate(page, `document.getElementById('setup').open`))) return { ok: false, detail: 'a slider drag released outside closed the dialog' };

  // A backdrop click asks before discarding changes; keep editing retains them.
  await mouse('mousePressed', at.outX, at.outY);
  await mouse('mouseReleased', at.outX, at.outY);
  await sleep(300);
  assert(await evaluate(page, `document.getElementById('setup').open && !document.getElementById('setup-discard').hidden`), 'dirty backdrop did not ask before discarding');
  await press('f-keep');
  assert(await evaluate(page, `document.getElementById('f-resume').checked`), 'keep editing lost the draft');
  await pressKey(page, 'Escape', 'Escape', 27);
  await waitFor(page, `!document.getElementById('setup-discard').hidden`, 'Escape draft guard', 3000);
  await press('f-discard');
  assert(!(await saved()).settings.resumeEnabled, 'discard saved a change');
  await open();
  await press('f-close');
  assert(await evaluate(page, `!document.getElementById('setup').open`), 'clean close stayed open');

  // Existing M3U credentials do not require pasting the URL to save preferences.
  await evaluate(page, `chrome.storage.local.get('config').then(({ config }) => chrome.storage.local.set({ config: { ...config, sourceMode: 'm3u' } }))`);
  await page.call('Page.navigate', { url: bare(target.url) });
  await waitFor(page, CONNECTED, 'M3U connection');
  await open();
  assert(await evaluate(page, `document.activeElement.id === 'f-paste'`), 'M3U focused a hidden field');
  await tab('general');
  await change('f-resume', true, true);
  await press('f-save');
  await waitFor(page, `!document.getElementById('setup').open`, 'M3U preferences saved without URL');
  await open();
  await change('f-paste', 'invalid');
  await tab('subs');
  await press('f-save');
  assert(await evaluate(page, `!document.getElementById('setup-error').hidden && document.activeElement.id === 'f-paste'`), 'invalid M3U did not focus its error');
  await press('f-done');

  // Saving from another tab commits credentials too; denied permission
  // must commit neither credentials nor preferences.
  await open();
  const beforeConnection = await saved();
  await change('f-paste', `http://127.0.0.1:${MOCK_PORT}/get.php?username=demo&password=changed`);
  await tab('general');
  await change('f-epg', true, true);
  await evaluate(page, `window.originalSettingsPermission = chrome.permissions.request; chrome.permissions.request = async () => false;`);
  await press('f-save');
  await waitFor(page, `!document.getElementById('setup-error').hidden && !document.getElementById('f-save').disabled`, 'permission denial');
  assert(JSON.stringify(await saved()) === JSON.stringify(beforeConnection), 'denied permission committed settings');
  // The isolated headless profile cannot answer Chrome's permission prompt.
  await evaluate(page, `chrome.permissions.request = async () => true;`);
  const reconnectFrom = requests.length;
  await press('f-save');
  await waitFor(page, `!document.getElementById('setup').open`, 'saved connection');
  await waitFor(page, `!document.querySelector('#setup form').inert`, 'connection attempt completed');
  const afterConnection = await saved();
  assert(afterConnection.config.password === 'changed' && afterConnection.settings.epgEnabled, 'Save did not commit connection and preferences together');
  assert(requests.slice(reconnectFrom).some((url) => url.includes('password=changed')), 'changed connection did not reconnect');
  await open();
  await change('f-paste', `http://127.0.0.1:${MOCK_PORT}/get.php?username=demo&password=demo`);
  await press('f-save');
  await waitFor(page, CONNECTED, 'reconnected with corrected credentials');
  await evaluate(page, `chrome.permissions.request = window.originalSettingsPermission; delete window.originalSettingsPermission;`);

  // The look over the picture: the same setting, judged against the real
  // subtitles, which the popover must not cover.
  await playEpisode(page);
  await waitFor(page, `!document.getElementById('btn-sublook').hidden`, 'the Aa button', 10000);
  await evaluate(page, `document.getElementById('btn-sublook').click()`, { gesture: true });
  await evaluate(page, `(() => { const r = document.getElementById('p-subsize'); r.value = '40'; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); })()`);
  await waitFor(page, `document.querySelectorAll('#subdisplay .cue').length > 0`, 'a cue on screen');
  await sleep(400);
  const look = await evaluate(page, `(() => { const pop = document.getElementById('sublook-pop').getBoundingClientRect();
    const cues = [...document.querySelectorAll('#subdisplay .cue')].map((c) => c.getBoundingClientRect());
    return { size: getComputedStyle(document.body).getPropertyValue('--sub-size').trim(),
      mirror: document.getElementById('f-subsize').value,
      covered: cues.filter((c) => c.bottom > pop.top && c.right > pop.left && c.left < pop.right).length, cues: cues.length }; })()`);
  const savedSize = await evaluate(page, `chrome.storage.local.get('settings').then((d) => d.settings.subtitleSize)`);
  if (look.size !== '40px' || savedSize !== 40 || look.mirror !== '40') return { ok: false, detail: `the popover left ${JSON.stringify(look)}, stored ${savedSize}` };
  if (!look.cues || look.covered) return { ok: false, detail: `the popover covers ${look.covered} of ${look.cues} cue(s)` };

  // Without credentials the dialog is not settings at all: there is nothing
  // to set until there is something to connect to.
  await evaluate(page, `chrome.storage.local.remove('config')`);
  await page.call('Page.navigate', { url: bare(target.url) });
  await sleep(1200);
  await waitFor(page, `document.getElementById('setup').open`, 'the first-run dialog', 10000);
  const first = await evaluate(page, `({ rail: getComputedStyle(document.getElementById('setup-tabs')).display,
    title: document.getElementById('setup-title').textContent.trim(), buttons: ${buttons} })`);
  if (first.rail !== 'none' || first.buttons.join() !== 'Cancel,Connect') return { ok: false, detail: `the first run showed ${JSON.stringify(first)}` };
  return { ok: true, detail: `Connection first; drafts and cancel across tabs; failed write and retry; explicit save with ${calls} preference API calls; saved language; guarded backdrop/Escape; M3U preference save and validation; live Aa control and first run` };
}


/** Personal presentation survives reload, cancels cleanly and can be restored. */
async function organize(page, { target }) {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  await openLiveList(page, 3);
  const open = async () => {
    await evaluate(page, `document.getElementById('btn-organize').click()`);
    await waitFor(page, `document.getElementById('channel-editor').open`, 'channel editor');
  };
  const save = async () => {
    await evaluate(page, `document.getElementById('channel-editor-save').click()`);
    await waitFor(page, `!document.getElementById('channel-editor').open`, 'saved channel editor');
  };
  const names = () => evaluate(page, `[...document.querySelectorAll('#list .row-name')].map((n) => n.title)`);

  // Where the list starts is a setting; the arrangement made below then has
  // the last word over it.
  const setSort = async (value) => {
    await evaluate(page, `document.getElementById('btn-settings').click()`, { gesture: true });
    await waitFor(page, `document.getElementById('setup').open`, 'the settings dialog');
    await evaluate(page, `document.querySelector('#setup-tabs [data-panel="general"]').click()`);
    await evaluate(page, `(() => { const c = document.getElementById('f-channelsort'); c.value = ${JSON.stringify(value)};
      c.dispatchEvent(new Event('input', { bubbles: true })); c.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await evaluate(page, `document.getElementById('f-save').click()`, { gesture: true });
    await waitFor(page, `!document.getElementById('setup').open`, `the saved channel order (${value})`);
  };
  // The list paints only what is on screen, so it is judged by its two ends.
  const ends = async () => {
    await evaluate(page, `document.getElementById('list').scrollTop = 0`);
    await sleep(250);
    const first = (await names())[0];
    await evaluate(page, `document.getElementById('list').scrollTop = 1e7`);
    await sleep(250);
    const last = (await names()).at(-1);
    await evaluate(page, `document.getElementById('list').scrollTop = 0`);
    await sleep(250);
    return { first, last };
  };
  const az = await ends();
  await setSort('za');
  const za = await ends();
  assert(za.first === az.last && za.last === az.first, `Z-A did not mirror A-Z: ${JSON.stringify(az)} then ${JSON.stringify(za)}`);
  await setSort('num');
  const num = await ends();
  assert(num.first && num.first !== az.first && num.first !== za.first, `the channel number gave an alphabetical order: ${JSON.stringify(num)}`);
  await setSort('az');
  assert(JSON.stringify(await ends()) === JSON.stringify(az), 'the alphabetical order did not come back');

  await open();
  const original = await evaluate(page, `[...document.querySelectorAll('.organize-row')].map((n) => ({id:n.dataset.id,name:n.querySelector('label span').textContent}))`);
  await checkModal(page, '#channel-editor', 'channels');
  await page.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 720, deviceScaleFactor: 1, mobile: false });
  await checkModal(page, '#channel-editor', 'channels-narrow');
  await page.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  for (const control of ['channel-editor-close', 'Escape']) {
    await evaluate(page, `document.querySelector('.organize-row input').click()`);
    if (control === 'Escape') await pressKey(page, 'Escape', 'Escape', 27);
    else await evaluate(page, `document.getElementById('${control}').click()`);
    assert(await evaluate(page, `!document.getElementById('channel-editor').open`), `${control} did not close channel editor`);
    await open();
    assert(await evaluate(page, `document.querySelector('.organize-row input').checked`), `${control} retained an unsaved channel draft`);
  }
  // Drag row 1 onto row 0's place: the rows underneath shuffle live and the
  // floating copy goes when it is let go.
  const grip = async (index) => evaluate(page, `(() => { const r = document.querySelectorAll('.organize-row')[${index}].querySelector('[data-action="move"]').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  const mouse = (type, x, y, buttons = 1) => page.call('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount: 1 });
  const shown = () => evaluate(page, `[...document.querySelectorAll('.organize-row')].map((n) => n.dataset.id)`);
  const from = await grip(1);
  const drag = async (dy) => {
    await mouse('mouseMoved', from.x, from.y, 0);
    await mouse('mousePressed', from.x, from.y);
    await mouse('mouseMoved', from.x, from.y - 20);
    assert(await evaluate(page, `document.querySelectorAll('.organize-ghost').length === 1`), 'no floating copy while dragging');
    await mouse('mouseMoved', from.x, from.y - dy);
    assert((await shown())[0] === original[1].id, 'the dragged row did not follow the pointer');
  };
  // Escape puts the row back and leaves the editor open; the release that
  // follows belongs to a drag that is already over.
  await drag(52);
  await pressKey(page, 'Escape', 'Escape', 27);
  assert(await evaluate(page, `document.getElementById('channel-editor').open && !document.querySelector('.organize-ghost')`),
    'Escape during a drag closed the editor or left the floating copy behind');
  assert((await shown())[0] === original[0].id, 'Escape during a drag kept the move');
  await mouse('mouseReleased', from.x, from.y - 52, 0);
  await drag(52);
  await mouse('mouseReleased', from.x, from.y - 52, 0);
  assert(await evaluate(page, `!document.querySelector('.organize-ghost')`), 'the floating copy outlived the drop');
  assert((await shown()).slice(0, 2).join() === [original[1].id, original[0].id].join(), 'the drop did not hold');
  await evaluate(page, `document.querySelectorAll('.organize-row')[1].querySelector('input').click()`);
  await save();
  assert((await names())[0] === original[1].name, 'custom order not applied to channel list');
  assert(!(await names()).includes(original[0].name), 'hidden channel remained in the channel list');
  await page.call('Page.navigate', { url: bare(target.url) });
  await waitFor(page, CONNECTED, 'reload with preferences');
  await waitFor(page, `document.querySelectorAll('#list .row').length > 0`, 'reloaded list');
  assert((await names())[0] === original[1].name, 'custom order lost on reload');
  await open();
  assert(await evaluate(page, `!document.querySelector('.organize-row[data-id="${original[0].id}"] input').checked`), 'hidden channel cannot be restored from editor');
  await evaluate(page, `document.querySelector('.organize-row[data-id="${original[0].id}"] input').click(); document.getElementById('channel-editor-cancel').click()`);
  assert(!(await names()).includes(original[0].name), 'Cancel committed the draft');
  await open();
  await evaluate(page, `document.getElementById('channel-editor-show').click(); document.getElementById('channel-editor-reset').click()`);
  await save();
  assert((await names()).includes(original[0].name), 'restoring hidden channels failed');
  await open();
  await evaluate(page, `document.getElementById('channel-editor-kind').value='categories'; document.getElementById('channel-editor-kind').dispatchEvent(new Event('input'))`);
  const group = await evaluate(page, `document.getElementById('channel-editor-group').value`);
  await evaluate(page, `document.getElementById('channel-editor-hide').click()`);
  await save();
  assert(!(await evaluate(page, `[...document.querySelectorAll('#groups .group')].some((g) => g.textContent.includes(${JSON.stringify(group)}))`)), 'fully hidden category group remained in sidebar');
  await open();
  await evaluate(page, `document.getElementById('channel-editor-kind').value='categories'; document.getElementById('channel-editor-group').value=''; document.getElementById('channel-editor-kind').dispatchEvent(new Event('input')); document.getElementById('channel-editor-show').click()`);
  await save();
  assert(await evaluate(page, `[...document.querySelectorAll('#groups .group')].some((g) => g.textContent.includes(${JSON.stringify(group)}))`), 'hidden category group was not restorable');

  // The keyboard reaches the whole list without a drag: End takes the
  // handle's row to the bottom and Home brings it back, the focus travelling
  // with it. Nothing here is saved.
  const before = await names();
  await open();
  const move = (index, key) => evaluate(page, `document.querySelectorAll('.organize-row')[${index}]
    .querySelector('[data-action="move"]').dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true }))`);
  assert(await evaluate(page, `document.getElementById('channel-editor-reset').disabled`), 'Reset order was offered with nothing arranged');
  const top = (await shown())[0];
  await move(0, 'End');
  assert((await shown()).at(-1) === top, 'End did not take the row to the bottom');
  assert(await evaluate(page, `document.activeElement.dataset.action === 'move'`), 'the handle lost the focus after a keyboard move');
  assert(!(await evaluate(page, `document.getElementById('channel-editor-reset').disabled`)), 'Reset order stayed off after an arrangement');
  await move((await shown()).length - 1, 'Home');
  assert((await shown())[0] === top, 'Home did not bring the row back to the top');
  await evaluate(page, `document.getElementById('channel-editor-cancel').click()`);
  assert((await names()).join() === before.join(), 'a cancelled keyboard move reached the channel list');
  return { ok: true, detail: 'channel order from Settings (A-Z, Z-A, channel number); drag and drop with a live shuffle; End/Home from the handle; hide/save/reload; Cancel preserves saved data; hidden channels and categories restored' };
}

/**
 * Where the viewer was is where the player opens again, by two routes that
 * answer different questions.
 *
 * The address names this tab's place — the tab, the group, the topic and
 * the series drilled into — and is written as each list settles, so a
 * refresh comes back into it with the stored view deleted underneath.
 * The stored view names the place any tab last settled on, and it is what
 * the toolbar icon opens on once the tab itself has been closed.
 *
 * What the account no longer offers is dropped by either route rather than
 * restored onto an empty list, and a search is a detour rather than a
 * place: neither brings one back.
 */
async function restore(page, { target }) {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const active = () => evaluate(page, ACTIVE_GROUP);
  const topic = () => evaluate(page, `((document.querySelector('#subcats .chip.active .chip-main') || {}).textContent || '').trim().replace(/\\s*\\d+$/, '')`);
  const rows = () => evaluate(page, `document.querySelectorAll('#list .row').length`);
  const tab = () => evaluate(page, `document.querySelector('#tabs [aria-selected="true"]').dataset.tab`);
  const stored = () => evaluate(page, `(async () => (await chrome.storage.local.get('ui')).ui)()`);
  const store = (patch) => evaluate(page, `(async () => {
    const { ui } = await chrome.storage.local.get('ui');
    await chrome.storage.local.set({ ui: { ...ui, ...${JSON.stringify(patch)} } });
  })()`);
  const settled = async (what) => {
    await waitFor(page, CONNECTED, `the connection after the reload (${what})`);
    await waitFor(page, `document.querySelectorAll('#list .row').length > 0`, `the restored list (${what})`);
  };
  // The toolbar icon after the tab has been closed: a fresh address, so
  // only the stored view can say where the player was.
  const reopen = async (what) => {
    await page.call('Page.navigate', { url: bare(target.url) });
    await settled(what);
  };
  // F5: the address stands, and it is the address the place comes back from.
  const refresh = async (what) => {
    await page.call('Page.reload');
    await settled(what);
  };
  const hash = () => evaluate(page, `location.hash`);
  const title = () => evaluate(page, `document.title`);
  const crumb = () => evaluate(page, `((document.querySelector('#crumbs span') || {}).textContent || '').trim()`);
  // Nothing of the stored view is left: what comes back after this came
  // back from the address.
  const forget = () => evaluate(page, `chrome.storage.local.remove('ui')`);

  // A group other than the one the player opens on, and a topic within it.
  await openLiveList(page, 1);
  await evaluate(page, `document.querySelectorAll('#groups .group')[3].click()`);
  await waitFor(page, `document.querySelectorAll('#subcats .chip').length > 1`, 'the topic bar');
  const group = await active();
  await evaluate(page, `document.querySelectorAll('#subcats .chip')[1].querySelector('.chip-main').click()`);
  await waitFor(page, `document.querySelectorAll('#subcats .chip')[1].classList.contains('active')`, 'the chosen topic');
  const chosen = await topic();
  const narrowed = await rows();
  assert(chosen && narrowed > 0, `no topic to restore: "${chosen}", ${narrowed} rows`);

  // The address names the place, and the tab's title says it in words.
  // The sidebar row carries the favourite star in its text; the name alone
  // is what the address and the title are made of.
  const groupName = group.replace(/^[^\p{L}\p{N}]+/u, '');
  const chosenHash = await hash();
  assert(chosenHash === `#/live/${encodeURIComponent(groupName)}/${chosenHash.split('/')[3]}` && chosenHash.split('/').length === 4,
    `the address does not name the topic: "${chosenHash}" for "${groupName}"`);
  assert(await title() === `Channels › ${groupName} › ${chosen} — Kepuli-TV`,
    `the title does not follow the path: "${await title()}"`);

  // A refresh keeps the address, and the address alone brings the place
  // back: the stored view is gone before the page reloads.
  await forget();
  await refresh('the address');
  assert(await hash() === chosenHash, `the address changed over the refresh: "${chosenHash}" → "${await hash()}"`);
  assert(await active() === group, `the address lost the group: "${group}" → "${await active()}"`);
  assert(await topic() === chosen, `the address lost the topic: "${chosen}" → "${await topic()}"`);
  assert(await rows() === narrowed, `the address restored a different list: ${narrowed} → ${await rows()} rows`);

  await reopen('group and topic');
  assert(await active() === group, `the group was not restored: "${group}" → "${await active()}"`);
  assert(await topic() === chosen, `the topic was not restored: "${chosen}" → "${await topic()}"`);
  assert(await rows() === narrowed, `the restored list differs: ${narrowed} → ${await rows()} rows`);

  // A search is a detour rather than a place: it empties the group while it
  // runs, and a reload during one returns to where the search started. The
  // address says so while the search is on screen — it is the group the
  // search took over from, not the whole list it is reading — and the title
  // says what is on screen, the search included.
  await evaluate(page, `(() => { const s = document.getElementById('search'); s.value = 'news'; s.dispatchEvent(new Event('input')); })()`);
  await waitFor(page, `${ACTIVE_GROUP}.startsWith('All') && document.querySelectorAll('#list .row').length > 0`, 'the search results', 15000);
  assert(await hash() === chosenHash, `a search took the address with it: "${chosenHash}" → "${await hash()}"`);
  assert(await title() === 'Channels › Search: news — Kepuli-TV', `the title does not name the search: "${await title()}"`);
  await refresh('a search in the address');
  assert(await active() === group, `a refresh during a search lost the group: "${group}" → "${await active()}"`);
  assert(await topic() === chosen, `a refresh during a search lost the topic: "${chosen}" → "${await topic()}"`);
  assert(await evaluate(page, `document.getElementById('search').value === ''`), 'the search itself came back with the group');

  await evaluate(page, `(() => { const s = document.getElementById('search'); s.value = 'news'; s.dispatchEvent(new Event('input')); })()`);
  await waitFor(page, `${ACTIVE_GROUP}.startsWith('All') && document.querySelectorAll('#list .row').length > 0`, 'the search results again', 15000);
  await reopen('a search');
  assert(await active() === group, `a search took the stored view with it: "${group}" → "${await active()}"`);
  assert(await topic() === chosen, `a search took the stored topic with it: "${chosen}" → "${await topic()}"`);

  // A topic the account no longer offers leaves the group standing.
  await store({ sub: 'no-such-category' });
  await reopen('an unknown topic');
  assert(await active() === group, `an unknown topic lost the group: "${group}" → "${await active()}"`);
  assert(await evaluate(page, `document.querySelectorAll('#subcats .chip')[0].classList.contains('active')`), 'an unknown topic was restored onto the topic bar');
  assert(await rows() > narrowed, `an unknown topic kept the list narrowed: ${await rows()} rows`);

  // Nor does an unknown group leave the list empty under a sidebar pointing
  // at nothing: the stored view is not tied to an account, and a provider
  // renames its categories.
  await store({ group: 'Atlantis', sub: null });
  await reopen('an unknown group');
  assert(await active() !== 'Atlantis', 'an unknown group was restored');
  assert(await rows() > 0, 'an unknown group left the list empty');

  // The tab and its own group, which is a second entry in the same store.
  await evaluate(page, `document.querySelector('#tabs [data-tab="movie"]').click()`);
  await waitFor(page, `document.querySelectorAll('#list .row').length > 0`, 'the movie list');
  const movies = await active();
  await reopen('the tab');
  assert(await tab() === 'movie', `the tab was not restored: "${await tab()}"`);
  assert(await active() === movies, `the movie group was not restored: "${movies}" → "${await active()}"`);

  // A series is a place of its own, and the deepest one the list has: the
  // address carries it, and a refresh comes back into the episodes rather
  // than to the list they were opened from.
  await evaluate(page, `document.querySelector('#tabs [data-tab="series"]').click()`);
  await waitFor(page, `document.querySelectorAll('#list .row').length > 0`, 'the series list');
  await evaluate(page, `document.querySelectorAll('#list .row')[0].click()`);
  await waitFor(page, `!document.getElementById('detail').hidden && document.querySelectorAll('#list .row').length > 0`, 'the episodes');
  const series = await crumb();
  const episodes = await rows();
  assert(series && (await hash()).includes('?series='), `the address does not name the series: "${await hash()}"`);
  assert((await title()).startsWith(`Series › `) && (await title()).includes(series), `the title does not name the series: "${await title()}"`);
  await forget();
  await refresh('a series');
  await waitFor(page, `!document.getElementById('detail').hidden`, 'the restored episodes');
  assert(await crumb() === series, `the series was not restored: "${series}" → "${await crumb()}"`);
  assert(await rows() === episodes, `the restored episode list differs: ${episodes} → ${await rows()} rows`);

  // The back button leaves the series, and the address follows it out.
  await evaluate(page, `document.querySelector('#crumbs button').click()`);
  await waitFor(page, `document.getElementById('crumbs').hidden`, 'the list behind the series');
  assert(!(await hash()).includes('series='), `the address kept the series after the back button: "${await hash()}"`);

  // An address typed into the bar is a navigation like any other.
  await evaluate(page, `location.hash = '#/live/' + encodeURIComponent(${JSON.stringify(groupName)})`);
  await waitFor(page, `document.querySelector('#tabs [aria-selected="true"]').dataset.tab === 'live'`, 'the tab the address named');
  await waitFor(page, `${ACTIVE_GROUP} === ${JSON.stringify(group)}`, 'the group the address named');

  // A favourite category is a place of its own inside the favourites, and
  // the address carries it as well: a refresh comes back into the category
  // rather than to the collection's root.
  await openLiveList(page, 1);
  await waitFor(page, `document.querySelectorAll('#subcats .chip .chip-star').length > 0`, 'a topic to make a favourite');
  await evaluate(page, `document.querySelector('#subcats .chip .chip-star').click()`);
  await evaluate(page, `document.querySelector('#tabs [data-tab="fav"]').click()`);
  await waitFor(page, `document.querySelectorAll('#list .row').length > 0`, 'the favourites');
  await evaluate(page, `document.querySelector('#list .row').click()`);
  await waitFor(page, `!document.getElementById('crumbs').hidden && document.querySelectorAll('#list .row').length > 0`, 'the category contents');
  const category = await crumb();
  const inside = await rows();
  assert((await hash()).startsWith('#/fav?cat='), `the address does not name the category: "${await hash()}"`);
  await forget();
  await refresh('a favourite category');
  await waitFor(page, `!document.getElementById('crumbs').hidden`, 'the restored category');
  assert(await crumb() === category, `the category was not restored: "${category}" → "${await crumb()}"`);
  assert(await rows() === inside, `the restored category differs: ${inside} → ${await rows()} rows`);
  await evaluate(page, `document.querySelector('#crumbs button').click()`);
  await openLiveList(page, 1);

  // "All" is a choice too, and a costly one: it is the whole type rather
  // than a group of it. The address tells it apart from a group not yet
  // chosen, so a refresh comes back to the whole list rather than to the
  // first group the player would otherwise open on.
  await evaluate(page, `document.querySelector('#groups .group.all').click()`);
  await waitFor(page, `${ACTIVE_GROUP}.startsWith('All') && document.querySelectorAll('#list .row').length > 0`, 'the whole channel list', 20000);
  const all = await rows();
  assert(await hash() === '#/live/-', `All is not in the address: "${await hash()}"`);
  await forget();
  await refresh('All');
  assert((await active()).startsWith('All'), `All was not restored: "${await active()}"`);
  assert(await rows() === all, `the restored list differs: ${all} → ${await rows()} rows`);

  const ui = await stored();
  return { ok: true, detail: `address and title follow the path; refresh restores group, topic, series, favourite category and All without the stored view; a typed address navigates; stored view brings back group, topic, tab, drops a search, an unknown topic and an unknown group; stored ${JSON.stringify(ui)}` };
}

async function programmes(page, { requests }) {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  await openLiveList(page, 3);
  await evaluate(page, `document.getElementById('btn-guide').click()`);
  await waitFor(page, `document.getElementById('main').classList.contains('guide')`, 'guide');
  assert(await evaluate(page, `document.querySelectorAll('#epg-days button').length >= 8`), 'archive duration did not extend guide history');
  const search = async (query, period = 'upcoming') => {
    await evaluate(page, `document.getElementById('programme-query').value=${JSON.stringify(query)}; document.getElementById('programme-period').value=${JSON.stringify(period)}; document.getElementById('programme-form').requestSubmit()`);
    await waitFor(page, `document.getElementById('programme-status').textContent.includes('Search finished')`, 'programme search');
  };
  await search('Ice hockey');
  assert(await evaluate(page, `document.querySelectorAll('.programme-result').length > 0`), 'programme title search found no hockey');
  assert(await evaluate(page, `getComputedStyle(document.getElementById('epg-body')).display === 'none'`), 'grid not replaced by programme results');
  const before = requests.filter((r) => r.includes('get_simple_data_table')).length;
  await search('behind the scenes');
  assert(await evaluate(page, `document.querySelectorAll('.programme-result').length > 0`), 'description search found no results');
  assert(requests.filter((r) => r.includes('get_simple_data_table')).length === before, 'repeated search refetched cached full tables');
  await search('No-such-programme-38472');
  assert(await evaluate(page, `document.getElementById('programme-status').textContent.startsWith('0 results')`), 'empty search had no explicit result count');
  await search('News', 'past');
  await evaluate(page, `document.querySelector('.programme-result').click()`);
  await waitFor(page, `document.querySelector('#epgv-slot b')`, 'search result detail');
  await evaluate(page, `document.getElementById('programme-clear').click()`);
  assert(await evaluate(page, `!document.getElementById('epg-body').hidden && document.getElementById('programme-panel').hidden`), 'return to guide failed');
  return { ok: true, detail: 'archive-length guide; title/description search, cached repeat, empty results, past results and return to grid' };
}

async function catchup(page, { requests }) {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  await openLiveList(page, 3);
  await evaluate(page, `(async () => {
    const {XtreamApi}=await import('./js/api.js');
    const {config}=await chrome.storage.local.get('config');
    const channels=await new XtreamApi(config).streams('live');
    const names=[...document.querySelectorAll('#list .row-name')];
    const row=names.find(n=>channels.some(c=>c.n===n.title && c.archive>0));
    if(!row) throw new Error('No archived channel in view');
    row.closest('.row').click();
  })()`, { gesture: true });
  await waitFor(page, PLAYING, 'live channel');
  await evaluate(page, `document.getElementById('btn-guide').click()`);
  await waitFor(page, `[...document.querySelectorAll('#epgv-actions button')].some(b=>b.textContent==='Start from beginning')`, 'start-over action');
  await click(page, '#epgv-actions', 'Start from beginning', { gesture: true });
  await waitFor(page, PLAYING, 'start-over playback');
  assert(requests.some((r) => r.startsWith('/timeshift/')), 'start over did not request the archive');
  const archiveCount = () => requests.filter((r) => r.startsWith('/timeshift/')).length;
  let before = archiveCount();
  await evaluate(page, `document.getElementById('btn-reload').click()`, { gesture: true });
  await waitFor(page, PLAYING, 'archive reload');
  assert(archiveCount() > before, 'reload escaped to live instead of reloading the archive');
  before = archiveCount();
  await evaluate(page, `document.getElementById('video').dispatchEvent(new Event('ended'))`);
  await sleep(2200);
  assert(archiveCount() === before, 'archive ended event triggered live reconnection');
  await evaluate(page, `document.getElementById('btn-live').click()`, { gesture: true });
  await waitFor(page, PLAYING, 'return to live');
  assert(await evaluate(page, `document.getElementById('btn-live').hidden && !document.getElementById('mode').disabled`), 'return to live left archive controls active');
  return { ok: true, detail: 'current programme starts via timeshift; reload stays in archive; end does not reconnect; return to live' };
}


async function setupClarity(page) {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const press = (id) => evaluate(page, `document.getElementById('${id}').click()`, { gesture: true });
  const change = (id, value) => evaluate(page, `(() => {const input=document.getElementById('${id}');input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  // What Chrome sends on Ctrl+V: the inputType is what tells a whole
  // address from one still being typed.
  const paste = (id, value) => evaluate(page, `(() => {const input=document.getElementById('${id}');input.focus();input.value=${JSON.stringify(value)};input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertFromPaste'}));})()`);
  const capture = async (name) => {
    if (!process.env.KEPULI_SETUP_CAPTURE_DIR) return;
    const fs = await import('node:fs');
    fs.mkdirSync(process.env.KEPULI_SETUP_CAPTURE_DIR, {recursive:true});
    const {data} = await page.call('Page.captureScreenshot', {format:'png'});
    fs.writeFileSync(`${process.env.KEPULI_SETUP_CAPTURE_DIR}/${name}.png`, Buffer.from(data,'base64'));
  };
  const before = await evaluate(page, `chrome.storage.local.get(['config','settings'])`);
  await press('btn-settings');
  await evaluate(page, `document.querySelector('input[name="source"][value="m3u"]').click()`);
  await change('f-paste', 'http://example.test:8080/get.php?username=%3Cusername%3E');
  assert(await evaluate(page, `!document.getElementById('playlist-status').hidden && !document.getElementById('src-m3u').hidden`), 'an address without a password was accepted');
  await paste('f-paste', 'http://example.test:8080/get.php?username=%3Cusername%3E&password=%3Cpassword%3E&type=m3u_plus&output=ts');
  const fields = await evaluate(page, `['scheme','host','port','username','password'].map(f=>document.getElementById('f-'+f).value)`);
  assert(JSON.stringify(fields) === JSON.stringify(['http','example.test','8080','<username>','<password>']), 'pasted URL was not decoded into visible fields');
  assert(await evaluate(page, `!document.getElementById('src-xtream').hidden && document.getElementById('src-m3u').hidden && document.getElementById('playlist-status').hidden && document.activeElement.id==='f-host'`), 'a pasted address did not open and focus the fields it filled');
  await capture('subscription-url');
  assert(JSON.stringify(await evaluate(page, `chrome.storage.local.get(['config','settings'])`)) === JSON.stringify(before), 'pasting committed credentials before Save');
  await press('f-done');
  await press('btn-settings');
  await evaluate(page, `document.querySelector('#setup-tabs [data-panel="subs"]').click()`);
  await change('f-subsize', '72');
  for (const [width,height] of [[1280,800],[390,844],[320,568],[640,420]]) {
    await page.call('Emulation.setDeviceMetricsOverride', {width,height,deviceScaleFactor:1,mobile:false});
    for (const style of ['shadow','box','contrast']) {
      await change('f-substyle', style);
      await sleep(120);
      const fit = await evaluate(page, `(() => {
        const frame=document.querySelector('.sublook-preview').getBoundingClientRect(),
          sample=document.querySelector('.sublook-preview .subdisplay').getBoundingClientRect(),
          controls=document.querySelector('.sublook-fields').getBoundingClientRect(),
          panel=document.getElementById('panel-subs').getBoundingClientRect(),
          save=document.getElementById('f-save').getBoundingClientRect();
        return {inside:sample.left>=frame.left && sample.right<=frame.right && sample.top>=frame.top && sample.bottom<=frame.bottom,
          controlsAbove:controls.bottom<=frame.top,visible:controls.top>=panel.top && frame.bottom<=panel.bottom+1,
          footer:save.bottom<=innerHeight, size:document.getElementById('f-subsize').value,
          runtime:document.body.style.getPropertyValue('--sub-size')};})()`);
      assert(fit.inside && fit.controlsAbove && fit.visible && fit.footer && fit.size==='72' && fit.runtime==='24px', `${width}x${height} ${style}: ${JSON.stringify(fit)}`);
      if(style==='box') await capture(`subtitles-72-${width}`);
    }
  }
  await page.call('Emulation.setDeviceMetricsOverride', {width:1280,height:800,deviceScaleFactor:1,mobile:false});
  await press('f-save');
  await waitFor(page, `!document.getElementById('setup').open`, 'saved 72px subtitles');
  assert(await evaluate(page, `chrome.storage.local.get('settings').then(d=>d.settings.subtitleSize===72 && document.body.style.getPropertyValue('--sub-size')==='72px')`), 'preview scaling changed saved or playback size');
  return {ok:true, detail:'a pasted subscription URL opens the fields it decoded into, without saving; an incomplete one says so; controls above an unclipped 72px preview at 320–1280px; playback saves 72px'};
}


/** Covers and catalogue metadata use the same DOM in both browsers. */
async function catalogUi(page) {
  const assert = (ok, detail) => { if (!ok) throw new Error(detail); };
  await evaluate(page, `document.querySelector('[data-tab="movie"]').click()`);
  await waitFor(page, `document.querySelectorAll('#list .row').length > 1 && document.getElementById('list-progress').hidden`, 'movie rows');
  await waitFor(page, `document.querySelector('#list .row-duration')`, 'movie duration metadata');
  assert(await evaluate(page, `!document.getElementById('media-filters').hidden && document.getElementById('channel-tools').hidden && document.querySelector('.topbar-end').lastElementChild.id === 'btn-settings'`), 'movie navigation/filters');
  const apply = (key,value) => evaluate(page, `(() => {const f=document.querySelector('#media-filters [name="${key}"]');f.value=${JSON.stringify(value)};f.dispatchEvent(new Event('change'));})()`);
  await apply('rating','8');
  await waitFor(page, `document.getElementById('list-progress').hidden && document.querySelectorAll('#list .row').length > 0`, 'rating filter');
  assert(await evaluate(page, String.raw`[...document.querySelectorAll('#list .row-sub')].every(n => Number(n.textContent.match(/★\s*([\d.]+)/)?.[1]) >= 8)`), 'low rating leaked into filtered movies');
  await apply('sort','rating');
  const values = await evaluate(page, String.raw`[...document.querySelectorAll('#list .row-sub')].map(n=>Number(n.textContent.match(/★\s*([\d.]+)/)?.[1]))`);
  assert(values.every((v,i)=>!i || values[i-1]>=v), 'rating sort order');
  await evaluate(page, `document.querySelector('.media-filter-footer button').click()`);
  await waitFor(page, `document.querySelectorAll('#list .row').length > 1`, 'filter reset');
  await evaluate(page, `document.querySelector('#list .row').click()`, {gesture:true});
  await waitFor(page, PLAYING, 'native movie playback');
  await waitFor(page, `document.querySelector('#infostrip .title-links a') && document.querySelector('#infostrip .playback-facts')`, 'movie facts and external link');
  assert(await evaluate(page, `document.querySelector('#infostrip .title-links a').href.startsWith('https://www.imdb.com/')`), 'IMDb link destination');
  await playEpisode(page);
  await waitFor(page, `document.querySelector('#detail .detail-cover.loaded:not(:disabled)')`, 'series cover');
  await evaluate(page, `document.querySelector('#detail .detail-cover').click()`);
  await waitFor(page, `document.querySelector('.poster-dialog[open] img')`, 'expanded cover');
  await checkModal(page, '.poster-dialog', 'poster');
  await evaluate(page, `document.querySelector('.poster-close').click()`);
  assert(await evaluate(page, `!document.querySelector('.poster-dialog[open]')`), 'cover did not close');
  await evaluate(page, `document.querySelector('[data-tab="recent"]').click()`);
  await waitFor(page, `document.querySelectorAll('#list .row').length >= 2`, 'movie and episode history');
  // Exercise actual image loading and error handling without a remote provider.
  await evaluate(page, `import('./js/poster.js').then(({poster})=>{
    const host=document.createElement('div');host.id='cover-check';document.body.append(host);
    host.append(poster('row-logo','', 'channel'),poster('row-logo','data:image/png;base64,bm90aW1hZ2U=', 'channel'));
  })`);
  await waitFor(page, `!document.querySelector('#cover-check img')`, 'failed image fallback');
  assert(await evaluate(page, `[...document.querySelectorAll('#cover-check svg')].every(svg=>getComputedStyle(svg).visibility==='visible')`), 'channel placeholder hidden');
  await evaluate(page, `document.getElementById('cover-check').remove()`);
  await openLiveList(page);
  assert(await evaluate(page, `!document.getElementById('channel-tools').hidden && document.getElementById('media-filters').hidden`), 'channel navigation');
  await evaluate(page, `document.getElementById('btn-guide').click()`);
  await waitFor(page, `document.getElementById('main').classList.contains('guide')`, 'guide entry');
  await mouseClick(page, '#epg-close');
  assert(await evaluate(page, `!document.getElementById('main').classList.contains('guide') && document.activeElement.id==='btn-guide'`), 'guide return and focus');
  return {ok:true,detail:'movie duration, rating filter/sort/reset, native playback, IMDb/facts, series cover expansion, history, failed/missing logo fallback and guide return'};
}

const SCENARIOS = { catalogUi, setupClarity, fullscreenControl, organize, restore, programmes, catchup, seek, death, cancel, timeout, search, paste, keys, switching, resume, reconnect, accounts, listerror, a11y, subtitles, audio, settings };
// The mock's whole-list answers stall for these, longer than the request limit.
const SLOW_LIST_MS = { cancel: 60000, timeout: 60000 };
// The media is sent slowly for these: the seek targets must lie outside the
// buffer, and the download must still be under way when the server is cut.
const THROTTLED = new Set(['seek', 'death', 'reconnect']);

/* -------------------------------------------------------------------- main */

const wanted = process.argv.slice(2).filter((a) => SCENARIOS[a]);
const unknown = process.argv.slice(2).filter((a) => !SCENARIOS[a]);
if (unknown.length) { console.error(`unknown scenario ${unknown.join(' ')}; the choices are ${Object.keys(SCENARIOS).join(' and ')}`); process.exit(1); }

await ensureChrome(['--autoplay-policy=no-user-gesture-required', ...(process.env.KEPULI_HEADLESS ? ['--headless=new', '--window-size=1280,800'] : [])]);
let failed = 0;
try {
  for (const name of wanted.length ? wanted : Object.keys(SCENARIOS)) {
    // A mock server of its own for every scenario, one of them kills it —
    // sending slowly, so that the file is not on the browser's side whole
    // before the scenario begins (see KEPULI_MOCK_THROTTLE in the server).
    process.env.KEPULI_MOCK_THROTTLE = THROTTLED.has(name) ? String(THROTTLE) : '';
    process.env.KEPULI_MOCK_SLOW_LIST = String(SLOW_LIST_MS[name] || '');
    const server = await startMockServer(MOCK_PORT);
    const requests = [];
    server.on('request', (req) => requests.push(req.url));
    const target = await openPlayer();
    const page = session(target.webSocketDebuggerUrl);
    try {
      await freshPlayer(target, page);
      const { ok, detail } = await SCENARIOS[name](page, { server, requests, target });
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);
      if (!ok) failed++;
    } catch (err) {
      console.log(`FAIL  ${name}: ${err.message}`);
      failed++;
    } finally {
      page.close();
      if (server.listening) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
    }
  }
} finally {
  setTimeout(() => process.exit(failed ? 1 : 0), 200);
}
