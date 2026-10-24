# Changelog

Format : [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), versionnage [SemVer](https://semver.org/lang/fr/).

## [0.5.0] - 2026-10-24

### Ajouté

- Compte Yzo et synchronisation chiffrée de bout en bout des espaces, favoris, onglets épinglés, dossiers, vues scindées épinglées et réglages (`docs/sync.md`). Le mot de passe ne quitte jamais l'appareil : scrypt puis HKDF en dérivent une clé d'authentification (envoyée) et une clé d'enveloppe (gardée). Les données sont chiffrées en AES-256-GCM, liées à leur identifiant.
- Clé de récupération affichée une seule fois à l'inscription.
- Session et clé de coffre conservées chiffrées par le trousseau du système (Electron `safeStorage`).
- Moteur de synchronisation : projection de l'état en enregistrements, détection des changements, fusion avec réparation de l'arbre, adoption des données du compte sur un nouvel appareil vierge, boucle (démarrage, 60 s, 2 s après un changement, nouvel essai sur conflit).
- Panneau Compte (icône personnage dans le dock) : inscription, connexion, état de la synchronisation, synchronisation manuelle, déconnexion, suppression du compte.
- 15 tests (chiffrement, synchronisation entre deux appareils simulés).

## [0.4.0] - 2026-10-24

### Ajouté

- Extensions Chrome : installation depuis le Chrome Web Store (le bouton « Ajouter à Chrome » fonctionne, avec une confirmation qui liste les permissions), chargement au démarrage et mises à jour automatiques (`electron-chrome-web-store`).
- API d'extensions via `electron-chrome-extensions` : icônes dans l'en-tête de la barre latérale avec popups et badges, entrées de menu contextuel, `chrome.tabs` (les onglets Yzo sont exposés comme onglets Chrome ; une extension peut en créer, en activer, en fermer).
- Menu Extensions (bouton puzzle) : liste des extensions installées, options, suppression, lien vers le Chrome Web Store.
- Les pages d'extension (`chrome-extension://`, par exemple les pages d'options) s'ouvrent dans des onglets.
- Licence GPL-3.0-or-later (`LICENSE`).

### Modifié

- Le preload de l'interface est généré (`pnpm preload`) pour y intégrer le support des icônes d'extensions, le preload sandboxé ne pouvant pas charger de module externe.
- Le dossier `re/` (notes d'analyse d'Arc) est exclu du dépôt.

## [0.3.0] - 2026-10-24

### Modifié

- Les onglets passent de `<webview>` (déconseillé par Electron) à des `WebContentsView` natives gérées par le process principal. L'interface envoie la position de chaque page ; navigation, titres, favicons et focus remontent par IPC.
- Les superpositions (barre de commande, menus, barre flottante, archive, éditeur d'espace, Peek) « gèlent » les pages : capture, affichage de la capture, puis masquage de la vue native, pour passer devant sans saut visible. Même mécanisme pendant le glissement des séparateurs de vue scindée et le redimensionnement de la barre latérale.
- Peek utilise sa propre vue native, placée dans la carte d'aperçu.
- Le focus clavier suit l'onglet sélectionné.
- La fenêtre de l'interface n'est plus ralentie en arrière-plan (`backgroundThrottling: false`), pour que la synchronisation des pages continue quand elle est masquée.

## [0.2.0] - 2026-10-24

### Ajouté

- Vraies fenêtres pop-up pour les pages qui en ouvrent (`window.open` avec dimensions) : les connexions « Se connecter avec Google / GitHub / … » gardent leur lien `window.opener` et renvoient le résultat au site. Les pop-ups partagent la session des onglets et suivent les mêmes règles de sécurité.

### Modifié

- Yzo s'annonce aux sites comme un Chrome standard (`Chrome/150.0.0.0`, sans les mentions `Electron` ni `yzo`), pour que Google et les autres services n'y voient plus un navigateur embarqué.
- Les liens qui ouvraient le Peek par défaut ouvrent maintenant un onglet ; le Peek reste disponible par clic droit.

## [0.1.1] - 2026-10-24

### Modifié

- Animations de la barre latérale plus fluides et plus visibles : la barre flottante glisse depuis la gauche avec une courbe décélérée à l'ouverture (340 ms) et repart en accélérant à la fermeture (170 ms, après 120 ms de grâce ; total ≈ 0,3 s au lieu de ≈ 0,7 s), au lieu de disparaître d'un coup. `Ctrl+S` replie la barre ancrée en largeur pendant que la page s'élargit, au lieu d'un saut. Animations désactivées si le système demande moins de mouvement.
- Marge autour de la zone des sites réduite de 8 à 6 px.
- En-tête de la barre latérale sur deux lignes : logo provisoire « y » (SVG au trait, même hauteur et même centre que les icônes) à gauche et réduire, agrandir, fermer à droite en haut ; barre latérale, précédent, suivant, recharger en dessous, avec un bouton Extensions calé à droite (menu provisoire « Aucune extension installée », la prise en charge n'existe pas encore). Icônes de fenêtre à la même taille que celles de navigation.

### Corrigé

- La barre latérale masquée ne réapparaissait plus au survol du bord gauche : le bord était une zone de déplacement de fenêtre, qui ne reçoit aucun événement souris sous Electron.
- En mode masqué, une bande en haut de la fenêtre permet de nouveau de la déplacer.
- La barre flottante se fermait en remontant la souris vers ses boutons : son en-tête était une zone de déplacement de fenêtre. Elle tolère aussi un bref écart (120 ms).
- La zone de survol de la barre flottante couvre toute la colonne de gauche : les marges du haut, du bas et de gauche la gardent ouverte, seule la sortie vers la droite la ferme. La position réelle du curseur est lue depuis le process principal, car une webview capte les événements souris.
- `pnpm dev` restait bloqué : Vite écoutait seulement en IPv6 alors qu'Electron l'attendait sur 127.0.0.1.

## [0.1.0] - 2026-10-24

### Ajouté

- Rapport de rétro-ingénierie d'Arc 1.129 pour Windows (REA + Ghidra 12.1.4) et preuves associées dans `re/`.
- Application Electron 43 sans cadre, avec barre latérale verticale, favoris, sections épinglée et du jour, dossiers, glisser-déposer.
- Espaces avec emoji, dégradé tiré des palettes d'Arc, modes clair/sombre/auto, dock et raccourcis `Ctrl+1…9`.
- Barre de commande : URL, recherche (Google, DuckDuckGo, Bing), passage aux onglets ouverts, historique, dédoublonnage titre + domaine, mémoire des choix.
- Vue scindée de 2 à 4 panneaux, horizontale ou verticale, redimensionnable.
- Peek pour les liens ouverts dans une nouvelle fenêtre.
- Archive avec auto-archivage configurable (1 h → 30 j, ou jamais) et restauration.
- Raccourcis clavier actifs même quand une page a le focus.
- Persistance atomique de l'état avec sauvegarde `.bak` et validation au chargement.
- Durcissement des webviews (schémas autorisés, sandbox, permissions refusées par défaut).
- 43 tests Vitest : reducer, persistance, URL, barre de commande, thèmes, raccourcis.
