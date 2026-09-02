// Kanavanimen siistiminen suodatetussa näkymässä.
//
// Palveluntarjoajan nimessä toistuu sama tieto kuin sivupalkin valinnassa:
// "US: NHL Ice Center Pass 3 FHD" löytyy maan "USA" ja aiheen "NHL" alta.
// Kun kumpikin suodatin on päällä, etuliite ei erottele riviä yhdestäkään
// muusta näkyvästä rivistä — se vie vain tilan kapeasta sarakkeesta.
//
// Poistettava osa päätellään näkyvästä joukosta, ei pelkästä nimestä:
// etuliite karsitaan vain jos se toistuu rivien enemmistössä. Siksi
// "USA Network HD" säilyy kokonaisena maan "USA" alla — nimen alku on osa
// nimeä silloin kun se ei toistu muilla. Koko nimi on aina rivin
// title-tekstissä, joten mitään ei häviä lopullisesti.

const WORD = /[\p{L}\p{N}]/u;
const LEADING_JUNK = /^[^\p{L}\p{N}]+/u;

// Maakoodi nimen alussa: "US: ...", "|US| ...", "EX-YU | ...". Koodi on
// harvoin kirjoitettu kuten kategorian maa ("US:" vs. "USA"), joten sitä ei
// löydä nimivertailulla. Kova erotin (":" tai "|") on osa tunnistusta:
// ilman sitä "US Open Tennis" menettäisi alkunsa.
const RE_CODE = /^\s*\|?\s*([\p{L}\p{N}]{2,6}(?:[-/][\p{L}\p{N}]{2,6})?)\s*[:|]/u;

const wordsOf = (label) => (String(label || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);

/**
 * Rakentaa siistijän näkyvälle joukolle kerran, ei riviä kohti: sama
 * päättely toistuisi virtualisoidussa listassa jokaisella vierityksellä.
 *
 * @param {string[]} labels aktiiviset suodattimet järjestyksessä, esim. ["USA", "NHL"]
 * @param {{n:string}[]} items näkyvä joukko
 * @returns {((name: string) => string)|null} null jos poistettavaa ei ole
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
    // Ehdoton enemmistö: harvinainen osuma on osa nimeä, ei etuliitettä.
    if (hits * 2 <= names.length) continue;
    steps.push((name) => stripWords(name, tokens));
    names = stripped;
  }

  if (!steps.length) return null;
  return (name) => clean(String(name || ''), steps);
}

/**
 * Etuliitteet voivat esiintyä missä järjestyksessä tahansa ("US: NHL …",
 * "NHL US: …"), joten kierroksia ajetaan kunnes mikään ei enää osu.
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

/** Joukon yleisin maakoodi, tai null jos yksikään ei ole enemmistössä. */
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

/** Nimen alusta annettu koodi erottimineen, tai null jos se on jokin muu. */
function stripCode(name, code) {
  const m = RE_CODE.exec(name);
  if (!m || m[1].toLowerCase() !== code) return null;
  return name.slice(m[0].length).replace(LEADING_JUNK, '');
}

/**
 * Nimen alusta annetut sanat, välimerkeistä piittaamatta: "NHL" osuu yhtä
 * lailla muotoihin "NHL Ice Center" ja "- NHL | Ice Center". Sanan on
 * loputtava rajaan, jottei "US" katkaise nimeä "USA Network".
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
