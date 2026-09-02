#!/usr/bin/env node
// The Firefox package, assembled from the shared source.
//
// The player is one codebase. Everything under js/, css/, vendor/ and
// icons/, with player.html and background.js, runs in both browsers as it
// is — js/browser.js holds the one line that differs. Only the manifest is
// Firefox's own (background.scripts in place of the service worker,
// browser_specific_settings, no minimum_chrome_version), and it lives in
// this directory. This script copies the shared files next to it into
// firefox/dist/, which is what Firefox loads and what the zip is made of.
//
//   node firefox/build.mjs            → firefox/dist/
//   node firefox/build.mjs --zip      … and kepuli-tv-firefox-<version>.zip in the project root
//   node firefox/build.mjs --check    the manifest comparison alone, for the release checklist
//
// The two manifests are compared on every run: the version and every key
// that is not browser-specific must agree, or the build stops. That is what
// keeps the Firefox package from quietly falling behind the Chrome one when
// the manifest changes. No dependencies; the zip comes from the system's
// own zip, as the Chrome package does.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '..');
export const DIST = join(HERE, 'dist');

// What the Chrome package ships, minus its manifest. The same list, so the
// two packages cannot drift apart in content either.
const SHARED = ['player.html', 'background.js', 'js', 'css', 'vendor', 'icons'];

// Keys the two manifests must agree on. The rest is browser-specific:
// background, minimum_chrome_version, browser_specific_settings.
const SHARED_KEYS = ['manifest_version', 'name', 'version', 'description', 'content_security_policy',
                     'permissions', 'optional_host_permissions', 'action', 'icons'];

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Compares firefox/manifest.json with the root manifest. Returns the list
 * of complaints; empty means they agree.
 */
export function check() {
  const chrome = readJson(join(ROOT, 'manifest.json'));
  const firefox = readJson(join(HERE, 'manifest.json'));
  const problems = [];
  for (const key of SHARED_KEYS) {
    if (!same(chrome[key], firefox[key])) problems.push(`${key}: Chrome has ${JSON.stringify(chrome[key])}, Firefox has ${JSON.stringify(firefox[key])}`);
  }
  if (!firefox.background || !Array.isArray(firefox.background.scripts)) problems.push('background.scripts is missing: Firefox has no service_worker');
  if (firefox.minimum_chrome_version) problems.push('minimum_chrome_version belongs to the Chrome manifest only');
  const gecko = firefox.browser_specific_settings && firefox.browser_specific_settings.gecko;
  if (!gecko || !gecko.id) problems.push('browser_specific_settings.gecko.id is missing: AMO requires it');
  // Every key in the Chrome manifest must be accounted for somewhere.
  for (const key of Object.keys(chrome)) {
    if (!SHARED_KEYS.includes(key) && !['background', 'minimum_chrome_version'].includes(key)) {
      problems.push(`${key} is new in the Chrome manifest and unknown to this script`);
    }
  }
  return problems;
}

/** Copies the shared files and the Firefox manifest into firefox/dist/. */
export function build() {
  const problems = check();
  if (problems.length) throw new Error('the manifests disagree:\n  ' + problems.join('\n  '));
  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(DIST, { recursive: true });
  const skip = (path) => !/(^|\/)\.DS_Store$/.test(path);
  for (const name of SHARED) {
    const from = join(ROOT, name);
    if (!existsSync(from)) throw new Error(`${name} is missing from the project root`);
    cpSync(from, join(DIST, name), { recursive: true, filter: skip });
  }
  cpSync(join(HERE, 'manifest.json'), join(DIST, 'manifest.json'));
  return summarise(DIST);
}

function summarise(dir) {
  let files = 0, bytes = 0;
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const path = join(d, entry.name);
      if (entry.isDirectory()) walk(path);
      else { files++; bytes += statSync(path).size; }
    }
  };
  walk(dir);
  return { files, bytes, version: readJson(join(dir, 'manifest.json')).version };
}

/** The package for AMO: firefox/dist/ zipped, named like the Chrome one. */
export function zip() {
  const { version } = summarise(DIST);
  const out = join(ROOT, `kepuli-tv-firefox-${version}.zip`);
  rmSync(out, { force: true });
  execFileSync('zip', ['-rq', out, '.', '-x', '*.DS_Store'], { cwd: DIST });
  return { out, bytes: statSync(out).size };
}

const kb = (n) => `${Math.round(n / 1024)} kB`;

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = new Set(process.argv.slice(2));
  try {
    if (args.has('--check')) {
      const problems = check();
      if (problems.length) { console.error('the manifests disagree:\n  ' + problems.join('\n  ')); process.exit(1); }
      console.log('firefox/manifest.json agrees with manifest.json');
      process.exit(0);
    }
    const { files, bytes, version } = build();
    console.log(`firefox/dist  ${files} files  ${kb(bytes)}  version ${version}`);
    if (args.has('--zip')) {
      const { out, bytes: size } = zip();
      console.log(`${out.slice(ROOT.length + 1)}  ${kb(size)}`);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
