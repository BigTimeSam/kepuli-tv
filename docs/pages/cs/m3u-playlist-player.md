---
title: Přehrávač playlistů M3U v prohlížeči, z adresy i ze souboru | Kepuli-TV
description: Přehraj playlist M3U nebo M3U8 v Chromu či Firefoxu s Kepuli-TV. Vlož adresu playlistu nebo vyber soubor a získáš skupiny, loga, programového průvodce XMLTV a catch-up.
alt: Kanály z playlistu seskupené podle země v Kepuli-TV, jeden z nich hraje
---

# Přehrávač playlistů M3U v prohlížeči

Kepuli-TV přehraje playlist M3U v kartě prohlížeče. Dej mu adresu playlistu
nebo přímo soubor a kanály, filmy a seriály z něj se objeví jako seznamy,
ve kterých můžeš hledat, filtrovat a označovat oblíbené.

## Přidání playlistu podle adresy

1. Nainstaluj Kepuli-TV a klikni na jeho ikonu na liště nástrojů.
2. Vlož adresu playlistu do pole **Adresa předplatného nebo playlistu**.
   Formulář začíná na **Adresa playlistu (M3U)**.
3. Stiskni **Připojit**. Prohlížeč se zeptá, zda smí Kepuli-TV přistupovat
   k tomuto serveru: zvol **Povolit**, což se týká jen tohoto serveru.

Playlist, který nevyžaduje přihlášení, třeba bezplatný, patří do stejného
pole.

## Nebo vyber soubor

**Vybrat soubor…** pod adresou vezme playlist, který máš v zařízení:
`.m3u`, `.m3u8` nebo zabalený gzipem. Do prohlížeče se načte, když stiskneš
**Připojit**, a nic se kvůli němu nestahuje. Když ho chceš aktualizovat,
vyber soubor znovu v **Nastavení**: účet, jeho oblíbené i historie
zůstanou.

## Co se z playlistu čte

- **Skupiny, loga a identifikátory pro průvodce** ze seznamu `m3u_plus`,
  takže kanály přijdou seřazené podle země a tématu.
- **Programový průvodce**: adresa XMLTV, kterou playlist uvádí ve své
  hlavičce, nebo ta, kterou zadáš v poli **Adresa programového průvodce
  (XMLTV)**. Viz [programový průvodce](/iptv-epg-guide/).
- **Catch-up** tam, kde playlist označuje archiv kanálu.
- **Filmy a seriály** ve stejném seznamu, každé na vlastní kartě.
- **Prostý seznam bez skupin**, který své oddíly označuje řádky s nadpisy
  („===== Švédsko =====“), se seskupí pod tyto nadpisy.

## Když to nefunguje

- **Adresa nevrátila playlist M3U.** znamená, že server místo něj odpověděl
  webovou stránkou nebo chybou: často jde o přihlašovací stránku nebo
  o oznámení, že účet vypršel. Ověř adresu u svého poskytovatele.
- Pokud playlist pochází ze serveru Xtream Codes, přehrávač to po připojení
  oznámí a nabídne **Připojit jako Xtream Codes**, což přinese kategorie,
  obaly a průvodce ze serveru. Viz
  [Xtream Codes](/xtream-codes-player/).

Několik playlistů můžeš mít vedle sebe jako účty, každý s vlastními
oblíbenými a historií. Víc v [uživatelské příručce](https://github.com/BigTimeSam/kepuli-tv/blob/main/docs/user-guide.md#several-accounts) (anglicky).
