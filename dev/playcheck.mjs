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
//   node dev/playcheck.mjs search     a search takes over from the group and
//                                     clearing it brings the group back
//   node dev/playcheck.mjs paste      a whole address pasted into the Server
//                                     field is split into its parts
//   node dev/playcheck.mjs keys       Esc and the arrows keep working after a
//                                     button has been clicked with the mouse
//   node dev/playcheck.mjs switching  a channel switch during the wait before
//                                     a reconnect leaves the new channel alone
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
//   node dev/playcheck.mjs subtitles  the cues are drawn by the layer, a
//                                     two-line cue in one box; a double click
//                                     takes the wrapper to full screen with
//                                     the layer; a file without subtitles
//                                     says so in the details
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
import { ensureChrome, openPlayer, session, sleep } from './screenshot.mjs';

const THROTTLE = Number(process.env.KEPULI_THROTTLE || 60 * 1024);
const CUES_DELAY_MS = 1500;
const PLAYING = `(() => { const v = document.getElementById('video'); return v.readyState >= 2 && v.currentTime > 0.3 && !v.paused; })()`;
const CONNECTED = `document.querySelectorAll('#groups .group').length > 1 && !document.getElementById('progress').open`;

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

/* ---------------------------------------------------------------- set-up */

/** A fresh player pointed at the mock server, connected and throttled. */
async function freshPlayer(target, page) {
  const { windowId } = await page.call('Browser.getWindowForTarget');
  await page.call('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
  await page.call('Page.bringToFront');
  const visibility = await evaluate(page, 'document.visibilityState');
  if (visibility !== 'visible') throw new Error('the player tab is not visible; raise the dev Chrome window or run headless');
  // The personal lists are kept per account, so every account's copy goes.
  await evaluate(page, `chrome.storage.local.get(null).then((all) => chrome.storage.local.remove(Object.keys(all).filter((k) => /^(favorites|recents|resume)(:|$)/.test(k))))`);
  await evaluate(page, `chrome.storage.local.set({
    config: { scheme: 'http', host: '127.0.0.1', port: '${MOCK_PORT}', username: 'demo', password: 'demo', sourceMode: 'xtream', streamMode: 'auto' },
    settings: { lang: 'en', epgEnabled: true, resumeEnabled: false, subtitleLang: 'eng' },
    ui: { tab: 'series' } })`);
  // The catalogue cache is dropped as the screenshot script does: a run
  // against another server would otherwise hand out that server's addresses.
  const origin = target.url.match(/^chrome-extension:\/\/[a-p]{32}/)[0];
  await page.call('Page.navigate', { url: `${origin}/css/player.css` });
  await sleep(500);
  await evaluate(page, `indexedDB.databases().then((dbs) => Promise.all(dbs.map((d) => new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(d.name); req.onsuccess = req.onerror = req.onblocked = () => resolve(d.name); }))))`);
  await page.call('Page.navigate', { url: target.url });
  await sleep(1000);
  await waitFor(page, CONNECTED, 'the connection');
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
  await evaluate(page, `document.querySelector('#tabs [data-tab="live"]').click()`);
  await waitFor(page, `document.querySelectorAll('#groups .group').length > 1`, 'the sidebar');
  const before = await evaluate(page, ACTIVE_GROUP);
  await click(page, '#groups', 'All');
  await waitFor(page, `document.getElementById('progress').open`, 'the progress dialog', 5000);
  return before;
}

async function cancel(page) {
  const before = await loadAll(page);
  await sleep(1500);
  await evaluate(page, `document.getElementById('p-cancel').click()`);
  const t0 = Date.now();
  await waitFor(page, `!document.getElementById('progress').open`, 'the dialog to close', 5000);
  const closedIn = Date.now() - t0;
  await sleep(500);
  const after = await evaluate(page, `({ overlay: ${OVERLAY}, active: ${ACTIVE_GROUP}, rows: document.querySelectorAll('#list .row').length, toast: document.getElementById('toast').textContent.trim() })`);
  // The overlay may say "Nothing playing": only an error counts against.
  const ok = !/failed|error/i.test(after.overlay || '') && after.active === before && after.rows > 0;
  return { ok, detail: `dialog closed in ${closedIn} ms; group "${before}" → "${after.active}", ${after.rows} rows, overlay ${after.overlay}, toast "${after.toast}"` };
}

async function timeout(page) {
  const before = await loadAll(page);
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < 35000) {
    // The list's own error goes to a toast over the rows on screen (or to
    // the list's empty state when there are none), never over the player.
    last = await evaluate(page, `({ open: document.getElementById('progress').open, overlay: ${OVERLAY}, active: ${ACTIVE_GROUP},
      toast: document.getElementById('toast').hidden ? '' : document.getElementById('toast').textContent.trim(),
      empty: (document.querySelector('#list .empty') || {}).textContent || '' })`);
    if (!last.open && /did not answer within/.test(last.toast + last.empty)) {
      const ok = !/failed/i.test(last.overlay || '') && last.active === before;
      return { ok, detail: `after ${((Date.now() - t0) / 1000).toFixed(1)} s: "${last.toast || last.empty}"; group "${before}" → "${last.active}", overlay ${last.overlay ? '"' + last.overlay + '"' : 'hidden'}` };
    }
    await sleep(500);
  }
  return { ok: false, detail: `after 35 s the dialog is ${last.open ? 'still open' : 'closed'}, toast "${last.toast}", overlay ${last.overlay}` };
}

/** A search takes over from the group, and the group comes back when the search is cleared. */
async function search(page) {
  await evaluate(page, `document.querySelector('#tabs [data-tab="live"]').click()`);
  await waitFor(page, `document.querySelectorAll('#groups .group').length > 1`, 'the sidebar');
  const before = await evaluate(page, ACTIVE_GROUP);
  const type = (text) => evaluate(page, `(() => { const s = document.getElementById('search'); s.value = ${JSON.stringify(text)}; s.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await type('aurora');
  await waitFor(page, `${ACTIVE_GROUP}.startsWith('All') && !document.getElementById('progress').open && document.querySelectorAll('#list .row').length > 0`, 'the search results', 15000);
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
  const address = `http://127.0.0.1:${MOCK_PORT}/player_api.php?username=demo&password=demo`;
  await evaluate(page, `(() => { const h = document.getElementById('f-host'); h.value = ${JSON.stringify(address)};
    h.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await sleep(300);
  const fields = await evaluate(page, `['scheme', 'host', 'port', 'username', 'password'].map((f) => document.getElementById('f-' + f).value)`);
  await evaluate(page, `document.getElementById('f-cancel').click()`);
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
async function pressKey(page, key, code, keyCode) {
  await page.call('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode });
  await page.call('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode });
}

/** The keys keep working after a button has been clicked with the mouse. */
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
  return { ok: guideClosed && cursorMoved, detail: `Esc after the Guide click ${guideClosed ? 'closed' : 'did not close'} the guide; ArrowDown after the tab click ${cursorMoved ? 'moved' : 'did not move'} the cursor; focus on ${focus}` };
}

/**
 * A live channel dies and the viewer switches channel during the wait
 * before the reconnect. The wait must not restart the new channel: every
 * attempt begins with a request for the .ts address, so the new channel's
 * must be asked for once.
 */
async function switching(page, { requests }) {
  await evaluate(page, `document.querySelector('#tabs [data-tab="live"]').click()`);
  await waitFor(page, `document.querySelectorAll('#list .row').length > 1`, 'the channel rows');
  await evaluate(page, `document.querySelectorAll('#list .row')[0].click()`, { gesture: true });
  try {
    await waitFor(page, PLAYING, 'the first channel');
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
  return { ok: ts.length === 1, detail: `${ts.length} stream request(s) after the switch: ${ts.join(' ')}` };
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
      await page.call('Page.navigate', { url: target.url });
      await sleep(1000);
      try {
        await waitFor(page, CONNECTED, `the connection on port ${port}`);
      } catch (err) {
        const st = await evaluate(page, `(async () => ({ overlay: ${OVERLAY}, progress: document.getElementById('progress').open, groups: document.querySelectorAll('#groups .group').length, keys: Object.keys(await chrome.storage.local.get(null)) }))()`);
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
  await evaluate(page, `document.querySelector('#tabs [data-tab="live"]').click()`);
  await waitFor(page, `document.querySelectorAll('#list .row').length > 0`, 'the channel rows');
  const before = await evaluate(page, ACTIVE_GROUP);
  await evaluate(page, `document.querySelector('#list .row').click()`, { gesture: true });
  await waitFor(page, PLAYING, 'the channel');
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
  await evaluate(page, `document.querySelector('#tabs [data-tab="live"]').click()`);
  await waitFor(page, `document.querySelectorAll('#list .row').length > 1`, 'the channel rows');
  await evaluate(page, `document.getElementById('list').focus()`);
  await pressKey(page, 'ArrowDown', 'ArrowDown', 40);
  await sleep(300);
  const st = await evaluate(page, `(() => {
    const list = document.getElementById('list');
    const selected = list.querySelector('.row.selected');
    const tabs = [...document.querySelectorAll('#tabs [role="tab"]')];
    const iconButtons = [...document.querySelectorAll('button[data-i18n-title]')].filter((b) => !/\\p{L}/u.test(b.textContent));
    const group = document.querySelectorAll('#groups .group')[2];
    return {
      listRole: list.getAttribute('role'), listName: list.getAttribute('aria-label'),
      pointsAtCursor: Boolean(selected) && list.getAttribute('aria-activedescendant') === selected.id && selected.getAttribute('role') === 'option' && selected.getAttribute('aria-selected') === 'true',
      cursorMark: selected ? getComputedStyle(selected).boxShadow !== 'none' : false,
      tablist: document.getElementById('tabs').getAttribute('role'),
      selectedTabs: tabs.filter((b) => b.getAttribute('aria-selected') === 'true').map((b) => b.dataset.tab),
      toastRole: document.getElementById('toast').getAttribute('role'),
      unnamedIcons: iconButtons.filter((b) => !b.getAttribute('aria-label')).map((b) => b.id || b.className),
      groupTabbable: group ? group.tabIndex === 0 : false,
      groupName: group ? group.textContent.trim().replace(/\\s*\\d+$/, '') : null,
    }; })()`);
  // A sidebar group by keyboard: Tab-reachable, chosen with Enter.
  await evaluate(page, `document.querySelectorAll('#groups .group')[2].focus()`);
  await pressKey(page, 'Enter', 'Enter', 13);
  await sleep(800);
  const chosen = await evaluate(page, ACTIVE_GROUP);
  const ok = st.listRole === 'listbox' && Boolean(st.listName) && st.pointsAtCursor && st.cursorMark
    && st.tablist === 'tablist' && st.selectedTabs.length === 1 && st.selectedTabs[0] === 'live'
    && st.toastRole === 'status' && st.unnamedIcons.length === 0 && st.groupTabbable && chosen === st.groupName;
  return { ok, detail: `list ${st.listRole}/${st.listName}, cursor ${st.pointsAtCursor ? 'announced' : 'not announced'} and ${st.cursorMark ? 'marked' : 'unmarked'}, tabs ${st.tablist} selected ${st.selectedTabs.join(',')}, toast ${st.toastRole}, unnamed icon buttons ${st.unnamedIcons.length}, group by keyboard: "${st.groupName}" → "${chosen}"` };
}

async function subtitles(page) {
  await playEpisode(page);
  await waitFor(page, `document.querySelectorAll('#subdisplay .cue').length > 0`, 'a cue in the layer');
  // One box per active cue, drawn by the layer while the track stays showing.
  const first = await evaluate(page, `(() => { const v = document.getElementById('video'); const shown = [...v.textTracks].filter((t) => t.mode === 'showing');
    return { render: document.body.dataset.subrender, showing: shown.length, active: shown[0] ? shown[0].activeCues.length : 0,
      boxes: document.querySelectorAll('#subdisplay .cue').length, meta: document.querySelector('#infostrip .meta').textContent }; })()`);
  if (first.render !== 'overlay' || first.showing !== 1 || !first.boxes || first.boxes !== first.active) return { ok: false, detail: `the layer: ${JSON.stringify(first)}` };
  if (!/2 subtitles: en, fi/.test(first.meta)) return { ok: false, detail: `the details say ${JSON.stringify(first.meta)}` };
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
  for (const clickCount of [1, 2]) {
    await page.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', clickCount });
    await page.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', clickCount });
  }
  await sleep(1000);
  const full = await evaluate(page, `(() => ({ element: document.fullscreenElement && document.fullscreenElement.id,
    boxes: document.querySelectorAll('#subdisplay .cue').length, render: document.body.dataset.subrender }))()`);
  await evaluate(page, `document.fullscreenElement && document.exitFullscreen()`);
  await sleep(600);
  if (full.element !== 'videowrap' || full.boxes !== 1 || full.render !== 'overlay') return { ok: false, detail: `full screen: ${JSON.stringify(full)}` };
  // A file with no subtitles: the details below the player say so.
  await evaluate(page, `document.querySelector('#tabs [data-tab="movie"]').click()`);
  await waitFor(page, `document.querySelectorAll('#groups .group').length > 1`, 'the movie groups');
  await evaluate(page, `document.querySelectorAll('#groups .group')[1].click()`);
  await click(page, '#list', 'Crossfire Alley', { gesture: true });
  await waitFor(page, PLAYING, 'the movie');
  await waitFor(page, `/No subtitles/.test((document.querySelector('#infostrip .meta') || {}).textContent || '')`, 'the details of the movie', 10000);
  return { ok: true, detail: `one box for ${first.active} cue, two lines in one box, full screen on the wrapper, the movie says "No subtitles"` };
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
  await page.call('Emulation.clearDeviceMetricsOverride');
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
  await page.call('Page.navigate', { url: target.url });
  await sleep(1000);
  await waitFor(page, CONNECTED, 'the connection after the reload');
  const finnish = await heard(2);
  if (Math.abs(finnish.hz - 660) > 12) return { ok: false, detail: `with Finnish asked for it sounds at ${finnish.hz} Hz (${finnish.db} dB), expected the Finnish track's 660 Hz` };
  return { ok: true, detail: `episode ${id}: automatic ${auto.hz} Hz, switched to Finnish ${switched.hz} Hz with the picture running from ${before.t} to ${after.t} s, to the AC-3 commentary ${commentary.hz} Hz, audioLang fi opens at ${finnish.hz} Hz, and the row fits at 1024-1512 px` };
}

const SCENARIOS = { seek, death, cancel, timeout, search, paste, keys, switching, resume, reconnect, accounts, listerror, a11y, subtitles, audio };
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
