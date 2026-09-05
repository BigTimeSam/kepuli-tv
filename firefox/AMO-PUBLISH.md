# Firefox Add-ons publication

Prepared on 2026-09-05 for the first public desktop Firefox listing on
addons.mozilla.org (AMO). No AMO submission has been made. Version 1.0.7 is
the preparation candidate; the released 1.0.6 packages remain unchanged.
HTTP support is retained at the owner's request. Its reviewer acceptance
remains a question to resolve during submission.

## Release preparation status

Completed:

- Chrome Web Store installation is recommended at the top of the README
  and on the generated project homepage (commit `efe47de`).
- Firefox 1.0.6 packaged from release commit `82dcde7`: 40 runtime files.
- web-ext **10.6.0** lint: baseline 1.0.6 had **0 errors, 6 warnings**;
  candidate 1.0.7 has **0 errors, 5 warnings**. Details below.
- Firefox **155**, macOS ARM64: all `dev/audiocheck.mjs firefox --mkv`
  checks pass. Five decoded-audio cases align sample-exactly; AAC and AC-3
  MKV episodes start and continue after a seek to 60 seconds. The AAC mock
  episode contains silent audio, so its RMS is zero; the AC-3 example has
  an audible timing signal. These are audio/MKV checks, not a complete UI
  or multi-platform regression suite.
- The temporary remote test fixture was checked successfully, but will be
  retired. It is not offered or linked as a customer service or as the AMO
  review path. Review instructions use a local mock server instead.
- hls.js 1.6.5 and mpegts.js 1.8.0 match their npm distribution files byte
  for byte.
- The decoder build now pins Emscripten 6.0.9 and emsdk's source revision.
  Both a cached rebuild and a clean FFmpeg build from the source archive
  reproduce the shipped files byte for byte on macOS ARM64. The clean build
  reused the installed SDK; Linux cross-host reproducibility and a fresh SDK
  download have not been checked.
- `node firefox/amo-source.mjs --worktree` creates the reviewer source ZIP,
  including full FFmpeg n7.1.1 source, local mock-server tools and English
  build instructions. Its Git-free extension assembly was verified.
- The owner approved Firefox 140+. The manifest now declares
  `authenticationInfo` and uses Firefox's built-in consent.
- The connection form explains HTTP's lack of encryption in English and
  Finnish and recommends HTTPS when supported, in both connection modes.
  Checked in Firefox 155 with a fresh profile: visible in Xtream and M3U
  modes, translates to Finnish immediately, no horizontal overflow. The
  Finnish form was also inspected visually.

## Decisions and work before submission

1. **Consent.** Check the signed installation prompt for the declared
   authentication data after AMO provides a signed candidate. Temporary
   add-on installation does not exercise the normal installation prompt.
2. **Transport security.** Keep HTTP support. Mozilla's current rule requires
   encrypted remote transport, but its official 2021 Q&A acknowledges cases
   such as media servers without TLS and requires an informed user choice.
   This supports an exception argument for user-supplied services; it is not
   an explicit blanket exemption for credentials sent to arbitrary remote
   IPTV services. The form explains the risk and recommends HTTPS. Disclose
   the actual HTTP behaviour to reviewers and request a determination rather
   than claiming that the warning guarantees compliance. No public hosted
   service is controlled or supplied by this extension's developer.
3. **Version and reproducibility.** Build candidate 1.0.7 from a committed
   source and attach its matching reviewer source ZIP. Do not overwrite
   GitHub's published 1.0.6 ZIP.
4. **Store assets and submission.** Confirm the Mozilla developer account.
   Capture screenshots in Firefox with mock content (the existing store
   screenshots were captured in Chrome). Choose desktop platforms only for
   this initial submission; Android support has not been verified. Upload
   the runtime ZIP, source ZIP, listing and reviewer notes; record the AMO
   URL and signed XPI after submission/signing. The initial GitHub ZIP is
   unsigned and is not a permanent Firefox installation.

Sources checked:

- https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/
- https://extensionworkshop.com/documentation/publish/add-on-policies/
- https://extensionworkshop.com/documentation/publish/source-code-submission/
- https://extensionworkshop.com/documentation/publish/third-party-library-usage/
- https://extensionworkshop.com/documentation/publish/submitting-an-add-on/
- https://discourse.mozilla.org/t/add-ons-policy-changes-2021-q-a/89654

## Validator warning assessment

| Warning | Assessment / action |
| --- | --- |
| Firefox minimum 128 predates data-consent manifest support (1.0.6) | Resolved in 1.0.7 by the approved Firefox 140 minimum. |
| Android minimum predates data-consent support | Initial submission targets desktop only; verify platform selection in AMO. |
| `js/rows.js` innerHTML | Assigned a fixed local SVG string, `LIST_ICON`; no provider or user data enters the string. Explain to reviewers. |
| Three Function-constructor warnings in `vendor/mpegts.js` | Upstream 1.8.0 distribution, verified identical. The package CSP allows no string evaluation. Include upstream source links; reviewer acceptance is not guaranteed by lint. |

The validator also lists files it could not recognise as known libraries.
This is why source provenance and the decoder build instructions are supplied.

## Copyable store fields

These are drafts for the 1.0.7 candidate. Firefox 140+ is required; the player
continues to support HTTP and HTTPS services supplied by the user.

Name:

```text
Kepuli-TV
```

Summary:

```text
Plays your own Xtream Codes IPTV account in the browser, with a programme guide and MKV subtitles.
```

Description:

```text
Kepuli-TV plays your own Xtream Codes IPTV account in Firefox. Enter your server address and credentials to browse live channels, movies and series in the extension's own tab.

The extension includes no content, subscriptions, provider addresses or accounts. You need a service you have obtained yourself and the right to view its content.

Requires Firefox 140 or newer. Use HTTPS when your provider supports it. HTTP remains available for compatible services without HTTPS; it sends credentials and viewing requests without encryption.

WATCH IN THE BROWSER

Open movies and episodes without a separate application. Matroska files are unpacked as they arrive, and supported surround-sound tracks are decoded locally and converted to audio Firefox can play. Seeking and interrupted-download recovery are built in. Unsupported files can be handed to an external player.

Text subtitles appear in the video's own subtitle layer, including in full screen. Choose a language and size below the picture; the language is remembered for the next episode. Bitmap subtitles are not supported.

BROWSE LARGE CATALOGUES

Categories and lists load when you need them and are cached locally. Browse countries and topics, search across the catalogue, or open the full-window programme guide. Past programmes can be played where your provider offers catch-up.

Catalogue downloads can be cancelled, and unresponsive requests time out with an explanation. Clearing a search restores the group you were browsing.

KEEP YOUR PLACE

Save channels, movies or whole categories as favourites. Viewing history and resume positions are remembered separately for each server and username, so switching back restores your own lists.

The interface is available in English and Finnish, with keyboard controls, visible focus indicators and reduced-motion support.

PRIVACY

No analytics, tracking or advertising. No data is sent to the developer, and no developer account is required.

Your credentials are stored locally and sent to the service you configure to authenticate catalogue and media requests. The service sees those requests and your IP address. Logos and cover art are loaded from addresses supplied by that service.

Settings, favourites, viewing history and resume positions remain on the device. Clear the catalogue cache separately or reset all local data in Settings.

The extension has no content scripts and does not read the pages you browse. Access to the configured server is requested when you connect. Firefox asks you to consent to the transmission of authentication information during installation.
```

Homepage:

```text
https://bigtimesam.github.io/kepuli-tv/
```

Support website:

```text
https://github.com/BigTimeSam/kepuli-tv/issues
```

Privacy policy URL (the full policy can be copied from this page if the form
requires policy text):

```text
https://bigtimesam.github.io/kepuli-tv/privacy/
```

License: MIT for project code; bundled libraries retain their own licences.
Default listing language: English. Suggested category: Photos, Music & Videos,
if offered by the current AMO form. Mark the external-service requirement:
the add-on is free, but users must supply their own compatible account and
their provider may charge for access.

## Copyable reviewer notes

Update the version, consent details and transport restrictions to match the
final candidate. Attach the matching source archive through the source-code
upload field, not as a public runtime asset.

```text
Kepuli-TV is a player for an Xtream Codes account supplied by the user. It contains no media, provider addresses or bundled credentials. It runs in its own extension tab and has no content scripts, analytics or developer backend.

The source archive includes a local mock server and generated-media script for review. No remote demo service or customer subscription is supplied. With native FFmpeg installed, run sh dev/mock/media.sh and node dev/mock/server.mjs from the source archive. See its README.md for requirements.

Local test connection:
Server: 127.0.0.1
Protocol: HTTP
Port: 8790
Username: demo
Password: demo

Click the toolbar icon. In Settings, select Xtream Codes, enter the local test connection above, and Connect. Grant host access when Firefox asks. Pick Finland and a channel; press G for the programme guide. Open Series, Nordic Noir, Silent Fjord and the first episode for MKV playback with subtitles. The second episode tests AC-3 audio decoding. Seek to 60 seconds and confirm that playback continues. No paid account is needed for review.

The manifest requires Firefox 140 and declares authenticationInfo because the user's credentials are sent to their configured service. The developer receives no data. The extension retains HTTP compatibility for user-supplied services and prominently explains in Settings that HTTP sends credentials and viewing requests without encryption, recommending HTTPS where supported. We request a reviewer determination on this use under the user-supplied-service edge cases described in Mozilla's policy Q&A: https://discourse.mozilla.org/t/add-ons-policy-changes-2021-q-a/89654 . The extension supplies no remote endpoint or account of its own.

All executable code ships inside the ZIP. vendor/hls.js is the unmodified dist/hls.min.js from hls.js 1.6.5; vendor/mpegts.js is the unmodified dist/mpegts.js from mpegts.js 1.8.0. Both were compared byte for byte with the npm releases. Source and distributions:
https://www.npmjs.com/package/hls.js/v/1.6.5
https://github.com/video-dev/hls.js/tree/v1.6.5
https://www.npmjs.com/package/mpegts.js/v/1.8.0
https://github.com/xqq/mpegts.js/tree/v1.8.0

vendor/ffaudio is our build of FFmpeg n7.1.1 using Emscripten 6.0.9. The attached reviewer source ZIP contains the full FFmpeg source, our C wrapper and the exact build commands in its root README.md. The FFmpeg components are LGPL-2.1-or-later; no GPL or nonfree configuration flags are used.

The innerHTML warning in js/rows.js is a fixed SVG constant named LIST_ICON. It contains no user or provider input. Function-constructor warnings come from the unchanged upstream mpegts.js release; the extension's CSP does not allow string evaluation. No remote code is loaded.
```
