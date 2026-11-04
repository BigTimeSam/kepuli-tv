// Handing the stream to an external player (VLC and others) from the
// player's menu or the x key, after a confirmation over the picture. The
// hand-off itself is js/external.js.
//
// Moved out of app.js. It takes the player's state and helpers from app.js
// (a cycle that ES modules resolve: nothing here runs while the modules
// load, only when the player calls in).

import { handOff } from './external.js';
import { renderInfoStrip } from './infostrip.js';
import { retryPlayback } from './recordingsui.js';
import { t } from './i18n.js';
import { state } from './app.js';
import { playItem, playback, showOverlayActions } from './playing.js';
import { copyUrl, toast } from './toast.js';
import { el } from './dom.js';

/**
 * Hands the current stream over to an external player.
 *
 * Playback is stopped first: the test account allows one concurrent
 * connection, so a stream the browser keeps open would leave the external
 * player silent. Everything here is deliberately synchronous — starting a
 * download requires a user gesture, which the first await would spend.
 */
export function playExternal() {
  if (!state.playingSpec) { toast(t('ext.nothing'), { kind: 'warn' }); return; }

  const name = state.playing ? state.playing.displayName || state.playing.n : 'Stream';
  const spec = state.playingSpec;
  // The resume position is where the browser got to, not where playback
  // started.
  const startAt = spec.live ? 0 : Math.floor(el.video.currentTime || spec.startAt || 0);
  playback.stop();
  state.playbackInfoLoading = false;
  renderInfoStrip();
  handOff({ ...spec, startAt }, name);

  el.overlay.hidden = false;
  el.overlay.classList.remove('loading');
  el.overlayTitle.textContent = t('ext.handed');
  el.overlayText.textContent = t('ext.handed.text');
  showOverlayActions([
    { label: t('ext.continue'), onClick: () => state.catchup ? retryPlayback() : state.playing && playItem(state.playing, { startAt }) },
    { label: t('player.copyurl'), onClick: copyUrl },
  ]);
}

/**
 * The x key asks before handing over; the menu item does not.
 *
 * The hand-off is not a small thing done twice: it stops playback, and it
 * writes a playlist file into the downloads folder carrying the server
 * address, the user name and the password in clear text, where it stays
 * until someone deletes it. A single stray keystroke should not do that —
 * and stray keystrokes do reach here, because the focus is deliberately
 * dropped to the body after every click, so nothing is holding the keys.
 *
 * The menu item is deliberate already: a menu opened and a line chosen,
 * spelled out in words. The confirmation's own button is a fresh click, so
 * the download still has the user gesture it needs.
 */
export function askExternal() {
  if (!state.playingSpec) { toast(t('ext.nothing'), { kind: 'warn' }); return; }
  el.overlay.hidden = false;
  el.overlay.classList.remove('loading');
  el.overlayTitle.textContent = t('ext.confirm');
  el.overlayText.textContent = t('ext.confirm.text');
  const close = () => { el.overlay.hidden = true; showOverlayActions(null); };
  showOverlayActions([
    { label: t('ext.title'), onClick: () => { close(); playExternal(); } },
    { label: t('progress.cancel'), onClick: close },
  ]);
}
