// BLOB BLOOM — Othello / Reversi organique, 1 à 2 joueurs.
// On n'y retourne pas des pièces : on contamine de la matière. Poser un Blob
// envoie une onde le long de chaque ligne encadrée (●~~~~○~~~~○~~~~●) puis le
// territoire bascule d'écosystème (●════●════●) : FLORA (fleurs, filaments,
// organismes) contre CRISTAL (cristaux, énergie, spores). Gros retournement =
// silence (hitstop) puis WHOOOM, vague sur toute l'arène. Solo = duel contre
// l'IA ; local = duel cérébral à deux, qui manque au hub.

import { BaseGame } from '../core/game';
import { Blob } from '../core/blob';
import * as UI from '../core/ui';
import type { EngineLike, GameMeta, PlayerInputLike } from '../core/types';

export const BLOOM_SIZE = 8;
export type BloomCell = 0 | 1 | 2;
export type BloomPlayer = 1 | 2;

export const BLOOM_P1 = '#4ade80';
export const BLOOM_P1_DEEP = '#14532d';
export const BLOOM_PETAL = '#f9a8d4';
export const BLOOM_P2 = '#38bdf8';
export const BLOOM_P2_DEEP = '#0c4a6e';
export const BLOOM_FACET = '#e0f2fe';

// Un gros retournement mérite le silence puis le WHOOOM.
export const BLOOM_BIG_FLIP = 8;
const WAVE_DELAY0 = 0.12;
const WAVE_DELAY_PER = 0.09;
const CONVERT_DUR = 0.35;

interface BloomPoint { x: number; y: number; }

export interface BloomRay {
  dx: number;
  dy: number;
  cells: Array<BloomPoint & { d: number }>;
}

export interface BloomMove extends BloomPoint {
  flips: BloomPoint[];
}

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

export function bloomOpponent(player: BloomPlayer): BloomPlayer {
  return player === 1 ? 2 : 1;
}

export function bloomEmptyGrid(): BloomCell[][] {
  return Array.from({ length: BLOOM_SIZE }, () => new Array<BloomCell>(BLOOM_SIZE).fill(0));
}

/** Rayons encadrés par un coup : pour chaque direction, les pions adverses
 *  coincés entre la case jouée et un pion ami, avec leur distance (pour l'onde). */
export function bloomRaysFor(grid: BloomCell[][], player: BloomPlayer, x: number, y: number): BloomRay[] {
  const rays: BloomRay[] = [];
  if (x < 0 || y < 0 || x >= BLOOM_SIZE || y >= BLOOM_SIZE || grid[y][x] !== 0) return rays;
  const foe = bloomOpponent(player);
  for (const [dx, dy] of DIRS) {
    const cells: Array<BloomPoint & { d: number }> = [];
    let nx = x + dx;
    let ny = y + dy;
    let d = 1;
    while (nx >= 0 && ny >= 0 && nx < BLOOM_SIZE && ny < BLOOM_SIZE && grid[ny][nx] === foe) {
      cells.push({ x: nx, y: ny, d });
      nx += dx;
      ny += dy;
      d++;
    }
    if (cells.length > 0 && nx >= 0 && ny >= 0 && nx < BLOOM_SIZE && ny < BLOOM_SIZE && grid[ny][nx] === player) {
      rays.push({ dx, dy, cells });
    }
  }
  return rays;
}

export function bloomFlipsFor(grid: BloomCell[][], player: BloomPlayer, x: number, y: number): BloomPoint[] {
  const flips: BloomPoint[] = [];
  for (const ray of bloomRaysFor(grid, player, x, y)) {
    for (const cell of ray.cells) flips.push({ x: cell.x, y: cell.y });
  }
  return flips;
}

export function bloomLegalMoves(grid: BloomCell[][], player: BloomPlayer): BloomMove[] {
  const moves: BloomMove[] = [];
  for (let y = 0; y < BLOOM_SIZE; y++) {
    for (let x = 0; x < BLOOM_SIZE; x++) {
      if (grid[y][x] !== 0) continue;
      const flips = bloomFlipsFor(grid, player, x, y);
      if (flips.length > 0) moves.push({ x, y, flips });
    }
  }
  return moves;
}

/** Applique un coup sur une COPIE de la grille ; null si illégal. */
export function bloomApplyMove(
  grid: BloomCell[][],
  player: BloomPlayer,
  x: number,
  y: number,
): { grid: BloomCell[][]; flips: BloomPoint[] } | null {
  const flips = bloomFlipsFor(grid, player, x, y);
  if (flips.length === 0) return null;
  const next = grid.map((row) => row.slice());
  next[y][x] = player;
  for (const cell of flips) next[cell.y][cell.x] = player;
  return { grid: next, flips };
}

export function bloomCounts(grid: BloomCell[][]): { p1: number; p2: number; empty: number } {
  let p1 = 0;
  let p2 = 0;
  for (let y = 0; y < BLOOM_SIZE; y++) {
    for (let x = 0; x < BLOOM_SIZE; x++) {
      if (grid[y][x] === 1) p1++;
      else if (grid[y][x] === 2) p2++;
    }
  }
  return { p1, p2, empty: BLOOM_SIZE * BLOOM_SIZE - p1 - p2 };
}

/** 0 = égalité. */
export function bloomWinnerOf(grid: BloomCell[][]): 0 | BloomPlayer {
  const { p1, p2 } = bloomCounts(grid);
  if (p1 === p2) return 0;
  return p1 > p2 ? 1 : 2;
}

// Pondération positionnelle classique : les coins sont de l'or, leurs voisins
// immédiats du poison tant que le coin est vide.
const BLOOM_WEIGHTS: readonly number[] = [
  120, -20, 20, 5, 5, 20, -20, 120,
  -20, -40, -5, -5, -5, -5, -40, -20,
  20, -5, 15, 3, 3, 15, -5, 20,
  5, -5, 3, 3, 3, 3, -5, 5,
  5, -5, 3, 3, 3, 3, -5, 5,
  20, -5, 15, 3, 3, 15, -5, 20,
  -20, -40, -5, -5, -5, -5, -40, -20,
  120, -20, 20, 5, 5, 20, -20, 120,
];

/** Contrat minimal pour l'IA : un tirage flottant seedé suffit. */
export interface BloomRng {
  float(min: number, max: number): number;
}

interface BloomDir { x: number; y: number; }

/** Fusionne croix et stick en UN seul pas : la croix a priorité car le moteur
 *  synthétise moveX/moveY depuis les mêmes touches directionnelles — sans ça,
 *  un appui avance de deux cases (bug Froggy). */
export function bloomMergeDir(edge: BloomDir | null, stick: BloomDir | null): BloomDir | null {
  if (edge) return edge;
  return stick;
}

/** Le stick ne déclenche qu'au changement de direction (pas de mitraillette
 *  en maintien) ; la répétition tenue est gérée par le répéteur du jeu. */
export function bloomStickStep(sd: BloomDir | null, last: BloomDir | null): { step: BloomDir | null; next: BloomDir | null } {
  if (!sd) return { step: null, next: null };
  if (last && sd.x === last.x && sd.y === last.y) return { step: null, next: last };
  return { step: sd, next: sd };
}

/** IA sobre (1-ply positionnel + bruit seedé) : battable, jamais stupide. */
export function bloomChooseMove(
  grid: BloomCell[][],
  player: BloomPlayer,
  rng: BloomRng,
  moves?: BloomMove[],
): BloomMove | null {
  const options = moves ?? bloomLegalMoves(grid, player);
  if (options.length === 0) return null;
  let best = options[0];
  let bestScore = -Infinity;
  for (const move of options) {
    const score = BLOOM_WEIGHTS[move.y * BLOOM_SIZE + move.x]
      + move.flips.length * 1.5
      + rng.float(-4, 4);
    if (score > bestScore) {
      bestScore = score;
      best = move;
    }
  }
  return best;
}

// ---------- présentation ----------

const CELL = 62;
const BOARD_PX = CELL * BLOOM_SIZE; // 496
const BX0 = (1280 - BOARD_PX) / 2; // 392
const BY0 = 118;

const P1_NAME = 'FLORA';
const P2_NAME = 'CRISTAL';

interface WaveCell extends BloomPoint {
  delay: number;
  from: BloomPlayer;
  fired: boolean;
}

interface BloomAnim {
  t: number;
  dur: number;
  moveX: number;
  moveY: number;
  player: BloomPlayer;
  rays: BloomRay[];
  cells: WaveCell[];
  big: boolean;
  boomed: boolean;
}

interface Floater {
  x: number;
  y: number;
  z: number;
  s: number;
}

const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
const TAU = Math.PI * 2;

function hash01(x: number, y: number): number {
  const h = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return h - Math.floor(h);
}

function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k;
}

function parseRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mixCss(a: string, b: string, k: number): string {
  const ca = parseRgb(a);
  const cb = parseRgb(b);
  const t = clamp(k, 0, 1);
  return `rgb(${Math.round(lerp(ca[0], cb[0], t))},${Math.round(lerp(ca[1], cb[1], t))},${Math.round(lerp(ca[2], cb[2], t))})`;
}

export class BloomGame extends BaseGame {
  static meta: GameMeta = {
    id: 'bloom',
    name: 'BLOB BLOOM',
    accent: BLOOM_P1,
    mood: 'bloom',
    desc: 'Othello organique : contamine, fleurisis, cristallise.',
    controls: 'D-pad / Stick : curseur · A : poser · X : règles',
    keys: 'Flèches / ZQSD : curseur · Espace : poser · H : règles',
    hint: 'Encadre une ligne adverse pour la contaminer · gros retournement = WHOOOM',
    unit: 'cases',
    ranks: [44, 38, 32, 24, 0],
    genre: 'puzzle',
    players: { min: 1, max: 2 },
  };

  grid: BloomCell[][] = bloomEmptyGrid();
  current: BloomPlayer = 1;
  cell = { x: 2, y: 3 };
  legal: BloomMove[] = [];
  phase: 'play' | 'wave' | 'pass' = 'play';
  showRules = false;
  anim: BloomAnim | null = null;
  passT = 0;
  passMsg = '';
  moveNum = 1;
  counts = { p1: 2, p2: 2 };
  shown = { p1: 2, p2: 2 };
  winner: 0 | BloomPlayer = 0;
  readonly versus: boolean;
  readonly mascots: [Blob, Blob];
  centerMsg = '';
  centerMsgT = 0;
  // Naissances (échelle élastique) : clé y*8+x → temps restant.
  readonly pops = new Map<number, number>();
  // Répéteur du curseur.
  repDir: { x: number; y: number } | null = null;
  repT = 0;
  lastStick: { x: number; y: number } | null = null;
  curShakeT = 0;
  // IA : réflexion + curseur fantôme qui glisse vers le coup choisi.
  aiT = 0;
  aiChoice: BloomMove | null = null;
  aiFrom = { x: 0, y: 0 };
  aiGlide = 1;
  // Ambiance : deux mondes flottants dont la densité suit le score.
  readonly petals: Floater[] = [];
  readonly spores: Floater[] = [];
  round = 1;

  constructor(engine: EngineLike) {
    super(engine);
    this.versus = this.session.mode === 'local' && this.session.playerCount > 1;
    // Ouverture standard : les 4 cases centrales.
    this.grid[3][3] = 2;
    this.grid[4][4] = 2;
    this.grid[3][4] = 1;
    this.grid[4][3] = 1;
    this.mascots = [
      new Blob({ x: 0, y: 0, r: 34, color: BLOOM_P1 }),
      new Blob({ x: 0, y: 0, r: 34, color: BLOOM_P2 }),
    ];
    this.mascots[0].setEmotion('happy', 1.2);
    const vrng = this.rng.fork(0xb100);
    for (let i = 0; i < 42; i++) {
      this.petals.push({ x: vrng.float(0, 1280), y: vrng.float(0, 720), z: vrng.float(0.25, 1), s: vrng.float(0, TAU) });
      this.spores.push({ x: vrng.float(0, 1280), y: vrng.float(0, 720), z: vrng.float(0.25, 1), s: vrng.float(0, TAU) });
    }
    this.blob.hideTrail = true;
    this.refreshLegal(true);
  }

  private get aiTurn(): boolean {
    return this.current === 2 && !this.versus;
  }

  private playerLabel(player: BloomPlayer): string {
    if (player === 1) return this.versus ? 'JOUEUR 1' : 'TOI';
    return this.versus ? 'JOUEUR 2' : 'IA';
  }

  private sideName(player: BloomPlayer): string {
    return player === 1 ? P1_NAME : P2_NAME;
  }

  private sideColor(player: BloomPlayer): string {
    return player === 1 ? BLOOM_P1 : BLOOM_P2;
  }

  /** Recalcule les coups ; replace le curseur sur une case jouable. */
  private refreshLegal(snapCursor: boolean): void {
    this.legal = bloomLegalMoves(this.grid, this.current);
    if (this.legal.length > 0 && (snapCursor || !this.legal.some((m) => m.x === this.cell.x && m.y === this.cell.y))) {
      this.cell.x = this.legal[0].x;
      this.cell.y = this.legal[0].y;
    }
    this.cell.x = clamp(this.cell.x, 0, BLOOM_SIZE - 1);
    this.cell.y = clamp(this.cell.y, 0, BLOOM_SIZE - 1);
  }

  private isLegal(x: number, y: number): boolean {
    return this.legal.some((m) => m.x === x && m.y === y);
  }

  update(dt: number): void {
    if (this.baseUpdate(dt)) return;
    const input = this.players[this.current - 1];
    if ((input && input.pressed('x')) || this.input.keyPressed('KeyX') || this.input.keyPressed('KeyH')) {
      this.showRules = !this.showRules;
      this.audio.uiMove();
    }
    // Panneau de règles : le monde reste vivant derrière, le jeu est en pause.
    if (this.showRules) {
      this.updateAmbience(dt);
      return;
    }
    this.updateAmbience(dt);

    if (this.phase === 'wave') {
      this.updateWave(dt);
      return;
    }
    if (this.phase === 'pass') {
      this.passT -= dt;
      if (this.passT <= 0) this.afterPass();
      return;
    }

    // Phase 'play'.
    if (this.legal.length === 0) {
      // Aucun coup : passe (ou fin si l'adversaire est bloqué aussi).
      const foe = bloomOpponent(this.current);
      if (bloomLegalMoves(this.grid, foe).length === 0) {
        this.finish();
        return;
      }
      this.phase = 'pass';
      this.passT = 1.5;
      this.passMsg = `${this.sideName(this.current)} PASSE — AUCUN COUP`;
      this.audio.miss();
      this.centerMsg = this.passMsg;
      this.centerMsgT = 1.5;
      return;
    }

    if (this.aiTurn) {
      this.updateAi(dt);
      return;
    }
    const active = this.players[this.current - 1];
    if (active) this.updateCursor(active, dt);

    const confirm = active && (active.pressed('a') || active.pressed('start'));
    if (confirm) {
      if (this.isLegal(this.cell.x, this.cell.y)) this.doPlace(this.cell.x, this.cell.y);
      else {
        this.audio.whiff();
        this.curShakeT = 0.25;
        this.input.player(this.current - 1)?.rumble(0.12, 0.05);
      }
    }
  }

  /** Décor vivant + compteurs glissants : tourne même sous le panneau de règles. */
  private updateAmbience(dt: number): void {
    this.centerMsgT = Math.max(0, this.centerMsgT - dt);
    this.curShakeT = Math.max(0, this.curShakeT - dt);
    for (const [k, t] of this.pops) {
      if (t <= dt) this.pops.delete(k);
      else this.pops.set(k, t - dt);
    }
    // Les compteurs affichés glissent vers les vrais (le monde respire).
    this.shown.p1 += (this.counts.p1 - this.shown.p1) * Math.min(1, dt * 5);
    this.shown.p2 += (this.counts.p2 - this.shown.p2) * Math.min(1, dt * 5);
    if (Math.abs(this.counts.p1 - this.shown.p1) < 0.02) this.shown.p1 = this.counts.p1;
    if (Math.abs(this.counts.p2 - this.shown.p2) < 0.02) this.shown.p2 = this.counts.p2;

    for (const f of this.petals) {
      f.x -= (6 + f.z * 14) * dt;
      f.y += Math.sin(this.time * 0.6 + f.s) * 7 * dt;
      if (f.x < -6) { f.x = 1286; f.y = (f.y + 360) % 720; }
    }
    for (const f of this.spores) {
      f.x += (4 + f.z * 10) * dt;
      f.y += Math.cos(this.time * 0.5 + f.s) * 6 * dt;
      if (f.x > 1286) { f.x = -6; f.y = (f.y + 360) % 720; }
    }

    for (const mascot of this.mascots) mascot.update(dt);
  }

  // ---------- curseur humain (bords + répétition tenue, un appui = une case) ----------
  private updateCursor(input: PlayerInputLike, dt: number): void {
    let edge: BloomDir | null = null;
    if (input.pressed('left')) edge = { x: -1, y: 0 };
    else if (input.pressed('right')) edge = { x: 1, y: 0 };
    else if (input.pressed('up')) edge = { x: 0, y: -1 };
    else if (input.pressed('down')) edge = { x: 0, y: 1 };
    // Direction du stick, lue À CHAQUE frame (y compris quand la croix vient
    // de frapper : sinon le stick "rattrape" le pas à la frame suivante).
    const mx = input.moveX;
    const my = input.moveY;
    const sd: BloomDir | null = (Math.abs(mx) > 0.5 || Math.abs(my) > 0.5)
      ? (Math.abs(mx) > Math.abs(my) ? { x: Math.sign(mx), y: 0 } : { x: 0, y: Math.sign(my) })
      : null;
    const stick = bloomStickStep(sd, this.lastStick);
    this.lastStick = stick.next;
    const step = bloomMergeDir(edge, stick.step);
    const dx = step ? step.x : 0;
    const dy = step ? step.y : 0;
    const held = { x: (input.down('left') ? -1 : 0) + (input.down('right') ? 1 : 0), y: (input.down('up') ? -1 : 0) + (input.down('down') ? 1 : 0) };
    if (dx !== 0 || dy !== 0) {
      this.stepCursor(dx, dy);
      this.repDir = { x: dx, y: dy };
      this.repT = 0.32;
    } else if (this.repDir && (held.x === this.repDir.x && held.y === this.repDir.y) && (held.x !== 0 || held.y !== 0)) {
      this.repT -= dt;
      if (this.repT <= 0) {
        this.stepCursor(this.repDir.x, this.repDir.y);
        this.repT = 0.12;
      }
    } else {
      this.repDir = null;
    }
  }

  private stepCursor(dx: number, dy: number): void {
    const nx = clamp(this.cell.x + dx, 0, BLOOM_SIZE - 1);
    const ny = clamp(this.cell.y + dy, 0, BLOOM_SIZE - 1);
    if (nx !== this.cell.x || ny !== this.cell.y) {
      this.cell.x = nx;
      this.cell.y = ny;
      this.audio.uiMove();
    }
  }

  // ---------- IA ----------
  private updateAi(dt: number): void {
    if (!this.aiChoice) {
      this.aiChoice = bloomChooseMove(this.grid, this.current, this.rng, this.legal);
      this.aiFrom = { x: this.cell.x, y: this.cell.y };
      this.aiGlide = 0;
      this.aiT = 0.75;
      if (!this.aiChoice) return; // sécurité : la passe est gérée en phase play
    }
    this.aiT -= dt;
    this.aiGlide = Math.min(1, this.aiGlide + dt * 2.2);
    if (this.aiChoice) {
      this.cell.x = Math.round(lerp(this.aiFrom.x, this.aiChoice.x, this.aiGlide));
      this.cell.y = Math.round(lerp(this.aiFrom.y, this.aiChoice.y, this.aiGlide));
    }
    if (this.aiT <= 0 && this.aiChoice) {
      const choice = this.aiChoice;
      this.aiChoice = null;
      this.doPlace(choice.x, choice.y);
    }
  }

  // ---------- pose + onde ----------
  private doPlace(x: number, y: number): void {
    const player = this.current;
    const rays = bloomRaysFor(this.grid, player, x, y);
    if (rays.length === 0) return;
    const flips: BloomPoint[] = [];
    const cells: WaveCell[] = [];
    let maxD = 1;
    for (const ray of rays) {
      for (const cell of ray.cells) {
        flips.push({ x: cell.x, y: cell.y });
        cells.push({ x: cell.x, y: cell.y, delay: WAVE_DELAY0 + cell.d * WAVE_DELAY_PER, from: bloomOpponent(player), fired: false });
        maxD = Math.max(maxD, cell.d);
      }
    }
    this.grid[y][x] = player;
    for (const cell of flips) this.grid[cell.y][cell.x] = player;
    this.counts = bloomCounts(this.grid);
    this.pops.set(y * BLOOM_SIZE + x, 0.35);
    this.mascots[player - 1].punch(0.4);
    this.mascots[player - 1].setEmotion('happy', 0.7);

    const big = flips.length >= BLOOM_BIG_FLIP;
    this.anim = {
      t: 0,
      dur: WAVE_DELAY0 + maxD * WAVE_DELAY_PER + CONVERT_DUR + 0.45,
      moveX: x,
      moveY: y,
      player,
      rays,
      cells,
      big,
      boomed: false,
    };
    this.phase = 'wave';

    this.audio.land();
    this.audio.coin(Math.min(12, 2 + flips.length));
    const c = this.cellCenter(x, y);
    this.fx.ring(c.x, c.y, { r0: 10, r1: 60 + flips.length * 4, color: this.sideColor(player), life: 0.35 });
    if (flips.length >= 5) {
      this.audio.perfect();
      this.musicEvent('waveComplete', Math.min(1.2, 0.3 + flips.length * 0.06));
    }
    if (big) {
      // Silence : le monde se fige un bref instant avant le WHOOOM.
      this.fx.stop(0.22);
      this.fx.timeScale = 0.45;
    }
    this.round++;
    if (!this.aiTurn) this.input.player(player - 1)?.rumble(0.2, 0.07);
  }

  private updateWave(dt: number): void {
    const anim = this.anim;
    if (!anim) {
      this.phase = 'play';
      return;
    }
    anim.t += dt;
    // L'onde atteint les cellules : anneau + gerbe aux couleurs du conquérant.
    for (const cell of anim.cells) {
      if (!cell.fired && anim.t >= cell.delay) {
        cell.fired = true;
        const c = this.cellCenter(cell.x, cell.y);
        const color = this.sideColor(anim.player);
        this.fx.ring(c.x, c.y, { r0: 6, r1: 44, color: '#ffffff', life: 0.28, width: 2 });
        this.fx.burst(c.x, c.y, {
          n: 4,
          speed: [40, 180],
          colors: anim.player === 1 ? [BLOOM_P1, BLOOM_PETAL, '#ffffff'] : [BLOOM_P2, BLOOM_FACET, '#ffffff'],
          size: [1.5, 3.5],
          life: 0.4,
        });
        this.pops.set(cell.y * BLOOM_SIZE + cell.x, 0.3);
      }
    }
    if (anim.big && !anim.boomed && anim.t >= 0.45) {
      anim.boomed = true;
      const c = this.cellCenter(anim.moveX, anim.moveY);
      const color = this.sideColor(anim.player);
      this.fx.ring(c.x, c.y, { r0: 20, r1: 760, color, life: 0.7, width: 5 });
      this.fx.ring(c.x, c.y, { r0: 12, r1: 420, color: '#ffffff', life: 0.5, width: 3 });
      this.fx.flash(color, 0.12);
      this.fx.shake(0.55);
      this.audio.explode(0.8);
      this.audio.milestone();
      this.fx.text(c.x, c.y - 70, `RETOURNEMENT ×${anim.cells.length}`, { color: '#ffd166', size: 26 });
      this.musicEvent('waveComplete', 1.2);
      this.input.rumble(0.5, 0.2);
    }
    if (anim.t >= anim.dur) {
      this.anim = null;
      this.fx.timeScale = 1;
      this.moveNum++;
      this.current = bloomOpponent(anim.player);
      this.aiChoice = null;
      this.refreshLegal(true);
      // Humeurs : celui qui est mené s'inquiète.
      const { p1, p2 } = this.counts;
      this.mascots[0].setEmotion(p1 + 6 < p2 ? 'sad' : 'idle');
      this.mascots[1].setEmotion(p2 + 6 < p1 ? 'sad' : 'idle');
      this.mascots[this.current - 1].setEmotion('focused');
      this.phase = 'play';
    }
  }

  private afterPass(): void {
    this.current = bloomOpponent(this.current);
    this.aiChoice = null;
    this.refreshLegal(true);
    this.phase = 'play';
  }

  private finish(): void {
    this.winner = bloomWinnerOf(this.grid);
    this.score = this.counts.p1;
    const win = this.winner === 1;
    this.mascots[0].setEmotion(win ? 'happy' : 'sad');
    this.mascots[1].setEmotion(win ? 'sad' : 'happy');
    if (this.winner === 0) {
      this.mascots[0].setEmotion('idle');
      this.mascots[1].setEmotion('idle');
    }
    this.musicEvent(win ? 'waveComplete' : 'playerHit', 0.8);
    this.over(win);
  }

  cellCenter(x: number, y: number): { x: number; y: number } {
    return { x: BX0 + (x + 0.5) * CELL, y: BY0 + (y + 0.5) * CELL };
  }

  // ---------- rendu ----------
  render(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#04050a';
    ctx.fillRect(0, 0, 1280, 720);
    this.fx.world(ctx);

    this.renderAmbience(ctx);
    this.renderBoard(ctx);
    this.renderTokens(ctx);
    this.renderWavefronts(ctx);
    this.renderCursor(ctx);
    this.fx.drawWorld(ctx);
    this.fx.endWorld(ctx);

    this.renderPanels(ctx);
    this.renderTopBar(ctx);
    if (this.centerMsgT > 0) {
      ctx.globalAlpha = Math.min(1, this.centerMsgT / 0.4);
      UI.txt(ctx, this.centerMsg, 640, 82, { size: 24, align: 'center', color: '#ffd166', weight: 900, shadow: true });
      ctx.globalAlpha = 1;
    }
    if (this.state === 'over') {
      const w = this.winner;
      UI.txt(ctx, w === 0 ? 'ÉGALITÉ PARFAITE' : w === 1 ? '🏆 FLORA L’EMPORTE' : '🏆 CRISTAL L’EMPORTE', 640, 566, {
        size: 26, align: 'center', color: w === 2 ? BLOOM_P2 : BLOOM_P1, weight: 900, shadow: true,
      });
      UI.txt(ctx, `${this.counts.p1} — ${this.counts.p2}`, 640, 596, { size: 20, align: 'center', mono: true, color: '#eaf6ff' });
    }
    if (this.showRules) this.renderRulesModal(ctx);
    this.drawCommon(ctx);
  }

  /** Panneau de règles modal : le complexe devient lisible en six lignes. */
  private renderRulesModal(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = 'rgba(2,3,8,0.72)';
    ctx.fillRect(0, 0, 1280, 720);
    const px = 250;
    const py = 58;
    const pw = 780;
    const ph = 604;
    UI.panel(ctx, px, py, pw, ph, { radius: 22, fill: 'rgba(10,14,24,0.97)', stroke: this.meta.accent + '66', lineWidth: 2 });
    UI.txt(ctx, 'RÈGLES DU BLOOM', 640, py + 44, { size: 30, align: 'center', color: '#eaf6ff', weight: 900 });
    UI.txt(ctx, 'Othello organique — FLORA contre CRISTAL', 640, py + 68, { size: 14, align: 'center', color: '#7c8698' });

    const rules = [
      '1 · À tour de rôle, pose ton Blob sur une case qui clignote.',
      '2 · Le coup doit ENCADRER une ligne adverse : tes pions aux deux bouts, en ligne droite, dans les 8 directions.',
      '3 · Tous les pions encadrés sont contaminés et deviennent tiens.',
      '4 · FLORA commence. Sans aucun coup, tu passes automatiquement.',
      '5 · Fini quand plus personne ne peut jouer : le plus de cases gagne.',
      '6 · Un retournement de 8 pions ou plus déclenche le WHOOOM.',
    ];
    ctx.font = '600 15px "Segoe UI", system-ui, sans-serif';
    let ly = py + 104;
    for (const rule of rules) {
      for (const line of UI.wrap(ctx, rule, pw - 90)) {
        UI.txt(ctx, line, px + 45, ly, { size: 15, color: '#dfe6f0', weight: 600 });
        ly += 22;
      }
      ly += 6;
    }

    // Schéma vivant : AVANT → APRÈS.
    const dy = py + 408;
    UI.txt(ctx, 'EXEMPLE : tu poses ● sur la case entourée', px + 45, dy, { size: 14, color: BLOOM_P1, weight: 800 });
    const mini = (x: number, owner: 0 | 1 | 2, target: boolean): void => {
      ctx.save();
      UI.roundRect(ctx, x, dy + 16, 40, 40, 9);
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fill();
      if (owner !== 0) {
        ctx.fillStyle = owner === 1 ? BLOOM_P1 : BLOOM_P2;
        ctx.shadowColor = ctx.fillStyle as string;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(x + 20, dy + 36, 13, 0, TAU);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
      if (target) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x + 20, dy + 36, 17, 0, TAU);
        ctx.stroke();
      }
      ctx.restore();
    };
    const before: Array<0 | 1 | 2> = [1, 2, 2, 0];
    const after: Array<0 | 1 | 2> = [1, 1, 1, 1];
    for (let i = 0; i < 4; i++) mini(px + 45 + i * 46, before[i], i === 3);
    UI.txt(ctx, '→', px + 45 + 4 * 46 + 12, dy + 46, { size: 26, color: '#ffd166', weight: 900 });
    for (let i = 0; i < 4; i++) mini(px + 45 + 4 * 46 + 48 + i * 46, after[i], false);

    UI.txt(ctx, 'D-pad / Stick : curseur · A : poser · X / H : fermer', 640, py + ph - 26, {
      size: 14, align: 'center', color: '#7c8698',
    });
  }

  /** Le monde vivant reflète l'équilibre : pétales vs spores, halos latéraux. */
  private renderAmbience(ctx: CanvasRenderingContext2D): void {
    const total = Math.max(1, this.counts.p1 + this.counts.p2);
    const share1 = this.counts.p1 / total;
    const share2 = this.counts.p2 / total;
    // Halos latéraux respirants.
    const breathe = 0.5 + 0.5 * Math.sin(this.time * 1.4);
    ctx.save();
    ctx.globalAlpha = 0.05 + share1 * 0.12 * (0.6 + 0.4 * breathe);
    ctx.fillStyle = BLOOM_P1;
    ctx.fillRect(0, 0, 120, 720);
    ctx.globalAlpha = 0.05 + share2 * 0.12 * (0.6 + 0.4 * (1 - breathe));
    ctx.fillStyle = BLOOM_P2;
    ctx.fillRect(1160, 0, 120, 720);
    ctx.restore();
    // Pétales FLORA (dérive gauche) et spores CRISTAL (dérive droite).
    ctx.save();
    const nP = Math.round(this.petals.length * (0.15 + 0.85 * share1));
    for (let i = 0; i < nP; i++) {
      const f = this.petals[i];
      ctx.globalAlpha = 0.10 + f.z * 0.12;
      ctx.fillStyle = i % 3 === 0 ? BLOOM_PETAL : BLOOM_P1;
      ctx.beginPath();
      ctx.ellipse(f.x, f.y, 3.5 * f.z + 1, 2.2 * f.z + 0.6, Math.sin(this.time + f.s) * 0.8, 0, TAU);
      ctx.fill();
    }
    const nS = Math.round(this.spores.length * (0.15 + 0.85 * share2));
    for (let i = 0; i < nS; i++) {
      const f = this.spores[i];
      ctx.globalAlpha = 0.10 + f.z * 0.12;
      ctx.fillStyle = BLOOM_FACET;
      ctx.beginPath();
      ctx.arc(f.x, f.y, 1.6 * f.z + 0.5, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  private renderBoard(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    UI.panel(ctx, BX0 - 14, BY0 - 14, BOARD_PX + 28, BOARD_PX + 28, {
      radius: 18, fill: 'rgba(9,12,19,0.92)', stroke: this.meta.accent + '44', lineWidth: 2,
    });
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < BLOOM_SIZE; i++) {
      ctx.moveTo(BX0 + i * CELL, BY0 + 4);
      ctx.lineTo(BX0 + i * CELL, BY0 + BOARD_PX - 4);
      ctx.moveTo(BX0 + 4, BY0 + i * CELL);
      ctx.lineTo(BX0 + BOARD_PX - 4, BY0 + i * CELL);
    }
    ctx.stroke();
    // Points étoiles façon Othello.
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    for (const [sx, sy] of [[2, 2], [2, 5], [5, 2], [5, 5]] as const) {
      ctx.beginPath();
      ctx.arc(BX0 + (sx + 0.5) * CELL, BY0 + (sy + 0.5) * CELL, 3, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  private renderTokens(ctx: CanvasRenderingContext2D): void {
    const anim = this.anim;
    // Index des cellules en cours de conversion → état (délai, origine).
    const converting = new Map<number, { delay: number; from: BloomPlayer }>();
    if (anim) {
      for (const cell of anim.cells) converting.set(cell.y * BLOOM_SIZE + cell.x, { delay: cell.delay, from: cell.from });
    }
    for (let y = 0; y < BLOOM_SIZE; y++) {
      for (let x = 0; x < BLOOM_SIZE; x++) {
        const owner = this.grid[y][x];
        if (owner === 0) continue;
        const key = y * BLOOM_SIZE + x;
        const conv = converting.get(key);
        const c = this.cellCenter(x, y);
        let scale = 1;
        const pop = this.pops.get(key);
        if (pop !== undefined) {
          const k = 1 - pop / 0.35; // 0 → 1
          scale = 0.3 + 0.7 * (1 + 2.2 * k * k * k - 3.3 * k * k + 1.1 * k + 0.25 * Math.sin(k * Math.PI));
        }
        if (conv && anim) {
          const local = (anim.t - conv.delay) / CONVERT_DUR;
          if (local < 0) {
            // L'onde approche : la matière frémit (~~~~).
            const wob = Math.sin(this.time * 30 + x * 2 + y) * 3 * clamp(1 - (conv.delay - anim.t) / 0.4, 0, 1);
            this.drawToken(ctx, c.x + wob, c.y, owner, scale, 1, x, y);
          } else {
            const k = clamp(local, 0, 1);
            // Morph : flash blanc + bascule d'écosystème.
            this.drawToken(ctx, c.x, c.y, owner, scale * (1 + 0.3 * Math.sin(k * Math.PI)), k, x, y, conv.from);
            if (k < 1) {
              ctx.save();
              ctx.globalAlpha = (1 - k) * 0.7;
              ctx.strokeStyle = '#ffffff';
              ctx.lineWidth = 3;
              ctx.beginPath();
              ctx.arc(c.x, c.y, 24 * scale, 0, TAU);
              ctx.stroke();
              ctx.restore();
            }
          }
        } else {
          this.drawToken(ctx, c.x, c.y, owner, scale, 1, x, y);
        }
      }
    }
  }

  /** Un pion = un micro-écosystème vivant. morph: 0 = from, 1 = owner. */
  private drawToken(
    ctx: CanvasRenderingContext2D, x: number, y: number, owner: BloomPlayer,
    scale: number, alpha: number, gx: number, gy: number, morphFrom?: BloomPlayer,
  ): void {
    const phase = hash01(gx, gy) * TAU;
    const t = this.time;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    const r = 23;

    const bodyA = owner === 1 ? BLOOM_P1 : BLOOM_P2;
    const bodyB = owner === 1 ? BLOOM_P1_DEEP : BLOOM_P2_DEEP;
    const drawBody = (colA: string, colB: string): void => {
      ctx.shadowColor = colA;
      ctx.shadowBlur = 12;
      const g = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.3, colA);
      g.addColorStop(1, colB);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;
    };

    if (morphFrom !== undefined && morphFrom !== owner) {
      // Pendant la bascule on fond les deux matières (contamination visible).
      drawBody(mixCss(morphFrom === 1 ? BLOOM_P1 : BLOOM_P2, bodyA, alpha), bodyB);
    } else {
      drawBody(bodyA, bodyB);
    }

    if (owner === 1) {
      // FLORA : corolle de pétales + filaments.
      const rot = t * 0.5 + phase;
      for (let i = 0; i < 5; i++) {
        const a = rot + (i / 5) * TAU;
        const px = Math.cos(a) * r * 0.62;
        const py = Math.sin(a) * r * 0.62;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(a + Math.sin(t * 2 + phase + i) * 0.25);
        ctx.globalAlpha = alpha * 0.9;
        ctx.fillStyle = i % 2 === 0 ? BLOOM_PETAL : '#ffffff';
        ctx.beginPath();
        ctx.ellipse(0, 0, 7.5, 4.5, 0, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
      ctx.globalAlpha = alpha * 0.75;
      ctx.strokeStyle = '#d9f99d';
      ctx.lineWidth = 1.6;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(s * r * 0.3, r * 0.25, r * 0.45, Math.PI * (0.15 + 0.06 * Math.sin(t * 1.7 + phase)), Math.PI * 0.85);
        ctx.stroke();
      }
      // Cœur-organisme.
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#f0fdf4';
      ctx.beginPath();
      ctx.arc(Math.sin(t * 1.3 + phase) * 2, Math.cos(t * 1.1 + phase) * 2, 4.5, 0, TAU);
      ctx.fill();
    } else {
      // CRISTAL : diamant facetté + spores orbitales.
      const pulse = 1 + 0.04 * Math.sin(t * 2.2 + phase);
      ctx.save();
      ctx.scale(pulse, pulse);
      ctx.globalAlpha = alpha * 0.95;
      ctx.fillStyle = BLOOM_P2;
      ctx.strokeStyle = BLOOM_FACET;
      ctx.lineWidth = 2;
      ctx.shadowColor = BLOOM_P2;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.95);
      ctx.lineTo(r * 0.7, 0);
      ctx.lineTo(0, r * 0.95);
      ctx.lineTo(-r * 0.7, 0);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.stroke();
      ctx.globalAlpha = alpha * 0.8;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.95);
      ctx.lineTo(0, r * 0.95);
      ctx.moveTo(-r * 0.7, 0);
      ctx.lineTo(r * 0.7, 0);
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(-r * 0.18, -r * 0.3, 3, 0, TAU);
      ctx.fill();
      ctx.restore();
      // Spores orbitales.
      for (let i = 0; i < 3; i++) {
        const a = -t * (0.8 + i * 0.2) + phase + (i / 3) * TAU;
        ctx.globalAlpha = alpha * 0.85;
        ctx.fillStyle = BLOOM_FACET;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * r * 1.15, Math.sin(a) * r * 1.15, 2.4, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = alpha;
    }
    ctx.restore();
  }

  /** Fronts d'onde lumineux le long de chaque rayon contaminé. */
  private renderWavefronts(ctx: CanvasRenderingContext2D): void {
    const anim = this.anim;
    if (!anim) return;
    const speed = CELL / WAVE_DELAY_PER;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const ray of anim.rays) {
      const traveled = (anim.t - WAVE_DELAY0) * speed;
      const maxLen = ray.cells.length * CELL;
      if (traveled < 0 || traveled > maxLen + 30) continue;
      const o = this.cellCenter(anim.moveX, anim.moveY);
      const fx = o.x + ray.dx * traveled;
      const fy = o.y + ray.dy * traveled;
      const color = this.sideColor(anim.player);
      const g = ctx.createRadialGradient(fx, fy, 1, fx, fy, 22);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.4, color);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(fx, fy, 22, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  private renderCursor(ctx: CanvasRenderingContext2D): void {
    if (this.phase !== 'play' || this.state !== 'play' || this.showRules) return;
    const gx = this.aiTurn && this.aiChoice ? lerp(this.aiFrom.x, this.aiChoice.x, this.aiGlide) : this.cell.x;
    const gy = this.aiTurn && this.aiChoice ? lerp(this.aiFrom.y, this.aiChoice.y, this.aiGlide) : this.cell.y;
    const px = BX0 + gx * CELL;
    const py = BY0 + gy * CELL;
    const shake = this.curShakeT > 0 ? Math.sin(this.time * 60) * 4 : 0;
    const color = this.sideColor(this.current);
    const pulse = 0.6 + 0.4 * Math.sin(this.time * 5);
    ctx.save();
    ctx.translate(shake, 0);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.65 + pulse * 0.35;
    ctx.lineWidth = 3;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    const L = 16;
    const corners: Array<readonly [number, number, number, number]> = [
      [px + 4, py + 4, 1, 1], [px + CELL - 4, py + 4, -1, 1],
      [px + 4, py + CELL - 4, 1, -1], [px + CELL - 4, py + CELL - 4, -1, -1],
    ];
    for (const [cx, cy, sx, sy] of corners) {
      ctx.beginPath();
      ctx.moveTo(cx + L * sx, cy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, cy + L * sy);
      ctx.stroke();
    }
    ctx.restore();
    // Coups jouables : spores d'invitation.
    ctx.save();
    for (const move of this.legal) {
      const c = this.cellCenter(move.x, move.y);
      const isCur = move.x === this.cell.x && move.y === this.cell.y;
      ctx.globalAlpha = isCur ? 0.85 : 0.35 + 0.2 * Math.sin(this.time * 4 + move.x + move.y);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(c.x, c.y, isCur ? 8 : 6, 0, TAU);
      ctx.fill();
      if (isCur) {
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(c.x, c.y, 13 + pulse * 4, 0, TAU);
        ctx.stroke();
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  private renderPanels(ctx: CanvasRenderingContext2D): void {
    this.sidePanel(ctx, 1, 56, this.versus ? 'JOUEUR 1' : 'TOI');
    this.sidePanel(ctx, 2, 924, this.versus ? 'JOUEUR 2' : 'IA');
  }

  private sidePanel(ctx: CanvasRenderingContext2D, player: BloomPlayer, x: number, label: string): void {
    const active = this.current === player && this.state === 'play';
    const color = this.sideColor(player);
    const count = player === 1 ? Math.round(this.shown.p1) : Math.round(this.shown.p2);
    ctx.save();
    UI.panel(ctx, x, 150, 300, 420, {
      radius: 18,
      fill: active ? 'rgba(14,20,32,0.95)' : 'rgba(9,12,19,0.88)',
      stroke: active ? color + 'aa' : color + '33',
      lineWidth: active ? 2.5 : 1.5,
    });
    const mascot = this.mascots[player - 1];
    mascot.x = x + 150;
    mascot.y = 250;
    mascot.render(ctx);
    UI.txt(ctx, this.sideName(player), x + 150, 320, { size: 26, align: 'center', color, weight: 900 });
    UI.txt(ctx, label + (active ? ' · À TOI' : ''), x + 150, 344, {
      size: 13, align: 'center', mono: true, color: active ? '#eaf6ff' : '#7c8698',
    });
    UI.txt(ctx, String(count), x + 150, 430, { size: 72, align: 'center', mono: true, color: '#eaf6ff', weight: 700, shadow: true });
    UI.txt(ctx, 'cases', x + 150, 452, { size: 13, align: 'center', color: '#7c8698' });
    // Derniers coups jouables restants (lisibilité stratégique).
    const moves = player === this.current ? this.legal.length : bloomLegalMoves(this.grid, player).length;
    UI.txt(ctx, this.state === 'play' ? `coups : ${moves}` : '—', x + 150, 500, {
      size: 14, align: 'center', mono: true, color: moves === 0 && this.state === 'play' ? '#ff8a9a' : '#7c8698',
    });
    if (active) {
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 5);
      ctx.globalAlpha = 0.5 + pulse * 0.5;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x + 150, 536, 6, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  private renderTopBar(ctx: CanvasRenderingContext2D): void {
    UI.txt(ctx, 'BLOB BLOOM', 640, 40, { size: 26, align: 'center', color: '#eaf6ff', weight: 900, shadow: true });
    UI.txt(ctx, `COUP ${this.moveNum}`, 640, 62, { size: 13, align: 'center', mono: true, color: '#7c8698' });
    // Barre d'équilibre animée : le monde tient dans 400 px.
    const bw = 400;
    const bx = 640 - bw / 2;
    const by = 76;
    const total = Math.max(1, this.shown.p1 + this.shown.p2);
    const w1 = bw * (this.shown.p1 / total);
    ctx.save();
    UI.roundRect(ctx, bx, by, bw, 12, 6);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fill();
    UI.roundRect(ctx, bx, by, bw, 12, 6);
    ctx.clip();
    ctx.fillStyle = BLOOM_P1;
    ctx.fillRect(bx, by, w1, 12);
    ctx.fillStyle = BLOOM_P2;
    ctx.fillRect(bx + w1, by, bw - w1, 12);
    ctx.restore();
    UI.txt(ctx, `${Math.round(this.shown.p1)}`, bx - 12, by + 11, { size: 14, align: 'right', mono: true, color: BLOOM_P1 });
    UI.txt(ctx, `${Math.round(this.shown.p2)}`, bx + bw + 12, by + 11, { size: 14, align: 'left', mono: true, color: BLOOM_P2 });
  }

  debugSnapshot(): Record<string, string | number | boolean | null> {
    return {
      game: 'bloom',
      state: this.state,
      phase: this.phase,
      turn: this.current,
      p1: this.counts.p1,
      p2: this.counts.p2,
      move: this.moveNum,
      winner: this.winner,
      seed: this.session.seed,
    };
  }
}
