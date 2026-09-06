#!/usr/bin/env node
// The tv-logo/tv-logos file list, into js/logoindex.js.
//
//   node dev/logos.mjs            rewrites js/logoindex.js from the repository
//   node dev/logos.mjs --check    exits 1 if the index is out of date
//   node dev/logos.mjs --report   … and lists what changed, folder by folder
//
// The app matches a channel to a logo by name (js/logos.js), which means
// it has to know what file names exist. Asking GitHub at run time would
// cost a host permission, a megabyte of JSON and a working connection for
// something that changes a few times a month, so the list is generated
// here and shipped as a module.
//
// Only countries/ is taken. misc/ is posters for films and 24/7 loops,
// which arrive from the provider with a picture of their own, and the
// obsolete/, screen-bug/, old/ and hd/ folders are alternative renderings
// of channels their parent folder already has — as keys they would be
// duplicates that resolve to nothing.
//
// The keys are made by slugify() from js/logos.js, the very function the
// app puts channel names through, so the two sides of the match cannot
// drift apart. Change it and rerun this. No dependencies; Node 22+ is
// enough, and the one request is to the public GitHub API.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { slugify } from '../js/logos.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'js', 'logoindex.js');

const REPO = 'tv-logo/tv-logos';
const BRANCH = 'main';
const ROOT_DIR = 'countries/';
// The branch rather than the commit: a renamed file then costs one logo,
// which the <img> error handler hides, where a commit that fell out of the
// repository would cost every one of them.
const BASE = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${ROOT_DIR}`;

// Folder names that hold another take on a channel their parent already
// has, matched as whole path segments.
const ALTERNATIVE = /(^|\/)(hd|old|obsolete|screen-bug)(\/|$)/;

/* ------------------------------------------------------------------ fetch */

async function tree() {
  const url = `https://api.github.com/repos/${REPO}/git/trees/${BRANCH}?recursive=1`;
  const res = await fetch(url, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'kepuli-tv' } });
  if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
  const data = await res.json();
  // The API gives up on a huge tree and sends a part of it. A part would
  // produce an index that quietly lacks countries, so it is refused.
  if (data.truncated) throw new Error('the GitHub tree came back truncated; fetch it folder by folder');
  return data.tree.filter((e) => e.type === 'blob' && e.path.endsWith('.png')).map((e) => e.path);
}

/* ------------------------------------------------------------------ index */

/** The country code the file names of a folder end with, when most of them agree. */
function commonCode(names) {
  const counts = new Map();
  for (const name of names) {
    const code = name.slice(name.lastIndexOf('-') + 1);
    if (code !== name) counts.set(code, (counts.get(code) || 0) + 1);
  }
  let best = null;
  let top = 0;
  for (const [code, count] of counts) if (count > top) { best = code; top = count; }
  return top * 2 > names.length ? best : null;
}

function build(paths) {
  const folders = new Map();
  const stats = { files: 0, skipped: 0, collisions: [] };
  for (const path of paths) {
    if (!path.startsWith(ROOT_DIR)) continue;
    const cut = path.lastIndexOf('/');
    const dir = path.slice(ROOT_DIR.length, cut);
    if (ALTERNATIVE.test(dir)) { stats.skipped++; continue; }
    if (!folders.has(dir)) folders.set(dir, []);
    folders.get(dir).push(path.slice(cut + 1, -'.png'.length));
    stats.files++;
  }

  const out = [];
  for (const dir of [...folders.keys()].sort()) {
    const names = folders.get(dir).sort();
    const code = commonCode(names);
    const entries = new Map();
    for (const name of names) {
      const bare = code && name.endsWith(`-${code}`) ? name.slice(0, -code.length - 1) : name;
      const key = slugify(bare);
      if (!key || / |=/.test(name)) { stats.skipped++; continue; }
      // "MTV Liiga UHD" and "MTV Liiga" are one channel to slugify(), and
      // the plainer file name is the one that belongs to the plain key.
      const seen = entries.get(key);
      if (seen) {
        stats.collisions.push(`${dir}: ${seen} / ${name} → ${key}`);
        if (seen.length <= name.length) continue;
      }
      entries.set(key, name);
    }
    const packed = [...entries].sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([key, name]) => (name === (code ? `${key}-${code}` : key) ? key : `${key}=${name}`));
    out.push([dir, code || '', packed.join(' ')]);
  }
  return { dirs: out, stats };
}

/* ------------------------------------------------------------------ write */

const keyCount = (dirs) => dirs.reduce((n, [, , packed]) => n + packed.split(' ').length, 0);

function module_(dirs) {
  return `// The tv-logo/tv-logos file list. Generated by dev/logos.mjs — do not edit.
//
// ${keyCount(dirs).toLocaleString('en')} keys in ${dirs.length} folders of ${REPO}@${BRANCH}, read as
// [folder, the country code its file names end with, its keys]. A key is a
// file name without that code, put through slugify(); "key=name" is a file
// whose name the key cannot be built back into. js/logos.js does the
// matching and explains what the rules are.

export const LOGO_BASE = '${BASE}';

export const LOGO_DIRS = [
${dirs.map(([dir, code, packed]) => `  [${JSON.stringify(dir)}, ${JSON.stringify(code)}, ${JSON.stringify(packed)}],`).join('\n')}
];
`;
}

/* ------------------------------------------------------------------- main */

const args = process.argv.slice(2);
const paths = await tree();
const { dirs, stats } = build(paths);
const source = module_(dirs);

let current = '';
try { current = readFileSync(OUT, 'utf8'); } catch { /* missing counts as stale */ }

if (args.includes('--report')) {
  const keysOf = (text) => {
    const found = new Map();
    for (const [, dir, packed] of text.matchAll(/\n {2}\["([^"]+)", "[^"]*", "([^"]*)"\],/g)) found.set(dir, packed.split(' '));
    return found;
  };
  const before = keysOf(current);
  const after = keysOf(source);
  for (const [dir, keys] of after) {
    const was = new Set(before.get(dir) || []);
    const added = keys.filter((k) => !was.has(k));
    const gone = [...was].filter((k) => !keys.includes(k));
    if (added.length || gone.length) console.log(`${dir}  +${added.length} -${gone.length}  ${[...added.slice(0, 6), ...gone.slice(0, 6).map((k) => `-${k}`)].join(' ')}`);
  }
  for (const dir of before.keys()) if (!after.has(dir)) console.log(`${dir}  gone`);
}

// Two file names of one folder that reduce to one key are the ordinary
// case — "abc-au" beside "abc-hd-au" — and the plainer name wins. They are
// worth reading through when a logo comes out wrong, and nothing to report
// otherwise.
if (args.includes('--report')) for (const clash of stats.collisions) console.log(`collision  ${clash}`);

if (args.includes('--check')) {
  if (current !== source) { console.error('js/logoindex.js is out of date: run node dev/logos.mjs'); process.exit(1); }
  console.log('js/logoindex.js is up to date');
} else {
  writeFileSync(OUT, source);
  console.log(`js/logoindex.js  ${(source.length / 1024).toFixed(1)} kB  ` +
    `${keyCount(dirs)} keys in ${dirs.length} folders, from ${stats.files} files ` +
    `(${stats.skipped} skipped, ${stats.collisions.length} collisions)`);
}
