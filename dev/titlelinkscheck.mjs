#!/usr/bin/env node
// Public title links must resolve trusted IDs or clearly labelled searches.
import assert from 'node:assert/strict';
import { imdbId, trailerUrl, externalMetadata, titleLinks } from '../js/titlelinks.js';
import { XtreamApi } from '../js/api.js';

assert.equal(imdbId('https://www.imdb.com/title/tt4301160/?ref_=x'), 'tt4301160');
for (const value of ['4301160', 'javascript:alert(1)', 'https://imdb.com.evil.test/title/tt4301160/', 'https://user:secret@imdb.com/title/tt4301160/', 'tt123']) assert.equal(imdbId(value), '');
assert.equal(trailerUrl('https://youtu.be/abcdefghijk?t=30'), 'https://www.youtube.com/watch?v=abcdefghijk');
assert.equal(trailerUrl('https://www.youtube.com/embed/abcdefghijk'), 'https://www.youtube.com/watch?v=abcdefghijk');
for (const value of ['javascript:alert(1)', 'https://youtube.com.evil.test/watch?v=abcdefghijk', 'https://user:pass@youtube.com/watch?v=abcdefghijk', 'not-a-trailer']) assert.equal(trailerUrl(value), '');
const metadata = externalMetadata({ imdb_id: 'invalid', imdb: 'tt4301160', tmdb_id: 123, youtube_trailer: 'abcdefghijk' });
assert.equal(metadata.imdbId, 'tt4301160');
const direct = titleLinks({ n: 'Example' }, metadata);
assert.equal(direct.find(x => x.service === 'imdb').href, 'https://www.imdb.com/title/tt4301160/');
assert.deepEqual(direct.map(x => x.service), ['imdb', 'trailer']);
assert.equal(direct.find(x => x.service === 'trailer').href, 'https://www.youtube.com/watch?v=abcdefghijk');
const fallback = titleLinks({ n: 'Name & another / name', year: '2020', id: '123' });
assert.equal(new URL(fallback[0].href).searchParams.get('q'), 'Name & another / name 2020');
assert.equal(fallback[0].search, true);
assert.deepEqual(fallback.map(x => x.service), ['imdb']);
assert.equal(new URL(titleLinks({ n: 'Name (2020)', year: '2020' })[0].href).searchParams.get('q'), 'Name (2020)');
assert(!titleLinks({ n: '' }).length);
// The real API normalizers must retain the identifiers before caching.
const api = new XtreamApi({ host: 'test.invalid' });
api.call = async () => ({ info: { imdb_id: 'tt4301160', tmdb_id: '123', youtube_trailer: 'abcdefghijk', name: 'Example' }, episodes: {}, movie_data: {} });
for (const info of [await api.seriesInfo('1'), await api.vodInfo('2')]) {
  assert.equal(info.imdbId, 'tt4301160');
  assert.equal(info.title, 'Example');
  assert.equal(info.trailer, 'https://www.youtube.com/watch?v=abcdefghijk');
}
console.log('PASS: ID validation, trusted destinations, encoded search fallbacks, optional trailers and API metadata.');
