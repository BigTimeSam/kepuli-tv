---
title: Reproductor de listas M3U, por dirección o archivo | Kepuli-TV
description: Reproduce una lista M3U o M3U8 en Chrome o Firefox con Kepuli-TV. Pega la dirección de la lista o elige el archivo, y tendrás grupos, logotipos, guía de programación XMLTV y catch-up.
alt: Los canales de una lista agrupados por país en Kepuli-TV, uno de ellos reproduciéndose
---

# Reproductor de listas M3U en el navegador

Kepuli-TV reproduce una lista M3U en una pestaña del navegador. Dale la
dirección de la lista o el propio archivo, y sus canales, películas y series
aparecen como listas en las que puedes buscar, filtrar y marcar favoritos.

## Añade una lista por su dirección

1. Instala Kepuli-TV y haz clic en su icono de la barra de herramientas.
2. Pega la dirección de la lista en **Dirección de la suscripción o de la
   lista**. El formulario empieza en **Dirección de la lista (M3U)**.
3. Pulsa **Conectar**. El navegador pregunta si Kepuli-TV puede acceder a ese
   servidor: elige **Permitir**, que solo afecta a ese servidor.

Una lista que no pide iniciar sesión, como una gratuita, va en el mismo
campo.

## O elige el archivo

**Elegir un archivo…**, bajo la dirección, toma una lista que tengas en el
dispositivo: `.m3u`, `.m3u8` o comprimida con gzip. Se lee en el navegador
cuando pulsas **Conectar**, y no se descarga nada para ello. Para ponerla al
día, vuelve a elegir el archivo en **Ajustes**: la cuenta, sus favoritos y su
historial se conservan.

## Qué se lee de la lista

- **Los grupos, los logotipos y los identificadores de guía** de una lista
  `m3u_plus`, de modo que los canales llegan ordenados por país y tema.
- **La guía de programación**: la dirección XMLTV que la lista indica en su
  cabecera, o la que introduzcas en **Dirección de la guía de programación
  (XMLTV)**. Consulta [la guía de programación](/iptv-epg-guide/).
- **El catch-up**, donde la lista marca el archivo de un canal.
- **Las películas y las series** de la misma lista, cada una en su pestaña.
- **Una lista simple sin grupos** que marca sus secciones con filas de
  título («===== Suecia =====») se agrupa bajo esos títulos.

## Cuando no funciona

- **La dirección no devolvió una lista M3U.** significa que el servidor
  respondió con una página web o un error: a menudo una página de inicio de
  sesión o un aviso de que la cuenta ha caducado. Comprueba la dirección con
  tu proveedor.
- Si la lista viene de un servidor Xtream Codes, el reproductor lo dice
  después de conectarse y ofrece **Conectar como Xtream Codes**, que trae
  las categorías, las carátulas y la guía del servidor. Consulta
  [Xtream Codes](/xtream-codes-player/).

Se pueden tener varias listas a la vez como cuentas, cada una con sus propios
favoritos y su historial. Más en la [guía de usuario](https://github.com/BigTimeSam/kepuli-tv/blob/main/docs/user-guide.md#several-accounts) (en inglés).
