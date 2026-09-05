#!/usr/bin/env node
// The release packages, one per browser, from a committed state of the source.
//
//   node dev/package.mjs                  both packages into dist/chrome/ and dist/firefox/
//   node dev/package.mjs --zip            … and kepuli-tv-chrome-<version>.zip and
//                                         kepuli-tv-firefox-<version>.zip in the project root
//   node dev/package.mjs chrome --zip     one browser only
//   node dev/package.mjs --ref v1.0.4     from that commit or tag instead of HEAD
//   node dev/package.mjs --worktree       from the checkout as it is, uncommitted changes included
//   node dev/package.mjs --check          the manifest comparison alone
//
// A package is an allowlist, not the project minus an exclusion list: the
// shared runtime files below plus the one manifest that belongs to the
// browser. Nothing else can get in, whatever appears in the project root,
// so the Chrome package cannot pick up Firefox's tooling or the other way
// round. The files come from git — HEAD unless --ref says otherwise — so
// half-finished work in the checkout does not ship by accident; --worktree
// is the explicit way to package what is on disk, and it says what differs.
//
// Before anything is written the two manifests are compared: the version
// and every key that is not browser-specific must agree. After the copy
// every file the manifest and player.html refer to must exist in the
// package. With --zip the archive is listed against the previous one of the
// same browser, if there is one in the project root, so a file that went
// missing or crept in shows up before the upload.
//
// firefox/build.mjs is the development loop's copy of the same idea: it
// assembles firefox/dist/ from the checkout for firefox/dev.mjs to reload.
// Releases come from here. No dependencies; the zip comes from the
// system's own zip.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DIST = join(ROOT, 'dist');

// The runtime, identical in both packages.
export const SHARED = ['player.html', 'background.js', 'js', 'css', 'vendor', 'icons'];

// What is the browser's own: its manifest. It goes into the package as
// manifest.json whatever it is called here.
export const TARGETS = {
  chrome: { manifest: 'manifest.json' },
  firefox: { manifest: 'firefox/manifest.json' },
};

// Manifest keys the two browsers must agree on, and the keys each browser
// has of its own. A key that is neither stops the build, so a new key
// cannot land in one manifest and silently miss the other.
const SHARED_KEYS = ['manifest_version', 'name', 'version', 'description', 'content_security_policy',
                     'permissions', 'optional_host_permissions', 'action', 'icons'];
const OWN_KEYS = {
  chrome: ['background', 'minimum_chrome_version'],
  firefox: ['background', 'browser_specific_settings'],
};

const gitRaw = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const git = (...args) => gitRaw(...args).trim();
const noJunk = (path) => !/(^|\/)\.DS_Store$/.test(path);

/** A commit as the source: files come out of git, never off the disk. */
export function gitSource(ref = 'HEAD') {
  let sha;
  try { sha = git('rev-parse', '--short', `${ref}^{commit}`); }
  catch { throw new Error(`${ref} is not a commit or tag in this repository`); }
  return {
    label: `${ref} (${sha})`,
    read(path) {
      try { return git('show', `${ref}:${path}`); }
      catch { throw new Error(`${path} does not exist in ${ref}`); }
    },
    exportTo(paths, dir) {
      const tar = join(dir, '.export.tar');
      execFileSync('git', ['archive', '--format=tar', '-o', tar, ref, ...paths], { cwd: ROOT });
      execFileSync('tar', ['-xf', tar, '-C', dir]);
      rmSync(tar);
    },
    // What the checkout has that this commit has not, within the allowlist.
    // Informational: it is precisely what the package leaves out.
    differs: () => changed(ref),
  };
}

/** The checkout as the source, uncommitted changes included. */
export function worktreeSource() {
  return {
    label: 'the working tree',
    read: (path) => readFileSync(join(ROOT, path), 'utf8'),
    exportTo(paths, dir) {
      for (const p of paths) cpSync(join(ROOT, p), join(dir, p), { recursive: true, filter: noJunk });
    },
    differs: () => changed('HEAD'),
  };
}

function changed(ref) {
  const paths = [...SHARED, ...Object.values(TARGETS).map((t) => t.manifest)];
  const status = gitRaw('status', '--porcelain', '--', ...paths).split('\n').map((l) => l.slice(3));
  const diff = git('diff', '--name-only', ref, '--', ...paths).split('\n');
  return [...new Set([...status, ...diff].filter(Boolean))].sort();
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Compares the two manifests. Returns the complaints; empty means they agree. */
export function check(source = gitSource()) {
  const m = {};
  for (const [target, { manifest }] of Object.entries(TARGETS)) m[target] = JSON.parse(source.read(manifest));
  const problems = [];
  for (const key of SHARED_KEYS) {
    if (!same(m.chrome[key], m.firefox[key])) problems.push(`${key}: Chrome has ${JSON.stringify(m.chrome[key])}, Firefox has ${JSON.stringify(m.firefox[key])}`);
  }
  for (const target of Object.keys(TARGETS)) {
    for (const key of Object.keys(m[target])) {
      if (!SHARED_KEYS.includes(key) && !OWN_KEYS[target].includes(key)) problems.push(`${key} in the ${target} manifest is unknown to dev/package.mjs`);
    }
  }
  if (!m.chrome.background?.service_worker) problems.push('the Chrome manifest needs background.service_worker');
  if (!Array.isArray(m.firefox.background?.scripts)) problems.push('the Firefox manifest needs background.scripts: Firefox has no service worker');
  if (!m.firefox.browser_specific_settings?.gecko?.id) problems.push('browser_specific_settings.gecko.id is missing: AMO requires it');
  return problems;
}

/** Every path the manifest and player.html point at, relative to the package. */
function references(dir) {
  const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  const refs = [
    m.background?.service_worker, ...(m.background?.scripts || []),
    ...Object.values(m.icons || {}), ...Object.values(m.action?.default_icon || {}),
  ];
  const html = readFileSync(join(dir, 'player.html'), 'utf8');
  for (const [, path] of html.matchAll(/(?:src|href)="([^"]+)"/g)) refs.push(path);
  return [...new Set(refs.filter((p) => p && !/^(https?:|data:|#)/.test(p)))];
}

function listFiles(dir) {
  const files = [];
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const path = join(d, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (noJunk(path)) files.push(relative(dir, path));
    }
  };
  walk(dir);
  return files.sort();
}

/** Assembles dist/<target>/ and verifies it. */
export function build(target, source = gitSource()) {
  if (!TARGETS[target]) throw new Error(`unknown target ${target}; the choices are ${Object.keys(TARGETS).join(' and ')}`);
  const problems = check(source);
  if (problems.length) throw new Error('the manifests disagree:\n  ' + problems.join('\n  '));
  const { manifest } = TARGETS[target];
  const dir = join(DIST, target);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  source.exportTo([...SHARED, manifest], dir);
  if (manifest !== 'manifest.json') {
    renameSync(join(dir, manifest), join(dir, 'manifest.json'));
    rmSync(join(dir, dirname(manifest)), { recursive: true });
  }
  const files = listFiles(dir);
  const missing = references(dir).filter((p) => !files.includes(p));
  if (missing.length) throw new Error(`${target}: the manifest or player.html refers to files the package lacks:\n  ` + missing.join('\n  '));
  const bytes = files.reduce((n, f) => n + statSync(join(dir, f)).size, 0);
  const { version } = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  return { target, dir, files, bytes, version };
}

const zipEntries = (path) => execFileSync('unzip', ['-Z1', path], { encoding: 'utf8' }).split('\n').filter((l) => l && !l.endsWith('/')).sort();

/** The previous package of the same browser in the project root, newest first. */
function previousZip(target, except) {
  const pattern = target === 'chrome' ? /^kepuli-tv-(chrome-)?\d[\w.-]*\.zip$/ : new RegExp(`^kepuli-tv-${target}-\\d[\\w.-]*\\.zip$`);
  return readdirSync(ROOT)
    .filter((f) => pattern.test(f) && f !== except && !f.endsWith('-amo-source.zip'))
    .map((f) => ({ f, mtime: statSync(join(ROOT, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0]?.f;
}

/** dist/<target>/ zipped into the project root, and compared with the last one. */
export function zip({ target, dir, files, version }) {
  const name = `kepuli-tv-${target}-${version}.zip`;
  const out = join(ROOT, name);
  rmSync(out, { force: true });
  execFileSync('zip', ['-rqX', out, '.', '-x', '*.DS_Store'], { cwd: dir });
  const entries = zipEntries(out);
  if (!same(entries, files)) throw new Error(`${name} does not contain exactly the files of ${relative(ROOT, dir)}`);
  const previous = previousZip(target, name);
  let added = [], removed = [];
  if (previous) {
    const before = zipEntries(join(ROOT, previous));
    added = entries.filter((f) => !before.includes(f));
    removed = before.filter((f) => !entries.includes(f));
  }
  return { name, bytes: statSync(out).size, previous, added, removed };
}

const kb = (n) => `${Math.round(n / 1024)} kB`;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const flag = (f) => args.includes(f);
  const ref = args.includes('--ref') ? args[args.indexOf('--ref') + 1] : 'HEAD';
  const targets = args.filter((a) => TARGETS[a]);
  const unknown = args.filter((a, i) => !TARGETS[a] && !['--zip', '--check', '--worktree', '--ref'].includes(a) && args[i - 1] !== '--ref');
  try {
    if (unknown.length) throw new Error(`unknown argument ${unknown.join(' ')}`);
    const source = flag('--worktree') ? worktreeSource() : gitSource(ref);
    if (flag('--check')) {
      const problems = check(source);
      if (problems.length) throw new Error('the manifests disagree:\n  ' + problems.join('\n  '));
      console.log(`the manifests agree in ${source.label}`);
      process.exit(0);
    }
    const differs = source.differs();
    if (differs.length) {
      console.log(flag('--worktree')
        ? `uncommitted changes go into the package: ${differs.join(', ')}`
        : `left out, uncommitted in the checkout: ${differs.join(', ')}`);
    }
    for (const target of targets.length ? targets : Object.keys(TARGETS)) {
      const built = build(target, source);
      console.log(`${target.padEnd(8)} from ${source.label}  ${built.files.length} files  ${kb(built.bytes)}  version ${built.version}  → ${relative(ROOT, built.dir)}/`);
      if (flag('--zip')) {
        const z = zip(built);
        let vs = z.previous ? `  vs ${z.previous}: ` : '';
        if (z.previous) vs += [...z.added.map((f) => '+' + f), ...z.removed.map((f) => '-' + f)].join(' ') || 'same files';
        console.log(`${''.padEnd(8)} ${z.name}  ${kb(z.bytes)}${vs}`);
      }
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
