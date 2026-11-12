---
title: M3U-lejátszó a böngészőben, címről vagy fájlból | Kepuli-TV
description: Játssz le M3U vagy M3U8 lejátszási listát Chrome-ban vagy Firefoxban a Kepuli-TV-vel. Illeszd be a címét, vagy válaszd ki a fájlt: csoportok, logók, XMLTV-műsorfüzet, visszanézés.
alt: Egy lejátszási lista csatornái országok szerint csoportosítva a Kepuli-TV-ben, az egyik éppen megy
---

# M3U lejátszási lista a böngészőben

A Kepuli-TV egy böngészőlapon játssza le az M3U lejátszási listát. Add meg
a lista címét vagy magát a fájlt, és a benne lévő csatornák, filmek és
sorozatok listákként jelennek meg, amelyekben kereshetsz, szűrhetsz, és
kedvenceket jelölhetsz.

## Lejátszási lista hozzáadása a címével

1. Telepítsd a Kepuli-TV-t, és kattints az ikonjára az eszköztáron.
2. Illeszd be a lista címét az **Előfizetési vagy lejátszási lista címe**
   mezőbe. Az űrlap a **Lejátszási lista címe (M3U)** módban indul.
3. Nyomd meg a **Csatlakozás** gombot. A böngésző megkérdezi, elérheti-e a
   Kepuli-TV azt a szervert: válaszd az **Engedélyezés** gombot, amely csak
   arra a szerverre vonatkozik.

A bejelentkezést nem igénylő, például ingyenes lejátszási lista ugyanabba a
mezőbe megy.

## Vagy válaszd ki a fájlt

A cím alatti **Fájl kiválasztása…** olyan lejátszási listát fogad, amely az
eszközödön van: `.m3u`, `.m3u8` vagy gzippel tömörített. A böngésző akkor
olvassa be, amikor megnyomod a **Csatlakozás** gombot, és semmit sem tölt
le hozzá. A frissítéséhez válaszd ki újra a fájlt a **Beállítások** alatt:
a fiók, a kedvencei és az előzményei megmaradnak.

## Mit olvas ki a lejátszási listából

- Az `m3u_plus` lista **csoportjait, logóit és műsorfüzet-azonosítóit**,
  így a csatornák ország és téma szerint rendezve érkeznek.
- **A műsorfüzetet**: azt az XMLTV-címet, amelyet a lista a fejlécében
  megnevez, vagy amelyet te adsz meg a **Műsorfüzet címe (XMLTV)** mezőben.
  Lásd: [a műsorfüzet](/iptv-epg-guide/).
- **A visszanézést**, ahol a lista jelöli a csatorna archívumát.
- **A filmeket és a sorozatokat** ugyanabból a listából, mindegyiket a
  saját fülén.
- **A csoportok nélküli sima listát**, amely címsorokkal jelöli a
  szakaszait („===== Sweden =====”), ezek alá a címsorok alá csoportosítja.

## Ha nem működik

- **A cím nem adott vissza M3U lejátszási listát.** azt jelenti, hogy a
  szerver weboldallal vagy hibával válaszolt: ez gyakran egy bejelentkezési
  oldal vagy értesítés arról, hogy a fiók lejárt. Ellenőrizd a címet a
  szolgáltatódnál.
- Ha a lejátszási lista Xtream Codes szerverről származik, a lejátszó ezt a
  csatlakozás után jelzi, és felajánlja a **Csatlakozás Xtream Codesként**
  lehetőséget, amely a szerver kategóriáit, borítóit és műsorfüzetét is
  elhozza. Lásd: [Xtream Codes](/xtream-codes-player/).

Több lejátszási lista is tartható egymás mellett fiókként, mindegyik a
saját kedvenceivel és előzményeivel. Bővebben a [felhasználói útmutatóban](https://github.com/BigTimeSam/kepuli-tv/blob/main/docs/user-guide.md#several-accounts) (angolul).
