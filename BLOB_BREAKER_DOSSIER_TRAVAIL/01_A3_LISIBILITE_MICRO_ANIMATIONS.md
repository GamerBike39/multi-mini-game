# Chantier A3 — Lisibilité et micro-animations

## 1. Objectif

Le joueur doit pouvoir distinguer immédiatement :

- brique normale ;
- brique renforcée ;
- brique explosive ;
- brique gravitaire ;

sans devoir mémoriser une correspondance de couleurs.

La couleur reste utile, mais devient une information secondaire.

## 2. Principe de rendu

Chaque brique possède quatre couches de lecture :

1. **forme / masse**
2. **signe fonctionnel**
3. **animation d'état**
4. **couleur**

Test obligatoire : le rendu doit rester compréhensible après conversion mentale en monochrome.

## 3. Budget d'intensité

| Intensité | Usage |
|---|---|
| 0/5 | statique |
| 1/5 | idle discret |
| 2/5 | signal / anticipation |
| 3/5 | impact |
| 4/5 | activation / destruction |
| 5/5 | climax exceptionnel |

Règle : une brique idle ne dépasse jamais 1/5.

---

# 4. Langage des quatre briques

## NORMAL

### Signature
- silhouette simple ;
- coins doux ;
- aucun glyphe de gameplay ;
- couleur de rang conservée.

### Idle
- intensité : 0/5 ;
- aucune pulsation ;
- aucun mouvement.

### Hit
- flash local très court : ~70 ms ;
- réaction globale : 100–140 ms ;
- squash maximum recommandé : 2–3 % ;
- pas de vibration persistante.

### Destruction
- 4–8 fragments légers ;
- ring faible ;
- pas de gros bloom.

La normale sert de **niveau zéro visuel**.

---

## REINFORCED

### Signature
- double coque / bordure interne ;
- rivets ou marqueurs de structure ;
- aspect plus massif que la normale ;
- les HP ne sont plus le seul moyen de la reconnaître.

### Idle
- intensité 0–1/5 ;
- statique ;
- reflet local exceptionnel, toutes les 2,5 à 4 s maximum ;
- reflet non synchronisé entre briques.

### Hit non destructif
- 180–240 ms ;
- compression 3–4 % ;
- vibration très courte :
  - déplacement ±1,5 px maximum ;
  - rotation ±0,4° maximum ;
- cicatrice persistante au point d'impact.

### Destruction
- 4–6 gros fragments ;
- vitesse de fragments inférieure à une normale ;
- sensation recherchée : masse, pas spectacle.

---

## EXPLOSIVE

### Signature
- gros noyau central identifiable ;
- noyau ≠ simple petit pictogramme décoratif ;
- comportement visible même si la couleur orange est retirée.

### Idle
- noyau uniquement ;
- cycle 1,5–1,8 s ;
- échelle du noyau ~90 % → 110 % → 90 % ;
- amplitude lumineuse faible ;
- phase déterministe différente selon la brique.

### Queued / signal
C'est l'état le plus important à rendre lisible.

Quand `queued === true` :
- intensité 2–3/5 ;
- pulsation accélérée ;
- anneau ou contraction interne ;
- aucune explosion prématurée.

La propagation doit être lisible comme une séquence :

`impact → signal → détonation → signal voisin → détonation voisine`

### Hit direct
- flash du noyau ~80 ms ;
- la brique ne doit pas sembler déjà explosée avant la vraie détonation.

### Explosion isolée
- durée principale ~300 ms ;
- intensité 4/5.

### Réaction en chaîne
- conserver les délais existants ;
- rendre le délai visible ;
- ne pas faire exploser visuellement toutes les briques au même instant.

### Climax
Réservé à une chaîne notable :
- profondeur de chaîne élevée ou nombre d'explosives consécutives suffisant ;
- intensité 5/5 ;
- hitstop, flash, ring, particules et shake peuvent être renforcés ;
- réduire légèrement la luminosité des explosions secondaires pendant le climax pour préserver la lecture.

Le climax est une récompense, pas l'état standard.

---

## GRAVITY

### Signature
- poids visuel vers le bas ;
- chevrons descendants intégrés dans la structure ;
- le cyan est un renfort, pas l'identifiant principal.

### Idle
- corps statique ;
- flux / chevrons descendants de 2–4 px ;
- cycle 1,2–1,6 s ;
- intensité 1/5.

### Hit / signal
- 80–120 ms ;
- accélération du flux ;
- bord inférieur pouvant descendre de ~2 px.

### Détachement
Ajouter visuellement un micro-état :

`idle → hit → detach → falling`

Durée cible du detach : ~80 ms.

Le but est de faire comprendre :
**la brique cesse d'être une cible et devient une menace mobile.**

### Falling
- l'animation de mouvement suffit ;
- limiter la rotation visuelle à environ ±15° ;
- ne pas ajouter de clignotement permanent.

### Impact paddle
Le jeu possède déjà un feedback FREEZE riche. Ne pas augmenter automatiquement le nombre d'effets.

---

# 5. Animation phase

Ne pas synchroniser les idles.

Ajouter une phase visuelle déterministe, calculée une seule fois lors de la création :

```ts
animPhase: number; // 0..1
```

Elle peut dériver de `cellNoise(level + seed, row, col)`.

Utilisation :

```ts
const phase = this.time + br.animPhase * cycleDuration;
```

But :
- éviter un mur entier d'explosives qui pulse ensemble ;
- limiter le bruit visuel ;
- garder un comportement reproductible.

---

# 6. État minimal à ajouter

Éviter une state machine lourde.

Proposition :

```ts
interface BreakerBrick {
  // existant...
  animPhase: number;

  // optionnel uniquement si nécessaire à la lisibilité :
  detachT?: number;
}
```

Pour l'explosive, utiliser autant que possible les états déjà existants :
- `queued`
- `exploded`
- `hitT`
- `fl`

Si le rendu a besoin de connaître la progression exacte du délai d'explosion, étendre `PendingExplosion` :

```ts
interface PendingExplosion {
  brick: BreakerBrick;
  delay: number;
  initialDelay: number;
  depth: number;
}
```

Le ratio visuel devient :

```ts
const queuedProgress = 1 - item.delay / item.initialDelay;
```

Ne pas créer un second système de timer si cette donnée suffit.

---

# 7. Tests A3

## A3-01 — grille pure
Construire une scène de test :

- colonne Normal ;
- colonne Reinforced ;
- colonne Explosive ;
- colonne Gravity.

Validation :
- identification < 1 s ;
- aucune couleur indispensable.

## A3-02 — mouvement
Même scène avec balle active.

## A3-03 — multiball
3–4 balles + quelques hits simultanés.

## A3-04 — chaîne
Plusieurs explosives adjacentes.

Validation :
- propagation compréhensible ;
- balle encore suivable.

## A3-05 — gravity
Plusieurs gravity tiles se détachent.

Validation :
- distinction claire entre brique encore en grille et hazard en chute.

---

# 8. Définition de terminé

A3 est validé si :

- les 4 types sont identifiables sans couleur ;
- l'écran reste calme quand rien ne se passe ;
- `queued` est perceptible avant l'explosion ;
- une gravity paraît se décrocher avant de tomber ;
- une grosse chaîne est spectaculaire sans masquer complètement la trajectoire de balle ;
- aucun asset raster n'a été nécessaire.
