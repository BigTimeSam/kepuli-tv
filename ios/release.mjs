#!/usr/bin/env node
// The iOS app's packages, and what is still missing before the App Store.
//
//   node ios/release.mjs simulator   dist/ios/kepuli-tv-ios-<version>-simulator.zip: the Release app for simulators,
//                                    started once in kepuli-ios-iphone to see that it lives and its page runs
//                                    (--no-launch leaves that out, and status then counts it as missing)
//   node ios/release.mjs archive     dist/ios/KepuliTV-<version>.xcarchive, unsigned: proof that the Release
//                                    device build links; and dist/ios/privacy-report.txt, what every privacy
//                                    manifest in it declares
//   node ios/release.mjs status      the version and build, which outputs exist and are of the source as it
//                                    stands, whether ~/.config/kepuli-tv/ios/ is complete, whether the demo
//                                    answers, whether the App Store texts are clean, within their limits and
//                                    name what the privacy report lists, whether the store's pictures are
//                                    there and its three pages answer, and the device checklist of
//                                    ios/AGENTS.md; exit 1 while anything is missing
//   --build <n>                      the build number's last part (or KEPULI_IOS_BUILD; default 1)
//
// Nothing here signs, uploads or submits, and nothing needs the owner's
// account: the machine has no signing identity, team or API key. The steps
// that need them (a device build, the signed archive, the export, the
// upload) are written out in ios/AGENTS.md as commands that have never been
// run, and become verbs here once each has succeeded once: code that has
// never run is not release tooling. The upload itself waits for the owner's
// go (AGENTS.md, rule 2).
//
// The outputs go to dist/ios/ in the project root (git-ignored), named for
// this store, so that no package can go to the wrong one.

import { execFileSync, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, readSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { ROOT } from '../firefox/build.mjs';
import { BUNDLE, IOS, buildSimulator, changedSince, prepare, version, xcodebuild } from './build.mjs';
import { boot, booted, shot, shutdown, simctl, udid } from './sim.mjs';
import { NUTRITION } from './vendor.mjs';

const OUT = join(ROOT, 'dist', 'ios');
const CONFIG = join(homedir(), '.config', 'kepuli-tv', 'ios');
const STORE_TEXTS = join(ROOT, 'store', 'appstore.txt');
const GUIDE = join(IOS, 'AGENTS.md');
const short = (path) => relative(ROOT, path);
const run = (command, args) => execFileSync(command, args, { encoding: 'utf8', maxBuffer: 256 << 20, stdio: ['ignore', 'pipe', 'pipe'] });
const plist = (file) => JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', file]));

const outputs = (marketing) => ({
  simulator: join(OUT, `kepuli-tv-ios-${marketing}-simulator.zip`),
  // Written when the Release app of the simulator package was seen to start.
  started: join(OUT, 'release-started.json'),
  archive: join(OUT, `KepuliTV-${marketing}.xcarchive`),
  privacy: join(OUT, 'privacy-report.txt'),
  // Made by the owner's procedure in ios/AGENTS.md, not by this tool: the
  // signed archive, and the package exported from it.
  signed: join(OUT, `KepuliTV-${marketing}-signed.xcarchive`),
  ipa: join(OUT, `kepuli-tv-ios-${marketing}.ipa`),
});

/** The first four bytes of a Mach-O file, thin or universal, either byte order. */
const MACH_O = new Set(['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe', 'bebafeca']);

/** Every Mach-O file in a bundle but Google's framework, which is not the app's code. */
function binaries(app) {
  const found = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) { if (path !== join(app, 'Frameworks', 'GoogleCast.framework')) walk(path); continue; }
      if (!entry.isFile()) continue;
      const head = Buffer.alloc(4), file = openSync(path, 'r');
      readSync(file, head, 0, 4, 0);
      closeSync(file);
      if (MACH_O.has(head.toString('hex'))) found.push(path);
    }
  };
  walk(app);
  return found;
}

/**
 * Refuses an app that is not the Release app of this version, or that
 * carries the debug bridge. The selector's name and the class's are both
 * too long for an optimised Swift build to keep inside an instruction (a
 * literal of fifteen bytes or fewer is, so the shorter marks prove nothing).
 * Every binary of the bundle is read, not the one named for the app: the
 * Debug app keeps its code, and both marks, in KepuliTV.debug.dylib beside
 * a stub of that name (which is the control: `debugMarks` finds them
 * there), and a Release app has no such library at all.
 */
const debugMarks = (app) => binaries(app).flatMap((binary) => {
  const text = run('strings', ['-a', binary]) + (spawnSync('nm', ['-a', binary], { encoding: 'utf8', maxBuffer: 256 << 20 }).stdout || '');
  return ['_killWebContentProcess', 'DebugBridge'].filter((mark) => text.includes(mark)).map((mark) => `${mark} in ${relative(app, binary)}`);
});

function releaseApp(app, { marketing, build }) {
  const info = plist(join(app, 'Info.plist'));
  if (info.CFBundleIdentifier !== BUNDLE.Release) throw new Error(`${short(app)} is ${info.CFBundleIdentifier}, not ${BUNDLE.Release}`);
  if (info.CFBundleShortVersionString !== marketing || info.CFBundleVersion !== build) {
    throw new Error(`${short(app)} is ${info.CFBundleShortVersionString} (${info.CFBundleVersion}), not ${marketing} (${build})`);
  }
  const debug = debugMarks(app);
  if (debug.length) throw new Error(`the Release app carries the debug bridge: ${debug.join(', ')}`);
  const libraries = readdirSync(app).filter((name) => name.endsWith('.dylib'));
  if (libraries.length) throw new Error(`the Release app has a library beside its binary, as a Debug build does: ${libraries.join(', ')}`);
  const manifest = JSON.parse(readFileSync(join(app, 'extension', 'manifest.json'), 'utf8'));
  if (manifest.background || manifest.version !== marketing) throw new Error(`the bundled manifest is ${manifest.version}${manifest.background ? ' with a background' : ''}`);
  if (!existsSync(join(app, 'Frameworks', 'GoogleCast.framework', 'GoogleCast'))) throw new Error('GoogleCast.framework is not embedded');
  return info;
}

/**
 * The one package that is uploaded, held to what the other two are held
 * to. It is made by hand (ios/AGENTS.md), round this tool, and status took
 * any file of its name: one exported last week, of build 1 when 2 is due,
 * or from a Debug archive. It is dated by the signed archive it was
 * exported from, as its own time is the export's: a source saved between
 * the archive and the export would leave it looking new. The archive's
 * date is its end, so a file saved while the archive itself was being
 * built is not seen. Then it is opened and read as the app it holds.
 * @returns {[boolean, string]}
 */
function signedPackage({ ipa, signed }, numbers, made) {
  if (!existsSync(ipa)) return [false, `${short(ipa)} comes from the owner's procedure in ios/AGENTS.md, which has never been run`];
  const info = join(signed, 'Info.plist');
  if (!existsSync(info)) return [false, `${short(ipa)} is there, but not ${short(signed)} it was exported from: whether it is of the source as it stands cannot be told`];
  const archived = Date.parse(run('plutil', ['-extract', 'CreationDate', 'raw', '-o', '-', info]).trim()) || statSync(signed).mtimeMs;
  if (changedSince(archived)) return [false, `${short(ipa)}, made ${made(ipa)}, but the source has changed since its archive was made: archive and export again`];
  if (statSync(ipa).mtimeMs < archived) return [false, `${short(ipa)}, made ${made(ipa)}, is older than ${short(signed)}: export again`];
  const unpacked = mkdtempSync(join(OUT, 'ipa-'));
  try {
    const app = join(unpacked, 'Payload', 'KepuliTV.app');
    try { run('ditto', ['-x', '-k', ipa, unpacked]); } catch { /* not an archive: nothing is unpacked */ }
    if (!existsSync(join(app, 'Info.plist'))) throw new Error('it cannot be unpacked, or holds no Payload/KepuliTV.app');
    const { CFBundleShortVersionString: marketing, CFBundleVersion: build } = releaseApp(app, numbers);
    const slices = run('lipo', ['-archs', join(app, 'KepuliTV')]).trim();
    if (slices !== 'arm64') throw new Error(`its binary is for ${slices}, not arm64 alone`);
    return [true, `${short(ipa)}, ${marketing} (${build}), made ${made(ipa)}, ${slices}, no debug bridge`];
  } catch (err) {
    return [false, `${short(ipa)}: ${err.message.split('\n')[0].replaceAll(`${short(unpacked)}/`, '')}`];
  } finally {
    rmSync(unpacked, { recursive: true, force: true });
  }
}

/**
 * The Release app started once, in this tool's own iPhone simulator. Every
 * scenario and the XCTest target run the Debug app, another binary (a stub
 * and a library, unoptimised) with the debug bridge in its web view's
 * configuration: without this the shipped configuration first ran as the
 * TestFlight build, after an upload. The Release app has no bridge to ask,
 * so it is judged from outside: its process lives, it leaves no crash
 * report, and its container gains what only a page that ran writes there,
 * WebKit's storage for the extension (the context loaded) and the page's
 * own localStorage (js/theme.js writes the theme at its first statement).
 * A picture is kept in KEPULI_SHOTS_DIR. The app is removed again, and a
 * simulator this booted is shut down.
 */
async function startOnce(app) {
  const name = 'kepuli-ios-iphone', id = udid(name), wasBooted = booted(name);
  const reports = join(homedir(), 'Library', 'Logs', 'DiagnosticReports');
  const crashes = () => (existsSync(reports) ? readdirSync(reports).filter((file) => file.startsWith('KepuliTV')) : []);
  const within = (directory, test) => existsSync(directory) && readdirSync(directory, { recursive: true }).some((path) => test(String(path)));
  const before = new Set(crashes());
  boot(name);
  try {
    try { simctl('uninstall', id, BUNDLE.Release); } catch { /* it was not installed */ }
    simctl('install', id, app);
    const pid = Number(simctl('launch', '--terminate-running-process', id, BUNDLE.Release).split(':').pop());
    const alive = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
    const webkit = join(simctl('get_app_container', id, BUNDLE.Release, 'data'), 'Library', 'WebKit', BUNDLE.Release);
    const ran = () => within(join(webkit, 'WebExtensions'), (path) => path.endsWith('kepuli-tv/State.plist'))
      && within(join(webkit, 'WebsiteData'), (path) => path.endsWith('localstorage.sqlite3'));
    for (const until = Date.now() + 40000; Date.now() < until && alive() && !ran();) await new Promise((done) => setTimeout(done, 500));
    // A moment more: a page that ends the app does so after its start.
    await new Promise((done) => setTimeout(done, 3000));
    const picture = await shot(join(process.env.KEPULI_SHOTS_DIR || join(tmpdir(), 'kepuli-ios-shots'), 'release-started.png'), name);
    const crashed = crashes().filter((file) => !before.has(file));
    if (!alive() || crashed.length) throw new Error(`the Release app did not stay up in ${name}${crashed.length ? `: ${crashed.join(', ')} in ~/Library/Logs/DiagnosticReports` : ''} (picture: ${picture})`);
    if (!ran()) throw new Error(`the Release app started in ${name}, but its page did not run: no extension storage or no localStorage in its container after 40 s (picture: ${picture})`);
    return picture;
  } finally {
    try { simctl('terminate', id, BUNDLE.Release); } catch { /* it was not running */ }
    try { simctl('uninstall', id, BUNDLE.Release); } catch { /* it was not installed */ }
    if (!wasBooted) shutdown(name);
  }
}

async function simulator(build, { start = true } = {}) {
  const numbers = version(build);
  const started = new Date();
  const app = await buildSimulator({ configuration: 'Release', build, release: true });
  releaseApp(app, numbers);
  const { simulator: zip, started: stamp } = outputs(numbers.marketing);
  mkdirSync(OUT, { recursive: true });
  rmSync(zip, { force: true });
  rmSync(stamp, { force: true });
  if (start) {
    const picture = await startOnce(app);
    writeFileSync(stamp, JSON.stringify({ version: numbers.marketing, build: numbers.build }, null, 2) + '\n');
    // Dated as the package is, when the build began (status).
    utimesSync(stamp, started, started);
    console.log(`the Release app started in kepuli-ios-iphone, stayed up and its page ran; picture ${picture}`);
  }
  // ditto keeps what zip -r loses of a bundle (symbolic links, attributes).
  run('ditto', ['-c', '-k', '--keepParent', app, zip]);
  // Dated when its build began: a source saved since makes it old (status).
  utimesSync(zip, started, started);
  console.log(`${short(zip)}  ${(statSync(zip).size / 1048576).toFixed(1)} MB  ${numbers.marketing} (${numbers.build}), Release for simulators, no debug bridge`);
}

/** Every PrivacyInfo.xcprivacy under a directory, the app's own first. */
function privacyManifests(directory) {
  const found = [];
  const walk = (path) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(path, entry.name));
      else if (entry.name === 'PrivacyInfo.xcprivacy') found.push(join(path, entry.name));
    }
  };
  walk(directory);
  return found.sort((a, b) => a.length - b.length).map((file) => ({ file, ...plist(file) }));
}

// The data types of App Store Connect's privacy questions that are named
// in more than one word. Google's NutritionLabel.txt for the pinned SDK
// (ios/vendor/) is searched for them, in any case and across its line
// breaks: it is prose, written "Coarse location" and "Device Id", and may
// be worded anew in a later version. The one-word types (Name, Health,
// Fitness, Contacts, Hands, Head) are left out, as prose holds such words
// for other reasons; a file that names none of the list fails the gate, so
// that a rewording is noticed and read.
const LABEL_TYPES = ['Precise Location', 'Coarse Location', 'Email Address', 'Phone Number', 'Physical Address', 'Other User Contact Info',
  'Payment Info', 'Credit Info', 'Other Financial Info', 'Sensitive Info', 'Emails or Text Messages', 'Photos or Videos', 'Audio Data',
  'Gameplay Content', 'Customer Support', 'Other User Content', 'Browsing History', 'Search History', 'User ID', 'Device ID', 'Purchase History',
  'Product Interaction', 'Advertising Data', 'Other Usage Data', 'Crash Data', 'Performance Data', 'Other Diagnostic Data', 'Environment Scanning', 'Other Data'];

/** The types Google's own privacy details for the pinned Cast SDK name, or null without the file. */
function nutritionTypes() {
  if (!existsSync(NUTRITION)) return null;
  const text = readFileSync(NUTRITION, 'utf8');
  return LABEL_TYPES.filter((type) => new RegExp(`\\b${type.split(' ').join('\\s+')}\\b`, 'i').test(text));
}

// "NSPrivacyCollectedDataTypeOtherDiagnosticData" as App Store Connect's label has it.
const spoken = (identifier, prefix) => identifier.slice(prefix.length).replace(/([a-z])([A-Z])/g, '$1 $2');
const collected = (manifests) => [...new Set(manifests.flatMap((m) => (m.NSPrivacyCollectedDataTypes || []).map((type) => spoken(type.NSPrivacyCollectedDataType, 'NSPrivacyCollectedDataType'))))];

function privacyReport(app, { marketing, build }) {
  const manifests = privacyManifests(app);
  const lines = [`Kepuli-TV ${marketing} (${build}): what the privacy manifests in ${short(app)} declare.`,
    'Written by node ios/release.mjs archive. The App Store label in store/appstore.txt must name every collected type below.', ''];
  for (const manifest of manifests) {
    lines.push(relative(join(app, '..'), manifest.file));
    lines.push(`  tracking: ${manifest.NSPrivacyTracking === undefined ? 'not stated' : manifest.NSPrivacyTracking ? 'YES' : 'no'}; tracking domains: ${(manifest.NSPrivacyTrackingDomains || []).join(', ') || 'none'}`);
    const types = manifest.NSPrivacyCollectedDataTypes || [];
    lines.push(`  collected data:${types.length ? '' : ' none'}`);
    for (const type of types) {
      lines.push(`    ${spoken(type.NSPrivacyCollectedDataType, 'NSPrivacyCollectedDataType')}: ${type.NSPrivacyCollectedDataTypeLinked ? 'LINKED to the user' : 'not linked to the user'}, `
        + `${type.NSPrivacyCollectedDataTypeTracking ? 'USED FOR TRACKING' : 'not used for tracking'}; for ${type.NSPrivacyCollectedDataTypePurposes.map((p) => spoken(p, 'NSPrivacyCollectedDataTypePurpose')).join(', ')}`);
    }
    const apis = (manifest.NSPrivacyAccessedAPITypes || []).map((api) => `${spoken(api.NSPrivacyAccessedAPIType, 'NSPrivacyAccessedAPICategory')} (${api.NSPrivacyAccessedAPITypeReasons.join(', ')})`);
    lines.push(`  required-reason API: ${apis.join(', ') || 'none'}`, '');
  }
  lines.push(`Collected data types, all manifests: ${collected(manifests).join(', ') || 'none'}`, '');
  // Google's own privacy details for this version of the Cast SDK, whole:
  // they name types the manifest does not, and the label must name those too.
  const named = nutritionTypes();
  lines.push(`${short(NUTRITION)}${named ? `, which names: ${named.join(', ') || 'no data type this tool knows'}` : ' is not there: node ios/vendor.mjs'}`, '');
  if (named) lines.push(...readFileSync(NUTRITION, 'utf8').trimEnd().split('\n').map((line) => `  ${line}`.trimEnd()), '');
  return { text: lines.join('\n'), manifests };
}

async function archive(build) {
  const started = new Date();
  const numbers = await prepare({ build, release: true }).then(() => version(build));
  const { archive: path, privacy } = outputs(numbers.marketing);
  mkdirSync(OUT, { recursive: true });
  rmSync(path, { recursive: true, force: true });
  // Unsigned: there is no identity here to sign with, and what this proves
  // is that the Release device build compiles and links with the Cast SDK.
  xcodebuild('-configuration', 'Release', '-destination', 'generic/platform=iOS', '-archivePath', path, 'archive',
    'CODE_SIGNING_ALLOWED=NO', 'CODE_SIGNING_REQUIRED=NO', 'CODE_SIGN_IDENTITY=');
  const app = join(path, 'Products', 'Applications', 'KepuliTV.app');
  const info = releaseApp(app, numbers);
  const slices = run('lipo', ['-archs', join(app, 'KepuliTV')]).trim();
  if (slices !== 'arm64') throw new Error(`the archived binary is for ${slices}, not arm64 alone`);
  const report = privacyReport(app, numbers);
  writeFileSync(privacy, report.text);
  // Dated when its build began, as the simulator's stamp is: a source
  // saved since makes it old (status).
  utimesSync(path, started, started);
  console.log(`${short(path)}  ${numbers.marketing} (${numbers.build}), unsigned, ${slices}, iOS ${info.MinimumOSVersion} and later, no debug bridge`);
  console.log(`${short(privacy)}  ${report.manifests.length} privacy manifests; collected: ${collected(report.manifests).join(', ') || 'nothing'}`);
}

/* ---------------------------------------------------------------- status */

// The words the App Store's texts must not hold: another platform or
// product the player runs in (guideline 2.3.10), what the app is made of
// (4.2), and what it does not do (2.3.1). Whole words, so that Chromecast
// passes and "table" is not a tab.
const UNTRUE = /\b(Android|Firefox|Chrome|Orion|extensions?|browsers?|toolbars?|tabs?|record\w*|web|wrapper)\b/i;
// The same in Finnish, by the words' stems, for the sections that end in
// " fi". Recording is tallenn-/tallent- in the player's own Finnish (never
// nauhoit-), and a section copied from the Chrome listing would promise it
// in that word. The stem also means saving in general ("asetukset
// tallennetaan laitteelle"): such a sentence is turned away as well, and is
// to be said with another word (säilytetään), which is the safe way round.
const UNTRUE_FI = /selai|laajenn|välileh|nauhoit|tallen|verkko/i;
// The other platforms alone, for a page the store's fields lead to.
const PLATFORMS = /\b(Android|Firefox|Chrome|Orion)\b/;
const LIMITS = { NAME: 30, SUBTITLE: 30, KEYWORDS: 100, 'PROMOTIONAL TEXT': 170, DESCRIPTION: 4000, "WHAT'S NEW": 4000, 'REVIEW NOTES': 4000 };

/**
 * The sections of store/appstore.txt that are pasted into App Store
 * Connect: from a "=== NAME ===" line to its "=== END ===" line, every
 * line between them. The end is said, not guessed from the shape of what
 * follows: guessed, a pasted paragraph that began with two spaces ended
 * the section, and was neither read nor counted. A section without its
 * end line is `open`. The file's own prose around the sections names other
 * stores and the Record button on purpose and is not scanned. `label` is
 * the privacy label's rows, the lines with an arrow.
 */
function storeSections() {
  const text = readFileSync(STORE_TEXTS, 'utf8');
  const sections = [], open = [];
  for (const [, name, rest] of text.matchAll(/^=== (?!END ===)(.+?) ===\n([\s\S]*?)(?=^=== (?!END ===)|(?![\s\S]))/gm)) {
    const end = rest.search(/^=== END ===$/m);
    if (end < 0) open.push(name); else sections.push({ name, body: rest.slice(0, end).trim() });
  }
  const label = /^--- APP PRIVACY[^\n]*\n([\s\S]*?)(?=^--- )/m.exec(text);
  return { sections, open, label: (label ? label[1] : '').split('\n').filter((line) => line.includes('→')).join('\n') };
}

/** Width, height and whether there is an alpha channel, from a PNG's header. */
function pngFacts(file) {
  const head = Buffer.alloc(26), handle = openSync(file, 'r');
  readSync(handle, head, 0, 26, 0);
  closeSync(handle);
  if (head.toString('latin1', 1, 4) !== 'PNG') return null;
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20), alpha: [4, 6].includes(head[25]) };
}

// The sizes the store takes for the two required sets (store/appstore.txt).
const SCREENSHOTS = join(ROOT, 'brand', 'ios-screenshots');
const SETS = { 'iPhone 6.9"': ['1320x2868'], 'iPad 13"': ['2064x2752', '2752x2064'] };

/** The store's pictures: one to ten of each set, of its size, without alpha. */
function screenshots() {
  if (!existsSync(SCREENSHOTS)) return [false, `${short(SCREENSHOTS)}/ is not there: the two sets are taken as store/appstore.txt says`];
  const counts = Object.fromEntries(Object.keys(SETS).map((set) => [set, 0])), wrong = [];
  for (const name of readdirSync(SCREENSHOTS).filter((file) => /\.png$/i.test(file))) {
    const facts = pngFacts(join(SCREENSHOTS, name));
    const set = facts && Object.keys(SETS).find((key) => SETS[key].includes(`${facts.width}x${facts.height}`));
    if (!set) wrong.push(`${name} is ${facts ? `${facts.width} × ${facts.height}` : 'not a PNG'}`);
    else if (facts.alpha) wrong.push(`${name} has an alpha channel`);
    else counts[set]++;
  }
  for (const [set, count] of Object.entries(counts)) if (count < 1 || count > 10) wrong.push(`${count} for the ${set} set, which takes one to ten`);
  return [wrong.length === 0, wrong.join('; ') || Object.entries(counts).map(([set, count]) => `${count} for ${set}`).join(', ')];
}

/** What a page shows a reader: its markup without scripts, styles and tags. */
const shownText = (html) => html.replace(/<(script|style)\b[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]*>/g, ' ');

/** A page of the Pages site as a visitor gets it: its text, or why not. */
async function served(address) {
  try {
    const answer = await fetch(address, { signal: AbortSignal.timeout(20000) });
    return answer.ok ? { text: await answer.text() } : { why: `answers ${answer.status}` };
  } catch (err) {
    return { why: `was not reached (${err.cause?.code || err.name})` };
  }
}

/** Logs in to the demo provider as a reviewer would and reads the start of a film. */
async function demoAnswers(address) {
  const url = new URL(address);
  const base = address.replace(/\/+$/, '');
  const ask = (path, headers) => fetch(`${base}${path}`, { headers, signal: AbortSignal.timeout(20000) });
  const login = await (await ask('/player_api.php?username=demo&password=demo')).json();
  if (String(login?.user_info?.auth) !== '1') throw new Error('it does not let demo/demo in');
  const films = await (await ask('/player_api.php?username=demo&password=demo&action=get_vod_streams')).json();
  const film = films.find((f) => f.container_extension === 'mp4') || films[0];
  if (!film) throw new Error('it has no film');
  // The reviewer's catalogue has no film that is there to fail. The test
  // catalogue ends every genre with an AVI, and on the same switch carries
  // an episode with AC-3 sound, silent on iOS 18 (dev/mock/server.mjs,
  // KEPULI_MOCK_REVIEW): a demo deployed without the switch answered, and
  // passed.
  const unplayable = films.filter((f) => f.container_extension === 'avi').length;
  if (unplayable) throw new Error(`it serves the test catalogue (${unplayable} AVI films that no player takes): deploy dev/mock with KEPULI_MOCK_REVIEW=1`);
  const answer = await ask(`/movie/demo/demo/${film.stream_id}.${film.container_extension}`, { Range: 'bytes=0-65535' });
  const bytes = (await answer.arrayBuffer()).byteLength;
  if (![200, 206].includes(answer.status) || !bytes) throw new Error(`a film's first bytes: status ${answer.status}, ${bytes} bytes`);
  // Apple's review network is IPv6-only behind NAT64: an address literal
  // is unreachable there, and the review notes give an https address.
  const named = url.protocol === 'https:' && !/^[\d.]+$|:/.test(url.hostname);
  return [named, `demo/demo is let in, ${films.length} films, the first ${bytes} bytes of one arrive${named ? '' : '; but it is not an https address with a host name, which the review needs'}`];
}

async function status(build) {
  const numbers = version(build);
  const paths = outputs(numbers.marketing);
  const missing = [];
  const say = (ok, name, detail) => {
    if (!ok) missing.push(name);
    console.log(`${ok ? 'ok     ' : 'MISSING'}  ${name}${detail ? `: ${detail}` : ''}`);
  };
  // This machine's clock, as a file listing would show it.
  const made = (path) => new Date(statSync(path).mtimeMs - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16).replace('T', ' ');
  let xcode = '';
  try { xcode = run('xcodebuild', ['-version']).split('\n')[0]; } catch { xcode = 'no Xcode'; }
  console.log(`Kepuli-TV for the iPhone and the iPad ${numbers.marketing}, build ${numbers.build} (${xcode})\n`);

  console.log('Outputs');
  // An output is of the source as it stands: one made before a source
  // file was last saved (or removed) is of another app.
  const old = (path) => (changedSince(statSync(path).mtimeMs) ? ', but the source has changed since: make it again' : '');
  say(existsSync(paths.simulator) && !old(paths.simulator), 'the simulator package', existsSync(paths.simulator) ? `${short(paths.simulator)}, made ${made(paths.simulator)}${old(paths.simulator)}` : 'node ios/release.mjs simulator');
  // The Release app of that package, seen to start: of this version and
  // build, and of the source as it stands.
  let began = null;
  try { began = JSON.parse(readFileSync(paths.started, 'utf8')); } catch { /* reported below */ }
  const current = began && began.version === numbers.marketing && began.build === numbers.build;
  say(Boolean(current) && !old(paths.started), 'the Release app started in a simulator',
    began ? (current ? `it stayed up and its page ran, ${made(paths.started)}${old(paths.started)}` : `${began.version} (${began.build}) did, not this build`) : 'node ios/release.mjs simulator (without --no-launch)');
  const app = join(paths.archive, 'Products', 'Applications', 'KepuliTV.app');
  const archived = existsSync(app) ? plist(join(app, 'Info.plist')) : null;
  say(Boolean(archived) && archived.CFBundleVersion === numbers.build && !old(paths.archive), 'the unsigned archive',
    archived ? `${short(paths.archive)}, ${archived.CFBundleShortVersionString} (${archived.CFBundleVersion}), made ${made(paths.archive)}${old(paths.archive)}` : 'node ios/release.mjs archive');
  say(existsSync(paths.privacy), 'the privacy report', existsSync(paths.privacy) ? `${short(paths.privacy)}, made ${made(paths.privacy)}` : 'node ios/release.mjs archive');
  say(...((([ok, detail]) => [ok, 'the signed package for the App Store', detail])(signedPackage(paths, numbers, made))));

  // Named, never printed: the team, the key and the demo's address stay
  // out of every log as they stay out of the repository.
  console.log('\nThe owner\'s configuration, ~/.config/kepuli-tv/ios/');
  let config = {};
  const file = join(CONFIG, 'appstore.json');
  try { config = JSON.parse(readFileSync(file, 'utf8')); } catch { /* reported below */ }
  const absent = ['teamId', 'keyId', 'issuerId', 'demoUrl'].filter((key) => !config[key]);
  say(existsSync(file) && absent.length === 0, 'appstore.json', existsSync(file) ? (absent.length ? `without ${absent.join(', ')}` : 'teamId, keyId, issuerId and demoUrl are there') : 'not there (teamId, keyId, issuerId, demoUrl)');
  say(Boolean(config.keyId) && existsSync(join(CONFIG, `AuthKey_${config.keyId}.p8`)), 'the App Store Connect API key', config.keyId ? `AuthKey_<keyId>.p8 ${existsSync(join(CONFIG, `AuthKey_${config.keyId}.p8`)) ? 'is there' : 'is not there'}` : 'AuthKey_<keyId>.p8, named by appstore.json');

  console.log('\nThe demo provider for App Review');
  const demo = process.env.KEPULI_IOS_DEMO_URL || config.demoUrl;
  if (!demo) say(false, 'the demo answers', 'no demoUrl in appstore.json: the demo is not deployed, or not written down');
  else {
    try { say(...await demoAnswers(demo).then(([ok, detail]) => [ok, 'the demo answers', detail])); } catch (err) { say(false, 'the demo answers', err.message.split('\n')[0]); }
  }

  console.log('\nThe App Store texts, store/appstore.txt');
  const { sections, open: unended, label } = storeSections();
  say(unended.length === 0, 'every pasted section ends with its "=== END ===" line', unended.length ? `without one: ${unended.join(', ')}` : `${sections.length} sections`);
  const untrue = sections.map(({ name, body }) => [name, UNTRUE.exec(body) || (/ fi$/.test(name) && UNTRUE_FI.exec(body))]).filter(([, hit]) => hit).map(([name, hit]) => `${name} says "${hit[0]}"`);
  say(sections.length >= 12 && untrue.length === 0, 'no other platform, no word of what the app is made of or does not do', untrue.join('; ') || `${sections.length} pasted sections read`);
  const long = sections.map(({ name, body }) => [name, [...body].length, LIMITS[name.replace(/ (en-GB|fi)$/, '')]]).filter(([, length, limit]) => !limit || length > limit).map(([name, length, limit]) => `${name} is ${length} of ${limit}`);
  say(long.length === 0, 'within the store\'s limits', long.join('; ') || sections.filter(({ name }) => /^(SUBTITLE|KEYWORDS|REVIEW)/.test(name)).map(({ name, body }) => `${name} ${[...body].length}`).join(', '));
  if (existsSync(app)) {
    const types = collected(privacyManifests(app));
    const unnamed = types.filter((type) => !label.includes(type));
    say(unnamed.length === 0, 'the privacy label\'s rows name every type the archive\'s manifests collect', unnamed.length ? `not named: ${unnamed.join(', ')}` : types.join(', '));
  } else say(false, 'the privacy label\'s rows name every type the archive\'s manifests collect', 'no archive to read them from');
  // And every type Google's own privacy details for the pinned SDK name:
  // Coarse Location and Performance Data are in no manifest.
  const googles = nutritionTypes();
  const unlabelled = (googles || []).filter((type) => !label.toLowerCase().includes(type.toLowerCase()));
  say(Boolean(googles?.length) && unlabelled.length === 0, 'the privacy label\'s rows name every type the Cast SDK\'s NutritionLabel.txt names',
    !googles ? `${short(NUTRITION)} is not there: node ios/vendor.mjs` : !googles.length ? `${short(NUTRITION)} names no data type this tool knows: read it, and LABEL_TYPES in ios/release.mjs`
      : unlabelled.length ? `not named: ${unlabelled.join(', ')}` : googles.join(', '));

  console.log('\nThe store\'s pictures and pages');
  const [pictures, counted] = screenshots();
  say(pictures, 'the two screenshot sets, brand/ios-screenshots/', counted);
  // The Support URL, the privacy policy and the licences: the app's Help
  // opens all three, and the review reads them. As the Pages site serves
  // them, which is the main branch's docs/.
  const site = /^Support URL\s+(\S+?)iptv-app-iphone-ipad\/$/m.exec(readFileSync(STORE_TEXTS, 'utf8'))?.[1];
  const pages = [['iptv-app-iphone-ipad/', 'the app\'s guide (the Support URL)'], ['privacy/', 'the privacy policy'], ['licences/', 'the licences page']];
  for (const [path, name] of pages) {
    const page = site ? await served(site + path) : { why: 'has no address: store/appstore.txt names no Support URL' };
    // The guide is the app's: no other platform on it. The policy is the
    // app's too once it has the section on the app and Google's Cast.
    const hit = page.text && path.startsWith('iptv') ? PLATFORMS.exec(shownText(page.text)) : null;
    const lacks = page.text && path === 'privacy/' && !page.text.includes('The app for the iPhone and the iPad</h2>');
    say(Boolean(page.text) && !hit && !lacks, `${name} is on the Pages site`,
      page.why ? `${site || ''}${path} ${page.why}` : hit ? `it names "${hit[0]}"` : lacks ? 'it has no section on the app yet' : `${site}${path}`);
  }
  // The same page as this checkout renders it, before it is pushed.
  const local = join(ROOT, 'docs', 'iptv-app-iphone-ipad', 'index.html');
  const named = existsSync(local) ? PLATFORMS.exec(shownText(readFileSync(local, 'utf8'))) : null;
  say(existsSync(local) && !named, 'the app\'s guide as rendered here names no other platform', existsSync(local) ? (named ? `${short(local)} says "${named[0]}"` : short(local)) : `${short(local)} is not there: node dev/site.mjs`);

  // A gate: nothing is submitted with a line open. Ticked by hand in
  // ios/AGENTS.md ("- [x]") once seen on a device.
  console.log('\nThe device checklist, ios/AGENTS.md');
  const list = (/^## Device checklist\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(readFileSync(GUIDE, 'utf8')) || ['', ''])[1];
  const items = [...list.matchAll(/^- \[( |x)\] (.+(?:\n {2}.+)*)/gm)].map(([, tick, text]) => ({ done: tick === 'x', text: text.replace(/\n\s+/g, ' ') }));
  for (const item of items) console.log(`${item.done ? 'done   ' : 'open   '}  ${item.text}`);
  const open = items.filter((item) => !item.done).length;
  say(items.length > 0 && open === 0, 'every line seen on a device', items.length ? `${open} of ${items.length} open` : 'ios/AGENTS.md has no "## Device checklist"');

  console.log(missing.length ? `\nNot ready for the App Store: ${missing.length} missing.` : '\nNothing is missing here. The upload and the submission wait for the owner\'s go.');
  return missing.length === 0;
}

const args = process.argv.slice(2);
const build = args.includes('--build') ? Number(args[args.indexOf('--build') + 1]) : undefined;
try {
  switch (args[0]) {
    case 'simulator': await simulator(build, { start: !args.includes('--no-launch') }); break;
    case 'archive': await archive(build); break;
    case 'status': process.exitCode = (await status(build)) ? 0 : 1; break;
    default: console.error('node ios/release.mjs simulator | archive | status   (see the comment at its top)'); process.exitCode = 1;
  }
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
}
