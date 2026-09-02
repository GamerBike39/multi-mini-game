export const ACTIONS = [
  'a', 'b', 'x', 'y',
  'up', 'down', 'left', 'right',
  'start', 'select', 'back', 'lb', 'rb',
] as const;

export type Action = (typeof ACTIONS)[number];

export const VOLUME_KEYS = ['master', 'music', 'sfx'] as const;
export type VolumeKey = (typeof VOLUME_KEYS)[number];

export interface ActionState {
  down: boolean;
  pressed: boolean;
  released: boolean;
}

export type ActionMap = Record<Action, ActionState>;

export interface InputTap {
  t: number;
  a: Action;
}

export interface GameMeta {
  id: string;
  name: string;
  accent: string;
  mood: string;
  desc: string;
  controls: string;
  keys?: string;
  hint: string;
  unit: string;
  ranks: readonly number[];
}

export interface InputLike {
  moveX: number;
  moveY: number;
  aimX: number;
  aimY: number;
  padConnected: boolean;
  vibration: boolean;
  gesture(): void;
  down(action: Action): boolean;
  pressed(action: Action): boolean;
  key(code: string): boolean;
  clearEdges(): void;
  absorb(): void;
  rumble(strength?: number, duration?: number): void;
}

export interface ToneLikeOptions {
  f?: number;
  f1?: number;
  type?: OscillatorType;
  t?: number;
  dur?: number;
  vol?: number;
  attack?: number;
  dest?: AudioNode | null;
}

export interface NoiseLikeOptions {
  t?: number;
  dur?: number;
  vol?: number;
  f?: number;
  f1?: number;
  type?: BiquadFilterType;
  q?: number;
  dest?: AudioNode | null;
}

export interface ThumpLikeOptions {
  f0?: number;
  f1?: number;
  dur?: number;
}

export interface TrackLikeOptions {
  countIn?: number;
  bpm?: number;
}

export interface AudioLike {
  ctx: AudioContext | null;
  muted: boolean;
  vols: Record<VolumeKey, number>;
  unlock(): void;
  suspend(): void;
  resume(): void;
  startMusic(name: string, options?: Record<string, unknown>): void;
  stopMusic(): void;
  setVol(key: VolumeKey, value: number): void;
  setMuted(muted: boolean): void;
  tone(options?: ToneLikeOptions): void;
  noise(options?: NoiseLikeOptions): void;
  thump(vol?: number, options?: ThumpLikeOptions): void;
  beat(): number;
  uiMove(): void;
  uiOk(): void;
  uiBack(): void;
  jump(): void;
  land(): void;
  dash(): void;
  shoot(): void;
  hitEnemy(): void;
  hurt(): void;
  coin(step?: number): void;
  perfect(): void;
  good(): void;
  milestone(): void;
  whiff(): void;
  miss(): void;
  explode(big?: number): void;
  musicOn: boolean;
  trackMode: boolean;
  startTrack(buffer: AudioBuffer, options?: TrackLikeOptions): void;
  pauseTrack(): void;
  resumeTrack(): void;
  trackPos(): number;
  songTime(): number;
  drum(kind: string, t: number): void;
}

export interface SettingsLike {
  active: boolean;
  update(dt: number): boolean;
  open(): void;
  draw(ctx: CanvasRenderingContext2D, accent?: string): void;
  onPointer(x: number, y: number): void | boolean;
  onPointerMove(x: number, y: number): void | boolean;
  onPointerUp(): void;
}

export interface FxLike {
  timeScale: number;
  shake(amount: number): void;
  stop(seconds: number): void;
  consume(dt: number): number;
  update(dt: number): void;
  cosmetic(dt: number): void;
  drawFlash(ctx: CanvasRenderingContext2D): void;
}

export interface AppLike {
  engine?: EngineLike;
  accent?: string;
  fx?: FxLike;
  paused?: boolean;
  cursor?: string;
  enter?(): void;
  exit?(): void;
  update(dt: number): void;
  render(ctx: CanvasRenderingContext2D): void;
  onPauseChange?(paused: boolean): void;
  onPointer?(x: number, y: number): void;
  onPointerMove?(x: number, y: number): void;
  onPointerUp?(): void;
  onPointerLeave?(): void;
}

export interface GameConstructor {
  new (engine: EngineLike): AppLike;
  meta: GameMeta;
}

export interface EngineLike {
  input: InputLike;
  audio: AudioLike;
  settings: SettingsLike;
  setApp(app: AppLike): void;
  menuBack(): void;
  toggleFullscreen(): void;
}
