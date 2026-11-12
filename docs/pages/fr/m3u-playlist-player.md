---
title: Lecteur de playlist M3U dans le navigateur, par adresse ou fichier | Kepuli-TV
description: Lisez une playlist M3U ou M3U8 dans Chrome ou Firefox avec Kepuli-TV. Collez l’adresse de la playlist ou choisissez le fichier : groupes, logos, guide des programmes XMLTV et replay.
alt: Les chaînes d’une playlist regroupées par pays dans Kepuli-TV, l’une d’elles en lecture
---

# Lecteur de playlist M3U dans le navigateur

Kepuli-TV lit une playlist M3U dans un onglet du navigateur. Donnez-lui
l’adresse de la playlist ou le fichier lui-même, et les chaînes, les films
et les séries qu’elle contient apparaissent en listes où vous pouvez
chercher, filtrer et marquer des favoris.

## Ajouter une playlist par son adresse

1. Installez Kepuli-TV et cliquez sur son icône dans la barre d’outils.
2. Collez l’adresse de la playlist dans **Adresse de l’abonnement ou de la
   playlist**. Le formulaire s’ouvre sur **Adresse de la playlist (M3U)**.
3. Appuyez sur **Se connecter**. Le navigateur demande si Kepuli-TV peut
   accéder à ce serveur : choisissez **Autoriser**, ce qui ne vaut que pour
   ce serveur.

Une playlist qui ne demande aucune connexion, une playlist gratuite par
exemple, se met dans le même champ.

## Ou choisir le fichier

**Choisir un fichier…**, sous l’adresse, prend une playlist que vous avez
sur l’appareil : `.m3u`, `.m3u8` ou compressée en gzip. Elle est lue dans le
navigateur quand vous appuyez sur **Se connecter**, et rien n’est téléchargé
pour cela. Pour la mettre à jour, choisissez de nouveau le fichier dans
**Réglages** : le compte, ses favoris et son historique restent.

## Ce qui est lu dans la playlist

- **Les groupes, les logos et les identifiants de guide** d’une liste
  `m3u_plus`, pour que les chaînes arrivent classées par pays et par thème.
- **Le guide des programmes** : l’adresse XMLTV que la playlist indique dans
  son en-tête, ou celle que vous saisissez sous **Adresse du guide des
  programmes (XMLTV)**. Voir [le guide des programmes](/iptv-epg-guide/).
- **Le replay**, là où la playlist signale les archives d’une chaîne.
- **Les films et les séries** de la même liste, chacun sous son onglet.
- **Une liste simple, sans groupes**, qui sépare ses sections par des lignes
  de titre (« ===== Sweden ===== ») est regroupée sous ces titres.

## Quand cela ne fonctionne pas

- **L’adresse n’a pas renvoyé de playlist M3U.** signifie que le serveur a
  répondu par une page web ou une erreur : souvent une page de connexion ou
  un avis indiquant que le compte a expiré. Vérifiez l’adresse auprès de
  votre fournisseur.
- Si la playlist vient d’un serveur Xtream Codes, le lecteur le signale
  après la connexion et propose **Se connecter en Xtream Codes**, qui
  apporte les catégories, les jaquettes et le guide du serveur. Voir
  [Xtream Codes](/xtream-codes-player/).

Plusieurs playlists peuvent être conservées côte à côte comme autant de
comptes, chacune avec ses favoris et son historique. Pour en savoir plus,
voir le [guide d’utilisation](https://github.com/BigTimeSam/kepuli-tv/blob/main/docs/user-guide.md#several-accounts) (en anglais).
