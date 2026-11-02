#!/usr/bin/env node
// The Chrome package to the Chrome Web Store, through its publishing API (V2).
//
//   node dev/cws-publish.mjs status            what the store holds: published and submitted
//   node dev/cws-publish.mjs check             the zip and the credentials, nothing sent
//   node dev/cws-publish.mjs                   kepuli-tv-chrome-<version>.zip uploaded and
//                                              submitted for review
//   node dev/cws-publish.mjs --replace         … cancelling a submission still in review first
//   node dev/cws-publish.mjs upload            the zip uploaded as the draft, not submitted: a
//                                              release that adds languages does this first, as
//                                              the dashboard offers a language for its
//                                              description only once the package carries it
//   node dev/cws-publish.mjs submit            the draft uploaded before submitted for review
//   node dev/cws-publish.mjs --zip FILE        another zip than the current version's
//   node dev/cws-publish.mjs listing           the languages whose detailed description in
//                                              the dashboard is behind store/listings/
//   node dev/cws-publish.mjs listing --done L… those languages pasted into the dashboard
//                                              (or "all"): recorded in store/cws-listing.json
//
// The detailed description is the one part of the listing neither the
// manifest nor the API carries: it is filled into the dashboard's form,
// language by language (in the release session, by browser automation).
// store/cws-listing.json records what was last put there, a hash per
// language, and a submission is refused while a language is behind —
// --listing-later lets one through, for a fix that cannot wait.
//
// Extensions cannot script the store's own pages, so a release went up by
// hand — and twice the Firefox zip went to Chrome (1.2.1, 1.2.5), whose
// service worker was then missing and the extension did not start. Here
// the zip is checked before anything is sent: its manifest must be the
// Chrome one (background.service_worker, no background.scripts, no gecko
// settings) and of the version in manifest.json. The store refuses a
// version it already has, so a zip not bumped fails there too.
//
// The listing — descriptions, screenshots, the promo video — is not part of
// the API and stays the dashboard's (see store-listing.txt).
//
// Credentials stay outside the project, in ~/.config/kepuli-tv/cws.json
// (mode 600) or in the environment:
//
//   { "clientId": "…", "clientSecret": "…", "refreshToken": "…", "publisherId": "…" }
//
//   CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN, CWS_PUBLISHER_ID
//
// How to get them is in store-listing.txt, "PUBLISHING THROUGH THE API".
// No dependencies; the manifest is read with the system's own unzip.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readListings, unwrap, CHROME_UNSUPPORTED } from './listings.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const ITEM_ID = 'okkgclcakhjhldkdcblgagoaibghpfmi';
const API = 'https://chromewebstore.googleapis.com';
const CONFIG = join(homedir(), '.config', 'kepuli-tv', 'cws.json');
const UPLOAD_POLL_MS = 3000;
const UPLOAD_WAIT_MS = 120000;

const args = process.argv.slice(2);
const command = ['status', 'check', 'listing', 'upload', 'submit'].includes(args[0]) ? args[0] : 'publish';
const replace = args.includes('--replace');
const zipArg = args.includes('--zip') ? args[args.indexOf('--zip') + 1] : null;

const fail = (message) => { console.error(`cws-publish: ${message}`); process.exit(1); };

/* ---------------------------------------------------------- credentials */

function credentials() {
  let file = {};
  if (existsSync(CONFIG)) {
    if ((statSync(CONFIG).mode & 0o077) !== 0) fail(`${CONFIG} can be read by others: chmod 600 it`);
    try { file = JSON.parse(readFileSync(CONFIG, 'utf8')); } catch (err) { fail(`${CONFIG} is not JSON: ${err.message}`); }
  }
  const pick = (key, env) => process.env[env] || file[key];
  const out = {
    clientId: pick('clientId', 'CWS_CLIENT_ID'),
    clientSecret: pick('clientSecret', 'CWS_CLIENT_SECRET'),
    refreshToken: pick('refreshToken', 'CWS_REFRESH_TOKEN'),
    publisherId: pick('publisherId', 'CWS_PUBLISHER_ID'),
  };
  const missing = Object.entries(out).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) fail(`missing ${missing.join(', ')}: see ${CONFIG} in the head of this file`);
  return out;
}

async function accessToken({ clientId, clientSecret, refreshToken }) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) fail(`the token was refused (${res.status}): ${body.error_description || body.error || 'no reason given'}`);
  return body.access_token;
}

/* ------------------------------------------------------------------ zip */

/** The zip to send, checked to be the Chrome package of the current version. */
function checkedZip() {
  const version = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8')).version;
  const zip = zipArg ? zipArg : join(ROOT, `kepuli-tv-chrome-${version}.zip`);
  if (!existsSync(zip)) fail(`${zip} is not there: make it with node dev/package.mjs chrome --zip`);
  let manifest;
  try {
    manifest = JSON.parse(execFileSync('unzip', ['-p', zip, 'manifest.json'], { encoding: 'utf8' }));
  } catch (err) {
    fail(`${zip} holds no readable manifest.json: ${err.message}`);
  }
  const problems = [];
  if (!manifest.background || !manifest.background.service_worker) problems.push('no background.service_worker');
  if (manifest.background && manifest.background.scripts) problems.push('background.scripts — the Firefox manifest');
  if (manifest.browser_specific_settings || manifest.applications) problems.push('gecko settings — the Firefox manifest');
  if (manifest.version !== version) problems.push(`version ${manifest.version}, where manifest.json says ${version}`);
  if (problems.length) fail(`${zip} is not the Chrome package of ${version}: ${problems.join('; ')}`);
  return { zip, version, size: statSync(zip).size };
}

/* ------------------------------------------------------------------ API */

async function call(token, method, path, { body, raw } = {}) {
  const headers = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (raw !== undefined) headers['Content-Type'] = 'application/zip';
  const res = await fetch(`${API}${path}`, {
    method, headers, body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { text }; }
  if (!res.ok) {
    const reason = (json.error && (json.error.message || json.error.status)) || json.text || 'no reason given';
    fail(`${method} ${path.replace(/^.*:/, ':')} answered ${res.status}: ${reason}`);
  }
  return json;
}

const item = (publisherId) => `publishers/${publisherId}/items/${ITEM_ID}`;

const describe = (revision) => {
  if (!revision) return 'nothing';
  const versions = (revision.distributionChannels || []).map((c) => `${c.crxVersion}${c.deployPercentage != null && c.deployPercentage !== 100 ? ` at ${c.deployPercentage} %` : ''}`);
  return `${revision.state}${versions.length ? ` (${versions.join(', ')})` : ''}`;
};

async function status(token, publisherId) {
  const s = await call(token, 'GET', `/v2/${item(publisherId)}:fetchStatus`);
  console.log(`published:  ${describe(s.publishedItemRevisionStatus)}`);
  console.log(`submitted:  ${describe(s.submittedItemRevisionStatus)}`);
  if (s.lastAsyncUploadState) console.log(`last upload: ${s.lastAsyncUploadState}`);
  if (s.takenDown) console.log('TAKEN DOWN');
  if (s.warned) console.log('warned by the store');
  return s;
}

/* -------------------------------------------------------------- listing */

const LISTED = join(ROOT, 'store', 'cws-listing.json');

/** Each Chrome language's detailed description as pasted, with its hash. */
function wantedListing() {
  return readListings().filter((l) => !CHROME_UNSUPPORTED.includes(l.locale)).map((l) => {
    const text = unwrap(l.detailed);
    return { locale: l.locale, text, hash: createHash('sha256').update(text).digest('hex').slice(0, 12) };
  });
}

/** The languages whose dashboard text is not what store/listings/ says. */
function listingBehind() {
  const done = existsSync(LISTED) ? JSON.parse(readFileSync(LISTED, 'utf8')) : {};
  return wantedListing().filter((l) => done[l.locale] !== l.hash);
}

if (command === 'listing') {
  if (args.includes('--done')) {
    const which = args.slice(args.indexOf('--done') + 1);
    const done = existsSync(LISTED) ? JSON.parse(readFileSync(LISTED, 'utf8')) : {};
    const marked = wantedListing().filter((l) => which.includes('all') || which.includes(l.locale));
    for (const l of marked) done[l.locale] = l.hash;
    writeFileSync(LISTED, JSON.stringify(Object.fromEntries(Object.keys(done).sort().map((k) => [k, done[k]])), null, 1) + '\n');
    console.log(`recorded as in the dashboard: ${marked.map((l) => l.locale).join(' ') || 'nothing'}`);
  } else {
    const behind = listingBehind();
    console.log(behind.length
      ? `the dashboard's detailed description is behind in: ${behind.map((l) => l.locale).join(' ')}\npaste from dist/listings/<locale>.txt (node dev/listings.mjs writes them), then: node dev/cws-publish.mjs listing --done <locales>`
      : 'the dashboard has every language as store/listings/ says');
  }
  process.exit(0);
}

/* ----------------------------------------------------------------- main */

const zip = command === 'status' ? null : checkedZip();
if (zip) console.log(`${zip.zip}: the Chrome package of ${zip.version}, ${Math.round(zip.size / 1024)} kB`);
const creds = credentials();
const token = await accessToken(creds);
const before = await status(token, creds.publisherId);
if (command === 'status' || command === 'check') process.exit(0);

// The submission takes the dashboard's draft listing with it: a language
// whose description is behind would go out as it stands.
const behindListing = command === 'upload' ? [] : listingBehind();
if (behindListing.length && !args.includes('--listing-later')) {
  fail(`the dashboard's detailed description is behind in ${behindListing.map((l) => l.locale).join(' ')}: fill it in (node dev/cws-publish.mjs listing), or pass --listing-later`);
}

const pending = before.submittedItemRevisionStatus && before.submittedItemRevisionStatus.state === 'PENDING_REVIEW';
if (pending) {
  if (!replace) fail('a submission is still in review: run again with --replace to cancel it and send this one');
  console.log('cancelling the submission in review…');
  await call(token, 'POST', `/v2/${item(creds.publisherId)}:cancelSubmission`);
}

if (command !== 'submit') {
  console.log('uploading…');
  let upload = await call(token, 'POST', `/upload/v2/${item(creds.publisherId)}:upload`, { raw: readFileSync(zip.zip) });
  const started = Date.now();
  while (/IN_PROGRESS/.test(upload.uploadState || '') && Date.now() - started < UPLOAD_WAIT_MS) {
    await new Promise((resolve) => setTimeout(resolve, UPLOAD_POLL_MS));
    const s = await call(token, 'GET', `/v2/${item(creds.publisherId)}:fetchStatus`);
    upload = { ...upload, uploadState: s.lastAsyncUploadState || upload.uploadState };
  }
  if (upload.uploadState !== 'SUCCEEDED') fail(`the upload ended ${upload.uploadState || 'without a state'}`);
  console.log(`uploaded ${upload.crxVersion || zip.version}`);
  if (command === 'upload') { console.log('left as the draft: fill in the listing, then node dev/cws-publish.mjs submit'); process.exit(0); }
}

console.log('submitting for review…');
const published = await call(token, 'POST', `/v2/${item(creds.publisherId)}:publish`, { body: {} });
console.log(`state: ${published.state}`);
for (const w of (published.warningInfo && published.warningInfo.warnings) || []) console.log(`warning: ${w.reason}: ${w.description}`);
