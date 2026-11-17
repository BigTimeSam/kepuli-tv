// A narrow window gives either browsing or playback the full width. Switching
// panes only changes layout; it never pauses or replaces the playing stream.
export class PlayerLayout {
  constructor(main, { browse, watch, list, video, closeGuide }) {
    Object.assign(this, { main, browse, watch, list, video, closeGuide });
    this.narrow = matchMedia('(max-width: 600px)');
    this.watching = false;
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
      this.render();
      if (focused !== document.body && !focused.getClientRects().length) {
        const target = this.narrow.matches && this.main.classList.contains('compact-watch') ? video : list;
        target.focus({ preventScroll: true });
      }
    });
  }

  /**
   * `session`: a cast session the page found on the device (the app, its
   * page loaded again while a Chromecast plays; js/castui.js). It stands
   * in the player's pane as something playing does: its words and Stop
   * casting are there, so the pane is shown for it once and the switch
   * stays while it lasts.
   */
  update({ connected, playing, session = false }) {
    this.connected = connected;
    this.playing = playing;
    // Once, when a connected player first has the session: a tab or a
    // search after that asks for the list as ever.
    const found = Boolean(connected && session);
    if (found && !this.session) this.watching = true;
    this.session = found;
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
    this.render();
  }

  render() {
    // What the player's pane has to show: something playing, or a found session.
    const playing = this.playing || this.session;
    const watching = !this.connected || (playing && this.watching);
    this.main.classList.toggle('has-library', Boolean(this.connected));
    this.main.classList.toggle('has-playback', Boolean(this.playing));
    // The switch between the two panes, where there is one pane.
    this.main.classList.toggle('has-panes', Boolean(playing));
    this.main.classList.toggle('compact-watch', Boolean(watching));
    this.browse.setAttribute('aria-pressed', String(!watching));
    this.watch.setAttribute('aria-pressed', String(Boolean(watching)));
    this.watch.disabled = !playing;
  }
}
