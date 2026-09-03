// BLOB TRI — lecture rapide de couleur. Un blob apparaît au centre : une direction
// l'envoie vers son garage, A/Espace éjecte les intrus. La cadence et les leurres
// visuels montent progressivement, mais le corps du blob reste toujours la vérité.

import { BaseGame } from '../core/game';
import { Blob } from '../core/blob';
import * as UI from '../core/ui';
import type { Action, EngineLike, GameMeta, InputLike } from '../core/types';

const TAU = Math.PI * 2;
const STOCK = 72;
const MAX_ERRORS = 3;
const CENTER_X = 640;
const CENTER_Y = 356;

export type SortDirection = 'up' | 'left' | 'right' | 'down';

export interface SortColor {
  name: string;
  color: string;
  direction: SortDirection;
  symbol: string;
  x: number;
  y: number;
}

export interface SortDifficulty {
  colorCount: number;
  decisionTime: number;
  intruderChance: number;
  lureLevel: number;
  label: string;
}

interface SortItem {
  blob: Blob;
  colorIndex: number;
  intruder: boolean;
  timeLeft: number;
  maxTime: number;
  lureColor: string;
  spin: number;
  serial: number;
}

interface FlyingItem {
  blob: Blob;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  t: number;
  duration: number;
  correct: boolean;
  eject: boolean;
}

interface ParkedBlob {
  blob: Blob;
  x: number;
  y: number;
  scale: number;
}

export const SORT_COLORS: readonly SortColor[] = [
  { name: 'JAUNE', color: '#facc15', direction: 'up', symbol: '●', x: 640, y: 112 },
  { name: 'BLEU', color: '#38bdf8', direction: 'left', symbol: '▲', x: 126, y: 356 },
  { name: 'ROSE', color: '#fb7185', direction: 'right', symbol: '■', x: 1154, y: 356 },
  { name: 'VERT', color: '#4ade80', direction: 'down', symbol: '◆', x: 640, y: 604 },
] as const;

export function sortDifficulty(sorted: number): SortDifficulty {
  const safe = Math.max(0, sorted);
  if (safe < 12) {
    return { colorCount: 2, decisionTime: 2.45 - safe * 0.045, intruderChance: 0.16, lureLevel: 0, label: 'ÉCHAUFFEMENT' };
  }
  if (safe < 24) {
    return { colorCount: 2, decisionTime: 1.72 - (safe - 12) * 0.045, intruderChance: 0.22, lureLevel: 1, label: 'CADENCE' };
  }
  if (safe < 48) {
    return { colorCount: 3, decisionTime: Math.max(0.92, 1.34 - (safe - 24) * 0.019), intruderChance: 0.25, lureLevel: 2, label: 'BROUILLAGE' };
  }
  return { colorCount: 4, decisionTime: Math.max(0.64, 0.9 - (safe - 48) * 0.012), intruderChance: 0.28, lureLevel: 3, label: 'QUATRE COINS' };
}

export function sortDirectionPressed(input: Pick<InputLike, 'pressed'>): SortDirection | null {
  const directions: readonly SortDirection[] = ['up', 'left', 'right', 'down'];
  for (const direction of directions) if (input.pressed(direction as Action)) return direction;
  return null;
}

export function sortChoiceCorrect(item: Pick<SortItem, 'intruder' | 'colorIndex'>, choice: SortDirection | 'eject'): boolean {
  if (choice === 'eject') return item.intruder;
  return !item.intruder && SORT_COLORS[item.colorIndex]?.direction === choice;
}

function easeOutBack(t: number): number {
  const k = t - 1;
  return 1 + 2.7 * k * k * k + 1.7 * k * k;
}

export class SortGame extends BaseGame {
  static meta: GameMeta = {
    id: 'sort',
    name: 'BLOB TRI',
    accent: '#facc15',
    mood: 'simon',
    desc: 'Trie les blobs. Éjecte les intrus.',
    controls: 'Directions ranger · A éjecter',
    keys: 'Flèches / ZQSD · Espace',
    hint: 'Direction = garage · A / Espace = intrus · le corps fait foi',
    unit: 'pts',
    ranks: [12000, 9000, 6000, 3000, 0],
  };

  current: SortItem | null = null;
  flying: FlyingItem[] = [];
  parked: ParkedBlob[][] = SORT_COLORS.map(() => []);
  processed = 0;
  sorted = 0;
  errors = 0;
  combo = 0;
  bestCombo = 0;
  spawnT = 0.55;
  phaseFlash = 0;
  lastPhase = 0;
  banner = '2 COULEURS';
  bannerT = 1.6;
  serial = 0;

  constructor(engine: EngineLike) {
    super(engine);
    this.blob.x = CENTER_X;
    this.blob.y = CENTER_Y;
    this.blob.r = 36;
    this.blob.trailOn = true;
  }

  private spawn(): void {
    if (this.processed >= STOCK) {
      this.finishStock();
      return;
    }
    const difficulty = sortDifficulty(this.processed);
    const intruder = this.rng.next() < difficulty.intruderChance;
    const colorIndex = this.rng.int(0, difficulty.colorCount - 1);
    const color = intruder ? '#a8b0be' : SORT_COLORS[colorIndex].color;
    const blob = new Blob({ x: CENTER_X, y: CENTER_Y, r: 38, color, trailOn: true });
    blob.setEmotion(intruder ? 'determined' : 'focused');
    blob.setPose(0.25, 1.55, 0.35);
    blob.punch(0.48);
    const lureIndex = (colorIndex + 1 + this.rng.int(0, Math.max(0, difficulty.colorCount - 2))) % difficulty.colorCount;
    this.current = {
      blob,
      colorIndex,
      intruder,
      timeLeft: difficulty.decisionTime,
      maxTime: difficulty.decisionTime,
      lureColor: SORT_COLORS[lureIndex].color,
      spin: this.rng.float(-1, 1),
      serial: ++this.serial,
    };
    this.blob = blob;
    this.audio.land();
    this.fx.ring(CENTER_X, CENTER_Y, { r0: 8, r1: 62, color, life: 0.3, width: 3 });
  }

  private choose(choice: SortDirection | 'eject'): void {
    const item = this.current;
    if (!item) return;
    const correct = sortChoiceCorrect(item, choice);
    let tx = CENTER_X;
    let ty = -100;
    let eject = choice === 'eject';
    if (choice !== 'eject') {
      const bay = SORT_COLORS.find((entry) => entry.direction === choice)!;
      tx = bay.x;
      ty = bay.y;
    } else {
      const angle = -Math.PI / 2 + item.spin * 0.55;
      tx = CENTER_X + Math.cos(angle) * 480;
      ty = CENTER_Y + Math.sin(angle) * 480;
    }
    this.flying.push({ blob: item.blob, fromX: CENTER_X, fromY: CENTER_Y, toX: tx, toY: ty, t: 0, duration: correct ? 0.34 : 0.46, correct, eject });
    this.current = null;

    if (correct) this.success(item, choice);
    else this.mistake(item, choice);
  }

  private success(item: SortItem, choice: SortDirection | 'eject'): void {
    const speed = Math.max(0, item.timeLeft / item.maxTime);
    this.processed++;
    this.sorted++;
    this.combo++;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    const points = 100 + Math.floor(speed * 80) + Math.min(220, this.combo * 10) + (item.intruder ? 60 : 0);
    this.score += points;
    this.audio.coin(this.combo);
    this.musicEvent('combo', Math.min(1.2, 0.3 + this.combo * 0.045));
    this.input.rumble(0.13, 0.045);
    const color = item.intruder ? '#e5e7eb' : SORT_COLORS[item.colorIndex].color;
    this.fx.text(CENTER_X, CENTER_Y - 60, `+${points}`, { color, size: 20, mono: true });
    this.fx.burst(CENTER_X, CENTER_Y, { n: 12, speed: [70, 250], colors: [color, '#ffffff'], size: [2, 5], life: 0.45 });
    if (choice === 'eject') {
      this.audio.dash();
      this.fx.text(CENTER_X, CENTER_Y + 72, 'ÉJECTÉ !', { color: '#e5e7eb', size: 18 });
    }

    const newPhase = this.processed < 12 ? 0 : this.processed < 24 ? 1 : this.processed < 48 ? 2 : 3;
    if (newPhase !== this.lastPhase && this.processed < STOCK) {
      this.lastPhase = newPhase;
      const d = sortDifficulty(this.processed);
      this.banner = newPhase === 2 ? '3e COULEUR !' : newPhase === 3 ? '4e COULEUR !' : d.label;
      this.bannerT = 1.7;
      this.phaseFlash = 1;
      this.spawnT = 1.05;
      this.audio.milestone();
      this.musicEvent('waveComplete', 0.65);
      this.fx.flash(this.accent, 0.12);
      this.fx.ring(CENTER_X, CENTER_Y, { r0: 30, r1: 230, color: this.accent, life: 0.6, width: 5 });
    } else {
      this.spawnT = Math.max(0.09, 0.24 - this.processed * 0.0025);
    }

    if (this.processed >= STOCK) this.spawnT = 0.55;
  }

  private mistake(item: SortItem, choice: SortDirection | 'eject' | 'timeout'): void {
    this.processed++;
    this.errors++;
    if (this.combo >= 4) this.musicEvent('comboBreak', Math.min(1, this.combo / 16));
    this.combo = 0;
    this.audio.hurt();
    this.musicEvent('playerHit', 0.8);
    this.input.rumble(0.75, 0.22);
    this.fx.shake(0.62);
    this.fx.stop(0.07);
    this.fx.flash('#ff5470', 0.16);
    this.fx.burst(CENTER_X, CENTER_Y, { n: 18, speed: [80, 340], colors: ['#ff5470', '#ffffff'], size: [2, 6], life: 0.55 });
    const expected = item.intruder ? 'A : ÉJECTER' : `VERS ${SORT_COLORS[item.colorIndex].name}`;
    this.fx.text(CENTER_X, CENTER_Y - 65, choice === 'timeout' ? 'TROP TARD !' : 'ERREUR !', { color: '#ff5470', size: 25 });
    this.fx.text(CENTER_X, CENTER_Y + 74, expected, { color: '#ffffff', size: 14, mono: true });
    item.blob.scared = true;
    this.spawnT = 0.72;
    if (this.errors >= MAX_ERRORS) {
      this.blob.dead = true;
      this.over(false);
    }
  }

  private finishStock(): void {
    if (this.state === 'over') return;
    this.score += Math.max(0, MAX_ERRORS - this.errors) * 500 + this.bestCombo * 25;
    this.fx.flash('#4ade80', 0.18);
    this.fx.burst(CENTER_X, CENTER_Y, { n: 42, speed: [100, 520], colors: SORT_COLORS.map((entry) => entry.color), size: [2, 7], life: 0.9 });
    this.audio.milestone();
    this.over(true);
  }

  update(dt: number): void {
    if (this.baseUpdate(dt)) return;
    this.bannerT = Math.max(0, this.bannerT - dt);
    this.phaseFlash = Math.max(0, this.phaseFlash - dt * 2.5);

    for (let i = this.flying.length - 1; i >= 0; i--) {
      const flight = this.flying[i];
      flight.t += dt / flight.duration;
      const k = Math.min(1, flight.t);
      const e = easeOutBack(k);
      flight.blob.x = flight.fromX + (flight.toX - flight.fromX) * e;
      flight.blob.y = flight.fromY + (flight.toY - flight.fromY) * e;
      flight.blob.vx = (flight.toX - flight.fromX) / flight.duration;
      flight.blob.vy = (flight.toY - flight.fromY) / flight.duration;
      flight.blob.setPose(1 + k * 0.35, 1 - k * 0.22, k * 0.25);
      flight.blob.update(dt);
      if (k >= 1) {
        if (flight.correct && !flight.eject) {
          const colorIndex = SORT_COLORS.findIndex((entry) => Math.hypot(entry.x - flight.toX, entry.y - flight.toY) < 2);
          if (colorIndex >= 0) this.parkBlob(colorIndex, flight.blob);
        }
        this.flying.splice(i, 1);
      }
    }

    if (!this.current) {
      this.spawnT -= dt;
      if (this.spawnT <= 0 && this.state === 'play') this.spawn();
    } else {
      const item = this.current;
      item.timeLeft -= dt;
      item.blob.setPose(1, 1, 0.08 + Math.max(0, 0.2 - item.timeLeft) * 0.8);
      item.blob.lookX = Math.sin(this.time * 1.8 + item.serial) * 0.35;
      item.blob.lookY = -0.08;
      item.blob.update(dt);

      const direction = sortDirectionPressed(this.input);
      if (direction) this.choose(direction);
      else if (this.input.pressed('a')) this.choose('eject');
      else if (item.timeLeft <= 0) {
        this.current = null;
        this.mistake(item, 'timeout');
      }
    }

    for (const garage of this.parked) for (const parked of garage) parked.blob.update(dt);
    this.eng.dev.count('sort-stock', STOCK - this.processed);
    this.eng.dev.count('sort-errors', this.errors);
    this.eng.dev.state('sort-phase', sortDifficulty(this.processed).label);
  }

  private parkBlob(index: number, blob: Blob): void {
    const garage = this.parked[index];
    const bay = SORT_COLORS[index];
    const slot = garage.length % 8;
    const row = Math.floor(garage.length / 8);
    const vertical = bay.direction === 'left' || bay.direction === 'right';
    const dx = vertical ? (row % 2) * 22 - 11 : (slot - 3.5) * 18;
    const dy = vertical ? (slot - 3.5) * 18 : (row % 2) * 22 - 11;
    blob.x = bay.x + dx;
    blob.y = bay.y + dy;
    blob.vx = 0;
    blob.vy = 0;
    blob.r = 11;
    blob.trailOn = false;
    blob.setPose(1, 1, 0);
    blob.setEmotion('happy');
    blob.punch(0.35);
    garage.push({ blob, x: blob.x, y: blob.y, scale: 1 });
    this.fx.ring(blob.x, blob.y, { r0: 8, r1: 42, color: bay.color, life: 0.3, width: 2 });
  }

  private drawGarage(ctx: CanvasRenderingContext2D, bay: SortColor, index: number, activeCount: number): void {
    const available = index < activeCount;
    const horizontal = bay.direction === 'up' || bay.direction === 'down';
    const w = horizontal ? 250 : 148;
    const h = horizontal ? 104 : 230;
    ctx.save();
    ctx.globalAlpha = available ? 1 : 0.18;
    UI.panel(ctx, bay.x - w / 2, bay.y - h / 2, w, h, {
      radius: 24,
      fill: available ? bay.color + '12' : '#ffffff06',
      stroke: available ? bay.color + '70' : '#ffffff20',
      lineWidth: available ? 2 : 1,
    });
    UI.txt(ctx, bay.direction === 'up' ? '↑' : bay.direction === 'left' ? '←' : bay.direction === 'right' ? '→' : '↓', bay.x, bay.y - h / 2 + 27, {
      size: 23, align: 'center', color: available ? bay.color : '#5d6480', weight: 900,
    });
    UI.txt(ctx, available ? `${bay.symbol} ${bay.name}` : 'VERROUILLÉ', bay.x, bay.y + h / 2 - 14, {
      size: 10, align: 'center', mono: true, color: available ? bay.color : '#5d6480', weight: 900,
    });
    for (const parked of this.parked[index]) parked.blob.render(ctx);
    ctx.restore();
  }

  private drawLures(ctx: CanvasRenderingContext2D, item: SortItem, difficulty: SortDifficulty): void {
    if (difficulty.lureLevel >= 1) {
      ctx.save();
      ctx.globalAlpha = 0.22 + 0.08 * Math.sin(this.time * 5);
      ctx.strokeStyle = item.lureColor;
      ctx.lineWidth = 8;
      ctx.setLineDash([12, 14]);
      ctx.beginPath();
      ctx.arc(CENTER_X, CENTER_Y, 66, this.time * 0.8, this.time * 0.8 + TAU);
      ctx.stroke();
      ctx.restore();
    }
    if (difficulty.lureLevel >= 2) {
      ctx.save();
      const wash = ctx.createRadialGradient(CENTER_X, CENTER_Y, 40, CENTER_X, CENTER_Y, 330);
      wash.addColorStop(0, item.lureColor + '1f');
      wash.addColorStop(1, item.lureColor + '00');
      ctx.fillStyle = wash;
      ctx.fillRect(260, 100, 760, 520);
      ctx.restore();
    }
    if (difficulty.lureLevel >= 3 && !item.intruder) {
      UI.txt(ctx, SORT_COLORS[(item.colorIndex + 1) % difficulty.colorCount].name, CENTER_X, CENTER_Y + 102, {
        size: 15, align: 'center', mono: true, color: item.lureColor + '88', weight: 900,
      });
      UI.txt(ctx, 'LE CORPS FAIT FOI', CENTER_X, CENTER_Y + 126, {
        size: 9, align: 'center', mono: true, color: '#768195',
      });
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    const difficulty = sortDifficulty(this.processed);
    const bg = ctx.createRadialGradient(CENTER_X, CENTER_Y, 20, CENTER_X, CENTER_Y, 700);
    bg.addColorStop(0, '#111827');
    bg.addColorStop(1, '#05070c');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, this.W, this.H);
    this.fx.world(ctx);
    UI.grid(ctx, { gap: 48, off: this.time * 7, alpha: 0.035 });

    for (let i = 0; i < SORT_COLORS.length; i++) this.drawGarage(ctx, SORT_COLORS[i], i, difficulty.colorCount);

    ctx.save();
    ctx.strokeStyle = '#ffffff12';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 10]);
    ctx.beginPath(); ctx.arc(CENTER_X, CENTER_Y, 84, 0, TAU); ctx.stroke();
    ctx.restore();

    if (this.current) {
      const item = this.current;
      this.drawLures(ctx, item, difficulty);
      const ratio = Math.max(0, item.timeLeft / item.maxTime);
      ctx.strokeStyle = ratio < 0.3 ? '#ff5470' : item.intruder ? '#e5e7eb' : item.blob.color;
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(CENTER_X, CENTER_Y, 57, -Math.PI / 2, -Math.PI / 2 + TAU * ratio);
      ctx.stroke();
      ctx.lineCap = 'butt';
      item.blob.render(ctx);
      if (item.intruder) {
        ctx.save();
        ctx.translate(CENTER_X, CENTER_Y);
        ctx.rotate(Math.sin(this.time * 5) * 0.08);
        ctx.strokeStyle = '#111827';
        ctx.lineWidth = 7;
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(-16, -16); ctx.lineTo(16, 16); ctx.moveTo(16, -16); ctx.lineTo(-16, 16); ctx.stroke();
        ctx.restore();
        UI.txt(ctx, 'INTRUS  ·  A / ESPACE', CENTER_X, CENTER_Y + 80, { size: 13, align: 'center', mono: true, color: '#e5e7eb', weight: 900 });
      }
    }

    for (const flight of this.flying) flight.blob.render(ctx);
    this.fx.drawWorld(ctx);
    this.fx.endWorld(ctx);

    UI.drawHUD(ctx, {
      accent: this.accent,
      score: Math.floor(this.score),
      unit: 'pts',
      extra: () => {
        UI.panel(ctx, 16, 14, 238, 58, { radius: 14, fill: 'rgba(7,10,17,.72)', stroke: this.accent + '38' });
        UI.txt(ctx, 'STOCK', 32, 31, { size: 9, mono: true, color: this.accent, weight: 900 });
        UI.txt(ctx, `${Math.max(0, STOCK - this.processed)} / ${STOCK}`, 32, 59, { size: 23, mono: true, weight: 800 });
        UI.txt(ctx, 'ERREURS', 278, 31, { size: 9, mono: true, color: '#ff5470', weight: 900 });
        for (let i = 0; i < MAX_ERRORS; i++) {
          ctx.fillStyle = i < this.errors ? '#ff5470' : '#ffffff18';
          ctx.beginPath(); ctx.arc(292 + i * 25, 53, 8, 0, TAU); ctx.fill();
        }
        UI.txt(ctx, `COMBO ×${this.combo}`, 1018, 49, { size: 13, align: 'right', mono: true, color: this.combo >= 5 ? '#facc15' : '#8b95a8', weight: 900 });
      },
    });

    UI.txt(ctx, difficulty.label, CENTER_X, 34, { size: 11, align: 'center', mono: true, color: '#8b95a8', weight: 900 });
    const progress = this.processed / STOCK;
    ctx.fillStyle = '#ffffff12'; ctx.fillRect(484, 47, 312, 5);
    ctx.fillStyle = this.accent; ctx.fillRect(484, 47, 312 * progress, 5);

    if (this.bannerT > 0) {
      const alpha = Math.min(1, this.bannerT * 2, (1.7 - this.bannerT) * 3);
      ctx.globalAlpha = alpha;
      UI.txt(ctx, this.banner, CENTER_X, 247, { size: 28, align: 'center', color: '#ffffff', weight: 900, shadow: true });
      ctx.globalAlpha = 1;
    }
    this.drawCommon(ctx);
  }

  debugSnapshot(): Record<string, string | number | boolean | null> {
    return {
      ...super.debugSnapshot(),
      stock: STOCK - this.processed,
      processed: this.processed,
      sorted: this.sorted,
      errors: this.errors,
      combo: this.combo,
      colors: sortDifficulty(this.processed).colorCount,
      decisionTime: Number(sortDifficulty(this.processed).decisionTime.toFixed(2)),
      intruder: this.current?.intruder ?? null,
    };
  }
}
