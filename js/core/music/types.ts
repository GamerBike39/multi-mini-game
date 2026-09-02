export type GameMusic =
  | 'menu'
  | 'breaker'
  | 'caveRunner'
  | 'fish'
  | 'golf'
  | 'rhythm'
  | 'runner'
  | 'shooter'
  | 'simon'
  | 'snake'
  | 'survival';

export type ReferenceMusic = 'shooter' | 'survival' | 'fish';

export type NoteDuration = '1n' | '2n' | '4n' | '8n' | '16n';

export interface NoteEvent {
  step: number;
  note: string;
  duration: NoteDuration;
  velocity: number;
}

export type DrumKind =
  | 'kick'
  | 'snare'
  | 'clap'
  | 'hatClosed'
  | 'hatOpen'
  | 'hat'
  | 'rim'
  | 'tom'
  | 'shaker';

export interface DrumEvent {
  step: number;
  kind: DrumKind;
  velocity: number;
}

export interface TrackBar<TEvent = NoteEvent> {
  bar: number;
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

export type ReferenceEvent = NoteEvent | DrumEvent;

export interface ReferenceComposition {
  id: ReferenceMusic;
  bpm: number;
  key: string;
  bars: number;
  swing?: number;
  tracks: Readonly<Record<string, ReferenceTrack<ReferenceEvent>>>;
  chords?: readonly ChordDefinition[];
}

export interface MusicState {
  intensity: number;
  tension: number;
  danger: number;
  momentum: number;
  complexity: number;
  brightness: number;
  triumph: number;
  calm: number;
  narrativeArc: number;
}

export type QuantizedEvent = {
  time: number;
  beat: number;
  bar: number;
  type: 'kick' | 'snare' | 'hat' | 'bass' | 'lead' | 'chord' | 'accent';
  strength: number;
};
