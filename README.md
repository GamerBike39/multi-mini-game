# BLOB ARCADE

Collection de 10 mini-jeux jouables à la manette (ou au clavier), en HTML5/Canvas —
zéro dépendance, zéro asset : tous les sons sont synthétisés (WebAudio) et tous les
graphismes sont dessinés à la volée. DA minimal : des blobs.

## Lancer

Double-clique sur `jouer.bat` (ouvre le serveur + le navigateur), ou :

```
python -m http.server 8123
```

puis ouvre http://localhost:8123

> Un serveur local est nécessaire (modules ES). Chrome/Edge recommandés pour les
> vibrations de manette (XInput).

## Les jeux

| Jeu | Principe | Manette | Clavier |
|---|---|---|---|
| **BLOB BEAT** | Rythme 4 couloirs, notes calées sur la batterie | ◀ ▼ ▲ ▶ ou X A Y B | Flèches ou X A Y B (Espace/J…) |
| **SURVIBLOB** | Arène, esquive, dash qui traverse les chasseurs | Stick + A | ZQSD/Flèches + Espace |
| **BLOBBLASTER** | Twin-stick shooter | Stick G bouge, stick D vise | ZQSD + Espace (auto-visée) |
| **BLOB RUN** | Auto-runner : saut variable, duck, scies | A saute, B se baisse | Espace / K |
| **CAVE RACER** | Tunnel procédural de plus en plus serré, boost, near-miss bonus | Stick + A (boost) | ZQSD/Flèches + Espace |
| **BLOB SIMON** | Mémoire : regarde la séquence de blobs, rejoue-la | Y X A B | U L J K |
| **BLOB SNAKE** | Serpent sur grille, lucioles, fruit doré, ça accélère | Stick / D-pad | Flèches / ZQSD |
| **BLOB BREAKER** | Casse-briques, balle-blob, drops (multi, large, slow) | Stick G paddle + A | ZQSD + Espace |
| **BLOB GOLF** | 9 trous faits main, visée + puissance, sable et banques | Stick viser + A (charge) | Flèches + Espace |
| **BLOB PÊCHE** | Lance l'hameçon, ferrade, remorge sous tension | A + Stick G | Espace + ZQSD |

Menu : `← → ↑ ↓` choisir, `A` lancer (raccourcis `1`–`9`, `0`), `X` fiche détaillée,
`Sélect/Backspace` réglages, `B` retour, `M` muet, `F` plein écran.

La **fiche jeu** (vue par défaut) affiche chaque jeu en plein écran : une mini-démo
simulée tourne en fond, avec les contrôles, l'astuce, les statistiques (parties, temps
de jeu, record, dernier score, moyenne, victoires), l'échelle de rangs, et en bas le
bandeau de vignettes pour naviguer (`← →`). `B`/`Échap` ramène à la grille (vue globale).

Réglages (Sélect ou Échap depuis le menu, ou item « Réglages » de la pause) : volumes
général / musique / effets avec sliders, muet, plein écran, vibrations manette.

Souris : active uniquement dans les interfaces (hub, pause, réglages) — survol et clic
sur les cartes, vignettes, bouton LANCER et sliders. En jeu, elle n'a aucun effet.

## Game feel (la partie importante)

- **Squash & stretch** du blob selon la vélocité + impulsions à chaque impact
- **Trail**, particules additives, anneaux de choc
- **Screenshake** à base de trauma, **hitstop** sur les gros impacts, **slow-mo** à la mort
- **Accélération visible** : steering exponentiel, recul au tir, dust au saut/atterrissage
- **SFX synthétisés** : chaque action a son son ; pitch des pièces qui monte en chaîne
- **Musique générative** (kick/snare/hat/basse) synchronisée sur l'horloge audio —
  le jeu de rythme génère sa chart **depuis** le pattern de batterie
- **Vibrations manette** dosées par intensité (parfait < dash < mort)
- Coyote time + input buffer sur le saut du runner

## Structure

```
js/core/    input, audio, fx, blob, moteur (pas fixe 60 Hz), UI commune, BaseGame, réglages
js/games/   rhythm, survival, shooter, runner, cave, simon, snake, breaker, golf, fish
js/menu.js  hub (fiche plein écran + grille globale)
js/demos.js démos simulées (attract mode) de la fiche
```
