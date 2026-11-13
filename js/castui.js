// The cast session on the page, in the app for the iPhone and the iPad
// (js/host.js): the app carries Google's Cast sender, and a Chromecast
// fetches a stream by itself from the address it is handed (js/cast.js,
// NativeCast). In a browser none of this runs: Chrome's Remote Playback
// sends the picture this page plays, and the page goes on playing it.
//
// Handing an address over means letting go of the stream here first: an
// account commonly allows one connection, and the device needs it. So the
// page asks before it stops the picture (can the device play this at
// all?), and plays on here itself whenever the device cannot, fails or
// lets go.
//
// What the app says arrives as states, and a state is said again whenever
// the app has reason to (the phone unlocked, the page reloaded), so
// everything here acts on a change: a session that became connected, one
// that ended, a word about the media not heard before.
//
// It takes the player's state, and the parts app.js builds, from
// js/state.js.

import { HLS_TYPE, castMedia, hlsCastable } from './cast.js';
import { el } from './dom.js';
import { t } from './i18n.js';
import { renderInfoStrip } from './infostrip.js';
import { noteEnded, notePlace } from './nextepisode.js';
import { nowPlace, placeReached, playItem, playback, showOverlayActions } from './playing.js';
import { retryPlayback } from './recordingsui.js';
import { cast, state, updatePlayerLayout } from './state.js';
import { toast } from './toast.js';
import { leavePlayback } from './tracksui.js';

// What the device plays for this page: the item and its spec as they were
// started here, where it began and where the device has got to (`position`
// of `duration`, heard at `heardAt`, `running` when it was playing then).
// `item` is null when the page found the device already playing (a page
// loaded again during a session): there is a session to show, and nothing
// to play on with. `loading` until the device has answered the hand-over;
// `origin` is an HLS playlist's server.
let casting = null;
// Whether a server's HLS can be cast, by origin, for as long as the page
// lives: asked once, as the answer is the server's and not the channel's.
const hlsHosts = new Map();
// What the device itself has shown of a server's HLS, until the session
// ends: the origins it has played a channel of, and those it failed on
// before it had played any. A server whose playlist carries the header and
// whose segments do not fails on every channel, so the next one does not
// go round by the device; one dead or 4K channel among those the device
// plays is that channel's own failure. It used to condemn the whole server,
// and a channel the device had played a moment before was refused.
const hlsPlayed = new Set(), hlsRefused = new Set();
// The addresses the device failed on: they play here until the session
// ends, rather than going round by the device again.
const failed = new Set();
let wasState = 'disconnected';
let heard = null;   // the last cast.media acted on
// When this page last asked the device to stop what it had handed it, or 0
// (castingLeft). The device goes on saying that stream for a moment, and
// for as long as it still fetches it when the stop came during the
// hand-over: those words are not a session found. Bounded, so that a stop
// that was lost leaves the session to be shown, with its Stop casting.
// Infinity while the hand-over it interrupted is still unanswered: the
// app keeps that stop until the device has taken the stream (handOver).
let stopAsked = 0;
const STOP_MS = 8000;

// How long the playlist's own server is waited for before the device is
// simply tried.
const HLS_ASK_MS = 4000;

/**
 * What the device can be handed of a stream, or null. For HLS the
 * playlist's server is asked first, once: without the header the device's
 * player wants (see hlsCastable) every change of channel would stop the
 * picture here, wait for the device to fail and warn. The page reads the
 * answer's headers because it holds the grant for the provider's host;
 * the answer's body is not waited for. An error or silence is no verdict.
 *
 * The app's page is shown this header, on iOS 18.5 and 26.5 (measured;
 * `live` in ios/simcheck.mjs holds it). A desktop browser's page without
 * the grant is not, which is why the iosapp scenario hands the page the
 * server's answer.
 */
async function castable(spec) {
  const media = castMedia(spec);
  if (!media || media.contentType !== HLS_TYPE) return media;
  const origin = new URL(media.url).origin;
  if (hlsRefused.has(origin)) return null;
  if (!hlsHosts.has(origin)) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), HLS_ASK_MS);
    try {
      const res = await fetch(media.url, { signal: ctrl.signal, cache: 'no-store', credentials: 'omit' });
      if (res.ok) hlsHosts.set(origin, hlsCastable(res.status, res.headers));
    } catch {
      // Not reached, or not in time: the device is tried.
    } finally {
      clearTimeout(timer);
      ctrl.abort();
    }
  }
  return hlsHosts.get(origin) === false ? null : media;
}

/**
 * Whether the overlay is the session's with nothing of this page's on the
 * device (a page loaded again during a session), and if so drawn again, in
 * the language of now. The empty player's page asks before it writes itself
 * there (js/languageui.js renderIdleOverlay): the app says the session while
 * the player still starts, and the start page is drawn again and again
 * after that, which left "Nothing playing" over the session's two buttons.
 */
export function sessionShown() {
  if (!sessionFound()) return false;
  showCasting();
  return true;
}

/**
 * The session's words written again, in the language of now, whoever's
 * stream the device plays: true when there is a session to say. For a
 * change of language (js/languageui.js), which writes the empty player's
 * words back into the overlay: "Nothing playing" stood over Remote control
 * and Stop casting, both still in the language before, for the rest of the
 * session. Apart from sessionShown, which the empty player's page asks and
 * which must stay a no while this page's own stream is on the device.
 */
export function redrawCasting() {
  if (!casting) return false;
  showCasting();
  return true;
}

/** Whether the device plays what this page did not hand it: the page was loaded again during a session. */
export const sessionFound = () => Boolean(casting && !casting.item);

/** The session over the picture's place: where it plays, and the two things to do about it. */
function showCasting() {
  el.overlay.hidden = false;
  el.overlay.classList.remove('loading');
  el.overlayTitle.textContent = t('cast.on', { device: cast.device || 'Chromecast' });
  el.overlayText.textContent = t('cast.on.text');
  showOverlayActions([
    { label: t('cast.controls'), onClick: () => cast.controls() },
    { label: t('cast.stop'), onClick: () => cast.end() },
  ]);
}

/**
 * The stream handed to the device, if it can play it: true when it was.
 * In this order, as the account has one connection: the picture stops
 * here, then the device is given the address. What cannot be cast is said
 * and stays here, untouched.
 */
async function handOver(item, spec, startAt) {
  const media = await castable(spec);
  // Asking took a moment: the viewer may have started something else, or
  // the session may have ended.
  if (state.playingSpec !== spec || !cast.connected) return false;
  if (!media) { toast(t('cast.cannot'), { kind: 'warn', long: true }); return false; }
  playback.stop();
  state.playbackInfoLoading = false;
  renderInfoStrip();
  casting = { item, spec, startAt, position: startAt, origin: media.contentType === HLS_TYPE ? new URL(media.url).origin : null, loading: true };
  stopAsked = 0;
  showCasting();
  // The app's own controls fetch the picture, and the app is not allowed
  // plain http there: such a logo or cover is left out.
  const picture = (item.k === 3 && item.seriesCover) || item.logo;
  const sent = casting;
  try {
    await cast.load({
      ...media, startAt, title: el.nowTitle.textContent, subtitle: nowPlace(),
      ...(/^https:/i.test(picture || '') ? { image: picture } : {}),
    });
    // Left meanwhile, by the logo or for something the device cannot play:
    // the app had nothing to stop while the device was still fetching, so
    // the device is stopped now that it has taken the stream.
    if (casting === sent) sent.loading = false;
    else if (!casting) { cast.stop(); stopAsked = Date.now(); }
  } catch {
    if (casting === sent) deviceFailed();
    else if (!casting) stopAsked = Date.now();
  }
  return true;
}

/**
 * Whether the device took what was about to start here, while a session
 * is on (js/playing.js startPlayback). What it cannot play plays here,
 * and the device lets go of what it showed: its connection is needed.
 */
export async function castOrPlay(item, spec) {
  if (!cast.native || !cast.connected) return false;
  // What the device failed on is not tried again; the device still lets go below.
  if (!failed.has(spec.url) && await handOver(item, spec, spec.startAt || 0)) return true;
  if (state.playingSpec === spec && cast.connected) {
    if (casting || cast.showing) { cast.stop(); stopAsked = Date.now(); }
    casting = null;
  }
  return false;
}

/** The same thing here, from where the device had got to; a channel from now. */
function playHere(left, position) {
  if (state.catchup) retryPlayback();
  else playItem(left.item, left.spec.live ? {} : { startAt: Math.floor(position || 0) });
}

/**
 * Whether what the device had is still what this page shows. Not when the
 * viewer has chosen something else since: a channel just chosen waits for
 * its playlist's server (castable) with `casting` still the stream before,
 * and what the device then says of that stream is not the new one's to
 * suffer. It ended the channel before it had started anywhere, or put the
 * old film in its place.
 */
const shownHere = (left) => (left.item ? state.playingSpec === left.spec : !state.playing);

/** The device could not play it: said, and it plays here. */
function deviceFailed() {
  const left = casting;
  casting = null;
  cast.stop();
  toast(t('cast.failed'), { kind: 'warn', long: true });
  if (!left.item) { if (shownHere(left)) leavePlayback(); return; }
  failed.add(left.spec.url);
  // The next channel of a server the device has played nothing of does
  // not go round by the device.
  if (left.origin && !hlsPlayed.has(left.origin)) hlsRefused.add(left.origin);
  if (shownHere(left)) playHere(left, left.position);
}

/** Where the device has got to: kept for playing on here, and as the film's or the episode's place (js/nextepisode.js). */
function notePosition({ state: playerState, position, duration }) {
  Object.assign(casting, { duration, heardAt: Date.now(), running: playerState === 'playing' });
  // The place only from a picture that runs or has got somewhere, as the
  // app keeps its own (CastService.notePosition): a device still loading
  // says zero, and a film handed over at its middle began again from its
  // beginning here when the session ended in that moment.
  if (position > 0 || ['playing', 'paused'].includes(playerState)) casting.position = position;
  if (casting.origin && casting.running) hlsPlayed.add(casting.origin);
  const item = casting.item;
  if (item && item.k !== 0 && !state.catchup) notePlace(item, casting.position, duration);
}

/**
 * The device let go while the app could not hear it: the phone slept, and
 * the film came to its end or the television was turned off. Nothing plays
 * anywhere, and nothing starts here: the place last heard is from before
 * the sleep (the film began again from there, on an unlocked phone, an
 * hour after it had ended). A film that was running when last heard and
 * has had the time to reach its end is taken as seen; one paused then has
 * not moved.
 */
function lostAsleep(left) {
  const { item, position, duration, heardAt, running } = left;
  if (item && running && duration > 0 && !state.catchup && position + (Date.now() - heardAt) / 1000 >= duration * 0.96) noteEnded(item);
  if (shownHere(left)) leavePlayback();
}

/**
 * Nothing plays any more (js/playing.js renderNowSub): the viewer left
 * what the device was showing, by the logo or Stop, so the device stops
 * it too. The session stays, for the next thing chosen.
 */
export function castingLeft() {
  if (!casting?.item) return;
  stopAsked = casting.loading ? Infinity : Date.now();
  casting = null;
  cast.stop();
}

/**
 * The stream taken from the device for another player (js/externalui.js):
 * the device stops it, as the account's one connection is needed there,
 * and the place it had reached is returned, in whole seconds; null when
 * the device has nothing of this page's. VLC was handed a stream the
 * Chromecast went on playing, and Continue here went back to the place
 * before the hand-over. A channel has no place, and a film at its end
 * begins again, as placeReached has them.
 */
export function castTaken() {
  if (!casting?.item) return null;
  const { spec, position, duration } = casting;
  castingLeft();
  if (spec.live || !(position > 0) || (duration > 0 && duration - position < 10)) return 0;
  return Math.floor(position);
}

/** Every word from the app about the session or the media (app.js renderCastState). */
export function renderCasting() {
  if (!cast.native) return;
  const before = wasState;
  wasState = cast.state;
  const media = cast.media !== heard ? cast.media : null;
  heard = cast.media;

  if (cast.state === 'disconnected') {
    stopAsked = 0;
    if (before === 'disconnected') return;
    // The session ended, from the device's dialog, the page's button or
    // the network: what the device played plays on here.
    failed.clear();
    hlsPlayed.clear();
    hlsRefused.clear();
    const left = casting;
    casting = null;
    if (!left) return;
    // Ended while the phone slept (`stale`): see lostAsleep.
    if (cast.stale) lostAsleep(left);
    else if (left.item && state.playingSpec === left.spec) playHere(left, cast.position ?? left.position);
    // Only the session's own words are taken away: what the viewer has
    // started here since, or is starting (the device's answer about a
    // channel is still awaited), is not the device's to end.
    else if (!state.playing) leavePlayback();
    return;
  }
  if (!cast.connected) return;

  if (before !== 'connected' && !casting && state.playing && state.playingSpec) {
    // A device chosen while something plays here: it goes over, from
    // where the picture got to.
    handOver(state.playing, state.playingSpec, placeReached(state.playingSpec));
    return;
  }
  if (!casting) {
    // The device plays and this page knows nothing of it: the page was
    // loaded again during a session. The session's words are in the
    // player's pane, which a window of one pane then shows
    // (js/playerlayout.js): an upright phone showed the plain list, with
    // no sign of the session and no way to stop it.
    // Not what this page has just told the device to stop (stopAsked):
    // after the logo the start page flashed "Playing on …", and an upright
    // phone was thrown from the list to the player's pane.
    // An idle device has stopped; while a hand-over is unanswered its
    // idle word is of the stream before, which the new one interrupts.
    if (cast.media?.state === 'idle') { if (stopAsked !== Infinity) stopAsked = 0; }
    else if (!state.playing && cast.showing && Date.now() - stopAsked > STOP_MS) { casting = { item: null, loading: false }; showCasting(); updatePlayerLayout(); }
    return;
  }
  if (!media || casting.loading) return;
  if (media.state !== 'idle') { if (typeof media.position === 'number') notePosition(media); return; }
  if (media.reason === 'error') { deviceFailed(); return; }
  // Seen to its end, or stopped at the device: nothing plays anywhere,
  // and the player is empty again. `gone`: the app came back from a sleep
  // and the device has nothing on any more. A new stream handed over
  // interrupts the one before, and a session just begun has no media yet;
  // neither is an end.
  if (!['finished', 'stopped', 'gone'].includes(media.reason)) return;
  const left = casting;
  casting = null;
  if (media.reason === 'gone') { lostAsleep(left); return; }
  if (media.reason === 'finished') noteEnded(left.item);
  if (shownHere(left)) leavePlayback();
}
