# Bible musicale consolidée

## Vision

Identité globale :
- arcade moderne ;
- électronique mélodique ;
- trance légère ;
- synthwave ;
- chiptune contemporain ;
- héritage jeu vidéo 90/2000 avec production moderne.

Qualités :
- lisible ;
- énergique sans fatigue ;
- mélodique ;
- mémorable ;
- modulaire ;
- adaptative ;
- loops propres ;
- place laissée aux SFX.

## Motif commun

Cellule principale :

```text
1 – 5 – ♭7 – 8
```

Exemple C minor :

```text
C – G – Bb – C
```

Variantes autorisées :
- 1 – 5 – ♭7 – 5
- 1 – ♭7 – 5 – 1
- 5 – ♭7 – 8
- 1 – 5 – 8
- 1 – 2 – 5 – ♭7
- 1 – 5 – ♭7 – 9

Le motif doit être reconnaissable inconsciemment, pas forcément littéralement.

## Langages harmoniques

### Minor Arcade
Natural minor / Aeolian.
Usage : Shooter, Breaker, Runner.

### Trance Minor
Progressions :
- i – VI – III – VII
- i – VII – VI – VII
- i – VI – iv – VII
- i – III – VII – VI

### Dorian
Mineur mais énergique.
Usage : Runner, Golf, Cave Runner.

### Pentatonic
Stable pour systèmes génératifs.
Usage : Fish, Golf, Snake.

### Phrygian léger
Usage : Cave Runner, Survival.
À utiliser avec parcimonie.

## Tempos de référence

| Jeu | BPM |
|---|---:|
| Breaker | 134 |
| Cave Runner | 142 |
| Fish | 100 |
| Golf | 112 |
| Rhythm | 100–160 |
| Runner | 148 |
| Shooter | 138 |
| Simon | 110 / minimal |
| Snake | 124 |
| Survival | 142 |
| Menu | 122 |

## MusicState

```ts
interface MusicState {
  intensity: number;
  tension: number;
  danger: number;
  momentum: number;
  complexity: number;
  brightness: number;
  triumph: number;
  calm: number;
  narrativeArc: number;
}
```

Toutes les valeurs sont 0..1.

### intensity
Densité, layers, drums, bass, arp, lead.

### tension
Suspensions, pédales, filtres, absence de résolution.

### danger
Pulse, grave, dissonance contrôlée, accents insistants.

### momentum
Groove, octave supplémentaire, variations positives, réponses mélodiques.

### complexity
Subdivisions, syncopes, contre-mélodies.

### brightness
Cutoff, registre, timbre.

### triumph
Résolution, voicings ouverts, registre haut.

### calm
Espace, pad, reverb, faible densité.

### narrativeArc
Progression dramatique globale, lente et rarement régressive.

## Structure

- Beat
- Bar
- Phrase : 4/8 mesures
- Section : 16/32 mesures
- Macro sections : intro / groove / build / peak / release

Grosses modifications aux frontières de phrase.

## Layers

- L0 atmosphere
- L1 kick/core rhythm
- L2 bass
- L3 percussion
- L4 harmony
- L5 arp
- L6 melody
- L7 peak/counter melody

Courbe indicative :
- 0.00 : L0
- 0.20 : +L1
- 0.35 : +L2
- 0.50 : +L3
- 0.65 : +L4
- 0.75 : +L5
- 0.85 : +L6
- 0.95 : +L7

## Directions par jeu

### Breaker
Arcade trance, 134 BPM, F minor.
Précision, rebond, momentum.
Progression Fm–Db–Ab–Eb.

### Cave Runner
Dark electro/techno, 142 BPM, D Phrygian.
Claustrophobie, vitesse, percussion métallique, sub.

### Fish
Aquatic chill, 100 BPM, F# minor pentatonic.
Respiration, plucks aqueux, pads, montée de tension pendant le combat.

### Golf
Funky electro lounge, 112 BPM, G Dorian.
Groove léger, bass ronde, espace lors du swing et de l'approche du trou.

### Rhythm
Musique = gameplay.
Styles variés, BPM 100/120/128/140/150/160.
Chart et musique issus de la même timeline.

### Runner
Chiptune electro, 148 BPM, E Dorian.
Mouvement constant, motif E–B–D–E, densité liée à la vitesse.

### Shooter
Space trance/synthwave, 138 BPM, C minor.
Cm–Ab–Eb–Bb, supersaw contrôlée, arp, boss en phases.

### Simon
Minimal synth, environ 110 BPM ou sans pulse permanent.
L'accompagnement doit s'effacer autour des quatre notes.

### Snake
Retro electro minimal, 124 BPM, A minor pentatonic.
Très peu de layers, croissance progressive avec longueur et vitesse.

### Survival
Dark trance/techno, 142 BPM, E minor + emprunts Phrygiens.
Pression, menace, vague comme structure dramatique.

## Menu

122 BPM, C minor.
Cm7–Abmaj7–Eb–Bb.
Version la plus neutre du motif commun.

Au survol d'un jeu, rejouer le motif avec le timbre du jeu.

## Game Over

Motif inversé :
`8 – ♭7 – 5 – 1`
Durée < 1 s.

## High Score

`1 – 5 – ♭7 – 8 – 9`
Puis accord ouvert.
