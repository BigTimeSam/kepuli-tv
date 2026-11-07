// The empty player's page (continue watching, the viewer's channels, the
// picks' carousel) and the note of programmes the viewer stays with, which
// the picks learn from.
//
// Moved out of app.js. It takes the player's state, and the parts app.js
// builds, from js/state.js.

import { currentPicks, pickCard, tickIdlePage } from './picksui.js';
import { el } from './dom.js';
import { sideScroll } from './sidescroll.js';
import { forgetUnfinished, isUnfinished } from './collections.js';
import { bindTile } from './tilekeys.js';
import { guideOpen } from './guideui.js';
import { poster } from './poster.js';
import { renderIdleOverlay } from './languageui.js';
import { shownName, toggleFavorite } from './coversui.js';
import { setStar, star } from './rows.js';
import { episodeCode } from './format.js';
import { t } from './i18n.js';
import * as store from './config.js';
import { state } from './state.js';
import { nextEpisode, playInPlace } from './nextepisode.js';
import { playItem } from './playing.js';

// A programme watched for this long is noted as one the viewer is
// interested in (store.noteInterest, js/picks.js); zapping past does not
// count. Each programme once per airing.
const INTEREST_AFTER_MS = 5 * 60e3;
const INTEREST_TICK_MS = 30e3;
let interestWatch = { key: null, ms: 0, noted: false };

export function watchInterest() {
  setInterval(() => {
    const item = state.playing;
    const video = el.video;
    if (!item || item.k !== 0 || video.paused || video.readyState < 3) return;
    const programme = state.catchup || state.epg?.nowNext(item.id)?.now;
    if (!programme || !programme.title) return;
    const key = `${item.id}|${programme.start}`;
    if (interestWatch.key !== key) interestWatch = { key, ms: 0, noted: false };
    interestWatch.ms += INTEREST_TICK_MS;
    if (interestWatch.noted || interestWatch.ms < INTEREST_AFTER_MS) return;
    interestWatch.noted = true;
    store.noteInterest(programme.title).then((notes) => { if (notes) state.interests = notes; });
  }, INTEREST_TICK_MS);
}

// Continue watching scrolls sideways, with ‹ and › at its ends: the ten
// films and series watched last, those left halfway and those seen to the
// end alike. The channels are as many as fitIdleHome finds room for.
const IDLE_CONTINUE = 10;
const IDLE_CHANNELS = 24;

/** The cards' stars as the favourites stand, after one changed elsewhere. */
export function paintIdleStars() {
  for (const button of el.idleHome.querySelectorAll('.idle-star[data-fav]')) {
    setStar(/** @type {HTMLElement} */ (button), state.favorites.has(/** @type {HTMLElement} */ (button).dataset.fav));
  }
}

/**
 * The empty player's own page. The picture's place was 60 % of the window
 * in black with one sentence in it; what was left halfway and the channels
 * watched last are a click from playing, and they are already in storage.
 * Nothing is fetched for it — a channel's programme would cost a request
 * per tile, and the list beside it shows that anyway.
 *
 * @returns {boolean} whether there was anything to show
 */
export function renderIdleHome() {
  const home = el.idleHome;
  home.replaceChildren();
  if (state.playing || !state.lib) { home.hidden = true; return false; }
  // A series is one card, its latest episode left halfway: four episodes of
  // the same show side by side say nothing the first does not.
  const seen = new Set();
  const once = (item) => {
    const key = item.k === 3 && item.seriesId ? `series:${item.seriesId}` : `${item.k}:${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
  const { homePicks, homeContinue, homeRecent } = state.settings;
  const picks = homePicks === false ? [] : currentPicks();
  if (picks.length) home.appendChild(idleSection('player.idle.picks', 'idle-picks', picks.map(pickCard)));
  const watched = homeContinue === false ? [] : state.recents.filter((item) => item.k === 1 || item.k === 3).filter(once).slice(0, IDLE_CONTINUE);
  const channels = homeRecent === false ? [] : state.recents.filter((item) => item.k === 0).filter(once).slice(0, IDLE_CHANNELS);
  if (watched.length) {
    home.appendChild(idleSection('player.idle.continue', 'idle-cards', watched.map((item) => {
      const card = idleTile('idle-card', item, () => playCard(item));
      const cover = poster('idle-cover', (item.k === 3 && item.seriesCover) || item.logo, item.k === 3 ? 'series' : 'movie');
      const resume = state.resume.get(`${item.k}:${item.id}`);
      const bar = document.createElement('div');
      bar.className = 'row-progress resume';
      // Seen to the end: no bar, but its room kept, so that the names line up.
      if (resume && state.settings.resumeEnabled) {
        const fill = document.createElement('i');
        fill.style.width = `${Math.round(Math.min(1, resume.position / resume.duration) * 100)}%`;
        bar.appendChild(fill);
      } else bar.style.visibility = 'hidden';
      const name = document.createElement('span');
      name.className = 'idle-name';
      name.textContent = item.k === 3 ? `${item.seriesName || ''} ${episodeCode(item.season, item.episode)}`.trim() : shownName(item);
      card.append(cover, name, bar);
      // The card is a button already, so the ✕ sits beside it in a wrapper
      // rather than in it: a button inside a button is not one.
      const wrap = document.createElement('div');
      wrap.className = 'idle-card-wrap';
      const forget = document.createElement('button');
      forget.type = 'button';
      forget.className = 'idle-forget';
      forget.title = t('player.idle.forget', { title: name.textContent });
      forget.setAttribute('aria-label', forget.title);
      forget.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="m6 6 8 8M14 6l-8 8"/></svg>';
      forget.addEventListener('click', (event) => { event.stopPropagation(); forgetUnfinished(item, name.textContent); });
      wrap.append(card, forget);
      // The star in the other corner: the film, or the series an episode
      // belongs to, as the lists star them; s on the card stars the same.
      const favorite = item.k === 3 ? (item.seriesId ? { k: 2, id: item.seriesId, n: item.seriesName || '', logo: item.seriesCover } : null) : item;
      if (favorite) {
        const key = store.itemKey(favorite);
        const button = star(state.favorites.has(key), () => toggleFavorite(favorite), 'idle-star', item.k === 3 ? item.seriesName || name.textContent : name.textContent);
        button.tabIndex = 0;
        // The favourite it stands for, for paintIdleStars.
        button.dataset.fav = key;
        wrap.append(button);
      }
      bindTile(card, favorite || item, { remove: () => forgetUnfinished(item, name.textContent), also: [forget, ...wrap.querySelectorAll('.idle-star')] });
      return wrap;
    })));
    sideScroll(home.lastElementChild.querySelector('.idle-cards'));
  }
  if (channels.length) {
    home.appendChild(idleSection('player.idle.channels', 'idle-channels', channels.map((item) => {
      const tile = idleTile('idle-channel', item, () => playFromHome(item));
      const name = document.createElement('span');
      name.className = 'idle-name';
      name.textContent = shownName(item);
      tile.append(poster('idle-logo', item.logo, 'channel'), name);
      bindTile(tile, item);
      return tile;
    })));
  }
  home.hidden = !home.childElementCount;
  if (!home.hidden) requestAnimationFrame(fitIdleHome);
  // The times move on: the page is drawn again each minute while it shows.
  tickIdlePage(picks.length ? () => {
    if (state.playing || el.overlay.hidden || el.overlayTitle.textContent !== t('player.idle')) return false;
    renderIdleOverlay();
    return true;
  } : null);
  return !home.hidden;
}

/**
 * As much of the empty player's page as the window has room for: one row
 * of covers, and as many rows of channels as fit under them. The rest is
 * hidden rather than scrolled to — a page that opens half off-screen reads
 * as broken — and comes back when the window grows. The overlay still
 * scrolls, for a window too low for even one row of each.
 */
export function fitIdleHome() {
  const home = el.idleHome;
  if (home.hidden || el.overlay.hidden) return;
  const lists = [...home.querySelectorAll('.idle-picks, .idle-channels')];
  for (const list of lists) for (const tile of list.children) tile.hidden = false;
  const style = getComputedStyle(el.overlay);
  const bottom = el.overlay.getBoundingClientRect().bottom - parseFloat(style.paddingBottom);
  for (const list of lists) {
    const tiles = [...list.children];
    const columns = getComputedStyle(list).gridTemplateColumns.split(' ').filter(Boolean).length || 1;
    // The picks get two rows: one row of two or three cards says little.
    let rows = list.classList.contains('idle-picks') ? 2 : 1;
    if (list.classList.contains('idle-channels') && tiles.length) {
      const gap = parseFloat(getComputedStyle(list).rowGap) || 0;
      const height = tiles[0].getBoundingClientRect().height + gap;
      rows = Math.max(1, Math.floor((bottom - list.getBoundingClientRect().top + gap) / height));
    }
    tiles.forEach((tile, i) => { tile.hidden = i >= columns * rows; });
  }
}

function idleSection(titleKey, listClass, tiles) {
  const section = document.createElement('section');
  const heading = document.createElement('h3');
  heading.textContent = t(titleKey);
  const list = document.createElement('div');
  list.className = listClass;
  list.append(...tiles);
  section.append(heading, list);
  return section;
}

/**
 * A cover of Continue watching: what was left halfway goes on from there; a
 * series whose last episode was seen to the end goes on with the next one,
 * where there is one; a film seen to the end starts again.
 */
async function playCard(item) {
  let target = item;
  if (item.k === 3 && !isUnfinished(item)) target = (await nextEpisode(item).catch(() => null)) || item;
  await playFromHome(target);
}

/** A tile of the empty player's page: played there, or — from the guide's column — where it lives. */
export const playFromHome = (item) => (guideOpen ? playInPlace(item) : playItem(item));

function idleTile(className, item, onClick) {
  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = className;
  tile.title = item.n;
  tile.addEventListener('click', onClick);
  return tile;
}
