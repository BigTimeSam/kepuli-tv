package io.github.bigtimesam.kepulitv;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.Set;

/**
 * The reminders said while the app is not running. The extension keeps the
 * reminders and has alarms of its own (background.js), but Android stops
 * an app that is out of sight, and its engine with it. So the extension
 * hands the list over whenever it changes, it is kept here, and Android's
 * own alarm is set for the first one: the alarm starts ReminderReceiver,
 * which shows the notification without the engine.
 *
 * A reminder's notification has the same name here and in the extension
 * ("reminder:channel:start"), so one said by both is one notification.
 */
final class Reminders {
    private static final String TAG = "KepuliTV";
    private static final String CHANNEL = "reminders";
    private static final String STORE = "reminders";
    private static final String LIST = "list";
    private static final String SAID = "said";
    /** The notification's name, and the channel to play, on the intent that opens the app. */
    static final String EXTRA_ID = "notification";
    static final String EXTRA_WATCH = "watch";

    // The extension says a reminder a minute before the programme. Android
    // may hold an alarm back for minutes while the device rests, unless the
    // viewer grants a permission meant for clocks and calendars: this one
    // is set a minute earlier still, so that a late one is less late.
    private static final long AHEAD = 2 * 60 * 1000;

    private Reminders() { }

    private static SharedPreferences store(Context context) {
        return context.getSharedPreferences(STORE, Context.MODE_PRIVATE);
    }

    private static JSONArray list(Context context) {
        try {
            return new JSONArray(store(context).getString(LIST, "[]"));
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    /**
     * The extension's list, as it is now. What has been said is remembered
     * for a day past its programme's start, which is the end of its name:
     * a reminder leaves the list the moment the extension says it, a
     * breath before its notification comes here to be shown.
     */
    static void sync(Context context, JSONArray list) {
        Set<String> said = new HashSet<>(store(context).getStringSet(SAID, new HashSet<>()));
        long old = System.currentTimeMillis() - 24 * 3600 * 1000;
        said.removeIf(id -> {
            try {
                return Long.parseLong(id.substring(id.lastIndexOf(':') + 1)) < old;
            } catch (NumberFormatException e) {
                return true;
            }
        });
        store(context).edit().putString(LIST, list.toString()).putStringSet(SAID, said).apply();
        arm(context);
    }

    /** Whether this reminder has been shown already, by the alarm or by the extension. */
    static boolean said(Context context, String id) {
        return store(context).getStringSet(SAID, new HashSet<>()).contains(id);
    }

    static void markSaid(Context context, String id) {
        Set<String> said = new HashSet<>(store(context).getStringSet(SAID, new HashSet<>()));
        if (said.add(id)) store(context).edit().putStringSet(SAID, said).apply();
    }

    private static PendingIntent alarm(Context context) {
        return PendingIntent.getBroadcast(context, 0, new Intent(context, ReminderReceiver.class), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** The alarm set for the first reminder not yet said, or taken away when there is none. */
    static void arm(Context context) {
        JSONArray list = list(context);
        Set<String> said = store(context).getStringSet(SAID, new HashSet<>());
        long now = System.currentTimeMillis();
        long first = Long.MAX_VALUE;
        for (int i = 0; i < list.length(); i++) {
            JSONObject r = list.optJSONObject(i);
            if (r == null || said.contains(r.optString("id")) || r.optLong("stop") <= now) continue;
            first = Math.min(first, r.optLong("start") - AHEAD);
        }
        AlarmManager alarms = context.getSystemService(AlarmManager.class);
        if (first == Long.MAX_VALUE) {
            alarms.cancel(alarm(context));
        } else if (Build.VERSION.SDK_INT < 31 || alarms.canScheduleExactAlarms()) {
            alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, first, alarm(context));
        } else {
            alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, first, alarm(context));
        }
    }

    /** The alarm went off: every reminder that is due is shown, and the alarm set for the next. */
    static void fire(Context context) {
        JSONArray list = list(context);
        long now = System.currentTimeMillis();
        for (int i = 0; i < list.length(); i++) {
            JSONObject r = list.optJSONObject(i);
            if (r == null) continue;
            String id = r.optString("id");
            // Half a minute's grace: an alarm a moment early is not put off to the next.
            if (said(context, id) || r.optLong("stop") <= now || r.optLong("start") - AHEAD > now + 30000) continue;
            JSONObject watch = new JSONObject();
            try {
                watch.put("channel", r.opt("channel")).put("account", r.opt("account"));
            } catch (JSONException e) {
                Log.w(TAG, "a reminder without its channel", e);
            }
            // With the time, in the device's own way of writing it: the alarm
            // may be minutes early or late, where the extension's is not.
            String time = android.text.format.DateFormat.getTimeFormat(context).format(new java.util.Date(r.optLong("start")));
            show(context, id, r.optString("title"), time + ", " + r.optString("text"), watch.toString());
            markSaid(context, id);
        }
        arm(context);
    }

    /**
     * A reminder's notification. A press opens the app, which is told the
     * notification's name and, when the alarm showed it, what to play.
     */
    static void show(Context context, String id, String title, String text, String watch) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel(CHANNEL, context.getString(R.string.channel_reminders), NotificationManager.IMPORTANCE_HIGH));
        Intent open = new Intent(context, PlayerActivity.class).setAction(EXTRA_ID + ":" + id).putExtra(EXTRA_ID, id);
        if (watch != null) open.putExtra(EXTRA_WATCH, watch);
        manager.notify(id, 0, new Notification.Builder(context, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_popup_reminder)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setAutoCancel(true)
                .setContentIntent(PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE))
                .build());
    }

    static void cancel(Context context, String id) {
        context.getSystemService(NotificationManager.class).cancel(id, 0);
    }
}
