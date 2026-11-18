// The cast session on the page, in the apps: the iPhone's and the iPad's, and
// Android's on a phone or a tablet
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

import { HLS_TYPE, castMedia } from './cast.js';
import { el } from './dom.js';
import { t } from './i18n.js';
import { renderInfoStrip } from './infostrip.js';
import { noteEnded, notePlace, startAutoNext } from './nextepisode.js';
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

/**
 * What the device can be handed of a stream, or null.
 *
 * An HLS playlist's server is not asked first whether it sends
 * Access-Control-Allow-Origin. It used to be, on the reasoning that the
 * device's player is a web page and would refuse a playlist without the
 * header, as most Xtream panels answer: but a Chromecast with Google TV,
 * handed such a channel all the same, played it (measured 2026-11-17,
 * neither the playlist nor its segments carried the header), and the
 * question had kept every channel of that provider off the device. So the
 * device is tried, and one that does refuse says so itself: the channel
 * plays here, and the server's other channels do not go round by the
 * device again (hlsRefused).
 */
function castable(spec) {
  const media = castMedia(spec);
  if (!media || media.contentType !== HLS_TYPE) return media;
  return hlsRefused.has(new URL(media.url).origin) ? null : media;
}

/**
 * The session's words written again, in the language of now: true when
 * there is a session to say. A change of language asks for whoever's
 * stream the device plays (js/languageui.js), as it writes the empty
 * player's words back into the overlay: "Nothing playing" stood over
 * Remote control and Stop casting, both still in the language before.
 * The empty player's page asks with `foundOnly` before it writes itself
 * there (renderIdleOverlay), for a session with nothing of this page's on
 * the device (a page loaded again during one): the app says the session
 * while the player still starts, and the start page is drawn again and
 * again after that. It must be told no while this page's own stream is on
 * the device.
 */
export function redrawCasting(foundOnly = false) {
  if (foundOnly ? !sessionFound() : !casting) return false;
  showCasting();
  return true;
}

/**
 * Whether a Chromecast plays for this page, so that nothing plays here:
 * the app is told that nothing is on (js/remote.js), or its notification
 * and the small window would stand for a picture that is on a television.
 */
export const castingNow = () => Boolean(casting);

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
  const media = castable(spec);
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
    // the app kept that stop until the device had taken the stream
    // (CastService, stopWhenLoaded) and has made it now.
    if (casting === sent) sent.loading = false;
    else if (!casting) stopAsked = Date.now();
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
 * viewer has chosen something else since: what the device then says of
 * the stream before is not the new one's to suffer. It ended a channel
 * before it had started anywhere, or put the old film in its place.
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
  if (!shownHere(left)) return;
  // An episode seen to its end on the device is followed by the next as
  // one that ended here is: the countdown, and playItem hands the episode
  // to the device (castOrPlay). The picture's own `ended` never comes.
  const next = media.reason === 'finished' && left.item?.k === 3 && state.settings.autoNext && !state.catchup;
  Promise.resolve(next && startAutoNext(left.item, leavePlayback)).then((counting) => { if (!counting && shownHere(left)) leavePlayback(); });
}
