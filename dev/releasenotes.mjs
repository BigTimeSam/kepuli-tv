#!/usr/bin/env node
// A draft of the GitHub release notes for the next version, from the
// commits since the last v* tag, for the owner to edit. Nothing is
// published, tagged or written to a file.
//
//   node dev/releasenotes.mjs                 the draft on stdout, notes on what to edit on stderr
//   node dev/releasenotes.mjs --since v1.6.2  from another tag or commit than the last v* tag
//   node dev/releasenotes.mjs > dist/release-notes.md   to edit, for gh release create --notes-file
//
// The previous releases' notes (gh release view v1.6.3) have a one-line
// summary, sections by where a user meets the change (### Start page,
// ### Player, ### Lists …) with plain sentences and the UI's names in bold,
// and a ### Packages section naming the three zips. The draft has the same
// shape: each commit goes into a section by the files it touches, its
// subject as the bullet. Commit subjects here are already sentences about
// the outcome, but written for the repository, not for users, so the draft
// is a start: rewrite the bullets for users, put the UI names in bold,
// merge the bullets that are one change, and drop the section for
// development, which users do not read about, unless something in it
// matters to them.
//
// How a commit is placed: one that touches the runtime (js/, css/,
// player.html, background.js, the manifests) is a user's change, in the
// area most of its runtime files belong to; one whose subject says it only
// moves code (into modules, out of app.js) is development whatever it
// touches. Release commits are left out.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// The sections in the order they are printed. `files` places a commit by
// its runtime files; the first area with the most of them wins.
export const SECTIONS = [
  { title: 'Start page', files: /^js\/(picks|picksui|coversui|collections|home\w*)\.js$/ },
  { title: 'Player', files: /^(js\/(playback|playercontrols|mkv|remux|mp4\w*|audio|ffaudio|transcode|subs|subdisplay|probe|cast|external\w*|infostrip|dom)\.js|player\.html)$/ },
  { title: 'Guide', files: /^js\/(epg|epggrid|guide|guideui|programmesearch|xmltv|reminders\w*)\.js$/ },
  { title: 'Recording', files: /^js\/(recorder|streamhub|recordingsui)\.js$/ },
  { title: 'Lists', files: /^js\/(library|channelprefs|name|international|series\w*|topicbar|logos|logoindex)\.js$/ },
  { title: 'Accounts and providers', files: /^(js\/(api|xtream|m3u\w*|stalker|accounts\w*|sync|permissions|config|db)\.js|background\.js|manifest\.json|firefox\/manifest\.json)$/ },
  { title: 'Languages', files: /^js\/(i18n\.js|locales\/)/ },
  // Whatever else in the runtime: app.js, the stylesheet, a new module.
  { title: 'Everything else in the player', files: /^(js\/|css\/)/ },
  { title: 'Store pages and the website', files: /^(store\/|brand\/|_locales\/|docs\/(index\.html|img\/|privacy\/|terms\/))/ },
  { title: 'Documentation', files: /^(README\.md|docs\/[^/]+\.md|FIREFOX\.md|CHROMECAST\.md)$/ },
  { title: 'Development (usually left out)', files: /./ },
];
const RUNTIME = /^(js\/|css\/|player\.html$|background\.js$|manifest\.json$|firefox\/manifest\.json$)/;
const GUIDES = /(^|\/)(AGENTS|CLAUDE)\.md$/;
const ONLY_MOVES = /\b(out of app\.js|into (a )?modules?|modules? of (its|their) own|in modules|refactor\w*|split)\b/i;
// Subjects that name the tests or CI as what changed.
const DEV_WORK = /^(CI\b|CI's\b|Tests?\b|The test\b|A check\b|Add the CLAUDE)/;
const RELEASE = /^Release \d+\.\d+\.\d+/;

const DEV = 'Development (usually left out)';
const OTHER = 'Everything else in the player';

/** The section of the most files, or the fallback when none has one; ties go to the earlier section. */
function most(files, sections, fallback) {
  const counts = sections.map((s) => files.filter((f) => s.files.test(f)).length);
  const best = Math.max(0, ...counts);
  return best ? sections[counts.indexOf(best)].title : fallback;
}

/** The section a commit belongs to, by its files and its subject. */
export function sectionOf({ subject, files }) {
  const own = files.filter((f) => !GUIDES.test(f));
  const runtime = own.filter((f) => RUNTIME.test(f));
  if (ONLY_MOVES.test(subject) || DEV_WORK.test(subject)) return DEV;
  const at = (title) => SECTIONS.findIndex((s) => s.title === title);
  if (runtime.length) return most(runtime, SECTIONS.slice(0, at(OTHER)), OTHER);
  // Outside the runtime: store pages, docs or tooling, by most files, where
  // a file none of the first two claims counts for development.
  const named = SECTIONS.slice(at('Store pages and the website'), at(DEV));
  const tooling = own.filter((f) => !named.some((s) => s.files.test(f))).length;
  const title = most(own, named, DEV);
  const share = own.filter((f) => SECTIONS[at(title)].files.test(f)).length;
  return title !== DEV && share >= tooling ? title : DEV;
}

/** A subject as a bullet: a sentence, with its full stop. */
const bullet = (subject) => `- ${subject.replace(/\s+$/, '')}${/[.!?]$/.test(subject) ? '' : '.'}`;

/** The draft's Markdown from the commits, newest first as git gives them. */
export function draft(commits, version) {
  const bySection = new Map(SECTIONS.map((s) => [s.title, []]));
  for (const c of [...commits].reverse()) {
    if (RELEASE.test(c.subject)) continue;
    bySection.get(sectionOf(c)).push(bullet(c.subject));
  }
  const lines = ['One sentence on what this release is about, for users.', ''];
  for (const [title, bullets] of bySection) {
    if (!bullets.length) continue;
    lines.push(`### ${title}`, '', ...bullets, '');
  }
  lines.push('### Packages', '',
    `- \`kepuli-tv-chrome-${version}.zip\` — Chrome`,
    `- \`kepuli-tv-firefox-${version}.zip\` — Firefox`,
    `- \`kepuli-tv-firefox-${version}-amo-source.zip\` — the source archive for AMO review`);
  return lines.join('\n') + '\n';
}

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });

/** The newest v* tag that HEAD descends from. */
function lastTag() {
  for (const tag of git('tag', '--list', 'v*', '--sort=-v:refname').split('\n').filter(Boolean)) {
    try { git('merge-base', '--is-ancestor', tag, 'HEAD'); return tag; } catch { /* not behind HEAD */ }
  }
  throw new Error('no v* tag behind HEAD: name the start with --since');
}

/** The commits after `since`, newest first, each with its subject and files. */
function commitsSince(since) {
  const out = git('log', '--no-merges', '--format=%x1e%h%x1f%s', '--name-only', `${since}..HEAD`);
  return out.split('\x1e').filter((c) => c.trim()).map((chunk) => {
    const [head, ...rest] = chunk.split('\n');
    const [sha, subject] = head.split('\x1f');
    return { sha, subject, files: rest.map((l) => l.trim()).filter(Boolean) };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  try {
    const unknown = args.filter((a, i) => a !== '--since' && args[i - 1] !== '--since');
    if (unknown.length) throw new Error(`unknown argument ${unknown.join(' ')}`);
    const since = args.includes('--since') ? args[args.indexOf('--since') + 1] : lastTag();
    if (!since) throw new Error('--since needs a tag or commit');
    const { version } = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
    const commits = commitsSince(since);
    if (!commits.length) throw new Error(`no commits since ${since}`);
    process.stdout.write(draft(commits, version));
    const note = [`\n${commits.length} commit(s) since ${since}, drafted for ${version}.`];
    if (`v${version}` === since) note.push(`manifest.json is still ${version}, the version of ${since}: the packages named are for the version after the bump.`);
    note.push('A draft: rewrite the bullets for users in the style of the last release',
      `(gh release view ${since}), put the UI names in bold, and drop the development section.`);
    console.error(note.join('\n'));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
