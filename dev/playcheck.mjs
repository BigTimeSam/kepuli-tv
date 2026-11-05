#!/usr/bin/env node
// Playback scenarios against the mock server, in the development Chrome:
// the demo episode is played through the MKV unpacker and something is done
// to it that used to leave the picture dead without a word.
//
//   node dev/playcheck.mjs            every scenario
//   node dev/playcheck.mjs seek       two seeks in quick succession while the
//                                     seek table is being fetched: playback
//                                     must continue past the second target
//   node dev/playcheck.mjs death      the server goes away mid-episode: the
//                                     error overlay must say so, with Retry,
//                                     rather than the picture freezing at the
//                                     end of the buffer
//   node dev/playcheck.mjs cancel     the whole channel list stalls and the
//                                     viewer presses Cancel: the dialog must
//                                     close and the sidebar return to the
//                                     group it was on, with no error
//   node dev/playcheck.mjs timeout    the same stall left alone: the request
//                                     limit must end it with a message, as a
//                                     toast over the rows, rather than the
//                                     dialog staying open for good
//   node dev/playcheck.mjs restore    the address follows the path and the
//                                     title says it in words; a refresh comes
//                                     back to the group, the topic and the
//                                     open series from the address alone, a
//                                     typed address navigates, and the stored
//                                     view brings the tab, group and topic
//                                     back to a player opened fresh, while a
//                                     search, an unknown topic and an unknown
//                                     group do not take the list with them
//   node dev/playcheck.mjs search     a search takes over from the group and
//                                     clearing it brings the group back
//   node dev/playcheck.mjs paste      a whole address pasted into the Server
//                                     field is split into its parts
//   node dev/playcheck.mjs keys       Esc and the arrows keep working after a
//                                     button has been clicked with the mouse,
//                                     and f alone goes to full screen while
//                                     Cmd+F and Ctrl+F are left to the browser
//   node dev/playcheck.mjs switching  a channel switch during the wait before
//                                     a reconnect leaves the new channel alone,
//                                     and the tab's title names what is playing
//                                     before the path the list stands on
//   node dev/playcheck.mjs resume     a film with a resume position, abandoned
//                                     before its metadata arrived for an
//                                     episode, does not drag the episode to
//                                     its position
//   node dev/playcheck.mjs connections the account's one connection: an
//                                     episode started over and over, another
//                                     one, a film and seeks never ask for a second
//                                     stream while one is open; a server that
//                                     counts the closed stream for a few
//                                     seconds is waited out and playback
//                                     starts by itself; and another tab of
//                                     the player holding the connection is
//                                     named, and Play here takes it over
//   node dev/playcheck.mjs livequiet  zapping live MPEG-TS on a full account
//                                     that does not say no: the stream is
//                                     taken and left silent, or ended at
//                                     once, and the player must ask for it
//                                     again rather than fall back to HLS
//   node dev/playcheck.mjs reconnect  the download breaks once and resumes:
//                                     playback must carry on across the break
//   node dev/playcheck.mjs accounts   a favourite made under one account is
//                                     not shown under another
//   node dev/playcheck.mjs listerror  a group that cannot be fetched while a
//                                     channel plays: a toast, not the overlay
//   node dev/playcheck.mjs a11y       roles and names for assistive technology,
//                                     the cursor announced and marked
//   node dev/playcheck.mjs audio      the three-track episode: the automatic
//                                     choice is heard as the English track's
//                                     tone, the selector changes the track
//                                     mid-playback without stopping the
//                                     picture, and a remembered Finnish opens
//                                     the next playback on the Finnish track
//   node dev/playcheck.mjs wasmaudio  without WebCodecs (Firefox for Android)
//                                     the AC-3 episode still sounds, encoded
//                                     to AAC by the wasm module
//   node dev/playcheck.mjs settings   the settings dialog: drafts save on
//                                     demand without reconnecting, a slider
//                                     drag released outside does not close
//                                     it, a backdrop click guards edits, the Aa
//                                     popover sizes the real subtitles
//                                     without covering them, and the first
//                                     run is a connect dialog rather than
//                                     settings
//   node dev/playcheck.mjs subtitles  the cues are drawn by the layer, a
//                                     two-line cue in one box; the selector
//                                     changes the track and switches the
//                                     subtitles off without an error, and
//                                     the language it chose opens the next
//                                     episode; a double click takes the
//                                     wrapper to full screen with the
//                                     layer; a file without subtitles says
//                                     so in the details
//   node dev/playcheck.mjs clickpause a click on the picture pauses an episode
//                                     and plays it on; a double click goes to
//                                     full screen without pausing; the control
//                                     bar and a live channel are left alone
//                                     (in Chrome; Firefox's own controls
//                                     keep the clicks to themselves)
//   node dev/playcheck.mjs channels   the channel order setting; a channel's
//                                     menu makes it a favourite, gathered
//                                     folded above the list, and hides it
//                                     with Undo; Hidden gives it back; the
//                                     countries chosen thin the sidebar
//   node dev/playcheck.mjs home       the logo goes back to the start: the
//                                     channels, the top of the list and the
//                                     empty player's page, what was playing
//                                     stopped and a click away there
//   node dev/playcheck.mjs resumemkv  an episode started again from where it
//                                     was left plays on from there
//   node dev/playcheck.mjs seeklag    a seek on a one-connection account whose
//                                     server counts the closed stream for a few
//                                     seconds: the seek table and the new
//                                     download are refused at first, and the
//                                     seek must arrive by waiting rather than
//                                     end the episode or lose the table
//   node dev/playcheck.mjs cuesretry  the seek table cannot be read during one
//                                     seek, which reads the file through; the
//                                     next seek must read the table and jump
//                                     straight to its cluster
//   node dev/playcheck.mjs quota      the source buffer is full long before
//                                     the minute ahead: playback must wait for
//                                     room and play the episode to its end
//                                     rather than stop with an error
//   node dev/playcheck.mjs catchupfreeze an archive programme whose server goes
//                                     quiet under an open connection: no error
//                                     while the viewer has paused, then the
//                                     frozen picture is reported with Retry,
//                                     which plays the programme again
//   node dev/playcheck.mjs catchupfull an archive programme read faster than
//                                     it plays fills the buffer, and mpegts.js
//                                     stops reading for good: the freeze is
//                                     reported rather than left silent
//   node dev/playcheck.mjs pickers    a drop-down opens the app's own list:
//                                     a long one with a filter that narrows
//                                     it, a short one without; Escape closes
//                                     the list and leaves the dialog open,
//                                     and a choice reaches the select's
//                                     listeners
//   node dev/playcheck.mjs lastchannel l returns to the channel before, and
//                                     again to the one after it; the media
//                                     session names the programme and the
//                                     channel
//   node dev/playcheck.mjs nextepisode an episode played to its end counts
//                                     down to the next one and plays it;
//                                     Cancel stays on the ended one, and n
//                                     finds the next episode from a list
//                                     that does not hold the series
//   node dev/playcheck.mjs continuewatching a film left halfway heads the
//                                     history under its own heading
//   node dev/playcheck.mjs reminders  a reminder set in the guide marks the
//                                     programme, is kept, and when due says
//                                     so with Watch, which plays the channel
//   node dev/playcheck.mjs twotabs    two players open on one account: a
//                                     favourite made in one survives a change
//                                     in the other; another account saved in
//                                     one is said in the other, which writes
//                                     nothing into it and follows on request
//   node dev/playcheck.mjs switchstop another account saved in Settings while
//                                     a channel plays stops the channel
//   node dev/playcheck.mjs resettabs  Reset everything with a second tab open:
//                                     both start again empty, and the cache
//                                     opens again after it (Chrome only)
//   node dev/playcheck.mjs update     an update the browser holds back is
//                                     offered in a message and on the
//                                     version line
//   node dev/playcheck.mjs refresh    Refresh shows a channel the provider
//                                     added to a group opened earlier; the
//                                     cache's expired rows are purged
//   node dev/playcheck.mjs restorenav a reload naming a series does not open
//                                     it over a group chosen meanwhile
//   node dev/playcheck.mjs guidekeep  the guide keeps its scroll and row over
//                                     a language switch, and its days and the
//                                     programme search's line follow it
//   node dev/playcheck.mjs emptyfile  a title the provider answers with "200
//                                     OK" and no bytes says so at once, not
//                                     that the account's connections are full
//   node dev/playcheck.mjs refusedfile a title let through and redirected, then
//                                     refused by the file server, says so at
//                                     once, not that the connections are full
//   node dev/playcheck.mjs badgateway a title answered "502 Bad Gateway" says
//                                     the error at once, not the connections
//   node dev/playcheck.mjs livebadgateway the same for a live channel
//   node dev/playcheck.mjs tsasmp4    a ".mp4" film that is MPEG-TS is played
//                                     over mpegts.js, without a wait for a
//                                     connection or a failure between
//   node dev/playcheck.mjs channelrefused a channel refused with 407 says so
//                                     at once, not that the account is full
//   node dev/playcheck.mjs noanswer   a server that never answers is given up
//                                     within seconds, an episode and a channel
//   node dev/playcheck.mjs buffering  the wait for the picture is told as it
//                                     goes: sent slowly, the episode's start
//                                     shows a share of known bytes that grows,
//                                     a bar, the bytes and the speed, and past
//                                     ten seconds the time waited and Cancel;
//                                     a seek on a connection slower than the
//                                     film shows the stall over the picture,
//                                     shows its speed against the film's on
//                                     an amber bar, and
//                                     leaves once the picture moves
//   node dev/playcheck.mjs livebuffering a live MPEG-TS channel sent slower
//                                     than it plays: the start shows the bytes
//                                     without a share, the
//                                     picture's stalls show over it with the
//                                     speed, and the
//                                     second stall says the connection is not
//                                     keeping up
//   node dev/playcheck.mjs filmbuffering the MP4 film sent slowly: in Firefox,
//                                     which reads it itself, the index and
//                                     then the samples to the first picture
//                                     each show a share that never goes
//                                     back; in Chrome, whose own
//                                     player says no bytes, no share at all
//   node dev/playcheck.mjs longfilm   with KEPULI_MOCK_LONG set to a folder of
//                                     long.mkv/.mp4/.ts (KEPULI_MOCK_EPISODE_EXT
//                                     picks one), a feature-length file plays
//                                     on with its own duration for
//                                     KEPULI_LONG_SECS; skipped without it
//   node dev/playcheck.mjs pseudo     the main views with pseudo-localised
//                                     text (player.html?pseudo=1, 40 %
//                                     longer): no button, tab, row, label or
//                                     dialog field whose text overflows its
//                                     box, other than those meant to ellipsis
//   node dev/playcheck.mjs startup    the player opened with the catalogue
//                                     cache empty and full, three times each:
//                                     the time to the first channel rows,
//                                     against a bound (Chrome only)
//   node dev/playcheck.mjs soak       about four minutes: a channel zapped
//                                     every 20 s for three minutes, a film
//                                     with eight seeks, the first channel
//                                     again; the heap after a collection at
//                                     the start and the end must not have
//                                     grown past a bound (KEPULI_SOAK_ZAPS
//                                     sets the number of zaps, 9)
//
// The driver is the one dev/store-screenshots.mjs uses, from the same
// profile (KEPULI_DEV_PROFILE) and port (KEPULI_DEV_PORT), and it needs the
// player tab visible: a minimised window leaves the tab hidden, and Chrome
// then throttles its timers to once a minute, which stalls the start-up.
// A private headless instance is the reliable way to run it:
//
//   KEPULI_DEV_PORT=9333 KEPULI_DEV_PROFILE=/tmp/kepuli-profile KEPULI_HEADLESS=1 node dev/playcheck.mjs
//
// with the profile copied from ~/.cache/kepuli-tv-dev so that the host
// permission for the mock server is already granted. The mock server sends
// the media slowly so that the seek targets lie outside the buffer and the
// download is still under way when the server is cut; KEPULI_THROTTLE sets
// the rate in bytes per second (60 kB/s). Exit code 0 when every scenario
// passes, 1 otherwise.

import { startMockServer, connectionStats, MULTI_EPISODES, PORT as MOCK_PORT, STALKER_MAC, stalkerSeen, USER, PASS, T0 as MOCK_T0 } from './mock/server.mjs';
// Run the same scenarios in Firefox with KEPULI_BROWSER=firefox.
const { ensureChrome, openPlayer, session, sleep, PORT: CHROME_PORT } = await import(
  process.env.KEPULI_BROWSER === 'firefox' ? '../firefox/playcheck-driver.mjs' : './screenshot.mjs');
// The DevTools port, for opening a second tab; the Firefox driver has none.
const DEVTOOLS_PORT = process.env.KEPULI_BROWSER === 'firefox' ? null : CHROME_PORT;

const THROTTLE = Number(process.env.KEPULI_THROTTLE || 60 * 1024);
const CUES_DELAY_MS = 1500;
const PLAYING = `(() => { const v = document.getElementById('video'); return v.readyState >= 2 && v.currentTime > 0.3 && !v.paused; })()`;
const CONNECTED = `document.querySelectorAll('#groups .group').length > 1 && document.getElementById('list-progress').hidden`;

/* ------------------------------------------------------------ page helpers */

async function evaluate(page, expression, { gesture = false } = {}) {
  const { result, exceptionDetails } = await page.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: gesture });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
  return result.value;
}

async function waitFor(page, expression, what, timeout = 25000) {
  const t0 = Date.now();
  for (;;) {
    let value = false;
    try { value = await evaluate(page, expression); } catch { /* mid-reload */ }
    if (value) return value;
    if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for ${what}`);
    await sleep(200);
  }
}

async function click(page, root, text, { gesture = false, timeout = 10000 } = {}) {
  const expression = `(() => {
    const nodes = [...document.querySelectorAll(${JSON.stringify(root + ' *')})];
    const node = nodes.find((n) => n.children.length === 0 && n.textContent.trim() === ${JSON.stringify(text)})
      || nodes.find((n) => n.children.length === 0 && n.textContent.trim().startsWith(${JSON.stringify(text)}));
    if (!node) return false; node.click(); return true; })()`;
  const t0 = Date.now();
  for (;;) {
    if (await evaluate(page, expression, { gesture })) return;
    if (Date.now() - t0 > timeout) throw new Error(`nothing called "${text}" under ${root}`);
    await sleep(200);
  }
}

const videoState = (page) => evaluate(page, `(() => { const v = document.getElementById('video'); const ov = document.getElementById('overlay');
  return { t: +v.currentTime.toFixed(1), paused: v.paused, readyState: v.readyState,
    buffered: [...Array(v.buffered.length)].map((_, i) => v.buffered.start(i).toFixed(0) + '-' + v.buffered.end(i).toFixed(0)),
    overlay: ov && !ov.hidden ? ov.textContent.trim().replace(/\\s+/g, ' ').slice(0, 120) : null,
    actions: [...document.querySelectorAll('#overlay button')].map((b) => b.textContent.trim()) }; })()`);

// An error thrown from a control's own handler reaches no catch of the
// app's: the page carries on with the work half done and says nothing. The
// scenario has to listen for it, so that "the picture still runs" is not
// mistaken for "nothing went wrong".
const watchErrors = (page) => evaluate(page, `(() => { window.__thrown = [];
  addEventListener('error', (e) => window.__thrown.push((e.error && e.error.message) || e.message));
  addEventListener('unhandledrejection', (e) => window.__thrown.push(String((e.reason && e.reason.message) || e.reason)));
  return true; })()`);
const errorsSeen = (page) => evaluate(page, `window.__thrown.slice()`);

/** The viewer's own choice from the player's subtitle selector, by its name
 *  in the menu; the name chosen, or null when the menu does not offer it. */
const pickSubtitle = (page, name) => evaluate(page, `(() => { const select = document.getElementById('subs');
  const option = [...select.options].find((o) => o.textContent.startsWith(${JSON.stringify(name)}));
  if (!option) return null;
  select.value = option.value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return option.textContent; })()`, { gesture: true });

/** What the player shows: the choice in the menu, the track under the
 *  picture, and the boxes the layer is drawing. */
const subtitleState = (page) => evaluate(page, `(() => { const v = document.getElementById('video');
  return { picked: document.getElementById('subs').value,
    showing: [...v.textTracks].filter((t) => t.mode === 'showing').map((t) => t.label),
    boxes: document.querySelectorAll('#subdisplay .cue').length }; })()`);

/* ---------------------------------------------------------------- set-up */

async function checkModal(page, selector, name) {
  const state = await evaluate(page, `(() => {
    const dialog = document.querySelector(${JSON.stringify(selector)}), close = dialog.querySelector('.modal-head .modal-close');
    if (!close) return { error: 'missing shared close button' };
    const d = dialog.getBoundingClientRect(), r = close.getBoundingClientRect();
    return { width: r.width, height: r.height, label: close.getAttribute('aria-label'),
      visible: r.top >= d.top && r.bottom <= d.bottom && r.right <= d.right && r.left > d.left + d.width / 2,
      fits: d.left >= 0 && d.top >= 0 && d.right <= innerWidth && d.bottom <= innerHeight,
      radius: getComputedStyle(dialog).borderRadius };
  })()`);
  if (state.width !== 32 || state.height !== 32 || !state.label || !state.visible || !state.fits || state.radius !== '14px') {
    throw new Error(`${name} modal controls: ${JSON.stringify(state)}`);
  }
  if (process.env.KEPULI_MODAL_CAPTURE_DIR) {
    const fs = await import('node:fs');
    fs.mkdirSync(process.env.KEPULI_MODAL_CAPTURE_DIR, { recursive: true });
    const { data } = await page.call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`${process.env.KEPULI_MODAL_CAPTURE_DIR}/${name}.png`, Buffer.from(data, 'base64'));
  }
}

/** A fresh player pointed at the mock server, connected and throttled. */
/** The player's address without the place written into it: a fresh start. */
const bare = (url) => url.split('#')[0];

async function freshPlayer(target, page) {
  // Screenshot inspections may leave a narrow emulated viewport behind.
  await page.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  const { windowId } = await page.call('Browser.getWindowForTarget');
  await page.call('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
  await page.call('Page.bringToFront');
  const visibility = await evaluate(page, 'document.visibilityState');
  if (visibility !== 'visible') throw new Error('the player tab is not visible; raise the dev Chrome window or run headless');
  // The personal lists are kept per account, so every account's copy goes.
  await evaluate(page, `chrome.storage.local.get(null).then((all) => chrome.storage.local.remove(Object.keys(all).filter((k) => /^(favorites|recents|resume|channels|reminders)(:|$)/.test(k))))`);
  // The accounts and sync of an earlier scenario (m3u, sync) go too.
  await evaluate(page, `Promise.all([chrome.storage.local.remove(['accounts', 'sync', 'syncState', 'syncStatus']), chrome.storage.sync ? chrome.storage.sync.clear() : null])`);
  await evaluate(page, `chrome.storage.local.set({
    config: { scheme: 'http', host: '127.0.0.1', port: '${MOCK_PORT}', username: 'demo', password: 'demo', sourceMode: 'xtream', streamMode: 'auto' },
    settings: { lang: 'en', epgEnabled: true, resumeEnabled: false, subtitleLang: 'eng' },
    ui: { tab: 'series' } })`);
  // The catalogue cache is dropped as the screenshot script does: a run
  // against another server would otherwise hand out that server's addresses.
  const origin = target.url.match(/^(?:chrome|moz)-extension:\/\/[^/]+/)[0];
  await page.call('Page.navigate', { url: `${origin}/css/player.css` });
  await sleep(500);
  await evaluate(page, `indexedDB.databases().then((dbs) => Promise.all(dbs.map((d) => new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(d.name); req.onsuccess = req.onerror = req.onblocked = () => resolve(d.name); }))))`);
  await page.call('Page.navigate', { url: bare(target.url) });
  await sleep(1000);
  await waitFor(page, CONNECTED, 'the connection');
}

/**
 * The live tab's channel list, painted.
 *
 * Waiting for "some rows" is not enough and once made three scenarios
 * flaky: activateTab marks the tab active and only then waits for the
 * network, so for a moment the list still held the previous tab's rows —
 * measured, the wait was satisfied in 1 ms by a series row, and the click
 * that followed opened a series instead of playing a channel. js/app.js
 * empties the list with the tab now; this checks what arrived is really
 * the channel list rather than trusting the timing.
 */
async function openLiveList(page, minRows = 1) {
  await evaluate(page, `document.querySelector('#tabs [data-tab="live"]').click()`);
  await waitFor(page, `document.querySelectorAll('#list .row').length >= ${minRows}`, 'the channel rows');
}

/** The first channel of that list, playing. */
async function playFirstChannel(page) {
  await openLiveList(page, 2);
  await evaluate(page, `document.querySelectorAll('#list .row')[0].click()`, { gesture: true });
  await sleep(300);
  // A row that is not a channel opens a detail panel instead of playing.
  // Said at once, it beats waiting out the playback timeout and reporting
  // only that nothing happened.
  const opened = await evaluate(page, `(() => { const row = document.querySelector('#list .row');
    return { detail: !document.getElementById('detail').hidden,
      first: row ? row.textContent.trim().replace(/\s+/g, ' ').slice(0, 40) : null }; })()`);
  if (opened.detail) throw new Error(`the top row of the channel list opened a detail panel: "${opened.first}"`);
  await waitFor(page, PLAYING, 'the channel');
}

/** An episode of the demo series, playing. The first by default; the third
 *  is the one with three audio tracks, see dev/mock/media.sh. */
async function playEpisode(page, index = 0) {
  await evaluate(page, `document.querySelector('#tabs [data-tab="series"]').click()`);
  await click(page, '#groups', 'Nordic Noir');
  await click(page, '#list', 'Silent Fjord');
  await waitFor(page, `!document.getElementById('detail').hidden && document.querySelectorAll('#list .row').length > ${index}`, 'the series page');
  await evaluate(page, `document.querySelectorAll('#list .row')[${index}].click()`, { gesture: true });
  await waitFor(page, PLAYING, 'the episode');
  await sleep(3000);
}

/* -------------------------------------------------------------- scenarios */

/**
 * A feature-length file read through: KEPULI_MOCK_LONG serves every episode
 * from a long file (see the server), KEPULI_MOCK_EPISODE_EXT picks its
 * format. The duration must stay the file's own and the picture must keep
 * going for KEPULI_LONG_SECS, the download fetched part by part behind it.
 */
/** What the overlay says of a wait, for the buffering scenario. */
const WAIT_VIEW = `(() => { const $ = (id) => document.getElementById(id);
  const shown = (id) => !$(id).hidden;
  return { overlay: shown('overlay'), stall: $('overlay').classList.contains('stall'),
    title: $('overlay-title').textContent, text: $('overlay-text').textContent, load: shown('overlay-load'),
    bar: shown('overlay-bar') ? parseFloat($('overlay-bar-fill').style.width) : null,
    amber: shown('overlay-bar') && $('overlay-bar').classList.contains('slow'),
    figures: shown('overlay-figures') ? $('overlay-figures').textContent : '',
    slow: shown('overlay-slow') ? [$('overlay-speed').textContent, $('overlay-need').textContent].filter(Boolean).join(' | ') : '',
    elapsed: shown('overlay-elapsed') ? $('overlay-elapsed').textContent : '',
    actions: [...$('overlay-actions').querySelectorAll('button')].map((b) => b.textContent),
    t: $('video').currentTime }; })()`;

async function buffering(page) {
  const problems = [];
  // Slower than the header takes to read within ten seconds: the share
  // grows over the 256 kB the unpacker reads first, and the wait outlasts
  // the moment the time waited and Cancel come in.
  process.env.KEPULI_MOCK_THROTTLE = String(22 * 1024);
  await playEpisodeRow(page, 0);
  const seen = [];
  const t0 = Date.now();
  for (;;) {
    const view = await evaluate(page, WAIT_VIEW);
    if (await evaluate(page, PLAYING)) break;
    if (Date.now() - t0 > 40000) throw new Error(`no picture in 40 s; the overlay said "${view.title}"`);
    seen.push(view);
    await sleep(250);
  }
  if (process.env.KEPULI_TRACE) console.log(seen.map((v) => `${v.title} | ${v.figures} | ${v.elapsed}`).filter((x, i, all) => x !== all[i - 1]).join('\n'));
  const shares = seen.filter((v) => /^Buffering \d/.test(v.title)).map((v) => parseFloat(v.title.replace(/^Buffering /, '')));
  if (shares.length < 3) problems.push(`the start showed a share ${shares.length} times`);
  // The header read before it, on the same slow connection, is told too.
  const examined = seen.filter((v) => /^Examining the file \d/.test(v.title)).length;
  if (examined < 3) problems.push(`the header read showed a share ${examined} times`);
  // A step without figures of its own shows none of the step before.
  if (seen.some((v) => v.title === 'Connecting…' && v.figures)) problems.push('Connecting showed the figures of the step before');
  if (shares.some((v, i) => i && v < shares[i - 1])) problems.push(`the share went back: ${shares.join(', ')}`);
  if (!seen.some((v) => v.bar > 0)) problems.push('no bar');
  // The speed stands with the bytes, or — the film's bit rate known —
  // under them against what the film needs.
  if (!seen.some((v) => / \/ /.test(v.figures) && (/ · .*\/s$/.test(v.figures) || / Mbit\/s \| needs .* Mbit\/s$/.test(v.slow)))) {
    problems.push(`no bytes against a total with a speed: ${[...new Set(seen.map((v) => `${v.figures} ${v.slow}`))].slice(-3).join(' | ')}`);
  }
  if (!seen.some((v) => /^1\d s$/.test(v.elapsed))) problems.push('no time waited after ten seconds');
  if (!seen.some((v) => v.actions.includes('Cancel'))) problems.push('no Cancel after ten seconds');
  if (seen.some((v) => v.stall)) problems.push('the start was shown as a stall');
  const after = await evaluate(page, WAIT_VIEW);
  if (after.overlay || after.load) problems.push('the account stayed after the picture started');
  // A seek far outside the buffer on a connection slower than the film
  // (its bit rate is some 21 kB/s): the stall shows over the picture,
  // says the connection is too slow, and goes once the picture moves.
  process.env.KEPULI_MOCK_THROTTLE = String(10 * 1024);
  await evaluate(page, `document.getElementById('video').currentTime = 80`);
  const stalls = [];
  const t1 = Date.now();
  for (;;) {
    const view = await evaluate(page, WAIT_VIEW);
    if (view.t > 81 && !view.overlay) break;
    if (Date.now() - t1 > 45000) throw new Error(`the seek did not play on in 45 s; the overlay said "${view.title}" (${view.figures})`);
    stalls.push(view);
    await sleep(250);
  }
  process.env.KEPULI_MOCK_THROTTLE = '';
  const stalled = stalls.filter((v) => v.overlay && v.stall);
  if (!stalled.length) problems.push('the seek showed no stall');
  if (stalled.some((v) => v.title !== 'Buffering…')) problems.push(`the stall's title: ${[...new Set(stalled.map((v) => v.title))].join(', ')}`);
  if (stalled.some((v) => v.actions.length)) problems.push('the stall offered buttons');
  if (stalled.some((v) => v.text)) problems.push(`the stall had a line of text: ${stalled.find((v) => v.text).text}`);
  if (!stalled.some((v) => /^0[.,]\d+ Mbit\/s \| needs 0[.,]\d+ Mbit\/s$/.test(v.slow) && v.amber && v.bar < 100)) {
    problems.push(`no slow connection shown: ${[...new Set(stalled.map((v) => `${v.slow} (bar ${v.bar}${v.amber ? ' amber' : ''})`))].join(' | ')}`);
  }
  const last = seen.at(-1) || {};
  return {
    ok: !problems.length,
    detail: problems.length ? problems.join('; ') : `start ${shares[0]}…${shares.at(-1)} % over ${seen.length} looks ("${last.figures}"), ${(stalled.length / 4).toFixed(1)} s stalled ("${stalled.at(-1)?.slow}")`,
  };
}

async function livebuffering(page) {
  const problems = [];
  process.env.KEPULI_MOCK_LIVE_TS = '1';
  // A second of the channel comes in two and a half: every second played
  // is followed by a stall long enough to be shown.
  process.env.KEPULI_MOCK_TS_PACE = '0.4';
  try {
    await openLiveList(page, 2);
    await evaluate(page, `document.querySelectorAll('#list .row')[0].click()`, { gesture: true });
    const seen = [];
    const t0 = Date.now();
    for (;;) {
      const view = await evaluate(page, WAIT_VIEW);
      seen.push({ ...view, at: Date.now() - t0 });
      if (Date.now() - t0 > 40000) break;
      if (view.slow && view.stall) break;
      await sleep(250);
    }
    if (process.env.KEPULI_TRACE) console.log(seen.map((v) => `${v.at} ${v.overlay ? '' : '(hidden) '}${v.stall ? 'stall ' : ''}${v.title} | ${v.figures} | ${v.slow}`).filter((x, i, all) => x.replace(/^\d+ /, '') !== all[i - 1]?.replace(/^\d+ /, '')).join('\n'));
    const start = seen.filter((v) => v.overlay && !v.stall && /^Buffering/.test(v.title));
    if (start.some((v) => v.bar != null || v.title !== 'Buffering…')) problems.push('the live start showed a share, which it cannot know');
    // The start is over within a second here, too soon for a speed.
    if (!start.some((v) => /^\d+ kB( · \d+ kB\/s)?$/.test(v.figures))) problems.push(`the live start showed no bytes: ${[...new Set(start.map((v) => v.figures))].join(' | ')}`);
    const stalled = seen.filter((v) => v.overlay && v.stall);
    if (!stalled.length) problems.push('no stall was shown');
    if (!stalled.some((v) => /\d+ kB\/s/.test(v.figures))) problems.push(`the stall showed no speed: ${[...new Set(stalled.map((v) => v.figures))].join(' | ')}`);
    if (!stalled.some((v) => v.slow === 'Connection too slow')) problems.push(`no slow connection said in 40 s: ${[...new Set(stalled.map((v) => v.slow))].join(' | ')}`);
    // Between the stalls the picture plays without the overlay. Firefox
    // waits for more of the stream before it plays on, and at this pace
    // that is longer than the scenario looks.
    const between = seen.findIndex((v, i) => i > 0 && !v.overlay && seen.slice(0, i).some((w) => w.stall));
    if (between < 0 && process.env.KEPULI_BROWSER !== 'firefox') problems.push('the overlay never left between the stalls');
    return { ok: !problems.length, detail: problems.length ? problems.join('; ') : `start "${start.at(-1)?.figures}", ${stalled.length / 4} s stalled, said "${stalled.at(-1)?.slow}"` };
  } finally {
    process.env.KEPULI_MOCK_LIVE_TS = '';
    process.env.KEPULI_MOCK_TS_PACE = '';
  }
}

async function filmbuffering(page) {
  const firefox = process.env.KEPULI_BROWSER === 'firefox';
  process.env.KEPULI_MOCK_THROTTLE = String(30 * 1024);
  try {
    await evaluate(page, `document.querySelector('#tabs [data-tab="movie"]').click()`);
    await click(page, '#groups', 'Nordic');
    await click(page, '#list', 'Northern Lights', { gesture: true });
    const seen = [];
    const t0 = Date.now();
    for (;;) {
      if (await evaluate(page, PLAYING)) break;
      if (Date.now() - t0 > 40000) throw new Error('no picture in 40 s');
      seen.push(await evaluate(page, WAIT_VIEW));
      await sleep(250);
    }
    if (process.env.KEPULI_TRACE) console.log(seen.map((v) => `${v.title} | ${v.figures}`).filter((x, i, all) => x !== all[i - 1]).join('\n'));
    const shareOf = (label) => seen.filter((v) => v.title.startsWith(`${label} `) && /\d/.test(v.title))
      .map((v) => parseFloat(v.title.slice(label.length + 1)));
    const index = shareOf('Reading the file’s index');
    const shares = shareOf('Buffering');
    const problems = [];
    if (firefox) {
      // Two steps, each of a size known to the byte: the index, then the
      // samples to the first picture. Neither share may go back.
      if (index.length < 2) problems.push(`the index read showed a share ${index.length} times`);
      if (shares.length < 2) problems.push(`the start showed a share ${shares.length} times`);
      for (const [name, list] of [['index', index], ['start', shares]]) {
        if (list.some((v, i) => i && v < list[i - 1])) problems.push(`the ${name}'s share went back: ${list.join(', ')}`);
      }
      const steps = seen.map((v) => (/^Reading.*\d/.test(v.title) ? 'index' : /^Buffering \d/.test(v.title) ? 'start' : null)).filter(Boolean);
      if (steps.lastIndexOf('index') > steps.indexOf('start')) problems.push('the index was read after the start');
    } else if (shares.length || index.length || seen.some((v) => v.bar != null)) {
      problems.push('the browser\'s own player showed a share it cannot know');
    }
    const after = await evaluate(page, WAIT_VIEW);
    if (after.overlay || after.load) problems.push('the account stayed after the picture started');
    return { ok: !problems.length, detail: problems.length ? problems.join('; ') : `${seen.length} looks, ${index.length ? `index ${index[0]}…${index.at(-1)} %, ` : ''}${shares.length ? `start ${shares[0]}…${shares.at(-1)} %` : 'no share'}, last "${seen.at(-1)?.title} ${seen.at(-1)?.figures}"` };
  } finally {
    process.env.KEPULI_MOCK_THROTTLE = '';
  }
}

async function emptyfile(page) {
  process.env.KEPULI_MOCK_EMPTY = '1';
  try {
    await evaluate(page, `document.querySelector('#tabs [data-tab="series"]').click()`);
    await click(page, '#groups', 'Nordic Noir');
    await click(page, '#list', 'Silent Fjord');
    await waitFor(page, `!document.getElementById('detail').hidden && document.querySelectorAll('#list .row').length > 0`, 'the series page');
    const t0 = Date.now();
    await evaluate(page, `document.querySelectorAll('#list .row')[0].click()`, { gesture: true });
    let text = '';
    for (let i = 0; i < 160; i++) {
      text = await evaluate(page, `document.getElementById('overlay').hidden ? '' : document.getElementById('overlay-text').textContent`);
      if (/server sent nothing/i.test(text)) break;
      await sleep(250);
    }
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    // Our own empty read may still be counted at the provider: the account
    // must not be asked, nor another viewer blamed.
    await sleep(3000);
    const after = await evaluate(page, `document.getElementById('overlay-text').textContent`);
    const buttons = await evaluate(page, `[...document.querySelectorAll('#overlay button')].map((b) => b.textContent.trim()).filter(Boolean).join(' / ')`);
    const ok = /server sent nothing/i.test(after) && !/connection|in use/i.test(after) && Number(secs) < 10;
    return { ok, detail: `after ${secs} s: "${after}" [${buttons}]` };
  } finally {
    process.env.KEPULI_MOCK_EMPTY = '';
  }
}

async function tsasmp4(page) {
  process.env.KEPULI_MOCK_TS_AS_MP4 = '1';
  try {
    await evaluate(page, `document.querySelector('#tabs [data-tab="movie"]').click()`);
    await click(page, '#groups', 'Nordic');
    await click(page, '#list', 'Northern Lights', { gesture: true });
    const titles = new Set();
    const t0 = Date.now();
    let playing = false;
    while (Date.now() - t0 < 30000) {
      if ((playing = await evaluate(page, PLAYING))) break;
      titles.add(await evaluate(page, OVERLAY_TITLE));
      await sleep(250);
    }
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    // The film is not what its name says: the header is read and the
    // engine for MPEG-TS started, with no wait for a connection between.
    const waited = [...titles].some((x) => /waiting for the connection|failed/i.test(x));
    return { ok: playing && !waited, detail: `${playing ? 'playing' : 'no picture'} after ${secs} s; titles ${[...titles].filter(Boolean).join(' / ') || 'none'}` };
  } finally {
    process.env.KEPULI_MOCK_TS_AS_MP4 = '';
  }
}

async function refusedfile(page) {
  process.env.KEPULI_MOCK_REFUSED_FILE = '1';
  try {
    await evaluate(page, `document.querySelector('#tabs [data-tab="series"]').click()`);
    await click(page, '#groups', 'Nordic Noir');
    await click(page, '#list', 'Silent Fjord');
    await waitFor(page, `!document.getElementById('detail').hidden && document.querySelectorAll('#list .row').length > 0`, 'the series page');
    const t0 = Date.now();
    await evaluate(page, `document.querySelectorAll('#list .row')[0].click()`, { gesture: true });
    let text = '';
    for (let i = 0; i < 160; i++) {
      text = await evaluate(page, `document.getElementById('overlay').hidden ? '' : document.getElementById('overlay-text').textContent`);
      if (/answered with error 400/i.test(text)) break;
      await sleep(250);
    }
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    // Our own empty read may still be counted at the provider: the account
    // must not be asked, nor another viewer blamed.
    await sleep(3000);
    const after = await evaluate(page, `document.getElementById('overlay-text').textContent`);
    const buttons = await evaluate(page, `[...document.querySelectorAll('#overlay button')].map((b) => b.textContent.trim()).filter(Boolean).join(' / ')`);
    const ok = /answered with error 400/i.test(after) && !/connection|in use/i.test(after) && Number(secs) < 10;
    return { ok, detail: `after ${secs} s: "${after}" [${buttons}]` };
  } finally {
    process.env.KEPULI_MOCK_REFUSED_FILE = '';
  }
}

async function badgateway(page) {
  process.env.KEPULI_MOCK_BAD_GATEWAY = '1';
  try {
    await evaluate(page, `document.querySelector('#tabs [data-tab="series"]').click()`);
    await click(page, '#groups', 'Nordic Noir');
    await click(page, '#list', 'Silent Fjord');
    await waitFor(page, `!document.getElementById('detail').hidden && document.querySelectorAll('#list .row').length > 0`, 'the series page');
    const t0 = Date.now();
    await evaluate(page, `document.querySelectorAll('#list .row')[0].click()`, { gesture: true });
    let text = '';
    for (let i = 0; i < 160; i++) {
      text = await evaluate(page, `document.getElementById('overlay').hidden ? '' : document.getElementById('overlay-text').textContent`);
      if (/answered with error 502/i.test(text)) break;
      await sleep(250);
    }
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    // Our own empty read may still be counted at the provider: the account
    // must not be asked, nor another viewer blamed.
    await sleep(3000);
    const after = await evaluate(page, `document.getElementById('overlay-text').textContent`);
    const buttons = await evaluate(page, `[...document.querySelectorAll('#overlay button')].map((b) => b.textContent.trim()).filter(Boolean).join(' / ')`);
    const ok = /answered with error 502/i.test(after) && !/connection|in use/i.test(after) && Number(secs) < 10;
    return { ok, detail: `after ${secs} s: "${after}" [${buttons}]` };
  } finally {
    process.env.KEPULI_MOCK_BAD_GATEWAY = '';
  }
}

/**
 * How long the overlay takes to say a start failed, and what it says: the
 * row is clicked, and the overlay's title read until it gives up.
 */
async function failureAfterClick(page, clickRow, limitMs) {
  await clickRow();
  const t0 = Date.now();
  let title = '';
  while (Date.now() - t0 < limitMs) {
    title = await evaluate(page, OVERLAY_TITLE);
    if (/failed/i.test(title)) break;
    await sleep(250);
  }
  const text = await evaluate(page, `document.getElementById('overlay').hidden ? '' : document.getElementById('overlay-text').textContent`);
  return { secs: (Date.now() - t0) / 1000, title, text };
}

const clickFirstChannel = (page) => async () => {
  await openLiveList(page, 2);
  await evaluate(page, `document.querySelectorAll('#list .row')[0].click()`, { gesture: true });
};
const clickFirstEpisode = (page) => async () => {
  await evaluate(page, `document.querySelector('#tabs [data-tab="series"]').click()`);
  await click(page, '#groups', 'Nordic Noir');
  await click(page, '#list', 'Silent Fjord');
  await waitFor(page, `!document.getElementById('detail').hidden && document.querySelectorAll('#list .row').length > 0`, 'the series page');
  await evaluate(page, `document.querySelectorAll('#list .row')[0].click()`, { gesture: true });
};

/**
 * A channel the provider will not give — 407 at once, before any redirect,
 * as a real provider answers for one outside the subscription — is said to
 * be so at once, and neither waited on nor blamed on the connections.
 */
async function livebadgateway(page) {
  process.env.KEPULI_MOCK_LIVE_BAD_GATEWAY = '1';
  try {
    const got = await failureAfterClick(page, clickFirstChannel(page), 20000);
    await sleep(3000);
    const after = await evaluate(page, `document.getElementById('overlay-text').textContent`);
    const ok = /answered with error 502/i.test(after) && !/connection|in use/i.test(after) && got.secs < 5;
    return { ok, detail: `after ${got.secs.toFixed(1)} s "${got.title}": "${after}"` };
  } finally {
    process.env.KEPULI_MOCK_LIVE_BAD_GATEWAY = '';
  }
}

async function channelrefused(page) {
  process.env.KEPULI_MOCK_CHANNEL_REFUSED = '1';
  try {
    const got = await failureAfterClick(page, clickFirstChannel(page), 20000);
    await sleep(3000);
    const after = await evaluate(page, `document.getElementById('overlay-text').textContent`);
    const ok = /stream request( with error 407|: the connection failed without an answer)/i.test(after) && !/in use/i.test(after) && got.secs < 5;
    return { ok, detail: `after ${got.secs.toFixed(1)} s "${got.title}": "${after}"` };
  } finally {
    process.env.KEPULI_MOCK_CHANNEL_REFUSED = '';
  }
}

/**
 * A server that takes the request and never answers: an episode and a
 * channel are given up within seconds, not the half minute of the start
 * timeout.
 */
async function noanswer(page) {
  process.env.KEPULI_MOCK_NO_ANSWER = '1';
  try {
    const episode = await failureAfterClick(page, clickFirstEpisode(page), 40000);
    const channel = await failureAfterClick(page, clickFirstChannel(page), 40000);
    const ok = /failed/i.test(episode.title) && /failed/i.test(channel.title) && episode.secs < 13 && channel.secs < 13;
    return { ok, detail: `episode after ${episode.secs.toFixed(1)} s: "${episode.title}: ${episode.text}"; channel after ${channel.secs.toFixed(1)} s: "${channel.title}: ${channel.text}"` };
  } finally {
    process.env.KEPULI_MOCK_NO_ANSWER = '';
  }
}

async function longfilm(page) {
  if (!process.env.KEPULI_MOCK_LONG) return { ok: true, detail: 'skipped: KEPULI_MOCK_LONG names no folder of long files' };
  const secs = Number(process.env.KEPULI_LONG_SECS || 240);
  await playEpisode(page);
  const first = await evaluate(page, `document.getElementById('video').duration`);
  const samples = [];
  const t0 = Date.now();
  let bad = null;
  while (Date.now() - t0 < secs * 1000) {
    await sleep(5000);
    const s = await evaluate(page, `(() => { const v = document.getElementById('video'); const b = v.buffered;
      return { at: Math.round((Date.now() - ${t0}) / 1000), t: +v.currentTime.toFixed(1), d: +(+v.duration).toFixed(1), end: b.length ? +b.end(b.length - 1).toFixed(1) : 0,
        ended: v.ended, paused: v.paused, overlay: document.getElementById('overlay').hidden ? '' : document.getElementById('overlay').innerText.replace(/\s+/g, ' ').slice(0, 100) }; })()`);
    samples.push(s);
    if (s.d < first - 1 || s.ended || s.overlay) { bad = s; break; }
  }
  const last = samples[samples.length - 1];
  // Then to the last quarter minute, and on to the end: the seek reads from
  // the keyframe before it, and the film ends where it ends.
  let end = null;
  if (!bad) {
    await evaluate(page, `document.getElementById('video').currentTime = ${Math.max(0, first - 15)}`);
    for (let i = 0; i < 90 && !end; i++) {
      await sleep(1000);
      const s = await evaluate(page, `(() => { const v = document.getElementById('video'); return { t: +v.currentTime.toFixed(1), d: +(+v.duration).toFixed(1), ended: v.ended }; })()`);
      if (s.ended) end = s;
    }
  }
  const engine = await evaluate(page, `document.getElementById('video').src.split(':')[0]`);
  const ok = !bad && last.t > Math.min(secs * 0.8, first - 5) && end && Math.abs(end.t - first) < 2 && Math.abs(end.d - first) < 2;
  return { ok, detail: `engine "${engine}"; end ${JSON.stringify(end)}; duration ${first} s; ${samples.map((s) => `${s.at}s:t=${s.t}/d=${s.d}/buf=${s.end}${s.paused ? ' paused' : ''}${s.overlay ? ' "' + s.overlay + '"' : ''}`).join(' ')}` };
}

async function seek(page) {
  const T1 = 90, T2 = 100;
  // Bounded range reads — the seek table — are slowed down so that the
  // second seek lands while the first one's fetch is in flight.
  await evaluate(page, `(() => { const orig = window.fetch.bind(window);
    window.fetch = async (url, init) => { const range = init && init.headers && init.headers.Range;
      const res = await orig(url, init);
      if (range && /^bytes=\\d+-\\d+$/.test(range)) await new Promise((r) => setTimeout(r, ${CUES_DELAY_MS}));
      return res; }; return true; })()`);
  await playEpisode(page);
  await evaluate(page, `document.getElementById('video').currentTime = ${T1}`);
  await sleep(400);
  await evaluate(page, `document.getElementById('video').currentTime = ${T2}`);
  let last = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) {
    last = await videoState(page);
    if (last.t > T2 + 1.5 && !last.paused) return { ok: true, detail: `playing at ${last.t} s, buffered ${last.buffered}` };
    await sleep(1000);
  }
  return { ok: false, detail: `stuck at ${last.t} s, buffered ${last.buffered}` };
}

async function death(page, { server }) {
  // The player's own warnings, for the report: they say which path was taken.
  await evaluate(page, `(() => { window.__log = []; for (const k of ['warn', 'error']) { const o = console[k].bind(console);
    console[k] = (...a) => { window.__log.push(a.map((x) => (x && x.message) || String(x)).join(' ').slice(0, 120)); o(...a); }; } return true; })()`);
  await playEpisode(page);
  // The server goes away under the open download: its sockets are cut and
  // it stops listening, so the resumes find nothing. (DevTools' offline
  // emulation would not do: it leaves a download in flight alone.)
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  let last = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 40000) {
    last = await videoState(page);
    if (last.overlay && /Playback stopped/.test(last.overlay)) {
      const retry = last.actions.some((a) => /try again|retry|yritä/i.test(a));
      return { ok: retry, detail: `after ${((Date.now() - t0) / 1000).toFixed(1)} s: "${last.overlay}" actions ${last.actions.join(' / ')}` };
    }
    await sleep(1000);
  }
  const log = await evaluate(page, 'window.__log.slice(-6)');
  return { ok: false, detail: `no message in 40 s; picture at ${last.t} s, overlay ${last.overlay}; log: ${JSON.stringify(log)}` };
}

// The row's name without the count that appears once the whole list is in.
const ACTIVE_GROUP = `((document.querySelector('#groups .active') || {}).textContent || '').trim().replace(/\\s*\\d+$/, '')`;
const OVERLAY = `(() => { const ov = document.getElementById('overlay'); return ov.hidden ? null : ov.textContent.trim().replace(/\\s+/g, ' ').slice(0, 100); })()`;

/** "All" on the Channels tab, which needs the whole list — slow to arrive here. */
async function loadAll(page) {
  await openLiveList(page);
  const before = await evaluate(page, ACTIVE_GROUP);
  await click(page, '#groups', 'All');
  await waitFor(page, `!document.getElementById('list-progress').hidden`, 'the loading strip', 5000);
  return before;
}

async function cancel(page) {
  let before;
  // The load lives in the list column now, not in a modal over everything, so
  // what has to keep working is Escape wherever the focus is, the strip's own
  // Cancel, and the player underneath being live throughout.
  for (const control of ['Escape', 'lp-cancel']) {
    before = await loadAll(page);
    const live = await evaluate(page, `(() => { const b = document.getElementById('btn-reload');
      return !b.disabled && b.getClientRects().length > 0 && document.elementFromPoint(
        Math.round(b.getBoundingClientRect().left + b.getBoundingClientRect().width / 2),
        Math.round(b.getBoundingClientRect().top + b.getBoundingClientRect().height / 2)) === b; })()`);
    if (!live) throw new Error('the loading strip left the player unreachable');
    if (control === 'Escape') await pressKey(page, 'Escape', 'Escape', 27);
    else await evaluate(page, `document.getElementById('${control}').click()`);
    await waitFor(page, `document.getElementById('list-progress').hidden`, `${control} cancels loading`, 5000);
    if (await evaluate(page, ACTIVE_GROUP) !== before) throw new Error(`${control} did not restore the previous group`);
  }
  await sleep(500);
  const after = await evaluate(page, `({ overlay: ${OVERLAY}, active: ${ACTIVE_GROUP}, rows: document.querySelectorAll('#list .row').length, toast: document.getElementById('toast').textContent.trim() })`);
  // The overlay may say "Nothing playing": only an error counts against.
  const ok = !/failed|error/i.test(after.overlay || '') && after.active === before && after.rows > 0;
  return { ok, detail: `Escape and Cancel abort loading with the player reachable throughout; group "${before}" → "${after.active}", ${after.rows} rows, overlay ${after.overlay}, toast "${after.toast}"` };
}

async function timeout(page) {
  const before = await loadAll(page);
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < 35000) {
    // The list's own error goes to a toast over the rows on screen (or to
    // the list's empty state when there are none), never over the player.
    last = await evaluate(page, `({ open: !document.getElementById('list-progress').hidden, overlay: ${OVERLAY}, active: ${ACTIVE_GROUP},
      toast: document.getElementById('toast').hidden ? '' : document.getElementById('toast').textContent.trim(),
      empty: (document.querySelector('#list .empty') || {}).textContent || '' })`);
    if (!last.open && /did not answer within/.test(last.toast + last.empty)) {
      const ok = !/failed/i.test(last.overlay || '') && last.active === before;
      return { ok, detail: `after ${((Date.now() - t0) / 1000).toFixed(1)} s: "${last.toast || last.empty}"; group "${before}" → "${last.active}", overlay ${last.overlay ? '"' + last.overlay + '"' : 'hidden'}` };
    }
    await sleep(500);
  }
  return { ok: false, detail: `after 35 s the strip is ${last.open ? 'still showing' : 'gone'}, toast "${last.toast}", overlay ${last.overlay}` };
}

/** A search takes over from the group, and the group comes back when the search is cleared. */
async function search(page) {
  await evaluate(page, `document.querySelector('#tabs [data-tab="live"]').click()`);
  await waitFor(page, `document.querySelectorAll('#groups .group').length > 1`, 'the sidebar');
  const before = await evaluate(page, ACTIVE_GROUP);
  const type = (text) => evaluate(page, `(() => { const s = document.getElementById('search'); s.value = ${JSON.stringify(text)}; s.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await type('aurora');
  await waitFor(page, `${ACTIVE_GROUP}.startsWith('All') && document.getElementById('list-progress').hidden && document.querySelectorAll('#list .row').length > 0`, 'the search results', 15000);
  const hits = await evaluate(page, `document.querySelectorAll('#list .row').length`);
  await type('');
  await sleep(600);
  const after = await evaluate(page, ACTIVE_GROUP);
  return { ok: after === before, detail: `"${before}" → search (${hits} rows under "All") → cleared → "${after}"` };
}

/** A whole address pasted into the Server field lands in the right fields. */
async function paste(page) {
  await evaluate(page, `document.getElementById('btn-settings').click()`);
  await waitFor(page, `document.getElementById('setup').open`, 'the settings dialog', 5000);
  await checkModal(page, '#setup', 'settings');
  // The fields live in their own section now, and that is where a viewer
  // pasting an address would be.
  await evaluate(page, `document.querySelector('#setup-tabs [data-panel="connection"]').click()`);
  await sleep(200);
  const address = `http://127.0.0.1:${MOCK_PORT}/player_api.php?username=demo&password=demo`;
  await evaluate(page, `(() => { const h = document.getElementById('f-host'); h.value = ${JSON.stringify(address)};
    h.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await sleep(300);
  const fields = await evaluate(page, `['scheme', 'host', 'port', 'username', 'password'].map((f) => document.getElementById('f-' + f).value)`);
  // Normalised fields still describe the saved account; closing is clean.
  await evaluate(page, `document.getElementById('f-close').click()`);
  const expected = ['http', '127.0.0.1', String(MOCK_PORT), 'demo', 'demo'];
  return { ok: JSON.stringify(fields) === JSON.stringify(expected), detail: `fields ${JSON.stringify(fields)}` };
}

/* A real mouse click and a real key, through DevTools' input domain: a
   click from the mouse leaves the focus on the button, which is the point. */
async function mouseClick(page, selector) {
  const r = await evaluate(page, `(() => { const b = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
  await page.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y });
  await page.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1 });
  await page.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', clickCount: 1 });
}
// DevTools' own bitmask for the keys held down with the key: Alt 1, Ctrl 2,
// Cmd 4, Shift 8.
const CTRL = 2;
const CMD = 4;
async function pressKey(page, key, code, keyCode, modifiers = 0) {
  await page.call('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode, modifiers });
  await page.call('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode, modifiers });
}

/**
 * The keys keep working after a button has been clicked with the mouse, and
 * a key held down with Cmd or Ctrl is left to the browser.
 */
async function keys(page) {
  await evaluate(page, `document.querySelector('#tabs [data-tab="live"]').click()`);
  await waitFor(page, `document.querySelectorAll('#list .row').length > 0`, 'the channel rows');
  // Guide with the mouse, then Esc.
  await mouseClick(page, '#btn-guide');
  await waitFor(page, `document.getElementById('main').classList.contains('guide')`, 'the guide', 10000);
  await sleep(500);
  await pressKey(page, 'Escape', 'Escape', 27);
  await sleep(500);
  const guideClosed = !(await evaluate(page, `document.getElementById('main').classList.contains('guide')`));
  // A tab with the mouse, then an arrow in the list.
  await mouseClick(page, '#tabs [data-tab="movie"]');
  await waitFor(page, `document.querySelectorAll('#list .row').length > 0 && document.querySelector('#tabs [data-tab="movie"]').classList.contains('active')`, 'the movie rows');
  await sleep(300);
  await pressKey(page, 'ArrowDown', 'ArrowDown', 40);
  await sleep(300);
  const cursorMoved = await evaluate(page, `Boolean(document.querySelector('#list .row.selected'))`);
  const focus = await evaluate(page, `document.activeElement.tagName + (document.activeElement.id ? '#' + document.activeElement.id : '')`);
  // Cmd+F and Ctrl+F are the browser's search box, not the app's: only the
  // bare f takes the picture to full screen. Each of the two is measured on
  // its own, because full screen is a toggle: pressed one after the other
  // they would undo each other and leave the state looking right.
  const fullscreen = async (key, modifiers) => {
    await pressKey(page, key, 'KeyF', 70, modifiers);
    await sleep(600);
    const id = await evaluate(page, `(document.fullscreenElement || {}).id || ''`);
    await evaluate(page, `document.fullscreenElement && document.exitFullscreen()`);
    await sleep(500);
    return id;
  };
  const withCmd = await fullscreen('f', CMD);
  const withCtrl = await fullscreen('f', CTRL);
  const bare = await fullscreen('f', 0);
  const fullscreenKey = !withCmd && !withCtrl && bare === 'videowrap';
  return { ok: guideClosed && cursorMoved && fullscreenKey, detail: `Esc after the Guide click ${guideClosed ? 'closed' : 'did not close'} the guide; ArrowDown after the tab click ${cursorMoved ? 'moved' : 'did not move'} the cursor; focus on ${focus}; Cmd+F went to ${withCmd || 'nothing'} and Ctrl+F to ${withCtrl || 'nothing'}, a bare f to ${bare || 'nothing'}` };
}

/**
 * A live channel dies and the viewer switches channel during the wait
 * before the reconnect. The wait must not restart the new channel: every
 * attempt begins with a request for the .ts address, so the new channel's
 * must be asked for once.
 */
async function switching(page, { requests }) {
  try {
    await playFirstChannel(page);
  } catch (err) {
    const st = await videoState(page);
    throw new Error(`${err.message}; overlay "${st.overlay}", readyState ${st.readyState}, requests ${requests.slice(-4).join(' ')}`);
  }
  const from = requests.length;
  // The stream "ends": the guards answer with a reconnect after a second.
  await evaluate(page, `document.getElementById('video').dispatchEvent(new Event('ended'))`);
  await sleep(200);
  await evaluate(page, `document.querySelectorAll('#list .row')[1].click()`, { gesture: true });
  await sleep(5000);
  // The stream address itself, not the HLS segments that follow it.
  const ts = requests.slice(from).filter((u) => /^\/live\/[^/]+\/[^/]+\/\d+\.ts(\?|$)/.test(u));
  // What is playing is the head of the tab's title, and the path where the
  // list stands follows it: a window of tabs says which one is the player
  // and what it is playing without being opened.
  const titled = await evaluate(page, `(() => { const name = document.getElementById('now-title').textContent;
    return { ok: document.title.startsWith(name + ' (Channels › '), title: document.title }; })()`);
  if (!titled.ok) return { ok: false, detail: `the title does not name what is playing: ${JSON.stringify(titled.title)}` };
  return { ok: ts.length === 1, detail: `${ts.length} stream request(s) after the switch: ${ts.join(' ')}; title ${JSON.stringify(titled.title)}` };
}

/**
 * A film with a resume position is abandoned before its metadata arrived,
 * for an episode. The episode must start from the beginning, not from the
 * film's position.
 */
async function resume(page) {
  const list = await (await fetch(`http://127.0.0.1:${MOCK_PORT}/player_api.php?username=demo&password=demo&action=get_vod_streams`)).json();
  const film = list.find((m) => /Northern Lights/.test(m.name));
  if (!film) throw new Error('the demo has no film called Northern Lights');
  await evaluate(page, `chrome.storage.local.get('settings').then((got) => chrome.storage.local.set({
    settings: { ...got.settings, resumeEnabled: true },
    resume: { ['1:' + ${JSON.stringify(String(film.stream_id))}]: { position: 60, duration: 120, at: Date.now() } } }))`);
  await page.call('Page.reload');
  await sleep(1000);
  await waitFor(page, CONNECTED, 'the connection after the reload');
  // Sent slowly, the film's metadata takes a second or two to arrive: time
  // enough to switch to the episode before it.
  process.env.KEPULI_MOCK_THROTTLE = String(THROTTLE);
  await evaluate(page, `document.querySelector('#tabs [data-tab="movie"]').click()`);
  await click(page, '#groups', 'Nordic');
  await click(page, '#list', 'Northern Lights', { gesture: true });
  await sleep(400);
  await evaluate(page, `document.querySelector('#tabs [data-tab="series"]').click()`);
  await click(page, '#groups', 'Nordic Noir');
  await click(page, '#list', 'Silent Fjord');
  await waitFor(page, `!document.getElementById('detail').hidden && document.querySelectorAll('#list .row').length > 0`, 'the series page');
  await evaluate(page, `document.querySelector('#list .row').click()`, { gesture: true });
  await waitFor(page, PLAYING, 'the episode');
  await sleep(2000);
  const st = await videoState(page);
  process.env.KEPULI_MOCK_THROTTLE = '';
  return { ok: st.t < 30, detail: `the episode is at ${st.t} s (the film's resume position was 60 s)` };
}

/**
 * The account allows one connection, and the mock now holds the player to
 * it: a stream asked for while another is open is refused, and every
 * overlap is recorded. Three rounds.
 *
 * Strict: the episode is started five times in quick succession, then the
 * next one, then a seek. No stream may have been asked for over another.
 *
 * Lagging: the server goes on counting a closed stream for a few seconds,
 * as the provider's does. Started over, the episode is first refused; the
 * player must wait for the release and start by itself, never showing the
 * failure.
 *
 * Lagging, a film: the browser's own player holds its stream as the other
 * engines do — another tab asking is answered — and started over under the
 * lag, the film plays again without a failure or a second stream.
 *
 * Another tab: a stand-in tab holds the stream and answers the player's
 * channel. The failure must name the tab and offer Play here, which ends
 * the other tab's stream and plays.
 */
async function connections(page, { requests }) {
  const OVERLAY_TITLE = `(document.getElementById('overlay').hidden ? '' : document.getElementById('overlay-title').textContent)`;
  const notes = [];
  process.env.KEPULI_MOCK_LIMIT = '1';
  try {
    // Strict.
    await playEpisode(page);
    const stream = requests.find((u) => /^\/series\/.*\.mkv/.test(u));
    if (!stream) throw new Error('no episode stream was requested');
    for (let i = 0; i < 5; i++) {
      await evaluate(page, `document.querySelectorAll('#list .row')[0].click()`, { gesture: true });
      await sleep(i % 2 ? 1500 : 300);
    }
    await waitFor(page, PLAYING, 'the episode after the restarts', 40000);
    await evaluate(page, `document.querySelectorAll('#list .row')[1].click()`, { gesture: true });
    await waitFor(page, PLAYING, 'the second episode', 40000);
    await sleep(2000);
    await evaluate(page, `document.getElementById('video').currentTime = 60`);
    await waitFor(page, `document.getElementById('video').currentTime > 61`, 'playback after the seek', 40000);
    // A film goes through the browser's own player, which asks for its
    // ranges by itself: started over too, it must keep to one as well.
    await evaluate(page, `document.querySelector('#tabs [data-tab="movie"]').click()`);
    await click(page, '#groups', 'Nordic');
    for (let i = 0; i < 3; i++) {
      await click(page, '#list', 'Northern Lights', { gesture: true });
      await sleep(i === 1 ? 1500 : 400);
    }
    await waitFor(page, PLAYING, 'the film after the restarts', 40000);
    await evaluate(page, `document.getElementById('video').currentTime = 60`);
    await waitFor(page, `document.getElementById('video').currentTime > 61`, 'the film after the seek', 40000);
    const strict = connectionStats();
    if (strict.overlaps.length || strict.refused.length) {
      return { ok: false, detail: `strict: ${strict.overlaps.length} overlap(s) ${strict.overlaps.slice(0, 3).join(' | ')}; refused ${strict.refused.slice(0, 3).join(' | ')}` };
    }
    notes.push(`strict: no overlap in ${requests.filter((u) => /^\/(series|movie)\//.test(u)).length} stream requests, peak ${strict.peak}`);

    // Lagging.
    process.env.KEPULI_MOCK_RELEASE_MS = '5000';
    await evaluate(page, `(() => { window.__titles = [];
      new MutationObserver(() => window.__titles.push(${OVERLAY_TITLE})).observe(document.getElementById('overlay'), { attributes: true, childList: true, subtree: true });
      return true; })()`);
    const refusedBefore = connectionStats().refused.length;
    await evaluate(page, `document.querySelectorAll('#list .row')[0].click()`, { gesture: true });
    try { await waitFor(page, PLAYING, 'the episode after the server let go', 40000); }
    catch (err) { throw new Error(`${err.message}: titles ${JSON.stringify(await evaluate(page, 'window.__titles'))}, text "${await evaluate(page, "document.getElementById('overlay-text').textContent")}", refused ${JSON.stringify(connectionStats().refused.slice(refusedBefore))}`); }
    const titles = [...new Set(await evaluate(page, 'window.__titles'))].filter(Boolean);
    const refusedLag = connectionStats().refused.length - refusedBefore;
    if (!titles.includes('Waiting for the connection') || titles.includes('Playback failed') || !refusedLag) {
      return { ok: false, detail: `lagging: ${refusedLag} refused, overlay titles ${JSON.stringify(titles)}` };
    }
    notes.push(`lagging: ${refusedLag} refused, waited (${titles.join(' → ')}) and played`);

    // Lagging, a film. A fresh page has let nothing go, and the episode's
    // count runs out before the film is asked for: only the film's own
    // release can be what the server is counting when it is started over.
    // Playing, the film must be what the tab holds — another tab asking is
    // answered — and started over, it must play again without a failure
    // shown or a second stream. Chrome's own loader asks again by itself
    // for a range that is refused, so there the wait need not be seen.
    await page.call('Page.reload');
    await sleep(1000);
    await waitFor(page, CONNECTED, 'the connection after the reload');
    await sleep(5500);
    await evaluate(page, `document.querySelector('#tabs [data-tab="movie"]').click()`);
    await click(page, '#groups', 'Nordic');
    await click(page, '#list', 'Northern Lights', { gesture: true });
    await waitFor(page, PLAYING, 'the film', 40000);
    await sleep(1000);
    // A channel of the page's own reaches the player's, as another tab's would.
    const answered = await evaluate(page, `new Promise((resolve) => { const tab = new BroadcastChannel('kepuli-playback'); const id = 'film-' + Date.now();
      tab.onmessage = ({ data }) => { if (data.type === 'holding' && data.id === id) { tab.close(); resolve(true); } };
      setTimeout(() => { tab.close(); resolve(false); }, 1000);
      tab.postMessage({ type: 'ask', id, account: ${JSON.stringify(`http://127.0.0.1:${MOCK_PORT}/demo`)} }); })`);
    if (!answered) return { ok: false, detail: 'lagging film: the tab playing a film does not answer that it holds the connection' };
    // A tab on another account holds none of this one's connections.
    const otherAccount = await evaluate(page, `new Promise((resolve) => { const tab = new BroadcastChannel('kepuli-playback'); const id = 'other-' + Date.now();
      tab.onmessage = ({ data }) => { if (data.type === 'holding' && data.id === id) { tab.close(); resolve(true); } };
      setTimeout(() => { tab.close(); resolve(false); }, 1000);
      tab.postMessage({ type: 'ask', id, account: 'http://elsewhere.example:80/demo' }); })`);
    if (otherAccount) return { ok: false, detail: 'lagging film: the tab answered a tab of another account that it holds the connection' };
    await evaluate(page, `(() => { window.__titles = [];
      new MutationObserver(() => window.__titles.push(${OVERLAY_TITLE})).observe(document.getElementById('overlay'), { attributes: true, childList: true, subtree: true });
      return true; })()`);
    const refusedFilm = connectionStats().refused.length;
    const overlapsFilm = connectionStats().overlaps.length;
    await click(page, '#list', 'Northern Lights', { gesture: true });
    await sleep(500);
    await waitFor(page, PLAYING, 'the film after the server let go', 40000);
    const filmTitles = [...new Set(await evaluate(page, 'window.__titles'))].filter(Boolean);
    const filmRefused = connectionStats().refused.length - refusedFilm;
    const filmOverlaps = connectionStats().overlaps.length - overlapsFilm;
    if (filmTitles.includes('Playback failed') || filmOverlaps) {
      return { ok: false, detail: `lagging film: ${filmRefused} refused, ${filmOverlaps} overlap(s) ${connectionStats().overlaps.slice(-2).join(' | ')}, overlay titles ${JSON.stringify(filmTitles)}` };
    }
    notes.push(`lagging film: holding answered; ${filmRefused} refused, played again (${filmTitles.join(' → ')})`);

    // Another tab: the page itself stands in for it, the stream held by a
    // fetch of its own and the channel answered as the player's would.
    process.env.KEPULI_MOCK_RELEASE_MS = '';
    await page.call('Page.reload');
    await sleep(1000);
    await waitFor(page, CONNECTED, 'the connection after the reload');
    await sleep(500);
    await evaluate(page, `(() => { const ctrl = new AbortController(); window.__other = { yielded: false };
      fetch(${JSON.stringify(`http://127.0.0.1:${MOCK_PORT}`)} + ${JSON.stringify(stream)}, { signal: ctrl.signal })
        .then((r) => r.body.getReader()).then(async (reader) => { for (;;) { const { done } = await reader.read(); if (done) break; } }).catch(() => {});
      const tab = new BroadcastChannel('kepuli-playback');
      tab.onmessage = ({ data }) => {
        if (window.__other.yielded) return;
        if (data.type === 'ask') tab.postMessage({ type: 'holding', id: data.id });
        if (data.type === 'yield') { ctrl.abort(); window.__other.yielded = true; tab.postMessage({ type: 'yielded', id: data.id }); }
      };
      return true; })()`);
    await sleep(1000);
    await playEpisodeRow(page, 0);
    await waitFor(page, `[...document.querySelectorAll('#overlay button')].some((b) => b.textContent === 'Play here')`, 'Play here', 40000);
    const named = (await videoState(page)).overlay;
    if (!/another tab/.test(named)) return { ok: false, detail: `another tab: the failure says "${named}"` };
    await evaluate(page, `[...document.querySelectorAll('#overlay button')].find((b) => b.textContent === 'Play here').click()`, { gesture: true });
    await waitFor(page, PLAYING, 'the episode taken over from the other tab', 40000);
    notes.push(`another tab: "${named}", taken over`);
    return { ok: true, detail: notes.join('; ') };
  } finally {
    process.env.KEPULI_MOCK_LIMIT = '';
    process.env.KEPULI_MOCK_RELEASE_MS = '';
  }
}

/**
 * Zapping live channels the way a provider serves them: each channel one
 * endless MPEG-TS connection, one connection on the account, the closed one
 * counted on for a few seconds, and an HLS viewer counted by session. A zap
 * into the counted seconds is refused; the player must wait for the release
 * and ask for the same stream again, never fall back to HLS, whose session
 * the provider would go on counting with nothing to close.
 */
async function livezap(page) {
  process.env.KEPULI_MOCK_LIVE_TS = '1';
  process.env.KEPULI_MOCK_LIMIT = '1';
  process.env.KEPULI_MOCK_RELEASE_MS = '3000';
  try {
    await evaluate(page, `document.querySelector('#tabs [data-tab="live"]').click()`);
    await click(page, '#groups', 'Finland');
    await waitFor(page, `document.querySelectorAll('#list .row').length > 5`, 'the channels');
    const before = connectionStats();
    await evaluate(page, `document.querySelectorAll('#list .row')[0].click()`, { gesture: true });
    await waitFor(page, PLAYING, 'the first channel', 40000);
    for (const [i, pause] of [[1, 300], [2, 1500], [3, 300], [4, 2500], [5, 800]]) {
      await evaluate(page, `document.querySelectorAll('#list .row')[${i}].click()`, { gesture: true });
      await sleep(pause);
    }
    await waitFor(page, PLAYING, 'the last channel after the zaps', 40000);
    await sleep(1500);
    const after = connectionStats();
    const hls = after.hls - before.hls;
    const refused = after.refused.length - before.refused.length;
    const overlaps = after.overlaps.length - before.overlaps.length;
    if (hls || overlaps || after.open !== 1) {
      return { ok: false, detail: `${hls} HLS playlist(s), ${overlaps} overlap(s), ${after.open} open at the end; refused ${after.refused.slice(-3).join(' | ')}` };
    }
    return { ok: true, detail: `6 channels, ${refused} refused while the server still counted the last, waited for and played over MPEG-TS; no HLS, no overlap, 1 open` };
  } finally {
    process.env.KEPULI_MOCK_LIVE_TS = '';
    process.env.KEPULI_MOCK_LIMIT = '';
    process.env.KEPULI_MOCK_RELEASE_MS = '';
  }
}

/**
 * A full account that does not refuse: the provider takes the connection
 * and sends nothing, or ends it at once. Either way the zap must not fall
 * back to HLS — the session it opened would be counted with nothing to
 * close — but ask the account and for the same stream again. Silent, the
 * start timeout passes before anything is known; by then the count has
 * run out and the stream is asked for once more. Ended, the account is
 * still counting the channel before and the release is waited for — and
 * while it is, the tab tells another that asks that it holds the connection.
 */
async function livequiet(page) {
  const OVERLAY_TITLE = `(document.getElementById('overlay').hidden ? '' : document.getElementById('overlay-title').textContent)`;
  process.env.KEPULI_MOCK_LIVE_TS = '1';
  process.env.KEPULI_MOCK_LIMIT = '1';
  process.env.KEPULI_MOCK_RELEASE_MS = '3000';
  const notes = [];
  try {
    await evaluate(page, `document.querySelector('#tabs [data-tab="live"]').click()`);
    await click(page, '#groups', 'Finland');
    await waitFor(page, `document.querySelectorAll('#list .row').length > 3`, 'the channels');
    await evaluate(page, `document.querySelectorAll('#list .row')[0].click()`, { gesture: true });
    await waitFor(page, PLAYING, 'the first channel', 40000);
    await evaluate(page, `(() => { window.__titles = [];
      new MutationObserver(() => window.__titles.push(${OVERLAY_TITLE})).observe(document.getElementById('overlay'), { attributes: true, childList: true, subtree: true });
      return true; })()`);
    for (const [row, mode, limit] of [[1, 'silent', 60000], [2, 'close', 40000]]) {
      process.env.KEPULI_MOCK_FULL = mode;
      await sleep(4000);    // the channel before is not still counted from its start
      await evaluate(page, 'window.__titles = []');
      const before = connectionStats();
      const t0 = Date.now();
      await evaluate(page, `document.querySelectorAll('#list .row')[${row}].click()`, { gesture: true });
      await sleep(500);
      // Waiting for the release, the tab holds no stream but will take one:
      // another tab asking is told so.
      let answered = null;
      if (mode === 'close') {
        await waitFor(page, `${OVERLAY_TITLE} === 'Waiting for the connection'`, 'the wait for the release', 15000);
        answered = await evaluate(page, `new Promise((resolve) => { const tab = new BroadcastChannel('kepuli-playback'); const id = 'wait-' + Date.now();
          tab.onmessage = ({ data }) => { if (data.type === 'holding' && data.id === id) { tab.close(); resolve(true); } };
          setTimeout(() => { tab.close(); resolve(false); }, 1000);
          tab.postMessage({ type: 'ask', id, account: ${JSON.stringify(`http://127.0.0.1:${MOCK_PORT}/demo`)} }); })`);
        if (!answered) return { ok: false, detail: `${notes.join('; ')}; close: the tab waiting for the release does not answer that it holds the connection` };
      }
      await waitFor(page, PLAYING, `the channel after a ${mode} full account`, limit);
      const after = connectionStats();
      const hls = after.hls - before.hls;
      const quiet = after.refused.slice(before.refused.length).filter((r) => r.endsWith(mode)).length;
      const titles = [...new Set(await evaluate(page, 'window.__titles'))].filter(Boolean);
      if (hls || !quiet || titles.includes('Playback failed') || after.overlaps.length > before.overlaps.length) {
        return { ok: false, detail: `${mode}: ${hls} HLS playlist(s), ${quiet} ${mode} answer(s), overlay titles ${JSON.stringify(titles)}, overlaps ${after.overlaps.slice(-2).join(' | ')}` };
      }
      notes.push(`${mode}: ${quiet} answer(s), played again over MPEG-TS in ${((Date.now() - t0) / 1000).toFixed(0)} s (${titles.join(' → ')})${answered ? ', holding while it waited' : ''}`);
    }
    await sleep(1500);
    const open = connectionStats().open;
    if (open !== 1) return { ok: false, detail: `${open} streams open at the end; ${notes.join('; ')}` };
    return { ok: true, detail: `${notes.join('; ')}; no HLS, 1 open` };
  } finally {
    process.env.KEPULI_MOCK_LIVE_TS = '';
    process.env.KEPULI_MOCK_LIMIT = '';
    process.env.KEPULI_MOCK_RELEASE_MS = '';
    process.env.KEPULI_MOCK_FULL = '';
  }
}

/** A row of the demo series' episode list clicked, without waiting for playback. */
async function playEpisodeRow(page, index) {
  await evaluate(page, `document.querySelector('#tabs [data-tab="series"]').click()`);
  await click(page, '#groups', 'Nordic Noir');
  await click(page, '#list', 'Silent Fjord');
  await waitFor(page, `!document.getElementById('detail').hidden && document.querySelectorAll('#list .row').length > ${index}`, 'the series page');
  await evaluate(page, `document.querySelectorAll('#list .row')[${index}].click()`, { gesture: true });
}

/**
 * The download breaks once, early in a cluster, and the server is there for
 * the resume. The frames that were waiting from the cluster before — audio
 * for a full segment, video for a keyframe — must be read again, or the
 * buffer keeps a hole that playback cannot cross.
 */
async function reconnect(page) {
  const { readFileSync } = await import('node:fs');
  const file = readFileSync(new URL('./mock/media/episode.mkv', import.meta.url));
  const id = Buffer.from([0x1f, 0x43, 0xb6, 0x75]);
  let at = -1, cluster = -1;
  while ((at = file.indexOf(id, at + 1)) !== -1) { if (at > 300000) { cluster = at; break; } }
  if (cluster < 0) throw new Error('no cluster after 300 kB in the demo episode');
  process.env.KEPULI_MOCK_CUT_AT = String(cluster + 6000);
  await playEpisode(page);
  // The break comes a few seconds in and the rest of the file follows the
  // resume; once it is all in, the buffer tells whether a hole was left.
  const ranges = () => evaluate(page, `(() => { const b = document.getElementById('video').buffered; return [...Array(b.length)].map((_, i) => [b.start(i), b.end(i)]); })()`);
  let got = [];
  for (let i = 0; i < 40; i++) {
    got = await ranges();
    if (got.length && got[got.length - 1][1] >= 110) break;
    await sleep(1000);
  }
  const holes = got.slice(1).map((r, i) => `${got[i][1].toFixed(1)}-${r[0].toFixed(1)}`);
  // Playback across the place of the break: a hole would stop it there.
  const target = got.length > 1 ? got[0][1] - 2 : 28;
  await evaluate(page, `document.getElementById('video').currentTime = ${target.toFixed(1)}`);
  let t = 0;
  for (let i = 0; i < 12; i++) { await sleep(1000); t = (await videoState(page)).t; if (t > target + 8) break; }
  const ok = got.length === 1 && t > target + 8;
  return { ok, detail: `${got.length} buffered range(s)${holes.length ? ', hole at ' + holes.join(', ') : ''}; from ${target.toFixed(1)} s playback reached ${t} s in 12 s` };
}

/**
 * The favourites belong to the account. The same mock on two ports is two
 * accounts to the player: a favourite made under one is not shown under
 * the other, and is back on the way back. The account is switched through
 * storage and a reload, the way the driver connects in the first place —
 * the Connect button would ask for the host permission, and headless
 * Chrome has no prompt to answer it with.
 */
async function accounts(page, { target }) {
  const OTHER_PORT = MOCK_PORT + 1;
  const other = await startMockServer(OTHER_PORT);
  try {
    const favCount = async () => {
      await evaluate(page, `document.querySelector('#tabs [data-tab="fav"]').click()`);
      await sleep(500);
      return evaluate(page, `document.querySelectorAll('#list .row').length`);
    };
    const reconnectOn = async (port) => {
      await evaluate(page, `chrome.storage.local.get('config').then((got) => chrome.storage.local.set({ config: { ...got.config, port: ${JSON.stringify(String(port))} }, ui: { tab: 'live' } }))`);
      // Without the place in it: two addresses that differ only in their
      // fragment are one document to the browser, and the player would go
      // on running with the previous account's lists in memory.
      await page.call('Page.navigate', { url: bare(target.url) });
      await sleep(1000);
      try {
        await waitFor(page, CONNECTED, `the connection on port ${port}`);
      } catch (err) {
        const st = await evaluate(page, `(async () => ({ overlay: ${OVERLAY}, progress: !document.getElementById('list-progress').hidden, groups: document.querySelectorAll('#groups .group').length, keys: Object.keys(await chrome.storage.local.get(null)) }))()`);
        throw new Error(`${err.message}: ${JSON.stringify(st)}`);
      }
    };
    await evaluate(page, `document.querySelector('#tabs [data-tab="live"]').click()`);
    await waitFor(page, `document.querySelectorAll('#list .row').length > 0`, 'the channel rows');
    await evaluate(page, `document.querySelector('#list .row button').click()`);   // the star
    const first = await favCount();
    await reconnectOn(OTHER_PORT);
    const elsewhere = await favCount();
    await reconnectOn(MOCK_PORT);
    const back = await favCount();
    return { ok: first === 1 && elsewhere === 0 && back === 1, detail: `favourites: ${first} on port ${MOCK_PORT}, ${elsewhere} on port ${OTHER_PORT}, ${back} back on ${MOCK_PORT}` };
  } finally {
    other.closeAllConnections();
    await new Promise((resolve) => other.close(resolve));
  }
}

/**
 * A group that cannot be fetched while a channel plays: the message must
 * not cover the picture, and the sidebar must return to the group whose
 * rows are on screen.
 */
async function listerror(page) {
  await playFirstChannel(page);
  // Playing does not change the group, so this is the one the failed
  // switch below has to come back to.
  const before = await evaluate(page, ACTIVE_GROUP);
  process.env.KEPULI_MOCK_FAIL_LISTS = '1';
  try {
    await click(page, '#groups', 'Finland');
    await sleep(1500);
    const st = await evaluate(page, `({ overlay: ${OVERLAY}, playing: ${PLAYING}, active: ${ACTIVE_GROUP}, toast: document.getElementById('toast').hidden ? '' : document.getElementById('toast').textContent.trim() })`);
    const ok = !st.overlay && st.playing && st.active === before && /500/.test(st.toast);
    return { ok, detail: `overlay ${st.overlay ? '"' + st.overlay + '"' : 'hidden'}, ${st.playing ? 'still playing' : 'not playing'}, group "${before}" → "${st.active}", toast "${st.toast}"` };
  } finally {
    process.env.KEPULI_MOCK_FAIL_LISTS = '';
  }
}

/** What assistive technology is told: roles, names, the cursor, the tabs. */
async function a11y(page) {
  await openLiveList(page, 2);
  await evaluate(page, `document.getElementById('list').focus()`);
  await pressKey(page, 'ArrowDown', 'ArrowDown', 40);
  await sleep(300);
  const st = await evaluate(page, `(() => {
    const list = document.getElementById('list');
    const groups = document.getElementById('groups');
    const selected = list.querySelector('.row.selected');
    const tabs = [...document.querySelectorAll('#tabs [role="tab"]')];
    const iconButtons = [...document.querySelectorAll('button[data-i18n-title]')].filter((b) => !/\\p{L}/u.test(b.textContent));
    const rows = [...groups.children];
    const cursor = groups.querySelector('.group.cursor');
    return {
      listRole: list.getAttribute('role'), listName: list.getAttribute('aria-label'),
      pointsAtCursor: Boolean(selected) && list.getAttribute('aria-activedescendant') === selected.id && selected.getAttribute('role') === 'option' && selected.getAttribute('aria-selected') === 'true',
      cursorMark: selected ? getComputedStyle(selected).boxShadow !== 'none' : false,
      tablist: document.getElementById('tabs').getAttribute('role'),
      selectedTabs: tabs.filter((b) => b.getAttribute('aria-selected') === 'true').map((b) => b.dataset.tab),
      // A tab strip is one stop in the tab order, and its panel takes its name.
      tabStops: tabs.filter((b) => b.tabIndex === 0).map((b) => b.dataset.tab),
      panelNamedBy: document.getElementById('listcol').getAttribute('aria-labelledby'),
      toastRole: document.getElementById('toast').getAttribute('role'),
      unnamedIcons: iconButtons.filter((b) => !b.getAttribute('aria-label')).map((b) => b.id || b.className),
      // The sidebar is a listbox of options, not a list of tabbable items.
      groupsRole: groups.getAttribute('role'), groupsTabbable: groups.tabIndex === 0,
      optionRoles: [...new Set(rows.map((r) => r.getAttribute('role')))],
      rowsTabbable: rows.filter((r) => r.tabIndex >= 0).length,
      pointsAtGroup: Boolean(cursor) && groups.getAttribute('aria-activedescendant') === cursor.id,
      target: rows[2] ? rows[2].textContent.trim().replace(/\\s*\\d+$/, '') : null,
      at: rows.indexOf(cursor),
    }; })()`);
  // A sidebar group by keyboard: one Tab into the listbox, the arrows to the
  // row, Enter to choose it.
  await evaluate(page, `document.getElementById('groups').focus()`);
  for (let i = st.at; i < 2; i++) await pressKey(page, 'ArrowDown', 'ArrowDown', 40);
  for (let i = st.at; i > 2; i--) await pressKey(page, 'ArrowUp', 'ArrowUp', 38);
  await sleep(200);
  await pressKey(page, 'Enter', 'Enter', 13);
  await sleep(800);
  const chosen = await evaluate(page, ACTIVE_GROUP);
  const ok = st.listRole === 'listbox' && Boolean(st.listName) && st.pointsAtCursor && st.cursorMark
    && st.tablist === 'tablist' && st.selectedTabs.length === 1 && st.selectedTabs[0] === 'live'
    && st.tabStops.length === 1 && st.tabStops[0] === 'live' && st.panelNamedBy === 'tab-live'
    && st.toastRole === 'status' && st.unnamedIcons.length === 0
    && st.groupsRole === 'listbox' && st.groupsTabbable && st.optionRoles.join() === 'option'
    && st.rowsTabbable === 0 && st.pointsAtGroup && chosen === st.target;
  return { ok, detail: `list ${st.listRole}/${st.listName}, cursor ${st.pointsAtCursor ? 'announced' : 'not announced'} and ${st.cursorMark ? 'marked' : 'unmarked'}, tabs ${st.tablist} selected ${st.selectedTabs.join(',')} with ${st.tabStops.length} stop naming ${st.panelNamedBy}, sidebar ${st.groupsRole} of ${st.optionRoles.join('/')} with ${st.rowsTabbable} tabbable rows, toast ${st.toastRole}, unnamed icon buttons ${st.unnamedIcons.length}, group by keyboard: "${st.target}" → "${chosen}"` };
}

/** The control stays with the video and preserves the subtitle overlay. */
/**
 * A click on the picture pauses a film or an episode and plays it on, the
 * first click of a double click does not pause on its way to full screen,
 * a click on the control bar is left to the browser, and on a live channel
 * a click changes nothing — in Firefox too, whose own controls would
 * toggle playback on any click.
 */
/**
 * The drop-downs (js/picker.js): a press on a select opens the app's list
 * rather than the browser's, in a dialog as well, and what is chosen there
 * is what the select's own listeners hear.
 */
async function pickers(page) {
  const assert = (ok, detail) => { if (!ok) throw new Error(detail); };
  const pop = () => evaluate(page, `(() => { const p = document.querySelector('.picker-pop');
    return p ? { open: p.matches(':popover-open'), filter: !!p.querySelector('.picker-filter'), shown: [...p.querySelectorAll('.picker-option:not([hidden])')].map((li) => li.textContent),
      focus: document.activeElement === p.querySelector('.picker-filter') } : null; })()`);
  await evaluate(page, `document.querySelector('#tabs [data-tab="live"]').click()`);
  await waitFor(page, `document.querySelectorAll('#list .row').length > 0`, 'the channel rows');
  await evaluate(page, `document.getElementById('btn-settings').click()`);
  await waitFor(page, `document.getElementById('setup').open`, 'settings');
  await evaluate(page, `document.getElementById('tab-general').click()`);
  await sleep(300);
  const before = await evaluate(page, `document.getElementById('f-lang').value`);
  await mouseClick(page, '#f-lang');
  await sleep(300);
  const long = await pop();
  assert(long?.open && long.filter && long.focus && long.shown.length >= 13, `the language list: ${JSON.stringify(long)}`);
  await evaluate(page, `(() => { const f = document.querySelector('.picker-filter'); f.value = 'deut'; f.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(150);
  const narrowed = await pop();
  assert(narrowed.shown.length === 1 && narrowed.shown[0] === 'Deutsch', `the filter: ${JSON.stringify(narrowed.shown)}`);
  await pressKey(page, 'Escape', 'Escape', 27);
  await sleep(300);
  assert(!(await pop()) && await evaluate(page, `document.getElementById('setup').open && document.getElementById('f-lang').value === ${JSON.stringify(before)}`),
    'Escape closed more than the list, or changed the choice');
  await evaluate(page, `window.__picked = []; document.getElementById('f-channelsort').addEventListener('change', (e) => __picked.push(e.target.value), { once: true })`);
  await mouseClick(page, '#f-channelsort');
  await sleep(300);
  const short = await pop();
  assert(short?.open && !short.filter && short.shown.length === 3, `the order list: ${JSON.stringify(short)}`);
  await mouseClick(page, '.picker-option:nth-child(3)');
  await sleep(300);
  const picked = await evaluate(page, `({ value: document.getElementById('f-channelsort').value, heard: __picked, open: !!document.querySelector('.picker-pop') })`);
  assert(picked.value === 'num' && picked.heard[0] === 'num' && !picked.open, `the choice: ${JSON.stringify(picked)}`);
  // The options rebuilt while the list is open, as the media filters do
  // when a film's details arrive: the choice is made by its value, not
  // lost on an <option> that is no longer in the select.
  await evaluate(page, `window.__picked = []; document.getElementById('f-channelsort').addEventListener('change', (e) => __picked.push(e.target.value), { once: true })`);
  await mouseClick(page, '#f-channelsort');
  await sleep(300);
  await evaluate(page, `(() => { const s = document.getElementById('f-channelsort');
    s.replaceChildren(...[...s.options].map((o) => new Option(o.textContent, o.value, false, o.selected))); })()`);
  await mouseClick(page, '.picker-option:nth-child(2)');
  await sleep(300);
  const rebuilt = await evaluate(page, `({ value: document.getElementById('f-channelsort').value, heard: __picked, open: !!document.querySelector('.picker-pop') })`);
  assert(rebuilt.value === 'za' && rebuilt.heard[0] === 'za' && !rebuilt.open, `the choice after a rebuild: ${JSON.stringify(rebuilt)}`);
  // Cancel discards the draft: the choice above was never saved.
  await evaluate(page, `document.getElementById('f-done').click()`);
  await waitFor(page, `!document.getElementById('setup').open`, 'settings closed');
  return { ok: true, detail: `long list filtered to ${narrowed.shown[0]}; Escape kept the dialog; short list without a filter chose ${picked.value}, and ${rebuilt.value} with its options rebuilt under it` };
}

/**
 * The logo is the way back to the start: from a series page with a search
 * in it and the guide open, to the channels, the first country, the top
 * of the list, and the empty player's page — what was playing stopped, the
 * channel first under Watched lately; a film playing stopped too, its place
 * kept under Continue watching.
 */
async function home(page) {
  const assert = (ok, detail) => { if (!ok) throw new Error(detail); };
  await playFirstChannel(page);
  const playing = await evaluate(page, `document.getElementById('now-title')?.textContent || ''`);
  await evaluate(page, `document.querySelector('#tabs [data-tab="series"]').click()`);
  await click(page, '#groups', 'Nordic Noir');
  await click(page, '#list', 'Silent Fjord');
  await waitFor(page, `!document.getElementById('detail').hidden`, 'the series page');
  await evaluate(page, `document.getElementById('btn-guide').click()`);
  await sleep(300);
  await mouseClick(page, '#btn-home');
  await waitFor(page, `document.querySelector('#tabs [data-tab="live"]').getAttribute('aria-selected') === 'true' && document.getElementById('detail').hidden
    && !document.getElementById('main').classList.contains('guide') && document.getElementById('list').getAttribute('aria-busy') === 'false'`, 'the start');
  const at = await evaluate(page, `({ group: document.querySelector('#groups .group[aria-selected="true"] .group-name')?.textContent, query: document.getElementById('search').value,
    top: document.getElementById('list').scrollTop, playing: Boolean(document.getElementById('video').currentSrc && !document.getElementById('video').paused), title: document.getElementById('now-title')?.textContent || '',
    label: document.getElementById('btn-home').getAttribute('aria-label'), idle: !document.getElementById('idle-home').hidden,
    watched: [...document.querySelectorAll('.idle-channel:not([hidden]) .idle-name')].map((n) => n.textContent) })`);
  assert(at.group && !at.query && at.top === 0 && !at.playing && !at.title && at.idle && at.watched[0] === playing && at.label === 'Kepuli-TV, to the start page', `the start: ${JSON.stringify(at)}`);

  // A film playing — not paused — stops as well, its place kept among what
  // is left halfway.
  await evaluate(page, `chrome.storage.local.get('settings').then((got) => chrome.storage.local.set({ settings: { ...got.settings, resumeEnabled: true } }))`);
  await page.call('Page.reload');
  // The old page still answers for a moment, connected: the wait would be
  // over before the reload began.
  await sleep(1000);
  await waitFor(page, CONNECTED, 'the connection after the reload');
  await evaluate(page, `document.querySelector('#tabs [data-tab="movie"]').click()`);
  await click(page, '#groups', 'Nordic');
  await click(page, '#list', 'Northern Lights', { gesture: true });
  await waitFor(page, PLAYING, 'the film');
  await evaluate(page, `document.getElementById('video').currentTime = 45`);
  await sleep(1500);
  await mouseClick(page, '#btn-home');
  await waitFor(page, `!document.getElementById('overlay').hidden && !document.getElementById('idle-home').hidden`, 'the empty player\'s page');
  const idle = await evaluate(page, `({ title: document.getElementById('now-title').textContent, cards: [...document.querySelectorAll('.idle-card-wrap:not([hidden]) .idle-name')].map((n) => n.textContent),
    tab: document.querySelector('#tabs [aria-selected="true"]').dataset.tab, src: Boolean(document.getElementById('video').currentSrc && !document.getElementById('video').paused) })`);
  assert(!idle.title && idle.cards.some((c) => /Northern Lights/.test(c)) && idle.tab === 'live' && !idle.src, `the start without playback: ${JSON.stringify(idle)}`);
  // The ✕ on a card forgets where it was left, card by card; with none
  // left, the heading goes too.
  const cards = () => evaluate(page, `[...document.querySelectorAll('.idle-cards .idle-name')].map((n) => n.textContent)`);
  // With a mouse the ✕ waits for the hover; where the browser says there is
  // no hover (a touch screen, or headless Chrome on Linux) it always shows.
  const { shown, hover } = await evaluate(page, `(() => { const b = document.querySelector('.idle-forget');
    return { shown: b ? getComputedStyle(b).opacity : null, hover: matchMedia('(hover: hover)').matches }; })()`);
  assert(shown === (hover ? '0' : '1'), `the ✕ ${hover ? 'shows without hover' : 'is hidden where there is no hover'}: ${shown}`);
  const points = () => evaluate(page, `chrome.storage.local.get(null).then((d) => Object.entries(d).filter(([k]) => k.startsWith('resume')).reduce((n, [, v]) => n + Object.keys(v || {}).length, 0))`);
  const pointsBefore = await points();
  for (let left = (await cards()).length; left > 0; left--) {
    await evaluate(page, `document.querySelector('.idle-forget').click()`);
    await waitFor(page, `document.querySelectorAll('.idle-cards .idle-name').length === ${left - 1}`, 'the card taken off');
  }
  const after = { heading: await evaluate(page, `[...document.querySelectorAll('#idle-home h3')].map((h) => h.textContent)`), before: pointsBefore, points: await points() };
  assert(!after.heading.includes('Continue watching') && after.points <= after.before, `after taking every card off: ${JSON.stringify(after)}`);
  // Watched lately turned off in Settings goes from the page at once, and comes back on.
  const headings = () => evaluate(page, `[...document.querySelectorAll('#idle-home h3')].map((h) => h.textContent)`);
  assert((await headings()).includes('Watched lately'), 'no Watched lately to turn off');
  const toggleRecent = async () => {
    await evaluate(page, `document.getElementById('btn-settings').click()`);
    await waitFor(page, `document.getElementById('setup').open`, 'settings');
    await evaluate(page, `document.getElementById('tab-general').click()`);
    await evaluate(page, `document.getElementById('f-home-recent').click()`);
    await evaluate(page, `document.getElementById('f-save').click()`);
    await waitFor(page, `!document.getElementById('setup').open`, 'settings saved');
  };
  await toggleRecent();
  await waitFor(page, `![...document.querySelectorAll('#idle-home h3')].some((h) => h.textContent === 'Watched lately')`, 'Watched lately gone');
  await toggleRecent();
  await waitFor(page, `[...document.querySelectorAll('#idle-home h3')].some((h) => h.textContent === 'Watched lately')`, 'Watched lately back');
  // From the guide's column a tile is played where it lives: the guide gives way.
  await evaluate(page, `document.getElementById('btn-guide').click()`, { gesture: true });
  await waitFor(page, `document.querySelector('main').classList.contains('guide') && !document.getElementById('idle-home').hidden`, 'the guide over the empty player\'s page');
  await evaluate(page, `document.querySelector('.idle-channel').click()`, { gesture: true });
  await waitFor(page, `!document.querySelector('main').classList.contains('guide') && location.hash.startsWith('#/live') && ${PLAYING}`, 'the channel played in its list', 40000);
  await mouseClick(page, '#btn-home');
  return { ok: true, detail: `from a series page and the guide to the channels of ${at.group}, the top of the list and the empty player's page, ${playing} stopped and first under Watched lately; a playing film stopped, under Continue watching, and taken off it with the ✕ until the heading went; Watched lately off and on again from Settings; from the guide's column a channel played in its own list` };
}

/**
 * An episode — Matroska, unpacked into MediaSource — started again from
 * where it was left. The reading began at the right cluster, but nothing
 * moved the picture there: it stood at 0 in front of a buffer that began
 * at 48 s and said "Connecting…" for good.
 */
async function resumemkv(page) {
  await evaluate(page, `chrome.storage.local.get('settings').then((got) => chrome.storage.local.set({ settings: { ...got.settings, resumeEnabled: true } }))`);
  await page.call('Page.reload');
  // The old page still answers for a moment, connected: the wait would be
  // over before the reload began.
  await sleep(1000);
  await waitFor(page, CONNECTED, 'the connection after the reload');
  await playEpisode(page);
  await evaluate(page, `document.getElementById('video').currentTime = 45`);
  await sleep(7000);
  await evaluate(page, `document.getElementById('video').pause()`);
  await evaluate(page, `document.querySelectorAll('#list .row')[0].click()`, { gesture: true });
  await waitFor(page, `document.getElementById('video').currentTime > 40 && !document.getElementById('video').paused && document.getElementById('overlay').hidden`, 'the episode from its resume point');
  const t0 = await evaluate(page, `document.getElementById('video').currentTime`);
  await sleep(2000);
  const t1 = await evaluate(page, `document.getElementById('video').currentTime`);
  return { ok: t1 > t0 + 1, detail: `started again at ${t0.toFixed(1)} s and went on to ${t1.toFixed(1)} s` };
}

async function clickpause(page) {
  const paused = () => evaluate(page, `document.getElementById('video').paused`);
  const spot = (fromBottom = null) => evaluate(page, `(() => { const r = document.getElementById('video').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: ${fromBottom === null ? 'r.top + r.height * 0.4' : `r.bottom - ${fromBottom}`} }; })()`);
  const press = async ({ x, y }, count = 1, gap = 0) => {
    await page.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    for (let i = 1; i <= count; i++) {
      if (i > 1 && gap) await sleep(gap);
      await page.call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: i });
      await page.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: i });
    }
  };
  // A double click as a hand makes one in Chrome: some 150 ms between the
  // two, and the second press never ends in a click — full screen opens on
  // it and the release is lost (measured in the dev Chrome). Held here for
  // longer than the wait for a second click, so that a pause still waiting
  // for it would go off.
  const doubleClick = async (at) => {
    if (page.doubleClick) return page.doubleClick(at.x, at.y);
    await press(at, 1);
    await sleep(150);
    await page.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', clickCount: 2 });
    await sleep(400);
    await page.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', clickCount: 2 });
  };
  const seen = [];

  await playEpisode(page);
  const center = await spot();
  await press(center); await sleep(700);
  seen.push(`click ${await paused() ? 'paused' : 'played on'}`);
  const pausedByClick = await paused();
  await press(center); await sleep(700);
  seen.push(`again ${await paused() ? 'paused' : 'played on'}`);
  const resumedByClick = !(await paused());
  await doubleClick(center);
  // Firefox's own controls can take the double click and put the video
  // element itself in full screen, as the subtitles scenario allows too.
  await waitFor(page, `['videowrap', 'video'].includes(document.fullscreenElement?.id)`, 'full screen from a double click');
  await sleep(700);
  const doubleKeptPlaying = !(await paused());
  seen.push(`double click ${doubleKeptPlaying ? 'kept playing' : 'paused'} in full screen`);
  await evaluate(page, `document.exitFullscreen()`);
  await waitFor(page, `!document.fullscreenElement`, 'leaving full screen');
  if (await paused()) await evaluate(page, `document.getElementById('video').play()`, { gesture: true });
  // Within the control bar's strip the app does nothing: whatever happens
  // there is the browser's button, and an empty part of the bar stays as
  // it was.
  const bar = await spot(20);
  await press(bar); await sleep(700);
  const barLeftAlone = !(await paused());
  seen.push(`control bar ${barLeftAlone ? 'left alone' : 'paused'}`);

  await playFirstChannel(page);
  const live = await spot();
  await press(live); await sleep(700);
  const liveKeptPlaying = !(await paused());
  seen.push(`live click ${liveKeptPlaying ? 'kept playing' : 'paused'}`);

  // Firefox's own controls keep the clicks to themselves, live channels
  // included, and the page never sees them: there the click on a live
  // channel and on the bar are the browser's, and are only reported.
  const firefox = process.env.KEPULI_BROWSER === 'firefox';
  const ok = pausedByClick && resumedByClick && doubleKeptPlaying && (firefox || (barLeftAlone && liveKeptPlaying));
  return { ok, detail: seen.join(', ') };
}

async function fullscreenControl(page) {
  const assert = (ok, detail) => { if (!ok) throw new Error(detail); };
  const firefox = process.env.KEPULI_BROWSER === 'firefox';
  assert(!(await evaluate(page, `document.getElementById('btn-fullscreen')`)), 'the player still has a full screen button of its own');
  assert(!(await evaluate(page, `(document.getElementById('video').getAttribute('controlslist') || '').includes('nofullscreen')`)), 'the browser\'s full screen button is hidden');
  await playEpisode(page);
  await waitFor(page, `document.querySelectorAll('#subdisplay .cue').length > 0 || document.body.dataset.subrender === 'native'`, 'a subtitle cue');
  // The browser's own button takes the bare video, as a script asking the
  // video does: the browser draws the subtitles for the duration, at the
  // chosen height, and the layer stands empty.
  if (!firefox) {
    await evaluate(page, `document.getElementById('video').requestFullscreen()`, { gesture: true });
    await waitFor(page, `document.fullscreenElement?.id === 'video'`, 'the bare video full screen');
    await waitFor(page, `document.body.dataset.subrender === 'native'`, 'the browser drawing the subtitles');
    const native = await evaluate(page, `(() => { const v = document.getElementById('video');
      const shown = [...v.textTracks].find((t) => t.mode === 'showing');
      const cue = shown && shown.cues && shown.cues[0];
      return { layer: document.querySelectorAll('#subdisplay .cue').length, line: cue ? cue.line : null, snap: cue ? cue.snapToLines : null }; })()`);
    assert(native.layer === 0 && typeof native.line === 'number' && native.snap === false, `the bare video's subtitles: ${JSON.stringify(native)}`);
    await evaluate(page, `document.exitFullscreen()`);
    await waitFor(page, `!document.fullscreenElement && document.body.dataset.subrender === 'overlay'`, 'the layer back after full screen');
  }
  // A double click on the picture: the browser's controls take the bare
  // video by themselves, and a script may not ask without a gesture.
  const at = await evaluate(page, `(() => { const r = document.getElementById('video').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height * 0.4 }; })()`);
  if (page.doubleClick) await page.doubleClick(at.x, at.y);
  else {
    await page.call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at });
    for (let i = 1; i <= 2; i++) {
      await page.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...at, button: 'left', clickCount: i });
      await page.call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...at, button: 'left', clickCount: i });
    }
  }
  await waitFor(page, `['video', 'videowrap'].includes(document.fullscreenElement?.id)`, 'full screen from a double click');
  const subs = await evaluate(page, `document.fullscreenElement.id + ' ' + document.body.dataset.subrender`);
  // In Chrome the player takes the double click and gives the wrapper, as f.
  assert(subs === 'videowrap overlay' || (firefox && subs === 'video native'), `the subtitles in full screen: ${subs}`);
  await evaluate(page, `document.exitFullscreen()`);
  await waitFor(page, `!document.fullscreenElement`, 'out of full screen');
  // f takes the wrapper, the subtitle layer with it.
  let key = 'not tried';
  if (!firefox) {
    await pressKey(page, 'f', 'KeyF', 70);
    await waitFor(page, `document.fullscreenElement?.id === 'videowrap'`, 'full screen from f');
    key = await evaluate(page, `document.fullscreenElement.id + ' ' + document.body.dataset.subrender + ' ' + document.querySelectorAll('#subdisplay .cue').length`);
    assert(/^videowrap overlay [1-9]/.test(key), `f: ${key}`);
    await evaluate(page, `document.exitFullscreen()`);
    await waitFor(page, `!document.fullscreenElement`, 'out of full screen');
  }
  return { ok: true, detail: `no button of the player's own, the browser's shown; ${firefox ? '' : 'the browser\'s full screen draws the subtitles itself at the chosen height; '}a double click goes full screen with the subtitles (${subs}); f: ${key}` };
}

async function subtitles(page) {
  await playEpisode(page);
  await waitFor(page, `document.querySelectorAll('#subdisplay .cue').length > 0`, 'a cue in the layer');
  // One box per active cue, drawn by the layer while the track stays showing.
  const first = await evaluate(page, `(() => { const v = document.getElementById('video'); const shown = [...v.textTracks].filter((t) => t.mode === 'showing');
    return { render: document.body.dataset.subrender, showing: shown.length, active: shown[0] ? shown[0].activeCues.length : 0,
      boxes: document.querySelectorAll('#subdisplay .cue').length, meta: document.querySelector('#infostrip .playback-fact-subtitles dd').textContent }; })()`);
  if (first.render !== 'overlay' || first.showing !== 1 || !first.boxes || first.boxes !== first.active) return { ok: false, detail: `the layer: ${JSON.stringify(first)}` };
  if (!/^English, Finnish/.test(first.meta)) return { ok: false, detail: `the details say ${JSON.stringify(first.meta)}` };

  // The viewer's own choice from the selector, which nothing here used to
  // make: the track under the picture follows it, "No subtitles" empties
  // the layer, and neither leaves an error behind — a choice of track was
  // reported as taking the whole player down with it.
  await watchErrors(page);
  const finnish = await pickSubtitle(page, 'Finnish');
  if (!finnish) return { ok: false, detail: 'the selector offers no Finnish track' };
  await waitFor(page, `document.querySelectorAll('#subdisplay .cue').length > 0`, 'a cue from the chosen track');
  const chosen = await subtitleState(page);
  if (chosen.showing.length !== 1 || chosen.showing[0] !== finnish || chosen.picked === 'off') {
    return { ok: false, detail: `after choosing ${finnish}: ${JSON.stringify(chosen)}` };
  }
  await pickSubtitle(page, 'No subtitles');
  await waitFor(page, `document.querySelectorAll('#subdisplay .cue').length === 0`, 'the layer to empty');
  const off = await subtitleState(page);
  if (off.showing.length || off.picked !== 'off') return { ok: false, detail: `after switching off: ${JSON.stringify(off)}` };
  // Back on, so that the rest of the scenario has a track to work with.
  await pickSubtitle(page, 'English');
  await waitFor(page, `document.querySelectorAll('#subdisplay .cue').length > 0`, 'the cues to return');
  const broke = await errorsSeen(page);
  if (broke.length) return { ok: false, detail: `choosing a track threw: ${broke.join(' / ')}` };

  // A two-line cue is one box with the lines stacked inside it.
  const box = await evaluate(page, `(() => { const v = document.getElementById('video'); const tr = [...v.textTracks].find((t) => t.mode === 'showing');
    for (let i = tr.cues.length - 1; i >= 0; i--) tr.removeCue(tr.cues[i]);
    tr.addCue(new VTTCue(0, 100000, 'One line,\\nand another.'));
    return new Promise((r) => setTimeout(() => { const boxes = [...document.querySelectorAll('#subdisplay .cue')];
      const range = document.createRange(); range.selectNodeContents(boxes[0]);
      r({ boxes: boxes.length, lines: new Set([...range.getClientRects()].map((x) => Math.round(x.top))).size }); }, 500)); })()`);
  if (box.boxes !== 1 || box.lines !== 2) return { ok: false, detail: `a two-line cue: ${JSON.stringify(box)}` };
  // A double click takes the picture to full screen with its subtitles.
  const at = await evaluate(page, `(() => { const r = document.getElementById('video').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  if (page.doubleClick) await page.doubleClick(at.x, at.y);
  else for (const clickCount of [1, 2]) {
    await page.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: at.x, y: at.y, button: 'left', clickCount });
    await page.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at.x, y: at.y, button: 'left', clickCount });
  }
  await sleep(1000);
  const full = await evaluate(page, `(() => ({ element: document.fullscreenElement && document.fullscreenElement.id,
    boxes: document.querySelectorAll('#subdisplay .cue').length, render: document.body.dataset.subrender,
    nativeCues: [...document.getElementById('video').textTracks].filter(t => t.mode === 'showing').reduce((n,t) => n + (t.activeCues?.length || 0), 0),
    // The browser's drawing holds the viewer's height only if it is in the
    // cue: the line is where the layer would put the lowest line.
    lines: [...document.getElementById('video').textTracks].filter(t => t.mode === 'showing').flatMap(t => [...(t.activeCues || [])]).map(c => [c.snapToLines, c.lineAlign, c.line]),
    expected: (() => { const v = document.getElementById('video'), h = v.clientHeight, pic = Math.min(h, v.clientWidth * v.videoHeight / v.videoWidth);
      const lift = parseFloat(getComputedStyle(document.body).getPropertyValue('--sub-lift'));
      return Math.round((100 - ((h - pic) / 2 + pic * lift) / h * 100) * 10) / 10; })() }))()`);
  await evaluate(page, `document.fullscreenElement && document.exitFullscreen()`);
  await sleep(600);
  const wrapper = full.element === 'videowrap' && full.boxes === 1 && full.render === 'overlay';
  // The browser's controls own the double click and take the bare video:
  // its own text track must then draw the cue, at the viewer's height; the
  // layer returns on exit.
  const native = full.element === 'video'
    && full.render === 'native' && full.nativeCues > 0
    && full.lines.every(([snap, align, line]) => snap === false && align === 'end' && Math.abs(line - full.expected) < 0.2);
  if (!wrapper && !native) return { ok: false, detail: `full screen: ${JSON.stringify(full)}` };
  if (!await evaluate(page, `document.body.dataset.subrender === 'overlay' && document.querySelectorAll('#subdisplay .cue').length === 1`)) {
    return { ok: false, detail: 'subtitle overlay did not return after full screen' };
  }
  // The choice is a language, and the next episode opens on it: the track
  // numbers are the file's own and say nothing about the one after it.
  await pickSubtitle(page, 'Finnish');
  await sleep(500);
  await playEpisode(page, 2);
  await waitFor(page, `document.querySelectorAll('#subdisplay .cue').length > 0`, 'a cue in the next episode');
  const remembered = await subtitleState(page);
  if (!remembered.showing[0] || !remembered.showing[0].startsWith('Finnish')) {
    return { ok: false, detail: `the next episode opened on ${JSON.stringify(remembered)}` };
  }

  // A file with no subtitles: the details below the player say so.
  await evaluate(page, `document.querySelector('#tabs [data-tab="movie"]').click()`);
  await waitFor(page, `document.querySelectorAll('#groups .group').length > 1`, 'the movie groups');
  await evaluate(page, `document.querySelectorAll('#groups .group')[1].click()`);
  await click(page, '#list', 'Crossfire Alley', { gesture: true });
  await waitFor(page, PLAYING, 'the movie');
  await waitFor(page, `/No subtitles/.test((document.querySelector('#infostrip .playback-fact-subtitles dd') || {}).textContent || '')`, 'the details of the movie', 10000);
  return { ok: true, detail: `one box for ${first.active} cue, two lines in one box, the selector switches track and off without a word of complaint, full screen on ${full.element} with ${full.render} subtitles, ${remembered.showing[0]} remembered for the next episode, the movie says "No subtitles"` };
}

// The loudest tone the video element plays, measured through an
// AnalyserNode rather than assumed from the route the player chose.
const TONE = `(() => {
  const v = document.getElementById('video');
  if (!window.__tone) {
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 8192;
    // The element has to stay connected to the destination as well, or
    // it falls silent the moment Web Audio takes its output.
    ctx.createMediaElementSource(v).connect(analyser);
    analyser.connect(ctx.destination);
    window.__tone = { ctx, analyser, data: new Float32Array(analyser.frequencyBinCount) };
  }
  const { ctx, analyser, data } = window.__tone;
  return ctx.resume().then(() => new Promise((done) => setTimeout(() => {
    analyser.getFloatFrequencyData(data);
    let peak = 1;
    for (let i = 2; i < data.length; i++) if (data[i] > data[peak]) peak = i;
    done({ hz: Math.round((peak * ctx.sampleRate) / analyser.fftSize), db: Math.round(data[peak]) });
  }, 1200)));
})()`;

/**
 * Which audio track is heard. The demo episode's three tracks each carry a
 * tone of their own — English 440 Hz, Finnish 660 Hz, the English AC-3
 * commentary 880 Hz — so the choice can be measured rather than assumed:
 * the element's own output goes through an AnalyserNode and the loudest
 * bin says which track is playing.
 *
 * The automatic choice must take the English AAC: it is the file's default
 * and it goes through untouched. Asking for Finnish must move it to the
 * Finnish track, and the commentary must not be picked either way.
 */
async function audio(page, { requests, target }) {

  const heard = async (index) => {
    await playEpisode(page, index);
    const tone = await evaluate(page, TONE);
    return tone;
  };

  const auto = await heard(2);
  const played = requests.filter((url) => /\/series\/.*\.mkv$/.test(url)).pop() || '';
  const id = played.slice(played.lastIndexOf('/') + 1, -4);
  if (!MULTI_EPISODES.has(id)) return { ok: false, detail: `the third row is episode ${id}, which is not the three-track one` };
  if (Math.abs(auto.hz - 440) > 12) return { ok: false, detail: `the automatic choice sounds at ${auto.hz} Hz (${auto.db} dB), expected the English track's 440 Hz` };

  // The selector offers all three, with the English one chosen.
  const menu = await evaluate(page, `(() => { const s = document.getElementById('audio');
    return { hidden: s.hidden, options: [...s.options].map((o) => o.textContent), value: s.value }; })()`);
  if (menu.hidden || menu.options.length !== 3) return { ok: false, detail: `the selector: ${JSON.stringify(menu)}` };
  // A third selector on a row that was already full: every button has to
  // stay on screen, at the narrowest width the layout is drawn for as well.
  for (const width of [1024, 1280, 1512]) {
    await page.call('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false });
    await sleep(300);
    const row = await evaluate(page, `(() => { const acts = document.querySelector('.now-actions');
      const edge = acts.closest('section').getBoundingClientRect().right;
      return { cutOff: Math.round(Math.max(...[...acts.children].filter((c) => !c.hidden).map((c) => c.getBoundingClientRect().right)) - edge),
        buttons: acts.querySelectorAll('button').length }; })()`);
    if (row.cutOff > 0) { await page.call('Emulation.clearDeviceMetricsOverride'); return { ok: false, detail: `at ${width} px the player's row runs ${row.cutOff} px past its column` }; }
  }
  await page.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await sleep(300);
  if (!/^English \(AAC/.test(menu.options[0]) || !/^Finnish \(AAC/.test(menu.options[1]) || !/Commentary/.test(menu.options[2])) {
    return { ok: false, detail: `the selector names them ${JSON.stringify(menu.options)}` };
  }

  // The change mid-playback: the picture must not go back to buffering,
  // and the sound must come back as the other track.
  const before = await videoState(page);
  await evaluate(page, `(() => { const s = document.getElementById('audio');
    s.value = [...s.options].find((o) => /Finnish/.test(o.textContent)).value;
    s.dispatchEvent(new Event('change')); return true; })()`, { gesture: true });
  const switched = await evaluate(page, TONE);
  const after = await videoState(page);
  if (Math.abs(switched.hz - 660) > 12) return { ok: false, detail: `after the change it sounds at ${switched.hz} Hz (${switched.db} dB), expected 660 Hz` };
  if (after.paused || after.t <= before.t) return { ok: false, detail: `the picture stopped at ${after.t} s (it was at ${before.t} s)` };
  // The commentary is AC-3: choosing it takes the decoded route, decoder
  // and encoder and all, which is the switch that changes the buffer's
  // format rather than only its contents.
  await evaluate(page, `(() => { const s = document.getElementById('audio');
    s.value = [...s.options].find((o) => /Commentary/.test(o.textContent)).value;
    s.dispatchEvent(new Event('change')); return true; })()`, { gesture: true });
  const commentary = await evaluate(page, TONE);
  if (Math.abs(commentary.hz - 880) > 12) return { ok: false, detail: `the commentary sounds at ${commentary.hz} Hz (${commentary.db} dB), expected 880 Hz` };

  // The remembered language, as the settings hold it between episodes.
  await evaluate(page, `chrome.storage.local.set({ settings: { lang: 'en', epgEnabled: true, resumeEnabled: false, subtitleLang: 'eng', audioLang: 'fi' } })`);
  await page.call('Page.navigate', { url: bare(target.url) });
  await sleep(1000);
  await waitFor(page, CONNECTED, 'the connection after the reload');
  const finnish = await heard(2);
  if (Math.abs(finnish.hz - 660) > 12) return { ok: false, detail: `with Finnish asked for it sounds at ${finnish.hz} Hz (${finnish.db} dB), expected the Finnish track's 660 Hz` };
  return { ok: true, detail: `episode ${id}: automatic ${auto.hz} Hz, switched to Finnish ${switched.hz} Hz with the picture running from ${before.t} to ${after.t} s, to the AC-3 commentary ${commentary.hz} Hz, audioLang fi opens at ${finnish.hz} Hz, and the row fits at 1024-1512 px` };
}

/** Drafts across tabs, cancellation, explicit save and the live Aa control. */
async function settings(page, { requests, target }) {
  const buttons = `[...document.querySelectorAll('#setup > form > .setup-actions button')].filter((b) => !b.hidden).map((b) => b.textContent.trim())`;
  const change = (id, value, checkbox = false) => evaluate(page, `(() => { const c = document.getElementById('${id}'); c.${checkbox ? 'checked' : 'value'} = ${JSON.stringify(value)}; c.dispatchEvent(new Event('input', { bubbles: true })); c.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  const open = () => evaluate(page, `document.getElementById('btn-settings').click()`, { gesture: true });
  const tab = (name) => evaluate(page, `document.querySelector('#setup-tabs [data-panel="${name}"]').click()`);
  const press = (id) => evaluate(page, `document.getElementById('${id}').click()`, { gesture: true });
  const assert = (ok, detail) => { if (!ok) throw new Error(detail); };
  const saved = () => evaluate(page, `chrome.storage.local.get(['settings', 'config'])`);
  const initial = await saved();
  const from = requests.length;
  await open();
  await waitFor(page, `document.getElementById('setup').open`, 'the settings dialog', 5000);
  const opened = await evaluate(page, `({ focus: document.activeElement.id, buttons: ${buttons}, disabled: document.getElementById('f-save').disabled,
    section: document.querySelector('#setup-tabs .active').dataset.panel })`);
  assert(opened.section === 'connection' && opened.focus === 'f-host' && opened.buttons.join() === 'Cancel,Save' && opened.disabled, `opened as ${JSON.stringify(opened)}`);
  await tab('general');
  await change('f-epg', false, true);
  await change('f-lang', 'fi');
  await tab('subs');
  await change('f-subsize', '150');
  await change('f-substyle', 'yellow');
  await press('f-close');
  assert(await evaluate(page, `document.getElementById('setup').open && !document.getElementById('setup-discard').hidden`), 'X discarded unsaved settings without confirmation');
  await press('f-keep');
  assert(JSON.stringify(await saved()) === JSON.stringify(initial), 'draft wrote to storage');
  assert(await evaluate(page, `document.documentElement.lang === 'en' && document.body.dataset.substyle === 'shadow' && document.querySelector('#panel-subs .sublook').dataset.substyle === 'yellow'`), 'draft changed runtime or failed to preview');
  await press('f-done');
  await open();
  assert(await evaluate(page, `document.getElementById('f-epg').checked && document.getElementById('f-lang').value === 'en' && document.getElementById('f-subsize').value === '100'`), 'Cancel retained a draft');
  await tab('general');
  await change('f-epg', false, true);
  await tab('subs');
  await change('f-subsize', '150');
  // A failed write must keep the dialog and draft without persisting either key.
  await evaluate(page, `window.originalSettingsSet = chrome.storage.local.set; chrome.storage.local.set = async () => { throw new Error('simulated write failure'); };`);
  await press('f-save');
  await waitFor(page, `!document.getElementById('setup-error').hidden && !document.getElementById('f-save').disabled`, 'save failure');
  assert(JSON.stringify(await saved()) === JSON.stringify(initial), 'failed save changed storage');
  await evaluate(page, `chrome.storage.local.set = window.originalSettingsSet; delete window.originalSettingsSet;`);
  await press('f-save');
  await waitFor(page, `!document.getElementById('setup').open`, 'saved settings');
  const committed = await saved();
  assert(committed.settings.epgEnabled === false && committed.settings.subtitleScale === 150, 'Save did not commit all tabs');
  const calls = requests.slice(from).filter((u) => u.includes('player_api.php')).length;
  assert(calls === 0, `preference save made ${calls} API calls`);
  await open();
  await tab('general');
  await change('f-lang', 'fi');
  await press('f-save');
  await waitFor(page, `document.documentElement.lang === 'fi'`, 'saved Finnish language');
  await open();
  await tab('general');
  await change('f-lang', 'en');
  await press('f-save');
  await waitFor(page, `document.documentElement.lang === 'en'`, 'restored English language');
  await open();
  await tab('general');
  await change('f-resume', true, true);

  // The size slider is dragged; letting go outside the dialog must not be
  // read as a click on the backdrop.
  await evaluate(page, `document.querySelector('#setup-tabs [data-panel="subs"]').click()`);
  await sleep(300);
  const at = await evaluate(page, `(() => { const r = document.getElementById('f-subsize').getBoundingClientRect(), d = document.querySelector('.setup').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), outX: Math.round(Math.min(d.right + 60, innerWidth - 4)), outY: Math.round(Math.min(d.bottom + 40, innerHeight - 4)) }; })()`);
  const mouse = (type, x, y) => page.call('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  await mouse('mousePressed', at.x, at.y);
  await mouse('mouseMoved', at.outX, at.outY);
  await mouse('mouseReleased', at.outX, at.outY);
  await sleep(300);
  if (!(await evaluate(page, `document.getElementById('setup').open`))) return { ok: false, detail: 'a slider drag released outside closed the dialog' };

  // A backdrop click asks before discarding changes; keep editing retains them.
  await mouse('mousePressed', at.outX, at.outY);
  await mouse('mouseReleased', at.outX, at.outY);
  await sleep(300);
  assert(await evaluate(page, `document.getElementById('setup').open && !document.getElementById('setup-discard').hidden`), 'dirty backdrop did not ask before discarding');
  await press('f-keep');
  assert(await evaluate(page, `document.getElementById('f-resume').checked`), 'keep editing lost the draft');
  await pressKey(page, 'Escape', 'Escape', 27);
  await waitFor(page, `!document.getElementById('setup-discard').hidden`, 'Escape draft guard', 3000);
  await press('f-discard');
  assert(!(await saved()).settings.resumeEnabled, 'discard saved a change');
  await open();
  await press('f-close');
  assert(await evaluate(page, `!document.getElementById('setup').open`), 'clean close stayed open');

  // Existing M3U credentials do not require pasting the URL to save preferences.
  await evaluate(page, `chrome.storage.local.get('config').then(({ config }) => chrome.storage.local.set({ config: { ...config, sourceMode: 'm3u' } }))`);
  await page.call('Page.navigate', { url: bare(target.url) });
  await waitFor(page, CONNECTED, 'M3U connection');
  await open();
  assert(await evaluate(page, `document.activeElement.id === 'f-paste'`), 'M3U focused a hidden field');
  await tab('general');
  await change('f-resume', true, true);
  await press('f-save');
  await waitFor(page, `!document.getElementById('setup').open`, 'M3U preferences saved without URL');
  await open();
  await change('f-paste', 'invalid');
  await tab('subs');
  await press('f-save');
  assert(await evaluate(page, `!document.getElementById('setup-error').hidden && document.activeElement.id === 'f-paste'`), 'invalid M3U did not focus its error');
  await press('f-done');

  // Saving from another tab commits credentials too; denied permission
  // must commit neither credentials nor preferences.
  await open();
  const beforeConnection = await saved();
  await change('f-paste', `http://127.0.0.1:${MOCK_PORT}/get.php?username=demo&password=changed`);
  await tab('general');
  await change('f-epg', true, true);
  await evaluate(page, `window.originalSettingsPermission = chrome.permissions.request; chrome.permissions.request = async () => false;`);
  await press('f-save');
  await waitFor(page, `!document.getElementById('setup-error').hidden && !document.getElementById('f-save').disabled`, 'permission denial');
  assert(JSON.stringify(await saved()) === JSON.stringify(beforeConnection), 'denied permission committed settings');
  // The isolated headless profile cannot answer Chrome's permission prompt.
  await evaluate(page, `chrome.permissions.request = async () => true;`);
  const reconnectFrom = requests.length;
  await press('f-save');
  await waitFor(page, `!document.getElementById('setup').open`, 'saved connection');
  await waitFor(page, `!document.querySelector('#setup form').inert`, 'connection attempt completed');
  const afterConnection = await saved();
  assert(afterConnection.config.password === 'changed' && afterConnection.settings.epgEnabled, 'Save did not commit connection and preferences together');
  assert(requests.slice(reconnectFrom).some((url) => url.includes('password=changed')), 'changed connection did not reconnect');
  await open();
  await change('f-paste', `http://127.0.0.1:${MOCK_PORT}/get.php?username=demo&password=demo`);
  await press('f-save');
  await waitFor(page, CONNECTED, 'reconnected with corrected credentials');
  await evaluate(page, `chrome.permissions.request = window.originalSettingsPermission; delete window.originalSettingsPermission;`);

  // The look over the picture: the same setting, judged against the real
  // subtitles, which the popover must not cover.
  await playEpisode(page);
  await waitFor(page, `!document.getElementById('btn-sublook').hidden`, 'the Aa button', 10000);
  await evaluate(page, `document.getElementById('btn-sublook').click()`, { gesture: true });
  await evaluate(page, `(() => { const r = document.getElementById('p-subsize'); r.value = '140'; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); })()`);
  await waitFor(page, `document.querySelectorAll('#subdisplay .cue').length > 0`, 'a cue on screen');
  await sleep(400);
  const look = await evaluate(page, `(() => { const pop = document.getElementById('sublook-pop').getBoundingClientRect();
    const cues = [...document.querySelectorAll('#subdisplay .cue')].map((c) => c.getBoundingClientRect());
    return { size: getComputedStyle(document.body).getPropertyValue('--sub-scale').trim(),
      mirror: document.getElementById('f-subsize').value,
      covered: cues.filter((c) => c.bottom > pop.top && c.right > pop.left && c.left < pop.right).length, cues: cues.length }; })()`);
  const savedSize = await evaluate(page, `chrome.storage.local.get('settings').then((d) => d.settings.subtitleScale)`);
  if (look.size !== '1.4' || savedSize !== 140 || look.mirror !== '140') return { ok: false, detail: `the popover left ${JSON.stringify(look)}, stored ${savedSize}` };
  if (!look.cues || look.covered) return { ok: false, detail: `the popover covers ${look.covered} of ${look.cues} cue(s)` };

  // Without credentials the dialog is not settings at all: there is nothing
  // to set until there is something to connect to.
  await evaluate(page, `chrome.storage.local.remove('config')`);
  await page.call('Page.navigate', { url: bare(target.url) });
  await sleep(1200);
  await waitFor(page, `document.getElementById('setup').open`, 'the first-run dialog', 10000);
  const first = await evaluate(page, `({ rail: getComputedStyle(document.getElementById('setup-tabs')).display,
    title: document.getElementById('setup-title').textContent.trim(), buttons: ${buttons} })`);
  if (first.rail !== 'none' || first.buttons.join() !== 'Cancel,Connect') return { ok: false, detail: `the first run showed ${JSON.stringify(first)}` };
  return { ok: true, detail: `Connection first; drafts and cancel across tabs; failed write and retry; explicit save with ${calls} preference API calls; saved language; guarded backdrop/Escape; M3U preference save and validation; live Aa control and first run` };
}


/** Personal presentation survives reload, cancels cleanly and can be restored. */
async function channels(page) {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  await openLiveList(page, 3);
  const names = () => evaluate(page, `[...document.querySelectorAll('#list .row-name')].map((n) => n.title)`);

  // Where the list starts is a setting; the arrangement made below then has
  // the last word over it.
  const setSort = async (value) => {
    await evaluate(page, `document.getElementById('btn-settings').click()`, { gesture: true });
    await waitFor(page, `document.getElementById('setup').open`, 'the settings dialog');
    await evaluate(page, `document.querySelector('#setup-tabs [data-panel="general"]').click()`);
    await evaluate(page, `(() => { const c = document.getElementById('f-channelsort'); c.value = ${JSON.stringify(value)};
      c.dispatchEvent(new Event('input', { bubbles: true })); c.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await evaluate(page, `document.getElementById('f-save').click()`, { gesture: true });
    await waitFor(page, `!document.getElementById('setup').open`, `the saved channel order (${value})`);
  };
  // The list paints only what is on screen, so it is judged by its two ends.
  const ends = async () => {
    await evaluate(page, `document.getElementById('list').scrollTop = 0`);
    await sleep(250);
    const first = (await names())[0];
    await evaluate(page, `document.getElementById('list').scrollTop = 1e7`);
    await sleep(250);
    const last = (await names()).at(-1);
    await evaluate(page, `document.getElementById('list').scrollTop = 0`);
    await sleep(250);
    return { first, last };
  };
  const az = await ends();
  await setSort('za');
  const za = await ends();
  assert(za.first === az.last && za.last === az.first, `Z-A did not mirror A-Z: ${JSON.stringify(az)} then ${JSON.stringify(za)}`);
  await setSort('num');
  const num = await ends();
  assert(num.first && num.first !== az.first && num.first !== za.first, `the channel number gave an alphabetical order: ${JSON.stringify(num)}`);
  await setSort('az');
  assert(JSON.stringify(await ends()) === JSON.stringify(az), 'the alphabetical order did not come back');

  // A channel's own menu, from a right click: a favourite or not, and
  // hide with Undo in the message.
  const menu = async (index) => {
    await evaluate(page, `document.getElementById('list').scrollTop = 0`);
    await sleep(200);
    await evaluate(page, `document.querySelectorAll('#list .row')[${index}].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 400, clientY: 300 }))`);
    await waitFor(page, `document.querySelector('.row-menu:popover-open')`, 'the row menu');
    return evaluate(page, `[...document.querySelectorAll('.row-menu .popitem')].map((b) => b.textContent)`);
  };
  const choose = async (label) => {
    await evaluate(page, `[...document.querySelectorAll('.row-menu .popitem')].find((b) => b.textContent === ${JSON.stringify(label)}).click()`);
    await waitFor(page, `!document.querySelector('.row-menu') && document.getElementById('list').getAttribute('aria-busy') === 'false'`, `the list after ${label}`);
    await sleep(200);
  };
  const before = await names();
  const home = await evaluate(page, `document.querySelector('#groups .group[aria-selected="true"] .group-name')?.textContent`);
  const items = await menu(2);
  assert(JSON.stringify(items) === JSON.stringify(['Add to favourites', 'Hide channel']), `the menu of a channel: ${JSON.stringify(items)}`);
  await choose('Add to favourites');
  await menu(4);
  await choose('Add to favourites');
  // The favourites stay in their places in the list, and gather folded above it.
  // The list paints what fits, and the folded favourites take a row of its height.
  const after = await names();
  assert(after.length > 4 && JSON.stringify(after) === JSON.stringify(before.slice(0, after.length)), `a favourite moved in the list: ${JSON.stringify({ before, after })}`);
  const strip = () => evaluate(page, `({ shown: !document.getElementById('fav-strip').hidden, label: document.getElementById('fav-strip-count').textContent,
    open: document.getElementById('fav-strip-toggle').getAttribute('aria-expanded'), tiles: [...document.querySelectorAll('#fav-strip-items .fav-tile')].map((b) => b.title) })`);
  let favs = await strip();
  assert(favs.shown && favs.label === '2' && favs.open === 'false' && !favs.tiles.length, `the folded favourites: ${JSON.stringify(favs)}`);
  await mouseClick(page, '#fav-strip-toggle');
  await sleep(200);
  favs = await strip();
  assert(favs.open === 'true' && JSON.stringify(favs.tiles) === JSON.stringify([before[2], before[4]]), `the open favourites: ${JSON.stringify(favs)}`);
  assert(JSON.stringify(await menu(2)) === JSON.stringify(['Remove from favourites', 'Hide channel']), 'the menu of a favourite');
  await evaluate(page, `document.querySelector('.row-menu .popitem').click()`);
  await sleep(300);
  favs = await strip();
  assert(favs.label === '1' && JSON.stringify(favs.tiles) === JSON.stringify([before[4]]), `a favourite taken off: ${JSON.stringify(favs)}`);
  await mouseClick(page, '#fav-strip-items .fav-tile');
  await waitFor(page, `document.getElementById('now-title').textContent && !document.getElementById('video').paused || document.getElementById('overlay').classList.contains('loading')`, 'the favourite playing');

  // The keyboard: Shift+F10 on the row the list stands on, Escape back.
  await evaluate(page, `document.getElementById('list').focus()`);
  // WebDriver has no F10 to press; Firefox gets the key as the page would.
  if (process.env.KEPULI_BROWSER === 'firefox') await evaluate(page, `document.getElementById('list').dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true }))`);
  else await pressKey(page, 'F10', 'F10', 121, 8);
  await waitFor(page, `document.querySelector('.row-menu:popover-open') && document.activeElement.classList.contains('popitem')`, 'the menu from the keyboard');
  await pressKey(page, 'Escape', 'Escape', 27);
  await waitFor(page, `!document.querySelector('.row-menu') && document.activeElement.id === 'list'`, 'Escape back to the list');

  // Hide, Undo, hide again, and back from Hidden.
  const hide = (await names())[3];
  await menu(3);
  await choose('Hide channel');
  assert(!(await names()).includes(hide), 'the hidden channel is still listed');
  await evaluate(page, `document.querySelector('#toast .toast-action').click()`);
  await waitFor(page, `[...document.querySelectorAll('#list .row-name')].some((n) => n.title === ${JSON.stringify(hide)})`, 'Undo bringing the channel back');
  await menu(3);
  await choose('Hide channel');
  assert(await evaluate(page, `document.getElementById('btn-hidden')?.textContent === 'Hidden (1)'`), 'no Hidden (1) under the list');
  await evaluate(page, `document.getElementById('btn-hidden').click()`);
  await waitFor(page, `document.getElementById('hidden').open && document.querySelectorAll('#hidden-list .choice-row').length === 1`, 'the Hidden dialog');
  await checkModal(page, '#hidden', 'hidden');
  await evaluate(page, `document.querySelector('#hidden-list .choice-row button').click()`);
  await waitFor(page, `!document.getElementById('hidden').open && !document.getElementById('btn-hidden')`, 'Show again closing an emptied Hidden');
  assert((await names()).includes(hide), 'Show again did not bring the channel back');

  // The countries: one chosen, the rest out of the sidebar; all again.
  const groupsShown = () => evaluate(page, `[...document.querySelectorAll('#groups .group-name')].map((n) => n.textContent)`);
  const allGroups = await groupsShown();
  await evaluate(page, `document.getElementById('btn-countries').click()`);
  await waitFor(page, `document.getElementById('countries').open`, 'the countries dialog');
  await checkModal(page, '#countries', 'countries');
  await evaluate(page, `(() => { const f = document.getElementById('countries-filter'); f.value = 'swe'; f.dispatchEvent(new Event('input')); })()`);
  const filtered = await evaluate(page, `[...document.querySelectorAll('#countries-list .choice-row:not([hidden]) .choice-name')].map((n) => n.textContent)`);
  assert(JSON.stringify(filtered) === '["Sweden"]', `the filter: ${JSON.stringify(filtered)}`);
  await evaluate(page, `document.querySelector('#countries-list .choice-row:not([hidden]) input').click(); document.getElementById('countries-save').click()`);
  await waitFor(page, `!document.getElementById('countries').open`, 'the countries saved');
  await sleep(300);
  const chosen = await groupsShown();
  assert(chosen.includes('Sweden') && !chosen.includes('Finland') && chosen.length < allGroups.length, `the sidebar after choosing Sweden: ${JSON.stringify(chosen)}`);
  assert(await evaluate(page, `(() => { const text = document.getElementById('btn-countries-text').textContent; return text.startsWith('1/') && text.endsWith(' countries chosen'); })()`), 'the button does not say what is chosen');
  await evaluate(page, `document.getElementById('btn-countries').click()`);
  await waitFor(page, `document.getElementById('countries').open`, 'the countries dialog again');
  // Select all ticks every country, which is all of them again.
  await evaluate(page, `document.getElementById('countries-toggle').click(); if (!document.getElementById('countries-toggle').checked) document.getElementById('countries-toggle').click(); document.getElementById('countries-save').click()`);
  await waitFor(page, `!document.getElementById('countries').open`, 'all countries saved');
  await sleep(300);
  assert(JSON.stringify(await groupsShown()) === JSON.stringify(allGroups), 'Show all did not bring every country back');

  // The favourites, open, outlast a reload.
  await page.call('Page.reload');
  await waitFor(page, CONNECTED, 'the connection after the reload');
  await openLiveList(page, 3);
  await evaluate(page, `[...document.querySelectorAll('#groups .group')].find((g) => g.querySelector('.group-name')?.textContent === ${JSON.stringify(home)})?.click()`);
  await sleep(500);
  favs = await strip();
  assert(favs.open === 'true' && JSON.stringify(favs.tiles) === JSON.stringify([before[4]]), `the favourites after a reload: ${JSON.stringify(favs)}`);
  return { ok: true, detail: 'channel order from Settings (A-Z, Z-A, number); favourites from the menu, folded above the list and in their places in it; the menu from a right click and Shift+F10; hide with Undo, Hidden and Show again; countries chosen and all again; the open favourites kept over a reload' };
}

/**
 * Where the viewer was is where the player opens again, by two routes that
 * answer different questions.
 *
 * The address names this tab's place — the tab, the group, the topic and
 * the series drilled into — and is written as each list settles, so a
 * refresh comes back into it with the stored view deleted underneath.
 * The stored view names the place any tab last settled on, and it is what
 * the toolbar icon opens on once the tab itself has been closed.
 *
 * What the account no longer offers is dropped by either route rather than
 * restored onto an empty list, and a search is a detour rather than a
 * place: neither brings one back.
 */
async function restore(page, { target }) {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const active = () => evaluate(page, ACTIVE_GROUP);
  const topic = () => evaluate(page, `((document.querySelector('#subcats .chip.active .chip-main') || {}).textContent || '').trim().replace(/\\s*\\d+$/, '')`);
  const rows = () => evaluate(page, `document.querySelectorAll('#list .row').length`);
  const tab = () => evaluate(page, `document.querySelector('#tabs [aria-selected="true"]').dataset.tab`);
  const stored = () => evaluate(page, `(async () => (await chrome.storage.local.get('ui')).ui)()`);
  const store = (patch) => evaluate(page, `(async () => {
    const { ui } = await chrome.storage.local.get('ui');
    await chrome.storage.local.set({ ui: { ...ui, ...${JSON.stringify(patch)} } });
  })()`);
  const settled = async (what) => {
    await waitFor(page, CONNECTED, `the connection after the reload (${what})`);
    await waitFor(page, `document.querySelectorAll('#list .row').length > 0`, `the restored list (${what})`);
  };
  // The toolbar icon after the tab has been closed: a fresh address, so
  // only the stored view can say where the player was.
  const reopen = async (what) => {
    await page.call('Page.navigate', { url: bare(target.url) });
    await settled(what);
  };
  // F5: the address stands, and it is the address the place comes back from.
  const refresh = async (what) => {
    await page.call('Page.reload');
    await settled(what);
  };
  const hash = () => evaluate(page, `location.hash`);
  const title = () => evaluate(page, `document.title`);
  const crumb = () => evaluate(page, `((document.querySelector('#crumbs span') || {}).textContent || '').trim()`);
  // Nothing of the stored view is left: what comes back after this came
  // back from the address.
  const forget = () => evaluate(page, `chrome.storage.local.remove('ui')`);

  // A group other than the one the player opens on, and a topic within it.
  await openLiveList(page, 1);
  await evaluate(page, `document.querySelectorAll('#groups .group')[3].click()`);
  await waitFor(page, `document.querySelectorAll('#subcats .chip').length > 1`, 'the topic bar');
  const group = await active();
  await evaluate(page, `document.querySelectorAll('#subcats .chip')[1].querySelector('.chip-main').click()`);
  await waitFor(page, `document.querySelectorAll('#subcats .chip')[1].classList.contains('active')`, 'the chosen topic');
  const chosen = await topic();
  const narrowed = await rows();
  assert(chosen && narrowed > 0, `no topic to restore: "${chosen}", ${narrowed} rows`);

  // The address names the place, and the tab's title says it in words.
  // The sidebar row carries the favourite star in its text; the name alone
  // is what the address and the title are made of.
  const groupName = group.replace(/^[^\p{L}\p{N}]+/u, '');
  const chosenHash = await hash();
  assert(chosenHash === `#/live/${encodeURIComponent(groupName)}/${chosenHash.split('/')[3]}` && chosenHash.split('/').length === 4,
    `the address does not name the topic: "${chosenHash}" for "${groupName}"`);
  assert(await title() === `Channels › ${groupName} › ${chosen} — Kepuli-TV`,
    `the title does not follow the path: "${await title()}"`);

  // A refresh keeps the address, and the address alone brings the place
  // back: the stored view is gone before the page reloads.
  await forget();
  await refresh('the address');
  assert(await hash() === chosenHash, `the address changed over the refresh: "${chosenHash}" → "${await hash()}"`);
  assert(await active() === group, `the address lost the group: "${group}" → "${await active()}"`);
  assert(await topic() === chosen, `the address lost the topic: "${chosen}" → "${await topic()}"`);
  assert(await rows() === narrowed, `the address restored a different list: ${narrowed} → ${await rows()} rows`);

  await reopen('group and topic');
  assert(await active() === group, `the group was not restored: "${group}" → "${await active()}"`);
  assert(await topic() === chosen, `the topic was not restored: "${chosen}" → "${await topic()}"`);
  assert(await rows() === narrowed, `the restored list differs: ${narrowed} → ${await rows()} rows`);

  // A search is a detour rather than a place: it empties the group while it
  // runs, and a reload during one returns to where the search started. The
  // address says so while the search is on screen — it is the group the
  // search took over from, not the whole list it is reading — and the title
  // says what is on screen, the search included.
  await evaluate(page, `(() => { const s = document.getElementById('search'); s.value = 'news'; s.dispatchEvent(new Event('input')); })()`);
  await waitFor(page, `${ACTIVE_GROUP}.startsWith('All') && document.querySelectorAll('#list .row').length > 0`, 'the search results', 15000);
  assert(await hash() === chosenHash, `a search took the address with it: "${chosenHash}" → "${await hash()}"`);
  assert(await title() === 'Channels › Search: news — Kepuli-TV', `the title does not name the search: "${await title()}"`);
  await refresh('a search in the address');
  assert(await active() === group, `a refresh during a search lost the group: "${group}" → "${await active()}"`);
  assert(await topic() === chosen, `a refresh during a search lost the topic: "${chosen}" → "${await topic()}"`);
  assert(await evaluate(page, `document.getElementById('search').value === ''`), 'the search itself came back with the group');

  await evaluate(page, `(() => { const s = document.getElementById('search'); s.value = 'news'; s.dispatchEvent(new Event('input')); })()`);
  await waitFor(page, `${ACTIVE_GROUP}.startsWith('All') && document.querySelectorAll('#list .row').length > 0`, 'the search results again', 15000);
  await reopen('a search');
  assert(await active() === group, `a search took the stored view with it: "${group}" → "${await active()}"`);
  assert(await topic() === chosen, `a search took the stored topic with it: "${chosen}" → "${await topic()}"`);

  // A topic the account no longer offers leaves the group standing.
  await store({ sub: 'no-such-category' });
  await reopen('an unknown topic');
  assert(await active() === group, `an unknown topic lost the group: "${group}" → "${await active()}"`);
  assert(await evaluate(page, `document.querySelectorAll('#subcats .chip')[0].classList.contains('active')`), 'an unknown topic was restored onto the topic bar');
  assert(await rows() > narrowed, `an unknown topic kept the list narrowed: ${await rows()} rows`);

  // Nor does an unknown group leave the list empty under a sidebar pointing
  // at nothing: the stored view is not tied to an account, and a provider
  // renames its categories.
  await store({ group: 'Atlantis', sub: null });
  await reopen('an unknown group');
  assert(await active() !== 'Atlantis', 'an unknown group was restored');
  assert(await rows() > 0, 'an unknown group left the list empty');

  // The tab and its own group, which is a second entry in the same store.
  await evaluate(page, `document.querySelector('#tabs [data-tab="movie"]').click()`);
  await waitFor(page, `document.querySelectorAll('#list .row').length > 0`, 'the movie list');
  const movies = await active();
  await reopen('the tab');
  assert(await tab() === 'movie', `the tab was not restored: "${await tab()}"`);
  assert(await active() === movies, `the movie group was not restored: "${movies}" → "${await active()}"`);

  // A series is a place of its own, and the deepest one the list has: the
  // address carries it, and a refresh comes back into the episodes rather
  // than to the list they were opened from.
  await evaluate(page, `document.querySelector('#tabs [data-tab="series"]').click()`);
  await waitFor(page, `document.querySelectorAll('#list .row').length > 0`, 'the series list');
  await evaluate(page, `document.querySelectorAll('#list .row')[0].click()`);
  await waitFor(page, `!document.getElementById('detail').hidden && document.querySelectorAll('#list .row').length > 0`, 'the episodes');
  const series = await crumb();
  const episodes = await rows();
  assert(series && (await hash()).includes('?series='), `the address does not name the series: "${await hash()}"`);
  assert((await title()).startsWith(`Series › `) && (await title()).includes(series), `the title does not name the series: "${await title()}"`);
  await forget();
  await refresh('a series');
  await waitFor(page, `!document.getElementById('detail').hidden`, 'the restored episodes');
  assert(await crumb() === series, `the series was not restored: "${series}" → "${await crumb()}"`);
  assert(await rows() === episodes, `the restored episode list differs: ${episodes} → ${await rows()} rows`);

  // The back button leaves the series, and the address follows it out.
  await evaluate(page, `document.querySelector('#crumbs button').click()`);
  await waitFor(page, `document.getElementById('crumbs').hidden`, 'the list behind the series');
  assert(!(await hash()).includes('series='), `the address kept the series after the back button: "${await hash()}"`);

  // An address typed into the bar is a navigation like any other.
  await evaluate(page, `location.hash = '#/live/' + encodeURIComponent(${JSON.stringify(groupName)})`);
  await waitFor(page, `document.querySelector('#tabs [aria-selected="true"]').dataset.tab === 'live'`, 'the tab the address named');
  await waitFor(page, `${ACTIVE_GROUP} === ${JSON.stringify(group)}`, 'the group the address named');

  // A favourite category is a place of its own inside the favourites, and
  // the address carries it as well: a refresh comes back into the category
  // rather than to the collection's root.
  await openLiveList(page, 1);
  await waitFor(page, `document.querySelectorAll('#subcats .chip .chip-star').length > 0`, 'a topic to make a favourite');
  await evaluate(page, `document.querySelector('#subcats .chip .chip-star').click()`);
  await evaluate(page, `document.querySelector('#tabs [data-tab="fav"]').click()`);
  await waitFor(page, `document.querySelectorAll('#list .row').length > 0`, 'the favourites');
  await evaluate(page, `document.querySelector('#list .row').click()`);
  await waitFor(page, `!document.getElementById('crumbs').hidden && document.querySelectorAll('#list .row').length > 0`, 'the category contents');
  const category = await crumb();
  const inside = await rows();
  assert((await hash()).startsWith('#/fav?cat='), `the address does not name the category: "${await hash()}"`);
  await forget();
  await refresh('a favourite category');
  await waitFor(page, `!document.getElementById('crumbs').hidden`, 'the restored category');
  assert(await crumb() === category, `the category was not restored: "${category}" → "${await crumb()}"`);
  assert(await rows() === inside, `the restored category differs: ${inside} → ${await rows()} rows`);
  await evaluate(page, `document.querySelector('#crumbs button').click()`);
  await openLiveList(page, 1);

  // "All" is a choice too, and a costly one: it is the whole type rather
  // than a group of it. The address tells it apart from a group not yet
  // chosen, so a refresh comes back to the whole list rather than to the
  // first group the player would otherwise open on.
  await evaluate(page, `document.querySelector('#groups .group.all').click()`);
  await waitFor(page, `${ACTIVE_GROUP}.startsWith('All') && document.querySelectorAll('#list .row').length > 0`, 'the whole channel list', 20000);
  const all = await rows();
  assert(await hash() === '#/live/-', `All is not in the address: "${await hash()}"`);
  await forget();
  await refresh('All');
  assert((await active()).startsWith('All'), `All was not restored: "${await active()}"`);
  assert(await rows() === all, `the restored list differs: ${all} → ${await rows()} rows`);

  const ui = await stored();
  return { ok: true, detail: `address and title follow the path; refresh restores group, topic, series, favourite category and All without the stored view; a typed address navigates; stored view brings back group, topic, tab, drops a search, an unknown topic and an unknown group; stored ${JSON.stringify(ui)}` };
}

async function programmes(page, { requests }) {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  await openLiveList(page, 3);
  await evaluate(page, `document.getElementById('btn-guide').click()`);
  await waitFor(page, `document.getElementById('main').classList.contains('guide')`, 'guide');
  // Yesterday on are buttons; the archive's older days are in the Earlier menu.
  assert(await evaluate(page, `document.querySelectorAll('#epg-days button').length + Math.max(0, (document.querySelector('#epg-days .epg-earlier')?.options.length || 1) - 1) >= 8
    && document.querySelector('#epg-days button')?.textContent === 'yesterday'`), 'archive duration did not extend guide history');
  const search = async (query, period = 'upcoming') => {
    await evaluate(page, `document.getElementById('programme-query').value=${JSON.stringify(query)}; document.getElementById('programme-period').value=${JSON.stringify(period)}; document.getElementById('programme-form').requestSubmit()`);
    await waitFor(page, `document.getElementById('programme-status').textContent.includes('Search finished')`, 'programme search');
  };
  await search('Ice hockey');
  assert(await evaluate(page, `document.querySelectorAll('.programme-result').length > 0`), 'programme title search found no hockey');
  assert(await evaluate(page, `getComputedStyle(document.getElementById('epg-body')).display === 'none'`), 'grid not replaced by programme results');
  const before = requests.filter((r) => r.includes('get_simple_data_table')).length;
  await search('behind the scenes');
  assert(await evaluate(page, `document.querySelectorAll('.programme-result').length > 0`), 'description search found no results');
  assert(requests.filter((r) => r.includes('get_simple_data_table')).length === before, 'repeated search refetched cached full tables');
  await search('No-such-programme-38472');
  assert(await evaluate(page, `document.getElementById('programme-status').textContent.startsWith('0 results')`), 'empty search had no explicit result count');
  await search('News', 'past');
  await evaluate(page, `document.querySelector('.programme-result').click()`);
  await waitFor(page, `document.querySelector('#epgv-slot b')`, 'search result detail');
  await evaluate(page, `document.getElementById('programme-clear').click()`);
  assert(await evaluate(page, `!document.getElementById('epg-body').hidden && document.getElementById('programme-panel').hidden`), 'return to guide failed');
  return { ok: true, detail: 'archive-length guide; title/description search, cached repeat, empty results, past results and return to grid' };
}

/**
 * Refresh brings in what the provider added to a list already opened this
 * session, in place; and the cache's expired rows go, read by their time
 * alone (js/db.js, cachePurge), while a prefix read takes only its own.
 */
async function refresh(page) {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const names = () => evaluate(page, `[...document.querySelectorAll('#list .row')].map((r) => r.textContent)`);
  await openLiveList(page, 1);
  await evaluate(page, `[...document.querySelectorAll('#groups .group')].find((g) => g.textContent.includes('Finland')).click()`);
  await waitFor(page, `${ACTIVE_GROUP}.includes('Finland') && document.querySelectorAll('#list .row').length > 1`, 'Finland');
  const before = await names();
  assert(!before.some((n) => n.includes('Aurora Newcomer')), 'the new channel is there before it was added');
  // Another group and back: Finland's list is the one kept from earlier.
  await evaluate(page, `[...document.querySelectorAll('#groups .group')].find((g) => g.textContent.includes('Sweden')).click()`);
  await waitFor(page, `${ACTIVE_GROUP}.includes('Sweden')`, 'Sweden');
  await evaluate(page, `[...document.querySelectorAll('#groups .group')].find((g) => g.textContent.includes('Finland')).click()`);
  await waitFor(page, `${ACTIVE_GROUP}.includes('Finland') && document.querySelectorAll('#list .row').length > 1`, 'Finland again');
  process.env.KEPULI_MOCK_EXTRA_CHANNEL = '1';
  try {
    await evaluate(page, `document.getElementById('btn-refresh').click()`);
    await waitFor(page, `[...document.querySelectorAll('#list .row')].some((r) => r.textContent.includes('Aurora Newcomer'))`, 'the new channel after Refresh', 15000);
  } finally {
    process.env.KEPULI_MOCK_EXTRA_CHANNEL = '';
  }
  assert((await evaluate(page, ACTIVE_GROUP)).includes('Finland'), 'Refresh left the group');

  const purge = await evaluate(page, `(async () => {
    const db = await import('/js/db.js');
    const day = 24 * 3600e3, now = Date.now();
    const raw = await new Promise((resolve, reject) => { const r = indexedDB.open('kepuli-tv'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    await new Promise((resolve) => { const t = raw.transaction('cache', 'readwrite'); const s = t.objectStore('cache');
      s.put({ value: 1, at: now - 8 * day }, 'x|vod:v2:old'); s.put({ value: 2, at: now - day }, 'x|vod:v2:new');
      s.put({ value: 3, at: now - 2 * day }, 'probe:h:movie:1.mkv'); s.put({ value: 4, at: now - 30 * day }, 'other');
      t.oncomplete = resolve; });
    raw.close();
    const ttl = (key) => (key.startsWith('probe:') ? 90 * day : key.includes('|vod:') ? 7 * day : null);
    const deleted = await db.cachePurge(ttl);
    const keys = await db.cacheSummary();
    const probes = (await db.cacheGetAll('probe:')).map(([k]) => k);
    return { deleted, old: keys.includes('x|vod:v2:old'), kept: ['x|vod:v2:new', 'probe:h:movie:1.mkv', 'other'].every((k) => keys.includes(k)), probes };
  })()`);
  assert(purge.deleted === 1 && !purge.old && purge.kept, `the purge: ${JSON.stringify(purge)}`);
  assert(JSON.stringify(purge.probes) === '["probe:h:movie:1.mkv"]', `the prefix read: ${JSON.stringify(purge.probes)}`);
  return { ok: true, detail: `Refresh showed the added channel in Finland's list opened earlier (${before.length} rows before); the purge deleted the one expired row and the prefix read took only the probe` };
}

/**
 * A reload whose address names a series opens it — unless the viewer has
 * gone somewhere else while the list underneath was on its way.
 */
async function restorenav(page, { target }) {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const id = await evaluate(page, `fetch('http://127.0.0.1:${MOCK_PORT}/player_api.php?username=demo&password=demo&action=get_series').then((r) => r.json()).then((l) => String(l[0].series_id))`);
  process.env.KEPULI_MOCK_SLOW_LIST = '5000';
  try {
    await evaluate(page, `history.replaceState(null, '', '#/series/-?series=${id}')`);
    await page.call('Page.reload');
    await sleep(1000);
    await waitFor(page, `document.querySelectorAll('#groups .group').length > 1 && document.querySelector('#tabs [aria-selected="true"]')?.dataset.tab === 'series'`, 'the series sidebar');
    // A group chosen while the whole list is still coming.
    const chosen = await evaluate(page, `(() => { const g = [...document.querySelectorAll('#groups .group')].find((n) => !/^All/.test(n.textContent.trim())); g.click(); return g.textContent.trim().replace(/\s*\d+$/, ''); })()`);
    await sleep(7000);
    const at = await evaluate(page, `({ hash: location.hash, crumb: ((document.querySelector('#crumbs span') || {}).textContent || '').trim(), group: ${ACTIVE_GROUP}, rows: document.querySelectorAll('#list .row').length })`);
    assert(!at.hash.includes('series=') && !at.crumb && at.group === chosen && at.rows > 0, `the restore went over the viewer's choice: ${JSON.stringify({ chosen, ...at })}`);
    return { ok: true, detail: `group ${chosen} chosen during the restore stayed, the series ${id} was not opened over it (${at.hash})` };
  } finally {
    process.env.KEPULI_MOCK_SLOW_LIST = '';
  }
}

/**
 * The guide keeps its place when the list repaints with the same channels
 * — a change of language here — and says its days and the programme
 * search's line in the new language.
 */
async function guidekeep(page) {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const language = async (lang) => {
    await evaluate(page, `document.getElementById('btn-settings').click()`, { gesture: true });
    await waitFor(page, `document.getElementById('setup').open`, 'the settings dialog', 5000);
    await evaluate(page, `document.querySelector('#setup-tabs [data-panel="general"]').click()`);
    await evaluate(page, `(() => { const c = document.getElementById('f-lang'); c.value = '${lang}'; c.dispatchEvent(new Event('input', { bubbles: true })); c.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await evaluate(page, `document.getElementById('f-save').click()`, { gesture: true });
    await waitFor(page, `document.documentElement.lang === '${lang}' && !document.getElementById('setup').open`, `the language ${lang}`);
    await sleep(800);
  };
  await openLiveList(page, 3);
  await evaluate(page, `document.getElementById('btn-guide').click()`);
  await waitFor(page, `document.getElementById('main').classList.contains('guide')`, 'guide');
  await evaluate(page, `(() => { const s = document.getElementById('epg-group'); s.value = ''; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await waitFor(page, `document.querySelectorAll('#epg-chans-inner .epg-chan').length > 8 && document.getElementById('list-progress').hidden`, 'all channels in the guide');
  await sleep(500);
  await evaluate(page, `document.getElementById('epg-scroll').scrollTop = 300`);
  await sleep(400);
  await evaluate(page, `document.querySelector('#epg-chans-inner [data-row="9"]').click()`);
  await sleep(300);
  const place = () => evaluate(page, `({ top: document.getElementById('epg-scroll').scrollTop,
    cursor: document.querySelector('#epg-chans-inner .epg-chan.cursor')?.title || null,
    day: document.querySelector('#epg-days button')?.textContent })`);
  const before = await place();
  assert(before.top > 100 && before.cursor && before.day === 'yesterday', `the guide before: ${JSON.stringify(before)}`);
  await language('fi');
  const after = await place();
  assert(Math.abs(after.top - before.top) < 2 && after.cursor === before.cursor, `the repaint moved the guide: ${JSON.stringify({ before, after })}`);
  assert(after.day === 'eilen', `the day buttons kept the old language: ${JSON.stringify(after)}`);
  await evaluate(page, `document.getElementById('programme-query').value = 'News'; document.getElementById('programme-scope').value = 'group'; document.getElementById('programme-form').requestSubmit()`);
  await waitFor(page, `document.getElementById('programme-status').textContent.includes('Haku päättynyt')`, 'the Finnish programme search', 60000);
  await language('en');
  const status = await evaluate(page, `({ text: document.getElementById('programme-status').textContent, shown: !document.getElementById('programme-panel').hidden })`);
  assert(status.shown && status.text.includes('Search finished'), `the programme search after the switch: ${JSON.stringify(status)}`);
  await evaluate(page, `document.getElementById('programme-clear').click()`);
  return { ok: true, detail: `scroll ${before.top} px and ${before.cursor} kept over a language switch; days said "${after.day}"; the search line followed back to English` };
}

/** A channel with an archive, its current programme started over. */
async function startCatchup(page) {
  await openLiveList(page, 3);
  await evaluate(page, `(async () => {
    const {XtreamApi}=await import('./js/api.js');
    const {config}=await chrome.storage.local.get('config');
    const channels=await new XtreamApi(config).streams('live');
    const names=[...document.querySelectorAll('#list .row-name')];
    const row=names.find(n=>channels.some(c=>c.n===n.title && c.archive>0));
    if(!row) throw new Error('No archived channel in view');
    row.closest('.row').click();
  })()`, { gesture: true });
  await waitFor(page, PLAYING, 'live channel');
  await evaluate(page, `document.getElementById('btn-guide').click()`);
  await waitFor(page, `[...document.querySelectorAll('#epgv-actions button')].some(b=>b.textContent==='Start from beginning')`, 'start-over action');
  await click(page, '#epgv-actions', 'Start from beginning', { gesture: true });
  await waitFor(page, PLAYING, 'start-over playback');
}

async function catchup(page, { requests }) {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  await startCatchup(page);
  assert(requests.some((r) => r.startsWith('/timeshift/')), 'start over did not request the archive');
  const archiveCount = () => requests.filter((r) => r.startsWith('/timeshift/')).length;
  let before = archiveCount();
  await evaluate(page, `document.getElementById('btn-reload').click()`, { gesture: true });
  await waitFor(page, PLAYING, 'archive reload');
  assert(archiveCount() > before, 'reload escaped to live instead of reloading the archive');
  before = archiveCount();
  await evaluate(page, `document.getElementById('video').dispatchEvent(new Event('ended'))`);
  await sleep(2200);
  assert(archiveCount() === before, 'archive ended event triggered live reconnection');
  await evaluate(page, `document.getElementById('btn-live').click()`, { gesture: true });
  await waitFor(page, PLAYING, 'return to live');
  assert(await evaluate(page, `document.getElementById('btn-live').hidden && !document.getElementById('mode').disabled`), 'return to live left archive controls active');
  return { ok: true, detail: 'current programme starts via timeshift; reload stays in archive; end does not reconnect; return to live' };
}


async function setupClarity(page) {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const press = (id) => evaluate(page, `document.getElementById('${id}').click()`, { gesture: true });
  const change = (id, value) => evaluate(page, `(() => {const input=document.getElementById('${id}');input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  // What Chrome sends on Ctrl+V: the inputType is what tells a whole
  // address from one still being typed.
  const paste = (id, value) => evaluate(page, `(() => {const input=document.getElementById('${id}');input.focus();input.value=${JSON.stringify(value)};input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertFromPaste'}));})()`);
  const capture = async (name) => {
    if (!process.env.KEPULI_SETUP_CAPTURE_DIR) return;
    const fs = await import('node:fs');
    fs.mkdirSync(process.env.KEPULI_SETUP_CAPTURE_DIR, {recursive:true});
    const {data} = await page.call('Page.captureScreenshot', {format:'png'});
    fs.writeFileSync(`${process.env.KEPULI_SETUP_CAPTURE_DIR}/${name}.png`, Buffer.from(data,'base64'));
  };
  const before = await evaluate(page, `chrome.storage.local.get(['config','settings'])`);
  await press('btn-settings');
  await evaluate(page, `document.querySelector('input[name="source"][value="m3u"]').click()`);
  // Text that is no address says so; an address without credentials is a
  // playlist of its own, kept as it is, with the guide's field beside it.
  await change('f-paste', 'example test');
  assert(await evaluate(page, `!document.getElementById('playlist-status').hidden && !document.getElementById('src-m3u').hidden`), 'text that is no address was accepted');
  await change('f-paste', 'http://example.test:8080/get.php?username=%3Cusername%3E');
  assert(await evaluate(page, `document.getElementById('playlist-status').hidden && !document.getElementById('src-m3u').hidden && !document.getElementById('src-epg').hidden`), 'an address without credentials was not taken as a playlist');
  await paste('f-paste', 'http://example.test:8080/get.php?username=%3Cusername%3E&password=%3Cpassword%3E&type=m3u_plus&output=ts');
  const fields = await evaluate(page, `['scheme','host','port','username','password'].map(f=>document.getElementById('f-'+f).value)`);
  assert(JSON.stringify(fields) === JSON.stringify(['http','example.test','8080','<username>','<password>']), 'pasted URL was not decoded into visible fields');
  assert(await evaluate(page, `!document.getElementById('src-xtream').hidden && document.getElementById('src-m3u').hidden && document.getElementById('playlist-status').hidden && document.activeElement.id==='f-host'`), 'a pasted address did not open and focus the fields it filled');
  await capture('subscription-url');
  assert(JSON.stringify(await evaluate(page, `chrome.storage.local.get(['config','settings'])`)) === JSON.stringify(before), 'pasting committed credentials before Save');
  await press('f-done');
  await press('btn-settings');
  await evaluate(page, `document.querySelector('#setup-tabs [data-panel="subs"]').click()`);
  await change('f-subsize', '250');
  for (const [width,height] of [[1280,800],[390,844],[320,568],[640,420]]) {
    await page.call('Emulation.setDeviceMetricsOverride', {width,height,deviceScaleFactor:1,mobile:false});
    for (const style of ['shadow','box','contrast']) {
      await change('f-substyle', style);
      await sleep(120);
      const fit = await evaluate(page, `(() => {
        const frame=document.querySelector('.sublook-preview').getBoundingClientRect(),
          sample=document.querySelector('.sublook-preview .subdisplay').getBoundingClientRect(),
          controls=document.querySelector('.sublook-fields').getBoundingClientRect(),
          panel=document.getElementById('panel-subs').getBoundingClientRect(),
          save=document.getElementById('f-save').getBoundingClientRect();
        return {inside:sample.left>=frame.left && sample.right<=frame.right && sample.top>=frame.top && sample.bottom<=frame.bottom,
          controlsAbove:controls.bottom<=frame.top,visible:controls.top>=panel.top && frame.bottom<=panel.bottom+1,
          footer:save.bottom<=innerHeight, size:document.getElementById('f-subsize').value,
          runtime:document.body.style.getPropertyValue('--sub-scale')};})()`);
      assert(fit.inside && fit.controlsAbove && fit.visible && fit.footer && fit.size==='250' && fit.runtime==='1', `${width}x${height} ${style}: ${JSON.stringify(fit)}`);
      if(style==='box') await capture(`subtitles-250-${width}`);
    }
  }
  await page.call('Emulation.setDeviceMetricsOverride', {width:1280,height:800,deviceScaleFactor:1,mobile:false});
  await press('f-save');
  await waitFor(page, `!document.getElementById('setup').open`, 'saved 250 % subtitles');
  assert(await evaluate(page, `chrome.storage.local.get('settings').then(d=>d.settings.subtitleScale===250 && document.body.style.getPropertyValue('--sub-scale')==='2.5')`), 'preview scaling changed saved or playback size');
  return {ok:true, detail:'a pasted subscription URL opens the fields it decoded into, without saving; text that is no address says so, an address without credentials is a playlist with a guide field; controls above an unclipped 250 % preview at 320–1280px; playback saves 250 %'};
}


/** Covers and catalogue metadata use the same DOM in both browsers. */
async function catalogUi(page) {
  const assert = (ok, detail) => { if (!ok) throw new Error(detail); };
  await evaluate(page, `document.querySelector('[data-tab="movie"]').click()`);
  await waitFor(page, `document.querySelectorAll('#list .row').length > 1 && document.getElementById('list-progress').hidden`, 'movie rows');
  // Covers first: the duration reaches the line under a cover as it does a row.
  await waitFor(page, `document.querySelector('#list.covers .row.card') && [...document.querySelectorAll('#list .card-meta')].some((n) => /\\d+ ?min|\\dh/.test(n.textContent))`, 'movie duration on a cover');
  await evaluate(page, `document.querySelector('.view-toggle button[aria-pressed="false"]').click()`);
  await waitFor(page, `!document.getElementById('list').classList.contains('covers') && document.querySelector('#list .row-duration')`, 'movie duration metadata');
  assert(await evaluate(page, `!document.getElementById('media-filters').hidden && document.getElementById('channel-tools').hidden && document.querySelector('.topbar-end').lastElementChild.id === 'btn-settings'`), 'movie navigation/filters');
  const apply = (key,value) => evaluate(page, `(() => {const f=document.querySelector('#media-filters [name="${key}"]');f.value=${JSON.stringify(value)};f.dispatchEvent(new Event('change'));})()`);
  await apply('rating','8');
  await waitFor(page, `document.getElementById('list-progress').hidden && document.querySelectorAll('#list .row').length > 0`, 'rating filter');
  assert(await evaluate(page, String.raw`[...document.querySelectorAll('#list .row-sub')].every(n => Number(n.textContent.match(/★\s*([\d.]+)/)?.[1]) >= 8)`), 'low rating leaked into filtered movies');
  await apply('sort','rating');
  const values = await evaluate(page, String.raw`[...document.querySelectorAll('#list .row-sub')].map(n=>Number(n.textContent.match(/★\s*([\d.]+)/)?.[1]))`);
  assert(values.every((v,i)=>!i || values[i-1]>=v), 'rating sort order');
  await evaluate(page, `document.querySelector('.media-filter-footer button').click()`);
  await waitFor(page, `document.querySelectorAll('#list .row').length > 1`, 'filter reset');
  await evaluate(page, `document.querySelector('#list .row').click()`, {gesture:true});
  await waitFor(page, PLAYING, 'native movie playback');
  await waitFor(page, `document.querySelector('#infostrip .title-links a') && document.querySelector('#infostrip .playback-facts')`, 'movie facts and external link');
  assert(await evaluate(page, `document.querySelector('#infostrip .title-links a').href.startsWith('https://www.imdb.com/')`), 'IMDb link destination');
  await playEpisode(page);
  await waitFor(page, `document.querySelector('#detail .detail-cover.loaded:not(:disabled)')`, 'series cover');
  await evaluate(page, `document.querySelector('#detail .detail-cover').click()`);
  await waitFor(page, `document.querySelector('.poster-dialog[open] img')`, 'expanded cover');
  await checkModal(page, '.poster-dialog', 'poster');
  await evaluate(page, `document.querySelector('.poster-close').click()`);
  assert(await evaluate(page, `!document.querySelector('.poster-dialog[open]')`), 'cover did not close');
  await evaluate(page, `document.querySelector('[data-tab="recent"]').click()`);
  await waitFor(page, `document.querySelectorAll('#list .row').length >= 2`, 'movie and episode history');
  // Exercise actual image loading and error handling without a remote provider.
  await evaluate(page, `import('./js/poster.js').then(({poster})=>{
    const host=document.createElement('div');host.id='cover-check';document.body.append(host);
    host.append(poster('row-logo','', 'channel'),poster('row-logo','data:image/png;base64,bm90aW1hZ2U=', 'channel'));
  })`);
  await waitFor(page, `!document.querySelector('#cover-check img')`, 'failed image fallback');
  assert(await evaluate(page, `[...document.querySelectorAll('#cover-check svg')].every(svg=>getComputedStyle(svg).visibility==='visible')`), 'channel placeholder hidden');
  await evaluate(page, `document.getElementById('cover-check').remove()`);
  await openLiveList(page);
  assert(await evaluate(page, `!document.getElementById('channel-tools').hidden && document.getElementById('media-filters').hidden`), 'channel navigation');
  await evaluate(page, `document.getElementById('btn-guide').click()`);
  await waitFor(page, `document.getElementById('main').classList.contains('guide')`, 'guide entry');
  await mouseClick(page, '#epg-close');
  assert(await evaluate(page, `!document.getElementById('main').classList.contains('guide') && document.activeElement.id==='btn-guide'`), 'guide return and focus');
  return {ok:true,detail:'movie duration, rating filter/sort/reset, native playback, IMDb/facts, series cover expansion, history, failed/missing logo fallback and guide return'};
}

/* ----------------------------------------------------------- viewing aids */

const NOW_TITLE = `document.getElementById('now-title').textContent`;

async function lastchannel(page) {
  await openLiveList(page, 4);
  await evaluate(page, `document.getElementById('list').focus()`);
  await pressKey(page, 'l', 'KeyL', 76);
  await sleep(300);
  const none = await evaluate(page, `!document.getElementById('toast').hidden`);
  await evaluate(page, `document.querySelectorAll('#list .row')[0].click()`, { gesture: true });
  await waitFor(page, PLAYING, 'the first channel');
  const first = await evaluate(page, NOW_TITLE);
  await evaluate(page, `document.querySelectorAll('#list .row')[3].click()`, { gesture: true });
  await waitFor(page, `${NOW_TITLE} !== ${JSON.stringify(first)}`, 'the fourth channel');
  const fourth = await evaluate(page, NOW_TITLE);
  await evaluate(page, `document.getElementById('list').focus()`);
  await pressKey(page, 'l', 'KeyL', 76);
  await waitFor(page, `${NOW_TITLE} === ${JSON.stringify(first)}`, 'l back to the first channel');
  await pressKey(page, 'l', 'KeyL', 76);
  await waitFor(page, `${NOW_TITLE} === ${JSON.stringify(fourth)}`, 'l back to the fourth channel');
  await waitFor(page, PLAYING, 'the fourth channel again');
  const meta = await evaluate(page, `({ title: navigator.mediaSession.metadata?.title, artist: navigator.mediaSession.metadata?.artist })`);
  const ok = none && meta.artist === fourth && Boolean(meta.title);
  return { ok, detail: `nothing before the first: ${none}; ${first} ⇄ ${fourth}; media session "${meta.title}" / "${meta.artist}"` };
}

async function nextepisode(page) {
  await playEpisode(page, 0);
  const first = await evaluate(page, NOW_TITLE);
  const toEnd = `(v => { v.currentTime = v.duration - 1.5; })(document.getElementById('video'))`;
  await evaluate(page, toEnd);
  await waitFor(page, `document.getElementById('overlay-title').textContent === ${JSON.stringify('Next episode')} && !document.getElementById('overlay').hidden`, 'the countdown', 30000);
  const countdown = await evaluate(page, `document.getElementById('overlay-text').textContent`);
  await waitFor(page, `${NOW_TITLE} !== ${JSON.stringify(first)}`, 'the next episode', 20000);
  await waitFor(page, PLAYING, 'the next episode playing');
  const second = await evaluate(page, NOW_TITLE);
  await sleep(1000);
  await evaluate(page, toEnd);
  await waitFor(page, `!document.getElementById('overlay').hidden && document.getElementById('overlay-actions').children.length === 2`, 'the second countdown', 30000);
  await evaluate(page, `document.querySelectorAll('#overlay-actions button')[1].click()`);
  await sleep(11000);
  const stayed = await evaluate(page, `${NOW_TITLE} === ${JSON.stringify(second)} && document.getElementById('overlay').hidden`);
  await openLiveList(page);
  await evaluate(page, `document.getElementById('list').focus()`);
  await pressKey(page, 'n', 'KeyN', 78);
  // The demo's episode names repeat, so the number tells them apart.
  await waitFor(page, `/\\bE3\\b/.test(document.getElementById('now-sub').textContent)`, 'n to the third episode', 15000);
  const third = await evaluate(page, `${NOW_TITLE} + ' ' + document.getElementById('now-sub').textContent`);
  return { ok: stayed, detail: `"${countdown}"; ${first} → ${second}, Cancel stayed: ${stayed}; n from the channels: ${third}` };
}

async function continuewatching(page) {
  await evaluate(page, `chrome.storage.local.get('settings').then((got) => chrome.storage.local.set({ settings: { ...got.settings, resumeEnabled: true } }))`);
  await page.call('Page.reload');
  // The old page still answers for a moment, connected: the wait would be
  // over before the reload began.
  await sleep(1000);
  await waitFor(page, CONNECTED, 'the connection after the reload');
  await evaluate(page, `document.querySelector('#tabs [data-tab="movie"]').click()`);
  await click(page, '#groups', 'Nordic');
  await click(page, '#list', 'Northern Lights', { gesture: true });
  await waitFor(page, PLAYING, 'the film');
  await evaluate(page, `document.getElementById('video').currentTime = 40`);
  await sleep(6000);
  await evaluate(page, `document.getElementById('video').currentTime = 45`);
  await sleep(1000);
  await playFirstChannel(page);
  await evaluate(page, `document.querySelector('#tabs [data-tab="recent"]').click()`);
  await waitFor(page, `document.querySelectorAll('#list .row').length >= 2`, 'the history');
  const order = await evaluate(page, `[...document.querySelectorAll('#list .rowgroup > :first-child, #list .row')]
    .map((node) => (node.classList.contains('row') ? '' : '# ') + node.textContent.trim().slice(0, 24))`);
  const ok = /^# Continue watching/.test(order[0]) && /Northern Lights/.test(order[1]) && order[2]?.startsWith('# ');
  return { ok, detail: order.join(' | ') };
}

async function reminders(page) {
  await openLiveList(page, 2);
  await evaluate(page, `document.getElementById('list').focus()`);
  await pressKey(page, 'g', 'KeyG', 71);
  await waitFor(page, `document.getElementById('main').classList.contains('guide') && document.querySelectorAll('.epg-prog').length > 0`, 'the guide');
  await pressKey(page, 'ArrowRight', 'ArrowRight', 39);
  await waitFor(page, `[...document.querySelectorAll('#epgv-actions button')].some((b) => b.textContent === 'Remind me')`, 'Remind me on an upcoming programme');
  await evaluate(page, `[...document.querySelectorAll('#epgv-actions button')].find((b) => b.textContent === 'Remind me').click()`);
  await waitFor(page, `document.querySelectorAll('.epg-prog.remind').length === 1`, 'the bell in the grid');
  const findStored = `chrome.storage.local.get(null).then((all) => Object.entries(all).find(([key]) => key.startsWith('reminders')))`;
  await waitFor(page, findStored, 'the reminder in storage', 5000).catch(() => {});
  const stored = await evaluate(page, findStored);
  if (!stored || stored[1].length !== 1) return { ok: false, detail: `stored: ${JSON.stringify(stored)}` };
  // Due in half a minute: the reload finds it inside its minute and says it.
  // The open player sees the stored list change and may say it first — the
  // change is another tab's to it — and then the reload finds it said.
  const [key, list] = stored;
  list[0].start = Date.now() + 30000;
  list[0].stop = Date.now() + 600000;
  await evaluate(page, `chrome.storage.local.set({ ${JSON.stringify(key)}: ${JSON.stringify(list)} })`);
  const sayingIt = `!document.getElementById('toast').hidden && document.getElementById('toast-text').textContent.includes(${JSON.stringify(list[0].title)})`;
  await sleep(1000);
  if (!await evaluate(page, sayingIt)) {
    await page.call('Page.reload');
    await waitFor(page, CONNECTED, 'the connection after the reload');
  }
  await waitFor(page, `!document.getElementById('toast').hidden && document.getElementById('toast-text').textContent.includes(${JSON.stringify(list[0].title)})`, 'the reminder');
  const said = await evaluate(page, `document.getElementById('toast-text').textContent`);
  await evaluate(page, `document.querySelector('#toast .toast-action').click()`, { gesture: true });
  await waitFor(page, PLAYING, 'the channel from Watch');
  const left = await evaluate(page, `chrome.storage.local.get(${JSON.stringify(key)}).then((got) => got[${JSON.stringify(key)}].length)`);
  const playing = await evaluate(page, NOW_TITLE);
  return { ok: left === 0 && playing === list[0].channel.n, detail: `"${said}"; Watch played ${playing}; reminders left ${left}` };
}

async function update(page) {
  await evaluate(page, `chrome.storage.local.set({ updateReady: '99.0.0' })`);
  await waitFor(page, `!document.getElementById('toast').hidden && document.getElementById('toast-text').textContent.includes('99.0.0')`, 'the update message');
  const said = await evaluate(page, `document.getElementById('toast-text').textContent`);
  await evaluate(page, `document.getElementById('btn-settings').click(); document.getElementById('tab-account').click()`);
  const line = await evaluate(page, `document.getElementById('app-version').textContent`);
  const running = await evaluate(page, `chrome.runtime.getManifest().version`);
  await evaluate(page, `chrome.storage.local.remove('updateReady'); document.getElementById('f-done').click()`);
  return { ok: line === `Kepuli-TV ${running} Update to 99.0.0`, detail: `"${said}"; "${line}"` };
}

/* ------------------------------------------- seeking, full buffers, freezes */

const OVERLAY_TITLE = `(document.getElementById('overlay').hidden ? '' : document.getElementById('overlay-title').textContent)`;

/** Records the overlay's titles and the toasts from now on. */
const watchMessages = (page) => evaluate(page, `(() => { window.__titles = []; window.__toasts = [];
  new MutationObserver(() => window.__titles.push(${OVERLAY_TITLE})).observe(document.getElementById('overlay'), { attributes: true, childList: true, subtree: true });
  new MutationObserver(() => { const t = document.getElementById('toast'); if (!t.hidden) window.__toasts.push(t.textContent.trim()); })
    .observe(document.getElementById('toast'), { attributes: true, childList: true, subtree: true, characterData: true });
  return true; })()`);
const messagesSeen = async (page) => ({
  titles: [...new Set(await evaluate(page, 'window.__titles'))].filter(Boolean),
  toasts: [...new Set(await evaluate(page, 'window.__toasts'))],
});

/** Every Range the page asks the media for, with the answer's status, in window.__ranges. */
const recordRanges = (page) => evaluate(page, `(() => { window.__ranges = []; const orig = window.fetch.bind(window);
  window.fetch = async (url, init) => { const range = init && init.headers && init.headers.Range;
    try { const res = await orig(url, init); if (range) window.__ranges.push(range + ' ' + res.status); return res; }
    catch (err) { if (range) window.__ranges.push(range + ' ' + err.name); throw err; } };
  return true; })()`);

/**
 * #7 and #8 together, as a viewer meets them: one connection on the
 * account, the server counting a closed stream for four seconds, and a seek
 * outside the buffer. The seek lets the connection go and asks at once for
 * the seek table, then for the download from the target's cluster; both
 * are refused while the count runs. The seek must arrive by asking again —
 * not end the episode with "the server answered 400", and not give the
 * table up, which would read the file through to the target.
 */
async function seeklag(page) {
  process.env.KEPULI_MOCK_LIMIT = '1';
  try {
    await recordRanges(page);
    await playEpisode(page);
    process.env.KEPULI_MOCK_RELEASE_MS = '4000';
    await watchMessages(page);
    const before = connectionStats();
    const from = await evaluate(page, 'window.__ranges.length');
    const T = 90;
    await evaluate(page, `document.getElementById('video').currentTime = ${T}`);
    let last = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 60000) {
      last = await videoState(page);
      if (last.t > T + 2 && !last.paused) break;
      if (last.overlay && /failed|stopped/i.test(last.overlay)) break;
      await sleep(1000);
    }
    const after = connectionStats();
    const refused = after.refused.length - before.refused.length;
    const ranges = (await evaluate(page, 'window.__ranges')).slice(from);
    const { titles, toasts } = await messagesSeen(page);
    const readThrough = ranges.some((r) => /^bytes=0-\s/.test(r));
    const tableLost = toasts.some((m) => /seek table/.test(m));
    const ok = last.t > T + 2 && !last.paused && refused > 0 && !titles.includes('Playback failed') && !readThrough && !tableLost
      && after.overlaps.length === before.overlaps.length;
    return { ok, detail: `${refused} refused; at ${last.t} s after ${((Date.now() - t0) / 1000).toFixed(0)} s; ranges ${ranges.join(', ')}; titles ${JSON.stringify(titles)}; toasts ${JSON.stringify(toasts)}` };
  } finally {
    process.env.KEPULI_MOCK_LIMIT = '';
    process.env.KEPULI_MOCK_RELEASE_MS = '';
  }
}

/**
 * #8 on its own: the seek table cannot be read at all during one seek —
 * every read fails as a dropped network does — so that seek reads the file
 * through, and says why. The next seek must ask for the table again, and
 * jump to the target's cluster rather than read the file from the start.
 */
async function cuesretry(page) {
  await evaluate(page, `(() => { window.__failCues = false; window.__ranges = []; const orig = window.fetch.bind(window);
    window.fetch = async (url, init) => { const range = init && init.headers && init.headers.Range;
      if (range && /^bytes=\\d+-\\d+$/.test(range) && window.__failCues) { window.__ranges.push(range + ' failed'); throw new TypeError('Failed to fetch'); }
      const res = await orig(url, init); if (range) window.__ranges.push(range + ' ' + res.status); return res; };
    return true; })()`);
  await playEpisode(page);
  await watchMessages(page);
  await evaluate(page, `window.__failCues = true; document.getElementById('video').currentTime = 90`);
  await waitFor(page, `window.__toasts.some((m) => /seek table/.test(m))`, 'the notice that the table could not be read', 40000);
  const failed = (await evaluate(page, 'window.__ranges')).filter((r) => r.endsWith('failed')).length;
  await evaluate(page, `window.__failCues = false`);
  const from = await evaluate(page, 'window.__ranges.length');
  const T = 10;
  await evaluate(page, `document.getElementById('video').currentTime = ${T}`);
  let last = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 40000) {
    last = await videoState(page);
    if (last.t > T + 2 && !last.paused) break;
    await sleep(1000);
  }
  const ranges = (await evaluate(page, 'window.__ranges')).slice(from);
  const { toasts } = await messagesSeen(page);
  const table = ranges.some((r) => /^bytes=\d+-\d+ 206$/.test(r));
  const jumped = ranges.some((r) => /^bytes=[1-9]\d*- 206$/.test(r)) && !ranges.some((r) => /^bytes=0-/.test(r));
  const ok = failed > 1 && table && jumped && last.t > T + 2 && !last.paused && !toasts.some((m) => /has no seek table/.test(m));
  return { ok, detail: `${failed} failed table reads in the first seek; the second seek asked ${ranges.join(', ')} and is at ${last.t} s; toasts ${JSON.stringify(toasts)}` };
}

/**
 * #9: the buffer is full long before the minute the download aims for, as
 * a 1080p remux fills Chrome's 150 MB. The page's own SourceBuffer is made
 * to throw QuotaExceededError once it holds 25 seconds, as the browser
 * throws it. Playback must wait for room and reach the end of the episode,
 * rather than stop with "SourceBuffer rejected the segment".
 */
async function quota(page) {
  await evaluate(page, `(() => { window.__quota = 0; const orig = SourceBuffer.prototype.appendBuffer;
    SourceBuffer.prototype.appendBuffer = function (data) {
      const b = this.buffered; let held = 0;
      for (let i = 0; i < b.length; i++) held += b.end(i) - b.start(i);
      if (held > 25) { window.__quota++; throw new DOMException('The SourceBuffer is full, and cannot free space to append additional buffers.', 'QuotaExceededError'); }
      return orig.call(this, data); };
    return true; })()`);
  await playEpisode(page);
  await watchMessages(page);
  await evaluate(page, `document.getElementById('video').playbackRate = 4`);
  let last = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    last = await videoState(page);
    if (last.t > 110 || last.overlay) break;
    await sleep(1000);
  }
  const full = await evaluate(page, 'window.__quota');
  const { titles } = await messagesSeen(page);
  const held = await evaluate(page, `(() => { const b = document.getElementById('video').buffered; let h = 0; for (let i = 0; i < b.length; i++) h += b.end(i) - b.start(i); return Math.round(h); })()`);
  const ok = full > 0 && last.t > 110 && !titles.includes('Playback failed');
  return { ok, detail: `${full} full-buffer refusals; reached ${last.t} s in ${((Date.now() - t0) / 1000).toFixed(0)} s holding ${held} s; titles ${JSON.stringify(titles)}` };
}

/**
 * #22: an archive programme whose server stops sending and keeps the
 * connection open, which raises nothing in mpegts.js. Paused by the viewer
 * meanwhile, nothing may be said; played on, the picture runs out the
 * buffer and stops, and the player must say so — with the external
 * player on offer and the row's ↻, which plays the programme again from
 * where it stopped — rather than leave a still picture.
 */
async function catchupfreeze(page, { requests }) {
  process.env.KEPULI_MOCK_HANG_AT = String(3 * 1024 * 1024);
  try {
    await startCatchup(page);
    await watchMessages(page);
    await evaluate(page, `document.getElementById('video').pause()`);
    await sleep(40000);
    const paused = await videoState(page);
    if (paused.overlay) return { ok: false, detail: `paused, the player said "${paused.overlay}"` };
    await evaluate(page, `document.getElementById('video').play()`, { gesture: true });
    const t0 = Date.now();
    await waitFor(page, `${OVERLAY_TITLE} === 'Playback failed'`, 'the frozen picture reported', 90000);
    const said = await videoState(page);
    const took = ((Date.now() - t0) / 1000).toFixed(0);
    if (!/froze/.test(said.overlay) || !said.actions.includes('Open in an external player')) return { ok: false, detail: `after ${took} s: "${said.overlay}" ${said.actions.join(' / ')}` };
    const archive = requests.filter((r) => r.startsWith('/timeshift/')).length;
    await evaluate(page, `document.getElementById('btn-reload').click()`, { gesture: true });
    await waitFor(page, PLAYING, 'the programme after ↻', 40000);
    const again = requests.filter((r) => r.startsWith('/timeshift/')).length - archive;
    return { ok: again > 0, detail: `no word while paused 40 s; played on, "${said.overlay}" after ${took} s, with ${said.actions.join(' / ')}; ↻ asked the archive ${again} time(s) and plays` };
  } finally {
    process.env.KEPULI_MOCK_HANG_AT = '';
  }
}

/**
 * #22 as the audit found it: an archive programme is read without
 * mpegts.js's lazy load, faster than it plays, and the buffer fills. The
 * page's SourceBuffer is made full at 20 seconds, as Chrome's is at some
 * 150 MB; mpegts.js then suspends its reading, and nothing resumes it. The
 * picture must not be left still without a word.
 */
async function catchupfull(page) {
  await evaluate(page, `(() => { window.__quota = 0; const orig = SourceBuffer.prototype.appendBuffer;
    SourceBuffer.prototype.appendBuffer = function (data) {
      const b = this.buffered; let held = 0;
      for (let i = 0; i < b.length; i++) held += b.end(i) - b.start(i);
      if (held > 20) { window.__quota++; throw new DOMException('The SourceBuffer is full, and cannot free space to append additional buffers.', 'QuotaExceededError'); }
      return orig.call(this, data); };
    return true; })()`);
  await startCatchup(page);
  await watchMessages(page);
  const t0 = Date.now();
  let last = null;
  let frozeAt = null;
  while (Date.now() - t0 < 100000) {
    last = await videoState(page);
    if (last.overlay && /Playback stopped/.test(last.overlay)) break;
    if (frozeAt == null && last.t > 0 && last.readyState < 3) frozeAt = last.t;
    await sleep(1000);
  }
  const full = await evaluate(page, 'window.__quota');
  const ok = Boolean(full && last.overlay && /froze/.test(last.overlay) && last.actions.includes('Open in an external player'));
  return { ok, detail: `${full} full-buffer refusals; picture stopped near ${frozeAt ?? last.t} s; after ${((Date.now() - t0) / 1000).toFixed(0)} s: ${last.overlay ? `"${last.overlay}" ${last.actions.join(' / ')}` : 'no word'}` };
}

/* ------------------------------------------------------ several open tabs */

// A second player in a frame of the page: modules of its own, the same
// storage, the same BroadcastChannel — another tab, as far as the player
// can tell, and one that the Firefox driver can reach as well.
const FRAME = `document.getElementById('second-player')`;
const inFrame = (expression) => `((document) => ${expression})(${FRAME}.contentDocument)`;

async function openSecondPlayer(page, target) {
  await evaluate(page, `(() => { const f = document.createElement('iframe'); f.id = 'second-player'; f.src = ${JSON.stringify(bare(target.url))};
    f.style.cssText = 'position:fixed;left:0;top:0;width:1280px;height:800px;border:0;z-index:-1;'; document.body.appendChild(f); return true; })()`);
  await waitFor(page, `(() => { const d = ${FRAME} && ${FRAME}.contentDocument; return Boolean(d && d.querySelectorAll('#groups .group').length > 1 && d.getElementById('list-progress').hidden); })()`, 'the second player');
}

const starRow = (page, index, frame = false) => evaluate(page, (frame ? inFrame : (e) => e)(`(() => {
  document.querySelector('#tabs [data-tab="live"]').click();
  return new Promise((resolve) => { const t0 = Date.now(); (function poll() {
    const row = document.querySelectorAll('#list .row')[${index}];
    if (row && row.querySelector('button')) { row.querySelector('button').click(); resolve(true); }
    else if (Date.now() - t0 > 10000) resolve(false); else setTimeout(poll, 200); })(); }); })()`));

const favRows = async (page, frame = false) => {
  await evaluate(page, (frame ? inFrame : (e) => e)(`document.querySelector('#tabs [data-tab="fav"]').click()`));
  await sleep(600);
  return evaluate(page, (frame ? inFrame : (e) => e)(`document.querySelectorAll('#list .row').length`));
};

const storedKey = (page, key) => evaluate(page, `chrome.storage.local.get(${JSON.stringify(key)}).then((got) => got[${JSON.stringify(key)}] ?? null)`);

/**
 * Two players open on one account: a favourite added in one survives a
 * change in the other, and each shows the other's. Then the other switches
 * the stored account: this one says so, keeps its own, writes nothing into
 * the new account's lists — not with a favourite, not with a change of the
 * playback mode — and follows only when asked.
 */
async function twotabs(page, { target }) {
  const OTHER_PORT = MOCK_PORT + 1;
  const other = await startMockServer(OTHER_PORT);
  const otherRequests = [];
  other.on('request', (req) => otherRequests.push(req.url));
  const here = `favorites:http://127.0.0.1:${MOCK_PORT}/demo`;
  const there = `favorites:http://127.0.0.1:${OTHER_PORT}/demo`;
  try {
    await openSecondPlayer(page, target);
    if (!await starRow(page, 0, true)) throw new Error('the second player has no channel to star');
    await sleep(400);
    if (!await starRow(page, 1)) throw new Error('no channel to star');
    await sleep(600);
    const stored = (await storedKey(page, here) || []).length;
    const shownHere = await favRows(page);
    const shownThere = await favRows(page, true);
    if (stored !== 2 || shownHere !== 2 || shownThere !== 2) {
      return { ok: false, detail: `favourites from two tabs: ${stored} stored, ${shownHere} shown here, ${shownThere} in the other tab` };
    }

    // The other tab saves another account.
    await evaluate(page, `chrome.storage.local.get('config').then((got) => chrome.storage.local.set({ config: { ...got.config, port: '${OTHER_PORT}' } }))`);
    await waitFor(page, `!document.getElementById('toast').hidden && /Another tab/.test(document.getElementById('toast-text').textContent)`, 'word of the other tab\'s switch', 5000);
    const said = await evaluate(page, `document.getElementById('toast-text').textContent`);
    if (!await starRow(page, 2)) throw new Error('no third channel to star');
    await evaluate(page, `(() => { const m = document.getElementById('mode'); m.value = m.value === 'auto' ? 'hls' : 'auto'; m.dispatchEvent(new Event('change')); return true; })()`);
    await sleep(800);
    const after = { here: (await storedKey(page, here) || []).length, there: await storedKey(page, there), port: (await storedKey(page, 'config')).port };
    if (after.here !== 3 || after.there !== null || after.port !== String(OTHER_PORT)) {
      return { ok: false, detail: `after the other tab's switch: ${after.here} favourites on this account, ${JSON.stringify(after.there)} on the other's, stored port ${after.port}` };
    }
    const offered = await evaluate(page, `(() => { const b = document.querySelector('#toast .toast-action'); if (!b || document.getElementById('toast').hidden) return false; b.click(); return true; })()`, { gesture: true });
    if (!offered) return { ok: false, detail: `"${said}" no longer offers to follow` };
    await sleep(500);
    await waitFor(page, CONNECTED, 'the connection on the other account');
    const followed = await favRows(page);
    const asked = otherRequests.some((u) => u.includes('player_api'));
    return {
      ok: followed === 0 && asked,
      detail: `two tabs: 2 favourites kept and shown in both; "${said}"; this tab then wrote 3 to its own account and none to the other's; following showed ${followed} favourites${asked ? ' from the other server' : ' but never asked the other server'}`,
    };
  } finally {
    await evaluate(page, `${FRAME} && ${FRAME}.remove()`).catch(() => {});
    other.closeAllConnections();
    await new Promise((resolve) => other.close(resolve));
  }
}

/** Another account saved in Settings while a channel plays: the stream stops before the new account connects. */
async function switchstop(page) {
  const OTHER_PORT = MOCK_PORT + 1;
  const other = await startMockServer(OTHER_PORT);
  try {
    await playFirstChannel(page);
    const channel = await evaluate(page, NOW_TITLE);
    await evaluate(page, `chrome.permissions.request = async () => true; document.getElementById('btn-settings').click()`, { gesture: true });
    await waitFor(page, `document.getElementById('setup').open`, 'the settings dialog', 5000);
    await evaluate(page, `(() => { const c = document.getElementById('f-port'); c.value = '${OTHER_PORT}'; c.dispatchEvent(new Event('input', { bubbles: true })); c.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await evaluate(page, `document.getElementById('f-save').click()`, { gesture: true });
    await waitFor(page, `!document.getElementById('setup').open`, 'the saved settings', 10000);
    await waitFor(page, CONNECTED, 'the other account');
    await sleep(1500);
    const st = await evaluate(page, `({ title: ${NOW_TITLE}, playing: ${PLAYING}, src: Boolean(document.getElementById('video').currentSrc) && !document.getElementById('video').paused })`);
    const recents = await storedKey(page, `recents:http://127.0.0.1:${OTHER_PORT}/demo`);
    const ok = !st.title && !st.playing && !st.src && !(recents || []).some((r) => r.n === channel);
    const detail = `"${channel}" playing, account saved: title "${st.title}", ${st.playing ? 'still playing' : 'stopped'}; the new account's history ${JSON.stringify((recents || []).map((r) => r.n))}`;
    if (!ok) return { ok, detail };
    // The same user name at a new address: the old address's lists are
    // offered, and brought over only when asked.
    const offer = await evaluate(page, `document.getElementById('toast').hidden ? '' : document.getElementById('toast-text').textContent`);
    if (!/stayed with the old address/.test(offer)) return { ok: false, detail: `${detail}; no offer of the old lists, toast "${offer}"` };
    await evaluate(page, `document.querySelector('#toast .toast-action').click()`, { gesture: true });
    await sleep(800);
    const brought = await storedKey(page, `recents:http://127.0.0.1:${OTHER_PORT}/demo`);
    const kept = await storedKey(page, `recents:http://127.0.0.1:${MOCK_PORT}/demo`);
    const copied = (brought || []).some((r) => r.n === channel) && (kept || []).some((r) => r.n === channel);
    return { ok: copied, detail: `${detail}; "${offer}" brought ${JSON.stringify((brought || []).map((r) => r.n))} over, the old address keeping ${JSON.stringify((kept || []).map((r) => r.n))}` };
  } finally {
    other.closeAllConnections();
    await new Promise((resolve) => other.close(resolve));
  }
}

/**
 * Reset everything with another player tab open, connected and holding the
 * cache: both start again empty, and the one reset connects again once
 * given an account, its cache opening rather than waiting on the other tab.
 * A real second tab: a frame would be reloaded with the page. Chrome only —
 * the Firefox driver holds one tab.
 */
async function resettabs(page, { target }) {
  if (!DEVTOOLS_PORT) return { ok: true, detail: 'skipped in Firefox: needs a second browser tab, which the Marionette driver does not open' };
  const opened = await fetch(`http://127.0.0.1:${DEVTOOLS_PORT}/json/new?${bare(target.url)}`, { method: 'PUT' }).then((r) => r.json());
  const second = session(opened.webSocketDebuggerUrl);
  try {
    await waitFor(second, CONNECTED, 'the second tab');
    // Something the second tab would write back if it went on running.
    await starRow(second, 0);
    await sleep(500);
    await evaluate(page, `document.getElementById('btn-settings').click()`, { gesture: true });
    await waitFor(page, `document.getElementById('setup').open`, 'the settings dialog', 5000);
    await evaluate(page, `document.querySelector('#setup-tabs [data-panel="account"]').click()`);
    await evaluate(page, `document.getElementById('f-reset').click()`, { gesture: true });
    await evaluate(page, `document.getElementById('f-reset').click()`, { gesture: true });
    await sleep(1500);
    await waitFor(page, `document.getElementById('setup').open && document.readyState === 'complete'`, 'the first-run dialog after the reset', 15000);
    await waitFor(second, `document.getElementById('setup').open && document.readyState === 'complete'`, 'the second tab starting again', 15000);
    await sleep(1000);
    const left = await evaluate(page, `chrome.storage.local.get(null).then((all) => Object.keys(all).filter((k) => /^(config|favorites|recents|resume|channels|reminders)/.test(k)))`);
    await evaluate(page, `chrome.storage.local.set({
      config: { scheme: 'http', host: '127.0.0.1', port: '${MOCK_PORT}', username: 'demo', password: 'demo', sourceMode: 'xtream', streamMode: 'auto' },
      settings: { lang: 'en', epgEnabled: true, resumeEnabled: false, subtitleLang: 'eng' } })`);
    const t0 = Date.now();
    await page.call('Page.navigate', { url: bare(target.url) });
    await sleep(500);
    await waitFor(page, CONNECTED, 'the connection after the reset');
    const took = Date.now() - t0;
    const cached = await evaluate(page, `new Promise((resolve) => { const req = indexedDB.open('kepuli-tv'); req.onsuccess = () => { const db = req.result;
      const keys = db.objectStoreNames.contains('cache') ? db.transaction('cache').objectStore('cache').getAllKeys() : null;
      if (!keys) { db.close(); resolve({ version: db.version, rows: 0 }); return; }
      keys.onsuccess = () => { db.close(); resolve({ version: db.version, rows: keys.result.length }); }; }; req.onerror = () => resolve(null); })`);
    const ok = !left.length && cached && cached.rows > 0;
    return { ok, detail: `both tabs started again; left behind ${JSON.stringify(left)}; connected again in ${(took / 1000).toFixed(1)} s with the cache at version ${cached?.version}, ${cached?.rows} rows` };
  } finally {
    second.close();
    await fetch(`http://127.0.0.1:${DEVTOOLS_PORT}/json/close/${opened.id}`).catch(() => {});
  }
}


/* --------------------------------------------- M3U accounts and sync */

const M3U_ACCOUNT = { type: 'm3u', url: `http://127.0.0.1:${MOCK_PORT}/playlist.m3u`, epgUrl: '', name: 'Demo playlist', id: 'pm3u', sourceMode: 'm3u', streamMode: 'auto' };
const XTREAM_ACCOUNT = { type: 'xtream', scheme: 'http', host: '127.0.0.1', port: String(MOCK_PORT), username: 'demo', password: 'demo', name: 'Demo server', id: 'pxt', sourceMode: 'xtream', streamMode: 'auto' };

/**
 * The mock's catalogue as an M3U playlist with its gzipped XMLTV guide: the
 * channels with their programmes from the guide, a channel playing from its
 * own address, start-over through the playlist's catch-up (catchup="xc"),
 * a series of its episodes, and the switch to the Xtream account from the
 * account menu and back.
 */
async function m3u(page, { target, requests }) {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  await evaluate(page, `chrome.storage.local.set({ config: ${JSON.stringify(M3U_ACCOUNT)}, accounts: ${JSON.stringify([M3U_ACCOUNT, XTREAM_ACCOUNT])}, ui: { tab: 'live' } })`);
  // Only what the playlist account asks counts: the fresh player before it
  // connected to the Xtream account.
  requests.length = 0;
  await page.call('Page.navigate', { url: bare(target.url) });
  await sleep(1000);
  await waitFor(page, CONNECTED, 'the playlist');
  assert(requests.includes('/playlist.m3u'), 'the playlist was not fetched');
  assert(!requests.some((r) => r.startsWith('/player_api.php')), 'a playlist account asked the Xtream API');
  await openLiveList(page, 2);
  // A programme line under a row: the guide was read and matched.
  await waitFor(page, `[...document.querySelectorAll('#list .row')].some((r) => /\\d{1,2}[.:]\\d{2}/.test(r.textContent))`, 'a programme from the guide', 20000);
  assert(requests.includes('/guide.xml.gz'), 'the guide the playlist names was not fetched');
  await evaluate(page, `(async () => {
    const names = [...document.querySelectorAll('#list .row-name')];
    const text = await (await fetch('${M3U_ACCOUNT.url}')).text();
    const archived = new Set([...text.matchAll(/catchup-days="\\d+",(.+)/g)].map((m) => m[1].trim()));
    const row = names.find((n) => archived.has(n.title));
    if (!row) throw new Error('no archived channel in view');
    row.closest('.row').click();
  })()`, { gesture: true });
  await waitFor(page, PLAYING, 'a playlist channel');
  assert(requests.some((r) => /^\/live\/demo\/demo\/\d+\.m3u8/.test(r)), 'the channel did not play from its playlist address');
  await evaluate(page, `document.getElementById('btn-guide').click()`);
  await waitFor(page, `[...document.querySelectorAll('#epgv-actions button')].some(b=>b.textContent==='Start from beginning')`, 'start-over action');
  await click(page, '#epgv-actions', 'Start from beginning', { gesture: true });
  await waitFor(page, PLAYING, 'start-over playback');
  assert(requests.some((r) => /^\/timeshift\/demo\/demo\/\d+\/\d{4}-\d\d-\d\d:\d\d-\d\d\/\d+\.ts$/.test(r)), 'start over did not build the xc archive address');
  await evaluate(page, `document.querySelector('#epg-back, [data-guide-back], #guide-back')?.click()`);
  await evaluate(page, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await sleep(500);
  await evaluate(page, `document.querySelector('#tabs [data-tab="series"]').click()`);
  await click(page, '#groups', 'Nordic Noir');
  await click(page, '#list', 'Silent Fjord');
  await waitFor(page, `!document.getElementById('detail').hidden && document.querySelectorAll('#list .row').length > 5`, 'the episodes');
  const episodes = await evaluate(page, `document.querySelectorAll('#list .row').length`);
  // The account menu: shown with two accounts, and a click switches.
  const picked = (name) => `(() => { const s = document.getElementById('account-pick'); return s.options[s.selectedIndex]?.text === '${name}'; })()`;
  assert(await evaluate(page, `!document.getElementById('account-switch').hidden && ${picked('Demo playlist')}`), 'the account switch is not there');
  // The app's own drop-down opens on a press of the select.
  await evaluate(page, `document.getElementById('account-pick').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))`, { gesture: true });
  await evaluate(page, `[...document.querySelectorAll('.picker-pop .picker-option')].find((li) => li.textContent === 'Demo server').click()`, { gesture: true });
  // The select shows the choice at once; the switch is done when the
  // stored account is the other one and its server has been asked.
  await waitFor(page, `${picked('Demo server')} && chrome.storage.local.get('config').then((d) => d.config.id === 'pxt')`, 'the Xtream account');
  for (let i = 0; i < 40 && !requests.some((r) => r.startsWith('/player_api.php')); i++) await sleep(250);
  await waitFor(page, CONNECTED, 'the Xtream account connected');
  assert(requests.some((r) => r.startsWith('/player_api.php')), 'the switch did not reach the Xtream account');
  const config = await evaluate(page, `chrome.storage.local.get('config').then((d) => d.config.id)`);
  assert(config === 'pxt', `the stored account in use is ${config}`);
  return { ok: true, detail: `playlist and gzipped guide read, programmes in the list, a channel played from its address, start over through catchup="xc", ${episodes} episodes, switched to the Xtream account` };
}

/**
 * Sync: turned on in Settings, it writes the accounts, settings and
 * favourites to storage.sync without the password; a "new computer" — the
 * local storage emptied, the sync kept — gets them back, takes the account
 * that can connect, and keeps the password it is told nothing about.
 */
async function sync(page, { target }) {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  if (!(await evaluate(page, `Boolean(chrome.storage.sync)`))) return { ok: true, detail: 'no storage.sync in this browser' };
  const favKey = `favorites:m3u:${M3U_ACCOUNT.url}`;
  // A playlist whose address carries credentials stays home without
  // "Include passwords", and its lists with it.
  const secret = { type: 'm3u', url: `http://127.0.0.1:${MOCK_PORT}/get.m3u?username=demo&password=secret`, id: 'psecret', sourceMode: 'm3u' };
  await evaluate(page, `chrome.storage.local.set({ config: ${JSON.stringify(XTREAM_ACCOUNT)}, accounts: ${JSON.stringify([XTREAM_ACCOUNT, M3U_ACCOUNT, secret])}, ${JSON.stringify(favKey)}: [{ k: 0, id: 'x1', n: 'Synced favourite', direct: 'http://127.0.0.1/live/demo/demo/1.m3u8' }], ${JSON.stringify('favorites:m3u:' + secret.url)}: [{ k: 0, id: 's1', n: 'Kept home' }] })`);
  await page.call('Page.navigate', { url: bare(target.url) });
  await sleep(1000);
  await waitFor(page, CONNECTED, 'the connection');
  await evaluate(page, `document.getElementById('btn-settings').click()`, { gesture: true });
  await evaluate(page, `document.querySelector('.setup-tabs [data-panel=account]').click()`, { gesture: true });
  await evaluate(page, `document.getElementById('f-sync').click()`, { gesture: true });
  await waitFor(page, `chrome.storage.sync.get(null).then((d) => Object.values(d).filter((v) => v && v.n).length >= 3)`, 'the records in storage.sync', 20000);
  const names = await evaluate(page, `chrome.storage.sync.get(null).then((d) => Object.values(d).filter((v) => v && v.n).map((v) => v.n).sort())`);
  // A list goes up under a hash of its account's key, never the address.
  assert(names.includes('accounts') && names.includes('settings') && names.some((n) => /^favorites:[0-9a-z]+$/.test(n)) && !names.some((n) => n.includes('http')), `the records synced: ${names.join(', ')}`);
  await waitFor(page, `/\\d/.test(document.getElementById('sync-status').textContent)`, 'the sync status line');
  // What 1.5.0 left: a list named by the account's address. The next full
  // sync takes it away.
  await evaluate(page, `chrome.storage.sync.set({ rold1: { n: 'favorites:m3u:http://x/get.php?password=leftover', at: 1, h: 'x', c: 1 }, rold1_0: 'x' })`);
  await evaluate(page, `chrome.storage.local.get('sync').then((d) => chrome.storage.local.set({ sync: { ...d.sync, passwords: true } })).then(() => new Promise((r) => setTimeout(r, 1500))).then(() => chrome.storage.local.get('sync')).then((d) => chrome.storage.local.set({ sync: { ...d.sync, passwords: false } }))`);
  await waitFor(page, `chrome.storage.sync.get(null).then((d) => !JSON.stringify(d).includes('leftover'))`, 'the 1.5.0 leftover removed', 20000);
  const raw = await evaluate(page, `chrome.storage.sync.get(null).then((d) => JSON.stringify(d))`);
  assert(!raw.includes('secret') && !raw.includes('get.m3u'), 'the playlist with credentials in its address went to sync');
  assert(names.filter((n) => n.startsWith('favorites:')).length === 1, `favourites of an account kept home went: ${names.join(', ')}`);
  // A new computer. Emptied from a page that is not the player, which
  // would take the emptying for a reset in another tab and reload.
  const origin = target.url.match(/^(?:chrome|moz)-extension:\/\/[^/]+/)[0];
  await page.call('Page.navigate', { url: `${origin}/css/player.css` });
  await sleep(500);
  await evaluate(page, `chrome.storage.local.clear().then(() => chrome.storage.local.set({ sync: { enabled: true, passwords: false } }))`);
  await page.call('Page.navigate', { url: bare(target.url) });
  await sleep(1000);
  await waitFor(page, `chrome.storage.local.get('accounts').then((d) => (d.accounts || []).length === 2)`, 'the accounts from sync', 20000);
  await waitFor(page, CONNECTED, 'the account that can connect', 30000);
  const after = await evaluate(page, `chrome.storage.local.get(null).then((d) => ({ inUse: d.config && d.config.id, passwords: d.accounts.map((a) => a.password || ''), fav: (d[${JSON.stringify(favKey)}] || []).map((f) => f.n), direct: (d[${JSON.stringify(favKey)}] || []).some((f) => f.direct) }))`);
  assert(after.inUse === 'pm3u', `the new computer uses ${after.inUse}, not the playlist that needs no password`);
  assert(after.passwords.every((p) => !p), 'a password came through sync');
  assert(after.fav.includes('Synced favourite'), 'the favourite did not come through');
  assert(!after.direct, 'a stream address came through sync without "Include passwords"');
  return { ok: true, detail: `synced ${names.length} records without passwords, stream addresses or the playlist with credentials in its address; the new computer took the playlist account and the favourite` };
}


/**
 * A film with a stretch of zeros in it (KEPULI_MOCK_HOLE), as a provider's
 * copy of one was measured to have: the reading goes on past it, the
 * duration stays the file's own rather than the end of the buffer, the
 * picture jumps the hole, and the viewer is told why once it does.
 */
async function holes(page) {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  await evaluate(page, `(() => { window.__toasts = []; const el = document.getElementById('toast'); setInterval(() => { const t = el.hidden ? '' : el.textContent.trim(); if (t && window.__toasts[window.__toasts.length - 1] !== t) window.__toasts.push(t); }, 100); })()`);
  await playEpisode(page, 0);
  try {
    await waitFor(page, `document.getElementById('video').currentTime > 70`, 'the picture past the hole', 90000);
  } catch (err) {
    const v = await evaluate(page, `(() => { const v = document.getElementById('video'); const b = []; for (let i = 0; i < v.buffered.length; i++) b.push(v.buffered.start(i).toFixed(1) + '-' + v.buffered.end(i).toFixed(1)); return { t: v.currentTime, d: v.duration, b: b.join(','), rs: v.readyState, paused: v.paused, ended: v.ended, toasts: window.__toasts }; })()`);
    throw new Error(`${err.message}: ${JSON.stringify(v)}`);
  }
  const st = await evaluate(page, `({ duration: document.getElementById('video').duration, time: document.getElementById('video').currentTime, toasts: window.__toasts })`);
  assert(st.duration > 110, `the duration is ${st.duration}`);
  assert(st.toasts.some((m) => /empty parts/.test(m)), `the viewer was not told: ${JSON.stringify(st.toasts)}`);
  return { ok: true, detail: `duration ${st.duration.toFixed(0)} s kept, at ${st.time.toFixed(0)} s past the hole, told "${st.toasts.find((m) => /empty parts/.test(m))}"` };
}


/**
 * The picks on the empty player's page (js/picks.js): from the favourite
 * and recently watched channels' programme data, a programme watched before
 * first and said so, one on now with its progress, and a click on a later
 * one setting its reminder.
 */
async function picks(page, { target }) {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const key = `http://127.0.0.1:${MOCK_PORT}/demo`;
  const ch = (id, n, epg) => ({ id: String(id), k: 0, n, epgId: epg, logo: `http://127.0.0.1:${MOCK_PORT}/img/logo/${id}.svg` });
  // What Aurora News 24 shows next, so that it can be "watched before".
  const next = await evaluate(page, `fetch('http://127.0.0.1:${MOCK_PORT}/player_api.php?username=demo&password=demo&action=get_short_epg&stream_id=1002&limit=3').then((r) => r.json()).then((d) => (d.epg_listings || []).map((p) => decodeURIComponent(escape(atob(p.title)))))`);
  const later = next.find((title, i) => i > 0);
  const interests = { [later.toLowerCase().replace(/\s*·\s*episode.*$/, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()]: { t: later, n: 2, at: Date.now() - 86400e3 } };
  await evaluate(page, `chrome.storage.local.set({ ui: { tab: 'live' }, ${JSON.stringify('favorites:' + key)}: [${JSON.stringify(ch(1000, 'Aurora One', 'auroraone.demo'))}], ${JSON.stringify('recents:' + key)}: [${JSON.stringify({ ...ch(1002, 'Aurora News 24', 'auroranews24.demo'), watchedAt: Date.now() - 3600e3 })}], ${JSON.stringify('interests:' + key)}: ${JSON.stringify(interests)} })`);
  // The page's clock (js/testclock.js) two minutes into the programme Aurora
  // One shows at the mock's now, so that a programme on now has the ten
  // minutes left a pick needs whatever the time of the run: near the end of
  // a programme, this failed.
  const onNow = await evaluate(page, `fetch('http://127.0.0.1:${MOCK_PORT}/player_api.php?username=demo&password=demo&action=get_short_epg&stream_id=1000&limit=1').then((r) => r.json()).then((d) => Number(d.epg_listings[0].start_timestamp) * 1000)`);
  const pageNow = Math.max(onNow + 2 * 60e3, MOCK_T0 - 15 * 60e3);
  await page.call('Page.navigate', { url: `${bare(target.url)}?testnow=${pageNow}` });
  await sleep(1000);
  await waitFor(page, CONNECTED, 'the connection');
  await evaluate(page, `document.querySelector('dialog[open]')?.close()`);
  await waitFor(page, `document.querySelectorAll('.idle-pick:not([hidden])').length >= 2`, 'the picks', 20000);
  const cards = await evaluate(page, `[...document.querySelectorAll('.idle-pick:not([hidden])')].map((c) => ({ text: c.innerText.replace(/\\n/g, ' | '), on: c.classList.contains('on') }))`);
  assert(cards[0].text.includes(later.replace(/\s*·.*$/, '')) && /Watched before/.test(cards[0].text), `the first pick is not the one watched before: ${JSON.stringify(cards)}`);
  assert(cards.some((c) => c.on && /On now/.test(c.text)), `no pick on now: ${JSON.stringify(cards)}`);
  await evaluate(page, `document.querySelector('.idle-pick:not(.on)').click()`, { gesture: true });
  await waitFor(page, `document.querySelectorAll('.idle-pick.reminded').length === 1`, 'the reminder from a pick');
  // The card is marked as soon as the click lands; the stored list follows a
  // moment later, which on the CI runner was after a single look.
  const stored = `chrome.storage.local.get(${JSON.stringify('reminders:' + key)}).then((d) => (Object.values(d)[0] || []).length)`;
  await waitFor(page, `${stored}.then((n) => n === 1)`, 'the reminder stored', 10000).catch(() => {});
  const reminders = await evaluate(page, stored);
  assert(reminders === 1, `the reminder was not stored: ${reminders}`);
  return { ok: true, detail: `${cards.length} picks, "${cards[0].text}" first; one on now; a click on a later one set its reminder` };
}


/**
 * A server that fails only now and then: the film's header was read
 * earlier and is in the cache, and then the provider's proxy answers 502
 * (measured on a real provider). The failure must name the 502, found by
 * asking the server once more — not ask the account, whose count would
 * hold only our own request, nor blame another viewer.
 */
async function flakyserver(page) {
  const url = await evaluate(page, `fetch('http://127.0.0.1:${MOCK_PORT}/player_api.php?username=demo&password=demo&action=get_vod_streams').then((r) => r.json()).then((list) => {
    const m = list.find((x) => /^Northern Lights/.test(x.name)); return 'http://127.0.0.1:${MOCK_PORT}/movie/demo/demo/' + m.stream_id + '.' + m.container_extension; })`);
  // The header read of an earlier visit, kept as the player keeps it.
  await evaluate(page, `import('./js/probe.js').then((m) => m.probe(${JSON.stringify(url)})).then((info) => info.container)`);
  process.env.KEPULI_MOCK_BAD_GATEWAY = '1';
  try {
    await evaluate(page, `document.querySelector('#tabs [data-tab="movie"]').click()`);
    await click(page, '#groups', 'Nordic');
    const t0 = Date.now();
    await click(page, '#list', 'Northern Lights', { gesture: true });
    let text = '';
    for (let i = 0; i < 160; i++) {
      text = await evaluate(page, `document.getElementById('overlay').hidden ? '' : document.getElementById('overlay-text').textContent`);
      if (/answered with error 502/i.test(text)) break;
      await sleep(250);
    }
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    await sleep(3000);
    const after = await evaluate(page, `document.getElementById('overlay-text').textContent`);
    const ok = /answered with error 502/i.test(after) && !/connection|in use|another device/i.test(after);
    return { ok, detail: `after ${secs} s: "${after}"` };
  } finally {
    process.env.KEPULI_MOCK_BAD_GATEWAY = '';
  }
}


/**
 * Accounts in Settings → Connection: the list above the form is the way
 * between them. "Add account" puts a new row in the list and Cancel takes
 * it out; picking another account shows its details, and saving it keeps
 * the account in use as it is; an incomplete Xtream server says what a
 * playlist without sign-in is entered as.
 */
async function accountform(page, { target }) {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const press = (expr) => evaluate(page, expr, { gesture: true });
  await evaluate(page, `chrome.storage.local.set({ config: ${JSON.stringify(XTREAM_ACCOUNT)}, accounts: ${JSON.stringify([XTREAM_ACCOUNT, M3U_ACCOUNT])} })`);
  await page.call('Page.navigate', { url: bare(target.url) });
  await sleep(1000);
  await waitFor(page, CONNECTED, 'the connection');
  await evaluate(page, `document.querySelector('dialog[open]')?.close()`);
  const rows = () => evaluate(page, `[...document.querySelectorAll('#account-list .account-row')].map((r) => (r.classList.contains('selected') ? '>' : '') + r.querySelector('.account-main b').textContent)`);
  await press(`document.getElementById('btn-settings').click()`);
  await waitFor(page, `document.getElementById('setup').open`, 'the settings');
  assert(JSON.stringify(await rows()) === JSON.stringify(['>Demo server', 'Demo playlist']), `opened: ${JSON.stringify(await rows())}`);
  await press(`document.getElementById('f-add-account').click()`);
  assert((await rows()).join() === 'Demo server,Demo playlist,>New account' && await evaluate(page, `document.getElementById('f-host').value === '' && document.getElementById('f-save').textContent === 'Connect'`), `adding: ${JSON.stringify(await rows())}`);
  await press(`[...document.querySelectorAll('#account-list .account-row')].pop().querySelector('button.ghost').click()`);
  assert((await rows()).join() === '>Demo server,Demo playlist', `cancelled: ${JSON.stringify(await rows())}`);
  await press(`[...document.querySelectorAll('#account-list .account-main')][1].click()`);
  assert(await evaluate(page, `document.getElementById('f-paste').value === ${JSON.stringify(M3U_ACCOUNT.url)}`), 'the other account\'s details are not in the form');
  await evaluate(page, `(() => { const f = document.getElementById('f-name'); f.value = 'Renamed playlist'; f.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await press(`document.getElementById('f-save').click()`);
  await waitFor(page, `chrome.storage.local.get('accounts').then((d) => d.accounts.some((a) => a.name === 'Renamed playlist'))`, 'the other account saved');
  const inUse = await evaluate(page, `chrome.storage.local.get('config').then((d) => d.config.id)`);
  assert(inUse === XTREAM_ACCOUNT.id, `saving another account switched to it: ${inUse}`);
  await press(`document.getElementById('btn-settings').click()`);
  await waitFor(page, `document.getElementById('setup').open`, 'the settings again');
  await press(`document.getElementById('f-add-account').click()`);
  await evaluate(page, `(() => { const f = document.getElementById('f-host'); f.value = 'example.tv'; f.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await press(`document.getElementById('f-save').click()`);
  const error = await evaluate(page, `document.getElementById('setup-error').textContent`);
  assert(/Paste subscription URL \(M3U\)/.test(error), `the incomplete server: "${error}"`);
  return { ok: true, detail: `added and cancelled in the list, the other account edited and saved without a switch; "${error}"` };
}


const STALKER_ACCOUNT = { type: 'stalker', url: `http://127.0.0.1:${MOCK_PORT}/c/`, mac: STALKER_MAC, name: 'Demo portal', id: 'pst', sourceMode: 'stalker', streamMode: 'auto' };

/**
 * A Stalker portal: the MAC address in the cookie and a MAG's User-Agent
 * on every request (the session rule of js/stalker.js — the mock turns
 * away a request without them), the channels and their programmes from
 * the portal, a channel played from the one-time address create_link
 * gives, a film the same way; and the form's check of a MAC address.
 */
async function stalker(page, { target }) {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  process.env.KEPULI_MOCK_LIVE_TS = '1';
  // The rule acts only on a host the extension has access to; a copied
  // profile loses what was granted in the original (Chrome ties the grant
  // to the profile's place), and headless Chrome cannot answer the prompt.
  const access = await evaluate(page, `chrome.permissions.contains({ origins: ['http://127.0.0.1/*'] })`);
  process.env.KEPULI_MOCK_STALKER_LOOSE = access ? '' : '1';
  try {
    stalkerSeen.api = 0; stalkerSeen.refused = 0; stalkerSeen.streams = 0; stalkerSeen.loose = 0;
    await evaluate(page, `chrome.storage.local.set({ config: ${JSON.stringify(STALKER_ACCOUNT)}, accounts: ${JSON.stringify([STALKER_ACCOUNT, XTREAM_ACCOUNT])}, ui: { tab: 'live' } })`);
    await page.call('Page.navigate', { url: bare(target.url) });
    await sleep(1000);
    await waitFor(page, CONNECTED, 'the portal', 30000);
    assert(stalkerSeen.api > 3 && stalkerSeen.refused === 0, `the portal was asked ${stalkerSeen.api} times, ${stalkerSeen.refused} turned away for want of the cookie or the User-Agent`);
    await openLiveList(page, 2);
    await waitFor(page, `[...document.querySelectorAll('#list .row')].some((r) => /\\d{1,2}[.:]\\d{2}/.test(r.textContent))`, 'a programme from the portal', 20000);
    await evaluate(page, `document.querySelectorAll('#list .row')[0].click()`, { gesture: true });
    await waitFor(page, PLAYING, 'a portal channel', 40000);
    assert(stalkerSeen.streams >= 1, 'no stream came through create_link');
    await evaluate(page, `document.querySelector('#tabs [data-tab="movie"]').click()`);
    await click(page, '#groups', 'Nordic');
    await click(page, '#list', 'Northern Lights', { gesture: true });
    await waitFor(page, PLAYING, 'a portal film', 40000);
    // The form: a MAC address that is not one is said so.
    await evaluate(page, `document.getElementById('btn-settings').click()`, { gesture: true });
    await waitFor(page, `document.getElementById('setup').open`, 'the settings');
    assert(await evaluate(page, `!document.getElementById('src-stalker').hidden && document.getElementById('f-mac').value === ${JSON.stringify(STALKER_MAC)}`), 'the portal account\'s form is not shown');
    await evaluate(page, `(() => { const f = document.getElementById('f-mac'); f.value = '00:1A:79'; f.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await evaluate(page, `document.getElementById('f-save').click()`, { gesture: true });
    const error = await evaluate(page, `document.getElementById('setup-error').textContent`);
    assert(/MAC address/.test(error), `a short MAC address: "${error}"`);
    await evaluate(page, `document.getElementById('setup').close()`);
    // Nothing left playing: the film's id is an Xtream film's too in the
    // mock, and a reload brings back what was playing.
    await evaluate(page, `document.getElementById('btn-home').click()`, { gesture: true });
    await sleep(500);
    const headers = access ? 'with the cookie and User-Agent' : `(no host access in this profile: the header rule unchecked, ${stalkerSeen.loose} let in without)`;
    return { ok: true, detail: `${stalkerSeen.api} portal requests ${headers}, programmes in the list, a channel through a one-time link, a film; "${error}"` };
  } finally {
    process.env.KEPULI_MOCK_LIVE_TS = '';
    process.env.KEPULI_MOCK_STALKER_LOOSE = '';
  }
}

/**
 * Recording: the channel on screen recorded on an account that allows one
 * connection — the recording shares the player's (js/streamhub.js), so no
 * second connection is opened — stopped, its file on the disk as many
 * bytes as the list says, played back from there; then a plan from the
 * guide carried out by itself, from start to end, with nothing playing.
 */
async function record(page) {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const list = () => evaluate(page, `chrome.storage.local.get('recordings').then((d) => d.recordings || [])`);
  process.env.KEPULI_MOCK_LIVE_TS = '1';
  process.env.KEPULI_MOCK_LIMIT = '1';
  try {
    await evaluate(page, `chrome.storage.local.remove('recordings')`);
    await openLiveList(page, 2);
    await click(page, '#groups', 'Finland');
    await waitFor(page, `document.querySelectorAll('#list .row').length > 2`, 'the channels');
    await evaluate(page, `document.querySelectorAll('#list .row')[0].click()`, { gesture: true });
    await waitFor(page, PLAYING, 'the channel', 40000);
    // Off until turned on in Settings, and turned on only through the reminder.
    await sleep(500);
    assert(await evaluate(page, `document.getElementById('btn-record').hidden`), 'the Record button shows with recording off');
    await evaluate(page, `document.getElementById('btn-settings').click()`);
    await waitFor(page, `document.getElementById('setup').open`, 'settings');
    await evaluate(page, `document.getElementById('tab-general').click()`);
    await sleep(300);
    await evaluate(page, `document.getElementById('f-record').click()`, { gesture: true });
    await waitFor(page, `document.getElementById('rec-consent').open`, 'the recording reminder');
    assert(await evaluate(page, `!document.getElementById('f-record').checked`), 'ticked before the reminder was answered');
    await evaluate(page, `document.getElementById('rec-consent-cancel').click()`);
    assert(await evaluate(page, `!document.getElementById('rec-consent').open && !document.getElementById('f-record').checked`), 'Cancel left recording on');
    await evaluate(page, `document.getElementById('f-record').click()`, { gesture: true });
    await waitFor(page, `document.getElementById('rec-consent').open`, 'the reminder again');
    await evaluate(page, `document.getElementById('rec-consent-ok').click()`);
    assert(await evaluate(page, `document.getElementById('f-record').checked && !document.getElementById('f-save').disabled`), 'the reminder accepted did not tick the box');
    await evaluate(page, `document.getElementById('f-save').click()`);
    await waitFor(page, `!document.getElementById('setup').open`, 'settings saved');
    await waitFor(page, `chrome.storage.local.get('settings').then((d) => d.settings.recordingEnabled === true)`, 'recording on in the settings');
    const before = connectionStats();
    await waitFor(page, `!document.getElementById('btn-record').hidden`, 'the Record button');
    await evaluate(page, `document.getElementById('btn-record').click()`, { gesture: true });
    await waitFor(page, `chrome.storage.local.get('recordings').then((d) => (d.recordings || []).some((r) => r.state === 'recording'))`, 'the recording under way');
    await sleep(12000);
    assert(await evaluate(page, PLAYING), 'the picture stopped while recording');
    const during = connectionStats();
    assert(during.refused.length === before.refused.length && during.open === 1, `while recording: ${during.open} open, refused ${during.refused.slice(before.refused.length).join(' | ')}`);
    assert(await evaluate(page, `document.getElementById('btn-record').getAttribute('aria-pressed') === 'true' && document.getElementById('btn-recordings').classList.contains('on')`), 'the buttons do not show the recording');
    await evaluate(page, `document.getElementById('btn-record').click()`, { gesture: true });
    await waitFor(page, `chrome.storage.local.get('recordings').then((d) => (d.recordings || []).some((r) => r.state === 'done'))`, 'the recording saved', 20000);
    const [done] = await list();
    assert(done.bytes > 200000, `only ${done.bytes} bytes recorded`);
    const onDisk = await evaluate(page, `(async () => {
      const root = await navigator.storage.getDirectory();
      const dir = await (await root.getDirectoryHandle('recordings')).getDirectoryHandle(${JSON.stringify(done.id)});
      let size = 0, parts = 0, first = null;
      const names = [];
      for await (const [name] of dir.entries()) names.push(name);
      names.sort();
      for (const name of names) { const f = await (await dir.getFileHandle(name)).getFile(); size += f.size; parts++; if (!first) first = new Uint8Array(await f.slice(0, 1).arrayBuffer())[0]; }
      return { size, parts, first };
    })()`);
    assert(onDisk.size === done.bytes && onDisk.first === 0x47, `on the disk ${JSON.stringify(onDisk)}, listed ${done.bytes}`);
    // Played back from the disk.
    await evaluate(page, `document.getElementById('btn-recordings').click()`, { gesture: true });
    await waitFor(page, `document.getElementById('recordings').open && document.querySelectorAll('#recordings-list .choice-row').length === 1`, 'the recordings');
    await evaluate(page, `[...document.querySelectorAll('#recordings-list button')].find((b) => b.textContent === 'Play').click()`, { gesture: true });
    await waitFor(page, `${PLAYING} && document.getElementById('video').currentTime > 2`, 'the recording played back', 30000);
    // A plan, with nothing playing: carried out at its time.
    await evaluate(page, `document.getElementById('btn-home').click()`, { gesture: true });
    await sleep(1500);
    const channel = await evaluate(page, `chrome.storage.local.get('recordings').then((d) => d.recordings[0].channel)`);
    await evaluate(page, `chrome.storage.local.get('recordings').then((d) => {
      const r = d.recordings[0];
      const now = Date.now();
      return chrome.storage.local.set({ recordings: [...d.recordings, { id: 'rplan', key: r.key, account: r.account, channel: ${JSON.stringify(channel)}, title: 'Planned', start: now + 2000, stop: now + 10000, programme: { start: now + 2000, stop: now + 10000 }, state: 'planned', bytes: 0, createdAt: now }] });
    })`);
    await waitFor(page, `chrome.storage.local.get('recordings').then((d) => d.recordings.find((r) => r.id === 'rplan')?.state === 'recording')`, 'the plan started', 15000);
    await waitFor(page, `chrome.storage.local.get('recordings').then((d) => d.recordings.find((r) => r.id === 'rplan')?.state === 'done')`, 'the plan ended', 30000);
    const planned = (await list()).find((r) => r.id === 'rplan');
    assert(planned.bytes > 50000, `the plan recorded ${planned.bytes} bytes`);
    return { ok: true, detail: `${Math.round(done.bytes / 1024)} kB in ${onDisk.parts} part(s) through the player's own connection (1 open, none refused), played back from the disk; a plan recorded ${Math.round(planned.bytes / 1024)} kB by itself` };
  } finally {
    process.env.KEPULI_MOCK_LIVE_TS = '';
    process.env.KEPULI_MOCK_LIMIT = '';
    await evaluate(page, `(async () => {
      const d = await chrome.storage.local.get('recordings');
      const root = await navigator.storage.getDirectory();
      await root.removeEntry('recordings', { recursive: true }).catch(() => {});
      await chrome.storage.local.remove('recordings');
      const got = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: { ...got.settings, recordingEnabled: false } });
    })()`).catch(() => {});
  }
}

/**
 * The films' categories chosen from the bar under the sidebar: the dialog
 * in its own words, the sidebar and All down to the two ticked, kept over
 * a reload; the series and the channels untouched.
 */
async function categories(page) {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const side = () => evaluate(page, `({ groups: [...document.querySelectorAll('#groups .group')].map((g) => g.dataset.id ?? g.textContent.trim()), foot: document.getElementById('btn-countries-text').textContent })`);
  try {
    await evaluate(page, `document.querySelector('#tabs [data-tab="movie"]').click()`);
    await waitFor(page, `document.querySelectorAll('#groups .group').length > 3 && !document.getElementById('btn-countries').hidden`, 'the film categories');
    await evaluate(page, `document.getElementById('btn-countries').click()`, { gesture: true });
    await waitFor(page, `document.getElementById('countries').open`, 'the dialog');
    assert(await evaluate(page, `document.getElementById('countries-title').textContent`) === 'Which categories do you want to see?', 'the dialog speaks of countries');
    await evaluate(page, `[...document.querySelectorAll('#countries-list .choice-row')].filter((r) => ['Drama', 'Nordic'].includes(r.dataset.name)).forEach((r) => r.querySelector('input').click())`);
    await evaluate(page, `document.getElementById('countries-save').click()`);
    await waitFor(page, `!document.getElementById('countries').open && document.querySelectorAll('#groups .group').length === 3`, 'the sidebar down to the two');
    const after = await side();
    assert(after.foot === 'Categories: 2/8', `the bar says ${after.foot}`);
    await page.call('Page.reload');
    await sleep(1000);
    await waitFor(page, CONNECTED, 'the connection after the reload');
    await evaluate(page, `document.querySelector('#tabs [data-tab="movie"]').click()`);
    await waitFor(page, `document.querySelectorAll('#groups .group').length === 3`, 'the choice kept over a reload');
    await evaluate(page, `document.querySelector('#tabs [data-tab="series"]').click()`);
    await waitFor(page, `document.querySelectorAll('#groups .group').length > 3 && document.getElementById('btn-countries-text').textContent === 'Choose categories'`, 'the series untouched');
    return { ok: true, detail: `Drama and Nordic ticked: the sidebar ${JSON.stringify(after.groups)}, "${after.foot}", kept over a reload; the series untouched` };
  } finally {
    await evaluate(page, `chrome.storage.local.get(null).then((d) => Promise.all(Object.keys(d).filter((k) => k.startsWith('channels')).map((k) => chrome.storage.local.set({ [k]: { ...d[k], movieCategories: [], seriesCategories: [] } }))))`).catch(() => {});
  }
}

/**
 * The guide's favourites: two channels starred in the list, the switch in
 * the guide shows those two and nothing else, a third star joins at once,
 * and the choice stays for the next opening; off, the group's channels
 * come back.
 */
async function guidefavs(page) {
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const names = `[...document.querySelectorAll('.epg-chan-name')].map((n) => n.textContent)`;
  await openLiveList(page, 4);
  await click(page, '#groups', 'Finland');
  await waitFor(page, `document.querySelectorAll('#list .row').length > 3`, 'the channels');
  const starred = await evaluate(page, `[0, 2].map((i) => { const row = document.querySelectorAll('#list .row')[i]; row.querySelector('.row-star').click(); return row.querySelector('.row-name').textContent; })`, { gesture: true });
  await click(page, '#groups', 'Sweden');
  await waitFor(page, `document.querySelectorAll('#list .row').length > 1`, 'another country');
  await evaluate(page, `document.getElementById('btn-guide').click()`, { gesture: true });
  await waitFor(page, `document.getElementById('main').classList.contains('guide') && document.querySelectorAll('.epg-chan-name').length > 0`, 'the guide');
  const group = await evaluate(page, names);
  await evaluate(page, `document.getElementById('epg-favs').click()`, { gesture: true });
  await waitFor(page, `document.getElementById('epg-favs').getAttribute('aria-pressed') === 'true' && document.querySelectorAll('.epg-chan-name').length === 2`, 'the favourites alone');
  const favs = await evaluate(page, names);
  assert(JSON.stringify(favs) === JSON.stringify(starred) && await evaluate(page, `document.getElementById('epg-group').disabled`), `favourites in the guide: ${JSON.stringify(favs)}, starred ${JSON.stringify(starred)}`);
  // A star given in the list beside the guide joins at once.
  const third = await evaluate(page, `(() => { const row = document.querySelectorAll('#list .row')[0]; row.querySelector('.row-star').click(); return row.querySelector('.row-name').textContent; })()`, { gesture: true });
  await waitFor(page, `document.querySelectorAll('.epg-chan-name').length === 3`, 'the third favourite');
  // The next opening keeps the choice.
  await evaluate(page, `document.getElementById('epg-close').click()`);
  await evaluate(page, `document.getElementById('btn-guide').click()`, { gesture: true });
  await waitFor(page, `document.getElementById('epg-favs').getAttribute('aria-pressed') === 'true' && document.querySelectorAll('.epg-chan-name').length === 3`, 'the favourites again');
  await evaluate(page, `document.getElementById('epg-favs').click()`, { gesture: true });
  await waitFor(page, `document.getElementById('epg-favs').getAttribute('aria-pressed') === 'false' && !document.getElementById('epg-group').disabled`, 'the switch off');
  const back = await evaluate(page, names);
  assert(back.length === group.length, `off: ${back.length} channels, the group had ${group.length}`);
  return { ok: true, detail: `${group.length} channels of the group, then the favourites ${JSON.stringify(favs)}, ${third} joined at once, kept for the next opening, the group back when off` };
}

/**
 * The credentials never show: not on screen, not in a message, not in the
 * tab's title, not in a tooltip, not in the console — through playback and
 * through the failures whose messages name what went wrong. Xtream puts the
 * user name and password into every stream address, so an error that quotes
 * the address it tried would hand them to anyone looking at the screen.
 */
async function noleak(page) {
  const LEAKS = [`/${USER}/${PASS}/`, `password=${PASS}`, `${USER}:${PASS}@`];
  const seen = [];
  await evaluate(page, `(() => {
    window.__said = [];
    for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
      const real = console[level].bind(console);
      console[level] = (...args) => { try { window.__said.push(args.map((a) => a instanceof Error ? a.stack : typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')); } catch {} real(...args); };
    }
    addEventListener('error', (e) => window.__said.push(String(e.message)));
    addEventListener('unhandledrejection', (e) => window.__said.push(String(e.reason?.stack || e.reason)));
  })()`);
  const look = async (step) => {
    const text = await evaluate(page, `[document.title, document.body.innerText,
      ...[...document.querySelectorAll('[title],[aria-label]')].map((e) => (e.getAttribute('title') || '') + ' ' + (e.getAttribute('aria-label') || '')),
      location.href].join('\\n')`);
    seen.push({ step, text });
  };
  const failing = async (variable, clickRow, step) => {
    process.env[variable] = '1';
    try { await failureAfterClick(page, clickRow, 30000); await sleep(1500); await look(step); }
    finally { process.env[variable] = ''; }
  };
  await playFirstChannel(page);
  await look('a channel playing');
  await failing('KEPULI_MOCK_CHANNEL_REFUSED', clickFirstChannel(page), 'a channel refused');
  await failing('KEPULI_MOCK_BAD_GATEWAY', clickFirstChannel(page), 'a bad gateway');
  await failing('KEPULI_MOCK_REFUSED_FILE', clickFirstEpisode(page), 'an episode refused');
  await evaluate(page, `document.getElementById('btn-settings').click()`);
  await waitFor(page, `document.getElementById('setup').open`, 'settings');
  await evaluate(page, `document.getElementById('tab-account').click()`);
  await sleep(800);
  await look('Settings › Account & data');
  await evaluate(page, `document.getElementById('setup').close()`);
  const said = await evaluate(page, `window.__said.join('\\n')`);
  seen.push({ step: 'the console', text: said });
  const found = seen.flatMap(({ step, text }) => LEAKS.filter((l) => text.includes(l)).map((l) => `${step}: "${l}"`));
  if (found.length) throw new Error(`the credentials showed: ${found.join('; ')}`);
  return { ok: true, detail: `${seen.length} places looked at (screen, title, tooltips, address, console) through playback, three failures and Account & data: no user name and password` };
}

/**
 * A provider-sized catalogue: 50,000 films more in one category. The list
 * of them is fetched and drawn, scrolled from top to bottom, searched, and
 * the page's memory read — each against a bound well above what this
 * machine takes, so that the scenario fails on a regression (a list that
 * stops being virtual, a search that walks the DOM, a leak) rather than on
 * a slow day. The numbers are reported every run.
 */
async function perf(page) {
  const N = 50000;
  const BOUNDS = { listMs: 20000, frameP95Ms: 50, searchMs: 4000, heapMb: 400 };
  const count = `Number((document.getElementById('listinfo').textContent.match(/[\\d,.\\s ]+/) || ['0'])[0].replace(/[^\\d]/g, ''))`;
  process.env.KEPULI_MOCK_BULK = String(N);
  try {
    await evaluate(page, `document.querySelector('#tabs [data-tab="movie"]').click()`);
    await click(page, '#groups', 'Nordic');
    const t0 = Date.now();
    await evaluate(page, `document.getElementById('btn-refresh').click()`);
    await waitFor(page, `${count} >= ${N}`, `the ${N} films in the list`, 60000);
    const listMs = Date.now() - t0;
    await evaluate(page, `document.querySelector('button[aria-label="Show as a list"]')?.click()`);
    await sleep(500);
    // Scrolled through in sixty steps, a frame each; the frames' lengths measured.
    const frames = await evaluate(page, `new Promise((done) => {
      const list = document.getElementById('list');
      const steps = 60, gaps = [];
      let i = 0, last = performance.now();
      const step = (now) => {
        gaps.push(now - last); last = now;
        list.scrollTop = (list.scrollHeight - list.clientHeight) * (i / steps);
        if (++i <= steps) requestAnimationFrame(step); else done(gaps.slice(2));
      };
      requestAnimationFrame(step);
    })`);
    const sorted = [...frames].sort((a, b) => a - b);
    const frameP95Ms = sorted[Math.floor(sorted.length * 0.95)];
    const rowsInDom = await evaluate(page, `document.querySelectorAll('#list .row').length`);
    // A search over the whole catalogue, for a film from its middle, which
    // the list at its top does not show.
    await evaluate(page, `document.getElementById('list').scrollTop = 0`);
    await sleep(300);
    const s0 = Date.now();
    await evaluate(page, `(() => { const s = document.getElementById('search'); s.focus(); s.value = 'Archive Film 25017'; s.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await waitFor(page, `[...document.querySelectorAll('#list .row')].some((r) => r.textContent.includes('Archive Film 25017')) && ${count} < 100`, 'the search result', 30000);
    const searchMs = Date.now() - s0;
    await evaluate(page, `document.getElementById('search-clear')?.click()`);
    const heapMb = await evaluate(page, `performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : 0`);
    const got = { listMs, frameP95Ms: Math.round(frameP95Ms), searchMs, heapMb, rowsInDom };
    const over = Object.entries(BOUNDS).filter(([k, bound]) => got[k] > bound).map(([k, bound]) => `${k} ${got[k]} > ${bound}`);
    if (rowsInDom > 400) over.push(`${rowsInDom} rows in the DOM: the list is not virtual any more`);
    if (over.length) throw new Error(`over the bounds: ${over.join('; ')}`);
    return { ok: true, detail: `${N} films more: list ${listMs} ms, scroll p95 frame ${got.frameP95Ms} ms (${frames.length} frames, ${rowsInDom} rows in the DOM), search ${searchMs} ms, heap ${heapMb} MB` };
  } finally {
    process.env.KEPULI_MOCK_BULK = '';
    await evaluate(page, `document.getElementById('btn-refresh').click()`).catch(() => {});
  }
}

/**
 * Text that does not fit, found before a translator does. The player is
 * opened as player.html?pseudo=1 (js/i18n.js), where every string is
 * accented and about 40 % longer, and the main views are walked: the start
 * page, the channel list, the films' covers, a series, the programme guide,
 * every Settings panel, Choose countries and Help. In each, every visible box
 * that holds text of its own (buttons, tabs, chips, list rows, labels, dialog
 * fields) is measured, and one whose text is wider than the box fails the
 * scenario, unless the box is meant to cut its text with an ellipsis or to
 * scroll. A select and a text field are measured by their chosen option and
 * placeholder, which their scrollWidth does not tell.
 *
 * The failure lists every box by view and place, with the width the text
 * needs and the width it has. KEPULI_OVERFLOW_LANG=fi walks the same views
 * in a real language instead, to tell whether an overflow the pseudo text
 * finds happens there too; KEPULI_PSEUDO_SHOTS=<dir> keeps a picture of
 * each view.
 */

const MEASURE_OVERFLOW = `(() => {
  const canvas = document.createElement('canvas').getContext('2d');
  const textWidth = (el, text) => { const s = getComputedStyle(el); canvas.font = s.font; return canvas.measureText(text).width; };
  const place = (el) => {
    const parts = [];
    for (let n = el; n && n !== document.body && parts.length < 3; n = n.parentElement) {
      parts.unshift(n.id ? '#' + n.id : n.tagName.toLowerCase() + (n.classList.length ? '.' + [...n.classList].join('.') : ''));
      if (n.id) break;
    }
    return parts.join(' > ');
  };
  const visible = (el) => {
    if (!el.getClientRects().length) return false;
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'contents') return false;
    // Behind a modal dialog nothing can be read; only the dialog counts.
    const modal = [...document.querySelectorAll('dialog[open]')].pop();
    return !modal || modal.contains(el);
  };
  const ownText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  const meantToCut = (el) => {
    const s = getComputedStyle(el);
    return s.textOverflow === 'ellipsis' || /auto|scroll/.test(s.overflowX) || s.webkitLineClamp !== 'none';
  };
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    if (/^(SCRIPT|STYLE|SVG|svg|PATH|path|VIDEO|CANVAS|OPTION|BR)$/.test(el.tagName) || !visible(el)) continue;
    const s = getComputedStyle(el);
    if (s.display === 'inline') continue;
    let need = 0, have = el.clientWidth, text = '';
    if (el.tagName === 'SELECT') {
      const o = el.selectedOptions[0]; if (!o) continue;
      text = o.textContent;
      // The app's selects draw their arrow in their right padding; a native
      // one takes about 20 px of the box for it.
      need = textWidth(el, text);
      have = el.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight) - (s.appearance === 'none' ? 0 : 20);
    } else if (el.tagName === 'INPUT' && el.placeholder && !el.value && /^(text|search|url|password|)$/.test(el.type)) {
      // A field's hint may end in an ellipsis where it is longer than the
      // field (player.css sets text-overflow on inputs); the hint is a hint.
      if (meantToCut(el)) continue;
      text = el.placeholder;
      need = textWidth(el, text);
      have = el.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
    } else if (ownText(el) || el.matches('button, [role=tab], .row, .chip')) {
      if (meantToCut(el)) continue;
      text = el.textContent.trim();
      if (!text) continue;
      need = el.scrollWidth; have = el.clientWidth;
    } else continue;
    // Visually hidden live regions (1 px, clipped) are for screen readers.
    if (el.offsetWidth <= 2 || el.offsetHeight <= 2) continue;
    if (have > 0 && need > have + 1) out.push({ place: place(el), text: text.replace(/\\s+/g, ' ').slice(0, 60), need: Math.round(need), have: Math.round(have) });
  }
  return out;
})()`;

async function pseudo(page, { target }) {
  // The test Chrome lives on between runs, and its tab with whatever
  // address the last scenario left: the parameter is set on the bare page and
  // taken off again at the end, so that no later scenario runs pseudo.
  const plain = bare(target.url).split('?')[0];
  try {
    return await pseudoViews(page, plain);
  } finally {
    await page.call('Page.navigate', { url: plain }).catch(() => {});
    await sleep(500);
  }
}

async function pseudoViews(page, plain) {
  // KEPULI_OVERFLOW_LANG=fi (or de, hu…): the same walk in a real language
  // instead of the pseudo text, to see whether what the pseudo text finds
  // happens there too. ?pseudo=0 is inert; it only tells the new page from
  // the old one.
  const lang = process.env.KEPULI_OVERFLOW_LANG;
  const query = lang ? '?pseudo=0' : '?pseudo=1';
  if (lang) await evaluate(page, `chrome.storage.local.get('settings').then(({ settings }) => chrome.storage.local.set({ settings: { ...settings, lang: ${JSON.stringify(lang)} } }))`);
  await page.call('Page.navigate', { url: `${plain}${query}` });
  await sleep(1000);
  // The old page is connected too until the new one has replaced it.
  await waitFor(page, `location.search === '${query}' && ${CONNECTED}`, 'the connection');
  await evaluate(page, `document.querySelector('dialog[open]')?.close()`);
  if (lang) await waitFor(page, `document.documentElement.lang.startsWith(${JSON.stringify(lang)})`, `the language ${lang}`, 5000);
  else await waitFor(page, `document.getElementById('tab-live').textContent.trim().startsWith('[')`, 'pseudo-localised tabs', 5000);
  const seen = [], views = [];
  const look = async (view) => {
    views.push(view);
    await sleep(600);
    for (const o of await evaluate(page, MEASURE_OVERFLOW)) seen.push({ view, ...o });
    // KEPULI_PSEUDO_SHOTS=<dir>: a picture of every view, to look at what the
    // measuring cannot judge (text wrapped onto a line too many, cut at the top).
    if (process.env.KEPULI_PSEUDO_SHOTS) {
      const fs = await import('node:fs');
      fs.mkdirSync(process.env.KEPULI_PSEUDO_SHOTS, { recursive: true });
      const { data } = await page.call('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(`${process.env.KEPULI_PSEUDO_SHOTS}/${view.replace(/[^\w]+/g, '-')}.png`, Buffer.from(data, 'base64'));
    }
  };
  await look('start page');
  await openLiveList(page, 3);
  await look('channels');
  await evaluate(page, `document.querySelector('#tabs [data-tab="movie"]').click()`);
  await waitFor(page, `document.querySelectorAll('#list .row, #list .cover, #list [role=option]').length > 0`, 'the films');
  await look('films');
  await evaluate(page, `document.querySelector('#tabs [data-tab="series"]').click()`);
  await click(page, '#groups', 'Nordic Noir');
  await click(page, '#list', 'Silent Fjord');
  await look('a series');
  await openLiveList(page, 3);
  await evaluate(page, `document.getElementById('btn-guide').click()`);
  await waitFor(page, `document.getElementById('main').classList.contains('guide') && document.querySelectorAll('#epg-chans-inner .epg-chan').length > 3`, 'the guide');
  await look('programme guide');
  await evaluate(page, `document.getElementById('epg-close').click()`);
  await evaluate(page, `document.getElementById('btn-settings').click()`, { gesture: true });
  await waitFor(page, `document.getElementById('setup').open`, 'the settings dialog', 5000);
  for (const panel of await evaluate(page, `[...document.querySelectorAll('#setup-tabs [data-panel]')].map((b) => b.dataset.panel)`)) {
    await evaluate(page, `document.querySelector('#setup-tabs [data-panel="${panel}"]').click()`);
    await look(`Settings › ${panel}`);
  }
  await evaluate(page, `document.getElementById('setup').close()`);
  await evaluate(page, `document.getElementById('btn-countries').click()`, { gesture: true });
  await waitFor(page, `document.getElementById('countries').open`, 'Choose countries', 5000);
  await look('Choose countries');
  await evaluate(page, `document.getElementById('countries').close()`);
  await evaluate(page, `document.getElementById('btn-help').click()`, { gesture: true });
  await waitFor(page, `document.getElementById('help').open`, 'Help', 5000);
  await look('Help');
  await evaluate(page, `document.getElementById('help').close()`);
  const list = (items) => items.map((o) => `${o.view}: ${o.place} "${o.text}" ${o.need}>${o.have} px`).join('; ');
  const text = lang ? `the ${lang} text` : 'text 40 % longer';
  if (seen.length) throw new Error(`${seen.length} boxes overflow with ${text}: ${list(seen)}`);
  return { ok: true, detail: `${views.length} views at 1280×800 (${views.join(', ')}) with ${text}: nothing overflows` };
}

/**
 * The browser has no WebCodecs encoder, as Firefox for Android 152 has
 * none: the AC-3 episode must still play with sound, decoded and encoded
 * to AAC in wasm, instead of the "no encoder" overlay it gave before.
 */
async function wasmaudio(page, { target }) {
  if (!DEVTOOLS_PORT) return { ok: true, detail: 'skipped in Firefox: needs a script set before the page loads, which the Marionette driver does not offer' };
  await page.call('Page.enable');
  const { identifier } = await page.call('Page.addScriptToEvaluateOnNewDocument', { source: `delete globalThis.AudioEncoder; delete globalThis.AudioDecoder;` });
  try {
    await page.call('Page.navigate', { url: bare(target.url) });
    await sleep(1000);
    await waitFor(page, CONNECTED, 'the connection without WebCodecs');
    const gone = await evaluate(page, `typeof AudioEncoder`);
    if (gone !== 'undefined') return { ok: false, detail: `AudioEncoder is still ${gone}` };
    await playEpisode(page, 1);
    const state = await videoState(page);
    const tone = await evaluate(page, TONE);
    // The episode's channels sound at 880 (the beep), 330, 60, 440 and
    // 550 Hz; any of them loud enough is the decoded track arriving.
    const heard = [880, 330, 440, 550, 60].some((hz) => Math.abs(tone.hz - hz) <= 12) && tone.db > -70;
    if (state.overlay || !heard) return { ok: false, detail: `"${state.overlay || ''}" ${(state.actions || []).join(' / ')}; loudest ${tone.hz} Hz at ${tone.db} dB` };
    return { ok: true, detail: `without WebCodecs the AC-3 episode plays at ${state.t} s and sounds at ${tone.hz} Hz (${tone.db} dB): the wasm AAC encoder took the decoded track` };
  } finally {
    await page.call('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  }
}

/**
 * The time from opening the player to its first channel rows, with the
 * catalogue cache empty (a new install, or a cache dropped by Refresh) and
 * with it full (every later start). The moment is taken in the page itself:
 * a script set before the page loads watches for the first row and notes
 * the frame after it, so that the numbers are not the driver's polling.
 * Three starts each, the median kept; the bounds are well above this
 * machine's numbers, for a start-up that has begun to wait on something.
 */
async function startup(page, { target, requests }) {
  if (!DEVTOOLS_PORT) return { ok: true, detail: 'skipped in Firefox: needs a script set before the page loads, which the Marionette driver does not offer' };
  const BOUNDS = { coldMs: 5000, warmMs: 3000 };
  const origin = target.url.match(/^chrome-extension:\/\/[^/]+/)[0];
  // Without the Page domain enabled, the script is never run.
  await page.call('Page.enable');
  const { identifier } = await page.call('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const seen = () => { const row = document.querySelector('#list .row .row-name'); if (!row) return false;
      requestAnimationFrame(() => { window.__firstRows = { ms: Math.round(performance.now()), name: row.textContent.trim() }; }); return true; };
    const watch = new MutationObserver(() => { if (seen()) watch.disconnect(); });
    watch.observe(document, { childList: true, subtree: true });
  })()` });
  const start = async (cold) => {
    if (cold) {
      // The databases can only be deleted from a page that does not hold
      // them, as freshPlayer does.
      await page.call('Page.navigate', { url: `${origin}/css/player.css` });
      await sleep(500);
      await evaluate(page, `indexedDB.databases().then((dbs) => Promise.all(dbs.map((d) => new Promise((resolve) => {
        const req = indexedDB.deleteDatabase(d.name); req.onsuccess = req.onerror = req.onblocked = () => resolve(d.name); }))))`);
    }
    await evaluate(page, `chrome.storage.local.set({ ui: { tab: 'live' } })`);
    const asked = requests.length;
    await page.call('Page.navigate', { url: bare(target.url) });
    await sleep(300);
    const { ms, name } = await waitFor(page, `window.__firstRows`, `the first channel rows (${cold ? 'cold' : 'warm'})`, 30000);
    // A cold start must have fetched the channels from the server, or it
    // measured a cache that was not dropped.
    const fetched = requests.slice(asked).some((url) => /action=get_live_streams/.test(url));
    if (cold && !fetched) throw new Error('a cold start drew its rows without asking the server for the channels');
    names.add(name);
    return ms;
  };
  const names = new Set();
  const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  try {
    const cold = [], warm = [];
    for (let i = 0; i < 3; i++) cold.push(await start(true));
    for (let i = 0; i < 3; i++) warm.push(await start(false));
    const rows = await evaluate(page, `document.querySelectorAll('#list .row').length`);
    const got = { coldMs: median(cold), warmMs: median(warm) };
    const over = Object.entries(BOUNDS).filter(([k, bound]) => got[k] > bound).map(([k, bound]) => `${k} ${got[k]} > ${bound}`);
    if (over.length) throw new Error(`over the bounds: ${over.join('; ')} (cold ${cold.join(', ')} ms; warm ${warm.join(', ')} ms)`);
    return { ok: true, detail: `first channel rows drawn: cold cache ${got.coldMs} ms (${cold.join(', ')}), warm ${got.warmMs} ms (${warm.join(', ')}); ${rows} rows, the first ${[...names].join(' / ')}` };
  } finally {
    await page.call('Page.removeScriptToEvaluateOnNewDocument', { identifier }).catch(() => {});
  }
}

/**
 * The page's memory over a long session: about three minutes of live
 * channels with a zap every 20 seconds, then a film played with seeks
 * back and forth, then the first channel again. The JavaScript heap is
 * read after a garbage collection at the start and at the end, both with
 * the same channel playing, and the scenario fails when it has grown by
 * more than a generous bound: a player, a stream reader, a demuxer or a
 * listener that each zap or seek leaves behind adds up over an evening.
 * The DOM's nodes and listeners are reported beside it, and bounded too.
 */
async function soak(page) {
  const ZAPS = Number(process.env.KEPULI_SOAK_ZAPS || 9), ZAP_EVERY_MS = 20000;
  const BOUNDS = { heapGrowthMb: 20, listenerGrowth: 300, nodeGrowth: 3000, zapP50Ms: 8000 };
  // A heap read after a full collection: what the page still holds, not
  // what it has not got round to freeing. Chrome's performance.memory is
  // rounded and lags, so the DevTools figure is used where there is one.
  const measure = async () => {
    try {
      await page.call('HeapProfiler.collectGarbage');
      await sleep(300);
      await page.call('HeapProfiler.collectGarbage');
      const heap = await page.call('Runtime.getHeapUsage');
      const dom = await page.call('Memory.getDOMCounters');
      return { heapMb: +(heap.usedSize / 1048576).toFixed(1), nodes: dom.nodes, listeners: dom.jsEventListeners };
    } catch {
      return { heapMb: await evaluate(page, `performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : 0`), nodes: 0, listeners: 0 };
    }
  };
  const playChannel = async (index) => {
    const name = await evaluate(page, `document.querySelectorAll('#list .row')[${index}].querySelector('.row-name').textContent.trim()`);
    const t0 = Date.now();
    await evaluate(page, `document.querySelectorAll('#list .row')[${index}].click()`, { gesture: true });
    await sleep(100);
    await waitFor(page, `${PLAYING} && document.getElementById('now-title').textContent.trim() === ${JSON.stringify(name)}`, `${name} playing`, 40000);
    return Date.now() - t0;
  };
  const liveFinland = async () => {
    await evaluate(page, `document.querySelector('#tabs [data-tab="live"]').click()`);
    await click(page, '#groups', 'Finland');
    await waitFor(page, `document.querySelectorAll('#list .row').length > 5`, 'the channels');
  };
  const steps = [];
  await watchErrors(page);
  await liveFinland();
  const channels = await evaluate(page, `document.querySelectorAll('#list .row').length`);
  await playChannel(0);
  await sleep(5000);
  const first = await measure();
  steps.push(`start ${first.heapMb}`);

  // The live part: a zap every twenty seconds, round the group's channels.
  const zaps = [];
  for (let i = 1; i <= ZAPS; i++) {
    const t0 = Date.now();
    zaps.push(await playChannel(i % Math.min(channels, 8)));
    await sleep(Math.max(0, ZAP_EVERY_MS - (Date.now() - t0)));
  }
  const afterLive = await measure();
  steps.push(`${ZAPS} zaps ${afterLive.heapMb}`);

  // A film with seeks: each one a jump outside what is buffered, waited
  // for until the picture moves again from there.
  await evaluate(page, `document.querySelector('#tabs [data-tab="movie"]').click()`);
  await click(page, '#groups', 'Nordic');
  await click(page, '#list', 'Northern Lights', { gesture: true });
  await waitFor(page, PLAYING, 'the film', 40000);
  const duration = await waitFor(page, `(() => { const d = document.getElementById('video').duration; return isFinite(d) && d > 0 ? d : 0; })()`, 'the film\'s duration');
  const SEEKS = [0.5, 0.15, 0.8, 0.35, 0.65, 0.05, 0.9, 0.25];
  for (const share of SEEKS) {
    const to = +(duration * share).toFixed(1);
    await evaluate(page, `document.getElementById('video').currentTime = ${to}`);
    await sleep(500);
    await waitFor(page, `(() => { const v = document.getElementById('video'); return ${PLAYING} && v.currentTime >= ${to} && v.currentTime < ${to} + 30; })()`, `the film from ${to} s`, 30000);
    await sleep(4000);
  }
  const afterFilm = await measure();
  steps.push(`film with ${SEEKS.length} seeks ${afterFilm.heapMb}`);

  // Back where it began, so that start and end are the same state.
  await liveFinland();
  await playChannel(0);
  await sleep(5000);
  const last = await measure();
  steps.push(`end ${last.heapMb}`);

  const thrown = await errorsSeen(page);
  const sorted = [...zaps].sort((a, b) => a - b);
  const got = { heapGrowthMb: +(last.heapMb - first.heapMb).toFixed(1), listenerGrowth: last.listeners - first.listeners,
    nodeGrowth: last.nodes - first.nodes, zapP50Ms: sorted[Math.floor(sorted.length / 2)] };
  const over = Object.entries(BOUNDS).filter(([k, bound]) => got[k] > bound).map(([k, bound]) => `${k} ${got[k]} > ${bound}`);
  if (thrown.length) over.push(`errors thrown: ${thrown.slice(0, 3).join(' | ')}`);
  const detail = `heap MB ${steps.join(', ')} (growth ${got.heapGrowthMb}); DOM nodes ${first.nodes} → ${last.nodes}, listeners ${first.listeners} → ${last.listeners}; zap to picture p50 ${got.zapP50Ms} ms, max ${sorted.at(-1)} ms; film ${Math.round(duration)} s`;
  if (over.length) throw new Error(`over the bounds: ${over.join('; ')}: ${detail}`);
  return { ok: true, detail };
}

const SCENARIOS = { buffering, livebuffering, filmbuffering, emptyfile, tsasmp4, refusedfile, badgateway, livebadgateway, channelrefused, noanswer, longfilm, catalogUi, setupClarity, fullscreenControl, clickpause, pickers, channels, home, resumemkv, restore, programmes, catchup, seek, death, cancel, timeout, search, paste, keys, switching, resume, connections, livezap, livequiet, reconnect, accounts, listerror, a11y, subtitles, audio, wasmaudio, settings,
  lastchannel, nextepisode, continuewatching, reminders, update, seeklag, cuesretry, quota, catchupfreeze, catchupfull, twotabs, switchstop, resettabs,
  refresh, restorenav, guidekeep, m3u, sync, holes, picks, flakyserver, accountform, stalker, record, guidefavs, categories, noleak, perf, pseudo, startup, soak };
// The mock's whole-list answers stall for these, longer than the request limit.
const SLOW_LIST_MS = { cancel: 60000, timeout: 60000 };
// The media is sent slowly for these: the seek targets must lie outside the
// buffer, and the download must still be under way when the server is cut.
const THROTTLED = new Set(['longfilm', 'seek', 'death', 'reconnect', 'connections', 'seeklag', 'cuesretry']);

/* -------------------------------------------------------------------- main */

const wanted = process.argv.slice(2).filter((a) => SCENARIOS[a]);
const unknown = process.argv.slice(2).filter((a) => !SCENARIOS[a]);
if (unknown.length) { console.error(`unknown scenario ${unknown.join(' ')}; the choices are ${Object.keys(SCENARIOS).join(' and ')}`); process.exit(1); }

await ensureChrome(['--autoplay-policy=no-user-gesture-required', ...(process.env.KEPULI_HEADLESS ? ['--headless=new', '--window-size=1280,800'] : [])]);
let failed = 0;
try {
  for (const name of wanted.length ? wanted : Object.keys(SCENARIOS)) {
    // A mock server of its own for every scenario, one of them kills it —
    // sending slowly, so that the file is not on the browser's side whole
    // before the scenario begins (see KEPULI_MOCK_THROTTLE in the server).
    process.env.KEPULI_MOCK_THROTTLE = THROTTLED.has(name) ? String(THROTTLE) : '';
    process.env.KEPULI_MOCK_SLOW_LIST = String(SLOW_LIST_MS[name] || '');
    process.env.KEPULI_MOCK_HOLE = name === 'holes' ? '0.35-0.5' : '';
    const server = await startMockServer(MOCK_PORT);
    const requests = [];
    server.on('request', (req) => requests.push(req.url));
    const target = await openPlayer();
    const page = session(target.webSocketDebuggerUrl);
    try {
      await freshPlayer(target, page);
      const { ok, detail } = await SCENARIOS[name](page, { server, requests, target });
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);
      if (!ok) failed++;
    } catch (err) {
      console.log(`FAIL  ${name}: ${err.message}`);
      if (process.env.KEPULI_DEBUG) console.log(JSON.stringify(connectionStats()), requests.filter((r) => !/player_api|\/img\//.test(r)).slice(-15));
      failed++;
    } finally {
      page.close();
      if (server.listening) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
    }
  }
} finally {
  setTimeout(() => process.exit(failed ? 1 : 0), 200);
}
