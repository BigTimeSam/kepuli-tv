---
title: Přehrávač portálů Stalker v prohlížeči, s adresou MAC | Kepuli-TV
description: Sleduj portál Stalker (MAG) v Chromu nebo Firefoxu bez set-top boxu. Kepuli-TV si vezme adresu portálu a adresu MAC registrovanou k tvému předplatnému.
alt: Živé kanály v Kepuli-TV, jeden z nich hraje vedle seznamu
---

# Přehrávač portálů Stalker v prohlížeči

Poskytovatel, který svou službu prodává pro set-top boxy MAG, dává adresu
portálu, často zakončenou `/c/`, a k boxu registruje adresu MAC.
Uživatelské jméno ani heslo tu nejsou. Kepuli-TV s takovým portálem
komunikuje z karty prohlížeče, takže předplatné můžeš sledovat i bez boxu.

## Připojení k portálu

1. Nainstaluj Kepuli-TV a klikni na jeho ikonu na liště nástrojů.
2. Vlož adresu portálu do pole **Adresa předplatného nebo playlistu**.
   Adresa zakončená `/c/` se rozpozná a formulář se přepne na **Portál
   Stalker (adresa MAC)**.
3. Zadej adresu MAC registrovanou k tvému předplatnému.
4. Stiskni **Připojit**, a když se prohlížeč zeptá, zda smí Kepuli-TV
   přistupovat k portálu, zvol **Povolit**.

> [!IMPORTANT]
> Používej jen adresu MAC registrovanou k tvému vlastnímu předplatnému.
> Adresa někoho jiného nebo adresa ze sdíleného seznamu se použít nesmí:
> viz [podmínky použití](/terms/).

## Co funguje

- **Kanály, filmy a seriály** tak, jak je portál uvádí.
- **Vlastní data portálu o pořadech** v seznamu a
  v [programovém průvodci](/iptv-epg-guide/).
- **Opětovné připojení**: odkaz na stream z portálu často platí jen pro
  jedno připojení, takže přehrávač žádá o nový pokaždé, když se živý stream
  otevírá znovu.

## Co zatím ne

- **Archiv portálu** (catch-up) zatím chybí.
- **Synchronizace** účet Stalker vynechá, pokud není zapnuto **Zahrnout
  hesla**, protože adresa MAC má stejnou váhu jako heslo.

## Jak se k portálu dostane

Portál čeká box MAG: adresu MAC v cookie a název set-top boxu místo názvu
prohlížeče. Webová stránka je sama nastavit nemůže, takže je rozšíření
nastavuje jen pro své vlastní požadavky na server portálu a pravidlo zmizí,
když se prohlížeč zavře. Podrobnosti jsou
v [uživatelské příručce](https://github.com/BigTimeSam/kepuli-tv/blob/main/docs/user-guide.md#stalker-portals) (anglicky).
