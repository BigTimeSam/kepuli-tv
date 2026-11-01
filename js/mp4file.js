// Reading an ordinary MP4 file's index (the moov box) into sample tables.
//
// Firefox will not let the extension hand an http:// film to <video>: an
// extension page is a secure context, and Firefox upgrades the audio,
// video and images such a page loads from http to https without falling
// back. A provider's port 8080 speaks no TLS, so the film fails to open —
// "Failed to open media" — while the same address plays in Chrome. fetch()
// is not upgraded, so the file is read here instead and fed to MediaSource
// (js/mp4play.js), the way js/remux.js feeds Matroska.
//
// An MP4 file is boxes: ftyp, moov (the index) and mdat (the media), the
// moov either before the mdat ("fast start") or after it. The moov holds,
// for every track, where each sample lies in the file, how big it is, its
// decode time and its composition offset, and which samples are sync
// samples (keyframes). Those tables are all that is needed to cut the
// mdat into samples and repackage them as fragments; the sample entry,
// codec configuration included, is passed on as it is (see initSegment).

/** A box's header at `at`: { type, size, header } or null if it does not fit. */
export function boxHeader(bytes, at) {
  if (at + 8 > bytes.length) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let size = view.getUint32(at);
  const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
  let header = 8;
  if (size === 1) {
    if (at + 16 > bytes.length) return null;
    size = view.getUint32(at + 8) * 4294967296 + view.getUint32(at + 12);
    header = 16;
  } else if (size === 0) {
    size = Infinity;              // runs to the end of the file
  }
  return { type, size, header };
}

/** The child boxes of a container, as { type, start, end, body } with body the payload offset. */
function children(bytes, start, end) {
  const out = [];
  let at = start;
  while (at + 8 <= end) {
    const h = boxHeader(bytes, at);
    if (!h || h.size < h.header) break;
    const stop = Math.min(end, at + h.size);
    out.push({ type: h.type, start: at, end: stop, body: at + h.header });
    at = stop;
  }
  return out;
}

const child = (bytes, parent, type) => children(bytes, parent.body, parent.end).find((c) => c.type === type) || null;

/**
 * The tracks of a moov box.
 *
 * @param {Uint8Array} bytes the whole moov box
 * @returns {{duration:number, tracks:object[]}} duration in seconds; each
 *   track { id, kind:'video'|'audio'|'other', format, codec, entry,
 *   timescale, width, height, count, offset, size, dts, cts, sync, shift }
 */
export function parseMoov(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const moov = { body: 8, end: bytes.length };
  const mvhd = child(bytes, moov, 'mvhd');
  let movieScale = 1000;
  let duration = 0;
  if (mvhd) {
    const v = bytes[mvhd.body];
    movieScale = view.getUint32(mvhd.body + (v === 1 ? 20 : 12));
    duration = v === 1
      ? view.getUint32(mvhd.body + 24) * 4294967296 + view.getUint32(mvhd.body + 28)
      : view.getUint32(mvhd.body + 16);
  }
  const tracks = [];
  // What the whole index may claim, across its tracks: a film has two or
  // three, and a file claiming hundreds of full ones is not allocated for.
  const budget = { samples: MAX_TOTAL_SAMPLES };
  const traks = children(bytes, moov.body, moov.end).filter((c) => c.type === 'trak');
  if (traks.length > MAX_TRACKS) throw new Error('the MP4 index is damaged (trak)');
  for (const trak of traks) {
    const track = parseTrak(bytes, view, trak, movieScale, budget);
    if (track) tracks.push(track);
  }
  return { duration: movieScale ? duration / movieScale : 0, tracks };
}

function parseTrak(bytes, view, trak, movieScale, budget) {
  const tkhd = child(bytes, trak, 'tkhd');
  const mdia = child(bytes, trak, 'mdia');
  if (!tkhd || !mdia) return null;
  const tv = bytes[tkhd.body];
  const id = view.getUint32(tkhd.body + (tv === 1 ? 20 : 12));
  const mdhd = child(bytes, mdia, 'mdhd');
  const hdlr = child(bytes, mdia, 'hdlr');
  const stbl = (() => {
    const minf = child(bytes, mdia, 'minf');
    return minf ? child(bytes, minf, 'stbl') : null;
  })();
  if (!mdhd || !hdlr || !stbl) return null;
  const mv = bytes[mdhd.body];
  const timescale = view.getUint32(mdhd.body + (mv === 1 ? 20 : 12));
  const handler = String.fromCharCode(...bytes.subarray(hdlr.body + 8, hdlr.body + 12));
  const kind = handler === 'vide' ? 'video' : handler === 'soun' ? 'audio' : 'other';

  const stsd = child(bytes, stbl, 'stsd');
  const first = stsd ? children(bytes, stsd.body + 8, stsd.end)[0] : null;
  if (!first || !timescale) return null;
  const entry = bytes.slice(first.start, first.end);
  const described = describeEntry(entry, kind);

  const tables = sampleTables(bytes, view, stbl, budget);
  if (!tables) return null;
  return {
    id, kind, timescale, entry, ...described, ...tables,
    shift: editShift(bytes, view, trak, timescale, movieScale),
  };
}

/**
 * How far the track's own times run ahead of its presentation, in the
 * track's timescale: the edit list's first media time — a video track with
 * B-frames starts its composition at two frames or so, an AAC track skips
 * its encoder priming — less an empty edit's delay at the start. Without
 * it the picture would run a few frames behind the sound.
 */
function editShift(bytes, view, trak, timescale, movieScale) {
  const edts = child(bytes, trak, 'edts');
  const elst = edts ? child(bytes, edts, 'elst') : null;
  if (!elst) return 0;
  const v = bytes[elst.body];
  const count = view.getUint32(elst.body + 4);
  let at = elst.body + 8;
  let delay = 0;
  for (let i = 0; i < count; i++) {
    const segment = v === 1 ? view.getUint32(at) * 4294967296 + view.getUint32(at + 4) : view.getUint32(at);
    const media = v === 1 ? view.getInt32(at + 8) * 4294967296 + view.getUint32(at + 12) : view.getInt32(at + 4);
    at += v === 1 ? 20 : 12;
    if (media === -1) { delay += segment; continue; }
    return media - Math.round((delay * timescale) / movieScale);
  }
  return 0;
}

// The most samples a track may claim. A three-hour film at 60 frames a
// second has some 650,000 pictures and its AAC sound some 500,000 frames;
// a file claiming more is broken or made to exhaust memory, and is not
// allocated for.
export const MAX_SAMPLES = 2_000_000;
const MAX_TOTAL_SAMPLES = 4_000_000;
const MAX_TRACKS = 32;

/** A table's entry count, checked against the box that holds it. */
function entries(view, box, at, width) {
  const n = view.getUint32(at);
  if (n > MAX_SAMPLES || at + 4 + n * width > box.end) throw new Error(`the MP4 index is damaged (${box.type})`);
  return n;
}

function sampleTables(bytes, view, stbl, budget) {
  const box = (type) => child(bytes, stbl, type);
  const stsz = box('stsz');
  const stz2 = box('stz2');
  const stco = box('stco') || box('co64');
  const stsc = box('stsc');
  const stts = box('stts');
  if ((!stsz && !stz2) || !stco || !stsc || !stts) return null;

  // Sizes.
  let count;
  let size;
  if (stsz) {
    const fixed = view.getUint32(stsz.body + 4);
    count = fixed ? view.getUint32(stsz.body + 8) : entries(view, stsz, stsz.body + 8, 4);
    if (count > MAX_SAMPLES) throw new Error('the MP4 index is damaged (stsz)');
    size = new Uint32Array(count);
    if (fixed) size.fill(fixed);
    else for (let i = 0; i < count; i++) size[i] = view.getUint32(stsz.body + 12 + i * 4);
  } else {
    const field = bytes[stz2.body + 7];
    if (field !== 4 && field !== 8 && field !== 16) throw new Error('the MP4 index is damaged (stz2)');
    count = entries(view, stz2, stz2.body + 8, field / 8);
    size = new Uint32Array(count);
    for (let i = 0; i < count; i++) {
      const at = stz2.body + 12;
      size[i] = field === 16 ? view.getUint16(at + i * 2)
        : field === 8 ? bytes[at + i] : (bytes[at + (i >> 1)] >> (i & 1 ? 0 : 4)) & 15;
    }
  }

  if (count > budget.samples) throw new Error('the MP4 index is damaged (too many samples)');
  budget.samples -= count;

  // Offsets, chunk by chunk.
  const wide = stco.type === 'co64';
  const chunks = entries(view, stco, stco.body + 4, wide ? 8 : 4);
  const chunkOffset = (c) => (wide
    ? view.getUint32(stco.body + 8 + c * 8) * 4294967296 + view.getUint32(stco.body + 12 + c * 8)
    : view.getUint32(stco.body + 8 + c * 4));
  const runs = entries(view, stsc, stsc.body + 4, 12);
  const offset = new Float64Array(count);
  let sample = 0;
  let previous = -1;
  for (let r = 0; r < runs && sample < count; r++) {
    const at = stsc.body + 8 + r * 12;
    const firstChunk = view.getUint32(at) - 1;
    const perChunk = view.getUint32(at + 4);
    // The runs follow one another through the chunk table and never past
    // it, so all of them together visit each chunk at most once: runs that
    // went back, or on for ever, would otherwise spin here.
    if (firstChunk <= previous) throw new Error('the MP4 index is damaged (stsc)');
    previous = firstChunk;
    if (firstChunk >= chunks) break;
    const lastChunk = Math.min(chunks, r + 1 < runs ? view.getUint32(at + 12) - 1 : chunks);
    for (let c = firstChunk; c < lastChunk && sample < count; c++) {
      let pos = chunkOffset(c);
      for (let k = 0; k < perChunk && sample < count; k++) {
        offset[sample] = pos;
        pos += size[sample];
        sample++;
      }
    }
  }
  if (sample < count) count = sample;

  // Decode times.
  const dts = new Float64Array(count);
  const duration = new Uint32Array(count);
  {
    const runs = entries(view, stts, stts.body + 4, 8);
    let t = 0;
    let i = 0;
    for (let e = 0; e < runs && i < count; e++) {
      const n = view.getUint32(stts.body + 8 + e * 8);
      const delta = view.getUint32(stts.body + 12 + e * 8);
      for (let k = 0; k < n && i < count; k++) { dts[i] = t; duration[i] = delta; t += delta; i++; }
    }
    for (; i < count; i++) { dts[i] = t; duration[i] = i ? duration[i - 1] : 1; t += duration[i]; }
  }

  // Composition offsets.
  const cts = new Int32Array(count);
  const ctts = box('ctts');
  if (ctts) {
    const v = bytes[ctts.body];
    const runs = entries(view, ctts, ctts.body + 4, 8);
    let i = 0;
    for (let e = 0; e < runs && i < count; e++) {
      const n = view.getUint32(ctts.body + 8 + e * 8);
      const value = v === 1 ? view.getInt32(ctts.body + 12 + e * 8) : view.getUint32(ctts.body + 12 + e * 8) | 0;
      for (let k = 0; k < n && i < count; k++) cts[i++] = value;
    }
  }

  // Sync samples; without the table every sample is one.
  let sync = null;
  const stss = box('stss');
  if (stss) {
    sync = new Uint8Array(count);
    const marks = entries(view, stss, stss.body + 4, 4);
    for (let e = 0; e < marks; e++) {
      const n = view.getUint32(stss.body + 8 + e * 4) - 1;
      if (n >= 0 && n < count) sync[n] = 1;
    }
  }
  return {
    count, size: count < size.length ? size.subarray(0, count) : size,
    offset: offset.subarray(0, count), dts: dts.subarray(0, count), duration: duration.subarray(0, count),
    cts: cts.subarray(0, count), sync: sync && sync.subarray(0, count),
  };
}

/* ------------------------------------------------------------- codecs */

/**
 * The format and the codecs string MediaSource is asked about, from the
 * sample entry: { format, codec, width, height, channels, rate }.
 */
export function describeEntry(entry, kind) {
  const format = String.fromCharCode(entry[4], entry[5], entry[6], entry[7]);
  const view = new DataView(entry.buffer, entry.byteOffset, entry.byteLength);
  if (kind === 'video') {
    const width = view.getUint16(32);
    const height = view.getUint16(34);
    const boxes = children(entry, 86, entry.length);
    const find = (t) => boxes.find((b) => b.type === t);
    let codec = null;
    const avcC = find('avcC');
    const hvcC = find('hvcC');
    if ((format === 'avc1' || format === 'avc3') && avcC) {
      const hex = (b) => b.toString(16).padStart(2, '0');
      codec = `${format}.${hex(entry[avcC.body + 1])}${hex(entry[avcC.body + 2])}${hex(entry[avcC.body + 3])}`;
    } else if ((format === 'hvc1' || format === 'hev1') && hvcC) {
      codec = hevcCodec(format, entry.subarray(hvcC.body, hvcC.end));
    } else if (format === 'av01') {
      codec = 'av01.0.08M.08';
    } else if (format === 'vp09') {
      codec = 'vp09.00.10.08';
    }
    return { format, codec, width, height };
  }
  if (kind === 'audio') {
    // A QuickTime sound description of version 1 or 2 is longer before its
    // boxes begin.
    const version = view.getUint16(16);
    const start = 36 + (version === 1 ? 16 : version === 2 ? 36 : 0);
    const channels = view.getUint16(24);
    const rate = view.getUint32(32) >>> 16;
    const boxes = children(entry, start, entry.length);
    let codec = null;
    if (format === 'mp4a') {
      const esds = boxes.find((b) => b.type === 'esds');
      codec = esds ? aacCodec(entry.subarray(esds.body + 4, esds.end)) : 'mp4a.40.2';
    } else if (format === 'Opus') codec = 'opus';
    else if (format === 'fLaC') codec = 'flac';
    else if (format === 'ac-3') codec = 'ac-3';
    else if (format === 'ec-3') codec = 'ec-3';
    else if (format === '.mp3') codec = 'mp3';
    return { format, codec, channels, rate };
  }
  return { format, codec: null };
}

/** mp4a.40.<object type> from the esds descriptors; mp3 in MP4 is mp4a.6B. */
function aacCodec(es) {
  let at = 0;
  const length = () => {
    let n = 0;
    for (let i = 0; i < 4 && at < es.length; i++) {
      const b = es[at++];
      n = (n << 7) | (b & 0x7f);
      if (!(b & 0x80)) break;
    }
    return n;
  };
  if (es[at++] !== 0x03) return 'mp4a.40.2';
  length();
  const flags = es[at + 2];
  at += 3;
  if (flags & 0x80) at += 2;
  if (flags & 0x40) at += 1 + es[at];
  if (flags & 0x20) at += 2;
  if (es[at++] !== 0x04) return 'mp4a.40.2';
  length();
  const objectType = es[at];
  at += 13;
  if (objectType === 0x6b || objectType === 0x69) return 'mp3';
  if (objectType !== 0x40) return `mp4a.${objectType.toString(16)}`;
  if (es[at++] !== 0x05) return 'mp4a.40.2';
  length();
  let aot = es[at] >> 3;
  if (aot === 31) aot = 32 + (((es[at] & 7) << 3) | (es[at + 1] >> 5));
  return `mp4a.40.${aot || 2}`;
}

/** The RFC 6381 codecs string of an HEVC track, from its hvcC. */
function hevcCodec(format, c) {
  const space = ['', 'A', 'B', 'C'][c[1] >> 6];
  const tier = (c[1] >> 5) & 1 ? 'H' : 'L';
  const profile = c[1] & 0x1f;
  let compat = ((c[2] << 24) | (c[3] << 16) | (c[4] << 8) | c[5]) >>> 0;
  // The compatibility flags are written in reverse bit order.
  let reversed = 0;
  for (let i = 0; i < 32; i++) { reversed = (reversed << 1) | (compat & 1); compat >>>= 1; }
  const constraints = [...c.subarray(6, 12)];
  while (constraints.length && constraints[constraints.length - 1] === 0) constraints.pop();
  const level = c[12];
  return [`${format}.${space}${profile}`, (reversed >>> 0).toString(16), `${tier}${level}`,
    ...constraints.map((b) => b.toString(16))].join('.');
}
