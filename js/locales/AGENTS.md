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
