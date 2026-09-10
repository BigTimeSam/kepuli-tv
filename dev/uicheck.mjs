#!/usr/bin/env node
// UI regressions against the local mock catalogue, in an isolated headless
// Chrome profile. No provider account or existing browser profile is touched.
// node dev/uicheck.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const work = mkdtempSync(join(tmpdir(), 'kepuli-ui-'));
process.env.KEPULI_DEV_PROFILE = join(work, 'chrome');
process.env.KEPULI_DEV_PORT = process.env.KEPULI_UI_PORT || '9341';
const { ensureChrome, openPlayer, session, sleep, isRunning } = await import('./screenshot.mjs');
const { startMockServer } = await import('./mock/server.mjs');
assert.equal(await isRunning(), false, 'the test port must be free; never reuse an existing profile');
const server = await startMockServer(0);
const port = server.address().port;
let page;
const evaluate = async expression => {
  const { result, exceptionDetails } = await page.call('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true, userGesture: true,
  });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
  return result.value;
};
const waitFor = async expression => {
  for (let i = 0; i < 150; i++) {
    if (await evaluate(expression)) return;
    await sleep(100);
  }
  throw new Error(`Timed out: ${expression}`);
};
const settled = () => waitFor(`document.querySelector('#list').getAttribute('aria-busy') === 'false'`);
const click = async selector => { await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await settled(); };
const key = key => page.call('Input.dispatchKeyEvent', { type: 'keyDown', key });
const search = async query => {
  await evaluate(`document.querySelector('#search').value = ${JSON.stringify(query)};
    document.querySelector('#search').dispatchEvent(new Event('input', { bubbles: true }));`);
  await sleep(250);
  await settled();
};
const viewport = async width => {
  await page.call('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false });
  await sleep(100);
};
const capture = async name => {
  const { data } = await page.call('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(work, `${name}.png`), Buffer.from(data, 'base64'));
};

try {
  await ensureChrome(['--headless=new', '--autoplay-policy=no-user-gesture-required']);
  const target = await openPlayer();
  page = session(target.webSocketDebuggerUrl);
  await evaluate(`chrome.storage.local.set({
    config: { scheme: 'http', host: '127.0.0.1', port: '${port}', username: 'demo', password: 'demo', sourceMode: 'xtream', streamMode: 'auto' },
    settings: { lang: 'fi', epgEnabled: true }, ui: { tab: 'series' }
  })`);
  await page.call('Page.reload');
  await waitFor(`document.querySelectorAll('#list .row').length > 0 && document.querySelector('#list').getAttribute('aria-busy') === 'false'`);
  await evaluate(`window.uiErrors = [];
    window.addEventListener('error', e => uiErrors.push(e.message));
    window.addEventListener('unhandledrejection', e => uiErrors.push(String(e.reason)));`);
  await viewport(1280);
  await click('#groups .group'); // All series, long enough to scroll.
  await evaluate(`document.querySelector('#list').focus()`);
  for (let i = 0; i < 18; i++) await key('ArrowDown');
  const before = await evaluate(`({ scroll: document.querySelector('#list').scrollTop,
    selected: document.querySelector('#list [aria-selected="true"] .row-name').textContent })`);
  assert(before.scroll > 0);
  await key('Enter');
  await waitFor(`!document.querySelector('#detail').hidden && document.querySelector('#list').getAttribute('aria-busy') === 'false'`);
  await click('#crumbs button');
  const after = await evaluate(`({ scroll: document.querySelector('#list').scrollTop,
    selected: document.querySelector('#list [aria-selected="true"] .row-name')?.textContent,
    focused: document.activeElement.id })`);
  assert.equal(after.scroll, before.scroll, 'return restores the scroll position');
  assert.equal(after.selected, before.selected, 'return restores the selected item');
  assert.equal(after.focused, 'list', 'return restores keyboard focus');

  await click('#groups .group:nth-child(2)');
  const parentRoute = await evaluate('location.hash');

  await search('Orbital');
  await click('#list .row');
  assert((await evaluate('location.hash')).startsWith(`${parentRoute}?series=`), 'a search result keeps its parent group in the address');
  assert.equal(await evaluate(`document.querySelector('#search').value`), '', 'episode browsing suspends the parent search');
  await search('no-such-episode');
  assert.equal(await evaluate(`document.querySelectorAll('#list .row').length`), 0, 'episode search follows its displayed scope');
  await click('#crumbs button');
  assert.equal(await evaluate(`document.querySelector('#search').value`), 'Orbital', 'return restores the parent search');
  assert.equal(await evaluate(`document.querySelector('#list [aria-selected="true"] .row-name').textContent`), 'Orbital');

  await click('#search-clear');
  assert.equal(await evaluate('location.hash'), parentRoute, 'clearing the restored search returns to its original group');

  // A favourite category and the series inside it each own a return position.
  await click('#groups .group:nth-child(2) .group-star');
  await click('#tab-fav');
  await click('#list .row');
  const categoryTitle = await evaluate(`document.querySelector('#crumbs').textContent`);
  await click('#list .row');
  await click('#crumbs button');
  assert.equal(await evaluate(`document.querySelector('#crumbs').textContent`), categoryTitle, 'a nested series returns to its favourite category');
  assert(await evaluate(`!!document.querySelector('#list [aria-selected="true"]')`));
  await click('#crumbs button');
  assert.equal(await evaluate(`document.querySelector('#crumbs').hidden`), true);
  assert(await evaluate(`!!document.querySelector('#list [aria-selected="true"]')`), 'the outer return restores the favourite category selection');

  // Leave a slow series fetch, then immediately start typing elsewhere. The
  // response must neither reopen the series nor steal focus from the input.
  await click('#tab-series');
  await evaluate(`(async () => { const { Library } = await import('./js/library.js');
    const seriesEpisodes = Library.prototype.seriesEpisodes;
    Library.prototype.seriesEpisodes = async function (...args) {
      await new Promise(resolve => setTimeout(resolve, 300));
      return seriesEpisodes.apply(this, args);
    };
    document.querySelector('#list').focus();
    document.querySelector('#list .row').click();
    document.querySelector('#crumbs button').click();
    document.querySelector('#search').focus(); })()`);
  await sleep(450);
  await settled();
  assert.equal(await evaluate(`document.querySelector('#detail').hidden`), true, 'a late response cannot reopen a closed series');
  assert.equal(await evaluate('document.activeElement.id'), 'search', 'returning cannot steal focus from a newer interaction');

  await evaluate(`document.querySelector('#search').value = 'not-a-movie';
    document.querySelector('#search').dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#tab-movie').click();`);
  await sleep(250);
  await settled();
  assert.equal(await evaluate(`document.querySelector('#search').value`), '', 'tab navigation cancels a pending search debounce');

  await click('#tab-movie');
  assert.equal(await evaluate(`document.querySelector('#search').value`), '', 'switching tabs clears the previous search');
  await click('#groups .group');
  await evaluate(`document.querySelector('#list').focus()`);
  for (let i = 0; i < 18; i++) await key('ArrowDown');
  await search('moon');
  assert.equal(await evaluate(`document.querySelector('#list').hasAttribute('aria-activedescendant')`), false, 'a smaller result set cannot retain a stale active descendant');
  await evaluate(`document.querySelector('#list').focus()`);
  await key('Enter'); // No selection: must neither throw nor start a stream.
  assert.equal(await evaluate(`document.querySelector('#video').getAttribute('src')`), null);
  await key('ArrowDown');
  assert.equal(await evaluate(`document.querySelector('#list').getAttribute('aria-activedescendant')`), 'row-0');
  assert.equal(await evaluate(`document.querySelector('#row-0').getAttribute('aria-posinset')`), '1');

  await click('#search-clear');
  await evaluate(`const rating = document.querySelector('#media-filters select[name="rating"]');
    rating.value = '8'; rating.dispatchEvent(new Event('change', { bubbles: true }));`);
  await settled();
  assert.equal(await evaluate(`document.querySelector('#active-media-filters').hidden`), false, 'active filters stay visible outside the collapsed form');
  assert.match(await evaluate(`document.querySelector('#active-media-filters').textContent`), /8/);
  await click('#active-media-filters button');
  assert.equal(await evaluate(`document.querySelector('#active-media-filters').hidden`), true, 'a chip removes its filter');

  for (const width of [1280, 720, 480, 320]) {
    await viewport(width);
    const bounds = await evaluate(`({ width: document.querySelector('#listcol').getBoundingClientRect().width,
      stage: getComputedStyle(document.querySelector('.stage')).display,
      page: document.documentElement.scrollWidth })`);
    assert(bounds.page <= width, `no horizontal page overflow at ${width}px`);
    if (width <= 600) {
      assert.equal(bounds.width, width, 'compact browsing uses the full width');
      assert.equal(bounds.stage, 'none', 'an idle player does not consume browsing space');
    }
    await capture(`browse-${width}`);
  }
  await viewport(480);
  await click('#list .row');
  await waitFor(`document.querySelector('#main').classList.contains('compact-watch')`);
  await waitFor(`document.querySelector('#video').currentTime > 0.3`);
  const time = await evaluate(`document.querySelector('#video').currentTime`);
  const source = await evaluate(`document.querySelector('#video').currentSrc`);
  await capture('player-480');
  await click('#compact-browse');
  await sleep(350);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('#listcol')).display`), 'flex');
  assert.equal(await evaluate(`document.querySelector('#video').currentSrc`), source, 'pane switching preserves the stream');
  assert(await evaluate(`document.querySelector('#video').currentTime > ${time} && !document.querySelector('#video').paused`), 'playback continues while browsing');
  await click('#compact-player');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.stage')).display`), 'flex');
  await search('moon');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('#listcol')).display`), 'flex', 'search reveals its results while playback continues');
  await click('#compact-player');
  await click('#tab-live');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('#listcol')).display`), 'flex', 'a tab change reveals the chosen catalogue');
  await click('#btn-guide');
  await waitFor(`document.querySelector('#main').classList.contains('guide')`);
  assert.equal(await evaluate(`document.querySelector('#epg').getBoundingClientRect().width`), 480, 'the compact guide uses the full width');
  await capture('guide-480');
  await click('#epg-close');
  assert.deepEqual(await evaluate('window.uiErrors'), [], 'no uncaught UI errors');
  console.log('PASS: selection, return positions, scoped search, filter chips, responsive panes, uninterrupted playback and guide.');
  console.log(`Screenshots: ${work}`);
} finally {
  page?.close();
  server.close();
  const version = await fetch(`http://127.0.0.1:${process.env.KEPULI_DEV_PORT}/json/version`).then(r => r.json()).catch(() => null);
  if (version) {
    const browser = session(version.webSocketDebuggerUrl);
    try { await browser.call('Browser.close'); } catch { /* Chrome closes its socket with itself. */ }
    browser.close();
  }
}
