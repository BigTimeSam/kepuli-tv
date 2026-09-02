// Clicking the icon opens the player in a tab of its own (or brings an
// existing one to the front).
//
// Our own tab is found with runtime.getContexts() rather than
// tabs.query({ url }): the latter would need the "tabs" permission, which
// would have to be justified separately in Chrome Web Store review.
// getContexts sees only the extension's own pages and needs no permission
// at all. Requires Chrome 116+ (minimum_chrome_version in the manifest).
const PLAYER_URL = chrome.runtime.getURL('player.html');

chrome.action.onClicked.addListener(async () => {
  const [open] = await chrome.runtime.getContexts({
    contextTypes: ['TAB'],
    documentUrls: [PLAYER_URL],
  });
  if (open) {
    await chrome.tabs.update(open.tabId, { active: true });
    await chrome.windows.update(open.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: PLAYER_URL });
  }
});
