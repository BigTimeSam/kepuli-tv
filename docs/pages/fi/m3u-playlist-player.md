---
title: M3U-soittolistan soitin selaimessa, osoite tai tiedosto | Kepuli-TV
description: Toista M3U- tai M3U8-soittolista Chromessa tai Firefoxissa Kepuli-TV:llä. Liitä soittolistan osoite tai valitse tiedosto, niin saat ryhmät, logot, XMLTV-ohjelmaoppaan ja jälkikatselun.
alt: Soittolistan kanavat maittain ryhmiteltyinä Kepuli-TV:ssä, yksi niistä toistuu
---

# M3U-soittolistan soitin selaimessa

Kepuli-TV toistaa M3U-soittolistan selaimen välilehdessä. Anna sille
soittolistan osoite tai itse tiedosto, niin listan kanavat, elokuvat ja
sarjat ilmestyvät luetteloiksi, joista voit hakea, joita voit suodattaa ja
joista voit merkitä suosikkeja.

## Lisää soittolista osoitteella

1. Asenna Kepuli-TV ja napsauta sen kuvaketta työkalupalkissa.
2. Liitä soittolistan osoite kenttään **Tilaus- tai soittolistaosoite**.
   Lomakkeessa on aluksi valittuna **Soittolistan osoite (M3U)**.
3. Paina **Yhdistä**. Selain kysyy, saako Kepuli-TV ottaa yhteyden
   kyseiseen palvelimeen: valitse **Salli**. Lupa koskee vain sitä
   palvelinta.

Samaan kenttään käy myös soittolista, joka ei vaadi kirjautumista,
esimerkiksi ilmainen lista.

## Tai valitse tiedosto

Osoitteen alla oleva **Valitse tiedosto…** ottaa soittolistan, joka sinulla
on laitteellasi: `.m3u`, `.m3u8` tai gzip-pakattu. Tiedosto luetaan
selaimeen, kun painat **Yhdistä**, eikä sitä varten ladata mitään. Kun
haluat päivittää listan, valitse tiedosto uudelleen kohdassa **Asetukset**:
tili, sen suosikit ja historia säilyvät.

## Mitä soittolistasta luetaan

- `m3u_plus`-listan **ryhmät, logot ja opastunnisteet**, joten kanavat
  tulevat valmiiksi maittain ja aiheittain lajiteltuina.
- **Ohjelmaopas**: XMLTV-osoite, jonka soittolista nimeää otsakkeessaan, tai
  osoite, jonka syötät kohtaan **Ohjelmaoppaan osoite (XMLTV)**. Katso
  [ohjelmaopas](/iptv-epg-guide/).
- **Jälkikatselu** niillä kanavilla, joille soittolista merkitsee arkiston.
- Samassa listassa olevat **elokuvat ja sarjat**, kumpikin omalle
  välilehdelleen.
- **Ryhmätön lista**, joka merkitsee osionsa otsikkoriveillä
  (”===== Sweden =====”), ryhmitellään näiden otsikoiden alle.

## Kun se ei toimi

- **Osoitteesta ei tullut M3U-soittolistaa.** tarkoittaa, että palvelin
  vastasi verkkosivulla tai virheellä: usein kirjautumissivulla tai
  ilmoituksella, että tili on umpeutunut. Tarkista osoite
  palveluntarjoajaltasi.
- Jos soittolista tulee Xtream Codes -palvelimelta, soitin kertoo sen
  yhdistämisen jälkeen ja tarjoaa vaihtoehtoa **Yhdistä Xtream Codesina**,
  jolloin saat palvelimen kategoriat, kannet ja oppaan. Katso
  [Xtream Codes](/xtream-codes-player/).

Useita soittolistoja voi pitää rinnakkain omina tileinään, ja jokaisella on
omat suosikkinsa ja historiansa. Lisää [käyttöoppaassa](https://github.com/BigTimeSam/kepuli-tv/blob/main/docs/user-guide.md#several-accounts) (englanniksi).
