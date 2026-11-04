// Recording in the player: the Record button and the reminder that turns
// recording on, the list of recordings and their playback, plans from the
// guide, and catch-up playback, which shares the guide's programme handling.
// The recorder itself (writing the stream to the origin private file system)
// is js/recorder.js; this is what the viewer sees of it.
//
// Moved out of app.js. It takes the player's state and helpers from app.js
// (a cycle that ES modules resolve: nothing here runs while the modules
// load, only when the player calls in).

import { PAD_AFTER_MS, PAD_BEFORE_MS, Recorder, changeRecordings, deleteRecordingFiles, loadRecordings, newRecordingId, patchRecording, recordingBlob, recordingFileName, recordingSupported, settleOrphans, watchRecordings } from './recorder.js';
import { catchupAvailable, reminderDelay } from './epggrid.js';
import { clock, dateTimeFmt, dayLabel, duration, megabytes } from './format.js';
import { streamUrl, timeshiftUrl } from './xtream.js';
import { t } from './i18n.js';
import * as store from './config.js';
import { cancelAutoNext, channelKey, itemAddress, newPlayRun, playItem, playback, playerLayout, renderAudio, renderNowSub, renderSubtitles, sizePicture, state, updateAddress, updatePlayerLayout, updateSetupActions, vlist } from './app.js';
import { toast } from './toast.js';
import { $, el } from './dom.js';
import { grid, guideOpen, refreshGuidePreview } from './guideui.js';
import { shownName, stripItem } from './coversui.js';
import { renderInfoStrip } from './infostrip.js';

// A live channel recorded to the browser's own storage (js/recorder.js):
// from the player, from now to the end of the programme on now, or from
// the guide, a programme planned ahead. Like the reminders, a plan is
// carried out by an open player: one that is closed records nothing.
const recorder = new Recorder({ onChange: () => renderRecordingState() });
let recordings = [];
let recordingTimer = null;
export let canRecord = false;
/** Recording offered: the browser able to, and the viewer having turned it on in Settings. */
export const recordingOn = () => canRecord && state.settings?.recordingEnabled === true;
let recordingUrl = null;      // the Blob address of the recording being played

export async function loadRecordingList() {
  canRecord = await recordingSupported();
  await settleOrphans().catch((err) => console.warn('[iptv] settling the recordings failed', err));
  showRecordings(await loadRecordings());
  watchRecordings(showRecordings);
  // A recording under way is lost with the tab; the browser asks first.
  window.addEventListener('beforeunload', (event) => {
    if (!recorder.jobs.size) return;
    event.preventDefault();
    event.returnValue = '';
  });
}

function showRecordings(list) {
  recordings = Array.isArray(list) ? list : [];
  armRecordings();
  renderRecordingState();
  if ($('recordings').open) renderRecordingsList();
  refreshGuidePreview();
}

const activeRecording = (r) => r.state === 'planned' || r.state === 'recording';

/** The account a recording was planned on: the one in use, or another of the list. */
function accountByKey(key) {
  if (state.config && store.accountKey(state.config) === key) return state.config;
  return (state.accounts || []).find((a) => store.accountKey(a) === key) || null;
}

/** The recording under way, or planned, of a channel's programme (or of the channel now). */
export function recordingOf(channel, programme = null) {
  if (!state.config) return null;
  const key = channelKey(state.config, channel);
  return recordings.find((r) => r.key === key && activeRecording(r)
    && (programme ? r.programme?.start === programme.start : r.state === 'recording')) || null;
}

async function beginRecording(entry) {
  const config = accountByKey(entry.account);
  if (!config) { await patchRecording(entry.id, { state: 'failed', reason: 'account' }); return false; }
  const item = entry.channel;
  const xtream = config.type !== 'm3u' && config.type !== 'stalker';
  return recorder.start(entry, {
    key: entry.key,
    openUrl: () => itemAddress(item, config, state.source),
    // An Xtream channel the server will not give as TS is tried as HLS,
    // as the player does.
    fallbackUrl: xtream && !item.direct ? streamUrl(config, item, 'm3u8') : null,
  });
}

/** A new recording in the list, started at once when its time has come. */
async function addRecording(channel, { title, start, stop, programme = null }) {
  const config = state.config;
  const entry = {
    id: newRecordingId(),
    key: channelKey(config, channel),
    account: store.accountKey(config),
    channel: stripItem({ ...channel, displayName: channel.displayName || (state.cleanName ? state.cleanName(channel.n, channel) : channel.n) }),
    title,
    start,
    stop,
    programme: programme ? { start: programme.start, stop: programme.stop } : null,
    state: 'planned',
    bytes: 0,
    createdAt: Date.now(),
  };
  await changeRecordings((list) => [...list, entry]);
  if (start <= Date.now()) await beginRecording(entry);
  return entry;
}

async function endRecording(entry) {
  if (entry.state === 'recording') {
    if (recorder.isRecording(entry.id)) recorder.stop(entry.id);
    // Another tab makes it: the list says so, and that tab stops.
    else await patchRecording(entry.id, { stopAsked: Date.now() });
  } else if (entry.state === 'planned') {
    await changeRecordings((list) => list.filter((r) => r.id !== entry.id));
  }
}

/**
 * Recording turned on in Settings: first the reminder of what may be
 * recorded. A copy kept is lawful only of what the viewer has the right
 * to — their own subscription's programmes, for themselves — and never of
 * a source that is not lawful; the box stays ticked only once that is
 * acknowledged. Asked every time it is turned on, not once for good: the
 * moment it is turned on is the moment it matters.
 */
export function askRecordingConsent() {
  if (!$('f-record').checked) return;
  $('f-record').checked = false;
  updateSetupActions();
  $('rec-consent').showModal();
  $('rec-consent-cancel').focus();
}

export function closeRecordingConsent(accepted) {
  if (!$('rec-consent').open) return;
  $('rec-consent').close();
  $('f-record').checked = accepted;
  $('f-record').focus();
  updateSetupActions();
}

/** The Record button: the channel on screen, to the end of its programme, or a recording of it stopped. */
export async function toggleRecordNow() {
  const item = state.playing;
  if (!item || item.k !== 0 || state.catchup || !recordingOn()) return;
  const running = recordingOf(item);
  if (running) {
    await endRecording(running);
    toast(t('rec.stopped', { title: running.title }));
    return;
  }
  const now = Date.now();
  const on = state.epg?.nowNext(item.id)?.now;
  const programme = on && on.stop > now + 60e3 ? on : null;
  const name = shownName(item);
  const title = programme ? programme.title : name;
  const stop = programme ? programme.stop + PAD_AFTER_MS : null;
  const entry = await addRecording(item, { title, start: now, stop, programme });
  if (!entry) return;
  toast(stop ? t('rec.started', { title, time: clock(stop) }) : t('rec.started.open', { title }), { long: true });
}

/** A programme in the guide: planned for recording, or the plan taken back. */
export async function toggleProgrammeRecording(channel, programme) {
  const existing = recordingOf(channel, programme);
  if (existing) {
    await endRecording(existing);
    toast(t(existing.state === 'recording' ? 'rec.stopped' : 'rec.cancelled', { title: existing.title }));
    return;
  }
  const start = Math.max(Date.now(), programme.start - PAD_BEFORE_MS);
  await addRecording(channel, { title: programme.title, start, stop: programme.stop + PAD_AFTER_MS, programme });
  toast(start <= Date.now()
    ? t('rec.started', { title: programme.title, time: clock(programme.stop + PAD_AFTER_MS) })
    : t('rec.scheduled', { title: programme.title, time: clock(programme.start) }), { long: true });
}

/**
 * One timer, for the plan due first, the way the reminders have theirs.
 * A plan whose programme ended while no player was open is said to have
 * been missed. A recording another tab was asked to stop is stopped here
 * when it is this tab's.
 */
function armRecordings() {
  clearTimeout(recordingTimer);
  for (const r of recordings) if (r.stopAsked && recorder.isRecording(r.id)) recorder.stop(r.id);
  const planned = recordings.filter((r) => r.state === 'planned');
  if (!planned.length || !canRecord) return;
  const due = Math.min(...planned.map((r) => r.start));
  recordingTimer = setTimeout(startDueRecordings, reminderDelay(due, Date.now()));
}

async function startDueRecordings() {
  const now = Date.now();
  for (const r of recordings.filter((x) => x.state === 'planned' && x.start <= now)) {
    if (r.stop && r.stop <= now) await patchRecording(r.id, { state: 'failed', reason: 'missed' });
    else await beginRecording(r);
  }
  armRecordings();
}

/** The Record button, and the recordings button in the top bar. */
export function renderRecordingState() {
  const item = state.playing;
  const button = $('btn-record');
  const live = Boolean(item && item.k === 0 && !state.catchup && !item.recording && recordingOn());
  button.hidden = !live;
  const running = live ? recordingOf(item) : null;
  button.setAttribute('aria-pressed', String(Boolean(running)));
  $('btn-record-label').textContent = t(running ? 'rec.stop' : 'rec.start');
  button.title = running ? t('rec.stop.title', { title: running.title }) : t('rec.start.title');
  const top = $('btn-recordings');
  const recordingNow = recordings.some((r) => r.state === 'recording');
  top.hidden = !recordings.length;
  // The list stays reachable while there is anything in it, turned off or not.
  $('btn-recordings-menu').hidden = !recordingOn() && !recordings.length;
  top.classList.toggle('on', recordingNow);
  top.title = t(recordingNow ? 'rec.now' : 'rec.title');
  if ($('recordings').open) renderRecordingsList();
}

export function openRecordings() {
  renderRecordingsList();
  if (!$('recordings').open) $('recordings').showModal();
}

/** "20.00–21.05 · 1 h 5 min · 1.2 GB" and the like. */
function recordingFacts(r) {
  const from = r.startedAt || r.start;
  const to = r.state === 'recording' ? Date.now() : r.endedAt || r.stop;
  const bits = [r.channel?.displayName || r.channel?.n];
  bits.push(`${dayLabel(from)} ${clock(from)}${r.stop || r.endedAt ? `–${clock(r.state === 'planned' ? r.stop : to)}` : ''}`);
  if (r.state !== 'planned' && to > from) bits.push(duration(Math.round((to - from) / 1000)));
  if (r.bytes) bits.push(megabytes(r.bytes));
  return bits.filter(Boolean).join(' · ');
}

const RECORDING_STATES = { planned: 'rec.state.planned', recording: 'rec.state.recording', partial: 'rec.state.partial', failed: 'rec.state.failed' };

function renderRecordingsList() {
  const list = $('recordings-list');
  const order = { recording: 0, planned: 1 };
  const sorted = recordings.slice().sort((a, b) => (order[a.state] ?? 2) - (order[b.state] ?? 2)
    || (a.state === 'planned' ? a.start - b.start : (b.startedAt || b.start) - (a.startedAt || a.start)));
  $('recordings-empty').hidden = sorted.length > 0;
  const total = recordings.reduce((sum, r) => sum + (r.bytes || 0), 0);
  $('recordings-note').textContent = total ? `${t('rec.note')} ${t('rec.total', { size: megabytes(total) })}` : t('rec.note');
  list.replaceChildren(...sorted.map((r) => {
    const row = document.createElement('div');
    row.className = 'choice-row';
    row.setAttribute('role', 'listitem');
    const info = document.createElement('div');
    info.className = 'rec-info';
    const title = document.createElement('b');
    title.textContent = r.title;
    const facts = document.createElement('small');
    facts.textContent = recordingFacts(r);
    info.append(title, facts);
    if (RECORDING_STATES[r.state]) {
      const stateLine = document.createElement('small');
      stateLine.className = r.state === 'planned' ? '' : 'rec-state';
      const reason = r.reason === 'quota' ? t('rec.reason.quota') : r.reason === 'missed' ? t('rec.reason.missed')
        : r.reason === 'closed' ? t('rec.reason.closed') : r.reason === 'account' ? t('rec.reason.account') : r.reason || '';
      stateLine.textContent = [t(RECORDING_STATES[r.state]), r.state === 'planned' || r.state === 'recording' ? '' : reason].filter(Boolean).join(' – ');
      info.appendChild(stateLine);
    }
    const actions = document.createElement('div');
    actions.className = 'rec-actions';
    const button = (label, onClick, { danger = false } = {}) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = danger ? 'ghost danger' : 'ghost';
      b.textContent = label;
      b.addEventListener('click', onClick);
      actions.appendChild(b);
      return b;
    };
    if (r.state === 'planned') button(t('rec.cancel'), () => endRecording(r));
    else if (r.state === 'recording') button(t('rec.stop'), () => endRecording(r));
    if ((r.state === 'done' || r.state === 'partial') && r.bytes) {
      button(t('rec.play'), () => playRecording(r));
      button(t('rec.save'), () => saveRecording(r));
    }
    if (r.state !== 'planned' && r.state !== 'recording') {
      // Asked twice: a recording deleted is gone from the disk.
      const del = button(t('rec.delete'), () => {
        if (del.dataset.armed) { deleteRecording(r); return; }
        del.dataset.armed = '1';
        del.textContent = t('rec.delete.confirm');
        setTimeout(() => { if (del.isConnected) { delete del.dataset.armed; del.textContent = t('rec.delete'); } }, 4000);
      }, { danger: true });
    }
    row.append(info, actions);
    return row;
  }));
}

async function saveRecording(r) {
  try {
    const blob = await recordingBlob(r.id, r.ext === 'mp4' ? 'video/mp4' : 'video/mp2t');
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = recordingFileName(r);
    document.body.appendChild(link);
    link.click();
    link.remove();
    // The download has the file by then; the address is let go later rather
    // than at once, which Firefox would take as the end of it.
    setTimeout(() => URL.revokeObjectURL(url), 10 * 60e3);
  } catch (err) {
    console.error('[iptv] saving the recording failed', err);
    toast(t('rec.missing'), { kind: 'error' });
  }
}

async function deleteRecording(r) {
  if (recorder.isRecording(r.id)) return;
  await deleteRecordingFiles(r.id).catch((err) => console.warn('[iptv] deleting the recording\'s files failed', err));
  await changeRecordings((list) => list.filter((x) => x.id !== r.id));
  toast(t('rec.deleted', { title: r.title }));
}

/** A recording played in the player, from the disk. */
async function playRecording(r) {
  let blob;
  try { blob = await recordingBlob(r.id, r.ext === 'mp4' ? 'video/mp4' : 'video/mp2t'); } catch (err) {
    console.error('[iptv] reading the recording failed', err);
    toast(t('rec.missing'), { kind: 'error' });
    return;
  }
  $('recordings').close();
  if (recordingUrl) URL.revokeObjectURL(recordingUrl);
  recordingUrl = URL.createObjectURL(blob);
  cancelAutoNext();
  newPlayRun();
  const item = { ...r.channel, recording: r.id };
  state.playing = item;
  sizePicture();
  state.catchup = null;
  updatePlayerLayout();
  playerLayout.showPlayer();
  state.playingSpec = { url: recordingUrl, live: false, recording: true, ext: r.ext || 'ts', mode: 'ts' };
  renderSubtitles([], null);
  renderAudio([], null);
  state.subtitleInfo = null;
  el.mode.disabled = true;
  $('btn-live').hidden = true;
  el.nowTitle.textContent = `${r.title} — ${t('rec.recorded', { time: dateTimeFmt.format(new Date(r.startedAt || r.start)) })}`;
  el.nowTitle.title = r.title;
  el.nowSub.textContent = r.channel?.displayName || r.channel?.n || '';
  renderInfoStrip();
  renderRecordingState();
  vlist.refresh();
  playback.play(state.playingSpec);
}

/**
 * Before another stream is started: a recording of another channel on an
 * account that allows one connection takes that connection.
 */
export function warnRecordingConnection(item) {
  if (state.account?.maxConnections !== 1) return;
  const key = item && item.k === 0 ? channelKey(state.config, item) : null;
  const account = store.accountKey(state.config);
  if (recordings.some((r) => r.state === 'recording' && r.account === account && r.key !== key)) {
    toast(t('rec.connection'), { kind: 'warn', long: true });
  }
}

/**
 * A programme from the archive. from, in seconds into the programme, starts
 * it further on — Retry after the stream stopped mid-programme. The archive
 * address names its start in whole minutes, so the start is the minute the
 * position falls in, and the picture's clock counts from there.
 */
export function playCatchup(item, programme, { from = 0 } = {}) {
  if (!catchupAvailable(item, programme)) { toast(t('guide.norecording'), { kind: 'warn' }); return; }
  const length = programme.stop - programme.start;
  const skip = Math.max(0, Math.min(Math.floor(from / 60) * 60000, length - 60000));
  const minutes = Math.max(1, Math.ceil((length - skip) / 60000));
  // A playlist's channel says itself how its archive is addressed
  // (catchupAddress in js/m3u.js); an Xtream server has one way for all.
  const url = state.source?.catchupUrl
    ? state.source.catchupUrl(item, programme.start + skip, minutes)
    : timeshiftUrl(state.config, item.id, programme.start + skip, minutes, state.account.serverUtcOffsetMs || 0, state.account.serverZone);
  if (!url) { toast(t('guide.norecording'), { kind: 'warn' }); return; }
  cancelAutoNext();
  state.playing = item;
  sizePicture();
  updatePlayerLayout();
  playerLayout.showPlayer();
  state.playingSpec = { url, live: false, catchup: true, ext: 'ts', mode: 'ts', skipped: skip / 1000 };
  state.catchup = { ...programme, channel: item };
  renderSubtitles([], null);
  renderAudio([], null);
  state.subtitleInfo = null;
  el.mode.disabled = true;
  $('btn-live').hidden = false;
  el.nowTitle.textContent = `${item.n} — ${programme.title}`;
  el.nowTitle.title = item.n;
  updateAddress();
  renderNowSub();
  renderInfoStrip();
  vlist.refresh();
  if (guideOpen) grid.setPlaying(item.id);
  playback.play(state.playingSpec);
  if (programme.stop > Date.now()) toast(t('guide.startover.note'), { long: true, kind: 'warn' });
}

/**
 * The same thing again. After a film or a programme stopped part-way —
 * the download broke for good, the picture froze — from where it stopped.
 */
export function retryPlayback() {
  const spec = state.playingSpec;
  const reached = spec && spec.reached > 0 ? spec.reached : 0;
  if (state.catchup) playCatchup(state.catchup.channel, state.catchup, { from: reached ? (spec.skipped || 0) + reached : 0 });
  else if (state.playing) playItem(state.playing, reached ? { startAt: Math.floor(reached) } : {});
}
