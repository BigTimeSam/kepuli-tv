// Decoded audio back to AAC or Opus for MediaSource.
//
// Chrome decodes neither AC-3, E-AC-3 nor DTS, and in the measured library
// 53% of the audio tracks in mkv episodes are one of those. MediaSource
// will not take PCM, so decoded audio has to be re-encoded into something
// it will take — with the WebCodecs encoder that is already in the browser
// and, measured, fast enough (decoding 150–1300x, encoding in the same
// class).
//
// Which encoder is a per-browser question. AAC where it is on offer: Chrome
// on macOS and Windows encodes it with the platform's own encoder, and an
// AAC track is what every MediaSource takes. Firefox has no AAC encoder at
// all — measured, AudioEncoder.isConfigSupported answers false — and Chrome
// on Linux has none either; both encode Opus, and both take Opus in MP4.
// So the candidates are asked in that order, once per page, and the first
// that the encoder and MediaSource both accept serves every track. The
// container side of the choice is in mp4.js: an mp4a entry with the esds
// for AAC, an Opus entry with the dOps for Opus.
//
// Two measured constraints set the format:
//
//   - The AAC encoder accepts only 44,100 and 48,000 Hz. AC-3 also allows
//     32,000, and the channel count may change mid-track. That is why the
//     wasm decoder brings everything down to a fixed format (stereo,
//     48 kHz) before the encoder — Opus wants 48 kHz too.
//   - The encoder has a priming delay that it neither reports nor corrects:
//     2112 samples, or 44 ms, for AAC when measured, and Opus has a
//     lookahead of its own (libopus's 312 samples, 6.5 ms). Without
//     correction the audio would lag the picture by that much throughout.
//     The figure is platform-specific (2112 is macOS's AudioToolbox), so it
//     is measured at run time: a known impulse is encoded and decoded back
//     with the browser's own decoder.
//
// The timestamps are chained as they are for audio elsewhere: on the
// MediaSource side an AAC frame is exactly 1024 samples and an Opus frame
// 960 (20 ms), and the chain starts from the first block's PTS minus the
// priming delay.

import { PcmDecoder, decodable } from './ffaudio.js';

export const RATE = 48000;
export const CHANNELS = 2;
const BITRATE = 192000;

// The encoders in order of preference. `codec` is the WebCodecs string,
// `mime` what MediaSource is asked for, `frame` the samples in one encoded
// frame at 48 kHz — fixed for both: AAC-LC's 1024, and Opus's 20 ms, which
// is pinned in the configuration so that the chain's fixed frame holds.
export const ENCODERS = [
  { name: 'aac', codec: 'mp4a.40.2', mime: 'mp4a.40.2', frame: 1024 },
  { name: 'opus', codec: 'opus', mime: 'opus', frame: 960 },
];

// A jump in timestamps larger than this is not jitter but a gap, or a
// resume after an interrupted download: the chain restarts.
const GAP_NS = 250e6;

// The encoder's queue is kept short. Decoding is so fast that without this
// the whole buffered minute would be pushed at the encoder in one go.
const MAX_QUEUE = 32;
const QUEUE_POLL_MS = 4;

function encoderConfig(encoder) {
  const config = { codec: encoder.codec, sampleRate: RATE, numberOfChannels: CHANNELS, bitrate: BITRATE };
  if (encoder.name === 'opus') config.opus = { frameDuration: 20000 };
  return config;
}

/* ------------------------------------------------------------ the choice */

let choosing = null;      // Promise<{encoder, delay, description}|null>
let chosen;               // the encoder once the question is answered; undefined until then

/**
 * The encoder this browser has, with its priming delay and the decoder
 * configuration it reports, or null. Asked once per page: the answer
 * depends on the browser and the platform, not on the file.
 *
 * A candidate counts only once it has actually encoded. isConfigSupported
 * and isTypeSupported are the cheap first filter, and not always the
 * truth: Chrome answers for AAC from its build, and the platform encoder
 * behind the answer is only instantiated at configure() — a Windows N
 * without the Media Feature Pack has the answer but not the encoder. So the
 * measurement is part of the choice, and a candidate that fails it gives
 * way to the next. Only a failure in the measurement itself is asked again
 * on the next track; a browser that supports nothing is not.
 */
export function encoderSetup() {
  if (!choosing) choosing = choose().then(({ setup, retry }) => {
    chosen = setup ? setup.encoder : null;
    if (!setup && retry) choosing = null;
    return setup;
  });
  return choosing;
}

async function choose() {
  if (typeof AudioEncoder === 'undefined' || typeof AudioDecoder === 'undefined') return { setup: null, retry: false };
  if (typeof MediaSource === 'undefined') return { setup: null, retry: false };
  let tried = false;
  for (const encoder of ENCODERS) {
    try {
      if (!MediaSource.isTypeSupported(`audio/mp4; codecs="${encoder.mime}"`)) continue;
      const check = await AudioEncoder.isConfigSupported(encoderConfig(encoder));
      if (!check || !check.supported) continue;
      tried = true;
      const { delay, description } = await measure(encoder);
      return { setup: { encoder, delay, description }, retry: false };
    } catch (err) {
      console.warn(`[iptv] the ${encoder.name} encoder is not usable`, err);
    }
  }
  return { setup: null, retry: tried };
}

/** The encoder alone, or null. */
export const pickEncoder = () => encoderSetup().then((setup) => (setup ? setup.encoder : null));

/**
 * Whether the decoded audio has somewhere to go. For the list rows, which
 * are painted synchronously: hopeful until the question has been answered,
 * and honest after — a browser without an encoder marks the row silent.
 */
export const hasEncoder = () => chosen !== null;

/* ------------------------------------------------------- the measurement */

/**
 * Encodes an impulse and decodes it back. The difference between the
 * impulse's known position and the decoded one is the encoder's priming
 * delay.
 *
 * The decoder is configured the way MediaSource will see the track: with
 * the AudioSpecificConfig for AAC, because the esds carries it, and with
 * nothing for Opus, because the dOps that mp4.js writes claims no
 * pre-skip. Whatever delay survives this round trip is what playback would
 * have, and that is what is taken off the timestamps.
 */
async function measure(encoder) {
  const FRAME = encoder.frame;
  const ONSET = 4 * FRAME;
  const TOTAL = 12 * FRAME;
  const packets = [];
  let config = null;

  const enc = new AudioEncoder({
    output: (chunk, meta) => {
      if (meta && meta.decoderConfig && !config) config = meta.decoderConfig;
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      packets.push({ timestamp: chunk.timestamp, data });
    },
    error: (err) => console.warn('[iptv] encoder measurement', err),
  });
  enc.configure(encoderConfig(encoder));

  for (let at = 0; at < TOTAL; at += FRAME) {
    const data = new Float32Array(FRAME * CHANNELS);
    for (let i = 0; i < FRAME; i++) {
      // A cosine starts at its peak, so the impulse's first sample crosses
      // the threshold at once — a sine would start from zero and the
      // measurement would come out late.
      const s = at + i;
      const value = s < ONSET ? 0 : 0.5 * Math.cos((2 * Math.PI * 1000 * (s - ONSET)) / RATE);
      data[i * CHANNELS] = value;
      data[i * CHANNELS + 1] = value;
    }
    enc.encode(new AudioData({
      format: 'f32', sampleRate: RATE, numberOfFrames: FRAME, numberOfChannels: CHANNELS,
      timestamp: Math.round((at * 1e6) / RATE), data,
    }));
  }
  await enc.flush();
  try { enc.close(); } catch { /* closed itself on an error */ }
  if (!packets.length) throw new Error('the encoder produced nothing');
  if (encoder.name === 'aac' && !config) throw new Error('the encoder did not report its configuration');

  const description = encoder.name === 'aac' && config && config.description
    ? new Uint8Array(config.description.buffer ? config.description.buffer : config.description).slice()
    : null;

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
  const decoderConfig = { codec: encoder.codec, sampleRate: RATE, numberOfChannels: CHANNELS };
  if (description) decoderConfig.description = description;
  decoder.configure(decoderConfig);
  for (const packet of packets) {
    decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp: packet.timestamp, data: packet.data }));
  }
  await decoder.flush();
  decoder.close();

  let at = 0;
  let onset = -1;
  for (const frame of frames) {
    for (let i = 0; i < frame.length && onset < 0; i++) {
      // Half the impulse amplitude: the transform spreads the onset in both
      // directions, and the ringing does not exceed this.
      if (Math.abs(frame.data[i * frame.channels]) > 0.25) onset = at + i;
    }
    at += frame.length;
  }
  // A delay that could not be measured is better left at zero than
  // guessed: the audio is then a few tens of milliseconds late, which is
  // audible but not broken.
  const delay = onset < 0 ? 0 : Math.max(0, onset - ONSET);
  return { delay, description };
}

/* ------------------------------------------------------------ the track */

/**
 * One audio track decoded and re-encoded. Life cycle:
 * open() → push() for every block → take() the finished frames →
 * finish() at the end of the track → close().
 */
export class AudioTranscoder {
  /** Whether decoding and encoding are possible in this browser. */
  static async available(codecId) {
    if (!decodable(codecId)) return false;
    try {
      return Boolean(await pickEncoder());
    } catch {
      return false;
    }
  }

  static async open(codecId, onError) {
    const setup = await encoderSetup();
    if (!setup) throw new Error('the browser has neither an AAC nor an Opus encoder');
    const decoder = await PcmDecoder.open(codecId, RATE);
    return new AudioTranscoder(decoder, setup.encoder, setup.delay, setup.description, onError);
  }

  constructor(decoder, encoder, delay, description, onError) {
    this.decoder = decoder;
    this.codec = encoder.name;        // 'aac' or 'opus': the sample entry mp4.js writes
    this.mime = encoder.mime;         // what MediaSource is asked for
    this.frame = encoder.frame;       // samples in one encoded frame
    this.delay = delay;
    this.description = description;   // the AudioSpecificConfig for AAC, null for Opus
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
    this.encoder.configure(encoderConfig(encoder));
  }

  collect(chunk) {
    const dts = this.nextDts;
    this.nextDts += this.frame;
    // A negative time is the encoder's priming at the start of the file:
    // there is no audio in it yet, and MediaSource would not take it.
    if (dts < 0) return;
    const data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);
    this.chunks.push({ data, dts, duration: this.frame });
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

  /** The finished frames and their times. Empties the queue. */
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
