/** Petits systèmes sans dépendance pour les jeux à grille, à défilement et à phases. */

export class GridSystem<T> {
  readonly cells: T[];

  constructor(
    readonly columns: number,
    readonly rows: number,
    fill: T | (() => T),
  ) {
    const count = Math.max(0, Math.floor(columns) * Math.floor(rows));
    this.cells = new Array<T>(count);
    if (typeof fill === 'function') {
      const factory = fill as () => T;
      for (let i = 0; i < count; i++) this.cells[i] = factory();
    } else {
      this.cells.fill(fill);
    }
  }

  index(x: number, y: number): number {
    return y * this.columns + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.columns && y >= 0 && y < this.rows;
  }

  get(x: number, y: number): T | undefined {
    return this.inBounds(x, y) ? this.cells[this.index(x, y)] : undefined;
  }

  set(x: number, y: number, value: T): boolean {
    if (!this.inBounds(x, y)) return false;
    this.cells[this.index(x, y)] = value;
    return true;
  }

  fill(value: T): void {
    this.cells.fill(value);
  }

  forEach(callback: (value: T, x: number, y: number, index: number) => void): void {
    for (let index = 0; index < this.cells.length; index++) {
      callback(this.cells[index], index % this.columns, Math.floor(index / this.columns), index);
    }
  }
}

export class Scroller {
  offset = 0;

  constructor(
    public speed = 0,
    public length = 1,
  ) {}

  update(dt: number): number {
    if (dt > 0 && Number.isFinite(dt)) this.offset += this.speed * dt;
    return this.value();
  }

  value(): number {
    if (!(this.length > 0)) return this.offset;
    return ((this.offset % this.length) + this.length) % this.length;
  }

  reset(offset = 0): void {
    this.offset = Number.isFinite(offset) ? offset : 0;
  }
}

export type PhaseEnter<T extends string> = (next: T, previous: T) => void;
export type PhaseExit<T extends string> = (previous: T, next: T) => void;

export class PhaseMachine<T extends string> {
  elapsed = 0;

  constructor(
    public current: T,
    private readonly onEnter?: PhaseEnter<T>,
    private readonly onExit?: PhaseExit<T>,
  ) {}

  is(phase: T): boolean {
    return this.current === phase;
  }

  set(next: T): boolean {
    if (next === this.current) return false;
    const previous = this.current;
    this.onExit?.(previous, next);
    this.current = next;
    this.elapsed = 0;
    this.onEnter?.(next, previous);
    return true;
  }

  update(dt: number): number {
    if (dt > 0 && Number.isFinite(dt)) this.elapsed += dt;
    return this.elapsed;
  }

  reset(phase = this.current): void {
    this.current = phase;
    this.elapsed = 0;
  }
}
