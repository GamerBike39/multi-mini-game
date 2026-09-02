import type { InstrumentRack } from './instrument-rack';
import {
  DEFAULT_EVENT_EPSILON,
  DEFAULT_LOOKAHEAD,
  MusicTransport,
  type ScheduledStep,
} from './transport';
import { getReferenceComposition } from './references';
import type {
  ChordDefinition,
  DrumEvent,
  NoteDuration,
  NoteEvent,
  ReferenceComposition,
  ReferenceEvent,
  ReferenceMusic,
} from './types';

const DURATION_STEPS: Record<NoteDuration, number> = {
  '1n': 16,
  '2n': 8,
  '4n': 4,
  '8n': 2,
  '16n': 1,
};

const NOTE_SEMITONES: Record<string, number> = {
  C: 0,
  'C#': 1,
  Db: 1,
  D: 2,
  'D#': 3,
  Eb: 3,
  E: 4,
  F: 5,
  'F#': 6,
  Gb: 6,
  G: 7,
  'G#': 8,
  Ab: 8,
  A: 9,
  'A#': 10,
  Bb: 10,
  B: 11,
};

interface ScheduledReferenceEvent {
  trackName: string;
  gain: number;
  event: ReferenceEvent | ChordDefinition;
  chord?: boolean;
}

const noteToMidi = (value: string): number | null => {
  const match = /^([A-G](?:#|b)?)(-?\d+)$/.exec(value.trim());
  if (!match) return null;
  const semitone = NOTE_SEMITONES[match[1]];
  const octave = Number(match[2]);
  if (semitone === undefined || !Number.isFinite(octave)) return null;
  return (octave + 1) * 12 + semitone;
};

const dbToGain = (db: number | undefined): number =>
  db === undefined || !Number.isFinite(db) ? 1 : Math.pow(10, db / 20);

const isDrumEvent = (event: ReferenceEvent): event is DrumEvent => 'kind' in event;
const isNoteEvent = (event: ReferenceEvent): event is NoteEvent => 'note' in event;

/**
 * Lecteur strict des partitions de référence. Il ne connaît aucun état de jeu
 * et ne tire aucun nombre aléatoire : la partition est indexée sur les pas de
 * la boucle puis rendue par l'horloge AudioContext du transport.
 */
export class ReferencePlayer {
  private composition: ReferenceComposition | null = null;
  private readonly eventsByLoopStep = new Map<number, ScheduledReferenceEvent[]>();
  private active = false;

  constructor(
    private readonly transport: MusicTransport,
    private readonly rack: InstrumentRack,
  ) {}

  start(reference: ReferenceMusic | ReferenceComposition): ReferenceComposition {
    const composition = typeof reference === 'string' ? getReferenceComposition(reference) : reference;
    this.composition = composition;
    this.eventsByLoopStep.clear();
    this.active = true;

    for (const [trackName, track] of Object.entries(composition.tracks)) {
      const gain = dbToGain(track.gainDb);
      for (const trackBar of track.bars) {
        for (const event of trackBar.events) {
          if (!isDrumEvent(event) && !isNoteEvent(event)) continue;
          this.addEvent((trackBar.bar - 1) * 16 + (event.step - 1), {
            trackName: track.instrument || trackName,
            gain,
            event,
          });
        }
      }
    }

    for (const chord of composition.chords ?? []) {
      this.addEvent((chord.bar - 1) * 16, {
        trackName: 'harmony',
        gain: 1,
        event: chord,
        chord: true,
      });
    }
    return composition;
  }

  stop(): void {
    this.active = false;
    this.composition = null;
    this.eventsByLoopStep.clear();
  }

  pause(now: number): void {
    this.transport.pause(now);
  }

  resume(now: number): void {
    this.transport.resume(now);
  }

  scheduleAhead(now: number, lookahead = DEFAULT_LOOKAHEAD): void {
    if (!this.active || !this.composition) return;
    this.transport.scheduleAhead(now, lookahead, (step) => this.playStep(step), DEFAULT_EVENT_EPSILON);
  }

  isPlaying(): boolean {
    return this.active && this.transport.running && !this.transport.paused;
  }

  isActive(): boolean {
    return this.active && this.transport.running;
  }

  getBpm(): number { return this.transport.bpm; }
  getBeat(now: number): number { return this.transport.beatAt(now); }
  getBar(now: number): number { return this.transport.barAt(now); }
  getStep(now: number): number { return this.transport.stepAt(now); }
  getPhrase(now: number): number { return this.transport.phraseAt(now); }
  getTransportTime(now: number): number { return this.transport.transportTime(now); }

  private addEvent(loopStep: number, event: ScheduledReferenceEvent): void {
    if (!Number.isInteger(loopStep) || loopStep < 0) return;
    const key = loopStep % Math.max(1, (this.composition?.bars ?? 16) * 16);
    const list = this.eventsByLoopStep.get(key);
    if (list) list.push(event);
    else this.eventsByLoopStep.set(key, [event]);
  }

  private playStep(step: ScheduledStep): void {
    const events = this.eventsByLoopStep.get(step.loopStep);
    if (!events) return;
    for (const scheduled of events) this.playEvent(scheduled, step);
  }

  private playEvent(scheduled: ScheduledReferenceEvent, step: ScheduledStep): void {
    const swing = this.composition?.swing ?? 0;
    const time = step.time + this.swingOffset(step.stepInBar, swing);
    const event = scheduled.event;
    if (scheduled.chord) {
      if (!('notes' in event)) return;
      const notes = event.notes.map(noteToMidi).filter((midi): midi is number => midi !== null);
      if (notes.length) this.rack.triggerChord(time, notes, DURATION_STEPS[event.duration] * this.transport.stepDuration, 0.45 * scheduled.gain);
      return;
    }
    const referenceEvent = event as ReferenceEvent;
    if (isDrumEvent(referenceEvent)) {
      this.rack.triggerDrum(referenceEvent.kind, time, referenceEvent.velocity * scheduled.gain);
      return;
    }
    if (!isNoteEvent(referenceEvent)) return;
    const midi = noteToMidi(referenceEvent.note);
    if (midi === null) return;
    const duration = DURATION_STEPS[referenceEvent.duration] * this.transport.stepDuration;
    const velocity = referenceEvent.velocity * scheduled.gain;
    const instrument = scheduled.trackName.toLowerCase();
    if (instrument === 'bass') this.rack.triggerBass(time, midi, duration, velocity);
    else if (instrument === 'lead' || instrument === 'melody') this.rack.lead.trigger(midi, time, duration, velocity);
    else if (instrument === 'bell' || instrument === 'fx') this.rack.fx.trigger(midi, time, duration, velocity);
    else this.rack.arp.trigger(midi, time, duration, velocity);
  }

  private swingOffset(stepInBar: number, swing: number): number {
    if (!Number.isFinite(swing) || swing <= 0) return 0;
    // Les contretemps de croches sont décalés ; l'horloge globale reste intacte.
    if ((stepInBar - 3) % 4 !== 0) return 0;
    return Math.min(0.25, swing) * (this.transport.beatDuration / 2);
  }
}
