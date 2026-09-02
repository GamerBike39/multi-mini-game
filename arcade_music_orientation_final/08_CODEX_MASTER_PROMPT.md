# Prompt principal pour Codex

Tu travailles sur un projet Vite + TypeScript qui possède déjà un système audio WebAudio natif.

Lis d'abord :
- `legacy/AudioSys.current.ts`
- tous les documents de ce dossier.

## Mission

Transformer progressivement le système musical actuel en moteur musical adaptatif haut de gamme pour une collection de mini-jeux arcade, SANS casser les SFX ni les fonctionnalités audio existantes.

## Décision technique

N'ajoute pas Tone.js par défaut.

Le système actuel possède déjà un scheduler lookahead correct :
- timer JS ;
- horizon de scheduling ;
- timestamps `AudioContext.currentTime`.

Conserve cette approche WebAudio native et factorise-la.

N'introduis Tone.js que si tu identifies une limitation concrète impossible ou inutilement coûteuse à résoudre avec le moteur existant. Dans ce cas, documente précisément le bénéfice avant modification.

## Compatibilité

Préserver :
- API SFX existante ;
- volumes master/music/sfx ;
- persistence localStorage ;
- mute ;
- unlock autoplay ;
- suspend/resume ;
- piste AudioBuffer ;
- pause/resume track ;
- beat();
- songTime();
- mode rhythm actuel jusqu'à sa migration.

## Architecture cible

Implémente progressivement :

```text
AudioSys
└── MusicEngine
    ├── MusicTransport
    ├── InstrumentRack
    ├── ReferencePlayer
    ├── AdaptiveDirector
    ├── EventAccumulator
    ├── HysteresisGate
    ├── SeededRandom
    ├── compositions
    ├── references
    └── adapters
```

## Première livraison obligatoire

NE COMMENCE PAS par l'adaptation procédurale.

Livre d'abord :

1. extraction du transport ;
2. support de compositions multi-mesures ;
3. InstrumentRack ;
4. ReferencePlayer ;
5. trois morceaux exacts :
   - Shooter Reference V1
   - Survival Reference V1
   - Fish Reference V1
6. page `/music-test`.

Les notes et rythmes exacts sont décrits dans `05_REFERENCE_V1_EXACT.md`.

## Mode Reference

API souhaitée :

```ts
audio.music.startReference("shooter");
audio.music.startReference("survival");
audio.music.startReference("fish");
```

Le mode Reference désactive :
- RNG ;
- MusicState ;
- événements gameplay ;
- variations ;
- automation structurelle.

Une lecture doit être déterministe.

## Timing

Le timer JS ne déclenche jamais directement une note "maintenant".

Toute note doit recevoir un timestamp AudioContext futur.

Conserver un horizon d'environ 100-250 ms.

Éviter les allocations inutiles dans la boucle de scheduler.

## Data driven

Les compositions doivent être des données.

Ne pas coder la musique directement en grandes cascades de `if`.

Utiliser des structures similaires à celles décrites dans `11_REFERENCE_TYPES.ts`.

## Instruments

Créer au minimum :
- kick
- snare
- closed/open hat
- bass
- pluck
- arp
- pad
- lead
- supersaw
- pulse
- bell
- noise FX

Chaque instrument doit router vers un sous-bus musical.

## Mix

Ne pas chercher le loudness maximal.

Laisser la zone 2–5 kHz respirer pour les SFX.

Préserver le compressor master existant au départ.

## Phase adaptative

Seulement après validation des références :

Créer `MusicState` :
- intensity
- tension
- danger
- momentum
- complexity
- brightness
- triumph
- calm
- narrativeArc

Ajouter smoothing, quantification et hysteresis.

## Important

`intensity` ne signifie jamais simplement `volume`.

Il contrôle surtout l'orchestration et la densité.

## Events

Supporter :
- playerHit
- enemyKilled
- combo
- comboBreak
- nearMiss
- powerUp
- waveStart
- waveComplete
- bossStart
- bossDefeated
- perfect
- miss
- fishBite
- fishCaught
- holeInOne
- brickCombo
- newHighScore

Les événements fréquents passent par un accumulator/cooldown.

## Rhythm

À terme, remplacer le simple `ChartEvent` par une timeline commune :

```ts
interface MusicalEvent {
  time: number;
  beat: number;
  bar: number;
  type: "kick" | "snare" | "hat" | "bass" | "lead" | "chord" | "accent";
  strength: number;
}
```

Le ChartGenerator dérive les notes gameplay de ces événements musicaux.

Ne génère jamais un chart indépendamment de la musique.

## Debug page

Créer `/music-test`.

Afficher :
- composition
- mode Reference/Adaptive
- BPM
- beat
- bar
- step
- phrase
- current section
- active layers
- current chord
- currentState
- targetState

Contrôles :
- play
- pause
- stop
- loop
- solo/mute par layer
- intensity/tension/danger/momentum/complexity/brightness/triumph/calm/narrativeArc
- AUTO/MANUAL
- seed
- événements de test

## Workflow obligatoire

Travaille par petits commits logiques.

Après chaque phase :
- `tsc`
- tests
- lint si présent
- test manuel de démarrage audio
- vérifier qu'aucun SFX historique n'est cassé.

Ne réécris pas `AudioSys` en une fois.

Ne supprime pas le mode piste audio.

Ne change pas les volumes par défaut sans raison mesurée.

Ne remplace pas le scheduler par un `setInterval` qui joue les sons immédiatement.

## Critère final

Le moteur est réussi si les compositions fixes sont déjà bonnes, et si l'adaptation donne l'impression que la musique allait naturellement dans la direction du gameplay.
