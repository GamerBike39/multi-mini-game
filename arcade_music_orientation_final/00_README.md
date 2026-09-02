# Arcade Music Transformation — Orientation finale

Ce dossier est le cahier de route consolidé pour transformer le système audio actuel en moteur musical adaptatif WebAudio pour la collection de mini-jeux.

## Décision structurante

**Conserver Web Audio API pur pour la V1. Ne pas ajouter Tone.js par défaut.**

Le code existant possède déjà :
- un `AudioContext` central ;
- des bus `music`, `sfx` et `track` ;
- un compresseur master ;
- un scheduler lookahead piloté par `setInterval`, mais qui programme les événements sur l'horloge audio avec `ctx.currentTime` ;
- un séquenceur 16 pas ;
- un mode `chart` pour Rhythm ;
- une horloge `beat()` et `songTime()` ;
- une gestion des pistes audio externes.

Le `setInterval` actuel ne doit pas être confondu avec un déclenchement sonore naïf : il ne fait que remplir un horizon de scheduling. Cette architecture est exploitable.

## Objectif

Passer de :

`Mood = kick + snare + hat + bass + pad sur une seule mesure`

à :

`Composition 16/32 mesures + instruments + motifs + sections + état musical + adaptation gameplay`

sans casser les SFX, les volumes, l'unlock navigateur, Rhythm ou le mode piste audio.

## Ordre de travail obligatoire

1. Refactor structurel sans modifier le rendu SFX.
2. Nouveau transport multi-mesures.
3. Instruments musicaux réutilisables.
4. Implémentation exacte des trois références :
   - Shooter Reference V1
   - Survival Reference V1
   - Fish Reference V1
5. Validation auditive manuelle.
6. Seulement après validation : MusicState adaptatif.
7. Puis extension aux autres jeux.
8. Rhythm est traité séparément, avec musique et chart issus de la même timeline.

## Golden rule

> Une composition fixe excellente d'abord. Une adaptation intelligente ensuite.

Le moteur adaptatif ne doit jamais servir à masquer une composition faible.

## Contenu

- `01_CURRENT_AUDIO_ANALYSIS.md` : état réel du fichier actuel et points de migration.
- `02_TARGET_ARCHITECTURE.md` : architecture cible.
- `03_MUSICAL_BIBLE.md` : identité musicale globale et directions des 10 jeux.
- `04_LOGICAL_SCORES_ALL_GAMES.md` : partitions logiques de tous les jeux.
- `05_REFERENCE_V1_EXACT.md` : trois compositions de référence à coder exactement.
- `06_ADAPTIVE_SYSTEM.md` : MusicState, événements, smoothing, hystérésis, mémoire musicale.
- `07_MIGRATION_PLAN.md` : séquence de migration sécurisée.
- `08_CODEX_MASTER_PROMPT.md` : prompt principal à donner à Codex.
- `09_VALIDATION_MATRIX.md` : critères d'acceptation.
- `10_API_CONTRACT.ts` : contrat TypeScript cible.
- `11_REFERENCE_TYPES.ts` : modèle de données des partitions.
- `12_EVENT_MAPPING.md` : mapping gameplay → musique.
- `13_AUDIO_ENGINE_RULES.md` : règles de timing, mix, performance et déterminisme.
- `legacy/AudioSys.current.ts` : snapshot du système actuel fourni.
