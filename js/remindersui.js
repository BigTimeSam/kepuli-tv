// Programme reminders: set from the guide, kept per account (js/config.js),
// and said a minute before the programme starts with Watch. An open player
// in view says them itself; one out of sight, or closed, has them said as
// the system's notifications by background.js, where the viewer allows it.
//
// Moved out of app.js. It takes the player's state, and the parts app.js
// builds, from js/state.js.

import { api } from './browser.js';
import { clock } from './format.js';
import { reminderDelay } from './epggrid.js';
import { t } from './i18n.js';
import * as store from './config.js';
import { playItem } from './playing.js';
import { toast } from './toast.js';
import { grid, guideOpen, renderGuidePreview } from './guideui.js';
import { shownName, stripItem } from './coversui.js';

// A programme to be reminded of, a minute before it starts.
const REMIND_AHEAD = 60 * 1000;
export const reminderKey = (channel, programme) => store.reminderKey({ channel, start: programme.start });
export let reminders = new Map();
let reminderTimer = null;

export async function loadReminders() {
  showReminders(await store.loadReminders());
}

// Notifications are an optional permission: as a required one, Chrome would
// have disabled the extension on the update that brought it until the
// viewer accepted it. It is asked for with the first reminder set, once —
// a viewer who said no is not asked at every reminder — and Settings has
// its switch from then on.
const NOTIFICATIONS = { permissions: ['notifications'] };
export let notifying = false;
let notifyAsked = true;

export async function loadNotifying() {
  notifying = Boolean(await api.permissions?.contains(NOTIFICATIONS).catch(() => false));
  notifyAsked = (await api.storage.local.get('notifyAsked')).notifyAsked === true;
}

/** Notifications allowed or taken back. Called in a click: the browser asks only then. */
export async function setNotifying(on) {
  notifyAsked = true;
  api.storage.local.set({ notifyAsked: true });
  try {
    notifying = on ? await api.permissions.request(NOTIFICATIONS) : !(await api.permissions.remove(NOTIFICATIONS));
  } catch {
    notifying = false;
  }
  return notifying;
}

/** The stored list in memory and the timer set for it: at start, and when another tab changes it. */
export function showReminders(list) {
  const now = Date.now();
  reminders = new Map((list || [])
    .filter((r) => r.stop > now)
    .map((r) => [store.reminderKey(r), r]));
  armReminders();
}

export function toggleReminder(channel, programme) {
  const key = reminderKey(channel, programme);
  if (reminders.has(key)) reminders.delete(key);
  else {
    reminders.set(key, { channel: stripItem(channel), title: programme.title, start: programme.start, stop: programme.stop });
    // Asked before anything is awaited: the click is spent by the first await.
    const allowed = notifying || notifyAsked || !api.permissions ? Promise.resolve(notifying) : setNotifying(true);
    allowed.then((on) => toast(t(on ? 'guide.remind.set.notify' : 'guide.remind.set', { title: programme.title, time: clock(programme.start) }), { long: true }));
  }
  store.setReminder(key, reminders.get(key) || null);
  armReminders();
  if (guideOpen) { grid.invalidate(); renderGuidePreview(channel, programme); }
}

/**
 * One timer, for the reminder due first. A hidden tab's timers run late, by
 * up to a minute. A timer takes at most 2^31-1 ms, some 24.8 days, and a
 * longer one fires at once — a reminder that far ahead, its programme from
 * a guide that reaches weeks on, would have the timer fire, find nothing
 * due and arm itself again without end. So the wait is a day at most, and
 * then it is measured again.
 */
function armReminders() {
  clearTimeout(reminderTimer);
  const due = [...reminders.values()].map((r) => r.start - REMIND_AHEAD);
  if (!due.length) return;
  reminderTimer = setTimeout(fireReminders, reminderDelay(Math.min(...due), Date.now()));
}

/**
 * Every reminder that is due is said and forgotten. One due while the tab
 * is out of sight is handed to background.js to say as a notification,
 * where they are allowed; otherwise it waits until the tab is looked at
 * again, for as long as the programme is still on: a message nobody saw
 * has reminded nobody. The wait is kept either way, and finds the
 * reminders gone when the notification said them.
 *
 * Every open player holds the same reminders and arms the same timer. The
 * stored list decides which one says it: the reminders are taken out of it
 * under the lock that every change to it goes through, and a tab that finds
 * them already gone — another said them first — says nothing.
 */
async function fireReminders() {
  if (document.hidden) {
    document.addEventListener('visibilitychange', fireReminders, { once: true });
    if (notifying) api.runtime.sendMessage({ sayReminders: store.remindersStorageKey() }).catch(() => {});
    return;
  }
  const now = Date.now();
  const local = [...reminders.entries()].filter(([, r]) => r.start - REMIND_AHEAD <= now);
  for (const [key] of local) reminders.delete(key);
  armReminders();
  if (!local.length) return;
  const due = await store.takeDueReminders(now + REMIND_AHEAD);
  if (guideOpen) grid.invalidate();
  const showing = due.filter((r) => r.stop > now).sort((a, b) => b.start - a.start)[0];
  if (!showing) return;
  const channel = showing.channel;
  const name = shownName(channel);
  const text = showing.start > now
    ? t('guide.remind.soon', { title: showing.title, time: clock(showing.start), channel: name })
    : t('guide.remind.started', { title: showing.title, channel: name });
  toast(text, { action: { label: t('guide.watch'), onClick: () => playItem(channel) }, duration: Math.max(REMIND_AHEAD, 15000) });
}

/**
 * A reminder's notification was clicked: background.js leaves the channel
 * under "watchAsked" and brings the player forward, or opens one. Played
 * when it is this account's and fresh; taken away either way, so that a
 * player opened next week does not start a channel by itself.
 */
export async function watchAsked() {
  const { watchAsked: asked } = await api.storage.local.get('watchAsked');
  if (!asked) return;
  await api.storage.local.remove('watchAsked');
  if (asked.account === store.currentAccount() && asked.at > Date.now() - 60e3) playItem(asked.channel);
}

api.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.watchAsked?.newValue) watchAsked();
});
