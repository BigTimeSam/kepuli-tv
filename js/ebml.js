// EBML and Matroska primitives. Shared by the header reader (probe.js) and
// the demuxer (mkv.js).
//
// EBML is nested elements: an id (vint, length marker included) + a size
// (vint, length marker removed) + data. The size of the Segment is often
// unknown — all bits set — in which case the content runs to the end of the
// file.
//
// Everything in this file works on a buffer that is already in hand. The
// clusters are demuxed in mkv.js, which reads bytes as they arrive.

export const ID = {
  // top level
  EBML: 0x1a45dfa3, Segment: 0x18538067,
  SeekHead: 0x114d9b74, Seek: 0x4dbb, SeekID: 0x53ab, SeekPosition: 0x53ac,
  Info: 0x1549a966, Tracks: 0x1654ae6b, Cues: 0x1c53bb6b,
  Cluster: 0x1f43b675, Attachments: 0x1941a469, Tags: 0x1254c367, Chapters: 0x1043a770,
  Void: 0xec, CRC32: 0xbf,
  // Info
  TimestampScale: 0x2ad7b1, Duration: 0x4489, MuxingApp: 0x4d80, WritingApp: 0x5741,
  // Tracks
  TrackEntry: 0xae, TrackNumber: 0xd7, TrackUID: 0x73c5, TrackType: 0x83,
  FlagEnabled: 0xb9, FlagDefault: 0x88, FlagForced: 0x55aa, FlagLacing: 0x9c,
  DefaultDuration: 0x23e383, TrackTimestampScale: 0x23314f,
  CodecID: 0x86, CodecPrivate: 0x63a2, CodecDelay: 0x56aa, SeekPreRoll: 0x56bb,
  Language: 0x22b59c, LanguageBCP47: 0x22b59d, Name: 0x536e,
  Video: 0xe0, PixelWidth: 0xb0, PixelHeight: 0xba, DisplayWidth: 0x54b0, DisplayHeight: 0x54ba,
  Audio: 0xe1, SamplingFrequency: 0xb5, OutputSamplingFrequency: 0x78b5,
  Channels: 0x9f, BitDepth: 0x6264,
  // Cluster
  Timestamp: 0xe7, SimpleBlock: 0xa3, BlockGroup: 0xa0, Block: 0xa1,
  BlockDuration: 0x9b, ReferenceBlock: 0xfb,
  // Cues
  CuePoint: 0xbb, CueTime: 0xb3, CueTrackPositions: 0xb7, CueTrack: 0xf7,
  CueClusterPosition: 0xf1, CueRelativePosition: 0xf0,
};

export const TRACK_TYPE = { 1: 'video', 2: 'audio', 17: 'subtitle' };

/** Kursori valmiin puskurin yli. */
export class Reader {
  constructor(bytes, start = 0, end = bytes.length) {
    this.b = bytes;
    this.p = start;
    this.end = end;
  }

  /** An EBML vint. id=true keeps the length marker, because an id is raw bytes. */
  vint(id) {
    const first = this.b[this.p];
    if (first === undefined) return null;
    let len = 1;
    for (let mask = 0x80; mask && !(first & mask); mask >>= 1) len++;
    if (len > 8 || this.p + len > this.end) return null;
    const strip = 0xff >> len;
    let value = id ? first : (first & strip);
    let unknown = (first & strip) === strip;
    for (let i = 1; i < len; i++) {
      const byte = this.b[this.p + i];
      if (byte !== 0xff) unknown = false;
      value = value * 256 + byte;
    }
    this.p += len;
    return { value, len, unknown: !id && unknown };
  }

  uint(len) {
    let value = 0;
    for (let i = 0; i < len; i++) value = value * 256 + this.b[this.p + i];
    return value;
  }

  /** A signed integer (ReferenceBlock). */
  int(len) {
    let value = this.uint(len);
    const limit = Math.pow(2, len * 8 - 1);
    return value >= limit ? value - limit * 2 : value;
  }

  float(len) {
    const view = new DataView(this.b.buffer, this.b.byteOffset + this.p, len);
    return len === 4 ? view.getFloat32(0) : len === 8 ? view.getFloat64(0) : 0;
  }

  text(len) {
    const raw = this.b.subarray(this.p, this.p + len);
    let end = raw.length;
    while (end > 0 && raw[end - 1] === 0) end--;      // the fields are NUL-padded
    try { return new TextDecoder().decode(raw.subarray(0, end)); } catch { return ''; }
  }

  bytes(len) {
    return this.b.slice(this.p, this.p + len);
  }
}

/**
 * Parses the start of the file: tracks, time scale and segment positions.
 *
 * @param {Uint8Array} bytes a buffer read from the start of the file
 * @returns {{
 *   ok: boolean, truncated: boolean, tracks: object[], timestampScale: number,
 *   duration: number|null, writingApp: string|null,
 *   segmentStart: number, firstCluster: number|null, cuesPosition: number|null,
 * }}
 *   segmentStart is where the Segment's data begins, counted from the start
 *   of the file; Cues and SeekHead positions are relative to it.
 */
export function parseHeader(bytes) {
  const out = {
    ok: false, truncated: false, tracks: [], timestampScale: 1000000,
    duration: null, writingApp: null,
    segmentStart: 0, firstCluster: null, cuesPosition: null,
  };
  if (bytes.length < 4) return out;
  if (!(bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3)) return out;

  const raw = [];
  let rawDuration = null;
  let tracksDone = false;
  let stop = false;

  const walk = (r, end, inside) => {
    while (r.p < end && !stop) {
      const idStart = r.p;
      const id = r.vint(true);
      if (!id) return;
      const size = r.vint(false);
      if (!size) return;
      const start = r.p;
      const limit = size.unknown ? end : Math.min(end, start + size.value);
      const overflows = !size.unknown && start + size.value > end;

      switch (id.value) {
        case ID.Segment:
          out.segmentStart = start;
          walk(new Reader(r.b, start, limit), limit, 'segment');
          break;
        case ID.Cluster:
          // The tracks are always defined before the first cluster; from
          // here on there is nothing but picture and sound data.
          if (out.firstCluster === null) out.firstCluster = idStart;
          stop = true;
          return;
        case ID.SeekHead:
          if (!overflows) seekHead(new Reader(r.b, start, limit), limit, out);
          break;
        case ID.Tracks:
          if (overflows) { out.truncated = true; return; }
          walk(new Reader(r.b, start, limit), limit, 'tracks');
          tracksDone = true;
          break;
        case ID.Info:
          walk(new Reader(r.b, start, limit), limit, 'info');
          break;
        case ID.TrackEntry: {
          const track = { priv: null };
          walk(new Reader(r.b, start, limit), limit, track);
          raw.push(track);
          break;
        }
        case ID.Video:
        case ID.Audio:
          if (typeof inside === 'object') walk(new Reader(r.b, start, limit), limit, inside);
          break;
        default:
          if (typeof inside === 'object') field(inside, id.value, r, size.value);
          else if (inside === 'info') {
            if (id.value === ID.TimestampScale) out.timestampScale = r.uint(size.value) || out.timestampScale;
            else if (id.value === ID.Duration) rawDuration = r.float(size.value);
            else if (id.value === ID.WritingApp) out.writingApp = r.text(size.value);
          }
          break;
      }

      // A Cues or Attachments element after Tracks overruns the buffer
      // almost always; that does not mean the track data is incomplete.
      if (overflows) {
        if (!tracksDone) out.truncated = true;
        return;
      }
      r.p = limit;
    }
  };

  walk(new Reader(bytes), bytes.length, null);
  if (!tracksDone) out.truncated = true;
  if (rawDuration) out.duration = (rawDuration * out.timestampScale) / 1e9;
  out.tracks = raw;
  out.ok = tracksDone;
  return out;
}

/** The position of Cues from the SeekHead, so seeking need not be guessed. */
function seekHead(r, end, out) {
  while (r.p < end) {
    const id = r.vint(true);
    if (!id) return;
    const size = r.vint(false);
    if (!size) return;
    const start = r.p;
    const limit = Math.min(end, start + size.value);
    if (id.value === ID.Seek) {
      let target = null;
      let position = null;
      const inner = new Reader(r.b, start, limit);
      while (inner.p < limit) {
        const innerId = inner.vint(true);
        if (!innerId) break;
        const innerSize = inner.vint(false);
        if (!innerSize) break;
        if (innerId.value === ID.SeekID) target = inner.uint(innerSize.value);
        else if (innerId.value === ID.SeekPosition) position = inner.uint(innerSize.value);
        inner.p += innerSize.value;
      }
      if (target === ID.Cues && position != null) out.cuesPosition = position;
    }
    r.p = limit;
  }
}

/** A single TrackEntry field. */
export function field(track, id, r, len) {
  switch (id) {
    case ID.TrackNumber: track.number = r.uint(len); break;
    case ID.TrackType: track.type = r.uint(len); break;
    case ID.CodecID: track.codecId = r.text(len); break;
    case ID.CodecPrivate: track.priv = r.bytes(len); break;
    case ID.CodecDelay: track.codecDelay = r.uint(len); break;
    case ID.DefaultDuration: track.defaultDuration = r.uint(len); break;
    case ID.Language: if (!track.langBcp) track.lang = r.text(len); break;
    case ID.LanguageBCP47: track.langBcp = r.text(len); break;
    case ID.Name: track.name = r.text(len); break;
    case ID.FlagDefault: track.isDefault = r.uint(len) === 1; break;   // 1 when absent
    case ID.FlagForced: track.forced = r.uint(len) === 1; break;
    case ID.FlagLacing: track.lacing = r.uint(len) === 1; break;
    case ID.PixelWidth: track.width = r.uint(len); break;
    case ID.PixelHeight: track.height = r.uint(len); break;
    case ID.DisplayWidth: track.displayWidth = r.uint(len); break;
    case ID.DisplayHeight: track.displayHeight = r.uint(len); break;
    case ID.Channels: track.channels = r.uint(len); break;
    case ID.SamplingFrequency: track.rate = Math.round(r.float(len)); break;
    case ID.OutputSamplingFrequency: track.outputRate = Math.round(r.float(len)); break;
    case ID.BitDepth: track.bits = r.uint(len); break;
    default: break;
  }
}
