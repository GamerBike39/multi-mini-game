# Système adaptatif

## Principe

Ne pas mapper directement :
`event gameplay → synthé on/off`.

Mapper :
`game state → MusicState → décisions musicales quantifiées`.

## State

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

## Smoothing

Valeurs indicatives :
- danger : attack 200-500 ms, release 1-2 s
- intensity : 1-3 s
- momentum : 2-4 s
- complexity : 4-8 s
- narrativeArc : très lent

## Quantification

Continuous :
- gain
- cutoff
- reverb
- modulation subtile

Beat :
- accents
- small fills

Bar :
- bass pattern
- drum layer
- arp layer

Phrase :
- progression
- motif
- section
- instrumentation majeure

## Hysteresis

Exemple danger layer :
- ON > .65
- OFF < .45

## EventAccumulator

Les événements fréquents sont agrégés.

Exemple shooter kills :
- 1 kill : rien
- 5 rapides : variation bass
- 10 : fill
- 20 : momentum élevé

## Cooldowns

- small fill : >= 1 mesure
- medium fill : >= 4 mesures
- major fill : >= 8 mesures

## Mémoire musicale

Un motif doit vivre plusieurs phrases.

Exemple :
A / A / A' / B / A' / A+counter.

Ne jamais régénérer toutes les notes à chaque mesure.

## Narrative Arc

Axes distincts :
- danger immédiat
- progression dramatique globale

Une vague avancée calme ne doit pas sonner comme la première vague.

Narrative arc peut débloquer :
- variations permanentes ;
- registre supérieur ;
- contre-mélodies ;
- harmonie enrichie ;
- nouveaux fills.

## Intensité ≠ volume

L'intensité modifie surtout :
- densité ;
- orchestration ;
- registre ;
- rythme.

Le niveau master reste relativement stable.
