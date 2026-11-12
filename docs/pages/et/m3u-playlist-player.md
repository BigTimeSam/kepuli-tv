---
title: M3U-esitusloendi mängija brauseris, aadressi või failiga | Kepuli-TV
description: Esita M3U- või M3U8-esitusloendit Chrome'is või Firefoxis Kepuli-TV-ga. Kleebi esitusloendi aadress või vali fail ning saad rühmad, logod, XMLTV-saatekava ja järelvaatamise.
alt: Esitusloendi kanalid Kepuli-TV-s riikide kaupa rühmitatuna, üks neist mängib
---

# M3U-esitusloendi mängija brauseris

Kepuli-TV esitab M3U-esitusloendit brauseri kaardil. Anna talle
esitusloendi aadress või fail ise ning selles olevad kanalid, filmid ja
sarjad ilmuvad loenditena, kust saad otsida, filtreerida ja lemmikuid
märkida.

## Esitusloendi lisamine aadressiga

1. Paigalda Kepuli-TV ja klõpsa tööriistaribal selle ikooni.
2. Kleebi esitusloendi aadress väljale **Tellimuse või esitusloendi
   aadress**. Vormis on alguses valitud **Esitusloendi aadress (M3U)**.
3. Vajuta **Ühenda**. Brauser küsib, kas Kepuli-TV tohib selle serveriga
   ühendust võtta: vali **Luba**, see kehtib ainult selle serveri kohta.

Esitusloend, mis sisselogimist ei nõua, näiteks tasuta loend, käib samale
väljale.

## Või vali fail

**Vali fail…** aadressi all võtab esitusloendi, mis on sul seadmes:
`.m3u`, `.m3u8` või gzip-iga pakitud. See loetakse brauserisse, kui vajutad
**Ühenda**, ja selle jaoks ei laadita midagi alla. Uuendamiseks vali fail
uuesti jaotises **Seaded**: konto, selle lemmikud ja ajalugu jäävad alles.

## Mida esitusloendist loetakse

- `m3u_plus`-loendi **rühmad, logod ja saatekava tunnused**, nii et
  kanalid tulevad riigi ja teema järgi sorditult.
- **Saatekava**: XMLTV-aadress, mille esitusloend oma päises nimetab, või
  see, mille sisestad väljale **Saatekava aadress (XMLTV)**. Vaata
  [saatekava](/iptv-epg-guide/).
- **Järelvaatamine**, kui esitusloend märgib kanali arhiivi.
- **Filmid ja sarjad** samas loendis, kumbki oma vahekaardil.
- **Lihtne rühmadeta loend**, mis märgib oma jaotised pealkirjaridadega
  („===== Sweden =====“), rühmitatakse nende pealkirjade alla.

## Kui see ei tööta

- **Aadressilt ei tulnud M3U esitusloendit.** tähendab, et server vastas
  hoopis veebilehe või veaga: sageli on see sisselogimisleht või teade, et
  konto on aegunud. Kontrolli aadressi oma pakkuja juures.
- Kui esitusloend pärineb Xtream Codesi serverist, ütleb mängija seda
  pärast ühendamist ja pakub nuppu **Ühenda Xtream Codesina**, mis toob
  serveri kategooriad, kaaned ja saatekava. Vaata
  [Xtream Codes](/xtream-codes-player/).

Mitut esitusloendit saab hoida kõrvuti kontodena, igaühel oma lemmikud ja
ajalugu. Lähemalt [kasutusjuhendis](https://github.com/BigTimeSam/kepuli-tv/blob/main/docs/user-guide.md#several-accounts) (inglise keeles).
