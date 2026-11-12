---
title: Lettore per portali Stalker nel browser, con indirizzo MAC | Kepuli-TV
description: Guarda un portale Stalker (MAG) in Chrome o Firefox senza decoder. Kepuli-TV usa l'indirizzo del portale e l'indirizzo MAC registrato per il tuo abbonamento.
alt: Canali in diretta in Kepuli-TV, uno dei quali in riproduzione accanto all'elenco
---

# Lettore per portali Stalker nel browser

Un provider che vende il suo servizio per i decoder MAG fornisce l'indirizzo
di un portale, che spesso termina con `/c/`, e registra un indirizzo MAC per
il decoder. Non ci sono nome utente né password. Kepuli-TV dialoga con un
portale di questo tipo da una scheda del browser, così l'abbonamento si può
guardare senza il decoder.

## Collegarsi a un portale

1. Installa Kepuli-TV e clicca sulla sua icona nella barra degli strumenti.
2. Incolla l'indirizzo del portale in **Indirizzo dell'abbonamento o della
   playlist**. Un indirizzo che termina con `/c/` viene riconosciuto, e il
   modulo passa a **Portale Stalker (indirizzo MAC)**.
3. Inserisci l'indirizzo MAC registrato per il tuo abbonamento.
4. Premi **Connetti** e scegli **Consenti** quando il browser chiede se
   Kepuli-TV può raggiungere il portale.

> [!IMPORTANT]
> Usa solo l'indirizzo MAC registrato per il tuo abbonamento. Quello di
> un'altra persona, o uno preso da un elenco condiviso, non si può usare:
> vedi le [condizioni d'uso](/terms/).

## Che cosa funziona

- **Canali, film e serie** come li elenca il portale.
- **I dati dei programmi del portale** nell'elenco e nella
  [guida programmi](/iptv-epg-guide/).
- **Riconnessione**: il link di un flusso di un portale vale spesso per una
  sola connessione, quindi il lettore ne chiede uno nuovo ogni volta che un
  flusso in diretta viene riaperto.

## Che cosa non funziona, per ora

- **L'archivio del portale** (catch-up) non c'è ancora.
- **La sincronizzazione** esclude un account Stalker, a meno che **Includi
  le password** non sia attivo, perché l'indirizzo MAC vale quanto una
  password.

## Come raggiunge il portale

Un portale si aspetta un decoder MAG: l'indirizzo MAC in un cookie e il
nome di un decoder al posto di quello del browser. Una pagina web non può
impostarli da sé, quindi l'estensione li imposta solo per le proprie
richieste al server del portale, e la regola sparisce quando il browser si
chiude. I dettagli sono nella
[guida per l'utente](https://github.com/BigTimeSam/kepuli-tv/blob/main/docs/user-guide.md#stalker-portals)
(in inglese).
