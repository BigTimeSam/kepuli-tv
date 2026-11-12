---
title: Stalker-portal kijken in de browser, met je MAC-adres | Kepuli-TV
description: Kijk een Stalker-portal (MAG) in Chrome of Firefox zonder settopbox. Kepuli-TV gebruikt het adres van de portal en het MAC-adres dat bij je abonnement is geregistreerd.
alt: Live zenders in Kepuli-TV, waarvan er een naast de lijst speelt
---

# Stalker-portal kijken in de browser

Een aanbieder die zijn dienst voor MAG-settopboxen verkoopt, geeft een
portaladres, dat vaak eindigt op `/c/`, en registreert een MAC-adres voor
de box. Er is geen gebruikersnaam of wachtwoord. Kepuli-TV praat met zo’n
portal vanuit een tabblad van de browser, zodat je het abonnement zonder de
box kunt kijken.

## Verbinden met een portal

1. Installeer Kepuli-TV en klik op het icoon in de werkbalk.
2. Plak het adres van de portal in **Adres van het abonnement of de
   afspeellijst**. Een adres dat eindigt op `/c/` wordt herkend, en het
   formulier gaat naar **Stalker-portal (MAC-adres)**.
3. Vul het MAC-adres in dat bij je abonnement is geregistreerd.
4. Druk op **Verbinden** en kies **Toestaan** wanneer de browser vraagt of
   Kepuli-TV de portal mag bereiken.

> [!IMPORTANT]
> Gebruik alleen het MAC-adres dat bij je eigen abonnement is geregistreerd.
> Dat van iemand anders, of een uit een gedeelde lijst, mag niet worden
> gebruikt: zie de [gebruiksvoorwaarden](/terms/).

## Wat werkt

- **Zenders, films en series** zoals de portal ze opsomt.
- **De eigen programmagegevens van de portal** in de lijst en in
  [de programmagids](/iptv-epg-guide/).
- **Opnieuw verbinden**: de streamlink van een portal is vaak maar voor één
  verbinding geldig, dus vraagt de speler een nieuwe aan telkens wanneer
  een livestream opnieuw wordt geopend.

## Wat nog niet werkt

- **Het archief van de portal** (terugkijken) is er nog niet.
- **Synchronisatie** slaat een Stalker-account over tenzij **Wachtwoorden
  meenemen** aan staat, omdat het MAC-adres zo goed als een wachtwoord is.

## Hoe het de portal bereikt

Een portal verwacht een MAG-box: het MAC-adres in een cookie en de naam van
een settopbox als die van de browser. Een webpagina kan die niet zelf
instellen, dus stelt de extensie ze in voor alleen haar eigen verzoeken aan
de server van de portal, en de regel is weg wanneer de browser sluit. De
details staan in de
[handleiding](https://github.com/BigTimeSam/kepuli-tv/blob/main/docs/user-guide.md#stalker-portals)
(in het Engels).
