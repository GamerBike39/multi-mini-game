// Audio WebAudio : SFX synthétisés, samples courts et musique séquencée.
// - SFX : blips, thumps, noise bursts, zaps et impacts échantillonnés.
// - Musique : séquenceur 16 pas avec lookahead, synchronisé sur ctx.currentTime.
// - Mode "chart" pour le jeu de rythme : les events du chart SONT la batterie.

import type { AudioLike, MusicLayerName, SampleLikeOptions, StingerKind, VoiceLikeOptions, VolumeKey } from './types';
import { AdaptiveDirector } from './music/adaptive-director';
import { InstrumentRack } from './music/instrument-rack';
import { arpOffsetAt, brassOffsetAt, dottedEighth, fillDrumsAt, isBreakBar, leadOffsetAt, progressionRoot, swingOffsetAt, voxStepAt, type FillKind, type VoxVowel } from './music/mood-utils';
import { ReferencePlayer } from './music/reference-player';
import { MusicStateController } from './music/state';
import { MusicTransport } from './music/transport';
import type { GameMusicEventName, MusicalSection, MusicState, ReferenceMusic } from './music/types';

type HatMode = 'off' | '8ths' | '16ths';
type DrumKind = 'kick' | 'snare' | 'tick' | 'hat' | 'music' | 'tom';

interface Mood {
  bpm: number;
  root: number;
  kick: readonly number[];
  snare: readonly number[];
  hat: HatMode;
  bass: readonly (number | null)[] | null;
  bassDiv?: number;
  pad: boolean;
  /** Pad en tierce majeure plutôt que mineure (joie vs mélancolie). */
  padMajor?: boolean;
  /** Offsets de tonique cyclés par mesure de 16 pas (progression d'accords). */
  progression?: readonly number[] | null;
  /** Music-box : offsets depuis tonique + 12, `null` = silence (16 pas). */
  arp?: readonly (number | null)[] | null;
  /** Stabs de cuivre : offsets depuis la tonique de la mesure (16 pas). */
  brass?: readonly (number | null)[] | null;
  /** Cris de fête : offsets depuis tonique + 12, voyelle au fil des mesures. */
  vox?: readonly (number | null)[] | null;
  /** Leitmotiv : offsets depuis tonique + 12 (la porte lead décide). */
  lead?: readonly (number | null)[] | null;
  /** Fill de fin de phrase de 4 mesures : discret, appuyé ou absent. */
  fill?: FillKind | null;
  /** Respiration : une mesure de batterie en retrait tous les N bars. */
  breaks?: number | null;
  /** Balançoire des contretemps (0 = droit), comme le swing des références. */
  swing?: number | null;
}

export interface ChartEvent {
  t: number;
  drum: DrumKind;
}

interface MusicOptions {
  chart?: ChartEvent[] | null;
}

interface TrackOptions {
  countIn?: number;
  bpm?: number;
}

interface ToneOptions {
  f?: number;
  f1?: number;
  type?: OscillatorType;
  t?: number;
  dur?: number;
  vol?: number;
  attack?: number;
  dest?: AudioNode | null;
}

interface NoiseOptions {
  t?: number;
  dur?: number;
  vol?: number;
  f?: number;
  f1?: number;
  type?: BiquadFilterType;
  q?: number;
  dest?: AudioNode | null;
}

interface ThumpOptions {
  f0?: number;
  f1?: number;
  dur?: number;
}

interface AudioWindow extends Window {
  webkitAudioContext?: typeof AudioContext;
}

/** Table des motifs génératifs, exportée pour le test de câblage (aucun jeu silencieux). */
export const MOODS: Record<string, Mood> = {
  // Menu "blob joyeux et profond" : tonique grave (A2), groove chaloupé avec
  // backbeat léger, basse rebondissante majeure, pads majeurs et progression
  // I–VI–IV–V (A F# D E) + music-box pentatonique. Cf. legacy/AudioSys.current.md
  // qui fige l'ancienne boucle mineure volontairement remplacée ici.
  menu: {
    bpm: 112, root: 45, kick: [0, 8], snare: [4, 12], hat: '8ths',
    bass: [0, null, 7, 9, null, 7, 5, 4], bassDiv: 2, pad: true, padMajor: true,
    progression: [0, -3, -7, -5],
    arp: [12, null, 16, null, 19, null, 16, null, 14, null, 12, null, 9, null, 7, null],
    brass: [null, null, 0, null, null, null, 7, null, null, null, 5, null, null, null, 9, 7],
    vox: [null, null, null, null, null, null, null, null, 7, null, null, null, null, null, null, null],
    fill: 'light', breaks: 8, swing: 0.08,
  },
  rhythm: { bpm: 128, root: 45, kick: [], snare: [], hat: '8ths', bass: [0, 0, 7, 0], bassDiv: 2, pad: false },
  survival: { bpm: 122, root: 40, kick: [0, 7, 8], snare: [4, 12], hat: '8ths', bass: [0, 0, 3, 5, 0, 0, 3, 2], bassDiv: 2, pad: false, fill: 'full' },
  shooter: { bpm: 132, root: 45, kick: [0, 4, 8, 12], snare: [4, 12], hat: '16ths', bass: [0, 0, 7, 0, 0, 0, 10, 7], bassDiv: 2, pad: false, fill: 'full' },
  runner: { bpm: 138, root: 43, kick: [0, 8, 11], snare: [4, 12], hat: '8ths', bass: [0, 7, 0, 10], bassDiv: 2, pad: false, fill: 'full' },
  cave: {
    bpm: 96, root: 50, kick: [0, 8], snare: [], hat: 'off',
    bass: [0, null, 5, null, 7, null, 3, null], bassDiv: 2, pad: true, fill: 'light',
    lead: [7, null, null, null, 5, null, 3, null, 2, null, null, null, 0, null, null, null],
  },
  simon: { bpm: 84, root: 45, kick: [], snare: [], hat: 'off', bass: null, pad: true },
  // Couleurs par jeu : chaque jeu génératif a sa tonique, son groove et sa
  // progression. Les familles gardent leur branche d'état (runner/cave/simon).
  pong: { bpm: 124, root: 40, kick: [0, 8], snare: [4, 12], hat: '8ths', bass: [0, null, 0, 7, null, 5, 3, 2], bassDiv: 2, pad: true, fill: 'light' },
  breaker: {
    bpm: 140, root: 43, kick: [0, 4, 8, 12], snare: [4, 12], hat: '16ths',
    bass: [0, 0, 12, 0, 10, 0, 7, 5], bassDiv: 2, pad: true, progression: [0, -4, -2, -5], fill: 'full',
    brass: [0, null, null, null, null, null, null, null, 7, null, null, null, 5, null, 4, 2],
    lead: [12, null, null, null, 15, null, 17, null, 19, null, null, null, 22, null, null, null],
  },
  flap: {
    bpm: 132, root: 48, kick: [0, 8], snare: [12], hat: '8ths',
    bass: [0, null, 7, null, 9, null, 7, 5], bassDiv: 2, pad: true, padMajor: true,
    progression: [0, -5, -3, -5], fill: 'full', swing: 0.05,
    arp: [12, null, null, null, 16, null, null, null, 19, null, null, null, 16, null, 14, null],
  },
  frog: {
    bpm: 120, root: 43, kick: [0, 8], snare: [12], hat: '8ths',
    bass: [0, null, 0, null, 7, null, 5, null], bassDiv: 2, pad: true, padMajor: true,
    progression: [0, 5, 7, 5], fill: 'light', swing: 0.06,
  },
  snake: {
    bpm: 116, root: 41, kick: [0, 8], snare: [], hat: '8ths',
    bass: [0, null, 3, null, 2, null, 0, null], bassDiv: 2, pad: true,
    progression: [0, -2, -3, -5],
  },
  columns: {
    bpm: 100, root: 48, kick: [0, 8], snare: [], hat: 'off',
    bass: [0, null, null, null, 7, null, 5, null], bassDiv: 2, pad: true, padMajor: true,
    progression: [0, -3, -5, -3],
    arp: [12, null, 16, null, 19, null, 16, null, 12, null, 16, null, 19, null, 24, null],
  },
  golf: {
    bpm: 96, root: 50, kick: [0], snare: [], hat: 'off',
    bass: [0, null, null, 7, null, null, 5, null], bassDiv: 2, pad: true, padMajor: true,
    progression: [0, 2, -3, 0],
    arp: [12, null, null, null, null, null, 16, null, null, null, 19, null, null, null, null, null],
  },
  dig: {
    bpm: 92, root: 38, kick: [0, 8], snare: [], hat: 'off',
    bass: [0, null, null, null, 0, null, -2, null], bassDiv: 2, pad: true,
    progression: [0, -2, -3, -5],
  },
  bubble: {
    bpm: 126, root: 53, kick: [0, 8], snare: [4, 12], hat: '8ths',
    bass: [0, 7, 0, 7, 5, 7, 3, 2], bassDiv: 2, pad: true, padMajor: true,
    progression: [0, -5, -3, 2], fill: 'light',
    arp: [12, null, 16, null, 19, null, 24, null, 19, null, 16, null, 12, null, 9, null],
  },
  sort: {
    bpm: 104, root: 47, kick: [0, 8], snare: [], hat: '8ths',
    bass: [0, null, 7, null, 0, null, 5, null], bassDiv: 2, pad: true, padMajor: true,
    progression: [0, 5, 3, 2],
  },
  path: {
    bpm: 96, root: 45, kick: [0], snare: [], hat: 'off',
    bass: [0, null, null, null, 5, null, 3, null], bassDiv: 2, pad: true,
    progression: [0, -3, -5, -7],
    arp: [12, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
  },
  cycle: {
    bpm: 134, root: 43, kick: [0, 4, 8, 12], snare: [4, 12], hat: '16ths',
    bass: [0, 0, 7, 0, 5, 0, 3, 2], bassDiv: 2, pad: true,
    progression: [0, -2, -5, -3], fill: 'full',
    arp: [12, null, 15, null, 19, null, 15, null, 12, null, 10, null, 7, null, 10, null],
  },
};

export class AudioSys implements AudioLike {
  ctx: AudioContext | null = null;
  muted = false;
  // Volumes réglables (0..1), persistés ; master est un facteur global.
  vols: Record<VolumeKey, number> = { master: 0.7, music: 0.9, sfx: 0.9 };

  musicOn = false;
  mood: Mood | null = null;
  timer: number | null = null;
  chart: ChartEvent[] | null = null;
  chartPtr = 0;
  pendingMood: [string, MusicOptions] | null = null;
  pendingReference: ReferenceMusic | null = null;
  musicStart = 0;
  step = 0;
  /** Horloge musicale commune ; aucune création de node n'est déléguée ici. */
  readonly transport = new MusicTransport();

  master!: GainNode;
  comp!: DynamicsCompressorNode;
  musicBus!: GainNode;
  drumBus!: GainNode;
  bassBus!: GainNode;
  harmonyBus!: GainNode;
  arpBus!: GainNode;
  leadBus!: GainNode;
  musicFxBus!: GainNode;
  brassBus!: GainNode;
  voxBus!: GainNode;
  spaceDelay!: DelayNode;
  spaceReverb!: ConvolverNode;
  sfxBus!: GainNode;
  trackBus!: GainNode;
  noiseBuf!: AudioBuffer;
  readonly sampleBuffers = new Map<string, AudioBuffer>();
  readonly sampleLoads = new Map<string, Promise<void>>();
  instrumentRack: InstrumentRack | null = null;
  referencePlayer: ReferencePlayer | null = null;
  readonly musicState = new MusicStateController();
  adaptiveDirector: AdaptiveDirector | null = null;
  adaptiveEnabled = false;

  trackMode = false;
  trackCountIn = 0;
  trackSource: AudioBufferSourceNode | null = null;
  trackStartAt = 0;
  trackOffset = 0;
  trackBuffer: AudioBuffer | null = null;
  trackPausedAt: number | undefined;

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem('blobArcade.audio') || '{}') as Record<string, unknown>;
      const clamp = (value: unknown, fallback: number): number =>
        Math.max(0, Math.min(1, typeof value === 'number' && Number.isFinite(value) ? value : fallback));
      this.vols = {
        master: clamp(saved.master, 0.7),
        music: clamp(saved.music, 0.9),
        sfx: clamp(saved.sfx, 0.9),
      };
      this.muted = !!saved.mute;
    } catch {
      // Préférences absentes : défauts.
    }
  }

  ensure(): boolean {
    if (this.ctx) return true;
    try {
      const AudioContextConstructor = window.AudioContext || (window as AudioWindow).webkitAudioContext;
      if (!AudioContextConstructor) return false;
      this.ctx = new AudioContextConstructor();
    } catch {
      return false;
    }

    const context = this.ctx;
    this.master = context.createGain();
    this.master.gain.value = 0.6;
    this.comp = context.createDynamicsCompressor();
    this.comp.threshold.value = -18;
    this.comp.ratio.value = 6;
    this.master.connect(this.comp);
    this.comp.connect(context.destination);
    this.musicBus = context.createGain();
    this.musicBus.gain.value = 0.5;
    this.musicBus.connect(this.master);
    this.drumBus = context.createGain();
    this.bassBus = context.createGain();
    this.harmonyBus = context.createGain();
    this.arpBus = context.createGain();
    this.leadBus = context.createGain();
    this.musicFxBus = context.createGain();
    this.brassBus = context.createGain();
    this.voxBus = context.createGain();
    for (const bus of [this.drumBus, this.bassBus, this.harmonyBus, this.arpBus, this.leadBus, this.musicFxBus, this.brassBus, this.voxBus]) {
      bus.gain.value = 1;
      bus.connect(this.musicBus);
    }
    // Espace : delay pointé synchronisé + réverb à impulsion générée.
    // Seules les couches mélodiques y envoient ; batterie et basse restent sèches.
    this.spaceDelay = context.createDelay(1.0);
    this.spaceDelay.delayTime.value = dottedEighth(112);
    const spaceFeedback = context.createGain();
    spaceFeedback.gain.value = 0.34;
    const spaceFilter = context.createBiquadFilter();
    spaceFilter.type = 'lowpass';
    spaceFilter.frequency.value = 2400;
    const spaceDelayWet = context.createGain();
    spaceDelayWet.gain.value = 0.15;
    this.spaceDelay.connect(spaceFilter);
    spaceFilter.connect(spaceFeedback);
    spaceFeedback.connect(this.spaceDelay);
    this.spaceDelay.connect(spaceDelayWet);
    spaceDelayWet.connect(this.musicBus);
    this.spaceReverb = context.createConvolver();
    this.spaceReverb.buffer = this.makeImpulse(1.9, 2.7);
    const spaceReverbWet = context.createGain();
    spaceReverbWet.gain.value = 0.18;
    this.spaceReverb.connect(spaceReverbWet);
    spaceReverbWet.connect(this.musicBus);
    for (const bus of [this.arpBus, this.leadBus, this.brassBus, this.voxBus, this.harmonyBus]) {
      bus.connect(this.spaceDelay);
      bus.connect(this.spaceReverb);
    }
    this.sfxBus = context.createGain();
    this.sfxBus.gain.value = 1;
    this.sfxBus.connect(this.master);
    this.trackBus = context.createGain();
    this.trackBus.gain.value = 0.9;
    this.trackBus.connect(this.master);
    this.applyVolumes();

    // Buffer de bruit blanc d'une seconde.
    const length = context.sampleRate;
    this.noiseBuf = context.createBuffer(1, length, context.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    this.instrumentRack = new InstrumentRack({
      context,
      noiseBuffer: this.noiseBuf,
      buses: {
        drums: this.drumBus,
        bass: this.bassBus,
        harmony: this.harmonyBus,
        arp: this.arpBus,
        lead: this.leadBus,
        fx: this.musicFxBus,
        brass: this.brassBus,
        vox: this.voxBus,
      },
    });
    this.referencePlayer = new ReferencePlayer(this.transport, this.instrumentRack);
    this.adaptiveDirector = new AdaptiveDirector(this.transport, this.instrumentRack, { state: this.musicState, seed: 0x424c4f42 });
    return true;
  }

  /** Réponse impulsionnelle : bruit qui décroît exponentiellement (stéréo). */
  private makeImpulse(seconds: number, decay: number): AudioBuffer {
    const context = this.ctx as AudioContext;
    const length = Math.max(1, Math.floor(context.sampleRate * seconds));
    const buffer = context.createBuffer(2, length, context.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
    return buffer;
  }

  unlock(): void {
    if (!this.ensure()) return;
    const context = this.ctx;
    if (!context) return;
    if (context.state === 'suspended') {
      context.resume().then(() => {
        if (this.pendingReference) {
          const reference = this.pendingReference;
          this.pendingReference = null;
          this.startReference(reference);
        } else if (this.pendingMood) {
          const [name, options] = this.pendingMood;
          this.pendingMood = null;
          this.startMusic(name, options);
        }
      }).catch(() => {});
    } else if (context.state === 'running' && this.pendingReference) {
      const reference = this.pendingReference;
      this.pendingReference = null;
      this.startReference(reference);
    } else if (context.state === 'running' && this.pendingMood) {
      const [name, options] = this.pendingMood;
      this.pendingMood = null;
      this.startMusic(name, options);
    }
  }

  suspend(): void {
    this.ctx?.suspend();
  }

  resume(): void {
    if (this.ctx?.state === 'suspended') this.ctx.resume();
  }

  // ---------- volumes ----------
  applyVolumes(): void {
    if (!this.master) return;
    this.master.gain.value = this.muted ? 0 : this.vols.master * 0.9;
    this.musicBus.gain.value = 0.5 * this.vols.music;
    this.sfxBus.gain.value = this.vols.sfx;
    this.trackBus.gain.value = 0.9 * this.vols.music;
  }

  setVol(key: VolumeKey, value: number): void {
    if (!(key in this.vols)) return;
    this.vols[key] = Math.max(0, Math.min(1, value));
    this.applyVolumes();
    this.savePrefs();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyVolumes();
    this.savePrefs();
  }

  savePrefs(): void {
    try {
      localStorage.setItem('blobArcade.audio', JSON.stringify({ ...this.vols, mute: this.muted }));
    } catch {
      // Pas grave si le stockage est indisponible.
    }
  }

  // ---------- primitives ----------
  tone({ f = 440, f1 = 0, type = 'square', t = 0, dur = 0.1, vol = 0.2, attack = 0.002, dest = null }: ToneOptions = {}): void {
    if (!this.ctx) return;
    const context = this.ctx;
    t = t || context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(Math.max(20, f), t);
    if (f1) oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(vol, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    oscillator.connect(gain);
    gain.connect(dest || this.sfxBus);
    oscillator.start(t);
    oscillator.stop(t + dur + 0.05);
  }

  // Petite voix procédurale : une source riche filtrée par trois formants crée
  // une voyelle reconnaissable, avec attaque ronde, glissando et vibrato.
  vocalize({ f = 220, vowel = 'oh', dur = 0.22, vol = 0.2 }: VoiceLikeOptions = {}): void {
    if (!this.ctx) return;
    const context = this.ctx;
    const start = context.currentTime;
    const end = start + Math.max(0.08, dur);
    const carrier = context.createOscillator();
    const body = context.createOscillator();
    const vibrato = context.createOscillator();
    const vibratoDepth = context.createGain();
    const sourceGain = context.createGain();
    const bodyGain = context.createGain();
    const envelope = context.createGain();

    carrier.type = 'sawtooth';
    body.type = 'triangle';
    vibrato.type = 'sine';
    carrier.frequency.setValueAtTime(Math.max(40, f * 0.965), start);
    carrier.frequency.exponentialRampToValueAtTime(Math.max(40, f), start + Math.min(0.065, dur * 0.35));
    body.frequency.setValueAtTime(Math.max(40, f * 0.5), start);
    vibrato.frequency.value = 6.2;
    vibratoDepth.gain.setValueAtTime(0, start);
    vibratoDepth.gain.linearRampToValueAtTime(11, start + Math.min(0.07, dur * 0.4));
    vibrato.connect(vibratoDepth);
    vibratoDepth.connect(carrier.detune);
    vibratoDepth.connect(body.detune);

    sourceGain.gain.value = 0.56;
    bodyGain.gain.value = 0.12;
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), start + Math.min(0.025, dur * 0.18));
    envelope.gain.setValueAtTime(Math.max(0.0002, vol * 0.82), Math.max(start + 0.026, end - Math.min(0.09, dur * 0.4)));
    envelope.gain.exponentialRampToValueAtTime(0.0001, end);

    carrier.connect(sourceGain);
    body.connect(bodyGain);
    bodyGain.connect(envelope);
    const formants = vowel === 'ah'
      ? [[780, 7, 1], [1180, 9, 0.52], [2700, 12, 0.16]]
      : [[500, 7, 1], [880, 9, 0.58], [2450, 12, 0.14]];
    for (const [frequency, q, level] of formants) {
      const filter = context.createBiquadFilter();
      const formantGain = context.createGain();
      filter.type = 'bandpass';
      filter.frequency.value = frequency;
      filter.Q.value = q;
      formantGain.gain.value = level;
      sourceGain.connect(filter);
      filter.connect(formantGain);
      formantGain.connect(envelope);
    }
    envelope.connect(this.sfxBus);

    carrier.start(start);
    body.start(start);
    vibrato.start(start);
    carrier.stop(end + 0.04);
    body.stop(end + 0.04);
    vibrato.stop(end + 0.04);
  }

  noise({ t = 0, dur = 0.2, vol = 0.3, f = 1000, f1 = 0, type = 'lowpass', q = 1, dest = null }: NoiseOptions = {}): void {
    if (!this.ctx) return;
    const context = this.ctx;
    t = t || context.currentTime;
    const source = context.createBufferSource();
    source.buffer = this.noiseBuf;
    source.loop = true;
    source.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(f, t);
    filter.Q.value = q;
    if (f1) filter.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(vol, t + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(dest || this.sfxBus);
    source.start(t);
    source.stop(t + dur + 0.05);
  }

  loadSample(key: string, url: string): void {
    if (this.sampleBuffers.has(key) || this.sampleLoads.has(key)) return;
    const loading = (async (): Promise<void> => {
      if (!this.ensure() || !this.ctx) return;
      const context = this.ctx;
      try {
        const response = await fetch(url);
        if (!response.ok) return;
        const bytes = await response.arrayBuffer();
        const buffer = await context.decodeAudioData(bytes);
        this.sampleBuffers.set(key, buffer);
      } catch {
        // Le synthé reste le fallback si le sample n'est pas disponible.
      }
    })();
    this.sampleLoads.set(key, loading);
    void loading.then(() => {
      if (this.sampleLoads.get(key) === loading) this.sampleLoads.delete(key);
    }, () => {
      if (this.sampleLoads.get(key) === loading) this.sampleLoads.delete(key);
    });
  }

  hasSample(key: string): boolean {
    return this.sampleBuffers.has(key);
  }

  playSample(key: string, options: SampleLikeOptions = {}): void {
    const context = this.ctx;
    if (!context) return;
    const buffer = this.sampleBuffers.get(key);
    if (!buffer) {
      const pending = this.sampleLoads.get(key);
      if (pending) {
        const requestedAt = options.t ?? context.currentTime;
        void pending.then(() => {
          if (!this.sampleBuffers.has(key)) return;
          const current = this.ctx?.currentTime ?? requestedAt;
          this.playSample(key, { ...options, t: Math.max(requestedAt, current) });
        });
      }
      return;
    }

    const start = Math.max(context.currentTime + 0.001, options.t ?? context.currentTime);
    const offset = Math.max(0, Math.min(Math.max(0, buffer.duration - 0.01), options.offset ?? 0));
    const available = Math.max(0.02, buffer.duration - offset);
    const duration = Math.min(available, Math.max(0.02, options.duration ?? available));
    const end = start + duration;
    const target = Math.max(0, options.vol ?? 1);
    const attack = Math.min(duration * 0.25, Math.max(0.001, options.attack ?? 0.006));
    const release = Math.min(duration * 0.35, Math.max(0.01, options.release ?? 0.16));
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    source.playbackRate.setValueAtTime(Math.max(0.25, Math.min(4, options.playbackRate ?? 1)), start);

    const filterType = options.filterType;
    if (filterType) {
      const filter = context.createBiquadFilter();
      filter.type = filterType;
      filter.Q.value = options.q ?? 0.7;
      const filterStart = Math.max(20, options.filterStart ?? 18000);
      filter.frequency.setValueAtTime(filterStart, start);
      if (options.filterEnd) {
        const rampEnd = start + Math.min(duration, Math.max(0.005, options.filterRamp ?? 0.08));
        filter.frequency.exponentialRampToValueAtTime(Math.max(20, options.filterEnd), rampEnd);
      }
      source.connect(filter);
      filter.connect(gain);
    } else {
      source.connect(gain);
    }

    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(target, start + attack);
    gain.gain.setValueAtTime(target, Math.max(start + attack, end - release));
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    gain.connect(options.dest || this.sfxBus);
    source.start(start, offset, duration);
  }

  thump(vol = 0.5, { f0 = 150, f1 = 40, dur = 0.18 }: ThumpOptions = {}): void {
    this.tone({ f: f0, f1, type: 'sine', dur, vol });
  }

  // ---------- SFX ----------
  jump(): void { this.tone({ f: 300, f1: 560, type: 'square', dur: 0.12, vol: 0.14 }); }
  land(): void { this.noise({ dur: 0.06, f: 500, vol: 0.16 }); this.thump(0.2, { f0: 120, f1: 60, dur: 0.08 }); }
  dash(): void { this.noise({ dur: 0.16, f: 900, f1: 3200, type: 'bandpass', q: 2, vol: 0.22 }); this.tone({ f: 180, f1: 720, type: 'sawtooth', dur: 0.13, vol: 0.1 }); }
  shoot(): void { this.tone({ f: 900, f1: 320, type: 'square', dur: 0.06, vol: 0.07 }); }
  hitEnemy(): void { this.tone({ f: 1300, f1: 500, dur: 0.05, vol: 0.12 }); this.noise({ dur: 0.05, f: 2200, vol: 0.1 }); }
  explode(big = 1): void {
    this.noise({ dur: 0.35 * big + 0.1, f: 800, f1: 120, vol: 0.34 });
    this.thump(Math.min(1, 0.65 * big), { f0: 140, f1: 28, dur: 0.3 * big + 0.1 });
  }
  hurt(): void { this.tone({ f: 250, f1: 90, type: 'sawtooth', dur: 0.2, vol: 0.26 }); this.noise({ dur: 0.14, f: 700, vol: 0.18 }); }
  coin(step = 0): void {
    const f = 780 * Math.pow(2, Math.min(12, step) / 12);
    this.tone({ f, type: 'square', dur: 0.06, vol: 0.12 });
    this.tone({ f: f * 1.5, type: 'square', dur: 0.1, vol: 0.12, t: this.ctx ? this.ctx.currentTime + 0.06 : 0 });
  }
  // Pièce rouge (séquence +1 vie) : timbre triangle doux + graduation par tons
  // entiers, bien distinct du carré + quinte des gouttes fuel.
  red(step = 0): void {
    if (!this.ctx) return;
    const f = 880 * Math.pow(2, Math.min(12, step * 2) / 12);
    const t = this.ctx.currentTime;
    this.tone({ f, type: 'triangle', dur: 0.09, vol: 0.14 });
    this.tone({ f: f * 2, type: 'sine', dur: 0.12, vol: 0.07, t: t + 0.05 });
  }
  // Boucle turbo : nappe douce (deux triangles en quinte + lowpass + LFO),
  // agréable et non agressive. Gérée par turboSet, volume modeste sous la musique.
  private turboNodes: {
    osc1: OscillatorNode; osc2: OscillatorNode;
    lfo: OscillatorNode; lfoGain: GainNode;
    filter: BiquadFilterNode; gain: GainNode;
  } | null = null;
  turboSet(on: boolean, level = 0): void {
    const context = this.ctx;
    if (!on) {
      if (this.turboNodes && context) {
        const nodes = this.turboNodes;
        this.turboNodes = null;
        const t = context.currentTime;
        nodes.gain.gain.cancelScheduledValues(t);
        nodes.gain.gain.setTargetAtTime(0, t, 0.08);
        nodes.osc1.stop(t + 0.4);
        nodes.osc2.stop(t + 0.4);
        nodes.lfo.stop(t + 0.4);
      }
      return;
    }
    if (!context) return;
    const t = context.currentTime;
    const k = Math.max(0, Math.min(1, level));
    if (!this.turboNodes) {
      const osc1 = context.createOscillator();
      const osc2 = context.createOscillator();
      const filter = context.createBiquadFilter();
      const gain = context.createGain();
      const lfo = context.createOscillator();
      const lfoGain = context.createGain();
      osc1.type = 'triangle';
      osc2.type = 'triangle';
      osc1.frequency.value = 110;
      osc2.frequency.value = 164.8;
      filter.type = 'lowpass';
      filter.frequency.value = 480;
      filter.Q.value = 0.8;
      lfo.type = 'sine';
      lfo.frequency.value = 0.6;
      lfoGain.gain.value = 170;
      lfo.connect(lfoGain);
      lfoGain.connect(filter.frequency);
      gain.gain.value = 0;
      gain.gain.setTargetAtTime(0.055, t, 0.15);
      osc1.connect(filter);
      osc2.connect(filter);
      filter.connect(gain);
      gain.connect(this.sfxBus);
      osc1.start(t);
      osc2.start(t);
      lfo.start(t);
      this.turboNodes = { osc1, osc2, lfo, lfoGain, filter, gain };
    } else {
      const nodes = this.turboNodes;
      nodes.osc1.frequency.setTargetAtTime(110 * (1 + k * 0.18), t, 0.1);
      nodes.osc2.frequency.setTargetAtTime(164.8 * (1 + k * 0.18), t, 0.1);
      nodes.filter.frequency.setTargetAtTime(420 + k * 720, t, 0.1);
      nodes.gain.gain.setTargetAtTime(0.05 + k * 0.04, t, 0.1);
    }
  }
  perfect(): void { this.tone({ f: 1320, type: 'triangle', dur: 0.05, vol: 0.16 }); this.tone({ f: 1760, type: 'triangle', dur: 0.08, vol: 0.16, t: this.ctx ? this.ctx.currentTime + 0.045 : 0 }); }
  good(): void { this.tone({ f: 900, type: 'triangle', dur: 0.06, vol: 0.13 }); }
  miss(): void { this.tone({ f: 140, f1: 70, type: 'sawtooth', dur: 0.22, vol: 0.2 }); this.noise({ dur: 0.12, f: 320, vol: 0.12 }); }
  milestone(): void {
    const t = this.ctx ? this.ctx.currentTime : 0;
    [880, 1108, 1320].forEach((f, index) => this.tone({ f, type: 'triangle', dur: 0.09, vol: 0.12, t: t + index * 0.07 }));
  }
  uiMove(): void { this.tone({ f: 520, dur: 0.035, vol: 0.07 }); }
  uiOk(): void { this.tone({ f: 660, dur: 0.06, vol: 0.11 }); this.tone({ f: 990, dur: 0.09, vol: 0.11, t: this.ctx ? this.ctx.currentTime + 0.07 : 0 }); }
  uiBack(): void { this.tone({ f: 420, f1: 260, dur: 0.08, vol: 0.09 }); }
  whiff(): void { this.tone({ f: 300, f1: 240, type: 'triangle', dur: 0.03, vol: 0.05 }); }

  // ---------- Musique ----------
  startMusic(name: string, options: MusicOptions = {}): void {
    if (!this.ensure()) return;
    const context = this.ctx;
    if (!context) return;
    // Contexte pas encore débloqué (modale d'intro pas cliquée) : on mémorise,
    // sinon la musique se cale sur une horloge gelée et ne démarre jamais proprement.
    if (context.state !== 'running') {
      this.pendingReference = null;
      this.pendingMood = [name, options];
      return;
    }
    this.stopMusic();
    const mood = MOODS[name];
    if (!mood) return;
    this.mood = mood;
    this.musicStart = context.currentTime + 0.12;
    this.step = 0;
    this.transport.start(mood.bpm, this.musicStart);
    this.syncSpace(mood.bpm);
    this.chart = options.chart || null;
    this.chartPtr = 0;
    this.musicOn = true;
    if (this.adaptiveEnabled) this.adaptiveDirector?.start();
    this.timer = window.setInterval(() => this.scheduleAhead(), 55);
    this.scheduleAhead();
  }

  /** Lance une partition de référence, sans chart gameplay ni variation. */
  startReference(reference: ReferenceMusic): void {
    if (!this.ensure()) return;
    const context = this.ctx;
    if (!context || !this.referencePlayer) return;
    if (context.state !== 'running') {
      this.pendingMood = null;
      this.pendingReference = reference;
      return;
    }
    this.stopMusic();
    const composition = this.referencePlayer.start(reference);
    this.mood = { bpm: composition.bpm, root: 0, kick: [], snare: [], hat: 'off', bass: null, pad: false };
    this.musicStart = context.currentTime + 0.12;
    this.step = 0;
    this.transport.start(composition.bpm, this.musicStart, { loopBars: composition.bars });
    this.syncSpace(composition.bpm);
    this.chart = null;
    this.chartPtr = 0;
    this.musicOn = true;
    if (this.adaptiveEnabled) this.adaptiveDirector?.start();
    this.timer = window.setInterval(() => this.scheduleAhead(), 55);
    this.scheduleAhead();
  }

  stopMusic(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.adaptiveDirector?.stop();
    this.musicOn = false;
    this.transport.stop();
    this.referencePlayer?.stop();
    this.chart = null;
    this.trackMode = false;
    this.stopTrack();
  }

  /** Cale le delay pointé sur le tempo courant (croche pointée). */
  private syncSpace(bpm: number): void {
    try {
      this.spaceDelay?.delayTime.setTargetAtTime(dottedEighth(bpm), this.ctx?.currentTime ?? 0, 0.1);
    } catch {
      // Le delay reste sur sa valeur précédente.
    }
  }

  // ---------- piste audio originale (playlist BLOB BEAT) ----------
  playBuffer(buffer: AudioBuffer, when: number, offset = 0): void {
    const context = this.ctx;
    if (!context) return;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.trackBus);
    source.start(when, offset);
    this.trackSource = source;
    this.trackStartAt = when;
    this.trackOffset = offset;
    this.trackBuffer = buffer;
    source.onended = () => {
      if (this.trackSource === source) this.trackSource = null;
    };
  }

  stopTrack(): void {
    if (this.trackSource) {
      try { this.trackSource.stop(); } catch { /* déjà stoppée */ }
    }
    this.trackSource = null;
    this.trackBuffer = null;
    this.trackPausedAt = undefined;
  }

  pauseTrack(): void {
    if (!this.trackSource || !this.ctx) return;
    this.trackPausedAt = this.ctx.currentTime - this.trackStartAt + this.trackOffset;
    try { this.trackSource.stop(); } catch { /* déjà stoppée */ }
    this.trackSource = null;
  }

  resumeTrack(): void {
    if (this.trackPausedAt === undefined || !this.trackBuffer || !this.ctx) return;
    const position = Math.max(0, this.trackPausedAt);
    this.playBuffer(this.trackBuffer, this.ctx.currentTime, position);
    this.trackPausedAt = undefined;
  }

  // Position de lecture (s) ; négative pendant le décompte.
  trackPos(): number {
    if (this.trackSource && this.ctx) return this.ctx.currentTime - this.trackStartAt + this.trackOffset;
    return this.trackPausedAt ?? 0;
  }

  // Lance une piste originale : décompte métronomique, puis le fichier lui-même.
  startTrack(buffer: AudioBuffer, { countIn = 2, bpm = 120 }: TrackOptions = {}): void {
    if (!this.ensure() || !this.ctx) return;
    this.stopMusic();
    this.musicStart = this.ctx.currentTime + 0.15;
    this.transport.start(bpm, this.musicStart);
    this.playBuffer(buffer, this.musicStart + countIn, 0);
    this.musicOn = true;
    this.trackMode = true;
    this.trackCountIn = countIn;
    this.mood = { bpm, root: 0, kick: [], snare: [], hat: 'off', bass: null, pad: false };
    for (let i = 0; i < 4; i++) this.drum('tick', this.musicStart + i * (60 / bpm));
  }

  drum(kind: DrumKind, t: number): void {
    this.instrumentRack?.triggerDrum(kind, t);
  }

  hatAt(t: number, vol: number): void { this.instrumentRack?.triggerHat(t, vol); }

  bassAt(t: number, midi: number): void {
    this.instrumentRack?.triggerBass(t, midi);
  }

  padAt(t: number, root: number, dur: number): void {
    this.instrumentRack?.triggerPad(t, root, dur);
  }

  chordAt(t: number, notes: readonly number[], dur: number): void {
    this.instrumentRack?.triggerChord(t, notes, dur, 0.8);
  }

  arpAt(t: number, midi: number): void {
    this.instrumentRack?.triggerArp(t, midi, 0.22, 0.55);
  }

  brassAt(t: number, midi: number): void {
    this.instrumentRack?.triggerBrass(t, midi, 0.2, 0.8);
  }

  voxAt(t: number, midi: number, vowel: VoxVowel = 'hey'): void {
    this.instrumentRack?.triggerVox(t, midi, vowel, 0.2, 0.9);
  }

  leadAt(t: number, midi: number): void {
    this.instrumentRack?.lead.trigger(midi, t, 0.32, 0.8);
  }

  /**
   * Ponctuation musicale des transitions (lancement, fin, victoire, record).
   * Jouée dans la tonique courante, présence forcée puis re-quantifiée par le
   * directeur à la mesure suivante — toujours audible, jamais bloquée.
   */
  stinger(kind: StingerKind): void {
    const context = this.ctx;
    const rack = this.instrumentRack;
    if (!context || !rack) return;
    const home = this.mood && this.mood.root > 0 ? this.mood.root : 45;
    const eighth = 60 / 132;
    const base = context.currentTime + (kind === 'victory' || kind === 'record' ? 0.3 : 0.02);
    const presence = (layer: MusicLayerName, value: number): void => {
      try {
        rack.setLayerPresence(layer, value, base);
      } catch {
        // La ponctuation reste audible sur les couches déjà ouvertes.
      }
    };
    if (kind === 'launch') {
      presence('arp', 1);
      presence('brass', 1);
      presence('vox', 1);
      [0, 4, 7, 12].forEach((iv, i) => rack.triggerArp(base + i * eighth * 0.5, home + 12 + iv, 0.18, 0.6));
      rack.triggerBrass(base + 4 * eighth * 0.5, home + 12, 0.25, 0.8);
      rack.triggerVox(base + 4 * eighth * 0.5, home + 19, 'hey', 0.22, 0.9);
    } else if (kind === 'over') {
      presence('arp', 1);
      [7, 3, 0, -5].forEach((iv, i) => rack.triggerArp(base + i * eighth * 0.75, home + 12 + iv, 0.3, 0.55));
    } else if (kind === 'victory') {
      presence('brass', 1);
      presence('vox', 1);
      presence('arp', 1);
      [0, 4, 7, 12].forEach((iv, i) => rack.triggerBrass(base + i * eighth * 0.5, home + iv, 0.22, 0.85));
      rack.triggerVox(base + 4 * eighth * 0.5, home + 19, 'hey', 0.25, 1);
      [12, 16, 19, 24].forEach((iv, i) => rack.triggerArp(base + i * eighth * 0.5, home + 12 + iv, 0.15, 0.5));
    } else {
      presence('arp', 1);
      presence('vox', 1);
      [12, 16, 19, 24, 28].forEach((iv, i) => rack.triggerArp(base + i * eighth * 0.4, home + 12 + iv, 0.14, 0.55));
      rack.triggerVox(base + 5 * eighth * 0.4, home + 24, 'hey', 0.2, 0.9);
    }
  }

  scheduleAhead(): void {
    if (!this.ctx || !this.musicOn || !this.mood) return;
    const context = this.ctx;
    const mood = this.mood;
    const horizon = context.currentTime + 0.2;

    if (this.referencePlayer?.isPlaying()) {
      this.referencePlayer.scheduleAhead(context.currentTime, horizon - context.currentTime);
      this.step = this.transport.absoluteStep;
      return;
    }

    if (this.chart) {
      while (this.chartPtr < this.chart.length) {
        const event = this.chart[this.chartPtr];
        const time = this.musicStart + event.t;
        if (time >= horizon) break;
        if (time >= context.currentTime - 0.02) this.drum(event.drum, time);
        this.chartPtr++;
      }
    }

    this.transport.scheduleAhead(context.currentTime, horizon - context.currentTime, ({ time, absoluteStep }) => {
      const step = absoluteStep % 16;
      const root = progressionRoot(mood, absoluteStep);
      // Le swing décale tout ce qui est programmé sur le pas (groove uni).
      const at = time + swingOffsetAt(step, mood.swing ?? 0, mood.bpm);
      const inBreak = isBreakBar(mood.breaks, absoluteStep);
      if (!inBreak && mood.kick.includes(step)) this.drum('kick', at);
      if (!inBreak && mood.snare.includes(step)) this.drum('snare', at);
      if (mood.hat === '8ths' && step % 2 === 0) this.hatAt(at, step % 4 === 2 ? 0.05 : 0.09);
      else if (mood.hat === '16ths') this.hatAt(at, step % 4 === 0 ? 0.09 : 0.045);
      if (!inBreak) {
        for (const extra of fillDrumsAt(mood.fill, absoluteStep)) this.drum(extra, at);
      }
      if (mood.bass && step % (mood.bassDiv ?? 2) === 0) {
        const note = mood.bass[(step / (mood.bassDiv ?? 2)) % mood.bass.length];
        if (note !== null && note !== undefined) this.bassAt(at, root + note);
      }
      if (mood.pad && step === 0) {
        const dur = (60 / mood.bpm) * 4;
        if (mood.padMajor) this.chordAt(at, [root, root + 4, root + 7, root + 12], dur);
        else this.padAt(at, root, dur);
      }
      const arp = arpOffsetAt(mood, absoluteStep);
      if (arp !== null) this.arpAt(at, root + 12 + arp);
      const brass = brassOffsetAt(mood, absoluteStep);
      if (brass !== null) this.brassAt(at, root + brass);
      const vox = voxStepAt(mood, absoluteStep);
      if (vox !== null) this.voxAt(at, root + 12 + vox.offset, vox.vowel);
      const lead = leadOffsetAt(mood, absoluteStep);
      if (lead !== null) this.leadAt(at, root + 12 + lead);
    });
    this.step = this.transport.absoluteStep;
  }

  // Temps musical : beat flottant depuis le début de la musique, 0 si pas de musique.
  beat(): number {
    if (!this.ctx || !this.musicOn || !this.mood) return 0;
    return this.transport.beatAt(this.ctx.currentTime);
  }

  songTime(): number {
    if (!this.ctx || !this.musicOn) return 0;
    return this.transport.transportTime(this.ctx.currentTime);
  }

  pauseMusic(): void {
    if (!this.ctx || !this.musicOn) return;
    if (this.trackMode) this.pauseTrack();
    else this.transport.pause(this.ctx.currentTime);
  }

  resumeMusic(): void {
    if (!this.ctx || !this.musicOn) return;
    if (this.trackMode) this.resumeTrack();
    else this.transport.resume(this.ctx.currentTime);
    if (this.adaptiveEnabled && this.referencePlayer?.isActive()) this.adaptiveDirector?.start();
  }

  musicBpm(): number { return this.musicOn ? this.transport.bpm : 0; }
  musicBeat(): number { return this.musicOn && this.ctx ? this.transport.beatAt(this.ctx.currentTime) : 0; }
  musicBar(): number { return this.musicOn && this.ctx ? this.transport.barAt(this.ctx.currentTime) : 0; }
  musicStep(): number { return this.musicOn && this.ctx ? this.transport.stepAt(this.ctx.currentTime) : 0; }
  musicPhrase(): number { return this.musicOn && this.ctx ? this.transport.phraseAt(this.ctx.currentTime) : 0; }
  musicTransportTime(): number { return this.musicOn && this.ctx ? this.transport.transportTime(this.ctx.currentTime) : 0; }

  updateMusicState(dt: number): void {
    if (this.adaptiveDirector) this.adaptiveDirector.update(dt);
    else this.musicState.update(dt);
  }

  setMusicState(state: Partial<MusicState>): void {
    this.musicState.setState(state);
  }

  getMusicState(): MusicState {
    return this.musicState.snapshot();
  }

  getMusicTargetState(): MusicState {
    return this.musicState.targetSnapshot();
  }

  resetMusicState(): void {
    this.musicState.reset();
  }

  musicEvent(type: GameMusicEventName, strength = 1, value = 0): void {
    this.adaptiveDirector?.event(type, strength, value);
  }

  setAdaptiveEnabled(enabled: boolean): void {
    this.adaptiveEnabled = enabled;
    if (!enabled) {
      this.adaptiveDirector?.stop();
      return;
    }
    if (this.musicOn && this.referencePlayer?.isActive()) this.adaptiveDirector?.start();
  }

  isAdaptiveEnabled(): boolean {
    return this.adaptiveEnabled;
  }

  musicSection(): MusicalSection {
    return this.adaptiveDirector?.section ?? 'groove';
  }

  setMusicLayerPresence(layer: MusicLayerName, value: number): void {
    this.instrumentRack?.setLayerPresence(layer, value, this.ctx?.currentTime);
  }

  setMusicLayerBrightness(layer: MusicLayerName, value: number): void {
    this.instrumentRack?.setLayerBrightness(layer, value, this.ctx?.currentTime);
  }
}
