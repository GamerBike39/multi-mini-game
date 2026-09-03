// BLOB DIGGER — creuse depuis la surface, les rochers tombent dans le vide,
// les murs indestructibles forcent les détours, les diamants paient le risque.
// Monde procédural déterministe (seed), descente infinie jusqu'à la mort.
// Sous la zone oxygène, l'air devient limité : capte les bulles pour survivre.
// La mort (écrasé ou asphyxié) enregistre score + profondeur max.

import { BaseGame } from '../core/game';
import * as UI from '../core/ui';
import type { EngineLike, GameMeta, InputLike } from '../core/types';
import type { SeededRng } from '../core/rng';

const TAU = Math.PI * 2;

export const DIG_TILE = 44;
export const DIG_COLS = 20;
export const DIG_LEFT = (1280 - DIG_COLS * DIG_TILE) / 2;
export const DIG_STEP_T = 0.105;   // verrou par pas / coup de pioche
export const DIG_FALL_T = 0.085;   // chute du joueur : une case par tick
export const DIG_GRAV_TICK = 0.13; // chute des rochers : une case par tick
export const DIG_O2_ROW = 25;      // la zone oxygène commence ici
export const DIG_O2_MAX = 100;
export const DIG_O2_LOW = 30;
export const DIG_AIR_REFILL = 45;
export const DIG_DIAMOND_PTS = 25;
export const DIG_DEPTH_PTS = 2;
export const DIG_MILESTONE = 20;   // fanfare tous les 20 m

export const Dig = {
  Empty: 0,
  Dirt: 1,
  Stone: 2,
  Bedrock: 3,
  Boulder: 4,
  Diamond: 5,
  Air: 6,
} as const;
export type DigCell = (typeof Dig)[keyof typeof Dig];

export type DigBand = 'surface' | 'shallow' | 'mid' | 'deep';
export type DigDeath = 'crush' | 'oxygen';

export interface DigRoom {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DigFallMove {
  from: number;
  to: number;
}

export interface DigGravityResult {
  moves: DigFallMove[];
  landed: number[];
  crushed: boolean;
}

type DigRng = Pick<SeededRng, 'next' | 'int' | 'float'>;

export function digDepthBand(row: number): DigBand {
  if (row < 3) return 'surface';
  if (row < 16) return 'shallow';
  if (row < 36) return 'mid';
  return 'deep';
}

export function digIsOxygenZone(row: number): boolean {
  return row >= DIG_O2_ROW;
}

// Conso d'oxygène par seconde (0 hors zone). S'aggrave avec la profondeur.
export function digOxygenDrain(row: number): number {
  if (!digIsOxygenZone(row)) return 0;
  return Math.min(7, 2 + (row - DIG_O2_ROW) * 0.08);
}

export function digIsSolid(cell: number): boolean {
  return cell !== Dig.Empty;
}

export function digIsFallable(cell: number): boolean {
  return cell === Dig.Boulder || cell === Dig.Diamond;
}

// Physique des chutes (pure, déterministe) : balaye de bas en haut pour
// qu'un rocher ne tombe que d'une case par tick. `grid` et `falling` sont
// mutés sur place ; `playerCell` vaut -1 hors jeu (tests).
// - vide dessous -> tombe (falling = 1)
// - joueur dessous + déjà en chute -> écrase (crushed)
// - joueur dessous + au repos -> le joueur le retient, ça reste
// - support dessous + en chute -> se pose (landed, pour le bruit)
export function digGravityStep(
  grid: number[], falling: number[], cols: number, playerCell: number,
): DigGravityResult {
  const moves: DigFallMove[] = [];
  const landed: number[] = [];
  let crushed = false;
  const rows = Math.floor(grid.length / cols);
  for (let r = rows - 2; r >= 0; r--) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const cell = grid[i];
      if (!digIsFallable(cell)) continue;
      const below = i + cols;
      if (below === playerCell) {
        if (falling[i] === 1) {
          grid[below] = cell;
          grid[i] = Dig.Empty;
          falling[below] = 1;
          falling[i] = 0;
          moves.push({ from: i, to: below });
          crushed = true;
        } else {
          falling[i] = 0;
        }
        continue;
      }
      if (grid[below] === Dig.Empty) {
        grid[below] = cell;
        grid[i] = Dig.Empty;
        falling[below] = 1;
        falling[i] = 0;
        moves.push({ from: i, to: below });
        continue;
      }
      if (falling[i] === 1) {
        falling[i] = 0;
        landed.push(below);
      }
    }
  }
  // Dernière rangée : rien en dessous, tout s'immobilise.
  for (let c = 0; c < cols; c++) {
    const i = (rows - 1) * cols + c;
    if (digIsFallable(grid[i]) && falling[i] === 1) {
      falling[i] = 0;
      landed.push(i);
    }
  }
  return { moves, landed, crushed };
}

// Liste des salles au trésor, planifiée d'un bloc (ordre rng stable).
export function digPlanRooms(rng: DigRng, cols: number, count: number): DigRoom[] {
  const rooms: DigRoom[] = [];
  for (let i = 0; i < count; i++) {
    const w = 5 + rng.int(0, 2);
    const h = 3;
    const y = 18 + i * 14 + rng.int(0, 4);
    const x = 1 + rng.int(0, Math.max(0, cols - w - 2));
    rooms.push({ x, y, w, h });
  }
  return rooms;
}

// Mur de bedrock avec passage obligé (2-3 cases). Force le détour.
export function digVeinGap(rng: DigRng, cols: number): { gap: number; w: number } {
  const w = 2 + rng.int(0, 1);
  const gap = 1 + rng.int(0, Math.max(0, cols - w - 2));
  return { gap, w };
}

function digIsVeinRow(row: number): boolean {
  return row >= 16 && row % 9 === 4;
}

// Sculpte la salle au trésor dans la rangée r (appelée r par r croissant) :
// coffre de pierre, diamants dedans, rochers posés au-dessus = piège.
// Ne touche jamais au bedrock (murs de veine) sauf l'intérieur prévu.
export function digCarveRoom(cells: number[], room: DigRoom, r: number, cols: number, rng: DigRng): void {
  if (r === room.y - 1) {
    // Piège : rochers sur le toit, ils tomberont quand on éventre.
    // Jamais dans un mur de veine (le bedrock ne se remplace pas).
    let placed = 0;
    let guard = 0;
    while (placed < 2 && guard++ < 12) {
      const x = room.x + 1 + rng.int(0, room.w - 3);
      if (cells[x] !== Dig.Bedrock) {
        cells[x] = Dig.Boulder;
        placed++;
      }
    }
    return;
  }
  if (r < room.y || r >= room.y + room.h) return;
  const top = r === room.y;
  const bottom = r === room.y + room.h - 1;
  for (let x = room.x; x < room.x + room.w; x++) {
    const edge = top || bottom || x === room.x || x === room.x + room.w - 1;
    if (edge) {
      if (cells[x] !== Dig.Bedrock) cells[x] = Dig.Stone;
    } else {
      cells[x] = Dig.Empty;
    }
  }
  if (!top && !bottom) {
    // Diamants tapis à l'intérieur.
    const n = 3 + rng.int(0, 2);
    let guard = 0;
    for (let k = 0; k < n && guard++ < 20; k++) {
      const x = room.x + 1 + rng.int(0, room.w - 3);
      cells[x] = Dig.Diamond;
    }
  }
}

// Génère la rangée r (déterministe : même seed -> même rangée).
export function digGenRow(rng: DigRng, row: number, cols: number): number[] {
  const cells = new Array<number>(cols).fill(Dig.Dirt);
  if (row === 0) {
    cells.fill(Dig.Bedrock);
    return cells;
  }
  if (row === 1) {
    for (let c = 0; c < cols; c++) cells[c] = c >= 8 && c <= 11 ? Dig.Empty : Dig.Dirt;
    return cells;
  }
  const band = digDepthBand(row);
  const stoneP = band === 'shallow' ? 0.1 : band === 'mid' ? 0.22 : 0.32;
  const boulderP = band === 'shallow' ? 0.05 : band === 'mid' ? 0.07 : 0.09;
  const diamondP = band === 'shallow' ? 0.02 : band === 'mid' ? 0.045 : 0.07;
  const airP = row >= 18 ? (band === 'deep' ? 0.035 : 0.025) : 0;
  for (let c = 0; c < cols; c++) {
    // Cheminée de spawn sûre : jamais de rocher sur la tête au départ.
    if (row <= 3 && c >= 8 && c <= 11) {
      cells[c] = Dig.Dirt;
      continue;
    }
    const roll = rng.next();
    if (roll < 0.05) cells[c] = Dig.Empty;
    else if (roll < 0.05 + stoneP) cells[c] = Dig.Stone;
    else if (roll < 0.05 + stoneP + boulderP) cells[c] = Dig.Boulder;
    else if (roll < 0.05 + stoneP + boulderP + diamondP) cells[c] = Dig.Diamond;
    else if (roll < 0.05 + stoneP + boulderP + diamondP + airP) cells[c] = Dig.Air;
    else cells[c] = Dig.Dirt;
  }
  if (digIsVeinRow(row)) {
    const { gap, w } = digVeinGap(rng, cols);
    for (let c = 0; c < cols; c++) cells[c] = c >= gap && c < gap + w ? Dig.Dirt : Dig.Bedrock;
  }
  return cells;
}

function cellHash(c: number, r: number, seed: number): number {
  let h = (c * 374761393 + r * 668265263 + seed * 974634211) | 0;
  h = (h ^ (h >> 13)) | 0;
  h = Math.imul(h, 1274126177);
  h = (h ^ (h >> 16)) >>> 0;
  return h / 4294967295;
}

interface DigAnim {
  from: number;
  to: number;
  t: number;
}

export class DigGame extends BaseGame {
  [key: string]: any;
  static meta: GameMeta = {
    id: 'dig', name: 'BLOB DIGGER', accent: '#ef4444', mood: 'cave',
    desc: 'Creuse. Ramasse. Remonte ? Non : descends.', controls: 'Flèches / Stick creuser · les rochers tombent',
    keys: 'Flèches / ZQSD',
    hint: 'Creuse vers les diamants · un rocher qui tombe écrase · l’oxygène manque en profondeur',
    unit: 'pts', ranks: [1500, 900, 500, 250, 0],
  };

  grid: number[][] = [];
  falling: number[][] = [];
  cracks = new Map<number, number>();
  rooms: DigRoom[] = [];
  pc = 10;
  pr = 1;
  maxRow = 1;
  diamonds = 0;
  coinStep = 0;
  o2 = DIG_O2_MAX;
  o2Known = false;
  o2Tick = 0;
  announcedO2 = false;
  camY = -80;
  stepT = 0;
  fallT = 0;
  fallCells = 0;
  gravT = 0;
  anims: DigAnim[] = [];
  lastStick: [number, number] | null = null;
  holdDir: { dc: number; dr: number } | null = null;
  holdT = 0;
  nearCd = 0;
  milestoneRow = DIG_MILESTONE;
  deathCause: DigDeath = 'crush';
  bestDepth = 0;

  constructor(engine: EngineLike) {
    super(engine);
    this.blob.r = 18;
    this.blob.trailOn = false;
    this.blob.setEmotion('focused');
    this.rooms = digPlanRooms(this.rng, DIG_COLS, 24);
    this.genUpTo(30);
    this.bestDepth = DigGame.loadDepth(this.bestKey);
    this.syncBlob(true);
  }

  static depthKey(bestKey: string | undefined): string {
    return 'blobArcade.depth.' + (bestKey || 'dig');
  }

  static loadDepth(bestKey: string | undefined): number {
    try {
      const v = Number(localStorage.getItem(DigGame.depthKey(bestKey)) || 0);
      return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
    } catch {
      return 0;
    }
  }

  static saveDepth(bestKey: string | undefined, depth: number): number {
    const prev = DigGame.loadDepth(bestKey);
    const next = Math.max(prev, Math.floor(depth));
    try {
      localStorage.setItem(DigGame.depthKey(bestKey), String(next));
    } catch {
      // La session continue, le record de profondeur est juste perdu.
    }
    return next;
  }

  get rows(): number {
    return this.grid.length;
  }

  idx(c: number, r: number): number {
    return r * DIG_COLS + c;
  }

  inBounds(c: number, r: number): boolean {
    return c >= 0 && c < DIG_COLS && r >= 0 && r < this.rows;
  }

  cellAt(c: number, r: number): number {
    if (!this.inBounds(c, r)) return Dig.Bedrock;
    return this.grid[r][c];
  }

  genUpTo(row: number): void {
    const target = row + 24;
    while (this.grid.length <= target) {
      const r = this.grid.length;
      const cells = digGenRow(this.rng, r, DIG_COLS);
      for (const room of this.rooms) digCarveRoom(cells, room, r, DIG_COLS, this.rng);
      this.grid.push(cells);
      this.falling.push(new Array<number>(DIG_COLS).fill(0));
    }
  }

  depth(): number {
    return Math.max(0, this.maxRow - 1);
  }

  syncBlob(snap: boolean): void {
    const tx = DIG_LEFT + (this.pc + 0.5) * DIG_TILE;
    const ty = this.pr * DIG_TILE + DIG_TILE / 2 - this.camY;
    if (snap) {
      this.blob.x = tx;
      this.blob.y = ty;
    } else {
      // Lerp rapide : la grille logique reste la vérité, le rendu suit.
      this.blob.x += (tx - this.blob.x) * 0.45;
      this.blob.y += (ty - this.blob.y) * 0.45;
    }
    this.blob.vx = 0;
    this.blob.vy = 0;
  }

  // ---------- input (même arbitrage que frog : un appui = un pas) ----------
  readInput(I: InputLike): void {
    let edge: { dc: number; dr: number } | null = null;
    if (I.pressed('up')) edge = { dc: 0, dr: -1 };
    else if (I.pressed('down')) edge = { dc: 0, dr: 1 };
    else if (I.pressed('left')) edge = { dc: -1, dr: 0 };
    else if (I.pressed('right')) edge = { dc: 1, dr: 0 };
    const mx = I.moveX;
    const my = I.moveY;
    let sd: [number, number] | null = null;
    if (Math.abs(mx) > 0.55 || Math.abs(my) > 0.55) {
      sd = Math.abs(mx) > Math.abs(my) ? [Math.sign(mx), 0] : [0, Math.sign(my)];
    }
    if (edge) {
      this.tryStep(edge.dc, edge.dr);
      this.lastStick = sd;
      this.holdDir = { dc: edge.dc, dr: edge.dr };
      this.holdT = 0;
      return;
    }
    if (sd) {
      if (!this.lastStick || sd[0] !== this.lastStick[0] || sd[1] !== this.lastStick[1]) {
        this.tryStep(sd[0], sd[1]);
        this.lastStick = sd;
        this.holdDir = { dc: sd[0], dr: sd[1] };
        this.holdT = 0;
      } else if (this.holdDir) {
        this.holdT += 1 / 60;
      }
    } else {
      this.lastStick = null;
      const kd = I.down('up') ? { dc: 0, dr: -1 }
        : I.down('down') ? { dc: 0, dr: 1 }
        : I.down('left') ? { dc: -1, dr: 0 }
        : I.down('right') ? { dc: 1, dr: 0 } : null;
      if (kd) {
        if (!this.holdDir || kd.dc !== this.holdDir.dc || kd.dr !== this.holdDir.dr) {
          this.holdDir = kd;
          this.holdT = 0;
        } else {
          this.holdT += 1 / 60;
        }
      } else {
        this.holdDir = null;
        this.holdT = 0;
      }
    }
    if (this.holdDir && this.holdT > 0.22 && this.state === 'play') {
      this.holdT = 0.06;
      this.tryStep(this.holdDir.dc, this.holdDir.dr);
    }
  }

  stepReady(): boolean {
    return this.stepT <= 0 && this.state === 'play';
  }

  tryStep(dc: number, dr: number): void {
    if (!this.stepReady()) return;
    // En l'air (sans support) : on ne dirige qu'à l'horizontale.
    if (dr !== 0 && this.cellAt(this.pc, this.pr + 1) === Dig.Empty) return;
    const nc = this.pc + dc;
    const nr = this.pr + dr;
    if (nc < 0 || nc >= DIG_COLS || nr < 1) {
      this.bump(nc, nr);
      return;
    }
    this.genUpTo(nr + 1);
    const target = this.grid[nr][nc];
    const fallingHere = this.falling[nr][nc] === 1;
    if (target === Dig.Bedrock || fallingHere) {
      this.bump(nc, nr);
      return;
    }
    if (target === Dig.Boulder && dr === 0) {
      // Poussée : il faut du vide derrière et un rocher stable.
      const bc = nc + dc;
      if (bc >= 0 && bc < DIG_COLS && this.grid[nr][bc] === Dig.Empty && this.falling[nr][nc] === 0) {
        this.grid[nr][bc] = Dig.Boulder;
        this.falling[nr][bc] = 0;
        this.grid[nr][nc] = Dig.Empty;
        this.falling[nr][nc] = 0;
        this.movePlayer(nc, nr);
        this.audio.land();
        this.input.rumble(0.15, 0.05);
        this.fx.burst(this.px(nc), this.py(nr), {
          n: 6, speed: [40, 160], colors: ['#8fa3ad', '#d7e3ea'], size: [1.5, 3], life: 0.3,
        });
        return;
      }
      this.bump(nc, nr);
      return;
    }
    if (target === Dig.Boulder) {
      this.bump(nc, nr);
      return;
    }
    if (target === Dig.Stone) {
      const key = this.idx(nc, nr);
      const cracks = (this.cracks.get(key) || 0) + 1;
      if (cracks < 2) {
        this.cracks.set(key, cracks);
        this.stepT = DIG_STEP_T;
        this.audio.noise({ dur: 0.09, vol: 0.22, f: 1500, type: 'highpass' });
        this.input.rumble(0.12, 0.04);
        this.fx.shake(0.08);
        this.fx.burst(this.px(nc), this.py(nr), {
          n: 6, speed: [40, 170], colors: ['#9aa7b8', '#e2e8f0'], size: [1.5, 3], life: 0.3,
        });
        this.blob.punch(0.2);
        return;
      }
      this.cracks.delete(key);
    }
    if (target === Dig.Diamond) this.collectDiamond(nc, nr);
    else if (target === Dig.Air) this.collectAir(nc, nr);
    else if (target === Dig.Dirt) this.digDirt(nc, nr);
    this.movePlayer(nc, nr);
  }

  bump(nc: number, nr: number): void {
    void nc;
    void nr;
    this.stepT = DIG_STEP_T * 0.6;
    this.audio.whiff();
    this.blob.punch(0.15);
  }

  digDirt(nc: number, nr: number): void {
    this.grid[nr][nc] = Dig.Empty;
    this.audio.thump(0.5);
    this.input.rumble(0.1, 0.04);
    this.blob.punch(0.22);
    this.fx.burst(this.px(nc), this.py(nr), {
      n: 7, speed: [40, 180], colors: ['#8a5a33', '#c98d54', '#5d3a1e'], size: [1.5, 3.5], life: 0.35,
    });
  }

  collectDiamond(nc: number, nr: number): void {
    this.grid[nr][nc] = Dig.Empty;
    this.diamonds += 1;
    this.coinStep += 1;
    this.score += DIG_DIAMOND_PTS;
    this.audio.coin(this.coinStep % 8);
    this.musicEvent('combo', Math.min(1.1, 0.35 + this.diamonds * 0.02));
    this.blob.punch(0.3);
    this.blob.setEmotion('happy', 0.5);
    this.input.rumble(0.16, 0.05);
    this.fx.ring(this.px(nc), this.py(nr), { r0: 8, r1: 58, color: '#22d3ee', life: 0.35 });
    this.fx.burst(this.px(nc), this.py(nr), {
      n: 12, speed: [60, 300], colors: ['#22d3ee', '#a5f3fc', '#ffffff'], size: [1.5, 4], life: 0.5,
    });
    this.fx.text(this.px(nc), this.py(nr) - 30, '+' + DIG_DIAMOND_PTS, {
      color: '#22d3ee', size: 20, mono: true,
    });
  }

  collectAir(nc: number, nr: number): void {
    this.grid[nr][nc] = Dig.Empty;
    this.o2 = Math.min(DIG_O2_MAX, this.o2 + DIG_AIR_REFILL);
    this.score += 5;
    this.audio.good();
    this.blob.setEmotion('happy', 0.7);
    this.blob.punch(0.3);
    this.fx.ring(this.px(nc), this.py(nr), { r0: 8, r1: 64, color: '#7dd3fc', life: 0.4 });
    this.fx.burst(this.px(nc), this.py(nr), {
      n: 10, speed: [40, 220], colors: ['#7dd3fc', '#ffffff'], size: [1.5, 4], life: 0.45,
    });
    this.fx.text(this.px(nc), this.py(nr) - 30, '+AIR', { color: '#7dd3fc', size: 20, mono: true });
  }

  movePlayer(nc: number, nr: number): void {
    this.pc = nc;
    this.pr = nr;
    this.stepT = DIG_STEP_T;
    if (nr > this.maxRow) {
      const diff = nr - this.maxRow;
      this.maxRow = nr;
      this.score += diff * DIG_DEPTH_PTS;
      if (this.maxRow >= this.milestoneRow) {
        this.fx.text(640, 240, this.depth() + ' m !', { color: this.accent, size: 30 });
        this.audio.milestone();
        this.musicEvent('waveComplete', 0.35);
        this.fx.flash(this.accent, 0.06);
        this.milestoneRow += DIG_MILESTONE;
      }
    }
    this.genUpTo(nr + 1);
  }

  px(c: number): number {
    return DIG_LEFT + (c + 0.5) * DIG_TILE;
  }

  py(r: number): number {
    return r * DIG_TILE + DIG_TILE / 2 - this.camY;
  }

  playerCell(): number {
    return this.pr * DIG_COLS + this.pc;
  }

  flatten(): { grid: number[]; falling: number[] } {
    const grid: number[] = [];
    const falling: number[] = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < DIG_COLS; c++) {
        grid.push(this.grid[r][c]);
        falling.push(this.falling[r][c]);
      }
    }
    return { grid, falling };
  }

  applyFlat(grid: number[], falling: number[]): void {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < DIG_COLS; c++) {
        const i = r * DIG_COLS + c;
        this.grid[r][c] = grid[i];
        this.falling[r][c] = falling[i];
      }
    }
  }

  runGravity(): void {
    const { grid, falling } = this.flatten();
    const res = digGravityStep(grid, falling, DIG_COLS, this.playerCell());
    this.applyFlat(grid, falling);
    for (const m of res.moves) {
      this.anims.push({ from: m.from, to: m.to, t: 0 });
    }
    if (this.anims.length > 48) this.anims.splice(0, this.anims.length - 48);
    for (const land of res.landed) {
      const lc = land % DIG_COLS;
      const lr = Math.floor(land / DIG_COLS);
      const dx = (lc - this.pc) * DIG_TILE;
      const dy = (lr - this.pr) * DIG_TILE;
      if (dx * dx + dy * dy < 170 * 170) {
        this.fx.shake(0.14);
        this.audio.land();
        this.fx.burst(this.px(lc), this.py(lr), {
          n: 5, speed: [30, 140], colors: ['#8fa3ad', '#5d6b7a'], size: [1.5, 3], life: 0.3,
        });
      }
      // Un rocher qui se pose à côté : le frisson arcade.
      const cheb = Math.max(Math.abs(lc - this.pc), Math.abs(lr - this.pr));
      if (cheb === 1 && this.nearCd <= 0) {
        this.nearCd = 1;
        this.blob.setEmotion('wow', 0.5);
        this.fx.text(this.blob.x, this.blob.y - 44, 'OUF !', { color: '#f2c94c', size: 18, mono: true });
      }
    }
    if (res.crushed) this.die('crush');
    // Un rocher tombé sur la case du joueur entre deux ticks écrase aussi :
    // la case du joueur doit toujours être vide dans la grille logique.
    if (this.state === 'play' && digIsFallable(this.grid[this.pr][this.pc])) {
      this.die('crush');
    }
  }

  die(cause: DigDeath): void {
    if (this.state === 'over') return;
    this.deathCause = cause;
    this.blob.dead = true;
    this.blob.punch(0.6);
    this.fx.stop(0.11);
    this.fx.shake(0.9);
    this.input.rumble(1, 0.35);
    if (cause === 'crush') {
      this.audio.hurt();
      this.fx.burst(this.blob.x, this.blob.y, {
        n: 26, speed: [100, 500], colors: [this.accent, '#ffffff', '#8fa3ad'], size: [2, 6], life: 0.7,
      });
      this.fx.ring(this.blob.x, this.blob.y, { r0: 10, r1: 120, color: '#ff5470', life: 0.4 });
    } else {
      this.audio.miss();
      this.fx.burst(this.blob.x, this.blob.y, {
        n: 22, speed: [40, 260], colors: ['#7dd3fc', '#ffffff', '#38bdf8'], size: [2, 5], life: 0.7,
      });
      this.fx.ring(this.blob.x, this.blob.y, { r0: 8, r1: 100, color: '#7dd3fc', life: 0.55 });
      this.fx.flash('#0c4a6e', 0.14);
    }
    this.bestDepth = DigGame.saveDepth(this.bestKey, this.depth());
    this.over(false);
  }

  update(dt: number): void {
    if (this.baseUpdate(dt)) return;
    if (this.state !== 'play') return;

    this.stepT = Math.max(0, this.stepT - dt);
    this.nearCd = Math.max(0, this.nearCd - dt);
    this.readInput(this.input);

    // Chute du joueur : le vide ne pardonne pas, mais on dirige en tombant.
    const below = this.cellAt(this.pc, this.pr + 1);
    if (below === Dig.Empty && this.pr + 1 < this.rows) {
      this.fallT += dt;
      if (this.fallT >= DIG_FALL_T) {
        this.fallT = 0;
        this.fallCells += 1;
        this.pr += 1;
        if (this.pr > this.maxRow) {
          this.maxRow = this.pr;
          this.score += DIG_DEPTH_PTS;
        }
        this.genUpTo(this.pr + 1);
      }
    } else {
      if (this.fallCells >= 2) {
        this.audio.land();
        this.blob.punch(0.3);
        this.fx.burst(this.blob.x, this.blob.y + 16, {
          n: 6, speed: [40, 150], colors: ['#8a5a33', '#c98d54'], size: [1.5, 3], life: 0.3,
        });
      }
      this.fallT = 0;
      this.fallCells = 0;
    }

    // Physique des rochers.
    this.gravT += dt;
    let guard = 0;
    while (this.gravT >= DIG_GRAV_TICK && this.state === 'play' && guard++ < 4) {
      this.gravT -= DIG_GRAV_TICK;
      this.runGravity();
    }
    if (this.state !== 'play') return;

    // Oxygène : infini à l'air libre, limité en profondeur.
    const zone = digIsOxygenZone(this.pr);
    if (zone && !this.announcedO2) {
      this.announcedO2 = true;
      this.audio.milestone();
      this.fx.text(640, 240, 'ZONE OXYGÈNE — CHERCHE LES BULLES', { color: '#7dd3fc', size: 26 });
      this.fx.flash('#7dd3fc', 0.1);
    }
    if (zone) {
      this.o2Known = true;
      this.o2 = Math.max(0, this.o2 - digOxygenDrain(this.pr) * dt);
      this.o2Tick -= dt;
      if (this.o2 <= 0) {
        this.die('oxygen');
        return;
      }
      if (this.o2 < DIG_O2_LOW && this.o2Tick <= 0) {
        this.o2Tick = 1;
        this.audio.whiff();
        this.fx.flash('#0369a1', 0.08);
      }
    } else if (this.o2 < DIG_O2_MAX) {
      this.o2 = Math.min(DIG_O2_MAX, this.o2 + 20 * dt);
    }

    // Danger au-dessus : un rocher suspendu sur la même colonne stresse.
    let danger = this.o2Known && zone && this.o2 < DIG_O2_LOW;
    for (let r = this.pr - 1; r >= Math.max(1, this.pr - 4) && !danger; r--) {
      const cell = this.cellAt(this.pc, r);
      if (digIsFallable(cell)) {
        const under = this.cellAt(this.pc, r + 1);
        if (under === Dig.Empty || (r + 1 === this.pr)) danger = true;
        break;
      }
      if (cell !== Dig.Empty) break;
    }
    this.blob.scared = danger;

    // Caméra : le joueur vers 40 % de l'écran, jamais au-dessus du ciel.
    const targetY = this.pr * DIG_TILE + DIG_TILE / 2 - 300;
    this.camY += (Math.max(-80, targetY) - this.camY) * Math.min(1, dt * 5);

    // Animations de chute : une case par tick, lerp visuel.
    for (let i = this.anims.length - 1; i >= 0; i--) {
      this.anims[i].t += dt / DIG_GRAV_TICK;
      if (this.anims[i].t >= 1) this.anims.splice(i, 1);
    }

    this.syncBlob(false);
    this.blob.update(dt);
    this.eng.dev.state('dig-depth', this.depth());
    this.eng.dev.count('dig-diamonds', this.diamonds);
    this.eng.dev.count('dig-o2', Math.round(this.o2));
  }

  animToSet(): Set<number> {
    const s = new Set<number>();
    for (const a of this.anims) s.add(a.to);
    return s;
  }

  // ---------- rendu ----------
  render(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#04050a';
    ctx.fillRect(0, 0, 1280, 720);
    this.fx.world(ctx);

    const T = DIG_TILE;
    const r0 = Math.max(0, Math.floor(this.camY / T) - 1);
    const r1 = Math.min(this.rows - 1, Math.ceil((this.camY + 720) / T) + 1);

    // Ciel nocturne au-dessus de la surface.
    const skyBottom = 2 * T - this.camY;
    if (skyBottom > 0) {
      const sky = ctx.createLinearGradient(0, 0, 0, Math.max(1, skyBottom));
      sky.addColorStop(0, '#02030a');
      sky.addColorStop(1, '#0a1230');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, 1280, Math.min(720, skyBottom));
      ctx.fillStyle = '#e2e8f0';
      for (let i = 0; i < 40; i++) {
        const h = cellHash(i, 7, this.session.seed);
        const sx = h * 1280;
        const sy = (cellHash(i, 13, this.session.seed) * Math.min(720, skyBottom)) % Math.max(1, Math.min(720, skyBottom));
        ctx.globalAlpha = 0.25 + (h * 7) % 0.5;
        ctx.fillRect(sx, sy, 2, 2);
      }
      ctx.globalAlpha = 1;
      // Lune + halo.
      const moonX = 1080;
      const moonY = Math.min(720, skyBottom) * 0.4;
      const halo = ctx.createRadialGradient(moonX, moonY, 4, moonX, moonY, 60);
      halo.addColorStop(0, 'rgba(226,232,240,0.5)');
      halo.addColorStop(1, 'rgba(226,232,240,0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(moonX, moonY, 60, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#e8eef7';
      ctx.beginPath();
      ctx.arc(moonX, moonY, 22, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#0a1230';
      ctx.beginPath();
      ctx.arc(moonX - 8, moonY - 5, 18, 0, TAU);
      ctx.fill();
    }

    // Terrain : teinte assombrie par bandes de profondeur.
    // Les cases d'arrivée des chutes en cours sont dessinées vides ici :
    // l'animation les dessine en lerp juste après (pas de fantôme).
    const animTo = this.animToSet();
    for (let r = r0; r <= r1; r++) {
      const band = digDepthBand(r);
      const y = r * T - this.camY;
      ctx.fillStyle = band === 'surface' || band === 'shallow' ? '#0d0a06'
        : band === 'mid' ? '#0a0808' : '#07060c';
      ctx.fillRect(DIG_LEFT, y, DIG_COLS * T, T + 1);
      for (let c = 0; c < DIG_COLS; c++) {
        const cell = this.grid[r][c];
        const x = DIG_LEFT + c * T;
        if (cell === Dig.Empty || animTo.has(this.idx(c, r))) {
          this.drawDug(ctx, x, y, c, r);
          continue;
        }
        if (cell === Dig.Dirt) this.drawDirt(ctx, x, y, c, r);
        else if (cell === Dig.Stone) this.drawStone(ctx, x, y, this.cracks.get(this.idx(c, r)) || 0);
        else if (cell === Dig.Bedrock) this.drawBedrock(ctx, x, y, c, r);
        else if (cell === Dig.Boulder) this.drawBoulderAt(ctx, x + T / 2, y + T / 2, c, r, false);
        else if (cell === Dig.Diamond) this.drawDiamondAt(ctx, x + T / 2, y + T / 2, c, r);
        else if (cell === Dig.Air) this.drawAirAt(ctx, x + T / 2, y + T / 2, c, r);
      }
    }

    // Rochers en chute : lerp par-dessus la grille logique.
    for (const a of this.anims) {
      const k = Math.min(1, a.t);
      const e = k * k;
      const fx = a.from % DIG_COLS;
      const fy = Math.floor(a.from / DIG_COLS);
      const tx = a.to % DIG_COLS;
      const ty = Math.floor(a.to / DIG_COLS);
      const x = DIG_LEFT + (fx + (tx - fx) * e + 0.5) * T;
      const y = (fy + (ty - fy) * e + 0.5) * T - this.camY;
      const cell = this.grid[ty][tx];
      if (cell === Dig.Boulder) this.drawBoulderAt(ctx, x, y, tx, ty, true);
      else if (cell === Dig.Diamond) this.drawDiamondAt(ctx, x, y, tx, ty);
    }

    // Herbe de surface.
    const grassY = 2 * T - this.camY;
    if (grassY > -20 && grassY < 740) {
      ctx.fillStyle = '#166534';
      ctx.fillRect(DIG_LEFT, grassY - 4, DIG_COLS * T, 6);
      ctx.strokeStyle = '#4ade80';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let x = DIG_LEFT + 6; x < DIG_LEFT + DIG_COLS * T; x += 18) {
        const h = 4 + cellHash(Math.round(x), 3, this.session.seed) * 8;
        ctx.moveTo(x, grassY - 2);
        ctx.lineTo(x + 3, grassY - 2 - h);
      }
      ctx.stroke();
    }

    // Casque à bulle dans la zone oxygène.
    this.blob.render(ctx);
    if (this.o2Known) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = '#7dd3fc';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(this.blob.x, this.blob.y, this.blob.r + 9, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = '#e0f2fe';
      ctx.beginPath();
      ctx.arc(this.blob.x - 8, this.blob.y - 12, 3, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    this.fx.drawWorld(ctx);
    this.fx.endWorld(ctx);

    // Vignette d'asphyxie.
    if (this.o2Known && digIsOxygenZone(this.pr) && this.state === 'play') {
      const k = 1 - this.o2 / DIG_O2_MAX;
      if (k > 0.35) {
        const v = ctx.createRadialGradient(640, 360, 300, 640, 360, 720);
        v.addColorStop(0, 'rgba(3,105,161,0)');
        v.addColorStop(1, `rgba(3,105,161,${0.25 + k * 0.3})`);
        ctx.fillStyle = v;
        ctx.fillRect(0, 0, 1280, 720);
      }
    }

    UI.drawHUD(ctx, {
      accent: this.accent,
      score: Math.floor(this.score),
      unit: this.meta.unit,
      extra: () => {
        UI.txt(ctx, 'PROF ' + this.depth() + ' m', 28, 70, { size: 13, align: 'left', mono: true, color: '#aeb8c8' });
        UI.txt(ctx, '◆ ' + this.diamonds, 28, 92, { size: 13, align: 'left', mono: true, color: '#22d3ee' });
        if (this.o2Known) {
          const w = 150;
          const bx = 1280 - 28 - w;
          UI.txt(ctx, 'O2', bx - 30, 70, { size: 13, mono: true, color: '#7dd3fc', weight: 900 });
          ctx.fillStyle = 'rgba(255,255,255,0.12)';
          ctx.fillRect(bx, 58, w, 12);
          const low = this.o2 < DIG_O2_LOW;
          const pulse = low ? 0.6 + 0.4 * Math.sin(this.time * 10) : 1;
          ctx.globalAlpha = pulse;
          ctx.fillStyle = low ? '#ff5470' : '#38bdf8';
          ctx.fillRect(bx, 58, (w * this.o2) / DIG_O2_MAX, 12);
          ctx.globalAlpha = 1;
          UI.txt(ctx, Math.ceil(this.o2) + '%', bx + w + 8, 70, {
            size: 12, mono: true, color: low ? '#ff9aaa' : '#aeb8c8',
          });
        }
      },
    });
    if (this.state === 'over') this.drawGameOverSelf(ctx);
    else this.drawCommon(ctx);
  }

  drawGameOverSelf(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = 'rgba(2, 3, 8, 0.62)';
    ctx.fillRect(0, 0, 1280, 720);
    UI.panel(ctx, 330, 170, 620, 380, { radius: 22, stroke: this.accent + '66', lineWidth: 2 });
    const title = this.deathCause === 'crush' ? 'ÉCRASÉ !' : 'ASPHYXIÉ !';
    UI.txt(ctx, title, 640, 232, { size: 44, align: 'center', color: this.accent, weight: 900 });
    UI.txt(ctx, 'SCORE', 640, 272, { size: 14, align: 'center', color: '#8b95a8' });
    UI.txt(ctx, UI.fmt(this.score) + ' ' + this.meta.unit, 640, 330, {
      size: 54, align: 'center', mono: true, weight: 700,
    });
    UI.txt(ctx, 'PROFONDEUR  ' + this.depth() + ' m   ·   ◆ ' + this.diamonds, 640, 366, {
      size: 19, align: 'center', mono: true, color: '#aeb8c8',
    });
    const best = this.bestResult?.best ?? UI.getBest(this.bestKey || this.meta.id);
    UI.txt(ctx, 'Record : ' + UI.fmt(best) + ' ' + this.meta.unit + '   ·   Prof. max : ' + this.bestDepth + ' m', 640, 398, {
      size: 17, align: 'center', color: '#aeb8c8',
    });
    UI.txt(ctx, 'RANG ' + UI.rank(this.meta.ranks, this.score), 640, 430, {
      size: 20, align: 'center', color: '#f2c94c', weight: 900,
    });
    if (this.bestResult?.isNew) {
      const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 120);
      ctx.globalAlpha = pulse;
      UI.txt(ctx, '★ NOUVEAU RECORD ★', 640, 462, { size: 20, align: 'center', color: this.accent, weight: 900 });
      ctx.globalAlpha = 1;
    }
    UI.txt(ctx, 'A  Rejouer        B  Menu', 640, 498, { size: 17, align: 'center', color: '#aeb8c8' });
    UI.txt(ctx, 'clavier : Espace rejouer · K menu · Échap ou Backspace menu', 640, 524, {
      size: 12.5, align: 'center', color: '#5d6480',
    });
  }

  // ---------- textures procédurales ----------
  dugShade(c: number, r: number): string {
    const h = cellHash(c, r, 1);
    return h < 0.12 ? '#0f0c08' : '#0b0906';
  }

  drawDug(ctx: CanvasRenderingContext2D, x: number, y: number, c: number, r: number): void {
    ctx.fillStyle = this.dugShade(c, r);
    ctx.fillRect(x, y, DIG_TILE, DIG_TILE);
    // Bordures sombres = parois creusées lisibles.
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    if (this.cellAt(c - 1, r) !== Dig.Empty) ctx.fillRect(x, y, 3, DIG_TILE);
    if (this.cellAt(c + 1, r) !== Dig.Empty) ctx.fillRect(x + DIG_TILE - 3, y, 3, DIG_TILE);
    if (this.cellAt(c, r - 1) !== Dig.Empty) ctx.fillRect(x, y, DIG_TILE, 3);
    if (this.cellAt(c, r + 1) !== Dig.Empty) ctx.fillRect(x, y + DIG_TILE - 3, DIG_TILE, 3);
    // Cailloux épars (décor, hash stable).
    const h = cellHash(c, r, this.session.seed);
    if (h > 0.55) {
      ctx.fillStyle = 'rgba(180,140,100,0.25)';
      ctx.fillRect(x + 8 + h * 20, y + 10 + (h * 53 % 1) * 20, 3, 3);
    }
  }

  drawDirt(ctx: CanvasRenderingContext2D, x: number, y: number, c: number, r: number): void {
    const g = ctx.createLinearGradient(x, y, x, y + DIG_TILE);
    g.addColorStop(0, '#7a4a26');
    g.addColorStop(1, '#5d3a1e');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, DIG_TILE, DIG_TILE);
    // Mottes : taches stables par hash.
    for (let k = 0; k < 4; k++) {
      const h1 = cellHash(c * 4 + k, r, this.session.seed);
      const h2 = cellHash(c, r * 4 + k + 9, this.session.seed);
      ctx.fillStyle = h1 > 0.5 ? 'rgba(60,35,15,0.5)' : 'rgba(201,141,84,0.4)';
      ctx.beginPath();
      ctx.arc(x + 6 + h1 * 32, y + 6 + h2 * 32, 2 + h2 * 3, 0, TAU);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(30,17,7,0.6)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 0.5, y + 0.5, DIG_TILE - 1, DIG_TILE - 1);
  }

  drawStone(ctx: CanvasRenderingContext2D, x: number, y: number, cracks: number): void {
    const g = ctx.createLinearGradient(x, y, x + DIG_TILE, y + DIG_TILE);
    g.addColorStop(0, '#6b7280');
    g.addColorStop(1, '#434a56');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, DIG_TILE, DIG_TILE);
    // Facettes.
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 20, y);
    ctx.lineTo(x, y + 20);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.moveTo(x + DIG_TILE, y + DIG_TILE);
    ctx.lineTo(x + DIG_TILE - 20, y + DIG_TILE);
    ctx.lineTo(x + DIG_TILE, y + DIG_TILE - 20);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#23272f';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, DIG_TILE - 2, DIG_TILE - 2);
    // Fissures : 1er coup = lézarde, la pierre est condamnée.
    if (cracks > 0) {
      ctx.strokeStyle = '#1c1f26';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(x + 8, y + 4);
      ctx.lineTo(x + 18, y + 16);
      ctx.lineTo(x + 12, y + 28);
      ctx.lineTo(x + 24, y + 40);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + 30, y + 8);
      ctx.lineTo(x + 24, y + 22);
      ctx.stroke();
    }
  }

  drawBedrock(ctx: CanvasRenderingContext2D, x: number, y: number, _c: number, _r: number): void {
    void _c;
    void _r;
    const g = ctx.createLinearGradient(x, y, x, y + DIG_TILE);
    g.addColorStop(0, '#2b3242');
    g.addColorStop(1, '#161b26');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, DIG_TILE, DIG_TILE);
    // Plaques rivetées : indestructible et fier de l'être.
    ctx.strokeStyle = 'rgba(148,163,184,0.35)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 5.5, y + 5.5, DIG_TILE - 11, DIG_TILE - 11);
    ctx.fillStyle = '#94a3b8';
    for (const [rx, ry] of [[10, 10], [DIG_TILE - 10, 10], [10, DIG_TILE - 10], [DIG_TILE - 10, DIG_TILE - 10]] as const) {
      ctx.beginPath();
      ctx.arc(x + rx, y + ry, 2.6, 0, TAU);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(239,68,68,0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 12, y + DIG_TILE - 12);
    ctx.lineTo(x + DIG_TILE - 12, y + 12);
    ctx.stroke();
  }

  drawBoulderAt(ctx: CanvasRenderingContext2D, x: number, y: number, c: number, r: number, fallingNow: boolean): void {
    const rad = DIG_TILE / 2 - 3;
    if (fallingNow) {
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - rad, y - rad - 6);
      ctx.lineTo(x - rad, y - rad - 16);
      ctx.moveTo(x + rad, y - rad - 6);
      ctx.lineTo(x + rad, y - rad - 16);
      ctx.stroke();
    }
    ctx.save();
    ctx.shadowColor = '#000000';
    ctx.shadowBlur = 8;
    const g = ctx.createRadialGradient(x - 6, y - 8, 3, x, y, rad + 2);
    g.addColorStop(0, '#a8b0bd');
    g.addColorStop(0.6, '#6e7683');
    g.addColorStop(1, '#3c414c');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, TAU);
    ctx.fill();
    ctx.restore();
    // Éclats + fissure stable par hash.
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.beginPath();
    ctx.arc(x - 6, y - 8, 4, 0, TAU);
    ctx.fill();
    const h = cellHash(c, r, this.session.seed);
    ctx.strokeStyle = 'rgba(28,31,38,0.7)';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(x - 8 + h * 6, y - 10);
    ctx.quadraticCurveTo(x + h * 8, y, x - 4 + h * 6, y + 10);
    ctx.stroke();
  }

  drawDiamondAt(ctx: CanvasRenderingContext2D, x: number, y: number, _c: number, _r: number): void {
    void _c;
    void _r;
    const tw = 0.6 + 0.4 * Math.sin(this.time * 4 + x * 0.05);
    ctx.save();
    ctx.shadowColor = '#22d3ee';
    ctx.shadowBlur = 12 * tw + 4;
    ctx.fillStyle = '#164e63';
    ctx.beginPath();
    ctx.moveTo(x, y - 14);
    ctx.lineTo(x + 11, y - 2);
    ctx.lineTo(x, y + 14);
    ctx.lineTo(x - 11, y - 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#67e8f9';
    ctx.beginPath();
    ctx.moveTo(x, y - 14);
    ctx.lineTo(x + 11, y - 2);
    ctx.lineTo(x, y - 2);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x, y - 14);
    ctx.lineTo(x, y - 2);
    ctx.lineTo(x - 11, y - 2);
    ctx.closePath();
    ctx.fillStyle = '#a5f3fc';
    ctx.fill();
    ctx.fillStyle = '#ecfeff';
    ctx.beginPath();
    ctx.moveTo(x, y - 2);
    ctx.lineTo(x + 11, y - 2);
    ctx.lineTo(x, y + 14);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // Étincelle orbitale.
    const a = this.time * 2.2 + x;
    ctx.fillStyle = `rgba(255,255,255,${0.4 + 0.5 * tw})`;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * 13, y + Math.sin(a) * 13, 1.8, 0, TAU);
    ctx.fill();
  }

  drawAirAt(ctx: CanvasRenderingContext2D, x: number, y: number, _c: number, _r: number): void {
    void _c;
    void _r;
    const wob = Math.sin(this.time * 3 + x * 0.1) * 2;
    ctx.save();
    ctx.shadowColor = '#7dd3fc';
    ctx.shadowBlur = 10;
    ctx.strokeStyle = '#bae6fd';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(x, y + wob, 12, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = 'rgba(125,211,252,0.18)';
    ctx.fill();
    ctx.fillStyle = '#f0f9ff';
    ctx.beginPath();
    ctx.arc(x - 4, y - 4 + wob, 3, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  debugSnapshot(): Record<string, string | number | boolean | null> {
    return {
      ...super.debugSnapshot(),
      depth: this.depth(),
      diamonds: this.diamonds,
      o2: Math.round(this.o2),
      rows: this.rows,
    };
  }
}
