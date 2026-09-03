#!/usr/bin/env node
// The decoded-audio route measured in the browser itself.
//
// dev/wasm/verify.mjs proves the wasm decoder against ffmpeg in node; this
// proves the rest of the route where it actually runs. The real modules —
// transcode.js, mp4.js, remux.js — are loaded inside the extension in a
// browser started on a port and a profile of their own, fed the wasm test
// material (dev/wasm/media/), and what they produce is appended to a
// MediaSource and played. The fMP4 is decoded twice against the wasm
// decoder's own reference PCM — in the page with decodeAudioData, which is
// the demuxer and decoder MediaSource uses, and back here with ffmpeg — for
// the lag at which the two line up (sample-exact when the priming delay is
// corrected) and the SNR there. With --mkv the mock server's episodes are
// played through the remuxer as well, the AAC one as it is and the AC-3 one
// decoded, seek included.
//
//   node dev/audiocheck.mjs firefox [--mkv] [--out dir]
//   node dev/audiocheck.mjs chrome  [--mkv] [--out dir]
//
// Requires ffmpeg and ffprobe, and the test material from
// `sh dev/wasm/build.sh --test` (or its ffmpeg lines alone); --mkv needs
// `sh dev/mock/media.sh` too. The browser is started with its own profile
// under ~/.cache/kepuli-tv-audiocheck/ and quit at the end; a running
// development loop is left alone, because the ports differ.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(homedir(), '.cache', 'kepuli-tv-audiocheck');
const MEDIA = join(ROOT, 'dev', 'wasm', 'media');
const RATE = 48000;
const SHARED = ['player.html', 'background.js', 'js', 'css', 'vendor', 'icons'];

// The material and the block timestamps Matroska would give it: the files
// are constant bit rate, so the byte offset maps to time, piecewise where
// two rates are concatenated.
const FILES = [
  { file: 't2.eac3', codec: 'eac3', seconds: 5, label: 'E-AC-3 stereo' },
  { file: 't51.ac3', codec: 'ac3', seconds: 5, label: 'AC-3 5.1' },
  { file: 't51.dts', codec: 'dts', seconds: 5, label: 'DTS 5.1' },
  { file: 'mix.ac3', codec: 'ac3', seconds: 4, pieces: [[24192, 2], [72576, 4]], label: 'AC-3 mono→stereo' },
  { file: 't32.ac3', codec: 'ac3', seconds: 5, label: 'AC-3 32 kHz' },
];

const args = process.argv.slice(2);
const browser = args[0];
if (browser !== 'firefox' && browser !== 'chrome') {
  console.error('usage: node dev/audiocheck.mjs firefox|chrome [--mkv] [--out dir]');
  process.exit(2);
}
const outDir = resolve(args.includes('--out') ? args[args.indexOf('--out') + 1] : join(CACHE, 'out', browser));
mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------ the package */

/** The extension with the check's page in it, next to the shared files. */
function assemble(manifest) {
  const dir = join(CACHE, browser);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const skip = (path) => !/(^|\/)\.DS_Store$/.test(path);
  for (const name of SHARED) cpSync(join(ROOT, name), join(dir, name), { recursive: true, filter: skip });
  cpSync(manifest, join(dir, 'manifest.json'));
  cpSync(join(ROOT, 'dev', 'audiocheck'), join(dir, 'audiocheck'), { recursive: true });
  mkdirSync(join(dir, 'audiocheck', 'media'), { recursive: true });
  for (const f of FILES) {
    const from = join(MEDIA, f.file);
    if (!existsSync(from)) throw new Error(`${from} is missing: run sh dev/wasm/build.sh --test`);
    cpSync(from, join(dir, 'audiocheck', 'media', f.file));
  }
  return dir;
}

/* --------------------------------------------------------------- the spec */

const spec = { files: FILES, keepMp4: true, seconds: 5, seekTo: 60 };
let mock = null;
if (args.includes('--mkv')) {
  const port = 8790 + (browser === 'firefox' ? 3 : 4);
  const server = await import('./mock/server.mjs');
  if (!existsSync(join(ROOT, 'dev', 'mock', 'media', 'episode-ac3.mkv'))) throw new Error('dev/mock/media/episode-ac3.mkv is missing: run sh dev/mock/media.sh');
  mock = await server.startMockServer(port);
  // The AC-3 episode is the second of a first season and the AAC one with
  // the subtitles the first, so the ids are neighbours: both routes of the
  // remuxer, the decoded track and the track as it is.
  const ac3 = [...server.AC3_EPISODES][0];
  const stream = (id) => `http://127.0.0.1:${port}/series/demo/demo/${id}.mkv`;
  spec.mkvs = [
    { label: 'AAC episode', url: stream(Number(ac3) - 1) },
    { label: 'AC-3 episode', url: stream(ac3) },
  ];
}

/* ---------------------------------------------------------------- browsers */

/** Polls the page until the check has written its result. */
async function collect(evaluate) {
  const t0 = Date.now();
  for (;;) {
    const state = await evaluate('document.getElementById("out") ? document.getElementById("out").dataset.state : "nopage"');
    if (state === 'done') break;
    if (Date.now() - t0 > 240000) throw new Error(`the check timed out in state ${state}`);
    await sleep(500);
  }
  return JSON.parse(await evaluate('document.getElementById("out").textContent'));
}

async function inFirefox() {
  process.env.KEPULI_FIREFOX_PORT ||= '2838';
  process.env.KEPULI_FIREFOX_PROFILE ||= join(CACHE, 'firefox-profile');
  const { ensureFirefox, session, quit } = await import('../firefox/marionette.mjs');
  const dir = assemble(join(ROOT, 'firefox', 'manifest.json'));
  await ensureFirefox();
  const ff = await session();
  try {
    await ff.call('WebDriver:SetTimeouts', { script: 300000 });
    const id = await ff.installTemporary(dir);
    const url = await ff.extensionUrl(id, 'audiocheck/index.html');
    await ff.ensureWindow();
    await ff.navigate(`${url}#${encodeURIComponent(JSON.stringify(spec))}`);
    return await collect((script) => ff.evaluate(`return ${script}`));
  } finally {
    ff.close();
    await quit();
  }
}

async function inChrome() {
  process.env.KEPULI_DEV_PORT ||= '9232';
  process.env.KEPULI_DEV_PROFILE ||= join(CACHE, 'chrome-profile');
  const port = Number(process.env.KEPULI_DEV_PORT);
  const { ensureChrome, session } = await import('./screenshot.mjs');
  const dir = assemble(join(ROOT, 'manifest.json'));
  const http = async (path, init) => (await fetch(`http://127.0.0.1:${port}${path}`, init)).json();
  // The page starts playback by script, which no autoplay policy counts as
  // a gesture — the same flag dev/store-screenshots.mjs uses.
  await ensureChrome(['--autoplay-policy=no-user-gesture-required']);
  const { webSocketDebuggerUrl } = await http('/json/version');
  const chrome = session(webSocketDebuggerUrl);
  try {
    const { id } = await chrome.call('Extensions.loadUnpacked', { path: dir });
    // The fragment never reaches an HTTP endpoint, so the tab is opened blank
    // and navigated from inside the session, where the URL travels whole.
    const made = await http('/json/new?about:blank', { method: 'PUT' });
    const page = session(made.webSocketDebuggerUrl);
    try {
      await page.call('Page.navigate', { url: `chrome-extension://${id}/audiocheck/index.html#${encodeURIComponent(JSON.stringify(spec))}` });
      return await collect(async (expression) => (await page.call('Runtime.evaluate', { expression, returnByValue: true })).result.value);
    } finally {
      page.close();
    }
  } finally {
    try { await chrome.call('Browser.close'); } catch { /* already gone */ }
    chrome.close();
  }
}

/* ------------------------------------------------------------ the compare */

function decode(mp4Path) {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', mp4Path, '-f', 'f32le', '-ac', '2', '-ar', String(RATE), '-'], { maxBuffer: 1 << 28 });
  return new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
}

/** SNR of dec against ref with dec shifted by lag frames; the first skip frames left out. */
function snr(dec, ref, lag, skip) {
  let sig = 0, err = 0;
  const to = Math.min(ref.length / 2, dec.length / 2 - lag);
  for (let i = Math.max(skip, -lag); i < to; i++) {
    for (let c = 0; c < 2; c++) {
      const r = ref[i * 2 + c], d = dec[(i + lag) * 2 + c];
      sig += r * r; err += (d - r) * (d - r);
    }
  }
  return 10 * Math.log10(sig / Math.max(err, 1e-20));
}

/**
 * ffmpeg starts its output at the first packet whatever its time, so decoded
 * sample i is reference sample i + firstDts when the chain is right: the
 * expected lag is -firstDts. The material is sine tones, so a wide search
 * would find period aliases; ±48 samples is alias-free for every tone in it.
 */
function compare(f) {
  const mp4Path = join(outDir, `${f.file}.${f.codec}.mp4`);
  writeFileSync(mp4Path, Buffer.from(f.mp4, 'base64'));
  const dec = decode(mp4Path);
  const refBuf = readFileSync(join(MEDIA, `${f.file}.dref`));
  const ref = new Float32Array(refBuf.buffer, refBuf.byteOffset, refBuf.length / 4);
  const expected = -f.firstDts;
  const skip = 4800;
  const at = snr(dec, ref, expected, skip);
  let best = { off: 0, db: at };
  for (let off = -48; off <= 48; off++) {
    const db = snr(dec, ref, expected + off, skip);
    if (db > best.db) best = { off, db };
  }
  return { db: at, off: best.off, bestDb: best.db, offByDelay: snr(dec, ref, expected + f.delay, skip), offByFrame: snr(dec, ref, expected + f.frame, skip) };
}

/* -------------------------------------------------------------------- main */

const result = await (browser === 'firefox' ? inFirefox() : inChrome());
if (mock) mock.close();
writeFileSync(join(outDir, 'result.json'), JSON.stringify(result));
if (result.fatal) { console.error(result.fatal); process.exit(1); }

const version = (/(Firefox|Chrome)\/(\d+)/.exec(result.env.ua) || [])[2] || '?';
console.log(`${browser} ${version}  AAC ${result.env.encoders.aac}, Opus ${result.env.encoders.opus}  →  ${result.picked || 'no encoder'}` +
  (result.setup ? `, priming delay ${result.setup.delay} samples, measured in ${result.setup.ms} ms` : ''));

let failures = 0;
for (const f of result.files) {
  const label = (FILES.find((x) => x.file === f.file) || {}).label || f.file;
  if (f.fatal || !f.mp4) { failures++; console.log(`EI  ${label.padEnd(17)} ${f.fatal || 'no output'}`); continue; }
  const c = compare(f);
  const mse = f.mse.error || f.mse.mediaError || f.mse.playError || null;
  const played = !mse && f.mse.currentTime > 0.5 && f.mse.peakRms > 0.01;
  // The browser's own decode of the same fMP4 (decodeAudioData, the same
  // demuxer and decoder MediaSource uses) has to land where ffmpeg's does.
  const own = f.own || {};
  const ownOk = !own.error && own.off === 0 && own.db > 20;
  const ok = played && c.off === 0 && c.db > 20 && ownOk && f.errors.length === 0;
  if (!ok) failures++;
  console.log(
    `${ok ? 'ok  ' : 'EI  '}${label.padEnd(17)} ${f.codec.padEnd(4)} ${String(f.chunks).padStart(3)} frames  ${String(f.realtime).padStart(3)}x  ` +
    `MSE ${mse ? mse : `${f.mse.buffered.map(([a, b]) => `${a}–${b}`).join(', ')} s, rms ${f.mse.peakRms}`}  ` +
    `ffmpeg: ${c.off === 0 ? 'exact' : `off by ${c.off}`}, ${c.db.toFixed(1)} dB (off by the delay: ${c.offByDelay.toFixed(1)}, by a frame: ${c.offByFrame.toFixed(1)})  ` +
    `browser: ${own.error ? own.error : `${own.off === 0 ? 'exact' : `off by ${own.off}`}, ${own.db} dB${own.padded ? ', padded to 0' : ''}`}` +
    (f.errors.length ? `  encoder errors: ${f.errors.join('; ')}` : ''));
}
for (const r of result.remux || []) {
  if (r.fatal) { failures++; console.log(`EI  ${r.label.padEnd(17)} through the remuxer: ${r.fatal}`); continue; }
  // The AAC episode must go through as it is, the AC-3 one through the
  // transcoder, and the AC-3 one with sound — before and after the seek.
  // The AAC episode's track is silence by construction (anullsrc in
  // dev/mock/media.sh), so for it the buffered audio has to reach the end
  // of the file instead.
  const decoded = /AC-3/.test(r.label);
  const route = decoded ? Boolean(r.transcoder) && r.decodeTrack === 'A_AC3' : !r.transcoder && r.audioTrack === 'A_AAC';
  const audio = r.buffered && r.buffered.audio;
  const heard = decoded ? r.peakRms > 0.01 && (!r.seek || r.seek.peakRms > 0.01) : Array.isArray(audio) && audio.length > 0 && audio[audio.length - 1][1] > 100;
  const ok = route && heard && !r.errors.length && !r.videoError && r.currentTime > 2
    && (!r.seek || (r.seek.currentTime > r.seek.to && !r.seek.videoError));
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'EI  '}${r.label.padEnd(17)} through the remuxer: ${r.transcoder ? `decoded to ${r.transcoder.codec}` : `${r.audioTrack || 'no audio'} as it is`}, ` +
    `first picture in ${r.firstAppendMs} ms, ${r.currentTime} s played, rms ${r.peakRms}, audio buffered ${JSON.stringify(r.buffered && r.buffered.audio)}` +
    (r.seek ? `; seek to ${r.seek.to} s → ${r.seek.currentTime} s, rms ${r.seek.peakRms}` : '') +
    (r.notices.length ? `; notices: ${r.notices.join(' | ')}` : '') + (r.errors.length ? `; errors: ${r.errors.join(' | ')}` : '') +
    (r.videoError ? `; video error: ${r.videoError}` : ''));
}
console.log(failures ? `\n${failures} check(s) failed. Files in ${outDir}` : `\nAll checks pass. Files in ${outDir}`);
process.exit(failures ? 1 : 0);
