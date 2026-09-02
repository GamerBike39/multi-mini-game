// Le blob : rond tremblant avec squash & stretch, yeux, trail, impulsions d'impact.
// Les jeux possèdent la physique ; le blob ne fait qu'intégrer le rendu à partir de (x, y, vx, vy).

interface BlobOptions {
  x?: number;
  y?: number;
  r?: number;
  color?: string;
  trailOn?: boolean;
}

interface TrailPoint {
  x: number;
  y: number;
}

export class Blob {
  x: number;
  y: number;
  vx = 0;
  vy = 0;
  r: number;
  color: string;
  t = Math.random() * 10;
  jig = 0;
  trailOn = false;
  trail: TrailPoint[] = [];
  lookX = 0;
  lookY = 0;
  blink = 0;
  blinkT = 2 + Math.random() * 3;
  scared = false;
  dead = false;
  hideTrail = false;
  poseX = 1;
  poseY = 1;
  liquid = 0;
  poseOffsetY = 0;

  constructor({ x = 640, y = 360, r = 22, color = '#7dd3fc', trailOn = false }: BlobOptions = {}) {
    this.x = x;
    this.y = y;
    this.r = r;
    this.color = color;
    this.trailOn = trailOn;
  }

  punch(amount = 0.3): void {
    this.jig = Math.min(0.6, this.jig + amount);
  }

  // Déformation pilotée par un jeu (saut, duck, charge...). Elle reste
  // indépendante de la hitbox `r`, qui appartient toujours à la physique.
  setPose(scaleX = 1, scaleY = 1, liquid = 0, offsetY = 0): void {
    this.poseX = Math.max(0.2, scaleX);
    this.poseY = Math.max(0.2, scaleY);
    this.liquid = Math.max(0, Math.min(1, liquid));
    this.poseOffsetY = offsetY;
  }

  update(dt: number): void {
    this.t += dt;
    this.jig = Math.max(0, this.jig - dt * 4.5);
    this.blinkT -= dt;
    if (this.blinkT <= 0) {
      this.blink = 0.12;
      this.blinkT = 2.2 + Math.random() * 3.5;
    }
    if (this.blink > 0) this.blink -= dt;

    const sp = Math.hypot(this.vx, this.vy);
    if (sp > 30) {
      const tx = this.vx / sp;
      const ty = this.vy / sp;
      this.lookX += (tx - this.lookX) * Math.min(1, dt * 8);
      this.lookY += (ty - this.lookY) * Math.min(1, dt * 8);
    }
    if (this.trailOn && !this.hideTrail) {
      this.trail.unshift({ x: this.x, y: this.y });
      if (this.trail.length > 14) this.trail.pop();
    } else if (this.trail.length) {
      this.trail.pop();
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    const r = this.r;

    if (this.trail.length > 2) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = this.trail.length - 1; i >= 1; i--) {
        const p = this.trail[i];
        const k = 1 - i / this.trail.length;
        ctx.globalAlpha = k * 0.22;
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * (0.25 + k * 0.65), 0, 6.2832);
        ctx.fill();
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    const sp = Math.hypot(this.vx, this.vy);
    const k = this.dead ? 0 : Math.min(1, sp / 620);
    const angle = sp > 10 ? Math.atan2(this.vy, this.vx) : 0;
    const sx = 1 + k * 0.30 + this.jig * 0.4;
    const sy = 1 - k * 0.18 - this.jig * 0.35;

    ctx.save();
    ctx.translate(this.x, this.y + (this.dead ? 0 : this.poseOffsetY));
    if (this.dead) {
      ctx.scale(1.5, 0.18);
    } else {
      ctx.rotate(angle);
      ctx.scale(sx, sy);
      ctx.rotate(-angle);
      // La pose de gameplay agit dans l'espace du monde : le saut s'écrase
      // verticalement même si la vitesse entraîne le blob en diagonale.
      ctx.scale(this.poseX, this.poseY);
    }

    // Contour tremblant.
    ctx.beginPath();
    const N = 16;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * 6.2832;
      const liquidWave = this.liquid * (
        0.09 * Math.sin(this.t * 10 + i * 2.6)
        + 0.045 * Math.sin(this.t * 21 - i * 1.4)
      );
      const wob = 0.07 * Math.sin(this.t * 6 + i * 2.1)
        + this.jig * 0.6 * Math.sin(this.t * 32 + i * 1.7)
        + liquidWave;
      const rr = r * (1 + wob);
      const px = Math.cos(a) * rr * (1 + this.liquid * 0.035 * Math.sin(this.t * 8 + i));
      const py = Math.sin(a) * rr * (1 + this.liquid * 0.025 * Math.cos(this.t * 9 - i));
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 18;
    ctx.fillStyle = this.color;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Ombre interne légère pour le volume.
    ctx.beginPath();
    ctx.arc(-r * 0.18, -r * 0.22, r * 0.72, 0, 6.2832);
    ctx.fillStyle = '#ffffff22';
    ctx.fill();

    // Yeux.
    if (!this.dead) {
      const ex = this.lookX * r * 0.28;
      const ey = this.lookY * r * 0.28;
      const er = r * 0.16;
      const bl = this.blink > 0 ? 0.15 : 1;
      const sc = this.scared ? 1.35 : 1;
      ctx.fillStyle = '#0b0e14';
      for (const side of [-1, 1]) {
        ctx.save();
        ctx.translate(ex + side * r * 0.32, ey - r * 0.08);
        ctx.scale(1, bl);
        ctx.beginPath();
        ctx.arc(0, 0, er * sc, 0, 6.2832);
        ctx.fill();
        ctx.restore();
      }
    } else {
      ctx.strokeStyle = '#0b0e14';
      ctx.lineWidth = 2.5;
      for (const side of [-1, 1]) {
        const cx = side * r * 0.34;
        const cy = -r * 0.1;
        ctx.beginPath();
        ctx.moveTo(cx - 4, cy - 4);
        ctx.lineTo(cx + 4, cy + 4);
        ctx.moveTo(cx + 4, cy - 4);
        ctx.lineTo(cx - 4, cy + 4);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}
