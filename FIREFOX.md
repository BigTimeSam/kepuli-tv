# Firefox-versio

Selvitys siitä mitä Kepuli-TV:n kääntäminen Firefox-laajennukseksi vaatisi ja
kannattaako molempia ylläpitää yhdestä koodipohjasta.

**Lyhyt vastaus:** kannattaa, ja yhdellä koodipohjalla. Laajennuksen
selainriippuvuus on 15 kutsua kolmessa tiedostossa. Kaikki muu — soitin,
listat, opas, välimuisti, purku — on tavallista web-koodia joka ei tiedä
mitään laajennusrajapinnoista.

Ne MV3:n alueet joilla Chrome ja Firefox oikeasti eroavat ovat
sisältöskriptit, `webRequest` ja `declarativeNetRequest`. Kepuli-TV ei käytä
niistä yhtäkään.

## Mitä koodissa on selainkohtaista

| Tiedosto | Kutsut | Firefoxissa |
| --- | --- | --- |
| `js/config.js` | `storage.local.get/set` × 9 | toimii, ks. nimiavaruus |
| `js/permissions.js` | `permissions.contains/request` × 3 | toimii (Fx 55+) |
| `background.js` | `runtime.getURL`, `runtime.getContexts`, `tabs.update`, `tabs.create`, `windows.update`, `action.onClicked` | toimii (`getContexts` Fx 127+) |

Ei sisältöskriptejä, ei `webRequest`iä, ei `declarativeNetRequest`iä, ei
`scripting`ia, ei viestintää sivun ja taustan välillä. `player.html` on
tavallinen sivu joka sattuu asumaan laajennuksen originissa.

## Viisi muutosta

### 1. Nimiavaruuden shim

Firefoxissa lupauksia palauttava nimiavaruus on `browser`. `chrome` on
olemassa yhteensopivuusaliaksena, mutta callback-tyylisenä — eli
`await chrome.storage.local.get(key)` palauttaisi `undefined`in eikä dataa.
Vika olisi hiljainen: asetukset vain katoaisivat.

Uusi `js/browser.js`:

```js
// Chrome tuntee vain chromen (browser tuli vasta 148:aan), Firefox
// molemmat mutta lupaukset vain browserissa. Alias ratkaisee kummankin.
export const api = globalThis.browser ?? globalThis.chrome;
```

Sitten `config.js`, `permissions.js` ja `background.js` käyttävät `api`a
`chrome`n sijaan. `background.js` ei ole moduuli, joten sinne riittää sama
rivi suoraan tiedoston alkuun.

Tämä on koko työn ainoa varsinainen koodimuutos.

### 2. Taustaskripti manifestiin

Firefox ei toteuta `background.service_worker`ia lainkaan. Se käyttää
tapahtumasivua eli `background.scripts`-avainta. Sama manifest voi kantaa
molemmat: Firefox jättää `service_worker`in huomiotta ja Chrome 121:stä
alkaen `scripts`in.

```json
"background": {
  "service_worker": "background.js",
  "scripts": ["background.js"]
}
```

**Reunaehto:** Chrome 116–120 ei jätä `scripts`ia huomiotta vaan
kieltäytyy lataamasta koko laajennusta. Manifestissa lukee nyt
`"minimum_chrome_version": "116"`, joten se pitää nostaa 121:een — tai
manifesteja tulee kaksi. Chrome 121 on tammikuulta 2024, joten nosto on
halpa ja pitää projektin lupauksen käännösvaiheettomuudesta.

### 3. `browser_specific_settings`

```json
"browser_specific_settings": {
  "gecko": {
    "id": "kepuli-tv@bigtimesam.github.io",
    "strict_min_version": "128.0"
  }
}
```

`id` on pakollinen AMO:ssa ja se sitoo tallennustilan laajennukseen.
Vähimmäisversion 128 sanelee `optional_host_permissions`, joka tuli
Firefoxiin vasta silloin. Muut käytetyt rajapinnat ovat vanhempia:
`runtime.getContexts` 127, `action` 109, `unlimitedStorage` 56,
`permissions.request` 55.

Chrome ei tunne avainta mutta ei myöskään kaadu siihen — tuntemattomat
manifest-avaimet ovat varoitus, eivät virhe. Sama pätee toisin päin
`minimum_chrome_version`iin Firefoxissa.

### 4. Sanamuodot

Kymmenkunta virheilmoitusta ja työkaluvihjettä puhuu Chromesta nimeltä:

```
js/probe.js    "Videokoodekkia %s ei voi purkaa Chromessa."
               "Ääniraita on %s, jota Chrome ei pura."
               "sisältö kelpaa Chromelle, mutta kontin purku puuttuu"
js/rows.js     "Pääte ei lupaa toistoa Chromessa"
js/xtream.js   kommentti natiivisti toistuvista päätteistä
js/app.js      "Chrome ei myöntänyt oikeutta"
```

Päätöslogiikka itsessään on jo selainriippumaton: `probe.js` kysyy
`MediaSource.isTypeSupported`ilta eikä oleta mitään. Vain tekstit
muuttuvat, "Chrome" → "selain".

Yksi kova lista jää: `js/xtream.js:isNativelyPlayable` luettelee päätteet
`mp4|m4v|mov|webm|ogv`. Firefox toistaa saman joukon. Sivuhuomio: `ogv` on
listassa Chromen osalta vanhentunut, Chrome pudotti Theoran versiossa 123.

### 5. Kehityssilmukka

`dev/dev.mjs` puhuu Chromen DevTools-protokollaa, eikä sitä voi kääntää.
Firefoxille vastaava on Mozillan oma `web-ext`:

```
npx web-ext run --source-dir=. --start-url=about:debugging
```

Se lataa laajennuksen väliaikaisesti, avaa oman profiilin ja lataa
muutoksista uudelleen — sama työnkulku, valmiina. Riippuvuus on `npx`in
takana, ei projektissa. `dev.mjs` jää Chromelle.

## Mitä ei tarvitse muuttaa

- **Toistomoottorit.** mpegts.js ilmoittaa tueksi Firefox 42+, hls.js toimii
  Firefoxissa. Kumpikaan ei nojaa Chromen erikoisuuksiin: molemmat purkavat
  virran fMP4:ksi ja syöttävät sen MediaSourcelle, mikä on juuri se reitti
  jota Firefox tukee.
- **CSP ja paikalliset vendor-tiedostot.** Firefoxin MV3-CSP kieltää
  etäskriptit samoin kuin Chromen, ja kirjastot ovat jo paikallisina.
  Ääniraidan purku vaatii manifestiin `'wasm-unsafe-eval'`-lähteen, jonka
  Firefox hyväksyy samalla avaimella kuin Chrome — sama merkkijono siis
  kelpaa molemmille.
- **IndexedDB, `<video>`, MSE, Range-pyynnöt.** Samat rajapinnat.
- **Valinnaiset host-oikeudet.** Firefoxin MV3:ssa host-oikeudet ovat
  lähtökohtaisesti valinnaisia ja käyttäjän myönnettäviä, eli sovelluksen
  nykyinen malli — kysy oikeus vasta kun käyttäjä antaa palvelimensa — on
  siellä pikemminkin normi kuin poikkeus.

## Ainoa oikea riski: `js/remux.js`

MKV:n purku fMP4:ksi on koko projektin selainherkin kohta. Chrome ja Firefox
hyväksyvät `SourceBuffer`iin eri asioita: kummallakin on omat vaatimuksensa
mm. `avcC`-parametrijoukkojen sijainnista, `moof`-otsikoiden
aikaleimoista ja `changeType`in käytöstä. Koodi joka kelpaa toiselle voi
kaatua toisessa `InvalidStateError`iin ilman muuta selitystä.

Tämä ei ole syy jättää Firefoxia tekemättä, mutta se on syy varata sille
oma testikierros. Kaikki muu on käännettävissä sokkona; tämä ei.

## Julkaisu AMO:hon

- **Allekirjoitus on pakollinen.** Julkaisu-Firefox ei asenna
  allekirjoittamatonta laajennusta pysyvästi. Allekirjoituksen saa AMO:sta
  myös ilman julkista listausta (self-distribution).
- **Minifioitu koodi.** AMO vaatii lähdekoodin toimittamisen silloin kun
  *sinä* minifioit tai niputat. `vendor/hls.js` ja `vendor/mpegts.js` ovat
  kirjastojen omia julkaisutiedostoja, joita koskee erillinen kolmannen
  osapuolen kirjastojen politiikka: käytä virallista julkaisua
  muuttamattomana ja kerro versio ja alkuperä, niin tarkastaja voi verrata
  sen alkuperäiseen. Kannattaa lisätä `vendor/README` jossa lukee versio ja
  latausosoite.
- **`vendor/ffaudio` on eri tapaus.** Se ei ole kirjaston oma julkaisu vaan
  meidän käännöksemme FFmpegistä, joten siihen pätee nimenomaan se kohta
  joka vaatii lähdekoodin ja käännösohjeet. Ne ovat valmiina:
  `dev/wasm/build.sh` sisältää koko komentosarjan, `dev/wasm/ffaudio.c` on
  ainoa oma lähdetiedosto, ja `vendor/ffaudio/LICENSE` kertoo FFmpegin tagin
  ja LGPL 2.1 §6:n edellyttämän vaihdettavuuden.
- **Tarkistus on ihmisen tekemä** ja hitaampi kuin Chromen, mutta
  laajennus ei pyydä asennuksessa mitään oikeuksia eikä koske selattaviin
  sivuihin, joten se on tarkastajan kannalta helppo tapaus.

## Rakenne-ehdotus

Yksi manifest, ei käännösvaihetta, ei ehtolauseita koodissa:

```
manifest.json      molemmat taustaskriptiavaimet + browser_specific_settings
js/browser.js      api = browser ?? chrome            ← uusi
dev/dev.mjs        Chromen silmukka
                   Firefoxille: npx web-ext run
```

Vaihtoehto olisi kaksi manifestia ja pieni `build.mjs` joka valitsee
oikean. Se olisi siistimpi mutta rikkoisi projektin lupauksen siitä, että
tiedostot ovat sellaisenaan sitä mitä selain ajaa. Yhden manifestin haitta
on kaksi kosmeettista varoitusta, yksi kummassakin selaimessa.

## Työmäärä

| Vaihe | Arvio |
| --- | --- |
| Shim, manifest, sanamuodot | 1–2 h |
| Läpikäynti Firefoxissa: listat, opas, EPG, live-toisto | 1–2 h |
| `remux.js` Firefoxissa | tuntematon, 0 h – useita päiviä |
| Ensimmäinen AMO-julkaisu | 2–3 h |

Ylläpito sen jälkeen on käytännössä ilmaista: uudet ominaisuudet kirjoitetaan
soittimeen, ei laajennuskuoreen, eikä kuori enää muutu.

## Bonus: Firefox Androidille

Firefox on ainoa mobiiliselain joka ajaa laajennuksia. Sama paketti asentuu
sinne, jos `browser_specific_settings.gecko_android`
`strict_min_version`ineen lisätään. Käyttöliittymä on suunniteltu työpöydälle
eikä kelpaisi sellaisenaan, mutta reitti on olemassa — Chromelle ei ole.
