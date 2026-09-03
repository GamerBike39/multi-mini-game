// BLOB RUN — auto-runner : saut variable (maintien), coyote time, buffer de saut,
// plateformes flottantes, duck pour passer sous les barres, scies.
// Le saut variable vit dans js/core/jump.ts (RUNNER_JUMP) pour être réutilisé
// par les futurs jeux de plateforme ; ce fichier ne garde que la pose.

import { BaseGame } from '../core/game';
import * as UI from '../core/ui';
import type { EngineLike, GameMeta } from '../core/types';
import { SeededRng } from '../core/rng';
import { ObjectPool } from '../core/pool';
import {
  RUNNER_JUMP,
  advanceJumpAir,
  applyJumpCut,
  armCoyote,
  createJumpState,
  decayJumpTimers,
  jumpGravity,
  landJump,
  launchJump,
  pressJumpButton,
  releaseJump,
  tryLaunch,
} from '../core/jump';

const GY = 600;           // sol
const PX = 320;           // x écran du joueur
const JUMP_POSE_RELAX_TIME = 0.27;
const RUNNER_BPM = 138;

type RunnerObstacleType = 'spike' | 'block' | 'platform' | 'bar' | 'ceiling' | 'saw' | 'gap';

interface RunnerObstacle {
  type: RunnerObstacleType;
  x: number;
  y?: number;
  w?: number;
  h?: number;
  r?: number;
  base?: number;
  ang?: number;
  minClearance?: number;
  nearAwarded?: boolean;
}

interface RunnerSpeedLine {
  x: number;
  y: number;
  length: number;
  depth: number;
}

export class RunnerGame extends BaseGame {
  [key: string]: any;
  readonly obstaclePool = new ObjectPool<RunnerObstacle>(() => ({ type: 'spike', x: 0 }), 48);
  static meta: GameMeta = {
    id: 'run', name: 'BLOB RUN', accent: '#a3e635', mood: 'runner',
    desc: 'Saute. Baisse-toi. Vite.', controls: 'A sauter · A en l’air = double saut · B duck',
    keys: "Espace / K",
    hint: 'A = tapote pour un saut court, maintiens pour sauter haut · A en l’air = double saut · B = se baisser',
    unit: 'pts', ranks: [900, 550, 320, 150, 0],
  };

  constructor(engine: EngineLike) {
    super(engine);
    this.seed = this.session.seed;
    this.visualRng = new SeededRng(this.session.seed ^ 0x56495355);
    this.blob.x = PX; this.blob.y = GY - 22; this.blob.r = 22;
    // La traînée générique suit les positions d'écran du blob. Comme le
    // runner le maintient sur un axe fixe, elle devenait une colonne verticale
    // et déraillait visuellement pendant le duck.
    this.blob.trailOn = false;
    this.blob.speedMorph = 0.48;
    this.vy = 0;
    this.onGround = true;
    this.jump = createJumpState();
    this.duck = 0;           // 0..1
    this.speed = 380;
    this.dist = 0;
    this.obs = this.obstaclePool.active;
    this.spawnGap = 500;
    this.milestone = 250;
    this.patternHistory = [] as string[];
    this.bonusScore = 0;
    this.combo = 0;
    this.comboT = 0;
    this.proxT = 0;
    this.nearMisses = 0;
    this.eaten = 0;
    this.bgDots = [];
    for (let i = 0; i < 40; i++) this.bgDots.push({ x: this.visualUnit() * 1280, y: this.visualUnit() * 560, z: 0.2 + this.visualUnit() * 0.6 });
    this.speedLines = [] as RunnerSpeedLine[];
    for (let i = 0; i < 13; i++) {
      this.speedLines.push({
        x: this.visualUnit() * 1480 - 80,
        y: 150 + this.visualUnit() * 360,
        length: 22 + this.visualUnit() * 48,
        depth: 0.25 + this.visualUnit() * 0.75,
      });
    }
    this.tickOff = 0;
  }

  meters(): number { return this.dist / 45; }
  r(): number { return 22 - this.duck * 9; }
  difficulty(): number { return Math.max(0, Math.min(1, (this.meters() - 70) / 520)); }
  beatDistance(): number { return Math.max(132, Math.min(205, this.speed * 60 / RUNNER_BPM)); }
  speedFactor(): number { return Math.max(0, Math.min(1, (this.speed - 380) / 400)); }
  totalScore(): number { return this.meters() + this.bonusScore; }

  randomUnit(): number {
    return this.rng.next();
  }

  visualUnit(): number {
    return this.visualRng.next();
  }

  choosePattern(pool: string[]): string {
    const recent = this.patternHistory.slice(-2);
    const available = pool.filter((pattern) => !recent.includes(pattern));
    const source = available.length ? available : pool;
    const pattern = source[Math.floor(this.randomUnit() * source.length)] ?? 's1';
    this.patternHistory.push(pattern);
    if (this.patternHistory.length > 8) this.patternHistory.shift();
    return pattern;
  }

  update(dt: number): void {
    if (this.baseUpdate(dt)) return;
    const b = this.blob, I = this.input;

    this.speed = Math.min(780, 380 + this.meters() * 1.15);
    this.dist += this.speed * dt;
    this.comboT = Math.max(0, this.comboT - dt);
    if (this.comboT <= 0) {
      this.combo = 0;
      this.eaten = 0;
    }
    this.proxT = Math.max(0, this.proxT - dt * 2.8);
    this.score = this.totalScore();

    // duck
    const wasGround = this.onGround;
    const previousRadius = b.r;
    const wantDuck = I.down('b') && wasGround;
    this.duck += ((wantDuck ? 1 : 0) - this.duck) * Math.min(1, dt * 18);
    b.r = this.r();

    // Keep the feet on the same surface while the visual body changes size.
    // Otherwise the smaller radius briefly floats above the floor, toggles
    // onGround off, and makes the duck animation oscillate.
    if (wasGround && this.vy === 0) b.y += previousRadius - b.r;

    // Saut variable (js/core/jump.ts) : le tap coupe la montée, le maintien
    // prolonge la fenêtre de faible gravité. Chaque durée d'appui produit
    // une hauteur clairement différente.
    if (I.pressed('a')) pressJumpButton(this.jump, RUNNER_JUMP);
    decayJumpTimers(this.jump, dt);
    let launched = false;
    const kind = tryLaunch(this.jump, RUNNER_JUMP, this.onGround);
    if (kind) {
      this.startJump(kind === 'air');
      launched = true;
    }

    if (!this.onGround) {
      advanceJumpAir(this.jump, dt);
      releaseJump(this.jump, I.down('a'));
    }

    // Gravité en trois temps : montée retenue, montée relâchée, chute lourde.
    // Le temps minimum évite qu'un appui très bref ne devienne un faux saut.
    this.vy = applyJumpCut(this.jump, RUNNER_JUMP, this.vy);
    let g = jumpGravity(this.jump, RUNNER_JUMP, this.vy, I.down('a'), I.down('b') && !this.onGround);

    const prevFeet = b.y + b.r;
    this.vy += g * dt;
    b.y += this.vy * dt;

    // Supports : sol, fossés, blocs et plateformes. Les plateformes sont
    // traversables par-dessous et ne captent le blob qu'en descente.
    this.onGround = false;
    let supportY = Number.POSITIVE_INFINITY;
    if (this.floorOpenAtPlayer()) {
      if (b.y + b.r >= GY) supportY = GY;
    }
    for (const o of this.obs) {
      if (o.type !== 'block' && o.type !== 'platform') continue;
      const oy = o.y ?? GY - (o.h ?? 0);
      const ow = o.w ?? 0;
      if (PX + b.r * 0.7 < o.x || PX - b.r * 0.7 > o.x + ow) continue;
      const feet = b.y + b.r;
      if (this.vy >= 0 && prevFeet <= oy + 6 && feet >= oy && oy < supportY) {
        supportY = oy;
      }
    }
    this.onGround = Number.isFinite(supportY);
    if (this.onGround) {
      b.y = supportY - b.r;
      if (!wasGround && !launched && this.vy > 260) {
        // atterrissage marqué
        b.punch(0.45);
        this.audio.land();
        this.input.rumble(0.22, 0.05);
        this.fx.shake(0.12);
        this.fx.burst(PX, supportY, { n: 8, speed: [50, 220], colors: ['#8fa3ad', '#d7e3ea'], size: [2, 4], life: 0.4, ang: -Math.PI / 2, spread: 2.6 });
      }
      this.vy = 0;
      landJump(this.jump);
    } else if (wasGround && !launched) {
      armCoyote(this.jump, RUNNER_JUMP);
    }

    // Un fossé se termine par une chute, pas par une collision artificielle.
    if (b.y - b.r > this.H + 80) return this.die();

    // défilement obstacles
    for (const o of this.obs) {
      o.x -= this.speed * dt;
      if (o.type === 'saw') { o.x -= 115 * dt; o.ang += dt * 9; }
    }
    for (let i = this.obstaclePool.active.length - 1; i >= 0; i--) {
      const obstacle = this.obstaclePool.active[i];
      if (obstacle.x + (obstacle.w || 60) <= -80) this.obstaclePool.releaseAt(i);
    }

    // spawn
    this.spawnGap -= this.speed * dt;
    if (this.spawnGap <= 0) this.spawnPattern();

    // collisions
    if (this.state === 'play') this.checkHits();
    if (this.state === 'play') this.updateNearMisses();

    // jalons
    if (this.meters() >= this.milestone) {
      this.fx.text(640, 240, Math.floor(this.meters()) + ' m !', { color: this.accent, size: 30 });
      this.audio.milestone();
      this.musicEvent('waveComplete', 0.35);
      this.fx.flash(this.accent, 0.06);
      this.milestone += 250;
    }

    // fond
    for (const d of this.bgDots) {
      d.x -= this.speed * (0.15 + d.z * 0.35) * dt;
      if (d.x < -4) { d.x = 1284; d.y = Math.random() * 560; }
    }
    for (const line of this.speedLines as RunnerSpeedLine[]) {
      line.x -= this.speed * (0.42 + line.depth * 0.58) * dt;
      if (line.x < -line.length - 30) line.x = 1280 + line.depth * 150;
    }
    this.tickOff = (this.tickOff + this.speed * dt) % 80;

    b.vx = this.speed;
    b.vy = this.vy;
    b.scared = this.proxT > 0.7;
    this.updateBlobPose(dt);
    b.update(dt);

    this.fx.zoom = 1 - Math.min(0.14, Math.max(0, (this.speed - 400) * 0.00035));
  }

  private startJump(doubleJump: boolean): void {
    const b = this.blob;
    const previousRadius = b.r;
    const wasGround = this.onGround;

    launchJump(this.jump, doubleJump, RUNNER_JUMP.maxJumps);
    this.onGround = false;
    this.duck = 0;
    b.r = this.r();
    if (wasGround) b.y += previousRadius - b.r;

    this.vy = -RUNNER_JUMP.jumpSpeed;
    this.audio.jump();
    this.input.rumble(doubleJump ? 0.24 : 0.18, 0.05);
    this.fx.burst(PX, b.y + b.r, {
      n: doubleJump ? 8 : 6,
      speed: doubleJump ? [60, 210] : [40, 160],
      colors: doubleJump ? ['#8ee3ff', '#d7f7ff'] : ['#8fa3ad', '#d7e3ea'],
      size: [2, 4],
      life: doubleJump ? 0.4 : 0.35,
      ang: Math.PI / 2,
      spread: 2.4,
    });
  }

  floorOpenAtPlayer(): boolean {
    const halfWidth = this.blob.r * 0.55;
    return !this.obs.some((o: RunnerObstacle) => o.type === 'gap'
      && PX + halfWidth > o.x
      && PX - halfWidth < o.x + (o.w ?? 0));
  }

  updateBlobPose(dt = 0): void {
    const duck = Math.min(1, this.duck * 1.12);
    const duckEase = duck * duck * (3 - 2 * duck);
    const jumpT = this.onGround ? JUMP_POSE_RELAX_TIME : Math.min(JUMP_POSE_RELAX_TIME, this.jump.jumpT);
    const jumpProgress = Math.max(0, Math.min(1, jumpT / JUMP_POSE_RELAX_TIME));
    const jumpCompression = 1 - jumpProgress * jumpProgress * (3 - 2 * jumpProgress);

    // Le duck devient une flaque compacte ; au décollage la même logique de
    // squash est très brève puis se détend naturellement pendant la montée.
    const scaleX = 1 + duckEase * 0.42 + jumpCompression * 0.32;
    const scaleY = Math.max(0.42, 1 - duckEase * 0.48 - jumpCompression * 0.30);
    const liquid = Math.min(1, duckEase * 0.95 + jumpCompression * 0.08);
    // Quand il est au sol, on décale le centre visuel pour que la flaque reste
    // collée à la ligne de sol malgré sa compression graphique.
    // Blob ajoute aussi un squash lié à sa vitesse et à son impact. On en
    // tient compte ici pour que le bas du contour reste réellement posé sur
    // le support, même pendant le duck.
    const motionK = Math.min(1, Math.hypot(this.blob.vx, this.blob.vy) / 620 * this.blob.speedMorph);
    const renderJig = Math.max(0, this.blob.jig - dt * 4.5);
    const motionScaleY = 1 - motionK * 0.18 - renderJig * 0.35;
    const groundOffset = this.onGround ? this.blob.r * (1 - motionScaleY * scaleY) : 0;
    this.blob.setPose(scaleX, scaleY, liquid, groundOffset);
  }

  obstacleWidth(o: RunnerObstacle): number {
    return o.w ?? (o.r ? o.r * 2 : 60);
  }

  obstacleClearance(o: RunnerObstacle): number | null {
    const r = this.blob.r;
    if (o.type === 'spike') {
      const base = o.base ?? 0;
      const ow = o.w ?? 36;
      const oh = o.h ?? 36;
      const cx = o.x + ow / 2;
      const bx = cx - ow * 0.22;
      const by = GY - base - oh * 0.62;
      return this.distanceToRect(PX, this.blob.y, bx, by, ow * 0.44, oh * 0.62) - r * 0.82;
    }
    if (o.type === 'bar' || o.type === 'ceiling') {
      return this.distanceToRect(PX, this.blob.y, o.x, o.y ?? GY, o.w ?? 0, o.h ?? 0) - r * 0.9;
    }
    if (o.type === 'saw') {
      return Math.hypot(PX - o.x, this.blob.y - (o.y ?? GY)) - r * 0.9 - (o.r ?? 17) * 0.85;
    }
    return null;
  }

  updateNearMisses(): void {
    const limit = 52 + this.difficulty() * 18;
    for (const o of this.obs) {
      if (o.type !== 'spike' && o.type !== 'bar' && o.type !== 'ceiling' && o.type !== 'saw') continue;
      const width = this.obstacleWidth(o);
      const clearance = this.obstacleClearance(o);
      if (clearance === null) continue;

      if (o.x < PX + 160 && o.x + width > PX - 110) {
        o.minClearance = Math.min(o.minClearance ?? Number.POSITIVE_INFINITY, clearance);
        const sensor = 1 - Math.max(0, Math.min(1, clearance / 86));
        this.proxT = Math.max(this.proxT, sensor);
      }

      if (!o.nearAwarded && o.x + width < PX - 18) {
        o.nearAwarded = true;
        const minClearance = o.minClearance ?? Number.POSITIVE_INFINITY;
        if (minClearance >= 4 && minClearance < limit) this.rewardNearMiss(minClearance, limit);
      }
    }
  }

  rewardNearMiss(clearance: number, limit: number): void {
    const risk = Math.max(0, Math.min(1, 1 - clearance / limit));
    this.combo = Math.min(8, this.combo + 1);
    this.comboT = 2.6;
    this.eaten = this.combo;
    const reward = Math.round((24 + risk * 56) * (1 + (this.combo - 1) * 0.16));
    this.bonusScore += reward;
    this.score = this.totalScore();
    this.nearMisses += 1;
    this.proxT = Math.max(this.proxT, 0.95);

    this.audio.coin(this.combo - 1);
    if (risk > 0.72) this.audio.perfect();
    else this.audio.good();
    this.musicEvent('nearMiss', 0.3 + risk * 0.7);
    this.input.rumble(0.1 + risk * 0.18, 0.04);
    this.fx.stop(0.025);
    this.fx.flash(this.accent, 0.08 + risk * 0.08);
    this.fx.ring(PX, this.blob.y, { r0: this.blob.r + 8, r1: this.blob.r + 46 + risk * 20, color: risk > 0.72 ? '#f2c94c' : this.accent, life: 0.28, width: 2.5 });
    this.fx.burst(PX, this.blob.y, { n: 6, speed: [40, 150], colors: [this.accent, '#f2c94c'], size: [2, 4], life: 0.28 });
    this.fx.text(PX, Math.max(150, this.blob.y - 44), '+' + reward + '  NEAR x' + this.combo, {
      color: risk > 0.72 ? '#f2c94c' : this.accent,
      size: 18,
      life: 0.8,
      vy: -38,
      mono: true,
    });
  }

  renderSpeedStreaks(ctx: CanvasRenderingContext2D, speedFactor: number): void {
    if (speedFactor <= 0.02) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const line of this.speedLines as RunnerSpeedLine[]) {
      const length = line.length * (0.18 + speedFactor * 0.78);
      ctx.globalAlpha = (0.018 + speedFactor * 0.085) * (0.45 + line.depth * 0.55);
      ctx.strokeStyle = line.depth > 0.7 ? '#d9ff8a' : '#8fbf76';
      ctx.lineWidth = 0.7 + speedFactor * (0.6 + line.depth * 0.7);
      ctx.beginPath();
      // Le point y reste fixe : les traits défilent horizontalement et ne
      // donnent plus l'impression de tomber dans le décor.
      ctx.moveTo(line.x - length, line.y);
      ctx.lineTo(line.x, line.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  renderBlobStreaks(ctx: CanvasRenderingContext2D, speedFactor: number): void {
    if (speedFactor <= 0.02) return;
    const bodyHeight = Math.max(8, this.blob.r * this.blob.poseY);
    const centerY = this.blob.y + this.blob.poseOffsetY;
    const maxLength = 12 + speedFactor * 30;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const depth = i / 3;
      const length = maxLength * (1 - depth * 0.5);
      ctx.globalAlpha = (0.035 + speedFactor * 0.11) * (1 - depth * 0.65);
      ctx.strokeStyle = i === 0 ? '#d9ff8a' : this.accent;
      ctx.lineWidth = Math.max(1, bodyHeight * (0.1 - depth * 0.018));
      const y = centerY + (i - 1) * bodyHeight * 0.34;
      ctx.beginPath();
      ctx.moveTo(PX - this.blob.r * 0.18 - length, y);
      ctx.lineTo(PX - this.blob.r * 0.18, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  spawnPattern(): void {
    const m = this.meters();
    const difficulty = this.difficulty();
    const pool: string[] = [];
    pool.push('s1');
    if (m > 90) pool.push('s2', 'block');
    if (m > 130) pool.push('shortHop', 'gapShort', 'platformRun');
    if (m > 170) pool.push('duckTunnel');
    if (m > 230) pool.push('s3', 'bar', 'saw', 'blockSpike', 'gapLong', 'rhythm');
    if (m > 340) pool.push('platformGap', 'zigzag');
    if (m > 460) pool.push('combo1', 'combo2', 'stairs', 'ceilingGap', 'gapStep', 'platformChain');
    if (difficulty > 0.72) pool.push('rhythm', 'duckTunnel', 'platformGap');
    const p = this.choosePattern(pool);
    const startX = 1340;
    const beat = this.beatDistance();
    let endX = startX;
    const place = (o: Omit<RunnerObstacle, 'x'>, at = endX): void => {
      const obstacle = this.obstaclePool.acquire();
      obstacle.type = o.type;
      obstacle.x = at;
      obstacle.y = undefined;
      obstacle.w = undefined;
      obstacle.h = undefined;
      obstacle.r = undefined;
      obstacle.base = undefined;
      obstacle.ang = undefined;
      obstacle.minClearance = undefined;
      obstacle.nearAwarded = false;
      Object.assign(obstacle, o);
      if (obstacle.type === 'block') obstacle.y = GY - (obstacle.h ?? 0);
      const footprint = obstacle.type === 'saw' ? (obstacle.r ?? 17) : (obstacle.w ?? (obstacle.r ? obstacle.r * 2 : 60));
      endX = Math.max(endX, at + footprint);
    };
    const placeSaw = (at: number): void => {
      place({ type: 'saw', y: GY - 17, r: 17, ang: 0 }, at);
      endX = Math.max(endX, at + 17);
    };

    if (p === 's1') place({ type: 'spike', w: 36, h: 36 });
    else if (p === 's2') {
      place({ type: 'spike', w: 36, h: 36 });
      place({ type: 'spike', w: 36, h: 36 }, startX + Math.round(beat * 0.74));
    }
    else if (p === 's3') {
      for (let i = 0; i < 3; i++) place({ type: 'spike', w: 36, h: 36 }, startX + Math.round(i * beat * 0.68));
    }
    else if (p === 'block') place({ type: 'block', w: 60, h: 60 });
    else if (p === 'stairs') {
      place({ type: 'block', w: 60, h: 60 });
      place({ type: 'block', w: 60, h: 120 }, startX + Math.max(90, Math.round(beat * 0.55)));
    } else if (p === 'blockSpike') {
      place({ type: 'block', w: 70, h: 60 });
      place({ type: 'spike', w: 36, h: 36, base: 60 });
    } else if (p === 'bar') {
      place({ type: 'bar', y: GY - 66, w: 92, h: 30 });
    } else if (p === 'ceiling' || p === 'shortHop') {
      place({ type: 'ceiling', y: GY - 180, w: 190, h: 24 });
      place({ type: 'spike', w: 36, h: 36 }, startX + 78);
      endX = Math.max(endX, startX + 190);
    } else if (p === 'gapShort') {
      place({ type: 'gap', w: 190 });
    } else if (p === 'gapLong') {
      place({ type: 'gap', w: 330 });
    } else if (p === 'gapStep') {
      place({ type: 'gap', w: 230 });
      place({ type: 'block', w: 90, h: 60 }, startX + 230);
    } else if (p === 'platformRun') {
      const platformW = Math.round(beat * 1.8);
      place({ type: 'platform', y: GY - 120, w: platformW, h: 18 });
      place({ type: 'spike', w: 36, h: 36, base: 120 }, startX + Math.round(beat * 1.1));
      endX = Math.max(endX, startX + platformW);
    } else if (p === 'platformGap') {
      const gapW = Math.round(beat * 2.85);
      place({ type: 'gap', w: gapW });
      place({ type: 'platform', y: GY - 130, w: Math.round(beat * 1.8), h: 18 }, startX + Math.round(beat * 0.28));
      place({ type: 'platform', y: GY - 90, w: Math.round(beat * 0.95), h: 18 }, startX + Math.round(beat * 2.18));
      endX = Math.max(endX, startX + Math.round(beat * 3.18));
    } else if (p === 'platformChain') {
      place({ type: 'gap', w: Math.round(beat * 3.7) });
      place({ type: 'platform', y: GY - 80, w: Math.round(beat * 1.02), h: 18 }, startX + Math.round(beat * 0.1));
      place({ type: 'platform', y: GY - 170, w: Math.round(beat * 1.15), h: 18 }, startX + Math.round(beat * 1.4));
      place({ type: 'platform', y: GY - 100, w: Math.round(beat * 1.1), h: 18 }, startX + Math.round(beat * 2.85));
      endX = Math.max(endX, startX + Math.round(beat * 3.95));
    } else if (p === 'duckTunnel') {
      const tunnelW = Math.round(beat * 1.38);
      // Le plafond descend presque jusqu'à la barre : la route haute est
      // réellement fermée et la seule réponse lisible est de se liquéfier
      // sous la fenêtre basse, comme une vraie contrainte de niveau.
      place({ type: 'bar', y: GY - 66, w: tunnelW, h: 30 });
      place({ type: 'ceiling', y: GY - 280, w: tunnelW, h: 245 }, startX);
      endX = Math.max(endX, startX + tunnelW);
    } else if (p === 'rhythm') {
      place({ type: 'spike', w: 36, h: 36 });
      place({ type: 'spike', w: 36, h: 36 }, startX + Math.round(beat * 0.82));
      place({ type: 'bar', y: GY - 66, w: Math.round(beat * 0.82), h: 30 }, startX + Math.round(beat * 1.72));
      place({ type: 'spike', w: 36, h: 36 }, startX + Math.round(beat * 2.9));
      endX = Math.max(endX, startX + Math.round(beat * 3.2));
    } else if (p === 'zigzag') {
      const gapW = Math.round(beat * 3.55);
      place({ type: 'gap', w: gapW });
      place({ type: 'platform', y: GY - 100, w: Math.round(beat * 1.05), h: 18 }, startX + Math.round(beat * 0.08));
      place({ type: 'platform', y: GY - 190, w: Math.round(beat * 1.08), h: 18 }, startX + Math.round(beat * 1.35));
      place({ type: 'platform', y: GY - 110, w: Math.round(beat * 1.05), h: 18 }, startX + Math.round(beat * 2.75));
      endX = Math.max(endX, startX + Math.round(beat * 3.85));
    } else if (p === 'saw') {
      placeSaw(startX + 17);
    } else if (p === 'combo1') {
      place({ type: 'spike', w: 36, h: 36 });
      place({ type: 'spike', w: 36, h: 36 }, startX + Math.round(beat * 1.36));
    } else if (p === 'combo2') {
      place({ type: 'bar', y: GY - 66, w: 92, h: 30 });
      place({ type: 'spike', w: 36, h: 36 }, startX + Math.round(beat * 2.12));
    } else if (p === 'ceilingGap') {
      place({ type: 'ceiling', y: GY - 180, w: 190, h: 24 });
      place({ type: 'spike', w: 36, h: 36 }, startX + 78);
      place({ type: 'gap', w: 300 }, startX + 240);
    }
    const width = endX - startX;
    const breathingRoom = 0.82 - difficulty * 0.23 + this.randomUnit() * (0.18 - difficulty * 0.06);
    this.spawnGap = width + this.speed * breathingRoom + 90 - difficulty * 30;
  }

  nextObstacleLabel(o: any): string {
    if (o.type === 'spike') return o.base ? 'PIQUE EN HAUTEUR' : 'PIQUES';
    if (o.type === 'block') return 'BLOC';
    if (o.type === 'platform') return 'PLATEFORME · SAUTE';
    if (o.type === 'ceiling') return 'PLAFOND · TAPOTE';
    if (o.type === 'gap') return (o.w ?? 0) >= 280 ? 'GOUFFRE · SAUT LONG' : 'GOUFFRE · SAUT';
    if (o.type === 'bar') return 'BARRE · BAISSE-TOI';
    return 'SCIE · SAUTE';
  }

  checkHits(): void {
    const b = this.blob, r = b.r;
    for (const o of this.obs) {
      if (o.type === 'spike') {
        const base = o.base || 0;
        const ow = o.w ?? 36, oh = o.h ?? 36;
        const cx = o.x + ow / 2;
        const bx = cx - ow * 0.22, by = GY - base - oh * 0.62, bw = ow * 0.44, bh = oh * 0.62;
        if (this.circleRect(PX, b.y, r * 0.82, bx, by, bw, bh)) return this.die();
      } else if (o.type === 'block') {
        const oy = o.y ?? GY - (o.h ?? 0);
        const ow = o.w ?? 0, oh = o.h ?? 0;
        const feet = b.y + r;
        const overlapping = PX + r * 0.7 > o.x && PX - r * 0.7 < o.x + ow;
        const landed = this.onGround && Math.abs(feet - oy) < 1.5;
        if (overlapping && feet > oy + 8 && b.y - r < oy + oh) {
          if (!landed) return this.die();
        }
      } else if (o.type === 'bar' || o.type === 'ceiling') {
        if (this.circleRect(PX, b.y, r * 0.9, o.x, o.y ?? GY, o.w ?? 0, o.h ?? 0)) return this.die();
      } else if (o.type === 'saw') {
        if (Math.hypot(PX - o.x, b.y - (o.y ?? GY)) < r * 0.9 + (o.r ?? 17) * 0.85) return this.die();
      }
    }
  }

  distanceToRect(cx: number, cy: number, x: number, y: number, w: number, h: number): number {
    const nx = Math.max(x, Math.min(cx, x + w));
    const ny = Math.max(y, Math.min(cy, y + h));
    return Math.hypot(cx - nx, cy - ny);
  }

  circleRect(cx: number, cy: number, cr: number, x: number, y: number, w: number, h: number): boolean {
    return this.distanceToRect(cx, cy, x, y, w, h) < cr;
  }

  die(): void {
    if (this.state === 'over') return;
    this.audio.explode(1.4);
    this.input.rumble(1, 0.35);
    this.fx.shake(0.9);
    this.fx.stop(0.12);
    this.fx.burst(PX, this.blob.y, { n: 26, speed: [100, 520], colors: [this.accent, '#ffffff', '#ff5470'], size: [2, 6], life: 0.7 });
    this.fx.ring(PX, this.blob.y, { r0: 10, r1: 110, color: this.accent, life: 0.4 });
    this.blob.dead = true;
    this.score = this.totalScore();
    this.over();
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#0a0f07';
    ctx.fillRect(0, 0, 1280, 720);

    this.fx.world(ctx);

    // Horizon en couches : le sol gagne de la profondeur à mesure que la
    // vitesse augmente, sans détourner l'œil des obstacles.
    const horizon = ctx.createLinearGradient(0, 120, 0, GY);
    horizon.addColorStop(0, 'rgba(163,230,53,0.02)');
    horizon.addColorStop(1, 'rgba(163,230,53,0.10)');
    ctx.fillStyle = horizon;
    ctx.fillRect(0, 120, 1280, GY - 120);

    ctx.fillStyle = '#9fd8a8';
    for (const d of this.bgDots) {
      ctx.globalAlpha = 0.06 + d.z * 0.12;
      ctx.fillRect(d.x, d.y, 2.5, 2.5);
    }
    ctx.globalAlpha = 1;

    // sol
    ctx.strokeStyle = this.accent;
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(0, GY); ctx.lineTo(1280, GY); ctx.stroke();
    ctx.strokeStyle = this.accent + '44';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = -this.tickOff; x < 1280; x += 80) { ctx.moveTo(x, GY); ctx.lineTo(x - 14, GY + 12); }
    ctx.stroke();
    ctx.fillStyle = '#0f150a';
    ctx.fillRect(0, GY + 2, 1280, 720 - GY);

    // Guides de profondeur : ils rendent le défilement et la distance au sol
    // immédiatement perceptibles, surtout lors des premières secondes.
    ctx.save();
    ctx.globalAlpha = 0.06;
    ctx.strokeStyle = this.accent;
    ctx.lineWidth = 1;
    for (let y = GY - 150; y < GY; y += 42) {
      const k = (GY - y) / 150;
      ctx.beginPath();
      ctx.moveTo(PX - 300 * k, y);
      ctx.lineTo(PX + 960 * k, y);
      ctx.stroke();
    }
    ctx.restore();

    // À haute vitesse, le décor se transforme en tunnel de traits. La phase
    // dépend du temps de jeu, mais la géométrie des obstacles reste seedée.
    const speedFactor = this.speedFactor();
    this.renderSpeedStreaks(ctx, speedFactor);

    if (this.proxT > 0.05) {
      const sensor = Math.round(this.proxT * 100);
      UI.panel(ctx, 24, 102, 178, 34, {
        radius: 17,
        fill: 'rgba(30, 9, 14, 0.78)',
        stroke: this.proxT > 0.7 ? '#ff5470cc' : '#f2c94caa',
        lineWidth: 1.5,
      });
      UI.txt(ctx, 'CAPTEUR  ' + sensor + '%', 113, 125, {
        size: 12,
        align: 'center',
        mono: true,
        color: this.proxT > 0.7 ? '#ff9aaa' : '#f2c94c',
        weight: 900,
      });
    }

    // Télégraphe de la prochaine menace : le joueur sait quoi lire avant que
    // l'obstacle n'arrive à sa hauteur.
    const next = this.obs
      .filter((o: any) => o.x > PX + 54)
      .sort((a: any, b: any) => a.x - b.x)[0];
    if (next && next.x < PX + 560) {
      const urgency = 1 - Math.max(0, Math.min(1, (next.x - PX - 54) / 506));
      ctx.save();
      ctx.globalAlpha = 0.42 + urgency * 0.5;
      UI.panel(ctx, 492, 112, 296, 38, {
        radius: 19,
        fill: 'rgba(10,15,7,0.82)',
        stroke: urgency > 0.72 ? '#ff5470aa' : this.accent + '88',
        lineWidth: 1.5,
      });
      UI.txt(ctx, 'PROCHAIN  ·  ' + this.nextObstacleLabel(next), 640, 136, {
        size: 12,
        align: 'center',
        mono: true,
        color: urgency > 0.72 ? '#ff9aaa' : '#d7e3ea',
        weight: 900,
      });
      ctx.fillStyle = urgency > 0.72 ? '#ff5470' : this.accent;
      ctx.fillRect(492, 146, 296 * urgency, 2);
      ctx.restore();
    }

    // Obstacles et fossés. Le fossé est dessiné par-dessus le sol pour que
    // l'absence de support soit lisible avant même la collision.
    for (const o of this.obs) {
      if (o.type === 'gap') {
        const w = o.w ?? 0;
        ctx.fillStyle = '#020307';
        ctx.fillRect(o.x, GY - 1, w, this.H - GY + 1);
        ctx.strokeStyle = '#ff5470aa';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(o.x, GY); ctx.lineTo(o.x + 18, GY + 18);
        ctx.moveTo(o.x + w, GY); ctx.lineTo(o.x + w - 18, GY + 18);
        ctx.stroke();
        ctx.strokeStyle = '#ff547044';
        ctx.lineWidth = 1;
        for (let x = o.x + 42; x < o.x + w - 12; x += 42) {
          ctx.beginPath(); ctx.moveTo(x, GY + 12); ctx.lineTo(x - 12, this.H); ctx.stroke();
        }
      } else if (o.type === 'spike') {
        const base = o.base || 0;
        const ow = o.w ?? 36;
        const oh = o.h ?? 36;
        ctx.fillStyle = '#ff5470';
        ctx.beginPath();
        ctx.moveTo(o.x, GY - base);
        ctx.lineTo(o.x + ow / 2, GY - base - oh);
        ctx.lineTo(o.x + ow, GY - base);
        ctx.closePath();
        ctx.fill();
      } else if (o.type === 'block') {
        const oh = o.h ?? 0;
        ctx.fillStyle = '#1a2612';
        ctx.strokeStyle = this.accent;
        ctx.lineWidth = 2;
        UI.roundRect(ctx, o.x, o.y ?? GY - oh, o.w ?? 0, oh, 6);
        ctx.fill(); ctx.stroke();
      } else if (o.type === 'platform') {
        const oy = o.y ?? GY - (o.h ?? 18);
        const ow = o.w ?? 0;
        const oh = o.h ?? 18;
        ctx.save();
        ctx.shadowColor = this.accent;
        ctx.shadowBlur = 12;
        ctx.fillStyle = '#182b16';
        ctx.strokeStyle = this.accent;
        ctx.lineWidth = 2;
        UI.roundRect(ctx, o.x, oy, ow, oh, 7);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.stroke();
        ctx.fillStyle = '#d9ff8a';
        ctx.fillRect(o.x + 9, oy + 2, Math.max(0, ow - 18), 3);
        ctx.strokeStyle = this.accent + '55';
        ctx.lineWidth = 1;
        for (let x = o.x + 18; x < o.x + ow - 10; x += 34) {
          ctx.beginPath();
          ctx.moveTo(x, oy + oh);
          ctx.lineTo(x - 8, oy + oh + 12);
          ctx.stroke();
        }
        ctx.restore();
      } else if (o.type === 'bar' || o.type === 'ceiling') {
        ctx.fillStyle = '#ff5470';
        ctx.shadowColor = '#ff5470'; ctx.shadowBlur = 12;
        UI.roundRect(ctx, o.x, o.y ?? GY, o.w ?? 0, o.h ?? 0, 8);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#ffffff55';
        ctx.beginPath();
        const oy = o.y ?? GY;
        const ow = o.w ?? 0;
        const oh = o.h ?? 0;
        ctx.moveTo(o.x + 10, oy + oh); ctx.lineTo(o.x + 10, oy + oh + 14);
        ctx.moveTo(o.x + ow - 10, oy + oh); ctx.lineTo(o.x + ow - 10, oy + oh + 14);
        ctx.stroke();
      } else if (o.type === 'saw') {
        ctx.save();
        ctx.translate(o.x, o.y ?? GY - 17);
        ctx.rotate(o.ang ?? 0);
        ctx.fillStyle = '#ff5470';
        ctx.beginPath();
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * 6.2832;
          const rr0 = o.r ?? 17;
          const rr = i % 2 === 0 ? rr0 : rr0 * 0.72;
          i === 0 ? ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr) : ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
        }
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#0a0f07';
        ctx.beginPath(); ctx.arc(0, 0, 4, 0, 6.2832); ctx.fill();
        ctx.restore();
      }
    }

    this.renderBlobStreaks(ctx, speedFactor);
    this.blob.render(ctx);
    if (this.proxT > 0.05) {
      ctx.save();
      const pulse = 1 + Math.sin(this.time * 18) * 0.08;
      ctx.globalAlpha = 0.18 + this.proxT * 0.34;
      ctx.strokeStyle = this.proxT > 0.7 ? '#ff5470' : '#f2c94c';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(PX, this.blob.y, (this.blob.r + 12 + this.proxT * 10) * pulse, 0, 6.2832);
      ctx.stroke();
      ctx.restore();
    }
    this.fx.drawWorld(ctx);
    this.fx.endWorld(ctx);

    // HUD
    UI.txt(ctx, Math.floor(this.meters()) + ' m', 640, 62, { size: 42, align: 'center', mono: true, weight: 700, shadow: true });
    UI.txt(ctx, 'SEED ' + this.seed.toString(16).toUpperCase().padStart(8, '0'), 24, 38, { size: 11, mono: true, color: '#71815f', weight: 700 });
    UI.txt(ctx, 'RECORD ' + UI.getBest(this.meta.id) + ' pts', 640, 88, { size: 14, align: 'center', color: '#7c8698' });
    UI.drawHUD(ctx, {
      accent: this.accent,
      score: this.score,
      unit: this.meta.unit,
      extra: () => {
        UI.txt(ctx, Math.round(this.speed) + ' px/s', 1252, 87, { size: 12, align: 'right', color: '#5f6b52', mono: true });
        if (this.combo > 0) UI.txt(ctx, 'NEAR x' + this.combo, 1252, 105, { size: 11, align: 'right', color: '#f2c94c', mono: true, weight: 900 });
      },
    });
    this.drawCommon(ctx);
  }
}
