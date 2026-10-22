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

// Every page of ours in a tab, rather than documentUrls: [PLAYER_URL]: the
// player writes the place it is in into its address (js/route.js), so the
// document's URL is player.html#/live/Finland rather than the bare one, and
// a filter that asks for the bare URL finds nothing and opens a second
// player beside the first.
async function playerTab() {
  const contexts = await api.runtime.getContexts({ contextTypes: ['TAB'] });
  return contexts.find((context) => String(context.documentUrl).split('#')[0] === PLAYER_URL) || null;
}

api.action.onClicked.addListener(async () => {
  const open = await playerTab();
  if (open) {
    await api.tabs.update(open.tabId, { active: true });
    await api.windows.update(open.windowId, { focused: true });
  } else {
    await api.tabs.create({ url: PLAYER_URL });
  }
});

// An update the browser has fetched waits while a player tab is open, and
// the tab goes on running the old version without a word: 1.1.1 was
// installed while the tab still drew 1.1.0's menus. With no player open
// the update is taken at once — Firefox would otherwise hold it until the
// browser restarts, because this listener exists. With one open, the
// player is told, and it offers the reload itself (js/app.js).
api.runtime.onUpdateAvailable.addListener(async ({ version }) => {
  if (!(await playerTab())) { api.runtime.reload(); return; }
  await api.storage.local.set({ updateReady: version });
});

// The reload closes every page of the extension, the player among them.
// The player left its address behind before asking for the reload, and the
// new version opens it again where the viewer was.
api.runtime.onInstalled.addListener(async () => {
  const { reopenAfterUpdate } = await api.storage.local.get('reopenAfterUpdate');
  await api.storage.local.remove(['updateReady', 'reopenAfterUpdate']);
  if (typeof reopenAfterUpdate === 'string' && !(await playerTab())) {
    await api.tabs.create({ url: PLAYER_URL + reopenAfterUpdate });
  }
});
