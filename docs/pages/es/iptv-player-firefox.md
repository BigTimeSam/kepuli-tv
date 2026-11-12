---
title: Reproductor IPTV para Firefox, un complemento gratuito | Kepuli-TV
description: Kepuli-TV es un complemento gratuito y de código abierto para ver IPTV en Mozilla Firefox. Tu lista M3U, cuenta Xtream Codes o portal Stalker en una pestaña, con guía de programación.
alt: La guía de programación de Kepuli-TV en Firefox, con el canal reproduciéndose en la esquina
---

# Reproductor IPTV para Firefox

Kepuli-TV es un complemento para Mozilla Firefox 130 o posterior que
reproduce tu propia suscripción de IPTV en una pestaña: canales en directo
con guía de programación, películas y series. El mismo complemento funciona
en [Firefox para Android](/iptv-player-android/) y, a través de Orion, en el
[iPhone](/iptv-player-iphone/). Es gratuito y de código abierto, y no incluye
canales propios.

## Instálalo en Firefox

1. Abre Kepuli-TV en Firefox Add-ons con el botón de arriba y elige
   **Agregar a Firefox**.
2. Haz clic en el icono de Kepuli-TV de la barra de herramientas. Si no está
   ahí, está bajo la pieza de puzle, desde donde se puede fijar a la barra.
3. El reproductor se abre en su propia pestaña y te pide los datos de tu
   proveedor.

## Conecta tu suscripción

Pega la dirección que te envió tu proveedor. El formulario deduce de qué tipo
es: una [lista M3U](/m3u-playlist-player/), una
[cuenta Xtream Codes](/xtream-codes-player/) o un
[portal Stalker](/stalker-portal-player/). Después Firefox pregunta si
Kepuli-TV puede acceder a ese servidor: elige **Permitir**, que solo afecta a
ese servidor. Antes de eso no se envía nada a ningún sitio.

## Cómo se reproduce en Firefox

- **Los archivos MKV** se desempaquetan en la pestaña y se reproducen con
  saltos. Firefox no tiene decodificador para el sonido AC-3, E-AC-3 ni DTS,
  así que el reproductor trae el suyo: consulta
  [MKV en el navegador](/mkv-player-browser/).
- **Los logotipos y las carátulas** que un proveedor sirve por http sin
  cifrar también se muestran en Firefox.
- **La sincronización entre ordenadores** va por la sincronización del propio
  Firefox, y está desactivada hasta que la actives.
- **Chromecast** no se ofrece: Firefox no tiene forma de llegar a uno. En su
  lugar, el menú del reproductor pasa la emisión a VLC o a otro reproductor.

## Conviene saber

- La [guía de programación](/iptv-epg-guide/), el catch-up, la grabación y
  los treinta idiomas son los mismos que en Chrome.
- Todo lo demás está en la [guía de usuario](https://github.com/BigTimeSam/kepuli-tv/blob/main/docs/user-guide.md) (en inglés).
