# docs/: the Pages site and the long documentation

`docs/` is served by GitHub Pages at https://bigtimesam.github.io/kepuli-tv/
(`.nojekyll`: files are served as they are) and also holds the Markdown
documentation read on GitHub.

| File | What | Edited by |
| --- | --- | --- |
| `index.html` | the front page: a landing part (store buttons, the video, the five screenshots with the AMO captions) above README.md rendered | `node dev/site.mjs` only; never by hand |
| `img/` | the five store screenshots, copied from `brand/screenshots/`, and the extension's icon from `icons/` (the bar's mark and the tab's), by `dev/site.mjs` | `dev/site.mjs` only |
| `img/guides/<name>.webp` | a guide's illustration on its card in the list of guides, 720 × 480 with a transparent background; made as `brand/guide-art-prompt.txt` says, and a guide without one simply has no picture | hand / agent |
| `pages/*.md` | the guides' sources, one per search a visitor arrives with (a browser, a phone, a provider kind, the guide, MKV, questions): front matter (`title`, `description`, `shot`, `alt`, `stores`, `order`, and `layout: questions` where each heading folds its answer, with `open: 3` for how many start unfolded), then Markdown that opens with a paragraph | hand / agent |
| `pages/<lang>/` | the site in each of the player's other languages: `index.md` (the README up to Development, translated), a file per guide (front matter `title`, `description`, `alt` alone; the rest is the English guide's) and `site.json` (the words of the page around them: the keys of `EN` in `dev/site.mjs`) | hand / agent |
| `pages/translations.json` | which English text each translation was made from (`node dev/site.mjs --mark <lang…>` writes it, `--stale` reads it) | `dev/site.mjs` only |
| `<lang>/…`, `site.css`, `site.js` | the same pages in each language, and the one stylesheet and script all pages share | `dev/site.mjs` only |
| `<name>/index.html` for each of them, `sitemap.xml` | the guides rendered, and every page's address for the search engines | `dev/site.mjs` only |
| `google185b2341cb1c0ab0.html` | Google Search Console's proof that the site is the owner's; it must stay at this address for as long as the site is registered there | the owner |
| `privacy/index.html` | the privacy policy, linked from both stores | hand; the bar at the top and its style, between the `site:nav` markers, by `dev/site.mjs` |
| `terms/index.html` | the terms of use (version and effective date at the top) | hand; the bar likewise |
| `user-guide.md` | everything a user can do, in detail; the player's Help links here | hand / agent |
| `development.md` | running from the source, structure, languages, graphics, publishing | hand / agent |
| `internals.md` | data, categories, playback routes, connection modes, security notes | hand / agent |
| `product-audit.md` | a dated audit of the first run and of accessibility (2026-11-04): proposals, not a description of the player as it is | hand / agent |
| `agents-recipes.md` | step lists for the common changes, for agents and anyone working the same way (linked from the root `AGENTS.md`) | hand / agent |

## Rules

- **The video link and store links of the landing part** are constants at the
  top of the hero section in `dev/site.mjs`; a new video changes them there.
- **README changes are followed by `node dev/site.mjs`** and the regenerated
  `index.html` is committed with them; `--check` fails when it is stale. The
  converter knows headings, paragraphs, lists, tables, fenced code, inline
  code, bold, italics, links and notices (`> [!IMPORTANT]`, `> [!NOTE]` or
  `> [!WARNING]` with the text on the quoted lines after it: a box with a
  mark here, an alert on GitHub), and warns about anything else (no images).
  A notice is for what a reader must not miss (no content included, whose
  account may be used, where credentials end up), not for emphasis.
- **A guide says only what the user guide or the code bears out**, in the
  user guide's plain tone: no ratings, user counts or comparisons, no
  browser or device that has not been tried, and the UI's names as they read
  on screen. A link within the site starts with `/` (`/faq/`); a guide's
  file name is its address, so renaming one breaks the links to it. Each
  page must differ in substance from the others: a page that only repeats
  another with a different keyword is not added.
- **Every language of the player has the site.** A translation keeps the
  English shape exactly (headings, lists, notices, links: `node dev/site.mjs
  --try <lang>` says what differs and writes nothing), names the player's
  labels in the player's own words for that language (`js/locales/`), and
  leaves Orion's labels in English. When an English text changes, the pages
  still build from the older translations; `--stale` lists what is behind,
  and `--mark` records a language once it is brought up to date. A
  language whose directory lacks a file is left out of the site until it
  is whole. The policy pages are legal text and stay in English alone.
- **A visitor's language.** An English page sends a visitor on to the same
  page in the first language of their browser's list that the site has,
  unless English comes first or they have picked a language from the bar's
  menu before; that pick is kept in the browser's `localStorage`
  (`kepuli-lang`), the only thing the site stores. Each page names its
  other languages for search engines with `hreflang`.
- **The store buttons carry `utm_` parameters** naming the page, which the
  Chrome dashboard and AMO's statistics count. The site itself has no
  analytics, cookies or third-party requests, and its two inline scripts
  only put the visitor's own browser's button first run the front
  page's carousel of screenshots (by itself every five seconds, never for
  a visitor who asked for less motion), and open a screenshot in a
  dialog over the page.
- **One bar on every page.** `siteNav` in `dev/site.mjs` writes the same
  links, with the page being read marked, into the front page, the guides
  and the two policy pages, so a visitor never lands on a page without the
  way back. It is the player's top bar (`css/topbar.css`): the same
  television, tab strip, accent and marks; when that changes, this follows. A box is set apart by its background and border alone: no
  coloured stripe down its side, which the player does not have either.
- **No robots file**: under `github.io/kepuli-tv/` nothing reads one. The
  sitemap is submitted in Google Search Console and Bing Webmaster Tools,
  which the owner does (the verification file they give goes in `docs/`).
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
