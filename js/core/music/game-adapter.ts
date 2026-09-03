import type { AudioLike, GameMeta } from '../types';
import type { GameMusicEventName, MusicState, ReferenceMusic } from './types';

export interface GameMusicSource {
  time?: unknown;
  state?: unknown;
  score?: unknown;
  [key: string]: unknown;
}

interface GameMusicProfile {
  mood: string;
  reference?: ReferenceMusic;
  state: MusicState;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const numberValue = (source: GameMusicSource, key: string, fallback = 0): number => {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};
const countValue = (source: GameMusicSource, key: string): number => {
  const value = source[key];
  return Array.isArray(value) ? value.length : numberValue(source, key);
};
const phaseValue = (source: GameMusicSource): string => typeof source.phase === 'string' ? source.phase : '';

const profile = (
  mood: string,
  state: MusicState,
  reference?: ReferenceMusic,
): GameMusicProfile => ({ mood, state, reference });

// Familles dynamiques : les moods dédiées gardent la lecture d'état de leur
// famille (vitesse, proximité, manches...) tout en sonnant différemment.
const RUNNER_MOODS: readonly string[] = ['runner', 'flap', 'frog', 'snake', 'columns'];
const CAVE_MOODS: readonly string[] = ['cave', 'golf', 'dig', 'bubble', 'cycle'];
const SIMON_MOODS: readonly string[] = ['simon', 'sort', 'path'];

const PROFILES: Record<string, GameMusicProfile> = {
  surv: profile('survival', {
    intensity: 0.44, tension: 0.55, danger: 0.35, momentum: 0.25, complexity: 0.3,
    brightness: 0.28, triumph: 0, calm: 0.18, narrativeArc: 0.1,
  }, 'survival'),
  shoot: profile('shooter', {
    intensity: 0.5, tension: 0.35, danger: 0.28, momentum: 0.42, complexity: 0.38,
    brightness: 0.5, triumph: 0, calm: 0.15, narrativeArc: 0.08,
  }, 'shooter'),
  fish: profile('menu', {
    intensity: 0.18, tension: 0.14, danger: 0.05, momentum: 0.1, complexity: 0.18,
    brightness: 0.55, triumph: 0, calm: 0.75, narrativeArc: 0.08,
  }, 'fish'),
  breaker: profile('breaker', {
    intensity: 0.45, tension: 0.3, danger: 0.15, momentum: 0.5, complexity: 0.4,
    brightness: 0.55, triumph: 0, calm: 0.25, narrativeArc: 0.1,
  }),
  run: profile('runner', {
    intensity: 0.45, tension: 0.3, danger: 0.16, momentum: 0.5, complexity: 0.4,
    brightness: 0.58, triumph: 0, calm: 0.22, narrativeArc: 0.1,
  }),
  cave: profile('cave', {
    intensity: 0.42, tension: 0.6, danger: 0.35, momentum: 0.38, complexity: 0.36,
    brightness: 0.35, triumph: 0, calm: 0.12, narrativeArc: 0.1,
  }),
  golf: profile('golf', {
    intensity: 0.25, tension: 0.2, danger: 0.05, momentum: 0.3, complexity: 0.45,
    brightness: 0.55, triumph: 0, calm: 0.58, narrativeArc: 0.12,
  }),
  snake: profile('snake', {
    intensity: 0.25, tension: 0.2, danger: 0.05, momentum: 0.25, complexity: 0.2,
    brightness: 0.5, triumph: 0, calm: 0.5, narrativeArc: 0.1,
  }),
  simon: profile('simon', {
    intensity: 0.12, tension: 0.18, danger: 0.02, momentum: 0.1, complexity: 0.18,
    brightness: 0.55, triumph: 0, calm: 0.7, narrativeArc: 0.05,
  }),
  pong: profile('pong', {
    intensity: 0.38, tension: 0.32, danger: 0.12, momentum: 0.45, complexity: 0.3,
    brightness: 0.5, triumph: 0, calm: 0.3, narrativeArc: 0.1,
  }),
  flap: profile('flap', {
    intensity: 0.38, tension: 0.22, danger: 0.12, momentum: 0.45, complexity: 0.5,
    brightness: 0.6, triumph: 0, calm: 0.3, narrativeArc: 0.1,
  }),
  frog: profile('frog', {
    intensity: 0.32, tension: 0.2, danger: 0.08, momentum: 0.4, complexity: 0.3,
    brightness: 0.58, triumph: 0, calm: 0.35, narrativeArc: 0.1,
  }),
  columns: profile('columns', {
    intensity: 0.25, tension: 0.18, danger: 0.03, momentum: 0.3, complexity: 0.5,
    brightness: 0.6, triumph: 0, calm: 0.5, narrativeArc: 0.12,
  }),
  dig: profile('dig', {
    intensity: 0.3, tension: 0.35, danger: 0.15, momentum: 0.25, complexity: 0.25,
    brightness: 0.35, triumph: 0, calm: 0.3, narrativeArc: 0.12,
  }),
  bubble: profile('bubble', {
    intensity: 0.35, tension: 0.2, danger: 0.05, momentum: 0.42, complexity: 0.55,
    brightness: 0.62, triumph: 0, calm: 0.35, narrativeArc: 0.12,
  }),
  sort: profile('sort', {
    intensity: 0.25, tension: 0.2, danger: 0.03, momentum: 0.3, complexity: 0.3,
    brightness: 0.55, triumph: 0, calm: 0.5, narrativeArc: 0.08,
  }),
  path: profile('path', {
    intensity: 0.2, tension: 0.25, danger: 0.05, momentum: 0.25, complexity: 0.45,
    brightness: 0.5, triumph: 0, calm: 0.6, narrativeArc: 0.1,
  }),
  cycle: profile('cycle', {
    intensity: 0.46, tension: 0.42, danger: 0.22, momentum: 0.52, complexity: 0.42,
    brightness: 0.58, triumph: 0, calm: 0.2, narrativeArc: 0.1,
  }),
};

const defaultProfile = (meta: GameMeta): GameMusicProfile => profile(meta.mood, {
  intensity: 0.3, tension: 0.25, danger: 0.1, momentum: 0.25, complexity: 0.25,
  brightness: 0.45, triumph: 0, calm: 0.4, narrativeArc: 0.08,
});

/**
 * Adaptateur commun aux jeux : il traduit leur état en MusicState et leurs
 * jalons en événements. Le jeu ne connaît jamais les couches ni les notes.
 */
export class GameMusicAdapter {
  readonly profile: GameMusicProfile;
  private active = false;
  private readonly sampledNumbers = new Map<string, number>();
  private sampledPhase = '';

  constructor(
    private readonly audio: AudioLike,
    meta: GameMeta,
  ) {
    this.profile = PROFILES[meta.id] ?? defaultProfile(meta);
  }

  start(): void {
    this.active = true;
    this.sampledNumbers.clear();
    this.sampledPhase = '';
    this.audio.setAdaptiveEnabled(true);
    this.audio.resetMusicState();
    this.audio.setMusicState(this.profile.state);
    if (this.profile.reference) this.audio.startReference(this.profile.reference);
    else this.audio.startMusic(this.profile.mood);
  }

  update(_dt: number, source: GameMusicSource): void {
    if (!this.active) return;
    this.audio.setMusicState(this.metrics(source));
    this.detectStructuralEvents(source);
  }

  event(type: GameMusicEventName, strength = 1, value = 0): void {
    if (this.active) this.audio.musicEvent(type, strength, value);
  }

  stop(): void {
    this.active = false;
    this.audio.stopMusic();
    this.audio.setAdaptiveEnabled(false);
    this.audio.resetMusicState();
  }

  private metrics(source: GameMusicSource): MusicState {
    const time = Math.max(0, numberValue(source, 'time'));
    const progress = clamp01(time / 90);
    const state: MusicState = { ...this.profile.state };
    state.narrativeArc = clamp01(state.narrativeArc + progress * 0.55);
    state.intensity = clamp01(state.intensity + progress * 0.18);
    state.momentum = clamp01(state.momentum + progress * 0.2);

    if (this.profile.reference === 'survival') {
      const pressure = clamp01(countValue(source, 'enemies') / 14 + countValue(source, 'bullets') / 24);
      state.intensity = clamp01(0.42 + progress * 0.24 + pressure * 0.2);
      state.tension = clamp01(0.48 + pressure * 0.32 + progress * 0.12);
      state.danger = clamp01(0.2 + pressure * 0.58);
      state.momentum = clamp01(0.24 + progress * 0.3 + countValue(source, 'orbChain') * 0.03);
      state.calm = clamp01(0.2 - pressure * 0.12);
    } else if (this.profile.reference === 'shooter') {
      const pressure = clamp01(countValue(source, 'enemies') / 18 + countValue(source, 'ebullets') / 18);
      const streak = clamp01(numberValue(source, 'streak') / 12);
      state.intensity = clamp01(0.46 + progress * 0.25 + pressure * 0.18);
      state.tension = clamp01(0.3 + pressure * 0.35);
      state.danger = clamp01(0.16 + pressure * 0.56);
      state.momentum = clamp01(0.3 + streak * 0.45 + progress * 0.18);
      state.complexity = clamp01(0.3 + streak * 0.35 + progress * 0.1);
      state.brightness = clamp01(0.42 + streak * 0.25 + progress * 0.12);
      state.calm = clamp01(0.18 - pressure * 0.1);
    } else if (this.profile.reference === 'fish') {
      const phase = phaseValue(source);
      const tension = clamp01(numberValue(source, 'tension'));
      const fighting = phase === 'strike' || phase === 'reel';
      state.intensity = clamp01(0.15 + (fighting ? 0.34 : 0) + tension * 0.28);
      state.tension = clamp01(0.12 + tension * 0.78 + (fighting ? 0.12 : 0));
      state.danger = clamp01(tension * 0.72);
      state.momentum = clamp01(0.1 + (fighting ? 0.28 : 0) + numberValue(source, 'bestCatch') / 8000 * 0.12);
      state.complexity = clamp01(0.16 + (fighting ? 0.2 : 0));
      state.brightness = clamp01(0.5 + (phase === 'caught' ? 0.25 : 0));
      state.triumph = clamp01(phase === 'caught' ? 0.5 : 0);
      state.calm = clamp01(fighting ? 0.32 : 0.76);
    } else if (RUNNER_MOODS.includes(this.profile.mood)) {
      const speed = numberValue(source, 'speed', 380);
      const speedFactor = clamp01((speed - 300) / 480);
      const combo = clamp01(numberValue(source, 'eaten', numberValue(source, 'comboStep')) / 14);
      const proximity = clamp01(numberValue(source, 'proxT') / 0.95);
      state.intensity = clamp01(0.28 + speedFactor * 0.55 + progress * 0.1);
      state.tension = clamp01(0.2 + speedFactor * 0.38 + proximity * 0.2);
      state.danger = clamp01(0.08 + speedFactor * 0.38 + proximity * 0.3);
      state.momentum = clamp01(0.35 + speedFactor * 0.45 + combo * 0.15 + proximity * 0.08);
      state.complexity = clamp01(0.25 + speedFactor * 0.38);
      state.brightness = clamp01(0.48 + speedFactor * 0.3 + proximity * 0.12);
      state.calm = clamp01(0.32 - speedFactor * 0.16);
    } else if (CAVE_MOODS.includes(this.profile.mood)) {
      const speed = numberValue(source, 'speedNow', numberValue(source, 'speed', 330));
      const speedFactor = clamp01((speed - 300) / 400);
      const proximity = clamp01(numberValue(source, 'proxT') / 0.22);
      state.intensity = clamp01(0.3 + speedFactor * 0.42 + progress * 0.14);
      state.tension = clamp01(0.38 + speedFactor * 0.3 + proximity * 0.18);
      state.danger = clamp01(0.16 + speedFactor * 0.35 + proximity * 0.25);
      state.momentum = clamp01(0.25 + speedFactor * 0.45);
      state.complexity = clamp01(0.25 + speedFactor * 0.28);
      state.brightness = clamp01(0.36 + speedFactor * 0.3);
      state.calm = clamp01(0.2 - speedFactor * 0.1);
    } else if (SIMON_MOODS.includes(this.profile.mood)) {
      const round = clamp01(numberValue(source, 'round') / 16);
      const showing = phaseValue(source) === 'show';
      state.intensity = clamp01(0.1 + round * 0.22 + (showing ? 0.04 : 0));
      state.tension = clamp01(0.14 + round * 0.3);
      state.danger = clamp01(0.02 + round * 0.08);
      state.momentum = clamp01(0.08 + round * 0.32);
      state.complexity = clamp01(0.14 + round * 0.4);
      state.brightness = clamp01(0.5 + round * 0.2);
      state.calm = clamp01(0.74 - round * 0.25);
    } else {
      const combo = clamp01(numberValue(source, 'comboStep', numberValue(source, 'streak')) / 16);
      const level = clamp01(numberValue(source, 'level', numberValue(source, 'holeIdx')) / 9);
      state.intensity = clamp01(state.intensity + combo * 0.2 + level * 0.1);
      state.momentum = clamp01(state.momentum + combo * 0.3 + level * 0.12);
      state.complexity = clamp01(state.complexity + combo * 0.25);
      state.triumph = clamp01(state.triumph + level * 0.1);
    }
    return state;
  }

  private detectStructuralEvents(source: GameMusicSource): void {
    const id = this.profile.reference ?? this.profile.mood;
    if (id === 'fish') {
      const phase = phaseValue(source);
      if (this.sampledPhase && phase !== this.sampledPhase) {
        if (phase === 'strike') this.event('fishBite', 0.9);
        else if (phase === 'caught') this.event('fishCaught', 1);
      }
      this.sampledPhase = phase;
    } else if (id === 'simon') {
      const phase = phaseValue(source);
      if (this.sampledPhase && phase !== this.sampledPhase && phase === 'input') this.event('waveStart', 0.3);
      this.sampledPhase = phase;
      this.risingEvent(source, 'round', 'waveComplete', 1);
    } else if (id === 'breaker') {
      this.risingEvent(source, 'level', 'waveComplete', 1);
      this.risingEvent(source, 'comboStep', 'brickCombo', 1);
    } else if (id === 'golf') {
      this.risingEvent(source, 'holeIdx', 'waveComplete', 1);
    }

    if (this.profile.reference === 'survival' || this.profile.reference === 'shooter') {
      this.risingEvent(source, 'streak', 'combo', 1);
    }
  }

  private risingEvent(source: GameMusicSource, key: string, type: GameMusicEventName, minDelta: number): void {
    const value = numberValue(source, key, 0);
    const previous = this.sampledNumbers.get(key);
    if (previous !== undefined && value > previous + minDelta) this.event(type, Math.min(1.5, value - previous));
    this.sampledNumbers.set(key, value);
  }
}

export class MenuMusicAdapter {
  private active = false;

  constructor(private readonly audio: AudioLike) {}

  start(): void {
    this.active = true;
    this.audio.setAdaptiveEnabled(true);
    this.audio.resetMusicState();
    this.audio.setMusicState({
      intensity: 0.22,
      tension: 0.1,
      danger: 0,
      momentum: 0.3,
      complexity: 0.42,
      brightness: 0.62,
      triumph: 0.5,
      calm: 0.7,
      narrativeArc: 0.08,
    });
    this.audio.startMusic('menu');
  }

  update(_dt: number): void {
    if (!this.active) return;
    this.audio.setMusicState({ calm: 0.7, intensity: 0.22, danger: 0 });
  }

  stop(): void {
    this.active = false;
    this.audio.stopMusic();
    this.audio.setAdaptiveEnabled(false);
    this.audio.resetMusicState();
  }
}
