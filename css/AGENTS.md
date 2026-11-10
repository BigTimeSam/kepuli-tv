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
| `narrow.css` | the breakpoints that reshape the page's columns (1180, 980, 760, 600 px) |
| `pickers.css` | the selectors' chevron, the drop-down lists, the search fields' magnifier |
| `recordings.css` | accounts and recordings |
| `last.css` | what must win over everything above: optical alignment, the phone guide, forced colours |

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
  take the whole width (`js/playerlayout.js`); 1180px narrows the sidebar,
  the list and the guide's channel column; 601–1099px drops the tabs' marks;
  760px and 980px adjust the top bar; 520px tightens Settings. Check a change
  at 600px.
- **Motion** respects `prefers-reduced-motion: reduce`; add the matching rule
  for any new animation or transition.
- **Optical alignment** of icons beside labels is gathered in a block in
  `last.css`; align by measuring (icon centre against the text's visual
  centre), not by eye, and keep the rule there.
- Hover-only affordances (a ✕ on a card, an empty star) must also show on
  keyboard focus and on touch (`hover: none`).

Check every visual change with a screenshot at 1280×800 in both themes (see
`dev/AGENTS.md`), and in the long languages if text widths matter.
