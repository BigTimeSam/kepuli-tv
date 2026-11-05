#!/usr/bin/env node
// Firefox for Android over USB: the checkout installed on a phone or a
// tablet, the player opened, code run in it and its console followed.
//
//   node firefox/android.mjs install          package the checkout (uncommitted changes
//                                             included), install it as a temporary add-on
//                                             and open the player
//   node firefox/android.mjs open             open a player tab
//   node firefox/android.mjs eval '<expr>'    evaluate in the player tab (await allowed)
//   node firefox/android.mjs bg '<expr>'      evaluate in the background page, woken if asleep
//   node firefox/android.mjs logs             follow the player tab's console and errors
//   node firefox/android.mjs shot [file.png]  a screenshot of the device's screen
//   node firefox/android.mjs status           the device, Firefox and the add-on as installed
//
// The device needs Android's USB debugging and Firefox's own "Remote
// debugging via USB" (Settings → Advanced); the first connection asks on
// the device to be allowed. adb is taken from $ADB, from the PATH or from
// the Android SDK in its default place. KEPULI_ANDROID_PACKAGE picks
// another Firefox (org.mozilla.fenix for Nightly, org.mozilla.firefox_beta),
// KEPULI_ANDROID_PORT the local port the socket is forwarded to.
//
// The temporary add-on replaces the installed Kepuli-TV until Firefox
// restarts; the add-on id is the same, so the settings and the accounts
// are the ones already there, and the tab that had the player open closes.
// It is the owner's device: nothing here clears data or restarts Firefox.
//
// The protocol is Firefox's Remote Debugging Protocol, length-prefixed
// JSON over the socket Firefox opens on the device. A WebExtension's
// descriptor answers getWatcher, not getTarget; an event page that has
// gone to sleep shows only a fallback document without the browser API,
// so `bg` reloads the add-on to wake it — measured on Firefox 152, the
// reload starts the background page within a second. Firefox for Android
// will not open a moz-extension: address from an Android intent, which is
// why the player is opened from the background with tabs.create.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import net from 'node:net';
import { join } from 'node:path';
import { DIST, ROOT } from '../dev/package.mjs';

const ID = 'kepuli-tv@bigtimesam.github.io';
const PACKAGE = process.env.KEPULI_ANDROID_PACKAGE || 'org.mozilla.firefox';
const PORT = Number(process.env.KEPULI_ANDROID_PORT || 6123);
const DEVICE_DIR = '/data/local/tmp/kepuli-tv';
const XPI = join(DIST, 'android', 'kepuli-tv.xpi');

/* ------------------------------------------------------------------ adb */

function findAdb() {
  const candidates = [
    process.env.ADB,
    'adb',
    process.env.ANDROID_HOME && join(process.env.ANDROID_HOME, 'platform-tools', 'adb'),
    join(homedir(), 'Library', 'Android', 'sdk', 'platform-tools', 'adb'),
    join(homedir(), 'Android', 'Sdk', 'platform-tools', 'adb'),
  ].filter(Boolean);
  for (const adb of candidates) {
    if (spawnSync(adb, ['version'], { stdio: 'ignore' }).status === 0) return adb;
  }
  fail('adb was not found: install the Android platform tools or set ADB.');
}

const ADB = findAdb();
const adb = (...args) => execFileSync(ADB, args, { encoding: 'utf8' }).trim();

function fail(message) {
  console.error(message);
  process.exit(1);
}

function device() {
  const lines = adb('devices').split('\n').slice(1).filter((l) => l.trim());
  if (!lines.length) fail('No device: connect it with USB and turn on USB debugging in Android\'s developer options.');
  const [serial, state] = lines[0].split(/\s+/);
  if (state === 'unauthorized') fail('The device is unauthorised: accept "Allow USB debugging?" on its screen.');
  if (state !== 'device') fail(`The device ${serial} is ${state}.`);
  return serial;
}

/** The socket forwarded to a local port, or a clear word on what is missing. */
function forward() {
  device();
  const socket = `${PACKAGE}/firefox-debugger-socket`;
  const listening = adb('shell', 'cat /proc/net/unix 2>/dev/null; ss -xl 2>/dev/null').includes(socket);
  if (!listening) {
    fail(`Firefox (${PACKAGE}) is not listening: open it, and turn on Settings → Advanced → "Remote debugging via USB".`);
  }
  adb('forward', `tcp:${PORT}`, `localabstract:${socket}`);
}

/* ------------------------------------------------------------- protocol */

// Events arrive from the same actors as replies; these are never replies.
const EVENTS = /^(tabNavigated|frameUpdate|evaluationResult|consoleAPICall|pageError|tabListChanged|addonListChanged|newSource|descriptor-destroyed|target-available-form|target-destroyed-form|resources-available-array|resources-updated-array|resources-destroyed-array|resource-available-form)$/;

async function connect() {
  forward();
  const socket = net.connect(PORT, '127.0.0.1');
  let buffer = Buffer.alloc(0);
  const waiting = new Map();
  const listeners = new Set();
  let greet;
  const greeting = new Promise((resolve) => { greet = resolve; });
  socket.on('data', (data) => {
    buffer = Buffer.concat([buffer, data]);
    for (;;) {
      const colon = buffer.indexOf(':');
      if (colon < 0) return;
      const length = Number(buffer.subarray(0, colon).toString());
      if (buffer.length < colon + 1 + length) return;
      const message = JSON.parse(buffer.subarray(colon + 1, colon + 1 + length).toString());
      buffer = buffer.subarray(colon + 1 + length);
      if (message.from === 'root' && message.applicationType) { greet(message); continue; }
      for (const listener of listeners) listener(message);
      const queue = waiting.get(message.from);
      if (queue && queue.length && !EVENTS.test(message.type || '')) queue.shift()(message);
    }
  });
  socket.on('close', () => { if (!closing) fail('Firefox closed the connection.'); });
  let closing = false;
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); });
  await Promise.race([greeting, new Promise((_, reject) => setTimeout(() => reject(new Error('Firefox did not answer: allow the incoming connection on the device.')), 60000))]);
  const request = (to, packet) => new Promise((resolve, reject) => {
    if (!waiting.has(to)) waiting.set(to, []);
    waiting.get(to).push((reply) => (reply.error ? reject(new Error(`${reply.error}: ${reply.message || ''}`)) : resolve(reply)));
    const text = JSON.stringify({ to, ...packet });
    socket.write(`${Buffer.byteLength(text)}:${text}`);
  });
  const on = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
  const close = () => { closing = true; socket.end(); };
  return { request, on, close };
}

async function addon(c) {
  const { addons } = await c.request('root', { type: 'listAddons' });
  return addons.find((a) => a.id === ID) || null;
}

async function playerTab(c) {
  const { tabs } = await c.request('root', { type: 'listTabs' });
  return tabs.find((t) => t.url.startsWith('moz-extension://') && /\/player\.html/.test(t.url)) || null;
}

/** Evaluates in a console actor and returns the value, objects as JSON. */
async function evaluate(c, consoleActor, expression) {
  // The expression is wrapped so that an object comes back as text rather
  // than as an object actor to be asked again.
  const text = `(async () => { const v = await (${expression}); return typeof v === 'string' ? v : JSON.stringify(v, null, 1); })()`;
  const result = new Promise((resolve) => {
    const off = c.on((m) => { if (m.from === consoleActor && m.type === 'evaluationResult') { off(); resolve(m); } });
  });
  await c.request(consoleActor, { type: 'evaluateJSAsync', text, mapped: { await: true } });
  const m = await result;
  if (m.exception) throw new Error(m.exceptionMessage);
  const value = m.result;
  if (value && typeof value === 'object') {
    if (value.type === 'longString') {
      const full = await c.request(value.actor, { type: 'substring', start: 0, end: value.length });
      return full.substring;
    }
    if (value.type === 'undefined') return undefined;
  }
  return value;
}

/** The background page's console actor, waking the event page if it sleeps. */
async function background(c) {
  const descriptor = await addon(c);
  if (!descriptor) fail(`${ID} is not installed in ${PACKAGE}: run install first.`);
  const watcher = await c.request(descriptor.actor, { type: 'getWatcher', isServerTargetSwitchingEnabled: true, isPopupDebuggingEnabled: false });
  const forms = [];
  c.on((m) => { if (m.type === 'target-available-form') forms.push(m.target); });
  await c.request(watcher.actor, { type: 'watchTargets', targetType: 'frame' });
  const page = () => forms.find((f) => /^moz-extension:.*\/_generated_background_page\.html/.test(f.url));
  await new Promise((resolve) => setTimeout(resolve, 800));
  if (!page()) {
    await c.request(descriptor.actor, { type: 'reloadDescriptor' });
    const t0 = Date.now();
    while (!page() && Date.now() - t0 < 15000) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!page()) fail('The background page did not start.');
  return page().consoleActor;
}

async function playerConsole(c) {
  const tab = await playerTab(c);
  if (!tab) fail('No player tab is open: run open first.');
  const { frame } = await c.request(tab.actor, { type: 'getTarget' });
  return { tab, frame };
}

/* ------------------------------------------------------------- commands */

async function open(c) {
  const actor = await background(c);
  await evaluate(c, actor, `browser.tabs.create({ url: browser.runtime.getURL('player.html') })`);
  const t0 = Date.now();
  while (!(await playerTab(c)) && Date.now() - t0 < 10000) await new Promise((resolve) => setTimeout(resolve, 300));
  console.log((await playerTab(c)) ? 'The player is open on the device.' : 'The tab was asked for but has not appeared.');
}

async function install() {
  device();
  console.log('Packaging the checkout…');
  execFileSync(process.execPath, [join(ROOT, 'dev', 'package.mjs'), 'firefox', '--worktree'], { stdio: 'inherit' });
  mkdirSync(join(DIST, 'android'), { recursive: true });
  rmSync(XPI, { force: true });
  execFileSync('zip', ['-qr', XPI, '.'], { cwd: join(DIST, 'firefox') });
  adb('shell', 'mkdir', '-p', DEVICE_DIR);
  adb('push', XPI, `${DEVICE_DIR}/kepuli-tv.xpi`);
  adb('shell', 'chmod', '644', `${DEVICE_DIR}/kepuli-tv.xpi`);
  const c = await connect();
  const root = await c.request('root', { type: 'getRoot' });
  await c.request(root.addonsActor, { type: 'installTemporaryAddon', addonPath: `${DEVICE_DIR}/kepuli-tv.xpi` });
  console.log(`Installed as a temporary add-on in ${PACKAGE} (until Firefox restarts).`);
  await open(c);
  c.close();
}

async function logs(c) {
  const { tab } = await playerConsole(c);
  const watcher = await c.request(tab.actor, { type: 'getWatcher', isServerTargetSwitchingEnabled: true });
  await c.request(watcher.actor, { type: 'watchTargets', targetType: 'frame' });
  c.on((m) => {
    if (m.type !== 'resources-available-array') return;
    for (const [kind, items] of m.array) {
      for (const item of items) {
        if (kind === 'console-message') {
          const text = (item.arguments || []).map((a) => (typeof a === 'object' && a ? (a.type === 'longString' ? a.initial : a.class || a.type) : String(a))).join(' ');
          console.log(`${item.level.padEnd(5)} ${text}`);
        } else if (kind === 'error-message') {
          const e = item.pageError;
          console.log(`${e.warning ? 'warn ' : 'ERROR'} ${e.errorMessage} (${(e.sourceName || '').replace(/^moz-extension:\/\/[^/]+/, '')}:${e.lineNumber})`);
        }
      }
    }
  });
  await c.request(watcher.actor, { type: 'watchResources', resourceTypes: ['console-message', 'error-message'] });
  console.error('Following the player\'s console; Ctrl-C to stop.');
  await new Promise(() => {});
}

function shot(file) {
  device();
  const out = file || join(DIST, 'android', `screen-${Date.now()}.png`);
  mkdirSync(join(out, '..'), { recursive: true });
  writeFileSync(out, execFileSync(ADB, ['exec-out', 'screencap', '-p'], { maxBuffer: 64 << 20 }));
  console.log(out);
}

async function status() {
  const serial = device();
  const model = adb('shell', 'getprop', 'ro.product.model');
  const android = adb('shell', 'getprop', 'ro.build.version.release');
  const version = (adb('shell', 'dumpsys', 'package', PACKAGE).match(/versionName=(\S+)/) || [])[1] || 'not installed';
  console.log(`${model} (${serial}), Android ${android}, ${PACKAGE} ${version}`);
  const c = await connect();
  const a = await addon(c);
  console.log(a ? `${a.name}: ${a.temporarilyInstalled ? `temporary, from ${a.url}` : 'installed from the store'}, background ${a.backgroundScriptStatus || '?'}` : `${ID} is not installed`);
  console.log((await playerTab(c)) ? 'A player tab is open.' : 'No player tab is open.');
  c.close();
}

const [command, argument] = process.argv.slice(2);
try {
  if (command === 'install') await install();
  else if (command === 'shot') shot(argument);
  else if (command === 'status') await status();
  else if (['open', 'eval', 'bg', 'logs'].includes(command)) {
    const c = await connect();
    if (command === 'open') await open(c);
    if (command === 'eval') {
      if (!argument) fail('eval needs an expression.');
      const { frame } = await playerConsole(c);
      console.log(await evaluate(c, frame.consoleActor, argument));
    }
    if (command === 'bg') {
      if (!argument) fail('bg needs an expression.');
      console.log(await evaluate(c, await background(c), argument));
    }
    if (command === 'logs') await logs(c);
    c.close();
  } else {
    console.error('usage: node firefox/android.mjs install|open|eval <expr>|bg <expr>|logs|shot [file]|status');
    process.exit(2);
  }
  process.exit(0);
} catch (err) {
  fail(err.message);
}
