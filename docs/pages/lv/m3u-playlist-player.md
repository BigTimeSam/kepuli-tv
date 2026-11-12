---
title: M3U saraksta atskaņotājs pārlūkā, pēc adreses vai no faila | Kepuli-TV
description: Atskaņo M3U vai M3U8 sarakstu pārlūkā Chrome vai Firefox ar Kepuli-TV. Ielīmē saraksta adresi vai izvēlies failu un saņem grupas, logotipus, XMLTV programmas ceļvedi un catch-up.
alt: Atskaņošanas saraksta kanāli Kepuli-TV sagrupēti pēc valsts, viens no tiem tiek atskaņots
---

# M3U atskaņošanas saraksta atskaņotājs pārlūkā

Kepuli-TV atskaņo M3U atskaņošanas sarakstu pārlūka cilnē. Iedod tam
saraksta adresi vai pašu failu, un tajā esošie kanāli, filmas un seriāli
parādās kā saraksti, kuros vari meklēt, filtrēt un likt izlasē.

## Pievieno atskaņošanas sarakstu pēc adreses

1. Instalē Kepuli-TV un noklikšķini uz tā ikonas rīkjoslā.
2. Ielīmē saraksta adresi laukā **Abonementa vai atskaņošanas saraksta
   adrese**. Veidlapa sākas ar **Atskaņošanas saraksta adrese (M3U)**.
3. Nospied **Savienot**. Pārlūks jautā, vai Kepuli-TV drīkst piekļūt šim
   serverim: izvēlies **Atļaut**, un atļauja attiecas tikai uz šo serveri.

Atskaņošanas saraksts, kam nav vajadzīga pieteikšanās, piemēram, bezmaksas
saraksts, jāielīmē tajā pašā laukā.

## Vai izvēlies failu

**Izvēlēties failu…** zem adreses paņem atskaņošanas sarakstu, kas ir tavā
ierīcē: `.m3u`, `.m3u8` vai saspiestu ar gzip. Tas tiek nolasīts pārlūkā,
kad nospied **Savienot**, un nekas tam netiek lejupielādēts. Lai to
atjauninātu, izvēlies failu vēlreiz sadaļā **Iestatījumi**: konts, tā
izlase un vēsture paliek.

## Kas tiek nolasīts no atskaņošanas saraksta

- **Grupas, logotipi un ceļveža identifikatori** no `m3u_plus` saraksta,
  tāpēc kanāli ir sakārtoti pēc valsts un tēmas.
- **Programmas ceļvedis**: XMLTV adrese, ko saraksts nosauc savā galvenē,
  vai tā, ko ievadi laukā **Programmas ceļveža adrese (XMLTV)**. Skati
  [programmas ceļvedi](/iptv-epg-guide/).
- **Catch-up**, ja saraksts atzīmē kanāla arhīvu.
- **Filmas un seriāli** tajā pašā sarakstā, katrs savā cilnē.
- **Vienkāršs saraksts bez grupām**, kas savas sadaļas atzīmē ar virsrakstu
  rindām („===== Zviedrija =====“), tiek sagrupēts zem šiem virsrakstiem.

## Ja tas nedarbojas

- **Adrese neatgrieza M3U atskaņošanas sarakstu.** nozīmē, ka serveris
  atbildēja ar tīmekļa lapu vai kļūdu: bieži tā ir pieteikšanās lapa vai
  ziņa, ka konta termiņš ir beidzies. Pārbaudi adresi pie sava sniedzēja.
- Ja atskaņošanas saraksts nāk no Xtream Codes servera, atskaņotājs pēc
  savienošanās to pasaka un piedāvā **Savienot kā Xtream Codes**, kas
  atnes servera kategorijas, vākus un ceļvedi. Skati
  [Xtream Codes](/xtream-codes-player/).

Vairākus atskaņošanas sarakstus var turēt līdzās kā kontus, katru ar savu
izlasi un vēsturi. Vairāk [lietotāja rokasgrāmatā](https://github.com/BigTimeSam/kepuli-tv/blob/main/docs/user-guide.md#several-accounts) (angliski).
