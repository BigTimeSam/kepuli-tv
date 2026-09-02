// Listarivien DOM-rakentajat. Erillään sovelluslogiikasta, koska näitä
// kutsutaan jokaisella vieritysruudulla ja ne on pidettävä kevyinä.

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
 * Sama tähti kolmessa paikassa: listarivillä, sivupalkin ryhmällä ja
 * tarkennesirulla. Luokka vaihtuu, ele ja merkitys eivät.
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
  // Näkyvästä nimestä voi olla karsittu suodattimen jo kertoma etuliite;
  // title pitää koko nimen tallella.
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

/** Väliotsikko listassa: historian päivä tai suosikkien tyyppi. */
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
    // Luettu otsikko kertoo myös ääniraidan, joka ratkaisee toistettavuuden
    // useammin kuin kontti. Ilman sitä mennään päätteen varassa, ja se on
    // arvaus: se ei tiedä koodekeista mitään.
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
 * Kategoriarivi sivupalkkiin. onFavorite annetaan vain selattaville
 * ryhmille — kokoelmien tyyppisuodattimet eivät ole mitään mitä voisi
 * merkitä suosikiksi.
 */
export function categoryRow({ id, name, count, active, all, favorite, onFavorite, indent }, onSelect) {
  const row = el('div', 'group' + (active ? ' active' : '') + (all ? ' all' : ''));
  // Tähdetön rivi tähtien joukossa varaa saman tilan, jottei sen nimi ala
  // eri kohdasta kuin muiden.
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
 * Tarkennesiru. Tähti tekee sirusta säiliön kahdelle painikkeelle:
 * napattava nimi ja tähti, joka ei saa valita tarkennetta mukanaan.
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

// Pinottu lista: kategoria on nimensä mukaan joukko kohteita, ei yksi.
// Sama viivatyyli kuin yläpalkin hakukuvakkeessa.
const LIST_ICON = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 6h13M3.5 10h13M3.5 14h8"/></svg>';

/**
 * Suosikkikategorian rivi. Ei toistettava kohde vaan portti listaan, joten
 * se näyttää chevronin eikä logoa — ja tähti on aina päällä: rivi on
 * olemassa vain koska kategoria on suosikki.
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
