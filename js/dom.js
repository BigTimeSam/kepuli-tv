// @ts-check
// The page's elements the player works with, looked up once. A module of
// its own, so that every part of the player can take them without a cycle
// through app.js: the guide builds its grid from them while the modules
// load, before app.js has run.

/** @param {string} id */
export const $ = (id) => document.getElementById(id);
export const el = {
  tabs: $('tabs'), search: /** @type {HTMLInputElement} */ ($('search')), groups: $('groups'), groupsCol: $('groups-col'),
  categoryFilter: /** @type {HTMLInputElement} */ ($('category-filter')), groupsFilter: /** @type {HTMLInputElement} */ ($('groups-filter')),
  list: $('list'), crumbs: $('crumbs'), detail: $('detail'),
  listinfo: $('listinfo'), main: $('main'),
  subcats: $('subcats'), subcatsGrip: $('subcats-grip'),
  video: /** @type {HTMLVideoElement} */ ($('video')), videowrap: $('videowrap'), subdisplay: $('subdisplay'),
  overlay: $('overlay'), overlayTitle: $('overlay-title'),
  overlayText: $('overlay-text'), overlayActions: $('overlay-actions'), statbadge: $('statbadge'),
  overlayLoad: $('overlay-load'), overlayBar: $('overlay-bar'), overlayBarFill: $('overlay-bar-fill'),
  overlayFigures: $('overlay-figures'), overlaySlow: $('overlay-slow'), overlayElapsed: $('overlay-elapsed'),
  overlaySpeed: $('overlay-speed'), overlayNeed: $('overlay-need'),
  idleHome: $('idle-home'),
  infostrip: $('infostrip'), nowTitle: $('now-title'), nowSub: $('now-sub'), mode: /** @type {HTMLSelectElement} */ ($('mode')),
  subs: /** @type {HTMLSelectElement} */ ($('subs')), audio: /** @type {HTMLSelectElement} */ ($('audio')), cast: $('btn-cast'),
  setup: /** @type {HTMLDialogElement} */ ($('setup')), setupTabs: $('setup-tabs'), setupNote: $('setup-note'), setupNoteText: $('setup-note-text'),
  sublook: $('btn-sublook'), sublookPop: $('sublook-pop'),
  more: $('btn-more'), morePop: $('more-pop'),
  listProgress: $('list-progress'),
  epg: /** @type {HTMLElement} */ ($('epg')), epgPreview: $('epg-preview'),
  lpTitle: $('lp-title'), lpFill: $('lp-fill'), lpText: $('lp-text'), lpPercent: $('lp-percent'),
  toast: $('toast'), toastText: $('toast-text'), toastLive: $('toast-live'),
};
