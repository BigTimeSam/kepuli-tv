# Kepuli-TV user guide

How to use the player: connecting, browsing, playback, recording, the guide, the keys and the settings. Back to the [README](../README.md).

See [Keyboard shortcuts](#keyboard-shortcuts) for quick controls, including
switching audio tracks, pausing playback and entering full screen.

## Getting started

1. Open the player using the Kepuli-TV icon in your browser toolbar.
2. Paste the address your provider sent into **Subscription or playlist
   address**, where the form starts (**Playlist address (M3U)**, with the
   caret in it). It fills in the form it belongs to: an address with a user
   name and password in it (`get.php?username=…&password=…`, or the guide's
   `xmltv.php?…`) the server, port, user name and password under **Server and credentials (Xtream Codes)**, a portal's
   address (ending in `/c/`) **Stalker portal (MAC address)**, which then asks
   for the MAC address, and any other web address stays as the playlist's.
   Or choose one of the three yourself
   and fill it in by hand. You need your own subscription: the app does not
   include channels or content. The dialog says as much on a first run and
   links to these steps; the eye at the end of the password field shows what
   was typed — a provider's password is long, random and entered by hand
   exactly once. **Name** comes before the fields that connect; the fields
   that must be filled in have a * after their name.
3. Press **Connect**. Unless the browser already allows that server, the
   dialog says beforehand that the browser will now ask to let Kepuli-TV
   reach it: choose **Allow**, which covers that server only. Refused, the dialog says so and that pressing **Connect**
   again brings the question back. You can change your connection details
   and the interface language later in **Settings**.

Closed before a connection, the dialog leaves the welcome in the player with
a **Connect to your provider** button, and the list says **Not connected yet**
with the same button; the programme guide's button appears once there is a
connection to show a guide for.

## Several accounts

**Settings → Connection** lists every account added, the one in use marked,
above the form: a click on an account shows its details in the form, and saving
changes it without switching to it. **Add account** puts a new row in the list
with an empty form under it — an Xtream server or an M3U playlist, with a name
of your choosing — and saving connects to it; **Cancel** in its row takes it
away again. An Xtream server needs its server, user name and password; a
playlist that needs no sign-in, such as a free one, goes under **Playlist
address (M3U)**. A new account's form starts on **Playlist address (M3U)**,
as the first run does. Once there are two, **Switch** in another account's
row switches to it. Each account keeps its own favourites, history, resume points,
reminders and channel lists, and its own catalogue in the cache, so switching
back is quick. **Remove** takes an account and its lists away, after asking twice.

## Stalker portals

A provider that sells its service for MAG set-top boxes gives a **portal
address** (often ending in `/c/`) and registers a **MAC address** for the box;
there is no user name or password. Use only the MAC address registered to your
own subscription — another person's, or one from a shared list, may not be
used (see the [terms of use](https://bigtimesam.github.io/kepuli-tv/terms/)). **Stalker portal (MAC address)** in
**Settings → Connection** takes the two. The player then talks to the portal as
a MAG box does (`js/stalker.js`): the MAC address goes in a cookie and the
User-Agent names a MAG250, both set by a session rule of `declarativeNetRequest`
for the extension's own requests to the portal's host alone, since a page cannot set those headers itself; the
rule is gone when the browser closes. A stream's address is asked of the portal
when it is played, and asked again when a live stream reconnects, since a
portal's link is often good for one connection only. Channels, films, series and
the portal's own programme data are there; the portal's archive is not yet. A
Stalker account does not go to the other computers without **Include
passwords**, the MAC address being as good as a password.

## Recording

Recording is off until it is turned on under **Settings › Playback › Enable
recording**. Turning it on first shows a reminder — record only programmes you
have the right to watch, for your own use, and never share recordings — and the
box stays ticked only when that is acknowledged with **I understand, turn it
on**; Cancel leaves it off. Turned off again, the Record buttons go away, while
recordings already made stay listed under **Recordings** until deleted. See
the [terms of use](https://bigtimesam.github.io/kepuli-tv/terms/) for what may be
recorded.

**Record** beside the player's controls records the live channel on screen to
the end of the programme on now (with a few minutes over), or until it is
stopped when the guide does not know the programme. In the guide, **Record** on
a programme on now or later plans it, a minute before to three minutes after.
While a channel is recorded, the dot on its **Stop recording** button beats; a recording
under way that the button does not show (another channel, a film playing)
beats as a dot on `☰`. The recordings are listed under **Recordings** in the
player's `☰` menu, where each can be played, saved to the computer as a `.ts`
file (an `.mp4` for an fMP4 HLS channel) or deleted.

A recording is the stream as the provider sends it, written to the browser's own
storage (`js/recorder.js`, the origin private file system) in parts of a few
megabytes, so a closed tab keeps all but the last seconds. Nothing is
re-encoded. A recording of the channel being watched shares the player's
connection (`js/streamhub.js`): an account that allows one connection can
record what it shows, though not another channel at the same time — the player
says so. A dropped connection is opened again until the recording's end. As
with reminders, recordings are made while Kepuli-TV is open in a tab: a plan
whose time comes with no player open is marked missed, and closing the tab
mid-recording asks first.

## Sync between computers

**Settings → Account & data → Sync between computers** carries the accounts, the
settings, and each account's favourites, channel lists, reminders and the newest
of its history and resume points to every computer signed in to the same browser
account — Chrome's Google account or Firefox's account — through the browser's
own sync. Nothing goes to Kepuli-TV. It is off until it is turned on, and
passwords go only when **Include passwords** is ticked as well: without it, a
computer receives an Xtream account without its password and asks for it once.
A computer turning sync on for the first time joins its accounts and favourites
with the others' rather than replacing them.

## Where the player opens

The player returns to the view you left, by two routes that answer different
questions.

The address bar names where you are: `#/live/Finland/312` is **Channels →
Finland**, narrowed to a topic within it, and a series you have opened rides
along in it. The collections are named in words: `#/favorites?kind=category`
is the favourite categories, `#/history?kind=channel` the channels in the
history (an older `#/recent` address still opens the history). The channel
played last from the list is in it too: `#/live/Finland?channel=4321` opens
Finland standing on that channel, ready for `Enter`, without starting it by
itself, and a film the same way: `#/movie/Action?movie=5000` stands on the
film in its list. The programme guide is `#/guide`, followed by the group
and topic it shows (`#/guide/Finland`); a reload opens the guide again. It is written as each list settles, so reloading the page
comes back exactly there, episode list and all. The address is written over
the current history entry rather than added to it: stepping back is what the
breadcrumb above the list is for, and the browser's own back button stays a
way out of the player rather than a walk back through every topic you have
touched. The browser tab's title says the same path in words,
**Channels › Finland › Kids**, with whatever is playing in front of it, so
that a window of tabs tells you which one is the player and where it stands.
An address typed or pasted into the bar is a navigation like any other.

The tab, the group within it and the chosen topic are also remembered as each
list settles. That is the second route, and it is what opening the toolbar
icon after the player's tab has been closed comes back to.

Before there is anything to come back to — the first time an account's
channels open — the list starts at the country your browser points to when
the provider has it: the interface language you chose in **Settings**
first, then your browser's languages, a region the browser names before the
language's own country (Finnish opens Finland, Swedish Sweden, German for
Austria Austria, Swedish for Finland Finland). US and British
English say nothing about where you are, so with only those the list starts
at the provider's first country, as it does when the provider has none of
yours. Countries you have chosen with **Filter countries** start at the first
of them instead.

A search is a detour rather than a place: it stays out of the address, and
reloading while one is running returns to the group the search took over from,
which is where clearing the search would return anyway. Playback is not
resumed by the reload either — an address that started a stream by itself
would play something you did not ask for — but a film or episode keeps its own
playback position, offered when you open it again.

What the account no longer offers is not restored. A group, topic or series
the provider has renamed or removed, or one the channel-list editor now hides,
falls back to the list underneath it, and the address is rewritten from where
the player actually arrives.

## Channels, movies and series

- Choose **Channels**, **Movies** or **Series** in the top bar, then narrow
  the list using the categories on the left. The search field finds titles
  within the selected content type.
- Above the list, **Filter channels** holds a country's topics, and the
  films' and series' **Filter titles** their filters; both have **Show only
  favourites** at their foot. What is in force shows as chips under the
  fold, each with a × to take it away, and **Reset** after them; the
  choices are kept over a reload or a closed player until Reset or the
  logo, which starts afresh. Both are open the first time and fold away,
  and open or folded is remembered for each; folded or not, the heading
  says how many of how many are shown (**2 / 15**), with a dot after the
  name while a topic or a filter narrows the list. **Filter countries** at the foot of the sidebar (**Filter
  categories** on the films and the series) shows all of them, only the
  favourite ones (those you have starred), or the ones you tick in its
  list; a tick chooses that last mode by itself, and the list is kept when
  you switch to another. The button says which is on, such as
  **Countries: favourites** or **Countries: 3/12**. An account with twenty
  countries or more opens the dialog once by itself, at all countries, with
  the ones that match your browser's language ticked as a suggestion: a
  tick chooses them, **Save** keeps all. A filter typed in
  the sidebar or in the dialog that leaves nothing says so in the empty
  column.
- A search that finds nothing says so, with **Clear search** back to the
  list. When **Filter countries** (or **Filter categories**) leaves some
  out, it also says how many were searched, such as **Countries searched:
  3/12**, with **Search all**, which runs the same search over every
  country; the next search keeps to the filter again.
- Click a channel or movie to start playback. For a series, choose a season
  and then an episode. **Back** restores the parent list's scroll position,
  selected item and search, including when the series is inside a favourite category.
- On a series' page each episode shows its own title and its code
  (S01E03) beside it. A provider that names every episode "Series name –
  S01E03" does not get the series' name repeated on every row: where an
  episode has no title of its own, the row says **Episode 3**.
- Above the picture a channel's logo stands before its name, the one its row
  shows (a television mark where the provider has none); a film, an episode
  or a recording has its name alone. A channel's logo is looked for first in
  tv-logos, a public collection on GitHub, because many providers' logo
  addresses lead nowhere; GitHub then sees which logo files are loaded (see
  the privacy policy).
- Every list has the marks for its order at its foot, and the choice is
  remembered: the
  channels by name or by the provider's channel number (#); the favourites
  by name or the latest added first (a clock); the movies and the series by
  name, by release year (a calendar), by rating (a star) or what the
  provider added lately first (a clock); the history the latest watched
  first (a clock turning back) or by name. The name mark shows an A for A–Z;
  pressed again it turns the list round to Z–A and shows a Z, and the year
  mark turns from the newest to the oldest the same way. A favourite
  category has the order of its own type at its foot. A search keeps the
  order of its hits. The history by name is headed by type, as the
  favourites are, rather than by day.
- Movies and series show as covers, as many across as the column has room
  for; the two marks at the foot of the list switch between covers and a
  list, and the choice is remembered. Among covers the arrows move left,
  right and a line up or down. A title the provider lists more than once
  (each language it has, a 4K copy) is one cover, the first; its other
  copies are under **Other versions** on its own page. A film you have seen to the
  end carries a ✓ in its top corner, and one the provider added in the last
  two weeks **New**. The list's rows say the same as badges.
- Movie and series filters let you narrow titles by release year or rating
  (their order is the list's foot's, and **Reset** leaves it); films also by **Duration**, two handles from
  the shortest to the longest film whose length is known, the list cut when a
  handle is let go. Many providers give a film's length only with its
  details, one request a film, read as its row comes on screen: while a
  range is set, a film whose length is not known yet stays at the end of
  the list marked *length unknown*, and drops out once its length is read
  and does not fit; a spinner beside the count turns while lengths are
  being read. A range keeps the scale it was chosen on in another
  category. **Duration** is there in a category only: under **All**, or a
  search of the whole catalogue, the slider is hidden and a range set
  before waits for the next category. Filters use the available metadata, so some
  titles may be missing particular details. Active filters remain visible as
  removable chips even when the filter form is collapsed.
- **Programme guide**, above the channel list on the **Channels** tab, opens
  the TV programme guide. Catch-up playback is available
  when your provider supports recordings for that channel.
- The star button adds an item to **Favourites**. With a mouse, an empty star
  shows on the row under the pointer or the keyboard cursor; favourites keep
  theirs, and a touch screen or a system asking for more contrast shows every
  star. **History** lists the
  channels, movies and episodes you have recently started. Each account keeps
  up to 60 entries; older entries are removed as new ones are added.

At 600px wide or less, browsing and playback each use the full window width.
Starting playback opens **Player**; **Browse** returns to the list while the
stream continues. Starting a search or choosing a content tab also opens the list.
There the programme guide's days have a row of their own, scrolling sideways,
and its programme search shows the field and its button alone until the field
is used, when the two choices that narrow the search come in under it.
**Settings** keeps its sections at the top, above **Save**.

## Closing dialogs and cancelling loading

Settings, the channel-list editor and enlarged covers use the same dialog
style, with an **X** close button at the top right. You can also press **Esc**
or click outside the dialog. Player keyboard shortcuts are inactive while a
dialog is open.

- In **Settings**, X, Esc and clicking outside ask before discarding unsaved
  changes. **Cancel** discards the draft; **Save** applies it.
- In **Filter countries**, X, Esc, clicking outside and **Cancel** leave the
  choice as it was; **Save** applies it.
- Enlarged covers close immediately without changing playback.

Loading a list is not a dialog at all. It used to be one, over everything, and
that meant typing three letters into the search box — a search needs the whole
list of its type — stopped the volume, the subtitle selector and full screen
until it was over. It is a strip at the top of the list column instead, saying
what is being fetched, how far it has come when the total is known, and
carrying its own **Cancel**; **Esc** cancels it from wherever the focus is.
Everything else keeps working while it runs, the picture included, and an
interrupted channel-list load restores the previous list.

## Playback and cover images

- Click the picture of a film or an episode to pause it, and again to play
  on. A double click goes to full screen without pausing. On a live channel
  a click does nothing in Chrome; Firefox's own controls keep the click to
  themselves, and pause live channels too. Both are the browser's own
  controls doing it.
- Below the player a film or an episode shows its year, genre, rating and
  length, for an episode the series' own, followed by the file's format,
  picture, sound and subtitles. A part with nothing to show is left out.
- Use the selectors below the player to choose audio and subtitles when
  the file offers selectable tracks. Set your preferred languages and
  subtitle appearance in **Settings**.
- Loading indicators appear in the video, audio and subtitle fields while
  the player reads the file's metadata.
- Click a cover image in the series details or below the player to enlarge
  it. Close the image with the close button, by clicking outside it or by
  pressing Esc.
- If playback fails in the browser, copy the address with the **URL** button
  and open it in a player such as VLC. The address contains your username
  and password, so do not paste it anywhere others can see it. The external
  player button can also hand playback directly to the player selected in
  your settings.

## If something goes wrong

- **Refresh lists** (the circular arrow in the top bar) fetches the content
  lists again from the server, including the countries and categories
  already opened, and shows the new list where you were. A tab left open
  checks by itself when you come back to it, once its lists are older than
  the cache keeps them.
- If the connection fails, the message under **Connection failed** says
  whose side the fault is likely on and what to try: the address and the
  port, the user name and password (copied rather than typed), the
  provider's server being down or overloaded, or the account itself. When
  the browser has not allowed Kepuli-TV to reach the server, it says that
  too, and **Allow access** comes first among the buttons.
- When a stream does not start, the message names the controls as they read
  on screen: **Playback mode: Automatic** under the picture can be set to **TS** or **HLS**, and
  the ☰ menu opens the stream in an external player. When the account turns
  out to be the reason (run out, shut, or every connection in use), the
  message says that instead, since another try or format would not help.
- A playlist address that
  answers with a web page or an error message rather than a playlist — a
  login page, an expired-account notice — says **The address did not return
  an M3U playlist.** instead of showing the page's lines as channels; a
  plain list of full `http://` or `https://` stream addresses with no
  `#EXTM3U` line is still read (addresses relative to the playlist's own
  need the `#EXTM3U` line).
- If cached information is outdated, clear the cache in Settings. Resetting
  everything also removes your saved connection details.
- Report app bugs in [GitHub Issues](https://github.com/BigTimeSam/kepuli-tv/issues).
  Include your browser, a description of the problem and steps to reproduce
  it. Do not include credentials or playback URLs containing them.

## Everything it does

- **Programme data** for visible channels: the programme on air and a progress
  bar on the list row, a description and the next programme below the player
- **An interactive programme guide** (`g`): channels as rows, time on the
  horizontal axis and a moving now line — see below; **Favourites** in its bar
  shows the favourite channels alone, from every group, and stays on for the
  next opening
- **Catch-up** for channels that have an archive: a past programme can be
  started straight from the guide; an ongoing programme offers **Start from
  beginning** when the channel advertises an archive
- **Programme search** by title and description, with a choice of shown or all
  visible channels and past/upcoming programmes
- **Personal channel lists**: hide and reorder live channels and categories
- **An empty player** offers what was left halfway, as covers, and the
  channels watched lately, as logos — each a click from playing
- **On your channels now and soon** on the empty player's page: what is on now and in the
  next hours on the favourite and recently watched channels, a programme
  watched before first, each with the reason it was picked; one on now starts
  with a click, a later one sets its reminder (`js/picks.js`). What was
  watched is learnt from the programmes watched for five minutes or more, kept
  per account in this browser, and synced with the other lists when sync is on
- **Series** by season, with cover art and plots from TMDB
- **Movie details**: plot, running time, rating, codec
- **MKV plays** without an external player: the container is unpacked on the
  fly into fMP4, seeking included, and an AC-3, E-AC-3 or DTS track is
  decoded in the player — in Firefox too, and in Firefox for Android, which
  has no audio encoder of its own and gets the player's. For the few tracks
  that are not decoded, **Play without sound** is on offer
- **Subtitles** from MKV files, drawn by the player in a look of your choosing
  — shadow, outline, yellow, box or high contrast, at a size of your choosing
  — and the chosen language carries over to the following episodes — see below
- **Unplayable files are marked in the list** before you click; once a file has
  been examined the mark sharpens according to its codecs
- **Hand-off to an external player** (the player's `☰` menu or `x`) for what the
  browser cannot do: a one-item `.m3u` file is saved, and the system opens it
  in the player registered for playlists, VLC for one. The file holds the
  stream address with your user name and password, so keep it as you keep
  the password
- **Chromecast** (the same menu or `c`): a natively played file goes to the
  device through the Remote Playback API, and for the rest the menu explains how
  Chrome's own tab casting does it — see below
- **Resume positions remembered** for movies and episodes, with a progress bar
  on the row; what was left halfway heads the history under **Continue
  watching**
- **The next episode** after a ten-second countdown when one ends, with **Play
  now** and **Cancel** over the picture; a switch under **Playback** turns it off
- **The previous channel** with `l`, as a television's own button has it
- **Programme reminders** from the guide: a minute before the programme starts,
  a message names it with **Watch** — while the player is open
- **Media keys** and the system's media controls: the programme and channel,
  or the title and series, are named there, next and previous step as `n` and
  `p` do, and the seek keys move a film or a recording
- **Updates offered** rather than held back silently: the browser does not
  take an update while the player is open, so the player says one is ready
  and takes it on request, reopening where it was. The foot of **Help** names
  the version running, with the update's button when one is waiting
- **Favourites** and **history** as tabs of their own — a whole category can be
  a favourite too, see below. The favourites are in alphabetical order to
  begin with and the history the latest first; the marks at the foot of
  either list choose another order, and the choice is remembered
- **Thirty languages**, switched in the settings without a page reload
- **M3U playlists and XMLTV guides** as well as Xtream servers: a playlist's
  channels, films and series, its programme guide and catch-up — see
  [Connection mode](internals.md#connection-mode)
- **Stalker portals** by portal address and MAC address, as a MAG box sees
  them — see [Stalker portals](#stalker-portals)
- **Recording** a live channel now or a programme from the guide, to the
  browser's own storage, played back or saved as a file — see
  [Recording](#recording)
- **Several accounts**, switched in Settings › Connection, each with its own lists
- **Sync between computers** through the browser's own sync, off until asked for
- **A one-question form when the extension is removed** (`runtime.setUninstallURL` in
  `background.js`): why the viewer left, one click and Submit, on Google Forms. The
  address carries only the version, the browser and the interface language, pre-filled
- **Automatic reconnection** when a live stream drops — the death of a source
  is recognised in three ways: the server cuts the connection, the buffer is
  played out, or the picture freezes while the connection stays open. The
  viewer's own pause is told apart from these and is never overridden
- **Technical details** over the picture — resolution, bit rate, engine — for
  working out why a stream stutters. Off unless the settings ask for them: they
  answer no question about what to watch

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `/` | go to the search box |
| `Tab` | move between the areas of the page; the arrows move inside the sidebar, the tabs, the topics and the list |
| `↑` `↓` `PgUp` `PgDn` | move in the list; on a strip of tiles (the related titles under the picture, the empty player's cards) the arrows, `Home` and `End` move between its tiles instead |
| `Enter` | play / open a series |
| `Backspace` | back to the series list |
| `space` | pause (a click on the picture of a film or an episode does the same) |
| `f` | full screen |
| `m` | mute |
| `a` | the next audio track, when the file has more than one |
| `s` | star what the cursor is on — a list row, or the sidebar row, topic chip or tile the keyboard stands on |
| `+` `−` | subtitles larger or smaller, by ten per cent of the size the picture asks for |
| `Shift`+`F10` | the menu of the channel the list stands on: a favourite or not, or hide it; the context-menu key does the same |
| `Delete` | drop the history row the cursor is on; on a **Continue watching** card, forget that card |
| `n` `p` | next / previous; from a list that does not hold the episode, `n` plays the series' next one |
| `l` | the previous channel; from a film or a recording, the last channel |
| `g` | open and close the programme guide |
| `x` | hand over to an external player, after a confirmation over the picture |
| `c` | cast to a Chromecast |

These are the bare keys: a key held down with Ctrl, Cmd or Alt is left to the
browser, so `Cmd+F` and `Ctrl+F` open its search box rather than taking the
picture to full screen.

`?` opens the same list inside the player, along with the guide's own keys and
a note on why the browser's back button leaves the player rather than stepping
back inside it. **Help** in the top bar opens it too.

The interface is sized in `rem`, so it follows the reader's own font setting
in the browser rather than ignoring it. That takes the row heights with it:
the lists are virtualised, which means something has to divide by a row's
height, and that number is now asked of the browser rather than written down —
`cssPixels` and `watchLength` in `js/vlist.js` measure it and measure it again
when the setting moves under a running page. Measured, a 24px root gives 75px
rows and text to match, with the virtualisation still landing every row where
it belongs. A system asking for more contrast is answered too: the borders
that separate one panel from the next go to 3.7:1 and the muted text to
9.8:1. Every control the keyboard reaches shows the same focus ring, 2px in
the accent's text colour, at 3:1 or more against what lies around it in both
themes. Under Windows' forced colours (High Contrast) the chosen tab, group,
topic and day, the list's cursor and the playing row are drawn as outlines and
edges in the system's highlight colour, which the system keeps where it
replaces backgrounds; so are the order and list-or-covers marks, the guide
search's results and the related covers under the mouse or the keyboard, and
the covers' ✓ and **New** keep a border of their own. The stars, the row's ⋯ and the topic chips answer a tap
anywhere in a 24px square around them; on a touch screen the row's buttons are
32px and the chips 2rem high.

The first Tab stop on the page is **Skip to the list**, which appears at the
top left when the keyboard reaches it and takes the focus straight to the
list. Tab reaches the places that hold a cursor of their own, one stop each:
the tab strip, the sidebar, the topic chips and the list; inside the topic
chips the left and right arrows move between them and `Home` and `End` reach
the ends, and `Enter` or `space` chooses one. Help lists the Tab key too.
For a screen reader the page has headings (Kepuli-TV, the list's tab and
group, the player), the player is a named region, and the overlay's title is
said together with the sentence under it, so "Connection failed" or
"Playback failed" is heard and not only what follows it. Inside the strip the arrows move
between **Channels**, **Movies**, **Series**, **Favourites** and **History**,
and `Home` and `End` reach its ends; the panel below takes its name from
whichever is chosen. Inside the sidebar the arrows move a cursor down the
countries or topics, `Home` and `End` reach its ends, and `Enter` or `space`
chooses the row the cursor is on — the row being marked as the cursor's, which
is a different thing from the group being shown. Both are listboxes, as the
list itself already was, so a screen reader is told what the eye can see: which
row is selected and which one the keyboard stands on. A row is named by what it
shows — the name, then "Favourites" when it is one, then the line under it —
rather than by the star in it, and the row playing is announced as the current
one. In **Settings** the connection choices are one named group, and the
password field is named **Password** alone.

In the guide the arrows move between channels and programmes, `PgUp` and
`PgDn` a screen at a time, `Home` returns to the present, `+` and `−` adjust
the timeline's scale, `Enter` starts playback and `Esc` closes. The guide's
search results take the same keys: `↓` from the search field into them, the
arrows and `PgUp`/`PgDn`, `Home` and `End` through them, and `Enter` does
what it does in the grid. The first `Esc` clears the search and returns to
the grid, the next closes the guide.

## The buttons

The top bar starts with the logo, which goes back to the start — the channels, the first country chosen, the top of its list — closing the search, the guide and any page opened from the list, and stops what is playing for the empty player's page: a film's place is kept under **Continue watching** and a channel heads **History**, each a click from playing again. Continue watching shows the ten films and series watched last — left halfway or seen to the end; a series seen to the end of its last episode goes on with the next — newest at the left, in one row that scrolls sideways — with the ‹ and › at its ends, the trackpad or the keyboard — a series as one card; the ✕ in a cover's corner, on hover, forgets where it was left and takes it out of the history — every episode of a series — and the heading goes with the last card. The ☆ in the other corner stars the film, or the series of an episode, as the lists do, and stays in sight on a favourite. **Settings › Viewing** turns each of the page's sections off: **On your channels now and soon**, **Continue watching** and **History**, all on to begin with. Then the five tabs, each with its mark before its name (the marks step aside between 600 and 1100 px, where they would push the buttons onto a second row), the search box, **Refresh lists** (a
circular arrow), **Help** (a question mark), the theme — a sun in the dark
theme switches to the light one and a moon in the light theme back — then
**Full screen** (four corners) and **Settings** at the far right. Full screen
takes the whole player out of the browser's address bar and tabs, and on a
phone or a tablet out of the system's bars too, for a quarter more height on
a tablet; the corners turn inward, and a press on them, `Esc` or Android's
back gesture returns. `f` still takes the picture alone full screen, and
leaving it returns to the player still full screen. Where the bar does not fit on one row
— a tablet held upright, a window at half a screen — Refresh, Help, the theme,
Full screen and Settings go behind a hamburger (☰) at its right end, the
search takes the room that is left, and the bar stays on one row. Whether it fits is measured,
so a language with longer tab names makes the switch at a wider window. The sun and moon is the quick switch; Settings > Viewing > Appearance starts on *Automatic*, named with the theme it comes to now (*Automatic (dark)*), which follows the operating system's light or dark mode while the player is open; a press of the switch picks the other of what is on screen and keeps it. The picture and the bar
under it stay dark in either, and the choice is kept with the settings and
copied to `localStorage`, so a light theme does not flash dark at start
(`js/theme.js`);
in a window 600px wide or less, Settings is a cog alone and the three share
the brand's row. **Refresh lists** fetches the categories and
the lists already loaded from the server again — the whole lists, and the
categories and groups opened this session, which used to stay as first
fetched until a reload — drops the series' episode lists, and empties the
programme cache; the list on screen is repainted in place. The same refresh
runs quietly, without the strip or the programme cache, when a tab is
shown again after its lists have outlived their cache time (categories a
day, lists six hours). **Help** opens this user guide. Full screen is the
browser's own button at the right end of its control bar, in Chrome and
Firefox alike: it takes the bare video full screen, where the browser draws the
subtitles itself, at the chosen height. `f` takes the picture full screen with
the player's own subtitle layer. Video statistics are at the top left. The
remaining player controls are below the picture:

| Button | Action |
| --- | --- |
| **Playback mode** `Automatic` `TS` `HLS` (a film frame) | the engine for a live channel; *Automatic* is described below (the name before the value where the bar has room) |
| the audio selector | the track, on a file that carries more than one; `a` steps to the next |
| the subtitle selector (a caption box) | the language, on a file that carries subtitles |
| `Aa` | the look and the size of the subtitles, over the picture they are judged against |
| `☰` | the menu of the rest, opened upward over the picture |

The menu holds what is wanted now and then rather than during every programme:
**Reload the stream** (from the point it stopped at, for a stream stuck without
an error), **Picture in picture**, **Cast to a Chromecast**, **Copy the stream
address** and **Open in an external player**. Buttons that said what they did in
two letters and an arrow are lines that say it in words, and the row keeps only
what a viewer reaches for while watching. After a failed playback the message
over the picture offers **Try again**, which also starts from where it stopped,
and an external player; neither where the provider has no file, and no Try again
for a sound track the browser cannot play, which would fail the same way. It opens upward — below the row is the
bottom of the window — and closes on the button again, a click outside, Esc or a
choice; the arrows, Home and End step through it. `x` and `c` still reach the
external player and the Chromecast without it. The hamburger turns gold while a
Chromecast is playing, as the `Cast` button used to.

There is no favourite star below the picture any more: every row in the list
carries its own, and a series page has one beside its title.

Series and movie details separate the year, genre, provider rating and episode
count or duration into labelled fields. **IMDb** opens the title directly when
its ID is available; otherwise **Search IMDb** uses its name and year. **Trailer**
appears only for a valid YouTube trailer. Links open in a new tab;
constructing them requires no external API calls or API keys.

While a film or an episode plays, its IMDb page (or an IMDb search) and its
trailer, where the provider names one, are in the player's ☰ menu. The director's and the cast's names search IMDb for
the person; the original title shows when the provider gives one that differs,
and the sound names its language when the file or the provider does
(**AAC (6 channels, Finnish)**). Under them, **Other versions** lists the other
copies of the same film, each named by what tells it apart (where it is
filed, such as **Spanish** or **Thriller**, and **MKV**, **4K**,
**Multi-Sub**; a copy nothing tells apart is left out), and **In the same series** its other parts
("Title: The Return", "Title 2"), from the whole catalogue when it has been
loaded and from the list on screen otherwise; a click plays one. The title above
the picture leaves out a year at the end of the name, which the facts give,
and the line under it names the group ("Nordic") rather than the provider's
category ("Movies: Nordic").

Movie rows show running time (for example, **1h 35 min**) instead of technical
format badges. Missing durations load for visible rows in a
category, with two detail requests at a time; under **All** only the
durations already known are shown, as reading them for the whole catalogue
would take a request a film. A film's details are kept for 90 days. If the provider supplies no duration, it is
omitted.

File format, video, audio and subtitles have separate labels in the playback
details. The subtitle summary names at most three languages — English and
Finnish first, then in alphabetical order — and counts the rest as **+ 2**. No
track count stands in front of them: a file holds more tracks than languages,
and the two numbers side by side only invited a subtraction that was never meant
to add up. Hovering reveals every language; individual tracks remain available in
the subtitle selector. A file whose subtitles are all bitmap tracks names no
language at all, and there the count stands instead, beside the warning.

Wherever a box holds more than it shows — a list, a long description, a
Settings panel, the help — a thin bar at its right edge says so and stays in
sight, also in Firefox on a tablet or a Mac, where the browser's own bar fades
away after a scroll and a box would otherwise look finished.

## Settings

Settings always opens on **Connection**, with five focused tabs:

| Section | Holds |
| --- | --- |
| **Connection** | the provider address and credentials, entered as Xtream Codes fields, an M3U address, or a Stalker portal and its MAC address |
| **Viewing** | in four groups: *Language and appearance* (interface language, dark, light or the system's, the clock), *Channels* (the countries, the international channels), *Start page* (its sections) and *Programme guide* (automatic programme data) |
| **Playback** | remembered playback positions, the next episode, the stream statistics over the picture and recording |
| **Subtitles** | style and size, with a local preview |
| **Account & data** | in three groups: *Subscription* (its details and the cache), *Sync between computers* and *Manage stored data* (cache clearing and reset) |

Changes on every tab remain drafts until **Save**. Switching tabs keeps the
draft; **Cancel** discards it. The cross, Escape and a backdrop click ask
before discarding unsaved changes. A slider drag released outside does not
close the dialog. The tabs support arrow keys, Home and End.

Saving preferences applies them without reconnecting. Only changed connection
credentials reconnect and reload the lists. A denied host permission or failed
storage write leaves the draft open for correction or retry. An existing M3U
connection does not require its address to be pasted again when saving viewing
preferences. Cache clearing and reset require a clean form and remain explicit
actions, with a separate confirmation for reset.

Before credentials exist, the tabs are hidden, the form starts on
**Playlist address (M3U)**, a line above the buttons says that the browser
will ask for access to the server next, and **Connect** saves the initial
connection. Otherwise the same **Save** action is available from every tab.

In **Subtitles**, the style and size controls sit above the preview. The
preview's frame stands in for the picture, so the sample is the same share of
its height as the subtitles will be of the film's; only a sample too wide for
a narrow dialog is scaled down to fit.

The look of the subtitles is also under the player's own **Aa** button, which
appears beside the subtitle selector on a file that carries subtitles. It
opens the same two controls over the picture, so the size is judged against
what is being watched rather than against a preview in a dialog; the
subtitles rise out of the popover's way while it is open, as they do for the
browser's controls. The Aa controls apply and save immediately; Settings previews
locally and applies the same stored setting only on Save. In
full screen neither is reachable, as neither was before.

The cache belongs to the server and the account. Saving a connection whose
server, port, protocol or username differs from the previous one empties it
first, so another server's listing — or another account's on the same server
— never shows under the new one. The password is not part of the comparison,
so correcting it costs nothing.

Rows whose time is up are deleted a little after the player starts:
categories after a day, whole lists after six hours, a series' episodes after
a day, a film's details after a week, a file's header after 90 days. The rows
are indexed by the time they were written, so finding the old ones reads no
list's contents.

A favourite and a history entry are copies made when they were saved. When
the library has the same title in memory — a list or category loaded, a
series' episodes read — playback takes the container, guide id and catch-up
window from there, and the stored copy is brought up to date, so that a
provider re-encoding a film from `.mkv` to `.mp4` does not break it in the
favourites or Continue watching.

## The programme guide

The guide is a grid with a column beside it: the programme's own details on
top of that column and the picture below them, and the grid taking the whole
height to their left.

It used to be three bands — details and picture side by side across the top,
then the controls, then the grid in what was left. The top band was
`minmax(240px, 30vh)`, a fixed share of the window whatever happened to be in
it, so a 900px-tall window spent 270px on 105px of details and a picture that
wanted 194. The grid, which is the reason anyone opens the guide, got the
remainder. Measured against the mock server, visible channel rows:

| Window | Three bands | Sized to content | Column beside the grid |
| --- | --- | --- | --- |
| 1024×800 | 4.6 | 4.8 | **9.1** |
| 1280×800 | 6.6 | 6.9 | **11.7** |
| 1440×900 | 8.1 | 8.6 | **13.8** |

The picture keeps its own 16:9 shape rather than stretching to whatever height
a row hands it — a stretched picture is only letterboxing — and the details
above it take the slack instead, because a long description is the thing that
actually grows. The rule that shapes it excludes `:fullscreen`, or the ratio
would follow the picture there and letterbox it against the screen.

**Programme guide**, above the channel list on the **Channels** tab (or `g`),
turns the whole window into a grid view: channels as rows,
time on the horizontal axis and a moving now line. The video continues in the
top right corner and the selected programme shows on the left with its
description. The grid shows the same set of channels as the list, so the group
selection and the search narrow the guide as well. The star button beside the
group shows your favourite channels alone, from every country; it is
remembered from one opening to the next, also while no channel is starred,
when the guide says so in the grid's place: "No channel is a favourite yet:
star one in the list, and only the starred ones are shown." It is separate
from the favourite mode of **Filter countries**.
**Back to channels** at the top left returns to the channel list. You can
also close the guide with `Esc` or `g`.

A click on a channel's name, or on a programme on now in the grid or in the
programme search, plays the channel at once in the corner (unless it is
playing already, live or from its archive); a programme that has ended or is
still to come, in the grid as in the search, is only chosen, with
**Watch catch-up** or **Remind me** in the column, as the channel live
would show something else. The column shows the channel's name,
**Go to channel**, the programme with its description and, for a click on the
name, the next ten programmes with their times and titles. Walking the grid
with the arrow keys only shows; `Enter` plays. **Go to channel** closes the
guide and opens the channel's own country in the list, standing on the
channel, which carries on playing in the big player. The channels carry their names as
the list shows them, without the provider's running number.

The timeline runs back as far as the longest advertised channel archive in the
current view, with at least two days of history, and five days forward. Invalid
provider durations are bounded to one year. Past programmes are
dimmed; those the channel's archive reaches get a **Watch catch-up**
button. The day strip above the grid has buttons from yesterday on — today and
tomorrow are what the guide is opened for, and with a button for each day of
a week's archive they sat behind a scroll at the strip's far end — and the
archive's older days in an **Earlier** menu before them. A programme continuing past the left edge is marked with `‹` and its
name is nudged into view.

An upcoming programme offers **Remind me**, and pressing `Enter` on one offers
it in the message that says when it starts. A bell marks the programme in the
grid. A minute before it starts, a message names the programme and its
channel, with **Go to channel**. Reminders belong to the account and are kept with
it, but they are said only while a player is open: one from a closed player
would need a background timer and the notifications permission, and Chrome
disables an extension on update until a new permission like that has been
accepted. A reminder that falls due in a hidden tab waits until the tab is
looked at again, for as long as the programme is still on.

**Start from the beginning** is offered for an ongoing programme on an archive
channel. Whether the provider makes that programme available before it ends
depends on the service; the archive may stop at its latest available moment.
**Back to live** returns to the channel. Catch-up playback is finite: reaching
its end does not trigger the live reconnection loop. Reload and Retry keep the
archive programme selected. This is provider catch-up, not a local DVR buffer.

The guide's separate **Search programmes** form searches channel names,
programme titles and descriptions: every word must be in one of them, so
"Liiga 7" finds that channel's programmes and "Liiga 7 final" its final. It searches the shown channels by default; **All visible channels**
loads the full channel catalogue and excludes personal hidden channels and
categories. Only channels with programme identifiers can be searched. The
period selector includes upcoming programmes, past programmes or both.
Search is explicit rather than triggered by every keystroke, makes at most four
search requests in parallel, and reuses full programme tables in the guide cache.
That cache keeps the 200 most recently fetched full tables and programme data
for 5,000 channels at most, so a search of thousands of channels does not keep
every table it read. A search of all channels when more than 500 of them have
programme data asks first, with a **Search all** button, since each channel
costs its whole programme table.
Results appear as answers arrive, grouped by channel under its logo and
name (as the guide writes it, without a provider's "FI:"), each programme
with its day and time and the first line of its description, and **Now** on
one being shown. A channel shows its first three programmes and **Show
all** with the number for the rest, and its heading opens them all or folds
them back, so a short query that matches nearly everything still leaves each
channel a few rows. The line above them gives the number found and the channels
searched, and failed channels are counted separately. A search that finds
nothing says so in the results' place, with the query and **Clear search**,
and, when **Filter countries** leaves countries out, how many were searched
and **Search all**, which searches every visible channel of every country.
**Stop search** keeps partial results. Selecting a result
shows its description and live/catch-up actions, and `Enter` on one plays
its recording, offers a reminder or plays the channel, as in the grid; **Back to guide** restores the
grid. Closing the guide or changing channels' scope cancels the search.

Programme data is fetched at three levels of detail into the same cache: a list
row needs four programmes, looking ahead in the guide needs 40, and the whole
programme table is fetched only when the grid is scrolled past the known
programmes. A coarser level is never fetched over a finer one, so a channel
visited in the guide does not fall back to four programmes as the list is
browsed.
