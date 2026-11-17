// The controls around the picture: the ☰ menu of what is wanted now and then,
// full screen (the browser's, and the player's own with its subtitle layer)
// and the system's media keys and controls.
//
// Moved out of app.js. It takes the player's state, and the parts app.js
// builds, from js/state.js.

import { $, el } from './dom.js';
import { ios, on, pausedByLeaving, send } from './host.js';
import { isFavorite } from './collections.js';
import { isGecko } from './browser.js';
import { shortLanguage } from './lang.js';
import { shownName } from './coversui.js';
import { t } from './i18n.js';
import * as store from './config.js';
import { playRelative, playerLayout, state } from './state.js';
import { toggleSubtitleLook } from './tracksui.js';

/** The items on offer: Cast is not among them without the API behind it. */
export const moreItems = () => [...el.morePop.querySelectorAll('.popitem')].filter((item) => !item.hidden);

/**
 * The player's menu, opened from the hamburger at the end of the row.
 *
 * Picture in picture, casting, the stream address and the hand-off to an
 * external player are wanted now and then rather than during every
 * programme, and as buttons they cost the row four places and say what they
 * do in two letters and an arrow. In the menu there is room for the whole
 * sentence.
 *
 * It closes the way the Aa popover does — the button again, a click
 * outside, Esc — and the two close each other: one panel over the picture
 * at a time. focusButton returns the focus to the hamburger, which is where
 * a keyboard left it; a mouse click is let go of, as every other click in
 * the player is, or Space would reopen the menu instead of pausing.
 */
export function toggleMoreMenu(open, { focusButton = false } = {}) {
  const show = open ?? el.morePop.hidden;
  if (show) toggleSubtitleLook(false);
  el.morePop.hidden = !show;
  el.more.setAttribute('aria-expanded', String(show));
  if (show) moreItems()[0]?.focus();
  else if (focusButton) el.more.focus();
}

/* Full screen. */

/**
 * Full screen for the wrapper — the picture with the subtitle layer and the
 * overlay — rather than for the bare video element, which would leave both
 * behind, see js/subdisplay.js. Chrome's tab casting still recognises the
 * video as the dominant content: it fills the fullscreen element.
 */
export function enterFullscreen() {
  if (pictureFull()) return;
  if (state.playing) playerLayout.showPlayer();
  if (ios) { send('screen.full', { on: true }); return; }
  // The iPhone has no full screen for an element, only for a video, in its
  // own player (with AirPlay and picture in picture): Orion's full screen
  // button and double tap did nothing at all, as requestFullscreen is not
  // there. The page's own subtitles are not drawn over that player.
  if (typeof el.videowrap.requestFullscreen !== 'function') {
    const video = /** @type {HTMLVideoElement & { webkitEnterFullscreen?: () => void }} */ (el.video);
    try { video.webkitEnterFullscreen?.(); } catch { /* nothing loaded yet */ }
    return;
  }
  // With the whole player already full screen (the header's button), the
  // picture goes on top of it, and leaving returns to the player still
  // full screen: exitFullscreen() steps back one element, not all the way.
  el.videowrap.requestFullscreen().catch(() => {});
}

export function toggleFullscreen() {
  if (!pictureFull()) enterFullscreen();
  else if (ios) send('screen.full', { on: false });
  else document.exitFullscreen().catch(() => {});
}

/** Whether the picture is full screen: the browser's, or in the app the app's own. */
export const pictureFull = () => (ios ? el.videowrap.classList.contains('full') : document.fullscreenElement === el.videowrap);

// The app for the iPhone and the iPad has full screen of its own. WebKit's,
// for an element, shows a banner that names the page's internal address
// each time and keeps the picture inside the screen's safe area. So the
// page asks the app, which gives its web view the whole screen without the
// system's bars and says so, with what of the screen is not safe on each
// side; the wrapper is then laid over the window (.videowrap.full in
// css/playback.css). What follows full screen elsewhere listens to
// fullscreenchange, and is told the same way here.
if (ios) {
  on('screen', ({ full, top, right, bottom, left }) => {
    for (const [side, px] of Object.entries({ top, right, bottom, left })) el.videowrap.style.setProperty(`--full-${side}`, `${Number(px) || 0}px`);
    if (el.videowrap.classList.contains('full') === (full === true)) return;
    el.videowrap.classList.toggle('full', full === true);
    document.dispatchEvent(new Event('fullscreenchange'));
  });
  $('btn-full').addEventListener('click', toggleFullscreen);
  // A swipe down over the picture leaves it, as it leaves the system's own
  // player. The move is followed, not its end: a finger that goes on to
  // the screen's edge ends in the system's hands.
  let from = null;
  el.videowrap.addEventListener('pointerdown', (e) => { from = e.pointerType === 'touch' && pictureFull() ? e : null; });
  el.videowrap.addEventListener('pointermove', (e) => {
    if (!from || e.pointerId !== from.pointerId) return;
    const down = e.clientY - from.clientY;
    if (down < SWIPE_PX || down < 2 * Math.abs(e.clientX - from.clientX)) return;
    from = null;
    toggleFullscreen();
  });
  for (const type of ['pointerup', 'pointercancel']) el.videowrap.addEventListener(type, () => { from = null; });
  // A picture taken out into picture in picture leaves the app's full
  // screen: what stayed behind was WebKit's note that it plays elsewhere,
  // over the whole screen (measured on an iPad), and the viewer took the
  // picture out to see the rest. WebKit's own event, as its controls' mark
  // and the menu's item both end in it.
  el.video.addEventListener('webkitpresentationmodechanged', () => {
    if (el.video.webkitPresentationMode === 'picture-in-picture' && pictureFull()) toggleFullscreen();
  });
  // The sound goes on when the app leaves the front, as the `audio`
  // background mode says it does (App Store guideline 2.5.4: a reviewer
  // plays a channel, goes home and listens). WebKit pauses a picture that
  // nobody sees, and play() behind another app starts it again and it goes
  // on there (measured, ios/simcheck.mjs `background`): so a pause that was
  // WebKit's for leaving is answered with play(). The viewer's own pause
  // stays one: before leaving it makes no pause event to answer, and from
  // the lock screen or Control Centre it comes long after the page was
  // hidden. A muted picture stays paused, as there is nothing to hear;
  // while casting nothing plays here at all.
  //
  // WebKit also starts the picture again by itself when the app comes
  // back to the front, whatever happened meanwhile (measured: a channel
  // paused behind another app played within 2 ms of the page being
  // shown). After the viewer's own pause there (`held`) that start is
  // undone; Play pressed there, a press here or another stream ends it.
  let pausedAt = -Infinity, hiddenAt = -Infinity, shownAt = -Infinity, touchedAt = -Infinity;
  let held = false;
  const goOn = () => {
    const video = el.video;
    if (document.hidden && video.paused && !video.ended && !video.muted && pausedByLeaving(pausedAt, hiddenAt, touchedAt)) video.play().catch(() => {});
  };
  for (const type of ['pointerup', 'keyup']) document.addEventListener(type, () => { touchedAt = performance.now(); held = false; }, true);
  el.video.addEventListener('pause', () => {
    pausedAt = performance.now();
    if (document.hidden) held = !pausedByLeaving(pausedAt, hiddenAt, touchedAt);
    goOn();
  });
  el.video.addEventListener('play', () => {
    if (held && !document.hidden && performance.now() - shownAt < 1000) el.video.pause();
    held = false;
  });
  el.video.addEventListener('emptied', () => { held = false; });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hiddenAt = performance.now(); goOn(); } else shownAt = performance.now();
  });
}

// The buttons over the picture that take it full screen say which way they
// go, whoever changed it: the second picture's (js/secondui.js) and the
// app's own.
document.addEventListener('fullscreenchange', () => {
  const key = pictureFull() ? 'screen.leave' : 'screen.enter';
  for (const button of [$('second-full'), $('btn-full')]) {
    button.dataset.i18nLabel = button.dataset.i18nTitle = key;
    button.setAttribute('aria-label', t(key));
    button.title = t(key);
  }
});

/* The whole player full screen. */

/**
 * The header's button: the page without the browser's bars. On a tablet
 * Firefox's address bar and tabs, with Android's own bars, take a quarter
 * of the height — measured on a Galaxy Tab S8+, 905 CSS pixels full screen
 * against some 700. The browser allows it only on a press, so it cannot be
 * the page's own start. Android's back gesture leaves it, as Esc does.
 */
export function toggleScreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen().catch(() => {});
}

/** The button's mark and words follow the state, whoever changed it. */
export function renderScreenButton() {
  const button = $('btn-screen');
  if (!document.fullscreenEnabled) { button.hidden = true; return; }
  const on = document.fullscreenElement === document.documentElement;
  const key = on ? 'screen.leave' : 'screen.enter';
  button.classList.toggle('on', on);
  button.dataset.i18nLabel = button.dataset.i18nTitle = key;
  button.setAttribute('aria-label', t(key));
  button.title = t(key);
}

/**
 * A double click on the picture takes the wrapper full screen, as f does,
 * rather than letting Chrome's controls take the bare video, where Chrome
 * draws the subtitles itself in the system's caption box (js/subdisplay.js).
 * The double click over the picture reaches the page; a press on the
 * controls' own buttons does not — Chrome keeps those to itself, measured —
 * so the full screen button still takes the bare video. Firefox's controls
 * keep their clicks to themselves (see clickPicture).
 */
function catchDoubleClick(e) {
  if (isGecko() || e.target !== el.video || e.button !== 0) return;
  if (e.offsetY > el.video.clientHeight - CONTROL_BAR_PX) return;
  // The second press of a double click is where the page acts: it is a
  // fresh user activation, and the request made with it uses the
  // activation up, so that the controls' own request on the dblclick that
  // follows is refused. The dblclick itself is only stopped.
  if (e.type === 'mousedown' && e.detail === 2) {
    // The click this press would end in never comes: full screen takes it.
    // The first click's pause, waiting for a second (clickPicture), is
    // taken back here instead.
    clearTimeout(clickTimer);
    clickTimer = null;
    toggleFullscreen();
  } else if (e.type !== 'dblclick') return;
  e.preventDefault();
  e.stopPropagation();
}
window.addEventListener('mousedown', catchDoubleClick, true);
window.addEventListener('dblclick', catchDoubleClick, true);// A click on the picture pauses a film or an episode and plays it on, and a
// double click takes the picture full screen: the browser's own controls do
// both, in Chrome as in Firefox, now that Chrome's full screen button is
// back (see js/subdisplay.js). A live channel is the exception: there is
// nothing to come back to after a pause, so its click is stopped before the
// controls see it — in the capture phase, outside the strip at the bottom
// where Chrome's buttons sit, up to some 70 px from the bottom. Firefox's
// controls keep the click to themselves, and measured, no press or click
// over the picture reaches the page there: a click pauses a live channel in
// Firefox, which the page cannot prevent while the element has the
// browser's controls.
const CONTROL_BAR_PX = 80;
// How far down a finger goes before it has swiped the app's full screen away.
const SWIPE_PX = 70;

// Chrome's controls pause on the first click of a double click, and the
// second press goes to full screen (catchDoubleClick), so a double click
// meant only for full screen left the film paused. In Chrome the page
// takes the click over: a single one pauses or plays on once the time for
// a second has passed, and a second within it cancels that — it was a
// double click. A little later than the controls' own pause, and only then.
const SECOND_CLICK_MS = 280;
let clickTimer = null;
// What made the last press: a mouse, a finger or a pen.
let lastPointer = 'mouse';
window.addEventListener('pointerdown', (e) => { lastPointer = e.pointerType || 'mouse'; }, true);

export function clickPicture(e) {
  const video = el.video;
  if (e.target !== video || e.button !== 0) return;
  // A tap is the touch screen's own controls': it shows them, and their
  // play button plays. Taken over here as a click, the tap on the iPhone's
  // play button also reached this, and its pause came 280 ms after the
  // picture had started — a film paused in Orion could not be played on.
  // What the press before the click was made with. Not the click's own
  // pointerType: the iPhone's WebKit calls the click that a tap ends in a
  // mouse's, while the pointerdown before it says touch (logged in Orion).
  if (lastPointer === 'touch' || lastPointer === 'pen') return;
  if (e.offsetY > video.clientHeight - CONTROL_BAR_PX) return;
  const item = state.playing;
  if (!item) return;
  if (item.k === 0) { e.preventDefault(); e.stopPropagation(); return; }
  if (isGecko()) return;
  e.preventDefault();
  e.stopPropagation();
  clearTimeout(clickTimer);
  clickTimer = null;
  if (e.detail === 1) clickTimer = setTimeout(() => { clickTimer = null; togglePause(); }, SECOND_CLICK_MS);
}

export function togglePause() {
  if (el.video.paused) el.video.play().catch(() => {});
  else el.video.pause();
}

/**
 * The language is kept for the coming episodes — not the track number,
 * because the numbers vary from one file to the next.
 */
export async function rememberSubtitleLanguage(number) {
  const track = state.subtitles.find((t) => t.number === number);
  const language = track ? shortLanguage(track.language) : 'off';
  if (state.settings.subtitleLang === language) return;
  state.settings = await store.saveSettings({ subtitleLang: language });
}

export function renderSeriesFavorite() {
  const button = $('detail-fav');
  if (!button || state.detail?.view !== 'series') return;
  const on = isFavorite(state.detail.item);
  button.textContent = on ? '★' : '☆';
  button.classList.toggle('on', on);
  button.setAttribute('aria-pressed', String(on));
  button.title = t(on ? 'fav.series.remove' : 'fav.series.add');
  button.setAttribute('aria-label', button.title);
}

/* Media keys. */

// The keyboard's and the headphones' media keys, and the system's own media
// controls, reach the page through the Media Session. Without it they did
// play and pause and nothing else, and the system's panel named the tab
// rather than what was on. Painted with the info strip, which already
// follows the item, the archive programme and the programme data.
const mediaSession = navigator.mediaSession || null;

export function renderMediaSession() {
  if (!mediaSession) return;
  const item = state.playing;
  if (!item) { mediaSession.metadata = null; return; }
  const name = shownName(item);
  let title = name, artist = '';
  if (state.catchup) { title = state.catchup.title; artist = name; }
  else if (item.k === 0) {
    const now = state.epg ? state.epg.nowNext(item.id)?.now : null;
    if (now) { title = now.title; artist = name; }
  } else if (item.k === 3) artist = item.seriesName || '';
  const art = (item.k === 3 && item.seriesCover) || item.logo;
  mediaSession.metadata = new MediaMetadata({ title, artist, album: 'Kepuli-TV', artwork: art ? [{ src: art }] : [] });
  // A live stream has nothing to seek in: without handlers the controls
  // offer no seeking either.
  const seekable = item.k !== 0 || Boolean(state.catchup);
  const seek = (offset) => () => { el.video.currentTime = Math.max(0, el.video.currentTime + offset); };
  setMediaAction('seekbackward', seekable ? seek(-10) : null);
  setMediaAction('seekforward', seekable ? seek(30) : null);
  setMediaAction('seekto', seekable ? ({ seekTime }) => { el.video.currentTime = seekTime; } : null);
}

/** An action the browser does not know throws; it is simply not offered then. */
function setMediaAction(action, handler) {
  try { mediaSession.setActionHandler(action, handler); } catch { /* not supported here */ }
}

export function wireMediaSession() {
  if (!mediaSession) return;
  setMediaAction('nexttrack', () => playRelative(1));
  setMediaAction('previoustrack', () => playRelative(-1));
}
