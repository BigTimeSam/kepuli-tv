# css/: the player's stylesheets

Thirteen stylesheets style the whole interface (`player.html`), linked in
this order, which is the cascade's: one file was 2,181 lines, and the split
kept every rule in its place. No preprocessor, no framework, no utility
classes: plain CSS with custom properties.

| File | What |
| --- | --- |
| `player.css` | the custom properties (colours, measures), both themes, `prefers-contrast`, the page's base rules, the scrollbars |
| `topbar.css` | brand, tabs, search and the bar's buttons |
| `layout.css` | the columns, the sidebar, the list's filter folds |
| `topics.css` | the topic chips and their bar |
| `details.css` | a series' or film's page: cover, facts, credits, related titles |
| `list.css` | the list's rows and the covers' grid |
| `playback.css` | the picture, subtitles, the empty player's page, the details strip, the controls under the picture |
| `dialogs.css` | Settings and the other dialogs |
| `guide.css` | the programme guide |
| `narrow.css` | the breakpoints that reshape the page's columns (1180, 980, 900, 600 px; 760 px for the guide in a phone's width), and the low window (a height of 440 px or less: a phone lying down) |
| `pickers.css` | the selectors' chevron, the drop-down lists, the search fields' magnifier |
| `recordings.css` | accounts and recordings |
| `last.css` | what must win over everything above: optical alignment, the phone guide, what the iOS app leaves out (`.ios`, set by `js/iosapp.js`), forced colours |

A rule goes into the file of what it styles. One that has to override a
rule of a later file goes after it (`narrow.css`, `last.css`): the order of
the links is the order of the cascade, so do not reorder them. A new file
is linked in `player.html` at its place; `dev/unitcheck.mjs` reads them as
the page links them.

## Rules

- **Sizes in `rem`**, so the reader's own font setting scales everything,
  including the virtualised list's rows (`js/vlist.js` measures them). Pixels
  only for hairlines and optical nudges.
- **Colours from the custom properties** in `:root` (`--panel`, `--text`,
  `--muted`, `--dim`, `--accent`, `--border`…). The light theme is
  `:root[data-theme="light"]`; the picture and the bar under it stay dark in
  both themes. `prefers-contrast: more` raises borders and muted text; check a
  new colour there too.
- **The panes are see-through.** `--panel` and `--list-bg` are partly
  transparent so that the page's glow (`--glow-1`, `--glow-2` on `body`)
  shows through them. Anything that floats over a pane (a dialog, a menu, a
  popover, a sheet) sets `--panel: var(--panel-solid)`, or the pane under it
  shows through; add a new one to that rule in `player.css`. More contrast or
  reduced transparency makes the panes solid again.
- **Shared measures as variables**: `--foot-h` (3.3125rem, every column's footer
  is the same height), `--idle-gap`, `--pic-ratio`. Reuse them rather than
  repeating a number.
- **Layouts that react to the content**: `.videowrap.sized` takes the video's
  own aspect ratio (16:9 until known) and the details strip gets the rest;
  `.overlay.idle` is the start page. Use `:has()` and flex/grid; flex children
  that must keep their own shape need `align-self` (a stretched cover lost
  its 2:3 once).
- **Narrow windows**: 600px is the breakpoint where browsing and playback each
  take the whole width (`js/playerlayout.js`); up to 900px (an upright
  iPad among them) the countries are a menu over the list and two columns
  share the width; 1180px narrows the sidebar,
  the list and the guide's channel column; 601–1099px drops the tabs' marks;
  760px and 980px adjust the top bar; 520px tightens Settings. Check a change
  at 600px.
- **Low windows**: a height of 440px or less is a phone lying down (an
  iPhone gives the page about 750×380, a large one 870×400, and 170px of
  height with a keyboard up). The columns stay as the width has them; the
  bars are lower, an open fold is one row, the picture comes before the
  details under it, the guide has one row of controls, a menu scrolls
  inside the window and a dialog scrolls as one (Settings' subtitles
  section excepted where a pointer hovers, for its preview and Save in one
  view; on a touch screen it scrolls too, and its preview has a height of
  its own, set by `fitSubtitlePreview` in `js/setupui.js`). The rules are at the end
  of `narrow.css`, keyed on the height and not on a device or on `.ios`, so
  that every low screen gains. Check a change to a bar, a fold, a menu or a
  dialog at 750×380 and 750×170 too; `node dev/playcheck.mjs iosapp` holds
  the measures.
- **Touch screens** (`@media (hover: none)`, never `.ios`: a phone's
  browser gains too, and a mouse sees none of it): everything that takes
  a press is 40 px (2.5rem) high and wide at the least (the marks of
  the list's foot 36 px wide, with the gap between them). One block near
  the end of `last.css` has it all: what has a box of its own (a button,
  a field, a selector, a fold, a menu's row, a choice) grows to the size;
  a mark in a frame is a square of it; a mark without a frame (a row's
  star and menu, the sidebar's star, the `?`, a chip's two halves, a
  start page card's star and cross, a sideways row's arrows) keeps its
  look and takes the press around it, by padding or a transparent border
  that a negative margin takes back (never a `::after`, which counted as
  overflowing text). A widened flex item gets `flex-shrink: 0`: a
  `min-width` in place of `auto` let the guide's days shrink into one
  another. A name among a film's credits takes the press over 16 px above
  and below its line (`details.css`). In a low window (`narrow.css`,
  `(hover: none) and (max-height: 440px)`) the bars give up their own
  margins instead of the list's rows: the tabs, the folds and the foot's
  marks take the press beyond their look, the guide's way back is the
  first mark of its bar, and the logo stands without its name where the
  bar's buttons are behind the hamburger. Under a finger in two columns
  (an upright iPad) the guide's bar leaves out the clock, the steps and
  the zoom, and its search waits behind a mark, as in a low window.
  `node dev/playcheck.mjs touchsizes` measures every control in sight,
  view by view, in a tablet's window, an upright phone's and a phone's
  lying down: a new view gains its line there. The list's foot keeps its
  count whole there: the category, then the tab's mark and, in a column
  of 320px or less, the count's word give way (`list.css`, container
  queries).
- **Subtitles lifted clear of controls** (`.videowrap.controls`,
  `.looking` in `playback.css`) never leave the picture: the lift is capped
  at the picture's height less two lines, as a phone's picture is lower
  than a desktop's lift. For the look's panel the lift is measured
  (`--look-lift`, `js/tracksui.js`): as far as the panel lies over the
  picture, and nothing where it stands under it (an upright phone) or
  beside it (a low window, where `narrow.css` puts the panel over the
  list).
- **A keyboard over a window that keeps its height** (an upright iPad in
  the app): `js/iosapp.js` sets `html.kb` with `--vvh` (what is in sight) and
  `--vvt` (where it begins), and a dialog stands at the top of that and
  scrolls as one (`dialogs.css`), its buttons kept at the foot of what is
  in sight where that is 300 px or more (`html.kb-tall`). An iPhone's
  window does either, so the page also counts what is in sight being
  less than it has been at this width.
- **The iOS app** shows the same page with `<html class="ios">`: what it
  cannot answer or does not offer is hidden in one block of `last.css`
  (`.ios …`), and what only it shows carries `ios-only`. Keep such rules in
  that block, above the forced colours. An iPad has a phone's sizes: the
  root stays at 100 % (at 112.5 % everything read as large and tight).
- **Full screen is `:fullscreen` or `.full`, always both.** In the app the
  picture's full screen is the app's own: the wrapper gets the class `full`
  and is laid over the window (`.videowrap.full` in `playback.css`, fixed,
  under the message strip, inside the `--full-top`, `--full-right`,
  `--full-bottom` and `--full-left` the app names as not safe). A rule
  that asks the browser's `:fullscreen` of the wrapper is written
  `:is(:fullscreen, .full)`, `:not(:fullscreen, .full)` or
  `:has(:fullscreen, .full)`; `node dev/unitcheck.mjs` fails on one that
  asks `:fullscreen` alone.
- **The message strip in a window of 600px or less** spans the width with
  12px at each side and is as wide as its text (`narrow.css`), so a
  message with a button stays inside it.
- **Motion** respects `prefers-reduced-motion: reduce`; add the matching rule
  for any new animation or transition.
- **Optical alignment** of icons beside labels is gathered in a block in
  `last.css`; align by measuring (icon centre against the text's visual
  centre), not by eye, and keep the rule there.
- Hover-only affordances (a ✕ on a card, an empty star) must also show on
  keyboard focus and on touch (`hover: none`).

Check every visual change with a screenshot at 1280×800 in both themes (see
`dev/AGENTS.md`), and in the long languages if text widths matter.
