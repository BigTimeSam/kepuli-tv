package io.github.bigtimesam.kepulitv;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.util.Log;
import android.view.ContextThemeWrapper;

import androidx.mediarouter.app.MediaRouteChooserDialog;
import androidx.mediarouter.app.MediaRouteControllerDialog;
import androidx.mediarouter.media.MediaRouteSelector;
import androidx.mediarouter.media.MediaRouter;

import com.google.android.gms.cast.CastDevice;
import com.google.android.gms.cast.MediaInfo;
import com.google.android.gms.cast.MediaLoadRequestData;
import com.google.android.gms.cast.MediaMetadata;
import com.google.android.gms.cast.MediaStatus;
import com.google.android.gms.cast.framework.CastContext;
import com.google.android.gms.cast.framework.CastSession;
import com.google.android.gms.cast.framework.SessionManagerListener;
import com.google.android.gms.cast.framework.media.RemoteMediaClient;
import com.google.android.gms.common.api.CommonStatusCodes;
import com.google.android.gms.common.images.WebImage;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.Executors;

/**
 * The Google Cast sender behind the page's cast.* messages (js/cast.js,
 * NativeCast; the session on the page is js/castui.js).
 *
 * The app's engine has no way to a Chromecast of its own, so the device is
 * reached the one way left: Google's sender hands it an address and the
 * device fetches the stream by itself. The page draws its own two buttons;
 * every dialog is Google's (the devices, the session with its volume, the
 * remote control), which is what the Cast terms ask for.
 *
 * The page sends cast.prompt, cast.load {id, url, contentType, live, hls?,
 * startAt, title, subtitle, image?}, cast.stop, cast.end, cast.controls.
 * The app says cast.state {state, device, devices, position?, stale?} at
 * every change of the session or of the devices found and when a page
 * connects, and cast.media {state, reason, position, duration} at every
 * change of what the device plays, and every 5 s while it plays.
 *
 * Nothing here logs an address or a title, in any build: the address
 * carries the account's credentials.
 *
 * Google's sender is not started before the viewer first asks to cast
 * (cast.prompt), and starts with the app after that, so that the page's
 * button can show when a device is near: an app whose viewer never casts
 * says nothing to Google and does not search the network.
 */
final class CastService implements SessionManagerListener<CastSession> {
    /** Where the words to the page go; the page may not be there. */
    interface Line {
        void say(JSONObject message);
    }

    private static final String TAG = "KepuliCast";
    private static final String PREFS = "cast";
    /** The viewer has asked to cast once: see the class's note. */
    private static final String USED = "used";

    private final Activity activity;
    private final Line line;
    private final SharedPreferences prefs;

    /** Google's sender, once it has been started. */
    private CastContext context;
    private boolean starting;
    private MediaRouter router;
    private MediaRouteSelector selector;
    /** The activity is in sight: devices are looked for only then. */
    private boolean inSight;
    private boolean searching;

    private String session = "disconnected";
    private String device;
    /** The device's media client while its media is followed. */
    private RemoteMediaClient client;
    /** Where the device had got to when last heard, seconds, for `disconnected`. */
    private Double position;
    /** From a suspension until the device's picture is heard running again. */
    private boolean unheard;
    /** The cast.load requests the device has not answered yet, by the page's id. */
    private final Set<Integer> loads = new HashSet<>();
    /** cast.stop came while the device was still fetching what it was handed. */
    private boolean stopWhenLoaded;
    /** The media's state as the page heard it last, or null when it is to be said whatever it is. */
    private String saidMedia;
    /** The count the page heard last: routes change far more often than the count moves. */
    private int saidDevices = -1;

    private final MediaRouter.Callback routes = new MediaRouter.Callback() {
        @Override
        public void onRouteAdded(MediaRouter r, MediaRouter.RouteInfo route) { counted(); }

        @Override
        public void onRouteRemoved(MediaRouter r, MediaRouter.RouteInfo route) { counted(); }

        @Override
        public void onRouteChanged(MediaRouter r, MediaRouter.RouteInfo route) { counted(); }
    };

    private final RemoteMediaClient.Callback media = new RemoteMediaClient.Callback() {
        @Override
        public void onStatusUpdated() { sayMedia(false); }
    };

    private final RemoteMediaClient.ProgressListener progress = (at, length) -> {
        MediaStatus status = client != null ? client.getMediaStatus() : null;
        if (status != null && status.getPlayerState() == MediaStatus.PLAYER_STATE_PLAYING) sayMedia(false);
    };

    CastService(Activity activity, Line line) {
        this.activity = activity;
        this.line = line;
        prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (prefs.getBoolean(USED, false)) start(null);
    }

    /**
     * Google's sender started, and `then` run when it is there. Without
     * Google Play services on the device it never is: nothing is shown,
     * and the page's button stays as it was.
     */
    private void start(Runnable then) {
        if (context != null) {
            if (then != null) then.run();
            return;
        }
        if (starting) return;
        starting = true;
        CastContext.getSharedInstance(activity.getApplicationContext(), Executors.newSingleThreadExecutor())
                .addOnSuccessListener(activity, made -> {
                    starting = false;
                    context = made;
                    router = MediaRouter.getInstance(activity.getApplicationContext());
                    selector = made.getMergedSelector();
                    made.getSessionManager().addSessionManagerListener(this, CastSession.class);
                    // A session of an earlier run of the app, which the
                    // sender has kept or taken up again by itself.
                    CastSession current = made.getSessionManager().getCurrentCastSession();
                    if (current != null && current.isConnected()) {
                        session = "connected";
                        device = name(current);
                        follow(current.getRemoteMediaClient());
                    }
                    watch();
                    sayState();
                    if (client != null) sayMedia(false);
                    if (then != null) then.run();
                })
                .addOnFailureListener(activity, e -> {
                    starting = false;
                    Log.w(TAG, "Google's Cast sender did not start: " + e.getClass().getSimpleName());
                });
    }

    // ------------------------------------------------------------ the page

    /** A cast.* message of the page's. */
    void handle(String type, JSONObject body) {
        switch (type) {
            case "cast.prompt":
                prefs.edit().putBoolean(USED, true).apply();
                start(this::prompt);
                break;
            case "cast.load":
                load(body);
                break;
            case "cast.stop":
                // The media stops, the session stays for the next thing
                // chosen. With nothing loaded there is nothing to ask of
                // the device; one still fetching what it was handed (the
                // viewer left it meanwhile) is stopped when it has taken
                // the stream, or it would go on to play it, on the
                // account's one connection.
                if (showing()) client.stop();
                else if (!loads.isEmpty()) stopWhenLoaded = true;
                break;
            case "cast.end":
                if (context != null) context.getSessionManager().endCurrentSession(true);
                break;
            case "cast.controls":
                if (showing()) activity.startActivity(new Intent(activity, CastControlsActivity.class));
                break;
            default:
                answer(body.optInt("id", 0), "unknown");
        }
    }

    /**
     * A page connected or reloaded. During a session the media is said
     * too: a page loaded again finds the device playing by it.
     */
    void pageConnected() {
        // What the page before this one was still waiting for has no one to hear it.
        loads.clear();
        saidMedia = null;
        sayState();
        if (session.equals("connected")) sayMedia(false);
    }

    /** The activity came into sight or went out of it: devices are looked for while it is in sight. */
    void inSight(boolean on) {
        inSight = on;
        if (on) watch();
        else if (router != null) router.removeCallback(routes);
    }

    private void watch() {
        if (router == null || !inSight) return;
        router.addCallback(selector, routes, MediaRouter.CALLBACK_FLAG_REQUEST_DISCOVERY);
        searching = true;
        counted();
    }

    /** Google's own dialog: the devices, or the session while there is one. */
    private void prompt() {
        if (activity.isFinishing() || activity.isDestroyed()) return;
        // The dialogs are AppCompat's and want its theme, which the
        // activity, a plain one, does not have.
        Context themed = new ContextThemeWrapper(activity, androidx.appcompat.R.style.Theme_AppCompat_DayNight);
        if (!session.equals("disconnected")) {
            new MediaRouteControllerDialog(themed).show();
            return;
        }
        MediaRouteChooserDialog chooser = new MediaRouteChooserDialog(themed);
        chooser.setRouteSelector(selector);
        chooser.show();
    }

    private boolean showing() {
        MediaStatus status = client != null ? client.getMediaStatus() : null;
        if (status == null) return false;
        int state = status.getPlayerState();
        return state != MediaStatus.PLAYER_STATE_IDLE && state != MediaStatus.PLAYER_STATE_UNKNOWN;
    }

    /**
     * The answer waits for the device: it fetches the stream before it
     * accepts. The page takes no word about the media until then, so a
     * refusal has to be this answer and nothing else.
     */
    private void load(JSONObject body) {
        int id = body.optInt("id", 0);
        CastSession current = context != null ? context.getSessionManager().getCurrentCastSession() : null;
        RemoteMediaClient to = current != null && session.equals("connected") ? current.getRemoteMediaClient() : null;
        if (to == null) {
            answer(id, "no-session");
            return;
        }
        MediaLoadRequestData request = request(body);
        if (request == null) {
            answer(id, "refused");
            return;
        }
        // What the device had got to belongs to what it played before.
        position = null;
        stopWhenLoaded = false;
        loads.add(id);
        to.load(request).setResultCallback(result -> {
            // Answered already: the session ended meanwhile, or the page went.
            if (!loads.remove(id)) return;
            int code = result.getStatus().getStatusCode();
            if (!result.getStatus().isSuccess()) {
                // Replaced by a newer load or cancelled by a stop as well:
                // the page has moved on and no longer waits for this one.
                Log.i(TAG, "the load failed, code " + code);
                answer(id, code == CommonStatusCodes.TIMEOUT ? "timeout" : "refused");
                return;
            }
            answer(id, null);
            if (stopWhenLoaded && loads.isEmpty()) {
                stopWhenLoaded = false;
                if (client != null) client.stop();
            }
            // The page was deaf to the media while it waited: what the
            // device does now is said again after the answer.
            saidMedia = null;
            sayMedia(false);
        });
    }

    /** cast.load's fields as the device is handed them, or null for what is no stream's address. */
    private static MediaLoadRequestData request(JSONObject body) {
        String url = body.optString("url", "");
        String scheme = Uri.parse(url).getScheme();
        String type = body.optString("contentType", "");
        if (scheme == null || !(scheme.equalsIgnoreCase("http") || scheme.equalsIgnoreCase("https")) || type.isEmpty()) return null;
        boolean live = body.optBoolean("live", false);
        // A film or an episode is a "movie" to the device's own display and
        // to Google's controls (a seek bar, a duration); a channel is not.
        MediaMetadata metadata = new MediaMetadata(live ? MediaMetadata.MEDIA_TYPE_GENERIC : MediaMetadata.MEDIA_TYPE_MOVIE);
        String title = body.optString("title", ""), subtitle = body.optString("subtitle", "");
        if (!title.isEmpty()) metadata.putString(MediaMetadata.KEY_TITLE, title);
        if (!subtitle.isEmpty()) metadata.putString(MediaMetadata.KEY_SUBTITLE, subtitle);
        // Google's controls fetch the picture in the app, which is not
        // allowed plain http: the page sends an https one or none, and it
        // is held to here too.
        String image = body.optString("image", "");
        if (image.regionMatches(true, 0, "https:", 0, 6)) metadata.addImage(new WebImage(Uri.parse(image)));
        // Receivers older than the content URL read the address from the id.
        MediaInfo.Builder info = new MediaInfo.Builder(url)
                .setContentUrl(url)
                .setStreamType(live ? MediaInfo.STREAM_TYPE_LIVE : MediaInfo.STREAM_TYPE_BUFFERED)
                .setContentType(type)
                .setMetadata(metadata);
        // Without these the device's player guesses an HLS stream's
        // segments, and guesses wrong for a provider's MPEG-TS ones.
        String hls = body.optString("hls", "");
        if (hls.equals("ts")) info.setHlsSegmentFormat("ts").setHlsVideoSegmentFormat("mpeg2_ts");
        else if (hls.equals("fmp4")) info.setHlsSegmentFormat("fmp4").setHlsVideoSegmentFormat("fmp4");
        MediaLoadRequestData.Builder request = new MediaLoadRequestData.Builder().setMediaInfo(info.build()).setAutoplay(true);
        double start = body.optDouble("startAt", 0);
        if (!live && start > 0 && !Double.isInfinite(start)) request.setCurrentTime(Math.round(start * 1000));
        return request.build();
    }

    // ------------------------------------------------ what the page is told

    private void say(JSONObject message) {
        line.say(message);
    }

    /** The answer to a message sent with an id: ok, or the reason it was not. */
    private void answer(int id, String error) {
        if (id == 0) return;
        try {
            JSONObject message = new JSONObject().put("re", id).put("ok", error == null);
            if (error != null) message.put("error", error);
            say(message);
        } catch (JSONException e) {
            Log.w(TAG, "an answer was not said", e);
        }
    }

    /** The devices found, or -1 while nothing has looked for any. */
    private int devices() {
        if (!searching) return -1;
        int count = 0;
        for (MediaRouter.RouteInfo route : router.getRoutes()) {
            if (!route.isDefault() && route.isEnabled() && route.matchesSelector(selector)) count++;
        }
        return count;
    }

    private void counted() {
        if (devices() != saidDevices) sayState();
    }

    private void sayState() {
        saidDevices = devices();
        boolean gone = session.equals("disconnected");
        try {
            JSONObject message = new JSONObject().put("type", "cast.state").put("state", session)
                    .put("device", gone || device == null ? JSONObject.NULL : device).put("devices", saidDevices);
            if (gone && unheard) message.put("stale", true);
            else if (gone && position != null) message.put("position", position.doubleValue());
            say(message);
        } catch (JSONException e) {
            Log.w(TAG, "the session's state was not said", e);
        }
    }

    /** `gone`: asked at a resumption, the device has nothing on any more. */
    private void sayMedia(boolean gone) {
        MediaStatus status = client != null ? client.getMediaStatus() : null;
        notePosition();
        String state;
        switch (status != null ? status.getPlayerState() : MediaStatus.PLAYER_STATE_UNKNOWN) {
            case MediaStatus.PLAYER_STATE_LOADING: state = "loading"; break;
            case MediaStatus.PLAYER_STATE_BUFFERING: state = "buffering"; break;
            case MediaStatus.PLAYER_STATE_PLAYING: state = "playing"; break;
            case MediaStatus.PLAYER_STATE_PAUSED: state = "paused"; break;
            default: state = "idle";   // idle, and unknown: no media session yet
        }
        Object reason = JSONObject.NULL;
        if (state.equals("idle")) {
            switch (status != null ? status.getIdleReason() : MediaStatus.IDLE_REASON_NONE) {
                case MediaStatus.IDLE_REASON_FINISHED: reason = "finished"; break;
                case MediaStatus.IDLE_REASON_CANCELED: reason = "stopped"; break;
                case MediaStatus.IDLE_REASON_INTERRUPTED: reason = "interrupted"; break;
                case MediaStatus.IDLE_REASON_ERROR: reason = "error"; break;
                default: if (gone && status == null) reason = "gone";
            }
        }
        long length = client != null ? client.getStreamDuration() : 0;
        try {
            JSONObject message = new JSONObject().put("type", "cast.media").put("state", state).put("reason", reason)
                    .put("position", client != null ? client.getApproximateStreamPosition() / 1000.0 : 0)
                    .put("duration", length > 0 ? (Object) (length / 1000.0) : JSONObject.NULL);
            // The sender reports one change several times over (measured:
            // each status twice): the same words are said once.
            String words = message.toString();
            if (words.equals(saidMedia)) return;
            saidMedia = words;
            say(message);
        } catch (JSONException e) {
            Log.w(TAG, "the media's state was not said", e);
        }
    }

    /**
     * Kept only from a picture that runs: a stream still loading reports
     * zero, which would send a film handed over at its middle back to its
     * beginning. A picture that runs is also the device heard again.
     */
    private void notePosition() {
        MediaStatus status = client != null ? client.getMediaStatus() : null;
        if (status == null) return;
        int state = status.getPlayerState();
        if (state != MediaStatus.PLAYER_STATE_PLAYING && state != MediaStatus.PLAYER_STATE_PAUSED && state != MediaStatus.PLAYER_STATE_BUFFERING) return;
        unheard = false;
        long at = client.getApproximateStreamPosition();
        if (at > 0) position = at / 1000.0;
    }

    /** The device's media followed, or let go of with null: its status changes, and where it has got to every 5 s. */
    private void follow(RemoteMediaClient next) {
        if (next == client) return;
        if (client != null) {
            client.unregisterCallback(media);
            client.removeProgressListener(progress);
        }
        client = next;
        if (next == null) return;
        next.registerCallback(media);
        next.addProgressListener(progress, 5000);
    }

    private static String name(CastSession from) {
        CastDevice on = from.getCastDevice();
        return on != null ? on.getFriendlyName() : null;
    }

    // ------------------------------------------------------------ the sender

    private void connected(CastSession from) {
        session = "connected";
        device = name(from);
        follow(from.getRemoteMediaClient());
        sayState();
    }

    private void disconnected() {
        follow(null);
        session = "disconnected";
        sayState();
        position = null;
        unheard = false;
        stopWhenLoaded = false;
        // Whatever load was still waiting has no device to answer it.
        for (int id : loads) answer(id, "no-session");
        loads.clear();
    }

    @Override
    public void onSessionStarting(CastSession from) {
        session = "connecting";
        device = name(from);
        sayState();
    }

    @Override
    public void onSessionStarted(CastSession from, String id) {
        position = null;
        unheard = false;
        connected(from);
    }

    @Override
    public void onSessionStartFailed(CastSession from, int error) {
        disconnected();
    }

    @Override
    public void onSessionEnding(CastSession from) {
        // The last moment the device still answers.
        notePosition();
    }

    @Override
    public void onSessionEnded(CastSession from, int error) {
        disconnected();
    }

    @Override
    public void onSessionSuspended(CastSession from, int reason) {
        follow(null);
        unheard = true;
    }

    @Override
    public void onSessionResuming(CastSession from, String id) {
    }

    @Override
    public void onSessionResumed(CastSession from, boolean wasSuspended) {
        connected(from);
        sayMedia(false);
        // What has the device on? Nothing, if what it played came to its
        // end or was stopped while the app could not hear it.
        RemoteMediaClient asked = client;
        if (asked != null) {
            asked.requestStatus().setResultCallback(result -> {
                if (asked == client && result.getStatus().isSuccess() && asked.getMediaStatus() == null) sayMedia(true);
            });
        }
    }

    @Override
    public void onSessionResumeFailed(CastSession from, int error) {
        disconnected();
    }
}
