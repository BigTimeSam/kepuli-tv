---
title: M3U playlist player in the browser, by address or file | Kepuli-TV
description: Play an M3U or M3U8 playlist in Chrome or Firefox with Kepuli-TV. Paste the playlist's address or choose the file, and get groups, logos, an XMLTV programme guide and catch-up.
shot: 01-channels
alt: Channels of a playlist grouped by country in Kepuli-TV, one of them playing
stores: chrome,firefox
order: 5
---

# M3U playlist player in the browser

Kepuli-TV plays an M3U playlist in a browser tab. Give it the playlist's
address or the file itself, and the channels, films and series in it appear
as lists you can search, filter and mark as favourites.

## Add a playlist by its address

1. Install Kepuli-TV and click its toolbar icon.
2. Paste the playlist's address into **Subscription or playlist address**.
   The form starts on **Playlist address (M3U)**.
3. Press **Connect**. The browser asks whether Kepuli-TV may reach that
   server: choose **Allow**, which covers that server only.

A playlist that needs no sign-in, such as a free one, goes in the same
field.

## Or choose the file

**Choose a file…** under the address takes a playlist you have on the
device: `.m3u`, `.m3u8` or gzipped. It is read into the browser when you
press **Connect**, and nothing is downloaded for it. To bring it up to date,
choose the file again in **Settings**: the account, its favourites and its
history stay.

## What is read from the playlist

- **Groups, logos and guide ids** of an `m3u_plus` list, so the channels
  come sorted by country and topic.
- **The programme guide**: the XMLTV address the playlist names in its
  header, or one you enter under **Programme guide address (XMLTV)**. See
  [the programme guide](/iptv-epg-guide/).
- **Catch-up**, where the playlist marks a channel's archive.
- **Films and series** in the same list, each under its own tab.
- **A plain list without groups** that marks its sections with heading rows
  ("===== Sweden =====") is grouped under those headings.

## When it does not work

- **The address did not return an M3U playlist.** means the server answered
  with a web page or an error instead: often a login page or a notice that
  the account has run out. Check the address with your provider.
- If the playlist comes from an Xtream Codes server, the player says so
  after it connects and offers **Connect as Xtream Codes**, which brings
  the server's categories, covers and guide. See
  [Xtream Codes](/xtream-codes-player/).

Several playlists can be kept side by side as accounts, each with its own
favourites and history. More in the [user guide](https://github.com/BigTimeSam/kepuli-tv/blob/main/docs/user-guide.md#several-accounts).
