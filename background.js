// Clicking the icon opens the player in a tab of its own (or brings an
// existing one to the front).
//
// Our own tab is found with runtime.getContexts() rather than
// tabs.query({ url }): the latter would need the "tabs" permission, which
// would have to be justified separately in Chrome Web Store review.
// getContexts sees only the extension's own pages and needs no permission
// at all. Requires Chrome 116+ (minimum_chrome_version in the manifest) or
// Firefox 127+ (strict_min_version in firefox/manifest.json).
//
// The same line as js/browser.js: this file is not a module and cannot
// import it. Firefox's promises live on browser, Chrome's on chrome.
const api = globalThis.browser ?? globalThis.chrome;
const PLAYER_URL = api.runtime.getURL('player.html');

api.action.onClicked.addListener(async () => {
  const [open] = await api.runtime.getContexts({
    contextTypes: ['TAB'],
    documentUrls: [PLAYER_URL],
  });
  if (open) {
    await api.tabs.update(open.tabId, { active: true });
    await api.windows.update(open.windowId, { focused: true });
  } else {
    await api.tabs.create({ url: PLAYER_URL });
  }
});
