// Pirstottu MP4 (fMP4) MediaSourcelle.
//
// MSE ei ota vastaan Matroskaa, mutta sen sisällä oleva H.264 tai HEVC kelpaa
// sellaisenaan — kehyksiä ei pureta eikä koodata uudelleen, vain kontti
// vaihdetaan. Alkupala (ftyp+moov) kuvaa raidat, ja jokainen mediapala
// (moof+mdat) tuo lisää näytteitä.
//
// Kaksi asiaa vaatii tarkkuutta:
//
// 1. Matroska tallettaa vain esitysajan (PTS). MP4 tarvitsee myös
//    dekoodausajan (DTS), ja B-kuvien takia ne eroavat — mitatussa
//    tiedostossa 1569 kehyksestä 740:n PTS meni edellistä taaksepäin.
//    DTS saadaan järjestämällä palan PTS:t nousevaan järjestykseen ja
//    antamalla ne dekoodausjärjestyksessä; erotus menee ctts-kenttään.
//
// 2. Aikayksiköt. Videolla 90 000 tikkiä sekunnissa jakautuu tasan kaikilla
//    tavallisilla kuvataajuuksilla (24 → 3750, 25 → 3600, 30000/1001 → 3003).
//    Äänellä käytetään näytetaajuutta ja kehykset ketjutetaan peräkkäin, koska
//    Matroskan millisekunnin tarkkuus pyöristäisi AAC-kehyksen 21,333 ms:n
//    keston ja virhe kertyisi tunnissa sekunneiksi.

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

// Yksikkömatriisi 16.16-kiintopisteinä.
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
  );

  return box('trak', tkhd, box('mdia', mdhd, hdlr, box('minf', header, dinf, stbl)));
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

  const payload = join([
    new Uint8Array(6),
    u16(1),                       // data_reference_index
    u32(0, 0),                    // reserved
    u16(track.channels || 2, 16), // channelcount, samplesize
    u16(0, 0),                    // pre_defined, reserved
    u32((track.rate || 48000) << 16),
    esds(track.priv),
  ]);
  return box('mp4a', payload);
}

function compressorName() {
  const out = new Uint8Array(32);   // pituustavu + 31 merkkiä, nollattu
  return out;
}

/**
 * AAC:n esds. AudioSpecificConfig tulee Matroskan CodecPrivatesta
 * sellaisenaan; pituudet mahtuvat yhteen tavuun, koska ASC on 2–5 tavua.
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
 * Yksi moof+mdat. Näytteet ovat dekoodausjärjestyksessä.
 *
 * @param {number} sequence juokseva numero
 * @param {number} trackId
 * @param {{data:Uint8Array, dts:number, cts:number, duration:number, keyframe:boolean}[]} samples
 */
export function mediaSegment(sequence, trackId, samples) {
  const baseTime = samples[0].dts;
  const mfhd = box('mfhd', u32(0, sequence));

  const tfhd = box('tfhd', join([
    u32(0x00020000),              // default-base-is-moof
    u32(trackId),
  ]));
  const tfdt = box('tfdt', join([u32(0x01000000), u64(baseTime)]));

  // trun: kesto, koko, liput ja esitysajan poikkeama joka näytteelle.
  // Versio 1 sallii negatiivisen poikkeaman, jota B-kuvat toisinaan vaativat.
  const flags = 0x000f01;         // data-offset + duration + size + flags + cts
  const trunPayload = new Uint8Array(8 + 4 + samples.length * 16);
  const view = new DataView(trunPayload.buffer);
  view.setUint32(0, 0x01000000 | flags);
  view.setUint32(4, samples.length);
  let at = 12;                    // data_offset täytetään kun koko tiedetään
  for (const s of samples) {
    view.setUint32(at, s.duration);
    view.setUint32(at + 4, s.data.byteLength);
    view.setUint32(at + 8, s.keyframe ? 0x02000000 : 0x01010000);
    view.setInt32(at + 12, s.cts);
    at += 16;
  }

  const traf = box('traf', tfhd, tfdt, box('trun', trunPayload));
  const moof = box('moof', mfhd, traf);

  // data_offset osoittaa mdatin sisältöön moofin alusta laskien. Kenttä on
  // trunin hyötykuorman tavuissa 8–11, joten sen paikka lasketaan laatikko
  // kerrallaan moofin alusta.
  const dataOffsetAt = 8 + mfhd.byteLength + 8 + tfhd.byteLength + tfdt.byteLength + 8 + 8;
  new DataView(moof.buffer).setUint32(dataOffsetAt, moof.byteLength + 8);

  const payload = join(samples.map((s) => s.data));
  return join([moof, box('mdat', payload)]);
}

/* ------------------------------------------------------- ajoitus */

/**
 * DTS ja ctts kehyksille joilla on vain PTS.
 *
 * Palan PTS:t nousevaan järjestykseen ja jaettuna dekoodausjärjestyksessä
 * antavat kelvollisen, kasvavan DTS-sarjan. Poikkeamasta tulee ctts.
 *
 * @param {number[]} pts esitysajat tikkeinä, dekoodausjärjestyksessä
 * @returns {{dts:number[], cts:number[]}}
 */
export function decodeTimes(pts) {
  const sorted = [...pts].sort((a, b) => a - b);
  const dts = sorted.slice();
  const cts = pts.map((value, i) => value - dts[i]);
  return { dts, cts };
}

/** Näytteen kesto seuraavan alusta; viimeiselle jää edellisen kesto. */
export function durations(dts, fallback) {
  const out = new Array(dts.length);
  for (let i = 0; i < dts.length - 1; i++) out[i] = Math.max(1, dts[i + 1] - dts[i]);
  out[dts.length - 1] = dts.length > 1 ? out[dts.length - 2] : (fallback || 1);
  return out;
}
