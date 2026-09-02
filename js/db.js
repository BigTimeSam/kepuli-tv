// IndexedDB: a cache for API data.
//
// 'cache'  key → { value, at }   general TTL cache
//
// Version 3 dropped the stores 'chunks' and 'meta' that belonged to the
// M3U fallback. On older installations they hold tens of megabytes of
// playlist that nothing reads any more, so they are deleted on upgrade.

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

/* --------------------------------------------------------------- cache */

/** Returns the value if it is fresher than maxAgeMs, otherwise undefined. */
export async function cacheGet(key, maxAgeMs = Infinity) {
  try {
    const db = await openDB();
    const { t } = tx(db, ['cache'], 'readonly');
    const row = await request(t.objectStore('cache').get(key));
    if (!row) return undefined;
    if (maxAgeMs !== Infinity && Date.now() - row.at > maxAgeMs) return undefined;
    return row.value;
  } catch (err) {
    console.warn('[iptv] cache read failed', key, err);
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
    console.warn('[iptv] cache write failed', key, err);
  }
}

/** Every key–value pair with the prefix. For warming the cache. */
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
    console.warn('[iptv] bulk cache read failed', prefix, err);
    return [];
  }
}

export async function cacheAge(key) {
  const db = await openDB();
  const { t } = tx(db, ['cache'], 'readonly');
  const row = await request(t.objectStore('cache').get(key));
  return row ? row.at : null;
}

/** Deletes keys that start with the prefix; without one, the whole cache. */
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
 * Deletes the whole database. For the reset button: emptying the
 * individual stores would leave the file and the space it holds behind.
 */
export async function wipeStorage() {
  try {
    const db = await openDB();
    db.close();
  } catch { /* there was no connection */ }
  dbPromise = null;
  await new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    // blocked = another tab is holding a connection open. The deletion
    // still happens once it closes, and the caller should not wait.
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}

/** Storage granted by the browser, and how much of it is used. */
export async function storageEstimate() {
  if (!navigator.storage || !navigator.storage.estimate) return null;
  try { return await navigator.storage.estimate(); } catch { return null; }
}
