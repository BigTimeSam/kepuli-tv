// The two dialogs a viewer arranges the channels with: the countries they
// watch, and what they have hidden.
//
// They replace the channel editor, a dialog that did everything — every
// channel and every category, hidden or shown, dragged into an order of
// its own — and was hard to use for anything. What a viewer actually does
// is narrower: keep the few countries they watch, put a few channels at
// the top (the ⋯ on a row, see js/rowmenu.js), hide one now and then, and
// once in a while take something back. Each of those is now one gesture.

import { t, localeTag } from './i18n.js';
import { nf } from './format.js';
import { wireModal } from './modal.js';
import { searchKey, searchTerms, matchesTerms } from './name.js';
import { poster } from './poster.js';

const $ = (id) => document.getElementById(id);

/**
 * "Which countries do you watch?" Every live group with a box; what is left
 * unticked is left out of the lists, the search and the guide. Nothing
 * ticked is the same as everything: the setting then filters nothing.
 */
export class CountryPicker {
  constructor(onSave) {
    this.dialog = $('countries');
    this.onSave = onSave;
    this.chosen = new Set();
    wireModal(this.dialog, () => this.dialog.close());
    $('countries-cancel').addEventListener('click', () => this.dialog.close());
    $('countries-filter').addEventListener('input', () => this.filter());
    $('countries-toggle').addEventListener('change', () => {
      const tick = $('countries-toggle').checked;
      for (const row of $('countries-list').children) {
        if (row.hidden) continue;
        const box = row.querySelector('input');
        box.checked = tick;
        const name = row.dataset.name;
        if (tick) this.chosen.add(name); else this.chosen.delete(name);
      }
      this.status();
    });
    $('countries-save').addEventListener('click', async () => {
      const button = $('countries-save');
      button.disabled = true;
      try {
        // Every country ticked is the same as none: all of them, and a
        // country the provider adds later shows too.
        await (this.save || this.onSave)(this.chosen.size >= this.groups.length ? [] : [...this.chosen]);
        this.dialog.close();
      } catch {
        $('countries-status').textContent = t('organize.savefailed');
      } finally { button.disabled = false; }
    });
  }

  /**
   * @param {{ name: string }[]} groups the live groups
   * @param {Map<string, number> | null} counts channels per group, when known
   * @param {string[]} chosen the groups chosen now
   * @param {string[]} suggested groups to offer first: the browser's country
   * @param {boolean} first the first time, when the suggestion is ticked
   */
  show({ groups, counts, chosen, suggested = [], first = false, onSave = null, texts = null }) {
    // The same dialog chooses the films' and the series' categories: their
    // own words and their own place to save, the countries' otherwise.
    this.save = onSave;
    this.texts = { title: 'countries.title', help: 'countries.help', filter: 'countries.filter', all: 'countries.all', ...texts };
    $('countries-title').textContent = t(this.texts.title);
    this.dialog.querySelector('.editor-help').textContent = t(this.texts.help);
    $('countries-filter').placeholder = t(this.texts.filter);
    $('countries-filter').setAttribute('aria-label', t(this.texts.filter));
    this.groups = groups;
    this.counts = counts;
    this.suggested = new Set(suggested.filter((name) => groups.some((g) => g.name === name)));
    this.chosen = new Set(chosen.length || !first ? chosen : this.suggested);
    $('countries-filter').value = '';
    $('countries-status').textContent = '';
    this.render();
    this.dialog.showModal();
    $('countries-filter').focus();
  }

  render() {
    const collate = new Intl.Collator(localeTag()).compare;
    const ordered = [...this.groups].sort((a, b) =>
      Number(this.suggested.has(b.name)) - Number(this.suggested.has(a.name)) || collate(a.name, b.name));
    const list = $('countries-list');
    list.replaceChildren(...ordered.map((group) => {
      const row = document.createElement('label');
      row.className = 'choice-row';
      row.dataset.key = searchKey(group.name);
      row.dataset.name = group.name;
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = this.chosen.has(group.name);
      box.addEventListener('change', () => {
        if (box.checked) this.chosen.add(group.name); else this.chosen.delete(group.name);
        this.status();
      });
      const name = document.createElement('span');
      name.className = 'choice-name';
      name.textContent = group.name;
      row.append(box, name);
      if (this.suggested.has(group.name)) {
        const tag = document.createElement('span');
        tag.className = 'choice-tag';
        tag.textContent = t('countries.suggested');
        row.append(tag);
      }
      const count = this.counts?.get(group.name);
      if (count != null) {
        const n = document.createElement('span');
        n.className = 'choice-count';
        n.textContent = nf.format(count);
        row.append(n);
      }
      return row;
    }));
    this.filter();
  }

  filter() {
    const terms = searchTerms($('countries-filter').value);
    for (const row of $('countries-list').children) row.hidden = terms.length > 0 && !matchesTerms(row.dataset.key, terms);
    $('countries-toggle-label').textContent = t(terms.length ? 'countries.toggle.shown' : 'countries.toggle');
    this.status();
  }

  status() {
    $('countries-status').textContent = this.chosen.size
      ? t('countries.chosen', { count: this.chosen.size, n: nf.format(this.chosen.size), total: nf.format(this.groups.length) })
      : t(this.texts.all);
    // The box over the list says what the rows it reaches hold: all of
    // them ticked, none, or some (the dash).
    const shown = [...$('countries-list').children].filter((row) => !row.hidden);
    const ticked = shown.filter((row) => this.chosen.has(row.dataset.name)).length;
    const toggle = $('countries-toggle');
    toggle.disabled = !shown.length;
    toggle.checked = shown.length > 0 && ticked === shown.length;
    toggle.indeterminate = ticked > 0 && ticked < shown.length;
  }
}

/**
 * What has been hidden, each with Show again. Channels hidden from a row's
 * menu, and the categories the channel editor used to hide.
 */
export class HiddenList {
  constructor(onChange) {
    this.dialog = $('hidden');
    this.onChange = onChange;
    wireModal(this.dialog, () => this.dialog.close());
    $('hidden-close').addEventListener('click', () => this.dialog.close());
    $('hidden-all').addEventListener('click', async () => {
      await this.onChange({ hiddenChannels: [], hiddenCategories: [] });
      this.dialog.close();
    });
  }

  /**
   * @param {object} prefs the channel preferences
   * @param {(id: string) => object | null} channel a hidden channel by id, when the list knows it
   * @param {(id: string) => string} categoryName
   */
  show(prefs, channel, categoryName) {
    this.prefs = prefs;
    this.channel = channel;
    this.categoryName = categoryName;
    this.render();
    if (!this.dialog.open) this.dialog.showModal();
  }

  render() {
    const { hiddenChannels, hiddenCategories } = this.prefs;
    const rows = [
      ...hiddenChannels.map((id) => ({ kind: 'channel', id, item: this.channel(id) })),
      ...hiddenCategories.map((id) => ({ kind: 'category', id })),
    ];
    $('hidden-list').replaceChildren(...rows.map(({ kind, id, item }) => {
      const row = document.createElement('div');
      row.className = 'choice-row';
      if (kind === 'channel') row.append(poster('choice-logo', item?.logo, 'channel'));
      const name = document.createElement('span');
      name.className = 'choice-name';
      name.textContent = kind === 'channel' ? (item?.n || t('hidden.gone')) : this.categoryName(id);
      const where = document.createElement('span');
      where.className = 'choice-count';
      where.textContent = t(kind === 'channel' ? 'hidden.channel' : 'hidden.category');
      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'ghost';
      back.textContent = t('hidden.show');
      back.setAttribute('aria-label', t('hidden.show.name', { name: name.textContent }));
      back.addEventListener('click', async () => {
        const key = kind === 'channel' ? 'hiddenChannels' : 'hiddenCategories';
        this.prefs = { ...this.prefs, [key]: this.prefs[key].filter((h) => h !== id) };
        await this.onChange(this.prefs);
        if (!this.prefs.hiddenChannels.length && !this.prefs.hiddenCategories.length) this.dialog.close();
        else this.render();
      });
      row.append(name, where, back);
      return row;
    }));
    $('hidden-empty').hidden = rows.length > 0;
    $('hidden-all').disabled = !rows.length;
  }
}
