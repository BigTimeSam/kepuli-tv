package io.github.bigtimesam.kepulitv;

import android.app.Activity;
import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Path;
import android.graphics.RectF;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.LayoutInflater;
import android.view.Menu;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.PopupMenu;

import androidx.media3.common.C;
import androidx.media3.common.Format;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.TrackSelectionOverride;
import androidx.media3.common.TrackSelectionParameters;
import androidx.media3.common.Tracks;
import androidx.media3.common.VideoSize;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.ui.PlayerView;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * The app's own player, in both apps: what Media3's ExoPlayer plays by
 * itself of what the page hands it (HLS and the MP4 family;
 * js/nativeplayer.js decides) is shown in a view of the app's own, laid
 * over the place of the page's picture, under controls of the app's own
 * (PlayerControls), the ones the app for the iPhone and the iPad has.
 * The rest plays in the page as before, and so does whatever this player
 * fails on, under the same controls: the page says player.load with
 * page: true and no address, and where its own picture is with
 * player.page.
 *
 * It answers the page's player.* words, the same ones the app for the
 * iPhone and the iPad answers (ios/App/Player/NativePlayer.swift, where
 * they are listed): player.load, player.page, player.frame (the picture's
 * box in the window and what of the page lies over it), player.sound,
 * player.play, player.pause, player.seek, player.pip, player.stop and
 * player.shade (a dialog of the page's is open, with its backdrop); and
 * says player.state (loading, playing, paused, and idle with why: finished
 * or error), player.track (a track the viewer chose) and player.command
 * (a press that is the page's to do: play, pause and seek over the page's
 * own picture, full, and beside a second picture sound, swap and close).
 * The page stays the one that knows what plays.
 *
 * Two pictures side by side are two of these: every word names its slot,
 * 1 the picture and 2 the second beside it (none said is 1).
 *
 * On a television (controls: false in player.load) the picture is here
 * and nothing else: the remote drives the page, which draws its own marks
 * over the picture and says them as holes in it.
 *
 * Nothing here logs an address or a title.
 */
final class NativePlayer {
    private static final String TAG = "kepuli";
    /** How often the controls follow the picture, and how many of those go by between two words to the page. */
    private static final long EVERY_MS = 500;
    private static final int SAID_EVERY = 4;

    /** What the player asks of the activity around it. */
    interface Host {
        void say(JSONObject word);
        /** The picture into Android's small window; false where there is none. */
        boolean smallWindow(boolean go);
        /** Google's cast dialog; false where the app casts nothing. */
        boolean cast(boolean go);
    }

    private final Activity activity;
    private final FrameLayout frame;
    private final Host host;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Slot[] slots;
    private boolean small;
    /** The page's open dialog and its backdrop's colour, or none. */
    private boolean dialog;
    private int dim;

    NativePlayer(Activity activity, FrameLayout frame, Host host) {
        this.activity = activity;
        this.frame = frame;
        this.host = host;
        slots = new Slot[] { new Slot(1), new Slot(2) };
    }

    void handle(String type, JSONObject word) {
        if (type.equals("player.shade")) {
            shade(word);
            return;
        }
        slots[word.optInt("slot", 1) == 2 ? 1 : 0].handle(type, word);
    }

    /**
     * A dialog of the page is open, with this backdrop: it dims the page
     * behind it, and the app's pictures, which lie over the page, are
     * dimmed the same and take no touch until it closes.
     */
    private void shade(JSONObject word) {
        dialog = word.optBoolean("open");
        JSONArray rgba = word.optJSONArray("rgba");
        dim = rgba == null || rgba.length() != 4 ? 0
                : Color.argb((int) Math.round(rgba.optDouble(3, 0) * 255), rgba.optInt(0), rgba.optInt(1), rgba.optInt(2));
        for (Slot slot : slots) if (slot.layer != null) slot.layer.shade(dim, dialog);
    }

    /** The page went, or the app closes: nothing plays. */
    void stop() {
        for (Slot slot : slots) slot.stop();
    }

    /** The small window shows the picture alone. */
    void small(boolean on) {
        small = on;
        for (Slot slot : slots) slot.small(on);
    }

    /** The Cast mark in the accent's colour while a session is on. */
    void casting(boolean on) {
        for (Slot slot : slots) slot.casting(on);
    }

    /** The screen stays on while a picture of the app's own runs. */
    private void awake() {
        boolean any = false;
        for (Slot slot : slots) any |= slot.player != null;
        if (any) activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        else activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    /** One picture of the app's own, and what the page says to it. */
    private final class Slot implements PlayerControls.Presses {
        /** 1 the picture, 2 the second beside it. */
        private final int number;
        private ExoPlayer player;
        private Layer layer;
        private PlayerView view;
        private PlayerControls controls;
        /** The number the page gave what plays, said back with every word. */
        private int id;
        /** Whether anything is on in this slot, the app's picture or the controls over the page's. */
        private boolean on;
        private boolean live;
        /** The picture is the page's own, and only the controls are here. */
        private boolean page;
        private boolean pagePaused;
        private boolean casting;
        private boolean heard = true;
        private boolean speaker;
        private boolean full;
        private String said = "";
        private int ticks;
        /** The languages last said to the page, so that a choice is said once. */
        private String audio;
        private String text;
        private Map<String, String> labels = new HashMap<>();
        /** The box and the holes last asked for, in the frame's pixels: they outlive what plays. */
        private int[] box = { 0, 0, 0, 0 };
        private List<float[]> holes = new ArrayList<>();

        private final Runnable tick = new Runnable() {
            @Override
            public void run() {
                follow();
                if (++ticks % SAID_EVERY == 0) say(true);
                main.postDelayed(this, EVERY_MS);
            }
        };

        Slot(int number) {
            this.number = number;
        }

        void handle(String type, JSONObject word) {
            switch (type) {
                case "player.load": load(word); break;
                case "player.page": paged(word); break;
                case "player.frame": place(word); break;
                case "player.sound":
                    heard = word.optBoolean("on", true);
                    speaker = word.optBoolean("offered", false);
                    sound();
                    break;
                case "player.stop": stop(); break;
                // At the page's word the controls show, as at a touch: what
                // was paused from elsewhere says so.
                case "player.play": if (player != null) { player.play(); controls.show(); } break;
                case "player.pause": if (player != null) { player.pause(); controls.show(); } break;
                case "player.seek":
                    if (player != null && !live) {
                        player.seekTo(Math.max(0, Math.round(word.optDouble("to", 0) * 1000)));
                        controls.show();
                    }
                    break;
                case "player.pip": if (player != null) host.smallWindow(true); break;
                default: break;
            }
        }

        private void load(JSONObject word) {
            boolean own = word.optBoolean("page");
            String url = word.optString("url", "");
            if (!own && !Rules.playable(url)) {
                idle(word.optInt("id"), "error", 0);
                return;
            }
            stop();
            on = true;
            id = word.optInt("id");
            live = word.optBoolean("live");
            page = own;
            pagePaused = false;
            audio = null;
            text = null;
            said = "";
            ticks = 0;
            labels = new HashMap<>();
            JSONObject words = word.optJSONObject("labels");
            for (Iterator<String> keys = words == null ? null : words.keys(); keys != null && keys.hasNext();) {
                String key = keys.next();
                labels.put(key, words.optString(key));
            }

            layer = new Layer(activity);
            controls = new PlayerControls(activity, this);
            controls.setSecond(number == 2);
            controls.setBare(!word.optBoolean("controls", true));
            controls.offers(host.cast(false), host.smallWindow(false));
            controls.setCasting(casting);
            controls.setAway(small);
            controls.setSound(heard, speaker);
            controls.setFull(full);
            controls.show(word.optString("title", ""), word.optString("subtitle", ""), live, labels);
            if (!own) build(word, url);
            layer.addView(controls, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
            // The second picture's layer under the first's menus, in the order the slots are.
            frame.addView(layer, new FrameLayout.LayoutParams(0, 0));
            layer.holes(holes);
            layer.shade(dim, dialog);
            lay();
            awake();
            if (!own) main.postDelayed(tick, EVERY_MS);
        }

        /** The app's own picture: the player, its view under the controls, and what it says as it goes. */
        private void build(JSONObject word, String url) {
            // Everything the player fetches comes over http or https: the
            // stream itself and whatever a playlist of the provider's names in
            // it. Media3's usual source also reads files, content: addresses
            // and the app's assets, which a provider's playlist could then have
            // pointed at. A redirect from http to https or back is followed, as
            // the engine follows it for the page's own picture (providers send
            // a stream on to another of their servers that way): this source
            // speaks nothing but the two, so a redirect leads nowhere else.
            DefaultHttpDataSource.Factory web = new DefaultHttpDataSource.Factory().setAllowCrossProtocolRedirects(true);
            // No more than 64 MB of the stream held ahead, whatever its
            // bitrate: a television has little memory to spare, and the
            // player's own measure by time alone lets a 4K film take twice that.
            DefaultLoadControl load = new DefaultLoadControl.Builder()
                .setTargetBufferBytes(64 * 1024 * 1024).setPrioritizeTimeOverSizeThresholds(false).build();
            player = new ExoPlayer.Builder(activity).setMediaSourceFactory(new DefaultMediaSourceFactory(web)).setLoadControl(load).build();
            TrackSelectionParameters.Builder wanted = player.getTrackSelectionParameters().buildUpon();
            String audioLang = word.optString("audioLang", "auto");
            if (!audioLang.isEmpty() && !audioLang.equals("auto")) wanted.setPreferredAudioLanguage(audioLang);
            String subtitleLang = word.optString("subtitleLang", "off");
            if (subtitleLang.isEmpty() || subtitleLang.equals("off")) wanted.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true);
            else wanted.setPreferredTextLanguage(subtitleLang);
            player.setTrackSelectionParameters(wanted.build());
            sound();

            view = (PlayerView) LayoutInflater.from(activity).inflate(R.layout.native_player, layer, false);
            view.setPlayer(player);
            layer.addView(view, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
            controls.setWaiting(true);

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
                    // A picture or a sound the device has no decoder for (AC-3
                    // on many phones): the player would go on without it, a
                    // film with no sound. The page's own player has decoders
                    // of its own and takes the address instead.
                    for (int type : new int[] { C.TRACK_TYPE_VIDEO, C.TRACK_TYPE_AUDIO }) {
                        if (tracks.containsType(type) && !tracks.isTypeSupported(type)) {
                            Log.w(TAG, "the app's player has no decoder for " + (type == C.TRACK_TYPE_VIDEO ? "the picture" : "the sound"));
                            finish("error");
                            return;
                        }
                    }
                    chosen(tracks);
                }
            });
            player.setMediaItem(MediaItem.fromUri(Uri.parse(url)));
            double startAt = word.optDouble("startAt", 0);
            if (!live && startAt > 0) player.seekTo(Math.round(startAt * 1000));
            player.setPlayWhenReady(true);
            player.prepare();
        }

        /**
         * Where the page's own picture is: the controls follow it as they
         * follow the app's. A picture with no length is live, whatever it
         * was started as (a recording in the making, a channel's archive).
         */
        private void paged(JSONObject word) {
            if (!page || controls == null || word.optInt("id") != id) return;
            pagePaused = "paused".equals(word.optString("state"));
            double duration = word.optDouble("duration", Double.NaN);
            boolean none = !(duration > 0);
            if (controls.live() != none) controls.setLive(none);
            controls.place(pagePaused, word.optDouble("position", 0), duration);
        }

        /** The controls follow the app's picture. */
        private void follow() {
            if (player == null || controls == null) return;
            long duration = player.getDuration();
            boolean waits = player.getPlaybackState() != Player.STATE_READY;
            controls.setWaiting(waits);
            controls.place(!player.getPlayWhenReady(), position(), !live && duration != C.TIME_UNSET && duration > 0 ? duration / 1000.0 : Double.NaN);
        }

        /** Heard, or silent beside the picture that is; and whether the speaker shows. */
        private void sound() {
            if (player != null) player.setVolume(heard ? 1 : 0);
            if (controls != null) controls.setSound(heard, speaker);
        }

        void casting(boolean now) {
            casting = now;
            if (controls != null) controls.setCasting(now);
        }

        /* ------------------------------------------------------ the presses */

        @Override
        public void press(String what, double to) {
            if (!on) return;
            switch (what) {
                case "toggle":
                    if (page) {
                        // Shown at once; the page's word follows and settles it.
                        command(pagePaused ? "play" : "pause", Double.NaN);
                        pagePaused = !pagePaused;
                    } else if (player != null) {
                        if (player.getPlayWhenReady()) player.pause(); else player.play();
                        follow();
                    }
                    break;
                case "seek":
                    if (page) command("seek", to);
                    else if (player != null && !live) player.seekTo(Math.round(to * 1000));
                    break;
                case "pip":
                    if (page) command("pip", Double.NaN); else host.smallWindow(true);
                    break;
                case "cast": host.cast(true); break;
                case "tracks": tracks(); break;
                // Full screen is the page's to make, whichever picture it
                // is: the picture's box follows it, and so does this view.
                // The speaker, the swap and the close are the page's too,
                // as it knows both pictures.
                default: command(what, Double.NaN); break;
            }
        }

        private void command(String what, double to) {
            try {
                JSONObject word = new JSONObject().put("type", "player.command").put("slot", number).put("id", id).put("what", what);
                if (!Double.isNaN(to)) word.put("to", to);
                host.say(word);
            } catch (JSONException e) {
                Log.w(TAG, "a press not said to the page", e);
            }
        }

        /**
         * The stream's own subtitles and sound tracks, as a menu on the
         * button of the top bar.
         */
        private void tracks() {
            if (player == null || controls == null) return;
            PopupMenu menu = new PopupMenu(activity, controls.tracksButton());
            Menu items = menu.getMenu();
            List<Tracks.Group> groups = player.getCurrentTracks().getGroups();
            List<int[]> choices = new ArrayList<>();
            boolean texts = false;
            boolean shown = false;
            for (Tracks.Group group : groups) {
                if (group.getType() != C.TRACK_TYPE_TEXT) continue;
                texts = true;
                shown |= group.isSelected();
            }
            if (texts) {
                items.add(Menu.NONE, Menu.NONE, Menu.NONE, word("subtitles", "Subtitles")).setEnabled(false);
                choices.add(new int[] { C.TRACK_TYPE_TEXT, -1, -1 });
                items.add(1, choices.size(), Menu.NONE, word("off", "Off")).setCheckable(true).setChecked(!shown);
            }
            int sounds = 0;
            for (Tracks.Group group : groups) if (group.getType() == C.TRACK_TYPE_AUDIO) sounds += group.length;
            for (int type : new int[] { C.TRACK_TYPE_TEXT, C.TRACK_TYPE_AUDIO }) {
                if (type == C.TRACK_TYPE_AUDIO) {
                    if (sounds < 2) continue;
                    items.add(Menu.NONE, Menu.NONE, Menu.NONE, word("audio", "Audio")).setEnabled(false);
                }
                for (int g = 0; g < groups.size(); g++) {
                    Tracks.Group group = groups.get(g);
                    if (group.getType() != type) continue;
                    for (int i = 0; i < group.length; i++) {
                        if (!group.isTrackSupported(i)) continue;
                        choices.add(new int[] { type, g, i });
                        items.add(1, choices.size(), Menu.NONE, name(group.getTrackFormat(i), choices.size())).setCheckable(true).setChecked(group.isTrackSelected(i));
                    }
                }
            }
            menu.setOnMenuItemClickListener((item) -> {
                if (player == null || item.getItemId() < 1 || item.getItemId() > choices.size()) return false;
                int[] choice = choices.get(item.getItemId() - 1);
                TrackSelectionParameters.Builder wanted = player.getTrackSelectionParameters().buildUpon();
                if (choice[1] < 0) {
                    wanted.clearOverridesOfType(choice[0]).setTrackTypeDisabled(choice[0], true);
                } else {
                    List<Tracks.Group> now = player.getCurrentTracks().getGroups();
                    if (choice[1] >= now.size()) return false;
                    wanted.setTrackTypeDisabled(choice[0], false)
                            .setOverrideForType(new TrackSelectionOverride(now.get(choice[1]).getMediaTrackGroup(), choice[2]));
                }
                player.setTrackSelectionParameters(wanted.build());
                return true;
            });
            menu.show();
        }

        private String word(String key, String or) {
            String word = labels.get(key);
            return word == null || word.isEmpty() ? or : word;
        }

        /** A track by its own name, else by its language in the viewer's, else by its number. */
        private String name(Format format, int number) {
            if (format.label != null && !format.label.isEmpty()) return format.label;
            if (format.language != null && !format.language.isEmpty() && !format.language.equals("und")) {
                String language = Locale.forLanguageTag(format.language).getDisplayLanguage();
                if (!language.isEmpty()) return language;
            }
            return String.valueOf(number);
        }

        /* --------------------------------------------------------- its place */

        /** The picture's box in the page, and what of the page lies over it. */
        private void place(JSONObject word) {
            double ratio = word.optDouble("ratio", activity.getResources().getDisplayMetrics().density);
            box = Rules.pixels(word.optDouble("left", word.optDouble("x", 0)), word.optDouble("top", word.optDouble("y", 0)),
                    word.optDouble("width", 0), word.optDouble("height", 0), ratio);
            List<float[]> now = new ArrayList<>();
            JSONArray said = word.optJSONArray("holes");
            for (int i = 0; said != null && i < said.length(); i++) {
                JSONObject hole = said.optJSONObject(i);
                if (hole == null) continue;
                int[] at = Rules.pixels(hole.optDouble("x", 0), hole.optDouble("y", 0), hole.optDouble("width", 0), hole.optDouble("height", 0), ratio);
                now.add(new float[] { at[0], at[1], at[0] + at[2], at[1] + at[3], (float) (hole.optDouble("radius", 0) * ratio) });
            }
            holes = now;
            full = word.optBoolean("full");
            if (layer == null) return;
            layer.holes(holes);
            controls.setFull(full);
            lay();
        }

        /** The layer over the picture's box. */
        private void lay() {
            if (layer == null) return;
            FrameLayout.LayoutParams at = (FrameLayout.LayoutParams) layer.getLayoutParams();
            at.leftMargin = box[0];
            at.topMargin = box[1];
            at.width = box[2];
            at.height = box[3];
            layer.setLayoutParams(at);
            layer.setVisibility(box[2] > 0 && box[3] > 0 ? View.VISIBLE : View.INVISIBLE);
        }

        void small(boolean now) {
            if (controls != null) controls.setAway(now);
        }

        void stop() {
            main.removeCallbacks(tick);
            on = false;
            if (player != null) {
                player.release();
                player = null;
            }
            if (layer != null) {
                frame.removeView(layer);
                layer = null;
                view = null;
                controls = null;
            }
            awake();
        }

        private double position() {
            return player == null ? 0 : Math.max(0, player.getCurrentPosition()) / 1000.0;
        }

        /** Where things stand, said when they change and, while the picture runs, every two seconds. */
        private void say(boolean again) {
            if (player == null) return;
            follow();
            String now = Rules.state(player.getPlaybackState() == Player.STATE_READY, player.isPlaying());
            VideoSize size = player.getVideoSize();
            String key = now + " " + size.width + "x" + size.height;
            if (key.equals(said) && !(again && now.equals("playing"))) return;
            said = key;
            try {
                JSONObject word = new JSONObject().put("type", "player.state").put("slot", number).put("id", id).put("state", now).put("position", position());
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
                host.say(new JSONObject().put("type", "player.state").put("slot", number).put("id", of).put("state", "idle").put("reason", reason).put("position", at));
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
            int texts = 0;
            int sounds = 0;
            for (Tracks.Group group : tracks.getGroups()) {
                if (group.getType() == C.TRACK_TYPE_TEXT) texts += group.length;
                else if (group.getType() == C.TRACK_TYPE_AUDIO) sounds += group.length;
            }
            if (controls != null) controls.setTracks(texts > 0 || sounds > 1);
            String nowAudio = language(tracks, C.TRACK_TYPE_AUDIO);
            String nowText = language(tracks, C.TRACK_TYPE_TEXT);
            if (audio != null && nowAudio != null && !nowAudio.equals(audio)) track("audio", nowAudio);
            if (text != null && !Rules.same(nowText, text)) track("subtitles", nowText);
            if (nowAudio != null) audio = nowAudio;
            text = nowText == null ? "" : nowText;
        }

        private String language(Tracks tracks, int type) {
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
                JSONObject word = new JSONObject().put("type", "player.track").put("slot", number).put("id", id).put("kind", kind);
                if (language != null && !language.isEmpty()) word.put("language", language);
                host.say(word);
            } catch (JSONException e) {
                Log.w(TAG, "the chosen track not said", e);
            }
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
        private int dim;
        /** Under a dialog of the page's nothing here is pressed. */
        private boolean closed;

        Layer(Context context) {
            super(context);
        }

        void holes(List<float[]> now) {
            holes = now;
            invalidate();
        }

        /** The page's dialog and its backdrop over the picture, or none. */
        void shade(int colour, boolean open) {
            dim = open ? colour : 0;
            closed = open;
            invalidate();
        }

        @Override
        protected void dispatchDraw(Canvas canvas) {
            if (holes.isEmpty()) {
                super.dispatchDraw(canvas);
                if (dim != 0) canvas.drawColor(dim);
                return;
            }
            int saved = canvas.save();
            for (float[] hole : holes) {
                cut.reset();
                cut.addRoundRect(new RectF(hole[0], hole[1], hole[2], hole[3]), hole[4], hole[4], Path.Direction.CW);
                canvas.clipOutPath(cut);
            }
            super.dispatchDraw(canvas);
            if (dim != 0) canvas.drawColor(dim);
            canvas.restoreToCount(saved);
        }

        @Override
        public boolean dispatchTouchEvent(MotionEvent event) {
            if (closed) return false;
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
