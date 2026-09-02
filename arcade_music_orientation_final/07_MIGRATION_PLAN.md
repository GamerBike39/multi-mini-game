# Plan de migration sécurisé

## Phase 0 — Snapshot

Conserver `legacy/AudioSys.current.ts`.

Créer tests de non-régression pour :
- unlock ;
- mute ;
- volumes persistés ;
- jump/land/dash/shoot/hit/explode/hurt ;
- UI sounds ;
- track playback ;
- pause/resume track ;
- beat/songTime.

## Phase 1 — Extraire le transport

Créer `MusicTransport`.

Déplacer sans changer le comportement :
- `musicStart`
- `step`
- horizon 0.2
- tick scheduler
- BPM
- pause/resume
- beat calculation

Acceptance :
l'ancien Mood doit pouvoir être joué via le nouveau transport avec un rendu temporel équivalent.

## Phase 2 — Multi-bar

Ajouter :
- `absoluteStep`
- `stepInBar`
- `bar`
- `phrase`
- 16/32 bar loop
- callbacks quantifiés

Ne pas encore changer les synthés.

## Phase 3 — Sous-bus musicaux

Ajouter :
- drumBus
- bassBus
- harmonyBus
- arpBus
- leadBus
- musicFxBus

Tous reliés au `musicBus` actuel.

## Phase 4 — InstrumentRack

Créer les instruments sans adaptation.

Valider :
- pas de clipping ;
- cleanup ;
- pas de fuite de nodes ;
- Safari/Chrome/Firefox.

## Phase 5 — ReferencePlayer

Implémenter exactement :
- Shooter V1
- Survival V1
- Fish V1

Ajouter `/music-test` avec :
- play/stop/pause
- choix reference
- bar/beat/step affichés
- mute solo par layer
- volume par layer temporaire de debug

## Gate A — validation musicale

Ne pas avancer tant que :
- boucles propres ;
- compositions agréables seules ;
- identités distinctes ;
- motif cohérent ;
- mix propre.

## Phase 6 — MusicState

Ajouter `currentState` et `targetState`.

D'abord en contrôle MANUAL sur `/music-test`.

Aucun adapter gameplay.

## Phase 7 — AdaptiveDirector

Ajouter :
- smoothing
- hysteresis
- layer transitions
- phrase boundaries
- EventAccumulator
- seeded RNG

Comparer Reference vs Adaptive en A/B.

## Gate B

Le mode Adaptive ne doit jamais être musicalement inférieur au Reference sur un état stable.

## Phase 8 — adapters

Ordre :
1. Survival
2. Shooter
3. Fish
4. Breaker
5. Runner
6. Cave
7. Golf
8. Snake
9. Simon

## Phase 9 — Rhythm

Refondre le chart pour qu'il provienne d'une timeline musicale commune.

## Phase 10 — polish

- menu motif/timbres
- transitions entre jeux
- high score
- game over
- ducking musical pour laisser les SFX passer
- profiling performance
