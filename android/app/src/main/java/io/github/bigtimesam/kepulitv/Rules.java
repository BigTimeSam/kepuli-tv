package io.github.bigtimesam.kepulitv;

import java.net.URLDecoder;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The phone's and the tablet's rules that need nothing of Android: what a
 * saved file is called, which links are handed to another app, the shape
 * the small window may take. Apart from the activity so that they are
 * tested on the build machine (src/testMobile), where Android's own
 * classes are stubs.
 */
final class Rules {
    private Rules() { }

    private static final Pattern FILE_NAME = Pattern.compile("filename\\*?=(?:UTF-8'')?\"?([^\";]+)\"?", Pattern.CASE_INSENSITIVE);

    /**
     * A saved file's name: the one its Content-Disposition gives, else the
     * last part of its address (a blob's address names nothing), else the
     * app's; with what a file system refuses in a name replaced.
     */
    static String fileName(String disposition, String uri) {
        String name = null;
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
        if (name == null && uri != null && !uri.startsWith("blob:")) {
            String path = uri.replaceFirst("[?#].*$", "");
            name = path.substring(path.lastIndexOf('/') + 1);
        }
        if (name == null || name.isEmpty()) name = "kepuli-tv";
        return name.replaceAll("[/\\\\:*?\"<>|\\p{Cntrl}]", "_");
    }

    /** An address's scheme, in small letters, or "" when it has none. */
    static String scheme(String uri) {
        Matcher m = Pattern.compile("^([A-Za-z][A-Za-z0-9+.-]*):").matcher(uri == null ? "" : uri);
        return m.find() ? m.group(1).toLowerCase(Locale.ROOT) : "";
    }

    /**
     * Whether a link that is not the player's own is handed to the app
     * that opens such things: a page of the web, a letter, a shop's page,
     * another player's own address. Not a file's, a content provider's or
     * a script's: the player has no such link, and what asked for one
     * would be reading the device or running code in whatever answered.
     * (An intent: link is taken apart and narrowed by the activity.)
     */
    static boolean opens(String uri) {
        switch (scheme(uri)) {
            case "http": case "https": case "mailto": case "market": case "vlc": case "vlc-x-callback":
                return true;
            default:
                return false;
        }
    }

    /**
     * What a media key asks of the page, by the names the page knows, or
     * null for any other key. The one key that is both asks for the other
     * of what is going on. The codes are Android's (KeyEvent), written out
     * so that this needs nothing of Android.
     */
    static String mediaKey(int code, boolean playing) {
        switch (code) {
            case 126: return "play";                        // KEYCODE_MEDIA_PLAY
            case 127: return "pause";                       // KEYCODE_MEDIA_PAUSE
            case 85: return playing ? "pause" : "play";     // KEYCODE_MEDIA_PLAY_PAUSE
            case 87: return "next";                         // KEYCODE_MEDIA_NEXT
            case 88: return "previous";                     // KEYCODE_MEDIA_PREVIOUS
            default: return null;
        }
    }

    /** The small window's shape for a picture: its own, within the 2.39 to 1 either way that Android takes. */
    static float ratio(int width, int height) {
        return Math.max(100f / 239, Math.min(239f / 100, (float) width / height));
    }

    /* ------------------------------------------- the app's own player */

    /**
     * Whether the app's player is handed this address at all: one of the
     * web's, as a provider's are. Anything else (a file, a content: or an
     * intent: address) is not the page's to hand over.
     */
    static boolean playable(String url) {
        if (url == null) return false;
        String lower = url.toLowerCase(Locale.ROOT);
        return lower.startsWith("http://") || lower.startsWith("https://");
    }

    /**
     * A box of the page's, in its own pixels, as the screen's: left, top,
     * width, height. The edges are rounded each by itself, so that two
     * boxes that touch in the page touch on the screen.
     */
    static int[] pixels(double left, double top, double width, double height, double ratio) {
        int x = (int) Math.round(left * ratio), y = (int) Math.round(top * ratio);
        int right = (int) Math.round((left + width) * ratio), bottom = (int) Math.round((top + height) * ratio);
        return new int[] { x, y, Math.max(0, right - x), Math.max(0, bottom - y) };
    }

    /** What the page is told of the picture: loading until it can play, then playing or paused. */
    static String state(boolean ready, boolean playing) {
        return !ready ? "loading" : playing ? "playing" : "paused";
    }

    /** Whether a point lies in a box given by its edges. */
    static boolean within(float x, float y, float left, float top, float right, float bottom) {
        return x >= left && x < right && y >= top && y < bottom;
    }

    /** Two languages of a track, where none (subtitles off) is the same as the empty one. */
    static boolean same(String a, String b) {
        return (a == null ? "" : a).equals(b == null ? "" : b);
    }
}
