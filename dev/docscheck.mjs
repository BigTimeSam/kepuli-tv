#!/usr/bin/env node
// The guides say what is true: every file and command they name exists,
// every tool and module is described where an agent will look for it, and
// every relative link lands.
//
//   node dev/docscheck.mjs
//
// The AGENTS.md files and docs/*.md are what an agent reads before it
// changes anything, and a guide that names a script that was renamed, or
// says nothing about a module that was added, sends it the wrong way with
// confidence. Checked:
//   - every `path/with/a.ext` and `node dev/x.mjs` in backticks in an
//     AGENTS.md, README.md or docs/*.md exists (paths with placeholders such
//     as <locale>, *, … or ~ are skipped, as are the generated and ignored
//     ones: dist/, firefox/dist/, dev/mock/media/);
//   - every script in dev/ is named in dev/AGENTS.md;
//   - every module in js/ is named in js/AGENTS.md;
//   - every directory with an AGENTS.md has a CLAUDE.md that imports it;
//   - every relative Markdown link in those files points at a file.
// Exit code 0 when all hold, 1 otherwise.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const rel = (p) => relative(ROOT, p);

function walk(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules', 'dist', 'vendor', '_locales'].includes(entry.name) || entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { if (!/^(firefox\/dist|dev\/mock\/media)$/.test(rel(path))) walk(path, found); }
    else found.push(path);
  }
  return found;
}

const all = walk(ROOT);
const guides = all.filter((p) => /(^|\/)AGENTS\.md$/.test(rel(p)) || rel(p) === 'README.md' || /^docs\/[^/]+\.md$/.test(rel(p)));
const SKIP = /[<>*…~{}$]|^(dist|firefox\/dist|dev\/mock\/media|dev\/wasm\/media)\/|^https?:|^\.\.\.|^\/tmp\/|^-/;
// Named on purpose though not in the repository: the credentials kept in
// ~/.config/kepuli-tv/, a file the project deliberately has none of, and a
// path inside the tv-logo/tv-logos repository.
const ELSEWHERE = new Set(['package.json', 'cws.json', 'amo.json', 'countries/nordic/finland/mtv3-fi.png']);
const basenames = new Set(all.map((p) => p.split('/').pop()));
const PATHLIKE = /^(?:\.{0,2}\/)?[\w.-]+(?:\/[\w.@-]+)+\.(?:mjs|js|json|md|txt|html|css|sh|py|yml|png|wasm|toml)$|^[\w.-]+\.(?:mjs|md|json|txt|html|yml)$/;

for (const guide of guides) {
  const text = readFileSync(guide, 'utf8');
  const here = dirname(guide);
  // Paths and commands in backticks.
  for (const [, code] of text.matchAll(/`([^`\n]+)`/g)) {
    const tokens = code.split(/\s+/);
    for (const token of tokens) {
      const clean = token.replace(/[,;:)]+$/, '').replace(/^\(/, '');
      if (!PATHLIKE.test(clean) || SKIP.test(clean) || ELSEWHERE.has(clean)) continue;
      const candidates = [join(ROOT, clean), join(here, clean)];
      // A bare file name, as guides say `amo-publish.mjs`: anywhere in the repository.
      if (!clean.includes('/') && basenames.has(clean)) continue;
      if (!candidates.some((c) => existsSync(c))) problems.push(`${rel(guide)}: names \`${clean}\`, which does not exist`);
    }
  }
  // Relative Markdown links.
  for (const [, target] of text.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
    if (/^(https?:|mailto:)/.test(target)) continue;
    if (!existsSync(resolve(here, target))) problems.push(`${rel(guide)}: links to ${target}, which does not exist`);
  }
}

// Every tool in dev/ named in dev/AGENTS.md, every module in js/ in js/AGENTS.md.
const devGuide = readFileSync(join(ROOT, 'dev', 'AGENTS.md'), 'utf8');
for (const f of readdirSync(join(ROOT, 'dev')).filter((f) => /\.(mjs|py|sh)$/.test(f))) {
  if (!devGuide.includes(f.replace(/\.(mjs|py|sh)$/, ''))) problems.push(`dev/AGENTS.md: says nothing of dev/${f}`);
}
const jsGuide = readFileSync(join(ROOT, 'js', 'AGENTS.md'), 'utf8');
for (const f of readdirSync(join(ROOT, 'js')).filter((f) => f.endsWith('.js'))) {
  if (!jsGuide.includes(f)) problems.push(`js/AGENTS.md: says nothing of js/${f}`);
}

// Every AGENTS.md has its CLAUDE.md beside it.
for (const guide of all.filter((p) => p.endsWith('/AGENTS.md'))) {
  const claude = join(dirname(guide), 'CLAUDE.md');
  if (!existsSync(claude) || !/@AGENTS\.md/.test(readFileSync(claude, 'utf8'))) problems.push(`${rel(claude)}: missing, or does not import @AGENTS.md`);
}

for (const p of problems) console.log(p);
console.log(problems.length ? `${problems.length} problem(s) in the guides` : `the guides hold (${guides.length} files)`);
process.exit(problems.length ? 1 : 0);
