// The colour theme: dark or light, see :root[data-theme] in player.css.
//
// The choice is kept with the other settings, but those are read from the
// extension's storage, which answers only after the first paint — a viewer
// on the light theme saw the dark one flash past at every start. A copy in
// localStorage is read before anything is drawn, and the stored setting
// has the last word once it arrives.

export const THEMES = ['dark', 'light'];
const KEY = 'kepuli-theme';

export function applyTheme(theme) {
  const value = THEMES.includes(theme) ? theme : 'dark';
  document.documentElement.dataset.theme = value;
  try { localStorage.setItem(KEY, value); } catch { /* storage refused: the setting still applies */ }
  return value;
}

/** The theme as last applied on this device, before the settings are in. */
export function earlyTheme() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}
