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
// A browser that lacks getContexts, as Orion on the iPhone does, finds
// none: there the click went dead, as the call threw before the tab was
// opened, so a new player is the answer whenever the open one cannot be
// looked for.
async function playerTab() {
  try {
    const contexts = await api.runtime.getContexts({ contextTypes: ['TAB'] });
    return contexts.find((context) => String(context.documentUrl).split('#')[0] === PLAYER_URL) || null;
  } catch {
    return null;
  }
}

api.action.onClicked.addListener(async () => {
  const open = await playerTab();
  if (open) {
    await api.tabs.update(open.tabId, { active: true });
    // A phone's browser has no windows to bring forward.
    await api.windows?.update(open.windowId, { focused: true }).catch(() => {});
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
api.runtime.onUpdateAvailable?.addListener(async ({ version }) => {
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

// When the extension is removed, the browser opens a one-question form
// asking why (runtime.setUninstallURL; no permission needed). The address
// carries the version, the browser and the interface language and nothing
// else — no account, no address, nothing the viewer watched — prefilled
// into the form's one field the viewer does not have to touch. Set again
// whenever the language is changed, so that it is the language in use.
const UNINSTALL_FORM = 'https://docs.google.com/forms/d/e/1FAIpQLSciTzjI2cooCll5fFJSqsd3SjHpKIF_jDdyNhmATqmkwvcl0A/viewform';
const UNINSTALL_ENTRY = 'entry.141293273';

// Which browser the answers come from, asked of the engine: Orion names
// itself Chrome on a Mac in its user agent, and its pages are
// chrome-extension:// ones, so the form said "chrome" for the iPhone. Only
// the iPhone's WebKit has ManagedMediaSource without MediaSource (see
// nativeHls in js/browser.js).
function engineName() {
  const url = api.runtime.getURL('');
  if (/^moz-extension:/.test(url)) return 'firefox';
  if (/^safari-web-extension:/.test(url)) return 'safari';
  if (typeof globalThis.MediaSource === 'undefined' && 'ManagedMediaSource' in globalThis) return 'webkit';
  return 'chrome';
}

async function setUninstallForm() {
  if (!api.runtime.setUninstallURL) return;
  const { settings } = await api.storage.local.get('settings');
  const lang = settings && settings.lang && settings.lang !== 'auto' ? settings.lang : (navigator.language || '').slice(0, 2);
  const facts = `${api.runtime.getManifest().version} · ${engineName()} · ${lang}`;
  await api.runtime.setUninstallURL(`${UNINSTALL_FORM}?usp=pp_url&${UNINSTALL_ENTRY}=${encodeURIComponent(facts)}`);
}

api.runtime.onInstalled.addListener(() => { setUninstallForm().catch(() => {}); });
api.runtime.onStartup?.addListener(() => { setUninstallForm().catch(() => {}); });
api.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) setUninstallForm().catch(() => {});
});

/* ------------------------------------- reminders and planned recordings */

// A reminder set in the guide and a recording planned there used to depend
// on a player being open when their time came: a closed one said nothing
// and recorded nothing. The times are kept here as alarms instead, one for
// each stored list, named by the list's key in storage.local, at the
// moment its first entry falls due. When one goes off with no player open,
// a planned recording opens the player in a tab behind the one in view,
// and the player makes the recording as it would have (js/recordingsui.js);
// a reminder is said as a notification where the viewer has allowed them
// (the optional "notifications" permission, asked for by the player), and
// waits for the next player otherwise. With a player open the alarm does
// nothing: the player has timers of its own for both.
//
// "alarms" shows no warning in either browser, so the update that brought
// it did not disable the extension; "notifications" would have, as a
// required permission, which is why it is an optional one.
//
// A browser that cannot tell whether a player is open (Orion, see
// playerTab above) is left as it was: it would open a second player.
const REMIND_AHEAD = 60 * 1000;
const RECORDINGS = 'recordings';
const NOTICES = 'reminderNotices';
// The same lock as every change to a stored list in js/config.js.
const LIST_LOCK = 'kepuli-tv-lists';
const timedList = (key) => key === RECORDINGS || key.startsWith('reminders:');
const scheduling = () => Boolean(api.alarms && api.runtime.getContexts);

/** When each entry of a stored list falls due, for those still worth acting on. */
function dueTimes(key, list, now) {
  if (!Array.isArray(list)) return [];
  return key === RECORDINGS
    ? list.filter((r) => r.state === 'planned' && (!r.stop || r.stop > now)).map((r) => r.start)
    : list.filter((r) => r.stop > now).map((r) => r.start - REMIND_AHEAD);
}

/** The list's alarm set for its first entry due after `after`, or cleared when there is none. */
async function armList(key, list, after = 0) {
  const times = dueTimes(key, list, Date.now()).filter((time) => time > after);
  if (times.length) await api.alarms.create(key, { when: Math.min(...times) });
  else await api.alarms.clear(key);
}

/** Every list's alarm from what is stored: Firefox forgets alarms when it closes. */
async function armAll() {
  if (!scheduling()) return;
  const stored = await api.storage.local.get(null);
  await Promise.all(Object.keys(stored).filter(timedList).map((key) => armList(key, stored[key])));
}

/**
 * The reminders of one account that are due, taken out of its list and
 * said. Each notification's reminder is kept under the notification's id
 * until it is clicked, since this script may have been stopped by then.
 */
async function sayReminders(key, now) {
  const due = await navigator.locks.request(LIST_LOCK, async () => {
    const list = (await api.storage.local.get(key))[key] || [];
    const taken = list.filter((r) => r.start - REMIND_AHEAD <= now);
    if (taken.length) await api.storage.local.set({ [key]: list.filter((r) => !taken.includes(r)) });
    return taken.filter((r) => r.stop > now);
  });
  if (!due.length) return;
  const { [NOTICES]: notices = {} } = await api.storage.local.get(NOTICES);
  // Notices nobody clicked go after a day.
  const kept = Object.fromEntries(Object.entries(notices).filter(([, n]) => n.at > now - 24 * 3600e3));
  for (const r of due) {
    const id = `reminder:${r.channel.id}:${r.start}`;
    kept[id] = { channel: r.channel, account: key.slice('reminders:'.length), at: now };
    await api.notifications.create(id, {
      type: 'basic',
      iconUrl: api.runtime.getURL('icons/icon128.png'),
      title: r.title,
      // The programme and its channel: said a minute before the start, it
      // needs no time, and this script has none of the player's words.
      message: r.channel.displayName || r.channel.n || '',
    });
  }
  await api.storage.local.set({ [NOTICES]: kept });
}

api.alarms?.onAlarm.addListener(async ({ name: key }) => {
  if (!scheduling() || !timedList(key)) return;
  const now = Date.now();
  const list = (await api.storage.local.get(key))[key];
  if (!(await playerTab()) && dueTimes(key, list, now).some((time) => time <= now)) {
    if (key === RECORDINGS) await api.tabs.create({ url: PLAYER_URL, active: false });
    else if (api.notifications) await sayReminders(key, now).catch((err) => console.warn('[iptv] reminder not said', err));
  }
  await armList(key, list, now);
});

// An open player out of sight has its due reminders said from here too.
api.runtime.onMessage.addListener((message) => {
  const key = message?.sayReminders;
  if (typeof key === 'string' && key.startsWith('reminders:') && api.notifications) sayReminders(key, Date.now()).catch(() => {});
});

api.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !scheduling()) return;
  for (const key of Object.keys(changes).filter(timedList)) armList(key, changes[key].newValue).catch(() => {});
});
api.runtime.onInstalled.addListener(() => { armAll().catch(() => {}); });
api.runtime.onStartup?.addListener(() => { armAll().catch(() => {}); });

/**
 * A notification clicked: the player comes to the front, opened if there
 * is none, and is left word of the channel to play ("watchAsked", read by
 * js/remindersui.js at its start and when it changes).
 */
async function watchNotice(id) {
  const { [NOTICES]: notices = {} } = await api.storage.local.get(NOTICES);
  const notice = notices[id];
  api.notifications.clear(id);
  if (!notice) return;
  delete notices[id];
  await api.storage.local.set({ [NOTICES]: notices, watchAsked: { channel: notice.channel, account: notice.account, at: Date.now() } });
  const open = await playerTab();
  if (open) {
    await api.tabs.update(open.tabId, { active: true });
    await api.windows?.update(open.windowId, { focused: true }).catch(() => {});
  } else {
    await api.tabs.create({ url: PLAYER_URL });
  }
}

// The permission is optional, so the API may arrive after this script has
// started: the listener is added now when it is there, and when it is
// granted otherwise.
let noticeClicks = false;
function listenForNoticeClicks() {
  if (noticeClicks || !api.notifications) return;
  noticeClicks = true;
  api.notifications.onClicked.addListener((id) => { watchNotice(id).catch(() => {}); });
}
listenForNoticeClicks();
api.permissions.onAdded?.addListener(listenForNoticeClicks);
