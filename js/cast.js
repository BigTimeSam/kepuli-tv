// Chromecast through the Remote Playback API.
//
// Two ways of getting the picture onto a Chromecast were assessed
// (CHROMECAST.md has the whole of it); this file is the first, and the second
// needs no code at all.
//
// 1. The Remote Playback API, video.remote.prompt(). On desktop Chrome this
//    is not URL flinging: Chrome opens a mirroring session to the device and
//    sends the element's compressed picture and sound as they are — nothing
//    is re-encoded, the server needs no CORS headers, and the container is
//    irrelevant, because Chrome does the demuxing. Blink accepts only an
//    http(s) source for it, so the route is open to the natively played
//    files (mp4, m4v, mov, webm) and closed to everything that goes through
//    MediaSource: mpegts.js, hls.js and the MKV unpacking.
//
// 2. Chrome's own "Cast tab" from the browser menu. A page cannot start it,
//    but once it runs Chrome switches from mirroring the screen to the same
//    compressed-stream remoting by itself, as soon as the video is the
//    dominant content — full screen, in practice — and its codecs suit the
//    device. That covers MediaSource too. For those routes the button's job
//    is to say so.
//
// The Google Cast SDK is not used: Manifest V3 forbids loading it from
// gstatic, and what it offers — the device fetching a URL by itself — would
// leave out MPEG-TS and Matroska altogether, and HLS unless the server sends
// CORS headers.

/** Whether the browser has the API at all. Firefox does not. */
export const supported = typeof HTMLMediaElement !== 'undefined' && 'remote' in HTMLMediaElement.prototype;

export class Cast {
  /**
   * @param {HTMLVideoElement} video
   * @param {() => void} onChange called whenever the state or the
   *   availability moves; never synchronously from the constructor
   */
  constructor(video, onChange) {
    this.video = video;
    this.onChange = onChange || (() => {});
    // null = unknown: the browser will not monitor, or no source the API
    // accepts has been loaded yet. false = monitored, nothing found.
    this.available = null;
    this.remote = supported ? video.remote : null;
    if (!this.remote) return;
    for (const type of ['connecting', 'connect', 'disconnect']) {
      this.remote.addEventListener(type, () => this.onChange());
    }
    this.watch();
  }

  /** 'connecting' | 'connected' | 'disconnected' — the last when unsupported. */
  get state() { return this.remote ? this.remote.state : 'disconnected'; }
  get connected() { return this.state === 'connected'; }
  get busy() { return this.state !== 'disconnected'; }

  /**
   * Availability monitoring. The callback fires once a source the API
   * accepts is loaded, with true when a device answers on the network. For a
   * MediaSource source it never fires, so the value is left as it was.
   */
  async watch() {
    try {
      await this.remote.watchAvailability((available) => {
        this.available = available;
        this.onChange();
      });
    } catch (err) {
      // NotSupportedError: the browser will not monitor in the background
      // (low-memory devices). The spec's advice is to show the button
      // regardless and let prompt() decide.
      console.info('[iptv] cast availability is not monitored:', err && err.message);
      this.available = null;
    }
  }

  /**
   * Opens Chrome's device picker — and, while casting, the same dialog with
   * the stop button in it.
   *
   * Must be called straight from a user gesture with no await in between,
   * like permissions.request: the gesture is spent by the first await.
   *
   * Resolves once the viewer has picked a device; the connection itself is
   * reported through the events. Rejects with a DOMException named
   * NotFoundError (no device on the network), NotSupportedError (this
   * source will not remote) or NotAllowedError (the picker was closed).
   */
  prompt() {
    if (!this.remote) return Promise.reject(new DOMException('Remote playback is not supported', 'NotSupportedError'));
    // The pre-flight checks throw synchronously; the rest arrives as a
    // rejection. One shape for the caller.
    try {
      return this.remote.prompt();
    } catch (err) {
      return Promise.reject(err);
    }
  }
}
