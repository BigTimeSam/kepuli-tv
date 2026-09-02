// Purettu ääni takaisin AAC:ksi MediaSourcea varten.
//
// Chrome ei pura AC-3:a, E-AC-3:a eikä DTS:ää, ja mitatussa kirjastossa 53 %
// mkv-jaksojen ääniraidoista on niitä. MediaSource ei ota vastaan PCM:ää,
// joten purettu ääni on koodattava uudelleen johonkin mitä se ottaa —
// WebCodecsin AAC-koodain on selaimessa valmiina ja mitattuna riittävän
// nopea (purku 150–1300x, koodaus samaa luokkaa).
//
// Kaksi mitattua rajoitetta määrää muodon:
//
//   - Koodain hyväksyy vain 44 100 ja 48 000 Hz. AC-3 sallii myös 32 000, ja
//     kanavamäärä saa vaihtua kesken raidan. Siksi wasm-purkaja laskee kaiken
//     kiinteään muotoon (stereo, 48 kHz) ennen koodainta.
//   - Koodaimessa on esitäyte, jota se ei kerro eikä korjaa: mitattuna 2112
//     näytettä eli 44 ms. Ilman korjausta ääni olisi kauttaaltaan sen verran
//     kuvaa jäljessä. Luku on alustakohtainen (2112 on macOS:n AudioToolbox),
//     joten se mitataan ajossa: koodataan tunnettu heräte ja puretaan se
//     takaisin selaimen omalla purkajalla.
//
// Aikaleimat ketjutetaan kuten muutenkin äänessä: MediaSourcen puolella
// AAC-kehys on tasan 1024 näytettä, ja ketju aloitetaan ensimmäisen
// lohkon PTS:stä miinus esitäyte.

import { PcmDecoder, decodable } from './ffaudio.js';

export const RATE = 48000;
export const CHANNELS = 2;
const AAC_FRAME = 1024;
const CODEC = 'mp4a.40.2';
const BITRATE = 192000;

// Tätä suurempi hyppy aikaleimoissa ei ole jitteriä vaan aukko tai jatko
// katkenneesta latauksesta: ketju aloitetaan alusta.
const GAP_NS = 250e6;

// Koodaimen jono pidetään lyhyenä. Purku on niin nopeaa, että ilman tätä
// koko puskuroitava minuutti työnnettäisiin koodaimelle kerralla.
const MAX_QUEUE = 32;
const QUEUE_POLL_MS = 4;

/**
 * Koodaimen esitäyte ja AudioSpecificConfig. Kumpikin riippuu vain
 * kokoonpanosta, joten mittaus tehdään kerran sivua kohti.
 */
let setup = null;
export function encoderSetup() {
  if (!setup) setup = measure().catch((err) => {
    console.warn('[iptv] koodaimen mittaus epäonnistui', err);
    setup = null;
    throw err;
  });
  return setup;
}

/**
 * Koodaa herätteen ja purkaa sen takaisin. Ero herätteen tunnetun paikan ja
 * puretun paikan välillä on koodaimen esitäyte.
 */
async function measure() {
  const ONSET = 4 * AAC_FRAME;
  const TOTAL = 12 * AAC_FRAME;
  const packets = [];
  let config = null;

  const encoder = new AudioEncoder({
    output: (chunk, meta) => {
      if (meta && meta.decoderConfig && !config) config = meta.decoderConfig;
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      packets.push({ timestamp: chunk.timestamp, data });
    },
    error: (err) => console.warn('[iptv] koodainmittaus', err),
  });
  encoder.configure({ codec: CODEC, sampleRate: RATE, numberOfChannels: CHANNELS, bitrate: BITRATE });

  for (let at = 0; at < TOTAL; at += AAC_FRAME) {
    const data = new Float32Array(AAC_FRAME * CHANNELS);
    for (let i = 0; i < AAC_FRAME; i++) {
      // Kosini alkaa huipulta, joten herätteen ensimmäinen näyte ylittää
      // kynnyksen heti — siniaalto alkaisi nollasta ja mittaus myöhästyisi.
      const s = at + i;
      const value = s < ONSET ? 0 : 0.5 * Math.cos((2 * Math.PI * 1000 * (s - ONSET)) / RATE);
      data[i * CHANNELS] = value;
      data[i * CHANNELS + 1] = value;
    }
    encoder.encode(new AudioData({
      format: 'f32', sampleRate: RATE, numberOfFrames: AAC_FRAME, numberOfChannels: CHANNELS,
      timestamp: Math.round((at * 1e6) / RATE), data,
    }));
  }
  await encoder.flush();
  encoder.close();
  if (!config) throw new Error('koodain ei kertonut kokoonpanoaan');

  const frames = [];
  const decoder = new AudioDecoder({
    output: (frame) => {
      const data = new Float32Array(frame.numberOfFrames * frame.numberOfChannels);
      frame.copyTo(data, { planeIndex: 0, format: 'f32' });
      frames.push({ data, channels: frame.numberOfChannels, length: frame.numberOfFrames });
      frame.close();
    },
    error: (err) => console.warn('[iptv] mittauspurku', err),
  });
  decoder.configure({
    codec: config.codec, sampleRate: config.sampleRate,
    numberOfChannels: config.numberOfChannels, description: config.description,
  });
  for (const packet of packets) {
    decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp: packet.timestamp, data: packet.data }));
  }
  await decoder.flush();
  decoder.close();

  let at = 0;
  let onset = -1;
  for (const frame of frames) {
    for (let i = 0; i < frame.length && onset < 0; i++) {
      // Puolet herätteen amplitudista: MDCT levittää alkua molempiin
      // suuntiin, eikä kaiku ylitä tätä.
      if (Math.abs(frame.data[i * frame.channels]) > 0.25) onset = at + i;
    }
    at += frame.length;
  }
  // Mittaamatta jäänyt viive on parempi jättää nollaksi kuin arvata: ääni on
  // silloin 44 ms jäljessä, mikä on kuultavissa mutta ei rikki.
  const delay = onset < 0 ? 0 : Math.max(0, onset - ONSET);
  const description = config.description
    ? new Uint8Array(config.description.buffer ? config.description.buffer : config.description).slice()
    : null;
  return { delay, description };
}

/**
 * Yksi ääniraita purettuna ja koodattuna uudelleen. Elinkaari:
 * open() → push() jokaiselle lohkolle → take() valmiit kehykset →
 * finish() raidan lopussa → close().
 */
export class AudioTranscoder {
  /** Onko purku ja koodaus tässä selaimessa mahdollista. */
  static async available(codecId) {
    if (!decodable(codecId)) return false;
    if (typeof AudioEncoder === 'undefined' || typeof AudioDecoder === 'undefined') return false;
    try {
      const check = await AudioEncoder.isConfigSupported({
        codec: CODEC, sampleRate: RATE, numberOfChannels: CHANNELS, bitrate: BITRATE,
      });
      return Boolean(check && check.supported);
    } catch {
      return false;
    }
  }

  static async open(codecId, onError) {
    const { delay, description } = await encoderSetup();
    const decoder = await PcmDecoder.open(codecId, RATE);
    return new AudioTranscoder(decoder, delay, description, onError);
  }

  constructor(decoder, delay, description, onError) {
    this.decoder = decoder;
    this.delay = delay;
    this.description = description;
    this.onError = onError || (() => {});
    this.chunks = [];
    this.chainPts = null;     // ketjun ensimmäisen lohkon PTS
    this.chainSamples = 0;    // ketjuun syötetyt näytteet
    this.fed = 0;             // koko elinkaaren syötetyt näytteet
    this.nextDts = 0;
    this.closed = false;

    this.encoder = new AudioEncoder({
      output: (chunk) => this.collect(chunk),
      error: (err) => { if (!this.closed) this.onError(err); },
    });
    this.encoder.configure({ codec: CODEC, sampleRate: RATE, numberOfChannels: CHANNELS, bitrate: BITRATE });
  }

  collect(chunk) {
    const dts = this.nextDts;
    this.nextDts += AAC_FRAME;
    // Negatiivinen aika on koodaimen esitäytettä tiedoston alussa: siinä ei
    // ole vielä ääntä, ja MediaSource ei ottaisi sitä vastaan.
    if (dts < 0) return;
    const data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);
    this.chunks.push({ data, dts, duration: AAC_FRAME });
  }

  startChain(ptsNs) {
    this.chainPts = ptsNs;
    this.chainSamples = 0;
    this.nextDts = Math.round((ptsNs * RATE) / 1e9) - this.delay;
  }

  /** Ketjun seuraavaksi odottama PTS nanosekunteina. */
  expectedPts() {
    return this.chainPts + (this.chainSamples * 1e9) / RATE;
  }

  /**
   * Yksi Matroskan lohko sisään. Aikaleiman hyppy aloittaa uuden ketjun:
   * koodain tyhjennetään ensin, jotta vanhat kehykset saavat vielä vanhan
   * ketjun ajat.
   */
  async push(frame) {
    if (this.closed) return;
    if (this.chainPts == null) this.startChain(frame.pts);
    else if (Math.abs(frame.pts - this.expectedPts()) > GAP_NS) {
      await this.drain();
      this.startChain(frame.pts);
    }
    const pcm = this.decoder.decode(frame.data);
    if (pcm) this.feed(pcm);
    await this.waitForQueue();
  }

  /**
   * Odottaa että jono lyhenee. Nimenomaan odottaa eikä huuhtele: flush()
   * pakottaa koodaimen antamaan ulos myös vajaan kehyksen, jonka se täyttää
   * hiljaisuudella. Kehysketju venyisi jokaisella huuhtelulla, ja ääni
   * karkaisi kuvasta — mitattuna 60 sekunnin kuvaa vastasi 69 sekuntia
   * ääntä. Huuhtelu kuuluu siis vain ketjun vaihtoon ja raidan loppuun.
   */
  async waitForQueue() {
    while (!this.closed && this.encoder.encodeQueueSize > MAX_QUEUE) {
      await new Promise((resolve) => setTimeout(resolve, QUEUE_POLL_MS));
    }
  }

  feed(pcm) {
    const length = pcm.length / CHANNELS;
    if (!length) return;
    this.encoder.encode(new AudioData({
      format: 'f32', sampleRate: RATE, numberOfFrames: length, numberOfChannels: CHANNELS,
      // Koodain vaatii kasvavan aikaleiman. Se lasketaan syötetyistä
      // näytteistä eikä lohkon PTS:stä, joka ei ole tasan jatkuva.
      timestamp: Math.round((this.fed * 1e6) / RATE),
      data: pcm,
    }));
    this.fed += length;
    this.chainSamples += length;
  }

  /** Odottaa että koodain on antanut kaiken syötetyn ulos. */
  async drain() {
    if (this.closed) return;
    try { await this.encoder.flush(); } catch (err) { if (!this.closed) this.onError(err); }
  }

  /** Raidan loppu: purkajan häntä koodaimelle ja koodain tyhjäksi. */
  async finish() {
    if (this.closed) return;
    const tail = this.decoder.flush();
    if (tail) this.feed(tail);
    await this.drain();
  }

  /**
   * Aloittaa alusta kelauksen tai uudelleenyrityksen jälkeen. Vanhat
   * kehykset heitetään pois: ne kuuluvat aikaan josta siirryttiin pois.
   */
  async restart() {
    await this.drain();
    this.chunks = [];
    this.chainPts = null;
  }

  /** Valmiit AAC-kehykset ja niiden ajat. Tyhjentää jonon. */
  take() {
    return this.chunks.splice(0, this.chunks.length);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.chunks = [];
    try { this.encoder.close(); } catch { /* jo suljettu */ }
    this.decoder.close();
  }
}
