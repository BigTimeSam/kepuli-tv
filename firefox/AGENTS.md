# firefox/: the Firefox build of the one codebase

There is no second copy of the player. Everything under `js/`, `css/`,
`vendor/`, `icons/`, with `player.html` and `background.js`, runs in Firefox
as it is; `js/browser.js` holds the one difference in the API namespace. This
directory has only what is Firefox's own. The full record of differences and
measurements is `../FIREFOX.md`.

| File | What |
| --- | --- |
| `manifest.json` | Firefox's manifest: `background.scripts` **beside** the same `background.service_worker` as Chrome's (keep both: it makes either zip start in either browser, after the store mix-ups of 1.2.1 and 1.2.5), `browser_specific_settings.gecko` (id `kepuli-tv@bigtimesam.github.io`, Firefox 140+, data consent) |
| `build.mjs` | assembles `firefox/dist/` for the development loop (`--zip`, `--check`) |
| `dev.mjs` | the owner's Firefox loop (port 2828, `~/.cache/kepuli-tv-firefox`): do not run it as an agent; use your own port and profile |
| `marionette.mjs`, `playcheck-driver.mjs` | Marionette speaking directly, and the driver that lets `dev/playcheck.mjs` and `dev/store-screenshots.mjs` run in Firefox (`KEPULI_BROWSER=firefox`) |
| `android.mjs` | Firefox for Android over USB: `install` the checkout as a temporary add-on, `open`, `eval`/`bg` code in the player or the background, `logs`, `shot`, `status` (Remote Debugging Protocol through `adb forward`; the owner's device: it never clears data or restarts Firefox) |
| `amo-source.mjs` | the source archive AMO requires (FFmpeg source and the wasm build included), with `AMO-BUILD.md` as its README |
| `reviewer-notes.txt` | the Notes to Reviewer; **at most 3000 characters with line breaks counted as two** (`amo-publish.mjs` counts) |
| `AMO-PUBLISH.md`, `AMO-BUILD.md` | the listing's history and the reviewers' build instructions |

## Rules

- **The manifests stay in step.** Version and every key that is not
  browser-specific must agree with `../manifest.json`; `build.mjs` and
  `dev/package.mjs` stop otherwise. Bump both at a release.
- **A new permission** goes in both manifests and gets a sentence in
  `reviewer-notes.txt` (keep the version line in it current, e.g.
  "(1.6.3: interface changes only; no new permission)").
- **Test in Firefox** whatever touches playback, storage, permissions or the
  manifest: `KEPULI_BROWSER=firefox KEPULI_FIREFOX_PORT=2838
  KEPULI_FIREFOX_PROFILE=/tmp/kepuli-ff node dev/playcheck.mjs <scenario>`.
  Firefox runs open a visible window; headless is not supported by the driver.
- Known Firefox-only paths in the shared code: MP4 over plain HTTP plays
  through MediaSource (`js/mp4play.js`), because Firefox upgrades an extension
  page's http media to https; Firefox's own video controls keep clicks to
  themselves.
- Releases come from `dev/package.mjs`, not from `build.mjs`.
