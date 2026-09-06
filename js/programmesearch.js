import { VirtualList } from './vlist.js';
import { t } from './i18n.js';
import { stampFmt } from './format.js';
import { archiveDays } from './epggrid.js';
import { searchKey, searchTerms } from './name.js';

/** Explicit, cancellable full-guide search. Four requests at most; completed
 * full tables are shared with the grid. Partial failures never look like a
 * complete empty result. No media connection is opened by a search. */
export async function searchProgrammes(epg, channels, query, { signal, from = -Infinity, to = Infinity, onProgress = () => {} } = {}) {
  const words = searchTerms(query);
  const eligible = [...new Map(channels.filter((c) => c.epgId).map((c) => [String(c.id), c])).values()];
  const results = [];
  let next = 0, done = 0, failed = 0;
  let reportedAt = 0;
  const report = (force = false) => {
    if (!force && done !== eligible.length && Date.now() - reportedAt < 150) return;
    reportedAt = Date.now();
    onProgress({ results: [...results].sort((a, b) => a.programme.start - b.programme.start
      || a.channel.n.localeCompare(b.channel.n)), done, total: eligible.length, failed });
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
          epg.cache.set(String(channel.id), { listings, mode: 'full', at: Date.now() });
          epg.markUpdated(String(channel.id));
        }
        const seen = new Set();
        for (const programme of listings || []) {
          if (programme.stop <= from || programme.start >= to) continue;
          const key = `${programme.start}:${programme.stop}:${programme.title}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const text = searchKey(`${programme.title} ${programme.description || ''}`);
          if (words.every((word) => text.includes(word))) results.push({ channel, programme });
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

const $ = (id) => document.getElementById(id);

export class ProgrammeSearch {
  constructor({ getChannels, getEpg, onSelect, onActivate, onMode }) {
    Object.assign(this, { getChannels, getEpg, onSelect, onActivate, onMode });
    this.results = [];
    this.run = null;
    this.list = new VirtualList($('programme-results'), 64, (i) => this.row(i));
    $('programme-form').addEventListener('submit', (e) => { e.preventDefault(); this.search(); });
    $('programme-cancel').addEventListener('click', () => this.cancel());
    $('programme-clear').addEventListener('click', () => this.clear());
    for (const id of ['programme-query', 'programme-scope', 'programme-period']) {
      $(id).addEventListener('input', () => this.cancel());
    }
  }

  cancel() {
    if (!this.run) return;
    this.run.abort();
    this.run = null;
    $('programme-cancel').hidden = true;
    $('programme-status').textContent += ` · ${t('progress.cancelled')}`;
  }

  clear() {
    this.cancel();
    this.results = [];
    this.list.setCount(0);
    $('programme-query').value = '';
    $('programme-panel').hidden = true;
    this.onMode(false);
  }

  async search() {
    this.cancel();
    const query = $('programme-query').value.trim();
    if (!query) { this.clear(); return; }
    const run = new AbortController();
    this.run = run;
    this.results = [];
    this.list.setCount(0);
    $('programme-panel').hidden = false;
    $('programme-cancel').hidden = false;
    $('programme-status').textContent = t('progress.loading');
    this.onMode(true);
    try {
      const channels = await this.getChannels($('programme-scope').value, run.signal);
      if (run.signal.aborted) return;
      const now = Date.now();
      const period = $('programme-period').value;
      const from = period === 'upcoming' ? now : now - archiveDays(channels) * 86400e3;
      const to = period === 'past' ? now : now + 5 * 86400e3;
      await searchProgrammes(this.getEpg(), channels, query, { signal: run.signal, from, to,
        onProgress: ({ results, done, total, failed }) => {
          if (this.run !== run) return;
          this.results = results;
          this.list.setCount(results.length, { keepScroll: true });
          $('programme-status').textContent = t('programmes.status', { count: results.length, done, total })
            + (failed ? ` · ${t('programmes.failed', { count: failed })}` : '')
            + (done === total ? ` · ${t('programmes.complete')}` : '');
        } });
    } catch (err) {
      if (!run.signal.aborted) $('programme-status').textContent = t('programmes.error');
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
    meta.textContent = `${channel.n} · ${stampFmt.format(new Date(programme.start))}`;
    row.append(title, meta);
    row.addEventListener('click', () => this.onSelect(channel, programme));
    row.addEventListener('dblclick', () => this.onActivate(channel, programme));
    return row;
  }
}
