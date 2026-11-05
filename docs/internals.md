# How Kepuli-TV works

The data, the categories, the playback routes and the connection modes, for anyone reading or changing the code. Back to the [README](../README.md).

## How the data is fetched

A large playlist is a poor starting point: the test server's `get.php` returns
75 megabytes and 272,000 lines, with no category identifiers and no information
about file formats. `player_api.php` gives the same thing structured and in
pieces, so the app loads in stages:

| Stage | What is fetched | Size | When |
| --- | --- | --- | --- |
| 1 | Categories (live + movies + series) | 43 kB | opening the connection |
| 2 | The chosen country's channels | 2–60 kB | on clicking a country |
| 3 | A type's whole list | 0.6–2.9 MB | only on search or the "All" selection |
| 4 | A series' episodes, a movie's details | 1–20 kB | series on opening; movies as their rows become visible |
| 5 | Programme data for a channel | 1.6 kB | for visible rows |
| 6 | A channel's whole programme table | 50–150 kB | browsing beyond known programmes or explicitly searching programmes |

Measured times on the test server: Albania (3 topics) 0.27 s, Sweden (31 topics)
1.1 s, USA (48 topics) 1.6 s. Everything loaded is stored in IndexedDB, so the
next open is instant.

Because the fetching happens after the click, the list empties when the tab
does. The tab is marked active straight away, and the rows arrive only once
stage 2 answers; rows left standing in between would be the previous tab's,
clickable under the new tab's heading. Measured on the mock server, a click
on **Channels** followed at once by a click on the top row opened a series
instead of playing a channel — the list is therefore emptied with the tab
and fills a moment later.

### Channel logos

The provider sends a logo address with every channel, and on the test account
those addresses point into `mediaportal-nordic-logos`, a collection that was
archived years ago: a good part of the list showed nothing at all. Channel
logos therefore come from [tv-logo/tv-logos](https://github.com/tv-logo/tv-logos),
the maintained collection that took its place, and the provider's address stays
as the fallback for channels it has never had.

The two have no identifier in common. tv-logos is addressed by file name, the
API knows a stream id and a name, and the bridge is the name: `FI: MTV3 HD` and
`countries/nordic/finland/mtv3-fi.png` meet at the key `mtv3`, once the country
tag in front, the quality tag on the end and every difference of punctuation
and accent have been taken off both.

A wrong logo is worse than no logo — the viewer cannot tell that it is wrong —
so the key has to match a file name exactly, and where several countries own
that name the channel's own country decides it. The country comes from the tag
the name carries, and failing that from the column the channel is filed under:
`TV3` is a channel in Sweden, Denmark, Norway and Lithuania, and without a
country the app leaves it to the provider rather than guess. Two more rules
earn their keep in the Nordics: a name matches with its word breaks ignored, so
that `SkyShowtime 1` finds `sky-showtime-1`, and a name matches as the tail of
exactly one file name in its own country, so that the channels Finnish
providers list as `Sub`, `Ava` and `Max` find `mtv-sub`, `mtv-ava` and
`mtv-max`. Both are limited to one country and to a single match, which is what
keeps them from reaching: `Hits` ends both `c-more-hits` and `mtv-hits` in
Denmark, so it resolves to neither.

The collection's file list ships with the app as `js/logoindex.js` — 8,400 keys
in 78 country folders, 113 kB — rather than being fetched. Fetching it would
cost a host permission, a megabyte of JSON and a working connection for
something that changes a few times a month; the pictures themselves are
`<img>` requests, which need no permission. Refresh the list with:

```
node dev/logos.mjs
```

`--check` exits non-zero when it is out of date and `--report` says what
changed, folder by folder. The keys are made by the same `slugify()` the app
puts channel names through, so changing that function means regenerating the
index with it.

## Categories on two levels

The provider encodes two levels into a single string: `Sweden - Sport`,
`Sweden - Nyheter`, `Albania - Movies Club`. The app splits them, which
condenses 519 live categories into **81 countries** down the left-hand side in
alphabetical order. Choosing a country shows all of its channels, and the topic
buttons along the top narrow it to a subject. The buttons are in alphabetical
order, except for the country's own general category, which sits right after
the *All* button.

On the channels the topics stand inside **Filter channels**, a fold above the
list (`js/listfilters.js`), at their full height: folding it is what gives
the list its room, and there the handle below is not drawn. Elsewhere (a
group of films or series with several categories) the button bar is as tall
as its topics need, up to a ceiling of a quarter of the column: Albania's three take one row and reserve nothing, USA's 48 fill six
or seven before the rest is left to scroll. A ceiling counted in rows rather
than in the column's height would be right for the small countries and short
for exactly those whose topics are worth reading. The bar's lower edge is a
handle: dragging it sets the height by hand — down to a single row when the
list matters more, up to 60 % of the column when the topics do — and a double
click gives the automatic height back. The height is remembered between
sessions, and it stays a ceiling rather than a height, so a country of three
topics never leaves a band of empty panel below them.

The same splitting removes the `Movies:` and `Series:` prefixes from movies and
series, which only repeat the name of the tab.

Lists are sorted alphabetically by default — channels, movies and series, within a
category, within a group and in the *All* list. The provider's own order varies
from one category to the next and carries no meaning across the list.
Punctuation at the start of a name (`|FI| Alien`) is ignored, and numbers are
compared as numbers, so *Rocky 2* comes before *Rocky 10*. When a repeating
prefix has been stripped from a row (below), the order follows the visible
name. Search still ranks matches by relevance, but equally ranked matches fall
into alphabetical order.

**Channel order** in Settings > Viewing says where the channel list starts:
**Name (A-Z)**, **Name (Z-A)** or **Channel number** — the provider's own
numbering, and where a provider sends none, the stream id in its place. It is
the answer to a list of hundreds: choose the order that already suits, then
move the few favourites where they belong. The other lists have their own
fields beside it, each the same choice as the marks at the list's foot
(`js/listorder.js`): **Favourites order** (by name, or the latest added
first), **Movie order** and **Series order** (by name, by release year either
way, by rating, or what the provider added lately first; a title whose year,
rating or date is not known goes last) and **History order** (the latest
watched first, or by name).

**Filter countries**, under the sidebar on the channels (and in Settings >
Viewing), shows one of three: **All countries**, **Favourite countries
only** (the starred ones and those holding a starred topic) or **Countries I
choose**, every live group with a box and a filter field, the browser's own
country first and marked as the suggestion. The list answers only the third
mode and stands dimmed otherwise; a tick in it chooses that mode. What the
filter leaves out is out of the sidebar, the lists, the search and the
guide; the favourites and the history keep what was picked by hand. What is
stored is the mode and the list of what to show, not of what to hide, so a
country the provider adds later does not turn up uninvited, and the list is
kept while another mode is on (js/app.js, groupFilter). Before the modes, a
list meant the third and the sidebar's old "Show favourites only" box the
second; a stored view from then is read that way. The question is asked by
itself once per account, after the first connection, when the provider has
twenty groups or more.

**Filter categories**, in the same place on the films and the series, does the
same for their categories, each tab its own mode and choice: what the
filter leaves out is out of the sidebar, **All**, the lists and the search,
the favourites and the history again keeping what was picked. The choices
belong to the account, are remembered across restarts and travel with sync
like the countries.

Every channel row has a menu — the ⋯ at its right end, a right click, or the
context-menu key and Shift+F10 on the row the list stands on: **Add to
favourites** (or **Remove from favourites**) and **Hide channel**. Hiding
applies at once, and the message that says so carries **Undo**. **Hidden
(n)** under the list opens what has been hidden, each with **Show again**.

**Favourites (n)**, at the end of the films' and the series' **Filter
titles**, gathers the favourites among the rows on screen — the films of a
genre, the series of a category — as a row of covers, a press away. The
channels have none: there it repeated the Favourites tab. The list
below keeps them in their places in its order; nothing is taken out of it,
and nothing moves. It shows only when the list holds a favourite, and only
while a list is browsed: a search, a page opened from the list and the
favourites and the history are lists of their own. Open or folded is
remembered. It took the place of pinning channels to the top of their list,
which did nearly the same thing a second way: two near-identical means to
the same end were one too many.

These replace the channel editor, a dialog that arranged every channel and
every category, hidden or shown, into an order of its own. It could do
everything and was used for nothing: nobody drags five hundred rows. The
channels and categories it hid stay hidden and are listed under Hidden; the
order it made is no longer applied. The choices belong to the server and the
account and survive cache clearing, reloading and switching away from the
account and back.

**Show international channels in each country's list**, in Settings >
Viewing, is on by default. Turned off, a country's list keeps its own channels
and drops the world's: a provider files every channel it sells in a country
under that country, so *Finland* holds `FI: Stingray Djazz` beside the same
channel in Sweden, Norway and Denmark, and `FI: CNN` beside thirty other
countries' CNN. Nothing in the list says which is which, so `js/international.js`
reads it from the list as a whole: a channel whose name — without the country
tag, the picture quality and the provider's bracketed notes — turns up in four
or more groups is international. On one provider's 31,000 channels that takes
some 40 ms, and *Finland* goes from 696 channels to 608.

Three things keep the rule from overreaching. A country's national topic
(*Kansalliset*, *Nationella*, *Nationale*, *Öffentlich* and their kin) and its
category with no topic at all, where the main channels are kept, are its own
by the provider's word, so `FI: TV5` stays though TV5 Monde is everywhere, and
`UK: ITV` stays at home. A dated broadcast slot (`[DisneyFI] (31/10) 18:45 …`)
or an *Event* channel is the country's own feed of a match shown in many
places, and is left alone. And only a country's list is thinned: under *Music*
or *24-7 Channels* the global names are the point. What the rule cannot see is
a national feed of a global brand — `FI: Eurosport 1` has Finnish commentary
and looks exactly like Eurosport — which is why the setting starts on. Telling
the channels apart takes the whole list, so with the setting off a country
loads it first. The filter applies to browsing, the counts and the guide;
a search, the favourites and the history find every channel.

The sidebar filter — a magnifier and *Country or topic* on the channels, *Genre or topic* on films and series — matches sub-categories too: the query *sport* brings up the
countries that have sports channels even when the country's name lacks the
word.

### The repeating prefix

Once a country or a topic has been chosen, the beginning of the row name
repeats what the sidebar already says: under *USA ▸ NHL*, `US: NHL Ice Center
Pass 3 FHD` is distinguished from no other visible row by its prefix, which
only takes space from a narrow column. `js/name.js` strips two things from the
start of the name: a country code closed by a hard separator (`US:`, `|FI|`,
`EX-YU |`) and the words of the filters that are on.

Both go only when an absolute majority of the visible rows repeat them. That is
why `USA Network HD` survives intact under the country *USA* — the start of a
name is part of the name when the others do not repeat it — and why the
separator is part of the detection, or `US Open Tennis` would lose its
beginning. The chosen country's own codes are the exception: under *Finland*,
`FI:`, `FIN |` and `FI -` go whatever their share, because providers mix their
spellings and leave rows untagged, and a majority is then never reached — the
viewer would see `FI: MTV` among clean rows. A table in `js/name.js` maps the
sidebar's country names, in English, in the country's own language and in
Finnish, to the codes providers use. The prefixes come in either order (`US:
NHL …`, `NHL US: …`), so the passes are repeated until nothing matches any
more, and the whole name is always in the row's title text.

A search and *All* mix the countries, and there each row is tidied by the
rules of its own group: `FI: Liiga 1 FHD` reads `Liiga 1 FHD` in the results
just as it does under *Finland*, and the guide shows the names the list does.
In the favourites and in the history the prefix stays put. Inside a favourite
category the filter is known even though the sidebar does not show it, and
the names tidy up as in the browsing view.

### A category as a favourite

Starring a single channel is not enough when the interesting thing is a whole
category: *Finland ▸ MTV Liiga* is eight channels today and some other number
next season. That is why there is a star on the sidebar country row and on
every topic chip as well — the first picks the whole group, the second one
category.

The *Favourites* tab lists them as a group of their own above the channels and
the movies, and tapping a row opens the category's contents on the spot: the
same list as in the browsing view, the same row names and programme data, but
returning to the favourites is one tap. The contents are always fetched fresh,
so channels that have appeared in the category show up without the favourite
needing an update.

Only an identifier is stored — the type, the `category_id` and the visible
name — not the category's contents. A group favourite (*Finland*) stores the
group name and gathers its sub-categories only when opened, so it follows a
changing offering too.

The sidebar's filter names what the sidebar holds: countries on the channel
tab, genres on the movie and series tabs. Below 760px there is no sidebar —
three columns leave the list about 210px, which is a column of truncated
names — and the same choice appears as a menu at the top of the list, which
brings the list back to 360px at 720px wide.

The search in the header covers the whole list (the category filter is cleared
visibly) and ranks matches by relevance: a match at the start of a word beats
one found mid-word, so that *yle* raises the Yle channels rather than "KYLE
COLLECTION".

The field names its scope: all channels, all movies, all series, favourites
or history. Inside a series or favourite category, it searches that detail
view instead. Clearing the search restores the previous group or type filter;
switching content tabs starts with an empty search. Opening a series suspends
the parent search and **Back** brings it back.

Names are matched with their marks folded away, and the words may come in any
order. A provider's list is written in a dozen languages and read on one
keyboard: *elain* finds "Eläinkanava", *sodergran* finds "Södergran" and
*oresund* finds "Øresund", because a search that answers "no matches" is read
as "there is no such channel" rather than as "type the umlaut". *cnn news*
finds "News CNN" as well as "CNN News" — but the one that reads the way the
query was typed still comes first, so the looser rule costs the exact match
nothing. The same folding is used by the country and topic filter beside the
list, by the filter in **Filter countries**, and by the programme search in
the guide, so one spelling works everywhere a name is typed.

## Playback routes

| Source | Engine |
| --- | --- |
| Live (MPEG-TS) | mpegts.js → MediaSource |
| Live (`.m3u8`), or the fallback from TS | hls.js |
| VOD `.mp4` `.m4v` `.mov` | the browser's own player; in Firefox over `http://`, the file read in parts into MediaSource (see FIREFOX.md) |
| VOD `.webm` | the browser's own player |
| VOD `.ts` `.flv` | the header decides — the extension does not hold |
| VOD `.mkv` | Matroska unpacked into fMP4 → MediaSource |
| VOD `.avi` | not supported |

`Auto` tries TS first on live channels (lower latency) and moves to HLS if TS
does not start within 20 seconds. On the test server HLS often starts faster
but trails the live edge by a segment length.

In the test material 54% of the movies are `.mp4` and 44% `.mkv`. For
unplayable ones, **Copy address** and **Open in an external player** are
offered.

What a provider answers decides what the player says. Measured against a real
one-connection provider on 1 November 2026:

| Situation | The provider's answer | The player |
| --- | --- | --- |
| A title it has no file for | `200 OK`, `text/html`, an empty body | says so at once |
| A file its file server cannot give | `302` to the file server, then `400` | says so at once |
| A channel outside the subscription or off the air | `407` at once, before any redirect — which the browser turns into a network error | says so at once |
| A second stream on a full account | let through; the oldest stream is cut a few seconds later | — |
| A stream closed a moment ago | let through again at once | — |

None of them was slow: every answer came within a second. A source that has
answered nothing within five seconds is given up, rather than after the 20–30
seconds of the start timeout. The account check and the wait for a released
connection stay for providers that do refuse a stream with a status while
they still count the last one.

How far ahead a film or an episode is read depends on the route. The browser's
own player decides for itself, some 15–20 seconds measured. The MKV unpacking
and mpegts.js both read a minute ahead and drop what was watched behind it. For
mpegts.js the minute is its lazy load: without it, a film was read at the
server's full speed until Chrome's MediaSource quota was full, and mpegts.js
then cut the connection and never resumed, so the picture froze when the
buffer ran out. Live channels and the archive are read as they come.

### External player

Unpacking and wasm audio cover most of the library, but not all of it: the AVI
container, VC-1, 10-bit H.264 and bitmap subtitles (PGS, VOBSUB) stay out of
the browser's reach. A desktop player handles them natively and takes the
Xtream stream URL as it is. The hand-off is always manual — from the player's
`☰` menu, the `x` key, or a button in an error message — and never
happens by itself.

There were two routes, one is left: a one-item `.m3u` is downloaded from a
blob, and the operating system opens it with whichever player is registered for
`.m3u` — for VLC that is `public.m3u-playlist` in its Info.plist. Two clicks,
no new manifest permissions and no bridge between the extension and the
operating system.

Player-specific URL schemes (`iina://`, `mpv://`) used to be selectable and were
dropped: they saved one click but required a choice from the user and knowledge
of what they had installed. **VLC does not register a `vlc://` scheme on
macOS** — its Info.plist lists only `http https ftp mms mmsh rtmp rtmpe rtmps
rtmpt rtp rtsp sftp smb udp` — so for the most common player the file route was
the only one anyway.

The resume position travels along: `#EXTVLCOPT:start-time=` is written into the
playlist at the point the browser had reached. Playback is stopped before the
hand-off, because the account allows one concurrent connection — otherwise a
stream the browser keeps open would leave the external player silent.

The URL carries the credentials, so a downloaded `.m3u` is as sensitive as the
account itself, and the app now says so where it matters rather than only here.
The `x` key asks over the picture before it hands over — one keystroke should
not stop playback and write a password to disk, and the focus is dropped to the
body after every click, so nothing is holding the keys. The `☰` menu item is
deliberate already, a menu opened and a line chosen in words, and goes straight
through; both say afterwards that the file carries your credentials and is
worth deleting.

### Chromecast

**Cast to a Chromecast** in the player's `☰` menu (or `c`) works in two ways, and
`CHROMECAST.md` holds the assessment behind them.

A file the browser plays natively — `.mp4`, `.m4v`, `.mov`, `.webm` — goes to
the device through the Remote Playback API: Chrome's own device picker opens,
and Chrome sends the compressed picture and sound to the device as they are.
Nothing is re-encoded, the server needs no CORS headers, and the browser keeps
the one connection the account allows. The tab has to stay open, and
*Chromecast* shows on the line below the player's title while the device plays.

Everything that runs through MediaSource — live channels, HLS, the MKV
unpacking — is outside that API's reach on desktop Chrome, which accepts only
a plain `http(s)` source for it. For those the button explains the route that
does work: **Cast…** in Chrome's menu, this tab, then `f`. Once the video is
full screen Chrome switches by itself from mirroring the screen to sending the
compressed stream, MediaSource included. Subtitles are drawn by the player over
the picture and travel only while the screen is mirrored, not after the switch.

The Google Cast SDK is not used. Manifest V3 forbids loading it from Google's
servers, and what it offers — the device fetching a URL by itself — would
cover only MP4 files and HLS from servers that send CORS headers; neither
MPEG-TS nor Matroska plays on the device's own player.

### Unpacking Matroska

Chrome will not take Matroska, but the H.264 or HEVC inside it is fine as it
is. `js/mkv.js` demuxes the clusters from the stream, `js/mp4.js` packs the
frames into fMP4 segments and `js/remux.js` feeds them to MediaSource. The
picture is neither decoded nor re-encoded — only the container changes.

Four points needed care:

- **Decode time.** Matroska stores only the presentation time. Because of
  B-frames the two differ — in a measured episode 740 of 1569 frames had a PTS
  that went backwards from the previous one. The DTS is obtained by sorting a
  segment's timestamps ascending and handing them out in decode order.
- **Time units.** For video, 90,000 ticks per second divides evenly at every
  common frame rate. For audio the sample rate is used and frames are chained
  back to back, because Matroska's millisecond resolution would round an AAC
  frame's 21.333 ms duration and the error would accumulate into seconds over
  an hour.
- **One connection.** The account allows one concurrent download, so the header
  is read from the same stream playback continues from. Seeking cuts the stream
  and opens a new one at the offset the Cues table points to; the table is at
  the end of the file, so it is fetched only if a seek happens.
- **One buffer operation at a time.** The download stays about a minute
  ahead of the picture, and what has been watched is removed half a minute
  behind it. A `SourceBuffer` does one thing at a time, so the removals go
  through the same queue as the appends: run beside it, the first removal
  some 35 seconds in met an append on a high-bitrate film, the append threw
  *SourceBuffer rejected the segment*, and the picture stopped once the
  buffered minute had played out. `dev/unitcheck.mjs` holds the case.

An interrupted download resumes from the start of the last complete cluster. If
the file is broken instead — the library held an episode followed by three
megabytes of zeros and no cluster at all — playback ends at the intact point
and the viewer is told how far the picture went.

### Subtitles

The unpacking picks up the subtitle tracks along the way (`js/subs.js`). A
block's text is handed to the browser as a `VTTCue` on a text track of the video
element: the browser keeps the time — it fires `cuechange` as the cues come and
go — and offers the tracks in its own subtitle menu. The choice is made from the
selector below the player, and the language — not the track number — is
remembered, so the next episode of a series opens in the same language. The
default is Finnish when the file has a Finnish track.

A track that carries no `Language` element at all is English: that is the default
Matroska gives the element, and it is how ffmpeg and the desktop players read
such a file. Reading it as unknown instead put an English track in the selector
under **Unknown language**, and left the summary counting a language it never
named. A track the file marks `und` outright stays unknown, and the summary names
it as such rather than dropping it.

The selector is in alphabetical order for the interface language: the file's own
order is arbitrary, and in a list of thirty tracks the right language cannot be
found unless its place can be guessed.

The drawing is the player's own (`js/subdisplay.js`): the active cues are laid
out as HTML in a layer over the picture. The browser's drawing was used first
and fell short in two ways — a two-line line of dialogue came out as two boxes
with a gap between them, and `::cue` takes only a colour, a font, a shadow and a
background, so no look could be built on it. The layer gives one box per cue and
five looks to choose from in the settings, with a preview: shadow — the default,
no box — outline, yellow, box and high contrast. The size is a share of the
picture's height, as television's is, and so the same in a window and in full
screen: 100 % is 5 % of the picture, the browsers' own default (the bars of a letterboxed film not
counted), and the slider runs from 50 % to 250 %, with **Default** beside it to
come back. `+` and `−` change it by ten while watching. 14 px is the floor,
for a small window. It used to be pixels, the same in a window and in full
screen, and measured on a 1080p screen the 24 px default came to 2.2 % of the
picture in full screen — half of the browsers' own default of 5 % and of the
BBC's guidance, a line of some 8 % of the picture. At 100 % the text is now
21 px in a 1280×800 window, 47 px in full screen on a 14-inch MacBook Pro, 59 px
on a 1080p screen and 79 px at 1440p. A size kept in pixels by an older version
becomes the same proportion of the old default: 24 px is 100 %, 36 px 150 %,
and the small, medium and large of earlier still are 75, 100 and 140 %. The looks are written into `::cue` as well, as far as
`::cue` goes, for the one case where the browser still draws (below).

The layer goes to full screen only with the picture's wrapper, which `f`
takes. The browser's own full-screen button, and its double click, take the
bare video and would leave the layer behind; while the video itself is full
screen, the browser's drawing is switched back on for the duration, the chosen
height written into the cues. Chrome on a Mac draws them in the system's caption
style — by default a dark rounded box behind every look, set in System Settings
› Accessibility › Captions — which no page style overrides. The browser also lifted the subtitles above the controls while those
were on show, and their visibility cannot be read from outside, so the rule is
imitated: the video is paused, or the pointer moved over the picture within the
last three seconds.

The cues of every text track are collected as the file is unpacked, even though
one is visible. The alternative would be reading the file again when the track
changes, which would take the single allowed connection and interrupt the
picture. After a seek the same blocks arrive again, so a cue that has already
been added is recognised and skipped.

Limits:

- **SRT, ASS/SSA and WebVTT** are accepted. Bitmap formats (PGS, VOBSUB,
  DVBSUB) are images and cannot be handed to a `VTTCue`, so they are left out of
  the selector — the list row's "34 subtitles" counts them in, and the details
  below the player add "(not supported)" when a file has nothing else. A file
  with no subtitles at all says so there too, rather than leaving the viewer to
  notice that the selector never appeared.
- ASS style codes (`{\an8}`, `{\pos}`) are stripped and italics survive;
  backgrounds and effects made with drawing commands are not rendered.
- Only the unpacking route knows about subtitles. The `mov_text` of a natively
  played MP4 is still left out, because Chrome does not render it.

### What unpacking opens up

Measured on a sample of 1,500 series (23,628 episodes):

| | Share of episodes |
| --- | --- |
| Played before unpacking | 44.6% |
| Unpacked, audio as it is | +21.6% → **66.2%** |
| Unpacked, audio decoded (AC-3/E-AC-3/DTS) | +27.5% → **93.7%** |

The last row needs a decoder of its own, because Chrome has neither AC-3,
E-AC-3 nor DTS. Of 45 ac3/eac3 episodes not one had a second track Chrome
supports, and 43 had a single audio track, so an alternative track rescues
few of them. **Play without sound** therefore remains only for the few
tracks that are not decoded (TrueHD, or MP3 in MKV, for instance).

### Choosing the audio track

A file often carries more than one: the original and a dub, a director's
commentary, an audio description. Only one of them reaches MediaSource, and
the choice is the player's — neither browser offers
`HTMLMediaElement.audioTracks`. Measured, Chrome 152 and Firefox 155 both
answer `false` for it, so nothing below the player can pick a track, and a
natively played `.mp4` gets whichever track the file marks default.

`js/audio.js` makes the choice, and `js/probe.js` reports it below the
player from the same function — so what is written there and what is heard
cannot disagree. The order is:

1. The language the viewer chose last, if the file has it. The language is
   what is remembered, not the track number, because the numbering varies
   from one file to the next — the same as for the subtitles.
2. Otherwise an untouched track before a decoded one. That is what saves
   discs carrying both AC-3 and AAC: an AAC track goes to MediaSource as it
   is, and passing it through always beats decoding and re-encoding, even
   when the file marks the AC-3 one default.
3. Between two tracks of the same kind, the one the file marks default; and
   failing that, the file's own order.

A commentary or an audio description is passed over unless it is asked for
by language, or unless it is all the file has. Matroska's own flags for
them (`FlagCommentary`, `FlagVisualImpaired`) came late and are rarely
written, so the track's name is read as well — `Commentary`,
`kommenttiraita`, `kuvailutulkkaus`.

The name in the selector is built from the language, the track's own name
and the format: *Finnish (AC3 5.1)*, *English (Commentary, AAC stereo)*. A
name that only repeats the language is left out, so a Finnish track called
`Suomi` does not read *Finnish (Suomi)*.

### Changing the audio track

The selector sits below the player next to the subtitle one, and appears
only when there is a choice to make — one track is not a decision. The `a`
key steps to the next track and names it in a toast, because the eye is on
the picture rather than on the selector then. The choice is remembered as a
language, so the next episode opens on the same one.

Changing track mid-playback costs a read of the file. The account allows
one connection, so the other track is not on the browser's side: it has to
be fetched again. What is dropped, then, is only the sound — the picture
stays in its buffer, which holds up to a minute ahead — and the download
starts again from the cluster the playback position sits in. Measured, the
picture runs through the change without stopping and the sound comes back
in about a second.

Two things had to be got right for that. The `SourceBuffer` keeps its
identity and is re-pointed with `changeType`, because removing an audio
buffer from under a running playback changes the element's track set;
a new init segment follows in either case, since the sample rate and the
channel count differ from track to track even within one codec. And the
download's back pressure, which used to look at the video buffer alone,
now looks at the shorter of the two — otherwise the minute of picture
already buffered would stop the very download the sound is waiting for.

A switch to or from an AC-3, E-AC-3 or DTS track builds or drops the
decoder on the way; between two tracks of the same codec the decoder is
only restarted.

Two limits remain. A natively played `.mp4` cannot be switched at all, for
the reason above. On a live channel `mpegts.js` takes the first audio PID
of each codec from the PMT and offers no way to name another, and the
vendored build is minified — the track that comes is the track that plays.

### Decoding the audio track

The decoder is FFmpeg's own, built as wasm (`vendor/ffaudio`, LGPL 2.1+,
712 kB with the AAC encoder below). A hand-written AC-3 decoder would cover only part of it: E-AC-3 is not
the same bitstream but adds AHT, spectral extension and substreams, and DTS is a
third separate one. The build is `dev/wasm/build.sh`, and `--test` compares the
output with ffmpeg's own from the same bitstream — in every case the difference
is float rounding (~1e-7), including the 5.1 downmix and the 32 kHz conversion.

MediaSource will not take PCM, so the decoded audio is re-encoded with the
browser's own `AudioEncoder` (`js/transcode.js`): to AAC where the browser has
that encoder — Chrome on macOS and Windows — and otherwise to Opus, which is
what Firefox and Chrome on Linux encode. MediaSource takes both in MP4, with an
`mp4a` or an `Opus` sample entry from `js/mp4.js`; the choice is made once per
page, a candidate counts only once it has actually encoded, and `FIREFOX.md`
has the measurements for both. `node dev/audiocheck.mjs
firefox` (or `chrome`) makes them again: the real modules run inside the
extension, and what they produce is decoded with ffmpeg and compared with the
wasm decoder's own reference. Two measured constraints set the format:

- **The AAC encoder accepts only 44,100 and 48,000 Hz**, Opus wants 48,000,
  and neither tolerates the channel count changing mid-track. AC-3 allows
  32,000 Hz, and the library holds files where mono turns into stereo. That
  is why the wasm decoder brings everything down to a fixed format (stereo,
  48 kHz) before the encoder. The downmix is asked of the decoder itself,
  which uses the stream's own cmixlev/surmixlev levels; swresample's generic
  matrix gave a different, clipping result when measured.
- **The encoder has a priming delay that it neither reports nor corrects** —
  2112 samples, or 44 ms, for AAC when measured, which is macOS's AudioToolbox
  figure and therefore not portable, and 312 samples (6.5 ms) for Opus in
  Firefox. Without correction the audio would lag the picture by that much
  throughout. The figure is therefore measured at run time: a known impulse is
  encoded and decoded back with the browser's own decoder. Measured, the chain
  lands sample-accurate with either encoder and does not creep at all over 60
  seconds.

A browser with no WebCodecs encoder at all — Firefox for Android 152, which
showed an AC-3 episode as "no encoder" and would have played it silent — gets
FFmpeg's own AAC encoder from the same wasm module, last in the order because it
runs on the page's thread (80–95x real time on an M1 Max with the fast coder,
which beat FFmpeg's default two-loop search on both speed and SNR for speech and
music). Its priming is its own report, `initial_padding`, 1024 samples, and
`dev/wasm/verify.mjs` checks it: the frames, decoded with ffmpeg, put the
impulse exactly that late. It encodes while it is called, so instead of waiting
on a queue it yields the thread every 12 ms. `node dev/playcheck.mjs wasmaudio`
plays the AC-3 episode with WebCodecs removed.

Back pressure is handled by waiting rather than flushing: `flush()` forces the
encoder to emit a partial frame padded with silence, and the frame chain would
stretch every time — measured, 60 seconds of picture came out as 69 seconds of
audio.

### Reading the file header

The extension is not enough to decide on, and the API's metadata cannot be
trusted. Measured from the test server (1,500 series, 23,628 episodes):

- `get_vod_info` returns no codecs at all — so nothing is known about a movie
  beyond its extension
- `get_series_info` reports `png` or `mjpeg` as the video codec for 4.7% of
  episodes: that is the cover image, which ffprobe sees as the first track
- VOD files with a `.ts` extension were Matroska without exception in the sample
  (10/10) — `.mp4` and `.mkv`, on the other hand, held true (8/8 each)
- the audio decides more often than the container: of the mkv episodes around
  42% are `aac` and 53% `ac3`/`eac3`/`dts`, which Chrome will not decode by any
  route

`js/probe.js` therefore reads the first 256 kB of the file with a single Range
request and parses Matroska's `Tracks` element: the container, the codecs with
their profiles, the audio tracks and the subtitles with their languages. The
profile is needed because Chrome does not decode 10-bit H.264 — a bare `avc1`
would give too hopeful an answer. The result is stored in IndexedDB and shows on
the list row without a new request.

The header is not read up front: the account allows one concurrent connection,
so the read happens only when the extension does not promise playback, when the
container is known to be unreliable (`.ts`), or when every engine has failed.
Then the error message states the reason: *"The audio track is MP3, which Chrome
does not decode. The picture would play, the sound would not."* rather than
merely the extension.

## Connection mode

The settings offer **Server and credentials (Xtream Codes)**, **Playlist
address (M3U)** and **Stalker portal (MAC address)**. On the first run and for
a new account a field above them, **Paste the address your provider sent**,
takes any of the three: `pastedKind` in `js/xtream.js` sends an Xtream
subscription's address into the server's fields, a portal's (`/c/`,
`stalker_portal/`, `portal.php`) into the portal's, and any other web address
into the playlist's, and shows that form. The playlist form itself takes two
kinds of address.

**An Xtream subscription's address** — the HTTP or HTTPS `get.php` address with
`username` and `password` in it — is read into the fields: protocol, server,
port, username and password, URL-encoded characters included. The dialog then
hands over to **Server and credentials (Xtream Codes)** with the values in place, which
both shows what was understood and leaves it open to correction. Such an account
is used through the Xtream API, one list at a time, rather than as the playlist
the same address would also give.

**Any other address is an M3U playlist**, kept as it is, with an optional
**Programme guide address (XMLTV)** for a playlist that does not name its own.
Pasting does not save or connect; **Save** (or **Connect** on first use) does
that, and asks the browser for access to the playlist's host and the guide's in
one prompt.

### M3U playlists

`js/m3u.js` reads the extended M3U that providers' panels and IPTV players
write, the format having no specification of its own beyond what VLC, Kodi's
IPTV Simple Client and TiviMate agree on:

- the header's guide addresses as `url-tvg`, `x-tvg-url` or `tvg-url`, several
  with commas between them, and its `catchup`, `catchup-days`, `catchup-source`
- `#EXTINF` attributes in any case (`tvg-ID`), quoted with `"` or `'` or bare,
  and a title that holds commas — the title is what follows the first comma
  outside quotes
- `#EXTGRP` for a group when there is no `group-title`, `#EXTVLCOPT`
  user agent and referrer kept with the entry, addresses relative to the
  playlist's own, a byte order mark, `\r\n` line ends, and plain M3U with no
  `#EXTINF` at all
- headings in the list ("===== Sweden =====") left out

The playlist is read as it downloads, a piece at a time, so a provider's 78 MB
list of 286,000 lines (measured) is never one string; it takes about three
seconds to download and read in Chrome, and is then kept in the cache for twelve
hours (`js/m3usource.js`). What a row is comes from its address — a panel's
`/movie/` and `/series/`, or a film's file type — and an episode is gathered
under its series by its name, "Show S01 E02" or "Show 1x02". The category is
`group-title`, so "Sweden - News" splits into a group and a topic as an Xtream
category does. An item's id is a hash of its name and group rather than of its
address: a provider that puts a token in its addresses changes them daily, and
favourites and resume points must still find the item. Each series' episodes
are a row of the cache of their own, so twelve thousand series are not held in
memory to show one.

### XMLTV guides

`js/xmltv.js` reads the guide as it downloads too: only `<channel>` and
`<programme>` elements, found by their tags, with times as `YYYYMMDDhhmmss`
and an offset (`+0100`, `+01:00`, or none for UTC), titles in the reader's
language where there are several, entities, numeric references and CDATA. A
gzip file is recognised by its first two bytes, since `guide.xml.gz` usually
arrives without a `Content-Encoding` (`js/fetchtext.js`). The provider's 24 MB
guide, 79,000 programmes, reads in about a quarter of a second. Each channel's
programmes are a row of the cache, kept twelve hours (`js/guide.js`); a playlist
channel finds its guide channel by `tvg-id`, in any case, or by its name
against the guide's display names with country prefixes and HD, FHD and the like
folded away, and `tvg-shift` moves its times.

### Catch-up from a playlist

A channel with `catchup` and `catchup-days` (its own or the header's) has an
archive, and the address of a past programme is built the way its mode says
(`catchupAddress` in `js/m3u.js`):

| Mode | The address |
| --- | --- |
| `default` | `catchup-source` with `{utc}`, `${start}`, `{utcend}`, `{duration}`, `{lutc}`, `{offset}`, `{Y}`…`{S}` and `{utc:Y-m-d}` filled in |
| `append` | the same template after the channel's own address |
| `shift` | the channel's address with `utc=` and `lutc=` added |
| `flussonic` | `…/index-<start>-<duration>.m3u8`, or `…/timeshift_abs-<start>.ts` |
| `xc` | an Xtream panel's `/timeshift/<user>/<pass>/<minutes>/<date>/<id>.ts` |

### Accounts

Every account is a whole configuration with an id of its own, in the
`accounts` list of `storage.local`; `config` is the one in use. A version from
before there was a list has only `config`, which becomes the first account the
first time the list is read. The lists of an account — favourites, history,
resume points, reminders, channels — were already kept by the account's key
(`accountKey` in `js/config.js`: the server and user for Xtream, the address
for a playlist), and so is the catalogue cache, which is why a switch no longer
clears the cache: the account left keeps its catalogue for the switch back, and
expired rows go by themselves.

### Sync

`js/sync.js` uses `storage.sync`, which is small and rationed: 100 kB in all, 8
kB a row, 120 writes a minute. Each record — the accounts, the settings, one list
of one account — is JSON, deflated and base64'd into rows of 7,000 characters,
with a row of its own naming it, its time and its hash; history goes up as its
newest 25 and resume points as their newest 100. Writes wait three seconds and
go together, the history and resume points a minute. Only one open player tab
syncs: the one holding a Web Lock. The later write of a record wins, except that
history and resume points are joined entry by entry, and a computer's first sync
joins its accounts and favourites with the others'. **Reset everything** clears
the extension's sync storage too.

## Things worth knowing

- Credentials are stored in the clear in `chrome.storage.local` on this machine,
  and in the browser's sync storage only when sync and **Include passwords** are
  both turned on.
  In Xtream the credentials are also part of every stream URL.
- **Settings → Reset everything** removes it all: credentials, settings,
  favourites, history, resume points and the entire IndexedDB database. The
  button asks for confirmation itself — a second dialog opened on top of the
  settings dialog would end up beneath it — and reloads the page at the end,
  because the state in memory would correspond to nothing after the wipe.
- The host permissions are in the `optional_host_permissions` list, so
  installation asks for access to nothing. Access is asked for only when the
  server address is saved, and only for that server's origin. A missing
  permission shows up as a network error, alongside which there is a button for
  granting it. There are no content scripts.
- **What the extension may do is a reviewed list.** `APPROVED` in
  `dev/package.mjs` holds every permission, optional host permission, the
  content security policy and Firefox's data collection declaration, each
  with one line of why it is needed. Both manifests must say exactly that:
  `node dev/package.mjs --check` (CI, `node dev/release.mjs`, every package
  build) fails on a permission without its reason there, on one dropped from
  a manifest but still listed, on a looser policy, and on keys such as
  `host_permissions` or `content_scripts`. Adding a permission means writing
  its reason in that list first, then the store's justification
  (`store/chrome-dashboard.txt`, `firefox/reviewer-notes.txt`).
- A stream the server redirects to another host fails the same way even when
  the server's own host is granted. After a failed stream the player asks the
  address once more with a `HEAD` request that does not follow redirects; if
  it is a redirect, **Allow all addresses** is offered beside Retry. The
  browser hides where a redirect leads, so the one host it needs cannot be
  named, and the permission asked for covers every address.
- Access is needed only for fetch/XHR requests: `player_api.php` and the segment
  requests of hls.js and mpegts.js. Natively played VOD (`<video src>`) and
  channel logos (`<img>`) work without it.
- **The concurrent connection limit** shows in the settings. On the test account
  it is 1, which leaves a second simultaneous stream silent. The app tears down
  the previous stream before opening a new one, but if playback does not start,
  check that the same account is not in use elsewhere.
- Programme data exists only for the channels the provider has defined it for —
  on the test server, around 8,800 channels out of 29,600.
- Channel logos come from
  [tv-logo/tv-logos](https://github.com/tv-logo/tv-logos), not from the
  provider, which points at a repository that was archived years ago. A channel
  the collection does not have keeps the provider's own address; a logo that
  fails to load either way is hidden automatically.
- Part of the provider's catalogue gives a picture's address without the file
  name on the end — `https://image.tmdb.org/t/p/w600_and_h900_bestv2` where a
  poster's path belongs. An address that names no file cannot be a picture, so
  it is dropped as the list is read and never requested.
