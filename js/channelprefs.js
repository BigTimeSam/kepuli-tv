// Personal live-TV presentation. Provider data stays intact so hidden items
// can always be restored and newly added channels keep appearing.
export function channelPreferences(value = {}) {
  const ids = (key) => Array.isArray(value?.[key]) ? [...new Set(value[key].map(String))] : [];
  return { hiddenChannels: ids('hiddenChannels'), hiddenCategories: ids('hiddenCategories'),
    channelOrder: ids('channelOrder'), categoryOrder: ids('categoryOrder') };
}

/**
 * The order a channel list starts from, before any personal arrangement.
 * The setting is in Settings › Viewing, because it is the answer to a list
 * of hundreds: choose the order that already suits, then drag the few
 * favourites where they belong.
 *
 * The input is the library's own alphabetical order (js/library.js), so
 * A–Z is what came in and Z–A is its mirror. 'num' is the provider's own
 * channel number; a provider that sends none leaves the stream id to stand
 * for it, which is the same order under a different name.
 */
export const CHANNEL_SORTS = ['az', 'za', 'num'];

const channelNumber = (item) => Number(item.num) || Number(item.id) || 0;

export function sortChannels(items, sort) {
  if (sort === 'za') return [...items].reverse();
  if (sort === 'num') return [...items].sort((a, b) => channelNumber(a) - channelNumber(b));
  return items;
}

export function ordered(items, ids) {
  const rank = new Map(ids.map((id, i) => [String(id), i]));
  return [...items].sort((a, b) => (rank.get(String(a.id)) ?? Infinity) - (rank.get(String(b.id)) ?? Infinity));
}

export function visibilityFilter(prefs) {
  const channels = new Set(prefs.hiddenChannels), categories = new Set(prefs.hiddenCategories);
  return (item) => item.k !== 0 || (!channels.has(String(item.id))
    && !(item.cats || []).some((id) => categories.has(String(id))));
}

// Reorder only the displayed subset, retaining other saved IDs and their
// positions. New IDs are appended; stale IDs are harmless until they return.
export function moveInOrder(saved, displayedIds, id, delta) {
  const visible = displayedIds.map(String);
  return placeInOrder(saved, visible, id, visible.indexOf(String(id)) + delta);
}

/** The same move, to a position rather than by a step: a drop, or Home/End. */
export function placeInOrder(saved, displayedIds, id, to) {
  const visible = displayedIds.map(String);
  const at = visible.indexOf(String(id));
  if (at < 0 || to < 0 || to >= visible.length || to === at) return saved;
  const next = [...visible];
  next.splice(to, 0, next.splice(at, 1)[0]);
  return arrangeOrder(saved, visible, next);
}

/**
 * A whole new order for the displayed subset, written back into the saved
 * list. The displayed IDs keep the slots they already occupy, so the IDs
 * between them — hidden by a filter, or belonging to another country —
 * stay where they are.
 */
export function arrangeOrder(saved, displayedIds, nextIds) {
  const visible = displayedIds.map(String);
  const result = [...new Set([...saved.map(String), ...visible])];
  const ids = new Set(visible);
  const slots = result.map((key, i) => ids.has(key) ? i : -1).filter((i) => i >= 0);
  slots.forEach((slot, i) => { result[slot] = String(nextIds[i]); });
  return result;
}
