// Interaktiivinen ohjelmaopas: kanavat riveinä, aika vaaka-akselilla.
//
// Molemmat akselit virtualisoidaan. 500 kanavaa × 7 vuorokautta olisi
// satojatuhansia elementtejä, joten piirretään vain se ruudullinen joka
// oikeasti näkyy — samasta syystä kuin listakin (vlist.js). Ruudukon
// viivat tulevat taustakuviosta eivätkä DOM:sta, jolloin 46 000 pikselin
// levyinen kangas ei maksa mitään.
//
// Aika-akselin nollakohta on keskiyö: silloin puolen tunnin ruudukko ja
// vuorokausirajat osuvat taustakuvion kanssa kohdalleen ilman siirtoa.

import { clock, shortDay, stampFmt, progressOf } from './format.js';
import { t } from './i18n.js';

const ROW_H = 48;              // pidettävä samana kuin --epg-row CSS:ssä
const ZOOMS = [2, 3, 5, 8];    // pikseliä per minuutti
const PAST_DAYS = 2;
const FUTURE_DAYS = 5;
const SLOT_MIN = 30;
const MARGIN_MIN = 90;         // näkyvän alueen ulkopuolelle piirrettävä puskuri
const LEAD_MIN = 15;           // kuinka paljon mennyttä näkyy "Nyt"-kohdassa
const TICK_MS = 20e3;

/** Onko ohjelma katsottavissa kanavan catchup-ikkunasta? */
export function catchupAvailable(channel, programme, now = Date.now()) {
  if (!channel || !programme || !channel.archive) return false;
  if (programme.stop > now) return false;
  return programme.start > now - channel.archive * 86400e3;
}

export class EpgGrid {
  /**
   * @param {object} refs { scroll, canvas, timesInner, chansInner, corner, days, clock }
   * @param {object} opts { label, onSelect, onActivate, onChannel, onWindow }
   */
  constructor(refs, opts = {}) {
    this.el = refs;
    this.epg = null;               // asetetaan yhteyden auettua
    this.channels = [];
    this.playingId = null;
    this.zoomIndex = 2;
    this.origin = 0;
    this.end = 0;
    this.width = 0;
    this.focusTime = Date.now();
    this.cursorRow = 0;
    this.selection = null;         // { row, programme }
    this.open = false;
    this.ticking = false;
    this.timer = null;
    this.lastWindowKey = '';
    this.dayButtons = [];

    this.label = opts.label || ((channel) => channel.n);
    this.onSelect = opts.onSelect || (() => {});
    this.onActivate = opts.onActivate || (() => {});
    this.onChannel = opts.onChannel || (() => {});
    this.onWindow = opts.onWindow || (() => {});

    this.nowLine = document.createElement('div');
    this.nowLine.className = 'epg-nowline';
    this.nowHead = document.createElement('div');
    this.nowHead.className = 'epg-nowhead';

    this.el.scroll.addEventListener('scroll', () => this.schedule(), { passive: true });
    this.resizeObserver = new ResizeObserver(() => this.paint());
    this.resizeObserver.observe(this.el.scroll);
    this.el.canvas.addEventListener('click', (e) => this.pick(e, false));
    this.el.canvas.addEventListener('dblclick', (e) => this.pick(e, true));
    this.el.chansInner.addEventListener('click', (e) => {
      const row = e.target.closest('[data-row]');
      if (row) this.onChannel(this.channels[Number(row.dataset.row)]);
    });
  }

  get zoom() { return ZOOMS[this.zoomIndex]; }

  /* ---------------------------------------------------------- aika-akseli */

  minutes(ms) { return (ms - this.origin) / 60000; }
  x(ms) { return this.minutes(ms) * this.zoom; }
  timeAt(px) { return this.origin + (px / this.zoom) * 60000; }

  /**
   * Aikajanan mitat ja kiinteät osat. Ei piirrä: piirto pyytää samalla
   * näkyvien kanavien ohjelmatiedot, joten se on tehtävä vasta kun
   * vieritys on oikeassa kohdassa — muuten haetaan väärän ikkunan tiedot.
   */
  layout() {
    const midnight = new Date().setHours(0, 0, 0, 0);
    this.origin = startOfDay(midnight, -PAST_DAYS);
    this.end = startOfDay(midnight, FUTURE_DAYS);
    this.width = this.minutes(this.end) * this.zoom;

    this.el.canvas.style.width = `${this.width}px`;
    this.el.timesInner.style.width = `${this.width}px`;
    this.el.canvas.style.setProperty('--slot', `${SLOT_MIN * this.zoom}px`);
    this.el.canvas.style.setProperty('--hour', `${60 * this.zoom}px`);

    this.renderTicks();
    this.renderDays();
  }

  renderTicks() {
    const frag = document.createDocumentFragment();
    const total = this.minutes(this.end);
    for (let m = 0; m < total; m += SLOT_MIN) {
      const at = this.origin + m * 60000;
      const d = new Date(at);
      const midnight = d.getHours() === 0 && d.getMinutes() === 0;
      const tick = document.createElement('div');
      tick.className = 'epg-tick'
        + (d.getMinutes() === 0 ? ' hour' : '')
        + (midnight ? ' day' : '');
      tick.style.left = `${m * this.zoom}px`;
      tick.style.width = `${SLOT_MIN * this.zoom}px`;
      tick.textContent = midnight ? shortDay(at) : clock(at);
      frag.appendChild(tick);
    }
    this.el.timesInner.replaceChildren(frag);
    this.el.timesInner.appendChild(this.nowHead);
  }

  renderDays() {
    const frag = document.createDocumentFragment();
    this.dayButtons = [];
    for (let at = this.origin; at < this.end; at = startOfDay(at, 1)) {
      const day = at;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'epg-day';
      button.textContent = shortDay(day);
      button.addEventListener('click', () => this.goDay(day));
      this.dayButtons.push({ at: day, node: button });
      frag.appendChild(button);
    }
    this.el.days.replaceChildren(frag);
  }

  /* -------------------------------------------------------------- piirto */

  schedule() {
    if (this.ticking) return;
    this.ticking = true;
    requestAnimationFrame(() => { this.ticking = false; this.paint(); });
  }

  paint() {
    if (!this.open || !this.width) return;
    const { scrollLeft, scrollTop, clientWidth, clientHeight } = this.el.scroll;

    // Otsikkorivi ja kanavasarake seuraavat vieritystä siirtymällä; omat
    // vierityspalkit näyttäisivät kolme päällekkäistä palkkia.
    this.el.timesInner.style.transform = `translateX(${-scrollLeft}px)`;
    this.el.chansInner.style.transform = `translateY(${-scrollTop}px)`;

    const from = this.timeAt(scrollLeft);
    const to = this.timeAt(scrollLeft + clientWidth);
    const first = Math.max(0, Math.floor(scrollTop / ROW_H) - 2);
    const last = Math.min(this.channels.length, Math.ceil((scrollTop + clientHeight) / ROW_H) + 2);

    this.paintChannels(first, last);
    this.paintBlocks(first, last, scrollLeft, clientWidth);
    this.moveNow();

    this.el.corner.textContent = shortDay(from);
    for (const day of this.dayButtons) {
      day.node.classList.toggle('active', from >= day.at && from < startOfDay(day.at, 1));
    }

    const key = `${first}:${last}:${Math.round(from / 6e5)}:${Math.round(to / 6e5)}`;
    if (key !== this.lastWindowKey) {
      this.lastWindowKey = key;
      this.onWindow(this.channels.slice(first, last), from, to);
    }
  }

  paintChannels(first, last) {
    const frag = document.createDocumentFragment();
    for (let i = first; i < last; i++) {
      const ch = this.channels[i];
      const row = document.createElement('div');
      row.className = 'epg-chan'
        + (String(ch.id) === String(this.playingId) ? ' playing' : '')
        + (i === this.cursorRow ? ' cursor' : '');
      row.dataset.row = String(i);
      row.style.top = `${i * ROW_H}px`;
      row.title = ch.n;

      const img = document.createElement('img');
      img.className = 'epg-chan-logo';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.alt = '';
      if (ch.logo) img.src = ch.logo; else img.classList.add('blank');
      img.addEventListener('error', () => img.classList.add('blank'), { once: true });
      row.appendChild(img);

      const body = document.createElement('div');
      body.className = 'epg-chan-body';
      if (ch.num) {
        const num = document.createElement('span');
        num.className = 'epg-chan-num';
        num.textContent = String(ch.num).padStart(4, '0');
        body.appendChild(num);
      }
      const name = document.createElement('span');
      name.className = 'epg-chan-name';
      name.textContent = this.label(ch);
      body.appendChild(name);
      row.appendChild(body);

      if (ch.archive > 0) {
        const badge = document.createElement('span');
        badge.className = 'epg-chan-rec';
        badge.textContent = t('row.archive', { days: ch.archive });
        badge.title = t('guide.catchup.title', { days: ch.archive });
        row.appendChild(badge);
      }
      frag.appendChild(row);
    }
    this.el.chansInner.replaceChildren(frag);
  }

  paintBlocks(first, last, scrollLeft, clientWidth) {
    const now = Date.now();
    const visFrom = this.timeAt(scrollLeft);
    const visTo = this.timeAt(scrollLeft + clientWidth);
    const margin = MARGIN_MIN * 60000;
    const frag = document.createDocumentFragment();

    for (let i = first; i < last; i++) {
      const ch = this.channels[i];
      const listings = this.epg ? this.epg.listingsIn(ch.id, visFrom - margin, visTo + margin) : null;
      if (!listings) {
        frag.appendChild(this.gap(i, visFrom, visTo, t(ch.epgId ? 'guide.loading' : 'guide.noepg')));
        continue;
      }
      if (!listings.length) {
        frag.appendChild(this.gap(i, visFrom, visTo, t('guide.noepg')));
        continue;
      }
      for (const p of listings) frag.appendChild(this.block(i, ch, p, now, scrollLeft));
    }

    this.el.canvas.replaceChildren(frag);
    this.el.canvas.appendChild(this.nowLine);
  }

  block(row, ch, p, now, scrollLeft) {
    const left = Math.max(0, this.x(p.start));
    const right = Math.min(this.width, this.x(p.stop));
    const width = Math.max(2, right - left - 2);
    const live = p.start <= now && now < p.stop;

    const node = document.createElement('div');
    node.className = 'epg-prog'
      + (live ? ' live' : p.stop <= now ? ' past' : '')
      + (this.isSelected(row, p) ? ' sel' : '')
      + (catchupAvailable(ch, p, now) ? ' rec' : '');
    node.style.left = `${left}px`;
    node.style.width = `${width}px`;
    node.style.top = `${row * ROW_H + 3}px`;
    node.dataset.row = String(row);
    node.dataset.start = String(p.start);
    node.title = `${clock(p.start)}–${clock(p.stop)}  ${p.title}`;

    const label = document.createElement('div');
    label.className = 'epg-prog-label';
    // Ruudun reunan yli jatkuva ohjelma: nimi ja jatkumismerkki siirretään
    // näkyviin sen sijaan että ne jäisivät vierityksen taakse. Kokonaan
    // reunan ulkopuolelle jäävää lohkoa ei siirretä — se ei näy muutenkaan.
    const clip = scrollLeft - left;
    if (clip > 0 && clip < width - 40) {
      node.style.setProperty('--clip', `${clip}px`);
      label.style.paddingLeft = `${clip + 14}px`;
      node.classList.add('clipped');
    }
    label.textContent = p.title || 'Ohjelma';
    node.appendChild(label);

    if (live) {
      const share = progressOf(p, now);
      if (share != null) {
        const fill = document.createElement('i');
        fill.style.width = `${Math.round(share * 100)}%`;
        node.appendChild(fill);
      }
    }
    return node;
  }

  gap(row, from, to, text) {
    const left = Math.max(0, this.x(from));
    const node = document.createElement('div');
    node.className = 'epg-prog empty';
    node.style.left = `${left}px`;
    node.style.width = `${Math.max(2, Math.min(this.width, this.x(to)) - left - 2)}px`;
    node.style.top = `${row * ROW_H + 3}px`;
    node.dataset.row = String(row);
    const label = document.createElement('div');
    label.className = 'epg-prog-label';
    label.textContent = text;
    node.appendChild(label);
    return node;
  }

  moveNow() {
    const now = Date.now();
    const inside = now >= this.origin && now <= this.end;
    this.nowLine.hidden = !inside;
    this.nowHead.hidden = !inside;
    if (this.el.clock) this.el.clock.textContent = stampFmt.format(new Date(now));
    if (!inside) return;
    const x = `${this.x(now)}px`;
    this.nowLine.style.left = x;
    this.nowLine.style.height = `${Math.max(this.channels.length * ROW_H, this.el.scroll.clientHeight)}px`;
    this.nowHead.style.left = x;
  }

  /* -------------------------------------------------------------- valinta */

  isSelected(row, p) {
    const sel = this.selection;
    return !!(sel && sel.row === row && sel.programme && sel.programme.start === p.start);
  }

  /**
   * Vaihtaa vain korostukset. Koko kankaan uudelleenpiirto irrottaisi
   * elementit hiiren alta kesken klikkauksen, jolloin klikkauksen ja
   * kaksoisklikkauksen väliin jäävä lohko katoaisi.
   */
  mark() {
    for (const node of this.el.canvas.querySelectorAll('.epg-prog.sel')) node.classList.remove('sel');
    const sel = this.selection;
    if (sel && sel.programme) {
      const hit = this.el.canvas.querySelector(`.epg-prog[data-row="${sel.row}"][data-start="${sel.programme.start}"]`);
      if (hit) hit.classList.add('sel');
    }
    for (const node of this.el.chansInner.children) {
      node.classList.toggle('cursor', Number(node.dataset.row) === this.cursorRow);
    }
  }

  /** Valitsee kanavalta sen ohjelman joka on menossa annettuun aikaan. */
  selectAt(row, time) {
    const ch = this.channels[row];
    if (!ch) return;
    const listings = this.epg ? this.epg.listings(ch.id) : null;
    let programme = null;
    if (listings && listings.length) {
      programme = listings.find((p) => p.start <= time && time < p.stop)
        || listings.reduce((best, p) => (Math.abs(p.start - time) < Math.abs(best.start - time) ? p : best));
    }
    this.cursorRow = row;
    if (programme) this.focusTime = programme.start;
    this.selection = { row, programme };
    this.onSelect(ch, programme);
    this.mark();
  }

  pick(e, activate) {
    const node = e.target.closest('.epg-prog');
    if (!node) return;
    const row = Number(node.dataset.row);
    const ch = this.channels[row];
    if (!ch) return;

    let programme = null;
    if (!node.classList.contains('empty')) {
      const start = Number(node.dataset.start);
      const listings = (this.epg && this.epg.listings(ch.id)) || [];
      programme = listings.find((p) => p.start === start) || null;
      if (programme) this.focusTime = programme.start;
    }
    this.cursorRow = row;
    this.selection = { row, programme };
    this.onSelect(ch, programme);
    this.mark();
    if (activate) this.onActivate(ch, programme);
  }

  /* ------------------------------------------------------------ liikkuminen */

  /**
   * align 'lead' jättää hetken menneisyyttä näkyviin, jottei menossa oleva
   * ohjelma ala heti ruudun reunasta. Lyhyt lead on tarkoituksellinen:
   * jokainen näkyvä menneisyyden minuutti tarkoittaa että epg.js joutuu
   * hakemaan kanavan koko ohjelmataulun lyhyen listan sijaan.
   */
  scrollToTime(ms, { align = 'left' } = {}) {
    const view = this.el.scroll.clientWidth;
    const lead = align === 'lead' ? Math.min(view * 0.2, LEAD_MIN * this.zoom) : 0;
    const left = this.x(ms) - lead;
    this.el.scroll.scrollLeft = Math.max(0, Math.min(this.width - view, left));
    this.schedule();
  }

  ensureRowVisible(row) {
    const top = row * ROW_H;
    const { scrollTop, clientHeight } = this.el.scroll;
    if (top < scrollTop) this.el.scroll.scrollTop = top;
    else if (top + ROW_H > scrollTop + clientHeight) this.el.scroll.scrollTop = top + ROW_H - clientHeight;
    this.schedule();
  }

  ensureTimeVisible(programme) {
    const view = this.el.scroll.clientWidth;
    const left = this.el.scroll.scrollLeft;
    const a = this.x(programme.start);
    const b = this.x(programme.stop);
    if (a < left) this.el.scroll.scrollLeft = Math.max(0, a - 40);
    else if (b > left + view) this.el.scroll.scrollLeft = Math.min(this.width - view, Math.max(a - 40, b - view + 40));
    this.schedule();
  }

  goNow() {
    const now = Date.now();
    this.focusTime = now;
    this.scrollToTime(now, { align: 'lead' });
    this.selectAt(this.cursorRow, now);
  }

  /**
   * Vierittää päivän alkuun — tai kellonaikaan, jos päivä on tänään.
   * Vuorokausirajalle mennään ilman leadia, muuten "huomenna" pysähtyisi
   * vartin verran tämän päivän puolelle.
   */
  goDay(at) {
    const now = Date.now();
    const today = now >= at && now < startOfDay(at, 1);
    const target = today ? now : at;
    this.focusTime = target;
    this.scrollToTime(target, { align: today ? 'lead' : 'left' });
    this.selectAt(this.cursorRow, target);
  }

  nudge(minutes) {
    this.scrollToTime(this.timeAt(this.el.scroll.scrollLeft) + minutes * 60000);
  }

  zoomBy(delta) {
    const next = Math.max(0, Math.min(ZOOMS.length - 1, this.zoomIndex + delta));
    if (next === this.zoomIndex) return;
    const anchor = this.timeAt(this.el.scroll.scrollLeft);
    this.zoomIndex = next;
    this.layout();
    this.scrollToTime(anchor);
    this.paint();
  }

  /** Siirtää valinnan viereiseen ohjelmaan samalla kanavalla. */
  step(delta) {
    const ch = this.channels[this.cursorRow];
    const listings = ch && this.epg ? this.epg.listings(ch.id) : null;
    if (!listings || !listings.length) { this.nudge(delta * SLOT_MIN); return; }

    const current = this.selection && this.selection.programme;
    let index = current ? listings.findIndex((p) => p.start === current.start) : -1;
    if (index === -1) index = listings.findIndex((p) => p.start <= this.focusTime && this.focusTime < p.stop);
    const next = listings[index + delta];
    if (!next) { this.nudge(delta * SLOT_MIN); return; }

    this.focusTime = next.start;
    this.selection = { row: this.cursorRow, programme: next };
    this.ensureTimeVisible(next);
    this.onSelect(ch, next);
    this.mark();
  }

  moveRow(delta) {
    if (!this.channels.length) return;
    const row = Math.max(0, Math.min(this.channels.length - 1, this.cursorRow + delta));
    this.ensureRowVisible(row);
    this.selectAt(row, this.focusTime);
  }

  activate() {
    const ch = this.channels[this.cursorRow];
    if (ch) this.onActivate(ch, this.selection ? this.selection.programme : null);
  }

  /** @returns {boolean} käsiteltiinkö näppäin */
  handleKey(e) {
    switch (e.key) {
      case 'ArrowDown': this.moveRow(1); return true;
      case 'ArrowUp': this.moveRow(-1); return true;
      case 'PageDown': this.moveRow(this.rowsPerScreen()); return true;
      case 'PageUp': this.moveRow(-this.rowsPerScreen()); return true;
      case 'ArrowRight': this.step(1); return true;
      case 'ArrowLeft': this.step(-1); return true;
      case 'Home': this.goNow(); return true;
      case 'Enter': this.activate(); return true;
      case '+': this.zoomBy(1); return true;
      case '-': this.zoomBy(-1); return true;
      default: return false;
    }
  }

  rowsPerScreen() { return Math.max(1, Math.floor(this.el.scroll.clientHeight / ROW_H) - 1); }

  /* ----------------------------------------------------------------- tila */

  setChannels(items) {
    this.channels = items;
    this.cursorRow = 0;
    this.selection = null;
    this.lastWindowKey = '';
    const height = `${Math.max(1, items.length) * ROW_H}px`;
    this.el.canvas.style.height = height;
    this.el.chansInner.style.height = height;
    this.el.scroll.scrollTop = 0;
    this.paint();
  }

  setPlaying(streamId) {
    this.playingId = streamId == null ? null : String(streamId);
    if (this.open) this.schedule();
  }

  focusChannel(streamId) {
    const row = this.channels.findIndex((c) => String(c.id) === String(streamId));
    if (row < 0) return false;
    this.ensureRowVisible(row);
    this.selectAt(row, this.focusTime);
    return true;
  }

  /** Ohjelmatietoja saapui: valinta yritetään täydentää jos se jäi tyhjäksi. */
  invalidate() {
    if (!this.open) return;
    if (this.selection && !this.selection.programme) this.selectAt(this.selection.row, this.focusTime);
    this.schedule();
  }

  show() {
    this.open = true;
    this.layout();
    this.goNow();
    this.paint();
    if (!this.timer) this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  hide() {
    this.open = false;
    clearInterval(this.timer);
    this.timer = null;
  }

  /** Kello käy, joten "nyt"-viiva ja menossa olevat ohjelmat vanhenevat. */
  tick() {
    // Opas voi olla auki vuorokauden vaihtuessa, jolloin aikajanan
    // nollakohta ja päivänimet ("tänään") osoittavat eiliseen.
    if (startOfDay(Date.now()) !== startOfDay(this.origin, PAST_DAYS)) {
      const anchor = this.timeAt(this.el.scroll.scrollLeft);
      this.layout();
      this.scrollToTime(anchor);
    }
    this.paint();
  }
}

/** Vuorokauden alku n päivän päästä. Kesäajassa vuorokausi ei ole 24 h. */
function startOfDay(ms, offsetDays = 0) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return d.getTime();
}
