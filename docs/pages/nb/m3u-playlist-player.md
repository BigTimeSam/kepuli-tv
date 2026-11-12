---
title: M3U-spiller i nettleseren, spilleliste fra adresse eller fil | Kepuli-TV
description: Spill av en M3U- eller M3U8-spilleliste i Chrome eller Firefox med Kepuli-TV. Lim inn adressen eller velg filen, og få grupper, logoer, XMLTV-programguide og se i etterkant.
alt: Kanalene i en spilleliste gruppert etter land i Kepuli-TV, en av dem spilles av
---

# Spiller for M3U-spillelister i nettleseren

Kepuli-TV spiller av en M3U-spilleliste i en nettleserfane. Gi den
adressen til spillelisten eller selve filen, så vises kanalene, filmene og
seriene i den som lister du kan søke i, filtrere og merke som favoritter.

## Legg til en spilleliste med adressen

1. Installer Kepuli-TV og klikk på ikonet i verktøylinjen.
2. Lim inn adressen til spillelisten i **Abonnements- eller
   spillelisteadresse**. Skjemaet starter på **Spillelisteadresse (M3U)**.
3. Trykk på **Koble til**. Nettleseren spør om Kepuli-TV får nå den
   serveren: velg **Tillat**, som bare gjelder den serveren.

En spilleliste som ikke krever innlogging, for eksempel en gratis en, skal
i det samme feltet.

## Eller velg filen

**Velg en fil…** under adressen tar en spilleliste du har på enheten:
`.m3u`, `.m3u8` eller gzip-pakket. Den leses inn i nettleseren når du
trykker på **Koble til**, og ingenting lastes ned for den. Vil du oppdatere
den, velger du filen på nytt i **Innstillinger**: kontoen, favorittene og
historikken blir værende.

## Dette leses fra spillelisten

- **Grupper, logoer og guide-ID-er** i en `m3u_plus`-liste, slik at
  kanalene kommer sortert etter land og emne.
- **Programguiden**: XMLTV-adressen spillelisten oppgir i toppteksten,
  eller en du skriver inn under **Programguide-adresse (XMLTV)**. Se
  [programguiden](/iptv-epg-guide/).
- **Se i etterkant**, der spillelisten merker arkivet til en kanal.
- **Filmer og serier** i samme liste, hver under sin egen fane.
- **En enkel liste uten grupper** som merker avsnittene sine med
  overskriftsrader («===== Sverige =====»), grupperes under de
  overskriftene.

## Når det ikke virker

- **Adressen ga ingen M3U-spilleliste.** betyr at serveren svarte med en
  nettside eller en feil i stedet: ofte en innloggingsside eller en melding
  om at kontoen er utløpt. Sjekk adressen med leverandøren din.
- Hvis spillelisten kommer fra en Xtream Codes-server, sier spilleren fra
  etter tilkoblingen og tilbyr **Koble til som Xtream Codes**, som henter
  serverens kategorier, omslag og guide. Se
  [Xtream Codes](/xtream-codes-player/).

Flere spillelister kan ligge side om side som kontoer, hver med sine egne
favoritter og sin egen historikk. Mer i [brukerveiledningen](https://github.com/BigTimeSam/kepuli-tv/blob/main/docs/user-guide.md#several-accounts) (på engelsk).
