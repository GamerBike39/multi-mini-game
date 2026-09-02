# Analyse du système audio actuel

## Ce qu'il faut absolument conserver

### 1. Un seul AudioContext
Le système initialise un `AudioContext` à la demande et respecte le verrouillage autoplay grâce à `unlock()` et `pendingMood`.

**À préserver.**

### 2. Bus séparés
Le graphe actuel distingue :
- `musicBus`
- `sfxBus`
- `trackBus`
- `master`
- `DynamicsCompressor`

C'est une très bonne fondation. Les nouveaux instruments doivent se brancher sur `musicBus` ou sur des sous-bus musicaux eux-mêmes reliés à `musicBus`.

### 3. Scheduler lookahead
Le système appelle `scheduleAhead()` environ toutes les 55 ms et programme jusqu'à `currentTime + 0.2`.

C'est une bonne technique WebAudio.

**Ne pas remplacer par des appels audio directement déclenchés depuis `setInterval`.**

Le scheduler JS doit seulement alimenter l'horloge audio.

### 4. Séquenceur 16 pas
`stepDuration = (60 / bpm) / 4` correspond à une double croche en 4/4.

Le moteur peut donc évoluer naturellement vers :
- `absoluteStep`
- `bar`
- `stepInBar`
- `beat`
- `phrase`

### 5. Mode Rhythm existant
Le mode `chart` déclenche déjà des événements à des temps absolus basés sur `musicStart`.

Il faut généraliser cette idée en `MusicalEvent`, puis faire dériver le chart de la même timeline que la musique.

### 6. Mode piste audio
Le projet sait déjà lire un `AudioBuffer`, le mettre en pause et le reprendre.

À préserver pour les éventuelles pistes pré-rendues et les tests A/B.

---

# Limites actuelles

## Mood trop compact

Le type actuel ne contient essentiellement que :

- bpm
- root
- kick
- snare
- hat
- bass
- pad

Il décrit un groove d'une mesure, pas une composition.

Il manque :

- grille harmonique multi-mesures ;
- motifs ;
- arpèges ;
- leads ;
- sections ;
- automation ;
- vélocités ;
- durées individuelles ;
- variations ;
- structure de phrase ;
- intensité ;
- tension ;
- instrumentation par jeu.

## Instruments trop génériques

`bassAt()` = triangle + square octave.

`padAt()` = quatre sawtooths.

Cela suffit pour un prototype, mais pas pour créer dix identités musicales.

Il faut des instruments réutilisables dédiés :
- Kick
- Snare
- Hat
- Bass
- Pluck
- Arp
- Pad
- Lead
- Supersaw
- Pulse
- Bell
- NoiseRiser

## Création de nodes par note

`tone()` crée un oscillator et un gain pour chaque événement.

C'est acceptable au début et probablement suffisant pour les références V1, mais à surveiller à haute densité.

Ne pas optimiser prématurément.

Mesurer avant de créer un système de pooling complexe.

## Random non déterministe

Le buffer de bruit et `noise.playbackRate` utilisent `Math.random()`.

Pour les SFX, ce n'est pas problématique.

Pour les compositions et patterns adaptatifs, utiliser un RNG seedé.

Séparer clairement :
- random SFX non critique ;
- random musical déterministe.

## Absence actuelle de plusieurs jeux

Les moods actuels couvrent :
- menu
- rhythm
- survival
- shooter
- runner
- cave
- simon

Il manque au minimum :
- breaker
- fish
- golf
- snake

Ils doivent être ajoutés via le nouveau système, pas en gonflant davantage `MOODS`.

---

# BPM actuels vs direction cible

| Jeu | Actuel | Cible de référence |
|---|---:|---:|
| Menu | 100 | 122 |
| Rhythm | 128 | variable |
| Survival | 122 | 142 |
| Shooter | 132 | 138 |
| Runner | 138 | 148 |
| Cave | 96 | 142 |
| Simon | 84 | 110 / minimal |

Ces changements doivent être introduits dans le nouveau moteur uniquement lorsque le mode Reference est activé, afin de pouvoir comparer ancien et nouveau.

---

# Stratégie recommandée

Ne pas modifier brutalement `AudioSys`.

Créer progressivement :

```text
AudioSys
├── SFX existants
├── volume/unlock/track existants
└── MusicEngine
    ├── MusicTransport
    ├── InstrumentRack
    ├── ReferencePlayer
    ├── AdaptiveDirector
    └── RhythmTimeline
```

`AudioSys` reste la façade publique pendant la migration.
