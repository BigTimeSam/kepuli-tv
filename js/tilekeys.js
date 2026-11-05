// The keys on a strip of tiles: the related titles under the picture, the
// films' favourites strip, and the empty player's Continue watching,
// channels and picks. Each tile is a button of its own, outside the list,
// and the keys used to reach past it to the list: an arrow moved the list's
// cursor, `s` starred the list's row and Delete took the list's row out of
// the history, whatever tile had the focus. Here the keys act on the tile
// that has the focus instead: the arrows step between the tiles, `s` stars
// the tile's own title, and Delete forgets a Continue watching card.
//
// It takes the star from coversui.js (a cycle that ES modules resolve:
// nothing here runs while the modules load, only when a key is pressed).

import { shownName, toggleFavorite } from './coversui.js';
import { state } from './app.js';
import { t } from './i18n.js';
import { toast } from './toast.js';
import { neighbourTile } from './listnavigation.js';

// The strips, and the tiles in them that the arrows step between.
const STRIPS = ['.related-row', '#fav-strip-items', '.idle-cards', '.idle-channels', '.idle-picks'];
const TILES = '.related-tile, .fav-tile, .idle-card, .idle-channel, .idle-pick';

// What each tile stands for: the item `s` stars, and what Delete does.
const bound = new WeakMap();

/**
 * Ties a tile to its item, and to what Delete does on it where it does
 * anything (a Continue watching card). Buttons beside a tile, such as the
 * card's ✕, are tied to the same item.
 */
export function bindTile(tile, item, { remove = null, also = [] } = {}) {
  const binding = { item, remove };
  for (const node of [tile, ...also]) bound.set(node, binding);
}

const visible = (node) => !node.hidden && node.getClientRects().length > 0;

/**
 * A key pressed while the focus is in a strip: true when it was the
 * strip's, and the list must not see it. Enter and Space are the tile's
 * own as a button's; the player's other keys (f, m, the guide…) go on.
 */
export function handleTileKey(e) {
  const target = /** @type {HTMLElement} */ (e.target);
  const strip = target.closest?.(STRIPS.join(', '));
  if (!strip) return false;
  const binding = bound.get(target);
  switch (e.key) {
    case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown': case 'Home': case 'End': {
      const tile = target.closest(TILES);
      if (tile) {
        // Up and down may leave a strip for the one below it on the
        // empty player's page; left and right keep to the strip.
        const scope = e.key === 'ArrowUp' || e.key === 'ArrowDown' ? strip.closest('#idle-home') || strip : strip;
        const tiles = [...scope.querySelectorAll(TILES)].filter(visible);
        const next = tiles[neighbourTile(tiles.map((node) => node.getBoundingClientRect()), tiles.indexOf(tile), e.key)];
        if (next) {
          next.focus();
          next.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
      }
      return true;
    }
    case 'PageUp': case 'PageDown': case 'ContextMenu':
      return true;
    case 's':
      if (binding) star(binding.item, strip, target);
      return true;
    case 'Delete':
      if (binding?.remove) binding.remove();
      return true;
    default:
      return false;
  }
}

/**
 * The tile's own title starred or unstarred. The strips are painted again
 * when a favourite changes, so the focus goes to the tile standing where
 * this one stood: without it the next key would find the focus on the page.
 */
function star(item, strip, target) {
  const selector = STRIPS.find((s) => strip.matches(s));
  const strips = [...document.querySelectorAll(selector)];
  const stripAt = strips.indexOf(strip);
  const tileAt = [...strip.querySelectorAll(TILES)].indexOf(target.closest(TILES));
  toggleFavorite(item);
  const on = state.favorites.has(`${item.k}:${item.id}`);
  toast(t(on ? 'fav.added' : 'fav.removed', { name: shownName(item) }));
  if (target.isConnected) return;
  const again = document.querySelectorAll(selector)[stripAt];
  const tiles = again ? [...again.querySelectorAll(TILES)] : [];
  (tiles[Math.min(tileAt, tiles.length - 1)] || again?.closest('#fav-strip, .related, #idle-home')?.querySelector('button'))?.focus();
}
