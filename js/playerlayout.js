// A narrow window gives either browsing or playback the full width. Switching
// panes only changes layout; it never pauses or replaces the playing stream.
//
// With nothing playing the one pane is the list. The logo asks for the
// start page, which lives in the player's pane (showHome): it is shown
// there, with the switch for the way back to the list, until something
// plays or the list is asked for. On an upright phone the logo used to
// lead to the list it was pressed over, and the start page could not be
// reached at all. Where two panes show, the start page is in sight
// already and the request is not kept: kept, it came into force when the
// window was next made narrow (a phone turned upright), over the list the
// viewer had been using since.
//
// A cast session the page found on the device (the app for the iPhone and
// the iPad, loaded again while a Chromecast plays; js/castui.js) stands in
// the player's pane as something playing does: its words and Stop casting
// are there, so the pane is shown for it once and the switch stays while
// it lasts.
export class PlayerLayout {
  constructor(main, { browse, watch, list, video, closeGuide }) {
    Object.assign(this, { main, browse, watch, list, video, closeGuide });
    this.narrow = matchMedia('(max-width: 600px)');
    this.watching = false;
    this.home = false;
    browse.addEventListener('click', () => {
      closeGuide();
      this.showBrowse();
      list.focus({ preventScroll: true });
    });
    watch.addEventListener('click', () => {
      this.showPlayer();
      video.focus({ preventScroll: true });
    });
    this.narrow.addEventListener('change', () => {
      const focused = document.activeElement;
      if (!this.narrow.matches) this.home = false;
      this.render();
      if (focused !== document.body && !focused.getClientRects().length) {
        const target = this.narrow.matches && this.main.classList.contains('compact-watch') ? video : list;
        target.focus({ preventScroll: true });
      }
    });
  }

  update({ connected, playing, session = false }) {
    this.connected = connected;
    this.playing = playing;
    // Once, when a connected player first has the session: a tab or a
    // search after that asks for the list as ever.
    const found = Boolean(connected && session);
    if (found && !this.session) this.watching = true;
    this.session = found;
    if (playing) this.home = false;
    this.render();
  }

  showPlayer() {
    const fromList = this.list.contains(document.activeElement)
      || Boolean(document.activeElement.closest('.epg, .epgview'));
    this.watching = true;
    if (this.narrow.matches) this.closeGuide();
    this.render();
    if (this.narrow.matches && fromList) this.video.focus({ preventScroll: true });
  }

  showBrowse() {
    this.watching = false;
    this.home = false;
    this.render();
  }

  /** The start page, by the logo: what plays is stopped by the caller. */
  showHome() {
    this.watching = false;
    this.home = this.narrow.matches;
    this.render();
  }

  render() {
    // What the player's pane has to show: something playing, or a found session.
    const playing = this.playing || this.session;
    const home = this.connected && !playing && this.home;
    const watching = !this.connected || (playing && this.watching) || home;
    this.main.classList.toggle('has-library', Boolean(this.connected));
    this.main.classList.toggle('has-playback', Boolean(this.playing));
    // The switch between the two panes, where there is one pane.
    this.main.classList.toggle('has-panes', Boolean(playing || home));
    this.main.classList.toggle('compact-watch', Boolean(watching));
    this.browse.setAttribute('aria-pressed', String(!watching));
    this.watch.setAttribute('aria-pressed', String(Boolean(watching)));
    this.watch.disabled = !(playing || home);
  }
}
