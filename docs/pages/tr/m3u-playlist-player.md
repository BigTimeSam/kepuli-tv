---
title: Tarayıcıda M3U oynatma listesi oynatıcı, adresle ya da dosyayla | Kepuli-TV
description: M3U ya da M3U8 oynatma listeni Kepuli-TV ile Chrome’da veya Firefox’ta oynat. Listenin adresini yapıştır ya da dosyayı seç; gruplar, logolar, XMLTV program rehberi ve geri izleme gelir.
alt: Kepuli-TV’de bir oynatma listesinin ülkelere göre gruplanmış kanalları, biri oynuyor
---

# Tarayıcıda M3U oynatma listesi oynatıcı

Kepuli-TV, M3U oynatma listesini tarayıcı sekmesinde oynatır. Ona listenin
adresini ya da dosyanın kendisini ver; içindeki kanallar, filmler ve diziler
arayabileceğin, süzebileceğin ve favorilere ekleyebileceğin listeler olarak
görünür.

## Oynatma listesini adresiyle ekle

1. Kepuli-TV’yi kur ve araç çubuğundaki simgesine tıkla.
2. Listenin adresini **Abonelik veya oynatma listesi adresi** alanına
   yapıştır. Form **Oynatma listesi adresi (M3U)** seçiliyken açılır.
3. **Bağlan**’a bas. Tarayıcı, Kepuli-TV’nin o sunucuya erişip
   erişemeyeceğini sorar: **İzin ver**’i seç; izin yalnızca o sunucuyu
   kapsar.

Giriş gerektirmeyen bir oynatma listesi, örneğin ücretsiz bir liste de aynı
alana girilir.

## Ya da dosyayı seç

Adresin altındaki **Dosya seç…**, cihazındaki bir oynatma listesini alır:
`.m3u`, `.m3u8` ya da gzip ile sıkıştırılmış. Dosya, **Bağlan**’a bastığında
tarayıcıya okunur ve bunun için hiçbir şey indirilmez. Güncellemek için
dosyayı **Ayarlar**’da yeniden seç: hesap, favorileri ve geçmişi yerinde
kalır.

## Oynatma listesinden neler okunur

- Bir `m3u_plus` listesinin **grupları, logoları ve rehber kimlikleri**;
  böylece kanallar ülkeye ve konuya göre sıralanmış gelir.
- **Program rehberi**: listenin başlığında belirttiği XMLTV adresi ya da
  **Program rehberi adresi (XMLTV)** altına senin girdiğin adres. Bkz.
  [program rehberi](/iptv-epg-guide/).
- **Geri izleme**, listenin bir kanalın arşivini işaretlediği yerlerde.
- Aynı listedeki **filmler ve diziler**, her biri kendi sekmesinde.
- Bölümlerini başlık satırlarıyla (“===== Sweden =====”) ayıran **grupsuz
  düz bir liste**, bu başlıkların altında gruplanır.

## Çalışmadığında

- **Adres bir M3U oynatma listesi döndürmedi.** mesajı, sunucunun bunun
  yerine bir web sayfası ya da hata döndürdüğü anlamına gelir: çoğu zaman
  bir giriş sayfası ya da hesabın süresinin dolduğunu bildiren bir not.
  Adresi sağlayıcınla birlikte kontrol et.
- Oynatma listesi bir Xtream Codes sunucusundan geliyorsa oynatıcı
  bağlandıktan sonra bunu söyler ve **Xtream Codes olarak bağlan**’ı
  önerir; bu, sunucunun kategorilerini, kapaklarını ve rehberini getirir.
  Bkz. [Xtream Codes](/xtream-codes-player/).

Birden çok oynatma listesi, her biri kendi favorileri ve geçmişiyle hesap
olarak yan yana tutulabilir. Ayrıntılar [kullanım kılavuzunda](https://github.com/BigTimeSam/kepuli-tv/blob/main/docs/user-guide.md#several-accounts) (İngilizce).
