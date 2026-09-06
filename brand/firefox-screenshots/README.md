# Firefox Add-ons screenshots

Captured by `KEPULI_BROWSER=firefox node dev/store-screenshots.mjs` — the
same walk that makes the Chrome set, driven through Marionette instead of
DevTools — in Firefox 155 on macOS, using an isolated test profile and the
local `dev/mock/server.mjs` fixture. All channels, titles, artwork and video
are fictional demo content. No customer account or hosted demo service was
used.

The five views match the Chrome Web Store set in `brand/screenshots/`. Each
PNG is 1280 × 800 RGB. The Chrome set is captured at 2× and scaled down;
Firefox has no per-capture density — its own is a profile preference, and 2×
would need a 2560 × 1600 window — so this set is captured at 1×.

| File | AMO caption |
| --- | --- |
| 01-channels.png | Browse channels by country and topic while watching live TV. Shown with fictional demo content in Firefox. |
| 02-guide.png | Explore the programme guide while playback continues in the mini-player. Shown with fictional demo content in Firefox. |
| 03-series.png | Browse series details, seasons and episodes. Shown with fictional demo content in Firefox. |
| 04-subtitles.png | Play an MKV episode with text subtitles and choose their language and size. Shown with fictional demo content in Firefox. |
| 05-movie.png | Watch a movie with its description and details beside your catalogue. Shown with fictional demo content in Firefox. |
