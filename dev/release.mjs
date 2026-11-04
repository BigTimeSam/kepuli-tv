#!/usr/bin/env node
// Is this commit ready to be released? Every check a release needs, in one
// run, with what is left to do by hand at the end.
//
//   node dev/release.mjs              the checks, for the version in manifest.json
//   node dev/release.mjs --no-visual  without the visual check (another system's fonts)
//   node dev/release.mjs --quick      without the browser checks (visual, ui)
//
// Nothing is tagged, uploaded or published here: the release itself waits
// for the owner's go (AGENTS.md, rule 2) and follows the steps printed at
// the end. What this answers is whether those steps may start: the checkout
// is clean and pushed, CI is green on this very commit, the two manifests
// agree and the version is new, the texts and translations are in step,
// the reviewer notes fit AMO's form, and the code checks pass.
//
// Exit code 0 when everything is ready, 1 otherwise.

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const QUICK = args.includes('--quick');
const VISUAL = !QUICK && !args.includes('--no-visual');
const sh = (cmd, cmdArgs) => execFileSync(cmd, cmdArgs, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const version = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8')).version;
const results = [];
const check = (name, fn) => {
  let ok, detail;
  try { [ok, detail] = fn(); } catch (err) { ok = false; detail = err.message.split('\n')[0]; }
  results.push({ name, ok, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `: ${detail}` : ''}`);
};
const node = (script, scriptArgs = []) => () => {
  const r = spawnSync(process.execPath, [join(ROOT, 'dev', script), ...scriptArgs], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const last = (r.stdout + r.stderr).trim().split('\n').filter(Boolean).pop() || '';
  return [r.status === 0, last.slice(0, 160)];
};

console.log(`Kepuli-TV ${version}: is it ready to release?\n`);

check('the checkout is clean', () => {
  const dirty = sh('git', ['status', '--porcelain']);
  return [!dirty, dirty ? `${dirty.split('\n').length} uncommitted change(s)` : ''];
});
check('the commit is pushed', () => {
  sh('git', ['fetch', '-q', 'origin']);
  const ahead = sh('git', ['rev-list', '--count', 'origin/main..HEAD']);
  const behind = sh('git', ['rev-list', '--count', 'HEAD..origin/main']);
  return [ahead === '0' && behind === '0', `${ahead} ahead, ${behind} behind origin/main`];
});
check('CI is green on this commit', () => {
  const sha = sh('git', ['rev-parse', 'HEAD']);
  const runs = JSON.parse(sh('gh', ['run', 'list', '--workflow', 'checks.yml', '--commit', sha, '--json', 'status,conclusion,event']));
  const run = runs.find((r) => r.event === 'push') || runs[0];
  if (!run) return [false, 'no run for this commit yet'];
  return [run.conclusion === 'success', run.status === 'completed' ? run.conclusion : run.status];
});
check(`${version} is a new version`, () => {
  const tags = sh('git', ['tag', '--list', 'v*']).split('\n');
  return [!tags.includes(`v${version}`), tags.includes(`v${version}`) ? `v${version} is already tagged: bump both manifests` : ''];
});
check('the two manifests agree', node('package.mjs', ['--check']));
check('the translations are of the English as it stands', node('translations.mjs', ['--check']));
check('the store listings are in step and within limits', node('listings.mjs', ['--check']));
check('the Pages front page is rendered from the README', node('site.mjs', ['--check']));
check('the notes to AMO\'s reviewer fit its form', () => {
  const notes = readFileSync(join(ROOT, 'firefox', 'reviewer-notes.txt'), 'utf8').trim();
  const counted = notes.replace(/\r?\n/g, '\r\n').length;     // the form counts a line break as two
  const mentions = notes.includes(version);
  return [counted <= 3000 && mentions, `${counted}/3000 characters${mentions ? '' : `, and no line for ${version}`}`];
});
check('unit tests', node('unitcheck.mjs'));
check('every name and import resolves', node('namecheck.mjs'));
check('the typed modules type-check', node('typecheck.mjs'));
check('markup only from constants', node('htmlcheck.mjs'));
check('the guides name what exists', node('docscheck.mjs'));
check('no secrets in the repository', node('secretcheck.mjs', ['--all']));
if (!QUICK) check('UI regressions', node('uicheck.mjs'));
if (VISUAL) check('the five store views match their references', node('visualcheck.mjs'));

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length ? `${failed.length} of ${results.length} checks failed: not ready.` : `All ${results.length} checks pass.`}`);
console.log(`
Not checked here, before the go:
  - the full playback suite in your own profile: node dev/playcheck.mjs (and the scenarios
    of what changed in Firefox: KEPULI_BROWSER=firefox node dev/playcheck.mjs <scenario>)
  - the release notes, in the style of the last GitHub release
  - store screenshots retaken if the five views changed (brand/AGENTS.md)

Then, with the owner's go: the steps under "Release" in AGENTS.md (package, tag,
GitHub release, AMO, Chrome Web Store), and after Chrome's approval:
  node dev/cws-publish.mjs verify`);
process.exit(failed.length ? 1 : 0);
