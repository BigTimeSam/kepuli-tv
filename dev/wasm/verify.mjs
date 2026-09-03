#!/usr/bin/env node
// Compares the wasm decoder's output with ffmpeg's own from the same
// bitstream.
//
// The material is produced with ffmpeg (dev/wasm/build.sh --test), and the
// reference PCM is asked for with the same chain the wrapper uses:
// `-downmix stereo -ac 2`. When the decoding is right, the difference is
// only float rounding (~1e-7).
//
// Usage: node dev/wasm/verify.mjs [material directory]

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import createFfAudio from '../../vendor/ffaudio/ffaudio.js';

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
console.log(failures ? `\n${failures} vertailua ei täsmää.` : '\nKaikki täsmäävät.');
process.exit(failures ? 1 : 0);
