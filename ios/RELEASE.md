# ios/: packages, the App Store and the device checklist

Nothing here is run without the owner's go in the conversation (root
`AGENTS.md`, rule 2), and the owner has decided (2026-11-17) that the
Apple Developer Program membership waits until the app is finished on the
simulators: do not ask for the membership, signing or App Store Connect
steps before the owner says so. `node ios/release.mjs status` says what is
missing, and reads the device checklist below.

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
its privacy label says what the archive's manifests declare (each type
with its row, linked and tracking no less than the manifest says, every
purpose named, and no manifest declaring tracking) and names every type
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
the policy with its section on the app), whether the licences page
names this version and the pinned Cast SDK, and the device checklist below
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

**These commands were written before there was a signing identity, team
or API key on this machine**, from Xcode 26.6's own help and the design.
What a first signed run showed is noted after step 5; correct the steps
by it, and move each into `release.mjs` as a verb once it has succeeded
there. `<teamId>`, `<keyId>`
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

What a first signed run showed, to be worked into the steps when each is
made a verb:

- `xcodebuild -exportArchive -help` prints an error; the export's keys
  are listed under `xcodebuild -help`.
- The Debug device build of step 1 registers a second, permanent App ID,
  `io.github.bigtimesam.kepulitv.debug`, in the team's account.
- The signed archive of step 2, typed by hand, runs the project's
  pre-build phase (`build.mjs --extension`) once more, as it is without
  `KEPULI_PREPARED=YES`: harmless, and gone when the step goes through
  `xcodebuild()` of `build.mjs`.
- `dist/ios/export/` also receives `DistributionSummary.plist`,
  `ExportOptions.plist` and `Packaging.log` beside the `.ipa`.
- `altool --upload-package` takes `--wait`, which stays until App Store
  Connect has processed the build.

After an upload: `node ios/release.mjs status`, the TestFlight build on both
devices, and the checklist again on it.

## Device checklist

The checklist does not have to wait for the paid membership. Since
2026-11-18 this Mac has a free Apple Development certificate of the
owner's Apple account (made for the Safari extension, `safari/AGENTS.md`;
the team's identifier is in `~/.config/kepuli-tv/safari/team`). Such a
personal team signs a Debug build for a device the owner connects and
trusts; the build runs for seven days, and TestFlight and the App Store
stay closed to it. It signed this app as it is, Cast and notifications
included.

**The first run on hardware, 2026-11-18 and 19**: the owner's iPhone 17
Pro Max on iOS 26.7.3, the Debug build of 1.14.0 signed by that personal
team (Developer Mode turned on in the phone's settings, then the
developer trusted under General, VPN & Device Management; the build
command of step 1 above without the three `-authenticationKey…`
arguments, as Xcode's own account signs). The owner held the phone and
said what was seen and heard. No iPad yet, and no TestFlight build, so
no line is ticked; what the iPhone showed:

- Held: an account on https at a public host name connects, channels and
  MKV episodes play; the AC-3 episode is heard (decoded by the player,
  encoded again by the phone's own AAC encoder); the sound is heard with
  the ring switch on silent; the home gesture and the lock leave the
  sound on, the lock screen names the series and the episode with its
  picture, and its Pause holds and its Play starts; turning the phone;
  full screen by the corner button, a double tap and a swipe down;
  picture in picture from the menu, over the home screen and back;
  Chromecast's first use (Google's note, the local-network question, the
  list), an MP4 film taken over from its place, the phone's volume
  buttons, Stop casting playing on here, the television playing on
  through two minutes of a locked phone, an MKV film answered with the
  sentence that it plays here; a reminder arriving with the app closed
  and its tap playing the channel, after the system's question at the
  first reminder; Open in VLC.
- Differed: an account at an address on the local network (plain http,
  the Mac's mock) connected and loaded its lists **without any question
  from the system**, before Cast had been used. The line below expects
  the question; why none came is not known.
- Found and changed: the reminder's message lay over the bar under the
  picture for its minute with only its own button to end it; the strip
  can now be swiped away (`js/toast.js`).
- Not yet tried on it: plain http at a public host name, an hour of a
  channel and a large list, a call and headphones, a `.m3u` from Files,
  rotation lock, a live channel cast, artwork in Google's remote
  control, a film ending on the television behind a locked phone, the
  keyboard's behaviour in the setup fields, the dark theme's keyboard
  and dialogs, notifications refused and then allowed, a link over full
  screen, WebKit's own full-screen mark and a pinch, Bluetooth never
  asked for.

The app's debug bridge reaches a device too: its files are in the app's
data container, which `xcrun devicectl device copy to` and `copy from`
(`--domain-type appDataContainer --domain-identifier
io.github.bigtimesam.kepulitv.debug`, under
`Library/Caches/kepuli-debug/`) write and read, so code can be run in the
page of a connected, unlocked phone with the app in front, as
`ios/sim.mjs eval` does in a simulator. The hosted demo leaves the AC-3
episode out (`KEPULI_MOCK_REVIEW`): for that line run the mock on the
Mac (`KEPULI_MOCK_HOST=0.0.0.0`) and give the phone the Mac's address.

Each line
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
- [ ] A film with AC-3 sound is heard.
- [ ] With the ring switch on silent a channel and a film are heard.
- [ ] Picture in picture, on the iPhone and the iPad: the player's menu
  offers it and WebKit's controls have its mark; the picture plays on over
  the home screen and another app, comes back into the player from its
  own button, and taken out of full screen leaves the player out of full
  screen.
- [ ] The home gesture during a channel, and during a film, without
  picture in picture: the sound goes on behind the home screen and
  another app, and with the screen locked for five minutes; the lock
  screen and Control Centre name the programme and the channel with its
  logo.
- [ ] Pause on the lock screen stops the sound and it stays stopped, also
  when the app is opened again; Play there starts it. A channel paused
  in the app before the home gesture stays silent.
- [ ] If either of the two lines above fails: `UIBackgroundModes` and the
  review notes' paragraph on it are removed before submission (tick this
  line when both hold, or when the key is gone).
- [ ] A call during a film pauses it, and it goes on, or one press starts
  it, after the call; headphones unplugged pause it; music from another
  app stops only when a picture starts here, not when the app is opened.
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

The owner's, before a submission. Closed: the minimum is iOS 26.0;
recording is not in the app; the logo index ships whole, as in the
browsers; the `audio` background mode stays and the sound goes on behind
another app (see above, and the rule on what follows if a device says
otherwise).

- After the web process has died the player stands on the channel and
  plays nothing, as after a reload. If the app should start the channel
  again after a death (not after a reload), the shell can tell the next
  page that it recovered; it then needs a guard against a stream that ends
  the process each time. Not built.
