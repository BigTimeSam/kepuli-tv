// Tidying a channel name in a filtered view.
//
// The provider's name repeats what the sidebar selection already says:
// "US: NHL Ice Center Pass 3 FHD" is found under the country "USA" and the
// topic "NHL". With both filters on, the prefix distinguishes the row from
// no other visible row — it only takes space from a narrow column.
//
// What to remove is inferred from the visible set, not from the name
// alone: a prefix is stripped only when it repeats across a majority of
// rows. That is why "USA Network HD" survives intact under the country
// "USA" — the start of a name is part of the name when the others do not
// repeat it. The full name is always in the row's title text, so nothing
// is lost for good.

const WORD = /[\p{L}\p{N}]/u;
const LEADING_JUNK = /^[^\p{L}\p{N}]+/u;

// A country code at the start of a name: "US: ...", "|US| ...",
// "EX-YU | ...". The code is rarely spelled like the category's country
// ("US:" vs. "USA"), so comparing names does not find it. A hard separator
// (":" or "|") is part of the detection: without it "US Open Tennis" would
// lose its beginning.
const RE_CODE = /^\s*\|?\s*([\p{L}\p{N}]{2,6}(?:[-/][\p{L}\p{N}]{2,6})?)\s*[:|]/u;

const wordsOf = (label) => (String(label || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);

/**
 * Builds the tidier once for the visible set rather than per row: in a
 * virtualised list the same reasoning would repeat on every scroll.
 *
 * @param {string[]} labels active filters in order, e.g. ["USA", "NHL"]
 * @param {{n:string}[]} items the visible set
 * @returns {((name: string) => string)|null} null when there is nothing to strip
 */
export function nameCleaner(labels, items) {
  if (!items || !items.length) return null;

  let names = items.map((item) => String(item.n || ''));
  const steps = [];

  const code = dominantCode(names);
  if (code) {
    steps.push((name) => stripCode(name, code));
    names = names.map((name) => stripCode(name, code) ?? name);
  }

  for (const label of labels) {
    const tokens = wordsOf(label);
    if (!tokens.length) continue;
    let hits = 0;
    const stripped = names.map((name) => {
      const rest = stripWords(name, tokens);
      if (!rest) return name;
      hits++;
      return rest;
    });
    // An absolute majority: a rare match is part of the name, not a prefix.
    if (hits * 2 <= names.length) continue;
    steps.push((name) => stripWords(name, tokens));
    names = stripped;
  }

  if (!steps.length) return null;
  return (name) => clean(String(name || ''), steps);
}

/**
 * Prefixes can appear in any order ("US: NHL …", "NHL US: …"), so passes
 * are run until nothing matches any more.
 */
function clean(name, steps) {
  let rest = name;
  for (let pass = 0; pass < steps.length; pass++) {
    let changed = false;
    for (const step of steps) {
      const out = step(rest);
      if (out && out !== rest) { rest = out; changed = true; }
    }
    if (!changed) break;
  }
  return rest || name;
}

/** The set's most common country code, or null if none has a majority. */
function dominantCode(names) {
  const counts = new Map();
  for (const name of names) {
    const m = RE_CODE.exec(name);
    if (m) {
      const code = m[1].toLowerCase();
      counts.set(code, (counts.get(code) || 0) + 1);
    }
  }
  let best = null;
  let top = 0;
  for (const [code, count] of counts) {
    if (count > top) { best = code; top = count; }
  }
  return top * 2 > names.length ? best : null;
}

/** The given code and its separator from the start of the name, or null
 *  if the name starts with some other code. */
function stripCode(name, code) {
  const m = RE_CODE.exec(name);
  if (!m || m[1].toLowerCase() !== code) return null;
  return name.slice(m[0].length).replace(LEADING_JUNK, '');
}

/**
 * The given words from the start of the name, ignoring punctuation: "NHL"
 * matches "NHL Ice Center" and "- NHL | Ice Center" alike. A word must end
 * at a boundary, so that "US" does not cut into "USA Network".
 */
function stripWords(name, tokens) {
  const lower = name.toLowerCase();
  let i = 0;
  for (const token of tokens) {
    while (i < name.length && !WORD.test(name[i])) i++;
    if (!lower.startsWith(token, i)) return null;
    const end = i + token.length;
    if (end < name.length && WORD.test(name[end])) return null;
    i = end;
  }
  return name.slice(i).replace(LEADING_JUNK, '') || null;
}
