import type { Rng } from './types';

/** RNG déterministe réservé à l'état de simulation d'une session. */
export class SeededRng implements Rng {
  private state: number;

  constructor(seed = 0x424c4f42) {
    this.state = (seed >>> 0) || 0x1;
  }

  next(): number {
    // Mulberry32 : rapide, suffisamment homogène pour des jeux arcade et stable
    // entre navigateurs, contrairement à Math.random().
    let value = (this.state += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
  }

  float(min = 0, max = 1): number {
    return min + (max - min) * this.next();
  }

  int(min: number, max: number): number {
    const low = Math.ceil(Math.min(min, max));
    const high = Math.floor(Math.max(min, max));
    return low + Math.floor(this.next() * Math.max(1, high - low + 1));
  }

  pick<T>(items: readonly T[]): T {
    if (!items.length) throw new Error('SeededRng.pick() appelé avec une liste vide.');
    return items[this.int(0, items.length - 1)];
  }

  fork(salt: number): SeededRng {
    const child = new SeededRng(this.state ^ (salt >>> 0));
    child.next();
    return child;
  }
}
