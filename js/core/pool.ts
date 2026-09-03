export class ObjectPool<T extends object> {
  readonly active: T[] = [];
  readonly free: T[] = [];
  private readonly indices = new Map<T, number>();

  constructor(
    private readonly factory: () => T,
    initialSize = 0,
  ) {
    for (let i = 0; i < initialSize; i++) this.free.push(factory());
  }

  acquire(): T {
    const value = this.free.pop() || this.factory();
    this.indices.set(value, this.active.length);
    this.active.push(value);
    return value;
  }

  release(value: T): boolean {
    const index = this.indices.get(value);
    if (index === undefined) return false;
    this.releaseAt(index);
    return true;
  }

  releaseAt(index: number): T | null {
    if (index < 0 || index >= this.active.length) return null;
    const lastIndex = this.active.length - 1;
    const value = this.active[index];
    const last = this.active[lastIndex];
    if (index !== lastIndex) {
      this.active[index] = last;
      this.indices.set(last, index);
    }
    this.active.pop();
    this.indices.delete(value);
    this.free.push(value);
    return value;
  }

  has(value: T): boolean {
    return this.indices.has(value);
  }

  clear(): void {
    while (this.active.length) {
      const value = this.active.pop();
      if (!value) continue;
      this.indices.delete(value);
      this.free.push(value);
    }
  }

  forEach(callback: (value: T, index: number) => void): void {
    for (let i = 0; i < this.active.length; i++) callback(this.active[i], i);
  }

  get size(): number {
    return this.active.length;
  }
}
