#!/bin/sh
# Kääntää vendor/ffaudio/:n: FFmpegin AC-3-, E-AC-3- ja DTS-purkajat wasmiksi.
#
# Käännös ei ole osa tavallista kehityssilmukkaa — tulos on versioitu
# vendor/ffaudio/:iin, ja tätä ajetaan vain kun FFmpegiä päivitetään tai
# ffaudio.c muuttuu. Työkalut ja lähteet menevät $BUILD-hakemistoon (oletus
# ~/.cache/kepuli-tv-build), eivät projektiin; ne vievät noin 2,5 Gt.
#
#   sh dev/wasm/build.sh          käännä
#   sh dev/wasm/build.sh --test   käännä, tee testiaineisto ja vertaa ffmpegiin
#
# Vaatii: git, make, (--test myös ffmpeg ja node)

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

# --disable-all riisuu kaiken; mukaan otetaan vain kolme purkajaa, niiden
# jäsentimet ja swresample. Ei muxereita eikä protokollia. Ei GPL-osia:
# tulos on LGPL 2.1+.
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

# -Oz säästäisi 15 kt mutta maksaa nopeudessa; purku on jo 150–900x
# reaaliaikaa, joten koko ei ole se mistä tässä tingitään.
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
# Eri taajuus joka kanavalle: kanavakartan virhe näkyy heti, samanlainen
# siniaalto kaikkialla ei paljastaisi sitä.
SRC="aevalsrc=0.5*sin(2*PI*200*t)|0.5*sin(2*PI*300*t)|0.5*sin(2*PI*400*t)|0.5*sin(2*PI*500*t)|0.5*sin(2*PI*600*t)|0.3*sin(2*PI*80*t):c=5.1:d=5:s=48000"
STEREO="aevalsrc=0.5*sin(2*PI*440*t)|0.5*sin(2*PI*660*t):c=stereo:d=5:s=48000"
ffmpeg -v error -y -f lavfi -i "$SRC"    -c:a ac3  -b:a 640k "$MEDIA/t51.ac3"
ffmpeg -v error -y -f lavfi -i "$SRC"    -c:a eac3 -b:a 640k "$MEDIA/t51.eac3"
ffmpeg -v error -y -f lavfi -i "$SRC"    -c:a eac3 -b:a 192k "$MEDIA/t51_192.eac3"
ffmpeg -v error -y -f lavfi -i "$STEREO" -c:a eac3 -b:a 128k "$MEDIA/t2.eac3"
ffmpeg -v error -y -f lavfi -i "$SRC"    -c:a dca -strict -2 -b:a 1509k "$MEDIA/t51.dts"
# 32 kHz on AC-3:lla laillinen mutta selaimen AAC-koodaimelle kelpaamaton,
# joten se on näytetaajuusmuunnoksen ainoa pakollinen tapaus.
SRC32="aevalsrc=0.5*sin(2*PI*200*t)|0.5*sin(2*PI*300*t)|0.5*sin(2*PI*400*t)|0.5*sin(2*PI*500*t)|0.5*sin(2*PI*600*t)|0.3*sin(2*PI*80*t):c=5.1:d=5:s=32000"
ffmpeg -v error -y -f lavfi -i "$SRC32"  -c:a ac3 -b:a 448k "$MEDIA/t32.ac3"

# Kanavamäärän vaihtuminen kesken virran: mono ja stereo peräkkäin samassa
# tiedostossa. Kirjastossa on tällaisia, ja kääreen ulostulopuskuri osaa
# pitää vain yhtä muotoa kerrallaan — tämä koettelee sen rajakohdan.
MONO="aevalsrc=0.5*sin(2*PI*440*t):c=mono:d=2:s=48000"
DUO="aevalsrc=0.5*sin(2*PI*440*t)|0.5*sin(2*PI*660*t):c=stereo:d=2:s=48000"
ffmpeg -v error -y -f lavfi -i "$MONO" -c:a ac3 -b:a  96k "$MEDIA/mono.ac3"
ffmpeg -v error -y -f lavfi -i "$DUO"  -c:a ac3 -b:a 192k "$MEDIA/st.ac3"
cat "$MEDIA/mono.ac3" "$MEDIA/st.ac3" > "$MEDIA/mix.ac3"

# Vertailu-PCM samalla ketjulla jota kääre käyttää: purkajan oma alaslaskenta
# ensin (-downmix), sitten swresample stereoksi (-ac 2). DTS:llä ensimmäinen
# ei tee mitään ja jälkimmäinen tekee kaiken; AC-3:lla toisin päin.
for f in "$MEDIA"/t51.ac3 "$MEDIA"/t51.eac3 "$MEDIA"/t51_192.eac3 "$MEDIA"/t2.eac3 \
         "$MEDIA"/t51.dts "$MEDIA"/mix.ac3 "$MEDIA"/t32.ac3; do
    ffmpeg -v error -y -downmix stereo -i "$f" -ac 2 -ar 48000 -f f32le -acodec pcm_f32le "$f.dref"
done

echo "--> vertailu"
node "$ROOT/dev/wasm/verify.mjs" "$MEDIA"
