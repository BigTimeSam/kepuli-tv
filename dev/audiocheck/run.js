// The in-page half of dev/audiocheck.mjs: the real modules, driven from a spec
// in the URL hash, with the result as JSON in <pre id="out">.
import { AudioTranscoder, encoderSetup, pickEncoder, ENCODERS, RATE, CHANNELS } from '../js/transcode.js';
import { initSegment, mediaSegment } from '../js/mp4.js';
import { Remuxer } from '../js/remux.js';
import { PcmDecoder } from '../js/ffaudio.js';

const CODEC_ID = { ac3: 'A_AC3', eac3: 'A_EAC3', dts: 'A_DTS' };
const out = document.getElementById('out');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function ranges(sb) {
  try {
    const r = sb.buffered;
    const list = [];
    for (let i = 0; i < r.length; i++) list.push([Number(r.start(i).toFixed(3)), Number(r.end(i).toFixed(3))]);
    return list;
  } catch (e) { return 'error: ' + e.message; }
}

async function env() {
  const o = { ua: navigator.userAgent, encoders: {}, decoders: {}, mse: {}, hasWebCodecs: typeof AudioEncoder !== 'undefined' };
  for (const e of ENCODERS) {
    const cfg = { codec: e.codec, sampleRate: RATE, numberOfChannels: CHANNELS, bitrate: 192000 };
    if (e.name === 'opus') cfg.opus = { frameDuration: 20000 };
    try { const c = await AudioEncoder.isConfigSupported(cfg); o.encoders[e.name] = Boolean(c && c.supported); } catch (err) { o.encoders[e.name] = 'error: ' + err.message; }
    try { const c = await AudioDecoder.isConfigSupported({ codec: e.codec, sampleRate: RATE, numberOfChannels: CHANNELS }); o.decoders[e.name] = Boolean(c && c.supported); } catch (err) { o.decoders[e.name] = 'error: ' + err.message; }
    o.mse[e.name] = MediaSource.isTypeSupported(`audio/mp4; codecs="${e.mime}"`);
  }
  return o;
}

function segments(chunks, seq, codec) {
  const list = [];
  let run = [];
  let next = null;
  const emit = () => { if (run.length) { list.push(mediaSegment(seq.n++, 2, run, codec)); run = []; } };
  for (const c of chunks) {
    if (next != null && c.dts !== next) emit();
    run.push({ data: c.data, dts: c.dts, cts: 0, duration: c.duration, keyframe: true });
    next = c.dts + c.duration;
  }
  emit();
  return list;
}

function analyser(element) {
  const ctx = new AudioContext();
  const src = ctx.createMediaElementSource(element);
  const an = ctx.createAnalyser();
  an.fftSize = 2048;
  const gain = ctx.createGain();
  gain.gain.value = 0;                     // measured, not heard
  src.connect(an); an.connect(gain); gain.connect(ctx.destination);
  const buf = new Float32Array(an.fftSize);
  return {
    ctx,
    async peak(seconds) {
      let peak = 0;
      const t = performance.now();
      while (performance.now() - t < seconds * 1000) {
        await sleep(50);
        an.getFloatTimeDomainData(buf);
        let s = 0;
        for (const v of buf) s += v * v;
        peak = Math.max(peak, Math.sqrt(s / buf.length));
      }
      return Number(peak.toFixed(4));
    },
    close: () => ctx.close(),
  };
}

async function playMse(mime, init, segs, seconds) {
  const audio = document.createElement('audio');
  document.body.appendChild(audio);
  const ms = new MediaSource();
  audio.src = URL.createObjectURL(ms);
  await new Promise((r) => ms.addEventListener('sourceopen', r, { once: true }));
  const result = { appended: 0, error: null };
  let sb;
  try {
    sb = ms.addSourceBuffer(`audio/mp4; codecs="${mime}"`);
    sb.mode = 'segments';
  } catch (e) { result.error = 'addSourceBuffer: ' + e.message; audio.remove(); return result; }
  const append = (data) => new Promise((res, rej) => {
    const done = () => { sb.removeEventListener('updateend', done); sb.removeEventListener('error', bad); res(); };
    const bad = () => { sb.removeEventListener('updateend', done); sb.removeEventListener('error', bad); rej(new Error('SourceBuffer error')); };
    sb.addEventListener('updateend', done); sb.addEventListener('error', bad);
    try { sb.appendBuffer(data); } catch (e) { bad(); rej(e); }
  });
  try {
    await append(init);
    for (const s of segs) { await append(s); result.appended++; }
    ms.endOfStream();
  } catch (e) { result.error = e.message; }
  result.buffered = ranges(sb);
  result.duration = ms.duration;
  const an = analyser(audio);
  await an.ctx.resume();
  try { await audio.play(); } catch (e) { result.playError = e.message; }
  result.peakRms = await an.peak(seconds);
  result.currentTime = Number(audio.currentTime.toFixed(3));
  result.mediaError = audio.error ? audio.error.message : null;
  audio.pause();
  URL.revokeObjectURL(audio.src);
  audio.remove();
  await an.close();
  return result;
}

/** The wasm decoder's own output for the file: what the encoder was fed. */
async function referencePcm(bytes, codec) {
  const dec = await PcmDecoder.open(CODEC_ID[codec], RATE);
  const parts = [];
  for (let at = 0; at < bytes.length; at += 4096) {
    const pcm = dec.decode(bytes.subarray(at, Math.min(bytes.length, at + 4096)));
    if (pcm) parts.push(pcm);
  }
  const tail = dec.flush();
  if (tail) parts.push(tail);
  dec.close();
  const out = new Float32Array(parts.reduce((a, b) => a + b.length, 0));
  let p = 0;
  for (const x of parts) { out.set(x, p); p += x.length; }
  return out;
}

/**
 * The browser's own decode of the fMP4 — decodeAudioData goes through the
 * same demuxer and decoder as MediaSource — against the reference. The
 * decoded audio may start at the first packet (lag -firstDts) or be padded
 * to time zero (lag 0); either is right, and the offset from the nearer
 * of the two is what is reported.
 */
async function browserDecode(all, ref, firstDts) {
  const ctx = new OfflineAudioContext(2, RATE, RATE);
  let buffer;
  try {
    buffer = await ctx.decodeAudioData(all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength));
  } catch (e) { return { error: String(e && e.message || e) }; }
  const L = buffer.getChannelData(0);
  const R = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : L;
  const snr = (lag) => {
    let sig = 0, err = 0;
    const from = Math.max(4800, -lag);
    const to = Math.min(ref.length / 2, buffer.length - lag);
    for (let i = from; i < to; i++) {
      const r0 = ref[i * 2], r1 = ref[i * 2 + 1], d0 = L[i + lag], d1 = R[i + lag];
      sig += r0 * r0 + r1 * r1; err += (d0 - r0) * (d0 - r0) + (d1 - r1) * (d1 - r1);
    }
    return 10 * Math.log10(sig / Math.max(err, 1e-20));
  };
  let best = { lag: 0, db: -Infinity, base: 0 };
  for (const base of [-firstDts, 0]) {
    for (let lag = base - 48; lag <= base + 48; lag++) {
      const db = snr(lag);
      if (db > best.db) best = { lag, db, base };
    }
  }
  return {
    sampleRate: buffer.sampleRate, channels: buffer.numberOfChannels, seconds: Number(buffer.duration.toFixed(3)),
    padded: best.base === 0, off: best.lag - best.base, db: Number(best.db.toFixed(1)),
  };
}

async function transcodeFile({ file, codec, seconds, pieces }, keepMp4) {
  const bytes = new Uint8Array(await (await fetch(`./media/${file}`)).arrayBuffer());
  const errors = [];
  const tr = await AudioTranscoder.open(CODEC_ID[codec], (e) => errors.push(String(e && e.message || e)));
  const CH = 4096;
  const chunks = [];
  // The block PTS the way Matroska would give it: the files are constant
  // bit rate, so the byte offset maps to time — piecewise where two rates
  // are concatenated.
  const spans = pieces || [[bytes.length, seconds]];
  const ptsOf = (at) => {
    let b0 = 0, t0 = 0;
    for (const [b1, t1] of spans) {
      if (at < b1) return Math.round((t0 + ((at - b0) / (b1 - b0)) * (t1 - t0)) * 1e9);
      b0 = b1; t0 = t1;
    }
    return Math.round(t0 * 1e9);
  };
  const t0 = performance.now();
  for (let at = 0; at < bytes.length; at += CH) {
    await tr.push({ pts: ptsOf(at), data: bytes.subarray(at, Math.min(bytes.length, at + CH)) });
    chunks.push(...tr.take());
  }
  await tr.finish();
  chunks.push(...tr.take());
  const ms = performance.now() - t0;
  const sizes = chunks.map((c) => c.data.byteLength);
  const init = initSegment([{ id: 2, kind: 'audio', timescale: RATE, codec: tr.codec, priv: tr.description, channels: CHANNELS, rate: RATE }]);
  const seq = { n: 1 };
  const segs = segments(chunks, seq, tr.codec);
  const parts = [init, ...segs];
  const all = new Uint8Array(parts.reduce((a, b) => a + b.byteLength, 0));
  let p = 0;
  for (const s of parts) { all.set(s, p); p += s.byteLength; }
  const mse = await playMse(tr.mime, init, segs, 1.5);
  const own = await browserDecode(all, await referencePcm(bytes, codec), chunks.length ? chunks[0].dts : 0);
  const durations = new Set(chunks.map((c) => c.duration));
  const res = {
    file, codec: tr.codec, mime: tr.mime, frame: tr.frame, delay: tr.delay,
    chunks: chunks.length, firstDts: chunks.length ? chunks[0].dts : null,
    lastEnd: chunks.length ? chunks[chunks.length - 1].dts + chunks[chunks.length - 1].duration : 0,
    expectedSamples: Math.round(seconds * RATE),
    segments: segs.length, distinctDurations: [...durations],
    minSize: Math.min(...sizes), maxSize: Math.max(...sizes), bytes: all.byteLength,
    ms: Math.round(ms), realtime: Math.round(seconds / (ms / 1000)), errors, mse, own,
  };
  if (keepMp4) res.mp4 = b64(all);
  tr.close();
  return res;
}

async function remuxTest({ url, label }, seconds, seekTo) {
  // An element per run: createMediaElementSource binds to one for good.
  const video = document.createElement('video');
  video.width = 320; video.height = 180; video.playsInline = true;
  document.body.appendChild(video);
  const notices = [];
  const errors = [];
  let first = null;
  const t0 = performance.now();
  const r = new Remuxer(video, url, {
    onError: (e) => errors.push(String(e && e.message || e)),
    onNotice: (n) => notices.push(n),
    onFirstAppend: () => { first = Math.round(performance.now() - t0); },
    onSubtitles: () => {},
  });
  const an = analyser(video);
  await an.ctx.resume();
  const res = { label, url, notices, errors };
  try {
    await r.start();
    try { await video.play(); } catch (e) { errors.push('play: ' + e.message); }
    res.peakRms = await an.peak(seconds);
    res.transcoder = r.transcoder ? { codec: r.transcoder.codec, mime: r.transcoder.mime, delay: r.transcoder.delay, frame: r.transcoder.frame } : null;
    res.audioTrack = r.audioTrack ? r.audioTrack.codecId : null;
    res.decodeTrack = r.decodeTrack ? r.decodeTrack.codecId : null;
    res.firstAppendMs = first;
    res.currentTime = Number(video.currentTime.toFixed(3));
    res.readyState = video.readyState;
    res.buffered = { video: ranges(r.buffers.video), audio: r.buffers.audio ? ranges(r.buffers.audio) : null };
    res.phase = r.state.phase;
    res.videoError = video.error ? video.error.message : null;
    if (seekTo) {
      video.currentTime = seekTo;
      await sleep(800);
      const peak = await an.peak(seconds);
      res.seek = {
        to: seekTo, currentTime: Number(video.currentTime.toFixed(3)), readyState: video.readyState, peakRms: peak,
        buffered: { video: ranges(r.buffers.video), audio: r.buffers.audio ? ranges(r.buffers.audio) : null },
        phase: r.state.phase, videoError: video.error ? video.error.message : null,
      };
    }
  } catch (e) {
    res.fatal = String(e && e.stack || e);
  }
  r.destroy();
  video.pause();
  video.removeAttribute('src');
  video.load();
  video.remove();
  await an.close();
  return res;
}

async function main() {
  const spec = JSON.parse(decodeURIComponent(location.hash.slice(1) || '{}'));
  const result = { started: new Date().toISOString() };
  out.dataset.state = 'running';
  try {
    result.env = await env();
    const t = performance.now();
    const picked = await pickEncoder();
    result.picked = picked ? picked.name : null;
    if (picked) {
      const setup = await encoderSetup();
      result.setup = { encoder: setup.encoder.name, delay: setup.delay, description: setup.description ? Array.from(setup.description) : null, ms: Math.round(performance.now() - t) };
    }
    result.files = [];
    for (const f of spec.files || []) {
      try { result.files.push(await transcodeFile(f, spec.keepMp4)); } catch (e) { result.files.push({ file: f.file, fatal: String(e && e.stack || e) }); }
    }
    result.remux = [];
    for (const mkv of spec.mkvs || []) {
      try { result.remux.push(await remuxTest(mkv, spec.seconds || 5, spec.seekTo || 0)); } catch (e) { result.remux.push({ label: mkv.label, url: mkv.url, fatal: String(e && e.stack || e) }); }
    }
  } catch (e) {
    result.fatal = String(e && e.stack || e);
  }
  out.textContent = JSON.stringify(result);
  out.dataset.state = 'done';
}

main();
