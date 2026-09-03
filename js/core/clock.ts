export const FIXED_STEP = 1 / 60;

export interface ClockAdvanceResult {
  steps: number;
  droppedSteps: number;
  frameDt: number;
  accumulator: number;
}

export interface FixedClockOptions {
  step?: number;
  maxSteps?: number;
  maxFrameDt?: number;
  maxAccumulator?: number;
}

/** Horloge de simulation fixe, indépendante de la fréquence de rendu. */
export class FixedClock {
  readonly step: number;
  readonly maxSteps: number;
  readonly maxFrameDt: number;
  readonly maxAccumulator: number;
  accumulator = 0;
  totalSteps = 0;
  totalDroppedSteps = 0;
  realTime = 0;
  simulatedTime = 0;

  constructor(options: FixedClockOptions = {}) {
    this.step = options.step ?? FIXED_STEP;
    this.maxSteps = options.maxSteps ?? 4;
    this.maxFrameDt = options.maxFrameDt ?? 0.08;
    this.maxAccumulator = options.maxAccumulator ?? this.step * this.maxSteps;
  }

  reset(): void {
    this.accumulator = 0;
    this.totalSteps = 0;
    this.totalDroppedSteps = 0;
    this.realTime = 0;
    this.simulatedTime = 0;
  }

  advance(elapsed: number, callback: (dt: number, step: number) => void): ClockAdvanceResult {
    const requestedDt = Number.isFinite(elapsed) && elapsed > 0 ? elapsed : 0;
    this.realTime += requestedDt;
    const frameDt = Math.min(requestedDt, this.maxFrameDt);
    this.accumulator += frameDt;

    let steps = 0;
    while (this.accumulator >= this.step && steps < this.maxSteps) {
      this.accumulator -= this.step;
      callback(this.step, this.totalSteps++);
      this.simulatedTime += this.step;
      steps++;
    }

    // Une frame réellement perdue ne doit pas être silencieusement transformée
    // en retard de simulation : elle est comptée pour le diagnostic puis
    // l'accumulateur reste borné afin d'éviter la spirale de rattrapage.
    let droppedSteps = Math.max(0, Math.floor((requestedDt - frameDt) / this.step));
    if (this.accumulator > this.maxAccumulator) {
      const overflowSteps = Math.ceil((this.accumulator - this.maxAccumulator) / this.step);
      droppedSteps += overflowSteps;
      this.accumulator = Math.max(0, this.accumulator - overflowSteps * this.step);
    }
    this.totalDroppedSteps += droppedSteps;

    return { steps, droppedSteps, frameDt, accumulator: this.accumulator };
  }
}
