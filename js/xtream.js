// Building and parsing Xtream URLs.

export function baseUrl(cfg) {
  return `${cfg.scheme || 'http'}://${cfg.host}${cfg.port ? ':' + cfg.port : ''}`;
}

/** Parses a pasted get.php or player_api URL into settings fields. */
export function parsePlaylistUrl(text) {
  let u;
  try { u = new URL(text.trim()); } catch { return null; }
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
 * Playback URL for an item that came from the API.
 * @param {'ts'|'m3u8'} format live channels only
 */
export function streamUrl(cfg, item, format = 'ts') {
  if (item.direct) return item.direct;
  const base = `${baseUrl(cfg)}`;
  const auth = `${encodeURIComponent(cfg.username)}/${encodeURIComponent(cfg.password)}`;
  if (item.k === 0) return `${base}/live/${auth}/${item.id}.${format}`;
  if (item.k === 1) return `${base}/movie/${auth}/${item.id}.${item.ext || 'mp4'}`;
  if (item.k === 3) return `${base}/series/${auth}/${item.id}.${item.ext || 'mp4'}`;
  return null;
}

/**
 * Catch-up URL. The timestamp is in the server's local time, which can
 * differ from the browser's zone (here Europe/Ljubljana vs.
 * Europe/Helsinki = one hour), so it is derived from the server offset.
 */
export function timeshiftUrl(cfg, streamId, startMs, durationMinutes, serverUtcOffsetMs = 0) {
  const d = new Date(startMs + serverUtcOffsetMs);
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}:` +
                `${pad(d.getUTCHours())}-${pad(d.getUTCMinutes())}`;
  const auth = `${encodeURIComponent(cfg.username)}/${encodeURIComponent(cfg.password)}`;
  return `${baseUrl(cfg)}/timeshift/${auth}/${Math.round(durationMinutes)}/${stamp}/${streamId}.ts`;
}

/**
 * VOD extensions the browser plays natively. Chrome supports neither
 * Matroska (.mkv) nor .avi, even when they hold H.264 + AAC.
 */
export function isNativelyPlayable(url) {
  return /\.(mp4|m4v|mov|webm|ogv)$/i.test(String(url).split('?')[0]);
}

/** Whether the container is playable in the browser judging by extension alone. */
export function isPlayableExtension(ext) {
  return /^(mp4|m4v|mov|webm|ogv|ts|flv)$/i.test(String(ext || ''));
}
