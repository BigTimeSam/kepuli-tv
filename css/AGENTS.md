# css/: the player's one stylesheet

`player.css` styles the whole interface (`player.html`). No preprocessor, no
framework, no utility classes: plain CSS with custom properties, in sections
that follow the page from top bar to dialogs.

## Rules

- **Sizes in `rem`**, so the reader's own font setting scales everything,
  including the virtualised list's rows (`js/vlist.js` measures them). Pixels
  only for hairlines and optical nudges.
- **Colours from the custom properties** in `:root` (`--panel`, `--text`,
  `--muted`, `--dim`, `--accent`, `--border`…). The light theme is
  `:root[data-theme="light"]`; the picture and the bar under it stay dark in
  both themes. `prefers-contrast: more` raises borders and muted text; check a
  new colour there too.
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
- **Optical alignment** of icons beside labels is gathered in a block at the
  end of the file; align by measuring (icon centre against the text's visual
  centre), not by eye, and keep the rule there.
- Hover-only affordances (a ✕ on a card, an empty star) must also show on
  keyboard focus and on touch (`hover: none`).

Check every visual change with a screenshot at 1280×800 in both themes (see
`dev/AGENTS.md`), and in the long languages if text widths matter.
