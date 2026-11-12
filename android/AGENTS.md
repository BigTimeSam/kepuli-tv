# android/: the Android TV app

There is no second copy of the player here either. The app is one activity
with a full-screen GeckoView (the engine of Firefox for Android), and the
extension is the Firefox package, taken into the APK's assets and installed
into the engine as a built-in on every start. So the player has what it has
in Firefox: its storage, requests to any provider without CORS, MediaSource
and WebAssembly. The root `AGENTS.md` rules apply; this directory is the one
place with a build step (Gradle), and nothing outside it depends on it.

| File | What |
| --- | --- |
| `app/build.gradle` | the app: version from `../manifest.json`, `node firefox/build.mjs` run and `firefox/dist/` synced into the assets before every build, the icon from `../icons/`, GeckoView from Mozilla's Maven |
| `app/src/main/java/…/PlayerActivity.java` | the engine, the session and the extension; the page opened as `player.html?tv=1`; Back sent to the page as Escape; `onCloseRequest` (the page's `window.close()`) steps back to the launcher; optional host permissions granted without a prompt; a television's page made 1280 by 720 |
| `app/src/main/AndroidManifest.xml` | the launcher entries (television and phone), no touch screen required, cleartext traffic (providers serve http) |
| `app/src/main/res/` | the name and the theme; the icon and the television launcher's banner are taken from `../icons/` and `../brand/android-tv-banner-1280x720.png` at build time |

The remote control itself is the player's: `js/remote.js`, on with `?tv=1`,
tested in a desktop browser by `node dev/playcheck.mjs remote`.

## Building and running

JDK 21, the Android SDK with platform `android-37.2` (GeckoView 160 asks for
it) and Node on the PATH. The Gradle wrapper is 9.8.0, the plugin 9.4.1.

```
cd android && ./gradlew assembleDebug        # app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n io.github.bigtimesam.kepulitv/.PlayerActivity
```

- **The emulator.** An AVD of your own from `system-images;android-34;android-tv;arm64-v8a`
  with the `tv_1080p` device; never another project's AVD. The mock server
  must listen on every interface, on a port of your own
  (`KEPULI_MOCK_PORT=8797 KEPULI_MOCK_HOST=0.0.0.0 node dev/mock/server.mjs`),
  and is `10.0.2.2` from the emulator.
- **Driving it.** A debug build has remote debugging on, and
  `firefox/android.mjs` speaks to it as to Firefox:
  `KEPULI_ANDROID_PACKAGE=io.github.bigtimesam.kepulitv node firefox/android.mjs status|eval|shot`.
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
- `./gradlew bundleRelease assembleRelease` makes
  `app/build/outputs/bundle/release/app-release.aab` (both ARM kinds, for
  Play) and an APK for each kind under `apk/release/` (for `adb install` on
  a television: `arm64-v8a` for most, `armeabi-v7a` for the 32-bit ones;
  `adb shell getprop ro.product.cpu.abi` says which). Copy them into
  `dist/android/` as `kepuli-tv-android-<version>.aab` and `…-arm64.apk`,
  `…-arm32.apk`.
- The debug build is `io.github.bigtimesam.kepulitv.debug`, an app of its
  own beside the released one.
- `node dev/play-publish.mjs login|status|upload` takes the bundle to a new
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

- Android's packager leaves out what begins with an underscore, and the
  extension's languages are in `_locales/`: without `ignoreAssetsPattern`
  the engine refuses the extension as invalid.
- The application id is permanent once a package has been uploaded to Play.
- A text field with the focus brings up the television's keyboard, which
  takes the arrows; `js/remote.js` holds it down until OK.
- Not done yet: the release build (signing, the 32-bit ABI, an app bundle),
  sound and speed measured on a real television.
