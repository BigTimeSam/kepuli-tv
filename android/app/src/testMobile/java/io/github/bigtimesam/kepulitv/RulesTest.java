package io.github.bigtimesam.kepulitv;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** The phone's pure rules (Rules.java): ./gradlew testMobileDebugUnitTest. */
public class RulesTest {
    @Test
    public void aSavedFileIsNamedByItsDisposition() {
        assertEquals("playlist.m3u", Rules.fileName("attachment; filename=\"playlist.m3u\"", "blob:moz-extension://x/1"));
        assertEquals("Uutiset 20.30.ts", Rules.fileName("attachment; filename*=UTF-8''Uutiset%2020.30.ts", null));
        // A plus in a name is a plus, not the space a form would make of it.
        assertEquals("a+b.m3u", Rules.fileName("attachment; filename=a+b.m3u", null));
    }

    @Test
    public void withoutOneByItsAddressOrTheApp() {
        assertEquals("film.mp4", Rules.fileName(null, "http://example.org/movie/u/p/film.mp4?token=1"));
        assertEquals("kepuli-tv", Rules.fileName(null, "blob:moz-extension://x/1"));
        assertEquals("kepuli-tv", Rules.fileName(null, "http://example.org/"));
        assertEquals("kepuli-tv", Rules.fileName(null, null));
    }

    @Test
    public void whatAFileSystemRefusesIsReplaced() {
        assertEquals(".._.._etc_passwd", Rules.fileName("attachment; filename=\"../../etc/passwd\"", null));
        assertEquals("a_b_c_.ts", Rules.fileName("attachment; filename=\"a:b*c?.ts\"", null));
    }

    @Test
    public void onlyLinksOfTheWebAndOfPlayersLeaveTheApp() {
        assertTrue(Rules.opens("https://www.imdb.com/title/tt0000001/"));
        assertTrue(Rules.opens("HTTP://example.org/"));
        assertTrue(Rules.opens("vlc://http://example.org/live/u/p/1.ts"));
        assertTrue(Rules.opens("market://details?id=org.videolan.vlc"));
        assertFalse(Rules.opens("file:///data/data/io.github.bigtimesam.kepulitv/files/x"));
        assertFalse(Rules.opens("content://media/external/downloads/1"));
        assertFalse(Rules.opens("javascript:alert(1)"));
        assertFalse(Rules.opens("no scheme at all"));
        assertEquals("intent", Rules.scheme("intent://x#Intent;end"));
    }

    @Test
    public void aMediaKeyAsksWhatTheSessionWouldAsk() {
        assertEquals("pause", Rules.mediaKey(android.view.KeyEvent.KEYCODE_MEDIA_PAUSE, true));
        assertEquals("play", Rules.mediaKey(android.view.KeyEvent.KEYCODE_MEDIA_PLAY, false));
        assertEquals("pause", Rules.mediaKey(android.view.KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, true));
        assertEquals("play", Rules.mediaKey(android.view.KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, false));
        assertEquals("next", Rules.mediaKey(android.view.KeyEvent.KEYCODE_MEDIA_NEXT, true));
        assertEquals("previous", Rules.mediaKey(android.view.KeyEvent.KEYCODE_MEDIA_PREVIOUS, true));
        assertEquals(null, Rules.mediaKey(android.view.KeyEvent.KEYCODE_BACK, true));
    }

    @Test
    public void theSmallWindowKeepsWithinWhatAndroidTakes() {
        assertEquals(16f / 9, Rules.ratio(1920, 1080), 0.001f);
        assertEquals(2.39f, Rules.ratio(4000, 100), 0.001f);
        assertEquals(1 / 2.39f, Rules.ratio(100, 4000), 0.001f);
    }

    @Test
    public void theAppsPlayerTakesTheWebsAddressesAlone() {
        assertTrue(Rules.playable("http://provider.example/live/1.m3u8"));
        assertTrue(Rules.playable("HTTPS://provider.example/movie/1.mp4"));
        assertFalse(Rules.playable("file:///sdcard/film.mp4"));
        assertFalse(Rules.playable("intent://film#Intent;end"));
        assertFalse(Rules.playable(null));
    }

    @Test
    public void thePagesBoxInTheScreensPixels() {
        assertArrayEquals(new int[] { 26, 420, 1050, 591 }, Rules.pixels(10, 160, 400, 225, 2.625));
        // Two boxes that touch in the page touch on the screen: 10.4 + 100.3 is where the next begins.
        int[] first = Rules.pixels(10.4, 0, 100.3, 50, 2.625), second = Rules.pixels(110.7, 0, 40, 50, 2.625);
        assertEquals(first[0] + first[2], second[0]);
        assertArrayEquals(new int[] { 0, 0, 0, 0 }, Rules.pixels(0, 0, -5, 0, 3));
    }

    @Test
    public void thePicturesStateAsThePageHearsIt() {
        assertEquals("loading", Rules.state(false, false));
        assertEquals("loading", Rules.state(false, true));
        assertEquals("playing", Rules.state(true, true));
        assertEquals("paused", Rules.state(true, false));
    }

    @Test
    public void aTouchInAHoleIsThePages() {
        assertTrue(Rules.within(15, 15, 10, 10, 20, 20));
        assertFalse(Rules.within(20, 15, 10, 10, 20, 20));
        assertFalse(Rules.within(5, 15, 10, 10, 20, 20));
        assertTrue(Rules.same(null, ""));
        assertFalse(Rules.same("fi", null));
    }
}
