import type { GameMusicEventName } from './types';

export const GAME_MUSIC_EVENT_NAMES: readonly GameMusicEventName[] = [
  'playerHit',
  'enemyKilled',
  'combo',
  'comboBreak',
  'nearMiss',
  'powerUp',
  'waveStart',
  'waveComplete',
  'bossStart',
  'bossDefeated',
  'perfect',
  'miss',
  'fishBite',
  'fishCaught',
  'holeInOne',
  'brickCombo',
  'newHighScore',
];

export interface EventAggregate {
  count: number;
  energy: number;
  value: number;
}

export type EventAggregateMap = Record<GameMusicEventName, EventAggregate>;

const emptyAggregate = (): EventAggregate => ({ count: 0, energy: 0, value: 0 });

const createMap = (): EventAggregateMap => Object.fromEntries(
  GAME_MUSIC_EVENT_NAMES.map((name) => [name, emptyAggregate()]),
) as EventAggregateMap;

const copyMap = (source: EventAggregateMap): EventAggregateMap => Object.fromEntries(
  GAME_MUSIC_EVENT_NAMES.map((name) => [name, { ...source[name] }]),
) as EventAggregateMap;

const clampStrength = (value: number | undefined): number =>
  Math.max(0, Math.min(2, typeof value === 'number' && Number.isFinite(value) ? value : 1));

/** Agrège les événements rapides afin que le directeur ne réagisse pas à chaque frappe. */
export class EventAccumulator {
  private readonly pending = createMap();
  private readonly rolling = createMap();

  push(type: GameMusicEventName, strength = 1, value = 0): void {
    const safeStrength = clampStrength(strength);
    const safeValue = Number.isFinite(value) ? value : 0;
    for (const bucket of [this.pending[type], this.rolling[type]]) {
      bucket.count += 1;
      bucket.energy += safeStrength;
      bucket.value += safeValue * safeStrength;
    }
  }

  update(dt: number): void {
    const safeDt = Math.max(0, Math.min(0.25, Number.isFinite(dt) ? dt : 0));
    if (safeDt <= 0) return;
    const decay = Math.exp(-safeDt / 2.4);
    for (const name of GAME_MUSIC_EVENT_NAMES) {
      this.rolling[name].count *= decay;
      this.rolling[name].energy *= decay;
      this.rolling[name].value *= decay;
    }
  }

  snapshot(): EventAggregateMap {
    return copyMap(this.rolling);
  }

  consumePending(): EventAggregateMap {
    const result = copyMap(this.pending);
    for (const name of GAME_MUSIC_EVENT_NAMES) this.pending[name] = emptyAggregate();
    return result;
  }

  reset(): void {
    for (const name of GAME_MUSIC_EVENT_NAMES) {
      this.pending[name] = emptyAggregate();
      this.rolling[name] = emptyAggregate();
    }
  }
}
