// Matroskan klustereiden purku virrasta.
//
// Tiedostoa ei ladata muistiin: tavut tulevat verkosta pala kerrallaan ja
// jäsennin odottaa niitä tarvitessaan. Vetävä malli (need/read) on tässä
// selvästi työntävää tilakonetta yksinkertaisempi, koska EBML-elementin koko
// tiedetään vasta kun sen otsikko on luettu.
//
// Klusterin lohko sisältää yhden tai useamman kehyksen. Useampi tulee
// "lacingilla", jota käytetään lähes aina äänelle: AAC-kehys on 1024 näytettä
// eli noin 21 ms, joten niitä niputetaan samaan lohkoon. Kaikki kolme
// lacing-muotoa on toteutettava, muuten ääni katkeaa satunnaisesti.

import { ID, Reader } from './ebml.js';

/** Puskuri, joka odottaa tavuja kunnes niitä on tarpeeksi. */
export class BufferedBytes {
  constructor() {
    this.chunks = [];
    this.offset = 0;          // luettu kohta ensimmäisen palan sisällä
    this.available = 0;
    this.position = 0;        // tavuja alusta, kelauksen kirjanpitoon
    this.done = false;
    this.waiter = null;
    this.failure = null;
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

  /** Odottaa kunnes n tavua on saatavilla. False = virta loppui kesken. */
  async need(n) {
    while (this.available < n && !this.done) {
      await new Promise((resolve) => { this.waiter = resolve; });
    }
    // Jo saapuneet tavut käytetään loppuun ennen kuin virhe kerrotaan: ne
    // ovat kelvollisia riippumatta siitä miten yhteys päättyi, ja jäsennin
    // on aina lukijaa jäljessä. Ilman tätä katkos hylkää senkin osan
    // puskurista jota se ei ollut vielä ehtinyt lukea.
    if (this.available >= n) return true;
    if (this.failure) throw this.failure;
    return false;
  }

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

// Elementit joiden sisään mennään: niiden lapset käsitellään samassa
// silmukassa. Kaikki muu ohitetaan koon perusteella.
const DESCEND = new Set([ID.Segment, ID.Cluster]);

/**
 * Kehykset klustereista. Lopettaa kun virta loppuu.
 *
 * @param {BufferedBytes} bytes
 * @param {{timestampScale:number, tracks:Map<number,object>, onCluster?:Function,
 *          onStop?:(reason:string, position:number)=>void}} opts
 * @yields {{track:number, pts:number, duration:number|null, keyframe:boolean, data:Uint8Array}}
 *         pts ja duration nanosekunteina tiedoston alusta
 */
export async function* frames(bytes, { timestampScale, tracks, onCluster, onStop }) {
  // Purkaja voi loppua kesken monesta syystä, ja ne on erotettava: virran
  // loppuminen on normaalia, epäkelpo tunnus taas kertoo että jäsennin on
  // eksynyt eikä jatkaminen samasta kohdasta auta.
  const stop = (reason) => { if (onStop) onStop(reason, bytes.position); };
  let clusterTs = 0;
  for (;;) {
    // Klusterin alkukohta talteen ennen otsikon lukua: katkennut lataus
    // jatketaan elementin rajalta, ei keskeltä.
    const at = bytes.position;
    const el = await readElement(bytes);
    if (!el) { stop(bytes.done ? 'virta loppui' : 'kelvoton tunnus tai koko'); return; }

    if (DESCEND.has(el.id)) {
      if (el.id === ID.Cluster && onCluster) onCluster(at);
      continue;
    }

    if (el.id === ID.Timestamp) {
      if (!await bytes.need(el.size)) { stop('virta loppui kesken aikaleiman'); return; }
      clusterTs = new Reader(bytes.read(el.size)).uint(el.size);
      continue;
    }

    if (el.id === ID.SimpleBlock || el.id === ID.BlockGroup) {
      if (el.size > MAX_BLOCK) { stop(`kohtuuton lohko ${el.size} tavua`); return; }
      if (!await bytes.need(el.size)) { stop('virta loppui kesken lohkon'); return; }
      const raw = bytes.read(el.size);
      const parsed = el.id === ID.SimpleBlock
        ? block(raw, { simple: true })
        : blockGroup(raw);
      if (parsed) yield* expand(parsed, clusterTs, timestampScale, tracks);
      continue;
    }

    if (el.unknown) continue;                 // tuntematon koko: ei voi ohittaa
    if (!await bytes.need(el.size)) { stop(`virta loppui ohitettaessa ${el.size} tavua`); return; }
    bytes.skip(el.size);
  }
}

// Yksittäinen lohko on käytännössä korkeintaan muutamia megatavuja. Tätä
// suurempi luku tarkoittaa että jäsennin on eksynyt väärään kohtaan, eikä
// puskuria kannata kasvattaa loputtomiin sen varassa.
const MAX_BLOCK = 32 * 1024 * 1024;

/** SimpleBlock tai BlockGroupin Block. */
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
  // BlockGroupissa ei ole avainkuvalippua: kehys on avainkuva jos se ei
  // viittaa mihinkään muuhun.
  return block(inner, { simple: false, keyframe: !referenced, duration });
}

/** Lohkon sisältö kehyksiksi. Kolme lacing-muotoa, ks. Matroska-spec. */
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
      // Etumerkillinen: puolet vintin arvoalueesta on negatiivista.
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
  if (mode !== 2) out.push(payload.subarray(p));        // viimeisen koko on loput
  return out.filter((f) => f.length);
}

/** Lohkon kehykset aikaleimoineen. */
function* expand(parsed, clusterTs, timestampScale, tracks) {
  const track = tracks.get(parsed.track);
  if (!track) return;
  const base = (clusterTs + parsed.relative) * timestampScale;
  // Nipussa kehykset jakavat lohkon aikaleiman: ne erotetaan raidan
  // oletuskestolla, jotta ääni ei kasaudu yhteen hetkeen.
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
