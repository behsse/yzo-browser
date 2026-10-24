# Yzo

Navigateur de bureau inspiré d'Arc, reconstruit « en salle blanche » à partir de l'analyse d'Arc pour Windows. Aucun code, image ni ressource d'Arc n'est copié. Seuls le comportement observé, les formes de données et les énumérations ont servi de référence. Les notes d'analyse restent locales (dossier `re/`, exclu du dépôt).

Stack : Electron 43 dans sa version [castLabs ECS](https://github.com/castlabs/electron-releases) (Chromium + Widevine, comme `ArcCore.dll`) · React 19 · TypeScript 7 · Vite 8 · Vitest 5.

## Fonctionnalités

| Fonction | Détail |
|---|---|
| Barre latérale verticale | Favoris partagés entre espaces, section épinglée, séparateur, onglets « du jour ». Redimensionnable (180–420 px). |
| Espaces | Nom, emoji, dégradé de deux couleurs issu des palettes d'Arc (pastel, terne, gris), mode clair/sombre/auto. Dock en bas de la barre. |
| Barre de commande | Une seule saisie pour les URL, la recherche et le passage à un onglet ouvert. Dédoublonnage titre + domaine pour Figma, Notion, GitHub… Mémorise le type de résultat choisi pour chaque requête. |
| Vue scindée | 2 à 4 panneaux, côte à côte ou empilés, séparateurs déplaçables, enregistrée comme un élément de la barre latérale. |
| Peek | Les liens qui ouvrent une nouvelle fenêtre (`target=_blank`) s'affichent en aperçu, avec un bouton « Ouvrir dans un onglet ». |
| Archive | Les onglets du jour fermés ou inactifs sont archivés et restaurables. Délai d'auto-archivage : 1 h, 12 h (défaut), 24 h, 7 j, 30 j ou jamais. |
| Dossiers | Création, renommage, repli, glisser-déposer, imbrication. |
| Onglets épinglés | Fermer un onglet épinglé le décharge et le ramène à son URL d'origine, comme Arc. |
| Barre masquée | `Ctrl+S` masque la barre ; elle réapparaît au survol du bord gauche. |
| Extensions Chrome | Installation depuis le Chrome Web Store (bouton « Ajouter à Chrome », avec confirmation des permissions), mises à jour automatiques. Icônes, popups, badges, menus contextuels et API d'onglets (`chrome.tabs`) pris en charge. Gestion (options, suppression) via le bouton puzzle. |
| Compte et synchronisation | Compte Yzo (icône personnage dans le dock) : espaces, favoris, onglets épinglés, dossiers et réglages synchronisés entre ordinateurs, **chiffrés de bout en bout** (le serveur ne voit ni le mot de passe ni les données). Clé de récupération à l'inscription, session gardée par le trousseau du système. Voir [docs/sync.md](docs/sync.md). |
| Vidéo protégée (DRM) | Widevine via castLabs ECS : Spotify, Deezer, Prime Video, Disney+… Netflix et les services les plus stricts exigent en plus la signature VMP de production (voir « Distribuer »). |
| Mises à jour | Les versions installées vérifient GitHub Releases au démarrage et se mettent à jour en arrière-plan (`electron-updater`). |
| Persistance | État JSON écrit de façon atomique dans le dossier `userData`, avec une copie `.bak`. |

## Raccourcis

Ils fonctionnent aussi quand une page web a le focus : le process principal les intercepte avant la page.

| Raccourci | Action |
|---|---|
| `Ctrl+T` | Nouvel onglet (barre de commande) |
| `Ctrl+L` | Modifier l'adresse de l'onglet actif |
| `Ctrl+W` | Fermer / archiver (décharger si épinglé) |
| `Ctrl+Shift+T` | Rouvrir le dernier onglet archivé |
| `Ctrl+D` | Épingler / désépingler |
| `Ctrl+S` | Afficher / masquer la barre latérale |
| `Ctrl+Shift+=` | Ajouter un panneau en vue scindée |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Onglet suivant / précédent |
| `Ctrl+1` … `Ctrl+9` | Aller à l'espace N |
| `Ctrl+R`, `F5` | Recharger |
| `Alt+←` / `Alt+→` | Précédent / suivant |
| `Ctrl+Shift+C` | Copier l'URL |
| `Ctrl+Shift+K` | Archiver tous les onglets du jour |
| `Ctrl+Alt+N` | Nouveau dossier |
| `Ctrl+Y` | Archive et réglages |
| `Ctrl+Shift+I`, `F12` | Outils de développement de la page |

La table complète est dans [shared/shortcuts.json](shared/shortcuts.json), partagée par l'interface et le process principal.

## Démarrer

Prérequis : Node.js 24 et pnpm 9.

```bash
pnpm install
```

Si le binaire Electron n'a pas été téléchargé à l'installation (pas de dossier `node_modules/electron/dist`) :

```bash
node node_modules/electron/install.js
```

`pnpm dev`, `pnpm build` et `pnpm start` génèrent d'abord `electron/preload.generated.cjs` (preload de l'interface + prise en charge des icônes d'extensions) via `pnpm preload`.

La synchronisation utilise par défaut le serveur officiel `https://yzo-browser-backend.vercel.app` dans les versions packagées et le serveur local `http://127.0.0.1:3100` en développement (dépôt privé `yzo-cloud`), sauf si `YZO_SYNC_URL` est défini. L'adresse se change aussi dans le panneau Compte, rubrique « Serveur ».

Mode développement (Vite + Electron, rechargement à chaud de l'interface) :

```bash
pnpm dev
```

Version compilée :

```bash
pnpm build
```

```bash
pnpm start
```

Vérifications :

```bash
pnpm typecheck
```

```bash
pnpm test
```

## Distribuer

Installeurs générés dans `release/` par [electron-builder](https://www.electron.build/) (configuration dans `package.json`, clé `build`) :

```bash
pnpm dist:win
```

```bash
pnpm dist:mac
```

```bash
pnpm dist:linux
```

| Système | Formats | Architectures |
|---|---|---|
| Windows | Installeur NSIS (`Yzo-Setup-<version>-<arch>.exe`) | x64, arm64 |
| macOS | DMG + ZIP (le ZIP sert aux mises à jour), hardened runtime | x64, arm64 |
| Linux | AppImage, .deb | x64 |

macOS ne se construit que sur un Mac. Le plus simple est de pousser un tag : le workflow [.github/workflows/release.yml](.github/workflows/release.yml) construit les trois systèmes et publie une release GitHub, que les versions installées détectent.

```bash
git tag v0.6.0
```

```bash
git push origin v0.6.0
```

Signature VMP (castLabs EVS, nécessaire pour Netflix et les services les plus stricts) : créer un compte gratuit avec `python -m pip install castlabs-evs` puis `python -m castlabs_evs.account signup`, et construire avec `YZO_VMP_SIGN=1`. En CI, renseigner les secrets `EVS_ACCOUNT_NAME` et `EVS_PASSWD`. Les hooks `scripts/after-pack.cjs` (macOS, avant la signature de code) et `scripts/after-sign.cjs` (Windows, après) s'en chargent. Linux n'a pas de VMP.

Signature de code (optionnelle, évite les avertissements SmartScreen et Gatekeeper) : secrets `CSC_LINK` / `CSC_KEY_PASSWORD` (certificat), et pour macOS `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` (notarisation, compte Apple Developer). Sans certificat, les builds ne sont pas signés.

L'icône `build/icon.png` est générée par `pnpm icon` (`scripts/make-icon.mjs`).

## Architecture

```
electron/main.cjs      Fenêtre sans cadre, IPC, persistance, politique des pages (raccourcis, pop-ups, menu contextuel)
electron/views.cjs     Une WebContentsView native par onglet chargé (et pour Peek) : création, position, gel, commandes
electron/extensions.cjs Extensions Chrome : Web Store, API chrome.* (onglets, actions, menus)
electron/account.cjs   Compte Yzo : connexion au serveur, session chiffrée par le trousseau du système
electron/crypto.cjs    Chiffrement de bout en bout (scrypt, HKDF, AES-256-GCM, clé de récupération)
src/sync/              Projection en enregistrements, fusion, boucle de synchronisation (SyncProvider)
scripts/after-*.cjs     Hooks electron-builder : signature VMP castLabs EVS (vmp.cjs)
scripts/build-preload.mjs Assemble le preload de l'interface avec le support des icônes d'extensions
electron/preload.cjs   Pont étroit window.yzo (état, fenêtre, raccourcis, Peek)
shared/shortcuts.json  Table des raccourcis (interface + process principal)
src/state/             Modèle (types.ts), opérations d'arbre (tree.ts), reducer, persistance, store React
src/lib/               URL, barre de commande, thèmes, auto-archivage, raccourcis, commandes d'onglet
src/ui/                Barre latérale, arbre d'éléments, zone web, panneaux, barre de commande, Peek, archive, éditeur d'espace
re/                    Rapport de rétro-ingénierie d'Arc et preuves REA
```

Le modèle reprend celui observé dans `StorableSidebar.json` d'Arc. Tous les éléments vivent dans une table plate, reliés par `parentId` et `childrenIds` :

- les **conteneurs** : favoris, et pour chaque espace une section épinglée et une section du jour ;
- les **onglets** ;
- les **dossiers** ;
- les **vues scindées**.

Chaque action passe par un reducer pur, qui travaille sur une copie ; l'état précédent n'est jamais modifié.

Chaque onglet chargé est une `WebContentsView` native gérée par le process principal ([electron/views.cjs](electron/views.cjs)). L'interface ne fait que placer des emplacements vides (`ViewHost`) et envoie leurs rectangles au process principal, qui y positionne les pages. Les vues natives sont dessinées au-dessus de tout le HTML : quand une superposition s'ouvre (barre de commande, menus, barre flottante, panneaux, Peek), les pages visibles sont « gelées » — capturées, remplacées par leur capture dans l'interface, puis masquées — pour que la superposition passe devant sans saut visible.

## Sécurité

- Interface : `contextIsolation`, `sandbox`, pas de `nodeIntegration`, CSP stricte. L'interface ne navigue jamais et ne peut pas intégrer de `<webview>` ; seules les vues d'onglet chargent des pages.
- Pages : créées par le process principal, sans preload, en sandbox. Seuls `http(s)` et `about:blank` sont admis, à l'ouverture comme à la navigation : pas de `file:`, `javascript:` ni protocoles personnalisés. Les identifiants, URL et rectangles envoyés par l'interface sont validés.
- Pop-ups (connexions OAuth) : vraies fenêtres partageant la session des onglets, mêmes règles de schéma.
- Identité : user agent d'un Chrome standard, sans mention d'Electron.
- Les canaux IPC n'acceptent que l'interface comme expéditeur. Taille et JSON de l'état sont validés avant écriture.
- Permissions des sites refusées par défaut, sauf plein écran, écriture presse-papiers, verrouillage du pointeur et accès au système de clés (DRM).
- Un fichier d'état corrompu ou inconnu est ignoré au démarrage : l'app repart d'un état neuf au lieu de planter.

## Limites connues

- Pas de Boosts, d'Easels ni de Little Arc. L'historique et l'archive ne sont pas synchronisés.
- Mot de passe oublié : la récupération par e-mail (Resend) n'est pas encore branchée ; la clé de récupération sert déjà à déchiffrer le coffre, mais l'écran correspondant reste à faire.
- Extensions : `chrome.runtime.onInstalled` ne se déclenche pas sous Electron ; les extensions qui ne créent leurs menus contextuels qu'à ce moment n'en auront pas. Les API Chrome non couvertes par Electron ou `electron-chrome-extensions` restent indisponibles.
- Les raccourcis d'Arc par défaut n'ont pas pu être extraits du binaire. Ceux ci-dessus suivent les conventions de Chromium et d'Arc publiques.
- Sans compte EVS, les builds gardent la signature VMP de développement de castLabs : Netflix refuse la lecture.
- Builds non signés tant qu'aucun certificat n'est fourni : SmartScreen (Windows) et Gatekeeper (macOS) avertissent à l'installation.

## Licence

Yzo est distribué sous [GNU GPL v3.0 ou ultérieure](LICENSE). Il utilise notamment [electron-chrome-extensions](https://github.com/samuelmaddock/electron-browser-shell) sous GPL-3.0 et [electron-chrome-web-store](https://github.com/samuelmaddock/electron-browser-shell) sous MIT.
