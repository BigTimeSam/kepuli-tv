// @ts-check
// The line between the page and the app around it, where there is one
// (js/platform.js): Kepuli-TV for the iPhone and the iPad (ios/) and the
// Android app on a phone or a tablet (android/) show this same page in a
// view of their own and answer, in native code, what a browser would have
// answered or what no page can do there.
//
// One port carries everything, opened by the page. A message with a type
// is { type, id?, ...fields } both ways; the answer to one sent with an id
// is { re: id, ok, error?, ...fields }. What the app says unasked (the cast
// session's state, a reminder's notification tapped) arrives by its type,
// and the last of each type is kept, so that a module that starts
// listening late still hears where things stand.
//
// What the page does with the line is elsewhere: the cast session in
// js/cast.js and js/castui.js for both apps, the rest in js/iosapp.js and
// js/androidapp.js.

import { api } from './browser.js';
import { ios, native, remote } from './platform.js';

/** The name each app's bridge answers to (ios/App/Bridge.swift; PlayerActivity's LINE). */
const APPLICATION = ios ? 'io.github.bigtimesam.kepulitv' : 'kepuli';

/** @typedef {{ postMessage: (message: object) => void, onMessage: { addListener: (listener: (message: any) => void) => void }, onDisconnect: { addListener: (listener: () => void) => void } }} Port */

/** @type {Port | null} */
let port = null;
let nextId = 1;
/** @type {Map<number, { resolve: (fields: Record<string, any>) => void, reject: (err: Error) => void, timer: ReturnType<typeof setTimeout> }>} */
const pending = new Map();
/** @type {Map<string, Set<(fields: Record<string, any>) => void>>} */
const listeners = new Map();
/** @type {Map<string, Record<string, any>>} */
const last = new Map();

/** Every request still waiting has lost the port its answer would come by. */
function failPending() {
  for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(new Error('disconnected')); }
  pending.clear();
}

/** @param {any} message */
function receive(message) {
  if (!message || typeof message !== 'object') return;
  if (typeof message.re === 'number') {
    const waiting = pending.get(message.re);
    if (!waiting) return;   // answered after its time ran out
    pending.delete(message.re);
    clearTimeout(waiting.timer);
    const { re, ok, error, ...fields } = message;
    if (ok) waiting.resolve(fields); else waiting.reject(new Error(error || 'failed'));
    return;
  }
  if (typeof message.type !== 'string') return;
  const { type, ...fields } = message;
  last.set(type, fields);
  for (const listener of [...(listeners.get(type) || [])]) listener(fields);
}

/**
 * The port to the app, in place of any earlier one. The page attaches the
 * real one below; a test hands a fake of the same shape to this same
 * module instance, so the shipped code carries no hook for it.
 * @param {Port} next
 */
export function attach(next) {
  failPending();
  port = next;
  next.onMessage.addListener((message) => { if (port === next) receive(message); });
  next.onDisconnect.addListener(() => { if (port === next) { port = null; failPending(); } });
}

/**
 * Says something to the app that needs no answer. Nothing without a port:
 * in a browser, and in the app before the page has connected.
 * @param {string} type
 * @param {Record<string, any>} [fields]
 */
export function send(type, fields = {}) {
  port?.postMessage({ type, ...fields });
}

/**
 * Asks the app and waits for its answer: the answer's fields, or a
 * rejection when the app said no (`ok: false`, the message its `error`),
 * when there is no port, or when nothing came in time.
 * @param {string} type
 * @param {Record<string, any>} [fields]
 * @param {number} [timeout] milliseconds
 * @returns {Promise<Record<string, any>>}
 */
export function request(type, fields = {}, timeout = 10000) {
  const to = port;
  if (!to) return Promise.reject(new Error('no port'));
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('timeout')); }, timeout);
    pending.set(id, { resolve, reject, timer });
    to.postMessage({ type, id, ...fields });
  });
}

/**
 * Listens to what the app says unasked. The last event of the type, if
 * one has come, is given at once: the app says its state when the page
 * connects, which may be before the module that wants it has loaded.
 * @param {string} type
 * @param {(fields: Record<string, any>) => void} listener
 * @returns {() => void} stops listening
 */
export function on(type, listener) {
  let set = listeners.get(type);
  if (!set) listeners.set(type, set = new Set());
  set.add(listener);
  const kept = last.get(type);
  if (kept) listener(kept);
  return () => { set.delete(listener); };
}

// A television's app is on the line for its own player alone
// (js/nativeplayer.js); the rest of what the apps answer is not asked there.
if (native || remote) {
  // A browser asked to open player.html?ios=1 or ?app=1 (the tests) has no
  // native application to connect to, or no such function at all.
  try {
    if (typeof api?.runtime?.connectNative === 'function') {
      attach(api.runtime.connectNative(APPLICATION));
      // Said at once to the iPhone's and the iPad's app, and nothing
      // answers it: the app can only tell that the page hears it from the
      // page's first word (WebKit drops what is sent to a port before its
      // listener is in), and says who it is and how the cast session
      // stands when it has heard one. Left to the first module with
      // something to say, that came half a second late.
      if (ios) send('hello');
    }
  } catch (err) {
    console.warn('[iptv] the app did not answer the page:', err && /** @type {Error} */ (err).message);
  }
}
