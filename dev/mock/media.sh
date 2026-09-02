#!/bin/sh
# Dummy media for the mock server: a "live" MPEG-TS channel, an MP4 movie and
# an MKV episode with English and Finnish subtitle tracks. Each is a slowly
# moving gradient with a title on it, made with ffmpeg; nothing real. The
# files go to dev/mock/media/, which is not in version control.
set -eu
DIR="$(cd "$(dirname "$0")" && pwd)/media"
FONT=/System/Library/Fonts/Helvetica.ttc
SECS=120        # movie and episode
LIVE_SECS=240   # the "live" channel: longer, because the server plays it out at real time
mkdir -p "$DIR"

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

# A constant 3 Mbit/s mux rate, null packets included: a gradient compresses to
# almost nothing, and the player stashes 256 kB before it demuxes anything.
# A real channel runs at megabits per second; the mock has to as well.
echo "live.ts"
# shellcheck disable=SC2046
ffmpeg -y -hide_banner -loglevel error $(src 'Aurora One' 'c0=0x1b1040:c1=0x0b3b57:c2=0x7c5cff' "$LIVE_SECS") \
  -vf "$(text 'Aurora One')" $VIDEO $AUDIO -f mpegts -muxrate 3000000 "$DIR/live.ts"
echo "$LIVE_SECS" > "$DIR/live.seconds"   # the server paces the stream by this

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

ls -la "$DIR"
