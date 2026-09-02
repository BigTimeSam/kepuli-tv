// AC-3-, E-AC-3- ja DTS-purku wasmilla.
//
// Purkaja itse on vendor/ffaudio (FFmpegistä käännetty, LGPL 2.1+); tässä on
// sen ympärille JS-puoli: moduulin lataus kerran, kasaan varattu syötepuskuri
// ja ulostulon kopiointi pois wasmin muistista ennen seuraavaa kutsua.
//
// Ulostulo on aina lomitettu stereo pyydetyllä näytetaajuudella — syy on
// transcode.js:ssä: selaimen AAC-koodain ei kestä kanavamäärän eikä
// näytetaajuuden vaihtumista kesken raidan, ja kumpaakin kirjastossa esiintyy.

import createFfAudio from '../vendor/ffaudio/ffaudio.js';

// Matroskan koodekkitunnus → vendor/ffaudio:n oma numero.
const CODEC = {
  'A_AC3': 0,
  'A_EAC3': 1,
  'A_DTS': 2, 'A_DTS/EXPRESS': 2, 'A_DTS/LOSSLESS': 2,
};

/** Osaako wasm-purkaja tämän raidan. */
export const decodable = (codecId) => CODEC[codecId] !== undefined;

// Moduuli ladataan kerran sivua kohti: käännöstulos on 628 kt, eikä sitä
// kannata hakea uudelleen jokaiselle jaksolle.
let loading = null;
const load = () => {
  if (!loading) loading = createFfAudio();
  return loading;
};

export class PcmDecoder {
  /**
   * @param {string} codecId Matroskan CodecID
   * @param {number} rate ulostulon näytetaajuus
   */
  static async open(codecId, rate) {
    const codec = CODEC[codecId];
    if (codec === undefined) throw new Error(`koodekkia ${codecId} ei voi purkaa`);
    const module = await load();
    const ctx = module._fa_open(codec, rate);
    if (!ctx) throw new Error('purkajan avaus epäonnistui');
    return new PcmDecoder(module, ctx);
  }

  constructor(module, ctx) {
    this.module = module;
    this.ctx = ctx;
    this.input = 0;
    this.inputSize = 0;
  }

  /** Syötepuskuri kasaan. Kehyskoko on vakio, joten tämä kasvaa kerran. */
  reserve(length) {
    if (length <= this.inputSize) return;
    if (this.input) this.module._free(this.input);
    this.input = this.module._malloc(length);
    this.inputSize = length;
  }

  /**
   * Purkaa yhden Matroskan lohkon.
   * @returns {Float32Array|null} lomitettu stereo, tai null jos kehys ei
   *   vielä tuottanut näytteitä
   */
  decode(bytes) {
    if (!this.ctx) return null;
    this.reserve(bytes.length);
    this.module.HEAPU8.set(bytes, this.input);
    return this.take(this.module._fa_decode(this.ctx, this.input, bytes.length));
  }

  /** Purkajaan ja muuntimeen jääneet näytteet ulos raidan lopussa. */
  flush() {
    return this.ctx ? this.take(this.module._fa_flush(this.ctx)) : null;
  }

  /**
   * Kopioi ulostulon pois wasmin muistista. Kopio on pakollinen: puskuri
   * kirjoitetaan uudelleen heti seuraavalla kutsulla, ja muistin kasvaessa
   * koko kasa vaihtuu toiseen ArrayBufferiin.
   */
  take(samples) {
    if (!(samples > 0)) return null;
    const at = this.module._fa_output(this.ctx) >> 2;
    const out = this.module.HEAPF32.slice(at, at + samples * this.module._fa_channels(this.ctx));
    this.module._fa_take(this.ctx);
    return out;
  }

  close() {
    if (!this.ctx) return;
    this.module._fa_close(this.ctx);
    if (this.input) this.module._free(this.input);
    this.ctx = 0;
    this.input = 0;
    this.inputSize = 0;
  }
}
