# Bible d’univers — BLOB ARCADE

Document de référence pour étendre le design **fun, organique et dynamique** à tout l’arcade, en partant du blob actuel.

Le personnage n’est plus un cercle HUD. C’est une **goutte vivante**. Tout le reste de l’univers doit coller à cette matière : ronde, élastique, expressive, jamais géométrique froide.

---

## 1. Promesse

BLOB ARCADE = **une mascotte molle dans une borne d’arcade sombre**.

- Le monde est un fond nocturne, net, un peu CRT.
- Le blob est la lumière, la gelée, l’émotion.
- Les jeux sont des **manèges** que le même blob traverse, pas des skins différents.

Si un élément ne pourrait pas rebondir, fondre ou cligner des yeux, il est probablement trop dur pour cet univers.

**Phrase de test :** *est-ce que le blob aurait envie de jouer là-dedans ?*

---

## 2. Personnalité du blob

Le blob n’est pas un héros stoïque. C’est un **petit animal de gelée curieux**.

| Trait | Ce que ça veut dire | Ce que ça n’est pas |
|---|---|---|
| Enthousiaste | sourit par défaut, s’excite sur un combo | clown, grimaces permanentes |
| Fragile | a peur près du danger, s’écrase à l’impact | tragique, gore |
| Joueur | rebondit, squashe, laisse une traînée | mécanique, robot |
| Lisible | 2 yeux + 1 bouche suffisent | détails anatomiques |
| Unique | un seul blob, teinté par l’accent du jeu | 10 mascottes |

Voix intérieure : *« encore une fois ? ok. »* puis il sourit.

Mort = pancake + yeux en X. Pas de dramaturgie. On relance.

---

## 3. Matière visuelle (non négociable)

### Forme
- Courbes fermées, lobes, respiration.
- Contours lissés (courbes, pas polygones visibles).
- Rondeur même en squash : un ovale, jamais un rectangle.

### Surface
- Dégradé interne (haut clair / bas plus dense).
- Petit reflet elliptique haut-gauche.
- Halo de la couleur d’accent, flou doux.
- Trail = gouttes / halos, pas des traits.

### Fond
- Nuit arcade : `#04050a` → `#05060b`.
- Grilles très faibles, vignette, éventuellement CRT/bruit (filtres joueur).
- Les décors **encadrent** le blob, ils ne le concurrencent pas.

### Interdits
- Angles vifs sur le personnage.
- Sprites bitmap comme identité principale (le blob est procédural).
- Textures réalistes, métalliques, organiques « chair ».
- Changer `r` / hitbox pour « mieux coller au dessin ».

---

## 4. Palette

Le blob canonique est **cyan gelée**. Chaque jeu le teinte, il ne change pas d’espèce.

| Rôle | Hex | Usage |
|---|---|---|
| Matière blob | `#7dd3fc` | intro, menu, mascotte |
| Nuit | `#04050a` / `#05060b` | fonds |
| Texte | `#eaf6ff` / `#e8ecf2` | titres |
| Muet | `#8b95a8` / `#5d6480` | UI secondaire |
| Ombre visage | `#0b0e14` | yeux, bouche |
| Reflet | blanc 20–42 % | volume |
| Danger | `#ff5470` | erreurs, mort, alerte |

Accents jeux (identité de manège, pas de nouveau personnage) :

| Jeu | Accent |
|---|---|
| BLOB BEAT | `#f472b6` |
| SURVIBLOB | `#34d399` |
| BLOBBLASTER | `#fbbf24` |
| BLOB RUN | `#a3e635` |
| CAVE RACER | `#818cf8` |
| BLOB SIMON | `#c084fc` |
| BLOB SNAKE | `#22d3ee` |
| BLOB BREAKER | `#fb7185` |
| BLOB GOLF | `#f97316` |
| BLOB PÊCHE | `#38bdf8` |

Règle : **un accent par écran**, le blob en hérite. Les FX secondaires restent blanc / accent / nuit.

---

## 5. Motion — le blob est de la physique molle *dessinée*

La physique appartient aux jeux. Le rendu interprète `(x, y, vx, vy)`.

### Contrats stables (ne pas casser)
Fichier : [js/core/blob.ts](js/core/blob.ts)

- `r` = hitbox. Le dessin peut déborder un peu, jamais remplacer `r`.
- `punch(amount)` : impulsion d’impact, plafond `0.6`, decay `* 4.5`.
- `setPose(scaleX, scaleY, liquid, offsetY)` : squash gameplay (saut, duck…).
- Squash vitesse : `sx = 1 + k*0.30 + jig*0.4`, `sy = 1 - k*0.18 - jig*0.35` avec `k = min(1, speed/620 * speedMorph)`.
- Runner recale le sol avec **cette** formule. Tout changement de coefficients = régression.

### Langage d’animation
1. **Idle** : respiration radiale ~2 %, clignement 2–5 s.
2. **Vitesse** : étirement dans la direction du mouvement.
3. **Impact** : `punch` + ondulation de gelée, pas un flash seul.
4. **Liquide** : `liquid` 0–1 pour flaque / duck / charge.
5. **Trail** : seulement si ça aide à lire la trajectoire.

Durées arcade (hors reduced-motion) :
- micro-feedback : 80–160 ms
- punch visuel : 200–350 ms
- émotion flash : 0.4–0.8 s
- wipe écran : ~0.9 s (`WIPE_DUR`)

`prefers-reduced-motion` : wipes ~0.22 s, moins de lobes.

---

## 6. Bibliothèque d’émotions

API visuelle uniquement.

```ts
blob.setEmotion('happy', 0.6); // flash puis idle
blob.setEmotion('focused');    // tient jusqu’au prochain appel
blob.scared = true;            // priorité sur emotion
blob.dead = true;              // yeux en X, squash mort
```

| Clé | Quand | Face |
|---|---|---|
| `idle` | défaut | sourire léger |
| `happy` | combo, pièce, lancement | sourire large |
| `focused` | visée, ferrage, rythme juste | yeux plus petits |
| `determined` | duck, charge, boost | sourcils bas |
| `wow` | near-miss, wipe, dash | yeux ronds, bouche O |
| `scared` | danger proche (`scared = true`) | yeux écarquillés |
| `sad` | miss, trou raté | bouche inverse |
| `sleepy` | intro avant interaction | paupières basses |

Priorité : `dead` > `scared` > `emotion`.

### Mapping recommandé par jeu
Ne pas spammer. Une émotion = un événement lisible.

| Jeu | idle / boucle | flash positif | tension | échec |
|---|---|---|---|---|
| Beat | `focused` sur note | `happy` parfait | `wow` streak | `sad` miss |
| Survival | `idle` | `happy` orb | `scared` si near | mort |
| Shooter | `determined` tir | `wow` kill pack | `scared` bas HP | mort |
| Runner | pose sol/air | `happy` near-miss | `scared` déjà branché | mort |
| Cave | `focused` | `wow` near-miss | `determined` boost | mort |
| Simon | `idle` | `happy` pad ok | `wow` séquence | `sad` / scared pad |
| Snake | `idle` | `happy` fruit | `wow` or | mort |
| Breaker | `focused` balle | `happy` brick / drop | `wow` laser | `sad` balle perdue |
| Golf | `focused` visée | `happy` trou | `determined` charge | `sad` eau/sable |
| Pêche | `sleepy` attente | `wow` touche | `determined` fight | `sad` perdu |
| Intro | `sleepy` → `idle` | `happy` si on bouge | — | — |
| Menu | hop beat | `happy` au lancement | — | — |

---

## 7. Écrans et transitions

Fichier : [js/core/stage.ts](js/core/stage.ts)

L’intro et les wipes **sont du gameplay léger**, pas du CSS.

### Intro
- Même classe `Blob` que les jeux.
- Stick / flèches = le joueur « réveille » la mascotte.
- Clic / A / Start = unlock audio + wipe vers le menu.
- Texte court, cyan, bouton pilule. Pas de carte HTML.

### Wipe
Le blob **gonfle jusqu’à manger l’écran**, titre au centre, swap d’app à 46 % (`WIPE_SWAP`), puis il se retire vers l’ancre de destination.

Utiliser `eng.transitionTo(app, { accent, title, from, to })`.
Relance de partie : `setApp(game, false)` — pas de wipe.

Ancres :
- depuis le blob visible (`blobAnchor`)
- vers le menu : haut-centre ~`(640, 92)`
- vers un jeu : centre, ou spawn du blob du jeu si connu

---

## 8. UI, FX, ennemis — coller à la gelée

### UI
- Coins 16–23 px, pilules, jamais de rectangles crus.
- Titres 800–900, tracking léger.
- Panneaux `rgba(9,12,19,0.88)` + stroke accent 20–40 %.
- Le curseur / sélection devrait **s’asseoir** comme le blob du menu (perché, hop sur le beat).

### FX (`js/core/fx.ts`)
Préférer :
- burst de pastilles rondes
- anneaux qui s’ouvrent (goutte dans l’eau)
- flash teinté de l’accent (α courte)
- shake petit, punch du blob plus important que le trauma caméra

Éviter : étincelles angulaires, débris de verre, explosions militaires.

### Ennemis / props
Même famille : ronds, capsules, blobs hostiles plus durs (moins de reflet, bouche absente ou plus petite).
Un ennemi anguleux doit rester **un obstacle**, pas un personnage.

### Typo
`"Segoe UI", system-ui` pour l’humain, mono pour les stats / HUD technique.
Les titres de jeux crient en compacte, le blob reste doux : contraste volontaire.

---

## 9. Audio (raccord, pas un doublon)

La bible musicale reste [arcade_music_orientation_final/03_MUSICAL_BIBLE.md](arcade_music_orientation_final/03_MUSICAL_BIBLE.md).

Côté personnage :
- SFX ronds : thump, bounce, gelée, pas de metal.
- `punch` visuel ≈ transitoire SFX.
- Émotion `happy` / `wow` peut coller à `coin`, `perfect`, `milestone`.
- Intro : silence ou drone très bas jusqu’au geste (le clic débloque).

Le blob ne chante pas. Il **réagit** à la musique (hop menu, pulse rythme).

---

## 10. Architecture à réutiliser

```
js/core/blob.ts     ← matière, pose, émotions, rendu
js/core/stage.ts    ← intro + wipes
js/core/fx.ts       ← particules / anneaux / flash
js/core/ui.ts       ← panneaux, texte, pause / game over
js/core/engine.ts   ← transitionTo / setApp(..., false)
js/menu.ts          ← blob perché, lancement avec wipe
js/games/*.ts       ← physique + appels punch / scared / setEmotion
```

Règle d’intégration dans un jeu :
1. Ne pas forker le rendu du blob.
2. Appeler `setPose` / `punch` / `setEmotion` aux **événements déjà existants**.
3. Garder `scared` et `dead` : la bibliothèque s’y branche.
4. Colorier via `blob.color = this.accent`.

---

## 11. Checklist « est-ce du Blob Arcade ? »

Un ajout est dans l’univers s’il coche **au moins 4** :

- [ ] Forme ronde / capsule / goutte
- [ ] Accent unique de l’écran
- [ ] Feedback squash, punch ou émotion
- [ ] Lisibilité en 1280×720, silhouette claire
- [ ] Hitbox inchangée
- [ ] Amusement immédiat, pas de lore à lire
- [ ] Le blob pourrait rebondir dessus

Un ajout est hors univers s’il :

- rigidifie le personnage (armure, membres, visage réaliste)
- ajoute une deuxième mascotte concurrente
- change la physique pour servir le dessin
- utilise des transitions CSS / fades noirs à la place du wipe blob
- surcharge le HUD au point de cacher les yeux du blob

---

## 12. Feuille de route (sans régression)

Ordre sûr, un calque à la fois :

1. **Brancher les émotions** sur les événements déjà là (near-miss, miss, coin, duck).
2. **Menu** : hop + `happy` au lancement, idle souriant.
3. **Game over / pause** : le blob pancake ou triste *dans* le panneau, pas un nouveau personnage.
4. **FX** : convertir sparks anguleux restants en pastilles.
5. **Ennemis** : passer les plus secs en capsules lumineuses.
6. **HUD** : pips, cœurs, notes = mini-blobs ou gouttes.
7. **Wipes** : ancre `to` = spawn réel du jeu (runner au sol, golf sur le tee…).
8. **Simon / pads** : chaque pad est un cousin du blob (déjà proche).

Ne pas commencer par un redesign complet d’un jeu. Le blob unifie ; les manèges gardent leur lecture.

---

## 13. Références de feeling (esprit, pas copie)

- Kirby / Goo (rondeur, squash, gentillesse)
- LocoRoco / Katamari (joie stupide, monde qui cède)
- Bornes 80–90 + synthwave (nuit, neon, 1 couleur)
- Juice It or Lose It (chaque input a une déformation)

Anti-références : dark souls, milsim, UI plate Material, pixel-art rigide comme identité.

---

## 14. Une phrase pour la suite

> On ne décore pas autour du blob. On **joue de la gelée** : tout ce qui bouge squashe, tout ce qui arrive à l’écran arrive en goutte, et le petit visage dit le reste.

