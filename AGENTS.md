# AGENTS.md: working on Kepuli-TV

Instructions for coding agents (Codex, Claude Code and others) and for anyone
working the same way. Read this first. Each directory has its own `AGENTS.md`
for the work done there (see [Module guides](#module-guides)); read the one
next to the files you change.

Kepuli-TV is a Manifest V3 browser extension for Chrome and Firefox that plays
the user's own IPTV subscription (Xtream Codes, M3U/XMLTV, Stalker portals) in
a tab. One shared source runs in both browsers; `firefox/` holds only the
Firefox manifest and its tooling.

The same page is also three apps, each a native shell that shows it and
does what a page cannot there. The page knows which by its address
(`js/platform.js`), and there is no second copy of the player anywhere.

| App | Shell | The page is opened as |
| --- | --- | --- |
| iPhone and iPad | `ios/`: a WebKit web view hosting the extension, Swift | `player.html?ios=1` |
| Android phone and tablet | `android/`, the `mobile` package: GeckoView with the Firefox package built in, Java | `player.html?app=1` |
| Android TV | `android/`, the `tv` package: the same, driven by a remote control | `player.html?tv=1` |

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
   browser runs. Tooling is plain Node 22+ with no npm packages; the few
   Python helpers run with `uv run` and declare their own dependencies. Do
   not add a bundler, a framework or `package.json` dependencies. The two
   exceptions are confined to the apps' own directories and touch nothing
   the browsers run: `ios/` is built with Xcode and xcodegen and links
   Google's Cast SDK, `android/` with Gradle, GeckoView and Google's Cast
   sender; what they generate or fetch is never committed.
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
| `android/` | the Android apps (a television's, and a phone's and tablet's): the Firefox package inside GeckoView, their Gradle build, the permissions check |
| `background.js` | toolbar click opens the player; uninstall URL; update notice |
| `player.html`, `css/*.css` | the whole interface on one page; thirteen stylesheets linked in cascade order (`css/AGENTS.md`) |
| `js/app.js` | the player's UI and state (large; search before reading) |
| `js/api.js`, `js/m3usource.js`, `js/stalker.js` | the three provider kinds |
| `js/playback.js`, `js/mkv.js`, `js/remux.js`, `js/mp4*.js`, `js/audio.js`, `js/ffaudio.js` | playback routes, MKV unpacking, audio decoding |
| `js/epg.js`, `js/epggrid.js`, `js/guide.js`, `js/picks.js` | programme data, the guide, the start page picks |
| `js/config.js`, `js/db.js`, `js/channelprefs.js` | settings, per-account lists, cache |
| `js/recorder.js`, `js/streamhub.js` | recording |
| `js/i18n.js`, `js/locales/*.js` | English and Finnish; the other 28 languages |
| `vendor/` | hls.js, mpegts.js, the FFmpeg audio build (`dev/wasm/`) |
| `ios/` | the app for the iPhone and the iPad: the native shell around `player.html?ios=1`, its build, its simulator driver and scenarios, its packages and what is missing before the App Store |
| `js/platform.js`, `js/host.js`, `js/iosapp.js`, `js/androidapp.js`, `js/remote.js`, `js/castui.js` | the page's side of the apps: which app is around the page, the port to its native code, what the page does in the iPhone and iPad app, in the Android phone app and under a television's remote control, and a cast session |
| `dev/` | every tool: tests, mock server, packaging, store publishing, screenshots, video |
| `store/listings/*.txt` | store texts in 31 languages; `_locales/` is generated from them |
| `brand/` | icon sources, store screenshots (`screenshots/` Chrome, `firefox-screenshots/` AMO) |
| `docs/` | GitHub Pages (`index.html` generated from README, the guides from `docs/pages/`, privacy, terms) and the long docs |
| `store/chrome-dashboard.txt` | the Chrome Web Store dashboard fields and the store procedures |
| `store/appstore.txt` | every App Store Connect field for the iPhone and iPad app: texts in English and Finnish, privacy and age answers, review notes |

Long-form documentation: [user guide](docs/user-guide.md),
[development](docs/development.md), [internals](docs/internals.md),
`FIREFOX.md`, `CHROMECAST.md`, `firefox/AMO-PUBLISH.md`.

## Everyday commands

| Task | Command |
| --- | --- |
| Pure-function tests (seconds; run always) | `node dev/unitcheck.mjs` |
| Undefined names, missing imports/exports | `node dev/namecheck.mjs` |
| The typed modules (`// @ts-check`) type-check | `node dev/typecheck.mjs` |
| Markup only from constants, no eval | `node dev/htmlcheck.mjs` |
| The guides name what exists | `node dev/docscheck.mjs` |
| Browser scenarios against the mock server | `node dev/playcheck.mjs [scenario …]` (see testing playbook for env vars) |
| UI regressions, isolated headless profile | `node dev/uicheck.mjs` |
| The five store views (dark and light) and the narrow layout against reference pictures | `node dev/visualcheck.mjs [--update]` |
| Same scenarios in Firefox | `KEPULI_BROWSER=firefox node dev/playcheck.mjs [scenario]` |
| Dummy media for the mock server (once) | `sh dev/mock/media.sh` |
| Translations behind? / mark done | `node dev/translations.mjs [--check]` / `--mark <lang…|all>` |
| Each language's term for the core concepts | `node dev/glossarycheck.mjs [--survey]` |
| Store listings checked, `_locales/` written | `node dev/listings.mjs [--check]` |
| README and `docs/pages/` rendered into the Pages site | `node dev/site.mjs [--check]` |
| Secrets in the staged changes | `node dev/secretcheck.mjs [--all]` |
| Ready to release? | `node dev/release.mjs [--quick]` |
| Release packages | `node dev/package.mjs --zip`, `node firefox/amo-source.mjs` |
| What Chrome serves | `node dev/cws-publish.mjs verify` |
| The page as each app sees it, in desktop Chrome | `node dev/playcheck.mjs iosapp` (iPhone and iPad), `appback appcast` (Android phone), `remote remotescrub` (Android TV) |
| The Android apps built, and what they ask Android to allow | `cd android && ./gradlew assembleMobileDebug assembleTvDebug` (needs `ANDROID_HOME`), then `node android/permissions.mjs` |
| The iPhone and iPad app built for the simulator, its XCTest target | `node ios/build.mjs --simulator`, `node ios/build.mjs --test` |
| The app in a simulator: install, launch, state, run code in the page | `node ios/sim.mjs install`, `launch`, `status`, `eval '<code>'` (see `ios/AGENTS.md`) |
| The app's scenarios in its simulators against a mock of their own on 8841 (about eleven minutes) | `node ios/simcheck.mjs [scenario …]` |
| The app's simulator package, its unsigned archive, what is missing before the App Store | `node ios/release.mjs simulator`, `archive`, `status` |
| The App Store's screenshots (into `brand/ios-screenshots/` or `KEPULI_SHOTS_DIR`) | `node ios/screenshots.mjs` |
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
  changes to the five store views, in both themes, and to the channels at
  600 px; for anything else take a screenshot with your own headless Chrome
  (see the testing playbook) at 1280×800, in both themes when colours change,
  and check alignment and overflow before calling it done.
- **Keep the docs in step** (`node dev/docscheck.mjs` catches a guide that
  names a file, tool or module that is not there, or misses a new one). A user-facing change updates
  `docs/user-guide.md` (and the README's feature list if it is a key feature);
  a change to the README is followed by `node dev/site.mjs`; a change to the
  store texts by `node dev/listings.mjs`.
- **No "·" between pieces of text.** A line of facts joined by middle dots
  ("Today 13.25 · 2 min · 96.7 MB") reads as clutter. Set the pieces apart by
  layout (a flex row with a gap, a line each, a heading and its value) or,
  in running text and tooltips, by a comma. Reading a provider's names that
  contain one (`js/name.js`, `js/picks.js`) is another matter.
- **Both browsers.** The code is shared; when you touch playback, storage,
  permissions or the manifest, run the relevant scenario in Firefox too.
- **And the apps.** The same files run in the three apps (`js/platform.js`
  exports `ios`, `inApp`, `remote` and `native`). What differs in an app is
  a branch on one of those in the module concerned, a rule under `.ios`,
  `.app` or `.tv` in `css/last.css`, or the app's own page module
  (`js/iosapp.js`, `js/androidapp.js`, `js/remote.js`): never a copy of a
  module, and never a test of the engine. A string that names a browser, a
  tab or a computer is untrue in an app: write it so that it holds in
  both, or keep it out of the app's reach, and the guard in
  `dev/unitcheck.mjs` lists the exceptions with their reasons. When you
  touch something an app shares (the bridge `js/host.js`, casting, the
  help, touch sizes, the pickers), run that app's scenarios above; they
  need no simulator or emulator.
- **Apps live on main.** The apps were once three long branches that grew
  apart in 44 files and took a day to bring together. Work on an app goes
  to main in small steps like everything else; an experiment that is not
  for release stays on its own branch and says so (`android-tv` holds the
  television's own player for live channels).

## Commits

- One logical change per commit; the subject is a sentence about the outcome
  ("The details' cover keeps a poster's 2:3 instead of stretching…"), the body
  explains why in prose. Releases are `Release X.Y.Z: <summary>`.
- Before committing: `git status`, `node dev/unitcheck.mjs`, `node dev/namecheck.mjs`,
  `node dev/typecheck.mjs`, `node dev/secretcheck.mjs`, and `node dev/site.mjs --check` /
  `node dev/listings.mjs --check` when README or listings changed.
- Add your tool's attribution trailer if it has one; do not invent others.

## Known traps

- `dev/mock/server.mjs` listens on 8790, and the accounts scenarios start a
  second one on 8791. Only one test browser at a time; stop stray mock servers
  (`lsof -iTCP:8790 -sTCP:LISTEN`) before a run.
- Branded Chrome ignores `--load-extension`; the tools load the extension
  through the DevTools protocol (`Extensions.loadUnpacked`). Only CI's Chrome
  for Testing takes the flag (`KEPULI_LOAD_EXTENSION=1`).
- Headless Firefox is not supported by the drivers; Firefox runs open a window.
- The Chrome Web Store locks the whole listing while a version is in review,
  and cancelling a review has a small daily quota. AMO throttles writes for
  hours. Plan store work accordingly: `store/AGENTS.md`.
- The iOS simulators are shared with other sessions on this machine: only
  the ones `ios/sim.mjs` created (`kepuli-ios-*`), always by UDID, and its
  mock on 8841. WebKit drops a native message sent before the page's
  listener is registered, and forgets host grants between launches; both
  are handled in `ios/App/` and explained in `ios/MEASURED.md`.
- Twice the Firefox zip went to the Chrome store. The zips are named per store
  and the publish tools check the manifest; still verify the published CRX
  after approval (see [Release](#release)).

## Recipes

Step lists for the common changes, each with its files and commands, are in
[docs/agents-recipes.md](docs/agents-recipes.md): add a setting, add a
user-visible string, add a playcheck scenario with a mock fault switch, move
a section of `js/app.js` into a module, change the store listings, retake
the store screenshots.

## Module guides

| Guide | Covers |
| --- | --- |
| [`js/AGENTS.md`](js/AGENTS.md) | the runtime modules by area (app, providers, programme data, playback, storage) and how code is written there |
| [`js/locales/AGENTS.md`](js/locales/AGENTS.md) | strings in 30 languages: adding, changing, plurals, marking translations |
| [`css/AGENTS.md`](css/AGENTS.md) | the stylesheet: rem sizing, theme variables, layouts, breakpoints, alignment |
| [`dev/AGENTS.md`](dev/AGENTS.md) | every tool, the tests, ports and profiles, writing scenarios, looking at UI changes |
| [`dev/mock/AGENTS.md`](dev/mock/AGENTS.md) | the invented provider: fiction, determinism, fault switches |
| [`safari/AGENTS.md`](safari/AGENTS.md) | the Safari extension on the Mac: its build, what differs in Safari, driving it by AppleScript, traps |
| [`firefox/AGENTS.md`](firefox/AGENTS.md) | the Firefox manifest and tooling, reviewer notes, testing in Firefox |
| [`ios/AGENTS.md`](ios/AGENTS.md) | the iPhone and iPad app: the shell, the permanent identifiers, the build, the simulator driver and its scenarios. Beside it, read when needed: [`ios/MEASURED.md`](ios/MEASURED.md) (what was found by running the app, and must not be undone) and [`ios/RELEASE.md`](ios/RELEASE.md) (packages, the App Store procedure, the device checklist) |
| [`android/AGENTS.md`](android/AGENTS.md) | the Android apps for a television and for a phone or a tablet: the Firefox package inside GeckoView, building, the emulators, driving them |
| [`store/AGENTS.md`](store/AGENTS.md) | listings, translation records, Chrome Web Store and AMO tools, limits and timing, screenshots, the demo video, the App Store's texts |
| [`brand/AGENTS.md`](brand/AGENTS.md) | icon art, promo tiles, the store screenshot sets and captions |
| [`docs/AGENTS.md`](docs/AGENTS.md) | the Pages site, policy pages and the long docs; links installed versions rely on |
| [`vendor/AGENTS.md`](vendor/AGENTS.md) | third-party code and the FFmpeg audio build, licences |

## Release

Only on the owner's explicit go (rule 2). This section is the browsers'
release; the apps have their own: `ios/RELEASE.md` for the App Store and
"Release packages and Google Play" in `android/AGENTS.md`. `node dev/release.mjs` answers
whether the commit may be released (clean and pushed, CI green on it, a new
version, texts in step, reviewer notes within AMO's form, every code and
visual check); run it before asking for the go. The order that has worked:

1. **Scope and notes.** `git log <last tag>..` for what changed;
   `node dev/releasenotes.mjs > dist/release-notes.md` (git-ignored) drafts
   the notes from the commits since the last tag, grouped by where a user
   meets them and with the three packages named, and publishes nothing.
   Rewrite the draft in the style of the previous GitHub release
   (`gh release view v<last>`): sections, bold UI names, plain sentences
   for users, no development section.
2. **Version.** Bump `version` in `manifest.json` and `firefox/manifest.json`
   (`node dev/package.mjs --check`). Update the version line in
   `firefox/reviewer-notes.txt` (≤ 3000 characters, line breaks count twice)
   and add a field's new text to `store/chrome-dashboard.txt` if the dashboard
   needs one (a new permission's justification, say).
3. **Texts.** `node dev/translations.mjs --check` and
   `node dev/listings.mjs --check` pass; docs updated (`docs/user-guide.md`,
   README feature list, `node dev/site.mjs`).
4. **Tests.** The CI runs of the release commit are green, the push run and
   a full one (`gh workflow run Checks`); locally
   `node dev/unitcheck.mjs`, the full `node dev/playcheck.mjs` in your own
   profile, the relevant scenarios in Firefox, `node dev/uicheck.mjs` and
   `node dev/visualcheck.mjs` (an intended change to the views: `--update`).
   Retake store screenshots if the five views changed (`brand/AGENTS.md`).
5. **Commit** `Release X.Y.Z: <summary>` after `node dev/secretcheck.mjs`;
   push.
6. **Packages** from the commit: `node dev/package.mjs --zip` and
   `node firefox/amo-source.mjs`; three zips in the project root
   (`kepuli-tv-chrome-X.Y.Z.zip`, `kepuli-tv-firefox-X.Y.Z.zip`,
   `kepuli-tv-firefox-X.Y.Z-amo-source.zip`), and only those: older zips
   are moved into `dist/releases/`.
7. **GitHub release**: `git tag vX.Y.Z && git push origin vX.Y.Z`, then
   `gh release create vX.Y.Z <the three zips> --title "Kepuli-TV – IPTV Player X.Y.Z" --notes-file dist/release-notes.md`.
8. **AMO**: `node dev/amo-publish.mjs` in the background (it waits out the
   throttling, then sends the listing and captions); confirm with
   `amo-publish.mjs status`. Usually public within minutes of the version.
   New screenshots belong to the add-on, not the version: ask the owner for
   their upload (`node dev/amo-screenshots.mjs && node dev/amo-publish.mjs captions`)
   as soon as they are committed, as AMO may ask for an hour between two
   of them (1.7.0); `release.mjs` reports when AMO is behind `brand/`.
9. **Chrome Web Store**: the dashboard's sign-in is checked by
   `release.mjs`, before the go; Google may want a passkey on this
   machine, so the owner signs in while still at it. Then
   `node dev/cws-publish.mjs upload` (or
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
