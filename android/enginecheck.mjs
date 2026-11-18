#!/usr/bin/env node
// Whether the apps carry the engine Mozilla last released.
//
// The apps are a browser's engine (GeckoView) around the player, and what
// it reads is a provider's: playlists, pictures, streams. Mozilla puts out
// a new major about every four weeks and fixes in between, most of them
// for security, and an app keeps the engine it was built with until it is
// built again. The version is pinned in app/build.gradle on purpose (a
// build must not change under a commit), so nothing said when it fell
// behind: 160 of 4 November was still there when 160 of 16 November had
// been out for two days.
//
//   node android/enginecheck.mjs            the pinned engine against Mozilla's Maven
//   node android/enginecheck.mjs --latest   print the newest version, for the bump
//
// It fails once a newer engine has been out for GRACE_DAYS: time enough to
// take it in a commit of its own, as android/AGENTS.md says how (build,
// permissions, a start on both emulators, and the engine's silence
// measured again). Before that it only says so. The nightly CI run and a
// run on demand ask; a push does not, so that a commit about something
// else is not red for Mozilla's calendar.

import { readFileSync } from 'node:fs';

const HERE = new URL('.', import.meta.url).pathname;
const METADATA = 'https://maven.mozilla.org/maven2/org/mozilla/geckoview/geckoview/maven-metadata.xml';
const GRACE_DAYS = 7;

/** "160.0.20261104181552" as { major, stamp, at }: the build's moment is in its name, in UTC. */
export function parse(version) {
  const m = /^(\d+)\.(\d+)\.(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(version);
  if (!m) return null;
  const [, major, , y, mo, d, h, mi, s] = m;
  return { version, major: Number(major), stamp: `${y}${mo}${d}${h}${mi}${s}`, at: Date.UTC(+y, mo - 1, +d, +h, +mi, +s) };
}

/** The newest of the versions: by major, then by the build's moment. */
export function newest(versions) {
  return versions.map(parse).filter(Boolean).sort((a, b) => a.major - b.major || a.stamp.localeCompare(b.stamp)).at(-1) || null;
}

/**
 * What to say of the pinned engine: `behind` when a newer one exists, and
 * `late` when that one has been out longer than the grace.
 */
export function verdict(pinned, latest, now, graceDays = GRACE_DAYS) {
  const behind = latest.major > pinned.major || (latest.major === pinned.major && latest.stamp > pinned.stamp);
  const days = Math.floor((now - latest.at) / 86400000);
  return { behind, late: behind && days >= graceDays, days };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const gradle = readFileSync(`${HERE}app/build.gradle`, 'utf8');
  const pinned = parse(/org\.mozilla\.geckoview:geckoview:([\d.]+)'/.exec(gradle)?.[1] || '');
  if (!pinned) { console.error('FAIL  no GeckoView version found in android/app/build.gradle'); process.exit(1); }
  let xml;
  try {
    const res = await fetch(METADATA, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    xml = await res.text();
  } catch (err) {
    // Mozilla's server not answering is not the app's fault, and not news.
    console.log(`skip  Mozilla's Maven did not answer (${err.message}); the pinned engine is ${pinned.version}`);
    process.exit(0);
  }
  const latest = newest([...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1]));
  if (!latest) { console.error('FAIL  Mozilla\'s Maven lists no version this tool can read'); process.exit(1); }
  if (process.argv.includes('--latest')) { console.log(latest.version); process.exit(0); }
  const { behind, late, days } = verdict(pinned, latest, Date.now());
  if (!behind) console.log(`PASS  the engine is Mozilla's latest, ${pinned.version}`);
  else if (!late) console.log(`note  ${latest.version} came out ${days} day(s) ago; the apps carry ${pinned.version}. Take it within ${GRACE_DAYS} days of its release (android/AGENTS.md, "The engine's version")`);
  else console.error(`FAIL  the apps carry ${pinned.version}, and ${latest.version} has been out for ${days} days: update the engine (android/AGENTS.md, "The engine's version")`);
  process.exit(late ? 1 : 0);
}
