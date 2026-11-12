# Kepuli-TV – IPTV Player

Un lecteur IPTV gratuit et open source pour Chrome et Firefox. Apportez votre
compte Xtream Codes, votre playlist M3U ou votre portail Stalker, et regardez
la télé en direct, les films et les séries dans un onglet du navigateur. Il
n’y a ni application à installer ni compte à créer chez nous, et vos données
restent dans votre navigateur.

| Navigateur | Installation |
| --- | --- |
| Google Chrome 116 ou plus récent | [Chrome Web Store](https://chromewebstore.google.com/detail/kepuli-tv/okkgclcakhjhldkdcblgagoaibghpfmi) |
| Mozilla Firefox 130 ou plus récent | [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/kepuli-tv/) |
| Android : Firefox pour Android 142 ou plus récent | [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/kepuli-tv/), voir [Sur un téléphone ou une tablette](#sur-un-téléphone-ou-une-tablette) |
| iPhone (iOS) : Orion | La liste d’extensions d’Orion, voir [Sur un téléphone ou une tablette](#sur-un-téléphone-ou-une-tablette) |

**[Regarder la visite de quatre minutes sur YouTube](https://youtu.be/Wr4FcXlTbOM)**

Le [site de Kepuli-TV](https://bigtimesam.github.io/kepuli-tv/) propose des
guides pas à pas pour chaque navigateur, chaque téléphone et chaque type
d’abonnement, en trente langues.

## Fonctions principales

- **La télé en direct** par pays et par thème, avec le programme en cours, un
  guide des programmes interactif, le replay et la recherche de programmes
- **Les films et les séries** en jaquettes ou en liste, filtrés par catégorie
  et par durée, avec le résumé, la note, le réalisateur, la distribution, les
  titres proches et le format du fichier, et s’il se lit dans votre
  navigateur ; les films vus sont marqués, la lecture reprend là où vous vous
  étiez arrêté et l’épisode suivant s’enchaîne
- **Une page d’accueil** avec ce que vous avez laissé à moitié, ce qui passe
  sur vos chaînes maintenant et bientôt, et les chaînes regardées récemment
- **Le MKV dans le navigateur**, déplacement dans le fichier compris, avec des
  sous-titres à la taille et dans le style de votre choix et toutes les pistes
  audio, AC-3, E-AC-3 et DTS aussi
- **L’enregistrement** de la chaîne que vous regardez, ou d’une émission
  programmée depuis le guide, conservé dans le navigateur et sauvegardé dans
  un fichier quand vous le voulez
- **Deux chaînes côte à côte**, si votre abonnement autorise deux flux ou si
  vous avez un second compte
- **Des favoris** partout, des listes de chaînes personnelles, et seulement
  les pays et les catégories que vous choisissez
- **Plusieurs comptes** côte à côte, et la synchronisation entre ordinateurs
  par celle du navigateur, désactivée tant que vous ne l’activez pas
- **Chromecast**, l’image dans l’image, et le passage du flux à VLC ou à un
  autre lecteur
- **Pensé pour le clavier**, en trente langues, sombre ou clair

## Pour commencer

1. Installez Kepuli-TV depuis la boutique de votre navigateur et cliquez sur
   son icône dans la barre d’outils.
2. Collez l’adresse M3U de votre fournisseur (ou choisissez la playlist sous
   forme de fichier), ou saisissez le serveur Xtream Codes, le nom
   d’utilisateur et le mot de passe, ou encore un portail Stalker avec
   l’adresse MAC enregistrée pour votre abonnement.
3. Choisissez un pays et une chaîne. Appuyez sur `?` pour voir les raccourcis
   clavier.

> [!IMPORTANT]
> Kepuli-TV ne contient ni chaînes ni contenus : il vous faut votre propre
> abonnement.

## Sur un téléphone ou une tablette

Kepuli-TV fonctionne aussi sur Android et sur iPhone, dans un navigateur qui
accepte les modules complémentaires de Firefox. Chrome pour Android et Safari
n’installent pas d’extensions : c’est donc l’un de ces deux-là.

**Android : Firefox**

1. Installez [Firefox](https://play.google.com/store/apps/details?id=org.mozilla.firefox)
   (142 ou plus récent) depuis le Play Store.
2. Ouvrez-y [Kepuli-TV sur Firefox Add-ons](https://addons.mozilla.org/firefox/addon/kepuli-tv/)
   et touchez **Ajouter à Firefox**, ou choisissez **Extensions** dans le menu
   de Firefox et cherchez-y Kepuli-TV.
3. Ouvrez le menu de Firefox, choisissez **Extensions** puis **Kepuli-TV** :
   le lecteur s’ouvre dans un onglet.

**iPhone (iOS) : Orion**

1. Installez [Orion Browser by Kagi](https://apps.apple.com/app/orion-browser-by-kagi/id1484498200)
   depuis l’App Store. Il installe les modules complémentaires de Firefox, ce
   que ne font ni Safari ni les autres navigateurs sur iOS.
2. Dans le menu d’Orion, choisissez **Extensions**, puis **+** et **Install
   Firefox extension**, cherchez Kepuli-TV et installez-le.
3. Choisissez **Kepuli-TV** dans le menu d’Orion pour ouvrir le lecteur.

Ensuite, tout se passe comme sur un ordinateur : ajoutez votre compte comme
dans [Pour commencer](#pour-commencer), et les listes, le guide des programmes
et le lecteur s’adaptent à l’écran. Ce qui change sur un téléphone :

- **Plein écran** est le bouton de l’en-tête sur Android, et le lecteur vidéo
  de l’iPhone sur iPhone.
- **Ouvrir dans VLC**, dans le menu du lecteur, passe le flux à l’application
  VLC ; si VLC n’est pas installé, sa page dans la boutique s’ouvre.
- **Chromecast** n’est pas proposé sur iPhone, où aucun navigateur ne peut en
  atteindre un ; AirPlay se trouve parmi les commandes du lecteur de l’iPhone
  en plein écran. Sur Android, VLC peut envoyer le flux vers un Chromecast.
- **Sur iPhone**, une chaîne en direct peut attendre que vous touchiez
  **Lire** avant de démarrer, car iOS n’autorise le son qu’après un toucher.

## Guide d’utilisation

Le [guide d’utilisation](https://github.com/BigTimeSam/kepuli-tv/blob/main/docs/user-guide.md)
(en anglais) couvre tout en détail : les comptes, les portails Stalker,
l’enregistrement, la synchronisation, le guide des programmes, les touches,
les réglages et ce qu’il faut faire quand quelque chose ne va pas.

Vous avez trouvé un bogue ? Ouvrez un [ticket sur GitHub](https://github.com/BigTimeSam/kepuli-tv/issues)
en indiquant votre navigateur et les étapes qui y mènent.

> [!WARNING]
> N’y mettez ni vos identifiants ni une adresse de flux qui les contient :
> un ticket est public.

## Usage prévu

Kepuli-TV n’est qu’un lecteur. Il est livré sans chaînes, sans playlists et
sans médias, n’en héberge aucun, ne renvoie vers aucun, et ne lit rien tant
que vous n’avez pas ajouté un compte ou une playlist de votre propre
fournisseur.

> [!IMPORTANT]
> Ne l’utilisez que pour des contenus que vous avez le droit de regarder,
> comme votre propre abonnement, et gardez les enregistrements pour votre
> usage personnel.

L’auteur ne vend, ne fournit et ne recommande ni abonnements ni fournisseurs
IPTV, et les tickets GitHub qui en demandent sont fermés.

Vos identifiants sont conservés dans le stockage du navigateur, sur votre
ordinateur, et n’atteignent d’autres ordinateurs que si vous activez la
synchronisation et y incluez les mots de passe. Voir la
[politique de confidentialité](https://bigtimesam.github.io/kepuli-tv/privacy/) et les
[conditions d’utilisation](https://bigtimesam.github.io/kepuli-tv/terms/).
