import type { MusicLayerName } from '../types';
import { EventAccumulator, type EventAggregateMap } from './event-accumulator';
import { HysteresisGate } from './hysteresis';
import type { InstrumentRack } from './instrument-rack';
import { SeededRandom } from './seeded-random';
import { DEFAULT_MUSIC_STATE, MusicStateController } from './state';
import { MusicTransport, type ScheduledStep } from './transport';
import type { GameMusicEventName, MusicState, MusicalSection } from './types';

const LAYERS: readonly MusicLayerName[] = ['drums', 'bass', 'harmony', 'arp', 'lead', 'fx', 'brass', 'vox'];

const clamp01 = (value: number): number => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

const weighted = (...values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0);

export interface AdaptiveLayerValue {
  presence: number;
  brightness: number;
}

export type AdaptiveLayerProfile = Record<MusicLayerName, AdaptiveLayerValue>;

export interface AdaptiveDirectorOptions {
  seed?: number;
  state?: MusicStateController;
}

/**
 * Transforme un état musical lissé en décisions de mix quantifiées.
 *
 * Le directeur ne crée pas de notes et ne remplace pas une composition : il
 * agit sur les couches déjà écrites, aux frontières de mesure et de phrase.
 */
export class AdaptiveDirector {
  readonly state: MusicStateController;
  readonly events = new EventAccumulator();

  active = false;
  section: MusicalSection = 'intro';
  variationIndex = 0;

  private readonly random: SeededRandom;
  private readonly arpGate = new HysteresisGate(0.34, 0.18);
  private readonly leadGate = new HysteresisGate(0.56, 0.38);
  private readonly fxGate = new HysteresisGate(0.62, 0.42);
  private readonly dangerGate = new HysteresisGate(0.65, 0.45);
  private readonly brassGate = new HysteresisGate(0.4, 0.25);
  private readonly voxGate = new HysteresisGate(0.45, 0.3);
  private unsubscribeBar: (() => void) | null = null;
  private lastPhrase = 0;

  constructor(
    private readonly transport: MusicTransport,
    private readonly rack: InstrumentRack,
    options: AdaptiveDirectorOptions = {},
  ) {
    this.state = options.state ?? new MusicStateController(DEFAULT_MUSIC_STATE);
    this.random = new SeededRandom(options.seed);
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.lastPhrase = 0;
    this.unsubscribeBar = this.transport.onBar((step) => this.applyAtBar(step));
  }

  stop(): void {
    this.active = false;
    this.unsubscribeBar?.();
    this.unsubscribeBar = null;
    this.events.reset();
    this.lastPhrase = 0;
    this.variationIndex = 0;
    this.section = 'intro';
    this.arpGate.reset();
    this.leadGate.reset();
    this.fxGate.reset();
    this.dangerGate.reset();
    this.brassGate.reset();
    this.voxGate.reset();
    this.rack.resetLayers(this.transport.running ? this.transport.nextStepTime() : undefined);
  }

  update(dt: number): MusicState {
    this.events.update(dt);
    this.state.setEventOffsets(this.eventOffsets(this.events.snapshot()));
    return this.state.update(dt);
  }

  setState(partial: Partial<MusicState>): void {
    this.state.setState(partial);
  }

  resetState(): void {
    this.state.reset();
  }

  event(type: GameMusicEventName, strength = 1, value = 0): void {
    this.events.push(type, strength, value);
  }

  snapshot(): MusicState {
    return this.state.snapshot();
  }

  targetSnapshot(): MusicState {
    return this.state.targetSnapshot();
  }

  private applyAtBar(step: ScheduledStep): void {
    if (!this.active) return;

    if (step.phrase !== this.lastPhrase) {
      const activity = this.totalPendingActivity(this.events.consumePending());
      this.variationIndex = activity >= 8 ? this.random.int(1, 2) : this.random.int(0, 1);
      this.lastPhrase = step.phrase;
    } else {
      this.events.consumePending();
    }

    const state = this.state.snapshot();
    this.section = this.chooseSection(state);
    const profile = this.profileFor(state);
    for (const layer of LAYERS) {
      this.rack.setLayerPresence(layer, profile[layer].presence, step.time);
      this.rack.setLayerBrightness(layer, profile[layer].brightness, step.time);
    }
  }

  private profileFor(state: MusicState): AdaptiveLayerProfile {
    const danger = this.dangerGate.update(state.danger);
    const arpSignal = weighted(state.complexity * 0.6, state.momentum * 0.25, state.intensity * 0.15);
    const leadSignal = weighted(state.brightness * 0.42, state.intensity * 0.28, state.tension * 0.12, state.triumph * 0.4);
    const fxSignal = weighted(state.triumph * 0.55, state.danger * 0.25, state.narrativeArc * 0.2);
    const brassSignal = weighted(state.triumph * 0.7, state.brightness * 0.3);
    const voxSignal = weighted(state.triumph * 0.9, state.narrativeArc * 0.2);
    const arp = this.arpGate.update(arpSignal);
    const lead = this.leadGate.update(leadSignal);
    const fx = this.fxGate.update(fxSignal);
    const brass = this.brassGate.update(brassSignal);
    const vox = this.voxGate.update(voxSignal);
    const sectionPresence = this.section === 'peak' ? 1 : this.section === 'build' ? 0.92 : this.section === 'release' ? 0.74 : 0.84;
    const variationBias = this.variationIndex === 1 ? 0.025 : this.variationIndex === 2 ? -0.02 : 0;

    return {
      drums: {
        presence: clamp01(0.82 + state.intensity * 0.12 + (danger ? 0.06 : 0)),
        brightness: clamp01(0.3 + state.brightness * 0.42 + state.danger * 0.16),
      },
      bass: {
        presence: clamp01(0.76 + state.intensity * 0.2 + state.momentum * 0.04),
        brightness: clamp01(0.25 + state.tension * 0.38 + state.brightness * 0.18),
      },
      harmony: {
        presence: clamp01(0.62 + state.calm * 0.25 - state.tension * 0.08),
        brightness: clamp01(0.24 + state.calm * 0.34 + state.brightness * 0.25),
      },
      arp: {
        presence: arp ? clamp01(sectionPresence * (0.18 + state.complexity * 0.7 + state.momentum * 0.12)) : 0,
        brightness: clamp01(0.34 + state.brightness * 0.45 + state.complexity * 0.16 + variationBias),
      },
      lead: {
        presence: lead ? clamp01(sectionPresence * (0.2 + state.brightness * 0.45 + state.triumph * 0.25)) : 0,
        brightness: clamp01(0.4 + state.brightness * 0.42 + state.triumph * 0.15 + variationBias),
      },
      fx: {
        presence: fx ? clamp01(0.15 + state.triumph * 0.55 + state.narrativeArc * 0.2) : 0,
        brightness: clamp01(0.36 + state.brightness * 0.38 + state.danger * 0.18 + variationBias),
      },
      brass: {
        presence: brass ? clamp01(sectionPresence * (0.25 + state.triumph * 0.6)) : 0,
        brightness: clamp01(0.4 + state.brightness * 0.4 + state.triumph * 0.15 + variationBias),
      },
      vox: {
        presence: vox ? clamp01(sectionPresence * (0.2 + state.triumph * 0.65)) : 0,
        brightness: clamp01(0.4 + state.brightness * 0.4 + state.triumph * 0.15 + variationBias),
      },
    };
  }

  private chooseSection(state: MusicState): MusicalSection {
    const pressure = weighted(
      state.intensity * 0.35,
      state.tension * 0.25,
      state.danger * 0.25,
      state.momentum * 0.15,
    );
    if (state.narrativeArc < 0.18 && pressure < 0.36) return 'intro';
    if (state.calm > 0.72 && pressure < 0.36) return 'release';
    if (pressure >= 0.78) return 'peak';
    if (pressure >= 0.5) return 'build';
    return 'groove';
  }

  private eventOffsets(events: EventAggregateMap): Partial<MusicState> {
    const energy = (name: GameMusicEventName): number => Math.min(1, events[name].energy / 5);
    const count = (name: GameMusicEventName): number => Math.min(1, events[name].count / 8);
    const danger = weighted(energy('playerHit') * 0.24, energy('nearMiss') * 0.18, energy('miss') * 0.14, energy('bossStart') * 0.32);
    const intensity = weighted(
      energy('enemyKilled') * 0.08,
      energy('combo') * 0.14,
      energy('playerHit') * 0.08,
      energy('bossStart') * 0.2,
      energy('waveStart') * 0.08,
    );
    const momentum = weighted(count('enemyKilled') * 0.15, count('combo') * 0.22, count('brickCombo') * 0.18, count('perfect') * 0.16);
    const triumph = weighted(energy('waveComplete') * 0.25, energy('bossDefeated') * 0.45, energy('newHighScore') * 0.35, energy('holeInOne') * 0.4, energy('fishCaught') * 0.2);
    const brightness = weighted(energy('powerUp') * 0.12, energy('perfect') * 0.1, triumph * 0.16);
    const tension = weighted(danger * 0.55, energy('comboBreak') * 0.16, energy('miss') * 0.12);
    const complexity = weighted(momentum * 0.22, count('combo') * 0.12, energy('powerUp') * 0.1);
    return {
      intensity: Math.min(0.45, intensity),
      tension: Math.min(0.38, tension),
      danger: Math.min(0.5, danger),
      momentum: Math.min(0.42, momentum),
      complexity: Math.min(0.3, complexity),
      brightness: Math.min(0.28, brightness),
      triumph: Math.min(0.5, triumph),
    };
  }

  private totalPendingActivity(events: EventAggregateMap): number {
    return Object.values(events).reduce((sum, event) => sum + event.count, 0);
  }
}
