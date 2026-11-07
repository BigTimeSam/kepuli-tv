// A scroll bar that stays in sight beside the player's details.
//
// Firefox draws overlay scroll bars on Android and, by the system's
// default, on macOS: they show while a box is scrolled and fade away
// after. A list or a dialog shows that it goes on by its rows cut at the
// edge, but the details under the player (a film's facts, a programme's
// description, the guide's next programmes) end on a line of text and
// look finished when they are not: on a tablet nothing hinted that a
// series' plot went on. No CSS keeps an overlay bar in sight, so a thin
// bar of our own is drawn over the right edge of those boxes when they
// hold more than they show, and only there: bars kept on every list and
// dialog were clutter. Chrome's bars are styled in css/player.css, and
// where the browser's own bar takes room nothing is drawn, so two bars
// never show.
//
// The bars are an indicator only: pointer-events none, the box scrolls
// as it always did. They live in a layer of their own rather than inside
// the boxes, whose contents are replaced wholesale.

/** The boxes beside the player that keep a bar in sight. */
export const SCROLLERS = '.infostrip, .epgv-desc, .epgv-next';

const MIN_THUMB = 24;
const EDGE = 2;         // the bar's gap from the box's right edge, in px

/** @type {HTMLElement | null} */
let layer = null;
/** @type {Map<Element, HTMLElement>} the bar drawn for each box */
const bars = new Map();
let pending = 0;
// A box's own size changes (the window, a pane dragged) are seen here;
// attribute changes are not watched for style, which the progress bars
// rewrite many times a second during playback.
const sized = new ResizeObserver(() => refreshScrollHints());
const watched = new WeakSet();

/** Whether the browser's own bar takes room in the box, and so stays in sight. */
function classicBar(box) {
  const style = getComputedStyle(box);
  const borders = parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
  return box.offsetWidth - box.clientWidth - borders > 1;
}

function draw(box) {
  const overflow = box.scrollHeight - box.clientHeight;
  const shown = box.isConnected && box.clientHeight > 0 && overflow > 1
    && /(auto|scroll)/.test(getComputedStyle(box).overflowY) && !classicBar(box);
  let bar = bars.get(box);
  if (!shown) { if (bar) { bar.remove(); bars.delete(box); } return; }
  if (!layer?.isConnected) {
    layer = document.createElement('div');
    layer.className = 'scrollhint-layer';
    layer.setAttribute('aria-hidden', 'true');
    document.body.append(layer);
  }
  if (!bar || bar.parentElement !== layer) {
    bar?.remove();
    bar = document.createElement('div');
    bar.className = 'scrollhint';
    layer.append(bar);
    bars.set(box, bar);
  }
  // The box's own top and height: the bar runs the length of what shows.
  const rect = box.getBoundingClientRect();
  const track = box.clientHeight;
  const length = Math.max(MIN_THUMB, (track * track) / box.scrollHeight);
  const top = rect.top + box.clientTop + (box.scrollTop / overflow) * (track - length);
  bar.hidden = rect.width < 8;
  bar.style.left = `${Math.round(rect.right - box.clientLeft - EDGE - 4)}px`;
  bar.style.top = `${Math.round(top)}px`;
  bar.style.height = `${Math.round(length)}px`;
}

function update() {
  pending = 0;
  const boxes = new Set(document.querySelectorAll(SCROLLERS));
  for (const box of bars.keys()) if (!boxes.has(box)) { bars.get(box).remove(); bars.delete(box); }
  for (const box of boxes) {
    if (!watched.has(box)) { watched.add(box); sized.observe(box); }
    draw(box);
  }
}

/** Asks for the bars to be drawn again in the next frame, once however often asked. */
export function refreshScrollHints() {
  if (!pending) pending = requestAnimationFrame(update);
}

export function wireScrollHints() {
  // A scroll anywhere (scroll events do not bubble, but they are seen on
  // the way down), the window's size, and any change to the page's
  // content: a description filled in, the guide's panel replaced.
  document.addEventListener('scroll', refreshScrollHints, { capture: true, passive: true });
  addEventListener('resize', refreshScrollHints, { passive: true });
  // The layers' own changes are left out, or drawing a bar would ask for
  // another drawing, frame after frame.
  new MutationObserver((records) => {
    if (records.some((r) => !(r.target instanceof Element && r.target.closest('.scrollhint-layer')))) refreshScrollHints();
  }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'open', 'class'] });
  refreshScrollHints();
}
