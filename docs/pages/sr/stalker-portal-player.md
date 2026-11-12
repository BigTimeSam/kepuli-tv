---
title: Plejer za Stalker portal u pregledaču, sa MAC adresom | Kepuli-TV
description: Gledaj Stalker (MAG) portal u Chrome-u ili Firefoxu bez risivera. Kepuli-TV prima adresu portala i MAC adresu registrovanu za tvoju pretplatu.
alt: Kanali uživo u Kepuli-TV, jedan od njih se reprodukuje pored liste
---

# Plejer za Stalker portal u pregledaču

Provajder koji svoju uslugu prodaje za MAG risivere daje adresu portala,
koja se često završava na `/c/`, i registruje MAC adresu risivera.
Korisničkog imena i lozinke nema. Kepuli-TV sa takvim portalom komunicira iz
kartice pregledača, pa pretplata može da se gleda bez risivera.

## Poveži se sa portalom

1. Instaliraj Kepuli-TV i klikni na njegovu ikonicu na traci sa alatkama.
2. Nalepi adresu portala u polje **Adresa pretplate ili plejliste**.
   Adresa koja se završava na `/c/` se prepoznaje, i obrazac prelazi na
   **Stalker portal (MAC adresa)**.
3. Upiši MAC adresu registrovanu za tvoju pretplatu.
4. Pritisni **Poveži** i izaberi **Dozvoli** kada pregledač pita da li
   Kepuli-TV sme da pristupi portalu.

> [!IMPORTANT]
> Koristi samo MAC adresu registrovanu za tvoju sopstvenu pretplatu. Tuđa,
> ili ona sa deljene liste, ne sme da se koristi: pogledaj
> [uslove korišćenja](/terms/).

## Šta radi

- **Kanali, filmovi i serije** onako kako ih portal navodi.
- **Sopstveni podaci portala o programu** na listi i u
  [vodiču kroz program](/iptv-epg-guide/).
- **Ponovno povezivanje**: link strima sa portala često važi samo za jednu
  vezu, pa plejer traži novi svaki put kada se strim uživo ponovo
  otvori.

## Šta još ne radi

- **Arhiva portala** (catch-up) još nije podržana.
- **Sinhronizacija** izostavlja Stalker nalog ako nije uključeno **Uključi
  lozinke**, jer MAC adresa vredi koliko i lozinka.

## Kako pristupa portalu

Portal očekuje MAG risiver: MAC adresu u kolačiću i naziv risivera umesto
naziva pregledača. Veb-stranica to ne može sama da postavi, pa ih proširenje
postavlja samo za sopstvene zahteve ka serveru portala, a pravilo nestaje
kada se pregledač zatvori. Detalji su u
[korisničkom uputstvu](https://github.com/BigTimeSam/kepuli-tv/blob/main/docs/user-guide.md#stalker-portals) (na engleskom).
