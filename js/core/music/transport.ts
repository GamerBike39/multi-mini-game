// Transport musical pur : aucune création de node et aucun déclenchement audio.
// Le timer JavaScript ne fait qu'alimenter un horizon ; l'horloge de référence
// reste le temps AudioContext transmis par l'appelant.

export const STEPS_PER_BEAT = 4;
export const BEATS_PER_BAR = 4;
export const STEPS_PER_BAR = STEPS_PER_BEAT * BEATS_PER_BAR;
export const DEFAULT_LOOKAHEAD = 0.2;
export const DEFAULT_EVENT_EPSILON = 0.02;

export interface ScheduledStep {
  time: number;
  absoluteStep: number;
  stepInBar: number;
  bar: number;
  phrase: number;
}

export type StepCallback = (step: ScheduledStep) => void;

export interface TransportState {
  bpm: number;
  time: number;
  beat: number;
  bar: number;
  step: number;
  phrase: number;
  stepInBar: number;
  paused: boolean;
  running: boolean;
}

const positive = (value: number, fallback: number): number =>
  Number.isFinite(value) && value > 0 ? value : fallback;

/**
 * Horloge musicale déterministe, indépendante de l'AudioContext.
 * `now` correspond à `AudioContext.currentTime` en production.
 */
export class MusicTransport {
  bpm = 120;
  startTime = 0;
  absoluteStep = 0;
  paused = false;
  running = false;

  private pausedTime = 0;

  get beatDuration(): number {
    return 60 / positive(this.bpm, 120);
  }

  get stepDuration(): number {
    return this.beatDuration / STEPS_PER_BEAT;
  }

  start(bpm: number, startTime: number): void {
    this.bpm = positive(bpm, 120);
    this.startTime = Number.isFinite(startTime) ? startTime : 0;
    this.absoluteStep = 0;
    this.pausedTime = 0;
    this.paused = false;
    this.running = true;
  }

  stop(): void {
    this.running = false;
    this.paused = false;
    this.absoluteStep = 0;
    this.pausedTime = 0;
  }

  /**
   * Programme tous les pas dont le timestamp est dans [now - epsilon, horizon).
   * Le callback reçoit toujours un timestamp futur ou très légèrement passé,
   * jamais un appel "joue maintenant" déduit du timer JS.
   */
  scheduleAhead(
    now: number,
    lookahead = DEFAULT_LOOKAHEAD,
    callback: StepCallback,
    epsilon = DEFAULT_EVENT_EPSILON,
  ): void {
    if (!this.running || this.paused) return;
    const currentTime = Number.isFinite(now) ? now : 0;
    const horizon = currentTime + Math.max(0, lookahead);
    const tolerance = Math.max(0, epsilon);

    while (this.nextStepTime() < horizon) {
      const absoluteStep = this.absoluteStep;
      const stepInBar = (absoluteStep % STEPS_PER_BAR) + 1;
      const bar = Math.floor(absoluteStep / STEPS_PER_BAR) + 1;
      const phrase = Math.floor((bar - 1) / 4) + 1;
      const time = this.nextStepTime();
      if (time >= currentTime - tolerance) callback({ time, absoluteStep, stepInBar, bar, phrase });
      this.absoluteStep++;
    }
  }

  /** Met le transport en pause en conservant sa position musicale. */
  pause(now: number): void {
    if (!this.running || this.paused) return;
    this.pausedTime = Math.max(0, (Number.isFinite(now) ? now : 0) - this.startTime);
    this.paused = true;
  }

  /**
   * Reprend sans rattraper les pas manqués : les événements repartent depuis
   * le prochain pas musical, ce qui évite une rafale après un onglet suspendu.
   */
  resume(now: number): void {
    if (!this.running || !this.paused) return;
    const currentTime = Number.isFinite(now) ? now : 0;
    this.startTime = currentTime - this.pausedTime;
    this.absoluteStep = Math.max(0, Math.floor(this.pausedTime / this.stepDuration) + 1);
    this.paused = false;
  }

  nextStepTime(): number {
    return this.startTime + this.absoluteStep * this.stepDuration;
  }

  transportTime(now: number): number {
    if (this.paused) return this.pausedTime;
    return (Number.isFinite(now) ? now : 0) - this.startTime;
  }

  beatAt(now: number): number {
    return this.transportTime(now) / this.beatDuration;
  }

  stepAt(now: number): number {
    return Math.max(0, Math.floor(this.beatAt(now) * STEPS_PER_BEAT));
  }

  barAt(now: number): number {
    return Math.floor(this.stepAt(now) / STEPS_PER_BAR) + 1;
  }

  phraseAt(now: number): number {
    return Math.floor((this.barAt(now) - 1) / 4) + 1;
  }

  stateAt(now: number): TransportState {
    const step = this.stepAt(now);
    const bar = Math.floor(step / STEPS_PER_BAR) + 1;
    return {
      bpm: this.bpm,
      time: this.transportTime(now),
      beat: this.beatAt(now),
      bar,
      step,
      phrase: Math.floor((bar - 1) / 4) + 1,
      stepInBar: (step % STEPS_PER_BAR) + 1,
      paused: this.paused,
      running: this.running,
    };
  }
}
