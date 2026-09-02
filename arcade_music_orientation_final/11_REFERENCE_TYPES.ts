export type NoteDuration = '1n' | '2n' | '4n' | '8n' | '16n';

export interface NoteEvent {
  step: number;              // 1..16
  note: string;
  duration: NoteDuration;
  velocity: number;          // 0..1
}

export interface DrumEvent {
  step: number;              // 1..16
  kind: 'kick' | 'snare' | 'clap' | 'hatClosed' | 'hatOpen' | 'rim' | 'tom';
  velocity: number;
}

export interface AutomationEvent {
  step: number;
  target: string;
  value: number;
  ramp?: 'step' | 'linear' | 'exponential';
}

export interface TrackBar<TEvent = NoteEvent> {
  bar: number;               // 1-based
  events: readonly TEvent[];
}

export interface ReferenceTrack<TEvent = NoteEvent> {
  instrument: string;
  gainDb?: number;
  bars: readonly TrackBar<TEvent>[];
}

export interface ChordDefinition {
  bar: number;
  notes: readonly string[];
  duration: NoteDuration;
}

export interface ReferenceComposition {
  id: string;
  bpm: number;
  key: string;
  bars: number;
  swing?: number;
  tracks: Readonly<Record<string, ReferenceTrack<unknown>>>;
  chords?: readonly ChordDefinition[];
}

export interface DegreeEvent {
  step: number;
  degree: number;
  accidental?: -1 | 0 | 1;
  octave: number;
  duration: NoteDuration;
  velocity: number;
}
