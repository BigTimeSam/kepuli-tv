import { t, localeTag } from './i18n.js';
import { ratingValue } from './rating.js';

export function releaseYear(value, name = '') {
  const explicit = /^(18\d{2}|19\d{2}|20\d{2}|21\d{2})(?:$|-)/.exec(String(value || '').trim());
  // A title such as "1917" is not a release year. Only use a year suffix.
  const suffix = /\((18\d{2}|19\d{2}|20\d{2}|21\d{2})\)\s*$/.exec(name);
  return Number((explicit || suffix)?.[1]) || 0;
}

export function mediaFacts(item, details = item.details) {
  const genre = details?.genre || item.genre || '';
  const genres = [...new Set(String(genre).split(/[,;|/]/).map(g => g.trim().toLowerCase()).filter(Boolean))];
  return {
    year: releaseYear(details?.releaseDate || item.year, item.n),
    genres,
    rating: ratingValue(details) || ratingValue(item),
  };
}

export const emptyFilters = () => ({ year: '', genre: '', rating: '', sort: '' });

export function filterMedia(entries, filters) {
  const results = entries.filter(({ facts }) => {
    if (filters.year === 'missing' && facts.year) return false;
    if (filters.year && filters.year !== 'missing') {
      const [from, to = from] = filters.year.split(':').map(Number);
      if (!facts.year || facts.year < from || facts.year > to) return false;
    }
    if (filters.genre === 'missing' ? facts.genres.length : filters.genre && !facts.genres.includes(filters.genre)) return false;
    if (filters.rating === 'missing' ? facts.rating : filters.rating && facts.rating < Number(filters.rating)) return false;
    return true;
  });
  if (filters.sort) results.sort((a, b) => {
    const key = filters.sort === 'rating' ? 'rating' : 'year';
    const av = a.facts[key], bv = b.facts[key];
    if (!av || !bv) return Number(!av) - Number(!bv); // Unknown values always last.
    return filters.sort === 'oldest' ? av - bv : bv - av;
  });
  return results.map(entry => entry.item);
}

/** Session-only experiments: movies and series keep separate choices. */
export class MediaFilters {
  constructor(host, onChange, detailsFor = item => item.details) {
    this.host = host;
    this.onChange = onChange;
    this.detailsFor = detailsFor;
    this.values = { movie: emptyFilters(), series: emptyFilters() };
    this.type = null;
    this.summary = document.createElement('summary');
    this.caption = document.createElement('span');
    this.count = document.createElement('span');
    this.count.className = 'media-filter-count';
    this.count.setAttribute('aria-live', 'polite');
    this.summary.append(this.caption, this.count);
    const controls = document.createElement('div');
    controls.className = 'media-filter-controls';
    this.fields = {};
    for (const key of ['year', 'genre', 'rating', 'sort']) {
      const label = document.createElement('label');
      const text = document.createElement('span');
      const select = document.createElement('select');
      select.name = key;
      label.append(text, select);
      controls.append(label);
      this.fields[key] = { label, text, select };
      select.addEventListener('change', () => {
        this.values[this.type][key] = select.value;
        this.onChange();
      });
    }
    const foot = document.createElement('div');
    foot.className = 'media-filter-footer';
    this.note = document.createElement('span');
    this.reset = document.createElement('button');
    this.reset.type = 'button';
    this.reset.addEventListener('click', () => this.clear());
    foot.append(this.note, this.reset);
    this.host.append(this.summary, controls, foot);
  }

  get filtering() {
    const value = this.values[this.type];
    return Boolean(value && (value.year || value.genre || value.rating));
  }

  clear() {
    if (!this.type) return;
    this.values[this.type] = emptyFilters();
    this.onChange();
  }

  metadataChanged() {
    clearTimeout(this.metadataTimer);
    this.metadataTimer = setTimeout(() => {
      // Populate choices as visible movies get their optional details.
      // Keep an active result set steady until the viewer changes a filter.
      if (this.type && !Object.values(this.values[this.type]).some(Boolean)) this.apply(this.rows, this.type);
    }, 100);
  }

  apply(rows, type) {
    this.type = type;
    this.rows = rows;
    this.host.hidden = !type;
    if (!type) return rows;
    const filters = this.values[type];
    // Movie genres are selected through the provider's categories. Sparse
    // per-title genre metadata must not narrow those results a second time.
    if (type === 'movie') filters.genre = '';
    const entries = rows.map(item => ({ item, facts: mediaFacts(item, this.detailsFor(item)) }));
    const results = filterMedia(entries, filters);
    const years = [...new Set(entries.map(e => e.facts.year).filter(Boolean))].sort((a, b) => b - a);
    const decades = [...new Set(years.map(y => Math.floor(y / 10) * 10))];
    const genres = type === 'series' ? [...new Set(entries.flatMap(e => e.facts.genres))].sort((a, b) => a.localeCompare(b, localeTag())) : [];
    const options = {
      year: [['', t('filters.allYears')], ...decades.map(y => [`${y}:${y + 9}`, `${y}–${y + 9}`]), ...years.map(y => [String(y), String(y)]), ['missing', t('filters.missing')]],
      genre: [['', t('filters.allGenres')], ...genres.map(g => [g, g.charAt(0).toLocaleUpperCase() + g.slice(1)]), ['missing', t('filters.missing')]],
      rating: [['', t('filters.anyRating')], ...[6, 7, 8, 9].map(n => [String(n), `≥ ${n.toLocaleString(localeTag())} / 10`]), ['missing', t('filters.missing')]],
      sort: [['', t('filters.defaultOrder')], ['newest', t('filters.newest')], ['oldest', t('filters.oldest')], ['rating', t('filters.best')]],
    };
    for (const [key, field] of Object.entries(this.fields)) {
      field.label.hidden = key === 'genre' && type === 'movie';
      field.label.classList.toggle('wide', key === 'sort' && type === 'movie');
      field.text.textContent = t(`filters.${key}`);
      const list = options[key];
      // Keep an active choice visible even in a category with no matches.
      if (!list.some(([value]) => value === filters[key])) list.push([filters[key], filters[key].replace(':', '–')]);
      field.select.replaceChildren(...list.map(([value, text]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = text;
        return option;
      }));
      field.select.value = filters[key];
      field.select.classList.toggle('active', Boolean(filters[key]));
    }
    const active = Object.values(filters).some(Boolean);
    this.caption.textContent = t('filters.title') + (active ? ' •' : '');
    this.count.textContent = `${results.length.toLocaleString(localeTag())} / ${rows.length.toLocaleString(localeTag())}`;
    this.reset.textContent = t('filters.reset');
    this.reset.disabled = !active;
    const missing = entries.some(e => !e.facts.year || !e.facts.rating || (type === 'series' && !e.facts.genres.length));
    // The genre field is hidden on movies because a film's genre there is
    // the provider's own category. A control that is present on Series and
    // gone on Movies needs to say why rather than leave it to be noticed.
    this.note.textContent = [type === 'movie' ? t('filters.genre.movie') : '', missing ? t('filters.incomplete') : '']
      .filter(Boolean).join(' ');
    return results;
  }
}
