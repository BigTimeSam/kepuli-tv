// The extension API namespace.
//
// Chrome knows chrome; Firefox knows both chrome and browser, but only
// browser returns promises there — `await chrome.storage.local.get(key)`
// would come back undefined, and the settings would simply vanish without
// a word. The alias settles both, and it is the one line that makes the
// player run in either browser.
//
// Extension APIs are used in three files only: config.js, permissions.js
// and background.js. The last is not a module and carries the same line
// itself. Everything else — the player, the lists, the guide, the cache,
// the unpacking — is ordinary web code that knows nothing about extension
// APIs, which is why the Firefox package (firefox/) is the same files with
// a manifest of its own.
export const api = globalThis.browser ?? globalThis.chrome;
