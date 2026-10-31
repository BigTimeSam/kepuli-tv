// The subtitle display: the cues of the showing text track, drawn over the
// picture by the app rather than by the browser.
//
// The browser's own drawing was used before this. It falls short in two
// ways. A two-line line of dialogue comes out as two boxes with a gap between
// them, one per line, because the cue's background box is an inline box.
// And ::cue takes only a colour, a font, a shadow and a background — no
// padding, no rounded corners, nothing about the box — so no look the viewer
// might choose could be built on it. The timing stays with the browser: the
// cues are VTTCues on a TextTrack (see subs.js) and the track fires cuechange
// as they come and go. Only the drawing is here — the active cues are laid
// out as HTML in a layer over the video, where all of CSS applies. The
// browser's own drawing is hidden in CSS while the layer is in use, so the
// track stays "showing" and the browser's subtitle menu keeps working.
//
// The layer sits in the video's wrapper, so it goes to full screen only with
// the wrapper. The video's own full-screen button would take the bare video
// and leave the layer behind; the button is therefore removed from the
// controls (controlslist="nofullscreen") and the app's own button, the double
// click and the f key take the wrapper instead. Firefox ignores controlslist:
// when the viewer takes the video itself to full screen there, the browser's
// drawing is switched back on for the duration — with the chosen look
// approximated in ::cue as far as ::cue goes, and the chosen height written
// into the cues themselves (see placeNative), as the browser would otherwise
// keep them at the bottom whatever the setting.
//
// The browser's own drawing also lifted the subtitles above the controls
// while those were on show, and the controls' visibility is not readable
// from outside. The rule is imitated instead: the controls are taken to be
// on show while the video is paused, and for three seconds after the
// pointer last moved over the picture — which is what Chrome and Firefox do.

/** The looks on offer, in the order of the settings menu; player.css draws
 *  them. The default has no box: text with a shadow, as the streaming
 *  services draw it. */
export const STYLES = ['shadow', 'outline', 'yellow', 'box', 'contrast'];
export const DEFAULT_STYLE = 'shadow';

// The text size follows the picture, as television's does: a share of the
// picture's height, the same share in a window and in full screen. It used
// to be pixels, the same in both, and measured on a 1080p screen the 24 px
// default came to 2.2 % of the picture in full screen — half of what the
// browsers' own default (5 %) and the BBC's guidance (a line of some 8 %)
// give, and a footnote rather than a subtitle. 5 % of the picture's height
// is the size at 100 %, the browsers' own; 5.5 % for a while, and that read
// a size too large. The slider runs from half of it to two and a half
// times it. Below 14 px a line stops being readable, whatever the window:
// that is the floor.
export const SIZE_SHARE = 0.05;
export const MIN_PX = 14;
export const MIN_SCALE = 50;
export const MAX_SCALE = 250;
export const SCALE_STEP = 5;
export const DEFAULT_SCALE = 100;
// What the older settings held: pixels (24 the default), and before them three names.
const OLD_DEFAULT_PX = 24;
const NAMED_SIZE = { small: 18, medium: 24, large: 34 };

const clampScale = (n) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(n / SCALE_STEP) * SCALE_STEP));

// How high the lowest line stands: a share of the picture's height above
// the picture's own bottom edge, not the box's. It was 6 % of the box, and
// on a 16:10 screen a 16:9 film has a bar of some 65 px under it — 6 % of
// the box is 59 px, and the subtitles sat in the bar. SMPTE's title-safe
// area, which Netflix points to, keeps text 5 % in from the picture's
// edges; 8 % is inside it with room to spare. The viewer may set 0–30 %.
export const MIN_LIFT = 0;
export const MAX_LIFT = 30;
export const DEFAULT_LIFT = 8;
const clampLift = (n) => Math.min(MAX_LIFT, Math.max(MIN_LIFT, Math.round(n)));

/**
 * The look from the settings, with anything unknown replaced by the default.
 * A size kept in pixels by an older version becomes the same share of the
 * old default: 24 px was 100 %, 36 px is 150 %, so a viewer who had made
 * the text larger still has it larger.
 */
export function subtitleLook(settings) {
  const s = settings || {};
  let scale = Number(s.subtitleScale);
  if (!Number.isFinite(scale) || scale <= 0) {
    const px = NAMED_SIZE[s.subtitleSize] ?? Number(s.subtitleSize);
    scale = Number.isFinite(px) && px > 0 ? px / OLD_DEFAULT_PX * 100 : DEFAULT_SCALE;
  }
  const lift = Number(s.subtitleLift);
  return {
    style: STYLES.includes(s.subtitleStyle) ? s.subtitleStyle : DEFAULT_STYLE,
    scale: clampScale(scale),
    lift: Number.isFinite(lift) && s.subtitleLift !== '' && s.subtitleLift != null ? clampLift(lift) : DEFAULT_LIFT,
  };
}

/** One step larger (+1) or smaller (-1), within the bounds. */
export const stepScale = (scale, direction) => clampScale(scale + direction * 10);

/**
 * The height of the picture inside a box, without the bars: a film is
 * letterboxed on a 16:10 screen, and its subtitles are sized to the film.
 */
export function pictureHeight(width, height, videoWidth, videoHeight) {
  const ratio = videoWidth > 0 && videoHeight > 0 ? videoWidth / videoHeight : 16 / 9;
  return Math.max(0, Math.min(height, width / ratio));
}

// How long the controls stay on show after the pointer stops — Chrome's
// own bar starts to fade after 2.5 s, and the fullscreen button laid over
// it has to go with it — and how far from the bottom edge the pointer
// counts as resting on the controls.
const CONTROLS_LINGER_MS = 2500;
const CONTROLS_BAND_PX = 132;

export class SubtitleDisplay {
  /**
   * @param {HTMLVideoElement} video
   * @param {HTMLElement} layer the element the cues are drawn into, inside the wrapper
   * @param {HTMLElement} wrap the video's wrapper: the layer's parent and what goes to full screen
   */
  constructor(video, layer, wrap) {
    this.video = video;
    this.layer = layer;
    this.wrap = wrap;
    this.bound = new WeakSet();
    this.key = null;
    this.timer = null;
    this.pointerY = null;

    const tracks = video.textTracks;
    for (const track of tracks) this.bind(track);
    tracks.addEventListener('addtrack', (e) => { this.bind(e.track); this.paint(); });
    tracks.addEventListener('removetrack', () => this.paint());
    tracks.addEventListener('change', () => this.paint());
    // A new source: the old tracks' cues are gone with the old one.
    video.addEventListener('emptied', () => this.paint());
    document.addEventListener('fullscreenchange', () => this.mode());
    // The boxes are fitted to their lines in pixels (see fit), so a new
    // size (the --sub-scale property in the body's style, or a picture of
    // another height) or a new look — padding and all — means fitting them
    // again.
    new ResizeObserver(() => { this.measure(); this.repaint(); }).observe(wrap);
    video.addEventListener('resize', () => { this.measure(); this.repaint(); });
    new MutationObserver(() => this.repaint())
      .observe(document.body, { attributes: true, attributeFilter: ['data-substyle', 'style'] });

    wrap.addEventListener('pointermove', (e) => { this.pointerY = e.clientY; this.wake(); });
    wrap.addEventListener('pointerdown', () => this.wake());
    wrap.addEventListener('pointerleave', () => { this.pointerY = null; this.rest(); });
    video.addEventListener('pause', () => this.wake());
    video.addEventListener('play', () => this.wake());
    video.addEventListener('ended', () => this.wake());
    this.measure();
    this.mode();
  }

  /** The picture's height (--pic-h), for the text size to be a share of, and
   *  the bar under it (--pic-bar), for the height to be measured from the
   *  picture rather than from the box. */
  measure() {
    const h = pictureHeight(this.wrap.clientWidth, this.wrap.clientHeight, this.video.videoWidth, this.video.videoHeight);
    if (!(h > 0)) return;
    this.wrap.style.setProperty('--pic-h', `${Math.round(h)}px`);
    this.wrap.style.setProperty('--pic-bar', `${Math.round(Math.max(0, (this.wrap.clientHeight - h) / 2))}px`);
  }

  bind(track) {
    if (!track || this.bound.has(track)) return;
    this.bound.add(track);
    track.addEventListener('cuechange', () => this.paint());
  }

  /** Whether the layer or the browser draws, see the head of the file. */
  mode() {
    const native = document.fullscreenElement === this.video;
    document.body.dataset.subrender = native ? 'native' : 'overlay';
    this.wake();
    this.repaint();
  }

  repaint() {
    this.key = null;
    this.paint();
  }

  /** The active cues of every showing track, as boxes in the layer. */
  paint() {
    if (document.body.dataset.subrender === 'native') { this.layer.replaceChildren(); this.placeNative(); return; }
    const cues = [];
    for (const track of this.video.textTracks) {
      if (track.mode !== 'showing' || !track.activeCues) continue;
      for (const cue of track.activeCues) cues.push(cue);
    }
    // The same cue stays on screen across many cuechange events — a track
    // that gains a cue elsewhere fires one too — and rebuilding it would
    // flicker.
    const key = cues.map((cue) => `${cue.startTime}|${cue.endTime}|${cue.text}`).join(' ');
    if (key === this.key) return;
    this.key = key;
    this.layer.replaceChildren(...cues.map(cueBox));
    for (const box of this.layer.children) fit(box);
  }

  /**
   * The height for the browser's own drawing. A cue's line, as a share of
   * the video element with its bars, set where the layer would put the
   * lowest line: the bar under the picture and the viewer's share of the
   * picture above it. The browser then holds it there, controls or not.
   */
  placeNative() {
    const box = this.video.clientHeight;
    if (!(box > 0)) return;
    const picture = pictureHeight(this.video.clientWidth, box, this.video.videoWidth, this.video.videoHeight);
    const lift = parseFloat(getComputedStyle(document.body).getPropertyValue('--sub-lift'));
    const rest = (box - picture) / 2 + picture * (Number.isFinite(lift) ? lift : DEFAULT_LIFT / 100);
    const line = Math.round(Math.min(100, Math.max(0, 100 - rest / box * 100)) * 10) / 10;
    for (const track of this.video.textTracks) {
      if (track.mode !== 'showing' || !track.cues) continue;
      for (const cue of track.cues) {
        if (cue.line === line && !cue.snapToLines) continue;
        cue.snapToLines = false;
        cue.lineAlign = 'end';
        cue.line = line;
      }
    }
  }

  /* --------------------------------------------------------- controls */

  /** The controls are on show: the subtitles move up out of their way. */
  wake() {
    this.wrap.classList.add('controls');
    clearTimeout(this.timer);
    this.timer = null;
    if (this.video.paused || this.video.ended) return;
    this.timer = setTimeout(() => this.rest(), CONTROLS_LINGER_MS);
  }

  /** The controls have gone — unless the pointer rests on them. */
  rest() {
    clearTimeout(this.timer);
    this.timer = null;
    if (this.video.paused || this.video.ended) return;
    if (this.pointerY != null && this.wrap.getBoundingClientRect().bottom - this.pointerY <= CONTROLS_BAND_PX) {
      this.timer = setTimeout(() => this.rest(), CONTROLS_LINGER_MS);
      return;
    }
    this.wrap.classList.remove('controls');
  }
}

/**
 * A line the box cannot hold is wrapped, in balance, but the box stays as
 * wide as the layer while the lines inside it are shorter — a box look would
 * get wide empty shoulders. The box is fitted to its widest line instead,
 * and left alone if the fit would change the number of lines.
 */
function fit(box) {
  const before = lineRects(box);
  if (before.length < 2) return;
  const style = getComputedStyle(box);
  const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  const widest = Math.max(...before.map((line) => line.right - line.left));
  const width = Math.ceil(widest + padding) + 1;
  if (width >= box.getBoundingClientRect().width - 1) return;
  box.style.width = `${width}px`;
  if (lineRects(box).length !== before.length) box.style.width = '';
}

/** The lines of text in a box, as their extents: one rectangle per line. */
function lineRects(box) {
  const range = document.createRange();
  range.selectNodeContents(box);
  const tolerance = parseFloat(getComputedStyle(box).fontSize) / 2;
  const lines = [];
  for (const rect of [...range.getClientRects()].sort((a, b) => a.top - b.top)) {
    if (!rect.width) continue;
    const last = lines[lines.length - 1];
    if (last && Math.abs(rect.top - last.top) < tolerance) {
      last.left = Math.min(last.left, rect.left);
      last.right = Math.max(last.right, rect.right);
    } else {
      lines.push({ top: rect.top, left: rect.left, right: rect.right });
    }
  }
  return lines;
}

/**
 * One cue as a box. The browser parses the cue text — the <i> and <b> of the
 * file, the line breaks — into a fragment; where it cannot, the plain text
 * goes in as it is.
 */
function cueBox(cue) {
  const box = document.createElement('div');
  box.className = 'cue';
  let content = null;
  try { content = typeof cue.getCueAsHTML === 'function' ? cue.getCueAsHTML() : null; } catch { content = null; }
  box.appendChild(content || document.createTextNode(cue.text || ''));
  return box;
}
