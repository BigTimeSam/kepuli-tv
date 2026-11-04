# store/: listings, translations records and the two stores

Everything that leaves the machine is outward-facing: do it only when the
owner has asked for it in the current conversation. Credentials are in
`~/.config/kepuli-tv/` (mode 600): `cws.json`, `amo.json`, `openai-key`. The
procedures and the dashboard fields are in `store-listing.txt`; the history
behind them in [development.md → Publishing to the stores](../docs/development.md#publishing-to-the-stores).

## What is in this directory

| File | What | Edited by |
| --- | --- | --- |
| `listings/<locale>.txt` | name, short description and detailed description per language (31; `sq` is Firefox-only, `no` becomes `nb_NO` for Firefox) | hand / agent |
| `i18n-glossary.json` | the core concepts' term in each language, checked by `dev/glossarycheck.mjs` (see `js/locales/AGENTS.md`) | hand / agent |
| `translations.json` | per language, hashes of the English each key and listing was translated from | `dev/translations.mjs --mark` only |
| `cws-listing.json` | per language, a hash of the description last put in the Chrome dashboard | `dev/cws-listing-fill.mjs` / `cws-publish.mjs listing --done` only |

`_locales/` (the manifest's translated name and summary) and `dist/listings/`
(texts unwrapped for pasting) are generated from `listings/` by
`node dev/listings.mjs`: never edit them by hand.

## Changing the listings

1. Edit `store/listings/en.txt` and the same section in the 30 others.
2. `node dev/listings.mjs` checks the stores' limits and writes `_locales/`
   and `dist/listings/`. Its keyword rules come from a Chrome rejection:
   **IPTV at most three times** per language, and no other word of five or
   more letters five times or more across name, summary and description.
3. The last section of each description is the video link ("SEE IT IN
   ACTION"); `forChrome()` drops it from the Chrome text automatically.
4. `node dev/translations.mjs --mark <lang…>` once they are translated.
5. They reach the stores only through the store tools; see below.

## Identities

| | Chrome Web Store | AMO |
| --- | --- | --- |
| Item | `okkgclcakhjhldkdcblgagoaibghpfmi` | `kepuli-tv@bigtimesam.github.io` |
| Package | `kepuli-tv-chrome-<v>.zip` | `kepuli-tv-firefox-<v>.zip` + `kepuli-tv-firefox-<v>-amo-source.zip` |
| Code | `node dev/cws-publish.mjs` (API) | `node dev/amo-publish.mjs` (API v5) |
| Description | `node dev/cws-listing-fill.mjs` (dashboard over CDP) | `amo-publish.mjs listing` |
| Screenshots | `node dev/cws-screenshots.mjs` (dashboard over CDP) | `node dev/amo-screenshots.mjs`, then `amo-publish.mjs captions` |
| Video | promo video field in the dashboard | link in the description's last section |
| Review | hours to a day or two | usually minutes (automatic) |

## Chrome Web Store

- `cws-publish.mjs status` shows published and submitted versions.
- Order for a release with listing changes: `cws-publish.mjs upload` (draft)
  → `cws-listing-fill.mjs` → `cws-screenshots.mjs` if the screenshots changed →
  `cws-publish.mjs submit`. A submission is refused while a description is
  behind (`cws-publish.mjs listing`), unless `--listing-later`.
- **The listing is locked while a version is in review**: descriptions,
  screenshots and the promo video cannot be saved. Either change them before
  submitting, or wait for the review, or `upload --replace`, which cancels the
  review first. Cancelling has a small daily quota (`429 CancelSubmission
  request limit reached`); after a few cancels it is gone until the next day.
- The dashboard is driven in its own Chrome (`~/.config/kepuli-tv/cws-chrome`,
  port 9444). If a tool says "not signed in", the session expired: ask the
  owner to sign in to the publisher's Google account in the window it opened,
  then run it again. Browser extensions (claude-in-chrome and the like) cannot
  script store pages at all.
- Keyword policy: IPTV at most three times per description; Chrome rejected
  1.5.2 for four.
- After approval: `node dev/cws-publish.mjs verify` (no credentials) reads
  the CRX the store serves and fails unless it is the new version, the
  Chrome manifest (`service_worker`, no `gecko`).
- **No staged rollout yet.** The store offers a percentage rollout only to
  items with more than 10,000 weekly users; until then a release reaches
  everyone at once, so `dev/release.mjs` and the full suites are the guard.

## AMO

- `amo-publish.mjs status | check | validate | listing [--dry] | captions [--dry]`;
  with no argument it publishes the current version: validate, create the
  version with the source zip, release notes (from the GitHub release),
  reviewer notes (`firefox/reviewer-notes.txt`), then listing and captions.
- **Reviewer notes at most 3000 characters, line breaks counted as two**
  (1.3.0 was rejected at 3025). The tool prints the count; check it.
- **AMO throttles writes**, sometimes for hours (4,749 s, 9,035 s and 12,188 s
  have all been seen). The tools wait by themselves: run them in the
  background, chain dependent steps (`a && b`), and do not run two AMO writers
  at once. A throttled run is not an error.
- New previews have no captions; run `captions` after `amo-screenshots.mjs`.

## Screenshots

1. `node dev/store-screenshots.mjs` (Chrome set into `brand/screenshots/`) and
   `KEPULI_BROWSER=firefox node dev/store-screenshots.mjs`
   (`brand/firefox-screenshots/`), with your own port and profile (see
   `dev/AGENTS.md`); `KEPULI_SHOTS_DIR` writes elsewhere to compare first.
2. Look at all ten before uploading.
3. Chrome: `node dev/cws-screenshots.mjs` (not during review). AMO:
   `node dev/amo-screenshots.mjs && node dev/amo-publish.mjs captions`.
4. Commit the new PNGs.

Retake them whenever a release changes what the five views look like.

## The demo video

`node dev/demo-video.mjs` records the tour from the mock server (1920×1080,
about 4.5 minutes): it first plays a viewer's evenings so the start page and
History are full, then walks 25 scenes with burnt-in captions. Each scene has a
narration line (OpenAI speech, voice onyx, key in
`~/.config/kepuli-tv/openai-key`; clips cached in `dist/video/voice-<lang>/`)
and lasts as long as its line; `dev/demo-music.py` makes the music, ducked under
the voice. `--silent` records without sound, `--remix` remixes the sound over
the last recording. Outputs in `dist/video/`: the mp4, a thumbnail and
`-chapters.txt`.

- YouTube chapters must each be at least 10 seconds; merge short scenes in the
  description by hand.
- YouTube cannot replace a video's file: a new video is a new URL. Then update
  `store/listings/*.txt` (all 31), `store-listing.txt` ("Promo video"), run
  `node dev/listings.mjs`, send the AMO listing, set the Chrome promo field,
  and change `VIDEO` in `dev/site.mjs` (the Pages front page).
- The current video is recorded in `store-listing.txt`.
