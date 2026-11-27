# ios/: Kepuli-TV for the iPhone and the iPad

One universal app that shows the extension's own `player.html` in a
`WKWebView` on a `WKWebExtensionController`, so the page is a real extension
page (storage, host access, the Stalker header rule are WebKit's), with
native code for what a page cannot do there: the Chromecast sender, the
screen kept on, reminders as notifications, links and saved files. There is
no second copy of the player; the page knows it is in the app by
`player.html?ios=1` (`js/platform.js`).

Nothing generated is committed: `dist/` (the extension copy, the icon, the
localised strings, `Info.plist`, DerivedData, the simulators' UDIDs),
`vendor/` (the Cast SDK) and `KepuliTV.xcodeproj` are made by the tools
below, and the packages go to `dist/ios/` in the project root. Xcode 26 and
xcodegen (`brew install xcodegen`) are needed; they and the Cast SDK are
dependencies confined to this directory, as Gradle and GeckoView are to
`android/`.

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
| `App/PlayerViewController.swift` | the web view inside the safe area, and over the whole screen in the app's full screen (`setFull`); the ground colour of the strips around it, dimmed while a dialog of the page is open (`setShade`); recovery after the web process dies, slower each time it dies again soon after (`recover`); an extension that did not load said in the viewer's language, with a button that starts it again (`fail`, `start`) |
| `App/Navigation.swift` | what may load in the web view; links and downloads leave it; the end of the web content process, told to the bridge and the player |
| `App/Bridge.swift`, `App/Services.swift` | the page's port to the app (`PagePort`, which a test can stand in for), message routing, `NativeService`, the list of services; `pageGone`: the page whose process ended, told to every service, and what was said to it with `keep` in its last seconds kept for the next |
| `App/Services/KeepAwake.swift` | `awake`: the idle timer off while a picture plays, and on again when the page connects or is gone |
| `App/Services/Screen.swift` | `screen.full`: the app's own full screen asked for and left; `screen.shade`: the backdrop of the page's open dialog, for the strips, and whether one is open, for `Reminders`; `screen.theme`: the page's theme setting, for the keyboard and the dialogs the system draws; a page that has just connected finds the bars back and the strips undimmed, and they come back at once when the page's process ends |
| `App/Services/LinkOpener.swift` | a web page in a Safari view over the player, another app or the App Store through the system; `UIViewController.frontmost` |
| `App/Services/DownloadSaver.swift` | a file the page saves, written to `tmp/saves/` and handed to the Files picker, which is asked again when UIKit refused to present it |
| `App/Services/Reminders.swift` | `notify.*`, `reminders.set` and `reminders.clear`: local notifications, their plan, those no longer in it taken away unless about to fire (`stale`), those of a removed account or a reset player taken away, a tap sent back as `reminder.open` with the reminder's id and the tap's time, which of them the system shows while the app is in front, and the system's leave read again each time the app comes to the front (`notify`, said when it changed) |
| `App/Cast/CastService.swift` | the `cast.*` messages, Google's SDK and its listeners |
| `App/Cast/Press.m`, `App/Bridging.h` | the one Objective-C function: a control pressed with an exception from its action caught (`KepuliPress`), which Swift cannot do |
| `App/Cast/CastMedia.swift` | pure: `cast.load` to `GCKMediaInformation`, and what each session event says to the page |
| `App/Player/NativePlayer.swift`, `App/Player/NativePlayerView.swift` | the `player.*` messages and AVPlayer in a view of the app's own, laid in the web view's scroll view over the page's picture, with its own controls (full screen, picture in picture, AirPlay and the Cast mark in its bars); over what the page plays itself the same controls alone, their presses sent to the page; two slots (`PlayerSlot`), the second for the second of two pictures side by side, with a speaker, a swap and a close in its bar and none of what is the first picture's alone (the lock screen, picture in picture, AirPlay, Cast, the tracks) |
| `App/Debug/DebugBridge.swift` | Debug builds only: the file bridge `sim.mjs` drives, the console hook |
| `Tests/ShellTests.swift`, `Tests/CastTests.swift`, `Tests/ServicesTests.swift` | the XCTest target `KepuliTVTests`, hosted by the app: the page's address and bundled manifest, the app's full screen, the strips' dimmed colour, the wait before a page that keeps dying is loaded again, the window's appearance under the page's theme, the Cast mapping and session rule (what a suspension leaves unheard, `stale` and `gone`), a press that raises caught, the failure's sentence and its button from the bundle's strings, the reminder plan, accounts whose keys begin alike kept apart, a notification about to fire left with the system, a page that is gone told to the services, when a reminder in front is the system's to show, a page whose process ended counted as gone and its tap kept, a reminder set while refused scheduled once the leave is given, the status naming no account and keeping no stream's address, and the sorting of links |

The App Store's texts and answers are `store/appstore.txt`; the page's side
is described in `js/AGENTS.md` (`js/platform.js`, `js/host.js`, `js/iosapp.js`, `js/castui.js`, and full screen in
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
| Press the button of a failed start (`KEPULI_FAIL=1`) | `node ios/sim.mjs native retry` |
| Tap a reminder's notification (fake notifier) | `node ios/sim.mjs native 'tap-reminder <channel id>:<start>'` |
| The page's console and the app's notes | `node ios/sim.mjs log [n]` |
| A screenshot (upright also in landscape, without an alpha channel) | `node ios/sim.mjs shot <file.png>` |
| Uninstall the app with its data, shut down | `node ios/sim.mjs wipe`, `node ios/sim.mjs shutdown [all]` |
| Every scenario on the iPhone and the iPad | `node ios/simcheck.mjs` (about thirteen minutes) |
| Every scenario on the app's minimum, iOS 26.0 | `KEPULI_IOS_DEVICE=kepuli-ios-iphone-26-0 node ios/simcheck.mjs`, and `kepuli-ios-ipad-26-0` |
| Some scenarios, one device | `KEPULI_IOS_DEVICE=kepuli-ios-ipad node ios/simcheck.mjs live rotate` |
| The App Store's screenshots (about four minutes) | `KEPULI_SHOTS_DIR=<scratch> node ios/screenshots.mjs`, then without it into `brand/ios-screenshots/` |
| The Release app for simulators, zipped, and started once | `node ios/release.mjs simulator` (`--no-launch` leaves the start out) |
| The unsigned device archive and the privacy report | `node ios/release.mjs archive` |
| What is missing before the App Store | `node ios/release.mjs status` |

`KEPULI_IOS_RUNTIME` (say `iOS-26-4`) gives the four everyday devices
another runtime than 26.5, for a machine whose Xcode brings its own (the
CI's). `KEPULI_IOS_DEVICE` picks the device: `kepuli-ios-iphone` (the default,
iPhone 17 on iOS 26.5), `kepuli-ios-ipad` (iPad (A16)),
`kepuli-ios-shots-iphone` and `kepuli-ios-shots-ipad` (the
App Store's screenshot sizes), `kepuli-ios-iphone-26-0` and
`kepuli-ios-ipad-26-0` (the same two devices on iOS 26.0, the app's
minimum). Xcode 26.6 brings the 26.5 runtime alone; the 26.0 one is
Apple's build 23A343, about 8 GB, fetched once with
`xcodebuild -downloadPlatform iOS -buildVersion 23A343 -architectureVariant arm64`
(`-buildVersion 26.0` is answered "not available"; the build number is
what it takes), and `devices` leaves a simulator out, and says so, while
its runtime is not installed. Their UDIDs are in `ios/dist/devices.json`;
if that file is lost, `devices` makes new simulators and the old ones
stay until removed by UDID by hand. The app's minimum is iOS 26.0
(`project.yml`): on iOS 18 WebKit refused WebAssembly in the extension
page (measured on 18.5, with `'unsafe-eval'` added as well), so a film
with AC-3 sound was silent there. On iOS 26.0 itself (23A343) every
scenario passed on 2026-11-13, nineteen on `kepuli-ios-iphone-26-0` and
twenty on `kepuli-ios-ipad-26-0`: among them the load of the extension
without a background, a channel, an MKV with its subtitles, the AC-3
episode with a sound track encoded anew, storage kept over a launch, full
screen, the turn, picture in picture on the iPad and the sound that goes
on behind another app. Nothing between 26.0 and 26.5 was run, and no
device on either.

Launch variables the Debug build reads (`node ios/sim.mjs launch NAME=value`):

| Variable | Does |
| --- | --- |
| `KEPULI_PAGE` | the page to load instead of `player.html?ios=1` |
| `KEPULI_LINKS=record` | no link opens; `status.links` holds each address handed to `LinkOpener`, whole. It is for the mock provider: without it `status.links` holds each link's scheme and host alone |
| `KEPULI_SAVES=record` | no picker shows; `status.saves` holds `{name, size}` of each file written |
| `KEPULI_NOTIFY=fake` | nothing is asked of the system: the leave is unasked and given when asked. `fake-granted` and `fake-denied` start that way. `status.reminders` holds `system`, `enabled`, `pending` and the `plan` (`identifier`, `at`, `text`); an identifier there is `reminder|#<n>|<id>`, the account a number and never its key |
| `KEPULI_NOTIFY=quiet` | the system's own notifications, by a provisional leave, which the system gives without a question; `status.reminders` then also holds `delivered`, and both lists are those read at the status before. A leave once refused stays refused until the app is removed (`wipe`) |
| `KEPULI_FAIL=1` | the first start fails as an extension that did not load would: `status.failure`, the sentence and its button on the screen |

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
  from `pageConnected()`, never before: see the greeting in `MEASURED.md`. A service
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
  screen, on both devices. No code asks for an orientation. The page
  answers a turn (`js/playercontrols.js`): lying down with something on it
  asks for full screen, upright it leaves it.
- **Nothing is signed, uploaded or submitted without the owner's go** in
  the conversation (root `AGENTS.md`, rule 2). The team, the API key and
  the demo's address live in `~/.config/kepuli-tv/ios/` and are never
  written into the repository, a log or a commit message.

## Scenarios

`node ios/simcheck.mjs [scenario …]` starts its own mock, boots each device,
installs the Debug app and runs every scenario on `kepuli-ios-iphone` and
`kepuli-ios-ipad`; a picture of each is kept
in `KEPULI_SHOTS_DIR`, upright and lying down where it says so. Each
scenario launches the app anew (links and saved files recorded, the fake
notifier), so each can be run alone; one that turns the device turns it
back; a simulator the tool booted is shut down at the end. Exit 1 on any
failure, on anything not run (a device that is not there), and when nothing ran
at all (`split` asked of the iPhone alone). `sh dev/mock/media.sh` must
have run once in the checkout, or the tool refuses: without its media the
mock answers every stream with 404.

| Scenario | Holds when |
| --- | --- |
| `boot` | a fresh install loads with no extension or context error at the pinned address, `location.search` is `?ios=1`, `html.ios`, the port is connected and `host` arrived with the device's idiom, `permissions.contains` is true for `http://example.org/*`, and neither the bundle's manifest nor the page's has a background; a start made to fail shows its sentence, and its button starts the player |
| `firstrun` | the setup dialog shows without the note on a permission question and fits the window upright and lying down (Save reachable); the port, which comes filled in, is selected when the focus reaches it; the strips around the web view are the page's ground under the dialog's backdrop, and the plain ground once it has closed, and the app knows the dialog open and closed; lying down the fields' labels are of one size and the note on HTTPS no larger than a field's text; the mock's address and `demo`/`demo` typed into its fields connect, and groups and channels load |
| `channels` | a country opens with its rows; a row's name and a button cannot be selected by a long press, a field's text can; lying down at least three rows are in sight and nothing is wider than the window |
| `live` | a channel advances three seconds with sound and no tap; the idle timer is off while it plays and on after a pause |
| `film` | an MP4 film plays; the list's foot shows its count whole beside its marks, upright and lying down; after a launch its place is kept and offered (the start page's Continue watching, or the film's row where the window has one pane) and it goes on from there |
| `mkv` | Silent Fjord's first episode plays through the unpacking with its two subtitle tracks; the subtitles' look opens with no picker in the focus and nothing of the system's over the player, and the text keeps clear of its panel, at its own height where the panel does not lie over the picture (a phone, upright and lying down); the second episode, whose sound is AC-3, plays with a sound track encoded anew; the third goes on through a change to its AC-3 commentary, the sound's selector no narrower than the subtitles' |
| `guide` | the guide has programmes; an upcoming one offers Remind me; nothing of recording is in sight anywhere; lying down it still fits, the day in view whole in its strip and clear of the strip's arrows; over a playing channel, upright and lying down, the corner picture is no wider than its column, the programme's time and title are in sight in its panel, and the strip's arrow back does not show for a scroll shorter than itself |
| `settings` | the help says what a finger does, keeps every key behind the one fold (closed where nothing hovers), names the manifest's version and links to the app's guide, the privacy policy and the licences; sync, the recording row and the full-screen button are gone; the notifications switch follows the notifier (given, turned off and on, refused with its message under the switch, in sight in the dialog); the window takes the page's dark and light theme and none for Automatic, and the page's `prefers-color-scheme` follows; Settings fits upright and lying down; lying down the subtitles' preview is at least 120 px high, and turned upright while open the sections are measured again |
| `persist` | after terminate and launch the account connects and a `storage.local` value and a file in the origin's private file system are still there |
| `fullscreen` | the app's own full screen is entered by the button over the picture upright and stays when the device is laid down, is left by a swipe down there and entered again, is left by standing the device up, and is entered and left by the button upright: the app is held as the device is each time, nothing is forced, the page has the whole screen with the status bar hidden, the picture's box keeps clear of the strips that are not safe (the home indicator's given up when the picture needs the height), WebKit's own full screen is never used, the channel plays throughout, and a page loaded again in full screen finds the bars back |
| `split` (iPad) | at `width 320` and `width 507` one pane shows; at the full width the list and the picture stand side by side; the channel plays on |
| `rotate` | a channel plays through upright, lying down and upright again without a new start, the same channel marked, the page no wider than the window; lying down the picture has gone full screen by the turn alone, and upright it is back in its box, whole with its bar under it, and with two columns the playing row in sight |
| `cast` | the top bar has the Cast mark before any device is known and the menu has no Cast line; `cast.state` arrived disconnected with `devices: -1`; the SDK is asleep; `cast.load` is answered `no-session`; after `cast.prompt` the SDK has started and Google's note is on the screen with no search begun; the debug log names `cast.load` and nothing of its address, title or subtitle |
| `links` | the help's link to the app's guide, the privacy link and VLC's `vlc-x-callback:` address reach `LinkOpener` in that order and the page stays; then, VLC being absent (it always is in a simulator), the page's own timer asks for VLC's App Store page |
| `save` | a Blob behind `<a download>` reaches `DownloadSaver` with its name and a size above zero, and the page stays |
| `player` | the app's own player, which every other scenario keeps out with `KEPULI_PLAYER=page`: a channel advances in the app's player, in the page's box, with the page's own picture empty and the idle timer off; a film's place is kept from what the app says, and its end empties the player and lets the screen sleep |
| `reminder` | a reminder set in the guide is in the app's plan a minute before its start with its sentence, the status naming no account; items an hour past and due now are dropped; `tap-reminder` plays the channel, and plays it again when the web process is ended and the tap made at once (the page loaded next hears it); removed, the plan is empty; set again, nothing is planned or pending once the page has said `reminders.clear` with the account (that an account removed in Settings says it is `node dev/playcheck.mjs iosapp`'s to hold) and once **Reset everything** in Settings has run |
| `banner` | on an app installed anew, with the system's own notifications (`KEPULI_NOTIFY=quiet`): a reminder that falls due while Settings is open is delivered by the system, though the page's list without it came 0.3 s before its moment; one that falls due with the player in sight is not shown by the system |
| `stalker` | the mock's portal connects with no request turned away for want of the cookie or the set-top box's User-Agent, and a channel plays from a one-time link |
| `kill` | the web process is ended while a channel plays in full screen: the player is back by itself on the route it had, with its list, its port and the app's greeting; the list stands on that channel and nothing plays unasked, as after a reload in a browser; the idle timer is on again and the bars are back; chosen, the channel plays |
| `background` | with Settings in front of the app a playing channel's sound goes on, a quarter of a minute later too, and the Media Session names it; `pause()` there (what Pause on the lock screen does) holds, also when the app is in front again; a channel left paused stays paused; `play()` behind the other app starts it and it plays on in front; on the iPad the menu offers picture in picture, which leaves the app's full screen, plays on over the other app and comes back into the page playing |

What the scenarios cannot do, and why:

- **No scenario touches the screen.** A press is a scripted click and a
  swipe is pointer events sent to the page. Real touches (a tap on the
  picture and then the corner button, a double tap, a swipe down) were
  tried once by hand on `kepuli-ios-iphone` with an XCUITest tapper kept
  outside the repository, and so were a long press on a row and on a
  button (nothing selected, no bubble of the system's), a tap outside a
  row's open menu (the menu closes and nothing plays), on
  `kepuli-ios-ipad` upright a tap into a field of the first-run dialog
  (the dialog stands over the keyboard, Connect in sight), and on
  `kepuli-ios-iphone` an address typed with real keys into the first-run
  dialog and Connect tapped with the keyboard up (it connects), Settings
  opened by a tap (no ring on its cross), the search typed into lying
  down with the guide open (the field stays in sight) and the device
  turned and turned back with the keyboard up (Cancel and Save whole);
  nothing repeats them. `node dev/playcheck.mjs iosapp` makes the touch on
  a dialog's button with Chrome's touch events.
- **`save` saves a file of its own making.** The page has nothing that
  saves a file in the app: there is no settings export, the playlist for
  VLC is replaced by VLC's own address, and the app has no recording.
- **`cast` stops at Google's note.** A script cannot press its OK, and a
  session needs a Chromecast: connecting, a load accepted or refused,
  `cast.media`, stopping, suspension and what the device did during one
  (`stale`, `gone`) are the device checklist's.
- **`background` cannot tell what the `audio` mode gives.** A simulator
  never suspends an app: an earlier form of the scenario passed the same
  with the key taken out of `Info.plist`, so that the sound goes on for
  longer than the moment the system gives an app that left is the
  device checklist's. Nor has an iPhone simulator picture in picture, or
  any simulator a lock screen with controls: Pause and Play there are the
  element's `pause()` and `play()` in the scenario.
- By hand in a simulator: choosing a `.m3u` in the file picker of the setup
  dialog; real Split View and Slide Over on the iPad (the scenario narrows
  the web view instead); the look of the app's full screen under a finger,
  and the system's player that the full-screen mark of WebKit's own video
  controls opens.

Writing one: page code is the body of an async function after `PAGE`'s
helpers; a `target="_blank"` click and `permissions.request` must be the
first statement of their piece of code (after a wait WebKit takes them for
unasked); never assert a count of Cast devices.

## More, read when needed

| File | Read it when |
| --- | --- |
| [`MEASURED.md`](MEASURED.md) | you change the shell, the bridge or the page's side of the app: what was found by running it (the address, the port's greeting, the keyboard, full screen, sound behind another app, picture in picture, reminders, Cast), and must not be undone |
| [`RELEASE.md`](RELEASE.md) | you build packages or prepare the App Store: the simulator package and the archive, the store's pictures, the owner's steps, the signing and upload procedure (never run), the device checklist and the open decisions |
