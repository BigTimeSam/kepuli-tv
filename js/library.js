// Laiska datakerros.
//
// Periaate: lataa mahdollisimman vähän, mahdollisimman myöhään.
//   1. Kategoriat haetaan aina (43 kt kaikille kolmelle tyypille).
//   2. Kategoriaa klikattaessa haetaan vain sen sisältö (~2 kt).
//   3. Koko tyypin lista (0,6–2,9 Mt) haetaan vasta kun sitä oikeasti
//      tarvitaan: haussa tai "Kaikki"-valinnassa. Sen jälkeen kaikki on
//      muistissa ja haku on välitön.
// Koko lista tallentuu IndexedDB:hen; kategoriakohtaiset osumat pidetään
// vain muistissa, koska ne ovat halpoja hakea uudelleen eivätkä silloin
// voi jäädä vanhentuneina roikkumaan.

import { cacheGet, cachePut, cacheAge, cacheClear } from './db.js';
import { localeTag } from './i18n.js';

export const TYPES = ['live', 'movie', 'series'];

// Kaikki listat aakkosjärjestykseen. Palveluntarjoajan oma järjestys on
// mielivaltainen — myös kanavilla, joissa se vaihtelee kategoriasta toiseen —
// ja pitkän listan selaaminen vaatii ennakoitavan järjestyksen.
// Kootaan kutsuttaessa: kieli voi vaihtua kesken istunnon, ja aakkosjärjestys
// on kielen asia. Uusi Collator per kutsu olisi mitattavaa kuormaa 55 000
// nimen listalla, joten se tehdään kerran per tunniste.
let collatorTag = null;
let collatorInstance = null;
function collator() {
  if (collatorTag !== localeTag()) {
    collatorTag = localeTag();
    collatorInstance = new Intl.Collator(collatorTag, { numeric: true, sensitivity: 'base' });
  }
  return collatorInstance;
}

// Nimen alun välimerkit ("|FI| Title", "- Title") eivät ole aakkosia eivätkä
// saa siksi määrätä paikkaa listassa.
const LEADING_JUNK = /^[^\p{L}\p{N}]+/u;

function sortKey(name) {
  return String(name || '').replace(LEADING_JUNK, '').trim();
}

/**
 * Palauttaa uuden, aakkostetun taulukon — alkuperäistä ei muuteta, koska
 * sama taulukko on jaossa usealle näkymälle.
 *
 * @param {{n:string}[]} items
 * @param {((name: string) => string)|null} [label] järjestysperuste, kun
 *        näkyvä nimi on muu kuin item.n (ks. name.js).
 */
export function sortItems(items, label) {
  if (!items || items.length < 2) return items;
  const compare = collator();
  const keyed = items.map((item, i) => [sortKey(label ? label(item.n) : item.n), i, item]);
  keyed.sort((a, b) => compare.compare(a[0], b[0]) || a[1] - b[1]);
  return keyed.map((entry) => entry[2]);
}

const TTL = {
  categories: 24 * 3600e3,
  full: 6 * 3600e3,
  seriesInfo: 24 * 3600e3,
  vodInfo: 7 * 24 * 3600e3,
};

export class Library {
  constructor(api) {
    this.api = api;
    this.categories = { live: [], movie: [], series: [] };
    this.groups = { live: [], movie: [], series: [] };
    this.full = { live: null, movie: null, series: null };
    this.lower = { live: null, movie: null, series: null };
    this.fullAt = { live: null, movie: null, series: null };
    this.byCategory = new Map();     // "live:3" → items (muistissa)
    this.pending = new Map();        // rinnakkaiset kutsut jaetaan
    this.details = new Map();        // sarjan/elokuvan lisätiedot
  }

  /* ------------------------------------------------------------ kategoriat */

  async loadCategories({ force = false } = {}) {
    await Promise.all(TYPES.map(async (type) => {
      const key = `cats:${type}`;
      if (!force) {
        const cached = await cacheGet(key, TTL.categories);
        if (cached) { this.categories[type] = cached; return; }
      }
      const cats = await this.api.categories(type);
      this.categories[type] = cats;
      await cachePut(key, cats);
    }));
    for (const type of TYPES) this.groups[type] = buildGroups(this.categories[type]);
    return this.categories;
  }

  categoryName(type, id) {
    const hit = this.categories[type].find((c) => c.id === id);
    return hit ? hit.name : id;
  }

  /** Ryhmän kuvaus nimen perusteella. */
  group(type, name) {
    return this.groups[type].find((g) => g.name === name) || null;
  }

  /**
   * Yhden ryhmän (esim. "Sweden") koko sisältö: kaikkien alakategorioiden
   * kanavat yhtenä listana. Haetaan kerran, minkä jälkeen alakategorioiden
   * välillä vaihtaminen on pelkkää muistista suodattamista.
   */
  async groupItems(type, groupName, { onProgress } = {}) {
    const group = this.group(type, groupName);
    if (!group) return [];
    if (this.full[type]) {
      const ids = new Set(group.cats.map((c) => c.id));
      return this.full[type].filter((it) => it.cats.some((c) => ids.has(c)));
    }
    const key = `group:${type}:${groupName}`;
    const hit = this.byCategory.get(key);
    if (hit) return hit;
    return this.share(key, async () => {
      const items = await this.fetchCategories(type, group.cats.map((c) => c.id), onProgress);
      this.byCategory.set(key, items);
      return items;
    });
  }

  /**
   * Hakee kategoriat rinnakkain mutta kokoaa tuloksen kategoriajärjestyksessä,
   * jottei kaksoiskappaleiden karsinta riipu siitä missä järjestyksessä
   * vastaukset sattuvat tulemaan. Lopuksi koko joukko aakkostetaan.
   */
  async fetchCategories(type, categoryIds, onProgress) {
    const results = new Array(categoryIds.length);
    let next = 0;
    let done = 0;
    const worker = async () => {
      for (;;) {
        const index = next++;
        if (index >= categoryIds.length) return;
        results[index] = await this.api.streams(type, categoryIds[index]);
        done++;
        if (onProgress) onProgress(done, categoryIds.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, categoryIds.length) }, worker));

    const seen = new Set();
    const out = [];
    for (const items of results) {
      for (const item of items || []) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        out.push(item);
      }
    }
    return sortItems(out);
  }

  /** Ryhmäkohtaiset lukumäärät — tiedossa vasta kun koko lista on haettu. */
  groupCounts(type) {
    const counts = this.categoryCounts(type);
    if (!counts) return null;
    const out = new Map();
    for (const group of this.groups[type]) {
      let total = 0;
      for (const cat of group.cats) total += counts.get(cat.id) || 0;
      out.set(group.name, total);
    }
    return out;
  }

  /* ---------------------------------------------------------------- listat */

  isFull(type) { return this.full[type] != null; }

  /** Yhden kategorian sisältö. Käyttää koko listaa jos se on jo muistissa. */
  async categoryItems(type, categoryId) {
    if (this.full[type]) return this.full[type].filter((it) => it.cats.includes(categoryId));
    const key = `${type}:${categoryId}`;
    const hit = this.byCategory.get(key);
    if (hit) return hit;
    return this.share(key, async () => {
      const items = sortItems(await this.api.streams(type, categoryId));
      this.byCategory.set(key, items);
      return items;
    });
  }

  /** Koko tyypin lista. Palauttaa heti jos jo ladattu tai välimuistissa. */
  async ensureFull(type, { onProgress, force = false } = {}) {
    if (this.full[type] && !force) return this.full[type];
    return this.share(`full:${type}`, async () => {
      const key = `full:${type}`;
      if (!force) {
        const cached = await cacheGet(key, TTL.full);
        if (cached) { this.setFull(type, cached, await cacheAge(key)); return this.full[type]; }
      }
      const items = await this.api.streams(type, null, { onProgress });
      this.setFull(type, items, Date.now());
      await cachePut(key, items);
      return this.full[type];
    });
  }

  setFull(type, items, at) {
    this.full[type] = sortItems(items);
    this.fullAt[type] = at || Date.now();
    // Hakuindeksi kerran: 55 000 toLowerCase-kutsua per näppäinpainallus
    // olisi näkyvää nykimistä.
    this.lower[type] = this.full[type].map((it) => it.n.toLowerCase());
    this.byCategory.clear();
  }

  /**
   * Hakee koko listasta; vaatii ensureFull():n.
   *
   * Osumat järjestetään osuvuuden mukaan: pelkkä osamerkkijonohaku nostaisi
   * hakusanalla "yle" ensin "KYLE COLLECTIONin" ja "Pink Stylen" ennen
   * Yle-kanavia. Sanan alusta alkava osuma menee siksi aina keskeltä
   * löytyvän edelle. Samanarvoiset osumat säilyttävät koko listan
   * järjestyksen eli aakkosjärjestyksen.
   */
  search(type, query, categoryId) {
    const items = this.full[type];
    if (!items) return [];
    const lower = this.lower[type];
    const q = query.trim().toLowerCase();
    const scored = [];
    for (let i = 0; i < items.length; i++) {
      if (categoryId && !items[i].cats.includes(categoryId)) continue;
      if (!q) { scored.push([0, i]); continue; }
      const at = lower[i].indexOf(q);
      if (at === -1) continue;
      scored.push([matchScore(lower[i], q, at), i]);
    }
    scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return scored.map(([, i]) => items[i]);
  }

  /** Kategoriakohtaiset lukumäärät — tiedossa vasta kun koko lista on haettu. */
  categoryCounts(type) {
    const items = this.full[type];
    if (!items) return null;
    const counts = new Map();
    for (const it of items) for (const c of it.cats) counts.set(c, (counts.get(c) || 0) + 1);
    return counts;
  }

  /* ------------------------------------------------------------ lisätiedot */

  async seriesEpisodes(seriesId) {
    const key = `series:${seriesId}`;
    if (this.details.has(key)) return this.details.get(key);
    return this.share(key, async () => {
      let info = await cacheGet(key, TTL.seriesInfo);
      if (!info) { info = await this.api.seriesInfo(seriesId); await cachePut(key, info); }
      this.details.set(key, info);
      return info;
    });
  }

  async movieDetails(vodId) {
    const key = `vod:${vodId}`;
    if (this.details.has(key)) return this.details.get(key);
    return this.share(key, async () => {
      let info = await cacheGet(key, TTL.vodInfo);
      if (!info) { info = await this.api.vodInfo(vodId); await cachePut(key, info); }
      this.details.set(key, info);
      return info;
    });
  }

  /* ----------------------------------------------------------------- muuta */

  /** Estää saman haun tekemisen kahdesti rinnakkain. */
  share(key, factory) {
    const running = this.pending.get(key);
    if (running) return running;
    const promise = factory().finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }

  async reset() {
    this.categories = { live: [], movie: [], series: [] };
    this.groups = { live: [], movie: [], series: [] };
    this.full = { live: null, movie: null, series: null };
    this.lower = { live: null, movie: null, series: null };
    this.fullAt = { live: null, movie: null, series: null };
    this.byCategory.clear();
    this.details.clear();
    await cacheClear();
  }
}

// 0 = nimi alkaa hakusanalla, 1 = sana alkaa hakusanalla, 2 = keskeltä.
// Kanavanimissä on usein maakoodi edessä ("FI: Yle TV1"), joten myös
// tunnisteen jälkeinen alku lasketaan sanan aluksi.
function matchScore(name, query, at) {
  if (at === 0) return 0;
  const before = name.charCodeAt(at - 1);
  const isBoundary = before === 32 || before === 58 || before === 45 || before === 40 || before === 46;
  return isBoundary ? 1 : 2;
}

/**
 * Palveluntarjoajan kategorianimissä on kaksi tasoa, jotka on koodattu
 * merkkijonoon: "Sweden - Sport", "Movies: NL - Kids". Puretaan ne
 * maaksi/aiheeksi ja tarkenteeksi, jotta 519 kategoriaa mahtuu 81 riviin.
 */
export function buildGroups(categories) {
  const prefix = commonPrefix(categories.map((c) => c.name));
  const map = new Map();
  for (const cat of categories) {
    const { group, sub } = splitCategoryName(cat.name, prefix);
    let entry = map.get(group);
    if (!entry) { entry = { name: group, cats: [] }; map.set(group, entry); }
    entry.cats.push({ id: cat.id, name: cat.name, sub });
  }
  return [...map.values()].sort((a, b) => collator().compare(a.name, b.name));
}

/** Kaikille yhteinen "Movies:"-tyyppinen etuliite on pelkkää toistoa. */
function commonPrefix(names) {
  if (names.length < 4) return null;
  const counts = new Map();
  for (const name of names) {
    const m = /^([^:]{1,20}):\s+/.exec(name);
    if (m) counts.set(m[1], (counts.get(m[1]) || 0) + 1);
  }
  for (const [prefix, count] of counts) {
    if (count >= names.length * 0.8) return `${prefix}: `;
  }
  return null;
}

export function splitCategoryName(name, prefix) {
  let rest = prefix && name.startsWith(prefix) ? name.slice(prefix.length) : name;
  rest = rest.trim();
  const i = rest.indexOf(' - ');
  if (i === -1) return { group: rest, sub: null };
  return { group: rest.slice(0, i).trim(), sub: rest.slice(i + 3).trim() };
}
