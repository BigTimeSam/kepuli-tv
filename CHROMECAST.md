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
then `f`. The player's `f` puts the picture's wrapper full screen — the video
fills it, which is what Chrome's dominant-content check wants, and the subtitle
layer comes along, see `js/subdisplay.js`.

The audio of an MKV has already been decoded from AC-3 or DTS and encoded to
AAC — or to Opus, where the browser has no AAC encoder; remoting takes both —
before it reaches MediaSource, so it suits remoting as it is.

**Subtitles** are the known casualty. The player draws them itself in a layer
over the picture (`js/subdisplay.js`); media remoting carries only the
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
                   (the routes are in docs/internals.md since 2026-11-03)
store/chrome-dashboard.txt  the feature and the key
manifest.json      nothing
```

## Left out in the browsers: the Default Media Receiver

The third route — the device fetches the stream itself, and the browser may
close — was designed and not built for the browsers; the app for the iPhone
and the iPad is built on it (the section after this one). Its reach is the `.mp4` movies and, on a
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

## The iPhone and iPad app: Google's sender, natively

On iOS `video.remote` is AirPlay and nothing mirrors a tab, so the app
(`ios/`) takes the third route with the Google Cast iOS Sender SDK (4.8.6,
the dynamic framework, fetched by `ios/vendor.mjs` and never committed) and
the Default Media Receiver (`CC1AD845`, no registration). An app may link
the SDK; the Manifest V3 objection of the first section is about the
browsers' packages, which still carry none of it.

### The page's part

The page draws two buttons and an overlay; every dialog is Google's.

| Piece | What |
| --- | --- |
| `js/host.js` | the port to the app; `ios` is true under `player.html?ios=1` |
| `js/cast.js` | `createCast()` gives `NativeCast` in the app and `Cast` elsewhere, the same shape to `js/app.js`; `castMedia(spec)` and `hlsCastable(status, headers)` are the two pure rules |
| `js/castui.js` | the session: `castNative` (the menu item, the Cast mark on the top bar, `c`), `castOrPlay` (every start of playback goes through it), `renderCasting` (acts on each change of state), `castingLeft` |

Messages, page to app: `cast.prompt` (Google's dialog: the devices, or the
session when connected), `cast.load` (`url`, `contentType`, `live`, `hls?`,
`startAt`, `title`, `subtitle`, `image?`; answered `{ok}` or `{ok: false,
error}`, waited for 20 s), `cast.stop` (the media, the session stays),
`cast.end` (the session), `cast.controls` (Google's expanded controls).
App to page: `cast.state` (`disconnected`, `connecting` or `connected`, the
device's name, how many devices were found, and with `disconnected` the
position the device had reached, or `stale` in its place when the session
ended while the app could not hear the device) and `cast.media` (`idle`
with its reason, `loading`, `buffering`, `playing`, `paused`, the position
and duration; the reason `gone` when the app came back from a suspension
and the device has nothing on any more).

### The rules, and why

- **What can be handed over** (`castMedia`): a live channel's HLS address
  and any `.m3u8` as `application/x-mpegURL`; a file in MP4, M4V or MOV as
  `video/mp4` and WebM as `video/webm`. Never a Stalker link (a one-use
  token), a blob, MPEG-TS, Matroska, AVI or a catch-up address: the table
  of the second fact above.
- **HLS is asked about first.** The device's player fetches segments with
  XHR and needs `Access-Control-Allow-Origin`; most panels send none. The
  page fetches the playlist, cut off after its headers, and
  `hlsCastable` says no only to a 2xx answer without the header (an error
  or no answer within 4 s is not a verdict, and the cast is tried). The
  answer is kept per origin while the page lives. Without the question,
  every change of channel on such a provider would stop the picture, wait
  for the device to fail, and warn.
- **Stop here, then load there.** An account commonly has one connection,
  so `playback.stop()` comes before `cast.load`. The page ignores
  `cast.media` until `cast.load` is answered. What plays here during a
  session always takes the connection back: the device is told to stop,
  also when the stream is one it failed on earlier, and a stream left
  while the device was still fetching it is stopped again once the device
  has it (the app can stop nothing before that).
- **The session's end ends only what was the session's.** What the device
  played plays on here; a stream the viewer has started here since, or one
  just chosen and still waiting for its playlist's server, is left alone.
- **Seen on the device is seen.** The device's position is the film's
  saved place, and a film or an episode past 96 % of its length, or
  reported finished, gets the tick on its cover (`js/nextepisode.js`),
  with resume points off as well.
- **Everything that goes wrong plays on here.** Nothing castable: a toast
  (`cast.cannot`) and the picture never leaves. A refused load, or `idle`
  with reason `error`: `cast.failed`, the address remembered so it is not
  tried twice, and playback here from the same position. An HLS origin is
  marked as not castable only when the device has played no channel of it
  in this session (a server whose playlist has the header and whose
  segments do not fails on every channel; one dead or 4K channel among
  those the device plays is its own failure), and the session's end
  forgets both. A session that ends: playback here from where the device
  had got to (a live channel from now).
- **What ended unheard starts nothing.** The SDK suspends the session
  while the phone sleeps, and a film may end, or the television be turned
  off, meanwhile. The app then says `stale` with `disconnected`, or `gone`
  when the session resumed and the device, asked, has no media: the page
  empties the player and plays nothing here (the place it knows is from
  before the sleep), and takes a film as seen when it was running when
  last heard and has had the time to reach 96 % of its length. Not seen
  with a device.
- **What the device says of a stream the viewer has left is not acted on
  here.** A channel just chosen waits for its playlist's server with the
  earlier stream still the device's: its end or failure neither stops the
  new channel nor starts the old stream here.
- **Acting on changes only.** The app repeats a state whenever it has
  reason to (a page reloaded, the phone unlocked), so a second `connected`
  starts nothing. A page that loads during a session and finds the device
  playing shows the overlay and has nothing to play on with; the empty
  player's page, drawn several times while the player starts, does not
  write over it (`sessionShown`), and a window of one pane shows the
  player's pane for it, with the switch to the list (`sessionFound`,
  `js/playerlayout.js`).
- **The address carries the account's credentials** to the device over the
  local network and through the app's native code: neither the address nor
  the title is logged, in any build.
- **`http:` artwork is not sent**: Google's controls fetch it in the app,
  where App Transport Security refuses it.

### The first cast

Google's SDK is started at the first `cast.prompt` and not at launch:
merely creating its context fetches a configuration from Google and
writes an identifier and a database into the app's container, so a viewer
who never casts makes no contact with Google. At that first press the SDK
shows a note of its own instead of the devices; after its OK and the
system's local-network question the app opens the device list itself as
soon as a device is found, and the viewer presses Cast again only when
none is found within half a minute. From then on the SDK starts with the
app and searches by itself, and the Cast mark stands on the top bar once
a device is found, in every layout. The press is passed on a second after the SDK's start,
as Google's own assertion ended the app when it came at once, and a
press that still meets the assertion is caught and made again
(`ios/AGENTS.md`).

### Tested without a device

`node dev/unitcheck.mjs` covers `castMedia`, `hlsCastable` and the port.
`node dev/playcheck.mjs iosapp` runs the whole course in desktop Chrome
against a fake port: the hand-over of a film with its position, the
overlay's two buttons, a repeated `connected`, a device error, an MKV,
catch-up during a session, a live channel with and without the mock's CORS
headers (`KEPULI_MOCK_NO_CORS=1`), and a session's end. That WebKit shows
the page the header was measured in the simulators, on iOS 26.5
(`node ios/simcheck.mjs live`), so the question stays in the page.
`node ios/simcheck.mjs cast` goes as far as a script can in the real app:
the SDK asleep until the first `cast.prompt`, `cast.load` answered
`no-session`, Google's note on the screen, and nothing of a stream's
address or title in the log.

Only a real Chromecast proves Google's SDK: the cases of the next section apply,
and the app adds the local-network question, the phone's
volume buttons, and a phone locked for two minutes, after which the
television must still be playing and the phone must not have started the
stream.

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
