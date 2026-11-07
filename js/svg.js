// @ts-check
// An icon as an element, from SVG markup written in the source. The icons
// were once set with innerHTML, which the add-on linter AMO's reviewers read
// flags whenever the markup is not a bare literal; parsing it as SVG here,
// in one place, keeps them literal at every call and keeps the HTML parser
// out of it. dev/htmlcheck.mjs reads every call: the markup may come only
// from literals and the icon constants it trusts.

// Made at the first icon, not on import: the unit tests load modules that
// import this one in Node, which has no DOMParser.
/** @type {DOMParser|undefined} */
let parser;

/**
 * @param {string} inner the shapes inside the <svg>
 * @param {string} [viewBox]
 * @returns {SVGSVGElement}
 */
export function svg(inner, viewBox = '0 0 20 20') {
  const doc = (parser ??= new DOMParser()).parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" aria-hidden="true" focusable="false">${inner}</svg>`,
    'image/svg+xml');
  // documentElement is typed HTMLElement, but an image/svg+xml document's
  // root is the <svg> written above.
  return /** @type {SVGSVGElement} */ (/** @type {unknown} */ (document.importNode(doc.documentElement, true)));
}
