---
title: M3U reproduktor u pregledniku: popis s adrese ili iz datoteke | Kepuli-TV
description: Reproduciraj M3U ili M3U8 popis za reprodukciju (playlistu) u Chromeu ili Firefoxu. Zalijepi adresu ili odaberi datoteku i dobivaš grupe, logotipe, XMLTV TV vodič i catch-up.
alt: Kanali popisa za reprodukciju grupirani po zemlji u Kepuli-TV-u, jedan od njih se reproducira
---

# Reproduktor M3U popisa u pregledniku

Kepuli-TV reproducira M3U popis za reprodukciju u kartici preglednika. Daj mu
adresu popisa ili samu datoteku, i kanali, filmovi i serije iz njega pojave
se kao popisi koje možeš pretraživati, filtrirati i označavati kao favorite.

## Dodaj popis za reprodukciju putem adrese

1. Instaliraj Kepuli-TV i klikni njegovu ikonu na alatnoj traci.
2. Zalijepi adresu popisa u **Adresa pretplate ili popisa za reprodukciju**.
   Obrazac počinje na **Adresa popisa za reprodukciju (M3U)**.
3. Pritisni **Poveži**. Preglednik pita smije li Kepuli-TV pristupiti tom
   poslužitelju: odaberi **Dopusti**, što vrijedi samo za taj poslužitelj.

Popis za koji ne treba prijava, primjerice besplatan, ide u isto
polje.

## Ili odaberi datoteku

**Odaberi datoteku…** ispod adrese prima popis koji imaš na uređaju:
`.m3u`, `.m3u8` ili komprimiran gzipom. Učitava se u preglednik kad pritisneš
**Poveži** i za njega se ništa ne preuzima. Da ga osvježiš, ponovno odaberi
datoteku pod **Postavke**: račun, njegovi favoriti i njegova povijest
ostaju.

## Što se čita iz popisa

- **Grupe, logotipi i oznake za vodič** popisa `m3u_plus`, pa kanali stižu
  razvrstani po zemlji i temi.
- **TV vodič**: XMLTV adresa koju popis navodi u svom zaglavlju ili ona koju
  upišeš pod **Adresa TV vodiča (XMLTV)**. Vidi
  [TV vodič](/iptv-epg-guide/).
- **Catch-up**, gdje popis označava arhivu kanala.
- **Filmovi i serije** s istog popisa, svaki u svojoj kartici.
- **Običan popis bez grupa** koji odjeljke označava naslovnim redcima
  („===== Sweden =====”) grupira se pod tim naslovima.

## Kad ne radi

- **Adresa nije vratila M3U popis za reprodukciju.** znači da je poslužitelj
  umjesto toga odgovorio web-stranicom ili pogreškom: često je to stranica
  za prijavu ili obavijest da je račun istekao. Provjeri adresu kod svog
  pružatelja.
- Ako popis dolazi s Xtream Codes poslužitelja, reproduktor to kaže nakon
  povezivanja i nudi **Poveži kao Xtream Codes**, što donosi kategorije,
  naslovnice i vodič poslužitelja. Vidi
  [Xtream Codes](/xtream-codes-player/).

Više popisa može se držati jedan uz drugi kao računi, svaki s vlastitim
favoritima i poviješću. Više u [korisničkom priručniku](https://github.com/BigTimeSam/kepuli-tv/blob/main/docs/user-guide.md#several-accounts) (na engleskom).
