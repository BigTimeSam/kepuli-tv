// A small menu of actions for one row: a channel made a favourite or not,
// or hidden.
//
// It opens from the ⋯ on the row, from a right click on the row, and from
// the keyboard on the row the list stands on (the context-menu key or
// Shift+F10), so that every action has a way in for the mouse, the touch
// screen and the keys alike. It is a popover in the top layer, placed
// beside what opened it, and closes on a choice, Escape, Tab, a press
// outside it or a scroll.

let open = null;   // { pop, opener, onClose }

/**
 * @param {{ x: number, y: number } | Element} at a point, or the element to sit beside
 * @param {{ label: string, onClick: () => void, danger?: boolean, checked?: boolean, separator?: boolean }[]} items
 *        checked marks the one chosen of several (the account in use);
 *        separator draws a line above the item.
 * @param {{ label?: string, returnFocus?: Element }} [options]
 */
export function openRowMenu(at, items, { label = '', returnFocus = null } = {}) {
  closeRowMenu();
  const pop = document.createElement('div');
  pop.className = 'row-menu';
  pop.setAttribute('popover', 'manual');
  pop.setAttribute('role', 'menu');
  if (label) pop.setAttribute('aria-label', label);
  for (const item of items) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'popitem' + (item.danger ? ' danger' : '');
    button.setAttribute('role', item.checked === undefined ? 'menuitem' : 'menuitemradio');
    if (item.checked !== undefined) {
      button.setAttribute('aria-checked', String(item.checked));
      button.classList.add('radio');
    }
    if (item.separator) button.classList.add('separated');
    button.tabIndex = -1;
    button.textContent = item.label;
    button.addEventListener('click', () => { closeRowMenu({ focus: true }); item.onClick(); });
    pop.append(button);
  }
  pop.addEventListener('keydown', onKey);
  document.body.append(pop);
  open = { pop, returnFocus };
  pop.showPopover();
  place(pop, at);
  pop.querySelector('button')?.focus();
  addEventListener('pointerdown', onOutside, true);
  addEventListener('scroll', onScroll, true);
  addEventListener('resize', onResize);
}

export function closeRowMenu({ focus = false } = {}) {
  if (!open) return;
  const { pop, returnFocus } = open;
  open = null;
  removeEventListener('pointerdown', onOutside, true);
  removeEventListener('scroll', onScroll, true);
  removeEventListener('resize', onResize);
  if (pop.matches(':popover-open')) pop.hidePopover();
  pop.remove();
  if (focus && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
}

export const rowMenuOpen = () => Boolean(open);

function place(pop, at) {
  const margin = 8;
  const box = pop.getBoundingClientRect();
  let x, y;
  if (at instanceof Element) {
    const r = at.getBoundingClientRect();
    x = r.right - box.width;
    y = r.bottom + 4;
    if (y + box.height > innerHeight - margin) y = r.top - box.height - 4;
  } else {
    ({ x, y } = at);
    if (y + box.height > innerHeight - margin) y -= box.height;
  }
  pop.style.left = `${Math.round(Math.min(Math.max(margin, x), innerWidth - box.width - margin))}px`;
  pop.style.top = `${Math.round(Math.min(Math.max(margin, y), innerHeight - box.height - margin))}px`;
}

function onOutside(e) { if (open && !open.pop.contains(e.target)) closeRowMenu(); }
function onScroll(e) { if (open && !open.pop.contains(e.target)) closeRowMenu(); }
function onResize() { closeRowMenu(); }

function onKey(e) {
  // The keys are the menu's while it is open: the list underneath must not
  // move, and Escape closes the menu rather than whatever lies beneath it.
  e.stopPropagation();
  const buttons = [...open.pop.querySelectorAll('button')];
  const at = buttons.indexOf(document.activeElement);
  const go = (i) => { e.preventDefault(); buttons[(i + buttons.length) % buttons.length].focus(); };
  if (e.key === 'ArrowDown') go(at + 1);
  else if (e.key === 'ArrowUp') go(at - 1);
  else if (e.key === 'Home') go(0);
  else if (e.key === 'End') go(buttons.length - 1);
  else if (e.key === 'Escape') { e.preventDefault(); closeRowMenu({ focus: true }); }
  else if (e.key === 'Tab') { e.preventDefault(); closeRowMenu({ focus: true }); }
}
