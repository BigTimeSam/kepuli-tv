#!/usr/bin/env node
// The typed modules type-check: every error TypeScript's checker finds in
// them is counted, and any one fails the check.
//
//   node dev/typecheck.mjs
//
// Why: namecheck.mjs takes only the checker's answers about names and
// modules, because most of js/ is untyped and its hundreds of property and
// argument complaints say nothing. The core modules below carry
// `// @ts-check` and JSDoc types instead — the settings and accounts, the
// catalogue's data layer, the Xtream client and the playback engine — so
// that a field misspelt, an option a caller passes that the callee does
// not take, or a list handed where one item belongs is found before a
// browser runs. Typing them found two such already: the MKV unpacker's and
// the MP4 reader's options did not name the onAnswer that playback.js
// passes, and Library.sortItems() said its label took one argument where
// it is given two.
//
// Only errors in the typed files count. Their imports are read for their
// types, and the untyped ones among them have errors of their own that are
// not this check's business; namecheck.mjs watches those for what would
// fail at runtime. A file in TYPED must begin with `// @ts-check`, so that
// an editor checks it the same way while it is being written.
//
// The globals player.html loads with a script tag (hls.js, mpegts.js) are
// declared in dev/types/globals.d.ts, which js/playback.js names in a
// triple-slash comment. The compiler comes from npm through npx at a pinned
// version, downloaded on first use; the project itself stays without
// dependencies.
//
// Exit code 0 when the typed files are clean, 1 otherwise.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TYPESCRIPT = 'typescript@5.9';
// The typed modules. A module joins the list once the checker finds
// nothing in it, and stays clean from then on.
const TYPED = ['js/config.js', 'js/library.js', 'js/api.js', 'js/sidescroll.js', 'js/svg.js',
  'js/playback.js', 'js/browser.js', 'js/channelprefs.js', 'js/db.js',
  'js/dom.js', 'js/ebml.js', 'js/epg.js', 'js/epggrid.js', 'js/fetchtext.js',
  'js/format.js', 'js/guide.js', 'js/help.js', 'js/i18n.js',
  'js/international.js', 'js/lang.js', 'js/listorder.js', 'js/logos.js',
  'js/m3u.js', 'js/m3usource.js', 'js/mediafilters.js', 'js/mkv.js',
  'js/mp4.js', 'js/mp4file.js', 'js/mp4play.js', 'js/name.js',
  'js/nextepisode.js', 'js/permissions.js', 'js/picker.js', 'js/picks.js',
  'js/playing.js', 'js/poster.js', 'js/probe.js', 'js/rating.js',
  'js/recorder.js', 'js/remux.js', 'js/route.js', 'js/stalker.js',
  'js/state.js', 'js/streamhub.js', 'js/subdisplay.js', 'js/subs.js',
  'js/sync.js', 'js/testclock.js', 'js/tilekeys.js', 'js/titleinfo.js',
  'js/titlemeta.js', 'js/transcode.js', 'js/xmltv.js', 'js/xtream.js'];

const problems = [];
for (const file of TYPED) {
  if (!/^\/\/ @ts-check\b/.test(readFileSync(join(ROOT, file), 'utf8'))) problems.push(`${file}:1:1  does not begin with // @ts-check`);
}

const run = spawnSync('npx', ['-y', '-p', TYPESCRIPT, 'tsc', '--allowJs', '--checkJs', '--noEmit', '--skipLibCheck', '--pretty', 'false',
  '--target', 'es2023', '--module', 'esnext', '--moduleResolution', 'bundler', '--lib', 'es2023,dom,dom.iterable', ...TYPED],
  { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
if (run.error) { console.error(`typecheck: npx failed: ${run.error.message}`); process.exit(1); }

const typed = new Set(TYPED);
const output = run.stdout + run.stderr;
const lines = output.split('\n');
let any = false;
for (let i = 0; i < lines.length; i++) {
  const m = /^(.+?)\((\d+),(\d+)\): error TS(\d+): (.*)$/.exec(lines[i]);
  if (!m) continue;
  any = true;
  if (!typed.has(m[1])) continue;
  // The lines indented below an error are its explanation: kept with it.
  const more = [];
  while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) more.push(lines[++i]);
  problems.push([`${m[1]}:${m[2]}:${m[3]}  TS${m[4]}  ${m[5]}`, ...more].join('\n'));
}
// A compiler that failed without one error line in the usual form did not
// check anything: an option it refused, a file it could not read.
if (run.status !== 0 && !any) {
  console.error(`typecheck: tsc did not run as expected:\n${output.slice(0, 2000)}`);
  process.exit(1);
}
for (const p of problems) console.log(p);
console.log(problems.length ? `${problems.length} type error(s) in the typed files` : `the typed files type-check (${TYPED.length} files)`);
process.exit(problems.length ? 1 : 0);
