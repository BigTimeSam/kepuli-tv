---
title: IPTV-Player für Firefox, ein kostenloses Add-on | Kepuli-TV
description: Kepuli-TV ist ein kostenloses, quelloffenes IPTV-Add-on für Mozilla Firefox. Spiele deine M3U-Playlist, dein Xtream-Codes-Konto oder Stalker-Portal im Tab ab, mit Programmübersicht.
alt: Die Programmübersicht von Kepuli-TV in Firefox, der Kanal läuft in der Ecke
---

# IPTV-Player für Firefox

Kepuli-TV ist ein Add-on für Mozilla Firefox 130 oder neuer, das dein
eigenes IPTV-Abo in einem Tab abspielt: Live-Kanäle mit Programmübersicht,
Filme und Serien. Dasselbe Add-on läuft in
[Firefox für Android](/iptv-player-android/) und, über Orion, auf dem
[iPhone](/iptv-player-iphone/). Es ist kostenlos und quelloffen, und eigene
Kanäle bringt es nicht mit.

## In Firefox installieren

1. Öffne Kepuli-TV mit der Schaltfläche oben auf Firefox Add-ons und wähle
   **Zu Firefox hinzufügen**.
2. Klicke in der Symbolleiste auf das Symbol von Kepuli-TV. Ist es nicht da,
   steckt es unter dem Puzzleteil und lässt sich von dort an die
   Symbolleiste anheften.
3. Der Player öffnet sich in einem eigenen Tab und fragt nach den Daten
   deines Anbieters.

## Dein Abo verbinden

Füge die Adresse ein, die dein Anbieter dir geschickt hat. Das Formular
erkennt, um welche Art es sich handelt: eine
[M3U-Playlist](/m3u-playlist-player/), ein
[Xtream-Codes-Konto](/xtream-codes-player/) oder ein
[Stalker-Portal](/stalker-portal-player/). Firefox fragt dann, ob Kepuli-TV
diesen Server erreichen darf: Wähle **Erlauben**, das gilt nur für diesen
Server. Vorher wird nichts irgendwohin gesendet.

## So läuft es in Firefox

- **MKV-Dateien** werden im Tab entpackt und lassen sich spulen. Firefox hat
  keinen Decoder für AC-3-, E-AC-3- oder DTS-Ton, also bringt der Player
  seinen eigenen mit: siehe [MKV im Browser](/mkv-player-browser/).
- **Logos und Cover**, die ein Anbieter über einfaches http ausliefert,
  werden auch in Firefox angezeigt.
- **Die Synchronisierung zwischen Computern** läuft über Firefox’ eigene
  Synchronisierung und ist aus, bis du sie einschaltest.
- **Chromecast** wird nicht angeboten: Firefox kann keinen erreichen.
  Stattdessen übergibt das Menü des Players den Stream an VLC oder einen
  anderen Player.

## Gut zu wissen

- Die [Programmübersicht](/iptv-epg-guide/), Catch-up, Aufnahmen und die
  dreißig Sprachen sind dieselben wie in Chrome.
- Alles Weitere steht im [Benutzerhandbuch](https://github.com/BigTimeSam/kepuli-tv/blob/main/docs/user-guide.md) (auf Englisch).
