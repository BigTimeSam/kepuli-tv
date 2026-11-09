// @ts-check
// The extension API namespace, and which engine runs the page.
//
// Chrome knows chrome; Firefox knows both chrome and browser, but only
// browser returns promises there — `await chrome.storage.local.get(key)`
// would come back undefined, and the settings would simply vanish without
// a word. The alias settles both, and it is the one line that makes the
// player run in either browser.
//
// Extension APIs are used in a few files only: config.js, permissions.js,
// sync.js, stalker.js (the portal's header rule) and background.js. The last is not a module and carries the same line
// itself. Everything else — the player, the lists, the guide, the cache,
// the unpacking — is ordinary web code that knows nothing about extension
// APIs, which is why the Firefox package (firefox/) is the same files with
// a manifest of its own.
export const api = globalThis.browser ?? globalThis.chrome;

/**
 * Whether the page runs in Gecko — Firefox and its forks. Asked of the
 * engine rather than the user agent, which a fork names otherwise and a
 * spoofer names as another browser; it is the test the stylesheets make
 * with @supports (-moz-appearance: none).
 */
export function isGecko() {
  return typeof CSS !== 'undefined' && CSS.supports('-moz-appearance', 'none');
}

/**
 * Whether HLS is the browser's own to play and MediaSource is not there:
 * the iPhone's WebKit, which Orion runs on. There mpegts.js and hls.js have
 * no plain MediaSource and fetch the stream themselves, and a live channel
 * did not start; the <video> element plays the channel's HLS address.
 * Chrome answers canPlayType for HLS too, but has MediaSource.
 */
export function nativeHls() {
  return typeof MediaSource === 'undefined' && typeof document !== 'undefined'
    && document.createElement('video').canPlayType('application/vnd.apple.mpegurl') !== '';
}
