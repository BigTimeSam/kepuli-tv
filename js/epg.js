// Programme data lazily, one channel at a time.
//
// The whole XMLTV would be 4.8 MB gzipped and would go stale in a day, so
// get_short_epg fetches only the channels that are visible or playing —
// 1.6 kB and ~150 ms per channel. Channels without an epg_channel_id
// (two thirds of them) are skipped entirely.
//
// The programme guide needs a wider window than a list row's "now and
// next", so the same cache serves three levels of detail:
//
//   short   4 programmes    list row subtitle              1.6 kB
//   grid   40 programmes    guide forwards (~12 h)          18 kB
//   full   whole table      guide backwards and catch-up  50–150 kB
//
// A coarser level is never fetched over a finer one, so a channel visited
// in the guide does not fall back to four programmes when the list is
// scrolled.

const CONCURRENCY = 4;
const MAX_AGE_MS = 30 * 60e3;
const RETRY_AFTER_MS = 5 * 60e3;
const GRID_LIMIT = 40;

// The scroll offset is whole pixels, so the start of the window wobbles by
// seconds. Without a little slack that would spawn needless full-table
// fetches.
const PAST_SLACK_MS = 60e3;

const RANK = { short: 0, grid: 1, full: 2 };

export class Epg {
  /** @param {(streamIds: string[]) => void} onUpdate */
  constructor(api, onUpdate) {
    this.api = api;
    this.onUpdate = onUpdate;
    this.cache = new Map();     // streamId → { listings, at, mode }
    this.failedUntil = new Map();
    this.queue = [];            // [{ id, mode }]
    this.queued = new Map();    // streamId → mode
    this.active = 0;
    this.updated = new Set();
    this.flushHandle = null;
    this.enabled = true;
  }

  /** The programme on now and the next one, or null when not known. */
  nowNext(streamId) {
    const entry = this.cache.get(String(streamId));
    if (!entry) return null;
    const now = Date.now();
    const listings = entry.listings;
    for (let i = 0; i < listings.length; i++) {
      if (listings[i].start <= now && now < listings[i].stop) {
        return { now: listings[i], next: listings[i + 1] || null };
      }
    }
    return { now: null, next: listings.find((p) => p.start > now) || null };
  }

  has(streamId) { return this.cache.has(String(streamId)); }

  /** Every known programme, or null if the channel has not been fetched. */
  listings(streamId) {
    const entry = this.cache.get(String(streamId));
    return entry ? entry.listings : null;
  }

  /** Programmes falling in the interval, or null if the channel has not
   *  been fetched. */
  listingsIn(streamId, from, to) {
    const entry = this.cache.get(String(streamId));
    if (!entry) return null;
    return entry.listings.filter((p) => p.stop > from && p.start < to);
  }

  isStale(streamId, mode = 'short') {
    const entry = this.cache.get(String(streamId));
    if (!entry) return true;
    if (RANK[entry.mode] < RANK[mode]) return true;
    if (Date.now() - entry.at > MAX_AGE_MS) return true;
    // An empty result is a result: a channel that has an epg_channel_id
    // but no programmes stays fresh for good, otherwise it would be
    // fetched again on every scroll.
    const last = entry.listings[entry.listings.length - 1];
    return last ? last.stop <= Date.now() : false;
  }

  /** Requests one channel's data; priority moves it to the head of the queue. */
  want(item, { priority = false, mode = 'short' } = {}) {
    if (!this.enabled || !item || item.k !== 0 || !item.epgId) return;
    const id = String(item.id);
    if (!this.isStale(id, mode)) return;
    const retry = this.failedUntil.get(id);
    if (retry && Date.now() < retry && !priority) return;

    const pending = this.queued.get(id);
    if (pending != null) {
      if (RANK[mode] > RANK[pending]) {
        this.queued.set(id, mode);
        const waiting = this.queue.find((req) => req.id === id);
        if (waiting) waiting.mode = mode;
      }
      if (priority) {
        const at = this.queue.findIndex((req) => req.id === id);
        if (at > 0) this.queue.unshift(this.queue.splice(at, 1)[0]);
      }
      return;
    }

    this.queued.set(id, mode);
    const request = { id, mode };
    if (priority) this.queue.unshift(request); else this.queue.push(request);
    this.pump();
  }

  /**
   * The rows currently visible. The old queue is thrown away, because once
   * the user has scrolled on, the previous screenful's data is of no use.
   */
  setVisible(items) {
    if (!this.enabled) return;
    this.dropUnseen(items);
    for (const it of items) this.want(it);
    this.pump();
  }

  /**
   * The channels and time window visible in the guide.
   *
   * get_short_epg starts from the programme on now, so it always covers
   * the window up to its start. An unknown channel is therefore always
   * fetched cheaply, and the whole table only once the window is known to
   * reach past the known programmes — in either direction.
   */
  setVisibleWindow(items, from, to) {
    if (!this.enabled) return;
    this.dropUnseen(items);
    for (const it of items) {
      const entry = this.cache.get(String(it.id));
      const known = entry && entry.listings.length ? entry.listings : null;
      const needFull = known
        ? from < known[0].start - PAST_SLACK_MS || to > known[known.length - 1].stop
        : false;
      this.want(it, { mode: needFull ? 'full' : 'grid' });
    }
    this.pump();
  }

  dropUnseen(items) {
    const keep = new Set();
    for (const it of items) if (it && it.k === 0 && it.epgId) keep.add(String(it.id));
    this.queue = this.queue.filter((req) => keep.has(req.id));
    this.queued = new Map(this.queue.map((req) => [req.id, req.mode]));
  }

  pump() {
    while (this.active < CONCURRENCY && this.queue.length > 0) {
      const { id, mode } = this.queue.shift();
      this.queued.delete(id);
      this.active++;
      const request = mode === 'full'
        ? this.api.fullEpg(id)
        : this.api.shortEpg(id, mode === 'grid' ? GRID_LIMIT : 4);
      request
        .then((listings) => {
          // get_simple_data_table returns the rows in arbitrary order;
          // the guide relies on them being in time order.
          listings.sort((a, b) => a.start - b.start);
          this.cache.set(id, { listings, at: Date.now(), mode });
          this.failedUntil.delete(id);
          this.markUpdated(id);
        })
        .catch((err) => {
          if (err.name !== 'AbortError') this.failedUntil.set(id, Date.now() + RETRY_AFTER_MS);
        })
        .finally(() => { this.active--; this.pump(); });
    }
  }

  /** Updates are batched into a single frame. */
  markUpdated(id) {
    this.updated.add(id);
    if (this.flushHandle) return;
    this.flushHandle = requestAnimationFrame(() => {
      this.flushHandle = null;
      const ids = [...this.updated];
      this.updated.clear();
      this.onUpdate(ids);
    });
  }

  clear() {
    this.cache.clear();
    this.failedUntil.clear();
    this.queue = [];
    this.queued.clear();
  }
}
