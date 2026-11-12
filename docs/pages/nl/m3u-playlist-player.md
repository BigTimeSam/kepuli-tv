---
title: M3U-afspeellijst afspelen in de browser, via adres of bestand | Kepuli-TV
description: Speel een M3U- of M3U8-afspeellijst af in Chrome of Firefox met Kepuli-TV. Plak het adres of kies het bestand, en je krijgt groepen, logo’s, een XMLTV-programmagids en terugkijken.
alt: Zenders van een afspeellijst, per land gegroepeerd in Kepuli-TV, waarvan er een speelt
---

# M3U-afspeellijst afspelen in de browser

Kepuli-TV speelt een M3U-afspeellijst af in een tabblad van je browser. Geef
het adres van de afspeellijst of het bestand zelf, en de zenders, films en
series erin verschijnen als lijsten die je kunt doorzoeken, filteren en als
favoriet markeren.

## Een afspeellijst toevoegen via het adres

1. Installeer Kepuli-TV en klik op het icoon in de werkbalk.
2. Plak het adres van de afspeellijst in **Adres van het abonnement of de
   afspeellijst**. Het formulier begint op **Adres van de afspeellijst
   (M3U)**.
3. Druk op **Verbinden**. De browser vraagt of Kepuli-TV die server mag
   bereiken: kies **Toestaan**, wat alleen voor die server geldt.

Een afspeellijst waarvoor je je niet hoeft aan te melden, zoals een gratis
lijst, gaat in hetzelfde veld.

## Of kies het bestand

**Kies een bestand…** onder het adres neemt een afspeellijst die je op het
apparaat hebt staan: `.m3u`, `.m3u8` of met gzip ingepakt. Het bestand wordt
in de browser ingelezen wanneer je op **Verbinden** drukt, en er wordt niets
voor gedownload. Om het bij te werken kies je het bestand opnieuw in
**Instellingen**: het account, de favorieten en de geschiedenis blijven.

## Wat er uit de afspeellijst wordt gelezen

- **Groepen, logo’s en gids-id’s** van een `m3u_plus`-lijst, zodat de
  zenders op land en onderwerp gesorteerd binnenkomen.
- **De programmagids**: het XMLTV-adres dat de afspeellijst in de kopregel
  noemt, of een adres dat je invult onder **Adres van de programmagids
  (XMLTV)**. Zie [de programmagids](/iptv-epg-guide/).
- **Terugkijken**, waar de afspeellijst het archief van een zender aangeeft.
- **Films en series** in dezelfde lijst, elk onder een eigen tabblad.
- **Een kale lijst zonder groepen** die haar secties aangeeft met kopregels
  (“===== Sweden =====”) wordt onder die koppen gegroepeerd.

## Als het niet werkt

- **Het adres gaf geen M3U-afspeellijst.** betekent dat de server met een
  webpagina of een fout antwoordde: vaak een inlogpagina of een melding dat
  het account is verlopen. Controleer het adres bij je aanbieder.
- Komt de afspeellijst van een Xtream Codes-server, dan zegt de speler dat
  na het verbinden en biedt hij **Verbinden als Xtream Codes** aan, wat de
  categorieën, covers en gids van de server meebrengt. Zie
  [Xtream Codes](/xtream-codes-player/).

Je kunt meerdere afspeellijsten naast elkaar bewaren als accounts, elk met
eigen favorieten en geschiedenis. Meer in de [handleiding](https://github.com/BigTimeSam/kepuli-tv/blob/main/docs/user-guide.md#several-accounts) (in het Engels).
