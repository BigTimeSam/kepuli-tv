---
title: Stalker-portaalin soitin selaimessa MAC-osoitteella | Kepuli-TV
description: Katso Stalker-portaalia (MAG) Chromessa tai Firefoxissa ilman digiboksia. Kepuli-TV tarvitsee portaalin osoitteen ja tilaukseesi rekisteröidyn MAC-osoitteen.
alt: Suoria kanavia Kepuli-TV:ssä, yksi niistä toistuu listan vieressä
---

# Stalker-portaalin soitin selaimessa

Palveluntarjoaja, joka myy palveluaan MAG-bokseille, antaa portaalin
osoitteen, jonka lopussa on usein `/c/`, ja rekisteröi boksin MAC-osoitteen.
Käyttäjätunnusta tai salasanaa ei ole. Kepuli-TV keskustelee tällaisen
portaalin kanssa selaimen välilehdestä, joten tilausta voi katsoa ilman
boksia.

## Yhdistä portaaliin

1. Asenna Kepuli-TV ja napsauta sen kuvaketta työkalupalkissa.
2. Liitä portaalin osoite kenttään **Tilaus- tai soittolistaosoite**.
   Soitin tunnistaa osoitteen, jonka lopussa on `/c/`, ja lomake siirtyy
   kohtaan **Stalker-portaali (MAC-osoite)**.
3. Syötä tilaukseesi rekisteröity MAC-osoite.
4. Paina **Yhdistä** ja valitse **Salli**, kun selain kysyy, saako
   Kepuli-TV ottaa yhteyden portaaliin.

> [!IMPORTANT]
> Käytä vain omaan tilaukseesi rekisteröityä MAC-osoitetta. Toisen henkilön
> osoitetta tai jaetulta listalta poimittua osoitetta ei saa käyttää: katso
> [käyttöehdot](/terms/).

## Mikä toimii

- **Kanavat, elokuvat ja sarjat** sellaisina kuin portaali ne luettelee.
- **Portaalin omat ohjelmatiedot** listassa ja
  [ohjelmaoppaassa](/iptv-epg-guide/).
- **Uudelleenyhdistäminen**: portaalin antama lähetyslinkki kelpaa usein
  vain yhteen yhteyteen, joten soitin pyytää uuden aina, kun suora lähetys
  avataan uudelleen.

## Mikä ei vielä toimi

- **Portaalin arkisto** (jälkikatselu) ei ole vielä käytössä.
- **Synkronointi** jättää Stalker-tilin pois, ellei **Synkronoi myös
  salasanat** ole päällä, sillä MAC-osoite vastaa salasanaa.

## Miten yhteys portaaliin syntyy

Portaali odottaa MAG-boksia: MAC-osoitetta evästeessä ja digiboksin nimeä
selaimen tunnisteena. Verkkosivu ei voi asettaa niitä itse, joten laajennus
asettaa ne vain omiin pyyntöihinsä portaalin palvelimelle, ja sääntö
poistuu, kun selain suljetaan. Yksityiskohdat ovat
[käyttöoppaassa](https://github.com/BigTimeSam/kepuli-tv/blob/main/docs/user-guide.md#stalker-portals)
(englanniksi).
