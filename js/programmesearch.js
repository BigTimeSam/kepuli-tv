import { VirtualList } from './vlist.js';
import { t } from './i18n.js';
import { clock, shortDay, progressOf, nf } from './format.js';
import { poster } from './poster.js';
import { emptyState } from './rows.js';
import { archiveDays } from './epggrid.js';
import { searchKey, searchTerms } from './name.js';

/** Explicit, cancellable full-guide search. Four requests at most; completed
 * full tables are shared with the grid, which keeps only so many of them
 * (js/epg.js, remember). Partial failures never look like a complete empty
 * result. No media connection is opened by a search. */
export async function searchProgrammes(epg, channels, query, { signal, from = -Infinity, to = Infinity, onProgress = () => {} } = {}) {
  const words = searchTerms(query);
  const eligible = searchableChannels(channels);
  // The results so far, in order, and the ones found since the last report.
  // Sorting everything found on every report — every 150 ms, over
  // thousands of results — was most of the search's own work; the new ones
  // are sorted alone and merged in.
  let results = [];
  let fresh = [];
  let next = 0, done = 0, failed = 0;
  let reportedAt = 0;
  const report = (force = false) => {
    if (!force && done !== eligible.length && Date.now() - reportedAt < 150) return;
    reportedAt = Date.now();
    if (fresh.length) { results = mergeSorted(results, fresh.sort(resultOrder), resultOrder); fresh = []; }
    onProgress({ results, done, total: eligible.length, failed });
  };
  report(true);
  if (!words.length) return;
  const worker = async () => {
    while (next < eligible.length && !signal?.aborted) {
      const channel = eligible[next++];
      try {
        let listings = epg.cache.get(String(channel.id))?.listings;
        if (epg.isStale(channel.id, 'full')) {
          listings = await epg.api.fullEpg(channel.id, { signal });
          if (signal?.aborted) return;
          listings.sort((a, b) => a.start - b.start);
          epg.remember(String(channel.id), { listings, mode: 'full', at: Date.now() });
          epg.markUpdated(String(channel.id));
        }
        const seen = new Set();
        // The channel's name counts as part of every programme on it: a
        // viewer looks for "Liiga 7" as the list shows it, and the
        // programmes there are all called "Liiga: No Broadcasting". Each
        // word may be in either, so "liiga 7 hockey" finds that channel's
        // hockey too.
        const named = searchKey(channel.displayName || channel.n || '');
        for (const programme of listings || []) {
          if (programme.stop <= from || programme.start >= to) continue;
          const key = `${programme.start}:${programme.stop}:${programme.title}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const text = searchKey(`${programme.title} ${programme.description || ''}`);
          if (words.every((word) => text.includes(word) || named.includes(word))) fresh.push({ channel, programme });
        }
      } catch (err) {
        if (signal?.aborted || err.name === 'AbortError') return;
        failed++;
      }
      done++;
      report();
      // Cached searches still yield to input, so thousands of channel
      // tables cannot prevent the viewer from cancelling or scrolling.
      if (done % 16 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, eligible.length) }, worker));
  report(true);
}

/** The channels a search can read: those with programme data, each once. */
export function searchableChannels(channels) {
  return [...new Map(channels.filter((c) => c.epgId).map((c) => [String(c.id), c])).values()];
}

const resultOrder = (a, b) => a.programme.start - b.programme.start || a.channel.n.localeCompare(b.channel.n);

/** How many programmes a channel shows before its "Show all". */
export const FIRST_FEW = 3;

/**
 * The results, in time order, as the list shows them: each channel once,
 * as a heading, with its programmes under it. A channel comes where its
 * first programme came, so the earliest stays at the top. Of a channel
 * not in `expanded` (ids as strings) only the first FIRST_FEW show, and a
 * row offers the rest: a search for "a" finds nearly every programme of
 * every channel, and in full the first channel's hundreds of rows would
 * push every other channel out of reach.
 *
 * A heading is `{ channel, count, open }` (open: every programme shows), a
 * programme `{ channel, programme }`, the offer `{ channel, more: count }`.
 */
export function groupResults(results, expanded = new Set(), few = FIRST_FEW) {
  const groups = new Map();
  for (const result of results) {
    const id = String(result.channel.id);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(result);
  }
  const items = [];
  for (const [id, found] of groups) {
    const open = found.length <= few || expanded.has(id);
    items.push({ channel: found[0].channel, count: found.length, open }, ...(open ? found : found.slice(0, few)));
    if (!open) items.push({ channel: found[0].channel, more: found.length });
  }
  return items;
}

/** Two sorted lists as one, in a new array; equal items keep `a`'s first. */
export function mergeSorted(a, b, compare) {
  if (!b.length) return a;
  if (!a.length) return b.slice();
  const out = new Array(a.length + b.length);
  let i = 0, j = 0, k = 0;
  while (i < a.length && j < b.length) out[k++] = compare(b[j], a[i]) < 0 ? b[j++] : a[i++];
  while (i < a.length) out[k++] = a[i++];
  while (j < b.length) out[k++] = b[j++];
  return out;
}

// Past this many channels with programme data, a search of all of them is
// asked about first. Each costs its whole programme table, 50–150 kB: five
// hundred is up to 75 MB and minutes of requests, which a viewer should
// choose rather than set off with a word typed into the guide.
export const MANY_CHANNELS = 500;

const $ = (id) => document.getElementById(id);
// A channel's heading and a programme's row, in pixels; .psr-head and
// .psr-row in player.css are as tall.
const HEAD_H = 52, ROW_H = 60, MORE_H = 44;

export class ProgrammeSearch {
  constructor({ getChannels, getEpg, onSelect, onActivate, onMode, onPick = () => {}, label = (channel) => channel.n }) {
    Object.assign(this, { getChannels, getEpg, onSelect, onActivate, onMode, onPick, label });
    this.results = [];
    // What the list shows: the results grouped by channel (groupResults),
    // and the channels opened in full in this search, by id.
    this.items = [];
    this.expanded = new Set();
    this.run = null;
    // What the status line says, kept as facts rather than text, so that a
    // change of language can say it again in the new one (renderStatus).
    this.status = null;
    // The all-channels search the viewer said yes to, see MANY_CHANNELS.
    this.confirmed = null;
    this.list = new VirtualList($('programme-results'), ROW_H, (i) => this.row(i));
    $('programme-form').addEventListener('submit', (e) => { e.preventDefault(); this.search(); });
    $('programme-cancel').addEventListener('click', () => this.cancel());
    $('programme-clear').addEventListener('click', () => this.clear());
    $('programme-continue').addEventListener('click', () => { this.confirmed = this.asked(); this.search(); });
    for (const id of ['programme-query', 'programme-scope', 'programme-period']) {
      $(id).addEventListener('input', () => {
        this.cancel();
        this.offerAll(null);
        if (this.status?.kind === 'many') { this.status = null; this.renderStatus(); }
      });
    }
  }

  /** The search the form asks for, as one string, to tell one from the next. */
  asked() {
    return [$('programme-query').value.trim(), $('programme-scope').value, $('programme-period').value].join('\n');
  }

  cancel() {
    if (!this.run) return;
    this.run.abort();
    this.run = null;
    $('programme-cancel').hidden = true;
    if (this.status) this.status.cancelled = true;
    this.renderStatus();
  }

  clear() {
    this.cancel();
    this.show([]);
    this.status = null;
    this.offerAll(null);
    $('programme-query').value = '';
    $('programme-panel').hidden = true;
    this.onMode(false);
  }

  /**
   * The status line, from this.status, in the language now in use: the
   * number of results stands out, the channels searched follow in grey, and
   * a search that has read every channel says nothing more about being done
   * (the Stop button going away says it). A finished search that found
   * nothing shows the larger empty notice in the results' place.
   */
  renderStatus() {
    const s = this.status;
    const line = $('programme-status');
    line.replaceChildren();
    let text = '';
    if (s?.kind === 'loading') text = t('progress.loading');
    else if (s?.kind === 'error') text = t('programmes.error');
    else if (s?.kind === 'many') text = t('programmes.heavy', { count: s.count });
    else if (s?.kind === 'progress') {
      // The sentence is the translation's own; only the number is set apart,
      // found by a marker in its place, so each language keeps its order.
      const MARK = '\u0001';
      const [before, after = ''] = t('programmes.status', { count: MARK, done: s.done, total: s.total }).split(MARK);
      const count = document.createElement('strong');
      count.className = 'psr-count';
      count.textContent = nf.format(s.count);
      line.append(before, count, after);
      if (s.failed) {
        const failed = document.createElement('span');
        failed.className = 'psr-failed';
        failed.textContent = `. ${t('programmes.failed', { count: s.failed })}`;
        line.append(failed);
      }
    }
    if (s?.cancelled) text += `${text || s?.kind === 'progress' ? '. ' : ''}${t('progress.cancelled')}`;
    if (text) line.append(text);
    const finished = s?.kind === 'progress' && s.done === s.total;
    // For the tests and nothing else: whether the search has read every channel.
    $('programme-panel').dataset.state = finished ? 'done' : '';
    const none = finished && !s.count && !s.cancelled;
    $('programme-results').hidden = none;
    $('programme-empty').hidden = !none;
    $('programme-empty').replaceChildren(...(none ? [emptyState(t('empty.nohits'), t('programmes.nohits.text', { query: s.query }), null, 'search')] : []));
    const more = $('programme-continue');
    if (!more.hidden) more.textContent = t('programmes.continue', { count: more.dataset.count });
  }

  /** The button that sets off an all-channels search of `count` channels; null takes it away. */
  offerAll(count) {
    const more = $('programme-continue');
    more.hidden = count == null;
    if (count != null) more.dataset.count = String(count);
  }

  async search() {
    this.cancel();
    this.offerAll(null);
    const query = $('programme-query').value.trim();
    if (!query) { this.clear(); return; }
    const asked = this.asked();
    const run = new AbortController();
    this.run = run;
    this.show([]);
    $('programme-panel').hidden = false;
    $('programme-cancel').hidden = false;
    this.status = { kind: 'loading' };
    this.renderStatus();
    this.onMode(true);
    try {
      const scope = $('programme-scope').value;
      const channels = await this.getChannels(scope, run.signal);
      if (run.signal.aborted) return;
      const count = searchableChannels(channels).length;
      if (scope === 'all' && count > MANY_CHANNELS && this.confirmed !== asked) {
        this.status = { kind: 'many', count };
        this.offerAll(count);
        this.renderStatus();
        return;
      }
      const now = Date.now();
      const period = $('programme-period').value;
      const from = period === 'upcoming' ? now : now - archiveDays(channels) * 86400e3;
      const to = period === 'past' ? now : now + 5 * 86400e3;
      await searchProgrammes(this.getEpg(), channels, query, { signal: run.signal, from, to,
        onProgress: ({ results, done, total, failed }) => {
          if (this.run !== run) return;
          this.show(results, { keepScroll: true });
          this.status = { kind: 'progress', count: results.length, done, total, failed, query };
          this.renderStatus();
        } });
    } catch (err) {
      if (!run.signal.aborted) { this.status = { kind: 'error' }; this.renderStatus(); }
    } finally {
      if (this.run === run) { this.run = null; $('programme-cancel').hidden = true; }
    }
  }

  /** The results into the list, grouped by channel. */
  show(results, { keepScroll = false } = {}) {
    if (!results.length) this.expanded.clear();
    this.results = results;
    this.items = groupResults(results, this.expanded);
    this.list.setCount(this.items.length, { keepScroll, heightAt: (i) => {
      const item = this.items[i];
      return item.programme ? ROW_H : item.more ? MORE_H : HEAD_H;
    } });
  }

  /** A channel's programmes all shown, or back to the first few; the focus stays on what was pressed. */
  toggle(channel, focusHead) {
    const id = String(channel.id);
    if (this.expanded.has(id)) this.expanded.delete(id); else this.expanded.add(id);
    this.show(this.results, { keepScroll: true });
    const at = this.items.findIndex((item) => !item.programme && !item.more && String(item.channel.id) === id);
    if (at < 0) return;
    if (!this.expanded.has(id)) this.list.scrollToIndex(at);
    const target = focusHead ? at : at + 1 + FIRST_FEW;
    requestAnimationFrame(() => $('programme-results').querySelector(`[data-index="${target}"]`)?.focus());
  }

  row(index) {
    const { channel, programme, count, open, more } = this.items[index];
    if (more) {
      // The rest of a channel's programmes, a click away.
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'psr-more';
      button.dataset.index = String(index);
      button.textContent = t('programmes.showall', { count: nf.format(more) });
      button.addEventListener('click', () => this.toggle(channel, false));
      return button;
    }
    if (!programme) {
      // The channel's heading: its logo and its name as the guide writes
      // it (without the provider's "FI:"), and how many programmes found.
      // A channel with more than the first few is a button: it opens them
      // all or folds them back, as its "Show all" row does.
      const folds = count > FIRST_FEW;
      const head = document.createElement(folds ? 'button' : 'div');
      head.className = 'psr-head';
      head.dataset.index = String(index);
      if (folds) {
        head.type = 'button';
        head.setAttribute('aria-expanded', String(open));
        head.addEventListener('click', () => this.toggle(channel, true));
      }
      head.appendChild(poster('psr-logo', channel.logo, 'channel'));
      const name = document.createElement('strong');
      name.textContent = this.label(channel);
      name.title = channel.n;
      const n = document.createElement('span');
      n.className = 'psr-n';
      n.textContent = nf.format(count);
      head.append(name, n);
      if (folds) {
        const mark = document.createElement('span');
        mark.className = 'psr-fold';
        mark.setAttribute('aria-hidden', 'true');
        head.appendChild(mark);
      }
      return head;
    }
    const now = Date.now();
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'psr-row';
    row.dataset.index = String(index);
    const when = document.createElement('span');
    when.className = 'psr-when';
    const day = document.createElement('small');
    day.textContent = shortDay(programme.start);
    when.append(day, clock(programme.start));
    const body = document.createElement('span');
    body.className = 'psr-body';
    const title = document.createElement('strong');
    title.textContent = programme.title;
    body.appendChild(title);
    if (programme.description) {
      const desc = document.createElement('span');
      desc.textContent = programme.description;
      body.appendChild(desc);
    }
    row.append(when, body);
    if (programme.start <= now && now < programme.stop) {
      // On now: the guide's word and how far it has got, as the grid shows it.
      row.classList.add('live');
      const live = document.createElement('span');
      live.className = 'psr-now';
      live.textContent = t('guide.now');
      const bar = document.createElement('i');
      bar.style.width = `${Math.round(progressOf(programme, now) * 100)}%`;
      live.appendChild(bar);
      row.appendChild(live);
    }
    row.title = `${this.label(channel)}, ${shortDay(programme.start)} ${clock(programme.start)}–${clock(programme.stop)}`;
    row.addEventListener('click', () => { this.onSelect(channel, programme); this.onPick(channel, programme); });
    row.addEventListener('dblclick', () => this.onActivate(channel, programme));
    return row;
  }
}
