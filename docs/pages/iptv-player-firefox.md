---
title: IPTV player for Firefox, a free add-on | Kepuli-TV
description: Kepuli-TV is a free, open-source IPTV add-on for Mozilla Firefox. Play your own M3U playlist, Xtream Codes account or Stalker portal in a tab, with a programme guide.
shot: 02-guide
alt: The programme guide of Kepuli-TV in Firefox, with the channel playing in the corner
stores: firefox,chrome
order: 2
---

# IPTV player for Firefox

Kepuli-TV is an add-on for Mozilla Firefox 130 or newer that plays your own
IPTV subscription in a tab: live channels with a programme guide, films and
series. The same add-on runs in [Firefox for Android](/iptv-player-android/)
and, through Orion, on the [iPhone](/iptv-player-iphone/). It is free and
open source, and it comes with no channels of its own.

## Install it in Firefox

1. Open Kepuli-TV on Firefox Add-ons with the button above and choose **Add
   to Firefox**.
2. Click the Kepuli-TV icon in the toolbar. If it is not there, it is under
   the puzzle piece, where it can be pinned to the toolbar.
3. The player opens in a tab of its own and asks for your provider's
   details.

## Connect your subscription

Paste the address your provider sent you. The form works out which kind it
is: an [M3U playlist](/m3u-playlist-player/), an
[Xtream Codes account](/xtream-codes-player/) or a
[Stalker portal](/stalker-portal-player/). Firefox then asks whether
Kepuli-TV may reach that server: choose **Allow**, which covers that server
only. Nothing is sent anywhere before that.

## How it plays in Firefox

- **MKV files** are unpacked in the tab and play with seeking. Firefox has
  no decoder for AC-3, E-AC-3 or DTS sound, so the player brings its own:
  see [MKV in the browser](/mkv-player-browser/).
- **Logos and covers** that a provider serves over plain http are shown
  in Firefox too.
- **Sync between computers** goes through Firefox's own sync, and is off
  until you turn it on.
- **Chromecast** is not offered: Firefox has no way to reach one. The
  player's menu hands the stream to VLC or another player instead.

## Good to know

- The [programme guide](/iptv-epg-guide/), catch-up, recording and the
  thirty languages are the same as in Chrome.
- Everything else is in the [user guide](https://github.com/BigTimeSam/kepuli-tv/blob/main/docs/user-guide.md).
