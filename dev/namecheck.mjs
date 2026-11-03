#!/usr/bin/env node
// Every name the player's code uses is defined or imported, and every
// import exists: the mistakes that only show at runtime, as a ReferenceError
// or a module that fails to load, found before a browser runs.
//
//   node dev/namecheck.mjs
//
// Why: moving the recording UI out of app.js left one namespace import
// behind (`store`), and every channel stopped playing with a ReferenceError
// that no Node test could see. This would have said so.
//
// TypeScript's checker reads the plain JavaScript (allowJs, checkJs) and
// only its answers about names and modules are taken — not types: the code
// is not typed, and its hundreds of property and argument complaints are
// not what this checks. The compiler comes from npm through npx at a pinned
// version, downloaded on first use; the project itself stays without
// dependencies. Globals that player.html loads with a script tag (hls.js,
// mpegts.js) are allowed by name. vendor/ is not checked.
//
// Exit code 0 when nothing is found, 1 otherwise.

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TYPESCRIPT = 'typescript@5.9';
const SCRIPT_GLOBALS = new Set(['Hls', 'mpegts']);
// Cannot find name (2304, 2552, 2580, 2662, 2663), used before its
// declaration (2448, 2449, 2450, 2454), no such module (2307, 2792), no such
// export (2305, 2459, 2460, 2614, 2724), assignment to an import or a
// constant (2539, 2588, 2632).
const RUNTIME = new Set([2304, 2552, 2580, 2662, 2663, 2448, 2449, 2450, 2454, 2307, 2792, 2305, 2459, 2460, 2614, 2724, 2539, 2588, 2632]);

const files = [...readdirSync(join(ROOT, 'js')).filter((f) => f.endsWith('.js')).map((f) => `js/${f}`), 'background.js'];
const run = spawnSync('npx', ['-y', '-p', TYPESCRIPT, 'tsc', '--allowJs', '--checkJs', '--noEmit', '--skipLibCheck', '--pretty', 'false',
  '--target', 'es2023', '--module', 'esnext', '--moduleResolution', 'bundler', '--lib', 'es2023,dom,dom.iterable', ...files],
  { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
if (run.error) { console.error(`namecheck: npx failed: ${run.error.message}`); process.exit(1); }

const found = [];
for (const line of (run.stdout + run.stderr).split('\n')) {
  const m = /^(.+?)\((\d+),(\d+)\): error TS(\d+): (.*)$/.exec(line);
  if (!m || m[1].startsWith('vendor/') || !RUNTIME.has(Number(m[4]))) continue;
  const name = /Cannot find name '([^']+)'/.exec(m[5])?.[1];
  if (name && SCRIPT_GLOBALS.has(name)) continue;
  found.push(`${m[1]}:${m[2]}:${m[3]}  TS${m[4]}  ${m[5]}`);
}
if (!/error TS|^\s*$/.test(run.stdout + run.stderr) && run.status !== 0 && !found.length) {
  console.error(`namecheck: tsc did not run as expected:\n${(run.stdout + run.stderr).slice(0, 2000)}`);
  process.exit(1);
}
for (const f of found) console.log(f);
console.log(found.length ? `${found.length} name or module problem(s)` : `every name and import resolves (${files.length} files)`);
process.exit(found.length ? 1 : 0);
