// BLOB SNAKE — serpent sur grille 32×18, pas discrets interpolés entre cells.
// Lucioles = points + accélération ; fruit doré = 5× ; murs et queue mortels.

import { BaseGame } from '../core/game';
import * as UI from '../core/ui';
import type { EngineLike, GameMeta, InputLike } from '../core/types';

const CELL = 40, COLS = 32, ROWS = 18;       // 32×40=1280, 18×40=720 : plein écran
const STEP0 = 0.15, STEP_MIN = 0.075, STEP_DEC = 0.004;
const START_LEN = 4;

// assombrit une couleur hex (pour le corps, même teinte que l'accent)
function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${Math.round(((n >> 16) & 255) * f)},${Math.round(((n >> 8) & 255) * f)},${Math.round((n & 255) * f)})`;
}

export class SnakeGame extends BaseGame {
  [key: string]: any;
  static meta: GameMeta = {
    id: 'snake', name: 'BLOB SNAKE', accent: '#22d3ee', mood: 'runner',
    desc: 'Croque, grandis, survis', controls: 'Stick / ZQSD diriger',
    keys: "Flèches / ZQSD",
    hint: 'Mange les lucioles · murs et queue mortels',
    unit: 'pts', ranks: [1200, 700, 400, 180, 0],
  };

  constructor(engine: EngineLike) {
    super(engine);
    this.blob.r = 15;
    this.blob.trailOn = true;
    this.cells = [];
    for (let i = 0; i < START_LEN; i++) this.cells.push({ x: 8 - i, y: 9 });
    this.prevCells = this.cells.map((c: any) => ({ ...c })); // positions du pas précédent (interpolation)
    this.dir = [1, 0];
    this.queue = [];                 // file d'inputs, profondeur max 2
    this.lastStick = null;
    this.stepT = 0;
    this.stepTime = STEP0;
    this.eaten = 0;
    this.sinceGold = 0;
    this.goldEvery = 6 + ((Math.random() * 3) | 0);
    this.goldT = 0;
    this.coinStep = 0; this.chainT = 0;
    this.food = null;
    this.spawnFood();
    this.syncBlob(0);
  }

  // ---------- helpers ----------
  px(x: number): number { return (x + 0.5) * CELL; }

  enqueue(dx: number, dy: number): void {
    // valide contre la dernière direction effective (file ou pas appliqué) :
    // ni demi-tour, ni doublon — évite le U-turn empilé [up, down] en un pas.
    const last = this.queue.length ? this.queue[this.queue.length - 1] : this.dir;
    if ((dx === last[0] && dy === last[1]) || (dx === -last[0] && dy === -last[1])) return;
    if (this.queue.length < 2) this.queue.push([dx, dy]);
  }

  readInput(I: InputLike): void {
    if (I.pressed('up')) this.enqueue(0, -1);
    if (I.pressed('down')) this.enqueue(0, 1);
    if (I.pressed('left')) this.enqueue(-1, 0);
    if (I.pressed('right')) this.enqueue(1, 0);
    // stick : direction dominante, seuil 0.5, re-déclenchée seulement au changement
    const mx = I.moveX, my = I.moveY;
    let sd = null;
    if (Math.abs(mx) > 0.5 || Math.abs(my) > 0.5) {
      sd = Math.abs(mx) > Math.abs(my) ? [Math.sign(mx), 0] : [0, Math.sign(my)];
    }
    if (sd) {
      if (!this.lastStick || sd[0] !== this.lastStick[0] || sd[1] !== this.lastStick[1]) {
        this.enqueue(sd[0], sd[1]);
        this.lastStick = sd;
      }
    } else this.lastStick = null;
  }

  // place le blob (tête) à la position interpolée entre prevCells[0] et cells[0]
  syncBlob(t: number): void {
    const p = this.prevCells[0], c = this.cells[0];
    this.blob.x = this.px(p.x + (c.x - p.x) * t);
    this.blob.y = this.px(p.y + (c.y - p.y) * t);
  }

  spawnFood(): void {
    const free = [];
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (!this.cells.some((c: any) => c.x === x && c.y === y)) free.push({ x, y });
      }
    }
    if (!free.length) { this.over(true); return; } // grille remplie : victoire !
    const c = free[(Math.random() * free.length) | 0];
    const gold = this.sinceGold >= this.goldEvery;
    if (gold) { this.sinceGold = 0; this.goldEvery = 6 + ((Math.random() * 3) | 0); this.goldT = 6; }
    this.food = { x: c.x, y: c.y, gold, ph: Math.random() * 6.28 };
  }

  eat(): void {
    const f = this.food;
    this.eaten++;
    this.sinceGold++;
    this.stepTime = Math.max(STEP_MIN, this.stepTime - STEP_DEC);
    this.chainT = 2.5;
    this.coinStep++;
    let pts = 10 + 2 * this.eaten;
    if (f.gold) { pts *= 5; this.audio.perfect(); this.fx.shake(0.12); }
    else this.audio.coin(this.coinStep);
    this.score += pts;
    this.musicEvent('combo', Math.min(1.2, 0.35 + this.eaten * 0.025));
    if (f.gold) this.musicEvent('powerUp', 0.85);
    const x = this.px(f.x), y = this.px(f.y);
    this.fx.burst(x, y, { n: f.gold ? 22 : 12, speed: [60, 300], colors: f.gold ? ['#ffd166', '#fde047', '#ffffff'] : ['#fde047', '#ffffff'], life: 0.5 });
    this.fx.ring(x, y, { r0: 6, r1: f.gold ? 84 : 46, color: f.gold ? '#ffd166' : '#fde047', life: 0.32 });
    this.fx.text(x, y - 20, '+' + pts, { color: f.gold ? '#ffd166' : '#fde047', size: f.gold ? 26 : 18, mono: true });
    this.input.rumble(0.2, 0.06);
    this.blob.punch(0.25);
    if (this.eaten % 10 === 0) { // palier : petite fanfare + onde
      this.audio.milestone();
      this.fx.ring(this.blob.x, this.blob.y, { r0: 12, r1: 96, color: this.accent, life: 0.45 });
    }
    this.food = null;
    this.spawnFood();
  }

  doStep(): void {
    const prevD = this.dir;
    if (this.queue.length) {
      const d = this.queue.shift();
      if (!(d[0] === -this.dir[0] && d[1] === -this.dir[1])) this.dir = d; // garde-fou demi-tour
    }
    const turned = this.dir[0] !== prevD[0] || this.dir[1] !== prevD[1];
    const head = this.cells[0];
    const nx = head.x + this.dir[0], ny = head.y + this.dir[1];

    // mur
    if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) {
      this.die(this.px(head.x + this.dir[0] * 0.45), this.px(head.y + this.dir[1] * 0.45), true);
      return;
    }
    // corps (la case queue est libérée si on ne grandit pas)
    const willEat = !!this.food && nx === this.food.x && ny === this.food.y;
    const bodyLen = willEat ? this.cells.length : this.cells.length - 1;
    for (let i = 0; i < bodyLen; i++) {
      if (this.cells[i].x === nx && this.cells[i].y === ny) { this.die(this.px(nx), this.px(ny), false); return; }
    }

    const old = this.cells;
    this.cells = [{ x: nx, y: ny }, ...old];
    if (!willEat) this.cells.pop();
    this.prevCells = old;

    // vitesse du blob = vitesse réelle du pas (squash & stretch + regard)
    const spd = CELL / this.stepTime;
    this.blob.vx = this.dir[0] * spd;
    this.blob.vy = this.dir[1] * spd;

    if (turned) {
      this.blob.punch(0.2);
      this.audio.land();
      this.fx.burst(this.px(head.x), this.px(head.y), { n: 5, speed: [40, 140], colors: [this.accent], size: [1.5, 3], life: 0.3 });
    }
    if (willEat) this.eat();
  }

  die(px: number, py: number, splat: boolean): void {
    if (this.state === 'over') return;
    this.audio.explode(1.4);
    this.input.rumble(1, 0.4);
    this.fx.shake(0.95);
    this.fx.stop(0.13);
    this.fx.burst(px, py, { n: 30, speed: [100, 520], colors: [this.accent, '#ffffff', '#fde047'], size: [2, 6], life: 0.7 });
    this.fx.ring(px, py, { r0: 10, r1: 120, color: this.accent, life: 0.4 });
    for (let i = 1; i < Math.min(this.cells.length, 9); i += 2) { // gerbe le long du corps
      const c = this.cells[i];
      this.fx.burst(this.px(c.x), this.px(c.y), { n: 6, speed: [40, 200], colors: [this.accent, '#ffffff'], size: [1.5, 4], life: 0.5 });
    }
    if (splat) { this.blob.x = px; this.blob.y = py; }
    this.blob.dead = true;
    this.over();
  }

  update(dt: number): void {
    if (this.baseUpdate(dt)) return;
    const I = this.input;

    this.readInput(I);

    // chaîne de pitch : step remis à 0 après 2.5 s sans manger
    this.chainT = Math.max(0, this.chainT - dt);
    if (this.chainT <= 0) this.coinStep = 0;

    // fruit doré périssable
    if (this.food && this.food.gold) {
      this.goldT -= dt;
      if (this.goldT <= 0) {
        const x = this.px(this.food.x), y = this.px(this.food.y);
        this.fx.burst(x, y, { n: 8, speed: [30, 130], colors: ['#ffd166'], size: [1.5, 3.5], life: 0.4 });
        this.audio.whiff();
        this.food = null;
        this.spawnFood();
      }
    }

    // pas discrets
    this.stepT += dt;
    let guard = 0;
    while (this.stepT >= this.stepTime && this.state === 'play' && guard++ < 4) {
      this.stepT -= this.stepTime;
      this.doStep();
    }

    if (this.state === 'play') {
      this.syncBlob(this.stepT / this.stepTime);
      this.blob.update(dt);
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#070910';
    ctx.fillRect(0, 0, 1280, 720);

    this.fx.world(ctx);

    UI.grid(ctx, { gap: 40, alpha: 0.05 });

    // murs mortels
    ctx.strokeStyle = this.accent + '14';
    ctx.lineWidth = 8;
    ctx.strokeRect(5, 5, 1270, 710);
    ctx.strokeStyle = this.accent + '30';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, 1278, 718);

    // luciole
    if (this.food) {
      const f = this.food;
      const x = this.px(f.x), y = this.px(f.y);
      const tw = this.time * 6 + f.ph;
      const col = f.gold ? '#ffd166' : '#fde047';
      let a = 0.66 + 0.34 * Math.sin(tw * 1.6);
      let r = f.gold ? 11 + Math.sin(tw) * 2 : 8 + Math.sin(tw) * 1.8;
      if (f.gold && this.goldT < 1) a = Math.sin(this.time * 26) > 0 ? 1 : 0.15; // clignote fort
      ctx.globalAlpha = a;
      ctx.shadowColor = col;
      ctx.shadowBlur = f.gold ? 22 : 14;
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
      ctx.shadowBlur = 0;
      if (f.gold) {
        ctx.globalAlpha = a * 0.5;
        ctx.strokeStyle = '#fde047';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, r + 5 + Math.sin(tw * 2) * 2, 0, 6.2832); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // corps : cercles décroissants interpolés entre cells
    const t = Math.min(1, this.stepT / this.stepTime);
    const n = this.cells.length;
    const dark = shade(this.accent, 0.62);
    for (let i = n - 1; i >= 1; i--) {
      const p = i < this.prevCells.length ? this.prevCells[i] : this.cells[i];
      const c = this.cells[i];
      const x = this.px(p.x + (c.x - p.x) * t);
      const y = this.px(p.y + (c.y - p.y) * t);
      const k = i / Math.max(1, n - 1);
      ctx.globalAlpha = 1 - k * 0.55;
      ctx.fillStyle = dark;
      ctx.beginPath();
      ctx.arc(x, y, 13 - 6 * k, 0, 6.2832);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // tête = le blob
    this.blob.render(ctx);

    this.fx.drawWorld(ctx);
    this.fx.endWorld(ctx);

    UI.drawHUD(ctx, {
      accent: this.accent,
      score: this.score,
      unit: this.meta.unit,
      extra: () => {
        UI.txt(ctx, 'LONGUEUR ' + this.cells.length, 28, 70, { size: 12, mono: true, color: '#7c8698' });
        if (this.chainT > 0 && this.coinStep > 1) {
          UI.txt(ctx, 'CHAÎNE ×' + this.coinStep, 28, 90, { size: 13, mono: true, color: '#ffd166' });
        }
      },
    });
    this.drawCommon(ctx);
  }
}
