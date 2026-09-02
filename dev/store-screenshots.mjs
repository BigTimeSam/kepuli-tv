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
// The extension in the development profile is left pointing at the mock
// server; its settings dialog takes it back to a real one.

import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMockServer, PORT as MOCK_PORT, USER, PASS } from './mock/server.mjs';
import { ensureChrome, openPlayer, session, setViewport, clearViewport, capture, sleep } from './screenshot.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'brand', 'screenshots');

/* ------------------------------------------------------------ page helpers */

async function evaluate(page, expression, { gesture = false } = {}) {
  const { result, exceptionDetails } = await page.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: gesture });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
  return result.value;
}

/** Polls an expression until it is truthy. */
async function waitFor(page, expression, what, timeout = 25000) {
  const t0 = Date.now();
  for (;;) {
    let value = false;
    try { value = await evaluate(page, expression); } catch { /* the page may be mid-reload */ }
    if (value) return value;
    if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for ${what}`);
    await sleep(200);
  }
}

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
const CONNECTED = `document.querySelectorAll('#groups .group').length > 1 && !document.getElementById('progress').open`;
const ROWS = `document.querySelectorAll('#list .row').length > 0 && !document.getElementById('progress').open`;

/* -------------------------------------------------------------------- main */

mkdirSync(OUT, { recursive: true });
const server = await startMockServer(MOCK_PORT);
console.log(`mock server on http://127.0.0.1:${MOCK_PORT}`);
await ensureChrome(['--autoplay-policy=no-user-gesture-required']);
const target = await openPlayer();
const page = session(target.webSocketDebuggerUrl);
try {
  await page.call('Page.bringToFront');
  await setViewport(page);

  // Point the extension at the mock server and start from a clean slate.
  await evaluate(page, `chrome.storage.local.set({
    config: { scheme: 'http', host: '127.0.0.1', port: ${JSON.stringify(String(MOCK_PORT))}, username: ${JSON.stringify(USER)}, password: ${JSON.stringify(PASS)}, sourceMode: 'xtream', streamMode: 'auto' },
    settings: { lang: 'en', epgEnabled: true, resumeEnabled: true, subtitleLang: 'eng' },
    ui: { tab: 'live' }, favorites: [], recents: [], resume: {},
  })`);
  await page.call('Page.reload', { ignoreCache: true });
  await sleep(1000);
  await waitFor(page, CONNECTED, 'the connection to the mock server');
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
  await sleep(2500);                                   // now/next below the player
  await capture(page, join(OUT, '01-channels.png'));

  // 2. The programme guide over the same channels.
  await evaluate(page, `document.getElementById('btn-guide').click()`);
  await waitFor(page, `document.getElementById('main').classList.contains('guide') && document.querySelectorAll('#epg-canvas *').length > 20`, 'the guide grid');
  await sleep(3000);                                   // the grid's own programme fetches
  await capture(page, join(OUT, '02-guide.png'));
  await evaluate(page, `document.getElementById('epg-close').click()`);
  await sleep(500);

  // 3. A series: cover, plot, seasons and episodes.
  await evaluate(page, `document.querySelector('#tabs [data-tab="series"]').click()`);
  await click(page, '#groups', 'Nordic Noir');
  await click(page, '#list', 'Silent Fjord');
  await waitFor(page, `!document.getElementById('detail').hidden && document.querySelector('#detail .detail-plot') && document.querySelectorAll('#list .row').length > 0`, 'the series page');
  await sleep(1500);                                   // covers
  await capture(page, join(OUT, '03-series.png'));

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
  await capture(page, join(OUT, '04-subtitles.png'));

  // 5. A movie with its details below the player.
  await evaluate(page, `document.querySelector('#tabs [data-tab="movie"]').click()`);
  await click(page, '#groups', 'Nordic');
  await click(page, '#list', 'Northern Lights', { gesture: true });
  await waitFor(page, PLAYING, 'the movie');
  await waitFor(page, `!document.getElementById('infostrip').hidden && !!document.querySelector('#infostrip .plot')`, 'the movie details');
  await sleep(1500);
  await capture(page, join(OUT, '05-movie.png'));
} finally {
  await clearViewport(page).catch(() => {});
  page.close();
  // The paced live stream would keep the server, and this process, alive
  // for as long as the file lasts.
  server.closeAllConnections();
  server.close();
}
