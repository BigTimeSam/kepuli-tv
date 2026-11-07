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

export const THEMES = ['dark', 'light', 'system'];
const KEY = 'kepuli-theme';
const lightSystem = matchMedia('(prefers-color-scheme: light)');
let chosen = 'system';

/** The theme a setting comes to now: 'system' read from the system. */
export function resolveTheme(theme) {
  if (theme === 'system') return lightSystem.matches ? 'light' : 'dark';
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
