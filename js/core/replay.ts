import { ACTIONS, type ReplayFrame, type ReplayPlayerFrame, type ReplayTrace } from './types';

export const REPLAY_VERSION = 1 as const;

export function actionMask(actions: readonly string[]): number {
  let mask = 0;
  for (const action of actions) {
    const index = ACTIONS.indexOf(action as (typeof ACTIONS)[number]);
    if (index >= 0) mask |= 1 << index;
  }
  return mask >>> 0;
}

export function hasAction(mask: number, action: (typeof ACTIONS)[number]): boolean {
  const index = ACTIONS.indexOf(action);
  return index >= 0 && (mask & (1 << index)) !== 0;
}

export function quantizeAxis(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-1, Math.min(1, value));
}

export interface ReplayValidationOptions {
  gameId: string;
  buildVersion: string;
  playerCount: number;
  fixedStep: number;
}

const ACTION_MASK = (1 << ACTIONS.length) - 1;

function validMask(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= 0
    && value <= ACTION_MASK;
}

function validAxis(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= -1 && value <= 1;
}

export function validateReplay(trace: unknown, options: ReplayValidationOptions): ReplayTrace {
  if (!trace || typeof trace !== 'object') throw new Error('Trace de replay invalide.');
  const value = trace as Partial<ReplayTrace>;
  if (value.version !== REPLAY_VERSION) throw new Error('Version de replay non supportée.');
  if (value.gameId !== options.gameId) throw new Error('Cette trace appartient à un autre jeu.');
  if (value.buildVersion !== options.buildVersion) throw new Error('Trace incompatible avec cette version du jeu.');
  if (typeof value.seed !== 'number' || !Number.isInteger(value.seed) || value.seed < 0 || value.seed > 0xffffffff) {
    throw new Error('Seed de replay invalide.');
  }
  if (typeof value.playerCount !== 'number' || !Number.isInteger(value.playerCount) || value.playerCount < 1 || value.playerCount > 4
    || value.playerCount !== options.playerCount) {
    throw new Error('Nombre de joueurs incompatible avec la trace.');
  }
  if (typeof value.fixedStep !== 'number' || !Number.isFinite(value.fixedStep)
    || Math.abs(value.fixedStep - options.fixedStep) > 1e-9) {
    throw new Error('Pas fixe incompatible avec la trace.');
  }
  if (!Array.isArray(value.frames)) throw new Error('Frames de replay absentes.');

  for (let i = 0; i < value.frames.length; i++) {
    const frame = value.frames[i] as Partial<ReplayFrame> | undefined;
    if (!frame || !Number.isInteger(frame.step) || frame.step !== i
      || !Array.isArray(frame.players) || frame.players.length !== options.playerCount) {
      throw new Error('Frame de replay invalide à l’étape ' + i + '.');
    }
    for (const player of frame.players as readonly Partial<ReplayPlayerFrame>[]) {
      if (!player || !validMask(player.downMask) || !validMask(player.pressedMask)
        || !validMask(player.releasedMask) || !validAxis(player.moveX)
        || !validAxis(player.moveY) || !validAxis(player.aimX) || !validAxis(player.aimY)) {
        throw new Error('État joueur invalide dans la frame ' + i + '.');
      }
    }
  }

  return value as ReplayTrace;
}

export class ReplayRecorder {
  readonly frames: ReplayFrame[] = [];
  private startStep: number | null = null;

  constructor(
    readonly gameId: string,
    readonly seed: number,
    readonly playerCount: number,
    readonly buildVersion: string,
    readonly fixedStep: number,
  ) {}

  push(step: number, players: readonly ReplayPlayerFrame[]): void {
    if (!Number.isInteger(step) || step < 0) throw new Error('Étape de replay invalide.');
    if (players.length !== this.playerCount) throw new Error('Nombre de joueurs invalide dans le replay.');
    if (this.startStep === null) this.startStep = step;
    const relativeStep = step - this.startStep;
    if (relativeStep !== this.frames.length) throw new Error('Étapes de replay non contiguës.');
    this.frames.push({
      step: relativeStep,
      players: players.map((player) => ({ ...player })),
    });
  }

  finish(): ReplayTrace {
    return {
      version: REPLAY_VERSION,
      gameId: this.gameId,
      seed: this.seed,
      fixedStep: this.fixedStep,
      playerCount: this.playerCount,
      buildVersion: this.buildVersion,
      frames: this.frames.slice(),
    };
  }
}

export class ReplayPlayer {
  index = 0;

  constructor(readonly trace: ReplayTrace) {}

  next(): ReplayFrame | null {
    const frame = this.trace.frames[this.index];
    if (!frame) return null;
    this.index++;
    return frame;
  }

  reset(): void {
    this.index = 0;
  }
}
