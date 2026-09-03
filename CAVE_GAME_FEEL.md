# CAVE RACER — Direction de jeu, verticalisation, Game Feel et effets environnementaux
---

## 1. Objectif du document

Ce document synthétise la réflexion menée autour de l’évolution de **Cave Racer**.

L’objectif n’est pas de réécrire le jeu depuis zéro, mais de conserver son cœur actuel — vitesse, tunnel procédural, turbo, fuel, near-miss, vies, membranes et collectibles — tout en lui donnant :

- une **direction de jeu verticale** plus forte ;
- une **identité visuelle plus distinctive** ;
- un **game feel moderne et spectaculaire** ;
- une forte utilisation de **triches visuelles** ;
- une meilleure sensation de vitesse et de profondeur ;
- une lisibilité irréprochable malgré la densité des effets.

Le principe directeur est simple :

> **Le gameplay doit rester simple et déterministe ; le rendu peut tricher énormément pour raconter quelque chose de beaucoup plus spectaculaire.**

---

# 2. Concept de départ

## 2.1. Lecture de la référence visuelle

La référence montre un jeu d’adresse dans lequel le joueur évolue à l’intérieur d’un **passage noir découpé dans une masse de petits blocs lumineux**.

Le point important n’est pas simplement le pixel-art.

Le point fort est la façon dont l’espace est représenté :

- le passage jouable est un **vide** ;
- la grotte est une **masse** ;
- les murs ne sont pas seulement deux lignes ;
- les cellules composent physiquement l’environnement ;
- le joueur doit lire la **silhouette du tunnel** ;
- la longueur parcourue devient naturellement la mesure de performance.

On obtient donc une lecture immédiate :

> « Je dois rester dans cet espace vide, éviter la matière autour de moi et aller le plus loin possible. »

---

## 2.2. Description cible du jeu

**Cave Racer est un jeu d’adresse et de survie à défilement continu dans lequel le joueur traverse à très haute vitesse un tunnel généré procéduralement.**

Le tunnel :

- serpente ;
- se resserre ;
- s’élargit ;
- se décale ;
- introduit des étranglements ;
- contient des obstacles transversaux ;
- change progressivement de rythme.

Le joueur doit avant tout :

1. lire la géométrie à venir ;
2. anticiper ses déplacements ;
3. éviter les collisions ;
4. gérer son turbo ;
5. profiter des near-misses ;
6. collecter les ressources ;
7. survivre le plus longtemps possible.

---

# 3. Ce que possède déjà `cave.ts`

Le jeu actuel dispose déjà d’une base très solide.

## 3.1. Structure de tunnel

La grotte est construite procéduralement à partir :

- d’un axe central ;
- de plusieurs sinusoïdes superposées ;
- d’une largeur dynamique ;
- d’une difficulté croissante ;
- de transitions progressives entre sections.

Les sections actuelles sont :

- **OUVERT**
- **ÉTROIT**
- **MEMBRANE**
- **SLALOM**

Cette structure doit être conservée.

---

## 3.2. Vitesse et progression

Le jeu possède déjà :

- une vitesse de base croissante ;
- un plafond de vitesse ;
- un turbo ;
- un multiplicateur de boost ;
- un surge temporaire ;
- une logique d’accélération progressive ;
- une caméra qui s’éloigne légèrement avec la vitesse.

---

## 3.3. Ressources et bonus

Le système comprend :

- des gouttes de fuel ;
- un turbo avec jauge ;
- une overdose quand le réservoir est vidé ;
- des gouttes toxiques pendant l’overdose ;
- des gouttes blanches donnant un surge ;
- des séquences de 6 pièces rouges ;
- une vie supplémentaire si la séquence est complétée.

---

## 3.4. Risque et scoring

Le jeu récompense :

- la vitesse moyenne ;
- la distance ;
- les collectibles ;
- les near-misses.

Le near-miss est particulièrement intéressant car il transforme la proximité du danger en **mécanique active**.

Ce système doit devenir un élément central du game feel.

---

## 3.5. Feedback déjà existant

Le moteur possède déjà plusieurs briques importantes :

- `punch`
- `ring`
- `burst`
- `shake`
- `stop`
- `flash`
- rumble manette
- trail
- zoom
- sway caméra
- changement d’émotion du blob
- hit-stop
- squash/liquid deformation

La suite doit donc principalement consister à **orchestrer et spécialiser ces effets**, pas simplement à en ajouter toujours davantage.

---

# 4. Décision structurante : passer le jeu en vertical

## 4.1. Pourquoi abandonner le scrolling horizontal

Dans la version actuelle :

- le joueur reste à une position X fixe ;
- le monde avance sur `worldX` ;
- le joueur se déplace surtout verticalement.

Cette structure fonctionne, mais elle exploite moins bien l’espace disponible pour l’anticipation.

Pour Cave Racer, un scrolling vertical est plus cohérent avec :

- la lecture d’un tunnel ;
- les obstacles transversaux ;
- la sensation de chute ou d’ascension ;
- la pseudo-profondeur ;
- le contrôle gauche/droite ;
- la construction d’une identité visuelle forte.

---

## 4.2. Nouveau modèle

Le jeu devient :

> **une course hyperspeed dans un puits organique numérique généré procéduralement.**

Le joueur reste dans le tiers inférieur de l’écran.

Le monde arrive depuis le haut et s’écoule vers le bas.

Le déplacement principal devient :

- gauche ;
- droite.

La progression se fait sur l’axe vertical.

---

## 4.3. Position cible du joueur

Position recommandée :

- environ **70 à 75 % de la hauteur** ;
- suffisamment bas pour afficher beaucoup de terrain futur ;
- suffisamment haut pour laisser de l’espace au trail et aux effets arrière.

Exemple conceptuel :

```text
┌──────────────────────┐
│        FUTUR         │
│                      │
│   ███          ███   │
│    ██          ██    │
│      █        █      │
│                      │
│          ●           │
│                      │
└──────────────────────┘
```

---

## 4.4. Nouveau modèle mental du code

Aujourd’hui :

```ts
worldX += speed;
player.x = constant;
player.y = steering;
```

Cible :

```ts
worldY += speed;
player.y = constant;
player.x = steering;
```

Conséquences :

- `center(i)` devient un centre horizontal ;
- `topAt()` / `botAt()` deviennent `leftAt()` / `rightAt()` ;
- les membranes deviennent horizontales ;
- le trail devient vertical ;
- les effets de vitesse sont orientés vers le bas ;
- le look-ahead devient majoritairement vertical.

La plupart des mathématiques existantes peuvent être conservées en changeant leur interprétation.

---

# 5. Piliers de direction artistique

## 5.1. La grotte n’est pas un décor

Elle doit être perçue comme une **matière**.

Les murs ne sont pas simplement deux lignes.

La zone extérieure au tunnel est composée de :

- cellules ;
- petits carrés ;
- fragments ;
- masses lumineuses ;
- motifs répétés.

Le passage jouable reste un vide plus sombre.

---

## 5.2. Matière numérique + organisme vivant

La grotte ne doit pas devenir réaliste.

La direction cible se situe entre :

- matière numérique ;
- organisme vivant ;
- tunnel abstrait ;
- hyperspeed ;
- environnement réactif.

La grotte peut :

- respirer ;
- pulser ;
- réagir aux passages ;
- vibrer localement ;
- s’illuminer ;
- se désynchroniser ;
- perdre des fragments ;
- se reformer.

Mais sa vraie géométrie de collision reste stable.

---

# 6. Principe fondamental : lisibilité avant spectacle

Trois éléments sont sacrés :

1. **la silhouette réelle du tunnel** ;
2. **le joueur** ;
3. **les ouvertures obligatoires des obstacles**.

Ils ne doivent jamais devenir ambigus.

---

## 6.1. Séparer gameplay et spectacle

Architecture graphique recommandée :

```text
BACKGROUND
↓
DEEP CAVE CELLS
↓
CAVE CELLS
↓
WORLD FX
↓
COLLISION EDGE
↓
COLLECTIBLES
↓
PLAYER
↓
PLAYER FX
↓
HUD
↓
SCREEN FX
```

Le point central est le suivant :

> Les effets peuvent déformer ou masquer partiellement les couches décoratives, mais la véritable frontière de collision est redessinée au-dessus.

---

## 6.2. Gameplay Edge

Créer une passe spécifique correspondant au véritable bord dangereux.

Cette frontière doit :

- être fine ;
- rester nette ;
- être indépendante du glow ;
- résister aux distorsions ;
- rester visible pendant le turbo ;
- rester stable pendant l’overdose.

---

# 7. La grotte comme système animé

## 7.1. Cellules

Chaque cellule peut disposer de paramètres simples :

```text
position
scale
luminosité
phase
profondeur
distance au tunnel
état
```

États possibles :

```text
REST
■

ACTIVE
□

SPEED
■│

IMPACT
▰

DISSOLVE
▫

FRAGMENT
▪
```

Il ne s’agit pas forcément de sprites différents.

Une simple cellule carrée transformée suffit.

---

## 7.2. Distance à la paroi

Les cellules proches du tunnel doivent être :

- plus lumineuses ;
- plus réactives ;
- légèrement plus grosses ;
- davantage affectées par les impacts.

Les cellules profondes dans la roche :

- sont plus sombres ;
- bougent moins ;
- servent surtout à donner de la masse.

Exemple :

```text
░░░░▒▒▓████
░░▒▒▓████
▒▓████

      TUNNEL
```

---

## 7.3. Respiration

La grotte peut respirer sans modifier les collisions.

La matière graphique peut se déplacer de quelques pixels autour du bord réel.

La collision reste fixe.

```text
collision réelle
──────────────

matière visuelle
≈≈≈≈≈≈≈≈≈≈≈≈≈
```

Comportement par section :

### OUVERT
- respiration lente ;
- amplitude douce ;
- faible activité.

### ÉTROIT
- respiration plus rapide ;
- tension visuelle accrue.

### MEMBRANE
- contractions locales.

### SLALOM
- onde voyageant dans la matière.

---

# 8. Faux relief et pseudo-profondeur

Le scrolling vertical permet de simuler une profondeur très forte sans véritable 3D.

---

## 8.1. Scale en fonction de Y

Les cellules lointaines :

- sont petites ;
- peu lumineuses ;
- plus proches du centre.

En arrivant vers le joueur :

- elles grossissent ;
- s’écartent ;
- deviennent plus lumineuses.

```text
      ▪

    ▫   ▫

   ■     ■

  █       █

      ●
```

---

## 8.2. Fausse perspective

La grotte peut légèrement converger vers le haut.

```text
       FUTUR
        │
      █   █
     █     █
    █       █
   █         █

       ●
```

Il ne faut pas modifier les collisions.

La perspective est uniquement une transformation graphique.

---

## 8.3. Plusieurs plans

La matière peut être répartie sur quelques couches :

| Couche | Vitesse apparente | Luminosité | Fonction |
|---|---:|---:|---|
| Fond | faible | faible | profondeur |
| Matière profonde | moyenne | moyenne | volume |
| Bord | normale | forte | gameplay |
| Fragments avant-plan | forte | ponctuelle | spectacle |

---

# 9. La vitesse doit transformer le monde

La vitesse ne doit pas être représentée uniquement par un compteur.

Elle doit modifier l’ensemble du rendu.

---

## 9.1. Speed streaks verticaux

Repos :

```text
■
```

Vitesse :

```text
■
│
│
```

Turbo :

```text
■
║
║
║
```

Le bord réel du tunnel reste net.

---

## 9.2. Matière directionnelle

À haute vitesse :

- certaines cellules s’étirent ;
- des traits apparaissent ;
- les fragments chutent vers le bas ;
- la matière semble aspirée derrière le joueur.

---

## 9.3. Faux FOV

Pendant le turbo, le tunnel peut visuellement s’ouvrir légèrement.

Normal :

```text
█           █
 █         █
  █       █

      ●
```

Turbo :

```text
   █     █
  █       █
 █         █
█           █

      ●
```

La collision ne change pas.

---

# 10. Le joueur : noyau clair et enveloppe spectaculaire

## 10.1. Hitbox stable

La hitbox reste simple, idéalement proche d’un cercle.

Le rendu peut énormément se déformer autour.

Principe :

```text
      ○
      ^
    HITBOX
```

Le joueur doit toujours pouvoir suivre visuellement le noyau.

---

## 10.2. Stretch

Normal :

```text
●
```

Vitesse :

```text
●
│
│
```

Turbo :

```text
◉
║
║
║
│
```

L’enveloppe peut être longue.

Le noyau reste net.

---

## 10.3. Steering

En virage gauche/droite :

- corps légèrement incliné ;
- squash latéral ;
- trail retardé ;
- légère anticipation du visage ;
- petit overshoot graphique possible.

La physique reste instantanée.

L’animation crée l’impression d’inertie.

---

# 11. Camera Feel

## 11.1. Séparer Kick et Shake

### Camera Kick

Impulsion directionnelle courte.

Utilisations :

- turbo ;
- near-miss ;
- collision ;
- pickup important.

Durée indicative :

- 50 à 140 ms.

### Camera Shake

Oscillation chaotique.

Réserver à :

- collision importante ;
- mort ;
- overdose ;
- événements majeurs.

Le kick peut être fréquent.

Le shake doit rester rare.

---

## 11.2. Look-ahead

Le joueur doit toujours voir ce qui l’attend.

La caméra peut :

- légèrement avancer vers le haut ;
- se décaler dans le sens du steering ;
- ouvrir le cadre en turbo.

Le mouvement doit rester subtil.

---

# 12. Turbo : effet signature

Le turbo doit être un événement complet.

---

## 12.1. Chorégraphie

### T = 0 ms

Pression sur A.

Le blob se comprime brièvement.

### T ≈ 50 ms

Micro suspension visuelle.

Certaines particules proches semblent ralentir.

### T ≈ 80 ms

Libération.

Déclencher :

- kick caméra ;
- ring ;
- flash local ;
- explosion arrière ;
- stretch ;
- changement du son.

### T ≈ 120–300 ms

- zoom-out ;
- speed streaks ;
- cellules étirées ;
- parallaxe accélérée.

### Turbo stabilisé

L’écran doit redevenir lisible.

Conserver :

- stretch ;
- trail ;
- vitesse ;
- léger FOV ;
- effets directionnels.

Éviter de conserver :

- gros flash ;
- gros shake ;
- aberration forte ;
- particules excessives.

---

# 13. Distorsion locale

Une petite zone elliptique autour du joueur peut déformer l’image.

```text
       __________
     /            \
────(      ●       )────
     \____________/
```

Utilisation :

### Normal
- aucune.

### Turbo
- modérée.

### Surge
- forte mais courte.

### Near-miss
- petite onde locale.

La distorsion ne doit jamais toucher directement le Gameplay Edge.

---

# 14. Near-miss — mécanique centrale du Game Feel

Le near-miss doit devenir l’un des événements les plus satisfaisants du jeu.

---

## 14.1. Déroulé

### Approche

Une légère charge apparaît entre le joueur et la paroi.

### Point le plus proche

Déclencher :

- illumination locale du bord ;
- spark ;
- filament énergétique ;
- camera kick ;
- rumble court ;
- micro squash.

### Après passage

- fragments arrachés ;
- onde lumineuse dans la paroi ;
- courte traînée sur le mur ;
- récupération rapide.

La géométrie réelle ne change jamais.

---

## 14.2. Intensité

L’intensité doit dépendre directement de la distance.

Exemple :

```text
14 px → intensité 0.25
8 px  → intensité 0.50
3 px  → intensité 0.95
```

Une valeur unique peut piloter :

- luminosité ;
- nombre de fragments ;
- camera kick ;
- rumble ;
- volume du son ;
- taille de l’onde ;
- squash du joueur.

---

# 15. Membranes et obstacles

En vertical, les membranes deviennent horizontales.

Exemple :

```text
████████     ████████

          ●
```

Le joueur doit passer par l’ouverture.

---

## 15.1. Télégraphie

Très loin :

- faible contraste ;
- petite taille ;
- légère convergence de matière.

En approche :

- ouverture plus visible ;
- glow qui augmente ;
- cellules qui convergent ;
- pulsation.

Juste avant :

- lèvre lumineuse ;
- signal sonore discret.

---

## 15.2. Passage réussi

Lors du franchissement :

- léger whoosh ;
- contraction derrière le joueur ;
- petite onde ;
- particules latérales ;
- mini kick.

L’objectif est de transformer un simple obstacle en événement physique.

---

# 16. Collectibles

## 16.1. Attraction visuelle

Même si le gameplay n’a pas de magnétisme réel, les collectibles peuvent sembler attirés par le joueur pendant les toutes dernières frames.

```text
○

  ○

    ●
```

Puis :

- accélération vers le noyau ;
- compression ;
- flash ;
- burst arrière.

---

## 16.2. Fuel

La collecte doit augmenter progressivement en satisfaction lorsqu’une chaîne est entretenue.

Utiliser :

- pitch montant ;
- particules légèrement plus nombreuses ;
- expressions du blob ;
- petites ondes.

---

## 16.3. Séquence rouge

Les pièces rouges peuvent être reliées par un filament très discret.

```text
○
 ╲
  ○
   ╲
    ○
```

Après chaque collecte :

- le prochain segment s’illumine ;
- le pitch augmente ;
- la progression devient compréhensible sans regarder le HUD.

---

# 17. Collision

## 17.1. Hit-stop

Lors d’une collision :

- gameplay figé 60–90 ms ;
- certaines particules continuent ;
- squash du joueur continue ;
- flash continue ;
- caméra peut terminer son kick.

Cela amplifie énormément l’impact.

---

## 17.2. Écrasement directionnel

Collision gauche :

- blob aplati vers la gauche.

Collision droite :

- blob aplati vers la droite.

La hitbox reste identique.

---

## 17.3. Destruction locale

Quelques cellules de la paroi peuvent être éjectées.

Le mur réel reste présent.

Les cellules :

- partent en fragments ;
- disparaissent ;
- ou se reforment.

---

# 18. Overdose

L’overdose doit être ressentie comme une altération du monde.

---

## 18.1. Entrée

Déclencher :

- micro flash ;
- RGB split très bref ;
- compression du blob ;
- kick ;
- rupture sonore ;
- passage vers une palette toxique.

---

## 18.2. État actif

La grotte peut sembler perdre sa synchronisation :

- jitter de certaines cellules ;
- faux frame skipping ;
- petits dédoublements ;
- retard local ;
- variations de rythme.

La frontière de collision reste stable.

Le joueur reste parfaitement lisible.

---

## 18.3. Fin

Créer un sentiment de rétablissement :

- resynchronisation ;
- onde propre ;
- retour des cellules ;
- petite détente sonore ;
- caméra qui se stabilise.

---

# 19. Effets environnementaux globaux

## 19.1. Respiration

Faible, permanente, dépendante de la section.

## 19.2. Ondes

Déclenchées par :

- near-miss ;
- turbo ;
- milestones ;
- collision ;
- regain d’une vie.

## 19.3. Fragments

Usage ponctuel.

Ne pas maintenir une pluie constante.

## 19.4. Poussières

Faibles à vitesse normale.

Plus nombreuses avec la vitesse.

## 19.5. Speed lines

Orientées verticalement.

Longueur proportionnelle à la vitesse.

## 19.6. Vignette danger

Uniquement périphérique.

Ne jamais masquer le tunnel.

## 19.7. Aberration chromatique

Très courte.

Réserver à :

- gros impact ;
- overdose ;
- surge ;
- événement majeur.

Jamais permanente.

---

# 20. Signature visuelle par section

| Section | Signature |
|---|---|
| OUVERT | respiration ample, matière calme |
| ÉTROIT | pulsations plus rapides |
| MEMBRANE | contractions horizontales |
| SLALOM | vagues longitudinales dans la matière |

Le joueur doit progressivement reconnaître une section sans regarder son nom.

---

# 21. Matrice d’animations

| Événement | Anticipation | Impact | Recovery | Joueur | Monde | Caméra | FX | Son / Haptique | Priorité |
|---|---|---|---|---|---|---|---|---|---|
| Course normale | — | — | continu | micro-liquid | respiration | suivi doux | poussières | ambiance | P0 |
| Accélération naturelle | densité ↑ | vitesse ↑ | nouveau rythme | stretch progressif | cellules étirées | zoom-out | streaks | couche sonore ↑ | P0 |
| Steering | inclinaison | changement de direction | overshoot | squash/stretch | stable | lead latéral | trail courbé | souffle | P1 |
| Turbo press | compression | propulsion | expansion | squash → stretch | onde | kick + zoom | ring + flash | kick + rumble | P0 |
| Turbo actif | — | hyperspeed | hold | noyau + enveloppe | matière directionnelle | FOV | streaks | moteur | P0 |
| Turbo release | — | ralentissement apparent | 200–300 ms | retour stretch | trails raccourcissent | zoom retour | trail ↓ | souffle descendant | P1 |
| Fuel faible | jauge basse | tension | recharge | inquiet | pulse discret | stable | vignette | heartbeat léger | P1 |
| Fuel pickup | attraction | absorption | burst | punch positif | onde locale | micro kick | spark | pitch | P0 |
| Combo fuel | pickups proches | intensité ↑ | chute | happy/wow | onde ↑ | stable | FX ↑ | pitch montant | P1 |
| Near miss | proximité | slice | onde arrière | squash | paroi pulse | kick | fragments | tick + rumble | P0 |
| Danger continu | approche | tension | disparition | scared | bord ↑ | stable | vignette | rumble progressif | P0 |
| Membrane distante | matière converge | ouverture | — | — | télégraphie | look-ahead | glow | pulse | P0 |
| Passage membrane | pulse | franchissement | contraction | stretch | fermeture arrière | mini punch | particules | whoosh | P1 |
| Collision | 0–30 ms | impact | invincibilité | pancake | fragments | kick + shake | flash + ring | hit lourd | P0 |
| Hit-stop | — | monde figé | reprise | animation continue | gel | stop | particules continuent | impact maintenu | P0 |
| Invincibilité | après hit | ghost | retour | afterimage | normal | stable | ghost trail | son filtré | P1 |
| Overdose entrée | fuel 0 | rupture | toxique | compression | désync | snap | RGB bref | glitch | P0 |
| Overdose actif | — | monde malade | timer | noyau clair | jitter | instable léger | toxique périphérique | filtre | P1 |
| Overdose fin | resync | cure | normal | focused | onde propre | stabilisation | flash doux | résolution | P1 |
| Surge blanc | attraction | flash | 3 s | enveloppe blanche | onde forte | zoom bref | ring | dash | P1 |
| Séquence rouge début | filament | première pièce | chaîne | stable | — | stable | liaison | motif | P1 |
| Pièce rouge | pulse suivante | pickup | segment suivant | punch | — | stable | spark | pitch ↑ | P1 |
| 6/6 + vie | dernière très forte | climax | 400–600 ms | gros rebond | onde globale | zoom punch | burst | milestone | P1 |
| OUVERT | transition | calme | continu | normal | respiration lente | relax | FX rares | ambiance | P2 |
| ÉTROIT | contraction | tension | continu | scared | pulse rapide | léger zoom | bord fort | rumble ↑ | P1 |
| SLALOM | vague à venir | changement axe | continu | banking | onde | lead X | trails | swoosh | P1 |
| Milestone | pré-signal | seuil | 1 s | réaction | onde | zoom bref | pulse | couche musicale | P2 |
| Dernière vie | HUD réagit | tension | continu | nerveux | danger ↑ | stable | HUD pulse | heartbeat | P2 |
| Mort finale | contact | explosion | game over | déformation | matière expulsée | hit-stop + recoil | double ring | impact max | P0 |

---

# 22. Architecture de Game Feel

Plutôt que coder des effets directement dans chaque événement, créer des canaux globaux.

Exemple :

```ts
feel.player.stretch
feel.player.squash
feel.player.afterImage

feel.camera.zoom
feel.camera.kickX
feel.camera.kickY
feel.camera.rotation
feel.camera.trauma

feel.world.speed
feel.world.breath
feel.world.distortion
feel.world.desync

feel.wall.pulse
feel.wall.impactWave

feel.screen.flash
feel.screen.chromatic
feel.screen.vignette
```

Les événements appellent ensuite :

```ts
feel.trigger('nearMiss', {
  side: 'left',
  intensity: 0.82,
  speed: speedNorm
});
```

Le système s’occupe de répartir cette intensité entre :

- animation ;
- caméra ;
- particules ;
- son ;
- haptique.

---

# 23. Système d’intensité

Presque tous les effets doivent recevoir une intensité normalisée :

```text
0 -------------------- 1
subtil              violent
```

Exemple :

```ts
nearMissIntensity = 0.84;
```

Peut piloter :

```text
wallPulse        0.84
cameraKick       0.67
particleCount    0.72
rumble           0.80
soundVolume      0.74
soundPitch       0.86
```

Cela crée une cohérence sensorielle.

---

# 24. Budget FX

Règle recommandée :

> **1 effet majeur + 2 effets secondaires maximum simultanément.**

Niveaux :

| Niveau | Exemple | Budget |
|---|---|---|
| Ambient | déplacement | 2–4 effets subtils |
| Feedback | pickup / near-miss | 1 moyen + 2 subtils |
| Hero FX | turbo / collision / mort | 1 majeur + 2 secondaires |

---

# 25. Priorité des événements

Exemple :

```text
DEATH       100
HIT          90
OVERDOSE     80
LIFE_GAIN    70
TURBO_START  60
SURGE        55
NEAR_MISS    40
PICKUP       30
STEERING     10
AMBIENT       1
```

Un événement de priorité supérieure peut atténuer les FX inférieurs.

Exemple :

- collision pendant turbo → l’impact prend la priorité ;
- le turbo continue physiquement ;
- ses effets visuels passent temporairement au second plan.

---

# 26. Lisibilité dynamique

Le jeu peut automatiquement diminuer les effets décoratifs lorsque la difficulté visuelle augmente.

Exemple conceptuel :

```ts
if (danger > 0.75) {
  decorativeFX *= 0.5;
}
```

Effets concernés :

- particules ;
- bloom ;
- distorsion ;
- poussières ;
- aberration ;
- overlays.

Principe :

> **Plus la situation devient dangereuse, plus le jeu nettoie subtilement l’écran.**

---

# 27. Synchroniser image, son et haptique

Le son ne doit pas être traité comme une couche indépendante.

Une même intensité doit alimenter :

- animation ;
- caméra ;
- FX ;
- audio ;
- rumble.

Exemple near-miss :

```text
proximité mur
      ↓
nearMissIntensity
      ↓
wall pulse
camera kick
sparks
rumble
volume
pitch
```

Cela donne l’impression que tous les effets proviennent d’un même phénomène physique.

---

# 28. P0 — première passe recommandée

Les éléments à implémenter en priorité sont :

1. **Verticalisation du gameplay**
2. **Cave Cells**
3. **Gameplay Edge**
4. **Speed deformation**
5. **Blob core + stretch**
6. **Turbo choreography**
7. **Near-miss FX**
8. **Hit choreography**
9. **Camera Kick**
10. **FX Priority / Budget**

L’objectif de cette passe est de valider la sensation générale avant d’aller plus loin.

---

# 29. P1 — polish principal

Une fois P0 validé :

- pseudo-perspective ;
- plusieurs couches de profondeur ;
- membranes animées ;
- attraction des collectibles ;
- séquences rouges reliées ;
- overdose désynchronisée ;
- distorsion locale ;
- signature visuelle des sections ;
- audio dynamique ;
- haptique plus détaillée.

---

# 30. P2 — spectacle et finition

À réserver pour la fin :

- milestones environnementaux ;
- variations de palettes ;
- transitions de biomes ;
- fragments avant-plan ;
- effets spéciaux de dernière vie ;
- petites variations de matière ;
- micro événements rares ;
- polish UI.

---

# 31. Critères de validation

La direction sera considérée comme réussie si :

### Compréhension
Un joueur comprend en quelques secondes :

- où il est ;
- où il peut passer ;
- ce qui est dangereux.

### Lisibilité
Même pendant le turbo :

- le joueur reste identifiable ;
- les bords de collision restent nets ;
- les ouvertures restent compréhensibles.

### Vitesse
La sensation de vitesse est forte même sans regarder le HUD.

### Near-miss
Un frôlement réussi est immédiatement ressenti comme une réussite.

### Turbo
L’activation du turbo est un moment signature.

### Collision
Un hit est très impactant sans devenir confus.

### Verticalité
Le joueur dispose de suffisamment d’espace pour lire le terrain à venir.

### Cohérence
Les effets semblent provenir du monde et non d’une collection d’animations indépendantes.

---

# 32. Résumé de direction

Cave Racer doit évoluer d’un :

> « tunnel horizontal dessiné par deux lignes lumineuses »

vers un :

> **runner vertical hyperspeed dans une cavité numérique vivante, où le tunnel est un vide découpé dans une matière cellulaire réactive.**

Le joueur reste simple.

La collision reste simple.

Le générateur reste déterministe.

Le spectacle vient de :

- l’animation de matière ;
- la pseudo-profondeur ;
- le stretch ;
- les trails ;
- la caméra ;
- les ondes ;
- les particules ;
- les effets locaux ;
- la synchronisation audio/haptique ;
- les triches de perspective.

Le résultat recherché doit donner l’impression d’un système beaucoup plus complexe que sa simulation réelle.

---

# 33. Principe directeur final

> **Ne jamais sacrifier la lecture du gameplay pour montrer un effet.**

L’effet spectaculaire idéal est celui qui :

1. renforce une information existante ;
2. augmente la sensation physique ;
3. raconte un événement ;
4. disparaît rapidement ;
5. laisse la géométrie de jeu parfaitement compréhensible.

C’est cette discipline qui permettra à Cave Racer d’être à la fois **moderne, spectaculaire, nerveux et lisible**.
