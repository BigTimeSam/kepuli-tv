---
title: Plejer za M3U plejliste u pregledaču, adresa ili datoteka | Kepuli-TV
description: Pusti M3U ili M3U8 plejlistu u Chrome-u ili Firefoxu uz Kepuli-TV. Nalepi adresu plejliste ili izaberi datoteku i dobijaš grupe, logotipe, XMLTV vodič kroz program i catch-up.
alt: Kanali plejliste grupisani po zemlji u Kepuli-TV, jedan od njih se reprodukuje
---

# Plejer za M3U plejliste u pregledaču

Kepuli-TV pušta M3U plejlistu u kartici pregledača. Daj mu adresu plejliste
ili samu datoteku, i kanali, filmovi i serije iz nje pojavljuju se kao liste
koje možeš da pretražuješ, filtriraš i označavaš kao omiljene.

## Dodaj plejlistu preko adrese

1. Instaliraj Kepuli-TV i klikni na njegovu ikonicu na traci sa alatkama.
2. Nalepi adresu plejliste u polje **Adresa pretplate ili plejliste**.
   Obrazac počinje na **Adresa plejliste (M3U)**.
3. Pritisni **Poveži**. Pregledač pita da li Kepuli-TV sme da pristupi tom
   serveru: izaberi **Dozvoli**, što važi samo za taj server.

Plejlista za koju ne treba prijava, na primer besplatna, ide u isto
polje.

## Ili izaberi datoteku

**Izaberi datoteku…** ispod adrese prima plejlistu koju imaš na uređaju:
`.m3u`, `.m3u8` ili gzip-ovanu. Učitava se u pregledač kada pritisneš
**Poveži**, i ništa se za nju ne preuzima. Da je osvežiš, izaberi datoteku
ponovo u **Podešavanjima**: nalog, njegovo omiljeno i njegova istorija
ostaju.

## Šta se čita iz plejliste

- **Grupe, logotipi i identifikatori vodiča** iz `m3u_plus` liste, pa
  kanali stižu razvrstani po zemlji i temi.
- **Vodič kroz program**: XMLTV adresa koju plejlista navodi u svom
  zaglavlju, ili ona koju upišeš u polje **Adresa vodiča kroz program
  (XMLTV)**. Vidi [vodič kroz program](/iptv-epg-guide/).
- **Catch-up**, tamo gde plejlista označava arhivu kanala.
- **Filmovi i serije** sa iste liste, svako u svojoj kartici.
- **Obična lista bez grupa** koja svoje odeljke označava naslovnim redovima
  („===== Sweden =====”) grupiše se pod tim naslovima.

## Kada ne radi

- **Adresa nije vratila M3U plejlistu.** znači da je server umesto nje
  odgovorio veb-stranicom ili greškom: često je to stranica za prijavu ili
  obaveštenje da je nalog istekao. Proveri adresu kod svog provajdera.
- Ako plejlista dolazi sa Xtream Codes servera, plejer to kaže posle
  povezivanja i nudi **Poveži kao Xtream Codes**, što donosi kategorije,
  omote i vodič sa servera. Vidi
  [Xtream Codes](/xtream-codes-player/).

Više plejlista može da stoji jedna pored druge kao nalozi, svaka sa svojim
omiljenim i istorijom. Više u [korisničkom uputstvu](https://github.com/BigTimeSam/kepuli-tv/blob/main/docs/user-guide.md#several-accounts) (na engleskom).
