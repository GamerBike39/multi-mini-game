// BLOB FROGGER — traverse la route, surfe la rivière, remplis les 5 alcôves.
// Grille 15×12, hops discrets (0.11 s) avec buffer, ride sur rondins/tortues,
// timer par traversée, 3 vies, niveaux qui accélèrent.
// Textures 100 % procédurales (asphalte, herbe, eau, bois, carapaces, capsules
// hostiles) + game feel arcade : squash, dust, rings, hitstop, near-miss, splash.

import { BaseGame } from '../core/game';
import * as UI from '../core/ui';
import { SeededRng } from '../core/rng';
import type { EngineLike, GameMeta, InputLike } from '../core/types';

const TAU = Math.PI * 2;

export const FROG_COLS = 15;
export const FROG_ROWS = 12;
export const FROG_CELL = 48;
export const FROG_LEFT = 280;
export const FROG_TOP = 100;
export const FROG_HOME_COLS = [1, 4, 7, 10, 13] as const;
export const FROG_HOP_DUR = 0.11;
export const FROG_START_LIVES = 3;
export const FROG_MAX_LEVEL_MULT = 2.2;

export type FrogDeathCause = 'car' | 'drown' | 'time' | 'edge' | 'sunk';
export type FrogMoverKind = 'car' | 'truck' | 'log' | 'turtle' | 'lily';

export interface FrogMover {
  off: number; // bord gauche, en cellules (peut dépasser 0..COLS)
  len: number; // en cellules
  kind: FrogMoverKind;
  variant: number;
  phase: number;
  sinkT: number;
}

export interface FrogLane {
  kind: 'home' | 'river' | 'bank' | 'road' | 'start';
  dir: 1 | -1 | 0;
  speed: number; // px/s à niveau 1
  movers: FrogMover[];
}

export function frogIsHomeCol(c: number): boolean {
  return (FROG_HOME_COLS as readonly number[]).includes(c);
}

export function frogHomeIndex(c: number): number {
  return (FROG_HOME_COLS as readonly number[]).indexOf(c);
}

export function frogLevelMult(level: number): number {
  const l = Math.max(1, Math.floor(level));
  return Math.min(FROG_MAX_LEVEL_MULT, 1 + (l - 1) * 0.13);
}

export function frogLevelTime(level: number): number {
  return Math.max(30, 60 - (Math.max(1, Math.floor(level)) - 1) * 5);
}

export function frogOverlaps(ax: number, aw: number, bx: number, bw: number): boolean {
  return ax < bx + bw && bx < ax + aw;
}

export function frogCellCenterX(c: number): number {
  return FROG_LEFT + (c + 0.5) * FROG_CELL;
}

export function frogCellCenterY(r: number): number {
  return FROG_TOP + (r + 0.5) * FROG_CELL;
}

function easeOut(k: number): number {
  const t = Math.max(0, Math.min(1, k));
  return 1 - Math.pow(1 - t, 3);
}

const CAR_COLORS = ['#ff5470', '#fb923c', '#c084fc', '#fbbf24', '#38bdf8'];

interface Hop {
  fc: number;
  fr: number;
  tc: number;
  tr: number;
  fx: number;
  fy: number;
  tx: number;
  ty: number;
  t: number;
  dur: number;
}

interface Speck {
  x: number;
  y: number;
  r: number;
  a: number;
}

interface Blade {
  x: number;
  y: number;
  lean: number;
  h: number;
  l: number;
}

export class FrogGame extends BaseGame {
  [key: string]: any;
  static meta: GameMeta = {
    id: 'frog', name: 'BLOB FROGGER', accent: '#2dd4bf', mood: 'runner',
    desc: 'Route, rivière, 5 alcôves. Ne finis ni écrasé ni trempé.',
    controls: 'Flèches / Stick sauter case par case',
    keys: 'Flèches / ZQSD',
    hint: 'Haut = avancer · rondins = surf · tortues coulent · 5 alcôves = niveau suivant',
    unit: 'pts', ranks: [4000, 2500, 1500, 800, 0],
  };

  lanes: FrogLane[] = [];
  c = 7;
  r = 11;
  px = frogCellCenterX(7);
  py = frogCellCenterY(11);
  hop: Hop | null = null;
  buffered: { dc: number; dr: number } | null = null;
  lastStick: [number, number] | null = null;
  holdDir: { dc: number; dr: number } | null = null;
  holdT = 0;
  maxRow = 11;
  forwardStep = 0;
  level = 1;
  lives: number = FROG_START_LIVES;
  timeLeft = 60;
  lastTickSec = -1;
  homes: boolean[] = [false, false, false, false, false];
  flySlot = -1;
  flyT = 0;
  dying = false;
  dyingT = 0;
  dyingCause: FrogDeathCause = 'car';
  nearCd = 0;
  nearCount = 0;
  homesDone = 0;
  visualRng: SeededRng;
  specks: Speck[] = [];
  blades: Blade[] = [];
  sparks: Speck[] = [];
  wheelAng = 0;

  constructor(engine: EngineLike) {
    super(engine);
    this.visualRng = new SeededRng((this.session.seed ^ 0xF209) >>> 0);
    this.blob.r = 16;
    this.blob.color = this.accent;
    this.blob.trailOn = false;
    this.blob.setEmotion('focused');
    this.buildLanes();
    this.resetPosition(true);
    this.timeLeft = frogLevelTime(1);
    this.pickFly();
    for (let i = 0; i < 150; i++) {
      this.specks.push({
        x: this.visualRng.next(), y: this.visualRng.next(),
        r: 0.6 + this.visualRng.next() * 1.6, a: 0.04 + this.visualRng.next() * 0.1,
      });
    }
    for (let i = 0; i < 220; i++) {
      this.blades.push({
        x: this.visualRng.next(), y: this.visualRng.next(),
        lean: (this.visualRng.next() - 0.5) * 6, h: 3 + this.visualRng.next() * 6,
        l: 0.5 + this.visualRng.next() * 0.5,
      });
    }
    for (let i = 0; i < 90; i++) {
      this.sparks.push({
        x: this.visualRng.next(), y: this.visualRng.next(),
        r: 0.8 + this.visualRng.next() * 2, a: 0.1 + this.visualRng.next() * 0.25,
      });
    }
  }

  // ---------- construction déterministe ----------
  buildLanes(): void {
    const R = this.rng;
    const mk = (kind: FrogLane['kind'], dir: 1 | -1 | 0, speed: number): FrogLane => ({ kind, dir, speed, movers: [] });
    this.lanes = [
      mk('home', 0, 0),
      mk('river', -1, 70),
      mk('river', 1, 95),
      mk('river', -1, 125),
      mk('river', 1, 85),
      mk('bank', 0, 0),
      mk('road', 1, 130),
      mk('road', -1, 175),
      mk('road', 1, 150),
      mk('road', -1, 200),
      mk('road', 1, 115),
      mk('start', 0, 0),
    ];
    const fill = (row: number, count: number, kind: FrogMoverKind, lmin: number, lmax: number): void => {
      const lane = this.lanes[row];
      for (let i = 0; i < count; i++) {
        const len = lmin + R.next() * (lmax - lmin);
        const off = i * (FROG_COLS / count) + (R.next() - 0.5) * 1.6;
        lane.movers.push({
          off, len, kind,
          variant: R.int(0, kind === 'car' ? CAR_COLORS.length - 1 : 2),
          phase: R.float(0, TAU),
          sinkT: R.float(0, 5),
        });
      }
    };
    fill(1, 3, 'log', 2.6, 3.4);
    fill(2, 4, 'turtle', 2, 2);
    fill(3, 3, 'log', 2.2, 3);
    // rangée 4 : mix rondins + nénuphars (support petit mais bonus)
    fill(4, 2, 'log', 2.8, 3.4);
    {
      const lane = this.lanes[4];
      for (let i = 0; i < 3; i++) {
        lane.movers.push({
          off: i * 5 + 1 + R.next(), len: 1, kind: 'lily',
          variant: R.int(0, 2), phase: R.float(0, TAU), sinkT: 0,
        });
      }
    }
    fill(6, 4, 'car', 1.1, 1.5);
    fill(7, 3, 'car', 1.2, 1.7);
    fill(8, 3, 'truck', 2.3, 2.7);
    fill(9, 4, 'car', 1.1, 1.5);
    fill(10, 3, 'car', 1.2, 1.6);
  }

  speedMult(): number {
    return frogLevelMult(this.level);
  }

  pickFly(): void {
    const empty: number[] = [];
    for (let i = 0; i < 5; i++) if (!this.homes[i]) empty.push(i);
    if (!empty.length) { this.flySlot = -1; return; }
    this.flySlot = this.rng.pick(empty);
    this.flyT = 7;
  }

  resetPosition(full = false): void {
    this.c = 7;
    this.r = 11;
    this.px = frogCellCenterX(7);
    this.py = frogCellCenterY(11);
    this.hop = null;
    this.buffered = null;
    this.maxRow = 11;
    this.timeLeft = frogLevelTime(this.level);
    this.lastTickSec = -1;
    this.dying = false;
    this.dyingT = 0;
    this.blob.r = 16;
    this.blob.dead = false;
    this.blob.scared = false;
    this.blob.setEmotion('focused');
    this.blob.setPose(1, 1, 0, 0);
    this.syncBlob();
    if (full) {
      this.holdDir = null;
      this.holdT = 0;
    }
  }

  syncBlob(): void {
    this.blob.x = this.px;
    this.blob.y = this.py;
  }

  // ---------- input ----------
  readInput(I: InputLike): void {
    // Un appui physique = un seul hop. Le moteur miroite les directions
    // (clavier + croix) dans moveX/moveY (composeRawStates), donc le front
    // pressed() et le signal stick arrivent la même frame : le front est
    // prioritaire et absorbe son miroir pour ne pas déclencher deux hops.
    let edge: { dc: number; dr: number } | null = null;
    if (I.pressed('up')) edge = { dc: 0, dr: -1 };
    else if (I.pressed('down')) edge = { dc: 0, dr: 1 };
    else if (I.pressed('left')) edge = { dc: -1, dr: 0 };
    else if (I.pressed('right')) edge = { dc: 1, dr: 0 };
    const mx = I.moveX;
    const my = I.moveY;
    let sd: [number, number] | null = null;
    if (Math.abs(mx) > 0.55 || Math.abs(my) > 0.55) {
      sd = Math.abs(mx) > Math.abs(my) ? [Math.sign(mx), 0] : [0, Math.sign(my)];
    }
    if (edge) {
      this.pressDir(edge.dc, edge.dr);
      this.lastStick = sd;
      this.holdDir = { dc: edge.dc, dr: edge.dr };
      this.holdT = 0;
      return;
    }
    if (sd) {
      if (!this.lastStick || sd[0] !== this.lastStick[0] || sd[1] !== this.lastStick[1]) {
        this.pressDir(sd[0], sd[1]);
        this.lastStick = sd;
        this.holdDir = { dc: sd[0], dr: sd[1] };
        this.holdT = 0;
      } else if (this.holdDir) {
        this.holdT += 1 / 60;
      }
    } else {
      this.lastStick = null;
      // clavier maintenu : répétition douce façon arcade
      const kd = I.down('up') ? { dc: 0, dr: -1 }
        : I.down('down') ? { dc: 0, dr: 1 }
        : I.down('left') ? { dc: -1, dr: 0 }
        : I.down('right') ? { dc: 1, dr: 0 } : null;
      if (kd) {
        if (!this.holdDir || kd.dc !== this.holdDir.dc || kd.dr !== this.holdDir.dr) {
          this.holdDir = kd;
          this.holdT = 0;
        } else {
          this.holdT += 1 / 60;
        }
      } else {
        this.holdDir = null;
        this.holdT = 0;
      }
    }
    // répétition du maintien : un hop toutes les ~0.16 s
    if (this.holdDir && this.holdT > 0.22 && !this.dying) {
      this.holdT = 0.06;
      this.pressDir(this.holdDir.dc, this.holdDir.dr);
    }
  }

  pressDir(dc: number, dr: number): void {
    if (this.dying || this.state !== 'play') return;
    if (this.hop) {
      this.buffered = { dc, dr };
      return;
    }
    this.startHop(dc, dr);
  }

  startHop(dc: number, dr: number): void {
    const nc = this.c + dc;
    const nr = this.r + dr;
    // murs : petit bump, pas de mort (lisibilité arcade)
    if (nc < 0 || nc >= FROG_COLS || nr < 0 || nr >= FROG_ROWS) {
      this.audio.whiff();
      this.fx.shake(0.08);
      this.blob.punch(0.18);
      this.blob.setEmotion('sad', 0.4);
      return;
    }
    // Le saut part de la position réelle (ride / lerp en cours) et atterrit
    // pile au centre de la case cible : distance toujours == 1 case + résidu.
    this.hop = {
      fc: this.c, fr: this.r, tc: nc, tr: nr,
      fx: this.px, fy: this.py,
      tx: frogCellCenterX(nc), ty: frogCellCenterY(nr),
      t: 0, dur: FROG_HOP_DUR,
    };
    const spd = FROG_CELL / FROG_HOP_DUR;
    this.blob.vx = dc * spd;
    this.blob.vy = dr * spd;
    this.blob.punch(0.3);
    this.blob.setEmotion('focused');
    // stretch dans la direction du saut
    if (dr !== 0) this.blob.setPose(0.86, 1.22, 0.08, 0);
    else this.blob.setPose(1.22, 0.86, 0.08, 0);
    this.audio.jump();
    this.input.rumble(0.12, 0.04);
    this.fx.burst(this.px, this.py + 12, {
      n: 5, speed: [30, 130], colors: ['#ffffff88', this.accent], size: [1.5, 3], life: 0.3,
    });
  }

  finishHop(): void {
    const h = this.hop;
    if (!h) return;
    this.c = h.tc;
    this.r = h.tr;
    this.px = h.tx;
    this.py = h.ty;
    this.hop = null;
    this.syncBlob();
    this.blob.punch(0.22);
    this.blob.setPose(1.12, 0.88, 0.12, 0);
    this.audio.land();
    this.input.rumble(0.08, 0.03);
    this.fx.burst(this.px, this.py + 14, {
      n: 6, speed: [30, 140], colors: ['#ffffff66', this.accent], size: [1.5, 3], life: 0.3,
    });
    this.onLanded();
    this.syncBlob();
    if (this.state === 'play' && !this.dying && this.buffered) {
      const b = this.buffered;
      this.buffered = null;
      this.startHop(b.dc, b.dr);
    }
  }

  onLanded(): void {
    if (this.dying) return;
    // alcôves
    if (this.r === 0) {
      const hi = frogHomeIndex(this.c);
      if (hi < 0) { this.die('drown'); return; }
      if (this.homes[hi]) {
        // occupée : rebond gentil vers la rivière
        this.audio.whiff();
        this.blob.setEmotion('sad', 0.7);
        this.fx.text(this.px, this.py - 34, 'OCCUPÉ !', { color: '#ff9aaa', size: 18 });
        this.fx.shake(0.15);
        this.r = 1;
        this.px = frogCellCenterX(this.c);
        this.py = frogCellCenterY(1);
        this.maxRow = Math.min(this.maxRow, 1);
        return;
      }
      this.homeSuccess(hi);
      return;
    }
    const lane = this.lanes[this.r];
    if (lane.kind === 'river') {
      const sup = this.platformAt(this.px, this.r);
      if (!sup) { this.die('drown'); return; }
      if (sup.kind === 'lily') {
        this.score += 15;
        this.audio.coin(6);
        this.fx.ring(this.px, this.py, { r0: 8, r1: 44, color: '#4ade80', life: 0.3 });
        this.fx.text(this.px, this.py - 30, '+15', { color: '#4ade80', size: 16, mono: true });
      }
    } else if (lane.kind === 'road') {
      if (this.carHit(this.px, this.py, this.r)) { this.die('car'); return; }
      this.checkNearMiss();
    }
    // avancée : +10 par nouvelle rangée la plus haute
    if (this.r < this.maxRow) {
      const diff = this.maxRow - this.r;
      this.maxRow = this.r;
      const pts = diff * 10;
      this.score += pts;
      this.forwardStep++;
      this.audio.coin(this.forwardStep % 8);
      this.musicEvent('combo', Math.min(1, 0.3 + (11 - this.r) * 0.06));
      this.blob.setEmotion('happy', 0.45);
      this.fx.text(this.px, this.py - 30, '+' + pts, { color: this.accent, size: 16, mono: true });
      if (this.r === 5) {
        // palier berge : respiration
        this.audio.good();
        this.fx.ring(this.px, this.py, { r0: 10, r1: 60, color: this.accent, life: 0.35 });
      }
    }
  }

  homeSuccess(hi: number): void {
    this.homes[hi] = true;
    this.homesDone++;
    const timeBonus = Math.max(0, Math.ceil(this.timeLeft)) * 2;
    const fly = this.flySlot === hi ? 50 : 0;
    const pts = 100 + timeBonus + fly;
    this.score += pts;
    this.blob.setEmotion('happy', 1);
    this.blob.punch(0.5);
    this.audio.milestone();
    this.audio.perfect();
    this.musicEvent('waveComplete', 0.9);
    this.input.rumble(0.4, 0.12);
    this.fx.flash(this.accent, 0.1);
    this.fx.stop(0.05);
    this.fx.ring(this.px, this.py, { r0: 12, r1: 110, color: '#fef08a', life: 0.5, width: 4 });
    this.fx.burst(this.px, this.py, {
      n: 30, speed: [80, 420], colors: ['#fef08a', this.accent, '#ffffff'], size: [2, 6], life: 0.7,
    });
    this.fx.text(this.px, this.py - 40, '+' + pts + (fly ? '  MOUCHE !' : ''), {
      color: '#fef08a', size: 22,
    });
    if (this.flySlot === hi) { this.flySlot = -1; }
    if (this.homes.every(Boolean)) {
      this.score += 500;
      this.fx.text(640, 300, 'NIVEAU ' + this.level + ' TERMINÉ ! +500', { color: '#fef08a', size: 30 });
      this.fx.flash('#fef08a', 0.14);
      this.audio.milestone();
      this.level++;
      this.homes = [false, false, false, false, false];
      this.pickFly();
    } else {
      this.pickFly();
    }
    this.resetPosition();
  }

  // ---------- collisions ----------
  moverRect(m: FrogMover, row: number): { x: number; w: number } {
    return { x: FROG_LEFT + m.off * FROG_CELL, w: m.len * FROG_CELL };
  }

  turtleSunk(m: FrogMover): boolean {
    if (m.kind !== 'turtle') return false;
    const cyc = ((m.sinkT % 5) + 5) % 5;
    return cyc > 4.4;
  }

  turtleSinking(m: FrogMover): boolean {
    if (m.kind !== 'turtle') return false;
    const cyc = ((m.sinkT % 5) + 5) % 5;
    return cyc > 3.6 && cyc <= 4.4;
  }

  platformAt(px: number, row: number): FrogMover | null {
    const lane = this.lanes[row];
    if (!lane || lane.kind !== 'river') return null;
    for (const m of lane.movers) {
      if (this.turtleSunk(m)) continue;
      const rc = this.moverRect(m, row);
      if (px >= rc.x - 8 && px <= rc.x + rc.w + 8) return m;
    }
    return null;
  }

  carHit(px: number, py: number, row: number): boolean {
    const lane = this.lanes[row];
    if (!lane || lane.kind !== 'road') return false;
    const pr = 11; // hitbox généreuse mais pas pleine (16 visuel)
    for (const m of lane.movers) {
      const rc = this.moverRect(m, row);
      const cy = frogCellCenterY(row);
      const hw = rc.w / 2;
      const cx = rc.x + hw;
      // capsule : cercle central élargi
      const dx = Math.abs(px - cx) - (hw - 12);
      const dy = Math.abs(py - cy) - 10;
      const ox = dx < pr && dy < pr;
      if (dx <= 0 && dy <= 0) return true;
      if (ox && dx * dx + dy * dy < pr * pr) return true;
      // recouvrement simple en X (filet de sécurité)
      if (px + pr * 0.8 > rc.x + 4 && px - pr * 0.8 < rc.x + rc.w - 4 && Math.abs(py - cy) < 20) return true;
    }
    return false;
  }

  checkNearMiss(): void {
    if (this.nearCd > 0) return;
    const lane = this.lanes[this.r];
    if (!lane || lane.kind !== 'road') return;
    let best = Infinity;
    for (const m of lane.movers) {
      const rc = this.moverRect(m, this.r);
      const edge = this.px < rc.x ? rc.x - this.px : this.px > rc.x + rc.w ? this.px - (rc.x + rc.w) : 0;
      if (edge < best) best = edge;
    }
    if (best > 2 && best < 34) {
      this.nearCd = 0.9;
      this.nearCount++;
      this.score += 25;
      this.audio.good();
      this.musicEvent('nearMiss', 0.7);
      this.input.rumble(0.18, 0.05);
      this.fx.stop(0.025);
      this.fx.flash(this.accent, 0.07);
      this.fx.ring(this.px, this.py, { r0: 14, r1: 60, color: '#f2c94c', life: 0.3 });
      this.fx.text(this.px, this.py - 36, '+25 FRÔLÉ !', { color: '#f2c94c', size: 17, mono: true });
      this.blob.setEmotion('wow', 0.5);
      this.blob.punch(0.3);
    }
  }

  die(cause: FrogDeathCause): void {
    if (this.dying || this.state === 'over') return;
    this.syncBlob();
    this.dying = true;
    this.dyingT = cause === 'car' ? 1.1 : 1.0;
    this.dyingCause = cause;
    this.lives--;
    this.blob.dead = cause === 'car';
    this.blob.scared = cause !== 'car';
    this.blob.punch(0.6);
    this.fx.stop(0.11);
    this.fx.shake(cause === 'car' ? 0.9 : 0.55);
    this.input.rumble(1, 0.3);
    if (cause === 'car') {
      this.audio.explode(1.3);
      this.musicEvent('playerHit', 1);
      this.fx.burst(this.px, this.py, {
        n: 28, speed: [100, 520], colors: [this.accent, '#ffffff', '#ff5470'], size: [2, 6], life: 0.7,
      });
      this.fx.ring(this.px, this.py, { r0: 10, r1: 120, color: '#ff5470', life: 0.4 });
      this.fx.text(this.px, this.py - 40, 'ÉCRASÉ !', { color: '#ff5470', size: 24 });
    } else if (cause === 'time') {
      this.audio.miss();
      this.musicEvent('playerHit', 0.8);
      this.fx.flash('#ff5470', 0.12);
      this.fx.text(this.px, this.py - 40, 'TEMPS ÉCOULÉ !', { color: '#ff5470', size: 22 });
    } else {
      // noyade : splash organique, pas de pancake
      this.audio.hurt();
      this.musicEvent('playerHit', 0.8);
      this.fx.burst(this.px, this.py, {
        n: 26, speed: [60, 380], colors: ['#7dd3fc', '#ffffff', this.accent], size: [2, 6], life: 0.65,
      });
      this.fx.ring(this.px, this.py, { r0: 8, r1: 70, color: '#7dd3fc', life: 0.45 });
      this.fx.ring(this.px, this.py, { r0: 4, r1: 100, color: '#ffffff', life: 0.6 });
      this.fx.text(this.px, this.py - 40, 'PLOUF !', { color: '#7dd3fc', size: 24 });
    }
  }

  respawnOrOver(): void {
    if (this.lives <= 0) {
      this.over(false);
      return;
    }
    this.resetPosition();
  }

  // ---------- update ----------
  update(dt: number): void {
    if (this.baseUpdate(dt)) return;
    const mult = this.speedMult();
    this.wheelAng += dt * 9;
    this.nearCd = Math.max(0, this.nearCd - dt);

    // défilement des voies
    for (const lane of this.lanes) {
      if (!lane.dir) continue;
      const v = lane.dir * lane.speed * mult * dt / FROG_CELL;
      for (const m of lane.movers) {
        m.off += v;
        if (lane.dir > 0 && m.off > FROG_COLS + 0.5) m.off -= FROG_COLS + m.len + 1;
        if (lane.dir < 0 && m.off + m.len < -0.5) m.off += FROG_COLS + m.len + 1;
        if (m.kind === 'turtle') m.sinkT += dt;
      }
    }

    // mouche : clignote puis change d'alcôve
    if (this.flySlot >= 0) {
      this.flyT -= dt;
      if (this.flyT <= 0) this.pickFly();
    } else if (this.rng.next() < dt * 0.08) {
      this.pickFly();
    }

    if (this.dying) {
      this.dyingT -= dt;
      // le blob coule : il rétrécit et s'enfonce
      if (this.dyingCause !== 'car') {
        this.py += dt * 26;
        const s = Math.max(0.3, this.dyingT);
        this.blob.r = 16 * Math.min(1, s);
      }
      this.syncBlob();
      this.blob.update(dt);
      if (this.dyingT <= 0) this.respawnOrOver();
      return;
    }

    // timer
    this.timeLeft -= dt;
    const sec = Math.ceil(this.timeLeft);
    if (sec !== this.lastTickSec) {
      this.lastTickSec = sec;
      if (sec <= 5 && sec > 0) {
        this.audio.whiff();
        this.fx.shake(0.1);
      }
    }
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this.die('time');
      return;
    }

    this.readInput(this.input);

    // hop en cours : interpolation ease + arc, depuis la position réelle
    if (this.hop) {
      const h = this.hop;
      h.t += dt;
      const k = Math.min(1, h.t / h.dur);
      const e = easeOut(k);
      this.px = h.fx + (h.tx - h.fx) * e;
      this.py = h.fy + (h.ty - h.fy) * e - Math.sin(k * Math.PI) * 11;
      this.syncBlob();
      if (k >= 1) this.finishHop();
    } else {
      // au repos : ride sur l'eau, squash qui se détend
      const lane = this.lanes[this.r];
      if (lane && lane.kind === 'river') {
        const sup = this.platformAt(this.px, this.r);
        if (!sup) { this.die('drown'); return; }
        if (sup.kind === 'turtle' && this.turtleSunk(sup)) { this.die('sunk'); return; }
        this.px += lane.dir * lane.speed * mult * dt;
        // ride-out = noyade sur le bord
        if (this.px < FROG_LEFT - 6 || this.px > FROG_LEFT + FROG_COLS * FROG_CELL + 6) {
          this.die('edge');
          return;
        }
        // suit la case sous les pieds (pour le prochain saut)
        const cc = Math.floor((this.px - FROG_LEFT) / FROG_CELL);
        this.c = Math.max(0, Math.min(FROG_COLS - 1, cc));
        this.py = frogCellCenterY(this.r) + Math.sin(this.time * 2.2 + sup.phase) * 2;
        this.blob.vx = lane.dir * lane.speed * mult;
        this.blob.vy = 0;
      } else {
        // recollage doux au centre de la case
        const cx = frogCellCenterX(this.c);
        const cy = frogCellCenterY(this.r);
        this.px += (cx - this.px) * Math.min(1, dt * 18);
        this.py += (cy - this.py) * Math.min(1, dt * 18);
        this.blob.vx *= 0.8;
        this.blob.vy *= 0.8;
        // détente du squash d'atterrissage
        const sx = this.blob.poseX + (1 - this.blob.poseX) * Math.min(1, dt * 10);
        const sy = this.blob.poseY + (1 - this.blob.poseY) * Math.min(1, dt * 10);
        this.blob.setPose(sx, sy, Math.max(0, this.blob.liquid - dt * 3), 0);
        // collision continue sur route (une voiture peut nous percuter à l'arrêt)
        if (lane && lane.kind === 'road' && this.carHit(this.px, this.py, this.r)) {
          this.die('car');
          return;
        }
        this.checkNearMiss();
      }
      this.syncBlob();
    }

    // mid-hop : une voiture peut faucher le saut
    if (this.hop) {
      const midR = this.hop.tr;
      const lane = this.lanes[midR];
      if (lane && lane.kind === 'road' && this.carHit(this.px, this.py, midR)) {
        this.c = this.hop.tc;
        this.r = this.hop.tr;
        this.hop = null;
        this.die('car');
        return;
      }
    }

    // émotion de tension
    const lowTime = this.timeLeft < 10;
    let dangerNear = false;
    const lane = this.lanes[this.r];
    if (lane && lane.kind === 'road') {
      for (const m of lane.movers) {
        const rc = this.moverRect(m, this.r);
        const edge = this.px < rc.x ? rc.x - this.px : this.px > rc.x + rc.w ? this.px - (rc.x + rc.w) : 0;
        if (edge < 70) { dangerNear = true; break; }
      }
    }
    this.blob.scared = lowTime || dangerNear;
    if (!this.blob.scared && this.blob.emotion === 'scared') this.blob.setEmotion('idle');

    this.blob.update(dt);
    this.eng.dev.state('frog-row', this.r);
    this.eng.dev.count('frog-level', this.level);
    this.eng.dev.count('frog-lives', this.lives);
  }

  // ---------- rendu texturé ----------
  render(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#04050a';
    ctx.fillRect(0, 0, 1280, 720);
    this.fx.world(ctx);
    UI.grid(ctx, { gap: 64, off: this.time * 4, alpha: 0.03 });

    const L = FROG_LEFT;
    const W = FROG_COLS * FROG_CELL;
    const T = FROG_TOP;

    // cadre nuit
    ctx.fillStyle = '#05070d';
    ctx.fillRect(L - 14, T - 14, W + 28, FROG_ROWS * FROG_CELL + 28);
    ctx.strokeStyle = this.accent + '44';
    ctx.lineWidth = 2;
    ctx.strokeRect(L - 14, T - 14, W + 28, FROG_ROWS * FROG_CELL + 28);

    for (let row = 0; row < FROG_ROWS; row++) {
      const y = T + row * FROG_CELL;
      const lane = this.lanes[row];
      if (row === 0) this.drawHomeRow(ctx, L, y, W);
      else if (lane.kind === 'river') this.drawWaterRow(ctx, L, y, W, row);
      else if (lane.kind === 'road') this.drawRoadRow(ctx, L, y, W, row);
      else this.drawGrassRow(ctx, L, y, W, row);
    }

    // movers (sous le joueur pour les rondins ? non : le joueur surfe dessus)
    for (let row = 1; row <= 4; row++) this.drawRiverMovers(ctx, row);
    for (let row = 6; row <= 10; row++) this.drawRoadMovers(ctx, row);
    this.drawHomesContent(ctx);

    // ombre du joueur
    if (!this.dying || this.dyingCause === 'car') {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.ellipse(this.px, this.py + 15, 13, 5, 0, 0, TAU);
      ctx.fill();
    }
    if (!(this.dying && this.dyingCause !== 'car' && this.dyingT < 0.35)) {
      this.blob.color = this.accent;
      this.blob.render(ctx);
    }

    this.fx.drawWorld(ctx);
    this.fx.endWorld(ctx);

    // HUD
    UI.drawHUD(ctx, {
      accent: this.accent, score: Math.floor(this.score), unit: this.meta.unit,
      extra: () => {
        // vies
        UI.txt(ctx, 'VIES', 28, 30, { size: 10, mono: true, color: '#ff7a91', weight: 900 });
        for (let i = 0; i < FROG_START_LIVES; i++) {
          ctx.globalAlpha = i < this.lives ? 1 : 0.18;
          ctx.fillStyle = i < this.lives ? this.accent : '#3d4454';
          ctx.beginPath();
          ctx.arc(36 + i * 24, 50, 8, 0, TAU);
          ctx.fill();
          if (i < this.lives) {
            ctx.fillStyle = '#0b0e14';
            ctx.beginPath(); ctx.arc(33 + i * 24, 48, 1.8, 0, TAU); ctx.fill();
            ctx.beginPath(); ctx.arc(39 + i * 24, 48, 1.8, 0, TAU); ctx.fill();
          }
        }
        ctx.globalAlpha = 1;
        UI.txt(ctx, 'NIVEAU ' + this.level, 28, 78, { size: 13, mono: true, color: this.accent, weight: 900 });
        UI.txt(ctx, 'ALCÔVES ' + this.homes.filter(Boolean).length + ' / 5', 28, 96, {
          size: 12, mono: true, color: '#8b95a8',
        });
        // timer
        const total = frogLevelTime(this.level);
        const k = Math.max(0, this.timeLeft / total);
        const tw = 400;
        const tx = 640 - tw / 2;
        UI.panel(ctx, tx - 10, 12, tw + 20, 46, {
          radius: 14, fill: 'rgba(7,10,17,0.72)', stroke: k < 0.2 ? '#ff547055' : this.accent + '38',
        });
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fillRect(tx, 26, tw, 10);
        const pulse = k < 0.2 ? 0.6 + 0.4 * Math.sin(this.time * 12) : 1;
        ctx.globalAlpha = pulse;
        ctx.fillStyle = k < 0.2 ? '#ff5470' : this.accent;
        ctx.fillRect(tx, 26, tw * k, 10);
        ctx.globalAlpha = 1;
        UI.txt(ctx, 'TEMPS  ' + Math.ceil(this.timeLeft) + 's', 640, 52, {
          size: 12, align: 'center', mono: true, color: k < 0.2 ? '#ff9aaa' : '#dfe6f0', weight: 900,
        });
        if (this.nearCount > 0) {
          UI.txt(ctx, 'FRÔLÉS ×' + this.nearCount, 1252, 96, {
            size: 12, align: 'right', mono: true, color: '#f2c94c', weight: 900,
          });
        }
      },
    });
    this.drawCommon(ctx);
  }

  drawGrassRow(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, row: number): void {
    const g = ctx.createLinearGradient(0, y, 0, y + FROG_CELL);
    g.addColorStop(0, '#123524');
    g.addColorStop(1, '#0b2117');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, FROG_CELL);
    // brins texturés
    ctx.lineWidth = 1.4;
    const n = 46;
    for (let i = 0; i < n; i++) {
      const b = this.blades[(row * 47 + i * 13) % this.blades.length];
      const bx = x + b.x * w;
      const by = y + 6 + b.y * (FROG_CELL - 10);
      ctx.strokeStyle = b.l > 0.75 ? '#2f9e6e' : '#1d6b4a';
      ctx.globalAlpha = 0.35 + b.l * 0.4;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + b.lean * 0.4, by - b.h);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // liseré haut lumineux
    ctx.fillStyle = '#4ade8022';
    ctx.fillRect(x, y, w, 3);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(x, y + FROG_CELL - 3, w, 3);
    if (row === 5) {
      // berge : frange sable côté eau
      ctx.fillStyle = '#3b332555';
      ctx.fillRect(x, y - 3, w, 5);
    }
    if (row === 11) {
      UI.txt(ctx, 'DÉPART', x + w / 2, y + FROG_CELL / 2 + 6, {
        size: 13, align: 'center', mono: true, color: '#4ade8066', weight: 900,
      });
    }
  }

  drawRoadRow(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, row: number): void {
    ctx.fillStyle = '#161a24';
    ctx.fillRect(x, y, w, FROG_CELL);
    ctx.fillStyle = '#1d2230';
    ctx.fillRect(x, y + 4, w, FROG_CELL - 8);
    // grain d'asphalte
    for (let i = 0; i < 26; i++) {
      const s = this.specks[(row * 31 + i * 7) % this.specks.length];
      ctx.globalAlpha = s.a;
      ctx.fillStyle = '#aeb8c8';
      ctx.fillRect(x + s.x * w, y + 4 + s.y * (FROG_CELL - 8), s.r, s.r);
    }
    ctx.globalAlpha = 1;
    // pointillés de séparation (haut de chaque voie sauf la première)
    if (row > 6) {
      ctx.fillStyle = 'rgba(250,204,21,0.4)';
      for (let dx = 8; dx < w; dx += 44) ctx.fillRect(x + dx, y - 1.5, 22, 3);
    }
    // bordures trottoir haut/bas du bloc route
    if (row === 6) {
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(x, y - 2, w, 3);
    }
    if (row === 10) {
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(x, y + FROG_CELL - 1, w, 3);
    }
  }

  drawWaterRow(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, row: number): void {
    const g = ctx.createLinearGradient(0, y, 0, y + FROG_CELL);
    g.addColorStop(0, '#07303f');
    g.addColorStop(0.5, '#06283a');
    g.addColorStop(1, '#041722');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, FROG_CELL);
    // vagues sinusoïdales animées (2 couches)
    const lane = this.lanes[row];
    const drift = this.time * (20 + lane.speed * 0.3) * lane.dir;
    ctx.lineWidth = 1.6;
    for (let layer = 0; layer < 2; layer++) {
      ctx.strokeStyle = layer === 0 ? 'rgba(45,212,191,0.20)' : 'rgba(125,211,252,0.16)';
      ctx.beginPath();
      const yy = y + 12 + layer * 18;
      for (let dx = 0; dx <= w; dx += 12) {
        const wx = x + dx;
        const wy = yy + Math.sin((dx + drift + layer * 90) * 0.03 + row) * 3;
        if (dx === 0) ctx.moveTo(wx, wy);
        else ctx.lineTo(wx, wy);
      }
      ctx.stroke();
    }
    // étincelles
    for (let i = 0; i < 14; i++) {
      const s = this.sparks[(row * 17 + i * 11) % this.sparks.length];
      const sx = x + ((s.x * w + drift * 0.4) % w + w) % w;
      const sy = y + 4 + s.y * (FROG_CELL - 8);
      ctx.globalAlpha = s.a * (0.5 + 0.5 * Math.sin(this.time * 3 + s.x * 20 + row));
      ctx.fillStyle = '#7dd3fc';
      ctx.beginPath();
      ctx.arc(sx, sy, s.r * 0.7, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  drawHomeRow(ctx: CanvasRenderingContext2D, x: number, y: number, w: number): void {
    // fond eau sombre entre les alcôves
    const g = ctx.createLinearGradient(0, y, 0, y + FROG_CELL);
    g.addColorStop(0, '#06283a');
    g.addColorStop(1, '#041722');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, FROG_CELL);
    // haie haute
    ctx.fillStyle = '#0e2f20';
    ctx.fillRect(x, y, w, 10);
    ctx.fillStyle = '#4ade8033';
    ctx.fillRect(x, y + 10, w, 2);
    // 5 alcôves
    for (let i = 0; i < 5; i++) {
      const c = FROG_HOME_COLS[i];
      const cx = frogCellCenterX(c);
      const cy = y + FROG_CELL / 2 + 4;
      const filled = this.homes[i];
      // couronne nénuphar
      ctx.fillStyle = filled ? '#134e3a' : '#0f3a2c';
      ctx.beginPath();
      ctx.ellipse(cx, cy, 30, 20, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = filled ? '#4ade80' : '#2f9e6e88';
      ctx.lineWidth = 2;
      ctx.stroke();
      // creux sombre
      ctx.fillStyle = '#02040a';
      ctx.beginPath();
      ctx.ellipse(cx, cy, 21, 14, 0, 0, TAU);
      ctx.fill();
      if (filled) {
        ctx.save();
        ctx.shadowColor = this.accent;
        ctx.shadowBlur = 14;
        ctx.strokeStyle = this.accent;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, 21, 14, 0, 0, TAU);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  drawHomesContent(ctx: CanvasRenderingContext2D): void {
    const y = FROG_TOP;
    for (let i = 0; i < 5; i++) {
      const c = FROG_HOME_COLS[i];
      const cx = frogCellCenterX(c);
      const cy = y + FROG_CELL / 2 + 4;
      if (this.homes[i]) {
        // mini blob heureux dans l'alcôve
        const bob = Math.sin(this.time * 2.4 + i * 1.7) * 1.5;
        ctx.save();
        ctx.shadowColor = this.accent;
        ctx.shadowBlur = 12;
        ctx.fillStyle = this.accent;
        ctx.beginPath();
        ctx.arc(cx, cy + bob, 11, 0, TAU);
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = '#0b0e14';
        ctx.beginPath(); ctx.arc(cx - 4, cy - 2 + bob, 2, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(cx + 4, cy - 2 + bob, 2, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#0b0e14';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(cx, cy + 3 + bob, 4, 0.15 * Math.PI, 0.85 * Math.PI);
        ctx.stroke();
      } else if (this.flySlot === i) {
        // mouche bonus qui bourdonne
        const bx = cx + Math.sin(this.time * 9 + i) * 6;
        const by = cy - 4 + Math.cos(this.time * 11 + i * 2) * 4;
        const blink = Math.sin(this.time * 6) > -0.2;
        if (blink) {
          ctx.fillStyle = '#fde047';
          ctx.save();
          ctx.shadowColor = '#fde047';
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.arc(bx, by, 3.6, 0, TAU);
          ctx.fill();
          ctx.restore();
          ctx.fillStyle = 'rgba(255,255,255,0.7)';
          ctx.beginPath();
          ctx.ellipse(bx - 3, by - 3, 2.4, 1.4, -0.5, 0, TAU);
          ctx.fill();
          ctx.beginPath();
          ctx.ellipse(bx + 3, by - 3, 2.4, 1.4, 0.5, 0, TAU);
          ctx.fill();
        }
      }
    }
  }

  drawRiverMovers(ctx: CanvasRenderingContext2D, row: number): void {
    const lane = this.lanes[row];
    const y = FROG_TOP + row * FROG_CELL;
    for (const m of lane.movers) {
      const rc = this.moverRect(m, row);
      const bob = Math.sin(this.time * 2 + m.phase) * 2;
      if (m.kind === 'log') this.drawLog(ctx, rc.x, y + FROG_CELL / 2 + bob, rc.w, m);
      else if (m.kind === 'turtle') this.drawTurtles(ctx, rc.x, y + FROG_CELL / 2 + bob, rc.w, m);
      else this.drawLilyPad(ctx, rc.x + rc.w / 2, y + FROG_CELL / 2 + bob, m);
      // écume de proue
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(rc.x + rc.w / 2, y + FROG_CELL / 2 + bob, rc.w / 2 + 3, 15, 0, 0, TAU);
      ctx.stroke();
    }
  }

  drawLog(ctx: CanvasRenderingContext2D, x: number, cy: number, w: number, m: FrogMover): void {
    const h = 30;
    ctx.save();
    ctx.shadowColor = '#7a523033';
    ctx.shadowBlur = 10;
    UI.roundRect(ctx, x, cy - h / 2, w, h, 14);
    ctx.fillStyle = '#6b4426';
    ctx.fill();
    ctx.restore();
    UI.roundRect(ctx, x, cy - h / 2, w, h, 14);
    ctx.fillStyle = '#7a5230';
    ctx.fill();
    // highlight haut (texture bois)
    ctx.fillStyle = '#a97a4a';
    UI.roundRect(ctx, x + 4, cy - h / 2 + 3, w - 8, 6, 3);
    ctx.fill();
    // stries d'écorce
    ctx.strokeStyle = 'rgba(43,26,12,0.55)';
    ctx.lineWidth = 1.6;
    for (let i = 0; i < 3; i++) {
      const yy = cy - 6 + i * 6 + Math.sin(m.phase + i * 2) * 1.5;
      ctx.beginPath();
      ctx.moveTo(x + 8, yy);
      ctx.bezierCurveTo(x + w * 0.3, yy + 2, x + w * 0.6, yy - 2, x + w - 8, yy + 1);
      ctx.stroke();
    }
    // anneaux aux extrémités
    for (const ex of [x + 7, x + w - 7]) {
      ctx.strokeStyle = '#3d2412';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(ex, cy, 4, 8, 0, 0, TAU);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(ex, cy, 1.8, 4, 0, 0, TAU);
      ctx.stroke();
    }
    // mousse
    ctx.fillStyle = '#4ade80aa';
    const n = 2 + (m.variant % 2);
    for (let i = 0; i < n; i++) {
      const mx = x + 12 + ((m.phase * 37 + i * 53) % (w - 24));
      ctx.beginPath();
      ctx.arc(mx, cy - h / 2 + 2, 2.4, 0, TAU);
      ctx.fill();
    }
    ctx.strokeStyle = '#2b1a0c88';
    ctx.lineWidth = 2;
    UI.roundRect(ctx, x, cy - h / 2, w, h, 14);
    ctx.stroke();
  }

  drawTurtles(ctx: CanvasRenderingContext2D, x: number, cy: number, w: number, m: FrogMover): void {
    const sinking = this.turtleSinking(m);
    const sunk = this.turtleSunk(m);
    const units = 2;
    const uw = w / units;
    const cyc = ((m.sinkT % 5) + 5) % 5;
    const dip = sinking ? (cyc - 3.6) * 8 : sunk ? 8 : 0;
    for (let i = 0; i < units; i++) {
      const cx = x + uw * (i + 0.5);
      const blink = sinking && Math.sin(this.time * 20) > 0;
      ctx.globalAlpha = sunk ? 0.25 : blink ? 0.55 : 1;
      // carapace texturée
      ctx.save();
      ctx.shadowColor = '#2f9e6e66';
      ctx.shadowBlur = 8;
      ctx.fillStyle = '#1f7a54';
      ctx.beginPath();
      ctx.ellipse(cx, cy + dip, uw * 0.42, 13, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#2f9e6e';
      ctx.beginPath();
      ctx.ellipse(cx, cy - 2 + dip, uw * 0.32, 9, 0, 0, TAU);
      ctx.fill();
      // écailles
      ctx.fillStyle = '#4ade80aa';
      for (let d = -1; d <= 1; d++) {
        ctx.beginPath();
        ctx.arc(cx + d * 7, cy - 2 + dip, 2.2, 0, TAU);
        ctx.fill();
      }
      // tête côté sens de marche
      const lane = this.lanes[Math.round((cy - FROG_TOP - FROG_CELL / 2) / FROG_CELL)] as FrogLane | undefined;
      const dir = lane && lane.dir ? lane.dir : 1;
      ctx.fillStyle = '#34d399';
      ctx.beginPath();
      ctx.arc(cx + dir * uw * 0.42, cy + dip, 5, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#0b0e14';
      ctx.beginPath();
      ctx.arc(cx + dir * uw * 0.42 + dir * 1.5, cy - 1 + dip, 1.4, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (sinking) {
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(x + w / 2, cy, w / 2 + 6, 18, 0, 0, TAU);
      ctx.stroke();
    }
  }

  drawLilyPad(ctx: CanvasRenderingContext2D, cx: number, cy: number, m: FrogMover): void {
    ctx.save();
    ctx.shadowColor = '#34d39955';
    ctx.shadowBlur = 8;
    ctx.fillStyle = '#1d7a52';
    ctx.beginPath();
    ctx.ellipse(cx, cy, 22, 14, 0, 0.3, TAU - 0.3);
    ctx.lineTo(cx, cy);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#2f9e6e';
    ctx.beginPath();
    ctx.ellipse(cx - 2, cy - 2, 16, 10, 0, 0.3, TAU - 0.3);
    ctx.lineTo(cx - 2, cy - 2);
    ctx.closePath();
    ctx.fill();
    // nervures
    ctx.strokeStyle = 'rgba(6,40,26,0.6)';
    ctx.lineWidth = 1.2;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(i * 0.5) * 18, cy + Math.sin(i * 0.5) * 11);
      ctx.stroke();
    }
    if (m.variant === 0) {
      // fleur bonus
      ctx.fillStyle = '#f9a8d4';
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU + this.time * 0.5;
        ctx.beginPath();
        ctx.ellipse(cx + Math.cos(a) * 4, cy - 10 + Math.sin(a) * 3, 3, 2, a, 0, TAU);
        ctx.fill();
      }
      ctx.fillStyle = '#fde047';
      ctx.beginPath();
      ctx.arc(cx, cy - 10, 2.6, 0, TAU);
      ctx.fill();
    }
  }

  drawRoadMovers(ctx: CanvasRenderingContext2D, row: number): void {
    const lane = this.lanes[row];
    const y = FROG_TOP + row * FROG_CELL;
    for (const m of lane.movers) {
      const rc = this.moverRect(m, row);
      if (m.kind === 'truck') this.drawTruck(ctx, rc.x, y + FROG_CELL / 2, rc.w, m, lane.dir);
      else this.drawCar(ctx, rc.x, y + FROG_CELL / 2, rc.w, m, lane.dir);
    }
  }

  drawCar(ctx: CanvasRenderingContext2D, x: number, cy: number, w: number, m: FrogMover, dir: 1 | -1 | 0): void {
    const h = 30;
    const col = CAR_COLORS[m.variant % CAR_COLORS.length];
    // halo phares nuit
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = '#fef08a';
    const hx = dir >= 0 ? x + w : x;
    ctx.beginPath();
    ctx.ellipse(hx, cy, 26, 10, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
    // carrosserie capsule hostile
    ctx.save();
    ctx.shadowColor = col;
    ctx.shadowBlur = 12;
    UI.roundRect(ctx, x, cy - h / 2, w, h, 12);
    ctx.fillStyle = col;
    ctx.fill();
    ctx.restore();
    // bas de caisse + toit
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    UI.roundRect(ctx, x + 3, cy + h / 2 - 9, w - 6, 6, 3);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    UI.roundRect(ctx, x + 6, cy - h / 2 + 2, w - 12, 5, 2.5);
    ctx.fill();
    // habitacle + pare-brise texturé
    const cabX = dir >= 0 ? x + w * 0.52 : x + w * 0.14;
    ctx.fillStyle = '#0b1220';
    UI.roundRect(ctx, cabX, cy - 9, w * 0.34, 18, 5);
    ctx.fill();
    ctx.fillStyle = 'rgba(125,211,252,0.5)';
    UI.roundRect(ctx, cabX + 2, cy - 7, w * 0.34 - 4, 6, 3);
    ctx.fill();
    // yeux hostiles (cousins du blob, sans reflet)
    const ex = dir >= 0 ? cabX + w * 0.17 : cabX + w * 0.17;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(ex - 5, cy + 1, 3.4, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(ex + 5, cy + 1, 3.4, 0, TAU); ctx.fill();
    ctx.fillStyle = '#7f1d2e';
    ctx.beginPath(); ctx.arc(ex - 5 + dir * 1.4, cy + 1.4, 1.6, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(ex + 5 + dir * 1.4, cy + 1.4, 1.6, 0, TAU); ctx.fill();
    // roues à rayons (tournent avec la vitesse)
    for (const wx of [x + 12, x + w - 12]) {
      ctx.fillStyle = '#0a0d13';
      ctx.beginPath();
      ctx.arc(wx, cy + h / 2 - 1, 7, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = '#8b95a8';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(wx + Math.cos(this.wheelAng) * 5, cy + h / 2 - 1 + Math.sin(this.wheelAng) * 5);
      ctx.lineTo(wx - Math.cos(this.wheelAng) * 5, cy + h / 2 - 1 - Math.sin(this.wheelAng) * 5);
      ctx.stroke();
      ctx.fillStyle = '#3d4454';
      ctx.beginPath();
      ctx.arc(wx, cy + h / 2 - 1, 2, 0, TAU);
      ctx.fill();
    }
  }

  drawTruck(ctx: CanvasRenderingContext2D, x: number, cy: number, w: number, m: FrogMover, dir: 1 | -1 | 0): void {
    const h = 32;
    const col = CAR_COLORS[(m.variant + 2) % CAR_COLORS.length];
    const cabW = 34;
    const cabX = dir >= 0 ? x + w - cabW : x;
    const trailX = dir >= 0 ? x : x + cabW;
    const trailW = w - cabW;
    // remorque striée
    ctx.save();
    ctx.shadowColor = '#94a3b855';
    ctx.shadowBlur = 10;
    UI.roundRect(ctx, trailX, cy - h / 2, trailW, h, 6);
    ctx.fillStyle = '#232a3a';
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = col + '88';
    ctx.lineWidth = 2;
    for (let sx = trailX + 10; sx < trailX + trailW - 6; sx += 16) {
      ctx.beginPath();
      ctx.moveTo(sx, cy - h / 2 + 4);
      ctx.lineTo(sx + 8, cy + h / 2 - 4);
      ctx.stroke();
    }
    UI.roundRect(ctx, trailX, cy - h / 2, trailW, h, 6);
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.stroke();
    this.drawCar(ctx, cabX, cy, cabW, { ...m, len: 1, kind: 'car' }, dir);
  }

  debugSnapshot(): Record<string, string | number | boolean | null> {
    return {
      ...super.debugSnapshot(),
      row: this.r,
      col: this.c,
      level: this.level,
      lives: this.lives,
      homes: this.homes.filter(Boolean).length,
      timeLeft: Number(this.timeLeft.toFixed(1)),
    };
  }
}
