// BLOB GOLF — mini-golf 9 trous faits main : visée au stick (lissée), coup chargé au A,
// rebonds restitués sur les murs, bunkers de sable qui freinent, trou capturé à vitesse douce.

import { BaseGame } from '../core/game';
import * as UI from '../core/ui';
import type { EngineLike, GameMeta } from '../core/types';

// Bordure fermée de 20 px, commune à tous les trous
const BORD = [
  { x: 0, y: 0, w: 1280, h: 20 },
  { x: 0, y: 700, w: 1280, h: 20 },
  { x: 0, y: 0, w: 20, h: 720 },
  { x: 1260, y: 0, w: 20, h: 720 },
];

// Les 9 trous : tee/cup jamais sur un mur ni du sable, trajectoires directes et
// rebondissables vérifiées à la main (par 2 à 4).
const HOLES = [
  // 1 — la ligne droite d'échauffement (ace possible à pleine puissance)
  { par: 2, tee: { x: 150, y: 360 }, cup: { x: 1130, y: 360 },
    walls: [...BORD], sand: [{ x: 640, y: 110, w: 200, h: 130 }, { x: 640, y: 480, w: 200, h: 130 }] },
  // 2 — virage en L : mur descendant du haut, passer dessous puis remonter
  { par: 3, tee: { x: 150, y: 560 }, cup: { x: 1120, y: 160 },
    walls: [...BORD, { x: 640, y: 20, w: 40, h: 420 }], sand: [{ x: 880, y: 430, w: 190, h: 130 }] },
  // 3 — couloir avec sable au milieu : percer de force ou bancaire par le haut
  { par: 2, tee: { x: 150, y: 360 }, cup: { x: 1130, y: 360 },
    walls: [...BORD, { x: 300, y: 220, w: 680, h: 40 }, { x: 300, y: 460, w: 680, h: 40 }],
    sand: [{ x: 590, y: 290, w: 100, h: 140 }] },
  // 4 — île centrale à contourner, sable sur les deux routes
  { par: 3, tee: { x: 140, y: 600 }, cup: { x: 1140, y: 120 },
    walls: [...BORD, { x: 560, y: 240, w: 160, h: 240 }],
    sand: [{ x: 380, y: 480, w: 220, h: 140 }, { x: 300, y: 60, w: 200, h: 130 }] },
  // 5 — double virage en Z (sous le mur 1, monter, passer au-dessus du mur 2)
  { par: 4, tee: { x: 180, y: 600 }, cup: { x: 1120, y: 120 },
    walls: [...BORD, { x: 420, y: 20, w: 40, h: 460 }, { x: 820, y: 240, w: 40, h: 460 }],
    sand: [{ x: 560, y: 300, w: 170, h: 120 }, { x: 930, y: 60, w: 150, h: 110 }] },
  // 6 — bunkers en plein sur la trajectoire directe, piliers sur les bandes bancaires
  { par: 3, tee: { x: 140, y: 360 }, cup: { x: 1140, y: 360 },
    walls: [...BORD, { x: 640, y: 120, w: 36, h: 100 }, { x: 640, y: 500, w: 36, h: 100 }],
    sand: [{ x: 420, y: 250, w: 220, h: 220 }, { x: 860, y: 270, w: 200, h: 180 }] },
  // 7 — le doigt : mur sortant du mur droit, ace possible par banque au plafond
  { par: 2, tee: { x: 150, y: 560 }, cup: { x: 1150, y: 140 },
    walls: [...BORD, { x: 1060, y: 300, w: 200, h: 40 }],
    sand: [{ x: 860, y: 440, w: 200, h: 140 }, { x: 380, y: 150, w: 150, h: 120 }] },
  // 8 — le H : deux couloirs reliés par un passage central
  { par: 3, tee: { x: 150, y: 160 }, cup: { x: 1130, y: 560 },
    walls: [...BORD, { x: 20, y: 340, w: 520, h: 40 }, { x: 720, y: 340, w: 540, h: 40 }],
    sand: [{ x: 360, y: 110, w: 150, h: 150 }, { x: 820, y: 430, w: 170, h: 150 }] },
  // 9 — final : green muré ouvert à droite, sable gardant l'entrée directe
  { par: 4, tee: { x: 1100, y: 600 }, cup: { x: 620, y: 320 },
    walls: [...BORD, { x: 440, y: 160, w: 40, h: 280 }, { x: 440, y: 160, w: 440, h: 40 }, { x: 440, y: 440, w: 320, h: 40 }],
    sand: [{ x: 860, y: 420, w: 190, h: 170 }] },
];

const REST = 0.78;        // restitution des rebonds
const STOP_V = 14;        // en dessous : le coup est fini
const CUP_R = 17;         // rayon de capture du trou
const CUP_VMAX = 260;     // au-delà, la balle passe dessus (débattement)
const CHARGE_T = 1.1;     // secondes pour remplir la jauge
const SAND_COL = '#c9a97e'; // teinte désaturée du blob dans le sable

export class GolfGame extends BaseGame {
  [key: string]: any;
  static meta: GameMeta = {
    id: 'golf', name: 'BLOB GOLF', accent: '#f97316', mood: 'cave',
    desc: '9 trous, le moins de coups', controls: 'Stick viser · A maintenir = puissance',
    keys: "Flèches + Espace",
    hint: 'Vise au stick · maintiens A pour charger, relâche pour tirer',
    unit: 'pts', ranks: [100, 85, 70, 50, 0],
  };

  constructor(engine: EngineLike) {
    super(engine);
    this.blob.r = 13;
    this.holeIdx = 0;
    this.totalStrokes = 0;
    this.strokes = 0;
    this.gauge = 0;
    this.aimAng = 0;
    this.hitCd = 0;      // anti-spam son/burst des rebonds
    this.cupDip = 0;     // débattement visuel au-dessus du trou
    this.cupDipCd = 0;
    this.sinkT = 0;
    this.introT = 0;
    this.loadHole(0);
  }

  loadHole(i: number): void {
    this.holeIdx = i;
    this.hole = HOLES[i];
    this.strokes = 0;
    this.phase = 'aim';  // 'aim' | 'charge' | 'fly' | 'sunk' (this.state reste à BaseGame)
    this.gauge = 0;
    this.introT = 1.9;
    this.cupDip = 0;
    const b = this.blob;
    b.x = this.hole.tee.x; b.y = this.hole.tee.y;
    b.vx = 0; b.vy = 0; b.r = 13;
    b.trail.length = 0; b.trailOn = false; b.dead = false;
    // QoL : l'angle initial pointe vers le trou
    this.aimAng = Math.atan2(this.hole.cup.y - b.y, this.hole.cup.x - b.x);
    if (i > 0) this.musicEvent('waveStart', 0.25);
  }

  inSand(): boolean {
    const b = this.blob;
    for (const s of this.hole.sand) {
      if (b.x > s.x - 4 && b.x < s.x + s.w + 4 && b.y > s.y - 4 && b.y < s.y + s.h + 4) return true;
    }
    return false;
  }

  // Cercle vs AABB : repousse hors du mur + réflexion sur la normale (axe de moindre pénétration).
  hitWall(w: any): any {
    const b = this.blob, r = b.r;
    const nx = Math.max(w.x, Math.min(b.x, w.x + w.w));
    const ny = Math.max(w.y, Math.min(b.y, w.y + w.h));
    const dx = b.x - nx, dy = b.y - ny;
    const d2 = dx * dx + dy * dy;
    if (d2 > r * r) return null;
    let d = Math.sqrt(d2), px, py;
    if (d > 1e-4) { px = dx / d; py = dy / d; }
    else {
      // centre à l'intérieur du bloc : sortir par la face la plus proche
      const l = b.x - w.x, rr = w.x + w.w - b.x, t = b.y - w.y, bo = w.y + w.h - b.y;
      const m = Math.min(l, rr, t, bo);
      if (m === l) { px = -1; py = 0; d = -l; }
      else if (m === rr) { px = 1; py = 0; d = -rr; }
      else if (m === t) { px = 0; py = -1; d = -t; }
      else { px = 0; py = 1; d = -bo; }
    }
    b.x += px * (r - d);
    b.y += py * (r - d);
    const vn = b.vx * px + b.vy * py;
    let imp = 0;
    if (vn < 0) {
      imp = -vn;
      b.vx -= (1 + REST) * vn * px;
      b.vy -= (1 + REST) * vn * py;
    }
    return { imp, px, py, cx: b.x - px * r, cy: b.y - py * r };
  }

  update(dt: number): void {
    if (this.baseUpdate(dt)) return;
    const b = this.blob, I = this.input;
    this.hitCd = Math.max(0, this.hitCd - dt);
    this.cupDipCd = Math.max(0, this.cupDipCd - dt);
    this.introT = Math.max(0, this.introT - dt);

    // teinte du blob désaturée tant qu'il est dans le sable
    b.color = this.inSand() ? SAND_COL : this.accent;

    if (this.phase === 'aim') {
      this.updateAim(dt);
      if (I.pressed('a')) { this.phase = 'charge'; this.gauge = 0; this.audio.whiff(); }
    } else if (this.phase === 'charge') {
      this.updateAim(dt);
      this.gauge = Math.min(1, this.gauge + dt / CHARGE_T);
      if (!I.down('a')) this.shoot();
    } else if (this.phase === 'fly') {
      this.updateFly(dt);
    } else if (this.phase === 'sunk') {
      this.updateSunk(dt);
    }

    // posé, le blob regarde dans la direction de visée
    if (this.phase === 'aim' || this.phase === 'charge') {
      const k = Math.min(1, dt * 7);
      b.lookX += (Math.cos(this.aimAng) - b.lookX) * k;
      b.lookY += (Math.sin(this.aimAng) - b.lookY) * k;
    }

    b.update(dt);
  }

  updateAim(dt: number): void {
    const I = this.input;
    const l = Math.hypot(I.moveX, I.moveY);
    if (l > 0.25) {
      const target = Math.atan2(I.moveY, I.moveX);
      let d = target - this.aimAng;
      d = Math.atan2(Math.sin(d), Math.cos(d)); // plus court chemin angulaire
      this.aimAng += d * (1 - Math.exp(-10 * dt));
    }
  }

  shoot(): void {
    const b = this.blob;
    const sp = 340 + 640 * this.gauge;
    b.vx = Math.cos(this.aimAng) * sp;
    b.vy = Math.sin(this.aimAng) * sp;
    this.strokes++;
    this.gauge = 0;
    this.phase = 'fly';
    this.hitCd = 0;
    b.trailOn = true;
    b.punch(0.4);
    this.audio.dash();
    this.input.rumble(0.35, 0.1);
    this.fx.burst(b.x - Math.cos(this.aimAng) * 16, b.y - Math.sin(this.aimAng) * 16, {
      n: 10, speed: [60, 260], colors: [this.accent, '#ffe3c4', '#ffffff'], size: [2, 4], life: 0.35,
      ang: this.aimAng + Math.PI, spread: 0.9,
    });
    this.fx.ring(b.x, b.y, { r0: 8, r1: 42, color: this.accent, life: 0.22, width: 2.5 });
  }

  updateFly(dt: number): void {
    const b = this.blob, hole = this.hole, cup = hole.cup;

    // friction exponentielle, beaucoup plus forte dans le sable
    const f = Math.pow(this.inSand() ? 0.90 : 0.985, dt * 60);
    b.vx *= f; b.vy *= f;
    b.x += b.vx * dt; b.y += b.vy * dt;

    // sable qui gicle sous le blob
    if (this.inSand() && Math.random() < 0.5) {
      this.fx.burst(b.x, b.y, { n: 1, speed: [20, 90], colors: ['#c2b280', '#a89868'], size: [1.5, 3.5], life: 0.4, grav: 220 });
    }

    // collisions murs (2 passes pour les coins)
    let imp = 0, hit = null;
    for (let p = 0; p < 2; p++) {
      for (const w of hole.walls) {
        const h = this.hitWall(w);
        if (h && h.imp > imp) { imp = h.imp; hit = h; }
      }
    }
    if (hit && imp > 60 && this.hitCd <= 0) {
      this.hitCd = 0.09;
      this.audio.hitEnemy();
      b.punch(Math.min(0.45, imp / 900));
      this.fx.burst(hit.cx, hit.cy, {
        n: 5, speed: [40, 190], colors: ['#cfd8ea', '#ffffff'], size: [1.5, 3], life: 0.3,
        ang: Math.atan2(hit.py, hit.px), spread: 1.3,
      });
      if (imp > 300) { this.fx.shake(0.08); this.input.rumble(0.25, 0.07); }
    }

    // filet de sécurité : jamais hors de la bordure
    b.x = Math.max(20 + b.r, Math.min(1260 - b.r, b.x));
    b.y = Math.max(20 + b.r, Math.min(700 - b.r, b.y));

    const sp = Math.hypot(b.vx, b.vy);

    // trou : capturé si assez lent, sinon simple débattement (la balle passe dessus)
    const dc = Math.hypot(b.x - cup.x, b.y - cup.y);
    const overCup = dc < CUP_R && sp >= CUP_VMAX;
    this.cupDip += ((overCup ? 1 : 0) - this.cupDip) * Math.min(1, dt * 12);
    if (overCup && this.cupDipCd <= 0) { this.cupDipCd = 0.3; b.punch(0.16); }
    if (dc < CUP_R && sp < CUP_VMAX) { this.sink(); return; }

    // arrêt → retour en visée, angle initial vers le trou
    if (sp < STOP_V) {
      b.vx = 0; b.vy = 0;
      this.phase = 'aim';
      b.trailOn = false;
      this.aimAng = Math.atan2(cup.y - b.y, cup.x - b.x);
      this.audio.land();
    }
  }

  sink(): void {
    const hole = this.hole;
    this.phase = 'sunk';
    this.sinkT = 0;
    const b = this.blob;
    b.trailOn = false;
    b.vx *= 0.25; b.vy *= 0.25;
    this.totalStrokes += this.strokes;

    const diff = this.strokes - hole.par;
    const label = diff <= -2 ? 'EAGLE' : diff === -1 ? 'BIRDIE' : diff === 0 ? 'PAR' : diff === 1 ? 'BOGEY' : '+' + diff;
    const pts = Math.max(0, 10 - diff * 3);
    this.score += pts;
    this.musicEvent('waveComplete', 0.45);
    if (this.strokes === 1) this.musicEvent('holeInOne', 1);

    this.audio.milestone();
    if (diff <= -1) this.audio.perfect();
    else if (diff >= 2) this.audio.miss();
    this.input.rumble(0.5, 0.2);
    this.fx.burst(hole.cup.x, hole.cup.y, {
      n: 30, speed: [70, 380], colors: [this.accent, '#ffd166', '#ffffff', '#a3e635'], size: [2, 5],
      life: 0.9, shape: 'sq', grav: 340, drag: 0.94,
    });
    this.fx.ring(hole.cup.x, hole.cup.y, { r0: 12, r1: 84, color: this.accent, life: 0.45, width: 3 });
    this.fx.text(hole.cup.x, hole.cup.y - 46, label, { color: diff <= 0 ? '#ffd166' : '#e8ecf2', size: 30, life: 1.3 });
    this.fx.text(hole.cup.x, hole.cup.y - 14, '+' + pts + ' pts', { color: '#aeb8c8', size: 16, mono: true, life: 1.3 });
  }

  updateSunk(dt: number): void {
    const b = this.blob, cup = this.hole.cup;
    this.sinkT += dt;
    const k = Math.min(1, this.sinkT / 0.4);
    b.x += (cup.x - b.x) * Math.min(1, dt * 14);
    b.y += (cup.y - b.y) * Math.min(1, dt * 14);
    b.vx *= Math.pow(0.9, dt * 60); b.vy *= Math.pow(0.9, dt * 60);
    b.r = 13 * (1 - k); // le blob s'enfonce dans le trou
    if (this.sinkT > 1.0) {
      if (this.holeIdx >= HOLES.length - 1) this.over(true);
      else this.loadHole(this.holeIdx + 1);
    }
  }

  drawAim(ctx: CanvasRenderingContext2D): void {
    const b = this.blob;
    const ca = Math.cos(this.aimAng), sa = Math.sin(this.aimAng);
    const pulse = 0.55 + 0.45 * Math.sin(this.time * (this.phase === 'charge' ? 18 : 6));
    const range = 110 + this.gauge * 330;

    // Prévisualisation de trajectoire : courte au repos, elle s'allonge avec
    // la charge et garde le lien entre le geste et la puissance réelle.
    ctx.save();
    ctx.globalAlpha = 0.22 + this.gauge * 0.22;
    ctx.strokeStyle = this.phase === 'charge' ? this.accent : '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 9]);
    ctx.beginPath();
    ctx.moveTo(b.x + ca * (b.r + 8), b.y + sa * (b.r + 8));
    ctx.lineTo(b.x + ca * range, b.y + sa * range);
    ctx.stroke();
    ctx.restore();

    // Flèche ponctuée superposée, plus lisible sur les fonds chargés.
    for (let i = 0; i < 9; i++) {
      const d = b.r + 8 + i * Math.max(13, (range - b.r - 8) / 9);
      ctx.globalAlpha = pulse * (1 - i * 0.09);
      ctx.fillStyle = this.phase === 'charge' ? this.accent : '#ffffff';
      ctx.beginPath();
      ctx.arc(b.x + ca * d, b.y + sa * d, Math.max(1.8, 3.4 - i * 0.22), 0, 6.2832);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#0a140c';
    ctx.fillRect(0, 0, 1280, 720);

    this.fx.world(ctx);
    const hole = this.hole, cup = hole.cup, b = this.blob;

    // bandes de tonte
    ctx.fillStyle = 'rgba(255,255,255,0.02)';
    for (let x = 20; x < 1260; x += 160) ctx.fillRect(x, 20, 80, 680);

    // sable
    for (const s of hole.sand) {
      UI.roundRect(ctx, s.x, s.y, s.w, s.h, 16);
      ctx.fillStyle = '#c2b28033';
      ctx.fill();
      ctx.strokeStyle = '#c2b28059';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // murs gris ardoise + liseré
    for (const w of hole.walls) {
      ctx.fillStyle = '#2a3242';
      ctx.fillRect(w.x, w.y, w.w, w.h);
      ctx.strokeStyle = '#46516b';
      ctx.lineWidth = 2;
      ctx.strokeRect(w.x + 1, w.y + 1, w.w - 2, w.h - 2);
    }

    // tee : disque discret
    ctx.beginPath();
    ctx.arc(hole.tee.x, hole.tee.y, 12, 0, 6.2832);
    ctx.fillStyle = '#ffffff14';
    ctx.fill();
    ctx.strokeStyle = '#ffffff2b';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // trou + drapeau (mât + triangle accent)
    ctx.beginPath();
    ctx.arc(cup.x, cup.y, CUP_R, 0, 6.2832);
    ctx.fillStyle = '#04070a';
    ctx.fill();
    ctx.globalAlpha = 0.22 + 0.1 * Math.sin(this.time * 4 + this.holeIdx);
    ctx.strokeStyle = this.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cup.x, cup.y, CUP_R + 9 + Math.sin(this.time * 3) * 2, 0, 6.2832);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = this.accent;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    const wave = Math.sin(this.time * 3 + this.holeIdx) * 3;
    ctx.strokeStyle = '#d8dee8';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(cup.x, cup.y);
    ctx.lineTo(cup.x, cup.y - 46);
    ctx.stroke();
    ctx.fillStyle = this.accent;
    ctx.beginPath();
    ctx.moveTo(cup.x, cup.y - 46);
    ctx.lineTo(cup.x + 24 + wave, cup.y - 38);
    ctx.lineTo(cup.x, cup.y - 30);
    ctx.closePath();
    ctx.fill();

    // visée
    if (this.phase === 'aim' || this.phase === 'charge') this.drawAim(ctx);

    // blob (débattement vers le trou s'il passe trop vite dessus)
    if (this.phase === 'fly' && this.cupDip > 0.02) {
      const d = Math.hypot(b.x - cup.x, b.y - cup.y) || 1;
      ctx.save();
      ctx.translate((cup.x - b.x) / d * this.cupDip * 5, (cup.y - b.y) / d * this.cupDip * 5);
      b.render(ctx);
      ctx.restore();
    } else {
      b.render(ctx);
    }

    this.fx.drawWorld(ctx);
    this.fx.endWorld(ctx);

    // HUD
    UI.drawHUD(ctx, {
      accent: this.accent,
      score: this.score,
      unit: this.meta.unit,
      extra: () => UI.txt(ctx, 'TOTAL ' + this.totalStrokes + ' COUPS', 28, 70, { size: 12, mono: true, color: '#7c8698' }),
    });
    UI.txt(ctx, `TROU ${this.holeIdx + 1}/9 · PAR ${hole.par} · COUPS ${this.strokes}`, 640, 52, {
      size: 24, align: 'center', mono: true, color: '#dfe6f0', shadow: true,
    });

    // jauge de puissance (style jauge boost de cave.js)
    const bw = 240, bx = 640 - bw / 2, by = 680;
    UI.panel(ctx, bx - 10, by - 10, bw + 20, 40, {
      radius: 12,
      fill: 'rgba(8, 11, 18, 0.66)',
      stroke: this.phase === 'charge' ? this.accent + '99' : '#ffffff2e',
      lineWidth: 1.25,
    });
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(bx, by, bw, 9);
    if (this.gauge > 0) {
      ctx.fillStyle = this.gauge < 1 || Math.sin(this.time * 20) > 0 ? this.accent : '#ffd166';
      ctx.fillRect(bx, by, bw * this.gauge, 9);
    }
    UI.txt(ctx, 'A · PUISSANCE', 640, 710, { size: 11, align: 'center', color: '#5d6480' });

    if (this.phase === 'fly' && this.inSand()) {
      UI.panel(ctx, 520, 102, 240, 32, { radius: 16, fill: 'rgba(38, 29, 18, 0.82)', stroke: '#c2b28077', lineWidth: 1.25 });
      UI.txt(ctx, 'SABLE · VITESSE RÉDUITE', 640, 123, { size: 10.5, align: 'center', mono: true, color: '#e6c891', weight: 800 });
    }

    // intro de trou
    if (this.introT > 0 && this.state !== 'over') {
      ctx.globalAlpha = Math.min(1, this.introT / 0.5);
      UI.txt(ctx, 'TROU ' + (this.holeIdx + 1), 640, 288, { size: 54, align: 'center', color: this.accent, weight: 900 });
      UI.txt(ctx, 'PAR ' + hole.par, 640, 330, { size: 22, align: 'center', color: '#aeb8c8' });
      ctx.globalAlpha = 1;
    }

    this.drawCommon(ctx);
  }
}
