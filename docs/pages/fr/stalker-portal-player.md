---
title: Lecteur de portail Stalker dans le navigateur, par adresse MAC | Kepuli-TV
description: Regardez un portail Stalker (MAG) dans Chrome ou Firefox sans boîtier. Kepuli-TV prend l’adresse du portail et l’adresse MAC enregistrée pour votre abonnement.
alt: Des chaînes en direct dans Kepuli-TV, l’une d’elles en lecture à côté de la liste
---

# Lecteur de portail Stalker dans le navigateur

Un fournisseur qui vend son service pour les boîtiers MAG donne une adresse
de portail, qui se termine souvent par `/c/`, et enregistre une adresse MAC
pour le boîtier. Il n’y a ni nom d’utilisateur ni mot de passe. Kepuli-TV
dialogue avec un tel portail depuis un onglet du navigateur : l’abonnement
se regarde donc sans le boîtier.

## Se connecter à un portail

1. Installez Kepuli-TV et cliquez sur son icône dans la barre d’outils.
2. Collez l’adresse du portail dans **Adresse de l’abonnement ou de la
   playlist**. Une adresse qui se termine par `/c/` est reconnue, et le
   formulaire passe à **Portail Stalker (adresse MAC)**.
3. Saisissez l’adresse MAC enregistrée pour votre abonnement.
4. Appuyez sur **Se connecter** et choisissez **Autoriser** quand le
   navigateur demande si Kepuli-TV peut accéder au portail.

> [!IMPORTANT]
> N’utilisez que l’adresse MAC enregistrée pour votre propre abonnement.
> Celle d’une autre personne, ou une adresse tirée d’une liste partagée, ne
> doit pas être utilisée : voir les
> [conditions d’utilisation](/terms/).

## Ce qui fonctionne

- **Les chaînes, les films et les séries** tels que le portail les liste.
- **Les données de programmes du portail** dans la liste et dans
  [le guide des programmes](/iptv-epg-guide/).
- **La reconnexion** : le lien de flux d’un portail ne vaut souvent que pour
  une seule connexion ; le lecteur en demande donc un nouveau chaque fois
  qu’un flux en direct est rouvert.

## Ce qui ne fonctionne pas encore

- **Les archives du portail** (le replay) ne sont pas encore disponibles.
- **La synchronisation** laisse de côté un compte Stalker, sauf si
  **Inclure les mots de passe** est activé, car l’adresse MAC vaut un mot de
  passe.

## Comment il atteint le portail

Un portail s’attend à un boîtier MAG : l’adresse MAC dans un cookie et le
nom d’un boîtier à la place de celui du navigateur. Une page web ne peut pas
les définir elle-même ; l’extension les définit donc pour ses propres
requêtes vers le serveur du portail, et pour elles seules, et la règle
disparaît à la fermeture du navigateur. Les détails sont dans le
[guide d’utilisation](https://github.com/BigTimeSam/kepuli-tv/blob/main/docs/user-guide.md#stalker-portals) (en anglais).
