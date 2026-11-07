// @ts-check
// What a film's or a series' name and the list around it say beyond the
// name itself: the year a title repeats, which of two copies of one film is
// which, the other parts of the same series of films, and what the provider
// added lately. Pure functions over catalogue items, for the covers
// (js/rows.js, js/coversui.js), the player's title (js/playing.js) and the
// details strip (js/infostrip.js); dev/unitcheck.mjs tests them.

import { searchKey } from './name.js';

// A year at the end of a name, as providers write it: "Lakana - 2022",
// "Iron Tide (2009)", "Planet Arctic 2019".
const TRAILING_YEAR = /\s*(?:[-–—:|]\s*|\(\s*|\[\s*)?((?:19|20)\d{2})\s*[)\]]?\s*$/;

/**
 * The name without the year at its end, when that is the item's own year:
 * the year has a place of its own beside it, and a title shown twice as
 * long as it needs to be loses its end to an ellipsis first.
 */
export function titleWithoutYear(name, year) {
  const text = String(name ?? '');
  const match = text.match(TRAILING_YEAR);
  if (!match || (year && Number(match[1]) !== Number(year))) return text;
  const rest = text.slice(0, match.index).trim();
  return rest || text;
}

/**
 * Whether a name says its year already ("Iron Tide (2009)", "2009: Lost
 * Memories"): the facts beside it then leave the year out, rather than
 * reading "Iron Tide (2009)" and "2009" again. A year inside a longer
 * number is not one.
 */
export function nameHasYear(name, year) {
  const value = Number(year);
  if (!Number.isInteger(value) || value < 1000) return false;
  return new RegExp(`(?:^|\\D)${value}(?:\\D|$)`).test(String(name ?? ''));
}

// Words in a name that say which copy of a film this is.
const QUALITY = /\b(4k|uhd|2160p|fhd|1080p|hd|720p|sd|hdr10\+?|hdr|dolby ?vision|dv|3d|imax|multi[- ]?sub(?:s)?|multi[- ]?audio|dubbed|sub(?:bed)?)\b/gi;

/**
 * What a name says about the copy: its bracketed tags and its quality
 * words, as written ("4K", "Multi-Sub"), without the year.
 */
export function nameTags(name) {
  const text = String(name ?? '');
  const tags = [];
  for (const [, inner] of text.matchAll(/[[(]([^\])]+)[\])]/g)) {
    const tag = inner.trim();
    if (tag && !/^(?:19|20)\d{2}$/.test(tag)) tags.push(tag);
  }
  const outside = text.replace(/[[(][^\])]*[\])]/g, ' ');
  for (const [word] of outside.matchAll(QUALITY)) tags.push(word.toUpperCase().replace(/\s+/g, ' '));
  const seen = new Set();
  return tags.filter((tag) => {
    const key = tag.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The title alone, for telling copies of one film apart from different films. */
function titleKey(item) {
  const bare = titleWithoutYear(String(item.n ?? '').replace(/[[(][^\])]*[\])]/g, ' ').replace(QUALITY, ' '), item.year);
  return `${item.k}|${searchKey(bare).replace(/\s+/g, ' ').trim()}|${item.year || ''}`;
}

/**
 * One copy of each title, the first: a provider files the same film under
 * each language it has (Movies: Spanish, Movies: Arabic…) and sometimes
 * twice under one, and a list of 57,000 showed it six times over, told
 * apart by "Version 1, 2, 3". The copies are the film's own page's
 * business (relatedTitles, versionLabels).
 * @template T
 * @param {T[]} items
 * @returns {T[]}
 */
export function oneCopyEach(items) {
  const seen = new Set();
  return items.filter((item) => {
    const it = /** @type {any} */ (item);
    if (it.k !== 1 && it.k !== 2) return true;
    const key = titleKey(it);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Which copy each one is, for the titles a list holds more than once:
 * a map from `${k}:${id}` to the labels that tell it from the others —
 * where it is filed (placeOf: "Spanish", "Thriller"), the name's tags and
 * the file's format, those of them that differ. A copy that nothing tells
 * apart has none.
 * @param {any[]} items
 * @param {(item: any) => string} [placeOf]
 */
export function versionLabels(items, placeOf = () => '') {
  const groups = new Map();
  for (const item of items) {
    if (item.k !== 1 && item.k !== 2) continue;
    const key = titleKey(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const labels = new Map();
  for (const copies of groups.values()) {
    if (copies.length < 2) continue;
    const features = copies.map((item) => [placeOf(item), ...nameTags(item.n), ...(item.k === 1 && item.ext ? [String(item.ext).toUpperCase()] : [])].filter(Boolean));
    // A feature every copy shares tells none of them apart.
    const count = new Map();
    for (const list of features) for (const f of new Set(list)) count.set(f, (count.get(f) || 0) + 1);
    copies.forEach((item, i) => {
      const own = features[i].filter((f) => count.get(f) < copies.length);
      if (own.length) labels.set(`${item.k}:${item.id}`, own);
    });
  }
  return labels;
}

/**
 * The part of a title that a series of films shares: "Luottomies-elokuva:
 * All in" and "Luottomies-elokuva: Lepoloma" are both "luottomies
 * elokuva"; "Iron Tide 2" is "iron tide". Null for a title with no such
 * part, which then belongs to no series.
 */
export function franchiseKey(name, year) {
  let text = titleWithoutYear(String(name ?? '').replace(/[[(][^\])]*[\])]/g, ' ').replace(QUALITY, ' '), year).trim();
  const cut = text.search(/\s*[:–—]\s+|\s+-\s+/);
  if (cut > 0) text = text.slice(0, cut);
  else {
    // A sequel's number: "Iron Tide 2", "Iron Tide II". A first part has none.
    const numbered = text.match(/^(.*\S)\s+(?:\d{1,2}|ii|iii|iv|v|vi)$/i);
    if (numbered) text = numbered[1];
  }
  const key = searchKey(text).replace(/\s+/g, ' ').trim();
  // A word or two of four letters is too common to make a series ("The",
  // "Love"): such titles are left alone.
  return key.replace(/\s/g, '').length >= 5 ? key : null;
}

/**
 * The other copies of this title and the other parts of its series, from
 * the items at hand (the list on screen, or the whole catalogue when it is
 * loaded), each list in order of year and then name, without the item
 * itself. Parts are at most `limit`.
 */
export function relatedTitles(item, items, { limit = 12 } = {}) {
  const own = titleKey(item);
  const series = franchiseKey(item.n, item.year);
  const versions = [];
  const parts = [];
  const seenParts = new Set();
  for (const other of items) {
    if (other === item || other.k !== item.k || String(other.id) === String(item.id)) continue;
    const key = titleKey(other);
    if (key === own) versions.push(other);
    else if (series && franchiseKey(other.n, other.year) === series && !seenParts.has(key)) {
      // One copy of each other part: the versions of a part are its own page's business.
      seenParts.add(key);
      parts.push(other);
    }
  }
  const order = (a, b) => (Number(a.year) || 0) - (Number(b.year) || 0) || String(a.n).localeCompare(String(b.n));
  return { versions: versions.sort(order), parts: parts.sort(order).slice(0, limit) };
}

/** Days for which a title the provider added still counts as new. */
export const NEW_DAYS = 14;

/** Whether the provider added the item within the last NEW_DAYS. */
export function isNew(item, now = Date.now()) {
  const added = Number(item.added) || 0;
  return added > 0 && added <= now && now - added < NEW_DAYS * 86400e3;
}
