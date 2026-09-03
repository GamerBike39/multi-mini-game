# Chantier B — Géométrie : Wall + Bumper

## 1. But

Ajouter une deuxième couche au casse-brique :

- **Briques** = objectifs à détruire.
- **Obstacles** = géométrie qui modifie la trajectoire.

La couche d'obstacles contient désormais :

```ts
type ObstacleKind = 'wall' | 'bumper' | 'moving';
```

---

# 2. Modèle de données recommandé

Utiliser une union discriminée plutôt qu'une interface remplie de propriétés optionnelles.

```ts
interface BreakerWall {
  id: number;
  kind: 'wall';
  x: number;
  y: number;
  w: number;
  h: number;
}

interface BreakerBumper {
  id: number;
  kind: 'bumper';
  x: number;
  y: number;
  r: number;
  boost: number;
  pulseT: number;
}

interface BreakerMoving {
  id: number;
  kind: 'moving';
  x: number; y: number; w: number; h: number;
  baseX: number; baseY: number;
  axis: 'x' | 'y';
  range: number;
  frequency: number;
  phase: number;
  vx: number; vy: number;
  pulseT: number;
}

type BreakerObstacle = BreakerWall | BreakerBumper | BreakerMoving;
```

Dans `BreakerGame` :

```ts
this.obstacles = [] as BreakerObstacle[];
```

Ne pas mettre les obstacles dans `this.bricks`.

---

# 3. Cycle de niveau

Séparer construction des briques et construction de la géométrie :

```ts
buildLevel(): void {
  this.buildBricks();
  this.buildObstacles();
}
```

Pour cette boucle :
- niveaux normaux : `Moving` est introduit à partir du niveau 5 ;
- B-LAB : layouts explicites ;
- `Wall` et `Bumper` restent disponibles dans les layouts de validation.

`levelCleared()` ne doit jamais dépendre des obstacles.

---

# 4. WALL

## Fonction
Le Wall :
- est indestructible ;
- ne possède pas de HP ;
- ne donne aucun point ;
- ne produit aucun drop ;
- ne compte pas pour le clear ;
- fait rebondir toutes les balles ;
- n'est jamais affecté par une explosion.

## Rendu
Le Wall doit ressembler à de l'architecture, pas à une grosse brique.

Principes :
- forme plus dense ;
- motif structurel / stries ;
- faible glow ;
- feedback d'impact 2/5 maximum.

Le Wall doit supporter toutes les dimensions sans asset spécifique.

## Laser
Choix V1 :
**les Walls bloquent les lasers**.

Le laser est détruit à l'impact avec :
- petit spark ;
- aucun score ;
- aucun effet sur le Wall.

Cela évite qu'une barrière physique soit traversée visuellement par les tirs.

## Gravity tile en chute
Choix V1 :
**une gravity tile détachée ignore les obstacles**.

Raison :
- ne pas transformer B1 en refonte de physique multi-corps ;
- conserver la mécanique actuelle.

Documenter ce comportement. Le revisiter uniquement s'il paraît visuellement incohérent pendant les tests.

---

# 5. Collision cercle / AABB pour Wall

Ajouter un helper dédié.

Signature suggérée :

```ts
interface CollisionHit {
  nx: number;
  ny: number;
  penetration: number;
  contactX: number;
  contactY: number;
}

circleVsAabb(
  cx: number,
  cy: number,
  r: number,
  boxX: number,
  boxY: number,
  boxW: number,
  boxH: number
): CollisionHit | null
```

Algorithme :
1. trouver le point du rectangle le plus proche du centre de la balle ;
2. calculer `dx`, `dy`, distance² ;
3. si distance² > r² : aucune collision ;
4. si distance > epsilon :
   - normale = `(dx, dy) / distance` ;
   - pénétration = `r - distance` ;
5. si le centre est exactement sur/dans la boîte :
   - choisir le côté le plus proche ;
   - produire une normale cardinale cohérente.

Réflexion générique :

```ts
const dot = vx * nx + vy * ny;
if (dot < 0) {
  vx -= 2 * dot * nx;
  vy -= 2 * dot * ny;
}
```

Séparer ensuite la balle :

```ts
x += nx * penetration;
y += ny * penetration;
```

Important :
- ne réfléchir que si la balle se déplace vers la surface (`dot < 0`) ;
- toujours corriger la pénétration pour éviter le jitter.

Pour le premier lot, ne pas remplacer immédiatement la collision des briques par ce helper.

---

# 6. BUMPER

## Fonction
Le Bumper :
- est circulaire ;
- est indestructible ;
- renvoie la balle selon la normale du cercle ;
- produit un boost temporaire ;
- donne un feedback fort au contact ;
- ne participe pas au score dans la V1.

## Collision cercle / cercle

```ts
circleVsCircle(
  ax: number,
  ay: number,
  ar: number,
  bx: number,
  by: number,
  br: number
): CollisionHit | null
```

Normale :
- du centre du bumper vers le centre de la balle.

Séparation :
- replacer la balle juste à l'extérieur de `ball.r + bumper.r`.

Réflexion :
- même formule vectorielle que pour Wall.

## Cooldown par balle

Ajouter sur chaque balle :

```ts
lastBumperId?: number;
lastBumperT?: number;
bumperBoostT?: number;
```

Après impact :

```ts
ball.lastBumperId = bumper.id;
ball.lastBumperT = 0.08;
```

Une nouvelle collision avec le même bumper est ignorée tant que `lastBumperT > 0`, sauf correction de pénétration.

---

# 7. Boost du Bumper

Ne jamais modifier `this.speed` à cause du Bumper.

`this.speed` appartient à la progression globale du jeu.

Proposition de départ :

```ts
const BUMPER_BOOST = 1.22;
const BUMPER_BOOST_TIME = 0.45;
```

À l'impact :
- direction réfléchie ;
- magnitude immédiate = `this.speed * BUMPER_BOOST` ;
- `bumperBoostT = BUMPER_BOOST_TIME`.

Puis retour progressif vers la vitesse cible.

Helper recommandé :

```ts
targetBallSpeed(ball): number
```

Exemple :

```ts
const boostK = clamp(ball.bumperBoostT / BUMPER_BOOST_TIME, 0, 1);
return this.speed * (1 + (BUMPER_BOOST - 1) * boostK);
```

À chaque frame :
- réduire `bumperBoostT` en temps réel ;
- tendre doucement la magnitude courante vers `targetBallSpeed(ball)`.

`normSpeed()` doit utiliser `targetBallSpeed(ball)` afin qu'une destruction de brique ne supprime pas instantanément le boost.

Valeurs à tuner dans B-LAB, pas à considérer comme définitives.

---

# 8. Rendu Bumper

## Idle
- respiration 2–3 % ;
- période ~2 s ;
- intensité 1/5.

## Hit
Durée 180–250 ms :
- squash radial ;
- ring ;
- flash local ;
- petit burst ;
- son synthétique distinct ;
- rumble léger.

Mettre :

```ts
bumper.pulseT = 0.25;
```

et dériver le squash/halo de ce timer.

Ne pas créer de sprite.

---

# 9. Ordre de collision balle

Dans la boucle d'update d'une balle libre :

1. déplacement ;
2. limites du monde ;
3. paddle ;
4. obstacles :
   - Walls ;
   - Bumpers ;
5. briques ;
6. anti-trajectoire horizontale ;
7. sortie écran.

La priorité exacte peut être ajustée si un cas de recouvrement apparaît, mais il faut garder un ordre déterministe.

Ne pas autoriser un Wall et une brique à occuper volontairement la même surface dans les layouts V1.

---

# 10. Interactions explicites V1

| Interaction | Décision |
|---|---|
| balle ↔ Wall | rebond |
| balle FLAME ↔ Wall | rebond |
| balle ↔ Bumper | rebond + boost |
| balle FLAME ↔ Bumper | rebond + boost |
| balle ↔ Moving | rebond relatif à la vitesse de surface |
| balle FLAME ↔ Moving | rebond relatif à la vitesse de surface |
| laser ↔ Wall | laser détruit |
| laser ↔ Moving | laser détruit |
| laser ↔ Bumper | ignoré en V1 |
| explosion ↔ Wall | aucun effet |
| explosion ↔ Bumper | aucun effet |
| gravity falling ↔ Wall | ignore |
| gravity falling ↔ Bumper | ignore |
| gravity falling ↔ Moving | ignore |
| Wall ↔ clear level | ignoré |
| Bumper ↔ clear level | ignoré |
| Moving ↔ clear level | ignoré |

Ces choix limitent volontairement la combinatoire pendant le prototype.

---

# 11. MOVING

`Moving` est une AABB indestructible animée par une sinusoïde déterministe.
Sa position est mise à jour avant les balles et sa vitesse de surface est
conservée pour calculer la réflexion dans le référentiel de l'obstacle. La
tolérance de collision du Wall est réutilisée afin que les coins restent
atteignables et lisibles.

Le rendu ajoute un rail et des marqueurs d'extrémité, puis réutilise la texture
du Wall à l'intérieur du corps avec une teinte dorée. Il n'ajoute pas de
contour en pointillés à la texture.

Le feedback d'un contact comprend un punch, un ring, des étincelles, un rumble
court et le SFX remplaçable `breaker.obstacle.moving`.

Le B-LAB `?breakerLab=moving` expose un Moving horizontal, un Moving vertical et
deux murs latéraux. Dans la progression, l'horizontal arrive au niveau 5 et le
vertical au niveau 9.

---

# 12. Définition de terminé B1/B2

## Wall
- aucune balle ne traverse à vitesse normale ;
- pas de jitter en contact ;
- multiball fonctionne ;
- FLAME rebondit ;
- laser est bloqué ;
- clear du niveau inchangé.

## Bumper
- direction de sortie cohérente quelle que soit la zone d'impact ;
- aucun double-hit perceptible ;
- boost perceptible mais contrôlable ;
- boost revient à la vitesse normale ;
- `this.speed` global n'est pas corrompu ;
- plusieurs balles peuvent toucher le même bumper indépendamment.

## Moving
- aucune traversée à vitesse normale ;
- position et sens de déplacement lisibles ;
- transmission d'élan perceptible mais contrôlable ;
- coins tolérants et sans double SFX ;
- laser bloqué ;
- clear du niveau inchangé.

## Performance
Pas d'allocation massive par frame dans la boucle de collision.
Les helpers retournant des objets sont acceptables au stade prototype, mais peuvent être optimisés ensuite si le profiling le justifie.
