package io.github.bigtimesam.kepulitv;

import android.app.Activity;
import android.app.UiModeManager;
import android.content.res.Configuration;
import android.os.Bundle;
import android.util.Log;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;

import org.mozilla.geckoview.AllowOrDeny;
import org.mozilla.geckoview.GeckoResult;
import org.mozilla.geckoview.GeckoRuntime;
import org.mozilla.geckoview.GeckoRuntimeSettings;
import org.mozilla.geckoview.GeckoSession;
import org.mozilla.geckoview.GeckoSessionSettings;
import org.mozilla.geckoview.GeckoView;
import org.mozilla.geckoview.WebExtension;
import org.mozilla.geckoview.WebExtensionController;

/**
 * The whole app: one full-screen GeckoView showing the extension's
 * player.html. The extension is the Firefox package, built into the APK and
 * installed into the engine as a built-in on every start, so the player has
 * what it has in Firefox: its storage, its requests to any provider without
 * CORS, MediaSource and WebAssembly.
 */
public class PlayerActivity extends Activity {
    private static final String TAG = "KepuliTV";
    private static final String EXTENSION_ID = "kepuli-tv@bigtimesam.github.io";
    private static final String EXTENSION_URL = "resource://android/assets/extension/";

    /** One engine a process: Android may make the activity again, the engine stays. */
    private static GeckoRuntime runtime;

    private GeckoSession session;
    private GeckoView view;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        view = new GeckoView(this);
        setContentView(view);
        immersive();

        if (runtime == null) {
            GeckoRuntimeSettings.Builder settings = new GeckoRuntimeSettings.Builder()
                    .remoteDebuggingEnabled(BuildConfig.DEBUG)
                    .consoleOutput(BuildConfig.DEBUG)
                    .aboutConfigEnabled(false);
            // A television gives an app 960 by 540 units, the size of a
            // small window, and the player's three panes left three rows
            // of the list in sight. A page a third larger in each direction
            // (1280 by 720, what a television's web apps are drawn for)
            // shows the list, with text that still reads from the sofa.
            UiModeManager mode = (UiModeManager) getSystemService(UI_MODE_SERVICE);
            if (mode.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION) {
                settings.displayDensityOverride(getResources().getDisplayMetrics().density * 0.75f);
            }
            runtime = GeckoRuntime.create(getApplicationContext(), settings.build());
        }
        WebExtensionController extensions = runtime.getWebExtensionController();
        // The player asks for a provider's host when an account is added
        // (optional_host_permissions). The viewer has just typed that
        // address, and there is no browser here to ask on their behalf.
        extensions.setPromptDelegate(new WebExtensionController.PromptDelegate() {
            @Override
            public GeckoResult<AllowOrDeny> onOptionalPrompt(WebExtension extension, String[] permissions, String[] origins, String[] dataCollectionPermissions) {
                return GeckoResult.allow();
            }
        });

        session = new GeckoSession(new GeckoSessionSettings.Builder()
                .usePrivateMode(false)
                .suspendMediaWhenInactive(true)
                .build());
        session.setPermissionDelegate(new GeckoSession.PermissionDelegate() {
            // Playback starts from the remote control's OK, which the engine
            // may not count as the gesture a page needs for sound.
            @Override
            public GeckoResult<Integer> onContentPermissionRequest(GeckoSession s, ContentPermission permission) {
                return GeckoResult.fromValue(ContentPermission.VALUE_ALLOW);
            }
        });
        session.setContentDelegate(new GeckoSession.ContentDelegate() {
            // Back with nothing open in the player: the app goes to the
            // background as it is, and comes back where it was left.
            @Override
            public void onCloseRequest(GeckoSession s) {
                moveTaskToBack(true);
            }
        });
        session.open(runtime);
        view.setSession(session);

        extensions.ensureBuiltIn(EXTENSION_URL, EXTENSION_ID).accept(
                extension -> session.loadUri(extension.metaData.baseUrl + "player.html?tv=1"),
                error -> Log.e(TAG, "the extension did not install", error));
    }

    /**
     * The remote's Back is the player's Escape: it closes the dialog, the
     * menu or the full screen that is open, as Escape does on a keyboard.
     * Android would end the activity instead, and the picture with it. With
     * nothing left to close the player asks to be closed (js/remote.js),
     * and onCloseRequest steps back to the launcher.
     */
    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (event.getKeyCode() != KeyEvent.KEYCODE_BACK) return super.dispatchKeyEvent(event);
        if (event.getAction() != KeyEvent.ACTION_UP) return true;
        view.dispatchKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_ESCAPE));
        view.dispatchKeyEvent(new KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_ESCAPE));
        return true;
    }

    @Override
    public void onWindowFocusChanged(boolean focused) {
        super.onWindowFocusChanged(focused);
        if (focused) immersive();
    }

    @Override
    protected void onStart() {
        super.onStart();
        if (session != null) session.setActive(true);
    }

    @Override
    protected void onStop() {
        if (session != null) session.setActive(false);
        super.onStop();
    }

    @Override
    protected void onDestroy() {
        if (session != null) session.close();
        super.onDestroy();
    }

    /** No status or navigation bar over the picture, on a phone either. */
    @SuppressWarnings("deprecation")
    private void immersive() {
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }
}
