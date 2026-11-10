// Handing the stream to an external player (VLC and others) from the
// player's menu or the x key, after a confirmation over the picture. The
// hand-off itself is js/external.js.
//
// Moved out of app.js. It takes the player's state, and the parts app.js
// builds, from js/state.js.

import { handOff, onIPhone, toVlc } from './external.js';
import { renderInfoStrip } from './infostrip.js';
import { retryPlayback } from './recordingsui.js';
import { t } from './i18n.js';
import { state } from './state.js';
import { playItem, playback, showOverlayActions } from './playing.js';
import { copyUrl, toast } from './toast.js';
import { el } from './dom.js';
import { shownName } from './coversui.js';
import { episodeCode } from './format.js';

/**
 * The name the external player's playlist and its file carry: the one the
 * player's title shows, and for an episode its series and its code before
 * it, as "Episode 3.m3u" alone would say nothing in a downloads folder.
 */
function handOffName(item) {
  const name = shownName(item);
  if (item.k !== 3) return name;
  return [item.seriesName, episodeCode(item.season, item.episode), name].filter(Boolean).join(' ');
}

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

  const name = state.playing ? handOffName(state.playing) : 'Stream';
  const spec = state.playingSpec;
  // The resume position is where the browser got to, not where playback
  // started. A film watched to its end starts over: handed the end itself,
  // VLC finished at once and closed (measured on Android).
  const at = spec.live ? 0 : Math.floor(el.video.currentTime || spec.startAt || 0);
  const length = el.video.duration;
  const startAt = Number.isFinite(length) && at > length - 10 ? 0 : at;
  playback.stop();
  state.playbackInfoLoading = false;
  renderInfoStrip();
  handOff({ ...spec, startAt }, name);

  el.overlay.hidden = false;
  el.overlay.classList.remove('loading');
  el.overlayTitle.textContent = t(toVlc() ? 'ext.handed.title.vlc' : 'ext.handed');
  el.overlayText.textContent = t(toVlc() ? 'ext.handed.vlc' : 'ext.handed.text');
  showOverlayActions([
    { label: t('ext.continue'), onClick: () => state.catchup ? retryPlayback() : state.playing && playItem(state.playing, { startAt }) },
    { label: t('player.copyurl'), onClick: copyUrl },
  ]);
}

/**
 * The words of the hand-off's button and menu item: on a phone the player
 * is VLC and is named, elsewhere it is whatever the system opens a playlist
 * with.
 */
export const externalLabel = () => (toVlc() ? 'ext.title.vlc' : 'ext.title');

/**
 * The menu item's words, set before the page's texts are put in: the
 * markup carries the general ones.
 */
export function nameExternalItem() {
  const label = document.querySelector('#btn-ext [data-i18n]');
  if (label instanceof HTMLElement) label.dataset.i18n = externalLabel();
}

/**
 * The x key asks before handing over; the menu item does not.
 *
 * The hand-off is not a small thing done twice: it stops playback, and
 * (except on a phone, where VLC is handed the stream) it writes a playlist file into the downloads folder carrying the server
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
  el.overlayText.textContent = t(onIPhone() ? 'ext.confirm.vlc.ios' : toVlc() ? 'ext.confirm.vlc' : 'ext.confirm.text');
  const close = () => { el.overlay.hidden = true; showOverlayActions(null); };
  showOverlayActions([
    { label: t(externalLabel()), onClick: () => { close(); playExternal(); } },
    { label: t('progress.cancel'), onClick: close },
  ]);
}
