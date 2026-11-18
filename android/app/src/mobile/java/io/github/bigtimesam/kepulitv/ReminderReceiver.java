package io.github.bigtimesam.kepulitv;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Started by Android when a reminder's alarm goes off, and when the device
 * has restarted or the app has been updated, both of which take the alarm
 * away (see Reminders).
 */
public class ReminderReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent.getAction() == null) Reminders.fire(context);
        else Reminders.arm(context);
    }
}
