# Matrice de validation

## A. Non-régression audio

- [ ] AudioContext créé une seule fois
- [ ] unlock fonctionne après interaction utilisateur
- [ ] suspend/resume fonctionne
- [ ] mute persiste
- [ ] master/music/sfx persistent
- [ ] jump fonctionne
- [ ] land fonctionne
- [ ] dash fonctionne
- [ ] shoot fonctionne
- [ ] hitEnemy fonctionne
- [ ] explode fonctionne
- [ ] hurt fonctionne
- [ ] coin fonctionne
- [ ] perfect/good/miss fonctionnent
- [ ] UI move/ok/back fonctionnent
- [ ] piste AudioBuffer fonctionne
- [ ] pause/resume piste fonctionne

## B. Timing

- [ ] pas de note déclenchée à `currentTime` depuis un timer JS
- [ ] horizon scheduler 100–250 ms
- [ ] bar 16 → bar 1 sans trou
- [ ] beat() cohérent
- [ ] bar() cohérent
- [ ] phrase() cohérent
- [ ] pause/resume ne décale pas la grille
- [ ] onglet background ne détruit pas l'état du moteur

## C. Golden references

### Shooter
- [ ] énergie immédiate
- [ ] bass/kick cohérents
- [ ] arp propre
- [ ] lead identifiable
- [ ] boucle invisible
- [ ] pas trop agressif 2–5 kHz

### Survival
- [ ] plus menaçant que Shooter
- [ ] F naturel crée de la tension sans sonner faux
- [ ] sensation de pression
- [ ] boucle non résolue
- [ ] supporte plusieurs répétitions

### Fish
- [ ] clairement différent des deux autres
- [ ] espace suffisant
- [ ] swing subtil
- [ ] pluck non irritant
- [ ] pad non boueux
- [ ] boucle naturelle

## D. Adaptation

- [ ] state smooth
- [ ] pas de layer qui clignote on/off autour d'un seuil
- [ ] gros changements aux frontières musicales
- [ ] intensity n'augmente pas juste le volume
- [ ] danger n'ajoute pas toujours plus de sons
- [ ] événements fréquents agrégés
- [ ] adaptation désactivable instantanément pour A/B
- [ ] Reference reste inchangé

## E. Performance

- [ ] pas de fuite de nodes
- [ ] CPU acceptable après 10 min
- [ ] pas de croissance permanente de mémoire
- [ ] pas de clipping master
- [ ] Chrome desktop
- [ ] Firefox desktop
- [ ] Safari desktop
- [ ] mobile raisonnable

## F. Critère artistique

Écouter chaque référence 5 minutes en boucle.

Échec si :
- fatigue rapide ;
- motif irritant ;
- graves boueux ;
- kick trop dominant ;
- trop de densité ;
- transitions perceptibles ;
- identité insuffisante.

Ne pas corriger ces problèmes avec de la génération adaptative. Corriger la composition ou le sound design.
