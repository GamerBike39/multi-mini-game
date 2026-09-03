// BLOB CYCLES — Tron-like orthogonal, 1 à 4 joueurs.
// Chacun laisse une traînée mortelle (filament de matière). Dernier survivant gagne.
// Solo rapide : 1 humain contre 3 IA. Multi local : 2-4 humains, sans IA.
// Mécanique quick-win : traverser sa PROPRE ancienne ligne consomme de l'énergie
// au lieu de tuer (évite les situations bloquées). Near-miss = énorme récompense.
// Map 3840×2160 (3× la scène) + caméra dynamique qui s'éloigne près des bords.
// Murs qui respirent (visuel) + vraie frontière nette + minimap d'anticipation.

import { BaseGame } from '../core/game';
import { Blob } from '../core/blob';
import * as UI from '../core/ui';
import type { EngineLike, GameMeta, PlayerInputLike } from '../core/types';

export const CYCLE_W = 3840;
export const CYCLE_H = 2160;
export const CYCLE_BASE_SPEED = 320;
export const CYCLE_MAX_SPEED = 545;
export const CYCLE_SPEED_RAMP = 4.2;
export const CYCLE_BOOST_MULT = 1.6;
export const CYCLE_R = 13;
export const CYCLE_ENERGY_MAX = 1;
export const CYCLE_ENERGY_COST = 0.35;
export const CYCLE_ENERGY_REGEN = 0.12;
export const CYCLE_NEAR_DIST = 36;
export const CYCLE_NEAR_TIME = 0.18;
export const CYCLE_NEAR_CD = 1.0;
export const CYCLE_NEAR_SCORE = 150;
export const CYCLE_SHRINK_DELAY = 35;
export const CYCLE_SHRINK_SPEED = 34;
export const CYCLE_MIN_W = 1500;
export const CYCLE_MIN_H = 950;

export const CYCLE_COLORS = ['#00e5ff', '#f472b6', '#a3e635', '#fbbf24'] as const;
export const CYCLE_NAMES = ['P1', 'P2', 'P3', 'P4'] as const;

/** 0=haut, 1=droite, 2=bas, 3=gauche. */
export type CycleDir = 0 | 1 | 2 | 3;

export function cycleDirVec(dir: CycleDir): { x: number; y: number } {
  if (dir === 0) return { x: 0, y: -1 };
  if (dir === 1) return { x: 1, y: 0 };
  if (dir === 2) return { x: 0, y: 1 };
  return { x: -1, y: 0 };
}

/** Refuse le sur-place et le demi-tour (suicide instantané). */
export function cycleCanTurn(cur: CycleDir, want: CycleDir): boolean {
  if (want === cur) return false;
  return (cur + 2) % 4 !== want;
}

/** Direction dominante du stick / D-pad, seuil 0.45. */
export function cycleWantDir(mx: number, my: number): CycleDir | null {
  if (Math.abs(mx) < 0.45 && Math.abs(my) < 0.45) return null;
  if (Math.abs(mx) > Math.abs(my)) return mx > 0 ? 1 : 3;
  return my > 0 ? 2 : 0;
}

export function pointSegDist(
  px: number, py: number,
  ax: number, ay: number, bx: number, by: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const len2 = abx * abx + aby * aby;
  let t = 0;
  if (len2 > 1e-9) t = ((px - ax) * abx + (py - ay) * aby) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + abx * t;
  const cy = ay + aby * t;
  return Math.hypot(px - cx, py - cy);
}

interface TrailPt { x: number; y: number; }
interface BoostZone { x: number; y: number; w: number; h: number; phase: number; }

interface Rider {
  idx: number;
  human: boolean;
  color: string;
  name: string;
  x: number;
  y: number;
  dir: CycleDir;
  alive: boolean;
  trail: TrailPt[];
  energy: number;
  boostOn: boolean;
  nearT: number;
  nearCd: number;
  nearArmed: boolean;
  nearCount: number;
  queue: CycleDir[];
  lastStick: CycleDir | null;
  blob: Blob;
  invulnOwnT: number;
  graceT: number;
  speed: number;
  aiT: number;
  deadT: number;
  turnCd: number;
}

const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

export class CycleGame extends BaseGame {
  static meta: GameMeta = {
    id: 'cycle',
    name: 'BLOB CYCLES',
    accent: '#00e5ff',
    mood: 'cycle',
    desc: 'Traînées mortelles, dernier survivant.',
    controls: 'Stick / D-pad : virer à 90°',
    keys: 'Flèches / ZQSD : virer (P1)',
    hint: 'Ne touche ni murs ni filaments · ta vieille ligne coûte de l’énergie · frôle pour +150',
    unit: 'pts',
    ranks: [2500, 1800, 1200, 600, 0],
    genre: 'action',
    players: { min: 1, max: 4 },
  };

  riders: Rider[] = [];
  zones: BoostZone[] = [];
  solo = true;
  camX = CYCLE_W / 2;
  camY = CYCLE_H / 2;
  zoomSm = 1;
  startT = 1.4;
  endT = -1;
  winner = -1;
  inset = 0;
  shrinkWarned = false;
  nearScore = 0;
  speedNow = CYCLE_BASE_SPEED;
  proxT = 0;
  camKickX = 0;
  camKickY = 0;

  constructor(engine: EngineLike) {
    super(engine);
    const humans = clamp(Math.floor(this.session.playerCount) || 1, 1, 4);
    const total = humans === 1 ? 4 : humans;
    const solo = humans === 1;
    this.solo = solo;

    // Spawns en circulation horaire (pas de face-à-face instantané).
    const sx = 900;
    const sy = 700;
    const defs: Array<{ x: number; y: number; dir: CycleDir }> = [
      { x: sx, y: sy, dir: 1 },
      { x: CYCLE_W - sx, y: sy, dir: 2 },
      { x: CYCLE_W - sx, y: CYCLE_H - sy, dir: 3 },
      { x: sx, y: CYCLE_H - sy, dir: 0 },
    ];
    // Duel : coins opposés pour un vrai terrain.
    const order = total === 2 ? [0, 2] : total === 3 ? [0, 1, 2] : [0, 1, 2, 3];
    for (let k = 0; k < order.length; k++) {
      const d = defs[order[k]];
      const jx = this.rng.float(-120, 120);
      const jy = this.rng.float(-90, 90);
      const color = CYCLE_COLORS[k];
      const blob = new Blob({ x: d.x + jx, y: d.y + jy, r: CYCLE_R, color });
      blob.setEmotion('focused');
      this.riders.push({
        idx: k,
        human: solo ? k === 0 : true,
        color,
        name: solo ? (k === 0 ? 'TOI' : 'IA' + k) : CYCLE_NAMES[k],
        x: d.x + jx,
        y: d.y + jy,
        dir: d.dir,
        alive: true,
        trail: [{ x: d.x + jx, y: d.y + jy }, { x: d.x + jx, y: d.y + jy }],
        energy: CYCLE_ENERGY_MAX,
        boostOn: false,
        nearT: 0,
        nearCd: 0,
        nearArmed: true,
        nearCount: 0,
        queue: [],
        lastStick: null,
        blob,
        invulnOwnT: 0,
        graceT: 0.6,
        speed: CYCLE_BASE_SPEED,
        aiT: this.rng.float(0, 0.1),
        deadT: 0,
        turnCd: 0,
      });
    }

    // Zones de boost : 4 pads seedés, loin des spawns.
    for (let i = 0; i < 4; i++) {
      const zx = CYCLE_W * (i % 2 === 0 ? 0.32 : 0.68) + this.rng.float(-160, 160);
      const zy = CYCLE_H * (i < 2 ? 0.36 : 0.64) + this.rng.float(-120, 120);
      this.zones.push({ x: clamp(zx, 500, CYCLE_W - 500), y: clamp(zy, 400, CYCLE_H - 400), w: 300, h: 200, phase: this.rng.float(0, 6.28) });
    }

    const c = this.centroid();
    this.camX = c.x;
    this.camY = c.y;
    this.blob = this.riders[0].blob;
  }

  enter(): void {
    super.enter();
    this.audio.uiOk();
  }

  private bounds(): { l: number; t: number; r: number; b: number } {
    return { l: this.inset, t: this.inset * 0.75, r: CYCLE_W - this.inset, b: CYCLE_H - this.inset * 0.75 };
  }

  private centroid(): { x: number; y: number } {
    const alive = this.riders.filter((r) => r.alive);
    const list = alive.length ? alive : this.riders;
    let x = 0;
    let y = 0;
    for (const r of list) { x += r.x; y += r.y; }
    return { x: x / list.length, y: y / list.length };
  }

  private speedBase(): number {
    return Math.min(CYCLE_MAX_SPEED, CYCLE_BASE_SPEED + this.time * CYCLE_SPEED_RAMP);
  }

  private speedNorm(): number {
    return clamp((this.speedNow - CYCLE_BASE_SPEED) / (CYCLE_MAX_SPEED * CYCLE_BOOST_MULT - CYCLE_BASE_SPEED), 0, 1);
  }

  // ---------- entrées humaines ----------
  private readHuman(r: Rider, input: PlayerInputLike): void {
    if (input.pressed('up')) this.pushTurn(r, 0);
    if (input.pressed('right')) this.pushTurn(r, 1);
    if (input.pressed('down')) this.pushTurn(r, 2);
    if (input.pressed('left')) this.pushTurn(r, 3);
    const want = cycleWantDir(input.moveX, input.moveY);
    if (want !== null) {
      if (r.lastStick === null || r.lastStick !== want) {
        this.pushTurn(r, want);
        r.lastStick = want;
      }
    } else {
      r.lastStick = null;
    }
  }

  private pushTurn(r: Rider, want: CycleDir): void {
    const last = r.queue.length ? r.queue[r.queue.length - 1] : r.dir;
    if (!cycleCanTurn(last, want)) return;
    if (r.queue.length < 2) r.queue.push(want);
  }

  // ---------- IA (solo) : évite, respire, provoque un peu ----------
  private aiThink(r: Rider, dt: number): void {
    r.aiT -= dt;
    if (r.aiT > 0) return;
    r.aiT = 0.11;
    const ahead = this.dangerAhead(r.x, r.y, r.dir, 460, r);
    // Cherche un boost proche et sûr.
    let wantBoost: CycleDir | null = null;
    for (const z of this.zones) {
      const dx = z.x - r.x;
      const dy = z.y - r.y;
      if (Math.abs(dx) + Math.abs(dy) > 700) continue;
      const want = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 as CycleDir : 3 as CycleDir) : (dy > 0 ? 2 as CycleDir : 0 as CycleDir);
      if (want !== r.dir && cycleCanTurn(r.dir, want) && this.dangerAhead(r.x, r.y, want, 380, r) > 220) {
        wantBoost = want;
        break;
      }
    }
    if (ahead < 250) {
      const left = ((r.dir + 3) % 4) as CycleDir;
      const right = ((r.dir + 1) % 4) as CycleDir;
      const dl = this.dangerAhead(r.x, r.y, left, 460, r);
      const dr = this.dangerAhead(r.x, r.y, right, 460, r);
      // Petit goût du risque piloté par la seed.
      const jitter = this.rng.float(-40, 40);
      const pick = dl + (wantBoost === left ? 120 : 0) + jitter > dr + (wantBoost === right ? 120 : 0) ? left : right;
      this.pushTurn(r, pick);
    } else if (wantBoost !== null && this.rng.next() < 0.5) {
      this.pushTurn(r, wantBoost);
    } else if (this.rng.next() < 0.035) {
      // Erreur / provocation : virage gratuit quand c'est large.
      const side = this.rng.next() < 0.5 ? ((r.dir + 3) % 4) as CycleDir : ((r.dir + 1) % 4) as CycleDir;
      if (this.dangerAhead(r.x, r.y, side, 340, r) > 260) this.pushTurn(r, side);
    }
  }

  /** Distance libre devant (murs + filaments + têtes). self = le rider qui sonde (sa tête et ses 2 derniers segments sont ignorés). */
  private dangerAhead(x: number, y: number, dir: CycleDir, max: number, self: Rider | null = null): number {
    const v = cycleDirVec(dir);
    const b = this.bounds();
    let wall = max;
    if (v.x > 0) wall = Math.min(wall, b.r - x - CYCLE_R);
    if (v.x < 0) wall = Math.min(wall, x - b.l - CYCLE_R);
    if (v.y > 0) wall = Math.min(wall, b.b - y - CYCLE_R);
    if (v.y < 0) wall = Math.min(wall, y - b.t - CYCLE_R);
    let best = Math.max(0, wall);
    const step = 23;
    for (let d = step; d <= max; d += step) {
      if (d >= best) break;
      const px = x + v.x * d;
      const py = y + v.y * d;
      if (this.trailDist(px, py, self, 2) < CYCLE_R + 7) { best = d; break; }
      for (const o of this.riders) {
        if (!o.alive || o === self) continue;
        if (Math.hypot(o.x - px, o.y - py) < CYCLE_R * 2 + 4) { best = d; break; }
      }
      if (best !== Math.max(0, wall) && best <= d) break;
    }
    return best;
  }

  /** Distance min à tout filament. ignore = rider dont on saute les skipSelfLast derniers segments (virage frais). */
  private trailDist(px: number, py: number, ignore: Rider | null, skipSelfLast = 1): number {
    let best = 1e9;
    for (const o of this.riders) {
      const pts = o.trail;
      const skipLast = o === ignore ? skipSelfLast : 0;
      const end = pts.length - 1 - skipLast;
      for (let i = 0; i < end; i++) {
        const a = pts[i];
        const b2 = pts[i + 1];
        const d = pointSegDist(px, py, a.x, a.y, b2.x, b2.y);
        if (d < best) best = d;
      }
    }
    return best;
  }

  update(dt: number): void {
    if (this.baseUpdate(dt)) return;

    // Compte à rebours express : on fige, on lit déjà les virages.
    if (this.startT > 0) {
      this.startT -= dt;
      for (const r of this.riders) {
        if (r.human) {
          const input = this.players[r.idx];
          if (input) this.readHuman(r, input);
        }
        r.blob.x = r.x;
        r.blob.y = r.y;
        r.blob.update(dt);
      }
      this.updateCamera(dt);
      if (this.startT <= 0) this.audio.good();
      return;
    }

    // Fin de manche : ralenti puis over().
    if (this.endT >= 0) {
      this.endT += dt;
      for (const r of this.riders) {
        r.blob.update(dt);
        if (!r.alive) r.deadT += dt;
      }
      this.updateCamera(dt);
      if (this.endT > 1.5 && this.state !== 'over') {
        const win = this.winner === 0;
        this.score = Math.floor(this.time * 10 + this.nearScore + (win ? 1000 : 0));
        if (win) this.musicEvent('waveComplete', 0.9);
        this.over(win);
      }
      return;
    }

    const base = this.speedBase();
    const b = this.bounds();

    // Rétrécissement garanti : les parties restent rapides.
    if (this.time > CYCLE_SHRINK_DELAY) {
      const maxInset = Math.min((CYCLE_W - CYCLE_MIN_W) / 2, (CYCLE_H - CYCLE_MIN_H) / 2 / 0.75);
      if (this.inset < maxInset) {
        this.inset = Math.min(maxInset, this.inset + CYCLE_SHRINK_SPEED * dt);
        if (!this.shrinkWarned) {
          this.shrinkWarned = true;
          this.audio.miss();
          this.musicEvent('playerHit', 0.6);
          this.fx.text(640, 200, 'RÉTRÉCISSEMENT', { color: '#ff5470', size: 26 });
          this.fx.shake(0.3);
        }
      }
    }

    // 1) intentions (virages mis en file).
    for (const r of this.riders) {
      if (!r.alive) continue;
      r.turnCd = Math.max(0, r.turnCd - dt);
      r.graceT = Math.max(0, r.graceT - dt);
      r.nearCd = Math.max(0, r.nearCd - dt);
      r.invulnOwnT = Math.max(0, r.invulnOwnT - dt);
      if (r.human) {
        const input = this.players[r.idx];
        if (input) this.readHuman(r, input);
      } else {
        this.aiThink(r, dt);
      }
      // Virage = squash violent (la hitbox ne bouge jamais).
      if (r.queue.length && r.turnCd <= 0) {
        const want = r.queue[0];
        if (cycleCanTurn(r.dir, want)) {
          r.queue.shift();
          r.trail.push({ x: r.x, y: r.y });
          r.dir = want;
          r.turnCd = 0.07;
          r.blob.punch(0.55);
          r.blob.setEmotion('determined', 0.4);
          const v = cycleDirVec(want);
          this.camKickX += v.x * 7;
          this.camKickY += v.y * 7;
          this.fx.ring(r.x, r.y, { r0: 8, r1: 52, color: r.color, life: 0.25, width: 3 });
          this.fx.burst(r.x, r.y, { n: 7, speed: [60, 240], colors: [r.color, '#ffffff'], size: [1.5, 4], life: 0.3 });
          this.audio.dash();
          if (r.human) this.input.player(r.idx)?.rumble(0.22, 0.06);
        } else {
          r.queue.shift();
        }
      }
    }

    // 2) avance.
    let spdSum = 0;
    let spdN = 0;
    for (const r of this.riders) {
      if (!r.alive) continue;
      r.boostOn = false;
      for (const z of this.zones) {
        if (Math.abs(r.x - z.x) < z.w / 2 && Math.abs(r.y - z.y) < z.h / 2) { r.boostOn = true; break; }
      }
      const target = base * (r.boostOn ? CYCLE_BOOST_MULT : 1);
      r.speed += (target - r.speed) * Math.min(1, dt * (r.boostOn ? 4 : 2.2));
      const v = cycleDirVec(r.dir);
      r.x += v.x * r.speed * dt;
      r.y += v.y * r.speed * dt;
      const head = r.trail[r.trail.length - 1];
      head.x = r.x;
      head.y = r.y;
      r.energy = Math.min(CYCLE_ENERGY_MAX, r.energy + CYCLE_ENERGY_REGEN * dt);
      if (r.boostOn) {
        r.energy = Math.min(CYCLE_ENERGY_MAX, r.energy + 0.1 * dt);
        if (Math.random() < 0.5) {
          this.fx.burst(r.x - v.x * 14, r.y - v.y * 14, { n: 1, speed: [40, 140], colors: [r.color, '#ffffff'], size: [1.5, 3.5], life: 0.3 });
        }
      }
      spdSum += r.speed;
      spdN++;
    }
    this.speedNow = spdN ? spdSum / spdN : base;

    // 3) collisions (tous bougés : les face-à-face tuent les deux).
    const deadNow: Array<{ r: Rider; cause: string }> = [];
    // Tête contre tête.
    const aliveHeads = this.riders.filter((r) => r.alive);
    for (let i = 0; i < aliveHeads.length; i++) {
      for (let j = i + 1; j < aliveHeads.length; j++) {
        const a = aliveHeads[i];
        const c = aliveHeads[j];
        if (Math.hypot(a.x - c.x, a.y - c.y) < CYCLE_R * 2 - 2) {
          deadNow.push({ r: a, cause: 'face' });
          deadNow.push({ r: c, cause: 'face' });
        }
      }
    }
    for (const r of this.riders) {
      if (!r.alive || deadNow.some((d) => d.r === r)) continue;
      // Murs (toujours mortels).
      if (r.x - CYCLE_R < b.l || r.x + CYCLE_R > b.r || r.y - CYCLE_R < b.t || r.y + CYCLE_R > b.b) {
        deadNow.push({ r, cause: 'wall' });
        continue;
      }
      if (r.graceT > 0) continue;
      // Filaments.
      let killed = false;
      for (const o of this.riders) {
        const pts = o.trail;
        // Soi : on ignore les 2 derniers segments (virage frais).
        const lastCheck = o === r ? pts.length - 3 : pts.length - 1;
        for (let i = 0; i < lastCheck; i++) {
          const a = pts[i];
          const c = pts[i + 1];
          // Segment dégénéré du spawn : ignore.
          if (Math.abs(a.x - c.x) + Math.abs(a.y - c.y) < 1) continue;
          if (pointSegDist(r.x, r.y, a.x, a.y, c.x, c.y) < CYCLE_R - 1) {
            if (o === r) {
              // Quick-win : sa vieille ligne se traverse avec de l'énergie.
              if (r.invulnOwnT <= 0 && r.energy >= CYCLE_ENERGY_COST) {
                r.energy -= CYCLE_ENERGY_COST;
                r.invulnOwnT = 0.7;
                r.blob.punch(0.4);
                r.blob.setEmotion('wow', 0.5);
                this.fx.ring(r.x, r.y, { r0: 10, r1: 70, color: '#ffffff', life: 0.35, width: 3 });
                this.fx.text(r.x, r.y - 34, '-ÉNERGIE', { color: '#ffffff', size: 16, mono: true });
                this.audio.whiff();
                this.musicEvent('playerHit', 0.35);
                if (r.human) this.input.player(r.idx)?.rumble(0.3, 0.1);
              } else if (r.invulnOwnT <= 0) {
                deadNow.push({ r, cause: 'self' });
              }
            } else {
              deadNow.push({ r, cause: 'trail' });
            }
            killed = true;
            break;
          }
        }
        if (killed) break;
      }
    }
    for (const d of deadNow) this.kill(d.r, d.cause);

    // 4) near-miss : frôler une ligne = énorme récompense.
    let bestProx = 0;
    for (const r of this.riders) {
      if (!r.alive) continue;
      let clearance = 1e9;
      // Murs.
      clearance = Math.min(clearance, r.x - b.l - CYCLE_R, b.r - r.x - CYCLE_R, r.y - b.t - CYCLE_R, b.b - r.y - CYCLE_R);
      // Filaments (hors virage frais : les 2 derniers segments perso sont ignorés,
      // sinon chaque virage offrirait un near-miss gratuit en s'éloignant du coin).
      const td = this.trailDist(r.x, r.y, r, 2);
      clearance = Math.min(clearance, td - CYCLE_R);
      const prox = clamp(1 - clearance / CYCLE_NEAR_DIST, 0, 1);
      if (prox > bestProx && r.human) bestProx = prox;
      // Anti-farming : après un +150, il faut ressortir de la zone
      // (clearance > 1.6×) pour réarmer — chaque récompense est un vrai passage.
      if (!r.nearArmed) {
        r.nearT = 0;
        if (clearance > CYCLE_NEAR_DIST * 1.6) r.nearArmed = true;
      } else if (clearance < CYCLE_NEAR_DIST && clearance > 2) {
        r.nearT += dt;
      } else {
        r.nearT = Math.max(0, r.nearT - dt * 3);
      }
      if (r.nearArmed && r.nearT > CYCLE_NEAR_TIME && r.nearCd <= 0) {
        r.nearT = 0;
        r.nearCd = CYCLE_NEAR_CD;
        r.nearArmed = false;
        r.nearCount++;
        // Score centré sur P1 (modèle single-score du moteur) : les IA
        // gardent l'énergie bonus mais ne gonflent ni score ni succès.
        if (r.idx === 0) this.nearScore += CYCLE_NEAR_SCORE;
        r.energy = Math.min(CYCLE_ENERGY_MAX, r.energy + 0.2);
        r.blob.punch(0.3);
        r.blob.setEmotion('wow', 0.6);
        this.fx.text(r.x, r.y - 40, 'NEAR +' + CYCLE_NEAR_SCORE, { color: '#ffd166', size: 22 });
        this.fx.ring(r.x, r.y, { r0: 10, r1: 90, color: '#ffd166', life: 0.4, width: 3 });
        this.fx.burst(r.x, r.y, { n: 12, speed: [80, 320], colors: ['#ffd166', '#ffffff', r.color], size: [2, 5], life: 0.45 });
        this.fx.shake(0.12);
        this.musicEvent('nearMiss', 1);
        this.audio.perfect();
        if (r.human) this.input.player(r.idx)?.rumble(0.3, 0.09);
        if (r.idx === 0 && r.nearCount === 5) this.unlockAchievement('cycle.near-5');
        if (r.idx === 0 && r.nearCount === 12) this.unlockAchievement('cycle.near-12');
      }
      r.blob.scared = clearance < 26;
    }
    this.proxT = bestProx * 0.22;

    // 5) blobs + caméra + musique.
    for (const r of this.riders) {
      r.blob.x = r.x;
      r.blob.y = r.y;
      if (r.alive) {
        const v = cycleDirVec(r.dir);
        r.blob.vx = v.x * r.speed;
        r.blob.vy = v.y * r.speed;
        if (r.boostOn) r.blob.setEmotion('determined');
        r.blob.update(dt);
        // Le trail du Blob (halo court) suivrait mal les angles : on le coupe,
        // nos filaments sont la vraie traînée.
        r.blob.trail.length = 0;
      } else {
        r.deadT += dt;
        r.blob.update(dt);
      }
    }
    this.updateCamera(dt);

    // 6) fin de manche.
    const soloHumanDead = this.solo && !this.riders[0].alive;
    const aliveCount = this.riders.filter((r) => r.alive).length;
    if (this.endT < 0 && (soloHumanDead || aliveCount <= 1)) {
      this.endT = 0;
      const last = this.riders.find((r) => r.alive);
      this.winner = soloHumanDead ? -1 : last ? last.idx : -1;
      this.fx.timeScale = 0.3;
      this.fx.shake(0.6);
      this.fx.stop(0.09);
      if (this.winner >= 0) {
        const w = this.riders[this.winner];
        this.fx.text(w.x, w.y - 60, w.name + ' GAGNE', { color: w.color, size: 30 });
        this.fx.ring(w.x, w.y, { r0: 14, r1: 150, color: w.color, life: 0.6 });
        this.audio.milestone();
        this.musicEvent('waveComplete', 0.9);
      }
    }

    this.score = Math.floor(this.time * 10 + this.nearScore);
    this.eng.dev.count('cycle-alive', aliveCount);
    this.eng.dev.count('trail-pts', this.riders.reduce((n, r) => n + r.trail.length, 0));
  }

  private kill(r: Rider, cause: string): void {
    if (!r.alive) return;
    r.alive = false;
    r.deadT = 0;
    r.blob.dead = true;
    const label = cause === 'wall' ? 'MUR' : cause === 'self' ? 'BOUCLÉ' : cause === 'face' ? 'FACE-À-FACE' : 'FILAMENT';
    this.fx.burst(r.x, r.y, { n: 26, speed: [100, 520], colors: [r.color, '#ffffff', '#ffd166'], size: [2, 6], life: 0.7 });
    this.fx.burst(r.x, r.y, { n: 12, speed: [60, 300], colors: [r.color, '#ffffff'], size: [2, 4], life: 0.6, shape: 'sq' });
    this.fx.ring(r.x, r.y, { r0: 10, r1: 120, color: r.color, life: 0.45 });
    this.fx.ring(r.x, r.y, { r0: 6, r1: 70, color: '#ff5470', life: 0.35 });
    this.fx.text(r.x, r.y - 44, label, { color: '#ff8a9a', size: 18, mono: true });
    this.fx.shake(0.5);
    this.fx.flash(r.color, 0.08);
    this.audio.explode(1.1);
    this.musicEvent('playerHit', 0.9);
    if (r.human) this.input.player(r.idx)?.rumble(0.9, 0.3);
    else this.input.rumble(0.25, 0.1);
  }

  // Caméra : cadre tous les survivants + anticipation, s'éloigne près des bords,
  // se compresse légèrement à haute vitesse (le zoom reste uniforme côté Fx).
  private updateCamera(dt: number): void {
    const alive = this.riders.filter((r) => r.alive);
    const list = alive.length ? alive : this.riders;
    let minX = 1e9;
    let maxX = -1e9;
    let minY = 1e9;
    let maxY = -1e9;
    let vx = 0;
    let vy = 0;
    for (const r of list) {
      const v = r.alive ? cycleDirVec(r.dir) : { x: 0, y: 0 };
      const look = 130;
      minX = Math.min(minX, r.x + v.x * look);
      maxX = Math.max(maxX, r.x + v.x * look);
      minY = Math.min(minY, r.y + v.y * look);
      maxY = Math.max(maxY, r.y + v.y * look);
      vx += v.x;
      vy += v.y;
    }
    const n = Math.max(1, list.length);
    vx /= n;
    vy /= n;
    const c = this.centroid();
    const tx = c.x + vx * 90 + this.camKickX * 8;
    const ty = c.y + vy * 90 + this.camKickY * 8;
    this.camKickX *= Math.exp(-6 * dt);
    this.camKickY *= Math.exp(-6 * dt);
    const bw = maxX - minX + 560;
    const bh = maxY - minY + 420;
    let zoom = Math.min(1280 / bw, 720 / bh, 1);
    zoom = clamp(zoom, 0.34, 1);
    // Anticipation des murs : plus on s'en approche, plus on dézoome.
    const b = this.bounds();
    let edgeK = 0;
    for (const r of list) {
      const d = Math.min(r.x - b.l, b.r - r.x, r.y - b.t, b.b - r.y);
      if (d < 620) edgeK = Math.max(edgeK, 1 - Math.max(0, d) / 620);
    }
    zoom = clamp(zoom - edgeK * 0.16, 0.34, 1);
    // Compression haute vitesse : on rend un peu de champ.
    zoom = clamp(zoom - this.speedNorm() * 0.05, 0.34, 1);
    this.zoomSm += (zoom - this.zoomSm) * Math.min(1, dt * 2.6);
    this.camX += (tx - this.camX) * Math.min(1, dt * 4.5);
    this.camY += (ty - this.camY) * Math.min(1, dt * 4.5);
    // Reste dans le monde (avec marge d'écran).
    const vw = 1280 / (2 * this.zoomSm);
    const vh = 720 / (2 * this.zoomSm);
    this.camX = clamp(this.camX, b.l + vw - 700, b.r - vw + 700);
    this.camY = clamp(this.camY, b.t + vh - 420, b.b - vh + 420);
    this.fx.zoom = this.zoomSm;
    this.fx.userSwayX = this.camKickX * 0.6 + Math.sin(this.time * 39) * 2.2 * this.speedNorm();
    this.fx.userRot = Math.sin(this.time * 29) * 0.002 * this.speedNorm();
  }

  // ---------- rendu ----------
  render(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#04050a';
    ctx.fillRect(0, 0, 1280, 720);

    this.fx.world(ctx);
    // Caméra monde : centre sur (camX, camY). Le translate s'applique en unités
    // monde (avant le scale du Fx), d'où 640 - camX et non 640 - camX * zoom.
    ctx.translate(640 - this.camX, 360 - this.camY);

    const b = this.bounds();
    const t = this.time;

    // Fond : grille néon discrète (repère de vitesse).
    ctx.save();
    ctx.strokeStyle = '#00e5ff';
    ctx.globalAlpha = 0.05;
    ctx.lineWidth = 2;
    const gap = 160;
    ctx.beginPath();
    for (let x = Math.floor((b.l - 400) / gap) * gap; x < b.r + 400; x += gap) {
      ctx.moveTo(x, b.t - 400);
      ctx.lineTo(x, b.b + 400);
    }
    for (let y = Math.floor((b.t - 400) / gap) * gap; y < b.b + 400; y += gap) {
      ctx.moveTo(b.l - 400, y);
      ctx.lineTo(b.r + 400, y);
    }
    ctx.stroke();
    ctx.restore();

    // Zones de boost.
    for (const z of this.zones) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 4 + z.phase);
      ctx.save();
      ctx.globalAlpha = 0.16 + pulse * 0.1;
      ctx.fillStyle = '#00e5ff';
      UI.roundRect(ctx, z.x - z.w / 2, z.y - z.h / 2, z.w, z.h, 26);
      ctx.fill();
      ctx.globalAlpha = 0.55 + pulse * 0.35;
      ctx.strokeStyle = '#a5f3fc';
      ctx.lineWidth = 3;
      UI.roundRect(ctx, z.x - z.w / 2, z.y - z.h / 2, z.w, z.h, 26);
      ctx.stroke();
      // Chevrons de direction.
      ctx.globalAlpha = 0.5 + pulse * 0.4;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      const off = ((t * 160 + z.phase * 40) % 60) - 30;
      for (let k = -1; k <= 1; k++) {
        const cx = z.x + k * 56 + off * 0.3;
        ctx.beginPath();
        ctx.moveTo(cx - 14, z.y - 16);
        ctx.lineTo(cx + 6, z.y);
        ctx.lineTo(cx - 14, z.y + 16);
        ctx.stroke();
      }
      ctx.restore();
      UI.txt(ctx, 'BOOST', z.x, z.y - z.h / 2 - 12, { size: 15, align: 'center', mono: true, color: '#a5f3fc' });
    }

    // Murs qui respirent : halo large + cœur + vraie frontière blanche dessus.
    const breathe = Math.sin(t * 2.3) * 4 + this.speedNorm() * 4;
    const shrinkK = this.inset > 0 ? 1 : 0;
    ctx.save();
    ctx.strokeStyle = this.meta.accent;
    ctx.globalAlpha = 0.28;
    ctx.lineWidth = 22 + breathe * 2;
    ctx.shadowColor = this.meta.accent;
    ctx.shadowBlur = 30;
    ctx.strokeRect(b.l, b.t, b.r - b.l, b.b - b.t);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 3;
    ctx.strokeRect(b.l, b.t, b.r - b.l, b.b - b.t);
    // Frontière gameplay nette, lisible à toute intensité.
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = '#e8ecf2';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(b.l, b.t, b.r - b.l, b.b - b.t);
    ctx.restore();
    if (shrinkK) {
      UI.txt(ctx, '▼ ZONE ▼', (b.l + b.r) / 2, b.t - 14, { size: 13, align: 'center', mono: true, color: '#ff8a9a' });
    }

    // Filaments de matière : halo additif + corps + âme blanche.
    for (const r of this.riders) {
      const pts = r.trail;
      if (pts.length < 2) continue;
      const dim = r.alive ? 1 : 0.32;
      const path = (): void => {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      };
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.16 * dim;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 16;
      path();
      ctx.stroke();
      ctx.globalAlpha = 0.5 * dim;
      ctx.lineWidth = 7;
      path();
      ctx.stroke();
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = 0.95 * dim;
      ctx.strokeStyle = r.boostOn ? '#ffffff' : r.color;
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      path();
      ctx.stroke();
      ctx.restore();
      // Bouclier d'énergie : on voit le passage payé.
      if (r.alive && r.invulnOwnT > 0) {
        ctx.save();
        ctx.globalAlpha = 0.5 + 0.4 * Math.sin(t * 18);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(r.x, r.y, CYCLE_R + 10, 0, 6.2832);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Têtes = blobs (squash violent conservé, hitbox r intacte).
    for (const r of this.riders) {
      if (!r.alive && r.deadT > 1.2) continue;
      if (!r.alive) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - r.deadT);
        r.blob.render(ctx);
        ctx.restore();
      } else {
        r.blob.render(ctx);
        // Étiquette + jauge d'énergie : lisible sans dashboard.
        ctx.save();
        UI.txt(ctx, r.name, r.x, r.y - 30, { size: 13, align: 'center', mono: true, color: r.color });
        const ew = 52;
        ctx.fillStyle = 'rgba(255,255,255,0.14)';
        ctx.fillRect(r.x - ew / 2, r.y + 20, ew, 5);
        ctx.fillStyle = r.energy < CYCLE_ENERGY_COST ? '#ff5470' : r.color;
        ctx.fillRect(r.x - ew / 2, r.y + 20, ew * (r.energy / CYCLE_ENERGY_MAX), 5);
        ctx.restore();
      }
    }

    this.fx.drawWorld(ctx);
    this.fx.endWorld(ctx);

    // Danger latéral : on rase un mur, l'écran le dit.
    const p0 = this.riders[0];
    if (p0?.alive && this.state === 'play') {
      const dL = p0.x - b.l;
      const dR = b.r - p0.x;
      const dT = p0.y - b.t;
      const dB = b.b - p0.y;
      const m = Math.min(dL, dR, dT, dB);
      if (m < 220) {
        const k = (1 - m / 220) * (0.5 + 0.5 * Math.sin(t * 10));
        ctx.save();
        ctx.globalAlpha = 0.16 * k + 0.06;
        ctx.fillStyle = '#ff5470';
        if (m === dL) ctx.fillRect(0, 0, 130, 720);
        else if (m === dR) ctx.fillRect(1150, 0, 130, 720);
        else if (m === dT) ctx.fillRect(0, 0, 1280, 110);
        else ctx.fillRect(0, 610, 1280, 110);
        ctx.restore();
      }
    }

    // HUD.
    const aliveCount = this.riders.filter((r) => r.alive).length;
    UI.drawHUD(ctx, {
      accent: this.meta.accent,
      score: this.score,
      unit: this.meta.unit,
      time: this.time,
      extra: () => {
        UI.txt(ctx, 'EN VIE ' + aliveCount + '/' + this.riders.length, 28, 70, { size: 13, mono: true, color: '#a5f3fc' });
        if (this.riders[0]) {
          const e = this.riders[0].energy;
          UI.txt(ctx, 'ÉNERGIE ' + Math.round(e * 100) + '%', 28, 90, {
            size: 13, mono: true, color: e < CYCLE_ENERGY_COST ? '#ff8a9a' : '#7c8698',
          });
          if (this.nearScore > 0) UI.txt(ctx, 'NEAR +' + this.nearScore, 28, 110, { size: 13, mono: true, color: '#ffd166' });
        }
        if (this.inset > 0) UI.txt(ctx, 'ZONE ↓', 28, 130, { size: 13, mono: true, color: '#ff8a9a' });
      },
    });

    // Minimap : les vrais murs affichés en avance + viewport.
    this.drawMinimap(ctx);

    if (this.startT > 0) {
      ctx.fillStyle = 'rgba(2,3,8,0.45)';
      ctx.fillRect(0, 0, 1280, 720);
      UI.txt(ctx, 'PRÊT', 640, 330, { size: 64, align: 'center', color: '#eaf6ff', weight: 900, shadow: true });
      UI.txt(ctx, this.session.playerCount > 1 ? 'Dernier survivant gagne · frôlez pour +150' : 'Survis face aux 3 IA · ta vieille ligne coûte 35% d’énergie', 640, 372, {
        size: 17, align: 'center', color: '#a5f3fc',
      });
      UI.txt(ctx, Math.ceil(this.startT) + '…', 640, 420, { size: 40, align: 'center', mono: true, color: this.meta.accent });
    }
    if (this.endT >= 0 && this.state !== 'over') {
      const w = this.riders[this.winner];
      UI.txt(ctx, w ? w.name + ' GAGNE' : 'ÉLIMINÉ', 640, 300, {
        size: 54, align: 'center', color: w ? w.color : '#ff8a9a', weight: 900, shadow: true,
      });
    }
    this.drawCommon(ctx);
  }

  private drawMinimap(ctx: CanvasRenderingContext2D): void {
    const mw = 190;
    const mh = 107;
    const mx = 16;
    const my = 150;
    const b = this.bounds();
    ctx.save();
    UI.panel(ctx, mx - 8, my - 24, mw + 16, mh + 52, {
      radius: 12, fill: 'rgba(7,10,17,0.72)', stroke: this.meta.accent + '44', lineWidth: 1.25,
    });
    UI.txt(ctx, 'SECTEUR', mx + mw / 2, my - 8, { size: 9, align: 'center', mono: true, color: this.meta.accent });
    const sx = mw / CYCLE_W;
    const sy = mh / CYCLE_H;
    // Zone de jeu (rétrécie) + murs.
    ctx.strokeStyle = '#e8ecf2';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(mx + b.l * sx, my + b.t * sy, (b.r - b.l) * sx, (b.b - b.t) * sy);
    // Boosts.
    ctx.fillStyle = '#00e5ff88';
    for (const z of this.zones) ctx.fillRect(mx + z.x * sx - 3, my + z.y * sy - 2, 6, 4);
    // Trails simplifiés : dernier segment suffit à lire la menace.
    for (const r of this.riders) {
      ctx.strokeStyle = r.color;
      ctx.globalAlpha = r.alive ? 0.8 : 0.25;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const pts = r.trail;
      const from = Math.max(0, pts.length - 40);
      ctx.moveTo(mx + pts[from].x * sx, my + pts[from].y * sy);
      for (let i = from + 1; i < pts.length; i++) ctx.lineTo(mx + pts[i].x * sx, my + pts[i].y * sy);
      ctx.stroke();
      ctx.globalAlpha = 1;
      if (r.alive || r.deadT < 2) {
        ctx.fillStyle = r.color;
        ctx.beginPath();
        ctx.arc(mx + r.x * sx, my + r.y * sy, r.human ? 4 : 3, 0, 6.2832);
        ctx.fill();
      }
    }
    // Viewport caméra.
    ctx.strokeStyle = '#ffffff55';
    ctx.lineWidth = 1;
    const vw = 1280 / this.zoomSm * sx;
    const vh = 720 / this.zoomSm * sy;
    ctx.strokeRect(mx + this.camX * sx - vw / 2, my + this.camY * sy - vh / 2, vw, vh);
    ctx.restore();
  }

  debugRender(ctx: CanvasRenderingContext2D): void {
    if (!this.eng.dev.flags.hitboxes) return;
    ctx.save();
    ctx.translate(640, 360);
    ctx.scale(this.zoomSm, this.zoomSm);
    ctx.translate(-this.camX, -this.camY);
    ctx.strokeStyle = '#ff5470';
    ctx.lineWidth = 2 / this.zoomSm;
    for (const r of this.riders) {
      if (!r.alive) continue;
      ctx.beginPath();
      ctx.arc(r.x, r.y, CYCLE_R, 0, 6.2832);
      ctx.stroke();
    }
    ctx.restore();
  }

  debugSnapshot(): Record<string, string | number | boolean | null> {
    return {
      game: 'cycle',
      state: this.state,
      alive: this.riders.filter((r) => r.alive).length,
      riders: this.riders.length,
      time: Number(this.time.toFixed(2)),
      winner: this.winner,
      seed: this.session.seed,
    };
  }
}
