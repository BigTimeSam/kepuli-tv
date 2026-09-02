// Kuvakkeen klikkaus avaa soittimen omaan välilehteen (tai nostaa olemassa olevan esiin).
//
// Oma välilehti etsitään runtime.getContexts()-kutsulla eikä
// tabs.query({ url })-kutsulla: jälkimmäinen vaatisi "tabs"-oikeuden, joka
// Chrome Web Storen tarkistuksessa pitäisi perustella erikseen. getContexts
// näkee vain laajennuksen omat sivut eikä tarvitse mitään oikeutta.
// Vaatii Chrome 116+ (manifestin minimum_chrome_version).
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
