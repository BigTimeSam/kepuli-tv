# Firefox Add-ons screenshots

Captured by `KEPULI_BROWSER=firefox node dev/store-screenshots.mjs` — the
same walk that makes the Chrome set, driven through Marionette instead of
DevTools — in Firefox 159 on macOS, using an isolated test profile and the
local `dev/mock/server.mjs` fixture. All channels, titles, artwork and video
are fictional demo content. No customer account or hosted demo service was
used.

The five views match the Chrome Web Store set in `brand/screenshots/`. Each
PNG is 1280 × 800 RGB. The Chrome set is captured at 2× and scaled down;
Firefox has no per-capture density — its own is a profile preference, and 2×
would need a 2560 × 1600 window — so this set is captured at 1×.

| File | AMO caption |
| --- | --- |
| 01-channels.png | Browse channels by country and topic while watching live TV. Shown with fictional demo content in Firefox. |
| 02-guide.png | Explore the programme guide while playback continues in the mini-player. Shown with fictional demo content in Firefox. |
| 03-series.png | Browse series details, seasons and episodes. Shown with fictional demo content in Firefox. |
| 04-subtitles.png | Play an MKV episode with text subtitles and choose their language and size. Shown with fictional demo content in Firefox. |
| 05-movie.png | Watch a movie with its description and details beside your catalogue, shown as covers. Shown with fictional demo content in Firefox. |

## The captions in the listing's other languages

AMO keeps a caption per screenshot per language. `node dev/amo-publish.mjs
captions` sends every table here — the English one as en-GB, each section
below as the code in its heading — wherever AMO's differ, and a release does
the same after the version. Each uses the form of address of that language's
store listing. AMO offers no Danish, Bulgarian, Estonian, Indonesian,
Lithuanian or Latvian: the sections in those are kept for the day it does
and are not sent; see "SETTING THE LANGUAGES ON ADDONS.MOZILLA.ORG" in
store/chrome-dashboard.txt.

### suomi (fi)

| File | Caption |
| --- | --- |
| 01-channels.png | Selaa kanavia maittain ja aiheittain samalla, kun katsot suoraa lähetystä. Kuvassa kuvitteellista demosisältöä Firefoxissa. |
| 02-guide.png | Tutki ohjelmaopasta, kun toisto jatkuu minisoittimessa. Kuvassa kuvitteellista demosisältöä Firefoxissa. |
| 03-series.png | Selaa sarjan tietoja, tuotantokausia ja jaksoja. Kuvassa kuvitteellista demosisältöä Firefoxissa. |
| 04-subtitles.png | Toista MKV-jakso tekstityksineen ja valitse tekstityksen kieli ja koko. Kuvassa kuvitteellista demosisältöä Firefoxissa. |
| 05-movie.png | Katso elokuvaa niin, että sen kuvaus ja tiedot ovat vieressä ja kokoelmasi kansikuvina. Kuvassa kuvitteellista demosisältöä Firefoxissa. |

### Svenska (sv-SE)

| File | Caption |
| --- | --- |
| 01-channels.png | Bläddra bland kanaler efter land och ämne medan du tittar på live-tv. Visas med påhittat demoinnehåll i Firefox. |
| 02-guide.png | Utforska programguiden medan uppspelningen fortsätter i minispelaren. Visas med påhittat demoinnehåll i Firefox. |
| 03-series.png | Bläddra bland seriens detaljer, säsonger och avsnitt. Visas med påhittat demoinnehåll i Firefox. |
| 04-subtitles.png | Spela upp ett MKV-avsnitt med undertexter och välj deras språk och storlek. Visas med påhittat demoinnehåll i Firefox. |
| 05-movie.png | Titta på en film med beskrivning och detaljer bredvid din katalog, visad som omslag. Visas med påhittat demoinnehåll i Firefox. |

### Norsk bokmål (nb-NO)

| File | Caption |
| --- | --- |
| 01-channels.png | Bla gjennom kanaler etter land og emne mens du ser direkte-TV. Vist med oppdiktet demoinnhold i Firefox. |
| 02-guide.png | Utforsk programguiden mens avspillingen fortsetter i minispilleren. Vist med oppdiktet demoinnhold i Firefox. |
| 03-series.png | Bla gjennom seriedetaljer, sesonger og episoder. Vist med oppdiktet demoinnhold i Firefox. |
| 04-subtitles.png | Spill av en MKV-episode med undertekster og velg språk og størrelse på dem. Vist med oppdiktet demoinnhold i Firefox. |
| 05-movie.png | Se en film med beskrivelse og detaljer ved siden av katalogen din, vist som omslag. Vist med oppdiktet demoinnhold i Firefox. |

### Deutsch (de)

| File | Caption |
| --- | --- |
| 01-channels.png | Durchstöbere Sender nach Land und Thema, während du Live-TV schaust. Gezeigt mit erfundenen Demo-Inhalten in Firefox. |
| 02-guide.png | Erkunde den Programmführer, während die Wiedergabe im Mini-Player weiterläuft. Gezeigt mit erfundenen Demo-Inhalten in Firefox. |
| 03-series.png | Durchstöbere Seriendetails, Staffeln und Folgen. Gezeigt mit erfundenen Demo-Inhalten in Firefox. |
| 04-subtitles.png | Spiele eine MKV-Folge mit Untertiteln ab und wähle deren Sprache und Größe. Gezeigt mit erfundenen Demo-Inhalten in Firefox. |
| 05-movie.png | Schau einen Film mit Beschreibung und Details neben deinem Katalog, als Cover dargestellt. Gezeigt mit erfundenen Demo-Inhalten in Firefox. |

### Nederlands (nl)

| File | Caption |
| --- | --- |
| 01-channels.png | Blader door zenders op land en onderwerp terwijl je live-tv kijkt. Getoond met verzonnen demo-inhoud in Firefox. |
| 02-guide.png | Verken de programmagids terwijl het afspelen doorgaat in de minispeler. Getoond met verzonnen demo-inhoud in Firefox. |
| 03-series.png | Bekijk de gegevens, seizoenen en afleveringen van een serie. Getoond met verzonnen demo-inhoud in Firefox. |
| 04-subtitles.png | Speel een MKV-aflevering af met ondertiteling en kies de taal en grootte ervan. Getoond met verzonnen demo-inhoud in Firefox. |
| 05-movie.png | Kijk een film met beschrijving en details naast je catalogus, weergegeven als covers. Getoond met verzonnen demo-inhoud in Firefox. |

### Français (fr)

| File | Caption |
| --- | --- |
| 01-channels.png | Parcours les chaînes par pays et par thème tout en regardant la télé en direct. Présenté avec du contenu de démonstration fictif dans Firefox. |
| 02-guide.png | Explore le guide des programmes pendant que la lecture continue dans le mini-lecteur. Présenté avec du contenu de démonstration fictif dans Firefox. |
| 03-series.png | Parcours les détails d’une série, ses saisons et ses épisodes. Présenté avec du contenu de démonstration fictif dans Firefox. |
| 04-subtitles.png | Lis un épisode MKV avec ses sous-titres et choisis leur langue et leur taille. Présenté avec du contenu de démonstration fictif dans Firefox. |
| 05-movie.png | Regarde un film avec son résumé et ses détails à côté de ton catalogue, affiché en jaquettes. Présenté avec du contenu de démonstration fictif dans Firefox. |

### Español de España (es-ES)

| File | Caption |
| --- | --- |
| 01-channels.png | Explora los canales por país y tema mientras ves la televisión en directo. Mostrado con contenido de demostración ficticio en Firefox. |
| 02-guide.png | Consulta la guía de programación mientras la reproducción continúa en el minirreproductor. Mostrado con contenido de demostración ficticio en Firefox. |
| 03-series.png | Explora los detalles de una serie, sus temporadas y sus episodios. Mostrado con contenido de demostración ficticio en Firefox. |
| 04-subtitles.png | Reproduce un episodio MKV con subtítulos y elige su idioma y su tamaño. Mostrado con contenido de demostración ficticio en Firefox. |
| 05-movie.png | Mira una película con su sinopsis y sus detalles junto a tu catálogo, mostrado en portadas. Mostrado con contenido de demostración ficticio en Firefox. |

### Português do Brasil (pt-BR)

| File | Caption |
| --- | --- |
| 01-channels.png | Navegue pelos canais por país e tema enquanto assiste à TV ao vivo. Exibido com conteúdo de demonstração fictício no Firefox. |
| 02-guide.png | Explore o guia de programação enquanto a reprodução continua no miniplayer. Exibido com conteúdo de demonstração fictício no Firefox. |
| 03-series.png | Veja os detalhes de uma série, suas temporadas e seus episódios. Exibido com conteúdo de demonstração fictício no Firefox. |
| 04-subtitles.png | Reproduza um episódio em MKV com legendas e escolha o idioma e o tamanho delas. Exibido com conteúdo de demonstração fictício no Firefox. |
| 05-movie.png | Assista a um filme com a sinopse e os detalhes ao lado do seu catálogo, exibido em capas. Exibido com conteúdo de demonstração fictício no Firefox. |

### Italiano (it)

| File | Caption |
| --- | --- |
| 01-channels.png | Sfoglia i canali per paese e argomento mentre guardi la TV in diretta. Mostrato con contenuti dimostrativi fittizi in Firefox. |
| 02-guide.png | Esplora la guida TV mentre la riproduzione continua nel mini player. Mostrato con contenuti dimostrativi fittizi in Firefox. |
| 03-series.png | Sfoglia i dettagli di una serie, le stagioni e gli episodi. Mostrato con contenuti dimostrativi fittizi in Firefox. |
| 04-subtitles.png | Riproduci un episodio MKV con i sottotitoli e scegline lingua e dimensione. Mostrato con contenuti dimostrativi fittizi in Firefox. |
| 05-movie.png | Guarda un film con trama e dettagli accanto al tuo catalogo, mostrato come copertine. Mostrato con contenuti dimostrativi fittizi in Firefox. |

### Polski (pl)

| File | Caption |
| --- | --- |
| 01-channels.png | Przeglądaj kanały według kraju i tematu, oglądając telewizję na żywo. Pokazano na fikcyjnych treściach demonstracyjnych w Firefoksie. |
| 02-guide.png | Przeglądaj przewodnik po programach, podczas gdy odtwarzanie trwa w miniodtwarzaczu. Pokazano na fikcyjnych treściach demonstracyjnych w Firefoksie. |
| 03-series.png | Przeglądaj szczegóły serialu, sezony i odcinki. Pokazano na fikcyjnych treściach demonstracyjnych w Firefoksie. |
| 04-subtitles.png | Odtwórz odcinek MKV z napisami i wybierz ich język oraz rozmiar. Pokazano na fikcyjnych treściach demonstracyjnych w Firefoksie. |
| 05-movie.png | Oglądaj film z opisem i szczegółami obok swojego katalogu wyświetlanego jako okładki. Pokazano na fikcyjnych treściach demonstracyjnych w Firefoksie. |

### Türkçe (tr)

| File | Caption |
| --- | --- |
| 01-channels.png | Canlı TV izlerken kanallara ülkeye ve konuya göre göz at. Firefox'ta kurgusal demo içerikle gösterilmektedir. |
| 02-guide.png | Oynatma mini oynatıcıda sürerken yayın akışını keşfet. Firefox'ta kurgusal demo içerikle gösterilmektedir. |
| 03-series.png | Bir dizinin ayrıntılarına, sezonlarına ve bölümlerine göz at. Firefox'ta kurgusal demo içerikle gösterilmektedir. |
| 04-subtitles.png | Bir MKV bölümünü altyazılarıyla oynat, altyazıların dilini ve boyutunu seç. Firefox'ta kurgusal demo içerikle gösterilmektedir. |
| 05-movie.png | Kapak görünümündeki kataloğunun yanında, açıklaması ve ayrıntılarıyla bir film izle. Firefox'ta kurgusal demo içerikle gösterilmektedir. |

### Português Europeu (pt-PT)

| File | Caption |
| --- | --- |
| 01-channels.png | Percorre os canais por país e tema enquanto vês televisão em direto. Apresentado com conteúdo de demonstração fictício no Firefox. |
| 02-guide.png | Explora o guia de programação enquanto a reprodução continua no minileitor. Apresentado com conteúdo de demonstração fictício no Firefox. |
| 03-series.png | Consulta os detalhes de uma série, as temporadas e os episódios. Apresentado com conteúdo de demonstração fictício no Firefox. |
| 04-subtitles.png | Reproduz um episódio MKV com legendas de texto e escolhe o idioma e o tamanho. Apresentado com conteúdo de demonstração fictício no Firefox. |
| 05-movie.png | Vê um filme com a sinopse e os detalhes ao lado do teu catálogo, apresentado em capas. Apresentado com conteúdo de demonstração fictício no Firefox. |

### Čeština (cs)

| File | Caption |
| --- | --- |
| 01-channels.png | Procházej kanály podle země a tématu a přitom sleduj živé vysílání. Zobrazeno s fiktivním ukázkovým obsahem ve Firefoxu. |
| 02-guide.png | Prohlížej programového průvodce, zatímco přehrávání pokračuje v minipřehrávači. Zobrazeno s fiktivním ukázkovým obsahem ve Firefoxu. |
| 03-series.png | Procházej podrobnosti seriálu, řady a epizody. Zobrazeno s fiktivním ukázkovým obsahem ve Firefoxu. |
| 04-subtitles.png | Přehraj epizodu MKV s textovými titulky a vyber jejich jazyk a velikost. Zobrazeno s fiktivním ukázkovým obsahem ve Firefoxu. |
| 05-movie.png | Sleduj film s popisem a podrobnostmi vedle svého katalogu zobrazeného jako obaly. Zobrazeno s fiktivním ukázkovým obsahem ve Firefoxu. |

### Slovenčina (sk)

| File | Caption |
| --- | --- |
| 01-channels.png | Prechádzaj kanály podľa krajiny a témy a pritom sleduj živé vysielanie. Zobrazené s fiktívnym ukážkovým obsahom vo Firefoxe. |
| 02-guide.png | Prezeraj programového sprievodcu, kým prehrávanie pokračuje v miniprehrávači. Zobrazené s fiktívnym ukážkovým obsahom vo Firefoxe. |
| 03-series.png | Prechádzaj podrobnosti seriálu, série a epizódy. Zobrazené s fiktívnym ukážkovým obsahom vo Firefoxe. |
| 04-subtitles.png | Prehraj epizódu MKV s textovými titulkami a vyber ich jazyk a veľkosť. Zobrazené s fiktívnym ukážkovým obsahom vo Firefoxe. |
| 05-movie.png | Sleduj film s popisom a podrobnosťami vedľa svojho katalógu zobrazeného ako obaly. Zobrazené s fiktívnym ukážkovým obsahom vo Firefoxe. |

### Slovenščina (sl)

| File | Caption |
| --- | --- |
| 01-channels.png | Brskaj po kanalih po državah in temah, medtem ko gledaš televizijo v živo. Prikazano z izmišljeno predstavitveno vsebino v Firefoxu. |
| 02-guide.png | Raziskuj programski vodnik, medtem ko se predvajanje nadaljuje v mini predvajalniku. Prikazano z izmišljeno predstavitveno vsebino v Firefoxu. |
| 03-series.png | Brskaj po podrobnostih serije, sezonah in epizodah. Prikazano z izmišljeno predstavitveno vsebino v Firefoxu. |
| 04-subtitles.png | Predvajaj epizodo MKV z besedilnimi podnapisi ter izberi njihov jezik in velikost. Prikazano z izmišljeno predstavitveno vsebino v Firefoxu. |
| 05-movie.png | Glej film z opisom in podrobnostmi ob svojem katalogu, prikazanem z naslovnicami. Prikazano z izmišljeno predstavitveno vsebino v Firefoxu. |

### Hrvatski (hr)

| File | Caption |
| --- | --- |
| 01-channels.png | Pregledaj kanale po zemlji i temi dok gledaš TV uživo. Prikazano s izmišljenim demo sadržajem u Firefoxu. |
| 02-guide.png | Istraži programski vodič dok se reprodukcija nastavlja u mini reproduktoru. Prikazano s izmišljenim demo sadržajem u Firefoxu. |
| 03-series.png | Pregledaj pojedinosti serije, sezone i epizode. Prikazano s izmišljenim demo sadržajem u Firefoxu. |
| 04-subtitles.png | Reproduciraj MKV epizodu s tekstnim titlovima i odaberi njihov jezik i veličinu. Prikazano s izmišljenim demo sadržajem u Firefoxu. |
| 05-movie.png | Gledaj film s opisom i pojedinostima pokraj svog kataloga prikazanog kao naslovnice. Prikazano s izmišljenim demo sadržajem u Firefoxu. |

### Srpski (sr)

| File | Caption |
| --- | --- |
| 01-channels.png | Pregledaj kanale po zemlji i temi dok gledaš TV uživo. Prikazano sa izmišljenim demo sadržajem u Firefoxu. |
| 02-guide.png | Istraži programski vodič dok se reprodukcija nastavlja u mini plejeru. Prikazano sa izmišljenim demo sadržajem u Firefoxu. |
| 03-series.png | Pregledaj detalje serije, sezone i epizode. Prikazano sa izmišljenim demo sadržajem u Firefoxu. |
| 04-subtitles.png | Pusti MKV epizodu sa tekstualnim titlovima i izaberi njihov jezik i veličinu. Prikazano sa izmišljenim demo sadržajem u Firefoxu. |
| 05-movie.png | Gledaj film sa opisom i detaljima pored svog kataloga prikazanog kao omoti. Prikazano sa izmišljenim demo sadržajem u Firefoxu. |

### Shqip (sq)

| File | Caption |
| --- | --- |
| 01-channels.png | Shfleto kanalet sipas vendit dhe temës ndërsa shikon TV drejtpërdrejt. Paraqitur me përmbajtje demonstruese fiktive në Firefox. |
| 02-guide.png | Eksploro udhërrëfyesin e programeve ndërsa luajtja vazhdon në mini-luajtës. Paraqitur me përmbajtje demonstruese fiktive në Firefox. |
| 03-series.png | Shfleto detajet e serialit, sezonet dhe episodet. Paraqitur me përmbajtje demonstruese fiktive në Firefox. |
| 04-subtitles.png | Luaj një episod MKV me titra teksti dhe zgjidh gjuhën dhe madhësinë e tyre. Paraqitur me përmbajtje demonstruese fiktive në Firefox. |
| 05-movie.png | Shiko një film me përshkrimin dhe detajet e tij pranë katalogut tënd, të shfaqur me kopertina. Paraqitur me përmbajtje demonstruese fiktive në Firefox. |

### Български (bg)

| File | Caption |
| --- | --- |
| 01-channels.png | Разглеждай каналите по държава и тема, докато гледаш телевизия на живо. Показано с измислено демонстрационно съдържание във Firefox. |
| 02-guide.png | Разгледай програмата, докато възпроизвеждането продължава в мини плейъра. Показано с измислено демонстрационно съдържание във Firefox. |
| 03-series.png | Разглеждай подробностите за сериала, сезоните и епизодите. Показано с измислено демонстрационно съдържание във Firefox. |
| 04-subtitles.png | Пусни MKV епизод с текстови субтитри и избери езика и размера им. Показано с измислено демонстрационно съдържание във Firefox. |
| 05-movie.png | Гледай филм с описанието и подробностите му до каталога си, показан като корици. Показано с измислено демонстрационно съдържание във Firefox. |

### Русский (ru)

| File | Caption |
| --- | --- |
| 01-channels.png | Просматривай каналы по странам и темам, пока смотришь прямой эфир. Показан вымышленный демонстрационный контент в Firefox. |
| 02-guide.png | Изучай телепрограмму, пока воспроизведение продолжается в мини-плеере. Показан вымышленный демонстрационный контент в Firefox. |
| 03-series.png | Просматривай сведения о сериале, сезоны и эпизоды. Показан вымышленный демонстрационный контент в Firefox. |
| 04-subtitles.png | Включи эпизод MKV с текстовыми субтитрами и выбери их язык и размер. Показан вымышленный демонстрационный контент в Firefox. |
| 05-movie.png | Смотри фильм с описанием и сведениями рядом со своим каталогом в виде обложек. Показан вымышленный демонстрационный контент в Firefox. |

### Українська (uk)

| File | Caption |
| --- | --- |
| 01-channels.png | Переглядай канали за країнами й темами, поки дивишся пряму трансляцію. Показано вигаданий демонстраційний вміст у Firefox. |
| 02-guide.png | Вивчай телепрограму, поки відтворення триває в мініплеєрі. Показано вигаданий демонстраційний вміст у Firefox. |
| 03-series.png | Переглядай відомості про серіал, сезони й епізоди. Показано вигаданий демонстраційний вміст у Firefox. |
| 04-subtitles.png | Увімкни епізод MKV з текстовими субтитрами й обери їхню мову та розмір. Показано вигаданий демонстраційний вміст у Firefox. |
| 05-movie.png | Дивися фільм з описом і відомостями поруч зі своїм каталогом у вигляді обкладинок. Показано вигаданий демонстраційний вміст у Firefox. |

### Ελληνικά (el)

| File | Caption |
| --- | --- |
| 01-channels.png | Περιηγήσου στα κανάλια ανά χώρα και θέμα ενώ βλέπεις ζωντανή τηλεόραση. Εμφανίζεται με φανταστικό περιεχόμενο επίδειξης στον Firefox. |
| 02-guide.png | Εξερεύνησε τον οδηγό προγράμματος ενώ η αναπαραγωγή συνεχίζεται στο μίνι πρόγραμμα αναπαραγωγής. Εμφανίζεται με φανταστικό περιεχόμενο επίδειξης στον Firefox. |
| 03-series.png | Δες τις λεπτομέρειες μιας σειράς, τις σεζόν και τα επεισόδιά της. Εμφανίζεται με φανταστικό περιεχόμενο επίδειξης στον Firefox. |
| 04-subtitles.png | Παίξε ένα επεισόδιο MKV με υπότιτλους κειμένου και διάλεξε τη γλώσσα και το μέγεθός τους. Εμφανίζεται με φανταστικό περιεχόμενο επίδειξης στον Firefox. |
| 05-movie.png | Δες μια ταινία με την περιγραφή και τα στοιχεία της δίπλα στον κατάλογό σου, που εμφανίζεται με εξώφυλλα. Εμφανίζεται με φανταστικό περιεχόμενο επίδειξης στον Firefox. |

### Română (ro)

| File | Caption |
| --- | --- |
| 01-channels.png | Răsfoiește canalele după țară și temă în timp ce te uiți la TV în direct. Ilustrat cu conținut demonstrativ fictiv în Firefox. |
| 02-guide.png | Explorează ghidul de programe în timp ce redarea continuă în mini-player. Ilustrat cu conținut demonstrativ fictiv în Firefox. |
| 03-series.png | Răsfoiește detaliile unui serial, sezoanele și episoadele. Ilustrat cu conținut demonstrativ fictiv în Firefox. |
| 04-subtitles.png | Redă un episod MKV cu subtitrări text și alege-le limba și dimensiunea. Ilustrat cu conținut demonstrativ fictiv în Firefox. |
| 05-movie.png | Urmărește un film cu descrierea și detaliile lui lângă catalogul tău, afișat cu coperți. Ilustrat cu conținut demonstrativ fictiv în Firefox. |

### Magyar (hu)

| File | Caption |
| --- | --- |
| 01-channels.png | Böngéssz a csatornák között ország és téma szerint, miközben élő adást nézel. Kitalált bemutató tartalommal, Firefoxban. |
| 02-guide.png | Fedezd fel a műsorújságot, miközben a lejátszás a minilejátszóban folytatódik. Kitalált bemutató tartalommal, Firefoxban. |
| 03-series.png | Böngészd a sorozat adatait, évadait és epizódjait. Kitalált bemutató tartalommal, Firefoxban. |
| 04-subtitles.png | Játssz le egy MKV-epizódot szöveges felirattal, és válaszd ki a felirat nyelvét és méretét. Kitalált bemutató tartalommal, Firefoxban. |
| 05-movie.png | Nézz filmet úgy, hogy a leírása és az adatai a borítókkal megjelenített katalógusod mellett látszanak. Kitalált bemutató tartalommal, Firefoxban. |

### Lietuvių (lt)

| File | Caption |
| --- | --- |
| 01-channels.png | Naršyk kanalus pagal šalį ir temą, kol žiūri tiesioginę transliaciją. Rodomas išgalvotas demonstracinis turinys Firefox naršyklėje. |
| 02-guide.png | Peržiūrėk TV programą, kol atkūrimas tęsiasi mini grotuve. Rodomas išgalvotas demonstracinis turinys Firefox naršyklėje. |
| 03-series.png | Naršyk serialo informaciją, sezonus ir epizodus. Rodomas išgalvotas demonstracinis turinys Firefox naršyklėje. |
| 04-subtitles.png | Paleisk MKV epizodą su tekstiniais subtitrais ir pasirink jų kalbą bei dydį. Rodomas išgalvotas demonstracinis turinys Firefox naršyklėje. |
| 05-movie.png | Žiūrėk filmą su aprašymu ir informacija šalia savo katalogo, rodomo viršeliais. Rodomas išgalvotas demonstracinis turinys Firefox naršyklėje. |

### Latviešu (lv)

| File | Caption |
| --- | --- |
| 01-channels.png | Pārlūko kanālus pēc valsts un tēmas, kamēr skaties tiešraidi. Parādīts izdomāts demonstrācijas saturs pārlūkā Firefox. |
| 02-guide.png | Izpēti TV programmu, kamēr atskaņošana turpinās mini atskaņotājā. Parādīts izdomāts demonstrācijas saturs pārlūkā Firefox. |
| 03-series.png | Pārlūko seriāla informāciju, sezonas un sērijas. Parādīts izdomāts demonstrācijas saturs pārlūkā Firefox. |
| 04-subtitles.png | Atskaņo MKV sēriju ar teksta subtitriem un izvēlies to valodu un izmēru. Parādīts izdomāts demonstrācijas saturs pārlūkā Firefox. |
| 05-movie.png | Skaties filmu ar tās aprakstu un informāciju blakus savam katalogam, kas parādīts ar vāciņiem. Parādīts izdomāts demonstrācijas saturs pārlūkā Firefox. |

### Eesti (et)

| File | Caption |
| --- | --- |
| 01-channels.png | Sirvi kanaleid riigi ja teema järgi, samal ajal otsesaadet vaadates. Näidatud väljamõeldud demosisuga Firefoxis. |
| 02-guide.png | Uuri telekava, samal ajal kui taasesitus jätkub minimängijas. Näidatud väljamõeldud demosisuga Firefoxis. |
| 03-series.png | Sirvi sarja andmeid, hooaegu ja osi. Näidatud väljamõeldud demosisuga Firefoxis. |
| 04-subtitles.png | Esita MKV-osa tekstisubtiitritega ning vali nende keel ja suurus. Näidatud väljamõeldud demosisuga Firefoxis. |
| 05-movie.png | Vaata filmi nii, et selle kirjeldus ja andmed on kaanepiltidena näidatud kogu kõrval. Näidatud väljamõeldud demosisuga Firefoxis. |

### Bahasa Indonesia (id)

| File | Caption |
| --- | --- |
| 01-channels.png | Jelajahi saluran menurut negara dan topik sambil menonton TV langsung. Ditampilkan dengan konten demo fiktif di Firefox. |
| 02-guide.png | Jelajahi panduan acara sementara pemutaran berlanjut di pemutar mini. Ditampilkan dengan konten demo fiktif di Firefox. |
| 03-series.png | Lihat detail serial, musim, dan episodenya. Ditampilkan dengan konten demo fiktif di Firefox. |
| 04-subtitles.png | Putar episode MKV dengan subtitle teks dan pilih bahasa serta ukurannya. Ditampilkan dengan konten demo fiktif di Firefox. |
| 05-movie.png | Tonton film dengan deskripsi dan detailnya di samping katalogmu, yang ditampilkan sebagai sampul. Ditampilkan dengan konten demo fiktif di Firefox. |

### Tiếng Việt (vi)

| File | Caption |
| --- | --- |
| 01-channels.png | Duyệt kênh theo quốc gia và chủ đề trong khi xem truyền hình trực tiếp. Minh họa bằng nội dung demo hư cấu trên Firefox. |
| 02-guide.png | Khám phá lịch phát sóng trong khi video vẫn phát ở trình phát thu nhỏ. Minh họa bằng nội dung demo hư cấu trên Firefox. |
| 03-series.png | Xem thông tin phim bộ, các mùa và các tập. Minh họa bằng nội dung demo hư cấu trên Firefox. |
| 04-subtitles.png | Phát một tập MKV có phụ đề văn bản, chọn ngôn ngữ và cỡ chữ của phụ đề. Minh họa bằng nội dung demo hư cấu trên Firefox. |
| 05-movie.png | Xem phim với phần mô tả và thông tin bên cạnh thư viện của bạn, hiển thị dạng ảnh bìa. Minh họa bằng nội dung demo hư cấu trên Firefox. |
