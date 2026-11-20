// @ts-check
// Where nothing hovers, nothing is styled as hovered.
//
// A finger has no hover, yet a tap leaves `:hover` on what it touched
// until something else is touched (WebKit on an iPhone and an iPad, and
// the Android browsers alike). Every hover style then reads as a state:
// a favourite's star stayed white, the cross of a start page card stayed
// red and the next card's turned red as it slid into the removed one's
// place, a fold's heading stayed grey after it was closed, a cover stayed
// lifted (all seen on the owner's iPad). Some eighty rules say `:hover`,
// and a new one would bring the fault back, so the selectors themselves
// are rewritten once the stylesheets are in: `:hover` becomes `:not(*)`,
// which matches nothing. A selector listed beside it (`.row-star,
// .row-star:hover`, `:is(:hover, :focus-visible)`) keeps its meaning.
//
// The primary pointer decides, when the page loads: a laptop with a touch
// screen keeps its hover, and so does an iPad that has a trackpad then.

/**
 * `:hover` taken out of every rule of the sheets, nested ones included.
 * @param {Iterable<CSSStyleSheet | CSSGroupingRule>} sheets
 * @returns {number} how many selectors were rewritten
 */
export function dropHover(sheets) {
  let count = 0;
  for (const sheet of sheets) {
    /** @type {CSSRuleList | null} */
    let rules = null;
    // A sheet of another origin does not show its rules; the page has none.
    try { rules = sheet.cssRules; } catch { /* not ours to read */ }
    for (const rule of rules || []) {
      if (rule instanceof CSSStyleRule && rule.selectorText.includes(':hover')) {
        const selector = rule.selectorText.replaceAll(':hover', ':not(*)');
        rule.selectorText = selector;
        // A selector the engine will not take back (a scrollbar's part)
        // is left as it was: nothing hovers a scrollbar under a finger.
        if (rule.selectorText.includes(':not(*)')) count += 1;
      }
      // An at-rule's own rules, and a style rule's nested ones.
      if ('cssRules' in rule) count += dropHover([/** @type {CSSGroupingRule} */ (rule)]);
    }
  }
  return count;
}

if (typeof document !== 'undefined' && matchMedia('(hover: none)').matches) {
  const run = () => dropHover(document.styleSheets);
  // The module runs once the page is parsed; a stylesheet still on its
  // way is done when everything has loaded.
  run();
  if (document.readyState !== 'complete') addEventListener('load', run, { once: true });
}
