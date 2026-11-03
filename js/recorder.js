// Recording a live channel to the browser's own storage.
//
// A recording is the channel's stream as the provider sends it, written to
// the origin private file system (OPFS) of the extension: MPEG-TS as it
// comes for a TS channel, the segments one after another for an HLS one.
// Nothing is re-encoded, so a recording takes no more processor than
// watching does, and the file plays in VLC or any other player as it is.
//
// The stream is written in parts of a few megabytes, each closed as soon as
// it is full or ten seconds old: an open file is committed only when it is
// closed, and a tab that crashes or is closed mid-recording keeps all but
// the last few seconds. The parts of a recording, read in order, are the
// file; Save hands them to the browser as one Blob, which stays on disk.
//
// A recording of the channel on screen shares the player's connection
// (js/streamhub.js): an account that allows one connection can record
// what it shows. A connection that drops is opened again — with a new
// address where the source gives one per connection (Stalker) — until the
// recording's end; the gap is a jump in the file, which players step over.
//
// The list of recordings, and the ones planned, is in storage.local under
// "recordings", one entry each. It is the computer's own and never synced:
// the files are here, and a plan is carried out by an open player here.
// Every change goes through a lock, since several tabs may hold the list.
// A recording is made by one tab only: it holds a lock of its own for the
// recording while it runs, and a tab that finds the lock taken leaves it
// be. One whose tab went away is marked incomplete by the next to open.

import { api } from './browser.js';
import { tap } from './streamhub.js';

const KEY = 'recordings';
const PART_BYTES = 4 * 1024 * 1024;
const PART_MS = 10000;
// A connection that keeps failing is given up after this many tries in a
// row, a minute or so of them at the longest pause.
const MAX_FAILURES = 30;
// A recording with no end is stopped after this, so that a forgotten one
// does not fill the disk.
export const OPEN_ENDED_MS = 6 * 3600e3;
// A planned recording starts this much before the programme and ends this
// much after it: the guide's times are seldom to the minute.
export const PAD_BEFORE_MS = 60e3;
export const PAD_AFTER_MS = 3 * 60e3;

const sleep = (ms, signal) => new Promise((resolve) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
});

/* ------------------------------------------------------------- the list */

/** Whether this browser can keep recordings: OPFS with writable files. */
export async function recordingSupported() {
  try {
    const root = await navigator.storage.getDirectory();
    return typeof root.getDirectoryHandle === 'function' && 'createWritable' in FileSystemFileHandle.prototype;
  } catch {
    return false;
  }
}

export async function loadRecordings() {
  const data = await api.storage.local.get(KEY);
  return Array.isArray(data[KEY]) ? data[KEY] : [];
}

/** The list changed under the lock: fn gets the list and returns the new one. */
export async function changeRecordings(fn) {
  const run = async () => {
    const list = await loadRecordings();
    const next = await fn(list.slice());
    if (next) await api.storage.local.set({ [KEY]: next });
    return next || list;
  };
  return navigator.locks ? navigator.locks.request('kepuli-recordings', run) : run();
}

export const patchRecording = (id, patch) => changeRecordings((list) => list.map((r) => (r.id === id ? { ...r, ...patch } : r)));

export function watchRecordings(onChange) {
  api.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[KEY]) onChange(changes[KEY].newValue || []);
  });
}

export const newRecordingId = () => `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/* -------------------------------------------------------------- the files */

async function folder(id, create = false) {
  const root = await navigator.storage.getDirectory();
  const all = await root.getDirectoryHandle('recordings', { create: true });
  return all.getDirectoryHandle(id, { create });
}

async function writePart(id, index, chunks) {
  const dir = await folder(id, true);
  const handle = await dir.getFileHandle(`${String(index).padStart(6, '0')}.part`, { create: true });
  const writable = await handle.createWritable();
  try {
    for (const chunk of chunks) await writable.write(chunk);
    await writable.close();
  } catch (err) {
    await writable.abort().catch(() => {});
    throw err;
  }
}

/** The recording as one Blob: its parts, in order, read from disk as needed. */
export async function recordingBlob(id, type = 'video/mp2t') {
  const dir = await folder(id);
  const parts = [];
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === 'file' && name.endsWith('.part')) parts.push([name, handle]);
  }
  parts.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const files = await Promise.all(parts.map(([, handle]) => handle.getFile()));
  return new Blob(files, { type });
}

export async function deleteRecordingFiles(id) {
  try {
    const root = await navigator.storage.getDirectory();
    const all = await root.getDirectoryHandle('recordings', { create: true });
    await all.removeEntry(id, { recursive: true });
  } catch (err) {
    if (err?.name !== 'NotFoundError') throw err;
  }
}

/** "Uutiset – Yle TV1 2026-11-03 20.00.ts", with nothing a file system refuses. */
export function recordingFileName(entry) {
  const d = new Date(entry.startedAt || entry.start || Date.now());
  const p = (n) => String(n).padStart(2, '0');
  const when = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}`;
  const name = [entry.title, entry.channel?.displayName || entry.channel?.n].filter(Boolean).join(' – ');
  const safe = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Kepuli-TV';
  return `${safe} ${when}.${entry.ext || 'ts'}`;
}

/* ------------------------------------------------------------------ HLS */

/**
 * An HLS playlist read: a master's variants, or a media playlist's
 * segments with their sequence numbers, its initialisation section and
 * whether it has ended.
 */
export function parseHlsPlaylist(text, base) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim());
  const abs = (uri) => { try { return new URL(uri, base).href; } catch { return uri; } };
  const out = { variants: [], segments: [], target: 6, map: null, ended: false };
  let sequence = 0;
  let pendingVariant = null;
  let segmentSeen = false;
  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      pendingVariant = { bandwidth: Number(/BANDWIDTH=(\d+)/i.exec(line)?.[1]) || 0 };
    } else if (line.startsWith('#EXT-X-TARGETDURATION:')) {
      out.target = Number(line.slice(22)) || 6;
    } else if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      sequence = Number(line.slice(22)) || 0;
    } else if (line.startsWith('#EXT-X-MAP:')) {
      const uri = /URI="([^"]+)"/i.exec(line)?.[1];
      if (uri) out.map = abs(uri);
    } else if (line.startsWith('#EXT-X-ENDLIST')) {
      out.ended = true;
    } else if (line.startsWith('#EXTINF:')) {
      segmentSeen = true;
    } else if (!line.startsWith('#')) {
      if (pendingVariant) { out.variants.push({ ...pendingVariant, uri: abs(line) }); pendingVariant = null; }
      else if (segmentSeen) { out.segments.push({ uri: abs(line), seq: sequence++ }); segmentSeen = false; }
    }
  }
  out.variants.sort((a, b) => b.bandwidth - a.bandwidth);
  return out;
}

const looksHls = (url, type = '') => /\.m3u8?($|\?)/i.test(url) || /mpegurl/i.test(type);

/* ------------------------------------------------------------ recording */

class Job {
  constructor(entry, { key, openUrl, fallbackUrl, onProgress }) {
    this.entry = entry;
    this.id = entry.id;
    this.key = key;
    this.openUrl = openUrl;
    this.fallbackUrl = fallbackUrl || null;
    this.onProgress = onProgress;
    this.ctrl = new AbortController();
    this.chunks = [];
    this.chunkBytes = 0;
    this.bytes = 0;
    this.parts = 0;
    this.partAt = Date.now();
    this.writing = Promise.resolve();
    this.error = null;
    this.ext = 'ts';
    this.stopped = false;
    this.finishedBy = null;      // 'user' | 'end' | 'error'
  }

  add(chunk) {
    if (this.stopped) return;
    this.chunks.push(chunk);
    this.chunkBytes += chunk.byteLength;
    this.bytes += chunk.byteLength;
    if (this.chunkBytes >= PART_BYTES || Date.now() - this.partAt >= PART_MS) this.flush();
  }

  flush() {
    if (!this.chunks.length) return this.writing;
    const chunks = this.chunks;
    const index = this.parts++;
    this.chunks = [];
    this.chunkBytes = 0;
    this.partAt = Date.now();
    this.writing = this.writing.then(() => writePart(this.id, index, chunks)).then(() => {
      this.onProgress?.(this);
    }, (err) => {
      // A full disk ends the recording; what was written stays.
      console.warn('[iptv] writing the recording failed', err);
      this.error = err;
      this.stop('error');
    });
    return this.writing;
  }

  stop(by = 'user') {
    if (this.stopped) return;
    this.stopped = true;
    this.finishedBy = by;
    this.ctrl.abort();
    if (this.closeTap) this.closeTap();
  }
}

/**
 * The recordings this tab is making. onChange(job) is called when one
 * starts, writes a part and ends.
 */
export class Recorder {
  constructor({ onChange = () => {} } = {}) {
    this.jobs = new Map();
    this.onChange = onChange;
  }

  isRecording(id) { return this.jobs.has(id); }

  /** The recording of a channel, if this tab is making one: by the hub key. */
  jobFor(key) { return [...this.jobs.values()].find((j) => j.key === key) || null; }

  /**
   * Starts a recording entry already in the list. False when another tab
   * is making it.
   * @param {object} entry the list's entry, with id and stop (or null)
   * @param {{ key: string, openUrl: () => Promise<string>, fallbackUrl?: string }} how
   */
  start(entry, how) {
    if (this.jobs.has(entry.id)) return Promise.resolve(true);
    const job = new Job(entry, { ...how, onProgress: (j) => this.progress(j) });
    if (!navigator.locks) { this.run(job); return Promise.resolve(true); }
    return new Promise((resolve) => {
      navigator.locks.request(`kepuli-rec:${entry.id}`, { ifAvailable: true }, async (lock) => {
        if (!lock) { resolve(false); return; }
        resolve(true);
        await this.run(job);
      });
    });
  }

  stop(id) {
    const job = this.jobs.get(id);
    if (job) job.stop('user');
  }

  /** Every recording this tab makes, stopped — the page is going. */
  stopAll() { for (const job of this.jobs.values()) job.stop('user'); }

  async progress(job) {
    await patchRecording(job.id, { bytes: job.bytes, ext: job.ext });
    this.onChange(job);
  }

  async run(job) {
    this.jobs.set(job.id, job);
    const startedAt = Date.now();
    await patchRecording(job.id, { state: 'recording', startedAt, bytes: 0, reason: null });
    this.onChange(job);
    const stopAt = job.entry.stop || startedAt + OPEN_ENDED_MS;
    const timer = setTimeout(() => job.stop('end'), Math.max(0, stopAt - Date.now()));
    let failures = 0;
    // TS through the shared connection first; the address tells when the
    // channel is HLS (readTs).
    let mode = 'ts';
    let hlsUrl = null;
    while (!job.stopped && Date.now() < stopAt) {
      const before = job.bytes;
      try {
        if (mode === 'ts') {
          const switched = await this.readTs(job);
          if (switched) { mode = 'hls'; hlsUrl = switched; continue; }
        } else {
          await this.readHls(job, hlsUrl || (await job.openUrl()), stopAt);
        }
      } catch (err) {
        if (err?.name !== 'AbortError') {
          job.lastError = err?.message || String(err);
          console.warn('[iptv] the recording\'s connection failed', err);
          // An Xtream channel the server will not give as TS may still
          // come as HLS, as the player falls back to it.
          if (mode === 'ts' && err?.status && job.fallbackUrl && failures >= 1) { mode = 'hls'; hlsUrl = job.fallbackUrl; }
          // A source's address may be good for one connection: asked again.
          else if (mode === 'hls' && hlsUrl !== job.fallbackUrl) hlsUrl = null;
        }
      }
      if (job.stopped || Date.now() >= stopAt) break;
      failures = job.bytes > before ? 0 : failures + 1;
      if (failures >= MAX_FAILURES) { job.stop('error'); break; }
      await sleep(Math.min(15000, 1000 * 2 ** Math.min(failures, 4)), job.ctrl.signal);
    }
    clearTimeout(timer);
    if (!job.stopped) job.stop('end');
    await job.flush();
    await job.writing;
    this.jobs.delete(job.id);
    const state = job.bytes === 0 ? 'failed' : job.finishedBy === 'error' ? 'partial' : 'done';
    const reason = job.error ? (job.error.name === 'QuotaExceededError' ? 'quota' : job.error.message) : state === 'failed' ? job.lastError || null : null;
    await patchRecording(job.id, { state, bytes: job.bytes, ext: job.ext, endedAt: Date.now(), reason });
    this.onChange(job);
  }

  /**
   * One connection's worth of a TS stream, through the shared connection.
   * Resolves when it ends; with an address when the stream is HLS after all.
   */
  async readTs(job) {
    let ended;
    const done = new Promise((resolve) => { ended = resolve; });
    const handle = await tap(job.key, job.openUrl, {
      onData: (chunk) => job.add(chunk),
      onEnd: (err) => ended(err),
    });
    job.closeTap = handle.close;
    if (job.stopped) { handle.close(); return null; }
    if (looksHls(handle.url, handle.head.type)) { handle.close(); return handle.url; }
    if (!handle.head.ok) {
      const err = new Error(`HTTP ${handle.head.status}`);
      err.status = handle.head.status;
      throw err;
    }
    const abort = new Promise((resolve) => job.ctrl.signal.addEventListener('abort', resolve, { once: true }));
    const err = await Promise.race([done, abort]);
    handle.close();
    job.closeTap = null;
    if (err) throw err;
    return null;
  }

  /** An HLS stream, segment by segment, until it ends or the recording does. */
  async readHls(job, url, stopAt) {
    const signal = job.ctrl.signal;
    let last = -1;
    let mapped = false;
    let playlistUrl = url;
    while (!job.stopped && Date.now() < stopAt) {
      const res = await fetch(playlistUrl, { signal, cache: 'no-store', credentials: 'omit' });
      if (!res.ok) { const err = new Error(`HTTP ${res.status}`); err.status = res.status; throw err; }
      const list = parseHlsPlaylist(await res.text(), res.url || playlistUrl);
      if (list.variants.length) { playlistUrl = list.variants[0].uri; continue; }
      if (list.map && !mapped) {
        const init = await fetch(list.map, { signal, credentials: 'omit' });
        if (!init.ok) throw new Error(`HTTP ${init.status}`);
        job.ext = 'mp4';
        job.add(new Uint8Array(await init.arrayBuffer()));
        mapped = true;
      }
      // A sequence that starts again from below is a new stream: all of it is new.
      if (list.segments.length && list.segments[list.segments.length - 1].seq < last) last = -1;
      for (const segment of list.segments) {
        if (segment.seq <= last || job.stopped) continue;
        const seg = await fetch(segment.uri, { signal, credentials: 'omit' });
        if (!seg.ok) { last = segment.seq; continue; }
        job.add(new Uint8Array(await seg.arrayBuffer()));
        last = segment.seq;
      }
      if (list.ended) return;
      await sleep(Math.max(1000, list.target * 500), signal);
    }
  }
}

/**
 * The recordings a tab that went away left marked as running: incomplete
 * now, unless a tab still holds the lock of one.
 */
export async function settleOrphans() {
  const held = new Set();
  if (navigator.locks?.query) {
    const { held: locks = [] } = await navigator.locks.query();
    for (const lock of locks) if (lock.name.startsWith('kepuli-rec:')) held.add(lock.name.slice(11));
  }
  return changeRecordings((list) => {
    let changed = false;
    const next = list.map((r) => {
      if (r.state !== 'recording' || held.has(r.id)) return r;
      changed = true;
      return { ...r, state: r.bytes ? 'partial' : 'failed', endedAt: r.endedAt || Date.now(), reason: r.reason || 'closed' };
    });
    return changed ? next : null;
  });
}
