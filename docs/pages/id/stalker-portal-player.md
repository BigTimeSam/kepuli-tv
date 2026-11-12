---
title: Pemutar portal Stalker di browser, dengan alamat MAC | Kepuli-TV
description: Tonton portal Stalker (MAG) di Chrome atau Firefox tanpa set-top box. Kepuli-TV memakai alamat portal dan alamat MAC yang terdaftar pada langgananmu.
alt: Saluran langsung di Kepuli-TV, salah satunya diputar di samping daftar
---

# Pemutar portal Stalker di browser

Penyedia yang menjual layanannya untuk set-top box MAG memberikan alamat
portal, sering kali berakhiran `/c/`, dan mendaftarkan alamat MAC untuk
perangkat itu. Tidak ada nama pengguna atau kata sandi. Kepuli-TV berbicara
dengan portal semacam itu dari tab browser, sehingga langganan bisa ditonton
tanpa perangkatnya.

## Menghubungkan ke portal

1. Pasang Kepuli-TV dan klik ikonnya di bilah alat.
2. Tempel alamat portal di **Alamat langganan atau daftar putar**. Alamat
   yang berakhiran `/c/` dikenali, dan formulir berpindah ke **Portal
   Stalker (alamat MAC)**.
3. Isi alamat MAC yang terdaftar pada langgananmu.
4. Tekan **Hubungkan** dan pilih **Izinkan** saat browser bertanya apakah
   Kepuli-TV boleh menjangkau portal.

> [!IMPORTANT]
> Gunakan hanya alamat MAC yang terdaftar pada langgananmu sendiri. Alamat
> milik orang lain, atau dari daftar yang dibagikan, tidak boleh dipakai:
> lihat [ketentuan penggunaan](/terms/).

## Yang sudah berfungsi

- **Saluran, film, dan serial** sebagaimana didaftar portal.
- **Data acara milik portal** di daftar dan di
  [panduan acara](/iptv-epg-guide/).
- **Penyambungan ulang**: tautan siaran portal sering kali hanya berlaku
  untuk satu koneksi, jadi pemutar meminta yang baru setiap kali siaran
  langsung dibuka lagi.

## Yang belum

- **Arsip portal** (catch-up) belum tersedia.
- **Sinkronisasi** tidak menyertakan akun Stalker kecuali **Sertakan kata
  sandi** menyala, karena alamat MAC sama nilainya dengan kata sandi.

## Cara menjangkau portal

Portal mengharapkan perangkat MAG: alamat MAC di dalam cookie dan nama
set-top box sebagai nama browser. Halaman web tidak bisa mengaturnya sendiri,
jadi ekstensi mengaturnya hanya untuk permintaannya sendiri ke server
portal, dan aturan itu hilang saat browser ditutup. Rinciannya ada di
[panduan pengguna](https://github.com/BigTimeSam/kepuli-tv/blob/main/docs/user-guide.md#stalker-portals) (dalam bahasa Inggris).
