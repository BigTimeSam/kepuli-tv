// Which audio track is played, and what it is called.
//
// A file often carries more than one: the original and a dub, a director's
// commentary, an audio description. Only one of them reaches MediaSource,
// and the choice is the player's to make — neither browser offers
// HTMLMediaElement.audioTracks (measured: Chrome 152 and Firefox 155 both
// answer false), so nothing below the player can pick a track for us.
//
// Two routes lead to MediaSource:
//
//   passthrough  AAC as it is, wrapped in an mp4a sample entry (mp4.js).
//                Only AAC: an mp4a entry around an Opus or a FLAC track is
//                a rejected init segment, not playback, see passthroughMime.
//   decoded      AC-3, E-AC-3 and DTS, decoded with wasm (ffaudio.js) and
//                re-encoded with the browser's own encoder (transcode.js).
//
// An untouched track always beats a re-encoded one, so passthrough wins
// over decoding even when the file marks the decoded track default. That
// is exactly what saves discs carrying both AC-3 and AAC.
//
// The same description serves the header reader (probe.js) and the
// unpacker (remux.js): the details below the player and what is actually
// heard are then decided by one function, and cannot disagree.

import { t } from './i18n.js';
import { decodable } from './ffaudio.js';
import { isLanguageName, languageLabel, sameish, shortLanguage, shorten, trackLanguage } from './lang.js';

const AUDIO_TYPE = 2;

export const isAudio = (track) => track.type === AUDIO_TYPE;

// Matroska CodecID → the codec string MediaSource is asked for.
export const AUDIO_MIME = {
  'A_AAC': 'mp4a.40.2', 'A_AAC/MPEG4/LC': 'mp4a.40.2', 'A_AAC/MPEG4/LC/SBR': 'mp4a.40.5',
  'A_AAC/MPEG2/LC': 'mp4a.40.2', 'A_AAC/MPEG2/LC/SBR': 'mp4a.40.5',
  'A_AC3': 'ac-3', 'A_EAC3': 'ec-3', 'A_DTS': 'dtsc', 'A_DTS/EXPRESS': 'dtse',
  'A_DTS/LOSSLESS': 'dtsl', 'A_TRUEHD': 'mlpa', 'A_MPEG/L3': 'mp4a.69', 'A_MPEG/L2': 'mp4a.69',
  'A_OPUS': 'opus', 'A_VORBIS': 'vorbis', 'A_FLAC': 'flac',
};

// The short name shown in the details and in the selector.
export const AUDIO_NAME = {
  'A_AAC': 'aac', 'A_AAC/MPEG4/LC': 'aac', 'A_AAC/MPEG4/LC/SBR': 'aac',
  'A_AAC/MPEG2/LC': 'aac', 'A_AAC/MPEG2/LC/SBR': 'aac',
  'A_AC3': 'ac3', 'A_EAC3': 'eac3', 'A_DTS': 'dts', 'A_DTS/EXPRESS': 'dts',
  'A_DTS/LOSSLESS': 'dts', 'A_TRUEHD': 'truehd', 'A_MPEG/L3': 'mp3', 'A_MPEG/L2': 'mp2',
  'A_OPUS': 'opus', 'A_VORBIS': 'vorbis', 'A_FLAC': 'flac', 'A_PCM/INT/LIT': 'pcm',
};

/**
 * The codec string for a track the remuxer can hand to MediaSource as it
 * is, or null. Only AAC: the init segment describes it with an mp4a entry
 * around the track's own AudioSpecificConfig, and that is the one
 * description mp4.js can write from a Matroska header. Opus, Vorbis, FLAC
 * and MP3 in MKV would each need a sample entry of their own — the browser
 * may well say yes to the codec, but an mp4a entry under an Opus track is
 * a rejected init segment, not playback. So they are not passed on: a file
 * with such a track and an AC-3 one takes the decoded route, and one with
 * nothing else is marked silent, honestly.
 */
export function passthroughMime(codecId) {
  const mime = AUDIO_MIME[codecId];
  return mime && mime.startsWith('mp4a.40') ? mime : null;
}

// Memoised: a list row asks for this on every paint, and the answer
// depends on the browser rather than on the file. Exported because
// probe.js asks the same question about video tracks.
const supportCache = new Map();

export function supports(type) {
  if (!supportCache.has(type)) {
    let ok = false;
    try { ok = typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(type); } catch { ok = false; }
    supportCache.set(type, ok);
  }
  return supportCache.get(type);
}

/**
 * How the track could reach MediaSource: 'passthrough', 'decoded', or null
 * when neither route is open. Recomputed rather than remembered — a cached
 * probe result outlives a browser update, and what the browser decodes is
 * the browser's business, not the file's.
 */
export function route(codecId) {
  const mime = passthroughMime(codecId);
  if (mime && supports(`audio/mp4; codecs="${mime}"`)) return 'passthrough';
  return decodable(codecId) ? 'decoded' : null;
}

// FlagCommentary and FlagVisualImpaired came into Matroska late and are
// rarely written; the track's own name is what usually says it, and says
// it in one of the two interface languages often enough to be worth
// reading. A wrong guess costs little: such a track is still chosen when
// it is asked for by language, or when it is all the file has.
const COMMENTARY = /\bcommentar(y|ies)\b|\bkommentti(raita|ääni)?\b/i;
const DESCRIBED = /\baudio.?description\b|\bdescriptive\b|\bkuvailutulkka/i;

/**
 * One audio track as the selector and the details need it. The facts only:
 * the label is built when it is shown, because the interface language can
 * change mid-session and probe.js caches this shape for 90 days.
 *
 * @param {object} track a Matroska TrackEntry, see ebml.js
 */
export function describe(track) {
  const codecId = track.codecId || null;
  const name = track.name || null;
  return {
    number: track.number,
    codecId,
    codec: codecId ? (AUDIO_NAME[codecId] || codecId.replace(/^A_/, '').toLowerCase()) : null,
    route: route(codecId),
    language: trackLanguage(track),
    name,
    channels: track.channels || 0,
    default: track.isDefault !== false,
    forced: Boolean(track.forced),
    original: Boolean(track.original),
    commentary: Boolean(track.commentary) || (name ? COMMENTARY.test(name) : false),
    described: Boolean(track.visualImpaired) || (name ? DESCRIBED.test(name) : false),
  };
}

/** Every audio track of a Matroska header, in the file's own order. */
export const describeAll = (tracks) => tracks.filter(isAudio).map(describe);

// mono, stereo, 5.1 and 7.1 are written the same way in both interface
// languages, so they go in as they are; an unusual count gets the count.
const LAYOUT = { 1: 'mono', 2: 'stereo', 6: '5.1', 7: '6.1', 8: '7.1' };

const layout = (channels) => (channels ? LAYOUT[channels] || t('audio.channels', { n: channels }) : null);

/**
 * The name shown in the selector: "Finnish · AC-3 5.1", "English ·
 * Commentary · AAC stereo". The language comes first because that is what
 * the choice is about; the codec comes last because it is the part the
 * viewer reads only when two tracks share a language.
 *
 * @param {object} entry from describe()
 */
export function label(entry) {
  const code = shortLanguage(entry.language);
  let base = code === 'und' ? null : languageLabel(code);
  if (!base) base = entry.name ? shorten(entry.name) : t('audio.unknown');
  const extras = [];
  // A track's own name often says what the language does not: "Original",
  // "Dub", "Commentary". A name that only repeats the language — a Finnish
  // track called "Suomi" — says nothing next to a label that already reads
  // "Finnish".
  const named = Boolean(entry.name) && !sameish(entry.name, base) && !isLanguageName(entry.name, code);
  if (named) extras.push(shorten(entry.name));
  // The flag is spelled out only when the name does not already spell it —
  // whether the name stands as the label's own base or beside it.
  // "Commentary · commentary" tells the viewer nothing twice.
  const spelled = Boolean(entry.name) && (named || sameish(entry.name, base));
  if (entry.commentary && !(spelled && COMMENTARY.test(entry.name))) extras.push(t('audio.commentary'));
  if (entry.described && !(spelled && DESCRIBED.test(entry.name))) extras.push(t('audio.described'));
  const tech = [entry.codec ? entry.codec.toUpperCase() : null, layout(entry.channels)].filter(Boolean).join(' ');
  if (tech) extras.push(tech);
  return extras.length ? `${base} · ${extras.join(' · ')}` : base;
}

// An untouched track before a decoded one; then the track the file itself
// points at. Within a class the file's own order decides, which sort()
// keeps because it is stable.
const weight = (entry) => (entry.route === 'passthrough' ? 0 : 1);

const rank = (list) => [...list]
  .sort((a, b) => weight(a) - weight(b) || Number(Boolean(b.default)) - Number(Boolean(a.default)))[0];

/**
 * The track the choice lands on, or null when none of them plays.
 *
 * @param {object[]} list describe()d tracks in the file's own order
 * @param {string|null} language the viewer's remembered language, or
 *        'auto'/null for the automatic choice
 */
export function preferred(list, language) {
  const playable = list.filter((entry) => entry.route);
  if (!playable.length) return null;
  // A commentary or an audio description answers no language choice: it is
  // taken only when it is asked for by language, or when it is all the
  // file has.
  const main = playable.filter((entry) => !entry.commentary && !entry.described);
  const pool = main.length ? main : playable;
  const wanted = language && language !== 'auto' && language !== 'off' ? shortLanguage(language) : null;
  if (wanted) {
    const matches = playable.filter((entry) => shortLanguage(entry.language) === wanted);
    const spoken = matches.filter((entry) => !entry.commentary && !entry.described);
    if (spoken.length) return rank(spoken);
    if (matches.length) return rank(matches);
  }
  return rank(pool);
}
