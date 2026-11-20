# ios/: what was measured, and must not be undone

Read the part that concerns the code you are about to change in `ios/` or
in the page's side of the app (`js/iosapp.js`, `js/host.js`,
`js/playercontrols.js`, the `.ios` rules of `css/last.css`). Each entry is a
fact found by running the app, with what it cost to find: a change that
goes against one brings back the fault it records. `AGENTS.md` beside this
file is the working guide; `RELEASE.md` is the way to the App Store.

- **The page's address takes a query string.** `location.search` is
  `?ios=1`. The address is built with
  `URL(string:relativeTo:)`; `appendingPathComponent` would escape the `?`.
- **No background page.** The iOS manifest has no `background` key and the
  extension loads without an error (`build.mjs` has the
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
  (`html.kb`, `--vvh`, `--vvt`; `js/iosapp.js`) and a dialog stands at the
  top of it and scrolls as one (`css/dialogs.css`): the first-run dialog
  then reaches from 8 to 721 px with Connect at 652, and WebKit scrolled
  nothing (seen with a real tap; the visual viewport's offset stayed 0).
- **The window's interface style is the page's theme setting**
  (`screen.theme`, `PlayerViewController.setTheme`): dark or light when
  the viewer chose one, none for Automatic, as an override also decides
  what `prefers-color-scheme` answers in the web view (`settings` reads
  both). The keyboard under a dark page was not photographed after the
  change, nor Google's dialogs: the device checklist has the line.
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
  It turns with the device, and
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
- **`WebAssembly.compileStreaming` fails in the extension page**, as the
  extension scheme serves `.wasm` as `application/octet-stream`; the
  loader's other path is taken, and the FFmpeg audio build runs.
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
- **A hidden `GCKUICastButton` presents Google's dialogs**, on both
  devices. At the first cast that is Google's note, and after its
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
- **A finger lifted on a dialog's button while a field has the keyboard
  up made no click**: `pointerup` on the button, `focusout` of the field
  2 ms later, the keyboard gone, the dialog moved, and nothing more
  (seen with real touches on the first-run dialog: Connect only closed
  the keyboard). The page makes the press itself at `touchend` and keeps
  the field's focus (`js/iosapp.js`); with it a real tap on Connect, the
  keyboard up, connected the account.
- **An iPhone's window does either with the keyboard up**: `innerHeight`
  stayed 778 with 436 in sight, and was 456 once WebKit had scrolled the
  page to a field. The page counts a keyboard by both (`html.kb`): a
  dialog then stands in what is in sight, and where that is 300 px or
  more its buttons stay at the foot of it (`html.kb-tall`), which is also
  what keeps Cancel and Save whole after the device was turned and
  turned back with the keyboard up (seen).
- **On a device WebKit scrolls the page itself to a dialog's field**
  (iPhone 17 Pro Max, iOS 26.7.3, 2026-11-19; no simulator did it). The
  account's form in Settings, the provider's name tapped: `innerHeight`
  506 with a document of 860, `scrollY` 354, the dialog at -346 and only
  its Cancel and Save in sight at the top of the screen, the field cut
  off by the dialog's edge. The page is put back and the field brought
  into sight inside the dialog (`js/iosapp.js`, the page's `scroll`
  listener); run on that phone with the keyboard up, the dialog stood at
  8 to 472 px and the field at 220 of the 480 in sight, and stayed.
  Tapped anew after that, the field went under the dialog's pinned
  buttons and its sides showed in the bar as two upright lines. That
  stayed with the bar made opaque (its ground had been the panel's, a
  third transparent) and with the section's own scrolling taken away:
  the field under the bar was drawn over it, though the bar is
  positioned on `z-index: 1` and takes the press there. Why WebKit draws
  it so was not found. Settings therefore lets nothing under its bar
  with a keyboard up: the frame it has without one, as high as what is
  in sight, the section alone scrolling (`css/dialogs.css`,
  `html.kb-tall #setup`); set on that phone as it stood, 480 px in
  sight held the heading, the sections' strip, 213 px of the section
  with the field in it, and the buttons.
- **Changed after that evening by reading the code, not yet seen on a
  device** (2026-11-19, before the first iPad): a finger held for half a
  second on a row or a cover opens its menu (`js/rows.js`: WebKit sends
  no `contextmenu` for a finger, and a cover has no ⋯); a result of the
  guide's search that is not on now opens the sheet on a phone, and the
  sheet takes the keyboard down; History's × takes a press of 40 px; a
  picker's list is placed in what a keyboard over a full window leaves
  in sight (`inSight` in `js/picker.js`); a portal's address typed into
  the playlist's field is still taken for a portal when Save is pressed
  with the field in the focus, which is how the app makes that press;
  the message strip stands above such a keyboard, and goes by itself
  after being touched; the topics' handle takes a finger's drag from a
  band of 24 px. Each has its test in `dev/playcheck.mjs` or
  `dev/unitcheck.mjs`; what a real finger and a real keyboard do with
  them is the device checklist's.
- **A dialog opened by a real tap ringed its cross**: the dialog takes
  the focus itself under a finger (`js/modal.js`, the dialog's own
  `autofocus`, which WebKit reads; seen with a real tap).
- **WebKit draws no ellipsis in a closed selector** and reads an option's
  `label` there: in a tight bar the sound's selector names the language
  alone ("English" for "English (AAC stereo)"; `js/app.js`, `fitNowbar`).
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
  and scrolls itself for the rest (`js/iosapp.js`); measured, the field
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
  the page shows (`Reminders.shows`). Seen with the system's own
  notifications in the simulators (`banner`): delivered with Settings
  open, not shown with the player in sight.
- **A notification within five seconds of its moment is not taken away
  by a changed list** (`Reminders.stale`). The page's timer and the
  notification are set for the same instant, and the page, in front,
  sends its list without the reminder as it says it. Measured with the
  system's notifier on iOS 26.5 (four of four, the list sent 1 to 3 ms
  after the moment): the notification had been delivered by then, with
  and without the rule, so the loss the rule guards against was not seen;
  a list sent 0.3 s before the moment does take the notification away
  without it, which is what `banner` holds. The margin on a device is
  not known.
- **An account's identifiers begin `reminder|<bytes of its key>|<key>|`**:
  a key is free text, and without the length the identifiers of an
  account whose key went on with a `|` began as another's did. No build
  with the older form (`reminder|<key>|`) has been given to anyone.
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
- **The sound goes on behind another app, by the page's doing.**
  `AppDelegate` sets the audio session's category to playback (movie
  playback) and does not activate it: WebKit runs a playback session of
  its own for a picture with sound, whatever the app's says (WebKit's
  `MediaSessionManagerCocoa`), so the ring switch does not silence a film,
  and an app that activated its own at launch would stop the viewer's
  music before anything plays. WebKit also publishes Now Playing from
  the page's Media Session (`js/playercontrols.js`: title, channel or
  series, artwork, next and previous, seeking where there is something to
  seek in), takes the lock screen's and Control Centre's commands, pauses
  for a call and when headphones are unplugged. WebKit pauses a picture
  that leaves the front, as it does every picture nobody sees unless it
  is in picture in picture or on AirPlay, and gives the page no reason.
  Measured in the simulators, an iPhone (native HLS) and an iPad
  (hls.js): the `pause` event comes 0.25 to 0.4 s before
  `visibilitychange`, while the page still counts as visible; `play()`
  from the page then starts the stream and it goes on behind the other
  app (still advancing after a quarter of a minute); and when the app
  comes back WebKit starts the picture by itself within 2 ms of the page
  being shown, also one that was paused meanwhile. So the page
  (`js/playercontrols.js`, the pure rule `pausedByLeaving` in
  `js/iosapp.js`) answers a pause within a second and a half of the page
  being hidden with `play()`, unless a press or a key ended in the half
  second before it (the viewer's own pause, or a link that took them to
  another app); a pause that comes later while hidden is the viewer's,
  from the lock screen or Control Centre, and WebKit's start in front
  after it is undone. A muted picture stays paused. This is what
  App Store guideline 2.5.4 asks of the `audio` mode: a reviewer plays a
  channel, goes home and listens. An app with no sound playing is
  suspended on a device, and whether WebKit's session is still the
  system's to keep alive in the moment between its pause and the page's
  `play()` is not known: the device checklist's.
- **Picture in picture is WebKit's, from the menu and from its own
  controls' mark.** `allowsPictureInPictureMediaPlayback` is on; on the
  iPad simulator `document.pictureInPictureEnabled` is true, the menu's
  item (`#btn-pip`, shown when WebKit says the playing source can)
  takes a channel played through hls.js out with
  `requestPictureInPicture()`, the picture plays on over Settings with
  the page counted as visible, and `exitPictureInPicture()` brings it
  back playing. A picture taken out while the app is in full screen left
  WebKit's note ("This video is playing in picture in picture") over the
  whole screen: the page leaves the app's full screen on WebKit's
  `webkitpresentationmodechanged` (`js/playercontrols.js`). An iPhone
  simulator has no picture in picture (`pictureInPictureEnabled` false,
  `webkitSupportsPresentationMode` false) and the menu leaves the item
  out; on a device the item's handler falls back to
  `webkitSetPresentationMode` if the standard call is refused. No
  picture goes out by itself when the app leaves the front: that is
  `AVPlayerViewController`'s, not an inline picture's in a web view.
- **`UIBackgroundModes: audio` is declared for those two**: the sound
  that goes on, and picture in picture, of which Apple's "Configuring
  your app for media playback" asks it. A simulator does not show what
  the key adds (see `background` above). The rule is hard: if the device
  checklist's lines on sound behind another app fail, the key leaves
  `project.yml` and its paragraph leaves the review notes
  (`store/appstore.txt`) before anything is submitted.
- **A web content process that ends again within a minute of its reload
  is reloaded after a wait**, 2 s and then twice as long each time up to a
  minute (`PlayerViewController.recover`): a page whose own start ends the
  process would otherwise be started without pause. The first reload is
  at once, as `kill` holds. No page that dies at its start was there to
  try it with.
- **The app's own player is a view in the web view's scroll view**
  (`App/Player`, `js/nativeplayer.js`; an experiment on the
  `native-player` branch). Laid there, over the page's content, it moves
  with the page by itself, and the page says only where the picture's box
  is. Measured in the simulators (an iPad (A16) and an iPhone 17, iOS
  26.5): the box said by the page and the view's frame agree to the
  point, upright, lying down and in the app's full screen, which is
  still the page's to lay out.
- **The page's box may end between two pixels**, 376.875 points high on
  the iPad: the row the view half covered showed as a hairline across a
  dialog cut out of it. The frame is rounded to whole pixels and a hole
  is cut half a point wider than the page said.
- **What of the page lies over the picture is cut out of the view**, by a
  mask, and `hitTest` leaves a touch there to the page: the `☰` menu, a
  dialog and a toast show over the picture. The glass of the controls
  (`UIGlassEffect`) is cut with the rest. A menu's box is its own, not
  that of the bar it hangs from: asked for the outermost element that
  does not hold the picture, the page named the bar, which lies beside
  the picture, and the menu's top stayed under it.
- **AVPlayer needs `NSAllowsArbitraryLoadsForMedia`** for a provider's
  plain http, as the web view needs `NSAllowsArbitraryLoadsInWebContent`;
  the two stand side by side in `project.yml` and in the review notes.
- **An MP4's second sound track and second subtitle are not offered**
  when the file does not mark them as alternatives of one another
  (ffmpeg's default does not): AVFoundation then makes a group of one.
  An HLS playlist's renditions are offered whole: of two sound tracks
  and two subtitle tracks, with Finnish kept for both, the Finnish ones
  were chosen.
- **AVPlayer draws a subtitle at the picture's foot**, under the bar
  with the time line. The text is taken with `AVPlayerItemLegibleOutput`
  (`suppressesPlayerRendering`) and drawn by the view, above the bar
  while the controls show.
- **A script cannot touch the view**: the simulator takes no tap from
  `simctl`, so the controls are driven by the page's words
  (`player.pause`, `player.seek`), and a finger on them, the track menu
  opened, AirPlay, picture in picture, the lock screen and a Chromecast
  from the view's button are the device checklist's.
