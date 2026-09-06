import { t } from './i18n.js';
import { duration, nf } from './format.js';
import { titleLinks } from './titlelinks.js';
import { languageSummary, orderedLanguageNames, shortLanguage } from './lang.js';
import { ratingText } from './rating.js';

export function titleFacts(info, { episodes, seasons, movie = false } = {}) {
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
  if (movie && Number(info.durationSec) > 0) add('duration', duration(info.durationSec));
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

export function playbackFacts({ ext, video, audio, subtitles, durationSec, loading = {} }) {
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
  add('video', video && [video.codec?.toUpperCase(), video.height ? `${video.height}p` : ''].filter(Boolean).join(' · '));
  add('audio', audio && [audio.codec?.toUpperCase(), audio.channels ? t('audio.channels', { n: audio.channels }) : ''].filter(Boolean).join(' · '), { unsupported: audio?.supported === false });
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
