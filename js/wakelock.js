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
  const on = () => { wanted = true; acquire(); };
  const off = () => { wanted = false; release(); };
  video.addEventListener('play', on);
  video.addEventListener('playing', on);
  video.addEventListener('pause', off);
  video.addEventListener('ended', off);
  video.addEventListener('emptied', off);
  // A refused request is asked again on the next tap, which carries the
  // activation the first one may have lacked (a stream that started
  // seconds after its tap).
  document.addEventListener('pointerup', acquire, true);
  document.addEventListener('visibilitychange', acquire);
}
