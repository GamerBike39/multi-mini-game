// BLOB RUN — auto-runner : saut variable (maintien), coyote time, buffer de saut,
// duck pour passer sous les barres, marteaux pneumatiques... non, des scies.

import { BaseGame } from '../core/game';
import * as UI from '../core/ui';
import type { EngineLike, GameMeta } from '../core/types';

const GY = 600;           // sol
const PX = 320;           // x écran du joueur
const JUMP_SPEED = 1080;
const JUMP_HOLD_GRAVITY = 1700;
const JUMP_RISE_GRAVITY = 3150;
const JUMP_FALL_GRAVITY = 3600;
const JUMP_FAST_FALL_GRAVITY = 4200;
const JUMP_CUT_SPEED = 430;
const JUMP_MIN_TIME = 0.07;
const JUMP_HOLD_TIME = 0.18;
const JUMP_POSE_RELAX_TIME = 0.27;
const COYOTE_TIME = 0.11;
const JUMP_BUFFER_TIME = 0.13;
const MAX_JUMPS = 2;

type RunnerObstacleType = 'spike' | 'block' | 'bar' | 'ceiling' | 'saw' | 'gap';

interface RunnerObstacle {
  type: RunnerObstacleType;
  x: number;
  y?: number;
  w?: number;
  h?: number;
  r?: number;
  base?: number;
  ang?: number;
}

export class RunnerGame extends BaseGame {
  [key: string]: any;
  static meta: GameMeta = {
    id: 'run', name: 'BLOB RUN', accent: '#a3e635', mood: 'runner',
    desc: 'Saute. Baisse-toi. Vite.', controls: 'A sauter · A en l’air = double saut · B duck',
    keys: "Espace / K",
    hint: 'A = tapote pour un saut court, maintiens pour sauter haut · A en l’air = double saut · B = se baisser',
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
    this.obs = [] as RunnerObstacle[];
    this.spawnGap = 500;
    this.milestone = 250;
    this.jumpT = 0;
    this.jumpReleased = false;
    this.jumpCount = 0;
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
    const wasGround = this.onGround;
    const previousRadius = b.r;
    const wantDuck = I.down('b') && wasGround;
    this.duck += ((wantDuck ? 1 : 0) - this.duck) * Math.min(1, dt * 18);
    b.r = this.r();

    // Keep the feet on the same surface while the visual body changes size.
    // Otherwise the smaller radius briefly floats above the floor, toggles
    // onGround off, and makes the duck animation oscillate.
    if (wasGround && this.vy === 0) b.y += previousRadius - b.r;

    // Saut : le tap coupe la montée, le maintien prolonge la fenêtre de faible
    // gravité. C'est plus lisible qu'un simple multiplicateur de gravité :
    // chaque durée d'appui produit une hauteur clairement différente.
    if (I.pressed('a')) this.buffer = JUMP_BUFFER_TIME;
    this.buffer = Math.max(0, this.buffer - dt);
    this.coyote = Math.max(0, this.coyote - dt);
    let launched = false;
    if (this.buffer > 0 && (this.onGround || this.coyote > 0)) {
      this.startJump(false);
      launched = true;
    } else if (this.buffer > 0 && !this.onGround && this.jumpCount < MAX_JUMPS) {
      this.startJump(true);
      launched = true;
    }

    if (!this.onGround) {
      this.jumpT += dt;
      if (I.released('a') || !I.down('a')) this.jumpReleased = true;
    }

    // Gravité en trois temps : montée retenue, montée relâchée, chute lourde.
    // Le temps minimum évite qu'un appui très bref ne devienne un faux saut.
    if (this.jumpReleased && this.jumpT >= JUMP_MIN_TIME && this.jumpT < JUMP_HOLD_TIME && this.vy < -JUMP_CUT_SPEED) {
      this.vy = -JUMP_CUT_SPEED;
    }
    let g = this.vy < 0
      ? (I.down('a') && !this.jumpReleased && this.jumpT < JUMP_HOLD_TIME ? JUMP_HOLD_GRAVITY : JUMP_RISE_GRAVITY)
      : JUMP_FALL_GRAVITY;
    if (I.down('b') && !this.onGround) g += JUMP_FAST_FALL_GRAVITY;

    const prevFeet = b.y + b.r;
    this.vy += g * dt;
    b.y += this.vy * dt;

    // Supports : sol, fossés et plateformes. On choisit la surface la plus
    // haute traversée pendant cette frame pour rendre les retombées stables.
    this.onGround = false;
    let supportY = Number.POSITIVE_INFINITY;
    if (this.floorOpenAtPlayer()) {
      if (b.y + b.r >= GY) supportY = GY;
    }
    for (const o of this.obs) {
      if (o.type !== 'block') continue;
      const oy = o.y ?? GY - (o.h ?? 0);
      const ow = o.w ?? 0;
      if (PX + b.r * 0.7 < o.x || PX - b.r * 0.7 > o.x + ow) continue;
      const feet = b.y + b.r;
      if (this.vy >= 0 && prevFeet <= oy + 6 && feet >= oy && oy < supportY) {
        supportY = oy;
      }
    }
    this.onGround = Number.isFinite(supportY);
    if (this.onGround) {
      b.y = supportY - b.r;
      if (!wasGround && !launched && this.vy > 260) {
        // atterrissage marqué
        b.punch(0.45);
        this.audio.land();
        this.input.rumble(0.22, 0.05);
        this.fx.shake(0.12);
        this.fx.burst(PX, supportY, { n: 8, speed: [50, 220], colors: ['#8fa3ad', '#d7e3ea'], size: [2, 4], life: 0.4, ang: -Math.PI / 2, spread: 2.6 });
      }
      this.vy = 0;
      this.jumpT = 0;
      this.jumpReleased = false;
      this.coyote = 0;
      this.jumpCount = 0;
    } else if (wasGround && !launched) {
      this.coyote = COYOTE_TIME;
    }

    // Un fossé se termine par une chute, pas par une collision artificielle.
    if (b.y - b.r > this.H + 80) return this.die();

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
    this.updateBlobPose(dt);
    b.update(dt);

    this.fx.zoom = 1 - Math.min(0.11, Math.max(0, (this.speed - 400) * 0.00028));
  }

  private startJump(doubleJump: boolean): void {
    const b = this.blob;
    const previousRadius = b.r;
    const wasGround = this.onGround;

    this.buffer = 0;
    this.coyote = 0;
    this.onGround = false;
    this.jumpT = 0;
    this.jumpReleased = false;
    this.duck = 0;
    b.r = this.r();
    if (wasGround) b.y += previousRadius - b.r;

    this.vy = -JUMP_SPEED;
    this.jumpCount = doubleJump ? MAX_JUMPS : 1;
    this.audio.jump();
    this.input.rumble(doubleJump ? 0.24 : 0.18, 0.05);
    this.fx.burst(PX, b.y + b.r, {
      n: doubleJump ? 8 : 6,
      speed: doubleJump ? [60, 210] : [40, 160],
      colors: doubleJump ? ['#8ee3ff', '#d7f7ff'] : ['#8fa3ad', '#d7e3ea'],
      size: [2, 4],
      life: doubleJump ? 0.4 : 0.35,
      ang: Math.PI / 2,
      spread: 2.4,
    });
  }

  floorOpenAtPlayer(): boolean {
    const halfWidth = this.blob.r * 0.55;
    return !this.obs.some((o: RunnerObstacle) => o.type === 'gap'
      && PX + halfWidth > o.x
      && PX - halfWidth < o.x + (o.w ?? 0));
  }

  updateBlobPose(dt = 0): void {
    const duck = Math.min(1, this.duck * 1.12);
    const duckEase = duck * duck * (3 - 2 * duck);
    const jumpT = this.onGround ? JUMP_POSE_RELAX_TIME : Math.min(JUMP_POSE_RELAX_TIME, this.jumpT);
    const jumpProgress = Math.max(0, Math.min(1, jumpT / JUMP_POSE_RELAX_TIME));
    const jumpCompression = 1 - jumpProgress * jumpProgress * (3 - 2 * jumpProgress);

    // Le duck devient une flaque compacte ; au décollage la même logique de
    // squash est très brève puis se détend naturellement pendant la montée.
    const scaleX = 1 + duckEase * 0.42 + jumpCompression * 0.32;
    const scaleY = Math.max(0.42, 1 - duckEase * 0.48 - jumpCompression * 0.30);
    const liquid = Math.min(1, duckEase * 0.95 + jumpCompression * 0.08);
    // Quand il est au sol, on décale le centre visuel pour que la flaque reste
    // collée à la ligne de sol malgré sa compression graphique.
    // Blob ajoute aussi un squash lié à sa vitesse et à son impact. On en
    // tient compte ici pour que le bas du contour reste réellement posé sur
    // le support, même pendant le duck.
    const motionK = Math.min(1, Math.hypot(this.blob.vx, this.blob.vy) / 620);
    const renderJig = Math.max(0, this.blob.jig - dt * 4.5);
    const motionScaleY = 1 - motionK * 0.18 - renderJig * 0.35;
    const groundOffset = this.onGround ? this.blob.r * (1 - motionScaleY * scaleY) : 0;
    this.blob.setPose(scaleX, scaleY, liquid, groundOffset);
  }

  spawnPattern(): void {
    const m = this.meters();
    const pool: string[] = [];
    pool.push('s1');
    if (m > 90) pool.push('s2', 'block');
    if (m > 150) pool.push('shortHop', 'gapShort');
    if (m > 230) pool.push('s3', 'bar', 'saw', 'blockSpike', 'gapLong');
    if (m > 420) pool.push('combo1', 'combo2', 'stairs', 'ceilingGap', 'gapStep');
    const p = pool[(Math.random() * pool.length) | 0];
    const startX = 1340;
    let endX = startX;
    const place = (o: Omit<RunnerObstacle, 'x'>, at = endX): void => {
      const obstacle = { ...o, x: at } as RunnerObstacle;
      if (obstacle.type === 'block') obstacle.y = GY - (obstacle.h ?? 0);
      this.obs.push(obstacle);
      endX = Math.max(endX, at + (obstacle.w ?? (obstacle.r ? obstacle.r * 2 : 60)));
    };
    const placeSaw = (at: number): void => {
      this.obs.push({ type: 'saw', x: at, y: GY - 17, r: 17, ang: 0 });
      endX = Math.max(endX, at + 17);
    };

    if (p === 's1') place({ type: 'spike', w: 36, h: 36 });
    else if (p === 's2') { place({ type: 'spike', w: 36, h: 36 }); place({ type: 'spike', w: 36, h: 36 }); }
    else if (p === 's3') { for (let i = 0; i < 3; i++) place({ type: 'spike', w: 36, h: 36 }); }
    else if (p === 'block') place({ type: 'block', w: 60, h: 60 });
    else if (p === 'stairs') {
      place({ type: 'block', w: 60, h: 60 });
      place({ type: 'block', w: 60, h: 120 }, startX + 90);
    } else if (p === 'blockSpike') {
      place({ type: 'block', w: 70, h: 60 });
      place({ type: 'spike', w: 36, h: 36, base: 60 });
    } else if (p === 'bar') {
      place({ type: 'bar', y: GY - 66, w: 92, h: 30 });
    } else if (p === 'ceiling' || p === 'shortHop') {
      place({ type: 'ceiling', y: GY - 180, w: 190, h: 24 });
      place({ type: 'spike', w: 36, h: 36 }, startX + 78);
      endX = Math.max(endX, startX + 190);
    } else if (p === 'gapShort') {
      place({ type: 'gap', w: 190 });
    } else if (p === 'gapLong') {
      place({ type: 'gap', w: 330 });
    } else if (p === 'gapStep') {
      place({ type: 'gap', w: 230 });
      place({ type: 'block', w: 90, h: 60 }, startX + 230);
    } else if (p === 'saw') {
      placeSaw(startX + 17);
    } else if (p === 'combo1') {
      place({ type: 'spike', w: 36, h: 36 });
      place({ type: 'spike', w: 36, h: 36 }, startX + 226);
    } else if (p === 'combo2') {
      place({ type: 'bar', y: GY - 66, w: 92, h: 30 });
      place({ type: 'spike', w: 36, h: 36 }, startX + 352);
    } else if (p === 'ceilingGap') {
      place({ type: 'ceiling', y: GY - 180, w: 190, h: 24 });
      place({ type: 'spike', w: 36, h: 36 }, startX + 78);
      place({ type: 'gap', w: 300 }, startX + 240);
    }
    const width = endX - startX;
    this.spawnGap = width + this.speed * (0.55 + Math.random() * 0.5) + 90;
  }

  nextObstacleLabel(o: any): string {
    if (o.type === 'spike') return o.base ? 'PIQUE EN HAUTEUR' : 'PIQUES';
    if (o.type === 'block') return 'BLOC';
    if (o.type === 'ceiling') return 'PLAFOND · TAPOTE';
    if (o.type === 'gap') return (o.w ?? 0) >= 280 ? 'GOUFFRE · SAUT LONG' : 'GOUFFRE · SAUT';
    if (o.type === 'bar') return 'BARRE · BAISSE-TOI';
    return 'SCIE · SAUTE';
  }

  checkHits(): void {
    const b = this.blob, r = b.r;
    for (const o of this.obs) {
      if (o.type === 'spike') {
        const base = o.base || 0;
        const ow = o.w ?? 36, oh = o.h ?? 36;
        const cx = o.x + ow / 2;
        const bx = cx - ow * 0.22, by = GY - base - oh * 0.62, bw = ow * 0.44, bh = oh * 0.62;
        if (this.circleRect(PX, b.y, r * 0.82, bx, by, bw, bh)) return this.die();
      } else if (o.type === 'block') {
        const oy = o.y ?? GY - (o.h ?? 0);
        const ow = o.w ?? 0, oh = o.h ?? 0;
        const feet = b.y + r;
        const overlapping = PX + r * 0.7 > o.x && PX - r * 0.7 < o.x + ow;
        const landed = this.onGround && Math.abs(feet - oy) < 1.5;
        if (overlapping && feet > oy + 8 && b.y - r < oy + oh) {
          if (!landed) return this.die();
        }
      } else if (o.type === 'bar' || o.type === 'ceiling') {
        if (this.circleRect(PX, b.y, r * 0.9, o.x, o.y ?? GY, o.w ?? 0, o.h ?? 0)) return this.die();
      } else if (o.type === 'saw') {
        if (Math.hypot(PX - o.x, b.y - (o.y ?? GY)) < r * 0.9 + (o.r ?? 17) * 0.85) return this.die();
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

    // Horizon en couches : le sol gagne de la profondeur à mesure que la
    // vitesse augmente, sans détourner l'œil des obstacles.
    const horizon = ctx.createLinearGradient(0, 120, 0, GY);
    horizon.addColorStop(0, 'rgba(163,230,53,0.02)');
    horizon.addColorStop(1, 'rgba(163,230,53,0.10)');
    ctx.fillStyle = horizon;
    ctx.fillRect(0, 120, 1280, GY - 120);

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

    // Guides de profondeur : ils rendent le défilement et la distance au sol
    // immédiatement perceptibles, surtout lors des premières secondes.
    ctx.save();
    ctx.globalAlpha = 0.06;
    ctx.strokeStyle = this.accent;
    ctx.lineWidth = 1;
    for (let y = GY - 150; y < GY; y += 42) {
      const k = (GY - y) / 150;
      ctx.beginPath();
      ctx.moveTo(PX - 300 * k, y);
      ctx.lineTo(PX + 960 * k, y);
      ctx.stroke();
    }
    ctx.restore();

    // Télégraphe de la prochaine menace : le joueur sait quoi lire avant que
    // l'obstacle n'arrive à sa hauteur.
    const next = this.obs
      .filter((o: any) => o.x > PX + 54)
      .sort((a: any, b: any) => a.x - b.x)[0];
    if (next && next.x < PX + 560) {
      const urgency = 1 - Math.max(0, Math.min(1, (next.x - PX - 54) / 506));
      ctx.save();
      ctx.globalAlpha = 0.42 + urgency * 0.5;
      UI.panel(ctx, 492, 112, 296, 38, {
        radius: 19,
        fill: 'rgba(10,15,7,0.82)',
        stroke: urgency > 0.72 ? '#ff5470aa' : this.accent + '88',
        lineWidth: 1.5,
      });
      UI.txt(ctx, 'PROCHAIN  ·  ' + this.nextObstacleLabel(next), 640, 136, {
        size: 12,
        align: 'center',
        mono: true,
        color: urgency > 0.72 ? '#ff9aaa' : '#d7e3ea',
        weight: 900,
      });
      ctx.fillStyle = urgency > 0.72 ? '#ff5470' : this.accent;
      ctx.fillRect(492, 146, 296 * urgency, 2);
      ctx.restore();
    }

    // Obstacles et fossés. Le fossé est dessiné par-dessus le sol pour que
    // l'absence de support soit lisible avant même la collision.
    for (const o of this.obs) {
      if (o.type === 'gap') {
        const w = o.w ?? 0;
        ctx.fillStyle = '#020307';
        ctx.fillRect(o.x, GY - 1, w, this.H - GY + 1);
        ctx.strokeStyle = '#ff5470aa';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(o.x, GY); ctx.lineTo(o.x + 18, GY + 18);
        ctx.moveTo(o.x + w, GY); ctx.lineTo(o.x + w - 18, GY + 18);
        ctx.stroke();
        ctx.strokeStyle = '#ff547044';
        ctx.lineWidth = 1;
        for (let x = o.x + 42; x < o.x + w - 12; x += 42) {
          ctx.beginPath(); ctx.moveTo(x, GY + 12); ctx.lineTo(x - 12, this.H); ctx.stroke();
        }
      } else if (o.type === 'spike') {
        const base = o.base || 0;
        const ow = o.w ?? 36;
        const oh = o.h ?? 36;
        ctx.fillStyle = '#ff5470';
        ctx.beginPath();
        ctx.moveTo(o.x, GY - base);
        ctx.lineTo(o.x + ow / 2, GY - base - oh);
        ctx.lineTo(o.x + ow, GY - base);
        ctx.closePath();
        ctx.fill();
      } else if (o.type === 'block') {
        const oh = o.h ?? 0;
        ctx.fillStyle = '#1a2612';
        ctx.strokeStyle = this.accent;
        ctx.lineWidth = 2;
        UI.roundRect(ctx, o.x, o.y ?? GY - oh, o.w ?? 0, oh, 6);
        ctx.fill(); ctx.stroke();
      } else if (o.type === 'bar' || o.type === 'ceiling') {
        ctx.fillStyle = '#ff5470';
        ctx.shadowColor = '#ff5470'; ctx.shadowBlur = 12;
        UI.roundRect(ctx, o.x, o.y ?? GY, o.w ?? 0, o.h ?? 0, 8);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#ffffff55';
        ctx.beginPath();
        const oy = o.y ?? GY;
        const ow = o.w ?? 0;
        const oh = o.h ?? 0;
        ctx.moveTo(o.x + 10, oy + oh); ctx.lineTo(o.x + 10, oy + oh + 14);
        ctx.moveTo(o.x + ow - 10, oy + oh); ctx.lineTo(o.x + ow - 10, oy + oh + 14);
        ctx.stroke();
      } else if (o.type === 'saw') {
        ctx.save();
        ctx.translate(o.x, o.y ?? GY - 17);
        ctx.rotate(o.ang ?? 0);
        ctx.fillStyle = '#ff5470';
        ctx.beginPath();
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * 6.2832;
          const rr0 = o.r ?? 17;
          const rr = i % 2 === 0 ? rr0 : rr0 * 0.72;
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
    UI.drawHUD(ctx, {
      accent: this.accent,
      score: this.meters(),
      unit: this.meta.unit,
      extra: () => UI.txt(ctx, Math.round(this.speed) + ' px/s', 1252, 87, { size: 12, align: 'right', color: '#5f6b52', mono: true }),
    });
    this.drawCommon(ctx);
  }
}
