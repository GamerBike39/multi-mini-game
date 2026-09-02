/** Petit générateur déterministe réservé aux variations musicales. */
export class SeededRandom {
  private state: number;

  constructor(seed = 0x4d555349) {
    this.state = (seed >>> 0) || 0x1;
  }

  next(): number {
    this.state = (this.state * 1664525 + 1013904223) >>> 0;
    return this.state / 0x100000000;
  }

  float(min = 0, max = 1): number {
    return min + (max - min) * this.next();
  }

  int(min: number, max: number): number {
    const low = Math.ceil(Math.min(min, max));
    const high = Math.floor(Math.max(min, max));
    return low + Math.floor(this.next() * Math.max(1, high - low + 1));
  }

  pick<T>(values: readonly T[]): T | undefined {
    if (!values.length) return undefined;
    return values[this.int(0, values.length - 1)];
  }
}
