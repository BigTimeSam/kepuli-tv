#!/bin/sh
# Builds vendor/ffaudio/: FFmpeg's AC-3, E-AC-3 and DTS decoders as wasm.
#
# The build is not part of the ordinary development loop — the result is
# committed to vendor/ffaudio/, and this is run only when FFmpeg is updated
# or ffaudio.c changes. The tools and sources go into the $BUILD directory
# (~/.cache/kepuli-tv-build by default), not into the project; they take
# about 2.5 GB.
#
#   sh dev/wasm/build.sh          build
#   sh dev/wasm/build.sh --test   build, make test material and compare with ffmpeg
#
# Requires: git, make, (--test also ffmpeg and node)

set -e

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
BUILD=${KEPULI_WASM_BUILD:-$HOME/.cache/kepuli-tv-build}
FFMPEG_TAG=${KEPULI_FFMPEG_TAG:-n7.1.1}
OUT=$ROOT/vendor/ffaudio
MEDIA=$ROOT/dev/wasm/media

mkdir -p "$BUILD"

if [ ! -d "$BUILD/emsdk" ]; then
    echo "--> emsdk"
    git clone --depth 1 https://github.com/emscripten-core/emsdk.git "$BUILD/emsdk"
    "$BUILD/emsdk/emsdk" install latest
    "$BUILD/emsdk/emsdk" activate latest
fi
# shellcheck disable=SC1091
. "$BUILD/emsdk/emsdk_env.sh" >/dev/null 2>&1

if [ ! -d "$BUILD/ffmpeg" ]; then
    echo "--> FFmpeg $FFMPEG_TAG"
    git clone --depth 1 --branch "$FFMPEG_TAG" https://github.com/FFmpeg/FFmpeg.git "$BUILD/ffmpeg"
fi
FF=$BUILD/ffmpeg

# --disable-all strips everything; only the three decoders, their parsers
# and swresample are taken in. No muxers, no protocols. No GPL parts: the
# result is LGPL 2.1+.
echo "--> configure"
( cd "$FF" && ./configure \
    --cc=emcc --cxx=em++ --ar=emar --ranlib=emranlib --nm=emnm --objcc=emcc --dep-cc=emcc \
    --enable-cross-compile --target-os=none --arch=wasm32 --cpu=generic \
    --disable-all --disable-autodetect --disable-asm --disable-inline-asm \
    --disable-programs --disable-doc --disable-network --disable-debug \
    --disable-pthreads --disable-w32threads --disable-os2threads \
    --disable-stripping --disable-runtime-cpudetect \
    --enable-avcodec --enable-avutil --enable-swresample \
    --enable-decoder=ac3,eac3,dca --enable-parser=ac3,dca \
    --enable-small >/dev/null )

echo "--> make"
( cd "$FF" && emmake make -j"$(sysctl -n hw.ncpu 2>/dev/null || nproc)" >/dev/null )

# -Oz would save 15 kB but costs speed; decoding already runs at 150–900x
# real time, so size is not what is traded away here.
echo "--> emcc"
mkdir -p "$OUT"
emcc "$ROOT/dev/wasm/ffaudio.c" -I"$FF" \
    "$FF/libavcodec/libavcodec.a" "$FF/libswresample/libswresample.a" "$FF/libavutil/libavutil.a" \
    -O3 -flto \
    -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createFfAudio \
    -sENVIRONMENT=web,worker,node -sALLOW_MEMORY_GROWTH=1 -sFILESYSTEM=0 \
    -sASSERTIONS=0 -sSTACK_SIZE=524288 \
    -sEXPORTED_FUNCTIONS=_fa_open,_fa_close,_fa_decode,_fa_flush,_fa_output,_fa_channels,_fa_sample_rate,_fa_take,_malloc,_free \
    -sEXPORTED_RUNTIME_METHODS=HEAPU8,HEAPF32 \
    -o "$OUT/ffaudio.js"

ls -l "$OUT"

[ "$1" = "--test" ] || exit 0

echo "--> testiaineisto"
mkdir -p "$MEDIA"
# A different frequency for every channel: an error in the channel map shows
# up at once, whereas an identical sine everywhere would hide it.
SRC="aevalsrc=0.5*sin(2*PI*200*t)|0.5*sin(2*PI*300*t)|0.5*sin(2*PI*400*t)|0.5*sin(2*PI*500*t)|0.5*sin(2*PI*600*t)|0.3*sin(2*PI*80*t):c=5.1:d=5:s=48000"
STEREO="aevalsrc=0.5*sin(2*PI*440*t)|0.5*sin(2*PI*660*t):c=stereo:d=5:s=48000"
ffmpeg -v error -y -f lavfi -i "$SRC"    -c:a ac3  -b:a 640k "$MEDIA/t51.ac3"
ffmpeg -v error -y -f lavfi -i "$SRC"    -c:a eac3 -b:a 640k "$MEDIA/t51.eac3"
ffmpeg -v error -y -f lavfi -i "$SRC"    -c:a eac3 -b:a 192k "$MEDIA/t51_192.eac3"
ffmpeg -v error -y -f lavfi -i "$STEREO" -c:a eac3 -b:a 128k "$MEDIA/t2.eac3"
ffmpeg -v error -y -f lavfi -i "$SRC"    -c:a dca -strict -2 -b:a 1509k "$MEDIA/t51.dts"
# 32 kHz is legal for AC-3 but unacceptable to the browser's encoders (AAC
# takes 44.1 and 48 kHz, Opus 48), so it is the one case where resampling is
# mandatory.
SRC32="aevalsrc=0.5*sin(2*PI*200*t)|0.5*sin(2*PI*300*t)|0.5*sin(2*PI*400*t)|0.5*sin(2*PI*500*t)|0.5*sin(2*PI*600*t)|0.3*sin(2*PI*80*t):c=5.1:d=5:s=32000"
ffmpeg -v error -y -f lavfi -i "$SRC32"  -c:a ac3 -b:a 448k "$MEDIA/t32.ac3"

# The channel count changing mid-stream: mono and stereo back to back in the
# same file. The library holds files like this, and the wrapper's output
# buffer can hold only one format at a time — this exercises that boundary.
MONO="aevalsrc=0.5*sin(2*PI*440*t):c=mono:d=2:s=48000"
DUO="aevalsrc=0.5*sin(2*PI*440*t)|0.5*sin(2*PI*660*t):c=stereo:d=2:s=48000"
ffmpeg -v error -y -f lavfi -i "$MONO" -c:a ac3 -b:a  96k "$MEDIA/mono.ac3"
ffmpeg -v error -y -f lavfi -i "$DUO"  -c:a ac3 -b:a 192k "$MEDIA/st.ac3"
cat "$MEDIA/mono.ac3" "$MEDIA/st.ac3" > "$MEDIA/mix.ac3"

# The reference PCM through the same chain the wrapper uses: the decoder's
# own downmix first (-downmix), then swresample to stereo (-ac 2). With DTS
# the first does nothing and the second does everything; with AC-3 the other
# way round.
for f in "$MEDIA"/t51.ac3 "$MEDIA"/t51.eac3 "$MEDIA"/t51_192.eac3 "$MEDIA"/t2.eac3 \
         "$MEDIA"/t51.dts "$MEDIA"/mix.ac3 "$MEDIA"/t32.ac3; do
    ffmpeg -v error -y -downmix stereo -i "$f" -ac 2 -ar 48000 -f f32le -acodec pcm_f32le "$f.dref"
done

echo "--> vertailu"
node "$ROOT/dev/wasm/verify.mjs" "$MEDIA"
