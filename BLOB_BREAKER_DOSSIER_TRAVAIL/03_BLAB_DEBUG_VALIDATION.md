# B-LAB — Debug, visualisation et validation

## 1. Philosophie

B-LAB n'est pas un mode de jeu final.

Il sert à répondre rapidement à :
- la collision est-elle correcte ?
- la trajectoire devient-elle intéressante ?
- le Bumper apporte-t-il réellement quelque chose ?
- la lisibilité A3 survit-elle au chaos réel ?

Les outils de debug doivent être compilés uniquement en développement autant que possible.

Le projet utilise Vite : protéger les fonctions réservées au lab avec :

```ts
if (import.meta.env.DEV) { ... }
```

---

# 2. Activation

Proposition simple et non intrusive :

```txt
?breakerLab=wall
?breakerLab=corridor
?breakerLab=bumper
?breakerLab=billiard
?breakerLab=chain
?breakerLab=moving
```

Dans `BreakerGame`, lire le paramètre uniquement en DEV.

S'il est absent :
- comportement normal ;
- aucun coût de rendu debug.

S'il est présent :
- utiliser le layout demandé ;
- afficher le panneau debug.

L'utilisateur peut toujours sélectionner BLOB BREAKER normalement depuis le menu ; le paramètre ne nécessite pas de modifier le routage global dans le premier lot.

---

# 3. Overlays debug

## 3.1 Collision shapes
Afficher :
- AABB des Walls ;
- cercle des Bumpers ;
- AABB des Moving et rail de déplacement ;
- cercle physique des balles ;
- AABB des briques uniquement si utile.

Ne pas utiliser le glow du jeu pour ces formes.

## 3.2 Contact point
Au dernier contact :
- petite croix au point de contact ;
- durée ~0,35 s.

## 3.3 Normal
Afficher une flèche partant du contact :
- longueur ~24–36 px ;
- direction = normale utilisée pour la réflexion.

C'est l'outil principal pour repérer une normale inversée ou un mauvais cas de coin.

## 3.4 Velocity vector
Pour chaque balle :
- ligne depuis le centre ;
- longueur proportionnelle à une petite fraction de la vitesse ;
- ne pas afficher pendant `stuck`.

## 3.5 Trajectory predictor
Debug uniquement.

But : comparer intuition et résultat de la collision.

Simulation :
- horizon : ~2 s ;
- maximum : 6 rebonds ;
- pas fixe : `1 / 120` ;
- prendre en compte :
  - limites du monde ;
  - Walls ;
  - Bumpers ;
  - Moving, avec sa position future et sa vitesse de surface ;
- ignorer :
  - paddle ;
  - briques ;
  - gravity falling ;
  - explosions.

Pourquoi ignorer les briques :
- éviter un prédicteur illisible ;
- tester uniquement la nouvelle couche géométrique ;
- rester facile à maintenir.

Utiliser les mêmes helpers `circleVsAabb` / `circleVsCircle` que la vraie physique afin que le debug ne représente pas une autre physique.

---

# 4. Panneau de stats

Afficher dans B-LAB :

```txt
LAB: BILLIARD
BALLS                 2
WALL HITS            14
BUMPER HITS           8
BUMPER → BRICK        5
BUMPER → EXPLOSIVE    2
MAX COMBO             9
```

Compteurs proposés :

```ts
interface BreakerLabStats {
  wallHits: number;
  bumperHits: number;
  movingHits: number;
  bumperToBrick: number;
  bumperToExplosive: number;
  maxCombo: number;
}
```

Pour `BUMPER → BRICK` :
- chaque balle garde `lastBumperActionT` ;
- si elle touche une brique moins de ~1,5 s après un Bumper, incrémenter une fois pour cette séquence.

Ce n'est pas de l'analytics produit.
Le but est simplement d'éviter de juger le Bumper uniquement au ressenti visuel.

---

# 5. Layouts B-LAB

## LAB 01 — WALL

Question :
**un obstacle indestructible modifie-t-il spontanément la façon de viser ?**

Structure :
- briques simples en haut ;
- un bloc central ;
- pas de Bumper.

Validation :
- trajectoires de contournement visibles ;
- aucun blocage permanent de balle.

---

## LAB 02 — CORRIDOR

Question :
**la division du terrain en zones crée-t-elle de l'anticipation ?**

Structure :
- deux murs verticaux ;
- trois couloirs ;
- briques réparties sur les zones.

Observer :
- balle enfermée temporairement ;
- choix de renvoi gauche / centre / droite.

---

## LAB 03 — BUMPER

Question :
**le contact est-il amusant en lui-même ?**

Structure :
- briques simples ;
- un bumper central.

Tuning :
- tester boost 1.00 / 1.12 / 1.22 / 1.30 via constante de debug ;
- valeur de départ recommandée pour intégration : 1.22.

---

## LAB 04 — BILLIARD

Question :
**des enchaînements et trick-shots émergent-ils ?**

Structure :
- deux bumpers ;
- deux murs ;
- briques en cible haute.

Observer :
- rebonds consécutifs ;
- trajectoires mémorables ;
- nombre de `BUMPER → BRICK`.

---

## LAB 05 — CHAIN

Question :
**la nouvelle géométrie amplifie-t-elle les réactions déjà fortes du jeu ?**

Structure :
- poche de briques explosives ;
- murs guidant la trajectoire ;
- bumper permettant d'entrer dans la poche.

Observer :
- Bumper → explosive ;
- lisibilité de la chaîne ;
- suivi de balle pendant le climax.

---

## LAB 06 — MOVING

Question :
**un obstacle qui se déplace crée-t-il une anticipation intéressante sans
devenir injuste ?**

Structure :
- deux murs latéraux de sécurité ;
- un Moving horizontal avec rail visible ;
- un Moving vertical ;
- briques simples en partie haute.

Observer :
- lecture de la position et du sens de déplacement ;
- rebond relatif à la vitesse de la surface ;
- tolérance des coins ;
- laser bloqué par le Moving ;
- feedback SFX / haptique / particules sans double déclenchement.

---

# 6. Debug A3 dans B-LAB

Le lab doit également offrir une scène de lisibilité :

```txt
NORMAL | REINFORCED | EXPLOSIVE | GRAVITY
```

Puis permettre la vraie situation de stress :
- multiball ;
- chain explosive ;
- gravity tiles ;
- drops.

Le stress test n'est pas une cible esthétique.
Il sert à vérifier que le langage reste lisible quand l'écran est chargé.

---

# 7. Cas de régression à tester

## Balle
- balle stuck au paddle ;
- multiball ;
- giant ;
- flame ;
- slow.

## Paddle
- normal ;
- large ;
- small ;
- glue ;
- freeze.

## Briques
- normal ;
- reinforced 2 HP ;
- reinforced 3 HP ;
- explosive isolée ;
- explosive chain ;
- gravity.

## Obstacles
- contact frontal Wall ;
- coin Wall ;
- déplacement parallèle à un Wall ;
- contact Bumper au centre ;
- contact tangent au Bumper ;
- contact frontal Moving ;
- coin Moving pendant son déplacement ;
- multiball simultané sur Bumper.

## Laser
- impact brique ;
- impact Wall ;
- impact Moving ;
- aucune interaction Bumper V1.

---

# 8. Critère de décision produit

Après le prototype, répondre à trois questions.

### Wall
Est-ce que le joueur vise différemment ?

### Bumper
Est-ce que toucher le Bumper procure un effet intéressant même sans récompense de score ?

### Combinaison
Est-ce que Wall + Bumper produisent des trajectoires et réactions impossibles dans le jeu actuel ?

Si les trois réponses sont oui :
- valider Chantier B ;
- passer à Portal après le tuning de Moving.

Si Wall oui / Bumper non :
- conserver Wall ;
- tester Portal avant de complexifier Bumper.

Si les deux sont faibles :
- ne pas ajouter d'autres obstacles avant d'avoir compris pourquoi.
