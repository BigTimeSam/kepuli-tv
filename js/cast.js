// Chromecast: through the Remote Playback API in a browser, and through
// Google's own sender in the apps: the iPhone's and the iPad's, and Android's
// on a phone or a tablet.
//
// Three ways of getting the picture onto a Chromecast were assessed
// (CHROMECAST.md has the whole of it). In a browser this file is the first,
// and the second needs no code at all.
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
// 3. The Google Cast SDK: the device is handed an address and fetches the
//    stream by itself. Not used in a browser: Manifest V3 forbids loading
//    the SDK from gstatic, and the device takes neither MPEG-TS nor
//    Matroska, and HLS only when the server sends CORS headers. In the app
//    (js/host.js) it is the only way there is: on the iPhone and the iPad
//    video.remote is AirPlay, Android's engine has no Remote Playback, and
//    nothing mirrors a tab. The app carries Google's sender, and
//    NativeCast below is its face on the page, in Cast's shape; castMedia
//    says what the device can be handed, and the session on the page is
//    js/castui.js.

import { native, on, request, send } from './host.js';

/**
 * Whether the browser can cast at all. Firefox has no API. The iPhone's
 * WebKit (Orion) has one, but for AirPlay alone: no Chromecast is reachable
 * from it, and its prompt() did nothing visible when pressed (2026-11-10).
 * AirPlay is in the iPhone's own player controls, in full screen. That
 * WebKit is the one with ManagedMediaSource and no MediaSource. The apps
 * cast through their own sender, on the iPhone and the iPad alike.
 */
const iosWebKit = typeof globalThis.MediaSource === 'undefined' && 'ManagedMediaSource' in globalThis;
export const supported = native || (typeof HTMLMediaElement !== 'undefined' && 'remote' in HTMLMediaElement.prototype && !iosWebKit);

/**
 * The way to a Chromecast where the page runs: the app's sender in the
 * app, the browser's Remote Playback anywhere else.
 * @param {HTMLVideoElement} video
 * @param {() => void} onChange
 */
export const createCast = (video, onChange) => (native ? new NativeCast(onChange) : new Cast(video, onChange));

export const HLS_TYPE = 'application/x-mpegURL';
const FILE_TYPES = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/mp4', webm: 'video/webm' };

/**
 * What a Chromecast can be handed of a stream, or null. The device fetches
 * the address by itself and plays what its own player knows: HLS, and the
 * files a browser plays natively. A Stalker link is a token for one use,
 * already spent here; a recording is a blob in this page; MPEG-TS,
 * Matroska and AVI the device does not take, which leaves out a channel
 * with no HLS address and the archive.
 * @param {{url: string, live?: boolean, hlsUrl?: string | null, ext?: string, relink?: unknown}} spec
 * @returns {{url: string, contentType: string, live: boolean, hls?: 'ts'} | null}
 */
export function castMedia(spec) {
  if (!spec || spec.relink) return null;
  let path;
  try {
    const url = new URL(spec.url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    path = url.pathname;
  } catch {
    return null;
  }
  if (spec.live && spec.hlsUrl) return { url: spec.hlsUrl, contentType: HLS_TYPE, live: true, hls: 'ts' };
  if (/\.m3u8$/i.test(path)) return { url: spec.url, contentType: HLS_TYPE, live: Boolean(spec.live) };
  const ext = String(spec.ext || /\.([a-z0-9]{2,4})$/i.exec(path)?.[1] || '').toLowerCase();
  return Object.hasOwn(FILE_TYPES, ext) ? { url: spec.url, contentType: FILE_TYPES[ext], live: false } : null;
}

/**
 * The app's Cast sender, in Cast's shape. The app says the session's state
 * and what the device plays (`cast.state`, `cast.media`); the page asks
 * for the app's own dialogs and hands over addresses.
 */
export class NativeCast {
  /** @param {() => void} onChange called on every word from the app; never from the constructor */
  constructor(onChange) {
    this.native = true;
    this.onChange = onChange || (() => {});
    /** @type {'disconnected' | 'connecting' | 'connected'} */
    this.state = 'disconnected';
    /** @type {string | null} the device's name */
    this.device = null;
    // Devices found on the network; -1 while the app has not looked, which
    // it does not before the viewer first asks to cast.
    this.devices = -1;
    /** @type {number | undefined} with 'disconnected': where the device had got to, seconds */
    this.position = undefined;
    // With 'disconnected': the session ended while the app could not hear
    // the device (the phone slept), so nothing is known of where it got to.
    this.stale = false;
    /**
     * `reason` with 'idle': finished, stopped, interrupted, error, or gone
     * (nothing is on the device any more after the app's sleep); null when
     * the device has not said, as before a session's first media.
     * @type {{state: string, reason: string | null, position: number, duration: number | null} | null}
     */
    this.media = null;
    // What the app said before the player was built is given inside on();
    // the player draws the state itself once it has started.
    let built = false;
    on('cast.state', (s) => {
      this.state = s.state;
      this.device = s.device ?? null;
      this.devices = s.devices ?? -1;
      this.position = s.position;
      this.stale = Boolean(s.stale);
      if (s.state === 'disconnected') this.media = null;
      if (built) this.onChange();
    });
    on('cast.media', (m) => {
      this.media = /** @type {any} */ (m);
      if (built) this.onChange();
    });
    built = true;
  }

  get connected() { return this.state === 'connected'; }
  get busy() { return this.state !== 'disconnected'; }
  /** true = a device answers, false = none found, null = not looked for yet. */
  get available() { return this.devices > 0 ? true : this.devices === 0 ? false : null; }
  /** Whether the device has something on: loading, playing or paused. */
  get showing() { return Boolean(this.media && this.media.state !== 'idle'); }

  /** Google's own dialog: the devices, or the session while there is one. */
  prompt() { send('cast.prompt'); return Promise.resolve(); }
  /**
   * Hands the device an address; settles once the device has taken or
   * refused it. Twice the usual wait: the device fetches before it answers.
   * @param {object} media castMedia's answer with startAt, title, subtitle and image
   */
  load(media) { return request('cast.load', media, 20000); }
  /** The device stops what it shows; the session stays. */
  stop() { send('cast.stop'); }
  /** The session ends. */
  end() { send('cast.end'); }
  /** Google's own remote control: seeking, tracks and volume. */
  controls() { send('cast.controls'); }
}

export class Cast {
  /**
   * @param {HTMLVideoElement} video
   * @param {() => void} onChange called whenever the state or the
   *   availability moves; never synchronously from the constructor
   */
  constructor(video, onChange) {
    this.native = false;
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
  /** The device shows the picture: with Remote Playback, whenever it is connected. */
  get showing() { return this.connected; }

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
