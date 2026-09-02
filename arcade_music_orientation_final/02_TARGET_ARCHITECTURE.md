# Architecture cible

## Vue d'ensemble

```text
Game
 │
 │ state + events
 ▼
GameMusicAdapter
 │
 ▼
TargetMusicState
 │
 ▼
AdaptiveDirector
 │
 ├── smoothing
 ├── hysteresis
 ├── event accumulation
 ├── phrase/section decisions
 └── narrative arc
 │
 ▼
CompositionPlayer
 │
 ├── harmony
 ├── drums
 ├── bass
 ├── arp
 ├── melody
 ├── pads
 └── fx
 │
 ▼
InstrumentRack
 │
 ▼
Music buses
 │
 ▼
existing musicBus → master → compressor → destination
```

## Modules

```text
src/audio/
  AudioSys.ts
  music/
    MusicEngine.ts
    MusicTransport.ts
    MusicTypes.ts
    InstrumentRack.ts
    ReferencePlayer.ts
    AdaptiveDirector.ts
    EventAccumulator.ts
    HysteresisGate.ts
    SeededRandom.ts
    theory/
      scales.ts
      chords.ts
      degrees.ts
    instruments/
      kick.ts
      snare.ts
      hats.ts
      bass.ts
      pluck.ts
      arp.ts
      pad.ts
      lead.ts
      supersaw.ts
      bell.ts
      pulse.ts
      noiseFx.ts
    compositions/
      menu.ts
      breaker.ts
      caveRunner.ts
      fish.ts
      golf.ts
      rhythm.ts
      runner.ts
      shooter.ts
      simon.ts
      snake.ts
      survival.ts
    adapters/
      breakerAdapter.ts
      caveRunnerAdapter.ts
      fishAdapter.ts
      golfAdapter.ts
      rhythmAdapter.ts
      runnerAdapter.ts
      shooterAdapter.ts
      simonAdapter.ts
      snakeAdapter.ts
      survivalAdapter.ts
    references/
      shooterReferenceV1.ts
      survivalReferenceV1.ts
      fishReferenceV1.ts
```

## MusicTransport

Responsabilités :
- BPM ;
- temps de départ AudioContext ;
- absoluteStep ;
- beat ;
- bar ;
- phrase ;
- quantification ;
- schedule horizon ;
- callbacks beat/bar ;
- pause/resume ;
- calcul de timestamps futurs.

Conserver le principe du scheduler actuel :
- timer JS fréquent ;
- horizon audio en avance ;
- événements réellement programmés avec les timestamps AudioContext.

## ReferencePlayer

Mode totalement déterministe.

Il joue les partitions V1 telles quelles.

Désactivés :
- adaptation ;
- seed ;
- variations ;
- événements gameplay ;
- changement automatique de layer.

API :

```ts
music.startReference("shooter");
music.startReference("survival");
music.startReference("fish");
```

## AdaptiveDirector

N'est activé qu'après validation des références.

Il transforme une composition connue en fonction de `MusicState`.

Il ne crée jamais une nouvelle identité musicale au hasard.

## InstrumentRack

Créer les instruments une fois autant que possible.

Chaque instrument expose une API légère :

```ts
instrument.trigger(note, time, duration, velocity);
instrument.setBrightness(value, time);
instrument.setPresence(value, time);
```

## Sous-bus musicaux recommandés

```text
musicBus
├── drumBus
├── bassBus
├── harmonyBus
├── arpBus
├── leadBus
└── musicFxBus
```

Cela facilite :
- mix adaptatif ;
- sidechain ;
- retrait de haut-médiums ;
- transitions ;
- debug.

## Tone.js

Ne pas ajouter Tone.js en première intention.

Le code existant dispose déjà de la mécanique critique de timing.

Tone.js ne devient acceptable que si :
- une limitation claire est identifiée ;
- la migration est mesurée ;
- le bundle supplémentaire est accepté ;
- les tests de timing montrent un bénéfice concret.

La V1 doit donc rester WebAudio native.
