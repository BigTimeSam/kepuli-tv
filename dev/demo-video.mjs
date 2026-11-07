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
//   node dev/demo-video.mjs [--lang en] [--silent]
//
// Before the recording a viewer's evenings are played for real — channels,
// films and episodes stopped halfway, favourites starred, three accounts —
// so that the start page, History and the lists have something in them.
//
// Writes dist/video/kepuli-tv-demo-<lang>.mp4 (1920x1080, H.264, with a
// narrator and music, see "narration" below; --silent: no sound),
// a thumbnail beside it, -chapters.txt: the scenes' start times in the
// form YouTube reads chapters from a description, and .srt: the captions
// as a subtitle track to upload with the video. The captions are in
// CAPTIONS below, one set per language; the app is shown in the same
// language.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
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
const { ensureChrome, openPlayer, sleep, evaluate: evaluateIn, waitFor: waitForIn } = await import('./screenshot.mjs');
// Live channels as MPEG-TS, which is what the recorder keeps.
process.env.KEPULI_MOCK_LIVE_TS = '1';
const { startMockServer, USER, PASS, STALKER_MAC } = await import('./mock/server.mjs');

/* ------------------------------------------------------------- captions */

const CAPTIONS = {
  en: {
    intro: ['Kepuli-TV', 'An IPTV player for Chrome and Firefox', 'Free and open source · Bring your own Xtream Codes, M3U or Stalker subscription'],
    start: ['Your start page', 'What you left halfway, what is on your channels now and soon, and the channels you watched lately.'],
    resume: ['Pick up where you left off', 'One click and the film carries on from where you stopped, with its cast, director and details beside it.'],
    live: ['Live TV by country and topic', 'Pick a country, narrow it to a topic, and see what is on now on every channel.'],
    zap: ['Zap in a second', 'Arrow keys move, Enter plays, and L jumps back to the channel you watched before.'],
    favourites: ['Favourites', 'Star a channel, a film or a series, and one tick shows only your favourites.'],
    countries: ['The countries you watch', 'Keep only the countries you want. The rest stay out of the lists, the search and the guide.'],
    guide: ['Programme guide', 'A full guide for every channel, or just your favourites. Click a channel for what is on now and next.'],
    search: ['Search', 'Press / and start typing. Any channel in seconds, even among tens of thousands.'],
    movies: ['Movies', 'Choose the categories you care about, browse by cover, and play in the same window.'],
    details: ['Everything about the title', 'Year, rating, director, cast, country and age rating, with the format and bit rate of the file.'],
    series: ['Series', 'Seasons and episodes at a glance, with the plot, the year and the rating.'],
    mkv: ['MKV with subtitles', 'Matroska files play right in the browser, with their subtitles and every audio track, even AC-3.'],
    subsize: ['Subtitles your size', 'Set the size and the height of the subtitles. + and − change the size while you watch.'],
    record: ['Record live TV', 'Turn recording on in Settings and record what you are watching, or plan it from the guide.'],
    recordings: ['Your recordings', 'Recordings stay in your browser. Play them back or save them as a file.'],
    more: ['And more', 'Picture-in-picture, Chromecast, or hand the stream to an external player such as VLC.'],
    history: ['History', 'Every channel, film and episode you watched, one click away.'],
    accounts: ['Several accounts', 'Xtream Codes, an M3U playlist or a Stalker portal, side by side. Switch between them in a click.'],
    sync: ['Sync between computers', 'Your accounts, favourites, history and settings follow you through your browser’s own sync.'],
    keys: ['Made for the keyboard', 'Press ? for the shortcuts. Everything works without a mouse too.'],
    theme: ['Dark or light', 'A dark and a light theme, or follow your system.'],
    languages: ['Thirty languages', 'From English and Suomi to Deutsch, Español, Polski and Türkçe. A 12- or 24-hour clock, as you like.'],
    fullscreen: ['Full screen', 'Full screen from the button, the F key or a double click. Subtitles scale with the picture.'],
    outro: ['Kepuli-TV', 'Free on the Chrome Web Store and Firefox Add-ons', 'github.com/BigTimeSam/kepuli-tv'],
    disclaimer: 'Kepuli-TV contains no channels or content. You need your own IPTV subscription. Everything shown here is fictional demo content.',
    chapters: {
      intro: 'Introduction', start: 'Start page', resume: 'Continue watching', live: 'Live TV', zap: 'Switching channels', favourites: 'Favourites',
      countries: 'Filter countries', guide: 'Programme guide', search: 'Search', movies: 'Movies and categories', details: 'Title details',
      series: 'Series', mkv: 'MKV and subtitles', subsize: 'Subtitle size and height', record: 'Recording', recordings: 'Recordings',
      more: 'Picture-in-picture and Chromecast', history: 'History', accounts: 'Several accounts', sync: 'Sync between computers',
      keys: 'Keyboard shortcuts', theme: 'Dark and light theme', languages: 'Languages and clock', fullscreen: 'Full screen', outro: 'Get Kepuli-TV',
    },
    // The narration, one line a scene, read by a speech model (see VOICE
    // below). A scene lasts at least as long as its line.
    voice: {
      intro: 'Meet Kepuli-TV: a free, open-source IPTV player for Chrome and Firefox. Bring your own subscription, and watch it all right in your browser.',
      start: 'Your start page picks up where you left off: films and episodes you stopped halfway, what’s on your channels now and soon, and the channels you watched lately.',
      resume: 'One click, and the film carries on right where you stopped, with the cast, the director and all the details beside it.',
      live: 'Live TV is sorted by country and topic. Pick a country, narrow it down, and see what’s on now on every channel.',
      zap: 'Zap with the arrow keys, press Enter to play, and L to jump back to the channel before.',
      favourites: 'Star the channels you love, and one tick in the filters shows only your favourites.',
      countries: 'Keep only the countries you watch. The rest stay out of the lists, the search and the guide.',
      guide: 'The programme guide covers every channel, or just your favourites. Click a channel to see what’s on now and next.',
      search: 'Press slash and start typing. Any channel turns up in seconds.',
      movies: 'For films and series, choose the categories you care about, browse by cover, and play in the same window.',
      details: 'Every title shows its year, rating, director and cast, and even the format and bit rate of the file.',
      series: 'Series show their seasons and episodes at a glance.',
      mkv: 'MKV files play right in the browser, with their subtitles and every audio track.',
      subsize: 'Make the subtitles as big as you like, and set their height.',
      record: 'Want to keep a programme? Turn on recording in Settings, with a reminder to record only what you have the right to, and press Record.',
      recordings: 'Recordings stay in your browser. Play them back, or save them to your computer.',
      more: 'There’s picture-in-picture, Chromecast, and a hand-off to players like VLC.',
      history: 'History keeps everything you’ve watched one click away.',
      accounts: 'Add several accounts, Xtream Codes, an M3U playlist or a Stalker portal, and switch between them in a click.',
      sync: 'With sync on, your accounts, favourites and history follow you to your other computers.',
      keys: 'Everything works from the keyboard. Press the question mark to see the shortcuts.',
      theme: 'Prefer it light? Switch themes in a click.',
      languages: 'Kepuli-TV speaks thirty languages, with a twelve- or twenty-four-hour clock.',
      fullscreen: 'And for the big picture, just double-click.',
      outro: 'Kepuli-TV is free on the Chrome Web Store and Firefox Add-ons. It comes with no channels of its own, so bring your own subscription.',
    },
    otherLanguage: 'Deutsch',
  },
};
const C = CAPTIONS[LANG];
if (!C) throw new Error(`no captions for ${LANG}; add them to CAPTIONS`);

/* ------------------------------------------------------------ narration */

// The narration: each scene's line from C.voice, read by OpenAI's speech
// model, and music made by dev/demo-music.py under it, ducked while the
// voice speaks. The key is read from ~/.config/kepuli-tv/openai-key (mode
// 600) or OPENAI_API_KEY. --silent leaves both out, as the first video was.
// The clips are kept in dist/video/voice-<lang>/ and made again only when
// a line, the voice or the instructions change.
const SILENT = process.argv.includes('--silent');
// --remix: the sound made again over the last recording, from its scenes'
// times kept beside it, without recording anew.
const REMIX = process.argv.includes('--remix');
const VOICE = { model: 'gpt-4o-mini-tts', voice: 'onyx',
  instructions: 'Warm, confident male narrator for a short product demo video. Friendly and clear, natural unhurried pace, a slight smile in the voice. Do not rush the ends of sentences.' };
const voiceLength = {};

function openaiKey() {
  const file = join(homedir(), '.config', 'kepuli-tv', 'openai-key');
  if (existsSync(file)) {
    if ((statSync(file).mode & 0o077) !== 0) throw new Error(`${file} can be read by others: chmod 600 it`);
    return readFileSync(file, 'utf8').trim();
  }
  const key = process.env.OPENAI_API_KEY || '';
  if (!key.startsWith('sk-')) throw new Error(`no OpenAI key: put it in ${file}, or run with --silent`);
  return key;
}

const run = (cmd, args) => new Promise((ok, fail) => {
  const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'] });
  let out = '';
  p.stdout.on('data', (d) => { out += d; });
  p.on('close', (code) => (code === 0 ? ok(out) : fail(new Error(`${cmd} exited with ${code}`))));
});
const duration = async (file) => Number(await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]));

async function makeVoice() {
  const dir = join(OUT, `voice-${LANG}`);
  mkdirSync(dir, { recursive: true });
  let key = null;
  for (const [id, text] of Object.entries(C.voice)) {
    const clip = join(dir, `${id}.mp3`), note = join(dir, `${id}.json`);
    const want = JSON.stringify({ ...VOICE, text });
    if (!existsSync(clip) || !existsSync(note) || readFileSync(note, 'utf8') !== want) {
      key ||= openaiKey();
      const res = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...VOICE, input: text, response_format: 'mp3' }),
      });
      if (!res.ok) throw new Error(`speech for ${id}: ${res.status} ${(await res.text()).slice(0, 300)}`);
      writeFileSync(clip, Buffer.from(await res.arrayBuffer()));
      writeFileSync(note, want);
      console.log(`voice: ${id} made`);
    }
    voiceLength[id] = await duration(clip);
  }
  return dir;
}

// The scene whose line is being spoken, and when it began.
let speaking = null;
const LEAD = 0.35;         // the voice starts a moment after the scene
/** Waits until the line of the scene before has been said, with a breath after it. */
async function holdVoice() {
  if (SILENT || !speaking) return;
  const left = LEAD + (voiceLength[speaking.id] || 0) + 0.45 - (recorder.now() - speaking.at);
  if (left > 0) await sleep(left * 1000);
}
function speak(id, at = recorder.now()) { speaking = { id, at }; }

/** The silent recording, the voice clips at their scenes and the music under them, into one file. */
async function mix(silent, dir, out) {
  const length = await duration(silent);
  const music = join(dir, 'music.wav');
  await run('uv', ['run', '--quiet', join(ROOT, 'dev', 'demo-music.py'), music, String(Math.ceil(length) + 1)]);
  const spoken = chapters.filter(({ id }) => C.voice[id]);
  const inputs = ['-i', silent, '-i', music, ...spoken.flatMap(({ id }) => ['-i', join(dir, `${id}.mp3`)])];
  const delays = spoken.map(({ at }, i) => `[${i + 2}:a]aresample=48000,adelay=${Math.round((at + LEAD) * 1000)}:all=1[v${i}]`);
  const graph = [...delays,
    `${spoken.map((_, i) => `[v${i}]`).join('')}amix=inputs=${spoken.length}:normalize=0,apad,atrim=0:${length.toFixed(2)},asplit=2[voice][key]`,
    `[1:a]aresample=48000,volume=0.11,atrim=0:${length.toFixed(2)},afade=t=out:st=${(length - 4).toFixed(2)}:d=4[bed]`,
    `[bed][key]sidechaincompress=threshold=0.01:ratio=10:attack=50:release=900:makeup=1[ducked]`,
    `[ducked][voice]amix=inputs=2:normalize=0,loudnorm=I=-15:TP=-1.5:LRA=11[a]`].join(';');
  await run('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', graph, '-map', '0:v', '-map', '[a]',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-t', length.toFixed(2), out]);
  // The captions as what the narrator says, where he says it.
  cues.length = 0;
  for (const { id, at } of spoken) cues.push({ start: at + LEAD, end: at + LEAD + voiceLength[id], lines: [C.voice[id]] });
}

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

const evaluate = (expression, options) => evaluateIn(page, expression, options);
const waitFor = (expression, what, timeout = 20000) => waitForIn(page, expression, what, timeout, 150);

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
  await holdVoice();
  chapters.push({ id, at: recorder.now() });
  speak(id);
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

/**
 * Before the recording: a viewer's few evenings, watched for real, so that
 * the start page, History and the favourites have something in them. The
 * channels are played, films and episodes stopped halfway, and a few
 * channels and films starred — the player writes it all itself, as it
 * would for anyone.
 */
async function prepare() {
  const press = (find) => evaluate(`(${find}).click()`, { gesture: true });
  // A film's row is named with its year: "Planet Arctic (2019)".
  const row = (name) => `[...document.querySelectorAll('#list .row')].find((r) => { const n = r.querySelector('.row-name')?.textContent || ''; return n === ${JSON.stringify(name)} || n.startsWith(${JSON.stringify(name + ' (')}); })`;
  const stop = async () => {
    await press(`document.getElementById('btn-home')`);
    await waitFor(`!document.getElementById('idle-home').hidden`, 'the start page');
    await sleep(800);
  };
  // Channels, the last watched first on the page.
  await press(byText('#groups', 'Finland'));
  await waitFor(ROWS, 'the channel list');
  for (const name of ['Aurora Kids HD', 'Aurora Nature HD', 'Aurora Cinema', 'Aurora News 24']) {
    await press(row(name));
    await waitFor(PLAYING, name, 30000);
    await sleep(2500);
  }
  for (const name of ['Aurora One', 'Aurora News 24', 'Aurora Nature HD']) await press(`${row(name)}.querySelector('.row-star')`);
  await stop();
  // Films stopped halfway; the last stopped comes first under Continue watching.
  const films = [['Documentary', 'Planet Arctic', 55], ['Action', 'Steel Horizon', 38], ['Drama', 'The Long Winter', 64], ['Nordic', 'Ice Road Home', 80], ['Nordic', 'Northern Lights', 48]];
  for (const [group, title, at] of films) {
    await press(`document.getElementById('tab-movie')`);
    await press(byText('#groups', group));
    await waitFor(`${ROWS} && !!${row(title)}`, title);
    await press(row(title));
    await waitFor(PLAYING, title, 30000);
    await evaluate(`document.getElementById('video').currentTime = ${at}`);
    await sleep(1800);
    if (group === 'Nordic' && title === 'Northern Lights') {
      for (const fav of ['Midsummer Ghosts', 'The Archipelago']) await press(`${row(fav)}.querySelector('.row-star')`);
    }
    await stop();
  }
  // Episodes of two series.
  for (const [group, title, episode, at] of [['Sci-Fi', 'Orbital', 1, 40], ['Nordic Noir', 'Black Water', 2, 52]]) {
    await press(`document.getElementById('tab-series')`);
    await press(byText('#groups', group));
    await waitFor(`${ROWS} && !!${row(title)}`, title);
    await press(row(title));
    await waitFor(`!document.getElementById('detail').hidden && document.querySelectorAll('#list .row').length > ${episode}`, `${title}'s page`);
    await press(`document.querySelectorAll('#list .row')[${episode}]`);
    await waitFor(PLAYING, `${title}, episode ${episode + 1}`, 30000);
    await evaluate(`document.getElementById('video').currentTime = ${at}`);
    await sleep(1800);
    await stop();
  }
  await press(`document.getElementById('tab-live')`);
  await waitFor(ROWS, 'the channels again');
  await evaluate(`document.getElementById('list').scrollTop = 0`);
  await sleep(1500);
}

async function walk() {
  // Intro.
  chapters.push({ id: 'intro', at: 0 });
  speak('intro', 0);
  cue(C.intro, 0, 0);
  await sleep(4500);
  await holdVoice();
  speaking = null;
  await evaluate(`window.demo.card(null)`);
  cue(null);
  await sleep(900);

  // The start page, filled by the evenings before.
  await scene('start', 'left');
  const { x: cx, y: cy } = await centre(`document.querySelector('.idle-card-wrap')`);
  await move(cx, cy, 900);
  await sleep(1400);
  await click(`document.querySelector('.idle-home .side-scroll-arrow.next')`, { pause: 1300 });
  await click(`document.querySelector('.idle-scroll.prev:not([hidden])') || document.querySelector('.idle-scroll.prev')`, { pause: 1100 });
  const { x: kx, y: ky } = await centre(`document.querySelector('.idle-pick:not([hidden])') || document.querySelector('.idle-channel')`);
  await move(kx, ky, 800);
  await sleep(1800);
  // Down to History, and back up.
  const wheel = async (dy, times) => { for (let i = 0; i < times; i++) { await page.call('Input.dispatchMouseEvent', { type: 'mouseWheel', x: kx, y: ky, deltaX: 0, deltaY: dy }); await sleep(90); } };
  await wheel(120, 5);
  await sleep(2600);
  await wheel(-120, 6);
  await sleep(900);

  // Continue watching: the film carries on where it stopped.
  await scene('resume', 'left');
  await click(`[...document.querySelectorAll('.idle-card-wrap')].find((w) => w.textContent.includes('Northern Lights')).querySelector('.idle-card, button, a') || [...document.querySelectorAll('.idle-card-wrap')].find((w) => w.textContent.includes('Northern Lights'))`);
  await waitFor(PLAYING, 'the film resumed', 30000);
  await move(WIDTH * 0.8, HEIGHT * 0.86, 900);
  await sleep(4200);

  // Live TV.
  await scene('live', 'right');
  await click(`document.getElementById('tab-live')`, { pause: 800 });
  await click(byText('#groups', 'Finland'));
  await waitFor(ROWS, 'the channel list');
  await sleep(800);
  await click(byText('#subcats', 'Sport'), { pause: 1100 });
  await click(byText('#subcats', 'All'), { pause: 700 });
  await click(byText('#list', 'Aurora One'));
  await waitFor(PLAYING, 'the live stream');
  await move(WIDTH * 0.74, HEIGHT * 0.86, 700);
  await sleep(2800);

  // Zapping from the keyboard.
  await scene('zap', 'right');
  await evaluate(`document.getElementById('list').focus()`);
  await move(WIDTH * 0.74, HEIGHT * 0.3, 500);
  await key('ArrowUp', { pause: 500 });
  await key('ArrowUp', { pause: 500 });
  await key('Enter', { pause: 2000 });
  await key('l', { pause: 2400 });

  // Favourites: from the row's menu, then the list narrowed to them.
  await scene('favourites', 'right');
  const row = `[...document.querySelectorAll('#list .row')].find((r) => r.textContent.includes('Aurora Cinema Nordic'))`;
  const { x: rx, y: ry } = await centre(row);
  await move(rx, ry, 700);
  await sleep(300);
  await click(`${row}.querySelector('.row-more')`, { pause: 700 });
  await click(byText('.row-menu', 'Add to favourites'), { pause: 900 });
  await evaluate(`document.getElementById('channel-filters').open = true`);
  await click(`document.getElementById('channel-favs')`, { pause: 2600 });
  await click(`document.getElementById('channel-favs')`, { pause: 700 });

  // Countries.
  await scene('countries', 'bottom', 3200);
  await sleep(2400);
  await click(`document.getElementById('btn-countries')`, { pause: 900 });
  // The favourite countries alone for a moment, then the ones chosen: a tick
  // in the list chooses that mode by itself.
  await click(`document.querySelector('input[name="countries-mode"][value="favorites"]')`, { pause: 1800 });
  for (const name of ['Finland', 'Sweden', 'Norway']) {
    await click(`document.querySelector('#countries-list .choice-row[data-name="${name}"] input')`, { pause: 400 });
  }
  await sleep(700);
  await click(`document.getElementById('countries-save')`, { pause: 2200 });

  // The guide, and the favourites alone in it.
  await scene('guide', 'bottom', 5200);
  await click(`document.getElementById('btn-guide')`);
  await waitFor(`document.getElementById('main').classList.contains('guide') && document.querySelectorAll('#epg-canvas *').length > 20`, 'the guide');
  await sleep(2000);
  await click(`document.getElementById('epg-favs')`, { pause: 2600 });
  await click(`[...document.querySelectorAll('.epg-chan')][1].querySelector('.epg-chan-name')`, { pause: 3200 });
  await click(`document.getElementById('epg-favs')`, { pause: 1200 });
  await click(`document.getElementById('epg-close')`, { pause: 700 });

  // Search.
  await scene('search', 'right');
  await move(WIDTH * 0.55, HEIGHT * 0.5, 500);
  await key('/', { pause: 400 });
  await type('news');
  await sleep(2500);
  await click(`document.getElementById('search-clear')`, { pause: 600 });

  // Movies: the categories chosen, the covers, a film.
  await scene('movies', 'bottom', 3000);
  await click(`document.getElementById('tab-movie')`, { pause: 900 });
  await sleep(1400);
  await click(`document.getElementById('btn-countries')`, { pause: 900 });
  for (const name of ['Drama', 'Nordic', 'Documentary', 'Thriller']) {
    await click(`document.querySelector('#countries-list .choice-row[data-name="${name}"] input')`, { pause: 400 });
  }
  await sleep(600);
  await click(`document.getElementById('countries-save')`, { pause: 1500 });
  await say('movies', 'right');
  await click(byText('#groups', 'Nordic'));
  await waitFor(ROWS, 'the movies');
  await click(`document.querySelector('button[aria-label="Show as covers"]')`, { pause: 1500 });
  await click(byText('#list', 'Midsummer Ghosts'));
  await waitFor(PLAYING, 'the movie');

  await scene('details', 'left');
  await move(WIDTH * 0.8, HEIGHT * 0.86, 800);
  await sleep(4200);

  // A series.
  await scene('series', 'right');
  await click(`document.getElementById('tab-series')`, { pause: 900 });
  await click(byText('#groups', 'Nordic Noir'));
  await waitFor(ROWS, 'the series');
  await click(byText('#list', 'Silent Fjord'));
  await waitFor(`!document.getElementById('detail').hidden && document.querySelectorAll('#list .row').length > 0`, 'the series page');
  await sleep(1200);
  await click(byText('#detail', 'Season 2'), { pause: 1100 });
  await click(byText('#detail', 'Season 1'), { pause: 800 });

  // An MKV episode with subtitles.
  await scene('mkv', 'left');
  await click(`document.querySelector('#list .row')`);
  await waitFor(PLAYING, 'the episode');
  await waitFor(`(() => { const s = document.getElementById('subs'); return !s.hidden && s.options.length > 1; })()`, 'the subtitle tracks');
  await sleep(700);
  await click(`document.getElementById('subs')`, { pause: 800 });
  await click(byText('.picker-pop', 'English'), { pause: 3000 });

  await scene('subsize', 'left');
  await click(`document.getElementById('btn-sublook')`, { pause: 1400 });
  await click(`document.getElementById('btn-sublook')`, { pause: 500 });
  await move(WIDTH * 0.74, HEIGHT * 0.35, 600);
  await key('+', { pause: 700 });
  await key('+', { pause: 1600 });

  // Recording: turned on in Settings, after the reminder, then a channel recorded.
  await scene('record', 'bottom', 3000);
  await click(`document.getElementById('tab-live')`, { pause: 700 });
  await click(byText('#list', 'Aurora News 24'));
  await waitFor(PLAYING, 'the channel to record', 30000);
  await sleep(1200);
  await click(`document.getElementById('btn-settings')`, { pause: 700 });
  await click(`document.getElementById('tab-playback')`, { pause: 600 });
  await click(`document.getElementById('f-record')`, { pause: 900 });
  await waitFor(`document.getElementById('rec-consent').open`, 'the recording reminder');
  await sleep(2600);
  await click(`document.getElementById('rec-consent-ok')`, { pause: 700 });
  await click(`document.getElementById('f-save')`, { pause: 900 });
  await waitFor(`!document.getElementById('setup').open && !document.getElementById('btn-record').hidden`, 'the Record button');
  await say('record', 'right');
  await click(`document.getElementById('btn-record')`, { pause: 4500 });
  await click(`document.getElementById('btn-record')`, { pause: 1200 });

  await scene('recordings', 'bottom', 2600);
  await sleep(2000);
  await click(`document.getElementById('btn-more')`, { pause: 700 });
  await click(`document.getElementById('btn-recordings-menu')`, { pause: 3200 });
  await click(`document.getElementById('recordings-close')`, { pause: 600 });

  await scene('more', 'left');
  await click(`document.getElementById('btn-more')`, { pause: 3000 });
  await key('Escape', { pause: 500 });

  // History.
  await scene('history', 'right');
  await click(`document.getElementById('tab-recent')`, { pause: 3400 });

  // Several accounts, and the sync.
  await scene('accounts', 'bottom', 3000);
  await sleep(2200);
  await click(`document.getElementById('btn-settings')`, { pause: 700 });
  await click(`document.getElementById('tab-connection')`, { pause: 300 });
  await evaluate(`document.getElementById('accounts').scrollIntoView({ block: 'start' })`);
  await sleep(600);
  const { x: ax, y: ay } = await centre(`document.querySelector('#account-list li:nth-child(2)') || document.getElementById('account-list')`);
  await move(ax, ay, 700);
  await sleep(900);
  const { x: bx, y: by } = await centre(`document.querySelector('#account-list li:nth-child(3)') || document.getElementById('account-list')`);
  await move(bx, by, 600);
  await sleep(900);
  const { x: sx, y: sy } = await centre(`document.querySelector('input[name="source"][value="stalker"]').closest('label')`);
  await move(sx, sy, 700);
  await sleep(1200);

  await click(`document.getElementById('tab-account')`, { pause: 700 });
  await scene('sync', 'top');
  const { x: yx, y: yy } = await centre(`document.getElementById('f-sync').closest('label')`);
  await move(yx, yy, 700);
  await sleep(3400);
  await click(`document.getElementById('f-close')`, { pause: 700 });
  await evaluate(`document.getElementById('setup').open && document.getElementById('f-discard')?.click()`);

  // The keys.
  await scene('keys', 'bottom', 3200);
  await move(WIDTH * 0.75, HEIGHT * 0.5, 500);
  await sleep(2200);
  await key('?', { pause: 1600 });
  await click(`document.querySelector('.help-more summary')`, { pause: 2400 });
  await click(`document.getElementById('help-close')`, { pause: 600 });

  // The theme, shown on the start page.
  await scene('theme', 'left');
  await click(`document.getElementById('btn-home')`, { pause: 1200 });
  await click(`document.getElementById('btn-theme')`, { pause: 3200 });
  await click(`document.getElementById('btn-theme')`, { pause: 900 });

  // Languages and the clock.
  await scene('languages', 'bottom', 3200);
  await sleep(2400);
  await click(`document.getElementById('btn-settings')`, { pause: 700 });
  await click(`document.getElementById('tab-general')`, { pause: 600 });
  await click(`document.getElementById('f-clock')`, { pause: 700 });
  await click(byText('.picker-pop', '12-hour'), { pause: 900 });
  await click(`document.getElementById('f-lang')`, { pause: 700 });
  await type(C.otherLanguage.slice(0, 3), 150);
  await sleep(500);
  await click(byText('.picker-pop', C.otherLanguage), { pause: 900 });
  await click(`document.getElementById('f-save')`, { pause: 1000 });
  await waitFor(`!document.getElementById('setup').open`, 'the settings to close', 8000).catch(() => evaluate(`document.getElementById('setup').close()`));
  await say('languages', 'right');
  await click(byText('#list', 'Aurora One'));
  await waitFor(PLAYING, 'a channel in the other language', 30000);
  await sleep(3000);

  // Full screen, last: the screencast is blown up after it for good, so
  // from here to the end the frames are screenshots (see screenshots()).
  await scene('fullscreen', 'top');
  const { x: vx, y: vy } = await centre(`document.getElementById('video')`);
  await move(vx, vy, 700);
  await move(vx + 40, vy + 20, 300);
  // A double click on the picture: full screen, and the picture plays on.
  await click(`document.getElementById('video')`, { pause: 0, double: true });
  recorder.screenshots();
  await waitFor(`!!document.fullscreenElement`, 'full screen', 5000);
  await raise();
  await move(WIDTH * 0.5, HEIGHT * 0.35, 900);
  await sleep(3800);

  // Outro.
  await holdVoice();
  await hide();
  chapters.push({ id: 'outro', at: recorder.now() });
  speak('outro');
  const [title, line, small] = C.outro;
  cue([...C.outro, C.disclaimer]);
  await evaluate(`window.demo.card(${JSON.stringify(title)}, ${JSON.stringify(line)}, ${JSON.stringify(small)}, ${JSON.stringify(C.disclaimer)})`);
  await move(WIDTH + 40, HEIGHT * 0.8, 600);
  await sleep(6500);
  await holdVoice();
  await sleep(1500);
}

/* ------------------------------------------------------------------ main */

const stamp = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

mkdirSync(OUT, { recursive: true });
const video = join(OUT, `kepuli-tv-demo-${LANG}.mp4`);
const voiceDir = SILENT ? null : await makeVoice();
if (REMIX) {
  chapters.push(...JSON.parse(readFileSync(join(OUT, `kepuli-tv-demo-${LANG}-scenes.json`), 'utf8')));
  await mix(join(OUT, `kepuli-tv-demo-${LANG}-silent.mp4`), voiceDir, video);
  writeFileSync(join(OUT, `kepuli-tv-demo-${LANG}.srt`), srt(await duration(video)));
  console.log(`${video}: the sound mixed again`);
  process.exit(0);
}
const server = await startMockServer(MOCK_PORT);
await ensureChrome(['--headless=new', '--autoplay-policy=no-user-gesture-required', '--force-color-profile=srgb',
  `--host-resolver-rules=MAP ${HOST} 127.0.0.1`, `--window-size=${WIDTH},${HEIGHT}`]);
try {
  page = connect((await openPlayer()).webSocketDebuggerUrl);
  await page.call('Page.enable');
  // The screen as large as the viewport: full screen fills the frame
  // rather than the default 800x600 screen of a headless Chrome.
  await page.call('Emulation.setDeviceMetricsOverride', METRICS);
  // Three accounts, of the three kinds; the Xtream one in use.
  const home = { type: 'xtream', scheme: 'http', host: HOST, port: String(MOCK_PORT), username: USER, password: PASS, name: 'Home', id: 'a1', sourceMode: 'xtream', streamMode: 'auto' };
  const accounts = [home,
    { type: 'm3u', url: `http://${HOST}:${MOCK_PORT}/playlist.m3u`, epgUrl: '', name: 'Summer cottage playlist', id: 'a2', sourceMode: 'm3u', streamMode: 'auto' },
    { type: 'stalker', url: `http://${HOST}:${MOCK_PORT}/c/`, mac: STALKER_MAC, name: 'Living room portal', id: 'a3', sourceMode: 'stalker', streamMode: 'auto' }];
  await evaluate(`chrome.storage.local.set({
    config: ${JSON.stringify(home)}, accounts: ${JSON.stringify(accounts)},
    settings: { lang: '${LANG}', epgEnabled: true, resumeEnabled: true, subtitleLang: '', theme: 'dark', recordingEnabled: false, clock: 'auto' },
    ui: { tab: 'live' },
  })`);
  await page.call('Page.reload');
  await waitFor(`document.querySelectorAll('#groups .group').length > 1 && document.getElementById('list-progress').hidden`, 'the connection');
  await evaluate(`document.fonts.ready`);
  console.log('preparing the history and the favourites…');
  await prepare();
  await evaluate(LAYER);
  const [title, line, small] = C.intro;
  await evaluate(`window.demo.card(${JSON.stringify(title)}, ${JSON.stringify(line)}, ${JSON.stringify(small)}, ${JSON.stringify(C.disclaimer)})`);
  await sleep(900);
  const { data } = await page.call('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, `kepuli-tv-demo-${LANG}-thumbnail.png`), Buffer.from(data, 'base64'));

  const silent = SILENT ? video : join(OUT, `kepuli-tv-demo-${LANG}-silent.mp4`);
  recorder = new Recorder(silent);
  await recorder.start();
  await walk();
  await recorder.stop();
  writeFileSync(join(OUT, `kepuli-tv-demo-${LANG}-scenes.json`), JSON.stringify(chapters));
  if (!SILENT) {
    console.log('mixing the voice and the music…');
    await mix(silent, voiceDir, video);
  }

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
