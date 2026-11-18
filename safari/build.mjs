#!/usr/bin/env node
// The Safari extension for the Mac, built from the shared source.
//
//   node safari/build.mjs            the extension's files, the Xcode project and the app, for this Mac
//   node safari/build.mjs --project  … without building the app
//
// Safari takes a web extension only inside an app: Apple's converter
// (xcrun safari-web-extension-converter) wraps the extension's directory in
// an Xcode project with an app and an extension target, and Xcode builds
// the app whose launch registers the extension with Safari. Nothing
// generated is committed; it all goes to safari/dist/, as firefox/dist/ is
// Firefox's:
//   1. extension/   firefox/dist/ (firefox/build.mjs, which also refuses when the two
//                   manifests disagree), with the manifest rewritten for Safari
//   2. project/     the converter's Xcode project, the extension's files copied into it
//   3. build/       xcodebuild's products: build/Build/Products/Debug/Kepuli-TV.app
//
// The package is Firefox's, not Chrome's: in WebKit a manifest with
// background.service_worker never starts its background and reports no
// error (measured for the iOS app, ios/build.mjs).
//
// SIGNING. With a development team the app is signed by Xcode with the
// team's Apple Development certificate, which a free Apple account gives
// (Xcode, Settings, Apple Accounts, the team, Manage Certificates): Safari
// then takes the extension as it takes any other. The team's identifier is
// read from KEPULI_APPLE_TEAM or ~/.config/kepuli-tv/safari/team, never
// from the repository. Without one the app is signed ad hoc ("-"), and
// Safari loads it only while "Allow unsigned extensions" is on in its
// Developer settings, which it turns off when it quits and asks the
// user's password to turn on again. The Mac App Store's signing needs the
// paid membership and is not done here.
//
// No dependencies beyond Xcode.

import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const DIST = join(HERE, 'dist');
const EXTENSION = join(DIST, 'extension');
const PROJECT = join(DIST, 'project');
const BUILD = join(DIST, 'build');
const NAME = 'Kepuli-TV';
// The app's identifier, and the extension's under it: macOS refuses an
// embedded extension whose identifier does not begin with its app's, and
// the converter, given one identifier, names the two apart.
const APP_ID = 'io.github.bigtimesam.kepulitv.safari';
const EXTENSION_ID = `${APP_ID}.Extension`;

const fail = (message) => { console.error(message); process.exit(1); };
const run = (command, args, options = {}) => {
  const done = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (done.status !== 0) fail(`${command} ${args.slice(0, 3).join(' ')} … failed:\n${(done.stdout || '') + (done.stderr || '')}`.trimEnd());
  return (done.stdout || '') + (done.stderr || '');
};

/* 1. The extension's files. */
execFileSync(process.execPath, [join(ROOT, 'firefox', 'build.mjs')], { stdio: 'ignore' });
rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });
cpSync(join(ROOT, 'firefox', 'dist'), EXTENSION, { recursive: true });
const manifestPath = join(EXTENSION, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
// Firefox's own keys mean nothing to Safari.
delete manifest.browser_specific_settings;
// Safari has no `notifications` permission (the converter says so): asked
// for, it can never be granted. A reminder there is the player's own.
manifest.optional_permissions = (manifest.optional_permissions || []).filter((name) => name !== 'notifications');
if (!manifest.optional_permissions.length) delete manifest.optional_permissions;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`safari/dist/extension  version ${manifest.version}`);

/* 2. The Xcode project. */
const said = run('xcrun', ['safari-web-extension-converter', EXTENSION, '--project-location', PROJECT, '--app-name', NAME,
  '--bundle-identifier', APP_ID, '--swift', '--macos-only', '--copy-resources', '--no-open', '--no-prompt']);
const warning = said.match(/Warning:[^\n]*\n((?:\t[^\n]*\n?)+)/);
if (warning) console.log(`the converter warns of manifest keys Safari does not know: ${warning[1].trim().split(/\s+/).join(', ')}`);
const projectDir = join(PROJECT, NAME);
const pbx = join(projectDir, `${NAME}.xcodeproj`, 'project.pbxproj');
if (!existsSync(pbx)) fail(`the converter left no project at ${pbx}:\n${said}`);
// The two identifiers, whatever the converter chose: the extension's are
// the ones that end in ".Extension".
writeFileSync(pbx, readFileSync(pbx, 'utf8').replace(/PRODUCT_BUNDLE_IDENTIFIER = "?([^";]+)"?;/g,
  (line, id) => `PRODUCT_BUNDLE_IDENTIFIER = ${/\.Extension$/.test(id) ? EXTENSION_ID : APP_ID};`));
console.log('safari/dist/project    the Xcode project');
if (process.argv.includes('--project')) process.exit(0);

/* 3. The app. */
const teamFile = join(homedir(), '.config', 'kepuli-tv', 'safari', 'team');
const team = process.env.KEPULI_APPLE_TEAM || (existsSync(teamFile) ? readFileSync(teamFile, 'utf8').trim() : '');
run('xcodebuild', ['-project', join(projectDir, `${NAME}.xcodeproj`), '-scheme', NAME, '-configuration', 'Debug', '-derivedDataPath', BUILD,
  ...(team ? ['-allowProvisioningUpdates', 'CODE_SIGN_STYLE=Automatic', `DEVELOPMENT_TEAM=${team}`]
    : ['CODE_SIGN_IDENTITY=-', 'CODE_SIGNING_REQUIRED=NO', 'DEVELOPMENT_TEAM=']), 'build']);
const app = join(BUILD, 'Build', 'Products', 'Debug', `${NAME}.app`);
const appex = join(app, 'Contents', 'PlugIns');
if (!existsSync(app) || !readdirSync(appex).some((name) => name.endsWith('.appex'))) fail(`no app with its extension at ${app}`);
console.log(`safari/dist/build      ${app}${team ? ', signed for the development team' : ', signed ad hoc'}`);
