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
// repeat it. The one exception is the chosen country's own code: under
// "Finland" the tags "FI:" and "FIN |" go whatever their share, because a
// provider mixes its spellings and leaves rows untagged, and a majority is
// then never reached — the viewer would see "FI: MTV" among clean rows. The
// full name is always in the row's title text, so nothing is lost for good.
//
// The country table the tidier keeps for that answers one more question,
// for js/logos.js: which country a label, a folder name or the tag in
// front of a channel name stands for. It is the same table either way, so
// a spelling the sidebar understands is one the logos understand too.

const WORD = /[\p{L}\p{N}]/u;
const LEADING_JUNK = /^[^\p{L}\p{N}]+/u;

// A country code at the start of a name: "US: ...", "|US| ...",
// "EX-YU | ...". The code is rarely spelled like the category's country
// ("US:" vs. "USA"), so comparing names does not find it. A hard separator
// (":" or "|") is part of the detection: without it "US Open Tennis" would
// lose its beginning. A spaced dash counts as a separator only for the
// chosen country's own codes and name (RE_CODE_DASH): "FI - MTV" under
// Finland is a tag, but "F1 - Qualifying" under Sport is a name, however
// many rows share its beginning.
const RE_CODE = /^\s*\|?\s*([\p{L}\p{N}]{2,6}(?:[-/][\p{L}\p{N}]{2,6})?)\s*[:|]/u;
const RE_CODE_DASH = /^\s*\|?\s*([\p{L}\p{N}]{2,6}(?:[-/][\p{L}\p{N}]{2,6})?)\s*-\s/u;

const wordsOf = (label) => (String(label || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);

// The codes providers put in front of a country's channels, by the names
// the sidebar shows for the country: the provider's own category names,
// which come in English, in the language of the country and now and then
// in Finnish. Two-letter ISO codes, the three-letter ones that are common
// in listings, and a few that are neither ("EX-YU").
const COUNTRIES = [
  [['fi', 'fin'], 'finland', 'suomi'],
  [['se', 'swe'], 'sweden', 'sverige', 'ruotsi'],
  [['no', 'nor'], 'norway', 'norge', 'norja'],
  [['dk', 'den', 'dnk'], 'denmark', 'danmark', 'tanska'],
  [['is', 'ice', 'isl'], 'iceland', 'island', 'islanti'],
  [['ee', 'est'], 'estonia', 'eesti', 'viro'],
  [['lv', 'lat', 'lva'], 'latvia', 'latvija'],
  [['lt', 'lit', 'ltu'], 'lithuania', 'lietuva', 'liettua'],
  [['de', 'ger', 'deu'], 'germany', 'deutschland', 'saksa'],
  [['at', 'aut'], 'austria', 'österreich', 'itävalta'],
  [['ch', 'sui', 'swi', 'che'], 'switzerland', 'schweiz', 'suisse', 'sveitsi'],
  [['nl', 'ned', 'nld'], 'netherlands', 'nederland', 'holland', 'alankomaat', 'hollanti'],
  [['be', 'bel'], 'belgium', 'belgië', 'belgique', 'belgia'],
  [['fr', 'fra'], 'france', 'ranska'],
  [['es', 'esp', 'spa'], 'spain', 'españa', 'espanja'],
  [['pt', 'por', 'prt'], 'portugal', 'portugali'],
  [['it', 'ita'], 'italy', 'italia'],
  [['uk', 'gb', 'eng', 'gbr'], 'united kingdom', 'uk', 'england', 'great britain', 'britain', 'iso-britannia', 'britannia', 'englanti'],
  [['ie', 'irl'], 'ireland', 'irlanti'],
  [['pl', 'pol'], 'poland', 'polska', 'puola'],
  [['cz', 'cze'], 'czech', 'czechia', 'czech republic', 'česko', 'tšekki'],
  [['sk', 'svk'], 'slovakia', 'slovensko'],
  [['hu', 'hun'], 'hungary', 'magyar', 'magyarország', 'unkari'],
  [['ro', 'rou', 'rom'], 'romania', 'românia'],
  [['bg', 'bul', 'bgr'], 'bulgaria', 'българия'],
  [['gr', 'gre', 'grc'], 'greece', 'hellas', 'ελλάδα', 'kreikka'],
  [['tr', 'tur'], 'turkey', 'türkiye', 'turkki'],
  [['ru', 'rus'], 'russia', 'россия', 'venäjä'],
  [['ua', 'ukr'], 'ukraine', 'україна', 'ukraina'],
  [['rs', 'srb'], 'serbia', 'srbija'],
  [['hr', 'cro', 'hrv'], 'croatia', 'hrvatska', 'kroatia'],
  [['ba', 'bih', 'bos'], 'bosnia', 'bosna'],
  [['si', 'slo', 'svn'], 'slovenia', 'slovenija'],
  [['al', 'alb'], 'albania', 'shqipëri'],
  [['mk', 'mkd'], 'macedonia', 'north macedonia'],
  [['me', 'mne'], 'montenegro', 'crna gora'],
  [['ex-yu', 'exyu', 'yu'], 'ex-yu', 'exyu', 'ex yu', 'balkan'],
  [['us', 'usa'], 'usa', 'united states', 'america', 'yhdysvallat'],
  [['ca', 'can'], 'canada', 'kanada'],
  [['mx', 'mex'], 'mexico', 'méxico', 'meksiko'],
  [['br', 'bra'], 'brazil', 'brasil', 'brasilia'],
  [['ar', 'arg'], 'argentina'],
  [['au', 'aus'], 'australia'],
  [['nz', 'nzl'], 'new zealand'],
  [['in', 'ind'], 'india', 'intia'],
  [['pk', 'pak'], 'pakistan'],
  [['cn', 'chn'], 'china', 'kiina'],
  [['jp', 'jpn'], 'japan', 'japani'],
  [['kr', 'kor'], 'korea', 'south korea'],
  [['ar', 'arab', 'ara'], 'arabic', 'arab', 'arabia'],
];
const CODES_BY_NAME = new Map();
const CODES_BY_CODE = new Map();
for (const [codes, ...names] of COUNTRIES) {
  for (const name of names) CODES_BY_NAME.set(name, codes);
  // "ar" is Argentina's and Arabic's alike; the first line to claim it keeps it.
  for (const code of codes) if (!CODES_BY_CODE.has(code)) CODES_BY_CODE.set(code, codes);
}

/**
 * Is this one of the codes above? Asked of the word a name begins with,
 * to tell a tag from a name: "FI | MTV" carries one, "MTV3 | HD" does not,
 * and the two look alike to a pattern that reads only the punctuation.
 */
export function isCountryCode(code) {
  return CODES_BY_CODE.has(String(code || '').toLowerCase());
}

/**
 * The codes a country's own name stands for, and nothing else: "world
 * latin america" is not the United States, however much "America" is one
 * of its words. This is the reading a folder name or a country column
 * needs; a provider's label, which mixes the country with a topic, needs
 * labelCodes below.
 */
export function countryCodes(name) {
  return CODES_BY_NAME.get(wordsOf(name).join(' ')) || [];
}

/**
 * The codes a sidebar label stands for: the whole label, any word of it,
 * or — when the provider writes the code where another writes the name —
 * the code the label begins with. Only the beginning, and only a code:
 * "FI" is Finland's column, while an "in" or an "is" further along a label
 * is a word of English rather than India or Iceland.
 */
export function labelCodes(label) {
  const whole = countryCodes(label);
  if (whole.length) return whole;
  const words = wordsOf(label);
  for (const word of words) {
    const hit = CODES_BY_NAME.get(word);
    if (hit) return hit;
  }
  return (words.length && CODES_BY_CODE.get(words[0])) || [];
}

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

  // The chosen country's codes need no majority; any other code does.
  const own = new Set(labels.flatMap(labelCodes));
  const dominant = dominantCode(names);
  if (own.size || dominant) {
    steps.push((name) => stripCode(name, own, dominant));
    names = names.map((name) => stripCode(name, own, dominant) ?? name);
  }

  for (const label of labels) {
    const tokens = wordsOf(label);
    if (!tokens.length) continue;
    // The label's own words closed by a hard separator are a tag, and go
    // whatever their share: "Finland: Ava" under Finland. Without the
    // separator they may be the name — "USA Network HD" — and the majority
    // decides below.
    const tag = tagPattern(tokens);
    if (names.some((name) => tag.test(name))) {
      steps.push((name) => stripTag(name, tag));
      names = names.map((name) => stripTag(name, tag) ?? name);
    }
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

const searchCleaners = new WeakMap();

/** Apply each search result's own group rules, never the mixed result set's. */
export function searchNameCleaner(groups, items) {
  const cached = searchCleaners.get(items);
  if (cached?.groups === groups) return cached.cleaner;
  const byCategory = new Map();
  const buckets = groups.map(group => ({ group, items: new Set(), clean: null }));
  for (const bucket of buckets) {
    for (const category of bucket.group.cats) {
      const id = String(category.id);
      if (!byCategory.has(id)) byCategory.set(id, []);
      byCategory.get(id).push(bucket);
    }
  }
  for (const item of items) {
    for (const id of item.cats || []) {
      for (const bucket of byCategory.get(String(id)) || []) bucket.items.add(item);
    }
  }
  for (const bucket of buckets) {
    bucket.clean = nameCleaner([bucket.group.name], [...bucket.items]);
    bucket.items.clear();
  }
  const cleaner = (name, item) => {
    for (const id of item?.cats || []) {
      for (const bucket of byCategory.get(String(id)) || []) {
        // Select the rule using the parent title, even when later applying
        // it to an episode name in that title's detail view.
        if (bucket.clean && bucket.clean(item.n) !== item.n) return bucket.clean(name);
      }
    }
    return name;
  };
  searchCleaners.set(items, { groups, cleaner });
  return cleaner;
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

/**
 * An accepted code and its separator from the start of the name, or null
 * if the name starts with no code or with some other code. The chosen
 * country's own codes are accepted behind a spaced dash as well.
 */
function stripCode(name, own, dominant) {
  let m = RE_CODE.exec(name);
  if (m && (own.has(m[1].toLowerCase()) || m[1].toLowerCase() === dominant)) {
    return name.slice(m[0].length).replace(LEADING_JUNK, '');
  }
  m = RE_CODE_DASH.exec(name);
  if (m && own.has(m[1].toLowerCase())) return name.slice(m[0].length).replace(LEADING_JUNK, '');
  return null;
}

const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The label's words, in order, closed by a hard separator or a spaced dash. */
function tagPattern(tokens) {
  const words = tokens.map(escapeRe).join('[^\\p{L}\\p{N}]+');
  return new RegExp(`^[^\\p{L}\\p{N}]*${words}(?![\\p{L}\\p{N}])\\s*(?:[:|]|-\\s)`, 'iu');
}

function stripTag(name, pattern) {
  const m = pattern.exec(name);
  if (!m) return null;
  return name.slice(m[0].length).replace(LEADING_JUNK, '') || null;
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
