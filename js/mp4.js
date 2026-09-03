// Fragmented MP4 (fMP4) for MediaSource.
//
// MSE will not take Matroska, but the H.264 or HEVC inside it is fine as it
// is — frames are neither decoded nor re-encoded, only the container is
// swapped. The init segment (ftyp+moov) describes the tracks, and every
// media segment (moof+mdat) brings more samples.
//
// Two things need care:
//
// 1. Matroska stores only the presentation time (PTS). MP4 also needs the
//    decode time (DTS), and because of B-frames they differ — in a measured
//    file 740 of 1569 frames had a PTS that went backwards from the
//    previous one. The DTS is obtained by sorting the segment's PTS values
//    ascending and handing them out in decode order; the difference goes
//    into the ctts field.
//
// 2. Time units. For video, 90,000 ticks per second divides evenly at every
//    common frame rate (24 → 3750, 25 → 3600, 30000/1001 → 3003). For audio
//    the sample rate is used and frames are chained back to back, because
//    Matroska's millisecond resolution would round an AAC frame's 21.333 ms
//    duration and the error would accumulate into seconds over an hour.
//
// The audio sample entry is one of two. AAC, whether the file's own track
// or the re-encoded one, is an mp4a entry with the AudioSpecificConfig in
// its esds. Opus — what transcode.js encodes where the browser has no AAC
// encoder, Firefox above all — is an Opus entry with a dOps box, as the
// Opus-in-ISOBMFF specification lays it out.

export const VIDEO_TIMESCALE = 90000;

/* ------------------------------------------------------------- laatikot */

const CHARS = (s) => [s.charCodeAt(0), s.charCodeAt(1), s.charCodeAt(2), s.charCodeAt(3)];

function box(type, ...parts) {
  let length = 8;
  for (const part of parts) length += part.byteLength;
  const out = new Uint8Array(length);
  const view = new DataView(out.buffer);
  view.setUint32(0, length);
  out.set(CHARS(type), 4);
  let at = 8;
  for (const part of parts) { out.set(part, at); at += part.byteLength; }
  return out;
}

const bytes = (...values) => new Uint8Array(values);

function u32(...values) {
  const out = new Uint8Array(values.length * 4);
  const view = new DataView(out.buffer);
  values.forEach((value, i) => view.setUint32(i * 4, value >>> 0));
  return out;
}

function u16(...values) {
  const out = new Uint8Array(values.length * 2);
  const view = new DataView(out.buffer);
  values.forEach((value, i) => view.setUint16(i * 2, value & 0xffff));
  return out;
}

function u64(value) {
  const out = new Uint8Array(8);
  const view = new DataView(out.buffer);
  view.setUint32(0, Math.floor(value / 4294967296));
  view.setUint32(4, value >>> 0);
  return out;
}

const join = (parts) => {
  let length = 0;
  for (const part of parts) length += part.byteLength;
  const out = new Uint8Array(length);
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.byteLength; }
  return out;
};

// The identity matrix in 16.16 fixed point.
const MATRIX = u32(0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000);

/* --------------------------------------------------------- alkupala */

/**
 * @param {object[]} tracks [{ id, kind:'video'|'audio', timescale, codec,
 *   priv, width, height, channels, rate }]
 * @returns {Uint8Array} ftyp + moov
 */
export function initSegment(tracks) {
  const brand = (name) => new Uint8Array(CHARS(name));
  const ftyp = box('ftyp', join([brand('iso5'), u32(1), brand('iso5'), brand('iso6'), brand('mp41')]));
  const traks = tracks.map(trak);
  const trexs = tracks.map((t) => box('trex', u32(0, t.id, 1, 0, 0, 0)));
  const moov = box('moov', mvhd(tracks), ...traks, box('mvex', ...trexs));
  return join([ftyp, moov]);
}

function mvhd(tracks) {
  let nextId = 1;
  for (const t of tracks) nextId = Math.max(nextId, t.id + 1);
  return box('mvhd', join([
    u32(0),                       // version + flags
    u32(0, 0),                    // creation, modification
    u32(1000, 0),                 // timescale, duration (tuntematon)
    u32(0x00010000),              // rate 1.0
    u16(0x0100), u16(0),          // volume 1.0, reserved
    u32(0, 0),                    // reserved
    MATRIX,
    u32(0, 0, 0, 0, 0, 0),        // pre_defined
    u32(nextId),
  ]));
}

function trak(track) {
  const video = track.kind === 'video';
  const tkhd = box('tkhd', join([
    u32(0x00000007),              // version 0, flags: enabled | in movie | in preview
    u32(0, 0),
    u32(track.id, 0, 0),          // track_id, reserved, duration
    u32(0, 0),                    // reserved
    u16(0), u16(0),               // layer, alternate_group
    u16(video ? 0 : 0x0100), u16(0),
    MATRIX,
    u32(video ? (track.width || 0) << 16 : 0, video ? (track.height || 0) << 16 : 0),
  ]));

  const mdhd = box('mdhd', join([
    u32(0),
    u32(0, 0),
    u32(track.timescale, 0),
    u16(0x55c4),                  // kieli "und"
    u16(0),
  ]));

  const name = video ? 'VideoHandler' : 'SoundHandler';
  const hdlr = box('hdlr', join([
    u32(0, 0),
    new Uint8Array(CHARS(video ? 'vide' : 'soun')),
    u32(0, 0, 0),
    new TextEncoder().encode(name + '\0'),
  ]));

  const header = video
    ? box('vmhd', join([u32(0x00000001), u16(0, 0, 0, 0)]))
    : box('smhd', join([u32(0), u16(0, 0)]));

  const dref = box('dref', join([u32(0, 1), box('url ', u32(0x00000001))]));
  const dinf = box('dinf', dref);

  const stbl = box('stbl',
    box('stsd', join([u32(0, 1), sampleEntry(track)])),
    box('stts', u32(0, 0)),
    box('stsc', u32(0, 0)),
    box('stsz', u32(0, 0, 0)),
    box('stco', u32(0, 0)),
    ...(track.codec === 'opus' ? rollGroup() : []),
  );

  return box('trak', tkhd, box('mdia', mdhd, hdlr, box('minf', header, dinf, stbl)));
}

/**
 * The 'roll' sample group Opus in ISOBMFF requires of every Opus track: a
 * player seeking into the stream decodes this many samples before the
 * target and discards them, so that the decoder has settled — 80 ms of
 * pre-roll, four 20 ms frames, hence a roll distance of -4. Neither Chrome
 * nor Firefox reads it for playback; the specification's "shall" is the
 * reason it is here. The sgpd holds the one description, the sbgp of the
 * sample table is empty, and every media segment's traf refers to the
 * description from its own sbgp.
 */
function rollGroup() {
  return [
    box('sgpd', join([
      u32(0x01000000),            // version 1: default_length follows
      new Uint8Array(CHARS('roll')),
      u32(2),                     // default_length
      u32(1),                     // entry_count
      u16(0xfffc),                // roll_distance -4
    ])),
    box('sbgp', join([u32(0), new Uint8Array(CHARS('roll')), u32(0)])),
  ];
}

function sampleEntry(track) {
  if (track.kind === 'video') {
    const config = track.codec === 'hevc'
      ? box('hvcC', track.priv)
      : box('avcC', track.priv);
    const payload = join([
      new Uint8Array(6),          // reserved
      u16(1),                     // data_reference_index
      u16(0, 0),                  // pre_defined, reserved
      u32(0, 0, 0),               // pre_defined[3]
      u16(track.width || 0, track.height || 0),
      u32(0x00480000, 0x00480000),// 72 dpi
      u32(0),                     // reserved
      u16(1),                     // frame_count
      compressorName(),
      u16(0x0018),                // depth
      u16(0xffff),                // pre_defined = -1
      config,
    ]);
    return box(track.codec === 'hevc' ? 'hvc1' : 'avc1', payload);
  }

  const audio = join([
    new Uint8Array(6),
    u16(1),                       // data_reference_index
    u32(0, 0),                    // reserved
    u16(track.channels || 2, 16), // channelcount, samplesize
    u16(0, 0),                    // pre_defined, reserved
    u32((track.rate || 48000) << 16),
  ]);
  if (track.codec === 'opus') return box('Opus', audio, dOps(track));
  return box('mp4a', audio, esds(track.priv));
}

function compressorName() {
  const out = new Uint8Array(32);   // length byte + 31 characters, zeroed
  return out;
}

/**
 * The OpusSpecificBox. Only the case at hand: mono or stereo, channel
 * mapping family 0, so no mapping table follows. PreSkip is zero on
 * purpose — the encoder's priming delay is measured and taken off the
 * timestamps in transcode.js, as it is for AAC, and a decoder told to trim
 * would take the same samples off twice.
 */
function dOps(track) {
  return box('dOps', join([
    bytes(0),                     // Version
    bytes(track.channels || 2),   // OutputChannelCount
    u16(0),                       // PreSkip
    u32(track.rate || 48000),     // InputSampleRate
    u16(0),                       // OutputGain, 0 dB
    bytes(0),                     // ChannelMappingFamily 0: no table
  ]));
}

/**
 * The esds for AAC. The AudioSpecificConfig comes from Matroska's
 * CodecPrivate as it is; the lengths fit in one byte, because an ASC is
 * 2–5 bytes.
 */
function esds(asc) {
  const config = asc && asc.byteLength ? asc : bytes(0x11, 0x90);
  const dsi = join([bytes(0x05, config.byteLength), config]);
  const dcd = join([
    bytes(0x04, 13 + dsi.byteLength),
    bytes(0x40, 0x15),            // MPEG-4 Audio, audio stream
    bytes(0, 0, 0),               // bufferSizeDB
    u32(0, 0),                    // maxBitrate, avgBitrate
    dsi,
  ]);
  const sl = bytes(0x06, 0x01, 0x02);
  const es = join([bytes(0x03, 3 + dcd.byteLength + sl.byteLength), u16(0), bytes(0), dcd, sl]);
  return box('esds', join([u32(0), es]));
}

/* --------------------------------------------------------- mediapala */

/**
 * One moof+mdat. The samples are in decode order.
 *
 * @param {number} sequence running number
 * @param {number} trackId
 * @param {{data:Uint8Array, dts:number, cts:number, duration:number, keyframe:boolean}[]} samples
 * @param {string} [codec] 'opus' adds the fragment's roll group, see rollGroup
 */
export function mediaSegment(sequence, trackId, samples, codec) {
  const baseTime = samples[0].dts;
  const mfhd = box('mfhd', u32(0, sequence));

  const tfhd = box('tfhd', join([
    u32(0x00020000),              // default-base-is-moof
    u32(trackId),
  ]));
  const tfdt = box('tfdt', join([u32(0x01000000), u64(baseTime)]));

  // trun: duration, size, flags and the presentation-time offset for every
  // sample. Version 1 allows a negative offset, which B-frames sometimes
  // need.
  const flags = 0x000f01;         // data-offset + duration + size + flags + cts
  const trunPayload = new Uint8Array(8 + 4 + samples.length * 16);
  const view = new DataView(trunPayload.buffer);
  view.setUint32(0, 0x01000000 | flags);
  view.setUint32(4, samples.length);
  let at = 12;                    // data_offset is filled in once the size is known
  for (const s of samples) {
    view.setUint32(at, s.duration);
    view.setUint32(at + 4, s.data.byteLength);
    view.setUint32(at + 8, s.keyframe ? 0x02000000 : 0x01010000);
    view.setInt32(at + 12, s.cts);
    at += 16;
  }

  // Every sample of the fragment in the roll group: one run, description 1
  // of the sample table's sgpd. After the trun, so that the data offset
  // below is still found at the same place.
  const roll = codec === 'opus'
    ? [box('sbgp', join([u32(0), new Uint8Array(CHARS('roll')), u32(1), u32(samples.length), u32(1)]))]
    : [];
  const traf = box('traf', tfhd, tfdt, box('trun', trunPayload), ...roll);
  const moof = box('moof', mfhd, traf);

  // data_offset points into the mdat contents, counted from the start of
  // the moof. The field is at bytes 8–11 of the trun payload, so its
  // position is worked out one box at a time from the start of the moof.
  const dataOffsetAt = 8 + mfhd.byteLength + 8 + tfhd.byteLength + tfdt.byteLength + 8 + 8;
  new DataView(moof.buffer).setUint32(dataOffsetAt, moof.byteLength + 8);

  const payload = join(samples.map((s) => s.data));
  return join([moof, box('mdat', payload)]);
}

/* ------------------------------------------------------- ajoitus */

/**
 * DTS and ctts for frames that only carry a PTS.
 *
 * The segment's PTS values sorted ascending and handed out in decode order
 * give a valid, increasing DTS series. The difference becomes the ctts.
 *
 * @param {number[]} pts presentation times in ticks, in decode order
 * @returns {{dts:number[], cts:number[]}}
 */
export function decodeTimes(pts) {
  const sorted = [...pts].sort((a, b) => a - b);
  const dts = sorted.slice();
  const cts = pts.map((value, i) => value - dts[i]);
  return { dts, cts };
}

/** A sample's duration from the next one's start; the last keeps the
 *  previous duration. */
export function durations(dts, fallback) {
  const out = new Array(dts.length);
  for (let i = 0; i < dts.length - 1; i++) out[i] = Math.max(1, dts[i + 1] - dts[i]);
  out[dts.length - 1] = dts.length > 1 ? out[dts.length - 2] : (fallback || 1);
  return out;
}
