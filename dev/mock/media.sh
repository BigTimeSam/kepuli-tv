#!/bin/sh
# Dummy media for the mock server: a "live" channel as HLS segments, an MP4
# movie and an MKV episode with English and Finnish subtitle tracks. Each is
# a slowly moving gradient with a title on it, made with ffmpeg; nothing
# real. The files go to dev/mock/media/, which is not in version control.
set -eu
DIR="$(cd "$(dirname "$0")" && pwd)/media"
SECS=120        # movie and episode
LIVE_SECS=120   # the live channel loops, so this is the loop length
mkdir -p "$DIR"

FONT=
for f in /System/Library/Fonts/Helvetica.ttc /usr/share/fonts/dejavu/DejaVuSans.ttf /usr/share/fonts/truetype/dejavu/DejaVuSans.ttf; do
  [ -f "$f" ] && FONT=$f && break
done
[ -n "$FONT" ] || { echo "no font found for drawtext" >&2; exit 1; }

# Video and audio sources shared by all three files.
# $1 title   $2 gradient colours
# $1 title   $2 gradient colours   $3 seconds
src() {
  printf -- '-f lavfi -i gradients=s=1280x720:r=25:%s:nb_colors=3:speed=0.01:duration=%s -f lavfi -t %s -i anullsrc=r=48000:cl=stereo' "$2" "$3" "$3"
}
text() {
  printf -- "drawtext=fontfile=$FONT:text='%s':fontcolor=white:fontsize=72:x=(w-tw)/2:y=(h-th)/2-30,drawtext=fontfile=$FONT:text='Demo content · %%{pts\\\\:hms}':fontcolor=0xffffffaa:fontsize=30:x=(w-tw)/2:y=(h-th)/2+56" "$1"
}
VIDEO="-c:v libx264 -preset veryfast -crf 26 -pix_fmt yuv420p -g 50"
AUDIO="-c:a aac -b:a 96k"

# The live channel: HLS segments of four seconds that the server loops into
# an endless playlist. Encoded at a constant 1.5 Mbit/s, filler included: a
# gradient compresses to almost nothing, and mpegts.js — which plays the
# catch-up stream made of these same segments — stashes 256 kB before it
# demuxes anything. A real channel runs at megabits per second.
echo "hls/ (the live channel)"
mkdir -p "$DIR/hls"; rm -f "$DIR/hls"/*
# shellcheck disable=SC2046
ffmpeg -y -hide_banner -loglevel error $(src 'Aurora One' 'c0=0x1b1040:c1=0x0b3b57:c2=0x7c5cff' "$LIVE_SECS") \
  -vf "$(text 'Aurora One')" \
  -c:v libx264 -preset veryfast -b:v 1500k -minrate 1500k -maxrate 1500k -bufsize 3000k \
  -x264-params nal-hrd=cbr -pix_fmt yuv420p -g 50 -keyint_min 50 -sc_threshold 0 $AUDIO \
  -f hls -hls_time 4 -hls_playlist_type vod -hls_flags independent_segments \
  -hls_segment_filename "$DIR/hls/%03d.ts" "$DIR/hls/index.m3u8"

echo "movie.mp4"
# shellcheck disable=SC2046
ffmpeg -y -hide_banner -loglevel error $(src 'Northern Lights' 'c0=0x10233a:c1=0x0f6b5c:c2=0x22d3ee' "$SECS") \
  -vf "$(text 'Northern Lights')" $VIDEO $AUDIO -movflags +faststart "$DIR/movie.mp4"

# Subtitles: a cue every four seconds so that one is always on screen.
cues() {   # $1 language file, remaining args: lines
  f=$1; shift; i=1; t=1
  : > "$f"
  while [ $# -gt 0 ]; do
    s=$t; e=$((t + 3))
    printf '%d\n00:%02d:%02d,000 --> 00:%02d:%02d,500\n%s\n\n' $i $((s / 60)) $((s % 60)) $((e / 60)) $((e % 60)) "$1" >> "$f"
    i=$((i + 1)); t=$((t + 4)); shift
  done
}
cues "$DIR/en.srt" \
  "We should head north before the storm closes the road." \
  "The harbour master said the ice is thin past the lighthouse." \
  "Then we go around it." \
  "You have never once gone around anything in your life." \
  "There is a first time for everything." \
  "The signal came from the old station again last night." \
  "Nobody has been up there in forty years." \
  "Somebody has." \
  "Pack the radio. And the good coffee." \
  "If we are not back by Sunday, tell Elina where we went." \
  "She already knows. She always knows." \
  "Start the engine." \
  "The road is closed from here on." \
  "Then we walk." \
  "It is eleven kilometres." \
  "Twelve, if you count the bridge." \
  "The bridge is gone." \
  "Then eleven." \
  "Look. The light is on." \
  "That light has not worked since 1986."
cues "$DIR/fi.srt" \
  "Meidän pitäisi lähteä pohjoiseen ennen kuin myrsky sulkee tien." \
  "Satamakapteeni sanoi, että jää on ohutta majakan takana." \
  "Sitten kierrämme sen." \
  "Et ole koskaan elämässäsi kiertänyt mitään." \
  "Kaikella on ensimmäinen kertansa." \
  "Signaali tuli taas vanhalta asemalta viime yönä." \
  "Siellä ei ole käynyt kukaan neljäänkymmeneen vuoteen." \
  "Joku on käynyt." \
  "Pakkaa radio. Ja ne hyvät kahvit." \
  "Jos emme ole takaisin sunnuntaina, kerro Elinalle minne menimme." \
  "Hän tietää jo. Hän tietää aina." \
  "Käynnistä moottori." \
  "Tie on suljettu tästä eteenpäin." \
  "Sitten kävelemme." \
  "Se on yksitoista kilometriä." \
  "Kaksitoista, jos silta lasketaan." \
  "Silta on poissa." \
  "Sitten yksitoista." \
  "Katso. Valo palaa." \
  "Se valo ei ole toiminut vuoden 1986 jälkeen."

echo "episode.mkv"
# shellcheck disable=SC2046
ffmpeg -y -hide_banner -loglevel error $(src 'Silent Fjord' 'c0=0x0b1a2e:c1=0x3a0ca3:c2=0x8f74ff' "$SECS") \
  -i "$DIR/en.srt" -i "$DIR/fi.srt" -map 0:v -map 1:a -map 2:s -map 3:s \
  -vf "$(text 'Silent Fjord')" $VIDEO $AUDIO -c:s srt \
  -metadata:s:s:0 language=eng -metadata:s:s:0 title=English \
  -metadata:s:s:1 language=fin -metadata:s:s:1 title=Suomi \
  "$DIR/episode.mkv"

# The same episode with AC-3 5.1 sound, for the route the player decodes
# itself: the wasm decoder and then the browser's own encoder, AAC in Chrome
# and Opus in Firefox. The server hands it out as the second episode of
# every first season. A tone per channel, as dev/wasm/build.sh does, so that
# a wrong channel map would be heard; the front pair beeps for the first
# tenth of every second, in step with the clock on the picture, so that the
# audio's lead or lag against the picture can be judged by ear.
echo "episode-ac3.mkv"
AC3="aevalsrc=0.5*sin(2*PI*880*t)*lt(mod(t\,1)\,0.1)|0.5*sin(2*PI*880*t)*lt(mod(t\,1)\,0.1)|0.3*sin(2*PI*330*t)|0.2*sin(2*PI*60*t)|0.25*sin(2*PI*440*t)|0.25*sin(2*PI*550*t):c=5.1:d=$SECS:s=48000"
ffmpeg -y -hide_banner -loglevel error \
  -f lavfi -i "gradients=s=1280x720:r=25:c0=0x2a0a1e:c1=0x7a1f4d:c2=0xff8f5c:nb_colors=3:speed=0.01:duration=$SECS" \
  -f lavfi -i "$AC3" -i "$DIR/en.srt" -i "$DIR/fi.srt" -map 0:v -map 1:a -map 2:s -map 3:s \
  -vf "$(text 'Ember Coast')" $VIDEO -c:a ac3 -b:a 384k -c:s srt \
  -metadata:s:s:0 language=eng -metadata:s:s:0 title=English \
  -metadata:s:s:1 language=fin -metadata:s:s:1 title=Suomi \
  "$DIR/episode-ac3.mkv"

ls -la "$DIR" "$DIR/hls" | head -20
