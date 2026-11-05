#!/usr/bin/env node
// Compares the wasm decoder's output with ffmpeg's own from the same
// bitstream.
//
// The material is produced with ffmpeg (dev/wasm/build.sh --test), and the
// reference PCM is asked for with the same chain the wrapper uses:
// `-downmix stereo -ac 2`. When the decoding is right, the difference is
// only float rounding (~1e-7).
//
// The AAC encoder is checked the other way round: its frames, wrapped in
// ADTS headers, are decoded with ffmpeg, and the impulse at the start has
// to come out exactly the encoder's reported delay late — that report is
// all transcode.js corrects the timestamps with, as there is no WebCodecs
// decoder to measure with in the browsers that need this encoder. The
// frames also must not depend on how the input was cut.
//
// Usage: node dev/wasm/verify.mjs [material directory]

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import createFfAudio from '../../vendor/ffaudio/ffaudio.js';
import { AacEncoder } from '../../js/ffaudio.js';

const CODEC = { ac3: 0, eac3: 1, dts: 2 };
const RATE = 48000;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dir = process.argv[2] || join(ROOT, 'dev', 'wasm', 'media');

// A difference larger than this means a decoding error; float rounding
// stays below it.
const TOLERANCE = 1e-5;

async function decode(path, codec, chunkSize) {
  const M = await createFfAudio();
  const ctx = M._fa_open(CODEC[codec], RATE);
  if (!ctx) throw new Error('fa_open epäonnistui');

  const bytes = readFileSync(path);
  const inPtr = M._malloc(chunkSize);
  const parts = [];

  const take = (n) => {
    if (n < 0) throw new Error('purku epäonnistui');
    if (n === 0) return;
    const ptr = M._fa_output(ctx);
    parts.push(M.HEAPF32.slice(ptr >> 2, (ptr >> 2) + n * M._fa_channels(ctx)));
    M._fa_take(ctx);
  };

  const t0 = performance.now();
  for (let at = 0; at < bytes.length; at += chunkSize) {
    const slice = bytes.subarray(at, Math.min(bytes.length, at + chunkSize));
    M.HEAPU8.set(slice, inPtr);
    take(M._fa_decode(ctx, inPtr, slice.length));
  }
  take(M._fa_flush(ctx));
  const ms = performance.now() - t0;

  const channels = M._fa_channels(ctx);
  const rate = M._fa_sample_rate(ctx);
  M._free(inPtr);
  M._fa_close(ctx);

  let total = 0;
  for (const p of parts) total += p.length;
  const pcm = new Float32Array(total);
  let at = 0;
  for (const p of parts) { pcm.set(p, at); at += p.length; }
  return { pcm, channels, rate, ms };
}

function readRef(path) {
  const buf = readFileSync(path);
  return new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
}

function compare(a, b) {
  const n = Math.min(a.length, b.length);
  let maxDiff = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d > maxDiff) maxDiff = d;
  }
  return { n, maxDiff, sameLength: a.length === b.length };
}

// A small chunk lands between frame boundaries and exercises the parser's
// state; a large chunk measures the speed.
const CHUNKS = [4096, 1 << 20];

const cases = [
  ['t51.ac3', 'ac3', 'AC-3 5.1 640k'],
  ['t51.eac3', 'eac3', 'E-AC-3 5.1 640k'],
  ['t51_192.eac3', 'eac3', 'E-AC-3 5.1 192k'],
  ['t2.eac3', 'eac3', 'E-AC-3 stereo 128k'],
  ['t51.dts', 'dts', 'DTS 5.1 (swr laskee)'],
  // The channel count changes mid-stream. The output format is fixed, so
  // the change must show up as nothing but a rebuild of the resampler.
  ['mix.ac3', 'ac3', 'AC-3 mono→stereo'],
  // 32 kHz is not acceptable to the browser's encoders, AAC or Opus, so it
  // has to be resampled.
  ['t32.ac3', 'ac3', 'AC-3 32 kHz → 48 kHz'],
];

let failures = 0;
for (const [file, codec, label] of cases) {
  const path = join(dir, file);
  if (!existsSync(path) || !existsSync(`${path}.dref`)) {
    console.log(`--  ${label} ohitettu — aineisto puuttuu`);
    continue;
  }
  const ref = readRef(`${path}.dref`);
  for (const chunk of CHUNKS) {
    const { pcm, channels, rate, ms } = await decode(path, codec, chunk);
    const c = compare(pcm, ref);
    const ok = c.maxDiff < TOLERANCE && c.sameLength && channels === 2 && rate === RATE;
    if (!ok) failures++;
    const secs = c.n / channels / rate;
    console.log(
      `${ok ? 'ok  ' : 'EI  '}${label.padEnd(21)} pala ${String(chunk).padStart(7)}  ` +
      `${channels}ch ${rate}Hz  ${pcm.length}${c.sameLength ? '' : ` != ${ref.length}`} näytettä  ` +
      `maxDiff ${c.maxDiff.toExponential(2)}  ${(secs / (ms / 1000)).toFixed(0)}x reaaliaika`);
  }
}
/* ------------------------------------------------------------ the encoder */

// ADTS around raw AAC-LC frames, 48 kHz stereo: what ffmpeg reads without
// a container.
function adts(frames) {
  const parts = [];
  for (const frame of frames) {
    const length = frame.length + 7;
    parts.push(Buffer.from([0xFF, 0xF1, (1 << 6) | (3 << 2), (2 << 6) | (length >> 11),
      (length >> 3) & 0xFF, ((length & 7) << 5) | 0x1F, 0xFC]), Buffer.from(frame));
  }
  return Buffer.concat(parts);
}

async function encode(pcm, block) {
  const encoder = await AacEncoder.open(RATE, 192000);
  const frames = [];
  const t0 = performance.now();
  for (let at = 0; at < pcm.length; at += block * 2) frames.push(...encoder.encode(pcm.subarray(at, at + block * 2)));
  frames.push(...encoder.flush());
  const ms = performance.now() - t0;
  const { delay, config } = encoder;
  encoder.close();
  return { frames, delay, config, ms };
}

const source = join(dir, 't51.ac3');
if (!existsSync(`${source}.dref`)) {
  console.log('--  AAC encoder skipped — material missing');
} else {
  // The decoded 5.1 tones, with a cosine impulse in front at a known
  // sample: a cosine starts at its peak, so its onset is sharp.
  const tones = readRef(`${source}.dref`);
  const ONSET = 4800;
  const pcm = new Float32Array(tones.length + ONSET * 2);
  pcm.set(tones, ONSET * 2);
  for (let i = 0; i < 480; i++) {
    const v = 0.8 * Math.cos((2 * Math.PI * 1000 * i) / RATE);
    pcm[(ONSET + i) * 2] = v;
    pcm[(ONSET + i) * 2 + 1] = v;
  }
  const small = await encode(pcm, 1536);
  const large = await encode(pcm, 1 << 16);
  const same = small.frames.length === large.frames.length
    && small.frames.every((f, i) => Buffer.compare(Buffer.from(f), Buffer.from(large.frames[i])) === 0);

  const tmp = mkdtempSync(join(tmpdir(), 'ffaudio-aac-'));
  writeFileSync(join(tmp, 'out.aac'), adts(small.frames));
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', join(tmp, 'out.aac'), '-f', 'f32le', '-acodec', 'pcm_f32le', join(tmp, 'out.pcm')]);
  const out = readRef(join(tmp, 'out.pcm'));
  rmSync(tmp, { recursive: true, force: true });

  let onset = -1;
  for (let i = 0; i < out.length / 2 && onset < 0; i++) if (Math.abs(out[i * 2]) > 0.4) onset = i;
  const lag = onset - ONSET;
  // The SNR over the tones, aligned by the reported delay and with the
  // edges left out, where the transform spreads the impulse and the end.
  let signal = 0;
  let noise = 0;
  for (let i = (ONSET + 2400) * 2; i < pcm.length - 4800; i++) {
    const d = out[i + small.delay * 2] - pcm[i];
    signal += pcm[i] * pcm[i];
    noise += d * d;
  }
  const snr = 10 * Math.log10(signal / noise);
  // AudioSpecificConfig: AAC-LC (2), 48 kHz (index 3), two channels.
  const configOk = small.config.length >= 2 && small.config[0] === 0x11 && (small.config[1] & 0xF8) === 0x90;
  const ok = same && lag === small.delay && snr > 30 && configOk;
  if (!ok) failures++;
  const secs = pcm.length / 2 / RATE;
  console.log(
    `${ok ? 'ok  ' : 'EI  '}AAC encoder           delay ${small.delay}, impulse ${lag} late  ` +
    `SNR ${snr.toFixed(1)} dB  ${same ? 'same frames at any cut' : 'FRAMES DEPEND ON THE CUT'}  ` +
    `config ${Buffer.from(small.config).toString('hex')}  ${(secs / (large.ms / 1000)).toFixed(0)}x real time`);
}

console.log(failures ? `\n${failures} vertailua ei täsmää.` : '\nKaikki täsmäävät.');
process.exit(failures ? 1 : 0);
