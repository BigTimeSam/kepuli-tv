# Developing Kepuli-TV

Running the extension from the source, its structure, the languages, the brand graphics, the store screenshots and publishing. Back to the [README](../README.md).

## Running from the source

There is no build step: the files are, as they are, what the browser runs — so
edit and reload.

### Automatic loop

```
node dev/dev.mjs
```

Opens a Chrome profile of its own, loads the extension, opens the player and
reloads it whenever `js/`, `css/` or `player.html` changes. `manifest.json` and
`background.js` require the whole extension to be reloaded, and the script does
that too. No dependencies; Node 22+ is enough.

The profile is `~/.cache/kepuli-tv-dev`, i.e. separate from your own browser:
credentials are entered into it once and then persist. The port and the profile
can be changed with the environment variables `KEPULI_DEV_PORT` and
`KEPULI_DEV_PROFILE`.

### By hand in your own browser

1. `chrome://extensions` → **Developer mode** → **Load unpacked**
2. Click the icon → the player opens in a tab
3. After a change:

| Changed | Enough |
| --- | --- |
| `js/*.js`, `css/player.css`, `player.html` | reload the player tab (`⌘R`) |
| `manifest.json`, `background.js` | the extension's ↻ on the `chrome://extensions` page |

A page reload reads the files from disk again — ES modules included — so the
extension does not need reloading in ordinary work.

### Firefox

```
node firefox/dev.mjs
```

The same loop for Firefox: assembles `firefox/dist/` from the shared source,
starts Firefox with a profile of its own (`~/.cache/kepuli-tv-firefox`), loads
the add-on temporarily and opens the player. A change to `js/`, `css/` or
`player.html` rebuilds and reloads the page; a change to `background.js` or
`firefox/manifest.json` reloads the add-on. It speaks Firefox's Marionette
protocol directly (`firefox/marionette.mjs`), so nothing is installed here
either. `FIREFOX.md` has the whole picture, including what was measured.

### Firefox for Android, over USB

```
node firefox/android.mjs install      # the checkout as a temporary add-on, player opened
node firefox/android.mjs eval '<js>'  # run in the player tab
node firefox/android.mjs logs         # follow its console
node firefox/android.mjs shot         # the device's screen into dist/android/
```

For a phone or a tablet on the desk. Turn on USB debugging in Android's
developer options and *Remote debugging via USB* in Firefox's settings
(Advanced), and allow the connection on the device the first time. `install`
packages the checkout with its uncommitted changes and installs it over the
store version until Firefox restarts; the settings and accounts stay, since
the add-on id is the same. Run it again after a change. `bg '<js>'` evaluates
in the background page and `status` says what is installed. The tool speaks
Firefox's Remote Debugging Protocol through `adb forward`; it finds `adb` on
the PATH or in the Android SDK's default place. `FIREFOX.md` lists what
Firefox for Android lacks.

The focused UI regression check uses a temporary headless Chrome profile and
the local mock catalogue, without changing the development profile:

```
node dev/uicheck.mjs
```

It checks selection, return positions, search, filter chips, narrow layouts,
uninterrupted playback and the guide, and writes screenshots to its temporary
directory. It needs the mock media from `sh dev/mock/media.sh`. If port 9341
is in use, select a free one with `KEPULI_UI_PORT`.

Run the shared browser regression suite in Firefox with:

```
KEPULI_BROWSER=firefox node dev/playcheck.mjs
```

It builds the Firefox package and runs the same catalogue, guide, settings,
playback and recovery assertions through Marionette. A scenario name, such as
`catalogUi` or `subtitles`, runs only that case. The mock media must exist
first (`sh dev/mock/media.sh`). Use a dedicated test profile: the suite resets
its extension settings and personal lists to demo data.

### Note: `--load-extension` no longer works

Chrome rejects the flag silently (152 gives `ERR_BLOCKED_BY_CLIENT` on the
extension page). `dev/dev.mjs` therefore uses the DevTools protocol's
`Extensions.loadUnpacked` command, which also works as a reload when called
with the same path.

### Troubleshooting

- The player's console: right-click the tab → **Inspect**
- The service worker: `chrome://extensions` → the extension's **Service worker**
- Network requests show in the player's own DevTools window; the
  `player_api.php` calls are the easiest way to see what the lazy loading
  really fetches
- Clearing the cache (IndexedDB): **Settings → Clear cache**; removing
  everything, credentials included: **Settings → Reset everything**

### The Pages site

`docs/` is the GitHub Pages site at
[bigtimesam.github.io/kepuli-tv](https://bigtimesam.github.io/kepuli-tv/). The
privacy policy and the terms of use are hand-written HTML in `docs/privacy/`
and `docs/terms/`. The front page is the repository's README.md, rendered into
`docs/index.html` in the same style:

```
node dev/site.mjs
```

Run it after editing the README and commit the result; `--check` exits
non-zero if the page is out of date. The converter knows only what the README
uses — headings, lists, tables, fenced code, inline code, bold, italics and
links — and warns about anything else. No dependencies.

## Structure

```
manifest.json       MV3 manifest
background.js       a click on the icon opens the player
player.html         the whole interface on one page
css/player.css
js/api.js           player_api.php client, base64 EPG, time zones
js/xtream.js        building the Xtream URLs, parsing a pasted M3U address
js/m3u.js           reading M3U playlists, what a row is, catch-up addresses
js/xmltv.js         reading XMLTV guides as they download
js/m3usource.js     an M3U playlist as a catalogue, the same questions api.js answers
js/guide.js         an XMLTV guide kept per channel, matched to a playlist's channels
js/fetchtext.js     a long text download read in pieces, gunzipped when it is gzip
js/sync.js          sync between computers through the browser's storage.sync
js/picks.js         the picks on the empty player's page, and what the viewer watches
js/library.js       the lazy data layer: grouping, cache, search
js/epg.js           programme data on a queue, 4 concurrent requests
js/epggrid.js       the guide grid, virtualised in both directions
js/programmesearch.js  cancellable programme search and virtualised results
js/channelprefs.js  per-account channel visibility and ordering helpers
js/channelchoices.js  the countries the viewer watches, and what is hidden
js/rowmenu.js       a row's menu: a favourite or not, hide
js/modal.js         shared close buttons, Escape and backdrop dismissal
js/db.js            IndexedDB: a TTL cache
js/config.js        settings, favourites, history, resume points, the remembered view
js/i18n.js          the interface language: English and Finnish, t() and static HTML
js/locales/         the other twenty-eight languages, one module each, loaded when chosen
js/picker.js        the drop-down lists with a filter field
js/international.js  which channels are in many countries' lists
js/theme.js         the dark and light theme
store/listings/     the store texts, one file per language (dev/listings.mjs)
_locales/           the manifest's name and description per language, written from them
js/playback.js      engine selection, fallbacks, watchdog
js/probe.js         reading the file header: container, codecs, subtitles
js/audio.js         which audio track is played, and what it is called
js/lang.js          language codes and the names shown for them
js/ebml.js          EBML primitives and the Matroska header
js/mkv.js           Matroska clusters from a stream into frames
js/mp4.js           fMP4 segments for MediaSource
js/remux.js         the unpacking engine: downloading, seeking, buffers
js/ffaudio.js       AC-3, E-AC-3 and DTS decoding with wasm
js/transcode.js     decoded audio back to AAC, or to Opus where there is no AAC encoder, for MediaSource
js/subs.js          subtitle tracks from MKV into the video element's own tracks
js/subdisplay.js    the subtitle layer over the picture: the looks, the controls, full screen
js/vlist.js         the virtualised list
js/listnavigation.js  item selection, accessible focus and return positions
js/cataloguesearch.js  search scope, debounce and restoration of borrowed filters
js/playerlayout.js  full-width browsing and playback in narrow windows
js/rows.js          painting the list rows
js/name.js          a repeating prefix off the row names in a filtered view,
                    and the country a name or a category label points at
js/logos.js         channel logos from tv-logos, matched to a channel by name
js/logoindex.js     the tv-logos file list, generated by dev/logos.mjs
js/format.js        formatters
js/route.js         the place we are in, as an address: #/live/Finland/312
js/app.js           view coordination, playback actions, settings and keyboard
js/permissions.js   requesting and checking optional host permissions
js/external.js      hand-off to an external player: a one-item .m3u
icons/              16, 32, 48, 128 px extension icons
brand/              the sources of the brand graphics, not part of the package
dev/dev.mjs         the development loop: reloads the extension and the page
dev/wasm/           building ffaudio and comparing it with ffmpeg
dev/audiocheck.mjs  the decoded-audio route run inside Firefox or Chrome and compared with ffmpeg
dev/site.mjs        renders README.md into docs/index.html, the Pages front page
dev/logos.mjs       regenerates js/logoindex.js from the tv-logos repository
dev/screenshot.mjs  a 1280x800 store screenshot of the player, over the DevTools protocol
dev/store-screenshots.mjs  the five store screenshots, from the mock server's content
dev/mock/           a fake Xtream Codes server with invented content, and its media —
                    the same as an M3U playlist and XMLTV guide too (/playlist.m3u, /guide.xml.gz);
                    local development, screenshots and review fixtures only
firefox/            the Firefox version: its manifest, the build that assembles
                    firefox/dist/ from the shared source, and its development loop
docs/               the GitHub Pages site: front page, privacy policy, terms of use
FIREFOX.md          the Firefox version: what differs, how it is built and tested, what was measured
CHROMECAST.md       the Chromecast assessment, and the design built from it
store/chrome-dashboard.txt   the Chrome Web Store listing copy
vendor/             mpegts.js 1.8.0, hls.js 1.6.5 (local: MV3's CSP does not
                    allow remote scripts)
vendor/ffaudio/     FFmpeg 7.1.1's ac3, eac3 and dca decoders as wasm
```

## Language

The interface speaks thirty languages: English, Finnish, Swedish, Norwegian
(Bokmål), Danish, German, Dutch, French, Spanish, Brazilian Portuguese,
Italian, Polish, Turkish, Czech, Slovak, Slovenian, Hungarian, Romanian,
Bulgarian, Croatian, Serbian, Albanian, Greek, Russian, Ukrainian,
Lithuanian, Latvian, Estonian, Indonesian and Vietnamese. Serbian is written
in the Latin script, which its readers online and in providers' lists use;
a browser asking for `sh` or `cnr` gets it too, and one asking for Bosnian
(`bs`) gets Croatian, which writes ijekavian as Bosnian does. Portugal has a
store listing of its own (`store/listings/pt_PT.txt`), while the interface
speaks Brazilian Portuguese to it.

Settings > Clock is **Automatic**, **24-hour** or **12-hour**, each shown with
an evening time written its way. Automatic is 24-hour in every language —
Greek and Albanian included, whose own default is 12-hour, as a television
guide is read on the 24-hour clock there — except English in a browser whose
English is of a 12-hour region (en-US, en-CA, en-AU, en-IN…), which gets
10:30 PM. English dates follow the browser's region too: month before day in
the United States, day before month in the en-GB the app otherwise writes. Settings > Language starts on **Browser
language**, which names the language it comes to: the first one in
`navigator.languages` the app speaks (`no` and `nn` count as Bokmål), English
when there is none. It stays a following setting, not a copy — the stored
value is `auto`, so a settings save made for some other reason (the theme, a
subtitle language) does not freeze the language the browser happened to ask
for that day, and a browser switched to another language takes the app with
it. A language picked from the list is stored as itself and kept for good.
The subtitle language starts from the browser's answer too, rather than from
a fixed `fi`, which used to give an English interface offering Finnish
subtitles to someone who had asked for neither.

English and Finnish are written in `js/i18n.js`; the eleven others are in
`js/locales/`, one module each, and only the one in use is loaded — at start
and when the setting changes. English is at the same time the list missing
keys fall back to: a string left undone shows as English text rather than as
a key name. `dev/unitcheck.mjs` loads every language and proves that each has
every key, no stale ones, and the same `{placeholders}` as the English.
Plurals take the language's own forms from `Intl.PluralRules`: Polish has
`.one`, `.few` and `.many` where English has `.one` and `.other` (1 kanał,
2 kanały, 5 kanałów).

The language changes without a page reload. That works because the app repaints
its views from state anyway: the switch needs only a pass over the texts written
into the markup (`data-i18n`), a rebuild of the `Intl` formatters, and the same
paint calls that produce the views normally.

The choice steers the formatting too: the clock, the date, the thousands
separator and the alphabetical order of lists come from the language's tag
(`en-GB`, `fi-FI`, `pt-BR` and so on). `en-GB` rather than `en`, because in
this app the time is 21:30 and not 9:30 PM.

### Drop-down lists

Every drop-down opens the app's own list (`js/picker.js`). One of seven
choices or more has a filter field on top that narrows it by the words typed,
wherever they sit in a choice's name and without the marks a keyboard lacks
(*suo* finds Suomi, *deu* Deutsch, *swe* Sweden among the guide's countries);
a shorter one is read at a glance and has none. The arrows, Page Up/Down,
Enter and Escape work in it, and typing on a closed list opens it with what
was typed. The `<select>` stays the control: its label, value, styles and
listeners are untouched, only its opening is taken over, and a choice is
written back with the input and change events the browser would have sent —
so a select added later, such as the media filters', is covered without
being registered. The list is a popover in the top layer, over a dialog,
and Escape in it closes the list and leaves the dialog open.

## Brand graphics

The icon is a retro CRT television in the app's own palette (purple `#7c5cff`,
screen `#22d3ee`, knobs `#ffc857`). The sources are in the `brand/` folder,
which is excluded from the release package.

```
brand/tv-master-1024.png        the generated master image, 1024 px, transparent
brand/tv-master-prompt.txt      the prompt the master image came from
brand/tv-full.png               with aerials, used for sizes 128 and 48
brand/tv-compact.png            without aerials, for sizes 32 and 16
brand/store-icon-128.png        the store listing icon, 96 px of art on a 128 px canvas
brand/promo-small-440x280.png   the store's small promo image
brand/promo-marquee-1400x560.png  the store's marquee promo image
brand/promo.py                  typesetting the promo images (Pillow + SF)
brand/screenshots/              the five store screenshots, 1280x800
```

The aerial-free version is used at small sizes: at 16 pixels the aerials melt
into a dark smudge and eat space from the screen. The text in the promo images
is typeset with `promo.py` in the right font, because image models write letters
unreliably.

### Store screenshots

The screenshots show dummy content, because a real account's channels and
covers are somebody's property and no screenshot should carry them. `dev/mock/`
holds a fake Xtream Codes server with an invented catalogue — countries and
topics, channels with a programme guide, movies, series with episodes — and
the media are gradients that `dev/mock/media.sh` renders with ffmpeg: a live
channel at a constant 3 Mbit/s, an MP4 movie and an MKV episode with English
and Finnish subtitle tracks.

```
sh dev/mock/media.sh                                  once: renders the media
node dev/store-screenshots.mjs                        brand/screenshots/
KEPULI_BROWSER=firefox node dev/store-screenshots.mjs  brand/firefox-screenshots/
```

The Firefox set comes from the same walk, driven through Marionette rather
than DevTools — the same swap `dev/playcheck.mjs` makes to run its scenarios
in either browser. It captures at 1×: Firefox has no per-capture density, its
own is a profile preference, and asking for 2× there would need a 2560 × 1600
window.

The second command starts the mock server, points the development profile's
copy of the extension at it, walks through five views and captures each into
`brand/screenshots/` at 1280x800, as 24-bit PNG without alpha. A single view,
set up by hand in the development Chrome, is captured with
`node dev/screenshot.mjs out.png`. Both capture at 2x and scale down, which
needs uv for Pillow. The mock server also serves on its own,
`node dev/mock/server.mjs`, for developing without an account: user `demo`,
password `demo`, port 8790.

### Local testing and store review

The mock server and generated media are development and review fixtures.
Kepuli-TV does not provide a hosted demo, an IPTV service or a subscription
for customers. Users connect to their own compatible service using their own
credentials.

For local testing, run `sh dev/mock/media.sh` and then
`node dev/mock/server.mjs`. The Firefox reviewer source archive includes the
same tools so a reviewer can test with invented content on their own machine.
The instructions are in `firefox/AMO-BUILD.md`; test files are excluded from
the installable extension.

The release packages:

```
node dev/package.mjs --zip
```

builds `dist/chrome/` and `dist/firefox/` and zips them into
`kepuli-tv-chrome-<version>.zip` and `kepuli-tv-firefox-<version>.zip` in the
project root. A package is an allowlist, not the project minus exclusions:
`player.html`, `background.js`, `js/`, `css/`, `vendor/` and `icons/`, plus
the one manifest that belongs to the browser. Nothing else in the project can
get in, so the Chrome package cannot pick up Firefox's tooling or the other
way round. The files come from git, HEAD unless `--ref` names another commit
or tag, so uncommitted work in the checkout never ships by accident; the
script says what it left out. `--worktree` packages what is on disk instead,
and says what that includes. A single browser is `node dev/package.mjs chrome
--zip`.

The script compares the two manifests first and stops if the version or any
shared key differs, so a release bumps the version in both `manifest.json`
and `firefox/manifest.json`; `--check` runs that comparison alone. After the
copy it checks that every file the manifest and `player.html` refer to is in
the package, and lists the zip against the previous release of the same
browser, so a file that went missing or crept in shows up before the upload.
Then every older `kepuli-tv-*.zip` in the project root is moved into
`dist/releases/` (`firefox/amo-source.mjs` does the same), so the root holds
only the zips of the version being released and the store tools and
`gh release create` cannot pick an old one; the comparison reads the previous
release from either place. Nothing is deleted, and a name already taken in
`dist/releases/` leaves that zip in the root, reported. `*.zip` and `dist/`
are in `.gitignore`. AMO signs the Firefox package; see
`FIREFOX.md`. `firefox/build.mjs` remains the development loop's assembler of
`firefox/dist/` from the checkout, for `firefox/dev.mjs` to reload; its
`--zip` names its archive `kepuli-tv-firefox-<version>-dev.zip`, so a zip of
the working folder is never mistaken for the release package.

### Publishing to the stores

Each store takes one package, and the two zips lie side by side in the
project root with names that differ by one word:

| Store | Upload | Never |
| --- | --- | --- |
| Chrome Web Store | `kepuli-tv-chrome-<version>.zip` | the firefox zip |
| Firefox Add-ons (AMO) | `kepuli-tv-firefox-<version>.zip`, and `kepuli-tv-firefox-<version>-amo-source.zip` in the source field | the chrome zip |

`node dev/cws-publish.mjs` sends the Chrome package through the store's
publishing API: it checks that the zip is the Chrome package of the current
version, uploads it and submits it for review (`--replace` cancels a submission
still in review first, `status` shows what the store holds). A release that
adds languages runs `upload` first, which leaves the package as the draft, so
that the dashboard offers the new languages for their descriptions, and
`submit` once they are filled in. The one-time setup
of its credentials is in `store/chrome-dashboard.txt`, under "PUBLISHING THROUGH THE API".

`node dev/amo-publish.mjs` does the same for AMO through its API (v5): it checks
that the zip is the Firefox package of the current version, has AMO validate it,
makes the version with its source archive, and adds the release notes (the
GitHub release's text) and the notes to reviewer (`firefox/reviewer-notes.txt`,
held to 3000 characters), then brings the listing and the screenshots'
captions (`brand/firefox-screenshots/README.md`) in step; `listing` and
`captions` do either alone. `status`, `check` and `validate` send no version. Its
key is made at https://addons.mozilla.org/developers/addon/api/key/ and kept in
`~/.config/kepuli-tv/amo.json` as `{ "issuer": "user:…", "secret": "…" }`, mode 600.

The Chrome Web Store has twice been given the Firefox package, in 1.2.1 and
in 1.2.5, and accepted it without a word. At the time the Firefox manifest
started its background script with `background.scripts`, which Chrome ignores
in Manifest V3, so no service worker ran and the toolbar button did nothing
for every Chrome user until the next version. The source was right both
times. Only the upload was wrong, and the store does not take the same
version twice, so each time cost a version (1.2.2, 1.2.6).

Three things now stand against it:

- **The packages forgive the mix-up.** Since 1.2.6 the Firefox manifest
  names `background.service_worker` beside `background.scripts`. Chrome takes
  the service worker and ignores the scripts, and Firefox does the opposite,
  so either zip starts in Chrome. `dev/package.mjs` refuses a Firefox
  manifest without the same `service_worker` as the Chrome one. Do not
  remove that key to quiet an AMO warning about it.
- **Check the file name in the upload dialog.** It must say `chrome` for the
  Chrome Web Store and `firefox` for AMO. `store/chrome-dashboard.txt` says the same
  under *Publishing a new version*.
- **Check what the store actually published.** Once the Chrome Web Store has
  approved a version, read the manifest of the package it serves. It must
  show the new version and `"service_worker"`, and no `gecko`:

  ```
  mkdir -p /tmp/kepuli-store && cd /tmp/kepuli-store
  curl -sL -o store.crx "https://clients2.google.com/service/update2/crx?response=redirect&prodversion=150.0&acceptformat=crx3&x=id%3Dokkgclcakhjhldkdcblgagoaibghpfmi%26uc"
  unzip -o -q store.crx manifest.json; grep -E '"version"|service_worker|gecko' manifest.json
  ```

  `unzip` warns about extra bytes at the start, which is the CRX header and
  harmless. If the version is the old one, the review is not finished yet. If
  `gecko` shows up, the Firefox zip went to the Chrome store: publish the next
  version with the Chrome zip at once. An install from the store on another
  machine is the final test: the toolbar button must open the player.


#### The listings in thirty-one languages

The store texts are in `store/listings/<locale>.txt`, one file per language:
the name, the short description and the detailed description. The name is
"Kepuli-TV", the same in every language, and then "IPTV player" in the
listing's own language — "Kepuli-TV – IPTV-soitin", "Kepuli-TV – Lecteur
IPTV" — which is what a store's search in that language is typed as; the
word IPTV stays in every one. `dev/listings.mjs` insists on both.
`node dev/listings.mjs` checks them against the Chrome Web Store's limits
and keyword policy and writes `_locales/<locale>/messages.json`, from which
the manifest takes its name and description (`__MSG_appName__`,
`__MSG_appDesc__`) — the only way either store shows a translated title and
summary — and `dist/listings/<locale>.txt`, the texts unwrapped, to paste
into the stores' description fields. `dev/package.mjs` refuses a package
whose `_locales/` is out of step, renames Norwegian from the Chrome
store's `no` to Firefox's `nb_NO`, and leaves Albanian out of the Chrome
package: the Chrome Web Store has no code for it, so its listing is
Firefox's alone. How to enter the languages in each store is in
`store/chrome-dashboard.txt`.

#### Keeping the translations in step

A translation goes stale without a sign when the English is reworded. So
`store/translations.json` records, for every language, a short hash of the
English each interface key and each store listing was translated from, and
`node dev/translations.mjs` lists what is behind — keys whose English
changed or that a language lacks, and listings whose English changed — with
the English to work from. `dev/package.mjs` refuses a release while anything
is behind. After translating, `node dev/translations.mjs --mark <language>`
records it.

A translation can also be of the right English and still use another word
for a thing than the rest of its language does: "телегид" on a button and
"программа передач" in the settings. `store/i18n-glossary.json` records each
language's term for the core concepts (programme guide, favourites,
recording, catch-up, channel, account, playlist, portal, history, Continue
watching, subtitles, Settings), and `node dev/glossarycheck.mjs` fails when
an interface key or a store listing whose English holds a concept does not
say that language's term.

The listings reach the stores at release. `node dev/amo-publish.mjs` sends
the name, summary and description of every language to addons.mozilla.org
through its API, wherever they differ (`listing --dry` shows what would
change). The Chrome Web Store has no API for the detailed description, and
extensions are kept off its pages, so `node dev/cws-listing-fill.mjs` drives
a Chrome of its own over the DevTools protocol (a profile kept for it in
`~/.config/kepuli-tv/cws-chrome`, signed in to the publisher's Google account
by hand once): it compares every language's description in the dashboard,
types in the ones that differ, saves the draft, reads them all back from a
reloaded page and records what matches in `store/cws-listing.json` (`--dry`
compares only, `--only <locales>` limits it). It does not submit.
`node dev/cws-publish.mjs listing` names the languages behind, and a
submission is refused while one is, unless `--listing-later` is given.
