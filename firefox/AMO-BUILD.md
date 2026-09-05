# Rebuilding Kepuli-TV for AMO review

This is a reviewer source archive, not an installable extension. `SOURCE.json`
identifies its version and source. `firefox/manifest.json` is the installable
package's manifest; the root Chrome manifest is included only for consistency
checks. The extension's JavaScript, HTML and CSS are otherwise shipped as
written. No application bundler or minifier runs.

## Environment

The original decoder was built on macOS, ARM64, with Emscripten **6.0.9**.
The clean-source reproducibility check uses macOS 26.5.1, ARM64. Linux builds are supported
by the script but have not yet been checked for byte-for-byte reproducibility.
Use Node.js 22 or later for packaging (tested with 24.16.0), Python 3, Git,
GNU Make, and the system `zip`, `unzip` and `tar` tools. On macOS the Xcode
Command Line Tools provide Git and Make (`xcode-select --install`).

`dev/wasm/build.sh` installs Emscripten 6.0.9 through the open-source emsdk
at commit `5eb0bde7585670252e8ba05e9d361627bffd08b5`. The first build needs
network access to GitHub and the Emscripten SDK download service, and about
3 GB of free space. SDK installation documentation:
https://emscripten.org/docs/getting_started/downloads.html

FFmpeg's complete, unmodified n7.1.1 source is already under
`upstream/ffmpeg/`, from commit
`db69d06eeeab4f46da15030a80d539efb4503ca8`. The only project-specific C source
is `dev/wasm/ffaudio.c`. No GPL or nonfree FFmpeg components are enabled.

## Build and compare the generated decoder

Run these commands in the extracted archive's root:

```sh
KEPULI_WASM_BUILD="$PWD/upstream" KEPULI_WASM_OUT="$PWD/rebuilt-ffaudio" sh dev/wasm/build.sh
cmp vendor/ffaudio/ffaudio.js rebuilt-ffaudio/ffaudio.js
cmp vendor/ffaudio/ffaudio.wasm rebuilt-ffaudio/ffaudio.wasm
```

The comparison commands exit successfully only if both generated files match
the submitted files byte for byte. The output directory is separate so the
original files remain available for comparison.

## Assemble the Firefox extension without a Git checkout

After the decoder comparison succeeds:

```sh
node --input-type=module -e 'import { build, worktreeSource, zip } from "./dev/package.mjs"; console.log(zip(build("firefox", worktreeSource())));'
```

The runtime is in `dist/firefox/`; the installable ZIP is in this directory's
root. Archive timestamps can differ; compare the extracted file contents.
The package contains 40 files. No source archive, SDK, build tool, credentials,
demo media or test script is copied into it.

## Third-party JavaScript

These files are the upstream npm release distributions. No changes or
additional minification are applied by this project:

- `vendor/hls.js`: hls.js 1.6.5, `dist/hls.min.js`.
  Release: https://www.npmjs.com/package/hls.js/v/1.6.5
  Readable source: https://github.com/video-dev/hls.js/tree/v1.6.5
- `vendor/mpegts.js`: mpegts.js 1.8.0, `dist/mpegts.js`.
  Release: https://www.npmjs.com/package/mpegts.js/v/1.8.0
  Readable source: https://github.com/xqq/mpegts.js/tree/v1.8.0
- FFmpeg source: https://github.com/FFmpeg/FFmpeg/tree/n7.1.1

The FFmpeg licence and notices are in `vendor/ffaudio/`. The project's own
source is MIT licensed, as stated in `LICENSE`.

## Local reviewer test content

There is no hosted demo or customer account supplied by the developer. For
review, the source archive includes a mock server and a generator for invented
media. Neither is included in the installable extension.

With native FFmpeg installed (including libx264, AAC encoding and drawtext)
and a Helvetica or DejaVu Sans font available, run:

```sh
sh dev/mock/media.sh
node dev/mock/server.mjs
```

The server listens only on `127.0.0.1:8790` by default. In the extension's
Settings, select Xtream Codes, HTTP, server `127.0.0.1`, port `8790`, username
`demo` and password `demo`. These credentials are local test fixtures. Open
Finland for live playback, or Series → Nordic Noir → Silent Fjord for MKV
playback and subtitles. The second episode tests AC-3 audio. Seek to 60 seconds
and confirm playback continues. Stop the local server with Ctrl+C.

The localhost instructions must be retested if the candidate's transport
policy changes before AMO submission. Native FFmpeg downloads and installation
information: https://ffmpeg.org/download.html
