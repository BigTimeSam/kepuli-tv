#!/usr/bin/env node
// The pure functions, checked in Node without a browser: what goes in and
// what must come out. Fast, and a place for a case that once went wrong.
//
//   node dev/unitcheck.mjs
//
// Exit code 0 when every case holds, 1 otherwise.

// audio.js asks MediaSource what the browser takes, and Node has none.
// The stub says what Chrome and Firefox both say: AAC in an mp4 goes
// through as it is, nothing else does.
globalThis.MediaSource = { isTypeSupported: (type) => /mp4a\.40/.test(type) };

import { parseServer, parsePlaylistUrl, pastedKind, directSource, serverStamp, timeshiftUrl, streamUrl } from '../js/xtream.js';
import { safeUrl, decodeField, XtreamApi, ApiError } from '../js/api.js';
import { playlist } from '../js/external.js';
import { nameCleaner, labelCodes, countryCodes, searchKey, searchTerms, matchesTerms, homeCountryCodes, homeGroup, viewerTags, episodeTitle } from '../js/name.js';
import { Library, buildGroups, cacheTtl } from '../js/library.js';
import { channelKey, internationalChannels, isNationalTopic } from '../js/international.js';
import { unwrap, repeats, check as checkListings } from './listings.mjs';
import { holds } from './glossarycheck.mjs';
import { channelLogo, slugify } from '../js/logos.js';
import { cueText } from '../js/subs.js';
import { subtitleLook, stepScale, pictureHeight, STYLES, MIN_SCALE, MAX_SCALE, DEFAULT_SCALE, SCALE_STEP, SIZE_SHARE, MIN_LIFT, MAX_LIFT, DEFAULT_LIFT } from '../js/subdisplay.js';
import { describe, describeAll, label, preferred, route } from '../js/audio.js';
import { languageSummary, orderedLanguageNames, trackLanguage } from '../js/lang.js';
import { LANGUAGES, keysOf, setLanguage, setEnglishRegion, loadLanguage, supportedLanguage, t, pseudoText } from '../js/i18n.js';
import { setLocale, calendarDate, episodeCode, megabytes, amount, wholePercent } from '../js/format.js';
import { ratingText } from '../js/rating.js';
import { channelPreferences, visibilityFilter, sortChannels, CHANNEL_SORTS } from '../js/channelprefs.js';
import { catchupAvailable, archiveDays, reminderDelay, sameChannels } from '../js/epggrid.js';
import { searchProgrammes, mergeSorted, searchableChannels, groupResults } from '../js/programmesearch.js';
import { Epg } from '../js/epg.js';
import { probeCacheTtl } from '../js/probe.js';
import { formatRoute, parseRoute } from '../js/route.js';
import { neighbourTile } from '../js/listnavigation.js';
import { LIST_ORDERS, ORDER_MARKS, ORDER_SETTINGS, listOrder, orderTitles, pressedOrder } from '../js/listorder.js';
import { titleWithoutYear, nameHasYear, nameTags, versionLabels, franchiseKey, relatedTitles, isNew } from '../js/titlemeta.js';
import { boxHeader, parseMoov } from '../js/mp4file.js';
import { parseM3u, parseExtinf, classify, episodeOf, isDivider, shortHash, fillCatchup, catchupAddress, playlistAddress } from '../js/m3u.js';
import { parseXmltv, parseXmltvTime, decodeXml, settle, channelMatchKey } from '../js/xmltv.js';
import { readFileSync } from 'node:fs';

let failed = 0;
let count = 0;
function check(what, actual, expected) {
  count++;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) return;
  failed++;
  console.log(`FAIL  ${what}\n      got      ${a}\n      expected ${e}`);
}

/* ------------------------------------------------ xtream.js: parseServer */

const preferences = channelPreferences({ hiddenChannels: [1, '1'], hiddenCategories: ['sport'], pinned: ['3'], countries: ['Finland'], movieCategories: ['Drama', 'Drama'], channelOrder: ['9'] });
check('preferences keep ids as strings, once, and drop what is no longer kept',
  preferences, { hiddenChannels: ['1'], hiddenCategories: ['sport'], countries: ['Finland'], movieCategories: ['Drama'], seriesCategories: [],
    countriesMode: null, movieCategoriesMode: null, seriesCategoriesMode: null });
check('a filter mode is one of three, anything else none',
  [channelPreferences({ countriesMode: 'favorites' }).countriesMode, channelPreferences({ movieCategoriesMode: 'chosen' }).movieCategoriesMode, channelPreferences({ seriesCategoriesMode: 'some' }).seriesCategoriesMode],
  ['favorites', 'chosen', null]);
const channelRows = [{ k: 0, id: '1', cats: ['news'] }, { k: 0, id: '2', cats: ['sport', 'news'] },
  { k: 0, id: '3', cats: ['news'] }, { k: 1, id: '1' }, { k: 0, id: '4', cats: ['new'] }];
check('hidden channels and categories also filter overlapping categories, without hiding movies',
  channelRows.filter(visibilityFilter(preferences)).map((i) => `${i.k}:${i.id}`), ['0:3', '1:1', '0:4']);

// The list comes in alphabetically, so A–Z is what came in and Z–A its mirror.
const sortable = [{ id: '30', n: 'Alfa', num: 3 }, { id: '10', n: 'Beta', num: 1 }, { id: '20', n: 'Gamma', num: 2 }];
check('A–Z leaves the library order alone', sortChannels(sortable, 'az').map((c) => c.n), ['Alfa', 'Beta', 'Gamma']);
check('Z–A mirrors it', sortChannels(sortable, 'za').map((c) => c.n), ['Gamma', 'Beta', 'Alfa']);
check('the channel number is the provider’s own order', sortChannels(sortable, 'num').map((c) => c.n), ['Beta', 'Gamma', 'Alfa']);
check('a provider that sends no number leaves the stream id to stand for it',
  sortChannels([{ id: '30', n: 'Alfa' }, { id: '10', n: 'Beta' }], 'num').map((c) => c.n), ['Beta', 'Alfa']);
check('equal numbers keep the alphabetical order',
  sortChannels([{ id: 'x', n: 'Alfa' }, { id: 'y', n: 'Beta' }], 'num').map((c) => c.n), ['Alfa', 'Beta']);
check('an unknown sort is the library order', sortChannels(sortable, undefined).map((c) => c.n), ['Alfa', 'Beta', 'Gamma']);
{
  // The visible name decides: "FI: Yle" is Yle once the tag is off, and
  // goes after an untagged Alfa rather than before it.
  const tagged = [{ id: '1', n: 'FI: Yle TV1', num: 1 }, { id: '2', n: 'Alfa TV', num: 2 }, { id: '3', n: 'FI: MTV3', num: 3 }];
  const visible = (name) => name.replace(/^FI: /, '');
  check('the visible name puts the list in order', sortChannels(tagged, 'az', visible).map((c) => c.id), ['2', '3', '1']);
  check('and in reverse', sortChannels(tagged, 'za', visible).map((c) => c.id), ['1', '3', '2']);
  check('the channel number is not the name', sortChannels(tagged, 'num', visible).map((c) => c.id), ['1', '2', '3']);
  check('a label is handed the item as well', sortChannels(tagged, 'az', (name, item) => String(9 - Number(item.id))).map((c) => c.id), ['3', '2', '1']);
}

const now = Date.UTC(2026, 8, 6, 12);
check('archive duration extends the guide', archiveDays([{ archive: 3 }, { archive: 7 }, { archive: Infinity }]), 7);
check('channels without archives keep two days of guide history', archiveDays([]), 2);
check('current archived programme can start over', catchupAvailable({ archive: 7 }, { start: now - 3600e3, stop: now + 3600e3 }, now), true);
check('future programme cannot start over', catchupAvailable({ archive: 7 }, { start: now + 1, stop: now + 3600e3 }, now), false);
check('exact archive boundary is included', catchupAvailable({ archive: 7 }, { start: now - 7 * 86400e3, stop: now - 6 * 86400e3 }, now), true);
check('expired archive cannot play', catchupAvailable({ archive: 3 }, { start: now - 4 * 86400e3, stop: now - 3 * 86400e3 }, now), false);
check('no archive never offers start over', catchupAvailable({ archive: 0 }, { start: now - 1, stop: now + 1 }, now), false);
check('invalid programme has no archive action', catchupAvailable({ archive: 7 }, { start: now - 1, stop: NaN }, now), false);

{
  let active = 0, peak = 0, calls = 0;
  const fakeEpg = { cache: new Map(), isStale(id) { return !this.cache.has(String(id)); }, markUpdated() {},
    remember(id, entry) { this.cache.set(id, entry); }, api: {
    async fullEpg(id, { signal }) {
      calls++; active++; peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active--;
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      if (id === 'bad') throw new Error('Provider failed');
      const p = { start: now, stop: now + 1000, title: 'Aurora Cup', description: 'Live ICE hockey' };
      return [p, p, { ...p, start: now - 2000, stop: now - 1000 }];
    },
  } };
  const channels = [...Array.from({ length: 8 }, (_, i) => ({ id: String(i), epgId: 'epg', n: `Channel ${i}` })),
    { id: 'bad', epgId: 'epg', n: 'Bad channel' }, { id: 'none', n: 'No EPG' }];
  let report;
  await searchProgrammes(fakeEpg, channels, 'ice AURORA', { from: now, to: now + 2000, onProgress: (r) => { report = r; } });
  check('programme search caps parallel requests at four', peak, 4);
  check('programme search matches title and description, removes duplicates and old programmes', report.results.length, 8);
  check('programme search explicitly counts failed channels and skips channels without EPG', [report.done, report.total, report.failed], [9, 9, 1]);
  await searchProgrammes(fakeEpg, channels.slice(0, 8), 'cup', { from: now, to: now + 2000 });
  check('repeated programme search reuses full EPG tables', calls, 9);
  await searchProgrammes(fakeEpg, channels, 'channel 3', { from: now, to: now + 2000, onProgress: (r) => { report = r; } });
  check('programme search finds a channel by its name', report.results.map((r) => r.channel.id), ['3']);
  await searchProgrammes(fakeEpg, channels, 'channel 3 hockey', { from: now, to: now + 2000, onProgress: (r) => { report = r; } });
  check('programme search takes words from the channel and the programme together', report.results.map((r) => r.channel.id), ['3']);
  await searchProgrammes(fakeEpg, channels, 'channel 3 football', { from: now, to: now + 2000, onProgress: (r) => { report = r; } });
  check('programme search still needs every word somewhere', report.results.length, 0);
  {
    const a = { id: 1, n: 'A' }, b = { id: 2, n: 'B' };
    const at = (channel, start) => ({ channel, programme: { start } });
    check('programme results are grouped by channel, the earliest channel first, each in time order',
      groupResults([at(b, 1), at(a, 2), at(b, 3), at(a, 4)]).map((x) => (x.programme ? x.programme.start : `${x.channel.n}${x.count}`)),
      ['B2', 1, 3, 'A2', 2, 4]);
    const many = [1, 2, 3, 4, 5].map((n) => at(a, n));
    const shape = (items) => items.map((x) => (x.programme ? x.programme.start : x.more ? `more${x.more}` : `${x.channel.n}${x.count}${x.open ? '+' : '-'}`));
    check('a channel with many results shows its first three and offers the rest', shape(groupResults(many)), ['A5-', 1, 2, 3, 'more5']);
    check('a channel opened in full shows every result', shape(groupResults(many, new Set(['1']))), ['A5+', 1, 2, 3, 4, 5]);
  }
  const abort = new AbortController();
  fakeEpg.cache.clear(); calls = 0;
  const running = searchProgrammes(fakeEpg, channels, 'cup', { signal: abort.signal, from: now, to: now + 2000 });
  abort.abort(); await running;
  check('cancelled programme search stops queued requests and does not cache late responses', [calls, fakeEpg.cache.size], [4, 0]);
}

const server = (text, expected) => check(`parseServer(${JSON.stringify(text)})`, parseServer(text), expected);

server('', null);
server('   ', null);
server('example.tv', { host: 'example.tv' });
server(' example.tv ', { host: 'example.tv' });
server('example.tv/', { host: 'example.tv' });
server('example.tv:8080', { host: 'example.tv', port: '8080' });
server('192.168.1.10:8080', { host: '192.168.1.10', port: '8080' });
server('http://example.tv:8080', { host: 'example.tv', scheme: 'http', port: '8080' });
server('http://example.tv', { host: 'example.tv', scheme: 'http', port: '80' });
server('https://example.tv', { host: 'example.tv', scheme: 'https', port: '443' });
server('https://Example.TV:8443/', { host: 'example.tv', scheme: 'https', port: '8443' });
server('http://[::1]:8080', { host: '[::1]', scheme: 'http', port: '8080' });
server('http://example.tv:8080/player_api.php?username=u&password=p',
       { host: 'example.tv', scheme: 'http', port: '8080', username: 'u', password: 'p' });
server('http://example.tv:8080/get.php?username=u&password=p&type=m3u_plus&output=ts',
       { host: 'example.tv', scheme: 'http', port: '8080', username: 'u', password: 'p' });
server('http://example.tv:8080/get.php?username=u', { host: 'example.tv', scheme: 'http', port: '8080' });
server('ftp://example.tv', null);
server('http://', null);

check('subscription URL decodes credential components and preserves the port',
  parsePlaylistUrl('http://example.test:8080/get.php?username=demo%2Buser&password=p%26%3D%2B&type=m3u_plus&output=ts'),
  { scheme: 'http', host: 'example.test', port: '8080', username: 'demo+user', password: 'p&=+' });
check('subscription URL uses the HTTPS default port', parsePlaylistUrl('https://example.test/get.php?username=u&password=p')?.port, '443');
check('subscription URL requires both credentials', parsePlaylistUrl('https://example.test/get.php?username=u'), null);
check('subscription URL rejects unsupported protocols', parsePlaylistUrl('ftp://example.test/get.php?username=u&password=p'), null);

// The first field in Settings sends a pasted address to the form it
// belongs to.
check('a pasted address finds its way of connecting', [
  'http://example.test:8080/get.php?username=u&password=p&type=m3u_plus',
  ' https://example.test/player_api.php?username=u&password=p ',
  'http://example.test:8080/c/',
  'http://example.test/stalker_portal/c/index.html',
  'http://example.test/portal.php',
  'http://example.test/list.m3u8',
  'https://example.test/get.php?username=u',
  'example test',
  'ftp://example.test/list.m3u',
  '',
].map(pastedKind), ['xtream', 'xtream', 'stalker', 'stalker', 'stalker', 'm3u', 'm3u', null, null, null]);

/* ------------------------------------------------------- api.js: safeUrl */

const TMDB = 'https://image.tmdb.org/t/p/w600_and_h900_bestv2';
check('a poster address that stops at the folder is not requested', safeUrl(TMDB), null);
check('the same address with the file on the end', safeUrl(`${TMDB}/cuFPxoFopAjFUz4oIMUzpzeTA8I.jpg`),
  `${TMDB}/cuFPxoFopAjFUz4oIMUzpzeTA8I.jpg`);
check('a bare host', safeUrl('https://cdn.example.test'), null);
check('a trailing slash', safeUrl('https://cdn.example.test/logos/'), null);
check('a file name', safeUrl('https://cdn.example.test/logos/mtv3.png'), 'https://cdn.example.test/logos/mtv3.png');
check('a query is left to the server', safeUrl('https://cdn.example.test/logo?ch=5'), 'https://cdn.example.test/logo?ch=5');
check('a GitHub page rewritten to the raw file',
  safeUrl('https://github.com/tv-logo/tv-logos/blob/main/countries/nordic/finland/mtv3-fi.png?raw=true'),
  'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/nordic/finland/mtv3-fi.png');
check('a GitHub page that names no file', safeUrl('https://github.com/tv-logo/tv-logos/blob/main/countries'), null);
check('the junk the server sends', [safeUrl('['), safeUrl('[""]'), safeUrl(''), safeUrl(null), safeUrl(42)],
  [null, null, null, null, null]);
check('a scheme that is not the web', safeUrl('ftp://example.test/logo.png'), null);

/* -------------------------------------------------- name.js: searchKey */

check('searchKey folds a letter with a mark', searchKey('Eläinkanava'), 'elainkanava');
check('searchKey folds the Nordic vowels', [searchKey('Södergran'), searchKey('Åland'), searchKey('NRK Sápmi')],
  ['sodergran', 'aland', 'nrk sapmi']);
check('searchKey folds the letters NFD leaves whole', [searchKey('Øresund'), searchKey('Æther'), searchKey('Straße')],
  ['oresund', 'aether', 'strasse']);
check('searchKey leaves a plain name alone', searchKey('CNN News HD'), 'cnn news hd');
check('searchKey takes nothing for nothing', [searchKey(''), searchKey(null), searchKey(undefined)], ['', '', '']);
check('searchTerms splits on any run of space', searchTerms('  CNN \t  News '), ['cnn', 'news']);
check('searchTerms of an empty query is empty', searchTerms('   '), []);
check('matchesTerms ignores the order the words were typed',
  [matchesTerms(searchKey('News CNN'), searchTerms('cnn news')), matchesTerms(searchKey('CNN'), searchTerms('cnn news'))],
  [true, false]);
check('matchesTerms with no terms matches anything', matchesTerms(searchKey('whatever'), searchTerms('')), true);

/* ------------------------------------------------ library.js: search */

// The search index is built by setFull, so the list goes in through it.
const searchable = (...names) => {
  const lib = new Library({});
  lib.setFull('live', names.map((n, i) => ({ id: String(i + 1), k: 0, n, cats: [] })));
  return (query) => lib.search('live', query).map((item) => item.n);
};
const found = searchable('Eläinkanava', 'Yle TV1 HD', 'News CNN', 'CNN News HD', 'Pink Style', 'Øresund Sport');
check('a search without the marks finds the name that has them', found('elain'), ['Eläinkanava']);
check('a search with the marks finds it too', found('eläin'), ['Eläinkanava']);
check('a folded name is found by its folded query', found('oresund'), ['Øresund Sport']);
check('a word at the start of a name beats one inside another word', found('yle'), ['Yle TV1 HD', 'Pink Style']);
check('the words may come in either order', found('news cnn'), ['News CNN', 'CNN News HD']);
check('a name that reads as typed comes first all the same', found('cnn news'), ['CNN News HD', 'News CNN']);
check('every word has to be there', found('cnn eurosport'), []);
check('a query of nothing matches nothing found', found('zzz'), []);

/* ------------------------------------------------- name.js: nameCleaner */

const items = (...names) => names.map((n) => ({ n }));
function cleaned(labels, names) {
  const clean = nameCleaner(labels, items(...names));
  return names.map((n) => (clean ? clean(n) : n));
}
const tidy = (what, labels, names, expected) => check(`nameCleaner ${what}`, cleaned(labels, names), expected);

// The chosen country's codes go whatever their share, in every spelling
// and behind every separator.
tidy('mixed tags under Finland', ['Finland'],
     ['FI: Yle TV1', 'FIN | MTV3', 'FI - MTV', 'Yle Teema', '|FI| Sub HD', 'Finland: Ava'],
     ['Yle TV1', 'MTV3', 'MTV', 'Yle Teema', 'Sub HD', 'Ava']);
tidy('a lone tag among untagged rows', ['Finland'],
     ['FI: MTV', 'Yle TV1', 'Yle TV2', 'Yle Teema', 'Yle Areena'],
     ['MTV', 'Yle TV1', 'Yle TV2', 'Yle Teema', 'Yle Areena']);
tidy('the Finnish spelling of the country', ['Suomi'], ['FI: Yle TV1', 'Yle TV2'], ['Yle TV1', 'Yle TV2']);
tidy('a topic under the country', ['Finland', 'Sport'], ['FI: Sport 1', 'FIN: Viasat Sport'], ['Sport 1', 'Viasat Sport']);
tidy('the topic as a tag', ['Finland', 'Sport'], ['FI: Sport | Liiga 1', 'FI: Sport - Liiga 2', 'FI: Sportti'], ['Liiga 1', 'Liiga 2', 'Sportti']);
tidy('the country in the label with more words', ['Finland HD'], ['FI: Yle TV1 HD'], ['Yle TV1 HD']);
tidy('United Kingdom', ['United Kingdom'], ['UK: BBC One', 'GB | ITV', 'ENG: Sky News'], ['BBC One', 'ITV', 'Sky News']);
tidy('a column named with the code', ['FI'], ['FI: Yle TV1', 'Yle TV2'], ['Yle TV1', 'Yle TV2']);
tidy('EX-YU', ['EX-YU'], ['EX-YU | RTS 1', 'YU: HRT 1'], ['RTS 1', 'HRT 1']);

// Another country's code is not the chosen one's: it stays, unless it is
// the majority as before.
tidy('a foreign tag under Finland', ['Finland'], ['SE: SVT1', 'FI: Yle TV1', 'FI: Yle TV2'], ['SE: SVT1', 'Yle TV1', 'Yle TV2']);
tidy('a majority code under a topic', ['NHL'], ['US: NHL Ice Center 1', 'US: NHL Ice Center 2', 'CA: NHL Ice Center 3'],
     ['Ice Center 1', 'Ice Center 2', 'CA: NHL Ice Center 3']);
tidy('the label as a tag versus the label as a name', ['USA'], ['USA: NBC', 'USA Network HD'], ['NBC', 'USA Network HD']);
tidy('the label with a dash under its own topic', ['NHL'], ['NHL - Game 1', 'NHL - Game 2'], ['Game 1', 'Game 2']);

// What must not be touched.
tidy('a name that starts like the country', ['USA'], ['US: NBC', 'US: CBS', 'US: ABC', 'USA Network HD'],
     ['NBC', 'CBS', 'ABC', 'USA Network HD']);
tidy('a word, not a code', ['USA'], ['US Open Tennis', 'US: NBC'], ['US Open Tennis', 'NBC']);
tidy('a dash without spaces', ['Finland'], ['FI-Yle TV1'], ['FI-Yle TV1']);
tidy('F1 under Sport', ['Sport'], ['F1 - Qualifying', 'F1 - Race', 'NHL - Game 1'], ['F1 - Qualifying', 'F1 - Race', 'NHL - Game 1']);
tidy('nothing but the tag', ['Finland'], ['FI:', 'FI: Yle'], ['FI:', 'Yle']);
tidy('no labels: the majority rule alone', [], ['FI: A', 'FI: B', 'C'], ['A', 'B', 'C']);
tidy('no labels, no majority', [], ['FI: A', 'SE: B', 'C', 'D'], ['FI: A', 'SE: B', 'C', 'D']);
check('nameCleaner with nothing to strip is null', nameCleaner(['Sport'], items('Eurosport 1', 'Eurosport 2')), null);
check('nameCleaner with no items is null', nameCleaner(['Finland'], []), null);

// The country a label names, for the logo lookup rather than for the list.
check('a label names its country', labelCodes('Finland'), ['fi', 'fin']);
check('a label that is the code the provider writes', labelCodes('FI'), ['fi', 'fin']);
check('a code further along a label is a word', labelCodes('Movies in English'), []);
{
  // An episode's row on its series' page: neither the series' name nor the
  // code the row shows beside it.
  const long = ['Tämä on pitkä sarjan nimi'];
  check('episode title: series name and code only, nothing left', episodeTitle('Tämä on pitkä sarjan nimi – S01E01', { series: long }), null);
  check('episode title: series name and code before the title', episodeTitle('Tämä on pitkä sarjan nimi S01E02 - Paluu', { series: long }), 'Paluu');
  check('episode title: folded case and a spaced code', episodeTitle('tämä on PITKÄ sarjan nimi - s1 e3', { series: long }), null);
  check('episode title: country prefix, year and code', episodeTitle('FI: Silent Fjord (2015) S01E03 Crossing', { series: ['FI: Silent Fjord (2015)', 'Silent Fjord'] }), 'Crossing');
  check('episode title: 1x04 and dashes', episodeTitle('Silent Fjord - 1x04 - Static', { series: ['Silent Fjord'] }), 'Static');
  check('episode title: a colon after the series', episodeTitle('Silent Fjord: Low Tide', { series: ['Silent Fjord'] }), 'Low Tide');
  check('episode title: a title that only begins like the series stays whole', episodeTitle('Lost Souls', { series: ['Lost'] }), 'Lost Souls');
  check('episode title: an own title is left alone', episodeTitle('Northbound', { series: ['Silent Fjord'] }), 'Northbound');
  check('episode title: a bare code is nothing', episodeTitle('S01E05', { series: ['Silent Fjord'] }), null);
}
{
  // The first country a new account's channels open at.
  const groups = ['Canada', 'United Kingdom', 'Finland', 'FI| Finland VIP', 'Sverige', 'Österreich', 'USA'].map((name) => ({ name }));
  check('home country: the browser\'s language', homeGroup(groups, ['fi']), 'Finland');
  check('home country: a region before its language, English included', [homeGroup(groups, ['de-AT', 'de']), homeGroup(groups, ['en-FI', 'fi-FI']), homeGroup(groups, ['en-SE'])], ['Österreich', 'Finland', 'Sverige']);
  check('home country: US and British English say nothing, the next language does', [homeGroup(groups, ['en-US', 'sv']), homeGroup(groups, ['en-GB', 'en-US', 'en', 'fi'])], ['Sverige', 'Finland']);
  check('home country: British English is not the United Kingdom', homeGroup(groups, ['en-GB', 'en']), 'Canada');
  check('home country: none of the browser\'s countries, the first group', [homeGroup(groups, ['en-US', 'en']), homeGroup(groups, ['ja-JP']), homeGroup(groups, [])], ['Canada', 'Canada', 'Canada']);
  check('home country: no groups', homeGroup([], ['fi']), null);
  // What the app hands homeGroup: with the interface language on "auto" the
  // browser's region must still win over its language's country.
  const fromSettings = (lang, langs) => homeGroup(groups, viewerTags(lang, langs));
  check('home country: an automatic interface language does not hide the region', [fromSettings('auto', ['de-AT', 'de']), fromSettings(undefined, ['sv-FI', 'sv']), fromSettings('auto', ['en-SE', 'en'])], ['Österreich', 'Finland', 'Sverige']);
  check('home country: a language chosen in Settings leads', [fromSettings('sv', ['de-AT', 'de']), fromSettings('fi', ['en-US', 'en'])], ['Sverige', 'Finland']);
  check('home country: the tags handed on', [viewerTags('auto', ['de-AT', 'de']), viewerTags('fi', ['en-GB']), viewerTags(undefined, undefined)], [['de-AT', 'de'], ['fi', 'en-GB'], []]);
  check('home country: the codes in order, a script skipped, a number no region', homeCountryCodes(['sr-Latn-RS', 'pt-PT', 'nb', 'es-419', 'en-US', 'en']), ['rs', 'pt', 'br', 'no', 'es']);
}
check('a whole country name only, for a folder', countryCodes('world latin america'), []);
check('a folder that is a country', countryCodes('finland'), ['fi', 'fin']);
check('a code is not a name', countryCodes('fi'), []);

/* ------------------------------------------------- logos.js: channelLogo */

check('slugify drops the quality tag and the punctuation', slugify('Yle TV1 HD'), 'yle-tv1');
check('slugify folds the accents away', slugify('TRT Genç'), 'trt-genc');
check('slugify keeps a name that is nothing but a tag', slugify('HD'), 'hd');
check('slugify on nothing', slugify(''), '');

// The address is checked whole once; after that the file name is enough to
// say which logo was chosen.
check('the whole address', channelLogo('FI: MTV3 HD', ['fi']),
  'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/nordic/finland/mtv3-fi.png');

const logo = (name, ...codes) => {
  const url = channelLogo(name, codes);
  return url ? url.slice(url.lastIndexOf('/') + 1) : null;
};
const picks = (what, name, codes, expected) => check(`channelLogo ${what}`, logo(name, ...codes), expected);

// The name's own tag is a country hint as good as the category's, and the
// quality tag on the end belongs to neither.
picks('the tag in front of the name', 'FI: MTV3 HD', [], 'mtv3-fi.png');
picks('the category behind the row', 'MTV3', ['fi'], 'mtv3-fi.png');
picks('a name unique in the whole collection', 'MTV3', [], 'mtv3-fi.png');
picks('the tag in bars', '|FIN| Yle TV1', [], 'yle-tv1-fi.png');
picks('a tag that is no country code', 'MTV3 | HD', [], 'mtv3-fi.png');

// The same name in several countries: the channel's own decides, and
// without one there is no answer to give.
picks('TV3 under Sweden', 'TV3', ['se'], 'tv3-se.png');
picks('TV3 under Denmark', 'TV3', ['dk'], 'tv3-dk.png');
picks('TV3 under nothing at all', 'TV3', [], null);
picks('a brand every country has, from the neutral folder', 'Cartoon Network', [], 'cartoon-network-int.png');
picks('the name’s own tag outranks the shelf it stands on', 'SE: TV3', ['dk'], 'tv3-se.png');

// Where the words of a name end, and what the channel is filed under.
picks('the word breaks ignored', 'FI: SkyShowtime 1', [], 'sky-showtime-1-fi.png');
picks('a space inside the name', 'DK: TV 2 News', [], 'tv2-news-dk.png');
picks('the channel filed under its owner', 'FI: Sub HD', [], 'mtv-sub-fi.png');
picks('a tail two files share resolves to neither', 'DK: Hits', [], null);
picks('a tail is looked for in the country only', 'Sub', [], null);

// The provider's notes about the row: dropped whatever they say, and read
// for a country before they go.
picks('a note on the end', 'Liiga 1 FHD [Live During Events Only]', ['fi'], 'mtv-liiga-1-fi.png');
picks('a note in parentheses', 'Sub (Backup)', ['fi'], 'mtv-sub-fi.png');
picks('a note in front of the name', '(VIP) MTV3', ['fi'], 'mtv3-fi.png');
picks('the country a note names outranks the shelf', 'TV3 (Norway)', ['dk'], 'tv3-no.png');
picks('a note that is the country’s code', 'TV3 (NO)', ['dk'], 'tv3-no.png');
picks('a note opened and never closed', 'Sub [Backup', ['fi'], null);

// What must not be answered at all.
picks('a name the collection does not have', 'FI: Yle Areena', [], null);
picks('a note does not make an ambiguous name answerable', 'DK: Hits [Backup]', [], null);
picks('an empty name', '', ['fi'], null);

/* ------------------------------------------- config.js: per-account lists */

// The extension API, faked: storage.local as a plain object. Installed
// before config.js is imported, which is why the import is dynamic.
const stored = {};
const clone = (v) => JSON.parse(JSON.stringify(v));
globalThis.chrome = { storage: { local: {
  async get(keys) { const out = {}; for (const k of keys == null ? Object.keys(stored) : [].concat(keys)) if (k in stored) out[k] = clone(stored[k]); return out; },
  async set(obj) { for (const [k, v] of Object.entries(obj)) stored[k] = clone(v); },
  async remove(keys) { for (const k of [].concat(keys)) delete stored[k]; },
  async clear() { for (const k of Object.keys(stored)) delete stored[k]; },
} } };
const store = await import('../js/config.js');
const accountA = { scheme: 'http', host: 'a.example', port: '8080', username: 'ann', password: 'x' };
const accountB = { scheme: 'http', host: 'b.example', port: '8080', username: 'bob', password: 'y' };
const item = (k, id, n) => ({ k, id, n });
const favs = async () => [...(await store.loadFavorites()).values()].map((i) => i.n);
// The tab's account is the one it connects with, as js/app.js does it.
const connectTab = async () => store.useAccount(await store.loadConfig());

// Before this version there was one set of lists, whoever the account was;
// the account in use adopts it and the old key is retired.
stored.config = accountA;
stored.favorites = [item(0, '1', 'Yle TV1')];
stored.resume = { '1:5': { position: 60, duration: 120, at: 1 } };
await connectTab();
check('the old favourites are adopted by the account in use', await favs(), ['Yle TV1']);
check('the old key is retired', 'favorites' in stored, false);
check('the account key holds them', Object.keys(stored).filter((k) => k.startsWith('favorites:')), ['favorites:http://a.example:8080/ann']);
check('the old resume points are adopted too', [...(await store.loadResume()).keys()], ['1:5']);

// Another account sees nothing of the first, and its own lists go under its own key.
stored.config = accountB;
await connectTab();
check('another account starts with no favourites', await favs(), []);
check('another account starts with no resume points', (await store.loadResume()).size, 0);
check('another account starts with no history', await store.loadRecents(), []);
await store.setFavorite('0:9', item(0, '9', 'SVT1'));
await store.pushRecent(item(1, '7', 'Film'));
check('its favourites are its own', await favs(), ['SVT1']);
check('its history is its own', (await store.loadRecents()).map((r) => r.n), ['Film']);

// Back to the first account: everything is where it was left.
stored.config = accountA;
await connectTab();
check('switching back finds the favourites again', await favs(), ['Yle TV1']);
check('and the resume points', [...(await store.loadResume()).keys()], ['1:5']);
check('and no history from the other account', await store.loadRecents(), []);
// A change that keeps the account keeps the lists.
await store.saveConfig({ streamMode: 'hls' });
check('a playback-mode change keeps the lists', await favs(), ['Yle TV1']);
await store.saveChannelPreferences(preferences);
stored.config = accountB;
await connectTab();
check('channel presentation belongs to its account', await store.loadChannelPreferences(), channelPreferences());
stored.config = accountA;
await connectTab();
check('switching back restores hidden channels and their order', await store.loadChannelPreferences(), preferences);

// Another tab switching the stored account does not move this one: its
// next resume point and favourite still go to the account it shows.
{
  stored.config = accountA;
  await connectTab();
  stored.config = { ...accountB };                    // saved by another tab
  await store.saveConfig({ streamMode: 'auto' });
  await store.setResume('1:6', { position: 30, duration: 90, at: 2 });
  check('a resume point saved after another tab switched stays with this tab\'s account', Object.keys(stored['resume:http://a.example:8080/ann']).sort(), ['1:5', '1:6']);
  check('and the other account\'s resume points are untouched', stored['resume:http://b.example:8080/bob'], undefined);
  const settingsOnly = await store.saveSetup(null, { theme: 'light' });
  check('a settings-only save hands back no configuration to take over', settingsOnly.config, null);
  check('and leaves the stored one alone', stored.config.host, 'b.example');
  stored.config = accountA;
}

// One change at a time, from the stored list: what another tab added in the
// meantime is kept.
{
  await connectTab();
  await store.setFavorite('0:2', item(0, '2', 'Yle TV2'));       // "another tab"
  const memory = new Map([['0:3', item(0, '3', 'MTV3')]]);    // this tab never saw TV2
  await store.setFavorite('0:3', memory.get('0:3'));
  check('a favourite added in one tab survives another\'s', await favs(), ['Yle TV1', 'Yle TV2', 'MTV3']);
  await store.setFavorite('0:2', null);
  check('a favourite taken away takes only itself', await favs(), ['Yle TV1', 'MTV3']);
  const [first, second] = await Promise.all([store.pushRecent(item(0, '1', 'Yle TV1')), store.pushRecent(item(0, '3', 'MTV3'))]);
  check('two history entries at once both land', (await store.loadRecents()).map((r) => r.n).slice(0, 2), ['MTV3', 'Yle TV1']);
  check('each change resolves to the list it wrote', [first.length, second.length], [1, 2]);
  const now = Date.now();
  const reminder = (id, start) => ({ channel: item(0, id, 'C' + id), title: 'P' + id, start, stop: start + 3600e3 });
  await store.setReminder('5:' + (now + 1000), reminder('5', now + 1000));
  await store.setReminder('6:' + (now + 9e6), reminder('6', now + 9e6));
  check('the reminders due are taken once', (await store.takeDueReminders(now + 60e3)).map((r) => r.title), ['P5']);
  check('and a second tab finds them gone', (await store.takeDueReminders(now + 60e3)).length, 0);
  check('the rest stay', (await store.loadReminders()).map((r) => r.title), ['P6']);
}

// The account key: one spelling for one address.
check('accountKey: the host in any case, a blank port as the scheme\'s own', [
  store.accountKey({ scheme: 'http', host: 'Example.TV', port: '', username: 'Ann' }),
  store.accountKey({ scheme: 'HTTPS', host: 'example.tv ', port: '443', username: 'Ann' }),
  store.accountKey({ scheme: 'http', host: 'example.tv', port: '080', username: 'Ann' }),
  store.accountKey({ scheme: 'http', host: 'example.tv', port: '8080', username: 'Ann' }),
], ['http://example.tv:80/Ann', 'https://example.tv:443/Ann', 'http://example.tv:80/Ann', 'http://example.tv:8080/Ann']);
{
  const data = {
    'favorites:http://Example.tv:/ann': ['blank port'],
    'favorites:http://example.tv:80/ann': ['already normal'],
    'recents:http://Example.tv:/ann': ['typed'],
    'recents:http://example.tv:80/ann': ['pasted'],
    'resume:https://Other.tv:/bob': { '1:1': {} },
    'channels:http://example.tv:8080/ann': {},
    'favorites': ['bare, adopted elsewhere'],
    'settings': {},
  };
  const moved = store.accountKeyMigration(data, 'http://Example.tv:/ann');
  check('migration: old spellings are removed', moved.remove.sort(), ['favorites:http://Example.tv:/ann', 'recents:http://Example.tv:/ann', 'resume:https://Other.tv:/bob']);
  check('migration: the spelling in use wins over one already normal', moved.set['favorites:http://example.tv:80/ann'], ['blank port']);
  check('migration: and over another', moved.set['recents:http://example.tv:80/ann'], ['typed']);
  check('migration: another account moves on its own', moved.set['resume:https://other.tv:443/bob'], { '1:1': {} });
  check('migration: a key already normal is not rewritten', 'channels:http://example.tv:8080/ann' in moved.set, false);
  const other = store.accountKeyMigration(data, 'http://example.tv:80/ann');
  check('migration: with the normal one in use, it stays', 'favorites:http://example.tv:80/ann' in other.set, false);
  check('migration: and the other spelling keeps its lists rather than losing them', other.remove.includes('favorites:http://Example.tv:/ann'), false);
  for (const key of Object.keys(stored)) delete stored[key];
  Object.assign(stored, clone(data), { config: { scheme: 'http', host: 'Example.tv', port: '', username: 'ann', password: 'p' } });
  await store.migrateAccountKeys(stored.config);
  await connectTab();
  check('migrated: a tab connecting with the old spelling finds its lists', stored['favorites:http://example.tv:80/ann'], ['blank port']);
  check('migrated: the history under the normal key', await store.loadRecents(), ['typed']);
  check('migrated: no old spelling left', Object.keys(stored).filter((k) => k.includes('Example') || k.includes('Other')), []);
  // The same user at a provider's new address: the lists are offered and copied.
  const moving = { scheme: 'https', host: 'new.example.tv', port: '', username: 'ann', password: 'p' };
  check('a new address starts without lists', await store.accountHasLists(moving), false);
  check('the old one has them', await store.accountHasLists(stored.config), true);
  await store.copyAccountLists(stored.config, moving);
  check('copied to the new address', stored['recents:https://new.example.tv:443/ann'], ['typed']);
  check('and kept under the old one', stored['recents:http://example.tv:80/ann'], ['typed']);
}

/* ---------------------------------------------------- subs.js: cueText */

const bytes = (text) => new TextEncoder().encode(text);
const srt = (what, text, expected) => check(`cueText SRT ${what}`, cueText('S_TEXT/UTF8', bytes(text)), expected);
const ass = (what, text, expected) => check(`cueText ASS ${what}`, cueText('S_TEXT/ASS', bytes(text)), expected);

srt('keeps italics', '<i>Hello</i>\r\nthere', '<i>Hello</i>\nthere');
srt('drops font tags but keeps their text', '<font color="#ffff00">Hello</font>', 'Hello');
srt('escapes a bare < that would open a tag', 'a < b and c<d', 'a &lt; b and c&lt;d');
srt('leaves a kept tag alone beside a bare <', '<b>x</b> < y', '<b>x</b> &lt; y');
srt('strips stray ASS codes', '{\\an8}Up here', 'Up here');
ass('takes the text after eight commas', '0,0,Default,,0,0,0,,One, two\\Nthree', 'One, two\nthree');
ass('drops style codes and escapes <', '0,0,Default,,0,0,0,,{\\i1}a < b', 'a &lt; b');
ass('drops a drawing', '0,0,Default,,0,0,0,,{\\p1}m 0 0 l 100 0', '');

/* ---------------------------------------------- subdisplay.js: the look */

check('subtitleLook defaults', subtitleLook({}), { style: 'shadow', scale: DEFAULT_SCALE, lift: DEFAULT_LIFT });
check('subtitleLook defaults on nothing', subtitleLook(null), { style: 'shadow', scale: DEFAULT_SCALE, lift: DEFAULT_LIFT });
check('subtitleLook keeps a known choice', subtitleLook({ subtitleStyle: 'yellow', subtitleScale: 135, subtitleLift: 12 }), { style: 'yellow', scale: 135, lift: 12 });
check('the height keeps 0, rounds, and holds to the bounds', [0, 7.6, -4, 99, 'x'].map((lift) => subtitleLook({ subtitleLift: lift }).lift), [0, 8, MIN_LIFT, MAX_LIFT, DEFAULT_LIFT]);
check('subtitleLook takes a size written as text', subtitleLook({ subtitleScale: '140' }).scale, 140);
check('subtitleLook rounds a size to the slider\'s step', subtitleLook({ subtitleScale: 121 }).scale, 120);
check('subtitleLook holds a size to the bounds', [subtitleLook({ subtitleScale: 1 }).scale, subtitleLook({ subtitleScale: 900 }).scale], [MIN_SCALE, MAX_SCALE]);
check('subtitleLook replaces an unknown choice', subtitleLook({ subtitleStyle: 'neon', subtitleScale: 'huge' }), { style: 'shadow', scale: DEFAULT_SCALE, lift: DEFAULT_LIFT });
// The pixels of the older versions become the same share of their default:
// whoever had made the text larger still has it larger.
check('subtitleLook reads the older pixels', [24, 36, 18, 72].map((px) => subtitleLook({ subtitleSize: px }).scale), [100, 150, 75, 250]);
check('subtitleLook reads the oldest names', ['small', 'medium', 'large'].map((s) => subtitleLook({ subtitleSize: s }).scale), [75, 100, 140]);
check('a size of its own outranks the older pixels', subtitleLook({ subtitleScale: 90, subtitleSize: 40 }).scale, 90);
check('+ and − step by ten, within the bounds', [stepScale(100, 1), stepScale(100, -1), stepScale(MAX_SCALE, 1), stepScale(MIN_SCALE, -1)], [110, 90, MAX_SCALE, MIN_SCALE]);
check('the picture without its bars: a film on a 16:10 screen', Math.round(pictureHeight(1512, 982, 1920, 1080)), 851);
check('the picture fills a box of its own shape', pictureHeight(1280, 720, 1280, 720), 720);
check('a box narrower than the picture: the height is the box\'s', pictureHeight(800, 1000, 1920, 1080), 450);
check('no picture yet: taken as 16:9', pictureHeight(1920, 1200, 0, 0), 1080);
// Every look has a rule in the stylesheet and an option in the menu, in the
// same order; the slider's bounds are the module's.
{
  const html = (await import('node:fs')).readFileSync(new URL('../player.html', import.meta.url), 'utf8');
  const sheet = (await import('node:fs')).readFileSync(new URL('../css/player.css', import.meta.url), 'utf8');
  check('player.css sizes the layer with the module\'s share', sheet.includes(`* var(--sub-scale, 1) * ${SIZE_SHARE})`), true);
  for (const style of STYLES) {
    check(`player.css draws the look "${style}"`, sheet.includes(`body[data-substyle="${style}"] .videowrap .subdisplay .cue`), true);
  }
  // The controls exist twice — f in the settings, p over the picture (see
  // LOOK_FORMS in app.js) — and each copy is checked on its own: a look
  // offered by only one of them is exactly the drift that writing both on
  // every change is meant to prevent.
  for (const form of ['f', 'p']) {
    const menu = html.match(new RegExp(`<select id="${form}-substyle">([^]*?)</select>`));
    const offered = menu && [...menu[1].matchAll(/<option value="(\w+)" data-i18n="subs\.style\.\w+">/g)].map((m) => m[1]);
    check(`player.html offers the looks in the module's order (${form})`, offered, STYLES);
    const slider = html.match(new RegExp(`<input id="${form}-subsize" type="range" min="(\\d+)" max="(\\d+)" step="(\\d+)" value="(\\d+)"`));
    check(`player.html's slider has the module's bounds, step and default (${form})`, slider && slider.slice(1).map(Number), [MIN_SCALE, MAX_SCALE, SCALE_STEP, DEFAULT_SCALE]);
    const lift = html.match(new RegExp(`<input id="${form}-sublift" type="range" min="(\\d+)" max="(\\d+)" step="1" value="(\\d+)"`));
    check(`player.html's height slider has the module's bounds and default (${form})`, lift && lift.slice(1).map(Number), [MIN_LIFT, MAX_LIFT, DEFAULT_LIFT]);
  }
  // The same for the channel order: a value the settings offer but the
  // sorting does not know would silently leave the list alphabetical.
  const orders = html.match(/<select id="f-channelsort">([^]*?)<\/select>/);
  const offered = orders && [...orders[1].matchAll(/<option value="(\w+)" data-i18n="setup\.channelsort\.\w+">/g)].map((m) => m[1]);
  check("player.html offers the channel orders in the module's order", offered, CHANNEL_SORTS);
}

/* --------------------------------------------------- audio.js: the track */

// A TrackEntry as ebml.js hands it over. Only the fields the choice reads.
const track = (number, codecId, extra = {}) => ({ type: 2, number, codecId, ...extra });

check('route: AAC goes through as it is', route('A_AAC'), 'passthrough');
check('route: AC-3 is decoded in the player', route('A_AC3'), 'decoded');
check('route: E-AC-3 is decoded in the player', route('A_EAC3'), 'decoded');
check('route: TrueHD has no route', route('A_TRUEHD'), null);
// MP3 and FLAC in MKV: the browser knows the codec, but mp4.js can write
// no sample entry for them, so they are not passed on either.
check('route: MP3 in MKV has no route', route('A_MPEG/L3'), null);
check('route: FLAC in MKV has no route', route('A_FLAC'), null);

const pick = (what, tracks, language, expected) =>
  check(`preferred(${what}, ${JSON.stringify(language)})`,
        (preferred(describeAll(tracks), language) || {}).number ?? null, expected);

// An untouched track beats a decoded one even when the file marks the
// decoded one default: that is what saves discs carrying both AC-3 and AAC.
const dual = [track(1, 'A_AC3', { lang: 'eng', isDefault: true }), track(2, 'A_AAC', { lang: 'fin' })];
pick('AC-3 default + AAC', dual, 'auto', 2);
pick('AC-3 default + AAC', dual, null, 2);
// The language decides before the route: an English AC-3 is worth decoding
// when English is what was asked for.
pick('AC-3 default + AAC', dual, 'eng', 1);
pick('AC-3 default + AAC', dual, 'fi', 2);
// A language the file does not have falls back to the automatic choice.
pick('AC-3 default + AAC', dual, 'sv', 2);

// The file's own default decides between two tracks of the same route;
// without the flag the file's order does.
const two = [track(1, 'A_AAC', { lang: 'eng' }), track(2, 'A_AAC', { lang: 'ger', isDefault: true })];
pick('AAC + AAC default', [track(1, 'A_AAC', { lang: 'eng', isDefault: false }), two[1]], 'auto', 2);
pick('AAC + AAC, neither flagged', two.map((t) => ({ ...t, isDefault: undefined })), 'auto', 1);

// A commentary answers no language choice unless it is asked for by
// language, or unless it is all the file has.
const commented = [
  track(1, 'A_AAC', { lang: 'eng', name: 'Commentary' }),
  track(2, 'A_AAC', { lang: 'ger' }),
];
pick('commentary + German', commented, 'auto', 2);
pick('commentary + German', commented, 'en', 1);
pick('commentary alone', [commented[0]], 'auto', 1);

// Nothing plays: no track is offered rather than a wrong one.
pick('TrueHD alone', [track(1, 'A_TRUEHD', { lang: 'eng' })], 'auto', null);
// The one that used to be reported silent: the default cannot be played,
// but the other one can be decoded.
pick('TrueHD default + AC-3', [track(1, 'A_TRUEHD', { lang: 'eng', isDefault: true }), track(2, 'A_AC3', { lang: 'eng' })], 'auto', 2);

const named = (codecId, extra) => label(describe(track(1, codecId, extra)));
check('label: language and format', named('A_AC3', { lang: 'fin', channels: 6 }), 'Finnish (AC3 5.1)');
check('label: a name that only repeats the language is left out',
      named('A_AAC', { lang: 'fin', channels: 2, name: 'Suomi' }), 'Finnish (AAC stereo)');
check('label: a name that says something is kept',
      named('A_AAC', { lang: 'eng', channels: 2, name: 'Original' }), 'English (Original, AAC stereo)');
check('label: the flag is not spelled twice',
      named('A_AAC', { lang: 'eng', channels: 2, name: 'Commentary' }), 'English (Commentary, AAC stereo)');
check('label: the flag is spelled when the name does not',
      named('A_AC3', { lang: 'eng', channels: 6, commentary: true }), 'English (commentary, AC3 5.1)');
check('label: an unknown language falls back to the name',
      named('A_AAC', { lang: 'und', channels: 2, name: 'Track 1' }), 'Track 1 (AAC stereo)');
check('label: an unknown language with no name says so',
      named('A_AAC', { lang: 'und', channels: 2 }), 'Unknown language (AAC stereo)');
// Matroska's own default for a track that states no language at all.
check('label: no language element at all is English',
      named('A_AAC', { channels: 2 }), 'English (AAC stereo)');
// BCP 47 and ISO 639-2 name the same language, and both occur in files
// from the same library.
check('label: BCP 47 with a region', named('A_AAC', { langBcp: 'sv-SE', channels: 2 }), 'Swedish (AAC stereo)');

/* ------------------------------------------------- lang.js: the languages */

// Matroska gives Language the default value "eng". A file that states no
// language for a track was read as unknown, which put an English subtitle
// track in the selector under "Unknown language" — and played English.
check('trackLanguage: no language element is English', trackLanguage({}), 'eng');
check('trackLanguage: an explicit und stays unknown', trackLanguage({ lang: 'und' }), 'und');
check('trackLanguage: BCP 47 beats ISO 639-2', trackLanguage({ lang: 'eng', langBcp: 'sv-SE' }), 'sv-se');

check('languageSummary: English and Finnish first, the rest alphabetic, then a count',
      languageSummary(['dan', 'nor', 'swe', 'fin', 'eng']), 'English, Finnish, Danish + 2');
check('languageSummary: three names need no count', languageSummary(['swe', 'dan', 'fin']), 'Finnish, Danish, Swedish');
check('languageSummary: the same language written two ways is one language',
      languageSummary(['fin', 'fi', 'fin']), 'Finnish');
check('languageSummary: nothing to name', languageSummary([]), '');
// The count and the names have to describe the same set: an unknown
// language used to be dropped from the names while the count kept it.
check('orderedLanguageNames: an unknown language is named, and last',
      orderedLanguageNames(['und', 'swe', 'fin']), ['Finnish', 'Swedish', 'Unknown language']);

/* ------------------------------------- audio.js against a real header */

// The cases above are hand-written tracks; this one is a file ffmpeg
// wrote. What a muxer actually puts in the header — the language as
// ISO 639-2, FlagDefault on one track and off on the others, the titles —
// is not something to take on trust. Skipped when the media has not been
// built, so that the suite stays dependency-free.
{
  const { existsSync, readFileSync } = await import('node:fs');
  const file = new URL('mock/media/episode-multi.mkv', import.meta.url);
  if (!existsSync(file)) {
    console.log('SKIP  episode-multi.mkv is missing — run sh dev/mock/media.sh');
  } else {
    const { parseHeader } = await import('../js/ebml.js');
    const bytes = new Uint8Array(readFileSync(file).subarray(0, 256 * 1024));
    const list = describeAll(parseHeader(bytes).tracks);
    check('episode-multi.mkv: three audio tracks',
          list.map((e) => `${e.language} ${e.route}${e.default ? ' default' : ''}${e.commentary ? ' commentary' : ''}`),
          ['eng passthrough default', 'fin passthrough', 'eng decoded commentary']);
    const chosen = (language) => (preferred(list, language) || {}).language ?? null;
    check('episode-multi.mkv: the automatic choice passes over the commentary', chosen('auto'), 'eng');
    check('episode-multi.mkv: Finnish is found when it is asked for', chosen('fi'), 'fin');
    check('episode-multi.mkv: a language the file lacks falls back', chosen('de'), 'eng');
  }
}

/* ------------------------------------------- i18n: the keys and the markup */

// A key renamed on one side shows up in the interface as its own name —
// "setup.cancel" where a button should read "Cancel". Both languages are
// asked for every key player.html uses, and the dictionaries are compared
// with each other, so neither a missing translation nor a stale key in the
// markup can reach a screen.
{
  const langs = Object.keys(LANGUAGES);
  for (const lang of langs) await loadLanguage(lang);
  // A plural is one key whatever forms the language has: Polish carries
  // .few and .many where English has only .one and .other.
  const PLURAL = /\.(?:zero|one|two|few|many|other)$/;
  const base = (lang) => [...new Set(keysOf(lang).map((k) => k.replace(PLURAL, '')))];
  const first = base(langs[0]);
  setLanguage(langs[0]);
  const english = Object.fromEntries(keysOf(langs[0]).map((k) => [k, t(k)]));
  const holes = (text) => [...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  for (const lang of langs.slice(1)) {
    const theirs = new Set(base(lang));
    const mine = new Set(first);
    check(`i18n: ${lang} has every key ${langs[0]} has`, first.filter((k) => !theirs.has(k)), []);
    check(`i18n: ${lang} has no key ${langs[0]} lacks`, base(lang).filter((k) => !mine.has(k)), []);
    setLanguage(lang);
    check(`i18n: ${lang} keeps every placeholder`, keysOf(lang).filter((k) => {
      const source = english[k] ?? english[k.replace(PLURAL, '.other')];
      return source != null && holes(t(k)) !== holes(source);
    }), []);
    check(`i18n: ${lang} has the .other of every plural`, keysOf(lang).filter((k) => PLURAL.test(k) && !keysOf(lang).includes(k.replace(PLURAL, '.other'))), []);
  }
  setLanguage('pl');
  if (keysOf('pl').includes('unit.live.few')) {
    check('i18n: Polish counts in its own three forms',
      [1, 2, 5, 22].map((count) => t('unit.live', { count, n: count })),
      [t('unit.live.one', { n: 1 }), t('unit.live.few', { n: 2 }), t('unit.live.many', { n: 5 }), t('unit.live.few', { n: 22 })]);
  }
  setLanguage('en');
  check('i18n: English counts in two', [1, 2].map((count) => t('unit.live', { count, n: count })), ['1 channel', '2 channels']);
  check('i18n: the browser\'s tags the app speaks', ['fi-FI', 'nb', 'no', 'nn-NO', 'pt-BR', 'pt-PT', 'ja', ''].map(supportedLanguage),
    ['fi', 'nb', 'nb', 'nb', 'pt', 'pt', null, null]);
  const html = (await import('node:fs')).readFileSync(new URL('../player.html', import.meta.url), 'utf8');
  const used = [...new Set([...html.matchAll(/data-i18n(?:-title|-placeholder|-label)?="([^"]+)"/g)].map((m) => m[1]))];
  for (const lang of langs) {
    setLanguage(lang);
    check(`i18n: every key player.html uses resolves in ${lang}`, used.filter((k) => t(k) === k), []);
  }
  setLanguage('en');
}

/* ------------------------------------- format.js: in the language's own forms */

// Dates, decimals and episode codes were written one way for every
// language: "3.11.2026" in English, "★ 7.5" in Finnish, "S1 E2" in
// Spanish. Each now comes from the language (Intl, or its own pattern).
{
  const inLanguage = (lang, region, fn) => {
    setLanguage(lang);
    setEnglishRegion(region);
    setLocale();
    try { return fn(); } finally { setLanguage('en'); setEnglishRegion(null); setLocale(); }
  };
  check('an episode\'s air date in each language\'s form', [
    inLanguage('fi', null, () => calendarDate('2026-11-03')),
    inLanguage('en', 'en-US', () => calendarDate('2026-11-03')),
    inLanguage('en', 'en-GB', () => calendarDate('2026-11-03')),
    inLanguage('de', null, () => calendarDate('2026-11-03')),
    calendarDate('2026-02-30'), calendarDate('soon'),
  ], ['3.11.2026', '11/3/2026', '03/11/2026', '3.11.2026', '', '']);
  check('a rating in the language\'s decimals', [
    inLanguage('fi', null, () => ratingText({ rating: 7.46 })),
    inLanguage('en', 'en-GB', () => ratingText({ rating: 7.46 })),
  ], ['★ 7,5', '★ 7.5']);
  check('an episode code as each language\'s television writes it', [
    inLanguage('en', null, () => episodeCode(1, 2)),
    inLanguage('fi', null, () => episodeCode(1, 2)),
    inLanguage('es', null, () => episodeCode(3, 10)),
    inLanguage('de', null, () => episodeCode(1, 2)),
  ], ['S1 E2', 'K1 J2', 'T3 E10', 'S1 F2']);
  check('a stored size and a download\'s in the same decimals', inLanguage('fi', null, () => [megabytes(18_140_000), amount(18_140_000), megabytes(5000)]),
    inLanguage('fi', null, () => [amount(18_140_000), t('size.mb', { n: '17,3' }), t('size.kb', { n: '5' })]));
  check('a whole percentage in the language\'s form', inLanguage('fi', null, () => wholePercent(1.2)).replace(/\s/g, ' '), '120 %');
  check('a name that says its year already', [nameHasYear('Iron Tide (2009)', 2009), nameHasYear('2009: Lost Memories', '2009'), nameHasYear('Iron Tide', 2009), nameHasYear('Iron Tide 120090', 2009), nameHasYear('Blade Runner 2049', 1982), nameHasYear('Anything', null)],
    [true, true, false, false, false, false]);
}

/* --------------------------------------------------- route.js: the address */

// The address is written from the view and read back into one, so what
// matters is that the pair agree: every place the player can be in must
// survive the trip through the address bar.
{
  check('a title loses its own year at the end', [titleWithoutYear('Luottomies-elokuva: All in - 2024', 2024), titleWithoutYear('Iron Tide (2009)', 2009), titleWithoutYear('Blade Runner 2049', 1982), titleWithoutYear('2012', 2009)],
    ['Luottomies-elokuva: All in', 'Iron Tide', 'Blade Runner 2049', '2012']);
  check('a name\'s tags say which copy it is', nameTags('Lakana [Multi-Sub] 4K (2022)'), ['Multi-Sub', '4K']);
  const film = (id, n, extra = {}) => ({ id, k: 1, n, year: 2022, ext: 'mp4', ...extra });
  const labels = versionLabels([film('1', 'Lakana - 2022', { ext: 'mkv' }), film('2', 'Lakana - 2022'), film('3', 'Other - 2022'),
    film('4', 'Marian paratiisi - 2019', { year: 2019 }), film('5', 'Marian paratiisi 4K - 2019', { year: 2019 }), film('6', 'Same - 2022'), film('7', 'Same - 2022'), film('8', 'Other 4K - 2022')]);
  check('copies of one film are told apart by what differs', [labels.get('1:1'), labels.get('1:2'), labels.get('1:3'), labels.get('1:5'), labels.get('1:4'), labels.get('1:7'), labels.get('1:8')],
    [['MKV'], ['MP4'], { version: 1 }, ['4K'], { version: 1 }, { version: 2 }, ['4K']]);
  check('a series of films shares the part before the colon or the number',
    [franchiseKey('Luottomies-elokuva: All in - 2024', 2024), franchiseKey('Luottomies-elokuva: Lepoloma'), franchiseKey('Iron Tide 2'), franchiseKey('Iron Tide'), franchiseKey('Love')],
    ['luottomies-elokuva', 'luottomies-elokuva', 'iron tide', 'iron tide', null]);
  const all = [film('a', 'Luottomies-elokuva: All in - 2024', { year: 2024 }), film('b', 'Luottomies-elokuva: Lepoloma - 2022'),
    film('c', 'Luottomies-elokuva: All in - 2024', { year: 2024, ext: 'mkv' }), film('d', 'Something else - 2022'), film('e', 'Luottomies-elokuva: Lepoloma - 2022', { ext: 'mkv' })];
  const related = relatedTitles(all[0], all);
  check('the other copies and the other parts of a film', [related.versions.map((x) => x.id), related.parts.map((x) => x.id)], [['c'], ['b']]);
  const now = Date.UTC(2026, 10, 5);
  check('new for two weeks after the provider added it', [isNew({ added: now - 3 * 86400e3 }, now), isNew({ added: now - 20 * 86400e3 }, now), isNew({}, now), isNew({ added: now + 86400e3 }, now)], [true, false, false, false]);
}

const trip = (view) => parseRoute(formatRoute(view));
check('the tab alone', formatRoute({ tab: 'live' }), '#/live');
check('a group within it', formatRoute({ tab: 'live', group: 'Finland' }), '#/live/Finland');
check('a topic within the group', formatRoute({ tab: 'live', group: 'Finland', sub: '312' }), '#/live/Finland/312');
check('a channel in its country', formatRoute({ tab: 'live', group: 'Finland', channel: '4321' }), '#/live/Finland?channel=4321');
check('a channel read back', parseRoute('#/live/Finland?channel=4321'), { tab: 'live', group: 'Finland', channel: '4321' });
check('a channel only in the channels', parseRoute('#/movie/Drama?channel=4321'), { tab: 'movie', group: 'Drama' });
check('All is a segment of its own', formatRoute({ tab: 'movie', group: null }), '#/movie/-');
check('a collection carries no group, and its words', formatRoute({ tab: 'fav', kind: 1 }), '#/favorites?kind=movie');
check('the types in words', [formatRoute({ tab: 'fav', kind: 'c' }), formatRoute({ tab: 'recent', kind: 0 }), formatRoute({ tab: 'recent', kind: 2 })],
  ['#/favorites?kind=category', '#/history?kind=channel', '#/history?kind=series']);
check('the history is "history" in the address, and its older word still reads',
  [formatRoute({ tab: 'recent' }), parseRoute('#/history?kind=movie'), parseRoute('#/recent?series=5')],
  ['#/history', { tab: 'recent', kind: 1 }, { tab: 'recent', series: '5' }]);
check('the guide alone, and over a group and a topic', [formatRoute({ tab: 'live', guide: true }), formatRoute({ tab: 'live', group: 'Finland', sub: '312', guide: true })],
  ['#/guide', '#/guide/Finland/312']);
check('the guide read back as the channels with the guide open', [parseRoute('#/guide'), parseRoute('#/guide/Finland?channel=4')],
  [{ tab: 'live', guide: true }, { tab: 'live', guide: true, group: 'Finland', channel: '4' }]);
check('the guide belongs to the channels alone', formatRoute({ tab: 'movie', group: 'Action', guide: true }), '#/movie/Action');
check('a film in its list', [formatRoute({ tab: 'movie', group: 'Action', movie: '5000' }), parseRoute('#/movie/Action?movie=5000')],
  ['#/movie/Action?movie=5000', { tab: 'movie', group: 'Action', movie: '5000' }]);
check('a film only in the films', [parseRoute('#/live/Finland?movie=5000'), parseRoute('#/favorites?movie=5000')], [{ tab: 'live', group: 'Finland' }, { tab: 'fav' }]);
check('an older address still reads', [parseRoute('#/fav?kind=1'), parseRoute('#/recent?kind=0'), parseRoute('#/fav?kind=c')],
  [{ tab: 'fav', kind: 1 }, { tab: 'recent', kind: 0 }, { tab: 'fav', kind: 'c' }]);
check('a drill-down rides along', formatRoute({ tab: 'series', group: 'Drama', series: '1234' }), '#/series/Drama?series=1234');
check('a series inside a favourite category', formatRoute({ tab: 'fav', cat: 'live:312', series: '99' }),
  '#/favorites?cat=live%3A312&series=99');
check('a group whose name is a path separator', formatRoute({ tab: 'live', group: 'A/B' }), '#/live/A%2FB');
check('a group named like All is not All', trip({ tab: 'live', group: '-' }), { tab: 'live', group: '-' });

check('a topic returns as it went', trip({ tab: 'live', group: 'Suomi', sub: '312' }), { tab: 'live', group: 'Suomi', sub: '312' });
check('All returns as All', trip({ tab: 'movie', group: null }), { tab: 'movie', group: null });
check('a collection returns without a group', trip({ tab: 'recent', kind: 0 }), { tab: 'recent', kind: 0 });
check('the category filter keeps its own type', trip({ tab: 'fav', kind: 'c' }), { tab: 'fav', kind: 'c' });
check('the drill-down returns whole', trip({ tab: 'fav', cat: 'live:g:Finland', series: '99' }),
  { tab: 'fav', cat: 'live:g:Finland', series: '99' });
// A group not chosen and All are different answers: the first leaves the
// player to pick one, the second costs the whole list.
check('no group is not All', trip({ tab: 'live' }), { tab: 'live' });

check('an empty address names no place', parseRoute(''), null);
check('a bare hash names no place', parseRoute('#'), null);
check('a tab that does not exist names no place', parseRoute('#/telly/Finland'), null);
check('an address from elsewhere names no place', parseRoute('#some-anchor'), null);
check('an unknown type filter is dropped, the place kept', parseRoute('#/favorites?kind=film'), { tab: 'fav' });
check('a half-escaped group is taken as it stands', parseRoute('#/live/100%'), { tab: 'live', group: '100%' });
check('extra segments are ignored', parseRoute('#/live/Finland/312/extra'), { tab: 'live', group: 'Finland', sub: '312' });

/* --------------------------------------- player.html: the elements found */

// The scripts reach the markup by id alone. An id only one of the two knows
// — a control renamed in the markup, a lookup left behind — costs nothing
// until the line runs, and then it takes down whatever called it: a toast
// that cannot find the element for its text turns a handled error into an
// unexpected one, and the message the viewer gets names neither. Cheaper to
// read the two files against each other than to meet it in the player.
const fs = await import('node:fs');
const source = (name) => fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const inMarkup = new Set([...source('player.html').matchAll(/id="([\w-]+)"/g)].map((m) => m[1]));
// An id the scripts give an element they build themselves is theirs, not
// the markup's; a lookup of one is answered once it has been built.
const scriptFiles = fs.readdirSync(new URL('../js', import.meta.url)).filter((name) => name.endsWith('.js'));
const built = new Set();
const lookups = new Map();
for (const name of scriptFiles) {
  const text = source(`js/${name}`);
  for (const m of text.matchAll(/\.id = '([\w-]+)'/g)) built.add(m[1]);
  for (const m of text.matchAll(/(?:\$|getElementById)\('([\w-]+)'\)/g)) {
    if (!lookups.has(m[1])) lookups.set(m[1], name);
  }
}
check('every element the scripts look up by id is in player.html',
  [...lookups].filter(([id]) => !inMarkup.has(id) && !built.has(id)).map(([id, name]) => `${id} (js/${name})`), []);

/* ------------------------------------------------- player.css: contrast */

// The text colours against every ground they sit on, by WCAG's formula:
// 4.5:1 for the small text, and the selected row is a ground too.
const css = source('css/player.css');
const cssVar = (name) => (css.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i')) || [])[1];
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const grounds = { bg: cssVar('bg'), panel: cssVar('panel'), 'panel-2': cssVar('panel-2'), 'row-hover': cssVar('row-hover'), selected: '#202538' };
for (const [text, least] of [['dim', 4.5], ['muted', 4.5], ['text', 7]]) {
  for (const [ground, hex] of Object.entries(grounds)) {
    const ratio = contrast(cssVar(text), hex);
    check(`--${text} on --${ground} reaches ${least}:1 (${ratio.toFixed(2)})`, ratio >= least, true);
  }
}

/* ------------------------------------- remux.js: one operation at a time */

// A SourceBuffer does one thing at a time, and an append issued while a
// removal is under way throws. The eviction once ran beside the append
// queue: some 35 seconds into a high-bitrate film the two met, the append
// threw "SourceBuffer rejected the segment", and the picture stopped when
// the minute already buffered ran out. The fake buffer below throws as
// Chrome's does, and takes a few milliseconds over each operation.
{
  const { Remuxer } = await import('../js/remux.js');
  class FakeBuffer extends EventTarget {
    constructor() { super(); this.updating = false; this.ranges = [[0, 160]]; this.calls = []; }
    get buffered() { const r = this.ranges; return { length: r.length, start: (i) => r[i][0], end: (i) => r[i][1] }; }
    work(name, then) {
      if (this.updating) throw new DOMException(`${name} while updating`, 'InvalidStateError');
      this.updating = true;
      this.calls.push(name);
      setTimeout(() => { then(); this.updating = false; this.dispatchEvent(new Event('updateend')); }, 3);
    }
    appendBuffer() { this.work('append', () => {}); }
    remove(from, to) { this.work('remove', () => { this.ranges = [[Math.max(this.ranges[0][0], to), this.ranges[0][1]]]; }); }
  }
  const errors = [];
  const remuxer = new Remuxer({ currentTime: 100 }, 'http://x/', { onError: (err) => errors.push(err.message) });
  remuxer.ms = { readyState: 'open', duration: 200 };
  const sb = new FakeBuffer();
  remuxer.buffers.video = sb;
  // The order the pump and the wait for room produce them in under load:
  // an eviction starts, appends arrive while it runs, another eviction
  // comes in among them, and a seek clears the lot.
  const work = [remuxer.evict('video'), remuxer.append('video', new Uint8Array(1)), remuxer.append('video', new Uint8Array(1)),
    remuxer.evict('video'), remuxer.append('video', new Uint8Array(1))];
  await Promise.all(work);
  check('appends and evictions take turns on the buffer', { errors, calls: sb.calls }, { errors: [], calls: ['remove', 'append', 'append', 'append'] });
  check('the eviction keeps the half-minute behind the playback position', sb.ranges, [[70, 160]]);
  await Promise.all([remuxer.append('video', new Uint8Array(1)), remuxer.clear()]);
  check('a seek clears the buffer after the append in flight, not over it', { errors, calls: sb.calls.slice(4) }, { errors: [], calls: ['append', 'remove'] });
}

// The browser's limit is in bytes, and a high-bitrate film reaches it with
// less than the minute ahead the download aims for. A full buffer once
// ended the film: appendBuffer's QuotaExceededError was turned into
// "SourceBuffer rejected the segment" before anything looked at it. The
// fake below holds 40 seconds and throws as Chrome does when it is full.
// The unpacker's own warnings are kept out of the report.
const quietly = async (work) => {
  const warn = console.warn;
  console.warn = () => {};
  try { await work(); } finally { console.warn = warn; }
};
await quietly(async () => {
  const { Remuxer } = await import('../js/remux.js');
  class FullBuffer extends EventTarget {
    constructor() { super(); this.updating = false; this.ranges = [[0, 40]]; this.appended = 0; this.refused = 0; }
    get buffered() { const r = this.ranges; return { length: r.length, start: (i) => r[i][0], end: (i) => r[i][1] }; }
    settle(then) { this.updating = true; setTimeout(() => { then(); this.updating = false; this.dispatchEvent(new Event('updateend')); }, 2); }
    appendBuffer() {
      if (this.ranges[0][1] - this.ranges[0][0] >= 40) { this.refused++; throw new DOMException('the buffer is full', 'QuotaExceededError'); }
      this.settle(() => { this.ranges[0][1] += 2; this.appended++; });
    }
    remove(from, to) { this.settle(() => { this.ranges = [[Math.max(this.ranges[0][0], to), this.ranges[0][1]]]; }); }
  }
  const errors = [];
  const video = { currentTime: 2 };
  const remuxer = new Remuxer(video, 'http://x/', { onError: (err) => errors.push(err.message) });
  remuxer.ms = { readyState: 'open', duration: 200 };
  const sb = new FullBuffer();
  remuxer.buffers.video = sb;
  const appended = remuxer.append('video', new Uint8Array(10));
  await new Promise((resolve) => setTimeout(resolve, 100));
  check('a full buffer holds the append back rather than ending the film',
    { errors, appended: sb.appended, waiting: remuxer.quotaWaits, queued: remuxer.queued },
    { errors: [], appended: 0, waiting: 1, queued: 10 });
  video.currentTime = 20;     // playback moves on, and the watched part can go
  await appended;
  check('once playback has moved on, the watched part goes and the append gets in',
    { errors, appended: sb.appended, waiting: remuxer.quotaWaits, queued: remuxer.queued, kept: sb.ranges[0][0] },
    { errors: [], appended: 1, waiting: 0, queued: 0, kept: 15 });
  check('the read-ahead is held a quarter below what the full buffer held', remuxer.readAhead().ahead, 28);

  // Seconds turned into bytes: a 1080p remux at 30 Mbit/s holds some 25
  // seconds in the budget, the demo episode's 175 kbit/s the full minute.
  const heavy = new Remuxer({ currentTime: 0 }, 'http://x/');
  heavy.rate = { bytes: 30e6 / 8 * 10, seconds: 10 };
  const light = new Remuxer({ currentTime: 0 }, 'http://x/');
  light.rate = { bytes: 175e3 / 8 * 10, seconds: 10 };
  const round = ({ ahead, behind }) => ({ ahead: Math.round(ahead), behind: Math.round(behind) });
  check('a high bit rate reads less far ahead and keeps less behind', round(heavy.readAhead()), { ahead: 19, behind: 6 });
  check('a low bit rate keeps the minute ahead and the half-minute behind', round(light.readAhead()), { ahead: 60, behind: 30 });
});

// One failed read of the seek table once cost the whole film its seeking.
// The read follows a seek's cut connection, and a provider still counting
// that one refuses it: it is asked again, and only an answer — a table or
// bytes that are none, a range past the end — ends the asking for good.
await quietly(async () => {
  const { Remuxer } = await import('../js/remux.js');
  const realFetch = globalThis.fetch;
  const answers = [];
  globalThis.fetch = async () => {
    const next = answers.shift();
    if (next instanceof Error) throw next;
    return new Response(next.body || null, { status: next.status });
  };
  const table = () => {
    const remuxer = new Remuxer({ currentTime: 0 }, 'http://x/');
    remuxer.header = { cuesPosition: 1000, segmentStart: 40, timestampScale: 1e6 };
    remuxer.videoTrack = { number: 1 };
    return remuxer;
  };
  try {
    const refused = table();
    answers.push(new TypeError('Failed to fetch'), { status: 400 }, { status: 206, body: new Uint8Array([1, 2, 3]) });
    await refused.loadCues();
    check('a refused read of the seek table is asked again until it is answered',
      { left: answers.length, tried: refused.cuesTried }, { left: 0, tried: true });
    const past = table();
    answers.push({ status: 416 });
    await past.loadCues();
    check('a table past the end of the file is given up on at once', { left: answers.length, tried: past.cuesTried }, { left: 0, tried: true });
  } finally {
    globalThis.fetch = realFetch;
  }
});

/* ------------------------------------------------- international.js */

check('a channel is one key in every country\'s list',
  ['FI: Stingray Djazz', 'SE: Stingray Djazz HD', '|DK| Stingray Djazz [Multi-Sub]', 'NO: Stingray Djazz (F)'].map(channelKey),
  ['stingray djazz', 'stingray djazz', 'stingray djazz', 'stingray djazz']);
check('the national topics in the providers\' languages',
  ['Kansalliset', 'Nationella', 'Nasjonale', 'Nationale', 'Öffentlich', 'Generalistas', 'Urheilu', 'Musik'].map(isNationalTopic),
  [true, true, true, true, true, true, false, false]);
{
  const countries = ['Finland', 'Sweden', 'Norway', 'Denmark'];
  const cats = [{ id: 'music', name: 'Music' }];
  for (const c of countries) cats.push({ id: `${c}-nat`, name: `${c} - National` }, { id: `${c}-music`, name: `${c} - Music` });
  cats.push({ id: 'uk', name: 'United Kingdom' }, { id: 'uk-news', name: 'United Kingdom - News' });
  const items = [];
  const add = (id, n, cat) => items.push({ k: 0, id, n, cats: [cat] });
  countries.forEach((c, i) => add(`djazz${i}`, `${c.slice(0, 2).toUpperCase()}: Stingray Djazz`, `${c}-music`));
  countries.forEach((c, i) => add(`tv5${i}`, `${c.slice(0, 2).toUpperCase()}: TV5`, i ? `${c}-music` : `${c}-nat`));
  countries.slice(0, 3).forEach((c, i) => add(`local${i}`, `${c.slice(0, 2).toUpperCase()}: Nordic Jazz`, `${c}-music`));
  countries.forEach((c, i) => add(`event${i}`, `[Disney${i}] (31/10) 18:45 Chelsea vs. Benfica`, `${c}-music`));
  add('music', 'Stingray Djazz', 'music');
  add('itv', 'UK: ITV', 'uk');
  countries.slice(1).forEach((c, i) => add(`itv${i}`, `${c.slice(0, 2).toUpperCase()}: ITV HD`, `${c}-music`));
  add('ukjazz', 'UK: Stingray Djazz', 'uk-news');
  const found = internationalChannels(items, buildGroups(cats));
  check('a channel in four countries\' lists is international, in each of them',
    ['djazz0', 'djazz1', 'djazz2', 'djazz3', 'ukjazz'].every((id) => found.has(id)), true);
  check('three countries are not enough', found.has('local0'), false);
  check('a national topic keeps a name that collides with foreign ones', [found.has('tv50'), found.has('tv51')], [false, true]);
  check('a country\'s topic-less category is its own channels', [found.has('itv'), found.has('itv0')], [false, true]);
  check('a dated event is the country\'s own broadcast', found.has('event0'), false);
  check('outside a country\'s list nothing is thinned', found.has('music'), false);
}

/* ------------------------------ xtream.js: catch-up across a DST change */

// Helsinki leaves summer time at 04:00 local on 2026-10-25 (01:00 UTC). An
// offset measured after the change (+2 h) once moved every programme from
// before it an hour early in the timeshift path.
{
  const cfg = { scheme: 'http', host: 'tv.example', port: '8080', username: 'u', password: 'p' };
  const before = Date.UTC(2026, 9, 24, 18, 0);      // 21:00 summer time
  const after = Date.UTC(2026, 9, 26, 18, 0);       // 20:00 winter time
  const winter = 2 * 3600e3;
  check('a programme before the change gets the summer offset from the zone',
    serverStamp(before, 'Europe/Helsinki', winter), '2026-10-24:21-00');
  check('a programme after the change gets the winter offset',
    serverStamp(after, 'Europe/Helsinki', winter), '2026-10-26:20-00');
  check('the hour that repeats reads the same on the wall clock both times, as the server\'s does',
    [Date.UTC(2026, 9, 25, 0, 30), Date.UTC(2026, 9, 25, 1, 30)].map((ms) => serverStamp(ms, 'Europe/Helsinki')),
    ['2026-10-25:03-30', '2026-10-25:03-30']);
  check('midnight is 00, not 24', serverStamp(Date.UTC(2026, 9, 25, 22, 0), 'Europe/Helsinki'), '2026-10-26:00-00');
  check('without a zone the measured offset stands',
    serverStamp(before, null, winter), '2026-10-24:20-00');
  check('a zone the browser does not know falls back to the measured offset',
    serverStamp(before, 'Mars/Olympus_Mons', winter), '2026-10-24:20-00');
  check('with neither, there is no answer', serverStamp(before, 'Mars/Olympus_Mons', null), null);
  check('the catch-up address keeps its form, with the zone',
    timeshiftUrl(cfg, 42, before, 59.6, winter, 'Europe/Helsinki'),
    'http://tv.example:8080/timeshift/u/p/60/2026-10-24:21-00/42.ts');
  check('and without it, as before',
    timeshiftUrl(cfg, 42, before, 60, winter),
    'http://tv.example:8080/timeshift/u/p/60/2026-10-24:20-00/42.ts');
}

/* --------------------------------- xtream.js, external.js: direct_source */

check('an http(s) direct_source is taken',
  ['https://cdn.example/a.m3u8', ' http://cdn.example/b.ts '].map(directSource),
  ['https://cdn.example/a.m3u8', 'http://cdn.example/b.ts']);
check('anything else is dropped: other schemes, line breaks, spaces, junk',
  ['javascript:alert(1)', 'file:///etc/passwd', 'http://a.example/x\r\n#EXTVLCOPT:foo', 'http://a b', '', '[]', null, 5].map(directSource),
  [null, null, null, null, null, null, null, null]);
check('a cached item with a bad direct_source plays from the server\'s own address',
  streamUrl({ host: 'tv.example', username: 'u', password: 'p' }, { k: 1, id: '7', ext: 'mkv', direct: 'http://x\n#EXTINF' }),
  'http://tv.example/movie/u/p/7.mkv');
check('a line break in the address adds no line to the playlist',
  playlist({ url: 'http://a.example/x.ts\r\n#EXTVLCOPT:evil' }, 'Name\nTwo').split('\n'),
  ['#EXTM3U', '#EXTINF:-1,Name Two', 'http://a.example/x.ts#EXTVLCOPT:evil', '']);

/* ---------------------------------------------- api.js: EPG text decoding */

check('a base64 title is decoded as UTF-8', decodeField(Buffer.from('Uutiset – Äänestys').toString('base64')), 'Uutiset – Äänestys');
check('a plain title that happens to be valid base64 stays as it came', ['News', 'Golf'].map(decodeField), ['News', 'Golf']);
check('a title that is no base64 at all stays too', decodeField('Ylen uutiset'), 'Ylen uutiset');

/* ------------------------------------------ api.js: what a status means */

{
  const realFetch = globalThis.fetch;
  const api = new XtreamApi({ host: 'tv.example', username: 'u', password: 'p' });
  const kindOf = async (status) => {
    globalThis.fetch = async () => new Response('{}', { status });
    try { await api.call(''); return 'ok'; } catch (err) { return err instanceof ApiError ? `${err.kind}:${err.message}` : String(err); }
  };
  const results = [];
  for (const status of [401, 512, 403, 500]) results.push(await kindOf(status));
  globalThis.fetch = realFetch;
  check('401 and 512 are the credentials; 403 is a refusal of access, not of the password',
    results.map((r) => r.split(':')[0]), ['tunnistus', 'tunnistus', 'http', 'http']);
  check('and 403 says so in its own words', results[2].slice(5), t('api.denied'));

  // The zone is trusted only when it agrees with the server's own clock.
  const zoneOf = async (timezone, timeNow) => {
    globalThis.fetch = async () => new Response(JSON.stringify({
      user_info: { auth: 1 },
      server_info: { timezone, timestamp_now: String(Date.UTC(2026, 9, 31, 10, 0) / 1000), time_now: timeNow },
    }));
    try { return (await api.account()).serverZone; } finally { globalThis.fetch = realFetch; }
  };
  check('a zone that agrees with time_now is kept; one that does not, or is unknown, is not',
    [await zoneOf('Europe/Helsinki', '2026-10-31 12:00:00'), await zoneOf('Europe/Ljubljana', '2026-10-31 12:00:00'),
      await zoneOf('Mars/Olympus_Mons', '2026-10-31 12:00:00'), await zoneOf(undefined, '2026-10-31 12:00:00')],
    ['Europe/Helsinki', null, null, null]);
}

/* ------------------------------------------ epggrid.js: reminder timer */

{
  const now = Date.UTC(2026, 9, 31, 12, 0);
  check('a reminder due soon waits until then', reminderDelay(now + 60000, now), 60000);
  check('one already due fires at once', reminderDelay(now - 5000, now), 0);
  check('one weeks ahead waits a day and is measured again, within a timer\'s limit',
    reminderDelay(now + 40 * 24 * 3600e3, now), 24 * 3600e3);
}

/* ------------------------------- the catalogue kept fresh, and bounded */

// Refresh used to leave the categories and groups opened earlier in the
// session as they were first fetched: the visible list stayed old after
// "Lists refreshed". Without IndexedDB here the cache reads miss, so every
// read goes to the fake server.
await quietly(async () => {
  let served = 0;
  const api = {
    categories: async () => [{ id: '1', name: 'Finland' }],
    streams: async (type, cat) => { served++; return [{ id: String(served), k: 0, n: `Channel ${served}`, cats: [cat || '1'] }]; },
  };
  const lib = new Library(api, 'acc');
  await lib.loadCategories();
  const before = (await lib.categoryItems('live', '1')).map((it) => it.n);
  const again = (await lib.categoryItems('live', '1')).map((it) => it.n);
  check('a category opened twice is fetched once', [before, again], [['Channel 1'], ['Channel 1']]);
  await lib.groupItems('live', 'Finland');
  lib.details.set('series:v2:7', { episodes: [] });
  lib.details.set('vod:v2:8', { durationSec: 60 });
  await lib.refresh();
  const after = (await lib.categoryItems('live', '1')).map((it) => it.n);
  check('Refresh fetches a category opened earlier again', after, ['Channel 3']);
  check('Refresh forgets the series\' episodes and keeps the films\' details',
    [lib.details.has('series:v2:7'), lib.details.has('vod:v2:8')], [false, true]);
  const now = Date.now();
  check('lists just fetched are not stale', lib.isStale(now), false);
  check('categories older than a day are', lib.isStale(now + 25 * 3600e3), true);
  lib.categoriesAt = now;
  check('a category list older than six hours is', lib.isStale(now + 7 * 3600e3), true);
  lib.listsAt = null;
  check('nothing opened, nothing stale but the categories', lib.isStale(now + 7 * 3600e3), false);
  lib.setFull('live', [{ id: '1', k: 0, n: 'One', cats: ['1'] }], now - 7 * 3600e3);
  check('a whole list older than six hours is stale', lib.isStale(now), true);
});

check('each cached row has its time: categories, lists, episodes, details, file headers',
  ['acc|cats:live', 'acc|full:movie', 'acc|series:v2:1', 'acc|vod:v2:1', 'probe:h:movie:1.mkv', 'other']
    .map((key) => probeCacheTtl(key) ?? cacheTtl(key)),
  [24 * 3600e3, 6 * 3600e3, 24 * 3600e3, 7 * 24 * 3600e3, 90 * 24 * 3600e3, null]);

{
  // A search of all channels used to keep every whole table it read.
  const epg = new Epg(null, () => {});
  for (let i = 0; i < 250; i++) epg.remember(String(i), { listings: [], at: 0, mode: 'full' });
  epg.remember('x', { listings: [], at: 0, mode: 'short' });
  epg.remember('10', { listings: [], at: 0, mode: 'full' });
  const full = [...epg.cache.values()].filter((e) => e.mode === 'full').length;
  check('the programme cache keeps 200 whole tables, the newest, and the short lists',
    [full, epg.fullTables, epg.cache.has('0'), epg.cache.has('49'), epg.cache.has('50'), epg.cache.has('10'), epg.cache.has('x')],
    [200, 200, false, false, false, true, true]);
  epg.clear();
  check('clearing the cache clears the count', epg.fullTables, 0);
}

{
  const order = (a, b) => a.k - b.k;
  const merged = mergeSorted([{ k: 1, s: 'a' }, { k: 3, s: 'a' }], [{ k: 0, s: 'b' }, { k: 3, s: 'b' }, { k: 4, s: 'b' }], order);
  check('results found later merge into place, earlier ones first among equals',
    merged.map((r) => `${r.k}${r.s}`), ['0b', '1a', '3a', '3b', '4b']);
  check('nothing new leaves the list as it was', mergeSorted([{ k: 1 }], [], order).length, 1);
  check('a channel listed twice is searched once, one without programme data not at all',
    searchableChannels([{ id: 1, epgId: 'a' }, { id: '1', epgId: 'a' }, { id: 2 }]).map((c) => String(c.id)), ['1']);
}

check('the same channels in another order are the same set',
  sameChannels([{ id: 1 }, { id: 2 }], [{ id: '2' }, { id: '1' }]), true);
check('one channel more is another set', sameChannels([{ id: 1 }], [{ id: 1 }, { id: 2 }]), false);
check('another channel is another set', sameChannels([{ id: 1 }, { id: 2 }], [{ id: 1 }, { id: 3 }]), false);
check('an empty list is never the same set', sameChannels([], []), false);

check('a series named in the channels\' address is dropped', parseRoute('#/live/Finland?series=12'), { tab: 'live', group: 'Finland' });
check('a favourite category belongs to the favourites alone',
  parseRoute('#/series/Drama?cat=live%3A1&series=5'), { tab: 'series', group: 'Drama', series: '5' });
check('the history may hold a series', parseRoute('#/recent?series=5'), { tab: 'recent', series: '5' });

/* -------------------------------------------- listorder.js: list orders */

{
  check('a list\'s order from the settings, its default for anything else',
    [listOrder({}, 'live'), listOrder({ channelSort: 'za' }, 'live'), listOrder({ favoritesSort: 'added' }, 'fav'), listOrder({ favoritesSort: 'num' }, 'fav'),
      listOrder({}, 'movie'), listOrder({ seriesSort: 'rating' }, 'series'), listOrder({}, 'recent'), listOrder({ historySort: 'za' }, 'recent')],
    ['az', 'za', 'added', 'az', 'az', 'rating', 'watched', 'za']);
  check('every list keeps its order in a setting of its own, and every order has a mark',
    Object.keys(LIST_ORDERS).every((list) => ORDER_SETTINGS[list] && ORDER_MARKS[list].flat().sort().join() === [...LIST_ORDERS[list]].sort().join()), true);
  // The name's mark turns A–Z to Z–A and back; the channels' once stayed
  // at A–Z lit while Z–A was set, and a press did nothing.
  const name = ORDER_MARKS.live[0];
  check('a press on the lit name mark turns the order round, and back', [pressedOrder(name, 'az'), pressedOrder(name, 'za')], ['za', 'az']);
  check('a press on a mark not lit takes its first order', [pressedOrder(name, 'num'), pressedOrder(['newest', 'oldest'], 'az'), pressedOrder(['rating'], 'za')], ['az', 'newest', 'rating']);
  check('a lit mark of one order stays at it', pressedOrder(['num'], 'num'), 'num');
  const films = [{ id: 'a', n: 'Alpha', added: 3 }, { id: 'b', n: 'Beta', added: 0 }, { id: 'c', n: 'Gamma', added: 9 }, { id: 'd', n: 'Delta', added: 5 }];
  const facts = { a: { year: 2020, rating: 8 }, b: { year: 1999, rating: 6 }, c: { year: 2024, rating: 0 }, d: { year: 0, rating: 9 } };
  const order = (o) => orderTitles(films, o, (item) => facts[item.id]).map((f) => f.id);
  check('films by name stay as they came', order('az'), ['a', 'b', 'c', 'd']);
  check('Z–A mirrors them', order('za'), ['d', 'c', 'b', 'a']);
  check('the newest year first, an unknown year last', order('newest'), ['c', 'a', 'b', 'd']);
  check('the oldest year first, an unknown year still last', order('oldest'), ['b', 'a', 'c', 'd']);
  check('the best rated first, unrated last', order('rating'), ['d', 'a', 'b', 'c']);
  check('the latest the provider added first, an unknown date last', order('added'), ['c', 'd', 'a', 'b']);
  check('ordering does not change the catalogue', films.map((f) => f.id), ['a', 'b', 'c', 'd']);
}

/* --------------------------------- listnavigation.js: keys on a tile strip */

{
  // Two rows of three tiles, 100 wide and 50 high, and a fourth row's one.
  const box = (col, row) => ({ left: col * 110, right: col * 110 + 100, top: row * 60, bottom: row * 60 + 50 });
  const grid = [box(0, 0), box(1, 0), box(2, 0), box(0, 1), box(1, 1), box(2, 1), box(1, 2)];
  check('left and right step a tile in the page\'s order, and stop at the ends',
    [neighbourTile(grid, 1, 'ArrowRight'), neighbourTile(grid, 2, 'ArrowRight'), neighbourTile(grid, 0, 'ArrowLeft'), neighbourTile(grid, 6, 'ArrowRight')], [2, 3, -1, -1]);
  check('down and up go to the nearest tile of the next row',
    [neighbourTile(grid, 1, 'ArrowDown'), neighbourTile(grid, 4, 'ArrowUp'), neighbourTile(grid, 3, 'ArrowDown'), neighbourTile(grid, 5, 'ArrowDown')], [4, 1, 6, 6]);
  check('no row that way is no tile', [neighbourTile(grid, 0, 'ArrowUp'), neighbourTile(grid, 6, 'ArrowDown')], [-1, -1]);
  check('Home and End go to the ends', [neighbourTile(grid, 4, 'Home'), neighbourTile(grid, 0, 'End')], [0, 6]);
  check('a carousel of one row has no row below', neighbourTile([box(0, 0), box(1, 0)], 0, 'ArrowDown'), -1);
  check('other keys lead nowhere', neighbourTile(grid, 0, 'Enter'), -1);
}

/* ------------------------------------------------------- js/mp4file.js */

{
  // The demo film, as the mock serves it: H.264 and AAC, the index first.
  const file = new Uint8Array(readFileSync(new URL('./mock/media/movie.mp4', import.meta.url)));
  let at = 0;
  let moov = null;
  while (at < file.length) {
    const h = boxHeader(file, at);
    if (h.type === 'moov') { moov = file.subarray(at, at + h.size); break; }
    at += h.size;
  }
  const movie = parseMoov(moov);
  const video = movie.tracks.find((tr) => tr.kind === 'video');
  const audio = movie.tracks.find((tr) => tr.kind === 'audio');
  check('mp4: the film is two minutes long', Math.round(movie.duration), 120);
  check('mp4: the video track is H.264 with its profile and level', /^avc1\.[0-9a-f]{6}$/.test(video.codec), true);
  check('mp4: the audio track is AAC-LC', audio.codec, 'mp4a.40.2');
  check('mp4: the sample entry is the file\'s own', String.fromCharCode(...video.entry.subarray(4, 8)), 'avc1');
  check('mp4: the first video sample is a keyframe', video.sync ? video.sync[0] : 1, 1);
  check('mp4: the samples lie in the media, in order',
    [video, audio].every((tr) => tr.offset[0] > at && tr.offset.every((o, i) => !i || o > tr.offset[i - 1])), true);
  check('mp4: the samples reach the end of the file and no further',
    Math.max(...[video, audio].map((tr) => tr.offset[tr.count - 1] + tr.size[tr.count - 1])) <= file.length, true);
  check('mp4: the edit list puts the first picture at nought',
    Math.abs((video.dts[0] + video.cts[0] - video.shift) / video.timescale) < 0.05, true);
  check('mp4: the samples\' decode times add up to the track\'s length',
    Math.round((video.dts[video.count - 1] + video.duration[video.count - 1]) / video.timescale), 120);
  const large = new Uint8Array(16);
  new DataView(large.buffer).setUint32(0, 1);
  large.set([0x6d, 0x64, 0x61, 0x74], 4);
  new DataView(large.buffer).setUint32(8, 1);
  new DataView(large.buffer).setUint32(12, 16);
  // A damaged index claiming more samples than its box holds is refused
  // before anything is allocated for it.
  const damaged = moov.slice();
  const stszAt = (() => { for (let i = 0; i < damaged.length - 4; i++) if (String.fromCharCode(...damaged.subarray(i, i + 4)) === 'stsz') return i - 4; return -1; })();
  new DataView(damaged.buffer).setUint32(stszAt + 12 + 4, 0xfffffff0);
  let refused = null;
  try { parseMoov(damaged); } catch (err) { refused = err.message; }
  check('mp4: a sample count larger than its table is refused', refused, 'the MP4 index is damaged (stsz)');
  check('mp4: a 64-bit box size is read whole', boxHeader(large, 0), { type: 'mdat', size: 4294967312, header: 16 });
}


/* ------------------------------------------------------- M3U playlists */

// Imported here rather than at the top: they reach config.js, which must
// find the faked extension API above when it is first imported.
const { buildCatalogue } = await import('../js/m3usource.js');
const { accountKey, accountLabel, isConfigured } = await import('../js/config.js');
const { outgoingAccounts, incomingAccounts, joinRecents, joinResume, joinFavorites, strippedItems, keepAddresses, syncName } = await import('../js/sync.js');

{
  // The forms providers and players write, each of them once.
  const text = '﻿#EXTM3U url-tvg="http://g.example/a.xml.gz, http://g.example/b.xml" catchup="shift" catchup-days="2"\r\n'
    + '#EXTINF:-1 tvg-ID="yle1.fi" tvg-name="FI: Yle TV1" tvg-logo="http://l.example/yle.png" group-title="Finland, News",FI: Yle TV1, HD\r\n'
    + '#EXTVLCOPT:http-user-agent=Kodi/20\r\n'
    + 'http://s.example/live/u/p/1.m3u8\r\n'
    + '#EXTINF:0 tvg-id=nordic.se group-title=\'Sweden\',Nordic\n'
    + '#EXTGRP:Ignored when group-title is given\n'
    + 'stream/2.ts\n'
    + '#EXTINF:-1,Only a name\n'
    + '#EXTGRP:From EXTGRP\n'
    + 'http://s.example/3\n'
    + 'http://s.example/bare.mp4\n'
    + '#EXTINF:-1,Not an address\n'
    + 'rtmp://s.example/x\n';
  const { header, entries } = parseM3u(text, 'http://p.example/list/get.m3u');
  check('m3u: the guide addresses of the header, all three spellings and commas', header.guides, ['http://g.example/a.xml.gz', 'http://g.example/b.xml']);
  check('m3u: the header\'s catch-up', [header.catchup, header.catchupDays], ['shift', 2]);
  check('m3u: a title with a comma, a group with a comma', [entries[0].name, entries[0].group], ['FI: Yle TV1, HD', 'Finland, News']);
  check('m3u: attribute names in any case', entries[0].attrs['tvg-id'], 'yle1.fi');
  check('m3u: #EXTVLCOPT goes with its entry', entries[0].userAgent, 'Kodi/20');
  check('m3u: single quotes and bare values; a relative address against the playlist',
    [entries[1].attrs['tvg-id'], entries[1].group, entries[1].url], ['nordic.se', 'Sweden', 'http://p.example/list/stream/2.ts']);
  check('m3u: #EXTGRP when there is no group-title', entries[2].group, 'From EXTGRP');
  check('m3u: an address with no #EXTINF is named after its file', entries[3].name, 'bare.mp4');
  check('m3u: what is not http(s) is left out', entries.length, 4);
  // A provider's page or error where the playlist should be: no entries,
  // so that the viewer is told the address did not return a playlist.
  check('m3u: an HTML page is no playlist', parseM3u('<!doctype html>\n<html>\n<head><title>Stalker</title></head>\n<body>Not found</body></html>\n', 'http://x.test/a.m3u').entries, []);
  check('m3u: a JSON error is no playlist', parseM3u('{"user_info":{"auth":0},"message":"Account expired"}', 'http://x.test/get.php?type=m3u').entries, []);
  check('m3u: a line of text is no playlist', parseM3u('Account expired\n', 'http://x.test/a.m3u').entries, []);
  check('m3u: markup is no address even after the header', parseM3u('#EXTM3U\n#EXTINF:-1,A\n<b>gone</b>\nhttp://s.example/1\n', 'http://x.test/a.m3u').entries.map((e) => [e.name, e.url]), [['A', 'http://s.example/1']]);
  check('m3u: a list of bare http addresses with no header still plays', parseM3u('http://s.example/live/1.ts\r\nhttps://s.example/films/Heat.mp4\r\n', 'http://x.test/a.m3u').entries.map((e) => e.url),
    ['http://s.example/live/1.ts', 'https://s.example/films/Heat.mp4']);
  check('m3u: #EXTINF duration and title', parseExtinf('#EXTINF:5400 tvg-name="x",Film'), { duration: 5400, attrs: { 'tvg-name': 'x' }, title: 'Film' });
}
check('m3u: a panel\'s live, movie and series addresses', [
  classify({ url: 'http://p/u/p/123', name: 'SE: SVT 1' }),
  classify({ url: 'http://p/live/u/p/123.m3u8', name: 'x' }),
  classify({ url: 'http://p/movie/u/p/5.mkv', name: 'NC - 10x10.2018' }),
  classify({ url: 'http://p/series/u/p/9.mkv', name: 'Show S01 E02' }),
  classify({ url: 'http://cdn/films/Heat.1995.mp4', name: 'Heat (1995)' }),
  classify({ url: 'http://cdn/tv/show.s02e03.mkv', name: 'Show S02E03' }),
], ['live', 'live', 'movie', 'series', 'movie', 'series']);
check('m3u: the series, season and episode in a name', [
  episodeOf('SE:Trespasses (2025) S01 E01'),
  episodeOf('NO - Amerikanske tilstander (2022) S2022 E01'),
  episodeOf('Show - s02e10 - The Long Night'),
  episodeOf('Show 3x07'),
  episodeOf('Heat (1995)'),
], [
  { series: 'SE:Trespasses (2025)', season: 1, episode: 1, title: '' },
  { series: 'NO - Amerikanske tilstander (2022)', season: 2022, episode: 1, title: '' },
  { series: 'Show', season: 2, episode: 10, title: 'The Long Night' },
  { series: 'Show', season: 3, episode: 7, title: '' },
  null,
]);
check('m3u: a heading row is not a channel', ['===== Sweden ======', '##### SPORTS #####', '-----', 'SE: SVT 1', 'A-Team'].map(isDivider), [true, true, true, false, false]);
check('m3u: the hash is stable and short', [shortHash('abc'), shortHash('abc') === shortHash('abd')], [shortHash('abc'), false]);
check('m3u: a playlist address is any http(s) address', [playlistAddress(' http://x.example/a.m3u '), playlistAddress('ftp://x'), playlistAddress('nonsense')], ['http://x.example/a.m3u', null, null]);
{
  const start = Date.UTC(2026, 10, 2, 20, 0, 0);
  const stop = start + 3600e3;
  const now = start + 7200e3;
  check('catch-up: a template filled in', fillCatchup('?utc={utc}&lutc={lutc}&d={duration}&m={duration:60}&o={offset}&s=${start}&e=${end}&t={utc:Y-m-d H:M:S}&Y={Y}{m}{d}&b=$(b)yyyyMMddHHmmss', start, stop, now),
    `?utc=${start / 1000}&lutc=${now / 1000}&d=3600&m=60&o=7200&s=${start / 1000}&e=${stop / 1000}&t=2026-11-02 20:00:00&Y=20261102&b=20261102200000`);
  const ch = (mode, direct, source = '') => ({ direct, cu: { mode, source } });
  check('catch-up: the modes', [
    catchupAddress(ch('shift', 'http://s/live/1.m3u8?tok=1'), start, stop, now),
    catchupAddress(ch('append', 'http://s/live/1.m3u8', '?start={utc}&end={utcend}'), start, stop, now),
    catchupAddress(ch('default', 'http://s/live/1.m3u8', 'http://a/archive/1/{utc}-{duration}.m3u8'), start, stop, now),
    catchupAddress(ch('flussonic', 'http://f/ch1/index.m3u8?token=x'), start, stop, now),
    catchupAddress(ch('flussonic', 'http://f/ch1/mpegts?token=x'), start, stop, now),
    catchupAddress(ch('xc', 'http://x:8080/u/p/77'), start, stop, now),
    catchupAddress(ch('xc', 'http://x:8080/live/u/p/77.m3u8'), start, stop, now),
    catchupAddress(ch('', 'http://s/1'), start, stop, now),
  ], [
    `http://s/live/1.m3u8?tok=1&utc=${start / 1000}&lutc=${now / 1000}`,
    `http://s/live/1.m3u8?start=${start / 1000}&end=${stop / 1000}`,
    `http://a/archive/1/${start / 1000}-3600.m3u8`,
    `http://f/ch1/index-${start / 1000}-3600.m3u8?token=x`,
    `http://f/ch1/timeshift_abs-${start / 1000}.ts?token=x`,
    'http://x:8080/timeshift/u/p/60/2026-11-02:20-00/77.ts',
    'http://x:8080/timeshift/u/p/60/2026-11-02:20-00/77.ts',
    null,
  ]);
}
{
  const entries = parseM3u('#EXTM3U\n'
    + '#EXTINF:-1,===== Finland =====\nhttp://p/u/p/1\n'
    + '#EXTINF:-1 tvg-id="yle1.fi" group-title="Finland - News" catchup="xc" catchup-days="3",Yle TV1\nhttp://p/u/p/2\n'
    + '#EXTINF:-1 group-title="Finland - News",Yle TV1\nhttp://p/u/p/3\n'
    + '#EXTINF:-1 tvg-logo="http://i/f.jpg" group-title="Movies: Finland",Heat (1995)\nhttp://p/movie/u/p/4.mkv\n'
    + '#EXTINF:-1 group-title="Series: Nordic",Fjord S01 E02\nhttp://p/series/u/p/6.mkv\n'
    + '#EXTINF:-1 tvg-logo="http://i/s.jpg" group-title="Series: Nordic",Fjord S01 E01\nhttp://p/series/u/p/5.mkv\n'
    + '#EXTINF:-1,No group\nhttp://p/u/p/7\n').entries;
  const c = buildCatalogue(entries, {}, 'Other');
  check('catalogue: the heading row is left out, the rest by type', [c.items.live.length, c.items.movie.length, c.items.series.length], [3, 1, 1]);
  check('catalogue: categories from group-title, and one for none', c.categories.live.map((x) => x.name), ['Finland - News', 'Other']);
  check('catalogue: two channels of one name get ids of their own', new Set(c.items.live.map((x) => x.id)).size, 3);
  check('catalogue: a channel\'s guide id, address and archive', [c.items.live[0].epgId, c.items.live[0].direct, c.items.live[0].archive, c.items.live[0].cu], ['yle1.fi', 'http://p/u/p/2', 3, { mode: 'xc', source: '' }]);
  check('catalogue: a film', [c.items.movie[0].n, c.items.movie[0].ext, c.items.movie[0].year, c.items.movie[0].logo], ['Heat (1995)', 'mkv', 1995, 'http://i/f.jpg']);
  const series = c.items.series[0];
  const eps = c.episodes.get(series.id);
  check('catalogue: a series of its episodes, in order, its cover the first there is', [series.n, eps.map((e) => `${e.season}x${e.episode}`), series.logo], ['Fjord', ['1x1', '1x2'], 'http://i/s.jpg']);
  check('catalogue: the ids do not depend on the address', buildCatalogue(parseM3u('#EXTINF:-1,Yle TV1\nhttp://p/a?token=1\n').entries).items.live[0].id,
    buildCatalogue(parseM3u('#EXTINF:-1,Yle TV1\nhttp://p/a?token=2\n').entries).items.live[0].id);
}

/* --------------------------------------------------------- XMLTV guides */

check('xmltv: times with and without an offset or seconds', [
  parseXmltvTime('20261101200800 +0100'),
  parseXmltvTime('20261101200800+01:00'),
  parseXmltvTime('202611011908'),
  parseXmltvTime('20261101190800 Z'),
  parseXmltvTime('20261101143800 -0430'),
  Number.isNaN(parseXmltvTime('soon')),
], [Date.UTC(2026, 10, 1, 19, 8), Date.UTC(2026, 10, 1, 19, 8), Date.UTC(2026, 10, 1, 19, 8), Date.UTC(2026, 10, 1, 19, 8), Date.UTC(2026, 10, 1, 19, 8), true]);
check('xmltv: entities, references and CDATA', decodeXml('L&apos;equipe &amp; A&#38;E &#x263A; <![CDATA[a & b]]>'), 'L\'equipe & A&E ☺ a & b');
{
  const xml = '<?xml version="1.0"?><tv><channel id="yle1.fi"><display-name>Yle TV1</display-name><display-name>FI: Yle TV1 HD</display-name><icon src="http://i/y.png"/></channel>'
    + '<programme start="20261101210000 +0000" stop="20261101220000 +0000" channel="yle1.fi"><title lang="sv">Nyheter</title><title lang="fi">Uutiset</title><desc lang="fi">Päivän &amp; illan</desc></programme>'
    + '<programme start="20261101200000 +0000" channel="yle1.fi"><title>Before</title><sub-title>Part 2</sub-title><desc>Plot</desc></programme>'
    + '<programme start="20261101220000 +0000" stop="20261101213000 +0000" channel="yle1.fi"><title>Backwards</title></programme></tv>';
  // In pieces cut anywhere, as a download arrives.
  const { channels, programmes } = parseXmltv(xml, ['fi']);
  const list = programmes.get('yle1.fi');
  check('xmltv: a channel with its names and icon', channels, [{ id: 'yle1.fi', names: ['Yle TV1', 'FI: Yle TV1 HD'], icon: 'http://i/y.png' }]);
  check('xmltv: the reader\'s language, a missing stop from the next start, the backwards one dropped, sub-title before the plot',
    list.map((p) => [p.title, p.description, new Date(p.start).toISOString().slice(11, 16), new Date(p.stop).toISOString().slice(11, 16)]),
    [['Before', 'Part 2. Plot', '20:00', '21:00'], ['Uutiset', 'Päivän & illan', '21:00', '22:00']]);
  const { XmltvParser } = await import('../js/xmltv.js');
  const got = [];
  const parser = new XmltvParser({ onProgramme: (id, p) => got.push(p.title) });
  for (let i = 0; i < xml.length; i += 7) parser.push(xml.slice(i, i + 7));
  parser.end();
  check('xmltv: a guide read in pieces of seven characters reads the same', got, ['Nyheter', 'Before', 'Backwards']);
}
check('xmltv: a playlist name and a guide name meet', ['FI: Yle TV1 HD', 'Yle TV1', '|FI| YLE TV 1 FHD', 'Ylé TV1'].map(channelMatchKey), ['yletv1', 'yletv1', 'yletv1', 'yletv1']);

/* ------------------------------------------------- accounts and sync */

check('accounts: an M3U account is its address', accountKey({ type: 'm3u', url: ' http://p/a.m3u ' }), 'm3u:http://p/a.m3u');
check('accounts: the label is the name, or the address', [
  accountLabel({ type: 'm3u', url: 'http://lists.example/a.m3u' }),
  accountLabel({ type: 'xtream', host: 'tv.example', username: 'me' }),
  accountLabel({ type: 'xtream', host: 'tv.example', name: ' Home ' }),
], ['lists.example', 'tv.example · me', 'Home']);
check('accounts: what it takes to connect', [isConfigured({ type: 'm3u', url: 'http://x' }), isConfigured({ type: 'xtream', host: 'h', username: 'u' })], [true, false]);
{
  const accounts = [
    { id: 'a', type: 'xtream', host: 'h', port: '80', scheme: 'http', username: 'u', password: 'secret' },
    { id: 'b', type: 'm3u', url: 'http://p/get.php?username=u&password=p' },
    { id: 'c', type: 'm3u', url: 'http://p/list.m3u' },
  ];
  check('sync: without passwords the password stays, and an address with credentials stays too',
    outgoingAccounts(accounts, false).map((a) => [a.id, a.password ?? null]), [['a', ''], ['c', null]]);
  check('sync: with passwords everything goes', outgoingAccounts(accounts, true).length, 3);
  check('sync: a guide address with credentials goes blank without passwords',
    outgoingAccounts([{ id: 'g', type: 'm3u', url: 'http://p/list.m3u', epgUrl: 'http://p/xmltv.php?username=u&password=p' }], false)[0].epgUrl, '');
  check('sync: a list goes up under a hash of its account, never the address', syncName('favorites', 'm3u:http://p/get.php?username=u&password=p').includes('password'), false);
  check('sync: without passwords the stream addresses stay behind',
    [strippedItems('favorites', [{ k: 0, id: '1', n: 'A', direct: 'http://p/u/p/1', cu: { mode: 'xc' } }]), strippedItems('reminders', [{ title: 'T', channel: { k: 0, id: '1', direct: 'http://p/u/p/1' } }])],
    [[{ k: 0, id: '1', n: 'A' }], [{ title: 'T', channel: { k: 0, id: '1' } }]]);
  check('sync: an item that came without its address gets back the one known here',
    keepAddresses('favorites', [{ k: 0, id: '1', n: 'A' }, { k: 0, id: '2', n: 'B' }], [{ k: 0, id: '1', direct: 'http://p/1', cu: { mode: 'xc' } }]),
    [{ k: 0, id: '1', n: 'A', direct: 'http://p/1', cu: { mode: 'xc' } }, { k: 0, id: '2', n: 'B' }]);
  const local = [{ id: 'a', type: 'xtream', host: 'h', port: '80', scheme: 'http', username: 'u', password: 'secret' }, { id: 'd', type: 'm3u', url: 'http://only/here' }];
  const remote = [{ id: 'a', type: 'xtream', host: 'h', port: '80', scheme: 'http', username: 'u', password: '' }, { id: 'c', type: 'm3u', url: 'http://p/list.m3u' }];
  check('sync: an account coming down keeps the password known here', incomingAccounts(remote, local)[0].password, 'secret');
  check('sync: a first sync joins, a later one follows', [incomingAccounts(remote, local, { join: true }).map((a) => a.id), incomingAccounts(remote, local).map((a) => a.id)], [['a', 'c', 'd'], ['a', 'c']]);
  check('sync: the history joined, the latest watch of each first',
    joinRecents([{ k: 0, id: '1', watchedAt: 5 }, { k: 0, id: '2', watchedAt: 9 }], [{ k: 0, id: '1', watchedAt: 7 }, { k: 1, id: '3', watchedAt: 1 }]).map((e) => `${e.id}@${e.watchedAt}`),
    ['2@9', '1@7', '3@1']);
  check('sync: resume points joined, the later of each', joinResume({ '1:a': { at: 5, position: 10 } }, { '1:a': { at: 9, position: 20 }, '3:b': { at: 1, position: 3 } }),
    { '1:a': { at: 9, position: 20 }, '3:b': { at: 1, position: 3 } });
  check('sync: favourites joined once each', joinFavorites([{ k: 0, id: '1' }], [{ k: 0, id: '1' }, { k: 0, id: '2' }]).map((f) => f.id), ['1', '2']);
}


/* ------------------------------------------- js/mkv.js: a holed file */

{
  const { BufferedBytes, frames } = await import('../js/mkv.js');
  // Cluster (unknown size), Timestamp, and SimpleBlocks of track 1.
  const cluster = (ts, blocks) => [0x1f, 0x43, 0xb6, 0x75, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xe7, 0x82, ts >> 8, ts & 0xff,
    ...blocks.flatMap(([rel, key]) => [0xa3, 0x86, 0x81, 0x00, rel, key ? 0x80 : 0x00, 0xaa, 0xbb])];
  const read = async (parts) => {
    const bytes = new BufferedBytes();
    for (const part of parts) bytes.push(new Uint8Array(part));
    bytes.end();
    const out = [];
    const events = [];
    for await (const f of frames(bytes, { timestampScale: 1e6, tracks: new Map([[1, {}]]),
      onStop: (reason) => events.push(reason), onResync: (at, skipped) => events.push(`resync ${at}+${skipped}`) })) out.push(`${f.pts / 1e6}${f.keyframe ? 'k' : ''}`);
    return { out, events };
  };
  const first = cluster(0, [[0, true], [40, false]]);
  // The measured case in small: zeros where a stretch of the file is
  // missing, then the rest of a cluster, then whole clusters again. A
  // cluster id inside picture data, with no Timestamp after it, is passed by.
  const fake = [0x1f, 0x43, 0xb6, 0x75, 0x81, 0x00];
  const holed = await read([first, new Array(5000).fill(0), [0x12, 0x34, ...fake, 0x56], cluster(9000, [[0, true], [40, false]]).slice(0, 7), cluster(9000, [[0, true], [40, false]]).slice(7)]);
  check('mkv: reading goes on at the next cluster after a damaged stretch', holed.out, ['0k', '40', '9000k', '9040']);
  check('mkv: where the damage began and how much went', holed.events, [`resync ${first.length}+${5000 + 2 + fake.length + 1}`, 'stream ended']);
  // ffmpeg writes a CRC-32 (0xBF) as a cluster's first child, before its Timestamp.
  const crc = cluster(7000, [[0, true]]);
  crc.splice(12, 0, 0xbf, 0x84, 1, 2, 3, 4);
  check('mkv: a cluster that starts with a CRC-32 is found too', (await read([first, new Array(100).fill(0), crc])).out, ['0k', '40', '7000k']);
  check('mkv: a file whose damage runs to its end ends there', (await read([first, new Array(300).fill(0)])).events, ['stream ended']);
}


/* -------------------------------------------- js/picks.js: the picks */

{
  const { programmeKey, noteWatched, pickProgrammes } = await import('../js/picks.js');
  check('picks: a programme is the same from one airing to the next', [
    'Uutiset · Episode 5', 'Uutiset (R)', 'Uutiset S02E05', 'UUTISET: osa 3', 'Ylen aamu-tv', 'Formula 1: Brasilian GP',
  ].map(programmeKey), ['uutiset', 'uutiset', 'uutiset', 'uutiset', 'ylen aamu tv', 'formula 1 brasilian gp']);
  const now = Date.UTC(2026, 10, 2, 18, 0);
  const notes = noteWatched(noteWatched(noteWatched({}, 'Uutiset · Episode 1', now - 86400e3), 'Uutiset (R)', now - 3600e3), 'Formula 1: Practice', now - 7 * 86400e3);
  check('picks: a watch noted by its programme, counted', [notes.uutiset.n, notes.uutiset.at, notes['formula 1 practice'].n], [2, now - 3600e3, 1]);
  const many = {};
  for (let i = 0; i < 250; i++) many[`show ${i}`] = { t: `Show ${i}`, n: i % 5 + 1, at: now - i * 3600e3 };
  check('picks: the notes are kept small, the most telling stay', [Object.keys(noteWatched(many, 'New one', now)).length, 'new one' in noteWatched(many, 'New one', now)], [200, true]);
  const p = (title, startMin, minutes) => ({ title, start: now + startMin * 60e3, stop: now + (startMin + minutes) * 60e3 });
  const guide = {
    fav: [p('Old film', -90, 85), p('Cooking', -20, 60), p('Late show', 40, 60), p('Night film', 100, 90)],
    often: [p('Uutiset · Episode 7', -10, 30), p('Sport tonight', 20, 60)],
    other: [p('Formula 1: Qualifying', 30, 90), p('Weather', 60, 5)],
    hd: [p('Uutiset · Episode 7', -10, 30)],
  };
  const ch = (id) => ({ id, n: id.toUpperCase() });
  const picks = pickProgrammes({
    channels: [{ item: ch('fav'), favorite: true, rank: null }, { item: ch('often'), favorite: false, rank: 0 }, { item: ch('other'), favorite: false, rank: 9 }, { item: ch('hd'), favorite: false, rank: 1 }],
    listings: (item) => guide[item.id], notes, reminded: new Set(['late show']), now, limit: 6,
  });
  // A word shared with something watched (Formula) lifts a programme over
  // the same channel's others, though not over a channel watched lately.
  check('picks: watched first, then a reminder, a favourite; two at most a channel; the ending film and the same airing twice left out',
    picks.map((x) => `${x.channel.id}:${x.programme.title}:${x.why}${x.on ? ':on' : ''}`),
    ['often:Uutiset · Episode 7:watched:on', 'fav:Late show:reminder', 'fav:Cooking:favorite:on', 'often:Sport tonight:often', 'other:Formula 1: Qualifying:often', 'other:Weather:often']);
  check('picks: nothing without programme data', pickProgrammes({ channels: [{ item: ch('x'), favorite: true, rank: null }], listings: () => null, now }), []);
}


/* ------------------------------------------- Stalker portal, recordings */

{
  const { normalizeMac, normalizePortal, endpoints, cmdAddress, cmdIsDirect, stalkerChannel, stalkerMovie, stalkerProgramme } = await import('../js/stalker.js');
  const { syncOffset } = await import('../js/streamhub.js');
  const { parseHlsPlaylist, recordingFileName } = await import('../js/recorder.js');
  const { isConfigured, accountKey, accountLabel } = await import('../js/config.js');
  check('stalker: a MAC address in any of its usual forms', ['00:1a:79:ab:cd:ef', '001A79ABCDEF', '00-1A-79-AB-CD-EF', ' 00 1A 79 AB CD EF '].map(normalizeMac), Array(4).fill('00:1A:79:AB:CD:EF'));
  check('stalker: what is no MAC address', ['00:1A:79', '00:1A:79:AB:CD:EF:01', 'GG:1A:79:AB:CD:EF', ''].map(normalizeMac), [null, null, null, null]);
  check('stalker: the portal address made whole',
    ['example.tv:8080/c', 'http://example.tv:8080/c/', 'http://example.tv/stalker_portal/c/index.html', 'https://example.tv/portal.php', 'not an address at all'].map(normalizePortal),
    ['http://example.tv:8080/c/', 'http://example.tv:8080/c/', 'http://example.tv/stalker_portal/c/', 'https://example.tv/', null]);
  check('stalker: the API beside the box\'s page first', endpoints('http://example.tv:8080/c/'),
    ['http://example.tv:8080/server/load.php', 'http://example.tv:8080/portal.php', 'http://example.tv:8080/stalker_portal/server/load.php']);
  check('stalker: Ministra\'s own address', endpoints('http://example.tv/stalker_portal/c/')[0], 'http://example.tv/stalker_portal/server/load.php');
  check('stalker: the address in a cmd', ['ffmpeg http://a.tv/live/1.ts?play_token=x', 'ffrt3 http://localhost/ch/12_', 'auto https://b.tv/x.m3u8', 'nothing'].map(cmdAddress),
    ['http://a.tv/live/1.ts?play_token=x', 'http://localhost/ch/12_', 'https://b.tv/x.m3u8', null]);
  check('stalker: the placeholder is no stream', [cmdIsDirect('ffrt http://localhost/ch/12_'), cmdIsDirect('ffmpeg http://a.tv/live/1.ts')], [false, true]);
  check('stalker: a channel row', stalkerChannel({ id: 12, name: 'Yle TV1', number: '1', cmd: 'ffrt http://localhost/ch/12_', logo: '/stalker_portal/misc/logos/1.png', tv_genre_id: '3' }, 'http://p.tv'),
    { id: '12', k: 0, n: 'Yle TV1', logo: 'http://p.tv/stalker_portal/misc/logos/1.png', cats: ['3'], epgId: '12', archive: 0, direct: null, cmd: 'ffrt http://localhost/ch/12_', num: 1 });
  const film = stalkerMovie({ id: 5, name: 'Film (2020)', cmd: 'ffmpeg http://p.tv/media/5.mkv', time: '95', year: '2020', genres_str: 'Drama' }, '7', 'http://p.tv');
  check('stalker: a film row', [film.id, film.k, film.cats, film.ext, film.durationSec, film.genre, film.cmd], ['5', 1, ['7'], 'mkv', 5700, 'Drama', 'ffmpeg http://p.tv/media/5.mkv']);
  check('stalker: a programme in milliseconds', stalkerProgramme({ id: 1, name: 'Uutiset', descr: 'Päivän uutiset', start_timestamp: '1700000000', stop_timestamp: 1700001800 }),
    { id: '1', title: 'Uutiset', description: 'Päivän uutiset', start: 1700000000000, stop: 1700001800000 });
  const portal = { type: 'stalker', url: 'http://p.tv/c/', mac: '00:1A:79:00:00:01' };
  check('stalker: an account with a portal and a MAC address can connect', [isConfigured(portal), isConfigured({ ...portal, mac: '00:1A' }), isConfigured({ ...portal, url: '' })], [true, false, false]);
  check('stalker: the account\'s key and label', [accountKey(portal), accountLabel(portal)], ['stalker:http://p.tv/c/|00:1A:79:00:00:01', 'p.tv']);
  const packets = new Uint8Array(1000);
  for (const at of [100, 288, 476, 664, 852]) packets[at] = 0x47;
  packets[30] = 0x47;      // a stray 0x47 inside a packet
  check('streamhub: a late reader starts at a packet boundary', [syncOffset(packets), syncOffset(new Uint8Array(400))], [100, -1]);
  const master = parseHlsPlaylist('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nlow.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=3000000\nhigh/index.m3u8\n', 'http://a.tv/live/1.m3u8');
  check('recorder: the best variant of a master playlist', master.variants.map((v) => v.uri), ['http://a.tv/live/high/index.m3u8', 'http://a.tv/live/low.m3u8']);
  const media = parseHlsPlaylist('#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXT-X-MEDIA-SEQUENCE:120\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:4.0,\nseg120.m4s\n#EXTINF:4.0,\nhttp://cdn.tv/seg121.m4s\n#EXT-X-ENDLIST\n', 'http://a.tv/live/1.m3u8');
  check('recorder: a media playlist\'s segments, numbered', [media.target, media.map, media.ended, media.segments.map((x) => `${x.seq}:${x.uri}`)],
    [4, 'http://a.tv/live/init.mp4', true, ['120:http://a.tv/live/seg120.m4s', '121:http://cdn.tv/seg121.m4s']]);
  const at = new Date(2026, 10, 3, 20, 5).getTime();
  check('recorder: the file name says what, where and when, and nothing a disk refuses',
    recordingFileName({ title: 'Uutiset: "Ilta"/Sää', channel: { displayName: 'Yle TV1' }, startedAt: at, ext: 'ts' }), 'Uutiset Ilta Sää – Yle TV1 2026-11-03 20.05.ts');
  const { outgoingAccounts: going } = await import('../js/sync.js');
  check('sync: a Stalker account stays home without passwords, goes with them', [going([portal], false).length, going([portal], true).length], [0, 1]);
}

/* ----------------------------------------------- dev/listings.mjs */

check('a wrapped paragraph is one line for the store',
  unwrap('Watch your own\nsubscription.\n\n\nWHAT YOU GET\n\n• A bullet that\n  goes on.\n• Another.\n- Samuli\n\n\nSEE IT\n\nA tour:\nhttps://example.com/v'),
  'Watch your own subscription.\n\nWHAT YOU GET\n\n• A bullet that goes on.\n• Another.\n- Samuli\n\nSEE IT\n\nA tour: https://example.com/v');
check('a word five times is a keyword list; short words and four times are not',
  repeats('stream stream stream stream stream and and and and and IPTV IPTV IPTV IPTV'), [['stream', 5]]);
check('every listing is within the store\'s limits, and _locales is in step', checkListings(), []);
// The glossary's forms are compared without case, and Turkish İ (which
// lowercases to i and a combining dot) still holds a plain i.
// Pseudo-localisation (player.html?pseudo=1): accented, about 40 % longer,
// placeholders kept so that t() can still fill them, symbols left alone.
check('pseudo text keeps its placeholders', pseudoText('{title} starts at {time} on {channel}').match(/\{\w+\}/g), ['{title}', '{time}', '{channel}']);
check('pseudo text is accented and bracketed', /^\[Šéţţîñĝš/.test(pseudoText('Settings')) && pseudoText('Settings').endsWith(']'), true);
check('pseudo text is about 40 % longer', Math.round(pseudoText('Programme guide and catch-up from the past days').length / 47 * 10) / 10, 1.4);
check('pseudo text leaves symbols alone', pseudoText('−'), '−');
check('pseudo text has no plain ASCII letters left', /[A-Za-z]/.test(pseudoText('Continue watching').replace(/\{\w+\}/g, '')), false);
check('a glossary form holds in any case', holds('Programmübersicht öffnen', { forms: ['übersicht'] }), true);
check('Turkish İ holds the form with i', holds('İzlemeye devam et', { forms: ['izlemeye devam et'] }), true);
check('another word does not hold the term', holds('Textens utseende', { forms: ['undertext'] }), false);

/* ----------------------------------------------- dev/vendorcheck.mjs */

{
  const { parseChecksums, check: checkVendor } = await import('./vendorcheck.mjs');
  const hash = 'a'.repeat(64);
  check('a CHECKSUMS line is hash, file and version; a malformed or repeated one is said',
    parseChecksums(`# comment\n${hash}  hls.js  hls.js 1.6.5\n${hash} mpegts.js\n${hash}  hls.js  hls.js 1.6.6\n`),
    { entries: { 'hls.js': { hash, version: 'hls.js 1.6.6' } }, problems: ['vendor/CHECKSUMS line 3 is not "<sha256>  <file>  <version>"', 'vendor/CHECKSUMS lists hls.js twice'] });
  check('vendor/ is the third-party code listed in vendor/CHECKSUMS', checkVendor(), []);
}

/* ----------------------------------------------- dev/package.mjs: permissions */

{
  const { permissionProblems } = await import('./package.mjs');
  const manifest = JSON.parse(readFileSync(new URL('../firefox/manifest.json', import.meta.url), 'utf8'));
  check('the manifests\' permissions are the approved ones', [permissionProblems('firefox', manifest), permissionProblems('chrome', JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8')))], [[], []]);
  const more = structuredClone(manifest);
  more.permissions.push('tabs');
  more.optional_host_permissions = ['https://*/*'];
  more.content_security_policy.extension_pages += " 'unsafe-eval'";
  more.browser_specific_settings.gecko.data_collection_permissions.optional = ['technicalAndInteraction'];
  check('a permission without a reason, a dropped one, a looser policy and more data collection are each refused', permissionProblems('firefox', more).map((p) => p.split(',')[0]), [
    'firefox: permissions has tabs',
    'firefox: optional_host_permissions lacks http://*/*',
    `firefox: content_security_policy.extension_pages is "script-src 'self' 'wasm-unsafe-eval'; object-src 'self' 'unsafe-eval'"`,
    'firefox: data_collection_permissions.optional is not approved in dev/package.mjs',
  ]);
}

/* ----------------------------------------------- dev/package.mjs: old zips */

{
  const { zipName, compareVersions, previousZip, shelveOlderZips } = await import('./package.mjs');
  const { mkdtempSync, writeFileSync: write, mkdirSync: mkdir, readdirSync: list, rmSync: remove } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  check('a release zip\'s name gives its browser, version and kind; the first Chrome ones had no browser in it',
    ['kepuli-tv-chrome-1.6.3.zip', 'kepuli-tv-1.0.1.zip', 'kepuli-tv-firefox-1.6.3-amo-source.zip', 'kepuli-tv-firefox-1.6.3-dev.zip', 'other.zip'].map(zipName),
    [{ target: 'chrome', version: '1.6.3', kind: 'package' }, { target: 'chrome', version: '1.0.1', kind: 'package' },
      { target: 'firefox', version: '1.6.3', kind: 'amo-source' }, { target: 'firefox', version: '1.6.3', kind: 'dev' }, null]);
  check('versions compare by number, not as text', [compareVersions('1.10.0', '1.9.9') > 0, compareVersions('1.6', '1.6.0'), compareVersions('1.2.5', '1.2.6') < 0], [true, 0, true]);
  const root = mkdtempSync(join(tmpdir(), 'kepuli-zips-'));
  const releases = join(root, 'dist', 'releases');
  try {
    mkdir(releases, { recursive: true });
    for (const f of ['kepuli-tv-chrome-1.6.3.zip', 'kepuli-tv-firefox-1.6.3.zip', 'kepuli-tv-firefox-1.6.3-amo-source.zip', 'kepuli-tv-chrome-1.6.2.zip',
      'kepuli-tv-firefox-1.6.2-amo-source.zip', 'kepuli-tv-1.0.1.zip', 'kepuli-tv-chrome-1.7.0.zip', 'notes.txt']) write(join(root, f), f);
    for (const f of ['kepuli-tv-chrome-1.10.0.zip', 'kepuli-tv-chrome-1.5.3.zip', 'kepuli-tv-1.0.1.zip']) write(join(releases, f), 'already here');
    check('the previous package is the newest older one, wherever it is, and never an AMO source or a newer one',
      [previousZip('chrome', '1.6.3', [root, releases]), previousZip('firefox', '1.6.3', [root, releases]), previousZip('chrome', '1.6.2', [root, releases])]
        .map((p) => p && p.slice(root.length + 1)), ['kepuli-tv-chrome-1.6.2.zip', undefined, 'dist/releases/kepuli-tv-chrome-1.5.3.zip']);
    const shelved = shelveOlderZips('1.6.3', root, releases);
    check('older zips move into dist/releases/; the current, newer ones, other files and a name already taken stay',
      [shelved, list(root).filter((f) => f.endsWith('.zip') || f.endsWith('.txt')).sort(), list(releases).sort()],
      [{ moved: ['kepuli-tv-chrome-1.6.2.zip', 'kepuli-tv-firefox-1.6.2-amo-source.zip'], kept: ['kepuli-tv-1.0.1.zip'] },
        ['kepuli-tv-1.0.1.zip', 'kepuli-tv-chrome-1.6.3.zip', 'kepuli-tv-chrome-1.7.0.zip', 'kepuli-tv-firefox-1.6.3-amo-source.zip', 'kepuli-tv-firefox-1.6.3.zip', 'notes.txt'],
        ['kepuli-tv-1.0.1.zip', 'kepuli-tv-chrome-1.10.0.zip', 'kepuli-tv-chrome-1.5.3.zip', 'kepuli-tv-chrome-1.6.2.zip', 'kepuli-tv-firefox-1.6.2-amo-source.zip']]);
  } finally {
    remove(root, { recursive: true, force: true });
  }
}

/* ----------------------------------------------- dev/releasenotes.mjs */

{
  const { sectionOf, draft } = await import('./releasenotes.mjs');
  check('a commit goes where most of its runtime files are; moved code, tests and tooling go to development', [
    sectionOf({ subject: 'A double click goes full screen', files: ['js/playback.js', 'js/playercontrols.js', 'js/app.js', 'dev/playcheck.mjs'] }),
    sectionOf({ subject: 'Choose categories like Choose countries', files: ['js/app.js', 'css/player.css', 'js/AGENTS.md'] }),
    sectionOf({ subject: 'The recording UI out of app.js into js/recordingsui.js', files: ['js/app.js', 'js/recordingsui.js'] }),
    sectionOf({ subject: 'CI on every push', files: ['.github/workflows/checks.yml'] }),
    sectionOf({ subject: 'Both stores\' screenshots retaken', files: ['brand/screenshots/1.png', 'store/listings/en.txt', 'dev/store-screenshots.mjs'] }),
    sectionOf({ subject: 'A compact README', files: ['README.md', 'docs/user-guide.md', 'docs/index.html', 'dev/site.mjs'] }),
    sectionOf({ subject: 'Ready to release? in one command', files: ['dev/release.mjs', 'AGENTS.md'] }),
  ], ['Player', 'Everything else in the player', 'Development (usually left out)', 'Development (usually left out)', 'Store pages and the website', 'Documentation', 'Development (usually left out)']);
  check('the draft has the summary, the sections in order, oldest first, and the three packages; release commits are left out',
    draft([{ subject: 'Release 1.6.3: tidier', files: ['manifest.json'] }, { subject: 'Subtitles stay in step', files: ['js/subs.js'] },
      { subject: 'The guide scrolls to now.', files: ['js/guide.js'] }, { subject: 'Seeking is quicker', files: ['js/playback.js'] }], '1.7.0').split('\n'),
    ['One sentence on what this release is about, for users.', '', '### Player', '', '- Seeking is quicker.', '- Subtitles stay in step.', '',
      '### Guide', '', '- The guide scrolls to now.', '', '### Packages', '', '- `kepuli-tv-chrome-1.7.0.zip` — Chrome',
      '- `kepuli-tv-firefox-1.7.0.zip` — Firefox', '- `kepuli-tv-firefox-1.7.0-amo-source.zip` — the source archive for AMO review', '']);
}

/* ------------------------------------------------------------------ done */

console.log(failed ? `${failed} of ${count} cases failed` : `PASS: ${count} cases`);
process.exit(failed ? 1 : 0);
