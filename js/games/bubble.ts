// BLOB POP — Puzzle-Bobble-like : on vise depuis le bas et on tire des
// bulles à l'unité. La bulle colle au plafond ou aux voisines (grille
// hexagonale odd-r), les groupes de 3+ de même couleur éclatent, les grappes
// décrochées du plafond tombent. Les bulles grises (ordures) ne combinent
// jamais : elles partent avec les explosions voisines ou en tombant.
// Solo : le plafond descend toutes les N boules, score attack.
// Versus local : chaque pop/grappe arrose l'adversaire de lignes d'ordures.
// P1 : clavier ou manette · P2 : manette (contrainte du hub d'entrées).

import { BaseGame } from '../core/game';
import { Blob } from '../core/blob';
import * as UI from '../core/ui';
import type { EngineLike, GameMeta, GameSession, PlayerInputLike } from '../core/types';

export const BCOLS = 10;
export const BROWS = 12;
export const BGARB = 9;
export const LOSE_ROW = BROWS - 2;
const SQRT3 = Math.sqrt(3);
const MAX_COLOR = 5;

export const BPALETTE: readonly string[] = [
  '',
  '#f472b6', // 1 rose
  '#22d3ee', // 2 cyan
  '#22c55e', // 3 vert franc (contraste net avec l'ambre)
  '#fbbf24', // 4 ambre chaud
  '#c084fc', // 5 violet
];
export const BGARB_COLOR = '#64748b';

export interface RngLike {
  int(min: number, max: number): number;
  next(): number;
}

export interface CellRef {
  r: number;
  c: number;
}

export interface BubbleLayout {
  ox: number; // x du centre de la colonne 0 (lignes paires)
  oy: number; // y du centre de la ligne 0
  R: number;
  cols: number;
  rows: number;
  lx: number; // mur gauche intérieur
  rx: number; // mur droit intérieur
  cx: number; // canon x
  shooterY: number;
  lineY: number; // ligne de mort (haut de LOSE_ROW)
  ceilY: number; // surface du plafond
}

const key = (r: number, c: number): number => r * 1000 + c;

export function browH(R: number): number {
  return R * SQRT3;
}

export function bcellCenter(layout: BubbleLayout, r: number, c: number): { x: number; y: number } {
  const odd = ((r % 2) + 2) % 2 === 1;
  return { x: layout.ox + c * 2 * layout.R + (odd ? layout.R : 0), y: layout.oy + r * browH(layout.R) };
}

export function bpixelToCell(layout: BubbleLayout, x: number, y: number): CellRef {
  const r = Math.round((y - layout.oy) / browH(layout.R));
  const odd = ((r % 2) + 2) % 2 === 1;
  const c = Math.round((x - layout.ox - (odd ? layout.R : 0)) / (2 * layout.R));
  return { r, c };
}

function inBounds(grid: number[][], r: number, c: number): boolean {
  return r >= 0 && r < grid.length && grid.length > 0 && c >= 0 && c < grid[0].length;
}

// Voisinage hexagonal odd-r (lignes impaires décalées à droite).
export function hexNeighbors(r: number, c: number, cols: number, rows: number): CellRef[] {
  const odd = ((r % 2) + 2) % 2 === 1;
  const deltas: ReadonlyArray<readonly [number, number]> = odd
    ? [[1, 0], [-1, 0], [1, -1], [0, -1], [1, 1], [0, 1]]
    : [[1, 0], [-1, 0], [0, -1], [-1, -1], [0, 1], [-1, 1]];
  const out: CellRef[] = [];
  for (const [dc, dr] of deltas) {
    const nr = r + dr;
    const nc = c + dc;
    if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) out.push({ r: nr, c: nc });
  }
  return out;
}

export function bemptyGrid(rows: number = BROWS, cols: number = BCOLS): number[][] {
  const grid: number[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: number[] = [];
    for (let c = 0; c < cols; c++) row.push(0);
    grid.push(row);
  }
  return grid;
}

// Groupe connexe de même couleur (les gris et le vide donnent ≤ 1 cellule).
export function floodGroup(grid: number[][], r: number, c: number): CellRef[] {
  if (!inBounds(grid, r, c)) return [];
  const v = grid[r][c];
  if (v <= 0 || v === BGARB) return [{ r, c }];
  const cols = grid[0].length;
  const rows = grid.length;
  const seen = new Set<number>([key(r, c)]);
  const stack: CellRef[] = [{ r, c }];
  while (stack.length) {
    const cur = stack.pop() as CellRef;
    for (const nb of hexNeighbors(cur.r, cur.c, cols, rows)) {
      const k = key(nb.r, nb.c);
      if (!seen.has(k) && grid[nb.r][nb.c] === v) {
        seen.add(k);
        stack.push(nb);
      }
    }
  }
  return Array.from(seen).map((k) => ({ r: Math.floor(k / 1000), c: k % 1000 }));
}

// Tous les groupes de 3+ (couleurs 1..5 uniquement).
export function findPopGroups(grid: number[][]): CellRef[][] {
  const rows = grid.length;
  if (!rows) return [];
  const cols = grid[0].length;
  const seen = new Set<number>();
  const groups: CellRef[][] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = grid[r][c];
      if (v <= 0 || v === BGARB || seen.has(key(r, c))) continue;
      const group = floodGroup(grid, r, c);
      for (const cell of group) seen.add(key(cell.r, cell.c));
      if (group.length >= 3) groups.push(group);
    }
  }
  return groups;
}

// Gris orthogonaux (hex) adjacents à une explosion : emportés avec elle.
export function adjacentGarbage(grid: number[][], popped: ReadonlySet<number> | CellRef[]): CellRef[] {
  const rows = grid.length;
  if (!rows) return [];
  const cols = grid[0].length;
  const pset = new Set<number>();
  if (Array.isArray(popped)) {
    for (const cell of popped) pset.add(key(cell.r, cell.c));
  } else {
    for (const k of popped) pset.add(k);
  }
  const out = new Map<number, CellRef>();
  const visit = (r: number, c: number): void => {
    for (const nb of hexNeighbors(r, c, cols, rows)) {
      const k = key(nb.r, nb.c);
      if (!pset.has(k) && grid[nb.r][nb.c] === BGARB && !out.has(k)) out.set(k, { r: nb.r, c: nb.c });
    }
  };
  if (Array.isArray(popped)) {
    for (const cell of popped) visit(cell.r, cell.c);
  } else {
    for (const k of popped) visit(Math.floor(k / 1000), k % 1000);
  }
  return Array.from(out.values());
}

// Cellules non reliées au plafond (ligne 0) : elles tombent.
export function findFloaters(grid: number[][]): CellRef[] {
  const rows = grid.length;
  if (!rows) return [];
  const cols = grid[0].length;
  const anchored = new Set<number>();
  const stack: CellRef[] = [];
  for (let c = 0; c < cols; c++) {
    if (grid[0][c] !== 0) {
      anchored.add(key(0, c));
      stack.push({ r: 0, c });
    }
  }
  while (stack.length) {
    const cur = stack.pop() as CellRef;
    for (const nb of hexNeighbors(cur.r, cur.c, cols, rows)) {
      const k = key(nb.r, nb.c);
      if (!anchored.has(k) && grid[nb.r][nb.c] !== 0) {
        anchored.add(k);
        stack.push(nb);
      }
    }
  }
  const out: CellRef[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] !== 0 && !anchored.has(key(r, c))) out.push({ r, c });
    }
  }
  return out;
}

export interface PopCell extends CellRef {
  v: number;
}

export interface ShotResult {
  popped: PopCell[];
  garbage: PopCell[];
  dropped: PopCell[];
}

// Résolution complète après un collage ou une poussée de plafond : pops,
// ordures voisines, puis chute des grappes décrochées. Modifie la grille.
export function resolveGrid(grid: number[][]): ShotResult {
  const groups = findPopGroups(grid);
  const seen = new Set<number>();
  const popped: PopCell[] = [];
  for (const group of groups) {
    for (const cell of group) {
      const k = key(cell.r, cell.c);
      if (!seen.has(k)) {
        seen.add(k);
        popped.push({ r: cell.r, c: cell.c, v: grid[cell.r][cell.c] });
      }
    }
  }
  const garbageRefs = adjacentGarbage(grid, seen);
  const garbage: PopCell[] = garbageRefs.map((cell) => ({ r: cell.r, c: cell.c, v: grid[cell.r][cell.c] }));
  for (const cell of popped) grid[cell.r][cell.c] = 0;
  for (const cell of garbage) grid[cell.r][cell.c] = 0;
  const dropRefs = findFloaters(grid);
  const dropped: PopCell[] = dropRefs.map((cell) => ({ r: cell.r, c: cell.c, v: grid[cell.r][cell.c] }));
  for (const cell of dropped) grid[cell.r][cell.c] = 0;
  return { popped, garbage, dropped };
}

// Insère une ligne au plafond, pousse tout vers le bas (le bas est perdu).
export function pushRow(grid: number[][], row: number[]): void {
  for (let r = grid.length - 1; r >= 1; r--) {
    for (let c = 0; c < grid[r].length; c++) grid[r][c] = grid[r - 1][c];
  }
  for (let c = 0; c < grid[0].length && c < row.length; c++) grid[0][c] = row[c];
}

export function crossesLine(grid: number[][], loseRow: number): boolean {
  for (let r = loseRow; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      if (grid[r][c] !== 0) return true;
    }
  }
  return false;
}

export function gridIsEmpty(grid: number[][]): boolean {
  for (const row of grid) {
    for (const v of row) if (v !== 0) return false;
  }
  return true;
}

export function distinctColors(grid: number[][]): number[] {
  const set = new Set<number>();
  for (const row of grid) {
    for (const v of row) if (v > 0 && v !== BGARB) set.add(v);
  }
  return Array.from(set).sort((a, b) => a - b);
}

export function colorCountForPopLevel(level: number): number {
  if (level >= 5) return 5;
  if (level >= 3) return 4;
  return 3;
}

export function patternRowsForLevel(level: number): number {
  return Math.min(6, 4 + Math.floor((Math.max(1, level) - 1) / 2));
}

export function randomRowColors(rng: RngLike, cols: number, colorCount: number, garbageP: number): number[] {
  const row: number[] = [];
  for (let c = 0; c < cols; c++) {
    row.push(rng.next() < garbageP ? BGARB : rng.int(1, Math.max(1, colorCount)));
  }
  return row;
}

// Motif initial sans aucun groupe pré-éclaté (situation de départ saine).
export function makePattern(rng: RngLike, rows: number, cols: number, colorCount: number): number[][] {
  const grid = bemptyGrid(BROWS, cols);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) grid[r][c] = rng.int(1, Math.max(1, colorCount));
  }
  for (let guard = 0; guard < 500; guard++) {
    const groups = findPopGroups(grid);
    if (!groups.length) break;
    const cell = groups[0][rng.int(0, groups[0].length - 1)];
    let v = rng.int(1, Math.max(1, colorCount));
    if (v === grid[cell.r][cell.c]) v = (v % Math.max(1, colorCount)) + 1;
    grid[cell.r][cell.c] = v;
  }
  return grid;
}

// La bulle chargée reprend toujours une couleur présente sur le plateau
// (jamais de tirage inutile) ; plateau vide → palette du niveau.
export function pickBubbleColor(rng: RngLike, grid: number[][], colorCount: number): number {
  const present = distinctColors(grid);
  const pool = present.length ? present : Array.from({ length: Math.max(1, colorCount) }, (_, i) => i + 1);
  return pool[rng.int(0, pool.length - 1)];
}

// Lignes d'ordures envoyées en versus : pops franches et grappes qui tombent.
export function attackForShots(popped: number, dropped: number): number {
  let rows = 0;
  if (popped >= 4) rows += 1;
  if (popped >= 7) rows += 1;
  rows += Math.floor(Math.max(0, dropped) / 3);
  return Math.min(2, rows);
}

export function scoreForShot(popped: number, dropped: number, garbage: number, level: number): number {
  let pts = popped * 10 + dropped * 20 + garbage * 5;
  if (popped >= 4) pts += (popped - 3) * 15;
  pts *= 1 + (Math.max(1, level) - 1) * 0.05;
  return Math.round(pts);
}

// Cellule vide la plus proche d'un point (collage de la bulle volante).
export function nearestEmptyCell(
  grid: number[][],
  layout: BubbleLayout,
  x: number,
  y: number,
): CellRef | null {
  let best: CellRef | null = null;
  let bestD = Infinity;
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      if (grid[r][c] !== 0) continue;
      const p = bcellCenter(layout, r, c);
      const d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
      if (d < bestD) {
        bestD = d;
        best = { r, c };
      }
    }
  }
  return best;
}

interface Debris {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: number;
  t: number;
  life: number;
}

export class PopBoard {
  readonly rows: number;
  readonly cols: number;
  grid: number[][];
  current = 1;
  next = 2;
  angle = 0;
  flying: { x: number; y: number; vx: number; vy: number; color: number } | null = null;
  snapAnim: { r: number; c: number; t: number } | null = null;
  debris: Debris[] = [];
  shots = 0;
  pendingRows: number[][] = [];
  pushT = 0;
  cd = 0;
  score = 0;
  level = 1;
  poppedTotal = 0;
  droppedTotal = 0;
  maxPop = 0;
  dead = false;
  flashT = 0;
  colorCount = 3;

  constructor(rows: number = BROWS, cols: number = BCOLS) {
    this.rows = rows;
    this.cols = cols;
    this.grid = bemptyGrid(rows, cols);
  }
}

interface FeedMsg {
  x: number;
  y: number;
  text: string;
  color: string;
  t: number;
}

export class BubbleGame extends BaseGame {
  static meta: GameMeta = {
    id: 'bubble',
    name: 'BLOB POP',
    accent: '#e879f9',
    mood: 'cave',
    desc: 'Vise, tire, éclate les grappes',
    controls: '← → viser · A tirer · B échanger',
    keys: 'Flèches / ZQSD viser · Espace tirer · K échanger',
    hint: 'Colle 3+ bulles de même couleur · les grappes décrochées tombent · ne touche pas la limite',
    unit: 'pts',
    ranks: [12000, 7000, 4000, 1800, 0],
    players: { min: 1, max: 2 },
  };

  readonly versus: boolean;
  readonly boards: PopBoard[] = [];
  readonly mascots: Blob[] = [];
  readonly dots: Array<{ x: number; y: number; z: number; s: number }> = [];
  feed: FeedMsg[] = [];
  centerMsg = '';
  centerMsgT = 0;
  winner = -1;
  comboStep = 0;
  dropEvery = 6;

  constructor(engine: EngineLike, session?: GameSession) {
    super(engine, session);
    this.versus = this.session.mode === 'local' && this.session.playerCount > 1;
    const count = this.versus ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const board = new PopBoard(BROWS, BCOLS);
      board.colorCount = colorCountForPopLevel(1);
      board.grid = makePattern(this.rng, patternRowsForLevel(1), BCOLS, board.colorCount);
      board.current = pickBubbleColor(this.rng, board.grid, board.colorCount);
      board.next = pickBubbleColor(this.rng, board.grid, board.colorCount);
      this.boards.push(board);
      this.mascots.push(new Blob({ x: 0, y: 0, r: 30, color: i === 0 ? '#7dd3fc' : '#f472b6', trailOn: false }));
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

  layoutOf(index: number): BubbleLayout {
    if (!this.versus) {
      const R = 24;
      const cols = BCOLS;
      const rows = BROWS;
      const ox = 640 - (cols * 2 * R) / 2 + R;
      const oy = 118;
      const rh = browH(R);
      return {
        ox, oy, R, cols, rows,
        lx: ox - R,
        rx: ox + (cols - 1) * 2 * R + R,
        cx: ox + (cols - 1) * R,
        shooterY: 650,
        lineY: oy + (LOSE_ROW - 0.5) * rh,
        ceilY: oy - rh / 2,
      };
    }
    const R = 18;
    const cols = BCOLS;
    const rows = BROWS;
    const w = cols * 2 * R;
    const gap = 130;
    const x0 = (1280 - (w * 2 + gap)) / 2 + index * (w + gap);
    const ox = x0 + R;
    const oy = 170;
    const rh = browH(R);
    return {
      ox, oy, R, cols, rows,
      lx: x0,
      rx: x0 + w,
      cx: ox + (cols - 1) * R,
      shooterY: 592,
      lineY: oy + (LOSE_ROW - 0.5) * rh,
      ceilY: oy - rh / 2,
    };
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
    for (const msg of this.feed) msg.t -= dt;
    this.feed = this.feed.filter((msg) => msg.t > 0);

    for (let i = 0; i < this.boards.length; i++) {
      const board = this.boards[i];
      board.flashT = Math.max(0, board.flashT - dt);
      if (board.snapAnim) {
        board.snapAnim.t -= dt;
        if (board.snapAnim.t <= 0) board.snapAnim = null;
      }
      this.updateDebris(board, dt);
      if (!board.dead) this.updateBoard(board, this.players[i], this.layoutOf(i), dt, i);
      const mascot = this.mascots[i];
      const layout = this.layoutOf(i);
      mascot.x = layout.cx;
      mascot.y = layout.shooterY;
      mascot.vx = Math.sin(board.angle) * 220;
      mascot.vy = -Math.cos(board.angle) * 220;
      const h = this.topRow(board);
      if (board.dead) mascot.dead = true;
      else if (h >= LOSE_ROW - 3) mascot.setEmotion('scared');
      else if (mascot.resolvedEmotion() === 'scared') mascot.setEmotion('idle');
      mascot.update(dt);
    }

    const p2 = this.versus ? this.boards[1] : null;
    this.score = this.versus ? Math.max(this.boards[0].score, p2?.score ?? 0) : this.boards[0].score;
    this.comboStep = Math.max(this.boards[0].maxPop, p2?.maxPop ?? 0);

    if (this.state === 'play') {
      if (!this.versus && this.boards[0].dead) {
        this.winner = 0;
        this.over(false);
      } else if (this.versus && (this.boards[0].dead || (p2?.dead ?? false))) {
        const b0 = this.boards[0];
        const b1 = p2 as PopBoard;
        this.winner = b0.dead && b1.dead ? (b0.score >= b1.score ? 0 : 1) : b0.dead ? 1 : 0;
        this.score = this.boards[this.winner].score;
        this.over(this.winner === 0);
      }
    }
  }

  private topRow(board: PopBoard): number {
    for (let r = board.rows - 1; r >= 0; r--) {
      for (let c = 0; c < board.cols; c++) {
        if (board.grid[r][c] !== 0) return r;
      }
    }
    return -1;
  }

  private updateDebris(board: PopBoard, dt: number): void {
    for (const d of board.debris) {
      d.t -= dt;
      d.vy += 950 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
    }
    board.debris = board.debris.filter((d) => d.t > 0);
  }

  private updateBoard(
    board: PopBoard,
    input: PlayerInputLike | undefined,
    layout: BubbleLayout,
    dt: number,
    index: number,
  ): void {
    board.cd = Math.max(0, board.cd - dt);
    // Lignes en attente (plafond solo / attaques versus) : une par une.
    if (!board.flying && board.pendingRows.length) {
      board.pushT += dt;
      if (board.pushT >= 0.4) {
        board.pushT = 0;
        const row = board.pendingRows.shift() as number[];
        pushRow(board.grid, row);
        board.flashT = 0.5;
        this.audio.land();
        this.settle(board, index, false);
        if (board.dead) return;
      }
    }
    if (board.flying) {
      this.updateFlying(board, layout, dt, index);
      return;
    }
    if (!input) return;
    // Visée continue.
    let dir = 0;
    if (input.moveX < -0.5 || input.down('left')) dir = -1;
    else if (input.moveX > 0.5 || input.down('right')) dir = 1;
    if (dir !== 0) {
      board.angle = Math.max(-1.22, Math.min(1.22, board.angle + dir * 1.9 * dt));
    }
    if (input.pressed('b') || input.pressed('y')) {
      const tmp = board.current;
      board.current = board.next;
      board.next = tmp;
      this.audio.land();
    }
    if ((input.pressed('a') || input.pressed('x')) && board.cd <= 0) {
      const spd = layout.R * 32;
      board.flying = {
        x: layout.cx,
        y: layout.shooterY - layout.R - 8,
        vx: Math.sin(board.angle) * spd,
        vy: -Math.cos(board.angle) * spd,
        color: board.current,
      };
      board.cd = 0.3;
      this.audio.shoot();
      this.input.player(index).rumble(0.1, 0.04);
    }
  }

  private overlapsGrid(board: PopBoard, layout: BubbleLayout, x: number, y: number): boolean {
    const rr = 2 * layout.R - 2;
    for (let r = 0; r < board.rows; r++) {
      for (let c = 0; c < board.cols; c++) {
        if (board.grid[r][c] === 0) continue;
        const p = bcellCenter(layout, r, c);
        const dx = p.x - x;
        const dy = p.y - y;
        if (dx * dx + dy * dy < rr * rr) return true;
      }
    }
    return false;
  }

  private updateFlying(board: PopBoard, layout: BubbleLayout, dt: number, index: number): void {
    const f = board.flying;
    if (!f) return;
    const spd = Math.hypot(f.vx, f.vy) || 1;
    const stepLen = layout.R * 0.45;
    let dist = spd * dt;
    let guard = 0;
    while (dist > 0 && guard++ < 12) {
      const d = Math.min(stepLen, dist);
      dist -= d;
      f.x += (f.vx / spd) * d;
      f.y += (f.vy / spd) * d;
      if (f.x - layout.R < layout.lx) {
        f.x = layout.lx + layout.R;
        f.vx = Math.abs(f.vx);
      } else if (f.x + layout.R > layout.rx) {
        f.x = layout.rx - layout.R;
        f.vx = -Math.abs(f.vx);
      }
      if (f.y <= layout.oy || this.overlapsGrid(board, layout, f.x, f.y)) {
        this.snap(board, index, f.x, f.y, f.color);
        return;
      }
      if (f.y > layout.shooterY + 30) {
        // Filet de sécurité : ne jamais perdre la bulle sous le canon.
        this.snap(board, index, f.x, layout.shooterY - layout.R * 2, f.color);
        return;
      }
    }
  }

  private snap(board: PopBoard, index: number, x: number, y: number, color: number): void {
    const layout = this.layoutOf(index);
    board.flying = null;
    const cell = nearestEmptyCell(board.grid, layout, x, y);
    if (!cell) {
      board.dead = true;
      return;
    }
    board.grid[cell.r][cell.c] = color;
    board.snapAnim = { r: cell.r, c: cell.c, t: 0.18 };
    board.shots++;
    this.audio.land();
    const p = bcellCenter(layout, cell.r, cell.c);
    this.fx.burst(p.x, p.y, { n: 5, speed: [40, 150], colors: [this.accent, '#ffffff'], size: [1.5, 3], life: 0.3 });
    // Solo : le plafond descend régulièrement.
    if (!this.versus && board.shots % this.dropEvery === 0) {
      board.pendingRows.push(randomRowColors(this.rng, board.cols, board.colorCount, board.level >= 3 ? 0.08 : 0));
      this.say(index, 'LE PLAFOND DESCEND !', '#94a3b8');
    }
    this.settle(board, index, true);
    if (!board.dead) {
      board.current = board.next;
      board.next = pickBubbleColor(this.rng, board.grid, board.colorCount);
    }
  }

  private settle(board: PopBoard, index: number, attack: boolean): void {
    const layout = this.layoutOf(index);
    const { popped, garbage, dropped } = resolveGrid(board.grid);
    const totalPop = popped.length + garbage.length;
    if (totalPop > 0) {
      board.poppedTotal += totalPop;
      board.maxPop = Math.max(board.maxPop, popped.length);
      const pts = scoreForShot(popped.length, 0, garbage.length, board.level);
      board.score += pts;
      // Effets : gerbes groupées au-delà de 24 pour garder le budget particules.
      if (totalPop <= 24) {
        for (const cell of popped) {
          const p = bcellCenter(layout, cell.r, cell.c);
          this.fx.burst(p.x, p.y, {
            n: 8,
            speed: [60, 260],
            colors: [BPALETTE[cell.v] || '#ffffff', '#ffffff'],
            size: [2, 4.5],
            life: 0.5,
          });
        }
        for (const cell of garbage) {
          const p = bcellCenter(layout, cell.r, cell.c);
          this.fx.burst(p.x, p.y, { n: 6, speed: [50, 200], colors: [BGARB_COLOR, '#ffffff'], size: [1.5, 3.5], life: 0.4 });
        }
      } else {
        let sx = 0;
        let sy = 0;
        for (const cell of popped) {
          const p = bcellCenter(layout, cell.r, cell.c);
          sx += p.x;
          sy += p.y;
        }
        this.fx.burst(sx / popped.length, sy / popped.length, {
          n: 46, speed: [90, 380], colors: [this.accent, '#ffffff', '#fde047'], size: [2, 5], life: 0.6,
        });
      }
      let sx = 0;
      let sy = 0;
      for (const cell of popped) {
        const p = bcellCenter(layout, cell.r, cell.c);
        sx += p.x;
        sy += p.y;
      }
      const ax = sx / Math.max(1, popped.length);
      const ay = sy / Math.max(1, popped.length);
      this.fx.ring(ax, ay, { r0: 12, r1: 40 + popped.length * 6, color: popped.length >= 4 ? '#fde047' : this.accent, life: 0.35 });
      this.fx.text(ax, ay - 24, '+' + pts, {
        color: popped.length >= 4 ? '#fde047' : '#eaf6ff',
        size: popped.length >= 4 ? 26 : 19,
        mono: true,
      });
      this.audio.coin(Math.min(24, 3 + popped.length));
      this.musicEvent('combo', Math.min(1.4, 0.4 + popped.length * 0.06));
      if (popped.length >= 5) {
        this.audio.perfect();
        this.fx.shake(0.12);
      } else {
        this.fx.shake(0.05);
      }
      this.mascots[index].punch(0.3);
      this.mascots[index].setEmotion('happy', 1.1);
      if (popped.length >= 4) this.say(index, '+' + popped.length + ' !');
      if (attack && this.versus) this.sendAttack(index, attackForShots(popped.length, 0));
    }
    if (dropped.length) {
      board.droppedTotal += dropped.length;
      const pts = scoreForShot(0, dropped.length, 0, board.level);
      board.score += pts;
      for (const cell of dropped) {
        const p = bcellCenter(layout, cell.r, cell.c);
        board.debris.push({
          x: p.x,
          y: p.y,
          vx: (this.rng.next() - 0.5) * 160,
          vy: -60 - this.rng.next() * 80,
          color: cell.v,
          t: 0.85,
          life: 0.85,
        });
        this.fx.burst(p.x, p.y, { n: 4, speed: [40, 160], colors: ['#ffffff', this.accent], size: [1.5, 3], life: 0.35 });
      }
      const first = bcellCenter(layout, dropped[0].r, dropped[0].c);
      this.fx.text(first.x, first.y - 20, '+' + pts + ' CHUTE', { color: '#a3e635', size: 19, mono: true });
      if (dropped.length >= 3) {
        this.audio.perfect();
        this.fx.shake(0.1);
        this.say(index, 'GRAPPE +' + dropped.length + ' !', '#a3e635');
      } else {
        this.audio.good();
      }
      if (attack && this.versus) this.sendAttack(index, attackForShots(0, dropped.length));
    }
    if (!board.dead && gridIsEmpty(board.grid)) this.levelClear(board, index);
    if (!board.dead && crossesLine(board.grid, LOSE_ROW)) {
      board.dead = true;
      this.audio.explode(1.2);
      this.fx.shake(0.7);
    }
  }

  private sendAttack(from: number, rows: number): void {
    if (rows <= 0) return;
    const foeIndex = from === 0 ? 1 : 0;
    const foe = this.boards[foeIndex];
    if (!foe || foe.dead) return;
    for (let i = 0; i < rows; i++) {
      foe.pendingRows.push(randomRowColors(this.rng, foe.cols, foe.colorCount, 0.25));
    }
    foe.flashT = 0.6;
    this.audio.hitEnemy();
    this.input.player(foeIndex).rumble(0.25, 0.08);
    this.say(foeIndex, '+' + rows + ' LIGNE' + (rows > 1 ? 'S' : '') + ' GRISE !', '#94a3b8');
  }

  private levelClear(board: PopBoard, index: number): void {
    const bonus = 200 + 100 * board.level;
    board.score += bonus;
    board.level++;
    board.colorCount = colorCountForPopLevel(board.level);
    board.grid = makePattern(this.rng, patternRowsForLevel(board.level), board.cols, board.colorCount);
    board.shots = 0;
    board.pendingRows = [];
    board.current = pickBubbleColor(this.rng, board.grid, board.colorCount);
    board.next = pickBubbleColor(this.rng, board.grid, board.colorCount);
    this.audio.milestone();
    this.musicEvent('waveComplete', 0.9);
    this.fx.flash(this.accent, 0.18);
    const layout = this.layoutOf(index);
    this.fx.text(layout.cx, layout.oy + 120, 'NIVEAU ' + board.level + ' · +' + bonus, {
      color: this.accent,
      size: 30,
    });
    this.mascots[index].setEmotion('happy', 2);
    if (this.versus) this.sendAttack(index, 1);
  }

  private say(boardIndex: number, text: string, color: string = '#fde047'): void {
    const layout = this.layoutOf(boardIndex);
    this.feed.push({ x: layout.cx, y: layout.oy - 30, text, color, t: 1.4 });
    if (this.versus) {
      this.centerMsg = text;
      this.centerMsgT = 1.2;
    }
  }

  // ---------- rendu ----------
  render(ctx: CanvasRenderingContext2D): void {
    const bg = ctx.createLinearGradient(0, 0, 0, 720);
    bg.addColorStop(0, '#160f22');
    bg.addColorStop(0.55, '#070910');
    bg.addColorStop(1, '#05060b');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 1280, 720);
    this.fx.world(ctx);
    UI.grid(ctx, { gap: 64, off: this.time * 7, alpha: 0.05, color: '#e879f9' });
    for (const dot of this.dots) {
      ctx.globalAlpha = 0.05 + dot.z * 0.09;
      ctx.fillStyle = '#e879f9';
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, 1.1 + dot.z * 1.7, 0, 6.2832);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (this.versus) {
      UI.txt(ctx, 'VS', 640, 330, { size: 54, align: 'center', color: '#eaf6ff', weight: 900, shadow: true });
      if (this.centerMsgT > 0) {
        ctx.globalAlpha = Math.min(1, this.centerMsgT * 2);
        UI.txt(ctx, this.centerMsg, 640, 372, { size: 19, align: 'center', color: '#fde047', weight: 900, shadow: true });
        ctx.globalAlpha = 1;
      }
    } else {
      this.renderSoloSide(ctx);
    }
    for (let i = 0; i < this.boards.length; i++) this.renderBoard(ctx, i);
    for (let i = 0; i < this.boards.length; i++) {
      const layout = this.layoutOf(i);
      if (!this.versus) {
        this.mascots[i].x = layout.cx;
        this.mascots[i].y = layout.shooterY;
      } else {
        this.mascots[i].x = layout.cx;
        this.mascots[i].y = layout.shooterY;
      }
      this.mascots[i].render(ctx);
    }

    for (const msg of this.feed) {
      const k = Math.min(1, msg.t / 0.5);
      ctx.globalAlpha = Math.min(1, k * 2);
      UI.txt(ctx, msg.text, msg.x, msg.y - (1.4 - msg.t) * 26, {
        size: 21, align: 'center', color: msg.color, weight: 900, shadow: true,
      });
      ctx.globalAlpha = 1;
    }

    this.fx.drawWorld(ctx);
    this.fx.endWorld(ctx);

    if (this.versus) this.renderVersusHud(ctx);
    else {
      const board = this.boards[0];
      UI.drawHUD(ctx, {
        accent: this.accent,
        score: board.score,
        unit: this.meta.unit,
        time: this.time,
        extra: () => {
          UI.txt(ctx, 'NIVEAU ' + board.level, 28, 96, { size: 13, mono: true, color: this.accent });
          const left = this.dropEvery - (board.shots % this.dropEvery);
          UI.txt(ctx, 'PLAFOND −' + left + ' TIRS', 28, 114, { size: 12, mono: true, color: '#7c8698' });
          if (board.droppedTotal > 0) UI.txt(ctx, 'CHUTES ' + board.droppedTotal, 28, 132, { size: 12, mono: true, color: '#a3e635' });
          if (board.pendingRows.length > 0) {
            UI.txt(ctx, '+' + board.pendingRows.length + ' LIGNES', 28, 150, { size: 12, mono: true, color: '#94a3b8' });
          }
        },
      });
      const best = UI.getBest(this.bestKey || this.meta.id);
      if (best > 0) UI.txt(ctx, 'RECORD ' + UI.fmt(best), 1252, 96, { size: 12, align: 'right', mono: true, color: '#5d6480' });
    }
    if (this.state === 'over' && this.versus && this.winner >= 0) {
      UI.txt(ctx, this.winner === 0 ? 'JOUEUR 1 GAGNE !' : 'JOUEUR 2 GAGNE !', 640, 120, {
        size: 30, align: 'center', color: this.winner === 0 ? '#7dd3fc' : '#f472b6', weight: 900, shadow: true,
      });
      UI.txt(ctx, this.boards[0].score + ' — ' + this.boards[1].score, 640, 146, {
        size: 16, align: 'center', mono: true, color: '#aeb8c8',
      });
    }
    this.drawCommon(ctx);
  }

  private renderSoloSide(ctx: CanvasRenderingContext2D): void {
    const layout = this.layoutOf(0);
    const px = layout.lx - 150;
    UI.panel(ctx, px - 95, 200, 190, 190, { radius: 16, fill: 'rgba(9,12,19,0.9)', stroke: this.accent + '44' });
    UI.txt(ctx, 'SUIVANTE', px, 228, { size: 12, align: 'center', mono: true, color: this.accent });
    this.drawBubble(ctx, px, 282, layout.R * 0.85, this.boards[0].next, 0);
    UI.txt(ctx, 'B = ÉCHANGER', px, 348, { size: 11, align: 'center', mono: true, color: '#5d6480' });
    UI.panel(ctx, px - 95, 404, 190, 132, { radius: 16, fill: 'rgba(9,12,19,0.82)', stroke: 'rgba(255,255,255,0.08)' });
    UI.txt(ctx, '← → viser', px, 434, { size: 12, align: 'center', color: '#aeb8c8' });
    UI.txt(ctx, 'ESPACE tirer', px, 456, { size: 12, align: 'center', color: '#aeb8c8' });
    UI.txt(ctx, 'murs = rebond', px, 478, { size: 11, align: 'center', mono: true, color: '#5d6480' });
    UI.txt(ctx, 'K échanger', px, 500, { size: 11, align: 'center', mono: true, color: '#5d6480' });
  }

  private renderVersusHud(ctx: CanvasRenderingContext2D): void {
    const labels = ['P1 · CLAVIER / PAD', 'P2 · MANETTE'];
    const colors = ['#7dd3fc', '#f472b6'];
    for (let i = 0; i < 2; i++) {
      const layout = this.layoutOf(i);
      const board = this.boards[i];
      UI.txt(ctx, labels[i], layout.cx, layout.oy - 84, {
        size: 12, align: 'center', mono: true, color: colors[i], weight: 900,
      });
      UI.txt(ctx, UI.fmt(board.score), layout.cx, layout.oy - 54, {
        size: 28, align: 'center', mono: true, color: '#eaf6ff', weight: 700, shadow: true,
      });
      UI.txt(ctx, 'NIV ' + board.level + ' · CHUTES ' + board.droppedTotal, layout.cx, layout.shooterY + 62, {
        size: 12, align: 'center', mono: true, color: '#7c8698',
      });
      if (board.pendingRows.length > 0) {
        UI.txt(ctx, '+' + board.pendingRows.length + ' LIGNES EN ROUTE', layout.cx, layout.shooterY + 82, {
          size: 12, align: 'center', mono: true, color: '#94a3b8', weight: 900,
        });
      }
    }
  }

  private renderBoard(ctx: CanvasRenderingContext2D, index: number): void {
    const board = this.boards[index];
    const layout = this.layoutOf(index);
    const frame = this.versus ? (index === 0 ? '#7dd3fc' : '#f472b6') : this.accent;
    const top = this.topRow(board);
    const danger = !board.dead && top >= LOSE_ROW - 3;

    // Cadre + plafond.
    ctx.save();
    ctx.shadowColor = danger && Math.sin(this.time * 8) > 0 ? '#ff5470' : frame;
    ctx.shadowBlur = 14;
    const topY = layout.ceilY - 14;
    const botY = layout.shooterY + 44;
    UI.panel(ctx, layout.lx - 10, topY, layout.rx - layout.lx + 20, botY - topY, {
      radius: 14, fill: 'rgba(5,7,13,0.92)', stroke: danger ? '#ff5470' : frame + '66', lineWidth: 2,
    });
    ctx.restore();
    // Barre du plafond.
    const grad = ctx.createLinearGradient(layout.lx, 0, layout.rx, 0);
    grad.addColorStop(0, '#3b4256');
    grad.addColorStop(0.5, '#7c8698');
    grad.addColorStop(1, '#3b4256');
    ctx.fillStyle = grad;
    ctx.fillRect(layout.lx - 4, layout.ceilY - 12, layout.rx - layout.lx + 8, 10);
    // Ligne de mort.
    ctx.save();
    ctx.strokeStyle = danger ? '#ff547088' : 'rgba(148,163,184,0.3)';
    ctx.setLineDash([7, 7]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(layout.lx, layout.lineY);
    ctx.lineTo(layout.rx, layout.lineY);
    ctx.stroke();
    ctx.restore();
    UI.txt(ctx, 'LIMITE', layout.rx - 6, layout.lineY - 6, {
      size: 10, align: 'right', mono: true, color: danger ? '#ff5470' : '#5d6480',
    });

    if (board.flashT > 0) {
      ctx.globalAlpha = Math.min(0.3, board.flashT * 0.5);
      ctx.fillStyle = '#64748b';
      ctx.fillRect(layout.lx, layout.ceilY, layout.rx - layout.lx, layout.shooterY - layout.ceilY);
      ctx.globalAlpha = 1;
    }

    const snapping = new Set<number>();
    if (board.snapAnim) snapping.add(key(board.snapAnim.r, board.snapAnim.c));
    const snapK = board.snapAnim ? Math.max(0, board.snapAnim.t / 0.18) : 0;

    // Ponts gooey hexagonaux entre voisines de même couleur.
    ctx.save();
    ctx.lineCap = 'round';
    for (let r = 0; r < board.rows; r++) {
      for (let c = 0; c < board.cols; c++) {
        const v = board.grid[r][c];
        if (v <= 0 || v === BGARB) continue;
        for (const nb of hexNeighbors(r, c, board.cols, board.rows)) {
          if (nb.r < r || (nb.r === r && nb.c <= c)) continue; // anti-doublons
          if (board.grid[nb.r][nb.c] !== v) continue;
          const p1 = bcellCenter(layout, r, c);
          const p2 = bcellCenter(layout, nb.r, nb.c);
          ctx.strokeStyle = shade(BPALETTE[v] || '#ffffff', 0.72);
          ctx.lineWidth = Math.max(2, (layout.R - 2) * 1.0);
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
        }
      }
    }
    ctx.restore();

    // Bulles collées.
    for (let r = 0; r < board.rows; r++) {
      for (let c = 0; c < board.cols; c++) {
        const v = board.grid[r][c];
        if (v === 0) continue;
        const p = bcellCenter(layout, r, c);
        const pop = snapping.has(key(r, c)) ? 1 + (1 - snapK) * 0.4 : 1;
        this.drawBubble(ctx, p.x, p.y, (layout.R - 2) * pop, v, 0);
      }
    }

    // Débris qui tombent (grappes décrochées).
    for (const d of board.debris) {
      ctx.globalAlpha = Math.max(0, Math.min(1, d.t / d.life));
      this.drawBubble(ctx, d.x, d.y, layout.R - 3, d.color, 0);
      ctx.globalAlpha = 1;
    }

    // Guide de visée + bulle volante + bulle chargée.
    if (!board.dead && !board.flying) this.renderGuide(ctx, board, layout);
    if (board.flying) {
      const f = board.flying;
      ctx.globalAlpha = 0.9;
      this.drawBubble(ctx, f.x, f.y, layout.R - 2, f.color, 0);
      ctx.globalAlpha = 1;
    }
    if (!board.dead) {
      this.drawBubble(ctx, layout.cx, layout.shooterY - layout.R - 8, layout.R - 2, board.current, 0);
      // Suivante compacte.
      this.drawBubble(ctx, layout.cx + layout.R * 2.1, layout.shooterY - 4, layout.R * 0.55, board.next, 0);
    }

    if (board.dead) {
      ctx.fillStyle = 'rgba(5,7,13,0.55)';
      ctx.fillRect(layout.lx, layout.ceilY, layout.rx - layout.lx, layout.shooterY - layout.ceilY);
      UI.txt(ctx, 'LIMITE ATTEINTE', layout.cx, (layout.ceilY + layout.shooterY) / 2, {
        size: 24, align: 'center', color: '#ff5470', weight: 900, shadow: true,
      });
    }
  }

  private renderGuide(ctx: CanvasRenderingContext2D, board: PopBoard, layout: BubbleLayout): void {
    let x = layout.cx;
    let y = layout.shooterY - layout.R - 8;
    let dx = Math.sin(board.angle);
    let dy = -Math.cos(board.angle);
    ctx.save();
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 16; i++) {
      x += dx * 26;
      y += dy * 26;
      if (x - layout.R < layout.lx || x + layout.R > layout.rx) {
        dx = -dx;
        x = Math.max(layout.lx + layout.R, Math.min(layout.rx - layout.R, x));
      }
      if (y <= layout.oy || this.overlapsGrid(board, layout, x, y)) break;
      ctx.globalAlpha = 0.55 * (1 - i / 16);
      ctx.beginPath();
      ctx.arc(x, y, 2.4, 0, 6.2832);
      ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  private drawBubble(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    r: number,
    v: number,
    flash: number,
  ): void {
    if (r <= 0.5 || v < 0) return;
    const base = v === BGARB ? BGARB_COLOR : BPALETTE[v] || '#ffffff';
    const rr = Math.max(3, r);
    const g = ctx.createRadialGradient(x - rr * 0.3, y - rr * 0.35, rr * 0.1, x, y, rr);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.25, base);
    g.addColorStop(1, shade(base, 0.55));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, 6.2832);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath();
    ctx.ellipse(x - rr * 0.3, y - rr * 0.38, rr * 0.28, rr * 0.17, -0.5, 0, 6.2832);
    ctx.fill();
    if (flash > 0) {
      ctx.globalAlpha = Math.min(1, flash);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x, y, rr * 0.7, 0, 6.2832);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (v === BGARB) {
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
      return;
    }
    const ex = rr * 0.26;
    const ey = -rr * 0.08;
    ctx.fillStyle = '#f4fbff';
    ctx.beginPath();
    ctx.ellipse(x - ex, y + ey, rr * 0.2, rr * 0.24, 0, 0, 6.2832);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x + ex, y + ey, rr * 0.2, rr * 0.24, 0, 0, 6.2832);
    ctx.fill();
    ctx.fillStyle = '#0b0e14';
    ctx.beginPath();
    ctx.arc(x - ex, y + ey + rr * 0.05, rr * 0.1, 0, 6.2832);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + ex, y + ey + rr * 0.05, rr * 0.1, 0, 6.2832);
    ctx.fill();
    ctx.strokeStyle = '#0b0e14';
    ctx.lineWidth = Math.max(1, rr * 0.07);
    ctx.beginPath();
    ctx.moveTo(x - rr * 0.18, y + rr * 0.32);
    ctx.quadraticCurveTo(x, y + rr * 0.42, x + rr * 0.18, y + rr * 0.32);
    ctx.stroke();
  }

  debugSnapshot(): Record<string, string | number | boolean | null> {
    return {
      game: 'bubble',
      state: this.state,
      versus: this.versus,
      p1score: this.boards[0].score,
      p2score: this.versus ? this.boards[1].score : 0,
      p1level: this.boards[0].level,
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
