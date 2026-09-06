// Language codes and the names shown for them.
//
// Matroska marks a track's language either with ISO 639-2 (Language) or
// with BCP 47 (LanguageBCP47), and both occur in files from the same
// library — otherwise the same language would show up twice ("fin" and
// "fi"). Everything on screen goes through the short form, and the region
// part is dropped.
//
// The name is resolved in the interface language, so that a Finnish reader
// sees "englanti" where an English one sees "English". Both track
// selectors — subtitles (subs.js) and audio (audio.js) — name their tracks
// the same way, so what they share sits here rather than in either of
// them.

import { localeTag, t } from './i18n.js';
import { nf } from './format.js';

const ISO3 = {
  fin: 'fi', swe: 'sv', nor: 'no', nob: 'no', nno: 'no', dan: 'da', isl: 'is',
  eng: 'en', ger: 'de', deu: 'de', fre: 'fr', fra: 'fr', spa: 'es', ita: 'it',
  dut: 'nl', nld: 'nl', por: 'pt', rus: 'ru', pol: 'pl', cze: 'cs', ces: 'cs',
  hun: 'hu', rum: 'ro', ron: 'ro', gre: 'el', ell: 'el', tur: 'tr', ara: 'ar',
  heb: 'he', hin: 'hi', jpn: 'ja', kor: 'ko', chi: 'zh', zho: 'zh', tha: 'th',
  vie: 'vi', ind: 'id', may: 'ms', msa: 'ms', ukr: 'uk', hrv: 'hr', srp: 'sr',
  slo: 'sk', slk: 'sk', slv: 'sl', bul: 'bg', est: 'et', lav: 'lv', lit: 'lt',
  cat: 'ca', baq: 'eu', eus: 'eu', glg: 'gl', fil: 'fil', und: 'und',
};

export function shortLanguage(code) {
  const base = String(code || 'und').toLowerCase().split('-')[0];
  return ISO3[base] || base;
}

/**
 * A track's language as the file gives it. Matroska gives the Language
 * element the default value "eng", so a track that names no language at
 * all is English rather than unknown — that is how ffmpeg and the desktop
 * players read such a file, and reading it as unknown put an English
 * subtitle track in the selector under "Unknown language". Only an
 * explicit "und" is unknown.
 */
export const trackLanguage = (track) => (track.langBcp || track.lang || 'eng').toLowerCase();

// Rebuilt per tag: the interface language can change mid-session, and a
// language name belongs in the language the viewer reads.
let namesTag = null;
let namesInstance = null;
function displayNames() {
  if (namesTag !== localeTag()) {
    namesTag = localeTag();
    try { namesInstance = new Intl.DisplayNames([namesTag], { type: 'language' }); } catch { namesInstance = null; }
  }
  return namesInstance;
}

/** "Finnish" for 'fi', or null when the name is not known. */
export function languageName(code) {
  if (!code || code === 'und') return null;
  try {
    const names = displayNames();
    const name = names && names.of(code);
    return name && name !== code ? name : null;
  } catch { return null; }
}

/** The name for a selector: "Finnish", or "SV" when there is no name. */
export function languageLabel(code) {
  const name = languageName(code);
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : String(code).toUpperCase();
}

/**
 * Full names for a compact summary: English, Finnish, then local
 * alphabetic order, and last the tracks whose language the file states as
 * unknown. The unknown one is named rather than dropped, so that the
 * summary holds every language the selector offers.
 */
export function orderedLanguageNames(codes) {
  const priority = code => code === 'en' ? 0 : code === 'fi' ? 1 : code === 'und' ? 3 : 2;
  return [...new Set(codes.map(shortLanguage))]
    .map(code => ({ code, name: code === 'und' ? t('subs.unknown') : languageLabel(code) }))
    .sort((a, b) => priority(a.code) - priority(b.code) || a.name.localeCompare(b.name, localeTag()))
    .map(entry => entry.name);
}

// Three names fit the line the details give them; the rest are a number.
const SUMMARY_NAMES = 3;

/**
 * The languages on one line: "English, Finnish, Danish + 2". The number of
 * tracks used to stand in front of the names, but a file holds more tracks
 * than languages — two Finnish tracks are one language — and the two
 * counts next to each other only invited the reader to check a subtraction
 * that was never meant to add up.
 */
export function languageSummary(codes) {
  const names = orderedLanguageNames(codes);
  const rest = names.length - SUMMARY_NAMES;
  const head = names.slice(0, SUMMARY_NAMES).join(', ');
  return rest > 0 ? `${head} + ${nf.format(rest)}` : head;
}

// The names of one language in the tags a track's own name might be
// written in. Kept per tag: building an Intl.DisplayNames is not free and
// a selector asks this once per track.
const instances = new Map();
function namesIn(tag) {
  if (!instances.has(tag)) {
    try { instances.set(tag, new Intl.DisplayNames([tag], { type: 'language' })); } catch { instances.set(tag, null); }
  }
  return instances.get(tag);
}

/**
 * Whether a track's own name only repeats its language. Muxers write the
 * language into the name in whichever language they please — a Finnish
 * track named "Suomi", an English one named "English" — and against a
 * label that already says "Finnish" that is noise. Asked in the interface
 * language, in the track's own language and in English.
 */
export function isLanguageName(name, code) {
  if (!name || !code || code === 'und') return false;
  const trimmed = String(name).trim().toLowerCase();
  for (const tag of [localeTag(), code, 'en']) {
    const names = namesIn(tag);
    let written = null;
    try { written = names && names.of(code); } catch { written = null; }
    if (written && written.trim().toLowerCase() === trimmed) return true;
  }
  return false;
}

// A track's own name is free text and can be a sentence. In a selector it
// has to stay a label.
const MAX_NAME = 26;

export const shorten = (text) => {
  const trimmed = String(text).trim();
  return trimmed.length > MAX_NAME ? `${trimmed.slice(0, MAX_NAME - 1)}…` : trimmed;
};

/** Whether a track's own name only repeats what the language already says. */
export const sameish = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
