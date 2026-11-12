---
title: Prehrávač playlistov M3U v prehliadači, z adresy či súboru | Kepuli-TV
description: Prehraj playlist M3U alebo M3U8 v Chrome či Firefoxe s Kepuli-TV. Vlož adresu playlistu alebo vyber súbor a získaš skupiny, logá, programového sprievodcu XMLTV a catch-up.
alt: Kanály z playlistu zoskupené podľa krajiny v Kepuli-TV, jeden z nich hrá
---

# Prehrávač playlistov M3U v prehliadači

Kepuli-TV prehrá playlist M3U na karte prehliadača. Daj mu adresu playlistu
alebo priamo súbor a kanály, filmy a seriály z neho sa zobrazia ako zoznamy,
v ktorých môžeš hľadať, filtrovať a označovať obľúbené.

## Pridaj playlist podľa adresy

1. Nainštaluj Kepuli-TV a klikni na jeho ikonu na paneli nástrojov.
2. Vlož adresu playlistu do poľa **Adresa predplatného alebo playlistu**.
   Formulár sa otvára na možnosti **Adresa playlistu (M3U)**.
3. Stlač **Pripojiť**. Prehliadač sa spýta, či sa Kepuli-TV smie pripojiť k
   tomuto serveru: vyber **Povoliť**, čo platí len pre tento server.

Playlist, ktorý nevyžaduje prihlásenie, napríklad bezplatný, patrí do toho
istého poľa.

## Alebo vyber súbor

**Vybrať súbor…** pod adresou prijme playlist, ktorý máš v zariadení:
`.m3u`, `.m3u8` alebo komprimovaný gzipom. Do prehliadača sa načíta, keď
stlačíš **Pripojiť**, a nič sa preň nesťahuje. Ak ho chceš aktualizovať,
vyber súbor znova v časti **Nastavenia**: účet, jeho obľúbené aj história
zostanú.

## Čo sa z playlistu načíta

- **Skupiny, logá a identifikátory sprievodcu** zo zoznamu `m3u_plus`,
  takže kanály prídu zoradené podľa krajiny a témy.
- **Programový sprievodca**: adresa XMLTV, ktorú playlist uvádza vo svojej
  hlavičke, alebo tá, ktorú zadáš do poľa **Adresa programového sprievodcu
  (XMLTV)**. Pozri [programového sprievodcu](/iptv-epg-guide/).
- **Catch-up** tam, kde playlist označuje archív kanála.
- **Filmy a seriály** v tom istom zozname, každé na vlastnej karte.
- **Jednoduchý zoznam bez skupín**, ktorý svoje časti označuje riadkami s
  nadpisom („===== Sweden =====“), sa zoskupí pod tieto nadpisy.

## Keď to nefunguje

- **Adresa nevrátila playlist M3U.** znamená, že server namiesto neho
  odpovedal webovou stránkou alebo chybou: často je to prihlasovacia
  stránka alebo oznam, že účet vypršal. Over si adresu u poskytovateľa.
- Ak playlist pochádza zo servera Xtream Codes, prehrávač to po pripojení
  oznámi a ponúkne **Pripojiť ako Xtream Codes**, čo prinesie kategórie,
  obaly a sprievodcu zo servera. Pozri
  [Xtream Codes](/xtream-codes-player/).

Viac playlistov môžeš mať vedľa seba ako účty, každý s vlastnými obľúbenými
a históriou. Viac v [používateľskej príručke](https://github.com/BigTimeSam/kepuli-tv/blob/main/docs/user-guide.md#several-accounts) (po anglicky).
