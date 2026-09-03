# Kepuli-TV

A Chrome extension (Manifest V3) that plays Xtream Codes IPTV straight in the
browser. Data is fetched from the `player_api.php` API lazily: only what you
browse, when you browse it.

## Intended use

Kepuli-TV is a player. It contains, distributes, hosts and indexes no media,
channels, playlists or providers, and ships no address to any service. It does
nothing without credentials the user brings.

It is intended solely for viewing content the user has the right to view: their
own paid subscription, their own media, or other material they are permitted to
watch. Users are responsible for ensuring that the service they use, and its
content, are lawful in their country.

The author does not provide, sell, recommend or advise on obtaining IPTV
subscriptions, and does not answer questions about them. Such issues are closed.

The software is provided as is, without warranty; see LICENSE.

## Installation

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. **Load unpacked** → pick this folder
4. Click the extension icon → the player opens in a tab of its own
5. Choose the connection mode: **Xtream Codes** (server, port, username,
   password) or **M3U address** (a single field for the playlist URL your
   provider gave you). Both end up in the same place, see below

Chrome 116 or newer, which is what `minimum_chrome_version` in the manifest
states.

In Firefox: `node firefox/build.mjs`, then `about:debugging` → **This
Firefox** → **Load Temporary Add-on** → `firefox/dist/manifest.json`. Firefox
128 or newer. A temporary add-on lasts until Firefox closes; the permanent
route is a signed package from AMO, see `FIREFOX.md`. The same code runs in
both browsers — `firefox/` holds only the Firefox manifest and the tools that
assemble the package from it.

## Development

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
and `docs/terms/`. The front page is this README, rendered into
`docs/index.html` in the same style:

```
node dev/site.mjs
```

Run it after editing the README and commit the result; `--check` exits
non-zero if the page is out of date. The converter knows only what the README
uses — headings, lists, tables, fenced code, inline code, bold, italics and
links — and warns about anything else. No dependencies.

## How the data is fetched

A large playlist is a poor starting point: the test server's `get.php` returns
75 megabytes and 272,000 lines, with no category identifiers and no information
about file formats. `player_api.php` gives the same thing structured and in
pieces, so the app loads in stages:

| Stage | What is fetched | Size | When |
| --- | --- | --- | --- |
| 1 | Categories (live + movies + series) | 43 kB | opening the connection |
| 2 | The chosen country's channels | 2–60 kB | on clicking a country |
| 3 | A type's whole list | 0.6–2.9 MB | only on search or the "All" selection |
| 4 | A series' episodes, a movie's details | 1–20 kB | on opening an item |
| 5 | Programme data for a channel | 1.6 kB | for visible rows |
| 6 | A channel's whole programme table | 50–150 kB | only when browsing into the past in the guide |

Measured times on the test server: Albania (3 topics) 0.27 s, Sweden (31 topics)
1.1 s, USA (48 topics) 1.6 s. Everything loaded is stored in IndexedDB, so the
next open is instant.

## Categories on two levels

The provider encodes two levels into a single string: `Sweden - Sport`,
`Sweden - Nyheter`, `Albania - Movies Club`. The app splits them, which
condenses 519 live categories into **81 countries** down the left-hand side in
alphabetical order. Choosing a country shows all of its channels, and the topic
buttons along the top narrow it to a subject. The buttons are in alphabetical
order, except for the country's own general category, which sits right after
the *All* button.

The button bar is as tall as its topics need, up to a ceiling of a quarter of
the column: Albania's three take one row and reserve nothing, USA's 48 fill six
or seven before the rest is left to scroll. A ceiling counted in rows rather
than in the column's height would be right for the small countries and short
for exactly those whose topics are worth reading. The bar's lower edge is a
handle: dragging it sets the height by hand — down to a single row when the
list matters more, up to 60 % of the column when the topics do — and a double
click gives the automatic height back. The height is remembered between
sessions, and it stays a ceiling rather than a height, so a country of three
topics never leaves a band of empty panel below them.

The same splitting removes the `Movies:` and `Series:` prefixes from movies and
series, which only repeat the name of the tab.

Lists are always sorted alphabetically — channels, movies and series, within a
category, within a group and in the *All* list. The provider's own order varies
from one category to the next and carries no meaning across the list.
Punctuation at the start of a name (`|FI| Alien`) is ignored, and numbers are
compared as numbers, so *Rocky 2* comes before *Rocky 10*. When a repeating
prefix has been stripped from a row (below), the order follows the visible
name. Search still ranks matches by relevance, but equally ranked matches fall
into alphabetical order.

The sidebar filter matches sub-categories too: the query *sport* brings up the
countries that have sports channels even when the country's name lacks the
word.

### The repeating prefix

Once a country or a topic has been chosen, the beginning of the row name
repeats what the sidebar already says: under *USA ▸ NHL*, `US: NHL Ice Center
Pass 3 FHD` is distinguished from no other visible row by its prefix, which
only takes space from a narrow column. `js/name.js` strips two things from the
start of the name: a country code closed by a hard separator (`US:`, `|FI|`,
`EX-YU |`) and the words of the filters that are on.

Both go only when an absolute majority of the visible rows repeat them. That is
why `USA Network HD` survives intact under the country *USA* — the start of a
name is part of the name when the others do not repeat it — and why the
separator is part of the detection, or `US Open Tennis` would lose its
beginning. The prefixes come in either order (`US: NHL …`, `NHL US: …`), so the
passes are repeated until nothing matches any more, and the whole name is
always in the row's title text.

Only a filtered view is tidied. In search, in the favourites and in the history
the rows come from different groups, so there the prefix is what tells them
apart and it stays put. Inside a favourite category the filter is known even
though the sidebar does not show it, and the names tidy up as in the browsing
view.

### A category as a favourite

Starring a single channel is not enough when the interesting thing is a whole
category: *Finland ▸ MTV Liiga* is eight channels today and some other number
next season. That is why there is a star on the sidebar country row and on
every topic chip as well — the first picks the whole group, the second one
category.

The *Favourites* tab lists them as a group of their own above the channels and
the movies, and tapping a row opens the category's contents on the spot: the
same list as in the browsing view, the same row names and programme data, but
returning to the favourites is one tap. The contents are always fetched fresh,
so channels that have appeared in the category show up without the favourite
needing an update.

Only an identifier is stored — the type, the `category_id` and the visible
name — not the category's contents. A group favourite (*Finland*) stores the
group name and gathers its sub-categories only when opened, so it follows a
changing offering too.

The search in the header covers the whole list (the category filter is cleared
visibly) and ranks matches by relevance: a match at the start of a word beats
one found mid-word, so that *yle* raises the Yle channels rather than "KYLE
COLLECTION".

## Features

- **Programme data** for visible channels: the programme on air and a progress
  bar on the list row, a description and the next programme below the player
- **An interactive programme guide** (`g`): channels as rows, time on the
  horizontal axis and a moving now line — see below
- **Catch-up** for channels that have an archive: a past programme can be
  started straight from the guide
- **Series** by season, with cover art and plots from TMDB
- **Movie details**: plot, running time, rating, codec
- **MKV plays** without an external player: the container is unpacked on the
  fly into fMP4, seeking included. If the audio track is AC-3 or DTS, **Play
  without sound** is on offer
- **Subtitles** from MKV files: a language and size selector below the player,
  and the chosen language carries over to the following episodes — see below
- **Unplayable files are marked in the list** before you click; once a file has
  been examined the mark sharpens according to its codecs
- **Hand-off to an external player** (`↗` or `x`) for what the browser cannot
  do — see below
- **Chromecast** (`Cast` or `c`): a natively played file goes to the device
  through the Remote Playback API, and for the rest the button explains how
  Chrome's own tab casting does it — see below
- **Resume positions remembered** for movies and episodes, with a progress bar
  on the row
- **Favourites** and **history** as tabs of their own — a whole category can be
  a favourite too, see below
- **Two languages**: English and Finnish, switched in the settings without a
  page reload
- **Automatic reconnection** when a live stream drops — the death of a source
  is recognised in three ways: the server cuts the connection, the buffer is
  played out, or the picture freezes while the connection stays open. The
  viewer's own pause is told apart from these and is never overridden
- **Technical details** over the picture: resolution, bitrate, engine
- **The account's expiry date** in the top bar, in warning colour for the last
  fourteen days — the rest of the account's details are in the settings

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| `/` | go to the search box |
| `↑` `↓` `PgUp` `PgDn` | move in the list |
| `Enter` | play / open a series |
| `Backspace` | back to the series list |
| `space` | pause |
| `f` | full screen |
| `m` | mute |
| `n` `p` | next / previous |
| `g` | open and close the programme guide |
| `x` | hand over to an external player |
| `c` | cast to a Chromecast |

In the guide the arrows move between channels and programmes, `PgUp` and
`PgDn` a screen at a time, `Home` returns to the present, `+` and `−` adjust
the timeline's scale, `Enter` starts playback and `Esc` closes.

### The buttons

The top bar holds the five tabs, the search box, the account's expiry date and
three buttons: **Guide**, **Refresh** — which fetches the categories and the
lists already loaded from the server again and empties the programme cache —
and **Settings**. The player's own row is below the picture:

| Button | Action |
| --- | --- |
| `Auto` `TS` `HLS` | the engine for a live channel; `Auto` is described below |
| the subtitle selectors | language and size, on a file that carries subtitles |
| `☆` | the channel or the film into the favourites |
| `↻` | reload the stream |
| `PiP` | picture in picture |
| `Cast` | to a Chromecast — see below |
| `URL` | the stream address to the clipboard |
| `↗` | hand over to an external player |

### Settings

The dialog holds the connection mode with its fields (see below), the
interface language, and two switches: whether programme data is fetched
automatically and whether the position of movies and episodes is remembered.
Below them are the account's own details as the server reports them — status,
simultaneous connections, the expiry date, the output formats, the server's
time zone, the size of the cache and the lists loaded so far — and the two
buttons that empty things: **Clear cache** leaves the credentials and the
favourites in place, **Reset everything** does not.

The cache belongs to the server and the account. Saving a connection whose
server, port, protocol or username differs from the previous one empties it
first, so another server's listing — or another account's on the same server
— never shows under the new one. The password is not part of the comparison,
so correcting it costs nothing.

## The programme guide

`Guide` (or `g`) turns the whole window into a grid view: channels as rows,
time on the horizontal axis and a moving now line. The video continues in the
top right corner and the selected programme shows on the left with its
description. The grid shows the same set of channels as the list, so the group
selection and the search narrow the guide as well.

The timeline runs from two days back to five days forward. Past programmes are
dimmed; those the channel's archive reaches get a **Watch the recording**
button. A programme continuing past the left edge is marked with `‹` and its
name is nudged into view.

Programme data is fetched at three levels of detail into the same cache: a list
row needs four programmes, looking ahead in the guide needs 40, and the whole
programme table is fetched only when the grid is scrolled past the known
programmes. A coarser level is never fetched over a finer one, so a channel
visited in the guide does not fall back to four programmes as the list is
browsed.

## Playback routes

| Source | Engine |
| --- | --- |
| Live (MPEG-TS) | mpegts.js → MediaSource |
| Live (`.m3u8`), or the fallback from TS | hls.js |
| VOD `.mp4` `.m4v` `.mov` `.webm` | the browser's own player |
| VOD `.ts` `.flv` | the header decides — the extension does not hold |
| VOD `.mkv` | Matroska unpacked into fMP4 → MediaSource |
| VOD `.avi` | not supported |

`Auto` tries TS first on live channels (lower latency) and moves to HLS if TS
does not start within 20 seconds. On the test server HLS often starts faster
but trails the live edge by a segment length.

In the test material 54% of the movies are `.mp4` and 44% `.mkv`. For
unplayable ones, **Copy address** and **Open in an external player** are
offered.

### External player

Unpacking and wasm audio cover most of the library, but not all of it: the AVI
container, VC-1, 10-bit H.264 and bitmap subtitles (PGS, VOBSUB) stay out of
the browser's reach. A desktop player handles them natively and takes the
Xtream stream URL as it is. The hand-off is always manual — from the `↗` button
below the player, the `x` key, or a button in an error message — and never
happens by itself.

There were two routes, one is left: a one-item `.m3u` is downloaded from a
blob, and the operating system opens it with whichever player is registered for
`.m3u` — for VLC that is `public.m3u-playlist` in its Info.plist. Two clicks,
no new manifest permissions and no bridge between the extension and the
operating system.

Player-specific URL schemes (`iina://`, `mpv://`) used to be selectable and were
dropped: they saved one click but required a choice from the user and knowledge
of what they had installed. **VLC does not register a `vlc://` scheme on
macOS** — its Info.plist lists only `http https ftp mms mmsh rtmp rtmpe rtmps
rtmpt rtp rtsp sftp smb udp` — so for the most common player the file route was
the only one anyway.

The resume position travels along: `#EXTVLCOPT:start-time=` is written into the
playlist at the point the browser had reached. Playback is stopped before the
hand-off, because the account allows one concurrent connection — otherwise a
stream the browser keeps open would leave the external player silent.

The URL carries the credentials, so a downloaded `.m3u` is as sensitive as the
account itself.

### Chromecast

The `Cast` button (or `c`) works in two ways, and `CHROMECAST.md` holds the
assessment behind them.

A file the browser plays natively — `.mp4`, `.m4v`, `.mov`, `.webm` — goes to
the device through the Remote Playback API: Chrome's own device picker opens,
and Chrome sends the compressed picture and sound to the device as they are.
Nothing is re-encoded, the server needs no CORS headers, and the browser keeps
the one connection the account allows. The tab has to stay open, and
*Chromecast* shows on the engine line below the player while the device plays.

Everything that runs through MediaSource — live channels, HLS, the MKV
unpacking — is outside that API's reach on desktop Chrome, which accepts only
a plain `http(s)` source for it. For those the button explains the route that
does work: **Cast…** in Chrome's menu, this tab, then `f`. Once the video is
full screen Chrome switches by itself from mirroring the screen to sending the
compressed stream, MediaSource included. Subtitles are drawn by the browser
and travel only while the screen is mirrored, not after the switch.

The Google Cast SDK is not used. Manifest V3 forbids loading it from Google's
servers, and what it offers — the device fetching a URL by itself — would
cover only MP4 files and HLS from servers that send CORS headers; neither
MPEG-TS nor Matroska plays on the device's own player.

### Unpacking Matroska

Chrome will not take Matroska, but the H.264 or HEVC inside it is fine as it
is. `js/mkv.js` demuxes the clusters from the stream, `js/mp4.js` packs the
frames into fMP4 segments and `js/remux.js` feeds them to MediaSource. The
picture is neither decoded nor re-encoded — only the container changes.

Three points needed care:

- **Decode time.** Matroska stores only the presentation time. Because of
  B-frames the two differ — in a measured episode 740 of 1569 frames had a PTS
  that went backwards from the previous one. The DTS is obtained by sorting a
  segment's timestamps ascending and handing them out in decode order.
- **Time units.** For video, 90,000 ticks per second divides evenly at every
  common frame rate. For audio the sample rate is used and frames are chained
  back to back, because Matroska's millisecond resolution would round an AAC
  frame's 21.333 ms duration and the error would accumulate into seconds over
  an hour.
- **One connection.** The account allows one concurrent download, so the header
  is read from the same stream playback continues from. Seeking cuts the stream
  and opens a new one at the offset the Cues table points to; the table is at
  the end of the file, so it is fetched only if a seek happens.

An interrupted download resumes from the start of the last complete cluster. If
the file is broken instead — the library held an episode followed by three
megabytes of zeros and no cluster at all — playback ends at the intact point
and the viewer is told how far the picture went.

### Subtitles

The unpacking picks up the subtitle tracks along the way (`js/subs.js`). A
block's text is handed to the browser as a `VTTCue` rather than to an overlay of
our own: that way the subtitles show in full-screen mode and in Chrome's own
subtitle menu. The choice is made from the selector below the player, and the
language — not the track number — is remembered, so the next episode of a series
opens in the same language. The default is Finnish when the file has a Finnish
track.

The selector is in alphabetical order for the interface language: the file's own
order is arbitrary, and in a list of thirty tracks the right language cannot be
found unless its place can be guessed. Beside it is the size (small, medium,
large), which scales relative to the browser's own measure — a fixed pixel size
would shrink to nothing in full-screen mode.

The cues of every text track are collected as the file is unpacked, even though
one is visible. The alternative would be reading the file again when the track
changes, which would take the single allowed connection and interrupt the
picture. After a seek the same blocks arrive again, so a cue that has already
been added is recognised and skipped.

Limits:

- **SRT, ASS/SSA and WebVTT** are accepted. Bitmap formats (PGS, VOBSUB,
  DVBSUB) are images and cannot be handed to a `VTTCue`, so they are left out of
  the selector — the list row's "34 subtitles" counts them in.
- ASS style codes (`{\an8}`, `{\pos}`) are stripped and italics survive;
  backgrounds and effects made with drawing commands are not rendered.
- Only the unpacking route knows about subtitles. The `mov_text` of a natively
  played MP4 is still left out, because Chrome does not render it.

### What unpacking opens up

Measured on a sample of 1,500 series (23,628 episodes):

| | Share of episodes |
| --- | --- |
| Played before unpacking | 44.6% |
| Unpacked, audio as it is | +21.6% → **66.2%** |
| Unpacked, audio decoded (AC-3/E-AC-3/DTS) | +27.5% → **93.7%** |

The last row needs a decoder of its own, because Chrome has neither AC-3,
E-AC-3 nor DTS. An alternative audio track is not worth waiting for: of 45
ac3/eac3 episodes not one had a second track Chrome supports, and 43 had a
single audio track. **Play without sound** therefore remains only for the few
tracks that are not decoded (TrueHD, or MP3 in MKV, for instance).

### Decoding the audio track

The decoder is FFmpeg's own, built as wasm (`vendor/ffaudio`, LGPL 2.1+,
628 kB). A hand-written AC-3 decoder would cover only part of it: E-AC-3 is not
the same bitstream but adds AHT, spectral extension and substreams, and DTS is a
third separate one. The build is `dev/wasm/build.sh`, and `--test` compares the
output with ffmpeg's own from the same bitstream — in every case the difference
is float rounding (~1e-7), including the 5.1 downmix and the 32 kHz conversion.

MediaSource will not take PCM, so the decoded audio is re-encoded to AAC with
the browser's own `AudioEncoder` (`js/transcode.js`). Two measured constraints
set the format:

- **The encoder accepts only 44,100 and 48,000 Hz**, and it does not tolerate
  the channel count changing mid-track. AC-3 allows 32,000 Hz, and the library
  holds files where mono turns into stereo. That is why the wasm decoder brings
  everything down to a fixed format (stereo, 48 kHz) before the encoder. The
  downmix is asked of the decoder itself, which uses the stream's own
  cmixlev/surmixlev levels; swresample's generic matrix gave a different,
  clipping result when measured.
- **The encoder has a priming delay that it neither reports nor corrects** —
  2112 samples, or 44 ms, when measured, which is macOS's AudioToolbox figure
  and therefore not portable. Without correction the audio would lag the picture
  by that much throughout. The figure is therefore measured at run time: a known
  impulse is encoded and decoded back with the browser's own decoder. Measured,
  the chain lands sample-accurate and does not creep at all over 60 seconds.

Back pressure is handled by waiting rather than flushing: `flush()` forces the
encoder to emit a partial frame padded with silence, and the frame chain would
stretch every time — measured, 60 seconds of picture came out as 69 seconds of
audio.

### Reading the file header

The extension is not enough to decide on, and the API's metadata cannot be
trusted. Measured from the test server (1,500 series, 23,628 episodes):

- `get_vod_info` returns no codecs at all — so nothing is known about a movie
  beyond its extension
- `get_series_info` reports `png` or `mjpeg` as the video codec for 4.7% of
  episodes: that is the cover image, which ffprobe sees as the first track
- VOD files with a `.ts` extension were Matroska without exception in the sample
  (10/10) — `.mp4` and `.mkv`, on the other hand, held true (8/8 each)
- the audio decides more often than the container: of the mkv episodes around
  42% are `aac` and 53% `ac3`/`eac3`/`dts`, which Chrome will not decode by any
  route

`js/probe.js` therefore reads the first 256 kB of the file with a single Range
request and parses Matroska's `Tracks` element: the container, the codecs with
their profiles, the audio tracks and the subtitles with their languages. The
profile is needed because Chrome does not decode 10-bit H.264 — a bare `avc1`
would give too hopeful an answer. The result is stored in IndexedDB and shows on
the list row without a new request.

The header is not read up front: the account allows one concurrent connection,
so the read happens only when the extension does not promise playback, when the
container is known to be unreliable (`.ts`), or when every engine has failed.
Then the error message states the reason: *"The audio track is MP3, which Chrome
does not decode. The picture would play, the sound would not."* rather than
merely the extension.

## Structure

```
manifest.json       MV3 manifest
background.js       a click on the icon opens the player
player.html         the whole interface on one page
css/player.css
js/api.js           player_api.php client, base64 EPG, time zones
js/xtream.js        building the Xtream URLs, parsing a pasted M3U address
js/library.js       the lazy data layer: grouping, cache, search
js/epg.js           programme data on a queue, 4 concurrent requests
js/epggrid.js       the guide grid, virtualised in both directions
js/db.js            IndexedDB: a TTL cache
js/config.js        settings, favourites, history, resume points
js/i18n.js          the interface language: dictionaries, t() and static HTML
js/playback.js      engine selection, fallbacks, watchdog
js/probe.js         reading the file header: container, codecs, subtitles
js/ebml.js          EBML primitives and the Matroska header
js/mkv.js           Matroska clusters from a stream into frames
js/mp4.js           fMP4 segments for MediaSource
js/remux.js         the unpacking engine: downloading, seeking, buffers
js/ffaudio.js       AC-3, E-AC-3 and DTS decoding with wasm
js/transcode.js     decoded audio back to AAC for MediaSource
js/subs.js          subtitle tracks from MKV into the video element's own tracks
js/vlist.js         the virtualised list
js/rows.js          painting the list rows
js/name.js          a repeating prefix off the row names in a filtered view
js/format.js        formatters
js/app.js           views, search, keyboard
js/permissions.js   requesting and checking optional host permissions
js/external.js      hand-off to an external player: a one-item .m3u
icons/              16, 32, 48, 128 px extension icons
brand/              the sources of the brand graphics, not part of the package
dev/dev.mjs         the development loop: reloads the extension and the page
dev/wasm/           building ffaudio and comparing it with ffmpeg
dev/site.mjs        renders README.md into docs/index.html, the Pages front page
dev/screenshot.mjs  a 1280x800 store screenshot of the player, over the DevTools protocol
dev/store-screenshots.mjs  the five store screenshots, from the mock server's content
dev/mock/           a fake Xtream Codes server with invented content, and its media;
                    also the Fly.io demo the store reviewers are given
firefox/            the Firefox version: its manifest, the build that assembles
                    firefox/dist/ from the shared source, and its development loop
docs/               the GitHub Pages site: front page, privacy policy, terms of use
FIREFOX.md          the Firefox version: what differs, how it is built and tested, what was measured
CHROMECAST.md       the Chromecast assessment, and the design built from it
store-listing.txt   the Chrome Web Store listing copy
vendor/             mpegts.js 1.8.0, hls.js 1.6.5 (local: MV3's CSP does not
                    allow remote scripts)
vendor/ffaudio/     FFmpeg 7.1.1's ac3, eac3 and dca decoders as wasm
```

## Things worth knowing

- Credentials are stored in the clear in `chrome.storage.local` on this machine.
  In Xtream the credentials are also part of every stream URL.
- **Settings → Reset everything** removes it all: credentials, settings,
  favourites, history, resume points and the entire IndexedDB database. The
  button asks for confirmation itself — a second dialog opened on top of the
  settings dialog would end up beneath it — and reloads the page at the end,
  because the state in memory would correspond to nothing after the wipe.
- The host permissions are in the `optional_host_permissions` list, so
  installation asks for access to nothing. Access is asked for only when the
  server address is saved, and only for that server's origin. A missing
  permission shows up as a network error, alongside which there is a button for
  granting it. There are no content scripts.
- Access is needed only for fetch/XHR requests: `player_api.php` and the segment
  requests of hls.js and mpegts.js. Natively played VOD (`<video src>`) and
  channel logos (`<img>`) work without it.
- **The concurrent connection limit** shows in the settings. On the test account
  it is 1, which leaves a second simultaneous stream silent. The app tears down
  the previous stream before opening a new one, but if playback does not start,
  check that the same account is not in use elsewhere.
- Programme data exists only for the channels the provider has defined it for —
  on the test server, around 8,800 channels out of 29,600.
- Some channel logos are broken at the server's end (the URLs point at a deleted
  GitHub repository). They are hidden automatically.

## Language

The interface is in English and Finnish; English is the default and the choice
is made in the settings. The dictionaries live in one file (`js/i18n.js`), and
English is at the same time the list missing keys fall back to — a Finnish
string left undone shows as English text rather than as a key name.

The language changes without a page reload. That works because the app repaints
its views from state anyway: the switch needs only a pass over the texts written
into the markup (`data-i18n`), a rebuild of the `Intl` formatters, and the same
paint calls that produce the views normally.

The choice steers the formatting too: the clock, the date, the thousands
separator and the alphabetical order of lists come from the `en-GB` or `fi-FI`
tag. `en-GB` rather than `en`, because in this app the time is 21:30 and not
9:30 PM.

## Connection mode

The settings hold two ways of saying the same thing. **Xtream Codes** asks for
the server, the port, the username and the password separately. **M3U address**
takes a single field for the playlist URL the provider gave you — it carries the
same credentials as query parameters, so they are parsed into fields and the
connection is made in exactly the same way. The choice changes only the form;
behind it lie the same API and the same details either way.

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
sh dev/mock/media.sh              once: renders the media
node dev/store-screenshots.mjs
```

The second command starts the mock server, points the development profile's
copy of the extension at it, walks through five views and captures each into
`brand/screenshots/` at 1280x800, as 24-bit PNG without alpha. A single view,
set up by hand in the development Chrome, is captured with
`node dev/screenshot.mjs out.png`. Both capture at 2x and scale down, which
needs uv for Pillow. The mock server also serves on its own,
`node dev/mock/server.mjs`, for developing without an account: user `demo`,
password `demo`, port 8790.

### The demo server for the store review

The Chrome Web Store reviewers need an account to see anything, and a real
IPTV subscription is nobody's to hand out. The same mock server runs on
Fly.io as a public demo, https://kepuli-demo.fly.dev, user `demo`, password
`demo`, and the review form carries those with a walk-through (see
`store-listing.txt`). The live channel there is an endless HLS loop of the
same segments; the `.ts` address answers 404 and the player falls back to
HLS by itself.

`dev/mock/Dockerfile` and `dev/mock/fly.toml` describe it: one small machine
that stops when nobody is connected and starts on the first request, so it
costs next to nothing between reviews. The media are rendered on the machine
that deploys and copied into the image. To ship a change:

```
sh dev/mock/media.sh
cd dev/mock && fly deploy
```

`KEPULI_DEMO_URL=https://kepuli-demo.fly.dev node dev/store-screenshots.mjs`
runs the screenshot walk against the deployed demo, which is the check that
what the reviewers get really works; `KEPULI_SHOTS_DIR` keeps the pictures
out of `brand/screenshots/`.

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
the package, and lists the zip against the previous one of the same browser,
so a file that went missing or crept in shows up before the upload. `*.zip`
and `dist/` are in `.gitignore`. AMO signs the Firefox package; see
`FIREFOX.md`. `firefox/build.mjs` remains the development loop's assembler of
`firefox/dist/` from the checkout, for `firefox/dev.mjs` to reload.

## Licence

The project's own code is MIT licensed, see [LICENSE](LICENSE). The `vendor/`
directory holds third-party code on its own terms: `hls.js` and `mpegts.js`
under Apache-2.0, and `vendor/ffaudio/` built from FFmpeg under LGPL-2.1+. The
build commands are in `dev/wasm/build.sh`, so that the relinking required by
LGPL 2.1 §6 is possible.

Copyright (c) 2026 Samuli Vainio
