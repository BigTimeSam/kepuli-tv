#!/usr/bin/env node
// Two live channels side by side against real accounts, for minutes or hours:
// do both pictures keep playing, and when one stops, was the stream there to
// be had by connecting again?
//
// The mock server cannot answer that: a real provider cuts connections,
// answers slowly, counts connections for a while after they close and sends
// channels at real bit rates. This drives the player in a test Chrome with
// the accounts in a file outside the repository, plays one channel, opens a
// second beside it the way a viewer does (the row's menu; through the other
// account when the first allows one stream), and then only watches:
//
//   every 5 s   each picture's position, buffer and state
//   a stall     a picture that has not moved for 10 s: when, for how long
//   a pause     somebody paused it in the test Chrome: timed apart from the
//               rest, and left out of the share played
//   reconnects  the loader's own (the server closed the stream, asked again
//               at once, unseen) and the watchdog's restarts (seen)
//   a give-up   the player showing its failure; the tool presses Try again
//               and reports whether the stream came back — if it did, the
//               player gave up on a stream that was there
//
//   node dev/livesoak.mjs [--minutes 30] [--first "channel"] [--second "channel"]
//                         [--accounts file] [--log file.json]
//
// --first and --second are channel names as the list shows them (looked for
// with the player's own search); without them the rows of the list are
// tried in order until two of them play. The accounts file is ~/.config/kepuli-tv/soak-accounts.json
// (mode 600), never the repository:
//
//   [{ "name": "A", "url": "http://host:8080/get.php?username=…&password=…&type=m3u" },
//    { "name": "B", "url": "…" }]
//
// One account does when it allows two streams. KEPULI_DEV_PORT and
// KEPULI_DEV_PROFILE name the test Chrome, as for every tool here; it must
// not be headless the first time, as Chrome asks to allow the provider's
// address and someone has to press Allow. The profile's accounts are
// replaced by the file's: never point it at a profile someone uses.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ensureChrome, openPlayer, session, sleep, evaluate, waitFor, PORT } from './screenshot.mjs';

const arg = (name, fallback = null) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const MINUTES = Number(arg('minutes', 30));
const FILE = arg('accounts', join(homedir(), '.config', 'kepuli-tv', 'soak-accounts.json'));
const LOG = arg('log');
const SAMPLE_MS = 5000;
const STALL_MS = 10000;

if (PORT === 9222) { console.error('KEPULI_DEV_PORT is the owner\'s Chrome (9222): name a test Chrome and its profile.'); process.exit(1); }
if (!existsSync(FILE)) { console.error(`no accounts file at ${FILE}; see the head of this script for its form`); process.exit(1); }

/** A get.php link, or the fields themselves, as the player's account. */
function account(entry, index) {
  let fields = entry;
  if (entry.url) {
    const u = new URL(entry.url);
    fields = { scheme: u.protocol.replace(':', ''), host: u.hostname, port: u.port || (u.protocol === 'https:' ? '443' : '80'), username: u.searchParams.get('username'), password: u.searchParams.get('password') };
  }
  return { type: 'xtream', sourceMode: 'xtream', streamMode: 'auto', ...fields, name: entry.name || `Account ${index + 1}`, id: `soak-${index + 1}` };
}
const accounts = JSON.parse(readFileSync(FILE, 'utf8')).map(account);
// The credentials never reach the output: whatever is printed goes through this.
const secrets = accounts.flatMap((a) => [a.username, a.password]).filter(Boolean);
const clean = (text) => secrets.reduce((out, secret) => out.replaceAll(secret, '•••'), String(text));
const stamp = () => new Date().toTimeString().slice(0, 8);
const say = (...parts) => console.log(stamp(), clean(parts.join(' ')));

const CONNECTED = `document.querySelectorAll('#groups .group').length > 1 && document.getElementById('list-progress').hidden`;
const GRANT = `(() => { const b = document.querySelector('#overlay-actions button'); return !document.getElementById('overlay').hidden && b ? b.textContent : null; })()`;

await ensureChrome(['--autoplay-policy=no-user-gesture-required']);
const target = await openPlayer();
const page = session(target.webSocketDebuggerUrl);
await page.call('Page.bringToFront');
await evaluate(page, `chrome.storage.local.get('ui').then(({ ui }) => chrome.storage.local.set(${JSON.stringify({ accounts, config: accounts[0] })}).then(() => chrome.storage.local.set({ ui: { ...ui, tab: 'live', secondHint: true } })))`);
await page.call('Page.navigate', { url: target.url.split('#')[0].split('?')[0] });
await sleep(1500);

// Connected, or waiting for the browser's leave to reach the provider: the
// player's own button asks for it, and the press on Allow is a person's.
say(`connecting as ${accounts[0].name} to ${accounts[0].host}`);
for (let asked = false, t0 = Date.now(); !(await evaluate(page, CONNECTED).catch(() => false));) {
  const button = await evaluate(page, GRANT).catch(() => null);
  if (button && !asked) {
    asked = true;
    say(`the player offers "${button}": pressing it; choose Allow in the Chrome window if it asks`);
    await evaluate(page, `document.querySelector('#overlay-actions button').click()`, { gesture: true });
  } else if (button && Date.now() - t0 > 20000 && (Date.now() - t0) % 30000 < 1100) {
    say(`still not connected: ${await evaluate(page, `document.getElementById('overlay-said').textContent.trim().replace(/\\s+/g, ' ').slice(0, 160)`)}`);
    asked = false;
  }
  if (Date.now() - t0 > 5 * 60000) { say('not connected in five minutes; giving up'); process.exit(1); }
  await sleep(1000);
}
const allowed = await evaluate(page, `import('./js/state.js').then((m) => m.state.account ? { max: m.state.account.maxConnections, active: m.state.account.activeConnections, status: m.state.account.status } : null)`);
say(`connected: ${JSON.stringify(allowed)}`);

/** The row of a channel: by name through the search, or by its place in the list. */
async function row(name, place) {
  await evaluate(page, `document.querySelector('#tabs [data-tab="live"]').click()`);
  if (name) {
    await evaluate(page, `(() => { const s = document.getElementById('search'); s.focus(); s.value = ${JSON.stringify(name)}; s.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await sleep(1500);
  }
  await waitFor(page, `document.querySelectorAll('#list .row').length > ${name ? 0 : place}`, `the channel ${name || `in place ${place + 1}`}`, 120000);
  return name ? 0 : place;
}
const rowName = (index) => evaluate(page, `import('./js/state.js').then((m) => m.state.rows[${index}]?.n || '')`);

// A real list has channels that are off the air or outside the subscription
// (the provider refuses them at once): without a name given, the rows are
// tried in order until one plays, and the second picture goes on from there.
const TRIES = 10;
const playingIn = (id) => `(() => { const v = document.getElementById('${id}'); return v.readyState >= 2 && v.currentTime > 0.3; })()`;
/** Whether the picture plays within the time, or the player has said it will not. */
async function starts(id, failed, seconds = 40) {
  for (let t0 = Date.now(); Date.now() - t0 < seconds * 1000; await sleep(500)) {
    if (await evaluate(page, playingIn(id)).catch(() => false)) return true;
    if (await evaluate(page, failed).catch(() => false)) return false;
  }
  return false;
}
const FIRST_FAILED = `!document.getElementById('overlay').hidden && !document.getElementById('overlay').classList.contains('loading') && /\S/.test(document.getElementById('overlay-text').textContent) && document.getElementById('video').readyState < 2`;
const SECOND_FAILED = `!document.getElementById('second-note').hidden && !document.getElementById('second-retry').hidden`;

let place = await row(arg('first'), 0);
let firstName = '';
for (let tries = 0; ; tries++, place++) {
  firstName = await rowName(place);
  if (!firstName) { say('no more channels to try for the first picture'); process.exit(1); }
  await evaluate(page, `document.querySelectorAll('#list .row')[${place}].scrollIntoView({ block: 'center' })`).catch(() => {});
  await evaluate(page, `Promise.all([import('./js/state.js'), import('./js/playing.js')]).then(([s, p]) => p.playItem(s.state.rows[${place}]))`, { gesture: true });
  if (await starts('video', FIRST_FAILED)) break;
  say(`first picture: ${firstName} did not start (${await evaluate(page, `document.getElementById('overlay-text').textContent.trim().slice(0, 110)`)})`);
  if (arg('first') || tries >= TRIES) { say('giving up on the first picture'); process.exit(1); }
}
say(`first picture: ${firstName}`);

place = arg('second') ? await row(arg('second'), 0) : place + 1;
for (let tries = 0; ; tries++, place++) {
  const name = await rowName(place);
  if (!name) { say('no more channels to try for the second picture'); process.exit(1); }
  const offered = await evaluate(page, `Promise.all([import('./js/state.js'), import('./js/secondui.js')]).then(([s, u]) => u.secondOffered(s.state.rows[${place}]))`);
  if (!offered) { say(`no second picture on offer for ${name}: the account allows ${allowed?.max ?? 'an unknown number of'} stream(s) and no other account can give one`); process.exit(1); }
  await evaluate(page, `Promise.all([import('./js/state.js'), import('./js/secondui.js')]).then(([s, u]) => u.secondFor(s.state.rows[${place}], document.getElementById('list')))`, { gesture: true });
  await sleep(800);
  // One stream on the account: the menu asks which other account, and the first of them is taken.
  const asked = await evaluate(page, `[...document.querySelectorAll('.row-menu button')].map((b) => b.textContent)`);
  if (asked.length) await evaluate(page, `document.querySelector('.row-menu button').click()`, { gesture: true });
  const through = asked.length ? asked[0] : accounts.length > 1 && !(allowed?.max >= 2) ? accounts[1].name : accounts[0].name;
  if (await starts('video2', SECOND_FAILED)) { say(`second picture: ${name}, through ${through}`); break; }
  say(`second picture: ${name} did not start through ${through} (${await evaluate(page, `document.getElementById('second-note').hidden ? 'no word' : document.getElementById('second-note').firstElementChild.textContent.slice(0, 110)`)})`);
  await evaluate(page, `import('./js/secondui.js').then((u) => u.closeSecond())`);
  if (arg('second') || tries >= TRIES) { say('giving up on the second picture'); process.exit(1); }
  await sleep(3000);
}
say(`both playing; watching for ${MINUTES} min`);

const SAMPLE = `Promise.all([import('./js/playing.js'), import('./js/secondui.js')]).then(([p, u]) => JSON.stringify([[p.playback, 'video', document.getElementById('overlay').hidden ? '' : document.getElementById('overlay-said').textContent.trim().replace(/\\s+/g, ' '), document.querySelector('#overlay-actions button') && !document.getElementById('overlay').classList.contains('loading')],
  [u.second, 'video2', document.getElementById('second-note').hidden ? '' : document.getElementById('second-note').firstElementChild.textContent, !document.getElementById('second-retry').hidden && !document.getElementById('second-note').hidden]].map(([pb, id, said, failed]) => {
    const v = document.getElementById(id); const b = v.buffered; const q = v.getVideoPlaybackQuality();
    return { t: v.currentTime, ready: v.readyState, paused: v.paused, ahead: b.length ? Math.round(b.end(b.length - 1) - v.currentTime) : 0, engine: pb.engineKey, restarts: pb.reconnects, loader: pb.liveReconnects, said: said.slice(0, 140), failed: Boolean(failed), size: v.videoWidth + 'x' + v.videoHeight, dropped: q.droppedVideoFrames, frames: q.totalVideoFrames };
  })))`;
const NAMES = ['first', 'second'];
const stats = NAMES.map(() => ({ played: 0, paused: 0, stalls: [], stalledSince: null, loader: 0, restarts: 0, gaveUp: [], last: null, lastMove: Date.now() }));
const events = [];
const note = (who, text) => { events.push({ at: new Date().toISOString(), who, text: clean(text) }); say(`${who}: ${text}`); };
const t0 = Date.now();
let samples = 0;
while (Date.now() - t0 < MINUTES * 60000) {
  await sleep(SAMPLE_MS);
  let now;
  try { now = JSON.parse(await evaluate(page, SAMPLE)); } catch (err) { note('page', `could not be read: ${err.message}`); continue; }
  samples++;
  for (const [i, s] of now.entries()) {
    const st = stats[i], who = NAMES[i];
    const moved = st.last ? s.t - st.last.t : 0;
    // A pause is someone's hand on the test Chrome, not the stream's doing: timed apart, and said.
    if (s.paused) st.paused += SAMPLE_MS / 1000;
    if (st.last && s.paused !== st.last.paused) note(who, s.paused ? 'paused (by hand: the player does not pause a live channel)' : 'played on');
    // A restart begins the picture's clock again; only forward steps of a plausible size count as played.
    if (moved > 0.5 && moved < 60) { st.played += moved; st.lastMove = Date.now(); }
    else if (moved <= -1 || moved >= 60) st.lastMove = Date.now();
    if (st.last && s.loader > st.last.loader) { st.loader += s.loader - st.last.loader; note(who, `the server closed the stream and the loader asked again at once (${st.loader} so far), ${s.ahead} s in hand`); }
    if (st.last && s.restarts > st.last.restarts) { st.restarts += s.restarts - st.last.restarts; note(who, `restarted by the watchdog: ${s.said || 'no word'}`); }
    const still = Date.now() - st.lastMove;
    if (still >= STALL_MS && st.stalledSince === null && !s.paused) { st.stalledSince = st.lastMove; note(who, `stalled (ready ${s.ready}, ${s.ahead} s in hand${s.said ? `, "${s.said}"` : ''})`); }
    if (st.stalledSince !== null && still < SAMPLE_MS * 1.5) {
      const seconds = Math.round((Date.now() - st.stalledSince) / 1000);
      st.stalls.push(seconds); st.stalledSince = null;
      note(who, `moving again after ${seconds} s`);
    }
    // The player has given up and says so: is the stream there to be had?
    if (s.failed && !(st.last && st.last.failed)) {
      note(who, `gave up: "${s.said}"; pressing Try again`);
      await evaluate(page, i === 0 ? `import('./js/recordingsui.js').then((m) => m.retryPlayback())` : `document.getElementById('second-retry').click()`, { gesture: true });
      const id = i === 0 ? 'video' : 'video2';
      const back = await waitFor(page, `(() => { const v = document.getElementById('${id}'); return v.readyState >= 2 && !v.paused && v.currentTime > 0.3; })()`, 'the stream again', 45000).then(() => true, () => false);
      st.gaveUp.push({ said: s.said, cameBack: back });
      note(who, back ? 'the stream came back on asking again: the player gave up on a stream that was there' : 'not there on asking again either');
    }
    st.last = s;
  }
  if (samples % 60 === 0) say(`${Math.round((Date.now() - t0) / 60000)} min: ${now.map((s, i) => `${NAMES[i]} ${s.size} ${s.engine || 'no engine'}, ${s.ahead} s in hand`).join('; ')}`);
}

const wall = (Date.now() - t0) / 1000;
const summary = stats.map((st, i) => {
  if (st.stalledSince !== null) st.stalls.push(Math.round((Date.now() - st.stalledSince) / 1000));
  return { picture: NAMES[i], playedPct: +(100 * st.played / Math.max(1, wall - st.paused)).toFixed(1), pausedSeconds: Math.round(st.paused), stalls: st.stalls.length, stalledSeconds: st.stalls.reduce((a, b) => a + b, 0), longestStall: Math.max(0, ...st.stalls),
    loaderReconnects: st.loader, watchdogRestarts: st.restarts, gaveUp: st.gaveUp.length, thereOnAskingAgain: st.gaveUp.filter((g) => g.cameBack).length,
    size: st.last?.size, engine: st.last?.engine, droppedFrames: st.last ? `${st.last.dropped} of ${st.last.frames}` : null };
});
say(`watched ${Math.round(wall / 60)} min`);
for (const line of summary) console.log(JSON.stringify(line));
if (LOG) writeFileSync(LOG, JSON.stringify({ minutes: MINUTES, host: accounts[0].host, accounts: accounts.map((a) => a.name), summary, events }, null, 2));
process.exit(0);
