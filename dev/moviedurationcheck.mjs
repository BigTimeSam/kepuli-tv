#!/usr/bin/env node
import assert from 'node:assert/strict';
import { duration } from '../js/format.js';
import { XtreamApi } from '../js/api.js';
import { Library } from '../js/library.js';

assert.equal(duration(5700, { compact: true }), '1h 35 min');
assert.equal(duration(3600, { compact: true }), '1h');
assert.equal(duration(3599, { compact: true }), '1h');
assert.equal(duration(2100, { compact: true }), '35 min');
for (const value of [0, -1, NaN, Infinity]) assert.equal(duration(value), '');
const api = new XtreamApi({ host: 'test.invalid' });
for (const [raw, seconds] of [[{ duration_secs: '5700' }, 5700], [{ duration: '01:35:00' }, 5700], [{ duration: 95 }, 0], [{ duration: '01:90:00' }, 0], [{ duration_secs: -1 }, 0], [{}, 0]]) {
  api.call = async () => [{ stream_id: 1, ...raw }];
  assert.equal((await api.streams('movie'))[0].durationSec, seconds);
  api.call = async () => ({ info: raw });
  assert.equal((await api.vodInfo('1')).durationSec, seconds);
}

// A scroll replaces queued rows, without starting more than two requests.
const lib = new Library({});
const running = new Map(), calls = [], updates = [];
lib.movieDetails = id => {
  calls.push(id);
  return new Promise((resolve, reject) => running.set(id, { resolve, reject }));
};
const movie = id => ({ k: 1, id });
const updated = (id, info) => updates.push([id, info.durationSec]);
lib.warmMovieDurations(['a', 'b', 'c', 'd'].map(movie), updated);
assert.deepEqual(calls, ['a', 'b']);
lib.warmMovieDurations([movie('e'), movie('f')], updated);
running.get('a').resolve({ durationSec: 5700 });
running.get('b').reject(new Error('unavailable'));
await new Promise(resolve => setImmediate(resolve));
assert.deepEqual(calls, ['a', 'b', 'e', 'f']);
running.get('e').resolve({ durationSec: 0 });
running.get('f').resolve({ durationSec: 3600 });
await new Promise(resolve => setImmediate(resolve));
lib.warmMovieDurations([movie('b'), movie('e')], updated);
assert.equal(calls.length, 4, 'failed or missing durations must not retry on every render');
assert.deepEqual(updates, [['a', 5700], ['e', 0], ['f', 3600]]);
lib.details.set('vod:v2:f', { durationSec: 3600 });
const cached = movie('f');
lib.warmMovieDurations([cached, { ...movie('g'), durationSec: 100 }, { k: 0, id: 'live' }], updated);
assert.equal(cached.durationSec, 3600);
assert.equal(calls.length, 4, 'cached durations and non-movie rows need no requests');
console.log('PASS: movie duration normalization/formatting, viewport queue replacement, concurrency limit, cache reuse and failure handling.');
