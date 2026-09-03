// BLOB GOLF — mini-golf 9 trous faits main : visée au stick (lissée), coup chargé au A,
// rebonds restitués sur les murs, bunkers de sable qui freinent, trou capturé à vitesse douce.

import { BaseGame } from '../core/game';
import { Blob } from '../core/blob';
import * as UI from '../core/ui';
import type { EngineLike, GameMeta, GameSession, PlayerInputLike } from '../core/types';

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

const REST = 0.76;
const STOP_V = 10;
const CUP_R = 18;
const CUP_VMAX = 230;
const CHARGE_T = 1.48;
const PLAYER_COLORS = ['#f97316', '#38bdf8'] as const;

interface GolfPlayerState {
  blob: Blob;
  strokes: number;
  total: number;
  sunk: boolean;
  lastGauge: number;
  precision: boolean;
  aimAng: number;
  aimVel: number;
}

interface MotionBody { x: number; y: number; vx: number; vy: number; r: number }
interface WallHit { imp: number; px: number; py: number; cx: number; cy: number }

export function golfShotSpeed(gauge: number): number {
  const g = Math.max(0, Math.min(1, gauge));
  const curved = g * g * (3 - 2 * g);
  return 145 + 755 * curved;
}

export function golfAngleDelta(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

export function resolveGolfWall(body: MotionBody, w: { x: number; y: number; w: number; h: number }, restitution = REST): WallHit | null {
  const nx = Math.max(w.x, Math.min(body.x, w.x + w.w));
  const ny = Math.max(w.y, Math.min(body.y, w.y + w.h));
  const dx = body.x - nx;
  const dy = body.y - ny;
  if (dx * dx + dy * dy > body.r * body.r) return null;
  let d = Math.hypot(dx, dy);
  let px = 0;
  let py = 0;
  if (d > 1e-4) {
    px = dx / d;
    py = dy / d;
  } else {
    const distances = [body.x - w.x, w.x + w.w - body.x, body.y - w.y, w.y + w.h - body.y];
    const side = distances.indexOf(Math.min(...distances));
    px = side === 0 ? -1 : side === 1 ? 1 : 0;
    py = side === 2 ? -1 : side === 3 ? 1 : 0;
    d = -distances[side];
  }
  body.x += px * (body.r - d);
  body.y += py * (body.r - d);
  const vn = body.vx * px + body.vy * py;
  const imp = Math.max(0, -vn);
  if (vn < 0) {
    body.vx -= (1 + restitution) * vn * px;
    body.vy -= (1 + restitution) * vn * py;
  }
  return { imp, px, py, cx: body.x - px * body.r, cy: body.y - py * body.r };
}

export class GolfGame extends BaseGame {
  static meta: GameMeta = {
    id: 'golf', name: 'BLOB GOLF', accent: PLAYER_COLORS[0], mood: 'cave',
    desc: 'Mini-golf tactile · trajectoires et duel local',
    controls: 'Stick viser · A charger · X précision · B annuler',
    keys: '← → viser · ↑ trou · Espace charger · L précision',
    hint: 'Stick = visée libre · ← → rotation · ↑ vise le trou · A/Espace charge puis tire',
    unit: 'pts', ranks: [105, 90, 72, 50, 0],
    players: { min: 1, max: 2 },
  };

  readonly versus: boolean;
  readonly golfer: GolfPlayerState[];
  holeIdx = 0;
  hole = HOLES[0];
  activePlayer = 0;
  phase: 'aim' | 'charge' | 'fly' | 'sunk' | 'holeEnd' = 'aim';
  gauge = 0;
  hitCd = 0;
  rollCd = 0;
  sandCd = 0;
  cupDip = 0;
  cupDipCd = 0;
  sinkT = 0;
  introT = 0;
  turnT = 0;
  winner = -2;
  chargeCue = 0;
  wasSand = false;

  constructor(engine: EngineLike, session?: GameSession) {
    super(engine, session);
    this.versus = this.session.mode === 'local' && this.session.playerCount > 1;
    const count = this.versus ? 2 : 1;
    this.golfer = Array.from({ length: count }, (_, index) => ({
      blob: new Blob({ r: 14, color: PLAYER_COLORS[index], trailOn: false }),
      strokes: 0,
      total: 0,
      sunk: false,
      lastGauge: 0.46,
      precision: false,
      aimAng: 0,
      aimVel: 0,
    }));
    this.blob = this.golfer[0].blob;
    this.loadHole(0);
  }

  private get player(): GolfPlayerState { return this.golfer[this.activePlayer]; }
  private get control(): PlayerInputLike { return this.players[this.activePlayer] || this.players[0]; }

  private loadHole(index: number): void {
    this.holeIdx = index;
    this.hole = HOLES[index];
    this.activePlayer = index % this.golfer.length;
    this.phase = 'aim';
    this.gauge = 0;
    this.introT = 2.1;
    this.turnT = 0.75;
    this.cupDip = 0;
    for (let i = 0; i < this.golfer.length; i++) {
      const player = this.golfer[i];
      player.strokes = 0;
      player.sunk = false;
      player.aimVel = 0;
      const offset = this.versus ? (i === 0 ? -10 : 10) : 0;
      player.blob.x = this.hole.tee.x;
      player.blob.y = this.hole.tee.y + offset;
      player.blob.vx = 0;
      player.blob.vy = 0;
      player.blob.r = 14;
      player.blob.color = PLAYER_COLORS[i];
      player.blob.trail.length = 0;
      player.blob.trailOn = false;
      player.blob.dead = false;
      player.blob.scared = false;
      player.blob.setEmotion('focused');
      player.aimAng = Math.atan2(this.hole.cup.y - player.blob.y, this.hole.cup.x - player.blob.x);
    }
    this.blob = this.player.blob;
    this.audio.tone({ f: 330 + index * 18, f1: 495 + index * 24, type: 'triangle', dur: 0.18, vol: 0.1 });
    this.audio.noise({ dur: 0.12, f: 1200, f1: 2600, type: 'bandpass', vol: 0.035 });
    if (index > 0) this.musicEvent('waveStart', 0.4);
  }

  private inSand(blob: MotionBody = this.blob): boolean {
    return this.hole.sand.some((s) => blob.x > s.x - 4 && blob.x < s.x + s.w + 4 && blob.y > s.y - 4 && blob.y < s.y + s.h + 4);
  }

  private updateAim(dt: number): void {
    const input = this.control;
    const player = this.player;
    const fine = player.precision || input.down('lb') || input.down('rb');
    let digital = 0;
    if (input.down('left') || input.down('lb')) digital--;
    if (input.down('right') || input.down('rb')) digital++;

    if (digital !== 0) {
      const desired = digital * (fine ? 0.72 : 2.25);
      player.aimVel += (desired - player.aimVel) * (1 - Math.exp(-dt * 16));
      player.aimAng += player.aimVel * dt;
      this.rollCd -= dt;
      if (this.rollCd <= 0) {
        this.rollCd = fine ? 0.18 : 0.11;
        this.audio.tone({ f: fine ? 760 : 520, type: 'sine', dur: 0.025, vol: 0.025 });
      }
    } else {
      player.aimVel *= Math.exp(-dt * 14);
      const ax = Math.abs(input.aimX) + Math.abs(input.aimY) > 0.32 ? input.aimX : input.moveX;
      const ay = Math.abs(input.aimX) + Math.abs(input.aimY) > 0.32 ? input.aimY : input.moveY;
      if (Math.hypot(ax, ay) > 0.34 && !input.down('up') && !input.down('down')) {
        const target = Math.atan2(ay, ax);
        player.aimAng += golfAngleDelta(player.aimAng, target) * (1 - Math.exp(-dt * (fine ? 4.2 : 8.5)));
      }
    }

    if (input.pressed('up')) {
      player.aimAng = Math.atan2(this.hole.cup.y - player.blob.y, this.hole.cup.x - player.blob.x);
      player.aimVel = 0;
      this.audio.tone({ f: 660, f1: 990, type: 'sine', dur: 0.08, vol: 0.07 });
      this.fx.ring(this.hole.cup.x, this.hole.cup.y, { r0: CUP_R, r1: 54, color: player.blob.color, life: 0.32, width: 2 });
    }
    if (input.pressed('down')) {
      player.aimAng += Math.PI;
      player.aimVel = 0;
      this.audio.tone({ f: 430, f1: 310, type: 'triangle', dur: 0.07, vol: 0.06 });
    }
    if (input.pressed('x')) {
      player.precision = !player.precision;
      this.audio.tone({ f: player.precision ? 920 : 540, f1: player.precision ? 1180 : 420, type: 'sine', dur: 0.1, vol: 0.065 });
      this.fx.text(player.blob.x, player.blob.y - 42, player.precision ? 'PRÉCISION' : 'VISÉE LIBRE', { color: player.blob.color, size: 13, mono: true });
    }
  }

  private startCharge(): void {
    this.phase = 'charge';
    this.gauge = 0.035;
    this.chargeCue = 0;
    this.player.blob.setEmotion('determined');
    this.audio.tone({ f: 150, f1: 230, type: 'sine', dur: 0.16, vol: 0.075 });
    this.audio.noise({ dur: 0.08, f: 480, f1: 1100, type: 'bandpass', vol: 0.035 });
  }

  private updateCharge(dt: number): void {
    const input = this.control;
    this.updateAim(dt);
    this.gauge = Math.min(1, this.gauge + dt / CHARGE_T);
    const cue = Math.min(4, Math.floor(this.gauge * 4.001));
    if (cue > this.chargeCue) {
      this.chargeCue = cue;
      this.audio.tone({ f: 300 + cue * 150, type: 'triangle', dur: 0.045, vol: 0.055 + cue * 0.008 });
      this.player.blob.punch(0.08 + cue * 0.025);
      this.control.rumble(0.04 + cue * 0.025, 0.025);
    }
    this.player.blob.setPose(1 + this.gauge * 0.34, 1 - this.gauge * 0.22, this.gauge * 0.55);
    if (input.pressed('b')) {
      this.phase = 'aim';
      this.gauge = 0;
      this.player.blob.setPose(1, 1, 0);
      this.player.blob.setEmotion('focused');
      this.audio.tone({ f: 360, f1: 180, type: 'triangle', dur: 0.09, vol: 0.07 });
      this.fx.text(this.blob.x, this.blob.y - 40, 'ANNULÉ', { color: '#94a3b8', size: 12 });
    } else if (!input.down('a')) {
      this.shoot();
    }
  }

  private shoot(): void {
    const player = this.player;
    const blob = player.blob;
    const speed = golfShotSpeed(this.gauge);
    blob.vx = Math.cos(player.aimAng) * speed;
    blob.vy = Math.sin(player.aimAng) * speed;
    player.strokes++;
    player.lastGauge = this.gauge;
    this.phase = 'fly';
    this.hitCd = 0;
    this.rollCd = 0;
    this.sandCd = 0;
    this.wasSand = this.inSand(blob);
    blob.trailOn = true;
    blob.setPose(1, 1, 0);
    blob.setEmotion('wow', 0.22);
    blob.punch(0.48);
    const now = this.audio.ctx?.currentTime || 0;
    this.audio.noise({ dur: 0.11, f: 420, f1: 3800, type: 'bandpass', q: 1.3, vol: 0.14 });
    this.audio.tone({ f: 110 + this.gauge * 90, f1: 520 + this.gauge * 420, type: 'sine', dur: 0.13, vol: 0.105 });
    this.audio.tone({ f: 720, f1: 260, type: 'triangle', t: now + 0.035, dur: 0.07, vol: 0.055 });
    this.control.rumble(0.22 + this.gauge * 0.28, 0.08 + this.gauge * 0.04);
    this.fx.shake(0.025 + this.gauge * 0.055);
    this.fx.burst(blob.x - Math.cos(player.aimAng) * 16, blob.y - Math.sin(player.aimAng) * 16, {
      n: 12 + Math.floor(this.gauge * 8), speed: [60, 280 + this.gauge * 150], colors: [blob.color, '#ffe3c4', '#ffffff'], size: [2, 5], life: 0.4,
      ang: player.aimAng + Math.PI, spread: 0.9,
    });
    this.fx.ring(blob.x, blob.y, { r0: 8, r1: 48 + this.gauge * 24, color: blob.color, life: 0.26, width: 3 });
    this.gauge = 0;
  }

  private updateFly(dt: number): void {
    const blob = this.blob;
    const cup = this.hole.cup;
    this.hitCd = Math.max(0, this.hitCd - dt);
    this.rollCd = Math.max(0, this.rollCd - dt);
    this.sandCd = Math.max(0, this.sandCd - dt);
    this.cupDipCd = Math.max(0, this.cupDipCd - dt);
    const sand = this.inSand(blob);
    const friction = Math.pow(sand ? 0.885 : 0.9865, dt * 60);
    blob.vx *= friction;
    blob.vy *= friction;
    blob.x += blob.vx * dt;
    blob.y += blob.vy * dt;

    if (sand && !this.wasSand) {
      this.audio.noise({ dur: 0.2, f: 1300, f1: 340, type: 'lowpass', vol: 0.11 });
      this.audio.tone({ f: 170, f1: 105, type: 'triangle', dur: 0.16, vol: 0.06 });
      this.fx.text(blob.x, blob.y - 34, 'SABLE', { color: '#f0cf94', size: 13, mono: true });
    }
    this.wasSand = sand;
    if (sand && this.sandCd <= 0) {
      this.sandCd = 0.075;
      this.audio.noise({ dur: 0.045, f: 560, f1: 220, type: 'lowpass', vol: 0.022 });
      this.fx.burst(blob.x, blob.y, { n: 2, speed: [20, 105], colors: ['#d6bb82', '#9b7d4d'], size: [1.5, 3.5], life: 0.42, grav: 220 });
    } else if (!sand && this.rollCd <= 0 && Math.hypot(blob.vx, blob.vy) > 95) {
      this.rollCd = 0.11;
      this.audio.noise({ dur: 0.025, f: 1800, f1: 900, type: 'bandpass', vol: 0.012 });
    }

    let strongest: WallHit | null = null;
    for (let pass = 0; pass < 2; pass++) {
      for (const wall of this.hole.walls) {
        const hit = resolveGolfWall(blob, wall);
        if (hit && (!strongest || hit.imp > strongest.imp)) strongest = hit;
      }
    }
    if (strongest && strongest.imp > 45 && this.hitCd <= 0) {
      this.hitCd = 0.085;
      const pitch = Math.min(1250, 360 + strongest.imp * 1.25);
      this.audio.tone({ f: pitch, f1: pitch * 0.55, type: 'triangle', dur: 0.075, vol: Math.min(0.13, 0.045 + strongest.imp / 6000) });
      this.audio.noise({ dur: 0.055, f: 1900, f1: 700, type: 'bandpass', vol: 0.055 });
      blob.punch(Math.min(0.5, strongest.imp / 850));
      this.fx.burst(strongest.cx, strongest.cy, {
        n: 7, speed: [45, 220], colors: ['#94a3b8', '#e2e8f0', blob.color], size: [1.5, 3.5], life: 0.34,
        ang: Math.atan2(strongest.py, strongest.px), spread: 1.25,
      });
      if (strongest.imp > 280) { this.fx.shake(0.1); this.control.rumble(0.25, 0.07); }
    }

    blob.x = Math.max(20 + blob.r, Math.min(1260 - blob.r, blob.x));
    blob.y = Math.max(20 + blob.r, Math.min(700 - blob.r, blob.y));
    const speed = Math.hypot(blob.vx, blob.vy);
    const cupDistance = Math.hypot(blob.x - cup.x, blob.y - cup.y);
    const overCup = cupDistance < CUP_R && speed >= CUP_VMAX;
    this.cupDip += ((overCup ? 1 : 0) - this.cupDip) * Math.min(1, dt * 12);
    if (overCup && this.cupDipCd <= 0) {
      this.cupDipCd = 0.28;
      blob.punch(0.18);
      this.audio.tone({ f: 240, f1: 160, type: 'sine', dur: 0.1, vol: 0.08 });
      this.audio.noise({ dur: 0.06, f: 800, vol: 0.045 });
    }
    if (cupDistance < CUP_R && speed < CUP_VMAX) { this.sink(); return; }
    if (speed < STOP_V) this.stopBall();
  }

  private stopBall(): void {
    const blob = this.blob;
    blob.vx = 0;
    blob.vy = 0;
    blob.trailOn = false;
    blob.setEmotion('focused');
    this.audio.noise({ dur: 0.065, f: this.inSand(blob) ? 380 : 980, f1: 180, type: 'lowpass', vol: 0.065 });
    this.audio.tone({ f: 105, f1: 74, type: 'sine', dur: 0.1, vol: 0.045 });
    blob.punch(0.15);
    if (this.versus) this.nextTurn();
    else {
      this.phase = 'aim';
      this.player.aimAng = Math.atan2(this.hole.cup.y - blob.y, this.hole.cup.x - blob.x);
    }
  }

  private nextTurn(): void {
    const other = this.activePlayer === 0 ? 1 : 0;
    if (this.golfer[other] && !this.golfer[other].sunk) this.activePlayer = other;
    this.blob = this.player.blob;
    this.phase = 'aim';
    this.turnT = 0.82;
    this.gauge = 0;
    this.player.aimAng = Math.atan2(this.hole.cup.y - this.blob.y, this.hole.cup.x - this.blob.x);
    this.player.aimVel = 0;
    this.audio.tone({ f: this.activePlayer === 0 ? 520 : 660, f1: this.activePlayer === 0 ? 780 : 990, type: 'triangle', dur: 0.12, vol: 0.075 });
    this.fx.ring(this.blob.x, this.blob.y, { r0: 16, r1: 58, color: this.blob.color, life: 0.36, width: 3 });
  }

  private sink(): void {
    const player = this.player;
    const hole = this.hole;
    this.phase = 'sunk';
    this.sinkT = 0;
    player.sunk = true;
    player.total += player.strokes;
    const blob = player.blob;
    blob.trailOn = false;
    blob.vx *= 0.22;
    blob.vy *= 0.22;
    const diff = player.strokes - hole.par;
    const label = player.strokes === 1 ? 'HOLE IN ONE' : diff <= -2 ? 'EAGLE' : diff === -1 ? 'BIRDIE' : diff === 0 ? 'PAR' : diff === 1 ? 'BOGEY' : `+${diff}`;
    const points = Math.max(0, 12 - diff * 3);
    if (!this.versus) this.score += points;
    this.musicEvent('waveComplete', 0.6);
    if (player.strokes === 1) this.musicEvent('holeInOne', 1);

    const now = this.audio.ctx?.currentTime || 0;
    this.audio.noise({ dur: 0.16, f: 900, f1: 120, type: 'lowpass', vol: 0.11 });
    this.audio.tone({ f: 520, f1: 180, type: 'sine', dur: 0.2, vol: 0.11 });
    [660, 880, 1108].forEach((f, i) => this.audio.tone({ f, type: 'triangle', t: now + 0.12 + i * 0.075, dur: 0.1, vol: 0.095 }));
    if (diff <= -1) this.audio.perfect();
    else if (diff >= 2) this.audio.miss();
    this.control.rumble(0.58, 0.22);
    this.fx.burst(hole.cup.x, hole.cup.y, {
      n: 34, speed: [70, 400], colors: [blob.color, '#ffd166', '#ffffff', '#a3e635'], size: [2, 6],
      life: 0.95, shape: 'sq', grav: 340, drag: 0.94,
    });
    this.fx.ring(hole.cup.x, hole.cup.y, { r0: 12, r1: 96, color: blob.color, life: 0.5, width: 4 });
    this.fx.text(hole.cup.x, hole.cup.y - 48, label, { color: diff <= 0 ? '#ffd166' : '#e8ecf2', size: 30, life: 1.4 });
    if (!this.versus) this.fx.text(hole.cup.x, hole.cup.y - 14, `+${points} pts`, { color: '#aeb8c8', size: 16, mono: true, life: 1.3 });
  }

  private updateSunk(dt: number): void {
    const blob = this.blob;
    const cup = this.hole.cup;
    this.sinkT += dt;
    const k = Math.min(1, this.sinkT / 0.42);
    blob.x += (cup.x - blob.x) * Math.min(1, dt * 15);
    blob.y += (cup.y - blob.y) * Math.min(1, dt * 15);
    blob.vx *= Math.pow(0.88, dt * 60);
    blob.vy *= Math.pow(0.88, dt * 60);
    blob.r = 14 * (1 - k);
    if (this.sinkT <= 1.05) return;
    if (this.versus && this.golfer.some((player) => !player.sunk)) {
      this.nextTurn();
      return;
    }
    this.phase = 'holeEnd';
    this.sinkT = 0;
    this.audio.milestone();
  }

  private finishHole(dt: number): void {
    this.sinkT += dt;
    if (this.sinkT < 0.9) return;
    if (this.holeIdx < HOLES.length - 1) {
      this.loadHole(this.holeIdx + 1);
      return;
    }
    if (this.versus) {
      const a = this.golfer[0].total;
      const b = this.golfer[1].total;
      this.winner = a === b ? -1 : a < b ? 0 : 1;
      this.score = Math.max(0, 12000 - Math.min(a, b) * 150);
    } else {
      this.winner = 0;
    }
    this.over(true);
  }

  update(dt: number): void {
    if (this.baseUpdate(dt)) return;
    this.introT = Math.max(0, this.introT - dt);
    this.turnT = Math.max(0, this.turnT - dt);
    if (this.phase === 'aim') {
      this.updateAim(dt);
      if (this.control.pressed('a')) this.startCharge();
    } else if (this.phase === 'charge') this.updateCharge(dt);
    else if (this.phase === 'fly') this.updateFly(dt);
    else if (this.phase === 'sunk') this.updateSunk(dt);
    else this.finishHole(dt);

    for (const player of this.golfer) {
      if (player !== this.player && !player.sunk) {
        player.blob.lookX = Math.cos(player.aimAng);
        player.blob.lookY = Math.sin(player.aimAng);
      }
      player.blob.color = this.inSand(player.blob) ? (player === this.player ? '#d6ad72' : '#9d886f') : PLAYER_COLORS[this.golfer.indexOf(player)];
      player.blob.update(dt);
    }
    if (this.phase === 'aim' || this.phase === 'charge') {
      this.blob.lookX += (Math.cos(this.player.aimAng) - this.blob.lookX) * Math.min(1, dt * 9);
      this.blob.lookY += (Math.sin(this.player.aimAng) - this.blob.lookY) * Math.min(1, dt * 9);
    }
    this.eng.dev.state('golf-phase', this.phase);
    this.eng.dev.count('golf-player', this.activePlayer + 1);
  }

  private predictTrajectory(gauge: number): Array<{ x: number; y: number; bounce: boolean }> {
    const player = this.player;
    const speed = golfShotSpeed(gauge);
    const sim: MotionBody = { x: player.blob.x, y: player.blob.y, vx: Math.cos(player.aimAng) * speed, vy: Math.sin(player.aimAng) * speed, r: player.blob.r };
    const points: Array<{ x: number; y: number; bounce: boolean }> = [{ x: sim.x, y: sim.y, bounce: false }];
    for (let i = 0; i < 130; i++) {
      const sand = this.inSand(sim);
      const friction = Math.pow(sand ? 0.885 : 0.9865, 0.025 * 60);
      sim.vx *= friction;
      sim.vy *= friction;
      sim.x += sim.vx * 0.025;
      sim.y += sim.vy * 0.025;
      let bounce = false;
      for (const wall of this.hole.walls) {
        const hit = resolveGolfWall(sim, wall);
        bounce ||= !!hit && hit.imp > 20;
      }
      if (i % 4 === 0 || bounce) points.push({ x: sim.x, y: sim.y, bounce });
      if (Math.hypot(sim.x - this.hole.cup.x, sim.y - this.hole.cup.y) < CUP_R && Math.hypot(sim.vx, sim.vy) < CUP_VMAX) break;
      if (Math.hypot(sim.vx, sim.vy) < STOP_V) break;
    }
    return points;
  }

  private drawGrass(ctx: CanvasRenderingContext2D): void {
    const gradient = ctx.createLinearGradient(0, 20, 0, 700);
    gradient.addColorStop(0, '#10261a');
    gradient.addColorStop(0.5, '#0c2115');
    gradient.addColorStop(1, '#08180f');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1280, 720);
    for (let x = 20; x < 1260; x += 128) {
      ctx.fillStyle = (x / 128) % 2 < 1 ? '#ffffff07' : '#0000000a';
      ctx.fillRect(x, 20, 64, 680);
    }
    ctx.strokeStyle = '#8bd18b10';
    ctx.lineWidth = 1;
    for (let y = 34; y < 700; y += 26) {
      for (let x = 28 + (y % 3) * 7; x < 1260; x += 34) {
        const lean = Math.sin(x * 0.13 + y * 0.17) * 2;
        ctx.beginPath(); ctx.moveTo(x, y + 3); ctx.lineTo(x + lean, y - 2); ctx.stroke();
      }
    }
  }

  private drawSand(ctx: CanvasRenderingContext2D): void {
    for (const sand of this.hole.sand) {
      UI.roundRect(ctx, sand.x, sand.y, sand.w, sand.h, 18);
      const gradient = ctx.createLinearGradient(sand.x, sand.y, sand.x, sand.y + sand.h);
      gradient.addColorStop(0, '#d7bd8550');
      gradient.addColorStop(1, '#9d77433f');
      ctx.fillStyle = gradient;
      ctx.fill();
      ctx.strokeStyle = '#f0cf9470';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.save();
      UI.roundRect(ctx, sand.x, sand.y, sand.w, sand.h, 18);
      ctx.clip();
      ctx.fillStyle = '#f4d99d38';
      for (let y = sand.y + 10; y < sand.y + sand.h; y += 14) {
        for (let x = sand.x + 11; x < sand.x + sand.w; x += 17) {
          const ox = Math.sin(x * 0.31 + y) * 4;
          ctx.beginPath(); ctx.arc(x + ox, y, 1.15, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.strokeStyle = '#7c5d3638';
      for (let y = sand.y + 22; y < sand.y + sand.h; y += 30) {
        ctx.beginPath(); ctx.moveTo(sand.x + 12, y); ctx.quadraticCurveTo(sand.x + sand.w / 2, y + 8, sand.x + sand.w - 12, y); ctx.stroke();
      }
      ctx.restore();
    }
  }

  private drawWalls(ctx: CanvasRenderingContext2D): void {
    for (const wall of this.hole.walls) {
      const gradient = ctx.createLinearGradient(wall.x, wall.y, wall.x + Math.min(50, wall.w), wall.y + Math.min(50, wall.h));
      gradient.addColorStop(0, '#526074');
      gradient.addColorStop(0.18, '#303b4c');
      gradient.addColorStop(1, '#202938');
      ctx.fillStyle = gradient;
      ctx.fillRect(wall.x, wall.y, wall.w, wall.h);
      ctx.save();
      ctx.beginPath(); ctx.rect(wall.x, wall.y, wall.w, wall.h); ctx.clip();
      ctx.strokeStyle = '#94a3b826';
      ctx.lineWidth = 1;
      const brickH = 16;
      for (let y = wall.y; y <= wall.y + wall.h; y += brickH) {
        ctx.beginPath(); ctx.moveTo(wall.x, y); ctx.lineTo(wall.x + wall.w, y); ctx.stroke();
        const offset = (Math.floor((y - wall.y) / brickH) % 2) * 19;
        for (let x = wall.x - offset; x < wall.x + wall.w; x += 38) {
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + brickH); ctx.stroke();
        }
      }
      ctx.restore();
      ctx.strokeStyle = '#8391a8';
      ctx.lineWidth = 2;
      ctx.strokeRect(wall.x + 1, wall.y + 1, Math.max(0, wall.w - 2), Math.max(0, wall.h - 2));
      ctx.strokeStyle = '#111827aa';
      ctx.strokeRect(wall.x + 4, wall.y + 4, Math.max(0, wall.w - 8), Math.max(0, wall.h - 8));
    }
  }

  private drawAim(ctx: CanvasRenderingContext2D): void {
    const gauge = this.phase === 'charge' ? this.gauge : this.player.lastGauge;
    const points = this.predictTrajectory(gauge);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = this.blob.color;
    ctx.shadowColor = this.blob.color;
    ctx.shadowBlur = 9;
    ctx.globalAlpha = this.phase === 'charge' ? 0.72 : 0.42;
    ctx.lineWidth = this.player.precision ? 2.6 : 2;
    ctx.setLineDash(this.player.precision ? [2, 7] : [5, 9]);
    ctx.beginPath();
    for (let i = 0; i < points.length; i++) {
      if (i === 0) ctx.moveTo(points[i].x, points[i].y);
      else ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    for (const point of points) {
      if (!point.bounce) continue;
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(point.x, point.y, 4.2, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = this.blob.color;
      ctx.beginPath(); ctx.arc(point.x, point.y, 9, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  private drawCup(ctx: CanvasRenderingContext2D): void {
    const cup = this.hole.cup;
    ctx.fillStyle = '#020407';
    ctx.shadowColor = '#000000';
    ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.ellipse(cup.x, cup.y, CUP_R, CUP_R * 0.78, 0, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#d8dee8';
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(cup.x, cup.y); ctx.lineTo(cup.x, cup.y - 48); ctx.stroke();
    const wave = Math.sin(this.time * 3 + this.holeIdx) * 3;
    ctx.fillStyle = this.versus ? PLAYER_COLORS[this.activePlayer] : this.accent;
    ctx.beginPath(); ctx.moveTo(cup.x, cup.y - 48); ctx.lineTo(cup.x + 26 + wave, cup.y - 39); ctx.lineTo(cup.x, cup.y - 30); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 0.25 + Math.sin(this.time * 4) * 0.08;
    ctx.strokeStyle = this.blob.color;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cup.x, cup.y, CUP_R + 9 + Math.sin(this.time * 3) * 2, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  private drawPower(ctx: CanvasRenderingContext2D): void {
    if (this.phase === 'fly' || this.phase === 'sunk' || this.phase === 'holeEnd') return;
    const width = 286;
    const x = 640 - width / 2;
    const y = 674;
    const shown = this.phase === 'charge' ? this.gauge : this.player.lastGauge;
    UI.panel(ctx, x - 14, y - 14, width + 28, 47, {
      radius: 14, fill: 'rgba(5,8,13,.82)', stroke: this.phase === 'charge' ? this.blob.color + 'bb' : '#ffffff2b', lineWidth: 1.5,
    });
    const gradient = ctx.createLinearGradient(x, y, x + width, y);
    gradient.addColorStop(0, '#4ade80'); gradient.addColorStop(0.55, '#facc15'); gradient.addColorStop(1, '#fb7185');
    ctx.fillStyle = '#ffffff12'; ctx.fillRect(x, y, width, 10);
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, width * shown, 10); ctx.clip(); ctx.fillStyle = gradient; ctx.fillRect(x, y, width, 10); ctx.restore();
    for (let i = 1; i < 4; i++) { ctx.fillStyle = '#05080dcc'; ctx.fillRect(x + width * i / 4 - 1, y, 2, 10); }
    UI.txt(ctx, `${Math.round(shown * 100)}%  ·  ${Math.round(golfShotSpeed(shown))}`, 640, 712, { size: 11, align: 'center', mono: true, color: '#8b95a8' });
  }

  render(ctx: CanvasRenderingContext2D): void {
    this.drawGrass(ctx);
    this.fx.world(ctx);
    this.drawSand(ctx);
    this.drawWalls(ctx);
    const tee = this.hole.tee;
    ctx.fillStyle = '#ffffff12'; ctx.beginPath(); ctx.arc(tee.x, tee.y, 14, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#ffffff32'; ctx.lineWidth = 1.5; ctx.stroke();
    this.drawCup(ctx);
    if (this.phase === 'aim' || this.phase === 'charge') this.drawAim(ctx);

    for (let i = 0; i < this.golfer.length; i++) {
      const player = this.golfer[i];
      if (player.sunk && player.blob.r <= 0.2) continue;
      ctx.save();
      ctx.globalAlpha = i === this.activePlayer ? 1 : 0.62;
      if (i === this.activePlayer && this.versus && (this.phase === 'aim' || this.phase === 'charge')) {
        ctx.strokeStyle = PLAYER_COLORS[i] + '99';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(player.blob.x, player.blob.y, 23 + Math.sin(this.time * 5) * 2, 0, Math.PI * 2); ctx.stroke();
      }
      if (i === this.activePlayer && this.phase === 'fly' && this.cupDip > 0.02) {
        const d = Math.hypot(player.blob.x - this.hole.cup.x, player.blob.y - this.hole.cup.y) || 1;
        ctx.translate((this.hole.cup.x - player.blob.x) / d * this.cupDip * 5, (this.hole.cup.y - player.blob.y) / d * this.cupDip * 5);
      }
      player.blob.render(ctx);
      ctx.restore();
    }
    this.fx.drawWorld(ctx);
    this.fx.endWorld(ctx);

    UI.drawHUD(ctx, { accent: this.blob.color, score: Math.floor(this.score), unit: this.meta.unit });
    UI.txt(ctx, `TROU ${this.holeIdx + 1}/9  ·  PAR ${this.hole.par}`, 640, 43, { size: 21, align: 'center', mono: true, color: '#e8edf5', shadow: true });
    if (this.versus) {
      for (let i = 0; i < 2; i++) {
        const x = i === 0 ? 18 : 256;
        const player = this.golfer[i];
        UI.panel(ctx, x, 14, 220, 62, { radius: 14, fill: 'rgba(5,8,13,.78)', stroke: PLAYER_COLORS[i] + (i === this.activePlayer ? 'aa' : '38'), lineWidth: i === this.activePlayer ? 2 : 1 });
        UI.txt(ctx, `J${i + 1}${i === this.activePlayer ? '  À TOI' : ''}`, x + 15, 34, { size: 10, mono: true, color: PLAYER_COLORS[i], weight: 900 });
        UI.txt(ctx, `${player.total} total  ·  ${player.strokes} coups`, x + 15, 61, { size: 15, mono: true, color: '#e2e8f0', weight: 800 });
      }
    } else {
      UI.panel(ctx, 16, 14, 222, 62, { radius: 14, fill: 'rgba(5,8,13,.78)', stroke: this.accent + '44' });
      UI.txt(ctx, 'CARTE', 31, 34, { size: 9, mono: true, color: this.accent, weight: 900 });
      UI.txt(ctx, `${this.player.total} total  ·  ${this.player.strokes} coups`, 31, 61, { size: 15, mono: true, color: '#e2e8f0', weight: 800 });
    }
    if (this.turnT > 0 && this.versus) {
      ctx.globalAlpha = Math.min(1, this.turnT * 3);
      UI.txt(ctx, `JOUEUR ${this.activePlayer + 1}`, 640, 116, { size: 28, align: 'center', color: PLAYER_COLORS[this.activePlayer], weight: 900, shadow: true });
      ctx.globalAlpha = 1;
    }
    if (this.player.precision && (this.phase === 'aim' || this.phase === 'charge')) {
      UI.txt(ctx, 'PRÉCISION', 640, 70, { size: 10, align: 'center', mono: true, color: this.blob.color, weight: 900 });
    }
    if (this.phase === 'fly' && this.inSand()) {
      UI.panel(ctx, 520, 92, 240, 32, { radius: 16, fill: 'rgba(38,29,18,.86)', stroke: '#d6bb8277' });
      UI.txt(ctx, 'SABLE  ·  FREINAGE FORT', 640, 113, { size: 10.5, align: 'center', mono: true, color: '#f0cf94', weight: 900 });
    }
    this.drawPower(ctx);

    if (this.introT > 0 && this.state !== 'over') {
      const alpha = Math.min(1, this.introT / 0.45, (2.1 - this.introT) * 2.2);
      ctx.globalAlpha = alpha;
      UI.txt(ctx, `TROU ${this.holeIdx + 1}`, 640, 286, { size: 54, align: 'center', color: this.accent, weight: 900, shadow: true });
      UI.txt(ctx, `PAR ${this.hole.par}${this.versus ? '  ·  DUEL' : ''}`, 640, 330, { size: 21, align: 'center', color: '#d6dde8' });
      ctx.globalAlpha = 1;
    }
    this.drawCommon(ctx);
    if (this.state === 'over' && this.versus) {
      const result = this.winner < 0 ? 'ÉGALITÉ !' : `JOUEUR ${this.winner + 1} GAGNE`;
      UI.txt(ctx, result, 640, 427, { size: 22, align: 'center', color: this.winner < 0 ? '#facc15' : PLAYER_COLORS[this.winner], weight: 900 });
    }
  }

  debugSnapshot(): Record<string, string | number | boolean | null> {
    return {
      ...super.debugSnapshot(),
      versus: this.versus,
      hole: this.holeIdx + 1,
      phase: this.phase,
      player: this.activePlayer + 1,
      power: Number(this.gauge.toFixed(2)),
      speed: Number(Math.hypot(this.blob.vx, this.blob.vy).toFixed(1)),
      p1Strokes: this.golfer[0].total + this.golfer[0].strokes,
      p2Strokes: this.golfer[1] ? this.golfer[1].total + this.golfer[1].strokes : null,
    };
  }
}
