import type { ChordDefinition, ReferenceComposition } from '../types';
import { barsFrom, drum, note, track } from './helpers';

const repeat = <T>(count: number, factory: (index: number) => readonly T[]): readonly (readonly T[])[] =>
  Array.from({ length: count }, (_, index) => factory(index));

const arpSteps = [1, 3, 5, 7, 9, 11, 13, 15];
const arp = (pitches: readonly string[]) => pitches.map((pitch, index) => note(arpSteps[index], pitch, '16n', 0.45));

const drums = barsFrom([
  ...repeat(15, () => [
    drum(1, 'kick', 0.94), drum(5, 'kick', 0.88), drum(9, 'kick', 0.91), drum(13, 'kick', 0.88),
    drum(5, 'clap', 0.64), drum(13, 'clap', 0.64),
    drum(3, 'hatClosed', 0.42), drum(7, 'hatClosed', 0.38), drum(11, 'hatClosed', 0.44), drum(15, 'hatClosed', 0.40),
  ]),
  [drum(10, 'tom', 0.68), drum(12, 'tom', 0.64), drum(14, 'tom', 0.72), drum(15, 'snare', 0.76), drum(16, 'snare', 0.82)],
]);

const bassPitches: readonly (readonly [number, string, number?][])[] = [
  [[3, 'C2', 0.76], [7, 'C3', 0.67], [11, 'G2', 0.72], [15, 'C3', 0.68]],
  [[3, 'C2'], [7, 'G2'], [11, 'Bb2'], [15, 'C3']],
  [[3, 'C2'], [7, 'C3'], [11, 'G2'], [15, 'Bb2']],
  [[3, 'C2'], [7, 'G2'], [11, 'Bb2'], [15, 'G2']],
  [[3, 'Ab1'], [7, 'Ab2'], [11, 'Eb2'], [15, 'Ab2']],
  [[3, 'Ab1'], [7, 'Eb2'], [11, 'G2'], [15, 'Ab2']],
  [[3, 'Ab1'], [7, 'Ab2'], [11, 'Eb2'], [15, 'G2']],
  [[3, 'Ab1'], [7, 'Eb2'], [11, 'G2'], [15, 'Eb2']],
  [[3, 'Eb2'], [7, 'Eb3'], [11, 'Bb2'], [15, 'Eb3']],
  [[3, 'Eb2'], [7, 'Bb2'], [11, 'D3'], [15, 'Eb3']],
  [[3, 'Eb2'], [7, 'Eb3'], [11, 'Bb2'], [15, 'D3']],
  [[3, 'Eb2'], [7, 'Bb2'], [11, 'D3'], [15, 'Bb2']],
  [[3, 'Bb1'], [7, 'Bb2'], [11, 'F2'], [15, 'Bb2']],
  [[3, 'Bb1'], [7, 'F2'], [11, 'Ab2'], [15, 'Bb2']],
  [[3, 'Bb1'], [7, 'Bb2'], [11, 'F2'], [15, 'Ab2']],
  [[3, 'Bb1'], [7, 'F2'], [11, 'Ab2'], [14, 'G2', 0.64], [15, 'Bb2', 0.68], [16, 'C3', 0.76]],
];

const bass = barsFrom(bassPitches.map((events) => events.map(([step, pitch, velocity]) => note(step, pitch, '8n', velocity ?? 0.7))));

const arpPitches = [
  ['C4', 'G4', 'Bb4', 'C5', 'G4', 'Bb4', 'C5', 'G5'],
  ['C4', 'G4', 'Bb4', 'C5', 'G4', 'Bb4', 'C5', 'G5'],
  ['C4', 'G4', 'Bb4', 'C5', 'G4', 'Bb4', 'C5', 'G5'],
  ['C4', 'G4', 'Bb4', 'C5', 'D5', 'C5', 'Bb4', 'G4'],
  ['Ab3', 'Eb4', 'G4', 'Ab4', 'Eb4', 'G4', 'Ab4', 'C5'],
  ['Ab3', 'Eb4', 'G4', 'Ab4', 'Eb4', 'G4', 'Ab4', 'C5'],
  ['Ab3', 'Eb4', 'G4', 'Ab4', 'Eb4', 'G4', 'Ab4', 'C5'],
  ['Ab3', 'Eb4', 'G4', 'Bb4', 'C5', 'Bb4', 'G4', 'Eb4'],
  ['Eb4', 'Bb4', 'D5', 'Eb5', 'Bb4', 'D5', 'Eb5', 'G5'],
  ['Eb4', 'Bb4', 'D5', 'Eb5', 'Bb4', 'D5', 'Eb5', 'G5'],
  ['Eb4', 'Bb4', 'D5', 'Eb5', 'Bb4', 'D5', 'Eb5', 'G5'],
  ['Eb4', 'Bb4', 'D5', 'F5', 'G5', 'F5', 'D5', 'Bb4'],
  ['Bb3', 'F4', 'Ab4', 'Bb4', 'F4', 'Ab4', 'Bb4', 'D5'],
  ['Bb3', 'F4', 'Ab4', 'Bb4', 'F4', 'Ab4', 'Bb4', 'D5'],
  ['Bb3', 'F4', 'Ab4', 'Bb4', 'F4', 'Ab4', 'Bb4', 'D5'],
  ['Bb3', 'F4', 'Ab4', 'Bb4', 'D5', 'C5', 'Bb4', 'G4'],
];
const arpBars = barsFrom(arpPitches.map(arp));

const leadBars = [
  [],
  [],
  [],
  [],
  [],
  [],
  [],
  [],
  [note(1, 'C5', '4n', 0.68), note(5, 'G5', '4n', 0.64), note(9, 'Bb5', '4n', 0.70), note(13, 'C6', '4n', 0.79)],
  [note(1, 'G5', '4n'), note(5, 'Bb5', '4n'), note(9, 'C6', '2n')],
  [note(1, 'C5', '8n'), note(3, 'G5', '8n'), note(5, 'Bb5', '8n'), note(7, 'C6', '8n'), note(9, 'D6', '4n'), note(13, 'C6', '4n')],
  [note(1, 'Bb5', '4n'), note(5, 'G5', '4n'), note(9, 'Eb5', '2n')],
  [note(1, 'C5', '4n'), note(5, 'G5', '4n'), note(9, 'Bb5', '4n'), note(13, 'C6', '4n')],
  [note(1, 'D6', '4n'), note(5, 'C6', '4n'), note(9, 'Bb5', '4n'), note(13, 'G5', '4n')],
  [note(1, 'C6', '2n'), note(9, 'Bb5', '4n'), note(13, 'G5', '4n')],
  [note(1, 'G5', '4n'), note(5, 'Bb5', '4n'), note(9, 'C6', '2n')],
];

const chords: ChordDefinition[] = [
  ...[5, 6, 7, 8].map((barNumber) => ({ bar: barNumber, notes: ['Ab3', 'Eb4', 'G4', 'C5'], duration: '1n' as const })),
  ...[9, 10, 11, 12].map((barNumber) => ({ bar: barNumber, notes: ['Eb3', 'Bb3', 'D4', 'G4'], duration: '1n' as const })),
  ...[13, 14, 15, 16].map((barNumber) => ({ bar: barNumber, notes: ['Bb2', 'F3', 'Ab3', 'D4'], duration: '1n' as const })),
];

export const shooterReference: ReferenceComposition = {
  id: 'shooter',
  bpm: 138,
  key: 'C minor',
  bars: 16,
  tracks: {
    drums: track('drums', drums),
    bass: track('bass', bass),
    arp: track('arp', arpBars, -5),
    lead: track('lead', barsFrom(leadBars)),
  },
  chords,
};
