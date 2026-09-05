#!/usr/bin/env node
// The demuxer against a file with an element larger than the reader's
// buffer cap in front of the first cluster. An anime release carries its
// fonts as Attachments, tens of megabytes before any picture; the reader
// side (remux.js) stops pushing at 8 MB, and a demuxer that gathered the
// element whole before skipping it waited for bytes that never came. The
// test builds such a file from the demo episode with ffmpeg — a 12 MB
// attachment — and runs frames() with a pusher that keeps the reader's rule,
// expecting the first frame within a few seconds and the same number of
// frames as the plain episode yields.
//
//   node dev/demuxcheck.mjs
//
// Needs ffmpeg and dev/mock/media/episode.mkv (from dev/mock/media.sh).
// Exit code 0 on pass, 1 on fail.

import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, openSync, readSync, closeSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHeader, ID } from '../js/ebml.js';
import { BufferedBytes, frames } from '../js/mkv.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MEDIA = join(ROOT, 'dev', 'mock', 'media');
const PLAIN = join(MEDIA, 'episode.mkv');
const ATTACHED = join(MEDIA, 'episode-attach.mkv');
const CAP = 8 * 1024 * 1024;          // MAX_PENDING_BYTES in remux.js
const ATTACHMENT_BYTES = 12 * 1024 * 1024;
const FIRST_FRAME_MS = 5000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!existsSync(PLAIN)) { console.error(`${PLAIN} is missing: run sh dev/mock/media.sh first`); process.exit(1); }
if (!existsSync(ATTACHED) || statSync(ATTACHED).size < ATTACHMENT_BYTES) {
  const blob = join(MEDIA, 'attachment.bin');
  writeFileSync(blob, Buffer.alloc(ATTACHMENT_BYTES, 0x5a));
  // -map 0 keeps every stream: left to itself ffmpeg picks one subtitle
  // track of the two, and the frame counts would differ for that reason.
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', PLAIN, '-map', '0', '-attach', blob, '-metadata:s:t', 'mimetype=application/octet-stream', '-c', 'copy', ATTACHED]);
  console.log(`built ${ATTACHED.slice(ROOT.length + 1)}: ${Math.round(statSync(ATTACHED).size / 1048576)} MB`);
}

/** The offset of the first occurrence of a 4-byte EBML id, or -1. */
function offsetOf(file, id) {
  const buf = Buffer.alloc(statSync(file).size);
  const fd = openSync(file, 'r'); readSync(fd, buf, 0, buf.length, 0); closeSync(fd);
  const needle = Buffer.from([(id >>> 24) & 0xff, (id >>> 16) & 0xff, (id >>> 8) & 0xff, id & 0xff]);
  return buf.indexOf(needle);
}
const attachmentsAt = offsetOf(ATTACHED, ID.Attachments);
const clusterAt = offsetOf(ATTACHED, ID.Cluster);
if (attachmentsAt < 0 || clusterAt < 0 || attachmentsAt > clusterAt) {
  console.error(`the test file does not put Attachments (${attachmentsAt}) before the first Cluster (${clusterAt})`);
  process.exit(1);
}

function headerOf(file) {
  const buf = Buffer.alloc(256 * 1024);
  const fd = openSync(file, 'r'); const n = readSync(fd, buf, 0, buf.length, 0); closeSync(fd);
  const header = parseHeader(new Uint8Array(buf.buffer, buf.byteOffset, n));
  if (!header.ok) throw new Error(`${file}: no track data found`);
  return header;
}

/**
 * Demuxes the whole file with the reader's rule on how far the network may
 * run ahead. Returns the time to the first frame and the frame count; the
 * first frame not arriving in time is the deadlock.
 */
async function demux(file) {
  const header = headerOf(file);
  const tracks = new Map(header.tracks.map((t) => [t.number, t]));
  const bytes = new BufferedBytes();
  // The old BufferedBytes has no hasRoom; the reader then used the cap alone.
  const room = () => (bytes.hasRoom ? bytes.hasRoom(CAP) : bytes.available < CAP);
  const network = (async () => {
    for await (const chunk of createReadStream(file, { highWaterMark: 64 * 1024 })) {
      while (!room()) await sleep(2);
      bytes.push(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
    }
    bytes.end();
  })();
  const it = frames(bytes, { timestampScale: header.timestampScale, tracks });
  const t0 = Date.now();
  const first = await Promise.race([it.next(), sleep(FIRST_FRAME_MS).then(() => 'timeout')]);
  if (first === 'timeout') return { firstMs: null, count: 0, pending: bytes.available };
  let count = first.done ? 0 : 1;
  const firstMs = Date.now() - t0;
  for (;;) { const { done } = await it.next(); if (done) break; count++; }
  await network;
  return { firstMs, count, pending: bytes.available };
}

const plain = await demux(PLAIN);
const attached = await demux(ATTACHED);
console.log(`plain     first frame ${plain.firstMs} ms, ${plain.count} frames`);
console.log(`attached  first frame ${attached.firstMs == null ? 'never (' + FIRST_FRAME_MS + ' ms, ' + Math.round(attached.pending / 1048576) + ' MB waiting)' : attached.firstMs + ' ms'}, ${attached.count} frames`);
const ok = attached.firstMs != null && attached.count === plain.count;
console.log(ok ? 'PASS: a 12 MB attachment before the first cluster is skipped' : 'FAIL: the demuxer waits for the whole attachment');
process.exit(ok ? 0 : 1);
