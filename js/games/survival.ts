// SURVIBLOB — arène, esquive au stick, dash qui traverse les chasseurs.
// La partie avance par vagues lisibles : préparation, défi limité dans le temps,
// récompense, puis montée progressive en complexité.

import { BaseGame } from '../core/game';
import * as UI from '../core/ui';
import type { EngineLike, GameMeta } from '../core/types';

const M = 70;
const AW = 1280 - M * 2;
const AH = 720 - M * 2;
const PI2 = Math.PI * 2;
const ARENA_CENTER: [number, number] = [640, 360];
const ROTOR_ARENA_RADIUS = 238;

type WavePhase = 'prep' | 'active';
type EnemyKind = 'chaser' | 'mine' | 'gunner' | 'boss';

interface WavePlan {
  wave: number;
  title: string;
  subtitle: string;
  color: string;
  duration: number;
  prepDuration: number;
  difficulty: number;
  enemies: boolean;
  mines: boolean;
  gunners: boolean;
  bars: boolean;
  barCount: number;
  rotor: boolean;
  rotorCount: number;
  resources: boolean;
  resourceTarget: number;
  bonusChance: number;
  special: boolean;
  boss: boolean;
  confined: boolean;
  confinedRadius: number;
  enemyInterval: number;
}

interface Telegraph {
  x: number;
  y: number;
  t: number;
  maxT: number;
  type: EnemyKind;
}

interface MovingBar {
  orientation: 'horizontal' | 'vertical';
  x: number;
  y: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
  gapCenter: number;
  gapSize: number;
  gapSpeed: number;
  warn: number;
  phase: number;
}

interface RotorTrap {
  cx: number;
  cy: number;
  inner: number;
  length: number;
  arms: number;
  angle: number;
  speed: number;
  width: number;
  warn: number;
  tickT: number;
}

interface SurvivalOrb {
  x: number;
  y: number;
  t: number;
  life: number;
  maxLife: number;
  kind: 'resource' | 'bonus';
  dead?: boolean;
}

interface SurvivalBullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  color?: string;
  dead?: boolean;
}

interface SurvivalEnemy {
  kind: EnemyKind;
  x: number;
  y: number;
  r: number;
  vx?: number;
  vy?: number;
  sp?: number;
  rot?: number;
  arm?: number;
  pulse?: number;
  st?: string;
  t?: number;
  shots?: number;
  burst?: number;
  bt?: number;
  ang?: number;
  volley?: number;
  leaveA?: number;
  hp?: number;
  maxHp?: number;
  hitT?: number;
  phase?: number;
  dead?: boolean;
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

function distanceToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq <= 0.0001) return Math.hypot(px - x1, py - y1);
  const t = clamp(((px - x1) * dx + (py - y1) * dy) / lengthSq, 0, 1);
  return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
}

function distanceToRect(px: number, py: number, x: number, y: number, w: number, h: number): number {
  const dx = Math.max(Math.abs(px - x) - w / 2, 0);
  const dy = Math.max(Math.abs(py - y) - h / 2, 0);
  return Math.hypot(dx, dy);
}

function circleHitsRect(px: number, py: number, radius: number, x: number, y: number, w: number, h: number): boolean {
  return distanceToRect(px, py, x, y, w, h) < radius;
}

function circleHitsMovingBar(px: number, py: number, radius: number, bar: MovingBar): boolean {
  const left = M;
  const right = M + AW;
  const top = M;
  const bottom = M + AH;
  const gapStart = bar.gapCenter - bar.gapSize / 2;
  const gapEnd = bar.gapCenter + bar.gapSize / 2;

  if (bar.orientation === 'horizontal') {
    const leftWidth = Math.max(0, gapStart - left);
    const rightWidth = Math.max(0, right - gapEnd);
    return (leftWidth > 0 && circleHitsRect(px, py, radius, left + leftWidth / 2, bar.y, leftWidth, bar.h))
      || (rightWidth > 0 && circleHitsRect(px, py, radius, gapEnd + rightWidth / 2, bar.y, rightWidth, bar.h));
  }

  const topHeight = Math.max(0, gapStart - top);
  const bottomHeight = Math.max(0, bottom - gapEnd);
  return (topHeight > 0 && circleHitsRect(px, py, radius, bar.x, top + topHeight / 2, bar.w, topHeight))
    || (bottomHeight > 0 && circleHitsRect(px, py, radius, bar.x, gapEnd + bottomHeight / 2, bar.w, bottomHeight));
}

export class SurvivalGame extends BaseGame {
  [key: string]: any;

  static meta: GameMeta = {
    id: 'surv', name: 'SURVIBLOB', accent: '#34d399', mood: 'survival',
    desc: 'Survis à des vagues de plus en plus complexes.', controls: 'Stick bouger · A dash',
    keys: 'ZQSD / Flèches + Espace',
    hint: 'Lis les télégraphes · A = dash (traverse les chasseurs)',
    unit: 'pts', ranks: [2500, 1200, 600, 250, 0],
  };

  constructor(engine: EngineLike) {
    super(engine);
    this.blob.x = 640;
    this.blob.y = 360;
    this.blob.r = 21;
    this.blob.trailOn = true;

    this.dashT = 0;
    this.dashCd = 0;
    this.dashDir = [1, 0];
    this.facing = [1, 0];

    this.wave = 1;
    this.wavePhase = 'prep' as WavePhase;
    this.wavePhaseT = 2.6;
    this.waveElapsed = 0;
    this.waveBannerT = 0;
    this.wavePlan = this.getWavePlan(this.wave);
    this.lastBonus = '';
    this.lastBonusT = 0;

    this.spawnT = 0.7;
    this.resourceT = 0.4;
    this.bossQueued = false;
    this.specialCycleT = 0;
    this.specialActive = false;
    this.specialWarning = false;
    this.specialWasActive = false;
    this.bonusT = 0;
    this.nearCueT = 0;
    this.boundaryCueT = 0;

    this.enemies = [] as SurvivalEnemy[];
    this.bullets = [] as SurvivalBullet[];
    this.telegraphs = [] as Telegraph[];
    this.bars = [] as MovingBar[];
    this.rotors = [] as RotorTrap[];
    this.orbs = [] as SurvivalOrb[];
    this.orbChainT = 0;
    this.coinStep = 0;
  }

  getWavePlan(wave: number): WavePlan {
    const cycle = Math.floor((wave - 1) / 6);
    const slot = ((wave - 1) % 6) + 1;
    const difficulty = Math.min(0.82, 0.08 + (wave - 1) * 0.055);
    const duration = Math.min(15.5, 10.8 + wave * 0.22);

    const make = (overrides: Partial<WavePlan>): WavePlan => ({
      wave,
      title: 'ENNEMIS',
      subtitle: 'Reste en mouvement',
      color: '#ff5470',
      duration,
      prepDuration: wave === 1 ? 2.6 : 2.35,
      difficulty,
      enemies: false,
      mines: false,
      gunners: false,
      bars: false,
      barCount: 0,
      rotor: false,
      rotorCount: 0,
      resources: false,
      resourceTarget: 0,
      bonusChance: 0,
      special: false,
      boss: false,
      confined: false,
      confinedRadius: ROTOR_ARENA_RADIUS,
      enemyInterval: 1.55,
      ...overrides,
    });

    if (wave === 1) {
      return make({
        title: 'ENNEMIS',
        subtitle: 'Chasseurs basiques · prends le rythme',
        color: '#ff5470',
        enemies: true,
        enemyInterval: 1.65,
      });
    }
    if (wave === 2) {
      return make({
        title: 'BARRES À TROUS',
        subtitle: 'Les barres se déplacent · cherche le trou',
        color: '#38bdf8',
        bars: true,
        barCount: 2,
      });
    }
    if (wave === 3) {
      return make({
        title: 'TRAPPE ROTATIVE',
        subtitle: 'Un espace réduit · reste dans le tempo',
        color: '#fb923c',
        rotor: true,
        rotorCount: 1,
        confined: true,
        confinedRadius: ROTOR_ARENA_RADIUS,
      });
    }
    if (wave === 4) {
      return make({
        title: 'RESSOURCES',
        subtitle: 'Aucune menace · récupère les balises',
        color: '#34d399',
        resources: true,
        resourceTarget: 3,
        bonusChance: 0.24,
      });
    }
    if (wave === 5) {
      return make({
        title: 'ENNEMIS + OBSTACLES',
        subtitle: 'Pression et gestion de l’espace',
        color: '#f59e0b',
        enemies: true,
        bars: true,
        barCount: 2,
        enemyInterval: 1.4,
      });
    }
    if (wave === 6) {
      return make({
        title: 'SPÉCIALE · ÉCHO DOUX',
        subtitle: 'Inversion brève des contrôles · pas d’empilement de menaces',
        color: '#a78bfa',
        duration: 12.5,
        resources: true,
        resourceTarget: 3,
        bonusChance: 0.34,
        special: true,
      });
    }

    // Après le premier cycle, la même grammaire revient avec des combinaisons
    // mesurées. Chaque sixième vague devient un boss, sans transformer la 6 en
    // mur de difficulté : elle reste le sas d’apprentissage de la règle spéciale.
    if (wave > 6 && wave % 6 === 0) {
      return make({
        title: 'BOSS · LE VEILLEUR',
        subtitle: 'Détruis son noyau avec le dash, puis tiens la position',
        color: '#f472b6',
        duration: 17,
        enemies: true,
        boss: true,
        enemyInterval: 2.2,
      });
    }

    if (slot === 1) {
      return make({
        title: 'ENNEMIS + MINES',
        subtitle: 'Les chasseurs ferment les sorties',
        color: '#ff5470',
        enemies: true,
        mines: true,
        enemyInterval: 1.35,
      });
    }
    if (slot === 2) {
      return make({
        title: 'BARRES + RESSOURCES',
        subtitle: 'Le bon détour vaut plus que la ligne droite',
        color: '#38bdf8',
        bars: true,
        barCount: 2 + Math.min(1, cycle),
        resources: true,
        resourceTarget: 3,
        bonusChance: 0.28,
      });
    }
    if (slot === 3) {
      return make({
        title: 'ROTATIF + CHASSEURS',
        subtitle: 'Traverse au bon moment',
        color: '#fb923c',
        rotor: true,
        rotorCount: 1 + Math.min(1, cycle),
        enemies: true,
        enemyInterval: 1.5,
      });
    }
    if (slot === 4) {
      return make({
        title: 'RÉCUPÉRATION SOUS PRESSION',
        subtitle: 'Les ressources reviennent, mais le temps est compté',
        color: '#34d399',
        resources: true,
        resourceTarget: 4,
        bonusChance: 0.3,
        enemies: cycle > 1,
        mines: cycle > 1,
        enemyInterval: 1.65,
      });
    }
    return make({
      title: 'MÉLANGE TOTAL',
      subtitle: 'Lis les priorités · utilise le dash pour respirer',
      color: '#f59e0b',
      enemies: true,
      mines: true,
      gunners: cycle > 1,
      bars: true,
      barCount: 2 + Math.min(1, cycle),
      rotor: cycle > 1,
      rotorCount: cycle > 1 ? 1 : 0,
      resources: true,
      resourceTarget: 3,
      bonusChance: 0.26,
      enemyInterval: 1.25,
    });
  }

  spawnPoint(): [number, number] {
    const side = (Math.random() * 4) | 0;
    const p = 0.15 + Math.random() * 0.7;
    if (side === 0) return [M + AW * p, M + 30];
    if (side === 1) return [M + AW * p, M + AH - 30];
    if (side === 2) return [M + 30, M + AH * p];
    return [M + AW - 30, M + AH * p];
  }

  randomArenaPoint(minDistance = 100): [number, number] {
    for (let attempt = 0; attempt < 12; attempt++) {
      const x = M + 70 + Math.random() * (AW - 140);
      const y = M + 70 + Math.random() * (AH - 140);
      if (Math.hypot(x - this.blob.x, y - this.blob.y) >= minDistance) return [x, y];
    }
    return [M + AW * 0.75, M + AH * 0.25];
  }

  startActiveWave(): void {
    this.wavePhase = 'active';
    this.wavePhaseT = 0;
    this.waveElapsed = 0;
    this.waveBannerT = 2.2;
    this.spawnT = this.wavePlan.boss ? 2.6 : Math.min(1.05, this.wavePlan.enemyInterval * 0.55);
    this.resourceT = 0.45;
    this.bossQueued = false;
    this.specialCycleT = 0;
    this.specialActive = false;
    this.specialWarning = false;
    this.specialWasActive = false;
    this.telegraphs.length = 0;
    this.bars.length = 0;
    this.rotors.length = 0;
    this.orbs.length = 0;
    this.enemies.length = 0;
    this.bullets.length = 0;

    this.audioWaveCue();
    this.musicEvent('waveStart', this.wavePlan.boss ? 0.95 : 0.42 + this.wavePlan.difficulty * 0.3);
    this.input.rumble(this.wavePlan.boss ? 0.55 : 0.22, this.wavePlan.boss ? 0.2 : 0.08);
    this.fx.flash(this.wavePlan.color, this.wavePlan.boss ? 0.16 : 0.08);
    this.fx.ring(640, 360, {
      r0: 70,
      r1: this.wavePlan.boss ? 310 : 220,
      color: this.wavePlan.color,
      life: this.wavePlan.boss ? 0.7 : 0.42,
      width: this.wavePlan.boss ? 5 : 3,
    });
  }

  finishWave(): void {
    if (this.wavePhase !== 'active' || this.state === 'over') return;

    const completedWave = this.wave;
    const reward = 45 + completedWave * 18;
    this.score += reward;
    this.lastBonusT = 2.8;
    this.lastBonus = 'VAGUE NETTE  +' + reward;
    this.audio.milestone();
    this.musicEvent('waveComplete', Math.min(1, 0.55 + completedWave * 0.035));
    this.input.rumble(0.38, 0.12);
    this.fx.flash(this.wavePlan.color, 0.12);
    this.fx.ring(640, 360, { r0: 30, r1: 330, color: this.wavePlan.color, life: 0.6, width: 4 });
    this.fx.text(640, 330, 'VAGUE ' + completedWave + ' NETTE', { color: this.wavePlan.color, size: 27, mono: true });
    this.fx.text(640, 365, '+' + reward, { color: '#ffd166', size: 20, mono: true });

    if (Math.random() < this.wavePlan.bonusChance + (completedWave >= 7 ? 0.1 : 0)) {
      const bonus = 90 + completedWave * 12;
      this.score += bonus;
      this.lastBonus = 'BONUS ALÉATOIRE  +' + bonus;
      this.audio.perfect();
      this.musicEvent('powerUp', 0.75);
      this.input.rumble(0.52, 0.16);
      this.fx.flash('#ffd166', 0.1);
      this.fx.burst(640, 360, { n: 28, speed: [100, 360], colors: ['#ffd166', '#ffffff', this.wavePlan.color], life: 0.7, shape: 'spark' });
      this.fx.text(640, 400, 'BONUS  +' + bonus, { color: '#ffd166', size: 22, mono: true });
    }

    // Une vague est une unité lisible : les menaces qui restent sont retirées
    // proprement pendant la respiration, plutôt que de contaminer la suivante.
    this.enemies.length = 0;
    this.bullets.length = 0;
    this.telegraphs.length = 0;
    this.bars.length = 0;
    this.rotors.length = 0;
    this.orbs.length = 0;
    this.specialActive = false;
    this.specialWarning = false;

    this.wave += 1;
    this.wavePlan = this.getWavePlan(this.wave);
    this.wavePhase = 'prep';
    this.wavePhaseT = this.wavePlan.prepDuration;
    this.waveElapsed = 0;
    this.waveBannerT = 0;
    this.lastBonusT = Math.max(this.lastBonusT, 2.8);
  }

  update(dt: number): void {
    if (this.baseUpdate(dt)) return;

    this.waveBannerT = Math.max(0, this.waveBannerT - dt);
    this.lastBonusT = Math.max(0, this.lastBonusT - dt);
    this.bonusT = Math.max(0, this.bonusT - dt);
    this.orbChainT = Math.max(0, this.orbChainT - dt);
    this.nearCueT = Math.max(0, this.nearCueT - dt);
    this.boundaryCueT = Math.max(0, this.boundaryCueT - dt);
    if (this.orbChainT <= 0) this.coinStep = 0;

    if (this.wavePhase === 'prep') {
      this.wavePhaseT -= dt;
      this.specialActive = false;
      this.specialWarning = false;
      if (this.wavePhaseT <= 0) this.startActiveWave();
    } else {
      this.waveElapsed += dt;
      this.updateSpecial(dt);
    }

    this.updatePlayer(dt);
    if (this.state === 'over') return;

    if (this.wavePhase === 'active') {
      this.updateSpawns(dt);
      this.updateBars(dt);
      this.updateRotors(dt);
      this.updateEnemies(dt);
      this.updateBullets(dt);
      this.updateResources(dt);
      if (this.state !== 'over' && this.waveElapsed >= this.wavePlan.duration) this.finishWave();
    }

    this.score += dt * 10;
    this.updateThreatMeter();
  }

  updatePlayer(dt: number): void {
    const b = this.blob;
    const I = this.input;
    const inverted = this.specialActive;
    const ix = inverted ? -I.moveX : I.moveX;
    const iy = inverted ? -I.moveY : I.moveY;

    this.dashCd = Math.max(0, this.dashCd - dt);
    if ((I.pressed('a') || I.pressed('rb')) && this.dashCd <= 0 && this.dashT <= 0) {
      let dx = ix;
      let dy = iy;
      if (!dx && !dy) {
        dx = this.facing[0];
        dy = this.facing[1];
      }
      const length = Math.hypot(dx, dy) || 1;
      this.dashDir = [dx / length, dy / length];
      this.dashT = 0.16;
      this.dashCd = 0.85 * (this.bonusT > 0 ? 0.64 : 1);
      this.audio.dash();
      this.input.rumble(0.45, 0.1);
      this.blob.punch(0.2);
      this.fx.ring(b.x, b.y, { r0: 10, r1: 55, color: this.accent, life: 0.25 });
      this.fx.burst(b.x, b.y, {
        n: 10,
        speed: [60, 260],
        colors: [this.accent, '#ffffff'],
        life: 0.4,
        ang: Math.atan2(-dy, -dx),
        spread: 1.2,
      });
    }

    if (this.dashT > 0) {
      this.dashT -= dt;
      b.vx = this.dashDir[0] * 1150;
      b.vy = this.dashDir[1] * 1150;
      this.fx.burst(b.x, b.y, { n: 2, speed: [10, 60], colors: [this.accent], size: [3, 6], life: 0.3, shape: 'dot' });
    } else {
      this.steer(dt, b, ix, iy, this.bonusT > 0 ? 470 : 440, 9);
      if (Math.hypot(ix, iy) > 0.2) this.facing = [ix, iy];
    }

    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.x = clamp(b.x, M + b.r, 1280 - M - b.r);
    b.y = clamp(b.y, M + b.r, 720 - M - b.r);
    this.applyConfinedBounds();
    b.update(dt);
  }

  applyConfinedBounds(): void {
    if (!this.wavePlan.confined || this.wavePhase !== 'active') return;
    const [cx, cy] = this.rotors[0] ? [this.rotors[0].cx, this.rotors[0].cy] : ARENA_CENTER;
    const maxDistance = this.wavePlan.confinedRadius - this.blob.r;
    const dx = this.blob.x - cx;
    const dy = this.blob.y - cy;
    const distance = Math.hypot(dx, dy);
    if (distance <= maxDistance) return;

    const nx = dx / (distance || 1);
    const ny = dy / (distance || 1);
    this.blob.x = cx + nx * maxDistance;
    this.blob.y = cy + ny * maxDistance;
    const outwardSpeed = this.blob.vx * nx + this.blob.vy * ny;
    if (outwardSpeed > 0) {
      this.blob.vx -= outwardSpeed * nx;
      this.blob.vy -= outwardSpeed * ny;
    }
    if (this.boundaryCueT <= 0) {
      this.boundaryCueT = 0.28;
      this.audio.tone({ f: 150, f1: 92, type: 'sine', dur: 0.08, vol: 0.045 });
      this.input.rumble(0.14, 0.06);
      this.fx.ring(this.blob.x, this.blob.y, { r0: 8, r1: 28, color: '#fb923c', life: 0.16, width: 2 });
    }
  }

  updateSpecial(dt: number): void {
    if (!this.wavePlan.special) {
      this.specialActive = false;
      this.specialWarning = false;
      return;
    }

    this.specialCycleT += dt;
    const phase = this.specialCycleT % 5.4;
    const wasActive = this.specialActive;
    this.specialWarning = phase >= 3.15 && phase < 4.0;
    this.specialActive = phase >= 4.0 && phase < 5.15;
    if (this.specialActive && !wasActive) this.startSpecialPulse();
  }

  startSpecialPulse(): void {
    const now = this.audio.ctx?.currentTime || 0;
    this.audio.tone({ f: 220, f1: 110, type: 'sine', t: now, dur: 0.2, vol: 0.12 });
    this.audio.tone({ f: 620, f1: 960, type: 'triangle', t: now + 0.08, dur: 0.14, vol: 0.09 });
    this.input.rumble(0.23, 0.09);
    this.fx.flash('#a78bfa', 0.1);
    this.fx.ring(640, 360, { r0: 70, r1: 250, color: '#a78bfa', life: 0.46, width: 3 });
    this.fx.text(640, 250, 'ÉCHO', { color: '#c4b5fd', size: 24, mono: true });
  }

  updateSpawns(dt: number): void {
    this.spawnT -= dt;
    if (this.wavePlan.boss && !this.bossQueued && this.waveElapsed >= 0.45) {
      this.queueEnemy('boss');
      this.bossQueued = true;
    }

    const canSpawnEnemy = this.wavePlan.enemies && (!this.wavePlan.boss || this.waveElapsed >= 2.8);
    if (canSpawnEnemy && this.spawnT <= 0) {
      let kind: EnemyKind = 'chaser';
      const random = Math.random();
      if (this.wavePlan.mines && this.waveElapsed > 1.5 && random < 0.25) kind = 'mine';
      else if (this.wavePlan.gunners && this.waveElapsed > 3.5 && random < 0.2) kind = 'gunner';
      this.queueEnemy(kind);
      this.spawnT = Math.max(0.9, this.wavePlan.enemyInterval - this.wavePlan.difficulty * 0.22 + Math.random() * 0.25);
    }

    if (this.wavePlan.bars && this.bars.length === 0 && this.waveElapsed >= 0.35) this.createBars();
    if (this.wavePlan.rotor && this.rotors.length === 0 && this.waveElapsed >= 0.45) this.createRotors();

    for (const tg of this.telegraphs) tg.t -= dt;
    this.telegraphs = this.telegraphs.filter((tg: Telegraph) => {
      if (tg.t <= 0) {
        this.realize(tg);
        return false;
      }
      return true;
    });
  }

  queueEnemy(type: EnemyKind): void {
    const [x, y] = type === 'boss' ? [640, M + 100] : this.spawnPoint();
    const maxT = type === 'boss' ? 0.95 : 0.58;
    this.telegraphs.push({ x, y, t: maxT, maxT, type });
    const frequency = type === 'boss' ? 120 : type === 'gunner' ? 720 : type === 'mine' ? 360 : 540;
    this.audio.tone({ f: frequency, f1: frequency * 0.72, type: 'triangle', dur: type === 'boss' ? 0.2 : 0.07, vol: type === 'boss' ? 0.1 : 0.045 });
  }

  realize(tg: Telegraph): void {
    const difficulty = this.wavePlan.difficulty;
    if (tg.type === 'chaser') {
      const speed = 116 * (1 + difficulty * 0.55);
      this.enemies.push({ kind: 'chaser', x: tg.x, y: tg.y, vx: 0, vy: 0, r: 15, sp: speed, rot: 0 });
      this.fx.ring(tg.x, tg.y, { r0: 10, r1: 27, color: '#ff5470', life: 0.18, width: 2 });
    } else if (tg.type === 'mine') {
      this.enemies.push({ kind: 'mine', x: tg.x, y: tg.y, r: 14, arm: 2.25 - difficulty * 0.22, pulse: 0 });
      this.fx.ring(tg.x, tg.y, { r0: 10, r1: 31, color: '#fb923c', life: 0.22, width: 2 });
    } else if (tg.type === 'gunner') {
      this.enemies.push({ kind: 'gunner', x: tg.x, y: tg.y, r: 17, st: 'in', t: 0.7, shots: 2, burst: 0, bt: 0, ang: 0, volley: 0 });
      this.fx.ring(tg.x, tg.y, { r0: 10, r1: 31, color: '#38bdf8', life: 0.22, width: 2 });
    } else {
      const hp = 6 + Math.min(3, Math.floor((this.wave - 6) / 12));
      this.enemies.push({ kind: 'boss', x: tg.x, y: tg.y, r: 34, hp, maxHp: hp, t: 1.25, hitT: 0, phase: 0, ang: 0 });
      this.fx.ring(tg.x, tg.y, { r0: 18, r1: 70, color: '#f472b6', life: 0.55, width: 4 });
      this.fx.burst(tg.x, tg.y, { n: 18, speed: [40, 180], colors: ['#f472b6', '#ffffff'], life: 0.5, shape: 'spark' });
    }
  }

  createBars(): void {
    const count = this.wavePlan.barCount;
    const arenaRight = M + AW;
    const arenaBottom = M + AH;
    const difficulty = this.wavePlan.difficulty;
    for (let i = 0; i < count; i++) {
      const horizontal = i % 2 === 0;
      const thickness = 24;
      const speed = 146 + difficulty * 42 + (i % 2) * 18;
      const gapSize = 232 - difficulty * 26 - (this.wave > 6 ? 10 : 0);
      const direction = i % 4 < 2 ? 1 : -1;
      const gapMin = (horizontal ? M : M) + gapSize / 2 + 18;
      const gapMax = (horizontal ? arenaRight : arenaBottom) - gapSize / 2 - 18;
      const gapCenter = gapMin + (gapMax - gapMin) * (horizontal ? 0.42 : 0.62);
      const gapSpeed = direction * (38 + difficulty * 18) * (i % 2 ? -1 : 1);
      const x = horizontal ? ARENA_CENTER[0] : direction > 0 ? arenaRight + thickness : M - thickness;
      const y = horizontal ? direction > 0 ? M - thickness : arenaBottom + thickness : ARENA_CENTER[1];
      this.bars.push({
        orientation: horizontal ? 'horizontal' : 'vertical',
        x,
        y,
        w: horizontal ? AW + thickness * 2 : thickness,
        h: horizontal ? thickness : AH + thickness * 2,
        vx: horizontal ? 0 : direction * -speed,
        vy: horizontal ? direction * speed : 0,
        gapCenter,
        gapSize,
        gapSpeed,
        warn: 1.15,
        phase: Math.random() * PI2,
      });
      this.audio.tone({ f: 180 + i * 70, f1: 90, type: 'sine', dur: 0.12, vol: 0.06 });
      this.fx.ring(horizontal ? ARENA_CENTER[0] : x, horizontal ? y : ARENA_CENTER[1], { r0: 12, r1: 48, color: '#38bdf8', life: 0.32, width: 2 });
    }
  }

  updateBars(dt: number): void {
    for (const bar of this.bars) {
      bar.phase += dt * 4;
      if (bar.warn > 0) {
        bar.warn = Math.max(0, bar.warn - dt);
        continue;
      }
      bar.x += bar.vx * dt;
      bar.y += bar.vy * dt;
      const gapMin = (bar.orientation === 'horizontal' ? M : M) + bar.gapSize / 2 + 18;
      const gapMax = (bar.orientation === 'horizontal' ? M + AW : M + AH) - bar.gapSize / 2 - 18;
      bar.gapCenter += bar.gapSpeed * dt;
      if (bar.gapCenter < gapMin || bar.gapCenter > gapMax) {
        bar.gapCenter = clamp(bar.gapCenter, gapMin, gapMax);
        bar.gapSpeed *= -1;
        this.audio.tone({ f: 270, f1: 190, type: 'triangle', dur: 0.06, vol: 0.035 });
      }

      if (bar.orientation === 'horizontal') {
        const minY = M + bar.h / 2;
        const maxY = M + AH - bar.h / 2;
        if (bar.y < minY || bar.y > maxY) {
          bar.y = clamp(bar.y, minY, maxY);
          bar.vy *= -1;
          this.audio.tone({ f: 120, f1: 80, type: 'sine', dur: 0.08, vol: 0.045 });
          this.input.rumble(0.12, 0.05);
        }
      } else {
        const minX = M + bar.w / 2;
        const maxX = M + AW - bar.w / 2;
        if (bar.x < minX || bar.x > maxX) {
          bar.x = clamp(bar.x, minX, maxX);
          bar.vx *= -1;
          this.audio.tone({ f: 120, f1: 80, type: 'sine', dur: 0.08, vol: 0.045 });
          this.input.rumble(0.12, 0.05);
        }
      }

      if (circleHitsMovingBar(this.blob.x, this.blob.y, this.blob.r + 2, bar)) {
        this.blob.punch(0.38);
        this.audio.tone({ f: 85, f1: 48, type: 'sawtooth', dur: 0.16, vol: 0.11 });
        this.input.rumble(0.7, 0.16);
        this.die();
        return;
      }
    }
  }

  createRotors(): void {
    const centers: [number, number][] = [[640, 360]];
    if (this.wavePlan.rotorCount > 1) centers.push([935, 510]);
    for (let i = 0; i < this.wavePlan.rotorCount; i++) {
      const [cx, cy] = centers[i] || ARENA_CENTER;
      this.rotors.push({
        cx,
        cy,
        inner: i === 0 ? 18 : 42,
        length: i === 0 ? 222 + this.wavePlan.difficulty * 8 : 122,
        arms: i === 0 ? 4 : 3,
        angle: i * 0.9,
        speed: (i % 2 ? -1 : 1) * (1.42 + this.wavePlan.difficulty * 0.28),
        width: i === 0 ? 15 : 13,
        warn: 1.15,
        tickT: 0.25,
      });
    }
    this.audio.tone({ f: 130, f1: 230, type: 'sine', dur: 0.32, vol: 0.1 });
    this.input.rumble(0.14, 0.08);
  }

  updateRotors(dt: number): void {
    for (const rotor of this.rotors) {
      rotor.angle += rotor.speed * dt;
      rotor.tickT = Math.max(0, rotor.tickT - dt);
      if (rotor.warn > 0) {
        rotor.warn = Math.max(0, rotor.warn - dt);
        continue;
      }
      if (rotor.tickT <= 0) {
        rotor.tickT = 0.46;
        this.audio.tone({ f: 290, f1: 210, type: 'triangle', dur: 0.045, vol: 0.028 });
      }
      for (let arm = 0; arm < rotor.arms; arm++) {
        const angle = rotor.angle + arm * PI2 / rotor.arms;
        const x1 = rotor.cx + Math.cos(angle) * rotor.inner;
        const y1 = rotor.cy + Math.sin(angle) * rotor.inner;
        const x2 = rotor.cx + Math.cos(angle) * rotor.length;
        const y2 = rotor.cy + Math.sin(angle) * rotor.length;
        if (distanceToSegment(this.blob.x, this.blob.y, x1, y1, x2, y2) < this.blob.r + rotor.width / 2) {
          this.blob.punch(0.35);
          this.die();
          return;
        }
      }
    }
  }

  updateEnemies(dt: number): void {
    const b = this.blob;
    const dashing = this.dashT > 0;
    for (const e of this.enemies) {
      if (e.dead) continue;
      if (e.kind === 'chaser') {
        const dx = b.x - e.x;
        const dy = b.y - e.y;
        const length = Math.hypot(dx, dy) || 1;
        e.vx = (e.vx || 0) + (dx / length) * 420 * dt;
        e.vy = (e.vy || 0) + (dy / length) * 420 * dt;
        const speed = Math.hypot(e.vx || 0, e.vy || 0);
        if (speed > (e.sp || 120)) {
          e.vx = (e.vx || 0) * (e.sp || 120) / speed;
          e.vy = (e.vy || 0) * (e.sp || 120) / speed;
        }
        e.x += (e.vx || 0) * dt;
        e.y += (e.vy || 0) * dt;
        e.rot = Math.atan2(e.vy || 0, e.vx || 0);
        const hitDistance = Math.hypot(b.x - e.x, b.y - e.y);
        if (dashing && hitDistance < e.r + b.r + 6) this.defeatEnemy(e);
        else if (hitDistance < e.r + b.r - 4) this.die();
      } else if (e.kind === 'mine') {
        e.arm = (e.arm || 0) - dt;
        e.pulse = (e.pulse || 0) + dt * 6;
        const contact = Math.hypot(b.x - e.x, b.y - e.y) < e.r + b.r + 3;
        if ((e.arm || 0) <= 0 || contact) {
          e.dead = true;
          this.mineBurst(e.x, e.y, contact && !dashing);
        }
      } else if (e.kind === 'gunner') {
        this.updateGunner(e, dt);
        if (Math.hypot(b.x - e.x, b.y - e.y) < e.r + b.r - 4) this.die();
      } else {
        this.updateBoss(e, dt, dashing);
      }
      if (this.state === 'over') return;
    }
    this.enemies = this.enemies.filter((e: SurvivalEnemy) => !e.dead);
  }

  updateGunner(e: SurvivalEnemy, dt: number): void {
    e.t = (e.t || 0) - dt;
    if (e.st === 'in') {
      if ((e.t || 0) <= 0) {
        e.st = 'aim';
        e.t = 0.45;
        e.ang = Math.atan2(this.blob.y - e.y, this.blob.x - e.x);
      }
    } else if (e.st === 'aim') {
      if ((e.t || 0) <= 0) {
        e.st = 'shoot';
        e.t = 0.9;
        e.burst = 3;
        e.bt = 0;
      }
    } else if (e.st === 'shoot') {
      e.bt = (e.bt || 0) - dt;
      if ((e.bt || 0) <= 0 && (e.burst || 0) > 0) {
        e.burst = (e.burst || 0) - 1;
        e.bt = 0.22;
        const angle = e.ang || 0;
        this.bullets.push({
          x: e.x + Math.cos(angle) * 20,
          y: e.y + Math.sin(angle) * 20,
          vx: Math.cos(angle) * (260 + this.wavePlan.difficulty * 32),
          vy: Math.sin(angle) * (260 + this.wavePlan.difficulty * 32),
          r: 6,
          color: '#ff5470',
        });
        this.audio.shoot();
        this.fx.ring(e.x + Math.cos(angle) * 20, e.y + Math.sin(angle) * 20, { r0: 4, r1: 20, color: '#38bdf8', life: 0.12, width: 2 });
      }
      if ((e.burst || 0) <= 0 && (e.t || 0) <= 0) {
        e.st = 'aim2';
        e.t = 0.48;
        e.ang = Math.atan2(this.blob.y - e.y, this.blob.x - e.x);
      }
    } else if (e.st === 'aim2') {
      if ((e.t || 0) <= 0) {
        if ((e.volley || 0) < 1 && this.wavePlan.difficulty > 0.28) {
          e.volley = (e.volley || 0) + 1;
          e.st = 'shoot';
          e.t = 0.9;
          e.burst = 2;
          e.bt = 0;
        } else {
          e.st = 'leave';
          e.t = 1;
          e.leaveA = e.ang || 0;
        }
      }
    } else if (e.st === 'leave') {
      e.x += Math.cos(e.leaveA || 0) * 160 * dt;
      e.y += Math.sin(e.leaveA || 0) * 160 * dt;
      if (e.x < -40 || e.x > 1320 || e.y < -40 || e.y > 760) e.dead = true;
    }
  }

  updateBoss(e: SurvivalEnemy, dt: number, dashing: boolean): void {
    e.phase = (e.phase || 0) + dt;
    e.hitT = Math.max(0, (e.hitT || 0) - dt);
    e.x = 640 + Math.sin(this.waveElapsed * 0.72) * 138;
    e.y = M + 110 + Math.sin(this.waveElapsed * 1.4) * 30;
    e.ang = Math.atan2(this.blob.y - e.y, this.blob.x - e.x);
    e.t = (e.t || 0) - dt;

    if ((e.t || 0) <= 0) {
      e.t = 2.45 - this.wavePlan.difficulty * 0.32;
      this.bossVolley(e);
    }

    const distance = Math.hypot(this.blob.x - e.x, this.blob.y - e.y);
    if (dashing && distance < e.r + this.blob.r + 10 && (e.hitT || 0) <= 0) {
      e.hitT = 0.28;
      e.hp = (e.hp || 1) - 1;
      this.score += 70;
      this.audio.hitEnemy();
      this.musicEvent('enemyKilled', 0.9);
      this.input.rumble(0.32, 0.08);
      this.fx.flash('#f472b6', 0.08);
      this.fx.ring(e.x, e.y, { r0: 18, r1: 74, color: '#ffffff', life: 0.2, width: 3 });
      this.fx.text(e.x, e.y - 52, 'NOYAU  -1', { color: '#ffffff', size: 15, mono: true });
      if ((e.hp || 0) <= 0) this.defeatBoss(e);
    } else if (distance < e.r + this.blob.r - 5) {
      this.die();
    }
  }

  bossVolley(e: SurvivalEnemy): void {
    const count = 7;
    const targetAngle = Math.atan2(this.blob.y - e.y, this.blob.x - e.x);
    const offset = this.waveElapsed * 0.6;
    for (let i = 0; i < count; i++) {
      const angle = offset + i * PI2 / count + (i === 0 ? targetAngle * 0.08 : 0);
      this.bullets.push({
        x: e.x + Math.cos(angle) * 40,
        y: e.y + Math.sin(angle) * 40,
        vx: Math.cos(angle) * (175 + this.wavePlan.difficulty * 22),
        vy: Math.sin(angle) * (175 + this.wavePlan.difficulty * 22),
        r: 6,
        color: '#f472b6',
      });
    }
    this.audio.thump(0.22, { f0: 125, f1: 70, dur: 0.16 });
    this.input.rumble(0.16, 0.06);
    this.fx.ring(e.x, e.y, { r0: 28, r1: 86, color: '#f472b6', life: 0.26, width: 3 });
  }

  defeatEnemy(e: SurvivalEnemy): void {
    e.dead = true;
    this.score += 25;
    this.musicEvent('enemyKilled', 0.7);
    this.boom(e.x, e.y, '#ff5470', 0.5);
    this.fx.text(e.x, e.y - 24, '+25', { color: '#ffd166', size: 20, mono: true });
  }

  defeatBoss(e: SurvivalEnemy): void {
    e.dead = true;
    this.score += 360;
    this.musicEvent('bossDefeated', 1);
    this.audio.perfect();
    this.input.rumble(0.85, 0.25);
    this.fx.flash('#f472b6', 0.2);
    this.fx.shake(0.55);
    this.fx.stop(0.06);
    this.fx.burst(e.x, e.y, { n: 54, speed: [80, 520], colors: ['#f472b6', '#ffffff', '#ffd166'], life: 0.9, shape: 'spark' });
    this.fx.ring(e.x, e.y, { r0: 22, r1: 210, color: '#f472b6', life: 0.7, width: 5 });
    this.fx.text(e.x, e.y - 54, 'VEILLEUR DÉTRUIT  +360', { color: '#ffd166', size: 20, mono: true });
  }

  mineBurst(x: number, y: number, hurtPlayer: boolean): void {
    this.boom(x, y, '#fb923c', 0.62);
    for (let i = 0; i < 8; i++) {
      const angle = i / 8 * PI2 + this.time * 0.12;
      this.bullets.push({ x, y, vx: Math.cos(angle) * 220, vy: Math.sin(angle) * 220, r: 5, color: '#fb923c' });
    }
    if (hurtPlayer) this.die();
  }

  updateBullets(dt: number): void {
    for (const bullet of this.bullets) {
      bullet.x += bullet.vx * dt;
      bullet.y += bullet.vy * dt;
      if (Math.hypot(this.blob.x - bullet.x, this.blob.y - bullet.y) < bullet.r + this.blob.r - 4) {
        bullet.dead = true;
        this.die();
        break;
      }
      if (bullet.x < -30 || bullet.x > 1310 || bullet.y < -30 || bullet.y > 750) bullet.dead = true;
    }
    this.bullets = this.bullets.filter((bullet: SurvivalBullet) => !bullet.dead);
  }

  updateResources(dt: number): void {
    if (!this.wavePlan.resources) return;

    this.resourceT -= dt;
    if (this.resourceT <= 0 && this.orbs.length < this.wavePlan.resourceTarget) {
      this.spawnResource();
      this.resourceT = Math.max(1.25, 2.1 - this.wavePlan.difficulty * 0.4);
    }

    for (const orb of this.orbs) {
      orb.t += dt;
      orb.life -= dt;
      if (orb.life <= 0) {
        orb.dead = true;
        continue;
      }
      if (Math.hypot(this.blob.x - orb.x, this.blob.y - orb.y) < this.blob.r + 16) this.collectResource(orb);
    }
    this.orbs = this.orbs.filter((orb: SurvivalOrb) => !orb.dead);
  }

  spawnResource(): void {
    const [x, y] = this.randomArenaPoint(125);
    const kind = Math.random() < this.wavePlan.bonusChance ? 'bonus' : 'resource';
    const color = kind === 'bonus' ? '#ffd166' : '#7df9ff';
    this.orbs.push({ x, y, t: Math.random() * 6, life: kind === 'bonus' ? 6.4 : 5.8, maxLife: kind === 'bonus' ? 6.4 : 5.8, kind });
    this.audio.tone({ f: kind === 'bonus' ? 920 : 680, f1: kind === 'bonus' ? 1320 : 920, type: 'triangle', dur: 0.12, vol: 0.07 });
    this.fx.ring(x, y, { r0: 8, r1: 32, color, life: 0.25, width: 2 });
  }

  collectResource(orb: SurvivalOrb): void {
    orb.dead = true;
    this.orbChainT = 2.4;
    this.coinStep += 1;
    const isBonus = orb.kind === 'bonus';
    const points = isBonus ? 125 : 50;
    this.score += points;
    this.musicEvent('powerUp', isBonus ? 0.85 : 0.5);
    if (isBonus) {
      this.bonusT = Math.max(this.bonusT, 5);
      this.dashCd = 0;
      this.audio.perfect();
      this.fx.flash('#ffd166', 0.12);
      this.input.rumble(0.42, 0.12);
      this.fx.text(orb.x, orb.y - 24, 'BONUS  +' + points, { color: '#ffd166', size: 18, mono: true });
    } else {
      this.audio.coin(this.coinStep);
      this.input.rumble(0.2, 0.06);
      this.fx.text(orb.x, orb.y - 20, '+' + points, { color: '#7df9ff', size: 18, mono: true });
    }
    this.fx.burst(orb.x, orb.y, { n: isBonus ? 22 : 10, speed: [50, 240], colors: [isBonus ? '#ffd166' : '#7df9ff', '#ffffff'], life: 0.45, shape: 'spark' });
    this.fx.ring(orb.x, orb.y, { r0: 8, r1: isBonus ? 68 : 48, color: isBonus ? '#ffd166' : '#7df9ff', life: 0.34, width: 3 });
  }

  updateThreatMeter(): void {
    let near = 1e9;
    for (const enemy of this.enemies) near = Math.min(near, Math.hypot(this.blob.x - enemy.x, this.blob.y - enemy.y) - enemy.r);
    for (const bullet of this.bullets) near = Math.min(near, Math.hypot(this.blob.x - bullet.x, this.blob.y - bullet.y) - bullet.r);
    for (const bar of this.bars) {
      if (bar.warn <= 0) near = Math.min(near, distanceToRect(this.blob.x, this.blob.y, bar.x, bar.y, bar.w, bar.h));
    }
    for (const rotor of this.rotors) {
      if (rotor.warn > 0) continue;
      for (let arm = 0; arm < rotor.arms; arm++) {
        const angle = rotor.angle + arm * PI2 / rotor.arms;
        near = Math.min(near, distanceToSegment(
          this.blob.x,
          this.blob.y,
          rotor.cx + Math.cos(angle) * rotor.inner,
          rotor.cy + Math.sin(angle) * rotor.inner,
          rotor.cx + Math.cos(angle) * rotor.length,
          rotor.cy + Math.sin(angle) * rotor.length,
        ));
      }
    }
    const wasScared = this.blob.scared;
    this.blob.scared = near < 110;
    if (this.blob.scared && !wasScared && this.nearCueT <= 0 && this.wavePhase === 'active') {
      this.nearCueT = 1.4;
      this.musicEvent('nearMiss', 0.2);
    }
  }

  audioWaveCue(): void {
    const now = this.audio.ctx?.currentTime || 0;
    const base = this.wavePlan.boss ? 150 : this.wavePlan.special ? 420 : 260;
    this.audio.tone({ f: base, f1: base * 0.82, type: 'triangle', t: now, dur: 0.13, vol: 0.11 });
    this.audio.tone({ f: base * 1.5, f1: base * 1.2, type: 'triangle', t: now + 0.1, dur: 0.16, vol: 0.1 });
    this.audio.tone({ f: base * 2, type: this.wavePlan.boss ? 'sawtooth' : 'square', t: now + 0.2, dur: this.wavePlan.boss ? 0.28 : 0.11, vol: this.wavePlan.boss ? 0.12 : 0.07 });
  }

  boom(x: number, y: number, color: string, power = 1): void {
    this.audio.explode(power);
    this.input.rumble(Math.min(1, 0.4 + power * 0.3), 0.15);
    this.fx.shake(0.3 + power * 0.2);
    this.fx.flash(color, Math.min(0.16, 0.04 + power * 0.05));
    this.fx.burst(x, y, { n: Math.round(16 * power), speed: [80, 420 * power], colors: [color, '#ffffff', '#ffd166'], size: [2, 5], life: 0.55, shape: 'spark' });
    this.fx.ring(x, y, { r0: 8, r1: 60 * power + 30, color, life: 0.32 });
    this.fx.stop(0.03);
  }

  die(): void {
    if (this.state === 'over') return;
    this.audio.hurt();
    this.boom(this.blob.x, this.blob.y, this.accent, 1.4);
    this.fx.flash('#ff5470', 0.28);
    this.blob.dead = true;
    this.over();
  }

  drawTelegraphs(ctx: CanvasRenderingContext2D): void {
    for (const tg of this.telegraphs) {
      const progress = 1 - tg.t / tg.maxT;
      const color = tg.type === 'chaser' ? '#ff5470'
        : tg.type === 'mine' ? '#fb923c'
          : tg.type === 'gunner' ? '#38bdf8' : '#f472b6';
      const blink = Math.sin((this.time + progress) * 30) > 0 ? 0.9 : 0.28;
      ctx.save();
      ctx.globalAlpha = blink;
      ctx.strokeStyle = color;
      ctx.lineWidth = tg.type === 'boss' ? 4 : 2.5;
      ctx.beginPath();
      ctx.arc(tg.x, tg.y, (tg.type === 'boss' ? 30 : 14) + progress * (tg.type === 'boss' ? 26 : 18), 0, PI2);
      ctx.stroke();
      if (tg.type === 'boss') {
        ctx.setLineDash([8, 8]);
        ctx.beginPath();
        ctx.arc(tg.x, tg.y, 52 + progress * 18, 0, PI2);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.beginPath();
        ctx.moveTo(tg.x - 6, tg.y); ctx.lineTo(tg.x + 6, tg.y);
        ctx.moveTo(tg.x, tg.y - 6); ctx.lineTo(tg.x, tg.y + 6);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  drawBars(ctx: CanvasRenderingContext2D): void {
    for (const bar of this.bars) {
      const warning = bar.warn > 0;
      const pulse = 0.5 + 0.5 * Math.sin(bar.phase * 3);
      const horizontal = bar.orientation === 'horizontal';
      const left = M;
      const right = M + AW;
      const top = M;
      const bottom = M + AH;
      const gapStart = bar.gapCenter - bar.gapSize / 2;
      const gapEnd = bar.gapCenter + bar.gapSize / 2;
      ctx.save();
      ctx.globalAlpha = warning ? 0.2 + pulse * 0.12 : 0.16;
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = warning ? 2 : 1;
      ctx.setLineDash([12, 12]);
      ctx.beginPath();
      if (horizontal) {
        ctx.moveTo(left, bar.y);
        ctx.lineTo(right, bar.y);
      } else {
        ctx.moveTo(bar.x, top);
        ctx.lineTo(bar.x, bottom);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.shadowColor = '#38bdf8';
      ctx.shadowBlur = warning ? 10 : 18;
      ctx.globalAlpha = warning ? 0.42 : 0.9;
      const gradient = horizontal
        ? ctx.createLinearGradient(0, bar.y - bar.h / 2, 0, bar.y + bar.h / 2)
        : ctx.createLinearGradient(bar.x - bar.w / 2, 0, bar.x + bar.w / 2, 0);
      gradient.addColorStop(0, '#075b7c');
      gradient.addColorStop(0.5, '#1298c4');
      gradient.addColorStop(1, '#075b7c');
      ctx.fillStyle = gradient;
      ctx.shadowBlur = 0;
      ctx.strokeStyle = warning ? '#bfe9ff' : '#38bdf8';
      ctx.lineWidth = 2;

      const drawSegment = (x: number, y: number, w: number, h: number): void => {
        if (w <= 0 || h <= 0) return;
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
        ctx.globalAlpha = warning ? 0.48 : 0.72;
        ctx.strokeStyle = '#bfe9ff';
        ctx.lineWidth = 2;
        const length = horizontal ? w : h;
        for (let offset = -24; offset < length; offset += 26) {
          ctx.beginPath();
          if (horizontal) {
            ctx.moveTo(x + offset, y);
            ctx.lineTo(x + offset + 16, y + h);
          } else {
            ctx.moveTo(x, y + offset);
            ctx.lineTo(x + w, y + offset + 16);
          }
          ctx.stroke();
        }
        ctx.globalAlpha = warning ? 0.42 : 0.9;
        ctx.strokeStyle = warning ? '#bfe9ff' : '#38bdf8';
        ctx.lineWidth = 2;
      };

      if (horizontal) {
        drawSegment(left, bar.y - bar.h / 2, gapStart - left, bar.h);
        drawSegment(gapEnd, bar.y - bar.h / 2, right - gapEnd, bar.h);
      } else {
        drawSegment(bar.x - bar.w / 2, top, bar.w, gapStart - top);
        drawSegment(bar.x - bar.w / 2, gapEnd, bar.w, bottom - gapEnd);
      }

      ctx.globalAlpha = warning ? 0.3 + pulse * 0.16 : 0.22;
      ctx.fillStyle = '#bfe9ff';
      if (horizontal) ctx.fillRect(gapStart, bar.y - bar.h / 2 - 9, bar.gapSize, bar.h + 18);
      else ctx.fillRect(bar.x - bar.w / 2 - 9, gapStart, bar.w + 18, bar.gapSize);

      ctx.globalAlpha = warning ? 0.66 : 0.88;
      ctx.strokeStyle = '#e5f7ff';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 8]);
      ctx.beginPath();
      if (horizontal) {
        ctx.moveTo(gapStart, bar.y - bar.h / 2 - 11);
        ctx.lineTo(gapStart, bar.y + bar.h / 2 + 11);
        ctx.moveTo(gapEnd, bar.y - bar.h / 2 - 11);
        ctx.lineTo(gapEnd, bar.y + bar.h / 2 + 11);
      } else {
        ctx.moveTo(bar.x - bar.w / 2 - 11, gapStart);
        ctx.lineTo(bar.x + bar.w / 2 + 11, gapStart);
        ctx.moveTo(bar.x - bar.w / 2 - 11, gapEnd);
        ctx.lineTo(bar.x + bar.w / 2 + 11, gapEnd);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      UI.txt(ctx, 'TROU', horizontal ? bar.gapCenter : bar.x + 18, horizontal ? bar.y - 18 : bar.gapCenter, {
        size: 9,
        align: horizontal ? 'center' : 'left',
        mono: true,
        color: '#e5f7ff',
        weight: 900,
      });
      ctx.restore();
    }
  }

  drawConfinement(ctx: CanvasRenderingContext2D): void {
    if (!this.wavePlan.confined || this.wavePhase !== 'active') return;
    const [cx, cy] = this.rotors[0] ? [this.rotors[0].cx, this.rotors[0].cy] : ARENA_CENTER;
    const radius = this.wavePlan.confinedRadius;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 5.5);
    ctx.save();
    ctx.globalAlpha = 0.045;
    ctx.fillStyle = '#fb923c';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, PI2);
    ctx.fill();
    ctx.globalAlpha = 0.04;
    ctx.beginPath();
    ctx.rect(M, M, AW, AH);
    ctx.arc(cx, cy, radius + 6, 0, PI2, true);
    ctx.fill('evenodd');
    ctx.globalAlpha = 0.54 + pulse * 0.12;
    ctx.strokeStyle = '#fb923c';
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 9]);
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, PI2);
    ctx.stroke();
    ctx.setLineDash([]);
    UI.txt(ctx, 'ZONE RESTREINTE', cx, cy + radius + 25, {
      size: 10,
      align: 'center',
      mono: true,
      color: '#fdba74',
      weight: 900,
    });
    ctx.restore();
  }

  drawRotors(ctx: CanvasRenderingContext2D): void {
    for (const rotor of this.rotors) {
      const warning = rotor.warn > 0;
      ctx.save();
      ctx.translate(rotor.cx, rotor.cy);
      ctx.rotate(rotor.angle);
      ctx.globalAlpha = warning ? 0.38 : 0.82;
      ctx.strokeStyle = '#fb923c';
      ctx.fillStyle = '#fb923c';
      ctx.lineWidth = rotor.width;
      ctx.lineCap = 'round';
      if (warning) ctx.setLineDash([12, 10]);
      for (let arm = 0; arm < rotor.arms; arm++) {
        ctx.save();
        ctx.rotate(arm * PI2 / rotor.arms);
        ctx.beginPath();
        ctx.moveTo(rotor.inner, 0);
        ctx.lineTo(rotor.length, 0);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(rotor.length, 0, rotor.width * 0.9, 0, PI2);
        ctx.fill();
        ctx.restore();
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = warning ? 0.5 : 0.9;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, rotor.inner - 10, 0, PI2);
      ctx.stroke();
      ctx.fillStyle = '#fb923c';
      ctx.beginPath();
      ctx.arc(0, 0, 10, 0, PI2);
      ctx.fill();
      ctx.globalAlpha = warning ? 0.35 : 0.68;
      ctx.strokeStyle = '#ffd6a5';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 8]);
      const spinStart = rotor.speed >= 0 ? -0.72 : Math.PI + 0.72;
      ctx.beginPath();
      ctx.arc(0, 0, rotor.length + 17, spinStart, spinStart + Math.PI * 0.72 * (rotor.speed >= 0 ? 1 : -1), rotor.speed < 0);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  drawResources(ctx: CanvasRenderingContext2D): void {
    for (const orb of this.orbs) {
      const color = orb.kind === 'bonus' ? '#ffd166' : '#7df9ff';
      const lifeK = clamp(orb.life / orb.maxLife, 0, 1);
      const radius = (orb.kind === 'bonus' ? 12 : 10) + Math.sin(orb.t * 4) * 2.5;
      ctx.save();
      ctx.globalAlpha = orb.life < 1 ? 0.35 + Math.sin(orb.t * 26) * 0.3 : 0.95;
      ctx.translate(orb.x, orb.y + Math.sin(orb.t * 3) * 4);
      ctx.rotate(orb.kind === 'bonus' ? orb.t * 1.5 : 0);
      ctx.shadowColor = color;
      ctx.shadowBlur = orb.kind === 'bonus' ? 24 : 16;
      ctx.fillStyle = color;
      if (orb.kind === 'bonus') {
        ctx.beginPath();
        ctx.moveTo(0, -radius);
        ctx.lineTo(radius, 0);
        ctx.lineTo(0, radius);
        ctx.lineTo(-radius, 0);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, PI2);
        ctx.fill();
        ctx.fillStyle = '#0b0e14';
        ctx.fillRect(-2, -radius * 0.55, 4, radius * 1.1);
        ctx.fillRect(-radius * 0.55, -2, radius * 1.1, 4);
      }
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 0.45 * lifeK;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, radius + 8 + (1 - lifeK) * 8, 0, PI2);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawBoss(ctx: CanvasRenderingContext2D, enemy: SurvivalEnemy): void {
    const hp = enemy.hp || 0;
    const maxHp = enemy.maxHp || 1;
    const hurt = (enemy.hitT || 0) > 0;
    ctx.save();
    ctx.translate(enemy.x, enemy.y);
    ctx.rotate((enemy.phase || 0) * 0.6);
    ctx.globalAlpha = hurt ? 1 : 0.9;
    ctx.shadowColor = '#f472b6';
    ctx.shadowBlur = hurt ? 34 : 22;
    ctx.fillStyle = hurt ? '#ffffff' : '#f472b6';
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const angle = i / 8 * PI2;
      const radius = i % 2 ? enemy.r * 0.72 : enemy.r;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#35152a';
    ctx.beginPath();
    ctx.arc(0, 0, 12, 0, PI2);
    ctx.fill();
    ctx.strokeStyle = '#ffffffaa';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 16, -Math.PI / 2, -Math.PI / 2 + PI2 * hp / maxHp);
    ctx.stroke();
    ctx.restore();

    const barW = 96;
    ctx.fillStyle = '#1a1020';
    ctx.fillRect(enemy.x - barW / 2, enemy.y - enemy.r - 18, barW, 5);
    ctx.fillStyle = '#f472b6';
    ctx.fillRect(enemy.x - barW / 2, enemy.y - enemy.r - 18, barW * hp / maxHp, 5);
  }

  drawSpecialField(ctx: CanvasRenderingContext2D): void {
    if (!this.wavePlan.special || this.wavePhase !== 'active') return;
    const active = this.specialActive;
    const warning = this.specialWarning;
    ctx.save();
    ctx.globalAlpha = active ? 0.16 : warning ? 0.08 : 0.035;
    const gradient = ctx.createRadialGradient(640, 360, 40, 640, 360, 430);
    gradient.addColorStop(0, '#a78bfa');
    gradient.addColorStop(0.54, '#7c3aed44');
    gradient.addColorStop(1, '#7c3aed00');
    ctx.fillStyle = gradient;
    ctx.fillRect(M, M, AW, AH);
    ctx.globalAlpha = active ? 0.6 : warning ? 0.38 : 0.16;
    ctx.strokeStyle = '#c4b5fd';
    ctx.lineWidth = active ? 3 : 1.5;
    for (let i = 0; i < 4; i++) {
      const radius = 100 + i * 58 + Math.sin(this.time * 3 + i) * 9;
      ctx.beginPath();
      ctx.arc(640, 360, radius, 0, PI2);
      ctx.stroke();
    }
    ctx.restore();
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#07110d';
    ctx.fillRect(0, 0, 1280, 720);

    this.fx.world(ctx);

    ctx.fillStyle = this.wavePlan.color + '08';
    ctx.fillRect(M, M, AW, AH);
    ctx.strokeStyle = this.wavePlan.color + '66';
    ctx.lineWidth = this.wavePlan.boss ? 3 : 2;
    UI.roundRect(ctx, M, M, AW, AH, 24);
    ctx.stroke();
    UI.grid(ctx, { gap: 80, off: this.time * 24, offY: this.time * 12, alpha: 0.04, color: this.wavePlan.color });

    this.drawSpecialField(ctx);
    this.drawBars(ctx);
    this.drawConfinement(ctx);
    this.drawRotors(ctx);
    this.drawTelegraphs(ctx);
    this.drawResources(ctx);

    for (const enemy of this.enemies) {
      if (enemy.kind === 'chaser') {
        ctx.save();
        ctx.translate(enemy.x, enemy.y);
        ctx.rotate(enemy.rot || 0);
        ctx.shadowColor = '#ff5470';
        ctx.shadowBlur = 12;
        ctx.fillStyle = '#ff5470';
        ctx.beginPath();
        ctx.moveTo(16, 0); ctx.lineTo(-11, 10); ctx.lineTo(-11, -10);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else if (enemy.kind === 'mine') {
        const armed = (enemy.arm || 0) < 0.8;
        const blink = armed && Math.sin((enemy.pulse || 0) * 3) > 0;
        ctx.save();
        ctx.globalAlpha = blink ? 1 : 0.85;
        ctx.strokeStyle = blink ? '#ffffff' : '#fb923c';
        ctx.fillStyle = blink ? '#fb923c' : '#fb923c55';
        ctx.lineWidth = 2.5;
        ctx.shadowColor = '#fb923c';
        ctx.shadowBlur = armed ? 20 : 9;
        ctx.beginPath();
        ctx.arc(enemy.x, enemy.y, enemy.r, 0, PI2);
        ctx.fill();
        ctx.stroke();
        ctx.shadowBlur = 0;
        for (let i = 0; i < 8; i++) {
          const angle = i / 8 * PI2 + (enemy.pulse || 0) * 0.4;
          ctx.beginPath();
          ctx.moveTo(enemy.x + Math.cos(angle) * (enemy.r + 2), enemy.y + Math.sin(angle) * (enemy.r + 2));
          ctx.lineTo(enemy.x + Math.cos(angle) * (enemy.r + 8), enemy.y + Math.sin(angle) * (enemy.r + 8));
          ctx.stroke();
        }
        ctx.restore();
      } else if (enemy.kind === 'gunner') {
        const aiming = enemy.st === 'aim' || enemy.st === 'aim2';
        if (aiming) {
          ctx.save();
          ctx.globalAlpha = 0.3 + 0.3 * Math.sin(this.time * 40);
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([10, 8]);
          ctx.beginPath();
          ctx.moveTo(enemy.x, enemy.y);
          ctx.lineTo(enemy.x + Math.cos(enemy.ang || 0) * 900, enemy.y + Math.sin(enemy.ang || 0) * 900);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();
        }
        ctx.save();
        ctx.translate(enemy.x, enemy.y);
        ctx.rotate(enemy.ang || 0);
        ctx.shadowColor = '#38bdf8';
        ctx.shadowBlur = 13;
        ctx.fillStyle = aiming ? '#bfe9ff' : '#38bdf8';
        ctx.fillRect(-13, -13, 26, 26);
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#0b0e14';
        ctx.fillRect(10, -3, 10, 6);
        ctx.restore();
      } else {
        this.drawBoss(ctx, enemy);
      }
    }

    ctx.shadowColor = '#ff8896';
    ctx.shadowBlur = 8;
    for (const bullet of this.bullets) {
      ctx.fillStyle = bullet.color || '#ff5470';
      ctx.beginPath();
      ctx.arc(bullet.x, bullet.y, bullet.r, 0, PI2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;

    if (this.dashCd > 0 && this.state === 'play') {
      ctx.strokeStyle = '#ffffff55';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(this.blob.x, this.blob.y, this.blob.r + 9, -Math.PI / 2, -Math.PI / 2 + (1 - this.dashCd / (0.85 * (this.bonusT > 0 ? 0.64 : 1))) * PI2);
      ctx.stroke();
    }

    this.blob.render(ctx);
    this.fx.drawWorld(ctx);
    this.fx.endWorld(ctx);

    UI.drawHUD(ctx, {
      accent: this.accent,
      score: this.score,
      time: this.time,
      extra: () => {
        UI.txt(ctx, 'VAGUE ' + this.wave, 28, 88, { size: 13, color: this.wavePlan.color, mono: true });
        UI.txt(ctx, this.wavePhase === 'active' ? this.wavePlan.title : 'PRÉPARATION', 28, 106, { size: 11, color: '#7c8698' });
        UI.txt(ctx, 'DASH: A', 28, 124, { size: 11, color: '#7c8698' });
      },
    });
    this.drawWaveHud(ctx);
    this.drawWaveFeedback(ctx);
    this.drawPreparation(ctx);
    this.drawBonusFeedback(ctx);
    this.drawCommon(ctx);
  }

  drawWaveHud(ctx: CanvasRenderingContext2D): void {
    const x = 448;
    const y = 14;
    const w = 384;
    const h = 54;
    UI.panel(ctx, x, y, w, h, { radius: 14, fill: '#07110dcc', stroke: this.wavePlan.color + '55', lineWidth: 1.5 });
    UI.txt(ctx, 'VAGUE ' + this.wave, x + 18, y + 22, { size: 15, mono: true, color: this.wavePlan.color, weight: 900 });
    UI.txt(ctx, this.wavePlan.title, x + w - 18, y + 22, { size: 13, align: 'right', color: '#e8ecf2', weight: 800 });
    const progress = this.wavePhase === 'active'
      ? clamp(this.waveElapsed / this.wavePlan.duration, 0, 1)
      : 1 - clamp(this.wavePhaseT / this.wavePlan.prepDuration, 0, 1);
    ctx.fillStyle = '#152029';
    ctx.fillRect(x + 18, y + 35, w - 36, 5);
    ctx.fillStyle = this.wavePlan.color;
    ctx.fillRect(x + 18, y + 35, (w - 36) * progress, 5);
  }

  drawWaveFeedback(ctx: CanvasRenderingContext2D): void {
    if (this.wavePhase !== 'active' || this.waveBannerT <= 0) return;
    const alpha = clamp(this.waveBannerT / 0.55, 0, 1);
    ctx.save();
    ctx.globalAlpha = Math.min(1, alpha);
    UI.panel(ctx, 390, 105, 500, 72, { radius: 22, fill: '#07110de6', stroke: this.wavePlan.color + '88', lineWidth: 2 });
    UI.txt(ctx, 'VAGUE ' + this.wave, 640, 134, { size: 25, align: 'center', color: this.wavePlan.color, mono: true, weight: 900, shadow: true });
    UI.txt(ctx, this.wavePlan.subtitle, 640, 157, { size: 12, align: 'center', color: '#c3cbd8' });
    ctx.restore();
  }

  drawPreparation(ctx: CanvasRenderingContext2D): void {
    if (this.wavePhase !== 'prep') {
      if (this.wavePlan.special && this.specialWarning) {
        UI.panel(ctx, 465, 604, 350, 42, { radius: 21, fill: '#17112be8', stroke: '#a78bfa99', lineWidth: 1.5 });
        UI.txt(ctx, 'INVERSION IMMINENTE', 640, 631, { size: 14, align: 'center', mono: true, color: '#c4b5fd', weight: 900 });
      } else if (this.wavePlan.special && this.specialActive) {
        UI.panel(ctx, 430, 596, 420, 50, { radius: 25, fill: '#17112bf0', stroke: '#c4b5fd', lineWidth: 2 });
        UI.txt(ctx, 'CONTRÔLES INVERSÉS', 640, 628, { size: 17, align: 'center', mono: true, color: '#ffffff', weight: 900, shadow: true });
      }
      return;
    }

    ctx.save();
    ctx.fillStyle = this.wavePlan.color + '12';
    ctx.fillRect(M, M, AW, AH);
    UI.panel(ctx, 330, 218, 620, 282, { radius: 28, fill: '#07110df2', stroke: this.wavePlan.color + '88', lineWidth: 2 });
    UI.txt(ctx, 'PROCHAINE VAGUE', 640, 268, { size: 15, align: 'center', color: '#8b95a8', mono: true, weight: 800 });
    UI.txt(ctx, 'VAGUE ' + this.wave, 640, 328, { size: 48, align: 'center', color: this.wavePlan.color, mono: true, weight: 900, shadow: true });
    UI.txt(ctx, this.wavePlan.title, 640, 367, { size: 22, align: 'center', color: '#e8ecf2', weight: 900 });
    UI.txt(ctx, this.wavePlan.subtitle, 640, 399, { size: 14, align: 'center', color: '#c3cbd8' });
    UI.txt(ctx, String(Math.max(1, Math.ceil(this.wavePhaseT))), 640, 465, { size: 48, align: 'center', color: '#ffffff', mono: true, weight: 900 });
    UI.txt(ctx, 'PLACE-TOI · LA VAGUE EST LIMITÉE DANS LE TEMPS', 640, 487, { size: 11, align: 'center', color: '#7c8698', mono: true });
    ctx.restore();
  }

  drawBonusFeedback(ctx: CanvasRenderingContext2D): void {
    if (this.lastBonusT <= 0) return;
    const alpha = clamp(this.lastBonusT / 0.45, 0, 1);
    ctx.save();
    ctx.globalAlpha = alpha;
    UI.panel(ctx, 455, 185, 370, 40, { radius: 20, fill: '#07110de8', stroke: '#ffd16688', lineWidth: 1.5 });
    UI.txt(ctx, this.lastBonus, 640, 211, { size: 14, align: 'center', color: '#ffd166', mono: true, weight: 900 });
    ctx.restore();
  }
}
