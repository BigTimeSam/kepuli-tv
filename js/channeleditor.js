import { VirtualList } from './vlist.js';
import { channelPreferences, ordered, moveInOrder } from './channelprefs.js';
import { t, localeTag } from './i18n.js';

const $ = (id) => document.getElementById(id);

export class ChannelEditor {
  constructor(onSave) {
    this.dialog = $('channel-editor');
    this.onSave = onSave;
    this.rows = [];
    this.list = new VirtualList($('channel-editor-list'), 52, (i) => this.row(i));
    for (const id of ['channel-editor-kind', 'channel-editor-group', 'channel-editor-filter']) {
      $(id).addEventListener('input', () => this.render());
    }
    $('channel-editor-cancel').addEventListener('click', () => this.dialog.close());
    $('channel-editor-hide').addEventListener('click', () => this.setHidden(true));
    $('channel-editor-show').addEventListener('click', () => this.setHidden(false));
    $('channel-editor-reset').addEventListener('click', () => {
      this.draft[this.orderKey] = [];
      this.render();
    });
    $('channel-editor-save').addEventListener('click', async () => {
      const button = $('channel-editor-save');
      button.disabled = true;
      this.dialog.querySelector('.editor-content').inert = true;
      try { await this.onSave(this.draft); this.dialog.close(); }
      catch { $('channel-editor-status').textContent = t('organize.savefailed'); }
      finally { button.disabled = false; this.dialog.querySelector('.editor-content').inert = false; }
    });
    this.dialog.addEventListener('cancel', (e) => { if ($('channel-editor-save').disabled) e.preventDefault(); });
  }

  get categories() { return $('channel-editor-kind').value === 'categories'; }
  get orderKey() { return this.categories ? 'categoryOrder' : 'channelOrder'; }
  get hiddenKey() { return this.categories ? 'hiddenCategories' : 'hiddenChannels'; }

  show(channels, groups, prefs, group) {
    this.channels = channels;
    this.groups = groups;
    this.draft = channelPreferences(prefs);
    $('channel-editor-filter').value = '';
    $('channel-editor-kind').value = 'channels';
    $('channel-editor-group').replaceChildren(new Option(t('groups.all'), ''),
      ...groups.map((g) => new Option(g.name, g.name)));
    $('channel-editor-group').value = group || '';
    this.dialog.showModal();
    this.render();
  }

  render({ keepScroll = false } = {}) {
    const group = this.groups.find((g) => g.name === $('channel-editor-group').value);
    const cats = group ? group.cats : this.groups.flatMap((g) => g.cats);
    const ids = new Set(cats.map((c) => c.id));
    const items = this.categories ? cats.map((c) => ({ id: c.id, n: c.name })).sort((a, b) => a.n.localeCompare(b.n, localeTag()))
      : this.channels.filter((c) => !group || c.cats.some((id) => ids.has(id)));
    const query = $('channel-editor-filter').value.trim().toLocaleLowerCase();
    this.rows = ordered(items, this.draft[this.orderKey]).filter((c) => c.n.toLocaleLowerCase().includes(query));
    this.list.setCount(this.rows.length, { keepScroll });
    $('channel-editor-status').textContent = t('organize.count', { count: this.rows.length,
      hidden: this.draft[this.hiddenKey].length });
    $('channel-editor-hide').disabled = $('channel-editor-show').disabled = !this.rows.length;
  }

  setHidden(hide, id = null) {
    const ids = id == null ? this.rows.map((r) => String(r.id)) : [String(id)];
    const hidden = new Set(this.draft[this.hiddenKey]);
    for (const key of ids) { if (hide) hidden.add(key); else hidden.delete(key); }
    this.draft[this.hiddenKey] = [...hidden];
    this.render({ keepScroll: true });
    if (id != null) this.focus(id, 'visibility');
  }

  focus(id, action) {
    const index = this.rows.findIndex((r) => String(r.id) === String(id));
    this.list.scrollToIndex(index);
    this.list.refresh();
    const row = this.list.nodes.get(index);
    (row?.querySelector(`[data-action="${action}"]:not(:disabled)`) || row?.querySelector('input'))?.focus();
  }

  row(index) {
    const item = this.rows[index];
    const hidden = this.draft[this.hiddenKey].includes(String(item.id));
    const row = document.createElement('div');
    row.className = 'organize-row' + (hidden ? ' is-hidden' : '');
    row.dataset.id = item.id;
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = !hidden;
    checkbox.dataset.action = 'visibility';
    checkbox.setAttribute('aria-label', t('organize.visible', { name: item.n }));
    checkbox.addEventListener('change', () => this.setHidden(!checkbox.checked, item.id));
    const name = document.createElement('span');
    name.textContent = item.n;
    name.title = item.n;
    label.append(checkbox, name);
    row.append(label);
    for (const [delta, action, symbol] of [[-1, 'up', '↑'], [1, 'down', '↓']]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ghost';
      button.textContent = symbol;
      button.dataset.action = action;
      button.title = t(`organize.${action}`, { name: item.n });
      button.setAttribute('aria-label', button.title);
      button.disabled = index + delta < 0 || index + delta >= this.rows.length;
      button.addEventListener('click', () => {
        // Seed untouched IDs in the global default order. Moving within
        // Finland must not also promote Finland ahead of every country.
        const defaults = this.categories
          ? this.groups.flatMap((g) => g.cats).sort((a, b) => a.name.localeCompare(b.name, localeTag()))
          : this.channels;
        const saved = [...new Set([...this.draft[this.orderKey], ...defaults.map((r) => String(r.id))])];
        this.draft[this.orderKey] = moveInOrder(saved, this.rows.map((r) => r.id), item.id, delta);
        this.render({ keepScroll: true });
        this.focus(item.id, action);
      });
      row.append(button);
    }
    return row;
  }
}
