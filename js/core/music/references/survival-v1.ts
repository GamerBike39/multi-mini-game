import type { ChordDefinition, NoteDuration, ReferenceComposition } from '../types';
import { barsFrom, drum, note, track } from './helpers';

const steps8 = [1, 3, 5, 7, 9, 11, 13, 15];
const steps16 = Array.from({ length: 16 }, (_, index) => index + 1);
const arp = (pitches: readonly string[]) => pitches.map((pitch, index) => note(steps8[index], pitch, '16n', 0.42));

const drumBars = Array.from({ length: 16 }, (_, index) => {
  const barNumber = index + 1;
  const events = [1, 5, 9, 13].map((step) => drum(step, 'kick', step === 1 ? 0.88 : 0.78));
  if (barNumber >= 5) {
    events.push(drum(5, 'clap', 0.58), drum(13, 'clap', 0.58));
  }
  if (barNumber <= 4 || (barNumber >= 5 && barNumber <= 12 && barNumber % 2 === 1)) {
    events.push(...[3, 7, 11, 15].map((step) => drum(step, 'hatClosed', 0.34)));
  } else {
    events.push(...steps16.map((step) => drum(step, 'hatClosed', step % 4 === 1 ? 0.56 : 0.28)));
  }
  return events;
});

const finalDrumBars = drumBars.map((events, index) => index < 12
  ? events
  : [
      ...events.filter((event) => event.kind === 'kick' || event.kind === 'clap'),
      ...steps16.map((step) => drum(step, 'hatClosed', step % 4 === 1 ? 0.62 : 0.36)),
    ]);

const emBass = [
  [1, 'E2', '8n', 0.82], [4, 'E2', '16n', 0.62], [7, 'B2', '8n', 0.76],
  [11, 'D3', '8n', 0.69], [14, 'B2', '16n', 0.63],
] as const;
const emVariation = [[1, 'E2'], [4, 'B2'], [7, 'D3'], [10, 'E3'], [13, 'D3'], [15, 'B2']] as const;
const cBass = [[1, 'C2'], [4, 'C2'], [7, 'G2'], [11, 'B2'], [14, 'G2']] as const;
const cVariation = [[1, 'C2'], [4, 'G2'], [7, 'B2'], [10, 'D3'], [13, 'B2'], [15, 'G2']] as const;
const dBass = [[1, 'D2'], [4, 'D2'], [7, 'A2'], [11, 'C3'], [14, 'A2']] as const;

const bassEvents = (events: readonly (readonly [number, string, NoteDuration?, number?])[]) =>
  events.map(([step, pitch, duration, velocity]) => note(step, pitch, duration ?? '8n', velocity ?? 0.7));

const bass = [
  ...barsFrom([bassEvents(emBass), bassEvents(emBass), bassEvents(emBass), bassEvents(emVariation)]),
  ...barsFrom([bassEvents(cBass), bassEvents(cBass), bassEvents(cBass), bassEvents(cVariation)], 5),
  ...barsFrom([bassEvents(dBass), bassEvents(dBass), bassEvents(dBass), bassEvents(dBass)], 9),
  ...barsFrom([bassEvents(emBass), bassEvents(emBass), bassEvents(emBass), bassEvents(emVariation)], 13),
];

const darkPulsePitches = [
  ['E3', 'E3', 'B3', 'E4'], ['E3', 'E3', 'B3', 'E4'], ['E3', 'E3', 'B3', 'E4'], ['E3', 'E3', 'B3', 'E4'],
  ['C3', 'C3', 'G3', 'B3'], ['C3', 'C3', 'G3', 'B3'], ['C3', 'C3', 'G3', 'B3'], ['C3', 'C3', 'G3', 'B3'],
  ['D3', 'D3', 'A3', 'C4'], ['D3', 'D3', 'A3', 'C4'], ['D3', 'D3', 'A3', 'C4'], ['D3', 'D3', 'A3', 'C4'],
  ['E3', 'F3', 'B3', 'D4'], ['E3', 'F3', 'B3', 'D4'], ['E3', 'F3', 'B3', 'D4'], ['E3', 'F3', 'B3', 'D4'],
];
const darkPulse = barsFrom(darkPulsePitches.map((pitches) => pitches.map((pitch, index) => note([1, 6, 10, 14][index], pitch, '8n', 0.28))));

const arpPitches = [
  [], [], [], [], [], [],
  ['C4', 'G4', 'B4', 'C5', 'G4', 'B4', 'C5', 'D5'],
  ['C4', 'G4', 'B4', 'D5', 'C5', 'B4', 'G4', 'D4'],
  ['D4', 'A4', 'C5', 'D5', 'A4', 'C5', 'D5', 'F#5'],
  ['D4', 'A4', 'C5', 'D5', 'F#5', 'D5', 'C5', 'A4'],
  ['D4', 'A4', 'C5', 'E5', 'D5', 'C5', 'A4', 'D5'],
  ['D4', 'A4', 'C5', 'D5', 'C5', 'A4', 'F#4', 'A4'],
  ['E4', 'B4', 'D5', 'E5', 'B4', 'D5', 'E5', 'G5'],
  ['E4', 'F4', 'B4', 'D5', 'E5', 'D5', 'B4', 'F4'],
  ['D4', 'A4', 'C5', 'D5', 'A4', 'C5', 'D5', 'F#5'],
  ['E4', 'F4', 'B4', 'D5', 'E5', 'B4', 'G4', 'E4'],
];
const arpBars = barsFrom(arpPitches.map(arp));

const leadBars = [
  [], [], [], [], [], [], [], [],
  [note(1, 'B4', '2n'), note(9, 'D5', '2n')],
  [note(1, 'E5', '1n')],
  [],
  [note(1, 'D5', '2n'), note(9, 'B4', '2n')],
  [note(1, 'E5', '2n'), note(9, 'G5', '2n')],
  [note(1, 'F5', '4n'), note(5, 'E5', '4n'), note(9, 'D5', '2n')],
  [note(1, 'A4', '2n'), note(9, 'D5', '2n')],
  [note(1, 'B4', '4n'), note(5, 'D5', '4n'), note(9, 'E5', '2n')],
];

const chords: ChordDefinition[] = [
  ...[1, 2, 3, 4].map((barNumber) => ({ bar: barNumber, notes: ['E3', 'B3', 'D4', 'G4'], duration: '1n' as const })),
  ...[5, 6, 7, 8].map((barNumber) => ({ bar: barNumber, notes: ['C3', 'G3', 'B3', 'E4'], duration: '1n' as const })),
  ...[9, 10, 11, 12].map((barNumber) => ({ bar: barNumber, notes: ['D3', 'A3', 'C4', 'F#4'], duration: '1n' as const })),
  ...[13, 14, 15, 16].map((barNumber) => ({ bar: barNumber, notes: ['E3', 'B3', 'D4', 'G4'], duration: '1n' as const })),
];

export const survivalReference: ReferenceComposition = {
  id: 'survival',
  bpm: 142,
  key: 'E minor',
  bars: 16,
  tracks: {
    drums: track('drums', barsFrom(finalDrumBars)),
    bass: track('bass', bass),
    darkPulse: track('arp', darkPulse, -8),
    arp: track('arp', arpBars, -4),
    lead: track('lead', barsFrom(leadBars), -2),
  },
  chords,
};
