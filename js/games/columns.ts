// DR BLOB — Columns-like : trios verticaux qui tombent, groupes LIÉS de 4+
// (4-connexité stricte : côtés uniquement, jamais de diagonale) qui
// fusionnent (gooey) puis éclatent, chute animée, chaînes.
// Solo : score attack avec niveaux et vitesse croissante.
// Versus local : deux puits côte à côte, les gros nettoyages envoient
// des blobs gris (ordures) qui poussent la colonne adverse vers le haut.
// Les gris ne se combinent jamais : ils disparaissent quand un groupe
// de couleur éclate à côté d'eux (4 voisins orthogonaux).
//
// Clavier P1 : flèches/ZQSD bouger, Espace permuter, Haut chute éclair.
// P2 : manette obligatoire (contrainte moteur : le clavier pilote P1).

import { BaseGame } from '../core/game';
import { Blob } from '../core/blob';
import * as UI from '../core/ui';
import type { EngineLike, GameMeta, GameSession, PlayerInputLike } from '../core/types';

export const COLS = 6;
export const ROWS = 13;
export const GARB = 9;
export const CLEAR_T = 0.34;
const MAX_COLOR = 5;

export const PALETTE: readonly string[] = [
  '',
  '#f472b6', // 1 rose
  '#22d3ee', // 2 cyan
  '#22c55e', // 3 vert franc (contraste net avec l'ambre)
  '#fbbf24', // 4 ambre chaud
  '#c084fc', // 5 violet
];
export const GARB_COLOR = '#64748b';

export type Trio = [number, number, number];

export function emptyGrid(rows: number = ROWS, cols: number = COLS): number[][] {
  const grid: number[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: number[] = [];
    for (let c = 0; c < cols; c++) row.push(0);
    grid.push(row);
  }
  return grid;
}

export function colorCountForLevel(level: number): number {
  return level >= 3 ? MAX_COLOR : 4;
}

export function fallIntervalForLevel(level: number): number {
  return Math.max(0.09, 0.72 * Math.pow(0.9, Math.max(1, level) - 1));
}

// Score : 10/blobs × chaîne + bonus taille + bonus chaîne, boosté par niveau.
export function scoreForClear(cleared: number, chain: number, level: number): number {
  const ch = Math.max(1, chain);
  let pts = cleared * 10 * ch;
  if (cleared >= 4) pts += (cleared - 3) * 20 * ch;
  if (ch >= 2) pts += 40 * ch * (ch - 1);
  pts *= 1 + (Math.max(1, level) - 1) * 0.1;
  return Math.round(pts);
}

// Paliers de spectacle arcade : au-delà du nettoyage de base (4 liés),
// chaque palier ajoute gerbes, anneaux, flash, secousse et fanfare.
export type ClearTier = 'base' | 'super' | 'mega' | 'ultra';

export function clearTier(removed: number): ClearTier {
  if (removed >= 10) return 'ultra';
  if (removed >= 7) return 'mega';
  if (removed >= 5) return 'super';
  return 'base';
}

// Attaque versus : le nettoyage de base (4 liés) envoie déjà 1 gris,
// puis ça grimpe vite avec la taille et les chaînes.
export function garbageForClear(cleared: number, chain: number): number {
  const ch = Math.max(1, chain);
  const base = cleared >= 8 ? 4 : cleared >= 6 ? 3 : cleared === 5 ? 2 : cleared >= 4 ? 1 : 0;
  const chainBonus = ch >= 2 ? ch : 0;
  return Math.min(6, base + chainBonus);
}

// Toutes les cellules appartenant à un groupe lié (4-connexité stricte :
// haut/bas/gauche/droite, JAMAIS de diagonale) d'au moins 4 blobs de même
// couleur. Les gris (GARB) et le vide ne participent jamais.
export function findMatches(grid: number[][]): Array<{ r: number; c: number }> {
  const rows = grid.length;
  if (!rows) return [];
  const cols = grid[0].length;
  const seen = new Set<number>();
  const out: Array<{ r: number; c: number }> = [];
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = grid[r][c];
      if (v <= 0 || v === GARB || seen.has(r * cols + c)) continue;
      const group: Array<{ r: number; c: number }> = [];
      const stack: Array<{ r: number; c: number }> = [{ r, c }];
      seen.add(r * cols + c);
      while (stack.length) {
        const cur = stack.pop() as { r: number; c: number };
        group.push(cur);
        for (const [dr, dc] of dirs) {
          const nr = cur.r + dr;
          const nc = cur.c + dc;
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
          if (grid[nr][nc] !== v || seen.has(nr * cols + nc)) continue;
          seen.add(nr * cols + nc);
          stack.push({ r: nr, c: nc });
        }
      }
      if (group.length >= 4) {
        for (const cell of group) out.push(cell);
      }
    }
  }
  return out;
}

export function applyGravity(grid: number[][]): void {
  const rows = grid.length;
  if (!rows) return;
  const cols = grid[0].length;
  for (let c = 0; c < cols; c++) {
    let write = rows - 1;
    for (let r = rows - 1; r >= 0; r--) {
      const v = grid[r][c];
      if (v !== 0) {
        grid[write][c] = v;
        if (write !== r) grid[r][c] = 0;
        write--;
      }
    }
    for (let r = write; r >= 0; r--) grid[r][c] = 0;
  }
}

export interface FallMove {
  c: number;
  from: number;
  to: number;
}

// Mouvements de tassement par colonne (from → to), dans l'ordre d'arrivée.
// Sert à la fois à animer la chute et à attester le comportement.
export function computeGravityMoves(grid: number[][]): FallMove[] {
  const moves: FallMove[] = [];
  const rows = grid.length;
  if (!rows) return moves;
  const cols = grid[0].length;
  for (let c = 0; c < cols; c++) {
    let write = rows - 1;
    for (let r = rows - 1; r >= 0; r--) {
      if (grid[r][c] !== 0) {
        if (write !== r) moves.push({ c, from: r, to: write });
        write--;
      }
    }
  }
  return moves;
}

export function stackHeight(grid: number[][]): number {
  const rows = grid.length;
  const cols = rows ? grid[0].length : 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] !== 0) return rows - r;
    }
  }
  return 0;
}

interface ClearAnim {
  cells: Array<{ r: number; c: number }>;
  t: number;
}

interface FallAnim {
  moves: FallMove[];
  t: number;
  dur: number;
}

export interface Gaze {
  x: number;
  y: number;
}

export interface ActivePiece {
  c: number;
  r: number; // ligne de la cellule du haut (peut être < 0 au spawn)
  colors: Trio;
}

const GAZE_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function normGaze(x: number, y: number): Gaze {
  const len = Math.hypot(x, y);
  return len > 0 ? { x: x / len, y: y / len } : { x: 0, y: 0 };
}

// Regards des blobs posés : liés → moyenne des directions vers les voisins
// de même couleur ; presque liés (composante de 3 + partenaire de même
// couleur à ≤ 3 cases) → œillade mutuelle vers le chaînon manquant ;
// pièce active → les regards neutres voisins se tournent vers elle.
// Absent de la carte = regard neutre (dont les gris, qui boudent).
export function computeGaze(grid: number[][], active: ActivePiece | null = null): Map<number, Gaze> {
  const gaze = new Map<number, Gaze>();
  const rows = grid.length;
  if (!rows) return gaze;
  const cols = grid[0].length;
  const at = (r: number, c: number): number =>
    r >= 0 && r < rows && c >= 0 && c < cols ? grid[r][c] : 0;
  // Composantes par couleur (4-connexité, comme findMatches mais sans seuil).
  const comp: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(-1));
  const compCells: Array<Array<{ r: number; c: number }>> = [];
  const compColor: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = grid[r][c];
      if (v <= 0 || v === GARB || comp[r][c] >= 0) continue;
      const id = compCells.length;
      const cells: Array<{ r: number; c: number }> = [];
      const stack = [{ r, c }];
      comp[r][c] = id;
      while (stack.length) {
        const cur = stack.pop() as { r: number; c: number };
        cells.push(cur);
        for (const [dr, dc] of GAZE_DIRS) {
          const nr = cur.r + dr;
          const nc = cur.c + dc;
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
          if (grid[nr][nc] !== v || comp[nr][nc] >= 0) continue;
          comp[nr][nc] = id;
          stack.push({ r: nr, c: nc });
        }
      }
      compCells.push(cells);
      compColor.push(v);
    }
  }
  // 1. Regards liés.
  for (let id = 0; id < compCells.length; id++) {
    for (const cell of compCells[id]) {
      let sx = 0;
      let sy = 0;
      for (const [dr, dc] of GAZE_DIRS) {
        if (at(cell.r + dr, cell.c + dc) === compColor[id]) {
          sx += dc;
          sy += dr;
        }
      }
      if (sx !== 0 || sy !== 0) gaze.set(cell.r * cols + cell.c, normGaze(sx, sy));
    }
  }
  // 2. Presque liés : à un blob près du nettoyage, on se regarde déjà.
  for (let id = 0; id < compCells.length; id++) {
    if (compCells[id].length !== 3) continue;
    let best: { r: number; c: number } | null = null;
    let bestD = Infinity;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (grid[r][c] !== compColor[id] || comp[r][c] === id) continue;
        let d = Infinity;
        for (const m of compCells[id]) d = Math.min(d, Math.abs(m.r - r) + Math.abs(m.c - c));
        if (d <= 3 && d < bestD) {
          bestD = d;
          best = { r, c };
        }
      }
    }
    if (!best) continue;
    const target = best;
    for (const m of compCells[id]) {
      gaze.set(m.r * cols + m.c, normGaze(target.c - m.c, target.r - m.r));
    }
    const bk = target.r * cols + target.c;
    if (!gaze.has(bk)) {
      let mr = target.r;
      let mc = target.c;
      let d = Infinity;
      for (const m of compCells[id]) {
        const dd = Math.abs(m.r - target.r) + Math.abs(m.c - target.c);
        if (dd < d) {
          d = dd;
          mr = m.r;
          mc = m.c;
        }
      }
      gaze.set(bk, normGaze(mc - target.c, mr - target.r));
    }
  }
  // 3. La pièce active attire les regards neutres voisins de même couleur.
  if (active) {
    const piece: ActivePiece = active;
    for (let i = 0; i < 3; i++) {
      const sr: number = piece.r + i;
      const sc: number = piece.c;
      const v: number = piece.colors[i];
      if (v <= 0 || v === GARB || sr < 0 || sr >= rows || sc < 0 || sc >= cols) continue;
      for (const [dr, dc] of GAZE_DIRS) {
        const nr = sr + dr;
        const nc = sc + dc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        if (grid[nr][nc] !== v) continue;
        const k = nr * cols + nc;
        if (!gaze.has(k)) gaze.set(k, normGaze(sc - nc, sr - nr));
      }
    }
  }
  return gaze;
}

// Regards des 3 cases de la pièce active : entre elles (vertical) + vers
// les cases posées voisines de même couleur.
export function slotGaze(grid: number[][], active: ActivePiece): [Gaze, Gaze, Gaze] {
  const out: [Gaze, Gaze, Gaze] = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
  const rows = grid.length;
  const cols = rows ? grid[0].length : 0;
  for (let i = 0; i < 3; i++) {
    const v = active.colors[i];
    if (v <= 0 || v === GARB) continue;
    let sx = 0;
    let sy = 0;
    if (i > 0 && active.colors[i - 1] === v) sy -= 1;
    if (i < 2 && active.colors[i + 1] === v) sy += 1;
    const sr = active.r + i;
    const sc = active.c;
    if (sr >= 0 && sr < rows && sc >= 0 && sc < cols) {
      for (const [dr, dc] of GAZE_DIRS) {
        const nr = sr + dr;
        const nc = sc + dc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        if (grid[nr][nc] === v) {
          sx += dc;
          sy += dr;
        }
      }
    }
    if (sx !== 0 || sy !== 0) out[i] = normGaze(sx, sy);
  }
  return out;
}

// Décalage vertical (en lignes, + vers le bas) de chaque case pendant une
// permutation, avant easing. dir=1 : le bas remonte (+2, −1, −1) ;
// dir=−1 : l'inverse (+1, +1, −2).
const CYCLE_SRC: Record<1 | -1, readonly [number, number, number]> = {
  1: [2, 0, 1],
  [-1]: [1, 2, 0],
};

export function cycleSlide(dir: 1 | -1, slot: number, progress: number): number {
  const p = Math.max(0, Math.min(1, progress));
  const src = CYCLE_SRC[dir][Math.max(0, Math.min(2, slot))];
  // Le + 0 absorbe le -0 (Object.is distingue -0 de 0).
  return (src - slot) * (1 - p) * (1 - p) + 0;
}

// Verrou anti-répétition : une action "un coup par appui" (chute éclair,
// permutation) n'est réarmée que par une remontée complète de la touche.
// Fini les actions en chaîne quand on reste appuyé sur la pièce suivante.
export class ReleaseLatch {
  private armed = true;

  fire(down: boolean, pressed: boolean): boolean {
    if (!down) {
      this.armed = true;
      return false;
    }
    if (pressed && this.armed) {
      this.armed = false;
      return true;
    }
    return false;
  }

  get isArmed(): boolean {
    return this.armed;
  }
}

export class ColumnBoard {
  readonly rows: number;
  readonly cols: number;
  grid: number[][];
  active: ActivePiece | null = null;
  next: Trio = [1, 2, 3];
  fallT = 0;
  level = 1;
  score = 0;
  cleared = 0; // blobs colorés éclatés au total
  pieces = 0;
  chain = 0;
  maxChain = 0;
  pending = 0; // ordures à injecter (versus)
  dead = false;
  flashT = 0;
  dasDir = 0;
  dasT = 0;
  clearAnim: ClearAnim | null = null;
  fallAnim: FallAnim | null = null;

  constructor(rows: number = ROWS, cols: number = COLS) {
    this.rows = rows;
    this.cols = cols;
    this.grid = emptyGrid(rows, cols);
  }

  get interval(): number {
    return fallIntervalForLevel(this.level);
  }

  get busy(): boolean {
    return this.clearAnim !== null || this.fallAnim !== null;
  }

  collides(c: number, r: number, colors: Trio): boolean {
    for (let i = 0; i < 3; i++) {
      const cc = c;
      const rr = r + i;
      if (cc < 0 || cc >= this.cols) return true;
      if (rr >= this.rows) return true;
      if (rr >= 0 && this.grid[rr][cc] !== 0) return true;
    }
    void colors;
    return false;
  }

  trySpawn(colors: Trio, following: Trio): boolean {
    if (this.dead || this.active || this.busy) return false;
    const piece: ActivePiece = { c: 2, r: -2, colors: [colors[0], colors[1], colors[2]] };
    if (this.collides(piece.c, piece.r, piece.colors)) {
      this.dead = true;
      return false;
    }
    this.active = piece;
    this.next = [following[0], following[1], following[2]];
    this.fallT = 0;
    this.dasDir = 0;
    this.dasT = 0;
    return true;
  }

  move(dx: number): boolean {
    if (!this.active || this.busy || this.dead) return false;
    const next = this.active.c + dx;
    if (this.collides(next, this.active.r, this.active.colors)) return false;
    this.active.c = next;
    return true;
  }

  cycle(dir: 1 | -1): void {
    if (!this.active || this.busy || this.dead) return;
    const [a, b, c] = this.active.colors;
    this.active.colors = dir === 1 ? [c, a, b] : [b, c, a];
  }

  ghostRow(): number {
    if (!this.active) return 0;
    let r = this.active.r;
    while (!this.collides(this.active.c, r + 1, this.active.colors)) r++;
    return r;
  }

  // Écrit la pièce dans la grille. Retourne les positions écrites (r >= 0).
  lock(): Array<{ r: number; c: number }> {
    if (!this.active) return [];
    const written: Array<{ r: number; c: number }> = [];
    let above = false;
    for (let i = 0; i < 3; i++) {
      const rr = this.active.r + i;
      const cc = this.active.c;
      if (rr < 0) {
        above = true;
        continue;
      }
      if (rr < this.rows && this.grid[rr][cc] === 0) {
        this.grid[rr][cc] = this.active.colors[i];
        written.push({ r: rr, c: cc });
      }
    }
    this.active = null;
    this.pieces++;
    if (above) {
      // Verrouillage partiellement hors grille : la pile touche le plafond.
      this.dead = true;
    }
    return written;
  }

  beginClear(): boolean {
    if (this.busy || this.dead) return false;
    const cells = findMatches(this.grid);
    if (!cells.length) return false;
    this.clearAnim = { cells, t: CLEAR_T };
    return true;
  }

  // Résout la fin de l'animation : supprime, mange les gris adjacents,
  // puis tasse la grille. Le tassement est ANIMÉ (fallAnim) au lieu d'être
  // instantané : la logique pose l'état final, le rendu interpole la chute.
  // Retourne le nombre de cellules supprimées.
  resolveClear(): { removed: number; garbageEaten: number; fell: number } {
    if (!this.clearAnim) return { removed: 0, garbageEaten: 0, fell: 0 };
    const mark = new Set<number>();
    for (const cell of this.clearAnim.cells) mark.add(cell.r * this.cols + cell.c);
    for (const cell of this.clearAnim.cells) this.grid[cell.r][cell.c] = 0;
    // Les gris orthogonaux adjacents à une explosion sont emportés aussi.
    let garbageEaten = 0;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const extra: Array<{ r: number; c: number }> = [];
    for (const cell of this.clearAnim.cells) {
      for (const [dr, dc] of dirs) {
        const nr = cell.r + dr;
        const nc = cell.c + dc;
        if (nr < 0 || nr >= this.rows || nc < 0 || nc >= this.cols) continue;
        if (this.grid[nr][nc] === GARB && !mark.has(nr * this.cols + nc)) {
          mark.add(nr * this.cols + nc);
          extra.push({ r: nr, c: nc });
          garbageEaten++;
        }
      }
    }
    for (const cell of extra) this.grid[cell.r][cell.c] = 0;
    const removed = this.clearAnim.cells.length + extra.length;
    this.clearAnim = null;
    const moves = computeGravityMoves(this.grid);
    applyGravity(this.grid);
    let fell = 0;
    for (const m of moves) fell = Math.max(fell, m.to - m.from);
    if (moves.length) {
      // Chute lisible : assez lente pour suivre chaque blob des yeux,
      // proportionnelle à la plus grande distance.
      this.fallAnim = { moves, t: 0, dur: Math.min(0.5, 0.12 + fell * 0.09) };
    }
    this.cleared += removed;
    const newLevel = 1 + Math.floor(this.cleared / 12);
    if (newLevel !== this.level) this.level = newLevel;
    return { removed, garbageEaten, fell };
  }

  // Injecte n ordures : chaque gris pousse une colonne vers le haut.
  // Retourne false si la poussée déborde (mort).
  inject(n: number, colOf: (i: number) => number): boolean {
    for (let i = 0; i < n; i++) {
      if (this.busy || this.active) {
        this.pending += n - i;
        return true;
      }
      const c = colOf(i) % this.cols;
      if (this.grid[0][c] !== 0) {
        this.dead = true;
        return false;
      }
      for (let r = 0; r < this.rows - 1; r++) this.grid[r][c] = this.grid[r + 1][c];
      this.grid[this.rows - 1][c] = GARB;
    }
    return !this.dead;
  }

  cellCenter(r: number, c: number, x0: number, y0: number, cell: number): { x: number; y: number } {
    return { x: x0 + (c + 0.5) * cell, y: y0 + (r + 0.5) * cell };
  }
}

interface BoardFx {
  x: number;
  y: number;
  text: string;
  color: string;
  t: number;
}

export class ColumnsGame extends BaseGame {
  static meta: GameMeta = {
    id: 'columns',
    name: 'DR BLOB',
    accent: '#4ade80',
    mood: 'runner',
    desc: 'Trios qui tombent · groupes liés de 4+ qui fusionnent',
    controls: '← → bouger · ↓ chute douce · A permuter · ↑ éclair',
    keys: 'Flèches / ZQSD · Espace permuter · ↑ éclair',
    hint: 'Lie 4+ blobs par les côtés (pas de diagonale) · les gris partent avec les explosions voisines',
    unit: 'pts',
    ranks: [9000, 5500, 3200, 1500, 0],
    players: { min: 1, max: 2 },
  };

  readonly versus: boolean;
  readonly boards: ColumnBoard[] = [];
  readonly mascots: Blob[] = [];
  readonly dots: Array<{ x: number; y: number; z: number; s: number }> = [];
  feed: BoardFx[] = [];
  centerMsg = '';
  centerMsgT = 0;
  winner = -1;
  comboStep = 0;
  // États purement visuels (jamais lus par la logique) :
  // - pieceVis : position glissée de la pièce active (colonnes/lignes flottantes),
  // - squash : cases tassées à l'atterrissage → clé r*cols+c vers temps restant.
  readonly pieceVis: Array<{ x: number; y: number } | null> = [];
  readonly squash: Array<Map<number, number>> = [];
  // Verrous "un coup par appui" (chute éclair + 2 sens de permutation).
  readonly fire: Array<{ up: ReleaseLatch; cycA: ReleaseLatch; cycB: ReleaseLatch }> = [];
  // Animation de permutation par puits (glissé des couleurs entre cases).
  readonly cycleVis: Array<{ t: number; dur: number; dir: 1 | -1 } | null> = [];

  constructor(engine: EngineLike, session?: GameSession) {
    super(engine, session);
    this.versus = this.session.mode === 'local' && this.session.playerCount > 1;
    const count = this.versus ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const board = new ColumnBoard();
      board.next = this.rollTrio(board.level);
      this.boards.push(board);
      this.mascots.push(
        new Blob({
          x: 0,
          y: 0,
          r: 30,
          color: i === 0 ? '#7dd3fc' : '#f472b6',
          trailOn: false,
        }),
      );
      this.pieceVis.push(null);
      this.squash.push(new Map<number, number>());
      this.fire.push({ up: new ReleaseLatch(), cycA: new ReleaseLatch(), cycB: new ReleaseLatch() });
      this.cycleVis.push(null);
    }
    for (let i = 0; i < 42; i++) {
      this.dots.push({
        x: Math.random() * 1280,
        y: Math.random() * 720,
        z: 0.2 + Math.random() * 0.8,
        s: Math.random() * 6.28,
      });
    }
    this.blob.hideTrail = true;
  }

  get p1(): ColumnBoard {
    return this.boards[0];
  }

  get p2(): ColumnBoard | null {
    return this.versus ? this.boards[1] : null;
  }

  rollTrio(level: number): Trio {
    const n = colorCountForLevel(level);
    return [this.rng.int(1, n), this.rng.int(1, n), this.rng.int(1, n)];
  }

  update(dt: number): void {
    if (this.baseUpdate(dt)) return;
    for (const dot of this.dots) {
      dot.x -= (6 + dot.z * 18) * dt;
      dot.y += Math.sin(this.time * 0.7 + dot.s) * 5 * dt;
      if (dot.x < -4) {
        dot.x = 1284;
        dot.y = Math.random() * 720;
      }
    }
    this.centerMsgT = Math.max(0, this.centerMsgT - dt);
    for (const fx of this.feed) fx.t -= dt;
    this.feed = this.feed.filter((fx) => fx.t > 0);

    for (let i = 0; i < this.boards.length; i++) {
      const board = this.boards[i];
      board.flashT = Math.max(0, board.flashT - dt);
      if (!board.dead) this.updateBoard(board, this.players[i], dt, i);
      this.trackPiece(board, i, dt);
      const sq = this.squash[i];
      for (const [k, t] of sq) {
        if (t <= dt) sq.delete(k);
        else sq.set(k, t - dt);
      }
      const cv = this.cycleVis[i];
      if (cv) {
        cv.t += dt;
        if (cv.t >= cv.dur) this.cycleVis[i] = null;
      }
      this.mascots[i].update(dt);
    }

    // Humeurs des mascottes : peur quand ça monte, joie sur les chaînes.
    for (let i = 0; i < this.boards.length; i++) {
      const board = this.boards[i];
      const mascot = this.mascots[i];
      const h = stackHeight(board.grid);
      if (board.dead) {
        mascot.dead = true;
      } else if (h >= ROWS - 3) {
        mascot.setEmotion('scared');
      } else if (mascot.resolvedEmotion() === 'scared') {
        mascot.setEmotion('idle');
      }
    }

    const best = this.versus ? Math.max(this.p1.score, this.p2?.score ?? 0) : this.p1.score;
    if (Number.isFinite(best)) this.score = best;
    this.comboStep = Math.max(this.p1.chain, this.p2?.chain ?? 0);

    if (this.state === 'play') {
      if (!this.versus && this.p1.dead) {
        this.winner = 0;
        this.over(false);
      } else if (this.versus && (this.p1.dead || (this.p2?.dead ?? false))) {
        this.winner = this.p1.dead && this.p2?.dead
          ? this.p1.score >= (this.p2?.score ?? 0) ? 0 : 1
          : this.p1.dead ? 1 : 0;
        this.score = this.boards[this.winner].score;
        this.over(this.winner === 0);
      }
    }
  }

  private updateBoard(board: ColumnBoard, input: PlayerInputLike | undefined, dt: number, index: number): void {
    // Phase d'explosion : on laisse l'animation se jouer.
    if (board.clearAnim) {
      board.clearAnim.t -= dt;
      if (board.clearAnim.t <= 0) {
        const chain = board.chain + 1;
        // Position + teinte dominante capturées AVANT suppression : le
        // spectacle explose à l'endroit exact du groupe, pas au centre.
        const view = this.viewOf(index);
        const doomed = board.clearAnim.cells.slice();
        let ax = 0;
        let ay = 0;
        const tones = new Map<number, number>();
        for (const cell of doomed) {
          const p = board.cellCenter(cell.r, cell.c, view.x0, view.y0, view.cell);
          ax += p.x;
          ay += p.y;
          const v = board.grid[cell.r][cell.c];
          if (v > 0 && v !== GARB) tones.set(v, (tones.get(v) ?? 0) + 1);
        }
        const anchor = doomed.length
          ? { x: ax / doomed.length, y: ay / doomed.length }
          : { x: view.x0 + view.w / 2, y: view.y0 + 120 };
        let groupColor = this.accent;
        let bestTone = 0;
        for (const [v, n] of tones) {
          if (n > bestTone) {
            bestTone = n;
            groupColor = PALETTE[v] || this.accent;
          }
        }
        const { removed } = board.resolveClear();
        board.chain = chain;
        board.maxChain = Math.max(board.maxChain, chain);
        const pts = scoreForClear(removed, chain, board.level);
        board.score += pts;
        this.celebrateClear(index, removed, chain, pts, anchor, groupColor);
        // En versus, on arrose l'adversaire.
        if (this.versus) {
          const foe = this.boards[index === 0 ? 1 : 0];
          const atk = garbageForClear(removed, chain);
          if (atk > 0 && !foe.dead) {
            foe.pending += atk;
            this.audio.hitEnemy();
            this.say(index === 0 ? 1 : 0, '+' + atk + ' GRIS !', '#94a3b8');
            this.input.player(index === 0 ? 1 : 0).rumble(0.25, 0.08);
          }
        }
        // Chaîne suivante ? La chute animée éventuelle passe d'abord ;
        // la suite (chaîne ou ordures) attend la stabilisation.
        if (!board.fallAnim) this.finishSettling(board, index);
      }
      return;
    }

    // Phase de chute : les blobs tassés tombent en animation visible.
    if (board.fallAnim) {
      board.fallAnim.t += dt;
      if (board.fallAnim.t >= board.fallAnim.dur) {
        const moves = board.fallAnim.moves;
        board.fallAnim = null;
        this.landFall(board, index, moves);
        this.finishSettling(board, index);
      }
      return;
    }

    // Pas de pièce : on en pose une.
    if (!board.active) {
      if (board.pending > 0 && !this.versus) board.pending = 0;
      const ok = board.trySpawn(board.next, this.rollTrio(board.level));
      if (!ok) return;
      return;
    }

    // Entrées.
    if (input) this.readBoardInput(board, input, dt, index);

    // Chute.
    const soft = input ? input.down('down') || input.moveY > 0.5 : false;
    const step = board.interval / (soft ? 12 : 1);
    board.fallT += dt;
    if (soft && board.active) board.score += 0; // le bonus doux est crédité au verrouillage
    let guard = 0;
    while (board.active && board.fallT >= step && guard++ < 8) {
      board.fallT -= step;
      const before = board.active.r;
      if (!board.collides(board.active.c, board.active.r + 1, board.active.colors)) {
        board.active.r++;
        if (soft) board.score += 1;
      } else {
        void before;
        this.lockBoard(board, index, false);
        break;
      }
    }
  }

  private readBoardInput(board: ColumnBoard, input: PlayerInputLike, dt: number, index: number): void {
    const piece = board.active;
    if (!piece) return;
    let dir = 0;
    if (input.moveX < -0.5 || input.down('left')) dir = -1;
    else if (input.moveX > 0.5 || input.down('right')) dir = 1;
    if (dir !== 0) {
      if (dir !== board.dasDir) {
        if (board.move(dir)) this.audio.uiMove();
        board.dasDir = dir;
        board.dasT = 0.17;
      } else {
        board.dasT -= dt;
        if (board.dasT <= 0) {
          if (board.move(dir)) this.audio.uiMove();
          board.dasT += 0.06;
        }
      }
    } else {
      board.dasDir = 0;
      board.dasT = 0;
    }
    // Actions "un coup par appui" : le verrou exige une remontée complète
    // de la touche avant de réarmer — impossible d'enchaîner sur la pièce
    // suivante en restant appuyé.
    const fire = this.fire[index];
    if (fire.cycA.fire(input.down('a') || input.down('x'), input.pressed('a') || input.pressed('x'))) {
      board.cycle(1);
      this.audio.land();
      this.cycleVis[index] = { t: 0, dur: 0.16, dir: 1 };
      this.cycleRing(board, index);
    } else if (fire.cycB.fire(input.down('b') || input.down('y'), input.pressed('b') || input.pressed('y'))) {
      board.cycle(-1);
      this.audio.land();
      this.cycleVis[index] = { t: 0, dur: 0.16, dir: -1 };
      this.cycleRing(board, index);
    }
    if (fire.up.fire(input.down('up'), input.pressed('up'))) {
      const target = board.ghostRow();
      const dist = Math.max(0, target - piece.r);
      piece.r = target;
      board.score += dist * 2;
      this.audio.shoot();
      this.lockBoard(board, this.boards.indexOf(board), true);
    }
  }

  // Petit anneau blanc sur la case du milieu : la permutation se voit.
  private cycleRing(board: ColumnBoard, index: number): void {
    const piece = board.active;
    if (!piece || piece.r + 1 < 0) return;
    const view = this.viewOf(index);
    const p = board.cellCenter(piece.r + 1, piece.c, view.x0, view.y0, view.cell);
    this.fx.ring(p.x, p.y, { r0: 8, r1: 40, color: '#ffffff', life: 0.22, width: 2 });
  }

  // Glissé visuel de la pièce active : la logique reste discrète (cases
  // entières pour collisions et score), seul le rendu glisse en continu.
  private trackPiece(board: ColumnBoard, index: number, dt: number): void {
    const active = board.active;
    if (!active) {
      this.pieceVis[index] = null;
      return;
    }
    const cur = this.pieceVis[index];
    if (!cur || Math.abs(active.c - cur.x) + Math.abs(active.r - cur.y) > 2.5) {
      this.pieceVis[index] = { x: active.c, y: active.r }; // snap (spawn, chute éclair)
      return;
    }
    const k = Math.min(1, dt * 18);
    cur.x += (active.c - cur.x) * k;
    cur.y += (active.r - cur.y) * k;
  }

  private lockBoard(board: ColumnBoard, index: number, hard: boolean): void {
    const written = board.lock();
    board.fallT = 0;
    if (board.dead) return;
    this.audio.land();
    if (hard) {
      this.fx.shake(0.08);
      this.input.player(index).rumble(0.15, 0.05);
    }
    if (written.length) {
      const view = this.viewOf(index);
      const last = written[written.length - 1];
      const p = board.cellCenter(last.r, last.c, view.x0, view.y0, view.cell);
      this.fx.burst(p.x, p.y, {
        n: 5,
        speed: [40, 150],
        colors: [this.accent, '#ffffff'],
        size: [1.5, 3],
        life: 0.3,
      });
      void view;
    }
    if (!board.beginClear()) {
      board.chain = 0;
      this.welcomePending(board, index);
    } else {
      board.chain = 0; // resolveClear l'incrémentera à 1
    }
  }

  // Puits stabilisé (chute terminée ou aucun mouvement) : on cherche la
  // chaîne suivante, sinon on accueille les ordures en attente.
  private finishSettling(board: ColumnBoard, index: number): void {
    if (!board.beginClear()) {
      board.chain = 0;
      this.welcomePending(board, index);
    }
  }

  // Les ordures en attente poussent les colonnes quand le puits est stable.
  private welcomePending(board: ColumnBoard, index: number): void {
    if (board.pending <= 0 || board.dead || board.busy || board.active) return;
    const n = board.pending;
    board.pending = 0;
    for (let k = 0; k < n; k++) {
      const c = this.rng.int(0, board.cols - 1);
      if (board.grid[0][c] !== 0) {
        board.dead = true;
        break;
      }
      for (let r = 0; r < board.rows - 1; r++) board.grid[r][c] = board.grid[r + 1][c];
      board.grid[board.rows - 1][c] = GARB;
    }
    if (n > 0) {
      board.flashT = 0.6;
      this.audio.hurt();
      this.fx.shake(0.18);
      this.fx.flash('#64748b', 0.1);
      this.say(index, '+' + n + ' GRIS REÇUS', '#94a3b8');
    }
  }

  // Atterrissage de la chute : écrasement visuel sur toutes les cases
  // d'arrivée, plus poussière et petit choc si ça tombait de haut.
  private landFall(board: ColumnBoard, index: number, moves: FallMove[]): void {
    let dist = 0;
    const sq = this.squash[index];
    for (const m of moves) {
      dist = Math.max(dist, m.to - m.from);
      if (m.to - m.from >= 1) {
        if (sq.size > 60) {
          const oldest = sq.keys().next();
          if (!oldest.done) sq.delete(oldest.value);
        }
        sq.set(m.to * board.cols + m.c, 0.25);
      }
    }
    if (dist < 2) return;
    const view = this.viewOf(index);
    this.audio.land();
    this.fx.shake(Math.min(0.12, 0.03 + dist * 0.015));
    let bursts = 0;
    for (const m of moves) {
      if (m.to - m.from < 2 || bursts >= 8) continue;
      bursts++;
      const p = board.cellCenter(m.to, m.c, view.x0, view.y0, view.cell);
      this.fx.burst(p.x, p.y + view.cell * 0.3, {
        n: 4, speed: [30, 120], colors: ['#aeb8c8', '#ffffff'], size: [1.5, 3], life: 0.3,
      });
    }
    void view;
  }

  // Spectacle d'explosion par palier, teinté de la couleur du groupe.
  private celebrateClear(
    index: number,
    removed: number,
    chain: number,
    pts: number,
    anchor: { x: number; y: number },
    groupColor: string,
  ): void {
    const tier = clearTier(removed);
    const gold = chain >= 2;
    // Gerbe principale teintée du groupe.
    this.fx.burst(anchor.x, anchor.y, {
      n: tier === 'base' ? Math.min(40, 10 + removed * 4)
        : tier === 'super' ? 60 : tier === 'mega' ? 95 : 140,
      speed: tier === 'base' ? [70, 340] : [90, 480],
      colors: [groupColor, '#ffffff', gold ? '#fde047' : this.accent],
      size: [2, 5],
      life: tier === 'base' ? 0.55 : 0.75,
    });
    // Étincelles directionnelles pour les gros paliers.
    if (tier !== 'base') {
      this.fx.burst(anchor.x, anchor.y, {
        n: tier === 'super' ? 18 : tier === 'mega' ? 30 : 44,
        speed: [280, 580],
        colors: ['#ffffff', groupColor],
        size: [1.5, 3],
        life: 0.4,
        shape: 'spark',
      });
    }
    // Anneaux de choc empilés, le dernier en onde blanche large.
    const rings = tier === 'base' ? 1 : tier === 'super' ? 2 : tier === 'mega' ? 3 : 4;
    for (let i = 0; i < rings; i++) {
      const last = i === rings - 1;
      this.fx.ring(anchor.x, anchor.y, {
        r0: 10 + i * 14,
        r1: last ? 150 + removed * 10 : 40 + removed * 8 + chain * 10 + i * 26,
        color: last ? '#ffffff' : i === 0 ? (gold ? '#fde047' : groupColor) : this.accent,
        life: last ? 0.55 : 0.35 + i * 0.06,
        width: last ? 5 : 3,
      });
    }
    // Confettis carrés qui retombent pour l'ultra.
    if (tier === 'ultra') {
      this.fx.burst(anchor.x, anchor.y - 20, {
        n: 40,
        speed: [120, 420],
        colors: [groupColor, '#fde047', '#ffffff', this.accent],
        size: [2, 5],
        life: 0.9,
        grav: 320,
        shape: 'sq',
      });
    }
    // Flash d'écran teinté (+ blanc pour l'ultra).
    this.fx.flash(groupColor, tier === 'base' ? 0.06 : tier === 'super' ? 0.12 : tier === 'mega' ? 0.18 : 0.22);
    if (tier === 'ultra') this.fx.flash('#ffffff', 0.12);
    // Textes : score seul en base, bandeau arcade au-delà.
    if (tier === 'base') {
      this.fx.text(anchor.x, anchor.y - 26, '+' + pts, {
        color: gold ? '#fde047' : '#eaf6ff',
        size: gold ? 26 : 19,
        mono: true,
      });
    } else {
      const label = tier === 'super' ? 'SUPER +' + removed + ' !'
        : tier === 'mega' ? 'MÉGA +' + removed + ' !!' : 'ULTRA FUSION +' + removed + ' !!!';
      this.fx.text(anchor.x, anchor.y - 34, label, {
        color: '#fde047',
        size: tier === 'ultra' ? 40 : tier === 'mega' ? 34 : 28,
      });
      this.fx.text(anchor.x, anchor.y - 62, '+' + pts, { color: '#eaf6ff', size: 20, mono: true });
    }
    // Sons + secousse + hitstop.
    this.audio.coin(Math.min(24, 2 + chain * 2 + Math.min(8, removed)));
    this.musicEvent('combo', Math.min(1.4, 0.4 + chain * 0.12 + removed * 0.02));
    if (tier === 'base') {
      if (!gold) {
        this.fx.shake(0.05);
        this.mascots[index].punch(0.2);
        return;
      }
      this.audio.perfect();
      this.fx.shake(Math.min(0.4, 0.1 + removed * 0.02 + chain * 0.05));
      this.fx.stop(chain >= 3 ? 0.06 : 0.03);
      this.say(index, 'CHAÎNE ×' + chain + ' !');
      this.mascots[index].punch(0.45);
      this.mascots[index].setEmotion('happy', 1.2);
      return;
    }
    this.audio.perfect();
    this.fx.shake(tier === 'super' ? 0.16 : tier === 'mega' ? 0.28 : 0.4);
    this.fx.stop(tier === 'super' ? 0.04 : tier === 'mega' ? 0.06 : 0.09);
    if (tier === 'mega') this.audio.milestone();
    if (tier === 'ultra') {
      this.audio.milestone();
      this.musicEvent('powerUp', 0.9);
      this.input.player(index).rumble(0.35, 0.12);
    }
    this.say(index, tier === 'super' ? 'SUPER +' + removed + ' !' : tier === 'mega' ? 'MÉGA +' + removed + ' !!' : 'ULTRA FUSION !!!');
    this.mascots[index].punch(0.6);
    this.mascots[index].setEmotion('happy', tier === 'ultra' ? 2 : 1.2);
  }

  private say(boardIndex: number, text: string, color: string = '#fde047'): void {
    const view = this.viewOf(boardIndex);
    this.feed.push({ x: view.x0 + view.w / 2, y: view.y0 - 24, text, color, t: 1.4 });
    if (this.versus) {
      this.centerMsg = text;
      this.centerMsgT = 1.2;
    }
  }

  // ---------- mise en page ----------
  viewOf(index: number): { x0: number; y0: number; cell: number; w: number; h: number } {
    if (!this.versus) {
      const cell = 40;
      const w = COLS * cell;
      const h = ROWS * cell;
      return { x0: 640 - w / 2, y0: 116, cell, w, h };
    }
    const cell = 32;
    const w = COLS * cell;
    const h = ROWS * cell;
    const gap = 150;
    const total = w * 2 + gap;
    const x0 = (1280 - total) / 2 + index * (w + gap);
    return { x0, y0: 168, cell, w, h };
  }

  // ---------- rendu ----------
  render(ctx: CanvasRenderingContext2D): void {
    const bg = ctx.createLinearGradient(0, 0, 0, 720);
    bg.addColorStop(0, '#0a1220');
    bg.addColorStop(0.55, '#070910');
    bg.addColorStop(1, '#05060b');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 1280, 720);
    this.fx.world(ctx);
    UI.grid(ctx, { gap: 64, off: this.time * 7, alpha: 0.05, color: '#4ade80' });
    for (const dot of this.dots) {
      ctx.globalAlpha = 0.05 + dot.z * 0.09;
      ctx.fillStyle = '#4ade80';
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, 1.1 + dot.z * 1.7, 0, 6.2832);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (!this.versus) this.renderSoloTable(ctx);
    else this.renderVersusTable(ctx);

    for (let i = 0; i < this.boards.length; i++) this.renderBoard(ctx, i);
    for (let i = 0; i < this.boards.length; i++) this.renderMascot(ctx, i);

    // Messages flottants.
    for (const fx of this.feed) {
      const k = Math.min(1, fx.t / 0.5);
      ctx.globalAlpha = Math.min(1, k * 2);
      UI.txt(ctx, fx.text, fx.x, fx.y - (1.4 - fx.t) * 26, {
        size: 21,
        align: 'center',
        color: fx.color,
        weight: 900,
        shadow: true,
      });
      ctx.globalAlpha = 1;
    }

    this.fx.drawWorld(ctx);
    this.fx.endWorld(ctx);

    if (this.versus) this.renderVersusHud(ctx);
    else {
      UI.drawHUD(ctx, {
        accent: this.accent,
        score: this.p1.score,
        unit: this.meta.unit,
        time: this.time,
        extra: () => {
          UI.txt(ctx, 'NIVEAU ' + this.p1.level, 28, 96, { size: 13, mono: true, color: '#4ade80' });
          UI.txt(ctx, 'ÉCLATÉS ' + this.p1.cleared, 28, 114, { size: 12, mono: true, color: '#7c8698' });
          if (this.p1.maxChain >= 2) UI.txt(ctx, 'MAX CHAÎNE ×' + this.p1.maxChain, 28, 132, { size: 12, mono: true, color: '#fde047' });
          if (this.p1.pending > 0) UI.txt(ctx, '+' + this.p1.pending + ' GRIS', 28, 150, { size: 12, mono: true, color: '#94a3b8' });
        },
      });
      const best = UI.getBest(this.bestKey || this.meta.id);
      if (best > 0) UI.txt(ctx, 'RECORD ' + UI.fmt(best), 1252, 96, { size: 12, align: 'right', mono: true, color: '#5d6480' });
    }
    if (this.state === 'over' && this.versus && this.winner >= 0) {
      UI.txt(ctx, this.winner === 0 ? 'JOUEUR 1 GAGNE !' : 'JOUEUR 2 GAGNE !', 640, 120, {
        size: 30,
        align: 'center',
        color: this.winner === 0 ? '#7dd3fc' : '#f472b6',
        weight: 900,
        shadow: true,
      });
      UI.txt(ctx, this.p1.score + ' — ' + (this.p2?.score ?? 0), 640, 146, {
        size: 16,
        align: 'center',
        mono: true,
        color: '#aeb8c8',
      });
    }
    this.drawCommon(ctx);
  }

  private renderSoloTable(ctx: CanvasRenderingContext2D): void {
    const view = this.viewOf(0);
    // Panneau latéral gauche : suivant + niveau.
    UI.panel(ctx, view.x0 - 218, view.y0 + 40, 178, 220, {
      radius: 16,
      fill: 'rgba(9,12,19,0.9)',
      stroke: this.accent + '44',
    });
    UI.txt(ctx, 'SUIVANT', view.x0 - 129, view.y0 + 68, { size: 12, align: 'center', mono: true, color: this.accent });
    this.drawTrio(ctx, this.p1.next, view.x0 - 129, view.y0 + 108, 15);
    UI.txt(ctx, 'NIVEAU ' + this.p1.level, view.x0 - 129, view.y0 + 208, {
      size: 15,
      align: 'center',
      mono: true,
      color: '#eaf6ff',
      weight: 900,
    });
    UI.txt(ctx, 'VITESSE ' + this.p1.interval.toFixed(2) + 's', view.x0 - 129, view.y0 + 230, {
      size: 11,
      align: 'center',
      mono: true,
      color: '#7c8698',
    });
    // Aide.
    UI.panel(ctx, view.x0 - 218, view.y0 + 276, 178, 132, { radius: 16, fill: 'rgba(9,12,19,0.82)', stroke: 'rgba(255,255,255,0.08)' });
    UI.txt(ctx, '← → bouger', view.x0 - 129, view.y0 + 306, { size: 12, align: 'center', color: '#aeb8c8' });
    UI.txt(ctx, 'ESPACE permuter', view.x0 - 129, view.y0 + 328, { size: 12, align: 'center', color: '#aeb8c8' });
    UI.txt(ctx, '↓ douce · ↑ éclair', view.x0 - 129, view.y0 + 350, { size: 12, align: 'center', color: '#aeb8c8' });
    UI.txt(ctx, 'X / B sens inverse', view.x0 - 129, view.y0 + 372, { size: 11, align: 'center', mono: true, color: '#5d6480' });
  }

  private renderVersusTable(ctx: CanvasRenderingContext2D): void {
    // Arche centrale.
    UI.txt(ctx, 'VS', 640, 330, { size: 54, align: 'center', color: '#eaf6ff', weight: 900, shadow: true });
    if (this.centerMsgT > 0) {
      ctx.globalAlpha = Math.min(1, this.centerMsgT * 2);
      UI.txt(ctx, this.centerMsg, 640, 372, { size: 19, align: 'center', color: '#fde047', weight: 900, shadow: true });
      ctx.globalAlpha = 1;
    }
    UI.txt(ctx, 'LE PERDANT DÉBORDE', 640, 560, { size: 11, align: 'center', mono: true, color: '#5d6480' });
  }

  private renderVersusHud(ctx: CanvasRenderingContext2D): void {
    const labels = ['P1 · CLAVIER / PAD', 'P2 · MANETTE'];
    const colors = ['#7dd3fc', '#f472b6'];
    for (let i = 0; i < 2; i++) {
      const view = this.viewOf(i);
      const board = this.boards[i];
      UI.txt(ctx, labels[i], view.x0 + view.w / 2, view.y0 - 66, {
        size: 12,
        align: 'center',
        mono: true,
        color: colors[i],
        weight: 900,
      });
      UI.txt(ctx, UI.fmt(board.score), view.x0 + view.w / 2, view.y0 - 36, {
        size: 30,
        align: 'center',
        mono: true,
        color: '#eaf6ff',
        weight: 700,
        shadow: true,
      });
      UI.txt(ctx, 'NIV ' + board.level + ' · ' + board.cleared + ' éclatés', view.x0 + view.w / 2, view.y0 + view.h + 28, {
        size: 12,
        align: 'center',
        mono: true,
        color: '#7c8698',
      });
      if (board.pending > 0) {
        UI.txt(ctx, '+' + board.pending + ' GRIS EN ROUTE', view.x0 + view.w / 2, view.y0 + view.h + 48, {
          size: 12,
          align: 'center',
          mono: true,
          color: '#94a3b8',
          weight: 900,
        });
      }
      // Suivant compact au-dessus du puits.
      this.drawTrio(ctx, board.next, view.x0 + view.w - 18, view.y0 - 44, 8);
    }
  }

  private renderBoard(ctx: CanvasRenderingContext2D, index: number): void {
    const board = this.boards[index];
    const view = this.viewOf(index);
    const frame = this.versus ? (index === 0 ? '#7dd3fc' : '#f472b6') : this.accent;
    const h = stackHeight(board.grid);
    const danger = !board.dead && h >= ROWS - 3;

    // Cadre.
    ctx.save();
    if (danger && Math.sin(this.time * 8) > 0) {
      ctx.shadowColor = '#ff5470';
      ctx.shadowBlur = 26;
    } else {
      ctx.shadowColor = frame;
      ctx.shadowBlur = 14;
    }
    UI.panel(ctx, view.x0 - 8, view.y0 - 8, view.w + 16, view.h + 16, {
      radius: 14,
      fill: 'rgba(5,7,13,0.92)',
      stroke: danger ? '#ff5470' : frame + '66',
      lineWidth: 2,
    });
    ctx.restore();

    // Grille de fond.
    ctx.save();
    ctx.strokeStyle = 'rgba(148,163,184,0.09)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let c = 1; c < COLS; c++) {
      ctx.moveTo(view.x0 + c * view.cell, view.y0);
      ctx.lineTo(view.x0 + c * view.cell, view.y0 + view.h);
    }
    for (let r = 1; r < ROWS; r++) {
      ctx.moveTo(view.x0, view.y0 + r * view.cell);
      ctx.lineTo(view.x0 + view.w, view.y0 + r * view.cell);
    }
    ctx.stroke();
    // Ligne de danger (plafond).
    ctx.strokeStyle = danger ? '#ff547055' : 'rgba(148,163,184,0.22)';
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(view.x0, view.y0 + 4);
    ctx.lineTo(view.x0 + view.w, view.y0 + 4);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    if (board.flashT > 0) {
      ctx.globalAlpha = Math.min(0.3, board.flashT * 0.5);
      ctx.fillStyle = '#64748b';
      ctx.fillRect(view.x0, view.y0, view.w, view.h);
      ctx.globalAlpha = 1;
    }

    const clearing = new Set<number>();
    let clearK = 1;
    if (board.clearAnim) {
      for (const cell of board.clearAnim.cells) clearing.add(cell.r * COLS + cell.c);
      clearK = Math.max(0, board.clearAnim.t / CLEAR_T);
    }
    // Centroïde du groupe en fusion : les blobs convergent visuellement
    // vers lui avant d'éclater (effet gooey de matière).
    let centroid: { x: number; y: number } | null = null;
    const mergeK = board.clearAnim ? 1 - clearK : 0;
    if (board.clearAnim && board.clearAnim.cells.length) {
      let sx = 0;
      let sy = 0;
      for (const cell of board.clearAnim.cells) {
        const p = board.cellCenter(cell.r, cell.c, view.x0, view.y0, view.cell);
        sx += p.x;
        sy += p.y;
      }
      centroid = { x: sx / board.clearAnim.cells.length, y: sy / board.clearAnim.cells.length };
    }
    // Chute animée : case d'arrivée → ligne d'origine (le rendu interpole).
    const falling = new Map<number, number>();
    if (board.fallAnim) {
      for (const m of board.fallAnim.moves) falling.set(m.to * board.cols + m.c, m.from);
    }
    const cellPos = (r: number, c: number): { x: number; y: number } => {      const p = board.cellCenter(r, c, view.x0, view.y0, view.cell);
      let x = p.x;
      let y = p.y;
      if (centroid && clearing.has(r * COLS + c)) {
        const k = mergeK * 0.45;
        x += (centroid.x - x) * k;
        y += (centroid.y - y) * k;
      }
      const from = falling.get(r * board.cols + c);
      if (from !== undefined) {
        // Chute animée : interpolation accélérée (ease-in) depuis la
        // position d'origine vers la case tassée.
        const fallP = board.fallAnim && board.fallAnim.dur > 0
          ? Math.max(0, Math.min(1, board.fallAnim.t / board.fallAnim.dur))
          : 1;
        y += (from - r) * view.cell * (1 - fallP * fallP);
      }
      return { x, y };
    };

    // Ponts gooey : capsules entre voisins orthogonaux de même couleur,
    // dessinées sous les blobs pour un rendu "matière fusionnée".
    ctx.save();
    ctx.lineCap = 'round';
    const gooR = view.cell / 2 - 2.5;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const v = board.grid[r][c];
        if (v <= 0 || v === GARB) continue;
        const pairs: Array<[number, number]> = [[r, c + 1], [r + 1, c]];
        for (const [nr, nc] of pairs) {
          if (nr >= ROWS || nc >= COLS) continue;
          if (board.grid[nr][nc] !== v) continue;
          const hot = clearing.has(r * COLS + c) && clearing.has(nr * COLS + nc);
          const p1 = cellPos(r, c);
          const p2 = cellPos(nr, nc);
          ctx.strokeStyle = shade(PALETTE[v] || '#ffffff', hot ? 1 : 0.72);
          ctx.lineWidth = Math.max(2, gooR * (hot ? 1.5 : 1.05));
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
          if (hot) {
            ctx.strokeStyle = 'rgba(255,255,255,0.5)';
            ctx.lineWidth = Math.max(1, gooR * 0.5 * mergeK);
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
          }
        }
      }
    }
    ctx.restore();

    // Cellules posées.
    const fallP = board.fallAnim && board.fallAnim.dur > 0
      ? Math.max(0, Math.min(1, board.fallAnim.t / board.fallAnim.dur))
      : 1;
    // Regards : calculés une fois par frame (grille minuscule).
    const gazeMap = computeGaze(board.grid, board.active);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const v = board.grid[r][c];
        if (v === 0) continue;
        const p = cellPos(r, c);
        const isClearing = clearing.has(r * COLS + c);
        const pop = isClearing ? 1 + (1 - clearK) * 0.35 : 1;
        const gz = gazeMap.get(r * board.cols + c);
        let sx = 1;
        let sy = 1;
        let dy = 0;
        const from = falling.get(r * board.cols + c);
        if (from !== undefined) {
          // Étiré en pleine chute, au maximum à mi-course.
          const stretch = Math.sin(Math.min(1, fallP) * Math.PI) * Math.min(0.3, 0.08 + (from - r) * 0.05);
          sx = 1 - stretch * 0.55;
          sy = 1 + stretch;
        } else {
          const st = this.squash[index].get(r * board.cols + c);
          if (st !== undefined) {
            // Écrasé à l'atterrissage, retour élastique.
            const s = Math.max(0, Math.min(1, st / 0.25));
            sx = 1 + 0.32 * s;
            sy = 1 - 0.38 * s;
            dy = (view.cell / 2 - 2.5) * 0.15 * s;
          }
        }
        this.drawCell(ctx, p.x, p.y + dy, (view.cell / 2 - 2.5) * pop, v, isClearing ? 1 - clearK : 0, sx, sy, gz ? gz.x : 0, gz ? gz.y : 0);
      }
    }

    // Fantôme + pièce active.
    if (board.active && !board.dead && !board.clearAnim) {
      const ghost = board.ghostRow();
      ctx.save();
      ctx.globalAlpha = 0.22;
      ctx.strokeStyle = '#ffffff';
      ctx.setLineDash([4, 4]);
      for (let i = 0; i < 3; i++) {
        const rr = ghost + i;
        if (rr < 0) continue;
        const p = board.cellCenter(rr, board.active.c, view.x0, view.y0, view.cell);
        ctx.strokeRect(p.x - view.cell / 2 + 3, p.y - view.cell / 2 + 3, view.cell - 6, view.cell - 6);
      }
      ctx.restore();
      ctx.globalAlpha = 1;
      // Pièce glissée : le rendu suit la position interpolée (visuel),
      // masquée au-dessus du plafond exactement comme la logique.
      const vis = this.pieceVis[index];
      const bx = vis ? vis.x : board.active.c;
      const by = vis ? vis.y : board.active.r;
      const inp = this.players[index];
      const soft = !!inp && (inp.down('down') || inp.moveY > 0.5);
      // Permutation : les couleurs glissent vers leurs cases + petit rebond.
      const cyc = this.cycleVis[index];
      const cp = cyc ? Math.max(0, Math.min(1, cyc.t / cyc.dur)) : 1;
      const punch = cyc ? 1 + 0.18 * Math.sin(cp * Math.PI) : 1;
      const slots = slotGaze(board.grid, board.active);
      for (let i = 0; i < 3; i++) {
        const rr = board.active.r + i;
        if (rr < 0) continue;
        const slide = cyc ? cycleSlide(cyc.dir, i, cp) : 0;
        const ry = by + i + slide;
        if (ry < -0.9) continue;
        const p = { x: view.x0 + (bx + 0.5) * view.cell, y: view.y0 + (ry + 0.5) * view.cell };
        const wob = 1 + Math.sin(this.time * 6 + i * 0.9) * 0.03;
        this.drawCell(ctx, p.x, p.y, (view.cell / 2 - 2.5) * wob * punch, board.active.colors[i], 0, soft ? 0.93 : 1, soft ? 1.14 : 1, slots[i].x, slots[i].y);
      }
    }

    if (board.dead) {
      ctx.fillStyle = 'rgba(5,7,13,0.55)';
      ctx.fillRect(view.x0, view.y0, view.w, view.h);
      UI.txt(ctx, 'DÉBORDÉ', view.x0 + view.w / 2, view.y0 + view.h / 2, {
        size: 26,
        align: 'center',
        color: '#ff5470',
        weight: 900,
        shadow: true,
      });
    }
  }

  private drawTrio(ctx: CanvasRenderingContext2D, trio: Trio, x: number, y: number, r: number): void {
    // La suivante aussi se regarde entre voisines de même couleur.
    for (let i = 0; i < 3; i++) {
      let gy = 0;
      if (i > 0 && trio[i] === trio[i - 1]) gy -= 1;
      if (i < 2 && trio[i] === trio[i + 1]) gy += 1;
      this.drawCell(ctx, x, y + (i - 1) * (r * 2 + 4), r, trio[i], 0, 1, 1, 0, gy);
    }
  }

  private drawCell(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    r: number,
    v: number,
    flash: number,
    sx = 1,
    sy = 1,
    gx = 0,
    gy = 0,
  ): void {
    const base = v === GARB ? GARB_COLOR : PALETTE[v] || '#ffffff';
    const rr = Math.max(4, r);
    // Squash & stretch façon Puyo : tout le blob (reflets et visage
    // compris) se déforme autour de son centre.
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(sx, sy);
    ctx.translate(-x, -y);
    const g = ctx.createRadialGradient(x - rr * 0.3, y - rr * 0.35, rr * 0.1, x, y, rr);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.25, base);
    g.addColorStop(1, shade(base, 0.55));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, 6.2832);
    ctx.fill();
    // Reflet.
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath();
    ctx.ellipse(x - rr * 0.3, y - rr * 0.38, rr * 0.28, rr * 0.17, -0.5, 0, 6.2832);
    ctx.fill();
    if (flash > 0) {
      ctx.globalAlpha = Math.min(1, flash + 0.25);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x, y, rr * (0.4 + flash * 0.5), 0, 6.2832);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (v === GARB) {
      // Grumpy : sourcils + bouche plate.
      ctx.strokeStyle = '#0b0e14';
      ctx.lineWidth = Math.max(1.2, rr * 0.12);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x - rr * 0.42, y - rr * 0.3);
      ctx.lineTo(x - rr * 0.08, y - rr * 0.14);
      ctx.moveTo(x + rr * 0.42, y - rr * 0.3);
      ctx.lineTo(x + rr * 0.08, y - rr * 0.14);
      ctx.stroke();
      ctx.fillStyle = '#0b0e14';
      ctx.beginPath();
      ctx.arc(x - rr * 0.2, y + rr * 0.05, rr * 0.11, 0, 6.2832);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x + rr * 0.2, y + rr * 0.05, rr * 0.11, 0, 6.2832);
      ctx.fill();
      ctx.restore();
      return;
    }
    // Yeux mignons qui regardent (gx, gy) : copains liés ou chaînon manquant.
    const ex = rr * 0.26;
    const ey = -rr * 0.08;
    const lx = gx * rr * 0.05;
    const ly = gy * rr * 0.05;
    ctx.fillStyle = '#f4fbff';
    ctx.beginPath();
    ctx.ellipse(x - ex + lx * 0.6, y + ey + ly * 0.6, rr * 0.2, rr * 0.24, 0, 0, 6.2832);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x + ex + lx * 0.6, y + ey + ly * 0.6, rr * 0.2, rr * 0.24, 0, 0, 6.2832);
    ctx.fill();
    ctx.fillStyle = '#0b0e14';
    ctx.beginPath();
    ctx.arc(x - ex + lx, y + ey + rr * 0.05 + ly, rr * 0.1, 0, 6.2832);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + ex + lx, y + ey + rr * 0.05 + ly, rr * 0.1, 0, 6.2832);
    ctx.fill();
    ctx.strokeStyle = '#0b0e14';
    ctx.lineWidth = Math.max(1, rr * 0.07);
    ctx.beginPath();
    ctx.moveTo(x - rr * 0.18, y + rr * 0.32);
    ctx.quadraticCurveTo(x, y + rr * 0.42, x + rr * 0.18, y + rr * 0.32);
    ctx.stroke();
    ctx.restore();
  }

  private renderMascot(ctx: CanvasRenderingContext2D, index: number): void {
    const view = this.viewOf(index);
    const mascot = this.mascots[index];
    if (!this.versus) {
      mascot.x = view.x0 + view.w + 150;
      mascot.y = view.y0 + view.h - 60;
    } else {
      mascot.x = index === 0 ? view.x0 - 74 : view.x0 + view.w + 74;
      mascot.y = view.y0 + view.h - 40;
    }
    mascot.render(ctx);
    const board = this.boards[index];
    UI.txt(ctx, 'NIV ' + board.level, mascot.x, mascot.y + 52, {
      size: 12,
      align: 'center',
      mono: true,
      color: '#7c8698',
    });
  }

  debugSnapshot(): Record<string, string | number | boolean | null> {
    return {
      game: 'columns',
      state: this.state,
      versus: this.versus,
      p1score: this.p1.score,
      p2score: this.p2?.score ?? 0,
      p1level: this.p1.level,
      p1chain: this.p1.chain,
      seed: this.session.seed,
    };
  }
}

function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  if (!Number.isFinite(n)) return hex;
  const r = Math.round(((n >> 16) & 255) * f);
  const g = Math.round(((n >> 8) & 255) * f);
  const b = Math.round((n & 255) * f);
  return `rgb(${r},${g},${b})`;
}
