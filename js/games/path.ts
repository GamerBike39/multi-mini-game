// BLOB TRACE — mémorise un chemin orthogonal, puis guide le blob sans quitter
// la trace. La grille grandit à chaque manche et la caméra recule avec elle.

import { BaseGame } from '../core/game';
import { Blob } from '../core/blob';
import * as UI from '../core/ui';
import type { EngineLike, GameMeta, InputLike, Rng } from '../core/types';

const TAU = Math.PI * 2;
const PREVIEW_TIME = 30;
const MAX_LIVES = 3;
const LAST_ROUND = 6;

export interface PathCell { x: number; y: number }
export type PathDirection = 'up' | 'down' | 'left' | 'right';
export type PathVisualMode = 'line' | 'tiles';

export function nextPathVisualMode(mode: PathVisualMode): PathVisualMode {
  return mode === 'line' ? 'tiles' : 'line';
}

interface PathParticle {
  progress: number;
  speed: number;
  size: number;
  alpha: number;
}

interface MoveAnimation {
  from: PathCell;
  to: PathCell;
  t: number;
}

interface Candidate {
  path: PathCell[];
  score: number;
}

const DELTAS: Readonly<Record<PathDirection, PathCell>> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export function pathDirectionPressed(input: Pick<InputLike, 'pressed'>): PathDirection | null {
  const order: readonly PathDirection[] = ['up', 'left', 'right', 'down'];
  for (const direction of order) if (input.pressed(direction)) return direction;
  return null;
}

export function isOrthogonalPath(path: readonly PathCell[]): boolean {
  if (path.length < 2) return false;
  const seen = new Set<string>();
  for (let i = 0; i < path.length; i++) {
    const key = `${path[i].x},${path[i].y}`;
    if (seen.has(key)) return false;
    seen.add(key);
    if (i > 0 && Math.abs(path[i].x - path[i - 1].x) + Math.abs(path[i].y - path[i - 1].y) !== 1) return false;
  }
  return true;
}

function shuffle<T>(items: T[], rng: Pick<Rng, 'int'>): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function onePath(size: number, rng: Pick<Rng, 'int'>): PathCell[] {
  const start = { x: 0, y: size - 1 };
  const end = { x: size - 1, y: 0 };
  const visited = new Set<string>(['0,' + (size - 1)]);
  const path: PathCell[] = [start];

  const visit = (cell: PathCell): boolean => {
    if (cell.x === end.x && cell.y === end.y) return true;
    // Le DFS aléatoire produit aussi bien des raccourcis que des détours. Plusieurs
    // candidats sont ensuite comparés à la longueur recherchée pour la manche.
    const directions = shuffle<PathCell>(Object.values(DELTAS).map((d) => ({ ...d })), rng);
    for (const delta of directions) {
      const next = { x: cell.x + delta.x, y: cell.y + delta.y };
      const key = `${next.x},${next.y}`;
      if (next.x < 0 || next.y < 0 || next.x >= size || next.y >= size || visited.has(key)) continue;
      visited.add(key);
      path.push(next);
      if (visit(next)) return true;
      path.pop();
    }
    return false;
  };
  visit(start);
  return path;
}

export function createMemoryPath(size: number, complexity: number, rng: Pick<Rng, 'int'>): PathCell[] {
  const safeSize = Math.max(3, Math.floor(size));
  const minimum = safeSize * 2 - 1;
  const target = Math.min(safeSize * safeSize - 2, minimum + Math.max(0, complexity) * 3);
  let best: Candidate | null = null;
  for (let i = 0; i < 48; i++) {
    const path = onePath(safeSize, rng);
    if (!isOrthogonalPath(path)) continue;
    const turns = path.slice(2).reduce((count, cell, index) => {
      const a = path[index];
      const b = path[index + 1];
      return count + (cell.x - b.x !== b.x - a.x || cell.y - b.y !== b.y - a.y ? 1 : 0);
    }, 0);
    const score = Math.abs(path.length - target) - turns * 0.035;
    if (!best || score < best.score) best = { path, score };
  }
  return best?.path ?? onePath(safeSize, rng);
}

function sameCell(a: PathCell, b: PathCell): boolean {
  return a.x === b.x && a.y === b.y;
}

function ease(t: number): number {
  return 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);
}

export class PathGame extends BaseGame {
  static meta: GameMeta = {
    id: 'path',
    name: 'BLOB TRACE',
    accent: '#a78bfa',
    mood: 'simon',
    desc: 'Mémorise la trace. Ne quitte jamais la lumière.',
    controls: 'Directions avancer · A partir · X affichage',
    keys: 'Flèches / ZQSD · Espace · L affichage',
    hint: 'A / Espace partir · X / L alterne TRACE difficile et CASES confort',
    unit: 'pts',
    ranks: [9000, 7000, 4800, 2400, 0],
  };

  round = 1;
  gridSize = 4;
  path: PathCell[] = [];
  pathIndex = 0;
  lives = MAX_LIVES;
  phase: 'preview' | 'play' | 'roundComplete' = 'preview';
  previewT = PREVIEW_TIME;
  revealT = 0;
  transitionT = 0;
  retry = false;
  move: MoveAnimation | null = null;
  cameraZoom = 1;
  cameraTarget = 1;
  particles: PathParticle[] = [];
  attempts = 0;
  visualMode: PathVisualMode = 'line';

  constructor(engine: EngineLike) {
    super(engine);
    this.blob.r = 27;
    this.blob.trailOn = true;
    this.startRound(false);
    for (let i = 0; i < 9; i++) {
      this.particles.push({ progress: i / 9, speed: this.rng.float(0.08, 0.16), size: this.rng.float(2, 4.5), alpha: this.rng.float(0.45, 0.9) });
    }
  }

  private startRound(isRetry: boolean): void {
    this.gridSize = 3 + this.round;
    if (!isRetry) this.path = createMemoryPath(this.gridSize, this.round, this.rng);
    this.pathIndex = 0;
    this.phase = 'preview';
    this.previewT = PREVIEW_TIME;
    this.revealT = 0;
    this.retry = isRetry;
    this.move = null;
    this.cameraTarget = Math.max(0.57, 1 - (this.round - 1) * 0.078);
    const start = this.cellCenter(this.path[0]);
    this.blob.x = start.x;
    this.blob.y = start.y;
    this.blob.vx = 0;
    this.blob.vy = 0;
    this.blob.dead = false;
    this.blob.scared = false;
    this.blob.setEmotion(isRetry ? 'focused' : 'wow', 0.8);
    this.blob.punch(0.5);
    this.audio.vocalize({ f: isRetry ? 260 : 390, vowel: 'oh', dur: 0.25, vol: 0.15 });
    this.musicEvent('waveStart', 0.45);
  }

  private gridMetrics(): { cell: number; left: number; top: number } {
    const worldCell = 104;
    const cell = worldCell * this.cameraZoom;
    return { cell, left: 640 - (cell * this.gridSize) / 2, top: 374 - (cell * this.gridSize) / 2 };
  }

  private cellCenter(cell: PathCell): { x: number; y: number } {
    const m = this.gridMetrics();
    return { x: m.left + (cell.x + 0.5) * m.cell, y: m.top + (cell.y + 0.5) * m.cell };
  }

  private beginPlay(): void {
    if (this.phase !== 'preview') return;
    this.phase = 'play';
    this.revealT = 0;
    this.retry = false;
    this.blob.setEmotion('determined');
    this.blob.punch(0.36);
    this.audio.dash();
    this.fx.ring(this.blob.x, this.blob.y, { r0: 12, r1: 72, color: this.accent, life: 0.42, width: 4 });
    this.fx.text(640, 104, 'GO !', { color: this.accent, size: 28 });
  }

  private toggleVisualMode(): void {
    this.visualMode = nextPathVisualMode(this.visualMode);
    this.revealT = 0;
    const tiles = this.visualMode === 'tiles';
    this.audio.tone({ f: tiles ? 520 : 760, f1: tiles ? 780 : 1140, type: 'triangle', dur: 0.11, vol: 0.085 });
    this.audio.noise({ dur: 0.055, f: tiles ? 900 : 1700, type: 'bandpass', vol: 0.035 });
    this.blob.punch(0.28);
    this.fx.flash(tiles ? '#7dd3fc' : this.accent, 0.06);
    this.fx.text(640, 116, tiles ? 'CASES · CONFORT' : 'TRACE · DIFFICILE', { color: tiles ? '#7dd3fc' : this.accent, size: 16, mono: true });
  }

  private tryMove(direction: PathDirection): void {
    if (this.move || this.phase !== 'play') return;
    const current = this.path[this.pathIndex];
    const delta = DELTAS[direction];
    const destination = { x: current.x + delta.x, y: current.y + delta.y };
    const expected = this.path[this.pathIndex + 1];
    if (!expected || !sameCell(destination, expected)) {
      this.fail(destination);
      return;
    }
    this.move = { from: current, to: destination, t: 0 };
    this.pathIndex++;
    this.comboStep();
  }

  private comboStep(): void {
    const point = this.cellCenter(this.path[this.pathIndex]);
    this.score += 45 + this.round * 10;
    this.audio.coin(this.pathIndex);
    this.musicEvent('combo', Math.min(1.1, 0.25 + this.pathIndex * 0.025));
    this.fx.ring(point.x, point.y, { r0: 5, r1: 34, color: this.accent, life: 0.26, width: 3 });
    this.fx.burst(point.x, point.y, { n: 7, speed: [35, 150], colors: [this.accent, '#ffffff'], size: [1.5, 3.5], life: 0.35 });
    this.input.rumble(0.09, 0.035);
  }

  private fail(destination: PathCell): void {
    this.lives--;
    this.attempts++;
    const p = destination.x >= 0 && destination.y >= 0 && destination.x < this.gridSize && destination.y < this.gridSize
      ? this.cellCenter(destination)
      : { x: this.blob.x, y: this.blob.y };
    this.audio.hurt();
    this.musicEvent('playerHit', 0.9);
    this.input.rumble(0.85, 0.26);
    this.fx.shake(0.75);
    this.fx.stop(0.1);
    this.fx.flash('#ff5470', 0.17);
    this.fx.burst(p.x, p.y, { n: 24, speed: [90, 380], colors: ['#ff5470', '#ffffff', this.accent], size: [2, 6], life: 0.65 });
    this.fx.text(this.blob.x, this.blob.y - 58, 'HORS-PISTE !', { color: '#ff5470', size: 24 });
    this.blob.scared = true;
    if (this.lives <= 0) {
      this.blob.dead = true;
      this.over(false);
      return;
    }
    this.startRound(true);
  }

  private completeRound(): void {
    this.phase = 'roundComplete';
    this.transitionT = 1.6;
    const end = this.cellCenter(this.path[this.path.length - 1]);
    this.score += 450 * this.round + this.lives * 120;
    this.blob.setEmotion('happy');
    this.blob.punch(0.55);
    this.audio.milestone();
    this.musicEvent('waveComplete', 0.9);
    this.input.rumble(0.4, 0.13);
    this.fx.flash('#fef08a', 0.13);
    this.fx.ring(end.x, end.y, { r0: 20, r1: 150, color: '#fef08a', life: 0.65, width: 5 });
    this.fx.burst(end.x, end.y, { n: 30, speed: [90, 430], colors: ['#fef08a', this.accent, '#ffffff'], size: [2, 7], life: 0.8 });
    this.fx.text(640, 102, `MANCHE ${this.round} !`, { color: '#fef08a', size: 30 });
  }

  private nextRound(): void {
    if (this.round >= LAST_ROUND) {
      this.score += this.lives * 500;
      this.over(true);
      return;
    }
    this.round++;
    this.startRound(false);
  }

  update(dt: number): void {
    if (this.baseUpdate(dt)) return;
    this.cameraZoom += (this.cameraTarget - this.cameraZoom) * (1 - Math.exp(-dt * 2.8));

    if (this.phase === 'preview') {
      this.revealT = Math.min(1, this.revealT + dt * (this.retry ? 1.6 : 0.85));
      this.previewT -= dt;
      if (this.input.pressed('x')) this.toggleVisualMode();
      else if (this.input.pressed('a') || this.previewT <= 0) this.beginPlay();
    } else if (this.phase === 'play') {
      if (!this.move) {
        const direction = pathDirectionPressed(this.input);
        if (direction) this.tryMove(direction);
      }
    } else {
      this.transitionT -= dt;
      if (this.transitionT <= 0) this.nextRound();
    }

    if (this.move) {
      this.move.t += dt / Math.max(0.1, 0.2 - this.round * 0.012);
      const k = Math.min(1, this.move.t);
      const from = this.cellCenter(this.move.from);
      const to = this.cellCenter(this.move.to);
      const e = ease(k);
      this.blob.x = from.x + (to.x - from.x) * e;
      this.blob.y = from.y + (to.y - from.y) * e - Math.sin(k * Math.PI) * (15 + this.round);
      this.blob.vx = (to.x - from.x) * 6;
      this.blob.vy = (to.y - from.y) * 6;
      this.blob.setPose(1 - Math.sin(k * Math.PI) * 0.16, 1 + Math.sin(k * Math.PI) * 0.22, 0.1);
      if (k >= 1) {
        this.blob.x = to.x;
        this.blob.y = to.y;
        this.blob.vx = 0;
        this.blob.vy = 0;
        this.blob.setPose(1, 1, 0);
        this.blob.punch(0.2);
        this.audio.land();
        this.move = null;
        if (this.pathIndex >= this.path.length - 1) this.completeRound();
      }
    } else {
      const center = this.cellCenter(this.path[this.pathIndex]);
      this.blob.x += (center.x - this.blob.x) * Math.min(1, dt * 12);
      this.blob.y += (center.y - this.blob.y) * Math.min(1, dt * 12);
      const next = this.path[Math.min(this.path.length - 1, this.pathIndex + 1)];
      const nextCenter = this.cellCenter(next);
      const length = Math.hypot(nextCenter.x - this.blob.x, nextCenter.y - this.blob.y) || 1;
      this.blob.lookX = (nextCenter.x - this.blob.x) / length;
      this.blob.lookY = (nextCenter.y - this.blob.y) / length;
    }
    this.blob.update(dt);
    for (const particle of this.particles) particle.progress = (particle.progress + particle.speed * dt) % 1;
    this.eng.dev.state('path-phase', this.phase);
    this.eng.dev.count('path-round', this.round);
    this.eng.dev.count('path-cells', this.path.length);
  }

  private drawSegment(ctx: CanvasRenderingContext2D, a: PathCell, b: PathCell, color: string, width: number, alpha = 1): void {
    const pa = this.cellCenter(a);
    const pb = this.cellCenter(b);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  private pointAlongPath(progress: number): { x: number; y: number } {
    const span = Math.max(1, this.path.length - 1);
    const value = Math.max(0, Math.min(span - 0.0001, progress * span));
    const index = Math.floor(value);
    const t = value - index;
    const a = this.cellCenter(this.path[index]);
    const b = this.cellCenter(this.path[index + 1]);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }

  private drawPath(ctx: CanvasRenderingContext2D): void {
    const preview = this.phase === 'preview';
    const visibleSegments = preview
      ? Math.ceil((this.path.length - 1) * ease(this.revealT))
      : this.phase === 'roundComplete' ? this.path.length - 1 : this.pathIndex;
    ctx.save();
    ctx.shadowColor = this.accent;
    ctx.shadowBlur = preview ? 20 : 12;
    if (this.visualMode === 'line') {
      for (let i = 0; i < visibleSegments; i++) {
        const fade = preview ? 0.78 : Math.max(0.26, 1 - (this.pathIndex - i) * 0.055);
        this.drawSegment(ctx, this.path[i], this.path[i + 1], this.accent, Math.max(7, 13 * this.cameraZoom), fade);
      }
    } else {
      const metrics = this.gridMetrics();
      const inset = Math.max(5, metrics.cell * 0.075);
      for (let i = 0; i <= visibleSegments; i++) {
        const cell = this.path[i];
        const fade = preview ? 0.5 : Math.max(0.18, 0.46 - (this.pathIndex - i) * 0.026);
        const color = i === 0 ? '#4ade80' : i === this.path.length - 1 ? '#fef08a' : '#7dd3fc';
        ctx.globalAlpha = fade;
        ctx.fillStyle = color;
        UI.roundRect(ctx, metrics.left + cell.x * metrics.cell + inset, metrics.top + cell.y * metrics.cell + inset, metrics.cell - inset * 2, metrics.cell - inset * 2, Math.max(8, metrics.cell * 0.13));
        ctx.fill();
        ctx.globalAlpha = Math.min(1, fade + 0.24);
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1.5, 2.4 * this.cameraZoom);
        ctx.stroke();
      }
    }
    ctx.shadowBlur = 0;
    for (let i = 0; i <= visibleSegments; i++) {
      const p = this.cellCenter(this.path[i]);
      ctx.globalAlpha = preview ? 0.82 : Math.max(0.3, 1 - (this.pathIndex - i) * 0.055);
      ctx.fillStyle = i === 0 ? '#4ade80' : i === this.path.length - 1 ? '#fef08a' : this.accent;
      ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(4, 7 * this.cameraZoom), 0, TAU); ctx.fill();
    }
    if (preview && this.revealT >= 0.98) {
      ctx.globalCompositeOperation = 'lighter';
      for (const particle of this.particles) {
        const p = this.pointAlongPath(particle.progress);
        ctx.globalAlpha = particle.alpha;
        ctx.fillStyle = this.accent;
        ctx.shadowColor = this.accent;
        ctx.shadowBlur = 12;
        ctx.beginPath(); ctx.arc(p.x, p.y, particle.size, 0, TAU); ctx.fill();
      }
    }
    ctx.restore();
  }

  render(ctx: CanvasRenderingContext2D): void {
    const bg = ctx.createRadialGradient(640, 370, 40, 640, 370, 680);
    bg.addColorStop(0, '#151329');
    bg.addColorStop(0.55, '#090b15');
    bg.addColorStop(1, '#04050a');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, this.W, this.H);
    this.fx.world(ctx);
    UI.grid(ctx, { gap: 64, off: this.time * 5, alpha: 0.025 });

    const m = this.gridMetrics();
    const gridW = m.cell * this.gridSize;
    const pulse = 0.5 + Math.sin(this.time * 2.1) * 0.5;
    ctx.save();
    ctx.fillStyle = 'rgba(10,12,23,.76)';
    ctx.shadowColor = this.accent;
    ctx.shadowBlur = this.phase === 'roundComplete' ? 34 + pulse * 18 : 12;
    ctx.fillRect(m.left - 16, m.top - 16, gridW + 32, gridW + 32);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = this.accent + '38';
    ctx.lineWidth = 2;
    ctx.strokeRect(m.left - 16, m.top - 16, gridW + 32, gridW + 32);
    ctx.strokeStyle = '#ffffff12';
    ctx.lineWidth = 1;
    for (let i = 0; i <= this.gridSize; i++) {
      ctx.beginPath(); ctx.moveTo(m.left + i * m.cell, m.top); ctx.lineTo(m.left + i * m.cell, m.top + gridW); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(m.left, m.top + i * m.cell); ctx.lineTo(m.left + gridW, m.top + i * m.cell); ctx.stroke();
    }
    ctx.restore();

    this.drawPath(ctx);
    const start = this.cellCenter(this.path[0]);
    const end = this.cellCenter(this.path[this.path.length - 1]);
    UI.txt(ctx, 'DÉPART', start.x, start.y + Math.max(28, m.cell * 0.32), { size: Math.max(8, 11 * this.cameraZoom), align: 'center', mono: true, color: '#4ade80', weight: 900 });
    UI.txt(ctx, 'ARRIVÉE', end.x, end.y - Math.max(24, m.cell * 0.3), { size: Math.max(8, 11 * this.cameraZoom), align: 'center', mono: true, color: '#fef08a', weight: 900 });
    this.blob.render(ctx);
    this.fx.drawWorld(ctx);
    this.fx.endWorld(ctx);

    UI.drawHUD(ctx, {
      accent: this.accent,
      score: Math.floor(this.score),
      unit: 'pts',
      extra: () => {
        UI.panel(ctx, 16, 14, 188, 58, { radius: 14, fill: 'rgba(7,10,17,.72)', stroke: this.accent + '38' });
        UI.txt(ctx, 'MANCHE', 32, 31, { size: 9, mono: true, color: this.accent, weight: 900 });
        UI.txt(ctx, `${this.round} / ${LAST_ROUND}`, 32, 59, { size: 23, mono: true, weight: 800 });
        UI.txt(ctx, `${this.gridSize} × ${this.gridSize}`, 188, 56, { size: 13, align: 'right', mono: true, color: '#8b95a8' });
        UI.txt(ctx, 'VIES', 230, 31, { size: 9, mono: true, color: '#ff7a91', weight: 900 });
        for (let i = 0; i < MAX_LIVES; i++) {
          ctx.fillStyle = i < this.lives ? '#ff7a91' : '#ffffff18';
          ctx.beginPath(); ctx.arc(243 + i * 25, 53, 8, 0, TAU); ctx.fill();
        }
      },
    });

    if (this.phase === 'preview') {
      UI.panel(ctx, 425, 10, 430, 94, { radius: 18, fill: 'rgba(7,10,17,.86)', stroke: this.accent + '55', lineWidth: 1.5 });
      UI.txt(ctx, this.retry ? 'REMÉMORISE LE CHEMIN' : 'MÉMORISE LE CHEMIN', 640, 35, { size: 13, align: 'center', color: '#ffffff', weight: 900 });
      UI.txt(ctx, `${Math.ceil(this.previewT)} s`, 544, 65, { size: 21, align: 'center', mono: true, color: this.previewT < 6 ? '#ff7a91' : this.accent, weight: 900 });
      UI.txt(ctx, 'A / ESPACE  PARTIR', 700, 63, { size: 12, align: 'center', mono: true, color: '#dfe6f0', weight: 900 });
      const tiles = this.visualMode === 'tiles';
      UI.txt(ctx, `X / L  ◀  ${tiles ? 'CASES · CONFORT' : 'TRACE · DIFFICILE'}  ▶`, 640, 91, { size: 10.5, align: 'center', mono: true, color: tiles ? '#7dd3fc' : this.accent, weight: 900 });
    } else if (this.phase === 'play') {
      UI.txt(ctx, `${this.pathIndex} / ${this.path.length - 1}`, 640, 42, { size: 12, align: 'center', mono: true, color: '#8b95a8', weight: 900 });
    }
    this.drawCommon(ctx);
  }

  debugSnapshot(): Record<string, string | number | boolean | null> {
    return {
      ...super.debugSnapshot(),
      round: this.round,
      grid: this.gridSize,
      phase: this.phase,
      lives: this.lives,
      pathLength: this.path.length,
      pathIndex: this.pathIndex,
      preview: Number(this.previewT.toFixed(1)),
      visualMode: this.visualMode,
    };
  }
}
