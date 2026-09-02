// Kit d'effets partagé : particules, anneaux, textes flottants, screenshake (trauma),
// hitstop, slow-mo, flash. Chaque app (menu + jeux) possède sa propre instance.

const rand = (a, b) => a + Math.random() * (b - a);

export class Fx {
  constructor() {
    this.parts = [];
    this.rings = [];
    this.texts = [];
    this.trauma = 0;
    this.hitstop = 0;
    this.timeScale = 1;
    this.flashA = 0;
    this.flashC = '#ffffff';
    this.shakeX = 0; this.shakeY = 0; this.rot = 0;
    this.userRot = 0; this.userSwayX = 0;   // effets de scene du jeu (additifs au shake)
    this.zoom = 1;
    this.t = 0;
  }

  shake(a) { this.trauma = Math.min(1, this.trauma + a); }
  stop(s) { this.hitstop = Math.max(this.hitstop, s); }
  flash(c = '#ffffff', a = 0.3) { this.flashC = c; this.flashA = Math.max(this.flashA, a); }

  burst(x, y, o = {}) {
    const n = o.n ?? 14;
    const sp = o.speed ?? [60, 320];
    const sz = o.size ?? [2, 5];
    const life = o.life ?? 0.6;
    const cols = o.colors ?? ['#ffffff'];
    for (let i = 0; i < n; i++) {
      const a = o.ang !== undefined ? o.ang + (Math.random() - 0.5) * (o.spread ?? 1.2) : Math.random() * Math.PI * 2;
      const v = rand(sp[0], sp[1]);
      const l = rand(life * 0.55, life);
      this.parts.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        life: l, maxLife: l,
        size: rand(sz[0], sz[1]),
        color: cols[(Math.random() * cols.length) | 0],
        drag: o.drag ?? 0.9, grav: o.grav ?? 0,
        shape: o.shape ?? 'dot',
        rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 10,
      });
    }
    if (this.parts.length > 700) this.parts.splice(0, this.parts.length - 700);
  }

  ring(x, y, o = {}) {
    this.rings.push({
      x, y, r0: o.r0 ?? 8, r1: o.r1 ?? 70,
      life: o.life ?? 0.35, maxLife: o.life ?? 0.35,
      color: o.color ?? '#ffffff', width: o.width ?? 3,
    });
  }

  text(x, y, str, o = {}) {
    this.texts.push({
      x, y, str,
      color: o.color ?? '#ffffff',
      size: o.size ?? 22,
      life: o.life ?? 0.8, maxLife: o.life ?? 0.8,
      vy: o.vy ?? -46,
      mono: o.mono ?? false,
    });
    if (this.texts.length > 40) this.texts.shift();
  }

  // Retourne le dt réel à passer au monde (0 pendant hitstop, ralenti via timeScale)
  consume(dt) {
    if (this.hitstop > 0) {
      this.hitstop = Math.max(0, this.hitstop - dt);
      return 0;
    }
    return dt * this.timeScale;
  }

  update(dt) {
    this.t += dt;
    const ps = this.parts;
    let w = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      const d = Math.pow(p.drag, dt * 60);
      p.vx *= d; p.vy *= d;
      p.vy += p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.rot += p.vr * dt;
      ps[w++] = p;
    }
    ps.length = w;

    w = 0;
    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i];
      r.life -= dt;
      if (r.life > 0) this.rings[w++] = r;
    }
    this.rings.length = w;

    w = 0;
    for (let i = 0; i < this.texts.length; i++) {
      const t = this.texts[i];
      t.life -= dt;
      if (t.life > 0) { t.y += t.vy * dt; this.texts[w++] = t; }
    }
    this.texts.length = w;
  }

  cosmetic(dt) {
    this.trauma = Math.max(0, this.trauma - dt * 1.7);
    this.flashA = Math.max(0, this.flashA - dt * 2.4);
    const m = this.trauma * this.trauma;
    this.shakeX = (Math.random() * 2 - 1) * 17 * m + this.userSwayX;
    this.shakeY = (Math.random() * 2 - 1) * 17 * m;
    this.rot = (Math.random() * 2 - 1) * 0.02 * m + this.userRot;
  }

  // À encadrer autour du rendu "monde" (soumis au shake/zoom/rotation)
  world(ctx) {
    ctx.save();
    ctx.translate(640, 360);
    ctx.rotate(this.rot);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-640 + this.shakeX, -360 + this.shakeY);
  }
  endWorld(ctx) { ctx.restore(); }

  drawWorld(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const r of this.rings) {
      const k = r.life / r.maxLife;
      ctx.globalAlpha = k * 0.9;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = Math.max(0.5, r.width * k);
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r0 + (r.r1 - r.r0) * (1 - k), 0, 6.2832);
      ctx.stroke();
    }
    for (const p of this.parts) {
      const k = p.life / p.maxLife;
      ctx.globalAlpha = k;
      ctx.fillStyle = p.color;
      if (p.shape === 'spark') {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = Math.max(1, p.size * 0.6);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035);
        ctx.stroke();
      } else if (p.shape === 'sq') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        const s = p.size * (0.5 + k * 0.5);
        ctx.fillRect(-s / 2, -s / 2, s, s);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.4, p.size * (0.4 + k * 0.6)), 0, 6.2832);
        ctx.fill();
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;

    for (const t of this.texts) {
      const k = t.life / t.maxLife;
      const s = k > 0.7 ? 1 + (k - 0.7) / 0.3 * 0.5 : 1;
      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.scale(s, s);
      ctx.globalAlpha = Math.min(1, k * 3);
      ctx.font = `900 ${t.size}px ${t.mono ? 'Consolas, monospace' : '"Segoe UI", system-ui, sans-serif'}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#00000088';
      ctx.fillText(t.str, 1.5, 1.5);
      ctx.fillStyle = t.color;
      ctx.fillText(t.str, 0, 0);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  drawFlash(ctx) {
    if (this.flashA <= 0.003) return;
    ctx.globalAlpha = this.flashA;
    ctx.fillStyle = this.flashC;
    ctx.fillRect(0, 0, 1280, 720);
    ctx.globalAlpha = 1;
  }
}
