#!/usr/bin/env node
// Kehityssilmukka: avaa Chromen, lataa laajennuksen, avaa soittimen ja
// lataa sivun uudelleen aina kun lähdetiedosto muuttuu.
//
// Miksi näin eikä --load-extension: Chrome poisti sen komentoriviltä
// (152 hylkää lipun hiljaa, ERR_BLOCKED_BY_CLIENT). Tilalla on
// DevTools-protokollan Extensions.loadUnpacked, joka toimii myös
// uudelleenlatauksena samaan polkuun kutsuttaessa — sitä tarvitaan kun
// manifest.json tai background.js muuttuu, sillä pelkkä sivun lataus ei
// niitä huomaa.
//
// Riippuvuuksia ei ole: Node 22+ riittää (global fetch ja WebSocket).

import { spawn } from 'node:child_process';
import { existsSync, watch } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.KEPULI_DEV_PORT || 9222);
const PROFILE = process.env.KEPULI_DEV_PROFILE || join(homedir(), '.cache', 'kepuli-tv-dev');
const PAGE = 'player.html';

// Tiedostot joiden muutos vaatii koko laajennuksen uudelleenlatauksen.
const NEEDS_EXTENSION_RELOAD = new Set(['manifest.json', 'background.js']);
const WATCHED = /\.(js|css|html|json)$/;

const CHROMES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

const log = (msg) => console.log(`${new Date().toTimeString().slice(0, 8)}  ${msg}`);

/* ------------------------------------------------------ DevTools-protokolla */

/** Yksi kutsu, oma yhteys. Kehitystyökalulle riittävän halpaa. */
function call(wsUrl, method, params = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => { ws.close(); reject(new Error(`${method}: aikakatkaisu`)); }, 10000);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method, params }));
    ws.onerror = () => { clearTimeout(timer); reject(new Error(`${method}: yhteysvirhe`)); };
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.id !== 1) return;
      clearTimeout(timer);
      ws.close();
      data.error ? reject(new Error(`${method}: ${data.error.message}`)) : resolve(data.result);
    };
  });
}

const http = async (path) => (await fetch(`http://127.0.0.1:${PORT}${path}`)).json();
const browserWs = async () => (await http('/json/version')).webSocketDebuggerUrl;

async function isRunning() {
  try { await http('/json/version'); return true; } catch { return false; }
}

/* ------------------------------------------------------------------ Chrome */

async function ensureChrome() {
  if (await isRunning()) { log(`Chrome on jo auki portissa ${PORT}`); return; }

  const binary = CHROMES.find(existsSync);
  if (!binary) throw new Error('Chromea ei löytynyt. Aseta polku itse tai avaa Chrome käsin.');

  log(`Käynnistetään Chrome (profiili ${PROFILE})`);
  spawn(binary, [
    `--user-data-dir=${PROFILE}`,
    `--remote-debugging-port=${PORT}`,
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ], { detached: true, stdio: 'ignore' }).unref();

  for (let i = 0; i < 60; i++) {
    if (await isRunning()) { log('Chrome vastaa'); return; }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Chrome ei vastannut 15 sekunnissa.');
}

/* --------------------------------------------------------------- laajennus */

async function loadExtension() {
  const { id } = await call(await browserWs(), 'Extensions.loadUnpacked', { path: ROOT });
  return id;
}

async function playerTarget(id) {
  const url = `chrome-extension://${id}/${PAGE}`;
  const list = await http('/json/list');
  return list.find((t) => t.type === 'page' && t.url.startsWith(url)) || null;
}

async function openPlayer(id) {
  const existing = await playerTarget(id);
  if (existing) return existing;
  await fetch(`http://127.0.0.1:${PORT}/json/new?chrome-extension://${id}/${PAGE}`, { method: 'PUT' });
  for (let i = 0; i < 20; i++) {
    const target = await playerTarget(id);
    if (target) return target;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('Soitinvälilehteä ei saatu auki.');
}

async function reloadPage(id) {
  const target = await playerTarget(id);
  if (!target) { await openPlayer(id); return; }
  await call(target.webSocketDebuggerUrl, 'Page.reload', { ignoreCache: true });
}

/* ---------------------------------------------------------------- vahtikoira */

function watchSources(onChange) {
  // Rekursiivinen vahti juuresta: editorit tallentavat usein nimeämällä
  // tilapäistiedoston, jolloin yksittäisen tiedoston vahti katkeaisi.
  watch(ROOT, { recursive: true }, (_event, file) => {
    if (!file) return;
    const path = file.replaceAll('\\', '/');
    if (path.startsWith('.') || path.includes('/.')) return;
    if (path.startsWith('dev/') || path.startsWith('icons/')) return;
    if (!WATCHED.test(path)) return;
    onChange(path);
  });
}

/* -------------------------------------------------------------------- main */

await ensureChrome();
let id = await loadExtension();
await openPlayer(id);

console.log('');
log(`Laajennus ladattu: ${id}`);
log(`Soitin: chrome-extension://${id}/${PAGE}`);
log('Vahditaan muutoksia — lopeta Ctrl+C');
console.log('');

const changed = new Set();
let pending = null;
let busy = false;

watchSources((path) => {
  changed.add(path);
  clearTimeout(pending);
  // Yksi tallennus poikii useita tapahtumia, ja macOS niputtaa niitä
  // vielä omaan tahtiinsa; odotetaan että ne rauhoittuvat.
  pending = setTimeout(apply, 120);
});

async function apply() {
  // Jos edellinen lataus on kesken, yritetään uudelleen hetken päästä
  // — muuten juuri tallennettu muutos jäisi näkymättä.
  if (busy) { pending = setTimeout(apply, 200); return; }
  if (changed.size === 0) return;
  const paths = [...changed];
  changed.clear();
  busy = true;
  const label = paths.length === 1 ? paths[0] : `${paths[0]} (+${paths.length - 1})`;
  try {
    if (paths.some((p) => NEEDS_EXTENSION_RELOAD.has(p))) {
      log(`${label} → ladataan laajennus uudelleen`);
      id = await loadExtension();
      await new Promise((r) => setTimeout(r, 300));
      await openPlayer(id);
    } else {
      log(`${label} → sivu uudelleen`);
      await reloadPage(id);
    }
  } catch (err) {
    log(`virhe: ${err.message}`);
  } finally {
    busy = false;
  }
}

process.on('SIGINT', () => { console.log('\nVahti pysäytetty. Chrome jää auki.'); process.exit(0); });
