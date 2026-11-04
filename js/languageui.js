// Switching the interface language without a reload (the dictionary loaded,
// the static text and the open views drawn again, the date formats along),
// and the empty player's page: its title and text, and the watcher that
// gives the overlay its page look while it says "Nothing playing".
//
// Moved out of app.js. It takes the player's state and helpers from app.js
// (a cycle that ES modules resolve: nothing here runs while the modules
// load, only when the player calls in).

import { $, el } from './dom.js';
import { applyStatic, loadLanguage, localeTag, setEnglishRegion, setLanguage, t } from './i18n.js';
import { grid, guideOpen, programmeSearch, renderGuideGroups } from './guideui.js';
import { renderDetail } from './seriesui.js';
import { renderInfoStrip } from './infostrip.js';
import { setLocale } from './format.js';
import * as store from './config.js';
import { catalogueSearch, configured, refreshRows, renderAccountBox, renderSidebar, setupSection, showSetupSection, state, updateAddress } from './app.js';
import { renderAudio, renderSubtitles } from './tracksui.js';
import { renderNowSub } from './playing.js';
import { renderIdleHome } from './idlehome.js';

/**
 * The language changes mid-session without reloading the page.
 *
 * Three layers have to be refreshed: the texts written into the markup,
 * Intl's formatters, and the views painted from state. The third is handled
 * by the same calls that produce the views anyway, so the language needs no
 * painting route of its own — only the call.
 */
/** Intl's formatters for the language, the browser's region and the clock setting. */
export function applyLocale() {
  setEnglishRegion(store.browserEnglish());
  setLocale(localeTag(), { hourCycle: store.hourCycle(state.settings) });
}

export async function applyLanguage(lang) {
  await loadLanguage(lang);
  setLanguage(lang);
  applyLocale();
  applyStatic();
  catalogueSearch.render();
  renderSidebar();
  renderNowSub();
  renderDetail();
  renderInfoStrip();
  // The selector is rebuilt only when the list differs: clear it, so that
  // "No subtitles" is translated even when the tracks stay the same.
  const tracks = state.subtitles;
  const active = el.subs.value === 'off' || !el.subs.value ? null : Number(el.subs.value);
  state.subtitles = null;
  renderSubtitles(tracks, active);
  const audio = state.audioTracks;
  const playing = state.activeAudio?.number ?? null;
  state.audioTracks = null;
  renderAudio(audio, playing);
  // applyStatic has just written every data-i18n node, the dialog's title
  // and section note among them: both depend on where the dialog stands,
  // so they are set again from that.
  if (el.setup.open) {
    renderAccountBox();
    $('setup-title').textContent = t(configured() ? 'setup.title' : 'setup.title.connect');
    showSetupSection(setupSection);
  }
  // The guide's time axis, day buttons and Earlier menu are written once
  // and kept; the programme search's line says what it found in words.
  if (guideOpen) { renderGuideGroups(); grid.relayout(); grid.invalidate(); }
  programmeSearch.renderStatus();
  programmeSearch.list.refresh();
  // Before a connection there is no list to repaint, and refreshRows would
  // set off to fetch it from a server that does not exist yet.
  if (state.lib) await refreshRows({ keepScroll: true });
  // An idle player shows the welcome text, which comes from no paint routine.
  if (!state.playing && !el.overlay.hidden && !el.overlay.classList.contains('loading')) renderIdleOverlay();
  // The path in the tab's title is in the interface language as well.
  updateAddress();
}

/** The player's idle state: either a welcome or a prompt to pick a channel. */
// The overlay is the empty player's own page while it says so, and is
// painted as a page of the app then (.overlay.idle in player.css) rather
// than as a message over the picture. Watched rather than set in every one
// of the places that put another message there.
new MutationObserver(() => {
  const title = el.overlayTitle.textContent;
  el.overlay.classList.toggle('idle', title === t('player.idle') || title === t('setup.welcome'));
}).observe(el.overlayTitle, { childList: true, characterData: true, subtree: true });

export function renderIdleOverlay() {
  const welcome = !configured();
  el.overlayTitle.textContent = welcome ? t('setup.welcome') : t('player.idle');
  const home = welcome ? false : renderIdleHome();
  el.overlayText.textContent = welcome ? t('setup.welcome.text')
    : t(!home ? 'player.idle.text' : el.idleHome.querySelector('.idle-picks') ? 'player.idle.picks.text' : 'player.idle.home');
}
