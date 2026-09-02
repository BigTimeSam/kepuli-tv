// DOM builders for list rows. Kept apart from the application logic
// because these run on every scroll frame and must stay light.

import { clock, progressOf, duration } from './format.js';
import { isPlayableExtension } from './xtream.js';
import { badge as probeBadge } from './probe.js';
import { t } from './i18n.js';

const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};

function image(cls, src) {
  const img = el('img', cls);
  img.loading = 'lazy';
  img.decoding = 'async';
  img.alt = '';
  if (src) img.src = src; else img.classList.add('blank');
  img.addEventListener('error', () => img.classList.add('blank'), { once: true });
  return img;
}

/**
 * The same star in three places: on a list row, on a sidebar group and on
 * a topic chip. The class changes; the gesture and the meaning do not.
 */
function star(isFav, onToggle, cls = 'row-star') {
  const button = el('button', cls + (isFav ? ' on' : ''), isFav ? '★' : '☆');
  button.type = 'button';
  button.title = t(isFav ? 'row.fav.remove' : 'row.fav.add');
  button.addEventListener('click', (e) => { e.stopPropagation(); onToggle(); });
  return button;
}

function remove(title, onRemove) {
  const button = el('button', 'row-x', '×');
  button.type = 'button';
  button.title = title;
  button.addEventListener('click', (e) => { e.stopPropagation(); onRemove(); });
  return button;
}

/**
 * @param {object} item
 * @param {object} ctx { label, playing, selected, favorite, epg, resume, tag, onOpen,
 *                       onFavorite, onRemove }
 */
export function itemRow(item, ctx) {
  const row = el('div', 'row');
  if (ctx.playing) row.classList.add('playing');
  if (ctx.selected) row.classList.add('selected');

  row.appendChild(star(ctx.favorite, ctx.onFavorite));

  if (item.k === 0) row.appendChild(image('row-logo', item.logo));
  else if (item.k === 1 || item.k === 2) row.appendChild(image('row-poster', item.logo));

  const body = el('div', 'row-body');
  // The visible name may have lost a prefix the filter already states;
  // the title keeps the whole name available.
  const name = el('div', 'row-name', ctx.label || item.n);
  name.title = item.n;
  body.appendChild(name);

  const sub = subLine(item, ctx);
  if (sub) body.appendChild(sub);
  row.appendChild(body);

  for (const badge of badges(item, ctx)) row.appendChild(badge);
  if (item.k === 2) row.appendChild(el('div', 'row-chevron', '›'));
  if (ctx.onRemove) row.appendChild(remove(ctx.removeTitle || 'Poista', ctx.onRemove));

  row.addEventListener('click', ctx.onOpen);
  return row;
}

/** A section heading in the list: a history day or a favourites type. */
export function sectionHeader(label) {
  return el('div', 'daysep', label);
}

function subLine(item, ctx) {
  if (item.k === 0) {
    const entry = ctx.epg;
    if (!entry || !entry.now) return null;
    const sub = el('div', 'row-sub');
    sub.appendChild(el('span', 'txt', `${clock(entry.now.start)} ${entry.now.title}`));
    const share = progressOf(entry.now);
    if (share != null) {
      const bar = el('div', 'row-progress');
      const fill = document.createElement('i');
      fill.style.width = `${Math.round(share * 100)}%`;
      bar.appendChild(fill);
      sub.appendChild(bar);
    }
    return sub;
  }

  const bits = [];
  if (item.k === 1) {
    if (item.year) bits.push(item.year);
    if (item.rating) bits.push(`★ ${item.rating.toFixed(1)}`);
  }
  if (item.k === 2) {
    if (item.year) bits.push(item.year);
    if (item.genre) bits.push(item.genre.split(',')[0].trim());
    if (item.rating) bits.push(`★ ${item.rating.toFixed(1)}`);
  }
  if (item.k === 3) {
    if (item.durationSec) bits.push(duration(item.durationSec));
    if (item.airDate) bits.push(item.airDate);
  }

  const resume = ctx.resume;
  if (!bits.length && !resume) return null;

  const sub = el('div', 'row-sub');
  if (bits.length) sub.appendChild(el('span', 'txt', bits.join(' · ')));
  if (resume && resume.duration > 0) {
    const bar = el('div', 'row-resume');
    const fill = document.createElement('i');
    fill.style.width = `${Math.min(100, Math.round((resume.position / resume.duration) * 100))}%`;
    bar.appendChild(fill);
    sub.appendChild(bar);
  }
  return sub;
}

function badges(item, ctx) {
  const out = [];
  if (item.k === 0 && item.archive > 0) {
    const badge = el('div', 'row-badge archive', t('row.archive', { days: item.archive }));
    badge.title = t('row.archive.title', { days: item.archive });
    out.push(badge);
  }
  if (item.k === 1 || item.k === 3) {
    // A header that has been read also names the audio track, which
    // decides playability more often than the container does. Without it
    // we go by the file extension, and that is a guess: it knows nothing
    // about codecs.
    const known = ctx.probe ? probeBadge(ctx.probe) : null;
    if (known) {
      const node = el('div', `row-badge ${known.level}`, known.text);
      node.title = known.title;
      out.push(node);
    } else if (!ctx.probe && item.ext && !isPlayableExtension(item.ext)) {
      const node = el('div', 'row-badge warn', item.ext.toUpperCase());
      node.title = t('row.ext.warn');
      out.push(node);
    }
  }
  if (item.k === 3) out.push(el('div', 'row-ep', `S${String(item.season).padStart(2, '0')}E${String(item.episode).padStart(2, '0')}`));
  if (ctx.tag) {
    const node = el('div', 'row-badge', ctx.tag.text);
    if (ctx.tag.title) node.title = ctx.tag.title;
    out.push(node);
  }
  return out;
}

/**
 * A category row for the sidebar. onFavorite is given only for browsable
 * groups — a collection's type filters are not something that could be
 * marked as a favourite.
 */
export function categoryRow({ id, name, count, active, all, favorite, onFavorite, indent }, onSelect) {
  const row = el('div', 'group' + (active ? ' active' : '') + (all ? ' all' : ''));
  // A starless row among starred ones reserves the same space, so that
  // its name does not start at a different offset from the rest.
  if (onFavorite) row.appendChild(star(favorite, onFavorite, 'group-star'));
  else if (indent) row.appendChild(el('div', 'group-star'));
  const label = el('div', 'group-name', name);
  label.title = name;
  row.appendChild(label);
  if (count != null) row.appendChild(el('div', 'group-count', String(count)));
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
  if (count != null) main.appendChild(el('span', 'n', String(count)));
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
  const row = el('div', 'row row-cat');
  if (ctx.selected) row.classList.add('selected');
  row.appendChild(star(true, ctx.onFavorite));

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

  row.addEventListener('click', ctx.onOpen);
  return row;
}

export function emptyState(title, text, action) {
  const box = el('div', 'empty');
  box.appendChild(el('strong', null, title));
  box.appendChild(el('div', null, text));
  if (action) {
    const button = el('button', 'primary', action.label);
    button.type = 'button';
    button.addEventListener('click', action.onClick);
    box.appendChild(button);
  }
  return box;
}
