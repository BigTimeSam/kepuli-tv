# Product audit: a new user, and a user of assistive technology

Written on 2026-11-04 against commit 620d87f. No code was changed for it; it
is a list of proposals for the owner to choose from.

## How this was done

- Read `player.html`, `css/player.css`, the English strings in `js/i18n.js`
  and the modules that show errors (`js/app.js`, `js/api.js`,
  `js/playback.js`, `js/stalker.js`, `js/fetchtext.js`, `js/m3usource.js`,
  `js/m3u.js`, `js/languageui.js`, `js/toast.js`, `js/rows.js`).
- Ran the player in an isolated headless Chrome against the mock server
  (`dev/mock/server.mjs`) with small drivers built on `dev/screenshot.mjs`,
  state set through `chrome.storage.local` as `dev/store-screenshots.mjs`
  does, and took screenshots at 1280×800, 600×800 and 390×844 (touch
  emulated), in both themes, in English and German.
- Keyboard: real key events over the DevTools protocol, recording the
  focused element and its computed focus style at every Tab.
- Screen reader semantics: Chrome's own accessibility tree
  (`Accessibility.getFullAXTree`), looked at for unnamed controls, the
  names list rows get, headings, landmarks and live regions. No real screen
  reader (VoiceOver, NVDA) was run.
- Contrast: measured as rendered (every visible text node against its
  composited background, opacity included) in five views per theme, and
  computed from the CSS variables for every text colour against every ground.
- Forced colours (Windows High Contrast) emulated with
  `Emulation.setEmulatedMedia`.

What could not be checked here: a Stalker portal end to end (its MAC cookie
rule needs a granted host permission, which a headless profile cannot
grant); the browser's permission prompt itself (it cannot be answered
headless, so `chrome.permissions.request` was stubbed to say yes or no);
Firefox; a real screen reader.

## Steps from installing to a playing channel

The Settings dialog opens by itself on the first run, titled "Connect to your
provider", with the cursor in Server. That is good. Counted as actions
(typing a field, a click, a key):

| Kind | Steps | Notes |
| --- | --- | --- |
| Xtream Codes, fields | 8: Server, Port (8080 is filled in and must be overwritten when the provider's differs), Username, Password, Connect, the browser's Allow, a channel | the default and the longest path |
| Xtream Codes, pasted address | 5: the second radio ("Paste subscription URL (M3U)"), paste, Connect, Allow, a channel | the shortest path, but behind a radio labelled M3U, which an Xtream user does not think their address is |
| M3U playlist | 5 (6 with a guide address): radio, paste, Connect, Allow, a channel | |
| Stalker | 6: radio, portal, MAC, Connect, Allow, a channel | not run end to end here, see above |

After Connect the first country in alphabetical order opens (Canada in the
mock catalogue; Albania or Afghanistan in a real one), whatever language the
browser speaks. The country question (`askCountriesOnce`) comes only when
there are 20 or more countries.

## Prioritised list

Impact: how many users it affects and how badly. Effort: S under an hour,
M an afternoon, L more. "30 languages" means new or changed keys in
`js/i18n.js` and every file in `js/locales/` (see `js/locales/AGENTS.md`).

| # | Impact | Effort | What | 30 languages |
| --- | --- | --- | --- | --- |
| 1 | High | S | A text page served instead of a playlist becomes a list of junk channels | no |
| 2 | High | S | The welcome screen is a dead end once Settings is closed | yes, one key |
| 3 | High | S | The browser's permission prompt arrives unannounced; a refusal says nothing about what to do | yes, three keys |
| 4 | High | M | Connection error texts say what happened but rarely what to do next | yes, about twelve keys |
| 5 | High | M | Forced colours (Windows High Contrast) hide every "you are here" mark | no |
| 6 | High | S | List options are read as "Add to favourites Canada", "Add to favourites Maple Cinema…" | no |
| 7 | Medium | M | 22 Tab stops before the list, eight of them topic chips | yes, one key for a skip link |
| 8 | Medium | S | Playback error texts: a contradiction, jargon, a control named by a word not on screen | yes, about seven keys |
| 9 | Medium | S | The pasted address is the easiest way in, and it is hidden behind "(M3U)" | yes, three keys |
| 10 | Medium | S | The first country opened ignores the browser's language | no |
| 11 | Medium | S | Text below 4.5:1: chip counts, "In use", placeholders that are the only label | no |
| 12 | Medium | S | Focus rings: half the controls rely on the browser's thin default, text fields on a border colour | no |
| 13 | Medium | S | The overlay's title is not announced; no headings; the player is no landmark | yes, one or two keys |
| 14 | Medium | S | Settings: the Password field's name includes "Show the password"; the connection radios have no group name | no |
| 15 | Low | S | The subtitle look button is announced as "Aa" | no |
| 16 | Low | M | Touch targets under 24 px: the chip stars (18×11), row stars (22×22), chips (23 high) | no |
| 17 | Low | S | The guide's day strip clips at 390 px ("Früher" … "ge"); its search form takes two rows | no |
| 18 | Low | S | Settings on a phone: the section tabs sit under Save, after it in neither DOM nor visual order | no |
| 19 | Low | S | Before the first connection: the guide button, an empty sidebar and an empty list with no word | yes, one key |
| 20 | Low | S | The playing row is not marked for a screen reader (`aria-current`) | no |

### 1. A text page becomes a playlist of junk channels (bug)

Seen: an M3U address that answers with an HTML page (`/c/` of the mock
server, `<!doctype html><title>Stalker</title>`) connected without error and
showed one channel called `title>`. In Node:

```
parseM3u('<html>\n<body>Not found</body></html>', 'http://x.test/a.m3u')
→ two entries, "<html>" and "html>", with addresses resolved against the playlist's
```

Why: `M3uParser.line` in `js/m3u.js` takes every line that is not a `#` tag as
a stream address and resolves it against the playlist's URL, so any text
resolves to something. The check for white space in `resolve` looks at
`url.href`, where the URL parser has already turned spaces into `%20`, so it
never fires. A provider's login page, an expired-account notice or a
captive portal's page all arrive this way, and the viewer sees nonsense
instead of `m3u.notplaylist` ("The address did not return an M3U
playlist.").

Proposal: in `M3uParser.line`, when no `#EXTM3U` header and no `#EXTINF` has
been seen, accept only lines that are absolute `http(s)://` addresses; and
reject a line that contains `<` or white space before resolving it (test
the raw line, not the href). A case in `dev/unitcheck.mjs` for an HTML page
and a JSON error, both expected to give zero entries.

### 2. The welcome screen is a dead end

Seen: on a first run, closing the Settings dialog (Cancel or ✕) leaves
"Welcome / Enter your details and the channels appear in the list." over an
empty sidebar and list, with no button. The way back is the Settings button
at the top right, which the text does not name.

Proposal: `renderIdleOverlay` in `js/languageui.js` adds an overlay action
when `!configured()`, through `showOverlayActions` as `showCancelled` in
`js/app.js` does: a primary button "Connect to your provider" (the existing
key `setup.title.connect`) that calls `openSetup`. Change
`setup.welcome.text` to "Kepuli-TV plays the IPTV subscription you already
have. Connect it to see your channels." (changed key: all 30 languages).

### 3. The permission prompt, before and after

Seen: Connect turns into "Saving…", and the browser asks to let the
extension "read and change your data" on the server, with nothing in the
dialog having said it would. Denied, the dialog says `setup.nogrant`:
"Without access to the server the connection cannot work", which does not
say that pressing Connect again brings the question back.

Proposal:

- A line above the dialog's actions on the first run (new key
  `setup.grant.note`, shown by `openSetup` when `first`): "Next, your browser
  asks to let Kepuli-TV reach this server. Choose Allow: it is needed for the
  lists and the streams, and covers this server only."
- `setup.nogrant`: "The browser was not allowed to reach this server, so the
  connection cannot work. Press Connect again and choose Allow."
- `error.grant.denied`: "Access was not allowed. Press the button again and
  choose Allow when the browser asks."
- Where `offerAccess` in `js/app.js` puts "Allow access: {origin}" first in
  the overlay, the text above it still says only "The server could not be
  reached." Add a sentence in that case (new key `error.grant.why`): "The
  browser has not yet allowed Kepuli-TV to reach {origin}."

### 4. Connection errors: what to do next

Each is shown under "Connection failed" with Try again and Settings, or under
"The list could not be loaded". The proposed texts keep the facts and add
whose side the fault is on and the next step.

| Key | Now | Proposed |
| --- | --- | --- |
| `api.unreachable` | The server could not be reached. | The server did not answer. Check the server address and the port in Settings, and that this computer is online. If it worked before, the provider's server may be down: try again in a few minutes. |
| `api.rejected` | The server rejected the credentials. | The server did not accept this username and password. Check them in Settings; copying them from your provider's message avoids typing mistakes. |
| `api.authfailed` | Authentication failed. | The server did not accept the sign-in. Check the username and password; if they are right, ask your provider whether the account is active. |
| `api.denied` | …the service restricted where you are. | keep, and add: Your provider can tell you which address to use from where you are. |
| `api.status` | The server answered with error code {status}. | The provider's server answered with error {status}. This is on the provider's side: try again in a few minutes. |
| `api.nocategories`, `api.nostreams` | The category list was missing. / The stream list was missing. | The server's answer had no category list (stream list). The address may lead to something other than an Xtream Codes server: check the server and the port. |
| `api.badjson` | The answer was not valid JSON. | The server's answer could not be read. The address may lead to a web page rather than the provider's server: check the server and the port. |
| `api.timeout` | The server did not answer within {seconds} seconds. | keep, and add: Try again; if it keeps happening, the server is overloaded or the address is wrong. |
| `error.unexpected` | Unexpected error: {message} | Something went wrong in the player ({message}). Try again, and reload the tab if it happens again. ({message} is the browser's English text; it stays in brackets as a detail.) |
| `error.noserver` | No connection to the server | Not connected to a provider yet. Open Settings to connect. |
| `m3u.notplaylist` | The address did not return an M3U playlist. | keep, and add: Check that the whole address was pasted, from http to the end. |
| `m3u.badgzip` | The file is compressed but could not be unpacked. | The playlist arrived compressed and could not be unpacked; the download may have been cut. Try again. |
| `stalker.nolink` | The portal gave no address for this stream. | keep, and add: Try again or choose another channel. |
| `account.inactive` | The provider reports this account as {status}. | keep, and add: Ask your provider about it. ({status} is the provider's own English word.) |
| `setup.reset.failed` | Reset failed | Not everything could be deleted. Reload the tab and try again. |
| `sync.status.error` | Sync failed: {message} | Sync failed ({message}). It is tried again with the next change. (check in `js/sync.js` that this is true before using it) |

Already good and to be kept as they are: `api.notxtream`, `stalker.noportal`,
`stalker.rejected`, `account.expired`, `account.busy`, `account.busy.waited`,
`account.releasing`, `playback.notplayed`, `playback.servererror`,
`playback.empty`, `m3u.denied`, `setup.incomplete`, `stalker.badurl`,
`stalker.badmac`, `remux.noaudio`, `remux.truncated`.

### 5. Forced colours hide every "you are here" mark

Seen with `forced-colors: active`: the chosen tab ("Channels"), the chosen
sidebar group, the chosen topic chip and the list's cursor row look exactly
like the others. They are all drawn with a background colour or a
`box-shadow` (`#list:focus-visible .row.selected`,
`.groups-list:focus-visible .group.cursor`), which forced colours remove.
The list's focus frame (`.list-frame:has(> .list:focus-visible)::after`)
survives.

Proposal: one block at the end of `css/player.css`:

```
@media (forced-colors: active) {
  .tabs button[aria-selected="true"], .group.active, .chip.active { outline: 2px solid Highlight; outline-offset: -2px; }
  #list .row.selected, .groups-list .group.cursor { outline: 2px solid Highlight; outline-offset: -2px; }
  #list .row.playing { border-left: 4px solid Highlight; }
}
```

(`.chip.active`, `.group.active`, `.row.selected` and `.row.playing` are the
classes the stylesheet uses today.)

### 6. What a screen reader says on each row

Seen in the accessibility tree: the options of both listboxes are named from
their whole content, the star button included, so arrowing down the sidebar
reads "Add to favourites Denmark", "Add to favourites Finland"…, and the list
"Add to favourites Blackout Protocol (2016) ★ 8.0, 1h 43 min". The film row
also ends in "More actions". The star is a button inside an option, which
the option role does not allow to be reached anyway.

Proposal: `listOption` and the sidebar's option in `js/rows.js` give each
option an `aria-label` built from what matters (name, then the programme on
now or the year and rating, then "favourite" when starred), or
`aria-labelledby` pointing at the name and the subtitle spans; the star and
the ⋯ button get `aria-hidden="true"` inside the option, since `s` and the
row menu key already do their work from the keyboard. The favourite state
then belongs in the label ("Maple Cinema, favourite, 23:00 Paper Moons").
No new strings if the label is assembled from the visible texts; a
"favourite" word would reuse `favs.title`.

### 7. The way to the list by keyboard

Seen: from the top of the page, the list is the 22nd Tab stop: brand, the
tab strip, search, Refresh, Help, theme, Settings, the group filter, "Show
favourites only", the sidebar, Choose countries, Programme guide, eight
topic chips, the topic bar's handle, the Favourites strip, and then the list.
The tab strip and the sidebar are already one stop each with the arrows
inside; the chips are not.

Proposal:

- The topic chips in `js/topicbar.js` become one stop with roving
  `tabindex`, left and right arrows between them, as `activateTab` does for
  the tabs. That alone takes eight stops away.
- A skip link as the first element of the body, visible on focus: "Skip to
  the list" (new key `skip.list`), focusing `#list`.
- Help (`js/help.js`) lists the keys for the list and the guide; adding Tab's
  path in one line would help: "Tab moves between the areas; the arrows move
  inside the sidebar, the tabs and the list."

### 8. Playback error texts

| Key | Now | Proposed |
| --- | --- | --- |
| `playback.channelunreached` | The provider's server refused the channel's stream request: the connection failed without an answer. Try again later. | The provider's server did not answer the request for this channel. The channel may be off the air or the server busy: try again later, or choose another channel. ("refused" and "without an answer" contradict each other) |
| `playback.nosource` | The source did not answer or the format is not supported. | The stream did not start: either the provider's server did not send it, or it is in a format this browser cannot play. Try again, change Auto to TS or HLS under the picture, or open it in an external player from the ☰ menu. |
| `playback.gaveup.hint` | Try again or change the playback mode. | Try again, or change Auto to TS or HLS under the picture. (the select shows Auto/TS/HLS; "playback mode" is only its tooltip) |
| `playback.reason.demux` | demuxing failed | the stream's data could not be read |
| `playback.reason.media` | media error {code} | the browser could not decode the picture (error {code}) |
| `playback.startfailed` | Playback could not be started. | keep, and add: Try again, or choose another channel. |
| `player.nourl` | No playback address was found for this item | The provider's list gives no stream for this. Refresh the lists with ↻ at the top, or try again later. |

The overlay after a failure offers Try again and Copy address; Copy address
alone does not say what it is for. Label it with the existing
`ext.title` ("Open in an external player") where `canExternal` is set, or
keep the copy and put the hint from `playback.hint.copy` under it.

### 9. The pasted address first

Most providers send one long address. The paste field is the second radio,
labelled "Paste subscription URL (M3U)", and an Xtream user's address
(`get.php?username=…&password=…`) is in fact read into the Xtream fields
from there (the `setupClarity` scenario covers it).

Proposal: on the first run, put the paste field above the radios as the
first field, with the label "Paste the address your provider sent
(optional)" and the hint "It fills in the fields below. Or choose how to
connect and fill them in yourself." (new keys `setup.paste.first`,
`setup.paste.first.hint`). Rename the radios to "Server and credentials
(Xtream Codes)", "Playlist address (M3U)" and keep "Stalker portal (MAC
address)" (changed keys `setup.source.xtream`, `setup.source.m3u`). Move
"Name (optional)" below the connection fields: it is the least needed field
and is now the first one. The "Where to find these details" link goes to the
English README on GitHub; the Help dialog would be the better target, but it
cannot open over a modal dialog, so a short in-dialog `<details>` with the
three shapes an address takes would do.

### 10. The first country

`activateTab` in `js/app.js` opens `groups[0]` on a first open. With the
browser in Finnish the list still opens at the first country alphabetically.
`LANGUAGE_COUNTRY` and `labelCodes` already find the browser's country for
the country picker's suggestions; the same lookup could choose the first
group: the first visible group whose `labelCodes` include the browser's
country, else `groups[0]`.

### 11. Contrast

Measured as rendered (WCAG AA: 4.5:1 for normal text, 3:1 for large text and
for controls):

| What | Where | Dark | Light | Fix |
| --- | --- | --- | --- | --- |
| Topic chip counts | `.chip .n { opacity: .6 }` | 2.9 on the chosen chip, 2.9 on the others | 2.9 / 2.5 | drop the opacity, use `var(--muted)` on a resting chip and `#fff` on the chosen one |
| Sidebar count on the chosen group | `.group.active .group-count { opacity: .65 }` | about 2.9 (computed) | same | `opacity: .85` or none |
| "In use" in the account list | `.account-current { color: var(--accent) }` | 3.1 | 4.3 | `color: var(--accent-ink)` (7.2 / 6.6) |
| Search and filter placeholders, the only visible label of those fields | browser default `#757575` | 3.8 on `--panel-2` | 4.0 | `::placeholder { color: var(--dim); opacity: 1 }` (5.4 / 5.3) |
| The resting star on a cover in the light theme | `.card-star`, `var(--star)` | — | 2.2 | a backing disc, or `--muted` there |
| `--faint` (the ✕ on History rows) | `.row-x` | 3.2 on `--list-bg` | 3.0 | passes 3:1 for an icon by a hair; `--star` would be safer |
| Field borders | `--border` on the panel | 1.3 | 1.4 | fields are told apart by their filled background, which helps; under `prefers-contrast: more` the border is raised already |

Disabled controls (Save before a change, the filters' Reset) fall below too,
which WCAG allows. Everything else measured passes, both themes, including
the guide, the details panel and Settings; the variables the stylesheet's
comments claim ratios for (`--dim`, `--accent` under white) check out.

### 12. Focus rings

Elements with their own `:focus-visible` rule show a 2px accent ring (brand,
sidebar, list frame, guide, popup items, modal close). The header's icon
buttons, the tab strip, the topic chips, the player's Auto/↻/☰ and the
guide's arrows fall back to the browser's own ring (`outline: auto 1px`),
which is thin in Chrome and different in Firefox. The search, group filter
and Settings fields show focus by a 1px border changing colour only.

Proposal, at the top of `css/player.css` after the reset rules:

```
:where(button, select, summary, a[href], [tabindex]):focus-visible { outline: 2px solid var(--accent-ink); outline-offset: 2px; }
:where(input, select):focus-visible { outline: 2px solid var(--accent-ink); outline-offset: 1px; }
```

Each existing rule then wins by specificity where it has a reason to differ.

### 13. Announcements, headings and landmarks

- The overlay's text (`#overlay-text`) is a polite live region; its title
  is not, so "Connection failed" or "Playback failed" is never heard, only
  the sentence under it. Make a wrapper of `.overlay-head` and
  `#overlay-text` the live region with `aria-atomic="true"`, leaving
  `#overlay-load` outside (it changes twice a second).
- No heading is visible in the main view (the only `h1` is the guide's).
  A screen-reader user cannot jump between the list and the player. An
  `h1` "Kepuli-TV" in `.sr-only`, and `h2`s for the list column (the group's
  name, which `renderListInfo` in `js/topicbar.js` already knows) and the player ("Now playing",
  new key `player.heading`).
- `#player-stage` is a `section` without a name and so no region; give it
  `aria-labelledby="now-title"` or `data-i18n-label="layout.player"`
  (existing key "Player").
- The toast is a polite status, and an error toast becomes assertive
  (`js/toast.js`), which is right.

### 14. Settings semantics

- `#f-password-show` is inside the Password `<label>`, so the field's name is
  "Password Show the password". Move the button out of the label (the
  `.field-reveal` wrapper can stay) or give the input
  `aria-labelledby` pointing at the label's span.
- The three connection radios are under a `<span>` "Connection" that
  nothing ties to them. Wrap them in `<fieldset>` with a `<legend>` (styled
  as the span is), or give `.radios` `role="radiogroup"` and
  `aria-labelledby`.
- The account row's button is named "127.0.0.1 · demo Xtream Codes ·
  127.0.0.1": the host twice. `js/accountsui.js` could leave the host out of
  the second line when the name already is the host.

### 15. "Aa"

`#btn-sublook` shows "Aa". `applyStatic` in `js/i18n.js` gives a symbol
button its title as `aria-label`, but "Aa" contains letters, so the button
is announced as "Aa". Add `data-i18n-label="player.subs.look"` to it in
`player.html` (the key exists: "Subtitle look").

### 16. Touch targets

At 600 px and 390 px with touch emulated (`hover: none` matches, so the
stars are shown): the chip star is 18×11 px, the row star 22×22, the chips 23
px high. WCAG 2.2's minimum is 24×24 (2.5.8), and 44 is the comfortable
size. Under `@media (hover: none)`, give `.chip-star` a 24×24 hit area (a
transparent padding with a negative margin keeps the look), `.row-star` and
`.row-more` 32×32, and `.chip` a `min-height` of 2rem.

### 17. The guide on a phone

At 390 px (German) the day strip shows "Früher" and a clipped "ge"; the
grid has four channel rows on screen under the group, days, navigation,
clock, search field, two selects and the search button. Under 600 px the
programme search form could fold behind a search button, and the day strip
scroll with a visible edge.

### 18. Settings on a phone

At 390 px the section tabs (Connection, Viewing, Subtitles, Account & data)
are drawn under Cancel and Save, while in the DOM they come first. Focus
order and reading order then differ from what is seen. Keep them at the
top, scrolling sideways if they do not fit.

### 19. Before the first connection

The Programme guide button is shown while nothing is connected (pressing it
says `guide.needserver`), and the sidebar and the list are empty with no
word. Hide `#channel-tools` until `state.lib` exists, and show an empty
state in the list: "Not connected yet" with a Connect button (the existing
keys `setup.account.none` and `setup.connect`).

### 20. The playing row

The row that is playing is marked by colour (`.row.playing`). Add
`aria-current="true"` to it in `itemRow` (`js/rows.js`), so a screen reader
says which channel is on.

## What is already good

- The first run opens the right dialog with the cursor in the first field,
  and a pasted Xtream address is decoded into the fields without saving.
- The tab strip and both listboxes follow the ARIA patterns (one Tab stop,
  arrows inside, `aria-activedescendant`); the `a11y` scenario guards them.
- The guide is a well-described `application` with a status region that
  says the cursor's channel, time and title on every arrow press, and Esc
  returns focus to the button that opened it. Help opens with `?` and
  closes with Esc.
- The ☰ menu opens on Enter with focus on its first item, the arrows move
  inside, Esc closes it and returns focus to the button.
- Errors from the account itself (`account.expired`, `account.busy*`,
  `account.releasing`) say whose fault it is and what is happening, which
  most players do not.
- Both themes' text colours meet 4.5:1 everywhere except the few above, and
  `prefers-contrast: more` and `prefers-reduced-motion` are honoured.
- At 600 px the Browse/Player switch gives each pane the whole width, and
  nothing overflows the page at 600 or 390 px.
