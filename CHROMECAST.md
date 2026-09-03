# Chromecast

An assessment of what Chromecast support takes in a Manifest V3 extension
whose playback mostly runs through MediaSource, and the design that was built
from it.

**Short answer:** it works, but not through one mechanism, and how much of the
library it reaches depends on the playback route. Natively played files get a
Cast button of their own; everything that goes through MediaSource is cast with
Chrome's own menu, and the button's job there is to say so. Neither needs the
Google Cast SDK, a new manifest permission or any remote code.

## Three facts that decide the design

### 1. Manifest V3 forbids the Cast SDK as it is shipped

The Web Sender SDK is loaded from `www.gstatic.com`, and the extension's CSP is
`script-src 'self'`; Chrome Web Store policy forbids remotely hosted code
altogether. The SDK could be copied into the package — it is, in the end, a
layer over Chrome's Presentation API, which the extension page does have
(measured below) — but it loads its framework half dynamically, and its terms
for self-hosting would have to be checked. More to the point, all it would buy
is the third route below.

### 2. The device's own player takes a narrow set of formats

Google's list of what the Default Media Receiver plays:

| Format | On the device |
| --- | --- |
| Progressive MP4, WebM | yes, and without CORS |
| HLS, DASH, Smooth Streaming | yes, but the segments are fetched with XHR, so the server must send CORS headers |
| Raw MPEG-TS over HTTP — Xtream's `live/…/id.ts` | no |
| Matroska | no |
| AC-3, E-AC-3 | passthrough on some devices |
| DTS | no |

The mock server sends `Access-Control-Allow-Origin: *`; a typical Xtream panel
sends nothing. Flinging a URL to the device would therefore reach the `.mp4`
movies — 54% of the test library — and the HLS variant of a live channel on a
server with CORS, and nothing else. It would also take the account's single
connection, so the browser would have to stop first, as the hand-off to an
external player already does.

### 3. Desktop Chrome's Remote Playback API is not URL flinging

`video.remote.prompt()` opens Chrome's device picker. On Android it hands the
URL to the device. On desktop, in Chromium's source, it opens a mirroring
session to the device and switches the media pipeline to *media remoting*: the
element's compressed picture and sound are sent as they are, and the device
decodes them. Chrome does the fetching and the demuxing, so the container is
irrelevant, the server needs no CORS, and the browser keeps the one connection.

The conditions, from `remote_playback.cc` and
`media/remoting/renderer_controller.cc`:

- The element's source must be an `http`, `https` or `file` URL. A
  MediaSource is a `blob:` URL, so the API reports it as unsupported: no
  availability, and `prompt()` rejects. That rules out mpegts.js, hls.js and
  the MKV unpacking.
- The duration must be known and longer than 15 seconds; a live stream's
  `Infinity` passes.
- Video H.264, VP8, VP9, HEVC or AV1; audio AAC or Opus, and on devices that
  report the baseline set also AC-3, E-AC-3, DTS and a few more. Nothing
  encrypted.
- The tab stays open: Chrome is the sender.

The same remoting is what Chrome does by itself during an ordinary **Cast tab**
session, as soon as the video is the dominant content on the page — full
screen, in practice — is playing, and is longer than 60 seconds or live. Then
it covers MediaSource too, because at that point the stream is already
demuxed. Leaving full screen switches back to mirroring the screen.

### Measured on the extension page

Whether any of this is reachable from a `chrome-extension://` origin was
checked over the DevTools protocol in the development Chrome (152), on the
player page:

| Probe | Result |
| --- | --- |
| `navigator.presentation`, `PresentationRequest` | present |
| `'remote' in HTMLMediaElement.prototype` | true |
| `new PresentationRequest('cast:CC1AD845').getAvailability()` | resolved `false`, no error |
| `video.remote.watchAvailability()` on an `http` mp4 | callback with `false` |

No Chromecast was on the network, so `false` is the honest answer for both;
the point is that neither call refused the extension origin. The same probe
with a device present is the first test to run (below).

## The routes, and what casts them

| Route in the player | Share | Cast button | Chrome's Cast tab |
| --- | --- | --- | --- |
| Live, MPEG-TS (mpegts.js → MediaSource) | every channel | explains the tab route | yes, remoted in full screen |
| Live, HLS (hls.js → MediaSource) | the fallback | explains the tab route | yes |
| VOD `.mp4` `.m4v` `.mov` `.webm` (native) | 54% of movies | **the device picker** | yes |
| VOD `.ts` `.flv` (mpegts.js) | few | explains the tab route | yes |
| VOD `.mkv` (unpacked → MediaSource) | 44% of movies, most episodes | explains the tab route | yes |

## What was built

### The button — `js/cast.js`

`Cast` wraps the element's `remote` object: availability monitoring, the
picker, and the `connecting`, `connect` and `disconnect` events, which light
the button and put *Chromecast* on the engine line below the player.

`castCurrent()` in `js/app.js` is the button and the `c` key:

1. Nothing playing → a toast.
2. Already casting → the picker again, which is where Chrome lets the viewer
   stop.
3. The engine is not yet known → *wait for playback to start*.
4. The engine is `native` → `remote.prompt()`, called straight from the
   gesture with no `await` before it, exactly like `permissions.request`. A
   `NotFoundError` means no device on the network, `NotAllowedError` that the
   picker was closed; anything else falls through to the next case.
5. Any other engine → the overlay explains the tab route, with a **Full
   screen** button that closes the overlay and puts the video full screen.

The button is hidden where the API does not exist (Firefox). It is shown even
when no device has been found, because for the MediaSource routes availability
is never reported, and the tab route works regardless.

Nothing in `playback.js` changes. The engine's name was already exposed as
`engineKey`, and the live watchdog does not run on the native route, so the two
do not meet. The resume position needs no handling: Chrome continues from the
element's current time. When the viewer switches to a MediaSource item while
casting, Chrome ends the session and `disconnect` unlights the button.

Chrome's own `<video controls>` shows a cast button in its overflow menu for
the same native sources when a device is around — so half of the first route
existed before this. The button makes it visible and says why it is not on
offer for the rest.

### The MediaSource routes — Chrome's Cast tab

A page cannot start tab casting; there is no API for it. The overlay is the
best that can be done, and it is enough: **Cast…** in Chrome's menu, this tab,
then `f`. The player's `f` puts the video element itself full screen, which is
what Chrome's dominant-content check wants.

The audio of an MKV has already been decoded from AC-3 or DTS and encoded to
AAC — or to Opus, where the browser has no AAC encoder; remoting takes both —
before it reaches MediaSource, so it suits remoting as it is.

**Subtitles** are the known casualty. The player hands them to the browser as
`VTTCue`s, which the video element draws; media remoting carries only the
encoded audio and video, so once Chrome switches from mirroring to remoting the
subtitles stay on the laptop. While the screen is mirrored they show. This
follows from the protocol's definition (`media/remoting/proto`) and is to be
confirmed on a device; if confirmed, the overlay text should say so.

### What changed

```
js/cast.js         new: the Remote Playback wrapper
js/app.js          castCurrent, showCastHint, renderCastState; the c key;
                   Chromecast on the engine line
player.html        the Cast button next to PiP
js/i18n.js         nine keys in both languages
README.md          the button, the key, a Chromecast section under the routes
store-listing.txt  the feature and the key
manifest.json      nothing
```

## Left out: the Default Media Receiver

The third route — the device fetches the stream itself, and the browser may
close — was designed and not built. Its reach is the `.mp4` movies and, on a
server that sends CORS headers, live HLS; MPEG-TS and Matroska never play on
the device's own player. If demand appears, this is how:

- **A sender.** Either the SDK copied into the package (`cast_sender.js` and
  `cast_framework.js`, with the dynamic load of the latter cut out), or a thin
  client of our own on the Presentation API:
  `new PresentationRequest('cast:CC1AD845?clientId=…').start()` gives a
  `PresentationConnection`, and Chrome's Cast route provider relays JSON
  messages on it — `LOAD`, `PLAY`, `PAUSE`, `STOP` in the
  `urn:x-cast:com.google.cast.media` namespace, wrapped as `v2_message`. The
  wrapping is documented only in Chromium's source, which is the maintenance
  risk.
- **`playback.stop()` before `LOAD`**: one connection.
- **A CORS check before offering HLS.** With the host permission the extension
  sees the response headers, so a request for the `.m3u8`, cut off after the
  headers as `probe.js` does, tells whether `Access-Control-Allow-Origin` is
  there.
- **The URL carries the credentials** to the device over the local network —
  the same exposure as the `.m3u` hand-off, and no more: the Default Media
  Receiver is a page the device loads from Google, but the media URL goes only
  to the device.

## Testing with a device

The probe above, with a Chromecast on the same network as the development
profile, comes first. Then:

| Case | Expected |
| --- | --- |
| `.mp4` movie, `Cast` | the picker; picture and sound on the device; *Chromecast* on the engine line; the button lit |
| Stop from the picker | the button unlit, playback continues locally |
| Switch to an MKV while casting | the session ends, `disconnect` fires |
| Live channel, `Cast` | the overlay; Cast tab + `f` → remoting, no re-encoding |
| MKV episode with subtitles, Cast tab, `f` | subtitles on the device while mirrored; confirm whether they survive the switch |
| Leave full screen while remoted | mirroring resumes |
| Firefox | no button |
