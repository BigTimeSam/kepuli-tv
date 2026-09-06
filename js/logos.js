// Channel logos from tv-logo/tv-logos.
//
// Every channel arrives with a logo address of the provider's own, and on
// this account those addresses point into mediaportal-nordic-logos — a
// collection that was archived years ago, so a good part of the list shows
// nothing at all. tv-logos is the maintained collection that took its
// place, and it is where a channel's logo is looked for first. What the
// provider sent stays as the fallback: it still covers channels tv-logos
// has never had.
//
// The two have no identifier in common. tv-logos is addressed by file
// name, the API knows a stream id and a name, and the bridge is the name:
// "FI: MTV3 HD" and countries/nordic/finland/mtv3-fi.png meet at the key
// "mtv3". slugify() is what makes them meet — it drops the country tag in
// front, the quality tag wherever it sits, and every difference of
// punctuation and accent.
//
// The collection's file list is generated into logoindex.js by
// dev/logos.mjs rather than fetched at run time. That keeps the lookup
// instant and offline, and it costs no host permission: an <img> needs
// none, a fetch to raw.githubusercontent.com would.
//
// A wrong logo is worse than no logo — the viewer cannot tell that it is
// wrong, and a channel wearing another country's badge is a bug report
// waiting to happen. So a key has to match a file name exactly, and where
// several countries own that name the channel's own country decides:
//
//   1. the key in a folder of the channel's country: "TV3" under Denmark
//      is Denmark's, not Norway's
//   2. the key in that country with the word breaks ignored, where it is
//      the only one: providers write "SkyShowtime 1" and tv-logos files it
//      as sky-showtime-1, and neither spelling is wrong
//   3. the key as the tail of exactly one file name in that same country.
//      Finnish providers list the channels as "Sub", "Ava" and "Max" while
//      tv-logos files them under their owner as mtv-sub, mtv-ava, mtv-max.
//      The single-match rule keeps this honest: "hits" ends both
//      c-more-hits and mtv-hits in Denmark, so it resolves to neither
//   4. the key in exactly one folder anywhere — "mtv3" is Finland's alone,
//      whatever shelf the channel was listed on
//   5. the key in international/, when several countries have it. That
//      folder holds the version of a brand that carries no country, which
//      is the right answer for the fifteen folders that all have a
//      "cartoon-network"
//
// Anything still ambiguous is left to the provider's own address. Note how
// much of this rests on knowing the country: only the last two rules work
// without one, and they are the two that can reach across a border.

import { countryCodes, isCountryCode } from './name.js';
import { LOGO_BASE, LOGO_DIRS } from './logoindex.js';

// Tags for the picture, not for the channel: two rows of the same list
// read "MTV3" and "MTV3 FHD" and mean one channel with one logo. They go
// wherever they stand as a word of their own, so that a name ending in one
// ("Yle TV1 HD") and a name carrying one in the middle ("Sky Sport HD 2")
// land on the same key.
const QUALITY = new Set(['hd', 'fhd', 'uhd', 'shd', 'sd', 'ld', 'hq', '4k', '8k', 'hevc', 'h264', 'h265',
  'x264', 'x265', '1080', '1080p', '720', '720p', '576p', '480p', '50fps', '60fps']);

// The country tag in front of a name: "FI: MTV3", "|SE| TV4", "[UK] BBC
// One". A hard separator is required, exactly as in name.js — without one
// "US Open Tennis" would lose its beginning — and so is a code the app
// knows, because the same punctuation appears in "MTV3 | HD". The tag is
// the best country hint there is: it travels with the channel rather than
// with the shelf the channel happens to stand on.
const RE_TAG = /^\s*[|([]?\s*([\p{L}\p{N}]{2,6}(?:[-/][\p{L}\p{N}]{2,6})?)\s*[:|)\]]\s*/u;
const RE_WORD = /[\p{L}\p{N}]+/gu;
const RE_MARK = /\p{M}/gu;
const RE_NON_ASCII = /[^\x20-\x7e]/;

/**
 * A channel or file name as a lookup key: "|FI| Yle TV1 HD" → "yle-tv1",
 * "TRT Genç" → "trt-genc". The same function makes both sides of the
 * match, so it runs in dev/logos.mjs over the collection's file names as
 * well — a change here changes the index, and the two stay in step only
 * as long as the index is regenerated with it.
 *
 * A name that is nothing but quality tags keeps them, because a key of ""
 * would match every other such name.
 */
export function slugify(name) {
  let text = String(name || '');
  // The decomposition turns "ç" into "c" and "ᴴᴰ" into "HD", and it is
  // slow enough to be worth skipping for the ASCII majority.
  if (RE_NON_ASCII.test(text)) text = text.normalize('NFKD').replace(RE_MARK, '');
  const words = text.toLowerCase().match(RE_WORD) || [];
  const kept = words.filter((word) => !QUALITY.has(word));
  return (kept.length ? kept : words).join('-');
}

/** A name split into the country tag it carries and the rest of it as a key. */
function readName(name) {
  const text = String(name || '');
  const tag = RE_TAG.exec(text);
  if (!tag || !isCountryCode(tag[1])) return { code: null, slug: slugify(text) };
  return { code: tag[1].toLowerCase(), slug: slugify(text.slice(tag[0].length)) };
}

// The index, unpacked from logoindex.js on first use: ten thousand entries
// cost a few milliseconds, and a session that never opens a channel list
// should not pay them.
let keys = null;        // key → the folders that have it
let squeezed = null;    // key without its word breaks → [folder, key] for each
let filesIn = null;     // folder → its keys
let namedFile = null;   // "folder key" → file name, where it is not key + code
let foldersFor = null;  // country code → its folders
let neutral = null;     // the folders of international/
let tailsIn = null;     // folder → tail → the one key it ends; built per folder on demand

function build() {
  if (keys) return;
  keys = new Map();
  squeezed = new Map();
  filesIn = [];
  namedFile = new Map();
  foldersFor = new Map();
  neutral = new Set();
  tailsIn = new Map();
  for (let dir = 0; dir < LOGO_DIRS.length; dir++) {
    const [path, , packed] = LOGO_DIRS[dir];
    const own = [];
    for (const entry of packed.split(' ')) {
      const split = entry.indexOf('=');
      const key = split === -1 ? entry : entry.slice(0, split);
      if (split !== -1) namedFile.set(`${dir} ${key}`, entry.slice(split + 1));
      own.push(key);
      const seen = keys.get(key);
      if (seen) seen.push(dir);
      else keys.set(key, [dir]);
      const flat = squeeze(key);
      const alike = squeezed.get(flat);
      if (alike) alike.push(dir, key);
      else squeezed.set(flat, [dir, key]);
    }
    filesIn.push(own);
    if (path === 'international' || path.startsWith('international/')) neutral.add(dir);
    // The country is the deepest folder name the app knows as a country:
    // "nordic/finland" is Finland's, "united-states/us-local/cw" the
    // United States'. Folders the table has no country for — malaysia,
    // world-latin-america — take part in the rules that need none. They
    // are not neutral: a Latin American brand is a country's, only not one
    // that is asked for by name here.
    let codes = [];
    for (const segment of path.split('/')) {
      const hit = countryCodes(segment.replace(/-/g, ' '));
      if (hit.length) codes = hit;
    }
    for (const code of codes) {
      const list = foldersFor.get(code);
      if (list) list.push(dir);
      else foldersFor.set(code, [dir]);
    }
  }
}

/**
 * The logo address for a channel, or null when nothing matches it beyond
 * doubt — the caller then keeps the address the provider sent.
 *
 * @param {string} name the provider's channel name, tags and all
 * @param {string[]} [codes] country codes the channel's categories point
 *        at (name.js labelCodes). The name's own tag comes first when it
 *        has one, because that one is the channel's rather than the shelf's.
 */
export function channelLogo(name, codes) {
  build();
  const { code, slug } = readName(name);
  if (!slug) return null;
  const home = folders(code, codes);
  const found = keys.get(slug) || [];

  // home is in order of authority, so a channel tagged "SE:" on a Danish
  // shelf gets Sweden's TV3 rather than the shelf's.
  for (const dir of home) if (found.includes(dir)) return address(dir, slug);
  if (home.length) {
    const near = onlyIn(squeezed.get(squeeze(slug)), home) || tailMatch(slug, home);
    if (near) return near;
  }
  if (found.length === 1) return address(found[0], slug);
  const anywhere = found.filter((dir) => neutral.has(dir));
  return anywhere.length === 1 ? address(anywhere[0], slug) : null;
}

// "sky-showtime-1" and "skyshowtime-1" are one name written two ways.
// Where the words of a name end is the one thing a provider and the
// collection disagree about without either being wrong.
const squeeze = (key) => (key.includes('-') ? key.replace(/-/g, '') : key);

/**
 * The one entry of a flat [folder, key, folder, key…] list that sits in
 * the channel's country, or null when none does or several do.
 */
function onlyIn(pairs, home) {
  let hit = null;
  for (let i = 0; pairs && i < pairs.length; i += 2) {
    if (!home.includes(pairs[i])) continue;
    if (hit) return null;
    hit = address(pairs[i], pairs[i + 1]);
  }
  return hit;
}

/**
 * The folders of the channel's country, the code its own name carries
 * before the ones its categories name — a handful of numbers, kept in
 * order rather than in a set, because which comes first is the answer to
 * a channel two countries could claim.
 */
function folders(code, codes) {
  const out = [];
  for (const one of code ? [code, ...(codes || [])] : codes || []) {
    for (const dir of foldersFor.get(one) || []) if (!out.includes(dir)) out.push(dir);
  }
  return out;
}

// Almost every file name is already a path segment; the few with a "%" or
// a "+" or a Cyrillic letter in them are not, and an <img> src is read as
// a URL whatever it holds.
const RE_PLAIN = /^[a-z0-9-]+$/;

function address(dir, key) {
  const [path, code] = LOGO_DIRS[dir];
  const file = namedFile.get(`${dir} ${key}`) || (code ? `${key}-${code}` : key);
  return `${LOGO_BASE}${path}/${RE_PLAIN.test(file) ? file : encodeURIComponent(file)}.png`;
}

/**
 * The key as the tail of exactly one file name in the channel's country.
 * A folder's tails are worked out once and kept: the same country is asked
 * about again for every channel in it. A tail that two file names share is
 * dropped as it is found, so a hit is by construction the only one in its
 * folder, and a country with two folders is checked for a second hit here.
 */
function tailMatch(slug, home) {
  let hit = null;
  for (const dir of home) {
    const key = tails(dir).get(slug);
    if (!key) continue;
    if (hit) return null;
    hit = address(dir, key);
  }
  return hit;
}

function tails(dir) {
  const known = tailsIn.get(dir);
  if (known) return known;
  const map = new Map();
  const shared = new Set();
  for (const key of filesIn[dir]) {
    for (let cut = key.indexOf('-'); cut !== -1; cut = key.indexOf('-', cut + 1)) {
      const tail = key.slice(cut + 1);
      if (map.has(tail) || shared.has(tail)) { map.delete(tail); shared.add(tail); }
      else map.set(tail, key);
    }
  }
  tailsIn.set(dir, map);
  return map;
}
