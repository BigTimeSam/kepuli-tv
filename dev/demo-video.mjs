#!/usr/bin/env node
// The demo video: the player's features in about three minutes, for YouTube.
//
// Like dev/store-screenshots.mjs it runs the extension against the mock
// Xtream server (dev/mock/server.mjs), so every channel, title and picture
// in it is invented. It drives a headless Chrome scene by scene, draws a
// pointer and a caption into the page (headless Chrome has no pointer of
// its own), records the screen over the DevTools protocol and hands the
// frames to ffmpeg at a steady 30 per second.
//
//   sh dev/mock/media.sh                 once: renders the dummy media
//   node dev/demo-video.mjs [--lang en]
//
// Writes dist/video/kepuli-tv-demo-<lang>.mp4 (1920x1080, H.264, silent),
// a thumbnail beside it, -chapters.txt: the scenes' start times in the
// form YouTube reads chapters from a description, and .srt: the captions
// as a subtitle track to upload with the video. The captions are in
// CAPTIONS below, one set per language; the app is shown in the same
// language.

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LANG = process.argv.includes('--lang') ? process.argv[process.argv.indexOf('--lang') + 1] : 'en';
const OUT = join(ROOT, 'dist', 'video');
const FPS = 30;
const WIDTH = 1280, HEIGHT = 720, SCALE = 1.5;      // 1920x1080 frames
const METRICS = { width: WIDTH, height: HEIGHT, deviceScaleFactor: SCALE, mobile: false, screenWidth: WIDTH, screenHeight: HEIGHT };
// The server the viewer sees in Settings: a reserved example name, mapped
// to the mock server by Chrome, rather than 127.0.0.1.
const HOST = 'iptv.example.com', MOCK_PORT = 8080;

// A Chrome of its own: a fresh profile and another port, so that the
// development Chrome and its settings are left alone.
const PROFILE = mkdtempSync(join(tmpdir(), 'kepuli-video-'));
process.env.KEPULI_DEV_PROFILE = PROFILE;
process.env.KEPULI_DEV_PORT = process.env.KEPULI_VIDEO_PORT || '9370';
const { ensureChrome, openPlayer, sleep } = await import('./screenshot.mjs');
const { startMockServer, USER, PASS } = await import('./mock/server.mjs');

/* ------------------------------------------------------------- captions */

const CAPTIONS = {
  en: {
    intro: ['Kepuli-TV', 'An IPTV player for Chrome and Firefox', 'Free and open source · Bring your own Xtream Codes or M3U subscription'],
    connect: ['Your own service', 'Sign in with your provider’s Xtream Codes details, or paste an M3U playlist. Your details stay in your browser.'],
    live: ['Live TV by country and topic', 'Pick a country, narrow it to a topic, and see what is on now on every channel.'],
    zap: ['Zap in a second', 'Arrow keys move, Enter plays, and L jumps back to the channel you watched before.'],
    favourites: ['Favourites', 'Add a channel from its ⋯ menu. Favourites gather at the top of every list.'],
    countries: ['The countries you watch', 'Keep only the countries you want. The rest stay out of the lists, the search and the guide.'],
    guide: ['Programme guide', 'A full guide for every channel. Click a channel to see what is on now and the next ten programmes.'],
    search: ['Search', 'Press / and start typing. Any channel in seconds, even among tens of thousands.'],
    movies: ['Movies', 'Covers, ratings and details. Filter by genre, sort by rating, and play in the same window.'],
    series: ['Series', 'Seasons and episodes at a glance, with the plot, the year and the rating.'],
    mkv: ['MKV with subtitles', 'Matroska files play right in the browser, with their subtitles and every audio track, even AC-3.'],
    subsize: ['Subtitles your size', 'Set the size and the height of the subtitles. + and − change the size while you watch.'],
    more: ['And more', 'Picture-in-picture, Chromecast, or hand the stream to an external player such as VLC.'],
    fullscreen: ['Full screen', 'Full screen from the button, the F key or a double click. Subtitles scale with the picture.'],
    history: ['Pick up where you left off', 'Films and episodes resume where you stopped, and History keeps them one click away.'],
    keys: ['Made for the keyboard', 'Press ? for the shortcuts. Everything works without a mouse too.'],
    theme: ['Dark or light', 'A dark and a light theme, or follow your system.'],
    languages: ['Thirteen languages', 'English, Finnish, Swedish, Norwegian, Danish, German, Dutch, French, Spanish, Portuguese, Italian, Polish and Turkish.'],
    outro: ['Kepuli-TV', 'Free on the Chrome Web Store and Firefox Add-ons', 'github.com/BigTimeSam/kepuli-tv'],
    disclaimer: 'Kepuli-TV contains no channels or content. You need your own IPTV subscription. Everything shown here is fictional demo content.',
    chapters: {
      intro: 'Introduction', connect: 'Connect your service', live: 'Live TV', zap: 'Switching channels', favourites: 'Favourites',
      countries: 'Choose your countries', guide: 'Programme guide', search: 'Search', movies: 'Movies', series: 'Series',
      mkv: 'MKV and subtitles', more: 'Picture-in-picture and Chromecast', fullscreen: 'Full screen', history: 'Resume and history',
      keys: 'Keyboard shortcuts', subsize: 'Subtitle size and height', theme: 'Dark and light theme', languages: 'Languages', outro: 'Get Kepuli-TV',
    },
    otherLanguage: 'Deutsch',
  },
};
const C = CAPTIONS[LANG];
if (!C) throw new Error(`no captions for ${LANG}; add them to CAPTIONS`);

/* ------------------------------------------------------------ DevTools */

/** One DevTools connection with events, which dev/screenshot.mjs's has not. */
function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map(), handlers = new Map();
  let next = 1;
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.method) { for (const fn of handlers.get(data.method) || []) fn(data.params); return; }
    const p = pending.get(data.id);
    if (!p) return;
    pending.delete(data.id);
    data.error ? p.reject(new Error(`${p.method}: ${data.error.message}`)) : p.resolve(data.result);
  };
  const open = new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = () => fail(new Error('DevTools connection failed')); });
  return {
    async call(method, params = {}) {
      await open;
      const id = next++;
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise((ok, fail) => pending.set(id, { method, resolve: ok, reject: fail }));
    },
    on(method, fn) { handlers.set(method, [...(handlers.get(method) || []), fn]); },
    close: () => ws.close(),
  };
}

let page;

async function evaluate(expression, { gesture = false } = {}) {
  const { result, exceptionDetails } = await page.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: gesture });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
  return result.value;
}

async function waitFor(expression, what, timeout = 20000) {
  const t0 = Date.now();
  for (;;) {
    let value = false;
    try { value = await evaluate(expression); } catch { /* mid-reload */ }
    if (value) return value;
    if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for ${what}`);
    await sleep(150);
  }
}

/* -------------------------------------------------------------- recorder */

/**
 * The screencast to ffmpeg. Chrome sends a frame when the picture changes,
 * stamped with its time; each is written as often as the 30-per-second
 * clock passes while it is the latest, so a still picture holds for as long
 * as it was on screen and the video runs at the speed the walk did.
 */
class Recorder {
  constructor(out) {
    this.ffmpeg = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(FPS), '-i', '-',
      '-vf', `scale=${WIDTH * SCALE}:${HEIGHT * SCALE}:flags=lanczos,format=yuv420p`,
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-tune', 'animation', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
    this.done = new Promise((ok, fail) => this.ffmpeg.on('close', (code) => code === 0 ? ok() : fail(new Error(`ffmpeg exited with ${code}`))));
    this.last = null; this.t0 = null; this.wall0 = null; this.written = 0;
    page.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
      page.call('Page.screencastFrameAck', { sessionId }).catch(() => {});
      if (this.stopped || this.stills) return;
      if (this.t0 === null) { this.t0 = metadata.timestamp; this.wall0 = Date.now() / 1000; }
      else this.fill(metadata.timestamp);
      this.last = Buffer.from(data, 'base64');
    });
  }

  fill(t) {
    const due = Math.floor((t - this.t0) * FPS);
    while (this.written < due && this.last) { this.ffmpeg.stdin.write(this.last); this.written++; }
  }

  /**
   * In full screen the screencast sends the top left two thirds of the
   * picture blown up — the scale factor applied twice — and goes on doing
   * so after it, restarted or not, while a screenshot comes out right. So
   * full screen is the last scene, and from it to the end the frames are
   * screenshots, about a dozen a second: plenty for a player and a card.
   */
  screenshots() {
    this.stills = true;
    this.stillsDone = (async () => {
      while (this.stills) {
        const { data } = await page.call('Page.captureScreenshot', { format: 'jpeg', quality: 92 });
        this.fill(this.t0 + this.now());
        this.last = Buffer.from(data, 'base64');
      }
    })();
  }

  /** Seconds since the first frame. */
  now() { return this.wall0 === null ? 0 : Date.now() / 1000 - this.wall0; }

  async start() {
    this.params = { format: 'jpeg', quality: 92, maxWidth: WIDTH * SCALE, maxHeight: HEIGHT * SCALE, everyNthFrame: 1 };
    await page.call('Page.startScreencast', this.params);
    for (let i = 0; i < 50 && this.t0 === null; i++) await sleep(100);
  }

  async stop() {
    this.stills = false;
    await this.stillsDone;
    this.fill(this.t0 + this.now());
    this.stopped = true;
    await page.call('Page.stopScreencast');
    this.ffmpeg.stdin.end();
    await this.done;
  }
}

/* -------------------------------------------------- pointer and captions */

// The layer is a manual popover, so that it sits in the top layer over the
// dialogs, popovers and the full screen video; raise() puts it back on top
// after any of them opened.
const LAYER = `(() => {
  if (window.demo) return;
  const layer = document.createElement('div');
  layer.setAttribute('popover', 'manual');
  layer.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;max-width:none;max-height:none;margin:0;padding:0;border:0;background:transparent;overflow:hidden;pointer-events:none;color:#fff;font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;';
  layer.innerHTML = \`
    <style>
      .demo-cursor { position:absolute; left:0; top:0; width:26px; height:26px; transform:translate(-100px,-100px); filter:drop-shadow(0 2px 3px rgba(0,0,0,.45)); }
      .demo-ripple { position:absolute; width:36px; height:36px; margin:-18px 0 0 -18px; border-radius:50%; border:2px solid #9b87ff; background:rgba(124,92,255,.25); animation:demo-ripple .5s ease-out forwards; }
      @keyframes demo-ripple { from { transform:scale(.3); opacity:1; } to { transform:scale(1.4); opacity:0; } }
      .demo-caption { position:absolute; left:50%; bottom:26px; transform:translate(-50%, 12px); opacity:0; transition:opacity .45s ease, transform .45s ease;
        width:max-content; max-width:min(860px, calc(100vw - 80px)); box-sizing:border-box; padding:14px 24px 16px; border-radius:16px; background:rgba(12,12,22,.86);
        border:1px solid rgba(155,135,255,.35); box-shadow:0 12px 40px rgba(0,0,0,.45); backdrop-filter:blur(10px); text-align:center; }
      .demo-caption.top { bottom:auto; top:70px; transform:translate(-50%, -12px); }
      .demo-caption.right { left:73.6%; max-width:600px; }
      .demo-caption.left { left:23.5%; max-width:560px; }
      .demo-caption.on { opacity:1; transform:translate(-50%, 0); }
      .demo-caption b { display:block; font-size:24px; font-weight:700; letter-spacing:-.01em; }
      .demo-caption span { display:block; margin-top:5px; font-size:16.5px; line-height:1.4; color:#d6d3ff; }
      .demo-card { position:absolute; inset:0; display:grid; place-content:center; justify-items:center; gap:14px; text-align:center; opacity:0; transition:opacity .7s ease;
        background:radial-gradient(1200px 600px at 50% 35%, #2a1f5c 0%, #12101f 55%, #0a0a12 100%); }
      .demo-card.on { opacity:1; }
      .demo-card img { width:120px; height:120px; filter:drop-shadow(0 10px 30px rgba(124,92,255,.5)); }
      .demo-card h1 { margin:6px 0 0; font-size:64px; font-weight:800; letter-spacing:-.02em; }
      .demo-card p { margin:0; font-size:26px; color:#d6d3ff; }
      .demo-card small { margin-top:10px; font-size:17px; color:#a9a6c9; }
      .demo-card .fine { position:absolute; left:0; right:0; bottom:28px; font-size:13.5px; color:#8c89a8; }
    </style>
    <div class="demo-card"><img src="icons/icon128.png" alt=""><h1></h1><p></p><small></small><div class="fine"></div></div>
    <div class="demo-caption"><b></b><span></span></div>
    <svg class="demo-cursor" viewBox="0 0 24 24"><path d="M4 2.5v17.2l4.6-4.4 3 6.6 3-1.4-3-6.4h6.3z" fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/></svg>\`;
  document.body.append(layer);
  const $ = (s) => layer.querySelector(s);
  let x = -100, y = -100;
  window.demo = {
    raise() { if (layer.matches(':popover-open')) layer.hidePopover(); layer.showPopover(); },
    move(tx, ty, ms) {
      $('.demo-cursor').animate([{ transform: \`translate(\${x}px,\${y}px)\` }, { transform: \`translate(\${tx}px,\${ty}px)\` }],
        { duration: ms, easing: 'cubic-bezier(.45,0,.2,1)', fill: 'forwards' });
      x = tx; y = ty;
    },
    ripple() { const r = document.createElement('div'); r.className = 'demo-ripple'; r.style.left = x + 'px'; r.style.top = y + 'px'; layer.append(r); setTimeout(() => r.remove(), 600); },
    caption(title, text, where, linger) {
      const c = $('.demo-caption');
      clearTimeout(this.lingering);
      if (!title) { c.classList.remove('on'); return; }
      const show = () => {
        c.querySelector('b').textContent = title; c.querySelector('span').textContent = text;
        c.classList.remove('top', 'left', 'right'); if (where !== 'bottom') c.classList.add(where);
        c.classList.add('on');
        if (linger) this.lingering = setTimeout(() => c.classList.remove('on'), linger);
      };
      // A caption in another place fades out first rather than jumping.
      if (c.classList.contains('on') && this.where !== where) { c.classList.remove('on'); setTimeout(show, 450); } else show();
      this.where = where;
    },
    card(title, line, small, fine) {
      const c = $('.demo-card');
      if (!title) { c.classList.remove('on'); return; }
      c.querySelector('h1').textContent = title; c.querySelector('p').textContent = line;
      c.querySelector('small').textContent = small || ''; c.querySelector('.fine').textContent = fine || '';
      c.classList.add('on');
    },
  };
  window.demo.raise();
})()`;

const raise = () => evaluate(`window.demo.raise()`);
let px = WIDTH * 0.7, py = HEIGHT * 0.6;
const ease = (t) => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

/** Glides the pointer to x, y; the page sees the moves on the way, so hovers happen. */
async function move(x, y, ms = 650) {
  await raise();
  await evaluate(`window.demo.move(${x}, ${y}, ${ms})`);
  const sx = px, sy = py, steps = Math.max(4, Math.round(ms / 40));
  for (let i = 1; i <= steps; i++) {
    const k = ease(i / steps);
    await page.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: sx + (x - sx) * k, y: sy + (y - sy) * k });
    await sleep(ms / steps);
  }
  px = x; py = y;
}

/** The centre of the element an expression finds, scrolled into view first. */
async function centre(find, what = find, timeout = 10000) {
  return waitFor(`(() => { const e = ${find}; if (!e) return null; e.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const r = e.getBoundingClientRect(); return r.width && r.height ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; })()`, what, timeout);
}

async function click(find, { pause = 350, double = false } = {}) {
  const { x, y } = await centre(find);
  await move(x, y);
  await sleep(120);
  await evaluate(`window.demo.ripple()`);
  for (const clickCount of double ? [1, 2] : [1]) {
    await page.call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount });
    await page.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount });
  }
  await sleep(pause);
  await raise();
}

const KEYS = { ArrowDown: 40, ArrowUp: 38, ArrowRight: 39, Enter: 13, Escape: 27, '/': 191, '?': 191, '+': 187, l: 76, f: 70 };
async function key(k, { pause = 450 } = {}) {
  const printable = k.length === 1;
  const params = { key: k, code: k === '?' || k === '/' ? 'Slash' : k.length === 1 ? `Key${k.toUpperCase()}` : k, windowsVirtualKeyCode: KEYS[k], modifiers: k === '?' ? 8 : 0 };
  await page.call('Input.dispatchKeyEvent', { type: 'keyDown', ...params, ...(printable ? { text: k } : {}) });
  await page.call('Input.dispatchKeyEvent', { type: 'keyUp', ...params });
  await sleep(pause);
  await raise();
}

async function type(text, per = 110) {
  for (const ch of text) { await page.call('Input.insertText', { text: ch }); await sleep(per); }
}

/**
 * The element under root whose own text — its text nodes, not its
 * children's — is `text`, or starts with it: a chip's label sits beside the
 * count's span, a row's name in a leaf of its own.
 */
const byText = (root, text) => `(() => {
  const own = (n) => [...n.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent).join('').trim();
  const nodes = [...document.querySelectorAll(${JSON.stringify(root + ' *')})].filter((n) => n.offsetParent !== null || n.closest('[popover]'));
  return nodes.find((n) => own(n) === ${JSON.stringify(text)}) || nodes.find((n) => own(n).startsWith(${JSON.stringify(text)})); })()`;

const PLAYING = `(() => { const v = document.getElementById('video'); return v.readyState >= 2 && v.currentTime > 0.3 && !v.paused; })()`;
const ROWS = `document.querySelectorAll('#list .row').length > 0 && document.getElementById('list-progress').hidden`;

/* ---------------------------------------------------------------- scenes */

const chapters = [];
let recorder;

/**
 * A scene's caption. `where` keeps it off what the scene shows: bottom,
 * top, or left or right — over the lists, or over the player. A caption
 * that would cover a dialog lingers a few seconds before the dialog opens
 * and then goes.
 */
async function scene(id, where = 'bottom', linger = 0) {
  chapters.push({ id, at: recorder.now() });
  await say(id, where, linger);
  console.log(`${recorder.now().toFixed(1).padStart(6)} s  ${id}`);
}
async function say(id, where = 'bottom', linger = 0) {
  cue(C[id].slice(0, 2), linger);
  await evaluate(`window.demo.caption(${JSON.stringify(C[id][0])}, ${JSON.stringify(C[id][1])}, ${JSON.stringify(where)}, ${linger})`);
}
async function hide() {
  cue(null);
  await evaluate(`window.demo.caption(null)`);
}

/**
 * The captions again as a subtitle track, for YouTube: searchable, read
 * by screen readers, and translated by YouTube into the viewer's language.
 * A cue lasts until the next one, the caption is hidden, or it lingers out.
 */
const cues = [];
function cue(lines, linger = 0, at = recorder.now()) {
  const open = cues[cues.length - 1];
  if (open && open.end > at) open.end = at;
  if (lines) cues.push({ start: at, end: linger ? at + linger / 1000 : Infinity, lines: lines.filter(Boolean) });
}
const srtTime = (t) => {
  const ms = Math.round(t * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
};
const srt = (end) => cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(Math.min(c.end, end))}\n${c.lines.join('\n')}\n`).join('\n');

async function walk() {
  // Intro.
  chapters.push({ id: 'intro', at: 0 });
  cue(C.intro, 0, 0);
  await sleep(4500);
  await evaluate(`window.demo.card(null)`);
  cue(null);
  await sleep(900);

  // Connecting: the form as a new viewer fills it.
  await scene('connect');
  await click(`document.getElementById('btn-settings')`, { pause: 700 });
  await click(`document.getElementById('tab-connection')`, { pause: 500 });
  const { x: hx, y: hy } = await centre(`document.getElementById('f-host')`);
  await move(hx, hy, 800);
  await sleep(1200);
  const { x: ux, y: uy } = await centre(`document.getElementById('f-username')`);
  await move(ux, uy, 600);
  await sleep(2200);
  await click(`document.getElementById('f-close')`, { pause: 600 });

  // Live TV.
  await scene('live', 'right');
  await click(byText('#groups', 'Finland'));
  await waitFor(ROWS, 'the channel list');
  await sleep(1000);
  await click(byText('#subcats', 'Sport'), { pause: 1100 });
  await click(byText('#subcats', 'All'), { pause: 700 });
  await click(byText('#list', 'Aurora One'));
  await waitFor(PLAYING, 'the live stream');
  await move(WIDTH * 0.74, HEIGHT * 0.86, 700);
  await sleep(3000);

  // Zapping from the keyboard.
  await scene('zap', 'right');
  await evaluate(`document.getElementById('list').focus()`);
  await move(WIDTH * 0.74, HEIGHT * 0.3, 500);
  await key('ArrowUp', { pause: 500 });
  await key('ArrowUp', { pause: 500 });
  await key('Enter', { pause: 2200 });
  await key('l', { pause: 2600 });

  // Favourites from the row's menu.
  await scene('favourites', 'right');
  const row = `[...document.querySelectorAll('#list .row')].find((r) => r.textContent.includes('Aurora Cinema Nordic'))`;
  const { x: rx, y: ry } = await centre(row);
  await move(rx, ry, 700);
  await sleep(400);
  await click(`${row}.querySelector('.row-more')`, { pause: 700 });
  await click(byText('.row-menu', 'Add to favourites'), { pause: 1000 });
  await click(`document.getElementById('fav-strip-toggle')`, { pause: 2500 });
  await click(`document.getElementById('fav-strip-toggle')`, { pause: 600 });

  // Countries.
  await scene('countries', 'bottom', 3400);
  await sleep(2600);
  await click(`document.getElementById('btn-countries')`, { pause: 900 });
  for (const name of ['Finland', 'Sweden', 'Norway']) {
    await click(`document.querySelector('#countries-list .choice-row[data-name="${name}"] input')`, { pause: 450 });
  }
  await sleep(900);
  await click(`document.getElementById('countries-save')`, { pause: 2500 });

  // The guide.
  await scene('guide', 'bottom', 5200);
  await click(`document.getElementById('btn-guide')`);
  await waitFor(`document.getElementById('main').classList.contains('guide') && document.querySelectorAll('#epg-canvas *').length > 20`, 'the guide');
  await sleep(2200);
  await click(`[...document.querySelectorAll('.epg-chan')][2].querySelector('.epg-chan-name')`, { pause: 3800 });
  await click(`document.getElementById('epg-close')`, { pause: 800 });

  // Search.
  await scene('search', 'right');
  await move(WIDTH * 0.55, HEIGHT * 0.5, 500);
  await key('/', { pause: 400 });
  await type('news');
  await sleep(2800);
  await click(`document.getElementById('search-clear')`, { pause: 700 });

  // Movies.
  await scene('movies', 'right');
  await click(`document.getElementById('tab-movie')`, { pause: 900 });
  await click(byText('#groups', 'Nordic'));
  await waitFor(ROWS, 'the movies');
  await click(`document.querySelector('button[aria-label="Show as covers"]')`, { pause: 1600 });
  await click(byText('#list', 'Northern Lights'));
  await waitFor(PLAYING, 'the movie');
  await move(WIDTH * 0.76, HEIGHT * 0.9, 700);
  await sleep(3200);

  // A series.
  await scene('series', 'right');
  await click(`document.getElementById('tab-series')`, { pause: 900 });
  await click(byText('#groups', 'Nordic Noir'));
  await waitFor(ROWS, 'the series');
  await click(byText('#list', 'Silent Fjord'));
  await waitFor(`!document.getElementById('detail').hidden && document.querySelectorAll('#list .row').length > 0`, 'the series page');
  await sleep(1400);
  await click(byText('#detail', 'Season 2'), { pause: 1200 });
  await click(byText('#detail', 'Season 1'), { pause: 900 });

  // An MKV episode with subtitles.
  await scene('mkv', 'left');
  await click(`document.querySelector('#list .row')`);
  await waitFor(PLAYING, 'the episode');
  await waitFor(`(() => { const s = document.getElementById('subs'); return !s.hidden && s.options.length > 1; })()`, 'the subtitle tracks');
  await sleep(800);
  await click(`document.getElementById('subs')`, { pause: 800 });
  await click(byText('.picker-pop', 'English'), { pause: 3200 });

  await scene('subsize', 'left');
  await click(`document.getElementById('btn-sublook')`, { pause: 1500 });
  await click(`document.getElementById('btn-sublook')`, { pause: 500 });
  await move(WIDTH * 0.74, HEIGHT * 0.35, 600);
  await key('+', { pause: 700 });
  await key('+', { pause: 1800 });

  await scene('more', 'left');
  await click(`document.getElementById('btn-more')`, { pause: 3200 });
  await key('Escape', { pause: 500 });

  // History.
  await scene('history', 'right');
  await click(`document.getElementById('tab-recent')`, { pause: 3600 });

  // The keys.
  await scene('keys', 'bottom', 3400);
  await move(WIDTH * 0.75, HEIGHT * 0.5, 500);
  await sleep(2400);
  await key('?', { pause: 1700 });
  await click(`document.querySelector('.help-more summary')`, { pause: 2600 });
  await click(`document.getElementById('help-close')`, { pause: 600 });

  // The theme.
  await scene('theme', 'right');
  await click(`document.getElementById('btn-theme')`, { pause: 3200 });
  await click(`document.getElementById('btn-theme')`, { pause: 900 });

  // Languages.
  await scene('languages', 'bottom', 3400);
  await sleep(2600);
  await click(`document.getElementById('btn-settings')`, { pause: 700 });
  await click(`document.getElementById('tab-general')`, { pause: 600 });
  await click(`document.getElementById('f-lang')`, { pause: 700 });
  await type(C.otherLanguage.slice(0, 3), 150);
  await sleep(500);
  await click(byText('.picker-pop', C.otherLanguage), { pause: 900 });
  await click(`document.getElementById('f-save')`, { pause: 1000 });
  await waitFor(`!document.getElementById('setup').open`, 'the settings to close', 8000).catch(() => evaluate(`document.getElementById('setup').close()`));
  await say('languages', 'right');
  await sleep(3600);

  // Full screen, last: the screencast is blown up after it for good, so
  // from here to the end the frames are screenshots (see screenshots()).
  await scene('fullscreen', 'top');
  const { x: vx, y: vy } = await centre(`document.getElementById('video')`);
  await move(vx, vy, 700);
  await move(vx + 40, vy + 20, 300);
  await click(`document.getElementById('btn-fullscreen')`, { pause: 0 });
  recorder.screenshots();
  await waitFor(`!!document.fullscreenElement`, 'full screen', 5000);
  await raise();
  await move(WIDTH * 0.5, HEIGHT * 0.35, 900);
  await sleep(3800);

  // Outro.
  await hide();
  chapters.push({ id: 'outro', at: recorder.now() });
  const [title, line, small] = C.outro;
  cue([...C.outro, C.disclaimer]);
  await evaluate(`window.demo.card(${JSON.stringify(title)}, ${JSON.stringify(line)}, ${JSON.stringify(small)}, ${JSON.stringify(C.disclaimer)})`);
  await move(WIDTH + 40, HEIGHT * 0.8, 600);
  await sleep(6500);
}

/* ------------------------------------------------------------------ main */

const stamp = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

mkdirSync(OUT, { recursive: true });
const video = join(OUT, `kepuli-tv-demo-${LANG}.mp4`);
const server = await startMockServer(MOCK_PORT);
await ensureChrome(['--headless=new', '--autoplay-policy=no-user-gesture-required', '--force-color-profile=srgb',
  `--host-resolver-rules=MAP ${HOST} 127.0.0.1`, `--window-size=${WIDTH},${HEIGHT}`]);
try {
  page = connect((await openPlayer()).webSocketDebuggerUrl);
  await page.call('Page.enable');
  // The screen as large as the viewport: full screen fills the frame
  // rather than the default 800x600 screen of a headless Chrome.
  await page.call('Emulation.setDeviceMetricsOverride', METRICS);
  await evaluate(`chrome.storage.local.set({
    config: { scheme: 'http', host: '${HOST}', port: '${MOCK_PORT}', username: '${USER}', password: '${PASS}', sourceMode: 'xtream', streamMode: 'auto' },
    settings: { lang: '${LANG}', epgEnabled: true, resumeEnabled: true, subtitleLang: '', theme: 'dark' },
    ui: { tab: 'live' }, favorites: [], recents: [], resume: {},
  })`);
  await page.call('Page.reload');
  await waitFor(`document.querySelectorAll('#groups .group').length > 1 && document.getElementById('list-progress').hidden`, 'the connection');
  await evaluate(`document.fonts.ready`);
  await evaluate(LAYER);
  const [title, line, small] = C.intro;
  await evaluate(`window.demo.card(${JSON.stringify(title)}, ${JSON.stringify(line)}, ${JSON.stringify(small)}, ${JSON.stringify(C.disclaimer)})`);
  await sleep(900);
  const { data } = await page.call('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, `kepuli-tv-demo-${LANG}-thumbnail.png`), Buffer.from(data, 'base64'));

  recorder = new Recorder(video);
  await recorder.start();
  await walk();
  await recorder.stop();

  const lines = chapters.map(({ id, at }) => `${stamp(at)} ${C.chapters[id]}`);
  writeFileSync(join(OUT, `kepuli-tv-demo-${LANG}-chapters.txt`), lines.join('\n') + '\n');
  writeFileSync(join(OUT, `kepuli-tv-demo-${LANG}.srt`), srt(recorder.written / FPS));
  console.log(`\n${video}  ${stamp(recorder.written / FPS)}\n\n${lines.join('\n')}`);
} finally {
  page?.close();
  server.closeAllConnections(); server.close();
  const { PORT } = await import('./screenshot.mjs');
  try {
    const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
    const browser = connect(webSocketDebuggerUrl);
    await browser.call('Browser.close').catch(() => {});
  } catch { /* already gone */ }
  await sleep(500);
  rmSync(PROFILE, { recursive: true, force: true });
}
process.exit(0);
