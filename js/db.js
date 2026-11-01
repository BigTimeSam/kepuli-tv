// IndexedDB: a cache for API data.
//
// 'cache'  key → { value, at }   general TTL cache
//
// Version 3 dropped the stores 'chunks' and 'meta' that belonged to the
// M3U fallback. On older installations they hold tens of megabytes of
// playlist that nothing reads any more, so they are deleted on upgrade.
//
// Version 4 put the account in front of every catalogue key (see
// js/library.js): the rows written before it belong to whichever account
// was in use, which is no longer known, so they go. The file headers under
// 'probe:' stay — they are keyed by the server and say what a file holds.
//
// Version 5 indexes the rows by the time they were written. Nothing used to
// delete a row once its time was up: a film's details stayed for every
// film ever scrolled past, and an expired whole list for as long as the
// browser kept the database. The index lets cachePurge() find the old rows
// from their keys alone, without reading — deserialising — a multi-megabyte
// list to learn its age.

const DB_NAME = 'kepuli-tv';
const DB_VERSION = 5;
// An open that waits longer than this is behind a deletion another tab
// asked for, or an upgrade a tab of an older version will not let through.
// The player carries on without the cache rather than wait for it, and
// tries again a little later.
const OPEN_TIMEOUT_MS = 5000;
const RETRY_AFTER_MS = 30000;

let dbPromise = null;
let unavailableUntil = 0;

function openDB() {
  if (dbPromise) return dbPromise;
  if (Date.now() < unavailableUntil) return Promise.reject(new Error('the cache is not available'));
  const opening = new Promise((resolve, reject) => {
    let late = false;
    const forget = () => { if (dbPromise === opening) dbPromise = null; };
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    const timer = setTimeout(() => {
      late = true;
      unavailableUntil = Date.now() + RETRY_AFTER_MS;
      forget();
      reject(new Error('the cache did not open'));
    }, OPEN_TIMEOUT_MS);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      const store = db.objectStoreNames.contains('cache')
        ? req.transaction.objectStore('cache') : db.createObjectStore('cache');
      if (event.oldVersion > 0 && event.oldVersion < 4) {
        store.openKeyCursor().onsuccess = (e) => {
          const cursor = e.target.result;
          if (!cursor) return;
          if (!String(cursor.primaryKey).startsWith('probe:')) store.delete(cursor.primaryKey);
          cursor.continue();
        };
      }
      if (!store.indexNames.contains('at')) store.createIndex('at', 'at');
      for (const gone of ['chunks', 'meta']) {
        if (db.objectStoreNames.contains(gone)) db.deleteObjectStore(gone);
      }
    };
    req.onsuccess = () => {
      clearTimeout(timer);
      const db = req.result;
      if (late) { db.close(); return; }
      // Another tab is deleting the database — Reset everything — or
      // opening a newer version of it. Held open here, the connection would
      // keep the deletion waiting, and the page that asked for it would
      // reload into an open that never ends.
      db.onversionchange = () => { db.close(); forget(); };
      resolve(db);
    };
    req.onerror = () => { clearTimeout(timer); forget(); reject(req.error); };
  });
  dbPromise = opening;
  return opening;
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
  return (await cacheEntry(key, maxAgeMs))?.value;
}

/**
 * The value and when it was written, { value, at }, if it is fresher than
 * maxAgeMs; otherwise undefined. One read for both: asking for the age
 * separately read a whole list of tens of thousands of titles twice.
 */
export async function cacheEntry(key, maxAgeMs = Infinity) {
  try {
    const db = await openDB();
    const { t } = tx(db, ['cache'], 'readonly');
    const row = await request(t.objectStore('cache').get(key));
    if (!row) return undefined;
    if (maxAgeMs !== Infinity && Date.now() - row.at > maxAgeMs) return undefined;
    return row;
  } catch (err) {
    console.warn('[iptv] cache read failed', key, err);
    return undefined;
  }
}

/**
 * The keys that start with the prefix, as a key range. U+FFFF sorts after
 * every character a key of ours holds, so the range ends where the prefix
 * does.
 */
export const prefixRange = (prefix) => IDBKeyRange.bound(prefix, `${prefix}\uffff`);

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

/**
 * Every key–value pair with the prefix, fresher than maxAgeMs. For warming
 * the cache. Only the prefix's rows are read: reading the whole store to
 * pick them out deserialised every whole list in it on every connect.
 */
export async function cacheGetAll(prefix, maxAgeMs = Infinity) {
  try {
    const db = await openDB();
    const { t } = tx(db, ['cache'], 'readonly');
    const store = t.objectStore('cache');
    const range = prefix ? prefixRange(prefix) : undefined;
    const keys = await request(store.getAllKeys(range));
    const rows = await request(store.getAll(range));
    const now = Date.now();
    const out = [];
    for (let i = 0; i < keys.length; i++) {
      if (maxAgeMs !== Infinity && now - rows[i].at > maxAgeMs) continue;
      out.push([String(keys[i]), rows[i].value]);
    }
    return out;
  } catch (err) {
    console.warn('[iptv] bulk cache read failed', prefix, err);
    return [];
  }
}

export async function cacheAge(key) {
  try {
    const db = await openDB();
    const { t } = tx(db, ['cache'], 'readonly');
    const row = await request(t.objectStore('cache').get(key));
    return row ? row.at : null;
  } catch {
    return null;
  }
}

/** Deletes keys that start with the prefix; without one, the whole cache. */
export async function cacheClear(prefix) {
  try {
    const db = await openDB();
    const { t, done } = tx(db, ['cache'], 'readwrite');
    const store = t.objectStore('cache');
    if (!prefix) store.clear();
    else store.delete(prefixRange(prefix));
    await done;
  } catch (err) {
    // Nothing to clear is no reason to stop a switch of account: the
    // catalogue keys name their account in any case.
    console.warn('[iptv] cache clear failed', prefix, err);
  }
}

/**
 * Deletes the rows whose time is up. ttlFor(key) says how long a row of
 * that key is good for, or null to keep it; a row past that is never read
 * again — every read asks for something fresher — and only takes space.
 * The 'at' index hands out each row's key and time without its value, so
 * the walk costs the keys rather than the megabytes behind them.
 *
 * @returns {Promise<number>} the rows deleted
 */
export async function cachePurge(ttlFor, now = Date.now()) {
  try {
    const db = await openDB();
    const { t, done } = tx(db, ['cache'], 'readwrite');
    const store = t.objectStore('cache');
    let deleted = 0;
    store.index('at').openKeyCursor().onsuccess = (e) => {
      const cursor = e.target.result;
      if (!cursor) return;
      const ttl = ttlFor(String(cursor.primaryKey));
      if (ttl != null && now - cursor.key > ttl) { store.delete(cursor.primaryKey); deleted++; }
      cursor.continue();
    };
    await done;
    return deleted;
  } catch (err) {
    console.warn('[iptv] cache purge failed', err);
    return 0;
  }
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
    // blocked = another tab is holding a connection open. Its
    // onversionchange closes it, and the deletion goes ahead then; the
    // caller should not wait for that.
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}

/** Storage granted by the browser, and how much of it is used. */
export async function storageEstimate() {
  if (!navigator.storage || !navigator.storage.estimate) return null;
  try { return await navigator.storage.estimate(); } catch { return null; }
}
