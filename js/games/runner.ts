// BLOB RUN — auto-runner : saut variable (maintien), coyote time, buffer de saut,
// duck pour passer sous les barres, marteaux pneumatiques... non, des scies.

import { BaseGame } from '../core/game';
import * as UI from '../core/ui';
import type { EngineLike, GameMeta, InputLike } from '../core/types';

const GY = 600;           // sol
const PX = 320;           // x écran du joueur

export class RunnerGame extends BaseGame {
  [key: string]: any;
  static meta: GameMeta = {
    id: 'run', name: 'BLOB RUN', accent: '#a3e635', mood: 'runner',
    desc: 'Saute. Baisse-toi. Vite.', controls: 'A sauter · B duck',
    keys: "Espace / K",
    hint: 'A = sauter (maintiens pour monter plus haut) · B = se baisser',
    unit: 'm', ranks: [900, 550, 320, 150, 0],
  };

  constructor(engine: EngineLike) {
    super(engine);
    this.blob.x = PX; this.blob.y = GY - 22; this.blob.r = 22;
    this.blob.trailOn = false;
    this.vy = 0;
    this.onGround = true;
    this.coyote = 0;
    this.buffer = 0;
    this.duck = 0;           // 0..1
    this.speed = 380;
    this.dist = 0;
    this.obs = [];
    this.spawnGap = 500;
    this.milestone = 250;
    this.bgDots = [];
    for (let i = 0; i < 40; i++) this.bgDots.push({ x: Math.random() * 1280, y: Math.random() * 560, z: 0.2 + Math.random() * 0.6 });
    this.tickOff = 0;
  }

  meters(): number { return this.dist / 45; }
  r(): number { return 22 - this.duck * 9; }

  update(dt: number): void {
    if (this.baseUpdate(dt)) return;
    const b = this.blob, I = this.input;

    this.speed = Math.min(780, 380 + this.meters() * 1.15);
    this.dist += this.speed * dt;

    // duck
    const wantDuck = I.down('b') && this.onGround;
    this.duck += ((wantDuck ? 1 : 0) - this.duck) * Math.min(1, dt * 18);
    b.r = this.r();

    // saut : buffer + coyote + hauteur variable
    if (I.pressed('a')) this.buffer = 0.12;
    this.buffer = Math.max(0, this.buffer - dt);
    this.coyote = Math.max(0, this.coyote - dt);
    if (this.buffer > 0 && (this.onGround || this.coyote > 0)) {
      this.buffer = 0; this.coyote = 0;
      this.onGround = false;
      this.vy = -1060;
      this.audio.jump();
      this.input.rumble(0.18, 0.05);
      this.fx.burst(PX, GY - this.duck * 9, { n: 6, speed: [40, 160], colors: ['#8fa3ad', '#d7e3ea'], size: [2, 4], life: 0.35, ang: Math.PI / 2, spread: 2.4 });
    }

    // gravité
    const prevFeet = b.y + b.r;
    let g = 2850;
    if (this.vy < 0 && I.down('a')) g *= 0.52;          // maintien = saut plus haut
    if (I.down('b') && !this.onGround) g += 5200;       // fast-fall
    this.vy += g * dt;
    b.y += this.vy * dt;

    // supports : sol + blocs
    const wasGround = this.onGround;
    this.onGround = false;
    let supportY = GY;
    if (b.y + b.r >= GY) { this.onGround = true; supportY = GY; }
    for (const o of this.obs as any[]) {
      if (o.type !== 'block') continue;
      if (PX + b.r * 0.7 < o.x || PX - b.r * 0.7 > o.x + o.w) continue;
      const feet = b.y + b.r;
      if (this.vy >= 0 && prevFeet <= o.y + 6 && feet >= o.y) {
        this.onGround = true; supportY = o.y;
      }
    }
    if (this.onGround) {
      b.y = supportY - b.r;
      if (this.vy > 260) {
        // atterrissage marqué
        b.punch(0.45);
        this.audio.land();
        this.input.rumble(0.22, 0.05);
        this.fx.shake(0.12);
        this.fx.burst(PX, supportY, { n: 8, speed: [50, 220], colors: ['#8fa3ad', '#d7e3ea'], size: [2, 4], life: 0.4, ang: -Math.PI / 2, spread: 2.6 });
      }
      this.vy = 0;
      if (!wasGround) this.coyote = 0.09;
    } else if (wasGround) {
      this.coyote = 0.09;
    }

    // défilement obstacles
    for (const o of this.obs) {
      o.x -= this.speed * dt;
      if (o.type === 'saw') { o.x -= 115 * dt; o.ang += dt * 9; }
    }
    this.obs = this.obs.filter((o: any) => o.x + (o.w || 60) > -80);

    // spawn
    this.spawnGap -= this.speed * dt;
    if (this.spawnGap <= 0) this.spawnPattern();

    // collisions
    if (this.state === 'play') this.checkHits();

    // jalons
    if (this.meters() >= this.milestone) {
      this.fx.text(640, 240, Math.floor(this.meters()) + ' m !', { color: this.accent, size: 30 });
      this.audio.milestone();
      this.musicEvent('waveComplete', 0.35);
      this.fx.flash(this.accent, 0.06);
      this.milestone += 250;
    }

    // fond
    for (const d of this.bgDots) {
      d.x -= this.speed * (0.15 + d.z * 0.35) * dt;
      if (d.x < -4) { d.x = 1284; d.y = Math.random() * 560; }
    }
    this.tickOff = (this.tickOff + this.speed * dt) % 80;

    // lignes de vitesse
    if (this.speed > 560 && Math.random() < 0.5) {
      this.fx.parts.push({
        x: 1300, y: Math.random() * 720, vx: -this.speed * 1.6, vy: 0,
        life: 0.3, maxLife: 0.3, size: 2, color: '#ffffff', drag: 1, grav: 0, shape: 'spark', rot: 0, vr: 0,
      });
    }

    b.vx = this.speed;
    b.vy = this.vy;
    b.scared = false;
    b.update(dt);

    this.fx.zoom = 1 - Math.min(0.11, Math.max(0, (this.speed - 400) * 0.00028));
  }

  spawnPattern(): void {
    const m = this.meters();
    const pool = [];
    pool.push('s1');
    if (m > 90) pool.push('s2', 'block');
    if (m > 200) pool.push('s3', 'bar', 'saw', 'blockSpike');
    if (m > 380) pool.push('combo1', 'combo2', 'stairs');
    const p = pool[(Math.random() * pool.length) | 0];
    let x = 1340;
    const push = (o: any) => { o.x = x; this.obs.push(o); x += o.w ?? 60; };
    if (p === 's1') push({ type: 'spike', w: 36, h: 36 });
    else if (p === 's2') { push({ type: 'spike', w: 36, h: 36 }); push({ type: 'spike', w: 36, h: 36 }); }
    else if (p === 's3') { for (let i = 0; i < 3; i++) push({ type: 'spike', w: 36, h: 36 }); }
    else if (p === 'block') push({ type: 'block', w: 60, h: 60 });
    else if (p === 'stairs') { push({ type: 'block', w: 60, h: 60 }); x += 30; push({ type: 'block', w: 60, h: 120 }); }
    else if (p === 'blockSpike') { push({ type: 'block', w: 70, h: 60 }); push({ type: 'spike', w: 36, h: 36, base: 60 }); }
    else if (p === 'bar') this.obs.push({ type: 'bar', x: 1340, y: GY - 66, w: 92, h: 30 });
    else if (p === 'saw') this.obs.push({ type: 'saw', x: 1340, y: GY - 17, r: 17, ang: 0 });
    else if (p === 'combo1') { push({ type: 'spike', w: 36, h: 36 }); x += 190; push({ type: 'spike', w: 36, h: 36 }); }
    else if (p === 'combo2') { this.obs.push({ type: 'bar', x: 1340, y: GY - 66, w: 92, h: 30 }); x = 1340 + 92 + 260; push({ type: 'spike', w: 36, h: 36 }); }
    const width = x - 1340;
    this.spawnGap = width + this.speed * (0.55 + Math.random() * 0.5) + 90;
  }

  checkHits(): void {
    const b = this.blob, r = b.r;
    for (const o of this.obs) {
      if (o.type === 'spike') {
        const base = o.base || 0;
        const cx = o.x + o.w / 2;
        const bx = cx - o.w * 0.22, by = GY - base - o.h * 0.62, bw = o.w * 0.44, bh = o.h * 0.62;
        if (this.circleRect(PX, b.y, r * 0.82, bx, by, bw, bh)) return this.die();
      } else if (o.type === 'block') {
        const feet = b.y + r;
        const overlapping = PX + r * 0.7 > o.x && PX - r * 0.7 < o.x + o.w;
        if (overlapping && feet > o.y + 8 && b.y - r < o.y + o.h) {
          if (!(this.vy >= 0 && feet - this.vy * (1 / 60) <= o.y + 8)) return this.die();
        }
      } else if (o.type === 'bar') {
        if (this.circleRect(PX, b.y, r * 0.9, o.x, o.y, o.w, o.h)) return this.die();
      } else if (o.type === 'saw') {
        if (Math.hypot(PX - o.x, b.y - o.y) < r * 0.9 + o.r * 0.85) return this.die();
      }
    }
  }

  circleRect(cx: number, cy: number, cr: number, x: number, y: number, w: number, h: number): boolean {
    const nx = Math.max(x, Math.min(cx, x + w));
    const ny = Math.max(y, Math.min(cy, y + h));
    return Math.hypot(cx - nx, cy - ny) < cr;
  }

  die(): void {
    if (this.state === 'over') return;
    this.audio.explode(1.4);
    this.input.rumble(1, 0.35);
    this.fx.shake(0.9);
    this.fx.stop(0.12);
    this.fx.burst(PX, this.blob.y, { n: 26, speed: [100, 520], colors: [this.accent, '#ffffff', '#ff5470'], size: [2, 6], life: 0.7 });
    this.fx.ring(PX, this.blob.y, { r0: 10, r1: 110, color: this.accent, life: 0.4 });
    this.blob.dead = true;
    this.score = this.meters();
    this.over();
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#0a0f07';
    ctx.fillRect(0, 0, 1280, 720);

    this.fx.world(ctx);

    ctx.fillStyle = '#9fd8a8';
    for (const d of this.bgDots) {
      ctx.globalAlpha = 0.06 + d.z * 0.12;
      ctx.fillRect(d.x, d.y, 2.5, 2.5);
    }
    ctx.globalAlpha = 1;

    // sol
    ctx.strokeStyle = this.accent;
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(0, GY); ctx.lineTo(1280, GY); ctx.stroke();
    ctx.strokeStyle = this.accent + '44';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = -this.tickOff; x < 1280; x += 80) { ctx.moveTo(x, GY); ctx.lineTo(x - 14, GY + 12); }
    ctx.stroke();
    ctx.fillStyle = '#0f150a';
    ctx.fillRect(0, GY + 2, 1280, 720 - GY);

    // obstacles
    for (const o of this.obs) {
      if (o.type === 'spike') {
        const base = o.base || 0;
        ctx.fillStyle = '#ff5470';
        ctx.beginPath();
        ctx.moveTo(o.x, GY - base);
        ctx.lineTo(o.x + o.w / 2, GY - base - o.h);
        ctx.lineTo(o.x + o.w, GY - base);
        ctx.closePath();
        ctx.fill();
      } else if (o.type === 'block') {
        ctx.fillStyle = '#1a2612';
        ctx.strokeStyle = this.accent;
        ctx.lineWidth = 2;
        UI.roundRect(ctx, o.x, GY - o.h, o.w, o.h, 6);
        ctx.fill(); ctx.stroke();
      } else if (o.type === 'bar') {
        ctx.fillStyle = '#ff5470';
        ctx.shadowColor = '#ff5470'; ctx.shadowBlur = 12;
        UI.roundRect(ctx, o.x, o.y, o.w, o.h, 8);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#ffffff55';
        ctx.beginPath();
        ctx.moveTo(o.x + 10, o.y + o.h); ctx.lineTo(o.x + 10, o.y + o.h + 14);
        ctx.moveTo(o.x + o.w - 10, o.y + o.h); ctx.lineTo(o.x + o.w - 10, o.y + o.h + 14);
        ctx.stroke();
      } else if (o.type === 'saw') {
        ctx.save();
        ctx.translate(o.x, o.y);
        ctx.rotate(o.ang);
        ctx.fillStyle = '#ff5470';
        ctx.beginPath();
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * 6.2832;
          const rr = i % 2 === 0 ? o.r : o.r * 0.72;
          i === 0 ? ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr) : ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
        }
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#0a0f07';
        ctx.beginPath(); ctx.arc(0, 0, 4, 0, 6.2832); ctx.fill();
        ctx.restore();
      }
    }

    this.blob.render(ctx);
    this.fx.drawWorld(ctx);
    this.fx.endWorld(ctx);

    // HUD
    UI.txt(ctx, Math.floor(this.meters()) + ' m', 640, 62, { size: 42, align: 'center', mono: true, weight: 700, shadow: true });
    UI.txt(ctx, 'RECORD ' + UI.getBest(this.meta.id) + ' m', 640, 88, { size: 14, align: 'center', color: '#7c8698' });
    UI.txt(ctx, Math.round(this.speed) + ' px/s', 1252, 44, { size: 15, align: 'right', color: '#5f6b52', mono: true });
    this.drawCommon(ctx);
  }
}
