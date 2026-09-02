#!/usr/bin/env node
// A store screenshot of the player: 1280x800, 24-bit PNG without alpha, which
// is what the Chrome Web Store asks for.
//
// The page is captured from the development Chrome (see dev/dev.mjs) over the
// DevTools protocol, so the viewport is exactly 1280x800 whatever the window
// size. It is rendered at 2x and scaled down, which gives crisper text than a
// 1x capture. Set the view up in that window first — the list, the guide, a
// series page — and then run this; it captures whatever the player shows.
// dev/store-screenshots.mjs uses the same pieces to take the whole set from
// dummy content.
//
//   node dev/screenshot.mjs [out.png]     default brand/screenshot.png
//
// Needs uv for the downscale (Pillow), like brand/promo.py does.

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PORT = Number(process.env.KEPULI_DEV_PORT || 9222);
export const PROFILE = process.env.KEPULI_DEV_PROFILE || join(homedir(), '.cache', 'kepuli-tv-dev');
const PAGE = 'player.html';
export const WIDTH = 1280, HEIGHT = 800, SCALE = 2;

const CHROMES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const http = async (path, init) => (await fetch(`http://127.0.0.1:${PORT}${path}`, init)).json();

/* ------------------------------------------------------ DevTools protocol */

/** One connection, many commands. */
export function session(wsUrl) {
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
    ws.onclose = (e) => {
      reject(new Error(`DevTools connection closed (${e.code})`));
      for (const p of pending.values()) p.reject(new Error(`${p.method}: connection closed`));
      pending.clear();
    };
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

export async function isRunning() {
  try { await http('/json/version'); return true; } catch { return false; }
}

/** Starts the development Chrome unless one already answers on the port. */
export async function ensureChrome(extraArgs = []) {
  if (await isRunning()) return false;
  const binary = CHROMES.find(existsSync);
  if (!binary) throw new Error('Chrome not found; start node dev/dev.mjs by hand first.');
  spawn(binary, [`--user-data-dir=${PROFILE}`, `--remote-debugging-port=${PORT}`, '--no-first-run', '--no-default-browser-check', ...extraArgs, 'about:blank'],
    { detached: true, stdio: 'ignore' }).unref();
  for (let i = 0; i < 60; i++) { if (await isRunning()) return true; await sleep(250); }
  throw new Error('Chrome did not answer within 15 seconds.');
}

export async function playerTarget() {
  const list = await http('/json/list');
  return list.find((t) => t.type === 'page' && /^chrome-extension:\/\/[a-p]{32}\/player\.html/.test(t.url)) || null;
}

/**
 * The id Chrome gives an unpacked extension: the first half of the SHA-256
 * of its path, written in the letters a–p. Knowing it, the player tab can
 * be opened without loading the extension again — loading a path that is
 * already loaded makes Chrome drop the DevTools connection.
 */
export const expectedId = () => createHash('sha256').update(ROOT).digest('hex').slice(0, 32)
  .replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)));

/** Is the tab really the player, rather than Chrome's error page for a missing extension? */
async function isPlayer(target) {
  const page = session(target.webSocketDebuggerUrl);
  try {
    for (let i = 0; i < 20; i++) {
      const { result } = await page.call('Runtime.evaluate', {
        expression: 'document.readyState === "complete" ? (document.getElementById("tabs") ? "player" : "other") : "loading"',
        returnByValue: true,
      });
      if (result.value !== 'loading') return result.value === 'player';
      await sleep(150);
    }
    return false;
  } catch {
    return false;
  } finally {
    page.close();
  }
}

async function openTab(id) {
  await http(`/json/new?chrome-extension://${id}/${PAGE}`, { method: 'PUT' });
  for (let i = 0; i < 20; i++) { const t = await playerTarget(); if (t) return t; await sleep(150); }
  throw new Error('The player tab did not open.');
}

/** The player tab: opens it, loading the extension from this folder first if it is not loaded. */
export async function openPlayer() {
  const existing = await playerTarget();
  if (existing) return existing;
  const tab = await openTab(expectedId());
  if (await isPlayer(tab)) return tab;
  await fetch(`http://127.0.0.1:${PORT}/json/close/${tab.id}`);   // answers in plain text
  const { webSocketDebuggerUrl } = await http('/json/version');
  const browser = session(webSocketDebuggerUrl);
  const { id } = await browser.call('Extensions.loadUnpacked', { path: ROOT });
  browser.close();
  return openTab(id);
}

/* ----------------------------------------------------------------- capture */

export const setViewport = (page) => page.call('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: SCALE, mobile: false });
export const clearViewport = (page) => page.call('Emulation.clearDeviceMetricsOverride');

/** Captures the viewport at 2x and writes a 1280x800 24-bit PNG to out. */
export async function capture(page, out) {
  for (let attempt = 1; ; attempt++) {
    // Let the layout settle and the fonts and images land.
    await page.call('Runtime.evaluate', { expression: 'document.fonts.ready.then(() => new Promise(r => setTimeout(r, 800)))', awaitPromise: true });
    const { data } = await page.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const raw = `${out}.2x.png`;
    writeFileSync(raw, Buffer.from(data, 'base64'));

    // Scale down and drop the alpha channel: Chrome writes RGBA, the store
    // wants 24-bit. A capture taken while the compositor is still adopting
    // the 2x viewport comes out as four half-size copies of the page; the
    // quadrants are then identical, and the capture is taken again.
    const py = `
import sys
from PIL import Image, ImageChops
im = Image.open(${JSON.stringify(raw)}).convert('RGB')
assert im.size == (${WIDTH * SCALE}, ${HEIGHT * SCALE}), im.size
w, h = im.size
if ImageChops.difference(im.crop((0, 0, w // 2, h // 2)), im.crop((w // 2, 0, w, h // 2))).getbbox() is None:
    sys.exit(3)
im.resize((${WIDTH}, ${HEIGHT}), Image.LANCZOS).save(${JSON.stringify(out)}, optimize=True)
`;
    const r = spawnSync('uv', ['run', '--quiet', '--with', 'pillow', 'python3', '-c', py], { stdio: 'inherit' });
    if (r.status === 3 && attempt < 4) { unlinkSync(raw); await sleep(1000); continue; }
    if (r.error || r.status !== 0) throw new Error(`downscale failed (is uv installed?); the 2x capture is at ${raw}`);
    unlinkSync(raw);
    console.log(`${out}  ${WIDTH}x${HEIGHT}  ${(readFileSync(out).length / 1024).toFixed(0)} kB`);
    return;
  }
}

/* -------------------------------------------------------------------- main */

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = resolve(process.argv[2] || join(ROOT, 'brand', 'screenshot.png'));
  await ensureChrome();
  const target = await openPlayer();
  const page = session(target.webSocketDebuggerUrl);
  try {
    await setViewport(page);
    await capture(page, out);
    await clearViewport(page);
  } finally {
    page.close();
  }
}
