package io.github.bigtimesam.kepulitv;

import android.app.UiModeManager;
import android.content.res.Configuration;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.widget.FrameLayout;

import org.json.JSONException;
import org.json.JSONObject;
import org.mozilla.geckoview.GeckoRuntimeSettings;
import org.mozilla.geckoview.GeckoView;
import org.mozilla.geckoview.WebExtension;

/**
 * The television's app: the player opened for a remote control
 * (player.html?tv=1, js/remote.js), full screen and lying down.
 */
public class PlayerActivity extends EngineActivity {
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        immersive();
    }

    /** The page's line (js/host.js): the app's own player is all that is said over it here. */
    private static final String LINE = "kepuli";
    private FrameLayout frame;
    private WebExtension.Port page;
    /** The app's own player behind the page's player.* messages. */
    private NativePlayer player;

    @Override
    protected String page() { return "player.html?tv=1"; }

    /** The engine's view in a frame, for the app's own picture to lie over it. */
    @Override
    protected View content(GeckoView view) {
        frame = new FrameLayout(this);
        frame.setBackgroundColor(getColor(R.color.background));
        frame.addView(view, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        return frame;
    }

    @Override
    protected void ready(WebExtension extension) {
        WebExtension.MessageDelegate line = new WebExtension.MessageDelegate() {
            // The page's line, open for as long as the page is.
            @Override
            public void onConnect(WebExtension.Port port) {
                page = port;
                port.setDelegate(new WebExtension.PortDelegate() {
                    @Override
                    public void onPortMessage(Object message, WebExtension.Port from) {
                        if (!(message instanceof JSONObject)) return;
                        JSONObject word = (JSONObject) message;
                        String type = word.optString("type", "");
                        if (type.startsWith("player.")) player().handle(type, word);
                    }

                    // The page went (reloaded, or its process taken): so did what played.
                    @Override
                    public void onDisconnect(WebExtension.Port from) {
                        if (page != from) return;
                        page = null;
                        if (player != null) player.stop();
                    }
                });
                // Who the app is: the page hands a player of the app's own what it can play.
                try {
                    port.postMessage(new JSONObject().put("type", "host").put("v", 1).put("player", true));
                } catch (JSONException e) {
                    Log.w(TAG, "the app not named to the page", e);
                }
            }
        };
        extension.setMessageDelegate(line, LINE);
        session.getWebExtensionController().setMessageDelegate(extension, line, LINE);
    }

    /** The app's own player, made when the page first hands it something. */
    private NativePlayer player() {
        if (player == null) {
            player = new NativePlayer(this, frame, new NativePlayer.Host() {
                @Override
                public void say(JSONObject word) {
                    if (page != null) page.postMessage(word);
                }

                // A television has no small window and is what is cast to.
                @Override
                public boolean smallWindow(boolean go) { return false; }

                @Override
                public boolean cast(boolean go) { return false; }
            });
        }
        return player;
    }

    /** With the page went what played. */
    @Override
    protected void lost() {
        if (player != null) player.stop();
    }

    @Override
    protected void onDestroy() {
        if (player != null) player.stop();
        super.onDestroy();
    }

    // A television gives an app 960 by 540 units, the size of a small
    // window, and the player's three panes left three rows of the list in
    // sight. A page a third larger in each direction (1280 by 720, what a
    // television's web apps are drawn for) shows the list, with text that
    // still reads from the sofa.
    @Override
    protected void configure(GeckoRuntimeSettings.Builder settings) {
        UiModeManager mode = (UiModeManager) getSystemService(UI_MODE_SERVICE);
        if (mode.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION) {
            settings.displayDensityOverride(getResources().getDisplayMetrics().density * 0.75f);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean focused) {
        super.onWindowFocusChanged(focused);
        if (focused) immersive();
    }

    /** No status or navigation bar over the picture. */
    @SuppressWarnings("deprecation")
    private void immersive() {
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }
}
