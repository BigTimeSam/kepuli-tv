// A scroll bar that stays in sight wherever there is more to scroll to.
//
// Firefox draws overlay scroll bars on Android and, by the system's
// default, on macOS: they show while a box is scrolled and fade away
// after, so a description longer than its box, a list, a dialog's panel
// look finished when they are not. On a tablet nothing hinted that a
// series' plot went on. No CSS keeps an overlay bar in sight, so a thin
// bar of our own is drawn over the right edge of every box that holds
// more than it shows, where the browser's own bar does not already take
// room. Chrome's bars are styled in css/player.css and so are classic
// ones that stay: there nothing is drawn, and two bars never show.
//
// The bars are an indicator only: pointer-events none, the box scrolls
// as it always did. They live in a layer of their own rather than inside
// the boxes, whose contents are replaced wholesale (the list's rows, the
// details strip), and that layer sits in the box's dialog or popover when
// it has one, as anything outside the top layer is drawn beneath it.
//
// The boxes are named here, as the stylesheet names them: walking every
// element for its computed overflow on each change would cost a frame
// while the list scrolls. The scrollbars scenario fails on a box that
// scrolls and is not named, so a new one cannot be forgotten quietly.

/** Every box in the stylesheet that scrolls vertically. */
export const SCROLLERS = [
  '.list', '.groups-list', '.subcats', '.detail-plot', '.infostrip', '.overlay',
  '.epgv-next', '.epgv-desc', '.epg-scroll', '.programme-results',
  '.setup-panel', '.help-content', '.choice-list', '.picker-list', 'dialog[open]',
].join(', ');

const MIN_THUMB = 24;
const EDGE = 2;         // the bar's gap from the box's right edge, in px

/** @type {Map<Element, HTMLElement>} the layer for each host: the body, a dialog or a popover */
const layers = new Map();
/** @type {Map<Element, HTMLElement>} the bar drawn for each box */
const bars = new Map();
let pending = 0;
// A box's own size changes (the window, a pane dragged, the chips' height
// set by hand) are seen here; attribute changes are not watched for style,
// which the progress bars rewrite many times a second during playback.
const sized = new ResizeObserver(() => refreshScrollHints());
const watched = new WeakSet();

function layerFor(host) {
  let layer = layers.get(host);
  if (!layer || !layer.isConnected) {
    layer = document.createElement('div');
    layer.className = 'scrollhint-layer';
    layer.setAttribute('aria-hidden', 'true');
    host.append(layer);
    layers.set(host, layer);
  }
  return layer;
}

/** Whether the browser's own bar takes room in the box, and so stays in sight. */
function classicBar(box) {
  const style = getComputedStyle(box);
  const borders = parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
  return box.offsetWidth - box.clientWidth - borders > 1;
}

/**
 * Where a box can be seen: its own rectangle cut by the boxes it scrolls
 * inside, so that a bar never hangs past what the viewer sees of the box.
 */
function visibleRect(box) {
  let { left, top, right, bottom } = box.getBoundingClientRect();
  for (let outer = box.parentElement?.closest(SCROLLERS); outer; outer = outer.parentElement?.closest(SCROLLERS)) {
    const r = outer.getBoundingClientRect();
    left = Math.max(left, r.left); top = Math.max(top, r.top);
    right = Math.min(right, r.right); bottom = Math.min(bottom, r.bottom);
  }
  return { left, top, right, bottom };
}

function draw(box) {
  const overflow = box.scrollHeight - box.clientHeight;
  const shown = box.isConnected && box.clientHeight > 0 && overflow > 1
    && /(auto|scroll)/.test(getComputedStyle(box).overflowY) && !classicBar(box);
  let bar = bars.get(box);
  if (!shown) { if (bar) { bar.remove(); bars.delete(box); } return; }
  const host = box.closest('dialog[open], :popover-open') || document.body;
  const layer = layerFor(host === box ? box : host);
  if (!bar || bar.parentElement !== layer) {
    bar?.remove();
    bar = document.createElement('div');
    bar.className = 'scrollhint';
    layer.append(bar);
    bars.set(box, bar);
  }
  // The box's own top and height: the bar runs the length of what shows.
  const rect = box.getBoundingClientRect();
  const view = visibleRect(box);
  const origin = layer.getBoundingClientRect();
  const track = box.clientHeight;
  const length = Math.max(MIN_THUMB, (track * track) / box.scrollHeight);
  const at = rect.top + box.clientTop + (box.scrollTop / overflow) * (track - length);
  const top = Math.max(at, view.top);
  const bottom = Math.min(at + length, view.bottom);
  if (bottom - top < 4 || view.right - view.left < 8) { bar.hidden = true; return; }
  bar.hidden = false;
  bar.style.left = `${Math.round(rect.right - box.clientLeft - EDGE - 4 - origin.left)}px`;
  bar.style.top = `${Math.round(top - origin.top)}px`;
  bar.style.height = `${Math.round(bottom - top)}px`;
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
  // content: a description filled in, a dialog opened, rows replaced.
  document.addEventListener('scroll', refreshScrollHints, { capture: true, passive: true });
  addEventListener('resize', refreshScrollHints, { passive: true });
  // The layers' own changes are left out, or drawing a bar would ask for
  // another drawing, frame after frame.
  new MutationObserver((records) => {
    if (records.some((r) => !(r.target instanceof Element && r.target.closest('.scrollhint-layer')))) refreshScrollHints();
  }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'open', 'class'] });
  document.addEventListener('toggle', refreshScrollHints, { capture: true });
  refreshScrollHints();
}
