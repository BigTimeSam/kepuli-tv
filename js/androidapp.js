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
import { nativeRunning } from './nativeplayer.js';
import { on, send } from './host.js';
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
 * The page's words with the Android app around it, over the one line of
 * js/host.js (only the app's copy of the manifest lets the page open it).
 *
 * The app says when it has become a small window over other apps
 * (`app.pip`), where the page is to be the picture and nothing else; what
 * was pressed on its playback notification, a headset or the lock screen
 * (`app.press`); and which channel a reminder's notification asked for
 * when the app had not been running to hear of it (`app.watch`).
 *
 * The page says what is on and whether it plays (`app.now`): the app
 * keeps the sound going out of sight on that word. (The engine has a media
 * session of its own for this, but it never came to life for the app,
 * GeckoView 160.) It says the picture's shape, which the small window
 * takes (`app.shape`), and the channel's logo or the film's cover for the
 * notification and the lock screen (`app.art`).
 *
 * These words had no type until the two apps came together, and were told
 * from the cast session's by that; they are of one kind now.
 */
function talkWithApp() {
  // Whether the picture runs: the app's own player's, where it has the
  // picture (js/nativeplayer.js), else the page's.
  const running = () => nativeRunning() ?? (!el.video.paused && !el.video.ended);
  on('app.pip', (said) => document.documentElement.classList.toggle('pip', Boolean(said.on)));
  on('app.press', ({ what }) => {
    if (what === 'next' || what === 'previous') hooks.zap(what === 'next' ? 1 : -1);
    else if ((what === 'play' && !running()) || (what === 'pause' && running())) togglePause();
  });
  // The same word background.js leaves of a clicked notification
  // (js/remindersui.js plays it). The app may have been started by the
  // press: the word waits for the lists, as it is thrown away unplayed
  // when it comes before the account is known.
  on('app.watch', ({ channel, account }) => { connected().then(() => api.storage.local.set({ watchAsked: { channel, account, at: Date.now() } })); });
  let told = '', drawn = '';
  const tell = () => {
    const metadata = navigator.mediaSession?.metadata;
    const now = {
      on: Boolean(state.playing) && !castingNow(), playing: Boolean(state.playing) && running(),
      title: metadata?.title || '', artist: metadata?.artist || '', live: state.playing?.k === 0,
    };
    const text = JSON.stringify(now);
    if (text !== told) send('app.now', now);
    told = text;
    const art = (now.on && metadata?.artwork?.[0]?.src) || '';
    if (art !== drawn) { drawn = art; picture(art).then((png) => { if (drawn === art) send('app.art', { png }); }); }
  };
  // The time's ticks carry a change of programme, which is no event of
  // the picture's.
  for (const event of ['play', 'playing', 'pause', 'ended', 'emptied', 'timeupdate']) el.video.addEventListener(event, tell);
  const shape = () => { if (el.video.videoWidth) send('app.shape', { width: el.video.videoWidth, height: el.video.videoHeight }); };
  el.video.addEventListener('loadedmetadata', shape);
  el.video.addEventListener('resize', shape);
  // The app's own player says where its picture stands, and no event of
  // the page's <video> comes with it: what is on is told again, after
  // js/nativeplayer.js has heard the same word, and the picture's shape
  // is the app's own to know.
  on('player.state', (word) => {
    setTimeout(tell);
    if (word.width > 0 && word.height > 0) send('app.shape', { width: word.width, height: word.height });
  });
}

const ART_PX = 192;

/**
 * A picture for the app's notification, as a PNG in base64, or '' when
 * there is none. The page reads it and hands it over, small: the app then
 * asks nothing of the network on its own account (the privacy policy says
 * it does not), and a picture the page holds as a blob is no address the
 * app could open. Read with fetch, under the page's grant for the
 * provider's host: an image drawn from another origin would taint the
 * canvas, and nothing could be read back.
 * @param {string} address
 */
async function picture(address) {
  if (!address) return '';
  try {
    const res = await fetch(address, { credentials: 'omit' });
    if (!res.ok) return '';
    // Through an image element and not createImageBitmap, which takes no
    // SVG from a blob: a logo may be one. The blob's address is the
    // page's own, so the canvas can be read back.
    const own = URL.createObjectURL(await res.blob());
    try {
      const image = new Image();
      image.src = own;
      await image.decode();
      const width = image.naturalWidth || ART_PX, height = image.naturalHeight || ART_PX;
      const scale = Math.min(1, ART_PX / Math.max(width, height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/png').split(',')[1] || '';
    } finally {
      URL.revokeObjectURL(own);
    }
  } catch {
    return '';
  }
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
