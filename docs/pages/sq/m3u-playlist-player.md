---
title: Luajtës listash M3U në shfletues, me adresë ose skedar | Kepuli-TV
description: Luaj një listë M3U ose M3U8 në Chrome ose Firefox me Kepuli-TV. Ngjit adresën e listës ose zgjidh skedarin, dhe merr grupet, logot, udhëzuesin e programeve XMLTV dhe catch-up.
alt: Kanalet e një liste të grupuara sipas vendit në Kepuli-TV, njëri prej tyre duke u luajtur
---

# Luajtës listash M3U në shfletues

Kepuli-TV e luan një listë M3U në një skedë të shfletuesit. Jepi adresën e
listës ose vetë skedarin, dhe kanalet, filmat e serialet në të shfaqen si
lista ku mund të kërkosh, të filtrosh dhe të shënosh të preferuarat.

## Shto një listë me adresën e saj

1. Instalo Kepuli-TV dhe kliko ikonën e tij në shiritin e veglave.
2. Ngjit adresën e listës te **Adresa e abonimit ose e listës**. Formulari
   nis te **Adresa e listës (M3U)**.
3. Shtyp **Lidhu**. Shfletuesi pyet nëse Kepuli-TV mund ta arrijë atë
   server: zgjidh **Lejo**, që vlen vetëm për atë server.

Një listë që nuk kërkon hyrje me llogari, për shembull një falas, shkon në
të njëjtën fushë.

## Ose zgjidh skedarin

**Zgjidh një skedar…** nën adresë merr një listë që e ke në pajisje:
`.m3u`, `.m3u8` ose të ngjeshur me gzip. Ajo lexohet në shfletues kur shtyp
**Lidhu**, dhe për të nuk shkarkohet asgjë. Për ta përditësuar, zgjidhe
skedarin sërish te **Cilësimet**: llogaria, të preferuarat dhe historiku i
saj mbeten.

## Çfarë lexohet nga lista

- **Grupet, logot dhe identifikuesit e udhëzuesit** të një liste
  `m3u_plus`, kështu që kanalet vijnë të renditura sipas vendit dhe temës.
- **Udhëzuesi i programeve**: adresa XMLTV që lista përmend në kreun e saj,
  ose një që e shkruan ti te **Adresa e udhëzuesit të programeve (XMLTV)**.
  Shih [udhëzuesin e programeve](/iptv-epg-guide/).
- **Catch-up**, aty ku lista shënon arkivin e një kanali.
- **Filmat dhe serialet** në të njëjtën listë, secili nën skedën e vet.
- **Një listë e thjeshtë pa grupe** që i shënon pjesët e saj me rreshta
  titujsh («===== Suedi =====») grupohet nën ata tituj.

## Kur nuk punon

- **Adresa nuk ktheu një listë M3U.** do të thotë se serveri u përgjigj me
  një faqe uebi ose me një gabim: shpesh një faqe hyrjeje ose një njoftim
  se llogaria ka skaduar. Kontrolloje adresën me ofruesin tënd.
- Nëse lista vjen nga një server Xtream Codes, luajtësi e thotë këtë pasi
  lidhet dhe ofron **Lidhu si Xtream Codes**, që sjell kategoritë,
  kopertinat dhe udhëzuesin e serverit. Shih
  [Xtream Codes](/xtream-codes-player/).

Disa lista mund të mbahen krah për krah si llogari, secila me të preferuarat
dhe historikun e vet. Më shumë te [udhëzuesi i përdorimit](https://github.com/BigTimeSam/kepuli-tv/blob/main/docs/user-guide.md#several-accounts) (në anglisht).
