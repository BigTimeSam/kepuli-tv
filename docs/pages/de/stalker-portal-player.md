---
title: Stalker-Portal-Player im Browser, mit deiner MAC-Adresse | Kepuli-TV
description: Sieh ein Stalker-Portal (MAG) in Chrome oder Firefox ohne Set-Top-Box. Kepuli-TV nimmt die Portal-Adresse und die MAC-Adresse, die für dein Abo registriert ist.
alt: Live-Kanäle in Kepuli-TV, einer davon läuft neben der Liste
---

# Stalker-Portal-Player im Browser

Ein Anbieter, der seinen Dienst für MAG-Set-Top-Boxen verkauft, nennt eine
Portal-Adresse, die oft auf `/c/` endet, und registriert eine MAC-Adresse
für die Box. Benutzername und Passwort gibt es nicht. Kepuli-TV spricht mit
einem solchen Portal aus einem Browser-Tab, sodass sich das Abo ohne die Box
ansehen lässt.

## Mit einem Portal verbinden

1. Installiere Kepuli-TV und klicke auf das Symbol in der Symbolleiste.
2. Füge die Adresse des Portals in **Abo- oder Playlist-Adresse** ein. Eine
   Adresse, die auf `/c/` endet, wird erkannt, und das Formular wechselt zu
   **Stalker-Portal (MAC-Adresse)**.
3. Gib die MAC-Adresse ein, die für dein Abo registriert ist.
4. Drücke **Verbinden** und wähle **Zulassen**, wenn der Browser fragt, ob
   Kepuli-TV das Portal erreichen darf.

> [!IMPORTANT]
> Verwende nur die MAC-Adresse, die für dein eigenes Abo registriert ist.
> Die einer anderen Person oder eine aus einer geteilten Liste darf nicht
> verwendet werden: siehe die [Nutzungsbedingungen](/terms/).

## Was funktioniert

- **Kanäle, Filme und Serien**, wie das Portal sie auflistet.
- **Die eigenen Programmdaten des Portals** in der Liste und in
  [der Programmübersicht](/iptv-epg-guide/).
- **Neu verbinden**: Der Stream-Link eines Portals gilt oft nur für eine
  einzige Verbindung, also fordert der Player jedes Mal einen neuen an, wenn
  ein Live-Stream erneut geöffnet wird.

## Was noch nicht funktioniert

- **Das Archiv des Portals** (Catch-up) gibt es noch nicht.
- **Die Synchronisierung** lässt ein Stalker-Konto aus, solange
  **Passwörter einschließen** nicht eingeschaltet ist, denn die MAC-Adresse
  ist so gut wie ein Passwort.

## Wie es das Portal erreicht

Ein Portal erwartet eine MAG-Box: die MAC-Adresse in einem Cookie und den
Namen einer Set-Top-Box als den des Browsers. Eine Webseite kann das nicht
selbst setzen, also setzt die Erweiterung es nur für ihre eigenen Anfragen
an den Server des Portals, und die Regel verschwindet, wenn der Browser
geschlossen wird. Die Einzelheiten stehen im
[Benutzerhandbuch](https://github.com/BigTimeSam/kepuli-tv/blob/main/docs/user-guide.md#stalker-portals)
(auf Englisch).
