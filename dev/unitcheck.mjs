#!/usr/bin/env node
// The pure functions, checked in Node without a browser: what goes in and
// what must come out. Fast, and a place for a case that once went wrong.
//
//   node dev/unitcheck.mjs
//
// Exit code 0 when every case holds, 1 otherwise.

import { parseServer } from '../js/xtream.js';
import { nameCleaner } from '../js/name.js';
import { cueText } from '../js/subs.js';
import { subtitleLook, STYLES, MIN_SIZE, MAX_SIZE, DEFAULT_SIZE } from '../js/subdisplay.js';

let failed = 0;
let count = 0;
function check(what, actual, expected) {
  count++;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) return;
  failed++;
  console.log(`FAIL  ${what}\n      got      ${a}\n      expected ${e}`);
}

/* ------------------------------------------------ xtream.js: parseServer */

const server = (text, expected) => check(`parseServer(${JSON.stringify(text)})`, parseServer(text), expected);

server('', null);
server('   ', null);
server('example.tv', { host: 'example.tv' });
server(' example.tv ', { host: 'example.tv' });
server('example.tv/', { host: 'example.tv' });
server('example.tv:8080', { host: 'example.tv', port: '8080' });
server('192.168.1.10:8080', { host: '192.168.1.10', port: '8080' });
server('http://example.tv:8080', { host: 'example.tv', scheme: 'http', port: '8080' });
server('http://example.tv', { host: 'example.tv', scheme: 'http', port: '80' });
server('https://example.tv', { host: 'example.tv', scheme: 'https', port: '443' });
server('https://Example.TV:8443/', { host: 'example.tv', scheme: 'https', port: '8443' });
server('http://[::1]:8080', { host: '[::1]', scheme: 'http', port: '8080' });
server('http://example.tv:8080/player_api.php?username=u&password=p',
       { host: 'example.tv', scheme: 'http', port: '8080', username: 'u', password: 'p' });
server('http://example.tv:8080/get.php?username=u&password=p&type=m3u_plus&output=ts',
       { host: 'example.tv', scheme: 'http', port: '8080', username: 'u', password: 'p' });
server('http://example.tv:8080/get.php?username=u', { host: 'example.tv', scheme: 'http', port: '8080' });
server('ftp://example.tv', null);
server('http://', null);

/* ------------------------------------------------- name.js: nameCleaner */

const items = (...names) => names.map((n) => ({ n }));
function cleaned(labels, names) {
  const clean = nameCleaner(labels, items(...names));
  return names.map((n) => (clean ? clean(n) : n));
}
const tidy = (what, labels, names, expected) => check(`nameCleaner ${what}`, cleaned(labels, names), expected);

// The chosen country's codes go whatever their share, in every spelling
// and behind every separator.
tidy('mixed tags under Finland', ['Finland'],
     ['FI: Yle TV1', 'FIN | MTV3', 'FI - MTV', 'Yle Teema', '|FI| Sub HD', 'Finland: Ava'],
     ['Yle TV1', 'MTV3', 'MTV', 'Yle Teema', 'Sub HD', 'Ava']);
tidy('a lone tag among untagged rows', ['Finland'],
     ['FI: MTV', 'Yle TV1', 'Yle TV2', 'Yle Teema', 'Yle Areena'],
     ['MTV', 'Yle TV1', 'Yle TV2', 'Yle Teema', 'Yle Areena']);
tidy('the Finnish spelling of the country', ['Suomi'], ['FI: Yle TV1', 'Yle TV2'], ['Yle TV1', 'Yle TV2']);
tidy('a topic under the country', ['Finland', 'Sport'], ['FI: Sport 1', 'FIN: Viasat Sport'], ['Sport 1', 'Viasat Sport']);
tidy('the topic as a tag', ['Finland', 'Sport'], ['FI: Sport | Liiga 1', 'FI: Sport - Liiga 2', 'FI: Sportti'], ['Liiga 1', 'Liiga 2', 'Sportti']);
tidy('the country in the label with more words', ['Finland HD'], ['FI: Yle TV1 HD'], ['Yle TV1 HD']);
tidy('United Kingdom', ['United Kingdom'], ['UK: BBC One', 'GB | ITV', 'ENG: Sky News'], ['BBC One', 'ITV', 'Sky News']);
tidy('EX-YU', ['EX-YU'], ['EX-YU | RTS 1', 'YU: HRT 1'], ['RTS 1', 'HRT 1']);

// Another country's code is not the chosen one's: it stays, unless it is
// the majority as before.
tidy('a foreign tag under Finland', ['Finland'], ['SE: SVT1', 'FI: Yle TV1', 'FI: Yle TV2'], ['SE: SVT1', 'Yle TV1', 'Yle TV2']);
tidy('a majority code under a topic', ['NHL'], ['US: NHL Ice Center 1', 'US: NHL Ice Center 2', 'CA: NHL Ice Center 3'],
     ['Ice Center 1', 'Ice Center 2', 'CA: NHL Ice Center 3']);
tidy('the label as a tag versus the label as a name', ['USA'], ['USA: NBC', 'USA Network HD'], ['NBC', 'USA Network HD']);
tidy('the label with a dash under its own topic', ['NHL'], ['NHL - Game 1', 'NHL - Game 2'], ['Game 1', 'Game 2']);

// What must not be touched.
tidy('a name that starts like the country', ['USA'], ['US: NBC', 'US: CBS', 'US: ABC', 'USA Network HD'],
     ['NBC', 'CBS', 'ABC', 'USA Network HD']);
tidy('a word, not a code', ['USA'], ['US Open Tennis', 'US: NBC'], ['US Open Tennis', 'NBC']);
tidy('a dash without spaces', ['Finland'], ['FI-Yle TV1'], ['FI-Yle TV1']);
tidy('F1 under Sport', ['Sport'], ['F1 - Qualifying', 'F1 - Race', 'NHL - Game 1'], ['F1 - Qualifying', 'F1 - Race', 'NHL - Game 1']);
tidy('nothing but the tag', ['Finland'], ['FI:', 'FI: Yle'], ['FI:', 'Yle']);
tidy('no labels: the majority rule alone', [], ['FI: A', 'FI: B', 'C'], ['A', 'B', 'C']);
tidy('no labels, no majority', [], ['FI: A', 'SE: B', 'C', 'D'], ['FI: A', 'SE: B', 'C', 'D']);
check('nameCleaner with nothing to strip is null', nameCleaner(['Sport'], items('Eurosport 1', 'Eurosport 2')), null);
check('nameCleaner with no items is null', nameCleaner(['Finland'], []), null);

/* ------------------------------------------- config.js: per-account lists */

// The extension API, faked: storage.local as a plain object. Installed
// before config.js is imported, which is why the import is dynamic.
const stored = {};
const clone = (v) => JSON.parse(JSON.stringify(v));
globalThis.chrome = { storage: { local: {
  async get(keys) { const out = {}; for (const k of [].concat(keys)) if (k in stored) out[k] = clone(stored[k]); return out; },
  async set(obj) { for (const [k, v] of Object.entries(obj)) stored[k] = clone(v); },
  async remove(keys) { for (const k of [].concat(keys)) delete stored[k]; },
  async clear() { for (const k of Object.keys(stored)) delete stored[k]; },
} } };
const store = await import('../js/config.js');
const accountA = { scheme: 'http', host: 'a.example', port: '8080', username: 'ann', password: 'x' };
const accountB = { scheme: 'http', host: 'b.example', port: '8080', username: 'bob', password: 'y' };
const item = (k, id, n) => ({ k, id, n });
const favs = async () => [...(await store.loadFavorites()).values()].map((i) => i.n);

// Before this version there was one set of lists, whoever the account was;
// the account in use adopts it and the old key is retired.
stored.config = accountA;
stored.favorites = [item(0, '1', 'Yle TV1')];
stored.resume = { '1:5': { position: 60, duration: 120, at: 1 } };
await store.loadConfig();
check('the old favourites are adopted by the account in use', await favs(), ['Yle TV1']);
check('the old key is retired', 'favorites' in stored, false);
check('the account key holds them', Object.keys(stored).filter((k) => k.startsWith('favorites:')), ['favorites:http://a.example:8080/ann']);
check('the old resume points are adopted too', [...(await store.loadResume()).keys()], ['1:5']);

// Another account sees nothing of the first, and its own lists go under its own key.
stored.config = accountB;
await store.loadConfig();
check('another account starts with no favourites', await favs(), []);
check('another account starts with no resume points', (await store.loadResume()).size, 0);
check('another account starts with no history', await store.loadRecents(), []);
await store.saveFavorites(new Map([['0:9', item(0, '9', 'SVT1')]]));
await store.pushRecent(item(1, '7', 'Film'));
check('its favourites are its own', await favs(), ['SVT1']);
check('its history is its own', (await store.loadRecents()).map((r) => r.n), ['Film']);

// Back to the first account: everything is where it was left.
stored.config = accountA;
await store.loadConfig();
check('switching back finds the favourites again', await favs(), ['Yle TV1']);
check('and the resume points', [...(await store.loadResume()).keys()], ['1:5']);
check('and no history from the other account', await store.loadRecents(), []);
// A change that keeps the account keeps the lists.
await store.saveConfig({ streamMode: 'hls' });
check('a playback-mode change keeps the lists', await favs(), ['Yle TV1']);

/* ---------------------------------------------------- subs.js: cueText */

const bytes = (text) => new TextEncoder().encode(text);
const srt = (what, text, expected) => check(`cueText SRT ${what}`, cueText('S_TEXT/UTF8', bytes(text)), expected);
const ass = (what, text, expected) => check(`cueText ASS ${what}`, cueText('S_TEXT/ASS', bytes(text)), expected);

srt('keeps italics', '<i>Hello</i>\r\nthere', '<i>Hello</i>\nthere');
srt('drops font tags but keeps their text', '<font color="#ffff00">Hello</font>', 'Hello');
srt('escapes a bare < that would open a tag', 'a < b and c<d', 'a &lt; b and c&lt;d');
srt('leaves a kept tag alone beside a bare <', '<b>x</b> < y', '<b>x</b> &lt; y');
srt('strips stray ASS codes', '{\\an8}Up here', 'Up here');
ass('takes the text after eight commas', '0,0,Default,,0,0,0,,One, two\\Nthree', 'One, two\nthree');
ass('drops style codes and escapes <', '0,0,Default,,0,0,0,,{\\i1}a < b', 'a &lt; b');
ass('drops a drawing', '0,0,Default,,0,0,0,,{\\p1}m 0 0 l 100 0', '');

/* ---------------------------------------------- subdisplay.js: the look */

check('subtitleLook defaults', subtitleLook({}), { style: 'shadow', size: DEFAULT_SIZE });
check('subtitleLook defaults on nothing', subtitleLook(null), { style: 'shadow', size: DEFAULT_SIZE });
check('subtitleLook keeps a known choice', subtitleLook({ subtitleStyle: 'yellow', subtitleSize: 31 }), { style: 'yellow', size: 31 });
check('subtitleLook takes a size written as text', subtitleLook({ subtitleSize: '40' }).size, 40);
check('subtitleLook rounds a size', subtitleLook({ subtitleSize: 20.6 }).size, 21);
check('subtitleLook holds a size to the bounds', [subtitleLook({ subtitleSize: 1 }).size, subtitleLook({ subtitleSize: 900 }).size], [MIN_SIZE, MAX_SIZE]);
check('subtitleLook replaces an unknown choice', subtitleLook({ subtitleStyle: 'neon', subtitleSize: 'huge' }), { style: 'shadow', size: DEFAULT_SIZE });
check('subtitleLook replaces a size that is not a number', [subtitleLook({ subtitleSize: NaN }).size, subtitleLook({ subtitleSize: -5 }).size], [DEFAULT_SIZE, DEFAULT_SIZE]);
// The named sizes of the older settings, at what they measured in a window.
check('subtitleLook reads the older sizes', ['small', 'medium', 'large'].map((s) => subtitleLook({ subtitleSize: s }).size), [18, 24, 34]);
// Every look has a rule in the stylesheet and an option in the menu, in the
// same order; the slider's bounds are the module's.
{
  const html = (await import('node:fs')).readFileSync(new URL('../player.html', import.meta.url), 'utf8');
  const sheet = (await import('node:fs')).readFileSync(new URL('../css/player.css', import.meta.url), 'utf8');
  for (const style of STYLES) {
    check(`player.css draws the look "${style}"`, sheet.includes(`body[data-substyle="${style}"] .subdisplay .cue`), true);
  }
  const offered = [...html.matchAll(/<option value="(\w+)" data-i18n="subs\.style\.\w+">/g)].map((m) => m[1]);
  check('player.html offers the looks in the module\'s order', offered, STYLES);
  const slider = html.match(/<input id="f-subsize" type="range" min="(\d+)" max="(\d+)" step="1" value="(\d+)">/);
  check('player.html\'s slider has the module\'s bounds and default', slider && slider.slice(1).map(Number), [MIN_SIZE, MAX_SIZE, DEFAULT_SIZE]);
}

/* ------------------------------------------------- player.css: contrast */

// The text colours against every ground they sit on, by WCAG's formula:
// 4.5:1 for the small text, and the selected row is a ground too.
const css = (await import('node:fs')).readFileSync(new URL('../css/player.css', import.meta.url), 'utf8');
const cssVar = (name) => (css.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i')) || [])[1];
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const grounds = { bg: cssVar('bg'), panel: cssVar('panel'), 'panel-2': cssVar('panel-2'), 'row-hover': cssVar('row-hover'), selected: '#202538' };
for (const [text, least] of [['dim', 4.5], ['muted', 4.5], ['text', 7]]) {
  for (const [ground, hex] of Object.entries(grounds)) {
    const ratio = contrast(cssVar(text), hex);
    check(`--${text} on --${ground} reaches ${least}:1 (${ratio.toFixed(2)})`, ratio >= least, true);
  }
}

/* ------------------------------------------------------------------ done */

console.log(failed ? `${failed} of ${count} cases failed` : `PASS: ${count} cases`);
process.exit(failed ? 1 : 0);
