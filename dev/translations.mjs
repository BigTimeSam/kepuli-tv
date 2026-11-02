#!/usr/bin/env node
// Whether every translation is of the English as it stands now.
//
//   node dev/translations.mjs                 what is behind, language by language: the
//                                             interface keys whose English changed or that
//                                             are missing, and the store listings whose
//                                             English changed — with the English to work from
//   node dev/translations.mjs --check         the same in one line each; exit 1 if anything is behind
//   node dev/translations.mjs --mark LANG…    LANG has been brought up to date: its keys and
//                                             its listing are recorded against today's
//                                             English. "all" marks every language.
//
// A translation that was right once goes stale without a sign: the English
// is reworded, the other languages still say the old thing, and nothing
// fails — the key is there, its placeholders match. So each language
// records, in store/translations.json, a short hash of the English it was
// translated from: per interface key (the key's plural forms together),
// and per store listing (its three parts together). A key whose English
// hashes differently now is behind; so is a key the language lacks.
//
// The translating itself is done by hand or by an assistant in the
// release session; this only says what needs it, and dev/package.mjs
// refuses to build while anything is behind. After translating, --mark
// the language.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LANGUAGES, DEFAULT_LANGUAGE, keysOf, loadLanguage, setLanguage, t } from '../js/i18n.js';
import { readListings, DEFAULT_LOCALE } from './listings.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const RECORD = join(ROOT, 'store', 'translations.json');
const PLURAL = /\.(zero|one|two|few|many|other)$/;

const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 12);
const base = (key) => key.replace(PLURAL, '');

/** The English of every interface key, plural forms grouped under the key. */
async function english() {
  await loadLanguage(DEFAULT_LANGUAGE);
  setLanguage(DEFAULT_LANGUAGE);
  const out = new Map();
  for (const key of keysOf(DEFAULT_LANGUAGE).sort()) {
    const group = base(key);
    if (!out.has(group)) out.set(group, {});
    out.get(group)[key] = t(key);
  }
  return out;
}

/** The base keys a language has. */
async function keysIn(lang) {
  await loadLanguage(lang);
  return new Set(keysOf(lang).map(base));
}

function listingHash({ name, short, detailed }) { return hash([name, short, detailed]); }

function readRecord() {
  return existsSync(RECORD) ? JSON.parse(readFileSync(RECORD, 'utf8')) : { ui: {}, listing: {} };
}

function writeRecord(record) {
  const sorted = (object) => Object.fromEntries(Object.keys(object).sort().map((k) => [k, object[k]]));
  const out = { ui: sorted(Object.fromEntries(Object.entries(record.ui).map(([lang, keys]) => [lang, sorted(keys)]))), listing: sorted(record.listing) };
  writeFileSync(RECORD, JSON.stringify(out, null, 1) + '\n');
}

/** What is behind: { ui: {lang: {missing, changed}}, listing: [locale] }. */
export async function behind() {
  const record = readRecord();
  const en = await english();
  const ui = {};
  for (const lang of Object.keys(LANGUAGES)) {
    if (lang === DEFAULT_LANGUAGE) continue;
    const has = await keysIn(lang);
    const done = record.ui[lang] || {};
    const missing = [], changed = [], unmarked = [];
    for (const [key, forms] of en) {
      if (!has.has(key)) missing.push(key);
      else if (!done[key]) unmarked.push(key);
      else if (done[key] !== hash(forms)) changed.push(key);
    }
    if (missing.length || changed.length || unmarked.length) ui[lang] = { missing, changed, unmarked };
  }
  const listings = readListings();
  const source = listings.find((l) => l.locale === DEFAULT_LOCALE);
  const listing = listings
    .filter((l) => l.locale !== DEFAULT_LOCALE && record.listing[l.locale] !== listingHash(source))
    .map((l) => l.locale);
  return { ui, listing, en, source };
}

/** Records LANGS as translated from today's English. */
export async function mark(langs) {
  const record = readRecord();
  const en = await english();
  const all = langs.includes('all');
  const uiLangs = Object.keys(LANGUAGES).filter((l) => l !== DEFAULT_LANGUAGE && (all || langs.includes(l)));
  for (const lang of uiLangs) {
    const has = await keysIn(lang);
    record.ui[lang] = Object.fromEntries([...en].filter(([key]) => has.has(key)).map(([key, forms]) => [key, hash(forms)]));
  }
  const listings = readListings();
  const source = listingHash(listings.find((l) => l.locale === DEFAULT_LOCALE));
  // A listing's file name is the Chrome Web Store's code (pt_BR, no); the
  // interface's is the app's (pt, nb). Either marks it.
  const ALIAS = { pt: 'pt_BR', nb: 'no' };
  const marked = [];
  for (const l of listings) {
    if (l.locale === DEFAULT_LOCALE) continue;
    if (all || langs.includes(l.locale) || langs.some((lang) => ALIAS[lang] === l.locale)) { record.listing[l.locale] = source; marked.push(l.locale); }
  }
  writeRecord(record);
  return { ui: uiLangs, listing: marked };
}

/** One line per language that is behind, for dev/package.mjs and --check. */
export async function problems() {
  const { ui, listing } = await behind();
  const out = Object.entries(ui).map(([lang, { missing, changed, unmarked }]) =>
    `${lang}: ${[missing.length && `${missing.length} keys missing`, changed.length && `${changed.length} keys whose English changed`,
      unmarked.length && `${unmarked.length} new keys translated but not marked`].filter(Boolean).join(', ')}`);
  for (const locale of listing) out.push(`store/listings/${locale}.txt: the English listing changed since it was translated`);
  return out.length ? [...out, 'translate them, then node dev/translations.mjs --mark <language>'] : [];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args[0] === '--mark') {
    if (args.length < 2) { console.error('--mark needs the languages, or all'); process.exit(1); }
    const done = await mark(args.slice(1));
    console.log(`marked up to date: interface ${done.ui.join(' ') || 'none'}; listings ${done.listing.join(' ') || 'none'}`);
  } else if (args[0] === '--check') {
    const list = await problems();
    if (list.length) { console.error(list.join('\n')); process.exit(1); }
    console.log('every translation is of the English as it stands');
  } else {
    const { ui, listing, en, source } = await behind();
    for (const [lang, { missing, changed, unmarked }] of Object.entries(ui)) {
      console.log(`\n## ${lang} (${LANGUAGES[lang]}): ${missing.length} missing, ${changed.length} changed, ${unmarked.length} new and unmarked`);
      for (const key of [...missing, ...changed, ...unmarked]) {
        const sign = missing.includes(key) ? '+' : changed.includes(key) ? '~' : '?';
        for (const [form, text] of Object.entries(en.get(key))) console.log(`${sign} ${form}: ${JSON.stringify(text)}`);
      }
    }
    if (listing.length) {
      console.log(`\n## store listings behind the English: ${listing.join(' ')}`);
      console.log(`   source: store/listings/${DEFAULT_LOCALE}.txt (${[...source.detailed].length} characters); see git log -p on it for what changed`);
    }
    if (!Object.keys(ui).length && !listing.length) console.log('every translation is of the English as it stands');
  }
}
