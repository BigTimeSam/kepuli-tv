# Recipes for the common changes

Step lists for the changes that come up again and again, each naming the
files and commands it takes. They are the short form: the rules behind each
step are in the `AGENTS.md` of the directory it touches, and those win where
the two differ. Every change ends the same way, so it is said once here:

- `git status` first and before committing (the owner edits the same checkout);
- `node dev/unitcheck.mjs`, `node dev/namecheck.mjs`, `node dev/htmlcheck.mjs`,
  `node dev/docscheck.mjs`, and the browser scenarios near the change in your
  own port and profile (`dev/AGENTS.md`);
- `node dev/secretcheck.mjs` on the staged changes, one logical change per
  commit, the subject a sentence about the outcome.

## Add a setting

1. The default goes into `SETTINGS_DEFAULTS` in `js/config.js`, with a
   comment saying why that is the default. Settings sync as one record
   (`js/sync.js`), so a new key travels with the others.
2. The control goes into the Settings dialog in `player.html`, in the panel
   it belongs to, beside a neighbour of the same kind (a `label.toggle` with
   an `input` for a switch), its text marked `data-i18n`.
3. The wiring is in `js/app.js`: grep an existing setting such as
   `statsEnabled` and follow it to the three places it appears (the form
   filled from `state.settings`, the form read back on save, and the code
   that acts on it).
4. Its label and any hint in all 30 languages: the recipe below.
5. A line in `docs/user-guide.md` where that panel is described
   (**Settings › Viewing**, **Settings → Connection** …).
6. The `settings` scenario in `dev/playcheck.mjs` or a new one asserts that
   the setting is kept and does what it says:
   `node dev/playcheck.mjs settings`.
7. If the control changed one of the five store views, `node dev/visualcheck.mjs`
   says so; see the last recipe.

## Add or change a user-visible string

1. The English and the Finnish in `js/i18n.js`, under a key named for its
   area (`rec.*`, `guide.*`, `setup.*`); reuse a key when the meaning is the
   same. Plurals get `.one` and `.other` forms.
2. In code `t('area.thing', { name })`, never a literal; in markup a
   `data-i18n*` attribute.
3. The key in each of the 28 files `js/locales/<lang>.js`, at the same place
   as its neighbours, translated, placeholders unchanged (insert after an
   anchor key with a small script rather than by hand).
4. `node dev/translations.mjs` lists what is behind; when all are done,
   `node dev/translations.mjs --mark all`, then
   `node dev/translations.mjs --check` must pass.
5. Look at German, Finnish and Hungarian in the UI if the string sits in a
   button or a narrow column. Details: `js/locales/AGENTS.md`.

## Add a playcheck scenario with a mock fault switch

1. The fault goes into `dev/mock/server.mjs` as a `KEPULI_MOCK_*` variable
   read when the request arrives (grep `process.env.KEPULI_MOCK_BAD_GATEWAY`
   for the shape), with a comment beside it saying what it imitates, and
   into the list in `dev/mock/AGENTS.md`. Off by default; everything else
   stays deterministic.
2. The scenario is an `async function name(page)` in `dev/playcheck.mjs`
   shaped like `badgateway`: set the variable, drive the page with
   `evaluate`, `click` and `waitFor`, and clear the variable in a `finally`.
   The mock server runs in the same process, so the variable takes effect
   on the next request.
3. Return `{ ok, detail }` with what was seen, add the function to
   `SCENARIOS` at the end of the file and a line to the list at the top.
4. A regression test must fail without the fix: run it once on the old code,
   then with the fix: `node dev/playcheck.mjs name`. Stop stray mock servers
   on your port first (`lsof -nP -iTCP:<port> -sTCP:LISTEN`).
5. Pure logic found on the way gets a case in `dev/unitcheck.mjs` as well.

## Move a section of app.js into a module

1. Pick a section by its marker line in `js/app.js` (`/* ---- the picks */`
   or `/* ==== sidebar */`) and look at what it shares with the rest.
2. Try it first: `uv run dev/splitsection.py "-- the picks" js/picksui.js "<header comment>" --dry`
   (with your section and module name), then without `--dry`. The tool
   rewires imports and exports, and refuses a move that would assign a
   variable across the boundary.
3. The new module gets a header comment saying what it is for, and a line
   in `js/AGENTS.md` (`node dev/docscheck.mjs` fails without it).
4. `node dev/namecheck.mjs`, load the player, and run the scenarios of the
   area in `dev/playcheck.mjs`; the checklist is in `js/AGENTS.md`.

## Change the store listings

1. Edit the section in `store/listings/en.txt` and the same section in the
   30 other files in `store/listings/`.
2. `node dev/listings.mjs` checks the stores' limits and keyword rules (IPTV
   at most three times per language) and writes `_locales/`; commit both.
3. `node dev/translations.mjs --mark <lang…>` once each language is
   translated; `node dev/listings.mjs --check` and
   `node dev/translations.mjs --check` must pass.
4. The texts reach the stores only with the owner's go, through the store
   tools (`store/AGENTS.md`, the procedures in `store-listing.txt`).

## Retake the store screenshots

1. With your own port, profile and a scratch directory:
   `KEPULI_SHOTS_DIR=<scratch> node dev/store-screenshots.mjs` for Chrome,
   and `KEPULI_BROWSER=firefox` in front of it for the AMO set (Firefox
   opens a window).
2. Look at all ten pictures; when they are right, run it again without
   `KEPULI_SHOTS_DIR` to write `brand/screenshots/` and
   `brand/firefox-screenshots/`.
3. `node dev/visualcheck.mjs --update` if the five views changed on
   purpose, and `node dev/site.mjs` to copy the pictures to the Pages site;
   commit the PNGs, the references in `dev/visual/` and `docs/` together.
4. If the captions change, the English table and every language in
   `brand/firefox-screenshots/README.md`.
5. Uploading them (`node dev/cws-screenshots.mjs`,
   `node dev/amo-screenshots.mjs`) waits for the owner's go; see
   `brand/AGENTS.md` and `store/AGENTS.md`.
