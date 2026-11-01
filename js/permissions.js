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
// NOTE: permissions.request() requires a user gesture, and the
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
import { api } from './browser.js';

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
    return await api.permissions.contains({ origins: [pattern] });
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
    return await api.permissions.request({ origins: [pattern] });
  } catch (err) {
    console.warn('[iptv] permission request failed', pattern, err);
    return false;
  }
}

// Every web address: the widest the optional permissions go.
const EVERYWHERE = ['http://*/*', 'https://*/*'];

/** Has every address been granted? For showing state only, as hasAccess. */
export async function hasAccessEverywhere() {
  try {
    return await api.permissions.contains({ origins: EVERYWHERE });
  } catch {
    return false;
  }
}

/** Requests every address. Must be called straight from a user gesture, as requestAccess. */
export async function requestAccessEverywhere() {
  try {
    return await api.permissions.request({ origins: EVERYWHERE });
  } catch (err) {
    console.warn('[iptv] permission request failed', EVERYWHERE, err);
    return false;
  }
}

/**
 * Whether the address answers by sending the request on to another one.
 *
 * A provider may answer a stream's address with a redirect to another
 * server — a load balancer, a CDN — and the permission granted for the
 * first host does not cover the second: the request fails there as a
 * network error, the same as a server that is down, and the player has
 * no way to read the address it was sent to. A request with redirect
 * 'manual' stops at the redirect and says only that there was one
 * (an "opaqueredirect" response, its Location hidden by the browser), so
 * the host to ask for cannot be named — only that one is needed.
 *
 * HEAD, so that a stream that does not redirect is not opened as a
 * connection the account counts; a server that refuses HEAD answers
 * "no redirect", and nothing more is said than before.
 */
export async function redirects(url, { timeout = 5000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'manual', credentials: 'omit', cache: 'no-store', signal: ctrl.signal });
    return res.type === 'opaqueredirect';
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
    ctrl.abort();
  }
}
