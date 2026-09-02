# Plan d'implémentation — version Codex

## Contrainte générale

Ne pas transformer ce chantier en refactor global de `breaker.ts`.

Objectif :
- petites modifications testables ;
- comportement existant préservé ;
- aucune dépendance supplémentaire ;
- `npm run typecheck` et `npm run build` doivent rester verts à chaque étape.

---

# LOT 0 — Préparation

## Tâches
1. Lire :
   - `js/games/breaker.ts`
   - `js/core/blob.ts`
   - `js/core/fx.ts`
2. Identifier les sections :
   - interfaces ;
   - `buildBricks`;
   - `setBrickImpact`;
   - `queueExplosion`;
   - `updateExplosions`;
   - `updateFallingTiles`;
   - boucle de collision balle ;
   - `drawBrick`;
   - `render`.
3. Ne pas changer le comportement avant d'avoir créé un diff mental clair.

## Acceptance
- aucune modification fonctionnelle.

---

# LOT 1 — A3 lisibilité

## Étape 1.1 — données visuelles
Ajouter :
```ts
animPhase: number;
```
sur `BreakerBrick`.

Le calculer de façon déterministe lors de `buildBricks()`.

Option :
```ts
detachT?: number;
```
uniquement si l'animation gravity ne peut pas être exprimée proprement avec les états actuels.

## Étape 1.2 — normal
- calme total en idle ;
- hit flash plus court visuellement ;
- ne pas augmenter les FX de destruction.

## Étape 1.3 — reinforced
- structure plus massive ;
- cicatrice existante conservée ;
- micro compression/vibration au hit ;
- pas de pulsation idle.

## Étape 1.4 — explosive
- noyau dominant ;
- pulse idle asynchrone ;
- rendu `queued` clairement différent ;
- si nécessaire ajouter `initialDelay` dans `PendingExplosion`.

## Étape 1.5 — gravity
- chevrons descendants ;
- micro detach avant falling ;
- rotation falling visuellement limitée.

## Étape 1.6 — stress test
Tester :
- 3–4 balles ;
- chaîne explosive ;
- gravity ;
- reinforced.

## Acceptance
- reconnaissance sans couleur ;
- pas de flash permanent ;
- queued lisible ;
- aucune régression gameplay.

---

# LOT 2 — Fondation obstacles + Wall

## Étape 2.1 — types
Ajouter :

```ts
interface BreakerWall { ... }
interface BreakerBumper { ... }
type BreakerObstacle = BreakerWall | BreakerBumper;
```

Ajouter :
```ts
this.obstacles = [] as BreakerObstacle[];
```

## Étape 2.2 — construction
Créer :
```ts
buildObstacles(): void
buildLevel(): void
```

Remplacer les appels pertinents à `buildBricks()` par `buildLevel()` seulement si nécessaire.

Attention :
`nextLevel()` doit continuer à fonctionner sans obstacle tant que la progression normale n'utilise pas Chantier B.

## Étape 2.3 — helper collision
Créer un helper robuste `circleVsAabb()`.

Ne pas refactorer immédiatement la collision brick.

## Étape 2.4 — Wall physics
Dans l'update balle :
- résoudre les Walls ;
- corriger pénétration ;
- réfléchir vitesse ;
- feedback faible ;
- compteur lab si actif.

## Étape 2.5 — Wall rendering
Procédural Canvas :
- extensible ;
- architectural ;
- distinct d'une brique.

## Étape 2.6 — lasers
Ajouter collision laser / Wall :
- bolt détruit ;
- spark faible ;
- aucune autre conséquence.

## Acceptance
- Wall indestructible ;
- clear inchangé ;
- FLAME rebondit ;
- multiball correct ;
- laser bloqué ;
- aucun jitter évident.

---

# LOT 3 — Bumper

## Étape 3.1 — helper
Créer `circleVsCircle()`.

## Étape 3.2 — collision
- normale bumper → balle ;
- séparation ;
- réflexion seulement si approche ;
- cooldown même bumper / même balle.

## Étape 3.3 — boost
Ajouter sur les balles :
```ts
lastBumperId
lastBumperT
bumperBoostT
```

Créer :
```ts
targetBallSpeed(ball)
```

Adapter `normSpeed()` pour respecter le boost actif.

## Étape 3.4 — feedback
- `pulseT` sur Bumper ;
- squash ;
- ring ;
- burst limité ;
- son synthétique distinct ;
- rumble léger.

## Acceptance
- pas de double-hit ;
- direction cohérente ;
- boost temporaire ;
- vitesse globale intacte.

---

# LOT 4 — B-LAB

## Étape 4.1 — activation
DEV only :
```txt
?breakerLab=wall
?breakerLab=corridor
?breakerLab=bumper
?breakerLab=billiard
?breakerLab=chain
```

## Étape 4.2 — layouts
Créer des builders explicites.
Ne pas injecter ces layouts dans la progression normale.

## Étape 4.3 — debug draw
Ajouter :
- shapes ;
- point de contact ;
- normale ;
- vecteur vitesse ;
- prédiction trajectoire.

## Étape 4.4 — stats
Ajouter :
- wallHits ;
- bumperHits ;
- bumperToBrick ;
- bumperToExplosive ;
- maxCombo.

## Acceptance
- aucune logique lab en production hors branches mortes/DEV ;
- prédiction utilise les mêmes helpers de collision ;
- overlay lisible ;
- pas de dépendance externe.

---

# LOT 5 — Tuning / décision

Aucun nouvel objet.

Faire seulement :
- ajustement tailles ;
- boost ;
- cooldown ;
- feedback ;
- positions de lab ;
- intensités A3.

Décision finale :
- Wall validé ?
- Bumper validé ?
- combinaison validée ?

Ensuite seulement ouvrir un nouveau chantier :
- Moving ;
- ou Portal.

---

# Checklist de revue finale

## TypeScript
- [ ] pas de nouveaux `any` évitables
- [ ] unions discriminées pour les obstacles
- [ ] pas de propriété optionnelle générique inutile

## Gameplay
- [ ] progression existante jouable
- [ ] clear fonctionne
- [ ] lives fonctionnent
- [ ] drops fonctionnent
- [ ] lasers fonctionnent
- [ ] multiball fonctionne
- [ ] flame fonctionne
- [ ] slow fonctionne
- [ ] glue fonctionne

## Lisibilité
- [ ] 4 briques distinctes en monochrome
- [ ] idle calme
- [ ] queued explosive lisible
- [ ] gravity detach lisible

## Géométrie
- [ ] wall frontal
- [ ] wall coin
- [ ] bumper frontal
- [ ] bumper tangent
- [ ] multiball
- [ ] pas de jitter

## Build
```bash
npm run typecheck
npm run build
```
