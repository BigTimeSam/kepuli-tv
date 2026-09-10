import { t } from './i18n.js';

// One owner for the debounce, search scope, and the filters a search borrows.
export class CatalogueSearch {
  constructor(input, clearButton, { state, refresh, renderSidebar, isCollection, onSearch }) {
    Object.assign(this, { input, clearButton, state, refresh, renderSidebar, isCollection, onSearch });
    this.timer = null;
    this.generation = 0;
    this.returnView = null;
    input.addEventListener('input', () => {
      this.cancelPending();
      this.render();
      this.timer = setTimeout(() => this.run(), 180);
    });
    clearButton.addEventListener('click', () => { this.clear(); input.focus(); });
  }

  cancelPending() {
    clearTimeout(this.timer);
    this.generation++;
  }

  render() {
    const { state } = this;
    const scope = state.detail?.view === 'series' ? 'episodes'
      : state.detail?.view === 'category' ? 'category' : state.tab;
    this.input.placeholder = t(`search.${scope}`);
    this.input.setAttribute('aria-label', this.input.placeholder);
    this.clearButton.hidden = !this.input.value;
    this.clearButton.title = t('search.clear');
    this.clearButton.setAttribute('aria-label', t('search.clear'));
  }

  restoreFilters() {
    const back = this.returnView;
    this.returnView = null;
    if (!back || back.tab !== this.state.tab) return;
    Object.assign(this.state, { group: back.group, sub: back.sub, kind: back.kind });
    this.state.lastGroup[back.tab] = back.group;
    this.state.lastKind[back.tab] = back.kind;
    this.renderSidebar();
  }

  reset({ restore = true } = {}) {
    this.cancelPending();
    this.input.value = this.state.query = '';
    if (restore) this.restoreFilters(); else this.returnView = null;
    this.render();
  }

  clear() {
    this.reset();
    this.onSearch();
    return this.refresh();
  }

  snapshot() {
    return { query: this.state.query, returnView: this.returnView };
  }

  restore(snapshot) {
    this.cancelPending();
    this.input.value = this.state.query = snapshot?.query || '';
    this.returnView = snapshot?.returnView || null;
    this.render();
  }

  async run() {
    const generation = this.generation;
    const state = this.state;
    this.onSearch();
    state.query = this.input.value.trim();
    if (state.query && !state.detail) {
      if (!this.returnView) this.returnView = { tab: state.tab, group: state.group, sub: state.sub, kind: state.kind };
      if (this.isCollection()) state.kind = null;
      else { state.group = null; state.sub = null; }
      this.renderSidebar();
    }
    if (!state.query) this.restoreFilters();
    this.render();
    const ok = await this.refresh();
    if (generation === this.generation && ok === false && state.query) this.clear();
  }
}
