# Kepuli-TV – IPTV Player

En gratis IPTV-spelare med öppen källkod för Chrome och Firefox. Ta med ditt
eget Xtream Codes-konto, din M3U-spellista eller din Stalker-portal och se
live-tv, filmer och serier i en webbläsarflik. Det finns ingen app att
installera och inget konto hos oss, och dina uppgifter stannar i din
webbläsare.

| Webbläsare | Installera |
| --- | --- |
| Google Chrome 116 eller senare | [Chrome Web Store](https://chromewebstore.google.com/detail/kepuli-tv/okkgclcakhjhldkdcblgagoaibghpfmi) |
| Mozilla Firefox 130 eller senare | [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/kepuli-tv/) |
| Android: Firefox för Android 142 eller senare | [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/kepuli-tv/), se [På en telefon eller surfplatta](#på-en-telefon-eller-surfplatta) |
| iPhone (iOS): Orion | Orions egen lista över tillägg, se [På en telefon eller surfplatta](#på-en-telefon-eller-surfplatta) |

**[Se rundturen på fyra minuter på YouTube](https://youtu.be/Wr4FcXlTbOM)**

På [Kepuli-TV:s webbplats](https://bigtimesam.github.io/kepuli-tv/) finns
guider steg för steg för varje webbläsare, telefon och typ av abonnemang, på
trettio språk.

## Viktiga funktioner

- **Live-tv** efter land och ämne, med vad som går just nu, en interaktiv
  programguide, uppspelning i efterhand och programsökning
- **Filmer och serier** som omslag eller lista, filtrerade efter kategori och
  längd, med handling, betyg, regissör, skådespelare, liknande titlar och
  filens format, och om den går att spela i din webbläsare; filmer markeras
  som sedda, uppspelningen fortsätter där du slutade och nästa avsnitt
  följer
- **En startsida** med det du lämnade halvvägs, vad som går på dina kanaler
  nu och snart, och kanalerna du såg senast
- **MKV i webbläsaren**, även med spolning, med undertexter i den storlek och
  stil du väljer och alla ljudspår, även AC-3, E-AC-3 och DTS
- **Inspelning** av kanalen du tittar på, eller av ett program som planeras
  från guiden; den ligger kvar i webbläsaren och sparas som en fil när du
  vill
- **Två kanaler sida vid sida**, när ditt abonnemang tillåter två strömmar
  eller du har ett konto till
- **Favoriter** överallt, egna kanallistor, och bara de länder och
  kategorier du väljer
- **Flera konton** sida vid sida, och synkronisering mellan datorer genom
  webbläsarens egen synkronisering, avstängd tills du slår på den
- **Chromecast**, bild i bild, och överlämning till VLC eller en annan
  spelare
- **Gjord för tangentbordet**, på trettio språk, mörk eller ljus

## Kom igång

1. Installera Kepuli-TV från din webbläsares butik och klicka på ikonen i
   verktygsfältet.
2. Klistra in M3U-adressen från din leverantör (eller välj spellistan som en
   fil), eller ange Xtream Codes-servern, användarnamnet och lösenordet,
   eller en Stalker-portal med den MAC-adress som är registrerad på ditt
   abonnemang.
3. Välj ett land och en kanal. Tryck på `?` för kortkommandona.

> [!IMPORTANT]
> Kepuli-TV innehåller inga kanaler och inget innehåll: du behöver ett eget
> abonnemang.

## På en telefon eller surfplatta

Kepuli-TV fungerar också på Android och på iPhone, i en webbläsare som tar
emot Firefox-tillägg. Chrome för Android och Safari installerar inga
tillägg, så det blir en av de här två:

**Android: Firefox**

1. Installera [Firefox](https://play.google.com/store/apps/details?id=org.mozilla.firefox)
   (142 eller senare) från Play Store.
2. Öppna [Kepuli-TV på Firefox Add-ons](https://addons.mozilla.org/firefox/addon/kepuli-tv/)
   i den och tryck på **Lägg till i Firefox**, eller välj **Tillägg** i
   Firefox meny och sök efter Kepuli-TV där.
3. Öppna Firefox meny, välj **Tillägg** och sedan **Kepuli-TV**: spelaren
   öppnas i en flik.

**iPhone (iOS): Orion**

1. Installera [Orion Browser by Kagi](https://apps.apple.com/app/orion-browser-by-kagi/id1484498200)
   från App Store. Den installerar Firefox-tillägg, vilket Safari och de
   andra webbläsarna på iOS inte gör.
2. Välj **Extensions** i Orions meny, sedan **+** och **Install Firefox
   extension**, sök efter Kepuli-TV och installera det.
3. Välj **Kepuli-TV** i Orions meny för att öppna spelaren.

Därifrån är det som på en dator: lägg till ditt konto som i
[Kom igång](#kom-igång), så anpassar sig listorna, programguiden och
spelaren efter skärmen. Det här skiljer sig på en telefon:

- **Helskärm** är knappen i sidhuvudet på Android, och iPhones egen
  videospelare på iPhone.
- **Öppna i VLC** i spelarens meny lämnar över strömmen till VLC-appen; om
  VLC inte är installerat öppnas dess sida i butiken.
- **Chromecast** erbjuds inte på iPhone, där ingen webbläsare når en sådan;
  AirPlay finns bland reglagen i iPhones egen spelare i helskärm. På Android
  kan VLC skicka strömmen vidare till en Chromecast.
- **På iPhone** kan en direktsänd kanal vänta på ett tryck på **Spela**
  innan den startar, eftersom iOS tillåter ljud först efter en beröring.

## Användarhandbok

[Användarhandboken](https://github.com/BigTimeSam/kepuli-tv/blob/main/docs/user-guide.md)
(på engelska) går igenom allt i detalj: konton, Stalker-portaler,
inspelning, synkronisering, programguiden, tangenterna, inställningarna och
vad du gör när något går fel.

Har du hittat en bugg? Öppna ett [ärende på GitHub](https://github.com/BigTimeSam/kepuli-tv/issues)
och berätta vilken webbläsare du har och vilka steg som leder dit.

> [!WARNING]
> Lämna dina inloggningsuppgifter, och alla strömadresser som innehåller
> dem, utanför ärendet: det är offentligt.

## Avsedd användning

Kepuli-TV är enbart en spelare. Den levereras utan kanaler, spellistor och
media, den varken lagrar eller länkar till sådant, och den spelar ingenting
förrän du lägger till ett konto eller en spellista från din egen leverantör.

> [!IMPORTANT]
> Använd den bara för innehåll du har rätt att se, till exempel ditt eget
> abonnemang, och behåll inspelningar för eget bruk.

Upphovspersonen varken säljer, tillhandahåller eller rekommenderar
IPTV-abonnemang eller leverantörer, och ärenden på GitHub som ber om sådana
stängs.

Dina inloggningsuppgifter sparas i webbläsarens egen lagring på din dator
och når andra datorer bara om du slår på synkronisering och tar med
lösenord. Se [integritetspolicyn](https://bigtimesam.github.io/kepuli-tv/privacy/)
och [användarvillkoren](https://bigtimesam.github.io/kepuli-tv/terms/).
