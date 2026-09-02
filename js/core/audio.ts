// Audio 100% synthétisé (WebAudio) : pas d'assets, tout est généré.
// - SFX : blips, thumps, noise bursts, zaps...
// - Musique : séquenceur 16 pas avec lookahead, synchronisé sur ctx.currentTime.
// - Mode "chart" pour le jeu de rythme : les events du chart SONT la batterie.

import type { AudioLike, MusicLayerName, VolumeKey } from './types';
import { AdaptiveDirector } from './music/adaptive-director';
import { InstrumentRack } from './music/instrument-rack';
import { ReferencePlayer } from './music/reference-player';
import { MusicStateController } from './music/state';
import { MusicTransport } from './music/transport';
import type { GameMusicEventName, MusicalSection, MusicState, ReferenceMusic } from './music/types';

type HatMode = 'off' | '8ths' | '16ths';
type DrumKind = 'kick' | 'snare' | 'tick' | 'hat' | 'music';

interface Mood {
  bpm: number;
  root: number;
  kick: readonly number[];
  snare: readonly number[];
  hat: HatMode;
  bass: readonly (number | null)[] | null;
  bassDiv?: number;
  pad: boolean;
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

const MOODS: Record<string, Mood> = {
  menu: { bpm: 100, root: 57, kick: [0, 8], snare: [], hat: 'off', bass: [0, null, 7, null, 3, null, 7, null], bassDiv: 2, pad: true },
  rhythm: { bpm: 128, root: 45, kick: [], snare: [], hat: '8ths', bass: [0, 0, 7, 0], bassDiv: 2, pad: false },
  survival: { bpm: 122, root: 40, kick: [0, 7, 8], snare: [4, 12], hat: '8ths', bass: [0, 0, 3, 5, 0, 0, 3, 2], bassDiv: 2, pad: false },
  shooter: { bpm: 132, root: 45, kick: [0, 4, 8, 12], snare: [4, 12], hat: '16ths', bass: [0, 0, 7, 0, 0, 0, 10, 7], bassDiv: 2, pad: false },
  runner: { bpm: 138, root: 43, kick: [0, 8, 11], snare: [4, 12], hat: '8ths', bass: [0, 7, 0, 10], bassDiv: 2, pad: false },
  cave: { bpm: 96, root: 50, kick: [0, 8], snare: [], hat: 'off', bass: [0, null, 5, null, 7, null, 3, null], bassDiv: 2, pad: true },
  simon: { bpm: 84, root: 45, kick: [], snare: [], hat: 'off', bass: null, pad: true },
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
  sfxBus!: GainNode;
  trackBus!: GainNode;
  noiseBuf!: AudioBuffer;
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
    for (const bus of [this.drumBus, this.bassBus, this.harmonyBus, this.arpBus, this.leadBus, this.musicFxBus]) {
      bus.gain.value = 1;
      bus.connect(this.musicBus);
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
      },
    });
    this.referencePlayer = new ReferencePlayer(this.transport, this.instrumentRack);
    this.adaptiveDirector = new AdaptiveDirector(this.transport, this.instrumentRack, { state: this.musicState, seed: 0x424c4f42 });
    return true;
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
      if (mood.kick.includes(step)) this.drum('kick', time);
      if (mood.snare.includes(step)) this.drum('snare', time);
      if (mood.hat === '8ths' && step % 2 === 0) this.hatAt(time, step % 4 === 2 ? 0.05 : 0.09);
      else if (mood.hat === '16ths') this.hatAt(time, step % 4 === 0 ? 0.09 : 0.045);
      if (mood.bass && step % (mood.bassDiv ?? 2) === 0) {
        const note = mood.bass[(step / (mood.bassDiv ?? 2)) % mood.bass.length];
        if (note !== null && note !== undefined) this.bassAt(time, mood.root + note);
      }
      if (mood.pad && step === 0) this.padAt(time, mood.root, (60 / mood.bpm) * 4);
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
