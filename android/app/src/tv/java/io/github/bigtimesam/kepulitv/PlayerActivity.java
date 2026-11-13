package io.github.bigtimesam.kepulitv;

import android.app.UiModeManager;
import android.content.res.Configuration;
import android.os.Bundle;
import android.view.View;

import org.mozilla.geckoview.GeckoRuntimeSettings;

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

    @Override
    protected String page() { return "player.html?tv=1"; }

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
