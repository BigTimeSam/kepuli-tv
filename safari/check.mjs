#!/usr/bin/env node
// The player's scenarios in this Mac's Safari, against the mock server.
//
//   node safari/check.mjs [scenario …]     all of them, or the ones named
//                                          (start connect deny live mp4 mkv record cast reminders)
//
// Safari must run with the built extension on and the player open
// (node safari/build.mjs, node safari/drive.mjs start): this neither builds
// nor starts anything of Safari's, as a restart of Safari is the owner's
// to allow. It starts a mock server of its own on KEPULI_SAFARI_MOCK_PORT
// (8794) unless one answers there already, and stops it again.
//
// What it covers is what differs in Safari (safari/AGENTS.md): the host
// permission's dialog, the three ways a stream is played, recording to the
// private file system, reminders without a notifications permission. The
// rest of the player is the same code the Chrome scenarios cover
// (dev/playcheck.mjs), which Safari has no protocol to run.
//
// The picture is muted throughout: the mock's sound would come out of the
// Mac's speakers.

import { dialog, evaluate, press } from './drive.mjs';

const PORT = Number(process.env.KEPULI_SAFARI_MOCK_PORT || 8794);
process.env.KEPULI_MOCK_PORT = String(PORT);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (ok, message) => { if (!ok) throw new Error(message); };

/** An expression's value, as JSON; the page answers a string. */
function ask(expression) {
  const said = evaluate(`JSON.stringify(${expression})`);
  if (said === null) throw new Error('Safari gave no answer: a dialog of its own is up?');
  if (said === 'no extension tab') throw new Error('the player is not open in Safari: node safari/drive.mjs start');
  return said === '' || said === 'missing value' ? undefined : JSON.parse(said);
}

/**
 * The value an async function body settles to. Safari's "do JavaScript"
 * does not wait for a promise, so the page keeps the answer and is asked
 * for it until it is there.
 */
async function run(body, timeout = 60000) {
  const key = `__kepuli${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  ask(`(() => { window.${key} = { state: 'running' }; (async () => { ${body} })().then((value) => { window.${key} = { state: 'done', value }; }, (err) => { window.${key} = { state: 'failed', error: String(err && err.stack || err) }; }); return true; })()`);
  for (const t0 = Date.now(); Date.now() - t0 < timeout;) {
    await sleep(500);
    const now = ask(`window.${key}`);
    if (now.state === 'done') { ask(`delete window.${key}`); return now.value; }
    if (now.state === 'failed') throw new Error(now.error);
  }
  throw new Error('the page did not finish in time');
}

/** Safari's dialog answered, once it has come up. */
async function answerDialog(button, wait = 10000) {
  for (const t0 = Date.now(); Date.now() - t0 < wait;) {
    const said = dialog();
    if (said && said.startsWith('dialog:')) { assert(dialog(button) === `clicked ${button}`, `no "${button}" on Safari's dialog`); return said; }
    await sleep(500);
  }
  throw new Error('Safari showed no permission dialog');
}

const MUTE = `document.getElementById('video').muted = true;`;
const LOOK = `(() => { const v = document.getElementById('video'); return { t: v.currentTime, paused: v.paused, ready: v.readyState, width: v.videoWidth }; })()`;
/** The picture running: the time moves between two looks. */
async function playing(what, timeout = 30000) {
  for (const t0 = Date.now(); Date.now() - t0 < timeout;) {
    const a = ask(LOOK);
    await sleep(1500);
    const b = ask(LOOK);
    if (!b.paused && b.ready >= 2 && b.t > a.t) return b;
  }
  throw new Error(`${what} did not play: ${JSON.stringify(ask(LOOK))}`);
}
const engine = () => run(`return (await import('./js/playing.js')).playback.engineKey;`);
const playFilm = (pick) => run(`${MUTE} const { state } = await import('./js/state.js'); const { playItem } = await import('./js/playing.js');
  const film = (await state.lib.ensureFull('movie')).find(${pick}); if (!film) return null; playItem(film); return film.n;`);

const SCENARIOS = {
  /** The player as Safari loads it: the manifest made for Safari, and what the engine offers. */
  async start() {
    // Straight after `drive.mjs reload` the tab is there before its page:
    // the first question got no answer, and every scenario after it failed.
    for (const t0 = Date.now(); Date.now() - t0 < 30000 && ask(`document.readyState === 'complete' && location.pathname`) !== '/player.html';) await sleep(500);
    const facts = ask(`(() => { const api = globalThis.browser || chrome; const m = api.runtime.getManifest(); return { page: location.pathname, protocol: location.protocol, optional: m.optional_permissions || [], background: m.background, mse: typeof MediaSource, dnr: typeof api.declarativeNetRequest, native: typeof api.runtime.connectNative }; })()`);
    assert(facts.protocol === 'safari-web-extension:' && facts.page === '/player.html', `not the extension's player: ${JSON.stringify(facts)}`);
    assert(!facts.optional.includes('notifications') && Array.isArray(facts.background?.scripts) && !facts.background.service_worker, `the manifest is not Safari's: ${JSON.stringify(facts)}`);
    assert(facts.mse === 'function' && facts.dnr === 'object', `what the engine offers: ${JSON.stringify(facts)}`);
    return `the player at ${facts.protocol}//…${facts.page}, a manifest without notifications and with background.scripts, MediaSource and declarativeNetRequest there`;
  },

  /** Connecting as a viewer does: the address typed, Connect pressed, Safari's question answered. */
  async connect() {
    const address = `http://127.0.0.1:${PORT}/get.php?username=demo&password=demo&type=m3u_plus`;
    let before = ask(`({ rows: document.querySelectorAll('#list .row').length, host: document.querySelector('dialog[open]')?.id || null })`);
    // The player was opened before this run's mock was up: its account is
    // there and its first try failed. The overlay's own Try again, then.
    if (!before.rows && !before.host && ask(`Boolean(document.querySelector('#overlay-actions button')) && !document.getElementById('overlay').hidden`)) {
      ask(`(document.querySelector('#overlay-actions button').click(), true)`);
      for (const t0 = Date.now(); Date.now() - t0 < 30000 && !(ask(`document.querySelectorAll('#list .row').length`) > 0);) await sleep(500);
      before = ask(`({ rows: document.querySelectorAll('#list .row').length, host: document.querySelector('dialog[open]')?.id || null })`);
    }
    if (before.rows > 0 && !before.host) {
      const granted = await run(`return (globalThis.browser || chrome).permissions.contains({ origins: ['http://127.0.0.1/*'] });`);
      assert(granted, 'connected, but the mock\'s host is not among the granted origins');
      return `already connected to the mock (${before.rows} rows), its host granted`;
    }
    assert(before.host === 'setup', `neither connected nor at the account's form: ${JSON.stringify(before)}`);
    ask(`(() => { const f = document.getElementById('f-paste'); f.value = ${JSON.stringify(address)}; for (const n of ['input', 'change']) f.dispatchEvent(new Event(n, { bubbles: true })); return true; })()`);
    assert(/^pressed/.test(press('Connect')), 'no Connect to press');
    const asked = await answerDialog('Always Allow');
    assert(/would like to access 127\.0\.0\.1/.test(asked), `Safari asked: ${asked}`);
    for (const t0 = Date.now(); Date.now() - t0 < 30000 && !(ask(`document.querySelectorAll('#list .row').length`) > 0);) await sleep(500);
    const after = ask(`({ rows: document.querySelectorAll('#list .row').length, groups: document.querySelectorAll('#groups .group').length, form: Boolean(document.querySelector('dialog[open]')) })`);
    assert(after.rows > 0 && after.groups > 1 && !after.form, `after Always Allow: ${JSON.stringify(after)}`);
    return `Connect brought Safari's question for 127.0.0.1, Always Allow connected: ${after.groups} countries, ${after.rows} rows`;
  },

  /** Safari's question refused: the request says no, and nothing is granted. */
  async deny() {
    const label = `kepulitest-${Date.now()}`;
    ask(`(() => { window.__grant = 'not asked'; const b = document.createElement('button'); b.dataset.kepulitest = '1'; b.textContent = '${label}'; b.style.cssText = 'position:fixed;left:10px;bottom:10px;z-index:99999';
      b.onclick = () => { window.__grant = 'pending'; (globalThis.browser || chrome).permissions.request({ origins: ['http://deny.kepuli.test/*'] }).then((ok) => { window.__grant = ok; }, (e) => { window.__grant = 'rejected: ' + e.message; }); };
      document.body.appendChild(b); return true; })()`);
    try {
      assert(/^pressed/.test(press(label)), 'the test button was not pressed');
      await answerDialog('Deny');
      await sleep(2000);
      const said = ask('window.__grant');
      const held = await run(`return (globalThis.browser || chrome).permissions.contains({ origins: ['http://deny.kepuli.test/*'] });`);
      assert(said === false && held === false, `after Deny: the request said ${JSON.stringify(said)}, contains ${held}`);
      return 'Deny on Safari\'s question resolved the request false and granted nothing';
    } finally {
      ask(`(document.querySelectorAll('button[data-kepulitest]').forEach((b) => b.remove()), true)`);
    }
  },

  /** A channel pressed as a viewer presses it plays, through hls.js. */
  async live() {
    ask(`(${MUTE.replace(';', '')}, document.getElementById('btn-home').click(), document.getElementById('tab-live').click(), true)`);
    await sleep(1500);
    // The row by its own spoken name ("Maple Cinema Action, 13.00 Silent
    // Fjord"): the channel's name alone is also on a card of the start page
    // once the channel has been watched, and the press went there instead.
    const row = ask(`(() => { const r = document.querySelectorAll('#list .row')[2]; return { name: (r.querySelector('.row-name') || r).textContent.trim(), spoken: r.getAttribute('aria-label') }; })()`);
    const name = row.name;
    assert(/^pressed/.test(press(row.spoken || name)), `the row "${row.spoken || name}" was not pressed`);
    const at = await playing(`the channel "${name}"`);
    const how = await engine();
    assert(how === 'hls' && at.width > 0, `the channel plays through ${how}, ${at.width} px wide`);
    return `"${name}" pressed and playing through ${how}, ${at.width} px wide`;
  },

  /** A film in MP4 is the browser's own to play. */
  async mp4() {
    const film = await playFilm(`(f) => f.ext === 'mp4'`);
    assert(film, 'the mock has no MP4 film');
    const at = await playing(`the film "${film}"`);
    const how = await engine();
    assert(how === 'native', `an MP4 film plays through ${how}`);
    return `"${film}" playing natively, ${at.width} px wide`;
  },

  /** A Matroska film is unpacked by the player and played through MediaSource. */
  async mkv() {
    const film = await playFilm(`(f) => f.ext === 'mkv'`);
    assert(film, 'the mock has no MKV film');
    const at = await playing(`the film "${film}"`, 45000);
    const how = await engine();
    assert(how === 'remux', `an MKV film plays through ${how}`);
    return `"${film}" playing through ${how}, ${at.width} px wide`;
  },

  /** A channel recorded to the private file system: MPEG-TS, closed and listed as done. */
  async record() {
    const made = await run(`${MUTE} const api = globalThis.browser || chrome; const { state } = await import('./js/state.js'); const { playItem } = await import('./js/playing.js');
      const ui = await import('./js/recordingsui.js'); const rec = await import('./js/recorder.js'); const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const was = state.settings.recordingEnabled; await api.storage.local.remove('recordings'); state.settings.recordingEnabled = true;
      try {
        playItem((await state.lib.ensureFull('live'))[0]); await wait(6000);
        await ui.toggleRecordNow(); await wait(10000); await ui.toggleRecordNow(); await wait(3000);
        const [entry] = (await api.storage.local.get('recordings')).recordings || [];
        if (!entry) return { supported: await rec.recordingSupported(), entry: null };
        const blob = await rec.recordingBlob(entry.id);
        const first = new Uint8Array(await blob.slice(0, 1).arrayBuffer())[0];
        await rec.deleteRecordingFiles(entry.id); await api.storage.local.remove('recordings');
        return { supported: await rec.recordingSupported(), state: entry.state || entry.status, bytes: blob.size, first };
      } finally { state.settings.recordingEnabled = was; document.getElementById('btn-home').click(); }`, 90000);
    assert(made.supported && made.state === 'done' && made.bytes > 500000 && made.first === 0x47, `the recording: ${JSON.stringify(made)}`);
    return `ten seconds of a channel recorded: ${(made.bytes / 1048576).toFixed(1)} MB of MPEG-TS, listed as done`;
  },

  /** Safari reaches no Chromecast, only AirPlay: the menu does not offer to cast to one. */
  async cast() {
    const seen = await run(`const cast = await import('./js/cast.js'); return { supported: cast.supported, item: !document.getElementById('btn-cast').hidden, remote: 'remote' in HTMLMediaElement.prototype };`);
    assert(seen.supported === false && seen.item === false, `casting in Safari: ${JSON.stringify(seen)}`);
    return `no Cast to a Chromecast in the menu${seen.remote ? ', though the engine has Remote Playback (AirPlay)' : ''}`;
  },

  /** No notifications permission in Safari: the switch is not offered, and asking is refused without Safari being asked. */
  async reminders() {
    const seen = await run(`const r = await import('./js/remindersui.js'); document.getElementById('btn-settings').click(); await new Promise((x) => setTimeout(x, 800));
      const row = document.getElementById('f-notify').closest('.toggle'); const asked = await r.setNotifying(true);
      const out = { canNotify: r.canNotify, notifying: r.notifying, switchShown: getComputedStyle(row).display !== 'none', asked };
      document.getElementById('f-done')?.click(); return out;`);
    assert(seen.canNotify === false && seen.notifying === false && !seen.switchShown && seen.asked === false, `reminders in Safari: ${JSON.stringify(seen)}`);
    const up = dialog();
    assert(up === 'no dialog', `asking for notifications brought a dialog of Safari's: ${up}`);
    return 'notifications are known to be unavailable, the switch in Settings is not shown, and asking is answered no without a question from Safari';
  },
};

const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SCENARIOS);
const unknown = names.filter((name) => !SCENARIOS[name]);
if (unknown.length) { console.error(`no such scenario: ${unknown.join(', ')} (there are: ${Object.keys(SCENARIOS).join(', ')})`); process.exit(2); }

// The mock, unless one answers on the port already.
let server = null;
if (!(await fetch(`http://127.0.0.1:${PORT}/player_api.php?username=demo&password=demo`).then((r) => r.ok, () => false))) {
  server = await (await import('../dev/mock/server.mjs')).startMockServer(PORT);
}
let failed = 0;
try {
  for (const name of names) {
    try { console.log(`PASS  ${name}: ${await SCENARIOS[name]()}`); }
    catch (err) { failed++; console.log(`FAIL  ${name}: ${err.message.split('\n')[0]}`); }
  }
} finally {
  try { ask(`(document.getElementById('video').muted = true, document.getElementById('btn-home')?.click(), true)`); } catch { /* Safari is not there to tidy */ }
  server?.close?.();
}
console.log(failed ? `${failed} of ${names.length} scenarios failed` : `PASS: ${names.length} scenarios in Safari`);
process.exit(failed ? 1 : 0);
