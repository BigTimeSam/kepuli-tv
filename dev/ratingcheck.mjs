#!/usr/bin/env node
import assert from 'node:assert/strict';
import { providerRating, ratingValue, ratingText } from '../js/rating.js';
import { mediaFacts, filterMedia } from '../js/mediafilters.js';
import { XtreamApi } from '../js/api.js';
import { Library } from '../js/library.js';

assert.equal(providerRating({ rating: '7.83', rating_5based: 3.9 }), 7.83);
assert.equal(providerRating({ rating_5based: '4.1' }), 8.2);
assert.equal(providerRating({ rating: 'bad', rating_5based: 4 }), 8);
assert.equal(providerRating({ rating: 4, rating_5based: 2 }), 4, 'a low ten-point rating is not doubled');
assert.equal(ratingText({ rating: 6.163 }), '★ 6.2');
assert.equal(ratingText({ rating: 7 }), '★ 7.0');
for (const rating of [0, null, '', 'bad', NaN, Infinity, -1, 11]) assert.equal(ratingText({ rating }), '');

const lib = new Library({});
const old = { k: 2, id: 'old', n: 'Old cached series', rating: 4 };
const current = { k: 2, id: 'new', n: 'Current series', rating: 4, ratingScale: 10 };
lib.setFull('series', [old, current]);
assert.equal(ratingValue(old), 8);
assert.equal(ratingValue(old), 8, 'repeated reads do not convert twice');
assert.equal(old.rating, 4, 'legacy cache stays intact');
assert.equal(ratingValue(current), 4);
assert.equal(ratingValue({ k: 1, rating: 3.5 }), 7, 'legacy movie lists use the same conversion');
const entries = lib.full.series.map(item => ({ item, facts: mediaFacts(item) }));
assert.deepEqual(filterMedia(entries, { rating: '8' }).map(item => item.id), ['old']);

const api = new XtreamApi({ host: 'test.invalid' });
for (const type of ['movie', 'series']) {
  api.call = async () => [{ stream_id: 1, series_id: 1, name: 'Example', rating: '7.83', rating_5based: 3.9 }];
  const [item] = await api.streams(type);
  assert.equal(item.rating, 7.83);
  assert.equal(item.ratingScale, 10);
  api.call = async () => ({ info: { rating: '7.83' }, episodes: {} });
  const info = type === 'movie' ? await api.vodInfo('1') : await api.seriesInfo('1');
  assert.equal(ratingText(info), ratingText(item), `${type} list and details share the same scale and formatting`);
}
console.log('PASS: ten-point API ratings, five-point fallback, legacy caches, low scores, one decimal, filtering and list/detail consistency.');
