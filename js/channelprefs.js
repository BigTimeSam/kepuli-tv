// Personal live-TV presentation. Provider data stays intact so hidden items
// can always be restored and newly added channels keep appearing.
export function channelPreferences(value = {}) {
  const ids = (key) => Array.isArray(value?.[key]) ? [...new Set(value[key].map(String))] : [];
  return { hiddenChannels: ids('hiddenChannels'), hiddenCategories: ids('hiddenCategories'),
    channelOrder: ids('channelOrder'), categoryOrder: ids('categoryOrder') };
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
  const at = visible.indexOf(String(id));
  const target = at + delta;
  if (at < 0 || target < 0 || target >= visible.length) return saved;
  const result = [...new Set([...saved.map(String), ...visible])];
  const ids = new Set(visible);
  const slots = result.map((key, i) => ids.has(key) ? i : -1).filter((i) => i >= 0);
  [visible[at], visible[target]] = [visible[target], visible[at]];
  slots.forEach((slot, i) => { result[slot] = visible[i]; });
  return result;
}
