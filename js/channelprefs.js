// Personal live-TV presentation. Provider data stays intact so hidden items
// can always be restored and newly added channels keep appearing.
//
// What a viewer arranges is small on purpose: the countries they watch and
// the odd channel hidden; their favourites open each list (js/app.js,
// renderFavStrip). A full order of every channel, edited in a dialog of its
// own, was what came before; nobody arranges five hundred rows, and the
// dialog it took was the hardest thing in the app to use.
import { sortItems } from './library.js';

export function channelPreferences(value = {}) {
  const ids = (key) => Array.isArray(value?.[key]) ? [...new Set(value[key].map(String))] : [];
  return {
    hiddenChannels: ids('hiddenChannels'),
    // Hidden by the editor that came before; still honoured, and offered
    // back under Hidden, but no longer made.
    hiddenCategories: ids('hiddenCategories'),
    // The live groups the viewer watches, by name; empty is all of them.
    // A list of what to show rather than of what to hide, so that a
    // country the provider adds later does not turn up uninvited.
    countries: ids('countries'),
  };
}

/**
 * The order a channel list starts from, before any personal arrangement.
 * The setting is in Settings › Viewing, because it is the answer to a list
 * of hundreds: choose the order that already suits, then drag the few
 * favourites where they belong.
 *
 * Without a label the input is taken to be in the library's own
 * alphabetical order (js/library.js), so A–Z is what came in and Z–A is
 * its mirror. 'num' is the provider's own channel number; a provider that
 * sends none leaves the stream id to stand for it, which is the same order
 * under a different name. Equal numbers keep the alphabetical order.
 */
export const CHANNEL_SORTS = ['az', 'za', 'num'];

const channelNumber = (item) => Number(item.num) || Number(item.id) || 0;

export function sortChannels(items, sort, label = null) {
  // By the name the viewer sees rather than the provider's: once "FI: " is
  // off the rows, "FI: Yle TV1" must not sort among the Y's of a list where
  // an untagged "Alfa TV" sits at the top. The list and the channel editor
  // hand in the same label, so the order arranged in one is the order shown
  // in the other.
  const base = label ? sortItems(items, label) : items;
  if (sort === 'za') return [...base].reverse();
  if (sort === 'num') return [...base].sort((a, b) => channelNumber(a) - channelNumber(b));
  return base;
}

export function visibilityFilter(prefs) {
  const channels = new Set(prefs.hiddenChannels), categories = new Set(prefs.hiddenCategories);
  return (item) => item.k !== 0 || (!channels.has(String(item.id))
    && !(item.cats || []).some((id) => categories.has(String(id))));
}
