// @ts-check
// What the page does in the Android app on a phone or a tablet (android/,
// the `mobile` package; player.html?app=1), beyond the cast session
// (js/cast.js, js/castui.js) and the `.app` rules of css/last.css: the
// page's class, its Back, and its line to the app for the playback
// notification, the small window and a reminder's notification.
// android/AGENTS.md has what the app does with each.

import { api } from './browser.js';
import { el } from './dom.js';
import { state } from './state.js';
import { togglePause } from './playercontrols.js';
import { inApp } from './platform.js';
import { castingNow } from './castui.js';
import { appPort } from './host.js';
import { isText, layer, swallow } from './remote.js';

let hooks = null;

/**
 * @param {object} app what the player offers a remote control too
 *   (js/remote.js, wireRemote): here zap(delta) changes the channel,
 *   back() closes the guide or a series' page or leaves the player's pane
 *   and says whether it did, guideRow() is the guide's row while the guide
 *   is open, else -1.
 */
export function wireAndroidApp(app) {
  if (!inApp) return;
  hooks = app;
  document.documentElement.classList.add('app');
  // On the window, ahead of every handler of the page's own: a menu that
  // closed itself first left nothing open to be seen here, and the same
  // Back went on to leave the app.
  window.addEventListener('keydown', onAppBack, true);
  talkWithApp();
}

/**
 * The page's line to the Android app around it ("kepuli", answered by
 * the app's PlayerActivity; only the app's copy of the manifest lets the
 * page open it). The app says when it has become a small window over
 * other apps (picture in picture), where the page is to be the picture
 * and nothing else, and which channel a reminder's notification asked
 * for when the app had not been running to hear of it, and what was
 * pressed on its playback notification, a headset or the lock screen.
 * The page says the picture's shape, which the small window takes, and
 * what is on and whether it plays: the app keeps the sound going out of
 * sight on that word. (The engine has a media session of its own for
 * this, but it never came to life for the app, GeckoView 160.)
 */
function talkWithApp() {
  // The one line to the app (js/host.js), which the cast session's words
  // share: these have no type, and those are told apart by theirs.
  const port = appPort();
  if (!port) return;
  port.onMessage.addListener((message) => {
    if (typeof message?.pip === 'boolean') document.documentElement.classList.toggle('pip', message.pip);
    const press = message?.press;
    if (press === 'next' || press === 'previous') hooks.zap(press === 'next' ? 1 : -1);
    else if ((press === 'play' && el.video.paused) || (press === 'pause' && !el.video.paused)) togglePause();
    // The same word background.js leaves of a clicked notification
    // (js/remindersui.js plays it). The app may have been started by the
    // press: the word waits for the lists, as it is thrown away unplayed
    // when it comes before the account is known.
    if (message?.watch) connected().then(() => api.storage.local.set({ watchAsked: { ...message.watch, at: Date.now() } }));
  });
  let told = '';
  const tell = () => {
    const metadata = navigator.mediaSession?.metadata;
    const now = {
      on: Boolean(state.playing) && !castingNow(), playing: Boolean(state.playing) && !el.video.paused && !el.video.ended,
      title: metadata?.title || '', artist: metadata?.artist || '', live: state.playing?.k === 0,
    };
    const text = JSON.stringify(now);
    if (text !== told) port.postMessage({ now });
    told = text;
  };
  // The time's ticks carry a change of programme, which is no event of
  // the picture's.
  for (const event of ['play', 'playing', 'pause', 'ended', 'emptied', 'timeupdate']) el.video.addEventListener(event, tell);
  const shape = () => { if (el.video.videoWidth) port.postMessage({ shape: [el.video.videoWidth, el.video.videoHeight] }); };
  el.video.addEventListener('loadedmetadata', shape);
  el.video.addEventListener('resize', shape);
}

/** Resolves when an account's lists are in, or after two minutes without. */
async function connected() {
  for (let waited = 0; !state.lib && waited < 120e3; waited += 300) await new Promise((done) => setTimeout(done, 300));
}

/**
 * A phone's Back in the Android app. Whatever is open closes itself on
 * Escape, and a field with text in it gives the text up; with nothing
 * open Back leaves the player's pane for the list, or a series' page, and
 * from the list the app (window.close(), which the app answers by
 * stepping back).
 */
function onAppBack(e) {
  if (e.key !== 'Escape' || document.fullscreenElement || layer() !== document.body || !el.listProgress.hidden) return;
  // The guide has an Escape of its own: its sheet, its search, then itself.
  if (el.main.classList.contains('guide-sheet') || hooks.guideRow() >= 0) return;
  const active = document.activeElement;
  if (active instanceof HTMLInputElement && active.value && isText(active)) return;
  swallow(e);
  if (!hooks.back()) window.close();
}
