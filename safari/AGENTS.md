# safari/: the extension in Safari on the Mac

The same player as in Chrome and Firefox, as a Safari web extension. Safari
takes an extension only inside an app, so this directory holds the build
that wraps it and the driver that runs it in this Mac's Safari. Nothing
generated is committed (`safari/dist/`).

Not released anywhere. Distribution is the Mac App Store's, which needs the
paid Apple Developer membership; until the owner takes it, the extension
runs locally, signed with the free development certificate of the owner's
Apple account.

## Files

| File | What |
| --- | --- |
| `build.mjs` | `safari/dist/extension` (the Firefox package with the manifest rewritten), the Xcode project by `xcrun safari-web-extension-converter`, and the ad hoc signed app `dist/build/Build/Products/Debug/Kepuli-TV.app` |
| `drive.mjs` | Safari driven by AppleScript: `start`, `eval`, `press`, `dialog` |
| `check.mjs` | the scenarios: `node safari/check.mjs [scenario …]` (start, connect, deny, live, mp4, mkv, record, cast, reminders), against a mock of its own on 8794 |
| `scripts/*.applescript` | what `drive.mjs` runs |

## What differs in Safari (measured in Safari 26.5, macOS 26.5)

- **The package is Firefox's**, with `background.scripts`: in WebKit a
  manifest with `background.service_worker` never starts its background.
  `browser_specific_settings` is dropped.
- **No `notifications` permission.** The converter warns of it, and the
  manifest is made without it. Do not test for it by asking:
  `permissions.request({ permissions: ['notifications'] })` resolved true
  with no notifications API behind it, and the page's own `Notification`
  stays at `default` and fails after its question is answered Allow. So
  `canNotify` in `js/remindersui.js` reads the manifest, the switch in
  Settings is not offered, and a reminder is the player's own message.
- **The host permission question** is a dialog of Safari's with three
  answers: Allow for One Day, Always Allow, Deny. The first two resolve
  `permissions.request` true, Deny false. A day's leave lapses: the
  player's way of asking again is what a viewer then meets.
- **Plain http works** from the extension's page, loopback and the local
  network alike: no mixed-content block.
- **Playback**: `MediaSource` and `ManagedMediaSource` both exist. A live
  channel plays through the `hls` engine, an MP4 film natively, an MKV film
  through `remux`. A stream started by script plays, with sound too.
- **Recording works**: the origin private file system has `createWritable`;
  a fifteen second recording of an HLS channel was 6.2 MB of MPEG-TS.
  **Save to computer** puts it in Downloads (a blob address and a link
  with `download`, pressed by the viewer; it also arrived when the link was
  clicked a second and a half after the press). The file takes a few
  seconds to appear, and for a while after that press the page's elements
  were gone from the accessibility tree until the page was loaded again:
  `press` then finds nothing.
- **No Chromecast**: Safari has Remote Playback, but for AirPlay alone, so
  the menu's Cast to a Chromecast is not offered (`supported` in
  `js/cast.js` tells WebKit by `ManagedMediaSource`). AirPlay is in the
  picture's own controls.
- **`permissions.remove` does not take access away**: it resolves true and
  `contains` then says false, but the page went on reading a server that
  sends no CORS headers, and playing from it. A grant given with Always
  Allow is Safari's to keep (Settings, Websites). Saving the account after
  it asked Safari again, as it should.
- **A server without CORS headers** (most providers) is read only with the
  grant: before it `fetch` fails with "Load failed", after Always Allow the
  answer is read.
- `runtime.connectNative` is not there, `declarativeNetRequest` and
  `alarms` are.

## Signing

`build.mjs` signs for a development team when it is told one
(`KEPULI_APPLE_TEAM`, or the file `~/.config/kepuli-tv/safari/team`; never
in the repository). The team is the personal one of a free Apple account:
Xcode, Settings, Apple Accounts, the account, its team, Manage
Certificates, +, Apple Development; the team's identifier is the
certificate's OU (`security find-certificate -c "Apple Development" -p |
openssl x509 -noout -subject`). Safari then lists the extension as any
other. Without a team the app is signed ad hoc, and Safari takes it only
while **Allow unsigned extensions** is ticked, which it forgets when it
quits and asks the user's password to tick again: that route needs the
owner at every start of Safari.

## Running it in Safari

The owner allows this Mac's own Safari for testing (they do not use it).

1. `node safari/build.mjs`, then open the app once
   (`open -g safari/dist/build/Build/Products/Debug/Kepuli-TV.app`, and quit
   it): that is what makes Safari list the extension. After a change,
   `node safari/drive.mjs reload` does all of it: the extension off, the
   build, the app opened once, the extension on and the player open.
2. `node safari/drive.mjs start` ticks **Allow JavaScript from Apple
   Events** in Safari's Developer settings (the Develop menu must be on:
   `defaults write com.apple.Safari IncludeDevelopMenu -bool true`), ticks
   the extension under Settings, Extensions, and presses its toolbar
   button, which opens `safari-web-extension://<uuid>/player.html`.
   `start unsigned` ticks **Allow unsigned extensions** first, for an ad
   hoc signed build. The extension's checkbox takes a moment to say it is
   on: look again before trying anything else.
3. `node safari/check.mjs` runs the scenarios; `node safari/drive.mjs eval
   '<expression>'` runs code in the page.

## Traps

- **One built copy, in one place.** Safari crashed twice (2026-11-18,
  EXC_BAD_ACCESS in `WebExtensionContext::loadDeclarativeNetRequestRules`,
  a minute after it started) when the extension was turned on while two
  apps with this extension's identifier were registered with macOS (an
  earlier experiment's build in a scratch directory beside this
  directory's) and had been registered again by hand with `pluginkit` and
  `lsregister`. With the one signed copy it has not crashed. The build
  refuses to make a second: if a copy from another checkout or worktree is
  registered it stops and says so, `node safari/build.mjs --take-over`
  takes that copy away first (`node safari/drive.mjs reload take-over`
  with Safari running), and `--unregister` takes every copy away and
  builds nothing. Do not register by hand: the build and one launch of the
  app are enough.
- **Ask before a restart of Safari.** With an ad hoc signed build it
  forgets "Allow unsigned extensions" when it quits or crashes and asks
  for the user's password to turn it on again.
- **Safari reads the extension's files when it starts**, not on a reload of
  the page: after a rebuild the page still ran the old manifest. To load
  new files without quitting, untick and tick the extension under
  Settings, Extensions (not yet tried), not a restart.
- **While a dialog of Safari's is up, Safari answers no Apple Events**:
  `eval` hangs. `node safari/drive.mjs dialog` reads it through System
  Events, which still works, and `dialog '<button>'` clicks an answer.
- **`press` needs Safari in front** and brings it there: behind another
  app's window the page's elements are not in the accessibility tree.
- **A click made by script is not the viewer's.** `press` performs AXPress
  on the page's accessibility element, which is: it is what makes
  `permissions.request` and the first play count. `click at {x, y}` does
  not reach the page.
- In AppleScript, put `entire contents of window …` into a variable before
  looping over it: looped directly, nothing matches. Take values out of
  `argv` before the `tell` block.
- Never run `/Applications/Safari.app/Contents/MacOS/Safari --version`: it
  starts Safari. Read `Info.plist`.
- Never capture the whole screen: the owner's other windows are on it. Use
  `screencapture -R` with the window's own rectangle.
- Mute the picture before playing: the mock's sound comes out of the
  owner's speakers. Activating Safari takes the focus from what the owner
  is doing.
- Several Chromes run on this Mac (the owner's and test ones): System
  Events cannot tell them apart by process id. Do not script a Chrome's
  windows through it.
