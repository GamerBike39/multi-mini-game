# CAVE RACER — État du mini-jeu

**Version : 1.0.0** (« Puits vertical ») — voir `CaveGame.version` dans `js/games/cave.ts`.
Documents de référence : `DESIGN_BLOB_UNIVERSE.md` (identité Blob Arcade),
`CAVE_GAME_FEEL.md` (direction P0 appliquée).

---

## 1. Concept actuel

Course hyperspeed **verticale** dans un puits organique numérique généré
procéduralement. Le joueur est calé à ~72 % de la hauteur, le monde arrive du
haut et s'écoule vers le bas, pilotage gauche/droite (Q D / flèches / stick,
A = turbo).

Le tunnel est un **vide découpé dans une matière cellulaire réactive**.
Le gameplay reste simple et déterministe ; le spectacle vient du rendu.

---

## 2. Ce qui est fait (v1.0.0)

### Gameplay
- **Vitesse exponentielle** : base `400·exp(t·0.009) + t·2.6`, cap base 1350,
  turbo ×1.7, surge ×1.35, plafond total 1650 px/s. Caméra éloignée
  (zoom 0.80) + look-ahead pour garder l'anticipation.
- **Turbo = fuel (hystérésis)** : enclenchement > 0.15, ré-armement ≥ 0.35
  (fini le yoyo à 2 %), conso 0.55/s, regen passive lente 0.22/s.
- **Overdose** : réservoir vidé en boost → 4.5 s de lock, gouttes fuel
  devenues toxiques (−50), voile rouge, `sad`.
- **Vies** : 3 au départ, max 5. Touche → recentrage + invincibilité 2 s
  (clignotement fantôme) ; dernière vie → pancake + game over.
- **Items** : gouttes indigo = fuel (chaîne +25→+100) ; gouttes blanches =
  surge +35 % / 3 s (+50 pts) ; **séquence de 6 pièces rouges = +1 vie**
  (filament de liaison, SFX montant, ratée possible).
- **Sections de tension** : OUVERT / ÉTROIT / MEMBRANE (murs horizontaux à
  ouverture télégraphiée + whoosh au franchissement) / SLALOM, alternance
  ~6-8 s avec blend smoothstep.
- **Near-miss central** : intensité `k` par distance → recharge fuel, score,
  filament, fragments, kick caméra, rumble, squash, pitch.
- **Score duel-ready** : `pace·3 + bonus` où `pace = distance/temps`
  (vitesse moyenne). Champs exposés : `pace`, `worldY`, `time`, `lives`.
  HUD : `px/s · MOY · section`. Rangs `[6000, 4000, 2200, 1000, 0]`.
- **Haptique progressif** (tick 90 ms) : murs + membranes + turbo + vitesse.

### Game feel (P0 de CAVE_GAME_FEEL.md)
- Verticalisation complète (aucune référence à l'axe horizontal restant).
- Matière cellulaire 2 couches (principale + profonde en parallaxe 0.55),
  luminosité selon distance au bord, stretch à haute vitesse, ondes d'impact,
  signatures par section, **tremblement passé `speedN > 0.45`**.
- **Gameplay Edge** : frontière fine `#e8ecf2` redessinée nette au-dessus
  de tout le décor et des collectibles.
- Chorégraphies : turbo (compression → kick + ring + flash → stabilisé),
  hit directionnel (`setPose`, hitbox intacte), camera kick vs shake séparés,
  micro-tremblement de vitesse, budget décor (écran nettoyé si marge < 30 %).
- Boules rouges (kystes) **supprimées** : parois + membranes uniquement.

### Audio (`js/core/audio.ts`, interface `AudioLike` étendue)
| Son | Usage | Timbre |
|---|---|---|
| `coin(step)` | fuel, pitch montant | carré + quinte |
| `red(step)` | pièces rouges, +2 demi-tons/pièce | triangle + octave sine |
| `turboSet(on, level)` | nappe turbo (110 + 164.8 Hz, lowpass + LFO) | douce, non agressive |
| `dash()` | surge | balayage de bruit |
| `milestone()` | +1 vie | arpège 880/1108/1320 |
| `good()` / `miss()` / `hurt()` / `explode()` | prox, ratés, touche, mort | existants |

Fichiers touchés par la v1.0.0 : `js/games/cave.ts` (refonte),
`js/core/audio.ts` (`red`, `turboSet`), `js/core/types.ts` (interface).

---

## 3. Reste à faire / pistes

### P1 — polish principal (cf CAVE_GAME_FEEL.md §29)
- Désynchronisation d'overdose (jitter, dédoublements, resync de sortie).
- Distorsion locale autour du joueur (turbo/surge/near-miss, jamais sur l'Edge).
- Pseudo-perspective (convergence vers le haut, couches de profondeur).
- Membranes animées (contractions horizontales).
- Audio dynamique (couches suivant la vitesse/danger) et haptique détaillée.

### P2 — spectacle et finition (cf §30)
- Milestones environnementaux, variations de palettes / biomes.
- Fragments d'avant-plan, effet de dernière vie, micro-événements rares.

### Duel multijoueur local
- Base prête (`pace`, `worldY`, `time`, `lives`). Reste : règle (ex. 90 s,
  meilleur pace gagne), écran versus, entrées J1/J2.

### Divers
- Aligner la démo attract du menu (`demoCave` dans `js/demos.ts`, encore
  horizontale) sur la direction verticale.
- Validation d'équilibrage en jeu : lisibilité en turbo, timing membranes à
  ~1400 px/s, niveau de la nappe turbo, rangs S/A.

---

## 4. Historique
- **1.0.0** — Refonte verticale + matière cellulaire + Gameplay Edge +
  chorégraphies P0 + vies + surge + séquence rouge + score pace +
  haptique progressif + SFX `red`/`turboSet`. Suppression des kystes.
- *0.x (prototype)* — tunnel horizontal, vitesse linéaire capée, orbes +25
  fixes, turbo à saccades, mort instantanée, pas d'identité.
