# The Firefox version

What differs between the Chrome extension and the Firefox one, how the Firefox
package is built and tested, and what was measured. This began as an
assessment of whether a Firefox version could come from one codebase; it
could, it does, and this is the record.

**Short answer:** the player is one codebase. Everything under `js/`, `css/`,
`vendor/` and `icons/`, with `player.html` and `background.js`, runs in both
browsers as it is. `js/browser.js` holds the one line that differs, and
`firefox/` holds the Firefox manifest and the tools that assemble the package
from the shared files. There is no second copy of anything to keep in step.

## The shape

```
firefox/manifest.json   the Firefox manifest — the only Firefox-specific source file
firefox/build.mjs       copies the shared files and the manifest into firefox/dist/,
                        zips it with --zip, compares the manifests with --check
firefox/dev.mjs         the development loop: Firefox with a profile of its own,
                        the add-on loaded temporarily, rebuilt and reloaded on change
firefox/marionette.mjs  Firefox's remote protocol, spoken with node:net alone
firefox/dist/           the assembled add-on, in .gitignore
js/browser.js           api = browser ?? chrome
```

`firefox/dist/` is what Firefox loads, from `about:debugging` or from the
loop, and what the zip is made of. It is never edited: a change goes into the
shared source at the project root, and the next build carries it over. The
Chrome package's zip command excludes `firefox/`, and the Firefox build
excludes everything that is not on its list of shared files, so neither
package can pick up the other's files.

## What differs

### The namespace

Chrome knows `chrome`; Firefox knows both `chrome` and `browser`, but in
Firefox the promises live only on `browser` — `await
chrome.storage.local.get(key)` comes back `undefined` there, and the settings
would simply vanish without a word. `js/browser.js`:

```js
export const api = globalThis.browser ?? globalThis.chrome;
```

`config.js`, `permissions.js` and `app.js` import it; `background.js` is not a
module and carries the same line itself. Nothing else in the code touches an
extension API: the player, the lists, the guide, the cache and the unpacking
are ordinary web code.

Measured: Chrome 152 has a `browser` namespace of its own (`action`, `dom`,
`extension`, `i18n`, `management`, `permissions`, `runtime`, `storage`,
`tabs`, `windows`), not the same object as `chrome`, and the alias picks it
without any difference in behaviour. Chrome 116–147 fall through to `chrome`,
whose MV3 APIs return promises.

### The manifest

| Key | Chrome | Firefox |
| --- | --- | --- |
| `background` | `service_worker: "background.js"` | `scripts: ["background.js"]` — Firefox has no service workers for extensions |
| `minimum_chrome_version` | `116` | absent |
| `browser_specific_settings.gecko.id` | absent | `kepuli-tv@bigtimesam.github.io`, mandatory for signing |
| `browser_specific_settings.gecko.strict_min_version` | absent | `140.0`, for Firefox's built-in data-transmission consent |
| `browser_specific_settings.gecko.data_collection_permissions` | absent | `required: ["authenticationInfo"]`, because credentials are sent to the user's service |
| everything else | the same | the same |

The other APIs in use are older than 128: `runtime.getContexts` 127,
`action` 109, `permissions.request` 55, `unlimitedStorage` 56. The CSP with
`'wasm-unsafe-eval'` is accepted under the same key.

`build.mjs` compares the two manifests on every run: `manifest_version`,
`name`, `version`, `description`, `content_security_policy`, `permissions`,
`optional_host_permissions`, `action` and `icons` must agree, the Firefox one
must have `background.scripts` and a gecko id, and a key that appears in the
Chrome manifest without being on either list stops the build until this
script knows about it. That is what keeps the two from drifting apart.

The declaration concerns transmission to the user's own server, even though
the developer receives nothing. Version 1.0.7 declares `authenticationInfo`
and requires Firefox 140 so Firefox obtains consent at installation. HTTP
support remains available for user-supplied services; the connection form
explains the lack of encryption and recommends HTTPS where supported. The
AMO assessment and its remaining uncertainty are in `firefox/AMO-PUBLISH.md`.

### Wording

The messages that named Chrome — the row badge for an unpromising extension,
the denied-permission error, the three probe verdicts — now say *the
browser*. The decision logic was browser-independent already: `probe.js` asks
`MediaSource.isTypeSupported` and assumes nothing.

## What was measured

Firefox 155 on macOS, the extension loaded temporarily from `firefox/dist/`
over Marionette, against the mock server (`dev/mock/`):

| Case | Result |
| --- | --- |
| The add-on installs, the action opens the player | yes |
| `browser.storage.local`, promise-based | yes |
| Live channel: mpegts.js fails on the mock's 404, hls.js takes over | plays, 1280×720 |
| VOD `.mp4`, native | plays, details below the player |
| VOD `.mkv`, unpacked into fMP4 through MediaSource | plays, 1280×720, with sound |
| Subtitles from the MKV as `VTTCue`s, the selector, the English track | a cue on screen |
| Seeking in the MKV to 60 s | continues from 63.9 s, `readyState` 4 |
| `MediaSource.isTypeSupported`: H.264, HEVC, AAC, Opus in MP4 | all true |
| `AudioEncoder.isConfigSupported` AAC | **false** |
| `AudioEncoder.isConfigSupported` Opus | true |
| Remote Playback API | absent, so the Cast button hides itself |
| `requestPictureInPicture` | present |
| `permissions.contains` | answers |
| Console | the mock's expected 404, and the AAC encoder's NotSupportedError twice per MKV — the latter gone since the encoder is chosen (below): AAC is asked with `isConfigSupported` and never configured |

The one real risk the assessment named — `remux.js`, where Chrome and Firefox
accept different things into a `SourceBuffer` — turned out not to be one: the
segments that Chrome takes, Firefox takes as they are, seeking included.

### AC-3 and DTS: Opus where there is no AAC

Firefox has no AAC encoder, so the wasm decoder's output — stereo PCM at
48 kHz — used to have nowhere to go: an MKV whose only audio track was AC-3,
E-AC-3 or DTS played without sound. What Firefox does have is an Opus
encoder, and its MediaSource takes Opus in MP4. So `transcode.js` now asks
for an encoder rather than assuming one: AAC first, because that is what
Chrome has been measured with and an untouched route beats a new one, and
Opus where AAC is not on offer. The choice is made once per page:
`AudioEncoder.isConfigSupported` and `MediaSource.isTypeSupported` are the
first filter, and a candidate counts only once it has actually encoded —
the measurement below is part of the choice — because the filter is not
always the truth. Chrome answers for AAC from its build, and the platform
encoder behind the answer is only instantiated at `configure()`: a Windows N
without the Media Feature Pack has the answer but not the encoder, and would
otherwise never reach Opus. The choice serves every track. Chrome on Linux,
which has no AAC encoder either, takes the Opus route too — the change is in
the shared code, so it serves both browsers.

What the Opus route needed:

- an `Opus` sample entry with a `dOps` box in `mp4.js` in place of `mp4a`
  and its `esds`: stereo, channel mapping family 0, PreSkip 0 — and the
  `roll` sample group the Opus-in-ISOBMFF specification requires of every
  Opus track (80 ms of pre-roll, four frames), which neither browser reads
  for playback but the specification's *shall* asks for
- a frame of 960 samples — 20 ms, pinned with `opus.frameDuration` — in the
  timestamp chain in place of AAC's 1024
- the priming delay measured the same way as for AAC, an impulse encoded and
  decoded back, which for Opus comes out as 312 samples (6.5 ms), libopus's
  lookahead. PreSkip stays at zero because the delay is taken off the
  timestamps instead, as it is for AAC; a decoder told to trim would take
  the same samples off twice
- the verdict in `probe.js` asks the encoder as well as the decoder: a
  browser with the wasm decoder but no encoder at all — Firefox 128 and 129,
  before desktop Firefox got WebCodecs audio in 130 — marks the row *no
  sound* honestly, with a reason of its own. Versions through 1.0.6 kept
  `strict_min_version` at 128; the AMO preparation in 1.0.7 raises it to 140
  for built-in data-transmission consent

Measured, Firefox 155 and Chrome 152 on macOS, with `node dev/audiocheck.mjs
firefox` and `chrome`: the real modules run inside the extension against the
wasm test material (`dev/wasm/media/`, five files — AC-3 5.1, E-AC-3 stereo,
DTS 5.1, AC-3 at 32 kHz, AC-3 changing from mono to stereo mid-stream), the
fMP4 they produced decoded both by the browser itself and with ffmpeg, and
compared with the wasm decoder's own reference PCM:

| | Firefox 155 | Chrome 152 |
| --- | --- | --- |
| `AudioEncoder.isConfigSupported` AAC / Opus | false / true | true / true |
| Encoder chosen, and its priming delay | Opus, 312 samples | AAC, 2112 samples |
| Alignment against the reference, decoded with ffmpeg | sample-exact, all five files | sample-exact, all five files |
| The same, decoded by the browser itself (`decodeAudioData`, the demuxer and decoder MediaSource uses) | sample-exact, the same SNR | sample-exact, the same SNR |
| SNR against the reference | 33–43 dB | 47–49 dB |
| Decoding and encoding, in real time | 54–93x | 57–132x |
| The mock server's AC-3 5.1 episode, 120 s, through the remuxer | plays with sound; a seek to 60 s continues from 65.8 s | the same |
| Opus packets | CELT, 20 ms, stereo, every one | — |

The alignment check is the one that matters: a chain off by the delay, or by
a frame, drops the SNR below zero, so a wrong correction could not have
hidden. The mock server now hands out an AC-3 5.1 episode — the second of
every first season, made by `dev/mock/media.sh` — with a beep on every
second in step with the clock on the picture, so that the lead or lag can be
judged by ear in either browser as well.

## The development loop

`node firefox/dev.mjs` is `dev/dev.mjs` for Firefox. Firefox has no
`--load-extension` either; what it has is Marionette, its own remote
protocol, which geckodriver speaks and which is small enough to speak from
`node:net` without a dependency:

- Firefox is started with `-marionette -remote-allow-system-access
  -no-remote -profile ~/.cache/kepuli-tv-firefox`. The second flag is what
  lets a script run in Firefox's own context, where `WebExtensionPolicy`
  answers the add-on's `moz-extension://` URL; without it Firefox 154+
  refuses the context.
- The profile's `user.js` sets `marionette.port`, turns off the first-run
  pages, relaxes the autoplay policy — for the same reason
  `dev/store-screenshots.mjs` gives Chrome
  `--autoplay-policy=no-user-gesture-required`: scripts click by script,
  which no policy counts as a gesture — and keeps the window open when its
  last tab closes. Reloading the add-on closes the add-on's own tab, and a
  Firefox left without a window answers on the port but cannot open a
  session; `session()` quits and restarts such a Firefox, once.
- Installing the temporary add-on again over the installed one is the
  reload, measured; there is no separate reload command to speak.
- Every message is `length:json`. A command is `[0, id, name, params]`, a
  reply `[1, id, error, result]`. `Addon:Install` with `temporary: true` is
  what `about:debugging`'s *Load Temporary Add-on* does;
  `WebDriver:ExecuteScript` runs a line in the player and awaits a promise.
- One client at a time: a test script and the loop cannot share the port.

A temporary add-on is gone when Firefox closes, so each run installs it
again; the profile's storage, credentials included, survives that. The
credentials of the development profile are separate from the user's own
browser, as they are for Chrome.

## Keeping the two in step

- A change to the player goes into the shared source at the project root
  and reaches both packages by itself. Nothing is copied by hand.
- A change to `manifest.json` that is not browser-specific goes into
  `firefox/manifest.json` too; `node firefox/build.mjs --check` says whether
  the two agree, and the build refuses until they do.
- A release bumps the version in both manifests, builds both packages, and
  tags once.
- A browser API is used only through `js/browser.js`. A new one goes through
  the same alias, and its Firefox version is checked against
  `strict_min_version` before it is used.
- Something that exists in one browser only — Remote Playback, picture in
  picture — is detected, never assumed, and hides its own control when
  missing.
- An encoder is asked for, never assumed. `transcode.js` tries AAC and then
  Opus, and the choice reaches `mp4.js` as the sample entry and `probe.js`
  as the verdict — so a browser that gains or loses an encoder changes
  nothing in the code.

## Publishing on AMO

The current submission plan, validation results, copyable store fields and
remaining release decisions are in [firefox/AMO-PUBLISH.md](firefox/AMO-PUBLISH.md).
The reviewer source package is built with `node firefox/amo-source.mjs` after
committing the preparation files; `--worktree` makes an explicitly uncommitted
preview. It includes FFmpeg's full source and [English build
instructions](firefox/AMO-BUILD.md). Runtime release packages come from
`node dev/package.mjs firefox --zip`.

- **Signing is mandatory.** Release Firefox will not install an unsigned
  extension permanently. A signature can be had from AMO without a public
  listing too (self-distribution). `node firefox/build.mjs --zip` makes the
  package to upload.
- **Minified code.** AMO requires the source to be submitted when *you*
  minify or bundle. `vendor/hls.js` and `vendor/mpegts.js` are the
  libraries' own release files, covered by the third-party library policy:
  state the version and origin so the reviewer can compare them with the
  original.
- **`vendor/ffaudio` is a different case.** It is not a library's own
  release but our build of FFmpeg, so the clause requiring source and build
  instructions applies to it precisely. They are in place: `dev/wasm/build.sh`
  holds the whole command sequence, `dev/wasm/ffaudio.c` is the only source
  file of our own, and `vendor/ffaudio/LICENSE` states FFmpeg's tag and the
  replaceability LGPL 2.1 §6 requires.
- **Review and signing.** AMO validates the upload and may perform further
  review. Validation alone does not establish policy compliance or guarantee
  publication; the consent declaration and secure transport must be addressed
  before this project's first submission.
