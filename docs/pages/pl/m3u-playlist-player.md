---
title: Odtwarzacz playlist M3U w przeglądarce, z adresu lub pliku | Kepuli-TV
description: Odtwarzaj playlistę M3U lub M3U8 w Chrome albo Firefoksie z Kepuli-TV. Wklej adres playlisty lub wybierz plik: grupy, logo, przewodnik po programach XMLTV i catch-up.
alt: Kanały z playlisty pogrupowane według kraju w Kepuli-TV, jeden z nich jest odtwarzany
---

# Odtwarzacz playlist M3U w przeglądarce

Kepuli-TV odtwarza playlistę M3U w karcie przeglądarki. Podaj adres
playlisty albo sam plik, a zawarte w niej kanały, filmy i seriale pojawią
się jako listy, które można przeszukiwać, filtrować i oznaczać jako
ulubione.

## Dodaj playlistę z adresu

1. Zainstaluj Kepuli-TV i kliknij jego ikonę na pasku narzędzi.
2. Wklej adres playlisty w polu **Adres subskrypcji lub playlisty**.
   Formularz zaczyna od opcji **Adres playlisty (M3U)**.
3. Naciśnij **Połącz**. Przeglądarka zapyta, czy Kepuli-TV może łączyć się
   z tym serwerem: wybierz **Zezwól**; zgoda dotyczy tylko tego serwera.

Playlistę, która nie wymaga logowania, na przykład darmową, wkleja się w
tym samym polu.

## Albo wybierz plik

**Wybierz plik…** pod adresem przyjmuje playlistę zapisaną na urządzeniu:
`.m3u`, `.m3u8` lub spakowaną gzipem. Jest wczytywana do przeglądarki, gdy
naciśniesz **Połącz**, i nic nie jest przy tym pobierane. Aby ją
zaktualizować, wybierz plik ponownie w **Ustawieniach**: konto, jego
ulubione i historia zostają.

## Co jest odczytywane z playlisty

- **Grupy, logo i identyfikatory przewodnika** z listy `m3u_plus`, dzięki
  czemu kanały są od razu posortowane według kraju i tematu.
- **Przewodnik po programach**: adres XMLTV, który playlista wskazuje w
  nagłówku, albo ten wpisany w polu **Adres przewodnika po programach
  (XMLTV)**. Zobacz [przewodnik po programach](/iptv-epg-guide/).
- **Catch-up** tam, gdzie playlista oznacza archiwum kanału.
- **Filmy i seriale** z tej samej listy, każde w swojej karcie.
- **Zwykła lista bez grup**, która oznacza sekcje wierszami nagłówków
  („===== Sweden =====”), jest grupowana pod tymi nagłówkami.

## Gdy nie działa

- **Pod tym adresem nie było playlisty M3U.** oznacza, że serwer
  odpowiedział stroną internetową lub błędem: często jest to strona
  logowania albo informacja, że konto wygasło. Sprawdź adres u dostawcy.
- Jeśli playlista pochodzi z serwera Xtream Codes, odtwarzacz informuje o
  tym po połączeniu i proponuje **Połącz jako Xtream Codes**, co daje
  kategorie, okładki i przewodnik z serwera. Zobacz
  [Xtream Codes](/xtream-codes-player/).

Kilka playlist można trzymać obok siebie jako konta, każde z własnymi
ulubionymi i historią. Więcej w [instrukcji obsługi](https://github.com/BigTimeSam/kepuli-tv/blob/main/docs/user-guide.md#several-accounts) (po angielsku).
