// Ohjelmatiedot laiskasti, kanava kerrallaan.
//
// Koko XMLTV olisi 4,8 Mt gzipattuna ja vanhenisi vuorokaudessa, joten
// haetaan get_short_epg:llä vain ne kanavat jotka ovat näkyvissä tai
// toistossa — 1,6 kt ja ~150 ms per kanava. Kanavat joilla ei ole
// epg_channel_id:tä (2/3 kaikista) ohitetaan kokonaan.
//
// Ohjelmaopas tarvitsee leveämmän ikkunan kuin listarivin "nyt ja
// seuraavaksi", joten sama välimuisti palvelee kolmea tarkkuutta:
//
//   short   4 ohjelmaa    listarivin alateksti           1,6 kt
//   grid   40 ohjelmaa    opas eteenpäin (~12 h)          18 kt
//   full   koko taulu     opas taaksepäin ja catchup   50–150 kt
//
// Karkeampaa ei koskaan haeta hienomman päälle, joten oppaassa käyty
// kanava ei putoa takaisin neljään ohjelmaan kun listaa vierittää.

const CONCURRENCY = 4;
const MAX_AGE_MS = 30 * 60e3;
const RETRY_AFTER_MS = 5 * 60e3;
const GRID_LIMIT = 40;

// Vierityskohta on kokonaisia pikseleitä, joten ikkunan alku heittelee
// sekunteja. Ilman pientä pelivaraa se poikisi turhia koko taulun hakuja.
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

  /** Nyt menossa oleva ja seuraava ohjelma, tai null jos ei tiedossa. */
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

  /** Kaikki tiedossa olevat ohjelmat, tai null jos kanavaa ei ole haettu. */
  listings(streamId) {
    const entry = this.cache.get(String(streamId));
    return entry ? entry.listings : null;
  }

  /** Aikaväliin osuvat ohjelmat, tai null jos kanavaa ei ole haettu. */
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
    // Tyhjä tulos on tulos: kanava jolla on epg_channel_id mutta ei
    // ohjelmia pysyy tuoreena ikänsä, muuten se haettaisiin uudelleen
    // joka vierityksellä.
    const last = entry.listings[entry.listings.length - 1];
    return last ? last.stop <= Date.now() : false;
  }

  /** Pyytää yhden kanavan tiedot; priority nostaa jonon kärkeen. */
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
   * Näkyvissä olevat rivit. Vanha jono heitetään pois, koska käyttäjän
   * vieritettyä eteenpäin edellisen ruudullisen tiedoilla ei tee mitään.
   */
  setVisible(items) {
    if (!this.enabled) return;
    this.dropUnseen(items);
    for (const it of items) this.want(it);
    this.pump();
  }

  /**
   * Oppaassa näkyvät kanavat ja aikaikkuna.
   *
   * get_short_epg alkaa menossa olevasta ohjelmasta, joten se kattaa
   * ikkunan aina sen alkuun asti. Tuntematon kanava haetaan siksi aina
   * halvalla, ja koko taulu vasta kun tiedetään ikkunan ulottuvan
   * tunnettujen ohjelmien ohi — kumpaan tahansa suuntaan.
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
          // get_simple_data_table palauttaa rivit satunnaisessa
          // järjestyksessä; opas nojaa siihen että ne ovat ajassa.
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

  /** Päivitykset niputetaan yhteen ruudunpiirtoon. */
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
