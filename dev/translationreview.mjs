#!/usr/bin/env node
// A second reviewer for the translations: Codex reads each language against
// the English and fixes only clear defects, four batches at a time.
//
//   node dev/translationreview.mjs                every language but English and Finnish
//   node dev/translationreview.mjs de fr          those languages
//
// The instructions are dev/i18n/review-prompt.txt (meaning, grammar, form of
// address, one term per concept, placeholders, the stores' keyword limits;
// no restyling, no keys added or moved). Each batch runs `codex exec` in the
// workspace-write sandbox on its own files, so batches never touch the same
// file; reports go to dist/i18n-review/<batch>.md.
//
// Codex is a reviewer, not the last word: after it, check that every locale
// loads, that placeholders match the English, that keys and order are
// unchanged and the listings pass (`node dev/listings.mjs`), read the diff,
// and spot-check the words you can (it once turned the Latvian word for a
// set-top box into a non-word). js/locales/AGENTS.md has the checklist.
// Needs the codex CLI signed in; nothing here needs an API key.

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'dist', 'i18n-review');
const LISTING = { pt: ['pt_BR', 'pt_PT'], nb: ['no'] };   // interface code → listing files
const all = readdirSync(join(ROOT, 'js', 'locales')).filter((f) => /^[a-z]{2}\.js$/.test(f)).map((f) => f.slice(0, 2));
const langs = process.argv.slice(2).length ? process.argv.slice(2) : all;
const files = (lang) => [`js/locales/${lang}.js`, ...(LISTING[lang] || [lang]).map((l) => `store/listings/${l}.txt`)];
const batches = [[], [], [], []];
langs.forEach((lang, i) => batches[i % 4].push(lang));
const prompt = readFileSync(join(ROOT, 'dev', 'i18n', 'review-prompt.txt'), 'utf8');
mkdirSync(OUT, { recursive: true });

const runs = batches.filter((b) => b.length).map((batch, i) => new Promise((done) => {
  const name = `batch-${i + 1}-${batch.join('-')}`;
  const text = prompt.replace('LANGFILES', batch.flatMap(files).join(' '));
  console.log(`${name}: ${batch.join(' ')}`);
  const child = spawn('codex', ['exec', '--skip-git-repo-check', '-s', 'workspace-write', '-C', ROOT, '-o', join(OUT, `${name}.md`), text], { stdio: ['ignore', 'ignore', 'ignore'] });
  child.on('close', (code) => { console.log(`${name}: ${code === 0 ? 'done' : `exit ${code}`}`); done(code); });
}));
const codes = await Promise.all(runs);
writeFileSync(join(OUT, 'README.txt'), `Reports of node dev/translationreview.mjs ${langs.join(' ')}\n`);
console.log(`reports in ${OUT}; now run the checks in js/locales/AGENTS.md`);
process.exit(codes.some(Boolean) ? 1 : 0);
