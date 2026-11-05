// The tracks while watching: the subtitle and audio selectors, the
// languages they remember, the subtitles' look and size, the picture's
// size, and leaving playback for the empty player.
//
// Moved out of app.js. It takes the player's state and helpers from app.js
// (a cycle that ES modules resolve: what runs while the modules load here
// uses only js/dom.js; everything else waits until the player calls in).

import { $, el } from './dom.js';
import { DEFAULT_LIFT, DEFAULT_SCALE, stepScale, subtitleLook } from './subdisplay.js';
import { label as audioLabel } from './audio.js';
import { closeGuide, grid, guideOpen } from './guideui.js';
import { duration, wholePercent } from './format.js';
import { t } from './i18n.js';
import { newPlayRun, playback, renderNowLogo, renderNowSub, showOverlayActions } from './playing.js';
import { rememberSubtitleLanguage, toggleMoreMenu } from './playercontrols.js';
import { renderIdleOverlay } from './languageui.js';
import { renderInfoStrip } from './infostrip.js';
import { shortLanguage } from './lang.js';
import { homeGroup } from './name.js';
import { toast } from './toast.js';
import * as store from './config.js';
import { activateTab, browserTags, chosenCountries, mediaFilters, playerLayout, renderSidebar, selectGroup, state, updateAddress, updatePlayerLayout, visibleGroups, vlist } from './app.js';
import { cancelAutoNext, renderStatBadge } from './nextepisode.js';

/**
 * The subtitle selector. The list comes from the demuxer as soon as the file
 * header has been read, and the same call returns when the track changes —
 * including when the change was made from the browser's own subtitle menu.
 *
 * @param {object[]} tracks the tracks, empty when the file has no subtitles
 * @param {number|null} active the number of the visible track
 */
export function renderSubtitles(tracks, active) {
  const list = tracks || [];
  const select = el.subs;
  // The same list arrives again when only the selection changed: the menu
  // is not rebuilt needlessly under the viewer's nose.
  if (list !== state.subtitles) {
    state.subtitles = list;
    select.hidden = !list.length;
    el.sublook.hidden = !list.length;
    if (!list.length) toggleSubtitleLook(false);
    const options = [];
    if (list.length) {
      const off = document.createElement('option');
      off.value = 'off';
      off.textContent = t('player.subs.off');
      options.push(off);
    }
    for (const track of list) {
      const option = document.createElement('option');
      option.value = String(track.number);
      option.textContent = track.label;
      option.title = `${track.language} (${track.format})`;
      options.push(option);
    }
    select.replaceChildren(...options);
  }
  select.value = active == null ? 'off' : String(active);
}

/* ---------------------------------------------------------- audio track */

/**
 * The audio selector. Shown only when there is a choice to make: one track
 * is not a decision, and a file with nothing playable has no selector
 * either — the details say what it holds instead.
 *
 * The name is built here rather than in the engine, so that a change of
 * interface language relabels the tracks without touching playback.
 *
 * @param {object[]} tracks the playable audio tracks, in the file's order
 * @param {number|null} active the number of the track in play
 */
export function renderAudio(tracks, active) {
  const list = tracks || [];
  state.activeAudio = list.find((track) => track.number === active) || null;
  const select = el.audio;
  if (list !== state.audioTracks) {
    state.audioTracks = list;
    select.hidden = list.length < 2;
    select.replaceChildren(...list.map((track) => {
      const option = document.createElement('option');
      option.value = String(track.number);
      option.textContent = audioLabel(track);
      option.title = `${track.language} (${track.codec || '?'})`;
      return option;
    }));
  }
  if (active != null) select.value = String(active);
}

/** The viewer's choice from the selector: play the track, keep the language. */
export function chooseAudio() {
  const number = Number(el.audio.value);
  playback.selectAudio(number);
  rememberAudioLanguage(number);
}

/**
 * The a key steps to the next track. The eye is on the picture rather than
 * on the selector then, so the name is said out loud.
 */
export function cycleAudio() {
  const list = state.audioTracks;
  if (list.length < 2) return;
  const at = list.findIndex((track) => String(track.number) === el.audio.value);
  const next = list[(at + 1) % list.length];
  el.audio.value = String(next.number);
  chooseAudio();
  toast(audioLabel(next));
}

/**
 * The language is kept for the coming episodes, as it is for the
 * subtitles. A track whose language the file does not state answers no
 * choice in the next file, so the setting is left as it was.
 */
async function rememberAudioLanguage(number) {
  const track = state.audioTracks.find((t) => t.number === number);
  if (!track) return;
  const language = shortLanguage(track.language);
  if (language === 'und' || state.settings.audioLang === language) return;
  state.settings = await store.saveSettings({ audioLang: language });
}

/** The viewer's choice from the selector: show the track, keep the language. */
export function chooseSubtitle() {
  const value = el.subs.value;
  const number = value === 'off' ? null : Number(value);
  playback.selectSubtitle(number);
  rememberSubtitleLanguage(number);
}

/**
 * The look of the subtitles — the style and the size. The CSS reads both
 * from the body attributes (see player.css), and the settings dialog shows
 * the same choice, preview included.
 */
// The same two controls exist twice: in the settings, where a preview
// stands in for the picture, and over the picture itself under the
// player's Aa button. The dialog renders its draft in a separate preview.
const LOOK_FORMS = ['f', 'p'];

/** A size as the slider says it: 100 % is the size the picture asks for. */
const sizeText = (scale) => wholePercent(scale / 100);

/** One form's size and height controls: the sliders, what they say, and the ways back to the defaults. */
export function showSubtitleSize(form, look) {
  $(`${form}-subsize`).value = String(look.scale);
  $(`${form}-subsize-value`).textContent = sizeText(look.scale);
  $(`${form}-subsize-reset`).hidden = look.scale === DEFAULT_SCALE;
  $(`${form}-sublift`).value = String(look.lift);
  $(`${form}-sublift-value`).textContent = sizeText(look.lift);
  $(`${form}-sublift-reset`).hidden = look.lift === DEFAULT_LIFT;
}

/** The look as one form's controls hold it. */
export const lookOf = (form) => ({ subtitleStyle: $(`${form}-substyle`).value, subtitleScale: Number($(`${form}-subsize`).value), subtitleLift: Number($(`${form}-sublift`).value) });

export function applySubtitleLook(settings) {
  const look = subtitleLook(settings);
  document.body.dataset.substyle = look.style;
  document.body.style.setProperty('--sub-scale', String(look.scale / 100));
  document.body.style.setProperty('--sub-lift', String(look.lift / 100));
  for (const form of LOOK_FORMS) {
    $(`${form}-substyle`).value = look.style;
    showSubtitleSize(form, look);
  }
}

/**
 * The player's Aa adjustment applies immediately. Dialog adjustments
 * use previewSetupLook and wait for Save.
 */
export async function chooseSubtitleLook(form) {
  const patch = lookOf(form);
  applySubtitleLook(patch);
  state.settings = await store.saveSettings(patch);
}

/**
 * What is on the picture let go of, and the empty player's page in its
 * place: the paused film's place kept for Continue watching, the details,
 * the title and the address cleared.
 */
/**
 * The picture's own shape, once the video knows it: the box is then as
 * tall as the picture and no taller, rather than black bands above and
 * below it, and the details under it get the room (.videowrap.sized in
 * player.css). Back to filling the column when nothing plays.
 */
export function sizePicture() {
  const { videoWidth: w, videoHeight: h } = el.video;
  el.videowrap.classList.toggle('sized', Boolean(state.playing));
  // Until the picture says its shape — while connecting, between two
  // channels — the box keeps the last shape, or television's, so that it
  // does not fill the column for a moment and then jump.
  if (state.playing && w > 0 && h > 0) el.videowrap.style.setProperty('--pic-ratio', `${w} / ${h}`);
  else if (!el.videowrap.style.getPropertyValue('--pic-ratio')) el.videowrap.style.setProperty('--pic-ratio', '16 / 9');
}
el.video.addEventListener('loadedmetadata', sizePicture);
el.video.addEventListener('resize', sizePicture);
el.video.addEventListener('emptied', sizePicture);

export function leavePlayback() {
  const item = state.playing;
  if (item && item.k !== 0 && state.settings.resumeEnabled) {
    const { currentTime, duration: total } = el.video;
    if (Number.isFinite(total) && total > 0 && currentTime >= 20 && currentTime < total * 0.96) {
      const key = `${item.k}:${item.id}`;
      state.resume.set(key, { position: currentTime, duration: total, at: Date.now() });
      store.setResume(key, state.resume.get(key));
    }
  }
  cancelAutoNext();
  newPlayRun();
  playback.stop();
  state.playing = null;
  sizePicture();
  state.playingSpec = null;
  state.catchup = null;
  state.playbackInfoLoading = false;
  state.subtitleInfo = null;
  renderSubtitles([], null);
  renderAudio([], null);
  $('btn-live').hidden = true;
  el.nowTitle.textContent = '';
  el.nowTitle.removeAttribute('title');
  renderNowLogo(null);
  renderNowSub();
  renderInfoStrip();
  renderStatBadge();
  if (guideOpen) grid.setPlaying(null);
  el.overlay.hidden = false;
  el.overlay.classList.remove('loading');
  showOverlayActions(null);
  renderIdleOverlay();
  updatePlayerLayout();
  updateAddress();
  vlist.refresh();
}

/**
 * The logo: back to the start. The channels, the first country chosen (or
 * the one the channels were last on, when none is), its first topic and
 * the top of its list; the search, the filters, the guide and any page
 * opened from the list are cleared — and what is playing stops, for the
 * empty player's page: the picks, what was left halfway and the channels
 * watched last. A home button that left the film running led nowhere the
 * eye could see, the start page showing only when nothing plays. Nothing
 * is lost by it: a film's place is kept and heads Continue watching, a
 * channel is the first of the start page's History, each a click from playing again,
 * and the account's one connection is let go at once.
 */
export async function goHome() {
  if (guideOpen) closeGuide();
  playerLayout.showBrowse();
  if (state.playing) leavePlayback();
  mediaFilters.resetAll();
  state.categoryFilter = '';
  el.categoryFilter.value = '';
  const groups = visibleGroups('live');
  const group = chosenCountries() ? groups[0]?.name
    : (groups.some((g) => g.name === state.lastGroup.live) ? state.lastGroup.live : homeGroup(groups, browserTags())) ?? null;
  if (state.tab !== 'live') await activateTab('live');
  if (state.group !== group || state.sub || state.detail || state.query) await selectGroup(group);
  else renderSidebar();
  state.cursor = -1;
  el.list.scrollTop = 0;
}

/** + and − while watching: a step larger or smaller, said in a message. */
export async function stepSubtitleSize(direction) {
  const look = subtitleLook(state.settings);
  const scale = stepScale(look.scale, direction);
  if (scale === look.scale) return;
  applySubtitleLook({ subtitleStyle: look.style, subtitleScale: scale, subtitleLift: look.lift });
  toast(t('subs.size.now', { size: sizeText(scale) }));
  state.settings = await store.saveSettings({ subtitleScale: scale });
}

/**
 * The look over the picture. Opened from the player's row, closed by a
 * click outside it, by Esc, or by the button again — the same ways the
 * settings dialog closes.
 */
export function toggleSubtitleLook(open) {
  const show = open ?? el.sublookPop.hidden;
  if (show) toggleMoreMenu(false);
  el.sublookPop.hidden = !show;
  el.sublook.setAttribute('aria-expanded', String(show));
  // The subtitles rise out of its way, as they do for the browser's own
  // controls: a popover that covered the text it is there to size would be
  // no use at all.
  el.videowrap.classList.toggle('looking', show);
  if (show) $('p-substyle').focus();
}
