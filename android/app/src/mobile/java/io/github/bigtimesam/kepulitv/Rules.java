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

    /** The small window's shape for a picture: its own, within the 2.39 to 1 either way that Android takes. */
    static float ratio(int width, int height) {
        return Math.max(100f / 239, Math.min(239f / 100, (float) width / height));
    }
}
