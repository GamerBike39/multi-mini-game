# BLOB ARCADE

Collection de mini-jeux jouables à la manette (ou au clavier), en HTML5/Canvas —
zéro dépendance runtime, zéro asset : tous les sons sont synthétisés (WebAudio) et
tous les graphismes sont dessinés à la volée. DA minimal : des blobs.

## Lancer

Installe les dépendances une fois :

```
npm install
```

Puis double-clique sur `jouer.bat` (ouvre Vite + le navigateur), ou :

```
npm run dev
```

Puis ouvre http://localhost:5173

Pour générer la version distribuable : `npm run build`, puis `npm run preview` pour
la tester localement.

`npm run typecheck` vérifie l'ensemble des modules TypeScript sans générer de
fichiers. La migration applicative est terminée : le moteur, l'audio, les
réglages, l'UI commune, les démos et les mini-jeux, y compris Rhythm, sont en
TypeScript.

## Héberger sur Vercel

Le projet est une application statique : aucun serveur Python n'est nécessaire en
production. Il suffit d'importer le dépôt dans Vercel ; la configuration utilise
`npm run build` et publie le dossier `dist`.

Avec la CLI Vercel :

```
npx vercel
```

Le jeu reste entièrement exécuté dans le navigateur. Les scores et réglages sont
stockés dans le `localStorage` du navigateur de chaque joueur.

> Un serveur local est nécessaire (modules ES). Chrome/Edge recommandés pour les
> vibrations de manette (XInput).

## Les jeux

| Jeu | Principe | Manette | Clavier |
|---|---|---|---|
| **BLOB BEAT** | Rythme 4 couloirs, notes calées sur la batterie | ◀ ▼ ▲ ▶ ou X A Y B | Flèches ou X A Y B (Espace/J…) |
| **SURVIBLOB** | Arène, esquive, dash qui traverse les chasseurs | Stick + A | ZQSD/Flèches + Espace |
| **BLOBBLASTER** | Twin-stick shooter | Stick G bouge, stick D vise | ZQSD + Espace (auto-visée) |
| **BLOB RUN** | Auto-runner : sauts courts/hauts, double saut, plateformes, fossés, plafonds, scies et bonus de proximité | A saute, A en l’air = double saut, B se baisse | Espace / K |
| **CAVE RACER** | Tunnel procédural de plus en plus serré, boost, near-miss bonus | Stick + A (boost) | ZQSD/Flèches + Espace |
| **BLOB SIMON** | Mémoire : regarde la séquence de blobs, rejoue-la | Y X B A | Flèches ↑ ← → ↓ |
| **BLOB SNAKE** | Serpent sur grille, lucioles, fruit doré, ça accélère | Stick / D-pad | Flèches / ZQSD |
| **BLOB BREAKER** | Casse-briques, balle-blob, drops (multi, large, slow) | Stick G paddle + A | ZQSD + Espace |
| **BLOB GOLF** | 9 trous texturés, trajectoire prédite, puissance progressive et duel local | Stick viser + A (charge), X précision | ← → viser, ↑ trou, Espace, L précision |
| **BLOB PÊCHE** | Lance l'hameçon, ferrade, remorge sous tension | A + Stick G | Espace + ZQSD |
| **BLOB TRI** | Range les couleurs dans leur garage, éjecte les intrus, résiste aux leurres | D-pad / Stick + A | Flèches / ZQSD + Espace |
| **BLOB TRACE** | Mémorise un chemin orthogonal, en trace fine ou cases illuminées, puis rejoins l’arrivée | D-pad / Stick + A, X affichage | Flèches / ZQSD + Espace, L affichage |
| **PONG** | Duel de raquettes, effets et vitesse progressive | Stick / D-pad + A | Flèches / ZQSD + Espace |
| **DR BLOB** | Trios qui tombent, groupes de 4+ qui éclatent, chaînes | Stick / D-pad + A | Flèches / ZQSD + Espace |
| **BLOB POP** | Vise, tire, éclate les grappes hexagonales | Stick viser + A | Souris/Flèches + Espace |
| **FROG** | Traverse routes et rivières, remplis les alcôves | D-pad / Stick | Flèches / ZQSD |
| **FLAPPY BLOB** | Bat des ailes, passe au centre des arches | A / Espace / Clic | Espace / J / Clic |
| **DIG** | Creuse, gère l’oxygène, remonte les veines | Stick / D-pad + A | Flèches / ZQSD + Espace |
| **BLOB CYCLES** | Tron-like 1-4J, traînées mortelles, dernier survivant (solo rapide vs 3 IA) | D-pad / Stick virer à 90° | Flèches / ZQSD (P1) |
| **BLOB BLOOM** | Othello organique 1-2J, contamination en vagues, FLORA vs CRISTAL (solo vs IA) | D-pad / Stick curseur + A poser + X règles | Flèches / ZQSD + Espace + H règles (P1) |

Chaque jeu appartient à un genre (`ACTION`, `PILOTAGE`, `PUZZLE`, `FLOW`) affiché
sur sa fiche et utilisable comme filtre dans la grille.

Menu : trois vues — `FICHE`, `GRILLE`, `SUCCÈS`. `← → ↑ ↓` choisir, `A` lancer
(raccourcis `1`–`9`, `0`), `V` ou `LB/RB` changer de vue, `Échap` ou l'icône ⚙
ouvrir les options. À la manette, `LT/RT` changent de vue ; `Sélect` ouvre
également les options.

- **Grille** : scrollable, prévue pour un catalogue grandissant — filtres par
  genre (`C` ou barre de filtres via `↑` depuis la première ligne), favoris
  (`Y` manette / `E` clavier, filtre `☆ FAVORIS`), recherche (`/` puis frappe,
  `Entrée` valider, `Échap` annuler), tris (`X` manette / `T` clavier :
  A→Z, +joués, records, succès, récents), molette souris supportée. Les favoris,
  récents et préférences (vue, genre, tri) sont persistés.
- **Fiche** : inchangée dans l'esprit — démo simulée, contrôles, astuce,
  statistiques, rangs — plus tag de genre, étoile de favori, ligne de succès du
  jeu (cliquable, `X`/`T` : ouvre la galerie sur ce jeu) et bandeau de vignettes
  en fenêtre scrollable.
- **Succès** : galerie (`TOUS` / `OBTENUS` / `À FAIRE`, portée tous les jeux ou
  jeu sélectionné via `C`), barres de progression, scroll molette + `PgUp/PgDn`.
  La progression globale (`🏆 x/y`) est rappelée dans la barre du haut.

La **fiche jeu** (vue par défaut) affiche chaque jeu en plein écran : une mini-démo
simulée tourne en fond, avec les contrôles, l'astuce, les statistiques (parties, temps
de jeu, record, dernier score, moyenne, victoires), l'échelle de rangs, et en bas le
bandeau de vignettes pour naviguer (`← →`). Une indication de transition apparaît
à chaque changement de vue.

Réglages (⚙, Sélect ou Échap depuis le menu, ou item « Réglages » de la pause) :
volumes général / musique / effets avec sliders, muet, plein écran, vibrations
manette. L'entrée « Options visuelles » ouvre une sous-vue dédiée à la résolution
(`AUTO`, 1280×720, 1600×900, 1920×1080, 2560×1440, 3840×2160) et aux filtres CRT
et bruit avec intensités réglables.

Validation musicale : la route `/music-test` permet d'écouter les références
déterministes Shooter, Survival et Fish, de mettre le transport en pause, de
désactiver temporairement chaque couche, puis de comparer la référence fixe au
premier mode adaptatif. Le mode manuel expose les neuf axes `MusicState` ; `Y`
active la navigation dans ces axes, `← →` les règle, `LB` active l'adaptation et
`RB` réinitialise l'état.

En jeu, le menu et les mini-jeux passent par le même adaptateur musical : il
traduit leur état et leurs événements (vagues, combos, prises, near-miss, etc.)
en `MusicState` et laisse le directeur adaptatif piloter les couches existantes.
Les références exactes sont utilisées par Survival, Shooter et Fish ; les autres
jeux conservent leurs compositions générées sur ce même rack.

Pendant le gameplay, Start, Sélect ou Échap ouvrent la pause et la mettent en pause ou la
reprennent ; l'item « Quitter » permet de revenir au hub.

Souris : active uniquement dans les interfaces (hub, pause, réglages) — survol et clic
sur les cartes, vignettes, bouton LANCER et sliders. En jeu, elle n'a aucun effet
(molette : scroll des listes du hub).

## Succès

Système moteur (`js/core/achievements.ts`, ~90 succès de base) : chaque jeu
débloque 4 succès via ses rangs (`DÉCOUVERTE`, `RANG B/A/S`) + 11 succès arcade
globaux (exploration multi-jeux, marathons, records, rangs S, victoire) + succès
custom émis par les jeux eux-mêmes (ex. vagues Survibblob, arches Flappy).

- Côté jeu : `this.unlockAchievement('cave.near-miss-10')` (direct) ou
  `this.emitAchievement('surv:wave', { value: this.wave })` (évènement), puis
  déclarer le succès via `engine.achievements.register(...)` (voir `js/main.ts`).
- Côté moteur : `BaseGame.over()` émet `game:over`, `game:rank`, `game:win`,
  `game:record`. Les toasts s'affichent en jeu comme au menu, avec son et
  persistance `localStorage`. Les succès ne touchent jamais à la simulation.

## Game feel (la partie importante)

- **Squash & stretch** du blob selon la vélocité + impulsions à chaque impact
- **Trail**, particules additives, anneaux de choc
- **Screenshake** à base de trauma, **hitstop** sur les gros impacts, **slow-mo** à la mort
- **Accélération visible** : steering exponentiel, recul au tir, dust au saut/atterrissage
- **SFX synthétisés** : chaque action a son son ; pitch des pièces qui monte en chaîne
- **Musique générative** (kick/snare/hat/basse) synchronisée sur l'horloge audio —
  le jeu de rythme génère sa chart **depuis** le pattern de batterie ; chaque jeu
  a sa couleur harmonique (tonique, groove, progression, arpèges) ; le menu
  ajoute pads majeurs, music-box, stabs de cuivre et cris de fête (`hey!`)
  via les couches `brass`/`vox` du rack ; delay pointé + réverb générative,
  fills de fin de phrase, swing, leitmotivs sur les peaks et stingers de
  transition (lancement, fin, victoire, record)
- **Vibrations manette** dosées par intensité (parfait < dash < mort)
- Coyote time + input buffer sur le saut du runner, avec saut court au tap, saut haut au maintien et double saut
- Génération procédurale seedée : motifs rythmés, contraintes lisibles et réutilisables avec `?runnerSeed=12345`
- Bonus **NEAR** : frôler proprement un danger alimente le score, le combo, les effets et la tension musicale

## Structure

```
js/core/    input, audio, fx, blob, moteur (pas fixe 60 Hz), UI commune, BaseGame, réglages, succès (TypeScript)
js/core/music/ transport, références, état manuel, direction adaptative et adaptateurs de jeu (TypeScript)
js/games/   survival, shooter, runner, cave, simon, snake, breaker, golf, fish, rhythm, pong, columns, bubble, sort, path, frog, flappy, dig, cycle, bloom (TypeScript)
js/main.ts  point d'entrée navigateur (+ catalogue des succès)
js/menu.ts  hub (fiche plein écran + grille filtrable/scrollable + galerie succès)
js/demos.ts démos simulées (attract mode) de la fiche
```
