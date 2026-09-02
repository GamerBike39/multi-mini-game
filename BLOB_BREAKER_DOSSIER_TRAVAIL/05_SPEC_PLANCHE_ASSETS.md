# Spécification de la planche graphique — BLOB BREAKER

## 1. Ce que la planche est

La planche n'est pas une sprite sheet d'effets.

C'est une **référence de langage visuel** destinée à :
- guider le rendu Canvas ;
- fixer les silhouettes ;
- fixer les glyphes ;
- fixer les états ;
- servir de contrôle qualité.

Le runtime peut rester 100 % procédural.

---

# 2. Structure de la planche

## A — BRICKS / objectifs

Présenter :

### Normal
- idle
- hit
- destruction

### Reinforced
- idle
- hit 1
- damaged
- destruction

### Explosive
- idle
- queued
- hit
- explode
- chain climax

### Gravity
- idle
- signal
- detach
- falling
- paddle impact

---

## B — ARCHITECTURE

### Wall
Présenter :
- horizontal court ;
- horizontal long ;
- vertical ;
- coin visuel si nécessaire ;
- impact balle ;
- impact laser.

Le Wall doit sembler être un morceau du niveau.

---

## C — MÉCANISMES

### Bumper
Présenter :
- idle ;
- hit ;
- compression ;
- rebound ring ;
- cooldown / retour.

Le Bumper doit sembler interactif avant même d'être touché.

---

# 3. Deux passes obligatoires

## PASS 1 — MONOCHROME

Aucune couleur fonctionnelle.

Questions :
- explosive reconnue ?
- gravity reconnue ?
- reinforced reconnue ?
- Wall ≠ brique ?
- Bumper ≠ brique et ≠ Wall ?

Tant que cette passe échoue, ne pas travailler la couleur.

## PASS 2 — COULEUR

La palette de rang des briques est conservée.

La couleur fonctionnelle devient un accent :
- explosive : noyau chaud ;
- gravity : chevrons froids ;
- reinforced : traitement de coque ;
- normal : aucun accent fonctionnel.

---

# 4. Hiérarchie d'information

Toujours :

1. silhouette / masse
2. structure interne
3. glyphe
4. animation
5. couleur
6. FX

Jamais :
**couleur seule → comportement**

---

# 5. Ce qui ne doit PAS être dessiné comme asset

Ne pas produire :
- particules ;
- explosion complète ;
- shockwave ;
- flash écran ;
- trails ;
- glow baked ;
- screenshake évidemment ;
- textes COMBO/BOOM/FREEZE ;
- multiples tailles de Wall ;
- multiples tailles de paddle.

Ces éléments sont déjà mieux gérés procéduralement.

---

# 6. Dimensions / adaptabilité

Les briques actuelles changent de taille selon les niveaux.

La planche doit donc décrire des éléments **scalables**.

Éviter un dessin reposant sur :
- un nombre fixe de pixels ;
- un détail trop fin ;
- un glyphe qui disparaît lorsque `tileW` descend.

Tester visuellement au minimum :
- grande brique ~100 × 24 ;
- moyenne ~64 × 20 ;
- petite ~48 × 18.

Un élément fonctionnel doit rester lisible à la petite taille.

---

# 7. Règle de densité

Le jeu peut contenir :
- multiball ;
- lasers ;
- drops ;
- explosions ;
- combo ;
- gravity hazards.

Donc :
- idle minimal ;
- pas de clignotement simultané ;
- peu de détails fins ;
- une seule signature forte par comportement.

---

# 8. Livrables graphiques recommandés

La planche finale devrait contenir :

1. **Planche monochrome**
2. **Planche couleur**
3. **Strip d'états A3**
4. **Wall / Bumper**
5. **Stress test raisonnable**
6. **Stress test extrême** clairement étiqueté comme test de lisibilité, pas comme cible esthétique.

Aucun export raster runtime n'est requis tant que le rendu Canvas suffit.
