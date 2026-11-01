#!/usr/bin/env node
// The Firefox package to addons.mozilla.org, through its API (v5).
//
//   node dev/amo-publish.mjs status       the latest versions and where their review stands
//   node dev/amo-publish.mjs check        the zips, the notes and the key, nothing sent
//   node dev/amo-publish.mjs validate     the package through AMO's validation alone; no
//                                         version is made
//   node dev/amo-publish.mjs              kepuli-tv-firefox-<version>.zip submitted as a new
//                                         listed version, with its source archive, the
//                                         release notes and the notes to reviewer
//
// What a submission by hand needed, here in one go: the add-on package,
// validated by AMO before the version is made; the source archive
// (kepuli-tv-firefox-<version>-amo-source.zip from firefox/amo-source.mjs),
// which the reviewers need for the FFmpeg build; release notes, taken from
// the GitHub release of the same version (its text before "Packages"); and
// the notes to reviewer, from firefox/reviewer-notes.txt, which AMO refuses
// above 3000 characters (1.3.0 was sent back for 3025).
//
// The zip is checked before anything is sent: its manifest must be the
// Firefox one (gecko settings, background.scripts) and of the version in
// firefox/manifest.json.
//
// The key stays outside the project, in ~/.config/kepuli-tv/amo.json
// (mode 600) or in the environment:
//
//   { "issuer": "user:…", "secret": "…" }        AMO_JWT_ISSUER, AMO_JWT_SECRET
//
// It is made at https://addons.mozilla.org/developers/addon/api/key/.
// No dependencies: the JSON web token is signed here with node:crypto.

import { createHmac, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const ADDON = 'kepuli-tv@bigtimesam.github.io';
const API = 'https://addons.mozilla.org/api/v5';
const CONFIG = join(homedir(), '.config', 'kepuli-tv', 'amo.json');
const NOTES = join(ROOT, 'firefox', 'reviewer-notes.txt');
const MAX_NOTES = 3000;
const LOCALE = 'en-GB';            // the listing's default language
const POLL_MS = 3000;
const VALIDATION_WAIT_MS = 5 * 60 * 1000;

const args = process.argv.slice(2);
const command = ['status', 'check', 'validate'].includes(args[0]) ? args[0] : 'publish';

const fail = (message) => { console.error(`amo-publish: ${message}`); process.exit(1); };

/* ---------------------------------------------------------------- key */

function key() {
  let file = {};
  if (existsSync(CONFIG)) {
    if ((statSync(CONFIG).mode & 0o077) !== 0) fail(`${CONFIG} can be read by others: chmod 600 it`);
    try { file = JSON.parse(readFileSync(CONFIG, 'utf8')); } catch (err) { fail(`${CONFIG} is not JSON: ${err.message}`); }
  }
  const issuer = process.env.AMO_JWT_ISSUER || file.issuer;
  const secret = process.env.AMO_JWT_SECRET || file.secret;
  if (!issuer || !secret) fail(`no key: see ${CONFIG} in the head of this file`);
  return { issuer, secret };
}

/** A token for one request: AMO allows at most five minutes. */
function token({ issuer, secret }) {
  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: issuer, jti: randomUUID(), iat: now, exp: now + 60 })}`;
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}

async function call(creds, method, path, { json, form } = {}) {
  const headers = { Authorization: `JWT ${token(creds)}` };
  if (json !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API}${path}`, { method, headers, body: form || (json !== undefined ? JSON.stringify(json) : undefined) });
  const text = await res.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { text: text.slice(0, 300) }; }
  if (!res.ok) fail(`${method} ${path} answered ${res.status}: ${JSON.stringify(body).slice(0, 600)}`);
  return body;
}

const addon = `/addons/addon/${encodeURIComponent(ADDON)}`;

/* -------------------------------------------------------------- files */

function checkedFiles() {
  const version = JSON.parse(readFileSync(join(ROOT, 'firefox', 'manifest.json'), 'utf8')).version;
  const zip = join(ROOT, `kepuli-tv-firefox-${version}.zip`);
  const source = join(ROOT, `kepuli-tv-firefox-${version}-amo-source.zip`);
  if (!existsSync(zip)) fail(`${zip} is not there: make it with node dev/package.mjs firefox --zip`);
  if (!existsSync(source)) fail(`${source} is not there: make it with node firefox/amo-source.mjs`);
  let manifest;
  try {
    manifest = JSON.parse(execFileSync('unzip', ['-p', zip, 'manifest.json'], { encoding: 'utf8' }));
  } catch (err) {
    fail(`${zip} holds no readable manifest.json: ${err.message}`);
  }
  const problems = [];
  const gecko = manifest.browser_specific_settings && manifest.browser_specific_settings.gecko;
  if (!gecko || gecko.id !== ADDON) problems.push(`no gecko id ${ADDON} — the Chrome manifest?`);
  if (!manifest.background || !manifest.background.scripts) problems.push('no background.scripts');
  if (manifest.version !== version) problems.push(`version ${manifest.version}, where firefox/manifest.json says ${version}`);
  if (problems.length) fail(`${zip} is not the Firefox package of ${version}: ${problems.join('; ')}`);

  if (!existsSync(NOTES)) fail(`${NOTES} is not there`);
  const notes = readFileSync(NOTES, 'utf8').trim();
  // The form may count a line break as two characters.
  const counted = notes.replace(/\n/g, '\r\n').length;
  if (counted > MAX_NOTES) fail(`the notes to reviewer are ${counted} characters with CRLF line breaks; AMO takes ${MAX_NOTES}`);
  if (!notes.includes(version)) console.warn(`amo-publish: the notes to reviewer do not mention ${version} — are they this version's?`);

  return { version, zip, source, notes, release: releaseNotes(version) };
}

/** The GitHub release's text of the version, up to its package list, as plain text. */
function releaseNotes(version) {
  let body;
  try {
    body = execFileSync('gh', ['release', 'view', `v${version}`, '--json', 'body', '-q', '.body'], { cwd: ROOT, encoding: 'utf8' });
  } catch {
    fail(`no GitHub release v${version} to take the release notes from: make the release first`);
  }
  return body.split(/^###\s+Packages/m)[0]
    .replace(/^#+\s*/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ------------------------------------------------------------- status */

async function status(creds) {
  const list = await call(creds, 'GET', `${addon}/versions/?filter=all_without_unlisted&page_size=5`);
  for (const v of list.results || []) {
    console.log(`${v.version.padEnd(8)} ${String(v.file && v.file.status).padEnd(11)} ${v.file ? v.file.created.slice(0, 16).replace('T', ' ') : ''}`);
  }
  return list.results || [];
}

/* --------------------------------------------------------------- main */

const files = command === 'status' ? null : checkedFiles();
if (files) {
  console.log(`${files.zip}: the Firefox package of ${files.version}`);
  console.log(`source: ${files.source}, ${Math.round(statSync(files.source).size / 1048576)} MB`);
  console.log(`notes to reviewer: ${files.notes.length} characters; release notes: ${files.release.length}`);
}
const creds = key();
const versions = await status(creds);
if (command === 'status' || command === 'check') process.exit(0);
if (command === 'publish' && versions.some((v) => v.version === files.version)) fail(`${files.version} is on AMO already`);

console.log('uploading the package…');
const form = new FormData();
form.append('upload', new Blob([readFileSync(files.zip)]), `kepuli-tv-firefox-${files.version}.zip`);
form.append('channel', 'listed');
let upload = await call(creds, 'POST', '/addons/upload/', { form });
const started = Date.now();
while (!upload.processed && Date.now() - started < VALIDATION_WAIT_MS) {
  await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  upload = await call(creds, 'GET', `/addons/upload/${upload.uuid}/`);
}
if (!upload.processed) fail('AMO did not finish validating the package within five minutes');
const messages = (upload.validation && upload.validation.messages) || [];
const errors = messages.filter((m) => m.type === 'error');
console.log(`validated: ${errors.length} errors, ${messages.filter((m) => m.type === 'warning').length} warnings`);
if (!upload.valid) fail(`the package did not pass validation: ${errors.map((m) => m.message).join('; ')}`);
if (command === 'validate') process.exit(0);

console.log('making the version, with its source…');
const create = new FormData();
create.append('upload', upload.uuid);
create.append('source', new Blob([readFileSync(files.source)]), `kepuli-tv-firefox-${files.version}-amo-source.zip`);
const version = await call(creds, 'POST', `${addon}/versions/`, { form: create });

console.log('adding the release notes and the notes to reviewer…');
await call(creds, 'PATCH', `${addon}/versions/${version.id}/`, {
  json: { release_notes: { [LOCALE]: files.release }, approval_notes: files.notes },
});
const done = await call(creds, 'GET', `${addon}/versions/${version.id}/`);
console.log(`${done.version}: ${done.file && done.file.status}, source ${done.source ? 'attached' : 'MISSING'}`);
