#!/usr/bin/env node
import assert from 'node:assert/strict';
import { releaseYear, mediaFacts, filterMedia, emptyFilters } from '../js/mediafilters.js';
import { XtreamApi } from '../js/api.js';

assert.equal(releaseYear('2024-05-12', 'Name (1999)'), 2024);
assert.equal(releaseYear(null, 'Name (1999)'), 1999);
assert.equal(releaseYear(null, '1917'), 0);
assert.equal(releaseYear('invalid', '2001: A Space Odyssey'), 0);
assert.equal(releaseYear('20245'), 0);
const rows = [
  { id: 'a', n: 'Alpha (2020)', genre: 'Drama, Crime', rating: 8 },
  { id: 'b', n: 'Beta', year: 1999, genre: 'Comedy', rating: 6 },
  { id: 'c', n: 'Gamma', year: 2024, genre: 'crime / Thriller', rating: 9 },
  { id: 'd', n: 'Unknown' },
];
const entries = rows.map(item => ({ item, facts: mediaFacts(item) }));
const ids = filters => filterMedia(entries, { ...emptyFilters(), ...filters }).map(item => item.id);
assert.deepEqual(ids({ year: '2020:2029', genre: 'crime', rating: '9' }), ['c']);
assert.deepEqual(ids({ year: '2020' }), ['a']);
assert.deepEqual(ids({ year: 'missing' }), ['d']);
assert.deepEqual(ids({ genre: 'missing' }), ['d']);
assert.deepEqual(ids({ rating: 'missing' }), ['d']);
assert.deepEqual(ids({ genre: 'fantasy' }), []);
assert.deepEqual(ids({ sort: 'newest' }), ['c', 'a', 'b', 'd']);
assert.deepEqual(ids({ sort: 'oldest' }), ['b', 'a', 'c', 'd']);
assert.deepEqual(ids({ sort: 'rating' }), ['c', 'a', 'b', 'd']);
assert.deepEqual(ids({}), ['a', 'b', 'c', 'd'], 'reset preserves the source order');
assert.deepEqual(rows.map(item => item.id), ['a', 'b', 'c', 'd'], 'sorting must not mutate the catalogue');
assert.equal(mediaFacts({ rating: 8 }, { rating: 9 }).rating, 9, 'use loaded details consistently with the row');
assert.equal(mediaFacts({}, { rating: 9 }).rating, 9, 'detail ratings use ten points');
assert.equal(mediaFacts({ rating: 11 }).rating, 0, 'reject an invalid rating');
assert.equal(mediaFacts({ n: 'Name (1999)' }, { releaseDate: '2021-01-01' }).year, 2021);
const api = new XtreamApi({ host: 'test.invalid' });
api.call = async () => [{ stream_id: 1, name: 'Example', release_date: '2023-01-01', genre: 'Drama', rating_5based: 4 }];
const [movie] = await api.streams('movie');
assert.equal(movie.year, 2023);
assert.equal(movie.genre, 'Drama');
api.call = async () => [{ series_id: 1, name: 'Example (2022)' }];
assert.equal((await api.streams('series'))[0].year, 2022);
console.log('PASS: year extraction, combined filters, missing metadata, rating scale, stable sorting and API fields.');
