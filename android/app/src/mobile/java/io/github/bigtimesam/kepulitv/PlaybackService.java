package io.github.bigtimesam.kepulitv;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;

/**
 * What keeps the sound going when the app is out of sight: the screen
 * turned off, or another app in front. Android stops an app it cannot see
 * unless it runs a service that says so with a notification; this is that
 * service, and its notification is the one media players have, with the
 * name of what is on and a button to pause it. The same is told to
 * Android's media session, which is where the lock screen, a headset's
 * button and the small window (picture in picture) get their controls.
 *
 * The picture and the sound are the page's, in PlayerActivity's view: the
 * activity says here what is on (now), as the page tells it, and passes
 * what is pressed here on to the page (controls). The service runs from the first play until the page has
 * nothing to play, the notification is swiped away, or the app has stood
 * paused in the background for ten minutes.
 */
public class PlaybackService extends Service {
    private static final String TAG = "KepuliTV";
    private static final String CHANNEL = "playback";
    private static final int NOTIFICATION = 1;
    /** What can be pressed, by the names the page knows (js/remote.js). */
    static final String PLAY = "play";
    static final String PAUSE = "pause";
    static final String NEXT = "next";
    static final String PREVIOUS = "previous";
    private static final String CLOSE = "close";
    private static final long IDLE = 10 * 60 * 1000;

    /** Where a press goes: to the page, by way of the activity. */
    interface Controls {
        void press(String what);

        /** The service has ended, by itself or because it was told to. */
        void stopped();
    }

    /** What is on, as the page last said it. */
    static final class Now {
        String title = "";
        String artist = "";
        boolean playing;
        /** A channel: there is a next and a previous one to change to. */
        boolean live;
        /** Whether the app itself is in sight. */
        boolean visible;
    }

    static final Now now = new Now();
    static Controls controls;
    private static PlaybackService running;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable idle = this::stopSelf;
    private MediaSession session;
    private PowerManager.WakeLock awake;
    private WifiManager.WifiLock wifi;

    /** Something plays: the service starts, if it is not running. */
    static void start(Context context) {
        if (running != null) {
            running.show();
            return;
        }
        try {
            context.startForegroundService(new Intent(context, PlaybackService.class));
        } catch (RuntimeException e) {
            // Android does not let a service start from the background
            // (play pressed on a headset after the service has gone).
            Log.w(TAG, "playback goes on without its service", e);
        }
    }

    static boolean running() {
        return running != null;
    }

    /** What is on has changed. */
    static void refresh() {
        if (running != null) running.show();
    }

    static void stop(Context context) {
        context.stopService(new Intent(context, PlaybackService.class));
    }

    @Override
    public void onCreate() {
        super.onCreate();
        running = this;
        getSystemService(NotificationManager.class).createNotificationChannel(
                new NotificationChannel(CHANNEL, getString(R.string.channel_playback), NotificationManager.IMPORTANCE_LOW));
        session = new MediaSession(this, getString(R.string.app_name));
        session.setCallback(new MediaSession.Callback() {
            @Override
            public void onPlay() {
                press(PLAY);
            }

            @Override
            public void onPause() {
                press(PAUSE);
            }

            @Override
            public void onStop() {
                close();
            }

            @Override
            public void onSkipToNext() {
                press(NEXT);
            }

            @Override
            public void onSkipToPrevious() {
                press(PREVIOUS);
            }
        });
        session.setActive(true);
        awake = getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "kepulitv:playback");
        awake.setReferenceCounted(false);
        wifi = getApplicationContext().getSystemService(WifiManager.class).createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "kepulitv:playback");
        wifi.setReferenceCounted(false);
        // Android ends the app if a service started this way has not shown
        // its notification within seconds, whatever else happens first.
        show();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int id) {
        String action = intent == null ? null : intent.getAction();
        if (PLAY.equals(action) || PAUSE.equals(action)) press(action);
        else if (CLOSE.equals(action)) close();
        else show();
        return START_NOT_STICKY;
    }

    private static void press(String what) {
        if (controls != null) controls.press(what);
    }

    /** The notification swiped away, or Stop asked: the sound stops and the service with it. */
    private void close() {
        press(PAUSE);
        stopSelf();
    }

    private PendingIntent ask(String action) {
        return PendingIntent.getService(this, 0, new Intent(this, PlaybackService.class).setAction(action), PendingIntent.FLAG_IMMUTABLE);
    }

    /** The notification, the media session and the locks, as things are now. */
    private void show() {
        long actions = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_STOP;
        if (now.live) actions |= PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS;
        // No position: a channel has none, and a film's is the page's to show.
        session.setPlaybackState(new PlaybackState.Builder()
                .setActions(actions)
                .setState(now.playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED, PlaybackState.PLAYBACK_POSITION_UNKNOWN, now.playing ? 1 : 0)
                .build());
        session.setMetadata(new MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, now.title)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, now.artist)
                .putLong(MediaMetadata.METADATA_KEY_DURATION, -1)
                .build());

        Intent open = new Intent(this, PlayerActivity.class);
        Notification.Builder notification = new Notification.Builder(this, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setContentTitle(now.title)
                .setContentText(now.artist)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setOngoing(now.playing)
                .setContentIntent(PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE))
                .setDeleteIntent(ask(CLOSE))
                .addAction(new Notification.Action.Builder(
                        android.graphics.drawable.Icon.createWithResource(this, now.playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play),
                        getString(now.playing ? R.string.action_pause : R.string.action_play), ask(now.playing ? PAUSE : PLAY)).build())
                .setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0));
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION, notification.build(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            else startForeground(NOTIFICATION, notification.build());
        } catch (RuntimeException e) {
            Log.w(TAG, "the playback service could not come forward", e);
        }

        // The processor and the network stay up for the stream while it
        // plays; a paused one in the background is let go after a while.
        if (now.playing) {
            awake.acquire();
            wifi.acquire();
        } else {
            if (awake.isHeld()) awake.release();
            if (wifi.isHeld()) wifi.release();
        }
        handler.removeCallbacks(idle);
        if (!now.playing && !now.visible) handler.postDelayed(idle, IDLE);
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(idle);
        if (awake.isHeld()) awake.release();
        if (wifi.isHeld()) wifi.release();
        session.setActive(false);
        session.release();
        running = null;
        if (controls != null) controls.stopped();
        super.onDestroy();
    }

    /** The app swiped away from the recent apps: what played went with it. */
    @Override
    public void onTaskRemoved(Intent root) {
        stopSelf();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
