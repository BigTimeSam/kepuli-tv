#!/usr/bin/env node
// addons.mozilla.org's screenshots replaced with brand/firefox-screenshots/.
//
//   node dev/amo-screenshots.mjs           the numbered PNGs uploaded in order,
//                                          then the old previews deleted
//   node dev/amo-screenshots.mjs --old <id,id…>  a run cut short taken up: the
//                                          previews named are the old ones, the
//                                          others went up already, in order; the
//                                          rest are uploaded, then the old deleted
//   node dev/amo-screenshots.mjs --dry     the previews AMO holds, nothing changed
//   node dev/amo-screenshots.mjs --check   whether AMO has the pictures in
//                                          brand/ (by the record below; offline)
//   node dev/amo-screenshots.mjs --done    record the pictures in brand/ as
//                                          AMO's, after an upload by hand
//
// What went up is recorded in store/amo-screenshots.json, a SHA-256 a file,
// and dev/release.mjs asks --check. At 1.7.0 the screenshots went up after
// the version and AMO asked for an hour between two of them; they belong to
// the add-on, not to a version, so upload them as soon as they are
// committed, days before a release if need be.
//
// Through AMO's API (v5), with the key dev/amo-publish.mjs uses
// (~/.config/kepuli-tv/amo.json). The new ones go up first, so the page is
// never without screenshots, and the old ones are deleted after. The
// captions are AMO's per preview and per language, so a new preview has
// none: run node dev/amo-publish.mjs captions afterwards.
//
// AMO throttles a run of writes and can ask for hours between them (it
// asked for 9,551 seconds on 2026-11-03). The wait is done here, quietly;
// run this in the background, and chain captions after it.

import { createHash, createHmac, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'brand', 'firefox-screenshots');
const API = 'https://addons.mozilla.org/api/v5';
const ADDON = `/addons/addon/${encodeURIComponent('kepuli-tv@bigtimesam.github.io')}`;
const CONFIG = join(homedir(), '.config', 'kepuli-tv', 'amo.json');
const RECORD = join(ROOT, 'store', 'amo-screenshots.json');
const fail = (m) => { console.error(`amo-screenshots: ${m}`); process.exit(1); };

const files = readdirSync(DIR).filter((f) => /^\d\d-.*\.png$/.test(f)).sort();
if (!files.length) fail(`no numbered PNGs in ${DIR}`);
const hashes = () => Object.fromEntries(files.map((f) => [f, createHash('sha256').update(readFileSync(join(DIR, f))).digest('hex')]));
const record = () => writeFileSync(RECORD, `${JSON.stringify(hashes(), null, 2)}\n`);

if (process.argv.includes('--check')) {
  const sent = existsSync(RECORD) ? JSON.parse(readFileSync(RECORD, 'utf8')) : {};
  const behind = Object.entries(hashes()).filter(([f, h]) => sent[f] !== h).map(([f]) => f);
  const gone = Object.keys(sent).filter((f) => !files.includes(f));
  if (behind.length || gone.length) fail(`AMO is behind brand/firefox-screenshots/ in ${[...behind, ...gone].join(' ')}: node dev/amo-screenshots.mjs, then amo-publish.mjs captions`);
  console.log(`AMO has the ${files.length} screenshots in brand/firefox-screenshots/`);
  process.exit(0);
}
if (process.argv.includes('--done')) { record(); console.log(`recorded ${files.length} screenshots as AMO's`); process.exit(0); }

if (!existsSync(CONFIG)) fail(`no key: ${CONFIG}`);
if ((statSync(CONFIG).mode & 0o077) !== 0) fail(`${CONFIG} can be read by others: chmod 600 it`);
const { issuer, secret } = JSON.parse(readFileSync(CONFIG, 'utf8'));
const token = () => {
  const b64 = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: issuer, jti: randomUUID(), iat: now, exp: now + 60 })}`;
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
};

async function call(method, path, { json, form } = {}) {
  for (;;) {
    const headers = { Authorization: `JWT ${token()}` };
    if (json) headers['Content-Type'] = 'application/json';
    const res = await fetch(API + path, { method, headers, body: form || (json && JSON.stringify(json)) });
    const text = await res.text();
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = { text }; }
    if (res.status === 429) {
      const wait = Number((String(body.detail).match(/(\d+) second/) || [])[1] || 15);
      console.log(`AMO asks to wait ${wait} s…`);
      await new Promise((r) => setTimeout(r, (wait + 1) * 1000));
      continue;
    }
    if (!res.ok) fail(`${method} ${path} answered ${res.status}: ${text.slice(0, 400)}`);
    return body;
  }
}

const previews = async () => ((await call('GET', `${ADDON}/`)).previews || []).sort((a, b) => a.position - b.position);

const before = await previews();
console.log(`AMO holds ${before.length} preview(s): ${before.map((p) => p.id).join(' ')}`);
if (process.argv.includes('--dry')) process.exit(0);

// A run cut short (1.10.0: a three-hour limit ran out while AMO asked for
// six more) left four new previews after the five old ones. Started again
// from the top it would have put up those four a second time.
const at = process.argv.indexOf('--old');
const old = at > 0 ? new Set((process.argv[at + 1] || '').split(',').filter(Boolean).map(Number)) : null;
// An old one already gone (deleted by hand on the Developer Hub, where
// AMO's API throttle does not reach) is simply not deleted again.
const stale = old ? before.filter((p) => old.has(p.id)) : before;
const made = old ? before.filter((p) => !old.has(p.id)).map((p) => p.id) : [];
if (made.length > files.length) fail(`AMO holds ${made.length} new previews for ${files.length} pictures`);
if (made.length) console.log(`already up: ${files.slice(0, made.length).join(' ')}`);
for (const [i, name] of files.entries()) {
  if (i < made.length) continue;
  const form = new FormData();
  form.append('image', new Blob([readFileSync(join(DIR, name))], { type: 'image/png' }), name);
  form.append('position', String(i));
  made.push((await call('POST', `${ADDON}/previews/`, { form })).id);
  console.log(`uploaded ${name}`);
}
for (const p of stale) { await call('DELETE', `${ADDON}/previews/${p.id}/`); console.log(`deleted the old ${p.id}`); }
const after = await previews();
const inOrder = JSON.stringify(after.map((p) => p.id)) === JSON.stringify(made);
if (inOrder) record();
console.log(`AMO holds ${after.length}: ${inOrder ? 'the new ones, in order' : 'NOT in the expected order, check the page'}; next: node dev/amo-publish.mjs captions`);
process.exit(inOrder ? 0 : 1);
