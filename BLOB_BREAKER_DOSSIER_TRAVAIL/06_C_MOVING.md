# Chantier C — Moving

## Intention

`Moving` est un obstacle indestructible qui se déplace périodiquement sur un
axe. Il ajoute une contrainte temporelle au tir sans transformer la brique en
ennemi : la balle doit lire à la fois la position actuelle et le mouvement de
la surface.

Le premier prototype utilise une trajectoire sinusoïdale déterministe. Chaque
obstacle possède une position de repos, un axe, une amplitude, une fréquence et
une phase. Les paramètres peuvent donc produire plusieurs motifs sans ajouter
de logique spécifique à chaque niveau.

```ts
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
```

## Règles de gameplay

- le Moving est indestructible et n'entre pas dans `levelCleared()` ;
- la balle rebondit sur une AABB avec la même tolérance que le Wall ;
- la réflexion est calculée dans le référentiel du Moving afin que son élan
  puisse modifier la trajectoire de sortie ;
- une correction de pénétration est toujours appliquée, même lorsqu'il ne faut
  pas rejouer le feedback du contact ;
- un cooldown très court évite le double impact perceptible sur une même balle ;
- les lasers sont bloqués par le Moving et jouent son SFX dédié ;
- explosions, briques gravitaires détachées et score n'interagissent pas avec
  lui dans cette version.

Le Moving est introduit dans la progression normale à partir du niveau 5 : un
obstacle horizontal apparaît dans la moitié basse, puis un second obstacle
vertical est ajouté à partir du niveau 9. Les zones restent séparées des motifs
de briques pour ne pas créer de situation impossible au premier contact.

## Feedbacks

À l'impact :

- flash/punch de la balle ;
- anneau jaune au point de contact ;
- petites étincelles orientées ;
- vibration légère et courte ;
- SFX mécanique distinct du Wall et du Bumper, remplaçable par un sample via
  `breaker.obstacle.moving`.

Au repos, le rail et les deux points d'extrémité indiquent la trajectoire sans
ajouter de contour en pointillés à la texture du Wall réutilisée dans le corps
du Moving.

## B-LAB

Activation DEV :

```txt
?breakerLab=moving
```

La scène contient un Moving horizontal, un Moving vertical et deux murs
latéraux. Elle permet de vérifier :

- la tolérance sur les coins ;
- la transmission d'élan ;
- le comportement d'un laser ;
- le prédicteur de trajectoire ;
- l'absence de jitter ou de double SFX ;
- le maintien de la lisibilité lorsque le rail traverse la zone de jeu.

Le compteur `MOVING HITS` est affiché avec les statistiques existantes du
B-LAB.

## Points de tuning après validation

- `range` : amplitude de déplacement ;
- `frequency` : rythme et difficulté de lecture ;
- dimensions de l'AABB ;
- contribution de `vx` / `vy` dans la réflexion ;
- intensité du SFX et du rumble.

Ces valeurs sont à régler après observation du B-LAB, sans modifier le contrat
de collision ni la séparation entre briques et obstacles.
