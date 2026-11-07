#!/usr/bin/env node
// The Chrome Web Store's detailed description, filled into the dashboard.
//
// The Web Store API has no field for the listing, and extensions are not let
// onto the Web Store's pages, so this drives a Chrome of its own over the
// DevTools protocol: a profile kept for this alone, signed in by hand once.
//
//   node dev/cws-listing-fill.mjs            compare every language, fill the
//                                            ones that differ, save the draft,
//                                            read all back and record them
//   node dev/cws-listing-fill.mjs --dry      compare only
//   node dev/cws-listing-fill.mjs --only fi de   just those languages
//   node dev/cws-listing-fill.mjs --signed-in    only whether the dashboard
//                                            opens signed in (dev/release.mjs
//                                            asks before the go: Google asked
//                                            for a passkey at 1.7.0, with the
//                                            owner away from the machine)
//
// The first run opens the Chrome and stops at Google's sign-in: sign in to
// the publisher's account in that window and run again. The sign-in stays in
// the profile, ~/.config/kepuli-tv/cws-chrome (KEPULI_CWS_PROFILE), on port
// 9444 (KEPULI_CWS_PORT).
//
// Only the description is written; the name and summary come from the
// package's _locales. What the dashboard holds afterwards is read back and
// compared, and only what matches is recorded in store/cws-listing.json (as
// `cws-publish.mjs listing --done` does), so a changed dashboard that this no
// longer understands fails loudly rather than being recorded as done. The
// draft is not submitted: node dev/cws-publish.mjs submit does that.
//
// No dependencies: Node's own WebSocket speaks the protocol.

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readListings, unwrap, forChrome, CHROME_UNSUPPORTED } from './listings.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const ITEM_ID = 'okkgclcakhjhldkdcblgagoaibghpfmi';
const CONFIG = join(homedir(), '.config', 'kepuli-tv', 'cws.json');
const PORT = Number(process.env.KEPULI_CWS_PORT || 9444);
const PROFILE = process.env.KEPULI_CWS_PROFILE || join(homedir(), '.config', 'kepuli-tv', 'cws-chrome');
const CHROME = process.env.KEPULI_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const only = args.includes('--only') ? args.slice(args.indexOf('--only') + 1).filter((a) => !a.startsWith('--')) : null;

const fail = (message) => { console.error(`cws-listing-fill: ${message}`); process.exit(1); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The dashboard's language code for a store/listings/ file: pt_BR → pt-BR. */
const dashCode = (locale) => locale.replace('_', '-');
/** The text as the field holds it, for comparing. */
const norm = (text) => text.replace(/\r/g, '').replace(/[ \t]+$/gm, '').trim();

const wanted = readListings()
  .filter((l) => !CHROME_UNSUPPORTED.includes(l.locale))
  .filter((l) => !only || only.includes(l.locale) || only.includes(dashCode(l.locale)))
  .map((l) => ({ locale: l.locale, code: dashCode(l.locale), text: unwrap(forChrome(l.detailed)) }));
if (!wanted.length) fail('no such language in store/listings/');

const publisher = process.env.CWS_PUBLISHER_ID || (existsSync(CONFIG) && JSON.parse(readFileSync(CONFIG, 'utf8')).publisherId);
if (!publisher) fail(`no publisherId in ${CONFIG} or CWS_PUBLISHER_ID`);
const EDIT = `https://chrome.google.com/webstore/devconsole/${publisher}/${ITEM_ID}/edit`;

/* ------------------------------------------------------------- browser */

const http = async (path) => (await fetch(`http://127.0.0.1:${PORT}${path}`)).json();
async function running() { try { await http('/json/version'); return true; } catch { return false; } }

if (!(await running())) {
  mkdirSync(PROFILE, { recursive: true });
  spawn(CHROME, [`--user-data-dir=${PROFILE}`, `--remote-debugging-port=${PORT}`, '--no-first-run', '--no-default-browser-check', EDIT],
    { detached: true, stdio: 'ignore' }).unref();
  for (let i = 0; i < 40 && !(await running()); i++) await sleep(250);
  if (!(await running())) fail(`Chrome did not open port ${PORT}`);
  await sleep(3000);
}

async function connect() {
  const pages = (await http('/json/list')).filter((t) => t.type === 'page');
  let tab = pages.find((t) => t.url.startsWith(EDIT)) || pages.find((t) => /webstore\/devconsole|accounts\.google/.test(t.url));
  if (!tab) tab = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(EDIT)}`, { method: 'PUT' })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (pending.has(d.id)) { const { resolve, reject } = pending.get(d.id); pending.delete(d.id); d.error ? reject(new Error(d.error.message)) : resolve(d.result); }
  };
  const call = (method, params = {}) => new Promise((resolve, reject) => { pending.set(++id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  const run = async (fn, ...a) => {
    const { result, exceptionDetails } = await call('Runtime.evaluate', {
      expression: `(${fn})(...${JSON.stringify(a)})`, awaitPromise: true, returnByValue: true, userGesture: true,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
    return result.value;
  };
  return { ws, call, run };
}

const page = await connect();
await page.call('Page.bringToFront');

/** Waits until the edit page shows its description field. */
async function open() {
  // The listing page itself: the dashboard's other pages of the item
  // (…/edit/status, …/edit/package) begin with the same address.
  const href = await page.run(() => location.href.split(/[?#]/)[0].replace(/\/$/, ''));
  if (href !== EDIT) await page.run((u) => { location.href = u; }, EDIT);
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    const state = await page.run(() => ({ href: location.href, ready: !!document.querySelector('textarea') && [...document.querySelectorAll('[role=combobox]')].some((e) => /Language/.test(e.innerText)) })).catch(() => ({}));
    if (state.href && /accounts\.google\.com/.test(state.href)) fail('not signed in: sign in to the publisher\'s Google account in the Chrome that opened, then run this again');
    if (state.ready) return;
  }
  fail('the store listing page did not show its language menu and description field: has the dashboard changed?');
}

if (args.includes('--signed-in')) {
  await open();
  console.log('the dashboard opens signed in');
  process.exit(0);
}

/** Switches the listing to one language and returns its description. */
async function pick(code) {
  const result = await page.run(async (code) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const combo = [...document.querySelectorAll('[role=combobox]')].find((e) => /Language/.test(e.innerText));
    const option = document.querySelector(`ul[aria-label=Language] li[data-value="${code}"]`);
    if (!combo || !option) return { missing: true };
    const value = () => document.querySelector('textarea')?.value ?? null;
    if (option.getAttribute('aria-selected') !== 'true') {
      // For a moment after the switch the field still holds the language
      // before, and its own text arrives a little later: wait for the field
      // to change, then for it to stay put.
      const before = value();
      combo.click();
      await wait(400);
      option.click();
      for (let i = 0; i < 40 && value() === before; i++) await wait(250);
    }
    for (let i = 0; i < 40; i++) {
      await wait(250);
      if (option.getAttribute('aria-selected') === 'true' && combo.innerText.includes(`– ${code}`)) break;
    }
    let last = value();
    for (let still = 0, i = 0; still < 4 && i < 40; i++) {
      await wait(250);
      const now = value();
      still = now === last ? still + 1 : 0;
      last = now;
    }
    return { selected: combo.innerText.includes(`– ${code}`), text: last };
  }, code);
  if (result.missing) fail(`the dashboard offers no language "${code}": is it in the uploaded package's _locales?`);
  if (!result.selected || result.text == null) fail(`could not switch the listing to ${code}`);
  return result.text;
}

/** Types the description into the field as a paste would. */
async function type(text) {
  await page.run(() => { const a = document.querySelector('textarea'); a.focus(); a.select(); });
  await page.call('Input.insertText', { text });
  await page.run(() => { const a = document.querySelector('textarea'); a.dispatchEvent(new Event('change', { bubbles: true })); a.blur(); });
}

/** Presses Save draft and waits for the dashboard to say it is saved. */
async function save() {
  const said = await page.run(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    // A tip that floats over the page ("…guides and tips here…") goes first.
    for (const b of document.querySelectorAll('button')) if (b.innerText.trim() === 'Got it') b.click();
    const button = [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Save draft');
    if (!button) return { error: 'no Save draft button' };
    // The toast says "Saving item…" and then "Item saved." for a moment
    // only, so it is watched for rather than looked up afterwards.
    const said = [];
    const watch = new MutationObserver(() => {
      for (const e of document.querySelectorAll('[role=status],[role=alert],[aria-live]')) {
        const text = e.innerText.trim();
        if (text && !said.includes(text)) said.push(text);
      }
    });
    watch.observe(document.body, { subtree: true, childList: true, characterData: true });
    try {
      // The button stays disabled until the page has taken the edit in, and
      // a click before that does nothing: wait for it, and click again if
      // the dashboard says nothing.
      for (let attempt = 0; attempt < 3; attempt++) {
        for (let i = 0; i < 40 && button.disabled; i++) await wait(250);
        if (button.disabled) return { error: 'Save draft stayed disabled: the edit did not register' };
        // The last save's "Item saved." can still be on the page: only what
        // follows this click's "Saving item…" counts.
        said.length = 0;
        button.click();
        for (let i = 0; i < 40; i++) {
          await wait(250);
          const text = said.join(' | ');
          if (/saving item.*item saved/i.test(text)) return { toast: text };
          if (/error|could not|failed|unable/i.test(text)) return { error: text };
        }
      }
      return { error: `no word from the dashboard after Save draft (${said.join(' | ')})` };
    } finally { watch.disconnect(); }
  });
  if (said.error) throw new Error(said.error);
}

/* ---------------------------------------------------------------- run */

await open();
const differ = [];
for (const l of wanted) {
  const now = await pick(l.code);
  const same = norm(now) === norm(l.text);
  console.log(`${l.code.padEnd(5)} ${same ? 'as listed' : now.trim() ? 'differs' : 'empty'}`);
  if (!same) differ.push(l);
}

if (dry) {
  console.log(differ.length ? `to fill: ${differ.map((l) => l.code).join(' ')}` : 'the dashboard has every language as store/listings/ says');
  page.ws.close();
  process.exit(0);
}

// After a save the dashboard sometimes ignores the next language's edit
// and leaves Save draft disabled (measured on a rejected draft): the page is
// loaded again and the language tried once more before giving up.
for (const l of differ) {
  for (let attempt = 0; ; attempt++) {
    if (norm(await pick(l.code)) === norm(l.text)) { console.log(`${l.code.padEnd(5)} already as listed`); break; }
    await type(l.text);
    try {
      await save();
      console.log(`${l.code.padEnd(5)} filled and saved`);
      break;
    } catch (err) {
      if (attempt >= 1) fail(`saving the draft: ${err.message}`);
      console.log(`${l.code.padEnd(5)} not taken (${err.message}); the page loaded again`);
      await page.run(() => location.reload());
      await sleep(2000);
      await open();
    }
  }
}

// Read everything back from a fresh page, so what is recorded is what the
// dashboard kept rather than what this typed.
if (differ.length) {
  await page.run(() => location.reload());
  await sleep(2000);
  await open();
}
const kept = [];
const lost = [];
for (const l of wanted) (norm(await pick(l.code)) === norm(l.text) ? kept : lost).push(l);
page.ws.close();

if (kept.length) execFileSync(process.execPath, [join(ROOT, 'dev', 'cws-publish.mjs'), 'listing', '--done', ...kept.map((l) => l.locale)], { stdio: 'inherit' });
if (lost.length) fail(`the dashboard did not keep: ${lost.map((l) => l.code).join(' ')}`);
console.log(`all ${kept.length} languages in the draft as store/listings/ says; next: node dev/cws-publish.mjs submit`);
