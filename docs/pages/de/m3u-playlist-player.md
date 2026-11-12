---
title: M3U-Playlist im Browser abspielen, per Adresse oder Datei | Kepuli-TV
description: Spiele eine M3U- oder M3U8-Playlist mit Kepuli-TV in Chrome oder Firefox ab. Adresse einfügen oder Datei wählen: Gruppen, Logos, XMLTV-Programmübersicht und Catch-up inklusive.
alt: Kanäle einer Playlist in Kepuli-TV, nach Land gruppiert, einer davon läuft
---

# M3U-Playlist-Player im Browser

Kepuli-TV spielt eine M3U-Playlist in einem Browser-Tab ab. Gib ihm die
Adresse der Playlist oder die Datei selbst, und die Kanäle, Filme und Serien
darin erscheinen als Listen, die du durchsuchen, filtern und als Favoriten
markieren kannst.

## Eine Playlist über ihre Adresse hinzufügen

1. Installiere Kepuli-TV und klicke auf das Symbol in der Symbolleiste.
2. Füge die Adresse der Playlist in **Abo- oder Playlist-Adresse** ein. Das
   Formular steht anfangs auf **Playlist-Adresse (M3U)**.
3. Drücke **Verbinden**. Der Browser fragt, ob Kepuli-TV diesen Server
   erreichen darf: Wähle **Zulassen**, das gilt nur für diesen Server.

Eine Playlist, die keine Anmeldung braucht, etwa eine kostenlose, kommt in
dasselbe Feld.

## Oder die Datei wählen

**Datei auswählen…** unter der Adresse nimmt eine Playlist, die du auf dem
Gerät hast: `.m3u`, `.m3u8` oder gzip-komprimiert. Sie wird in den Browser
eingelesen, wenn du **Verbinden** drückst, und nichts wird dafür
heruntergeladen. Um sie zu aktualisieren, wähle die Datei in
**Einstellungen** erneut: Das Konto, seine Favoriten und sein Verlauf
bleiben.

## Was aus der Playlist gelesen wird

- **Gruppen, Logos und Programm-IDs** einer `m3u_plus`-Liste, sodass die
  Kanäle nach Land und Thema sortiert ankommen.
- **Die Programmübersicht**: die XMLTV-Adresse, die die Playlist in ihrer
  Kopfzeile nennt, oder eine, die du unter **Adresse der Programmübersicht
  (XMLTV)** einträgst. Siehe [die Programmübersicht](/iptv-epg-guide/).
- **Catch-up**, wo die Playlist das Archiv eines Kanals kennzeichnet.
- **Filme und Serien** in derselben Liste, jeweils unter ihrem eigenen Tab.
- **Eine einfache Liste ohne Gruppen**, die ihre Abschnitte mit
  Überschriftenzeilen kennzeichnet („===== Schweden =====“), wird unter
  diesen Überschriften gruppiert.

## Wenn es nicht klappt

- **Die Adresse hat keine M3U-Playlist geliefert.** bedeutet, dass der
  Server stattdessen mit einer Webseite oder einem Fehler geantwortet hat:
  oft eine Anmeldeseite oder der Hinweis, dass das Konto abgelaufen ist.
  Kläre die Adresse mit deinem Anbieter.
- Kommt die Playlist von einem Xtream-Codes-Server, sagt der Player das nach
  dem Verbinden und bietet **Als Xtream Codes verbinden** an, was die
  Kategorien, Cover und die Programmübersicht des Servers bringt. Siehe
  [Xtream Codes](/xtream-codes-player/).

Mehrere Playlists lassen sich als Konten nebeneinander führen, jede mit
eigenen Favoriten und eigenem Verlauf. Mehr im [Benutzerhandbuch](https://github.com/BigTimeSam/kepuli-tv/blob/main/docs/user-guide.md#several-accounts) (auf Englisch).
