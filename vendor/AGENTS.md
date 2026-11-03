# vendor/: third-party code, shipped as it is

| Path | What | Licence |
| --- | --- | --- |
| `hls.js` | HLS playback | Apache-2.0 |
| `mpegts.js` | MPEG-TS live playback | Apache-2.0 |
| `ffaudio/ffaudio.js`, `ffaudio.wasm` | AC-3, E-AC-3 and DTS decoders built from FFmpeg n7.1.1 with Emscripten | LGPL-2.1+ (`COPYING.LGPLv2.1`, `LICENSE`) |

## Rules

- **Do not edit these files.** They are minified builds; a change is a new
  upstream version dropped in whole, with its licence, and noted in the commit.
- `ffaudio` is rebuilt only with `dev/wasm/build.sh` (the wrapper is
  `dev/wasm/ffaudio.c`, the check `dev/wasm/verify.mjs`). LGPL 2.1 §6 requires
  that a user can relink it, which is why the build is reproducible from the
  repo and why `firefox/amo-source.mjs` puts the full FFmpeg source in the
  AMO source archive. After a rebuild, run `dev/audiocheck.mjs` in both
  browsers and update `firefox/AMO-BUILD.md` and the reviewer notes if the
  build changed.
- A new library needs a reason the stores accept (AMO reviews minified code
  against its source), its licence in `vendor/`, a line in the README's
  Licence section, and the allowlist in `dev/package.mjs`.
