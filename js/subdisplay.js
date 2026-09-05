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
// approximated in ::cue as far as ::cue goes.
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

// The text size in CSS pixels, from a slider, and the same in a window and
// in full screen: the viewer sets what reads well on their screen, and a
// larger picture does not turn it into a larger text. The three named
// sizes of the older settings are taken at what they measured in a window.
export const MIN_SIZE = 12;
export const MAX_SIZE = 72;
export const DEFAULT_SIZE = 24;
const NAMED_SIZE = { small: 18, medium: 24, large: 34 };

/** The look from the settings, with anything unknown replaced by the default. */
export function subtitleLook(settings) {
  const s = settings || {};
  const raw = NAMED_SIZE[s.subtitleSize] ?? Number(s.subtitleSize);
  const size = Number.isFinite(raw) && raw > 0 ? Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(raw))) : DEFAULT_SIZE;
  return { style: STYLES.includes(s.subtitleStyle) ? s.subtitleStyle : DEFAULT_STYLE, size };
}

// How long the controls stay on show after the pointer stops, and how far
// from the bottom edge the pointer counts as resting on the controls.
const CONTROLS_LINGER_MS = 3000;
const CONTROLS_BAND_PX = 72;

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
    // size (the --sub-size property in the body's style) or a new look —
    // padding and all — means fitting them again.
    new ResizeObserver(() => this.repaint()).observe(wrap);
    new MutationObserver(() => this.repaint())
      .observe(document.body, { attributes: true, attributeFilter: ['data-substyle', 'style'] });

    wrap.addEventListener('pointermove', (e) => { this.pointerY = e.clientY; this.wake(); });
    wrap.addEventListener('pointerleave', () => { this.pointerY = null; this.rest(); });
    video.addEventListener('pause', () => this.wake());
    video.addEventListener('play', () => this.wake());
    video.addEventListener('ended', () => this.wake());
    this.mode();
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
    this.repaint();
  }

  repaint() {
    this.key = null;
    this.paint();
  }

  /** The active cues of every showing track, as boxes in the layer. */
  paint() {
    if (document.body.dataset.subrender === 'native') { this.layer.replaceChildren(); return; }
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
