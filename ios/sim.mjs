#!/usr/bin/env node
// The iOS app in a simulator: built, installed, launched, and the page in
// it run, looked at and turned. The counterpart of firefox/android.mjs.
//
//   node ios/sim.mjs devices                 create what is missing of this tool's own simulators,
//                                            list them, write their UDIDs to ios/dist/devices.json
//   node ios/sim.mjs boot|shutdown|delete [all]   the chosen device, or all of its own
//   node ios/sim.mjs install                 node ios/build.mjs --simulator when the build is stale, then install
//   node ios/sim.mjs launch [NAME=value …]   terminate, launch with those environment variables, wait for the page
//   node ios/sim.mjs status                  the native state as JSON: extension and context errors, the page's
//                                            address, grants, the port, the idle timer, the app's full screen and
//                                            WebKit's, orientation, sizes, the cast and reminder state, recorded
//                                            links and saves
//   node ios/sim.mjs eval '<body>'           the body of an async function, run in the page; `return` the answer
//   node ios/sim.mjs evalfile <path> [ms]    the same from a file, with a time limit (60 s by default)
//   node ios/sim.mjs native '<command>'      state | reload | rotate portrait|landscape | width <points>|full |
//                                            killweb | tap-reminder <id>   (rotate turns the simulated device
//                                            itself, as a hand would, and it stays turned: turn it back)
//   node ios/sim.mjs log [n]                 the last n lines of the page's console, its errors and the app's notes
//   node ios/sim.mjs shot [file.png]         a screenshot (into KEPULI_SHOTS_DIR or the temporary directory),
//                                            written without an alpha channel, as the App Store takes it
//   node ios/sim.mjs wipe                    uninstall the app, its data with it
//
// KEPULI_IOS_DEVICE picks the device (kepuli-ios-iphone by default):
//   kepuli-ios-iphone        iPhone 17, iOS 26.5         kepuli-ios-ipad        iPad (A16), iOS 26.5
//   kepuli-ios-min           iPhone 16, iOS 18.5 (the app's minimum, and the oldest runtime that can be run)
//   kepuli-ios-shots-iphone  iPhone 17 Pro Max           kepuli-ios-shots-ipad  iPad Pro 13-inch (M5): the store's sizes
// Launch variables the Debug build reads: KEPULI_PAGE (player.html?ios=1),
// KEPULI_NOTIFY=fake|fake-granted|fake-denied (the system's leave unasked,
// given or refused, with nothing asked of the system), KEPULI_LINKS=record,
// KEPULI_SAVES=record.
//
// Only the simulators this tool created are ever touched, and always by
// UDID: another session may have a device of the same name, and killing or
// addressing by name would reach it. The UDIDs are in ios/dist/devices.json;
// if that file is lost, `devices` creates new ones and the old are left for
// `xcrun simctl delete <udid>` by hand.
//
// The page is reached through the Debug build's file bridge
// (ios/App/Debug/DebugBridge.swift): a command is a file in
// Library/Caches/kepuli-debug/cmd/ of the app's data container, the answer
// one in out/. No port is opened. The mock server for a scenario is
// KEPULI_MOCK_PORT=8841 node dev/mock/server.mjs, reached from the
// simulator as 127.0.0.1.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BUNDLE, DIST, IOS, buildSimulator, simulatorApp, stale } from './build.mjs';

const BUNDLE_ID = BUNDLE.Debug;
const DEVICES_FILE = join(DIST, 'devices.json');
const SIMULATORS = {
  'kepuli-ios-iphone': { type: 'iPhone-17', runtime: 'iOS-26-5' },
  'kepuli-ios-ipad': { type: 'iPad-A16', runtime: 'iOS-26-5' },
  'kepuli-ios-min': { type: 'iPhone-16', runtime: 'iOS-18-5' },
  'kepuli-ios-shots-iphone': { type: 'iPhone-17-Pro-Max', runtime: 'iOS-26-5' },
  'kepuli-ios-shots-ipad': { type: 'iPad-Pro-13-inch-M5-12GB', runtime: 'iOS-26-5' },
};
const TYPE = 'com.apple.CoreSimulator.SimDeviceType.';
const RUNTIME = 'com.apple.CoreSimulator.SimRuntime.';

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
// stderr is kept out of the terminal: simctl explains at length that an app
// it was asked to terminate was not running. A failure still throws with it.
export const simctl = (...args) => execFileSync('xcrun', ['simctl', ...args], { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const recorded = () => (existsSync(DEVICES_FILE) ? JSON.parse(readFileSync(DEVICES_FILE, 'utf8')) : {});
const chosen = () => process.env.KEPULI_IOS_DEVICE || 'kepuli-ios-iphone';

/** Every simulator on the machine, by UDID: { name, state, runtime }. */
function existing() {
  const found = {};
  for (const [runtime, list] of Object.entries(JSON.parse(simctl('list', 'devices', '-j')).devices)) {
    for (const device of list) found[device.udid] = { name: device.name, state: device.state, runtime: runtime.slice(RUNTIME.length) };
  }
  return found;
}

/**
 * Creates what is missing of this tool's simulators and records them.
 * A device whose type or runtime is not installed is left out, and said.
 */
export function devices() {
  const have = existing();
  const types = new Set(JSON.parse(simctl('list', 'devicetypes', '-j')).devicetypes.map((t) => t.identifier));
  const runtimes = new Set(JSON.parse(simctl('list', 'runtimes', '-j')).runtimes.filter((r) => r.isAvailable).map((r) => r.identifier));
  const record = recorded();
  const lines = [];
  for (const [name, { type, runtime }] of Object.entries(SIMULATORS)) {
    if (!have[record[name]]) {
      delete record[name];
      if (!types.has(TYPE + type) || !runtimes.has(RUNTIME + runtime)) {
        lines.push(`${name.padEnd(24)} not created: ${types.has(TYPE + type) ? `the runtime ${runtime}` : `the device type ${type}`} is not installed`);
        continue;
      }
      record[name] = simctl('create', name, TYPE + type, RUNTIME + runtime);
      have[record[name]] = { state: 'Shutdown', runtime };
    }
    lines.push(`${name.padEnd(24)} ${record[name]}  ${have[record[name]].runtime}  ${have[record[name]].state}`);
  }
  mkdirSync(DIST, { recursive: true });
  writeFileSync(DEVICES_FILE, JSON.stringify(record, null, 2) + '\n');
  return lines;
}

/** The UDID of one of this tool's own simulators. */
export function udid(name = chosen()) {
  const id = recorded()[name];
  if (!id) throw new Error(`no simulator ${name}: run node ios/sim.mjs devices`);
  return id;
}

/** Whether one of this tool's simulators is running. */
export const booted = (name = chosen()) => existing()[udid(name)]?.state === 'Booted';

/** The names a verb applies to: the chosen device, or with `all` every one this tool created. */
const targets = (all) => (all ? Object.keys(recorded()) : [chosen()]);

export function boot(name = chosen()) {
  const id = udid(name);
  if (!booted(name)) {
    try { simctl('boot', id); } catch (err) { if (!/current state: Booted/.test(String(err.stderr))) throw err; }
  }
  // Returns when the system has finished starting, which `boot` does not wait for.
  simctl('bootstatus', id, '-b');
}

export function shutdown(name = chosen()) {
  if (existing()[udid(name)]?.state !== 'Shutdown') simctl('shutdown', udid(name));
}

/** A tool of this directory's own, compiled into ios/dist/ when its source is newer (rotate.m, flatten.swift). */
function tool(name, source, compile) {
  const built = join(DIST, name);
  if (!existsSync(built) || statSync(built).mtimeMs < statSync(join(IOS, source)).mtimeMs) {
    mkdirSync(DIST, { recursive: true });
    execFileSync('xcrun', [...compile, '-o', built, join(IOS, source)], { stdio: ['ignore', 'inherit', 'inherit'] });
  }
  return built;
}

export function remove(name = chosen()) {
  const record = recorded();
  if (existing()[record[name]]) simctl('delete', record[name]);
  delete record[name];
  writeFileSync(DEVICES_FILE, JSON.stringify(record, null, 2) + '\n');
}

/** Builds the Debug app when an input changed since the last build, and installs it. */
export async function install(name = chosen()) {
  const built = stale('Debug');
  if (built) await buildSimulator({ configuration: 'Debug' });
  simctl('install', udid(name), simulatorApp('Debug'));
  return built;
}

const bridge = (name) => join(simctl('get_app_container', udid(name), BUNDLE_ID, 'data'), 'Library', 'Caches', 'kepuli-debug');

/**
 * One command through the file bridge: kind `js` (the body of an async
 * function for the page) or `native`. Returns the parsed answer, or
 * { error } when none came in time.
 */
export async function command(kind, body, { name = chosen(), timeout = 60000 } = {}) {
  const directory = bridge(name);
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  mkdirSync(join(directory, 'cmd'), { recursive: true });
  // Written under another name first: the app polls the directory and must
  // not read half a file.
  writeFileSync(join(directory, 'cmd', `${id}.tmp`), body);
  renameSync(join(directory, 'cmd', `${id}.tmp`), join(directory, 'cmd', `${id}.${kind}`));
  const out = join(directory, 'out', `${id}.json`);
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (existsSync(out)) {
      const text = readFileSync(out, 'utf8');
      rmSync(out);
      return JSON.parse(text);
    }
    await sleep(100);
  }
  rmSync(join(directory, 'cmd', `${id}.${kind}`), { force: true });
  return { error: `no answer in ${timeout} ms` };
}

/** Runs the body of an async function in the page and returns what it returns; throws on an error. */
export async function evaluate(body, options) {
  const answer = await command('js', body, options);
  if (answer.error) throw new Error([answer.error, answer.message, answer.line && `line ${answer.line}`].filter(Boolean).join(': '));
  return answer.ok;
}

/** A native command (see the top of this file); throws when the app does not answer. */
export async function native(text, options) {
  const [verb, argument] = text.trim().split(/\s+/);
  if (verb === 'rotate') return rotate(argument, options?.name);
  const answer = await command('native', text, options);
  if (answer && answer.error) throw new Error(answer.error);
  return answer;
}

/**
 * Turns the simulated device to `portrait` or `landscape` and returns the
 * native state once the app has followed. The app has no part in it
 * (ios/rotate.m says why and how), so this is the turn a viewer makes, and
 * like theirs it outlasts the app: a scenario turns the device back.
 */
export async function rotate(orientation, name = chosen()) {
  if (!['portrait', 'landscape'].includes(orientation)) throw new Error('rotate portrait|landscape');
  execFileSync(tool('rotate', 'rotate.m', ['clang', '-fobjc-arc', '-framework', 'Foundation']), [udid(name), orientation], { stdio: ['ignore', 'inherit', 'inherit'] });
  const until = Date.now() + 8000;
  let state = {};
  while (Date.now() < until) {
    state = await command('native', 'state', { name, timeout: 2000 });
    if (state.orientation === orientation) {
      // The turn is animated and the page is laid out again after it.
      await sleep(700);
      return command('native', 'state', { name, timeout: 2000 });
    }
    await sleep(200);
  }
  throw new Error(`the app did not turn to ${orientation} (it is ${state.orientation || 'not answering'}): see ios/rotate.m`);
}

/**
 * Terminates the app and launches it with the given environment, then waits
 * until the app answers and the page has loaded (or the extension failed).
 * Returns the native state.
 */
export async function launch(variables = {}, name = chosen()) {
  const id = udid(name);
  try { simctl('terminate', id, BUNDLE_ID); } catch { /* it was not running */ }
  const env = { ...process.env };
  for (const [key, value] of Object.entries(variables)) env[`SIMCTL_CHILD_${key}`] = String(value);
  execFileSync('xcrun', ['simctl', 'launch', id, BUNDLE_ID], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const until = Date.now() + 40000;
  let state = { error: 'the app did not answer' };
  while (Date.now() < until) {
    // A short limit and another try: the app empties the command directory
    // when it starts, so the first question may be lost.
    state = await command('native', 'state', { name, timeout: 2000 });
    if (state.failure) return state;
    if (state.url) {
      const ready = await command('js', 'return document.readyState', { name, timeout: 2000 });
      if (ready.ok === 'complete') return state;
    }
    await sleep(300);
  }
  throw new Error(`the page did not load: ${JSON.stringify(state)}`);
}

/** The last n lines of the app's debug log. */
export function log(n = 40, name = chosen()) {
  const file = join(bridge(name), 'page.log');
  return existsSync(file) ? readFileSync(file, 'utf8').trimEnd().split('\n').slice(-n).join('\n') : '';
}

/**
 * A screenshot of the device; never written into the repository by default.
 * simctl photographs the screen as the device is built, upright, so a
 * picture taken while the app is in landscape is turned to be read. And
 * it writes an alpha channel, every pixel opaque, which the App Store
 * refuses in a screenshot: the picture is written again without it
 * (ios/flatten.swift), so that one taken for the store is the store's.
 */
export async function shot(file, name = chosen()) {
  const out = resolve(file || join(process.env.KEPULI_SHOTS_DIR || join(tmpdir(), 'kepuli-ios-shots'), `${name}-${Date.now()}.png`));
  mkdirSync(dirname(out), { recursive: true });
  execFileSync('xcrun', ['simctl', 'io', udid(name), 'screenshot', out], { stdio: 'ignore' });
  // The app's own word on how it is held; without the app, as taken.
  const state = await command('native', 'state', { name, timeout: 1500 }).catch(() => ({}));
  if (state.orientation === 'landscape') execFileSync('sips', ['-r', '270', out], { stdio: 'ignore' });
  execFileSync(tool('flatten', 'flatten.swift', ['swiftc', '-O']), [out], { stdio: ['ignore', 'inherit', 'inherit'] });
  return out;
}

export function wipe(name = chosen()) {
  simctl('uninstall', udid(name), BUNDLE_ID);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [verb, ...rest] = process.argv.slice(2);
  const print = (value) => console.log(JSON.stringify(value, null, 2));
  try {
    switch (verb) {
      case 'devices': console.log(devices().join('\n')); break;
      case 'boot': for (const name of targets(rest[0] === 'all')) boot(name); break;
      case 'shutdown': for (const name of targets(rest[0] === 'all')) shutdown(name); break;
      case 'delete': for (const name of targets(rest[0] === 'all')) remove(name); break;
      case 'install': console.log((await install()) ? 'built and installed' : 'installed (the build was current)'); break;
      case 'launch': print(await launch(Object.fromEntries(rest.map((pair) => [pair.split('=')[0], pair.split('=').slice(1).join('=')])))); break;
      case 'status': print(await native('state')); break;
      case 'eval': print(await evaluate(rest.join(' '))); break;
      case 'evalfile': print(await evaluate(readFileSync(rest[0], 'utf8'), { timeout: Number(rest[1] || 60000) })); break;
      case 'native': print(await native(rest.join(' '))); break;
      case 'log': console.log(log(Number(rest[0] || 40))); break;
      case 'shot': console.log(await shot(rest[0])); break;
      case 'wipe': wipe(); break;
      default: console.error('see the comment at the top of ios/sim.mjs'); process.exit(1);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
