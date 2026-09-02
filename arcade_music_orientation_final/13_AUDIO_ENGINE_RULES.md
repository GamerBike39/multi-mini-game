# Règles audio / timing / performance

## Scheduling

Autorisé :
- `setInterval` ou mécanisme similaire pour alimenter un horizon.
- événements WebAudio programmés dans le futur.

Interdit :
- `setInterval(() => playNow())` comme horloge musicale principale.
- recalculer la position à partir du nombre de callbacks timer.

L'autorité temporelle est `AudioContext.currentTime`.

## Horizon

Cible :
100 à 250 ms.

Le système actuel à ~200 ms est une bonne valeur initiale.

## Durées

La résolution musicale de base reste 16th.

Ne pas supposer qu'une note dure un step.

Stocker durée et velocity séparément.

## Déterminisme

Composition Reference :
100% déterministe.

Adaptive :
RNG seedé pour :
- fills ;
- variantes ;
- octaves ;
- vélocités légères.

`Math.random()` reste acceptable pour bruit SFX non musical.

## Humanize

Trance/arcade : 0–4 ms max.
Fish/Golf : 0–9 ms max.
Kick principal : 0 ms.

## Swing

- Breaker 0
- Shooter 0
- Survival 0–2%
- Runner 0
- Fish 8%
- Golf 10–18%
- Snake 0–5%

Le swing est appliqué au scheduling, jamais en décalant l'horloge globale.

## Sidechain

Cible légère :
- Shooter/Survival/Breaker : ~3–5 dB
- Fish/Golf : ~1–2 dB

Ne pas sidechainer les SFX.

## Mix

Laisser de l'espace vers 2–5 kHz.

Règle approximative :
- kick dominant mais propre ;
- bass sous kick ;
- melody modérée ;
- arp en arrière ;
- pad discret ;
- FX ponctuels.

Conserver headroom.

## Performance

Ne pas créer d'optimisation complexe avant profilage.

Surveiller :
- nodes actifs ;
- mémoire ;
- GC ;
- CPU ;
- polyphonie.

Priorité :
clarté du code et timing stable.

## Node lifecycle

Tout OscillatorNode/AudioBufferSourceNode doit avoir :
- start programmé ;
- stop programmé ;
- possibilité d'être déconnecté après usage si nécessaire.

Les instruments longs doivent posséder une méthode `dispose()`.

## Background tabs

À la reprise :
- ne pas essayer de rejouer les événements ratés ;
- recalculer le prochain événement depuis l'horloge audio ;
- préserver bar/phrase si possible ;
- éviter les rafales de notes.

## SFX coexistence

Les SFX existants restent sur `sfxBus`.

Le moteur musical doit pouvoir baisser ponctuellement ses propres haut-médiums lorsque beaucoup de tirs/impacts sont prévus, mais ne doit pas compresser le bus SFX.
