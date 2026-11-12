---
title: Prehrávač portálov Stalker v prehliadači, s adresou MAC | Kepuli-TV
description: Pozeraj portál Stalker (MAG) v Chrome alebo Firefoxe bez set-top boxu. Kepuli-TV použije adresu portálu a adresu MAC registrovanú k tvojmu predplatnému.
alt: Živé kanály v Kepuli-TV, jeden z nich hrá vedľa zoznamu
---

# Prehrávač portálov Stalker v prehliadači

Poskytovateľ, ktorý predáva službu pre set-top boxy MAG, dáva adresu
portálu, často zakončenú na `/c/`, a registruje adresu MAC boxu.
Používateľské meno ani heslo tu nie sú. Kepuli-TV s takým portálom
komunikuje z karty prehliadača, takže predplatné môžeš pozerať aj bez boxu.

## Pripoj sa k portálu

1. Nainštaluj Kepuli-TV a klikni na jeho ikonu na paneli nástrojov.
2. Vlož adresu portálu do poľa **Adresa predplatného alebo playlistu**.
   Adresa zakončená na `/c/` sa rozpozná a formulár prejde na možnosť
   **Portál Stalker (adresa MAC)**.
3. Zadaj adresu MAC registrovanú k tvojmu predplatnému.
4. Stlač **Pripojiť** a vyber **Povoliť**, keď sa prehliadač spýta, či sa
   Kepuli-TV smie pripojiť k portálu.

> [!IMPORTANT]
> Používaj len adresu MAC registrovanú k tvojmu vlastnému predplatnému.
> Adresa niekoho iného alebo adresa zo zdieľaného zoznamu sa použiť nesmie:
> pozri [podmienky používania](/terms/).

## Čo funguje

- **Kanály, filmy a seriály** tak, ako ich uvádza portál.
- **Vlastné programové údaje portálu** v zozname aj v
  [programovom sprievodcovi](/iptv-epg-guide/).
- **Opätovné pripojenie**: odkaz na stream z portálu často platí len na
  jedno pripojenie, preto si prehrávač vyžiada nový vždy, keď sa živý stream
  otvára znova.

## Čo zatiaľ nie

- **Archív portálu** (catch-up) zatiaľ chýba.
- **Synchronizácia** účet Stalker vynechá, ak nie je zapnutá možnosť
  **Zahrnúť heslá**, pretože adresa MAC je rovnako citlivá ako heslo.

## Ako sa pripája k portálu

Portál očakáva box MAG: adresu MAC v cookie a názov set-top boxu namiesto
názvu prehliadača. Webová stránka si ich sama nastaviť nemôže, preto ich
rozšírenie nastavuje len pre vlastné požiadavky na server portálu a
pravidlo zmizne, keď sa prehliadač zavrie. Podrobnosti sú v
[používateľskej príručke](https://github.com/BigTimeSam/kepuli-tv/blob/main/docs/user-guide.md#stalker-portals) (po anglicky).
