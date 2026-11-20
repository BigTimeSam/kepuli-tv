// @ts-check
// A title's genres in the viewer's language.
//
// A provider says a genre as text, commonly TMDb's names for it: "Drama",
// "Sci-Fi & Fantasy", "Action & Adventure". Most say them in English
// whatever the viewer's language, and some lists mix several (one
// provider's 13,000 series, 2026-11-20: 83 names, the English ones and
// the same in French, Danish, Swedish, Spanish, Portuguese, Dutch and
// Arabic). The interface read "Lajityyppi: Kids".
//
// The vocabulary is here whole, every language at once, and not among
// the interface's strings (js/locales): a name is recognised in whichever
// of the languages it was written, which takes all of them in memory, and
// a locale file is loaded for the one language in use. A name that is not
// in it is shown as the provider wrote it.

import { language } from './i18n.js';

// The order of every row of NAMES.
const KEYS = ['action', 'adventure', 'actionadventure', 'animation', 'comedy', 'crime', 'documentary', 'drama', 'family', 'fantasy',
  'history', 'horror', 'kids', 'music', 'mystery', 'news', 'reality', 'romance', 'scifi', 'scififantasy',
  'soap', 'talk', 'thriller', 'tvmovie', 'war', 'warpolitics', 'western', 'biography', 'sport', 'musical'];

/** @type {Record<string, string>} each language's names, in the order of KEYS, set apart by "|" */
const NAMES = {
  en: 'Action|Adventure|Action & Adventure|Animation|Comedy|Crime|Documentary|Drama|Family|Fantasy|History|Horror|Kids|Music|Mystery|News|Reality|Romance|Science Fiction|Sci-Fi & Fantasy|Soap|Talk|Thriller|TV Movie|War|War & Politics|Western|Biography|Sport|Musical',
  fi: 'Toiminta|Seikkailu|Toiminta ja seikkailu|Animaatio|Komedia|Rikos|Dokumentti|Draama|Perhe|Fantasia|Historia|Kauhu|Lapset|Musiikki|Mysteeri|Uutiset|Tosi-tv|Romantiikka|Scifi|Scifi ja fantasia|Saippuasarja|Keskustelu|Jännitys|TV-elokuva|Sota|Sota ja politiikka|Western|Elämäkerta|Urheilu|Musikaali',
  sv: 'Action|Äventyr|Action & äventyr|Animerat|Komedi|Kriminal|Dokumentär|Drama|Familj|Fantasy|Historia|Skräck|Barn|Musik|Mysterium|Nyheter|Reality|Romantik|Science fiction|Sci-fi & fantasy|Såpa|Talkshow|Thriller|TV-film|Krig|Krig & politik|Western|Biografi|Sport|Musikal',
  nb: 'Action|Eventyr|Action og eventyr|Animasjon|Komedie|Krim|Dokumentar|Drama|Familie|Fantasy|Historie|Skrekk|Barn|Musikk|Mysterium|Nyheter|Reality|Romantikk|Science fiction|Sci-fi og fantasy|Såpe|Talkshow|Thriller|TV-film|Krig|Krig og politikk|Western|Biografi|Sport|Musikal',
  da: 'Action|Eventyr|Action og eventyr|Animation|Komedie|Krimi|Dokumentar|Drama|Familie|Fantasy|Historie|Gyser|Børn|Musik|Mysterie|Nyheder|Reality|Romantik|Science fiction|Sci-fi og fantasy|Sæbeopera|Talkshow|Thriller|TV-film|Krig|Krig og politik|Western|Biografi|Sport|Musical',
  de: 'Action|Abenteuer|Action & Abenteuer|Animation|Komödie|Krimi|Dokumentation|Drama|Familie|Fantasy|Historie|Horror|Kinder|Musik|Mystery|Nachrichten|Reality|Romantik|Science-Fiction|Sci-Fi & Fantasy|Seifenoper|Talkshow|Thriller|TV-Film|Krieg|Krieg & Politik|Western|Biografie|Sport|Musical',
  nl: 'Actie|Avontuur|Actie & avontuur|Animatie|Komedie|Misdaad|Documentaire|Drama|Familie|Fantasy|Geschiedenis|Horror|Kinderen|Muziek|Mysterie|Nieuws|Reality|Romantiek|Sciencefiction|Sci-fi & fantasy|Soap|Talkshow|Thriller|Tv-film|Oorlog|Oorlog & politiek|Western|Biografie|Sport|Musical',
  fr: 'Action|Aventure|Action & aventure|Animation|Comédie|Crime|Documentaire|Drame|Familial|Fantastique|Histoire|Horreur|Enfants|Musique|Mystère|Actualités|Téléréalité|Romance|Science-fiction|Science-fiction & fantastique|Feuilleton|Talk-show|Thriller|Téléfilm|Guerre|Guerre & politique|Western|Biographie|Sport|Comédie musicale',
  es: 'Acción|Aventura|Acción y aventura|Animación|Comedia|Crimen|Documental|Drama|Familia|Fantasía|Historia|Terror|Infantil|Música|Misterio|Noticias|Telerrealidad|Romance|Ciencia ficción|Ciencia ficción y fantasía|Telenovela|Entrevistas|Suspense|Película de TV|Bélica|Guerra y política|Western|Biografía|Deporte|Musical',
  pt: 'Ação|Aventura|Ação e aventura|Animação|Comédia|Crime|Documentário|Drama|Família|Fantasia|História|Terror|Infantil|Música|Mistério|Notícias|Reality|Romance|Ficção científica|Ficção científica e fantasia|Novela|Talk show|Thriller|Filme para TV|Guerra|Guerra e política|Faroeste|Biografia|Esporte|Musical',
  it: 'Azione|Avventura|Azione e avventura|Animazione|Commedia|Crime|Documentario|Dramma|Famiglia|Fantasy|Storia|Horror|Bambini|Musica|Mistero|Notizie|Reality|Romantico|Fantascienza|Fantascienza e fantasy|Soap opera|Talk show|Thriller|Film TV|Guerra|Guerra e politica|Western|Biografico|Sport|Musical',
  pl: 'Akcja|Przygodowy|Akcja i przygoda|Animacja|Komedia|Kryminał|Dokumentalny|Dramat|Familijny|Fantasy|Historyczny|Horror|Dla dzieci|Muzyczny|Tajemnica|Wiadomości|Reality show|Romans|Science fiction|Sci-fi i fantasy|Opera mydlana|Talk-show|Thriller|Film telewizyjny|Wojenny|Wojna i polityka|Western|Biograficzny|Sport|Musical',
  tr: 'Aksiyon|Macera|Aksiyon ve macera|Animasyon|Komedi|Suç|Belgesel|Dram|Aile|Fantastik|Tarih|Korku|Çocuk|Müzik|Gizem|Haber|Reality|Romantik|Bilim kurgu|Bilim kurgu ve fantastik|Pembe dizi|Talk show|Gerilim|TV filmi|Savaş|Savaş ve politika|Western|Biyografi|Spor|Müzikal',
  cs: 'Akční|Dobrodružný|Akční a dobrodružný|Animovaný|Komedie|Krimi|Dokumentární|Drama|Rodinný|Fantasy|Historický|Horor|Dětský|Hudební|Mysteriózní|Zprávy|Reality show|Romantický|Sci-fi|Sci-fi a fantasy|Telenovela|Talk show|Thriller|Televizní film|Válečný|Válka a politika|Western|Životopisný|Sport|Muzikál',
  hu: 'Akció|Kaland|Akció és kaland|Animáció|Vígjáték|Bűnügyi|Dokumentum|Dráma|Családi|Fantasy|Történelmi|Horror|Gyerek|Zene|Rejtély|Hírek|Valóságshow|Romantikus|Sci-fi|Sci-fi és fantasy|Szappanopera|Talkshow|Thriller|Tévéfilm|Háborús|Háború és politika|Western|Életrajzi|Sport|Musical',
  ro: 'Acțiune|Aventură|Acțiune și aventură|Animație|Comedie|Crimă|Documentar|Dramă|Familie|Fantasy|Istorie|Horror|Copii|Muzică|Mister|Știri|Reality|Romantic|Science fiction|SF și fantasy|Telenovelă|Talk-show|Thriller|Film TV|Război|Război și politică|Western|Biografic|Sport|Musical',
  hr: 'Akcija|Avantura|Akcija i avantura|Animacija|Komedija|Krimi|Dokumentarni|Drama|Obiteljski|Fantazija|Povijesni|Horor|Dječji|Glazba|Misterija|Vijesti|Reality|Romantika|Znanstvena fantastika|Znanstvena fantastika i fantazija|Sapunica|Talk show|Triler|TV film|Ratni|Rat i politika|Vestern|Biografski|Sport|Mjuzikl',
  sq: 'Aksion|Aventurë|Aksion dhe aventurë|Animacion|Komedi|Krim|Dokumentar|Dramë|Familjar|Fantazi|Histori|Horror|Fëmijë|Muzikë|Mister|Lajme|Reality|Romancë|Fantashkencë|Fantashkencë dhe fantazi|Telenovelë|Talk show|Thriller|Film televiziv|Luftë|Luftë dhe politikë|Western|Biografi|Sport|Muzikal',
  el: 'Δράση|Περιπέτεια|Δράση & περιπέτεια|Κινούμενα σχέδια|Κωμωδία|Έγκλημα|Ντοκιμαντέρ|Δράμα|Οικογενειακή|Φαντασίας|Ιστορία|Τρόμου|Παιδικά|Μουσική|Μυστηρίου|Ειδήσεις|Ριάλιτι|Ρομαντική|Επιστημονική φαντασία|Επιστημονική φαντασία & φαντασίας|Σαπουνόπερα|Τοκ σόου|Θρίλερ|Τηλεταινία|Πολεμική|Πόλεμος & πολιτική|Γουέστερν|Βιογραφία|Αθλητικά|Μιούζικαλ',
  ru: 'Боевик|Приключения|Боевик и приключения|Мультфильм|Комедия|Криминал|Документальный|Драма|Семейный|Фэнтези|История|Ужасы|Детский|Музыка|Детектив|Новости|Реалити-шоу|Мелодрама|Фантастика|Фантастика и фэнтези|Мыльная опера|Ток-шоу|Триллер|Телефильм|Военный|Война и политика|Вестерн|Биография|Спорт|Мюзикл',
  uk: 'Бойовик|Пригоди|Бойовик і пригоди|Мультфільм|Комедія|Кримінал|Документальний|Драма|Сімейний|Фентезі|Історія|Жахи|Дитячий|Музика|Детектив|Новини|Реаліті-шоу|Мелодрама|Фантастика|Фантастика і фентезі|Мильна опера|Ток-шоу|Трилер|Телефільм|Військовий|Війна і політика|Вестерн|Біографія|Спорт|Мюзикл',
  bg: 'Екшън|Приключения|Екшън и приключения|Анимация|Комедия|Криминален|Документален|Драма|Семеен|Фентъзи|История|Ужаси|Детски|Музика|Мистерия|Новини|Риалити|Романтика|Научна фантастика|Научна фантастика и фентъзи|Сапунена опера|Токшоу|Трилър|Телевизионен филм|Военен|Война и политика|Уестърн|Биография|Спорт|Мюзикъл',
  sk: 'Akčný|Dobrodružný|Akčný a dobrodružný|Animovaný|Komédia|Krimi|Dokumentárny|Dráma|Rodinný|Fantasy|Historický|Horor|Detský|Hudobný|Mysteriózny|Správy|Reality šou|Romantický|Sci-fi|Sci-fi a fantasy|Telenovela|Talkšou|Thriller|Televízny film|Vojnový|Vojna a politika|Western|Životopisný|Šport|Muzikál',
  sl: 'Akcija|Pustolovščina|Akcija in pustolovščina|Animacija|Komedija|Kriminalka|Dokumentarni|Drama|Družinski|Fantazija|Zgodovinski|Grozljivka|Otroški|Glasba|Misterij|Novice|Resničnostni šov|Romantika|Znanstvena fantastika|Znanstvena fantastika in fantazija|Telenovela|Pogovorna oddaja|Triler|TV-film|Vojni|Vojna in politika|Vestern|Biografski|Šport|Muzikal',
  sr: 'Akcija|Avantura|Akcija i avantura|Animacija|Komedija|Krimi|Dokumentarni|Drama|Porodični|Fantazija|Istorijski|Horor|Dečji|Muzika|Misterija|Vesti|Rijaliti|Romantika|Naučna fantastika|Naučna fantastika i fantazija|Sapunica|Tok šou|Triler|TV film|Ratni|Rat i politika|Vestern|Biografski|Sport|Mjuzikl',
  lt: 'Veiksmo|Nuotykių|Veiksmo ir nuotykių|Animacija|Komedija|Kriminalinis|Dokumentinis|Drama|Šeimai|Fantastinis|Istorinis|Siaubo|Vaikams|Muzika|Mistinis|Žinios|Realybės šou|Romantinis|Mokslinė fantastika|Mokslinė fantastika ir fantazija|Muilo opera|Pokalbių šou|Trileris|TV filmas|Karinis|Karas ir politika|Vesternas|Biografinis|Sportas|Miuziklas',
  lv: 'Asa sižeta|Piedzīvojumu|Asa sižeta un piedzīvojumu|Animācija|Komēdija|Kriminālais|Dokumentālais|Drāma|Ģimenes|Fantāzija|Vēsture|Šausmu|Bērnu|Mūzika|Mistērija|Ziņas|Realitātes šovs|Romantika|Zinātniskā fantastika|Zinātniskā fantastika un fantāzija|Ziepju opera|Sarunu šovs|Trilleris|TV filma|Kara|Karš un politika|Vesterns|Biogrāfija|Sports|Mūzikls',
  et: 'Märul|Seiklus|Märul ja seiklus|Animatsioon|Komöödia|Krimi|Dokumentaal|Draama|Pere|Fantaasia|Ajalugu|Õudus|Lapsed|Muusika|Müsteerium|Uudised|Tõsielu|Romantika|Ulme|Ulme ja fantaasia|Seebiooper|Vestlussaade|Põnevik|Telefilm|Sõda|Sõda ja poliitika|Vestern|Elulugu|Sport|Muusikal',
  id: 'Aksi|Petualangan|Aksi & petualangan|Animasi|Komedi|Kriminal|Dokumenter|Drama|Keluarga|Fantasi|Sejarah|Horor|Anak-anak|Musik|Misteri|Berita|Realitas|Romantis|Fiksi ilmiah|Fiksi ilmiah & fantasi|Sinetron|Bincang-bincang|Thriller|Film TV|Perang|Perang & politik|Western|Biografi|Olahraga|Musikal',
  vi: 'Hành động|Phiêu lưu|Hành động & phiêu lưu|Hoạt hình|Hài|Hình sự|Tài liệu|Chính kịch|Gia đình|Giả tưởng|Lịch sử|Kinh dị|Thiếu nhi|Âm nhạc|Bí ẩn|Tin tức|Truyền hình thực tế|Lãng mạn|Khoa học viễn tưởng|Khoa học viễn tưởng & giả tưởng|Phim dài tập|Trò chuyện|Gây cấn|Phim truyền hình|Chiến tranh|Chiến tranh & chính trị|Viễn Tây|Tiểu sử|Thể thao|Nhạc kịch',
};

// Other ways the same genres are written: TMDb's own wording where it
// differs from a row above, short forms, plurals, and Arabic, which is
// not a language of the interface but is in providers' lists.
/** @type {Record<string, string>} */
const ALSO = {
  'sci-fi': 'scifi', 'sci fi': 'scifi', scifi: 'scifi', sf: 'scifi', 'science-fiction': 'scifi', 'science fiction': 'scifi',
  'sci-fi og fantasy': 'scififantasy', 'science-fiction & fantastique': 'scififantasy', 'sci-fi & fantasy': 'scififantasy',
  'reality-tv': 'reality', 'reality tv': 'reality', virkelighed: 'reality',
  'talk-show': 'talk', 'talk show': 'talk', snakke: 'talk',
  sæbe: 'soap', 'soap opera': 'soap',
  nyhed: 'news', mystik: 'mystery', kriminalitet: 'crime', policier: 'crime',
  children: 'kids', "children's": 'kids', enfant: 'kids',
  documentaries: 'documentary', biographical: 'biography', sports: 'sport', historical: 'history', animated: 'animation', romantic: 'romance',
  'tv movie': 'tvmovie', 'tv-movie': 'tvmovie',
  'دراما': 'drama', 'كوميديا': 'comedy', 'وثائقي': 'documentary', 'حركة ومغامرة': 'actionadventure', 'غموض': 'mystery', 'غربي': 'western',
  'رسوم متحركة': 'animation', 'أطفال': 'kids', 'عائلي': 'family', 'حرب وسياسة': 'warpolitics', 'أوبرا صابونية': 'soap', 'جريمة': 'crime',
};

const tidy = (/** @type {string} */ name) => name.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();

/** Every known way of writing a genre, to its place in KEYS. The first language to claim a word keeps it. */
const known = new Map();
for (const names of Object.values(NAMES)) {
  names.split('|').forEach((name, i) => { if (!known.has(tidy(name))) known.set(tidy(name), i); });
}
for (const [name, key] of Object.entries(ALSO)) if (!known.has(tidy(name))) known.set(tidy(name), KEYS.indexOf(key));

/**
 * One genre in the interface's language, or as it was written when it is
 * not one of the known.
 * @param {string} name
 * @param {string} [lang] the interface's language by default
 */
export function genreName(name, lang = language()) {
  const at = known.get(tidy(String(name || '')));
  const names = NAMES[lang] || NAMES.en;
  return at == null || at < 0 ? String(name || '').trim() : names.split('|')[at];
}

/**
 * A provider's list of genres ("Drama, Crime", "Action / Thriller") in
 * the interface's language, each once, set apart by commas.
 * @param {string} text
 * @param {string} [lang]
 */
export function genreNames(text, lang = language()) {
  const names = String(text || '').split(/\s*[,;|/]\s*/).map((name) => genreName(name, lang)).filter(Boolean);
  return [...new Set(names)].join(', ');
}

/** For the tests: how many genres, and whether every language names them all. */
export const GENRE_TABLE = { keys: KEYS, names: NAMES };
