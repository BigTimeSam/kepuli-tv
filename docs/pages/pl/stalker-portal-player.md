---
title: Odtwarzacz portali Stalker w przeglądarce, z adresem MAC | Kepuli-TV
description: Oglądaj portal Stalker (MAG) w Chrome lub Firefoksie bez dekodera. Kepuli-TV potrzebuje adresu portalu i adresu MAC zarejestrowanego dla Twojej subskrypcji.
alt: Kanały na żywo w Kepuli-TV, jeden z nich odtwarzany obok listy
---

# Odtwarzacz portali Stalker w przeglądarce

Dostawca, który sprzedaje usługę dla dekoderów MAG, podaje adres portalu,
często zakończony na `/c/`, i rejestruje adres MAC dekodera. Nie ma nazwy
użytkownika ani hasła. Kepuli-TV łączy się z takim portalem z karty
przeglądarki, więc subskrypcję można oglądać bez dekodera.

## Połącz się z portalem

1. Zainstaluj Kepuli-TV i kliknij jego ikonę na pasku narzędzi.
2. Wklej adres portalu w polu **Adres subskrypcji lub playlisty**. Adres
   zakończony na `/c/` zostaje rozpoznany, a formularz przechodzi na
   **Portal Stalker (adres MAC)**.
3. Wpisz adres MAC zarejestrowany dla Twojej subskrypcji.
4. Naciśnij **Połącz** i wybierz **Zezwól**, gdy przeglądarka zapyta, czy
   Kepuli-TV może łączyć się z portalem.

> [!IMPORTANT]
> Używaj tylko adresu MAC zarejestrowanego dla własnej subskrypcji. Adresu
> innej osoby ani adresu z udostępnianej listy używać nie wolno: zobacz
> [warunki korzystania](/terms/).

## Co działa

- **Kanały, filmy i seriale** w takim układzie, w jakim podaje je portal.
- **Własne dane programu portalu** na liście i w
  [przewodniku po programach](/iptv-epg-guide/).
- **Ponowne łączenie**: odnośnik do strumienia z portalu często działa
  tylko dla jednego połączenia, więc odtwarzacz prosi o nowy za każdym
  razem, gdy strumień na żywo jest otwierany ponownie.

## Co jeszcze nie działa

- **Archiwum portalu** (catch-up) nie jest jeszcze obsługiwane.
- **Synchronizacja** pomija konto Stalker, chyba że włączono **Dołącz
  hasła**, bo adres MAC jest tyle wart co hasło.

## Jak łączy się z portalem

Portal oczekuje dekodera MAG: adresu MAC w pliku cookie i nazwy dekodera
w miejscu nazwy przeglądarki. Strona internetowa nie może ustawić ich
sama, więc rozszerzenie ustawia je wyłącznie dla własnych żądań do serwera
portalu, a reguła znika po zamknięciu przeglądarki. Szczegóły są w
[instrukcji obsługi](https://github.com/BigTimeSam/kepuli-tv/blob/main/docs/user-guide.md#stalker-portals) (po angielsku).
