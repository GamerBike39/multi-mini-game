// BLOB BREAKER — casse-briques : paddle-blob en bas, balle-blob qui rebondit,
// grille 10×6, drops (MULTI / LARGE / SLOW), combo à pitch montant.
// Tout est dessiné au canvas, tous les sons sont synthétisés.

import { BaseGame } from '../core/game';
import { Blob } from '../core/blob';
import * as UI from '../core/ui';
import type { EngineLike, GameMeta } from '../core/types';

const WALL = 20;             // marge de jeu (murs latéraux + plafond)
const PAD_Y = 660;           // y du paddle
const COLS = 10, ROWS = 6;
const BW = 100, BH = 24;     // brique
const BX0 = 86, BY0 = 90, GX = 112, GY = 33; // grille dans la zone x 80..1200, y 90..280
const PTS = [50, 40, 30, 20, 15, 10];
const PAL = ['#fb7185', '#f472b6', '#c084fc', '#818cf8', '#38bdf8', '#34d399'];
const PALD = ['#6b2434', '#66284a', '#4a2a63', '#333a6b', '#1c4a66', '#1a5a42']; // teintes sombres (brique abîmée)
const DCOL: Record<string, string> = { MULTI: '#7dd3fc', LARGE: '#34d399', SLOW: '#c084fc' };

export class BreakerGame extends BaseGame {
  [key: string]: any;
  static meta: GameMeta = {
    id: 'breaker', name: 'BLOB BREAKER', accent: '#fb7185', mood: 'shooter',
    desc: 'Casse tout au blob-rebond', controls: 'Stick G / ZQSD paddle · A lancer',
    keys: "ZQSD + Espace",
    hint: 'A = lancer la balle · bouge le paddle · attrape les drops',
    unit: 'pts', ranks: [5000, 3000, 1500, 600, 0],
  };

  constructor(engine: EngineLike) {
    super(engine);
    this.pad = { x: 640, y: PAD_Y, vx: 0, vy: 0 };
    this.padW = 110;
    this.largeT = 0;
    // la balle principale EST le blob de BaseGame
    this.blob.r = 9; this.blob.trailOn = true;
    this.blob.x = 640; this.blob.y = PAD_Y - 26;
    this.balls = [this.blob];
    this.stuck = true;
    this.lives = 3;
    this.level = 1;
    this.baseSpd = 430;
    this.speed = 430;
    this.broken = 0;
    this.comboStep = 0; this.comboT = 0;
    this.slowT = 0;
    this.drops = [];
    this.bricks = [];
    this.buildBricks();
  }

  buildBricks(): void {
    this.bricks = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const hp = this.level >= 2 && r < 2 ? 2 : 1; // niveaux 2+ : 2 rangées hautes blindées
        this.bricks.push({ x: BX0 + c * GX, y: BY0 + r * GY, w: BW, h: BH, hp, maxHp: hp, pts: PTS[r], color: PAL[r], dark: PALD[r], fl: 0 });
      }
    }
  }

  // renormalise la vitesse de toutes les balles actives (après +10 / changement de niveau)
  normSpeed(): void {
    for (const b of this.balls) {
      if (this.stuck && b === this.balls[0]) continue;
      const l = Math.hypot(b.vx, b.vy) || 1;
      b.vx *= this.speed / l; b.vy *= this.speed / l;
    }
  }

  launch(): void {
    const b = this.balls[0];
    const a = (Math.random() * 2 - 1) * (Math.PI / 9); // ±20° autour de la verticale
    b.vx = Math.sin(a) * this.speed;
    b.vy = -Math.cos(a) * this.speed;
    this.stuck = false;
    this.audio.jump();
    this.input.rumble(0.12, 0.05);
    this.fx.burst(b.x, b.y, { n: 8, speed: [40, 200], colors: [this.accent, '#ffffff'], life: 0.35 });
  }

  resetBall(): void {
    const b = new Blob({ x: this.pad.x, y: PAD_Y - 26, r: 9, color: this.accent });
    b.trailOn = true;
    this.balls = [b];
    this.blob = b;
    this.stuck = true;
  }

  hitBrick(br: any, bl: any): void {
    const cx = br.x + br.w / 2, cy = br.y + br.h / 2;
    br.hp--;
    if (br.hp > 0) {
      // juste endommagée : flash + teinte sombre au prochain rendu
      br.fl = 0.16;
      bl.punch(0.15);
      this.audio.hitEnemy();
      this.fx.burst(cx, cy, { n: 6, speed: [40, 180], colors: [br.color, '#ffffff'], size: [1.5, 3.5], life: 0.35 });
      return;
    }
    // cassée
    this.broken++;
    this.speed = Math.min(720, this.speed + 10);
    this.normSpeed();
    this.score += br.pts;
    this.comboStep++; this.comboT = 1.2;
    this.musicEvent('brickCombo', Math.min(1.4, 0.45 + this.comboStep * 0.04));
    if (this.comboStep >= 4) this.musicEvent('combo', Math.min(1.5, this.comboStep / 10));
    this.audio.coin(this.comboStep);
    if (this.comboStep % 8 === 0) {
      this.fx.stop(0.03);
      this.fx.text(cx, cy - 34, 'COMBO ×' + this.comboStep, { color: '#ffd166', size: 19 });
    }
    bl.punch(0.35);
    this.fx.shake(0.1);
    this.input.rumble(0.15, 0.05);
    this.fx.burst(cx, cy, { n: 14, speed: [60, 320], colors: [br.color, '#ffffff', this.accent], size: [2, 5], life: 0.5 });
    this.fx.ring(cx, cy, { r0: 6, r1: 42, color: br.color, life: 0.3 });
    this.fx.text(cx, cy - 12, '+' + br.pts, { color: br.color, size: 15, mono: true });
    if (Math.random() < 0.08) {
      const kinds = ['MULTI', 'LARGE', 'SLOW'];
      this.drops.push({ x: cx, y: cy, kind: kinds[(Math.random() * 3) | 0] });
    }
  }

  nextLevel(): void {
    this.level++;
    this.musicEvent('waveComplete', 0.8);
    this.audio.milestone();
    this.fx.flash(this.accent, 0.15);
    this.fx.text(640, 330, 'NIVEAU ' + this.level, { color: this.accent, size: 42, life: 1.4 });
    this.buildBricks();
    this.baseSpd += 30;
    this.speed = this.baseSpd;
    this.broken = 0;
    this.normSpeed();
  }

  applyDrop(kind: any): void {
    const px = this.pad.x, py = PAD_Y - 26;
    this.audio.good();
    this.musicEvent('powerUp', 0.7);
    this.fx.flash(this.accent, 0.1);
    this.input.rumble(0.2, 0.06);
    this.fx.burst(px, py, { n: 12, colors: [DCOL[kind], '#ffffff'], life: 0.4 });
    this.fx.ring(px, py, { r0: 8, r1: 46, color: DCOL[kind], life: 0.3 });
    if (kind === 'MULTI') {
      for (const b of [...this.balls]) {
        if (this.balls.length >= 3) break;
        const nb = new Blob({ x: b.x, y: b.y, r: 9, color: this.accent });
        nb.trailOn = true;
        if (this.stuck && b === this.balls[0]) {
          const a = (Math.random() - 0.5) * 0.7;
          nb.vx = Math.sin(a) * this.speed; nb.vy = -Math.cos(a) * this.speed;
        } else {
          const a = Math.atan2(b.vy, b.vx) + 0.45;
          nb.vx = Math.cos(a) * this.speed; nb.vy = Math.sin(a) * this.speed;
        }
        this.balls.push(nb);
      }
    } else if (kind === 'LARGE') {
      this.largeT = 12;
    } else {
      this.slowT = 4;
    }
    this.fx.text(px, py - 14, kind, { color: DCOL[kind], size: 20 });
  }

  wallHit(bl: any): void {
    bl.punch(0.1);
    this.audio.tone({ f: 190, dur: 0.03, vol: 0.05, type: 'sine' });
  }

  update(dt: number): void {
    if (this.baseUpdate(dt)) return;
    const I = this.input, pad = this.pad;
    // temps réel (hors slow-mo) pour les minuteurs de bonus / combo
    const rdt = this.fx.timeScale > 0 ? dt / this.fx.timeScale : dt;

    // --- paddle (piloté en temps réel : le SLOW ralentit la balle, pas le joueur)
    this.padW += ((this.largeT > 0 ? 170 : 110) - this.padW) * Math.min(1, rdt * 8);
    this.steer(rdt, pad, I.moveX, 0, 900, 8);
    pad.x += pad.vx * rdt;
    const half = this.padW / 2;
    if (pad.x < WALL + half) { pad.x = WALL + half; pad.vx = 0; }
    if (pad.x > 1280 - WALL - half) { pad.x = 1280 - WALL - half; pad.vx = 0; }

    // --- minuteurs
    this.largeT = Math.max(0, this.largeT - rdt);
    this.comboT = Math.max(0, this.comboT - rdt);
    if (this.comboT <= 0) this.comboStep = 0;
    if (this.slowT > 0) { this.slowT -= rdt; this.fx.timeScale = 0.6; }
    else if (this.fx.timeScale < 1) this.fx.timeScale = Math.min(1, this.fx.timeScale + rdt * 0.5);

    // --- lancer
    if (this.stuck && I.pressed('a')) this.launch();

    // --- balles-blobs
    for (const bl of this.balls) {
      if (this.stuck && bl === this.balls[0]) {
        bl.x = pad.x; bl.y = PAD_Y - 9 - bl.r - 4;
        bl.vx = pad.vx * 0.5; bl.vy = 0;
      } else {
        bl.x += bl.vx * dt; bl.y += bl.vy * dt;

        // murs latéraux + plafond (réflexion propre)
        if (bl.x - bl.r < WALL) { bl.x = WALL + bl.r; bl.vx = Math.abs(bl.vx); this.wallHit(bl); }
        else if (bl.x + bl.r > 1280 - WALL) { bl.x = 1280 - WALL - bl.r; bl.vx = -Math.abs(bl.vx); this.wallHit(bl); }
        if (bl.y - bl.r < WALL) { bl.y = WALL + bl.r; bl.vy = Math.abs(bl.vy); this.wallHit(bl); }

        // paddle : l'angle de renvoi dépend du point d'impact ±60° + vitesse horizontale
        if (bl.vy > 0 && Math.abs(bl.x - pad.x) < half + bl.r * 0.8 &&
            bl.y + bl.r >= PAD_Y - 9 && bl.y - bl.r <= PAD_Y + 9) {
          const rel = Math.max(-1, Math.min(1, (bl.x - pad.x) / half));
          let a = rel * (Math.PI / 3) + pad.vx * 0.0006;
          a = Math.max(-1.25, Math.min(1.25, a));
          bl.vx = Math.sin(a) * this.speed;
          bl.vy = -Math.cos(a) * this.speed;
          bl.punch(0.25);
          this.audio.land();
          this.fx.burst(bl.x, PAD_Y - 10, { n: 6, speed: [40, 180], colors: [this.accent, '#ffffff'], size: [1.5, 3], life: 0.3, ang: -Math.PI / 2, spread: 1.4 });
        }

        // briques : cercle vs AABB, renvoi sur l'axe de moindre pénétration
        for (const br of this.bricks) {
          if (br.hp <= 0) continue;
          const nx = Math.max(br.x, Math.min(bl.x, br.x + br.w));
          const ny = Math.max(br.y, Math.min(bl.y, br.y + br.h));
          const dx = bl.x - nx, dy = bl.y - ny;
          if (dx * dx + dy * dy > bl.r * bl.r) continue;
          const bcx = br.x + br.w / 2, bcy = br.y + br.h / 2;
          const ox = br.w / 2 + bl.r - Math.abs(bl.x - bcx);
          const oy = br.h / 2 + bl.r - Math.abs(bl.y - bcy);
          if (ox < oy) { bl.vx = bl.x < bcx ? -Math.abs(bl.vx) : Math.abs(bl.vx); bl.x += bl.vx > 0 ? ox : -ox; }
          else { bl.vy = bl.y < bcy ? -Math.abs(bl.vy) : Math.abs(bl.vy); bl.y += bl.vy > 0 ? oy : -oy; }
          this.hitBrick(br, bl);
          break;
        }

        // anti-trajectoire trop horizontale
        if (Math.abs(bl.vy) < this.speed * 0.18) bl.vy = (bl.vy >= 0 ? 1 : -1) * this.speed * 0.18;
        // perdue
        if (bl.y > 740) bl.dead = true;
      }
      bl.scared = Math.hypot(bl.vx, bl.vy) > 600;
      bl.update(dt);
    }

    // balles mortes
    const alive = this.balls.filter((b: any) => !b.dead);
    if (alive.length !== this.balls.length) {
      this.balls = alive;
      if (alive.length) this.blob = alive[0];
    }
    if (this.balls.length === 0) {
      this.lives--;
      this.musicEvent('playerHit', 0.8);
      this.audio.hurt();
      this.fx.shake(0.4);
      if (this.lives <= 0) { this.over(); return; }
      this.resetBall();
    }

    // --- drops
    for (const d of this.drops) {
      d.y += 130 * dt;
      if (d.y > 760) d.dead = true;
      else if (Math.abs(d.x - pad.x) < half + 9 && Math.abs(d.y - PAD_Y) < 18) {
        d.dead = true;
        this.applyDrop(d.kind);
      }
    }
    this.drops = this.drops.filter((d: any) => !d.dead);

    // flash d'impact des briques abîmées
    for (const br of this.bricks) if (br.fl > 0) br.fl -= dt;

    // niveau fini ?
    if (this.bricks.every((br: any) => br.hp <= 0)) this.nextLevel();
  }

  drawPaddle(ctx: CanvasRenderingContext2D): void {
    const pad = this.pad, w = this.padW, h = 18;
    const sq = Math.min(1, Math.abs(pad.vx) / 900);
    ctx.save();
    ctx.translate(pad.x, PAD_Y);
    ctx.scale(1 + sq * 0.1 + Math.sin(this.time * 9) * 0.015, 1 - sq * 0.14 + Math.cos(this.time * 9) * 0.01);
    ctx.shadowColor = this.accent;
    ctx.shadowBlur = 16;
    UI.roundRect(ctx, -w / 2, -h / 2, w, h, 9);
    ctx.fillStyle = this.accent;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    UI.roundRect(ctx, -w / 2 + 6, -h / 2 + 3, w - 12, 5, 2.5);
    ctx.fill();
    // yeux qui suivent la balle
    const b0 = this.balls[0];
    const lx = b0 ? Math.max(-1, Math.min(1, (b0.x - pad.x) / 320)) * 2.5 : 0;
    ctx.fillStyle = '#0b0e14';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(s * Math.min(24, w * 0.16) + lx, -2, 2.5, 3.4, 0, 0, 6.2832);
      ctx.fill();
    }
    ctx.restore();
  }

  lifeBlob(ctx: CanvasRenderingContext2D, x: number, y: number, on: boolean): void {
    ctx.globalAlpha = on ? 1 : 0.15;
    ctx.fillStyle = this.accent;
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, 6.2832);
    ctx.fill();
    if (on) {
      ctx.fillStyle = '#0b0e14';
      ctx.beginPath(); ctx.arc(x - 2.6, y - 1.5, 1.4, 0, 6.2832); ctx.fill();
      ctx.beginPath(); ctx.arc(x + 2.6, y - 1.5, 1.4, 0, 6.2832); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  render(ctx: CanvasRenderingContext2D): void {
    // fond
    ctx.fillStyle = '#0a0912';
    ctx.fillRect(0, 0, 1280, 720);

    this.fx.world(ctx);

    UI.grid(ctx, { gap: 64, alpha: 0.04 });

    // cadre de jeu (ouvert en bas)
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(WALL, 720); ctx.lineTo(WALL, WALL);
    ctx.lineTo(1280 - WALL, WALL); ctx.lineTo(1280 - WALL, 720);
    ctx.stroke();

    // briques
    for (const br of this.bricks) {
      if (br.hp <= 0) continue;
      const dark = br.maxHp === 2 && br.hp === 1;
      UI.roundRect(ctx, br.x, br.y, br.w, br.h, 7);
      ctx.fillStyle = br.fl > 0 ? '#ffffff' : dark ? br.dark : br.color;
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.13)';
      UI.roundRect(ctx, br.x + 5, br.y + 4, br.w - 10, 5, 2.5);
      ctx.fill();
    }

    // drops
    for (const d of this.drops) {
      ctx.save();
      ctx.translate(d.x, d.y + Math.sin(this.time * 5 + d.x * 0.03) * 2);
      ctx.rotate(Math.sin(this.time * 3 + d.x) * 0.12);
      ctx.shadowColor = DCOL[d.kind]; ctx.shadowBlur = 12;
      UI.roundRect(ctx, -9, -9, 18, 18, 5);
      ctx.fillStyle = DCOL[d.kind];
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      UI.txt(ctx, d.kind[0], 0, 1, { size: 12, align: 'center', baseline: 'middle', color: '#0b0e14', weight: 900 });
      ctx.restore();
    }

    // paddle-blob
    this.drawPaddle(ctx);

    // anneau d'attente autour de la balle collée
    if (this.stuck && this.balls[0]) {
      const b = this.balls[0];
      ctx.globalAlpha = 0.3 + 0.22 * Math.sin(this.time * 6);
      ctx.strokeStyle = this.accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r + 8 + Math.sin(this.time * 6) * 2, 0, 6.2832);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // balles
    for (const bl of this.balls) bl.render(ctx);

    this.fx.drawWorld(ctx);
    this.fx.endWorld(ctx);

    // HUD
    UI.drawHUD(ctx, {
      accent: this.accent,
      score: this.score,
      unit: this.meta.unit,
      extra: () => {
        for (let i = 0; i < 3; i++) this.lifeBlob(ctx, 36 + i * 25, 38 + Math.sin(this.time * 3 + i) * 1.2, i < this.lives);
        UI.txt(ctx, 'NIV ' + this.level, 24, 76, { size: 13, color: '#7c8698', mono: true });
        if (this.largeT > 0) UI.txt(ctx, 'LARGE ' + Math.ceil(this.largeT) + 's', 24, 96, { size: 13, color: DCOL.LARGE, mono: true });
        if (this.slowT > 0) UI.txt(ctx, 'SLOW ' + Math.ceil(this.slowT) + 's', 24, this.largeT > 0 ? 116 : 96, { size: 13, color: DCOL.SLOW, mono: true });
        if (this.comboStep >= 4) {
          UI.txt(ctx, 'COMBO ×' + this.comboStep, 640, 44, { size: 20 + Math.min(10, this.comboStep * 0.5), align: 'center', color: '#ffd166', weight: 900, shadow: true });
        }
      },
    });

    this.drawCommon(ctx);
  }
}
