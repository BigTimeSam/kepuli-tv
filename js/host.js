// @ts-check
// The app around the page, where there is one. Kepuli-TV for the iPhone and
// the iPad (ios/) and the Android app on a phone or a tablet (android/)
// show this same page in a view of their own and answer, in native code,
// what a browser would have answered or what no page can do there: the
// Chromecast sender (js/cast.js, js/castui.js) in both; on the iPhone and
// the iPad the screen kept on and reminders as the system's
// notifications; on Android what js/remote.js tells the app and hears of
// it (the small window, the notification's buttons).
//
// The page is told by its address, player.html?ios=1 or player.html?app=1
// (js/caret.js), read once, as a test can then open the same page in a
// desktop browser. It is not told by sniffing: another WebKit browser that
// runs extensions (Orion) would pass any test of the engine or of the
// address's scheme, and is not the app.
//
// One port carries everything, opened by the page. A message with a type
// is { type, id?, ...fields } both ways; the answer to one sent with an id
// is { re: id, ok, error?, ...fields }. What the app says unasked (the cast
// session's state, a reminder's notification tapped) arrives by its type,
// and the last of each type is kept, so that a module that starts
// listening late still hears where things stand. The words without a type
// are js/remote.js's own on Android, older than these, and it reads them
// off the same port (appPort).

import { api } from './browser.js';
import { inApp } from './caret.js';

/** Whether the page runs in the app for the iPhone and the iPad. False in Node, where the tests import this. */
export const ios = typeof location !== 'undefined' && typeof document !== 'undefined'
  && new URLSearchParams(location.search).get('ios') === '1';

/**
 * Whether an app with a Chromecast sender of its own is around the page:
 * the iPhone's and the iPad's, or Android's on a phone or a tablet.
 */
export const native = ios || inApp;

/** The name each app's bridge answers to (ios/App/Bridge.swift; PlayerActivity's LINE). */
const APPLICATION = ios ? 'io.github.bigtimesam.kepulitv' : 'kepuli';

/**
 * What the iPhone's and the iPad's app said of itself when the page
 * connected (`idiom`, `version`, `build`, `debug`, `simulator`), or null
 * before it has, and on Android.
 * @type {Record<string, any> | null}
 */
export let host = null;

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
  if (type === 'host') host = fields;
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

/**
 * The reminders still ahead, as the app schedules them: each a
 * notification `ahead` of its programme's start, named by the reminder's
 * key. One whose moment has passed is left out: the page's list still
 * holds a reminder that fell due while the app was closed, and the app
 * cannot schedule into the past.
 * @template {{ start: number, channel: object }} R
 * @param {[string, R][]} entries the reminders by key
 * @param {number} ahead milliseconds before the start
 * @param {number} now
 * @param {(reminder: R) => string} say the notification's sentence
 */
export function reminderItems(entries, ahead, now, say) {
  return entries.filter(([, r]) => r.start - ahead > now)
    .map(([id, r]) => ({ id, at: r.start - ahead, text: say(r), channel: r.channel }));
}

/**
 * Whether a pause of the picture was WebKit's, for the app leaving the
 * front, and not the viewer's. WebKit pauses every picture nobody sees
 * and says nothing of why; measured on iOS 26.5 the pause came 0.4 s
 * before the page was told it is hidden, so either order within a second
 * and a half counts. A press or a key in the half second before the pause
 * makes it the viewer's own: a finger on Pause, or on a link that took the
 * viewer to another app (Open in VLC), after which nothing should sound.
 * @param {number} pausedAt when the picture paused (ms, one clock for all three)
 * @param {number} hiddenAt when the page was last hidden
 * @param {number} touchedAt when a press or a key last ended
 */
export function pausedByLeaving(pausedAt, hiddenAt, touchedAt) {
  return Math.abs(hiddenAt - pausedAt) < 1500 && !(touchedAt <= pausedAt && pausedAt - touchedAt < 500);
}

if (native) {
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

if (ios) {
  // The stylesheets hide under .ios what the app cannot answer or does not
  // offer (css/last.css).
  document.documentElement.classList.add('ios');
  // A field being typed into stays in sight when the window changes under
  // it. WebKit brings a field above the keyboard when it takes the focus,
  // and not when the device is turned with the keyboard up: the field was
  // then behind the keyboard, at 307 px in a window of which 174 showed
  // (measured). Once the window has settled the field is asked into view,
  // and what its own scrolling boxes cannot give the page itself scrolls,
  // as it does at WebKit's bidding while a keyboard is up.
  //
  // An iPhone's window, and a lying iPad's, shrinks to what the keyboard
  // leaves, and a dialog follows it. An upright iPad's keeps its height
  // with the keyboard over its lower third: a dialog stayed centred in
  // the whole window, its Connect and Cancel under the keys (innerHeight
  // 1128, 811 of it in sight; measured). There the page is told what is
  // in sight (html.kb, --vvh and --vvt), and a dialog keeps to that
  // (css/dialogs.css). At once, before the settled look below. Not while
  // the page is enlarged by two fingers, which shrinks the same measure.
  // An iPhone's window does either (measured: innerHeight 778 with 436
  // in sight, and 456 once WebKit had scrolled the page to a field), so
  // a keyboard is also what is in sight being less than it has been at
  // this width.
  const viewport = window.visualViewport, root = document.documentElement;
  /** @type {Map<number, number>} */
  const whole = new Map();
  const keyboard = () => {
    if (!viewport) return;
    const width = Math.round(viewport.width), kept = innerHeight - viewport.height > 120;
    whole.set(width, Math.max(whole.get(width) || 0, viewport.height));
    const up = viewport.scale < 1.01 && (kept || (whole.get(width) || 0) - viewport.height > 120);
    root.classList.toggle('kb', up);
    // With the height for it, a dialog's buttons stay in sight (css/dialogs.css).
    root.classList.toggle('kb-tall', up && viewport.height >= 300);
    const say = (/** @type {string} */ name, /** @type {number} */ value) => {
      if (up) root.style.setProperty(name, `${Math.round(value)}px`); else root.style.removeProperty(name);
    };
    say('--vvh', viewport.height);
    say('--vvt', kept ? viewport.offsetTop : 0);
  };
  keyboard();
  viewport?.addEventListener('scroll', keyboard);
  // The page itself never scrolls (css/player.css); WebKit scrolls it to
  // a field under the keyboard. Scrolled past a field at the window's top
  // (the search, while the guide was open on a phone lying down), it left
  // the field being typed into out of sight above it.
  addEventListener('scroll', () => {
    const field = document.activeElement;
    if (scrollY > 0 && field instanceof HTMLElement && field.matches('input, textarea') && field.getBoundingClientRect().top < 0) scrollTo(0, 0);
  }, { passive: true });
  let settled = 0;
  viewport?.addEventListener('resize', () => {
    keyboard();
    clearTimeout(settled);
    settled = window.setTimeout(() => {
      const field = document.activeElement, room = window.visualViewport?.height || innerHeight;
      if (!(field instanceof HTMLElement) || !field.matches('input, textarea, select')) return;
      const hidden = () => { const box = field.getBoundingClientRect(); return box.top < 0 || box.bottom > room ? box.top - Math.max(8, (room - box.height) / 2) : 0; };
      if (hidden()) field.scrollIntoView({ block: 'center' });
      if (hidden()) window.scrollBy(0, hidden());
    }, 300);
  });
  // A press on a dialog's button while one of its fields has the keyboard
  // up. WebKit moves the focus from the field to the dialog as the finger
  // lifts, the keyboard goes, the window grows and the dialog moves with
  // it, and the click that should follow is never made: Connect, the
  // first button anyone presses, only closed the keyboard (seen with real
  // touches: pointerup on the button, focusout 2 ms later, no click). So
  // a finger lifted where it came down on something to press is that
  // press, made here; the field keeps the focus and the keyboard stays,
  // as under the password's eye it should.
  /** @type {{ target: EventTarget | null, x: number, y: number } | null} */
  let down = null;
  document.addEventListener('touchstart', (event) => {
    const touch = event.touches.length === 1 ? event.touches[0] : null;
    down = touch && { target: event.target, x: touch.clientX, y: touch.clientY };
  }, { capture: true, passive: true });
  document.addEventListener('touchend', (event) => {
    const began = down, touch = event.changedTouches[0], field = document.activeElement;
    down = null;
    if (!began || began.target !== event.target || !event.cancelable || Math.hypot(touch.clientX - began.x, touch.clientY - began.y) > 10) return;
    if (!(field instanceof HTMLElement) || !field.matches('input:not([type="radio"], [type="checkbox"], [type="range"], [type="file"]), textarea')) return;
    // Another field, or a picker, takes the focus as ever; a choice or a
    // switch is pressed by its label or by itself.
    const CHOICE = 'input[type="radio"], input[type="checkbox"]';
    const hit = event.target instanceof Element ? event.target.closest('button, a[href], summary, label, input, select, textarea') : null;
    const pressed = hit?.matches(`button, a[href], summary, ${CHOICE}`) || (hit?.matches('label') && hit.querySelector(CHOICE)) ? hit : null;
    if (!(pressed instanceof HTMLElement) || !pressed.closest('dialog[open]')) return;
    event.preventDefault();
    pressed.click();
  }, { capture: true, passive: false });
  // A modal dialog dims the page behind it, and the strips around the web
  // view (the status bar's, the home indicator's) are the app's to dim:
  // it is told the backdrop's colour while a dialog is open, and null with
  // none. One watch for every dialog, and for the theme, which changes
  // the colour. A dialog opened over another (Filter countries over
  // Settings) lays its backdrop over the first one's.
  // `open` says the dialog itself: under one the page's message strip is
  // dimmed and cannot be pressed, so a reminder that falls due then is the
  // app's to show, as a banner; it was lost in the strip.
  let shade = '0 null';
  new MutationObserver(() => {
    const dialogs = document.querySelectorAll('dialog:modal');
    const rgba = dialogs.length ? (getComputedStyle(dialogs[0], '::backdrop').backgroundColor.match(/[\d.]+/g) || []).map(Number) : null;
    // Opaque when the colour names three numbers.
    if (rgba && rgba.length === 3) rgba.push(1);
    if (rgba && rgba.length === 4) rgba[3] = 1 - (1 - rgba[3]) ** dialogs.length;
    if (`${dialogs.length} ${rgba}` === shade) return;
    shade = `${dialogs.length} ${rgba}`;
    send('screen.shade', { rgba: rgba && rgba.length === 4 ? rgba : null, open: dialogs.length > 0 });
  }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['open', 'data-theme'] });
}
