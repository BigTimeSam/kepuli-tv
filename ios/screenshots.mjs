#!/usr/bin/env node
// The App Store's screenshots: five views of the app in the two simulators
// of the store's sizes, with the mock provider's invented catalogue. The
// counterpart of dev/store-screenshots.mjs, which takes the browsers' sets.
//
//   sh dev/mock/media.sh              once: renders the dummy media with ffmpeg
//   node ios/screenshots.mjs          both sets into brand/ios-screenshots/
//
//   KEPULI_SHOTS_DIR=<directory>               write there instead: compare first, then run without it
//   KEPULI_IOS_DEVICE=kepuli-ios-shots-ipad    one device's set (or kepuli-ios-shots-iphone)
//   KEPULI_SHOTS_VIEWS=01-channels,03-movie    only these views
//   KEPULI_IOS_MOCK_PORT=<port>                the mock's port when 8841 is taken
//
// The iPhone's are upright (1320 × 2868), the iPad's on its side
// (2752 × 2064), where the list and the picture stand next to each other.
// Each device is given what a picture for the store wants and a test does
// not. Two settings of the system's, which stay (these two simulators are
// for nothing else): British English as its language, as the status bar's
// clock is the system's, and on the iPad Full Screen Apps as its
// multitasking mode, as a window of iPadOS 26 carries a handle in its
// corner that reads as a flaw in a picture. And for the run: London as
// the device's time zone, as the browsers' sets have it (dev/screenshot.mjs),
// since the page writes a time as the viewer's region does and reads the
// region from the zone (9.30 in Finland, 09:30 there); the status bar at
// 9:41 with a full battery; and a clock in the mock and in the page
// (KEPULI_MOCK_NOW, ?testnow=) set to 9:41 this morning, so that the guide
// agrees with the bar and holds the same programmes on every run. A
// simulator takes its zone when it starts, so each device is started for
// the pictures and shut down after them, with the app removed again and
// the status bar given back.
//
// Every picture is checked for the store's size and for an alpha channel
// (`ios/sim.mjs shot` writes none), and the run fails on either. Look at
// all ten before they are committed: nothing here can tell a picture that
// reads badly.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readSync, closeSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ROOT } from '../firefox/build.mjs';
import { boot, evaluate, install, launch, rotate, shot, shutdown, simctl, udid, wipe } from './sim.mjs';
import { PAGE } from './simcheck.mjs';

const MOCK_PORT = Number(process.env.KEPULI_IOS_MOCK_PORT || 8841);
const OUT = process.env.KEPULI_SHOTS_DIR ? resolve(process.env.KEPULI_SHOTS_DIR) : join(ROOT, 'brand', 'ios-screenshots');
const ONLY = process.env.KEPULI_SHOTS_VIEWS ? new Set(process.env.KEPULI_SHOTS_VIEWS.split(',').map((v) => v.trim()).filter(Boolean)) : null;
// The file's prefix, how the device is held, the size the store takes, and
// the channel that plays: the iPhone's first picture is of the list alone,
// so the list's first row, which stands marked at its top; the iPad's shows
// the picture beside the list, so the channel whose picture carries its name.
const SETS = {
  'kepuli-ios-shots-iphone': { prefix: 'iphone', held: 'portrait', size: '1320x2868', channel: 'Aurora Cinema' },
  'kepuli-ios-shots-ipad': { prefix: 'ipad', held: 'landscape', size: '2752x2064', channel: 'Aurora One' },
};
const VIEWS = ['01-channels', '02-guide', '03-movie', '04-subtitles', '05-series'];
// The system's settings a picture wants: [domain, key, type, value, for the iPad alone].
const SYSTEM = [
  ['-g', 'AppleLocale', '-string', 'en_GB'],
  ['-g', 'AppleLanguages', '-array', 'en-GB'],
  ['com.apple.springboard', 'SBMedusaMultitaskingEnabled', '-bool', 'NO', true],
];
const ACCOUNT = { type: 'xtream', scheme: 'http', host: '127.0.0.1', port: String(MOCK_PORT), username: 'demo', password: 'demo', name: 'Demo server', id: 'pxt', sourceMode: 'xtream', streamMode: 'auto' };

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
// The zone of the pictures: this process's, for the morning below, and
// that of a simulator started from here (simctl hands SIMCTL_CHILD_* to
// what it starts; measured: started so, the page's zone is London's, and
// given to the app alone at its launch it stays the Mac's).
process.env.TZ = process.env.SIMCTL_CHILD_TZ = 'Europe/London';
// 9:41 this morning, as the status bar says.
const morning = new Date();
morning.setHours(9, 41, 0, 0);

// What the walk adds to the scenarios' helpers. A window of one pane (an
// upright iPhone) shows the lists or the player; `pane` asks for one where
// there is the switch. WebKit's own controls lie over a picture for some
// seconds after its start and cannot be asked about: `settled` waits them out.
const WALK = PAGE + String.raw`
const pane = async (name) => { const button = $('compact-' + name); if (seen(button)) { button.click(); await pause(400); } };
const settled = async () => { document.activeElement?.blur(); await pause(7000); return true; };
const country = async (tab, name, least = 1) => { if (!await openTab(tab, least)) return false; await pane('browse');
  return await press('#groups', name) && until(() => rows().length >= least && $('list-progress').hidden); };
`;

/** Width, height and whether there is an alpha channel, from a PNG's header. */
function pngFacts(file) {
  const head = Buffer.alloc(26), handle = openSync(file, 'r');
  readSync(handle, head, 0, 26, 0);
  closeSync(handle);
  return { size: `${head.readUInt32BE(16)}x${head.readUInt32BE(20)}`, alpha: [4, 6].includes(head[25]) };
}

/** The system's settings of SYSTEM on a running device, which is started again when one of them was another. */
function dressed(name) {
  const defaults = (...args) => { try { return simctl('spawn', udid(name), 'defaults', ...args); } catch { return ''; } };
  // As `defaults read` prints them: a boolean as 0 or 1, a list over several lines.
  const printed = (type, value) => (type === '-bool' ? String(Number(value === 'YES')) : value);
  const wrong = SYSTEM.filter(([domain, key, type, value, pad]) => (!pad || SETS[name].prefix === 'ipad') && !defaults('read', domain, key).includes(printed(type, value)));
  if (!wrong.length) return;
  for (const [domain, key, type, value] of wrong) defaults('write', domain, key, type, value);
  // Read at the system's start.
  shutdown(name);
  boot(name);
}

async function set(name) {
  const { prefix, held, size, channel } = SETS[name];
  const page = (body, timeout = 90000) => evaluate(WALK + body, { name, timeout });
  const must = async (what, body, timeout) => { if (!await page(body, timeout)) throw new Error(`${name}: ${what} did not show`); };
  const taken = [];
  const shoot = async (view) => {
    if (ONLY && !ONLY.has(view)) return;
    const file = await shot(join(OUT, `${prefix}-${view}.png`), name);
    const facts = pngFacts(file);
    if (facts.size !== size || facts.alpha) throw new Error(`${file} is ${facts.size}${facts.alpha ? ' with an alpha channel' : ''}; the store takes ${size} without one`);
    taken.push(file);
    console.log(`${file}  ${facts.size}`);
  };

  shutdown(name);
  boot(name);
  dressed(name);
  try {
    simctl('status_bar', udid(name), 'override', '--time', '9:41', '--batteryState', 'charged', '--batteryLevel', '100',
      '--dataNetwork', 'wifi', '--wifiMode', 'active', '--wifiBars', '3', '--cellularMode', 'active', '--cellularBars', '4');
    // As a new viewer meets it: nothing of an earlier run.
    try { wipe(name); } catch { /* it was not installed */ }
    await install(name);
    // Nothing leaves the app and nothing is asked of the system.
    const variables = { KEPULI_LINKS: 'record', KEPULI_SAVES: 'record', KEPULI_NOTIFY: 'fake', KEPULI_PAGE: `player.html?ios=1&testnow=${morning.getTime()}` };
    const state = await launch(variables, name);
    if (state.failure) throw new Error(`${name}: the app did not start: ${state.failure}`);
    // On a device that has just started, the first answer came from the
    // empty page the web view holds before the player's: it has no storage.
    for (let tries = 0; !await evaluate(`return typeof browser === 'object'`, { name, timeout: 5000 }).catch(() => false); tries++) {
      if (tries === 40) throw new Error(`${name}: the player's page did not load`);
      await sleep(500);
    }
    // secondHint: the once-only word on the second picture is not for the pictures.
    await page(`await browser.storage.local.set(${JSON.stringify({ config: ACCOUNT, accounts: [ACCOUNT],
      settings: { lang: 'en', theme: 'dark', epgEnabled: true, resumeEnabled: true, subtitleLang: 'eng' }, ui: { tab: 'live', secondHint: true } })}); return true;`);
    await launch(variables, name);
    await must('the demo account\'s lists', `return until(connected, 40000)`);
    if (held === 'landscape') await rotate('landscape', name);

    // 1. Channels: a country's channels with their programmes, one of them playing.
    await must('Finland\'s channels', `return country('live', 'Finland', 2)`);
    await sleep(1500);                                   // programme data lands on the rows
    await must('the live channel', `await press('#list', ${JSON.stringify(channel)}); if (!await until(playing, 40000)) return false; await pane('browse'); return settled();`);
    await shoot('01-channels');

    // 2. The programme guide over the same channels.
    await must('the guide', `$('btn-guide').click();
      if (!await until(() => $('main').classList.contains('guide') && document.querySelectorAll('.epg-prog').length > 20)) return false;
      await pause(3000); return settled();`);
    await shoot('02-guide');
    await page(`$('epg-close').click(); await pause(500); return true;`);

    // 5. A series: cover, plot, seasons and episodes, the channel playing on
    // beside it where the window has the room. Taken before the fourth,
    // which plays its first episode, and the third, as the browsers' walk
    // has them (dev/store-screenshots.mjs).
    await must('the series', `if (!await country('series', 'Nordic Noir')) return false; await press('#list', 'Silent Fjord');
      if (!await until(() => !$('detail').hidden && document.querySelector('#detail .detail-plot') && rows().length > 0)) return false;
      await pause(1500); return settled();`);
    await shoot('05-series');

    // 4. An episode from an MKV, a subtitle in the picture.
    await must('the episode with a subtitle', `rows()[0].click();
      if (!await until(playing, 60000)) return false;
      const subs = $('subs');
      if (!await until(() => !subs.hidden && subs.options.length > 1)) return false;
      const english = [...subs.options].find((o) => /english/i.test(o.textContent));
      if (english && subs.value !== english.value) { subs.value = english.value; subs.dispatchEvent(new Event('change', { bubbles: true })); }
      await pane('player'); await settled();
      return until(() => seen(document.querySelector('#videowrap .subdisplay')) && document.querySelector('#videowrap .subdisplay').textContent.trim().length > 0, 30000);`, 150000);
    await shoot('04-subtitles');

    // 3. A film playing, with its cover, plot and details under the picture.
    await must('the film', `if (!await country('movie', 'Nordic')) return false; await press('#list', 'Northern Lights');
      if (!await until(playing, 40000)) return false;
      if (!await until(() => !$('infostrip').hidden && document.querySelector('#infostrip .plot'))) return false;
      await pane('player'); return settled();`);
    await shoot('03-movie');
  } finally {
    await rotate('portrait', name).catch(() => {});
    try { wipe(name); } catch { /* it was not installed */ }
    try { simctl('status_bar', udid(name), 'clear'); } catch { /* the device is gone */ }
    shutdown(name);
  }
  return taken;
}

async function main() {
  const chosen = process.env.KEPULI_IOS_DEVICE;
  if (chosen && !SETS[chosen]) throw new Error(`KEPULI_IOS_DEVICE is ${chosen}; the pictures are taken on ${Object.keys(SETS).join(' and ')}`);
  const unknown = [...(ONLY || [])].filter((view) => !VIEWS.includes(view));
  if (unknown.length) throw new Error(`no view ${unknown.join(', ')}; there are: ${VIEWS.join(', ')}`);
  let listening = '';
  try { listening = execFileSync('lsof', ['-nP', `-iTCP:${MOCK_PORT}`, '-sTCP:LISTEN'], { encoding: 'utf8' }); } catch { /* lsof exits 1 when nothing listens */ }
  if (listening.trim()) throw new Error(`port ${MOCK_PORT} is taken (another session's mock?): give a free one as KEPULI_IOS_MOCK_PORT\n${listening}`);
  const media = join(ROOT, 'dev', 'mock', 'media', 'hls');
  if (!existsSync(media) || !readdirSync(media).some((file) => file.endsWith('.ts'))) throw new Error('the mock has no media: run sh dev/mock/media.sh once in this checkout (it needs ffmpeg)');
  // The mock reads its port and its clock when it is imported.
  process.env.KEPULI_MOCK_PORT = String(MOCK_PORT);
  process.env.KEPULI_MOCK_NOW = morning.toISOString();
  const mock = await import('../dev/mock/server.mjs');
  const server = await mock.startMockServer(MOCK_PORT);
  mkdirSync(OUT, { recursive: true });
  try {
    let count = 0;
    for (const name of chosen ? [chosen] : Object.keys(SETS)) count += (await set(name)).length;
    console.log(`${count} pictures in ${OUT}: look at each`);
  } finally {
    // The paced live stream would keep the server, and this process, alive.
    server.closeAllConnections?.();
    server.close();
  }
}

main().catch((err) => { console.error(err.message); process.exit(1); });
