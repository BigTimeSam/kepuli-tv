# js/locales/: the interface in 30 languages

Every word the player shows is in 30 languages, and the store listings in 31
(Albanian is Firefox-only). A change is not done until every language has it.
Background: [development.md → Language](../../docs/development.md#language) and
[Keeping the translations in step](../../docs/development.md#keeping-the-translations-in-step).

## Where strings live

| File | Holds |
| --- | --- |
| `js/i18n.js` | English (`en`, the fallback) and Finnish (`fi`), plus `LANGUAGES`, `t()` and `applyStatic()` |
| `js/locales/<lang>.js` | each of the other 28 languages: `export default { "key": "text", … }`, one key per line |
| `player.html` | static text marked `data-i18n`, `data-i18n-title`, `data-i18n-label`, `data-i18n-placeholder`; the English in the markup is only the first paint |
| `store/listings/<locale>.txt` | store name, summary and description per language |
| `store/translations.json` | for each language, a hash of the English each key and listing was translated from |

## Rules

- In code, text comes from `t('area.thing', { name, n })`; never a literal.
  Placeholders are `{name}`; keep them identical in every language.
- Plurals: give the key `.one` and `.other` forms (and `.few`/`.many` where the
  language has them) and call `t('key', { count })`; `Intl.PluralRules` picks.
- Key names follow the area: `rec.*`, `guide.*`, `setup.*`, `player.idle.*`,
  `categories.*`. Reuse an existing key when the meaning is the same.
- Each language keeps its own form of address (du/Sie, tu/vous) as its other
  keys already do; read a few neighbouring keys before translating.
- Brand and protocol names stay as they are: Kepuli-TV, IPTV, Xtream Codes,
  M3U, Stalker, MAC, EPG, Chromecast, VLC.

## Adding or changing a string

1. Add or change the English (and the Finnish) in `js/i18n.js`.
2. Add the key to all 28 files in `js/locales/`, at the same place as its
   neighbours, translated. A script that inserts one line after an anchor key
   in each file is the safe way; keep the file's quoting and trailing commas.
3. `node dev/translations.mjs` lists what is behind with the English to work
   from. When every language is done: `node dev/translations.mjs --mark all`
   (or the languages you did).
4. `node dev/translations.mjs --check` must pass; `node dev/package.mjs`
   refuses a release otherwise.
5. Look at the longest languages (German, Finnish, Hungarian) in the UI if the
   string sits in a button or a narrow column.

## Pseudo-localisation

`player.html?pseudo=1` makes `t()` return every string accented, in brackets
and about 40 % longer (`[Šéţţîñĝš ļ…]`), placeholders and what fills them
untouched; without the parameter nothing changes. A missing `]` is a cut
label; plain English on the screen is text that does not go through `t()`.
`node dev/playcheck.mjs pseudo` walks the main views this way and fails on
any button, tab, row, label or dialog field whose text is wider than its box
(boxes with `text-overflow: ellipsis` or a scroll are meant to cut);
`KEPULI_OVERFLOW_LANG=fi` (or `de`, `hu`) walks them in a real language to
tell whether the overflow happens there too, and `KEPULI_PSEUDO_SHOTS=<dir>`
keeps a picture of each view to look at.

## Terminology

The product's core words (programme guide, favourites, recording, catch-up,
channel, account, playlist, portal, history, Continue watching, subtitles,
Settings) have one term per language, recorded in `store/i18n-glossary.json`
as the translations already used it in most places. `node dev/glossarycheck.mjs`
checks that every interface key and store listing whose English holds a
concept says that language's term (any of its listed forms: a stem, or a few
inflected forms, compared without regard to case); `--survey` shows, per
concept and language, how many texts hold it.

- When you translate, use the glossary's term, not a synonym, even where the
  synonym reads better in the sentence: the reader learns the word on a
  button and looks for it in the help and the store.
- A miss is fixed in the text. Only when the language says it another way
  and nothing is lost (a split verb: "spela bara in", "nimm nur auf") add
  the key to the concept's `except` for that language, with the reason.
- An inflected form the check does not know is added to `forms`; keep the
  forms specific enough that an unrelated word does not pass.
- A new core concept gets an entry with all 29 languages (and `pt_PT`, the
  stores' Portuguese of Portugal), from the majority use in the locale files.

## Cross-checking

Two reviewers have been through every language: an agent per language
group, then Codex (`node dev/translationreview.mjs [lang…]`, instructions
in `dev/i18n/review-prompt.txt`). Neither replaces a native speaker. After
any machine review:

1. every locale loads: `node -e "…import('./js/locales/<l>.js')…"` for all;
2. placeholders match the English key by key, keys and their order unchanged
   (the review commits in git history show the script);
3. `node dev/listings.mjs` passes (IPTV ≤ 3, no other long word 5 times);
4. read the diff; spot-check words you can verify (Codex once turned the
   Latvian "priedēkļa", a set-top box's, into a non-word).

## Store listings

The store texts are translated the same way but live in `store/listings/`; see `store/AGENTS.md`.
