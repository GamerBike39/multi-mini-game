import type {
  DrumEvent,
  NoteDuration,
  NoteEvent,
  ReferenceComposition,
  ReferenceEvent,
  ReferenceTrack,
  TrackBar,
} from '../types';

export const note = (
  step: number,
  pitch: string,
  duration: NoteDuration = '8n',
  velocity = 0.7,
): NoteEvent => ({ step, note: pitch, duration, velocity });

export const drum = (step: number, kind: DrumEvent['kind'], velocity = 0.7): DrumEvent => ({ step, kind, velocity });

export const bar = <T>(barNumber: number, events: readonly T[]): TrackBar<T> => ({ bar: barNumber, events });

export const track = <T extends ReferenceEvent>(
  instrument: string,
  bars: readonly TrackBar<T>[],
  gainDb?: number,
): ReferenceTrack<ReferenceEvent> => ({ instrument, bars, ...(gainDb === undefined ? {} : { gainDb }) });

export const barsFrom = <T>(
  values: readonly (readonly T[])[],
  startBar = 1,
): TrackBar<T>[] => values.map((events, index) => bar(startBar + index, events));

export const composition = (
  value: Omit<ReferenceComposition, 'tracks'> & { tracks: ReferenceComposition['tracks'] },
): ReferenceComposition => value;
