// @ts-check
// Where the page runs, when it is not a browser's tab: read once from the
// page's address, which is how each app opens it.
//
// It is told by the address and not by sniffing: another WebKit browser
// that runs extensions (Orion) would pass any test of the engine or of
// the address's scheme, and is not the app; and a test can open the same
// page in a desktop browser. A module of its own, without the DOM's
// elements or the extension API, so that every module and the unit tests
// can take it. All four are false in Node.
//
// What each app does around the page is in a module of its own:
// js/iosapp.js, js/androidapp.js and js/remote.js; the line to the native
// side that the first two share is js/host.js.

const asked = typeof location !== 'undefined' && typeof document !== 'undefined' ? new URLSearchParams(location.search) : null;

/** The app for the iPhone and the iPad (ios/): player.html?ios=1. */
export const ios = asked?.get('ios') === '1';

/**
 * The Android app on a phone or a tablet (android/, the `mobile`
 * package): player.html?app=1. Touch drives it, and the app keeps the
 * picture in a small window and the sound going when it is left.
 */
export const inApp = Boolean(asked?.has('app'));

/**
 * A television's remote control drives the player (js/remote.js):
 * player.html?tv=1, as the Android TV app opens it (android/, the `tv`
 * package).
 */
export const remote = Boolean(asked?.has('tv'));

/**
 * An app with a Chromecast sender of its own is around the page: the
 * iPhone's and the iPad's, or Android's on a phone or a tablet.
 */
export const native = ios || inApp;
