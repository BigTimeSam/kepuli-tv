#!/usr/bin/env node
// The words Android shows of the phone's and the tablet's app outside the
// player's page: the names of its two notification channels (in the
// system's settings) and of the buttons on the playback notification. They
// are the player's own strings, so that they exist in every language the
// player has and are translated in one place (js/i18n.js, js/locales/).
//
//   node android/strings.mjs <res directory>   → values/strings_app.xml, values-<lang>/…
//
// Run by Gradle (syncStrings in android/app/build.gradle); no dependencies.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LANGUAGES, loadLanguage, setLanguage, t } from '../js/i18n.js';

// Android's name of the string, and the player's key.
const STRINGS = {
  channel_reminders: 'app.reminders',
  channel_playback: 'setup.tab.playback',
  action_play: 'rec.play',
  action_pause: 'app.pause',
};

// Android's directory for a language where it is not the plain code:
// Indonesian by its old code, Serbian in the Latin script as the player
// writes it.
const QUALIFIER = { id: 'in', sr: 'b+sr+Latn' };

const out = process.argv[2];
if (!out) {
  console.error('usage: node android/strings.mjs <res directory>');
  process.exit(1);
}
rmSync(out, { recursive: true, force: true });

const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');

for (const lang of Object.keys(LANGUAGES)) {
  await loadLanguage(lang);
  setLanguage(lang);
  const rows = Object.entries(STRINGS).map(([name, key]) => `    <string name="${name}">${escape(t(key))}</string>`);
  const dir = join(out, lang === 'en' ? 'values' : `values-${QUALIFIER[lang] || lang}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'strings_app.xml'), `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n${rows.join('\n')}\n</resources>\n`);
}
