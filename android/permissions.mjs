#!/usr/bin/env node
// What each built package asks Android to allow, against what is approved.
//
// A library brings its own manifest, and what it asks for is merged into
// the app's without a line of the app's changing: Google's Cast sender came
// with none, but the next version of anything may. Play's forms (data
// safety, the foreground service's declaration) and the privacy policy name
// the permissions one by one, so a new one must be seen before it ships.
//
//   node android/permissions.mjs    after ./gradlew assembleMobileDebug assembleTvDebug
//
// It reads the debug packages with the SDK's aapt2 (ANDROID_HOME, or
// ~/Library/Android/sdk). A permission that is new, or one that is gone,
// fails: add it to the list below with the reason, and to Play's forms and
// the privacy policy (docs/privacy/index.html, section 6) where they name it.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const HERE = new URL('.', import.meta.url).pathname;
// Every package: the network for the provider's server, and what the
// engine (GeckoView) asks for itself.
const ENGINE = ['INTERNET', 'ACCESS_NETWORK_STATE', 'WAKE_LOCK', 'MODIFY_AUDIO_SETTINGS'];
const APPROVED = {
  // Reminders as notifications, the sound out of sight (PlaybackService),
  // the reminders' alarms set again after a restart.
  mobile: [...ENGINE, 'POST_NOTIFICATIONS', 'FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_MEDIA_PLAYBACK', 'RECEIVE_BOOT_COMPLETED'],
  tv: ENGINE,
};

const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || join(homedir(), 'Library', 'Android', 'sdk');
const tools = join(sdk, 'build-tools');
const version = existsSync(tools) ? readdirSync(tools).sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).at(-1) : null;
if (!version) {
  console.error(`no Android build-tools under ${tools}: set ANDROID_HOME`);
  process.exit(2);
}
const aapt = join(tools, version, 'aapt2');

let failed = 0;
for (const [form, approved] of Object.entries(APPROVED)) {
  const dir = join(HERE, 'app', 'build', 'outputs', 'apk', form, 'debug');
  const apk = existsSync(dir) ? readdirSync(dir).find((name) => name.endsWith('.apk')) : null;
  if (!apk) {
    console.error(`FAIL  ${form}: no debug package in ${dir}; build it first`);
    failed++;
    continue;
  }
  const dump = execFileSync(aapt, ['dump', 'permissions', join(dir, apk)], { encoding: 'utf8' });
  // The app's own permission for its unexported receivers is AndroidX's, named after the package.
  const asked = [...dump.matchAll(/uses-permission: name='([^']+)'/g)].map((m) => m[1])
    .filter((name) => !name.endsWith('.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION'))
    .map((name) => name.replace(/^android\.permission\./, ''));
  const extra = asked.filter((name) => !approved.includes(name));
  const missing = approved.filter((name) => !asked.includes(name));
  if (extra.length || missing.length) {
    console.error(`FAIL  ${form}: ${[extra.length ? `not approved: ${extra.join(', ')}` : '', missing.length ? `approved but not asked for: ${missing.join(', ')}` : ''].filter(Boolean).join('; ')}`);
    failed++;
  } else console.log(`PASS  ${form}: ${asked.length} permissions, all approved`);
}
process.exit(failed ? 1 : 0);
