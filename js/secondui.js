// The second picture: another live channel beside the one being watched.
//
// A football match and the other one, the news while the film's adverts
// run. It takes a connection of its own, so it is offered only where one
// is to be had (secondAccounts in js/config.js): the account allows two
// streams at once, or the viewer has entered another account. From this
// It is opened the same way either way, from a channel's row menu: with
// two streams on this account the channel plays at once; otherwise it
// plays through another account, the viewer's choice when there are
// several, where the same channel is looked up by name (secondFor). The
// ☰ menu's item reaches what the list on screen does not hold: another
// account's own favourite and lately watched channels.
//
// It is a player of its own (Playback in js/playback.js) on a video of
// its own, in the right half of the picture's box, so that full screen
// takes both. It does only what a second picture needs: live channels,
// the automatic engine choice, the reconnections Playback makes by
// itself, and a word over the picture while it waits or when it fails.
// Sound comes from one picture at a time, the first until asked.
//
// What runs while the modules load here uses only js/dom.js and the
// browser; the rest waits until the player calls in.

import { $, el } from './dom.js';
import { Playback } from './playback.js';
import { ApiError } from './api.js';
import { itemAddress } from './playing.js';
import { openRowMenu } from './rowmenu.js';
import { toggleFullscreen } from './playercontrols.js';
import { sizePicture } from './tracksui.js';
import { streamUrl } from './xtream.js';
import { toast } from './toast.js';
import { t } from './i18n.js';
import * as store from './config.js';
import { sourceFor, state } from './state.js';
import { Epg } from './epg.js';
import { poster } from './poster.js';
import { renderInfoStrip } from './infostrip.js';
import { openSetup } from './setupui.js';
import { Library } from './library.js';
import { matchChannel } from './name.js';

const pane = $('second');
const video = /** @type {HTMLVideoElement} */ ($('video2'));
const note = $('second-note');
const retry = $('second-retry');
const soundButton = $('second-sound');
const menuItem = $('btn-second');

// The channels offered from one account: a menu, not a catalogue.
const OFFERED = 12;

// Exported for dev/livesoak.mjs, which reads its reconnections.
export const second = new Playback(video, onState);
/** @type {{ item: any, config: any, spec: any, epg: Epg|null }|null} */
let showing = null;
let run = 0;

export const secondShowing = () => Boolean(showing);

/**
 * Whether the item is the channel the second picture shows: of this
 * account, or played through another account of the same server, where
 * the same id is the same channel (playThrough). Measured on a real
 * provider: the second picture's channel started in the first went on in
 * both, one through each account.
 */
const isShown = (item) => Boolean(showing && item && item.k === 0 && String(item.id) === String(showing.item.id)
  && (store.accountKey(showing.config) === store.accountKey(state.config) || store.sameServer(showing.config, state.config)));

/** The accounts a second picture can come from now. */
const sources = () => store.secondAccounts(state.config, state.account?.maxConnections, state.accounts || []);

/** Whether a channel of the list may be played beside the one playing. */
export function secondOffered(item) {
  return Boolean(state.playing) && item.k === 0 && sources().length > 0
    && !(state.playing.k === 0 && String(state.playing.id) === String(item.id)) && !isShown(item);
}

/**
 * A channel of the list into the second picture: the row menu's item, the
 * same whatever gives the connection. This account does when it allows
 * two streams, without a question. Otherwise another account has to, and
 * with several of them the viewer says which.
 * @param {any} item
 * @param {{ x: number, y: number } | Element} at where the row's menu was opened
 */
export function secondFor(item, at) {
  const from = sources();
  const here = store.accountKey(state.config);
  if (from.some((config) => store.accountKey(config) === here)) { playSecond(item); return; }
  if (from.length === 1) { playThrough(item, from[0]); return; }
  const items = from.map((config) => ({ label: store.accountLabel(config), onClick: () => playThrough(item, config) }));
  openRowMenu(at, items, { heading: t('second.account'), returnFocus: el.list });
}

/**
 * The channel played with another account's connection. On the same
 * server under another user it is the same channel by its id. On another
 * server it is looked up in that account's own channels — its list from
 * this browser's cache, or asked of its server — by name, and when it is
 * not there the viewer is told so rather than shown something else.
 */
async function playThrough(item, config) {
  if (store.sameServer(config, state.config)) { playSecond(item, config); return; }
  const mine = ++run;
  let channels;
  try {
    channels = await new Library(sourceFor(config), store.accountKey(config)).ensureFull('live');
  } catch (err) {
    if (mine === run) toast(err instanceof ApiError ? err.message : t('player.nourl'), { kind: 'error', long: true });
    return;
  }
  if (mine !== run) return;
  const found = matchChannel(item, channels);
  if (found) playSecond(found, config);
  else toast(t('second.missing', { name: item.displayName || item.n || '', account: store.accountLabel(config) }), { long: true });
}

function onState(s) {
  if (s.status === 'playing' || s.status === 'flowing') {
    note.hidden = true;
  } else if (s.status === 'notice') {
    // Its own seek bar dragged to before what is kept (keepToBuffer).
    toast(s.message, { kind: 'warn', long: true });
  } else if (s.status === 'buffering') {
    // A picture that stands still says why, as the first one does.
    if (!second.blocked) say(t('player.buffering'));
  } else if (s.status === 'loading' || s.status === 'probing' || s.status === 'reconnecting') {
    say(t('progress.connecting'));
  } else if (s.status === 'blocked') {
    // The picture is muted, which every browser lets start by itself; one
    // that still refuses is asked again from the viewer's press.
    say(s.message, true);
  } else if (s.status === 'error') {
    say(s.message, true);
  }
}

function say(text, offerRetry = false) {
  note.firstElementChild.textContent = text;
  retry.hidden = !offerRetry;
  note.hidden = false;
}

/**
 * A channel into the second picture, from the account in use or another.
 * @param {any} item
 * @param {any} [config]
 */
export async function playSecond(item, config = state.config) {
  const mine = ++run;
  let url;
  try {
    url = await itemAddress(item, config);
  } catch (err) {
    if (mine === run) toast(err instanceof ApiError ? err.message : t('player.nourl'), { kind: 'error', long: true });
    return;
  }
  if (mine !== run) return;
  if (!url) { toast(t('player.nourl'), { kind: 'error' }); return; }
  const stalker = config.type === 'stalker';
  const spec = {
    url,
    relink: stalker ? () => itemAddress(item, config) : null,
    ext: item.ext,
    hlsUrl: !item.direct && !stalker ? streamUrl(config, item, 'm3u8') : null,
    live: true,
    mode: 'auto',
  };
  showing = { item, config, spec, epg: programmesOf(config) };
  $('second-name').textContent = item.displayName || item.n || '';
  pane.hidden = false;
  el.videowrap.classList.add('split');
  sizePicture();
  renderSound();
  renderHead();
  renderInfoStrip();
  second.play(spec);
}

/** The second picture let go of, and the sound back where it was. */
export function closeSecond() {
  run++;
  if (!showing) return;
  showing = null;
  second.stop();
  if (!video.muted) el.video.muted = false;
  video.muted = true;
  pane.hidden = true;
  note.hidden = true;
  el.videowrap.classList.remove('split');
  setSwapped(false);
  sizePicture();
  renderHead();
  renderInfoStrip();
}

/* The second picture's half of the title bar and of the details. */

/**
 * The channel's programmes, asked of its own account: this account's
 * connection to the server, or the other account's. Kept apart from the
 * list's (state.epg), whose queue follows what the list shows.
 */
function programmesOf(config) {
  if (!state.settings.epgEnabled) return null;
  const own = store.accountKey(config) === store.accountKey(state.config);
  return new Epg(own && state.source ? state.source : sourceFor(config), () => renderInfoStrip());
}

/** Its logo, name and where it comes from, over its picture as the first one's are. */
function renderHead() {
  const head = $('now2');
  head.hidden = !showing;
  if (!showing) return;
  const { item, config } = showing;
  const logo = poster('now-logo', item.logo, 'channel');
  logo.id = 'now2-logo';
  $('now2-logo').replaceWith(logo);
  $('now2-title').textContent = item.displayName || item.n || '';
  $('now2-title').title = item.n || '';
  // This account's channel names its category, as the first picture's
  // does; another account's is named by the account it plays through.
  const own = store.accountKey(config) === store.accountKey(state.config);
  const category = own && state.lib && item.cats?.length ? state.lib.categoryName('live', item.cats[0]) : '';
  $('now2-sub').textContent = (own ? category : store.accountLabel(config)) || '—';
}

/**
 * The details in two halves while the second picture is on: what the
 * strip holds stays under the first picture, and the second channel's
 * programme goes under its own. Called at the end of every painting of
 * the strip (js/infostrip.js), which hands over how a programme is drawn.
 * @param {HTMLElement} strip
 * @param {(entry: { now: any, next: any }) => DocumentFragment} programmePart
 */
export function splitDetails(strip, programmePart) {
  strip.classList.toggle('split', Boolean(showing));
  if (!showing) return;
  // Asked again whenever the strip is painted: nothing is fetched while
  // what is known still covers the present.
  showing.epg?.want(showing.item, { priority: true });
  const entry = showing.epg?.nowNext(showing.item.id);
  const halves = [document.createElement('div'), document.createElement('div')];
  for (const half of halves) half.className = 'info-half';
  if (!strip.hidden) halves[0].append(...strip.childNodes);
  if (entry && (entry.now || entry.next)) halves[1].append(programmePart(entry));
  if (!halves[0].hasChildNodes() && !halves[1].hasChildNodes()) return;
  // A half with nothing in it beside one that has a programme looked like
  // a fault. It says that the channel has no programme data, once that is
  // known: the provider names no guide for it, or was asked and had none.
  const known = (epg, item) => item?.k === 0 && (!item.epgId || Boolean(epg?.cache.has(String(item.id))));
  const lacking = [known(state.epg, state.playing), known(showing.epg, showing.item)];
  halves.forEach((half, i) => {
    if (half.hasChildNodes() || !lacking[i]) return;
    const none = document.createElement('div');
    none.className = 'info-none';
    none.textContent = t('guide.noepg.channel');
    half.append(none);
  });
  strip.replaceChildren(...halves);
  strip.hidden = false;
}

/** The first picture starts an item: the same channel twice is one too many. */
export function firstPlays(item) {
  if (isShown(item)) closeSecond();
  if (item.k === 0) hintOnce();
}

/* Sound from one picture at a time. */

function renderSound() {
  soundButton.setAttribute('aria-pressed', String(!video.muted));
  pane.classList.toggle('sound', !video.muted);
}

function moveSound(toSecond) {
  video.volume = el.video.volume;
  video.muted = !toSecond;
  el.video.muted = toSecond;
  renderSound();
}

soundButton.addEventListener('click', () => moveSound(video.muted));
// The first picture's own controls unmute it: the sound has then moved
// back, rather than two channels talking over each other.
el.video.addEventListener('volumechange', () => {
  if (showing && !el.video.muted && !video.muted) { video.muted = true; renderSound(); }
});
// And the second picture's own controls unmute that one: the first goes
// quiet, and the speaker says where the sound is now.
video.addEventListener('volumechange', () => {
  if (showing && !video.muted && !el.video.muted) el.video.muted = true;
  renderSound();
});
$('second-close').addEventListener('click', closeSecond);

// A click on the picture does not pause it, as it does not pause the first
// picture's live channel (clickPicture in js/playercontrols.js): there is
// nothing to come back to, and a paused second picture goes on holding
// its connection and filling its buffer unseen. Stopped before the
// browser's controls see it; the strip at the bottom, where their own
// buttons are, is left to them, pause included. In a real run a second
// picture paused this way sat still for eleven minutes of thirty.
const CONTROL_BAR_PX = 80;
pane.addEventListener('click', (e) => {
  if (e.target !== video || e.button !== 0 || e.offsetY > video.clientHeight - CONTROL_BAR_PX) return;
  e.preventDefault();
  e.stopPropagation();
}, true);

// The pictures change sides. Only where they are drawn: each stream plays
// on untouched, which a real exchange of the two channels would not allow
// — both would connect again, and a channel of another account cannot be
// the first picture at all. Each half of the title bar and of the details
// goes with its picture (.swapped in css/playback.css).
$('second-swap').addEventListener('click', () => setSwapped(!el.videowrap.classList.contains('swapped')));
function setSwapped(on) {
  for (const part of [el.videowrap, $('now2').parentElement, el.infostrip]) part.classList.toggle('swapped', on);
}

// Both pictures full screen: their box goes there, as with f. The button
// says which way it goes, whoever changed it.
const fullButton = $('second-full');
fullButton.addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', () => {
  const key = document.fullscreenElement === el.videowrap ? 'screen.leave' : 'screen.enter';
  fullButton.dataset.i18nLabel = fullButton.dataset.i18nTitle = key;
  fullButton.setAttribute('aria-label', t(key));
  fullButton.title = t(key);
});
retry.addEventListener('click', () => {
  if (!showing) return;
  if (second.blocked) second.playBlocked(); else second.play(showing.spec);
});

/* The ☰ menu's item, and the choice it opens. */

/**
 * The item as the menu opens: there whenever something plays, also where
 * no second picture can be had — its press then says what it would take,
 * which a hidden item never told anyone.
 */
export function renderSecondItem() {
  menuItem.hidden = !showing && !state.playing;
  const key = showing ? 'second.close' : 'second.open';
  const label = menuItem.querySelector('span');
  label.dataset.i18n = key;
  label.textContent = t(key);
}

/**
 * The choice the ☰ menu's item opens. The connection is an account's, so
 * with several accounts to take it from the account is chosen first, by
 * the name the viewer gave it, and then one of its channels; with one,
 * its channels come at once.
 */
function offerSecond() {
  const from = sources();
  if (from.length === 1) { offerChannels(from[0]); return; }
  const items = from.map((config) => ({ label: store.accountLabel(config), onClick: () => offerChannels(config) }));
  openRowMenu(el.more, items, { heading: t('second.open'), returnFocus: el.more });
}

/**
 * An account's channels to choose from: its favourites and the ones
 * watched lately, under the account's name.
 */
async function offerChannels(config) {
  const own = store.accountKey(config) === store.accountKey(state.config);
  const items = (await store.loadChannelsOf(config))
    .filter((item) => !own || !(state.playing?.k === 0 && String(state.playing.id) === String(item.id)))
    .slice(0, OFFERED)
    .map((item) => ({ label: item.displayName || item.n || '', onClick: () => playSecond(item, config) }));
  if (!items.length) { toast(t('second.none'), { long: true }); return; }
  openRowMenu(el.more, items, { heading: store.accountLabel(config), returnFocus: el.more });
}

// After the ☰ menu has closed itself on the same click and taken the focus
// to its button: the choice opens over it, and takes the focus from there.
menuItem.addEventListener('click', () => {
  if (showing) closeSecond();
  else if (sources().length) setTimeout(offerSecond);
  else explainNeed();
});

/* Telling the viewer about it. */

/** Whether a second picture can be had now: for the subscription's details in Settings. */
export const secondAvailable = () => sources().length > 0;

/**
 * No connection for a second picture: what it takes, and the way there.
 * An account that says it allows one is told so; one that says nothing of
 * its connections (a playlist, a portal) is not claimed to.
 */
function explainNeed() {
  toast(t(state.account?.maxConnections ? 'second.need' : 'second.need.unknown'), {
    long: true,
    action: { label: t('accounts.add'), onClick: () => openSetup({ section: 'connection', adding: true }) },
  });
}

// Once, the first time a channel plays where a second picture can be had:
// nothing on the screen says the row's menu holds it. Kept with the
// interface's own state, in this browser.
let hinted = false;
async function hintOnce() {
  if (hinted || !sources().length) return;
  hinted = true;
  if ((await store.loadUiState()).secondHint) return;
  store.saveUiState({ secondHint: true });
  toast(t('second.hint'), { duration: 10000 });
}
