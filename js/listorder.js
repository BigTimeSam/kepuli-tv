// The order of each list, chosen at its foot and kept as a setting: the
// channels, the favourites, the films, the series and the history. Pure
// functions and tables, so that the foot's marks, Settings and the list
// itself read the same choices, and Node can check them.
//
// Each list once kept its order its own way: the channels as a setting
// with a mark that could not reach Z–A, the favourites as a setting with no
// field in Settings, the films as a session-only menu inside "Filter
// titles" that Reset cleared, and the history not at all.

/** The orders a list offers, its default first. */
export const LIST_ORDERS = {
  live: ['az', 'za', 'num'],
  fav: ['az', 'za', 'added'],
  movie: ['az', 'za', 'newest', 'oldest', 'rating', 'added'],
  series: ['az', 'za', 'newest', 'oldest', 'rating', 'added'],
  recent: ['watched', 'az', 'za'],
};

/** The setting each list's order is kept in. */
export const ORDER_SETTINGS = {
  live: 'channelSort',
  fav: 'favoritesSort',
  movie: 'movieSort',
  series: 'seriesSort',
  recent: 'historySort',
};

/**
 * The marks at a list's foot: each mark stands for one order or two, and a
 * press on a lit mark that has two turns it round (A–Z to Z–A, newest to
 * oldest). A mark that is not lit takes its first order.
 */
export const ORDER_MARKS = {
  live: [['az', 'za'], ['num']],
  fav: [['az', 'za'], ['added']],
  movie: [['az', 'za'], ['newest', 'oldest'], ['rating'], ['added']],
  series: [['az', 'za'], ['newest', 'oldest'], ['rating'], ['added']],
  recent: [['watched'], ['az', 'za']],
};

/** A list's order from the settings; anything it does not offer is its default. */
export function listOrder(settings, list) {
  const orders = LIST_ORDERS[list];
  if (!orders) return null;
  const value = settings?.[ORDER_SETTINGS[list]];
  return orders.includes(value) ? value : orders[0];
}

/** What a press on the mark for `orders` chooses, the list standing at `current`. */
export function pressedOrder(orders, current) {
  const at = orders.indexOf(current);
  return at < 0 ? orders[0] : orders[(at + 1) % orders.length];
}

/**
 * Films or series in the chosen order. `items` come in by name, A–Z, as
 * the list sorts them; the facts (year, rating) come from `factsOf`, as
 * "Filter titles" reads them. A title whose year, rating or date added is
 * not known goes last in every order, and equal ones keep their A–Z order.
 */
export function orderTitles(items, order, factsOf) {
  if (order === 'za') return [...items].reverse();
  const key = order === 'rating' ? 'rating' : order === 'newest' || order === 'oldest' ? 'year' : order === 'added' ? 'added' : null;
  if (!key) return items;
  const value = (item) => (key === 'added' ? Number(item.added) || 0 : Number(factsOf(item)?.[key]) || 0);
  return items
    .map((item) => ({ item, v: value(item) }))
    .sort((a, b) => {
      if (!a.v || !b.v) return Number(!a.v) - Number(!b.v);
      return order === 'oldest' ? a.v - b.v : b.v - a.v;
    })
    .map((entry) => entry.item);
}
