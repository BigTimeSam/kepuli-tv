// A clock for the visual check, and for nothing else.
//
// dev/visualcheck.mjs compares the store views with reference pictures, and
// the programme guide only looks the same twice if "now" is the same: which
// programme is on, where the grid is scrolled, what the guide's clock says.
// Chrome does not run the DevTools protocol's injected scripts in an
// extension's own pages, so the page sets its clock itself: opened as
// player.html?testnow=<ms since 1970>, Date starts at that moment and runs on
// at its own pace from there, so timers, playback and progress still move.
//
// Without the parameter this does nothing. The extension's pages cannot be
// opened by a web page (none is web-accessible), so the parameter can only
// come from someone at the browser's own controls. Imported first by app.js,
// before any module asks the time.

const at = Number(new URLSearchParams(location.search).get('testnow'));
if (at > 0) {
  const Real = Date;
  const shift = at - Real.now();
  const now = () => Real.now() + shift;
  globalThis.Date = new Proxy(Real, {
    construct: (target, args) => (args.length ? new target(...args) : new target(now())),
    apply: () => new Real(now()).toString(),
    get: (target, key) => (key === 'now' ? now : Reflect.get(target, key)),
  });
}
