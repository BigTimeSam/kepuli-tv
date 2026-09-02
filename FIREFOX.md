# A Firefox version

An assessment of what porting Kepuli-TV to a Firefox extension would take, and
whether maintaining both from one codebase is worth it.

**Short answer:** it is, and from one codebase. The extension's dependency on
the browser is 15 calls in three files. Everything else — the player, the
lists, the guide, the cache, the unpacking — is ordinary web code that knows
nothing about extension APIs.

The areas of MV3 where Chrome and Firefox really differ are content scripts,
`webRequest` and `declarativeNetRequest`. Kepuli-TV uses none of them.

## What in the code is browser-specific

| File | Calls | In Firefox |
| --- | --- | --- |
| `js/config.js` | `storage.local.get/set` × 9 | works, see the namespace |
| `js/permissions.js` | `permissions.contains/request` × 3 | works (Fx 55+) |
| `background.js` | `runtime.getURL`, `runtime.getContexts`, `tabs.update`, `tabs.create`, `windows.update`, `action.onClicked` | works (`getContexts` Fx 127+) |

No content scripts, no `webRequest`, no `declarativeNetRequest`, no
`scripting`, no messaging between the page and the background. `player.html` is
an ordinary page that happens to live on the extension's origin.

## Five changes

### 1. A namespace shim

In Firefox the promise-returning namespace is `browser`. `chrome` exists as a
compatibility alias, but in callback style — so `await
chrome.storage.local.get(key)` would return `undefined` rather than the data.
The fault would be silent: the settings would simply vanish.

A new `js/browser.js`:

```js
// Chrome knows only chrome (browser arrived in 148); Firefox knows both, but
// the promises live only on browser. The alias settles both.
export const api = globalThis.browser ?? globalThis.chrome;
```

Then `config.js`, `permissions.js` and `background.js` use `api` instead of
`chrome`. `background.js` is not a module, so the same line at the top of the
file is enough there.

This is the only actual code change in the whole job.

### 2. The background script in the manifest

Firefox does not implement `background.service_worker` at all. It uses an event
page, i.e. the `background.scripts` key. The same manifest can carry both:
Firefox ignores `service_worker` and Chrome, from 121 onwards, ignores
`scripts`.

```json
"background": {
  "service_worker": "background.js",
  "scripts": ["background.js"]
}
```

**Caveat:** Chrome 116–120 does not ignore `scripts` but refuses to load the
extension at all. The manifest currently says `"minimum_chrome_version": "116"`,
so it would have to be raised to 121 — or there will be two manifests. Chrome
121 is from January 2024, so raising it is cheap and keeps the project's
promise of having no build step.

### 3. `browser_specific_settings`

```json
"browser_specific_settings": {
  "gecko": {
    "id": "kepuli-tv@bigtimesam.github.io",
    "strict_min_version": "128.0"
  }
}
```

The `id` is mandatory on AMO and it binds the storage to the extension. The
minimum version of 128 is dictated by `optional_host_permissions`, which
arrived in Firefox only then. The other APIs in use are older:
`runtime.getContexts` 127, `action` 109, `unlimitedStorage` 56,
`permissions.request` 55.

Chrome does not know the key but does not choke on it either — unknown manifest
keys are a warning, not an error. The same holds the other way round for
`minimum_chrome_version` in Firefox.

### 4. Wording

A dozen error messages and tooltips name Chrome:

```
js/probe.js    "The video codec %s cannot be decoded in Chrome."
               "The audio track is %s, which Chrome does not decode."
               "the content suits Chrome, but the container is not unpacked"
js/rows.js     "does not promise playback in Chrome"
js/xtream.js   the comment on natively played extensions
js/app.js      "Chrome did not grant access"
```

The decision logic itself is already browser-independent: `probe.js` asks
`MediaSource.isTypeSupported` and assumes nothing. Only the texts change,
"Chrome" → "the browser".

One hard-coded list remains: `js/xtream.js:isNativelyPlayable` enumerates the
extensions `mp4|m4v|mov|webm|ogv`. Firefox plays the same set. An aside: `ogv`
is out of date on the Chrome side, as Chrome dropped Theora in version 123.

### 5. The development loop

`dev/dev.mjs` speaks Chrome's DevTools protocol, and it cannot be ported. The
equivalent for Firefox is Mozilla's own `web-ext`:

```
npx web-ext run --source-dir=. --start-url=about:debugging
```

It loads the extension temporarily, opens a profile of its own and reloads on
changes — the same workflow, ready made. The dependency sits behind `npx`, not
in the project. `dev.mjs` stays with Chrome.

## What needs no change

- **The playback engines.** mpegts.js states support for Firefox 42+, and
  hls.js works in Firefox. Neither leans on Chrome's peculiarities: both demux
  the stream into fMP4 and feed it to MediaSource, which is exactly the route
  Firefox supports.
- **The CSP and the local vendor files.** Firefox's MV3 CSP forbids remote
  scripts just as Chrome's does, and the libraries are local already. Decoding
  the audio track requires the `'wasm-unsafe-eval'` source in the manifest,
  which Firefox accepts under the same key as Chrome — the same string works
  for both.
- **IndexedDB, `<video>`, MSE, Range requests.** The same APIs.
- **Optional host permissions.** In Firefox's MV3 host permissions are optional
  and user-granted by default, so the app's current model — ask for the
  permission only when the user gives their server — is the norm there rather
  than the exception.

## The one real risk: `js/remux.js`

Unpacking MKV into fMP4 is the most browser-sensitive part of the whole
project. Chrome and Firefox accept different things into a `SourceBuffer`: each
has its own requirements about where the `avcC` parameter sets sit, about the
timestamps in `moof` headers, and about the use of `changeType`. Code that one
accepts may fail in the other with an `InvalidStateError` and no further
explanation.

This is not a reason to leave Firefox undone, but it is a reason to set aside a
test round of its own for it. Everything else can be ported blind; this cannot.

## Publishing on AMO

- **Signing is mandatory.** Release Firefox will not install an unsigned
  extension permanently. A signature can be had from AMO without a public
  listing too (self-distribution).
- **Minified code.** AMO requires the source to be submitted when *you* minify
  or bundle. `vendor/hls.js` and `vendor/mpegts.js` are the libraries' own
  release files, covered by the separate third-party library policy: use the
  official release unmodified and state the version and origin, so the reviewer
  can compare it with the original. It is worth adding a `vendor/README` stating
  the version and the download URL.
- **`vendor/ffaudio` is a different case.** It is not a library's own release
  but our build of FFmpeg, so the clause requiring source and build
  instructions applies to it precisely. They are in place: `dev/wasm/build.sh`
  holds the whole command sequence, `dev/wasm/ffaudio.c` is the only source file
  of our own, and `vendor/ffaudio/LICENSE` states FFmpeg's tag and the
  replaceability LGPL 2.1 §6 requires.
- **Review is done by a human** and is slower than Chrome's, but the extension
  asks for no permissions at install time and does not touch the pages you
  browse, so it is an easy case for a reviewer.

## A proposed structure

One manifest, no build step, no conditionals in the code:

```
manifest.json      both background keys + browser_specific_settings
js/browser.js      api = browser ?? chrome            ← new
dev/dev.mjs        Chrome's loop
                   for Firefox: npx web-ext run
```

The alternative would be two manifests and a small `build.mjs` that picks the
right one. That would be tidier but would break the project's promise that the
files are, as they are, what the browser runs. The cost of a single manifest is
two cosmetic warnings, one in each browser.

## Effort

| Stage | Estimate |
| --- | --- |
| Shim, manifest, wording | 1–2 h |
| A pass through Firefox: lists, guide, EPG, live playback | 1–2 h |
| `remux.js` in Firefox | unknown, 0 h – several days |
| The first AMO release | 2–3 h |

Maintenance after that is effectively free: new features are written into the
player, not into the extension shell, and the shell does not change again.

## Bonus: Firefox for Android

Firefox is the only mobile browser that runs extensions. The same package
installs there once `browser_specific_settings.gecko_android` and its
`strict_min_version` are added. The interface is designed for the desktop and
would not do as it is, but the route exists — for Chrome it does not.
