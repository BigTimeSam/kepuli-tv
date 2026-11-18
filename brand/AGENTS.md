# brand/: icon sources, promo art and store screenshots

Excluded from the release packages (`dev/package.mjs` packs an allowlist).

| Path | What |
| --- | --- |
| `tv-master-1024.png`, `tv-full.png`, `tv-compact.png`, `tv-master-prompt.txt` | the icon's master art: a retro CRT television in the app's palette (purple `#7c5cff`, screen `#22d3ee`, knobs `#ffc857`) |
| `store-icon-128.png`, `store-icon-300.png`, `promo-small-440x280.png`, `promo-marquee-1400x560.png`, `promo.py` | the Chrome Web Store's icon, the Edge Add-ons store's logo and the promo tiles both take; `uv run --with pillow python3 brand/promo.py` remakes the tiles |
| `guide-art-prompt.txt` | how the guides' illustrations in `docs/img/guides/` were made: the shared style prompt, each page's subject, the commands |
| `android-tv-banner-1280x720.png`, `android-tv-banner-prompt.txt` | the Android TV app's launcher banner (also Google Play's TV banner), and how Codex made it from the icon's master |
| `screenshots/0N-*.png` | the Chrome Web Store set: five 1280×800 24-bit PNGs without alpha |
| `firefox-screenshots/0N-*.png`, `firefox-screenshots/README.md` | the AMO set, and the captions in every AMO language (the README's tables are what `amo-publish.mjs captions` sends) |
| `ios-screenshots/iphone-0N-*.png`, `ios-screenshots/ipad-0N-*.png`, `ios-screenshots/README.md` | the App Store's two sets: five 1320×2868 PNGs of the iPhone upright and five 2752×2064 of the iPad on its side, without alpha; the README says what each shows (the store has no caption field) |

## Rules

- **Screenshots are generated, never edited by hand**: `node dev/store-screenshots.mjs`
  (and `KEPULI_BROWSER=firefox …`) from the mock catalogue, so everything on
  them is fiction. Use your own port and profile (`dev/AGENTS.md`), write to
  `KEPULI_SHOTS_DIR` first, compare, then copy here.
- The five views are fixed and named by number: 01 channels, 02 guide,
  03 series, 04 subtitles, 05 movie. A sixth or a renamed one means changing
  `dev/store-screenshots.mjs`, the captions README and `store/chrome-dashboard.txt`.
- Retake both sets whenever a release changes how those views look, look at
  all ten, then upload with the store tools (`store/AGENTS.md`).
- **The App Store's sets** are the same views in the order
  `store/appstore.txt` plans (01 channels, 02 guide, 03 movie, 04 subtitles,
  05 series), taken by `node ios/screenshots.mjs` in the two simulators of
  the store's sizes (about four minutes; `KEPULI_SHOTS_DIR` first, as
  above). It checks each picture's size and that it has no alpha channel,
  and `node ios/release.mjs status` checks the directory again. Retake
  them when those views change in the app, and look at all ten: they are
  uploaded by hand in App Store Connect, on the owner's go.
- Captions: change the English table and every language's section in
  `firefox-screenshots/README.md` together; each language keeps its listing's
  form of address.
- The icons in `../icons/` (16, 32, 48, 128) are made from the master; the
  packages carry those, not these.
