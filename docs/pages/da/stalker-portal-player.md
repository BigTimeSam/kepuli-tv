---
title: Stalker-portal i browseren med din MAC-adresse | Kepuli-TV
description: Se en Stalker-portal (MAG) i Chrome eller Firefox uden en tv-boks. Kepuli-TV tager portalens adresse og den MAC-adresse, der er registreret på dit abonnement.
alt: Live-kanaler i Kepuli-TV, en af dem afspilles ved siden af listen
---

# Afspiller til Stalker-portaler i browseren

En udbyder, der sælger sin tjeneste til MAG-bokse, giver en portaladresse,
der ofte ender på `/c/`, og registrerer en MAC-adresse for boksen. Der er
hverken brugernavn eller adgangskode. Kepuli-TV taler med sådan en portal
fra en browserfane, så abonnementet kan ses uden boksen.

## Opret forbindelse til en portal

1. Installér Kepuli-TV, og klik på ikonet på værktøjslinjen.
2. Indsæt portalens adresse i **Abonnements- eller
   afspilningslisteadresse**. En adresse, der ender på `/c/`, genkendes, og
   formularen skifter til **Stalker-portal (MAC-adresse)**.
3. Indtast den MAC-adresse, der er registreret på dit abonnement.
4. Tryk på **Opret forbindelse**, og vælg **Tillad**, når browseren spørger,
   om Kepuli-TV må nå portalen.

> [!IMPORTANT]
> Brug kun den MAC-adresse, der er registreret på dit eget abonnement. En
> andens, eller en fra en delt liste, må ikke bruges: se
> [vilkårene for brug](/terms/).

## Det, der virker

- **Kanaler, film og serier**, som portalen oplister dem.
- **Portalens egne programdata** på listen og i
  [programguiden](/iptv-epg-guide/).
- **Genoprettelse af forbindelsen**: en portals streamlink gælder ofte kun
  til én forbindelse, så afspilleren beder om et nyt, hver gang en
  live-stream åbnes igen.

## Det, der ikke virker endnu

- **Portalens arkiv** (genafspilning) er der ikke endnu.
- **Synkronisering** udelader en Stalker-konto, medmindre **Medtag
  adgangskoder** er slået til, da MAC-adressen er lige så god som en
  adgangskode.

## Sådan når den portalen

En portal forventer en MAG-boks: MAC-adressen i en cookie og en tv-boks'
navn som browserens. En webside kan ikke selv sætte dem, så udvidelsen
sætter dem kun for sine egne forespørgsler til portalens server, og reglen
er væk, når browseren lukkes. Detaljerne står i
[brugervejledningen](https://github.com/BigTimeSam/kepuli-tv/blob/main/docs/user-guide.md#stalker-portals) (på engelsk).
