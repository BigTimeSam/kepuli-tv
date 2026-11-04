# docs/: the Pages site and the long documentation

`docs/` is served by GitHub Pages at https://bigtimesam.github.io/kepuli-tv/
(`.nojekyll`: files are served as they are) and also holds the Markdown
documentation read on GitHub.

| File | What | Edited by |
| --- | --- | --- |
| `index.html` | the front page: a landing part (store buttons, the video, the five screenshots with the AMO captions) above README.md rendered | `node dev/site.mjs` only; never by hand |
| `img/` | the five store screenshots, copied from `brand/screenshots/` by `dev/site.mjs` | `dev/site.mjs` only |
| `privacy/index.html` | the privacy policy, linked from both stores | hand |
| `terms/index.html` | the terms of use (version and effective date at the top) | hand |
| `user-guide.md` | everything a user can do, in detail; the player's Help links here | hand / agent |
| `development.md` | running from the source, structure, languages, graphics, publishing | hand / agent |
| `internals.md` | data, categories, playback routes, connection modes, security notes | hand / agent |
| `agents-recipes.md` | step lists for the common changes, for agents and anyone working the same way (linked from the root `AGENTS.md`) | hand / agent |

## Rules

- **The video link and store links of the landing part** are constants at the
  top of the hero section in `dev/site.mjs`; a new video changes them there.
- **README changes are followed by `node dev/site.mjs`** and the regenerated
  `index.html` is committed with them; `--check` fails when it is stale. The
  converter knows headings, paragraphs, lists, tables, fenced code, inline
  code, bold, italics and links, and warns about anything else (no images).
- **Links from installed versions must keep working.** The player links to
  `README.md#getting-started` and `#user-guide` (1.6.3 and older) and to
  `docs/user-guide.md` (later). Do not rename those headings or move the file
  without leaving the old target in place.
- **A user-facing change updates `user-guide.md`** in the same commit; a new
  key feature also gets a line in the README's feature list.
- **Policy pages are legal text.** Change `privacy/` or `terms/` only when the
  owner asks or a feature makes them wrong (a new permission, a new kind of
  data); bump the version and the effective date, and mention it in the
  release notes. The stores link to these exact addresses.
- Write in plain, direct English (British spelling), present tense, without
  marketing. Explain why something is so when it is not obvious.
