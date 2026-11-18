#!/usr/bin/env node
// Whether what the project pins by hand is still what its makers last
// released.
//
// Dependabot keeps the GitHub Actions and the Gradle dependencies in step
// (.github/dependabot.yml), and android/enginecheck.mjs the Android apps'
// engine. What is left has no package manager to ask: the libraries in
// vendor/ are files dropped in whole, the audio decoder is built from a
// tag of FFmpeg, the iPhone and iPad app fetches Google's Cast SDK by its
// version, and the CI installs one build of Chrome. Each is pinned on
// purpose (a build must not change under a commit, and AMO compares
// vendor/ with the release it claims to be), so nothing said when one fell
// behind: on 2026-11-18 hls.js was seventeen months old and FFmpeg four
// fix releases back, and the libraries and the decoder read a provider's
// streams.
//
//   node dev/freshcheck.mjs          every pin against its maker's latest
//
// A newer release is said at once. For what reads a provider's data (the
// vendored players, FFmpeg, the Cast SDK) it fails once that release has
// been out for GRACE_DAYS, where its date can be asked; taking it is a
// commit of its own (vendor/AGENTS.md, ios/AGENTS.md). The test browser
// and its installer are only said: an old one tests no worse. The nightly
// CI run asks; a push does not, so that a commit about something else is
// not red for somebody's calendar. A maker's server that does not answer
// is skipped, not failed.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GRACE_DAYS = 45;
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

/** Two dotted versions compared number by number: negative when a is the older. */
export function compare(a, b) {
  const x = String(a).split(/[.-]/).map(Number), y = String(b).split(/[.-]/).map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
}

/**
 * What to say of one pin: `behind` when the maker has a newer release, and
 * `late` when that must be taken (`must`) and has been out longer than the
 * grace. A release whose date is not known is never late.
 * @param {{ pinned: string, latest: string, released?: number|null, must: boolean }} pin
 */
export function verdict({ pinned, latest, released = null, must }, now, graceDays = GRACE_DAYS) {
  const behind = compare(pinned, latest) < 0;
  const days = released ? Math.floor((now - released) / 86400000) : null;
  return { behind, late: Boolean(behind && must && days !== null && days >= graceDays), days };
}

const json = async (url, headers = {}) => {
  // GitHub answers an unnamed asker sixty times an hour; the CI has a token.
  const token = process.env.GITHUB_TOKEN && url.startsWith('https://api.github.com/') ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {};
  const res = await fetch(url, { headers: { 'User-Agent': 'freshcheck', ...token, ...headers }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};
const npm = async (name) => { const all = await json(`https://registry.npmjs.org/${name}`); const latest = all['dist-tags'].latest; return { latest, released: Date.parse(all.time[latest]) }; };
const vendored = (file) => new RegExp(`^\\S+\\s+${file.replace('.', '\\.')}\\s+\\S+ (\\S+)$`, 'm').exec(read('vendor/CHECKSUMS'))?.[1];

// name, where the pin is, how to read it, how to ask its maker, and
// whether a newer one must be taken.
const PINS = [
  { name: 'hls.js', where: 'vendor/hls.js', must: true, pinned: () => vendored('hls.js'), ask: () => npm('hls.js') },
  { name: 'mpegts.js', where: 'vendor/mpegts.js', must: true, pinned: () => vendored('mpegts.js'), ask: () => npm('mpegts.js') },
  {
    name: 'FFmpeg', where: 'dev/wasm/build.sh (vendor/ffaudio)', must: true,
    pinned: () => /\bn(\d+\.\d+(?:\.\d+)?)\b/.exec(read('dev/wasm/build.sh'))?.[1],
    // The fixes of the release line the decoder is built from: a new
    // major is a port, not an update.
    ask: async (pinned) => {
      const line = pinned.split('.').slice(0, 2).join('.');
      const tags = await json('https://api.github.com/repos/FFmpeg/FFmpeg/tags?per_page=100', { Accept: 'application/vnd.github+json' });
      const latest = tags.map((t) => /^n(\d+\.\d+(?:\.\d+)?)$/.exec(t.name)?.[1]).filter((v) => v && (v === line || v.startsWith(`${line}.`))).sort(compare).at(-1);
      const tag = tags.find((t) => t.name === `n${latest}`);
      const commit = tag && await json(tag.commit.url, { Accept: 'application/vnd.github+json' }).catch(() => null);
      return { latest, released: commit ? Date.parse(commit.commit.committer.date) : null };
    },
  },
  {
    name: 'Google Cast SDK for iOS', where: 'ios/vendor.mjs', must: true,
    pinned: () => /export const VERSION = '([\d.]+)'/.exec(read('ios/vendor.mjs'))?.[1],
    ask: async () => { const pod = await json('https://trunk.cocoapods.org/api/v1/pods/google-cast-sdk'); const last = pod.versions.sort((a, b) => compare(a.name, b.name)).at(-1); return { latest: last.name, released: Date.parse(last.created_at) }; },
  },
  {
    name: 'Chrome for Testing', where: '.github/workflows/checks.yml', must: false,
    pinned: () => /install chrome@([\d.]+)/.exec(read('.github/workflows/checks.yml'))?.[1],
    ask: async () => ({ latest: (await json('https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions.json')).channels.Stable.version, released: null }),
  },
  {
    name: '@puppeteer/browsers', where: '.github/workflows/checks.yml', must: false,
    pinned: () => /@puppeteer\/browsers@([\d.]+)/.exec(read('.github/workflows/checks.yml'))?.[1],
    ask: () => npm('@puppeteer/browsers'),
  },
];

if (import.meta.url === `file://${process.argv[1]}`) {
  let late = 0;
  for (const pin of PINS) {
    const pinned = pin.pinned();
    if (!pinned) { console.error(`FAIL  ${pin.name}: no version found in ${pin.where}`); late++; continue; }
    let asked;
    try { asked = await pin.ask(pinned); } catch (err) { console.log(`skip  ${pin.name} ${pinned}: its maker did not answer (${err.message})`); continue; }
    const { behind, late: must, days } = verdict({ pinned, ...asked, must: pin.must }, Date.now());
    const age = days === null ? '' : `, out for ${days} day(s)`;
    if (!behind) console.log(`PASS  ${pin.name} ${pinned} is the latest`);
    else if (must) { console.error(`FAIL  ${pin.name} ${pinned} in ${pin.where}: ${asked.latest} is the latest${age}; take it`); late++; }
    else console.log(`note  ${pin.name} ${pinned} in ${pin.where}: ${asked.latest} is the latest${age}`);
  }
  process.exit(late ? 1 : 0);
}
