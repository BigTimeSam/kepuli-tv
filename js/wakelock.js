// @ts-check
// The screen kept on while a picture plays.
//
// A phone dims and locks its screen after a minute or two without a touch,
// and a channel watched in Orion on an iPhone went dark mid-programme. The
// Screen Wake Lock API holds the screen on. The iPhone's WebKit grants it
// only from a user's tap (a request without one was refused with
// NotAllowedError, measured in Orion 2026-11-10), so it is asked for when
// playback starts — the play() of a tap — and, if that was refused, again
// on the next tap anywhere. The browser lets go of it when the page is
// hidden; it is asked for again when the page comes back while the picture
// still plays.
//
// The app for the iPhone and the iPad (js/host.js) refuses the Wake Lock in
// its web view altogether, tap or no tap. There the page says when a
// picture plays and the app holds the screen on itself. Nothing plays here
// while a Chromecast does, so a phone that is then a remote control may
// sleep; nor is the screen held on an app left on its list.

import { ios, send } from './host.js';

/** @type {any} */
let lock = null;
let wanted = false;
let asking = false;

function acquire() {
  const wakeLock = /** @type {any} */ (navigator).wakeLock;
  if (!wanted || lock || asking || !wakeLock || document.visibilityState !== 'visible') return;
  asking = true;
  // Asked at once, inside the tap's turn: an await before it would spend
  // the activation the iPhone wants.
  wakeLock.request('screen').then((granted) => {
    asking = false;
    if (!wanted) { granted.release().catch(() => {}); return; }
    lock = granted;
    granted.addEventListener('release', () => { if (lock === granted) lock = null; });
  }, () => { asking = false; });
}

function release() {
  const held = lock;
  lock = null;
  held?.release().catch(() => {});
}

/**
 * Follows the picture: on while it plays, off when it pauses, ends or is
 * taken away.
 * @param {HTMLVideoElement} video
 */
export function keepScreenOnWhilePlaying(video) {
  // The app is told of a change only: play and playing both say "on".
  const tell = (on) => { if (on !== wanted) send('awake', { on }); wanted = on; };
  const on = ios ? () => tell(true) : () => { wanted = true; acquire(); };
  const off = ios ? () => tell(false) : () => { wanted = false; release(); };
  video.addEventListener('play', on);
  video.addEventListener('playing', on);
  video.addEventListener('pause', off);
  video.addEventListener('ended', off);
  video.addEventListener('emptied', off);
  if (ios) return;
  // A refused request is asked again on the next tap, which carries the
  // activation the first one may have lacked (a stream that started
  // seconds after its tap).
  document.addEventListener('pointerup', acquire, true);
  document.addEventListener('visibilitychange', acquire);
}
