#!/usr/bin/env node
// The iOS app, prepared and built from the shared source.
//
//   node ios/build.mjs                  prepare: everything Xcode needs, and the project itself
//   node ios/build.mjs --simulator      … and build Debug for the simulator (ios/sim.mjs install does this)
//   node ios/build.mjs --simulator --configuration Release
//   node ios/build.mjs --test           … and run the XCTest target on kepuli-ios-iphone
//   node ios/build.mjs --extension      the extension copy alone (Xcode's own pre-build phase)
//   --build <n>   the build number's last part (or KEPULI_IOS_BUILD; default 1): a second upload of a version takes 2
//   --release     a language without the local-network sentence fails the build instead of taking the English
//
// The app is a WKWebView on a WKWebExtensionController showing the same
// player the browsers run. Nothing generated is committed; it all goes to
// ios/dist/, as firefox/dist/ is Firefox's:
//   1. extension/       firefox/dist/ (firefox/build.mjs, which also refuses when the two
//                       manifests disagree) without background.js, with the manifest rewritten
//   2. Version.xcconfig the version from the root manifest, the build number, the Node that ran this
//   3. Icon.xcassets    the opaque app icon (ios/icon.swift)
//   4. Localized/       <language>.lproj/InfoPlist.strings from the key ios.localnetwork
//   5. Info.plist and ../KepuliTV.xcodeproj, by xcodegen from ios/project.yml; derived/ is xcodebuild's
//
// The package is Firefox's, not Chrome's: in WebKit a manifest with
// background.service_worker never starts its background and reports no
// error (measured in the spike), so step 1 refuses one.
//
// THE BACKGROUND PAGE. The iOS manifest has no "background" at all, and
// background.js is not shipped: its jobs (the toolbar click, the uninstall
// address, the update notice, reminders while no player is open) belong to
// a browser, and the app has native code for the last. Measured on iOS 26.5
// and 18.5 (2026-11-13): without the key the extension loads with no
// extension or context error, the page runs, storage.local, permissions and
// the native port work. Should a later WebKit refuse a manifest without it,
// the fallback is to keep "background": {"scripts": ["background.js"]}, ship
// the file and call context.loadBackgroundContent in ExtensionHost.swift.
//
// No dependencies beyond Xcode and xcodegen (brew install xcodegen), which
// stay confined to this directory.

import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build as firefoxBuild, DIST as FIREFOX_DIST, ROOT } from '../firefox/build.mjs';
import { present as vendorPresent, vendor } from './vendor.mjs';

export const IOS = dirname(fileURLToPath(import.meta.url));
export const DIST = join(IOS, 'dist');
export const DERIVED = join(DIST, 'derived');
export const PROJECT = join(IOS, 'KepuliTV.xcodeproj');
export const SCHEME = 'KepuliTV';
// Debug has an identifier of its own, so a development build sits beside
// the App Store's app with its own container.
export const BUNDLE = { Debug: 'io.github.bigtimesam.kepulitv.debug', Release: 'io.github.bigtimesam.kepulitv' };

const EXTENSION = join(DIST, 'extension');
// The page's language codes are the .lproj names, except where iOS wants
// the variety spelled out: the Portuguese here is Brazil's and the Serbian
// is written in Latin script (js/i18n.js says the same to the page).
const LPROJ = { pt: 'pt-BR', sr: 'sr-Latn' };
const LOCAL_NETWORK = 'ios.localnetwork';

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
/** Writes only when the content differs, so an unchanged input does not make Xcode rebuild. */
function writeIfChanged(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path) || readFileSync(path, 'utf8') !== text) writeFileSync(path, text);
}

/** Step 1: ios/dist/extension/, the Firefox package made into the app's. */
export function extension() {
  firefoxBuild();
  rmSync(EXTENSION, { recursive: true, force: true });
  cpSync(FIREFOX_DIST, EXTENSION, { recursive: true, filter: (path) => path !== join(FIREFOX_DIST, 'background.js') });
  const manifest = readJson(join(EXTENSION, 'manifest.json'));
  delete manifest.browser_specific_settings;
  delete manifest.background;
  // "notifications" is the only one; reminders are local notifications from
  // native code here (App/Services/Reminders.swift).
  delete manifest.optional_permissions;
  manifest.permissions = [...manifest.permissions, 'nativeMessaging'];
  writeFileSync(join(EXTENSION, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  const written = readJson(join(EXTENSION, 'manifest.json'));
  if (written.background) throw new Error('the iOS manifest still has a background: a service worker never starts in WebKit');
  if (!written.permissions.includes('nativeMessaging')) throw new Error('the iOS manifest lacks nativeMessaging: the page could not reach the app');
  if (!existsSync(join(EXTENSION, '_locales'))) throw new Error('ios/dist/extension has no _locales/: the manifest names default_locale');
  if (existsSync(join(EXTENSION, 'background.js'))) throw new Error('background.js was copied into the app');
  return written.version;
}

/** The app's version and build number: 1.13.0 with build 1 gives 11300.1. */
export function version(build = Number(process.env.KEPULI_IOS_BUILD || 1)) {
  const marketing = readJson(join(ROOT, 'manifest.json')).version;
  const [major, minor, patch] = marketing.split('.').map(Number);
  if (![major, minor, patch, build].every(Number.isInteger) || build < 1) throw new Error(`cannot number version ${marketing} build ${build}`);
  return { marketing, build: `${major * 10000 + minor * 100 + patch}.${build}` };
}

/** The strings of step 4, by .lproj name; `missing` are the languages that took the English. */
async function localNetworkTexts() {
  const { LANGUAGES, loadLanguage, setLanguage, keysOf, t } = await import('../js/i18n.js');
  const texts = {};
  const missing = [];
  for (const lang of Object.keys(LANGUAGES)) {
    await loadLanguage(lang);
    const has = keysOf(lang).includes(LOCAL_NETWORK);
    if (!has) missing.push(lang);
    setLanguage(has ? lang : 'en');
    texts[LPROJ[lang] || lang] = t(LOCAL_NETWORK);
  }
  if (texts.en === LOCAL_NETWORK) throw new Error(`js/i18n.js has no ${LOCAL_NETWORK}`);
  return { texts, missing };
}

/** Steps 2 and 4: the build settings and the localised Info.plist strings. */
async function settingsAndStrings({ build, release }) {
  const { texts, missing } = await localNetworkTexts();
  if (missing.length && release) throw new Error(`${LOCAL_NETWORK} is missing in: ${missing.join(', ')}`);
  if (missing.length) console.log(`ios: ${LOCAL_NETWORK} is English for now in ${missing.join(', ')}`);

  const { marketing, build: number } = version(build);
  // KEPULI_LOCAL_NETWORK is the English sentence, for the Info.plist's own
  // value (the .lproj files below override it per language), so that the
  // text has one source, js/i18n.js.
  writeIfChanged(join(DIST, 'Version.xcconfig'), [
    '// Generated by ios/build.mjs.',
    `MARKETING_VERSION = ${marketing}`,
    `CURRENT_PROJECT_VERSION = ${number}`,
    `KEPULI_NODE = ${process.execPath}`,
    `KEPULI_LOCAL_NETWORK = ${texts.en}`,
    '',
  ].join('\n'));

  const localized = join(DIST, 'Localized');
  const wanted = new Set(Object.keys(texts).map((code) => `${code}.lproj`));
  if (existsSync(localized)) {
    for (const name of readdirSync(localized)) if (!wanted.has(name)) rmSync(join(localized, name), { recursive: true });
  }
  const quoted = (text) => text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  for (const [code, text] of Object.entries(texts)) {
    writeIfChanged(join(localized, `${code}.lproj`, 'InfoPlist.strings'), `"NSLocalNetworkUsageDescription" = "${quoted(text)}";\n`);
  }

  // The Info.plist names the languages too (project.yml); the two lists
  // must be the same, or a language's dialogs fall back to English.
  const block = /CFBundleLocalizations:\n((?:\s+- .+\n)+)/.exec(readFileSync(join(IOS, 'project.yml'), 'utf8'));
  const declared = block ? [...block[1].matchAll(/- (\S+)/g)].map((m) => m[1]).sort() : [];
  const codes = Object.keys(texts).sort();
  if (declared.join() !== codes.join()) {
    throw new Error(`CFBundleLocalizations in ios/project.yml is not the page's languages: it should be ${codes.join(', ')}`);
  }
  return { marketing, number };
}

/** Step 3: the icon, drawn again only when the master or the script changed. */
function icon() {
  const master = join(ROOT, 'brand', 'tv-master-1024.png');
  const script = join(IOS, 'icon.swift');
  const set = join(DIST, 'Icon.xcassets', 'AppIcon.appiconset');
  const out = join(set, 'AppIcon.png');
  writeIfChanged(join(DIST, 'Icon.xcassets', 'Contents.json'), JSON.stringify({ info: { author: 'xcode', version: 1 } }, null, 2) + '\n');
  writeIfChanged(join(set, 'Contents.json'), JSON.stringify({
    images: [{ filename: 'AppIcon.png', idiom: 'universal', platform: 'ios', size: '1024x1024' }],
    info: { author: 'xcode', version: 1 },
  }, null, 2) + '\n');
  if (existsSync(out) && [master, script].every((input) => statSync(input).mtimeMs < statSync(out).mtimeMs)) return;
  execFileSync('xcrun', ['swift', script, master, out], { stdio: ['ignore', 'inherit', 'inherit'] });
  if (!/hasAlpha: no/.test(execFileSync('sips', ['-g', 'hasAlpha', out], { encoding: 'utf8' }))) {
    throw new Error('the app icon has an alpha channel, which the App Store refuses');
  }
}

/** Everything xcodebuild needs: the Cast SDK, steps 1 to 4, and the project. */
export async function prepare({ build, release = false } = {}) {
  if (!vendorPresent()) await vendor();
  extension();
  const numbers = await settingsAndStrings({ build, release });
  icon();
  try {
    execFileSync('xcodegen', ['generate', '--quiet', '--spec', join(IOS, 'project.yml'), '--project', IOS], { stdio: ['ignore', 'inherit', 'inherit'] });
  } catch (err) {
    throw new Error(err.code === 'ENOENT' ? 'xcodegen is not installed: brew install xcodegen' : 'xcodegen failed');
  }
  return numbers;
}

/**
 * xcodebuild on the generated project, with the scheme and DerivedData in
 * ios/dist/derived. KEPULI_PREPARED tells the project's pre-build phase
 * that step 1 has just run, so it is not run twice.
 */
export function xcodebuild(...args) {
  const testing = args.includes('test');
  // A build is quiet but for warnings and errors. A test run is not, or it
  // would not say what ran: its lines about tests are kept and the rest dropped.
  const result = spawnSync('xcodebuild', [...(testing ? [] : ['-quiet']), '-project', PROJECT, '-scheme', SCHEME, '-derivedDataPath', DERIVED, ...args, 'KEPULI_PREPARED=YES'],
    { stdio: ['ignore', testing ? 'pipe' : 'inherit', 'inherit'], encoding: 'utf8', maxBuffer: 256 << 20 });
  if (testing) {
    console.log(result.stdout.split('\n').filter((line) => /^Test (Case|Suite) .* (passed|failed)|^\s+Executed \d+ tests|error:|\*\* TEST/.test(line)).join('\n'));
  }
  if (result.status !== 0) throw new Error(`xcodebuild ${testing ? 'test' : 'build'} failed`);
}

/** Where a simulator build of that configuration lands. */
export const simulatorApp = (configuration = 'Debug') => join(DERIVED, 'Build', 'Products', `${configuration}-iphonesimulator`, 'KepuliTV.app');
const stamp = (configuration) => join(DIST, `simulator-${configuration}.stamp`);

// What a build of the app is made from: the shared files the package
// copies, the two manifests, and this directory's own sources.
const INPUTS = ['player.html', 'js', 'css', 'vendor', 'icons', '_locales', 'manifest.json', 'firefox/manifest.json', 'firefox/build.mjs',
  'brand/tv-master-1024.png', 'ios/App', 'ios/project.yml', 'ios/build.mjs', 'ios/vendor.mjs', 'ios/icon.swift'];

/**
 * Whether an input changed after `time` (milliseconds). A directory's own
 * time counts as well as its files': a file removed or renamed changes
 * that and nothing else, and the build still carried it. The guides are
 * in no build.
 */
export function changedSince(time) {
  const newer = (path) => {
    if (/(^|\/)(AGENTS|CLAUDE)\.md$/.test(path)) return false;
    const stat = statSync(path);
    return stat.mtimeMs > time || (stat.isDirectory() && readdirSync(path).some((name) => newer(join(path, name))));
  };
  return INPUTS.some((input) => newer(join(ROOT, input)));
}

/** Whether an input changed since the last simulator build of that configuration. */
export function stale(configuration = 'Debug') {
  if (!existsSync(stamp(configuration)) || !existsSync(simulatorApp(configuration))) return true;
  return changedSince(statSync(stamp(configuration)).mtimeMs);
}

/** Prepares and builds the app for the simulator; returns the .app's path. */
export async function buildSimulator({ configuration = 'Debug', build, release = false } = {}) {
  const started = new Date();
  await prepare({ build, release });
  xcodebuild('-configuration', configuration, '-destination', 'generic/platform=iOS Simulator',
    `ARCHS=${process.arch === 'arm64' ? 'arm64' : 'x86_64'}`, 'build');
  // Stamped with the time the build began: a file saved while it ran makes
  // the next one stale.
  writeFileSync(stamp(configuration), '');
  utimesSync(stamp(configuration), started, started);
  return simulatorApp(configuration);
}

/** The UDID sim.mjs recorded for one of its own simulators. */
export function udid(name = process.env.KEPULI_IOS_DEVICE || 'kepuli-ios-iphone') {
  const file = join(DIST, 'devices.json');
  const id = existsSync(file) && readJson(file)[name];
  if (!id) throw new Error(`no simulator ${name}: run node ios/sim.mjs devices`);
  return id;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const value = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  const options = { build: value('--build') ? Number(value('--build')) : undefined, release: args.includes('--release') };
  try {
    if (args.includes('--extension')) {
      console.log(`ios/dist/extension  version ${extension()}`);
    } else if (args.includes('--simulator')) {
      const app = await buildSimulator({ configuration: value('--configuration') || 'Debug', ...options });
      console.log(app.slice(ROOT.length + 1));
    } else if (args.includes('--test')) {
      await prepare(options);
      // By UDID, never by name: another session may have a device of the same name.
      xcodebuild('-configuration', 'Debug', '-destination', `id=${udid()}`, 'test');
    } else {
      const { marketing, number } = await prepare(options);
      console.log(`ios/KepuliTV.xcodeproj  version ${marketing} (${number})`);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
