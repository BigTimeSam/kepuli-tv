// @ts-check
// The place a film or an episode was left at, saved while it plays; the
// next episode and its countdown at the end of one; the badge of the
// stream's figures on the picture.
//
// Moved out of app.js. It takes the player's state, and the parts app.js
// builds, from js/state.js; the listeners and timers set up while the
// modules load here use only js/dom.js, and call into app.js only when they
// fire.

import { closeGuide } from './guideui.js';
import { duration, episodeCode, nf } from './format.js';
import { el } from './dom.js';
import { episodeLabel, openSeries, renderDetail } from './seriesui.js';
import { playItem, playback, showOverlayActions } from './playing.js';
import { renderInfoStrip } from './infostrip.js';
import { t } from './i18n.js';
import { toast } from './toast.js';
import * as store from './config.js';
import { goToRoute, refreshRows, state, visibleGroups, vlist } from './state.js';

let lastResumeSave = 0;
el.video.addEventListener('ended', () => {
  if (state.catchup) toast(t('guide.archiveended'), { long: true });
  else if (state.playing?.k === 3 && state.settings.autoNext) startAutoNext(state.playing);
});
// Going back into the episode that just ended takes the countdown away.
el.video.addEventListener('seeking', () => { if (autoNext && !el.video.ended) cancelAutoNext(); });

/* ------------------------------------------------------- the next episode */

/**
 * The episode after this one, in the series' own order — the same order
 * as its list, season by season. The episode carries its series' id from
 * the list it was opened in (and through history and favourites), so the
 * series need not be open; its episodes are usually cached in any case.
 */
export async function nextEpisode(item) {
  if (item.k !== 3 || item.seriesId == null || !state.lib) return null;
  const open = state.detail?.view === 'series' && String(state.detail.item.id) === String(item.seriesId) ? state.detail.info : null;
  const episodes = open ? open.episodes : (await state.lib.seriesEpisodes(item.seriesId)).episodes;
  const at = episodes.findIndex((episode) => String(episode.id) === String(item.id));
  const next = at < 0 ? null : episodes[at + 1];
  if (!next) return null;
  return { seriesCover: item.seriesCover, seriesName: item.seriesName, seriesId: item.seriesId, ...next };
}

/**
 * Something on the empty player's page chosen while the guide is open:
 * there the player is a thumbnail in the guide's column, so the guide
 * gives way and the item is played where it lives — the channel in its
 * country's list, the film in its group, the episode on its series' page —
 * with the row under the cursor, as if picked from that list.
 */
export async function playInPlace(item) {
  if (await showInPlace(item)) await playItem(item);
  else { closeGuide(); await playItem(item); }
}

/**
 * The list an item lives in, opened with the item's row under the cursor
 * and nothing started: an episode of the history on its series' page, at
 * its own season, where the other episodes are. False where it has no
 * place to show.
 */
export async function showInPlace(item) {
  const tab = item.k === 0 ? 'live' : item.k === 1 ? 'movie' : item.k === 3 ? 'series' : null;
  if (!tab || !state.lib) return false;
  const series = item.k === 3 && item.seriesId != null
    ? (state.lib.full.series || []).find((s) => String(s.id) === String(item.seriesId)) || null : null;
  const cats = (item.k === 3 ? series?.cats : item.cats) || [];
  const groups = tab === 'live' ? visibleGroups('live') : state.lib.groups[tab] || [];
  const group = groups.find((g) => g.cats.some((c) => cats.includes(c.id)))?.name;
  await goToRoute({ tab, group: group ?? state.lastGroup[tab] });
  if (item.k === 3 && item.seriesId != null) {
    await openSeries(series || { k: 2, id: item.seriesId, n: item.seriesName || item.n, logo: item.seriesCover || item.logo, cats });
    // On the episode's own season, not the first.
    const detail = state.detail;
    const season = detail?.view === 'series' ? detail.info?.episodes.find((e) => String(e.id) === String(item.id))?.season : undefined;
    if (season !== undefined && season !== detail.season) {
      detail.season = season;
      renderDetail();
      await refreshRows();
    }
  }
  const index = state.rowIndex.get(`${item.k}:${item.id}`);
  if (index != null) { state.cursor = index; vlist.scrollToIndex(index); }
  return true;
}

export async function playEpisode(episode) {
  const index = state.rowIndex.get(`3:${episode.id}`);
  if (index != null) { state.cursor = index; vlist.scrollToIndex(index); }
  await playItem(episode);
}

const AUTONEXT_SECONDS = 10;
export let autoNext = null;   // { timer, episode } while the countdown runs

/**
 * The countdown over the last picture of an episode. It is the overlay's
 * own, with a way to start at once and a way to stay: a viewer who has
 * dozed off is not taken through the whole season, because the countdown
 * starts only from an episode that ran to its end. One that ended on the
 * Chromecast (js/castui.js) gives `leave`: nothing ended in the picture
 * here, and a viewer who stays has no last picture to stay with, so the
 * player is left.
 * @param {import('./config.js').ListItem} item
 * @param {() => void} [leave]
 * @returns {Promise<boolean>} whether the countdown runs
 */
export async function startAutoNext(item, leave) {
  cancelAutoNext();
  let episode = null;
  try { episode = await nextEpisode(item); } catch { return false; }
  if (!episode || state.playing !== item || !(leave || el.video.ended)) return false;
  // The code and the episode's own title: its label would say the number twice.
  const label = `${episodeCode(episode.season, episode.episode)}: ${episodeLabel(episode.n, episode.episode, [episode.seriesName || '']).titled || t('api.episode', { number: episode.episode || '' })}`;
  let left = AUTONEXT_SECONDS;
  const paint = () => { el.overlayText.textContent = t('player.next.text', { episode: label, seconds: left }); };
  el.overlay.hidden = false;
  el.overlay.classList.remove('loading');
  el.overlayTitle.textContent = t('player.next.title');
  paint();
  showOverlayActions([
    { label: t('player.next.now'), onClick: () => playEpisode(episode) },
    { label: t('player.next.cancel'), onClick: () => { cancelAutoNext(); if (leave) leave(); else el.overlay.hidden = true; } },
  ]);
  autoNext = {
    episode,
    timer: setInterval(() => {
      left -= 1;
      if (left > 0) { paint(); return; }
      playEpisode(episode);
    }, 1000),
  };
  return true;
}

export function cancelAutoNext() {
  if (!autoNext) return;
  clearInterval(autoNext.timer);
  autoNext = null;
  showOverlayActions(null);
}
/**
 * Seen to the end: the history says so, for the ✓ on the film's cover
 * (js/coversui.js). Once per play, the history being written rather than
 * every five seconds of the credits; and at the end itself as well, as a
 * last stretch shorter than those five seconds passed without a save.
 */
let seenNoted = null;
function noteSeen(item) {
  if (!item || item.k === 0 || seenNoted === item) return;
  seenNoted = item;
  const key = `${item.k}:${item.id}`;
  state.seen.set(key, { at: Date.now(), on: true });
  store.setSeen(key, true);
  store.patchRecent(key, { seen: Date.now() }).then((recents) => {
    if (!recents) return;
    state.recents = recents;
    vlist.refresh();
  });
}
/** A film or an episode came to its end, here or on the Chromecast (js/castui.js): seen, and its saved place gone. */
export function noteEnded(item) {
  if (!item || item.k === 0) return;
  // Seen belongs to the history, which is kept with resume points off too.
  noteSeen(item);
  const key = `${item.k}:${item.id}`;
  if (state.settings.resumeEnabled && state.resume.delete(key)) store.setResume(key, null);
}
/**
 * Where a film or an episode has got to, here or on the Chromecast: seen
 * past 96 % of it, and with `save` the place kept, from 20 s in up to there.
 */
export function notePlace(item, position, duration, save = true) {
  if (!Number.isFinite(duration) || duration <= 0) return;
  const key = `${item.k}:${item.id}`, end = position > duration * 0.96;
  if (end) noteSeen(item);
  if (!save || !state.settings.resumeEnabled || position < 20) return;
  if (end) state.resume.delete(key);
  else state.resume.set(key, { position, duration, at: Date.now() });
  store.setResume(key, state.resume.get(key) || null);
  showPlace(item, end ? null : position / duration);
}

/**
 * The place just kept, shown on the title's row or cover while it plays:
 * the bar stood still, or was not there at all, until the list was drawn
 * again for another reason. A bar already there is moved where it is;
 * the row is drawn again only when the bar is to come or to go (the first
 * place kept, the end), as a cover drawn again is a new picture that
 * blinks.
 * @param {{ k: number, id: string }} item
 * @param {number | null} share how far it has got, or null at its end
 */
function showPlace(item, share) {
  const index = state.rows.findIndex((row) => row.k === item.k && String(row.id) === String(item.id));
  const node = index < 0 ? null : vlist.nodes.get(index);
  if (!node) return;
  const fill = /** @type {HTMLElement | null} */ (node.querySelector('.row-progress.resume > i'));
  if (fill && share != null) fill.style.width = `${Math.round(Math.min(1, share) * 100)}%`;
  else if (Boolean(fill) !== (share != null)) vlist.refreshRow(index);
}
el.video.addEventListener('ended', () => noteEnded(state.playing));
el.video.addEventListener('timeupdate', () => {
  const item = state.playing;
  if (!item || item.k === 0) return;
  // Seen is noted at once; the place is written every five seconds.
  const now = Date.now(), save = state.settings.resumeEnabled && now - lastResumeSave >= 5000;
  if (save) lastResumeSave = now;
  notePlace(item, el.video.currentTime, el.video.duration, save);
});

/**
 * The read-out in the corner of the picture: how large the picture is, how
 * fast it is arriving, and which engine carries it. Diagnostics — it
 * answers no question about what to watch, and the resolution is in the
 * playback details below in any case — so it is shown only when the
 * settings ask for it, and then it earns the engine's name too: that is
 * the one thing it says that is nowhere else.
 */
export function renderStatBadge() {
  const stats = state.settings?.statsEnabled ? playback.stats() : null;
  if (!stats) { el.statbadge.hidden = true; return; }
  el.statbadge.hidden = false;
  el.statbadge.textContent = [
    `${stats.width}×${stats.height}`,
    stats.kbps ? `${nf.format(stats.kbps)} kbit/s` : null,
    stats.engine,
  ].filter(Boolean).join(', ');
}

// The bit rate is measured, not reported, so it is read again rather than
// waited for.
setInterval(renderStatBadge, 2000);

// The EPG bar lives in time, so it is repainted even when no data arrives.
setInterval(() => {
  if (state.playing && state.playing.k === 0) renderInfoStrip();
  if (state.epg && state.rows.some((it) => it.k === 0)) vlist.refresh();
}, 30000);
