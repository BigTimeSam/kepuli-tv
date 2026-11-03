#!/usr/bin/env node
// The Chrome Web Store's screenshots replaced with brand/screenshots/.
//
//   node dev/cws-screenshots.mjs           every global screenshot removed, the
//                                          five of brand/screenshots/ uploaded
//                                          in their order, the draft saved
//   node dev/cws-screenshots.mjs --dry     what the dashboard holds, nothing changed
//
// Like dev/cws-listing-fill.mjs it drives the Chrome kept for the dashboard
// (~/.config/kepuli-tv/cws-chrome, port 9444, signed in by hand), over the
// DevTools protocol: the store has no API for the screenshots, and
// extensions are kept off its pages. Run cws-listing-fill.mjs first if the
// Chrome is not open: it starts it and says when to sign in.
//
// The dashboard asks to confirm every removal; that is answered here. It
// takes at most five, so the old ones go before the new ones come. The
// listing cannot be saved while a version is in review ("You may not edit
// or publish an item that is in review"): replace the screenshots before
// submitting, or after the review. The draft is saved, not submitted:
// node dev/cws-publish.mjs submit does that.

import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'brand', 'screenshots');
const PORT = Number(process.env.KEPULI_CWS_PORT || 9444);
const DRY = process.argv.includes('--dry');
const FILES = readdirSync(DIR).filter((f) => /^\d\d-.*\.png$/.test(f)).sort().map((f) => join(DIR, f));
const fail = (m) => { console.error(`cws-screenshots: ${m}`); process.exit(1); };
if (!FILES.length || FILES.length > 5) fail(`${DIR} holds ${FILES.length} numbered screenshots; the store takes one to five`);

let version;
try { version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); } catch { fail(`no Chrome on port ${PORT}: run node dev/cws-listing-fill.mjs --dry first`); }
const ws = new WebSocket(version.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const call = (method, params = {}, sessionId) => new Promise((ok, no) => { const i = ++id; pending.set(i, { ok, no }); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
ws.onmessage = (m) => { const r = JSON.parse(m.data); const p = pending.get(r.id); if (p) { pending.delete(r.id); r.error ? p.no(new Error(JSON.stringify(r.error))) : p.ok(r.result); } };
await new Promise((r) => { ws.onopen = r; });
const { targetInfos } = await call('Target.getTargets');
const target = targetInfos.find((t) => t.type === 'page' && t.url.includes('/devconsole/') && t.url.includes('/edit'));
if (!target) fail('the dashboard\'s Store listing page is not open in that Chrome');
const { sessionId: s } = await call('Target.attachToTarget', { targetId: target.targetId, flatten: true });
const ev = async (expression) => {
  const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, s);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The Global screenshots section: the element under its heading that holds its file input.
const SECTION = `(() => { let e = [...document.querySelectorAll('p')].find((p) => p.textContent.trim() === 'Global screenshots'); while (e && !e.querySelector('input[type=file]')) e = e.parentElement; return e; })()`;
const count = () => ev(`${SECTION}?.querySelectorAll('img').length ?? -1`);
const locked = await ev(`document.documentElement.innerHTML.includes('You may not edit or publish an item that is in review')`);

const have = await count();
if (have < 0) fail('no "Global screenshots" section on the page: the dashboard changed, see this file');
console.log(`the dashboard holds ${have} screenshot(s)${locked ? '; the item is in review, so nothing can be saved' : ''}`);
if (DRY) process.exit(0);
if (locked) fail('the item is in review: replace the screenshots after it, or before submitting');

for (let n = await count(); n > 0; n = await count()) {
  await ev(`${SECTION}.querySelector('[aria-label^="Remove image"]').click()`);
  for (let k = 0; k < 25; k++) {
    const confirmed = await ev(`(() => { const d = [...document.querySelectorAll('[role=dialog],[role=alertdialog]')].find((d) => /remove this image/i.test(d.textContent));
      const b = d && [...d.querySelectorAll('[role=button],button')].find((b) => b.textContent.trim() === 'Remove'); if (b) { b.click(); return true; } return false; })()`);
    if (confirmed) break;
    await sleep(200);
  }
  for (let k = 0; k < 50 && await count() === n; k++) await sleep(200);
  if (await count() === n) fail('a screenshot would not go');
}
console.log('removed the old ones');

for (const [i, file] of FILES.entries()) {
  const { result } = await call('Runtime.evaluate', { expression: `${SECTION}.querySelector('input[type=file]')` }, s);
  await call('DOM.setFileInputFiles', { files: [file], objectId: result.objectId }, s);
  for (let k = 0; k < 150 && await count() < i + 1; k++) await sleep(200);
  if (await count() < i + 1) fail(`${file} did not upload`);
  await sleep(800);
  console.log(`uploaded ${file.slice(ROOT.length + 1)}`);
}
const saved = await ev(`(() => { const b = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Save draft'); if (!b || b.disabled) return false; b.click(); return true; })()`);
if (!saved) fail('Save draft stayed disabled');
await sleep(5000);
console.log(`saved: ${await count()} screenshot(s) in the draft; next: node dev/cws-publish.mjs submit`);
process.exit(0);
