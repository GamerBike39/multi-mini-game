// CAVE RACER — tunnel procédural déterministe (somme de sinus), de plus en plus serré.
// Bonus de "near-miss" le long des parois, orbes en chaîne, boost risqué.

import { BaseGame } from '../core/game';
import * as UI from '../core/ui';
import type { EngineLike, GameMeta, InputLike } from '../core/types';

const COL = 32;

export class CaveGame extends BaseGame {
  [key: string]: any;
  static meta: GameMeta = {
    id: 'cave', name: 'CAVE RACER', accent: '#818cf8', mood: 'cave',
    desc: 'Le tunnel se resserre', controls: 'Stick piloter · A boost',
    keys: "ZQSD / Flèches + Espace",
    hint: 'Guide le blob dans le tunnel · A = boost · rase les murs pour des bonus',
    unit: 'pts', ranks: [4000, 2500, 1200, 500, 0],
  };

  constructor(engine: EngineLike) {
    super(engine);
    this.ph = [0, 0, 0, 0].map(() => Math.random() * 100);
    this.blob.x = 300; this.blob.y = 360; this.blob.r = 17;
    this.blob.trailOn = true;
    this.worldX = 0;
    this.boost = 1; this.meter = 1;
    this.orbScore = 0; this.proxScore = 0;
    this.coinStep = 0; this.coinT = 0;
    this.taken = new Set();
    this.proxT = 0; this.proxCd = 0;
    this.clearance = 1;
    this.stars = [];
    for (let i = 0; i < 46; i++) this.stars.push({ x: Math.random() * 1500, y: 40 + Math.random() * 640, z: 0.2 + Math.random() * 0.6 });
  }

  center(i: number): number {
    return 360 + 150 * Math.sin(i * 0.043 + this.ph[0]) + 90 * Math.sin(i * 0.011 + this.ph[1]) + 45 * Math.sin(i * 0.09 + this.ph[2]);
  }
  gap(i: number): number {
    const g = Math.max(150, 310 - Math.min(160, i * 0.4)) * (1 + 0.13 * Math.sin(i * 0.05 + this.ph[3]));
    return Math.min(g, 330);
  }
  clampC(i: number, g: number): number { return Math.max(60 + g, Math.min(660 - g, this.center(i))); }

  topAt(wx: number): number {
    const i = wx / COL, i0 = Math.floor(i), f = i - i0;
    const g0 = this.gap(i0), g1 = this.gap(i0 + 1);
    const c0 = this.clampC(i0, g0), c1 = this.clampC(i0 + 1, g1);
    return (c0 - g0) * (1 - f) + (c1 - g1) * f;
  }
  botAt(wx: number): number {
    const i = wx / COL, i0 = Math.floor(i), f = i - i0;
    const g0 = this.gap(i0), g1 = this.gap(i0 + 1);
    const c0 = this.clampC(i0, g0), c1 = this.clampC(i0 + 1, g1);
    return (c0 + g0) * (1 - f) + (c1 + g1) * f;
  }

  blockAt(i: number): { x: number; y: number; w: number; h: number } | null {
    if (i < 140 || i % 97 !== 50) return null;
    const g = this.gap(i), c = this.clampC(i, g);
    const cy = c + Math.sin(i * 0.8) * g * 0.3;
    return { x: i * COL + 16 - 23, y: cy - 23, w: 46, h: 46 };
  }

  update(dt: number): void {
    if (this.baseUpdate(dt)) return;
    const b = this.blob, I = this.input;

    // boost
    const wantBoost = I.down('a') && this.meter > 0.02;
    if (wantBoost) { this.meter = Math.max(0, this.meter - dt * 0.6); this.boost += (1.45 - this.boost) * Math.min(1, dt * 6); }
    else { this.meter = Math.min(1, this.meter + dt * 0.32); this.boost += (1 - this.boost) * Math.min(1, dt * 4); }
    if (wantBoost && Math.random() < 0.6) {
      this.fx.burst(b.x - 14, b.y + (Math.random() - 0.5) * 16, { n: 1, speed: [80, 200], colors: [this.accent, '#c7d2fe'], size: [2, 4], life: 0.3, ang: Math.PI, spread: 0.7 });
    }

    const speed = Math.min(660, 330 + this.worldX * 0.006) * this.boost;
    this.worldX += speed * dt;
    b.x = 300;

    // pilotage
    this.steer(dt, b, I.moveX, I.moveY, 430, 7);
    b.y += b.vy * dt;

    const wx = this.worldX + 300;

    // collision parois (3 échantillons horizontaux)
    for (const ox of [-b.r * 0.7, 0, b.r * 0.7]) {
      const t = this.topAt(wx + ox), bt = this.botAt(wx + ox);
      if (b.y - b.r < t || b.y + b.r > bt) { this.die(); break; }
    }

    // blocs
    const i0 = Math.floor(wx / COL);
    for (let i = i0 - 1; i <= i0 + 2; i++) {
      const bl = this.blockAt(i);
      if (bl && this.circleRect(b.x, b.y, b.r * 0.9, bl.x - this.worldX, bl.y, bl.w, bl.h)) this.die();
    }

    // orbes
    this.coinT = Math.max(0, this.coinT - dt);
    if (this.coinT <= 0) this.coinStep = 0;
    for (let i = i0 - 2; i <= i0 + 22; i++) {
      if (i < 25 || i % 6 !== 2 || this.taken.has(i)) continue;
      const g = this.gap(i), c = this.clampC(i, g);
      const ox = i * COL + 16 - this.worldX;
      const oy = c + Math.sin(i * 1.7) * g * 0.45;
      if (Math.hypot(b.x - ox, b.y - oy) < b.r + 14) {
        this.taken.add(i);
        this.coinStep++;
        this.coinT = 1.4;
        this.orbScore += 25;
        this.musicEvent('powerUp', 0.5);
        this.audio.coin(this.coinStep);
        this.fx.burst(ox, oy, { n: 10, speed: [50, 230], colors: ['#7df9ff', '#ffffff'], life: 0.4 });
        this.fx.text(ox, oy - 18, '+25', { color: '#7df9ff', size: 16, mono: true });
        this.input.rumble(0.18, 0.05);
      }
    }

    // near-miss
    this.proxCd = Math.max(0, this.proxCd - dt);
    const wd = Math.min(b.y - this.topAt(wx), this.botAt(wx) - b.y) - b.r;
    this.clearance = Math.max(0, Math.min(1, (wd + 8) / 92));
    if (wd < 15 && this.state === 'play') this.proxT += dt;
    else this.proxT = Math.max(0, this.proxT - dt * 3);
    if (this.proxT > 0.22 && this.proxCd <= 0) {
      this.proxT = 0; this.proxCd = 1.1;
      this.proxScore += 25;
      this.musicEvent('nearMiss', 0.7);
      this.audio.good();
      this.fx.text(b.x, b.y - 34, 'PROX +25', { color: '#c7d2fe', size: 16 });
      this.fx.burst(b.x, b.y + (b.y < 360 ? b.r + 6 : -b.r - 6), { n: 6, speed: [40, 160], colors: ['#c7d2fe'], size: [1.5, 3], life: 0.3 });
      this.input.rumble(0.12, 0.05);
    }

    this.score = Math.floor((this.worldX / 40) * 3) + this.orbScore + this.proxScore;

    // le trail défile vers l'arrière (le blob est fixe à l'écran, le monde bouge)
    for (const p of this.blob.trail) p.x -= speed * dt;
    this.blob.update(dt);

    // caméra verticale douce
    this.camY = (b.y - 360) * 0.2;
    this.fx.zoom = 1 - (wantBoost ? 0.05 : 0);
    this.speedNow = speed;
  }

  circleRect(cx: number, cy: number, cr: number, x: number, y: number, w: number, h: number): boolean {
    const nx = Math.max(x, Math.min(cx, x + w));
    const ny = Math.max(y, Math.min(cy, y + h));
    return Math.hypot(cx - nx, cy - ny) < cr;
  }

  die(): void {
    if (this.state === 'over') return;
    this.audio.explode(1.4);
    this.input.rumble(1, 0.4);
    this.fx.shake(0.95);
    this.fx.stop(0.13);
    this.fx.burst(this.blob.x, this.blob.y, { n: 26, speed: [100, 500], colors: [this.accent, '#ffffff', '#7df9ff'], size: [2, 6], life: 0.7 });
    this.fx.ring(this.blob.x, this.blob.y, { r0: 10, r1: 110, color: this.accent, life: 0.4 });
    this.blob.dead = true;
    this.over();
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#070812';
    ctx.fillRect(0, 0, 1280, 720);

    this.fx.world(ctx);
    ctx.save();
    ctx.translate(0, -(this.camY || 0));

    // étoiles (parallaxe)
    for (const s of this.stars) {
      const sx = (((s.x - this.worldX * (0.15 + s.z * 0.3)) % 1500) + 1500) % 1500 - 100;
      ctx.globalAlpha = 0.08 + s.z * 0.14;
      ctx.fillStyle = '#aab6ff';
      ctx.fillRect(sx, s.y, 2, 2);
    }
    ctx.globalAlpha = 1;

    const i0 = Math.floor(this.worldX / COL) - 1;
    const i1 = i0 + 44;

    // parois supérieures / inférieures
    for (const side of ['top', 'bot']) {
      ctx.beginPath();
      ctx.moveTo(i0 * COL - this.worldX, side === 'top' ? -60 : 780);
      for (let i = i0; i <= i1; i++) {
        const g = this.gap(i), c = this.clampC(i, g);
        const y = side === 'top' ? c - g : c + g;
        ctx.lineTo(i * COL - this.worldX, y);
      }
      ctx.lineTo((i1) * COL - this.worldX, side === 'top' ? -60 : 780);
      ctx.closePath();
      ctx.fillStyle = side === 'top' ? '#10131f' : '#10131f';
      ctx.fill();
      // bord lumineux
      ctx.beginPath();
      for (let i = i0; i <= i1; i++) {
        const g = this.gap(i), c = this.clampC(i, g);
        const y = side === 'top' ? c - g : c + g;
        const x = i * COL - this.worldX;
        i === i0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.strokeStyle = this.accent;
      ctx.lineWidth = 3;
      ctx.shadowColor = this.accent;
      ctx.shadowBlur = 14;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // Repères de profondeur dans le tunnel : une ligne centrale très légère
    // donne un rythme au défilement et aide à lire les changements de largeur.
    ctx.save();
    ctx.globalAlpha = 0.09;
    ctx.strokeStyle = '#c7d2fe';
    ctx.lineWidth = 1;
    for (let x = -80; x < 1360; x += 128) {
      const wx = this.worldX + 300 + x;
      const top = this.topAt(wx), bot = this.botAt(wx);
      const cy = (top + bot) / 2;
      ctx.beginPath();
      ctx.moveTo(x, cy);
      ctx.lineTo(x + 28, cy);
      ctx.stroke();
    }
    ctx.restore();

    // La marge devient une information visuelle avant de devenir un échec :
    // les bords respirent en rouge quand le joueur rase trop la paroi.
    if (this.clearance < 0.58) {
      const danger = (0.58 - this.clearance) / 0.58;
      const pulse = 0.55 + 0.45 * Math.sin(this.time * 12);
      ctx.save();
      ctx.globalAlpha = danger * pulse * 0.18;
      const left = ctx.createLinearGradient(0, 0, 150, 0);
      left.addColorStop(0, '#ff5470'); left.addColorStop(1, 'rgba(255,84,112,0)');
      ctx.fillStyle = left; ctx.fillRect(0, 0, 150, 720);
      const right = ctx.createLinearGradient(1280, 0, 1130, 0);
      right.addColorStop(0, '#ff5470'); right.addColorStop(1, 'rgba(255,84,112,0)');
      ctx.fillStyle = right; ctx.fillRect(1130, 0, 150, 720);
      ctx.restore();
    }

    // orbes
    for (let i = i0; i <= i1; i++) {
      if (i < 25 || i % 6 !== 2 || this.taken.has(i)) continue;
      const g = this.gap(i), c = this.clampC(i, g);
      const ox = i * COL + 16 - this.worldX;
      const oy = c + Math.sin(i * 1.7) * g * 0.45;
      const r = 9 + Math.sin(i * 2.4 + this.time * 5) * 2;
      ctx.shadowColor = '#7df9ff'; ctx.shadowBlur = 14;
      ctx.fillStyle = '#7df9ff';
      ctx.beginPath(); ctx.arc(ox, oy, r, 0, 6.2832); ctx.fill();
      ctx.shadowBlur = 0;
    }

    // blocs
    for (let i = i0; i <= i1; i++) {
      const bl = this.blockAt(i);
      if (!bl) continue;
      ctx.fillStyle = '#2a1b22';
      ctx.strokeStyle = '#ff5470';
      ctx.lineWidth = 2.5;
      UI.roundRect(ctx, bl.x - this.worldX, bl.y, bl.w, bl.h, 8);
      ctx.fill(); ctx.stroke();
    }

    // indications de vitesse au sol du tunnel
    this.blob.render(ctx);
    ctx.restore();

    this.fx.drawWorld(ctx);
    this.fx.endWorld(ctx);

    // HUD
    UI.drawHUD(ctx, {
      accent: this.accent,
      score: this.score,
      extra: () => UI.txt(ctx, 'MARGE ' + Math.round(this.clearance * 100) + '%', 28, 88, {
        size: 12,
        mono: true,
        color: this.clearance < 0.42 ? '#ff8a9a' : '#7c8698',
      }),
    });
    UI.txt(ctx, Math.floor(this.worldX / 40) + ' m', 640, 52, { size: 30, align: 'center', mono: true, color: '#a5b4fc', shadow: true });

    // jauge boost
    const bw = 220, bx = 640 - bw / 2, by = 682;
    UI.panel(ctx, bx - 10, by - 10, bw + 20, 40, {
      radius: 12,
      fill: 'rgba(7, 8, 18, 0.66)',
      stroke: this.meter > 0.25 ? '#7df9ff55' : '#ff547088',
      lineWidth: 1.25,
    });
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(bx, by, bw, 8);
    ctx.fillStyle = this.meter > 0.25 ? '#7df9ff' : '#ff5470';
    ctx.fillRect(bx, by, bw * this.meter, 8);
    UI.txt(ctx, 'A · BOOST', 640, 712, { size: 11, align: 'center', color: '#5d6480' });

    this.drawCommon(ctx);
  }
}
