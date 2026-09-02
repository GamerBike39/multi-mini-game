import type { ChordDefinition, ReferenceComposition } from '../types';
import { barsFrom, drum, note, track } from './helpers';

const steps8 = [1, 3, 5, 7, 9, 11, 13, 15];
const pluck = (events: readonly (readonly [number, string])[]) =>
  events.map(([step, pitch]) => note(step, pitch, '16n', 0.34));

const shakerVelocities = [0.17, 0.23, 0.18, 0.25, 0.17, 0.23, 0.18, 0.25];
const drumBars = Array.from({ length: 16 }, (_, index) => {
  const barNumber = index + 1;
  const events = barNumber % 2 === 1
    ? [drum(1, 'kick', 0.62), drum(7, 'kick', 0.43), drum(13, 'kick', 0.53)]
    : [drum(1, 'kick', 0.55), drum(11, 'kick', 0.44)];
  events.push(drum(5, 'rim', 0.29), drum(13, 'rim', 0.29));
  events.push(...steps8.map((step, stepIndex) => drum(step, 'shaker', shakerVelocities[stepIndex])));
  return events;
});

const bass = barsFrom([
  [
    note(1, 'F#2', '2n', 0.55), note(9, 'C#3', '2n', 0.47),
  ], [
    note(1, 'F#2', '2n'), note(9, 'E3', '4n'), note(13, 'C#3', '4n'),
  ], [
    note(1, 'F#2', '1n'),
  ], [
    note(1, 'F#2', '2n'), note(9, 'C#3', '2n'),
  ], [
    note(1, 'D2', '2n'), note(9, 'A2', '2n'),
  ], [
    note(1, 'D2', '2n'), note(9, 'C#3', '4n'), note(13, 'A2', '4n'),
  ], [
    note(1, 'D2', '2n'), note(9, 'A2', '2n'),
  ], [
    note(1, 'D2', '2n'), note(9, 'C#3', '4n'), note(13, 'A2', '4n'),
  ], [
    note(1, 'A2', '2n'), note(9, 'E3', '2n'),
  ], [
    note(1, 'A2', '2n'), note(9, 'E3', '2n'),
  ], [
    note(1, 'A2', '2n'), note(9, 'E3', '2n'),
  ], [
    note(1, 'A2', '2n'), note(9, 'E3', '2n'),
  ], [
    note(1, 'E2', '2n'), note(9, 'B2', '2n'),
  ], [
    note(1, 'E2', '2n'), note(9, 'B2', '2n'),
  ], [
    note(1, 'E2', '2n'), note(9, 'B2', '2n'),
  ], [
    note(1, 'E2', '2n'), note(9, 'B2', '4n'), note(13, 'C#3', '4n'),
  ],
]);

const pluckBars = barsFrom([
  pluck([[1, 'F#4'], [6, 'C#5'], [11, 'E5'], [15, 'C#5']]),
  pluck([[3, 'A4'], [8, 'C#5'], [13, 'F#5']]),
  pluck([[1, 'F#4'], [6, 'A4'], [11, 'C#5'], [15, 'E5']]),
  pluck([[3, 'C#5'], [8, 'E5'], [13, 'F#5']]),
  pluck([[1, 'D4'], [6, 'A4'], [11, 'C#5'], [15, 'E5']]),
  pluck([[3, 'F#4'], [8, 'A4'], [13, 'C#5']]),
  pluck([[1, 'D4'], [6, 'F#4'], [11, 'A4'], [15, 'C#5']]),
  pluck([[3, 'A4'], [8, 'C#5'], [13, 'E5']]),
  pluck([[1, 'A4'], [6, 'E5'], [11, 'B5'], [15, 'E5']]),
  pluck([[3, 'C#5'], [8, 'E5'], [13, 'A5']]),
  pluck([[1, 'A4'], [6, 'C#5'], [11, 'E5'], [15, 'B5']]),
  pluck([[3, 'E5'], [8, 'C#5'], [13, 'A4']]),
  pluck([[1, 'E4'], [6, 'B4'], [11, 'C#5'], [15, 'F#5']]),
  pluck([[3, 'G#4'], [8, 'B4'], [13, 'C#5']]),
  pluck([[1, 'E4'], [6, 'G#4'], [11, 'B4'], [15, 'C#5']]),
  pluck([[3, 'B4'], [8, 'C#5'], [13, 'E5'], [15, 'F#5']]),
]);

const bells = barsFrom([
  [], [], [], [note(13, 'C#6', '8n')],
  [], [], [], [note(13, 'A5', '8n')],
  [], [], [], [note(13, 'E6', '8n')],
  [], [], [], [note(13, 'C#6', '8n'), note(15, 'F#6', '8n')],
]);

const microMelody = barsFrom([
  [], [], [], [], [], [], [], [], [], [], [], [],
  [note(1, 'C#5', '4n'), note(5, 'E5', '4n'), note(9, 'F#5', '2n')],
  [note(1, 'E5', '2n'), note(9, 'C#5', '2n')],
  [note(1, 'A4', '4n'), note(5, 'C#5', '4n'), note(9, 'E5', '4n'), note(13, 'F#5', '4n')],
  [note(1, 'E5', '4n'), note(5, 'C#5', '4n'), note(9, 'F#5', '2n')],
]);

const chords: ChordDefinition[] = [
  ...[1, 2, 3, 4].map((barNumber) => ({ bar: barNumber, notes: ['F#3', 'C#4', 'E4', 'A4'], duration: '1n' as const })),
  ...[5, 6, 7, 8].map((barNumber) => ({ bar: barNumber, notes: ['D3', 'A3', 'C#4', 'F#4'], duration: '1n' as const })),
  ...[9, 10, 11, 12].map((barNumber) => ({ bar: barNumber, notes: ['A3', 'E4', 'B4', 'C#5'], duration: '1n' as const })),
  ...[13, 14, 15, 16].map((barNumber) => ({ bar: barNumber, notes: ['E3', 'B3', 'C#4', 'G#4'], duration: '1n' as const })),
];

export const fishReference: ReferenceComposition = {
  id: 'fish',
  bpm: 100,
  key: 'F# minor',
  bars: 16,
  swing: 0.08,
  tracks: {
    drums: track('drums', barsFrom(drumBars)),
    bass: track('bass', bass),
    pluck: track('arp', pluckBars, -3),
    bell: track('fx', bells, -4),
    lead: track('lead', microMelody, -5),
  },
  chords,
};

