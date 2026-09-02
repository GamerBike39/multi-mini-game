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

export type Quantization = 'beat' | 'bar' | '2bars' | '4bars' | 'phrase';

export type MusicalSection = 'intro' | 'groove' | 'build' | 'peak' | 'release';

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

export interface MusicStartOptions {
  seed?: number;
  bpm?: number;
  intensity?: number;
}

export type GameMusicEventName =
  | 'playerHit'
  | 'enemyKilled'
  | 'combo'
  | 'comboBreak'
  | 'nearMiss'
  | 'powerUp'
  | 'waveStart'
  | 'waveComplete'
  | 'bossStart'
  | 'bossDefeated'
  | 'perfect'
  | 'miss'
  | 'fishBite'
  | 'fishCaught'
  | 'holeInOne'
  | 'brickCombo'
  | 'newHighScore';

export interface GameMusicEvent {
  type: GameMusicEventName;
  strength?: number;
  value?: number;
}

export interface MusicalEvent {
  time: number;
  beat: number;
  bar: number;
  type: 'kick' | 'snare' | 'hat' | 'bass' | 'lead' | 'chord' | 'accent';
  strength: number;
}

export interface MusicEnginePublicApi {
  init(): Promise<void> | void;
  start(game: GameMusic, options?: MusicStartOptions): void;
  startReference(reference: ReferenceMusic): void;
  stop(): void;
  pause(): void;
  resume(): void;

  transitionTo(game: GameMusic, quantization?: Quantization): void;

  setState(state: Partial<MusicState>): void;
  setIntensity(value: number): void;
  setDanger(value: number): void;
  setTempoMultiplier(value: number): void;
  setVolume(value: number): void;

  event(type: GameMusicEventName, payload?: Omit<GameMusicEvent, 'type'>): void;

  getBpm(): number;
  getBeat(): number;
  getBar(): number;
  getStep(): number;
  getPhrase(): number;
  getTransportTime(): number;

  onBeat(callback: (beat: number, time: number) => void): () => void;
  onBar(callback: (bar: number, time: number) => void): () => void;
}
