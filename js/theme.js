// The colour theme: dark, light, or the system's, see :root[data-theme] in
// player.css.
//
// The choice is kept with the other settings, but those are read from the
// extension's storage, which answers only after the first paint — a viewer
// on the light theme saw the dark one flash past at every start. A copy in
// localStorage is read before anything is drawn, and the stored setting
// has the last word once it arrives.
//
// 'system' follows the operating system's light or dark mode, and keeps
// following it while the player is open. It is the default, shown in
// Settings as Automatic with the theme it comes to now.

import { $ } from './dom.js';
import { t } from './i18n.js';
import { remote } from './caret.js';

export const THEMES = ['dark', 'light', 'system'];
const KEY = 'kepuli-theme';
const lightSystem = matchMedia('(prefers-color-scheme: light)');
let chosen = 'system';

/** The theme a setting comes to now: 'system' read from the system. */
export function resolveTheme(theme) {
  // A television has no light mode of its own to follow, and the engine
  // there answers light: in a dim room that is a lamp. Automatic is dark
  // on a television; Light is still there to be chosen.
  if (theme === 'system') return !remote && lightSystem.matches ? 'light' : 'dark';
  return theme === 'light' ? 'light' : 'dark';
}

/** Applies a setting and returns the theme in force, dark or light. */
export function applyTheme(theme) {
  chosen = THEMES.includes(theme) ? theme : 'system';
  const value = resolveTheme(chosen);
  document.documentElement.dataset.theme = value;
  try { localStorage.setItem(KEY, chosen); } catch { /* storage refused: the setting still applies */ }
  return value;
}

/** The setting as last applied on this device, before the settings are in. */
export function earlyTheme() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

/** Calls back when the system changes its mode while 'system' is chosen. */
export function onSystemTheme(callback) {
  lightSystem.addEventListener('change', () => { if (chosen === 'system') callback(); });
}

/**
 * The theme in force, and the button that changes it: the button shows
 * and names the theme it leads to, a sun in the dark and a moon in the
 * light, so that its label says what a press will do.
 * @param {string} setting the theme setting: dark, light or system
 */
export function renderTheme(setting) {
  const theme = applyTheme(setting);
  const button = $('btn-theme');
  const next = theme === 'light' ? 'dark' : 'light';
  button.dataset.next = next;
  button.dataset.i18nLabel = button.dataset.i18nTitle = `theme.to.${next}`;
  button.setAttribute('aria-label', t(`theme.to.${next}`));
  button.title = t(`theme.to.${next}`);
}
