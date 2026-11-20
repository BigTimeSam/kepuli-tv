# android/: the Android apps

There is no second copy of the player here either. The app is one activity
with a GeckoView (the engine of Firefox for Android), and the extension is
the Firefox package, taken into the APK's assets and installed into the
engine as a built-in on every start. So the player has what it has in
Firefox: its storage, requests to any provider without CORS, MediaSource
and WebAssembly. The root `AGENTS.md` rules apply; this directory is the one
place with a build step (Gradle), and nothing outside it depends on it.

One application in Google Play (`io.github.bigtimesam.kepulitv`), built as
two packages, so that neither kind of device is held to the other's shape:
`tv` for a television and `mobile` for a phone or a tablet. Play shows a
device one of them: the television's requires leanback, which no phone
has, and a television that fits both takes the one with the higher version
code, which is why the television's are far above the phone's. (The
phone's does not require a touch screen: the engine's own manifest says it
is not needed, and a Chromebook without one may have the app.)

| File | What |
| --- | --- |
| `app/build.gradle` | the two packages (`productFlavors`), the version from `../manifest.json`, `node firefox/build.mjs` run and `firefox/dist/` synced into the assets before every build, the extension's manifest written for each package (the phone's with the two permissions its line to the app takes), the icon from `../icons/`, GeckoView from Mozilla's Maven |
| `enginecheck.mjs` | whether the pinned GeckoView is Mozilla's latest (see [The engine's version](#the-engines-version)) |
| `permissions.mjs` | what each built package asks Android to allow, against the approved lists in the file |
| `strings.mjs` | the words Android shows of the phone's app outside the page (the two notification channels' names, the playback notification's button), written into Android's resources in the player's thirty languages from `../js/i18n.js` and `../js/locales/`; run by Gradle |
| `app/src/main/…/EngineActivity.java` | what both share: the engine, the session and the extension; Back sent to the page as Escape (as a key, and as Android 16's callback); `onCloseRequest` (the page's `window.close()`) steps back to the launcher; optional host permissions granted without a prompt |
| `app/src/main/AndroidManifest.xml`, `res/` | the permissions, cleartext traffic (providers serve http), the activity, the name and the theme; the logo shown while the engine starts (`res/drawable/splash.xml`, from `../brand/tv-compact.png`), which `EngineActivity` keeps over the view until the page has drawn |
| `app/src/tv/` | the television: the page opened as `player.html?tv=1` and made 1280 by 720, no bars, lying down, the leanback launcher entry and its banner (`../brand/android-tv-banner-1280x720.png`, taken at build time) |
| `app/src/mobile/…/Rules.java`, `app/src/testMobile/` | the phone's rules that need nothing of Android, and their JUnit tests |
| `app/src/mobile/` | the phone and the tablet: the page opened as `player.html?app=1`, upright or lying down as the device is held, clear of the system's bars and the keyboard until something goes full screen; and what a browser does around a page: a file field's picker, a saved file into Downloads, a link or an `intent:` link to the app that opens it, a reminder as the system's notification, the page opened again when Android took its process; and what an app does that a tab does not: picture in picture, the sound out of sight (`PlaybackService`), a reminder when the app is not running (`Reminders`, `ReminderReceiver`) |

The remote control is the player's: `js/remote.js`, on with `?tv=1`, tested
in a desktop browser by `node dev/playcheck.mjs remote`. The phone's Back is
the page's too (`js/androidapp.js`), on with `?app=1` (`node dev/playcheck.mjs appback`): it closes
what is open, leaves the player's pane for the list, and from the list
leaves the app.

## The phone's app and the extension talk

The phone's copy of the extension's manifest has `nativeMessaging` and
`geckoViewAddons` (only an extension built into an app may have them; the
browsers' packages and the television's do not), and the app answers to
the name `kepuli` from both of the extension's ends:

- **The page** (`js/host.js` opens the line when the page is opened with
  `?app=1`; `talkWithApp` in `js/androidapp.js` speaks on it). Every word
  is `{ type, ...fields }`, as the cast session's are. The page says
  `app.now` (what is on and whether it plays), `app.shape` (the picture's
  width and height) and `app.art` (the channel's logo or the film's cover
  as a small PNG in base64, read by the page so that the app asks nothing
  of the network for it). It hears `app.pip` (the app has become the small
  window: the page shows the picture alone, `.pip` in `css/last.css`),
  `app.press` (play, pause, next, previous, from the notification, a
  headset or the lock screen) and `app.watch` (a reminder's notification
  was pressed while the app was not running). `PlayerActivity` sorts them
  by type; a new word is a new type there and a listener in
  `js/androidapp.js`.
- **The background** (`tellApp` in `background.js`) sends the reminders
  whenever they change, where notifications are allowed.

What the app does with them:

- **Picture in picture.** Home or the recent apps while something plays
  makes the app a small window (`onUserLeaveHint`, and by itself from
  Android 12). Closing that window pauses; so does Back from the list.
- **Sound out of sight.** `PlaybackService` is a foreground service of the
  `mediaPlayback` kind with the media notification and Android's media
  session, running from the first play until the page has nothing on, the
  notification is swiped away, the app is swiped from the recent apps, or
  it has stood paused in the background for ten minutes. While it runs
  the session stays active with the activity stopped (`awake()`, and
  `setKeepActive` for the view, which rests its session by itself when its
  surface goes): in a
  resting session what played went on, but a pause could not be taken back
  from the notification. Play
  asks for a declaration of the foreground service, with a short video, in
  the console.
- **Reminders.** `Reminders` keeps the list and sets Android's alarm two
  minutes before the first programme (the extension says its own one
  minute before); `ReminderReceiver` shows the notification without the
  engine, and sets the alarm again after a restart or an update. The
  notification's name is the extension's own, so one said by both is one.
  The alarm is not exact from Android 12 on (that takes a permission the
  viewer grants in the settings, `SCHEDULE_EXACT_ALARM`, which the manifest
  does not ask for): on the emulator it came 20 to 40 seconds late.

## Chromecast

The phone's and the tablet's app carries Google's Cast sender
(`play-services-cast-framework`; the television's package does not). The
engine has no Remote Playback, so a Chromecast is handed an address and
fetches the stream by itself: `CHROMECAST.md` says what a device takes
(HLS and the files a browser plays by itself; not raw MPEG-TS, not
Matroska).

- **The page's side** is `js/cast.js` (`NativeCast`) and `js/castui.js`,
  over the typed messages of `js/host.js` on the same line as the words
  above: `cast.prompt`, `cast.load`, `cast.stop`, `cast.end`,
  `cast.controls` from the page; `cast.state` and `cast.media` from the
  app. The same messages are spoken by the app for the iPhone and the iPad
  (`ios/`), so the page's side is one.
- **`CastService`** answers them. Google's sender is not started before
  the viewer first asks to cast, and starts with the app after that
  (preference `cast`/`used`): an app whose viewer never casts says nothing
  to Google and does not search the network. Devices are looked for only
  while the activity is in sight. Nothing logs an address or a title.
- **The dialogs are Google's**: the devices and the session (AndroidX's
  media router dialogs, shown with AppCompat's theme over the plain
  activity), and the remote control (`CastControlsActivity`, the sender's
  expanded controller), which the sender's own notification also opens.
- **One connection.** The page stops the picture before it hands the
  address over and plays on here when the device cannot, fails or lets go;
  while a device plays for the page, the page tells the app that nothing
  is on (`castingNow` in `js/castui.js`, asked by `js/androidapp.js`), so neither the media
  notification nor the small window stands for a picture that is on a
  television.
- **Testing.** The emulator finds the Cast devices of the host's network
  and shows Google's list, but a device cannot fetch from the mock at
  `10.0.2.2`: give the account the host's own address on the network.
  Casting takes over somebody's television: ask first.

## The app's own player

Both apps play what they can in a player of their own, Media3's
ExoPlayer, as the app for the iPhone and the iPad plays it in AVPlayer:
one player to the viewer on every device. The page's side is
`js/nativeplayer.js`, shared with that app, and the words are the ones
listed at the head of `ios/App/Player/NativePlayer.swift`.

- **What it plays.** What `js/nativeplayer.js` hands it: HLS and the MP4
  family (what a Chromecast takes, `castMedia` in `js/cast.js`, without
  WebM). Matroska, MPEG-TS without an HLS address, a recording and the
  archive stay in the page, and so does whatever the app's player fails
  on, from where it had got to.
- **`NativePlayer`** (`src/main`, both packages) answers the page's
  `player.*` words: `player.load`, `player.page`, `player.frame`,
  `player.sound`, `player.play`, `player.pause`, `player.seek`,
  `player.pip`, `player.stop`; it says `player.state` (loading, playing,
  paused; idle with `finished` or `error`) when it changes and every two
  seconds while the picture runs, `player.track` when the viewer chooses
  a track, and `player.command` for a press that is the page's to do. The
  app says `host` with `player: true` as the page connects, which is what
  makes the page hand anything over. It is two slots, as in the iPhone's
  app: every word names its `slot`, 2 for the second of two pictures side
  by side.
- **`PlayerControls`** are the controls, drawn as the iPhone's app draws
  them: what plays and where the picture goes at the top (the speaker
  beside a second picture, the stream's tracks, the small window, the
  Cast mark; on the second picture the swap and the close), the transport
  in the middle, the time line or the live mark with full screen at the
  foot, each group in a dark capsule. A tap shows and hides them, four
  seconds put them away, a paused picture keeps them, a double tap is
  full screen, and the transport is away while the waiting wheel turns.
  The marks are vectors in `src/main/res/drawable/player_*.xml`.
- **The page's own picture has the same controls.** `player.load` with
  `page: true` and no address lays the controls alone over the page's
  `<video>` (the layer draws nothing else); `player.page` says where that
  picture is, and play, pause, seek and the small window go back as
  `player.command` for the page to do.
- **Full screen is the page's**, whichever picture it is: the button and
  the double tap say `player.command {what: "full"}`, the page asks the
  engine for full screen, and the box it then says (`full: true` in
  `player.frame`) is the whole window. The press is made in the app, so
  the engine does not see it as the viewer's: the one preference in
  `EngineActivity.QUIET` that is not for quiet
  (`full-screen-api.allow-trusted-requests-only`) lets the page's request
  through. Back leaves full screen as it leaves the page's own.
- **On a television** the app shows the picture and the waiting wheel and
  nothing else (`controls: false` in `player.load`): the remote drives
  the page (`js/remote.js`), whose pause and seek go to the app's player
  (`nativeToggle`, `nativeSeek`), and what the page draws in the picture
  (the channel's banner, the bar of a seek, a wait or a failure) is said
  as holes in the app's view. The page pauses the app's picture when the
  app goes to the background and starts it again, as the engine does for
  the page's own. The television's extension has the two permissions of
  the phone's for the line (`syncManifests` in `app/build.gradle`), and
  the television's `PlayerActivity` answers `player.*` alone.
- **Only the web's addresses.** The page's address must be http or https
  (`Rules.playable`), and the player is built with an http source alone,
  so that a playlist of the provider's cannot name a file, a `content:`
  address or an asset of the app's for it to read. A redirect between
  http and https is followed, as the engine follows it for the page:
  the source speaks nothing else. Keep it so when the source is changed.
- **The view** is Media3's `PlayerView` without its controls
  (`res/layout/native_player.xml`), under `PlayerControls` in a layer
  added to the activity's frame over the engine's view, at the box the
  page says: the box in the window (`left`, `top`) times `ratio`, the
  screen's pixels to one of the page's. Where the page draws something of
  its own over the picture (a menu, a message: `holes`) the layer draws
  nothing and takes no touch, which is why the view is a texture and not
  a surface. The television's picture is therefore the same texture: the
  surface of its own that the earlier experiment gave it for a sharper
  picture (tag `archive/android-tv-native-player-spike`) cannot be cut
  open for the page's marks, and is the thing to try next if the picture
  on a real television is no better than the engine's.
- **Under a dialog** of the page's the pictures are dimmed with the
  dialog's backdrop and take no touch (`player.shade`, the page's word
  for what the iPhone's app hears as `screen.shade`).
- **The small window** shows the layer as it lies in the page, without
  its controls. **Sound out of sight** and the notification are as
  before: the page tells the app what is on from the app's own
  `player.state`.
- **The libraries.** `media3-exoplayer` and `media3-exoplayer-hls` are
  the ones the engine brings already (1.11.1); `media3-ui` is the one
  more, for the picture's view. Neither package asks Android for anything
  new (`node android/permissions.mjs`).
- **Seen** (2026-11-20, the mock): on the phone's emulator (Android 16) a
  channel and an MP4 film in the app's player and a Matroska film in the
  page under the same controls, pause and play, the time line, full
  screen from the button with the title over the picture, two channels
  side by side with the speaker moved, the sides swapped and the second
  closed from its bar; on a Galaxy Tab S8 a channel, and two side by side
  with both pictures' controls; on the television's emulator (Android 14)
  a channel and a film in the app's player in the page's box and full
  screen, the banner and the seek's bar showing through, OK pausing and
  playing, three presses of Right taking the film from 50 s to 62 s, and
  Home pausing the picture until the app came back. **Not seen:** a real
  television (the picture's quality, which is the reason for a player
  there, and a real remote), a provider's real streams and sound on a
  device, the small window, a track chosen in the menu, the Cast mark's
  press and the screen off.
- **Tests.** `Rules` has the player's pure rules with their JUnit cases;
  `node dev/playcheck.mjs androidplayer` plays the app's side of the line
  in a desktop browser, for the phone's page and the television's.

## Checks

`node android/permissions.mjs`, after a build of both debug packages, lists
what each asks Android to allow against the approved lists in the file: a
library's manifest is merged into the app's, and Play's forms and the
privacy policy name the permissions one by one.

`./gradlew testMobileDebugUnitTest` runs the JUnit tests of the phone's
pure rules (`Rules.java`: a saved file's name, which links leave the app,
the small window's shape; `src/testMobile/`). A rule that needs nothing of
Android goes there with its test, not into the activity: Android's own
classes are stubs on the build machine.

The CI's `android` job (`.github/workflows/ci.yml`) builds both
packages and runs both, and the Freshness workflow runs
`node android/enginecheck.mjs` every night; the
page's side of the apps is covered by the `chrome` job's `remote`,
`appback` and `appcast` scenarios (`appcast` plays the app's end of every
`app.*` and `cast.*` word).

## The engine's version

GeckoView is pinned in `app/build.gradle`, so that a build does not change
under a commit, and it is a browser's engine reading a provider's
playlists, pictures and streams: Mozilla's fixes, most of them for
security, must reach the viewer. `node android/enginecheck.mjs` compares
the pin with Mozilla's Maven; the nightly Freshness run fails once a newer engine
has been out for a week. Taking one is a commit of its own:

1. `node android/enginecheck.mjs --latest` gives the version: put it in
   `app/build.gradle`. A new major may want a newer `compileSdk`; the build
   says so.
2. Build both packages and run `node android/permissions.mjs`: a new
   engine may ask Android for something new.
3. Start each package on its emulator and see the player's page
   (`firefox/android.mjs eval 'document.readyState'`), a channel playing
   on the phone's, and a real touch on a selector (below, Traps).
4. Measure the engine's silence again (Traps, "The engine is a browser's"):
   the privacy policy says the app looks up nothing on its own account.
5. Raise `androidBuild` when the packages go to Play (root `AGENTS.md`,
   rule 2: only on the owner's go).

## Building and running

JDK 21, the Android SDK with platform `android-37.2` (GeckoView 160 asks for
it) and Node on the PATH. Gradle finds the SDK by `ANDROID_HOME`
(`export ANDROID_HOME=$HOME/Library/Android/sdk` on this machine) or by
`sdk.dir` in a git-ignored `android/local.properties`; without either the
build stops with "SDK location not found". The Gradle wrapper is 9.8.0,
the plugin 9.4.1.

```
cd android && ./gradlew assembleTvDebug assembleMobileDebug   # app/build/outputs/apk/<tv|mobile>/debug/
adb install -r app/build/outputs/apk/mobile/debug/app-mobile-arm64-v8a-debug.apk
adb shell am start -n io.github.bigtimesam.kepulitv.debug/io.github.bigtimesam.kepulitv.PlayerActivity
```

- **The emulator.** An AVD of your own from `system-images;android-34;android-tv;arm64-v8a`
  with the `tv_1080p` device, and a phone's (a Pixel on `android-36`) for
  `mobile`; never another project's AVD. Both debug builds are the same
  application, so one device holds one of them at a time (`adb install -r -d`
  to go from the television's back to the phone's). With two emulators
  running, name yours (`adb -s`, `ANDROID_SERIAL`). The mock server
  must listen on every interface, on a port of your own
  (`KEPULI_MOCK_PORT=8797 KEPULI_MOCK_HOST=0.0.0.0 node dev/mock/server.mjs`),
  and is `10.0.2.2` from the emulator.
- **Driving it.** A debug build has remote debugging on, and
  `firefox/android.mjs` speaks to it as to Firefox:
  `KEPULI_ANDROID_PACKAGE=io.github.bigtimesam.kepulitv.debug node firefox/android.mjs status|eval|shot`.
  Keys are `adb shell input keyevent KEYCODE_DPAD_DOWN` (`_CENTER` is OK,
  `KEYCODE_BACK`). `adb shell input text` spoils `&`: set an account
  through `browser.storage.local` and reload instead.
- **OK held down** cannot be sent by `adb` on this image (`--longpress` comes
  up at once): the scenario holds Enter in the browser, and a real remote
  is the only test of the hold on a device.

## Release packages and Google Play

Only on the owner's go, as every release (root `AGENTS.md` rule 2).

- **The upload key** is outside the repository:
  `~/.config/kepuli-tv/android/keystore.properties` names the keystore and
  its passwords (`KEPULI_ANDROID_KEYSTORE` for another file). Without it
  only the debug build can be made. Play signs what users get with a key of
  its own (Play App Signing), so a lost upload key can be replaced.
- `./gradlew bundleTvRelease assembleTvRelease` makes
  `app/build/outputs/bundle/tvRelease/app-tv-release.aab` (both ARM kinds, for
  Play) and an APK for each kind under `apk/tv/release/` (for `adb install` on
  a television: `arm64-v8a` for most, `armeabi-v7a` for the 32-bit ones;
  `adb shell getprop ro.product.cpu.abi` says which). Copy them into
  `dist/android/` as `kepuli-tv-android-tv-<version>.aab` and `…-arm64.apk`,
  `…-arm32.apk`. The phone's are `bundleMobileRelease assembleMobileRelease`
  the same way under `mobile`, copied as `kepuli-tv-android-mobile-<version>…`.
  In Play the television's bundle goes to the Android TV form factor's own
  track and the phone's to the ordinary one.
- **A change to the app alone** (nothing of the player's) is a new build of
  the same version: raise `androidBuild` in `app/build.gradle`, which gives
  the version name a fourth part (1.13.0.1) and Play the higher version
  code it wants, and set it back to 0 when the player's version moves on.
  The codes are the player's version times a hundred plus the build, and
  the television's a hundred million above.
- The debug build is `io.github.bigtimesam.kepulitv.debug`, an app of its
  own beside the released one.
- `node dev/play-publish.mjs login|status|upload [mobile|tv]` takes a bundle to a new
  internal testing release in the Play Console and leaves it a draft. It
  drives a Chrome of its own (port 9446, `~/.config/kepuli-tv/play-chrome`)
  in which the owner signs in once; the app must have been created in the
  console first. The upload step has not yet met a real release page:
  read what it prints the first time.
- The listing's pictures for Play (icon 512, feature graphic 1024×500, the
  banner, five television screenshots at 1920×1080 from the emulator with
  the mock's fiction) are made into `dist/android/play/`, not kept in the
  repository.

## Traps

- The activity is exported (it is the launcher's), so any app can start
  it with any extras. What a reminder's notification is to play is kept in
  the app's own storage by the notification's name (`Reminders.watch`),
  never carried on the intent: carried there, another app could have had
  the player open an address of its choosing.
- From Android 12 on the system shows a start screen of its own before
  the window's (`res/values-v31/styles.xml`): without the logo named there
  it showed the launcher's icon on a white disc, then the logo.

- The engine is a browser's, and left alone it asks Mozilla and Google a
  few things when it starts (a sign-in page on the network, the device's
  country, lists of harmful sites, its own settings service).
  `EngineActivity` turns them off through the engine's configuration file,
  and the privacy policy says the app looks up nothing on its own account.
  After a change to the engine or its version, measure again on a newly
  installed release build: `adb root`, `tcpdump -i any -n port 53` on the
  emulator, three minutes with no account (Android's own
  `connectivitycheck.gstatic.com` and `www.google.com` are not the app's).
  A released engine takes another address for the settings service only
  with `MOZ_REMOTE_SETTINGS_DEVTOOLS` in the file's `env`.

- The player's page lives in the app's main process, not in a content
  process of its own (GeckoView 160; measured on the phone's emulator,
  2026-11-18): with both `sandboxed_tab` processes killed the page went on
  untouched, and a page made to eat memory grew the main process until
  Android took the whole app. So a page that dies takes the app with it,
  Android starts the app anew, and `onKill` and `onCrash` have not been
  seen to come for the player; `EngineActivity.reopen()` answers them all
  the same, for an engine that changes this. Do not build on the page
  outliving a crash, or on pacing its reopening.
- A real touch for a test: `adb shell input tap <x> <y>`, the place from
  the page as `(mozInnerScreenX + left) * devicePixelRatio` (and the same
  for y), asked again after anything that moves the page (the keyboard
  going). The emulator's page says `(hover: hover)` and a fine pointer, so
  the touch sizes of `css/last.css` and the caret's rule are a real
  device's to show.
- Android's packager leaves out what begins with an underscore, and the
  extension's languages are in `_locales/`: without `ignoreAssetsPattern`
  the engine refuses the extension as invalid.
- The application id is permanent once a package has been uploaded to Play.
- A text field with the focus brings up the television's keyboard, which
  takes the arrows; `js/remote.js` holds it down until OK.
- A release of Back with the keyboard up comes without its press (the
  keyboard took that): only a press and its release together are a Back.
- `screen.orientation.lock()` from the page brings GeckoView 160 down (a
  null pointer in libxul): the page must not call it.
- The engine wants a picked file as a path it can read; handed the picker's
  `content:` address it finds none. `mobile` copies the file into its cache.
- A saved file given both a name with an ending and a type gets a second
  ending from Android (`.m3u.m3u8`): the type is given only without one.
- The engine's own media session (`MediaSession.Delegate`) never came to
  life for the extension's page (GeckoView 160), with sound playing and a
  title set: what is on comes from the page over its line instead.
- A reminder leaves the extension's list the moment it is said, and its
  notification reaches the app a breath later: what has been said is
  remembered by its name for a day, not by the list.
- `adb shell am force-stop` takes an app's alarms away with it; to try a
  reminder with the app not running, `adb shell am stop-app <package>`.
- The extension can hold the "notifications" permission while Android's
  own is missing (taken back in the settings): the app asks again when
  reminders arrive without it.
- Seen on a real device (Galaxy Tab S8+, Android 16, a debug build beside
  the released app, the hosted demo, 2026-11-18): the page says a coarse
  pointer that does not hover, every control in sight is 40 px and the
  list's foot holds its marks; a tap on a selector's label opens the
  app's own list with its filter, a second closes it, and no field takes
  the caret; a channel plays, the notification has the programme, the
  channel and its logo under the app's mark; Pause and Play come through
  the media session and, with the app in front, as keys; Home makes the
  small window; with the screen off the picture's time went on for a
  minute (muted, the device dozing).
- Not done yet: sound and speed measured on a real television; on a phone,
  a planned recording while the app is not running, how long a live stream
  holds in the background over hours and under battery saving, a
  reminder's lateness on a resting device, **Open in VLC** with VLC
  installed, a saved file, and a cast from the new build.
