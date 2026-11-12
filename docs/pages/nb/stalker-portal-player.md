---
title: Stalker-portal i nettleseren, med MAC-adressen din | Kepuli-TV
description: Se en Stalker-portal (MAG) i Chrome eller Firefox uten TV-boks. Kepuli-TV tar portaladressen og MAC-adressen som er registrert på abonnementet ditt.
alt: Direktekanaler i Kepuli-TV, en av dem spilles av ved siden av listen
---

# Spiller for Stalker-portaler i nettleseren

En leverandør som selger tjenesten sin til MAG-bokser, gir deg en
portaladresse, som ofte slutter på `/c/`, og registrerer en MAC-adresse for
boksen. Det finnes ikke noe brukernavn eller passord. Kepuli-TV snakker med
en slik portal fra en nettleserfane, så du kan se abonnementet uten boksen.

## Koble til en portal

1. Installer Kepuli-TV og klikk på ikonet i verktøylinjen.
2. Lim inn adressen til portalen i **Abonnements- eller
   spillelisteadresse**. En adresse som slutter på `/c/`, gjenkjennes, og
   skjemaet går til **Stalker-portal (MAC-adresse)**.
3. Skriv inn MAC-adressen som er registrert på abonnementet ditt.
4. Trykk på **Koble til** og velg **Tillat** når nettleseren spør om
   Kepuli-TV får nå portalen.

> [!IMPORTANT]
> Bruk bare MAC-adressen som er registrert på ditt eget abonnement. En
> annen persons, eller en fra en delt liste, kan ikke brukes: se
> [vilkårene for bruk](/terms/).

## Dette virker

- **Kanaler, filmer og serier** slik portalen lister dem opp.
- **Portalens egne programdata** i listen og i
  [programguiden](/iptv-epg-guide/).
- **Ny tilkobling**: strømlenken fra en portal gjelder ofte bare for én
  tilkobling, så spilleren ber om en ny hver gang en direktestrøm åpnes på
  nytt.

## Dette virker ikke ennå

- **Portalens arkiv** (se i etterkant) er ikke på plass ennå.
- **Synkronisering** utelater en Stalker-konto med mindre **Ta med
  passord** er på, siden MAC-adressen er like god som et passord.

## Slik når den portalen

En portal venter seg en MAG-boks: MAC-adressen i en informasjonskapsel og
navnet på en TV-boks som nettleserens navn. En nettside kan ikke sette dette
selv, så utvidelsen setter det bare for sine egne forespørsler til
portalens server, og regelen er borte når nettleseren lukkes. Detaljene står
i [brukerveiledningen](https://github.com/BigTimeSam/kepuli-tv/blob/main/docs/user-guide.md#stalker-portals)
(på engelsk).
