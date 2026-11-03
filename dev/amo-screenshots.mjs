#!/usr/bin/env node
// addons.mozilla.org's screenshots replaced with brand/firefox-screenshots/.
//
//   node dev/amo-screenshots.mjs           the numbered PNGs uploaded in order,
//                                          then the old previews deleted
//   node dev/amo-screenshots.mjs --dry     the previews AMO holds, nothing changed
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

import { createHmac, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'brand', 'firefox-screenshots');
const API = 'https://addons.mozilla.org/api/v5';
const ADDON = `/addons/addon/${encodeURIComponent('kepuli-tv@bigtimesam.github.io')}`;
const CONFIG = join(homedir(), '.config', 'kepuli-tv', 'amo.json');
const fail = (m) => { console.error(`amo-screenshots: ${m}`); process.exit(1); };

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
const files = readdirSync(DIR).filter((f) => /^\d\d-.*\.png$/.test(f)).sort();
if (!files.length) fail(`no numbered PNGs in ${DIR}`);

const before = await previews();
console.log(`AMO holds ${before.length} preview(s): ${before.map((p) => p.id).join(' ')}`);
if (process.argv.includes('--dry')) process.exit(0);

const made = [];
for (const [i, name] of files.entries()) {
  const form = new FormData();
  form.append('image', new Blob([readFileSync(join(DIR, name))], { type: 'image/png' }), name);
  form.append('position', String(i));
  made.push((await call('POST', `${ADDON}/previews/`, { form })).id);
  console.log(`uploaded ${name}`);
}
for (const p of before) { await call('DELETE', `${ADDON}/previews/${p.id}/`); console.log(`deleted the old ${p.id}`); }
const after = await previews();
const inOrder = JSON.stringify(after.map((p) => p.id)) === JSON.stringify(made);
console.log(`AMO holds ${after.length}: ${inOrder ? 'the new ones, in order' : 'NOT in the expected order, check the page'}; next: node dev/amo-publish.mjs captions`);
process.exit(inOrder ? 0 : 1);
