// Fills the Chrome dashboard's permission justifications (Privacy page) for
// the permissions named, from store/chrome-dashboard.txt's "<PERM>
// JUSTIFICATION" sections, saves the draft and reads them back. Needed when a
// release adds a permission: the dashboard refuses to submit without them.
// Drives the dashboard Chrome of dev/cws-listing-fill.mjs (port 9444, signed
// in); run after cws-publish.mjs upload, before submit.
//
//   node .claude/skills/ship/cws-privacy-fill.mjs alarms notifications
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const CONFIG = join(homedir(), '.config', 'kepuli-tv', 'cws.json');
const PORT = Number(process.env.KEPULI_CWS_PORT || 9444);
const publisher = process.env.CWS_PUBLISHER_ID || (existsSync(CONFIG) && JSON.parse(readFileSync(CONFIG, 'utf8')).publisherId);
if (!publisher) { console.error(`no publisherId in ${CONFIG}`); process.exit(1); }
const EDIT = `https://chrome.google.com/webstore/devconsole/${publisher}/okkgclcakhjhldkdcblgagoaibghpfmi/edit`;
const perms = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const doc = readFileSync(`${REPO}/store/chrome-dashboard.txt`, 'utf8');
const textOf = (perm) => {
  const m = new RegExp(`^${perm.toUpperCase()} JUSTIFICATION[^\\n]*\\n-+\\n([\\s\\S]*?)\\n\\n\\n`, 'm').exec(doc);
  if (!m) throw new Error(`no ${perm} section`);
  return m[1].trim();
};
const pages = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter((t) => t.type === 'page');
const tab = pages.find((t) => /webstore\/devconsole|accounts\.google/.test(t.url));
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0; const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const call = (method, params = {}) => new Promise((r) => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (e) => { const d = await call('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true, userGesture: true }); if (d.result?.exceptionDetails) throw new Error(d.result.exceptionDetails.exception?.description); return d.result?.result?.value; };
const field = (perm) => `[...document.querySelectorAll('textarea')].find((a) => (a.getAttribute('aria-labelledby') || '').split(' ').some((i) => document.getElementById(i)?.innerText.trim() === ${JSON.stringify(`${perm} justification`)}))`;

await call('Page.bringToFront');
await ev(`location.href = ${JSON.stringify(`${EDIT}/privacy`)}`).catch(() => {});
for (let i = 0; i < 60; i++) { await sleep(500); if (await ev(`/accounts\\.google/.test(location.href) ? 'signin' : document.querySelectorAll('textarea').length`).catch(() => 0) === 'signin') { console.log('not signed in'); process.exit(1); } if (await ev(`document.querySelectorAll('textarea').length > 1`).catch(() => false)) break; }
await sleep(1500);
let missing = [], changed = 0;
for (const perm of perms) {
  const text = textOf(perm);
  if (text.length > 1000) throw new Error(`${perm}: ${text.length} characters`);
  const now = await ev(`${field(perm)}?.value ?? null`);
  if (now === null) { missing.push(perm); continue; }
  if (now.trim() === text) { console.log(`${perm}: already as written`); continue; }
  await ev(`(() => { const a = ${field(perm)}; a.scrollIntoView({ block: 'center' }); a.focus(); a.select(); })()`);
  await call('Input.insertText', { text });
  await ev(`(() => { const a = ${field(perm)}; a.dispatchEvent(new Event('change', { bubbles: true })); a.blur(); })()`);
  changed++;
  console.log(`${perm}: filled, ${text.length} characters`);
}
if (changed) {
  const said = await ev(`(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    for (const b of document.querySelectorAll('button')) if (b.innerText.trim() === 'Got it') b.click();
    const button = [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Save draft');
    if (!button) return 'no Save draft button';
    const said = [];
    new MutationObserver(() => { for (const e of document.querySelectorAll('[role=status],[role=alert],[aria-live]')) { const t = e.innerText.trim(); if (t && !said.includes(t)) said.push(t); } }).observe(document.body, { subtree: true, childList: true, characterData: true });
    for (let i = 0; i < 40 && button.disabled; i++) await wait(250);
    if (button.disabled) return 'Save draft stayed disabled';
    button.click();
    for (let i = 0; i < 60 && !said.some((t) => /saved/i.test(t)); i++) await wait(250);
    return said.join(' | ') || 'nothing said';
  })()`);
  console.log(`save: ${said}`);
  await sleep(1500);
  await ev(`location.reload()`).catch(() => {});
  for (let i = 0; i < 60; i++) { await sleep(500); if (await ev(`document.querySelectorAll('textarea').length > 1`).catch(() => false)) break; }
  await sleep(1500);
  for (const perm of perms.filter((p) => !missing.includes(p))) {
    const back = await ev(`${field(perm)}?.value ?? null`);
    console.log(`${perm}: read back ${back?.trim() === textOf(perm) ? 'as written' : 'DIFFERENT'}`);
    if (back?.trim() !== textOf(perm)) process.exitCode = 1;
  }
}
if (missing.length) console.log(`no field for: ${missing.join(' ')}`);
if (missing.length) process.exitCode = 1;
ws.close();
