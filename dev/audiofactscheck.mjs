#!/usr/bin/env node
// Cached codec flags must not contradict the player's audio route or selection.
import assert from 'node:assert/strict';
import { audioDetails } from '../js/probe.js';
import { encoderSetup } from '../js/transcode.js';

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

// Node has no WebCodecs encoder: after the capability check, the decoded
// route really is unavailable and must still show the warning.
await encoderSetup();
assert.equal(audioDetails(header([ac3])).supported, false);
assert.equal(audioDetails(header([aac])).supported, true);
assert.equal(audioDetails(header([ac3]), { active: ac3 }).supported, true, 'confirmed playback takes precedence');
console.log('PASS: decoded audio support, stale cache flags, track selection, active audio and missing encoder.');
