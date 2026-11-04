// The globals player.html loads with a classic <script> before the
// modules run, declared for TypeScript's checker (dev/typecheck.mjs).
// Nothing in the browser reads this file: js/playback.js names it only in a
// triple-slash comment, and it sits in dev/ so that it is not packaged.
//
// The libraries are vendored builds without type declarations of their
// own, and the player uses only a few of their members, so they are `any`:
// a declaration written here by hand would be a guess at hls.js's and
// mpegts.js's interfaces that nothing checks against the real thing.

declare const Hls: any;
declare const mpegts: any;
