// Instruments musicaux WebAudio natifs.
//
// Le rack ne connaît ni les jeux ni l'adaptation : il reçoit uniquement des
// événements horodatés et les rend sur le sous-bus correspondant. Les sources
// courtes sont suivies jusqu'à leur fin afin de pouvoir être nettoyées.

import type { VoxVowel } from './mood-utils';

export type MusicDrumKind =
  | 'kick'
  | 'snare'
  | 'clap'
  | 'tick'
  | 'hat'
  | 'hatClosed'
  | 'hatOpen'
  | 'music'
  | 'rim'
  | 'tom'
  | 'shaker';
export type InstrumentName = 'drums' | 'bass' | 'harmony' | 'arp' | 'lead' | 'fx' | 'brass' | 'vox';

export interface InstrumentRackBuses {
  drums: AudioNode;
  bass: AudioNode;
  harmony: AudioNode;
  arp: AudioNode;
  lead: AudioNode;
  fx: AudioNode;
  brass: AudioNode;
  vox: AudioNode;
}

export interface MusicInstrument {
  trigger(note: string | number | readonly number[], time: number, duration: number, velocity?: number): void;
  setBrightness(value: number, time?: number): void;
  setPresence(value: number, time?: number): void;
  dispose(): void;
}

interface ToneOptions {
  f: number;
  f1?: number;
  type: OscillatorType;
  time: number;
  duration: number;
  volume: number;
  attack?: number;
}

interface NoiseOptions {
  time: number;
  duration: number;
  volume: number;
  frequency: number;
  frequencyEnd?: number;
  type: BiquadFilterType;
  q?: number;
}

interface BrassOptions {
  f: number;
  time: number;
  duration: number;
  volume: number;
}

interface VoxOptions {
  f: number;
  vowel: VoxVowel;
  time: number;
  duration: number;
  volume: number;
}

/** Formants mesurés : [fréquence, Q, niveau] — mêmes tables que le SFX vocalize. */
const VOX_FORMANTS: Record<VoxVowel, ReadonlyArray<readonly [number, number, number]>> = {
  hey: [[550, 7, 1], [1900, 9, 0.5], [2500, 12, 0.15]],
  oh: [[500, 7, 1], [880, 9, 0.58], [2450, 12, 0.14]],
  ah: [[780, 7, 1], [1180, 9, 0.52], [2700, 12, 0.16]],
};

/** Encodage voyelle ↔ index pour les notes vox `[midi, code]`. */
const VOX_ORDER: readonly VoxVowel[] = ['hey', 'oh', 'ah'];

type VoiceRenderer = (
  voice: RackVoice,
  note: string | number | readonly number[],
  time: number,
  duration: number,
  velocity: number,
) => void;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const midiHz = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

/** Une voix possède un état léger et ne crée que les nodes nécessaires à un trigger. */
class RackVoice implements MusicInstrument {
  private brightness = 0.5;
  private presence = 1;
  private readonly activeSources = new Set<AudioScheduledSourceNode>();

  constructor(
    private readonly context: AudioContext,
    private readonly destination: AudioNode,
    private readonly noiseBuffer: AudioBuffer,
    private readonly render: VoiceRenderer,
  ) {}

  trigger(note: string | number | readonly number[], time: number, duration: number, velocity = 1): void {
    if (!Number.isFinite(time) || !Number.isFinite(duration) || duration <= 0) return;
    const level = clamp01(velocity) * this.presence;
    if (level <= 0.0001) return;
    this.render(this, note, time, duration, level);
  }

  setBrightness(value: number, _time?: number): void {
    this.brightness = clamp01(value);
  }

  setPresence(value: number, _time?: number): void {
    this.presence = clamp01(value);
  }

  dispose(): void {
    for (const source of this.activeSources) {
      try { source.stop(); } catch { /* source déjà terminée */ }
    }
    this.activeSources.clear();
  }

  /** Facteur neutre à la valeur par défaut .5, utile aux futurs timbres adaptatifs. */
  brightnessFactor(min = 0.65, max = 1.35): number {
    return min + (max - min) * this.brightness;
  }

  scheduleTone({ f, f1 = 0, type, time, duration, volume, attack = 0.002 }: ToneOptions): void {
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const safeDuration = Math.max(0.001, duration);
    const safeAttack = Math.max(0.0001, Math.min(attack, safeDuration * 0.8));
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(Math.max(20, f), time);
    if (f1) oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, f1), time + safeDuration);
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(Math.max(0, volume), time + safeAttack);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + safeDuration);
    oscillator.connect(gain);
    gain.connect(this.destination);
    this.register(oscillator, [gain]);
    oscillator.start(time);
    oscillator.stop(time + safeDuration + 0.05);
  }

  scheduleNoise({ time, duration, volume, frequency, frequencyEnd = 0, type, q = 1 }: NoiseOptions): void {
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    const safeDuration = Math.max(0.001, duration);
    source.buffer = this.noiseBuffer;
    source.loop = true;
    source.playbackRate.value = 1;
    filter.type = type;
    filter.frequency.setValueAtTime(Math.max(20, frequency), time);
    filter.Q.value = q;
    if (frequencyEnd) filter.frequency.exponentialRampToValueAtTime(Math.max(40, frequencyEnd), time + safeDuration);
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(Math.max(0, volume), time + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + safeDuration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.destination);
    this.register(source, [filter, gain]);
    source.start(time);
    source.stop(time + safeDuration + 0.05);
  }

  /** Cuivre de poche : deux scies désaccordées dans un lowpass + vibrato retardé. */
  scheduleBrass({ f, time, duration, volume }: BrassOptions): void {
    const safeDuration = Math.max(0.12, duration);
    const filter = this.context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1200 + 2600 * this.brightness, time);
    filter.Q.value = 0.8;
    const gain = this.context.createGain();
    const attack = Math.min(0.04, safeDuration * 0.25);
    const holdUntil = time + Math.max(attack, safeDuration * 0.6);
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(Math.max(0, volume), time + attack);
    gain.gain.setValueAtTime(Math.max(0, volume), holdUntil);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + safeDuration);
    filter.connect(gain);
    gain.connect(this.destination);
    const lfo = this.context.createOscillator();
    const lfoDepth = this.context.createGain();
    lfo.type = 'sine';
    lfo.frequency.value = 5.5;
    lfoDepth.gain.setValueAtTime(0, time);
    lfoDepth.gain.linearRampToValueAtTime(6, time + Math.min(0.14, safeDuration * 0.5));
    lfo.connect(lfoDepth);
    const stopAt = time + safeDuration + 0.05;
    for (const detune of [-5, 4]) {
      const osc = this.context.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(Math.max(20, f), time);
      osc.detune.value = detune;
      lfoDepth.connect(osc.detune);
      osc.connect(filter);
      this.register(osc, []);
      osc.start(time);
      osc.stop(stopAt);
    }
    this.register(lfo, [filter, gain, lfoDepth]);
    lfo.start(time);
    lfo.stop(stopAt);
  }

  /** Cri de fête : scie filtrée par trois formants, attaque franche, chute courte. */
  scheduleVox({ f, vowel, time, duration, volume }: VoxOptions): void {
    const safeDuration = Math.max(0.1, duration);
    const end = time + safeDuration;
    const carrier = this.context.createOscillator();
    carrier.type = 'sawtooth';
    carrier.frequency.setValueAtTime(Math.max(40, f * 0.96), time);
    carrier.frequency.exponentialRampToValueAtTime(Math.max(40, f), time + Math.min(0.06, safeDuration * 0.3));
    const body = this.context.createOscillator();
    body.type = 'triangle';
    body.frequency.setValueAtTime(Math.max(40, f * 0.5), time);
    const vibrato = this.context.createOscillator();
    const vibratoDepth = this.context.createGain();
    vibrato.type = 'sine';
    vibrato.frequency.value = 6;
    vibratoDepth.gain.setValueAtTime(0, time);
    vibratoDepth.gain.linearRampToValueAtTime(8, time + Math.min(0.08, safeDuration * 0.4));
    vibrato.connect(vibratoDepth);
    vibratoDepth.connect(carrier.detune);
    const sourceGain = this.context.createGain();
    sourceGain.gain.value = 0.55;
    const bodyGain = this.context.createGain();
    bodyGain.gain.value = 0.14;
    const envelope = this.context.createGain();
    envelope.gain.setValueAtTime(0.0001, time);
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), time + Math.min(0.02, safeDuration * 0.15));
    envelope.gain.setValueAtTime(Math.max(0.0002, volume * 0.8), Math.max(time + 0.021, end - Math.min(0.08, safeDuration * 0.4)));
    envelope.gain.exponentialRampToValueAtTime(0.0001, end);
    carrier.connect(sourceGain);
    body.connect(bodyGain);
    bodyGain.connect(envelope);
    const nodes: AudioNode[] = [sourceGain, bodyGain, envelope, vibrato, vibratoDepth];
    for (const [frequency, q, level] of VOX_FORMANTS[vowel]) {
      const filter = this.context.createBiquadFilter();
      const formantGain = this.context.createGain();
      filter.type = 'bandpass';
      filter.frequency.value = frequency;
      filter.Q.value = q;
      formantGain.gain.value = level;
      sourceGain.connect(filter);
      filter.connect(formantGain);
      formantGain.connect(envelope);
      nodes.push(filter, formantGain);
    }
    envelope.connect(this.destination);
    const stopAt = end + 0.04;
    this.register(carrier, []);
    this.register(body, []);
    this.register(vibrato, nodes);
    carrier.start(time);
    body.start(time);
    vibrato.start(time);
    carrier.stop(stopAt);
    body.stop(stopAt);
    vibrato.stop(stopAt);
  }

  private register(source: AudioScheduledSourceNode, nodes: AudioNode[]): void {
    this.activeSources.add(source);
    source.onended = () => {
      this.activeSources.delete(source);
      try { source.disconnect(); } catch { /* déjà déconnectée */ }
      for (const node of nodes) {
        try { node.disconnect(); } catch { /* déjà déconnecté */ }
      }
    };
  }
}

export interface InstrumentRackOptions {
  context: AudioContext;
  noiseBuffer: AudioBuffer;
  buses: InstrumentRackBuses;
}

/**
 * Point d'entrée unique des instruments musicaux.
 * Les instruments restent déterministes : aucune variation aléatoire n'est
 * introduite ici, et les SFX continuent de passer par AudioSys.sfxBus.
 */
export class InstrumentRack {
  readonly drums: MusicInstrument;
  readonly bass: MusicInstrument;
  readonly harmony: MusicInstrument;
  readonly arp: MusicInstrument;
  readonly lead: MusicInstrument;
  readonly fx: MusicInstrument;
  readonly brass: MusicInstrument;
  readonly vox: MusicInstrument;

  constructor({ context, noiseBuffer, buses }: InstrumentRackOptions) {
    this.drums = new RackVoice(context, buses.drums, noiseBuffer, (voice, note, time, duration, velocity) => {
      const kind = String(note) as MusicDrumKind;
      if (kind === 'kick') {
        voice.scheduleTone({ f: 150, f1: 42, type: 'sine', time, duration: 0.17, volume: 0.85 * velocity });
        voice.scheduleNoise({ time, duration: 0.03, frequency: 3000, type: 'lowpass', volume: 0.1 * velocity });
      } else if (kind === 'snare') {
        voice.scheduleNoise({ time, duration: 0.13, frequency: 1800, type: 'bandpass', q: 0.8, volume: 0.3 * velocity });
        voice.scheduleTone({ f: 190, type: 'triangle', time, duration: 0.05, volume: 0.15 * velocity });
      } else if (kind === 'clap') {
        voice.scheduleNoise({ time, duration: 0.08, frequency: 2100, type: 'bandpass', q: 0.7, volume: 0.24 * velocity });
      } else if (kind === 'tick') {
        voice.scheduleTone({ f: 1175, type: 'square', time, duration: 0.05, volume: 0.1 * velocity });
      } else if (kind === 'rim') {
        voice.scheduleTone({ f: 1550, f1: 980, type: 'triangle', time, duration: 0.045, volume: 0.12 * velocity });
      } else if (kind === 'tom') {
        voice.scheduleTone({ f: 230, f1: 110, type: 'sine', time, duration: 0.19, volume: 0.2 * velocity });
      } else {
        const open = kind === 'hatOpen';
        const shaker = kind === 'shaker';
        voice.scheduleNoise({
          time,
          duration: Math.min(open ? 0.12 : 0.04, duration),
          frequency: shaker ? 5200 : 7500,
          type: 'highpass',
          volume: (shaker ? 0.2 : 0.15) * velocity,
        });
      }
    });

    this.bass = new RackVoice(context, buses.bass, noiseBuffer, (voice, note, time, duration, velocity) => {
      const midi = typeof note === 'number' ? note : Number(note);
      if (!Number.isFinite(midi)) return;
      voice.scheduleTone({ f: midiHz(midi), type: 'triangle', time, duration: Math.max(0.2, duration), volume: 0.22 * velocity });
      voice.scheduleTone({ f: midiHz(midi + 12), type: 'square', time, duration: 0.1, volume: 0.05 * velocity });
    });

    this.harmony = new RackVoice(context, buses.harmony, noiseBuffer, (voice, note, time, duration, velocity) => {
      const roots = Array.isArray(note)
        ? note
        : [typeof note === 'number' ? note : Number(note)];
      const notes = Array.isArray(note) ? roots : roots.flatMap((root) => [root, root + 3, root + 7, root + 12]);
      for (const midi of notes) {
        if (Number.isFinite(midi)) {
          voice.scheduleTone({ f: midiHz(midi), type: 'sawtooth', time, duration: duration * 0.95, volume: 0.028 * velocity, attack: 0.4 });
        }
      }
    });

    this.arp = new RackVoice(context, buses.arp, noiseBuffer, (voice, note, time, duration, velocity) => {
      const midi = typeof note === 'number' ? note : Number(note);
      if (Number.isFinite(midi)) voice.scheduleTone({ f: midiHz(midi), type: 'triangle', time, duration, volume: 0.08 * velocity });
    });

    this.lead = new RackVoice(context, buses.lead, noiseBuffer, (voice, note, time, duration, velocity) => {
      const midi = typeof note === 'number' ? note : Number(note);
      if (Number.isFinite(midi)) voice.scheduleTone({ f: midiHz(midi), type: 'triangle', time, duration, volume: 0.12 * velocity });
    });

    this.fx = new RackVoice(context, buses.fx, noiseBuffer, (voice, note, time, duration, velocity) => {
      const midi = typeof note === 'number' ? note : Number(note);
      if (Number.isFinite(midi)) voice.scheduleTone({ f: midiHz(midi), type: 'sine', time, duration, volume: 0.1 * velocity });
    });

    this.brass = new RackVoice(context, buses.brass, noiseBuffer, (voice, note, time, duration, velocity) => {
      const midi = typeof note === 'number' ? note : Number(note);
      if (Number.isFinite(midi)) voice.scheduleBrass({ f: midiHz(midi), time, duration, volume: 0.09 * velocity });
    });

    this.vox = new RackVoice(context, buses.vox, noiseBuffer, (voice, note, time, duration, velocity) => {
      const midi = Array.isArray(note) ? Number(note[0]) : Number(note);
      const vowel = Array.isArray(note) ? VOX_ORDER[Number(note[1])] ?? 'hey' : 'hey';
      if (Number.isFinite(midi)) voice.scheduleVox({ f: midiHz(midi), vowel, time, duration, volume: 0.24 * velocity });
    });
  }

  triggerDrum(kind: MusicDrumKind, time: number, velocity = 1): void {
    this.drums.trigger(kind, time, kind === 'kick' ? 0.17 : 0.13, velocity);
  }

  triggerHat(time: number, volume: number): void {
    this.drums.trigger('hat', time, 0.04, volume / 0.15);
  }

  triggerBass(time: number, midi: number, duration = 0.2, velocity = 1): void {
    this.bass.trigger(midi, time, duration, velocity);
  }

  triggerBrass(time: number, midi: number, duration = 0.2, velocity = 0.8): void {
    this.brass.trigger(midi, time, duration, velocity);
  }

  triggerVox(time: number, midi: number, vowel: VoxVowel = 'hey', duration = 0.2, velocity = 0.9): void {
    this.vox.trigger([midi, VOX_ORDER.indexOf(vowel)], time, duration, velocity);
  }

  triggerArp(time: number, midi: number, duration = 0.22, velocity = 0.55): void {
    this.arp.trigger(midi, time, duration, velocity);
  }

  triggerPad(time: number, root: number, duration: number, velocity = 1): void {
    this.harmony.trigger(root, time, duration, velocity);
  }

  triggerChord(time: number, notes: readonly number[], duration: number, velocity = 1): void {
    this.harmony.trigger(notes, time, duration, velocity);
  }

  setLayerPresence(layer: InstrumentName, value: number, time?: number): void {
    this[layer].setPresence(value, time);
  }

  setLayerBrightness(layer: InstrumentName, value: number, time?: number): void {
    this[layer].setBrightness(value, time);
  }

  resetLayers(time?: number): void {
    for (const layer of ['drums', 'bass', 'harmony', 'arp', 'lead', 'fx', 'brass', 'vox'] as const) {
      this[layer].setPresence(1, time);
      this[layer].setBrightness(0.5, time);
    }
  }

  dispose(): void {
    this.drums.dispose();
    this.bass.dispose();
    this.harmony.dispose();
    this.arp.dispose();
    this.lead.dispose();
    this.fx.dispose();
    this.brass.dispose();
    this.vox.dispose();
  }
}
