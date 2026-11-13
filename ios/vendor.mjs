#!/usr/bin/env node
// The Google Cast sender SDK, fetched into ios/vendor/ and checked.
//
//   node ios/vendor.mjs            download (when missing, or when another archive than the pinned one is there), verify, unpack, check
//   node ios/vendor.mjs --check    the checks alone, on what is already there
//
// The SDK is proprietary, so it is not committed: ios/vendor/ is git-ignored
// and ios/build.mjs runs this when the directory is empty. The archive is
// pinned by its SHA-256, and what the app relies on is checked after the
// unpacking, so that a later SDK version fails here and not at an upload:
// the binary links system libraries and the Swift runtime only (Google's
// documentation asks for Protobuf, which this dynamic build carries inside),
// it has no bitcode segment, it brings its own privacy manifest, it runs on
// iOS 16 and it has an arm64 simulator slice. The framework's own Info.plist
// says 4.8.3; that is Google's. The archive's NutritionLabel.txt comes too:
// Google's own word on what this version collects, which names more than
// the privacy manifest does and which the App Store's label is held to
// (ios/release.mjs status).

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const VENDOR = join(HERE, 'vendor');
export const FRAMEWORK = join(VENDOR, 'GoogleCast.xcframework');
export const NUTRITION = join(VENDOR, 'NutritionLabel', 'NutritionLabel.txt');

const VERSION = '4.8.6';
const NAME = `GoogleCastSDK-ios-${VERSION}_dynamic`;
const URL = `https://dl.google.com/dl/chromecast/sdk/ios/${NAME}.zip`;
const SHA256 = '55f6c21291a1315c68063f07e7d76225564bff70f2fd38caad135c71d66eb310';

const run = (command, ...args) => execFileSync(command, args, { encoding: 'utf8', maxBuffer: 64 << 20 });

// Which archive ios/vendor/ was unpacked from: its SHA-256, written last.
// The SDK does not say (the 4.8.6 framework calls itself 4.8.3), and
// without it a newly pinned version was reported as checked, and built
// with, while the old one still lay there.
const PINNED = join(VENDOR, 'pinned.sha256');
const unpackedFrom = () => (existsSync(PINNED) ? readFileSync(PINNED, 'utf8').trim() : '');

/**
 * Whether the parts the project refers to are in ios/vendor/, from the
 * archive pinned above. A directory unpacked before the privacy details
 * were kept lacks them, and is fetched over.
 */
export const present = () => existsSync(join(FRAMEWORK, 'Info.plist')) && existsSync(join(VENDOR, 'OpenSourceLicenses')) && existsSync(NUTRITION) && unpackedFrom() === SHA256;

async function fetchAndUnpack() {
  const response = await fetch(URL);
  if (!response.ok) throw new Error(`${URL} answered ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const sum = createHash('sha256').update(bytes).digest('hex');
  if (sum !== SHA256) throw new Error(`the Cast SDK archive's SHA-256 is ${sum}, not the pinned ${SHA256}`);
  const scratch = mkdtempSync(join(tmpdir(), 'kepuli-cast-'));
  try {
    writeFileSync(join(scratch, 'sdk.zip'), bytes);
    run('unzip', '-q', join(scratch, 'sdk.zip'), '-d', scratch);
    rmSync(VENDOR, { recursive: true, force: true });
    mkdirSync(VENDOR, { recursive: true });
    for (const part of ['GoogleCast.xcframework', 'OpenSourceLicenses', 'NutritionLabel']) {
      // verbatimSymlinks: a framework's links are relative and must stay so.
      cpSync(join(scratch, `${NAME}_xcframework`, part), join(VENDOR, part), { recursive: true, verbatimSymlinks: true });
    }
    // Last, so that an unpacking that was interrupted is not taken for whole.
    writeFileSync(PINNED, `${SHA256}\n`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** What the design relies on in the SDK. Returns the complaints; empty means it holds. */
export function check() {
  if (existsSync(join(FRAMEWORK, 'Info.plist')) && unpackedFrom() !== SHA256) return [`ios/vendor/ holds another archive than the pinned ${VERSION}: run node ios/vendor.mjs`];
  if (existsSync(join(FRAMEWORK, 'Info.plist')) && !existsSync(NUTRITION)) return ['ios/vendor/ lacks the SDK\'s NutritionLabel.txt (it was unpacked before that was kept): run node ios/vendor.mjs'];
  if (!present()) return ['ios/vendor/ has no Cast SDK: run node ios/vendor.mjs'];
  const problems = [];
  const plist = (file) => JSON.parse(run('plutil', '-convert', 'json', '-o', '-', file));
  const slices = plist(join(FRAMEWORK, 'Info.plist')).AvailableLibraries;
  const simulator = slices.find((s) => s.SupportedPlatformVariant === 'simulator');
  if (!simulator || !simulator.SupportedArchitectures.includes('arm64')) problems.push('no arm64 simulator slice');
  if (!slices.some((s) => s.SupportedPlatform === 'ios' && !s.SupportedPlatformVariant)) problems.push('no device slice');
  for (const slice of slices) {
    const framework = join(FRAMEWORK, slice.LibraryIdentifier, slice.LibraryPath);
    const binary = join(framework, 'GoogleCast');
    const where = slice.LibraryIdentifier;
    // otool heads each architecture's list with the file's own path; the
    // libraries are the indented lines.
    const foreign = run('otool', '-L', binary).split('\n').filter((line) => line.startsWith('\t'))
      .map((line) => line.trim().split(' ')[0])
      .filter((lib) => !/^(\/System\/Library\/Frameworks\/|\/usr\/lib\/|@rpath\/GoogleCast\.framework\/)/.test(lib));
    if (foreign.length) problems.push(`${where}: links ${[...new Set(foreign)].join(', ')}, which the app does not carry`);
    if (/segname __LLVM/.test(run('otool', '-l', binary))) problems.push(`${where}: has a bitcode segment, which the App Store refuses`);
    if (!existsSync(join(framework, 'PrivacyInfo.xcprivacy'))) problems.push(`${where}: no PrivacyInfo.xcprivacy`);
    const minimum = plist(join(framework, 'Info.plist')).MinimumOSVersion;
    if (minimum !== '16.0') problems.push(`${where}: MinimumOSVersion is ${minimum}, expected 16.0`);
  }
  return problems;
}

/** Fetches the SDK when it is missing and checks it; throws on a complaint. */
export async function vendor() {
  if (!present()) await fetchAndUnpack();
  const problems = check();
  if (problems.length) throw new Error('the Cast SDK is not what the app expects:\n  ' + problems.join('\n  '));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.includes('--check')) {
      const problems = check();
      if (problems.length) throw new Error(problems.join('\n'));
    } else {
      await vendor();
    }
    console.log(`ios/vendor  Google Cast ${VERSION} (dynamic), checked`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
