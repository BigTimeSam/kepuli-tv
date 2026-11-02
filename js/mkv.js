// Demuxing Matroska clusters from a stream.
//
// The file is not loaded into memory: the bytes arrive from the network a
// chunk at a time and the parser waits for them when it needs them. A pull
// model (need/read) is clearly simpler here than a push state machine,
// because the size of an EBML element is known only once its header has
// been read.
//
// A cluster's block holds one or more frames. More than one comes from
// "lacing", which is used for audio almost always: an AAC frame is 1024
// samples, around 21 ms, so several are bundled into the same block. All
// three lacing forms have to be implemented, or the audio breaks up at
// random.

import { ID, Reader } from './ebml.js';

/** A buffer that waits for bytes until there are enough of them. */
export class BufferedBytes {
  constructor() {
    this.chunks = [];
    this.offset = 0;          // how far into the first chunk we have read
    this.available = 0;
    this.position = 0;        // bytes from the start, for seek bookkeeping
    this.done = false;
    this.waiter = null;
    this.failure = null;
    this.wanted = 0;          // what need() is waiting for, see hasRoom
  }

  push(chunk) {
    if (!chunk || !chunk.byteLength) return;
    this.chunks.push(chunk);
    this.available += chunk.byteLength;
    this.wake();
  }

  end() { this.done = true; this.wake(); }

  fail(err) { this.failure = err; this.done = true; this.wake(); }

  wake() {
    const waiter = this.waiter;
    this.waiter = null;
    if (waiter) waiter();
  }

  /** Waits until n bytes are available. False = the stream ended early. */
  async need(n) {
    this.wanted = n;
    while (this.available < n && !this.done) {
      await new Promise((resolve) => { this.waiter = resolve; });
    }
    this.wanted = 0;
    // The bytes that already arrived are consumed before the error is
    // reported: they are valid however the connection ended, and the parser
    // always trails the reader. Without this, a drop would discard even the
    // part of the buffer it had not yet got to.
    if (this.available >= n) return true;
    if (this.failure) throw this.failure;
    return false;
  }

  /**
   * Whether the reader may push more. The limit is the reader's own cap on
   * bytes buffered ahead of the parser. A wait for more than the cap
   * overrides it: otherwise a block larger than the cap could never be
   * gathered whole, and the two sides would wait for each other for good.
   */
  hasRoom(limit) { return this.available < Math.max(limit, this.wanted); }

  peek(i) {
    let index = this.offset + i;
    for (const chunk of this.chunks) {
      if (index < chunk.byteLength) return chunk[index];
      index -= chunk.byteLength;
    }
    return undefined;
  }

  read(n) {
    const out = new Uint8Array(n);
    let written = 0;
    while (written < n) {
      const chunk = this.chunks[0];
      const take = Math.min(chunk.byteLength - this.offset, n - written);
      out.set(chunk.subarray(this.offset, this.offset + take), written);
      written += take;
      this.offset += take;
      if (this.offset >= chunk.byteLength) { this.chunks.shift(); this.offset = 0; }
    }
    this.available -= n;
    this.position += n;
    return out;
  }

  /**
   * Skips ahead to the next place the four bytes `pattern` start, without
   * consuming them; up to `limit` bytes. Resolves to the bytes skipped, or
   * null when the stream ended or the limit was reached first. Scans the
   * chunks as they are rather than byte by byte through peek(), since a
   * damaged stretch of a file runs to megabytes.
   */
  async scanTo(pattern, limit) {
    let skipped = 0;
    for (;;) {
      if (!await this.need(4)) return null;
      const chunk = this.chunks[0];
      let found = -1;
      for (let i = this.offset; i < chunk.byteLength; i++) {
        if (chunk[i] !== pattern[0]) continue;
        const at = i - this.offset;
        if (!await this.need(at + 4)) return null;
        if (this.peek(at + 1) === pattern[1] && this.peek(at + 2) === pattern[2] && this.peek(at + 3) === pattern[3]) { found = at; break; }
      }
      const step = found >= 0 ? found : chunk.byteLength - this.offset;
      if (skipped + step > limit) return null;
      if (step) this.skip(step);
      skipped += step;
      if (found >= 0) return skipped;
    }
  }

  skip(n) {
    let left = n;
    while (left > 0) {
      const chunk = this.chunks[0];
      const take = Math.min(chunk.byteLength - this.offset, left);
      left -= take;
      this.offset += take;
      if (this.offset >= chunk.byteLength) { this.chunks.shift(); this.offset = 0; }
    }
    this.available -= n;
    this.position += n;
  }
}

async function readVint(bytes, keepMarker) {
  if (!await bytes.need(1)) return null;
  const first = bytes.peek(0);
  let len = 1;
  for (let mask = 0x80; mask && !(first & mask); mask >>= 1) len++;
  if (len > 8) return null;
  if (!await bytes.need(len)) return null;
  const raw = bytes.read(len);
  const strip = 0xff >> len;
  let value = keepMarker ? raw[0] : (raw[0] & strip);
  let unknown = (raw[0] & strip) === strip;
  for (let i = 1; i < len; i++) {
    if (raw[i] !== 0xff) unknown = false;
    value = value * 256 + raw[i];
  }
  return { value, len, unknown: !keepMarker && unknown };
}

async function readElement(bytes) {
  const id = await readVint(bytes, true);
  if (!id) return null;
  const size = await readVint(bytes, false);
  if (!size) return null;
  return { id: id.value, size: size.value, unknown: size.unknown };
}

// The elements we descend into: their children are handled in the same
// loop. Everything else is skipped by its size.
const DESCEND = new Set([ID.Segment, ID.Cluster]);

/**
 * Frames from the clusters. Stops when the stream ends.
 *
 * @param {BufferedBytes} bytes
 * @param {{timestampScale:number, tracks:Map<number,object>, onCluster?:Function,
 *          onStop?:(reason:string, position:number)=>void}} opts
 * @yields {{track:number, pts:number, duration:number|null, keyframe:boolean, data:Uint8Array}}
 *         pts and duration in nanoseconds from the start of the file
 */
export async function* frames(bytes, { timestampScale, tracks, onCluster, onStop, onResync }) {
  // Demuxing can end early for several reasons, and they must be told
  // apart: the stream running out is normal, whereas an invalid id says the
  // parser has lost its place and resuming from there will not help.
  const stop = (reason) => { if (onStop) onStop(reason, bytes.position); };
  let clusterTs = 0;
  for (;;) {
    // Record where the cluster starts before reading the header: an
    // interrupted download resumes at an element boundary, not mid-element.
    const at = bytes.position;
    const el = await readElement(bytes);
    if (!el) {
      if (bytes.done && !bytes.available) { stop('stream ended'); return; }
      // Bytes that are no element mid-file: a stretch of the file damaged
      // or missing — measured, a provider's copy of a film had 8 MiB of
      // zeros 8 MB in. The next cluster is found and reading goes on from
      // it, as VLC and ffmpeg do, rather than the film ending there.
      if (await resync(bytes, at, onResync)) continue;
      stop(bytes.done ? 'stream ended' : 'invalid id or size');
      return;
    }

    if (DESCEND.has(el.id)) {
      if (el.id === ID.Cluster && onCluster) onCluster(at);
      continue;
    }

    if (el.id === ID.Timestamp) {
      if (!await bytes.need(el.size)) { stop('stream ended mid-timestamp'); return; }
      clusterTs = new Reader(bytes.read(el.size)).uint(el.size);
      continue;
    }

    if (el.id === ID.SimpleBlock || el.id === ID.BlockGroup) {
      if (el.size > MAX_BLOCK) {
        if (await resync(bytes, at, onResync)) continue;
        stop(`unreasonable block of ${el.size} bytes`);
        return;
      }
      if (!await bytes.need(el.size)) { stop('stream ended mid-block'); return; }
      const raw = bytes.read(el.size);
      const parsed = el.id === ID.SimpleBlock
        ? block(raw, { simple: true })
        : blockGroup(raw);
      if (parsed) yield* expand(parsed, clusterTs, timestampScale, tracks);
      continue;
    }

    if (el.unknown) continue;                 // unknown size: cannot be skipped
    if (!await skipBytes(bytes, el.size)) { stop(`stream ended while skipping ${el.size} bytes`); return; }
  }
}

// How far ahead a damaged stretch is searched for the next cluster. A
// cluster is a few seconds of film, a few megabytes; a gap longer than this
// is a file that is broken rather than holed.
const MAX_RESYNC = 64 * 1024 * 1024;
const CLUSTER_ID = [0x1f, 0x43, 0xb6, 0x75];

/**
 * Reading moved on to the next cluster after bytes that are no element.
 * A cluster's id alone could turn up in a picture's data, so it counts only
 * when a plausible size follows and then the cluster's Timestamp (0xE7) or
 * the CRC-32 (0xBF) that may come before it, as the first child of a
 * cluster is. Resolves to whether one was found;
 * onResync hears where the damage began and how much was skipped.
 */
async function resync(bytes, from, onResync) {
  // Back where the element that failed began is no longer possible — its
  // bytes are read — but the search starts from here, a byte on.
  let skipped = bytes.position - from;
  for (;;) {
    const step = await bytes.scanTo(CLUSTER_ID, MAX_RESYNC - skipped);
    if (step == null) return false;
    skipped += step;
    if (!await bytes.need(5)) return false;
    const first = bytes.peek(4);
    let len = 1;
    for (let mask = 0x80; mask && !(first & mask); mask >>= 1) len++;
    // The first child is the Timestamp, or a CRC-32 (0xBF) before it, which
    // ffmpeg writes into every cluster.
    if (len <= 8 && await bytes.need(4 + len + 1) && (bytes.peek(4 + len) === 0xe7 || bytes.peek(4 + len) === 0xbf)) {
      if (onResync) onResync(from, skipped);
      return true;
    }
    bytes.skip(1);
    skipped++;
  }
}

// A skipped element is dropped a piece at a time, so that the buffer never
// has to hold it whole. An Attachments element before the first cluster —
// the fonts of an anime release, a cover — can run to tens of megabytes,
// more than the reader buffers ahead, and gathering it whole would wait for
// bytes that never come.
const SKIP_CHUNK = 1024 * 1024;

async function skipBytes(bytes, n) {
  let left = n;
  while (left > 0) {
    const take = Math.min(left, SKIP_CHUNK);
    if (!await bytes.need(take)) return false;
    bytes.skip(take);
    left -= take;
  }
  return true;
}

// In practice a single block is at most a few megabytes. A number larger
// than this means the parser has landed in the wrong place, and the buffer
// should not be grown without limit on the strength of it.
const MAX_BLOCK = 32 * 1024 * 1024;

/** A SimpleBlock, or the Block inside a BlockGroup. */
function block(raw, { simple, keyframe = null, duration = null }) {
  const r = new Reader(raw);
  const track = r.vint(false);
  if (!track) return null;
  if (r.p + 3 > raw.length) return null;
  const view = new DataView(raw.buffer, raw.byteOffset + r.p, 2);
  const relative = view.getInt16(0);
  r.p += 2;
  const flags = raw[r.p++];
  const payload = raw.subarray(r.p);
  return {
    track: track.value,
    relative,
    keyframe: simple ? Boolean(flags & 0x80) : keyframe,
    lacing: (flags & 0x06) >> 1,
    duration,
    frames: lace(payload, (flags & 0x06) >> 1),
  };
}

function blockGroup(raw) {
  const r = new Reader(raw);
  let inner = null;
  let duration = null;
  let referenced = false;
  while (r.p < raw.length) {
    const id = r.vint(true);
    if (!id) break;
    const size = r.vint(false);
    if (!size) break;
    const start = r.p;
    if (id.value === ID.Block) inner = raw.subarray(start, start + size.value);
    else if (id.value === ID.BlockDuration) duration = r.uint(size.value);
    else if (id.value === ID.ReferenceBlock) referenced = true;
    r.p = start + size.value;
  }
  if (!inner) return null;
  // A BlockGroup has no keyframe flag: a frame is a keyframe when it
  // references nothing else.
  return block(inner, { simple: false, keyframe: !referenced, duration });
}

/** A block's contents as frames. Three lacing forms, see the Matroska spec. */
function lace(payload, mode) {
  if (mode === 0) return [payload];
  if (!payload.length) return [];
  const count = payload[0] + 1;
  let p = 1;
  const sizes = [];

  if (mode === 2) {                                     // fixed
    const each = Math.floor((payload.length - 1) / count);
    for (let i = 0; i < count; i++) sizes.push(each);
  } else if (mode === 1) {                              // Xiph
    for (let i = 0; i < count - 1; i++) {
      let size = 0;
      for (;;) {
        const byte = payload[p++];
        if (byte === undefined) return [];
        size += byte;
        if (byte !== 255) break;
      }
      sizes.push(size);
    }
  } else {                                              // EBML
    const r = new Reader(payload, p);
    const first = r.vint(false);
    if (!first) return [];
    sizes.push(first.value);
    for (let i = 1; i < count - 1; i++) {
      const delta = r.vint(false);
      if (!delta) return [];
      // Signed: half of the vint's value range is negative.
      const bias = Math.pow(2, 7 * delta.len - 1) - 1;
      sizes.push(sizes[i - 1] + (delta.value - bias));
    }
    p = r.p;
  }

  const out = [];
  for (const size of sizes) {
    if (p + size > payload.length) return out;
    out.push(payload.subarray(p, p + size));
    p += size;
  }
  if (mode !== 2) out.push(payload.subarray(p));        // the last one takes the rest
  return out.filter((f) => f.length);
}

/** Lohkon kehykset aikaleimoineen. */
function* expand(parsed, clusterTs, timestampScale, tracks) {
  const track = tracks.get(parsed.track);
  if (!track) return;
  const base = (clusterTs + parsed.relative) * timestampScale;
  // Laced frames share the block's timestamp: they are spread apart by the
  // track's default duration, so the audio does not pile up in one instant.
  const step = track.defaultDuration
    || (parsed.duration ? (parsed.duration * timestampScale) / parsed.frames.length : 0);
  let index = 0;
  for (const data of parsed.frames) {
    yield {
      track: parsed.track,
      pts: base + index * step,
      duration: step || null,
      keyframe: parsed.keyframe !== false,
      data,
    };
    index++;
  }
}
