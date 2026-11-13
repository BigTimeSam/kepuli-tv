package io.github.bigtimesam.kepulitv;

import android.app.Activity;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.window.OnBackInvokedDispatcher;

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
 * What the television's app and the phone's share: one GeckoView showing
 * the extension's player.html. The extension is the Firefox package, built
 * into the APK and installed into the engine as a built-in on every start,
 * so the player has what it has in Firefox: its storage, its requests to
 * any provider without CORS, MediaSource and WebAssembly.
 *
 * Each kind of device has a PlayerActivity of its own on top of this
 * (src/tv/, src/mobile/), which says what page is opened and answers what
 * a browser would answer on that device.
 */
abstract class EngineActivity extends Activity {
    protected static final String TAG = "KepuliTV";
    private static final String EXTENSION_ID = "kepuli-tv@bigtimesam.github.io";
    private static final String EXTENSION_URL = "resource://android/assets/extension/";

    /** One engine a process: Android may make the activity again, the engine stays. */
    protected static GeckoRuntime runtime;

    protected GeckoSession session;
    protected GeckoView view;

    /** The page under the extension's address, with its query. */
    protected abstract String page();

    /** The engine's settings, before the one engine of the process is made. */
    protected void configure(GeckoRuntimeSettings.Builder settings) { }

    /** What is set as the activity's content: the view, or a frame around it. */
    protected View content(GeckoView view) { return view; }

    /** The session is open and the extension is in: the device's own delegates. */
    protected void ready(WebExtension extension) { }

    /** The player asked for optional permissions (a provider's host, notifications). */
    protected GeckoResult<AllowOrDeny> grant(String[] permissions, String[] origins) {
        return GeckoResult.allow();
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        view = new GeckoView(this);
        setContentView(content(view));

        if (runtime == null) {
            GeckoRuntimeSettings.Builder settings = new GeckoRuntimeSettings.Builder()
                    .remoteDebuggingEnabled(BuildConfig.DEBUG)
                    .consoleOutput(BuildConfig.DEBUG)
                    .aboutConfigEnabled(false);
            configure(settings);
            runtime = GeckoRuntime.create(getApplicationContext(), settings.build());
        }
        WebExtensionController extensions = runtime.getWebExtensionController();
        // The player asks for a provider's host when an account is added
        // (optional_host_permissions). The viewer has just typed that
        // address, and there is no browser here to ask on their behalf.
        extensions.setPromptDelegate(new WebExtensionController.PromptDelegate() {
            @Override
            public GeckoResult<AllowOrDeny> onOptionalPrompt(WebExtension extension, String[] permissions, String[] origins, String[] dataCollectionPermissions) {
                return grant(permissions, origins);
            }
        });

        session = new GeckoSession(new GeckoSessionSettings.Builder()
                .usePrivateMode(false)
                .suspendMediaWhenInactive(true)
                .build());
        session.setPermissionDelegate(new GeckoSession.PermissionDelegate() {
            // Playback starts from a remote control's OK, which the engine
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

        // Android 16 no longer sends Back as a key to an app made for it:
        // it calls this instead.
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::back);
        }

        extensions.ensureBuiltIn(EXTENSION_URL, EXTENSION_ID).accept(
                extension -> {
                    ready(extension);
                    session.loadUri(extension.metaData.baseUrl + page());
                },
                error -> Log.e(TAG, "the extension did not install", error));
    }

    /**
     * Back is the player's Escape: it closes the dialog, the menu or the
     * full screen that is open, as Escape does on a keyboard. Android would
     * end the activity instead, and the picture with it. With nothing left
     * to close the player asks to be closed (js/remote.js), and
     * onCloseRequest steps back to the launcher.
     */
    protected void back() {
        view.dispatchKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_ESCAPE));
        view.dispatchKeyEvent(new KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_ESCAPE));
    }

    // Back with the keyboard up puts the keyboard away, and of that press
    // only the release comes here: a release counts with its own press.
    private boolean backDown;

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (event.getKeyCode() != KeyEvent.KEYCODE_BACK) return super.dispatchKeyEvent(event);
        if (event.getAction() == KeyEvent.ACTION_DOWN) {
            backDown = true;
        } else if (event.getAction() == KeyEvent.ACTION_UP && backDown) {
            backDown = false;
            if (!event.isCanceled()) back();
        }
        return true;
    }

    @Override
    protected void onStart() {
        super.onStart();
        if (session != null) session.setActive(true);
    }

    /**
     * Whether the page goes on as if in sight while the activity is not:
     * the phone's app says so while something plays, for the sound.
     */
    protected boolean awake() { return false; }

    @Override
    protected void onStop() {
        if (session != null && !awake()) session.setActive(false);
        super.onStop();
    }

    @Override
    protected void onDestroy() {
        if (session != null) session.close();
        super.onDestroy();
    }
}
