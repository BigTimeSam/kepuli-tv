#!/usr/bin/env node
// Cached codec flags must not contradict the player's audio route or selection.
import assert from 'node:assert/strict';
import { audioDetails } from '../js/probe.js';
import { encoderSetup } from '../js/transcode.js';

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The encoder is chosen once per page, so the browser without any route
// for the decoded audio is a second run of this file: a MediaSource that
// takes no AAC leaves neither WebCodecs nor the wasm encoder anywhere to go.
if (process.env.KEPULI_NO_AAC) {
  globalThis.MediaSource = { isTypeSupported: () => false };
  await encoderSetup();
  const silent = audioDetails({ container: 'matroska', audio: [{ number: 1, codecId: 'A_AC3', codec: 'ac3', language: 'eng', channels: 6, default: true, supported: false, route: null }] });
  assert.equal(silent.supported, false, 'no encoder anywhere: the decoded track is marked silent');
  process.exit(0);
}

globalThis.MediaSource = { isTypeSupported: type => /mp4a\.40/.test(type) };
const track = (number, codecId, codec, language = 'eng') => ({
  number, codecId, codec, language, channels: 6, default: true,
  supported: false, route: null,
});
const ac3 = track(1, 'A_AC3', 'ac3');
const aac = { ...track(2, 'A_AAC', 'aac', 'fin'), channels: 2 };
const truehd = track(3, 'A_TRUEHD', 'truehd');
const header = audio => ({ container: 'matroska', audio });

for (const [codecId, codec] of [['A_AC3', 'ac3'], ['A_EAC3', 'eac3'], ['A_DTS', 'dts']]) {
  const audio = audioDetails(header([track(1, codecId, codec)]));
  assert.equal(audio.supported, true, `${codec} is playable through the player's decoder`);
  assert.equal(audio.channels, 6, 'the details retain the source channel count');
}
assert.equal(audioDetails(header([ac3, aac])).number, 2, 'prefer AAC even when AC3 is first');
assert.equal(audioDetails(header([ac3, aac]), { language: 'en' }).number, 1, 'honour the remembered language');
assert.equal(audioDetails(header([truehd, aac])).number, 2, 'skip an unsupported first track');
assert.equal(audioDetails(header([{ ...truehd, supported: true }])).supported, false, 'recheck stale positive flags too');
assert.equal(audioDetails(header([ac3]), { active: aac }).number, 2, 'the active track overrides header predictions');
assert.equal(audioDetails(null, { active: ac3 }).supported, true, 'active audio works without a cached header');
assert.equal(audioDetails(header([])), null);
assert.equal(audioDetails(null), null);
assert.equal(ac3.supported, false, 'do not mutate cached metadata');

// Node has no WebCodecs encoder, as Firefox for Android has none: the wasm
// AAC encoder is what the capability check must find then.
const setup = await encoderSetup();
assert.equal(setup && setup.encoder.wasm, true, 'without WebCodecs the wasm AAC encoder is chosen');
assert.equal(setup.delay, 1024, "the wasm encoder's priming is FFmpeg's initial_padding");
assert.equal(audioDetails(header([ac3])).supported, true, 'the decoded track plays with the wasm encoder');
assert.equal(audioDetails(header([aac])).supported, true);
execFileSync(process.execPath, [fileURLToPath(import.meta.url)], { env: { ...process.env, KEPULI_NO_AAC: '1' }, stdio: 'inherit' });
console.log('PASS: decoded audio support, stale cache flags, track selection, active audio, the wasm encoder and no encoder at all.');
