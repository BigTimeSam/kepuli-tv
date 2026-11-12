---
title: Reproductor de portales Stalker en el navegador, con tu MAC | Kepuli-TV
description: Ve un portal Stalker (MAG) en Chrome o Firefox sin receptor. Kepuli-TV usa la dirección del portal y la dirección MAC registrada en tu suscripción.
alt: Canales en directo en Kepuli-TV, uno de ellos reproduciéndose junto a la lista
---

# Reproductor de portales Stalker en el navegador

Un proveedor que vende su servicio para receptores MAG da una dirección de
portal, que a menudo termina en `/c/`, y registra una dirección MAC para el
receptor. No hay usuario ni contraseña. Kepuli-TV habla con un portal así
desde una pestaña del navegador, de modo que la suscripción se puede ver sin
el receptor.

## Conéctate a un portal

1. Instala Kepuli-TV y haz clic en su icono de la barra de herramientas.
2. Pega la dirección del portal en **Dirección de la suscripción o de la
   lista**. Una dirección que termina en `/c/` se reconoce, y el formulario
   pasa a **Portal Stalker (dirección MAC)**.
3. Introduce la dirección MAC registrada en tu suscripción.
4. Pulsa **Conectar** y elige **Permitir** cuando el navegador pregunte si
   Kepuli-TV puede acceder al portal.

> [!IMPORTANT]
> Usa solo la dirección MAC registrada en tu propia suscripción. No se puede
> usar la de otra persona ni una sacada de una lista compartida: consulta las
> [condiciones de uso](/terms/).

## Qué funciona

- **Los canales, las películas y las series** tal como los lista el portal.
- **Los datos de programación del propio portal** en la lista y en
  [la guía de programación](/iptv-epg-guide/).
- **La reconexión**: el enlace de emisión de un portal a menudo solo vale
  para una conexión, así que el reproductor pide uno nuevo cada vez que se
  vuelve a abrir una emisión en directo.

## Qué no funciona todavía

- **El archivo del portal** (catch-up) aún no está disponible.
- **La sincronización** deja fuera una cuenta Stalker salvo que **Incluir
  contraseñas** esté activado, porque la dirección MAC vale tanto como una
  contraseña.

## Cómo llega al portal

Un portal espera un receptor MAG: la dirección MAC en una cookie y el nombre
de un receptor en lugar del nombre del navegador. Una página web no puede
fijarlos por sí misma, así que la extensión los fija solo para sus propias
peticiones al servidor del portal, y la regla desaparece cuando se cierra el
navegador. Los detalles están en la
[guía de usuario](https://github.com/BigTimeSam/kepuli-tv/blob/main/docs/user-guide.md#stalker-portals) (en inglés).
