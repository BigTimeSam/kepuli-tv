#!/usr/bin/env node
// A fake Xtream Codes server with invented content: countries and topics,
// channels with a programme guide, movies, and series with episodes. It is
// for screenshots and for developing without an account — every name, plot
// and channel on it is made up, and the media are the gradients that
// dev/mock/media.sh renders.
//
//   node dev/mock/server.mjs           http://127.0.0.1:8790, user demo, password demo
//
// KEPULI_MOCK_PORT and KEPULI_MOCK_HOST override the port and the address to
// listen on; the Dockerfile next to this file sets them for Fly.io, where the
// same server is the demo the Chrome Web Store reviewers are given.
//
// The extension reaches it without a host permission, because every answer
// carries CORS headers; logos and covers load as <img> and need none anyway.
//
// The live channel is HLS: a playlist that slides over the same segments
// forever, so that it never ends. The .ts address answers 404 and the player
// falls back to HLS on its own. The catch-up stream is the same segments
// back to back, played out at real time.

import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MEDIA = join(HERE, 'media');
export const PORT = Number(process.env.KEPULI_MOCK_PORT || 8790);
export const HOST = process.env.KEPULI_MOCK_HOST || '127.0.0.1';
export const USER = 'demo';
export const PASS = 'demo';
const TZ = 'Europe/Helsinki';

/* ------------------------------------------------------------- randomness */

// Everything derives from fixed seeds, so the catalogue is the same on every
// run and a screenshot can be repeated.
function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
}
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}
const pick = (r, list) => list[Math.floor(r() * list.length)];
const between = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

// The clock is frozen at start-up so that "now" in the guide does not drift
// between one request and the next.
const T0 = Date.now();
const localTime = new Intl.DateTimeFormat('sv-SE', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});
const stamp = (ms) => localTime.format(new Date(ms)).replace(',', '');
const secs = (ms) => String(Math.floor(ms / 1000));

/** Behind Fly's proxy the request is plain HTTP; the outside address is not. */
const originOf = (req) => `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;

/* --------------------------------------------------------------- channels */

const COUNTRIES = [
  ['Finland', 'Aurora'], ['Sweden', 'Nordic'], ['Norway', 'Fjord'], ['Denmark', 'Kanal'],
  ['Germany', 'Rhein'], ['United Kingdom', 'Albion'], ['France', 'Lumière'], ['Spain', 'Sol'],
  ['Italy', 'Stella'], ['Netherlands', 'Oranje'], ['USA', 'Liberty'], ['Canada', 'Maple'],
];

const TOPICS = {
  General: ['One', 'Two', 'Three', 'Plus', 'Family'],
  News: ['News 24', 'News', 'Business'],
  Sport: ['Sport 1', 'Sport 2', 'Sport 3', 'Sport Extra', 'Arena'],
  Kids: ['Kids', 'Junior', 'Toons'],
  Movies: ['Cinema', 'Cinema Action', 'Cinema Classic', 'Cinema Nordic'],
  Music: ['Music', 'Hits', 'Live'],
  Documentary: ['Discovery', 'Nature', 'History'],
};

const PROGRAMMES = {
  General: { minutes: [30, 45, 60, 90], titles: ['Morning Show', 'Midday News', 'The Quiz Hour', 'Home & Garden', 'Evening News', 'The Harbour', 'Late Talk', 'Night Film: Paper Moons', 'Cooking with Elina', 'Weekend Magazine', 'Second Winter', 'The Antique Road'] },
  News: { minutes: [30, 30, 60], titles: ['News Now', 'Headlines', 'World Report', 'Business Today', 'Weather Watch', 'The Debate', 'Night Desk', 'Markets Live'] },
  Sport: { minutes: [60, 90, 120, 150], titles: ['Ice Hockey: Aurora Cup', 'Football: Northern League', 'Sports Centre', 'Motorsport Weekly', 'Biathlon World Cup', 'Tennis: Open Series', 'Ski Jumping: Grand Prix', 'Handball: Cup Final'] },
  Kids: { minutes: [25, 30, 45], titles: ['Cartoon Morning', 'Puzzle Pals', 'Adventure Bay', 'Storytime', 'Science Kids', 'Robo Rascals', 'Moon Pony', 'Captain Cloud'] },
  Movies: { minutes: [90, 105, 120, 135], titles: ['The Long Winter', 'Harbour Lights', 'Midnight Express Train', 'Paper Moons', 'The Cartographer', 'Silent Fjord', 'Steel Horizon', 'Northern Lights', 'The Velvet Case', 'Glasshouse'] },
  Music: { minutes: [60, 60, 120], titles: ['Top 40 Countdown', 'Live Session', 'Classic Hits', 'Late Night Beats', 'Unplugged', 'Festival Replay'] },
  Documentary: { minutes: [45, 60, 60, 90], titles: ['Planet Arctic', 'Engineering Giants', 'History Uncovered', 'Wild Coasts', 'Space Frontier', 'Cities of Tomorrow', 'The Deep Blue', 'Railways of Europe'] },
};

const BLURBS = [
  'Part {n} of {m}. {title} continues as the season reaches its turning point.',
  'A look behind the scenes, with guests and viewers\' questions.',
  'Live coverage with studio analysis before and after.',
  'The stories of the day, followed by the weather.',
  'Repeat of the episode first shown last week.',
  'New series. The first of {m} episodes.',
  'From the archive: an episode remastered in HD.',
  'Also available in the catch-up archive for seven days.',
];

const live = { categories: [], channels: [] };
{
  let id = 1000;
  COUNTRIES.forEach(([country, brand], ci) => {
    const r = rng(hash(country));
    const topics = Object.keys(TOPICS).filter((t, i) => i === 0 || t === 'News' || t === 'Sport' || r() < 0.6);
    topics.forEach((topic) => {
      const cat = { category_id: String(100 + ci * 10 + Object.keys(TOPICS).indexOf(topic)), category_name: topic === 'General' ? country : `${country} - ${topic}`, parent_id: 0 };
      live.categories.push(cat);
      const variants = TOPICS[topic].slice(0, between(r, 2, TOPICS[topic].length));
      for (const variant of variants) {
        const name = `${brand} ${variant}${r() < 0.5 ? ' HD' : ''}`;
        const archive = topic === 'News' || topic === 'General' || r() < 0.4;
        live.channels.push({
          num: id - 999, name, stream_type: 'live', stream_id: id, stream_icon: `/img/logo/${id}.svg`,
          epg_channel_id: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '')}.demo`, added: secs(T0 - 90 * 86400e3),
          category_id: cat.category_id, category_ids: [Number(cat.category_id)], custom_sid: '', tv_archive: archive ? 1 : 0,
          direct_source: '', tv_archive_duration: archive ? pick(r, [3, 7]) : 0, topic,
        });
        id++;
      }
    });
  });
}

const epgCache = new Map();
function programmes(channel) {
  if (epgCache.has(channel.stream_id)) return epgCache.get(channel.stream_id);
  const r = rng(channel.stream_id * 7919);
  const pool = PROGRAMMES[channel.topic];
  const out = [];
  let t = Math.floor((T0 - 2 * 86400e3) / 1800e3) * 1800e3;
  const end = T0 + 5 * 86400e3;
  let n = 1;
  while (t < end) {
    const dur = pick(r, pool.minutes) * 60e3;
    const base = pick(r, pool.titles);
    const episodic = r() < 0.5;
    const total = between(r, 6, 12);
    const title = episodic ? `${base} · Episode ${between(r, 1, total)}` : base;
    const desc = pick(r, BLURBS).replace('{n}', String(between(r, 1, total))).replace('{m}', String(total)).replace('{title}', base);
    out.push({
      id: String(channel.stream_id * 1000 + n), epg_id: String(channel.stream_id), title: b64(title), lang: 'en',
      start: stamp(t), end: stamp(t + dur), description: b64(desc), channel_id: channel.epg_channel_id,
      start_timestamp: secs(t), stop_timestamp: secs(t + dur),
      now_playing: t <= T0 && T0 < t + dur ? 1 : 0, has_archive: channel.tv_archive && t + dur <= T0 ? 1 : 0,
    });
    t += dur; n++;
  }
  epgCache.set(channel.stream_id, out);
  return out;
}

/* ------------------------------------------------------- movies and series */

const PEOPLE = ['Elina Koskinen', 'Mikael Sundberg', 'Aino Virtanen', 'Jonas Lindqvist', 'Sara Nyman', 'Tobias Berg', 'Hanna Lehtonen', 'Petter Aas', 'Marco Ferrante', 'Ida Holm', 'Leon Weber', 'Maja Sørensen'];
const PLOTS = [
  'A {role} returns to {place} to settle an old debt, and finds that the town has changed more than she has.',
  'Two strangers share a night train north and a secret neither of them wanted to carry.',
  'When the ice road closes early, a {role} has one week to get the last convoy across.',
  'A missing person case in {place} turns out to be the wrong person missing.',
  'The lighthouse keeper of {place} keeps a log nobody is meant to read — until his {role} does.',
  'A small-town {role} takes on the biggest employer in {place} after a winter that broke the harbour.',
  'An engineer, a poet and a dog set out to map the last unmapped fjord.',
  'Nothing has happened in {place} for forty years. Then the signal starts again.',
];
const ROLES = ['detective', 'schoolteacher', 'harbour master', 'journalist', 'cartographer', 'ferry captain', 'nurse', 'daughter'];
const PLACES = ['Kuopio', 'Kirkenes', 'Visby', 'Skagen', 'Tampere', 'Tromsø', 'Umeå', 'Bornholm', 'Vaasa', 'Aalborg'];

const MOVIES = {
  Action: ['Steel Horizon', 'The Last Convoy', 'Redline Zero', 'Blackout Protocol', 'Iron Tide', 'Crossfire Alley', 'Night Runner', 'Storm Vector'],
  Drama: ['The Long Winter', 'Paper Moons', 'A Quiet Harbour', 'Letters from Kuopio', 'The Cartographer', 'Salt and Silence', 'Where the River Bends', 'Glasshouse'],
  Comedy: ['Wrong Wedding, Right Town', 'The Understudies', 'Office Olympics', 'Dad Band', 'Two Left Feet', 'The Great Sauna Heist'],
  Thriller: ['Midnight Express Train', 'The Ninth Floor', 'Cold Signal', 'Undertow', 'The Lighthouse Keeper', 'Static'],
  Nordic: ['Silent Fjord', 'Northern Lights', 'Ice Road Home', 'Midsummer Ghosts', 'The Archipelago', 'Snow on Black Water'],
  Documentary: ['Planet Arctic', 'Engineering Giants', 'The Deep Blue', 'Wild Coasts', 'Space Frontier', 'Cities of Tomorrow'],
  Kids: ['Adventure Bay: The Movie', 'Puzzle Pals Go Camping', 'The Little Lighthouse', 'Robo Rascals', 'Moon Pony', 'Captain Cloud'],
  Classics: ['Harbour Lights', 'The Velvet Case', 'Smoke and Mirrors', 'The Tin Bridge', 'Autumn in Vaasa', 'Five Days in May'],
};

const SERIES = {
  Drama: ['The Harbour', 'Glasshouse', 'Second Winter', 'The Ward', 'Northbound'],
  Crime: ['Cold Signal', 'Unit 9', 'The Ninth Floor', 'Case Files: Tampere', 'Detective Halla'],
  Comedy: ['Dad Band', 'The Understudies', 'Office Olympics', 'Neighbours of Nowhere'],
  'Nordic Noir': ['Silent Fjord', 'Black Water', 'Midsummer Ghosts', 'The Archipelago Murders', 'Thin Ice'],
  'Sci-Fi': ['Orbital', 'Station Kepler', 'The Long Signal', 'Aurora Protocol'],
  Kids: ['Adventure Bay', 'Puzzle Pals', 'Robo Rascals', 'Moon Pony'],
  Documentary: ['Planet Arctic', 'Engineering Giants', 'Wild Coasts', 'Cities of Tomorrow'],
};
const EPISODE_TITLES = ['The Arrival', 'Thin Ice', 'The Letter', 'Undertow', 'Northbound', 'Glass', 'Static', 'The Long Night', 'Harbour Lights', 'Low Tide', 'Signal Lost', 'Homecoming', 'Ashes', 'The Deal', 'Crossing', 'Silence', "Winter's End", 'The Ferry', 'Open Water', 'Last Light'];

function plotFor(r) {
  return pick(r, PLOTS).replace('{role}', pick(r, ROLES)).replace(/\{place\}/g, pick(r, PLACES));
}
function people(r, n) {
  const list = [...PEOPLE];
  const out = [];
  while (out.length < n) out.push(list.splice(Math.floor(r() * list.length), 1)[0]);
  return out;
}
const rating = (r) => (2.5 + r() * 2.3).toFixed(1);

const vod = { categories: [], movies: [] };
{
  let id = 5000;
  Object.entries(MOVIES).forEach(([genre, titles], gi) => {
    const cat = { category_id: String(300 + gi), category_name: `Movies: ${genre}`, parent_id: 0 };
    vod.categories.push(cat);
    const r = rng(hash(genre));
    titles.forEach((title, i) => {
      const year = genre === 'Classics' ? between(r, 1958, 1979) : between(r, 2009, 2026);
      const stars = rating(r);
      // The last title of each genre is an AVI (marked unplayable in the list); the
      // first two are MP4, so that the screenshots' picks always play natively.
      const ext = i === titles.length - 1 ? 'avi' : i < 2 ? 'mp4' : r() < 0.4 ? 'mkv' : 'mp4';
      vod.movies.push({
        num: id - 4999, name: `${title} (${year})`, title, stream_type: 'movie', stream_id: id, stream_icon: `/img/poster/movie/${id}.svg`,
        rating: stars, rating_5based: Number(stars), added: secs(T0 - between(r, 1, 400) * 86400e3), category_id: cat.category_id,
        category_ids: [Number(cat.category_id)], container_extension: ext, custom_sid: '', direct_source: '',
        year, genre, plot: plotFor(r), cast: people(r, 4).join(', '), director: people(r, 1)[0],
        duration: between(r, 84, 142),
      });
      id++;
    });
  });
}

const series = { categories: [], list: [], info: new Map() };
// The second episode of every first season carries AC-3 5.1 sound
// (episode-ac3.mkv from dev/mock/media.sh), so that the route the player
// decodes itself — the wasm decoder, then the browser's own encoder, AAC in
// Chrome and Opus in Firefox — is one click away in either browser.
export const AC3_EPISODES = new Set();
{
  let id = 7000;
  let epId = 70000;
  Object.entries(SERIES).forEach(([genre, titles], gi) => {
    const cat = { category_id: String(400 + gi), category_name: `Series: ${genre}`, parent_id: 0 };
    series.categories.push(cat);
    const r = rng(hash('series ' + genre));
    for (const title of titles) {
      const year = between(r, 2012, 2026);
      const stars = rating(r);
      const plot = plotFor(r);
      const entry = {
        num: id - 6999, name: title, series_id: id, cover: `/img/poster/series/${id}.svg`, plot, cast: people(r, 5).join(', '),
        director: people(r, 1)[0], genre, releaseDate: `${year}-${String(between(r, 1, 12)).padStart(2, '0')}-${String(between(r, 1, 28)).padStart(2, '0')}`,
        last_modified: secs(T0 - between(r, 1, 60) * 86400e3), rating: stars, rating_5based: Number(stars),
        backdrop_path: [], youtube_trailer: '', episode_run_time: String(pick(r, [22, 28, 42, 48, 55])), category_id: cat.category_id,
        category_ids: [Number(cat.category_id)],
      };
      series.list.push(entry);
      const seasons = titles.indexOf(title) === 0 ? 3 : between(r, 1, 3);   // the first of each genre has seasons to show
      const episodes = {};
      const seasonList = [];
      for (let s = 1; s <= seasons; s++) {
        const count = between(r, 6, 10);
        seasonList.push({ season_number: s, name: `Season ${s}`, cover: entry.cover, episode_count: count, air_date: `${year + s - 1}-09-01` });
        episodes[String(s)] = [];
        for (let e = 1; e <= count; e++) {
          const mins = Number(entry.episode_run_time);
          const mkv = e === 1 || r() < 0.7;   // the first episode is always the MKV with subtitles
          const ac3 = s === 1 && e === 2;     // the second is the MKV with AC-3 sound
          if (ac3) AC3_EPISODES.add(String(epId));
          episodes[String(s)].push({
            id: String(epId), episode_num: e, title: pick(r, EPISODE_TITLES), container_extension: mkv || ac3 ? 'mkv' : 'mp4',
            info: {
              movie_image: entry.cover, plot: plotFor(r), duration_secs: mins * 60 + between(r, 0, 59), duration: `00:${mins}:00`,
              air_date: `${year + s - 1}-${String(between(r, 9, 12)).padStart(2, '0')}-${String(between(r, 1, 28)).padStart(2, '0')}`,
              rating: stars, bitrate: between(r, 2400, 5600),
              video: { codec_name: 'h264', width: 1920, height: 1080 },
              audio: ac3 ? { codec_name: 'ac3', channels: 6 } : { codec_name: 'aac', channels: 2 },
            },
            custom_sid: '', added: entry.last_modified, season: s, direct_source: '',
          });
          epId++;
        }
      }
      series.info.set(String(id), { seasons: seasonList, info: { ...entry, cover: entry.cover }, episodes });
      id++;
    }
  });
}

/* ----------------------------------------------------------------- images */

const PALETTES = [['#7c5cff', '#22d3ee'], ['#5b3fd6', '#e0a458'], ['#0f6b5c', '#22d3ee'], ['#8f74ff', '#ff6b9d'], ['#1b4f9c', '#7c5cff'], ['#b5451b', '#ffc857'], ['#2d6a4f', '#95d5b2'], ['#3a0ca3', '#f72585']];
const escapeXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function wrap(text, width) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && (line + ' ' + word).length > width) { lines.push(line); line = word; } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

function logoSvg(channel) {
  const [c0, c1] = PALETTES[hash(channel.name) % PALETTES.length];
  const [first, ...rest] = channel.name.replace(/ HD$/, '').split(' ');
  const mono = first[0] + (rest.find((w) => /^\d/.test(w)) || rest[0] || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="140" viewBox="0 0 240 140">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c0}"/><stop offset="1" stop-color="${c1}"/></linearGradient></defs>
<rect width="240" height="140" rx="20" fill="url(#g)"/>
<text x="120" y="88" text-anchor="middle" font-family="-apple-system, Helvetica, Arial, sans-serif" font-size="60" font-weight="700" fill="#fff">${escapeXml(mono)}</text>
</svg>`;
}

function posterSvg(title, subtitle) {
  const [c0, c1] = PALETTES[hash(title) % PALETTES.length];
  const lines = wrap(title, 14);
  const text = lines.map((l, i) => `<text x="150" y="${300 + i * 40 - (lines.length - 1) * 20}" text-anchor="middle" font-family="-apple-system, Helvetica, Arial, sans-serif" font-size="34" font-weight="700" fill="#fff">${escapeXml(l)}</text>`).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450">
<defs><linearGradient id="g" x1="0" y1="0" x2="0.6" y2="1"><stop offset="0" stop-color="${c0}"/><stop offset="1" stop-color="${c1}"/></linearGradient></defs>
<rect width="300" height="450" fill="url(#g)"/>
<circle cx="230" cy="90" r="70" fill="#fff" fill-opacity="0.12"/>
<circle cx="60" cy="380" r="110" fill="#000" fill-opacity="0.15"/>
${text}
<text x="150" y="410" text-anchor="middle" font-family="-apple-system, Helvetica, Arial, sans-serif" font-size="18" fill="#fff" fill-opacity="0.75">${escapeXml(subtitle)}</text>
</svg>`;
}

/* ----------------------------------------------------------------- server */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Range, Content-Type, X-Requested-With',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
  'Access-Control-Max-Age': '86400',
};

function send(res, status, body, type = 'application/json; charset=utf-8') {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { ...CORS, 'Content-Type': type, 'Content-Length': Buffer.byteLength(data), 'Cache-Control': 'no-store' });
  res.end(data);
}

function sendFile(req, res, name, type) {
  const file = name.startsWith('/') ? name : join(MEDIA, name);
  if (!existsSync(file)) return send(res, 404, `${name} is missing: run sh dev/mock/media.sh`, 'text/plain');
  const size = statSync(file).size;
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  let start = 0, end = size - 1, status = 200;
  if (m && (m[1] || m[2])) {
    if (m[1] === '') { start = Math.max(0, size - Number(m[2])); }
    else { start = Number(m[1]); if (m[2] !== '') end = Math.min(Number(m[2]), size - 1); }
    if (start > end || start >= size) { res.writeHead(416, { ...CORS, 'Content-Range': `bytes */${size}` }); return res.end(); }
    status = 206;
  }
  const headers = { ...CORS, 'Content-Type': type, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
  if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  res.writeHead(status, headers);
  if (req.method === 'HEAD') return res.end();
  createReadStream(file, { start, end }).pipe(res);
}

/* ------------------------------------------------------------ live channel */

// The segments from dev/mock/media.sh, with their durations from the VOD
// playlist ffmpeg wrote next to them.
const HLS = join(MEDIA, 'hls');
const SEGMENTS = (() => {
  let text = '';
  try { text = readFileSync(join(HLS, 'index.m3u8'), 'utf8'); } catch { return []; }
  const out = [];
  let dur = 0;
  for (const line of text.split('\n')) {
    if (line.startsWith('#EXTINF:')) dur = Number(line.slice(8).split(',')[0]);
    else if (line && !line.startsWith('#')) out.push({ file: join(HLS, line.trim()), dur });
  }
  return out;
})();
const LOOP_SECONDS = SEGMENTS.reduce((sum, s) => sum + s.dur, 0);

/**
 * The live playlist: a window of the last few segments of an endless
 * sequence that wraps around the loop, with a discontinuity marked at each
 * wrap so that the player accepts the timestamps starting over.
 */
function livePlaylist() {
  const n = SEGMENTS.length;
  const elapsed = (Date.now() - T0) / 1000;
  const loops = Math.floor(elapsed / LOOP_SECONDS);
  let t = elapsed - loops * LOOP_SECONDS;
  let i = 0;
  while (i < n - 1 && t >= SEGMENTS[i].dur) { t -= SEGMENTS[i].dur; i++; }
  const current = loops * n + i;
  const first = Math.max(0, current - 5);
  const lines = [
    '#EXTM3U', '#EXT-X-VERSION:3',
    `#EXT-X-TARGETDURATION:${Math.ceil(Math.max(...SEGMENTS.map((s) => s.dur)))}`,
    `#EXT-X-MEDIA-SEQUENCE:${first}`,
    `#EXT-X-DISCONTINUITY-SEQUENCE:${first === 0 ? 0 : Math.floor((first - 1) / n)}`,
  ];
  for (let k = first; k <= current; k++) {
    if (k > 0 && k % n === 0) lines.push('#EXT-X-DISCONTINUITY');
    lines.push(`#EXTINF:${SEGMENTS[k % n].dur.toFixed(3)},`, `seg/${k}.ts`);
  }
  return lines.join('\n') + '\n';
}

/**
 * The catch-up stream: the segments back to back, which is a valid
 * continuous transport stream, played out a little faster than real time
 * after a burst — served whole, the download would finish in a second and
 * the player would take the end of it for a dropped source.
 */
async function sendTimeshift(req, res) {
  const total = SEGMENTS.reduce((sum, s) => sum + statSync(s.file).size, 0);
  const bytesPerSecond = total / LOOP_SECONDS * 1.25;
  const BURST = 2 * 1024 * 1024;
  res.writeHead(200, { ...CORS, 'Content-Type': 'video/mp2t', 'Cache-Control': 'no-store' });
  if (req.method === 'HEAD') return res.end();
  const t0 = Date.now();
  let sent = 0;
  for (const segment of SEGMENTS) {
    const data = readFileSync(segment.file);
    for (let offset = 0; offset < data.length && !res.destroyed; offset += 32 * 1024) {
      const chunk = data.subarray(offset, offset + 32 * 1024);
      sent += chunk.length;
      res.write(chunk);
      const wait = t0 + Math.max(0, sent - BURST) / bytesPerSecond * 1000 - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
    if (res.destroyed) return;
  }
  res.end();
}

function account(req) {
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const [host, port] = String(req.headers.host).split(':');
  return {
    user_info: {
      username: USER, password: PASS, message: 'Demo server — nothing here is real', auth: 1, status: 'Active',
      exp_date: secs(T0 + 200 * 86400e3), is_trial: '0', active_cons: '0', created_at: secs(T0 - 120 * 86400e3),
      max_connections: '1', allowed_output_formats: ['ts', 'm3u8'],
    },
    server_info: {
      url: host, port: port || (proto === 'https' ? '443' : '80'), https_port: proto === 'https' ? (port || '443') : '',
      server_protocol: proto, rtmp_port: '', timezone: TZ, timestamp_now: secs(T0), time_now: stamp(T0),
    },
  };
}

const publicChannel = (origin, c) => ({ ...c, stream_icon: origin + c.stream_icon, topic: undefined });
const publicMovie = (origin, m) => ({ num: m.num, name: m.name, stream_type: m.stream_type, stream_id: m.stream_id, stream_icon: origin + m.stream_icon, rating: m.rating, rating_5based: m.rating_5based, added: m.added, category_id: m.category_id, category_ids: m.category_ids, container_extension: m.container_extension, custom_sid: m.custom_sid, direct_source: m.direct_source });
const publicSeries = (origin, s) => ({ ...s, cover: origin + s.cover });

function api(req, res, url) {
  const q = url.searchParams;
  if (q.get('username') !== USER || q.get('password') !== PASS) return send(res, 512, { user_info: { auth: 0 } });
  const origin = originOf(req);
  const withCategory = (list) => (q.get('category_id') ? list.filter((x) => x.category_id === q.get('category_id')) : list);
  switch (q.get('action')) {
    case 'get_live_categories': return send(res, 200, live.categories);
    case 'get_vod_categories': return send(res, 200, vod.categories);
    case 'get_series_categories': return send(res, 200, series.categories);
    case 'get_live_streams': return send(res, 200, withCategory(live.channels).map((c) => publicChannel(origin, c)));
    case 'get_vod_streams': return send(res, 200, withCategory(vod.movies).map((m) => publicMovie(origin, m)));
    case 'get_series': return send(res, 200, withCategory(series.list).map((s) => publicSeries(origin, s)));
    case 'get_series_info': {
      const info = series.info.get(q.get('series_id'));
      if (!info) return send(res, 200, { seasons: [], info: {}, episodes: {} });
      const episodes = Object.fromEntries(Object.entries(info.episodes).map(([s, list]) => [s, list.map((e) => ({ ...e, info: { ...e.info, movie_image: origin + e.info.movie_image } }))]));
      return send(res, 200, { seasons: info.seasons.map((s) => ({ ...s, cover: origin + s.cover })), info: publicSeries(origin, info.info), episodes });
    }
    case 'get_vod_info': {
      const m = vod.movies.find((x) => String(x.stream_id) === q.get('vod_id'));
      if (!m) return send(res, 200, { info: {}, movie_data: {} });
      return send(res, 200, {
        info: {
          movie_image: origin + m.stream_icon, cover_big: origin + m.stream_icon, plot: m.plot, cast: m.cast, director: m.director, genre: m.genre,
          releasedate: `${m.year}-01-01`, rating: m.rating, duration_secs: m.duration * 60, duration: `${Math.floor(m.duration / 60)}:${String(m.duration % 60).padStart(2, '0')}:00`,
          video: { codec_name: 'h264', width: 1920, height: 1080 }, audio: { codec_name: 'aac', channels: 2 }, bitrate: 4200, youtube_trailer: '',
        },
        movie_data: { stream_id: m.stream_id, name: m.name, added: m.added, category_id: m.category_id, container_extension: m.container_extension, custom_sid: '', direct_source: '' },
      });
    }
    case 'get_short_epg': {
      const c = live.channels.find((x) => String(x.stream_id) === q.get('stream_id'));
      if (!c) return send(res, 200, { epg_listings: [] });
      const limit = Number(q.get('limit')) || 4;
      return send(res, 200, { epg_listings: programmes(c).filter((p) => Number(p.stop_timestamp) * 1000 > T0).slice(0, limit) });
    }
    case 'get_simple_data_table': {
      const c = live.channels.find((x) => String(x.stream_id) === q.get('stream_id'));
      return send(res, 200, { epg_listings: c ? programmes(c) : [] });
    }
    default: return send(res, 200, account(req));   // like the real thing: an unknown action returns the account
  }
}

function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  if (path === '/player_api.php') return api(req, res, url);

  let m;
  if ((m = /^\/img\/logo\/(\d+)\.svg$/.exec(path))) {
    const c = live.channels.find((x) => String(x.stream_id) === m[1]);
    return c ? send(res, 200, logoSvg(c), 'image/svg+xml') : send(res, 404, 'no such logo', 'text/plain');
  }
  if ((m = /^\/img\/poster\/movie\/(\d+)\.svg$/.exec(path))) {
    const x = vod.movies.find((v) => String(v.stream_id) === m[1]);
    return x ? send(res, 200, posterSvg(x.title, `${x.year} · ${x.genre}`), 'image/svg+xml') : send(res, 404, 'no such poster', 'text/plain');
  }
  if ((m = /^\/img\/poster\/series\/(\d+)\.svg$/.exec(path))) {
    const x = series.list.find((s) => String(s.series_id) === m[1]);
    return x ? send(res, 200, posterSvg(x.name, `${x.releaseDate.slice(0, 4)} · ${x.genre}`), 'image/svg+xml') : send(res, 404, 'no such poster', 'text/plain');
  }

  // Streams. The credentials sit in the path, as in the real URL scheme.
  const auth = `/${USER}/${PASS}/`;
  if (!path.includes(auth)) return send(res, 401, 'wrong credentials', 'text/plain');
  if (!SEGMENTS.length && (path.startsWith('/live/') || path.startsWith('/timeshift/'))) {
    return send(res, 404, 'the live channel is missing: run sh dev/mock/media.sh', 'text/plain');
  }
  if ((m = /^\/live\/[^/]+\/[^/]+\/seg\/(\d+)\.ts$/.exec(path))) {
    return sendFile(req, res, SEGMENTS[Number(m[1]) % SEGMENTS.length].file, 'video/mp2t');
  }
  if (/^\/live\/.*\.m3u8$/.test(path)) return send(res, 200, livePlaylist(), 'application/vnd.apple.mpegurl');
  if (/^\/live\/.*\.ts$/.test(path)) return send(res, 404, 'the demo channel is HLS; the player falls back to it', 'text/plain');
  if (path.startsWith('/timeshift/')) return sendTimeshift(req, res);
  if ((m = /^\/(movie|series)\/.*\.(\w+)$/.exec(path))) {
    if (m[2] === 'mkv') {
      const id = path.slice(path.lastIndexOf('/') + 1, -4);
      const ac3 = AC3_EPISODES.has(id) && existsSync(join(MEDIA, 'episode-ac3.mkv'));
      return sendFile(req, res, ac3 ? 'episode-ac3.mkv' : 'episode.mkv', 'video/x-matroska');
    }
    if (m[2] === 'mp4') return sendFile(req, res, 'movie.mp4', 'video/mp4');
    return send(res, 404, `the demo server has no ${m[2]} files`, 'text/plain');
  }
  send(res, 404, 'not found', 'text/plain');
}

export function startMockServer(port = PORT) {
  return new Promise((resolve, reject) => {
    const server = createServer(handle);
    server.on('error', reject);
    server.listen(port, HOST, () => resolve(server));
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await startMockServer(PORT);
  console.log(`Mock Xtream server on http://${HOST}:${PORT}  (user ${USER}, password ${PASS})`);
  console.log(`${live.channels.length} channels in ${live.categories.length} categories, ${vod.movies.length} movies, ${series.list.length} series` +
    (SEGMENTS.length ? `, live loop of ${LOOP_SECONDS} s in ${SEGMENTS.length} segments` : ', NO MEDIA: run sh dev/mock/media.sh'));
}
