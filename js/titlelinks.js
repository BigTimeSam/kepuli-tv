// Only construct links to known public services; never navigate to a
// provider-supplied URL or guess a title ID from the provider's own item ID.
function webUrl(value) {
  try {
    const url = new URL(String(value));
    return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url : null;
  } catch { return null; }
}

export function imdbId(value) {
  const text = String(value ?? '').trim();
  if (/^tt\d{7,12}$/.test(text)) return text;
  const url = webUrl(text);
  return url && /^(www\.|m\.)?imdb\.com$/.test(url.hostname)
    ? url.pathname.match(/^\/title\/(tt\d{7,12})(?:\/|$)/)?.[1] || '' : '';
}

export function trailerUrl(value) {
  const text = String(value ?? '').trim();
  let id = /^[\w-]{11}$/.test(text) ? text : '';
  const url = webUrl(text);
  if (url?.hostname === 'youtu.be') id = url.pathname.slice(1).split('/')[0];
  if (url && /^(www\.|m\.)?youtube\.com$/.test(url.hostname)) {
    id = url.pathname === '/watch' ? url.searchParams.get('v') : url.pathname.match(/^\/(?:embed|shorts)\/([\w-]+)/)?.[1];
  }
  return /^[\w-]{11}$/.test(id || '') ? `https://www.youtube.com/watch?v=${id}` : '';
}

/** Preserve identifiers before the API response is reduced and cached. */
export function externalMetadata(info, fallback = {}) {
  const first = (values, parse) => values.map(parse).find(Boolean) || '';
  return {
    title: [info.name, info.title, fallback.name].find(v => typeof v === 'string' && v.trim())?.trim() || '',
    imdbId: first([info.imdb_id, info.imdb, info.imdb_url, info.external_ids?.imdb_id, fallback.imdb_id], imdbId),
    trailer: first([info.youtube_trailer, info.trailer, fallback.youtube_trailer], trailerUrl),
  };
}

export function titleLinks(item, info = {}) {
  info ||= {};
  const name = String(info.title || item.n || '').trim();
  const year = String(info.releaseDate || item.year || '').match(/\b(?:19|20)\d{2}\b/)?.[0] || '';
  const query = [name, year && !name.includes(year) ? year : ''].filter(Boolean).join(' ');
  const imdb = imdbId(info.imdbId);
  const trailer = trailerUrl(info.trailer);
  const links = [];
  if (imdb || query) links.push({ service: 'imdb', search: !imdb, href: imdb
    ? `https://www.imdb.com/title/${imdb}/` : `https://www.imdb.com/find/?${new URLSearchParams({ q: query, s: 'tt' })}` });
  if (trailer) links.push({ service: 'trailer', href: trailer });
  return links;
}
