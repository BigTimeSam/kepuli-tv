---
title: Stalkeri portaali mängija brauseris, sinu MAC-aadressiga | Kepuli-TV
description: Vaata Stalkeri (MAG) portaali Chrome'is või Firefoxis ilma digiboksita. Kepuli-TV-le piisab portaali aadressist ja sinu tellimusele registreeritud MAC-aadressist.
alt: Otsekanalid Kepuli-TV-s, üks neist mängib loendi kõrval
---

# Stalkeri portaali mängija brauseris

Pakkuja, kes müüb oma teenust MAG-digiboksidele, annab portaali aadressi,
mille lõpus on sageli `/c/`, ja registreerib digiboksi MAC-aadressi.
Kasutajanime ega parooli ei ole. Kepuli-TV suhtleb sellise portaaliga
brauseri kaardilt, nii et tellimust saab vaadata ilma digiboksita.

## Portaaliga ühendamine

1. Paigalda Kepuli-TV ja klõpsa tööriistaribal selle ikooni.
2. Kleebi portaali aadress väljale **Tellimuse või esitusloendi aadress**.
   Aadress, mille lõpus on `/c/`, tuntakse ära ja vorm lülitub valikule
   **Stalker-portaal (MAC-aadress)**.
3. Sisesta oma tellimusele registreeritud MAC-aadress.
4. Vajuta **Ühenda** ja vali **Luba**, kui brauser küsib, kas Kepuli-TV
   tohib portaaliga ühendust võtta.

> [!IMPORTANT]
> Kasuta ainult oma tellimusele registreeritud MAC-aadressi. Teise inimese
> oma või jagatud loendist võetut kasutada ei tohi: vaata
> [kasutustingimusi](/terms/).

## Mis töötab

- **Kanalid, filmid ja sarjad** nii, nagu portaal neid loetleb.
- **Portaali enda saateandmed** loendis ja
  [saatekavas](/iptv-epg-guide/).
- **Uuesti ühendamine**: portaali voolink kehtib sageli ainult üheks
  ühenduseks, seega küsib mängija uue iga kord, kui otsevoog uuesti
  avatakse.

## Mis veel ei tööta

- **Portaali arhiivi** (järelvaatamist) veel ei ole.
- **Sünkroonimine** jätab Stalkeri konto välja, kui **Kaasa paroolid**
  pole sisse lülitatud, sest MAC-aadress on sama hea kui parool.

## Kuidas see portaalini jõuab

Portaal ootab MAG-digiboksi: MAC-aadressi küpsises ja digiboksi nime
brauseri nimena. Veebileht neid ise määrata ei saa, seega määrab laiendus
need ainult omaenda päringutele portaali serverisse ja reegel kaob, kui
brauser sulgub. Üksikasjad on
[kasutusjuhendis](https://github.com/BigTimeSam/kepuli-tv/blob/main/docs/user-guide.md#stalker-portals) (inglise keeles).
