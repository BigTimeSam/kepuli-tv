// AC-3, E-AC-3 and DTS decoding with wasm, and AAC encoding where the browser has no encoder.
//
// The decoder itself is vendor/ffaudio (built from FFmpeg, LGPL 2.1+); this
// is the JS side around it: loading the module once, an input buffer
// allocated on the heap, and copying the output out of wasm memory before
// the next call.
//
// The output is always interleaved stereo at the requested sample rate —
// the reason is in transcode.js: the browser's encoder, AAC or Opus, does
// not tolerate the channel count or the sample rate changing mid-track, and
// both occur in the library.

import createFfAudio from '../vendor/ffaudio/ffaudio.js';

// Matroska codec id → vendor/ffaudio's own number.
const CODEC = {
  'A_AC3': 0,
  'A_EAC3': 1,
  'A_DTS': 2, 'A_DTS/EXPRESS': 2, 'A_DTS/LOSSLESS': 2,
};

/** Whether the wasm decoder handles this track. */
export const decodable = (codecId) => CODEC[codecId] !== undefined;

// The module is loaded once per page: the build is 712 kB, and fetching it
// again for every episode is not worth it.
let loading = null;
const load = () => {
  if (!loading) loading = createFfAudio();
  return loading;
};

export class PcmDecoder {
  /**
   * @param {string} codecId the Matroska CodecID
   * @param {number} rate output sample rate
   */
  static async open(codecId, rate) {
    const codec = CODEC[codecId];
    if (codec === undefined) throw new Error(`codec ${codecId} cannot be decoded`);
    const module = await load();
    const ctx = module._fa_open(codec, rate);
    if (!ctx) throw new Error('opening the decoder failed');
    return new PcmDecoder(module, ctx);
  }

  constructor(module, ctx) {
    this.module = module;
    this.ctx = ctx;
    this.input = 0;
    this.inputSize = 0;
  }

  /** The input buffer on the heap. The frame size is fixed, so this grows once. */
  reserve(length) {
    if (length <= this.inputSize) return;
    if (this.input) this.module._free(this.input);
    this.input = this.module._malloc(length);
    this.inputSize = length;
  }

  /**
   * Decodes one Matroska block.
   * @returns {Float32Array|null} interleaved stereo, or null when the frame
   *   has not produced samples yet
   */
  decode(bytes) {
    if (!this.ctx) return null;
    this.reserve(bytes.length);
    this.module.HEAPU8.set(bytes, this.input);
    return this.take(this.module._fa_decode(this.ctx, this.input, bytes.length));
  }

  /** Flushes samples left in the decoder and resampler at the end of a track. */
  flush() {
    return this.ctx ? this.take(this.module._fa_flush(this.ctx)) : null;
  }

  /**
   * Copies the output out of wasm memory. The copy is mandatory: the
   * buffer is rewritten on the very next call, and when the memory grows
   * the whole heap moves to a different ArrayBuffer.
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

/**
 * FFmpeg's AAC encoder from the same module, for a browser without a
 * WebCodecs encoder (transcode.js). Interleaved stereo in, raw AAC-LC
 * frames out, one per 1024 samples; the AudioSpecificConfig and the
 * priming delay come from the encoder itself, so nothing has to be
 * measured at run time.
 *
 * flush() empties the encoder for good, as FFmpeg's encoders allow no more
 * input after it, so a fresh one is opened in its place: the next frames
 * then carry a new priming, which is what transcode.js expects after a
 * flush from WebCodecs too.
 */
export class AacEncoder {
  /**
   * @param {number} rate input and output sample rate
   * @param {number} bitrate bits per second
   */
  static async open(rate, bitrate) {
    const module = await load();
    const encoder = new AacEncoder(module, rate, bitrate);
    encoder.reopen();
    return encoder;
  }

  constructor(module, rate, bitrate) {
    this.module = module;
    this.rate = rate;
    this.bitrate = bitrate;
    this.ctx = 0;
    this.input = 0;
    this.inputSize = 0;
    /** @type {Uint8Array|null} the AudioSpecificConfig for the esds */
    this.config = null;
    this.delay = 0;
  }

  reopen() {
    if (this.ctx) this.module._fe_close(this.ctx);
    this.ctx = this.module._fe_open(this.rate, this.bitrate);
    if (!this.ctx) throw new Error('opening the AAC encoder failed');
    const at = this.module._fe_config(this.ctx);
    this.config = this.module.HEAPU8.slice(at, at + this.module._fe_config_size(this.ctx));
    this.delay = this.module._fe_delay(this.ctx);
  }

  /**
   * @param {Float32Array} pcm interleaved stereo
   * @returns {Uint8Array[]} the frames finished by this input, possibly none
   */
  encode(pcm) {
    if (!this.ctx) return [];
    const bytes = pcm.length * 4;
    if (bytes > this.inputSize) {
      if (this.input) this.module._free(this.input);
      this.input = this.module._malloc(bytes);
      this.inputSize = bytes;
    }
    this.module.HEAPF32.set(pcm, this.input >> 2);
    return this.take(this.module._fe_encode(this.ctx, this.input, pcm.length / 2));
  }

  /** The partial frame and everything held back, then a fresh encoder. */
  flush() {
    if (!this.ctx) return [];
    const frames = this.take(this.module._fe_flush(this.ctx));
    this.reopen();
    return frames;
  }

  /** Copies the frames out of wasm memory, for the same reason as PcmDecoder.take. */
  take(count) {
    if (count < 0) throw new Error('AAC encoding failed');
    const frames = [];
    let at = this.module._fe_output(this.ctx);
    const sizes = this.module._fe_sizes(this.ctx) >> 2;
    for (let i = 0; i < count; i++) {
      const length = this.module.HEAP32[sizes + i];
      frames.push(this.module.HEAPU8.slice(at, at + length));
      at += length;
    }
    this.module._fe_take(this.ctx);
    return frames;
  }

  close() {
    if (this.ctx) this.module._fe_close(this.ctx);
    if (this.input) this.module._free(this.input);
    this.ctx = 0;
    this.input = 0;
    this.inputSize = 0;
  }
}
