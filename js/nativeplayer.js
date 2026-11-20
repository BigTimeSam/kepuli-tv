// @ts-check
// The app's own player, in the app for the iPhone and the iPad: what
// AVPlayer plays by itself (HLS, and the MP4 family) is shown by the app
// in a view of its own, laid over the place of the page's picture, with
// controls that are the app's (ios/App/Player): full screen, the
// Chromecast, AirPlay and picture in picture sit in its bars, where the
// page's <video> had WebKit's controls and buttons laid over them. The
// rest (MPEG-TS with no HLS address, Matroska, a recording, the archive)
// plays in the page as before, and so does whatever the app's player
// fails on.
//
// It is the cast session's shape (js/castui.js) with the device in the
// same hand: the page lets go of the stream, hands the app an address,
// and hears where the picture has got to (`player.state`). The page stays
// the one that knows what plays; the app is told where the picture's box
// is (`player.frame`) whenever it moves, and what of the page lies over
// it: the app's view is above the page, and cuts those out of itself.
//
// In a browser, and in an app without the player, nothing here runs: the
// app says in its greeting whether it has one.

import { castMedia } from './cast.js';
import { el } from './dom.js';
import { on, send } from './host.js';
import { t } from './i18n.js';
import { renderInfoStrip } from './infostrip.js';
import { shortLanguage } from './lang.js';
import { noteEnded, notePlace, startAutoNext } from './nextepisode.js';
import { native } from './platform.js';
import { nowPlace, playback } from './playing.js';
import { playRelative, state } from './state.js';
import * as store from './config.js';
import { leavePlayback, sizePicture } from './tracksui.js';

/** Whether the app around the page has a player of its own (its greeting says). */
let offered = false;
/**
 * What the app plays for this page: the item and its spec as they were
 * started here, the number the app says back, and where the picture has
 * got to.
 * @type {{ item: any, spec: import('./playback.js').PlaySpec, id: number, position: number, duration: number | null, running: boolean, width: number, height: number } | null}
 */
let showing = null;
let nextId = 1;
/** The addresses the app's player failed on: they play in the page. */
const failed = new Set();
/** The box last said, and the timer that looks at it. */
let said = '';
/** @type {ReturnType<typeof setInterval> | null} */
let watching = null;

/**
 * What the app's player can be handed of a stream, or null: what a
 * Chromecast takes (js/cast.js), as both fetch the address by themselves
 * and play HLS and the files a browser plays natively.
 * @param {import('./playback.js').PlaySpec} spec
 */
function playable(spec) {
  if (!offered || spec.recording || spec.catchup || state.catchup || failed.has(spec.url)) return null;
  const media = castMedia(spec);
  return media && media.contentType !== 'video/webm' ? media : null;
}

/** Whether the app's player has this page's picture, so that nothing plays in the page. */
export const nativePlaying = () => Boolean(showing);

/**
 * Whether the app's picture runs, for what the page tells the Android
 * app of what is on (js/androidapp.js); null when the picture is the
 * page's, whose <video> answers.
 * @returns {boolean | null}
 */
export const nativeRunning = () => (showing ? showing.running : null);

/**
 * Where the app's picture has got to, for handing the stream on (a
 * Chromecast, another player); null when the picture is the page's.
 * @returns {{ position: number, duration: number | null } | null}
 */
export const nativePlace = () => (showing ? { position: showing.position, duration: showing.duration } : null);

/** How far apart the picture's box is asked what lies over it, in CSS pixels: closer than a toast is tall. */
const STEP = 32;

/**
 * What of the page lies over the picture's box: an open menu, a dialog, a
 * toast. The app's view is above the whole page, so the app cuts these
 * out of it, and a touch there reaches the page. Asked of the page as it
 * is drawn (`elementFromPoint` on a grid), not of a list of what may
 * open: whatever is drawn over the box is found, also what is added
 * later. Each is said with its corner's rounding; a dialog's backdrop answers as the dialog,
 * whose box it is, and the app dims the rest (`screen.shade`).
 * @param {DOMRect} box
 */
function coverings(box) {
  const found = new Map();
  // The grid, and the box's last row and column by themselves: a menu
  // that hangs from the bar under the picture lies over its last 12 px
  // only, between two of the grid's rows, and stood cut off by the
  // picture (the Android app on a phone).
  const along = (/** @type {number} */ from, /** @type {number} */ to) => {
    const at = [];
    for (let v = from + STEP / 2; v < to; v += STEP) at.push(v);
    if (to - from > 2) at.push(from + 1, to - 1);
    return at;
  };
  for (const y of along(box.top, box.bottom)) {
    for (const x of along(box.left, box.right)) {
      let layer = document.elementFromPoint(x, y);
      if (!layer || el.videowrap.contains(layer) || layer.contains(el.videowrap)) continue;
      // The box that is drawn there: the nearest one laid out of the
      // page's flow (a menu, a dialog, a toast), which is not its parent's
      // size; the bar a menu hangs from is beside the picture, the menu
      // over it. With none, the outermost that does not hold the picture.
      for (let up = layer; up && !up.contains(el.videowrap); up = up.parentElement) {
        layer = up;
        if (['absolute', 'fixed'].includes(getComputedStyle(up).position)) break;
      }
      if (found.has(layer)) continue;
      const r = layer.getBoundingClientRect();
      found.set(layer, { x: r.left - box.left, y: r.top - box.top, width: r.width, height: r.height, radius: parseFloat(getComputedStyle(layer).borderTopLeftRadius) || 0 });
    }
  }
  return [...found.values()];
}

/**
 * The shape of the app's picture, once the app has said it, for the box
 * the page gives it (js/tracksui.js sizePicture); null when the picture
 * is the page's, or not known yet.
 * @returns {{ width: number, height: number } | null}
 */
export const nativeSize = () => (showing && showing.width > 0 && showing.height > 0 ? { width: showing.width, height: showing.height } : null);

/**
 * Pause and play at the page's word (the space bar, a media key, a
 * double tap's first): true when the app's player has the picture.
 */
export function nativeToggle() {
  if (!showing) return false;
  send(showing.running ? 'player.pause' : 'player.play');
  return true;
}

/** Picture in picture from the page's menu: true when the app's player has the picture, which then takes it out or back. */
export function nativePip() {
  if (!showing) return false;
  send('player.pip');
  return true;
}

/**
 * The picture's box in the page and what lies over it, said to the app
 * when either has changed. In the document's points, not the window's:
 * the app's view lies in the web view's scroll view and moves with the
 * page.
 */
function sayFrame() {
  // The <video>'s own box, not its wrapper's: beside a second picture it
  // is the wrapper's left half (js/secondui.js).
  const box = el.video.getBoundingClientRect();
  const holes = box.width > 0 && box.height > 0 ? coverings(box) : [];
  const frame = { x: box.left + scrollX, y: box.top + scrollY, width: box.width, height: box.height };
  // The same box in the window, and how many of the screen's pixels one
  // of the page's is: the Android app's view lies over the engine's, not
  // in the page's own scrolling, and is laid out in the screen's pixels.
  const window = { left: box.left, top: box.top, ratio: devicePixelRatio };
  const now = [...Object.values(frame), ...Object.values(window), ...holes.flatMap((hole) => Object.values(hole))].map((n) => Math.round(n * 2) / 2).join(' ');
  if (now === said) return;
  said = now;
  send('player.frame', { ...frame, ...window, holes });
}

/** A press or a key may have opened or closed something over the picture: looked at when the page has drawn it. */
function soon() {
  if (!showing) return;
  requestAnimationFrame(sayFrame);
  setTimeout(sayFrame, 120);
}

/**
 * The box is looked at four times a second while the app's picture is
 * on: it moves with the window, the device's turn, full screen, the
 * panes and the page's own layout, and no one event tells of them all.
 * After a press or a key it is looked at at once, as that is when a menu
 * opens: it stood under the picture for a quarter of a second.
 */
function watch() {
  said = '';
  sayFrame();
  if (watching) return;
  watching = setInterval(sayFrame, 250);
  for (const type of ['click', 'keydown', 'toggle']) document.addEventListener(type, soon, true);
}

function unwatch() {
  if (watching) clearInterval(watching);
  watching = null;
  for (const type of ['click', 'keydown', 'toggle']) document.removeEventListener(type, soon, true);
}

/**
 * The stream handed to the app's player, if it can play it: true when it
 * was (js/playing.js startPlayback). The page lets go of its own stream
 * first, as the account commonly allows one connection.
 * @param {any} item
 * @param {import('./playback.js').PlaySpec} spec the one in state.playingSpec
 */
export function nativeOrPlay(item, spec) {
  const media = playable(spec);
  if (!media) { nativeLeft(); return false; }
  playback.stop();
  state.playbackInfoLoading = false;
  renderInfoStrip();
  el.overlay.hidden = true;
  el.overlay.classList.remove('loading');
  showing = { item, spec, id: nextId++, position: spec.startAt || 0, duration: null, running: false, width: 0, height: 0 };
  send('player.load', {
    id: showing.id, url: media.url, live: media.live, startAt: media.live ? 0 : spec.startAt || 0,
    title: el.nowTitle.textContent, subtitle: nowPlace(),
    labels: {
      full: t('screen.enter'), leave: t('screen.leave'), cast: t('cast.title'), play: t('rec.play'), pause: t('app.pause'),
      live: t('player.live'), subtitles: t('player.subs.title'), off: t('player.subs.off'), audio: t('player.audio.title'),
    },
    // The languages kept from the files before (js/tracksui.js): the app
    // picks the stream's own tracks by them.
    subtitleLang: spec.subtitleLang || 'off', audioLang: spec.audioLang || 'auto',
  });
  watch();
  return true;
}

/**
 * The app's player lets go: nothing plays any more, or the picture goes
 * elsewhere (the page's own player, a Chromecast).
 */
export function nativeLeft() {
  if (!showing) return;
  showing = null;
  unwatch();
  send('player.stop');
}

/** Whether what the app played is still what this page shows. */
const shownHere = (/** @type {NonNullable<typeof showing>} */ left) => state.playingSpec === left.spec;

/**
 * Every word from the app about its picture.
 * @param {Record<string, any>} word
 */
function heard(word) {
  if (!showing || word.id !== showing.id) return;
  const { item, spec } = showing;
  if (word.state !== 'idle') {
    showing.running = word.state === 'playing';
    showing.duration = word.duration ?? null;
    if (word.width > 0 && word.height > 0 && (word.width !== showing.width || word.height !== showing.height)) {
      showing.width = word.width;
      showing.height = word.height;
      sizePicture();
    }
    // The place only from a picture that runs or has got somewhere: one
    // still loading says zero (js/castui.js notePosition).
    if (word.position > 0 || ['playing', 'paused'].includes(word.state)) showing.position = word.position;
    if (item.k !== 0 && showing.duration) notePlace(item, showing.position, showing.duration);
    return;
  }
  const left = showing;
  showing = null;
  unwatch();
  if (word.reason === 'error') {
    // The page's own player takes it, from where the app's had got to;
    // the address is not handed to the app again.
    failed.add(spec.url);
    if (!shownHere(left)) return;
    // Where the app says it stopped; else the place last heard, up to two seconds older.
    if (!spec.live) spec.startAt = Math.floor((word.position > 0 ? word.position : left.position) || 0);
    playback.play(spec);
    return;
  }
  if (word.reason !== 'finished') return;
  if (item.k !== 0) noteEnded(item);
  if (!shownHere(left)) return;
  // An episode seen to its end is followed by the next, as one that
  // ended in the page is: the picture's own `ended` never comes.
  const next = item.k === 3 && state.settings.autoNext && !state.catchup;
  Promise.resolve(next && startAutoNext(item, leavePlayback)).then((counting) => { if (!counting && shownHere(left)) leavePlayback(); });
}

/**
 * The viewer chose a track in the app's menu: the language is kept for
 * the coming films and episodes, as the page's own selectors keep it. A
 * track whose language the stream does not state answers no choice in
 * the next one, so the setting is left as it was.
 * @param {Record<string, any>} word
 */
async function choseTrack(word) {
  if (!showing || word.id !== showing.id) return;
  const language = word.language ? shortLanguage(word.language) : 'off';
  if (language === 'und') return;
  const key = word.kind === 'audio' ? 'audioLang' : 'subtitleLang';
  if (word.kind === 'audio' && language === 'off') return;
  if (state.settings[key] === language) return;
  state.settings = await store.saveSettings({ [key]: language });
}

if (native) {
  // Either app (the iPhone's and the iPad's, Android's on a phone or a
  // tablet) may have a player and says so in its greeting.
  // The lock screen's and the headphones' next and previous, which the app hears for its own picture.
  on('player.command', (word) => { if (showing && word.id === showing.id) playRelative(word.what === 'previous' ? -1 : 1); });
  on('player.track', choseTrack);
  on('host', (host) => { offered = Boolean(host.player); });
  on('player.state', heard);
}
