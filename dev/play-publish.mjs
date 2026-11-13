#!/usr/bin/env node
// An Android app's bundle (the phone's or the television's) taken to Google
// Play's internal testing.
//
// Play has an API for uploads, but it wants a service account with a key of
// its own, and the first release of a new app is made in the Play Console
// anyway. So this drives the Play Console in a Chrome of its own over the
// DevTools protocol, as cws-listing-fill.mjs drives the Chrome Web Store's
// dashboard: the owner signs in once in that Chrome, and the bundle, which
// at 160 MB is more than a browser extension will carry, is handed to the
// page's file field by its path.
//
//   node dev/play-publish.mjs login     opens the Chrome at the Play Console, to sign in
//   node dev/play-publish.mjs status    whether it is signed in, and the apps the account has
//   node dev/play-publish.mjs upload [mobile|tv]
//                                       the phone's bundle (or the television's) into a new
//                                       internal testing release, left as a draft: nothing
//                                       is rolled out to testers
//
// The Chrome is kept apart from the Chrome Web Store's (another Google
// account): port 9446 (KEPULI_PLAY_PORT), profile ~/.config/kepuli-tv/play-chrome
// (KEPULI_PLAY_PROFILE). The app is found in the account by its name
// (KEPULI_PLAY_APP, "Kepuli-TV" by default); it must have been created in
// the console first. The bundle is dist/android/kepuli-tv-android-<mobile|tv>-<version>.aab,
// or the file KEPULI_PLAY_BUNDLE names. The two are one application in
// Play: the television's goes to the Android TV form factor's own track
// (added once under Advanced settings, Form factors), which is chosen on
// the internal testing page, and its version codes are a million above
// the phone's (android/app/build.gradle).
//
// Rolling a release out, the store listing and the forms about the app's
// content are the owner's to do in the console: this tool uploads, and
// says what the page shows.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const PORT = Number(process.env.KEPULI_PLAY_PORT || 9446);
const PROFILE = process.env.KEPULI_PLAY_PROFILE || join(homedir(), '.config', 'kepuli-tv', 'play-chrome');
const CHROME = process.env.KEPULI_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const APP = process.env.KEPULI_PLAY_APP || 'Kepuli-TV';
const CONSOLE = 'https://play.google.com/console/developers';
// Signed out, the console's address leads to Play's page for businesses,
// which has no way in: the sign-in page is asked for by name.
const SIGN_IN = `https://accounts.google.com/ServiceLogin?continue=${encodeURIComponent(CONSOLE)}`;
const VERSION = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8')).version;
const FORM = process.argv[3] || 'mobile';
const BUNDLE = process.env.KEPULI_PLAY_BUNDLE || join(ROOT, 'dist', 'android', `kepuli-tv-android-${FORM}-${VERSION}.aab`);

const command = process.argv[2];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fail = (message) => { console.error(`play-publish: ${message}`); process.exit(1); };
if (!['login', 'status', 'upload'].includes(command) || !['mobile', 'tv'].includes(FORM)) fail('usage: node dev/play-publish.mjs login|status|upload [mobile|tv]');

/* ------------------------------------------------------------- browser */

const http = async (path, init) => (await fetch(`http://127.0.0.1:${PORT}${path}`, init)).json();
async function running() { try { await http('/json/version'); return true; } catch { return false; } }

if (!(await running())) {
  mkdirSync(PROFILE, { recursive: true });
  spawn(CHROME, [`--user-data-dir=${PROFILE}`, `--remote-debugging-port=${PORT}`, '--no-first-run', '--no-default-browser-check', command === 'login' ? SIGN_IN : CONSOLE],
    { detached: true, stdio: 'ignore' }).unref();
  for (let i = 0; i < 40 && !(await running()); i++) await sleep(250);
  if (!(await running())) fail(`Chrome did not open port ${PORT}`);
  await sleep(3000);
}

if (command === 'login') {
  const open = (await http('/json/list')).filter((t) => t.type === 'page');
  if (!open.some((t) => /accounts\.google\.com|play\.google\.com\/console/.test(t.url))) await http(`/json/new?${encodeURIComponent(SIGN_IN)}`, { method: 'PUT' });
  console.log(`Chrome is open at the Play Console (port ${PORT}, profile ${PROFILE}).`);
  console.log('Sign in there to the Google account that has the developer account, then: node dev/play-publish.mjs status');
  process.exit(0);
}

async function connect() {
  const pages = (await http('/json/list')).filter((t) => t.type === 'page');
  let tab = pages.find((t) => /play\.google\.com\/console|accounts\.google|google\.play\//.test(t.url));
  if (!tab) tab = await http(`/json/new?${encodeURIComponent(CONSOLE)}`, { method: 'PUT' });
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
  return { call, run };
}

const page = await connect();
await page.call('Page.bringToFront');

/** Goes to an address and waits until the console has drawn something to read. */
async function go(url, what, ready) {
  await page.run((u) => { if (location.href !== u) location.href = u; }, url);
  for (let i = 0; i < 80; i++) {
    await sleep(500);
    const state = { href: await page.run(() => location.href).catch(() => ''), ready: await page.run(ready).catch(() => false) };
    if (state.href && /accounts\.google\.com|\/console\/signup|google\.play\//.test(state.href)) {
      fail(/signup/.test(state.href)
        ? 'the Google account signed in here has no Play developer account: sign in to the one that has (node dev/play-publish.mjs login)'
        : 'not signed in: node dev/play-publish.mjs login, sign in in the Chrome that opens, then run this again');
    }
    if (state.ready) return state.href;
  }
  fail(`the Play Console did not show ${what}: has the console changed?`);
}

/** The developer accounts of the Google account, or the one it went straight to. */
async function developers() {
  const href = await go(CONSOLE, 'the developer accounts', () => /\/developers\/\d+\//.test(location.href) || document.querySelectorAll('[role=option]').length > 0);
  const direct = href.match(/\/developers\/(\d+)\//);
  if (direct) return [{ id: direct[1], name: '' }];
  // The chooser names the accounts; their numbers come with a press on each.
  return page.run(() => [...document.querySelectorAll('[role=option]')].map((o) => ({ id: '', name: o.textContent.trim() })));
}

/** The apps of a developer account: name, the console's number for it, and its state. */
async function apps(developer) {
  await go(`${CONSOLE}/${developer}/app-list`, 'the list of apps', () => document.querySelectorAll('a[href*="/app/"]').length > 0 || /Create app/.test(document.body.innerText));
  await sleep(1500);
  return page.run(() => {
    const seen = new Map();
    for (const a of document.querySelectorAll('a[href*="/app/"]')) {
      const id = (a.getAttribute('href').match(/\/app\/(\d+)\//) || [])[1];
      const row = a.closest('[role=row], tr, li') || a;
      if (id && !seen.has(id)) seen.set(id, row.innerText.replace(/\s+/g, ' ').trim().slice(0, 120));
    }
    return [...seen].map(([id, text]) => ({ id, text }));
  });
}

async function chosenDeveloper() {
  const list = await developers();
  if (list.length === 1 && list[0].id) return list[0].id;
  if (process.env.KEPULI_PLAY_DEVELOPER) return process.env.KEPULI_PLAY_DEVELOPER;
  // One account behind a chooser: its row is pressed to learn its number.
  if (list.length === 1) {
    await page.run(() => document.querySelector('[role=option]').click());
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      const id = (await page.run(() => location.href)).match(/\/developers\/(\d+)\//);
      if (id) return id[1];
    }
  }
  fail(`several developer accounts (${list.map((d) => d.name).join(', ')}): name one by its number in KEPULI_PLAY_DEVELOPER`);
}

const developer = await chosenDeveloper();
const list = await apps(developer);

if (command === 'status') {
  console.log(`signed in; developer account ${developer}`);
  for (const app of list) console.log(`  ${app.id}  ${app.text}`);
  if (!list.length) console.log('  no apps');
  const mine = list.find((app) => app.text.includes(APP));
  console.log(mine ? `"${APP}" is there: upload can go ahead` : `no app named "${APP}" yet: create it in the console (Create app) first`);
  process.exit(0);
}

/* -------------------------------------------------------------- upload */

if (!existsSync(BUNDLE)) fail(`${BUNDLE} is not there: see android/AGENTS.md for making it and copying it into dist/android/`);
const app = list.find((a) => a.text.includes(APP));
if (!app) fail(`no app named "${APP}" in developer account ${developer}: create it in the console first`);

const press = (label) => page.run((text) => {
  const node = [...document.querySelectorAll('button, a[role=button], material-button, [role=button]')]
    .find((b) => b.getClientRects().length && new RegExp(text, 'i').test(b.innerText.trim()) && !b.disabled && b.getAttribute('aria-disabled') !== 'true');
  if (node) node.click();
  return Boolean(node);
}, label);

await go(`${CONSOLE}/${developer}/app/${app.id}/tracks/internal-testing`, 'the internal testing page', () => /Internal testing/.test(document.body.innerText) && document.querySelectorAll('button, material-button').length > 3);
await sleep(1500);
// The television's releases are on a track of their own, chosen from the
// page's list of form factors. Not yet tried against the real page: when
// the choice is not found, the owner makes it in the Chrome and runs this
// again.
if (FORM === 'tv' && !/Android TV/i.test(await page.run(() => document.querySelector('[aria-selected=true], [aria-pressed=true]')?.innerText || ''))) {
  if (!(await press('Android TV'))) fail('no "Android TV" to choose on the internal testing page: add the form factor under Advanced settings, or choose its track in the Chrome and run this again');
  await sleep(2500);
}
if (!(await press('^(Create new release|Edit release)$'))) fail('no "Create new release" on the internal testing page: is a release already being prepared, or has the console changed?');
let field = null;
for (let i = 0; i < 60 && !field; i++) {
  await sleep(500);
  const { result } = await page.call('Runtime.evaluate', { expression: `document.querySelector('input[type=file]')` });
  if (result.objectId) field = result.objectId;
}
if (!field) fail('the release page showed no file field for the bundle');
console.log(`uploading ${BUNDLE} (${Math.round(statSync(BUNDLE).size / 1048576)} MB)…`);
await page.call('DOM.setFileInputFiles', { files: [BUNDLE], objectId: field });

// The page lists the bundle by its version once Play has taken it in and
// looked through it, which for 160 MB is a matter of minutes.
const code = VERSION.split('.').reduce((n, part) => n * 100 + Number(part), 0) + (FORM === 'tv' ? 1000000 : 0);
let shown = '';
for (let i = 0; i < 360; i++) {
  await sleep(5000);
  shown = await page.run(() => document.body.innerText);
  if (new RegExp(`\\b${code}\\b`).test(shown) && /\b(arm64-v8a|API levels|Target SDK)\b/i.test(shown)) break;
  const refused = shown.match(/(Upload failed|couldn.t be (uploaded|processed)|You need to use a different|Version code \d+ has already been used)[^\n]*/i);
  if (refused) fail(`Play refused the bundle: ${refused[0]}`);
  if (i === 359) fail('the bundle did not appear on the release page within half an hour');
}
console.log(`Play has the bundle: version code ${code} (${VERSION}).`);
if (await press('^Save as draft$')) { await sleep(3000); console.log('The release is saved as a draft; nothing is rolled out.'); }
else console.log('No "Save as draft" on the page: the release is open in the Chrome, unsaved. Look at it there.');
console.log('Next, in the console: the release notes, Next, and "Save and publish" to the internal testers.');
process.exit(0);
