// SURVIBLOB — arène, esquive au stick, dash qui traverse les chasseurs.
// Chaque spawn est télégraphié, chaque impact est éxagéré (hitstop, shake, rumble).

import { BaseGame } from '../core/game';
import * as UI from '../core/ui';
import type { EngineLike, GameMeta } from '../core/types';

const M = 70; // marge arène
const AW = 1280 - M * 2, AH = 720 - M * 2;

export class SurvivalGame extends BaseGame {
  [key: string]: any;
  static meta: GameMeta = {
    id: 'surv', name: 'SURVIBLOB', accent: '#34d399', mood: 'survival',
    desc: 'Esquive. Dash. Répète.', controls: 'Stick bouger · A dash',
    keys: "ZQSD / Flèches + Espace",
    hint: 'Bouge avec le stick · A = dash (traverse les chasseurs)',
    unit: 'pts', ranks: [2500, 1200, 600, 250, 0],
  };

  constructor(engine: EngineLike) {
    super(engine);
    this.blob.x = 640; this.blob.y = 360; this.blob.r = 21;
    this.blob.trailOn = true;
    this.dashT = 0; this.dashCd = 0; this.dashDir = [1, 0];
    this.enemies = [];
    this.bullets = [];
    this.telegraphs = [];
    this.orbs = [];
    this.spawnT = 1.2;
    this.orbT = 3;
    this.orbChain = 0; this.orbChainT = 0;
    this.coinStep = 0;
    this.facing = [1, 0];
  }

  spawnPoint(): [number, number] {
    const side = (Math.random() * 4) | 0;
    const p = 0.15 + Math.random() * 0.7;
    if (side === 0) return [M + AW * p, M + 30];
    if (side === 1) return [M + AW * p, M + AH - 30];
    if (side === 2) return [M + 30, M + AH * p];
    return [M + AW - 30, M + AH * p];
  }

  spawnWave(): void {
    const t = this.time;
    const r = Math.random();
    let type = 'chaser';
    if (t > 14 && r < 0.28) type = 'mine';
    else if (t > 28 && r < 0.5) type = 'gunner';
    const [x, y] = this.spawnPoint();
    this.telegraphs.push({ x, y, t: 0.6, type });
    this.musicEvent('waveStart', 0.35);
  }

  realize(tg: any): void {
    const mul = 1 + this.time * 0.009;
    if (tg.type === 'chaser') {
      this.enemies.push({ kind: 'chaser', x: tg.x, y: tg.y, vx: 0, vy: 0, r: 15, sp: 130 * mul, rot: 0 });
    } else if (tg.type === 'mine') {
      this.enemies.push({ kind: 'mine', x: tg.x, y: tg.y, r: 14, arm: 2.2, pulse: 0 });
    } else {
      this.enemies.push({ kind: 'gunner', x: tg.x, y: tg.y, r: 17, st: 'in', t: 0.7, shots: 3, burst: 0, bt: 0, ang: 0 });
    }
  }

  update(dt: number): void {
    if (this.baseUpdate(dt)) return;
    const b = this.blob, I = this.input;

    // --- dash ---
    this.dashCd = Math.max(0, this.dashCd - dt);
    if ((I.pressed('a') || I.pressed('rb')) && this.dashCd <= 0 && this.dashT <= 0) {
      let dx = I.moveX, dy = I.moveY;
      if (!dx && !dy) { dx = this.facing[0]; dy = this.facing[1]; }
      const l = Math.hypot(dx, dy) || 1;
      this.dashDir = [dx / l, dy / l];
      this.dashT = 0.16; this.dashCd = 0.85;
      this.audio.dash();
      this.input.rumble(0.45, 0.1);
      this.fx.ring(b.x, b.y, { r0: 10, r1: 55, color: this.accent, life: 0.25 });
      this.fx.burst(b.x, b.y, { n: 10, speed: [60, 260], colors: [this.accent, '#ffffff'], life: 0.4, ang: Math.atan2(-dy, -dx), spread: 1.2 });
    }

    // --- mouvement ---
    if (this.dashT > 0) {
      this.dashT -= dt;
      b.vx = this.dashDir[0] * 1150;
      b.vy = this.dashDir[1] * 1150;
      this.fx.burst(b.x, b.y, { n: 2, speed: [10, 60], colors: [this.accent], size: [3, 6], life: 0.3, shape: 'dot' });
    } else {
      this.steer(dt, b, I.moveX, I.moveY, 440, 9);
      if (Math.hypot(I.moveX, I.moveY) > 0.2) this.facing = [I.moveX, I.moveY];
    }
    b.x += b.vx * dt; b.y += b.vy * dt;
    b.x = Math.max(M + b.r, Math.min(1280 - M - b.r, b.x));
    b.y = Math.max(M + b.r, Math.min(720 - M - b.r, b.y));
    b.update(dt);

    // --- spawns ---
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnWave();
      this.spawnT = Math.max(0.55, 2.1 - this.time * 0.028);
    }
    for (const tg of this.telegraphs) tg.t -= dt;
    this.telegraphs = this.telegraphs.filter((tg: any) => {
      if (tg.t <= 0) { this.realize(tg); return false; }
      return true;
    });

    // --- ennemis ---
    const dashing = this.dashT > 0;
    for (const e of this.enemies) {
      if (e.kind === 'chaser') {
        const dx = b.x - e.x, dy = b.y - e.y;
        const l = Math.hypot(dx, dy) || 1;
        e.vx += (dx / l) * 420 * dt; e.vy += (dy / l) * 420 * dt;
        const sp = Math.hypot(e.vx, e.vy);
        if (sp > e.sp) { e.vx *= e.sp / sp; e.vy *= e.sp / sp; }
        e.x += e.vx * dt; e.y += e.vy * dt;
        e.rot = Math.atan2(e.vy, e.vx);
        if (dashing && Math.hypot(b.x - e.x, b.y - e.y) < e.r + b.r + 4) {
          e.dead = true;
          this.score += 25;
          this.musicEvent('enemyKilled', 0.7);
          this.boom(e.x, e.y, '#ff5470', 0.5);
          this.fx.text(e.x, e.y - 24, '+25', { color: '#ffd166', size: 20, mono: true });
        } else if (Math.hypot(b.x - e.x, b.y - e.y) < e.r + b.r - 4) {
          this.die();
        }
      } else if (e.kind === 'mine') {
        e.arm -= dt;
        e.pulse += dt * 6;
        if (e.arm <= 0 || Math.hypot(b.x - e.x, b.y - e.y) < e.r + b.r + 2) {
          e.dead = true;
          this.boom(e.x, e.y, '#fb923c', 0.7);
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * 6.2832 + e.pulse * 0.1;
            this.bullets.push({ x: e.x, y: e.y, vx: Math.cos(a) * 240, vy: Math.sin(a) * 240, r: 6 });
          }
        }
      } else { // gunner
        e.t -= dt;
        if (e.st === 'in') {
          if (e.t <= 0) { e.st = 'aim'; e.t = 0.45; e.ang = Math.atan2(b.y - e.y, b.x - e.x); }
        } else if (e.st === 'aim') {
          if (e.t <= 0) {
            e.st = 'shoot'; e.t = 0.9; e.burst = 3; e.bt = 0;
          }
        } else if (e.st === 'shoot') {
          e.bt -= dt;
          if (e.bt <= 0 && e.burst > 0) {
            e.burst--; e.bt = 0.22;
            const a = e.ang;
            this.bullets.push({ x: e.x + Math.cos(a) * 20, y: e.y + Math.sin(a) * 20, vx: Math.cos(a) * 265, vy: Math.sin(a) * 265, r: 6 });
            this.audio.shoot();
          }
          if (e.burst <= 0 && e.t <= 0) { e.st = 'aim2'; e.t = 0.5; e.ang = Math.atan2(b.y - e.y, b.x - e.x); if (this.time > 60) { e.burst = 3; e.st = 'shoot'; e.bt = 0.2; } }
          else if (e.t <= 0 && e.burst > 0) { e.st = 'aim2'; e.t = 0.4; e.ang = Math.atan2(b.y - e.y, b.x - e.x); }
        } else { // aim2 → repart
          if (e.t <= 0) {
            if (e.burst > 0) { e.st = 'shoot'; e.t = 0.9; e.bt = 0; }
            else { e.st = 'leave'; e.t = 1; e.leaveA = e.ang; }
          }
        }
        if (e.st === 'leave') {
          e.x += Math.cos(e.leaveA) * 160 * dt;
          e.y += Math.sin(e.leaveA) * 160 * dt;
          if (e.x < -40 || e.x > 1320 || e.y < -40 || e.y > 760) e.dead = true;
        }
        if (Math.hypot(b.x - e.x, b.y - e.y) < e.r + b.r - 4) this.die();
      }
    }
    this.enemies = this.enemies.filter((e: any) => !e.dead);

    // --- balles ---
    for (const p of this.bullets) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (Math.hypot(b.x - p.x, b.y - p.y) < p.r + b.r - 4) { this.die(); }
      if (p.x < -20 || p.x > 1300 || p.y < -20 || p.y > 740) p.dead = true;
    }
    this.bullets = this.bullets.filter((p: any) => !p.dead);

    // --- orbes ---
    this.orbT -= dt;
    if (this.orbT <= 0) {
      this.orbT = 4.2;
      this.orbs.push({ x: M + 60 + Math.random() * (AW - 120), y: M + 60 + Math.random() * (AH - 120), t: Math.random() * 6 });
    }
    this.orbChainT = Math.max(0, this.orbChainT - dt);
    if (this.orbChainT <= 0) this.coinStep = 0;
    for (const o of this.orbs) {
      o.t += dt;
      if (Math.hypot(b.x - o.x, b.y - o.y) < b.r + 16) {
        o.dead = true;
        this.coinStep++;
        this.score += 50;
        this.musicEvent('powerUp', 0.5);
        this.audio.coin(this.coinStep);
        this.fx.burst(o.x, o.y, { n: 10, speed: [50, 220], colors: ['#7df9ff', '#ffffff'], life: 0.4 });
        this.fx.text(o.x, o.y - 20, '+50', { color: '#7df9ff', size: 18, mono: true });
        this.input.rumble(0.2, 0.06);
      }
    }
    this.orbs = this.orbs.filter((o: any) => !o.dead);

    this.score += dt * 10;

    // regard effrayé si menace proche
    let near = 1e9;
    for (const e of this.enemies) near = Math.min(near, Math.hypot(b.x - e.x, b.y - e.y));
    for (const p of this.bullets) near = Math.min(near, Math.hypot(b.x - p.x, b.y - p.y));
    b.scared = near < 110;

    this.fx.zoom = 1;
  }

  boom(x: number, y: number, color: string, power = 1): void {
    this.audio.explode(power);
    this.input.rumble(Math.min(1, 0.4 + power * 0.3), 0.15);
    this.fx.shake(0.3 + power * 0.2);
    this.fx.burst(x, y, { n: Math.round(16 * power), speed: [80, 420 * power], colors: [color, '#ffffff', '#ffd166'], size: [2, 5], life: 0.55 });
    this.fx.ring(x, y, { r0: 8, r1: 60 * power + 30, color, life: 0.32 });
    this.fx.stop(0.03);
  }

  die(): void {
    if (this.state === 'over') return;
    this.boom(this.blob.x, this.blob.y, this.accent, 1.4);
    this.blob.dead = true;
    this.over();
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#07110d';
    ctx.fillRect(0, 0, 1280, 720);

    this.fx.world(ctx);

    // arène
    ctx.strokeStyle = this.accent + '55';
    ctx.lineWidth = 2;
    UI.roundRect(ctx, M, M, AW, AH, 24);
    ctx.stroke();
    UI.grid(ctx, { gap: 80, alpha: 0.04, color: '#7df9cc' });

    // télégraphes
    for (const tg of this.telegraphs) {
      const blink = Math.sin(tg.t * 30) > 0 ? 0.9 : 0.3;
      ctx.globalAlpha = blink;
      ctx.strokeStyle = tg.type === 'chaser' ? '#ff5470' : tg.type === 'mine' ? '#fb923c' : '#38bdf8';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(tg.x, tg.y, 14 + tg.t * 18, 0, 6.2832);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(tg.x - 6, tg.y); ctx.lineTo(tg.x + 6, tg.y);
      ctx.moveTo(tg.x, tg.y - 6); ctx.lineTo(tg.x, tg.y + 6);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // orbes
    for (const o of this.orbs) {
      const r = 10 + Math.sin(o.t * 4) * 2.5;
      ctx.shadowColor = '#7df9ff';
      ctx.shadowBlur = 16;
      ctx.fillStyle = '#7df9ff';
      ctx.beginPath();
      ctx.arc(o.x, o.y + Math.sin(o.t * 3) * 4, r, 0, 6.2832);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // ennemis
    for (const e of this.enemies) {
      if (e.kind === 'chaser') {
        ctx.save();
        ctx.translate(e.x, e.y);
        ctx.rotate(e.rot);
        ctx.fillStyle = '#ff5470';
        ctx.beginPath();
        ctx.moveTo(16, 0); ctx.lineTo(-11, 10); ctx.lineTo(-11, -10);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else if (e.kind === 'mine') {
        const armed = e.arm < 0.8;
        const blink = armed && Math.sin(e.pulse * 3) > 0;
        ctx.strokeStyle = blink ? '#ffffff' : '#fb923c';
        ctx.fillStyle = blink ? '#fb923c' : '#fb923c55';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r, 0, 6.2832);
        ctx.fill(); ctx.stroke();
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * 6.2832 + e.pulse * 0.4;
          ctx.beginPath();
          ctx.moveTo(e.x + Math.cos(a) * (e.r + 2), e.y + Math.sin(a) * (e.r + 2));
          ctx.lineTo(e.x + Math.cos(a) * (e.r + 8), e.y + Math.sin(a) * (e.r + 8));
          ctx.stroke();
        }
      } else {
        const tel = e.st === 'aim' || e.st === 'aim2';
        if (tel) {
          ctx.globalAlpha = 0.35 + 0.3 * Math.sin(this.time * 40);
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(e.x, e.y);
          ctx.lineTo(e.x + Math.cos(e.ang) * 900, e.y + Math.sin(e.ang) * 900);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        ctx.save();
        ctx.translate(e.x, e.y);
        ctx.rotate(e.ang);
        ctx.fillStyle = tel ? '#bfe9ff' : '#38bdf8';
        ctx.fillRect(-13, -13, 26, 26);
        ctx.fillStyle = '#0b0e14';
        ctx.fillRect(10, -3, 10, 6);
        ctx.restore();
      }
    }

    // balles
    ctx.shadowColor = '#ff8896';
    ctx.shadowBlur = 8;
    ctx.fillStyle = '#ff5470';
    for (const p of this.bullets) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, 6.2832);
      ctx.fill();
    }
    ctx.shadowBlur = 0;

    // cooldown dash (anneau autour du blob)
    if (this.dashCd > 0 && this.state === 'play') {
      ctx.strokeStyle = '#ffffff55';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(this.blob.x, this.blob.y, this.blob.r + 9, -1.5708, -1.5708 + (1 - this.dashCd / 0.85) * 6.2832);
      ctx.stroke();
    }

    this.blob.render(ctx);
    this.fx.drawWorld(ctx);
    this.fx.endWorld(ctx);

    UI.drawHUD(ctx, {
      accent: this.accent,
      score: this.score,
      time: this.time,
      extra: () => UI.txt(ctx, 'DASH: A', 28, 70, { size: 13, color: '#7c8698' }),
    });
    this.drawCommon(ctx);
  }
}

