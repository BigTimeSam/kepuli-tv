package io.github.bigtimesam.kepulitv;

import android.app.Activity;
import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Path;
import android.graphics.RectF;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.LayoutInflater;
import android.view.MotionEvent;
import android.view.View;
import android.widget.FrameLayout;

import androidx.media3.common.C;
import androidx.media3.common.Format;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.TrackSelectionParameters;
import androidx.media3.common.Tracks;
import androidx.media3.common.VideoSize;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.ui.PlayerView;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * The app's own player, an experiment on the android-native-player branch:
 * what Media3's ExoPlayer plays by itself of what the page hands it (HLS
 * and the MP4 family; js/nativeplayer.js decides) is shown in a view of the
 * app's own, laid over the place of the page's picture, with Media3's
 * controls. The rest plays in the page as before, and so does whatever
 * this player fails on.
 *
 * It answers the page's player.* words, the same ones the app for the
 * iPhone and the iPad answers (ios/App/Player): player.load, player.frame
 * (the picture's box in the page and what of the page lies over it),
 * player.play, player.pause, player.seek, player.pip and player.stop; and
 * says player.state (loading, playing, paused, and idle with why: finished
 * or error) and player.track (a track the viewer chose). The page stays
 * the one that knows what plays.
 *
 * Nothing here logs an address or a title.
 */
final class NativePlayer {
    private static final String TAG = "kepuli";
    /** How often the place is said while the picture runs. */
    private static final long EVERY_MS = 2000;

    /** What the player asks of the activity around it. */
    interface Host {
        void say(JSONObject word);
        void fullScreen(boolean on);
        void smallWindow();
    }

    private final Activity activity;
    private final FrameLayout frame;
    private final Host host;
    private final Handler main = new Handler(Looper.getMainLooper());

    private ExoPlayer player;
    private Layer layer;
    private PlayerView view;
    /** The number the page gave what plays, said back with every word. */
    private int id;
    private boolean live;
    private boolean full;
    private String said = "";
    /** The languages last said to the page, so that a choice is said once. */
    private String audio;
    private String text;
    /** The box last asked for, in the frame's pixels. */
    private int[] box = { 0, 0, 0, 0 };

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            say(true);
            main.postDelayed(this, EVERY_MS);
        }
    };

    NativePlayer(Activity activity, FrameLayout frame, Host host) {
        this.activity = activity;
        this.frame = frame;
        this.host = host;
    }

    /** Whether the app's player has a picture on. */
    boolean on() { return player != null; }

    /** Whether it fills the screen: Back leaves that first. */
    boolean full() { return full; }

    void handle(String type, JSONObject word) {
        switch (type) {
            case "player.load": load(word); break;
            case "player.frame": place(word); break;
            case "player.stop": stop(); break;
            case "player.play": if (player != null) { player.play(); view.showController(); } break;
            case "player.pause": if (player != null) { player.pause(); view.showController(); } break;
            case "player.seek": if (player != null && !live) player.seekTo(Math.max(0, Math.round(word.optDouble("to", 0) * 1000))); break;
            case "player.pip": if (player != null) host.smallWindow(); break;
            default: break;
        }
    }

    private void load(JSONObject word) {
        String url = word.optString("url", "");
        if (!Rules.playable(url)) {
            idle(word.optInt("id"), "error", 0);
            return;
        }
        stop();
        id = word.optInt("id");
        live = word.optBoolean("live");
        audio = null;
        text = null;
        said = "";

        player = new ExoPlayer.Builder(activity).build();
        TrackSelectionParameters.Builder wanted = player.getTrackSelectionParameters().buildUpon();
        String audioLang = word.optString("audioLang", "auto");
        if (!audioLang.isEmpty() && !audioLang.equals("auto")) wanted.setPreferredAudioLanguage(audioLang);
        String subtitleLang = word.optString("subtitleLang", "off");
        if (subtitleLang.isEmpty() || subtitleLang.equals("off")) wanted.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true);
        else wanted.setPreferredTextLanguage(subtitleLang);
        player.setTrackSelectionParameters(wanted.build());

        layer = new Layer(activity);
        view = (PlayerView) LayoutInflater.from(activity).inflate(R.layout.native_player, layer, false);
        view.setPlayer(player);
        // A channel has no place to seek to.
        view.setShowRewindButton(!live);
        view.setShowFastForwardButton(!live);
        view.setShowPreviousButton(false);
        view.setShowNextButton(false);
        view.setFullscreenButtonClickListener(this::setFull);
        layer.addView(view, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        frame.addView(layer, new FrameLayout.LayoutParams(0, 0));
        lay();

        player.addListener(new Player.Listener() {
            @Override
            public void onPlaybackStateChanged(int state) {
                if (state == Player.STATE_ENDED) finish("finished");
                else say(false);
            }

            @Override
            public void onIsPlayingChanged(boolean playing) {
                say(false);
            }

            @Override
            public void onVideoSizeChanged(VideoSize size) {
                said = "";
                say(false);
            }

            @Override
            public void onPlayerError(PlaybackException error) {
                // The kind alone: the message can carry the address.
                Log.w(TAG, "the app's player failed: " + error.getErrorCodeName());
                finish("error");
            }

            @Override
            public void onTracksChanged(Tracks tracks) {
                chosen(tracks);
            }
        });
        player.setMediaItem(MediaItem.fromUri(Uri.parse(url)));
        double startAt = word.optDouble("startAt", 0);
        if (!live && startAt > 0) player.seekTo(Math.round(startAt * 1000));
        player.setPlayWhenReady(true);
        player.prepare();
        activity.getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        main.postDelayed(tick, EVERY_MS);
    }

    /** The picture's box in the page, and what of the page lies over it. */
    private void place(JSONObject word) {
        if (layer == null) return;
        double ratio = word.optDouble("ratio", activity.getResources().getDisplayMetrics().density);
        box = Rules.pixels(word.optDouble("left", word.optDouble("x", 0)), word.optDouble("top", word.optDouble("y", 0)),
                word.optDouble("width", 0), word.optDouble("height", 0), ratio);
        List<float[]> holes = new ArrayList<>();
        JSONArray said = word.optJSONArray("holes");
        for (int i = 0; said != null && i < said.length(); i++) {
            JSONObject hole = said.optJSONObject(i);
            if (hole == null) continue;
            int[] at = Rules.pixels(hole.optDouble("x", 0), hole.optDouble("y", 0), hole.optDouble("width", 0), hole.optDouble("height", 0), ratio);
            holes.add(new float[] { at[0], at[1], at[0] + at[2], at[1] + at[3], (float) (hole.optDouble("radius", 0) * ratio) });
        }
        layer.holes(full ? new ArrayList<>() : holes);
        lay();
    }

    /** The layer over the picture's box, or over everything when it fills the screen. */
    private void lay() {
        if (layer == null) return;
        FrameLayout.LayoutParams at = (FrameLayout.LayoutParams) layer.getLayoutParams();
        if (full) {
            at.width = FrameLayout.LayoutParams.MATCH_PARENT;
            at.height = FrameLayout.LayoutParams.MATCH_PARENT;
            at.leftMargin = 0;
            at.topMargin = 0;
        } else {
            at.leftMargin = box[0];
            at.topMargin = box[1];
            at.width = box[2];
            at.height = box[3];
        }
        layer.setLayoutParams(at);
        layer.setVisibility(full || (box[2] > 0 && box[3] > 0) ? View.VISIBLE : View.INVISIBLE);
    }

    /** The controls' own full screen button, and Back out of it. */
    void setFull(boolean on) {
        if (full == on) return;
        full = on;
        if (on && layer != null) layer.holes(new ArrayList<>());
        host.fullScreen(on);
        lay();
    }

    /** The small window shows the picture alone. */
    void small(boolean on) {
        if (view == null) return;
        view.setUseController(!on);
        if (on) view.hideController();
    }

    void stop() {
        main.removeCallbacks(tick);
        if (full) setFull(false);
        if (player != null) {
            player.release();
            player = null;
        }
        if (layer != null) {
            frame.removeView(layer);
            layer = null;
            view = null;
        }
        activity.getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    private double position() {
        return player == null ? 0 : Math.max(0, player.getCurrentPosition()) / 1000.0;
    }

    /** Where things stand, said when they change and, while the picture runs, every two seconds. */
    private void say(boolean again) {
        if (player == null) return;
        String now = Rules.state(player.getPlaybackState() == Player.STATE_READY, player.isPlaying());
        VideoSize size = player.getVideoSize();
        String key = now + " " + size.width + "x" + size.height;
        if (key.equals(said) && !(again && now.equals("playing"))) return;
        said = key;
        try {
            JSONObject word = new JSONObject().put("type", "player.state").put("id", id).put("state", now).put("position", position());
            long duration = player.getDuration();
            if (!live && duration != C.TIME_UNSET && duration > 0) word.put("duration", duration / 1000.0);
            if (size.width > 0 && size.height > 0) word.put("width", size.width).put("height", size.height);
            host.say(word);
        } catch (JSONException e) {
            Log.w(TAG, "the player's state not said", e);
        }
    }

    /** The end, or a failure: the page is told where the picture had got to, and the view goes. */
    private void finish(String reason) {
        int was = id;
        double at = position();
        stop();
        idle(was, reason, at);
    }

    private void idle(int of, String reason, double at) {
        try {
            host.say(new JSONObject().put("type", "player.state").put("id", of).put("state", "idle").put("reason", reason).put("position", at));
        } catch (JSONException e) {
            Log.w(TAG, "the player's end not said", e);
        }
    }

    /**
     * The tracks in force, said to the page when the viewer has changed
     * one in the controls' menu: the page keeps the language for the
     * coming films and episodes. The first set, chosen by the languages
     * the page gave, is not a choice of the viewer's.
     */
    private void chosen(Tracks tracks) {
        String nowAudio = language(tracks, C.TRACK_TYPE_AUDIO);
        String nowText = language(tracks, C.TRACK_TYPE_TEXT);
        if (audio != null && nowAudio != null && !nowAudio.equals(audio)) track("audio", nowAudio);
        if (text != null && !Rules.same(nowText, text)) track("subtitles", nowText);
        if (nowAudio != null) audio = nowAudio;
        text = nowText == null ? "" : nowText;
    }

    private static String language(Tracks tracks, int type) {
        for (Tracks.Group group : tracks.getGroups()) {
            if (group.getType() != type) continue;
            for (int i = 0; i < group.length; i++) {
                if (!group.isTrackSelected(i)) continue;
                Format format = group.getTrackFormat(i);
                return format.language == null ? "und" : format.language;
            }
        }
        return null;
    }

    private void track(String kind, String language) {
        try {
            JSONObject word = new JSONObject().put("type", "player.track").put("id", id).put("kind", kind);
            if (language != null && !language.isEmpty()) word.put("language", language);
            host.say(word);
        } catch (JSONException e) {
            Log.w(TAG, "the chosen track not said", e);
        }
    }

    /**
     * The box the player's view lies in. Where the page says something of
     * its own is drawn over the picture (a menu, a message), the layer
     * draws nothing and takes no touch: the page under it shows and is
     * pressed there.
     */
    private static final class Layer extends FrameLayout {
        private List<float[]> holes = new ArrayList<>();
        private final Path cut = new Path();
        /** A touch that began in a hole is the page's to its end. */
        private boolean pages;

        Layer(Context context) {
            super(context);
        }

        void holes(List<float[]> now) {
            holes = now;
            invalidate();
        }

        @Override
        protected void dispatchDraw(Canvas canvas) {
            if (holes.isEmpty()) {
                super.dispatchDraw(canvas);
                return;
            }
            int saved = canvas.save();
            for (float[] hole : holes) {
                cut.reset();
                cut.addRoundRect(new RectF(hole[0], hole[1], hole[2], hole[3]), hole[4], hole[4], Path.Direction.CW);
                canvas.clipOutPath(cut);
            }
            super.dispatchDraw(canvas);
            canvas.restoreToCount(saved);
        }

        @Override
        public boolean dispatchTouchEvent(MotionEvent event) {
            if (event.getActionMasked() == MotionEvent.ACTION_DOWN) {
                pages = false;
                for (float[] hole : holes) {
                    if (Rules.within(event.getX(), event.getY(), hole[0], hole[1], hole[2], hole[3])) pages = true;
                }
            }
            return !pages && super.dispatchTouchEvent(event);
        }
    }
}
