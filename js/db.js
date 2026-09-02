// IndexedDB: välimuisti API-datalle.
//
// 'cache'  avain → { value, at }   yleinen TTL-välimuisti
//
// Versio 3 pudotti M3U-varareitin taulut 'chunks' ja 'meta'. Vanhoilla
// asennuksilla niissä on kymmeniä megatavuja toistolistaa, jota mikään ei
// enää lue, joten ne poistetaan päivityksessä.

const DB_NAME = 'kepuli-tv';
const DB_VERSION = 3;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache');
      for (const gone of ['chunks', 'meta']) {
        if (db.objectStoreNames.contains(gone)) db.deleteObjectStore(gone);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(db, stores, mode) {
  const t = db.transaction(stores, mode);
  return {
    t,
    done: new Promise((resolve, reject) => {
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new DOMException('aborted', 'AbortError'));
    }),
  };
}

const request = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

/* ------------------------------------------------------------ välimuisti */

/** Palauttaa arvon jos se on tuoreempi kuin maxAgeMs, muuten undefined. */
export async function cacheGet(key, maxAgeMs = Infinity) {
  try {
    const db = await openDB();
    const { t } = tx(db, ['cache'], 'readonly');
    const row = await request(t.objectStore('cache').get(key));
    if (!row) return undefined;
    if (maxAgeMs !== Infinity && Date.now() - row.at > maxAgeMs) return undefined;
    return row.value;
  } catch (err) {
    console.warn('[iptv] välimuistin luku epäonnistui', key, err);
    return undefined;
  }
}

export async function cachePut(key, value) {
  try {
    const db = await openDB();
    const { t, done } = tx(db, ['cache'], 'readwrite');
    t.objectStore('cache').put({ value, at: Date.now() }, key);
    await done;
  } catch (err) {
    console.warn('[iptv] välimuistin kirjoitus epäonnistui', key, err);
  }
}

/** Kaikki avain–arvo-parit prefixillä. Välimuistin lämmitykseen. */
export async function cacheGetAll(prefix) {
  try {
    const db = await openDB();
    const { t } = tx(db, ['cache'], 'readonly');
    const store = t.objectStore('cache');
    const keys = await request(store.getAllKeys());
    const rows = await request(store.getAll());
    const out = [];
    for (let i = 0; i < keys.length; i++) {
      if (!prefix || String(keys[i]).startsWith(prefix)) out.push([String(keys[i]), rows[i].value]);
    }
    return out;
  } catch (err) {
    console.warn('[iptv] välimuistin joukkoluku epäonnistui', prefix, err);
    return [];
  }
}

export async function cacheAge(key) {
  const db = await openDB();
  const { t } = tx(db, ['cache'], 'readonly');
  const row = await request(t.objectStore('cache').get(key));
  return row ? row.at : null;
}

/** Poistaa avaimet joiden alku täsmää; ilman prefixiä koko välimuistin. */
export async function cacheClear(prefix) {
  const db = await openDB();
  const { t, done } = tx(db, ['cache'], 'readwrite');
  const store = t.objectStore('cache');
  if (!prefix) store.clear();
  else {
    const keys = await request(store.getAllKeys());
    for (const key of keys) if (String(key).startsWith(prefix)) store.delete(key);
  }
  await done;
}

export async function cacheSummary() {
  const db = await openDB();
  const { t } = tx(db, ['cache'], 'readonly');
  const keys = await request(t.objectStore('cache').getAllKeys());
  return keys.map(String);
}

/**
 * Poistaa koko tietokannan. Palautusnappia varten: yksittäisten taulujen
 * tyhjennys jättäisi tiedoston ja sen varaaman tilan paikalleen.
 */
export async function wipeStorage() {
  try {
    const db = await openDB();
    db.close();
  } catch { /* yhteyttä ei ollut */ }
  dbPromise = null;
  await new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    // blocked = jokin muu välilehti pitää yhteyttä auki. Poisto tapahtuu
    // silti kun se sulkeutuu, eikä kutsujan kannata jäädä odottamaan.
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}

/** Selaimen myöntämä ja käytetty tallennustila. */
export async function storageEstimate() {
  if (!navigator.storage || !navigator.storage.estimate) return null;
  try { return await navigator.storage.estimate(); } catch { return null; }
}
