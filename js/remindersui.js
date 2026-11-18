// Programme reminders: set from the guide, kept per account (js/config.js),
// and said a minute before the programme starts: as the system's
// notifications by background.js wherever the viewer allows them, the
// player open or not, and by an open player in view in its own message
// strip as well, with Watch.
//
// In the app for the iPhone and the iPad (js/platform.js) there is no
// background.js: the app is handed the reminders still ahead and schedules
// each as a notification of the system's, which is said with the app
// closed too; one tapped comes back as `reminder.open`.
//
// Moved out of app.js. It takes the player's state, and the parts app.js
// builds, from js/state.js.

import { api } from './browser.js';
import { $, el } from './dom.js';
import { ios } from './platform.js';
import { on, request, send } from './host.js';
import { reminderItems } from './iosapp.js';
import { clock } from './format.js';
import { reminderDelay } from './epggrid.js';
import { t } from './i18n.js';
import * as store from './config.js';
import { playItem } from './playing.js';
import { hideToast, toast } from './toast.js';
import { switchAccount } from './accountsui.js';
import { openAppSettings } from './external.js';
import { grid, guideOpen, renderGuidePreview } from './guideui.js';
import { setupDirty } from './setupui.js';
import { shownName, stripItem } from './coversui.js';
import { refreshRows, renderSidebar, state } from './state.js';

// A programme to be reminded of, a minute before it starts.
const REMIND_AHEAD = 60 * 1000;
export const reminderKey = (channel, programme) => store.reminderKey({ channel, start: programme.start });
export let reminders = new Map();
let reminderTimer = null;
// The reminders whose notification was tapped in the app before they fell
// due here, by key, and the one the message strip is saying, with its words.
const tapped = new Set();
let said = null;

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
// The app has just said that the system refuses, and where that is changed.
let refused = false;

/**
 * The refusal said under the switch in Settings, while the dialog is open,
 * and taken away when it no longer holds. As a message in the strip it was
 * drawn behind the dialog (a modal dialog is in the top layer): the switch
 * fell back with no word at all.
 */
export function showRefusal(shown = refused) {
  $('notify-hint').hidden = !shown;
}

// In the app: its own switch on, and the system's leave given. The app
// asks the system only when the switch is turned on, so `unasked` is a no
// until then.
const appAllows = (answer) => answer.on === true && answer.system === 'granted';

export async function loadNotifying() {
  // The start of the player waits for this: a short wait for the app.
  notifying = ios ? await request('notify.get', {}, 3000).then(appAllows, () => false)
    : Boolean(await api.permissions?.contains(NOTIFICATIONS).catch(() => false));
  notifyAsked = (await api.storage.local.get('notifyAsked')).notifyAsked === true;
}

/**
 * Calls back when the app says its notifications changed unasked: the
 * viewer gave or took the system's leave in the device's settings and came
 * back (ios/App/Services/Reminders.swift, `activated`). The leave was read
 * once, at the start, so the switch in Settings went on saying off, and
 * the next reminder's message that it shows only while the player is open.
 * @param {(on: boolean) => void} changed
 */
export function onNotifying(changed) {
  if (!ios) return;
  on('notify', (answer) => {
    notifying = appAllows(answer);
    refused = false;
    showRefusal();
    changed(notifying);
  });
}

/** Notifications allowed or taken back. Called in a click: the browser asks only then. */
export async function setNotifying(on) {
  notifyAsked = true;
  api.storage.local.set({ notifyAsked: true });
  try {
    if (ios) {
      // The system's question may stand on the screen for a while.
      const answer = await request('notify.set', { on }, 120000);
      // Refused once, the system does not ask again: the switch falls
      // back, and the viewer is told where the leave is given.
      refused = on && answer.system === 'denied';
      // Under the switch where Settings is open, in the strip otherwise
      // (the guide's Remind me): see showRefusal.
      showRefusal();
      if (refused && !$('setup').open) toast(t('setup.notify.denied'), { kind: 'warn', action: { label: t('setup.notify.open'), onClick: openAppSettings } });
      notifying = appAllows(answer);
    } else notifying = on ? await api.permissions.request(NOTIFICATIONS) : !(await api.permissions.remove(NOTIFICATIONS));
  } catch {
    notifying = false;
  }
  return notifying;
}

/**
 * The app's notifications of an account that left the list, or of every
 * account when none is named (the player reset, its last account
 * removed): the app keeps them with the system, where they went on to
 * fire for an account the viewer had deleted. Awaited before the page
 * loads itself again, which a message only sent may not outlive. Nothing
 * in a browser, where only the open account's timer is set.
 * @param {string} [account] js/config.js accountKey
 */
export const forgetNotifications = (account) => (ios
  ? request('reminders.clear', account ? { account } : {}, 3000).then(() => {}, () => {})
  : Promise.resolve());

/** The stored list in memory and the timer set for it: at start, and when another tab changes it. */
export function showReminders(list) {
  const now = Date.now();
  reminders = new Map((list || [])
    .filter((r) => r.stop > now)
    .map((r) => [store.reminderKey(r), r]));
  armReminders();
  showUpcoming();
}

/** The history's "Upcoming" rows follow the reminders (js/collections.js). */
function showUpcoming() {
  if (state.tab !== 'recent' || state.detail || !state.lib) return;
  // The last reminder gone while "Upcoming" is the kind chosen: back to All.
  if (state.kind === 'r' && !reminders.size) { state.kind = null; state.lastKind.recent = null; }
  renderSidebar();
  refreshRows({ keepScroll: true });
}

export function toggleReminder(channel, programme) {
  const key = reminderKey(channel, programme);
  // The stored list, the timer and the bells follow what `reminders` holds.
  const apply = () => {
    store.setReminder(key, reminders.get(key) || null);
    armReminders();
    if (guideOpen) { grid.invalidate(); renderGuidePreview(channel, programme); }
    showUpcoming();
  };
  if (reminders.has(key)) reminders.delete(key);
  else {
    reminders.set(key, { channel: stripItem(channel), title: programme.title, start: programme.start, stop: programme.stop });
    // Asked before anything is awaited: the click is spent by the first await.
    const asking = !(notifying || notifyAsked || !api.permissions);
    const allowed = asking ? setNotifying(true) : Promise.resolve(notifying);
    allowed.then((on) => {
      // Refused at this first question in the app: what was said of it is
      // left to be read, with its way to the device's settings (replaced
      // at once by "… while the player is open", nobody learnt where
      // notifications are turned on), and the reminder is not set: its
      // bell promised a notification that could not come.
      if (asking && refused) { reminders.delete(key); apply(); return; }
      toast(t(on ? 'guide.remind.set.notify' : 'guide.remind.set', { title: programme.title, time: clock(programme.start) }), { long: true });
    });
  }
  apply();
}

/**
 * One timer, for the reminder due first. A hidden tab's timers run late, by
 * up to a minute. A timer takes at most 2^31-1 ms, some 24.8 days, and a
 * longer one fires at once — a reminder that far ahead, its programme from
 * a guide that reaches weeks on, would have the timer fire, find nothing
 * due and arm itself again without end. So the wait is a day at most, and
 * then it is measured again.
 */
export function armReminders() {
  // The app's notifications follow every change: the same sentence the
  // message strip says, a minute before the start.
  if (ios) {
    send('reminders.set', {
      account: store.currentAccount(),
      items: reminderItems([...reminders], REMIND_AHEAD, Date.now(),
        (r) => t('guide.remind.soon', { title: r.title, time: clock(r.start), channel: shownName(r.channel) })),
    });
  }
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
 * reminders gone when the notification said them. One due while the tab
 * is in sight is said in the message strip and, where notifications are
 * allowed, as one of those too.
 *
 * Every open player holds the same reminders and arms the same timer. The
 * stored list decides which one says it: the reminders are taken out of it
 * under the lock that every change to it goes through, and a tab that finds
 * them already gone — another said them first — says nothing.
 */
async function fireReminders() {
  if (document.hidden) {
    document.addEventListener('visibilitychange', fireReminders, { once: true });
    if (notifying && !ios) api.runtime.sendMessage({ sayReminders: store.remindersStorageKey() }).catch(() => {});
    return;
  }
  const now = Date.now();
  const local = [...reminders.entries()].filter(([, r]) => r.start - REMIND_AHEAD <= now);
  for (const [key] of local) reminders.delete(key);
  armReminders();
  if (!local.length) return;
  const due = await store.takeDueReminders(now + REMIND_AHEAD);
  if (guideOpen) grid.invalidate();
  showUpcoming();
  // As the system's notifications too, where they are allowed: the player
  // in sight is not the viewer looking at it (see background.js).
  // The app scheduled its own, and shows none while it is in front.
  if (notifying && due.length && !ios) api.runtime.sendMessage({ notifyReminders: { key: store.remindersStorageKey(), due } }).catch(() => {});
  // Not one whose notification the viewer has just tapped in the app: its
  // channel is starting, and the strip said it again for a minute with a
  // Watch that started the same stream anew. In a browser background.js
  // has taken a clicked one out of the stored list by now.
  const showing = due.filter((r) => r.stop > now && !tapped.delete(store.reminderKey(r))).sort((a, b) => b.start - a.start)[0];
  if (!showing) return;
  const channel = showing.channel;
  const name = shownName(channel);
  const text = showing.start > now
    ? t('guide.remind.soon', { title: showing.title, time: clock(showing.start), channel: name })
    : t('guide.remind.started', { title: showing.title, channel: name });
  toast(text, { action: { label: t('guide.watch'), onClick: () => playItem(channel) }, duration: Math.max(REMIND_AHEAD, 15000) });
  said = { key: store.reminderKey(showing), text };
}

/**
 * A reminder's notification was clicked: background.js leaves the channel
 * under "watchAsked" and brings the player forward, or opens one. Played
 * when it is fresh; taken away either way, so that a player opened next
 * week does not start a channel by itself. One of another account in the
 * list takes that account into use first, as Use in Settings does, and its
 * connection ends by coming here again: reminders are notified for every
 * account of the list, and a tap on another's did nothing at all. Not over
 * Settings with changes unsaved, which the switch would throw away.
 */
let switchedFor = 0;
export async function watchAsked() {
  const { watchAsked: asked } = await api.storage.local.get('watchAsked');
  if (!asked) return;
  const fresh = asked.at > Date.now() - 60e3, here = asked.account === store.currentAccount();
  const other = fresh && !here && switchedFor !== asked.at && !(el.setup.open && setupDirty())
    && (state.accounts || []).find((a) => store.accountKey(a) === asked.account);
  // Once for a tap: an account that does not connect is not gone back to.
  if (other) { switchedFor = asked.at; switchAccount(other.id); return; }
  await api.storage.local.remove('watchAsked');
  if (fresh && here) playItem(asked.channel);
}

// Not before the player is connected: the app's tap can arrive while it
// starts or connects again, and every connection ends by looking for the
// record itself (connect in js/app.js).
api.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.watchAsked?.newValue && state.lib) watchAsked();
});

// A notification tapped in the app, as background.js leaves a click: with
// the reminder's id and the tap's own time. One still to fall due here is
// noted for fireReminders; one the strip is saying is taken out of it, as
// its Watch went on standing over the channel the tap had started. The app
// says a tap again to a page loaded after its process had ended
// (Bridge.pageGone), which may be a minute later, and a channel started
// then is one the viewer no longer waits for.
if (ios) {
  on('reminder.open', ({ channel, account, id, at }) => {
    if (reminders.has(id)) tapped.add(id);
    else if (said?.key === id && !el.toast.hidden && el.toastText.textContent === said.text) hideToast();
    api.storage.local.set({ watchAsked: { channel, account, at: typeof at === 'number' ? at : Date.now() } });
  });
}
