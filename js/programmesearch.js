import { VirtualList } from './vlist.js';
import { t } from './i18n.js';
import { clock, shortDay, progressOf, nf, wholePercent } from './format.js';
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
  constructor({ getChannels, getEpg, onSelect, onActivate, onMode, onPick = () => {}, label = (channel) => channel.n, limit = () => null, onLeave = () => {} }) {
    Object.assign(this, { getChannels, getEpg, onSelect, onActivate, onMode, onPick, label, limit, onLeave });
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
    // The search the viewer asked to run past "Filter countries", by what
    // was asked (asked()); any other search keeps to the filter again.
    this.everyGroup = null;
    this.list = new VirtualList($('programme-results'), ROW_H, (i) => this.row(i));
    $('programme-form').addEventListener('submit', (e) => { e.preventDefault(); this.search(); });
    $('programme-cancel').addEventListener('click', () => this.cancel());
    $('programme-clear').addEventListener('click', () => this.clear());
    $('programme-continue').addEventListener('click', () => { this.confirmed = this.asked(); this.search(); });
    // The results answer the keys the guide's grid does: the arrows and the
    // page keys walk them, and Enter does what Enter does on a programme
    // there (catch-up for one that has ended, a reminder for one to come,
    // the channel for one on now). A click only chooses, as below.
    $('programme-results').addEventListener('keydown', (e) => this.key(e));
    // Whatever the focus lands on, by the arrows or by Tab, is the
    // programme the panel beside describes, as the grid's cursor is.
    $('programme-results').addEventListener('focusin', (e) => {
      const item = this.items[Number(e.target.closest?.('.psr-row')?.dataset.index)];
      if (item?.programme) this.onSelect(item.channel, item.programme);
    });
    $('programme-query').addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' || e.altKey || e.ctrlKey || e.metaKey || $('programme-panel').hidden || $('programme-results').hidden) return;
      const first = this.step(-1, 1);
      if (first < 0) return;
      e.preventDefault();
      this.focusAt(first);
    });
    for (const id of ['programme-query', 'programme-scope', 'programme-period']) {
      $(id).addEventListener('input', () => {
        this.cancel();
        this.offerAll(null);
        if (this.status?.kind === 'many') { this.status = null; this.renderStatus(); }
      });
    }
  }

  /** Whether a search is on show, or typed and not yet cleared: Escape clears it before it closes the guide. */
  get active() {
    return !$('programme-panel').hidden || Boolean($('programme-query').value);
  }

  /**
   * The next item from `from` in the direction of `delta` (±1) that takes
   * the focus: a programme, a "Show all", or a channel's heading that folds.
   * A heading that is only a name is passed over. -1 when there is none.
   */
  step(from, delta) {
    for (let i = from + delta; i >= 0 && i < this.items.length; i += delta) {
      const item = this.items[i];
      if (item.programme || item.more || item.count > FIRST_FEW) return i;
    }
    return -1;
  }

  /** The focus on item `index`, scrolled into view and painted first if it was not. */
  focusAt(index) {
    this.list.scrollToIndex(index);
    this.list.paint({ reuse: true });
    $('programme-results').querySelector(`[data-index="${index}"]`)?.focus();
  }

  key(e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const node = e.target.closest?.('[data-index]');
    if (!node) return;
    const at = Number(node.dataset.index);
    const item = this.items[at];
    if (e.key === 'Enter' && item?.programme) {
      // Not the button's click, which only chooses: Enter activates.
      e.preventDefault();
      this.onActivate(item.channel, item.programme);
      return;
    }
    const page = Math.max(1, Math.floor($('programme-results').clientHeight / ROW_H) - 1);
    let to = -1;
    switch (e.key) {
      case 'ArrowDown': to = this.step(at, 1); break;
      case 'ArrowUp':
        to = this.step(at, -1);
        // Above the first result is the field the search was typed in.
        if (to < 0) { e.preventDefault(); $('programme-query').focus(); return; }
        break;
      case 'PageDown': for (let i = 0, next = at; i < page && (next = this.step(next, 1)) >= 0; i++) to = next; break;
      case 'PageUp': for (let i = 0, next = at; i < page && (next = this.step(next, -1)) >= 0; i++) to = next; break;
      case 'Home': to = this.step(-1, 1); break;
      case 'End': to = this.step(this.items.length, -1); break;
      default: return;
    }
    e.preventDefault();
    if (to >= 0) this.focusAt(to);
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
    this.everyGroup = null;
    this.offerAll(null);
    $('programme-query').value = '';
    $('programme-panel').hidden = true;
    this.onMode(false);
  }

  /**
   * The status, from this.status, in the language now in use, as the list's
   * loading strip shows a load: while the search runs, the spinner, what is
   * searched for and the channels read so far over a bar; once it has read
   * every channel or been stopped, one line of what it found and how many
   * channels it read. A finished search that found nothing shows the larger
   * empty notice in the results' place.
   */
  renderStatus() {
    const s = this.status;
    const running = s?.kind === 'loading' || (s?.kind === 'progress' && s.done < s.total && !s.cancelled);
    const progress = s?.kind === 'progress';
    const channels = progress ? t('programmes.channels', { done: nf.format(s.done), total: nf.format(s.total) }) : '';
    let text = '';
    if (s?.kind === 'loading') text = t('progress.loading');
    else if (s?.kind === 'error') text = t('programmes.error');
    else if (s?.kind === 'many') text = t('programmes.heavy', { count: nf.format(s.count) });
    else if (progress && running) text = t('programmes.searching', { query: s.query });
    else if (progress) text = `${t('programmes.found', { count: nf.format(s.count) })} · ${channels}`;
    if (s?.cancelled) text += `. ${t('progress.cancelled')}`;
    // Channels that could not be read, in the warning's colour, after the
    // channels while it runs and after the result once it is done.
    const failed = progress && s.failed ? document.createElement('span') : null;
    if (failed) {
      failed.className = 'psr-failed';
      failed.textContent = `. ${t('programmes.failed', { count: nf.format(s.failed) })}`;
    }
    $('programme-status').replaceChildren(text, ...(failed && !running ? [failed] : []));
    $('programme-spinner').hidden = !running;
    const share = progress && s.total ? s.done / s.total : 0;
    $('programme-progress').hidden = $('programme-bar').hidden = !(progress && running);
    if (progress && running) {
      $('programme-channels').replaceChildren(channels, ...(failed ? [failed] : []));
      $('programme-percent').textContent = wholePercent(share);
      $('programme-fill').style.transform = `scaleX(${share})`;
      $('programme-bar').setAttribute('aria-valuenow', String(Math.round(share * 100)));
    }
    const finished = s?.kind === 'progress' && s.done === s.total;
    // For the tests and nothing else: whether the search has read every channel.
    $('programme-panel').dataset.state = finished ? 'done' : '';
    const none = finished && !s.count && !s.cancelled;
    $('programme-results').hidden = none;
    $('programme-empty').hidden = !none;
    $('programme-empty').replaceChildren(...(none ? [this.noHits(s)] : []));
    const more = $('programme-continue');
    if (!more.hidden) more.textContent = t('programmes.continue', { count: nf.format(Number(more.dataset.count)) });
  }

  /**
   * Nothing found: said as the list's own searches say it, with the way
   * back to the guide, and when "Filter countries" left countries out of
   * the search, how many it read and a search of all of them.
   */
  noHits(s) {
    const limit = this.everyGroup === this.asked() ? null : this.limit();
    const actions = [];
    if (limit) {
      actions.push({ label: t('search.all'), onClick: () => {
        $('programme-scope').value = 'all';
        this.everyGroup = this.asked();
        this.search();
      } });
    }
    actions.push({ label: t('search.clear'), onClick: () => { this.clear(); this.onLeave(); } });
    const text = [t('programmes.nohits.text', { query: s.query })];
    if (limit) text.push(limit);
    return emptyState(t('empty.nohits'), text, actions, 'search');
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
      const channels = await this.getChannels(scope, run.signal, { everyGroup: this.everyGroup === asked });
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
    // A click chooses the programme and the panel beside offers what can
    // be done with it, as in the grid. Only one on now starts its channel at
    // once: a programme that has ended or is still to come is not on the
    // channel, and playing it live would show something else.
    row.addEventListener('click', () => {
      this.onSelect(channel, programme);
      const at = Date.now();
      if (programme.start <= at && at < programme.stop) this.onPick(channel, programme);
    });
    row.addEventListener('dblclick', () => this.onActivate(channel, programme));
    return row;
  }
}
