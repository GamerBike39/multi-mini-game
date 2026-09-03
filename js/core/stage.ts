// Intro canvas et wipes blob : le personnage du moteur occupe l'écran
// d'accueil et les transitions entre apps, sans toucher à la physique des jeux.

import { Blob } from './blob';
import { Fx } from './fx';
import * as UI from './ui';
import type { AppLike, AudioLike, EngineLike, InputLike } from './types';

const TAU = Math.PI * 2;
const W = 1280;
const H = 720;
const WIPE_DUR = 0.92;
const WIPE_SWAP = 0.46;

export interface WipeOptions {
  accent?: string;
  title?: string;
  from?: { x: number; y: number };
  to?: { x: number; y: number };
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  r: number;
  color: string;
}

const ease = (k: number): number => k * k * (3 - 2 * k);
const easeOut = (k: number): number => 1 - (1 - k) * (1 - k);
const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function organicBlobPath(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, t: number): void {
  const n = 22;
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * TAU;
    const wob =
      0.045 * Math.sin(t * 1.8 + a * 2)
      + 0.028 * Math.sin(t * 2.6 - a * 3)
      + 0.016 * Math.sin(t * 3.4 + a);
    const rr = r * (1 + wob);
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

export class StageOverlay {
  kind: 'none' | 'wipe' = 'none';
  t = 0;
  duration = WIPE_DUR;
  pending: AppLike | null = null;
  swapped = false;
  accent = '#7dd3fc';
  title = '';
  from = { x: 640, y: 360 };
  to = { x: 640, y: 360 };
  readonly blob = new Blob({ x: 640, y: 360, r: 34, color: '#7dd3fc', trailOn: true });
  readonly sparks: Spark[] = [];
  clock = 0;

  get active(): boolean {
    return this.kind !== 'none';
  }

  beginWipe(app: AppLike, options: WipeOptions = {}): void {
    if (this.kind === 'wipe' && !this.swapped) {
      this.pending = app;
      if (options.accent) this.accent = options.accent;
      if (options.title !== undefined) this.title = options.title;
      return;
    }
    this.kind = 'wipe';
    this.t = 0;
    this.duration = reducedMotion() ? 0.22 : WIPE_DUR;
    this.pending = app;
    this.swapped = false;
    this.accent = options.accent || app.accent || '#7dd3fc';
    this.title = options.title || '';
    this.from = { x: options.from?.x ?? 640, y: options.from?.y ?? 360 };
    this.to = { x: options.to?.x ?? 640, y: options.to?.y ?? 360 };
    this.blob.color = this.accent;
    this.blob.trailOn = true;
    this.blob.trail.length = 0;
    this.blob.dead = false;
    this.blob.scared = false;
    this.blob.x = this.from.x;
    this.blob.y = this.from.y;
    this.blob.r = 30;
    this.blob.setEmotion('wow');
    this.blob.punch(0.35);
    this.sparks.length = 0;
    this.burst(this.from.x, this.from.y, this.accent, 18);
  }

  cancel(): void {
    this.kind = 'none';
    this.pending = null;
    this.swapped = false;
    this.t = 0;
    this.sparks.length = 0;
  }

  update(dt: number, apply: (app: AppLike) => void): void {
    this.clock += dt;
    if (this.kind !== 'wipe') return;

    this.t += dt;
    const u = clamp01(this.t / this.duration);
    const covering = u < WIPE_SWAP;
    const local = covering ? u / WIPE_SWAP : (u - WIPE_SWAP) / (1 - WIPE_SWAP);
    const cover = covering ? easeOut(local) : 1 - ease(local);

    const dest = covering ? { x: 640, y: 348 } : this.to;
    const origin = covering ? this.from : { x: 640, y: 348 };
    const k = covering ? easeOut(local) : ease(local);
    const nx = origin.x + (dest.x - origin.x) * k;
    const ny = origin.y + (dest.y - origin.y) * k;
    this.blob.vx = (nx - this.blob.x) / Math.max(dt, 1e-4);
    this.blob.vy = (ny - this.blob.y) / Math.max(dt, 1e-4);
    this.blob.x = nx;
    this.blob.y = ny;
    this.blob.r = 28 + cover * 18;
    this.blob.setEmotion(covering ? 'wow' : 'happy');
    this.blob.update(dt);

    if (covering && Math.random() < 0.55) {
      this.burst(this.blob.x, this.blob.y, this.accent, 2);
    }

    if (!this.swapped && u >= WIPE_SWAP && this.pending) {
      this.swapped = true;
      apply(this.pending);
    }

    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life -= dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vx *= 0.96;
      s.vy *= 0.96;
      if (s.life <= 0) this.sparks.splice(i, 1);
    }

    if (u >= 1) this.cancel();
  }

  coverAmount(): number {
    if (this.kind !== 'wipe') return 0;
    const u = clamp01(this.t / this.duration);
    if (u < WIPE_SWAP) return easeOut(u / WIPE_SWAP);
    return 1 - ease((u - WIPE_SWAP) / (1 - WIPE_SWAP));
  }

  render(ctx: CanvasRenderingContext2D): void {
    if (this.kind !== 'wipe') return;
    const cover = this.coverAmount();
    if (cover <= 0.001) return;

    const radius = 70 + cover * 980;
    ctx.save();
    ctx.globalAlpha = Math.min(1, 0.22 + cover * 0.92);
    organicBlobPath(ctx, this.blob.x, this.blob.y, radius, this.clock);
    const fill = ctx.createRadialGradient(
      this.blob.x - radius * 0.18,
      this.blob.y - radius * 0.22,
      radius * 0.08,
      this.blob.x,
      this.blob.y,
      radius,
    );
    fill.addColorStop(0, this.accent);
    fill.addColorStop(0.42, '#071018');
    fill.addColorStop(1, '#04050a');
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = cover * 0.55;
    ctx.strokeStyle = this.accent;
    ctx.lineWidth = 3;
    organicBlobPath(ctx, this.blob.x, this.blob.y, radius * 0.86, this.clock + 1);
    ctx.stroke();
    ctx.restore();

    if (this.title && cover > 0.35) {
      ctx.globalAlpha = Math.min(1, (cover - 0.35) / 0.3);
      UI.txt(ctx, this.title, 640, 168, {
        size: 42,
        align: 'center',
        color: '#eaf6ff',
        weight: 900,
        shadow: true,
      });
      ctx.globalAlpha = 1;
    }

    for (const s of this.sparks) {
      ctx.globalAlpha = (s.life / s.max) * 0.8;
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    this.blob.render(ctx);
  }

  private burst(x: number, y: number, color: string, n: number): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const v = 40 + Math.random() * 220;
      this.sparks.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life: 0.28 + Math.random() * 0.4,
        max: 0.7,
        r: 1.4 + Math.random() * 2.4,
        color,
      });
    }
  }
}

export class IntroApp implements AppLike {
  engine?: EngineLike;
  readonly eng: EngineLike;
  readonly input: InputLike;
  readonly audio: AudioLike;
  readonly fx = new Fx();
  readonly blob: Blob;
  accent = '#7dd3fc';
  cursor = 'pointer';
  t = 0;
  hop = 0;
  launched = false;
  promptPulse = 0;
  readonly dots: { x: number; y: number; z: number; s: number }[] = [];

  constructor(engine: EngineLike) {
    this.eng = engine;
    this.input = engine.input;
    this.audio = engine.audio;
    this.blob = new Blob({ x: 640, y: 392, r: 54, color: '#7dd3fc', trailOn: true });
    this.blob.setEmotion('sleepy');
    for (let i = 0; i < 42; i++) {
      this.dots.push({
        x: Math.random() * W,
        y: Math.random() * H,
        z: 0.2 + Math.random() * 0.8,
        s: Math.random() * TAU,
      });
    }
  }

  enter(): void {
    this.blob.setEmotion('sleepy');
  }

  exit(): void {}

  update(dt: number): void {
    this.t += dt;
    this.promptPulse += dt;
    this.fx.zoom = 1;

    const I = this.input;
    const mx = I.moveX;
    const my = I.moveY;
    this.blob.vx += (mx * 220 - this.blob.vx) * Math.min(1, dt * 6);
    this.blob.vy += (my * 160 - this.blob.vy) * Math.min(1, dt * 6);
    this.blob.x = Math.max(90, Math.min(W - 90, this.blob.x + this.blob.vx * dt));
    this.blob.y = Math.max(160, Math.min(H - 90, this.blob.y + this.blob.vy * dt));

    if (this.hop > 0) this.hop = Math.max(0, this.hop - dt);
    const grounded = this.hop <= 0 && Math.abs(my) < 0.2;
    if (grounded) {
      this.blob.y += Math.sin(this.t * 2.2) * 0.35;
    }

    const moving = Math.hypot(mx, my) > 0.18;
    if (!this.launched) {
      if (moving) this.blob.setEmotion('happy');
      else if (this.t < 1.2) this.blob.setEmotion('sleepy');
      else this.blob.setEmotion('idle');
    }

    if (!this.launched && (I.pressed('a') || I.pressed('start'))) this.launch();

    this.blob.update(dt);

    for (const d of this.dots) {
      d.x -= (6 + d.z * 18) * dt;
      d.y += Math.sin(this.t * 0.7 + d.s) * 5 * dt;
      if (d.x < -6) {
        d.x = W + 6;
        d.y = Math.random() * H;
      }
    }
  }

  onPointer(_x: number, _y: number): void {
    this.launch();
  }

  render(ctx: CanvasRenderingContext2D): void {
    const g = ctx.createRadialGradient(640, 300, 40, 640, 360, 640);
    g.addColorStop(0, 'rgba(125,211,252,0.16)');
    g.addColorStop(0.45, 'rgba(8,14,28,0.4)');
    g.addColorStop(1, '#04050a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    UI.grid(ctx, { gap: 72, off: this.t * 8, alpha: 0.045, color: '#7dd3fc' });

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const d of this.dots) {
      ctx.globalAlpha = 0.12 + d.z * 0.22;
      ctx.fillStyle = '#7dd3fc';
      ctx.beginPath();
      ctx.arc(d.x, d.y, 1.2 + d.z * 1.8, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    organicBlobPath(ctx, this.blob.x, this.blob.y + 8, 118, this.t);
    ctx.fillStyle = 'rgba(125,211,252,0.08)';
    ctx.fill();

    this.blob.render(ctx);

    UI.txt(ctx, 'BLOB ARCADE', 640, 132, {
      size: 54,
      align: 'center',
      color: '#eaf6ff',
      weight: 900,
      shadow: true,
    });
    UI.txt(ctx, 'un blob, dix jeux', 640, 172, {
      size: 16,
      align: 'center',
      color: '#8b95a8',
      mono: true,
    });

    const pad = this.input.padConnected;
    UI.txt(ctx, pad ? 'Manette détectée' : 'Clavier prêt — une manette se connecte toute seule', 640, 548, {
      size: 14,
      align: 'center',
      color: pad ? '#34d399' : '#8b95a8',
    });

    const pulse = 0.72 + Math.sin(this.promptPulse * 3.2) * 0.28;
    ctx.globalAlpha = pulse;
    UI.panel(ctx, 640 - 150, 578, 300, 46, {
      radius: 23,
      fill: '#7dd3fc',
      stroke: 'rgba(255,255,255,0.25)',
    });
    UI.txt(ctx, 'A  ·  cliquer pour lancer', 640, 608, {
      size: 16,
      align: 'center',
      color: '#06121c',
      weight: 800,
    });
    ctx.globalAlpha = 1;

    UI.txt(ctx, 'Le clic débloque le son  ·  puis manette ou ZQSD / Espace / K', 640, 656, {
      size: 12,
      align: 'center',
      color: '#5d6480',
    });
    UI.txt(ctx, 'Bouge le blob avec le stick ou les flèches', 640, 678, {
      size: 12,
      align: 'center',
      color: '#5d6480',
    });
  }

  private launch(): void {
    if (this.launched) return;
    this.launched = true;
    this.audio.unlock();
    this.input.absorb();
    this.blob.setEmotion('happy', 0.8);
    this.blob.punch(0.45);
    this.fx.flash('#7dd3fc', 0.28);
    const menu = this.eng.menuFactory?.();
    if (!menu) return;
    this.eng.transitionTo(menu, {
      accent: '#7dd3fc',
      title: 'BLOB ARCADE',
      from: { x: this.blob.x, y: this.blob.y },
      to: { x: 640, y: 96 },
    });
  }
}

export function blobAnchor(app: AppLike | null | undefined): { x: number; y: number } {
  const blob = (app as { blob?: Blob } | null)?.blob;
  if (blob && Number.isFinite(blob.x) && Number.isFinite(blob.y)) {
    return { x: blob.x, y: blob.y };
  }
  return { x: 640, y: 360 };
}
