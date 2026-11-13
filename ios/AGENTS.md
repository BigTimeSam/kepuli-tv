# ios/: Kepuli-TV for the iPhone and the iPad

One universal app that shows the extension's own `player.html` in a
`WKWebView` on a `WKWebExtensionController`, so the page is a real extension
page (storage, host access, the Stalker header rule are WebKit's), with
native code for what a page cannot do there: the Chromecast sender, the
screen kept on, reminders as notifications, links and saved files. There is
no second copy of the player; the page knows it is in the app by
`player.html?ios=1` (`js/host.js`).

Nothing generated is committed: `dist/` (the extension copy, the icon, the
localised strings, `Info.plist`, DerivedData, the simulators' UDIDs),
`vendor/` (the Cast SDK) and `KepuliTV.xcodeproj` are made by the tools
below, and the packages go to `dist/ios/` in the project root. Xcode 26 and
xcodegen (`brew install xcodegen`) are needed; they and the Cast SDK are
dependencies confined to this directory, as Gradle and GeckoView are to
`android/`. Builds from Xcode 26.6 are accepted by the App Store until
April 2027; after that an upload needs Xcode 27.

| File | What |
| --- | --- |
| `project.yml` | the xcodegen spec: both targets, every build setting and every Info.plist key. `App/` and `Tests/` are globbed, so a new source file needs no change here |
| `build.mjs` | prepares `dist/` and the project, builds for the simulator, runs the tests (see its header for the steps and the decision on the background page) |
| `vendor.mjs` | fetches Google Cast 4.8.6 (dynamic) into `vendor/`, pinned by SHA-256, and checks what the app relies on in it; with the framework and the licences it keeps the archive's privacy details (`ios/vendor/NutritionLabel/NutritionLabel.txt`), Google's own word on what that version collects. `vendor/pinned.sha256` says which archive is unpacked there: after another version is pinned the old one is fetched over, not reported as checked |
| `icon.swift` | draws the opaque 1024 px app icon from `brand/tv-master-1024.png` |
| `sim.mjs` | the simulator driver: devices, install, launch, run code in the page, the native state, rotate, screenshots |
| `rotate.m` | turns a simulated device as Simulator's own menu does; compiled by `sim.mjs` on first use |
| `flatten.swift` | writes a screenshot again without its alpha channel, pixel for pixel; compiled by `sim.mjs` on first use and run on every `shot` |
| `simcheck.mjs` | the scenarios: the app in the simulators against the mock provider (see [Scenarios](#scenarios)) |
| `screenshots.mjs` | the App Store's two sets of five pictures, from the mock's demo account in `kepuli-ios-shots-iphone` and `kepuli-ios-shots-ipad`, into `brand/ios-screenshots/` (see [Packages and the App Store](#packages-and-the-app-store)) |
| `release.mjs` | the simulator package, whose Release app it starts once in `kepuli-ios-iphone`; the unsigned archive with its privacy report; and `status`: what is missing before the App Store |
| `App/AppDelegate.swift`, `App/SceneDelegate.swift` | launch, the audio session, the orientation mask, the one window |
| `App/ExtensionHost.swift`, `App/ExtensionTab.swift` | the extension, its context and controller, the grants, the one tab and window |
| `App/PlayerViewController.swift` | the web view inside the safe area, and over the whole screen in the app's full screen (`setFull`); the ground colour of the strips around it, dimmed while a dialog of the page is open (`setShade`); recovery after the web process dies, slower each time it dies again soon after (`recover`) |
| `App/Navigation.swift` | what may load in the web view; links and downloads leave it; the end of the web content process, told to the bridge and the player |
| `App/Bridge.swift`, `App/Services.swift` | the page's port to the app (`PagePort`, which a test can stand in for), message routing, `NativeService`, the list of services; `pageGone`: the page whose process ended, and what was said to it with `keep` in its last seconds kept for the next |
| `App/Services/KeepAwake.swift` | `awake`: the idle timer off while a picture plays |
| `App/Services/Screen.swift` | `screen.full`: the app's own full screen asked for and left; `screen.shade`: the backdrop of the page's open dialog, for the strips, and whether one is open, for `Reminders`; `screen.theme`: the page's theme setting, for the keyboard and the dialogs the system draws; a page that has just connected finds the bars back and the strips undimmed |
| `App/Services/LinkOpener.swift` | a web page in a Safari view over the player, another app or the App Store through the system; `UIViewController.frontmost` |
| `App/Services/DownloadSaver.swift` | a file the page saves, written to `tmp/saves/` and handed to the Files picker |
| `App/Services/Reminders.swift` | `notify.*`, `reminders.set` and `reminders.clear`: local notifications, their plan, those of a removed account or a reset player taken away, a tap sent back as `reminder.open` with the reminder's id and the tap's time, which of them the system shows while the app is in front, and the system's leave read again each time the app comes to the front (`notify`, said when it changed) |
| `App/Cast/CastService.swift` | the `cast.*` messages, Google's SDK and its listeners |
| `App/Cast/Press.m`, `App/Bridging.h` | the one Objective-C function: a control pressed with an exception from its action caught (`KepuliPress`), which Swift cannot do |
| `App/Cast/CastMedia.swift` | pure: `cast.load` to `GCKMediaInformation`, and what each session event says to the page |
| `App/Debug/DebugBridge.swift` | Debug builds only: the file bridge `sim.mjs` drives, the console hook |
| `Tests/ShellTests.swift`, `Tests/CastTests.swift`, `Tests/ServicesTests.swift` | the XCTest target `KepuliTVTests`, hosted by the app: the page's address and bundled manifest, the app's full screen, the strips' dimmed colour, the wait before a page that keeps dying is loaded again, the window's appearance under the page's theme, the Cast mapping and session rule (what a suspension leaves unheard, `stale` and `gone`), a press that raises caught, the reminder plan, when a reminder in front is the system's to show, a page whose process ended counted as gone and its tap kept, a reminder set while refused scheduled once the leave is given, the status naming no account and keeping no stream's address, and the sorting of links |

The App Store's texts and answers are `store/appstore.txt`; the page's side
is described in `js/AGENTS.md` (`js/host.js`, `js/castui.js`, and full screen in
`js/playercontrols.js`) and tested in
desktop Chrome by `node dev/playcheck.mjs iosapp`.

## Permanent identifiers

They name the page's origin and the folder WebKit keeps its storage in.
Changing any of them loses every viewer's accounts, favourites and settings.

| What | Value |
| --- | --- |
| Context `uniqueIdentifier` | `kepuli-tv` |
| Context `baseURL` | `webkit-extension://kepuli-tv/` |
| Controller configuration identifier | `EA9BF6AD-7F8E-413E-A452-A75272922ABC` |
| Bundle identifier | `io.github.bigtimesam.kepulitv` (Debug builds: `io.github.bigtimesam.kepulitv.debug`, a container of their own) |
| Native application name (`runtime.connectNative`) | `io.github.bigtimesam.kepulitv` |
| Cast receiver | `CC1AD845`, Google's Default Media Receiver |

The app's version is the extension's (`manifest.json`); the build number is
`<major*10000 + minor*100 + patch>.<n>` (1.13.0 gives `11300.1`), and a
second upload of the same version takes `--build 2`.

## Commands

| Task | Command |
| --- | --- |
| Prepare `dist/` and generate the project | `node ios/build.mjs` |
| Build Debug for the simulator | `node ios/build.mjs --simulator` (Release: add `--configuration Release`) |
| Run the XCTest target on `kepuli-ios-iphone` | `node ios/build.mjs --test` (it ends the app there: launch again afterwards) |
| Create this tool's simulators, list them | `node ios/sim.mjs devices` |
| Boot, install (builds when stale), launch | `node ios/sim.mjs boot`, `node ios/sim.mjs install`, `node ios/sim.mjs launch [NAME=value …]` |
| The native state as JSON | `node ios/sim.mjs status` (among it `fullscreen`, the app's own; `webkitFullscreen`, WebKit's for an element, which must stay `no`; `statusBarHidden`; `view`, `webView` and `safeArea` in points) |
| Run code in the page | `node ios/sim.mjs eval '<body of an async function>'`, `node ios/sim.mjs evalfile <path>` |
| Turn the device | `node ios/sim.mjs native 'rotate landscape'`, `node ios/sim.mjs native 'rotate portrait'` |
| What the page sees of Split View | `node ios/sim.mjs native 'width 320'`, `node ios/sim.mjs native 'width full'` |
| End the web content process | `node ios/sim.mjs native killweb` |
| Tap a reminder's notification (fake notifier) | `node ios/sim.mjs native 'tap-reminder <channel id>:<start>'` |
| The page's console and the app's notes | `node ios/sim.mjs log [n]` |
| A screenshot (upright also in landscape, without an alpha channel) | `node ios/sim.mjs shot <file.png>` |
| Uninstall the app with its data, shut down | `node ios/sim.mjs wipe`, `node ios/sim.mjs shutdown [all]` |
| Every scenario on the iPhone and the iPad, then iOS 18.5 | `node ios/simcheck.mjs` (about eleven minutes) |
| Some scenarios, one device | `KEPULI_IOS_DEVICE=kepuli-ios-ipad node ios/simcheck.mjs live rotate`, `node ios/simcheck.mjs min` |
| The App Store's screenshots (about four minutes) | `KEPULI_SHOTS_DIR=<scratch> node ios/screenshots.mjs`, then without it into `brand/ios-screenshots/` |
| The Release app for simulators, zipped, and started once | `node ios/release.mjs simulator` (`--no-launch` leaves the start out) |
| The unsigned device archive and the privacy report | `node ios/release.mjs archive` |
| What is missing before the App Store | `node ios/release.mjs status` |

`KEPULI_IOS_DEVICE` picks the device: `kepuli-ios-iphone` (the default,
iPhone 17 on iOS 26.5), `kepuli-ios-ipad` (iPad (A16)), `kepuli-ios-min`
(iPhone 16 on iOS 18.5, the app's minimum and the oldest runtime that can be
run here), `kepuli-ios-shots-iphone` and `kepuli-ios-shots-ipad` (the
App Store's screenshot sizes). Their UDIDs are in `ios/dist/devices.json`;
if that file is lost, `devices` makes five new simulators and the old ones
stay until removed by UDID by hand.

Launch variables the Debug build reads (`node ios/sim.mjs launch NAME=value`):

| Variable | Does |
| --- | --- |
| `KEPULI_PAGE` | the page to load instead of `player.html?ios=1` |
| `KEPULI_LINKS=record` | no link opens; `status.links` holds each address handed to `LinkOpener`, whole. It is for the mock provider: without it `status.links` holds each link's scheme and host alone |
| `KEPULI_SAVES=record` | no picker shows; `status.saves` holds `{name, size}` of each file written |
| `KEPULI_NOTIFY=fake` | nothing is asked of the system: the leave is unasked and given when asked. `fake-granted` and `fake-denied` start that way. `status.reminders` holds `system`, `enabled`, `pending` and the `plan` (`identifier`, `at`, `text`); an identifier there is `reminder|#<n>|<id>`, the account a number and never its key |

## Rules

- **Only this tool's simulators, always by UDID.** Never a device by name,
  never `booted`, never a process killed by name: other sessions run
  simulators on the same machine. Shut the devices down when done
  (`node ios/sim.mjs shutdown all`).
- **Ports.** The mock provider for the simulator is
  `KEPULI_MOCK_PORT=8841 node dev/mock/server.mjs`, reached from the app as
  `127.0.0.1`; a second one on 8842. Check with
  `lsof -nP -iTCP:8841 -sTCP:LISTEN` first and stop it when done.
  `simcheck.mjs` starts its own on 8841 and refuses when the port is taken
  (`KEPULI_IOS_MOCK_PORT` gives it another). Never 9222, 2828, 8790, 8791,
  9444 or 9446. The driver itself opens no port.
- **Scratch files** (screenshots, logs) go outside the repository:
  `sim.mjs shot` and `simcheck.mjs` write to `KEPULI_SHOTS_DIR` or the
  temporary directory. A picture of Google's device list shows the names of
  the real Cast devices on this network (a simulator searches the Mac's
  network): it never goes into the repository or a store listing.
- **Nothing logs a message body, an address or a title**, in any build: a
  stream's address carries the account's credentials. `debugLog` takes
  message types only, and Google's logger is switched off. The debug
  status (`sim.mjs status`) is pasted into reports, so it names no account
  either: an account's key is its address, a playlist's with the user name
  and the password in it (`Reminders.shown`), and the address VLC is
  handed carries the stream's, so a link is kept there as its scheme and
  host (`LinkOpener.noted`) unless the launch records links for a scenario
  (`KEPULI_LINKS=record`, against the mock). A saved file is kept as its
  name and size.
- **The debug bridge is Debug only.** `release.mjs` refuses a Release app
  that has `_killWebContentProcess` or `DebugBridge` in any binary of its
  bundle but Google's framework, or a library beside its binary at all.
  The Debug app keeps its code, and both marks, in `KepuliTV.debug.dylib`
  beside a stub named for the app: that is the control, and why the
  binary named for the app is not the only one read. Shorter marks prove
  nothing: an optimised Swift build keeps a literal of fifteen bytes or
  fewer inside an instruction, where `strings` does not see it.
- **A new service** conforms to `NativeService` (`App/Bridge.swift`), is
  created in `App/Services.swift` and nowhere else, and sends its state
  from `pageConnected()`, never before: see the greeting below. A service
  with two message families gives `prefixes`, as `Reminders` does. What
  must reach a page that is not there yet goes with `keep: true`.
- **Dialogs are presented from `Bridge.shared.presenter?.frontmost`**: the
  last controller in the key window's chain, as one that already presents
  (Google's dialog, an earlier page) refuses another. The app's full screen
  has no window of its own; the rule also covers whatever WebKit may put
  over the app, the system's video player among them (not measured).
- **Full screen is the app's own.** The page asks with `screen.full` and
  follows the `screen` event; `isElementFullscreenEnabled` stays false,
  as WebKit's full screen for an element shows a banner that names the
  page's internal address and keeps the picture inside the safe area.
- **The app follows the way the device is held**, in and out of full
  screen, on both devices. No code asks for an orientation.
- **Nothing is signed, uploaded or submitted without the owner's go** in
  the conversation (root `AGENTS.md`, rule 2). The team, the API key and
  the demo's address live in `~/.config/kepuli-tv/ios/` and are never
  written into the repository, a log or a commit message.

## Scenarios

`node ios/simcheck.mjs [scenario …]` starts its own mock, boots each device,
installs the Debug app and runs every scenario on `kepuli-ios-iphone` and
`kepuli-ios-ipad`, then `min` on `kepuli-ios-min`; a picture of each is kept
in `KEPULI_SHOTS_DIR`, upright and lying down where it says so. Each
scenario launches the app anew (links and saved files recorded, the fake
notifier), so each can be run alone; one that turns the device turns it
back; a simulator the tool booted is shut down at the end. Exit 1 on any
failure, on anything not run (no `kepuli-ios-min`), and when nothing ran
at all (`split` asked of the iPhone alone). `sh dev/mock/media.sh` must
have run once in the checkout, or the tool refuses: without its media the
mock answers every stream with 404.

| Scenario | Holds when |
| --- | --- |
| `boot` | a fresh install loads with no extension or context error at the pinned address, `location.search` is `?ios=1`, `html.ios`, the port is connected and `host` arrived with the device's idiom, `permissions.contains` is true for `http://example.org/*`, and neither the bundle's manifest nor the page's has a background |
| `firstrun` | the setup dialog shows without the note on a permission question and fits the window upright and lying down (Save reachable); the port, which comes filled in, is selected when the focus reaches it; the strips around the web view are the page's ground under the dialog's backdrop, and the plain ground once it has closed, and the app knows the dialog open and closed; lying down the fields' labels are of one size and the note on HTTPS no larger than a field's text; the mock's address and `demo`/`demo` typed into its fields connect, and groups and channels load |
| `channels` | a country opens with its rows; a row's name and a button cannot be selected by a long press, a field's text can; lying down at least three rows are in sight and nothing is wider than the window |
| `live` | a channel advances three seconds with sound and no tap; the idle timer is off while it plays and on after a pause; a fetch of its playlist shows the page `Access-Control-Allow-Origin` |
| `film` | an MP4 film plays; the list's foot shows its count whole beside its marks, upright and lying down; after a launch its place is kept and offered (the start page's Continue watching, or the film's row where the window has one pane) and it goes on from there |
| `mkv` | Silent Fjord's first episode plays through the unpacking with its two subtitle tracks; the subtitles' look opens with no picker in the focus and nothing of the system's over the player, and the text keeps clear of its panel, at its own height where the panel does not lie over the picture (a phone, upright and lying down); the second episode, whose sound is AC-3, plays with a sound track encoded anew; the third goes on through a change to its AC-3 commentary, the sound's selector no narrower than the subtitles' |
| `guide` | the guide has programmes; an upcoming one offers Remind me; nothing of recording is in sight anywhere; lying down it still fits, the day in view whole in its strip and clear of the strip's arrows; over a playing channel, upright and lying down, the corner picture is no wider than its column, the programme's time and title are in sight in its panel, and the strip's arrow back does not show for a scroll shorter than itself |
| `settings` | the help says what a finger does, keeps every key behind the one fold (closed where nothing hovers), names the manifest's version and links to the app's guide, the privacy policy and the licences; sync, the recording row and the full-screen button are gone; the notifications switch follows the notifier (given, turned off and on, refused with its message under the switch, in sight in the dialog); the window takes the page's dark and light theme and none for Automatic, and the page's `prefers-color-scheme` follows; Settings fits upright and lying down; lying down the subtitles' preview is at least 120 px high, and turned upright while open the sections are measured again |
| `persist` | after terminate and launch the account connects and a `storage.local` value and a file in the origin's private file system are still there |
| `fullscreen` | the app's own full screen is entered by the button over the picture and left by a swipe down, entered again and left by the button, upright and lying down, and the device is turned inside it both ways: the app is held as the device is each time, nothing is forced, the page has the whole screen with the status bar hidden, the picture's box keeps clear of the strips that are not safe (the home indicator's given up when the picture needs the height), WebKit's own full screen is never used, the channel plays throughout, and a page loaded again in full screen finds the bars back |
| `split` (iPad) | at `width 320` and `width 507` one pane shows; at the full width the list and the picture stand side by side; the channel plays on |
| `rotate` | a channel plays through upright, lying down and upright again without a new start, the same channel marked, the page no wider than the window, the picture whole with its bar under it, and with two columns the playing row in sight |
| `cast` | the menu has Cast and the top bar has no mark yet; `cast.state` arrived disconnected with `devices: -1`; the SDK is asleep; `cast.load` is answered `no-session`; after `cast.prompt` the SDK has started and Google's note is on the screen with no search begun; the debug log names `cast.load` and nothing of its address, title or subtitle |
| `links` | the help's link to the app's guide, the privacy link and VLC's `vlc-x-callback:` address reach `LinkOpener` in that order and the page stays; then, VLC being absent (it always is in a simulator), the page's own timer asks for VLC's App Store page |
| `save` | a Blob behind `<a download>` reaches `DownloadSaver` with its name and a size above zero, and the page stays |
| `reminder` | a reminder set in the guide is in the app's plan a minute before its start with its sentence, the status naming no account; items an hour past and due now are dropped; `tap-reminder` plays the channel, and plays it again when the web process is ended and the tap made at once (the page loaded next hears it); removed, the plan is empty; set again, nothing is planned or pending once the page has said `reminders.clear` with the account (that an account removed in Settings says it is `node dev/playcheck.mjs iosapp`'s to hold) and once **Reset everything** in Settings has run |
| `stalker` | the mock's portal connects with no request turned away for want of the cookie or the set-top box's User-Agent, and a channel plays from a one-time link |
| `kill` | the web process is ended while a channel plays in full screen: the player is back by itself on the route it had, with its list, its port and the app's greeting; the list stands on that channel and nothing plays unasked, as after a reload in a browser; the idle timer is on again and the bars are back; chosen, the channel plays |
| `min` | `boot`, `live`, `persist`, `fullscreen` and `cast` on iOS 18.5 |

What the scenarios cannot do, and why:

- **No scenario touches the screen.** A press is a scripted click and a
  swipe is pointer events sent to the page. Real touches (a tap on the
  picture and then the corner button, a double tap, a swipe down) were
  tried once by hand on `kepuli-ios-iphone` with an XCUITest tapper kept
  outside the repository, and so were a long press on a row and on a
  button (nothing selected, no bubble of the system's), a tap outside a
  row's open menu (the menu closes and nothing plays) and, on
  `kepuli-ios-ipad` upright, a tap into a field of the first-run dialog
  (the dialog stands over the keyboard, Connect in sight); nothing repeats
  them, and iOS 18.5 was not tried that way.
- **`save` saves a file of its own making.** The page has nothing that
  saves a file in the app: there is no settings export, the playlist for
  VLC is replaced by VLC's own address, and recording is off.
- **`cast` stops at Google's note.** A script cannot press its OK, and a
  session needs a Chromecast: connecting, a load accepted or refused,
  `cast.media`, stopping, suspension and what the device did during one
  (`stale`, `gone`) are the device checklist's.
- **`persist` on iOS 18.5** leaves the file empty: that WebKit has no
  `createWritable` in a page.
- By hand in a simulator: choosing a `.m3u` in the file picker of the setup
  dialog; real Split View and Slide Over on the iPad (the scenario narrows
  the web view instead); the look of the app's full screen under a finger,
  and the system's player that the full-screen mark of WebKit's own video
  controls opens.

Writing one: page code is the body of an async function after `PAGE`'s
helpers; a `target="_blank"` click and `permissions.request` must be the
first statement of their piece of code (after a wait WebKit takes them for
unasked); never assert a count of Cast devices.

## What was measured, and must not be undone

- **The page's address takes a query string.** `location.search` is
  `?ios=1` on iOS 18.5 and 26.5. The address is built with
  `URL(string:relativeTo:)`; `appendingPathComponent` would escape the `?`.
- **No background page.** The iOS manifest has no `background` key and the
  extension loads without an error on both systems (`build.mjs` has the
  fallback, should a later WebKit want one). A `service_worker` background
  never starts in WebKit and says nothing, so the build refuses one.
- **The page is greeted at its first message.** WebKit drops what the app
  sends on a native port until the page's `onMessage` listener is registered
  with it: sent at once it never arrived, sent 10 ms later it did. So
  `Bridge` says `host` and calls every service's `pageConnected()` when the
  page first speaks, or after half a second if it says nothing. The page
  says `hello` as soon as its port is attached (`js/host.js`), for no
  other reason; nothing answers it.
- **Grants are given at every launch**, before the context is loaded:
  WebKit does not remember them.
- **WebKit closes no port when the web content process ends.** The
  port's `disconnectHandler` was never called after `killweb` (iOS 26.5),
  and WebKit's own source disconnects a page's ports only when the page is
  removed, which a dead process cannot report. So `Navigation` tells the
  bridge (`Bridge.pageGone`): until the page loaded again has connected,
  nothing counts as heard, a reminder that falls due is the system's to
  show, and a tap said with `keep` in the ten seconds before is said again
  to the next page (`reminder`). The page goes by the tap's own time, so
  one said again after a slow reload starts nothing.
- **WebKit's WebCodecs AAC encoder reports a whole ES_Descriptor** as its
  decoder configuration (39 bytes on iOS 26.5, the two of the
  AudioSpecificConfig near their end), where Chrome's reports the
  AudioSpecificConfig alone. Written into the file's esds as it came,
  MediaSource refused the first segment and a film with AC-3 sound did not
  play at all; `js/mp4file.js` (`audioSpecificConfig`) unwraps it, and
  WebKit's own decoder takes the unwrapped two bytes (the encoder's
  measurement in `js/transcode.js`, which now fails a candidate whose
  output does not decode). With it the AC-3 episode plays on iOS 26.5 with
  a sound track in the picture's element (`mkv`); that it is heard is the
  device checklist's.
- **A click comes some time after a finger's `pointerup`** in WebKit on an
  iPhone, not with it as under a mouse: `js/rowmenu.js` keeps its watch
  for the click of a press outside a menu for 0.7 s after the lift.
- **An upright iPad keeps the window's height with the keyboard up**
  (`innerHeight` 1128, the visual viewport 811), where an iPhone's and a
  lying iPad's window shrinks. The page says what is in sight
  (`html.kb`, `--vvh`, `--vvt`; `js/host.js`) and a dialog stands at the
  top of it and scrolls as one (`css/dialogs.css`): the first-run dialog
  then reaches from 8 to 721 px with Connect at 652, and WebKit scrolled
  nothing (seen with a real tap; the visual viewport's offset stayed 0).
- **The window's interface style is the page's theme setting**
  (`screen.theme`, `PlayerViewController.setTheme`): dark or light when
  the viewer chose one, none for Automatic, as an override also decides
  what `prefers-color-scheme` answers in the web view (`settings` reads
  both). The keyboard under a dark page was not photographed after the
  change, nor Google's dialogs: the device checklist has the line.
- **The page is shown a provider's `Access-Control-Allow-Origin`**, on
  iOS 18.5 and 26.5, which is what `js/castui.js` asks before it hands a
  channel to a Chromecast (`live` reads it).
- **The Stalker header rule holds in WebKit**: the mock's portal turned no
  request away, and a channel played from its one-time link (`stalker`).
- **An iPhone plays a channel's HLS natively and an iPad through hls.js**
  over MediaSource; an MP4 film is native on both and an MKV goes through
  the unpacking on both.
- **The web view sits in a plain view that carries the constraints**, two
  sets of them: the safe area's edges, and the view's own for full screen.
  It began as a need of WebKit's full screen for an element, which moved
  the web view into a window of its own and put it back by its frame and
  autoresizing mask (constrained directly it was 62 by 0 points there);
  that full screen is off now and the plain view stays, as what
  `setFull` and the debug bridge's `width` move. The web view stays
  opaque, or the ground colour read from it is clear.
- **WebKit's full screen for an element is not used**
  (`isElementFullscreenEnabled = false`). On entering it showed, for a few
  seconds every time, a banner that names the page's address
  (`webkit-extension://kepuli-tv/player.html?ios=1#/…`), which no public
  API takes away, and it kept the picture inside the safe area (750 × 374
  on an iPhone 17 lying down).
- **Full screen is the app's own.** The page sends `screen.full {on}`
  (`js/playercontrols.js`: the button in the picture's corner, a double
  tap, `f`; left by the same, a swipe down over the picture or Escape).
  `PlayerViewController.setFull` gives the web view the whole screen,
  hides the status bar and the home indicator, and says `screen {full,
  top, right, bottom, left}`: what of the screen is not safe on each side,
  said again whenever the insets change. The page lays the picture's
  wrapper over its window (`.videowrap.full` in `css/playback.css`) inside
  those strips, black to the screen's edges, and tells the rest of itself
  with a `fullscreenchange` event. Measured: an iPhone 17 upright gives
  the page 402 × 874 and the picture 402 × 226; lying down 874 × 402 and a
  picture of 715 × 402 that touches the top and the bottom, as the home
  indicator's strip is given up when the picture needs the height; the
  sides beside the island (62 px each) are never given, so that the
  picture's controls stay in reach, and a picture wider than 16:9 is 750
  px wide there. The iPad: 820 × 461 upright and 1180 × 664 lying down.
  iOS 18.5: 699 × 393 lying down. It turns with the device, and
  `Screen.pageConnected` leaves it, so a page that was loaded again or
  came back after its process died finds the bars back.
- **A box that can scroll shows its scroll mark over the app's full
  screen**, in the black beside the picture, for as long as the film runs
  (the details under the picture). `scrollbar-width: none` and
  `visibility: hidden` do not take it away; `overflow: hidden` does, so
  nothing under the picture scrolls while it is full screen
  (`css/playback.css`), and each box keeps its place.
- **WebKit's own video controls keep their full-screen mark** and the
  pinch that does the same: no public way removes them
  (`::-webkit-media-controls-fullscreen-button` has no effect,
  `controlsList` is absent). They open the system's player, which shows
  no banner and draws neither the page's subtitle layer nor its overlay;
  left by script, the channel was paused 0.4 s later. The app's button
  (`#btn-full`) lies over the mark while the controls show, which is 4 s
  after a touch (WebKit's measured time, the `linger` the page gives
  `SubtitleDisplay`). A double tap on the centre of the picture while the
  controls show also reaches WebKit's pause button.
- **A page loaded again, or back after its process died, plays nothing by
  itself.** The player returns on its route with the list standing on the
  channel, as a reload leaves it in a browser (`js/route.js`: an address
  that starts a stream by itself would play what the viewer did not ask
  for). The idle timer is on again and full screen is left (`kill`).
- **An iPad's live channel has a time line in WebKit's controls** where an
  iPhone's says it is live: the iPad plays it through hls.js, as desktop
  browsers do. A seek back goes on from the earliest second kept with the
  page's message, one past the end returns to the present; the channel
  neither starts anew nor pauses (measured).
- **A simulated iPad refuses a programmatic turn**, which is why `rotate`
  turns the device from outside (`rotate.m`, private CoreSimulator and
  GraphicsServices details of Xcode 26.6; if a later Xcode changes them
  `sim.mjs` says the app did not turn). The turn outlasts the app: a
  scenario turns the device back to portrait.
- **WebAssembly does not instantiate in the extension page on iOS 18.5**
  (WebKit refuses it under the manifest's own policy, with `'unsafe-eval'`
  added as well); on 26.5 it does. The FFmpeg audio path therefore has no
  sound to give on iOS 18. `WebAssembly.compileStreaming` fails on both,
  as the extension scheme serves `.wasm` as `application/octet-stream`, and
  the loader's other path is taken.
- **`createWritable` is missing from the origin private file system on iOS
  18.5**; only the recorder uses it, and recording is off in the app.
- **A `target="_blank"` click with no tap behind it never reaches the
  app**: WebKit's pop-up blocker drops it before `createWebViewWith`.
- **The Cast SDK is started at the first cast, not at launch.** Creating
  `GCKCastContext`, with analytics logging off and before any search,
  fetches a configuration from Google (`clients3.google.com`) and writes an
  identifier and a database into the app's container. A viewer who never
  casts makes no contact with Google. Once Google's note has been accepted
  (`castUsed`), the SDK starts with the app and resumes its search by
  itself.
- **The Cast button is pressed a second after the SDK's start.** Pressed at
  once the app ended with Google's own assertion, `Database is not ready`;
  the database was ready within 55 ms in the simulator and there is no
  public sign of it. The second is a guess, so the press is guarded as
  well: the assertion is an Objective-C exception raised before anything
  shows, `KepuliPress` (`App/Cast/Press.m`) catches it, and the press is
  made again half a second later, up to six times.
- **A hidden `GCKUICastButton` presents Google's dialogs**, on both systems
  and both devices. At the first cast that is Google's note, and after its
  OK the SDK shows nothing more. The app presses the button once more
  when the first devices are found within half a minute of the OK
  (`didUpdateDeviceList`): measured in the simulator with a real tap on
  OK, Google's list came up by itself. Devices are found only once the
  local-network question has been answered yes, which a simulator never
  asks: on a device the order is the checklist's to see. With no device
  found in that time the list comes at the next press of Cast.
- **`cast.stop` during a hand-over is kept for the load's answer.** With
  nothing loaded yet the device has nothing to stop; the stop is made when
  the load completes (`stopWhenLoaded`), and the page says it again then
  (`js/castui.js`). Not seen with a device.
- **A notification added before the system's leave is given is dropped
  without an error**, so `Reminders` schedules an account's list again once
  the leave is given or the switch is turned on. A trigger at or before now
  raises an exception, which is why the plan drops such items.
- **A resume point is written every five seconds of playing**
  (`js/nextepisode.js`); an app ended sooner after a seek keeps the older
  place.
- **The iPad's second picture works**: two channels through hls.js side by
  side, upright and lying down, the sound moved between them, the app's
  full screen taking both and left by the second picture's own button; the
  app's button follows the first picture when the sides are swapped. On an iPhone the row's menu does not offer it, lying down
  either, so nothing is hidden under `.ios`.
- **The start page is in the Player pane**, which a window of one pane (an
  upright iPhone) shows while something plays, when the logo asks for
  the start page (`js/playerlayout.js`, `showHome`), and for a cast
  session the page found on the device (the app started again while the
  television plays): the Browse and Player switch is then there for the
  way back. Before any of them Continue watching is not in sight there.
  The Cast mark is on the top bar, in every layout: on the player's bar it
  was out of sight in that one pane and over the guide in a low window.
- **A picker focused from a press opens its menu** (seen with a real tap
  and with a scripted press): the page puts the focus in no field or
  picker by itself where the pointer is a finger (`js/caret.js`).
- **WebKit's controls over a small picture** are a row along its bottom,
  some 30 px high, and three marks at its middle, some 30 px high
  (measured from a picture of an iPhone 17's, 402 × 227): the subtitles
  rise 44 px for them and no more (`css/playback.css`).
- **An iPhone's keyboard capitalises and corrects a text field** unless
  the field says otherwise: `demo` typed as a user name became `Demo`.
  The connection's fields carry `autocapitalize` and `autocorrect`
  (`player.html`); seen with real keys in the simulator.
- **An iPhone lying down enlarges the text of wide blocks by itself**
  (WebKit's text autosizing; 18 to 20 px beside 12 and 13): the page sets
  `-webkit-text-size-adjust: 100%` (`css/player.css`).
- **Turning the device with the keyboard up leaves the focused field
  behind it**: WebKit brings a field into view when it takes the focus
  only. The page asks it into view when the visual viewport has settled,
  and scrolls itself for the rest (`js/host.js`); measured, the field
  stood at 48 px in a window of 130 after the turn, where it had been at
  307 of 174.
- **The strips around the web view follow the page**: its ground colour
  (`underPageBackgroundColor`), and the backdrop of an open dialog over
  it, which the page says with `screen.shade` (the computed
  `::backdrop` colour, which WebKit answers). The web view's own and its
  scroll view's backgrounds follow too: fixed dark, a slab showed between
  a light page and the keyboard.
- **A reminder that falls due in front is the system's to show unless the
  page can**: connected, nothing presented over the player, no dialog of
  the page's own open (its strip lies under the dialog's backdrop; the
  page says `open` with `screen.shade`), and the reminder of the account
  the page shows (`Reminders.shows`). Not seen with a real notification.
- **What a Chromecast did during a suspension is not heard.** The SDK
  suspends the session when the app leaves the front (the phone locked),
  and the television plays on. A film may end meanwhile, or the
  television be turned off. From `didSuspend` the device counts as
  unheard until its picture is heard running again; a session that ends
  unheard says `disconnected` with `stale` and no position, and at
  `didResume` the app asks the device for its status and says `cast.media`
  with the reason `gone` if the answer leaves no media status at all. The
  page starts nothing on either (`js/castui.js`, `lostAsleep`). Built from
  the SDK's documentation and the page's side run against a fake port:
  which callbacks arrive, and that an ended film leaves no media status,
  is the device checklist's to see.
- **A web content process that ends again within a minute of its reload
  is reloaded after a wait**, 2 s and then twice as long each time up to a
  minute (`PlayerViewController.recover`): a page whose own start ends the
  process would otherwise be started without pause. The first reload is
  at once, as `kill` holds. No page that dies at its start was there to
  try it with.

## Packages and the App Store

`node ios/release.mjs simulator` builds Release for the simulator (a
language without the local-network sentence fails it), starts that app
once in `kepuli-ios-iphone` and zips it to
`dist/ios/kepuli-tv-ios-<version>-simulator.zip`. The start is the only
run of the shipped configuration before TestFlight: every scenario and
the XCTest target run the Debug app, which is another binary with the
debug bridge in its web view. The Release app has no bridge to ask, so it
is judged from outside: its process lives, no crash report of it
appears, and its container gains WebKit's storage for the extension and
the page's own localStorage, which only a page that ran writes; a picture
goes to `KEPULI_SHOTS_DIR` (look at it), the app is removed again, and
`dist/ios/release-started.json` says which version and build started. `node ios/release.mjs archive`
makes `dist/ios/KepuliTV-<version>.xcarchive`, unsigned, which proves that
the Release device build links against the Cast SDK, and writes
`dist/ios/privacy-report.txt`: what the app's and the SDK's privacy
manifests declare, and under it Google's privacy details for the pinned
SDK, whole (`ios/vendor/NutritionLabel/NutritionLabel.txt`). `node ios/release.mjs status` prints the version and
build, which outputs exist, whether `~/.config/kepuli-tv/ios/` is complete
(names only, never values), whether the demo provider lets `demo`/`demo` in
and sends a film's first bytes, whether the pasted sections of
`store/appstore.txt` are free of other platforms and within the store's
limits (each from its `=== NAME ===` line to its `=== END ===` line) and
its privacy label's rows name every type the report lists and every one
`ios/vendor/NutritionLabel/NutritionLabel.txt` names (Coarse Location and
Performance Data are in no manifest; a file that names no type the tool
knows fails, so that a rewording is read), whether the
simulator package and the archive are of the source as it stands (a
source file saved or removed since makes them old) and the Release app
of that package was seen to start, whether the signed
package is the Release app of this version and build without the debug
bridge, exported from a signed archive made since the source last changed
(it is unpacked and read; without `dist/ios/KepuliTV-<version>-signed.xcarchive`
beside it nothing can be told and it counts as missing), whether the demo
serves the reviewer's catalogue (an AVI film among its films is the test
catalogue: deployed without `KEPULI_MOCK_REVIEW=1`), whether
`brand/ios-screenshots/` holds the two sets at the store's sizes without
an alpha channel, whether the app's guide, the privacy policy and the
licences answer on the Pages site (the guide naming no other platform,
the policy with its section on the app), and the device checklist below
with what is ticked. It exits 1 while anything is missing.

### The store's pictures

`node ios/screenshots.mjs` takes the five views `store/appstore.txt` plans
(channels, the guide, a film, an episode with a subtitle, a series) on
`kepuli-ios-shots-iphone` upright (1320 × 2868) and on
`kepuli-ios-shots-ipad` on its side (2752 × 2064), from the Debug app and
a mock of its own on 8841, and writes `iphone-0N-<view>.png` and
`ipad-0N-<view>.png` into `brand/ios-screenshots/` (`KEPULI_SHOTS_DIR`
writes elsewhere: look there first). It fails on a picture of another
size or with an alpha channel. What it does to the two devices, which are
for nothing else, and why:

- **British English and, on the iPad, Full Screen Apps**, written into the
  system's settings and kept: the status bar's clock is the system's (it
  read 9.41 in Finnish), and a window of iPadOS 26 carries a resize handle
  in its bottom corner, which a picture shows as a stray arc
  (`SBMedusaMultitaskingEnabled` off takes the windows away).
- **London's time zone, for the run**: the page writes a time as the
  viewer's region does and reads the region from the zone. A simulator
  takes the zone when it starts (`SIMCTL_CHILD_TZ` at `simctl boot`;
  given to the app at its launch the page kept the Mac's), so the tool
  shuts the device down, starts it and shuts it down again.
- **9:41** in the status bar (`simctl status_bar override`, cleared
  after), in the mock (`KEPULI_MOCK_NOW`) and in the page
  (`KEPULI_PAGE=player.html?ios=1&testnow=…`, `js/testclock.js`), so the
  guide agrees with the bar and is the same on every run.
- **A wait of seven seconds before each picture**: WebKit's own controls
  lie over a picture after its start and cannot be asked about.
- **The first answer after a cold start may come from the empty page** the
  web view holds before the player's (`browser` was undefined there): the
  tool waits for the extension's page before it writes the account.

The debug bridge draws nothing, so the Debug app's pictures are the
Release app's. Retake them when those views change; they are uploaded by
hand in App Store Connect (step 7 below).

### The owner's steps

1. Join the Apple Developer Program and note the Team ID. An individual
   membership publishes the owner's legal name as the seller.
2. In App Store Connect: accept the agreements, declare the trader status
   for the EU, register the bundle identifier
   `io.github.bigtimesam.kepulitv` and create the app record early (name
   `Kepuli-TV – IPTV Player`, primary language English (U.K.), SKU
   `kepuli-tv-ios`). Under Pricing and Availability untick the
   Apple-silicon Mac and Apple Vision Pro.
3. Create a **team** App Store Connect API key with the **Admin** role
   (the Account Holder first requests API access under Users and Access,
   Integrations). Save `AuthKey_<keyId>.p8` in `~/.config/kepuli-tv/ios/`
   and beside it `~/.config/kepuli-tv/ios/appstore.json`:
   `{ "teamId": "…", "keyId": "…", "issuerId": "…", "demoUrl": "https://…" }`.
4. Connect the iPhone and the iPad (Developer Mode on) for the device build
   and go through the device checklist.
5. Deploy the demo provider and keep it running for every review: the
   mock's own Dockerfile and `dev/mock/fly.toml` deploy it as it is. It
   needs https and a stable host name, not an address literal (Apple's
   review network is IPv6-only behind NAT64).
6. On the go: upload. The first build waits for TestFlight processing and
   asks the export-compliance and content-rights questions. Install the
   TestFlight build on both devices, finish the checklist on it, and record
   a short screen video of a cast session.
7. In App Store Connect: set the version to the manifest's first (see
   VERSION INFORMATION in `store/appstore.txt`), then the texts from
   `store/appstore.txt` and the pictures of `brand/ios-screenshots/` (the
   iPhone set under iPhone 6.9" Display, the iPad set under iPad 13"
   Display), the privacy answers, the age
   rating, the review notes with the video attached; submit, on the go.

### The procedure, never run

**None of these commands has been run**: there is no signing identity, team
or API key on this machine. They are written from Xcode 26.6's own help and
the design; expect to correct them at the first run, and move each into
`release.mjs` as a verb once it has succeeded once. `<teamId>`, `<keyId>`
and `<issuerId>` are the values of `~/.config/kepuli-tv/ios/appstore.json`,
`<key>` is the absolute path of `AuthKey_<keyId>.p8` there, `<version>` the
manifest's, and every command runs in the project root.

1. **A device build**, which also registers the device and creates the
   development certificate and profile a signed archive asks for. The
   device's identifier is its UDID, the column
   `xcrun devicectl list devices --columns '*'` shows as UDID (and
   `xcrun xctrace list devices` in brackets): not the Identifier of the
   default listing, which is CoreDevice's own and which
   `xcodebuild -destination id=` does not match. `devicectl --device`
   takes the UDID as well.

   ```sh
   node ios/build.mjs
   xcodebuild -project ios/KepuliTV.xcodeproj -scheme KepuliTV -configuration Debug \
     -derivedDataPath ios/dist/derived -destination id=<device> \
     -allowProvisioningUpdates -allowProvisioningDeviceRegistration \
     -authenticationKeyPath <key> -authenticationKeyID <keyId> -authenticationKeyIssuerID <issuerId> \
     DEVELOPMENT_TEAM=<teamId> build
   xcrun devicectl device install app --device <device> ios/dist/derived/Build/Products/Debug-iphoneos/KepuliTV.app
   ```

   A Debug build can be inspected from Safari's Develop menu; the file
   bridge of `sim.mjs` does not reach a device.

2. **The signed archive.** A second upload of a version takes `--build 2`.

   ```sh
   node ios/build.mjs --release --build 1
   xcodebuild -project ios/KepuliTV.xcodeproj -scheme KepuliTV -configuration Release \
     -derivedDataPath ios/dist/derived -destination generic/platform=iOS \
     -archivePath dist/ios/KepuliTV-<version>-signed.xcarchive \
     -allowProvisioningUpdates \
     -authenticationKeyPath <key> -authenticationKeyID <keyId> -authenticationKeyIssuerID <issuerId> \
     DEVELOPMENT_TEAM=<teamId> archive
   ```

3. **Export.** The options are a property list, `dist/ios/ExportOptions.plist`,
   with `method` `app-store-connect`, `destination` `export`, `signingStyle`
   `automatic`, `teamID` `<teamId>`, `manageAppVersionAndBuildNumber` false
   and `uploadSymbols` true. The warning that GoogleCast.framework has no
   dSYM is harmless.

   ```sh
   xcodebuild -exportArchive -archivePath dist/ios/KepuliTV-<version>-signed.xcarchive \
     -exportPath dist/ios/export -exportOptionsPlist dist/ios/ExportOptions.plist \
     -allowProvisioningUpdates \
     -authenticationKeyPath <key> -authenticationKeyID <keyId> -authenticationKeyIssuerID <issuerId>
   mv dist/ios/export/KepuliTV.ipa dist/ios/kepuli-tv-ios-<version>.ipa
   ```

4. **Validate, then upload.** The upload only on the owner's go. First
   `node ios/release.mjs status` (with the same `--build`): it opens the
   package and refuses one that is not this version's Release app, or
   that is older than the source.

   ```sh
   API_PRIVATE_KEYS_DIR=~/.config/kepuli-tv/ios xcrun altool --validate-app dist/ios/kepuli-tv-ios-<version>.ipa --api-key <keyId> --api-issuer <issuerId>
   API_PRIVATE_KEYS_DIR=~/.config/kepuli-tv/ios xcrun altool --upload-package dist/ios/kepuli-tv-ios-<version>.ipa --api-key <keyId> --api-issuer <issuerId>
   ```

5. **If automatic signing refuses** (unmeasured): export the unsigned
   archive of `release.mjs archive` with manual signing instead, an
   "Apple Distribution" certificate and a `provisioningProfiles` entry for
   the bundle identifier in the options. The app has no entitlements, which
   is what makes that plausible.

After an upload: `node ios/release.mjs status`, the TestFlight build on both
devices, and the checklist again on it.

## Device checklist

Nothing ran on hardware. Each line
is seen on an iPhone and an iPad signed with the owner's team, first from
the device build and then from the TestFlight build, and ticked here
(`- [x]`) by whoever saw it. `node ios/release.mjs status` prints the list,
and it is a gate: nothing is submitted with a line open.

- [ ] A provider on plain http at a public host name: the lists, an HLS
  channel and an MP4 film load.
- [ ] A provider at an address on the local network: the system's question
  reads the local-network sentence, and the lists load after Allow.
- [ ] A live channel for an hour and a large list (tens of thousands of
  rows): no web process death, or the player returns on its route.
- [ ] A film with AC-3 sound has sound on iOS 26 (none on iOS 18, as
  measured).
- [ ] Picture in picture works, or sound goes on in the background; if
  neither, `UIBackgroundModes: audio` is removed before submission.
- [ ] A `.m3u` in Files can be chosen in the setup dialog and loads.
- [ ] The device turned both ways, with rotation lock on and off, in and
  out of full screen: the layout follows and the picture plays on.
- [ ] Chromecast, first use: Cast pressed a second after a cold start does
  not crash; Google's note, the local-network question, then the device
  list by itself once a device is found (at the next press of Cast when
  none is found within half a minute).
- [ ] Chromecast: an MP4 film goes over from its place; a live channel of
  the owner's provider goes over, or says it cannot and stays here.
- [ ] Chromecast: Stop casting plays on here from the device's position; a
  stream the device refuses is answered within 20 s and plays here; the
  account's one connection is never taken twice.
- [ ] Chromecast: the phone's volume buttons move the television's volume;
  the artwork shows in Google's remote control.
- [ ] Chromecast: lock the phone for two minutes and unlock it: the
  television plays on and the phone does not start the stream.
- [ ] Chromecast: lock the phone until a film has ended on the television,
  and again turn the television off while the phone is locked: unlocked,
  the phone shows the empty player and starts nothing, the film that
  ended has its tick, and the one cut off keeps its place.
- [ ] Open in VLC hands VLC the stream; without VLC its App Store page
  opens.
- [ ] A reminder arrives with the app closed, with its sound; tapped on the
  lock screen it plays its channel. With the app in front and Google's
  remote control open it arrives as a banner.
- [ ] The setup dialog's fields: the keyboard starts no field with a
  capital and corrects nothing; turned with the keyboard up, the field
  being typed into stays in sight.
- [ ] With the app's theme Dark on a device in light mode: the keyboard
  and Google's Cast dialogs are dark; with Automatic they follow the
  device.
- [ ] Notifications refused at the first reminder, then allowed in the
  device's settings: back in the app the reminder already set arrives,
  and the switch in Settings is on.
- [ ] A link pressed while the picture is in full screen opens over it.
- [ ] Full screen under a finger, on both devices: the corner button, a
  double tap and a swipe down enter and leave it; the swipe does not fight
  the system's edge gestures; the home indicator fades; a message shown in
  full screen on an upright iPhone is readable above the indicator's strip
  (it stands 18 px from the bottom).
- [ ] The full-screen mark of WebKit's own controls, and a pinch: the
  system's player opens and closes, and the channel plays on or is started
  again by one press.
- [ ] The app never asks for Bluetooth.

## Open decisions

The owner's, before a submission; `store/appstore.txt` lists them too.

- After the web process has died the player stands on the channel and
  plays nothing, as after a reload. If the app should start the channel
  again after a death (not after a reload), the shell can tell the next
  page that it recovered; it then needs a guard against a stream that ends
  the process each time. Not built.
- iOS 18 has no sound for AC-3 and similar films. Raise the minimum from
  18.5 to 26, or ship with the limit said in the guide. (The minimum is
  18.5 and not 18.4, where WKWebExtension began: 18.4 cannot be run here,
  and every device on it takes 18.5.)
- Recording is off in the app (guideline 5.2.3); to be revisited after
  approval.
- The `audio` background mode stays only if the checklist's line on it is
  ticked.
