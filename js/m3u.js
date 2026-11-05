// M3U playlists: the extended M3U that IPTV services hand out.
//
// The format has no specification of its own; what is read here is what
// the players that take it (VLC, Kodi's PVR IPTV Simple Client, TiviMate)
// agree on, and what providers' panels write:
//
//   #EXTM3U url-tvg="http://…/guide.xml.gz" catchup="shift" catchup-days="3"
//   #EXTINF:-1 tvg-id="yle1.fi" tvg-name="FI: Yle TV1" tvg-logo="http://…"
//              group-title="Finland",FI: Yle TV1
//   #EXTVLCOPT:http-user-agent=…
//   #EXTGRP:Finland
//   http://example.tv/live/123.m3u8
//
//  - the header may name the programme guide as url-tvg, x-tvg-url or
//    tvg-url, several addresses with commas between them
//  - attribute names come in any case (tvg-ID), quoted with " or ', or not
//    quoted at all; a value may hold a comma, so the title is what follows
//    the first comma outside quotes
//  - #EXTGRP gives the group when group-title does not
//  - a stream line is an address, relative ones against the playlist's own
//  - lines end in \n or \r\n, and the file may start with a byte order mark
//
// The parser takes the playlist in pieces as it downloads, so that a list of
// 80 MB is never one string, and gives back plain entries; what they are —
// a channel, a film, an episode — is classify()'s business.

const VOD_EXTENSIONS = new Set(['mkv', 'mp4', 'avi', 'm4v', 'mov', 'wmv', 'mpg', 'mpeg', 'webm', 'flv', 'divx', 'ogv']);

// "Name S01 E02", "Name S1E2", "Name - s01e02 - Title", "Name 1x02".
const EPISODE = /^(.*?)[\s._-]*\bS(\d{1,4})[\s._-]*E(\d{1,4})\b(.*)$/i;
const EPISODE_X = /^(.*?)\s+(\d{1,2})x(\d{2,3})(?![.\d])\b(.*)$/i;

/** The attributes of an #EXTM3U or #EXTINF line, names in lower case. */
export function parseAttributes(text) {
  const attrs = {};
  const re = /([A-Za-z][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"',]+))/g;
  let m;
  while ((m = re.exec(text))) attrs[m[1].toLowerCase()] = (m[2] ?? m[3] ?? m[4] ?? '').trim();
  return attrs;
}

/**
 * An #EXTINF line into its duration, attributes and title. The title is
 * what follows the first comma that is not inside a quoted value.
 */
export function parseExtinf(line) {
  const body = line.slice(line.indexOf(':') + 1);
  let quote = null;
  let comma = -1;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === ',') { comma = i; break; }
  }
  const head = comma < 0 ? body : body.slice(0, comma);
  const title = comma < 0 ? '' : body.slice(comma + 1).trim();
  const duration = Number.parseFloat(head);
  const attrs = parseAttributes(head.replace(/^\s*-?[\d.]+/, ''));
  return { duration: Number.isFinite(duration) ? duration : -1, attrs, title };
}

/** The programme guide addresses an #EXTM3U line names. */
function guideUrls(attrs) {
  const out = [];
  for (const key of ['url-tvg', 'x-tvg-url', 'tvg-url']) {
    for (const part of String(attrs[key] || '').split(',')) {
      const url = part.trim();
      if (/^https?:\/\//i.test(url) && !out.includes(url)) out.push(url);
    }
  }
  return out;
}

/**
 * The playlist, a piece at a time: push() each piece of text as it arrives,
 * end() when the download is done. Entries arrive through onEntry so that
 * the whole list need never be held twice.
 */
export class M3uParser {
  constructor(base = '', onEntry = null) {
    this.base = base;
    this.onEntry = onEntry;
    this.entries = onEntry ? null : [];
    this.header = { guides: [], catchup: null, catchupDays: 0, catchupSource: '' };
    this.rest = '';
    this.pending = null;      // the #EXTINF waiting for its address
    this.group = '';          // an #EXTGRP waiting for its entry
    this.options = {};        // #EXTVLCOPT lines waiting for their entry
    this.lines = 0;
    this.sawHeader = false;
    this.sawExtinf = false;
  }

  push(text) {
    const data = this.rest + text;
    let start = 0;
    for (;;) {
      const end = data.indexOf('\n', start);
      if (end < 0) break;
      this.line(data.slice(start, end));
      start = end + 1;
    }
    this.rest = data.slice(start);
  }

  end() {
    if (this.rest) this.line(this.rest);
    this.rest = '';
    return { header: this.header, entries: this.entries };
  }

  line(raw) {
    let line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (this.lines++ === 0 && line.charCodeAt(0) === 0xfeff) line = line.slice(1);
    line = line.trim();
    if (!line) return;
    if (line.startsWith('#')) {
      // The tag ends at its colon or, for #EXTM3U with attributes, at the
      // first space: the attributes' own addresses hold colons.
      const tag = /^#[A-Za-z0-9-]+/.exec(line)?.[0].toUpperCase() || '#';
      if (tag === '#EXTM3U') {
        this.sawHeader = true;
        const attrs = parseAttributes(line.slice(7));
        for (const url of guideUrls(attrs)) if (!this.header.guides.includes(url)) this.header.guides.push(url);
        if (attrs.catchup) this.header.catchup = attrs.catchup.toLowerCase();
        if (attrs['catchup-days']) this.header.catchupDays = Number(attrs['catchup-days']) || 0;
        if (attrs['catchup-source']) this.header.catchupSource = attrs['catchup-source'];
      } else if (tag === '#EXTINF') {
        this.sawExtinf = true;
        this.pending = parseExtinf(line);
      } else if (tag === '#EXTGRP') {
        this.group = line.slice(line.indexOf(':') + 1).trim();
      } else if (tag === '#EXTVLCOPT') {
        const [key, ...value] = line.slice(line.indexOf(':') + 1).split('=');
        if (key && value.length) this.options[key.trim().toLowerCase()] = value.join('=').trim();
      }
      return;
    }
    // An address. One without an #EXTINF before it is still a stream —
    // a plain M3U is nothing but addresses — and is named after its file.
    // Until the text has shown itself to be a playlist, by its #EXTM3U or
    // an #EXTINF, only a whole http(s) address counts as one: any line of
    // text resolves against the playlist's own address, and a provider's
    // login page, an expired-account notice or a JSON error used to become
    // a list of channels named "<html>" and "title>" instead of the
    // message that the address is not a playlist.
    if (!this.sawHeader && !this.sawExtinf && !/^https?:\/\//i.test(line)) return;
    // A tag's angle bracket is never part of an address (one would be
    // written %3C), so a line with one is markup, wherever it stands, and
    // is passed over without taking the waiting #EXTINF's address.
    if (line.includes('<')) return;
    const url = this.resolve(line);
    if (!url) { this.pending = null; return; }
    const info = this.pending || { duration: -1, attrs: {}, title: '' };
    const attrs = info.attrs;
    const entry = {
      name: info.title || attrs['tvg-name'] || fileName(url),
      url,
      group: attrs['group-title'] || this.group || '',
      duration: info.duration,
      attrs,
    };
    if (this.options['http-user-agent']) entry.userAgent = this.options['http-user-agent'];
    if (this.options['http-referrer']) entry.referrer = this.options['http-referrer'];
    this.pending = null;
    this.group = '';
    this.options = {};
    if (this.onEntry) this.onEntry(entry); else this.entries.push(entry);
  }

  /** The address as a whole http(s) URL, or null for anything else. */
  resolve(line) {
    let url;
    try { url = new URL(line, this.base || undefined); } catch { return null; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    // An address with white space in it would add lines of its own to the
    // .m3u handed to an external player (js/external.js).
    const text = url.href;
    return /\s/.test(text) ? null : text;
  }
}

/** The whole playlist at once, for tests and small lists. */
export function parseM3u(text, base = '') {
  const parser = new M3uParser(base);
  parser.push(text);
  return parser.end();
}

function fileName(url) {
  try {
    const path = decodeURIComponent(new URL(url).pathname);
    return path.slice(path.lastIndexOf('/') + 1) || url;
  } catch { return url; }
}

/** The file extension of the address's path, lower case, or ''. */
export function extensionOf(url) {
  let path;
  try { path = new URL(url).pathname; } catch { return ''; }
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/**
 * What an entry is: 'live', 'movie' or 'series'. A provider's panel says it
 * in the address (/movie/, /series/); a plain list says it by the file —
 * a film is a file of a film's kind, a channel a stream — and an episode by
 * its name.
 */
export function classify(entry) {
  let path = '';
  try { path = new URL(entry.url).pathname.toLowerCase(); } catch { /* not an address: live */ }
  if (path.includes('/series/')) return 'series';
  // A panel's /movie/ is a film whatever its name says: "10x10" is a title.
  if (path.includes('/movie/') || path.includes('/movies/')) return 'movie';
  if (path.includes('/live/')) return 'live';
  if (VOD_EXTENSIONS.has(extensionOf(entry.url))) return EPISODE.test(entry.name) ? 'series' : 'movie';
  return 'live';
}

/**
 * The series, season and episode a name says, or null. "Show (2025) S01 E02"
 * is the series "Show (2025)", season 1, episode 2; what follows the number
 * is the episode's own title, when there is one.
 */
export function episodeOf(name) {
  const text = String(name || '');
  const m = EPISODE.exec(text) || EPISODE_X.exec(text);
  if (!m) return null;
  const series = m[1].replace(/[\s._:–-]+$/, '').trim();
  if (!series) return null;
  const title = m[4].replace(/^[\s._:–-]+/, '').trim();
  return { series, season: Number(m[2]), episode: Number(m[3]), title };
}

/**
 * A row that is only a heading in the provider's list — "===== Sweden =====",
 * "##### SPORTS #####" — with an address that plays nothing.
 */
export function isDivider(name) {
  return /^\s*([=#*~_-])\1{2,}.*?([=#*~_-])\2{2,}\s*$/.test(String(name || '')) || /^\s*[=#*~_-]{3,}\s*$/.test(String(name || ''));
}

/** A short, stable identifier for a piece of text: FNV-1a, 32 bits, base 36. */
export function shortHash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * Whether a pasted address is an M3U playlist rather than an Xtream
 * server: anything http(s) is taken; whether it holds a playlist is found
 * out by fetching it.
 */
export function playlistAddress(text) {
  let url;
  try { url = new URL(String(text || '').trim()); } catch { return null; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.hostname) return null;
  return url.href;
}

/* ------------------------------------------------------------- catch-up */

const pad = (n, width = 2) => String(n).padStart(width, '0');

/** A strftime-like date in UTC: Y m d H M S, the letters Kodi's catch-up templates use. */
function dateParts(ms, format) {
  const d = new Date(ms);
  const parts = {
    Y: d.getUTCFullYear(), m: pad(d.getUTCMonth() + 1), d: pad(d.getUTCDate()),
    H: pad(d.getUTCHours()), M: pad(d.getUTCMinutes()), S: pad(d.getUTCSeconds()),
  };
  return format.replace(/[YmdHMS]/g, (c) => parts[c]);
}

/**
 * A catch-up template filled in, as the players that take extended M3U
 * write them: {utc}, ${start}, {utcend}, ${end}, {lutc}, ${now},
 * ${timestamp}, {duration}, {duration:60} (divided), {offset}, {offset:60},
 * {Y}…{S}, and {utc:Y-m-d H:M:S} with a date format.
 */
export function fillCatchup(template, startMs, stopMs, nowMs = Date.now()) {
  const start = Math.floor(startMs / 1000);
  const end = Math.floor(stopMs / 1000);
  const now = Math.floor(nowMs / 1000);
  const values = {
    utc: start, start, utcend: end, end, lutc: now, now, timestamp: now,
    duration: end - start, offset: now - start,
  };
  return String(template).replace(/\$?\{(\w+)(?::([^}]+))?\}|\$\((\w)\)(\w+)/g, (whole, name, arg, which, format) => {
    if (which) return dateParts(which === 'e' ? stopMs : startMs, format.replace(/yyyy/g, 'Y').replace(/MM/g, 'm').replace(/dd/g, 'd').replace(/HH/g, 'H').replace(/mm/g, 'M').replace(/ss/g, 'S'));
    if (/^[YmdHMS]$/.test(name) && !arg) return dateParts(startMs, name);
    if (name in values) {
      if (!arg) return String(values[name]);
      if (/^\d+$/.test(arg)) return String(Math.floor(values[name] / Number(arg)));
      return dateParts((name === 'utcend' || name === 'end' ? end : name === 'lutc' || name === 'now' ? now : start) * 1000, arg);
    }
    return whole;
  });
}

/**
 * The address of a programme in a channel's archive, or null when the
 * channel says nothing the address can be built from. catchup is the
 * channel's (or the playlist's) catchup attribute: default and append use
 * the catchup-source template, the first in place of the address and the
 * second after it; shift adds utc and lutc to the query; flussonic and xc
 * rewrite the address the way those servers name their archives.
 */
export function catchupAddress(item, startMs, stopMs, nowMs = Date.now()) {
  const mode = String(item.cu?.mode || '').toLowerCase();
  const source = item.cu?.source || '';
  const url = item.direct;
  if (!url || !mode) return null;
  if ((mode === 'default' || mode === 'append') && source) {
    const filled = fillCatchup(source, startMs, stopMs, nowMs);
    if (mode === 'append' || !/^https?:\/\//i.test(filled)) return url + filled;
    return filled;
  }
  if (mode === 'shift' || mode === 'timeshift') {
    return `${url}${url.includes('?') ? '&' : '?'}utc=${Math.floor(startMs / 1000)}&lutc=${Math.floor(nowMs / 1000)}`;
  }
  const start = Math.floor(startMs / 1000);
  const duration = Math.max(60, Math.floor((stopMs - startMs) / 1000));
  if (mode === 'flussonic' || mode === 'flussonic-hls' || mode === 'flussonic-ts' || mode === 'fs') {
    const u = new URL(url);
    const m = /^(.*\/)([^/]*)$/.exec(u.pathname);
    if (!m) return null;
    const file = m[2];
    // …/channel/index.m3u8 → …/channel/index-<start>-<duration>.m3u8,
    // …/channel/mpegts → …/channel/timeshift_abs-<start>.ts
    if (/\.m3u8$/i.test(file) || mode === 'flussonic-hls') u.pathname = `${m[1]}${file.replace(/\.m3u8$/i, '') || 'index'}-${start}-${duration}.m3u8`;
    else u.pathname = `${m[1]}timeshift_abs-${start}.ts`;
    return u.href;
  }
  if (mode === 'xc') {
    // A panel's live address: http://host:port[/live]/user/pass/id[.ext]
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts[0] === 'live') parts.shift();
    if (parts.length < 3) return null;
    const [user, pass, file] = parts.slice(-3);
    const id = file.replace(/\.\w+$/, '');
    const minutes = Math.max(1, Math.ceil((stopMs - startMs) / 60000));
    return `${u.origin}/timeshift/${user}/${pass}/${minutes}/${dateParts(startMs, 'Y-m-d:H-M')}/${id}.ts`;
  }
  return null;
}
