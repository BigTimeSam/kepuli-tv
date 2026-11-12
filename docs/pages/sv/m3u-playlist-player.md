---
title: Spela M3U-spellistor i webbläsaren, från adress eller fil | Kepuli-TV
description: Spela en M3U- eller M3U8-spellista i Chrome eller Firefox med Kepuli-TV. Klistra in adressen eller välj filen, så får du grupper, logotyper, XMLTV-programguide och program i efterhand.
alt: En spellistas kanaler grupperade efter land i Kepuli-TV, en av dem spelas
---

# M3U-spelare i webbläsaren

Kepuli-TV spelar en M3U-spellista i en webbläsarflik. Ge den spellistans
adress eller själva filen, så visas dess kanaler, filmer och serier som
listor där du kan söka, filtrera och markera favoriter.

## Lägg till en spellista med dess adress

1. Installera Kepuli-TV och klicka på ikonen i verktygsfältet.
2. Klistra in spellistans adress i **Adress till prenumerationen eller
   spellistan**. Formuläret börjar på **Spellistans adress (M3U)**.
3. Tryck på **Anslut**. Webbläsaren frågar om Kepuli-TV får nå den servern:
   välj **Tillåt**, vilket bara gäller just den servern.

En spellista som inte kräver inloggning, till exempel en kostnadsfri, anges
i samma fält.

## Eller välj filen

**Välj en fil…** under adressen tar en spellista som du har på enheten:
`.m3u`, `.m3u8` eller gzip-komprimerad. Den läses in i webbläsaren när du
trycker på **Anslut**, och ingenting laddas ned för den. Vill du uppdatera
den väljer du filen på nytt i **Inställningar**: kontot, dess favoriter och
dess historik finns kvar.

## Det här läses från spellistan

- **Grupper, logotyper och guide-id:n** i en `m3u_plus`-lista, så att
  kanalerna kommer sorterade efter land och ämne.
- **Programguiden**: XMLTV-adressen som spellistan anger i sitt huvud, eller
  en som du anger under **Adress till programguiden (XMLTV)**. Se
  [programguiden](/iptv-epg-guide/).
- **Uppspelning i efterhand**, där spellistan markerar en kanals arkiv.
- **Filmer och serier** i samma lista, var och en under sin egen flik.
- **En enkel lista utan grupper** som markerar sina avsnitt med rubrikrader
  (”===== Sweden =====”) grupperas under de rubrikerna.

## När det inte fungerar

- **Adressen gav ingen M3U-spellista.** betyder att servern i stället
  svarade med en webbsida eller ett fel: ofta en inloggningssida eller ett
  besked om att kontot har gått ut. Kontrollera adressen med din leverantör.
- Om spellistan kommer från en Xtream Codes-server säger spelaren det efter
  anslutningen och erbjuder **Anslut som Xtream Codes**, som ger serverns
  kategorier, omslag och guide. Se
  [Xtream Codes](/xtream-codes-player/).

Flera spellistor kan finnas sida vid sida som konton, var och en med sina
egna favoriter och sin egen historik. Mer i [användarhandboken](https://github.com/BigTimeSam/kepuli-tv/blob/main/docs/user-guide.md#several-accounts) (på engelska).
