# BLOB BREAKER — Dossier de production

## Objet

Ce dossier transforme le brainstorm validé en plan de travail directement exploitable pour faire évoluer `BLOB BREAKER`.

Le périmètre volontairement retenu est :

1. **Chantier A3 — Lisibilité**
   - rendre les 4 briques actuelles reconnaissables sans mémorisation de couleurs ;
   - définir leurs micro-animations ;
   - préserver le calme visuel au repos ;
   - exploiter le Canvas et le moteur FX existants plutôt que créer des sprites d'effets.

2. **Chantier B — Géométrie**
   - introduire une famille d'objets de niveau indépendante des briques ;
   - implémenter `Wall`, `Bumper` puis `Moving` ;
   - tester leur valeur de gameplay dans un laboratoire dédié avant d'ajouter Portal / Ghost / Switch.

3. **B-LAB — Debug & validation**
   - visualiser les collisions ;
   - visualiser les normales et vitesses ;
   - afficher une prédiction de trajectoire strictement réservée au debug ;
   - disposer de scènes de test reproductibles et de quelques compteurs simples.

## Statut du prototype V1

La première boucle de prototype A3 / Wall / Bumper / B-LAB a été validée par
l'utilisateur à 90 %. Le chantier suivant, `Moving`, est maintenant intégré à
la progression à partir du niveau 5 et dispose de son B-LAB dédié ; il reste
ouvert au tuning terrain avant d'ouvrir Portal / Ghost / Switch.

Les motifs de niveaux, les types de tuiles, les pouvoirs, les réactions en
chaîne, les feedbacks visuels/sonores/haptiques et les assets Breaker ont été
ajoutés au prototype au-delà du périmètre initial.

## Décisions structurantes

### 1. Ne pas transformer Wall et Bumper en `BrickKind`

Une brique est un **objectif destructible**.  
Un obstacle est un **élément de géométrie / interaction**.

Créer une nouvelle famille évite de polluer :
- `hp` ;
- le score ;
- les drops ;
- `levelCleared()` ;
- les explosions ;
- les réactions spécifiques aux briques.

Architecture cible minimale :

```ts
type ObstacleKind = 'wall' | 'bumper' | 'moving';

type BreakerObstacle =
  | BreakerWall
  | BreakerBumper
  | BreakerMoving;
```

### 2. Pas de refonte générale de la physique dans le premier lot

Le jeu fonctionne aujourd'hui. Le but n'est pas de réécrire le moteur.

- les collisions actuelles balle/brique restent en place dans le premier lot ;
- une fonction robuste `circleVsAabb()` est ajoutée pour les nouveaux Walls ;
- une fonction `circleVsCircle()` est ajoutée pour les Bumpers ;
- `Moving` réutilise l'AABB du Wall, avec une réflexion dans le référentiel
  de sa vitesse pour transmettre son élan à la balle ;
- l'unification complète des collisions peut venir plus tard si le prototype est validé.

### 3. La lisibilité précède la couleur

Ordre d'information obligatoire :

**silhouette / structure → glyphe → micro-animation → couleur**

Le comportement d'une brique doit rester identifiable en niveaux de gris.

### 4. Les FX restent procéduraux

Le moteur possède déjà :
- particules ;
- rings ;
- flash ;
- hitstop ;
- screenshake ;
- textes ;
- slow motion.

Aucun sprite d'explosion, de trail ou de débris n'est requis pour ce chantier.

### 5. Scope explicitement hors lot

Ne pas implémenter maintenant :
- Portal ;
- Ghost ;
- Switch ;
- Reflector incliné ;
- refonte des drops ;
- refonte générale du système de niveaux ;
- gros système d'analytics.

Ces sujets restent dans la roadmap, mais seulement après validation de `Wall + Bumper + Moving`.

---

## Fichiers du dossier

- `01_A3_LISIBILITE_MICRO_ANIMATIONS.md`
- `02_B_GEOMETRIE_WALL_BUMPER.md`
- `03_BLAB_DEBUG_VALIDATION.md`
- `04_PLAN_IMPLEMENTATION_CODEX.md`
- `05_SPEC_PLANCHE_ASSETS.md`
- `06_C_MOVING.md`
- `MASTER_BLOB_BREAKER.html`

Le HTML est la version de lecture/navigation. Les Markdown sont conçus pour être donnés directement à un agent de code.

## Référence code

Périmètre principal :
- `js/games/breaker.ts`
- `js/core/blob.ts`
- `js/core/fx.ts`

Commandes de validation du projet :
```bash
npm run typecheck
npm run build
```
