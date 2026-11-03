# AGENTS.md: working on Kepuli-TV

Instructions for coding agents (Codex, Claude Code and others) and for anyone
working the same way. Read this first. Each directory has its own `AGENTS.md`
for the work done there (see [Module guides](#module-guides)); read the one
next to the files you change.

Kepuli-TV is a Manifest V3 browser extension for Chrome and Firefox that plays
the user's own IPTV subscription (Xtream Codes, M3U/XMLTV, Stalker portals) in
a tab. One shared source runs in both browsers; `firefox/` holds only the
Firefox manifest and its tooling.

## Ground rules

1. **No secrets in git.** A real provider account is used for local testing;
   its host, user name and password, and every API key (OpenAI, AMO, Chrome Web
   Store), live outside the repo in `~/.config/kepuli-tv/` and must never be
   committed, written into docs, tests, fixtures or commit messages. Run
   `node dev/secretcheck.mjs` on the staged changes before every commit. Use
   the mock server (`dev/mock/`) and its `demo`/`demo` for anything that ends
   up in the repository.
2. **No release without the owner's explicit go.** Do not tag, create a GitHub
   release, upload to a store or submit for review until the owner says so in
   the current conversation, even if it was asked earlier. Commit and push
   only when asked.
3. **The owner edits the same checkout.** Run `git status` before you start,
   before regenerating files and before committing. Do not revert or
   overwrite changes you did not make; ask.
4. **No build step, no dependencies.** The files in the repo are what the
   browser runs. Tooling is plain Node 22+ with no npm packages; the few Python
   helpers run with `uv run` and declare their own dependencies. Do not add a
   bundler, a framework or `package.json` dependencies.
5. **Leave the owner's browsers alone.** The owner's development Chrome uses
   port 9222 and `~/.cache/kepuli-tv-dev`, Firefox 2828 and
   `~/.cache/kepuli-tv-firefox`. Never reload, navigate or reset them. Use your
   own port and profile for tests (see `dev/AGENTS.md`).
6. **Every user-visible string in all 30 languages.** No hard-coded UI text;
   see `js/locales/AGENTS.md`.
7. **Communicate in the owner's language** (they write Finnish); write code,
   comments, docs, commit messages and store texts in English (British
   spelling: favourites, programme, colour) unless asked otherwise.

## Map of the repository

| Path | What |
| --- | --- |
| `manifest.json`, `firefox/manifest.json` | the two manifests; version and shared keys must agree (`node dev/package.mjs --check`) |
| `background.js` | toolbar click opens the player; uninstall URL; update notice |
| `player.html`, `css/player.css` | the whole interface on one page |
| `js/app.js` | the player's UI and state (large; search before reading) |
| `js/api.js`, `js/m3usource.js`, `js/stalker.js` | the three provider kinds |
| `js/playback.js`, `js/mkv.js`, `js/remux.js`, `js/mp4*.js`, `js/audio.js`, `js/ffaudio.js` | playback routes, MKV unpacking, audio decoding |
| `js/epg.js`, `js/epggrid.js`, `js/guide.js`, `js/picks.js` | programme data, the guide, the start page picks |
| `js/config.js`, `js/db.js`, `js/channelprefs.js` | settings, per-account lists, cache |
| `js/recorder.js`, `js/streamhub.js` | recording |
| `js/i18n.js`, `js/locales/*.js` | English and Finnish; the other 28 languages |
| `vendor/` | hls.js, mpegts.js, the FFmpeg audio build (`dev/wasm/`) |
| `dev/` | every tool: tests, mock server, packaging, store publishing, screenshots, video |
| `store/listings/*.txt` | store texts in 31 languages; `_locales/` is generated from them |
| `brand/` | icon sources, store screenshots (`screenshots/` Chrome, `firefox-screenshots/` AMO) |
| `docs/` | GitHub Pages (`index.html` generated from README, privacy, terms) and the long docs |
| `store-listing.txt` | the Chrome Web Store dashboard fields and the store procedures |

Long-form documentation: [user guide](docs/user-guide.md),
[development](docs/development.md), [internals](docs/internals.md),
`FIREFOX.md`, `CHROMECAST.md`, `firefox/AMO-PUBLISH.md`.

## Everyday commands

| Task | Command |
| --- | --- |
| Pure-function tests (seconds; run always) | `node dev/unitcheck.mjs` |
| Undefined names, missing imports/exports | `node dev/namecheck.mjs` |
| Markup only from constants, no eval | `node dev/htmlcheck.mjs` |
| Browser scenarios against the mock server | `node dev/playcheck.mjs [scenario …]` (see testing playbook for env vars) |
| UI regressions, isolated headless profile | `node dev/uicheck.mjs` |
| The five store views against reference pictures | `node dev/visualcheck.mjs [--update]` |
| Same scenarios in Firefox | `KEPULI_BROWSER=firefox node dev/playcheck.mjs [scenario]` |
| Dummy media for the mock server (once) | `sh dev/mock/media.sh` |
| Translations behind? / mark done | `node dev/translations.mjs [--check]` / `--mark <lang…|all>` |
| Store listings checked, `_locales/` written | `node dev/listings.mjs [--check]` |
| README rendered into the Pages front page | `node dev/site.mjs [--check]` |
| Secrets in the staged changes | `node dev/secretcheck.mjs [--all]` |
| Ready to release? | `node dev/release.mjs [--quick]` |
| Release packages | `node dev/package.mjs --zip`, `node firefox/amo-source.mjs` |
| What Chrome serves | `node dev/cws-publish.mjs verify` |
| Store screenshots (into `brand/` or `KEPULI_SHOTS_DIR`) | `node dev/store-screenshots.mjs`, `KEPULI_BROWSER=firefox …` |
| Demo video with narration | `node dev/demo-video.mjs [--silent|--remix]` |

## How changes are made here

- **Read before you write.** `js/app.js` is thousands of lines; find the
  function with `grep -n` and read around it. Most features already have a
  helper (a picker, a dialog, a list renderer); reuse it.
- **Comments say why**, in full sentences, as the existing code does: what the
  code is for, what went wrong before, what was measured. Do not narrate the
  obvious, and do not leave TODOs without saying what is missing.
- **A bug gets a test that fails without the fix.** Pure logic goes in
  `dev/unitcheck.mjs`; anything in the browser becomes or extends a scenario
  in `dev/playcheck.mjs`, and the mock server (`dev/mock/server.mjs`) gains
  whatever the scenario needs, switched by a `KEPULI_MOCK_*` variable.
- **Look at UI changes.** `node dev/visualcheck.mjs` catches unintended
  changes to the five store views; for anything else take a screenshot with your own headless Chrome
  (see the testing playbook) at 1280×800, in both themes when colours change,
  and check alignment and overflow before calling it done.
- **Keep the docs in step.** A user-facing change updates
  `docs/user-guide.md` (and the README's feature list if it is a key feature);
  a change to the README is followed by `node dev/site.mjs`; a change to the
  store texts by `node dev/listings.mjs`.
- **Both browsers.** The code is shared; when you touch playback, storage,
  permissions or the manifest, run the relevant scenario in Firefox too.

## Commits

- One logical change per commit; the subject is a sentence about the outcome
  ("The details' cover keeps a poster's 2:3 instead of stretching…"), the body
  explains why in prose. Releases are `Release X.Y.Z: <summary>`.
- Before committing: `git status`, `node dev/unitcheck.mjs`, `node dev/namecheck.mjs`,
  `node dev/secretcheck.mjs`, and `node dev/site.mjs --check` /
  `node dev/listings.mjs --check` when README or listings changed.
- Add your tool's attribution trailer if it has one; do not invent others.

## Known traps

- `dev/mock/server.mjs` listens on 8790, and the accounts scenarios start a
  second one on 8791. Only one test browser at a time; stop stray mock servers
  (`lsof -iTCP:8790 -sTCP:LISTEN`) before a run.
- The `picks` scenario fails within minutes of :00 and :30 (a programme must
  have enough time left); run it again later rather than "fixing" it.
- Chrome ignores `--load-extension`; the tools load the extension through the
  DevTools protocol (`Extensions.loadUnpacked`).
- Headless Firefox is not supported by the drivers; Firefox runs open a window.
- The Chrome Web Store locks the whole listing while a version is in review,
  and cancelling a review has a small daily quota. AMO throttles writes for
  hours. Plan store work accordingly: `store/AGENTS.md`.
- Twice the Firefox zip went to the Chrome store. The zips are named per store
  and the publish tools check the manifest; still verify the published CRX
  after approval (see [Release](#release)).

## Module guides

| Guide | Covers |
| --- | --- |
| [`js/AGENTS.md`](js/AGENTS.md) | the runtime modules by area (app, providers, programme data, playback, storage) and how code is written there |
| [`js/locales/AGENTS.md`](js/locales/AGENTS.md) | strings in 30 languages: adding, changing, plurals, marking translations |
| [`css/AGENTS.md`](css/AGENTS.md) | the stylesheet: rem sizing, theme variables, layouts, breakpoints, alignment |
| [`dev/AGENTS.md`](dev/AGENTS.md) | every tool, the tests, ports and profiles, writing scenarios, looking at UI changes |
| [`dev/mock/AGENTS.md`](dev/mock/AGENTS.md) | the invented provider: fiction, determinism, fault switches |
| [`firefox/AGENTS.md`](firefox/AGENTS.md) | the Firefox manifest and tooling, reviewer notes, testing in Firefox |
| [`store/AGENTS.md`](store/AGENTS.md) | listings, translation records, Chrome Web Store and AMO tools, limits and timing, screenshots, the demo video |
| [`brand/AGENTS.md`](brand/AGENTS.md) | icon art, promo tiles, the store screenshot sets and captions |
| [`docs/AGENTS.md`](docs/AGENTS.md) | the Pages site, policy pages and the long docs; links installed versions rely on |
| [`vendor/AGENTS.md`](vendor/AGENTS.md) | third-party code and the FFmpeg audio build, licences |

## Release

Only on the owner's explicit go (rule 2). `node dev/release.mjs` answers
whether the commit may be released (clean and pushed, CI green on it, a new
version, texts in step, reviewer notes within AMO's form, every code and
visual check); run it before asking for the go. The order that has worked:

1. **Scope and notes.** `git log <last tag>..` for what changed; write the
   release notes in the style of the previous GitHub release (sections, bold
   UI names, plain sentences for users).
2. **Version.** Bump `version` in `manifest.json` and `firefox/manifest.json`
   (`node dev/package.mjs --check`). Update the version line in
   `firefox/reviewer-notes.txt` (≤ 3000 characters, line breaks count twice)
   and add the release's note to `store-listing.txt` if the dashboard needs
   anything.
3. **Texts.** `node dev/translations.mjs --check` and
   `node dev/listings.mjs --check` pass; docs updated (`docs/user-guide.md`,
   README feature list, `node dev/site.mjs`).
4. **Tests.** The CI run of the release commit is green; locally
   `node dev/unitcheck.mjs`, the full `node dev/playcheck.mjs` in your own
   profile, the relevant scenarios in Firefox, `node dev/uicheck.mjs` and
   `node dev/visualcheck.mjs` (an intended change to the views: `--update`).
   Retake store screenshots if the five views changed (`brand/AGENTS.md`).
5. **Commit** `Release X.Y.Z: <summary>` after `node dev/secretcheck.mjs`;
   push.
6. **Packages** from the commit: `node dev/package.mjs --zip` and
   `node firefox/amo-source.mjs`; three zips in the project root
   (`kepuli-tv-chrome-X.Y.Z.zip`, `kepuli-tv-firefox-X.Y.Z.zip`,
   `kepuli-tv-firefox-X.Y.Z-amo-source.zip`).
7. **GitHub release**: `git tag vX.Y.Z && git push origin vX.Y.Z`, then
   `gh release create vX.Y.Z <the three zips> --title "Kepuli-TV X.Y.Z" --notes-file <notes>`.
8. **AMO**: `node dev/amo-publish.mjs` in the background (it waits out the
   throttling, then sends the listing and captions); confirm with
   `amo-publish.mjs status`. Usually public within minutes of the version.
9. **Chrome Web Store**: `node dev/cws-publish.mjs upload` (or
   `upload --replace` if a version is still in review), then
   `node dev/cws-listing-fill.mjs` and `node dev/cws-screenshots.mjs` if texts
   or screenshots changed, then `node dev/cws-publish.mjs submit`. See
   `store/AGENTS.md` for the review lock and the cancel quota.

### After the stores

Once Chrome approves, `node dev/cws-publish.mjs verify` reads the package
the store serves to users: it must be the new version, with
`service_worker` and no `gecko` (the Firefox zip went to Chrome twice).
Before the approval it reports the old version, which is expected. Report
the outcome of every step to the owner as it is, including what is still
waiting on a store.
