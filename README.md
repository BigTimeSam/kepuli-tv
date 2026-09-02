# Kepuli-TV

Chrome-laajennus (Manifest V3), joka toistaa Xtream Codes -IPTV:tä suoraan
selaimessa. Data haetaan `player_api.php`-rajapinnasta laiskasti: vain se mitä
selaat, silloin kun selaat.

## Käyttötarkoitus

Kepuli-TV on soitin. Se ei sisällä, jaa, isännöi eikä indeksoi mitään
mediasisältöä, kanavia, toistolistoja eikä palveluntarjoajia, eikä sen mukana
toimiteta yhtään osoitetta mihinkään palveluun. Ilman tunnuksia, jotka
käyttäjä tuo itse, se ei tee mitään.

Ohjelma on tarkoitettu vain sellaisen sisällön katseluun, johon käyttäjällä on
oikeus: omaan maksettuun tilaukseen, omaan mediaan tai muuhun aineistoon jonka
katseluun hänellä on lupa. Käyttäjä vastaa itse siitä, että hänen käyttämänsä
palvelu ja sen sisältö ovat laillisia hänen maassaan.

Tekijä ei tarjoa, myy, suosittele eikä neuvo IPTV-tilausten hankinnassa eikä
vastaa niitä koskeviin kysymyksiin. Tällaiset issuet suljetaan.

Ohjelmisto toimitetaan sellaisenaan ilman takuuta; ks. LICENSE.

### Intended use

Kepuli-TV is a player. It contains, distributes, hosts and indexes no media,
channels, playlists or providers, and ships no address to any service. It does
nothing without credentials the user brings.

It is intended solely for viewing content the user has the right to view: their
own paid subscription, their own media, or other material they are permitted to
watch. Users are responsible for ensuring that the service they use, and its
content, are lawful in their country.

The author does not provide, sell, recommend or advise on obtaining IPTV
subscriptions, and does not answer questions about them. Such issues are closed.

The software is provided as is, without warranty; see LICENSE.

## Asennus

1. Avaa `chrome://extensions`
2. Kytke **Kehittäjätila** päälle
3. **Lataa pakkaamaton laajennus** → valitse tämä kansio
4. Klikkaa laajennuksen kuvaketta → soitin avautuu omaan välilehteen
5. Valitse yhteystapa: **Xtream Codes** (palvelin, portti, tunnus, salasana)
   tai **M3U-osoite** (yksi kenttä, johon liitetään palveluntarjoajan antama
   soittolistaosoite). Kumpikin päätyy samaan paikkaan, ks. alla

## Kehitys

Käännösvaihetta ei ole: tiedostot ovat sellaisenaan sitä mitä selain ajaa,
joten muokkaa ja lataa uudelleen.

### Automaattinen silmukka

```
node dev/dev.mjs
```

Avaa oman Chrome-profiilin, lataa laajennuksen, avaa soittimen ja lataa sen
uudelleen aina kun `js/`, `css/` tai `player.html` muuttuu. `manifest.json`
ja `background.js` vaativat koko laajennuksen uudelleenlatauksen, ja skripti
tekee senkin itse. Riippuvuuksia ei ole, Node 22+ riittää.

Profiili on `~/.cache/kepuli-tv-dev` eli erillään omasta selaimestasi:
tunnukset annetaan siihen kerran, minkä jälkeen ne säilyvät. Portin ja
profiilin voi vaihtaa ympäristömuuttujilla `KEPULI_DEV_PORT` ja
`KEPULI_DEV_PROFILE`.

### Käsin omassa selaimessa

1. `chrome://extensions` → **Kehittäjätila** → **Lataa pakkaamaton laajennus**
2. Klikkaa kuvaketta → soitin avautuu välilehteen
3. Muutosten jälkeen:

| Muuttunut | Riittää |
| --- | --- |
| `js/*.js`, `css/player.css`, `player.html` | soitinvälilehden lataus (`⌘R`) |
| `manifest.json`, `background.js` | laajennuksen ↻ `chrome://extensions`-sivulla |

Sivunlataus lukee tiedostot levyltä uudelleen — ES-moduulit mukaan lukien —
joten laajennusta ei tarvitse ladata uudelleen tavallisessa työssä.

### Huomaa: `--load-extension` ei enää toimi

Chrome hylkää lipun hiljaa (152 antaa `ERR_BLOCKED_BY_CLIENT` laajennuksen
sivulle). `dev/dev.mjs` käyttää siksi DevTools-protokollan
`Extensions.loadUnpacked`-komentoa, joka toimii myös uudelleenlatauksena
samaan polkuun kutsuttaessa.

### Vianetsintä

- Soittimen konsoli: oikea klikkaus välilehdellä → **Tarkasta**
- Service worker: `chrome://extensions` → laajennuksen **Service worker**
- Verkkopyynnöt näkyvät soittimen omassa DevTools-ikkunassa; `player_api.php`
  -kutsut ovat helpoin tapa nähdä mitä laiska lataus oikeasti hakee
- Välimuistin (IndexedDB) tyhjennys: **Asetukset → Tyhjennä välimuisti**;
  kaiken poisto tunnuksineen: **Asetukset → Palauta alkutilaan**

## Miten data haetaan

Iso toistolista ei ole hyvä lähtökohta: testipalvelimen `get.php` palauttaa
75 megatavua ja 272 000 riviä, joissa ei ole kategoriatunnisteita eikä tietoa
tiedostomuodoista. `player_api.php` antaa saman jäsenneltynä ja paloiteltuna,
joten sovellus lataa portaittain:

| Vaihe | Mitä haetaan | Koko | Milloin |
| --- | --- | --- | --- |
| 1 | Kategoriat (live + elokuvat + sarjat) | 43 kt | yhteyden avaus |
| 2 | Valitun maan kanavat | 2–60 kt | maata klikatessa |
| 3 | Koko tyypin lista | 0,6–2,9 Mt | vasta haussa tai "Kaikki"-valinnassa |
| 4 | Sarjan jaksot, elokuvan tiedot | 1–20 kt | kohdetta avatessa |
| 5 | Ohjelmatiedot kanavalle | 1,6 kt | näkyville riveille |
| 6 | Kanavan koko ohjelmataulu | 50–150 kt | vasta kun oppaassa selataan menneisyyteen |

Mitatut ajat testipalvelimella: Albania (3 aihetta) 0,27 s, Sweden (31 aihetta)
1,1 s, USA (48 aihetta) 1,6 s. Kaikki ladattu tallentuu IndexedDB:hen, joten
seuraava avaus on välitön.

## Kategoriat kahdessa tasossa

Palveluntarjoaja koodaa kaksi tasoa yhteen merkkijonoon: `Sweden - Sport`,
`Sweden - Nyheter`, `Albania - Movies Club`. Sovellus purkaa ne, jolloin 519
live-kategoriaa tiivistyy **81 maaksi** vasempaan laitaan aakkosjärjestyksessä.
Maan valinta näyttää kaikki sen kanavat, ja yläreunan tarkennepainikkeista voi
rajata aiheeseen. Painikkeet ovat aakkosjärjestyksessä, paitsi maan oma
yleiskategoria joka on heti *Kaikki*-painikkeen perässä.

Sama purku poistaa elokuvien ja sarjojen `Movies:`- ja `Series:`-etuliitteet,
jotka toistavat vain välilehden nimeä.

Listat aakkostetaan aina — kanavat, elokuvat ja sarjat, kategoriassa,
ryhmässä ja *Kaikki*-listassa. Palveluntarjoajan oma järjestys vaihtelee
kategoriasta toiseen eikä kanna mitään merkitystä läpi listan. Nimen alun
välimerkit (`|FI| Alien`) ohitetaan, ja numerot vertaillaan lukuina, joten
*Rocky 2* on ennen *Rocky 10*:tä. Kun riviltä on karsittu toistuva etuliite
(alla), järjestys määräytyy näkyvän nimen mukaan. Haku järjestää osumat
edelleen osuvuuden mukaan, mutta samanarvoiset osumat aakkosjärjestykseen.

Sivupalkin suodatin osuu myös alakategorioihin: hakusana *sport* nostaa esiin
maat joilla on urheilukanavia, vaikka maan nimessä ei lue sanaa.

### Kategoria suosikkina

Yksittäisen kanavan merkitseminen ei riitä silloin kun kiinnostava asia on
koko kategoria: *Finland ▸ MTV Liiga* on kahdeksan kanavaa tänään ja jokin
muu määrä ensi kaudella. Siksi tähti on myös sivupalkin maarivillä ja
jokaisessa tarkennesirussa — ensimmäinen poimii koko ryhmän, jälkimmäinen
yhden kategorian.

*Suosikit*-välilehti listaa ne omana ryhmänään kanavien ja elokuvien
yläpuolella, ja rivin napauttaminen avaa kategorian sisällön paikan päällä:
sama lista kuin selausnäkymässä, samat rivinimet ja ohjelmatiedot, mutta
paluu suosikkeihin on yksi napautus. Sisältö haetaan aina tuoreena, joten
kategoriaan ilmestyneet kanavat näkyvät ilman että suosikkia tarvitsee
päivittää.

Talteen menee vain tunniste — tyyppi, `category_id` ja näkyvä nimi — ei
kategorian sisältö. Ryhmäsuosikki (*Finland*) tallentaa ryhmän nimen ja
kokoaa alakategoriansa vasta avattaessa, joten sekin seuraa muuttuvaa
tarjontaa.

Ylätunnisteen haku kohdistuu koko listaan (kategoriarajaus poistuu näkyvästi)
ja järjestää osumat osuvuuden mukaan: sanan alusta alkava osuma menee keskeltä
löytyvän edelle, jotta *yle* nostaa Yle-kanavat eikä "KYLE COLLECTIONia".

## Ominaisuudet

- **Ohjelmatiedot** näkyville kanaville: käynnissä oleva ohjelma ja
  edistymispalkki listarivillä, kuvaus ja seuraava ohjelma soittimen alla
- **Interaktiivinen ohjelmaopas** (`g`): kanavat riveinä, aika vaaka-akselilla
  ja liikkuva nyt-viiva — ks. alla
- **Catchup** niille kanaville joilla on arkisto: menneen ohjelman voi
  käynnistää suoraan oppaasta
- **Sarjat** kausittain, kansikuvat ja juonet TMDB:stä
- **Elokuvien tiedot**: juoni, kesto, arvosana, koodekki
- **MKV toistuu** ilman ulkoista soitinta: kontti puretaan lennossa fMP4:ksi,
  kelaus mukaan lukien. Jos ääniraita on AC-3:a tai DTS:ää, tarjolla on
  **Toista ilman ääntä**
- **Tekstitykset** MKV-tiedostoista: kieli- ja kokovalitsin soittimen alla, ja
  valittu kieli tarttuu seuraaviin jaksoihin — ks. alla
- **Toistokelvottomat merkitään listalla** ennen klikkausta; kerran tutkitusta
  tiedostosta merkintä tarkentuu koodekkien mukaan
- **Luovutus ulkoiselle soittimelle** (`↗` tai `x`) sille mitä selain ei osaa
  — ks. alla
- **Katselukohdan muistaminen** elokuville ja jaksoille, edistymispalkki rivillä
- **Suosikit** ja **historia** omina välilehtinään — suosikiksi käy myös
  kokonainen kategoria, ks. alla
- **Kaksi kieltä**: englanti ja suomi, vaihto asetuksista ilman sivun latausta
- **Automaattinen uudelleenyhdistäminen** jos live-virta katkeaa — lähteen
  kuolema tunnistetaan kolmella tavalla: palvelin katkaisee, puskuri soitetaan
  loppuun, tai kuva jähmettyy yhteyden jäädessä auki. Katsojan oma tauko
  erotetaan näistä eikä sitä ohiteta
- **Tekniset tiedot** kuvan päällä: resoluutio, bittinopeus, moottori

### Pikanäppäimet

| Näppäin | Toiminto |
| --- | --- |
| `/` | siirry hakuun |
| `↑` `↓` `PgUp` `PgDn` | liiku listalla |
| `Enter` | toista / avaa sarja |
| `Backspace` | takaisin sarjalistaan |
| `väli` | tauko |
| `f` | koko näyttö |
| `m` | mykistys |
| `n` `p` | seuraava / edellinen |
| `g` | avaa ja sulje ohjelmaopas |
| `x` | luovuta ulkoiselle soittimelle |

Oppaassa nuolet liikkuvat kanavien ja ohjelmien välillä, `Home` palaa
nykyhetkeen, `+` ja `−` säätävät aikajanan mittakaavaa, `Enter` käynnistää
ja `Esc` sulkee.

## Ohjelmaopas

`Opas` (tai `g`) vaihtaa koko ikkunan ruudukkonäkymään: kanavat riveinä, aika
vaaka-akselilla ja liikkuva nyt-viiva. Video jatkuu oikeassa ylänurkassa ja
valittu ohjelma näkyy vasemmalla kuvauksineen. Ruudukko näyttää saman
kanavajoukon kuin lista, joten ryhmävalinta ja haku rajaavat myös opasta.

Aikajana ulottuu kahdesta vuorokaudesta taaksepäin viiteen eteenpäin.
Menneet ohjelmat ovat himmeitä; niistä joihin kanavan arkisto yltää saa
**Katso tallenne** -painikkeen. Vasemmasta reunasta jatkuva ohjelma merkitään
`‹`-merkillä ja sen nimi siirretään näkyviin.

Ohjelmatiedot haetaan kolmella tarkkuudella samaan välimuistiin: listariville
riittää neljä ohjelmaa, oppaan eteenpäin katsomiseen 40, ja koko ohjelmataulu
haetaan vasta kun ruudukkoa vieritetään tunnettujen ohjelmien ohi. Karkeampaa
ei haeta hienomman päälle, joten oppaassa käyty kanava ei putoa takaisin
neljään ohjelmaan listaa selatessa.

## Toistotavat

| Lähde | Moottori |
| --- | --- |
| Live (MPEG-TS) | mpegts.js → MediaSource |
| Live (`.m3u8`) tai TS:n varareitti | hls.js |
| VOD `.mp4` `.m4v` `.mov` `.webm` | selaimen oma toistin |
| VOD `.ts` `.flv` | otsikon luku ratkaisee — pääte ei pidä paikkaansa |
| VOD `.mkv` | Matroskan purku fMP4:ksi → MediaSource |
| VOD `.avi` | ei tuettu |

`Auto` kokeilee live-kanavilla ensin TS:ää (pienempi viive) ja siirtyy HLS:ään
jos TS ei käynnisty 20 sekunnissa. Testipalvelimella HLS käynnistyy usein
nopeammin mutta on segmenttipituuden verran jäljessä suorasta.

Testiaineistossa elokuvista 54 % on `.mp4` ja 44 % `.mkv`. Toistokelvottomille
tarjotaan **Kopioi osoite** ja **Avaa ulkoisessa soittimessa**.

### Ulkoinen soitin

Purku ja wasm-ääni kattavat suurimman osan kirjastosta, mutta eivät kaikkea:
AVI-kontti, VC-1, 10-bittinen H.264 ja bittikarttatekstitykset (PGS, VOBSUB)
jäävät selaimen ulottumattomiin. Työpöytäsoitin osaa ne natiivisti ja ottaa
Xtreamin stream-osoitteen vastaan sellaisenaan. Luovutus tapahtuu aina käsin —
soittimen alla olevasta `↗`-napista, näppäimestä `x` tai virheilmoituksen
painikkeesta — eikä koskaan itsestään.

Reittejä oli kaksi, jäljellä on yksi: yhden kohteen `.m3u` ladataan blobista,
ja käyttöjärjestelmä avaa sen sillä soittimella joka on rekisteröity
`.m3u`:lle — VLC:llä se on `public.m3u-playlist` sen Info.plistissä. Kaksi
klikkausta, ei uusia manifest-oikeuksia eikä siltaa laajennuksen ja
käyttöjärjestelmän väliin.

Soitinkohtaiset URL-skeemat (`iina://`, `mpv://`) olivat aiemmin valittavissa
ja jäivät pois: ne säästivät yhden klikkauksen mutta vaativat käyttäjältä
valinnan ja tiedon siitä mikä hänelle on asennettu. **VLC ei macOS:ssä
rekisteröi `vlc://`-skeemaa** — sen Info.plist listaa vain `http https ftp mms
mmsh rtmp rtmpe rtmps rtmpt rtp rtsp sftp smb udp` — eli yleisimmälle
soittimelle tiedostoreitti oli joka tapauksessa ainoa.

Katselukohta seuraa mukana: soittolistaan kirjoitetaan `#EXTVLCOPT:start-time=`
siitä kohdasta johon selain ehti. Toisto pysäytetään ennen luovutusta, koska
tili sallii yhden yhtäaikaisen yhteyden — muuten selaimen auki pitämä virta
jättäisi ulkoisen soittimen mykäksi.

Osoitteessa ovat tunnukset, joten ladattu `.m3u` on yhtä arkaluontoinen kuin
itse tili.

### Matroskan purku

Chrome ei ota Matroskaa vastaan, mutta sen sisällä oleva H.264 tai HEVC kelpaa
sellaisenaan. `js/mkv.js` purkaa klusterit virrasta, `js/mp4.js` pakkaa
kehykset fMP4-paloiksi ja `js/remux.js` syöttää ne MediaSourcelle. Kuvaa ei
pureta eikä koodata uudelleen — vain kontti vaihtuu.

Kolme kohtaa vaati tarkkuutta:

- **Dekoodausaika.** Matroska tallettaa vain esitysajan. B-kuvien takia ne
  eroavat — mitatussa jaksossa 1569 kehyksestä 740:n PTS meni edellistä
  taaksepäin. DTS saadaan järjestämällä palan aikaleimat nousevaan
  järjestykseen ja jakamalla ne dekoodausjärjestyksessä.
- **Aikayksiköt.** Videolla 90 000 tikkiä sekunnissa jakautuu tasan kaikilla
  tavallisilla kuvataajuuksilla. Äänellä käytetään näytetaajuutta ja kehykset
  ketjutetaan peräkkäin, koska Matroskan millisekunnin tarkkuus pyöristäisi
  AAC-kehyksen 21,333 ms:n keston ja virhe kertyisi tunnissa sekunneiksi.
- **Yksi yhteys.** Tili sallii yhden yhtäaikaisen latauksen, joten otsikko
  luetaan samasta virrasta josta toisto jatkuu. Kelaus katkaisee virran ja
  avaa uuden Cues-taulun osoittamasta kohdasta; taulu on tiedoston lopussa,
  joten se haetaan vain jos kelataan.

Katkennut lataus jatkuu viimeisen kokonaisen klusterin alusta. Jos tiedosto
sen sijaan on rikki — kirjastosta löytyi jakso, jota seurasi kolme megatavua
nollia eikä yhtään klusteria — toisto päättyy ehjään kohtaan ja katsojalle
kerrotaan mihin asti kuvaa oli.

### Tekstitykset

Purku poimii samalla tekstitysraidat (`js/subs.js`). Lohkon teksti annetaan
selaimelle `VTTCue`na, ei omalle päällyskerrokselle: näin tekstitys näkyy myös
koko näytön tilassa ja Chromen omassa tekstitysvalikossa. Valinta tehdään
soittimen alla olevasta valitsimesta, ja kieli — ei raidan numero — jää
muistiin, joten sarjan seuraava jakso avautuu samalla kielellä. Oletus on
suomi, jos tiedostosta löytyy suomenkielinen raita.

Valitsin on aakkosjärjestyksessä suomen säännöillä: tiedoston oma järjestys on
mielivaltainen, eikä kolmenkymmenen raidan listasta löydä oikeaa kieltä ellei
sen paikkaa voi arvata. Vieressä on koko (pieni, keskikokoinen, iso), joka
skaalautuu suhteessa selaimen omaan mittaan — kiinteä pikselikoko kutistuisi
olemattomiin koko näytön tilassa.

Kaikkien tekstiraitojen cuet kerätään talteen sitä mukaa kuin tiedostoa
puretaan, vaikka näkyvissä on yksi. Vaihtoehto olisi lukea tiedosto uudelleen
raitaa vaihdettaessa, mikä veisi ainoan sallitun yhteyden ja keskeyttäisi
kuvan. Kelauksen jälkeen samat lohkot tulevat toistamiseen, joten jo lisätty
cue tunnistetaan ja ohitetaan.

Rajat:

- **SRT, ASS/SSA ja WebVTT** kelpaavat. Bittikarttamuodot (PGS, VOBSUB, DVBSUB)
  ovat kuvia eikä niitä voi antaa `VTTCue`lle, joten ne jäävät valitsimesta
  pois — listarivin "34 tekstitystä" laskee nekin mukaan.
- ASS:n tyylikoodit (`{\an8}`, `{\pos}`) karsitaan ja kursiivi säilyy;
  piirtokomennoilla tehdyt taustat ja tehosteet jäävät näyttämättä.
- Vain purkupolku tuntee tekstitykset. Natiivisti toistuvan MP4:n `mov_text`
  jää yhä pois, koska Chrome ei renderöi sitä.

### Mitä purku avaa

Mitattuna 1 500 sarjan otoksella (23 628 jaksoa):

| | Osuus jaksoista |
| --- | --- |
| Toistui ennen purkua | 44,6 % |
| Purku, ääni sellaisenaan | +21,6 % → **66,2 %** |
| Purku, ääni purettuna (AC-3/E-AC-3/DTS) | +27,5 % → **93,7 %** |

Viimeinen rivi vaatii oman purkajansa, koska Chromessa ei ole AC-3:a,
E-AC-3:a eikä DTS:ää. Vaihtoehtoista ääniraitaa ei kannata odottaa: 45:stä
ac3/eac3-jaksosta yhdessäkään ei ollut toista, Chromen tukemaa raitaa, ja
43:ssa oli vain yksi ääniraita. **Toista ilman ääntä** on siis jäljellä vain
niille harvoille raidoille joita ei pureta (esim. TrueHD, MP3 MKV:ssä).

### Ääniraidan purku

Purkaja on FFmpegin oma, käännettynä wasmiksi (`vendor/ffaudio`, LGPL 2.1+,
628 kt). Käsin kirjoitettu AC-3-purku kattaisi vain osan: E-AC-3 ei ole sama
bittivirta vaan lisää AHT:n, spektrilaajennuksen ja osavirrat, ja DTS on kolmas
erillinen. Käännös on `dev/wasm/build.sh`, ja `--test` vertaa ulostuloa
ffmpegin omaan samasta bittivirrasta — ero on kaikissa tapauksissa float-
pyöristystä (~1e-7), myös 5.1:n alaslaskennassa ja 32 kHz:n muunnoksessa.

MediaSource ei ota vastaan PCM:ää, joten purettu ääni koodataan uudelleen
AAC:ksi selaimen omalla `AudioEncoder`illa (`js/transcode.js`). Kaksi mitattua
rajoitetta määrää muodon:

- **Koodain hyväksyy vain 44 100 ja 48 000 Hz**, eikä se kestä kanavamäärän
  vaihtumista kesken raidan. AC-3 sallii 32 000 Hz:n, ja kirjastossa on
  tiedostoja joissa mono vaihtuu stereoksi. Siksi wasm-purkaja laskee kaiken
  kiinteään muotoon (stereo, 48 kHz) ennen koodainta. Alaslaskenta pyydetään
  purkajalta itseltään, joka käyttää virran omia cmixlev/surmixlev-tasoja;
  swresamplen yleinen matriisi antoi mitattuna eri tuloksen ja leikkasi.
- **Koodaimessa on esitäyte, jota se ei kerro eikä korjaa** — mitattuna 2112
  näytettä eli 44 ms, joka on macOS:n AudioToolboxin luku eikä siis siirrettävä.
  Ilman korjausta ääni olisi kauttaaltaan sen verran kuvaa jäljessä. Luku
  mitataan siksi ajossa: koodataan tunnettu heräte ja puretaan se takaisin
  selaimen omalla purkajalla. Mitattuna ketju osuu näytteen tarkkuudella, eikä
  60 sekunnin aikana ryömi lainkaan.

Vastapaine hoidetaan odottamalla eikä huuhtelemalla: `flush()` pakottaa
koodaimen antamaan ulos myös vajaan kehyksen hiljaisuudella täytettynä, ja
kehysketju venyisi joka kerta — mitattuna 60 sekunnin kuvaa vastasi 69
sekuntia ääntä.

### Tiedoston otsikon luku

Pääte ei riitä päätökseen eikä API:n metadataan voi luottaa. Mitattuna
testipalvelimelta (1 500 sarjaa, 23 628 jaksoa):

- `get_vod_info` ei palauta koodekkeja lainkaan — elokuvista ei siis tiedä
  päätteen lisäksi mitään
- `get_series_info` kertoo 4,7 %:lle jaksoista videokoodekiksi `png`:n tai
  `mjpeg`:in: se on kansikuva, jonka ffprobe näkee ensimmäisenä raitana
- `.ts`-päätteiset VOD-tiedostot olivat otoksessa poikkeuksetta Matroskaa
  (10/10) — `.mp4` ja `.mkv` sen sijaan pitivät paikkansa (8/8 kumpikin)
- ääni ratkaisee useammin kuin kontti: mkv-jaksoista noin 42 % on `aac` ja
  53 % `ac3`/`eac3`/`dts`, joita Chrome ei pura millään

`js/probe.js` lukee siksi tiedoston ensimmäiset 256 kt yhdellä Range-pyynnöllä
ja jäsentää Matroskan `Tracks`-elementin: kontti, koodekit profiileineen,
ääniraidat ja tekstitykset kielineen. Profiili on tarpeen, koska Chrome ei pura
10-bittistä H.264:ää — pelkkä `avc1` antaisi liian toiveikkaan vastauksen.
Tulos tallentuu IndexedDB:hen ja näkyy listarivillä ilman uutta pyyntöä.

Otsikkoa ei lueta etukäteen: tili sallii yhden yhtäaikaisen yhteyden, joten
luku tehdään vasta kun pääte ei lupaa toistoa, kun kontti on tunnetusti
epäluotettava (`.ts`), tai kun kaikki moottorit ovat epäonnistuneet. Silloin
virheilmoitus kertoo syyn: *"Ääniraita on MP3, jota Chrome ei pura. Kuva
toistuisi, ääni ei."* eikä pelkkää päätettä.

## Rakenne

```
manifest.json       MV3-manifesti
background.js       kuvakkeen klikkaus avaa soittimen
player.html         koko käyttöliittymä yhdellä sivulla
css/player.css
js/api.js           player_api.php -asiakas, base64-EPG, aikavyöhykkeet
js/library.js       laiska datakerros: ryhmittely, välimuisti, haku
js/epg.js           ohjelmatiedot jonolla, 4 rinnakkaista pyyntöä
js/epggrid.js       ohjelmaoppaan ruudukko, virtualisoitu molempiin suuntiin
js/db.js            IndexedDB: TTL-välimuisti
js/config.js        asetukset, suosikit, historia, katselukohdat
js/i18n.js          käyttöliittymän kieli: sanakirjat, t() ja staattinen HTML
js/playback.js      moottorin valinta, varareitit, vahtikoira
js/probe.js         tiedoston otsikon luku: kontti, koodekit, tekstitykset
js/ebml.js          EBML-primitiivit ja Matroskan otsikko
js/mkv.js           Matroskan klusterit virrasta kehyksiksi
js/mp4.js           fMP4-palat MediaSourcelle
js/remux.js         purkumoottori: lataus, kelaus, puskurit
js/ffaudio.js       AC-3-, E-AC-3- ja DTS-purku wasmilla
js/transcode.js     purettu ääni takaisin AAC:ksi MediaSourcea varten
js/subs.js          tekstitysraidat MKV:stä videoelementin omiksi raidoiksi
js/vlist.js         virtualisoitu lista
js/rows.js          listarivien piirto
js/format.js        muotoilijat
js/app.js           näkymät, haku, näppäimistö
js/permissions.js   valinnaisten host-oikeuksien pyyntö ja tarkistus
js/external.js      luovutus ulkoiselle soittimelle: yhden kohteen .m3u
icons/              16, 32, 48, 128 px laajennuksen kuvakkeet
brand/              tunnusgrafiikan lähteet, ei mukana paketissa
dev/dev.mjs         kehityssilmukka: lataa laajennuksen ja sivun muutoksista
dev/wasm/           ffaudion käännös ja vertailu ffmpegiin
vendor/             mpegts.js 1.8.0, hls.js 1.6.5 (paikallisina: MV3:n CSP
                    ei salli etäskriptejä)
vendor/ffaudio/     FFmpeg 7.1.1:n ac3-, eac3- ja dca-purkajat wasmina
```

## Huomioitavaa

- Tunnukset tallentuvat selkokielisenä `chrome.storage.local`iin tällä koneella.
  Xtreamissa tunnukset ovat myös osa jokaista stream-osoitetta.
- **Asetukset → Palauta alkutilaan** poistaa kaiken: tunnukset, asetukset,
  suosikit, historian, katselukohdat ja koko IndexedDB-tietokannan. Nappi
  kysyy varmistuksen itse — asetusdialogin päälle avattu toinen dialog jäisi
  sen alle — ja lataa sivun lopuksi uudelleen, koska muistissa oleva tila ei
  tyhjennyksen jälkeen vastaisi mitään.
- Host-oikeudet ovat `optional_host_permissions`-listassa, eli asennus ei
  pyydä pääsyä mihinkään. Oikeus kysytään vasta kun palvelimen osoite
  tallennetaan, ja vain sen palvelimen originille.
  Puuttuva oikeus näkyy verkkovirheenä, jonka yhteydessä on painike sen
  myöntämiseen. Sisältöskriptejä ei ole.
- Oikeutta tarvitaan vain fetch/XHR-pyyntöihin: `player_api.php` sekä hls.js:n
  ja mpegts.js:n segmenttihaut. Natiivisti toistuva VOD
  (`<video src>`) ja kanavalogot (`<img>`) toimivat ilman.
- **Yhtäaikaisten yhteyksien raja** näkyy asetuksissa. Testitilillä se on 1,
  jolloin toinen samanaikainen virta jää mykäksi. Sovellus purkaa edellisen
  virran ennen uuden avaamista, mutta jos toisto ei käynnisty, tarkista ettei
  sama tili ole käytössä muualla.
- Ohjelmatietoja on vain niille kanaville joille palveluntarjoaja on ne
  määrittänyt — testipalvelimella noin 8 800 kanavalle 29 600:sta.
- Osa kanavalogoista on rikki palvelimen päässä (osoitteet viittaavat
  poistettuun GitHub-repositorioon). Ne piilotetaan automaattisesti.

## Kieli

Käyttöliittymä on englanniksi ja suomeksi; oletus on englanti ja valinta
tehdään asetuksista. Sanakirjat ovat yhdessä tiedostossa (`js/i18n.js`), ja
englanti on samalla se lista josta puuttuvat avaimet paikataan — kesken jäänyt
suomennos näkyy englanninkielisenä tekstinä eikä avaimen nimenä.

Kieli vaihtuu ilman sivun latausta. Se onnistuu koska sovellus piirtää
näkymänsä muutenkin tilasta uudelleen: vaihto tarvitsee vain merkkaukseen
kirjoitettujen tekstien läpikäynnin (`data-i18n`), `Intl`-muotoilijoiden
uudelleenluonnin ja samat piirtokutsut joilla näkymät syntyvät normaalistikin.

Valinta ohjaa myös muotoiluja: kello, päiväys, tuhaterotin ja listojen
aakkosjärjestys tulevat `en-GB`- tai `fi-FI`-tunnisteesta. `en-GB` eikä `en`,
koska tässä sovelluksessa kello on 21.30 eikä 9:30 PM.

## Yhteystapa

Asetuksissa on kaksi tapaa sanoa sama asia. **Xtream Codes** kysyy palvelimen,
portin, tunnuksen ja salasanan erikseen. **M3U-osoite** ottaa yhden kentän,
johon liitetään palveluntarjoajan antama soittolistaosoite — siinä ovat samat
tunnukset kyselyparametreina, joten ne puretaan kentiksi ja yhteys muodostuu
täsmälleen samalla tavalla. Valinta vaihtaa vain lomakkeen; taustalla on
kummassakin sama rajapinta ja samat tiedot.

## Tunnusgrafiikka

Kuvake on retro-CRT-televisio sovelluksen omassa paletissa (violetti `#7c5cff`,
kuvaruutu `#22d3ee`, nupit `#ffc857`). Lähteet ovat `brand/`-kansiossa, joka on
rajattu pois julkaisupaketista.

```
brand/tv-master-1024.png        generoitu pääkuva, 1024 px, läpinäkyvä tausta
brand/tv-master-prompt.txt      kehote jolla pääkuva syntyi
brand/tv-full.png               antenneineen, käytetään kokoihin 128 ja 48
brand/tv-compact.png            ilman antenneja, kokoihin 32 ja 16
brand/store-icon-128.png        kaupan listausikoni, 96 px grafiikkaa 128 px kankaalla
brand/promo-small-440x280.png   kaupan pieni promokuva
brand/promo-marquee-1400x560.png  kaupan marquee-promokuva
brand/promo.py                  promokuvien ladonta (Pillow + SF)
```

Pienissä koissa käytetään antennitonta versiota: 16 pikselissä antennit
sulavat tummaksi tahraksi ja syövät tilaa kuvaruudulta. Promokuvien teksti
ladotaan `promo.py`:llä oikealla fontilla, koska kuvamallit kirjoittavat
kirjaimia epäluotettavasti.

Julkaisupaketti:

```
rm -f kepuli-tv-1.0.0.zip
zip -rq kepuli-tv-1.0.0.zip . \
  -x "*.DS_Store" -x "*.git*" -x "README.md" -x "FIREFOX.md" -x "LICENSE" \
  -x "store-listing.txt" -x "brand/*" -x "dev/*" -x "docs/*" \
  -x ".impeccable/*" -x "*.zip"
```

Tulos on 42 merkintää ja noin 677 kt. `*.zip` on `.gitignoressa`, joten
paketin voi rakentaa projektin juureen.

`dev/` ja `docs/` on rajattava pois: `dev/wasm/media/` on kymmeniä megatavuja
`build.sh --test`:n tekemää testiaineistoa, ja `docs/` on Pages-sivusto, ei
osa laajennusta. `.impeccable/` on työkalun asetuksia eikä `*.git*` osu siihen.

## Lisenssi

Oma koodi on MIT-lisensoitu, ks. [LICENSE](LICENSE). Hakemistossa `vendor/` on
kolmannen osapuolen koodia omilla ehdoillaan: `hls.js` ja `mpegts.js`
Apache-2.0, ja `vendor/ffaudio/` FFmpegistä käännettynä LGPL-2.1+ -ehdoin.
Käännöskomennot ovat `dev/wasm/build.sh`:ssä, jotta LGPL 2.1 §6:n vaatima
uudelleenlinkitys onnistuu.

Copyright (c) 2026 Samuli Vainio
