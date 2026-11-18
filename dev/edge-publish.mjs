#!/usr/bin/env node
// The Chrome package to the Microsoft Edge Add-ons store, through its
// publish API (v1.1). Edge runs the Chrome package as it is, so what goes
// up is kepuli-tv-edge-<version>.zip, the same bytes under this store's
// name (node dev/package.mjs --zip --edge).
//
//   node dev/edge-publish.mjs check             the zip, the notes and the credentials; nothing sent
//   node dev/edge-publish.mjs verify [VERSION]  the package the store serves to users: its manifest
//                                               must be VERSION (default: manifest.json's), the
//                                               Chrome one; no credentials
//   node dev/edge-publish.mjs                   the zip uploaded as the draft's package and sent
//                                               for certification, with the notes for the testers
//   node dev/edge-publish.mjs upload            the zip uploaded as the draft's package, not sent
//   node dev/edge-publish.mjs submit            the draft sent for certification
//   node dev/edge-publish.mjs --zip FILE        another zip than the current version's
//   node dev/edge-publish.mjs listing           every language's description as this store takes
//                                               it, into dist/edge/listings.json and
//                                               dist/edge/<locale>.txt, to paste into Partner Center
//
// The API replaces the package of a product that exists and sends it for
// certification. It cannot make a product, and it cannot read or set the
// listing (descriptions, pictures, search terms): those are Partner
// Center's, by hand, as store/edge-dashboard.txt says. It has no call
// that tells what the store holds either, so there is no "status": the
// dashboard's overview says "In review" or "In the Store", and `verify`
// reads what users are served.
//
// Microsoft asks for notes for certification with every submission. They
// are the block between "=== NOTES ===" and "=== END ===" in
// store/edge-dashboard.txt, with <DEMO HOST> replaced by the host of
// "demoUrl" in ~/.config/kepuli-tv/ios/appstore.json (the hosted demo's
// address is never written into the repository).
//
// Credentials stay outside the project, in ~/.config/kepuli-tv/edge.json
// (mode 600) or in the environment:
//
//   { "productId": "…", "clientId": "…", "apiKey": "…" }
//
//   EDGE_PRODUCT_ID, EDGE_CLIENT_ID, EDGE_API_KEY
//
// Where they come from is in store/edge-dashboard.txt, at its end. The API
// key has an expiry date, shown on Partner Center's Publish API page: a
// 401 here most likely means a new one is due.
//
// Written from Microsoft's reference (read 2026-11-18) before the first
// update went through it. Where its two pages disagree this file says so
// at the call. No dependencies; the manifest is read with the system's
// own unzip.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readListings, unwrap, forChrome, CHROME_UNSUPPORTED } from './listings.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// KEPULI_EDGE_API points the tool at a stand-in for the store, to try its
// course without sending anything to Microsoft.
const API = process.env.KEPULI_EDGE_API || 'https://api.addons.microsoftedge.microsoft.com';
// The extension's identifier in Edge, given by the store when the product
// was made (Partner Center, Extension overview, "CRX ID").
const CRX_ID = 'ioapfmoljjmhebmbndbdaeolggaibjcj';
const CONFIG = join(homedir(), '.config', 'kepuli-tv', 'edge.json');
const DEMO = join(homedir(), '.config', 'kepuli-tv', 'ios', 'appstore.json');
const RECORD = join(ROOT, 'store', 'edge-dashboard.txt');
const POLL_MS = 5000;
const WAIT_MS = 300000;
const NOTES_LIMIT = 2000;

/** What Partner Center calls each language of the package, by the listing file's name. */
export const LANGUAGE_NAMES = {
  bg: 'Bulgarian', cs: 'Czech', da: 'Danish', de: 'German', el: 'Greek', en: 'English', es: 'Spanish',
  et: 'Estonian', fi: 'Finnish', fr: 'French', hr: 'Croatian', hu: 'Hungarian', id: 'Indonesian',
  it: 'Italian', lt: 'Lithuanian', lv: 'Latvian', nl: 'Dutch', no: 'Norwegian', pl: 'Polish',
  pt_BR: 'Portuguese (Brazil)', pt_PT: 'Portuguese (Portugal)', ro: 'Romanian', ru: 'Russian',
  sk: 'Slovak', sl: 'Slovenian', sr: 'Serbian', sv: 'Swedish', tr: 'Turkish', uk: 'Ukrainian', vi: 'Vietnamese',
};

/** Another browser or its store named in a text: Partner Center's form warns of them. */
export const otherBrowsers = (text) => [...new Set(text.match(/firefox|orion|safari|\bopera\b|\bchrome\b/gi) || [])];

/**
 * A listing's detailed description as this store takes it: the Chrome one
 * (no video section, the store has a field for the video), unwrapped, and
 * without the sentence that sends the reader to Orion and Firefox on a
 * phone. That sentence is the last of the last paragraph in every
 * language, and "Orion" is the one word of it no language declines.
 */
export function edgeDescription(detailed) {
  const paragraphs = unwrap(forChrome(detailed)).split('\n\n');
  const last = paragraphs[paragraphs.length - 1];
  const at = last.indexOf('Orion');
  if (at < 0) return paragraphs.join('\n\n');
  const start = Math.max(last.lastIndexOf('. ', at), last.lastIndexOf('! ', at), last.lastIndexOf('? ', at));
  if (start < 0) paragraphs.pop(); else paragraphs[paragraphs.length - 1] = last.slice(0, start + 1);
  return paragraphs.join('\n\n').trimEnd();
}

/** The notes for certification out of the record, the demo's host put in. */
export function certificationNotes(record, demoUrl) {
  const block = record.match(/^=== NOTES ===\n([\s\S]*?)\n=== END ===$/m);
  if (!block) throw new Error('no block between "=== NOTES ===" and "=== END ===" in store/edge-dashboard.txt');
  const text = block[1].trim();
  if (!text.includes('<DEMO HOST>')) return text;
  if (!demoUrl) throw new Error(`the notes name <DEMO HOST>, and ${DEMO} has no "demoUrl"`);
  return text.replaceAll('<DEMO HOST>', new URL(demoUrl).host);
}

/**
 * The operation's identifier out of a Location header. The reference
 * writes it as the bare identifier; a path that ends in it is taken too.
 */
export function operationId(location) {
  const id = String(location || '').trim().split(/[/?#]/).filter(Boolean).pop() || '';
  return /^[0-9a-f-]{8,}$/i.test(id) ? id : '';
}

/**
 * What an operation's answer says: 'wait' while it is in progress, 'done',
 * or 'failed' with the store's own words. An answer with no status is the
 * store's "error while processing the request".
 */
export function outcome(body) {
  const status = body && body.status;
  if (status === 'InProgress') return { state: 'wait' };
  if (status === 'Succeeded') return { state: 'done', message: body.message || '' };
  const errors = (body && Array.isArray(body.errors) ? body.errors : []).map((e) => (typeof e === 'string' ? e : e && e.message)).filter(Boolean);
  const said = [body && body.errorCode, body && body.message, ...errors].filter(Boolean).join(': ');
  return { state: 'failed', message: said || 'the store gave no reason' };
}

/* ------------------------------------------------------------ the tool */

const fail = (message) => { console.error(`edge-publish: ${message}`); process.exit(1); };

function manifestOf(zip) {
  try { return JSON.parse(execFileSync('unzip', ['-p', zip, 'manifest.json'], { encoding: 'utf8' })); }
  catch (err) { return fail(`${zip} holds no readable manifest.json: ${err.message}`); }
}

/** What stops a manifest from being the Chrome package of a version. */
function notChrome(manifest, version) {
  const problems = [];
  if (!manifest.background || !manifest.background.service_worker) problems.push('no background.service_worker');
  if (manifest.background && manifest.background.scripts) problems.push('background.scripts: the Firefox manifest');
  if (manifest.browser_specific_settings || manifest.applications) problems.push('gecko settings: the Firefox manifest');
  if (manifest.version !== version) problems.push(`version ${manifest.version}, not ${version}`);
  return problems;
}

/** The zip to send, checked to be the Chrome package of the current version. */
function checkedZip(zipArg) {
  const version = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8')).version;
  const zip = zipArg || join(ROOT, `kepuli-tv-edge-${version}.zip`);
  if (!existsSync(zip)) fail(`${zip} is not there: make it with node dev/package.mjs --zip --edge`);
  const problems = notChrome(manifestOf(zip), version);
  if (problems.length) fail(`${zip} is not the Chrome package of ${version}: ${problems.join('; ')}`);
  return { zip, version, size: statSync(zip).size };
}

function credentials() {
  let file = {};
  if (existsSync(CONFIG)) {
    if ((statSync(CONFIG).mode & 0o077) !== 0) fail(`${CONFIG} can be read by others: chmod 600 it`);
    try { file = JSON.parse(readFileSync(CONFIG, 'utf8')); } catch (err) { fail(`${CONFIG} is not JSON: ${err.message}`); }
  }
  const out = {
    productId: process.env.EDGE_PRODUCT_ID || file.productId,
    clientId: process.env.EDGE_CLIENT_ID || file.clientId,
    apiKey: process.env.EDGE_API_KEY || file.apiKey,
  };
  const missing = Object.entries(out).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) fail(`missing ${missing.join(', ')} in ${CONFIG}: Partner Center, Microsoft Edge, Publish API, Create API credentials (store/edge-dashboard.txt, at its end)`);
  return out;
}

function notes() {
  let demoUrl = '';
  if (existsSync(DEMO)) { try { demoUrl = JSON.parse(readFileSync(DEMO, 'utf8')).demoUrl || ''; } catch { demoUrl = ''; } }
  let text;
  try { text = certificationNotes(readFileSync(RECORD, 'utf8'), demoUrl); } catch (err) { return fail(err.message); }
  if (text.length >= NOTES_LIMIT) fail(`the notes for certification are ${text.length} characters: the form takes less than ${NOTES_LIMIT}`);
  return text;
}

async function call(creds, method, path, { zip, json } = {}) {
  const headers = { Authorization: `ApiKey ${creds.apiKey}`, 'X-ClientID': creds.clientId };
  if (zip) headers['Content-Type'] = 'application/zip';
  if (json) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API}${path}`, { method, headers, body: zip || (json ? JSON.stringify(json) : undefined) });
  const text = await res.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { message: text.slice(0, 300) }; }
  if (!res.ok) {
    const why = res.status === 401 ? 'the API key is missing, wrong or past its expiry date (Partner Center, Publish API)'
      : res.status === 404 ? 'no such product or operation for this account'
        : res.status === 429 ? 'too many requests: wait and run it again'
          : body.message || 'no reason given';
    fail(`${method} ${path.replace(creds.productId, '<product>')} answered ${res.status}: ${why}`);
  }
  return { status: res.status, location: res.headers.get('location'), body };
}

/** An operation followed until the store says how it ended. */
async function follow(creds, path, what) {
  for (const started = Date.now(); Date.now() - started < WAIT_MS;) {
    const result = outcome((await call(creds, 'GET', path)).body);
    if (result.state === 'done') return result.message;
    if (result.state === 'failed') fail(`${what} failed: ${result.message}`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  return fail(`${what} was still in progress after ${WAIT_MS / 60000} minutes: look at Partner Center before sending anything again`);
}

async function upload(creds, zip) {
  console.log('uploading…');
  const sent = await call(creds, 'POST', `/v1/products/${creds.productId}/submissions/draft/package`, { zip: readFileSync(zip.zip) });
  const id = operationId(sent.location);
  if (!id) fail(`the upload was accepted (${sent.status}) without an operation to follow: look at Partner Center, Packages`);
  console.log(await follow(creds, `/v1/products/${creds.productId}/submissions/draft/package/operations/${id}`, 'the upload') || `uploaded ${zip.version}`);
}

async function submit(creds, text) {
  console.log('sending for certification…');
  // The reference calls the body plain text, the guide JSON with a "notes"
  // key (and its sample is not JSON). JSON is what the guide's script and
  // the tools others have written send.
  const sent = await call(creds, 'POST', `/v1/products/${creds.productId}/submissions`, { json: { notes: text } });
  const id = operationId(sent.location);
  if (!id) fail(`the submission was accepted (${sent.status}) without an operation to follow: look at Partner Center's overview`);
  console.log(await follow(creds, `/v1/products/${creds.productId}/submissions/operations/${id}`, 'the submission') || 'submitted');
  console.log('certification can take up to seven business days; when the store says "In the Store": node dev/edge-publish.mjs verify');
}

/**
 * What the store serves, read the way Edge's updater reads it: a CRX3 is
 * a header ("Cr24", version, header length) and then the zip. Before the
 * first approval, and for a product taken down, the store answers 404.
 */
async function verify(want) {
  const url = `https://edge.microsoft.com/extensionwebstorebase/v1/crx?response=redirect&prodversion=150.0&acceptformat=crx3&x=id%3D${CRX_ID}%26installsource%3Dondemand%26uc`;
  const res = await fetch(url);
  if (res.status === 404) fail('the store serves no package for the extension: it is not published (yet)');
  if (!res.ok) fail(`the store answered ${res.status} for the package`);
  const crx = Buffer.from(await res.arrayBuffer());
  if (crx.toString('latin1', 0, 4) !== 'Cr24' || crx.readUInt32LE(4) !== 3) fail('what the store served is not a CRX3 package');
  const dir = mkdtempSync(join(tmpdir(), 'kepuli-edge-'));
  let manifest;
  try {
    writeFileSync(join(dir, 'store.zip'), crx.subarray(12 + crx.readUInt32LE(8)));
    manifest = manifestOf(join(dir, 'store.zip'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
  console.log(`the store serves ${manifest.version} (${(crx.length / 1024).toFixed(0)} kB)`);
  const problems = notChrome(manifest, want);
  if (problems.length) fail(`${problems.join('; ')}${manifest.version !== want ? ' (the certification may not be finished)' : ''}`);
  console.log('the Chrome package, as it should be');
}

/** Every language's description for Partner Center's form, written to dist/edge/. */
function listing() {
  const out = join(ROOT, 'dist', 'edge');
  mkdirSync(out, { recursive: true });
  const byName = {};
  const problems = [];
  for (const l of readListings().filter((x) => !CHROME_UNSUPPORTED.includes(x.locale))) {
    const name = LANGUAGE_NAMES[l.locale];
    const text = edgeDescription(l.detailed);
    if (!name) problems.push(`${l.locale}: no name for it in Partner Center (LANGUAGE_NAMES)`);
    if (text.length < 250 || text.length > 10000) problems.push(`${l.locale}: ${text.length} characters, where the store takes 250 to 10,000`);
    const named = otherBrowsers(text);
    if (named.length) problems.push(`${l.locale}: names ${named.join(', ')}`);
    byName[name || l.locale] = text;
    writeFileSync(join(out, `${l.locale}.txt`), `${text}\n`);
  }
  writeFileSync(join(out, 'listings.json'), `${JSON.stringify(byName, null, 1)}\n`);
  if (problems.length) fail(problems.join('\n'));
  console.log(`${Object.keys(byName).length} descriptions in ${out}: listings.json by Partner Center's language names, and a file each`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const command = ['check', 'verify', 'upload', 'submit', 'listing'].includes(args[0]) ? args[0] : 'publish';
  const zipArg = args.includes('--zip') ? args[args.indexOf('--zip') + 1] : null;
  const unknown = args.filter((a, i) => !(i === 0 && command !== 'publish') && a !== '--zip' && args[i - 1] !== '--zip' && !(command === 'verify' && i === 1));
  if (unknown.length) fail(`unknown argument ${unknown.join(' ')}: see the head of ${dirname(fileURLToPath(import.meta.url))}/edge-publish.mjs`);

  if (command === 'verify') {
    await verify(args[1] || JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8')).version);
  } else if (command === 'listing') {
    listing();
  } else {
    const zip = command === 'submit' ? null : checkedZip(zipArg);
    if (zip) console.log(`${zip.zip}: the Chrome package of ${zip.version}, ${Math.round(zip.size / 1024)} kB`);
    const text = command === 'upload' ? null : notes();
    if (text) console.log(`notes for certification: ${text.length} characters`);
    const creds = credentials();
    if (command === 'check') {
      console.log('the credentials are there; the API has no call that reads the store, so they are tried by the first upload');
    } else {
      if (command !== 'submit') await upload(creds, zip);
      if (command === 'upload') console.log('left as the draft\'s package: node dev/edge-publish.mjs submit sends it');
      else await submit(creds, text);
    }
  }
}
