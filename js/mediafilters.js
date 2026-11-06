import { t, localeTag } from './i18n.js';
import { ratingValue } from './rating.js';
import { isPicking } from './picker.js';
import { duration, nf } from './format.js';

/**
 * The list's filter folds ("Filter channels", "Filter titles") say their
 * state one way: the name, a dot while something in them narrows the list,
 * and how many rows of how many are left. They used to say it three ways
 * (a topic's name, a bare count, "n / total").
 */
export function foldSummary(caption, count, { label, shown, total, active }) {
  caption.textContent = label + (active ? ' •' : '');
  count.textContent = `${nf.format(shown)} / ${nf.format(total)}`;
}

/**
 * Whether a filter fold opens, from what was stored when it was last
 * opened or closed: the first time open, so that a viewer sees what can
 * narrow the list once, and after that as it was left. One rule for both
 * folds; the channels' opened and the films' stayed closed before.
 */
export function foldOpen(stored) {
  return stored !== false;
}

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
    // Whole minutes, 0 when unknown: the list gives a film's length for
    // some providers, its details for the rest once they have been read.
    minutes: Math.round((Number(details?.durationSec) || Number(item.durationSec) || 0) / 60),
  };
}

// length is "from:to" in minutes, both ends included; '' is any length.
// The order is not a filter: it is chosen at the list's foot and kept as a
// setting (js/listorder.js), so Reset and the chips leave it alone.
export const emptyFilters = () => ({ year: '', genre: '', rating: '', length: '' });

export function filterMedia(entries, filters) {
  return entries.filter(({ facts }) => {
    if (filters.year === 'missing' && facts.year) return false;
    if (filters.year && filters.year !== 'missing') {
      const [from, to = from] = filters.year.split(':').map(Number);
      if (!facts.year || facts.year < from || facts.year > to) return false;
    }
    if (filters.genre === 'missing' ? facts.genres.length : filters.genre && !facts.genres.includes(filters.genre)) return false;
    if (filters.rating === 'missing' ? facts.rating : filters.rating && facts.rating < Number(filters.rating)) return false;
    if (filters.length) {
      // A film whose length is not known is left out, as one without a
      // year is when a year is chosen: it cannot be said to fit.
      const [from, to] = filters.length.split(':').map(Number);
      if (!facts.minutes || facts.minutes < from || facts.minutes > to) return false;
    }
    return true;
  }).map(entry => entry.item);
}

/** Session-only experiments: movies and series keep separate choices. */
export class MediaFilters {
  constructor(host, onChange, detailsFor = item => item.details, activeHost = null) {
    this.host = host;
    this.activeHost = activeHost;
    this.onChange = onChange;
    this.detailsFor = detailsFor;
    this.values = { movie: emptyFilters(), series: emptyFilters() };
    this.type = null;
    // Each row's facts, kept with the details they were read from: a film's
    // details arriving rescans the list for the menus, and reading 55,000
    // titles' facts afresh each time was the cost of it.
    this.facts = new WeakMap();
    // The same heading as the favourites above the list: a mark, the name,
    // what it counts and the fold, see .section-toggle in player.css.
    this.summary = document.createElement('summary');
    this.summary.className = 'section-toggle';
    this.summary.insertAdjacentHTML('afterbegin', '<svg class="section-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M3 4.5h14l-5.5 6.2v4.8l-3 1.5v-6.3z"/></svg>');
    this.caption = document.createElement('span');
    this.caption.className = 'section-label';
    this.count = document.createElement('span');
    this.count.className = 'section-count';
    this.count.setAttribute('aria-live', 'polite');
    this.summary.append(this.caption, this.count);
    this.summary.insertAdjacentHTML('beforeend', '<svg class="section-chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4"/></svg>');
    const controls = document.createElement('div');
    controls.className = 'media-filter-controls';
    this.fields = {};
    for (const key of ['year', 'genre', 'rating']) {
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
    controls.append(this.lengthControl());
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
    return Boolean(value && (value.year || value.genre || value.rating || value.length));
  }

  /**
   * A film's length, from the shortest to the longest the list holds: two
   * handles on one track. The list is filtered when a handle is let go,
   * not while it moves (55,000 films filtered on every step of a drag
   * would make the handle lag); the words beside the label follow the
   * drag. The handles cannot cross: the one moved pushes the other.
   */
  lengthControl() {
    const label = document.createElement('label');
    label.className = 'wide length-filter';
    const head = document.createElement('span');
    head.className = 'range-label';
    this.lengthLabel = document.createElement('span');
    this.lengthText = document.createElement('output');
    head.append(this.lengthLabel, this.lengthText);
    const pair = document.createElement('div');
    pair.className = 'range-pair';
    this.lengthInputs = ['from', 'to'].map((end) => {
      const input = document.createElement('input');
      input.type = 'range';
      input.step = '5';
      input.dataset.end = end;
      pair.append(input);
      return input;
    });
    const [from, to] = this.lengthInputs;
    const moved = (input) => {
      if (Number(from.value) > Number(to.value)) {
        if (input === from) to.value = from.value; else from.value = to.value;
      }
      this.showLength();
    };
    for (const input of this.lengthInputs) {
      input.addEventListener('input', () => moved(input));
      input.addEventListener('change', () => {
        const all = Number(from.value) <= Number(from.min) && Number(to.value) >= Number(to.max);
        this.values[this.type].length = all ? '' : `${from.value}:${to.value}`;
        this.onChange();
      });
    }
    label.append(head, pair);
    this.lengthField = label;
    return label;
  }

  /** The range in words, and the track's lit part between the handles. */
  showLength() {
    const [from, to] = this.lengthInputs;
    const min = Number(from.min), max = Number(from.max);
    const all = Number(from.value) <= min && Number(to.value) >= max;
    // A screen reader would otherwise read the handle as a bare "90".
    for (const input of this.lengthInputs) input.setAttribute('aria-valuetext', duration(Number(input.value) * 60));
    this.lengthText.textContent = all ? t('filters.anyLength')
      : `${duration(Number(from.value) * 60, { compact: true })} – ${duration(Number(to.value) * 60, { compact: true })}`;
    const share = (v) => `${max > min ? ((Number(v) - min) / (max - min)) * 100 : 0}%`;
    this.lengthField.style.setProperty('--from', share(from.value));
    this.lengthField.style.setProperty('--to', share(to.value));
  }

  /**
   * The track's ends from the films the list holds, rounded out to ten
   * minutes; hidden for series, whose list has no lengths, and where fewer
   * than two lengths are known, unless a choice is in force.
   */
  renderLength(entries, type, filters) {
    // A loop rather than Math.min(...list): 55,000 arguments is past what
    // an engine promises to take.
    let known = 0, low = Infinity, high = 0;
    for (const { facts } of entries) {
      if (!(facts.minutes > 0)) continue;
      known++;
      low = Math.min(low, facts.minutes);
      high = Math.max(high, facts.minutes);
    }
    let min = known ? Math.floor(low / 10) * 10 : 0;
    let max = known ? Math.ceil(high / 10) * 10 : 0;
    const chosen = filters.length ? filters.length.split(':').map(Number) : null;
    if (chosen) { min = Math.min(min || chosen[0], chosen[0]); max = Math.max(max, chosen[1]); }
    this.lengthField.hidden = type !== 'movie' || (!chosen && (known < 2 || max - min < 10));
    if (this.lengthField.hidden) return;
    this.lengthLabel.textContent = t('title.duration');
    const [from, to] = this.lengthInputs;
    from.setAttribute('aria-label', `${t('title.duration')}: ${t('filters.length.from')}`);
    to.setAttribute('aria-label', `${t('title.duration')}: ${t('filters.length.to')}`);
    // An input is left alone while it is being dragged: the list's details
    // arriving would otherwise move the handle under the finger.
    if (document.activeElement && this.lengthInputs.includes(/** @type {HTMLInputElement} */ (document.activeElement)) && !chosen) return;
    for (const input of this.lengthInputs) { input.min = String(min); input.max = String(max); }
    from.value = String(chosen ? chosen[0] : min);
    to.value = String(chosen ? chosen[1] : max);
    this.lengthField.classList.toggle('active', Boolean(chosen));
    this.showLength();
  }

  clear() {
    if (!this.type) return;
    this.values[this.type] = emptyFilters();
    this.onChange();
  }

  /** Both types back to no filter, folded: the start the logo goes back to. The list is the caller's to repaint. */
  resetAll() {
    this.values = { movie: emptyFilters(), series: emptyFilters() };
    this.host.open = false;
  }

  factsOf(item) {
    const details = this.detailsFor(item);
    const known = this.facts.get(item);
    if (known && known.details === details) return known.facts;
    const facts = mediaFacts(item, details);
    this.facts.set(item, { details, facts });
    return facts;
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
    if (this.activeHost) this.activeHost.hidden = !type;
    if (!type) return rows;
    const filters = this.values[type];
    // Movie genres are selected through the provider's categories. Sparse
    // per-title genre metadata must not narrow those results a second time.
    if (type === 'movie') filters.genre = '';
    const entries = rows.map(item => ({ item, facts: this.factsOf(item) }));
    const results = filterMedia(entries, filters);
    const years = [...new Set(entries.map(e => e.facts.year).filter(Boolean))].sort((a, b) => b - a);
    const decades = [...new Set(years.map(y => Math.floor(y / 10) * 10))];
    const genres = type === 'series' ? [...new Set(entries.flatMap(e => e.facts.genres))].sort((a, b) => a.localeCompare(b, localeTag())) : [];
    const options = {
      year: [['', t('filters.allYears')], ...decades.map(y => [`${y}:${y + 9}`, `${y}–${y + 9}`]), ...years.map(y => [String(y), String(y)]), ['missing', t('filters.missing')]],
      genre: [['', t('filters.allGenres')], ...genres.map(g => [g, g.charAt(0).toLocaleUpperCase() + g.slice(1)]), ['missing', t('filters.missing')]],
      rating: [['', t('filters.anyRating')], ...[6, 7, 8, 9].map(n => [String(n), `≥ ${nf.format(n)} / 10`]), ['missing', t('filters.missing')]],
    };
    for (const [key, field] of Object.entries(this.fields)) {
      field.label.hidden = key === 'genre' && type === 'movie';
      // The series' third menu takes the whole width rather than standing
      // alone in half of it.
      field.label.classList.toggle('wide', key === 'rating' && type === 'series');
      field.text.textContent = t(`filters.${key}`);
      const list = options[key];
      // Keep an active choice visible even in a category with no matches.
      if (!list.some(([value]) => value === filters[key])) list.push([filters[key], filters[key].replace(':', '–')]);
      // A menu open in the app's own list (js/picker.js) is left as it is:
      // its choices are what the viewer is reading, and a rebuild under
      // them moves the one about to be clicked. The next apply fills it in.
      if (isPicking(field.select)) continue;
      field.select.replaceChildren(...list.map(([value, text]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = text;
        return option;
      }));
      field.select.value = filters[key];
      field.select.classList.toggle('active', Boolean(filters[key]));
    }
    this.renderLength(entries, type, filters);
    const active = Object.values(filters).some(Boolean);
    foldSummary(this.caption, this.count, { label: t('filters.title'), shown: results.length, total: rows.length, active });
    this.reset.textContent = t('filters.reset');
    this.reset.disabled = !active;
    const missing = entries.some(e => !e.facts.year || !e.facts.rating || (type === 'series' && !e.facts.genres.length) || (type === 'movie' && !e.facts.minutes));
    // The genre field is hidden on movies because a film's genre there is
    // the provider's own category. A control that is present on Series and
    // gone on Movies needs to say why rather than leave it to be noticed.
    this.note.textContent = [type === 'movie' ? t('filters.genre.movie') : '', missing ? t('filters.incomplete') : '']
      .filter(Boolean).join(' ');
    this.renderActive(filters);
    return results;
  }

  // These remain visible when the filter form is collapsed, so the result
  // count can always be understood and each restriction removed directly.
  renderActive(filters) {
    if (!this.activeHost) return;
    const buttons = [];
    for (const [key, value] of Object.entries(filters)) {
      if (!value) continue;
      const field = this.fields[key];
      const label = key === 'length' ? `${t('title.duration')}: ${this.lengthText.textContent}`
        : `${field.text.textContent}: ${field.select.selectedOptions[0]?.textContent || value}`;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'filter-chip';
      button.textContent = `${label} ×`;
      button.setAttribute('aria-label', t('filters.remove', { filter: label }));
      button.addEventListener('click', async () => {
        const heldFocus = document.activeElement === button;
        filters[key] = '';
        await this.onChange();
        if (heldFocus && document.activeElement === document.body) this.summary.focus();
      });
      buttons.push(button);
    }
    this.activeHost.replaceChildren(...buttons);
    this.activeHost.hidden = !buttons.length;
  }
}
