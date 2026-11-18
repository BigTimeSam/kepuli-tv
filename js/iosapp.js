// @ts-check
// What the page does in the app for the iPhone and the iPad (ios/), beyond
// what is a branch on `ios` in the module concerned (js/wakelock.js,
// js/sync.js, js/external.js, js/remindersui.js, js/recordingsui.js,
// js/playercontrols.js, js/help.js, js/app.js) and the `.ios` rules of
// css/last.css: the page's class, the keyboard and what it leaves in
// sight, a press on a dialog's button while a field has the keyboard up,
// the dialogs' backdrop told to the app for the strips around the web
// view, and the two pure rules the app's reminders and its sound behind
// another app rest on. ios/MEASURED.md has the measurements behind each.
//
// Imported by js/app.js for what it does when loaded; nothing here runs
// outside the app.

import { ios } from './platform.js';
import { send } from './host.js';

/**
 * The reminders still ahead, as the app schedules them: each a
 * notification `ahead` of its programme's start, named by the reminder's
 * key. One whose moment has passed is left out: the page's list still
 * holds a reminder that fell due while the app was closed, and the app
 * cannot schedule into the past.
 * @template {{ start: number, channel: object }} R
 * @param {[string, R][]} entries the reminders by key
 * @param {number} ahead milliseconds before the start
 * @param {number} now
 * @param {(reminder: R) => string} say the notification's sentence
 */
export function reminderItems(entries, ahead, now, say) {
  return entries.filter(([, r]) => r.start - ahead > now)
    .map(([id, r]) => ({ id, at: r.start - ahead, text: say(r), channel: r.channel }));
}

/**
 * Whether a pause of the picture was WebKit's, for the app leaving the
 * front, and not the viewer's. WebKit pauses every picture nobody sees
 * and says nothing of why; measured on iOS 26.5 the pause came 0.4 s
 * before the page was told it is hidden, so either order within a second
 * and a half counts. A press or a key in the half second before the pause
 * makes it the viewer's own: a finger on Pause, or on a link that took the
 * viewer to another app (Open in VLC), after which nothing should sound.
 * @param {number} pausedAt when the picture paused (ms, one clock for all three)
 * @param {number} hiddenAt when the page was last hidden
 * @param {number} touchedAt when a press or a key last ended
 */
export function pausedByLeaving(pausedAt, hiddenAt, touchedAt) {
  return Math.abs(hiddenAt - pausedAt) < 1500 && !(touchedAt <= pausedAt && pausedAt - touchedAt < 500);
}

if (ios) {
  // The stylesheets hide under .ios what the app cannot answer or does not
  // offer (css/last.css).
  document.documentElement.classList.add('ios');
  // A field being typed into stays in sight when the window changes under
  // it. WebKit brings a field above the keyboard when it takes the focus,
  // and not when the device is turned with the keyboard up: the field was
  // then behind the keyboard, at 307 px in a window of which 174 showed
  // (measured). Once the window has settled the field is asked into view,
  // and what its own scrolling boxes cannot give the page itself scrolls,
  // as it does at WebKit's bidding while a keyboard is up.
  //
  // An iPhone's window, and a lying iPad's, shrinks to what the keyboard
  // leaves, and a dialog follows it. An upright iPad's keeps its height
  // with the keyboard over its lower third: a dialog stayed centred in
  // the whole window, its Connect and Cancel under the keys (innerHeight
  // 1128, 811 of it in sight; measured). There the page is told what is
  // in sight (html.kb, --vvh and --vvt), and a dialog keeps to that
  // (css/dialogs.css). At once, before the settled look below. Not while
  // the page is enlarged by two fingers, which shrinks the same measure.
  // An iPhone's window does either (measured: innerHeight 778 with 436
  // in sight, and 456 once WebKit had scrolled the page to a field), so
  // a keyboard is also what is in sight being less than it has been at
  // this width.
  const viewport = window.visualViewport, root = document.documentElement;
  /** @type {Map<number, number>} */
  const whole = new Map();
  const keyboard = () => {
    if (!viewport) return;
    const width = Math.round(viewport.width), kept = innerHeight - viewport.height > 120;
    whole.set(width, Math.max(whole.get(width) || 0, viewport.height));
    const up = viewport.scale < 1.01 && (kept || (whole.get(width) || 0) - viewport.height > 120);
    root.classList.toggle('kb', up);
    // With the height for it, a dialog's buttons stay in sight (css/dialogs.css).
    root.classList.toggle('kb-tall', up && viewport.height >= 300);
    const say = (/** @type {string} */ name, /** @type {number} */ value) => {
      if (up) root.style.setProperty(name, `${Math.round(value)}px`); else root.style.removeProperty(name);
    };
    say('--vvh', viewport.height);
    say('--vvt', kept ? viewport.offsetTop : 0);
  };
  keyboard();
  viewport?.addEventListener('scroll', keyboard);
  // The page itself never scrolls (css/player.css); WebKit scrolls it to
  // a field under the keyboard. Scrolled past a field at the window's top
  // (the search, while the guide was open on a phone lying down), it left
  // the field being typed into out of sight above it.
  //
  // A field of a dialog is another matter. On an iPhone (17 Pro Max, iOS
  // 26.7.3, the account's form in Settings, the provider's name tapped)
  // WebKit scrolled the page by 354 px to the field, the dialog went up
  // with the page, and what was in sight was its Cancel and Save at the
  // top of the screen over an empty backdrop: the field was cut off by the
  // dialog's own edge, and nothing typed could be seen. A dialog stands in
  // what the keyboard leaves (css/dialogs.css) and scrolls inside itself,
  // so the page is put back and the field brought into sight by the
  // dialog's own boxes; measured on that phone, the field then stood at
  // 220 px of the 480 in sight and stayed. Should those boxes not reach
  // it, the scroll WebKit makes next is left alone.
  let brought = 0;
  addEventListener('scroll', () => {
    const field = document.activeElement;
    if (scrollY <= 0 || !(field instanceof HTMLElement) || !field.matches('input, textarea, select')) return;
    if (field.closest('dialog[open]')) {
      if (performance.now() - brought < 400) return;
      brought = performance.now();
      scrollTo(0, 0);
      field.scrollIntoView({ block: 'center' });
      return;
    }
    if (!field.matches('select') && field.getBoundingClientRect().top < 0) scrollTo(0, 0);
  }, { passive: true });
  let settled = 0;
  viewport?.addEventListener('resize', () => {
    keyboard();
    clearTimeout(settled);
    settled = window.setTimeout(() => {
      const field = document.activeElement, room = window.visualViewport?.height || innerHeight;
      if (!(field instanceof HTMLElement) || !field.matches('input, textarea, select')) return;
      const hidden = () => { const box = field.getBoundingClientRect(); return box.top < 0 || box.bottom > room ? box.top - Math.max(8, (room - box.height) / 2) : 0; };
      if (hidden()) field.scrollIntoView({ block: 'center' });
      if (hidden() && !field.closest('dialog[open]')) window.scrollBy(0, hidden());
    }, 300);
  });
  // A press on a dialog's button while one of its fields has the keyboard
  // up. WebKit moves the focus from the field to the dialog as the finger
  // lifts, the keyboard goes, the window grows and the dialog moves with
  // it, and the click that should follow is never made: Connect, the
  // first button anyone presses, only closed the keyboard (seen with real
  // touches: pointerup on the button, focusout 2 ms later, no click). So
  // a finger lifted where it came down on something to press is that
  // press, made here; the field keeps the focus and the keyboard stays,
  // as under the password's eye it should.
  /** @type {{ target: EventTarget | null, x: number, y: number } | null} */
  let down = null;
  document.addEventListener('touchstart', (event) => {
    const touch = event.touches.length === 1 ? event.touches[0] : null;
    down = touch && { target: event.target, x: touch.clientX, y: touch.clientY };
  }, { capture: true, passive: true });
  document.addEventListener('touchend', (event) => {
    const began = down, touch = event.changedTouches[0], field = document.activeElement;
    down = null;
    if (!began || began.target !== event.target || !event.cancelable || Math.hypot(touch.clientX - began.x, touch.clientY - began.y) > 10) return;
    if (!(field instanceof HTMLElement) || !field.matches('input:not([type="radio"], [type="checkbox"], [type="range"], [type="file"]), textarea')) return;
    // Another field, or a picker, takes the focus as ever; a choice or a
    // switch is pressed by its label or by itself.
    const CHOICE = 'input[type="radio"], input[type="checkbox"]';
    const hit = event.target instanceof Element ? event.target.closest('button, a[href], summary, label, input, select, textarea') : null;
    const pressed = hit?.matches(`button, a[href], summary, ${CHOICE}`) || (hit?.matches('label') && hit.querySelector(CHOICE)) ? hit : null;
    if (!(pressed instanceof HTMLElement) || !pressed.closest('dialog[open]')) return;
    event.preventDefault();
    pressed.click();
  }, { capture: true, passive: false });
  // A modal dialog dims the page behind it, and the strips around the web
  // view (the status bar's, the home indicator's) are the app's to dim:
  // it is told the backdrop's colour while a dialog is open, and null with
  // none. One watch for every dialog, and for the theme, which changes
  // the colour. A dialog opened over another (Filter countries over
  // Settings) lays its backdrop over the first one's.
  // `open` says the dialog itself: under one the page's message strip is
  // dimmed and cannot be pressed, so a reminder that falls due then is the
  // app's to show, as a banner; it was lost in the strip.
  let shade = '0 null';
  new MutationObserver(() => {
    const dialogs = document.querySelectorAll('dialog:modal');
    const rgba = dialogs.length ? (getComputedStyle(dialogs[0], '::backdrop').backgroundColor.match(/[\d.]+/g) || []).map(Number) : null;
    // Opaque when the colour names three numbers.
    if (rgba && rgba.length === 3) rgba.push(1);
    if (rgba && rgba.length === 4) rgba[3] = 1 - (1 - rgba[3]) ** dialogs.length;
    if (`${dialogs.length} ${rgba}` === shade) return;
    shade = `${dialogs.length} ${rgba}`;
    send('screen.shade', { rgba: rgba && rgba.length === 4 ? rgba : null, open: dialogs.length > 0 });
  }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['open', 'data-theme'] });
}
