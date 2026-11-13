package io.github.bigtimesam.kepulitv;

import android.Manifest;
import android.app.AlertDialog;
import android.app.PictureInPictureParams;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.database.Cursor;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.util.Log;
import android.util.Rational;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.Toast;

import org.mozilla.geckoview.AllowOrDeny;
import org.mozilla.geckoview.GeckoResult;
import org.mozilla.geckoview.GeckoSession;
import org.mozilla.geckoview.GeckoSession.PromptDelegate.ChoicePrompt;
import org.mozilla.geckoview.GeckoSession.PromptDelegate.FilePrompt;
import org.mozilla.geckoview.GeckoSession.PromptDelegate.PromptResponse;
import org.mozilla.geckoview.GeckoView;
import org.mozilla.geckoview.WebExtension;
import org.mozilla.geckoview.WebNotification;
import org.mozilla.geckoview.WebNotificationDelegate;
import org.mozilla.geckoview.WebResponse;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URLDecoder;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The phone's and the tablet's app: the player as it is in Firefox for
 * Android (player.html?app=1), upright or lying down as the device is
 * held, with the system's bars in place until something goes full screen.
 * What a browser does around a page is done here: a select's list, the
 * file picker, a saved file, a link to somewhere else, a reminder's
 * notification. And what an app does that a browser's tab does not: the
 * picture stays in a small window when the viewer goes elsewhere (picture
 * in picture), the sound goes on with the screen off (PlaybackService),
 * and a reminder comes when the app is not running (Reminders).
 */
public class PlayerActivity extends EngineActivity {
    private static final int PICK_FILE = 1;
    private static final int ASK_NOTIFICATIONS = 2;
    /** The name the extension's two ends know the app by (background.js, js/remote.js). */
    private static final String LINE = "kepuli";

    private FrameLayout frame;
    private boolean fullScreen;
    private String home;

    private FilePrompt filePrompt;
    private GeckoResult<PromptResponse> filePicked;
    private GeckoResult<AllowOrDeny> notificationsAsked;
    /** Android has been asked for its leave to notify during this run. */
    private boolean asked;
    /** The notifications in sight, by tag: a press on one is told to the player. */
    private final Map<String, WebNotification> shown = new HashMap<>();

    private boolean playing;
    /** Between onStart and onStop: the app is in sight, as itself or as the small window. */
    private boolean started;
    private boolean pip;
    private Rational shape = new Rational(16, 9);
    /** The page's end of the line, and what waits for it to be there. */
    private WebExtension.Port page;
    private JSONObject waiting;

    @Override
    protected String page() { return "player.html?app=1"; }

    /**
     * Android 15 draws an app under the status and navigation bars; the
     * page knows nothing of them. The frame keeps the view clear of the
     * bars, the camera's cutout and the keyboard, and shows the player's
     * dark background behind them.
     */
    @Override
    protected View content(GeckoView view) {
        frame = new FrameLayout(this);
        frame.setBackgroundColor(getColor(R.color.background));
        frame.addView(view, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        frame.setOnApplyWindowInsetsListener((v, insets) -> {
            inset(insets);
            return insets;
        });
        return frame;
    }

    @SuppressWarnings("deprecation")
    private void inset(WindowInsets insets) {
        if (fullScreen || pip) {
            frame.setPadding(0, 0, 0, 0);
        } else if (Build.VERSION.SDK_INT >= 30) {
            Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
            frame.setPadding(bars.left, bars.top, bars.right, bars.bottom);
        } else {
            frame.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
        }
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        // A phone left on a list goes dark as phones do; the screen is
        // kept on while something plays (playing()).
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        PlaybackService.controls = new PlaybackService.Controls() {
            @Override
            public void press(String what) {
                PlayerActivity.this.press(what);
            }

            // The service has gone while the app is out of sight (paused
            // for long, or its notification swiped away): the page rests.
            @Override
            public void stopped() {
                session.getSessionPictureInPicture().setKeepActive(false);
                if (!started) session.setActive(false);
            }
        };
        session.setContentDelegate(new GeckoSession.ContentDelegate() {
            // Back from the list is the viewer leaving: what plays stops,
            // where Home would have kept it in the small window.
            @Override
            public void onCloseRequest(GeckoSession s) {
                press(PlaybackService.PAUSE);
                moveTaskToBack(true);
            }

            @Override
            public void onFullScreen(GeckoSession s, boolean on) {
                fullScreen(on);
            }

            // A file the player saves (a recording, a playlist for another
            // player, the settings): a browser would download it.
            @Override
            public void onExternalResponse(GeckoSession s, WebResponse response) {
                new Thread(() -> save(response)).start();
            }

            // Android takes the page's process when memory runs short while
            // the app is in the background. The session is closed then, and
            // the view would stay empty.
            @Override
            public void onKill(GeckoSession s) {
                reopen();
            }

            @Override
            public void onCrash(GeckoSession s) {
                reopen();
            }
        });
        session.setPromptDelegate(new GeckoSession.PromptDelegate() {
            @Override
            public GeckoResult<PromptResponse> onChoicePrompt(GeckoSession s, ChoicePrompt prompt) {
                return choose(prompt);
            }

            @Override
            public GeckoResult<PromptResponse> onFilePrompt(GeckoSession s, FilePrompt prompt) {
                return pickFile(prompt);
            }
        });
        session.setNavigationDelegate(new GeckoSession.NavigationDelegate() {
            // The view shows the player and nothing else: a link to a web
            // page, or to another player (intent:, js/external.js), is for
            // the app that opens such things.
            @Override
            public GeckoResult<AllowOrDeny> onLoadRequest(GeckoSession s, LoadRequest request) {
                boolean own = request.uri.startsWith("moz-extension:") || request.uri.startsWith("blob:")
                        || request.uri.startsWith("data:") || request.uri.startsWith("about:");
                if (own && request.target != TARGET_WINDOW_NEW) return GeckoResult.allow();
                if (!own) outside(request.uri);
                return GeckoResult.deny();
            }
        });
        runtime.setWebNotificationDelegate(new WebNotificationDelegate() {
            @Override
            public void onShowNotification(WebNotification notification) {
                show(notification);
            }

            @Override
            public void onCloseNotification(WebNotification notification) {
                shown.remove(notification.tag);
                Reminders.cancel(PlayerActivity.this, notification.tag);
            }
        });
        // Android hands the same intent over again when it brings the app
        // back from the recent apps: a press is a press only the first time.
        if (state == null && (getIntent().getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) == 0) pressed(getIntent());
    }

    @Override
    protected void ready(WebExtension extension) {
        home = extension.metaData.baseUrl + page();
        // The background opens a tab for a page of the web (and for the
        // player, which is already here).
        extension.setTabDelegate(new WebExtension.TabDelegate() {
            @Override
            public GeckoResult<GeckoSession> onNewTab(WebExtension source, WebExtension.CreateTabDetails details) {
                if (details.url != null && !details.url.startsWith(extension.metaData.baseUrl)) outside(details.url);
                return null;
            }
        });
        WebExtension.MessageDelegate line = new WebExtension.MessageDelegate() {
            // The background's word of the reminders, whenever they change.
            @Override
            public GeckoResult<Object> onMessage(String app, Object message, WebExtension.MessageSender sender) {
                JSONArray reminders = message instanceof JSONObject ? ((JSONObject) message).optJSONArray("reminders") : null;
                if (reminders != null) Reminders.sync(getApplicationContext(), reminders);
                // The extension tells them only when it may show notifications.
                // Android's own leave can be missing all the same (taken back
                // in the system's settings): it is asked for once a run, when
                // there is a reminder to lose.
                if (reminders != null && reminders.length() > 0 && !asked && started && Build.VERSION.SDK_INT >= 33
                        && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                    asked = true;
                    requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, ASK_NOTIFICATIONS);
                }
                return null;
            }

            // The page's line, open for as long as the page is.
            @Override
            public void onConnect(WebExtension.Port port) {
                page = port;
                port.setDelegate(new WebExtension.PortDelegate() {
                    @Override
                    public void onPortMessage(Object message, WebExtension.Port from) {
                        if (!(message instanceof JSONObject)) return;
                        JSONArray size = ((JSONObject) message).optJSONArray("shape");
                        if (size != null) shape(size.optInt(0), size.optInt(1));
                        JSONObject now = ((JSONObject) message).optJSONObject("now");
                        if (now != null) now(now);
                    }

                    // The page went (reloaded, or its process taken): so did what played.
                    @Override
                    public void onDisconnect(WebExtension.Port from) {
                        if (page != from) return;
                        page = null;
                        nothing();
                    }
                });
                if (pip) tell("pip", true);
                if (waiting != null) port.postMessage(waiting);
                waiting = null;
            }
        };
        extension.setMessageDelegate(line, LINE);
        session.getWebExtensionController().setMessageDelegate(extension, line, LINE);
    }

    /** A word to the page; one that comes before the page is there is not kept. */
    private void tell(String name, Object value) {
        if (page == null) return;
        try {
            page.postMessage(new JSONObject().put(name, value));
        } catch (JSONException e) {
            Log.w(TAG, "not said to the page: " + name, e);
        }
    }

    private void reopen() {
        if (home == null || session.isOpen()) return;
        nothing();
        session.open(runtime);
        session.loadUri(home);
    }

    /* ------------------------------------------------------- full screen */

    /**
     * Full screen: no bars, and the whole glass, under the cutout too. The
     * screen stays as the phone is held, upright or lying down: the owner
     * wants both everywhere, and a turn of the hand is all it takes. (The
     * page could not ask for a turn either: screen.orientation.lock()
     * brought the engine down, GeckoView 160, a null pointer in libxul.)
     */
    @SuppressWarnings("deprecation")
    private void fullScreen(boolean on) {
        fullScreen = on;
        Window window = getWindow();
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams params = window.getAttributes();
            params.layoutInDisplayCutoutMode = on
                    ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
                    : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_DEFAULT;
            window.setAttributes(params);
        }
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController bars = window.getInsetsController();
            if (on) {
                bars.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                bars.hide(WindowInsets.Type.systemBars());
            } else {
                bars.show(WindowInsets.Type.systemBars());
            }
        } else {
            window.getDecorView().setSystemUiVisibility(on
                    ? View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    : 0);
        }
        frame.requestApplyInsets();
    }

    /** Back leaves the full screen first; the rest is the player's Escape. */
    @Override
    protected void back() {
        if (fullScreen) session.exitFullScreen();
        else super.back();
    }

    /* ----------------------------------------------------------- prompts */

    /** A select's options: the engine draws none of its own in a view. */
    private GeckoResult<PromptResponse> choose(ChoicePrompt prompt) {
        List<ChoicePrompt.Choice> choices = new ArrayList<>();
        flatten(prompt.choices, choices);
        String[] labels = new String[choices.size()];
        boolean[] checked = new boolean[choices.size()];
        int selected = -1;
        for (int i = 0; i < labels.length; i++) {
            labels[i] = choices.get(i).label;
            checked[i] = choices.get(i).selected;
            if (checked[i] && selected < 0) selected = i;
        }
        GeckoResult<PromptResponse> result = new GeckoResult<>();
        AlertDialog.Builder dialog = new AlertDialog.Builder(this);
        if (prompt.title != null && !prompt.title.isEmpty()) dialog.setTitle(prompt.title);
        if (prompt.type == ChoicePrompt.Type.MULTIPLE) {
            dialog.setMultiChoiceItems(labels, checked, (d, which, on) -> checked[which] = on);
            dialog.setPositiveButton(android.R.string.ok, (d, which) -> {
                List<String> ids = new ArrayList<>();
                for (int i = 0; i < checked.length; i++) if (checked[i]) ids.add(choices.get(i).id);
                result.complete(prompt.confirm(ids.toArray(new String[0])));
            });
            dialog.setNegativeButton(android.R.string.cancel, null);
        } else {
            dialog.setSingleChoiceItems(labels, selected, (d, which) -> {
                result.complete(prompt.confirm(choices.get(which)));
                d.dismiss();
            });
        }
        dialog.setOnDismissListener(d -> {
            if (!prompt.isComplete()) result.complete(prompt.dismiss());
        });
        dialog.show();
        return result;
    }

    /** The options of the groups in one list; what cannot be chosen is left out. */
    private static void flatten(ChoicePrompt.Choice[] from, List<ChoicePrompt.Choice> into) {
        for (ChoicePrompt.Choice choice : from) {
            if (choice.items != null) flatten(choice.items, into);
            else if (!choice.separator && !choice.disabled) into.add(choice);
        }
    }

    /**
     * A file field (a playlist from a file, the settings brought back).
     * Any type is offered: the page asks by file name endings (.m3u),
     * which Android's picker does not know as types and would grey out.
     */
    private GeckoResult<PromptResponse> pickFile(FilePrompt prompt) {
        if (filePicked != null) return GeckoResult.fromValue(prompt.dismiss());
        Intent pick = new Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
        if (prompt.type == FilePrompt.Type.MULTIPLE) pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        try {
            startActivityForResult(pick, PICK_FILE);
        } catch (ActivityNotFoundException e) {
            return GeckoResult.fromValue(prompt.dismiss());
        }
        filePrompt = prompt;
        filePicked = new GeckoResult<>();
        return filePicked;
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != PICK_FILE || filePicked == null) return;
        List<Uri> files = new ArrayList<>();
        if (result == RESULT_OK && data != null) {
            ClipData several = data.getClipData();
            if (several != null) for (int i = 0; i < several.getItemCount(); i++) files.add(several.getItemAt(i).getUri());
            else if (data.getData() != null) files.add(data.getData());
        }
        FilePrompt prompt = filePrompt;
        GeckoResult<PromptResponse> picked = filePicked;
        filePicked = null;
        filePrompt = null;
        if (files.isEmpty()) {
            picked.complete(prompt.dismiss());
            return;
        }
        // A playlist can be tens of megabytes: copied off the main thread.
        new Thread(() -> {
            List<Uri> copies = new ArrayList<>();
            for (Uri file : files) {
                Uri copy = copy(file, copies.size());
                if (copy != null) copies.add(copy);
            }
            runOnUiThread(() -> picked.complete(copies.isEmpty() ? prompt.dismiss()
                    : copies.size() == 1 ? prompt.confirm(this, copies.get(0))
                    : prompt.confirm(this, copies.toArray(new Uri[0]))));
        }).start();
    }

    /**
     * The picker gives an address only the system can open (content:),
     * and the engine wants a file it can read by its path: handed the
     * address itself it found none ("Unrecognized path", GeckoView 160).
     * So the file is copied into the app's cache under its own name, which
     * the player reads the kind of file from; the last pick's copies go.
     */
    private Uri copy(Uri file, int index) {
        File all = new File(getCacheDir(), "picked");
        if (index == 0) clear(all);
        // A folder each, so that two files of one name keep their names.
        File folder = new File(all, String.valueOf(index));
        folder.mkdirs();
        String name = null;
        try (Cursor row = getContentResolver().query(file, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (row != null && row.moveToFirst()) name = row.getString(0);
        } catch (Exception e) {
            // The name is only a nicety; the content is what matters.
        }
        if (name == null || name.isEmpty()) name = "file";
        File to = new File(folder, name.replaceAll("[/\\\\]", "_"));
        try (InputStream in = getContentResolver().openInputStream(file); OutputStream out = new FileOutputStream(to)) {
            byte[] buffer = new byte[1 << 16];
            for (int n; (n = in.read(buffer)) > 0; ) out.write(buffer, 0, n);
            return Uri.fromFile(to);
        } catch (Exception e) {
            Log.e(TAG, "the picked file could not be read: " + file, e);
            return null;
        }
    }

    private static void clear(File folder) {
        File[] inside = folder.listFiles();
        if (inside == null) return;
        for (File each : inside) {
            if (each.isDirectory()) clear(each);
            each.delete();
        }
    }

    /* ------------------------------------------------------------- links */

    /** A web page to the browser, an intent: link to the app it names. */
    private void outside(String uri) {
        Intent intent;
        try {
            if (uri.startsWith("intent:")) {
                // As a browser does it: only what the other app offers to
                // browsers, and no component chosen by the link.
                intent = Intent.parseUri(uri, Intent.URI_INTENT_SCHEME);
                intent.addCategory(Intent.CATEGORY_BROWSABLE);
                intent.setComponent(null);
                intent.setSelector(null);
            } else {
                intent = new Intent(Intent.ACTION_VIEW, Uri.parse(uri));
            }
        } catch (java.net.URISyntaxException e) {
            Log.w(TAG, "not a link: " + uri);
            return;
        }
        try {
            startActivity(intent);
        } catch (ActivityNotFoundException | SecurityException e) {
            // The app the link names is not installed: its own second
            // choice, a page that says where to get it.
            String fallback = intent.getStringExtra("browser_fallback_url");
            if (fallback != null && (fallback.startsWith("https:") || fallback.startsWith("http:"))) outside(fallback);
            else Log.w(TAG, "nothing opens " + uri);
        }
    }

    /* ------------------------------------------------------- saved files */

    private static final Pattern FILE_NAME = Pattern.compile("filename\\*?=(?:UTF-8'')?\"?([^\";]+)\"?", Pattern.CASE_INSENSITIVE);

    private static String header(WebResponse response, String name) {
        for (Map.Entry<String, String> header : response.headers.entrySet()) {
            if (header.getKey().equalsIgnoreCase(name)) return header.getValue();
        }
        return null;
    }

    private static String fileName(WebResponse response) {
        String name = null;
        String disposition = header(response, "Content-Disposition");
        if (disposition != null) {
            Matcher named = FILE_NAME.matcher(disposition);
            if (named.find()) {
                try {
                    name = URLDecoder.decode(named.group(1).replace("+", "%2B"), "UTF-8");
                } catch (Exception e) {
                    name = named.group(1);
                }
            }
        }
        if (name == null && response.uri != null && !response.uri.startsWith("blob:")) name = Uri.parse(response.uri).getLastPathSegment();
        if (name == null || name.isEmpty()) name = "kepuli-tv";
        return name.replaceAll("[/\\\\:*?\"<>|\\p{Cntrl}]", "_");
    }

    /** Into the device's Downloads, where the Files app and other players find it. */
    private void save(WebResponse response) {
        if (response.body == null) return;
        String name = fileName(response);
        String type = header(response, "Content-Type");
        Uri row = null;
        try (InputStream in = response.body) {
            OutputStream out;
            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.DISPLAY_NAME, name);
                // The name's ending says the kind; a type beside it that
                // Android reads otherwise got a second ending (.m3u.m3u8).
                if (type != null && !name.contains(".")) values.put(MediaStore.Downloads.MIME_TYPE, type.split(";")[0].trim());
                values.put(MediaStore.Downloads.IS_PENDING, 1);
                row = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                out = getContentResolver().openOutputStream(row);
            } else {
                // Before Android 10 the shared Downloads needs a permission
                // of its own; the app's own folder there needs none.
                out = new FileOutputStream(new File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), name));
            }
            try (OutputStream to = out) {
                byte[] buffer = new byte[1 << 16];
                for (int n; (n = in.read(buffer)) > 0; ) to.write(buffer, 0, n);
            }
            if (row != null) {
                ContentValues done = new ContentValues();
                done.put(MediaStore.Downloads.IS_PENDING, 0);
                getContentResolver().update(row, done, null, null);
            }
            // The file's name alone: it reads the same in every language.
            runOnUiThread(() -> Toast.makeText(this, name, Toast.LENGTH_LONG).show());
        } catch (Exception e) {
            Log.e(TAG, "the file was not saved: " + name, e);
            if (row != null) getContentResolver().delete(row, null, null);
        }
    }

    /* ----------------------------------------------------- notifications */

    /**
     * The player asks for "notifications" when reminders are set to be
     * said by the system; from Android 13 on the viewer is asked as well.
     */
    @Override
    protected GeckoResult<AllowOrDeny> grant(String[] permissions, String[] origins) {
        boolean notifications = false;
        for (String permission : permissions) notifications |= permission.equals("notifications");
        if (!notifications || Build.VERSION.SDK_INT < 33
                || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
            return GeckoResult.allow();
        }
        if (notificationsAsked == null) {
            asked = true;
            notificationsAsked = new GeckoResult<>();
            requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, ASK_NOTIFICATIONS);
        }
        return notificationsAsked;
    }

    @Override
    public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(request, permissions, results);
        if (request != ASK_NOTIFICATIONS || notificationsAsked == null) return;
        boolean granted = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
        notificationsAsked.complete(granted ? AllowOrDeny.ALLOW : AllowOrDeny.DENY);
        notificationsAsked = null;
    }

    /**
     * A reminder the extension says while the app runs. The alarm may have
     * shown the same one already (Reminders): it is not shown twice, but a
     * press on it is told to the extension either way.
     */
    private void show(WebNotification notification) {
        shown.put(notification.tag, notification);
        if (Reminders.said(this, notification.tag)) return;
        Reminders.show(this, notification.tag, notification.title, notification.text, null);
        Reminders.markSaid(this, notification.tag);
    }

    /**
     * The app opened from a notification. The extension hears of the press
     * when the notification was its own; one the alarm showed says itself
     * what to play, and the page is told (js/remote.js).
     */
    private void pressed(Intent intent) {
        String id = intent == null ? null : intent.getStringExtra(Reminders.EXTRA_ID);
        if (id == null) return;
        WebNotification notification = shown.remove(id);
        String watch = intent.getStringExtra(Reminders.EXTRA_WATCH);
        if (notification != null) {
            notification.click();
        } else if (watch != null) {
            try {
                JSONObject word = new JSONObject().put("watch", new JSONObject(watch));
                if (page != null) page.postMessage(word);
                else waiting = word;
            } catch (JSONException e) {
                Log.w(TAG, "a reminder without its channel", e);
            }
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        pressed(intent);
    }

    /* ---------------------------------------------------------- playback */

    /**
     * What is on, as the page says it whenever it changes (js/remote.js):
     * whether there is anything, whether it plays, its name, and whether
     * it is a channel, which has a next and a previous one.
     */
    private void now(JSONObject now) {
        if (!now.optBoolean("on")) {
            nothing();
            return;
        }
        PlaybackService.now.title = now.optString("title");
        PlaybackService.now.artist = now.optString("artist");
        PlaybackService.now.live = now.optBoolean("live");
        playing(now.optBoolean("playing"));
    }

    /**
     * Play, pause, the next or the previous channel, asked of the page.
     * A pause and a play show at once in the notification: the page's own
     * word of it took from seconds to a minute to come from a page out of
     * sight, and the button stood wrong meanwhile.
     */
    private void press(String what) {
        tell("press", what);
        if (PlaybackService.now.playing && what.equals(PlaybackService.PAUSE)) playing(false);
        else if (!PlaybackService.now.playing && what.equals(PlaybackService.PLAY)) playing(true);
    }

    private void nothing() {
        playing(false);
        PlaybackService.stop(this);
    }

    /**
     * The page stays as if in sight while the service runs. An engine told
     * to rest kept what was playing going, but a pause could not be taken
     * back from the notification: the picture said playing and stood still.
     */
    @Override
    protected boolean awake() {
        return PlaybackService.running();
    }

    private void playing(boolean on) {
        playing = on;
        PlaybackService.now.playing = on;
        if (on) {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            // The view rests its session by itself when its surface goes
            // (the activity stopped), whatever onStop does, unless told so.
            session.getSessionPictureInPicture().setKeepActive(true);
            PlaybackService.start(this);
        } else {
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            PlaybackService.refresh();
        }
        if (small()) setPictureInPictureParams(window());
    }

    @Override
    protected void onStart() {
        super.onStart();
        started = true;
        PlaybackService.now.visible = true;
        PlaybackService.refresh();
    }

    @Override
    protected void onStop() {
        started = false;
        PlaybackService.now.visible = false;
        PlaybackService.refresh();
        super.onStop();
    }

    @Override
    protected void onDestroy() {
        PlaybackService.controls = null;
        PlaybackService.stop(this);
        super.onDestroy();
    }

    /* ------------------------------------------------ picture in picture */

    /** Whether this device has the small window at all (a setting of the viewer's can still refuse it). */
    private boolean small() {
        return getPackageManager().hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE);
    }

    /**
     * The small window's shape is the picture's, within what Android
     * takes. From Android 12 on the app goes into it by itself when the
     * viewer swipes home while something plays.
     */
    private PictureInPictureParams window() {
        PictureInPictureParams.Builder window = new PictureInPictureParams.Builder().setAspectRatio(shape);
        if (Build.VERSION.SDK_INT >= 31) window.setAutoEnterEnabled(playing).setSeamlessResizeEnabled(true);
        return window.build();
    }

    /** The picture's size, as the page says it (js/remote.js). */
    private void shape(int width, int height) {
        if (width <= 0 || height <= 0) return;
        // Android refuses a window narrower or wider than 2.39 to 1.
        float ratio = Math.max(100f / 239, Math.min(239f / 100, (float) width / height));
        shape = new Rational(Math.round(ratio * 1000), 1000);
        if (small()) setPictureInPictureParams(window());
    }

    /** Home, or the recent apps, while something plays: the picture stays in the small window. */
    @Override
    protected void onUserLeaveHint() {
        super.onUserLeaveHint();
        if (!playing || pip || !small()) return;
        try {
            enterPictureInPictureMode(window());
        } catch (IllegalStateException e) {
            // The viewer has turned the small window off for this app: the
            // sound goes on with the notification instead.
            Log.i(TAG, "no picture in picture", e);
        }
    }

    /**
     * Into the small window and out of it. The page is told, and shows the
     * picture alone while it is small. Out of it there are two ways: back
     * to the whole app, or closed with the window's cross, and a closed
     * one has been stopped (onStop) by the time this is called. Closing
     * the window is the viewer saying enough: what plays is paused.
     */
    @Override
    public void onPictureInPictureModeChanged(boolean small, Configuration configuration) {
        super.onPictureInPictureModeChanged(small, configuration);
        pip = small;
        tell("pip", small);
        frame.requestApplyInsets();
        if (!small && !started) press(PlaybackService.PAUSE);
    }
}
