---
title: Stalker portál lejátszása böngészőben, MAC-címmel | Kepuli-TV
description: Nézz Stalker (MAG) portált Chrome-ban vagy Firefoxban, beltéri egység nélkül. A Kepuli-TV-nek a portál címe és az előfizetésedhez regisztrált MAC-cím kell.
alt: Élő csatornák a Kepuli-TV-ben, az egyik a lista mellett megy
---

# Stalker portál a böngészőben

Az a szolgáltató, amely MAG beltéri egységekhez árulja a szolgáltatását,
egy portálcímet ad, amely gyakran `/c/` végű, és regisztrál egy MAC-címet
az egységhez. Felhasználónév és jelszó nincs. A Kepuli-TV egy böngészőlapról
beszél az ilyen portállal, így az előfizetés az egység nélkül is nézhető.

## Csatlakozás egy portálhoz

1. Telepítsd a Kepuli-TV-t, és kattints az ikonjára az eszköztáron.
2. Illeszd be a portál címét az **Előfizetési vagy lejátszási lista címe**
   mezőbe. A `/c/` végű címet az űrlap felismeri, és átvált a
   **Stalker-portál (MAC-cím)** módra.
3. Add meg az előfizetésedhez regisztrált MAC-címet.
4. Nyomd meg a **Csatlakozás** gombot, és válaszd az **Engedélyezés**
   gombot, amikor a böngésző megkérdezi, elérheti-e a Kepuli-TV a portált.

> [!IMPORTANT]
> Csak a saját előfizetésedhez regisztrált MAC-címet használd. Másét vagy
> megosztott listáról származót nem szabad használni: lásd a
> [felhasználási feltételeket](/terms/).

## Ami működik

- **Csatornák, filmek és sorozatok**, ahogy a portál felsorolja őket.
- **A portál saját műsoradatai** a listában és
  [a műsorfüzetben](/iptv-epg-guide/).
- **Újracsatlakozás**: a portál adatfolyam-hivatkozása gyakran csak egyetlen
  kapcsolatra érvényes, ezért a lejátszó újat kér, valahányszor újra
  megnyílik egy élő adatfolyam.

## Ami még nem

- **A portál archívuma** (visszanézés) még nincs meg.
- **A szinkronizálás** kihagyja a Stalker fiókot, hacsak a **Jelszavak is**
  nincs bekapcsolva, mert a MAC-cím felér egy jelszóval.

## Hogyan éri el a portált

A portál MAG egységre számít: a MAC-címre egy sütiben, és arra, hogy a
böngésző egy beltéri egység nevén mutatkozik be. Egy weboldal ezeket maga
nem tudja beállítani, ezért a bővítmény állítja be őket, kizárólag a saját,
a portál szerveréhez intézett kéréseihez, és a szabály megszűnik, amikor a
böngésző bezárul. A részletek a
[felhasználói útmutatóban](https://github.com/BigTimeSam/kepuli-tv/blob/main/docs/user-guide.md#stalker-portals) (angolul) vannak.
