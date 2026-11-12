---
title: M3U-afspiller i browseren, med adresse eller fil | Kepuli-TV
description: Afspil en M3U- eller M3U8-afspilningsliste i Chrome eller Firefox med Kepuli-TV. Indsæt listens adresse eller vælg filen, og få grupper, logoer, XMLTV-programguide og genafspilning.
alt: En afspilningslistes kanaler grupperet efter land i Kepuli-TV, en af dem afspilles
---

# M3U-afspiller til afspilningslister i browseren

Kepuli-TV afspiller en M3U-afspilningsliste i en browserfane. Giv den
listens adresse eller selve filen, så vises listens kanaler, film og serier
som lister, du kan søge i, filtrere og markere som favoritter.

## Tilføj en afspilningsliste med dens adresse

1. Installér Kepuli-TV, og klik på ikonet på værktøjslinjen.
2. Indsæt afspilningslistens adresse i **Abonnements- eller
   afspilningslisteadresse**. Formularen starter på **Afspilningslistens
   adresse (M3U)**.
3. Tryk på **Opret forbindelse**. Browseren spørger, om Kepuli-TV må nå den
   server: vælg **Tillad**, som kun gælder den server.

En afspilningsliste, der ikke kræver login, for eksempel en gratis, skal i
det samme felt.

## Eller vælg filen

**Vælg en fil…** under adressen tager en afspilningsliste, du har på
enheden: `.m3u`, `.m3u8` eller gzip-komprimeret. Den læses ind i browseren,
når du trykker på **Opret forbindelse**, og intet downloades til det. Vil du
opdatere den, vælger du filen igen i **Indstillinger**: kontoen, dens
favoritter og dens historik bliver.

## Det, der læses fra afspilningslisten

- **Grupper, logoer og guide-id'er** i en `m3u_plus`-liste, så kanalerne
  kommer sorteret efter land og emne.
- **Programguiden**: den XMLTV-adresse, afspilningslisten angiver i sit
  hoved, eller en, du indtaster under **Programguide-adresse (XMLTV)**. Se
  [programguiden](/iptv-epg-guide/).
- **Genafspilning**, hvor afspilningslisten markerer en kanals arkiv.
- **Film og serier** i samme liste, hver under sin egen fane.
- **En enkel liste uden grupper**, der markerer sine afsnit med
  overskriftsrækker (»===== Sweden =====«), grupperes under de overskrifter.

## Når det ikke virker

- **Adressen gav ingen M3U-afspilningsliste.** betyder, at serveren i stedet
  svarede med en webside eller en fejl: ofte en loginside eller en besked
  om, at kontoen er udløbet. Tjek adressen hos din udbyder.
- Kommer afspilningslisten fra en Xtream Codes-server, siger afspilleren
  det, når den har oprettet forbindelse, og tilbyder **Forbind som Xtream
  Codes**, som giver serverens kategorier, covers og guide. Se
  [Xtream Codes](/xtream-codes-player/).

Flere afspilningslister kan ligge side om side som konti, hver med sine egne
favoritter og sin egen historik. Mere i [brugervejledningen](https://github.com/BigTimeSam/kepuli-tv/blob/main/docs/user-guide.md#several-accounts) (på engelsk).
