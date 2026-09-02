// Le blob : rond tremblant avec squash & stretch, yeux, trail, impulsions d'impact.
// Les jeux possèdent la physique ; le blob ne fait qu'intégrer le rendu à partir de (x, y, vx, vy).

export class Blob {
  constructor({ x = 640, y = 360, r = 22, color = '#7dd3fc' } = {}) {
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.r = r;
    this.color = color;
    this.t = Math.random() * 10;
    this.jig = 0;            // impulsion d'impact (wobble rapide)
    this.trailOn = false;
    this.trail = [];
    this.lookX = 0; this.lookY = 0;
    this.blink = 0; this.blinkT = 2 + Math.random() * 3;
    this.scared = false;
    this.dead = false;       // écrasé / mort : dessin à plat
    this.hideTrail = false;
  }

  punch(p = 0.3) { this.jig = Math.min(0.6, this.jig + p); }

  update(dt) {
    this.t += dt;
    this.jig = Math.max(0, this.jig - dt * 4.5);
    this.blinkT -= dt;
    if (this.blinkT <= 0) { this.blink = 0.12; this.blinkT = 2.2 + Math.random() * 3.5; }
    if (this.blink > 0) this.blink -= dt;

    const sp = Math.hypot(this.vx, this.vy);
    if (sp > 30) {
      const tx = this.vx / sp, ty = this.vy / sp;
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

  render(ctx) {
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
    const ang = sp > 10 ? Math.atan2(this.vy, this.vx) : 0;
    const sx = 1 + k * 0.30 + this.jig * 0.4;
    const sy = 1 - k * 0.18 - this.jig * 0.35;

    ctx.save();
    ctx.translate(this.x, this.y);
    if (this.dead) {
      ctx.scale(1.5, 0.18);
    } else {
      ctx.rotate(ang); ctx.scale(sx, sy); ctx.rotate(-ang);
    }

    // contour tremblant
    ctx.beginPath();
    const N = 16;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * 6.2832;
      const wob = 0.07 * Math.sin(this.t * 6 + i * 2.1) + this.jig * 0.6 * Math.sin(this.t * 32 + i * 1.7);
      const rr = r * (1 + wob);
      const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 18;
    ctx.fillStyle = this.color;
    ctx.fill();
    ctx.shadowBlur = 0;

    // ombre interne légère pour le volume
    ctx.beginPath();
    ctx.arc(-r * 0.18, -r * 0.22, r * 0.72, 0, 6.2832);
    ctx.fillStyle = '#ffffff22';
    ctx.fill();

    // yeux
    if (!this.dead) {
      const ex = this.lookX * r * 0.28, ey = this.lookY * r * 0.28;
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
        const cx = side * r * 0.34, cy = -r * 0.1;
        ctx.beginPath();
        ctx.moveTo(cx - 4, cy - 4); ctx.lineTo(cx + 4, cy + 4);
        ctx.moveTo(cx + 4, cy - 4); ctx.lineTo(cx - 4, cy + 4);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}
