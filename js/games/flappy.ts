// FLAPPY BLOB — un bouton, de la gelée, des arches.
// Bat des ailes (A / Espace / Clic), traverse les arches, un contact = game over.
// Nuancier du runner (js/core/jump.ts) : tap = petit battement (~95 px),
// maintien = grand battement (~170 px). Le clic, sans état tenu, tape toujours.
// Difficulté : vitesse +6 px/s et ouverture −2 px par arche, planchers aux deux.
// Textures procédurales (arches rivetées, sol, collines, étoiles) + game feel
// arcade : punch, dust, rings, hitstop, passes parfaites en combo, slow-mo.

import { BaseGame } from '../core/game';
import * as UI from '../core/ui';
import type { EngineLike, GameMeta } from '../core/types';
import {
  advanceJumpAir,
  applyJumpCut,
  createJumpState,
  jumpGravity,
  releaseJump,
  resetJumpAir,
  type JumpState,
  type JumpTuning,
} from '../core/jump';

const TAU = Math.PI * 2;

export const FLAPPY_PX = 400;
export const FLAPPY_R = 20;
export const FLAPPY_GRAVITY = 2600;
export const FLAPPY_FLAP_VY = -780;
export const FLAPPY_MAX_FALL = 1000;
export const FLAPPY_GROUND_Y = 640;
export const FLAPPY_CEIL_Y = 56;
export const FLAPPY_PIPE_W = 96;
export const FLAPPY_SPACING = 390;
export const FLAPPY_GAP_0 = 214;
export const FLAPPY_GAP_MIN = 158;
export const FLAPPY_GAP_STEP = 2;
export const FLAPPY_SPEED_0 = 265;
export const FLAPPY_SPEED_STEP = 6;
export const FLAPPY_SPEED_MAX = 440;

// Nuancier du battement : tap ≈ 95 px, maintien ≈ 170 px.
export const FLAPPY_FLAP: JumpTuning = {
  jumpSpeed: -FLAPPY_FLAP_VY,
  holdGravity: 1500,
  riseGravity: FLAPPY_GRAVITY,
  fallGravity: FLAPPY_GRAVITY,
  fastFallExtra: 0,
  cutSpeed: 560,
  minTime: 0.05,
  holdTime: 0.2,
  coyoteTime: 0,
  bufferTime: 0,
  maxJumps: 1,
};

export interface FlappyPipe {
  x: number;
  gapY: number;
  gapH: number;
  passed: boolean;
}

export function flappyGapFor(n: number): number {
  return Math.max(FLAPPY_GAP_MIN, FLAPPY_GAP_0 - Math.max(0, Math.floor(n)) * FLAPPY_GAP_STEP);
}

export function flappySpeedFor(n: number): number {
  return Math.min(FLAPPY_SPEED_MAX, FLAPPY_SPEED_0 + Math.max(0, Math.floor(n)) * FLAPPY_SPEED_STEP);
}

// Passe centrée (tiers médian) = passe parfaite, combo montant.
export function flappyCentered(by: number, gapY: number, gapH: number): boolean {
  return Math.abs(by - gapY) <= gapH / 6;
}

// Collision cercle contre les deux mâchoires (haut : 0..gapTop, bas : gapBottom..sol).
export function flappyHitsPipe(bx: number, by: number, r: number, pipe: FlappyPipe): boolean {
  const pr = r * 0.85;
  if (bx + pr < pipe.x || bx - pr > pipe.x + FLAPPY_PIPE_W) return false;
  const gapTop = pipe.gapY - pipe.gapH / 2;
  const gapBottom = pipe.gapY + pipe.gapH / 2;
  return by - pr < gapTop || by + pr > gapBottom;
}

export class FlappyGame extends BaseGame {
  [key: string]: any;
  static meta: GameMeta = {
    id: 'flap', name: 'FLAPPY BLOB', accent: '#fb923c', mood: 'runner',
    desc: 'Bat des ailes. Frôle. Survis.', controls: 'A / Espace / Clic = battre · maintenir = plus haut',
    keys: 'Espace / J / Clic',
    hint: 'A / Espace / Clic pour voler, maintenir pour monter plus haut · le centre des arches = PARFAIT',
    unit: 'pts', ranks: [40, 25, 15, 8, 0],
  };

  vy = 0;
  started = false;
  jump: JumpState = createJumpState();
  pipes: FlappyPipe[] = [];
  pipesPassed = 0;
  combo = 0;
  flapT = 1;
  proxT = 0;
  seed = 0;
  bgDots: Array<{ x: number; y: number; z: number }> = [];
  tickOff = 0;

  constructor(engine: EngineLike) {
    super(engine);
    this.seed = this.session.seed;
    this.blob.x = FLAPPY_PX;
    this.blob.y = 340;
    this.blob.r = FLAPPY_R;
    this.blob.trailOn = false;
    this.blob.speedMorph = 0.9;
    this.blob.setEmotion('focused');
    for (let i = 0; i < 46; i++) {
      this.bgDots.push({
        x: this.visualUnit() * 1280,
        y: this.visualUnit() * 600,
        z: 0.2 + this.visualUnit() * 0.8,
      });
    }
    this.resetRun();
  }

  visualUnit(): number {
    return this.rng.next();
  }

  resetRun(): void {
    this.vy = 0;
    this.started = false;
    this.pipes = [];
    this.pipesPassed = 0;
    this.combo = 0;
    this.flapT = 1;
    this.proxT = 0;
    this.blob.x = FLAPPY_PX;
    this.blob.y = 340;
    this.blob.vx = 0;
    this.blob.vy = 0;
    this.blob.dead = false;
    this.blob.scared = false;
    this.blob.setEmotion('focused');
    this.blob.setPose(1, 1, 0, 0);
    this.spawnPipe(980);
    this.spawnPipe(980 + FLAPPY_SPACING);
  }

  spawnPipe(x: number): void {
    const gapH = flappyGapFor(this.pipesPassed);
    const margin = 84;
    const lo = margin + gapH / 2;
    const hi = FLAPPY_GROUND_Y - margin - gapH / 2;
    const gapY = lo + this.rng.next() * Math.max(1, hi - lo);
    this.pipes.push({ x, gapY, gapH, passed: false });
  }

  flap(): void {
    if (this.state !== 'play' || this.paused) return;
    if (!this.started) this.started = true;
    this.vy = FLAPPY_FLAP_VY;
    resetJumpAir(this.jump);
    this.flapT = 0;
    this.blob.punch(0.35);
    this.blob.setPose(0.82, 1.26, 0.1, 0);
    this.blob.setEmotion('focused');
    this.audio.jump();
    this.input.rumble(0.14, 0.05);
    this.fx.burst(this.blob.x - 6, this.blob.y + 16, {
      n: 7, speed: [60, 240], colors: ['#ffffffaa', this.accent], size: [1.5, 3.5], life: 0.35,
      ang: Math.PI / 2, spread: 1.6,
    });
  }

  onPointer(x: number, y: number): void {
    super.onPointer(x, y);
    // Clic = battement d'ailes (hors interfaces pause / fin / réglages).
    if (this.state === 'play' && !this.paused && !this.settings.active) this.flap();
  }

  die(ground: boolean): void {
    if (this.state === 'over') return;
    this.blob.x = Math.max(this.blob.x, FLAPPY_PX - 40);
    this.blob.dead = true;
    this.blob.punch(0.6);
    this.fx.shake(ground ? 0.7 : 0.95);
    this.fx.stop(0.12);
    this.fx.burst(this.blob.x, this.blob.y, {
      n: 28, speed: [100, 520],
      colors: ground ? [this.accent, '#ffffff', '#8fa3ad'] : [this.accent, '#ffffff', '#ff5470'],
      size: [2, 6], life: 0.7,
    });
    this.fx.ring(this.blob.x, this.blob.y, { r0: 10, r1: 120, color: this.accent, life: 0.4 });
    this.fx.text(this.blob.x, Math.max(120, this.blob.y - 52), ground ? 'PLAF !' : 'CRASH !', {
      color: ground ? '#d7e3ea' : '#ff5470', size: 26,
    });
    this.score = this.pipesPassed;
    this.over(false);
  }

  update(dt: number): void {
    if (this.baseUpdate(dt)) return;
    const I = this.input;
    const b = this.blob;

    if (I.pressed('a') || I.pressed('up')) this.flap();

    if (!this.started) {
      // Attente : le blob respire sur place, le décor vit doucement.
      b.y = 340 + Math.sin(this.time * 2.4) * 12;
      b.x = FLAPPY_PX;
      b.vx = 0;
      b.vy = 0;
      b.update(dt);
      this.driftDots(dt, 30);
      return;
    }

    const speed = flappySpeedFor(this.pipesPassed);
    const held = I.down('a') || I.down('up');

    // Physique : gravité nuancée au maintien, plafond qui pardonne,
    // sol qui ne pardonne pas.
    advanceJumpAir(this.jump, dt);
    releaseJump(this.jump, held);
    this.vy = applyJumpCut(this.jump, FLAPPY_FLAP, this.vy);
    this.vy = Math.min(FLAPPY_MAX_FALL, this.vy + jumpGravity(this.jump, FLAPPY_FLAP, this.vy, held, false) * dt);
    b.y += this.vy * dt;
    if (b.y < FLAPPY_CEIL_Y + b.r) {
      b.y = FLAPPY_CEIL_Y + b.r;
      this.vy = Math.max(0, this.vy);
    }

    // Défilement + recyclage des arches.
    for (const p of this.pipes) p.x -= speed * dt;
    while (this.pipes.length && this.pipes[0].x + FLAPPY_PIPE_W < -60) this.pipes.shift();
    const last = this.pipes[this.pipes.length - 1];
    if (!last || last.x < 1280 + 40) this.spawnPipe(last ? last.x + FLAPPY_SPACING : 1280 + 40);

    // Franchissement : +1, combo si centré, fanfare tous les 10.
    for (const p of this.pipes) {
      if (!p.passed && p.x + FLAPPY_PIPE_W < FLAPPY_PX - b.r) {
        p.passed = true;
        this.pipesPassed += 1;
        this.score = this.pipesPassed;
        const perfect = flappyCentered(b.y, p.gapY, p.gapH);
        const gx = FLAPPY_PX + 60;
        if (perfect) {
          this.combo += 1;
          this.audio.perfect();
          this.audio.coin(Math.min(7, this.combo));
          if (this.combo === 5) this.emitAchievement('flap:perfect5');
          this.musicEvent('combo', Math.min(1.1, 0.4 + this.combo * 0.08));
          this.fx.ring(gx, p.gapY, { r0: 12, r1: 84, color: '#f2c94c', life: 0.35, width: 3 });
          this.fx.text(gx, p.gapY - 40, 'PARFAIT x' + this.combo, { color: '#f2c94c', size: 20, mono: true });
          this.fx.flash('#f2c94c', 0.05);
          b.setEmotion('happy', 0.6);
        } else {
          this.combo = 0;
          this.audio.coin(this.pipesPassed % 8);
          this.musicEvent('combo', 0.35);
          this.fx.ring(gx, b.y, { r0: 8, r1: 56, color: this.accent, life: 0.3 });
          this.fx.text(gx, b.y - 36, '+1', { color: this.accent, size: 22, mono: true });
          b.setEmotion('happy', 0.35);
        }
        b.punch(0.25);
        this.input.rumble(0.1, 0.04);
        if (this.pipesPassed % 10 === 0) {
          this.audio.milestone();
          this.musicEvent('waveComplete', 0.8);
          if (this.pipesPassed === 10) this.emitAchievement('flap:ten');
          this.fx.flash(this.accent, 0.1);
          this.fx.text(640, 240, this.pipesPassed + ' ARCHES !', { color: this.accent, size: 32 });
        }
      }
    }

    // Collisions : mâchoires puis sol.
    for (const p of this.pipes) {
      if (flappyHitsPipe(b.x, b.y, b.r, p)) {
        this.die(false);
        return;
      }
    }
    if (b.y + b.r >= FLAPPY_GROUND_Y) {
      b.y = FLAPPY_GROUND_Y - b.r;
      this.die(true);
      return;
    }

    // Capteur de proximité : le blob stresse quand la mâchoire est proche.
    this.proxT = Math.max(0, this.proxT - dt * 2.4);
    const next = this.pipes.find((p) => p.x + FLAPPY_PIPE_W >= FLAPPY_PX - b.r);
    if (next) {
      const dx = next.x - FLAPPY_PX;
      if (dx > -40 && dx < 190) {
        const gapTop = next.gapY - next.gapH / 2;
        const gapBottom = next.gapY + next.gapH / 2;
        const clear = Math.min(b.y - b.r - gapTop, gapBottom - (b.y + b.r));
        this.proxT = Math.max(this.proxT, 1 - Math.max(0, Math.min(1, clear / 90)));
      }
    }
    b.scared = this.proxT > 0.62;

    // Pose : le battement étire, puis la gelée se détend.
    this.flapT = Math.min(1, this.flapT + dt * 5.5);
    const k = this.flapT * this.flapT * (3 - 2 * this.flapT);
    const sx = 0.82 + (1 - 0.82) * k;
    const sy = 1.26 + (1 - 1.26) * k;
    const liquid = 0.1 * (1 - k);
    b.setPose(sx, sy, liquid, 0);

    b.vx = speed * 0.35;
    b.vy = this.vy;
    b.update(dt);

    this.driftDots(dt, speed);
    this.tickOff = (this.tickOff + speed * dt) % 56;
    this.fx.zoom = 1 - Math.min(0.06, Math.max(0, (speed - FLAPPY_SPEED_0) * 0.0003));
  }

  driftDots(dt: number, speed: number): void {
    for (const d of this.bgDots) {
      d.x -= speed * (0.12 + d.z * 0.3) * dt;
      if (d.x < -4) {
        d.x = 1284;
        d.y = this.rng.next() * 600;
      }
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    const bg = ctx.createLinearGradient(0, 0, 0, 720);
    bg.addColorStop(0, '#0b1026');
    bg.addColorStop(0.55, '#0a0d18');
    bg.addColorStop(0.82, '#0d1410');
    bg.addColorStop(1, '#070a08');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 1280, 720);

    this.fx.world(ctx);

    // Coucher de soleil discret derrière les arches.
    const sun = ctx.createRadialGradient(920, 430, 10, 920, 430, 260);
    sun.addColorStop(0, 'rgba(251,146,60,0.20)');
    sun.addColorStop(1, 'rgba(251,146,60,0)');
    ctx.fillStyle = sun;
    ctx.fillRect(600, 150, 680, 560);

    for (const d of this.bgDots) {
      ctx.globalAlpha = 0.1 + d.z * 0.22;
      ctx.fillStyle = '#ffd9ae';
      ctx.beginPath();
      ctx.arc(d.x, d.y, 0.8 + d.z * 1.6, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Collines lointaines (deux couches).
    ctx.fillStyle = '#0e1526';
    ctx.beginPath();
    ctx.moveTo(0, FLAPPY_GROUND_Y);
    for (let x = 0; x <= 1280; x += 32) {
      ctx.lineTo(x, FLAPPY_GROUND_Y - 46 - Math.sin(x * 0.006 + 1.7) * 26 - Math.sin(x * 0.017) * 10);
    }
    ctx.lineTo(1280, FLAPPY_GROUND_Y);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#111a2e';
    ctx.beginPath();
    ctx.moveTo(0, FLAPPY_GROUND_Y);
    for (let x = 0; x <= 1280; x += 32) {
      const off = (this.time * 24) % 1280;
      const xx = (x + off) % 1280;
      ctx.lineTo(x, FLAPPY_GROUND_Y - 22 - Math.sin(xx * 0.01 + 0.4) * 14);
    }
    ctx.lineTo(1280, FLAPPY_GROUND_Y);
    ctx.closePath();
    ctx.fill();

    for (const p of this.pipes) this.drawPipe(ctx, p);
    this.drawGround(ctx);

    // Score géant façon borne.
    UI.txt(ctx, String(this.pipesPassed), 640, 150, {
      size: 76, align: 'center', mono: true, weight: 700, shadow: true, color: '#fff7ed',
    });
    UI.txt(ctx, 'RECORD ' + UI.getBest(this.meta.id), 640, 182, {
      size: 15, align: 'center', mono: true, color: '#a8b0bf',
    });
    if (this.combo >= 2) {
      UI.txt(ctx, 'PARFAIT x' + this.combo, 640, 216, {
        size: 17, align: 'center', mono: true, color: '#f2c94c', weight: 900,
      });
    }

    if (!this.started && this.state === 'play') {
      const pulse = 0.65 + 0.35 * Math.sin(this.time * 5);
      ctx.globalAlpha = pulse;
      UI.txt(ctx, 'ESPACE / CLIC POUR VOLER', 640, 420, {
        size: 26, align: 'center', color: '#fff7ed', weight: 900, shadow: true,
      });
      ctx.globalAlpha = 1;
    }

    // Halo de proximité autour du blob quand ça frôle.
    if (this.proxT > 0.05 && this.state === 'play') {
      ctx.save();
      ctx.globalAlpha = 0.16 + this.proxT * 0.3;
      ctx.strokeStyle = this.proxT > 0.62 ? '#ff5470' : '#f2c94c';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(this.blob.x, this.blob.y, this.blob.r + 12 + this.proxT * 8, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }

    this.blob.render(ctx);
    this.fx.drawWorld(ctx);
    this.fx.endWorld(ctx);

    UI.drawHUD(ctx, { accent: this.accent, score: this.score, unit: this.meta.unit });
    this.drawCommon(ctx);
  }

  drawPipe(ctx: CanvasRenderingContext2D, p: FlappyPipe): void {
    const x = p.x;
    const w = FLAPPY_PIPE_W;
    const gapTop = p.gapY - p.gapH / 2;
    const gapBottom = p.gapY + p.gapH / 2;
    const body = ctx.createLinearGradient(x, 0, x + w, 0);
    body.addColorStop(0, '#101828');
    body.addColorStop(0.5, '#1c2942');
    body.addColorStop(1, '#0d1322');
    // Mâchoire haute.
    if (gapTop > 0) {
      ctx.fillStyle = body;
      ctx.fillRect(x, 0, w, gapTop - 14);
      this.drawPipeMouth(ctx, x, gapTop - 14, w, false, p);
    }
    // Mâchoire basse.
    if (gapBottom < FLAPPY_GROUND_Y) {
      ctx.fillStyle = body;
      ctx.fillRect(x, gapBottom + 14, w, FLAPPY_GROUND_Y - gapBottom - 14);
      this.drawPipeMouth(ctx, x, gapBottom, w, true, p);
    }
    // Rivets.
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    for (let y = 26; y < gapTop - 24; y += 44) {
      ctx.beginPath(); ctx.arc(x + 10, y, 2.4, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(x + w - 10, y, 2.4, 0, TAU); ctx.fill();
    }
    for (let y = gapBottom + 26; y < FLAPPY_GROUND_Y - 20; y += 44) {
      ctx.beginPath(); ctx.arc(x + 10, y, 2.4, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(x + w - 10, y, 2.4, 0, TAU); ctx.fill();
    }
  }

  drawPipeMouth(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, down: boolean, p: FlappyPipe): void {
    const h = 26;
    const yy = down ? y - 12 : y;
    ctx.save();
    ctx.shadowColor = this.accent;
    ctx.shadowBlur = 12 + Math.sin(this.time * 4 + p.x * 0.01) * 4;
    const lip = ctx.createLinearGradient(0, yy, 0, yy + h);
    if (down) {
      lip.addColorStop(0, '#fdba74');
      lip.addColorStop(0.35, this.accent);
      lip.addColorStop(1, '#9a3412');
    } else {
      lip.addColorStop(0, '#9a3412');
      lip.addColorStop(0.65, this.accent);
      lip.addColorStop(1, '#fdba74');
    }
    ctx.fillStyle = lip;
    UI.roundRect(ctx, x - 6, yy, w + 12, h, 9);
    ctx.fill();
    ctx.restore();
    // Liseré clair côté ouverture (lisibilité de la zone mortelle).
    ctx.fillStyle = 'rgba(255,247,237,0.75)';
    if (down) ctx.fillRect(x - 6, yy, w + 12, 3);
    else ctx.fillRect(x - 6, yy + h - 3, w + 12, 3);
  }

  drawGround(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#131a12';
    ctx.fillRect(0, FLAPPY_GROUND_Y, 1280, 720 - FLAPPY_GROUND_Y);
    ctx.fillStyle = '#2f7a4e';
    ctx.fillRect(0, FLAPPY_GROUND_Y, 1280, 6);
    ctx.fillStyle = '#4ade80';
    ctx.fillRect(0, FLAPPY_GROUND_Y, 1280, 2);
    // Brins défilants.
    ctx.strokeStyle = '#2f9e6e';
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    for (let x = -this.tickOff; x < 1280; x += 56) {
      ctx.moveTo(x, FLAPPY_GROUND_Y + 46);
      ctx.quadraticCurveTo(x + 4, FLAPPY_GROUND_Y + 30, x + 10, FLAPPY_GROUND_Y + 26);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = this.accent + '55';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = -this.tickOff; x < 1280; x += 56) {
      ctx.moveTo(x, FLAPPY_GROUND_Y + 10);
      ctx.lineTo(x - 10, FLAPPY_GROUND_Y + 22);
    }
    ctx.stroke();
  }
}
