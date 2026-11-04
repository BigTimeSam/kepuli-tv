#!/usr/bin/env node
// The product's core words, said the same way everywhere in each language.
//
//   node dev/glossarycheck.mjs            check every interface key and store listing; exit 1 on a miss
//   node dev/glossarycheck.mjs --survey   per concept and language: how many texts hold the term,
//                                         and every one that does not (to choose forms or fix texts)
//
// store/i18n-glossary.json lists the concepts a user meets everywhere
// (programme guide, favourites, recording, catch-up, channel, account…):
// the English term, a pattern that finds it in English, and for each of
// the other languages the term its translations use and the forms that
// count as it (a stem, or a few inflected forms, compared without regard to
// case). For every interface key whose English holds a concept, the same
// key in each language must hold one of that language's forms; the same for
// each part of every store listing.
//
// Why: the translations were made in batches by several hands, and a
// concept drifted. When the glossary was first written (2026-11-04),
// Russian called the guide "телегид" on the button and "программа передач"
// in the guide address field, Serbian a playlist "plejlista" in most places
// and "lista" in the setup form, Slovene and Latvian store texts "seznam" and
// "saraksts" where the player says "seznam predvajanja" and "atskaņošanas
// saraksts", and ten store texts described catch-up in words while the
// player's button says "Catch-up". A reader who learns the word on a button
// must find the same word in the settings, the help and the store text.
// translations.mjs says whether a translation is of the current English;
// this says whether it uses the language's own word for the thing.
//
// A key may leave the term out where the language says it another way and
// nothing is lost (a pronoun, a verb that carries it): such keys are listed
// per language under the concept's "except", each with its reason. Keep that
// list short; most misses are better fixed in the text.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { LANGUAGES, DEFAULT_LANGUAGE, keysOf, loadLanguage, setLanguage, t } from '../js/i18n.js';
import { readListings, DEFAULT_LOCALE } from './listings.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const GLOSSARY = join(ROOT, 'store', 'i18n-glossary.json');

// The store listings are named by the Chrome Web Store's locale codes; the
// glossary by the interface's, plus Portugal's Portuguese, which only the
// stores have.
const LISTING_LANG = { no: 'nb', pt_BR: 'pt', pt_PT: 'pt_PT' };
const PARTS = ['name', 'short', 'detailed'];

// Turkish capital İ lowercases to i and a combining dot; the dot is dropped
// so that "İzlemeye" holds the form "izlemeye".
const fold = (text) => String(text).normalize('NFC').toLowerCase().replace(/i\u0307/g, 'i');

export function readGlossary(file = GLOSSARY) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** Whether a text says a language's term for a concept. */
export function holds(text, entry) {
  const folded = fold(text);
  return entry.forms.some((form) => folded.includes(fold(form)));
}

/** The texts to compare: { lang: Map(id → text) }, interface keys and listing parts. */
async function texts() {
  const out = {};
  for (const lang of Object.keys(LANGUAGES)) {
    await loadLanguage(lang);
    setLanguage(lang);
    // Only the keys the language has: a missing key falls back to English,
    // and that is translations.mjs's business, not a wrong word.
    const own = new Set(keysOf(lang));
    out[lang] = new Map(keysOf(DEFAULT_LANGUAGE).filter((key) => own.has(key)).map((key) => [key, t(key)]));
  }
  setLanguage(DEFAULT_LANGUAGE);
  for (const listing of readListings()) {
    const lang = listing.locale === DEFAULT_LOCALE ? DEFAULT_LANGUAGE : (LISTING_LANG[listing.locale] || listing.locale);
    out[lang] ||= new Map();
    for (const part of PARTS) out[lang].set(`listing:${listing.locale}:${part}`, listing[part]);
  }
  return out;
}

/** The English text an id stands for. */
function englishOf(all, id) {
  if (!id.startsWith('listing:')) return all[DEFAULT_LANGUAGE].get(id);
  return all[DEFAULT_LANGUAGE].get(`listing:${DEFAULT_LOCALE}:${id.split(':')[2]}`);
}

/**
 * Every miss: { concept, lang, id, english, text }. A language without an
 * entry for a concept is itself a miss (the glossary must cover all).
 */
export async function misses(glossary = readGlossary()) {
  const all = await texts();
  const out = [];
  const survey = [];
  for (const [concept, spec] of Object.entries(glossary.concepts)) {
    const pattern = new RegExp(spec.match, 'iu');
    for (const [lang, map] of Object.entries(all)) {
      if (lang === DEFAULT_LANGUAGE) continue;
      const entry = spec.terms[lang];
      if (!entry) { out.push({ concept, lang, id: '(glossary)', english: spec.en, text: 'no term for this language' }); continue; }
      const except = spec.except?.[lang] || {};
      let found = 0, held = 0;
      for (const [id, text] of map) {
        const english = englishOf(all, id);
        // A placeholder is not the word: "Watch {channel} now" names the
        // channel, and the translation rightly says only the name.
        if (english == null || !pattern.test(english.replace(/\{\w+\}/g, ''))) continue;
        found++;
        if (holds(text, entry) || Object.hasOwn(except, id)) { held++; continue; }
        out.push({ concept, lang, id, english, text });
      }
      survey.push({ concept, lang, found, held });
    }
  }
  return { misses: out, survey };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const glossary = readGlossary();
  const { misses: list, survey } = await misses(glossary);
  if (process.argv.includes('--survey')) {
    for (const row of survey) console.log(`${row.concept.padEnd(18)} ${row.lang.padEnd(6)} ${row.held}/${row.found}  (${glossary.concepts[row.concept].terms[row.lang]?.term ?? '?'})`);
  }
  const short = (text) => (text.length > 160 ? `${text.slice(0, 157)}…` : text);
  for (const m of list) {
    const term = glossary.concepts[m.concept].terms[m.lang]?.term;
    console.error(`${m.lang} ${m.id}: "${m.concept}" should be "${term}"\n    en: ${short(m.english)}\n    ${m.lang}: ${short(m.text)}`);
  }
  const count = Object.keys(glossary.concepts).length;
  if (list.length) {
    console.error(`FAIL  ${list.length} texts miss their language's term (of ${count} concepts); fix the text, or add the form or an exception to store/i18n-glossary.json`);
    process.exit(1);
  }
  console.log(`PASS  ${count} concepts said with each language's own term in every key and listing`);
}
