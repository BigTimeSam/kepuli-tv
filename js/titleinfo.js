import { t, localeTag } from './i18n.js';
import { duration, nf } from './format.js';
import { personUrl, titleLinks } from './titlelinks.js';
import { searchKey } from './name.js';
import { languageName, languageSummary, orderedLanguageNames, shortLanguage } from './lang.js';
import { ratingText } from './rating.js';

/** "H264 (720p)", "AAC (2 ch)": the format, and what it carries in brackets. */
const qualified = (main, detail) => (main && detail ? `${main} (${detail})` : main || detail || '');

export function titleFacts(info, { episodes, seasons, duration: withDuration = false } = {}) {
  const list = document.createElement('dl');
  list.className = 'title-facts';
  const add = (key, value, title) => {
    if (value == null || value === '') return;
    const group = document.createElement('div');
    group.className = `title-fact-${key}`;
    if (title) group.title = title;
    const label = document.createElement('dt');
    label.textContent = t(`title.${key}`);
    const content = document.createElement('dd');
    content.textContent = value;
    group.append(label, content);
    list.append(group);
  };
  add('year', String(info.releaseDate || info.year || '').match(/\b(?:19|20)\d{2}\b/)?.[0]);
  add('genre', info.genre);
  const rating = ratingText(info);
  if (rating) add('rating', rating, t('title.ratingSource'));
  if (episodes != null) {
    if (seasons > 1) add('seasonsEpisodes', `${nf.format(seasons)} / ${nf.format(episodes)}`);
    else add('episodes', nf.format(episodes));
  }
  if (withDuration && Number(info.durationSec) > 0) add('duration', duration(info.durationSec));
  return list;
}

/**
 * Who made it and for whom, from the provider's details: the director, the
 * cast, the country, the age rating and the day it came out. Each only
 * where the provider says it; a provider that says none leaves the block
 * out. The cast is the provider's own list, cut to its first names where
 * it runs long — the whole of it in the tooltip.
 */
/**
 * Names as links to their search on IMDb, a comma between them; the rest
 * after `limit` behind "…", with the whole list in the tooltip.
 */
function people(names, limit) {
  const frag = document.createDocumentFragment();
  names.slice(0, limit).forEach((name, i) => {
    if (i) frag.append(', ');
    const a = document.createElement('a');
    a.href = personUrl(name);
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.className = 'person';
    a.textContent = name;
    a.title = t('links.person', { name });
    frag.append(a);
  });
  if (names.length > limit) frag.append(' …');
  return frag;
}

export function titleCredits(info, { title = '' } = {}) {
  const list = document.createElement('dl');
  list.className = 'title-credits';
  if (!info) return list;
  const add = (key, value, tooltip = '') => {
    const node = typeof value === 'object' && value ? value : null;
    const text = node ? '' : String(value ?? '').trim();
    if (!node && !text) return;
    if (node && !node.childNodes.length) return;
    const group = document.createElement('div');
    group.className = `title-credit-${key}`;
    if (tooltip) group.title = tooltip;
    const label = document.createElement('dt');
    label.textContent = t(`title.${key}`);
    const content = document.createElement('dd');
    if (node) content.append(node); else content.textContent = text;
    group.append(label, content);
    list.append(group);
  };
  // The name it first came out under, when the provider's is another:
  // a translated title is often the harder one to look up.
  const original = String(info.originalTitle || '').trim();
  if (original && searchKey(original) !== searchKey(title || info.title || '')) add('original', original);
  const split = (value) => String(value || '').split(/\s*,\s*/).filter(Boolean);
  add('director', people(split(info.director), 4));
  const cast = split(info.cast);
  add('cast', people(cast, 8), cast.length > 8 ? cast.join(', ') : '');
  add('country', info.country);
  add('age', info.age);
  // A full date says more than the year the facts already give; a bare
  // year, or a date the browser cannot read, adds nothing.
  const released = /^\d{4}-\d{2}-\d{2}/.test(String(info.releaseDate || '')) ? new Date(`${String(info.releaseDate).slice(0, 10)}T12:00:00`) : null;
  if (released && !Number.isNaN(released.getTime()) && !/-01-01/.test(String(info.releaseDate).slice(4, 10))) {
    add('released', released.toLocaleDateString(localeTag(), { year: 'numeric', month: 'long', day: 'numeric' }));
  }
  return list;
}

export function externalLinks(item, info) {
  const nav = document.createElement('nav');
  nav.className = 'title-links';
  nav.setAttribute('aria-label', t('links.label'));
  for (const link of titleLinks(item, info)) {
    const a = document.createElement('a');
    a.href = link.href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = t(`links.${link.service}${link.search ? '.search' : ''}`);
    a.title = t('links.newtab');
    const icon = document.createElement('span');
    icon.textContent = '↗';
    icon.setAttribute('aria-hidden', 'true');
    a.append(icon);
    nav.append(a);
  }
  return nav;
}

export function playbackFacts({ ext, video, audio, subtitles, durationSec, bitrate = 0, loading = {} }) {
  const list = document.createElement('dl');
  list.className = 'playback-facts';
  list.setAttribute('aria-busy', String(Object.values(loading).some(Boolean)));
  const add = (key, value, { unsupported = false, title = '' } = {}) => {
    const pending = !value && loading[key];
    if (!value && !pending) return;
    const group = document.createElement('div');
    group.className = `playback-fact-${key}`;
    if (title) group.title = title;
    const label = document.createElement('dt');
    label.textContent = t(key === 'duration' ? 'title.duration' : `info.${key}`);
    const content = document.createElement('dd');
    if (pending) {
      content.className = 'playback-pending';
      content.setAttribute('role', 'status');
      const spinner = document.createElement('span');
      spinner.className = 'fact-spinner';
      spinner.setAttribute('aria-hidden', 'true');
      content.append(spinner, document.createTextNode(t('progress.loading')));
    } else content.textContent = value;
    if (unsupported) {
      const warning = document.createElement('span');
      warning.className = 'playback-warning';
      warning.textContent = t('info.unsupported');
      content.append(warning);
    }
    group.append(label, content);
    list.append(group);
  };
  if (durationSec) add('duration', duration(durationSec));
  if (ext) add('format', ext.toUpperCase());
  add('video', video && qualified(video.codec?.toUpperCase(), video.height ? `${video.height}p` : ''));
  if (bitrate > 0) add('bitrate', t('info.bitrate.value', { n: nf.format(Math.round(bitrate)) }));
  // The track's language beside its channels, when the file or the
  // provider names one: "AAC (6 channels, Finnish)".
  const spoken = audio && audio.language && shortLanguage(audio.language) !== 'und' ? languageName(shortLanguage(audio.language)) : null;
  const audioDetail = [audio?.channels ? t('audio.channels', { count: audio.channels, n: audio.channels }) : '', spoken || ''].filter(Boolean).join(', ');
  add('audio', audio && qualified(audio.codec?.toUpperCase(), audioDetail), { unsupported: audio?.supported === false });
  if (subtitles) {
    const { total, shown } = subtitles;
    // Bitmap tracks are counted but never named, and an mp4's tracks are
    // read only skin-deep: when the file names no language at all, the
    // count is the only thing left to say — beside the warning, for a file
    // whose subtitles the player cannot show.
    const named = subtitles.languages.some((code) => shortLanguage(code) !== 'und');
    add('subtitles', total ? (named ? languageSummary(subtitles.languages) : nf.format(total)) : t('info.subs.none'), {
      unsupported: total > 0 && !shown,
      title: orderedLanguageNames(subtitles.languages).join(', '),
    });
  } else add('subtitles', '');
  return list;
}
