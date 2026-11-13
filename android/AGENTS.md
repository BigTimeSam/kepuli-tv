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
| `strings.mjs` | the words Android shows of the phone's app outside the page (the two notification channels' names, the playback notification's button), written into Android's resources in the player's thirty languages from `../js/i18n.js` and `../js/locales/`; run by Gradle |
| `app/src/main/…/EngineActivity.java` | what both share: the engine, the session and the extension; Back sent to the page as Escape (as a key, and as Android 16's callback); `onCloseRequest` (the page's `window.close()`) steps back to the launcher; optional host permissions granted without a prompt |
| `app/src/main/AndroidManifest.xml`, `res/` | the permissions, cleartext traffic (providers serve http), the activity, the name and the theme |
| `app/src/tv/` | the television: the page opened as `player.html?tv=1` and made 1280 by 720, no bars, lying down, the leanback launcher entry and its banner (`../brand/android-tv-banner-1280x720.png`, taken at build time) |
| `app/src/mobile/` | the phone and the tablet: the page opened as `player.html?app=1`, upright or lying down as the device is held, clear of the system's bars and the keyboard until something goes full screen; and what a browser does around a page: a file field's picker, a saved file into Downloads, a link or an `intent:` link to the app that opens it, a reminder as the system's notification, the page opened again when Android took its process; and what an app does that a tab does not: picture in picture, the sound out of sight (`PlaybackService`), a reminder when the app is not running (`Reminders`, `ReminderReceiver`) |

The remote control is the player's: `js/remote.js`, on with `?tv=1`, tested
in a desktop browser by `node dev/playcheck.mjs remote`. The phone's Back is
there too, on with `?app=1` (`node dev/playcheck.mjs appback`): it closes
what is open, leaves the player's pane for the list, and from the list
leaves the app.

## The phone's app and the extension talk

The phone's copy of the extension's manifest has `nativeMessaging` and
`geckoViewAddons` (only an extension built into an app may have them; the
browsers' packages and the television's do not), and the app answers to
the name `kepuli` from both of the extension's ends:

- **The page** (`talkWithApp` in `js/remote.js`) opens a line when it is
  opened with `?app=1`. It says what is on and whether it plays, and the
  picture's shape; it hears `pip` (the app has become the small window: the
  page shows the picture alone, `.pip` in `css/last.css`), `press` (play,
  pause, next, previous, from the notification, a headset or the lock
  screen) and `watch` (a reminder's notification was pressed while the app
  was not running).
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

## Building and running

JDK 21, the Android SDK with platform `android-37.2` (GeckoView 160 asks for
it) and Node on the PATH. The Gradle wrapper is 9.8.0, the plugin 9.4.1.

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
- Not done yet: sound and speed measured on a real television; on a phone,
  a planned recording while the app is not running, how long a live stream
  holds in the background on a real device's battery saving, a reminder's
  lateness on a resting device, **Open in VLC** with VLC installed, and a
  real device altogether.
