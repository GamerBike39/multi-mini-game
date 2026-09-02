import type { MusicState } from './types';

export const MUSIC_STATE_KEYS = [
  'intensity',
  'tension',
  'danger',
  'momentum',
  'complexity',
  'brightness',
  'triumph',
  'calm',
  'narrativeArc',
] as const;

export type MusicStateKey = (typeof MUSIC_STATE_KEYS)[number];

export const DEFAULT_MUSIC_STATE: Readonly<MusicState> = Object.freeze({
  intensity: 0.35,
  tension: 0.2,
  danger: 0.1,
  momentum: 0.3,
  complexity: 0.2,
  brightness: 0.4,
  triumph: 0,
  calm: 0.55,
  narrativeArc: 0.15,
});

interface SmoothingTimes {
  attack: number;
  release: number;
}

const SMOOTHING: Record<MusicStateKey, SmoothingTimes> = {
  danger: { attack: 0.35, release: 1.5 },
  intensity: { attack: 2, release: 2 },
  tension: { attack: 1, release: 1.8 },
  momentum: { attack: 3, release: 3 },
  complexity: { attack: 6, release: 6 },
  brightness: { attack: 1.5, release: 2.5 },
  triumph: { attack: 0.25, release: 2.5 },
  calm: { attack: 2, release: 2 },
  narrativeArc: { attack: 10, release: 10 },
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

const copyState = (state: MusicState): MusicState => ({ ...state });

/**
 * Etat musical à deux niveaux : les demandes changent immédiatement côté
 * logique, puis `currentState` les rejoint progressivement côté musique.
 */
export class MusicStateController {
  readonly currentState: MusicState;
  readonly targetState: MusicState;

  private readonly requestedState: MusicState;
  private readonly eventOffsets: MusicState = {
    intensity: 0,
    tension: 0,
    danger: 0,
    momentum: 0,
    complexity: 0,
    brightness: 0,
    triumph: 0,
    calm: 0,
    narrativeArc: 0,
  };

  constructor(initial: Partial<MusicState> = {}) {
    const base = this.mergeState(DEFAULT_MUSIC_STATE, initial);
    this.currentState = copyState(base);
    this.targetState = copyState(base);
    this.requestedState = copyState(base);
  }

  setState(partial: Partial<MusicState>): void {
    for (const key of MUSIC_STATE_KEYS) {
      const value = partial[key];
      if (typeof value === 'number' && Number.isFinite(value)) this.requestedState[key] = clamp01(value);
    }
    this.refreshTarget();
  }

  setValue(key: MusicStateKey, value: number): void {
    this.setState({ [key]: value });
  }

  reset(state: Partial<MusicState> = {}): void {
    const base = this.mergeState(DEFAULT_MUSIC_STATE, state);
    for (const key of MUSIC_STATE_KEYS) {
      this.requestedState[key] = base[key];
      this.eventOffsets[key] = 0;
      this.currentState[key] = base[key];
    }
    this.refreshTarget();
  }

  /** Applique des impulsions temporaires sans écraser les demandes manuelles. */
  setEventOffsets(offsets: Partial<MusicState>): void {
    for (const key of MUSIC_STATE_KEYS) {
      const value = offsets[key];
      this.eventOffsets[key] = typeof value === 'number' && Number.isFinite(value) ? value : 0;
    }
    this.refreshTarget();
  }

  update(dt: number): MusicState {
    const safeDt = Math.max(0, Math.min(0.25, Number.isFinite(dt) ? dt : 0));
    if (safeDt <= 0) return this.snapshot();

    for (const key of MUSIC_STATE_KEYS) {
      const current = this.currentState[key];
      const target = this.targetState[key];
      const delta = target - current;
      if (Math.abs(delta) < 0.0001) {
        this.currentState[key] = target;
        continue;
      }
      const time = delta > 0 ? SMOOTHING[key].attack : SMOOTHING[key].release;
      const amount = 1 - Math.exp(-safeDt / Math.max(0.05, time));
      this.currentState[key] = clamp01(current + delta * amount);
    }
    return this.snapshot();
  }

  snapshot(): MusicState {
    return copyState(this.currentState);
  }

  targetSnapshot(): MusicState {
    return copyState(this.targetState);
  }

  private refreshTarget(): void {
    for (const key of MUSIC_STATE_KEYS) {
      this.targetState[key] = clamp01(this.requestedState[key] + this.eventOffsets[key]);
    }
  }

  private mergeState(base: Readonly<MusicState>, partial: Partial<MusicState>): MusicState {
    const result = copyState(base);
    for (const key of MUSIC_STATE_KEYS) {
      const value = partial[key];
      if (typeof value === 'number' && Number.isFinite(value)) result[key] = clamp01(value);
    }
    return result;
  }
}
