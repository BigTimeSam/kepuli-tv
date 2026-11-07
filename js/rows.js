// DOM builders for list rows. Kept apart from the application logic
// because these run on every scroll frame and must stay light.

import { clock, progressOf, duration, calendarDate, episodeCode, nf } from './format.js';
import { badge as probeBadge } from './probe.js';
import { t } from './i18n.js';
import { poster } from './poster.js';
import { ratingText } from './rating.js';
import { nameHasYear } from './titlemeta.js';

const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};

/**
 * The same star in three places: on a list row, on a sidebar group and on
 * a topic chip. The class changes; the gesture and the meaning do not.
 */
export function star(isFav, onToggle, cls = 'row-star') {
  const button = el('button', cls, '');
  button.type = 'button';
  setStar(button, isFav);
  // Out of the tab order: the keyboard walks the rows with the arrows and
  // has the star next to the player for the row it is on. Reachable by
  // Tab, hundreds of stars would stand between the list and the player.
  button.tabIndex = -1;
  button.addEventListener('click', (e) => { e.stopPropagation(); onToggle(); });
  return button;
}

export function setStar(button, isFav) {
  button.classList.toggle('on', isFav);
  button.textContent = isFav ? '★' : '☆';
  button.title = t(isFav ? 'row.fav.remove' : 'row.fav.add');
  button.setAttribute('aria-label', button.title);
}

function remove(title, onRemove) {
  const button = el('button', 'row-x', '×');
  button.type = 'button';
  button.title = title;
  button.setAttribute('aria-label', title);
  button.tabIndex = -1;
  button.addEventListener('click', (e) => { e.stopPropagation(); onRemove(); });
  return button;
}

/**
 * The row's own actions — a favourite or not, hide — behind one mark, out of the tab order like the star: the keyboard opens the same
 * menu with the context-menu key on the row it stands on.
 */
function more(onMenu) {
  const button = el('button', 'row-more');
  button.type = 'button';
  button.title = t('row.menu');
  button.setAttribute('aria-label', button.title);
  button.setAttribute('aria-haspopup', 'menu');
  button.tabIndex = -1;
  button.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="4.5" cy="10" r="1.5"/><circle cx="10" cy="10" r="1.5"/><circle cx="15.5" cy="10" r="1.5"/></svg>';
  button.addEventListener('click', (e) => { e.stopPropagation(); onMenu(button); });
  return button;
}

function listOption(className, ctx) {
  const row = el('div', className);
  row.setAttribute('role', 'option');
  row.setAttribute('aria-selected', String(Boolean(ctx.selected)));
  if (ctx.domId) row.id = ctx.domId;
  if (ctx.selected) row.classList.add('selected');
  // The one that is on: said by a screen reader, not only shown in colour.
  if (ctx.playing) {
    row.classList.add('playing');
    row.setAttribute('aria-current', 'true');
  }
  return row;
}

/**
 * An option's name, said as the viewer reads the row: the name first, then
 * whether it is a favourite, then the line under it. Named from its content,
 * an option took the star button's name in too, and the sidebar was read as
 * "Add to favourites Denmark", "Add to favourites Finland"…, every row
 * beginning with the same three words. The words are the ones on screen,
 * joined; "favourite" is the Favourites tab's own name.
 */
// Each row's and card's spoken parts, for markFavorite to change one.
const spokenParts = new WeakMap();

function nameOption(option, parts) {
  spokenParts.set(option, parts);
  option.setAttribute('aria-label', parts.filter(Boolean).join(', '));
  return option;
}

/**
 * A painted row's or card's star and spoken name changed where they are:
 * repainting the list for a star rebuilt every card on screen and loaded
 * its picture again, and the whole list flashed.
 */
export function markFavorite(node, isFav) {
  const button = node?.querySelector('.row-star');
  if (!button) return;
  setStar(button, isFav);
  const parts = spokenParts.get(node);
  if (!parts) return;
  parts[1] = isFav ? t('favs.title') : null;
  nameOption(node, parts);
}

/**
 * A button inside an option is out of reach of a screen reader anyway (an
 * option holds no controls) and only spoiled the option's name; the keys do
 * its work from the list (s for the star, the context-menu key for ⋯, Delete
 * in the history). The pointer still has it.
 */
function quiet(button) {
  button.setAttribute('aria-hidden', 'true');
  return button;
}

/**
 * @param {object} item
 * @param {object} ctx { label, playing, selected, favorite, epg, resume, tag, onOpen,
 *                       onFavorite, onRemove, showEpisodeCover, onMenu }
 */
export function itemRow(item, ctx) {
  const row = listOption('row', ctx);

  row.appendChild(quiet(star(ctx.favorite, ctx.onFavorite)));

  if (ctx.compact) {
    // The favourites and the history mix every kind: one square for all of
    // them, a cover cropped into it and a logo set in it, so that the names
    // start in one column and no picture outweighs the next.
    const kind = item.k === 0 ? 'channel' : item.k === 1 ? 'movie' : 'series';
    row.appendChild(poster('row-thumb', item.k === 3 ? item.seriesCover || item.logo : item.logo, kind));
  } else if (item.k === 0) row.appendChild(poster('row-logo', item.logo, 'channel'));
  else if (item.k === 1 || item.k === 2) row.appendChild(poster('row-poster', item.logo, item.k === 2 ? 'series' : 'movie'));
  else if (item.k === 3 && ctx.showEpisodeCover) row.appendChild(poster('row-poster', item.seriesCover || item.logo, 'series'));

  const body = el('div', 'row-body');
  // The visible name may have lost a prefix the filter already states;
  // the title keeps the whole name available.
  const name = el('div', 'row-name', ctx.label || item.n);
  name.title = item.n;
  body.appendChild(name);

  const sub = subLine(item, ctx);
  if (sub) body.appendChild(sub);
  const bar = progressBar(item, ctx);
  if (bar) body.appendChild(bar);
  row.appendChild(body);

  // A compact row keeps the name whole: what the badges said is on the
  // line under it, and what the buttons did is in the menu.
  const spoken = [ctx.label || item.n, ctx.favorite ? t('favs.title') : null, sub?.textContent];
  if (!ctx.compact) {
    for (const [badge, words] of badges(item, ctx)) {
      row.appendChild(badge);
      spoken.push(words);
    }
  }
  nameOption(row, spoken);
  if (item.k === 2) row.appendChild(el('div', 'row-chevron', '›'));
  if (ctx.onRemove && !ctx.compact) row.appendChild(quiet(remove(ctx.removeTitle || t('row.remove.history'), ctx.onRemove)));
  if (ctx.onMenu) {
    row.appendChild(quiet(more(ctx.onMenu)));
    row.addEventListener('contextmenu', (e) => { e.preventDefault(); ctx.onMenu({ x: e.clientX, y: e.clientY }); });
  }

  row.addEventListener('click', ctx.onOpen);
  return row;
}

/**
 * A film or a series as a cover in the grid. The same option as a row —
 * the same id, the same selection, the same star and the same click — so
 * the list's keyboard, its screen-reader names and its tests do not care
 * which of the two it is showing. The cover carries the progress of a film
 * left halfway along its foot.
 *
 * @param {object} ctx as for itemRow
 */
export function posterCard(item, ctx) {
  const card = listOption('row card', ctx);
  const cover = poster('card-poster', item.logo, item.k === 2 ? 'series' : 'movie');
  if (ctx.resume && ctx.resume.duration > 0) {
    const bar = el('div', 'row-progress resume');
    const fill = document.createElement('i');
    fill.style.width = `${Math.round(Math.min(1, ctx.resume.position / ctx.resume.duration) * 100)}%`;
    bar.appendChild(fill);
    cover.appendChild(bar);
  }
  // Seen to the end, or new from the provider, in the cover's top corner,
  // away from the star's: one of the two, as a title seen is not new.
  const flag = ctx.watched ? ['watched', '✓', t('cover.watched')] : ctx.isNew ? ['new', t('cover.new'), t('cover.new.title')] : null;
  if (flag) {
    const mark = el('span', `card-flag ${flag[0]}`, flag[1]);
    mark.title = flag[2];
    cover.appendChild(mark);
  }
  card.appendChild(cover);
  card.appendChild(quiet(star(ctx.favorite, ctx.onFavorite, 'row-star card-star')));

  const name = el('div', 'row-name card-name', ctx.label || item.n);
  name.title = item.n;
  card.appendChild(name);

  const bits = [];
  // A provider's name often carries the year already: "Iron Tide (2009)".
  if (item.year && !nameHasYear(ctx.label || item.n, item.year)) bits.push(item.year);
  const rating = ratingText(item.details) || ratingText(item);
  if (rating) bits.push(rating);
  const seconds = item.k === 1 ? item.details?.durationSec || item.durationSec || ctx.resume?.duration : 0;
  if (Number.isFinite(seconds) && seconds > 0) bits.push(duration(seconds, { compact: true }));
  const meta = el('div', 'card-meta', bits.join(', ') || '\u00a0');
  const tags = versionTags(ctx.versions);
  // Which copy this is, when the list holds the title more than once: on
  // the facts' own line, as the grid's lines are all one height.
  // First, as the facts' end goes to an ellipsis when the line is full.
  if (tags.length) {
    if (!bits.length) meta.textContent = '';
    meta.prepend(...tags.map((tag) => el('span', 'card-tag', tag)));
  }
  card.appendChild(meta);
  nameOption(card, [ctx.label || item.n, ctx.favorite ? t('favs.title') : null, bits.join(', '), ...tags,
    flag ? flag[2] : null]);

  card.addEventListener('click', ctx.onOpen);
  return card;
}

/** A section heading in the list: a history day or a favourites type. */
export function sectionHeader(label, paths = null) {
  const head = el('div', 'daysep');
  if (paths) {
    const mark = icon(paths);
    mark.classList.add('daysep-icon');
    head.append(mark);
  }
  head.append(el('span', 'daysep-label', label));
  return head;
}

/** The headings' marks in the history: what was left halfway, and a day. */
export const HISTORY_ICONS = {
  continue: '<circle cx="10" cy="10" r="7.2"/><path d="m8.4 7.2 4.4 2.8-4.4 2.8z"/>',
  day: '<rect x="3" y="4.5" width="14" height="12.5" rx="1.8"/><path d="M3 8.5h14M7 2.8v3.4M13 2.8v3.4"/>',
};

function subLine(item, ctx) {
  if (ctx.compact && item.k !== 0) return compactLine(item, ctx);
  if (item.k === 0) {
    const entry = ctx.epg;
    if (!entry || !entry.now) return null;
    const sub = el('div', 'row-sub');
    sub.appendChild(el('span', 'txt', `${clock(entry.now.start)} ${entry.now.title}`));
    return sub;
  }

  const bits = [];
  const rating = ratingText(item.details) || ratingText(item);
  // The year once: not again beside a name that says it already.
  const year = item.year && !nameHasYear(ctx.label || item.n, item.year) ? item.year : null;
  if (item.k === 1) {
    if (year) bits.push(year);
    if (rating) bits.push(rating);
  }
  if (item.k === 2) {
    if (year) bits.push(year);
    if (item.genre) bits.push(item.genre.split(',')[0].trim());
    if (rating) bits.push(rating);
  }
  if (item.k === 3) {
    if (item.durationSec) bits.push(duration(item.durationSec));
    const aired = calendarDate(item.airDate);
    if (aired) bits.push(aired);
  }

  if (!bits.length) return null;
  const sub = el('div', 'row-sub');
  sub.appendChild(el('span', 'txt', bits.join(', ')));
  return sub;
}

/** The badges' facts as the line under a compact row's name. */
function compactLine(item, ctx) {
  const bits = [];
  const rating = ratingText(item.details) || ratingText(item);
  if (item.k === 3) bits.push(episodeCode(item.season, item.episode));
  if ((item.k === 1 || item.k === 2) && item.year && !nameHasYear(ctx.label || item.n, item.year)) bits.push(item.year);
  if (item.k === 2 && item.genre) bits.push(item.genre.split(',')[0].trim());
  if (rating && item.k !== 3) bits.push(rating);
  const seconds = item.k === 1 ? item.details?.durationSec || item.durationSec || ctx.resume?.duration
    : item.k === 3 ? item.durationSec : 0;
  if (Number.isFinite(seconds) && seconds > 0) bits.push(duration(seconds, { compact: true }));
  if (!bits.length) return null;
  const sub = el('div', 'row-sub');
  sub.appendChild(el('span', 'txt', bits.join(', ')));
  return sub;
}

/**
 * How far the programme on air has got, or how far a film was watched. A
 * line of its own under the text, the same length on every row: beside the
 * text it began wherever the title happened to end, and a column of bars
 * that each start somewhere else cannot be compared at a glance.
 */
function progressBar(item, ctx) {
  let share = null, cls = 'row-progress';
  if (item.k === 0) share = ctx.epg?.now ? progressOf(ctx.epg.now) : null;
  else if (ctx.resume && ctx.resume.duration > 0) {
    share = Math.min(1, ctx.resume.position / ctx.resume.duration);
    cls = 'row-progress resume';
  }
  if (share == null) return null;
  const bar = el('div', cls);
  const fill = document.createElement('i');
  fill.style.width = `${Math.round(share * 100)}%`;
  bar.appendChild(fill);
  return bar;
}

/**
 * A badge says "7 d" because that is what a narrow column has room for, and
 * the whole sentence sat in a title attribute — which is a hover, and a
 * hover is no gesture on a touch screen and nothing at all to a screen
 * reader. The title stays for the pointer; the sentence is now also in the
 * badge, where only a screen reader will find it.
 */
function explained(node, sentence) {
  node.title = sentence;
  node.appendChild(el('span', 'sr-only', sentence));
  return node;
}

function icon(paths) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = paths;
  return svg;
}
const svgIcon = icon;

/**
 * The marks of the kinds of thing a collection holds — the same as the
 * tabs' in the top bar, so that a channel, a film and a series are the same
 * mark wherever they are counted.
 */
export const KIND_ICONS = {
  all: '<rect x="3" y="3" width="6" height="6" rx="1.2"/><rect x="11" y="3" width="6" height="6" rx="1.2"/><rect x="3" y="11" width="6" height="6" rx="1.2"/><rect x="11" y="11" width="6" height="6" rx="1.2"/>',
  c: '<path d="M2.8 6V4.6c0-.6.5-1.1 1.1-1.1h3.6l1.6 1.9h7c.6 0 1.1.5 1.1 1.1V15c0 .6-.5 1.1-1.1 1.1H3.9c-.6 0-1.1-.5-1.1-1.1z"/>',
  0: '<rect x="2.5" y="5" width="15" height="10.5" rx="1.8"/><path d="M7 2.5 10 5l3-2.5M6.5 18h7"/>',
  1: '<rect x="3" y="3" width="14" height="14" rx="1.8"/><path d="M7 3v14M13 3v14M3 7h4M3 13h4M13 7h4M13 13h4M3 10h14"/>',
  2: '<rect x="2.5" y="6" width="13" height="10.5" rx="1.8"/><path d="M5.5 3.5h11a1.5 1.5 0 0 1 1.5 1.5v8.5"/><path d="m8 9 4 2.25L8 13.5z"/>',
};

/** The badges, each with the words a screen reader says for it in the row's name. */
/** The words for ctx.versions (js/titlemeta.js, versionLabels): the tags, or "Version 2". */
function versionTags(versions) {
  if (!versions) return [];
  return Array.isArray(versions) ? versions.slice(0, 3) : [t('cover.version', { n: versions.version })];
}

function badges(item, ctx) {
  const out = [];
  for (const tag of versionTags(ctx.versions)) out.push([el('div', 'row-badge version', tag), tag]);
  if (ctx.watched) out.push([explained(el('div', 'row-badge watched', '✓'), t('cover.watched')), t('cover.watched')]);
  else if (ctx.isNew) out.push([el('div', 'row-badge new', t('cover.new')), t('cover.new.title')]);
  // A channel's archive is not said here: it is used from the programme
  // guide, which marks it on the channel, and on a list row the badge only
  // raised the question of what to do with it.
  if (item.k === 1) {
    const seconds = item.details?.durationSec || item.durationSec || ctx.resume?.duration;
    if (Number.isFinite(seconds) && seconds > 0) {
      const text = duration(seconds, { compact: true });
      out.push([explained(el('div', 'row-duration', text), t('title.duration')), `${t('title.duration')} ${text}`]);
    }
  }
  if (item.k === 3) {
    // Show actual playback limitations from the header, never a format
    // badge inferred from an extension (including an unprobed MKV).
    const known = ctx.probe ? probeBadge(ctx.probe) : null;
    if (known) {
      out.push([explained(el('div', `row-badge ${known.level}`, known.text), known.title), known.title]);
    }
  }
  if (item.k === 3) {
    const code = `S${String(item.season).padStart(2, '0')}E${String(item.episode).padStart(2, '0')}`;
    out.push([el('div', 'row-ep', code), code]);
  }
  if (ctx.tag) {
    const node = el('div', 'row-badge', ctx.tag.text);
    if (ctx.tag.icon === 'clock') {
      node.classList.add('row-time');
      node.prepend(icon('<circle cx="10" cy="10" r="6.5"/><path d="M10 6.4V10l2.6 1.6"/>'));
    }
    if (ctx.tag.title) node.title = ctx.tag.title;
    out.push([node, ctx.tag.text]);
  }
  return out;
}

/**
 * A category row for the sidebar. onFavorite is given only for browsable
 * groups — a collection's type filters are not something that could be
 * marked as a favourite.
 */
export function categoryRow({ id, name, count, active, all, favorite, onFavorite, indent, icon }, onSelect) {
  const row = el('div', 'group' + (active ? ' active' : '') + (all ? ' all' : ''));
  // An option of the sidebar's listbox. It used to be a list item with a
  // tabindex — a role that tells a screen reader "not interactive" on an
  // element that was, and twelve tab stops between the filter above and the
  // list beside it. The container holds the one stop now and the keys are
  // handled there, so the row itself is not focusable.
  row.setAttribute('role', 'option');
  row.setAttribute('aria-selected', String(Boolean(active)));
  // A starless row among starred ones reserves the same space, so that
  // its name does not start at a different offset from the rest.
  if (onFavorite) row.appendChild(quiet(star(favorite, onFavorite, 'group-star')));
  else if (indent) row.appendChild(el('div', 'group-star'));
  if (icon) {
    const mark = svgIcon(icon);
    mark.classList.add('group-icon');
    row.appendChild(mark);
  }
  const label = el('div', 'group-name', name);
  label.title = name;
  row.appendChild(label);
  if (count != null) row.appendChild(el('div', 'group-count', typeof count === 'number' ? nf.format(count) : String(count)));
  nameOption(row, [name, favorite ? t('favs.title') : null, count != null ? (typeof count === 'number' ? nf.format(count) : String(count)) : null]);
  row.addEventListener('click', () => onSelect(id));
  return row;
}

/**
 * A topic chip. The star makes the chip a container for two buttons: the
 * name you press, and the star, which must not select the topic with it.
 */
export function chipRow({ label, count, active, title, favorite, onFavorite }, onSelect) {
  const box = el('span', 'chip' + (active ? ' active' : '') + (onFavorite ? '' : ' plain'));
  const main = el('button', 'chip-main', label);
  main.type = 'button';
  if (title) main.title = title;
  if (count != null) main.appendChild(el('span', 'n', typeof count === 'number' ? nf.format(count) : String(count)));
  main.addEventListener('click', onSelect);
  box.appendChild(main);
  if (onFavorite) box.appendChild(star(favorite, onFavorite, 'chip-star'));
  return box;
}

// Stacked lines: a category is by definition a set of items, not one.
// The same stroke style as the search icon in the top bar.
const LIST_ICON = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 6h13M3.5 10h13M3.5 14h8"/></svg>';

/**
 * A favourite category's row. Not a playable item but a door into a list,
 * so it shows a chevron rather than a logo — and the star is always on:
 * the row exists only because the category is a favourite.
 *
 * @param {object} ctx { subtitle, count, selected, onOpen, onFavorite }
 */
export function favCategoryRow(entry, ctx) {
  const row = listOption('row row-cat', ctx);
  row.appendChild(quiet(star(true, ctx.onFavorite)));

  const icon = el('div', 'row-cat-icon');
  icon.innerHTML = LIST_ICON;
  row.appendChild(icon);

  const body = el('div', 'row-body');
  const name = el('div', 'row-name', entry.n);
  name.title = entry.full || entry.n;
  body.appendChild(name);
  if (ctx.subtitle) {
    const sub = el('div', 'row-sub');
    sub.appendChild(el('span', 'txt', ctx.subtitle));
    body.appendChild(sub);
  }
  row.appendChild(body);

  if (ctx.count != null) {
    const badge = el('div', 'row-badge', String(ctx.count));
    badge.title = t('row.cat.count.title');
    row.appendChild(badge);
  }
  row.appendChild(el('div', 'row-chevron', '›'));
  nameOption(row, [entry.n, t('favs.title'), ctx.subtitle, ctx.count != null ? String(ctx.count) : null]);

  row.addEventListener('click', ctx.onOpen);
  return row;
}

// A mark above an empty list's words, so the state is told apart before it
// is read: a star where favourites gather, a clock for history, a lens for
// a search that found nothing.
const EMPTY_ICONS = {
  star: '<path d="M10 2.8l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L2.8 8.1l5-.7z"/>',
  history: '<path d="M3.5 10a6.5 6.5 0 1 0 1.9-4.6"/><path d="M3.2 3.2v3.4h3.4"/><path d="M10 6.5v3.8l2.6 1.5"/>',
  search: '<circle cx="9" cy="9" r="5.5"/><path d="m13.2 13.2 4 4"/>',
  list: '<path d="M4 5.5h12M4 10h12M4 14.5h7"/>',
};

/**
 * An empty list's notice: a mark, a title, a line of text (or several, each
 * a paragraph of its own) and the ways out. `action` is one `{ label,
 * onClick }` or a list of them; the first is the primary one.
 */
export function emptyState(title, text, action, iconName = 'list') {
  const box = el('div', 'empty');
  const mark = icon(EMPTY_ICONS[iconName] || EMPTY_ICONS.list);
  mark.classList.add('empty-icon');
  box.appendChild(mark);
  box.appendChild(el('strong', null, title));
  for (const line of Array.isArray(text) ? text : [text]) box.appendChild(el('div', null, line));
  const actions = (Array.isArray(action) ? action : [action]).filter(Boolean);
  if (actions.length) {
    const row = el('div', 'empty-actions');
    actions.forEach(({ label, onClick }, i) => {
      const button = el('button', i ? 'ghost' : 'primary', label);
      button.type = 'button';
      button.addEventListener('click', onClick);
      row.appendChild(button);
    });
    box.appendChild(row);
  }
  return box;
}
