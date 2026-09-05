// Subtitle tracks from MKV to the <video> element.
//
// The container demuxer (remux.js) throws the blocks that belong to a
// subtitle track in here. The block's text is dug out, timed and handed to
// the browser as a VTTCue on a TextTrack of the video element. The browser
// keeps the time — it fires cuechange as the cues come and go — and offers
// the tracks in its own subtitle menu; the drawing is the app's, see
// subdisplay.js.
//
// The cues of every text track are collected in one pass, even though only
// one is visible at a time. The alternative would be reading the file again
// when the track changes, which would cost the single allowed connection
// and interrupt the picture. Text is light: a 45-minute episode has a few
// hundred cues per track.
//
// Bitmap subtitles (PGS, VOBSUB) are left out: they are images, and cannot
// be handed to a VTTCue.

import { shortLanguage } from './probe.js';
import { t, localeTag } from './i18n.js';

const SUBTITLE_TYPE = 17;

// The formats whose payload is text. The value shows in the selector's tooltip.
const FORMAT = {
  'S_TEXT/UTF8': 'SRT', 'S_TEXT/ASS': 'ASS', 'S_TEXT/SSA': 'ASS', 'S_TEXT/WEBVTT': 'VTT',
};

// A block does not always carry a BlockDuration. The duration is guessed,
// and the guess is cut short as soon as the next cue starts — an
// over-long cue left standing would hang around on screen.
const FALLBACK_SECONDS = 4;
const MIN_SECONDS = 0.2;

export const isSubtitle = (track) => track.type === SUBTITLE_TYPE;
export const isTextSubtitle = (track) => isSubtitle(track) && Boolean(FORMAT[track.codecId]);

const DECODER = new TextDecoder();

/**
 * The track the selection lands on, or null. A forced track translates only
 * foreign dialogue, so it does not answer a language choice when a full
 * track is on offer.
 *
 * @param {object[]} entries the list returned by setup()
 * @param {string|null} language 'fi', 'off' or null
 */
export function preferred(entries, language) {
  if (!language || language === 'off') return null;
  const wanted = shortLanguage(language);
  const matches = entries.filter((e) => shortLanguage(e.language) === wanted);
  if (!matches.length) return null;
  const full = matches.filter((e) => !e.forced);
  const pick = full.find((e) => e.default) || full[0] || matches[0];
  return pick.number;
}

/**
 * The video element's subtitle tracks. One instance per playback.
 */
export class SubtitleTracks {
  /**
   * @param {HTMLVideoElement} video
   * @param {(active:number|null) => void} onChange also called when the
   *        viewer changes track from the browser's own menu
   */
  constructor(video, onChange) {
    this.video = video;
    this.onChange = onChange || (() => {});
    this.entries = [];
    this.byNumber = new Map();
    this.active = null;
    this.listener = () => this.report();
    video.textTracks.addEventListener('change', this.listener);
  }

  /**
   * Creates the tracks from the header's TrackEntry elements and returns
   * the description the selector needs.
   *
   * @param {object[]} tracks text-format tracks only
   */
  setup(tracks) {
    const claimed = new Set();
    for (const track of tracks) {
      const language = (track.langBcp || track.lang || 'und').toLowerCase();
      const text = label(track, language);
      // The key ties the track to a reusable TextTrack. The label and the
      // language are read-only, so the same TextTrack fits only when both
      // match — otherwise the browser's menu would show the wrong name.
      let key = `${language}|${text}`;
      for (let n = 2; claimed.has(key); n++) key = `${language}|${text}#${n}`;
      claimed.add(key);
      const entry = {
        number: track.number,
        codecId: track.codecId,
        format: FORMAT[track.codecId],
        language,
        label: text,
        forced: Boolean(track.forced),
        default: track.isDefault !== false,
        track: acquire(this.video, key, text, shortLanguage(language)),
        seen: new Set(),
        open: null,
      };
      entry.track.mode = 'disabled';
      this.entries.push(entry);
      this.byNumber.set(entry.number, entry);
    }
    // The same name twice would tell the viewer only that there are two
    // choices.
    const counts = new Map();
    for (const entry of this.entries) counts.set(entry.label, (counts.get(entry.label) || 0) + 1);
    const running = new Map();
    for (const entry of this.entries) {
      if (counts.get(entry.label) < 2) continue;
      const n = (running.get(entry.label) || 0) + 1;
      running.set(entry.label, n);
      entry.label = `${entry.label} (${n})`;
    }
    // Alphabetical in the selector: the file's own order is arbitrary, and
    // in a list of thirty tracks the right language is found only if its
    // place can be guessed. The internal order (this.entries) stays as in
    // the file, because the numbering of same-named tracks relies on it.
    // The comparison follows the interface language, so that the letters of
    // that language sort where a reader expects them.
    return this.entries
      .map((e) => ({
        number: e.number, language: e.language, label: e.label,
        format: e.format, forced: e.forced, default: e.default,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, localeTag()));
  }

  has(number) { return this.byNumber.has(number); }

  /**
   * One subtitle block. The same block can arrive twice after a seek,
   * because the download resumes from the start of a cluster — a cue that
   * has already been added is recognised and skipped.
   *
   * @param {number} number the track number
   * @param {number} pts start in nanoseconds
   * @param {number|null} duration duration in nanoseconds
   * @param {Uint8Array} data the block payload
   */
  push(number, pts, duration, data) {
    const entry = this.byNumber.get(number);
    if (!entry) return;
    const text = cueText(entry.codecId, data);
    if (!text) return;
    const start = pts / 1e9;
    const key = `${Math.round(start * 1000)}|${text}`;
    if (entry.seen.has(key)) return;
    entry.seen.add(key);

    // The previous guessed duration is cut off here: two cues must not be
    // on screen at once unless the file said so.
    if (entry.open && entry.open.endTime > start && entry.open.startTime < start) {
      entry.open.endTime = start;
    }
    entry.open = null;

    const end = duration ? start + duration / 1e9 : start + FALLBACK_SECONDS;
    try {
      const cue = new VTTCue(start, Math.max(end, start + MIN_SECONDS), text);
      entry.track.addCue(cue);
      if (!duration) entry.open = cue;
    } catch (err) {
      console.warn('[iptv] subtitle cue could not be added', err);
    }
  }

  /** Shows one track and hides the rest. Returns the chosen number. */
  select(number) {
    const wanted = this.byNumber.has(number) ? number : null;
    for (const entry of this.entries) {
      const mode = entry.number === wanted ? 'showing' : 'disabled';
      if (entry.track.mode !== mode) entry.track.mode = mode;
    }
    this.active = wanted;
    return wanted;
  }

  /** A change made from the browser's menu, reported back to the app. */
  report() {
    let active = null;
    for (const entry of this.entries) if (entry.track.mode === 'showing') active = entry.number;
    if (active === this.active) return;
    this.active = active;
    this.onChange(active);
  }

  destroy() {
    this.video.textTracks.removeEventListener('change', this.listener);
    for (const entry of this.entries) clearTrack(entry.track);
    this.entries = [];
    this.byNumber.clear();
    this.active = null;
  }
}

/* ------------------------------------------------------------- raitavarasto */

// addTextTrack adds a track for good: the element offers no interface for
// removing one, and changing src does not reliably take it away either.
// Without reuse the browser's subtitle menu would grow episode by episode.
// The label and the language are read-only, so the key holds both.
const POOL = new WeakMap();

function acquire(video, key, label, language) {
  let pool = POOL.get(video);
  if (!pool) { pool = new Map(); POOL.set(video, pool); }
  const existing = pool.get(key);
  if (existing && attached(video, existing)) {
    clearTrack(existing);
    return existing;
  }
  const track = video.addTextTrack('subtitles', label, language);
  pool.set(key, track);
  return track;
}

function attached(video, track) {
  for (const candidate of video.textTracks) if (candidate === track) return true;
  return false;
}

// cues is null while a track is disabled, so it has to be woken up for the
// removal.
function clearTrack(track) {
  try {
    if (track.mode === 'disabled') track.mode = 'hidden';
    const cues = track.cues;
    if (cues) for (let i = cues.length - 1; i >= 0; i--) track.removeCue(cues[i]);
    track.mode = 'disabled';
  } catch { /* the browser had already torn the track down */ }
}

/* ----------------------------------------------------------------- teksti */

/** The block payload as displayable text, or '' when there is none. */
export function cueText(codecId, data) {
  let raw;
  try { raw = DECODER.decode(data); } catch { return ''; }
  if (codecId === 'S_TEXT/ASS' || codecId === 'S_TEXT/SSA') return fromAss(raw);
  return fromSrt(raw);
}

// In Matroska an ASS line comes without the "Dialogue:" prefix and without
// times: ReadOrder,Layer,Style,Name,MarginL,MarginR,MarginV,Effect,Text
// The text itself may contain commas, so only the first eight separators
// are counted.
function fromAss(raw) {
  let at = 0;
  for (let i = 0; i < 8; i++) {
    const comma = raw.indexOf(',', at);
    if (comma === -1) { at = 0; break; }
    at = comma + 1;
  }
  const body = raw.slice(at);
  // In drawing mode (\p1) the "text" is vector commands that draw, for
  // instance, a subtitle background. Shown as text it would be pure noise.
  if (/\{[^}]*\\p[1-9]/.test(body)) return '';
  const text = body
    .replace(/\{[^}]*\}/g, '')     // tyylikoodit: {\an8}, {\i1}, {\pos(…)}
    .replace(/\\[Nn]/g, '\n')
    .replace(/\\h/g, ' ')
    .replace(/</g, '&lt;');        // to the cue parser a bare < opens a tag
  return clean(text);
}

// WebVTT cue text knows only a few tags. The rest are dropped:
// <font color="…"> would be ignored by the browser's parser, but its
// contents are text that has to show.
const KEEP_TAG = /^<\/?(i|b|u|ruby|rt)>$/i;

// A < that opens no tag — "a < b" in the dialogue — would swallow the rest
// of the line in the cue parser; it goes in as the entity.
const STRAY_LT = /<(?!\/?(?:i|b|u|ruby|rt)>)/gi;

function fromSrt(raw) {
  const text = raw
    .replace(/\r\n?/g, '\n')
    .replace(/\{\\[^}]*\}/g, '')   // ASS style codes stray into SRT tracks too
    .replace(/<[^<>\n]+>/g, (tag) => (KEEP_TAG.test(tag) ? tag : ''))
    .replace(STRAY_LT, '&lt;');
  return clean(text);
}

const clean = (text) => text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

/* ------------------------------------------------------------------ names */

// Rebuilt per tag: the interface language can change mid-session, and a
// language name belongs in the language the viewer reads.
let namesTag = null;
let namesInstance = null;
function displayNames() {
  if (namesTag !== localeTag()) {
    namesTag = localeTag();
    try { namesInstance = new Intl.DisplayNames([namesTag], { type: 'language' }); } catch { namesInstance = null; }
  }
  return namesInstance;
}

function languageName(code) {
  if (!code || code === 'und') return null;
  try {
    const names = displayNames();
    const name = names && names.of(code);
    return name && name !== code ? name : null;
  } catch { return null; }
}

const MAX_NAME = 26;

/** The name shown in the selector: "Finnish", "Finnish · forced",
 *  "Swedish · SDH". */
function label(track, language) {
  const code = shortLanguage(language);
  const name = languageName(code);
  let base = name ? name.charAt(0).toUpperCase() + name.slice(1) : code.toUpperCase();
  if (code === 'und' && !track.name) base = t('subs.unknown');
  const extras = [];
  // A track's own name often says what the language does not: "SDH",
  // "Full", "Songs".
  if (track.name && !sameish(track.name, base)) extras.push(shorten(track.name));
  if (track.forced) extras.push(t('subs.forced'));
  return extras.length ? `${base} · ${extras.join(' · ')}` : base;
}

const sameish = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
const shorten = (text) => {
  const trimmed = text.trim();
  return trimmed.length > MAX_NAME ? `${trimmed.slice(0, MAX_NAME - 1)}…` : trimmed;
};
