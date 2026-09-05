// The interface language.
//
// Two languages, one dictionary. English is the default and at the same
// time the list that missing keys fall back to: if a Finnish string is left
// undone, the screen shows English text rather than a key name.
//
// The language changes without reloading the page. That works because the
// app repaints its views from state anyway — all that is needed on top is
// a pass over the static HTML, see applyStatic.
//
// The formatters (js/format.js) do not live here, but they follow the same
// choice: localeTag() gives them an Intl tag.

export const LANGUAGES = { en: 'English', fi: 'Suomi' };
export const DEFAULT_LANGUAGE = 'en';

// en-GB rather than en: in an IPTV app the time is 21:30, not 9:30 PM, and
// the day comes before the month.
const LOCALE_TAG = { en: 'en-GB', fi: 'fi-FI' };

const STRINGS = {
  en: {
    /* ------------------------------------------------------------ top bar */
    'tab.live': 'Channels',
    'tab.movie': 'Movies',
    'tab.series': 'Series',
    'tab.fav': 'Favourites',
    'tab.recent': 'History',
    'search.placeholder': 'Search by name…',
    'btn.guide': 'Guide',
    'btn.guide.title': 'Programme guide and catch-up  ( g )',
    'btn.refresh': 'Refresh',
    'btn.refresh.title': 'Fetch the lists again from the server',
    'btn.settings': 'Settings',
    'account.expiring': 'Valid until {date} — {days} d left',
    'account.valid': 'Valid until {date}',

    /* ---------------------------------------------------------- sidebar */
    'groups.filter.placeholder': 'Filter countries and topics…',
    'groups.all': 'All',
    'groups.all.title': 'Loads the whole list from the server',
    'kind.c': 'Categories',
    'kind.0': 'Channels',
    'kind.1': 'Movies',
    'kind.2': 'Series',

    /* ------------------------------------------------------------- list */
    'subcats.all': 'All',
    'subcats.general': 'General',
    'subcats.resize.title': 'Drag to set the height of the topic bar, double-click for the default',
    'crumbs.back': '← Back',
    'list.topics': '{n} topics',
    'list.partial': 'whole list not loaded',
    'list.items.one': '{n} item',
    'list.items.other': '{n} items',
    'list.episodes.one': '{n} episode',
    'list.episodes.other': '{n} episodes',
    'unit.live.one': '{n} channel',
    'unit.live.other': '{n} channels',
    'unit.movie.one': '{n} movie',
    'unit.movie.other': '{n} movies',
    'unit.series.one': '{n} series',
    'unit.series.other': '{n} series',
    'unit.generic.one': '{n} item',
    'unit.generic.other': '{n} items',
    'season': 'Season {season}',
    'history.clear': 'Clear history',
    'history.clear.confirm': 'Confirm clearing',
    'history.cleared': 'History cleared',

    /* ------------------------------------------------------------- rows */
    'row.fav.add': 'Add to favourites',
    'row.fav.remove': 'Remove from favourites',
    'row.remove.history': 'Remove from history',
    'row.watched': 'Watched {stamp}',
    'row.archive': '{days} d',
    'row.archive.title': 'Catch-up: programmes from the past {days} days',
    'row.ext.warn': 'The file extension does not promise playback in the browser — the exact reason shows when you try',
    'row.cat.count.title': 'Category size according to the last load',
    'row.cat.subtitle': '{kind} · {where}',

    /* ------------------------------------------------------ empty states */
    'empty.browse': 'Browse channels',
    'empty.nohits': 'No matches',
    'empty.nohits.text': 'The search “{query}” returned nothing.',
    'empty.category': 'Category is empty',
    'empty.category.text': 'The provider returns no content for this category right now. It may have been removed or emptied from the list.',
    'empty.fav': 'No favourites',
    'empty.fav.text': 'The star at the start of a row or next to the player picks a channel, movie or episode. The star on a sidebar country or on a topic chip picks the whole category. Favourites are there without loading any list.',
    'empty.recent': 'History is empty',
    'empty.recent.text': 'Channels, movies and episodes you watch collect here on their own, newest first.',
    'empty.plain': 'Empty category',
    'list.aria': 'Contents',
    'groups.aria': 'Countries and topics',
    'guide.aria': 'Programme guide',
    'error.list': 'The list could not be loaded',
    'empty.plain.text': 'There is no content in this category.',

    /* --------------------------------------------------------- loading */
    'progress.loading': 'Loading…',
    'progress.connecting': 'Connecting…',
    'progress.list': 'Loading {what}…',
    'progress.list.live': 'the channel list',
    'progress.list.movie': 'the movie list',
    'progress.list.series': 'the series list',
    'progress.reason.search': 'Search needs the whole list',
    'progress.reason.all': '“All” needs the whole list',
    'progress.group': 'Loading: {group}',
    'progress.categories': '{done} / {total} categories',
    'progress.bytes': '{received} / {total}',
    'progress.received': '{received} loaded',
    'progress.refresh': 'Refreshing lists…',
    'progress.cancelled': 'Cancelled.',
    'error.connect.cancelled': 'Connecting was cancelled. Try again or check the settings.',
    'toast.refreshed': 'Lists refreshed',

    /* ------------------------------------------------------ connection */
    'error.connect.title': 'Connection failed',
    'error.unexpected': 'Unexpected error: {message}',
    'error.grant': 'Allow access: {origin}',
    'error.grant.denied': 'The browser did not grant access',
    'error.noserver': 'No connection to the server',
    'api.unreachable': 'The server could not be reached ({message}).',
    'api.rejected': 'The server rejected the credentials.',
    'api.status': 'The server answered {status} {statusText}.',
    'api.notxtream': 'This address does not answer as an Xtream Codes server. Check the server and the port.',
    'api.authfailed': 'Authentication failed.',
    'api.nocategories': 'The category list was missing.',
    'api.nostreams': 'The stream list was missing.',
    'api.badjson': 'The answer was not valid JSON.',
    'api.timeout': 'The server did not answer within {seconds} seconds.',
    'api.episode': 'Episode {number}',

    /* ---------------------------------------------------------- player */
    'player.idle': 'Nothing playing',
    'player.idle.text': 'Pick a channel from the list.',
    'player.disconnected': 'Not connected',
    'player.mode.title': 'Playback mode',
    'player.subs.title': 'Subtitles',
    'player.subs.off': 'No subtitles',
    'player.fullscreen.title': 'Full screen',
    'player.reload.title': 'Reload the stream',
    'player.pip.title': 'Picture in picture',
    'player.pip.unavailable': 'PiP not available',
    'player.copy.title': 'Copy the stream address',
    'player.copied': 'Address copied to the clipboard',
    'player.dropped': 'Connection lost',
    'player.retrying': 'retrying ({attempt}/{max})…',
    'player.probing': 'Examining the file',
    'player.probing.text': 'Reading the header from the server…',
    'player.waiting': 'Playback is waiting',
    'player.failed': 'Playback failed',
    'player.retry': 'Try again',
    'player.copyurl': 'Copy address',
    'player.silent': 'Play without sound',
    'player.nourl': 'No playback address was found for this item',
    'player.catchup': 'Catch-up {time}',
    'player.title': '{name} — Kepuli-TV',
    'playback.startfailed': 'Playback could not be started.',
    'playback.hint.copy': '{reason} Copy the address with the URL button and open it in VLC, for example.',
    'playback.nosource': 'Playback did not work. The source did not answer or the format is not supported.',
    'playback.autoplay': 'The browser blocked autoplay — press play.',
    'playback.gaveup': 'The stream stopped ({reason}) and did not recover in {max} attempts. ',
    'playback.gaveup.hint': 'Try again or change the playback mode.',
    'playback.reason.ended': 'the source ended',
    'playback.reason.buffer': 'the buffer ran dry',
    'playback.reason.frozen': 'the picture froze',
    'playback.reason.media': 'media error {code}',
    'playback.reason.demux': 'demuxing failed',
    'playback.reason.network': 'the connection was lost',
    'playback.died': 'Playback stopped: {reason}.',
    'engine.native': 'native',
    'engine.remux': 'MKV remux',

    /* ---------------------------------------------------------- detail */
    'info.next': 'Next {time} · {title}',
    'info.unsupported': ' (not supported)',
    'info.subs.one': '{n} subtitle: {languages}',
    'info.subs.other': '{n} subtitles: {languages}',
    'info.subs.count.one': '{n} subtitle',
    'info.subs.count.other': '{n} subtitles',
    'info.subs.none': 'No subtitles',
    'subs.unknown': 'Unknown language',
    'subs.forced': 'forced',
    'audio.unknown': 'Unknown language',
    'audio.commentary': 'commentary',
    'audio.described': 'audio description',
    'audio.channels': '{n} ch',

    /* ----------------------------------------------------------- guide */
    'guide.needserver': 'Connect to a server first',
    'guide.epgoff': 'Programme data is switched off in settings',
    'guide.needgroup': 'Pick a channel group first',
    'guide.allchannels': 'All channels',
    'guide.group.title': 'Channel group',
    'guide.prev.title': 'Half an hour back',
    'guide.now': 'Now',
    'guide.now.title': 'Back to the present',
    'guide.next.title': 'Half an hour forward',
    'guide.out.title': 'Show a longer span',
    'guide.in.title': 'Show a shorter span',
    'guide.close': 'Close',
    'guide.loading': 'Loading…',
    'guide.noepg': 'No programme data',
    'guide.noepg.channel': 'There is no programme data for this channel.',
    'guide.watch': 'Watch the channel',
    'guide.watch.recording': 'Watch the recording',
    'guide.norecording': 'The programme has no recording — the button starts the channel live',
    'guide.starts': '{title} starts at {time}',
    'guide.startsin': 'starts {when}',
    'guide.minutes': 'in {minutes} min',
    'guide.at': 'at {time}',
    'guide.ended': 'ended',
    'guide.catchup': 'Catch-up {days} d',
    'guide.catchup.title': 'Catch-up from the past {days} days',

    /* ------------------------------------------------------ favourites */
    'fav.button.title': 'Add to favourites',

    /* ------------------------------------------------- external player */
    'ext.label': 'VLC or another default player for .m3u',
    'ext.title': 'Open in an external player',
    'ext.nothing': 'There is no playback to hand over',
    'ext.handed': 'Handed to an external player',
    'ext.handed.text': 'The playlist was downloaded — open it from the browser downloads.',
    'ext.continue': 'Continue in the browser',

    /* ------------------------------------------------------- Chromecast */
    'cast.title': 'Cast to a Chromecast',
    'cast.nothing': 'There is no playback to cast',
    'cast.loading': 'Wait for playback to start',
    'cast.nodevice': 'No Chromecast was found on this network',
    'cast.playing': 'Chromecast',
    'cast.tab': 'Cast the tab from Chrome\u2019s menu',
    'cast.tab.text': 'This stream runs through MediaSource, which the Remote Playback API does not accept. Choose Cast\u2026 from Chrome\u2019s menu and cast this tab, then press f: once the video is full screen, Chrome sends the picture as it is, without re-encoding.',
    'cast.fullscreen': 'Full screen',
    'cast.close': 'Close',

    /* --------------------------------------------------------- settings */
    'setup.title': 'Settings',
    'setup.welcome': 'Welcome',
    'setup.welcome.text': 'Enter your details and the channels appear in the list.',
    'setup.source': 'Connection',
    'setup.source.xtream': 'Xtream Codes',
    'setup.source.m3u': 'M3U address',
    'setup.scheme': 'Protocol',
    'setup.security': 'Use HTTPS when your provider supports it. With HTTP, your username, password and viewing requests travel without encryption and can be read or changed by others on the network.',
    'setup.host': 'Server',
    'setup.port': 'Port',
    'setup.username': 'Username',
    'setup.password': 'Password',
    'setup.m3u.label': 'Address of the channel list',
    'setup.m3u.bad': 'The address has no username and password',
    'setup.m3u.ok': 'Address read',
    'setup.language': 'Language',
    'setup.subs': 'Subtitles',
    'setup.subs.style': 'Style',
    'setup.subs.size': 'Size',
    'setup.subs.sample': 'Subtitles look like this,\non two lines as well.',
    'subs.style.shadow': 'Shadow',
    'subs.style.outline': 'Outline',
    'subs.style.yellow': 'Yellow',
    'subs.style.box': 'Box',
    'subs.style.contrast': 'High contrast',
    'setup.epg': 'Fetch programme data automatically',
    'setup.resume': 'Remember where movies and episodes were left',
    'setup.clear': 'Clear cache',
    'setup.clear.title': 'Removes the loaded lists and programme data. Credentials and favourites stay.',
    'setup.cleared': 'Cache cleared',
    'setup.reset': 'Reset everything',
    'setup.reset.title': 'Removes credentials, favourites, history, resume points and the cache',
    'setup.reset.confirm': 'Confirm: delete everything',
    'setup.reset.failed': 'Reset failed',
    'setup.cancel': 'Cancel',
    'setup.close': 'Close',
    'setup.save': 'Connect',
    'setup.nogrant': 'Without access to the server the connection cannot work',
    'account.title': 'Account:',
    'account.trial': ' (trial)',
    'account.connections.label': 'Simultaneous connections',
    'account.valid.label': 'Valid until',
    'account.formats': 'Formats',
    'account.servertime': 'Server time',
    'account.cache': 'Cache',
    'account.lists': 'Loaded lists',
    'account.none': 'none',

    /* ------------------------------------------------------------ file */
    'probe.unread': 'The header could not be read: {error}',
    'probe.untested': 'The file has not been examined.',
    'probe.mp4': 'MP4 — the browser’s own player.',
    'probe.mpegts': 'MPEG-TS — mpegts.js.',
    'probe.container': 'The container {container} is not supported in the browser.',
    'probe.truncated': 'The track data did not fit in the header.',
    'probe.video': 'The video codec {codec} cannot be decoded in this browser.',
    'probe.noaudio': 'The file has no audio track.',
    'probe.decoded': 'MKV: {video} + {audio} — the audio is decoded in the player.',
    'probe.silent': 'The audio track is {codec}, which the browser does not decode. The picture would play, the sound would not.',
    'probe.noencoder': 'The audio track is {codec}: the player can decode it, but this browser has no encoder to play the result with. The picture would play, the sound would not.',
    'probe.remux': 'MKV: {video} + {audio} — the content suits the browser, but the container is not unpacked.',
    'probe.unknowncodec': 'unknown',
    'probe.badge.silent': 'NO SOUND',
    'probe.badge.none': 'NOT SUPPORTED',
    'remux.noaudio': 'The audio track could not be decoded, so the picture plays without sound.',
    'remux.audiostopped': 'Audio decoding stopped; the picture continues without sound.',
    'remux.truncated': 'The file is incomplete on the server: there is intact picture up to {time}.',
    'remux.nocues': 'This file has no seek table: seeking downloads the file up to that point, which takes a while.',

    /* ------------------------------------------------------------- time */
    'day.today': 'Today',
    'day.yesterday': 'Yesterday',
    'day.earlier': 'Earlier',
    'day.short.today': 'today',
    'day.short.tomorrow': 'tomorrow',
    'day.short.yesterday': 'yesterday',
    'size.kb': '{n} kB',
    'size.mb': '{n} MB',
    'duration.hm': '{h} h {m} min',
    'duration.h': '{h} h',
    'duration.m': '{m} min',
  },

  fi: {
    /* ------------------------------------------------------------ top bar */
    'tab.live': 'Kanavat',
    'tab.movie': 'Elokuvat',
    'tab.series': 'Sarjat',
    'tab.fav': 'Suosikit',
    'tab.recent': 'Historia',
    'search.placeholder': 'Hae nimellä…',
    'btn.guide': 'Opas',
    'btn.guide.title': 'Ohjelmaopas ja catchup  ( g )',
    'btn.refresh': 'Päivitä',
    'btn.refresh.title': 'Hae listat uudelleen palvelimelta',
    'btn.settings': 'Asetukset',
    'account.expiring': 'Voimassa {date} asti — {days} pv jäljellä',
    'account.valid': 'Voimassa {date} asti',

    /* ---------------------------------------------------------- sidebar */
    'groups.filter.placeholder': 'Suodata maat ja aiheet…',
    'groups.all': 'Kaikki',
    'groups.all.title': 'Lataa koko listan palvelimelta',
    'kind.c': 'Kategoriat',
    'kind.0': 'Kanavat',
    'kind.1': 'Elokuvat',
    'kind.2': 'Sarjat',

    /* ------------------------------------------------------------- list */
    'subcats.all': 'Kaikki',
    'subcats.general': 'Yleiset',
    'subcats.resize.title': 'Vedä aihepalkin korkeus haluamaksesi, kaksoisnapsautus palauttaa oletuksen',
    'crumbs.back': '← Takaisin',
    'list.topics': '{n} aihetta',
    'list.partial': 'koko listaa ei ladattu',
    'list.items.one': '{n} kohde',
    'list.items.other': '{n} kohdetta',
    'list.episodes.one': '{n} jakso',
    'list.episodes.other': '{n} jaksoa',
    'unit.live.one': '{n} kanava',
    'unit.live.other': '{n} kanavaa',
    'unit.movie.one': '{n} elokuva',
    'unit.movie.other': '{n} elokuvaa',
    'unit.series.one': '{n} sarja',
    'unit.series.other': '{n} sarjaa',
    'unit.generic.one': '{n} kohde',
    'unit.generic.other': '{n} kohdetta',
    'season': 'Kausi {season}',
    'history.clear': 'Tyhjennä historia',
    'history.clear.confirm': 'Varmista tyhjennys',
    'history.cleared': 'Historia tyhjennetty',

    /* ------------------------------------------------------------- rows */
    'row.fav.add': 'Lisää suosikkeihin',
    'row.fav.remove': 'Poista suosikeista',
    'row.remove.history': 'Poista historiasta',
    'row.watched': 'Katsottu {stamp}',
    'row.archive': '{days} vrk',
    'row.archive.title': 'Catchup: ohjelmat {days} vuorokauden ajalta',
    'row.ext.warn': 'Pääte ei lupaa toistoa selaimessa — tarkka syy selviää toistoa yritettäessä',
    'row.cat.count.title': 'Kategorian koko viime latauksen mukaan',
    'row.cat.subtitle': '{kind} · {where}',

    /* ------------------------------------------------------ empty states */
    'empty.browse': 'Selaa kanavia',
    'empty.nohits': 'Ei osumia',
    'empty.nohits.text': 'Hakusana “{query}” ei tuottanut tuloksia.',
    'empty.category': 'Kategoria on tyhjä',
    'empty.category.text': 'Palveluntarjoaja ei palauta tälle kategorialle sisältöä juuri nyt. Kategoria voi olla poistettu tai tyhjennetty listalta.',
    'empty.fav': 'Ei suosikkeja',
    'empty.fav.text': 'Tähti rivin alussa tai soittimen vieressä poimii kanavan, elokuvan tai jakson tänne. Tähti sivupalkin maan tai tarkennesirun kohdalla poimii koko kategorian. Suosikit löytyvät ilman että mitään listaa tarvitsee ladata.',
    'empty.recent': 'Historia on tyhjä',
    'empty.recent.text': 'Katsotut kanavat, elokuvat ja jaksot kertyvät tänne itsestään, tuorein ensin.',
    'empty.plain': 'Tyhjä kategoria',
    'list.aria': 'Sisältö',
    'groups.aria': 'Maat ja aiheet',
    'guide.aria': 'Ohjelmaopas',
    'error.list': 'Listaa ei saatu ladattua',
    'empty.plain.text': 'Kategoriassa ei ole sisältöä.',

    /* --------------------------------------------------------- loading */
    'progress.loading': 'Ladataan…',
    'progress.connecting': 'Yhdistetään…',
    'progress.list': 'Ladataan {what}…',
    'progress.list.live': 'kanavalistaa',
    'progress.list.movie': 'elokuvalistaa',
    'progress.list.series': 'sarjalistaa',
    'progress.reason.search': 'Haku tarvitsee koko listan',
    'progress.reason.all': '”Kaikki” tarvitsee koko listan',
    'progress.group': 'Ladataan: {group}',
    'progress.categories': '{done} / {total} kategoriaa',
    'progress.bytes': '{received} / {total}',
    'progress.received': '{received} ladattu',
    'progress.refresh': 'Päivitetään listat…',
    'progress.cancelled': 'Peruttu.',
    'error.connect.cancelled': 'Yhdistäminen peruttiin. Yritä uudelleen tai tarkista asetukset.',
    'toast.refreshed': 'Listat päivitetty',

    /* ------------------------------------------------------ connection */
    'error.connect.title': 'Yhteys epäonnistui',
    'error.unexpected': 'Odottamaton virhe: {message}',
    'error.grant': 'Salli pääsy: {origin}',
    'error.grant.denied': 'Selain ei myöntänyt oikeutta',
    'error.noserver': 'Ei yhteyttä palvelimeen',
    'api.unreachable': 'Palvelimeen ei saatu yhteyttä ({message}).',
    'api.rejected': 'Palvelin hylkäsi tunnukset.',
    'api.status': 'Palvelin vastasi {status} {statusText}.',
    'api.notxtream': 'Tämä osoite ei vastaa Xtream Codes -palvelimena. Tarkista palvelin ja portti.',
    'api.authfailed': 'Tunnistus epäonnistui.',
    'api.nocategories': 'Kategorialista puuttui.',
    'api.nostreams': 'Striimilista puuttui.',
    'api.badjson': 'Vastaus ei ollut kelvollista JSONia.',
    'api.timeout': 'Palvelin ei vastannut {seconds} sekunnissa.',
    'api.episode': 'Jakso {number}',

    /* ---------------------------------------------------------- player */
    'player.idle': 'Ei toistoa',
    'player.idle.text': 'Valitse kanava listalta.',
    'player.disconnected': 'Ei yhteyttä',
    'player.mode.title': 'Toistotapa',
    'player.subs.title': 'Tekstitys',
    'player.subs.off': 'Ei tekstitystä',
    'player.fullscreen.title': 'Koko näyttö',
    'player.reload.title': 'Lataa virta uudelleen',
    'player.pip.title': 'Kuva kuvassa',
    'player.pip.unavailable': 'PiP ei käytettävissä',
    'player.copy.title': 'Kopioi suoratoisto-osoite',
    'player.copied': 'Osoite kopioitu leikepöydälle',
    'player.dropped': 'Yhteys katkesi',
    'player.retrying': 'yritetään uudelleen ({attempt}/{max})…',
    'player.probing': 'Tutkitaan tiedostoa',
    'player.probing.text': 'Luetaan otsikko palvelimelta…',
    'player.waiting': 'Toisto odottaa',
    'player.failed': 'Toisto epäonnistui',
    'player.retry': 'Yritä uudelleen',
    'player.copyurl': 'Kopioi osoite',
    'player.silent': 'Toista ilman ääntä',
    'player.nourl': 'Kohteelle ei löytynyt toisto-osoitetta',
    'player.catchup': 'Catchup {time}',
    'player.title': '{name} — Kepuli-TV',
    'playback.startfailed': 'Toiston aloitus epäonnistui.',
    'playback.hint.copy': '{reason} Kopioi osoite URL-painikkeella ja avaa se esimerkiksi VLC:ssä.',
    'playback.nosource': 'Toisto ei onnistunut. Lähde ei vastannut tai muoto ei ole tuettu.',
    'playback.autoplay': 'Selain esti automaattisen toiston — paina play.',
    'playback.gaveup': 'Virta katkesi ({reason}) eikä palautunut {max} yrityksellä. ',
    'playback.gaveup.hint': 'Kokeile uudelleen tai vaihda toistotapaa.',
    'playback.reason.ended': 'lähde päättyi',
    'playback.reason.buffer': 'puskuri tyhjeni',
    'playback.reason.frozen': 'kuva pysähtyi',
    'playback.reason.media': 'mediavirhe {code}',
    'playback.reason.demux': 'purku epäonnistui',
    'playback.reason.network': 'yhteys katkesi',
    'playback.died': 'Toisto pysähtyi: {reason}.',
    'engine.native': 'natiivi',
    'engine.remux': 'MKV-purku',

    /* ---------------------------------------------------------- detail */
    'info.next': 'Seuraavaksi {time} · {title}',
    'info.unsupported': ' (ei tuettu)',
    'info.subs.one': '{n} tekstitys: {languages}',
    'info.subs.other': '{n} tekstitystä: {languages}',
    'info.subs.count.one': '{n} tekstitys',
    'info.subs.count.other': '{n} tekstitystä',
    'info.subs.none': 'Ei tekstityksiä',
    'subs.unknown': 'Tuntematon kieli',
    'subs.forced': 'pakotettu',
    'audio.unknown': 'Tuntematon kieli',
    'audio.commentary': 'kommenttiraita',
    'audio.described': 'kuvailutulkkaus',
    'audio.channels': '{n} kanavaa',

    /* ----------------------------------------------------------- guide */
    'guide.needserver': 'Yhdistä ensin palvelimeen',
    'guide.epgoff': 'Ohjelmatiedot on kytketty pois asetuksista',
    'guide.needgroup': 'Valitse ensin kanavaryhmä',
    'guide.allchannels': 'Kaikki kanavat',
    'guide.group.title': 'Kanavaryhmä',
    'guide.prev.title': 'Puoli tuntia taaksepäin',
    'guide.now': 'Nyt',
    'guide.now.title': 'Palaa nykyhetkeen',
    'guide.next.title': 'Puoli tuntia eteenpäin',
    'guide.out.title': 'Näytä pidempi jakso',
    'guide.in.title': 'Näytä lyhyempi jakso',
    'guide.close': 'Sulje',
    'guide.loading': 'Ladataan…',
    'guide.noepg': 'Ei ohjelmatietoja',
    'guide.noepg.channel': 'Kanavalle ei ole ohjelmatietoja.',
    'guide.watch': 'Katso kanavaa',
    'guide.watch.recording': 'Katso tallenne',
    'guide.norecording': 'Ohjelmasta ei ole tallennetta — kanava käynnistyy suorana painikkeesta',
    'guide.starts': '{title} alkaa klo {time}',
    'guide.startsin': 'alkaa {when}',
    'guide.minutes': '{minutes} min kuluttua',
    'guide.at': 'klo {time}',
    'guide.ended': 'päättynyt',
    'guide.catchup': 'Catchup {days} vrk',
    'guide.catchup.title': 'Catchup {days} vuorokauden ajalta',

    /* ------------------------------------------------------ favourites */
    'fav.button.title': 'Lisää suosikkeihin',

    /* ------------------------------------------------- external player */
    'ext.label': 'VLC tai muu .m3u:n oletussoitin',
    'ext.title': 'Avaa ulkoisessa soittimessa',
    'ext.nothing': 'Ei toistoa, jonka voisi luovuttaa',
    'ext.handed': 'Luovutettu ulkoiselle soittimelle',
    'ext.handed.text': 'Soittolista ladattiin — avaa se selaimen latauksista.',
    'ext.continue': 'Jatka selaimessa',

    /* ------------------------------------------------------- Chromecast */
    'cast.title': 'Lähetä Chromecastiin',
    'cast.nothing': 'Ei toistoa, jonka voisi lähettää',
    'cast.loading': 'Odota, että toisto alkaa',
    'cast.nodevice': 'Verkosta ei löytynyt Chromecastia',
    'cast.playing': 'Chromecast',
    'cast.tab': 'Lähetä välilehti Chromen valikosta',
    'cast.tab.text': 'Tämä virta kulkee MediaSourcen kautta, jota Remote Playback -rajapinta ei ota vastaan. Valitse Chromen valikosta Suoratoista\u2026 ja lähetä tämä välilehti, paina sitten f: kokoruudussa Chrome lähettää kuvan sellaisenaan ilman uudelleenkoodausta.',
    'cast.fullscreen': 'Kokoruutu',
    'cast.close': 'Sulje',

    /* --------------------------------------------------------- settings */
    'setup.title': 'Asetukset',
    'setup.welcome': 'Tervetuloa',
    'setup.welcome.text': 'Anna tietosi, niin kanavat ilmestyvät listaan.',
    'setup.source': 'Yhteystapa',
    'setup.source.xtream': 'Xtream Codes',
    'setup.source.m3u': 'M3U-osoite',
    'setup.scheme': 'Protokolla',
    'setup.security': 'Käytä HTTPS-yhteyttä, jos palveluntarjoajasi tukee sitä. HTTP-yhteydellä käyttäjätunnuksesi, salasanasi ja katselupyyntösi kulkevat salaamattomina, ja muut verkossa voivat lukea tai muuttaa niitä.',
    'setup.host': 'Palvelin',
    'setup.port': 'Portti',
    'setup.username': 'Käyttäjätunnus',
    'setup.password': 'Salasana',
    'setup.m3u.label': 'Kanavalistan osoite',
    'setup.m3u.bad': 'Osoitteessa ei ole käyttäjätunnusta ja salasanaa',
    'setup.m3u.ok': 'Osoite luettu',
    'setup.language': 'Kieli',
    'setup.subs': 'Tekstitys',
    'setup.subs.style': 'Tyyli',
    'setup.subs.size': 'Koko',
    'setup.subs.sample': 'Tältä tekstitys näyttää,\nkahdella rivilläkin.',
    'subs.style.shadow': 'Varjo',
    'subs.style.outline': 'Ääriviiva',
    'subs.style.yellow': 'Keltainen',
    'subs.style.box': 'Laatikko',
    'subs.style.contrast': 'Vahva kontrasti',
    'setup.epg': 'Hae ohjelmatiedot automaattisesti',
    'setup.resume': 'Muista elokuvien ja jaksojen katselukohta',
    'setup.clear': 'Tyhjennä välimuisti',
    'setup.clear.title': 'Poistaa ladatut listat ja ohjelmatiedot. Tunnukset ja suosikit säilyvät.',
    'setup.cleared': 'Välimuisti tyhjennetty',
    'setup.reset': 'Palauta alkutilaan',
    'setup.reset.title': 'Poistaa tunnukset, suosikit, historian, katselukohdat ja välimuistin',
    'setup.reset.confirm': 'Varmista: poista kaikki',
    'setup.reset.failed': 'Palautus epäonnistui',
    'setup.cancel': 'Peruuta',
    'setup.close': 'Sulje',
    'setup.save': 'Yhdistä',
    'setup.nogrant': 'Ilman oikeutta palvelimeen yhteys ei onnistu',
    'account.title': 'Tili:',
    'account.trial': ' (kokeilu)',
    'account.connections.label': 'Yhtäaikaiset yhteydet',
    'account.valid.label': 'Voimassa',
    'account.formats': 'Muodot',
    'account.servertime': 'Palvelimen aika',
    'account.cache': 'Välimuisti',
    'account.lists': 'Ladatut listat',
    'account.none': 'ei yhtään',

    /* ------------------------------------------------------------ file */
    'probe.unread': 'Otsikkoa ei saatu luettua: {error}',
    'probe.untested': 'Tiedostoa ei ole tutkittu.',
    'probe.mp4': 'MP4 — selaimen oma toistin.',
    'probe.mpegts': 'MPEG-TS — mpegts.js.',
    'probe.container': 'Konttia {container} ei tueta selaimessa.',
    'probe.truncated': 'Raitatiedot eivät mahtuneet otsikkoon.',
    'probe.video': 'Videokoodekkia {codec} ei voi purkaa tässä selaimessa.',
    'probe.noaudio': 'Tiedostossa ei ole ääniraitaa.',
    'probe.decoded': 'MKV: {video} + {audio} — ääni puretaan soittimessa.',
    'probe.silent': 'Ääniraita on {codec}, jota selain ei pura. Kuva toistuisi, ääni ei.',
    'probe.noencoder': 'Ääniraita on {codec}: soitin osaisi purkaa sen, mutta tässä selaimessa ei ole enkooderia, jolla tulos toistettaisiin. Kuva toistuisi, ääni ei.',
    'probe.remux': 'MKV: {video} + {audio} — sisältö kelpaa selaimelle, mutta kontin purku puuttuu.',
    'probe.unknowncodec': 'tuntematon',
    'probe.badge.silent': 'EI ÄÄNTÄ',
    'probe.badge.none': 'EI TUETTU',
    'remux.noaudio': 'Ääniraitaa ei saatu purettua, joten kuva toistuu ilman ääntä.',
    'remux.audiostopped': 'Äänen purku keskeytyi; kuva jatkuu ilman ääntä.',
    'remux.truncated': 'Tiedosto on vaillinainen palvelimella: ehjää kuvaa on {time} asti.',
    'remux.nocues': 'Tiedostossa ei ole hakutaulua: kelaus lataa tiedoston siihen kohtaan asti, ja se kestää hetken.',

    /* ------------------------------------------------------------- time */
    'day.today': 'Tänään',
    'day.yesterday': 'Eilen',
    'day.earlier': 'Aiemmin',
    'day.short.today': 'tänään',
    'day.short.tomorrow': 'huomenna',
    'day.short.yesterday': 'eilen',
    'size.kb': '{n} kt',
    'size.mb': '{n} Mt',
    'duration.hm': '{h} h {m} min',
    'duration.h': '{h} h',
    'duration.m': '{m} min',
  },
};

let current = DEFAULT_LANGUAGE;

export function setLanguage(lang) {
  current = STRINGS[lang] ? lang : DEFAULT_LANGUAGE;
  document.documentElement.lang = current;
  return current;
}

export function language() { return current; }
export function localeTag() { return LOCALE_TAG[current] || LOCALE_TAG[DEFAULT_LANGUAGE]; }

/**
 * The translation for a key.
 *
 * The plural is chosen by params.count when the key has .one/.other pairs:
 * t('unit.live', { count: 1 }) → "1 channel". Finnish and English share the
 * same plural rule here (1 vs. anything else), so the language does not
 * have to be consulted separately.
 */
export function t(key, params) {
  const dict = STRINGS[current];
  let resolved = key;
  if (params && typeof params.count === 'number') {
    const plural = `${key}.${params.count === 1 ? 'one' : 'other'}`;
    if (dict[plural] || STRINGS[DEFAULT_LANGUAGE][plural]) resolved = plural;
  }
  const text = dict[resolved] ?? STRINGS[DEFAULT_LANGUAGE][resolved];
  if (text == null) return key;
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name) => (params[name] != null ? String(params[name]) : whole));
}

/**
 * The static texts from the HTML. Called once at start-up and again when
 * the language changes — dynamic views take care of themselves by
 * repainting, but nothing else touches text written into the markup.
 */
export function applyStatic(root = document) {
  for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
  for (const node of root.querySelectorAll('[data-i18n-title]')) {
    node.title = t(node.dataset.i18nTitle);
    // A button that shows a symbol rather than a word — ↻, ↗, ☆ — has no
    // name a screen reader could say; the title is that name.
    if (node.tagName === 'BUTTON' && !/\p{L}/u.test(node.textContent)) node.setAttribute('aria-label', node.title);
  }
  for (const node of root.querySelectorAll('[data-i18n-placeholder]')) node.placeholder = t(node.dataset.i18nPlaceholder);
  for (const node of root.querySelectorAll('[data-i18n-label]')) node.setAttribute('aria-label', t(node.dataset.i18nLabel));
}
