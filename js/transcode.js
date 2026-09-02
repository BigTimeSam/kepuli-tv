// Decoded audio back to AAC for MediaSource.
//
// Chrome decodes neither AC-3, E-AC-3 nor DTS, and in the measured library
// 53% of the audio tracks in mkv episodes are one of those. MediaSource
// will not take PCM, so decoded audio has to be re-encoded into something
// it will take — the WebCodecs AAC encoder is already in the browser and,
// measured, fast enough (decoding 150–1300x, encoding in the same class).
//
// Two measured constraints set the format:
//
//   - The encoder accepts only 44,100 and 48,000 Hz. AC-3 also allows
//     32,000, and the channel count may change mid-track. That is why the
//     wasm decoder brings everything down to a fixed format (stereo,
//     48 kHz) before the encoder.
//   - The encoder has a priming delay that it neither reports nor corrects:
//     2112 samples, or 44 ms, when measured. Without correction the audio
//     would lag the picture by that much throughout. The figure is
//     platform-specific (2112 is macOS's AudioToolbox), so it is measured
//     at run time: a known impulse is encoded and decoded back with the
//     browser's own decoder.
//
// The timestamps are chained as they are for audio elsewhere: on the
// MediaSource side an AAC frame is exactly 1024 samples, and the chain
// starts from the first block's PTS minus the priming delay.

import { PcmDecoder, decodable } from './ffaudio.js';

export const RATE = 48000;
export const CHANNELS = 2;
const AAC_FRAME = 1024;
const CODEC = 'mp4a.40.2';
const BITRATE = 192000;

// A jump in timestamps larger than this is not jitter but a gap, or a
// resume after an interrupted download: the chain restarts.
const GAP_NS = 250e6;

// The encoder's queue is kept short. Decoding is so fast that without this
// the whole buffered minute would be pushed at the encoder in one go.
const MAX_QUEUE = 32;
const QUEUE_POLL_MS = 4;

/**
 * The encoder's priming delay and the AudioSpecificConfig. Both depend only
 * on the configuration, so the measurement is made once per page.
 */
let setup = null;
export function encoderSetup() {
  if (!setup) setup = measure().catch((err) => {
    console.warn('[iptv] encoder measurement failed', err);
    setup = null;
    throw err;
  });
  return setup;
}

/**
 * Encodes an impulse and decodes it back. The difference between the
 * impulse's known position and the decoded one is the encoder's priming
 * delay.
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
    error: (err) => console.warn('[iptv] encoder measurement', err),
  });
  encoder.configure({ codec: CODEC, sampleRate: RATE, numberOfChannels: CHANNELS, bitrate: BITRATE });

  for (let at = 0; at < TOTAL; at += AAC_FRAME) {
    const data = new Float32Array(AAC_FRAME * CHANNELS);
    for (let i = 0; i < AAC_FRAME; i++) {
      // A cosine starts at its peak, so the impulse's first sample crosses
      // the threshold at once — a sine would start from zero and the
      // measurement would come out late.
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
  if (!config) throw new Error('the encoder did not report its configuration');

  const frames = [];
  const decoder = new AudioDecoder({
    output: (frame) => {
      const data = new Float32Array(frame.numberOfFrames * frame.numberOfChannels);
      frame.copyTo(data, { planeIndex: 0, format: 'f32' });
      frames.push({ data, channels: frame.numberOfChannels, length: frame.numberOfFrames });
      frame.close();
    },
    error: (err) => console.warn('[iptv] measurement decode', err),
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
      // Half the impulse amplitude: the MDCT spreads the onset in both
      // directions, and the ringing does not exceed this.
      if (Math.abs(frame.data[i * frame.channels]) > 0.25) onset = at + i;
    }
    at += frame.length;
  }
  // A delay that could not be measured is better left at zero than
  // guessed: the audio is then 44 ms late, which is audible but not broken.
  const delay = onset < 0 ? 0 : Math.max(0, onset - ONSET);
  const description = config.description
    ? new Uint8Array(config.description.buffer ? config.description.buffer : config.description).slice()
    : null;
  return { delay, description };
}

/**
 * One audio track decoded and re-encoded. Life cycle:
 * open() → push() for every block → take() the finished frames →
 * finish() at the end of the track → close().
 */
export class AudioTranscoder {
  /** Whether decoding and encoding are possible in this browser. */
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
    this.chainPts = null;     // the PTS of the chain's first block
    this.chainSamples = 0;    // samples fed into the chain
    this.fed = 0;             // samples fed over the whole life cycle
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
    // A negative time is the encoder's priming at the start of the file:
    // there is no audio in it yet, and MediaSource would not take it.
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

  /** The PTS the chain expects next, in nanoseconds. */
  expectedPts() {
    return this.chainPts + (this.chainSamples * 1e9) / RATE;
  }

  /**
   * One Matroska block in. A jump in the timestamp starts a new chain: the
   * encoder is drained first, so that the old frames still get the old
   * chain's times.
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
   * Waits for the queue to drain. Waits, specifically, rather than
   * flushing: flush() forces the encoder to emit a partial frame too, which
   * it pads with silence. The frame chain would stretch on every flush and
   * the audio would drift away from the picture — measured, 60 seconds of
   * picture came out as 69 seconds of audio. Flushing therefore belongs
   * only to a chain change and to the end of a track.
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
      // The encoder requires an increasing timestamp. It is computed from
      // the samples fed rather than from the block PTS, which is not
      // exactly continuous.
      timestamp: Math.round((this.fed * 1e6) / RATE),
      data: pcm,
    }));
    this.fed += length;
    this.chainSamples += length;
  }

  /** Waits until the encoder has emitted everything that was fed in. */
  async drain() {
    if (this.closed) return;
    try { await this.encoder.flush(); } catch (err) { if (!this.closed) this.onError(err); }
  }

  /** End of track: the decoder's tail to the encoder, then drain it. */
  async finish() {
    if (this.closed) return;
    const tail = this.decoder.flush();
    if (tail) this.feed(tail);
    await this.drain();
  }

  /**
   * Starts over after a seek or a retry. The old frames are thrown away:
   * they belong to a time that has been left behind.
   */
  async restart() {
    await this.drain();
    this.chunks = [];
    this.chainPts = null;
  }

  /** The finished AAC frames and their times. Empties the queue. */
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
