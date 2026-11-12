---
title: Player de portal Stalker în browser, cu adresa ta MAC | Kepuli-TV
description: Urmărește un portal Stalker (MAG) în Chrome sau Firefox, fără set-top box. Kepuli-TV primește adresa portalului și adresa MAC înregistrată pe abonamentul tău.
alt: Canale în direct în Kepuli-TV, unul dintre ele fiind redat lângă listă
---

# Player de portal Stalker în browser

Un furnizor care își vinde serviciul pentru set-top boxuri MAG dă o adresă
de portal, care se termină adesea în `/c/`, și înregistrează o adresă MAC
pentru aparat. Nu există nume de utilizator sau parolă. Kepuli-TV vorbește
cu un astfel de portal dintr-o filă de browser, așa că abonamentul poate fi
urmărit fără aparat.

## Conectează-te la un portal

1. Instalează Kepuli-TV și dă clic pe pictograma lui din bara de
   instrumente.
2. Lipește adresa portalului în **Adresa abonamentului sau a
   playlistului**. O adresă care se termină în `/c/` este recunoscută, iar
   formularul trece la **Portal Stalker (adresă MAC)**.
3. Introdu adresa MAC înregistrată pe abonamentul tău.
4. Apasă **Conectează** și alege **Permite** când browserul întreabă dacă
   Kepuli-TV poate accesa portalul.

> [!IMPORTANT]
> Folosește doar adresa MAC înregistrată pe propriul tău abonament. Adresa
> altcuiva sau una dintr-o listă partajată nu poate fi folosită: vezi
> [condițiile de utilizare](/terms/).

## Ce merge

- **Canale, filme și seriale** așa cum le listează portalul.
- **Datele de program proprii ale portalului** în listă și în
  [ghidul de programe](/iptv-epg-guide/).
- **Reconectare**: linkul de flux al unui portal este adesea bun pentru o
  singură conexiune, așa că playerul cere unul nou ori de câte ori un flux
  în direct este deschis din nou.

## Ce nu merge încă

- **Arhiva portalului** (catch-up) nu este încă disponibilă.
- **Sincronizarea** lasă pe dinafară un cont Stalker dacă **Include
  parolele** nu este activată, fiindcă adresa MAC valorează cât o parolă.

## Cum ajunge la portal

Un portal se așteaptă la un aparat MAG: adresa MAC într-un cookie și numele
unui set-top box în locul celui al browserului. O pagină web nu le poate
seta singură, așa că extensia le setează doar pentru propriile cereri către
serverul portalului, iar regula dispare când browserul se închide.
Detaliile sunt în
[ghidul utilizatorului](https://github.com/BigTimeSam/kepuli-tv/blob/main/docs/user-guide.md#stalker-portals) (în engleză).
