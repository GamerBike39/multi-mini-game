// BLOB BEAT — jeu de rythme : 3 ou 4 colonnes, densité douce, effets scéniques
// progressifs, et mode SCÈNE MORPHING : la géométrie des couloirs se transforme
// progressivement (colonnes → éventail → ascension → orbite) sur le même chart
// et les mêmes touches. Les notes suivent des trajectoires interpolées.
// Deux sources : séquenceur généré (la batterie EST le chart) ou piste locale
// analysée dans le navigateur (le son original joue).

import { BaseGame } from '../core/game';
import { analyzeBuffer, type AudioAnalysis } from '../core/analyzer';
import * as UI from '../core/ui';
import type { Action, EngineLike, GameMeta, InputTap } from '../core/types';

type DifficultyKey = 'facile' | 'normal' | 'difficile' | 'expert';
type SceneMode = 'classique' | 'morphing';
type RhythmState = 'select' | 'loading' | 'calib' | 'play' | 'over';
type LayoutKey = 'classic' | 'fan' | 'rise' | 'orbit';
type ChartDrum = 'kick' | 'snare' | 'hat' | 'music' | 'tick';

interface Difficulty {
  label: string;
  lanes: 3 | 4;
  fallT: number;
  drain: number;
  regen: number;
  hat: readonly number[];
}

interface Point {
  x: number;
  y: number;
}

interface LayoutDefinition {
  blob: Point;
  columns?: boolean;
  hit(i: number, n: number): Point;
  spawn(i: number, n: number): Point;
}

interface ChartEvent {
  t: number;
  lane: number;
  drum: ChartDrum;
  dur: number;
}

interface RuntimeNote extends ChartEvent {
  judged: boolean;
  x: number;
  y: number;
  p: number;
}

interface HoldNote {
  lane: number;
  end: number;
  x: number;
  y: number;
  color: string;
  done: boolean;
}

interface PlaylistEntry {
  name: string;
  bytes: ArrayBuffer;
  buffer?: AudioBuffer;
  analysis: AudioAnalysis;
  duration: number;
}

interface MusicOption {
  name: string;
  custom: boolean;
}

interface CalibrationResult {
  ms: number;
  n: number;
}

const HIT_Y = 580;
const SPAWN_Y = -60;
const BPM = 128;
const SPB = 60 / BPM;
const START_BEAT = 8;
const TOTAL_BEATS = 256;
const W_PERF = 0.05, W_GREAT = 0.10, W_GOOD = 0.15; // fenêtres de jugement (s)
const LANE_HUES = [330, 42, 155, 199] as const;

const HOLDS_ENABLED = false; // appuis longs en attente d'un meilleur calibrage
const STAGE_NAMES = ['PULSE', 'BALANCEMENT', 'ROTATION', 'COULEURS', 'GELÉE', 'VERTIGO'] as const;
const STAGE_EVERY = 14;      // s entre deux effets scéniques
const LAYOUT_EVERY = 16;     // s par scène (mode Morphing)
const MORPH_DUR = 2.5;       // durée d'une transition de layout
const LAYOUT_ORDER: readonly LayoutKey[] = ['classic', 'fan', 'rise', 'orbit'];
const LAYOUT_NAMES: Record<LayoutKey, string> = { classic: 'COLONNES', fan: 'ÉVENTAIL', rise: 'ASCENSION', orbit: 'ORBITE' };
const CAL_TAP_ACTIONS = new Set<Action>(['a', 'b', 'x', 'y', 'left', 'right', 'up', 'down', 'lb', 'rb']);

// Chaque difficulté : nb de colonnes, vitesse de chute, énergie, densité par phase.
const DIFFS: Record<DifficultyKey, Difficulty> = {
  facile: {
    label: 'FACILE', lanes: 3, fallT: 1.8, drain: 8, regen: 3.5,
    hat: [0, 0, .15, .25, .35, .4, .45],
  },
  normal: {
    label: 'NORMAL', lanes: 3, fallT: 1.6, drain: 10, regen: 3,
    hat: [0, .2, .35, .45, .55, .6, .65],
  },
  difficile: {
    label: 'DIFFICILE', lanes: 4, fallT: 1.45, drain: 12, regen: 2.6,
    hat: [.15, .35, .5, .6, .7, .75, .8],
  },
  expert: {
    label: 'EXPERT', lanes: 4, fallT: 1.3, drain: 14, regen: 2.2,
    hat: [.25, .45, .6, .72, .8, .85, .9],
  },
};
const DIFF_ORDER: readonly DifficultyKey[] = ['facile', 'normal', 'difficile', 'expert'];

const laneXs = (n: number): number[] => (n === 3 ? [540, 640, 740] : [490, 590, 690, 790]);
const laneActionsFor = (n: number): Action[][] => (n === 3
  ? [['left', 'x'], ['down', 'up', 'a', 'b'], ['right', 'y']]  // ◀ ▼(▲) ▶
  : [['left', 'x'], ['down', 'a'], ['up', 'y'], ['right', 'b']]);
const laneGlyphs = (n: number): string[] => (n === 3 ? ['◀', '▼', '▶'] : ['◀', '▼', '▲', '▶']);
const laneFaces = (n: number): string[] => (n === 3 ? ['X', 'A', 'Y'] : ['X', 'A', 'Y', 'B']);
const trunc = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + '…' : s);

// Layouts : position du blob, point de frappe et point d'apparition par lane.
// La note voyage en ligne droite de spawn → hit ; le morphing interpole deux layouts.
const LAYOUTS: Record<LayoutKey, LayoutDefinition> = {
  classic: {
    blob: { x: 640, y: 656 },
    columns: true,
    hit: (i, n) => ({ x: laneXs(n)[i], y: HIT_Y }),
    spawn: (i, n) => ({ x: laneXs(n)[i], y: SPAWN_Y }),
  },
  fan: {
    columns: false,
    blob: { x: 640, y: 640 },
    hit: (i, n) => {
      const a = (i / (n - 1) - 0.5) * 0.9;
      return { x: 640 + Math.sin(a) * 360, y: 940 - Math.cos(a) * 360 };
    },
    spawn: (i, n) => {
      const a = (i / (n - 1) - 0.5) * 0.9;
      return { x: 640 + Math.sin(a) * 1250, y: 940 - Math.cos(a) * 1250 };
    },
  },
  rise: {
    blob: { x: 640, y: 80 },
    hit: (i, n) => ({ x: laneXs(n)[i], y: 150 }),
    spawn: (i, n) => ({ x: laneXs(n)[i], y: 780 }),
  },
  orbit: {
    blob: { x: 640, y: 360 },
    hit: (i, n) => {
      const a = -Math.PI / 2 + ((i + 0.5) / n) * Math.PI * 2;
      return { x: 640 + Math.cos(a) * 250, y: 360 + Math.sin(a) * 250 };
    },
    spawn: (i, n) => {
      const a = -Math.PI / 2 + ((i + 0.5) / n) * Math.PI * 2;
      return { x: 640 + Math.cos(a) * 950, y: 360 + Math.sin(a) * 950 };
    },
  },
};

export class RhythmGame extends BaseGame {
  static meta: GameMeta = {
    id: 'beat', name: 'BLOB BEAT', accent: '#f472b6', mood: 'rhythm',
    desc: 'Calé sur le kick', controls: 'Stick / ◀▼▶ / X A Y B',
    keys: "Flèches · U L J K (Espace / J)",
    hint: 'Frappe quand la note touche le cercle',
    unit: 'pts', ranks: [40000, 24000, 12000, 5000, 0],
  };
  static lastDiff: DifficultyKey = 'normal';
  static lastScene: SceneMode = 'classique';
  static playlist: PlaylistEntry[] = [];
  static musicIdx = 0;    // 0 = générée, 1..N = playlist

  diffKey: DifficultyKey;
  diff: Difficulty;
  sceneMode: SceneMode;
  override state: RhythmState = 'select';
  selRow = 0;
  navRep = 0;
  pvL = false;
  pvR = false;
  pvU = false;
  pvD = false;
  pvX = false;
  pvC = false;
  offsetMs: number;
  musicIdx: number;
  isCustom = false;
  trackName = 'Générée';
  loadingMsg: string | null = null;
  chart: ChartEvent[] = [];
  chartIdx = 0;
  notes: RuntimeNote[] = [];
  holds: HoldNote[] = [];
  LANES: number[] = laneXs(3);
  laneActions: Action[][] = laneActionsFor(3);
  fallT = 1.6;
  spb = SPB;
  countIn = 0;
  songEnd = 0;
  combo = 0;
  maxCombo = 0;
  mult = 1;
  comboPop = 0;
  energy = 100;
  pulse = 0;
  lastLane = -1;
  prevStickLane = -1;
  songTNow = 0;
  laneFlash = [0, 0, 0, 0];
  stage = 0;
  effW = [0, 0, 0, 0, 0, 0];
  effHue = 0;
  effWob = 0;
  layFrom: LayoutKey = 'classic';
  layTo: LayoutKey = 'classic';
  _mk = 1;
  laySeg = 0;
  blobBaseX = 640;
  blobBaseY = 656;
  calTaps: number[] = [];
  calTicks: number[] = [];
  calNext = 0;
  calResult: CalibrationResult | null = null;
  calEndT = 0;
  anchorPerf = 0;
  anchorAudio = 0;
  _fbStart?: number;

  constructor(engine: EngineLike) {
    super(engine);
    this.diffKey = RhythmGame.lastDiff;
    this.diff = DIFFS[this.diffKey];
    this.sceneMode = RhythmGame.lastScene;
    this.offsetMs = Math.max(-120, Math.min(120, Number(localStorage.getItem('blobArcade.beat.offset')) || 0));
    this.musicIdx = RhythmGame.musicIdx;
    this.blob.x = 640; this.blob.y = 560; this.blob.r = 24;
  }

  enter(): void { /* pas de musique avant la confirmation */ }

  // ---------- choix de la piste ----------
  musicOptions(): MusicOption[] {
    return [{ name: 'Générée', custom: false }, ...RhythmGame.playlist.map((p) => ({ name: p.name, custom: true }))];
  }
  currentEntry(): PlaylistEntry | null {
    const opts = this.musicOptions();
    const opt = opts[Math.min(this.musicIdx, opts.length - 1)];
    return opt?.custom ? RhythmGame.playlist[this.musicIdx - 1] : null;
  }
  clampMusicIdx(): void { this.musicIdx = Math.max(0, Math.min(this.musicIdx, this.musicOptions().length - 1)); }

  setDiff(k: DifficultyKey): void { if (k !== this.diffKey) { this.diffKey = k; this.audio.uiMove(); } }
  setScene(s: SceneMode): void { if (s !== this.sceneMode) { this.sceneMode = s; this.audio.uiMove(); } }
  setOffset(delta: number): void {
    this.offsetMs = Math.max(-120, Math.min(120, this.offsetMs + delta));
    try { localStorage.setItem('blobArcade.beat.offset', String(this.offsetMs)); } catch { /* stockage indisponible */ }
    this.audio.uiMove();
  }

  confirm(): void {
    const entry = this.currentEntry();
    this.diff = DIFFS[this.diffKey];
    this.LANES = laneXs(this.diff.lanes);
    this.laneActions = laneActionsFor(this.diff.lanes);
    this.fallT = this.diff.fallT;
    this.bestKey = this.meta.id + (entry ? '.custom' : '.' + this.diffKey);
    RhythmGame.lastDiff = this.diffKey;
    RhythmGame.lastScene = this.sceneMode;
    this.blob.x = 640; this.blob.y = 656; this.blob.r = 24;
    this.blobBaseX = 640; this.blobBaseY = 656;
    this.stage = 0;
    this.effW = [0, 0, 0, 0, 0, 0];
    this.layFrom = this.layTo = 'classic';
    this._mk = 1;
    this.laySeg = 0;
    this.hintT = 3.4;
    if (entry) { this.launchCustom(entry); return; }
    this.isCustom = false;
    this.trackName = 'Générée';
    this.spb = SPB;
    this.countIn = START_BEAT * SPB;
    this.chart = this.buildChart(this.diff);
    this.songEnd = TOTAL_BEATS * SPB + SPB * 4;
    this.state = 'play';
    this.audio.startMusic('rhythm', { chart: this.chart });
  }

  async launchCustom(entry: PlaylistEntry): Promise<void> {
    this.state = 'loading';
    try {
      this.loadingMsg = 'Décodage : ' + entry.name;
      const context = this.audio.ctx;
      if (!context) throw new Error('Contexte audio indisponible');
      let buffer = entry.buffer;
      if (!buffer) buffer = await context.decodeAudioData(entry.bytes.slice(0));
      entry.buffer = buffer;
      const bpm = entry.analysis.bpm || 120;
      const spb = Math.max(0.4, Math.min(0.72, 60 / bpm));
      const countIn = 4 * spb;
      this.loadingMsg = 'Génération du chart…';
      await new Promise((r) => setTimeout(r, 30));
      this.chart = this.buildChartFromAnalysis(entry.analysis, this.diff, countIn);
      this.songEnd = countIn + entry.analysis.duration + 1;
      this.isCustom = true;
      this.trackName = entry.name;
      this.spb = 60 / bpm;
      this.countIn = countIn;
      this.chartIdx = 0;
      this.notes = [];
      this.holds = [];
      this.state = 'play';
      this.loadingMsg = null;
      this.audio.startTrack(buffer, { countIn, bpm });
    } catch (err: unknown) {
      this.loadingMsg = null;
      this.state = 'select';
      this.eng.showError('Audio illisible : ' + (err instanceof Error ? err.message : String(err)));
    }
  }

  // appelé par main.js après le sélecteur de fichiers / dossier
  async onFilesChosen(files: File[]): Promise<void> {
    const list = [...files].filter((f) =>
      /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|webm)$/i.test(f.name) || f.type.startsWith('audio'));
    if (!list.length) { this.eng.showError('Aucun fichier audio dans la sélection'); return; }
    const context = this.audio.ctx;
    if (!context) { this.eng.showError('Clique une fois pour activer le son, puis recharge les pistes'); return; }
    this.state = 'loading';
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      try {
        this.loadingMsg = `Analyse ${i + 1}/${list.length} : ${f.name}`;
        const bytes = await f.arrayBuffer();
        const buf = await context.decodeAudioData(bytes.slice(0));
        await new Promise((r) => setTimeout(r, 30)); // laisse peindre l'UI
        const analysis = await analyzeBuffer(buf);
        RhythmGame.playlist.push({ name: f.name.replace(/\.[^.]+$/, ''), bytes, analysis, duration: buf.duration });
      } catch (err: unknown) {
        this.eng.showError('Piste ignorée — ' + f.name + ' : ' + (err instanceof Error ? err.message : String(err)));
      }
    }
    this.loadingMsg = null;
    this.state = 'select';
    this.clampMusicIdx();
  }

  // ---------- charts (une seule note par instant : le blob circule) ----------
  buildChart(d: Difficulty): ChartEvent[] {
    const events: ChartEvent[] = [];
    for (let b = 4; b < START_BEAT; b++) events.push({ t: b * SPB, lane: -1, drum: 'tick', dur: 0 });
    const lanes = [0, 1, 2, 3].slice(0, d.lanes);
    const freeUntil = new Array(d.lanes).fill(0);
    let last = -1, run = 0;
    const pick = (free: number[]): number => {
      if (!free.length) return -1;
      let cand = run >= 2 ? free.filter((l) => l !== last) : free;
      if (!cand.length) cand = free;
      const l = cand[(Math.random() * cand.length) | 0];
      run = l === last ? run + 1 : 0;
      last = l;
      return l;
    };
    for (let b = START_BEAT; b < TOTAL_BEATS; b++) {
      // montée douce : la densité plafonne tôt, ce sont les effets et les scènes qui font la montée
      const ph = Math.min(4, Math.floor(b / 40));
      const drum = b % 2 === 1 ? 'snare' : 'kick';
      if (Math.random() < d.hat[ph]) {
        const lh = pick(lanes.filter((l) => freeUntil[l] <= b - 0.5 + 1e-9));
        if (lh >= 0) {
          events.push({ t: (b - 0.5) * SPB, lane: lh, drum: 'hat', dur: 0 });
          freeUntil[lh] = Math.max(freeUntil[lh], b);
        }
      }
      const fb = lanes.filter((l) => freeUntil[l] <= b + 1e-9);
      const lane = pick(fb);
      if (lane < 0) continue;
      freeUntil[lane] = Math.max(freeUntil[lane], b + 0.5);
      events.push({ t: b * SPB, lane, drum, dur: 0 });
    }
    events.sort((x, y) => x.t - y.t);
    return events;
  }

  // chart depuis l'analyse d'une piste : onsets → notes selon la difficulté
  buildChartFromAnalysis(an: AudioAnalysis, d: Difficulty, countIn: number): ChartEvent[] {
    const key = this.diffKey;
    const perSec: Record<DifficultyKey, number> = { facile: 2, normal: 3, difficile: 5, expert: 7 };
    const minGap: Record<DifficultyKey, number> = { facile: 0.42, normal: 0.3, difficile: 0.22, expert: 0.17 };
    const lanes = d.lanes;

    // 1. densité : les K onsets les plus forts par seconde
    const bySec = new Map<number, AudioAnalysis['onsets']>();
    for (const o of an.onsets) {
      const s = Math.floor(o.t);
      const bucket = bySec.get(s);
      if (bucket) bucket.push(o);
      else bySec.set(s, [o]);
    }
    const kept: AudioAnalysis['onsets'] = [];
    for (const arr of bySec.values()) {
      arr.sort((a, b) => b.s - a.s);
      kept.push(...arr.slice(0, perSec[key]));
    }
    kept.sort((a, b) => a.t - b.t);

    // 2. une seule note par instant : on garde l'impact le plus fort de chaque groupe
    const spaced: AudioAnalysis['onsets'] = [];
    let lastT = -9;
    for (const o of kept) {
      if (o.t - lastT >= minGap[key]) { spaced.push(o); lastT = o.t; }
    }

    // 3. lanes : bande préférée + variation
    const events: ChartEvent[] = [];
    let last = -1, run = 0;
    const busy = new Array(lanes).fill(-1);
    const pref: Record<number, number> = { 0: 0, 1: Math.floor((lanes - 1) / 2), 2: lanes - 1 };
    for (const o of spaced) {
      let lane = pref[o.band];
      if (Math.random() < 0.35) lane = Math.max(0, Math.min(lanes - 1, lane + (Math.random() < 0.5 ? -1 : 1)));
      if (lane === last && run >= 2) lane = (lane + 1) % lanes;
      let tries = 0;
      while (busy[lane] > o.t && tries++ < lanes) lane = (lane + 1) % lanes;
      if (busy[lane] > o.t) continue;
      run = lane === last ? run + 1 : 0;
      last = lane;
      busy[lane] = o.t + 0.28;
      events.push({ t: countIn + o.t, lane, drum: 'music', dur: 0 });
    }
    events.sort((x, y) => x.t - y.t);
    return events;
  }

  songT(): number {
    const a = this.audio;
    let raw;
    if (a.trackMode) raw = a.trackPos() + (a.trackCountIn || 0);
    else if (a.musicOn && a.ctx && a.ctx.state === 'running') raw = a.songTime();
    else {
      if (this._fbStart === undefined) this._fbStart = performance.now() / 1000;
      raw = performance.now() / 1000 - this._fbStart;
    }
    // calibrage : décale notes/jugement par rapport au son (latence système)
    return raw - this.offsetMs / 1000;
  }

  // ---------- géométrie des trajectoires ----------
  pathPos(lay: LayoutKey, lane: number, p: number): Point {
    const L = LAYOUTS[lay], n = this.diff.lanes;
    const a = L.spawn(lane, n), b = L.hit(lane, n);
    return { x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p };
  }
  hitPos(lane: number): Point {
    const n = this.diff.lanes, k = this._mk;
    const L = LAYOUTS[this.layFrom], B = LAYOUTS[this.layTo];
    const a = L.hit(lane, n), b = B.hit(lane, n);
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
  }
  notePos(n: RuntimeNote, songT: number): Point & { p: number } {
    const p = 1 - (n.t - songT) / this.fallT;
    const k = this._mk;
    const a = this.pathPos(this.layFrom, n.lane, p);
    if (k >= 1) return { x: a.x, y: a.y, p };
    const b = this.pathPos(this.layTo, n.lane, p);
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, p };
  }

  yAt(t: number, songT: number): number { return HIT_Y - ((t - songT) / this.fallT) * (HIT_Y - SPAWN_Y); }

  stickLane(): number {
    const x = this.input.moveX, y = this.input.moveY;
    if (Math.hypot(x, y) < 0.4) return -1;
    if (Math.abs(x) > Math.abs(y)) return x > 0 ? this.diff.lanes - 1 : 0;
    return this.diff.lanes === 3 ? 1 : (y > 0 ? 1 : 2);
  }

  laneHeld(i: number): boolean {
    const I = this.input;
    if (this.laneActions[i].some((act) => I.down(act))) return true;
    return this.stickLane() === i;
  }

  laneCol(i: number): string {
    const h = (LANE_HUES[i] + this.effHue + 360) % 360;
    return `hsl(${h}, 85%, 66%)`;
  }

  // déformation latérale "gelée" (fonction de y : notes et récepteurs restent alignés)
  wobX(y: number): number { return Math.sin(y * 0.012 + this.time * 1.5) * this.effWob; }

  override onPauseChange = (paused: boolean): void => {
    if (this.audio.trackMode) {
      if (paused) this.audio.pauseTrack();
      else this.audio.resumeTrack();
    }
  };

  update(dt: number): void {
    if (this.state === 'select') return this.updateSelect(dt);
    if (this.state === 'loading') { this.time += dt; return; }
    if (this.state === 'calib') return this.updateCalib(dt);
    return this.updatePlay(dt);
  }

  // ---------- écran de sélection ----------
  updateSelect(dt: number): void {
    this.time += dt;
    this.pulse = Math.max(0, 1 - ((this.time * 2) % 1) * 2.6);
    const I = this.input;

    const U = I.down('up') || I.moveY < -0.5;
    const D = I.down('down') || I.moveY > 0.5;
    if (I.pressed('up') || (U && !this.pvU)) { this.selRow = (this.selRow + 3) % 4; this.audio.uiMove(); }
    if (I.pressed('down') || (D && !this.pvD)) { this.selRow = (this.selRow + 1) % 4; this.audio.uiMove(); }
    this.pvU = U; this.pvD = D;

    const L = I.down('left') || I.moveX < -0.5;
    const R = I.down('right') || I.moveX > 0.5;
    let dir = I.pressed('left') ? -1 : I.pressed('right') ? 1 : 0;
    if (!dir && ((L && !this.pvL) || (R && !this.pvR))) { dir = L ? -1 : 1; this.navRep = 0.34; }
    else if (!dir && (L || R)) { this.navRep -= dt; if (this.navRep <= 0) { dir = L ? -1 : 1; this.navRep = 0.14; } }
    else if (dir) this.navRep = 0.34;
    this.pvL = L; this.pvR = R;
    if (dir) {
      if (this.selRow === 0) this.setDiff(DIFF_ORDER[(DIFF_ORDER.indexOf(this.diffKey) + (dir > 0 ? 1 : 3)) % 4]);
      else if (this.selRow === 1) {
        this.musicIdx = (this.musicIdx + dir + this.musicOptions().length) % this.musicOptions().length;
        this.audio.uiMove();
      }
      else if (this.selRow === 2) this.setOffset(dir * 5);
      else this.setScene(dir > 0 ? 'morphing' : 'classique');
    }

    const xNow = I.key('KeyX'), cNow = I.key('KeyC');
    if (xNow && !this.pvX) window.__blobArcade?.pickFiles();
    if (cNow && !this.pvC) window.__blobArcade?.pickFolder();
    this.pvX = xNow; this.pvC = cNow;

    if (I.pressed('a') || I.pressed('start')) {
      if (this.selRow === 2) { this.audio.uiOk(); this.enterCalib(); return; }
      this.audio.uiOk();
      this.confirm();
      return;
    }
    if (I.pressed('b') || I.pressed('select') || I.pressed('back')) { this.audio.uiBack(); this.quit(); return; }

    const prevY = this.blob.y;
    this.blob.y = 556 - this.pulse * 12;
    this.blob.vy = (prevY - this.blob.y) / Math.max(dt, 1e-4);
    this.blob.vx = 0;
    this.blob.update(dt);
  }

  // ---------- calibration au métronome ----------
  enterCalib(): void {
    if (!this.audio.ctx) { this.eng.showError('Active le son d\'abord (clique à l\'écran d\'intro)'); return; }
    this.state = 'calib';
    this.calTaps = [];
    this.calTicks = [];
    this.calResult = null;
    this.calEndT = 0;
    this.calNext = this.audio.ctx.currentTime + 0.5;
  }

  updateCalib(dt: number): void {
    this.time += dt;
    const c = this.audio.ctx;
    if (!c) { this.state = 'select'; return; }
    this.anchorPerf = performance.now();
    this.anchorAudio = c.currentTime;

    while (this.calNext < this.anchorAudio + 0.35) {
      this.audio.drum('tick', this.calNext);
      this.calTicks.push(this.calNext);
      this.calNext += 0.5;
    }
    while (this.calTicks.length > 24) this.calTicks.shift();

    const taps: InputTap[] = this.input.taps.splice(0);
    for (const tap of taps) {
      if (!CAL_TAP_ACTIONS.has(tap.a)) continue;
      const at = this.anchorAudio + (tap.t - this.anchorPerf) / 1000;
      let best: number | null = null, bd = 1e9;
      for (const tk of this.calTicks) {
        const d = Math.abs(at - tk);
        if (d < bd) { bd = d; best = tk; }
      }
      if (!best || bd > 0.22) continue;
      let err = at - best;
      if (err > 0.25) err -= 0.5;
      else if (err < -0.25) err += 0.5;
      this.calTaps.push(err);
      if (Math.abs(err) <= 0.035) this.audio.perfect(); else this.audio.good();
      if (this.calTaps.length >= 16) { this.finishCalib(); break; }
    }

    if (this.calResult && this.time > this.calEndT) { this.state = 'select'; this.calResult = null; }

    const I = this.input;
    if (I.pressed('b') || I.pressed('select') || I.pressed('start') || I.pressed('back')) {
      if (this.calTaps.length >= 8) this.finishCalib();
      this.calResult = null;
      this.state = 'select';
      this.audio.uiBack();
    }
  }

  finishCalib(): void {
    const mean = this.calTaps.reduce((a, b) => a + b, 0) / this.calTaps.length;
    const ms = Math.max(-120, Math.min(120, Math.round((mean * 1000) / 5) * 5));
    this.offsetMs = ms;
    try { localStorage.setItem('blobArcade.beat.offset', String(ms)); } catch (e) {}
    this.calResult = { ms, n: this.calTaps.length };
    this.calEndT = this.time + 2.4;
    this.audio.uiOk();
  }

  // ---------- jeu ----------
  updatePlay(dt: number): void {
    if (this.baseUpdate(dt)) return;
    const songT = this.songT();
    this.songTNow = songT;

    while (this.chartIdx < this.chart.length && this.chart[this.chartIdx].t - songT < this.fallT) {
      const ev = this.chart[this.chartIdx];
      if (ev.lane >= 0) this.notes.push({ ...ev, judged: false, x: 0, y: SPAWN_Y, p: 0 });
      this.chartIdx++;
    }

    const beat = this.audio.musicOn && this.audio.ctx?.state === 'running'
      ? this.audio.beat()
      : songT / SPB;
    this.pulse = Math.max(0, 1 - (Math.max(0, beat) % 1) * 2.6);

    // ---- effets scéniques progressifs ----
    const playT = Math.max(0, songT - this.countIn);
    const stg = Math.min(6, Math.floor(playT / STAGE_EVERY));
    if (stg > this.stage && this.state === 'play') {
      this.stage = stg;
      this.audio.milestone();
      this.fx.text(640, 170, 'EFFET : ' + STAGE_NAMES[stg - 1], { color: this.accent, size: 24 });
    }
    for (let i = 0; i < 6; i++) {
      const target = this.stage >= i + 1 ? 1 : 0;
      this.effW[i] += (target - this.effW[i]) * Math.min(1, dt * 0.8);
    }
    const [w1, w2, w3, w4, w5, w6] = this.effW;
    this.effHue = Math.sin(this.time * 0.35) * 28 * w4;
    this.effWob = 9 * w5;
    this.fx.zoom = (1 + this.pulse * 0.014 * w1) * (1 + Math.sin(this.time * 0.5) * 0.03 * w6);
    this.fx.userRot = Math.sin(beat * Math.PI / 2) * 0.012 * w3;
    this.fx.userSwayX = Math.sin(beat * Math.PI / 2 + 0.9) * 8 * w2;

    // ---- morphing des scènes ----
    if (this.sceneMode === 'morphing') {
      const seg = Math.floor(playT / LAYOUT_EVERY);
      const into = playT - seg * LAYOUT_EVERY;
      const idx = seg % LAYOUT_ORDER.length;
      if (seg > 0 && into < MORPH_DUR) {
        this.layFrom = LAYOUT_ORDER[(idx + LAYOUT_ORDER.length - 1) % LAYOUT_ORDER.length];
        this.layTo = LAYOUT_ORDER[idx];
        const t = into / MORPH_DUR;
        this._mk = t * t * (3 - 2 * t); // smoothstep
      } else {
        this.layFrom = this.layTo = LAYOUT_ORDER[idx];
        this._mk = 1;
      }
      if (seg !== this.laySeg) {
        this.laySeg = seg;
        if (seg > 0) {
          this.audio.milestone();
          this.fx.text(640, 132, 'SCÈNE : ' + LAYOUT_NAMES[LAYOUT_ORDER[idx]], { color: this.accent, size: 22 });
        }
      }
    } else {
      this.layFrom = this.layTo = 'classic';
      this._mk = 1;
    }

    // notes : positions interpolées entre les deux layouts pendant le morphing
    for (const n of this.notes) {
      if (n.judged) continue;
      const pos = this.notePos(n, songT);
      n.x = pos.x; n.y = pos.y; n.p = pos.p;
      if (songT > n.t + W_GOOD) this.judgeMiss(n);
    }
    this.notes = this.notes.filter((n) => !n.judged && n.p < 1.15);

    for (const h of this.holds) {
      if (!this.laneHeld(h.lane)) {
        if (songT < h.end - 0.12) this.dropHold(h);
        else this.completeHold(h);
        h.done = true;
      } else {
        this.score += 70 * this.mult * dt;
        if (songT >= h.end) { this.completeHold(h); h.done = true; }
      }
    }
    this.holds = this.holds.filter((h) => !h.done);

    const pressed = new Set<number>();
    for (let i = 0; i < this.laneActions.length; i++) {
      for (const act of this.laneActions[i]) if (this.input.pressed(act)) pressed.add(i);
    }
    const sl = this.stickLane();
    if (sl >= 0 && sl !== this.prevStickLane) pressed.add(sl);
    this.prevStickLane = sl;
    for (const li of pressed) this.tryLane(li, songT);

    for (let i = 0; i < 4; i++) this.laneFlash[i] = Math.max(0, this.laneFlash[i] - dt * 5);
    this.comboPop = Math.max(0, this.comboPop - dt * 4);

    if (songT > this.songEnd && this.state === 'play') {
      this.score += this.energy * 20;
      this.over(true);
      this.audio.stopMusic();
      return;
    }

    // le blob glisse vers le récepteur de la dernière note (position morphée)
    const hp = this.hitPos(this.lastLane >= 0 ? this.lastLane : Math.floor(this.diff.lanes / 2));
    const bA = LAYOUTS[this.layFrom].blob, bB = LAYOUTS[this.layTo].blob;
    const btx = bA.x + (bB.x - bA.x) * this._mk;
    const bty = bA.y + (bB.y - bA.y) * this._mk;
    const prevBX = this.blobBaseX, prevBY = this.blobBaseY;
    this.blobBaseX += (btx - this.blobBaseX) * Math.min(1, dt * 3.5);
    this.blobBaseY += (bty - this.blobBaseY) * Math.min(1, dt * 3.5);
    this.blob.x = this.blobBaseX + this.wobX(this.blob.y);
    this.blob.y = this.blobBaseY;
    this.blob.vx = (this.blobBaseX - prevBX) / Math.max(dt, 1e-4);
    this.blob.vy = (this.blobBaseY - prevBY) / Math.max(dt, 1e-4) - Math.abs(Math.sin(Math.max(0, beat) * Math.PI)) * 60;
    this.blob.update(dt);
  }

  tryLane(li: number, songT: number): void {
    this.lastLane = li;
    let best: RuntimeNote | null = null, bestD = 1e9;
    for (const n of this.notes) {
      if (n.judged || n.lane !== li) continue;
      const d = Math.abs(songT - n.t);
      if (d < bestD) { bestD = d; best = n; }
    }
    if (!best || bestD > W_GOOD) { this.audio.whiff(); this.blob.punch(0.12); return; }
    best.judged = true;
    const hp = this.hitPos(li);
    const col = this.laneCol(li);
    this.laneFlash[li] = 1;
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.mult = 1 + Math.min(2, Math.floor(this.combo / 15));
    this.comboPop = 1;
    this.energy = Math.min(100, this.energy + (bestD <= W_PERF ? this.diff.regen + 1 : this.diff.regen));
    this.fx.burst(hp.x, hp.y, { n: 12, speed: [80, 360], colors: [col, '#ffffff'], size: [2, 4.5], life: 0.45, shape: 'spark' });
    this.blob.punch(0.4);
    this.gradeHit(hp.x, hp.y, col, bestD, best.t, songT);
    if (best.dur > 0) this.holds.push({ lane: li, end: best.t + best.dur, x: hp.x, y: hp.y, color: col, done: false });
  }

  gradeHit(x: number, y: number, col: string, bestD: number, noteT: number, songT: number): void {
    if (bestD <= W_PERF) {
      this.score += 150 * this.mult;
      this.audio.perfect();
      this.input.rumble(0.35, 0.06);
      this.fx.ring(x, y, { r0: 20, r1: 95, color: '#ffd166', life: 0.3 });
      this.fx.text(x, y - 64, 'PARFAIT', { color: '#ffd166', size: 21 });
    } else {
      const great = bestD <= W_GREAT;
      this.score += (great ? 100 : 50) * this.mult;
      this.audio.good();
      this.input.rumble(0.18, 0.05);
      this.fx.text(x, y - 64, great ? 'BIEN' : 'OK', { color: great ? '#9be8ff' : '#8b95a8', size: great ? 19 : 17 });
      this.fx.text(x, y - 38, songT < noteT ? 'tôt' : 'tard', { color: '#6a7488', size: 13 });
    }
  }

  dropHold(h: HoldNote): void {
    this.combo = 0;
    this.mult = 1;
    this.energy -= this.diff.drain * 0.5;
    this.audio.miss();
    this.fx.flash('#ff2d55', 0.08);
    this.fx.shake(0.22);
    this.fx.text(h.x, h.y - 64, 'LÂCHÉ', { color: '#ff5470', size: 20 });
    this.blob.punch(0.5);
    if (this.energy <= 0) { this.energy = 0; this.over(); this.audio.stopMusic(); }
  }

  completeHold(h: HoldNote): void {
    this.score += 60 * this.mult;
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.comboPop = 1;
    this.audio.perfect();
    this.input.rumble(0.3, 0.08);
    this.fx.ring(h.x, h.y, { r0: 18, r1: 80, color: h.color, life: 0.3 });
    this.fx.text(h.x, h.y - 64, 'TENU !', { color: h.color, size: 20 });
  }

  judgeMiss(n: RuntimeNote): void {
    n.judged = true;
    this.combo = 0;
    this.mult = 1;
    this.energy -= this.diff.drain;
    this.audio.miss();
    this.fx.flash('#ff2d55', 0.1);
    this.fx.shake(0.28);
    this.fx.text(n.x, n.y - 64, 'RATÉ', { color: '#ff5470', size: 20 });
    this.blob.punch(0.5);
    if (this.energy <= 0) { this.energy = 0; this.over(); this.audio.stopMusic(); }
  }

  override over(win = false): void {
    super.over(win);
    this.audio.stopMusic();
    if (Math.floor(this.score) > UI.getBest(this.meta.id)) {
      UI.saveBest(this.meta.id, Math.floor(this.score));
    }
  }

  // ---------- rendu ----------
  render(ctx: CanvasRenderingContext2D): void {
    if (this.state === 'select') return this.renderSelect(ctx);
    if (this.state === 'loading') return this.renderLoading(ctx);
    if (this.state === 'calib') return this.renderCalib(ctx);
    return this.renderPlay(ctx);
  }

  renderSelect(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#0b0812';
    ctx.fillRect(0, 0, 1280, 720);

    this.fx.world(ctx);
    UI.grid(ctx, { gap: 72, off: this.time * 8, alpha: 0.03, color: '#f9a8d4' });
    this.blob.render(ctx);
    this.fx.drawWorld(ctx);
    this.fx.endWorld(ctx);

    const d = DIFFS[this.diffKey];
    UI.txt(ctx, 'BLOB BEAT', 640, 96, { size: 50, align: 'center', weight: 900, color: this.accent });
    UI.txt(ctx, 'CHOISIS TA DIFFICULTÉ', 640, 134, { size: 14, align: 'center', color: '#8b95a8' });

    const opts = this.musicOptions();
    const musicName = opts[Math.min(this.musicIdx, opts.length - 1)]?.name ?? 'Générée';
    const rows = [
      { label: 'DIFFICULTÉ', value: d.label },
      { label: 'MUSIQUE', value: trunc(musicName, 32) },
      { label: 'CALIBRAGE', value: (this.offsetMs > 0 ? '+' : '') + this.offsetMs + ' ms' },
      { label: 'SCÈNE', value: this.sceneMode === 'morphing' ? 'Morphing' : 'Classique' },
    ];
    for (let i = 0; i < rows.length; i++) {
      const y = 196 + i * 52;
      const sel = i === this.selRow;
      if (sel) UI.panel(ctx, 640 - 280, y - 23, 560, 43, { radius: 12, fill: 'rgba(255,255,255,0.06)', stroke: this.accent + 'aa' });
      UI.txt(ctx, rows[i].label, 640 - 258, y + 4, { size: 13, color: sel ? '#ffffff' : '#6a7488' });
      UI.txt(ctx, (sel ? '◀  ' : '') + rows[i].value + (sel ? '  ▶' : ''), 640 + 258, y + 5, {
        size: 17, align: 'right', weight: 800, color: sel ? '#ffffff' : '#b9c2d0',
      });
    }

    const feats = [
      d.lanes + ' colonnes',
      'densité douce',
      'effets progressifs',
      this.sceneMode === 'morphing' ? 'scènes morphing' : 'scène fixe',
    ];
    UI.txt(ctx, feats.join('    ·    '), 640, 434, { size: 15, align: 'center', color: '#c3cbd8' });
    UI.txt(ctx, 'Calibrage : si tes frappes semblent décalées, fais le test au métronome.', 640, 464, { size: 12, align: 'center', color: '#7c8698' });

    UI.txt(ctx, '▲▼ ligne    ◀▶ régler    X fichiers    C dossier    A lancer    B menu', 640, 622, { size: 15, align: 'center', color: '#dfe6f0' });
    UI.txt(ctx, 'A sur CALIBRAGE : test au métronome · SCÈNE Morphing : la géométrie se transforme', 640, 650, { size: 12, align: 'center', color: '#7c8698' });
    const best = UI.getBest(this.meta.id + '.' + this.diffKey);
    UI.txt(ctx, 'Record ' + d.label + ' : ' + (best > 0 ? UI.fmt(best) + ' pts' : '—'), 640, 682, { size: 14, align: 'center', mono: true, color: '#f9a8d4' });
  }

  renderLoading(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#0b0812';
    ctx.fillRect(0, 0, 1280, 720);
    const dots = '.'.repeat(1 + (Math.floor(this.time * 3) % 3));
    UI.txt(ctx, 'CHARGEMENT' + dots, 640, 316, { size: 38, align: 'center', weight: 900, color: this.accent });
    UI.txt(ctx, trunc(this.loadingMsg || '…', 60), 640, 376, { size: 18, align: 'center', color: '#c3cbd8' });
  }

  renderCalib(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#0b0812';
    ctx.fillRect(0, 0, 1280, 720);

    const c = this.audio.ctx;
    const lt = this.calTicks[this.calTicks.length - 1] ?? 0;
    let ph = c ? ((c.currentTime - lt) / 0.5) % 1 : 0;
    if (ph < 0) ph += 1;
    const p = Math.max(0, 1 - ph * 2.2);

    this.fx.world(ctx);
    UI.grid(ctx, { gap: 72, off: this.time * 8, alpha: 0.03, color: '#f9a8d4' });
    ctx.beginPath();
    ctx.arc(640, 300, 62 + p * 26, 0, 6.2832);
    ctx.strokeStyle = this.accent;
    ctx.lineWidth = 4 + p * 7;
    ctx.globalAlpha = 0.35 + p * 0.55;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(640, 300, 14, 0, 6.2832);
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 0.5 + p * 0.5;
    ctx.fill();
    ctx.globalAlpha = 1;
    this.blob.render(ctx);
    this.fx.drawWorld(ctx);
    this.fx.endWorld(ctx);

    UI.txt(ctx, 'CALIBRAGE', 640, 104, { size: 44, align: 'center', weight: 900, color: this.accent });
    UI.txt(ctx, 'frappe (A, toute touche de jeu) pile quand le cercle flash', 640, 146, { size: 16, align: 'center', color: '#dfe6f0' });
    UI.txt(ctx, this.calTaps.length + ' / 16', 640, 470, { size: 30, align: 'center', mono: true, color: '#ffffff' });
    if (this.calTaps.length >= 3) {
      const mean = this.calTaps.reduce((a, b) => a + b, 0) / this.calTaps.length;
      const ms = Math.round(mean * 1000);
      UI.txt(ctx, 'décalage moyen : ' + (ms > 0 ? '+' : '') + ms + ' ms', 640, 516, { size: 18, align: 'center', color: '#9be8ff', mono: true });
    }
    if (this.calResult) {
      UI.txt(ctx, 'Calibrage appliqué : ' + (this.calResult.ms > 0 ? '+' : '') + this.calResult.ms + ' ms ✓', 640, 580, {
        size: 24, align: 'center', weight: 900, color: '#a3e635',
      });
    }
    UI.txt(ctx, 'B retour' + (this.calResult ? '' : '   ·   16 frappes suffisent'), 640, 656, { size: 14, align: 'center', color: '#7c8698' });
  }

  renderPlay(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#0b0812';
    ctx.fillRect(0, 0, 1280, 720);

    this.fx.world(ctx);

    const lanes = this.diff.lanes;
    const cols = this.LANES.map((_, i) => this.laneCol(i));
    const mk = this._mk;

    // colonnes (layout classic) fondu contre lignes de trajectoire (autres layouts)
    const colA = (LAYOUTS[this.layFrom].columns ? 1 : 0) * (1 - mk) + (LAYOUTS[this.layTo].columns ? 1 : 0) * mk;
    if (colA > 0.01) {
      for (let i = 0; i < lanes; i++) {
        const x = this.LANES[i];
        ctx.fillStyle = 'rgba(255,255,255,0.028)';
        ctx.globalAlpha = colA;
        ctx.fillRect(x - 42, 0, 84, 648);
        if (this.laneFlash[i] > 0) {
          ctx.globalAlpha = this.laneFlash[i] * 0.3 * colA;
          ctx.fillStyle = cols[i];
          ctx.fillRect(x - 42, 0, 84, 648);
        }
        ctx.globalAlpha = 1;
      }
    }
    const pathA = 1 - colA;
    if (pathA > 0.01) {
      for (let i = 0; i < lanes; i++) {
        const a = this.pathPos(this.layFrom, i, 0), a2 = this.pathPos(this.layTo, i, 0);
        const sx = a.x + (a2.x - a.x) * mk, sy = a.y + (a2.y - a.y) * mk;
        const hp = this.hitPos(i);
        ctx.lineCap = 'round';
        ctx.strokeStyle = `rgba(255,255,255,${(0.045 + this.laneFlash[i] * 0.35) * pathA})`;
        ctx.lineWidth = 30;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(hp.x, hp.y); ctx.stroke();
        ctx.strokeStyle = cols[i];
        ctx.globalAlpha = (0.14 + this.laneFlash[i] * 0.5) * pathA;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(hp.x, hp.y); ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // récepteurs + étiquettes (position morphée)
    const LBL = laneGlyphs(lanes);
    const FACE = laneFaces(lanes);
    for (let i = 0; i < lanes; i++) {
      const hp = this.hitPos(i);
      const x = hp.x + this.wobX(hp.y);
      const r = 26 + this.pulse * 6 + this.laneFlash[i] * 8;
      ctx.beginPath();
      ctx.arc(x, hp.y, r, 0, 6.2832);
      ctx.fillStyle = 'rgba(5,6,12,0.6)';
      ctx.fill();
      ctx.strokeStyle = cols[i];
      ctx.lineWidth = 3;
      ctx.globalAlpha = 0.55 + this.laneFlash[i] * 0.45;
      ctx.stroke();
      ctx.globalAlpha = 1;
      UI.txt(ctx, LBL[i], x, hp.y + 8, { size: 15, align: 'center', color: 'rgba(255,255,255,0.45)' });
      UI.txt(ctx, FACE[i], x, hp.y + 40, { size: 11, align: 'center', color: cols[i] + '88' });
    }

    // notes
    for (const n of this.notes) {
      if (n.judged) continue;
      const col = cols[n.lane];
      const x = n.x + this.wobX(n.y);
      if (n.dur > 0) {
        const ty = Math.max(40, this.yAt(n.t + n.dur, this.songTNow));
        ctx.strokeStyle = col;
        ctx.globalAlpha = 0.45;
        ctx.lineWidth = 13;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x, n.y);
        ctx.lineTo(x, ty);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.shadowColor = col;
      ctx.shadowBlur = 14;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(x, n.y, 19, 0, 6.2832);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.beginPath();
      ctx.arc(x, n.y, 7, 0, 6.2832);
      ctx.fill();
    }

    for (const h of this.holds) {
      const ty = Math.max(40, this.yAt(h.end, this.songTNow));
      const hp = this.hitPos(h.lane);
      const hx = hp.x + this.wobX(hp.y);
      ctx.strokeStyle = h.color;
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 13;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(hx, hp.y);
      ctx.lineTo(hx, ty);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(hx, hp.y, 26 + this.pulse * 8, 0, 6.2832);
      ctx.fillStyle = h.color + '44';
      ctx.fill();
    }

    // décompte métronomique
    if (this.state === 'play') {
      let showN = 0, go = false;
      if (this.isCustom) {
        const remain = this.countIn - this.songTNow;
        if (remain > 0) showN = Math.ceil(remain / this.spb);
        else if (remain > -this.spb) go = true;
      } else {
        const cf = this.songTNow / SPB;
        if (cf >= 4 && cf < START_BEAT) showN = START_BEAT - Math.floor(cf);
        else if (cf >= START_BEAT && cf < START_BEAT + 1) go = true;
      }
      if (showN > 0) {
        const s = 1 + (1 - ((this.songTNow / this.spb) % 1)) * 0.25;
        ctx.save();
        ctx.translate(640, 290);
        ctx.scale(s, s);
        UI.txt(ctx, String(showN), 0, 0, { size: 96, align: 'center', color: '#ffffff', weight: 900 });
        ctx.restore();
        UI.txt(ctx, 'prépare-toi', 640, 348, { size: 16, align: 'center', color: '#8b95a8' });
      } else if (go) {
        UI.txt(ctx, 'GO !', 640, 290, { size: 58, align: 'center', color: this.accent, weight: 900 });
      }
    }

    this.blob.render(ctx);
    this.fx.drawWorld(ctx);
    this.fx.endWorld(ctx);

    // HUD
    const ew = 400, ex = 640 - ew / 2;
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(ex, 24, ew, 10);
    ctx.fillStyle = `hsl(${this.energy * 1.2}, 85%, 60%)`;
    ctx.fillRect(ex, 24, ew * (this.energy / 100), 10);
    UI.txt(ctx, this.diff.label + ' · ' + lanes + ' col', 28, 44, { size: 14, mono: true, color: '#7c8698' });
    if (this.isCustom) UI.txt(ctx, '♪ ' + trunc(this.trackName, 30), 28, 64, { size: 12, color: '#c3cbd8' });

    if (this.combo > 1) {
      ctx.save();
      ctx.translate(640, 220);
      const s = 1 + this.comboPop * 0.3;
      ctx.scale(s, s);
      UI.txt(ctx, String(this.combo), 0, 0, { size: 62, align: 'center', weight: 900, color: '#ffffff' });
      UI.txt(ctx, 'COMBO  ×' + this.mult, 0, 36, { size: 19, align: 'center', color: this.accent });
      ctx.restore();
    }

    UI.panel(ctx, 1088, 14, 176, 58, { radius: 14, fill: 'rgba(7, 10, 17, 0.68)', stroke: this.accent + '38', lineWidth: 1.25 });
    UI.txt(ctx, 'SCORE', 1106, 31, { size: 9, mono: true, color: this.accent, weight: 900 });
    UI.txt(ctx, UI.fmt(this.score), 1252, 48, { size: 26, align: 'right', mono: true, weight: 700, shadow: true });
    UI.txt(ctx, 'MAX ' + UI.fmt(UI.getBest(this.meta.id)), 1252, 66, { size: 11, align: 'right', color: '#7c8698' });

    this.drawCommon(ctx);
  }
}
