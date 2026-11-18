#!/usr/bin/env node
// The iOS app's scenarios, run in this tool's own simulators against the
// mock provider. The counterpart of dev/playcheck.mjs for what only the
// real web view and the real shell can show.
//
//   node ios/simcheck.mjs                 every scenario on kepuli-ios-iphone and kepuli-ios-ipad
//   node ios/simcheck.mjs live rotate     those scenarios
//   KEPULI_IOS_DEVICE=kepuli-ios-ipad     one device instead of both
//   KEPULI_SHOTS_DIR=<directory>          where the pictures go (the temporary directory otherwise;
//                                         never the repository: the cast pictures may show the names
//                                         of the Cast devices on this network)
//   KEPULI_IOS_MOCK_PORT=<port>           the mock's port when 8841 is taken
//
// It starts its own mock (dev/mock/server.mjs, in this process, so a
// scenario switches its faults through process.env), boots each device,
// installs the Debug app (built when stale) and drives it through
// ios/sim.mjs. A scenario launches the app anew, so each can be run alone;
// one that turns the device turns it back. A simulator it booted is shut
// down at the end, one that was running is left running. Exit 1 on any
// failure, on anything not run, and when nothing ran at all. The mock's
// media must have been rendered once (sh dev/mock/media.sh).
//
// What a simulator cannot show is not here: a Cast session, a notification
// on the lock screen, VLC, the Files picker, picture in picture on an
// iPhone, the lock screen's controls, a public http host. Those are the device checklist of ios/RELEASE.md. Nor a
// finger: a press is the page's own click() and a swipe its pointer events.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from '../firefox/build.mjs';
import { simulatorApp } from './build.mjs';
import { boot, booted, evaluate, install, launch, log, native, rotate, shot, shutdown, simctl, udid, wipe } from './sim.mjs';

const MOCK_PORT = Number(process.env.KEPULI_IOS_MOCK_PORT || 8841);
const SHOTS = process.env.KEPULI_SHOTS_DIR || join(tmpdir(), 'kepuli-ios-simcheck');
const PLAYER = 'webkit-extension://kepuli-tv/player.html?ios=1';
const SITE = 'https://bigtimesam.github.io/kepuli-tv/';
// Nothing leaves the app and nothing is asked of the system in a scenario:
// links and saved files are recorded, the notifier is the app's stand-in.
const RECORD = { KEPULI_LINKS: 'record', KEPULI_SAVES: 'record', KEPULI_NOTIFY: 'fake' };
const XTREAM = { type: 'xtream', scheme: 'http', host: '127.0.0.1', port: String(MOCK_PORT), username: 'demo', password: 'demo', name: 'Demo server', id: 'pxt', sourceMode: 'xtream', streamMode: 'auto' };

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const assert = (ok, message) => { if (!ok) throw new Error(message); };

// What every piece of page code starts with. A click made by this code is
// not a tap to WebKit, which is the point of `live`: sound must start
// without one, as the shell allows it. ios/screenshots.mjs walks with the
// same helpers.
export const PAGE = String.raw`
const $ = (id) => document.getElementById(id);
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const until = async (test, ms = 20000) => { const end = Date.now() + ms; for (;;) { const got = await test(); if (got || Date.now() > end) return got || null; await pause(150); } };
const video = $('video');
const connected = () => document.querySelectorAll('#groups .group').length > 1 && $('list-progress').hidden;
const playing = () => video.readyState >= 2 && video.currentTime > 0.3 && !video.paused;
const seen = (node) => Boolean(node) && node.getClientRects().length > 0;
const gone = (node) => getComputedStyle(node).display === 'none';
const fits = () => document.documentElement.scrollWidth <= innerWidth;
const inside = (node) => { const r = node.getBoundingClientRect(); return r.height > 0 && r.top >= -1 && r.left >= -1 && r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1; };
const rows = () => [...document.querySelectorAll('#list .row')];
const title = () => $('now-title').textContent;
const press = (root, text) => until(() => { const nodes = [...document.querySelectorAll(root + ' *')].filter((n) => n.children.length === 0);
  const node = nodes.find((n) => n.textContent.trim() === text) || nodes.find((n) => n.textContent.trim().startsWith(text));
  if (node) node.click(); return Boolean(node); }, 10000);
const openTab = async (name, least = 1) => { document.querySelector('#tabs [data-tab="' + name + '"]').click(); await pause(300); return until(() => rows().length >= least); };
const playChannel = async (index = 0) => { if (!await openTab('live', 2)) return false; rows()[index].click(); return until(playing, 40000); };
`;

/** One device of ios/sim.mjs's, as a scenario sees it. */
function device(name) {
  const short = name.replace('kepuli-ios-', '');
  return {
    name, short,
    /** The body of an async function, run in the page after PAGE. */
    page: (body, timeout = 60000) => evaluate(PAGE + body, { name, timeout }),
    state: () => native('state', { name }),
    native: (text) => native(text, { name }),
    launch: (variables = {}) => launch({ ...RECORD, ...variables }, name),
    turn: (orientation) => rotate(orientation, name),
    shot: (label) => shot(join(SHOTS, `${short}-${label}.png`), name),
    log: (n = 400) => log(n, name),
  };
}

/** The app installed anew, with nothing of an earlier run in it, and launched. */
async function fresh(d) {
  try { wipe(d.name); } catch { /* it was not installed */ }
  await install(d.name);
  const state = await d.launch();
  assert(!state.failure, `the app did not start: ${state.failure}`);
  return state;
}

/** The page loaded again, and connected. */
async function reloaded(d) {
  await d.native('reload');
  await sleep(1500);
  // The first question may land in the page that is going away.
  for (let attempt = 0; ; attempt++) {
    try {
      assert(await d.page(`return until(connected, 40000)`), 'the lists did not load after the page was loaded again');
      return;
    } catch (err) {
      if (attempt === 2) throw err;
      await sleep(1000);
    }
  }
}

/**
 * The app launched and connected to the mock's demo account, at its start
 * page with nothing playing. An app without the account (a scenario run
 * alone after a wipe) is given it as storage, the way dev/playcheck.mjs
 * does; `firstrun` is the scenario that types it.
 */
async function connected(d, variables) {
  const state = await d.launch(variables);
  assert(!state.failure, `the app did not start: ${state.failure}`);
  const account = await d.page(`const { config } = await browser.storage.local.get('config'); return config ? config.host + ':' + config.port + ' ' + (config.sourceMode || 'xtream') : null;`);
  if (account !== `127.0.0.1:${MOCK_PORT} xtream`) {
    await d.page(`await browser.storage.local.set(${JSON.stringify({ config: XTREAM, accounts: [XTREAM], settings: { lang: 'en', epgEnabled: true }, ui: { tab: 'live' } })}); return true;`);
    await sleep(300);
    await reloaded(d);
  }
  assert(await d.page(`if (!await until(connected, 40000)) return false; $('btn-home').click(); await pause(400); return true;`), 'the lists did not load');
  return state;
}

/** Portrait again, whatever a scenario left: the turn outlasts the app. */
async function upright(d) {
  const state = await d.state().catch(() => ({}));
  if (state.orientation === 'landscape') await d.turn('portrait');
}

/* -------------------------------------------------------------- scenarios */

async function bootScenario(d) {
  const state = await fresh(d);
  assert(state.extensionErrors.length === 0 && state.contextErrors.length === 0, `the extension did not load cleanly: ${JSON.stringify([state.extensionErrors, state.contextErrors])}`);
  assert(state.url === PLAYER && state.baseURL === 'webkit-extension://kepuli-tv/', `the page's address is ${state.url} on ${state.baseURL}`);
  const page = await d.page(`let host = null; (await import('./js/host.js')).on('host', (said) => { host = said; }); await until(() => host, 3000);
    return { search: location.search, ios: document.documentElement.classList.contains('ios'), host,
      contains: await browser.permissions.contains({ origins: ['http://example.org/*'] }), manifest: browser.runtime.getManifest() };`);
  assert(page.search === '?ios=1' && page.ios, `the page does not know it is in the app: ${JSON.stringify(page)}`);
  assert((await d.state()).port && page.host && page.host.v === 1 && page.host.idiom === d.idiom, `the port or its greeting: ${JSON.stringify(page.host)}, expected ${d.idiom}`);
  assert(page.contains, 'permissions.contains is false for http://example.org/*: a provider would be asked about');
  const bundled = JSON.parse(readFileSync(join(simulatorApp('Debug'), 'extension', 'manifest.json'), 'utf8'));
  for (const [where, manifest] of [['the bundle', bundled], ['the page', page.manifest]]) {
    assert(!manifest.background && manifest.permissions.includes('nativeMessaging'), `the manifest in ${where} has a background or lacks nativeMessaging: ${JSON.stringify(manifest.background)}`);
  }
  assert(page.host.version === bundled.version, `the app says version ${page.host.version}, its manifest ${bundled.version}`);
  await d.shot('boot');
  // A start that fails says so and offers another try, which starts the
  // player: the screen was the app's name alone, with no way on.
  const stuck = await d.launch({ KEPULI_FAIL: '1' });
  assert(stuck.failure && !stuck.url, `a start made to fail: ${JSON.stringify({ failure: stuck.failure, url: stuck.url })}`);
  await sleep(500);
  await d.shot('boot-failed');
  await d.native('retry');
  let again = null;
  for (const until = Date.now() + 20000; Date.now() < until && again !== PLAYER;) {
    await sleep(500);
    again = await d.page(`await until(() => document.readyState === 'complete', 5000); return location.href.split('#')[0];`).catch(() => null);
  }
  await sleep(800);
  const after = await d.state();
  assert(again === PLAYER && !after.failure && after.port, `after another try the page is ${again}, the failure ${after.failure}, the port ${after.port ? 'connected' : 'not connected'}`);
  return `no extension or context error; location.search ?ios=1; html.ios; host ${page.host.idiom} ${page.host.version} (${page.host.build}); access granted without a question; no background in the manifest; a start that fails says so, and its button starts the player`;
}

async function firstrun(d) {
  await fresh(d);
  const first = await d.page(`await until(() => $('setup').open, 10000); await pause(500);
    return { open: $('setup').open, note: seen($('setup-grant-note')), fits: fits(), inside: inside($('setup')) };`);
  assert(first.open && !first.note && first.fits && first.inside, `the first run: ${JSON.stringify(first)}`);
  // The strips around the web view are dimmed as the dialog's backdrop
  // dims the page: undimmed they framed it in two bright bands.
  const backdrop = await d.page(`return (getComputedStyle($('setup'), '::backdrop').backgroundColor.match(/[\\d.]+/g) || []).map(Number);`);
  const { ground: dimmed, dialog } = await d.state();
  await d.shot('firstrun');
  await d.turn('landscape');
  await d.shot('firstrun-landscape');
  // Lying down an iPhone's WebKit enlarged the text of the wider blocks by
  // itself: one label of six and the note on HTTPS stood at 18 to 20 px.
  const lying = await d.page(`const whole = inside($('setup')), wide = fits();
    // The server's fields, six labels of one kind in three rows.
    document.querySelector('input[name="source"][value="xtream"]').click(); await pause(300);
    const line = (node) => { const range = document.createRange(); range.selectNodeContents(node); return Math.round(range.getClientRects()[0].height * 10) / 10; };
    const size = (node) => parseFloat(getComputedStyle(node).fontSize);
    const labels = [...document.querySelectorAll('#panel-connection label.field > span:first-child')].filter(seen);
    const note = $('connection-security'), field = $('f-host');
    const text = { labels: labels.map((label) => [size(label), line(label)]), note: [size(note), line(note)], field: size(field) };
    $('f-save').scrollIntoView({ block: 'nearest' }); await pause(200);
    return { open: $('setup').open, whole, wide, save: inside($('f-save')), size: [innerWidth, innerHeight], text };`);
  await d.turn('portrait');
  assert(lying.open && lying.whole && lying.wide && lying.save, `the dialog with the device lying down (${lying.size.join(' × ')}): ${JSON.stringify(lying)}`);
  const [[labelSize, labelLine]] = lying.text.labels;
  assert(lying.text.labels.length >= 4 && lying.text.labels.every(([size, line]) => size === labelSize && Math.abs(line - labelLine) <= 1)
    && lying.text.note[0] <= lying.text.field && lying.text.note[1] <= labelLine + 4,
  `lying down the fields' labels and the note are not of one size: ${JSON.stringify(lying.text)}`);
  // The port comes filled in, and is selected when the focus reaches it:
  // the keyboard's Next put the caret after it, and 8841 typed there made
  // "80808841" (seen with real keys; the focus here is a script's).
  const port = await d.page(`document.querySelector('input[name="source"][value="xtream"]').click(); const f = $('f-port');
    $('f-host').focus(); f.focus(); await pause(200); const out = { value: f.value, from: f.selectionStart, to: f.selectionEnd }; f.blur(); return out;`);
  assert(port.value === '8080' && port.from === 0 && port.to === 4, `the port's field, focused: ${JSON.stringify(port)}`);
  // Typed as a viewer's keys arrive: the value, then the field's events.
  const done = await d.page(`const type = (id, value) => { const f = $(id); f.focus(); f.value = value;
      f.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' })); f.dispatchEvent(new Event('change', { bubbles: true })); };
    document.querySelector('input[name="source"][value="xtream"]').click();
    type('f-host', '127.0.0.1'); type('f-port', '${MOCK_PORT}'); type('f-username', 'demo'); type('f-password', 'demo');
    $('f-save').click();
    const ok = await until(connected, 40000);
    const channels = ok && await openTab('live', 2);
    return { ok, open: $('setup').open, error: $('setup-error').textContent, groups: document.querySelectorAll('#groups .group').length, rows: rows().length, channels: Boolean(channels) };`);
  assert(done.ok && !done.open && done.groups > 1 && done.channels, `connecting through the dialog: ${JSON.stringify(done)}`);
  const { ground: plain, dialog: closed } = await d.state();
  // A reminder that falls due under a dialog is the system's to show (Reminders.shows).
  assert(dialog === true && closed === false, `the app took the page's dialog for ${dialog ? 'open' : 'closed'} while it was open and ${closed ? 'open' : 'closed'} after`);
  const mixed = '#' + [1, 3, 5].map((at, n) => Math.round(parseInt(plain.slice(at, at + 2), 16) * (1 - backdrop[3]) + backdrop[n] * backdrop[3]).toString(16).padStart(2, '0')).join('');
  const near = (a, b) => [1, 3, 5].every((at) => Math.abs(parseInt(a.slice(at, at + 2), 16) - parseInt(b.slice(at, at + 2), 16)) <= 1);
  assert(backdrop.length === 4 && backdrop[3] > 0 && dimmed !== plain && near(dimmed, mixed), `the strips under the dialog were ${dimmed}; the page's ground is ${plain} and its backdrop ${backdrop.join(', ')}, which makes ${mixed}`);
  return `the dialog shows without the note on a question, with the strips dimmed to ${dimmed} (${plain} without it), fits upright and at ${lying.size.join(' × ')} with its labels of one size; 127.0.0.1:${MOCK_PORT} typed, ${done.groups} groups and ${done.rows} channels`;
}

async function channels(d) {
  await connected(d);
  const list = await d.page(`if (!await openTab('live', 2)) return null;
    document.querySelector('#groups .group[aria-label="Finland"]').click();
    // The groups are drawn again at a choice: the marked one is asked for anew.
    const opened = await until(() => document.querySelector('#groups .group.active')?.getAttribute('aria-label') === 'Finland' && rows().length > 0 && /Finland/.test(decodeURIComponent(location.hash)));
    await pause(500);
    // A long press selects no word of a row, a button or a heading (it
    // brought up the system's Copy and Look Up over the list); a field's
    // text stays selectable.
    const select = [rows()[0].querySelector('.row-name'), $('btn-guide'), $('search')].map((node) => getComputedStyle(node).webkitUserSelect);
    return { opened: Boolean(opened), rows: rows().length, hash: location.hash, fits: fits(), first: rows()[0] && rows()[0].querySelector('.row-name').textContent, select };`);
  assert(list && list.opened && list.rows > 0 && list.fits, `the group Finland: ${JSON.stringify(list)}`);
  assert(list.select.join() === 'none,none,text', `what a long press may select of a row's name, a button and the search field: ${list.select.join()}`);
  await d.shot('channels');
  await d.turn('landscape');
  const lying = await d.page(`await pause(300); const box = $('list').getBoundingClientRect();
    return { fits: fits(), size: [innerWidth, innerHeight], hash: location.hash,
      rows: rows().filter((r) => { const b = r.getBoundingClientRect(); return b.height && b.bottom > box.top + 8 && b.top < box.bottom - 8; }).length };`);
  await d.shot('channels-landscape');
  await d.turn('portrait');
  assert(lying.fits && lying.rows >= 3 && lying.hash === list.hash, `the list with the device lying down: ${JSON.stringify(lying)}`);
  return `Finland opens with ${list.rows} rows (${list.first} first); lying down (${lying.size.join(' × ')}) ${lying.rows} of them in sight, nothing wider than the window`;
}

async function live(d) {
  await connected(d);
  const first = await d.page(`if (!await playChannel()) return null;
    const from = video.currentTime; await pause(4000);
    const { playback } = await import('./js/playing.js'); const { state } = await import('./js/state.js');
    return { advanced: video.currentTime - from, muted: video.muted, volume: video.volume, engine: playback.engineKey, title: title(), hls: state.playingSpec.hlsUrl || null };`);
  assert(first, 'no channel played');
  assert(first.advanced >= 3 && !first.muted && first.volume > 0, `the channel's picture: ${JSON.stringify({ ...first, hls: undefined })}`);
  const awake = (await d.state()).idleTimerDisabled;
  await d.shot('live');
  await d.page(`video.pause(); await pause(1200); return true;`);
  const asleep = (await d.state()).idleTimerDisabled;
  assert(awake === true && asleep === false, `the idle timer was ${awake ? 'off' : 'on'} while the channel played and ${asleep ? 'off' : 'on'} after the pause`);
  return `${first.title} advanced ${first.advanced.toFixed(1)} s in 4 s with sound and no tap (${first.engine}); the idle timer off while it played, on after the pause`;
}

async function film(d) {
  await connected(d);
  const first = await d.page(`if (!await openTab('movie')) return null;
    await press('#groups', 'Nordic'); await pause(500); await press('#list', 'Northern Lights');
    if (!await until(playing, 40000)) return { played: false };
    const { state } = await import('./js/state.js'); const { playback } = await import('./js/playing.js');
    const address = state.playingSpec.url.split('/').pop(), engine = playback.engineKey;
    video.currentTime = 60;
    // The place is written every five seconds of playing (js/nextepisode.js).
    await until(() => video.currentTime > 68 && !video.paused, 30000);
    video.pause(); await pause(1500);
    return { played: true, address, engine, at: video.currentTime };`);
  assert(first && first.played && /\.mp4$/.test(first.address), `the film: ${JSON.stringify(first)}`);
  // The list's foot: its count is whole (the number alone in the
  // narrowest column), beside marks a finger wide. It read "6…".
  const FOOT = `(() => { const count = document.querySelector('.listinfo-count'), foot = $('listinfo').getBoundingClientRect();
    const marks = [...document.querySelectorAll('#listinfo .view-toggle button')].map((b) => b.getBoundingClientRect());
    return { shown: seen(count), text: count.textContent, cut: count.scrollWidth > count.clientWidth + 1, marks: marks.length, inside: marks.every((m) => m.left >= foot.left && m.right <= foot.right + 1), width: Math.round(foot.width) }; })()`;
  const foot = { upright: await d.page(`$('compact-browse').click(); await pause(300); return ${FOOT};`) };
  await d.turn('landscape');
  foot.lying = await d.page(`await pause(500); return ${FOOT};`);
  await d.shot('film-foot-landscape');
  await d.turn('portrait');
  for (const [how, at] of Object.entries(foot)) assert(!at.shown || (!at.cut && at.marks >= 2 && at.inside), `the films' foot ${how}: ${JSON.stringify(at)}`);
  assert(foot.upright.shown || foot.lying.shown, `the films' foot was in sight neither upright nor lying down: ${JSON.stringify(foot)}`);
  assert(first.at > 68, `the film did not go on from 60 s: it is at ${first.at}`);
  await d.shot('film');
  await d.launch();
  const again = await d.page(`await until(connected, 40000); await pause(2500);
    // Kept per account, under a key that begins with "resume".
    const kept = Object.entries(await browser.storage.local.get(null)).filter(([key]) => key.startsWith('resume')).flatMap(([, points]) => Object.values(points)).map((point) => Math.round(point.position));
    // The start page offers it under Continue watching, with how far it
    // was seen; a window of one pane shows the list instead, and there the
    // film's own row carries the bar.
    let offer = [...document.querySelectorAll('.idle-card')].find((c) => c.textContent.includes('Northern Lights')), where = 'the start page';
    if (!seen(offer)) {
      where = 'its row';
      await openTab('movie'); await press('#groups', 'Nordic'); await pause(700);
      offer = rows().find((r) => r.textContent.includes('Northern Lights'));
    }
    const bar = offer && offer.querySelector('.row-progress.resume i');
    const offered = seen(offer) && seen(bar), share = bar ? parseFloat(bar.style.width) : null;
    if (offer) offer.click();
    const started = await until(playing, 40000); await pause(1000);
    return { kept, where, offered, share, started: Boolean(started), at: video.currentTime };`);
  assert(again.kept.some((position) => position >= 60), `after a launch the resume points are ${JSON.stringify(again.kept)}`);
  assert(again.offered && again.share >= 45 && again.share <= 75, `after a launch ${again.where} ${again.offered ? `offers the film with ${again.share} % seen` : 'does not show the film with a place to go on from'}`);
  assert(again.started && again.at >= 60, `chosen there the film ${again.started ? `started at ${again.at.toFixed(1)} s` : 'did not start'}`);
  await d.shot('film-resumed');
  await d.page(`$('btn-home').click(); return true;`);
  return `${first.address} played (${first.engine}), left at ${first.at.toFixed(0)} s; after a launch ${again.where} offers it with ${again.share} % seen and it goes on from ${again.at.toFixed(0)} s`;
}

async function mkv(d) {
  await connected(d);
  const episode = await d.page(`if (!await openTab('series')) return null;
    await press('#groups', 'Nordic Noir'); await pause(500); await press('#list', 'Silent Fjord');
    if (!await until(() => !$('detail').hidden && rows().length > 0)) return { page: false };
    rows()[0].click();
    if (!await until(playing, 60000)) return { played: false, overlay: $('overlay').hidden ? null : $('overlay').textContent.trim().slice(0, 200) };
    const from = video.currentTime; await pause(3000);
    const { state } = await import('./js/state.js'); const { playback } = await import('./js/playing.js');
    return { played: true, address: state.playingSpec.url.split('/').pop(), engine: playback.engineKey, advanced: video.currentTime - from,
      subtitles: [...$('subs').options].map((o) => o.textContent.trim()), size: [video.videoWidth, video.videoHeight] };`, 120000);
  assert(episode && episode.played, `Silent Fjord's first episode: ${JSON.stringify(episode)}`);
  assert(/\.mkv$/.test(episode.address) && episode.advanced >= 2 && episode.size[0] > 0, `the episode's picture: ${JSON.stringify(episode)}`);
  assert(episode.subtitles.length >= 3, `the episode's subtitle choices: ${episode.subtitles.join(', ')}`);
  await d.shot('mkv');
  // The subtitles' look: its panel opens with no picker in the focus. A
  // picker focused from a press springs its menu open in WebKit here, and
  // the Style list covered the panel at every opening.
  // Where the text stands while the panel is open: clear of the panel
  // where that lies over the picture, and at its own height where it
  // does not (an upright phone: lifted by a desktop's measure the text was
  // pinned to the picture's top, and Height showed nothing).
  const LIFT = `(() => { const pop = $('sublook-pop').getBoundingClientRect(), wrap = $('videowrap').getBoundingClientRect(), sub = document.querySelector('#videowrap .subdisplay').getBoundingClientRect();
    const apart = pop.right <= wrap.left || pop.left >= wrap.right || pop.top >= wrap.bottom || pop.bottom <= wrap.top;
    return { apart, lift: getComputedStyle($('videowrap')).getPropertyValue('--look-lift').trim(), rest: Math.round(wrap.bottom - sub.bottom), popTop: Math.round(pop.top - wrap.top), picture: Math.round(wrap.height),
      clear: apart ? wrap.bottom - sub.bottom <= wrap.height * 0.3 : sub.bottom <= pop.top + 1, whole: inside($('sublook-pop')), size: [innerWidth, innerHeight] }; })()`;
  const look = await d.page(`document.activeElement.blur(); $('btn-sublook').click(); await pause(1200);
    return { shown: seen($('sublook-pop')), focus: document.activeElement.id || document.activeElement.tagName, coarse: matchMedia('(pointer: coarse)').matches, upright: ${LIFT} };`);
  const over = (await d.state()).cast.presented;
  await d.shot('mkv-look');
  await d.turn('landscape');
  look.lying = await d.page(`await pause(800); return ${LIFT};`);
  await d.shot('mkv-look-landscape');
  await d.turn('portrait');
  await d.page(`$('btn-sublook').click(); await pause(300); return true;`);
  assert(look.shown && look.coarse && look.focus !== 'p-substyle' && over === null, `the subtitles' look opened with the focus on ${look.focus} and ${over || 'nothing'} over the player: ${JSON.stringify(look)}`);
  for (const how of ['upright', 'lying']) assert(look[how].clear && look[how].whole && (!look[how].apart || look[how].lift === '0px'), `the text under the look's panel, ${how}: ${JSON.stringify(look[how])}`);
  if (d.idiom === 'phone') assert(look.upright.apart && look.lying.apart, `on a phone the look's panel lies over the picture: ${JSON.stringify(look)}`);
  // The second episode's sound is AC-3, which WebKit does not decode: the
  // player decodes it and encodes it again as AAC (js/transcode.js). The
  // encoder's configuration was written into the file as WebKit reports
  // it, a whole descriptor, and the episode did not play at all. The third
  // has three sound tracks, one of them AC-3, chosen while it plays.
  const PLAYED = `const from = video.currentTime; await pause(3000);
    const { state } = await import('./js/state.js');
    return { played: !video.paused && video.currentTime - from >= 2, advanced: Math.round((video.currentTime - from) * 10) / 10, address: state.playingSpec.url.split('/').pop(),
      codec: state.activeAudio ? state.activeAudio.codec : (state.audioTracks || []).map((track) => track.codec).join(),
      // The picture's element has a sound track of its own, and which encoder made it.
      sound: video.audioTracks ? video.audioTracks.length : null, encoder: await (await import('./js/transcode.js')).encoderSetup().then((setup) => setup && (setup.encoder.wasm ? 'wasm ' : '') + setup.encoder.name, () => null),
      overlay: $('overlay').hidden ? null : $('overlay-title').textContent.trim() };`;
  const next = (index) => d.page(`const before = title(); rows()[${index}].click();
    await until(() => title() !== before && playing(), 60000); await pause(500); ${PLAYED}`, 120000);
  const ac3 = await next(1);
  await d.shot('mkv-ac3');
  assert(ac3.played && /ac-?3/i.test(String(ac3.codec)) && ac3.overlay === null && ac3.sound === 1 && ac3.encoder, `the episode with AC-3 sound: ${JSON.stringify(ac3)}`);
  const multi = await next(2);
  // The row's selectors on a phone: the sound's has the width, the
  // subtitles' is its mark (they read "English (AA" and "Engli").
  const pickers = await d.page(`const box = (id) => Math.round($(id).getBoundingClientRect().width), bar = document.querySelector('.nowbar');
    return { tight: bar.classList.contains('tight'), audio: box('audio'), subs: box('subs'), mode: box('mode'), shown: seen($('audio')) && seen($('subs')), fits: fits(),
      inside: [...document.querySelectorAll('.now-actions > *')].filter(seen).every((node) => { const r = node.getBoundingClientRect(), b = bar.getBoundingClientRect(); return r.left >= b.left - 1 && r.right <= b.right + 1; }) };`);
  await d.shot('mkv-pickers');
  const commentary = await d.page(`const pick = $('audio'), option = [...pick.options].find((o) => /AC-?3/i.test(o.textContent));
    if (!option) return { options: [...pick.options].map((o) => o.textContent) };
    pick.value = option.value; pick.dispatchEvent(new Event('change', { bubbles: true }));
    await pause(1500); await until(playing, 30000); ${PLAYED}`, 120000);
  await d.page(`$('btn-home').click(); return true;`);
  assert(multi.played && multi.overlay === null, `the episode with three sound tracks: ${JSON.stringify(multi)}`);
  assert(pickers.shown && pickers.fits && pickers.inside && (!pickers.tight || pickers.audio >= pickers.subs), `the sound's and the subtitles' selectors on the row: ${JSON.stringify(pickers)}`);
  assert(commentary.played && /ac-?3/i.test(String(commentary.codec)) && commentary.overlay === null, `its AC-3 commentary chosen while it played: ${JSON.stringify(commentary)}`);
  return `${episode.address} played through the unpacking (${episode.engine}), ${episode.advanced.toFixed(1)} s in 3 s; subtitles: ${episode.subtitles.join(', ')}; the look's panel opens with no picker sprung open and the text keeps clear of it (${look.upright.apart ? 'under the picture' : 'over it'} upright, ${look.lying.apart ? 'beside it' : 'over it'} lying down); ${ac3.address} with AC-3 sound played ${ac3.advanced} s in 3 s with a sound track encoded anew (${ac3.encoder}), and ${multi.address} went on through a change to its AC-3 commentary`;
}

async function guide(d) {
  await connected(d);
  const grid = await d.page(`if (!await openTab('live', 2)) return null;
    $('btn-guide').click();
    if (!await until(() => $('main').classList.contains('guide') && document.querySelectorAll('.epg-prog').length > 0)) return { open: false };
    await pause(500);
    const { t } = await import('./js/i18n.js');
    // An upcoming programme's own page: where a browser offers to record it.
    const ahead = [...document.querySelectorAll('.epg-prog[data-start]')].find((n) => Number(n.dataset.start) > Date.now() + 5 * 60000);
    if (ahead) ahead.click();
    await until(() => document.querySelectorAll('#epgv-actions button').length > 0, 5000);
    const actions = [...document.querySelectorAll('#epgv-actions button')].filter(seen).map((b) => b.textContent.trim());
    const words = [t('rec.start'), t('rec.title')];
    const recording = [...document.querySelectorAll('button, [role="menuitem"], a')].filter((n) => seen(n) && words.some((w) => n.textContent.trim().startsWith(w))).map((n) => n.id || n.textContent.trim());
    return { open: true, programmes: document.querySelectorAll('.epg-prog').length, actions, remind: t('guide.remind'), recording,
      buttons: [seen($('btn-record')), seen($('btn-recordings-menu'))], canRecord: (await import('./js/recordingsui.js')).canRecord, fits: fits() };`);
  assert(grid && grid.open && grid.programmes > 0 && grid.fits, `the guide: ${JSON.stringify(grid)}`);
  assert(grid.canRecord === false && grid.recording.length === 0 && !grid.buttons[0] && !grid.buttons[1], `something of recording is offered: ${JSON.stringify(grid)}`);
  assert(grid.actions.includes(grid.remind), `an upcoming programme offers ${grid.actions.join(', ') || 'nothing'}`);
  await d.shot('guide');
  await d.turn('landscape');
  const lying = await d.page(`await pause(800);
    // The day in view, whole in its strip and clear of the strip's arrows.
    const strip = $('epg-days'), day = strip.querySelector('.epg-day.active'), box = strip.getBoundingClientRect(), at = day && day.getBoundingClientRect();
    const arrows = [...strip.parentElement.querySelectorAll(':scope > .side-scroll-arrow')].filter((a) => !a.hidden).map((a) => a.getBoundingClientRect());
    const today = Boolean(at) && at.left >= box.left - 1 && at.right <= box.right + 1 && arrows.every((a) => at.right <= a.left + 1 || at.left >= a.right - 1);
    return { fits: fits(), size: [innerWidth, innerHeight], open: $('main').classList.contains('guide'), today, scrolls: strip.scrollWidth > strip.clientWidth + 1,
    programmes: [...document.querySelectorAll('.epg-prog')].filter((n) => { const r = n.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth; }).length };`);
  await d.shot('guide-landscape');
  await d.turn('portrait');
  assert(lying.open && lying.fits && lying.programmes > 0, `the guide with the device lying down: ${JSON.stringify(lying)}`);
  assert(lying.today, `lying down the guide's day in view is cut by its strip or lies under the strip's arrow: ${JSON.stringify(lying)}`);
  // With a channel playing, the picture stands in the guide's corner and
  // the programme's panel over it: the picture is no wider than its column
  // (an upright iPad's was cut by the window's edge), the programme's time
  // and title are in sight in the panel (a phone lying down showed the
  // channel and the buttons, and cut the title), and no arrow of the days'
  // strip lies over a day ("Earlier" read "lier").
  const CORNER = `(() => { const box = (node) => node.getBoundingClientRect(), wrap = $('videowrap'), panel = $('epg-preview'), slot = $('epgv-slot'), strip = $('epg-days');
    const w = box(wrap), p = box(panel), s = box(slot);
    // The arrow back lies over the strip's start: shown for a scroll
    // shorter than itself, it hid more than it led back to.
    const back = strip.parentElement.querySelector(':scope > .side-scroll-arrow.prev');
    const covered = seen(strip) && !back.hidden && strip.scrollLeft <= box(back).width ? [Math.round(strip.scrollLeft), Math.round(box(back).width)] : [];
    return { size: [innerWidth, innerHeight], fits: fits(), picture: seen(wrap) ? [Math.round(w.left), Math.round(w.right), Math.round(w.width), Math.round(w.height)] : null,
      whole: !seen(wrap) || (w.left >= -1 && w.right <= innerWidth + 1), slot: slot.textContent.trim().slice(0, 40),
      titled: !seen(panel) || (seen(slot) && s.top >= p.top - 1 && s.bottom <= Math.min(p.bottom, seen(wrap) && w.top > p.top ? w.top : p.bottom) + 1), covered }; })()`;
  const corner = { upright: await d.page(`$('epg-close').click(); await pause(300);
    if (!await playChannel()) return null;
    $('btn-guide').click();
    if (!await until(() => $('main').classList.contains('guide') && document.querySelectorAll('.epg-prog').length > 0)) return null;
    await pause(600);
    const ahead = [...document.querySelectorAll('.epg-prog[data-start]')].find((n) => Number(n.dataset.start) > Date.now() + 5 * 60000);
    if (ahead) ahead.click();
    await until(() => document.querySelectorAll('#epgv-actions button').length > 0, 5000); await pause(600);
    return ${CORNER};`) };
  assert(corner.upright, 'no channel played with the guide open');
  await d.shot('guide-playing');
  await d.turn('landscape');
  corner.lying = await d.page(`await pause(800); return ${CORNER};`);
  await d.shot('guide-playing-landscape');
  await d.turn('portrait');
  for (const [how, at] of Object.entries(corner)) {
    assert(at.fits && at.whole && at.titled && at.slot && at.covered.length === 0, `the guide over a playing channel, ${how} (${at.size.join(' × ')}): ${JSON.stringify(at)}`);
  }
  await d.page(`$('epg-close').click(); await pause(200); $('btn-home').click(); return true;`);
  return `${grid.programmes} programmes in the grid; an upcoming one offers ${grid.actions.join(', ')} and nothing of recording; lying down (${lying.size.join(' × ')}) ${lying.programmes} in sight; over a playing channel the corner picture keeps to its column and the programme's time and title are in sight, upright and lying down`;
}

async function settings(d) {
  // The switch follows the system's leave: given here, refused below.
  await connected(d, { KEPULI_NOTIFY: 'fake-granted' });
  const version = JSON.parse(readFileSync(join(simulatorApp('Debug'), 'extension', 'manifest.json'), 'utf8')).version;
  const shown = await d.page(`const h = await import('./js/host.js');
    $('btn-settings').click(); await until(() => $('setup').open); await pause(500);
    document.querySelector('#setup-tabs [data-panel="general"]').click(); await pause(300);
    const granted = $('f-notify').checked, inSight = seen($('f-notify'));
    $('f-notify').click(); await pause(600);
    const off = await h.request('notify.get');
    $('f-notify').click(); await pause(600);
    const on = await h.request('notify.get');
    const out = { granted, inSight, off, on, sync: gone($('sync-box')), record: gone(document.querySelector('#setup [aria-labelledby="group-record"]')),
      screen: $('btn-screen').hidden && !seen($('btn-screen')), fits: fits(), inside: inside($('setup')) };
    return out;`);
  assert(shown.inSight && shown.granted && shown.off.on === false && shown.on.on === true && shown.on.system === 'granted', `the notifications switch with the leave given: ${JSON.stringify(shown)}`);
  assert(shown.sync && shown.record && shown.screen, `sync, recording or the full-screen button is offered: ${JSON.stringify(shown)}`);
  assert(shown.fits && shown.inside, 'Settings does not fit the window');
  await d.shot('settings');
  await d.turn('landscape');
  await d.shot('settings-landscape');
  const lying = await d.page(`const whole = inside($('setup')), wide = fits();
    $('f-save').scrollIntoView({ block: 'nearest' }); await pause(200);
    return { whole, wide, save: inside($('f-save')), size: [innerWidth, innerHeight] };`);
  // The subtitles' section, opened lying down: its preview is a picture to
  // judge the text by (a phone's was 64 × 36 px there), and turned upright
  // with Settings open the sections are measured again (they kept the
  // height measured lying down).
  const PREVIEW = `const frame = document.querySelector('#panel-subs .sublook-preview').getBoundingClientRect();
    return { preview: [Math.round(frame.width), Math.round(frame.height)], panel: Math.round($('panel-subs').getBoundingClientRect().height), window: [innerWidth, innerHeight], whole: inside($('setup')) };`;
  const low = await d.page(`document.querySelector('#setup-tabs [data-panel="subs"]').click(); await pause(500); ${PREVIEW}`);
  await d.shot('settings-subs-landscape');
  await d.turn('portrait');
  const tall = await d.page(`await pause(600); ${PREVIEW}`);
  await d.shot('settings-subs-turned');
  assert(lying.whole && lying.wide && lying.save, `Settings with the device lying down: ${JSON.stringify(lying)}`);
  assert(low.preview[1] >= 120 && low.preview[0] >= 200, `the subtitles' preview with the device lying down: ${JSON.stringify(low)}`);
  // Upright the section has the room its preview wants, or the window's share.
  assert(tall.whole && tall.preview[0] >= Math.min(280, tall.window[0] - 80) && tall.panel >= Math.min(400, low.panel + 60), `Settings turned upright while open: ${JSON.stringify(tall)} (lying down ${JSON.stringify(low)})`);
  const help = await d.page(`$('setup').close(); $('btn-help').click(); await until(() => $('help').open); await pause(300);
    const { t } = await import('./js/i18n.js');
    const links = [...document.querySelectorAll('#help a')].filter((a) => !gone(a)).map((a) => a.href);
    const fold = document.querySelector('#help details');
    const touch = [...document.querySelectorAll('#help .help-touch li')].filter(seen).length;
    const keys = { heading: gone(document.querySelector('#help h3')) && gone($('help-keys')), named: fold.querySelector('.section-label').textContent === t('help.shortcuts'), open: fold.open, hovers: matchMedia('(any-hover: hover)').matches };
    const foot = $('app-version'); foot.scrollIntoView({ block: 'nearest' }); await pause(200);
    return { links, touch, keys, button: $('btn-help').title === t('btn.help'), version: foot.textContent, inside: inside(foot), back: gone(document.querySelector('#help [data-i18n="help.back"]')) };`);
  assert(help.version.includes(version), `the help says "${help.version}", the manifest ${version}`);
  // What a finger does comes first; the keys wait behind their fold,
  // closed where nothing hovers (an iPhone, an iPad without a trackpad).
  assert(help.touch === 3 && help.keys.heading && help.keys.named && help.keys.open === help.keys.hovers && help.button && (d.idiom !== 'phone' || (!help.keys.open && help.inside)),
    `the help in the app: ${JSON.stringify({ touch: help.touch, keys: help.keys, button: help.button, foot: help.inside })}`);
  assert(help.links[0] === `${SITE}iptv-app-iphone-ipad/` && help.links.includes(`${SITE}privacy/`) && help.links.includes(`${SITE}licences/`) && help.back, `the help's links: ${help.links.join(', ')}`);
  await d.shot('settings-help');
  // Refused by the system: the switch is off, and turned on it says where.
  await connected(d, { KEPULI_NOTIFY: 'fake-denied' });
  // Said under the switch, where it can be read: as a message in the
  // page's strip it was drawn behind the dialog, and the switch fell back
  // with no word.
  const refused = await d.page(`const { t } = await import('./js/i18n.js');
    $('btn-settings').click(); await until(() => $('setup').open); await pause(500);
    document.querySelector('#setup-tabs [data-panel="general"]').click(); await pause(300);
    const hint = $('notify-hint'), quiet = !seen(hint);
    const before = $('f-notify').checked;
    $('f-notify').click(); await pause(800);
    hint.scrollIntoView({ block: 'nearest' }); await pause(200);
    const box = hint.getBoundingClientRect(), at = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return { before, quiet, after: $('f-notify').checked, said: hint.textContent, read: seen(hint) && box.height > 0 && inside(hint) && hint.contains(at), strip: seen($('toast')), expected: t('setup.notify.denied') };`);
  await d.shot('settings-refused');
  await d.page(`$('setup').close(); return true;`);
  assert(refused.before === false && refused.after === false && refused.quiet && refused.said === refused.expected && refused.read && !refused.strip, `the switch with the leave refused: ${JSON.stringify(refused)}`);
  // The page's own theme is the system's for what the system draws (the
  // keyboard, Google's Cast dialogs): Dark in the app on a device in light
  // mode had a light keyboard. Automatic leaves the device its say.
  const themes = [];
  for (const theme of ['dark', 'light', 'system']) {
    const page = await d.page(`(await import('./js/theme.js')).renderTheme('${theme}'); await pause(700);
      return { dark: matchMedia('(prefers-color-scheme: dark)').matches, shown: document.documentElement.dataset.theme };`);
    themes.push({ theme, ...page, window: (await d.state()).interfaceStyle });
  }
  await d.page(`const { state } = await import('./js/state.js'); (await import('./js/theme.js')).renderTheme(state.settings.theme); return true;`);
  assert(themes.map((at) => at.window).join() === 'dark,light,system' && themes[0].dark && themes[0].shown === 'dark' && !themes[1].dark && themes[1].shown === 'light',
    `the window's appearance under the page's theme: ${JSON.stringify(themes)}`);
  return `the help says ${help.version}, what a finger does and the keys behind their fold, and links to the app's guide, the privacy policy and the licences; no sync, recording or full-screen button; the switch is on with the leave given, turns the app's off and on, and with the leave refused stays off and says under itself "${refused.said}"; the window takes the page's dark and light theme and none for Automatic; Settings fits upright and at ${lying.size.join(' × ')}`;
}

async function persist(d) {
  await connected(d);
  const stamp = `simcheck ${Date.now()}`;
  const wrote = await d.page(`await browser.storage.local.set({ simcheck: ${JSON.stringify(stamp)} });
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle('simcheck.txt', { create: true });
    const out = await handle.createWritable(); await out.write(${JSON.stringify(stamp)}); await out.close();
    return true;`);
  const state = await d.launch();
  assert(!state.failure, `the app did not start again: ${state.failure}`);
  const kept = await d.page(`const ok = await until(connected, 40000);
    const { simcheck, config } = await browser.storage.local.get(['simcheck', 'config']);
    const root = await navigator.storage.getDirectory();
    let file = null;
    try { file = await (await (await root.getFileHandle('simcheck.txt')).getFile()).text(); } catch (err) { file = { missing: String(err) }; }
    await root.removeEntry('simcheck.txt').catch(() => {});
    await browser.storage.local.remove('simcheck');
    return { ok: Boolean(ok), simcheck, account: config && config.host + ':' + config.port, file };`);
  assert(kept.ok && kept.account === `127.0.0.1:${MOCK_PORT}`, `after a launch the account is ${kept.account}, the lists ${kept.ok ? 'loaded' : 'did not load'}`);
  assert(kept.simcheck === stamp, `the stored value came back as ${JSON.stringify(kept.simcheck)}`);
  assert(wrote && kept.file === stamp, `the file in the origin's private file system came back as ${JSON.stringify(kept.file)}`);
  return `after terminate and launch: the account connects, the storage.local value is there, the file in the origin's private file system has its text`;
}

/**
 * Full screen asked of the app by the page (`how` is page code: the button,
 * the key's function, a swipe), and what the app and the page then say.
 */
async function screen(d, enter, how) {
  await d.page(`${how}; return true;`);
  let state = {}, page = {};
  for (const until = Date.now() + 8000; Date.now() < until;) {
    state = await d.state();
    page = await d.page(`return { full: $('videowrap').classList.contains('full') };`);
    if (state.fullscreen === (enter ? 'yes' : 'no') && page.full === enter) break;
    await sleep(200);
  }
  assert(state.fullscreen === (enter ? 'yes' : 'no') && page.full === enter, `${enter ? 'entering' : 'leaving'} full screen: the app says "${state.fullscreen}", the picture is ${page.full ? 'over the window' : 'in its place'}`);
  await sleep(600);
}

async function fullscreen(d) {
  await connected(d);
  assert(await d.page(`return Boolean(await playChannel());`), 'no channel played');
  const look = () => d.page(`const wrap = $('videowrap').getBoundingClientRect(), button = $('btn-full'), { t } = await import('./js/i18n.js');
    const shape = video.videoWidth / video.videoHeight, picture = Math.min(wrap.width, wrap.height * shape);
    return { size: [innerWidth, innerHeight], t: video.currentTime, paused: video.paused, full: $('videowrap').classList.contains('full'), fits: fits(),
      box: [wrap.left, wrap.top, wrap.right, wrap.bottom].map(Math.round), shape, picture: [Math.round(picture), Math.round(picture / shape)],
      label: button.title === t('screen.leave') ? 'leave' : button.title === t('screen.enter') ? 'enter' : button.title, button: seen(button),
      scrolls: [$('list'), $('infostrip')].map((box) => getComputedStyle(box).overflowY).join(),
      browser: [Boolean(document.fullscreenEnabled), Boolean(document.fullscreenElement), video.webkitPresentationMode] };`);
  const seenSizes = [];
  const held = async (orientation, full, what) => {
    const state = await d.state();
    const page = await look();
    const wide = page.size[0] > page.size[1];
    assert(state.orientation === orientation && wide === (orientation === 'landscape'), `${what}: the app is held ${state.orientation}, the page is ${page.size.join(' × ')}`);
    assert(page.full === full && !page.paused && page.fits && page.button && page.label === (full ? 'leave' : 'enter'), `${what}: ${JSON.stringify(page)}`);
    // Under the picture nothing scrolls: an iPhone drew the details'
    // scroll mark over the black beside it. Back in its place, they do.
    assert(page.scrolls === (full ? 'hidden,hidden' : 'auto,auto'), `${what}: the list and the details under the picture are ${page.scrolls}`);
    // WebKit's own full screen for an element, with its banner, is never used.
    assert(state.webkitFullscreen === 'no' && page.browser.join() === 'false,false,inline', `${what}: WebKit's own full screen is ${state.webkitFullscreen}, the page's ${page.browser.join()}`);
    const { view, safeArea: unsafe } = state;
    if (full) {
      // The whole screen without the system's bars, and the picture's box
      // clear of the strips that are not safe; the home indicator's is
      // given up when the picture has use for the height.
      assert(state.fullscreen === 'yes' && state.statusBarHidden && page.size.join() === [view.width, view.height].join() && state.webView.height === view.height,
        `${what}: the page is ${page.size.join(' × ')} on a screen of ${view.width} × ${view.height}, the status bar ${state.statusBarHidden ? 'hidden' : 'showing'}`);
      const needs = (view.width - unsafe.left - unsafe.right) / page.shape >= view.height - unsafe.top;
      const box = [unsafe.left, unsafe.top, view.width - unsafe.right, view.height - (needs ? 0 : unsafe.bottom)].map(Math.round);
      assert(page.box.join() === box.join(), `${what}: the picture's box is ${page.box.join()}, the screen's safe part ${box.join()}${needs ? ' with the home indicator\'s strip' : ''}`);
      if (needs) assert(page.picture[1] === view.height, `${what}: the picture is ${page.picture.join(' × ')} on a screen ${view.height} high`);
      else assert(page.picture[0] === view.width - unsafe.left - unsafe.right, `${what}: the picture is ${page.picture.join(' × ')} on a screen ${view.width} wide`);
    } else {
      // An iPhone lying down has no status bar at any time.
      const bar = !state.statusBarHidden || (d.idiom === 'phone' && orientation === 'landscape');
      assert(state.fullscreen === 'no' && bar && page.size[1] === view.height - unsafe.top - unsafe.bottom && page.size[0] === view.width - unsafe.left - unsafe.right,
        `${what}: the page is ${page.size.join(' × ')} in a view of ${view.width} × ${view.height}, the status bar ${state.statusBarHidden ? 'hidden' : 'showing'}`);
    }
    seenSizes.push(`${what} ${page.size.join(' × ')}${full ? `, picture ${page.picture.join(' × ')}` : ''}`);
    return page;
  };
  // A finger's swipe down over the picture, as the page hears it.
  const swipe = `const at = (y) => ({ bubbles: true, pointerType: 'touch', pointerId: 9, clientX: innerWidth / 2, clientY: y });
    video.dispatchEvent(new PointerEvent('pointerdown', at(80)));
    for (const y of [110, 150, 200]) video.dispatchEvent(new PointerEvent('pointermove', at(y)))`;
  const start = await held('portrait', false, 'upright');
  // Entered upright by the button over the picture: nothing turns the
  // picture, the device's own turn does.
  await screen(d, true, `$('btn-full').click()`);
  await held('portrait', true, 'full screen upright');
  await d.shot('fullscreen-portrait');
  await d.turn('landscape');
  await sleep(800);
  await held('landscape', true, 'full screen turned');
  await d.shot('fullscreen-landscape');
  // The controls on show, as after a tap: where they stand on the screen.
  await d.page(`video.pause(); await pause(700); return true;`);
  await d.shot('fullscreen-landscape-controls');
  await d.page(`await video.play(); return true;`);
  await screen(d, false, swipe);
  await held('landscape', false, 'left lying down');
  await screen(d, true, `(await import('./js/playercontrols.js')).toggleFullscreen()`);
  await held('landscape', true, 'full screen lying down');
  await d.turn('portrait');
  await sleep(800);
  await held('portrait', true, 'full screen turned upright');
  await d.page(`video.pause(); await pause(700); return true;`);
  await d.shot('fullscreen-portrait-controls');
  await d.page(`await video.play(); return true;`);
  await screen(d, false, `$('btn-full').click()`);
  const end = await held('portrait', false, 'left upright');
  assert(end.t > start.t + 8, `the channel went from ${start.t.toFixed(1)} to ${end.t.toFixed(1)} s through it all`);
  // A page loaded again while the picture has the screen finds the bars back.
  await screen(d, true, `$('btn-full').click()`);
  await reloaded(d);
  const after = await d.state();
  assert(after.fullscreen === 'no' && !after.statusBarHidden && after.webView.height === after.view.height - after.safeArea.top - after.safeArea.bottom,
    `after the page was loaded again in full screen the app says "${after.fullscreen}", the status bar ${after.statusBarHidden ? 'hidden' : 'showing'}`);
  await d.page(`$('btn-home').click(); return true;`);
  return `the app's own full screen entered by the button and left by a swipe down lying down, entered there and left by the button upright, turned inside it both ways, nothing forced, never WebKit's own, the channel playing throughout (${(end.t - start.t).toFixed(0)} s), the bars back after a reload; ${seenSizes.join(', ')}`;
}

async function split(d) {
  await connected(d);
  assert(await d.page(`return Boolean(await playChannel());`), 'no channel played');
  // One pane: the list and the picture are not both in sight; the viewer
  // moves between them. Columns: both, side by side.
  const look = () => d.page(`await pause(500); const list = $('list').getBoundingClientRect(), picture = $('videowrap').getBoundingClientRect();
    return { width: innerWidth, narrow: matchMedia('(max-width: 600px)').matches, list: seen($('list')) && list.width > 0, picture: seen($('videowrap')) && picture.width > 0,
      beside: list.width > 0 && picture.width > 0 && (list.right <= picture.left + 1 || picture.right <= list.left + 1), fits: fits(), playing: playing() };`);
  const seenWidths = [];
  try {
    for (const width of [320, 507]) {
      await d.native(`width ${width}`);
      const pane = await look();
      assert(pane.width === width && pane.narrow && !(pane.list && pane.picture) && pane.fits && pane.playing, `at ${width} points: ${JSON.stringify(pane)}`);
      if (width === 320) await d.shot('split-320');
      seenWidths.push(`${width}: one pane (${pane.picture ? 'the picture' : 'the list'})`);
    }
  } finally {
    await d.native('width full');
  }
  const whole = await look();
  assert(!whole.narrow && whole.list && whole.picture && whole.beside && whole.fits && whole.playing, `at the full width: ${JSON.stringify(whole)}`);
  await d.page(`$('btn-home').click(); return true;`);
  return `${seenWidths.join('; ')}; ${whole.width}: the list and the picture side by side; the channel played on`;
}

async function rotateScenario(d) {
  await connected(d);
  assert(await d.page(`if (!await playChannel(2)) return false;
    window.__restarts = 0; for (const type of ['emptied', 'loadstart']) video.addEventListener(type, () => window.__restarts++);
    return true;`), 'no channel played');
  // The measures of iosappTurned in dev/playcheck.mjs, in the real web view.
  const look = () => d.page(`await pause(1200); const box = (node) => node.getBoundingClientRect();
    const list = box($('list')), wrap = box($('videowrap')), bar = box(document.querySelector('.nowbar')), row = document.querySelector('#list .row.playing'), at = row && box(row);
    return { size: [innerWidth, innerHeight], fits: fits(), t: video.currentTime, paused: video.paused, restarts: window.__restarts, title: title(), route: location.hash,
      name: row ? row.querySelector('.row-name').title || row.querySelector('.row-name').textContent : null,
      columns: !matchMedia('(max-width: 600px)').matches,
      rows: rows().filter((r) => { const b = box(r); return b.height && b.bottom > list.top + 8 && b.top < list.bottom - 8; }).length,
      marked: Boolean(at) && at.height > 0 && at.bottom > list.top && at.top < list.bottom,
      picture: [Math.round(wrap.width), Math.round(wrap.height)], whole: wrap.width > 0 && wrap.top >= 0 && wrap.left >= 0 && wrap.right <= innerWidth + 1 && wrap.bottom <= bar.top + 1 && bar.bottom <= innerHeight + 1 };`);
  const held = [];
  const check = (now, before, what) => {
    assert(now.fits, `${what} (${now.size.join(' × ')}): the page is wider than the window`);
    assert(!now.paused && now.restarts === 0 && (!before || now.t > before.t + 1), `${what}: the stream ${now.restarts ? `started again ${now.restarts} time(s)` : now.paused ? 'is paused' : `stands at ${now.t.toFixed(1)} s (${before && before.t.toFixed(1)} s before)`}`);
    assert(now.title === (before || now).title && now.name === now.title && now.route === (before || now).route, `${what}: playing ${now.title}, marked ${now.name}, at ${now.route}`);
    assert(now.whole && Math.abs(now.picture[0] / now.picture[1] - 16 / 9) < 0.35, `${what}: the picture's box is ${now.picture.join(' × ')}, ${now.whole ? 'whole' : 'cut, or its bar out of sight'}`);
    // With the list beside the picture, the list keeps its place.
    if (now.columns) assert(now.rows >= 3 && now.marked, `${what}: ${now.rows} row(s) of the list in sight, the playing one ${now.marked ? 'among them' : 'not'}`);
    held.push(`${what} ${now.size.join(' × ')}, picture ${now.picture.join(' × ')}${now.columns ? `, ${now.rows} rows` : ''}`);
  };
  const first = await look();
  check(first, null, 'upright');
  await d.shot('rotate-portrait');
  await d.turn('landscape');
  const lying = await look();
  await d.shot('rotate-landscape');
  await d.turn('portrait');
  check(lying, first, 'lying down');
  assert(lying.size[0] > lying.size[1], `turned, the page is ${lying.size.join(' × ')}`);
  const again = await look();
  check(again, lying, 'upright again');
  assert(again.size.join() === first.size.join(), `upright again the page is ${again.size.join(' × ')}, it was ${first.size.join(' × ')}`);
  await d.page(`$('btn-home').click(); return true;`);
  return `${first.title} played on through both turns without a new start (${(again.t - first.t).toFixed(0)} s), the same channel marked; ${held.join('; ')}`;
}

async function cast(d) {
  let state = await connected(d);
  // Only a viewer's OK on Google's note sets this, by hand in a simulator;
  // from then on the SDK starts with the app, which is another course.
  if (state.cast.used) {
    await fresh(d);
    state = await connected(d);
  }
  assert(state.cast.sdk && state.cast.started === false && state.cast.discovery === false && state.cast.devices === -1,
    `before the first cast the SDK is awake or scanning: ${JSON.stringify(state.cast)}`);
  const marks = { address: 'simcheckaddress', title: 'Simchecktitle', subtitle: 'Simchecksubtitle' };
  const page = await d.page(`const h = await import('./js/host.js');
    let said = null; h.on('cast.state', (s) => { said = s; });
    await until(() => said, 3000);
    if (!await playChannel()) return { played: false };
    $('btn-more').click(); await pause(300);
    const item = seen($('btn-cast')) && !$('btn-cast').hidden, top = seen($('btn-cast-top'));
    $('btn-more').click();
    const load = await h.request('cast.load', { url: 'https://example.org/${marks.address}.mp4?username=demo&password=demo', contentType: 'video/mp4', live: false, startAt: 0,
      title: '${marks.title}', subtitle: '${marks.subtitle}' }).then(() => 'accepted', (err) => err.message);
    h.send('cast.stop'); h.send('cast.controls');
    return { played: true, said, item, top, load };`);
  assert(page.played, 'no channel played');
  assert(page.said && page.said.state === 'disconnected' && page.said.devices === -1 && page.said.device === null, `cast.state as the page heard it: ${JSON.stringify(page.said)}`);
  assert(page.item && !page.top, `with no device known the menu ${page.item ? 'has' : 'lacks'} Cast and the bar ${page.top ? 'has' : 'lacks'} the mark`);
  assert(page.load === 'no-session', `cast.load without a session was answered "${page.load}"`);
  await d.page(`(await import('./js/host.js')).send('cast.prompt'); return true;`);
  // The button is pressed a second after the SDK's start (CastService.swift).
  let presented = null;
  for (const until = Date.now() + 8000; Date.now() < until && !presented;) {
    await sleep(500);
    presented = (await d.state()).cast.presented;
  }
  await sleep(700);
  // Scratch only: a later picture of the device list names real devices.
  await d.shot('cast-prompt');
  state = await d.state();
  assert(state.cast.started && /^GCKUI/.test(String(presented)), `after cast.prompt the SDK ${state.cast.started ? 'started' : 'did not start'} and what is on the screen is ${presented}`);
  assert(presented === 'GCKUIInformationAlertViewController' && state.cast.discovery === false, `at the first cast Google's note comes before any search: ${presented}, discovery ${state.cast.discovery}`);
  const text = d.log(2000);
  const leaked = Object.values(marks).filter((mark) => text.toLowerCase().includes(mark.toLowerCase()));
  assert(leaked.length === 0 && !/username=|password=/.test(text) && /cast\.load/.test(text), `the debug log ${leaked.length ? `holds ${leaked.join(', ')}` : 'holds credentials or no cast.load'}`);
  // The note has no button a script can press; a launch takes it away.
  await d.launch();
  return `the menu has Cast, the bar has no mark yet; cast.state arrived disconnected with devices -1; cast.load answered no-session; cast.prompt started the SDK ${state.cast.sdk} and put ${presented} on the screen with no search begun; the log names the message's type and none of its address, title or subtitle`;
}

async function links(d) {
  const state = await connected(d);
  assert(state.links.length === 0, `links recorded before any was pressed: ${state.links.length}`);
  // WebKit drops a click on a target=_blank link that follows a wait: each
  // is the first thing its piece of code does.
  await d.page(`document.querySelector('#help a.setup-help:not(.ios-only)').click(); window.__simcheck = 1; return true;`);
  await d.page(`document.querySelector('#help a.ios-only[href$="/privacy/"]').click(); return true;`);
  assert(await d.page(`return Boolean(await playChannel());`), 'no channel played');
  await d.page(`(await import('./js/externalui.js')).playExternal(); return true;`);
  await sleep(1000);
  const recorded = (await d.state()).links;
  const stayed = await d.page(`return { mark: window.__simcheck === 1, address: location.href.split('#')[0] };`);
  assert(recorded[0] === `${SITE}iptv-app-iphone-ipad/` && recorded[1] === `${SITE}privacy/`, `the help's links reached the app as ${JSON.stringify(recorded.slice(0, 2))}`);
  assert(/^vlc-x-callback:\/\/x-callback-url\/stream\?url=http%3A%2F%2F127\.0\.0\.1/.test(recorded[2] || ''), `VLC's address reached the app as ${String(recorded[2]).slice(0, 60)}`);
  assert(stayed.mark && stayed.address === PLAYER && (await d.state()).url.split('#')[0] === PLAYER, `the page went elsewhere: ${stayed.address}`);
  // VLC is never there in a simulator, so the page's own timer must now
  // offer its App Store page (js/external.js).
  await sleep(3500);
  const after = (await d.state()).links;
  await d.page(`$('btn-home').click(); return true;`);
  assert(after.some((address) => address.startsWith('https://apps.apple.com/')),
    `the app's guide, the privacy policy and VLC's address reached the app and the page stayed, but with no VLC to take it the App Store page was never asked for: 4.5 s later the app had been handed ${after.length} addresses, the last still VLC's`);
  return `the app's guide, the privacy policy and VLC's address reached the app in that order, then VLC's App Store page; the page stayed where it was`;
}

async function save(d) {
  const state = await connected(d);
  assert(state.saves.length === 0, `files recorded before any was saved: ${state.saves.length}`);
  // The page has nothing of its own that saves a file in the app (the
  // playlist for VLC and recordings are both replaced or off there), so the
  // scenario saves one the way the page would: a Blob behind <a download>.
  await d.page(`const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([JSON.stringify({ simcheck: true })], { type: 'application/json' }));
    link.download = 'kepuli-tv-simcheck.json'; document.body.append(link); link.click(); link.remove(); window.__simcheck = 2; return true;`);
  let saves = [];
  for (const until = Date.now() + 8000; Date.now() < until && !saves.length;) {
    await sleep(400);
    saves = (await d.state()).saves;
  }
  const stayed = await d.page(`return window.__simcheck === 2 && location.href.split('#')[0] === '${PLAYER}';`);
  assert(saves.length === 1 && saves[0].name === 'kepuli-tv-simcheck.json' && saves[0].size > 0, `the saved file reached the app as ${JSON.stringify(saves)}`);
  assert(stayed, 'the page went elsewhere');
  return `a Blob behind <a download> reached the app as ${saves[0].name}, ${saves[0].size} bytes, and the page stayed (the page itself saves nothing in the app: there is no settings export)`;
}

async function reminder(d) {
  await connected(d);
  // An earlier run's question and reminders are forgotten, so that the
  // first reminder asks the app for its notifications as on a first day.
  await d.page(`const all = await browser.storage.local.get(null);
    await browser.storage.local.remove(Object.keys(all).filter((key) => key === 'notifyAsked' || key === 'watchAsked' || key.startsWith('reminders')));
    return true;`);
  await reloaded(d);
  const set = await d.page(`if (!await openTab('live', 2)) return null;
    $('btn-guide').click();
    if (!await until(() => $('main').classList.contains('guide') && document.querySelectorAll('.epg-prog').length > 0)) return { open: false };
    await pause(500);
    const { t } = await import('./js/i18n.js');
    const ahead = [...document.querySelectorAll('.epg-prog[data-start]')].find((n) => Number(n.dataset.start) > Date.now() + 5 * 60000);
    if (!ahead) return { open: true, ahead: false };
    ahead.click();
    const button = await until(() => [...document.querySelectorAll('#epgv-actions button')].find((b) => b.textContent.trim() === t('guide.remind')), 5000);
    if (!button) return { open: true, ahead: true, button: false };
    button.click(); await pause(1200);
    const all = await browser.storage.local.get(null);
    const [key, list] = Object.entries(all).find(([name]) => name.startsWith('reminders')) || [];
    $('epg-close').click();
    return { open: true, ahead: true, button: true, account: key && key.slice('reminders:'.length), list, notifying: (await import('./js/remindersui.js')).notifying };`);
  assert(set && set.button && set.list && set.list.length === 1, `a reminder set in the guide: ${JSON.stringify(set)}`);
  const [kept] = set.list;
  const key = `${kept.channel.id}:${kept.start}`;
  let state = await d.state();
  const [planned] = state.reminders.plan;
  assert(state.reminders.notifier === 'fake' && state.reminders.system === 'granted' && set.notifying, `the first reminder asked for notifications: the app says ${state.reminders.system}, the page ${set.notifying}`);
  // The status names no account: its key is the provider's address.
  assert(state.reminders.plan.length === 1 && planned.identifier === `reminder|#0|${key}` && !JSON.stringify(state.reminders).includes('127.0.0.1') && planned.at === kept.start - 60000
    && planned.text.includes(kept.title) && planned.text.includes(kept.channel.n) && state.reminders.pending.includes(planned.identifier),
  `the app's plan for ${kept.title} on ${kept.channel.n} at ${kept.start}: ${JSON.stringify(state.reminders.plan)}`);
  // The page keeps a reminder that passed while it was closed; the app
  // must drop it, as the system raises an exception for a time not ahead.
  await d.page(`(await import('./js/host.js')).send('reminders.set', { account: ${JSON.stringify(set.account)}, items: [
      { id: 'past', at: Date.now() - 3600000, text: 'An hour ago', channel: ${JSON.stringify(kept.channel)} },
      { id: 'now', at: Date.now(), text: 'Now', channel: ${JSON.stringify(kept.channel)} },
      { id: ${JSON.stringify(key)}, at: ${planned.at}, text: ${JSON.stringify(planned.text)}, channel: ${JSON.stringify(kept.channel)} }] });
    await pause(600); return true;`);
  state = await d.state();
  assert(!state.failure && state.port && state.reminders.plan.length === 1 && state.reminders.plan[0].identifier === planned.identifier,
    `with two items not ahead in the list the plan is ${JSON.stringify(state.reminders.plan.map((item) => item.identifier))}`);
  await d.native(`tap-reminder ${key}`);
  const tapped = await d.page(`const started = await until(playing, 40000); return { started: Boolean(started), title: title() };`);
  assert(tapped.started && tapped.title === kept.channel.n, `the tapped reminder ${tapped.started ? `played ${tapped.title}` : 'played nothing'}, not ${kept.channel.n}`);
  await d.shot('reminder');
  // The web content process ends and the notification is tapped at once,
  // as on a phone whose app slept while the system took the process: the
  // tap is kept for the page that is loaded next, and its channel plays.
  // The bridge took the dead page for connected, and the tap was lost.
  await d.page(`$('btn-home').click(); await pause(600); window.__simcheck = 4; return true;`);
  await d.native('killweb');
  await d.native(`tap-reminder ${key}`);
  let back = null;
  for (const until = Date.now() + 40000; Date.now() < until && !back?.started;) {
    await sleep(1000);
    back = await d.page(`if (window.__simcheck === 4) return null; const started = await until(playing, 20000); return { started: Boolean(started), title: title() };`).catch(() => null);
  }
  assert(back && back.started && back.title === kept.channel.n, `a reminder tapped as the web process ended ${back?.started ? `played ${back.title}` : 'played nothing'} after the reload, not ${kept.channel.n}`);
  await d.page(`const { toggleReminder } = await import('./js/remindersui.js');
    toggleReminder(${JSON.stringify(kept.channel)}, { title: ${JSON.stringify(kept.title)}, start: ${kept.start}, stop: ${kept.stop || kept.start + 1800000} });
    $('btn-home').click(); await pause(600); return true;`);
  const left = (await d.state()).reminders.plan.length;
  assert(left === 0, `the reminder taken away, the plan still holds ${left}`);
  // The page's word that an account left its list (reminders.clear, which
  // dev/playcheck.mjs iosapp holds to the removal in Settings) takes that
  // account's notifications away, and so does a reset of the player, made
  // here in Settings: they stayed with the system, and fired for an
  // account the viewer had deleted.
  const remind = async () => {
    await d.page(`const { toggleReminder, reminderKey, reminders } = await import('./js/remindersui.js');
      const channel = ${JSON.stringify(kept.channel)}, programme = { title: ${JSON.stringify(kept.title)}, start: ${kept.start}, stop: ${kept.stop || kept.start + 1800000} };
      if (reminders.has(reminderKey(channel, programme))) toggleReminder(channel, programme);
      toggleReminder(channel, programme); await pause(800); return true;`);
    return (await d.state()).reminders;
  };
  const held = [await remind()];
  await d.page(`await (await import('./js/remindersui.js')).forgetNotifications(${JSON.stringify(set.account)}); return true;`);
  held.push((await d.state()).reminders, await remind());
  await d.page(`$('btn-settings').click(); await until(() => $('setup').open); document.querySelector('#setup-tabs [data-panel="account"]').click(); await pause(400);
    $('f-reset').click(); await pause(300); $('f-reset').click(); return true;`);
  await sleep(4000);
  const reset = await d.page(`await until(() => $('setup').open, 15000); return { account: Boolean((await browser.storage.local.get('config')).config), welcome: $('setup').open };`);
  held.push((await d.state()).reminders);
  const counts = held.map((r) => `${r.plan.length}/${r.pending.length}`).join(' ');
  assert(counts === '1/1 0/0 1/1 0/0' && !reset.account && reset.welcome, `planned/pending with a reminder set, reminders.clear said for its account, set again, the player reset: ${counts}; after the reset ${JSON.stringify(reset)}`);
  return `"${planned.text}" planned a minute before ${new Date(kept.start).toTimeString().slice(0, 5)}, the status naming no account; items an hour past and due now were dropped; the tap played ${tapped.title}, and again after the web process had ended under it; removed, the plan is empty; reminders.clear for the account and the player reset in Settings leave no notification behind`;
}

async function stalker(d, { mock }) {
  await connected(d);
  const portal = { type: 'stalker', url: `http://127.0.0.1:${MOCK_PORT}/c/`, mac: mock.STALKER_MAC, name: 'Demo portal', id: 'pst', sourceMode: 'stalker', streamMode: 'auto' };
  // A portal's channel is a transport stream from a one-time address.
  process.env.KEPULI_MOCK_LIVE_TS = '1';
  Object.assign(mock.stalkerSeen, { api: 0, refused: 0, streams: 0, loose: 0 });
  try {
    await d.page(`await browser.storage.local.set(${JSON.stringify({ config: portal, accounts: [portal, XTREAM], ui: { tab: 'live' } })}); return true;`);
    await sleep(300);
    await reloaded(d);
    const played = await d.page(`const started = await playChannel(); const from = video.currentTime; await pause(2500);
      return { started: Boolean(started), advanced: video.currentTime - from, title: title(), engine: (await import('./js/playing.js')).playback.engineKey };`, 120000);
    const asked = { ...mock.stalkerSeen, tokens: undefined };
    assert(asked.api > 3 && asked.refused === 0, `the portal was asked ${asked.api} times and turned ${asked.refused} away for want of the cookie or the set-top box's User-Agent`);
    assert(played.started && played.advanced > 1.5 && asked.streams >= 1, `a portal channel: ${JSON.stringify(played)}, ${asked.streams} stream(s) through create_link`);
    await d.shot('stalker');
    return `${asked.api} portal requests, none turned away (the header rule holds in WebKit); ${played.title} played from a one-time link (${played.engine})`;
  } finally {
    process.env.KEPULI_MOCK_LIVE_TS = '';
    await d.page(`$('btn-home').click(); await pause(300); await browser.storage.local.set(${JSON.stringify({ config: XTREAM, accounts: [XTREAM] })}); return true;`).catch(() => {});
    await sleep(300);
    await reloaded(d).catch(() => {});
  }
}

async function kill(d) {
  await connected(d);
  // It dies as a viewer would have it: a channel playing, in full screen.
  const before = await d.page(`if (!await playChannel(1)) return null; window.__simcheck = 3; $('btn-full').click(); await pause(1200);
    return { route: location.hash, title: title(), full: $('videowrap').classList.contains('full') };`);
  assert(before && /channel=/.test(before.route), `no channel played, or it has no route: ${JSON.stringify(before)}`);
  const held = await d.state();
  assert(before.full && held.fullscreen === 'yes' && held.idleTimerDisabled, `before the end: full screen "${held.fullscreen}", the idle timer ${held.idleTimerDisabled ? 'off' : 'on'}`);
  await d.native('killweb');
  await sleep(2500);
  let after = null;
  for (const until = Date.now() + 30000; Date.now() < until && !after;) {
    after = await d.page(`const ok = await until(connected, 20000); await pause(1500);
      const { state } = await import('./js/state.js'), on = state.rows[state.cursor];
      return { ok: Boolean(ok), same: window.__simcheck === 3, route: location.hash, rows: rows().length, playing: Boolean(state.playing) || playing(), address: location.href.split('#')[0],
        stands: on ? on.n : null, full: $('videowrap').classList.contains('full'), host: await new Promise((heard) => { import('./js/host.js').then((h) => { h.on('host', () => heard(true)); setTimeout(() => heard(false), 500); }); }) };`).catch(() => null);
    if (!after) await sleep(1000);
  }
  const state = await d.state();
  assert(after && after.ok && !after.same, `after the web process ended: ${after ? (after.same ? 'the page is the same one: nothing was ended' : 'the lists did not load') : 'the page does not answer'}`);
  assert(after.address === PLAYER && after.route === before.route && after.rows > 0 && state.port && after.host, `the player came back at ${after.address}${after.route} with ${after.rows} rows, the port ${state.port ? 'connected' : 'not connected'}, the app's greeting ${after.host ? 'heard' : 'not heard'}; it was at ${before.route}`);
  // As a browser's reload has it (js/route.js): the list stands on the
  // channel the address names and nothing starts by itself. What the dead
  // page held of the app is let go: the screen may sleep, the bars are back.
  assert(after.stands === before.title && !after.playing, `the list stands on ${after.stands}${after.playing ? ' and something plays unasked' : ''}; ${before.title} was playing`);
  assert(state.idleTimerDisabled === false && state.fullscreen === 'no' && !state.statusBarHidden && !after.full,
    `after the end the idle timer is ${state.idleTimerDisabled ? 'off' : 'on'}, full screen "${state.fullscreen}", the status bar ${state.statusBarHidden ? 'hidden' : 'showing'}`);
  await d.shot('kill');
  const again = await d.page(`(document.querySelector('#list .row.selected') || rows().find((r) => r.textContent.includes(${JSON.stringify(before.title)}))).click();
    return { started: Boolean(await until(playing, 40000)), title: title() };`);
  assert(again.started && again.title === before.title, `chosen again, ${again.started ? again.title : 'nothing'} played`);
  await d.page(`$('btn-home').click(); return true;`);
  return `the web process ended while ${before.title} played in full screen; the player came back by itself at ${after.route} with its list and its port, standing on ${after.stands} and playing nothing until it was chosen, as after a reload in a browser; the idle timer on again and the system's bars back`;
}

/**
 * The app behind another, as after the home gesture: what the `audio`
 * background mode is declared for. Settings stands in for the other app,
 * as every simulator has it. An iPhone simulator has no picture in
 * picture (WebKit says so to the page, and the menu leaves it out), so
 * that half is the iPad's here and the device checklist's on an iPhone.
 */
async function background(d) {
  await connected(d);
  assert(await d.page(`return Boolean(await playChannel());`), 'no channel played');
  const away = async () => { simctl('launch', udid(d.name), 'com.apple.Preferences'); await sleep(4000); };
  const front = async () => { simctl('launch', udid(d.name), 'io.github.bigtimesam.kepulitv.debug'); await sleep(3000); };
  const look = () => d.page(`const from = video.currentTime; await pause(3000);
    return { advanced: video.currentTime - from, paused: video.paused, hidden: document.hidden, pip: video.webkitPresentationMode === 'picture-in-picture',
      full: $('videowrap').classList.contains('full'), named: Boolean(navigator.mediaSession.metadata?.title) };`);
  let told = '';
  try {
    // WebKit pauses a picture nobody sees; the page starts it again
    // (js/playercontrols.js), and the sound goes on for as long as the
    // viewer is away: looked at again after a quarter of a minute.
    await away();
    const left = await look();
    assert(left.hidden && !left.paused && left.advanced >= 2 && left.named, `behind another app: ${JSON.stringify(left)}`);
    await sleep(15000);
    const later = await look();
    assert(later.hidden && !later.paused && later.advanced >= 2, `a quarter of a minute behind another app: ${JSON.stringify(later)}`);
    // Pause on the lock screen and in Control Centre ends in the element's
    // pause(): it holds there, and in front again, where WebKit would
    // start the picture by itself.
    await d.page(`video.pause(); return true;`);
    const paused = await look();
    assert(paused.hidden && paused.paused && paused.advanced < 0.5, `paused behind another app: ${JSON.stringify(paused)}`);
    await front();
    const held = await look();
    assert(!held.hidden && held.paused && held.advanced < 0.5, `in front again after a pause behind another app: ${JSON.stringify(held)}`);
    // What the viewer had paused before leaving stays paused there; Play
    // there (the element's play()) starts it, and it plays on in front.
    await away();
    const quiet = await look();
    assert(quiet.hidden && quiet.paused, `left paused: ${JSON.stringify(quiet)}`);
    await d.page(`await video.play(); return true;`);
    const heard = await look();
    assert(heard.hidden && !heard.paused && heard.advanced >= 2, `played again behind another app: ${JSON.stringify(heard)}`);
    await front();
    const returned = await look();
    assert(!returned.paused && returned.advanced >= 2, `in front again: ${JSON.stringify(returned)}`);
    told = 'the channel\'s sound goes on behind another app with its title in the Media Session, a quarter of a minute later too; a pause there holds, in front again as well; left paused it stays paused, and started there it goes on and plays on in front';
    if (d.idiom === 'pad') {
      await d.page(`$('btn-full').click(); await until(() => $('videowrap').classList.contains('full'), 5000); $('btn-more').click(); await pause(300);
        if ($('btn-pip').hidden) return false; $('btn-pip').click(); return until(() => video.webkitPresentationMode === 'picture-in-picture', 8000);`);
      await sleep(1500);
      const out = await look();
      assert(out.pip && !out.full && !out.paused && (await d.state()).fullscreen === 'no', `in picture in picture from full screen: ${JSON.stringify(out)}`);
      await d.shot('background-pip');
      await away();
      const floating = await look();
      assert(floating.pip && !floating.paused && floating.advanced >= 2, `picture in picture behind another app: ${JSON.stringify(floating)}`);
      await d.shot('background-pip-away');
      await front();
      const home = await d.page(`await document.exitPictureInPicture(); await pause(1500); return { mode: video.webkitPresentationMode, paused: video.paused };`);
      assert(home.mode === 'inline' && !home.paused, `back from picture in picture: ${JSON.stringify(home)}`);
      told += '; the menu offers picture in picture, which leaves the app\'s full screen, plays on over the other app and comes back into the page playing';
    }
  } finally {
    try { simctl('terminate', udid(d.name), 'com.apple.Preferences'); } catch { /* it was not running */ }
  }
  return told;
}

/**
 * A reminder that falls due while the app is in front, with the system's
 * own notifications (a provisional leave, which asks nobody; the app is
 * installed anew for it, as a leave once refused stays refused). The
 * system shows it when the page cannot, a dialog being open; the page's
 * list without the reminder, sent before the notification's moment as the
 * page's own timer may send it, does not take it away; and the system
 * shows nothing when the page can say it itself.
 */
async function banner(d) {
  await fresh(d);
  await connected(d, { KEPULI_NOTIFY: 'quiet' });
  const leave = await d.page(`return (await import('./js/host.js')).request('notify.set', { on: true });`);
  assert(leave.system === 'granted', `the provisional leave: ${JSON.stringify(leave)}`);
  const due = async (dialog) => {
    const id = await d.page(`const h = await import('./js/host.js');
      if (${dialog}) { $('btn-settings').click(); await until(() => $('setup').open, 5000); await pause(600); }
      const account = 'banner', id = '${dialog ? 'dialog' : 'plain'}-' + Date.now(), at = Date.now() + 6000;
      h.send('reminders.set', { account, items: [{ id, at, text: 'A reminder in front', channel: { id: 1 } }] });
      await pause(at - Date.now() - 300);
      h.send('reminders.set', { account, items: [] });
      await pause(3300);
      if (${dialog}) $('setup').close();
      return id;`);
    // The status shows the system's lists as they were read the time before.
    await d.state();
    await sleep(700);
    const { reminders } = await d.state();
    assert(reminders.notifier === 'system' && !reminders.pending.length, `after a reminder fell due: ${JSON.stringify(reminders)}`);
    return reminders.delivered.some((identifier) => identifier.endsWith(`|${id}`));
  };
  const covered = await due(true), plain = await due(false);
  assert(covered && !plain, `the system showed the reminder ${covered ? '' : 'not '}with a dialog open and ${plain ? '' : 'not '}with the player in sight`);
  return 'with the system\'s own notifications a reminder due while Settings is open is shown by the system, though the page\'s list without it came 0.3 s before its moment; with the player in sight the system shows nothing';
}

const SCENARIOS = {
  boot: { run: bootScenario }, firstrun: { run: firstrun }, channels: { run: channels }, live: { run: live }, film: { run: film }, mkv: { run: mkv },
  guide: { run: guide }, settings: { run: settings }, persist: { run: persist }, fullscreen: { run: fullscreen },
  split: { run: split, only: 'pad' }, rotate: { run: rotateScenario }, cast: { run: cast }, links: { run: links }, save: { run: save },
  reminder: { run: reminder }, banner: { run: banner }, stalker: { run: stalker }, kill: { run: kill }, background: { run: background },
};
// The last two are the app's minimum, run when asked for by KEPULI_IOS_DEVICE.
const DEVICES = { 'kepuli-ios-iphone': 'phone', 'kepuli-ios-ipad': 'pad', 'kepuli-ios-iphone-26-0': 'phone', 'kepuli-ios-ipad-26-0': 'pad' };

/* ------------------------------------------------------------------- run */

async function onDevice(name, names, context, results) {
  let exists = true;
  try { udid(name); } catch { exists = false; }
  if (!exists) {
    for (const scenario of names) results.push({ device: name, scenario, outcome: 'NOT RUN', detail: `there is no ${name}: node ios/sim.mjs devices` });
    return;
  }
  const d = { ...device(name), idiom: DEVICES[name] };
  const wasBooted = booted(name);
  boot(name);
  try {
    await install(name);
    for (const scenario of names) {
      const { run, only } = SCENARIOS[scenario];
      // Not this device's: no entry. A run that ran nothing at all fails (main).
      if (only && only !== d.idiom) continue;
      const started = Date.now();
      let entry;
      try {
        entry = { outcome: 'PASS', detail: await run(d, context) };
      } catch (err) {
        entry = { outcome: 'FAIL', detail: err.message };
        await d.shot(`${scenario}-FAILED`).catch(() => {});
      }
      await upright(d).catch(() => {});
      results.push({ device: name, scenario, ...entry });
      console.log(`${entry.outcome}  ${d.short.padEnd(6)} ${scenario.padEnd(10)} ${((Date.now() - started) / 1000).toFixed(0).padStart(3)} s  ${entry.detail}`);
    }
  } finally {
    try { simctl('terminate', udid(name), 'io.github.bigtimesam.kepulitv.debug'); } catch { /* it was not running */ }
    if (!wasBooted) shutdown(name);
  }
}

async function main() {
  const asked = process.argv.slice(2);
  const unknown = asked.filter((name) => !SCENARIOS[name]);
  if (unknown.length) {
    console.error(`no scenario ${unknown.join(', ')}; there are: ${Object.keys(SCENARIOS).join(', ')}`);
    process.exit(1);
  }
  const names = asked;
  const everything = asked.length === 0;
  let taken = '';
  try { taken = execFileSync('lsof', ['-nP', `-iTCP:${MOCK_PORT}`, '-sTCP:LISTEN'], { encoding: 'utf8' }); } catch { /* lsof exits 1 when nothing listens */ }
  if (taken.trim()) {
    console.error(`port ${MOCK_PORT} is taken (another session's mock?): give a free one as KEPULI_IOS_MOCK_PORT\n${taken}`);
    process.exit(1);
  }
  // Without its media the mock answers every stream with 404, and eleven
  // minutes later the scenarios would say that no channel played.
  const media = join(ROOT, 'dev', 'mock', 'media', 'hls');
  if (!existsSync(media) || !readdirSync(media).some((name) => name.endsWith('.ts'))) {
    console.error('the mock has no media: run sh dev/mock/media.sh once in this checkout (it needs ffmpeg)');
    process.exit(1);
  }
  // The mock reads its port when it is imported.
  process.env.KEPULI_MOCK_PORT = String(MOCK_PORT);
  const mock = await import('../dev/mock/server.mjs');
  const server = await mock.startMockServer(MOCK_PORT);
  mkdirSync(SHOTS, { recursive: true });
  const results = [];
  try {
    const chosen = process.env.KEPULI_IOS_DEVICE;
    const devices = chosen ? [chosen] : ['kepuli-ios-iphone', 'kepuli-ios-ipad'];
    if (chosen && !DEVICES[chosen]) throw new Error(`KEPULI_IOS_DEVICE is ${chosen}; the scenarios run on ${Object.keys(DEVICES).join(', ')}`);
    for (const name of devices) await onDevice(name, everything ? Object.keys(SCENARIOS) : names, { mock }, results);
  } finally {
    server.close();
    server.closeAllConnections?.();
  }
  const count = (outcome) => results.filter((entry) => entry.outcome === outcome).length;
  if (!results.length) {
    console.error(`nothing ran: ${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} not for ${process.env.KEPULI_IOS_DEVICE || 'these devices'} (split runs on the iPad alone)`);
    process.exit(1);
  }
  console.log(`\n${count('PASS')} passed, ${count('FAIL')} failed${count('NOT RUN') ? `, ${count('NOT RUN')} not run` : ''}; pictures in ${SHOTS}`);
  for (const entry of results.filter((e) => e.outcome !== 'PASS')) console.log(`  ${entry.outcome}  ${entry.device} ${entry.scenario}: ${entry.detail}`);
  process.exit(count('FAIL') || count('NOT RUN') ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((err) => { console.error(err.message); process.exit(1); });
