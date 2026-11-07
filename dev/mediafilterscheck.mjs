#!/usr/bin/env node
import assert from 'node:assert/strict';
import { releaseYear, mediaFacts, filterMedia, emptyFilters, foldOpen } from '../js/mediafilters.js';
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
// The order is the list's own (js/listorder.js, checked in unitcheck.mjs):
// a filter keeps the order the rows came in, and an old stored sort is
// not one of the filters.
assert.deepEqual(ids({}), ['a', 'b', 'c', 'd'], 'no filter keeps the source order');
assert.deepEqual(ids({ sort: 'rating' }), ['a', 'b', 'c', 'd'], 'a sort is no longer a filter');
assert.equal('sort' in emptyFilters(), false, 'Reset has no order to clear');
// "Show only favourites" is one filter among the others: it narrows to the
// starred titles and combines with the rest.
const starred = new Set(['b', 'c']);
const favs = filters => filterMedia(entries, { ...emptyFilters(), favs: '1', ...filters }, item => starred.has(item.id)).map(item => item.id);
assert.deepEqual(favs({}), ['b', 'c'], 'only the favourites');
assert.deepEqual(favs({ rating: '9' }), ['c'], 'the favourites and a rating');
assert.deepEqual(filterMedia(entries, { ...emptyFilters(), favs: '1' }).map(item => item.id), [], 'none starred, none shown');
assert.deepEqual(rows.map(item => item.id), ['a', 'b', 'c', 'd'], 'filtering must not mutate the catalogue');
assert.equal(mediaFacts({ rating: 8 }, { rating: 9 }).rating, 9, 'use loaded details consistently with the row');
assert.equal(mediaFacts({}, { rating: 9 }).rating, 9, 'detail ratings use ten points');
assert.equal(mediaFacts({ rating: 11 }).rating, 0, 'reject an invalid rating');
assert.equal(mediaFacts({ n: 'Name (1999)' }, { releaseDate: '2021-01-01' }).year, 2021);

// The length, in whole minutes from either the list or the details, and a
// range that keeps a film whose length is not known yet after the ones that
// fit (its length is read when its row comes on screen).
assert.equal(mediaFacts({ durationSec: 5700 }).minutes, 95);
assert.equal(mediaFacts({ durationSec: 5700 }, { durationSec: 6000 }).minutes, 100, 'the details win over the list');
assert.equal(mediaFacts({}).minutes, 0);
const long = [{ id: 'short', durationSec: 80 * 60 }, { id: 'mid', durationSec: 100 * 60 }, { id: 'epic', durationSec: 180 * 60 }, { id: 'none' }]
  .map(item => ({ item, facts: mediaFacts(item) }));
const lengths = filters => filterMedia(long, { ...emptyFilters(), ...filters }).map(item => item.id);
assert.deepEqual(lengths({ length: '90:120' }), ['mid', 'none']);
assert.deepEqual(lengths({ length: '80:100' }), ['short', 'mid', 'none'], 'both ends are included');
assert.deepEqual(lengths({ length: '0:600' }), ['short', 'mid', 'epic', 'none'], 'an unknown length stays, after the known ones');
assert.deepEqual(lengths({}), ['short', 'mid', 'epic', 'none']);
const api = new XtreamApi({ host: 'test.invalid' });
api.call = async () => [{ stream_id: 1, name: 'Example', release_date: '2023-01-01', genre: 'Drama', rating_5based: 4 }];
const [movie] = await api.streams('movie');
assert.equal(movie.year, 2023);
assert.equal(movie.genre, 'Drama');
api.call = async () => [{ series_id: 1, name: 'Example (2022)' }];
assert.equal((await api.streams('series'))[0].year, 2022);
// A filter fold: open the first time on a wide window, closed on a phone,
// and afterwards as it was left, whatever the width.
assert.equal(foldOpen(undefined), true);
assert.equal(foldOpen(undefined, true), false);
assert.equal(foldOpen(true, true), true);
assert.equal(foldOpen(false), false);
console.log('PASS: the folds’ first state, year extraction, combined filters, missing metadata, rating scale, the order left to the list, favourites only, and API fields.');
