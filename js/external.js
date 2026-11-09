// Handing the stream over to an external player.
//
// Wasm decoding covers AC-3, E-AC-3 and DTS, but not everything reaches
// the browser: the AVI container, VC-1, 10-bit H.264 and bitmap subtitles
// (PGS, VOBSUB) stay out of reach. A desktop player handles them natively,
// and the Xtream stream URL suits it as it is — nothing beyond the URL
// needs to be passed on.
//
// There were two routes, one is left. The playlist file: a one-item .m3u
// is downloaded from a blob, and the operating system opens it with
// whichever player is registered for .m3u — for VLC that is
// `public.m3u-playlist` in its Info.plist. `#EXTVLCOPT` carries the resume
// position along. Two clicks, but it works without anything being
// installed for the extension and needs no new manifest permissions.
//
// Player-specific URL schemes (iina://, mpv://) were dropped: they
// required a choice from the user and knowledge of what they had
// installed, and the measured benefit was one click. VLC does not register
// a `vlc://` scheme at all, so for the most common player the file route
// was the only one anyway.
//
// On Android the file route is a poor one: the download lands in a folder
// the viewer has to find, and nothing opens it on its own. There an
// intent: link names VLC's package, and Firefox for Android offers "Open
// this link in VLC app?"; VLC plays the address with the title and the
// position as extras (measured on Android 16, Firefox 159, VLC 3.7.1: the
// film started at the position, under its name). Without VLC, Android
// follows browser_fallback_url to VLC's page on Google Play.
//
// The URL carries the Xtream credentials, so a downloaded playlist is as
// sensitive as the account itself. The intent leaves no file behind.

const VLC_PACKAGE = 'org.videolan.vlc';
const VLC_STORE = `https://play.google.com/store/apps/details?id=${VLC_PACKAGE}`;

/** Whether the player runs on Android, where VLC is handed the stream directly. */
export function onAndroid() {
  return typeof navigator !== 'undefined' && /\bAndroid\b/.test(navigator.userAgent);
}

/**
 * Hands the stream over to an external player.
 *
 * Must be called straight from a user gesture with no await in between: in
 * the browser a download is a gesture-requiring action in the same way as
 * permissions.request.
 *
 * @param {{url: string, startAt?: number}} spec
 * @param {string} name item name for the playlist line and the file name
 */
export function handOff(spec, name) {
  if (onAndroid()) click(vlcIntent(spec, name));
  else downloadPlaylist(spec, name);
}

/**
 * The stream as an Android intent for VLC: the address without its scheme
 * after intent://, the scheme, the package, the title and the position (in
 * milliseconds) as extras. Android decodes the extras' values, so they are
 * encoded here; a ';' or a '#' in a title would otherwise end the extra or
 * the intent.
 * @param {{url: string, startAt?: number}} spec
 * @param {string} name
 */
export function vlcIntent(spec, name) {
  const url = new URL(String(spec.url).replace(/[\r\n]+/g, ''));
  const parts = [
    `scheme=${url.protocol.slice(0, -1)}`,
    'type=video/*',
    `package=${VLC_PACKAGE}`,
    `S.title=${encodeURIComponent(title(name))}`,
  ];
  if (spec.startAt > 0) parts.push(`l.position=${Math.floor(spec.startAt) * 1000}`);
  parts.push(`S.browser_fallback_url=${encodeURIComponent(VLC_STORE)}`);
  const auth = url.username ? `${url.username}${url.password ? `:${url.password}` : ''}@` : '';
  return `intent://${auth}${url.host}${url.pathname}${url.search}#Intent;${parts.join(';')};end`;
}

/** A one-item playlist. */
export function playlist(spec, name) {
  const lines = ['#EXTM3U', `#EXTINF:-1,${title(name)}`];
  // VLC's own extension: start position in seconds. Other players skip an
  // unknown hash line, so it breaks nothing.
  if (spec.startAt > 0) lines.push(`#EXTVLCOPT:start-time=${Math.floor(spec.startAt)}`);
  // The address goes on a line of its own; a line break inside it would
  // add lines the player then reads as playlist entries or options.
  lines.push(String(spec.url).replace(/[\r\n]+/g, ''), '');
  return lines.join('\n');
}

// A newline would cut the playlist short and a comma would split the
// #EXTINF fields.
const title = (name) => String(name || 'Stream').replace(/[\r\n]+/g, ' ').trim();

// Strip from the file name whatever file systems will not accept. Names in
// the library are long, so truncation is needed too.
function filename(name) {
  const clean = title(name).replace(/[/\\:*?"<>|]+/g, '-').replace(/\s+/g, ' ').slice(0, 80).trim();
  return clean || 'stream';
}

function downloadPlaylist(spec, name) {
  const blob = new Blob([playlist(spec, name)], { type: 'audio/x-mpegurl' });
  const href = URL.createObjectURL(blob);
  click(href, `${filename(name)}.m3u`);
  // The blob must not be revoked on the same tick: the download reads it
  // only after the event loop has turned.
  setTimeout(() => URL.revokeObjectURL(href), 60000);
}

/** An anchor click: a download needs the download attribute, an intent none. */
function click(href, download = '') {
  const a = document.createElement('a');
  a.href = href;
  if (download) a.download = download;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
