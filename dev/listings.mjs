#!/usr/bin/env node
// The store listings in every language, and the manifest texts made from them.
//
//   node dev/listings.mjs           check every listing, write _locales/ and
//                                   dist/listings/<locale>.txt to paste from
//   node dev/listings.mjs --check   check only; exit 1 if _locales/ is out of date
//
// store/listings/<locale>.txt holds one language's listing in three parts:
// the name, the short description and the detailed description. The first
// two are what both stores show as the title and the summary, and neither
// store lets them be typed into its form: they are read from the manifest,
// in the language of the reader, out of _locales/<locale>/messages.json.
// So that file is written from the listing, never by hand.
//
// The file names are the Chrome Web Store's locale codes (pt_BR, and "no"
// for Norwegian). Firefox calls Norwegian Bokmål nb_NO and would not find
// "no" — the Firefox package gets it under that name (dev/package.mjs).
//
// The checks are the Chrome Web Store's, which rejected the first
// submission for its keyword policy (see store-listing.txt): the name at
// most 45 characters (shown in full on the store's tiles; the hard limit is
// 75), the short description at most 132, the detailed one at most 16,000,
// and no word that means something five times or more in the three
// together. "Means something" is read as five letters or more, or a run of
// capitals like IPTV and MKV: the short words of a language are its
// grammar, and they repeat in any text.

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LISTINGS = join(ROOT, 'store', 'listings');
const LOCALES = join(ROOT, '_locales');
export const DEFAULT_LOCALE = 'en';
// Languages the Chrome Web Store has no locale code for: their listing is
// Firefox's alone, and the Chrome package leaves their _locales/ out.
export const CHROME_UNSUPPORTED = ['sq'];

const LIMITS = { name: 45, short: 132, detailed: 16000 };
const MAX_REPEAT = 4;
const PARTS = { 'NAME': 'name', 'SHORT DESCRIPTION': 'short', 'DETAILED DESCRIPTION': 'detailed' };

/** One listing file in its three parts. */
export function parseListing(text) {
  const out = {};
  let part = null;
  for (const line of text.split('\n')) {
    const marker = /^=== (.+) ===$/.exec(line);
    if (marker) { part = PARTS[marker[1]]; if (!part) throw new Error(`unknown part ${marker[1]}`); out[part] = []; continue; }
    if (part) out[part].push(line);
  }
  for (const key of Object.values(PARTS)) {
    if (!out[key]) throw new Error(`the part ${key} is missing`);
    out[key] = out[key].join('\n').trim();
  }
  return out;
}

/** The words that come back too often, with their counts. */
export function repeats(text) {
  const counts = new Map();
  for (const word of text.match(/[\p{L}\p{N}]+/gu) || []) {
    const meaningful = word.length >= 5 || (word.length >= 3 && word === word.toUpperCase() && /\p{L}/u.test(word));
    if (!meaningful) continue;
    const key = word.toLowerCase();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts].filter(([, n]) => n > MAX_REPEAT).sort((a, b) => b[1] - a[1]);
}

// The name is the brand and what it is: "Kepuli-TV", the same in every
// language — a brand is not translated — and then "IPTV player" in the
// listing's own language, which is what a store's search in that language
// is typed as ("Kepuli-TV – IPTV-soitin", "Kepuli-TV – Lecteur IPTV").
// The word IPTV stays in every one, so that an English search finds it too.
export const BRAND = 'Kepuli-TV – ';

export function checkListing(listing) {
  const problems = [];
  if (!listing.name.startsWith(BRAND) || !listing.name.includes('IPTV')) {
    problems.push(`the name is "${listing.name}"; it starts "${BRAND}" and says IPTV in every language`);
  }
  for (const [part, limit] of Object.entries(LIMITS)) {
    const length = [...listing[part]].length;
    if (length > limit) problems.push(`${part} is ${length} characters, the limit is ${limit}`);
  }
  if (listing.short.includes('\n')) problems.push('the short description must be one line');
  const again = repeats([listing.name, listing.short, listing.detailed].join('\n'));
  if (again.length) problems.push(`words used ${MAX_REPEAT + 1} times or more: ${again.map(([w, n]) => `${w} ×${n}`).join(', ')}`);
  return problems;
}

export function readListings() {
  return readdirSync(LISTINGS).filter((f) => f.endsWith('.txt')).sort()
    .map((f) => ({ locale: f.slice(0, -4), ...parseListing(readFileSync(join(LISTINGS, f), 'utf8')) }));
}

/**
 * The detailed description as the store's field wants it. The source is
 * wrapped at 78 columns to be read and diffed, but both stores keep every
 * line break they are given, so a paragraph pasted as it stands shows up
 * ragged. Here a paragraph is one line again; a bullet (•, →, -) starts a
 * line of its own, and its indented continuation joins it. The two empty
 * lines the source puts before a section are one in the store, where the
 * heading in capitals marks the section well enough.
 */
export function unwrap(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const starts = /^(?:[•→]|- )/.test(line) || /^[\p{Lu}\d ,.'’&-]+$/u.test(line.trim());
    const previous = out[out.length - 1];
    if (!line.trim() || !previous || !previous.trim() || starts || /^[\p{Lu}\d ,.'’&-]+$/u.test(previous.trim())) out.push(line.trim() ? line.replace(/^ {2}/, '') : '');
    else out[out.length - 1] = `${previous} ${line.trim()}`;
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

/**
 * The detailed description for the Chrome Web Store: without its last
 * section, the link to the video tour. The store shows the video itself at
 * the top of the page, from the promo video field; AMO has no such field,
 * so its description keeps the link. The section is the last of the
 * sections the source parts with two empty lines, and is dropped only when
 * it holds the link.
 */
export function forChrome(detailed) {
  const sections = detailed.split('\n\n\n');
  return sections.length > 1 && /youtu\.?be/.test(sections[sections.length - 1]) ? sections.slice(0, -1).join('\n\n\n').trimEnd() : detailed;
}

/** One listing as it is pasted into the stores' forms. */
export function pasteable({ name, short, detailed }) {
  return `NAME (Chrome and AMO: from the manifest, nothing to paste)\n${name}\n\n`
    + `SHORT DESCRIPTION (Chrome: from the manifest; AMO: the Summary field)\n${short}\n\n`
    + `DETAILED DESCRIPTION (AMO: Description)\n${unwrap(detailed)}\n\n`
    + `DETAILED DESCRIPTION (Chrome: Description, without the video section)\n${unwrap(forChrome(detailed))}\n`;
}

/** What _locales/<locale>/messages.json holds for one listing. */
export function messages({ name, short }) {
  return JSON.stringify({
    appName: { message: name, description: 'The extension\'s name in the store and the browser. Written from store/listings/ by dev/listings.mjs.' },
    appDesc: { message: short, description: 'The short description. Written from store/listings/ by dev/listings.mjs.' },
  }, null, 2) + '\n';
}

/** Every listing checked, and _locales/ compared with what they make. */
export function check() {
  const problems = [];
  const listings = readListings();
  if (!listings.some((l) => l.locale === DEFAULT_LOCALE)) problems.push(`store/listings/${DEFAULT_LOCALE}.txt is missing`);
  for (const listing of listings) {
    for (const problem of checkListing(listing)) problems.push(`${listing.locale}: ${problem}`);
    const path = join(LOCALES, listing.locale, 'messages.json');
    if (!existsSync(path) || readFileSync(path, 'utf8') !== messages(listing)) problems.push(`${listing.locale}: _locales is out of date; run node dev/listings.mjs`);
  }
  if (existsSync(LOCALES)) {
    for (const locale of readdirSync(LOCALES)) {
      if (!listings.some((l) => l.locale === locale)) problems.push(`_locales/${locale} has no listing in store/listings/`);
    }
  }
  return problems;
}

export function write() {
  const listings = readListings();
  const paste = join(ROOT, 'dist', 'listings');
  rmSync(LOCALES, { recursive: true, force: true });
  rmSync(paste, { recursive: true, force: true });
  mkdirSync(paste, { recursive: true });
  for (const listing of listings) {
    mkdirSync(join(LOCALES, listing.locale), { recursive: true });
    writeFileSync(join(LOCALES, listing.locale, 'messages.json'), messages(listing));
    writeFileSync(join(paste, `${listing.locale}.txt`), pasteable(listing));
  }
  return listings;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv.includes('--check')) {
    const listings = write();
    for (const l of listings) {
      console.log(`${l.locale.padEnd(6)} name ${String([...l.name].length).padStart(2)}  short ${String([...l.short].length).padStart(3)}  detailed ${String([...l.detailed].length).padStart(5)}`);
    }
  }
  const problems = check();
  if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
  console.log('the listings and _locales/ agree, within the store\'s limits');
}
