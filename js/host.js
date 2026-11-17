// @ts-check
// The app around the page, where there is one: the Android app on a phone
// or a tablet shows this same page in a view of its own (android/) and
// answers, in native code, what no page can do there: the Chromecast
// sender (js/cast.js, js/castui.js), and what js/remote.js tells it and
// hears of it (the small window, the notification's buttons).
//
// The page is told by its address, player.html?app=1 (js/caret.js), as a
// test can then open the same page in a desktop browser.
//
// One port carries everything, opened by the page. A message with a type
// is { type, id?, ...fields } both ways; the answer to one sent with an id
// is { re: id, ok, error?, ...fields }. What the app says unasked (the
// cast session's state) arrives by its type, and the last of each type is
// kept, so that a module that starts listening late still hears where
// things stand. The words without a type are js/remote.js's own, older
// than these, and it reads them off the same port (appPort).

import { api } from './browser.js';
import { inApp } from './caret.js';

/** The name the Android app answers to (PlayerActivity, LINE). */
const APPLICATION = 'kepuli';

/**
 * Whether an app with a Chromecast sender of its own is around the page.
 * False in Node, where the tests import this.
 */
export const native = inApp;

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

/**
 * The port itself, for the words that have no type (js/remote.js), or null
 * in a browser.
 * @returns {Port | null}
 */
export const appPort = () => port;

if (inApp) {
  // A browser asked to open player.html?app=1 (the tests) has no native
  // application to connect to, or no such function at all.
  try {
    if (typeof api?.runtime?.connectNative === 'function') attach(api.runtime.connectNative(APPLICATION));
  } catch (err) {
    console.warn('[iptv] the app did not answer the page:', err && /** @type {Error} */ (err).message);
  }
}
