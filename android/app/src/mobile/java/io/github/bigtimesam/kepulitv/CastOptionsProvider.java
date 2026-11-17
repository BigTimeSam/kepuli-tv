package io.github.bigtimesam.kepulitv;

import android.content.Context;

import com.google.android.gms.cast.CastMediaControlIntent;
import com.google.android.gms.cast.framework.CastOptions;
import com.google.android.gms.cast.framework.OptionsProvider;
import com.google.android.gms.cast.framework.SessionProvider;
import com.google.android.gms.cast.framework.media.CastMediaOptions;
import com.google.android.gms.cast.framework.media.NotificationOptions;

import java.util.List;

/**
 * What Google's Cast sender is started with (named in the manifest; the
 * sender reads it when CastService first asks for it, not before).
 *
 * The Default Media Receiver: nothing to register, and it plays what a
 * Chromecast's own player knows (HLS, MP4, WebM). The device's player is
 * closed when the session ends, so that nothing of the account's one
 * connection is left running on a television. Google's own remote control
 * (CastControlsActivity) is what the page's Remote control opens and what
 * the sender's notification leads to.
 */
public final class CastOptionsProvider implements OptionsProvider {
    @Override
    public CastOptions getCastOptions(Context context) {
        String controls = CastControlsActivity.class.getName();
        CastMediaOptions media = new CastMediaOptions.Builder()
                .setNotificationOptions(new NotificationOptions.Builder().setTargetActivityClassName(controls).build())
                .setExpandedControllerActivityClassName(controls)
                .build();
        return new CastOptions.Builder()
                .setReceiverApplicationId(CastMediaControlIntent.DEFAULT_MEDIA_RECEIVER_APPLICATION_ID)
                .setStopReceiverApplicationWhenEndingSession(true)
                .setCastMediaOptions(media)
                .build();
    }

    @Override
    public List<SessionProvider> getAdditionalSessionProviders(Context context) {
        return null;
    }
}
