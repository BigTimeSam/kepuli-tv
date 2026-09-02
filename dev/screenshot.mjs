#!/usr/bin/env node
// A store screenshot of the player: 1280x800, 24-bit PNG without alpha, which
// is what the Chrome Web Store asks for.
//
// The page is captured from the development Chrome (see dev/dev.mjs) over the
// DevTools protocol, so the viewport is exactly 1280x800 whatever the window
// size. It is rendered at 2x and scaled down, which gives crisper text than a
// 1x capture. Set the view up in that window first — the list, the guide, a
// series page — and then run this; it captures whatever the player shows.
//
//   node dev/screenshot.mjs [out.png]     default brand/screenshot.png
//
// Needs uv for the downscale (Pillow), like brand/promo.py does.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.KEPULI_DEV_PORT || 9222);
const PROFILE = process.env.KEPULI_DEV_PROFILE || join(homedir(), '.cache', 'kepuli-tv-dev');
const PAGE = 'player.html';
const WIDTH = 1280, HEIGHT = 800, SCALE = 2;
const OUT = resolve(process.argv[2] || join(ROOT, 'brand', 'screenshot.png'));

const CHROMES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const http = async (path, init) => (await fetch(`http://127.0.0.1:${PORT}${path}`, init)).json();

/* ------------------------------------------------------ DevTools protocol */

/** One connection, many commands. */
function session(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  let next = 1;
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    const p = pending.get(data.id);
    if (!p) return;
    pending.delete(data.id);
    data.error ? p.reject(new Error(`${p.method}: ${data.error.message}`)) : p.resolve(data.result);
  };
  const open = new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('DevTools connection failed'));
    ws.onclose = (e) => { reject(new Error(`DevTools connection closed (${e.code})`)); for (const p of pending.values()) p.reject(new Error(`${p.method}: connection closed`)); pending.clear(); };
  });
  open.catch(() => {});
  return {
    async call(method, params = {}) {
      await open;
      const id = next++;
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => {
        pending.set(id, { method, resolve, reject });
        setTimeout(() => { if (pending.delete(id)) reject(new Error(`${method}: no answer in 15 s`)); }, 15000);
      });
    },
    close: () => ws.close(),
  };
}

/* ------------------------------------------------------------------ Chrome */

async function isRunning() {
  try { await http('/json/version'); return true; } catch { return false; }
}

async function ensureChrome() {
  if (await isRunning()) return;
  const binary = CHROMES.find(existsSync);
  if (!binary) throw new Error('Chrome not found; start node dev/dev.mjs by hand first.');
  spawn(binary, [`--user-data-dir=${PROFILE}`, `--remote-debugging-port=${PORT}`, '--no-first-run', '--no-default-browser-check', 'about:blank'],
    { detached: true, stdio: 'ignore' }).unref();
  for (let i = 0; i < 60; i++) { if (await isRunning()) return; await sleep(250); }
  throw new Error('Chrome did not answer within 15 seconds.');
}

async function playerTarget() {
  const list = await http('/json/list');
  return list.find((t) => t.type === 'page' && /^chrome-extension:\/\/[a-p]{32}\/player\.html/.test(t.url)) || null;
}

async function openPlayer() {
  const existing = await playerTarget();
  if (existing) return existing;
  const { webSocketDebuggerUrl } = await http('/json/version');
  const browser = session(webSocketDebuggerUrl);
  const { id } = await browser.call('Extensions.loadUnpacked', { path: ROOT });
  browser.close();
  await http(`/json/new?chrome-extension://${id}/${PAGE}`, { method: 'PUT' });
  for (let i = 0; i < 20; i++) { const t = await playerTarget(); if (t) return t; await sleep(150); }
  throw new Error('The player tab did not open.');
}

/* ----------------------------------------------------------------- capture */

await ensureChrome();
const target = await openPlayer();
const page = session(target.webSocketDebuggerUrl);
try {
  await page.call('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: SCALE, mobile: false });
  // Let the layout settle and the fonts and images land.
  await page.call('Runtime.evaluate', { expression: 'document.fonts.ready.then(() => new Promise(r => setTimeout(r, 800)))', awaitPromise: true });
  const { data } = await page.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await page.call('Emulation.clearDeviceMetricsOverride');
  const raw = `${OUT}.2x.png`;
  writeFileSync(raw, Buffer.from(data, 'base64'));

  // Scale down and drop the alpha channel: Chrome writes RGBA, the store wants 24-bit.
  const py = `
from PIL import Image
im = Image.open(${JSON.stringify(raw)}).convert('RGB')
assert im.size == (${WIDTH * SCALE}, ${HEIGHT * SCALE}), im.size
im.resize((${WIDTH}, ${HEIGHT}), Image.LANCZOS).save(${JSON.stringify(OUT)}, optimize=True)
`;
  const r = spawnSync('uv', ['run', '--quiet', '--with', 'pillow', 'python3', '-c', py], { stdio: 'inherit' });
  if (r.error || r.status !== 0) throw new Error(`downscale failed (is uv installed?); the 2x capture is at ${raw}`);
  unlinkSync(raw);
  console.log(`${OUT}  ${WIDTH}x${HEIGHT}  ${(readFileSync(OUT).length / 1024).toFixed(0)} kB  from ${target.url}`);
} finally {
  page.close();
}
