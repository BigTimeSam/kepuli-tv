package io.github.bigtimesam.kepulitv;

import android.app.Activity;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.window.OnBackInvokedDispatcher;

import java.io.File;
import java.io.FileWriter;
import java.io.IOException;

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
    private View splash;

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
        // The engine takes seconds to start and its view is white until
        // the page has drawn: the logo stays over it until then, as the
        // window showed it before the activity had anything (res/drawable/splash.xml).
        FrameLayout root = new FrameLayout(this);
        root.addView(content(view), new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        splash = new View(this);
        splash.setBackgroundResource(R.drawable.splash);
        root.addView(splash, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        view.coverUntilFirstPaint(getColor(R.color.background));

        if (runtime == null) {
            GeckoRuntimeSettings.Builder settings = new GeckoRuntimeSettings.Builder()
                    .remoteDebuggingEnabled(BuildConfig.DEBUG)
                    .consoleOutput(BuildConfig.DEBUG)
                    .aboutConfigEnabled(false);
            settings.configFilePath(quiet());
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

            @Override
            public void onFirstContentfulPaint(GeckoSession s) {
                painted();
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

    /** The page has drawn: the logo over it goes. A content delegate of a device's own calls this too. */
    protected void painted() {
        if (splash == null) return;
        ((ViewGroup) splash.getParent()).removeView(splash);
        splash = null;
    }

    /**
     * The engine is Firefox's, and like Firefox it asks a few things of the
     * network on its own account when it starts: whether a sign-in page
     * stands in the way (a request to Mozilla), whether names resolve, and
     * the addresses of links before they are pressed. A browser has use for
     * those; a player that goes to the viewer's own provider and nowhere
     * else has none, and its privacy policy says where it goes. They are
     * turned off by the engine's own preferences, given as its
     * configuration file so that they hold from the first moment. Measured
     * with tcpdump on an emulator: with these, a start with no account
     * looked up no name at all.
     */
    private static final String QUIET = "prefs:\n"
            + "  network.captive-portal-service.enabled: false\n"
            + "  network.connectivity-service.enabled: false\n"
            + "  network.trr.mode: 5\n"
            + "  doh-rollout.enabled: false\n"
            + "  network.dns.disablePrefetch: true\n"
            + "  network.dns.disablePrefetchFromHTTPS: true\n"
            + "  network.prefetch-next: false\n"
            + "  network.predictor.enabled: false\n"
            + "  network.http.speculative-parallel-limit: 0\n"
            // Which country the device is in, asked of Mozilla by its address.
            + "  browser.region.update.enabled: false\n"
            + "  browser.region.network.url: \"\"\n"
            // Lists of harmful sites, fetched from Google and Mozilla: the
            // player opens no site, only the viewer's provider.
            + "  browser.safebrowsing.malware.enabled: false\n"
            + "  browser.safebrowsing.phishing.enabled: false\n"
            + "  browser.safebrowsing.blockedURIs.enabled: false\n"
            + "  browser.safebrowsing.downloads.remote.enabled: false\n"
            + "  browser.safebrowsing.provider.google.updateURL: \"\"\n"
            + "  browser.safebrowsing.provider.google.gethashURL: \"\"\n"
            + "  browser.safebrowsing.provider.google4.updateURL: \"\"\n"
            + "  browser.safebrowsing.provider.google4.gethashURL: \"\"\n"
            + "  browser.safebrowsing.provider.google5.updateURL: \"\"\n"
            + "  browser.safebrowsing.provider.google5.gethashURL: \"\"\n"
            + "  browser.safebrowsing.provider.mozilla.updateURL: \"\"\n"
            + "  browser.safebrowsing.provider.mozilla.gethashURL: \"\"\n"
            + "  privacy.trackingprotection.enabled: false\n"
            + "  privacy.trackingprotection.pbmode.enabled: false\n"
            // Mozilla's settings service (lists a browser keeps up to date)
            // and its add-on catalogue: the one extension here is built in.
            + "  services.settings.server: \"data:,#remote-settings-dummy/v1\"\n"
            + "  extensions.blocklist.enabled: false\n"
            + "  extensions.update.enabled: false\n"
            + "  extensions.getAddons.cache.enabled: false\n"
            + "  app.normandy.enabled: false\n"
            + "  dom.push.enabled: false\n"
            // A released engine takes another address for the settings
            // service only with this beside it.
            + "env:\n"
            + "  MOZ_REMOTE_SETTINGS_DEVTOOLS: 1\n";

    /** The configuration file's path, written anew on every start. */
    private String quiet() {
        File file = new File(getFilesDir(), "geckoview-config.yaml");
        try (FileWriter out = new FileWriter(file)) {
            out.write(QUIET);
        } catch (IOException e) {
            Log.w(TAG, "the engine's configuration was not written", e);
        }
        return file.getPath();
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
