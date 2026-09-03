import type { Aabb } from './physics';

export class SpatialHash<T extends { id: number }> {
  private readonly buckets = new Map<string, T[]>();
  private readonly seen = new Set<number>();
  private readonly reusableResults: T[] = [];

  constructor(readonly cellSize = 64) {}

  clear(): void {
    for (const bucket of this.buckets.values()) bucket.length = 0;
  }

  remove(value: T): void {
    for (const bucket of this.buckets.values()) {
      for (let i = bucket.length - 1; i >= 0; i--) {
        if (bucket[i] === value) bucket.splice(i, 1);
      }
    }
  }

  private key(x: number, y: number): string {
    return x + ':' + y;
  }

  insert(value: T, minX: number, minY: number, maxX: number, maxY: number): void {
    const x0 = Math.floor(minX / this.cellSize);
    const y0 = Math.floor(minY / this.cellSize);
    const x1 = Math.floor(maxX / this.cellSize);
    const y1 = Math.floor(maxY / this.cellSize);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const key = this.key(x, y);
        let bucket = this.buckets.get(key);
        if (!bucket) {
          bucket = [];
          this.buckets.set(key, bucket);
        }
        bucket.push(value);
      }
    }
  }

  queryAabb(minX: number, minY: number, maxX: number, maxY: number, output?: T[]): readonly T[] {
    const result = output || this.reusableResults;
    result.length = 0;
    this.seen.clear();
    const x0 = Math.floor(minX / this.cellSize);
    const y0 = Math.floor(minY / this.cellSize);
    const x1 = Math.floor(maxX / this.cellSize);
    const y1 = Math.floor(maxY / this.cellSize);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const bucket = this.buckets.get(this.key(x, y));
        if (!bucket) continue;
        for (const value of bucket) {
          if (this.seen.has(value.id)) continue;
          this.seen.add(value.id);
          result.push(value);
        }
      }
    }
    return result;
  }

  query(area: Aabb, output?: T[]): readonly T[] {
    return this.queryAabb(area.x, area.y, area.x + area.w, area.y + area.h, output);
  }

  debugRender(ctx: CanvasRenderingContext2D, color = '#a78bfa55'): void {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    for (const [key, bucket] of this.buckets) {
      if (!bucket.length) continue;
      const separator = key.indexOf(':');
      const x = Number(key.slice(0, separator)) * this.cellSize;
      const y = Number(key.slice(separator + 1)) * this.cellSize;
      ctx.strokeRect(x, y, this.cellSize, this.cellSize);
    }
    ctx.restore();
  }
}
