#!/usr/bin/env node
// No markup from data: every place the player's code writes HTML takes a
// constant, and nothing evaluates a string as code.
//
//   node dev/htmlcheck.mjs
//
// The player shows what providers send — channel names, plots, programme
// titles, logo addresses — and a provider is not to be trusted with the
// page: a name written as HTML could run script in the extension, with its
// storage and its credentials. So text goes in as text (textContent, el()),
// and the few places that write markup (innerHTML, outerHTML,
// insertAdjacentHTML) write icons, written here as string literals. This
// keeps it so: such a write may take only string literals and the names of
// constants listed below, and eval, new Function, document.write and a
// string passed to setTimeout or setInterval are refused outright.
//
// A new icon constant goes into ICON_NAMES; anything else that wants markup
// should build elements instead. Exit code 0 when clean, 1 otherwise.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Constants that hold SVG markup written in the source, or tables of it:
// an entry looked up in a table (ICONS[kind]) is the table's, whatever the
// key. `paths` is the parameter that rows.js's icon() and sectionHeader()
// and the view buttons in coversui.js take their table's entries in, and
// `dir` only chooses between two literals in idlehome.js: names trusted
// here, so a new use of either is read with them in mind.
const ICON_NAMES = new Set(['CLOSE_ICON', 'LIST_ICON', 'ICONS', 'ORDER_ICONS', 'EMPTY_ICONS', 'paths', 'dir']);

const files = [...readdirSync(join(ROOT, 'js')).filter((f) => f.endsWith('.js')).map((f) => `js/${f}`), 'background.js'];
const problems = [];

/** The identifiers an expression uses, its string literals taken out. */
function identifiers(expr) {
  const bare = expr
    // A template keeps only what it interpolates: its text is markup
    // written here, its ${…} what has to be checked.
    .replace(/`((?:\\.|[^`\\])*)`/g, (_, body) => [...body.matchAll(/\$\{([^}]*)\}/g)].map((m) => ` (${m[1]}) `).join(' '))
    .replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, "''")
    // An entry of a trusted table, whatever its key.
    .replace(/\b([A-Z_]+)\[[^\]]*\]/g, (whole, table) => (ICON_NAMES.has(table) ? table : whole));
  return [...bare.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
}

// The check checks itself: an interpolation once went through unread.
if (!identifiers('`<b>${item.name}</b>`').includes('item') || identifiers('`<i>${ICONS[x] || ICONS.movie}</i>`').some((n) => n !== 'ICONS')) {
  console.log('htmlcheck: identifiers() no longer reads what a template interpolates');
  process.exit(1);
}

for (const file of files) {
  const lines = readFileSync(join(ROOT, file), 'utf8').split('\n');
  lines.forEach((line, i) => {
    // A write split over lines is read to the line that ends it.
    let code = line.replace(/\/\/.*$/, '');
    for (let j = i + 1; /(?:innerHTML|outerHTML)\s*\+?=|insertAdjacentHTML\s*\(/.test(code) && /(?:[=(+,?:]|\|\||&&)\s*$/.test(code) && j < lines.length && j < i + 8; j++) code += ' ' + lines[j].trim();
    const at = `${file}:${i + 1}`;
    if (/\beval\s*\(|\bnew\s+Function\s*\(|document\.write(ln)?\s*\(/.test(code)) problems.push(`${at}: evaluates a string as code: ${line.trim()}`);
    if (/\bset(?:Timeout|Interval)\s*\(\s*['"`]/.test(code)) problems.push(`${at}: a string handed to a timer: ${line.trim()}`);
    const write = /\.(?:innerHTML|outerHTML)\s*\+?=\s*(.+?);?\s*$/.exec(code) || /\.insertAdjacentHTML\s*\(\s*['"][\w-]+['"]\s*,\s*(.+?)\)\s*;?\s*$/.exec(code);
    if (!write) return;
    const unknown = identifiers(write[1]).filter((name) => !ICON_NAMES.has(name));
    if (unknown.length) problems.push(`${at}: markup from ${[...new Set(unknown)].join(', ')}: ${line.trim()}`);
  });
}

for (const p of problems) console.log(p);
console.log(problems.length ? `${problems.length} problem(s): build elements and set textContent instead` : `markup only from constants, nothing evaluated (${files.length} files)`);
process.exit(problems.length ? 1 : 0);
