// @ts-check
// Building and parsing Xtream URLs.

export function baseUrl(cfg) {
  return `${cfg.scheme || 'http'}://${cfg.host}${cfg.port ? ':' + cfg.port : ''}`;
}

/** Parses a pasted get.php or player_api URL into settings fields. */
export function parsePlaylistUrl(text) {
  let u;
  try { u = new URL(text.trim()); } catch { return null; }
  if (!u.hostname || !['http:', 'https:'].includes(u.protocol)) return null;
  const username = u.searchParams.get('username');
  const password = u.searchParams.get('password');
  if (!username || !password) return null;
  return {
    scheme: u.protocol.replace(':', ''),
    host: u.hostname,
    port: u.port || (u.protocol === 'https:' ? '443' : '80'),
    username,
    password,
  };
}

/**
 * Which way of connecting a pasted address belongs to, for the field that
 * comes first in Settings: an Xtream subscription (credentials in the
 * query), a Stalker portal (the MAG box's /c/ page or a portal script),
 * any other web address a playlist, and anything else none (null).
 */
export function pastedKind(text) {
  let u;
  try { u = new URL(String(text || '').trim()); } catch { return null; }
  if (!u.hostname || !['http:', 'https:'].includes(u.protocol)) return null;
  if (parsePlaylistUrl(u.href)) return 'xtream';
  if (/\/c\/?(index\.html?)?$|\/stalker_portal\/|\/(portal|load)\.php$/i.test(u.pathname)) return 'stalker';
  return 'm3u';
}

/**
 * What was typed into the Server field, split into the fields it belongs
 * in. A bare host name is left alone. A whole address — pasted, most
 * likely: "http://example.tv:8080", or a player_api link with the
 * credentials in it — gives its scheme, host and port, and the credentials
 * when they are there. Taken as a host name, an address would make the
 * origin "http://http" and the permission prompt would ask for that.
 * Returns only the fields the text settles, or null when it is no address.
 */
export function parseServer(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  if (!/[/:?]/.test(raw)) return { host: raw };
  const explicit = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
  let u;
  try { u = new URL(explicit ? raw : `http://${raw}`); } catch { return null; }
  if (!u.hostname || (u.protocol !== 'http:' && u.protocol !== 'https:')) return null;
  const out = { host: u.hostname };
  if (explicit) out.scheme = u.protocol.replace(':', '');
  if (u.port) out.port = u.port;
  else if (explicit) out.port = u.protocol === 'https:' ? '443' : '80';
  const username = u.searchParams.get('username');
  const password = u.searchParams.get('password');
  if (username && password) Object.assign(out, { username, password });
  return out;
}

/**
 * A provider's direct_source, when it is an address to play. The value
 * goes into the video element, onto the clipboard and into the .m3u
 * handed to an external player, and a provider's catalogue is not to be
 * trusted with any of those: anything but http(s), and anything with
 * white space in it — a line break would add lines of its own to the
 * playlist — is dropped, and the stream is played from the server's own
 * address instead.
 */
export function directSource(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^https?:\/\/[^\s]+$/i.test(trimmed)) return null;
  try { new URL(trimmed); } catch { return null; }
  return trimmed;
}

/**
 * Playback URL for an item that came from the API.
 * @param {'ts'|'m3u8'} format live channels only
 */
export function streamUrl(cfg, item, format = 'ts') {
  // Checked here too: a list cached before the check was made carries the
  // value as the provider sent it.
  const direct = directSource(item.direct);
  if (direct) return direct;
  const base = `${baseUrl(cfg)}`;
  const auth = `${encodeURIComponent(cfg.username)}/${encodeURIComponent(cfg.password)}`;
  if (item.k === 0) return `${base}/live/${auth}/${item.id}.${format}`;
  if (item.k === 1) return `${base}/movie/${auth}/${item.id}.${item.ext || 'mp4'}`;
  if (item.k === 3) return `${base}/series/${auth}/${item.id}.${item.ext || 'mp4'}`;
  return null;
}

/**
 * The server's wall clock at an instant, as "YYYY-MM-DD:HH-MM" — the form
 * the timeshift path takes. The server's time zone, when it named one the
 * browser knows, gives the offset in force at that instant; a programme
 * from before a change of daylight saving time is an hour off otherwise.
 * Without one, the offset measured at connecting has to stand for every
 * instant; with no offset either (null), the answer is null.
 */
export function serverStamp(ms, timeZone, fallbackOffsetMs = 0) {
  const pad = (n) => String(n).padStart(2, '0');
  if (timeZone) {
    let parts = null;
    try {
      parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
        timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
    } catch { /* a zone the browser does not know: the measured offset stands */ }
    if (parts) return `${parts.year}-${parts.month}-${parts.day}:${parts.hour}-${parts.minute}`;
  }
  if (fallbackOffsetMs == null) return null;
  const d = new Date(ms + fallbackOffsetMs);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}:` +
         `${pad(d.getUTCHours())}-${pad(d.getUTCMinutes())}`;
}

/**
 * Catch-up URL. The timestamp is in the server's local time, which can
 * differ from the browser's zone (here Europe/Ljubljana vs.
 * Europe/Helsinki = one hour); see serverStamp.
 */
export function timeshiftUrl(cfg, streamId, startMs, durationMinutes, serverUtcOffsetMs = 0, serverTimezone = null) {
  const stamp = serverStamp(startMs, serverTimezone, serverUtcOffsetMs);
  const auth = `${encodeURIComponent(cfg.username)}/${encodeURIComponent(cfg.password)}`;
  return `${baseUrl(cfg)}/timeshift/${auth}/${Math.round(durationMinutes)}/${stamp}/${streamId}.ts`;
}

/** Whether the container is playable in the browser judging by extension alone. */
export function isPlayableExtension(ext) {
  return /^(mp4|m4v|mov|webm|ogv|ts|flv)$/i.test(String(ext || ''));
}
