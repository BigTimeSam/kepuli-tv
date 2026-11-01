import { VirtualList } from './vlist.js';
import { t } from './i18n.js';
import { stampFmt } from './format.js';
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
        for (const programme of listings || []) {
          if (programme.stop <= from || programme.start >= to) continue;
          const key = `${programme.start}:${programme.stop}:${programme.title}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const text = searchKey(`${programme.title} ${programme.description || ''}`);
          if (words.every((word) => text.includes(word))) fresh.push({ channel, programme });
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

export class ProgrammeSearch {
  constructor({ getChannels, getEpg, onSelect, onActivate, onMode }) {
    Object.assign(this, { getChannels, getEpg, onSelect, onActivate, onMode });
    this.results = [];
    this.run = null;
    // What the status line says, kept as facts rather than text, so that a
    // change of language can say it again in the new one (renderStatus).
    this.status = null;
    // The all-channels search the viewer said yes to, see MANY_CHANNELS.
    this.confirmed = null;
    this.list = new VirtualList($('programme-results'), 64, (i) => this.row(i));
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
    this.results = [];
    this.list.setCount(0);
    this.status = null;
    this.offerAll(null);
    $('programme-query').value = '';
    $('programme-panel').hidden = true;
    this.onMode(false);
  }

  /** The status line, from this.status, in the language now in use. */
  renderStatus() {
    const s = this.status;
    let text = '';
    if (s?.kind === 'loading') text = t('progress.loading');
    else if (s?.kind === 'error') text = t('programmes.error');
    else if (s?.kind === 'many') text = t('programmes.heavy', { count: s.count });
    else if (s?.kind === 'progress') {
      text = t('programmes.status', { count: s.count, done: s.done, total: s.total })
        + (s.failed ? `. ${t('programmes.failed', { count: s.failed })}` : '')
        + (s.done === s.total ? `. ${t('programmes.complete')}` : '');
    }
    if (s?.cancelled) text += `${text ? '. ' : ''}${t('progress.cancelled')}`;
    $('programme-status').textContent = text;
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
    this.results = [];
    this.list.setCount(0);
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
          this.results = results;
          this.list.setCount(results.length, { keepScroll: true });
          this.status = { kind: 'progress', count: results.length, done, total, failed };
          this.renderStatus();
        } });
    } catch (err) {
      if (!run.signal.aborted) { this.status = { kind: 'error' }; this.renderStatus(); }
    } finally {
      if (this.run === run) { this.run = null; $('programme-cancel').hidden = true; }
    }
  }

  row(index) {
    const { channel, programme } = this.results[index];
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'programme-result';
    const title = document.createElement('strong');
    title.textContent = programme.title;
    const meta = document.createElement('span');
    meta.textContent = `${channel.n}, ${stampFmt.format(new Date(programme.start))}`;
    row.append(title, meta);
    row.addEventListener('click', () => this.onSelect(channel, programme));
    row.addEventListener('dblclick', () => this.onActivate(channel, programme));
    return row;
  }
}
