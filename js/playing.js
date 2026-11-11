// @ts-check
// Playing an item: the engine's reports turned into what the overlay shows,
// what the account says when a stream fails (connections in use, an
// expired subscription), the player's other tabs that hold a connection,
// the wait and its countdown, and the start of playback itself.
//
// Moved out of app.js. It takes the player's state, and the parts app.js
// builds, from js/state.js; what runs while the modules load here uses only
// js/dom.js and the browser; everything else waits until the player calls
// in.

import { titleWithoutYear } from './titlemeta.js';
import { episodeLabel } from './seriesui.js';
import { $, el } from './dom.js';
import { poster } from './poster.js';
import { ApiError } from './api.js';
import { Playback } from './playback.js';
import { StalkerSource } from './stalker.js';
import { TYPE_OF_KIND, listName, stripItem, withCurrentAddress } from './coversui.js';
import { amount, clock, dateFmt, episodeCode, mbits, percent, seconds as secondsText, speed as speedText } from './format.js';
import { toast } from './toast.js';
import { grid, guideOpen } from './guideui.js';
import { hasDetails, loadVodDetails, renderInfoStrip } from './infostrip.js';
import { externalLabel, playExternal } from './externalui.js';
import { rememberSubtitleLanguage } from './playercontrols.js';
import { renderRecordingState, retryPlayback, warnRecordingConnection } from './recordingsui.js';
import { shareAs } from './streamhub.js';
import { streamUrl } from './xtream.js';
import { t } from './i18n.js';
import * as store from './config.js';
import { cast, groupOfType, noteChannel, offerAccess, playerLayout, refreshRows, renderSidebar, state, tabType, updateAddress, updatePlayerLayout, vlist } from './state.js';
import { cancelAutoNext } from './nextepisode.js';
import { leavePlayback, renderAudio, renderSubtitles, sizePicture } from './tracksui.js';

export const playback = new Playback(el.video, onPlaybackState);

function onPlaybackState(s) {
  if (s.status === 'playing') {
    clearLoadView();
    state.playbackInfoLoading = false;
    el.overlay.hidden = true;
    el.overlay.classList.remove('loading');
    showOverlayActions(null);
    renderNowSub();
    // Only the unpacking route reports its subtitles; on the others there
    // are none the player could show, and the details say so.
    if (!state.subtitleInfo && playback.engineKey !== 'remux') {
      state.subtitleInfo = { tracks: [], bitmap: 0 };
    }
    renderInfoStrip();
  } else if (s.status === 'loading') {
    state.playbackInfoLoading = true;
    renderInfoStrip();
    el.overlay.hidden = false;
    el.overlay.classList.add('loading');
    // A new step: the figures of the one before — the header read, an
    // engine that gave up — are not this one's.
    loadView.figures = null;
    showWait('start', t('progress.connecting'), playingName());
  } else if (s.status === 'buffering') {
    // The account of the download would cover the Play that the refused
    // start is waiting for.
    if (playback.blocked) return;
    renderBuffering(s);
  } else if (s.status === 'flowing') {
    // The stalled picture moves again.
    if (loadView.phase === 'stall') {
      clearLoadView();
      el.overlay.hidden = true;
      el.overlay.classList.remove('loading');
    }
  } else if (s.status === 'reconnecting') {
    showOverlayActions(null);
    el.overlay.hidden = false;
    el.overlay.classList.add('loading');
    el.overlayTitle.textContent = t('player.dropped');
    showCountdown(s);
  } else if (s.status === 'notice') {
    // Playback continues, but the viewer had better know why it will end
    // early.
    toast(s.message, { kind: 'warn', long: true });
  } else if (s.status === 'subtitles') {
    // The same list comes with every change of track; the details are
    // repainted for a new list only.
    if (!state.subtitleInfo || state.subtitleInfo.tracks !== s.tracks) {
      state.subtitleInfo = { tracks: s.tracks || [], bitmap: s.bitmap || 0 };
      renderInfoStrip();
    }
    renderSubtitles(s.tracks, s.active);
    // The change came from the browser's own subtitle menu: the same choice
    // as from the selector, so the language is remembered the same way.
    if (s.external) rememberSubtitleLanguage(s.active);
  } else if (s.status === 'audio') {
    renderAudio(s.tracks, s.active);
    renderInfoStrip();
  } else if (s.status === 'metadata') {
    renderInfoStrip();
  } else if (s.status === 'stable') {
    // Playback has held since the wait for a release: a later failure is a
    // new one, and the server may be counting our own stream again, so it
    // is worth a wait of its own.
    if (state.playingSpec) state.playingSpec.awaitedRelease = false;
  } else if (s.status === 'probing') {
    state.playbackInfoLoading = true;
    renderInfoStrip();
    el.overlay.hidden = false;
    el.overlay.classList.add('loading');
    loadView.figures = null;
    showWait('start', t('player.probing'), t('player.probing.text'));
  } else if (s.status === 'blocked') {
    // The overlay covers the picture and its controls: the play it asks
    // for is its own button. Before, it said "press play" over the very
    // button, and a channel restarted while Orion was in the background
    // could not be started again at all.
    showOverlayActions([{ label: t('rec.play'), primary: true, onClick: () => playback.playBlocked() }]);
    el.overlay.hidden = false;
    el.overlay.classList.remove('loading');
    el.overlayTitle.textContent = t('player.waiting');
    el.overlayText.textContent = s.message;
  } else if (s.status === 'error') {
    // Where a film or an archive programme stopped, for Retry to start
    // from there rather than from wherever the resume point last was —
    // or, for the archive, from the programme's beginning.
    if (state.playingSpec && s.position > 0) state.playingSpec.reached = s.position;
    // The download's figures stop with it; while the account is asked
    // below, only the time waited goes on.
    if (loadView.phase) { loadView.figures = null; renderLoadView(); }
    // Soon after a stream of ours was let go, a full account may be the
    // server still counting it: the account is asked before any failure
    // is shown, and a release waited for rather than reported.
    // An answer with nothing in it (s.content) is the provider having no
    // file for the title: neither a wait nor the account would change it.
    if (!s.checked && !s.content && !s.reachable && state.playingSpec && !state.playingSpec.awaitedRelease && playback.followedRelease) {
      checkBeforeFailing(s);
      return;
    }
    state.playbackInfoLoading = false;
    renderInfoStrip();
    el.overlay.hidden = false;
    el.overlay.classList.remove('loading');
    el.overlayTitle.textContent = t('player.failed');
    el.overlayText.textContent = s.message;
    // Only what this failure can use, so that the row fits a tablet. Try
    // again starts from where it stopped, which choosing the title again
    // does not do for an archive programme; right after it an external
    // player is worth the most, as the browser has already given up. Copy
    // address is in the ☰ menu. A provider without the file (s.content)
    // leaves nothing a retry or an external player could fetch, and a track
    // the browser cannot play (s.canSilent) fails the same way again.
    const actions = s.content ? [] : [
      ...(s.canSilent ? [] : [{ label: t('player.retry'), onClick: retryPlayback }]),
      { label: t(externalLabel()), onClick: playExternal },
    ];
    // The picture will do but the audio track will not: silent playback is
    // on offer, not the default.
    if (s.canSilent) {
      actions.unshift({
        label: t('player.silent'),
        onClick: () => state.playing && playItem(state.playing, { allowSilent: true }),
      });
    }
    showOverlayActions(actions);
    // The server let a request for the file through just now (reachable):
    // the account had room, and its count would only hold our own request.
    if (s.content || s.reachable) return;
    // Why it failed, when the account can say: a subscription that has run
    // out, or every connection already in use.
    explainFailure(s.message, s.cause);
    // A stream may point at a different server from the API, so the
    // permission is checked against this stream's own origin.
    if (state.playingSpec) {
      // A refused stream is the account, not a redirect — and a probe
      // would only hold another connection while it is full.
      offerAccess(state.playingSpec.url, actions, retryPlayback, { stream: !s.refused });
    }
  }
}

/* ------------------------------------------------- what the account says */

/**
 * The account's own trouble, in a sentence, or null when it has none.
 *
 * A subscription that has run out and an account whose connections are all
 * in use are the two commonest reasons an IPTV stream does not arrive, and
 * neither of them is in the stream's own error: the player is handed a
 * media error code or a connection that simply closes. Left unnamed, the
 * viewer is offered "try again" and "change the playback mode", which are
 * the two things that cannot help.
 *
 * @param {object|null} account
 * @param {{busy?: boolean}} [options] busy: whether to count connections as well. At connect
 *        time the count says nothing — no stream has been asked for yet —
 *        and only a failure makes it worth reading.
 */
export function accountProblem(account, { busy = false } = {}) {
  if (!account) return null;
  if (account.expiresAt && account.expiresAt < Date.now()) {
    return t('account.expired', { date: dateFmt.format(new Date(account.expiresAt)) });
  }
  if (account.status && !/^active$/i.test(String(account.status).trim())) {
    return t('account.inactive', { status: account.status });
  }
  if (busy && connectionsFull(account)) {
    return t('account.busy', { active: account.activeConnections, max: account.maxConnections });
  }
  return null;
}

function connectionsFull(account) {
  return Boolean(account && account.maxConnections && account.activeConnections >= account.maxConnections);
}

/**
 * The same, with the figures asked for again rather than remembered:
 * active_cons is a count at the moment it was read, and the moment that
 * matters is the one that just failed. One small request, and only after a
 * failure — never on the way to playing something.
 */
async function freshAccount() {
  if (!state.source) return null;
  try {
    const account = await state.source.account();
    state.account = account;
    return account;
  } catch { return null; }        // the account cannot say; the stream's own error stands
}

/**
 * The account's answer, added to a failure once it arrives. The message is
 * left alone if the situation has moved on in the meantime — the same check
 * offerAccess makes.
 *
 * A full account is not taken at its word, because the count may be of
 * this player's own connections: another tab of it, or the stream it closed
 * a moment ago, which the server goes on counting for a while. The first is
 * named and offered to be ended; the second is waited out once and the
 * playback started again, so that "in use" is said only when it is someone
 * else's.
 *
 * The account's reason takes the place of the failure's advice (cause is
 * the message without it): "change the playback mode" next to "every
 * connection is in use" told the viewer to try what cannot help.
 */
async function explainFailure(message, cause = message) {
  const spec = state.playingSpec;
  const shown = () => !el.overlay.hidden && el.overlayText.textContent === message && state.playingSpec === spec;
  const account = await freshAccount();
  if (!account || !shown()) return;
  // An account that has run out or been shut says so whatever the count.
  const trouble = accountProblem(account) || accountProblem(account, { busy: true });
  if (!trouble) return;
  if (accountProblem(account)) { el.overlayText.textContent = `${cause} ${trouble}`; return; }
  const figures = { active: account.activeConnections, max: account.maxConnections };
  if (await otherTabPlaying()) {
    if (!shown()) return;
    el.overlayText.textContent = `${cause} ${t('account.othertab', figures)}`;
    addOverlayAction({ label: t('player.playhere'), onClick: () => takeOver(spec, message, cause) }, { first: true });
    return;
  }
  el.overlayText.textContent = `${cause} ${spec && spec.awaitedRelease ? t('account.busy.waited', figures) : trouble}`;
}

const RELEASE_WAIT_MS = 20000;
const RELEASE_POLL_MS = 2000;

/** A failure that came soon after a release, held back while the account is asked. */
async function checkBeforeFailing(failure) {
  const spec = state.playingSpec;
  const account = await freshAccount();
  if (state.playingSpec !== spec) return;
  if (connectionsFull(account) && !accountProblem(account) && !(await otherTabPlaying())) {
    if (state.playingSpec !== spec) return;
    awaitRelease(spec, failure, { active: account.activeConnections, max: account.maxConnections });
    return;
  }
  // A live stream refused, cut or left silent while the account was full,
  // and by now the account has room: the stream it was counting has gone —
  // the start timeout alone outlasts the provider's count — and the same
  // stream is asked for once more. The replay is marked as waited, so it
  // is the only one.
  if (failure.refused && account && !accountProblem(account) && !connectionsFull(account)) {
    replay();
    return;
  }
  if (state.playingSpec === spec) onPlaybackState({ ...failure, checked: true });
}

/**
 * The server is still counting a connection this player has closed: the
 * account is asked again every couple of seconds, and the playback starts
 * once a connection is free. Waited out, the failure is shown as it was,
 * now saying that the connection is not ours.
 */
async function awaitRelease(spec, failure, figures) {
  spec.awaitedRelease = true;
  const wait = { spec };
  releaseWait = wait;
  el.overlay.classList.add('loading');
  el.overlayTitle.textContent = t('account.releasing.title');
  el.overlayText.textContent = t('account.releasing', figures);
  showOverlayActions(null);
  // The viewer moving on ends the wait, and so does another tab that was
  // given the connection meanwhile.
  const over = () => state.playingSpec !== spec || releaseWait !== wait;
  try {
    const until = Date.now() + RELEASE_WAIT_MS;
    while (Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, RELEASE_POLL_MS));
      if (over()) return;
      const account = await freshAccount();
      if (over()) return;
      if (account && !connectionsFull(account)) { replay(); return; }
    }
    onPlaybackState({ ...failure, checked: true });
  } finally {
    if (releaseWait === wait) releaseWait = null;
  }
}

// The wait for a release under way, if any. It holds no connection yet, but
// it will take one when it ends: to the other tabs it is holding, and one
// that asks for the connection ends it.
let releaseWait = null;

/** The same thing again, without a second wait should it fail the same way. */
function replay() {
  retryPlayback();
  if (state.playingSpec) state.playingSpec.awaitedRelease = true;
}

/* ------------------------------------------------ the player's other tabs */

// Every tab of the player shares the account's connections, and a tab can
// ask the others whether one of them holds one: a tab of our own can be
// named and ended, where another device can only be guessed at.
export const tabs = typeof BroadcastChannel === 'function' ? new BroadcastChannel('kepuli-playback') : null;
const TAB_ANSWER_MS = 400;

// The messages name the account they are about: a tab on another account
// holds none of this account's connections, and must neither be named as
// the one in the way nor stopped to make room.
if (tabs) {
  tabs.addEventListener('message', ({ data }) => {
    if (!data || !(playback.holding || releaseWait)) return;
    if (data.account !== store.currentAccount()) return;
    if (data.type === 'ask') tabs.postMessage({ type: 'holding', id: data.id });
    else if (data.type === 'yield') {
      releaseWait = null;
      playback.stop();
      showMovedAway();
      tabs.postMessage({ type: 'yielded', id: data.id });
    }
  });
}

/** Whether another tab of the player answers that it holds a connection. */
function otherTabPlaying() {
  return tabMessage('ask', 'holding');
}

function tabMessage(type, answer) {
  if (!tabs) return Promise.resolve(false);
  const id = `${Date.now()}:${Math.random()}`;
  return new Promise((resolve) => {
    const listen = ({ data }) => { if (data && data.type === answer && data.id === id) done(true); };
    const timer = setTimeout(() => done(false), TAB_ANSWER_MS);
    function done(value) {
      clearTimeout(timer);
      tabs.removeEventListener('message', listen);
      resolve(value);
    }
    tabs.addEventListener('message', listen);
    tabs.postMessage({ type, id, account: store.currentAccount() });
  });
}

/** The other tab stops, and this one plays once the server has let go. */
async function takeOver(spec, message, cause) {
  if (state.playingSpec !== spec) return;
  await tabMessage('yield', 'yielded');
  if (state.playingSpec !== spec) return;
  const account = await freshAccount();
  if (state.playingSpec !== spec) return;
  if (account && connectionsFull(account)) {
    awaitRelease(spec, { status: 'error', message, cause }, { active: account.activeConnections, max: account.maxConnections });
  } else {
    replay();
  }
}

function showMovedAway() {
  state.playbackInfoLoading = false;
  renderInfoStrip();
  el.overlay.hidden = false;
  el.overlay.classList.remove('loading');
  el.overlayTitle.textContent = t('player.elsewhere');
  el.overlayText.textContent = t('player.elsewhere.text');
  showOverlayActions([{ label: t('player.playhere'), onClick: retryPlayback }]);
}

/* --------------------------------------------- how the wait is going */

// After this long a wait is counted on screen and a start may be
// cancelled: the viewer sees it has not stuck, and has a way out of it.
const WAIT_SHOW_MS = 10000;

// The wait the overlay is telling of: a start (from the first request to
// the picture, across the engines tried) or a stall mid-playback. Its
// clock runs once a second for the time waited; the figures come with the
// player's 'buffering' state.
const loadView = { phase: null, since: 0, clock: null, cancel: false, figures: null };
const countdown = { timer: null };

function playingName() {
  return state.playing ? state.playing.displayName || state.playing.n : '';
}

/**
 * A wait begun or carried on: the title and text say its step, and the
 * time waited is kept from the step that began it.
 */
function showWait(phase, title, text) {
  if (loadView.phase !== phase) {
    // Any other account the overlay had — and its buttons — goes first.
    showOverlayActions(null);
    loadView.phase = phase;
    loadView.since = Date.now();
    loadView.cancel = false;
    loadView.figures = null;
    loadView.clock = setInterval(renderLoadView, 1000);
  }
  el.overlay.classList.add('waiting');
  el.overlay.classList.toggle('stall', phase === 'stall');
  el.overlayTitle.textContent = title;
  el.overlayText.textContent = text;
  renderLoadView();
}

function renderBuffering(s) {
  if (s.phase === 'stall') {
    el.overlay.hidden = false;
    el.overlay.classList.add('loading');
    showWait('stall', t('player.buffering'), '');
  } else if (s.phase === 'probe') {
    el.overlay.hidden = false;
    el.overlay.classList.add('loading');
    const title = s.total ? t('player.probing.pct', { pct: percent(s.loaded / s.total) }) : t('player.probing');
    showWait('start', title, t('player.probing.text'));
  } else {
    el.overlay.hidden = false;
    el.overlay.classList.add('loading');
    const pct = s.total ? percent(s.loaded / s.total) : null;
    const title = !pct ? t('player.buffering')
      : s.stage === 'index' ? t('player.index.pct', { pct })
        : t('player.buffering.pct', { pct });
    showWait('start', title, playingName());
  }
  loadView.figures = s;
  renderLoadView();
}

/**
 * The figures of the wait. The bar is the share of the bytes the picture
 * waits for when their total is known, or else the download's speed
 * against the film's bit rate — amber when the connection is too slow.
 * Under it the bytes, and the speed against what the film needs; without
 * a bit rate the speed stands with the bytes, and a connection too slow
 * is said in words. Past WAIT_SHOW_MS the time waited shows beside the
 * title and, for a start, Cancel.
 */
function renderLoadView() {
  if (!loadView.phase) return;
  const f = loadView.figures;
  const rate = f && f.bitrate && f.speed != null;
  const parts = [];
  if (f) {
    if (f.total) parts.push(`${amount(f.loaded)} / ${amount(f.total)}`);
    else if (f.loaded > 0) parts.push(amount(f.loaded));
    if (f.speed != null && !rate) parts.push(speedText(f.speed));
    if (f.loaded == null && f.ahead > 0.05) parts.push(t('player.buffered', { seconds: secondsText(f.ahead) }));
  }
  el.overlayFigures.textContent = parts.join(', ');
  el.overlayFigures.hidden = !parts.length;
  const slow = Boolean(f && f.slow);
  const share = f && f.total ? Math.min(1, f.loaded / f.total)
    : rate ? Math.min(1, (f.speed * 8) / f.bitrate) : null;
  el.overlayBar.hidden = share == null;
  el.overlayBar.classList.toggle('slow', share != null && !f.total && slow);
  if (share != null) {
    el.overlayBarFill.style.width = `${(share * 100).toFixed(1)}%`;
    el.overlayBar.setAttribute('aria-valuenow', String(Math.round(share * 100)));
  }
  if (rate) {
    // The speed's figure alone is amber, not its unit: "0,40 Mbit/s".
    const [before, after] = t('player.rate', { speed: '\u0000' }).split('\u0000');
    const value = document.createElement('span');
    value.className = slow ? 'value slow' : 'value';
    value.textContent = mbits(f.speed * 8);
    el.overlaySpeed.replaceChildren(before, value, after);
    el.overlayNeed.textContent = t('player.need', { need: mbits(f.bitrate) });
  } else {
    el.overlaySpeed.textContent = slow ? t('player.slow') : '';
    el.overlayNeed.textContent = '';
  }
  el.overlaySlow.classList.toggle('only', !rate && slow);
  el.overlaySlow.hidden = !rate && !slow;
  const waited = Date.now() - loadView.since;
  const long = waited >= WAIT_SHOW_MS;
  el.overlayElapsed.hidden = !long;
  if (long) el.overlayElapsed.textContent = t('player.waited', { seconds: Math.floor(waited / 1000) });
  el.overlayLoad.hidden = el.overlayFigures.hidden && el.overlaySlow.hidden && el.overlayBar.hidden;
  // A stall is left to the player's own controls; a start that has gone
  // on this long may be given up.
  if (long && loadView.phase === 'start' && !loadView.cancel) {
    loadView.cancel = true;
    addOverlayAction({ label: t('progress.cancel'), onClick: leavePlayback });
  }
}

/** The wait is over, whichever way: its account leaves the overlay. */
function clearLoadView() {
  if (loadView.clock) clearInterval(loadView.clock);
  loadView.phase = null;
  loadView.clock = null;
  loadView.figures = null;
  loadView.cancel = false;
  el.overlayLoad.hidden = true;
  el.overlayElapsed.hidden = true;
  // Emptied as well as hidden: the overlay's next account reads cleaner
  // without the last wait's figures left in it.
  for (const line of [el.overlayFigures, el.overlaySpeed, el.overlayNeed, el.overlayElapsed]) line.textContent = '';
  el.overlay.classList.remove('stall', 'waiting');
  stopCountdown();
}

/** The reconnect's wait, counted down to the next attempt. */
function showCountdown(s) {
  clearLoadView();
  const render = () => {
    const left = Math.ceil(((s.at || 0) - Date.now()) / 1000);
    const retry = left > 0
      ? t('player.retrying.in', { seconds: left, attempt: s.attempt, max: s.max })
      : t('player.retrying', { attempt: s.attempt, max: s.max });
    el.overlayText.textContent = (s.reason ? `${s.reason}, ` : '') + retry;
    if (left <= 0) stopCountdown();
  };
  render();
  if (s.at > Date.now()) countdown.timer = setInterval(render, 250);
}

function stopCountdown() {
  if (countdown.timer) { clearInterval(countdown.timer); countdown.timer = null; }
}

export function showOverlayActions(actions) {
  // Whatever the overlay says now, it is no longer the empty player's —
  // nor the account of a wait, which sets its own buttons after this.
  clearLoadView();
  el.idleHome.hidden = true;
  el.overlayActions.replaceChildren();
  el.overlayActions.hidden = !actions || !actions.length;
  for (const action of actions || []) addOverlayAction(action);
}

export function addOverlayAction(action, { first = false } = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = action.primary ? 'primary' : 'ghost';
  if (action.id) button.id = action.id;
  button.textContent = action.label;
  if (action.title) button.title = action.title;
  button.addEventListener('click', action.onClick);
  if (first) el.overlayActions.prepend(button); else el.overlayActions.appendChild(button);
  el.overlayActions.hidden = false;
}

let playRun = 0;
/** A new play run: whatever an earlier start is still waiting for is left behind. */
export function newPlayRun() { return ++playRun; }

/**
 * The address to play an item from. A Stalker portal is asked for it now
 * (its links carry a token); everything else has it in the item already.
 */
export async function itemAddress(item, config = state.config, source = state.source) {
  if (config.type === 'stalker') {
    // The connected portal's session, when it is the same account: a new
    // one would shake hands again.
    const portal = source instanceof StalkerSource && store.accountKey(source.config) === store.accountKey(config) ? source : new StalkerSource(config);
    return portal.resolveUrl(item);
  }
  return streamUrl(config, item, 'ts');
}

/** A channel's place in the shared connections (js/streamhub.js). */
export const channelKey = (config, item) => `${store.accountKey(config)}|${item.k}:${item.id}`;

/**
 * @param {object} item
 * @param {{startAt?: number, allowSilent?: boolean}} [options]
 */
export async function playItem(item, { startAt, allowSilent } = {}) {
  // Snapshot the visible name so later browsing cannot rename playback.
  const cleaned = listName(item);
  // A film's year is in its details under the picture; at the end of the
  // title as well it only pushed the title's own words out of the line.
  const displayName = item.k === 1 || item.k === 2 ? titleWithoutYear(cleaned, item.year) : cleaned;
  item = withCurrentAddress({ ...item, displayName });
  const live = item.k === 0;
  const run = ++playRun;
  const stalker = state.config.type === 'stalker';
  let url;
  try {
    url = await itemAddress(item);
  } catch (err) {
    if (run !== playRun) return;
    toast(err instanceof ApiError ? err.message : t('player.nourl'), { kind: 'error', long: true });
    return;
  }
  if (run !== playRun) return;
  if (!url) { toast(t('player.nourl'), { kind: 'error' }); return; }
  const key = `${item.k}:${item.id}`;
  const saved = state.resume.get(key);
  // A live channel's stream is read once for the player and a recording
  // of it alike: the account's one connection does for both.
  const shared = live ? channelKey(state.config, item) : null;
  if (shared) shareAs(url, shared);
  const config = state.config;
  const spec = {
    url,
    relink: stalker ? async () => {
      const next = await itemAddress(item, config);
      if (shared) shareAs(next, shared);
      return next;
    } : null,
    ext: stalker && !live ? (/\.([a-z0-9]{2,4})(?:[?#]|$)/i.exec(new URL(url).pathname)?.[1] || item.ext || '').toLowerCase() : item.ext,
    hlsUrl: live && !item.direct && !stalker ? streamUrl(state.config, item, 'm3u8') : null,
    live,
    mode: el.mode.value,
    allowSilent: Boolean(allowSilent),
    subtitleLang: state.settings.subtitleLang,
    audioLang: state.settings.audioLang,
    startAt: startAt ?? (state.settings.resumeEnabled && !live && saved ? saved.position : 0),
  };

  cancelAutoNext();
  if (live) noteChannel(item);
  else if (item.k === 1) state.routeMovie = String(item.id);
  warnRecordingConnection(item);
  state.playing = item;
  sizePicture();
  updatePlayerLayout();
  playerLayout.showPlayer();
  state.playingSpec = spec;
  state.playbackInfoLoading = !live;
  item.detailsLoading = hasDetails(item) && !item.details;
  state.catchup = null;
  $('btn-live').hidden = true;
  el.mode.disabled = false;
  // Clear the previous file's tracks: the new ones arrive only once the
  // header has been read.
  renderSubtitles([], null);
  renderAudio([], null);
  state.subtitleInfo = null;
  el.nowTitle.textContent = nowTitle(item);
  el.nowTitle.title = item.n;
  renderNowLogo(item);
  renderNowSub();
  updateAddress();
  if (guideOpen) grid.setPlaying(live ? item.id : null);

  playback.play(spec);
  vlist.refresh();

  if (live && state.epg) state.epg.want(item, { priority: true });
  renderInfoStrip();
  if (!live) loadVodDetails(item);
  const recents = await store.pushRecent(stripItem(item));
  if (!recents) return;
  state.recents = recents;
  if (state.tab === 'recent') { renderSidebar(); refreshRows({ keepScroll: true }); }
}

// The line under the title says where the thing being played sits — the
// category, the episode, whether it comes from the archive. Which engine
// carries it does not belong here: "mpegts.js" names a library, and no
// choice the viewer has to make depends on knowing it.
/**
 * The title over the picture. An episode is named with its series
 * ("Supporting Actor – Episode 2", "1670 – Episode 1: Sarmatian Exam"):
 * its row in the series' page says only its own part, the page saying the
 * rest, but over the picture it stood alone. The episode's word follows
 * the interface language.
 * @param {any} item
 */
function nowTitle(item) {
  if (item.k !== 3) return item.displayName || item.n;
  const { label } = episodeLabel(item.n, item.episode, [item.seriesName || '']);
  return item.seriesName ? `${item.seriesName} – ${label}` : label;
}

/** The title again in a new interface language; only an episode's changes. */
export function renderNowTitle() {
  if (state.playing?.k === 3 && !state.catchup) el.nowTitle.textContent = nowTitle(state.playing);
}

export function renderNowSub() {
  renderRecordingState();
  const item = state.playing;
  if (!item) { el.nowSub.textContent = t('player.idle'); return; }
  const bits = [];
  // The item's own kind, not the tab's: from the favourites or the history
  // a channel still names its category.
  const type = TYPE_OF_KIND[item.k] || tabType();
  if (state.catchup) bits.push(t('player.catchup', { time: clock(state.catchup.start) }));
  // A channel's category says its country and its topic ("Finland -
  // Sport"); a film's or a series' says "Movies: Finland", of which the
  // group alone, as the sidebar names it, is the part that tells anything.
  if (item.cats && item.cats.length && state.lib && type) {
    const group = type === 'live' ? null : item.cats.map((cat) => groupOfType(type).get(cat)).find(Boolean);
    bits.push(group || state.lib.categoryName(type, item.cats[0]));
  }
  if (item.k === 3) bits.push(episodeCode(item.season, item.episode));
  if (cast.connected) bits.push(t('cast.playing'));
  el.nowSub.textContent = bits.filter(Boolean).join(', ') || '—';
}

/**
 * The channel's logo before the name above the picture, the one its row in
 * the list shows, or the same television mark where it has none. A film, an
 * episode or a recording has no logo there (item null or not a channel).
 */
export function renderNowLogo(item) {
  const channel = item && item.k === 0 ? item : null;
  const logo = channel ? poster('now-logo', channel.logo, 'channel') : document.createElement('span');
  logo.id = 'now-logo';
  if (!channel) { logo.className = 'now-logo'; logo.hidden = true; }
  $('now-logo').replaceWith(logo);
}
