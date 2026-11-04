#!/usr/bin/env node
// The third-party files in vendor/ are the ones that were reviewed: every
// file's SHA-256 against vendor/CHECKSUMS, which also names the upstream
// version each file is.
//
//   node dev/vendorcheck.mjs            check; exit code 0 when everything matches, 1 otherwise
//   node dev/vendorcheck.mjs --update   rewrite vendor/CHECKSUMS from the files as they are
//
// vendor/ is minified code nobody reads line by line, shipped to both
// stores, and AMO compares it with the upstream release it claims to be.
// A file changed by accident (an editor's reformat, a merge, a half-done
// upgrade) or slipped in beside the others would otherwise go unnoticed
// until a reviewer finds it. So the check fails on a changed hash, a
// listed file that is gone, and a file that is not listed at all.
//
// The version is read from the files themselves where they carry it (the
// minified builds keep their version string in the code, not in a header
// comment), and for ffaudio from dev/wasm/build.sh, which is what built it.
// The check also compares that version with the listed one, so upgrading a
// library without updating CHECKSUMS fails twice over, and --update refuses
// a new file whose version it cannot tell: add a rule to VERSIONS first.
//
// --update is for a deliberate upgrade only (vendor/AGENTS.md): drop the
// new upstream build in whole, run --update, and say in the commit which
// version it is and where it came from.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = join(ROOT, 'vendor');
const CHECKSUMS = join(VENDOR, 'CHECKSUMS');

// The repository's own files in vendor/: the guides and the list itself.
const OWN = /^(AGENTS\.md|CLAUDE\.md|CHECKSUMS)$|(^|\/)\.DS_Store$/;

/** One pattern that must match exactly once in the text; its first group is the version. */
function only(text, pattern, what) {
  const found = [...text.matchAll(new RegExp(pattern.source, 'g'))];
  if (found.length !== 1) throw new Error(`${what}: the version string was found ${found.length} times, expected once`);
  return found[0][1];
}

// How the upstream version of each file is told. The FFmpeg build's
// licence files belong to the build and carry its version.
function ffmpegBuild() {
  const script = readFileSync(join(ROOT, 'dev', 'wasm', 'build.sh'), 'utf8');
  const tag = script.match(/^FFMPEG_TAG=\$\{KEPULI_FFMPEG_TAG:-([\w.-]+)\}$/m)?.[1];
  const emsdk = script.match(/^EMSDK_VERSION=([\w.-]+)$/m)?.[1];
  if (!tag || !emsdk) throw new Error('dev/wasm/build.sh: FFMPEG_TAG or EMSDK_VERSION not found');
  return `FFmpeg ${tag}, Emscripten ${emsdk} (dev/wasm/build.sh)`;
}
const VERSIONS = {
  // var ta="1.6.5",ra={},ia=0, … : hls.js's own version constant.
  'hls.js': (text) => 'hls.js ' + only(text, /var \w+="(\d+\.\d+\.\d+)",\w+=\{\},\w+=0,/, 'hls.js'),
  // Object.defineProperty(O,"version",{… return"1.8.0"}): mpegts.version.
  'mpegts.js': (text) => 'mpegts.js ' + only(text, /"version",\{enumerable:!0,get:function\(\)\{return"(\d+\.\d+\.\d+)"\}/, 'mpegts.js'),
  'ffaudio/ffaudio.js': ffmpegBuild,
  'ffaudio/ffaudio.wasm': ffmpegBuild,
  'ffaudio/COPYING.LGPLv2.1': ffmpegBuild,
  'ffaudio/LICENSE': ffmpegBuild,
};

function vendorFiles(dir = VENDOR, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    const rel = relative(VENDOR, path).split('\\').join('/');
    if (OWN.test(rel)) continue;
    if (entry.isDirectory()) vendorFiles(path, found);
    else found.push(rel);
  }
  return found.sort();
}

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

/** The upstream version of a vendor file, or throws if no rule tells it. */
function versionOf(file) {
  const rule = VERSIONS[file];
  if (!rule) throw new Error(`vendor/${file}: no rule in dev/vendorcheck.mjs tells its upstream version; add one to VERSIONS`);
  return rule(readFileSync(join(VENDOR, file), 'latin1'));
}

/** vendor/CHECKSUMS as { file: { hash, version } }; lines are "<sha256>  <file>  <version>". */
export function parseChecksums(text) {
  const entries = {};
  const problems = [];
  text.split('\n').forEach((line, i) => {
    if (!line.trim() || line.startsWith('#')) return;
    const m = line.match(/^([0-9a-f]{64})  (\S+)  (.+)$/);
    if (!m) { problems.push(`vendor/CHECKSUMS line ${i + 1} is not "<sha256>  <file>  <version>"`); return; }
    if (entries[m[2]]) problems.push(`vendor/CHECKSUMS lists ${m[2]} twice`);
    entries[m[2]] = { hash: m[1], version: m[3] };
  });
  return { entries, problems };
}

/** Compares vendor/ with vendor/CHECKSUMS. Returns the complaints; empty means they agree. */
export function check() {
  let text;
  try { text = readFileSync(CHECKSUMS, 'utf8'); }
  catch { return ['vendor/CHECKSUMS is missing: write it with node dev/vendorcheck.mjs --update after checking the files'] }
  const { entries, problems } = parseChecksums(text);
  const files = vendorFiles();
  for (const file of files) {
    const listed = entries[file];
    if (!listed) { problems.push(`vendor/${file} is not in vendor/CHECKSUMS`); continue; }
    if (sha256(join(VENDOR, file)) !== listed.hash) problems.push(`vendor/${file} has changed: its SHA-256 is not the one in vendor/CHECKSUMS`);
    try {
      const version = versionOf(file);
      if (version !== listed.version) problems.push(`vendor/${file} is ${version}, vendor/CHECKSUMS says ${listed.version}`);
    } catch (err) { problems.push(err.message); }
  }
  for (const file of Object.keys(entries)) if (!files.includes(file)) problems.push(`vendor/CHECKSUMS lists ${file}, which is not in vendor/`);
  return problems;
}

function update() {
  const lines = vendorFiles().map((file) => `${sha256(join(VENDOR, file))}  ${file}  ${versionOf(file)}`);
  writeFileSync(CHECKSUMS, [
    '# The SHA-256 of every third-party file in vendor/ and the upstream version it is.',
    '# Checked by node dev/vendorcheck.mjs (CI, dev/release.mjs); rewritten only for a',
    '# deliberate upgrade with node dev/vendorcheck.mjs --update. See vendor/AGENTS.md.',
    ...lines, '',
  ].join('\n'));
  return lines.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a !== '--update');
  if (unknown.length) { console.error(`unknown argument ${unknown.join(' ')}`); process.exit(1); }
  try {
    if (args.includes('--update')) {
      console.log(`vendor/CHECKSUMS written: ${update()} files`);
      process.exit(0);
    }
    const problems = check();
    for (const p of problems) console.log(`FAIL  ${p}`);
    console.log(problems.length ? `${problems.length} problem(s) in vendor/` : `vendor/ is as listed in vendor/CHECKSUMS (${vendorFiles().length} files)`);
    process.exit(problems.length ? 1 : 0);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
