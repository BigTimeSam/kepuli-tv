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
// The URL carries the Xtream credentials, so a downloaded playlist is as
// sensitive as the account itself.

import { t } from './i18n.js';

/** Napin selitteeseen: mihin luovutus veisi. */
export function externalLabel() { return t('ext.label'); }

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
  downloadPlaylist(spec, name);
}

/** A one-item playlist. */
export function playlist(spec, name) {
  const lines = ['#EXTM3U', `#EXTINF:-1,${title(name)}`];
  // VLC's own extension: start position in seconds. Other players skip an
  // unknown hash line, so it breaks nothing.
  if (spec.startAt > 0) lines.push(`#EXTVLCOPT:start-time=${Math.floor(spec.startAt)}`);
  lines.push(spec.url, '');
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

/** An anchor click: the download needs the download attribute. */
function click(href, download) {
  const a = document.createElement('a');
  a.href = href;
  a.download = download;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
