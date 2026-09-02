# Partitions logiques — tous les jeux

Notation 16 steps :

```text
01 02 03 04 | 05 06 07 08 | 09 10 11 12 | 13 14 15 16
```

Temps forts : 01, 05, 09, 13.

---

## BREAKER

BPM 134 — F minor — Fm / Db / Ab / Eb.

Kick : `01 05 09 13`
Clap : `05 13`
Hat offbeat : `03 07 11 15`

Bass base :
```text
steps 01 04 07 11 14
degrees 1 1 5 8 5
```

Arp 16th :
```text
1 5 b7 8 | 5 b7 8 5 | b7 8 5 b7 | 8 5 b7 5
```

Lead 4 bars :
```text
bar1 1 5 b7 8
bar2 5 b7 5
bar3 1 5 8 9
bar4 8 tenue
```

Structure :
01-04 kick+bass
05-08 +hat+chord
09-12 +arp
13-15 +lead
16 fill

Gameplay :
- combo >5 : octave arp occasionnelle
- combo >10 : réponse 5-b7-8
- <=3 briques : retirer kick/clap, garder bass pulse + arp filtré
- dernière brique : résolution quantifiée

---

## CAVE RUNNER

BPM 142 — D Phrygian.

Harmonie :
```text
01-04 Dm pedal
05-08 Eb/D
09-12 Dm
13-16 C/D
```

Kick 4/4 sec.
Perc métal patterns alternés :
```text
A: 07 13
B: 03 10 16
```

Sub :
```text
D2 @01 07 11 15
```

Pulse :
```text
D3 D3 Eb3 D3 @01 04 08 12
```

Arp haute intensité :
`1 b2 5 b7`

Gameplay :
- speed → subdivisions, pas BPM
- tunnel étroit → reverb↓, cutoff↓, sub↑
- near miss → accent métallique avec cooldown

---

## FISH

BPM 100 — F# minor pentatonic.
Grille :
F#m7 / Dmaj7 / Aadd9 / E6.

Kick asymétrique :
`01 07 13`
Rim : `05 13`
Shaker 8ths, faible vélocité et swing léger.

Bass : longues root/fifth.
Pluck : motif espacé `1–5–6–5`.
Bell : toutes les 4 mesures.

Gameplay :
- idle : pad/pluck/shaker
- bite : bell accent + tension
- fight : kick + pulse bass
- line tension >0.7 : motif répété
- catch >0.8 : motif haut `1 5 6 8`
- capture : accord add9 + réponse 5-6-8

---

## GOLF

BPM 112 — G Dorian.
Grille : Gm7 / C9 / Gm7 / Dm7.

Kick : `01 07`, variante `01 07 11`
Rim : `05 13`
Hat 8ths swing.
Bass groove degrees :
`1 . 1 5 | b7 5 . 8`

Chord pluck contretemps : `03 07 11 15`
Melody : `1 3 5 6`

Gameplay :
- swing : duck court des drums/pluck
- ball moving : hats/chords légèrement réduits
- proche du trou : kick se retire progressivement
- hole : `1 3 5 8`
- hole-in-one : mini fanfare `1 5 8 / 3 5 8 9`

---

## RHYTHM

Prototype trance : 140 BPM — A minor — Am/F/C/G.

Kick : `01 05 09 13`
Clap : `05 13`
Hat offbeat : `03 07 11 15`
Bass : `1 1 5 b7` sur contretemps
Arp 16ths : `1 3 5 8 / 5 8 3 5`

Chart :
- Easy : kick/clap/lead fort
- Normal : + bass + lead
- Hard : + hats + syncopes
- Expert : + 16ths et ghost accents contrôlés

Règle : le chart est dérivé des `MusicalEvent`, jamais reconstitué séparément.

---

## RUNNER

BPM 148 — E Dorian — Em/A/Em/D.

Kick : `01 07 09 14`
Snare : `05 13`
Hat 8ths.
Bass : `1 1 5 8 | b7 5 1 5`
Arp : `1 3 5 8`
Lead : `E B D E` = `1 5 b7 8`

Intensity :
- <.3 kick+bass
- .3-.55 +hat
- .55-.75 +arp
- .75-.9 +lead
- >.9 +octave arp/counter rhythm

Collision : retrait arp 1 mesure, puis réintroduction.

---

## SHOOTER

BPM 138 — C minor — Cm/Ab/Eb/Bb.

Kick : `01 05 09 13`
Clap : `05 13`
Hat offbeat puis 16ths à haute intensité.
Trance bass principalement sur contretemps.

Arp :
`1 5 b7 8 / 5 b7 8 5`

Supersaw à intensity >= .65.
Lead motif : C–G–Bb–C.

Boss :
- start : espace + filtre
- 75% : arp
- 50% : octave
- 25% : contre-mélodie
- 10% : peak drums
- defeat : Cm9 quantifié

---

## SIMON

Minimal synth.
Notes boutons :
- C5
- E5
- G5
- C6

Pad : Cmaj7 / Am7 très faible.
Computer turn : pad ~ -30 dB, drums off.
Player turn : pad très discret.
Success : G5-C6-E6.
Failure : Eb5-D5-C5.

La difficulté n'augmente jamais par surcharge de l'accompagnement.

---

## SNAKE

BPM 124 — A minor pentatonic.

Roots implicites : A/G/C/E.
Kick minimal : `01 09`
Snare : `05 13`
Square bass : `1 . 1 5`
Lead : `1 5 b7 8` toutes les 2 mesures.

Progression :
- court : bass+drum
- moyen : +lead
- long : +octave pulse
- très long : +tiny arp

Food streak ne transforme la musique que tous les 3-4 pickups.

---

## SURVIVAL

BPM 142 — E minor + F naturel ponctuel.

Cycles :
A = Em/C/D/Em
B = Em/D/C/D

Kick 4/4.
Clap 2/4.
Hats de offbeat vers 16ths.

Bass :
```text
steps 01 04 07 11 14
degrees 1 1 5 b7 5
```

Dark pulse :
`1 1 b2 1` quand tension élevée.

Arp :
base `1 5 b7 8`
tension `1 b2 5 b7`

Vague :
- start : kick+bass
- pressure : +hat+pulse
- build : +arp
- peak : +high arp+percussion
- derniers ennemis : anticipation, pas simple baisse
- clear : résolution courte

Wave suivante conserve une partie de l'énergie acquise.
