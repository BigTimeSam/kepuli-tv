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
// Constants that hold SVG markup written in the source, and the loop
// variables that walk tables of such constants.
const ICON_NAMES = new Set(['CLOSE_ICON', 'LIST_ICON', 'ICONS', 'kind', 'paths', 'dir']);

const files = [...readdirSync(join(ROOT, 'js')).filter((f) => f.endsWith('.js')).map((f) => `js/${f}`), 'background.js'];
const problems = [];

/** The identifiers an expression uses, its string literals taken out. */
function identifiers(expr) {
  const bare = expr
    .replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, "''")
    .replace(/`(?:\\.|[^`\\$]|\$(?!\{))*`/g, "''")          // template without interpolation
    .replace(/`((?:\\.|[^`\\])*)`/g, (_, body) => body.replace(/\$\{([^}]*)\}/g, ' $1 ').replace(/[^$\s][^$]*?(?=\$|$)/g, ' '));
  return [...bare.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
}

for (const file of files) {
  const lines = readFileSync(join(ROOT, file), 'utf8').split('\n');
  lines.forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '');
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
