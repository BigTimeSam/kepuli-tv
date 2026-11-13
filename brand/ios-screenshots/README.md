# App Store screenshots

Captured by `node ios/screenshots.mjs` in this project's own simulators
(iOS 26.5, Xcode 26.6) from the Debug app and the local
`dev/mock/server.mjs` fixture: the same walk as the browsers' sets, driven
through `ios/sim.mjs`. All channels, titles, artwork and video are
fictional demo content. No customer account or hosted demo service was
used.

Two sets of the same five views, in the order the store shows them, each a
24-bit PNG without an alpha channel at the one size the store takes for
its device:

| Set | Simulator | Size |
| --- | --- | --- |
| `iphone-0N-*.png` (iPhone 6.9") | `kepuli-ios-shots-iphone`, iPhone 17 Pro Max, upright | 1320 × 2868 |
| `ipad-0N-*.png` (iPad 13") | `kepuli-ios-shots-ipad`, iPad Pro 13-inch (M5), on its side | 2752 × 2064 |

The status bar says 9:41 with a full battery, and so do the mock's clock
and the page's, so the guide stands at 9:41 on the day the set was taken.
The simulators run in British English and in London's time zone, as the
browsers' sets do, so times and dates read as they do in the United
Kingdom.

| View | What it shows |
| --- | --- |
| 01-channels | The channels of a country with what is on now, one of them playing: the list on the iPhone, the list beside the picture on the iPad. |
| 02-guide | The programme guide over the same channels; on the iPad the playing channel keeps its corner. |
| 03-movie | A film playing with its cover, details and plot under the picture; on the iPad the genre's covers beside it. |
| 04-subtitles | An episode from an MKV playing with an English subtitle in the picture and the subtitle selector under it. |
| 05-series | A series with its cover, plot, seasons and episodes; on the iPad the channel plays on beside it. |

App Store Connect has no caption field for a screenshot, so the table is
for whoever uploads them: the order above is the order they go in, the
iPhone set under iPhone 6.9" Display and the iPad set under iPad 13"
Display, for English (U.K.) and for Finnish alike. Nothing of recording,
no second picture and no other platform's name is in any of them
(`store/appstore.txt`, SCREENSHOTS).
