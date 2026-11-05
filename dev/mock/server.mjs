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
// falls back to HLS on its own — unless KEPULI_MOCK_LIVE_TS is set, when it
// is one endless MPEG-TS connection as a provider's is, counted against the
// account, and an HLS viewer is counted by session. The catch-up stream is the same segments
// back to back, played out at real time.

import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { Transform } from 'node:stream';
import { gzipSync } from 'node:zlib';
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
// between one request and the next. KEPULI_MOCK_NOW (an ISO time) sets that
// moment, so that the programme guide is the same on every run: the visual
// check (dev/visualcheck.mjs) sets it, with the page's clock moved to match.
export const T0 = process.env.KEPULI_MOCK_NOW ? Date.parse(process.env.KEPULI_MOCK_NOW) : Date.now();
if (Number.isNaN(T0)) throw new Error(`KEPULI_MOCK_NOW is not a time: ${process.env.KEPULI_MOCK_NOW}`);
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

// KEPULI_MOCK_EXTRA_CHANNEL: while set, Finland's own category holds one
// channel more — a provider adding a channel while a player has the list
// open, for Refresh to find.
const EXTRA_CHANNEL = {
  num: 9999, name: 'Aurora Newcomer', stream_type: 'live', stream_id: 9999, stream_icon: '/img/logo/9999.svg',
  epg_channel_id: '', added: secs(T0), category_id: live.categories[0].category_id,
  category_ids: [Number(live.categories[0].category_id)], custom_sid: '', tv_archive: 0, direct_source: '', tv_archive_duration: 0, topic: 'General',
};
const liveChannels = () => (process.env.KEPULI_MOCK_EXTRA_CHANNEL ? [...live.channels, EXTRA_CHANNEL] : live.channels);

// KEPULI_MOCK_COUNTRY_PREFIX: while set, every channel's name in the Xtream
// list begins with its country's code, "FI: Aurora One", "SE: Nordic News",
// as many providers write them; the player tidies each by its own country's
// rules (the guidenames scenario).
const COUNTRY_CODES = { Finland: 'FI', Sweden: 'SE', Norway: 'NO', Denmark: 'DK', Germany: 'DE', 'United Kingdom': 'UK', France: 'FR', Spain: 'ES', Italy: 'IT', Netherlands: 'NL', USA: 'US', Canada: 'CA' };
const countryOfCategory = (id) => live.categories.find((c) => c.category_id === String(id))?.category_name.split(' - ')[0];
const prefixed = (c) => {
  if (!process.env.KEPULI_MOCK_COUNTRY_PREFIX) return c;
  const code = COUNTRY_CODES[countryOfCategory(c.category_id)];
  return code ? { ...c, name: `${code}: ${c.name}` } : c;
};

const epgCache = new Map();
function programmes(channel) {
  if (epgCache.has(channel.stream_id)) return epgCache.get(channel.stream_id);
  const r = rng(channel.stream_id * 7919);
  const pool = PROGRAMMES[channel.topic];
  const out = [];
  let t = Math.floor((T0 - Math.max(2, channel.tv_archive_duration || 0) * 86400e3) / 1800e3) * 1800e3;
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
        rating: (Number(stars) * 2).toFixed(1), rating_5based: Number(stars), added: secs(T0 - between(r, 1, 400) * 86400e3), category_id: cat.category_id,
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
// The third carries three audio tracks (episode-multi.mkv): English AAC as
// the file's default, Finnish AAC, and an English AC-3 commentary. That is
// what the choice in js/audio.js has to get right — a decoded track and a
// commentary to pass over, and a Finnish track to find when it is asked
// for.
export const MULTI_EPISODES = new Set();
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
        last_modified: secs(T0 - between(r, 1, 60) * 86400e3), rating: (Number(stars) * 2).toFixed(1), rating_5based: Number(stars),
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
          const multi = s === 1 && e === 3;   // the third has three audio tracks
          if (ac3) AC3_EPISODES.add(String(epId));
          if (multi) MULTI_EPISODES.add(String(epId));
          episodes[String(s)].push({
            id: String(epId), episode_num: e, title: pick(r, EPISODE_TITLES), container_extension: process.env.KEPULI_MOCK_EPISODE_EXT || (mkv || ac3 || multi ? 'mkv' : 'mp4'),
            info: {
              movie_image: entry.cover, plot: plotFor(r), duration_secs: mins * 60 + between(r, 0, 59), duration: `00:${mins}:00`,
              air_date: `${year + s - 1}-${String(between(r, 9, 12)).padStart(2, '0')}-${String(between(r, 1, 28)).padStart(2, '0')}`,
              rating: (Number(stars) * 2).toFixed(1), bitrate: between(r, 2400, 5600),
              video: { codec_name: 'h264', width: 1920, height: 1080 },
              audio: ac3 ? { codec_name: 'ac3', channels: 6 } : { codec_name: 'aac', channels: 2 },
              audio_tracks: multi ? 3 : 1,
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
  'Access-Control-Allow-Headers': 'Range, Content-Type, X-Requested-With, Authorization, X-User-Agent',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
  'Access-Control-Max-Age': '86400',
};

function send(res, status, body, type = 'application/json; charset=utf-8') {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { ...CORS, 'Content-Type': type, 'Content-Length': Buffer.byteLength(data), 'Cache-Control': 'no-store' });
  res.end(data);
}

// A whole-list answer whose headers come at once and whose body only after
// a delay: a server that accepted and went quiet, for dev/playcheck.mjs.
function sendLate(res, body, ms) {
  const data = JSON.stringify(body);
  res.writeHead(200, { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data), 'Cache-Control': 'no-store' });
  const timer = setTimeout(() => res.end(data), ms);
  res.on('close', () => clearTimeout(timer));
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
  // KEPULI_MOCK_CUT_AT, bytes: the next whole-file download is cut off
  // there, the connection dropped mid-body the way a flaky server drops it.
  // Once only; the resume that follows is served whole.
  const cutAt = Number(process.env.KEPULI_MOCK_CUT_AT || 0);
  const cut = cutAt > 0 && req.headers.range === 'bytes=0-';
  if (cut) process.env.KEPULI_MOCK_CUT_AT = '';
  const body = createReadStream(file, { start, end: cut ? Math.min(end, start + cutAt - 1) : end, highWaterMark: 16 * 1024 });
  // KEPULI_MOCK_THROTTLE, bytes per second, sends the media slowly — the
  // way a real server does. A throttle in the browser would not do for
  // dev/playcheck.mjs: DevTools takes the whole answer at full speed and
  // doles it out, so cutting the server underneath changes nothing.
  const rate = Number(process.env.KEPULI_MOCK_THROTTLE || 0);
  const throttled = rate > 0
    ? body.pipe(new Transform({
      transform(chunk, _enc, done) { setTimeout(() => done(null, chunk), (chunk.length * 1000) / rate); },
    }))
    : body;
  // KEPULI_MOCK_HOLE, "from-to" as shares of the file ("0.35-0.5"): that
  // stretch of every Matroska file is sent as zeros — what a provider's copy
  // of a film was measured to hold, 8 MiB of zeros at a time, for the
  // player to read past (resync in js/mkv.js).
  const hole = /^([\d.]+)-([\d.]+)$/.exec(process.env.KEPULI_MOCK_HOLE || '');
  let at = start;
  const out = hole && type === 'video/x-matroska'
    ? throttled.pipe(new Transform({
      transform(chunk, _enc, done) {
        const from = Math.floor(size * Number(hole[1]));
        const to = Math.floor(size * Number(hole[2]));
        const copy = Buffer.from(chunk);
        for (let i = Math.max(0, from - at); i < Math.min(copy.length, to - at); i++) copy[i] = 0;
        at += chunk.length;
        done(null, copy);
      },
    }))
    : throttled;
  out.pipe(res, { end: !cut });
  if (cut) out.on('end', () => res.destroy());
}

/* ------------------------------------------------------------- connections */

// The account allows one connection, and a real server goes on counting one
// for a while after the player has closed it. The count is reported as
// active_cons in any case, and every stream asked for while another was
// still open is kept, for dev/playcheck.mjs to find the player's overlaps.
// KEPULI_MOCK_LIMIT turns the limit on: a stream asked for while the count
// is full is refused with 400, as the provider refuses it.
// KEPULI_MOCK_RELEASE_MS keeps a closed stream counted that long.
// KEPULI_MOCK_FULL says how a full count answers instead of the 400:
// 'silent' accepts the stream and sends nothing until the player closes it,
// 'close' accepts it and ends it at once, empty — both of them providers'
// ways too. Neither stream is counted.
// The playlists and segments of the live channel are not counted by
// request: the provider counts an HLS viewer by session (see admitHls,
// with KEPULI_MOCK_LIVE_TS).
const MAX_CONNECTIONS = 1;
// The browser's abort reaches the server a moment after the next request
// may have: within this a full count is waited on, not refused.
const ABORT_GRACE_MS = 300;
let connections;
const hlsSessions = new Map();     // HLS viewers: channel id → the time of its last request

function resetConnections() {
  connections = { open: new Set(), lingering: 0, peak: 0, refused: [], overlaps: [], hls: 0 };
  hlsSessions.clear();
}
resetConnections();

/** What the server has seen of the streams, for dev/playcheck.mjs. */
export function connectionStats() {
  return { open: connections.open.size, counted: counted(), peak: connections.peak, hls: connections.hls,
    refused: connections.refused.slice(), overlaps: connections.overlaps.slice() };
}

// With KEPULI_MOCK_LIVE_TS the HLS viewer is counted too, as a provider
// counts it: by session, from its first playlist until no request has come
// for HLS_SESSION_MS. There is no connection to close, so leaving a channel
// leaves its session counted until then.
const HLS_SESSION_MS = 15000;
const hlsCounted = () => {
  for (const [id, at] of hlsSessions) if (Date.now() - at > HLS_SESSION_MS) hlsSessions.delete(id);
  return hlsSessions.size;
};
const counted = () => connections.open.size + connections.lingering + hlsCounted();

/** A playlist request of an HLS viewer: its session kept, or a new one admitted. */
function admitHls(req, res, id) {
  if (!process.env.KEPULI_MOCK_LIVE_TS) return true;
  const max = process.env.KEPULI_MOCK_LIMIT ? MAX_CONNECTIONS : Infinity;
  if (!hlsSessions.has(id) && counted() >= max) {
    connections.refused.push(`${req.url} hls at ${counted()}/${max}`);
    send(res, 400, 'every connection is in use', 'text/plain');
    return false;
  }
  hlsSessions.set(id, Date.now());
  return true;
}

async function admit(req, res) {
  const max = process.env.KEPULI_MOCK_LIMIT ? MAX_CONNECTIONS : Infinity;
  const at = Date.now();
  while (connections.open.size && Date.now() - at < ABORT_GRACE_MS) await new Promise((r) => setTimeout(r, 25));
  const range = req.headers.range || 'whole';
  if (connections.open.size) connections.overlaps.push(`${req.url} ${range} over ${[...connections.open].join(', ')}`);
  if (counted() >= max) {
    const full = process.env.KEPULI_MOCK_FULL;
    connections.refused.push(`${req.url} ${range} at ${counted()}/${max}${full ? ` ${full}` : ''}`);
    if (full === 'silent' || full === 'close') {
      res.writeHead(200, { ...CORS, 'Content-Type': 'video/mp2t', 'Cache-Control': 'no-store' });
      if (full === 'close') res.end();
    } else {
      send(res, 400, 'every connection is in use', 'text/plain');
    }
    return false;
  }
  const name = `${req.url} ${range}`;
  connections.open.add(name);
  connections.peak = Math.max(connections.peak, connections.open.size);
  res.on('close', () => {
    connections.open.delete(name);
    const lag = Number(process.env.KEPULI_MOCK_RELEASE_MS || 0);
    if (lag > 0) { connections.lingering++; setTimeout(() => { connections.lingering--; }, lag); }
  });
  return true;
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
async function sendTimeshift(req, res, { archive = false } = {}) {
  const total = SEGMENTS.reduce((sum, s) => sum + statSync(s.file).size, 0);
  // KEPULI_MOCK_TS_PACE, a multiple of real time: below 1 the stream comes
  // slower than it plays, without the opening burst — a connection that
  // cannot keep up with the channel, for dev/playcheck.mjs.
  const pace = Number(process.env.KEPULI_MOCK_TS_PACE || 0);
  const bytesPerSecond = total / LOOP_SECONDS * (pace > 0 ? pace : 1.25);
  const BURST = pace > 0 && pace < 1 ? 0 : 2 * 1024 * 1024;
  res.writeHead(200, { ...CORS, 'Content-Type': 'video/mp2t', 'Cache-Control': 'no-store' });
  if (req.method === 'HEAD') return res.end();
  // KEPULI_MOCK_HANG_AT, bytes: the next archive stream stops sending there
  // and keeps the connection open, saying nothing more — a server gone
  // quiet under an open socket, which raises no error in the player. Once
  // only; the stream asked for after it is served whole.
  const hangAt = archive ? Number(process.env.KEPULI_MOCK_HANG_AT || 0) : 0;
  if (hangAt > 0) process.env.KEPULI_MOCK_HANG_AT = '';
  const t0 = Date.now();
  let sent = 0;
  for (const segment of SEGMENTS) {
    const data = readFileSync(segment.file);
    for (let offset = 0; offset < data.length && !res.destroyed; offset += 32 * 1024) {
      if (hangAt > 0 && sent >= hangAt) return;
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
      exp_date: secs(T0 + 200 * 86400e3), is_trial: '0', active_cons: String(counted()), created_at: secs(T0 - 120 * 86400e3),
      max_connections: String(MAX_CONNECTIONS), allowed_output_formats: ['ts', 'm3u8'],
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

// KEPULI_MOCK_BULK=N: N invented films more in Movies: Nordic, for the size a
// provider's catalogue reaches (one measured had 55,000): the perf scenario
// times the list and the scroll with it. Made once per N and kept, like the
// rest, from fixed numbers rather than chance.
let bulk = { n: 0, list: [] };
// KEPULI_MOCK_VERSIONS: the first film twice more, as providers list one
// film in several files (the same name as an MKV, and "4K" in the name),
// and two later parts of it ("<title>: The Return", "<title> 2"), for the
// covers' version tags and the details' other versions and parts; its
// details then give an original title and a language for the sound
// (filmDetails scenario).
function versionsOf(movies) {
  if (!process.env.KEPULI_MOCK_VERSIONS) return movies;
  const first = movies[0];
  const copy = (id, name, year, ext) => ({ ...first, num: id - 4999, stream_id: id, name, year, container_extension: ext });
  return [...movies,
    copy(90001, first.name, first.year, 'mkv'),
    copy(90002, `${first.title} 4K (${first.year})`, first.year, first.container_extension),
    copy(90003, `${first.title}: The Return (${first.year + 3})`, first.year + 3, 'mp4'),
    copy(90004, `${first.title} 2 (${first.year + 5})`, first.year + 5, 'mp4')];
}

function moviesWithBulk() {
  const n = Number(process.env.KEPULI_MOCK_BULK) || 0;
  if (!n) return versionsOf(vod.movies);
  if (bulk.n !== n) {
    const nordic = vod.categories.find((c) => c.category_name === 'Movies: Nordic');
    bulk = { n, list: Array.from({ length: n }, (_, i) => ({
      num: 100000 + i, name: `Archive Film ${String(i + 1).padStart(5, '0')} (${2000 + (i % 26)})`, title: `Archive Film ${i + 1}`,
      stream_type: 'movie', stream_id: 100000 + i, stream_icon: `/img/poster/movie/${5000 + (i % 40)}.svg`,
      rating: String(4 + (i % 6)), rating_5based: 2 + (i % 6) / 2, added: secs(T0 - (i % 400) * 86400e3),
      category_id: nordic.category_id, category_ids: [Number(nordic.category_id)], container_extension: 'mp4', custom_sid: '', direct_source: '',
    })) };
  }
  return versionsOf([...vod.movies, ...bulk.list]);
}

function api(req, res, url) {
  const q = url.searchParams;
  if (q.get('username') !== USER || q.get('password') !== PASS) return send(res, 512, { user_info: { auth: 0 } });
  const origin = originOf(req);
  const withCategory = (list) => (q.get('category_id') ? list.filter((x) => x.category_id === q.get('category_id')) : list);
  // KEPULI_MOCK_SLOW_LIST, milliseconds: the whole list of a type arrives
  // late, one category's list at once.
  const slow = Number(process.env.KEPULI_MOCK_SLOW_LIST || 0);
  // KEPULI_MOCK_FAIL_LISTS: every stream list answers 500 while set — the
  // lists fail, the streams and the rest keep working.
  const sendList = (list) => (process.env.KEPULI_MOCK_FAIL_LISTS ? send(res, 500, { error: 'as asked' })
    : slow > 0 && !q.get('category_id') ? sendLate(res, list, slow) : send(res, 200, list));
  switch (q.get('action')) {
    case 'get_live_categories': return send(res, 200, live.categories);
    case 'get_vod_categories': return send(res, 200, vod.categories);
    case 'get_series_categories': return send(res, 200, series.categories);
    case 'get_live_streams': return sendList(withCategory(liveChannels()).map((c) => publicChannel(origin, prefixed(c))));
    case 'get_vod_streams': return sendList(withCategory(moviesWithBulk()).map((m) => publicMovie(origin, m)));
    case 'get_series': return sendList(withCategory(series.list).map((s) => publicSeries(origin, s)));
    case 'get_series_info': {
      const info = series.info.get(q.get('series_id'));
      if (!info) return send(res, 200, { seasons: [], info: {}, episodes: {} });
      // KEPULI_MOCK_EPISODE_NAMES: episodes named as many providers name
      // them, with the series' name and the code in front ("Silent Fjord –
      // S01E01", "Silent Fjord S01E02 - Winter's End"), every third with no
      // title of its own; for the series page to tidy (episodeNames scenario).
      const named = (e, s) => {
        if (!process.env.KEPULI_MOCK_EPISODE_NAMES) return e.title;
        const code = `S${String(s).padStart(2, '0')}E${String(e.episode_num).padStart(2, '0')}`;
        return e.episode_num % 3 === 1 ? `${info.info.name} – ${code}` : `${info.info.name} ${code} - ${e.title}`;
      };
      const episodes = Object.fromEntries(Object.entries(info.episodes).map(([s, list]) => [s, list.map((e) => ({ ...e, title: named(e, s), info: { ...e.info, movie_image: origin + e.info.movie_image } }))]));
      return send(res, 200, { seasons: info.seasons.map((s) => ({ ...s, cover: origin + s.cover })), info: publicSeries(origin, info.info), episodes });
    }
    case 'get_vod_info': {
      const m = versionsOf(vod.movies).find((x) => String(x.stream_id) === q.get('vod_id'));
      const versions = Boolean(process.env.KEPULI_MOCK_VERSIONS);
      if (!m) return send(res, 200, { info: {}, movie_data: {} });
      return send(res, 200, {
        info: {
          movie_image: origin + m.stream_icon, cover_big: origin + m.stream_icon, plot: m.plot, cast: m.cast, director: m.director, genre: m.genre,
          releasedate: `${m.year}-01-01`, country: 'Norway, Sweden', age: '12', rating: m.rating, duration_secs: m.duration * 60, duration: `${Math.floor(m.duration / 60)}:${String(m.duration % 60).padStart(2, '0')}:00`,
          video: { codec_name: 'h264', width: 1920, height: 1080 }, audio: { codec_name: 'aac', channels: 2, ...(versions ? { tags: { language: 'nor' } } : {}) }, bitrate: 4200, youtube_trailer: '',
          ...(versions ? { o_name: 'Det stille fjellet' } : {}),
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

/* ------------------------------------------------- M3U and XMLTV */

// The same catalogue as an extended M3U playlist and an XMLTV guide, the
// way a provider's panel writes them (get.php?type=m3u_plus, xmltv.php):
// for the player's playlist accounts (js/m3usource.js). The playlist names
// the guide in its header, gzipped and served without a Content-Encoding,
// as guide.xml.gz files are; the archive channels say catchup="xc".
//
//   /playlist.m3u     the playlist
//   /guide.xml        the guide
//   /guide.xml.gz     the guide, gzipped

function playlistM3u(origin) {
  const attr = (v) => String(v).replace(/"/g, "'");
  const lines = [`#EXTM3U url-tvg="${origin}/guide.xml.gz"`];
  const cats = (list) => new Map(list.map((c) => [c.category_id, c.category_name]));
  const liveCats = cats(live.categories);
  for (const c of liveChannels()) {
    const archive = c.tv_archive ? ` catchup="xc" catchup-days="${c.tv_archive_duration}"` : '';
    lines.push(`#EXTINF:-1 tvg-id="${attr(c.epg_channel_id)}" tvg-name="${attr(c.name)}" tvg-logo="${origin}${c.stream_icon}" tvg-chno="${c.num}" group-title="${attr(liveCats.get(c.category_id) || '')}"${archive},${c.name}`);
    lines.push(`${origin}/live/${USER}/${PASS}/${c.stream_id}.m3u8`);
  }
  const movieCats = cats(vod.categories);
  for (const m of vod.movies) {
    lines.push(`#EXTINF:-1 tvg-id="" tvg-name="${attr(m.name)}" tvg-logo="${origin}${m.stream_icon}" group-title="${attr(movieCats.get(m.category_id) || '')}",${m.name}`);
    lines.push(`${origin}/movie/${USER}/${PASS}/${m.stream_id}.${m.container_extension}`);
  }
  const seriesCats = cats(series.categories);
  for (const entry of series.list) {
    const info = series.info.get(String(entry.series_id));
    for (const list of Object.values(info.episodes)) {
      for (const ep of list) {
        const name = `${entry.name} S${String(ep.season).padStart(2, '0')} E${String(ep.episode_num).padStart(2, '0')}`;
        lines.push(`#EXTINF:-1 tvg-id="" tvg-name="${attr(name)}" tvg-logo="${origin}${entry.cover}" group-title="${attr(seriesCats.get(entry.category_id) || '')}",${name}`);
        lines.push(`${origin}/series/${USER}/${PASS}/${ep.id}.${ep.container_extension}`);
      }
    }
  }
  return lines.join('\r\n') + '\r\n';
}

function guideXml() {
  const xmltvTime = (seconds) => {
    const d = new Date(Number(seconds) * 1000);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())} +0000`;
  };
  const out = ['<?xml version="1.0" encoding="utf-8" ?><!DOCTYPE tv SYSTEM "xmltv.dtd"><tv generator-info-name="Kepuli-TV demo">'];
  for (const c of liveChannels()) out.push(`<channel id="${escapeXml(c.epg_channel_id)}"><display-name>${escapeXml(c.name)}</display-name></channel>`);
  for (const c of liveChannels()) {
    for (const p of programmes(c)) {
      out.push(`<programme start="${xmltvTime(p.start_timestamp)}" stop="${xmltvTime(p.stop_timestamp)}" channel="${escapeXml(c.epg_channel_id)}"><title lang="en">${escapeXml(Buffer.from(p.title, 'base64').toString('utf8'))}</title><desc lang="en">${escapeXml(Buffer.from(p.description, 'base64').toString('utf8'))}</desc></programme>`);
    }
  }
  out.push('</tv>');
  return out.join('\n');
}

/* ---------------------------------------------------------- Stalker portal */

// A Stalker (Ministra) portal over the same catalogue, as a MAG box sees it:
//
//   /c/                     the box's page (the address a provider gives)
//   /server/load.php        the API beside it (portal.php answers too)
//   /stalker/live/<id>.ts   a channel, behind create_link's one-time token
//
// The box is known by the cookie mac=STALKER_MAC and must say it is a MAG
// in its User-Agent; a request without both is "Authorization failed.",
// as many real portals answer. What the headers said is kept in
// stalkerSeen, for dev/playcheck.mjs to see that the session rule set them.
// KEPULI_MOCK_STALKER_LOOSE lets a box without them in, and counts it: a
// profile without the host permission gets no help from the rule.
export const STALKER_MAC = '00:1A:79:00:00:01';
const STALKER_TOKEN = 'mocktoken';
export const stalkerSeen = { api: 0, refused: 0, streams: 0, tokens: new Set() };

function stalker(req, res, url) {
  const q = Object.fromEntries(url.searchParams);
  const cookie = req.headers.cookie || '';
  const mac = decodeURIComponent(/(?:^|;\s*)mac=([^;]+)/.exec(cookie)?.[1] || '');
  const loose = Boolean(process.env.KEPULI_MOCK_STALKER_LOOSE);
  let mag = /MAG200|MAG250|stbapp/.test(req.headers['user-agent'] || '');
  stalkerSeen.api++;
  if (loose && (!mag || mac !== STALKER_MAC)) stalkerSeen.loose = (stalkerSeen.loose || 0) + 1;
  if (loose) mag = true;
  const js = (value) => send(res, 200, { js: value }, 'text/javascript; charset=utf-8');
  if ((mac !== STALKER_MAC && !loose) || !mag) { stalkerSeen.refused++; return send(res, 200, 'Authorization failed.', 'text/html'); }
  if (q.action === 'handshake') return js({ token: STALKER_TOKEN, random: 'f00d' });
  const boxMac = mac || STALKER_MAC;
  if ((req.headers.authorization || '') !== `Bearer ${STALKER_TOKEN}`) { stalkerSeen.refused++; return send(res, 200, 'Authorization failed.', 'text/html'); }
  const origin = originOf(req);
  const page = (rows) => {
    const per = 14;
    const p = Math.max(1, Number(q.p) || 1);
    return js({ total_items: rows.length, max_page_items: per, data: rows.slice((p - 1) * per, p * per) });
  };
  const programmeRow = (p) => ({ id: String(p.id), name: Buffer.from(p.title, 'base64').toString('utf8'), descr: Buffer.from(p.description, 'base64').toString('utf8'), start_timestamp: Number(p.start_timestamp), stop_timestamp: Number(p.stop_timestamp) });
  const key = `${q.type}/${q.action}`;
  switch (key) {
    case 'stb/get_profile': return js({ id: '1', mac: boxMac, status: 0 });
    case 'account_info/get_main_info': return js({ mac: boxMac, end_date: '2027-06-30 23:59:59' });
    case 'itv/get_genres': return js([{ id: '*', title: 'All' }, ...live.categories.map((c) => ({ id: c.category_id, title: c.category_name }))]);
    case 'itv/get_all_channels': return js({ data: liveChannels().map((c) => ({
      id: String(c.stream_id), name: c.name, number: String(c.num), cmd: `ffrt http://localhost/ch/${c.stream_id}_`,
      logo: `${origin}${c.stream_icon}`, tv_genre_id: c.category_id, xmltv_id: c.epg_channel_id, tv_archive: String(c.tv_archive),
    })) });
    case 'itv/create_link': {
      const id = /\/ch\/(\d+)/.exec(q.cmd || '')?.[1];
      const token = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      stalkerSeen.tokens.add(token);
      return js({ id, cmd: `ffmpeg ${origin}/stalker/live/${id}.ts?play_token=${token}` });
    }
    case 'itv/get_short_epg': {
      const c = liveChannels().find((x) => String(x.stream_id) === q.ch_id);
      const now = Date.now() / 1000;
      return js(c ? programmes(c).filter((p) => Number(p.stop_timestamp) > now).slice(0, Number(q.size) || 4).map(programmeRow) : []);
    }
    case 'itv/get_simple_data_table': {
      const c = liveChannels().find((x) => String(x.stream_id) === q.ch_id);
      const day = String(q.date || '');
      return page(c ? programmes(c).filter((p) => new Date(Number(p.start_timestamp) * 1000).toISOString().slice(0, 10) === day).map(programmeRow) : []);
    }
    case 'vod/get_categories': return js([{ id: '*', title: 'All' }, ...vod.categories.map((c) => ({ id: c.category_id, title: c.category_name }))]);
    case 'vod/get_ordered_list': return page(vod.movies.filter((m) => q.category === '*' || m.category_id === q.category).map((m) => ({
      id: String(m.stream_id), name: m.name, cmd: `/media/${m.stream_id}.${m.container_extension}`, screenshot_uri: `${origin}${m.stream_icon}`,
      year: String(m.year), time: String(m.duration), description: m.plot, genres_str: m.genre, rating_imdb: m.rating, is_series: '0',
    })));
    case 'vod/create_link': {
      const film = /\/media\/(\d+)\.(\w+)/.exec(q.cmd || '');
      if (film) return js({ cmd: `ffmpeg ${origin}/movie/${USER}/${PASS}/${film[1]}.${film[2]}` });
      const season = /\/series\/(\d+)\/(\d+)/.exec(q.cmd || '');
      const info = season && series.info.get(season[1]);
      const ep = info?.episodes[season[2]]?.find((e) => String(e.episode_num) === String(q.series));
      return js(ep ? { cmd: `ffmpeg ${origin}/series/${USER}/${PASS}/${ep.id}.${ep.container_extension}` } : { cmd: '' });
    }
    case 'series/get_categories': return js(series.categories.map((c) => ({ id: c.category_id, title: c.category_name })));
    case 'series/get_ordered_list': {
      if (q.movie_id) {
        const info = series.info.get(String(q.movie_id));
        return page(info ? Object.entries(info.episodes).map(([n, list]) => ({
          id: `${q.movie_id}:${n}`, name: `Season ${n}`, series: list.map((e) => e.episode_num), cmd: `/series/${q.movie_id}/${n}`, is_season: true,
        })) : []);
      }
      return page(series.list.filter((x) => q.category === '*' || x.category_id === q.category).map((x) => ({
        id: String(x.series_id), name: x.name, screenshot_uri: `${origin}${x.cover}`, description: x.plot, year: x.releaseDate.slice(0, 4), genres_str: x.genre,
      })));
    }
    default: return js([]);
  }
}

function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  if (path === '/player_api.php') return api(req, res, url);
  if (path === '/c/' || path === '/c/index.html') return send(res, 200, '<!doctype html><title>Stalker</title>', 'text/html');
  if (path === '/server/load.php' || path === '/portal.php') return stalker(req, res, url);
  if (path.startsWith('/stalker/live/')) {
    const token = url.searchParams.get('play_token');
    const mag = /MAG200|MAG250|stbapp/.test(req.headers['user-agent'] || '') || Boolean(process.env.KEPULI_MOCK_STALKER_LOOSE);
    // A token is good for one connection, as a real portal's often is.
    if (!token || !stalkerSeen.tokens.delete(token) || !mag) return send(res, 403, 'forbidden', 'text/plain');
    stalkerSeen.streams++;
    return admit(req, res).then((ok) => ok && sendTimeshift(req, res));
  }
  if (path === '/playlist.m3u') return send(res, 200, playlistM3u(originOf(req)), 'audio/x-mpegurl; charset=utf-8');
  if (path === '/guide.xml') return send(res, 200, guideXml(), 'application/xml; charset=utf-8');
  if (path === '/guide.xml.gz') return send(res, 200, gzipSync(guideXml()), 'application/octet-stream');

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
  if ((m = /^\/live\/[^/]+\/[^/]+\/(\d+)\.m3u8$/.exec(path))) {
    if (!admitHls(req, res, m[1])) return;
    connections.hls++;
    return send(res, 200, livePlaylist(), 'application/vnd.apple.mpegurl');
  }
  // KEPULI_MOCK_CHANNEL_REFUSED: every live channel is refused with 407 at
  // once, before any redirect — what a real provider answers for a channel
  // outside the subscription or off the air.
  // KEPULI_MOCK_LIVE_BAD_GATEWAY: every live channel is a "502 Bad Gateway".
  if (process.env.KEPULI_MOCK_LIVE_BAD_GATEWAY && /^\/live\//.test(path)) return send(res, 502, '', 'text/html');
  if (process.env.KEPULI_MOCK_CHANNEL_REFUSED && /^\/live\//.test(path)) return send(res, 407, '', 'text/html; charset=UTF-8');
  // KEPULI_MOCK_NO_ANSWER: a stream or a file is accepted and never
  // answered — no status, no byte — until the player gives up on it.
  if (process.env.KEPULI_MOCK_NO_ANSWER && /^\/(live|movie|series)\//.test(path)) return;
  if (/^\/live\/.*\.m3u8$/.test(path)) return send(res, 200, livePlaylist(), 'application/vnd.apple.mpegurl');
  // KEPULI_MOCK_LIVE_TS serves the channel as a provider does: one endless
  // MPEG-TS connection, counted against the account like a film.
  if (/^\/live\/.*\.ts$/.test(path) && process.env.KEPULI_MOCK_LIVE_TS) return admit(req, res).then((ok) => ok && sendTimeshift(req, res));
  if (/^\/live\/.*\.ts$/.test(path)) return send(res, 404, 'the demo channel is HLS; the player falls back to it', 'text/plain');
  if (path.startsWith('/timeshift/')) return admit(req, res).then((ok) => ok && sendTimeshift(req, res, { archive: true }));
  if (path.startsWith('/files/refused/')) return send(res, 400, '', 'video/mp4');
  if ((m = /^\/(movie|series)\/.*\.(\w+)$/.exec(path))) return admit(req, res).then((ok) => ok && sendMedia(req, res, path, m[2]));
  send(res, 404, 'not found', 'text/plain');
}

function sendMedia(req, res, path, ext) {
  // KEPULI_MOCK_EMPTY: every film and episode is answered the way a real
  // provider answers a title it has no file for — "200 OK", text/html and
  // not one byte, where a playable title is a redirect and a 206.
  // KEPULI_MOCK_REFUSED_FILE: every film and episode is let through and
  // redirected, and the "file server" behind the redirect refuses it with
  // a 400 — what a real provider does with a title whose file it cannot
  // give, and unlike its refusal of a connection it still counts.
  if (process.env.KEPULI_MOCK_REFUSED_FILE) {
    res.writeHead(302, { ...CORS, Location: `/files/refused${path}` });
    return res.end();
  }
  // KEPULI_MOCK_TS_AS_MP4: every .mp4 film is MPEG-TS under its name, sent
  // as video/mp4 — what a real provider did with a film, measured.
  // KEPULI_MOCK_BAD_GATEWAY: every film and episode is a "502 Bad Gateway"
  // from the provider's proxy, before any redirect — measured on a real one.
  if (process.env.KEPULI_MOCK_BAD_GATEWAY) return send(res, 502, '', 'text/html');
  if (process.env.KEPULI_MOCK_TS_AS_MP4 && ext === 'mp4') return sendFile(req, res, 'hls/000.ts', 'video/mp4');
  if (process.env.KEPULI_MOCK_EMPTY) {
    res.writeHead(200, { ...CORS, 'Content-Type': 'text/html; charset=UTF-8', 'Transfer-Encoding': 'chunked' });
    return res.end();
  }
  // KEPULI_MOCK_LONG, a folder: every film and episode is served from its
  // long.<ext> there instead (long.mkv, long.mp4, long.ts) — for a feature
  // length file, which the demo media are not, read through to its end.
  const long = process.env.KEPULI_MOCK_LONG;
  if (long && existsSync(join(long, `long.${ext}`))) {
    const types = { mkv: 'video/x-matroska', mp4: 'video/mp4', ts: 'video/mp2t' };
    return sendFile(req, res, join(long, `long.${ext}`), types[ext] || 'application/octet-stream');
  }
  if (ext === 'mkv') {
    const id = path.slice(path.lastIndexOf('/') + 1, -4);
    const variant = (set, file) => (set.has(id) && existsSync(join(MEDIA, file)) ? file : null);
    const file = variant(AC3_EPISODES, 'episode-ac3.mkv')
              || variant(MULTI_EPISODES, 'episode-multi.mkv')
              || 'episode.mkv';
    return sendFile(req, res, file, 'video/x-matroska');
  }
  if (ext === 'mp4') return sendFile(req, res, 'movie.mp4', 'video/mp4');
  return send(res, 404, `the demo server has no ${ext} files`, 'text/plain');
}

export function startMockServer(port = PORT) {
  return new Promise((resolve, reject) => {
    resetConnections();
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
