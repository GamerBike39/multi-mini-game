# BLOB BREAKER — Plan de production des assets graphiques

## 0. Objet du document

Ce document prépare la phase graphique pendant que le prototype fonctionnel est en cours d'intégration.

Le but n'est pas de fabriquer une grosse sprite sheet figée. BLOB BREAKER doit conserver son identité procédurale et son rendu Canvas vivant.

La phase asset doit produire un **système graphique modulaire** :

- des formes et silhouettes cohérentes ;
- des glyphes immédiatement lisibles ;
- des références d'états ;
- des règles de couleur ;
- des objets de level design clairement différenciés ;
- un langage HUD cohérent ;
- un guide d'intégration Canvas.

Les animations de réaction, glow, rings, explosions, trails, déformations et particules restent majoritairement procédurales.

---

# 1. Principes directeurs

## 1.1 Hiérarchie de lecture

Toujours construire l'information dans cet ordre :

1. silhouette / masse
2. structure interne
3. glyphe fonctionnel
4. micro-animation
5. couleur
6. FX

Une mécanique ne doit jamais reposer sur la couleur seule.

## 1.2 Test monochrome obligatoire

Tout asset gameplay doit rester identifiable en niveaux de gris.

Questions à poser :

- Explosive identifiable ?
- Gravity identifiable ?
- Reinforced identifiable ?
- Wall clairement différent d'une brique ?
- Bumper clairement différent d'un Wall et d'une brique ?

## 1.3 Calme visuel au repos

Les assets idle doivent être discrets.

Le spectacle vient de :
- l'impact ;
- l'activation ;
- la destruction ;
- les réactions en chaîne ;
- les interactions avec la géométrie.

Pas de glow fort ou de clignotement permanent.

## 1.4 Scalabilité

Les briques changent de taille selon les niveaux.

Tester au minimum :

- grande : ~100 × 24
- moyenne : ~64 × 20
- petite : ~48 × 18

Les signes fonctionnels doivent rester lisibles à la plus petite taille.

---

# 2. Stratégie de production

## 2.1 Ce qui devient un asset ou une référence graphique

- silhouette des briques ;
- structure de coque reinforced ;
- noyau explosive ;
- chevrons gravity ;
- langage architectural Wall ;
- noyau/anneaux du Bumper ;
- pictogrammes Drops ;
- pictogrammes HUD ;
- états de référence ;
- palettes et règles de contraste.

## 2.2 Ce qui reste procédural

Ne pas produire comme sprites runtime :

- particules ;
- débris génériques ;
- explosions complètes ;
- shockwaves ;
- flash écran ;
- trails ;
- glow dynamique ;
- screenshake ;
- wobble ;
- squash/stretch ;
- textes COMBO / BOOM / FREEZE ;
- multiples tailles de Wall ;
- multiples tailles de paddle.

Règle :

**asset = identité**
**code = mouvement et vie**

---

# 3. Architecture de la planche maître

La master sheet est organisée en 7 zones.

## Zone 01 — Règles du langage

Présenter :
- hiérarchie de lecture ;
- test monochrome ;
- densité maximale ;
- principe "une signature forte par mécanique".

## Zone 02 — Bricks / objectifs

Colonnes :

- Normal
- Reinforced
- Explosive
- Gravity

Lignes :

- Idle
- Signal
- Hit
- Active
- Destruction

Toutes les cellules ne sont pas forcément utilisées.

## Zone 03 — Architecture

### Wall

Présenter :
- horizontal court ;
- horizontal long ;
- vertical ;
- impact balle ;
- impact laser.

Le Wall doit sembler être un morceau du niveau, pas une grosse brique.

## Zone 04 — Mécanismes

### Bumper

Présenter :
- idle ;
- compression ;
- hit ;
- rebound ;
- retour au repos.

Le Bumper doit paraître interactif avant même d'être touché.

## Zone 05 — Glyphes isolés

Créer une banque indépendante :

- reinforced shell ;
- rivets ;
- explosive core ;
- explosive queued ring ;
- gravity chevrons ;
- gravity detach marker ;
- bumper core ;
- wall structural motif.

Objectif :
permettre une intégration Canvas par couches.

## Zone 06 — Drops + HUD

### Drops existants

- MULTI
- LARGE
- SLOW
- LASER
- GLUE
- FLAME
- GIANT
- SMALL

### HUD

- vie ;
- multiball ;
- laser ;
- glue ;
- flame ;
- giant ;
- slow ;
- large ;
- small ;
- freeze.

Les pictogrammes doivent rester lisibles à petite taille.

## Zone 07 — Scènes de validation

Prévoir :

- grille monochrome ;
- grille couleur ;
- scène gameplay calme ;
- stress test raisonnable ;
- stress test extrême ;
- scène Wall ;
- scène Bumper ;
- scène Wall + Bumper + explosives.

---

# 4. Inventaire précis des livrables graphiques

## 4.1 Bricks

### NORMAL

Livrables :
- base monochrome ;
- base couleur ;
- hit reference ;
- destruction reference.

Contraintes :
- silhouette simple ;
- aucune signature animée idle ;
- sert de référence neutre.

### REINFORCED

Livrables :
- base monochrome ;
- base couleur ;
- shell overlay ;
- rivets overlay ;
- hit state ;
- damaged state ;
- destruction reference.

Contraintes :
- impression de masse ;
- pas de pulsation ;
- dommage lisible sans les HP.

### EXPLOSIVE

Livrables :
- base monochrome ;
- base couleur ;
- core idle ;
- queued state ;
- hit state ;
- explosion reference ;
- chain climax reference.

Contraintes :
- noyau central très dominant ;
- queued immédiatement perceptible ;
- la couleur chaude ne doit pas être le seul indice.

### GRAVITY

Livrables :
- base monochrome ;
- base couleur ;
- chevrons ;
- signal state ;
- detach state ;
- falling state ;
- paddle impact reference.

Contraintes :
- lecture "vers le bas" immédiate ;
- mouvement idle faible ;
- distinction nette entre brique en grille et hazard en chute.

---

# 5. Wall

## 5.1 Identité

Catégorie visuelle :
**ARCHITECTURE**

Le Wall :
- ne ressemble pas à une brique ;
- possède une structure interne répétable ;
- garde un faible niveau de contraste ;
- doit accepter toutes les longueurs.

## 5.2 Livrables

- motif architectural monochrome ;
- motif couleur ;
- cap gauche / centre / cap droit si nécessaire ;
- variante verticale si le motif n'est pas rotation-safe ;
- impact balle reference ;
- impact laser reference.

## 5.3 Recommandation d'intégration

Préférer :
- dessin Canvas procédural ;
- répétition d'un motif ;
- 9-slice logique si nécessaire.

Éviter :
- un PNG par taille.

---

# 6. Bumper

## 6.1 Identité

Catégorie visuelle :
**MÉCANISME**

Il doit être :
- rond ;
- lisible ;
- élastique ;
- énergique ;
- plus expressif qu'un Wall.

## 6.2 Livrables

- silhouette monochrome ;
- version couleur ;
- core ;
- anneau ;
- idle ;
- hit ;
- compression ;
- rebound ;
- cooldown/return.

## 6.3 Intégration

Recommandation :
Bumper comme composant Canvas composé de :

1. body
2. core
3. ring(s)
4. procedural squash
5. procedural hit ring
6. procedural particles

Pas besoin de sprite animé complet.

---

# 7. Drops et HUD

## 7.1 Problème actuel à éviter

Les drops ne doivent pas dépendre de lettres comme seule identification à long terme.

## 7.2 Direction

Créer un pictogramme simple par pouvoir.

Exemples conceptuels :

- MULTI : trois points / trois balles
- LARGE : paddle avec flèches extérieures
- SMALL : paddle avec flèches intérieures
- SLOW : horloge / vague ralentie
- LASER : double rayon
- GLUE : lien / goutte / accroche
- FLAME : flamme
- GIANT : balle + halo / flèches d'expansion

## 7.3 Bonus / malus

Préparer dès maintenant un langage de polarité, même si la logique gameplay n'est pas refactorée immédiatement.

Proposition :
- bonus : contenant doux / positif
- malus : contenant angulaire / instable
- neutre / chaos : contenant spécifique

`SMALL` devra visuellement être perçu comme un effet potentiellement négatif.

---

# 8. Format source et exports

## 8.1 Source recommandée

Privilégier :
- SVG pour glyphes et formes simples ;
- Affinity Designer/Photo pour planches de présentation ;
- PNG/WebP pour previews seulement.

## 8.2 Runtime

Ne pas imposer l'utilisation des SVG runtime.

Les SVG servent de :
- référence ;
- source vectorielle ;
- base de mesure.

Le moteur Canvas peut reconstruire les formes en code si cela reste plus performant et flexible.

## 8.3 Nommage

Convention proposée :

```txt
brick_normal_base.svg
brick_reinforced_shell.svg
brick_reinforced_rivets.svg
brick_explosive_core.svg
brick_explosive_queued.svg
brick_gravity_chevrons.svg

wall_pattern.svg
bumper_core.svg
bumper_ring.svg

drop_multi.svg
drop_large.svg
drop_small.svg
drop_slow.svg
drop_laser.svg
drop_glue.svg
drop_flame.svg
drop_giant.svg
```

Versions de planches :

```txt
blob-breaker-master-monochrome-v01.png
blob-breaker-master-color-v01.png
blob-breaker-states-v01.png
blob-breaker-hud-drops-v01.png
```

---

# 9. Ordre de production

## AG0 — Validation du prototype

Attendre seulement les résultats nécessaires du prototype :
- forme réelle du Wall ;
- diamètre/feedback réel du Bumper ;
- tailles minimales réellement utilisées.

Le travail monochrome peut démarrer avant.

## AG1 — Master monochrome

Produire :
- 4 briques ;
- Wall ;
- Bumper ;
- glyphes isolés.

Gate :
tout doit être reconnaissable sans couleur.

## AG2 — Master couleur

Réintroduire :
- palette de rang ;
- accents fonctionnels ;
- contraste.

Gate :
la couleur améliore la lecture mais ne devient jamais indispensable.

## AG3 — États

Produire les strips :
- idle ;
- signal ;
- hit ;
- active ;
- destruction ;
- queued ;
- detach ;
- falling.

Gate :
chaque état doit être transposable en animation Canvas.

## AG4 — Drops + HUD

Créer :
- 8 pictogrammes drops ;
- états HUD correspondants ;
- langage bonus / malus.

## AG5 — Guide intégration Canvas

Documenter :
- ordre de dessin ;
- couches ;
- échelles ;
- marges internes ;
- contrastes ;
- état animé ;
- fallback petite taille.

## AG6 — Validation terrain

Créer :
- scène calme ;
- stress test raisonnable ;
- stress test extrême ;
- scène Wall ;
- scène Bumper ;
- scène chaîne explosive + géométrie.

Gate final :
la balle reste prioritaire visuellement.

---

# 10. Règles d'intégration Canvas

## 10.1 Brick render stack

Ordre conseillé :

```txt
1. base shape
2. structural overlay
3. functional glyph
4. damage layer
5. state animation
6. local glow
7. hit feedback
8. global FX
```

## 10.2 Petites tailles

Si la largeur < seuil défini :

- réduire les détails ;
- garder le glyphe ;
- garder la silhouette ;
- supprimer les micro-rivets ou textures fines ;
- ne jamais réduire le signe fonctionnel au point qu'il disparaisse.

## 10.3 Couleur

Conserver la palette de rang pour le corps.

Accent fonctionnel :
- explosive : chaud ;
- gravity : froid ;
- reinforced : traitement de matériau / contraste ;
- normal : aucun accent spécial.

## 10.4 Animation

Les assets ne doivent jamais contenir une animation "baked" si :
- l'échelle varie ;
- la durée dépend du gameplay ;
- le code possède déjà l'information de timing.

---

# 11. Checklist QA graphique

## Lisibilité
- [ ] Normal identifiable
- [ ] Reinforced identifiable
- [ ] Explosive identifiable
- [ ] Gravity identifiable
- [ ] Wall ≠ brick
- [ ] Bumper ≠ Wall
- [ ] Bumper ≠ brick

## Monochrome
- [ ] aucune mécanique dépend de la couleur
- [ ] glyphes lisibles à petite taille

## Mouvement
- [ ] idle calme
- [ ] queued visible
- [ ] detach gravity visible
- [ ] bumper hit lisible

## Densité
- [ ] pas de détails inutiles
- [ ] pas de glow baked
- [ ] la balle reste prioritaire

## Scalabilité
- [ ] 100×24
- [ ] 64×20
- [ ] 48×18

## Intégration
- [ ] forme reconstructible en Canvas
- [ ] overlays séparables
- [ ] nomenclature claire
- [ ] pas d'asset par taille

---

# 12. Définition de terminé de la phase asset

La phase asset est terminée lorsque :

1. la master monochrome est validée ;
2. la master couleur est validée ;
3. les strips d'états sont validés ;
4. Wall et Bumper ont un langage stable ;
5. Drops/HUD utilisent des pictogrammes cohérents ;
6. le guide Canvas permet à un agent d'intégrer chaque élément sans interprétation artistique ;
7. les stress tests restent lisibles ;
8. les éléments décoratifs ne prennent pas le dessus sur la balle et les interactions ;
9. aucun asset inutilement figé n'a été créé ;
10. les choix graphiques restent compatibles avec les résultats du B-LAB.

---

# 13. Livrables finaux

À la fin, conserver :

- `MASTER_MONOCHROME`
- `MASTER_COLOR`
- `STATES`
- `WALL_BUMPER`
- `HUD_DROPS`
- `CANVAS_INTEGRATION_GUIDE`
- `VALIDATION_SCENES`
- dossier des SVG sources si réellement utiles au runtime ou à la documentation.

Le système doit rester suffisamment modulaire pour accueillir ensuite :

- Moving ;
- Portal ;
- Ghost ;
- Switch ;
- Reflector.

Ces futures mécaniques devront réutiliser le même langage :
**objectif / architecture / mécanisme / état / accent fonctionnel**.
