// AC-3, E-AC-3 and DTS decoding with wasm.
//
// The decoder itself is vendor/ffaudio (built from FFmpeg, LGPL 2.1+); this
// is the JS side around it: loading the module once, an input buffer
// allocated on the heap, and copying the output out of wasm memory before
// the next call.
//
// The output is always interleaved stereo at the requested sample rate —
// the reason is in transcode.js: the browser's AAC encoder does not
// tolerate the channel count or the sample rate changing mid-track, and
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

// The module is loaded once per page: the build is 628 kB, and fetching it
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
