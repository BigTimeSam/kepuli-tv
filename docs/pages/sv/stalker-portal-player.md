---
title: Stalker-portal i webbläsaren, med din MAC-adress | Kepuli-TV
description: Titta på en Stalker-portal (MAG) i Chrome eller Firefox utan digitalbox. Kepuli-TV tar portalens adress och den MAC-adress som är registrerad på ditt abonnemang.
alt: Direktsända kanaler i Kepuli-TV, en av dem spelas bredvid listan
---

# Spelare för Stalker-portaler i webbläsaren

En leverantör som säljer sin tjänst för MAG-boxar ger en portaladress, som
ofta slutar på `/c/`, och registrerar en MAC-adress för boxen. Det finns
inget användarnamn eller lösenord. Kepuli-TV pratar med en sådan portal från
en webbläsarflik, så abonnemanget kan ses utan boxen.

## Anslut till en portal

1. Installera Kepuli-TV och klicka på ikonen i verktygsfältet.
2. Klistra in portalens adress i **Adress till prenumerationen eller
   spellistan**. En adress som slutar på `/c/` känns igen, och formuläret
   går över till **Stalker-portal (MAC-adress)**.
3. Ange den MAC-adress som är registrerad på ditt abonnemang.
4. Tryck på **Anslut** och välj **Tillåt** när webbläsaren frågar om
   Kepuli-TV får nå portalen.

> [!IMPORTANT]
> Använd bara den MAC-adress som är registrerad på ditt eget abonnemang.
> Någon annans, eller en från en delad lista, får inte användas: se
> [användarvillkoren](/terms/).

## Det här fungerar

- **Kanaler, filmer och serier** så som portalen listar dem.
- **Portalens egna programdata** i listan och i
  [programguiden](/iptv-epg-guide/).
- **Återanslutning**: en portals strömlänk gäller ofta för en enda
  anslutning, så spelaren ber om en ny varje gång en direktsänd ström
  öppnas igen.

## Det här fungerar inte än

- **Portalens arkiv** (uppspelning i efterhand) finns inte än.
- **Synkroniseringen** utelämnar ett Stalker-konto om inte **Ta med
  lösenord** är på, eftersom MAC-adressen är så gott som ett lösenord.

## Så når den portalen

En portal väntar sig en MAG-box: MAC-adressen i en kaka och en digitalbox
namn som webbläsarens. En webbsida kan inte själv ange dem, så tillägget
anger dem enbart för sina egna förfrågningar till portalens server, och
regeln försvinner när webbläsaren stängs. Detaljerna finns i
[användarhandboken](https://github.com/BigTimeSam/kepuli-tv/blob/main/docs/user-guide.md#stalker-portals) (på engelska).
