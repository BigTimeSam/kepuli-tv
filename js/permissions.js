// Optional host permissions.
//
// The manifest does not ask for access to every address at install time,
// because "read and change all your data on all websites" is the single
// biggest reason Chrome Web Store review rejects an extension. Access is
// asked for only once the user points at their own server — then the
// justification is self-evident.
//
// Access is needed only where the extension makes a fetch/XHR request:
// player_api.php, get.php and the segment requests of hls.js and
// mpegts.js. A native <video src> and <img> logos work without it.
//
// NOTE: chrome.permissions.request() requires a user gesture, and the
// gesture is spent by the first await. Call requestAccess() straight from
// the top of the click handler, before any other await. For an origin
// that is already granted the call returns true immediately without
// showing a dialog, so a separate hasAccess() check must not precede it.

/**
 * https://host:port/path → "https://host/*", or null if not a web URL.
 *
 * The port is dropped on purpose: in Chrome's match pattern syntax the
 * host name may not contain a port, and a pattern with one is rejected as
 * invalid. A portless pattern covers every port on the host.
 */
export function originPattern(url) {
  let u;
  try {
    u = new URL(String(url));
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  return `${u.protocol}//${u.hostname}/*`;
}

/**
 * Has the origin already been granted? True for non-web URLs, because
 * they need nothing. Use only for showing state — never before
 * requestAccess (it would spend the user gesture).
 */
export async function hasAccess(url) {
  const pattern = originPattern(url);
  if (!pattern) return true;
  try {
    return await chrome.permissions.contains({ origins: [pattern] });
  } catch (err) {
    console.warn('[iptv] permission check failed', pattern, err);
    return false;
  }
}

/** Requests access to the origin. Must be called straight from a user gesture. */
export async function requestAccess(url) {
  const pattern = originPattern(url);
  if (!pattern) return true;
  try {
    return await chrome.permissions.request({ origins: [pattern] });
  } catch (err) {
    console.warn('[iptv] permission request failed', pattern, err);
    return false;
  }
}
