#!/usr/bin/env node
// No secret in a commit: the lines a commit adds, checked for credentials
// before they leave the machine.
//
//   node dev/secretcheck.mjs            the staged changes (run before git commit)
//   node dev/secretcheck.mjs --all      every tracked file as it stands
//   node dev/secretcheck.mjs --range A..B   the lines added between two commits
//
// Two kinds of finding. The first is a shape any key has: an OpenAI key
// (sk-…), a Google OAuth secret or refresh token, a private key block, a
// user name and password written into a URL. The second is a list kept
// outside the project, ~/.config/kepuli-tv/secrets-denylist, one string a
// line: the host, user name and password of a real provider account used
// for testing, which have no shape of their own and must never be
// committed. The list stays on this machine; this file names none of it.
//
// A finding prints the file and the line with the secret masked, and the
// exit code is 1. The mock server's demo/demo and the placeholder
// user:secret of the tests are not findings.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DENYLIST = join(homedir(), '.config', 'kepuli-tv', 'secrets-denylist');
const SHAPES = [
  ['OpenAI key', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/],
  ['Google OAuth client secret', /\bGOCSPX-[A-Za-z0-9_-]{20,}/],
  ['Google refresh token', /\b1\/\/0[A-Za-z0-9_-]{30,}/],
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['credentials in a URL', /\b[a-z][a-z0-9+.-]*:\/\/(?!(?:demo:demo|user:secret|user:pass|username:password)@)[^\s/:@'"`]+:[^\s/@'"`]{3,}@/i],
  ['AMO JWT secret', /"secret"\s*:\s*"[0-9a-f]{40,}"/],
];
const ALLOWED = [/\$\{[^}]+\}/, /<[^>]+>/, /…/];   // templates and placeholders in docs and code

const denied = existsSync(DENYLIST)
  ? readFileSync(DENYLIST, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  : [];

const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
const args = process.argv.slice(2);

/** [file, line number, text] of every line to check. */
function lines() {
  if (args[0] === '--all') {
    return git(['grep', '-n', '-I', '-e', '', '--', '.', ':!*.png', ':!*.zip']).split('\n').filter(Boolean).map((l) => {
      const m = /^(.*?):(\d+):(.*)$/s.exec(l);
      return m ? [m[1], Number(m[2]), m[3]] : null;
    }).filter(Boolean);
  }
  const diff = args[0] === '--range' ? git(['diff', '-U0', args[1]]) : git(['diff', '--cached', '-U0']);
  const out = [];
  let file = '', at = 0;
  for (const l of diff.split('\n')) {
    if (l.startsWith('+++ ')) { file = l.slice(6); continue; }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(l);
    if (hunk) { at = Number(hunk[1]); continue; }
    if (l.startsWith('+') && !l.startsWith('+++')) out.push([file, at++, l.slice(1)]);
  }
  return out;
}

const mask = (text, secret) => text.split(secret).join(secret.slice(0, 3) + '…');
let found = 0;
for (const [file, n, text] of lines()) {
  for (const s of denied) {
    if (text.includes(s)) { found++; console.log(`${file}:${n}: a string from ${DENYLIST}: ${mask(text, s).trim().slice(0, 160)}`); }
  }
  for (const [what, re] of SHAPES) {
    const m = re.exec(text);
    if (m && !ALLOWED.some((a) => a.test(m[0]))) { found++; console.log(`${file}:${n}: ${what}: ${mask(text, m[0]).trim().slice(0, 160)}`); }
  }
}
if (!denied.length) console.log(`note: ${DENYLIST} is missing or empty; only the shapes were checked`);
console.log(found ? `${found} finding(s): take them out before committing` : 'no secrets found');
process.exit(found ? 1 : 0);
