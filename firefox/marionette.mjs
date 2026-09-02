// Marionette: Firefox's own remote protocol, spoken with node:net alone.
//
// This is to Firefox what dev/screenshot.mjs's DevTools session is to
// Chrome: a way to start the browser with a profile of its own, load the
// extension without clicking, open the player and run a line of JavaScript
// in it. Firefox has no --load-extension either; the equivalent is
// Marionette's Addon:Install with temporary: true, which is the same thing
// about:debugging's "Load Temporary Add-on" does.
//
// The protocol is small. Firefox is started with -marionette and listens on
// marionette.port. Every message on the socket is `length:json`; the server
// greets with {applicationType, marionetteProtocol}, a command is
// [0, id, name, params] and the reply [1, id, error, result]. One client at
// a time, one session per connection: the session ends when the socket
// closes.
//
// Nothing is installed for this: web-ext would do the same job but pulls a
// dependency tree through npx, and the project's development tools have
// none.

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { connect as tcpConnect } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const PORT = Number(process.env.KEPULI_FIREFOX_PORT || 2828);
export const PROFILE = process.env.KEPULI_FIREFOX_PROFILE || join(homedir(), '.cache', 'kepuli-tv-firefox');

const FIREFOXES = [
  '/Applications/Firefox.app/Contents/MacOS/firefox',
  '/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox',
  '/Applications/Firefox Nightly.app/Contents/MacOS/firefox',
  '/usr/bin/firefox',
  '/usr/bin/firefox-esr',
  '/snap/bin/firefox',
];

// The profile's user.js. Marionette's port, no first-run pages, and the
// autoplay policy relaxed: the player starts playback from a click, but the
// development scripts click by script, which no policy counts as a gesture
// — the same reason dev/store-screenshots.mjs gives Chrome
// --autoplay-policy=no-user-gesture-required.
const PREFS = {
  'marionette.port': PORT,
  'browser.shell.checkDefaultBrowser': false,
  'browser.startup.homepage_override.mstone': 'ignore',
  'browser.aboutwelcome.enabled': false,
  'datareporting.policy.dataSubmissionPolicyBypassNotification': true,
  'toolkit.telemetry.reportingpolicy.firstRun': false,
  'browser.sessionstore.resume_from_crash': false,
  'media.autoplay.default': 0,
  'media.autoplay.blocking_policy': 0,
  // Reloading the add-on closes its tab. If that was the last tab the window
  // would go with it, and Marionette cannot open a session in a Firefox
  // without a window — measured. So the window stays.
  'browser.tabs.closeWindowWithLastTab': false,
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------------------------------- client */

export class Marionette {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.pending = new Map();
    this.next = 1;
    this.hello = null;
    socket.on('data', (chunk) => this.feed(chunk));
    socket.on('close', () => {
      for (const p of this.pending.values()) p.reject(new Error(`${p.name}: connection closed`));
      this.pending.clear();
    });
  }

  feed(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const colon = this.buffer.indexOf(0x3a);
      if (colon < 0) return;
      const prefix = this.buffer.subarray(0, colon).toString();
      const length = Number(prefix);
      if (!/^\d+$/.test(prefix)) return this.fail(new Error(`framing lost: ${JSON.stringify(prefix.slice(0, 40))}`));
      if (this.buffer.length < colon + 1 + length) return;
      const text = this.buffer.subarray(colon + 1, colon + 1 + length).toString();
      this.buffer = this.buffer.subarray(colon + 1 + length);
      let payload;
      try { payload = JSON.parse(text); } catch (err) { return this.fail(new Error(`bad message: ${err.message}: ${text.slice(0, 80)}`)); }
      this.receive(payload);
    }
  }

  /** A broken stream fails every waiting call rather than the process. */
  fail(err) {
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
    this.socket.destroy();
  }

  receive(payload) {
    if (!Array.isArray(payload)) { if (this.onHello) this.onHello(payload); return; }
    const [type, id, error, result] = payload;
    if (type !== 1) return;
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    if (error) p.reject(new Error(`${p.name}: ${error.error}: ${error.message}`));
    else p.resolve(result);
  }

  /** One command; resolves with the result body. */
  call(name, params = {}, timeoutMs = 30000) {
    const id = this.next++;
    const message = JSON.stringify([0, id, name, params]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${name}: no answer in ${timeoutMs / 1000} s`)); }, timeoutMs);
      this.pending.set(id, {
        name,
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.socket.write(`${Buffer.byteLength(message)}:${message}`);
    });
  }

  close() { this.socket.destroy(); }

  /* ----------------------------------------------- what the tools need */

  /** Runs a script in the page; a returned promise is awaited. */
  async evaluate(script, args = []) {
    const result = await this.call('WebDriver:ExecuteScript', { script, args });
    return result.value;
  }

  /** The same in Firefox's own (chrome) context, where the add-on manager lives. */
  async privileged(script, args = []) {
    await this.call('Marionette:SetContext', { value: 'chrome' });
    try {
      return await this.evaluate(script, args);
    } finally {
      await this.call('Marionette:SetContext', { value: 'content' });
    }
  }

  /** Loads the extension from a directory the way about:debugging does. Returns its id. */
  async installTemporary(path) {
    const result = await this.call('Addon:Install', { path, temporary: true });
    return result.value;
  }

  uninstall(id) { return this.call('Addon:Uninstall', { id }); }

  /**
   * moz-extension://<uuid>/<file>. The uuid is per profile and per install
   * and is known only to the browser, so it is asked for.
   */
  extensionUrl(id, file) {
    return this.privileged(`
      const policy = WebExtensionPolicy.getByID(arguments[0]);
      if (!policy) throw new Error('no extension with id ' + arguments[0]);
      return policy.getURL(arguments[1]);
    `, [id, file]);
  }

  navigate(url) { return this.call('WebDriver:Navigate', { url }); }
  currentUrl() { return this.call('WebDriver:GetCurrentURL').then((r) => r.value); }
  refresh() { return this.call('WebDriver:Refresh'); }

  /**
   * A tab to work in. Reloading the add-on closes its pages, and with them
   * the tab the session was pointed at — "no such window" from then on. So
   * the session is pointed at whatever tab is left, or at a new window if
   * none is, before the next navigation.
   */
  async ensureWindow() {
    let handles = (await this.call('WebDriver:GetWindowHandles')) || [];
    if (Array.isArray(handles.value)) handles = handles.value;
    if (!handles.length) {
      const made = await this.call('WebDriver:NewWindow', { type: 'window' });
      handles = [made.handle];
    }
    await this.call('WebDriver:SwitchToWindow', { handle: handles[0] });
  }
}

/* -------------------------------------------------------------- Firefox */

/** Opens the socket and waits for the greeting. */
export function connect(port = PORT, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const socket = tcpConnect({ host: '127.0.0.1', port });
    const client = new Marionette(socket);
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('Marionette did not greet')); }, timeoutMs);
    client.onHello = (hello) => { clearTimeout(timer); client.hello = hello; resolve(client); };
    socket.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

export async function isRunning(port = PORT) {
  try {
    const client = await connect(port, 1500);
    client.close();
    return true;
  } catch {
    return false;
  }
}

export function writeProfile() {
  mkdirSync(PROFILE, { recursive: true });
  const lines = Object.entries(PREFS).map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`);
  writeFileSync(join(PROFILE, 'user.js'), lines.join('\n') + '\n');
}

/** Starts Firefox with the development profile unless one already answers. */
export async function ensureFirefox() {
  if (await isRunning()) return false;
  const binary = process.env.KEPULI_FIREFOX || FIREFOXES.find(existsSync);
  if (!binary) throw new Error('Firefox not found; set KEPULI_FIREFOX to the binary.');
  writeProfile();
  // -no-remote keeps this apart from a Firefox the user has open with their
  // own profile; -marionette is what opens the port; and the chrome context
  // (where WebExtensionPolicy answers the add-on's URL) is refused unless
  // system access is allowed on the command line — measured on 154.
  spawn(binary, ['-marionette', '-remote-allow-system-access', '-no-remote', '-profile', PROFILE, 'about:blank'],
        { detached: true, stdio: 'ignore' }).unref();
  for (let i = 0; i < 120; i++) { if (await isRunning()) return true; await sleep(250); }
  throw new Error('Firefox did not answer within 30 seconds.');
}

/**
 * A connection with a WebDriver session on it.
 *
 * A Firefox left without a window — its last tab closed — answers on the
 * port but cannot open a session ("window is null"). Then it is quit and
 * started again, once; the profile keeps its storage across that.
 */
export async function session() {
  let client = await connect();
  try {
    await client.call('WebDriver:NewSession', {});
    return client;
  } catch (err) {
    if (!/window is null/.test(err.message)) throw err;
    client.close();
    await quit();
    await ensureFirefox();
    client = await connect();
    await client.call('WebDriver:NewSession', {});
    return client;
  }
}

/** Quits the development Firefox: over Marionette, or failing that by profile path. */
export async function quit() {
  try {
    const client = await connect(PORT, 1500);
    await client.call('Marionette:Quit', { flags: ['eForceQuit'] }, 5000).catch(() => {});
    client.close();
  } catch { /* nothing on the port */ }
  for (let i = 0; i < 20 && await isRunning(); i++) {
    if (i === 8) { try { execFileSync('pkill', ['-f', PROFILE]); } catch { /* not there */ } }
    await sleep(500);
  }
}
