#!/usr/bin/env node
// The release packages, one per browser, from a committed state of the source.
//
//   node dev/package.mjs                  both packages into dist/chrome/ and dist/firefox/
//   node dev/package.mjs --zip            … and kepuli-tv-chrome-<version>.zip and
//                                         kepuli-tv-firefox-<version>.zip in the project root,
//                                         older zips moved into dist/releases/
//   node dev/package.mjs chrome --zip     one browser only
//   node dev/package.mjs --ref v1.0.4     from that commit or tag instead of HEAD
//   node dev/package.mjs --worktree       from the checkout as it is, uncommitted changes included
//   node dev/package.mjs --check          the manifest comparison and the permissions alone
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
// and every key that is not browser-specific must agree, and the
// permissions, host permissions and content security policy must be
// exactly the approved ones in APPROVED below, each with its reason. After the copy
// every file the manifest and player.html refer to must exist in the
// package. With --zip the archive is listed against the previous release of
// the same browser, from the project root or dist/releases/, so a file that
// went missing or crept in shows up before the upload; then every older
// kepuli-tv-*.zip is moved from the root into dist/releases/, so the root
// holds only the zips of the version being released.
//
// firefox/build.mjs is the development loop's copy of the same idea: it
// assembles firefox/dist/ from the checkout for firefox/dev.mjs to reload.
// Releases come from here. No dependencies; the zip comes from the
// system's own zip.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { check as checkListings, CHROME_UNSUPPORTED } from './listings.mjs';
import { problems as staleTranslations } from './translations.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DIST = join(ROOT, 'dist');

// The runtime, identical in both packages.
export const SHARED = ['player.html', 'background.js', 'js', 'css', 'vendor', 'icons', '_locales'];

// What is the browser's own: its manifest. It goes into the package as
// manifest.json whatever it is called here.
export const TARGETS = {
  chrome: { manifest: 'manifest.json' },
  firefox: { manifest: 'firefox/manifest.json' },
};

// Manifest keys the two browsers must agree on, and the keys each browser
// has of its own. A key that is neither stops the build, so a new key
// cannot land in one manifest and silently miss the other.
const SHARED_KEYS = ['manifest_version', 'name', 'default_locale', 'version', 'description', 'content_security_policy',
                     'permissions', 'optional_permissions', 'optional_host_permissions', 'action', 'icons'];
const OWN_KEYS = {
  chrome: ['background', 'minimum_chrome_version'],
  firefox: ['background', 'browser_specific_settings'],
};

// What the extension may do, with the reason for each. Both manifests'
// permissions, optional_host_permissions and content_security_policy must
// be exactly these, and Firefox's data collection declaration exactly the
// one below: a permission added to a manifest fails --check, every build
// and dev/release.mjs until its reason is written here, and one dropped
// from a manifest fails until it is dropped here. The stores ask for the
// same justification (the Chrome dashboard's permission fields, AMO's
// reviewer notes), so this is the place to write it first.
export const APPROVED = {
  permissions: {
    storage: 'settings, accounts and lists in storage.local; storage.sync only when the user turns sync on',
    unlimitedStorage: "the catalogue cache in IndexedDB (js/db.js) and recordings in OPFS outgrow the default quota with a provider's tens of thousands of entries",
    declarativeNetRequestWithHostAccess: "a Stalker portal needs a MAC cookie, a MAG User-Agent and a Referer that fetch cannot set; a session rule sets them on the portal's host alone, and only where host access was granted (js/stalker.js)",
    alarms: 'a reminder or a planned recording falls due with no player open: background.js keeps one alarm per stored list and opens the player for the recording, or says the reminder',
  },
  optional_permissions: {
    notifications: 'a reminder said while the player is closed or out of sight; optional, so that the update bringing it does not disable the extension, and asked for when the first reminder is set or in Settings (js/remindersui.js)',
  },
  optional_host_permissions: {
    'http://*/*': "the provider is the user's own server, unknown at install; one origin is asked for when its address is saved, all of them only on Allow all addresses for a redirecting stream (js/permissions.js); many providers serve plain HTTP",
    'https://*/*': 'the same, for providers on HTTPS',
  },
  content_security_policy: {
    extension_pages: {
      "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'": "only the extension's own scripts; 'wasm-unsafe-eval' for the FFmpeg audio decoder (vendor/ffaudio/ffaudio.wasm), which needs WebAssembly compilation and nothing else",
    },
  },
  firefox_data_collection: {
    authenticationInfo: "the user's credentials are sent to the service they configured, never to the developer (firefox/reviewer-notes.txt)",
  },
};

/** The approved permissions compared with one manifest. Returns the complaints. */
export function permissionProblems(target, manifest) {
  const problems = [];
  const compare = (what, actual, approved) => {
    const have = actual || [];
    if (!Array.isArray(have)) { problems.push(`${target}: ${what} is not a list`); return; }
    for (const item of have) if (!(item in approved)) problems.push(`${target}: ${what} has ${item}, which is not approved: write why it is needed in APPROVED in dev/package.mjs`);
    for (const item of Object.keys(approved)) if (!have.includes(item)) problems.push(`${target}: ${what} lacks ${item}, which APPROVED in dev/package.mjs still lists: drop it there too`);
    if (new Set(have).size !== have.length) problems.push(`${target}: ${what} names an entry twice`);
  };
  compare('permissions', manifest.permissions, APPROVED.permissions);
  compare('optional_permissions', manifest.optional_permissions, APPROVED.optional_permissions);
  compare('optional_host_permissions', manifest.optional_host_permissions, APPROVED.optional_host_permissions);
  for (const key of ['host_permissions', 'content_scripts', 'externally_connectable', 'web_accessible_resources']) {
    if (key in manifest) problems.push(`${target}: ${key} is not approved: write why it is needed in APPROVED in dev/package.mjs`);
  }
  const csp = manifest.content_security_policy || {};
  for (const key of new Set([...Object.keys(csp), ...Object.keys(APPROVED.content_security_policy)])) {
    const approved = APPROVED.content_security_policy[key] || {};
    if (!(csp[key] in approved)) problems.push(`${target}: content_security_policy.${key} is ${JSON.stringify(csp[key])}, which is not approved: write why in APPROVED in dev/package.mjs`);
  }
  if (target === 'firefox') {
    const declared = manifest.browser_specific_settings?.gecko?.data_collection_permissions || {};
    for (const key of Object.keys(declared)) if (key !== 'required') problems.push(`firefox: data_collection_permissions.${key} is not approved in dev/package.mjs`);
    compare('data_collection_permissions.required', declared.required, APPROVED.firefox_data_collection);
  }
  return problems;
}

const gitRaw = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const git = (...args) => gitRaw(...args).trim();
const noJunk = (path) => !/(^|\/)\.DS_Store$/.test(path);
// The guides for coding agents sit beside the code they describe (js/,
// css/, vendor/…), which are package directories, and so does the list of
// vendor/'s checksums (dev/vendorcheck.mjs); they are for the repository,
// not for the browser, and stay out of every package.
export const REPO_ONLY = /(^|\/)((AGENTS|CLAUDE)\.md|vendor\/CHECKSUMS)$/;
function dropRepoOnly(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) dropRepoOnly(path);
    else if (REPO_ONLY.test(path)) rmSync(path);
  }
}

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
  for (const target of Object.keys(TARGETS)) problems.push(...permissionProblems(target, m[target]));
  if (!m.chrome.background?.service_worker) problems.push('the Chrome manifest needs background.service_worker');
  if (!Array.isArray(m.firefox.background?.scripts)) problems.push('the Firefox manifest needs background.scripts: Firefox has no service worker');
  // The Chrome Web Store has twice been given the Firefox package (1.2.1,
  // 1.2.5). The Firefox manifest once carried Chrome's service_worker too,
  // so that the wrong package would still start; AMO's linter warns of it
  // on every upload, and cws-publish.mjs now refuses a package with gecko
  // settings before it reaches the store, so the key is kept out instead.
  if (m.firefox.background?.service_worker) problems.push('the Firefox manifest has background.service_worker, which Firefox ignores and AMO warns of: keep it in the Chrome manifest alone');
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
  if (problems.length) throw new Error('the manifests disagree, or ask for what is not approved:\n  ' + problems.join('\n  '));
  // The name and the short description are the store's title and summary,
  // in every language: they must be within its limits and in step with
  // store/listings/.
  const listings = checkListings();
  if (listings.length) throw new Error('the store listings:\n  ' + listings.join('\n  '));
  const { manifest } = TARGETS[target];
  const dir = join(DIST, target);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  source.exportTo([...SHARED, manifest], dir);
  dropRepoOnly(dir);
  if (manifest !== 'manifest.json') {
    renameSync(join(dir, manifest), join(dir, 'manifest.json'));
    rmSync(join(dir, dirname(manifest)), { recursive: true });
  }
  // The Chrome Web Store calls Norwegian "no", Firefox nb_NO (dev/listings.mjs).
  if (target === 'firefox' && existsSync(join(dir, '_locales', 'no'))) renameSync(join(dir, '_locales', 'no'), join(dir, '_locales', 'nb_NO'));
  // A language the Chrome Web Store has no code for (Albanian) is
  // Firefox's alone: Chrome would only skip the folder with a warning.
  if (target === 'chrome') for (const locale of CHROME_UNSUPPORTED) rmSync(join(dir, '_locales', locale), { recursive: true, force: true });
  const files = listFiles(dir);
  const missing = references(dir).filter((p) => !files.includes(p));
  if (missing.length) throw new Error(`${target}: the manifest or player.html refers to files the package lacks:\n  ` + missing.join('\n  '));
  const bytes = files.reduce((n, f) => n + statSync(join(dir, f)).size, 0);
  const { version } = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  return { target, dir, files, bytes, version };
}

const zipEntries = (path) => execFileSync('unzip', ['-Z1', path], { encoding: 'utf8' }).split('\n').filter((l) => l && !l.endsWith('/')).sort();

// Old release zips are kept, out of the way: the project root holds only
// the current version's (the ones the store tools and the GitHub release
// take), and every older kepuli-tv-*.zip goes into dist/releases/, which
// git ignores like the rest of dist/. Forty versions of three zips each had
// piled up in the root, where a tired hand picks the wrong one.
export const RELEASES = join(DIST, 'releases');

// kepuli-tv-chrome-1.6.3.zip, kepuli-tv-firefox-1.6.3-amo-source.zip,
// kepuli-tv-firefox-1.6.3-dev.zip (firefox/build.mjs), and the Chrome
// packages of 1.0.1–1.0.4, which were kepuli-tv-<version>.zip.
const ZIP_NAME = /^kepuli-tv-(?:(chrome|firefox)-)?(\d+(?:\.\d+){1,3})(-amo-source|-dev)?\.zip$/;

/** What a release zip's name says: its browser, version and kind, or null for any other file. */
export function zipName(name) {
  const m = name.match(ZIP_NAME);
  if (!m) return null;
  return { target: m[1] || 'chrome', version: m[2], kind: m[3] ? m[3].slice(1) : 'package' };
}

/** Negative, zero or positive as version a is older than, the same as or newer than b. */
export function compareVersions(a, b) {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  }
  return 0;
}

/**
 * The newest package of the same browser older than this version, from
 * the project root or dist/releases/, as a path; undefined if there is none.
 * By version, not by date: a zip moved or copied keeps no telling date, and
 * the one to compare with is the release before this one.
 */
export function previousZip(target, version, dirs = [ROOT, RELEASES]) {
  const found = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      const z = zipName(f);
      // firefox/build.mjs's -dev.zip is of the working folder and the
      // -amo-source.zip is no package; neither is a release to compare with.
      if (z && z.target === target && z.kind === 'package' && compareVersions(z.version, version) < 0) found.push({ path: join(dir, f), version: z.version });
    }
  }
  return found.sort((a, b) => compareVersions(b.version, a.version))[0]?.path;
}

/**
 * Moves every release zip older than this version from the root into
 * dist/releases/. Nothing is deleted or overwritten: a zip whose name is
 * already taken there stays where it is and is reported. Newer zips stay
 * too, so packaging an old tag with --ref leaves the current ones alone.
 */
export function shelveOlderZips(version, root = ROOT, releases = join(root, 'dist', 'releases')) {
  const moved = [], kept = [];
  for (const f of readdirSync(root).sort()) {
    const z = zipName(f);
    if (!z || compareVersions(z.version, version) >= 0) continue;
    if (existsSync(join(releases, f))) { kept.push(f); continue; }
    mkdirSync(releases, { recursive: true });
    renameSync(join(root, f), join(releases, f));
    moved.push(f);
  }
  return { moved, kept };
}

/** dist/<target>/ zipped into the project root, and compared with the last one. */
export function zip({ target, dir, files, version }) {
  const name = `kepuli-tv-${target}-${version}.zip`;
  const out = join(ROOT, name);
  rmSync(out, { force: true });
  execFileSync('zip', ['-rqX', out, '.', '-x', '*.DS_Store'], { cwd: dir });
  const entries = zipEntries(out);
  if (!same(entries, files)) throw new Error(`${name} does not contain exactly the files of ${relative(ROOT, dir)}`);
  const previous = previousZip(target, version);
  let added = [], removed = [];
  if (previous) {
    const before = zipEntries(previous);
    added = entries.filter((f) => !before.includes(f));
    removed = before.filter((f) => !entries.includes(f));
  }
  return { name, bytes: statSync(out).size, previous: previous && relative(ROOT, previous), added, removed };
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
      if (problems.length) throw new Error('the manifests disagree, or ask for what is not approved:\n  ' + problems.join('\n  '));
      console.log(`the manifests agree, with only the approved permissions, in ${source.label}`);
      process.exit(0);
    }
    // A release carries every language as of today's English: a
    // translation left behind would ship the old meaning under a new one.
    // --worktree is the development loop's, and is let through.
    const stale = flag('--worktree') ? [] : await staleTranslations();
    if (stale.length) throw new Error('translations behind the English:\n  ' + stale.join('\n  '));
    const differs = source.differs().filter((path) => !REPO_ONLY.test(path));
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
    if (flag('--zip')) {
      const { version } = JSON.parse(source.read('manifest.json'));
      const { moved, kept } = shelveOlderZips(version);
      if (moved.length) console.log(`older zips moved into ${relative(ROOT, RELEASES)}/: ${moved.join(', ')}`);
      if (kept.length) console.log(`left in the project root, as ${relative(ROOT, RELEASES)}/ already has a file of that name: ${kept.join(', ')}`);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
