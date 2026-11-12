---
title: Stalker portal u pregledniku, s tvojom MAC adresom | Kepuli-TV
description: Gledaj Stalker (MAG) portal u Chromeu ili Firefoxu bez TV prijamnika. Kepuli-TV, reproduktor za Stalker portale, prima adresu portala i MAC adresu registriranu na tvoju pretplatu.
alt: Kanali uživo u Kepuli-TV-u, jedan od njih reproducira se pokraj popisa
---

# Reproduktor Stalker portala u pregledniku

Pružatelj koji uslugu prodaje za MAG prijamnike daje adresu portala, koja
često završava na `/c/`, i registrira MAC adresu prijamnika. Nema korisničkog
imena ni lozinke. Kepuli-TV komunicira s takvim portalom iz kartice
preglednika, pa se pretplata može gledati bez prijamnika.

## Poveži se s portalom

1. Instaliraj Kepuli-TV i klikni njegovu ikonu na alatnoj traci.
2. Zalijepi adresu portala u **Adresa pretplate ili popisa za
   reprodukciju**. Adresa koja završava na `/c/` prepoznaje se i obrazac
   prelazi na **Stalker portal (MAC adresa)**.
3. Upiši MAC adresu registriranu na tvoju pretplatu.
4. Pritisni **Poveži** i odaberi **Dopusti** kad preglednik upita smije li
   Kepuli-TV pristupiti portalu.

> [!IMPORTANT]
> Koristi samo MAC adresu registriranu na tvoju vlastitu pretplatu. Tuđa
> adresa, ili ona s dijeljenog popisa, ne smije se koristiti: vidi
> [uvjete korištenja](/terms/).

## Što radi

- **Kanali, filmovi i serije** onako kako ih portal navodi.
- **Vlastiti programski podaci portala** na popisu i u
  [TV vodiču](/iptv-epg-guide/).
- **Ponovno povezivanje**: poveznica toka s portala često vrijedi samo za
  jednu vezu, pa reproduktor traži novu svaki put kad se tok uživo ponovno
  otvori.

## Što još ne radi

- **Arhiva portala** (catch-up) još nije podržana.
- **Sinkronizacija** izostavlja Stalker račun ako nije uključeno **Uključi
  lozinke**, jer MAC adresa vrijedi koliko i lozinka.

## Kako pristupa portalu

Portal očekuje MAG prijamnik: MAC adresu u kolačiću i naziv prijamnika
umjesto naziva preglednika. Web-stranica to ne može sama postaviti, pa ih
proširenje postavlja samo za vlastite zahtjeve prema poslužitelju portala, a
pravilo nestaje kad se preglednik zatvori. Pojedinosti su u
[korisničkom priručniku](https://github.com/BigTimeSam/kepuli-tv/blob/main/docs/user-guide.md#stalker-portals) (na engleskom).
