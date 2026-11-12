# Kepuli-TV – IPTV Player

A free, open-source IPTV player for Chrome and Firefox. Bring your own Xtream
Codes account, M3U playlist or Stalker portal, and watch live TV, films and
series in a browser tab. There is no app to install and no account with us,
and your details stay in your browser.

| Browser | Install |
| --- | --- |
| Google Chrome 116 or newer | [Chrome Web Store](https://chromewebstore.google.com/detail/kepuli-tv/okkgclcakhjhldkdcblgagoaibghpfmi) |
| Mozilla Firefox 130 or newer | [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/kepuli-tv/) |
| Android: Firefox for Android 142 or newer | [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/kepuli-tv/), see [On a phone or a tablet](#on-a-phone-or-a-tablet) |
| iPhone (iOS): Orion | Orion's own extension list, see [On a phone or a tablet](#on-a-phone-or-a-tablet) |

**[Watch the four-minute tour on YouTube](https://youtu.be/Wr4FcXlTbOM)**

## Key features

- **Live TV** by country and topic, with what is on now, an interactive
  programme guide, catch-up and programme search
- **Films and series** as covers or a list, filtered by category and length,
  with the plot, rating, director, cast, titles alike and the file's format,
  and whether it plays in your browser; films marked watched, playback
  resumes where you stopped, and the next episode follows
- **A start page** with what you left halfway, what is on your channels now and
  soon, and the channels you watched lately
- **MKV in the browser**, seeking included, with subtitles in the size and style
  you choose and every audio track, AC-3, E-AC-3 and DTS too
- **Recording** of the channel you watch, or a programme planned from the guide,
  kept in the browser and saved as a file when you like
- **Favourites** everywhere, personal channel lists, and only the countries and
  categories you choose
- **Several accounts** side by side, and sync between computers through the
  browser's own sync, off until you turn it on
- **Chromecast**, picture-in-picture, and a hand-off to VLC or another player
- **Made for the keyboard**, in thirty languages, dark or light

## Getting started

1. Install Kepuli-TV from your browser's store and click its toolbar icon.
2. Paste your provider's M3U address (or choose the playlist as a file), or
   enter the Xtream Codes server, user name and password, or a Stalker portal
   with the MAC address registered to your subscription.
3. Pick a country and a channel. Press `?` for the keyboard shortcuts.

Kepuli-TV contains no channels or content: you need your own subscription.

## On a phone or a tablet

Kepuli-TV also runs on Android and on the iPhone, in a browser that takes
Firefox add-ons. Chrome for Android and Safari do not install extensions, so
it is one of these two:

**Android: Firefox**

1. Install [Firefox](https://play.google.com/store/apps/details?id=org.mozilla.firefox)
   (142 or newer) from the Play Store.
2. Open [Kepuli-TV on Firefox Add-ons](https://addons.mozilla.org/firefox/addon/kepuli-tv/)
   in it and tap **Add to Firefox**, or choose **Extensions** in Firefox's
   menu and search for Kepuli-TV there.
3. Open Firefox's menu, choose **Extensions** and then **Kepuli-TV**: the
   player opens in a tab.

**iPhone (iOS): Orion**

1. Install [Orion Browser by Kagi](https://apps.apple.com/app/orion-browser-by-kagi/id1484498200)
   from the App Store. It installs Firefox add-ons, which Safari and the
   other browsers on iOS do not.
2. In Orion's menu choose **Extensions**, then **+** and **Install Firefox
   extension**, search for Kepuli-TV and install it.
3. Choose **Kepuli-TV** in Orion's menu to open the player.

From there it is as on a computer: add your account as in
[Getting started](#getting-started), and the lists, the programme guide and
the player fit themselves to the screen. What differs on a phone:

- **Full screen** is the button in the header on Android, and the iPhone's
  own video player on the iPhone.
- **Open in VLC** in the player's menu hands the stream to the VLC app; if
  VLC is not installed, its store page opens.
- **Chromecast** is not offered on the iPhone, where no browser reaches one;
  AirPlay is in the iPhone's own player controls in full screen. On Android,
  VLC can send the stream on to a Chromecast.
- **On the iPhone** a live channel may wait for a tap on **Play** before it
  starts, as iOS allows sound only after a touch.

## User guide

The [user guide](https://github.com/BigTimeSam/kepuli-tv/blob/main/docs/user-guide.md)
covers everything in detail: accounts, Stalker portals, recording, sync, the
programme guide, the keys, the settings and what to do when something goes
wrong.

Found a bug? Open a [GitHub issue](https://github.com/BigTimeSam/kepuli-tv/issues)
with your browser and the steps that lead to it. Leave out your credentials and
any stream address that contains them.

## Intended use

Kepuli-TV is only a player. It comes with no channels, playlists or media,
does not host or link to any, and plays nothing until you add an account or a
playlist from your own provider. Use it only for content you have the right to
watch, such as your own subscription, and keep recordings for your own use.
The author does not sell, provide or recommend IPTV subscriptions or
providers, and GitHub issues asking for them are closed.

Your credentials are kept in the browser's own storage on your computer, and
reach other computers only if you turn on sync and include passwords. See the
[privacy policy](https://bigtimesam.github.io/kepuli-tv/privacy/) and the
[terms of use](https://bigtimesam.github.io/kepuli-tv/terms/).

## Development

There is no build step: the files are what the browser runs. To try a change:

- **Chrome:** `chrome://extensions` → **Developer mode** → **Load unpacked** →
  this folder, or `node dev/dev.mjs` for a profile of its own that reloads on
  every change
- **Firefox:** `node firefox/build.mjs`, then `about:debugging` → **This
  Firefox** → **Load Temporary Add-on** → `firefox/dist/manifest.json`
- **Tests:** `node dev/unitcheck.mjs`, and `node dev/playcheck.mjs` against the
  mock server in `dev/mock/` (run `sh dev/mock/media.sh` once first); every
  check is listed in `dev/AGENTS.md`

More in [Developing Kepuli-TV](https://github.com/BigTimeSam/kepuli-tv/blob/main/docs/development.md)
(structure, languages, screenshots, publishing) and
[How Kepuli-TV works](https://github.com/BigTimeSam/kepuli-tv/blob/main/docs/internals.md)
(data, categories, playback routes, connection modes), with `FIREFOX.md` and
`CHROMECAST.md` beside them. Coding agents start from `AGENTS.md`, and each
directory has its own.

## Licence

The project's own code is MIT licensed, see [LICENSE](LICENSE). The `vendor/`
directory holds third-party code on its own terms: `hls.js` and `mpegts.js`
under Apache-2.0, and `vendor/ffaudio/` built from FFmpeg under LGPL-2.1+. The
build commands are in `dev/wasm/build.sh`, so that the relinking required by
LGPL 2.1 §6 is possible.

Copyright (c) 2026 Samuli Vainio
