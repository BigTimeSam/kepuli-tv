// The details strip under the picture: for a channel what is on now and
// next, for a film or an episode its facts, credits, cover and the file's
// format (js/titleinfo.js builds the parts), and the film's details fetched
// when the provider has them.
//
// Moved out of app.js. It takes the player's state, and the parts app.js
// builds, from js/state.js.

import { audioDetails, subtitleSummary } from './probe.js';
import { clock, progressOf } from './format.js';
import { relatedTitles, titleWithoutYear, versionLabels } from './titlemeta.js';
import { playbackFacts, titleCredits, titleFacts } from './titleinfo.js';
import { titleLinks } from './titlelinks.js';
import { poster } from './poster.js';
import { shortLanguage } from './lang.js';
import { t } from './i18n.js';
import { state, vlist } from './state.js';
import { renderMediaSession } from './playercontrols.js';
import { el } from './dom.js';
import { addressChanges, freshItem, listName, probeFor, shownName, updateStoredItem } from './coversui.js';
import { openItem } from './seriesui.js';
import { bindTile } from './tilekeys.js';

export function renderInfoStrip() {
  renderMediaSession();
  const item = state.playing;
  renderMenuLinks(null);
  // A recording's programme is in its title; the guide's now is not it.
  if (!item || item.recording) { el.infostrip.hidden = true; return; }

  if (item.k === 0) {
    const entry = state.catchup ? { now: state.catchup, next: null } : state.epg ? state.epg.nowNext(item.id) : null;
    if (!entry || (!entry.now && !entry.next)) { el.infostrip.hidden = true; return; }
    el.infostrip.hidden = false;
    const frag = document.createDocumentFragment();
    if (entry.now) {
      const head = document.createElement('div');
      head.className = 'epgnow';
      const time = document.createElement('span');
      time.className = 'epgnow-time';
      time.textContent = `${clock(entry.now.start)}–${clock(entry.now.stop)}`;
      const title = document.createElement('span');
      title.className = 'epgnow-title';
      title.textContent = entry.now.title;
      // Starting the programme over is the guide's to offer, with the
      // archive and the rest of the day around it; beside the title here
      // it was a button wanted once in a long while and in the way always.
      head.append(time, title);
      frag.appendChild(head);

      const share = progressOf(entry.now);
      if (share != null) {
        const bar = document.createElement('div');
        bar.className = 'epgbar';
        const fill = document.createElement('i');
        fill.style.width = `${Math.round(share * 100)}%`;
        bar.appendChild(fill);
        frag.appendChild(bar);
      }
      if (entry.now.description) {
        const desc = document.createElement('div');
        desc.className = 'epgdesc';
        desc.textContent = entry.now.description;
        frag.appendChild(desc);
      }
    }
    if (entry.next) {
      // Three parts rather than one sentence: the label says which
      // programme this is, and the time and the title then sit in the same
      // two columns as the one on now, so the eye reads them the same way.
      const next = document.createElement('div');
      next.className = 'epgnext';
      const label = document.createElement('span');
      label.className = 'epgnext-label';
      label.textContent = t('info.next');
      const when = document.createElement('span');
      when.className = 'epgnext-time';
      when.textContent = `${clock(entry.next.start)}–${clock(entry.next.stop)}`;
      const what = document.createElement('span');
      what.className = 'epgnext-title';
      what.textContent = entry.next.title;
      next.append(label, when, what);
      frag.appendChild(next);
    }
    el.infostrip.replaceChildren(frag);
    return;
  }

  const info = item.details;
  el.infostrip.hidden = false;
  const box = document.createElement('div');
  box.className = 'vodinfo';
  const cover = item.k === 3 ? item.seriesCover || item.logo : info?.cover || item.logo;
  box.appendChild(poster('info-cover', cover, item.k === 1 ? 'movie' : 'series', { expand: true, title: item.seriesName || shownName(item) }));
  const body = document.createElement('div');
  body.className = 'vodinfo-body';
  // A part with nothing to say is left out rather than left empty: the
  // file's facts then head the strip, level with the cover, without the
  // line that divides them from the title's.
  const add = (part) => { if (part.childElementCount) body.appendChild(part); };
  add(titleFacts(info || item, { duration: true }));
  renderMenuLinks(item, info);
  // A header that has been read is more precise than the API's data: it
  // knows the audio track and the subtitles, neither of which the API
  // reports.
  const probed = probeFor(item);
  const header = probed && !probed.error ? probed : null;
  const video = header?.video || info?.video || item.video;
  // The file's own track first; the provider's word for its language
  // where the file names none (an MP4's track is often "und").
  const heard = audioDetails(header, { active: state.activeAudio, language: state.settings.audioLang }) || info?.audio || null;
  const named = (track) => track?.language && shortLanguage(track.language) !== 'und';
  const audio = heard && !named(heard) && named(info?.audio) ? { ...heard, language: info.audio.language } : heard;
  const subtitles = subtitleDetails(item, probed);
  body.appendChild(playbackFacts({
    ext: item.ext,
    video,
    audio,
    subtitles,
    bitrate: info?.bitrate || 0,
    loading: {
      video: !video && ((!header && state.playbackInfoLoading) || Boolean(item.detailsLoading)),
      audio: !audio && !header && state.playbackInfoLoading,
      subtitles: !subtitles && state.playbackInfoLoading,
    },
  }));
  if (info && info.plot) {
    const plot = document.createElement('div');
    plot.className = 'plot';
    plot.textContent = info.plot;
    body.appendChild(plot);
  }
  add(titleCredits(info, { title: item.n }));
  if (item.k === 1 || item.k === 2) add(relatedPart(item));
  box.appendChild(body);
  el.infostrip.replaceChildren(box);
}

/**
 * The other copies of the film and the other parts of its series, from the
 * whole catalogue when it is in memory and from the list on screen when it
 * is not: each a small cover with its name, year and what tells a copy
 * apart, a click playing it as the list would.
 */
let related = { item: null, pool: null, found: null };
function relatedPart(item) {
  const type = item.k === 1 ? 'movie' : 'series';
  const pool = state.lib?.full?.[type] || state.rows;
  // The strip is painted again on every fact that arrives; the catalogue
  // can hold 55,000 films, read once per film and list.
  if (related.item !== item || related.pool !== pool) related = { item, pool, found: relatedTitles(item, pool) };
  const { versions, parts } = related.found;
  const box = document.createElement('div');
  box.className = 'related';
  const labels = versions.length ? versionLabels([item, ...versions]) : new Map();
  const section = (key, items) => {
    if (!items.length) return;
    const head = document.createElement('h4');
    head.textContent = t(key);
    const row = document.createElement('div');
    row.className = 'related-row';
    for (const other of items) {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'related-tile';
      tile.appendChild(poster('related-cover', other.logo, other.k === 2 ? 'series' : 'movie'));
      const name = document.createElement('span');
      name.className = 'related-name';
      name.textContent = titleWithoutYear(listName(other), other.year);
      const meta = document.createElement('span');
      meta.className = 'related-meta';
      const tags = labels.get(`${other.k}:${other.id}`);
      meta.textContent = [other.year, ...(Array.isArray(tags) ? tags : tags ? [t('cover.version', { n: tags.version })] : [])].filter(Boolean).join(' · ');
      tile.title = other.n;
      tile.append(name, meta);
      tile.addEventListener('click', () => openItem(other));
      bindTile(tile, other);
      row.appendChild(tile);
    }
    box.append(head, row);
  };
  section('info.related.versions', versions);
  section('info.related.parts', parts);
  return box;
}

/**
 * The ☰ menu's IMDb and trailer items for the film or episode playing, as
 * titleLinks() finds them; hidden for anything else.
 * @param {object|null} item
 * @param {object} [info]
 */
function renderMenuLinks(item, info) {
  const links = item ? titleLinks(item, info) : [];
  for (const service of ['imdb', 'trailer']) {
    const node = /** @type {HTMLAnchorElement} */ (document.getElementById(`more-${service}`));
    const link = links.find((l) => l.service === service);
    node.hidden = !link;
    if (!link) continue;
    node.href = link.href;
    node.title = t('links.newtab');
    node.querySelector('span').textContent = `${t(`links.${service}${link.search ? '.search' : ''}`)} ↗`;
  }
}

/**
 * The subtitles of the file, for the details: what the player found once it
 * opened the file — or, before that, what an earlier reading of the header
 * found, if there was one. A file without any says so, rather than leaving
 * the viewer to notice that the selector never appeared; a file with only
 * bitmap tracks has subtitles the player cannot show, and says that.
 */
function subtitleDetails(item, probed) {
  const known = state.playing === item ? state.subtitleInfo : null;
  if (known) {
    const languages = [...new Set(known.tracks.map((track) => shortLanguage(track.language)))];
    return { total: known.tracks.length + known.bitmap, shown: known.tracks.length, languages };
  }
  if (!probed || probed.error) return null;
  const subs = subtitleSummary(probed);
  if (subs) return { total: subs.total, shown: subs.text, languages: subs.languages };
  // A header cut short may hold tracks that were not reached.
  return probed.truncated ? null : { total: 0, shown: 0, languages: [] };
}

export async function loadVodDetails(item) {
  if (item.details || !hasDetails(item)) return;
  item.detailsLoading = true;
  try {
    if (item.k === 3) {
      const series = await state.lib.seriesEpisodes(item.seriesId);
      item.details = episodeDetails(item, series);
      // Opened from Continue watching, the episode is the copy the history
      // made; its series' list, read for the details anyway, says whether
      // the file is still where the copy says.
      const patch = addressChanges(item, series.episodes.find((episode) => String(episode.id) === String(item.id)));
      if (patch) updateStoredItem(item, patch);
    } else {
      const info = await state.lib.movieDetails(item.id);
      item.details = info;
      // The film's own answer names its container; an empty one says
      // nothing, and a whole list in memory is the fresher word (its cache
      // lasts hours, a film's details a week).
      if (info.ext && !freshItem(item)) {
        const patch = addressChanges(item, { ext: info.ext });
        if (patch) updateStoredItem(item, patch);
      }
      item.durationSec = info.durationSec;
      const index = state.rowIndex.get(`1:${item.id}`);
      if (index != null) vlist.refreshRow(index);
    }
  } catch { /* the extra details are optional */ }
  finally {
    item.detailsLoading = false;
    if (state.playing === item) renderInfoStrip();
  }
}

/** Whether the strip has a title's facts to fetch for the item. */
export const hasDetails = (item) => item.k === 1 || (item.k === 3 && Boolean(item.seriesId));

/**
 * What the strip says about an episode: the series' year, genre, rating
 * and links, as a film shows its own, with the episode's own length, plot
 * and picture format. An episode reopened from the history carries little
 * of its own, so it is looked up in the series by its id.
 */
function episodeDetails(item, series) {
  const own = series.episodes.find((episode) => episode.id === item.id) || item;
  const { episodes, plot, cover, ...facts } = series;
  return { ...facts, title: item.seriesName || '', durationSec: own.durationSec || item.durationSec || 0,
    plot: own.plot || item.plot || '', video: own.video || item.video || null, bitrate: own.bitrate || 0 };
}
