// Programme reminders: set from the guide, kept per account (js/config.js),
// and said a minute before the programme starts with Watch, while the player
// is open in a tab.
//
// Moved out of app.js. It takes the player's state and helpers from app.js
// (a cycle that ES modules resolve: nothing here runs while the modules
// load, only when the player calls in).

import { clock, duration } from './format.js';
import { reminderDelay } from './epggrid.js';
import { t } from './i18n.js';
import * as store from './config.js';
import { playItem, toast } from './app.js';
import { grid, guideOpen, renderGuidePreview } from './guideui.js';
import { shownName, stripItem } from './coversui.js';

// A programme to be reminded of, a minute before it starts. Only while a
// player is open: a reminder from a closed one would take a background
// timer and the notifications permission, and Chrome disables an extension
// on update until a new permission like that has been accepted.
const REMIND_AHEAD = 60 * 1000;
export const reminderKey = (channel, programme) => store.reminderKey({ channel, start: programme.start });
export let reminders = new Map();
let reminderTimer = null;

export async function loadReminders() {
  showReminders(await store.loadReminders());
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
    toast(t('guide.remind.set', { title: programme.title, time: clock(programme.start) }), { long: true });
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
 * was out of sight waits until it is looked at again, for as long as the
 * programme is still on: a message nobody saw has reminded nobody.
 *
 * Every open player holds the same reminders and arms the same timer. The
 * stored list decides which one says it: the reminders are taken out of it
 * under the lock that every change to it goes through, and a tab that finds
 * them already gone — another said them first — says nothing.
 */
async function fireReminders() {
  if (document.hidden) {
    document.addEventListener('visibilitychange', fireReminders, { once: true });
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
