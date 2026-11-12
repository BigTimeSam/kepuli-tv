---
title: Player de playlisturi M3U în browser, din adresă sau fișier | Kepuli-TV
description: Redă un playlist M3U sau M3U8 în Chrome sau Firefox cu Kepuli-TV. Lipește adresa playlistului sau alege fișierul și primești grupuri, sigle, ghid de programe XMLTV și catch-up.
alt: Canalele unui playlist grupate pe țări în Kepuli-TV, unul dintre ele fiind redat
---

# Player de playlisturi M3U în browser

Kepuli-TV redă un playlist M3U într-o filă de browser. Dă-i adresa
playlistului sau fișierul însuși, iar canalele, filmele și serialele din el
apar ca liste în care poți căuta, filtra și marca favorite.

## Adaugă un playlist după adresă

1. Instalează Kepuli-TV și dă clic pe pictograma lui din bara de
   instrumente.
2. Lipește adresa playlistului în **Adresa abonamentului sau a
   playlistului**. Formularul pornește pe **Adresa playlistului (M3U)**.
3. Apasă **Conectează**. Browserul întreabă dacă Kepuli-TV poate accesa
   acel server: alege **Permite**, ceea ce acoperă doar acel server.

Un playlist care nu cere autentificare, de pildă unul gratuit, se pune în
același câmp.

## Sau alege fișierul

**Alege un fișier…** de sub adresă primește un playlist pe care îl ai pe
dispozitiv: `.m3u`, `.m3u8` sau comprimat gzip. Este citit în browser când
apeși **Conectează** și nu se descarcă nimic pentru el. Ca să-l aduci la
zi, alege din nou fișierul în **Setări**: contul, favoritele și istoricul
lui rămân.

## Ce se citește din playlist

- **Grupurile, siglele și identificatorii de ghid** ai unei liste
  `m3u_plus`, astfel încât canalele vin sortate după țară și temă.
- **Ghidul de programe**: adresa XMLTV pe care playlistul o numește în
  antet sau una pe care o introduci la **Adresa ghidului de programe
  (XMLTV)**. Vezi [ghidul de programe](/iptv-epg-guide/).
- **Catch-up**, acolo unde playlistul marchează arhiva unui canal.
- **Filmele și serialele** din aceeași listă, fiecare în fila lui.
- **O listă simplă, fără grupuri**, care își marchează secțiunile cu
  rânduri de titlu („===== Sweden =====”) este grupată sub acele titluri.

## Când nu merge

- **Adresa nu a întors un playlist M3U.** înseamnă că serverul a răspuns
  cu o pagină web sau cu o eroare: adesea o pagină de autentificare sau un
  anunț că abonamentul a expirat. Verifică adresa cu furnizorul tău.
- Dacă playlistul vine de la un server Xtream Codes, playerul o spune după
  conectare și oferă **Conectează ca Xtream Codes**, care aduce
  categoriile, coperțile și ghidul serverului. Vezi
  [Xtream Codes](/xtream-codes-player/).

Mai multe playlisturi pot fi păstrate unul lângă altul ca conturi, fiecare
cu favoritele și istoricul lui. Mai multe în [ghidul utilizatorului](https://github.com/BigTimeSam/kepuli-tv/blob/main/docs/user-guide.md#several-accounts) (în engleză).
