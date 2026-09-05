#!/usr/bin/env node
// Source submission for AMO. The extension ZIP is built separately by
// dev/package.mjs; this archive is for reviewers, never for installation.
//
// node firefox/amo-source.mjs [--ref HEAD] [--worktree]
// KEPULI_FFMPEG_SOURCE may name a clean checkout of FFmpeg n7.1.1.

import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { ROOT, SHARED, gitSource, worktreeSource, check } from '../dev/package.mjs';

const FFMPEG_COMMIT = 'db69d06eeeab4f46da15030a80d539efb4503ca8';
const args = process.argv.slice(2);
let ref = 'HEAD';
let worktree = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--worktree') worktree = true;
  else if (args[i] === '--ref' && args[i + 1] && !args[i + 1].startsWith('--')) ref = args[++i];
  else throw new Error(`Unknown or incomplete argument: ${args[i]}`);
}
if (worktree && ref !== 'HEAD') throw new Error('--ref and --worktree cannot be combined');

const source = worktree ? worktreeSource() : gitSource(ref);
const problems = check(source);
if (problems.length) throw new Error(problems.join('\n'));
const { version } = JSON.parse(source.read('firefox/manifest.json'));
if (!/^\d+(\.\d+){1,3}$/.test(version)) throw new Error('Unexpected extension version');
const ffmpeg = resolve(process.env.KEPULI_FFMPEG_SOURCE || join(homedir(), '.cache/kepuli-tv-build/ffmpeg'));
const ffSha = execFileSync('git', ['-C', ffmpeg, 'rev-parse', 'n7.1.1^{commit}'], { encoding: 'utf8' }).trim();
if (ffSha !== FFMPEG_COMMIT) throw new Error('FFmpeg n7.1.1 does not match the reviewed source commit');

const dir = join(ROOT, 'dist', 'amo-source');
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
source.exportTo([
  ...SHARED, 'manifest.json', 'firefox/manifest.json', 'LICENSE',
  'dev/package.mjs', 'dev/wasm/build.sh', 'dev/wasm/ffaudio.c', 'dev/wasm/verify.mjs',
  'dev/mock/server.mjs', 'dev/mock/media.sh',
  'firefox/AMO-BUILD.md',
], dir);
cpSync(join(dir, 'firefox', 'AMO-BUILD.md'), join(dir, 'README.md'));
const upstream = join(dir, 'upstream', 'ffmpeg');
mkdirSync(upstream, { recursive: true });
const tar = join(dir, '.ffmpeg.tar');
execFileSync('git', ['-C', ffmpeg, 'archive', '--format=tar', '-o', tar, FFMPEG_COMMIT]);
execFileSync('tar', ['-xf', tar, '-C', upstream]);
rmSync(tar);
writeFileSync(join(dir, 'SOURCE.json'), JSON.stringify({
  version, source: source.label, ffmpeg: { tag: 'n7.1.1', commit: FFMPEG_COMMIT },
  emscripten: '6.0.9',
}, null, 2) + '\n');
const name = `kepuli-tv-firefox-${version}-amo-source.zip`;
const out = join(ROOT, name);
rmSync(out, { force: true });
execFileSync('zip', ['-rqX', out, '.', '-x', '*.DS_Store'], { cwd: dir });
const entries = execFileSync('unzip', ['-Z1', out], { encoding: 'utf8' }).split('\n');
for (const required of ['README.md', 'SOURCE.json', 'dev/wasm/ffaudio.c', 'upstream/ffmpeg/libavcodec/ac3dec.c']) {
  if (!entries.includes(required)) throw new Error(`Source archive is missing ${required}`);
}
console.log(`${name}: ${Math.round(readFileSync(out).length / 1024 / 1024)} MB, from ${source.label}`);
