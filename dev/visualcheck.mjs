#!/usr/bin/env node
// The five store views compared with pictures of how they looked, pixel by
// pixel, so that a change nobody meant shows up before a release does; and
// the same five in the light theme, and the channels at 600 px wide (both
// panes: the playing channel and the list).
//
//   node dev/visualcheck.mjs             take the views and compare them with
//                                        dev/visual/<set><view>.png
//   node dev/visualcheck.mjs --update    take them and make them the new reference
//   node dev/visualcheck.mjs --keep DIR  write the pictures and the difference images
//                                        to DIR rather than a temporary directory
//
// Why: in 1.6.3 the film cover in the details strip stretched into a tall bar.
// Every test passed, because no test looks; it reached the store screenshots
// and the demo video before anyone saw it. This looks.
//
// Three sets of views, each one run of dev/store-screenshots.mjs with its
// switches: the store's own five (dark, 1280x800, no prefix), the five again
// in the light theme (light-*), whose colours are a set of their own that
// a change to the dark ones can leave behind, and the channels in the
// narrow layout at 600x800 (narrow-*: the player's pane and the list's),
// where the columns give way to one pane and a change made at the desktop
// width can break it unseen.
//
// The views are dev/store-screenshots.mjs's, taken in a headless Chrome of
// its own (KEPULI_DEV_PORT, default 9351, and a temporary profile), against
// the mock server with its clock and the page's set to one fixed moment
// (KEPULI_MOCK_NOW), so that the guide and the programmes on the rows are
// the same on every run. What still moves by itself — the picture, the
// subtitles, progress bars, the now line — is left out: the screenshot tool
// writes those boxes beside each picture, and both runs' boxes are masked.
//
// A pixel counts as changed when a colour channel differs by more than 40 of
// 255 (anti-aliasing and video edges stay under it); a view fails when more
// than 150 pixels changed. On failure the difference images, the changed
// pixels in red over the new picture, and the boxes of the changes are
// printed and kept.
//
// The references are specific to the machine's fonts and rendering: they
// were made on macOS, and a run elsewhere differs everywhere text is. Make
// your own with --update on another system, and do not commit those. When a
// change to the views is meant, check the difference images, then --update
// and commit the new references with the change.
//
// No dependencies: PNG is read and written here with node:zlib.

import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REFS = join(ROOT, 'dev', 'visual');
const FIVE = ['01-channels', '02-guide', '03-series', '04-subtitles', '05-movie'];
const SETS = [
  { prefix: '', env: {}, views: FIVE },
  { prefix: 'light-', env: { KEPULI_SHOTS_THEME: 'light' }, views: FIVE },
  { prefix: 'narrow-', env: { KEPULI_SHOTS_WIDTH: '600', KEPULI_SHOTS_VIEWS: '01-channels,01-channels-browse' }, views: ['01-channels', '01-channels-browse'] },
];
const VIEWS = SETS.flatMap((set) => set.views.map((view) => set.prefix + view));
const DEV_PORT = process.env.KEPULI_DEV_PORT || '9351';
const NOW = '2026-11-02T18:40:00Z';      // a Monday evening, the guide full of programmes
const CHANNEL_DIFF = 40, MAX_CHANGED = 150;

const args = process.argv.slice(2);
const UPDATE = args.includes('--update');
const keep = args.includes('--keep') ? resolve(args[args.indexOf('--keep') + 1]) : null;
const work = keep || mkdtempSync(join(tmpdir(), 'kepuli-visual-'));
const shots = join(work, 'shots');
mkdirSync(shots, { recursive: true });

/* ---------------------------------------------------------------- PNG */

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (buf) => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };

/** An 8-bit RGB or RGBA, non-interlaced PNG as { width, height, rgb } (alpha dropped). */
function readPng(file) {
  const buf = readFileSync(file);
  let at = 8, width, height, type, idat = [];
  while (at < buf.length) {
    const len = buf.readUInt32BE(at), kind = buf.toString('latin1', at + 4, at + 8), data = buf.subarray(at + 8, at + 8 + len);
    if (kind === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4); type = data[9];
      if (data[8] !== 8 || ![2, 6].includes(type) || data[12] !== 0) throw new Error(`${file}: only 8-bit RGB/RGBA non-interlaced PNG is read here`);
    } else if (kind === 'IDAT') idat.push(data);
    else if (kind === 'IEND') break;
    at += 12 + len;
  }
  const bpp = type === 6 ? 4 : 3, stride = width * bpp, raw = inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(stride * height), rgb = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[y * stride + x - bpp] : 0, b = y ? px[(y - 1) * stride + x] : 0, c = x >= bpp && y ? px[(y - 1) * stride + x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[y * stride + x] = v & 0xff;
    }
    for (let x = 0; x < width; x++) px.copy(rgb, (y * width + x) * 3, y * stride + x * bpp, y * stride + x * bpp + 3);
  }
  return { width, height, rgb };
}

function writePng(file, { width, height, rgb }) {
  const chunk = (kind, data) => {
    const head = Buffer.alloc(8); head.writeUInt32BE(data.length, 0); head.write(kind, 4, 'latin1');
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr.set([8, 2, 0, 0, 0], 8);
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

/* ------------------------------------------------------------ the views */

/** One run of store-screenshots.mjs into shots/, its pictures named with the set's prefix. */
async function takeSet(set) {
  const dir = join(shots, set.prefix || 'store');
  mkdirSync(dir, { recursive: true });
  await takeViews(dir, set.env);
  for (const view of set.views) for (const ext of ['.png', '.masks.json']) renameSync(join(dir, view + ext), join(shots, set.prefix + view + ext));
}

function takeViews(dir, extra) {
  return new Promise((ok, fail) => {
    const env = {
      ...process.env, ...extra, KEPULI_SHOTS_DIR: dir, KEPULI_SHOTS_MASKS: '1', KEPULI_MOCK_NOW: NOW, KEPULI_HEADLESS: '1',
      KEPULI_DEV_PORT: DEV_PORT, KEPULI_DEV_PROFILE: join(work, 'profile'), TZ: 'Europe/Helsinki',
    };
    const child = spawn(process.execPath, [join(ROOT, 'dev', 'store-screenshots.mjs')], { env, stdio: ['ignore', 'pipe', 'inherit'] });
    child.stdout.on('data', () => {});
    child.on('close', (code) => (code === 0 ? ok() : fail(new Error(`store-screenshots.mjs exited with ${code}`))));
  });
}

const masks = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : []);

function compare(view) {
  const now = readPng(join(shots, `${view}.png`)), ref = readPng(join(REFS, `${view}.png`));
  if (now.width !== ref.width || now.height !== ref.height) return { view, changed: Infinity, note: `size ${now.width}x${now.height}, reference ${ref.width}x${ref.height}` };
  const { width, height } = now;
  const skip = new Uint8Array(width * height);
  for (const [x0, y0, x1, y1] of [...masks(join(shots, `${view}.masks.json`)), ...masks(join(REFS, `${view}.masks.json`))]) {
    for (let y = Math.max(0, y0); y < Math.min(height, y1); y++) skip.fill(1, y * width + Math.max(0, x0), y * width + Math.min(width, x1));
  }
  const out = Buffer.from(now.rgb);
  let changed = 0, box = null;
  for (let i = 0; i < width * height; i++) {
    const j = i * 3;
    if (skip[i]) { out[j] >>= 2; out[j + 1] >>= 2; out[j + 2] >>= 2; continue; }   // masked: dimmed in the picture
    if (Math.max(Math.abs(now.rgb[j] - ref.rgb[j]), Math.abs(now.rgb[j + 1] - ref.rgb[j + 1]), Math.abs(now.rgb[j + 2] - ref.rgb[j + 2])) > CHANNEL_DIFF) {
      changed++; out[j] = 255; out[j + 1] = 0; out[j + 2] = 0;
      const x = i % width, y = (i / width) | 0;
      box = box ? [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)] : [x, y, x, y];
    }
  }
  const diff = join(work, `${view}.diff.png`);
  if (changed > MAX_CHANGED) writePng(diff, { width, height, rgb: out });
  return { view, changed, box, diff };
}

/* ------------------------------------------------------------------ main */

// The Chrome the first set starts serves the others too, and is closed at
// the end. One that already answers on the port is not used: it has another
// profile and other flags (playcheck's is headless and stays running), and
// its pictures differed from the references in every view's text and logos.
const chromeAnswers = () => fetch(`http://127.0.0.1:${DEV_PORT}/json/version`).then((r) => r.json(), () => null);
if (await chromeAnswers()) {
  console.error(`a browser already answers on port ${DEV_PORT}: close it, or give this check a free KEPULI_DEV_PORT`);
  process.exit(1);
}
async function closeChrome() {
  const version = await chromeAnswers();
  if (!version) return;
  await new Promise((done) => {
    const ws = new WebSocket(version.webSocketDebuggerUrl);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
    ws.onmessage = ws.onclose = ws.onerror = () => done();
    setTimeout(done, 3000);
  });
  // Until it has exited it still writes into the profile, which is removed
  // with the rest of the work directory.
  for (let i = 0; i < 40 && await chromeAnswers(); i++) await new Promise((r) => setTimeout(r, 250));
}

console.log(`taking ${VIEWS.length} views in ${SETS.length} sets (mock clock ${NOW}) …`);
try {
  for (const set of SETS) await takeSet(set);
} finally {
  await closeChrome();
}
if (UPDATE) {
  mkdirSync(REFS, { recursive: true });
  for (const view of VIEWS) for (const ext of ['.png', '.masks.json']) copyFileSync(join(shots, view + ext), join(REFS, view + ext));
  console.log(`references updated in ${REFS}: look at them before committing`);
  if (!keep) rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  process.exit(0);
}
const missing = VIEWS.filter((v) => !existsSync(join(REFS, `${v}.png`)));
if (missing.length) { console.error(`no reference for ${missing.join(', ')}: run node dev/visualcheck.mjs --update`); process.exit(1); }
let failed = 0;
for (const view of VIEWS) {
  const r = compare(view);
  const bad = r.changed > MAX_CHANGED;
  failed += bad;
  console.log(`${bad ? 'FAIL' : 'ok  '}  ${view}  ${r.note || `${r.changed} pixels changed${r.box ? ` within x ${r.box[0]}–${r.box[2]}, y ${r.box[1]}–${r.box[3]}` : ''}`}${bad && !r.note ? `\n      ${r.diff}` : ''}`);
}
if (failed) console.log(`\n${failed} view(s) changed. The pictures are in ${work}. If the change is meant: node dev/visualcheck.mjs --update`);
else if (!keep) rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
process.exit(failed ? 1 : 0);
