// A series' page: its details, seasons and episodes, opened from the list
// and kept in the address.
//
// Moved out of app.js. It takes the player's state, and the parts app.js
// builds, from js/state.js.

import { externalLinks, titleFacts } from './titleinfo.js';
import { poster } from './poster.js';
import { t } from './i18n.js';
import { episodeTitle } from './name.js';
import { listName, toggleFavorite } from './coversui.js';
import { beginListLoad, catalogueSearch, listNavigation, mediaFilters, refreshRows, showListError, state, updateAddress, vlist } from './state.js';
import { playItem } from './playing.js';
import { renderSeriesFavorite } from './playercontrols.js';
import { openFavCategory } from './collections.js';
import { el } from './dom.js';

export async function openItem(item) {
  if (!item) return;
  if (item.k === 'c') return openFavCategory(item);
  if (item.k === 2) return openSeries(item);
  await playItem(item);
}

export async function openSeries(item) {
  // A retry belongs to the same drill-down and keeps its original parent.
  const retry = state.detail?.view === 'series' && state.detail.item.id === item.id ? state.detail : null;
  const returnPosition = retry?.returnPosition || listNavigation.capture(vlist);
  const returnSearch = retry?.returnSearch || catalogueSearch.snapshot();
  catalogueSearch.reset({ restore: false });
  mediaFilters.apply([], null);
  // A series opened from a favourite category stays inside the category:
  // going back returns to the list it was chosen from.
  const back = retry ? retry.back : state.detail?.view === 'category' ? state.detail : null;
  // Keep the parent list's rules: the episode list is a different set and
  // must not infer new prefixes from its repeated series title.
  // The series' name as its row showed it, or, opened from somewhere else
  // than the list (a related title, the empty player's page), tidied by its
  // own group's rules rather than by the list's beside it.
  const sourceItem = item;
  const seriesTitle = listName(sourceItem);
  // An episode's row says only what the page does not: its own title, the
  // series' name and the code being there already (episodeTitle in
  // js/name.js); with no title of its own, "Episode 3".
  const seriesNames = [item.n, item.displayName, seriesTitle];
  const episodeName = (episode) => episodeTitle(episode.n, { series: seriesNames }) || t('api.episode', { number: episode.episode || '' });
  const cleanName = (name, row) => (row && row.k === 3 ? episodeName(row) : name === sourceItem.n ? seriesTitle : name);
  item = { ...item, displayName: seriesTitle };
  state.detail = { view: 'series', item, info: null, season: null, back, cleanName, returnPosition, returnSearch, loading: true };
  const open = state.detail;
  renderDetail();
  updateAddress();
  beginListLoad();
  try {
    const info = await state.lib.seriesEpisodes(item.id);
    if (state.detail !== open) return;
    state.detail.loading = false;
    // Episodes often have no artwork of their own. Carry the parent cover
    // with each episode so playback keeps it even after leaving this view
    // or reopening the episode from history or favourites. Also enrich
    // cached responses, without changing the shared cache object.
    state.detail.info = {
      ...info,
      episodes: info.episodes.map(episode => ({
        ...episode,
        displayName: episodeName(episode),
        seriesCover: info.cover || item.logo || '',
        seriesName: seriesTitle,
        seriesId: item.id,
      })),
    };
    const seasons = seasonNumbers(info.episodes);
    state.detail.season = seasons[0] ?? null;
    renderDetail();
    await refreshRows();
  } catch (err) {
    if (state.detail !== open) return;
    state.detail.loading = false;
    showListError(err, () => openSeries(item));
  }
}

function seasonNumbers(episodes) {
  return [...new Set(episodes.map((e) => e.season))].sort((a, b) => a - b);
}

export function episodesOfSeason() {
  const detail = state.detail;
  if (!detail || detail.view !== 'series' || !detail.info) return [];
  const eps = detail.info.episodes;
  return detail.season == null ? eps : eps.filter((e) => e.season === detail.season);
}

export function renderDetail() {
  catalogueSearch.render();
  const detail = state.detail;
  // A category has neither a plot nor a cover — its contents are a list, and
  // the breadcrumb is enough to say where we are.
  el.detail.hidden = !detail || detail.view === 'category';
  el.crumbs.hidden = !detail;
  if (!detail) { el.detail.replaceChildren(); el.crumbs.replaceChildren(); return; }

  el.crumbs.replaceChildren();
  const back = document.createElement('button');
  back.type = 'button';
  back.textContent = t('crumbs.back');
  back.addEventListener('click', closeDetail);
  const label = document.createElement('span');
  const displayTitle = detail.view === 'series' ? (detail.cleanName ? detail.cleanName(detail.item.n) : detail.item.displayName || detail.item.n) : '';
  label.textContent = detail.view === 'category' ? crumbLabel(detail.entry) : displayTitle;
  if (detail.view === 'series') label.title = detail.item.n;
  el.crumbs.append(back, label);

  if (detail.view === 'category') { el.detail.replaceChildren(); return; }

  const info = detail.info;
  const main = document.createElement('div');
  main.className = 'detail-main';

  const cover = poster('detail-cover', (info && info.cover) || detail.item.logo, 'series', { expand: true, title: displayTitle });
  main.appendChild(cover);

  const body = document.createElement('div');
  body.className = 'detail-body';
  const heading = document.createElement('div');
  heading.className = 'detail-heading';
  const title = document.createElement('div');
  title.className = 'detail-title';
  title.textContent = displayTitle;
  title.title = detail.item.n;
  const favorite = document.createElement('button');
  favorite.type = 'button';
  favorite.id = 'detail-fav';
  favorite.className = 'ghost series-favorite';
  favorite.addEventListener('click', () => toggleFavorite(detail.item));
  heading.append(title, favorite);
  body.appendChild(heading);

  body.appendChild(titleFacts(info || detail.item, {
    episodes: info?.episodes.length,
    seasons: info ? seasonNumbers(info.episodes).filter(season => season > 0).length : undefined,
  }));

  if (info && (info.plot || detail.item.plot)) {
    const plot = document.createElement('div');
    plot.className = 'detail-plot';
    plot.textContent = info.plot || detail.item.plot;
    body.appendChild(plot);
  }
  body.appendChild(externalLinks(detail.item, info));
  main.appendChild(body);
  el.detail.replaceChildren(main);
  renderSeriesFavorite();

  if (info) {
    const seasons = seasonNumbers(info.episodes);
    if (seasons.length > 1) {
      const bar = document.createElement('div');
      bar.className = 'seasons';
      for (const season of seasons) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'season' + (season === detail.season ? ' active' : '');
        chip.textContent = t('season', { season });
        chip.addEventListener('click', () => {
          detail.season = season;
          renderDetail();
          refreshRows();
        });
        bar.appendChild(chip);
      }
      el.detail.appendChild(bar);
    }
  }
}

/** "Finland › MTV Liiga" — the same path by which the category is found
 *  when browsing. */
export function crumbLabel(entry) {
  return entry.g && entry.g !== entry.n ? `${entry.g} › ${entry.n}` : entry.n;
}

export function closeDetail() {
  const detail = state.detail;
  if (!detail) return;
  const focus = document.activeElement;
  const restoreFocus = focus === document.body || el.crumbs.contains(focus) || el.list.contains(focus);
  state.detail = detail.back || null;
  catalogueSearch.restore(detail.returnSearch);
  state.cursor = -1;
  renderDetail();
  updateAddress();
  refreshRows({ returnPosition: detail.returnPosition, restoreFocus: () => restoreFocus
    && (document.activeElement === focus || document.activeElement === document.body || document.activeElement === el.list) });
}
