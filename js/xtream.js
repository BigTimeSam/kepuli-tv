// Xtream-osoitteiden rakentaminen ja purkaminen.

export function baseUrl(cfg) {
  return `${cfg.scheme || 'http'}://${cfg.host}${cfg.port ? ':' + cfg.port : ''}`;
}

/** Purkaa liitetyn get.php- tai player_api-osoitteen asetuskentiksi. */
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
 * Toisto-osoite API:sta saadulle kohteelle.
 * @param {'ts'|'m3u8'} format vain live-kanaville
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
 * Catchup-osoite. Aikaleima on palvelimen paikallisessa ajassa, joka voi
 * poiketa selaimen vyöhykkeestä (tässä tapauksessa Europe/Ljubljana vs.
 * Europe/Helsinki = tunnin ero), joten se lasketaan palvelimen offsetista.
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
 * Selaimen natiivisti toistamat VOD-päätteet. Chrome ei tue Matroskaa
 * (.mkv) eikä .avi:ta, vaikka niiden sisällä olisi H.264 + AAC.
 */
export function isNativelyPlayable(url) {
  return /\.(mp4|m4v|mov|webm|ogv)$/i.test(String(url).split('?')[0]);
}

/** Onko kontti selaimessa toistettavissa pelkän päätteen perusteella. */
export function isPlayableExtension(ext) {
  return /^(mp4|m4v|mov|webm|ogv|ts|flv)$/i.test(String(ext || ''));
}
