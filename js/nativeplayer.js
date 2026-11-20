// @ts-check
// The app's own player, in the app for the iPhone and the iPad and in the
// Android apps (Media3's ExoPlayer there, android/…/NativePlayer.java):
// what the app's player plays by itself (HLS, and the MP4 family) is
// shown by the app in a view of its own, laid over the place of the
// page's picture, with controls that are the app's (ios/App/Player,
// android/…/PlayerControls.java): full screen, the
// Chromecast, AirPlay and picture in picture sit in its bars, where the
// page's <video> had WebKit's controls and buttons laid over them. The
// rest (MPEG-TS with no HLS address, Matroska, a recording, the archive)
// plays in the page as before, and so does whatever the app's player
// fails on: under the same controls, which the app then lays over the
// page's own picture with nothing of its own beneath them. The page says
// where its picture is (`player.page`) and does what the controls ask
// (`player.command`), so the viewer has one player whichever of the two
// plays.
//
// It is the cast session's shape (js/castui.js) with the device in the
// same hand: the page lets go of the stream, hands the app an address,
// and hears where the picture has got to (`player.state`). The page stays
// the one that knows what plays; the app is told where the picture's box
// is (`player.frame`) whenever it moves, and what of the page lies over
// it: the app's view is above the page, and cuts those out of itself.
//
// On a television the app has the picture and nothing else: the remote
// drives the page (js/remote.js), whose own marks over the picture (the
// channel's banner, the bar of a seek, a wait or a failure) are said to
// the app as holes in its view, and what the app cannot play is the
// page's as it always was.
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
import { ios, native, remote } from './platform.js';
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
 * `page` when the picture is the page's own and the app has only its
 * controls over it.
 * @type {{ item: any, spec: import('./playback.js').PlaySpec, id: number, page: boolean, position: number, duration: number | null, running: boolean, width: number, height: number } | null}
 */
let showing = null;
/** What the app's player itself plays, or null: also while its controls lie over the page's picture. */
const held = () => (showing && !showing.page ? showing : null);
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
export const nativePlaying = () => Boolean(held());

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
export const nativePlace = () => { const now = held(); return now ? { position: now.position, duration: now.duration } : null; };

/**
 * The app's picture taken to a second of its length, at the remote's
 * word (js/remote.js): true when the app's player has the picture.
 * @param {number} to
 */
export function nativeSeek(to) {
  const now = held();
  if (!now) return false;
  now.position = to;
  send('player.seek', { to });
  return true;
}

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
 * What the page itself draws inside the picture on a television: the
 * channel's banner, the bar of a seek, a wait or a failure. With a touch
 * screen these are the app's controls' to say; under a remote the page
 * says them, under the app's view, which is cut open where they are.
 * @param {DOMRect} box
 */
function marks(box) {
  if (!remote) return [];
  return [...el.videowrap.querySelectorAll('#zap, #scrub, #overlay')].filter((mark) => !(/** @type {HTMLElement} */ (mark)).hidden && mark.getClientRects().length).map((mark) => {
    const r = mark.getBoundingClientRect();
    return { x: r.left - box.left, y: r.top - box.top, width: r.width, height: r.height, radius: 0 };
  });
}

/**
 * The shape of the app's picture, once the app has said it, for the box
 * the page gives it (js/tracksui.js sizePicture); null when the picture
 * is the page's, or not known yet.
 * @returns {{ width: number, height: number } | null}
 */
export const nativeSize = () => { const now = held(); return now && now.width > 0 && now.height > 0 ? { width: now.width, height: now.height } : null; };

/**
 * Pause and play at the page's word (the space bar, a media key, a
 * double tap's first): true when the app's player has the picture.
 */
export function nativeToggle() {
  const now = held();
  if (!now) return false;
  send(now.running ? 'player.pause' : 'player.play');
  return true;
}

/** Picture in picture from the page's menu: true when the app's player has the picture, which then takes it out or back. */
export function nativePip() {
  if (!held()) return false;
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
  // Over the page's own picture the controls give way to whatever the
  // page says in its place (a wait with its Cancel, a failure and its
  // buttons, the next episode's count), which lies under them and could
  // not be pressed: "Buffering…" kept the controls over it, and its Cancel
  // did nothing under a finger.
  const away = showing?.page && (!el.overlay.hidden || el.video.ended);
  const holes = box.width > 0 && box.height > 0 && !away ? [...coverings(box), ...marks(box)] : [];
  const frame = { x: box.left + scrollX, y: box.top + scrollY, width: away ? 0 : box.width, height: away ? 0 : box.height };
  // The same box in the window, and how many of the screen's pixels one
  // of the page's is: the Android app's view lies over the engine's, not
  // in the page's own scrolling, and is laid out in the screen's pixels.
  // And whether the picture fills the screen, which the Android app's
  // controls show (the iPhone's app makes its full screen itself).
  const window = { left: box.left, top: box.top, ratio: devicePixelRatio, full: Boolean(document.fullscreenElement) };
  const now = [...Object.values(frame), ...Object.values(window), ...holes.flatMap((hole) => Object.values(hole))].map((n) => Math.round(Number(n) * 2) / 2).join(' ');
  if (now === said) return;
  said = now;
  send('player.frame', { ...frame, ...window, holes });
}

/** A press or a key may have opened or closed something over the picture: looked at when the page has drawn it. */
function soon() {
  if (!showing && !beside) return;
  requestAnimationFrame(sayFrames);
  setTimeout(sayFrames, 120);
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
  saidBeside = '';
  sayFrames();
  if (watching) return;
  watching = setInterval(sayFrames, 250);
  for (const type of ['click', 'keydown', 'toggle']) document.addEventListener(type, soon, true);
}

/** Both pictures' boxes, each said when it has changed. */
function sayFrames() {
  if (showing) sayFrame();
  if (beside) sayFrameBeside();
}

function unwatch() {
  // One of the two pictures still has the app's player over it.
  if (showing || beside) return;
  if (watching) clearInterval(watching);
  watching = null;
  for (const type of ['click', 'keydown', 'toggle']) document.removeEventListener(type, soon, true);
}

/** The words of the app's controls, in the viewer's language. */
const labels = () => ({
  full: t('screen.enter'), leave: t('screen.leave'), cast: t('cast.title'), play: t('rec.play'), pause: t('app.pause'),
  live: t('player.live'), subtitles: t('player.subs.title'), off: t('player.subs.off'), audio: t('player.audio.title'),
});

/**
 * The page plays this itself: the app lays its controls over the page's
 * picture, and WebKit's own are taken off it. Said before the page's
 * player starts, so that the first thing in sight is the player the
 * viewer knows.
 * @param {any} item
 * @param {import('./playback.js').PlaySpec} spec
 */
function underControls(item, spec) {
  // Not on a television: the page's picture has the remote's own marks.
  if (!offered || remote) return;
  showing = { item, spec, id: nextId++, page: true, position: 0, duration: null, running: false, width: 0, height: 0 };
  el.video.controls = false;
  el.videowrap.classList.add('appbars');
  send('player.load', { id: showing.id, page: true, live: Boolean(spec.live), title: el.nowTitle.textContent, subtitle: nowPlace(), labels: labels() });
  watch();
  sayPictureSound();
}

/** Where the page's own picture is, said to the app's controls over it. */
function sayPage() {
  if (!showing?.page) return;
  const { paused, readyState, currentTime, duration } = el.video;
  send('player.page', {
    id: showing.id, state: paused ? 'paused' : readyState < 3 ? 'loading' : 'playing', position: currentTime || 0,
    ...(Number.isFinite(duration) && duration > 0 ? { duration } : {}),
  });
}

/* ------------------------------------------------- the second picture */

// The second of two pictures side by side (js/secondui.js) has the app's
// player too, its second slot: a channel the app can play (HLS) plays in
// a view of the app's over the second picture's box, and one it cannot
// plays in the page's second <video> under the same controls. The first
// picture had the app's controls and the second WebKit's, two players in
// one box. The second's bar is the app's as well: its speaker, its swap
// and its close come back as words (player.command), and the page does
// them, as it knows both pictures. The sound is from one picture at a
// time, and the page says which (player.sound).

const video2 = /** @type {HTMLVideoElement} */ (document.getElementById('video2'));
const pane2 = /** @type {HTMLElement} */ (document.getElementById('second'));
/**
 * What the app shows for the second picture: the number it says back,
 * its spec, and `page` when the picture is the page's own.
 * @type {{ id: number, spec: any, page: boolean } | null}
 */
let beside = null;
let saidBeside = '';
/**
 * What js/secondui.js does at the app's word: a picture it must play
 * itself, and a press of the bar. A `var` with no value given here: that
 * module and this one load in a circle, and it hands these over before
 * this line is reached, where a `let` would not exist yet and the whole
 * page stopped at its start.
 * @type {{ fail: (spec: any) => void, command: (what: string, slot: number) => void } | undefined}
 */
// eslint-disable-next-line no-var
var side;
export function onSecondPicture(handlers) { side = handlers; }

/**
 * The second picture handed to the app's player, if it can play it: true
 * when it was. False leaves it to the page's own player, under the app's
 * controls where the app has a player at all.
 * @param {any} spec the second picture's
 * @param {string} title its channel's name
 */
export function secondOrPlay(spec, title) {
  secondLeft();
  if (!offered) return false;
  const media = failed.has(spec.url) ? null : castMedia(spec);
  const own = !media || media.contentType === 'video/webm';
  if (remote && own) return false;
  beside = { id: nextId++, spec, page: own };
  video2.controls = false;
  pane2.classList.add('appbars');
  send('player.load', { slot: 2, id: beside.id, live: true, title, subtitle: '', labels: labels(), controls: !remote, ...(own ? { page: true } : { url: media.url, startAt: 0 }) });
  watch();
  sayPictureSound();
  return !own;
}

/** The app lets go of the second picture. */
export function secondLeft() {
  if (!beside) return;
  beside = null;
  video2.controls = true;
  pane2.classList.remove('appbars');
  send('player.stop', { slot: 2 });
  unwatch();
  sayPictureSound();
}

/** Which of the two pictures is heard, said to each one the app has; the speaker shows only while there are two. */
export function sayPictureSound() {
  if (showing) send('player.sound', { slot: 1, on: !el.video.muted, offered: Boolean(beside) });
  if (beside) send('player.sound', { slot: 2, on: !video2.muted, offered: true });
}

function sayFrameBeside() {
  const box = video2.getBoundingClientRect();
  // The page's word over its own second picture (connecting, a failure
  // and its Try again) is under the controls, which give way to it.
  const note = document.getElementById('second-note');
  const away = beside?.page && note && !note.hidden;
  const holes = box.width > 0 && box.height > 0 && !away ? coverings(box) : [];
  const frame = { x: box.left + scrollX, y: box.top + scrollY, width: away ? 0 : box.width, height: away ? 0 : box.height };
  // In the window too, as the first picture's box is said (sayFrame).
  const window = { left: box.left, top: box.top, ratio: devicePixelRatio, full: Boolean(document.fullscreenElement) };
  const now = [...Object.values(frame), ...Object.values(window), ...holes.flatMap((hole) => Object.values(hole))].map((n) => Math.round(Number(n) * 2) / 2).join(' ');
  if (now === saidBeside) return;
  saidBeside = now;
  send('player.frame', { slot: 2, ...frame, ...window, holes });
}

/** Where the page's own second picture is, for the app's controls over it. */
function sayPageBeside() {
  if (!beside?.page) return;
  send('player.page', { slot: 2, id: beside.id, state: video2.paused ? 'paused' : video2.readyState < 3 ? 'loading' : 'playing', position: video2.currentTime || 0 });
}

/** The app's word of the second picture: one it fails on is the page's to play, and is not handed over again. */
function heardBeside(word) {
  if (!beside || beside.page || word.id !== beside.id || word.state !== 'idle') return;
  const { spec } = beside;
  if (word.reason === 'error') failed.add(spec.url);
  secondLeft();
  side?.fail(spec);
}

/** A press in the second picture's bar, or of its controls over the page's own picture. */
function commandBeside(word) {
  if (!beside || word.id !== beside.id) return;
  if (['sound', 'swap', 'close', 'full'].includes(word.what)) side?.command(word.what, 2);
  else if (!beside.page) return;
  else if (word.what === 'play') video2.play().catch(() => {});
  else if (word.what === 'pause') video2.pause();
}

/**
 * The stream handed to the app's player, if it can play it: true when it
 * was (js/playing.js startPlayback). The page lets go of its own stream
 * first, as the account commonly allows one connection. What the app
 * cannot play is the page's, under the app's controls.
 * @param {any} item
 * @param {import('./playback.js').PlaySpec} spec the one in state.playingSpec
 */
export function nativeOrPlay(item, spec) {
  const media = playable(spec);
  if (!media) { nativeLeft(); underControls(item, spec); return false; }
  // The controls over the page's own picture go with it.
  if (showing?.page) nativeLeft();
  playback.stop();
  state.playbackInfoLoading = false;
  renderInfoStrip();
  el.overlay.hidden = true;
  el.overlay.classList.remove('loading');
  showing = { item, spec, id: nextId++, page: false, position: spec.startAt || 0, duration: null, running: false, width: 0, height: 0 };
  send('player.load', {
    id: showing.id, url: media.url, live: media.live, startAt: media.live ? 0 : spec.startAt || 0,
    title: el.nowTitle.textContent, subtitle: nowPlace(), labels: labels(),
    // A television's remote drives the page: the app shows the picture alone.
    controls: !remote,
    // The languages kept from the files before (js/tracksui.js): the app
    // picks the stream's own tracks by them.
    subtitleLang: spec.subtitleLang || 'off', audioLang: spec.audioLang || 'auto',
  });
  watch();
  sayPictureSound();
  return true;
}

/**
 * The app's player lets go: nothing plays any more, or the picture goes
 * elsewhere (the page's own player, a Chromecast).
 */
export function nativeLeft() {
  if (!showing) return;
  showing = null;
  // The page's picture has WebKit's controls again where the app's are gone.
  el.video.controls = true;
  el.videowrap.classList.remove('appbars');
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
  if (word.slot === 2) { heardBeside(word); return; }
  if (!showing || showing.page || word.id !== showing.id) return;
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
    underControls(item, spec);
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
  if (word.slot === 2 || !showing || showing.page || word.id !== showing.id) return;
  const language = word.language ? shortLanguage(word.language) : 'off';
  if (language === 'und') return;
  const key = word.kind === 'audio' ? 'audioLang' : 'subtitleLang';
  if (word.kind === 'audio' && language === 'off') return;
  if (state.settings[key] === language) return;
  state.settings = await store.saveSettings({ [key]: language });
}

if (native || remote) {
  // Any of the apps (the iPhone's and the iPad's, Android's on a phone or
  // a tablet and on a television) may have a player and says so in its
  // greeting.
  // The lock screen's and the headphones' next and previous, which the app hears for its own picture.
  // And what the controls over the page's own picture ask of it.
  on('player.command', (word) => {
    if (word.slot === 2) { commandBeside(word); return; }
    if (!showing || word.id !== showing.id) return;
    // The speaker beside a second picture: the sound is the page's to move.
    if (word.what === 'sound') { side?.command('sound', 1); return; }
    // The Android app's full screen button and double tap: the page's
    // full screen, which the picture's box and the app's view follow.
    if (word.what === 'full') { side?.command('full', 1); return; }
    if (word.what === 'next' || word.what === 'previous') playRelative(word.what === 'previous' ? -1 : 1);
    else if (!showing.page) return;
    else if (word.what === 'play') el.video.play().catch(() => {});
    else if (word.what === 'pause') el.video.pause();
    else if (word.what === 'seek' && Number.isFinite(word.to)) el.video.currentTime = word.to;
    // The menu's own item, with its answer when WebKit refuses.
    else if (word.what === 'pip') document.getElementById('btn-pip')?.click();
  });
  for (const type of ['play', 'pause', 'playing', 'waiting', 'timeupdate', 'durationchange', 'seeked', 'emptied']) {
    el.video.addEventListener(type, sayPage);
    video2.addEventListener(type, sayPageBeside);
  }
  on('player.track', choseTrack);
  // A modal dialog dims the page behind it, and the Android apps' picture
  // lies over the page: the app is told the backdrop's colour while a
  // dialog is open, dims its pictures with it and lets no touch through
  // them. The iPhone's app hears the same of its whole screen
  // (`screen.shade`, js/iosapp.js); a dialog opened over another lays
  // its backdrop over the first one's.
  if (!ios) {
    let shade = '0 null';
    new MutationObserver(() => {
      if (!offered) return;
      const dialogs = document.querySelectorAll('dialog:modal');
      const rgba = dialogs.length ? (getComputedStyle(dialogs[0], '::backdrop').backgroundColor.match(/[\d.]+/g) || []).map(Number) : null;
      // Opaque when the colour names three numbers.
      if (rgba && rgba.length === 3) rgba.push(1);
      if (rgba && rgba.length === 4) rgba[3] = 1 - (1 - rgba[3]) ** dialogs.length;
      if (`${dialogs.length} ${rgba}` === shade) return;
      shade = `${dialogs.length} ${rgba}`;
      send('player.shade', { rgba: rgba && rgba.length === 4 ? rgba : null, open: dialogs.length > 0 });
    }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['open', 'data-theme'] });
  }
  on('host', (host) => { offered = Boolean(host.player); });
  on('player.state', heard);
}
