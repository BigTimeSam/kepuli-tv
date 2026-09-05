#!/usr/bin/env node
import assert from 'node:assert/strict';
import { nameCleaner, searchNameCleaner } from '../js/name.js';

const groups = [
  { name: 'Finland', cats: [{ id: 'fi' }, { id: 'fi2' }] },
  { name: 'Sweden', cats: [{ id: 'se' }] },
  { name: 'Sport', cats: [{ id: 'sport' }] },
  { name: 'USA', cats: [{ id: 'us' }] },
];
const titles = [
  { n: 'FI - Rosvopankki', cats: ['fi', 'fi2'] },
  { n: 'SE - Rosvopankki', cats: ['se'] },
  { n: 'FI - Rosvopankki', cats: ['sport'] },
  { n: 'F1 - Qualifying', cats: ['sport'] },
  { n: 'US Open Tennis', cats: ['us'] },
  { n: 'USA Network HD', cats: ['us'] },
  { n: 'FI - Unknown category', cats: ['missing'] },
];
const clean = searchNameCleaner(groups, titles);
assert.equal(clean(titles[0].n, titles[0]), 'Rosvopankki');
assert.equal(clean(titles[1].n, titles[1]), 'Rosvopankki');
assert.equal(clean(titles[2].n, titles[2]), 'FI - Rosvopankki', 'identical names in different groups retain their own context');
for (const item of titles.slice(3)) assert.equal(clean(item.n, item), item.n);
const finland = nameCleaner(['Finland'], [titles[0]]);
assert.equal(clean(titles[0].n, titles[0]), finland(titles[0].n), 'search and category display agree');
assert.equal(clean('FI - Rosvopankki S01E02', titles[0]), 'Rosvopankki S01E02', 'the selected title carries its rules into episodes');
assert.equal(titles[0].n, 'FI - Rosvopankki', 'raw metadata stays intact');
assert.deepEqual(searchNameCleaner([], titles)('FI - Rosvopankki', titles[0]), 'FI - Rosvopankki');
console.log('PASS: search/category parity, mixed countries, duplicate titles, conservative prefix handling and inherited episode rules.');
