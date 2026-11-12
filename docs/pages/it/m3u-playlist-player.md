---
title: Lettore di playlist M3U nel browser, da indirizzo o da file | Kepuli-TV
description: Riproduci una playlist M3U o M3U8 in Chrome o Firefox con Kepuli-TV. Incolla l'indirizzo della playlist o scegli il file: gruppi, loghi, guida programmi XMLTV e catch-up.
alt: I canali di una playlist raggruppati per paese in Kepuli-TV, uno dei quali in riproduzione
---

# Lettore di playlist M3U nel browser

Kepuli-TV riproduce una playlist M3U in una scheda del browser. Dagli
l'indirizzo della playlist o il file stesso, e i canali, i film e le serie
che contiene compaiono come elenchi in cui puoi cercare, filtrare e segnare
i preferiti.

## Aggiungere una playlist dal suo indirizzo

1. Installa Kepuli-TV e clicca sulla sua icona nella barra degli strumenti.
2. Incolla l'indirizzo della playlist in **Indirizzo dell'abbonamento o
   della playlist**. Il modulo parte da **Indirizzo della playlist (M3U)**.
3. Premi **Connetti**. Il browser chiede se Kepuli-TV può raggiungere quel
   server: scegli **Consenti**, che vale solo per quel server.

Una playlist che non richiede l'accesso, per esempio una gratuita, va nello
stesso campo.

## Oppure scegli il file

**Scegli un file…** sotto l'indirizzo accetta una playlist che hai sul
dispositivo: `.m3u`, `.m3u8` o compressa con gzip. Viene letta nel browser
quando premi **Connetti**, e per questo non si scarica nulla. Per
aggiornarla, scegli di nuovo il file in **Impostazioni**: l'account, i suoi
preferiti e la sua cronologia restano.

## Che cosa si legge dalla playlist

- **Gruppi, loghi e identificativi della guida** di un elenco `m3u_plus`,
  così i canali arrivano ordinati per paese e argomento.
- **La guida programmi**: l'indirizzo XMLTV che la playlist indica nella sua
  intestazione, o quello che inserisci in **Indirizzo della guida programmi
  (XMLTV)**. Vedi [la guida programmi](/iptv-epg-guide/).
- **Il catch-up**, dove la playlist segnala l'archivio di un canale.
- **Film e serie** nello stesso elenco, ciascuno nella propria scheda.
- **Un elenco semplice senza gruppi** che separa le sezioni con righe di
  intestazione («===== Svezia =====») viene raggruppato sotto quelle
  intestazioni.

## Quando non funziona

- **L’indirizzo non ha restituito una playlist M3U.** significa che il
  server ha risposto con una pagina web o un errore: spesso una pagina di
  accesso o un avviso che l'account è scaduto. Verifica l'indirizzo con il
  tuo provider.
- Se la playlist proviene da un server Xtream Codes, il lettore lo dice dopo
  la connessione e propone **Collega come Xtream Codes**, che porta le
  categorie, le copertine e la guida del server. Vedi
  [Xtream Codes](/xtream-codes-player/).

Più playlist si possono tenere una accanto all'altra come account, ciascuna
con i propri preferiti e la propria cronologia. Altro nella [guida per l'utente](https://github.com/BigTimeSam/kepuli-tv/blob/main/docs/user-guide.md#several-accounts) (in inglese).
