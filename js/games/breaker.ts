// BLOB BREAKER — casse-briques : paddle-blob en bas, balle-blob qui rebondit,
// motifs paramétriques, tuiles à réaction, pouvoirs combinables et combo.
// Tout est dessiné au canvas, tous les sons sont synthétisés.

import { BaseGame } from '../core/game';
import { Blob } from '../core/blob';
import * as UI from '../core/ui';
import type { EngineLike, GameMeta } from '../core/types';

const WALL = 20;             // marge de jeu (murs latéraux + plafond)
const PAD_Y = 660;           // y du paddle
const BUMPER_BOOST = 1.22;
const BUMPER_BOOST_TIME = 0.45;
const WALL_COLLISION_PADDING = 4;
const BRICK_COLLISION_PADDING = 2;
const BUMPER_COLLISION_PADDING = 4;
const BUMPER_CHAOS_MIN = 0.045;
const BUMPER_CHAOS_MAX = 0.105;
const PTS = [50, 40, 30, 20, 15, 10];
const PAL = ['#fb7185', '#f472b6', '#c084fc', '#818cf8', '#38bdf8', '#34d399'];
const PALD = ['#6b2434', '#66284a', '#4a2a63', '#333a6b', '#1c4a66', '#1a5a42']; // teintes sombres (brique abîmée)
type DropKind = 'MULTI' | 'LARGE' | 'SLOW' | 'LASER' | 'GLUE' | 'FLAME' | 'GIANT' | 'SMALL';
type BrickKind = 'normal' | 'reinforced' | 'gravity' | 'explosive';
type PatternKind = 'grid' | 'diamond' | 'cross' | 'flower' | 'wave' | 'ring' | 'checker';
type ObstacleKind = 'wall' | 'bumper';
type BreakerLabMode = 'readability' | 'wall' | 'corridor' | 'bumper' | 'billiard' | 'chain';

interface CollisionHit {
  nx: number;
  ny: number;
  penetration: number;
  contactX: number;
  contactY: number;
}

interface BreakerWall {
  id: number;
  kind: 'wall';
  x: number;
  y: number;
  w: number;
  h: number;
}

interface BreakerBumper {
  id: number;
  kind: 'bumper';
  x: number;
  y: number;
  r: number;
  boost: number;
  pulseT: number;
}

type BreakerObstacle = BreakerWall | BreakerBumper;

interface BreakerLabStats {
  wallHits: number;
  bumperHits: number;
  bumperToBrick: number;
  bumperToExplosive: number;
  maxCombo: number;
}

interface LabContact {
  x: number;
  y: number;
  nx: number;
  ny: number;
  t: number;
}

interface LevelSpec {
  name: string;
  motif: PatternKind;
  cols: number;
  rows: number;
  tileW: number;
  tileH: number;
  gapX: number;
  gapY: number;
  density: number;
  reinforcedChance: number;
  gravityChance: number;
  explosiveChance: number;
  maxBlast: number;
}

interface BreakerBrick {
  x: number;
  y: number;
  w: number;
  h: number;
  hp: number;
  maxHp: number;
  pts: number;
  color: string;
  dark: string;
  kind: BrickKind;
  blast: number;
  fl: number;
  hitT: number;
  hitX: number;
  hitY: number;
  animPhase: number;
  falling?: boolean;
  detachT?: number;
  vy?: number;
  rot?: number;
  queued?: boolean;
  exploded?: boolean;
}

interface ExplosionPulse {
  x: number;
  y: number;
  radius: number;
  power: number;
  color: string;
  t: number;
  maxT: number;
  depth: number;
  chargeT: number;
  burstT: number;
  burstDone: boolean;
}

interface PendingExplosion {
  brick: BreakerBrick;
  delay: number;
  initialDelay: number;
  depth: number;
}

const cellNoise = (level: number, row: number, col: number): number => {
  const value = Math.sin(level * 12.9898 + row * 78.233 + col * 37.719) * 43758.5453;
  return value - Math.floor(value);
};

const motifOn = (spec: LevelSpec, row: number, col: number, level: number): boolean => {
  const cx = (spec.cols - 1) / 2;
  const cy = (spec.rows - 1) / 2;
  const nx = (col - cx) / Math.max(1, cx);
  const ny = (row - cy) / Math.max(1, cy);
  const ax = Math.abs(nx), ay = Math.abs(ny);
  const radius = Math.hypot(nx, ny);
  let on = true;

  if (spec.motif === 'diamond') on = ax + ay <= 1.06;
  else if (spec.motif === 'cross') on = ax < 0.19 || ay < 0.23 || (ax > 0.68 && ay > 0.52);
  else if (spec.motif === 'flower') {
    const angle = Math.atan2(ny, nx);
    on = radius < 0.38 || (radius < 1.05 && Math.sin(angle * 6 + radius * 8) > -0.12);
  } else if (spec.motif === 'wave') {
    const wave = Math.sin(nx * Math.PI * 2.4 + level * 0.55) * 0.34;
    on = Math.abs(ny - wave) < 0.22 || Math.abs(ny + wave * 0.72) < 0.17;
  } else if (spec.motif === 'ring') {
    on = (radius > 0.36 && radius < 1.02) || (ax < 0.18 && ay < 0.18);
  } else if (spec.motif === 'checker') {
    on = (row + col) % 2 === 0 || row === 0 || row === spec.rows - 1;
  }

  if (!on || spec.density >= 0.999) return on;
  return cellNoise(level + 41, row, col) < spec.density;
};

const clampValue = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const circleVsAabb = (
  cx: number, cy: number, r: number,
  boxX: number, boxY: number, boxW: number, boxH: number,
  padding = 0,
): CollisionHit | null => {
  const leftEdge = boxX - padding, rightEdge = boxX + boxW + padding;
  const topEdge = boxY - padding, bottomEdge = boxY + boxH + padding;
  const contactX = clampValue(cx, leftEdge, rightEdge);
  const contactY = clampValue(cy, topEdge, bottomEdge);
  const dx = cx - contactX, dy = cy - contactY;
  const distanceSq = dx * dx + dy * dy;
  if (distanceSq > r * r) return null;

  if (distanceSq > 0.000001) {
    const distance = Math.sqrt(distanceSq);
    return { nx: dx / distance, ny: dy / distance, penetration: r - distance, contactX, contactY };
  }

  // Le centre est dans la boîte : on choisit la face la plus proche et on
  // sort la balle de la géométrie avant de décider d'une réflexion.
  const left = cx - leftEdge, right = rightEdge - cx;
  const top = cy - topEdge, bottom = bottomEdge - cy;
  const nearest = Math.min(left, right, top, bottom);
  if (nearest === left) return { nx: -1, ny: 0, penetration: r + left, contactX: leftEdge, contactY: cy };
  if (nearest === right) return { nx: 1, ny: 0, penetration: r + right, contactX: rightEdge, contactY: cy };
  if (nearest === top) return { nx: 0, ny: -1, penetration: r + top, contactX: cx, contactY: topEdge };
  return { nx: 0, ny: 1, penetration: r + bottom, contactX: cx, contactY: bottomEdge };
};

const circleVsCircle = (
  ax: number, ay: number, ar: number,
  bx: number, by: number, br: number,
  padding = 0,
): CollisionHit | null => {
  const dx = ax - bx, dy = ay - by;
  const distanceSq = dx * dx + dy * dy;
  const effectiveBr = br + padding;
  const sum = ar + effectiveBr;
  if (distanceSq > sum * sum) return null;
  if (distanceSq > 0.000001) {
    const distance = Math.sqrt(distanceSq);
    return {
      nx: dx / distance, ny: dy / distance, penetration: sum - distance,
      contactX: bx + dx / distance * effectiveBr, contactY: by + dy / distance * effectiveBr,
    };
  }
  return { nx: 0, ny: -1, penetration: sum, contactX: bx, contactY: by - effectiveBr };
};

const reflectVelocity = (ball: any, hit: CollisionHit): number => {
  const dot = ball.vx * hit.nx + ball.vy * hit.ny;
  if (dot < 0) {
    ball.vx -= 2 * dot * hit.nx;
    ball.vy -= 2 * dot * hit.ny;
  }
  return dot;
};

const DCOL: Record<DropKind, string> = {
  MULTI: '#7dd3fc', LARGE: '#34d399', SLOW: '#c084fc',
  LASER: '#ff4d9d', GLUE: '#a78bfa', FLAME: '#ff8a34',
  GIANT: '#facc15', SMALL: '#94a3b8',
};
const DGLYPH: Record<DropKind, string> = {
  MULTI: 'M', LARGE: 'L', SLOW: 'S', LASER: 'LA', GLUE: 'G',
  FLAME: 'F', GIANT: 'GI', SMALL: 'SM',
};

interface BreakerDrop {
  x: number;
  y: number;
  kind: DropKind;
  dead?: boolean;
}

interface LaserBolt {
  x: number;
  y: number;
  vy: number;
  r: number;
  life: number;
  dead?: boolean;
}

export class BreakerGame extends BaseGame {
  [key: string]: any;
  static meta: GameMeta = {
    id: 'breaker', name: 'BLOB BREAKER', accent: '#fb7185', mood: 'shooter',
    desc: 'Casse tout au blob-rebond', controls: 'Stick G / ZQSD paddle · Espace / J lancer',
    keys: "ZQSD + Espace",
    hint: 'Espace / J = lancer / relâcher · attrape les drops · évite les tuiles bleues',
    unit: 'pts', ranks: [5000, 3000, 1500, 600, 0],
  };

  constructor(engine: EngineLike) {
    super(engine);
    this.pad = { x: 640, y: PAD_Y, vx: 0, vy: 0 };
    this.padW = 110;
    this.largeT = 0;
    this.smallT = 0;
    this.giantT = 0;
    this.flameT = 0;
    this.laserT = 0;
    this.laserFireT = 0;
    this.glueT = 0;
    this.freezeT = 0;
    this.freezePulseT = 0;
    // la balle principale EST le blob de BaseGame
    this.blob.r = 9; this.blob.trailOn = true;
    this.blob.x = 640; this.blob.y = PAD_Y - 26;
    this.balls = [this.blob];
    this.stuck = true;
    this.lives = 3;
    this.level = 1;
    this.baseSpd = 430;
    this.speed = 430;
    this.broken = 0;
    this.comboStep = 0; this.comboT = 0;
    this.slowT = 0;
    this.drops = [] as BreakerDrop[];
    this.lasers = [] as LaserBolt[];
    this.explosionQueue = [] as PendingExplosion[];
    this.explosions = [] as ExplosionPulse[];
    this.bricks = [];
    this.obstacles = [] as BreakerObstacle[];
    this.lab = this.readLabMode();
    this.labStats = { wallHits: 0, bumperHits: 0, bumperToBrick: 0, bumperToExplosive: 0, maxCombo: 0 } as BreakerLabStats;
    this.labContact = null as LabContact | null;
    this.buildLevel();
  }

  readLabMode(): BreakerLabMode | null {
    const isDev = (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV === true;
    if (!isDev || typeof window === 'undefined') return null;
    const raw = new URLSearchParams(window.location.search).get('breakerLab');
    const modes: BreakerLabMode[] = ['readability', 'wall', 'corridor', 'bumper', 'billiard', 'chain'];
    return modes.includes(raw as BreakerLabMode) ? raw as BreakerLabMode : null;
  }

  buildLevel(): void {
    this.buildBricks();
    this.buildObstacles();
    this.labContact = null;
  }

  levelSpecFor(level: number): LevelSpec {
    const cycle = Math.floor((level - 1) / 6);
    const stage = (level - 1) % 6;
    const templates: LevelSpec[] = [
      { name: 'MOSAÏQUE', motif: 'grid', cols: 10, rows: 6, tileW: 100, tileH: 24, gapX: 12, gapY: 9, density: 1, reinforcedChance: 0.02, gravityChance: 0, explosiveChance: 0, maxBlast: 0 },
      { name: 'DIAMANT', motif: 'diamond', cols: 12, rows: 7, tileW: 70, tileH: 21, gapX: 8, gapY: 8, density: 1, reinforcedChance: 0.1, gravityChance: 0, explosiveChance: 0, maxBlast: 0 },
      { name: 'CROIX', motif: 'cross', cols: 13, rows: 7, tileW: 64, tileH: 20, gapX: 8, gapY: 8, density: 0.98, reinforcedChance: 0.14, gravityChance: 0.08, explosiveChance: 0, maxBlast: 0 },
      { name: 'FLEUR', motif: 'flower', cols: 14, rows: 8, tileW: 58, tileH: 19, gapX: 7, gapY: 7, density: 0.96, reinforcedChance: 0.13, gravityChance: 0.04, explosiveChance: 0.08, maxBlast: 1 },
      { name: 'VAGUE', motif: 'wave', cols: 15, rows: 8, tileW: 53, tileH: 19, gapX: 7, gapY: 7, density: 0.94, reinforcedChance: 0.16, gravityChance: 0.1, explosiveChance: 0.12, maxBlast: 2 },
      { name: 'CASCADE', motif: 'ring', cols: 16, rows: 9, tileW: 48, tileH: 18, gapX: 6, gapY: 6, density: 0.93, reinforcedChance: 0.18, gravityChance: 0.14, explosiveChance: 0.16, maxBlast: 2 },
    ];
    const base = templates[stage];
    if (!cycle) return { ...base };

    // Les cycles suivants reprennent les motifs avec une maille plus fine et
    // une légère variation de densité/types : la difficulté monte sans devenir
    // une simple inflation des points de vie.
    return {
      ...base,
      name: base.name + ' +' + cycle,
      cols: Math.min(18, base.cols + cycle),
      rows: Math.min(10, base.rows + (cycle > 1 ? 1 : 0)),
      tileW: Math.max(42, base.tileW - cycle * 3),
      tileH: Math.max(16, base.tileH - (cycle > 1 ? 1 : 0)),
      gapX: Math.max(5, base.gapX - Math.min(2, cycle)),
      gapY: Math.max(5, base.gapY - Math.min(2, cycle)),
      density: Math.min(1, base.density + cycle * 0.012),
      reinforcedChance: Math.min(0.34, base.reinforcedChance + cycle * 0.035),
      gravityChance: Math.min(0.2, base.gravityChance + cycle * 0.018),
      explosiveChance: Math.min(0.24, base.explosiveChance + cycle * 0.022),
      maxBlast: Math.min(3, base.maxBlast + (cycle > 1 ? 1 : 0)),
    };
  }

  createBrick(
    x: number, y: number, w: number, h: number, row: number,
    kind: BrickKind = 'normal', hp = 1, blast = 0, phase = 0,
  ): BreakerBrick {
    const colorIndex = Math.max(0, Math.min(PAL.length - 1, row | 0));
    return {
      x, y, w, h, hp, maxHp: hp,
      pts: PTS[Math.min(PTS.length - 1, colorIndex)] + (kind === 'explosive' ? 15 : kind === 'gravity' ? 10 : 0),
      color: PAL[colorIndex], dark: PALD[colorIndex], kind, blast,
      fl: 0, hitT: 0, hitX: x + w / 2, hitY: y + h / 2,
      animPhase: clampValue(phase, 0, 1),
    };
  }

  buildBricks(): void {
    const spec = this.levelSpec = this.levelSpecFor(this.level);
    this.bricks = [];
    this.explosionQueue = [];
    this.explosions = [];
    const totalW = spec.cols * spec.tileW + (spec.cols - 1) * spec.gapX;
    const startX = (1280 - totalW) / 2;
    const startY = 82;

    if (this.lab) {
      this.buildLabBricks(this.lab);
      return;
    }

    for (let r = 0; r < spec.rows; r++) {
      for (let c = 0; c < spec.cols; c++) {
        if (!motifOn(spec, r, c, this.level)) continue;
        const typeRoll = cellNoise(this.level + 7, r, c);
        const explosiveRoll = cellNoise(this.level + 17, r, c);
        const gravityRoll = cellNoise(this.level + 29, r, c);
        let kind: BrickKind = 'normal';
        let hp = 1;
        let blast = 0;

        if (spec.explosiveChance > 0 && explosiveRoll < spec.explosiveChance) {
          kind = 'explosive';
          const maxBlast = Math.max(1, spec.maxBlast);
          blast = 1 + Math.min(maxBlast - 1, Math.floor(cellNoise(this.level + 67, r, c) * maxBlast));
        } else if (spec.gravityChance > 0 && gravityRoll < spec.gravityChance) {
          kind = 'gravity';
        } else if (typeRoll < spec.reinforcedChance) {
          kind = 'reinforced';
          hp = this.level >= 7 && typeRoll < spec.reinforcedChance * 0.24 ? 3 : 2;
        }

        const rowProgress = r / Math.max(1, spec.rows - 1);
        this.bricks.push(this.createBrick(
          startX + c * (spec.tileW + spec.gapX), startY + r * (spec.tileH + spec.gapY),
          spec.tileW, spec.tileH, Math.floor(rowProgress * PAL.length), kind, hp, blast,
          cellNoise(this.level + 311, r, c),
        ));
      }
    }
  }

  buildLabBricks(mode: BreakerLabMode): void {
    const labNames: Record<BreakerLabMode, string> = {
      readability: 'TYPES', wall: 'WALL', corridor: 'CORRIDOR', bumper: 'BUMPER', billiard: 'BILLIARD', chain: 'CHAIN',
    };
    this.levelSpec = {
      name: 'LAB · ' + labNames[mode], motif: 'grid', cols: 12, rows: 4,
      tileW: 80, tileH: 22, gapX: 10, gapY: 8, density: 1,
      reinforcedChance: 0, gravityChance: 0, explosiveChance: 0, maxBlast: 0,
    };
    const add = (x: number, y: number, row: number, kind: BrickKind = 'normal', hp = 1, blast = 0, phase = 0): void => {
      this.bricks.push(this.createBrick(x, y, 80, 22, row, kind, hp, blast, phase));
    };

    if (mode === 'readability') {
      const kinds: Array<[BrickKind, number, number]> = [
        ['normal', 1, 0], ['reinforced', 2, 0], ['explosive', 1, 2], ['gravity', 1, 0],
      ];
      kinds.forEach(([kind, hp, blast], i) => {
        const x = 155 + i * 250;
        this.bricks.push(this.createBrick(x, 220, 190, 48, i + 1, kind, hp, blast, cellNoise(17, i, 3)));
      });
      return;
    }

    if (mode === 'chain') {
      for (let c = 0; c < 12; c++) add(150 + c * 90, 110, 0, c % 4 === 0 ? 'reinforced' : 'normal', c % 4 === 0 ? 2 : 1, 0, cellNoise(23, 0, c));
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 6; c++) {
          const explosive = r > 0;
          add(420 + c * 90, 230 + r * 30, 2 + r, explosive ? 'explosive' : 'normal', 1, explosive ? 2 : 0, cellNoise(29, r, c));
        }
      }
      return;
    }

    const rows = mode === 'corridor' ? 4 : 3;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < 12; c++) {
        const kind: BrickKind = mode === 'bumper' && r === 1 && c % 4 === 1 ? 'reinforced' : 'normal';
        add(150 + c * 90, 110 + r * 30, r, kind, kind === 'reinforced' ? 2 : 1, 0, cellNoise(37, r, c));
      }
    }
  }

  buildObstacles(): void {
    this.obstacles = [];
    if (!this.lab || this.lab === 'readability') return;
    let nextId = 1;
    const addWall = (x: number, y: number, w: number, h: number): void => {
      this.obstacles.push({ id: nextId++, kind: 'wall', x, y, w, h });
    };
    const addBumper = (x: number, y: number, r = 30): void => {
      this.obstacles.push({ id: nextId++, kind: 'bumper', x, y, r, boost: 1.22, pulseT: 0 });
    };

    if (this.lab === 'wall') {
      addWall(420, 360, 440, 20);
    } else if (this.lab === 'corridor') {
      addWall(390, 230, 20, 350);
      addWall(870, 230, 20, 350);
    } else if (this.lab === 'bumper') {
      addBumper(640, 380, 34);
    } else if (this.lab === 'billiard') {
      addWall(350, 250, 20, 285);
      addWall(910, 250, 20, 285);
      addBumper(500, 390, 30);
      addBumper(780, 390, 30);
    } else if (this.lab === 'chain') {
      addWall(355, 205, 20, 330);
      addWall(905, 205, 20, 330);
      addWall(480, 410, 320, 18);
      addBumper(640, 500, 32);
    }
  }

  // renormalise la vitesse de toutes les balles actives (après +10 / changement de niveau)
  targetBallSpeed(bl: any): number {
    const boostT = clampValue(bl.bumperBoostT || 0, 0, BUMPER_BOOST_TIME);
    const boost = Math.max(1, bl.bumperBoost || BUMPER_BOOST);
    const boostK = boostT / BUMPER_BOOST_TIME;
    return this.speed * (1 + (boost - 1) * boostK);
  }

  normSpeed(): void {
    for (const b of this.balls) {
      if (this.stuck && b === this.balls[0]) continue;
      const l = Math.hypot(b.vx, b.vy) || 1;
      const target = this.targetBallSpeed(b);
      b.vx *= target / l; b.vy *= target / l;
    }
  }

  targetPaddleWidth(): number {
    return Math.max(56, Math.min(188, 110 + (this.largeT > 0 ? 72 : 0) - (this.smallT > 0 ? 46 : 0)));
  }

  extendPowerTimer(name: 'largeT' | 'smallT' | 'giantT' | 'flameT' | 'slowT', amount: number, max: number): void {
    this[name] = Math.min(max, this[name] + amount);
  }

  launchBall(bl: any, angle = (Math.random() * 2 - 1) * (Math.PI / 9)): void {
    bl.glued = false;
    bl.glueWait = 0;
    bl.lastBrick = null;
    bl.lastBrickT = 0;
    const launchSpeed = this.targetBallSpeed(bl);
    bl.vx = Math.sin(angle) * launchSpeed;
    bl.vy = -Math.cos(angle) * launchSpeed;
    this.audio.jump();
    this.input.rumble(0.12, 0.05);
    this.fx.burst(bl.x, bl.y, { n: 8, speed: [40, 200], colors: [this.accent, '#ffffff'], life: 0.35 });
  }

  launch(): void {
    const b = this.balls[0];
    if (!b) return;
    // Les scènes B-LAB commencent sur un axe fixe pour rendre les mesures et
    // les captures comparables d'une tentative à l'autre.
    const angle = this.lab ? 0 : (Math.random() * 2 - 1) * (Math.PI / 9);
    this.launchBall(b, angle);
    this.stuck = false;
  }

  releaseGluedBalls(): void {
    for (const b of this.balls) {
      if (!b.glued) continue;
      const angle = b.glueAngle ?? (Math.random() * 2 - 1) * (Math.PI / 3);
      this.launchBall(b, angle);
    }
  }

  resetBall(): void {
    const b = new Blob({ x: this.pad.x, y: PAD_Y - 26, r: this.giantT > 0 ? 17 : 9, color: this.flameT > 0 ? '#ff8a34' : this.accent });
    b.trailOn = true;
    this.balls = [b];
    this.blob = b;
    this.stuck = true;
  }

  setBrickImpact(br: BreakerBrick, source?: any): void {
    const cx = br.x + br.w / 2, cy = br.y + br.h / 2;
    const sx = source?.x ?? cx, sy = source?.y ?? cy;
    br.hitX = Math.max(br.x + 3, Math.min(br.x + br.w - 3, sx));
    br.hitY = Math.max(br.y + 3, Math.min(br.y + br.h - 3, sy));
    br.hitT = 0.3;
    br.fl = 0.16;
  }

  registerBrickBreak(br: BreakerBrick, source?: any, allowDrop = true, chainDepth = 0): void {
    const cx = br.x + br.w / 2, cy = br.y + br.h / 2;
    const isChain = chainDepth > 0;
    const isExplosive = br.kind === 'explosive';
    const chainBonus = chainDepth > 0 ? Math.round(br.pts * Math.min(0.8, chainDepth * 0.2)) : 0;
    this.broken++;
    this.speed = Math.min(720, this.speed + 10);
    this.normSpeed();
    this.score += br.pts + chainBonus;
    this.comboStep++; this.comboT = 1.2;
    if (this.lab) this.labStats.maxCombo = Math.max(this.labStats.maxCombo, this.comboStep);
    this.musicEvent('brickCombo', Math.min(1.4, 0.45 + this.comboStep * 0.04));
    if (this.comboStep >= 4) this.musicEvent('combo', Math.min(1.5, this.comboStep / 10));
    if (!isChain || chainDepth % 2 === 0) this.audio.coin(this.comboStep);
    if (this.comboStep % 8 === 0 && !isChain) {
      this.fx.stop(0.03);
      this.fx.text(cx, cy - 34, 'COMBO ×' + this.comboStep, { color: '#ffd166', size: 19 });
    }
    source?.punch?.(isChain ? 0.16 : 0.35);
    this.fx.shake(isChain ? 0.025 : 0.1);
    this.input.rumble(isChain ? 0.055 : 0.15, isChain ? 0.035 : 0.05);
    // Une explosive possède sa propre mise en scène différée. Éviter ici un
    // burst instantané permet de lire : charge → implosion → nuage final.
    if (!isExplosive) {
      this.fx.burst(cx, cy, {
        n: isChain ? 4 : 14,
        speed: [60, isChain ? 190 : 320],
        colors: [br.color, '#ffffff', this.accent],
        size: [isChain ? 1.5 : 2, isChain ? 3 : 5], life: isChain ? 0.3 : 0.5, shape: 'sq',
      });
      this.fx.ring(cx, cy, { r0: 6, r1: isChain ? 26 : 42, color: br.color, life: isChain ? 0.18 : 0.3 });
      if (!isChain || chainDepth % 2 === 0) {
        this.fx.text(cx, cy - 12, '+' + (br.pts + chainBonus), { color: br.color, size: 15, mono: true });
      }
    }
    if (allowDrop && Math.random() < 0.12) {
      const kinds: DropKind[] = ['MULTI', 'LARGE', 'SLOW', 'LASER', 'GLUE', 'FLAME', 'GIANT', 'SMALL'];
      this.drops.push({ x: cx, y: cy, kind: kinds[(Math.random() * kinds.length) | 0] });
    }
  }

  startGravityFall(br: BreakerBrick, source?: any, fromExplosion = false, chainDepth = 0): void {
    if (br.falling || br.exploded) return;
    this.setBrickImpact(br, source);
    br.hp = 0;
    br.detachT = 0.08;
    br.falling = false;
    br.vy = 75 + cellNoise(this.level + 91, Math.round(br.y), Math.round(br.x)) * 85;
    br.rot = (cellNoise(this.level + 101, Math.round(br.y), Math.round(br.x)) - 0.5) * 0.18;
    this.registerBrickBreak(br, source, !fromExplosion, chainDepth);
    this.audio.tone({ f: 180, f1: 92, type: 'sawtooth', dur: 0.12, vol: 0.08 });
    this.input.rumble(0.2, 0.08);
    this.fx.ring(br.hitX, br.hitY, { r0: 8, r1: 38, color: '#7dd3fc', life: 0.3, width: 2 });
    this.fx.burst(br.hitX, br.hitY, { n: 7, speed: [40, 170], colors: ['#7dd3fc', '#dbeafe'], size: [1.5, 3], life: 0.35, shape: 'sq' });
  }

  queueExplosion(br: BreakerBrick, depth = 0, delay = 0.05): void {
    if (br.exploded || br.queued) return;
    br.queued = true;
    this.explosionQueue.push({ brick: br, delay, initialDelay: Math.max(0.001, delay), depth });
  }

  playExplosionSfx(power: number, depth: number, burstDelay: number): void {
    const now = this.audio.ctx ? this.audio.ctx.currentTime : 0;
    const secondary = depth > 0;
    const chainScene = this.lab === 'chain';
    const scale = secondary ? (chainScene ? 0.3 : 0.5) : (chainScene ? 0.72 : 1);
    const root = 55; // A1 : fondamentale profonde, puis rapports simples.
    const sparkleT = now + burstDelay;

    this.audio.tone({ f: root, f1: root / 2, type: 'sine', t: now, dur: secondary ? 0.38 : 0.72, vol: 0.28 * scale, attack: 0.025 });
    this.audio.tone({ f: root * 1.5, f1: root * 0.75, type: 'sine', t: now + 0.018, dur: secondary ? 0.3 : 0.52, vol: 0.11 * scale, attack: 0.012 });
    this.audio.tone({ f: root * 2, f1: root, type: 'triangle', t: now + 0.035, dur: secondary ? 0.24 : 0.42, vol: 0.08 * scale, attack: 0.008 });

    // Texture courte de feu d'artifice : bruit filtré + partiels harmoniques
    // espacés, plus doux sur les maillons secondaires d'une chaîne.
    this.audio.noise({ t: sparkleT, dur: secondary ? 0.16 : 0.34, f: 4200, f1: 900, type: 'bandpass', q: 1.4, vol: 0.14 * scale });
    [16, 24, 32].forEach((ratio, index) => {
      this.audio.tone({
        f: root * ratio,
        f1: root * (ratio + 4),
        type: index === 0 ? 'triangle' : 'sine',
        t: sparkleT + 0.022 + index * 0.035,
        dur: secondary ? 0.08 : 0.13,
        vol: (0.055 - index * 0.009) * scale,
        attack: 0.003,
      });
    });
    if (!secondary || !chainScene) {
      this.audio.noise({ t: sparkleT + 0.075, dur: secondary ? 0.1 : 0.2, f: 2300, f1: 700, type: 'highpass', q: 0.8, vol: 0.055 * scale });
    }
  }

  emitExplosionCloud(pulse: ExplosionPulse): void {
    const secondary = pulse.depth > 0;
    const chainScene = this.lab === 'chain';
    const scale = secondary ? (chainScene ? 0.28 : 0.52) : (chainScene ? 0.72 : 1);
    const sparkCount = Math.max(3, Math.round((22 + pulse.power * 8) * scale));
    this.fx.burst(pulse.x, pulse.y, {
      n: sparkCount,
      speed: [70, 310 + pulse.power * 55],
      colors: [pulse.color, '#ffd166', '#ffffff'],
      size: [1.5, 4.5], life: secondary ? 0.38 : 0.62, drag: 0.93, shape: 'spark',
    });
    if (!secondary || !chainScene) {
      this.fx.burst(pulse.x, pulse.y, {
        n: Math.max(2, Math.round((12 + pulse.power * 5) * scale)),
        speed: [24, 220 + pulse.power * 35],
        colors: [pulse.color, '#fff7ed', '#ffffff'],
        size: [2, 5], life: secondary ? 0.32 : 0.56, drag: 0.94, grav: 48, shape: 'dot',
      });
    }
    this.fx.ring(pulse.x, pulse.y, {
      r0: Math.max(5, pulse.radius * 0.18), r1: pulse.radius * (secondary ? 0.86 : 1.04),
      color: pulse.color, life: secondary ? 0.28 : 0.52, width: secondary ? 1.5 : 3 + pulse.power,
    });
    if (!secondary) {
      this.fx.stop(chainScene ? 0.045 : Math.min(0.09, 0.035 + pulse.power * 0.018));
      this.fx.shake(chainScene ? 0.11 : 0.18 + pulse.power * 0.08);
      this.fx.flash(pulse.color, chainScene ? 0.1 : Math.min(0.2, 0.07 + pulse.power * 0.035));
    }
    const particleLimit = chainScene ? 320 : 460;
    if (this.fx.parts.length > particleLimit) this.fx.parts.splice(0, this.fx.parts.length - particleLimit);
    const ringLimit = chainScene ? 28 : 64;
    if (this.fx.rings.length > ringLimit) this.fx.rings.splice(0, this.fx.rings.length - ringLimit);
  }

  detonateExplosion(item: PendingExplosion): void {
    const br = item.brick;
    if (br.exploded) return;
    br.queued = false;
    br.exploded = true;
    br.hp = 0;
    this.registerBrickBreak(br, undefined, item.depth === 0, item.depth);

    const cx = br.x + br.w / 2, cy = br.y + br.h / 2;
    const power = Math.max(1, br.blast || 1);
    const radius = 72 + power * 34;
    const color = power >= 3 ? '#ffd166' : '#ff8a34';
    const secondary = item.depth > 0;
    const chainScene = this.lab === 'chain';
    const chargeT = secondary ? 0.18 : 0.26;
    const burstT = chargeT + (secondary ? 0.1 : 0.14);
    const lingerT = secondary ? 0.38 : 0.52 + power * 0.06;
    this.explosions.push({
      x: cx, y: cy, radius, power, color, t: 0, maxT: burstT + lingerT, depth: item.depth,
      chargeT, burstT, burstDone: false,
    });
    this.playExplosionSfx(power, item.depth, burstT);
    const feedbackScale = secondary ? (chainScene ? 0.3 : 0.52) : (chainScene ? 0.72 : 1);
    this.input.rumble(Math.min(0.85, (0.24 + power * 0.14) * feedbackScale), secondary ? 0.055 : 0.1 + power * 0.02);
    this.fx.implode(cx, cy, {
      n: Math.max(5, Math.round((16 + power * 5) * feedbackScale)),
      radius: radius * 0.72,
      speed: [80, 250 + power * 25],
      colors: [color, '#ffd166', '#fff7ed'],
      size: [1.2, 3.5], life: secondary ? 0.22 : 0.34, shape: 'spark',
    });
    this.fx.ring(cx, cy, { r0: radius * 0.42, r1: radius * 0.58, color, life: secondary ? 0.2 : 0.3, width: secondary ? 1.5 : 2.5 });
    if (!secondary) this.fx.flash(color, chainScene ? 0.045 : 0.06);
    if (item.depth === 0 || (!chainScene && item.depth % 3 === 0)) {
      this.fx.text(cx, cy - 32, 'BOOM ×' + power, { color: '#ffd166', size: 18 });
    }

    for (const other of this.bricks as BreakerBrick[]) {
      if (other === br || other.hp <= 0 || other.falling || other.exploded || other.queued) continue;
      const ox = other.x + other.w / 2, oy = other.y + other.h / 2;
      const distance = Math.hypot(ox - cx, oy - cy);
      if (distance > radius + Math.max(other.w, other.h) * 0.32) continue;
      if (other.kind === 'explosive') {
        this.setBrickImpact(other, { x: cx, y: cy });
        other.queued = true;
        const delay = 0.07 + Math.min(0.2, distance / radius * 0.18);
        this.explosionQueue.push({ brick: other, delay, initialDelay: delay, depth: item.depth + 1 });
      } else if (other.kind === 'gravity') {
        this.startGravityFall(other, { x: cx, y: cy }, true, item.depth + 1);
      } else {
        this.setBrickImpact(other, { x: cx, y: cy });
        other.hp = 0;
        this.registerBrickBreak(other, undefined, false, item.depth + 1);
      }
    }
  }

  updateExplosions(dt: number): void {
    for (const pulse of this.explosions as ExplosionPulse[]) {
      const previousT = pulse.t;
      pulse.t += dt;
      if (!pulse.burstDone && previousT < pulse.burstT && pulse.t >= pulse.burstT) {
        pulse.burstDone = true;
        this.emitExplosionCloud(pulse);
      }
    }
    this.explosions = this.explosions.filter((pulse: ExplosionPulse) => pulse.t < pulse.maxT);
    const pending: PendingExplosion[] = [];
    const ready: PendingExplosion[] = [];
    for (const item of this.explosionQueue as PendingExplosion[]) {
      item.delay -= dt;
      if (item.delay <= 0) ready.push(item);
      else pending.push(item);
    }
    this.explosionQueue = pending;
    for (const item of ready) this.detonateExplosion(item);
  }

  updateFallingTiles(dt: number): void {
    // Une gravity détachée est un corps de feedback, pas une seconde balle :
    // elle ignore volontairement Wall/Bumper dans cette V1.
    for (const br of this.bricks as BreakerBrick[]) {
      if ((br.detachT || 0) > 0) {
        br.detachT = Math.max(0, (br.detachT || 0) - dt);
        if (br.detachT <= 0) {
          br.detachT = undefined;
          br.falling = true;
        } else {
          continue;
        }
      }
      if (!br.falling) continue;
      const previousBottom = br.y + br.h;
      br.vy = (br.vy || 0) + 920 * dt;
      br.y += br.vy * dt;
      // La chute reste lisible : la tuile peut basculer, mais ne part jamais
      // dans une rotation incontrôlable (±15°).
      br.rot = clampValue((br.rot || 0) + (br.vy * 0.0008 + 0.012) * dt, -Math.PI / 12, Math.PI / 12);
      const overlapsPad = br.x < this.pad.x + this.padW / 2 && br.x + br.w > this.pad.x - this.padW / 2;
      const crossedPad = previousBottom < PAD_Y + 10 && br.y + br.h >= PAD_Y - 10;
      if (overlapsPad && crossedPad) {
        br.falling = false;
        this.triggerFreeze(br);
      } else if (br.y > 760) {
        br.falling = false;
      }
    }
  }

  levelCleared(): boolean {
    return (this.bricks as BreakerBrick[]).every((br) => br.hp <= 0 && !br.falling && !(br.detachT && br.detachT > 0) && !br.queued)
      && (this.explosionQueue as PendingExplosion[]).length === 0
      && (this.explosions as ExplosionPulse[]).length === 0
      && this.freezeT <= 0;
  }

  triggerFreeze(br: BreakerBrick): void {
    const x = br.x + br.w / 2, y = Math.min(PAD_Y - 6, br.y + br.h / 2);
    this.freezeT = Math.max(this.freezeT, 0.72);
    this.freezePulseT = 0.72;
    this.pad.vx *= 0.08;
    this.audio.tone({ f: 210, f1: 92, type: 'sine', dur: 0.32, vol: 0.12 });
    this.input.rumble(0.45, 0.14);
    this.fx.stop(0.045);
    this.fx.flash('#7dd3fc', 0.14);
    this.fx.shake(0.16);
    this.fx.ring(this.pad.x, PAD_Y - 8, { r0: 18, r1: 82, color: '#7dd3fc', life: 0.5, width: 3 });
    this.fx.burst(x, y, { n: 18, speed: [40, 240], colors: ['#7dd3fc', '#dbeafe', '#ffffff'], size: [1.5, 4], life: 0.55, grav: 90, shape: 'sq' });
    this.fx.text(this.pad.x, PAD_Y - 42, 'FREEZE', { color: '#bae6fd', size: 22 });
  }

  hitBrick(br: BreakerBrick, bl: any): void {
    if (br.hp <= 0 || br.falling || br.exploded) return;
    if (this.lab && bl?.lastBumperActionT > 0) {
      if (br.kind === 'explosive') this.labStats.bumperToExplosive++;
      else this.labStats.bumperToBrick++;
      bl.lastBumperActionT = 0;
    }
    this.setBrickImpact(br, bl);
    if (br.kind === 'gravity') {
      this.startGravityFall(br, bl);
      return;
    }

    br.hp--;
    if (br.hp > 0) {
      // Une brique renforcée garde sa cicatrice au point exact de collision.
      bl?.punch?.(0.15);
      this.audio.hitEnemy();
      this.input.rumble(0.08, 0.04);
      this.fx.burst(br.hitX, br.hitY, { n: 7, speed: [40, 180], colors: [br.color, '#ffffff'], size: [1.5, 3.5], life: 0.35, shape: 'sq' });
      this.fx.ring(br.hitX, br.hitY, { r0: 3, r1: 20, color: br.color, life: 0.18, width: 2 });
      return;
    }

    if (br.kind === 'explosive') {
      // Un court temps de lecture laisse voir le noyau se charger avant la
      // séquence charge → implosion → nuage.
      this.queueExplosion(br, 0, 0.1);
      bl?.punch?.(0.3);
      return;
    }

    bl?.punch?.(0.35);
    this.registerBrickBreak(br, bl);
  }

  nextLevel(): void {
    if (this.lab) {
      this.musicEvent('waveComplete', 0.8);
      this.audio.milestone();
      this.fx.flash(this.accent, 0.15);
      this.buildLevel();
      this.resetBall();
      this.fx.text(640, 330, 'RESET · ' + this.levelSpec.name, { color: this.accent, size: 38, life: 1.1 });
      return;
    }
    this.level++;
    this.musicEvent('waveComplete', 0.8);
    this.audio.milestone();
    this.fx.flash(this.accent, 0.15);
    this.buildLevel();
    this.fx.text(640, 330, 'NIVEAU ' + this.level + ' · ' + this.levelSpec.name, { color: this.accent, size: 38, life: 1.4 });
    this.baseSpd += 30;
    this.speed = this.baseSpd;
    this.broken = 0;
    this.normSpeed();
  }

  applyDrop(kind: DropKind): void {
    const px = this.pad.x, py = PAD_Y - 26;
    this.audio.good();
    this.musicEvent('powerUp', 0.7);
    this.fx.flash(this.accent, 0.1);
    this.input.rumble(0.2, 0.06);
    this.fx.burst(px, py, { n: 12, colors: [DCOL[kind], '#ffffff'], life: 0.4 });
    this.fx.ring(px, py, { r0: 8, r1: 46, color: DCOL[kind], life: 0.3 });
    if (kind === 'MULTI') {
      for (const b of [...this.balls]) {
        if (this.balls.length >= 4) break;
        const nb: any = new Blob({ x: b.x, y: b.y, r: this.giantT > 0 ? 17 : 9, color: this.flameT > 0 ? '#ff8a34' : this.accent });
        nb.trailOn = true;
        const splitSpeed = this.targetBallSpeed(b);
        if (this.stuck && b === this.balls[0]) {
          const a = (Math.random() - 0.5) * 0.7;
          nb.vx = Math.sin(a) * splitSpeed; nb.vy = -Math.cos(a) * splitSpeed;
        } else if (b.glued) {
          const a = b.glueAngle ?? (Math.random() - 0.5) * 0.7;
          nb.vx = Math.sin(a) * splitSpeed; nb.vy = -Math.cos(a) * splitSpeed;
        } else {
          const a = Math.atan2(b.vy, b.vx) + 0.45;
          nb.vx = Math.cos(a) * splitSpeed; nb.vy = Math.sin(a) * splitSpeed;
        }
        nb.bumperBoost = b.bumperBoost;
        nb.bumperBoostT = b.bumperBoostT;
        this.balls.push(nb);
      }
    } else if (kind === 'LARGE') {
      this.extendPowerTimer('largeT', 10, 24);
    } else if (kind === 'SMALL') {
      this.extendPowerTimer('smallT', 8, 18);
    } else if (kind === 'GIANT') {
      this.extendPowerTimer('giantT', 10, 18);
    } else if (kind === 'FLAME') {
      this.extendPowerTimer('flameT', 9, 14);
    } else if (kind === 'SLOW') {
      this.extendPowerTimer('slowT', 4, 8);
    } else if (kind === 'LASER') {
      // Le laser ne se cumule pas : un nouveau drop rafraîchit simplement sa durée.
      this.laserT = Math.max(this.laserT, 10);
      this.laserFireT = Math.min(this.laserFireT, 0.08);
    } else if (kind === 'GLUE') {
      // Même règle pour la glue : une seule mécanique de collage à la fois.
      this.glueT = Math.max(this.glueT, 12);
    }
    this.fx.text(px, py - 14, kind, { color: DCOL[kind], size: 20 });
  }

  wallHit(bl: any): void {
    bl.punch(0.1);
    this.audio.tone({ f: 190, dur: 0.03, vol: 0.05, type: 'sine' });
  }

  bumperChaosAngle(x: number, y: number, bumperId: number, sampleTime = this.time): number {
    const sampleRow = Math.round(sampleTime * 120);
    const sign = cellNoise(this.level + bumperId * 13, sampleRow, Math.round(x + y)) < 0.5 ? -1 : 1;
    const amount = BUMPER_CHAOS_MIN + cellNoise(this.level + bumperId * 29, sampleRow + 7, Math.round(x - y)) * (BUMPER_CHAOS_MAX - BUMPER_CHAOS_MIN);
    return sign * amount;
  }

  resolveWall(bl: any, wall: BreakerWall): boolean {
    const hit = circleVsAabb(bl.x, bl.y, bl.r, wall.x, wall.y, wall.w, wall.h, WALL_COLLISION_PADDING);
    if (!hit) return false;
    const dot = reflectVelocity(bl, hit);
    bl.x += hit.nx * Math.max(hit.penetration, 0.5);
    bl.y += hit.ny * Math.max(hit.penetration, 0.5);
    // Si la balle longe exactement un côté, une petite poussée vers
    // l'extérieur évite l'impression d'une collision verticale “absorbée”.
    // C'est une tolérance de gameplay, pas une nouvelle surface physique.
    const edgeSlide = dot >= 0 && Math.abs(hit.nx) > 0.7
      && Math.abs(bl.vy) > Math.abs(bl.vx) * 1.25;
    if (edgeSlide) bl.vx += hit.nx * Math.max(22, this.speed * 0.08);
    if (dot < 0 || edgeSlide) {
      this.wallHit(bl);
      this.fx.ring(hit.contactX, hit.contactY, { r0: 3, r1: 18, color: '#94a3b8', life: 0.18, width: 1.5 });
      this.fx.burst(hit.contactX, hit.contactY, { n: 3, speed: [30, 100], colors: ['#cbd5e1', '#ffffff'], size: [1, 2], life: 0.2, shape: 'sq' });
      if (this.lab) this.labStats.wallHits++;
    }
    if (this.lab) this.labContact = { x: hit.contactX, y: hit.contactY, nx: hit.nx, ny: hit.ny, t: 0.35 };
    return true;
  }

  resolveBumper(bl: any, bumper: BreakerBumper): boolean {
    const hit = circleVsCircle(bl.x, bl.y, bl.r, bumper.x, bumper.y, bumper.r, BUMPER_COLLISION_PADDING);
    if (!hit) return false;
    bl.x += hit.nx * Math.max(hit.penetration, 0.5);
    bl.y += hit.ny * Math.max(hit.penetration, 0.5);
    const sameBumper = bl.lastBumperId === bumper.id && (bl.lastBumperT || 0) > 0;
    const dot = bl.vx * hit.nx + bl.vy * hit.ny;
    // Une balle qui quitte déjà le bumper peut encore recouvrir sa hitbox
    // pendant une frame : on la sépare, mais ce n'est pas un nouveau contact.
    if (sameBumper || dot >= 0) return true;
    reflectVelocity(bl, hit);
    let currentSpeed = Math.hypot(bl.vx, bl.vy);
    if (currentSpeed < 1) {
      bl.vx = hit.nx; bl.vy = hit.ny; currentSpeed = 1;
    }
    const target = this.speed * bumper.boost;
    bl.vx *= target / currentSpeed;
    bl.vy *= target / currentSpeed;
    // Même un contact parfaitement frontal reçoit une petite variation. Elle
    // reste bornée et déterministe pour qu'un lab soit comparable, mais évite
    // l'effet de rail d'un rebond mathématiquement trop parfait.
    const chaos = this.bumperChaosAngle(bl.x, bl.y, bumper.id);
    const cos = Math.cos(chaos), sin = Math.sin(chaos);
    const outVx = bl.vx * cos - bl.vy * sin;
    const outVy = bl.vx * sin + bl.vy * cos;
    bl.vx = outVx; bl.vy = outVy;
    bl.bumperBoost = bumper.boost;
    bl.bumperBoostT = BUMPER_BOOST_TIME;
    bl.lastBumperId = bumper.id;
    bl.lastBumperT = 0.08;
    bl.lastBumperActionT = 1.5;
    bumper.pulseT = 0.25;
    bl.punch(0.28);
    this.audio.tone({ f: 430, f1: 860, type: 'triangle', dur: 0.11, vol: 0.1 });
    this.input.rumble(0.2, 0.07);
    this.fx.ring(bumper.x, bumper.y, { r0: bumper.r * 0.75, r1: bumper.r + 42, color: '#ffd166', life: 0.28, width: 3 });
    this.fx.burst(hit.contactX, hit.contactY, { n: 8, speed: [50, 220], colors: ['#ffd166', '#ffffff', '#fef3c7'], size: [1.5, 3], life: 0.35, shape: 'spark' });
    if (this.lab) {
      this.labStats.bumperHits++;
      this.labContact = { x: hit.contactX, y: hit.contactY, nx: hit.nx, ny: hit.ny, t: 0.35 };
    }
    return true;
  }

  updateObstacles(dt: number): void {
    for (const obstacle of this.obstacles as BreakerObstacle[]) {
      if (obstacle.kind === 'bumper') obstacle.pulseT = Math.max(0, obstacle.pulseT - dt);
    }
    if (this.labContact) {
      this.labContact.t -= dt;
      if (this.labContact.t <= 0) this.labContact = null;
    }
  }

  resolveObstacles(bl: any): void {
    for (const obstacle of this.obstacles as BreakerObstacle[]) {
      if (obstacle.kind === 'wall') this.resolveWall(bl, obstacle);
      else this.resolveBumper(bl, obstacle);
    }
  }

  fireLasers(): void {
    const spread = Math.max(18, this.padW * 0.3);
    for (const side of [-1, 1]) {
      this.lasers.push({ x: this.pad.x + side * spread, y: PAD_Y - 18, vy: -1040, r: 3, life: 1.1 });
    }
    this.audio.tone({ f: 760, f1: 1180, type: 'square', dur: 0.07, vol: 0.055 });
    this.fx.burst(this.pad.x, PAD_Y - 17, { n: 4, speed: [30, 100], colors: ['#ff4d9d', '#ffffff'], size: [1, 2.5], life: 0.18 });
  }

  updateLasers(dt: number): void {
    for (const laser of this.lasers) {
      laser.y += laser.vy * dt;
      laser.life -= dt;
      if (laser.y < WALL - 12 || laser.life <= 0) {
        laser.dead = true;
        continue;
      }
      for (const obstacle of this.obstacles as BreakerObstacle[]) {
        if (obstacle.kind !== 'wall') continue;
        const hit = circleVsAabb(laser.x, laser.y, laser.r, obstacle.x, obstacle.y, obstacle.w, obstacle.h, WALL_COLLISION_PADDING);
        if (!hit) continue;
        laser.dead = true;
        this.audio.tone({ f: 260, f1: 150, type: 'square', dur: 0.045, vol: 0.045 });
        this.fx.burst(hit.contactX, hit.contactY, { n: 4, speed: [30, 120], colors: ['#cbd5e1', '#ffb6de'], size: [1, 2.2], life: 0.22, shape: 'spark' });
        break;
      }
      if (laser.dead) continue;
      for (const br of this.bricks as BreakerBrick[]) {
        if (br.hp <= 0 || laser.x < br.x - laser.r || laser.x > br.x + br.w + laser.r ||
            laser.y < br.y - laser.r || laser.y > br.y + br.h + laser.r) continue;
        this.hitBrick(br, laser);
        laser.dead = true;
        break;
      }
    }
    this.lasers = this.lasers.filter((laser: LaserBolt) => !laser.dead);
  }

  update(dt: number): void {
    if (this.baseUpdate(dt)) return;
    const I = this.input, pad = this.pad;
    // temps réel (hors slow-mo) pour les minuteurs de bonus / combo
    const rdt = this.fx.timeScale > 0 ? dt / this.fx.timeScale : dt;

    // Les réactions de niveau sont indépendantes de la trajectoire de la balle :
    // une explosion peut donc continuer sa propagation pendant un rebond.
    this.updateObstacles(dt);
    this.updateExplosions(dt);
    this.updateFallingTiles(dt);
    this.freezeT = Math.max(0, this.freezeT - rdt);
    this.freezePulseT = Math.max(0, this.freezePulseT - rdt);

    // --- paddle (piloté en temps réel : le SLOW ralentit la balle, pas le joueur)
    this.padW += (this.targetPaddleWidth() - this.padW) * Math.min(1, rdt * 8);
    const frozen = this.freezeT > 0;
    this.steer(rdt, pad, frozen ? 0 : I.moveX, 0, frozen ? 0 : 900, frozen ? 18 : 8);
    pad.x += pad.vx * rdt;
    const half = this.padW / 2;
    if (pad.x < WALL + half) { pad.x = WALL + half; pad.vx = 0; }
    if (pad.x > 1280 - WALL - half) { pad.x = 1280 - WALL - half; pad.vx = 0; }

    // --- minuteurs
    this.largeT = Math.max(0, this.largeT - rdt);
    this.smallT = Math.max(0, this.smallT - rdt);
    this.giantT = Math.max(0, this.giantT - rdt);
    this.flameT = Math.max(0, this.flameT - rdt);
    this.laserT = Math.max(0, this.laserT - rdt);
    this.glueT = Math.max(0, this.glueT - rdt);
    this.comboT = Math.max(0, this.comboT - rdt);
    if (this.comboT <= 0) this.comboStep = 0;
    if (this.slowT > 0) { this.slowT -= rdt; this.fx.timeScale = 0.6; }
    else if (this.fx.timeScale < 1) this.fx.timeScale = Math.min(1, this.fx.timeScale + rdt * 0.5);

    if (this.laserT > 0) {
      this.laserFireT -= rdt;
      while (this.laserFireT <= 0) {
        this.fireLasers();
        this.laserFireT += 0.32;
      }
    } else {
      this.laserFireT = 0;
    }

    // --- lancer
    if (I.pressed('a')) {
      if (this.stuck) this.launch();
      this.releaseGluedBalls();
    }

    this.updateLasers(dt);

    // --- balles-blobs
    for (const bl of this.balls) {
      const targetRadius = this.giantT > 0 ? 17 : 9;
      bl.r += (targetRadius - bl.r) * Math.min(1, dt * 12);
      bl.color = this.flameT > 0 ? '#ff8a34' : this.accent;
      bl.lastBrickT = Math.max(0, (bl.lastBrickT || 0) - dt);
      bl.lastBumperT = Math.max(0, (bl.lastBumperT || 0) - dt);
      bl.lastBumperActionT = Math.max(0, (bl.lastBumperActionT || 0) - dt);
      bl.bumperBoostT = Math.max(0, (bl.bumperBoostT || 0) - dt);
      if (this.stuck && bl === this.balls[0]) {
        bl.x = pad.x; bl.y = PAD_Y - 9 - bl.r - 4;
        bl.vx = pad.vx * 0.5; bl.vy = 0;
      } else if (bl.glued) {
        bl.glueWait = Math.max(0, (bl.glueWait || 0) - rdt);
        const offset = bl.glueOffset || 0;
        bl.x = Math.max(WALL + bl.r, Math.min(1280 - WALL - bl.r, pad.x + offset));
        bl.y = PAD_Y - 9 - bl.r - 4;
        bl.vx = pad.vx * 0.5; bl.vy = 0;
        if (this.glueT <= 0 || bl.glueWait <= 0) this.launchBall(bl, bl.glueAngle ?? 0);
      } else {
        bl.x += bl.vx * dt; bl.y += bl.vy * dt;

        // murs latéraux + plafond (réflexion propre)
        if (bl.x - bl.r < WALL) { bl.x = WALL + bl.r; bl.vx = Math.abs(bl.vx); this.wallHit(bl); }
        else if (bl.x + bl.r > 1280 - WALL) { bl.x = 1280 - WALL - bl.r; bl.vx = -Math.abs(bl.vx); this.wallHit(bl); }
        if (bl.y - bl.r < WALL) { bl.y = WALL + bl.r; bl.vy = Math.abs(bl.vy); this.wallHit(bl); }

        // paddle : l'angle de renvoi dépend du point d'impact ±60° + vitesse horizontale
        if (bl.vy > 0 && Math.abs(bl.x - pad.x) < half + bl.r * 0.8 &&
            bl.y + bl.r >= PAD_Y - 9 && bl.y - bl.r <= PAD_Y + 9) {
          const rel = Math.max(-1, Math.min(1, (bl.x - pad.x) / half));
          let a = rel * (Math.PI / 3) + pad.vx * 0.0006;
          a = Math.max(-1.25, Math.min(1.25, a));
          if (this.glueT > 0) {
            bl.glued = true;
            bl.glueOffset = rel * Math.max(12, half - bl.r);
            bl.glueAngle = a;
            bl.glueWait = 1.25;
            bl.vx = pad.vx * 0.5;
            bl.vy = 0;
            bl.punch(0.2);
            this.audio.tone({ f: 340, f1: 520, type: 'sine', dur: 0.12, vol: 0.08 });
            this.input.rumble(0.16, 0.08);
            this.fx.ring(bl.x, PAD_Y - 10, { r0: 7, r1: 32, color: DCOL.GLUE, life: 0.28, width: 2 });
          } else {
            const paddleSpeed = this.targetBallSpeed(bl);
            bl.vx = Math.sin(a) * paddleSpeed;
            bl.vy = -Math.cos(a) * paddleSpeed;
            bl.punch(0.25);
            this.audio.land();
            this.fx.burst(bl.x, PAD_Y - 10, { n: 6, speed: [40, 180], colors: [this.accent, '#ffffff'], size: [1.5, 3], life: 0.3, ang: -Math.PI / 2, spread: 1.4 });
          }
        }

        // Géométrie de niveau : les obstacles sont résolus avant les briques.
        this.resolveObstacles(bl);
        const currentSpeed = Math.hypot(bl.vx, bl.vy);
        const targetSpeed = this.targetBallSpeed(bl);
        if (currentSpeed > 1) {
          const smoothedSpeed = currentSpeed + (targetSpeed - currentSpeed) * Math.min(1, dt * 10);
          bl.vx *= smoothedSpeed / currentSpeed;
          bl.vy *= smoothedSpeed / currentSpeed;
        }

        // briques : cercle vs AABB. Une balle enflammée traverse les briques
        // et peut en toucher plusieurs sur la même trajectoire.
        const flaming = this.flameT > 0;
        for (const br of this.bricks as BreakerBrick[]) {
          if (br.hp <= 0) continue;
          const brickHit = circleVsAabb(bl.x, bl.y, bl.r, br.x, br.y, br.w, br.h, BRICK_COLLISION_PADDING);
          if (!brickHit) continue;
          if (flaming && bl.lastBrick === br && bl.lastBrickT > 0) continue;
          if (!flaming) {
            reflectVelocity(bl, brickHit);
            bl.x += brickHit.nx * Math.max(brickHit.penetration, 0.5);
            bl.y += brickHit.ny * Math.max(brickHit.penetration, 0.5);
          }
          this.hitBrick(br, bl);
          if (flaming) {
            bl.lastBrick = br;
            bl.lastBrickT = 0.08;
          } else break;
        }

        // anti-trajectoire trop horizontale
        if (Math.abs(bl.vy) < this.speed * 0.18) bl.vy = (bl.vy >= 0 ? 1 : -1) * this.speed * 0.18;
        // perdue
        if (bl.y > 740) bl.dead = true;
      }
      bl.scared = Math.hypot(bl.vx, bl.vy) > 600;
      bl.update(dt);
    }

    // balles mortes
    const alive = this.balls.filter((b: any) => !b.dead);
    if (alive.length !== this.balls.length) {
      this.balls = alive;
      if (alive.length) this.blob = alive[0];
    }
    if (this.balls.length === 0) {
      this.lives--;
      this.musicEvent('playerHit', 0.8);
      this.audio.hurt();
      this.fx.shake(0.4);
      if (this.lives <= 0) { this.over(); return; }
      this.resetBall();
    }

    // --- drops
    for (const d of this.drops) {
      d.y += 130 * dt;
      if (d.y > 760) d.dead = true;
      else if (Math.abs(d.x - pad.x) < half + 9 && Math.abs(d.y - PAD_Y) < 18) {
        d.dead = true;
        this.applyDrop(d.kind);
      }
    }
    this.drops = this.drops.filter((d: any) => !d.dead);

    // flash et cicatrice d'impact des briques abîmées
    for (const br of this.bricks as BreakerBrick[]) {
      if (br.fl > 0) br.fl -= dt;
      if (br.hitT > 0) br.hitT -= dt;
    }

    // niveau fini ? On laisse la dernière propagation et les tuiles gravitaires
    // se terminer afin que la récompense ne coupe pas la réaction en plein élan.
    if (this.levelCleared()) this.nextLevel();
  }

  drawBrick(ctx: CanvasRenderingContext2D, br: BreakerBrick): void {
    const cx = br.x + br.w / 2, cy = br.y + br.h / 2;
    const isFalling = !!br.falling;
    const isDetaching = !isFalling && (br.detachT || 0) > 0;
    const isGravity = br.kind === 'gravity';
    const isExplosive = br.kind === 'explosive';
    const body = isGravity ? '#38bdf8' : isExplosive ? '#fb923c' : br.color;
    const damaged = br.maxHp > 1 && br.hp < br.maxHp;
    const queuedItem = isExplosive
      ? (this.explosionQueue as PendingExplosion[]).find((item) => item.brick === br)
      : undefined;
    const queued = !!queuedItem;
    const queuedProgress = queuedItem ? 1 - clampValue(queuedItem.delay / Math.max(0.001, queuedItem.initialDelay), 0, 1) : 0;
    const idleRate = isExplosive ? (queued ? 5.2 : 6.2832 / 1.65) : isGravity ? 6.2832 / 1.4 : 0;
    const idlePhase = this.time * idleRate + br.animPhase * 6.2832;
    const pulse = isExplosive
      ? (queued ? 0.88 + 0.22 * (0.5 + 0.5 * Math.sin(idlePhase)) : 1 + 0.1 * Math.sin(idlePhase))
      : 1;
    const visualOffset = isDetaching ? 2 * (1 - (br.detachT || 0) / 0.08) : 0;
    const localCx = isFalling ? 0 : cx;
    const localCy = isFalling ? 0 : cy + visualOffset;
    const ox = isFalling ? -br.w / 2 : br.x;
    const oy = isFalling ? -br.h / 2 : br.y + visualOffset;

    ctx.save();
    if (isFalling) {
      ctx.translate(cx, cy);
      ctx.rotate(br.rot || 0);
      ctx.globalAlpha = 0.9;
      ctx.shadowColor = '#38bdf8';
      ctx.shadowBlur = 16;
    }
    UI.roundRect(ctx, ox, oy, br.w, br.h, Math.min(7, br.h * 0.3));
    ctx.fillStyle = br.fl > 0 ? '#ffffff' : damaged ? br.dark : body;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    UI.roundRect(ctx, ox + 5, oy + 4, Math.max(4, br.w - 10), Math.max(2, Math.min(5, br.h * 0.25)), 2.5);
    ctx.fill();

    if (isGravity) {
      ctx.strokeStyle = '#dbeafe';
      ctx.globalAlpha = 0.72 + Math.sin(idlePhase) * 0.1;
      ctx.lineWidth = 1.5;
      const flow = (Math.sin(idlePhase) * 0.5 + 0.5) * 2.5;
      ctx.beginPath();
      for (const x of [0.34, 0.5, 0.66]) {
        ctx.moveTo(ox + br.w * x, oy + br.h * 0.3 + flow);
        ctx.lineTo(ox + br.w * x, oy + br.h * 0.62 + flow);
      }
      ctx.moveTo(ox + br.w * 0.27, oy + br.h * 0.54 + flow);
      ctx.lineTo(ox + br.w * 0.5, oy + br.h * 0.79 + flow);
      ctx.lineTo(ox + br.w * 0.73, oy + br.h * 0.54 + flow);
      ctx.stroke();
    } else if (isExplosive) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = '#fff7ed';
      ctx.fillStyle = queued ? '#fff7ed' : '#ffe4c7';
      ctx.globalAlpha = queued ? 0.95 : 0.88;
      ctx.lineWidth = queued ? 1.8 : 1.4;
      const coreR = Math.max(4, Math.min(br.w, br.h) * 0.34 * pulse);
      ctx.beginPath();
      ctx.arc(localCx, localCy, coreR, 0, 6.2832);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(localCx - coreR * 1.7, localCy);
      ctx.lineTo(localCx + coreR * 1.7, localCy);
      ctx.moveTo(localCx, localCy - coreR * 1.35);
      ctx.lineTo(localCx, localCy + coreR * 1.35);
      ctx.stroke();
      for (let i = 0; i < Math.min(3, br.blast || 1); i++) {
        const a = -Math.PI / 2 + i * Math.PI * 2 / Math.min(3, br.blast || 1);
        const px = localCx + Math.cos(a) * Math.max(5, br.w * 0.27);
        const py = localCy + Math.sin(a) * Math.max(4, br.h * 0.33);
        ctx.beginPath(); ctx.arc(px, py, 1.5, 0, 6.2832); ctx.fill();
      }
      if (queued) {
        ctx.globalAlpha = 0.45 + queuedProgress * 0.45;
        ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.arc(localCx, localCy, coreR + 5 + (1 - queuedProgress) * 7, 0, 6.2832); ctx.stroke();
        ctx.setLineDash([]);
      }
    } else if (br.maxHp > 1) {
      // Deux coques + rivets : la masse reste reconnaissable même sans sa couleur.
      ctx.strokeStyle = 'rgba(255,255,255,0.72)';
      ctx.lineWidth = 1.5;
      UI.roundRect(ctx, ox + 2, oy + 2, br.w - 4, br.h - 4, Math.min(5, br.h * 0.25));
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.32)';
      ctx.lineWidth = 1;
      UI.roundRect(ctx, ox + 6, oy + 5, br.w - 12, br.h - 10, Math.min(4, br.h * 0.2));
      ctx.stroke();
      ctx.fillStyle = '#ffffffaa';
      for (const px of [ox + 8, ox + br.w - 8]) {
        for (const py of [oy + 8, oy + br.h - 8]) {
          ctx.beginPath(); ctx.arc(px, py, 1.5, 0, 6.2832); ctx.fill();
        }
      }
      for (let i = 0; i < br.maxHp; i++) {
        ctx.fillStyle = i < br.hp ? '#ffffffcc' : '#0b0e1466';
        ctx.beginPath(); ctx.arc(ox + br.w - 8 - i * 6, oy + br.h - 6, 1.7, 0, 6.2832); ctx.fill();
      }
    }

    if (damaged && !isFalling) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = '#ffffffaa';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(br.hitX, br.hitY);
      ctx.lineTo(br.hitX + br.w * 0.16, br.hitY - br.h * 0.32);
      ctx.moveTo(br.hitX, br.hitY);
      ctx.lineTo(br.hitX - br.w * 0.2, br.hitY + br.h * 0.24);
      ctx.moveTo(br.hitX, br.hitY);
      ctx.lineTo(br.hitX + br.w * 0.08, br.hitY + br.h * 0.38);
      ctx.stroke();
    }
    if (br.hitT > 0) {
      const k = Math.min(1, br.hitT / 0.3);
      const ix = isFalling ? 0 : br.hitX, iy = isFalling ? 0 : br.hitY + visualOffset;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = k;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(ix, iy, (1 - k) * 10 + 3, 0, 6.2832);
      ctx.stroke();
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2 + this.time * 2;
        const len = 4 + (1 - k) * 8;
        ctx.beginPath();
        ctx.moveTo(ix + Math.cos(a) * 3, iy + Math.sin(a) * 3);
        ctx.lineTo(ix + Math.cos(a) * len, iy + Math.sin(a) * len);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawExplosions(ctx: CanvasRenderingContext2D): void {
    if (!(this.explosions as ExplosionPulse[]).length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const pulse of this.explosions as ExplosionPulse[]) {
      const chargeK = clampValue(pulse.t / pulse.chargeT, 0, 1);
      const implodeK = clampValue((pulse.t - pulse.chargeT) / Math.max(0.001, pulse.burstT - pulse.chargeT), 0, 1);
      const cloudK = clampValue((pulse.t - pulse.burstT) / Math.max(0.001, pulse.maxT - pulse.burstT), 0, 1);
      const chargeEase = 1 - Math.pow(1 - chargeK, 2);
      const implodeEase = implodeK * implodeK * (3 - 2 * implodeK);
      const cloudEase = 1 - Math.pow(1 - cloudK, 2);
      const secondary = pulse.depth > 0;
      const lightMode = secondary || this.lab === 'chain';
      const radius = pulse.radius;
      const phase = pulse.t < pulse.chargeT ? 'charge' : pulse.t < pulse.burstT ? 'implode' : 'cloud';
      const visualRadius = phase === 'charge'
        ? radius * (0.28 + chargeEase * 0.2)
        : phase === 'implode'
          ? radius * (0.52 - implodeEase * 0.34)
          : radius * (0.3 + cloudEase * 0.78);
      const fade = phase === 'cloud' ? 1 - cloudK : phase === 'charge' ? 0.45 + chargeK * 0.35 : 0.85;
      const queued = (this.explosionQueue as PendingExplosion[]).filter((item) => {
        const qx = item.brick.x + item.brick.w / 2, qy = item.brick.y + item.brick.h / 2;
        return Math.hypot(qx - pulse.x, qy - pulse.y) < radius + 24;
      });
      if (queued.length) {
        ctx.globalAlpha = fade * (lightMode ? 0.28 : 0.52);
        ctx.strokeStyle = pulse.color;
        ctx.lineWidth = lightMode ? 1 : 1.5;
        ctx.setLineDash([3, 5]);
        for (const item of queued) {
          const qx = item.brick.x + item.brick.w / 2, qy = item.brick.y + item.brick.h / 2;
          ctx.beginPath(); ctx.moveTo(pulse.x, pulse.y); ctx.lineTo(qx, qy); ctx.stroke();
        }
        ctx.setLineDash([]);
      }
      if (!lightMode) {
        const gradient = ctx.createRadialGradient(pulse.x, pulse.y, 0, pulse.x, pulse.y, Math.max(1, visualRadius));
        gradient.addColorStop(0, `rgba(255,255,255,${0.78 * fade})`);
        gradient.addColorStop(0.26, pulse.color + 'bb');
        gradient.addColorStop(1, pulse.color + '00');
        ctx.globalAlpha = fade * 0.8;
        ctx.fillStyle = gradient;
        ctx.beginPath(); ctx.arc(pulse.x, pulse.y, Math.max(2, visualRadius), 0, 6.2832); ctx.fill();
      } else {
        ctx.globalAlpha = fade * 0.42;
        ctx.fillStyle = pulse.color + '66';
        ctx.beginPath(); ctx.arc(pulse.x, pulse.y, Math.max(2, visualRadius), 0, 6.2832); ctx.fill();
      }

      ctx.globalAlpha = fade;
      ctx.strokeStyle = '#fff7ed';
      ctx.lineWidth = lightMode ? 1.25 + pulse.power * 0.25 : 2 + pulse.power * 0.7;
      if (phase === 'charge') {
        // Le souffle se densifie depuis le noyau : plusieurs enveloppes
        // concentriques annoncent la détonation sans la déclencher trop tôt.
        ctx.beginPath(); ctx.arc(pulse.x, pulse.y, Math.max(3, visualRadius), 0, 6.2832); ctx.stroke();
        ctx.globalAlpha = fade * 0.42;
        ctx.beginPath(); ctx.arc(pulse.x, pulse.y, Math.max(4, visualRadius * 1.42), 0, 6.2832); ctx.stroke();
        ctx.globalAlpha = fade * 0.88;
        ctx.fillStyle = '#fff7ed';
        ctx.beginPath(); ctx.arc(pulse.x, pulse.y, Math.max(3, radius * (0.06 + chargeEase * 0.1)), 0, 6.2832); ctx.fill();
      } else if (phase === 'implode') {
        // La coque revient vers le centre juste avant le nuage de particules.
        ctx.beginPath(); ctx.arc(pulse.x, pulse.y, Math.max(3, visualRadius), 0, 6.2832); ctx.stroke();
        ctx.globalAlpha = fade * 0.78;
        ctx.fillStyle = '#fff7ed';
        ctx.beginPath(); ctx.arc(pulse.x, pulse.y, Math.max(3, radius * (0.11 + implodeEase * 0.11)), 0, 6.2832); ctx.fill();
      } else {
        ctx.beginPath(); ctx.arc(pulse.x, pulse.y, Math.max(4, visualRadius), 0, 6.2832); ctx.stroke();
        if (!lightMode) {
          ctx.globalAlpha = fade * 0.4;
          ctx.setLineDash([4, 6]);
          ctx.beginPath(); ctx.arc(pulse.x, pulse.y, Math.max(5, visualRadius * 0.72), 0, 6.2832); ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }
    ctx.restore();
  }

  drawWall(ctx: CanvasRenderingContext2D, wall: BreakerWall): void {
    ctx.save();
    // Halo très discret autour de la zone de tolérance : le joueur voit la
    // présence de l'arête avant que la collision “assistée” ne se déclenche.
    ctx.strokeStyle = '#94a3b824';
    ctx.lineWidth = 2;
    UI.roundRect(
      ctx,
      wall.x - WALL_COLLISION_PADDING,
      wall.y - WALL_COLLISION_PADDING,
      wall.w + WALL_COLLISION_PADDING * 2,
      wall.h + WALL_COLLISION_PADDING * 2,
      Math.min(9, Math.min(wall.w, wall.h) * 0.35),
    );
    ctx.stroke();
    UI.roundRect(ctx, wall.x, wall.y, wall.w, wall.h, Math.min(7, Math.min(wall.w, wall.h) * 0.3));
    ctx.fillStyle = '#263244';
    ctx.fill();
    ctx.strokeStyle = '#94a3b888';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.globalAlpha = 0.38;
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1;
    const vertical = wall.h > wall.w;
    const step = Math.max(12, Math.min(28, (vertical ? wall.h : wall.w) / 8));
    ctx.beginPath();
    if (vertical) {
      for (let y = wall.y + step; y < wall.y + wall.h - 2; y += step) {
        ctx.moveTo(wall.x + 3, y); ctx.lineTo(wall.x + wall.w - 3, y);
      }
      ctx.moveTo(wall.x + wall.w * 0.5, wall.y + 3);
      ctx.lineTo(wall.x + wall.w * 0.5, wall.y + wall.h - 3);
    } else {
      for (let x = wall.x + step; x < wall.x + wall.w - 2; x += step) {
        ctx.moveTo(x, wall.y + 3); ctx.lineTo(x, wall.y + wall.h - 3);
      }
      ctx.moveTo(wall.x + 3, wall.y + wall.h * 0.5);
      ctx.lineTo(wall.x + wall.w - 3, wall.y + wall.h * 0.5);
    }
    ctx.stroke();
    ctx.restore();
  }

  drawBumper(ctx: CanvasRenderingContext2D, bumper: BreakerBumper): void {
    const breath = 1 + Math.sin(this.time * 3.14 + bumper.id * 1.7) * 0.025;
    const pulse = clampValue(bumper.pulseT / 0.25, 0, 1);
    const squash = breath + pulse * 0.1;
    ctx.save();
    ctx.translate(bumper.x, bumper.y);
    ctx.scale(squash, 1 - pulse * 0.08);
    ctx.globalCompositeOperation = 'lighter';
    ctx.shadowColor = '#ffd166';
    ctx.shadowBlur = 10 + pulse * 12;
    ctx.fillStyle = '#4a3b20';
    ctx.beginPath(); ctx.arc(0, 0, bumper.r, 0, 6.2832); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#ffd166';
    ctx.lineWidth = 2 + pulse * 2;
    ctx.beginPath(); ctx.arc(0, 0, bumper.r - 2, 0, 6.2832); ctx.stroke();
    ctx.strokeStyle = '#fff7ccaa';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 0, bumper.r * 0.56, 0, 6.2832); ctx.stroke();
    ctx.globalAlpha = 0.22;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(0, 0, bumper.r + BUMPER_COLLISION_PADDING, 0, 6.2832); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ffd166';
    ctx.beginPath(); ctx.arc(0, 0, bumper.r * 0.2 + pulse * 2, 0, 6.2832); ctx.fill();
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * bumper.r * 0.62, Math.sin(a) * bumper.r * 0.62);
      ctx.lineTo(Math.cos(a) * bumper.r * 0.84, Math.sin(a) * bumper.r * 0.84);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawObstacles(ctx: CanvasRenderingContext2D): void {
    for (const obstacle of this.obstacles as BreakerObstacle[]) {
      if (obstacle.kind === 'wall') this.drawWall(ctx, obstacle);
      else this.drawBumper(ctx, obstacle);
    }
  }

  drawTrajectoryPredictor(ctx: CanvasRenderingContext2D): void {
    const ball = (this.balls as any[]).find((candidate) => !candidate.dead && !candidate.glued && !(this.stuck && candidate === this.balls[0]));
    if (!ball) return;
    let x = ball.x, y = ball.y, vx = ball.vx, vy = ball.vy;
    const step = 1 / 120;
    const maxSteps = Math.round(2 / step);
    let bounces = 0;
    ctx.save();
    ctx.strokeStyle = '#facc15aa';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 6]);
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let i = 0; i < maxSteps && bounces < 6; i++) {
      x += vx * step; y += vy * step;
      if (x - ball.r < WALL) { x = WALL + ball.r; vx = Math.abs(vx); bounces++; }
      else if (x + ball.r > 1280 - WALL) { x = 1280 - WALL - ball.r; vx = -Math.abs(vx); bounces++; }
      if (y - ball.r < WALL) { y = WALL + ball.r; vy = Math.abs(vy); bounces++; }
      for (const obstacle of this.obstacles as BreakerObstacle[]) {
        const hit = obstacle.kind === 'wall'
          ? circleVsAabb(x, y, ball.r, obstacle.x, obstacle.y, obstacle.w, obstacle.h, WALL_COLLISION_PADDING)
          : circleVsCircle(x, y, ball.r, obstacle.x, obstacle.y, obstacle.r, BUMPER_COLLISION_PADDING);
        if (!hit) continue;
        const temp = { vx, vy };
        reflectVelocity(temp, hit);
        vx = temp.vx; vy = temp.vy;
        x += hit.nx * Math.max(hit.penetration, 0.5);
        y += hit.ny * Math.max(hit.penetration, 0.5);
        if (obstacle.kind === 'bumper') {
          const speed = Math.hypot(vx, vy) || 1;
          const boostedSpeed = this.speed * obstacle.boost;
          vx *= boostedSpeed / speed;
          vy *= boostedSpeed / speed;
          const chaos = this.bumperChaosAngle(x, y, obstacle.id, this.time + i * step);
          const cos = Math.cos(chaos), sin = Math.sin(chaos);
          const outVx = vx * cos - vy * sin;
          const outVy = vx * sin + vy * cos;
          vx = outVx; vy = outVy;
        }
        bounces++;
        break;
      }
      ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  drawLabOverlay(ctx: CanvasRenderingContext2D): void {
    if (!this.lab) return;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = '#ffffffaa';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    for (const obstacle of this.obstacles as BreakerObstacle[]) {
      if (obstacle.kind === 'wall') {
        ctx.strokeRect(obstacle.x, obstacle.y, obstacle.w, obstacle.h);
      } else {
        ctx.beginPath(); ctx.arc(obstacle.x, obstacle.y, obstacle.r, 0, 6.2832); ctx.stroke();
      }
    }
    for (const ball of this.balls as any[]) {
      if (ball.dead) continue;
      ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.r, 0, 6.2832); ctx.stroke();
      if (!ball.glued && !(this.stuck && ball === this.balls[0])) {
        ctx.strokeStyle = '#7dd3fcaa';
        ctx.beginPath(); ctx.moveTo(ball.x, ball.y); ctx.lineTo(ball.x + clampValue(ball.vx * 0.08, -90, 90), ball.y + clampValue(ball.vy * 0.08, -90, 90)); ctx.stroke();
        ctx.strokeStyle = '#ffffffaa';
      }
    }
    if (this.labContact) {
      const c = this.labContact;
      ctx.setLineDash([]);
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(c.x - 7, c.y); ctx.lineTo(c.x + 7, c.y);
      ctx.moveTo(c.x, c.y - 7); ctx.lineTo(c.x, c.y + 7);
      ctx.moveTo(c.x, c.y); ctx.lineTo(c.x + c.nx * 34, c.y + c.ny * 34);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    this.drawTrajectoryPredictor(ctx);

    const x = 930, y = 42, w = 320, h = 170;
    UI.panel(ctx, x, y, w, h, { radius: 12, fill: '#0b0e14e8', stroke: '#facc1544', lineWidth: 1 });
    UI.txt(ctx, 'B-LAB · ' + this.lab.toUpperCase(), x + 14, y + 22, { size: 13, mono: true, color: '#facc15', weight: 900 });
    const stats: Array<[string, string]> = [
      ['BALLS', String(this.balls.length)],
      ['WALL HITS', String(this.labStats.wallHits)],
      ['BUMPER HITS', String(this.labStats.bumperHits)],
      ['BUMPER → BRICK', String(this.labStats.bumperToBrick)],
      ['BUMPER → EXPLOSIVE', String(this.labStats.bumperToExplosive)],
      ['MAX COMBO', String(this.labStats.maxCombo)],
    ];
    stats.forEach(([label, value], index) => {
      const py = y + 47 + index * 19;
      UI.txt(ctx, label, x + 14, py, { size: 11, mono: true, color: '#aab4c4', weight: 800 });
      UI.txt(ctx, value, x + w - 14, py, { size: 11, mono: true, color: '#ffffff', align: 'right', weight: 900 });
    });
    if (this.lab === 'readability') {
      const labels: Array<[string, string]> = [['NORMAL', '#ffffff'], ['REINFORCED', '#ffffff'], ['EXPLOSIVE', '#fff7ed'], ['GRAVITY', '#dbeafe']];
      labels.forEach(([label, color], index) => UI.txt(ctx, label, 250 + index * 250, 292, { size: 12, mono: true, align: 'center', color, weight: 900 }));
    }
    ctx.restore();
  }

  drawPaddle(ctx: CanvasRenderingContext2D): void {
    const pad = this.pad, w = this.padW, h = 18;
    const sq = Math.min(1, Math.abs(pad.vx) / 900);
    ctx.save();
    ctx.translate(pad.x, PAD_Y);
    ctx.scale(1 + sq * 0.1 + Math.sin(this.time * 9) * 0.015, 1 - sq * 0.14 + Math.cos(this.time * 9) * 0.01);
    ctx.shadowColor = this.freezeT > 0 ? '#7dd3fc' : this.accent;
    ctx.shadowBlur = 16;
    UI.roundRect(ctx, -w / 2, -h / 2, w, h, 9);
    ctx.fillStyle = this.freezeT > 0 ? '#7dd3fc' : this.accent;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    UI.roundRect(ctx, -w / 2 + 6, -h / 2 + 3, w - 12, 5, 2.5);
    ctx.fill();
    // yeux qui suivent la balle
    const b0 = this.balls[0];
    const lx = b0 ? Math.max(-1, Math.min(1, (b0.x - pad.x) / 320)) * 2.5 : 0;
    ctx.fillStyle = '#0b0e14';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(s * Math.min(24, w * 0.16) + lx, -2, 2.5, 3.4, 0, 0, 6.2832);
      ctx.fill();
    }
    if (this.laserT > 0) {
      ctx.shadowColor = DCOL.LASER;
      ctx.shadowBlur = 12;
      ctx.fillStyle = DCOL.LASER;
      for (const s of [-1, 1]) {
        UI.roundRect(ctx, s * w * 0.3 - 4, -h / 2 - 7, 8, 8, 3);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
    }
    if (this.glueT > 0) {
      ctx.globalAlpha = 0.7;
      ctx.strokeStyle = DCOL.GLUE;
      ctx.lineWidth = 2;
      UI.roundRect(ctx, -w / 2 + 2, -h / 2 - 3, w - 4, h + 6, 11);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  drawLasers(ctx: CanvasRenderingContext2D): void {
    for (const laser of this.lasers) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.min(1, laser.life * 3);
      ctx.shadowColor = DCOL.LASER;
      ctx.shadowBlur = 13;
      ctx.strokeStyle = '#ffb6de';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(laser.x, laser.y + 24);
      ctx.lineTo(laser.x, laser.y - 8);
      ctx.stroke();
      ctx.fillStyle = DCOL.LASER;
      ctx.beginPath();
      ctx.arc(laser.x, laser.y - 9, laser.r + 1, 0, 6.2832);
      ctx.fill();
      ctx.restore();
    }
  }

  drawBallPower(ctx: CanvasRenderingContext2D, bl: any): void {
    if (this.giantT <= 0 && this.flameT <= 0 && !bl.glued) return;
    ctx.save();
    ctx.translate(bl.x, bl.y);
    ctx.globalCompositeOperation = 'lighter';
    if (this.giantT > 0) {
      ctx.globalAlpha = 0.26 + Math.sin(this.time * 8) * 0.06;
      ctx.strokeStyle = DCOL.GIANT;
      ctx.lineWidth = 3;
      ctx.shadowColor = DCOL.GIANT;
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.arc(0, 0, bl.r + 7 + Math.sin(this.time * 7) * 2, 0, 6.2832);
      ctx.stroke();
    }
    if (this.flameT > 0) {
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = DCOL.FLAME;
      ctx.shadowColor = DCOL.FLAME;
      ctx.shadowBlur = 20;
      for (let i = 0; i < 3; i++) {
        const a = this.time * (3.5 + i * 0.25) + i * 2.1;
        const r = bl.r + 3 + (i % 2) * 3;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * r, Math.sin(a) * r, 2.5 + (i % 2), 0, 6.2832);
        ctx.fill();
      }
    }
    if (bl.glued) {
      ctx.globalAlpha = 0.75;
      ctx.strokeStyle = DCOL.GLUE;
      ctx.lineWidth = 3;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.arc(0, 0, bl.r + 8, 0, 6.2832);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  drawPowerStatus(ctx: CanvasRenderingContext2D): void {
    const powers: Array<[string, string, string]> = [];
    if (this.laserT > 0) powers.push(['LASER', Math.ceil(this.laserT) + 's', DCOL.LASER]);
    if (this.glueT > 0) powers.push(['GLUE', Math.ceil(this.glueT) + 's', DCOL.GLUE]);
    if (this.flameT > 0) powers.push(['FLAMME', Math.ceil(this.flameT) + 's', DCOL.FLAME]);
    if (this.giantT > 0) powers.push(['GÉANTE', Math.ceil(this.giantT) + 's', DCOL.GIANT]);
    if (this.largeT > 0) powers.push(['LARGE', Math.ceil(this.largeT) + 's', DCOL.LARGE]);
    if (this.smallT > 0) powers.push(['SMALL', Math.ceil(this.smallT) + 's', DCOL.SMALL]);
    if (this.slowT > 0) powers.push(['SLOW', Math.ceil(this.slowT) + 's', DCOL.SLOW]);
    if (this.balls.length > 1) powers.push(['MULTI', '×' + this.balls.length, DCOL.MULTI]);
    if (!powers.length) return;

    const columns = powers.length > 4 ? 2 : 1;
    const rows = Math.ceil(powers.length / columns);
    const x = 20, y = 514, w = columns === 2 ? 300 : 224, h = 30 + rows * 18;
    UI.panel(ctx, x, y, w, h, { radius: 12, fill: '#100d18e8', stroke: '#ffffff22', lineWidth: 1 });
    UI.txt(ctx, 'POUVOIRS', x + 12, y + 18, { size: 10, mono: true, color: '#8b95a8', weight: 800 });
    powers.forEach(([name, value, color], index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const cellX = x + column * (w / columns);
      const py = y + 37 + row * 18;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(cellX + 14, py - 4, 3, 0, 6.2832);
      ctx.fill();
      UI.txt(ctx, name, cellX + 24, py, { size: 11, mono: true, color, weight: 800 });
      UI.txt(ctx, value, cellX + w / columns - 12, py, { size: 11, mono: true, color: '#dce3ee', align: 'right' });
    });
  }

  lifeBlob(ctx: CanvasRenderingContext2D, x: number, y: number, on: boolean): void {
    ctx.globalAlpha = on ? 1 : 0.15;
    ctx.fillStyle = this.accent;
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, 6.2832);
    ctx.fill();
    if (on) {
      ctx.fillStyle = '#0b0e14';
      ctx.beginPath(); ctx.arc(x - 2.6, y - 1.5, 1.4, 0, 6.2832); ctx.fill();
      ctx.beginPath(); ctx.arc(x + 2.6, y - 1.5, 1.4, 0, 6.2832); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  render(ctx: CanvasRenderingContext2D): void {
    // fond
    ctx.fillStyle = '#0a0912';
    ctx.fillRect(0, 0, 1280, 720);

    this.fx.world(ctx);

    UI.grid(ctx, { gap: 64, alpha: 0.04 });

    // cadre de jeu (ouvert en bas)
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(WALL, 720); ctx.lineTo(WALL, WALL);
    ctx.lineTo(1280 - WALL, WALL); ctx.lineTo(1280 - WALL, 720);
    ctx.stroke();

    // briques
    for (const br of this.bricks as BreakerBrick[]) {
      if (br.hp <= 0 && !br.falling && !(br.detachT && br.detachT > 0) && !br.queued) continue;
      this.drawBrick(ctx, br);
    }
    this.drawObstacles(ctx);
    this.drawExplosions(ctx);

    // drops
    for (const d of this.drops as BreakerDrop[]) {
      ctx.save();
      ctx.translate(d.x, d.y + Math.sin(this.time * 5 + d.x * 0.03) * 2);
      ctx.rotate(Math.sin(this.time * 3 + d.x) * 0.12);
      ctx.shadowColor = DCOL[d.kind]; ctx.shadowBlur = 12;
      UI.roundRect(ctx, -9, -9, 18, 18, 5);
      ctx.fillStyle = DCOL[d.kind];
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      UI.txt(ctx, DGLYPH[d.kind], 0, 1, { size: DGLYPH[d.kind].length > 1 ? 8 : 12, align: 'center', baseline: 'middle', color: '#0b0e14', weight: 900 });
      ctx.restore();
    }

    // paddle-blob
    this.drawPaddle(ctx);
    this.drawLasers(ctx);

    if (this.freezeT > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const k = 0.35 + Math.sin(this.time * 18) * 0.1;
      ctx.globalAlpha = k;
      ctx.strokeStyle = '#7dd3fc';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 7]);
      ctx.beginPath(); ctx.arc(this.pad.x, PAD_Y - 8, this.padW * 0.62 + 8, 0, 6.2832); ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // anneau d'attente autour de la balle collée
    if (this.stuck && this.balls[0]) {
      const b = this.balls[0];
      ctx.globalAlpha = 0.3 + 0.22 * Math.sin(this.time * 6);
      ctx.strokeStyle = this.accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r + 8 + Math.sin(this.time * 6) * 2, 0, 6.2832);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // balles
    for (const bl of this.balls) {
      this.drawBallPower(ctx, bl);
      bl.render(ctx);
    }

    this.drawLabOverlay(ctx);

    this.fx.drawWorld(ctx);
    this.fx.endWorld(ctx);

    // HUD
    UI.drawHUD(ctx, {
      accent: this.accent,
      score: this.score,
      unit: this.meta.unit,
      extra: () => {
        for (let i = 0; i < 3; i++) this.lifeBlob(ctx, 36 + i * 25, 38 + Math.sin(this.time * 3 + i) * 1.2, i < this.lives);
        UI.txt(ctx, 'NIV ' + this.level + ' · ' + this.levelSpec.name, 24, 76, { size: 13, color: '#7c8698', mono: true });
        if (this.freezeT > 0) UI.txt(ctx, 'FREEZE', 640, 76, { size: 13, align: 'center', color: '#7dd3fc', mono: true, weight: 900 });
        if (this.comboStep >= 4) {
          UI.txt(ctx, 'COMBO ×' + this.comboStep, 640, 44, { size: 20 + Math.min(10, this.comboStep * 0.5), align: 'center', color: '#ffd166', weight: 900, shadow: true });
        }
      },
    });

    this.drawPowerStatus(ctx);
    this.drawCommon(ctx);
  }
}
