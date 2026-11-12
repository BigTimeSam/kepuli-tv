---
title: M3U grojaraščio grotuvas naršyklėje, iš adreso arba failo | Kepuli-TV
description: Grok M3U ar M3U8 grojaraštį Chrome arba Firefox su Kepuli-TV. Įklijuok grojaraščio adresą arba pasirink failą ir gauk grupes, logotipus, XMLTV programų gidą bei catch-up.
alt: Grojaraščio kanalai Kepuli-TV sugrupuoti pagal šalį, vienas iš jų groja
---

# M3U grojaraščio grotuvas naršyklėje

Kepuli-TV groja M3U grojaraštį naršyklės skirtuke. Duok jam grojaraščio
adresą arba patį failą, ir jame esantys kanalai, filmai bei serialai
pasirodys sąrašais, kuriuose gali ieškoti, filtruoti ir žymėti mėgstamus.

## Pridėk grojaraštį pagal adresą

1. Įdiek Kepuli-TV ir spustelėk jo piktogramą įrankių juostoje.
2. Įklijuok grojaraščio adresą į lauką **Prenumeratos arba grojaraščio
   adresas**. Forma atsidaro ties **Grojaraščio adresas (M3U)**.
3. Spustelėk **Prisijungti**. Naršyklė paklaus, ar Kepuli-TV gali jungtis
   prie to serverio: pasirink **Leisti**, leidimas galioja tik tam serveriui.

Grojaraštis, kuriam nereikia prisijungimo, pavyzdžiui, nemokamas, rašomas į
tą patį lauką.

## Arba pasirink failą

**Pasirinkti failą…** po adresu paima grojaraštį, kurį turi įrenginyje:
`.m3u`, `.m3u8` arba suspaustą gzip. Jis nuskaitomas į naršyklę, kai
spusteli **Prisijungti**, ir niekas dėl to neatsisiunčiama. Norėdamas jį
atnaujinti, dar kartą pasirink failą skiltyje **Nustatymai**: paskyra, jos
mėgstami ir istorija išlieka.

## Kas nuskaitoma iš grojaraščio

- **Grupės, logotipai ir gido identifikatoriai** iš `m3u_plus` sąrašo, tad
  kanalai būna surūšiuoti pagal šalį ir temą.
- **Programų gidas**: XMLTV adresas, kurį grojaraštis nurodo savo
  antraštėje, arba tas, kurį įvedi lauke **Programų gido adresas (XMLTV)**.
  Žr. [programų gidas](/iptv-epg-guide/).
- **Catch-up**, kur grojaraštis pažymi kanalo archyvą.
- **Filmai ir serialai** iš to paties sąrašo, kiekvieni savo kortelėje.
- **Paprastas sąrašas be grupių**, kuris savo skyrius žymi antraščių
  eilutėmis („===== Sweden =====“), sugrupuojamas pagal tas antraštes.

## Kai neveikia

- **Adresas negrąžino M3U grojaraščio.** reiškia, kad serveris vietoj jo
  atsakė tinklalapiu arba klaida: dažnai tai prisijungimo puslapis arba
  pranešimas, kad paskyra baigė galioti. Pasitikslink adresą pas tiekėją.
- Jei grojaraštis ateina iš Xtream Codes serverio, grotuvas tai pasako
  prisijungęs ir pasiūlo **Prisijungti kaip Xtream Codes**: taip gaunamos
  serverio kategorijos, viršeliai ir gidas. Žr.
  [Xtream Codes](/xtream-codes-player/).

Kelis grojaraščius galima laikyti greta kaip paskyras, kiekvieną su savo
mėgstamais ir istorija. Daugiau – [naudotojo vadove](https://github.com/BigTimeSam/kepuli-tv/blob/main/docs/user-guide.md#several-accounts) (anglų kalba).
