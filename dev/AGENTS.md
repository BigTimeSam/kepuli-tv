# dev/: tools, tests and looking at the result

Every tool is a single Node 22+ script with no dependencies (Python ones run
with `uv run` and declare their own); each starts with a comment that says
what it does and how to run it. Read that header before using one.

## The tools

| Area | Scripts |
| --- | --- |
| Development loop | `dev.mjs` (the owner's Chrome loop, port 9222: do not run it as an agent), `screenshot.mjs` (Chrome helpers: `ensureChrome`, `openPlayer`, `session`, `capture`) |
| Tests | `unitcheck.mjs`, `playcheck.mjs`, `uicheck.mjs`, `visualcheck.mjs` (the five views against `visual/`), and per-area `demuxcheck`, `audiocheck`, `audiofactscheck`, `mediafilterscheck`, `ratingcheck`, `searchnamescheck`, `titlelinkscheck`, `moviedurationcheck` |
| Mock provider | `mock/` (see `mock/AGENTS.md`) |
| Translations and texts | `translations.mjs`, `listings.mjs`, `glossarycheck.mjs` (each language's term for the core concepts, `store/i18n-glossary.json`), `translationreview.mjs` (Codex cross-check, see `js/locales/AGENTS.md`), `site.mjs` (README → `docs/index.html`) |
| Packaging | `package.mjs` (allowlist packages from git HEAD; `--zip`, `--worktree`, `--check`: the manifests agree and ask only for the permissions in its `APPROVED`, each with its reason; `--zip` moves older zips from the root into `dist/releases/`), `release.mjs` (is this commit ready to release: every check in one run), `releasenotes.mjs` (a draft of the GitHub release notes from the commits since the last tag, printed for the owner to edit) |
| Stores | `cws-publish.mjs`, `cws-listing-fill.mjs`, `cws-screenshots.mjs`, `cws-auth.mjs`, `amo-publish.mjs`, `amo-screenshots.mjs` (see `store/AGENTS.md`) |
| Pictures and video | `store-screenshots.mjs`, `demo-video.mjs`, `demo-music.py`, `logos.mjs` (regenerates `js/logoindex.js`) |
| Refactoring | `splitsection.py`: one section of `js/app.js` into a module of its own, imports and exports rewired (see `js/AGENTS.md`) |
| Guides | `docscheck.mjs`: every file and command the guides name exists, every tool and module is described, every AGENTS.md has its CLAUDE.md, every relative link lands |
| Safety | `secretcheck.mjs`: run on the staged changes before every commit; `namecheck.mjs`: every name and import in `js/` resolves (TypeScript's checker via npx, names and modules only); `typecheck.mjs`: the typed modules (`// @ts-check` and JSDoc, listed in it and in `js/AGENTS.md`) have no type error at all, with the script-tag globals declared in `types/globals.d.ts`; `htmlcheck.mjs`: markup is written only from icon constants, nothing evaluates a string; `vendorcheck.mjs`: every file in `vendor/` has the SHA-256 and upstream version listed in `vendor/CHECKSUMS` (`--update` after a deliberate upgrade) |
| Audio decoder | `wasm/` (`build.sh` builds `vendor/ffaudio` from FFmpeg; see `vendor/AGENTS.md`) |

When you add a tool: one file, a header comment with its usage lines, no
dependencies, credentials only from `~/.config/kepuli-tv/` (mode 600) or the
environment, and a line in the table above.

Nothing here needs a real provider: the mock server in `dev/mock/` invents a
whole Xtream catalogue (countries, channels with programme data and archive,
films, series with MKV episodes and subtitles, an M3U playlist and a Stalker
portal). Real accounts are for the owner's manual testing only.

## Browsers, ports and profiles

| Port | Who | Profile | Touch? |
| --- | --- | --- | --- |
| 9222 | the owner's development Chrome (`dev/dev.mjs`) | `~/.cache/kepuli-tv-dev` | **no**, read-only probes at most |
| 2828 | the owner's development Firefox (`firefox/dev.mjs`) | `~/.cache/kepuli-tv-firefox` | **no** |
| 9333 (suggested) | your test Chrome | a scratch directory | yes |
| 2838 (suggested) | your test Firefox | a scratch directory | yes |
| 9341 | `dev/uicheck.mjs` (`KEPULI_UI_PORT`) | temporary | yes |
| 9370 | `dev/demo-video.mjs` (`KEPULI_VIDEO_PORT`) | temporary | yes |
| 9444 | the Chrome Web Store dashboard Chrome | `~/.config/kepuli-tv/cws-chrome` (signed in) | only through the store tools |
| 8790 / 8791 | mock server / second mock account | | one run at a time |

Every Chrome tool reads `KEPULI_DEV_PORT` and `KEPULI_DEV_PROFILE` (and
`KEPULI_CHROME` for another browser binary: CI uses Chromium, as branded
Chrome on Linux leaves an unpacked extension's pages blank); Firefox
tools `KEPULI_FIREFOX_PORT` and `KEPULI_FIREFOX_PROFILE`. So a test run that
leaves the owner's browsers alone is:

```
export KEPULI_DEV_PORT=9333 KEPULI_DEV_PROFILE=/tmp/kepuli-agent-profile KEPULI_HEADLESS=1
node dev/playcheck.mjs
```

The suite resets the extension's settings and lists in that profile to demo
data, so never point it at a profile someone uses.

## The checks

- `node dev/unitcheck.mjs`: pure functions in Node, a few seconds. Run it
  after every change.
- `node dev/typecheck.mjs`: every error TypeScript finds in the typed
  modules (`js/config.js`, `js/library.js`, `js/api.js`, `js/playback.js`),
  all kinds counted. A few seconds; run it after changing one of them, or
  the JSDoc of something they import.
- `node dev/namecheck.mjs`: undefined names, missing imports and exports,
  use before declaration: what would be a `ReferenceError` or a module that
  does not load. Two seconds; run it after moving or renaming anything.
- `node dev/playcheck.mjs [scenario …]`: about 80 browser scenarios (playback,
  recovery, guide, accounts, recording, the start page…), each against a fresh
  mock server. Run the scenarios near your change while working, and the full
  suite before a release. The scenario list and what each asserts is at the top
  of the file and in `SCENARIOS` at its end.
- `node dev/uicheck.mjs`: layout and navigation regressions, headless,
  temporary profile.
- `node dev/visualcheck.mjs`: the five store views, taken with the mock
  server's and the page's clocks set to one moment (`KEPULI_MOCK_NOW`,
  `player.html?testnow=`, `js/testclock.js`), compared pixel by pixel with
  `dev/visual/*.png`; what moves by itself (picture, subtitles, progress bars,
  now line) is masked. A failure prints the views and keeps difference images
  (changes in red). When a change to the views is meant, look at the
  differences, run `--update`, and commit the new references with the change.
  The references are macOS renderings; on another system make local ones and
  do not commit them.
- `KEPULI_BROWSER=firefox node dev/playcheck.mjs [scenario]`: the same in
  Firefox through Marionette (opens a window).
- `node dev/vendorcheck.mjs`: `vendor/` is exactly the third-party code
  listed in `vendor/CHECKSUMS`, hash and upstream version; under a second.
- Smaller checks for one area each: `dev/demuxcheck.mjs`, `dev/audiocheck.mjs`,
  `dev/mediafilterscheck.mjs`, `dev/ratingcheck.mjs`, `dev/searchnamescheck.mjs`,
  `dev/titlelinkscheck.mjs`, `dev/moviedurationcheck.mjs`.

`sh dev/mock/media.sh` must have run once (needs ffmpeg) before anything plays.

Mock behaviour is switched by environment variables read per request, e.g.
`KEPULI_MOCK_LIVE_TS=1` (live as MPEG-TS, needed for recording),
`KEPULI_MOCK_THROTTLE`, `KEPULI_MOCK_BAD_GATEWAY`, `KEPULI_MOCK_LIMIT`; grep
`process.env.KEPULI_MOCK` in `dev/mock/server.mjs` for the full set, and add
one there when a scenario needs a new kind of misbehaving server.

### Performance

The `perf` scenario serves 50,000 films more (`KEPULI_MOCK_BULK`) and
measures the list's load, the scroll (95th-percentile frame), a search
from the middle of the catalogue and the page's heap, against bounds well
above this machine's numbers (on 2026-11-04: 320 ms, 17 ms, 456 ms, 53 MB;
19 rows in the DOM). It fails on a regression, a list that stops being
virtual, a search that walks the DOM or a leak, and reports the numbers
every run: compare them with these before and after a change to the lists,
search or rows.

### CI

`.github/workflows/checks.yml` runs the Node-only checks (unit, names, types, markup, area
checks, listings, translations, the Pages page, the manifests, vendor/'s
checksums, secrets) on
every push and pull request, and `uicheck` plus the full `playcheck` in
headless Chrome every night and on demand (`gh workflow run Checks`). Keep
new checks runnable there: no secrets, no provider, the mock server only.
Look at a red run with `gh run list` and `gh run view --log-failed`.

### Known flakes, not bugs

- `record`'s plan step timed out twice around midnight (2026-11-04 00:05) and
  passed at 00:15 on the same code; not explained yet. If it fails, run it
  again, and if it fails away from midnight, it is a real failure.
- Scenarios that fail together with `EADDRINUSE`: a stray mock server holds
  8790 or 8791. Find it with `lsof -nP -iTCP:8790 -sTCP:LISTEN` and stop it if
  it is yours.

## Writing a scenario

Copy the shape of a neighbour in `dev/playcheck.mjs`: an `async function name(page)`
that drives the page with `evaluate`, `click`, `waitFor`, asserts with a
message that says what was seen, returns `{ ok: true, detail }`, and is added
to `SCENARIOS`. Clean up what it changed (settings, storage) in a `finally`.
A regression test must fail without the fix: run it once on the old code.

Interaction details that have mattered:

- Use real input events (`Input.dispatchMouseEvent`) when timing matters;
  `element.click()` skips mousedown and double-click behaviour.
- `userGesture: true` on `Runtime.evaluate` for anything that needs a gesture
  (fullscreen, playback, permissions).
- Fullscreen swallows the second click of a double click; the `clickpause`
  scenario shows how to test it.

## Looking at UI changes

Take screenshots in your own headless Chrome rather than trusting the code:

```
KEPULI_DEV_PORT=9333 KEPULI_DEV_PROFILE=/tmp/kepuli-agent-profile KEPULI_HEADLESS=1 \
KEPULI_SHOTS_DIR=/tmp/kepuli-shots node dev/store-screenshots.mjs
```

gives the five store views at 1280×800 from the mock catalogue. For other
views, write a short driver with `dev/screenshot.mjs`'s `ensureChrome`,
`openPlayer`, `session` and `capture` (store-screenshots.mjs is the example),
set up the state through `chrome.storage.local`, and capture. Check:
alignment of icons and labels, text overflow in the long languages (German,
Finnish, Hungarian), both themes, and a narrow window (600 px) when layout
changed. For text widths, `node dev/playcheck.mjs pseudo` measures the main
views with every string 40 % longer (`player.html?pseudo=1`, see
`js/locales/AGENTS.md`); `KEPULI_OVERFLOW_LANG=de` runs it in a real
language and `KEPULI_PSEUDO_SHOTS=<dir>` keeps the pictures.

Before telling the owner a UI change is done, look at the picture.
