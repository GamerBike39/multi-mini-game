// BLOBBLASTER — twin-stick : stick gauche bouge, stick droit vise (tir auto).
// Clavier : le tir vise tout seul l'ennemi le plus proche.

import { BaseGame } from '../core/game';
import * as UI from '../core/ui';
import type { EngineLike, GameMeta } from '../core/types';
import { ObjectPool } from '../core/pool';

export class ShooterGame extends BaseGame {
  [key: string]: any;
  readonly pbulletPool = new ObjectPool<any>(() => ({ x: 0, y: 0, vx: 0, vy: 0, r: 4, dead: false }), 48);
  readonly ebulletPool = new ObjectPool<any>(() => ({ x: 0, y: 0, vx: 0, vy: 0, r: 6, dead: false }), 32);
  static meta: GameMeta = {
    id: 'shoot', name: 'BLOBBLASTER', accent: '#fbbf24', mood: 'shooter',
    desc: 'Twin-stick frénétique', controls: 'Stick G bouger · Stick D viser',
    keys: "ZQSD + Espace (auto-visée)",
    hint: 'Stick G = bouger · Stick D = viser & tirer (A fonctionne aussi)',
    unit: 'pts', ranks: [5000, 2500, 1200, 500, 0],
  };

  constructor(engine: EngineLike) {
    super(engine);
    this.blob.x = 640; this.blob.y = 480; this.blob.r = 20;
    this.blob.trailOn = true;
    this.aim = -Math.PI / 2;
    this.aimLock = null;      // visée clavier : angle vers l'ennemi le plus proche
    this.fireCd = 0;
    this.hp = 3;
    this.inv = 0;
    this.enemies = [];
    this.pbullets = this.pbulletPool.active;
    this.ebullets = this.ebulletPool.active;
    this.spawnT = 0.8;
    this.rockT = 2.2;
    this.satT = 22;
    this.streak = 0;
    this.stars = [];
    for (let i = 0; i < 70; i++) this.stars.push({ x: Math.random() * 1280, y: Math.random() * 720, z: 0.3 + Math.random() * 0.7 });
  }

  update(dt: number): void {
    if (this.baseUpdate(dt)) return;
    const b = this.blob, I = this.input;

    this.inv = Math.max(0, this.inv - dt);

    // --- mouvement ---
    this.steer(dt, b, I.moveX, I.moveY, 400, 8);
    b.x = Math.max(b.r + 8, Math.min(1272 - b.r, b.x + b.vx * dt));
    b.y = Math.max(b.r + 8, Math.min(712 - b.r, b.y + b.vy * dt));

    // --- visée ---
    const al = Math.hypot(I.aimX, I.aimY);
    if (al > 0.25) {
      let ang = Math.atan2(I.aimY, I.aimX);
      // assistance douce : aimante sur un ennemi dans un cône de ~10°
      let bestE = null, bestDiff = 0.18;
      for (const e of this.enemies) {
        if (Math.hypot(e.x - b.x, e.y - b.y) > 700) continue;
        const ea = Math.atan2(e.y - b.y, e.x - b.x);
        const diff = Math.abs(((ea - ang + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        if (diff < bestDiff) { bestDiff = diff; bestE = e; }
      }
      this.aim = bestE ? Math.atan2(bestE.y - b.y, bestE.x - b.x) : ang;
      this.aimLock = null;
    } else {
      // clavier / stick droit neutre : viser le plus proche, sinon tout droit
      let best = null, bd = 1e9;
      for (const e of this.enemies) {
        const d = Math.hypot(e.x - b.x, e.y - b.y);
        if (d < bd) { bd = d; best = e; }
      }
      if (best) this.aim = Math.atan2(best.y - b.y, best.x - b.x);
      else if (I.moveX || I.moveY) this.aim = Math.atan2(I.moveY, I.moveX);
    }

    // --- tir ---
    this.fireCd -= dt;
    const wantFire = al > 0.25 || I.down('a') || I.down('rb');
    if (wantFire && this.fireCd <= 0 && this.state === 'play') {
      this.fireCd = 0.115;
      const ca = Math.cos(this.aim), sa = Math.sin(this.aim);
      this.acquireBullet(this.pbulletPool, { x: b.x + ca * (b.r + 6), y: b.y + sa * (b.r + 6), vx: ca * 950, vy: sa * 950, r: 4 });
      b.vx -= ca * 46; b.vy -= sa * 46;   // recul visible
      this.audio.shoot();
      this.fx.burst(b.x + ca * (b.r + 8), b.y + sa * (b.r + 8), { n: 3, speed: [40, 160], colors: ['#ffd166', '#fff7cc'], size: [1.5, 3], life: 0.15, ang: this.aim, spread: 0.7 });
    }

    // --- spawns ennemis ---
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = Math.max(0.48, 1.5 - this.time * 0.017);
      const r = this.rng.next();
      if (this.time > 35 && r < 0.24) this.spawnTank();
      else if (this.time > 16 && r < 0.44) this.spawnSniper();
      else this.spawnDrone();
    }

    // --- obstacles du décor : astéroïdes et satellites ---
    this.rockT -= dt;
    if (this.rockT <= 0) {
      this.rockT = Math.max(1.8, 4.4 - this.time * 0.02);
      if (this.enemies.length < 22) this.spawnRock();
    }
    this.satT -= dt;
    if (this.satT <= 0) {
      this.satT = this.rng.float(9, 14);
      if (this.enemies.length < 22) this.spawnSat();
    }

    // --- ennemis ---
    for (const e of this.enemies) {
      e.t += dt;
      if (e.kind === 'drone') {
        e.y += e.vy * dt;
        e.x = e.x0 + Math.sin(e.t * 2.3 + e.ph) * 78;
        if (e.y > 760) e.dead = true;
      } else if (e.kind === 'tank') {
        e.y += 42 * dt;
        e.x += Math.sin(e.t * 0.8 + e.ph) * 26 * dt;
        if (e.y > 760) e.dead = true;
      } else if (e.kind === 'rock') {
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        e.rot += e.vr * dt;
        if (e.y > 780 || e.x < -60 || e.x > 1340) e.dead = true;
      } else if (e.kind === 'sat') {
        e.x += (e.vx + Math.sin(e.t * 0.7 + e.ph) * 18) * dt;
        e.y += e.vy * dt;
        if (e.y > 780) e.dead = true;
      } else { // sniper
        if (e.st === 'in') {
          e.x += (e.tx - e.x) * Math.min(1, dt * 3);
          e.y += (e.ty - e.y) * Math.min(1, dt * 3);
          if (e.t > 1.2) { e.st = 'tel'; e.t = 0.4; e.ang = Math.atan2(b.y - e.y, b.x - e.x); }
        } else if (e.st === 'tel') {
          e.t -= dt;
          if (e.t <= 0) {
            e.st = 'wait'; e.t = 1.15;
            this.acquireBullet(this.ebulletPool, { x: e.x, y: e.y, vx: Math.cos(e.ang) * 540, vy: Math.sin(e.ang) * 540, r: 6 });
            this.audio.shoot();
            e.shots--;
          }
        } else {
          e.t -= dt;
          if (e.t <= 0) {
            if (e.shots > 0) { e.st = 'tel'; e.t = 0.4; e.ang = Math.atan2(b.y - e.y, b.x - e.x); }
            else { e.st = 'out'; }
          }
        }
        if (e.st === 'out') { e.y -= 260 * dt; if (e.y < -50) e.dead = true; }
      }
      if (this.inv <= 0 && Math.hypot(b.x - e.x, b.y - e.y) < e.r + b.r - 4) this.hurt();
    }
    this.enemies = this.enemies.filter((e: any) => !e.dead);

    // --- balles joueur ---
    const born = []; // fragments d'astéroïdes créés cette frame (ajoutés après la boucle)
    for (const p of this.pbullets) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.x < -20 || p.x > 1300 || p.y < -20 || p.y > 740) { p.dead = true; continue; }
      for (const e of this.enemies) {
        if (e.dead) continue;
        if (Math.hypot(e.x - p.x, e.y - p.y) < e.r + p.r + 2) {
          p.dead = true;
          e.hp--;
          this.audio.hitEnemy();
          this.fx.burst(p.x, p.y, { n: 5, speed: [40, 200], colors: ['#ffd166', '#ffffff'], size: [1.5, 3], life: 0.25 });
          if (e.hp <= 0) {
            e.dead = true;
            this.streak++;
            this.musicEvent('enemyKilled', e.kind === 'tank' ? 1.3 : 0.7);
            if (this.streak >= 3) this.musicEvent('combo', Math.min(1.4, this.streak / 8));
            const pts = e.kind === 'tank' ? 30 : e.kind === 'sat' ? 40 : e.kind === 'rock' ? 15 : e.kind === 'sniper' ? 20 : 10;
            this.score += pts * this.mult();
            this.fx.text(e.x, e.y - 22, '+' + pts * this.mult(), { color: '#ffd166', size: 17, mono: true });
            if (e.kind === 'rock') {
              this.boom(e.x, e.y, 0.5, '#b8a88f');
              // les gros astéroïdes se brisent en deux plus petits
              if (e.r > 19) {
                for (const s of [-1, 1]) {
                  born.push(this.makeRock(e.r * 0.55, e.x + s * 12, e.y, e.vx + s * this.rng.float(55, 95), e.vy * 0.8 + 25));
                }
              }
            } else if (e.kind === 'sat') {
              this.boom(e.x, e.y, 1.0, '#9fb4c8');
              this.fx.burst(e.x, e.y, { n: 12, speed: [60, 260], colors: ['#9fc3e8', '#dfe9f2'], size: [2, 5], life: 0.6, shape: 'sq' });
            } else {
              this.boom(e.x, e.y, e.kind === 'tank' ? 1.2 : 0.7, e.kind === 'tank' ? '#ff8c42' : '#ff5470');
              if (e.kind === 'tank') {
                for (let i = 0; i < 6; i++) {
                  const a = (i / 6) * 6.2832 + 0.3;
                  this.acquireBullet(this.ebulletPool, { x: e.x, y: e.y, vx: Math.cos(a) * 230, vy: Math.sin(a) * 230, r: 6 });
                }
              }
            }
          }
        }
      }
    }
    this.releaseDeadBullets(this.pbulletPool);
    // les ennemis tués par balles disparaissent dès cette frame (pas de cadavre jouable)
    this.enemies = this.enemies.filter((e: any) => !e.dead);
    this.enemies.push(...born);

    // --- balles ennemies ---
    for (const p of this.ebullets) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.x < -20 || p.x > 1300 || p.y < -20 || p.y > 740) { p.dead = true; continue; }
      if (this.inv <= 0 && Math.hypot(b.x - p.x, b.y - p.y) < p.r + b.r - 5) { p.dead = true; this.hurt(); }
    }
    this.releaseDeadBullets(this.ebulletPool);

    // étoiles parallaxe
    for (const s of this.stars) {
      s.y += (30 + s.z * 110) * dt;
      if (s.y > 724) { s.y = -4; s.x = Math.random() * 1280; }
    }

    this.streak = Math.max(0, this.streak - dt * 0.45);
    this.blob.update(dt);
    this.fx.zoom = 1;
  }

  mult(): number { return 1 + Math.min(3, Math.floor(this.streak) * 0.1); }

  acquireBullet(pool: ObjectPool<any>, value: { x: number; y: number; vx: number; vy: number; r: number }): void {
    const bullet = pool.acquire();
    bullet.x = value.x;
    bullet.y = value.y;
    bullet.vx = value.vx;
    bullet.vy = value.vy;
    bullet.r = value.r;
    bullet.dead = false;
  }

  releaseDeadBullets(pool: ObjectPool<any>): void {
    for (let i = pool.active.length - 1; i >= 0; i--) {
      if (pool.active[i].dead) pool.releaseAt(i);
    }
  }

  spawnDrone(): void {
    this.enemies.push({ kind: 'drone', x0: this.rng.float(100, 1180), x: 0, y: -30, vy: 95 + this.time * 0.6, r: 15, hp: 1, t: 0, ph: this.rng.float(0, 6.28) });
  }
  spawnTank(): void {
    this.enemies.push({ kind: 'tank', x: this.rng.float(150, 1130), y: -40, r: 26, hp: 4, t: 0, ph: this.rng.float(0, 6.28) });
  }
  spawnSniper(): void {
    this.enemies.push({ kind: 'sniper', x: this.rng.next() < 0.5 ? -30 : 1310, y: this.rng.float(80, 380), tx: this.rng.float(200, 1080), ty: this.rng.float(90, 310), r: 16, hp: 2, st: 'in', t: 0, shots: 3, ang: 0 });
  }

  // astéroïde : polygone irrégulier généré, rotation, dérive, se brise en deux
  makeRock(r: number, x: number, y: number, vx: number, vy: number): any {
    const n = this.rng.int(8, 11);
    const verts = [];
    for (let i = 0; i < n; i++) verts.push(this.rng.float(0.72, 1.14));
    return { kind: 'rock', x, y, vx, vy, r, verts, hp: r > 26 ? 2 : 1, rot: this.rng.float(0, 6.28), vr: this.rng.float(-0.5, 0.5) * 1.6, t: 0 };
  }
  spawnRock(): void {
    const r = this.rng.float(15, 35);
    this.enemies.push(this.makeRock(r, this.rng.float(80, 1200), -50, this.rng.float(-25, 25), this.rng.float(45, 100)));
  }
  spawnSat(): void {
    this.enemies.push({ kind: 'sat', x: this.rng.float(100, 1180), y: -40, vx: this.rng.float(-15, 15), vy: this.rng.float(26, 44), r: 24, hp: 3, t: 0, ph: this.rng.float(0, 6.28) });
  }

  boom(x: number, y: number, power: number, color: string): void {
    this.audio.explode(power);
    this.input.rumble(0.3 + power * 0.3, 0.15);
    this.fx.shake(0.18 + power * 0.25);
    this.fx.burst(x, y, { n: Math.round(12 + power * 10), speed: [60, 380 * power], colors: [color, '#ffd166', '#ffffff'], size: [2, 5], life: 0.5 });
    this.fx.ring(x, y, { r0: 8, r1: 40 + 55 * power, color, life: 0.3 });
  }

  hurt(): void {
    if (this.inv > 0 || this.state === 'over') return;
    this.hp--;
    this.streak = 0;
    if (this.hp <= 0) {
      this.boom(this.blob.x, this.blob.y, 1.5, this.accent);
      this.blob.dead = true;
      this.over();
      return;
    }
    this.inv = 1.8;
    this.audio.hurt();
    this.input.rumble(0.9, 0.28);
    this.fx.shake(0.7);
    this.fx.stop(0.1);
    this.fx.flash('#ff2d55', 0.22);
    this.fx.burst(this.blob.x, this.blob.y, { n: 18, speed: [100, 420], colors: [this.accent, '#ff5470'], life: 0.5 });
    this.blob.punch(0.6);
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#0d0a06';
    ctx.fillRect(0, 0, 1280, 720);

    this.fx.world(ctx);

    ctx.fillStyle = '#fff';
    for (const s of this.stars) {
      ctx.globalAlpha = 0.12 + s.z * 0.25;
      ctx.fillRect(s.x, s.y, 2, 2);
    }
    ctx.globalAlpha = 1;

    // Signaux d’entrée : les ennemis qui arrivent par le bord sont annoncés
    // une fraction de seconde avant d’entrer dans l’arène.
    for (const e of this.enemies) {
      const col = e.kind === 'tank' ? '#ff8c42' : e.kind === 'sniper' ? '#c9b5ff' : '#ff5470';
      if (e.y < 76 && e.y > -90) {
        const x = Math.max(24, Math.min(1256, e.x));
        const a = 0.25 + 0.25 * (0.5 + 0.5 * Math.sin(this.time * 12 + e.x));
        ctx.save();
        ctx.globalAlpha = a;
        ctx.strokeStyle = col;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, 16); ctx.lineTo(x, 44); ctx.stroke();
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.moveTo(x, 52); ctx.lineTo(x - 7, 40); ctx.lineTo(x + 7, 40); ctx.closePath(); ctx.fill();
        ctx.restore();
      } else if (e.x < 8 || e.x > 1272) {
        const y = Math.max(34, Math.min(686, e.y));
        const x = e.x < 8 ? 14 : 1266;
        ctx.save();
        ctx.globalAlpha = 0.3 + 0.2 * (0.5 + 0.5 * Math.sin(this.time * 12 + e.y));
        ctx.fillStyle = col;
        ctx.beginPath();
        if (e.x < 8) { ctx.moveTo(x, y); ctx.lineTo(x + 13, y - 8); ctx.lineTo(x + 13, y + 8); }
        else { ctx.moveTo(x, y); ctx.lineTo(x - 13, y - 8); ctx.lineTo(x - 13, y + 8); }
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }

    // balles ennemies
    ctx.shadowColor = '#ff5470'; ctx.shadowBlur = 9;
    ctx.fillStyle = '#ff5470';
    for (const p of this.ebullets) {
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.2832); ctx.fill();
    }
    ctx.shadowBlur = 0;

    // ennemis
    for (const e of this.enemies) {
      if (e.kind === 'drone') {
        const a = Math.atan2(e.vy, Math.cos(e.t * 2.3 + e.ph) * 78 * 2.3);
        ctx.save(); ctx.translate(e.x, e.y); ctx.rotate(a);
        ctx.fillStyle = '#ff5470';
        ctx.beginPath(); ctx.moveTo(0, 14); ctx.lineTo(-11, -10); ctx.lineTo(11, -10); ctx.closePath(); ctx.fill();
        ctx.restore();
      } else if (e.kind === 'tank') {
        ctx.save(); ctx.translate(e.x, e.y);
        ctx.fillStyle = '#ff8c42';
        ctx.strokeStyle = '#ffd9a8'; ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * 6.2832 + 0.52;
          const px = Math.cos(a) * e.r, py = Math.sin(a) * e.r;
          i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.closePath(); ctx.fill(); ctx.stroke();
        for (let i = 0; i < e.hp; i++) {
          ctx.fillStyle = '#fff';
          ctx.fillRect(-12 + i * 8, -3, 5, 6);
        }
        ctx.restore();
      } else if (e.kind === 'rock') {
        ctx.save();
        ctx.translate(e.x, e.y);
        ctx.rotate(e.rot);
        ctx.beginPath();
        const n = e.verts.length;
        for (let i = 0; i <= n; i++) {
          const a = (i % n) / n * 6.2832;
          const rr = e.r * e.verts[i % n];
          i === 0 ? ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr) : ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
        }
        ctx.closePath();
        ctx.fillStyle = '#565048';
        ctx.fill();
        ctx.strokeStyle = '#a89880';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      } else if (e.kind === 'sat') {
        ctx.save();
        ctx.translate(e.x, e.y);
        ctx.rotate(Math.sin(e.t * 0.9 + e.ph) * 0.15);
        ctx.fillStyle = 'rgba(95, 125, 156, 0.4)';
        ctx.strokeStyle = '#9fc3e8';
        ctx.lineWidth = 1.5;
        ctx.fillRect(-40, -9, 24, 18);
        ctx.strokeRect(-40, -9, 24, 18);
        ctx.fillRect(16, -9, 24, 18);
        ctx.strokeRect(16, -9, 24, 18);
        ctx.beginPath();
        ctx.moveTo(-16, 0); ctx.lineTo(16, 0);
        ctx.moveTo(0, 0); ctx.lineTo(0, 13);
        ctx.stroke();
        ctx.fillStyle = '#cfd9e4';
        UI.roundRect(ctx, -12, -12, 24, 24, 5);
        ctx.fill();
        ctx.strokeStyle = '#8894a2';
        ctx.stroke();
        ctx.restore();
      } else {
        if (e.st === 'tel') {
          ctx.globalAlpha = 0.3 + 0.35 * Math.sin(this.time * 42);
          ctx.strokeStyle = '#ff8896'; ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(e.x, e.y);
          ctx.lineTo(e.x + Math.cos(e.ang) * 1000, e.y + Math.sin(e.ang) * 1000);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        ctx.save(); ctx.translate(e.x, e.y);
        ctx.rotate(0.785);
        ctx.fillStyle = '#c9b5ff';
        ctx.fillRect(-11, -11, 22, 22);
        ctx.restore();
      }
    }

    // balles joueur
    ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 3;
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.pbullets) {
      ctx.beginPath();
      ctx.moveTo(p.x - p.vx * 0.014, p.y - p.vy * 0.014);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';

    // viseur
    if (this.state === 'play') {
      const cx = this.blob.x + Math.cos(this.aim) * 46, cy = this.blob.y + Math.sin(this.aim) * 46;
      const pulse = 1 + Math.sin(this.time * 8) * 0.18;
      ctx.strokeStyle = this.aimLock ? '#ffd166aa' : '#ffffff66'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, 9 * pulse, 0, 6.2832); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - 14, cy); ctx.lineTo(cx - 5, cy); ctx.moveTo(cx + 5, cy); ctx.lineTo(cx + 14, cy);
      ctx.moveTo(cx, cy - 14); ctx.lineTo(cx, cy - 5); ctx.moveTo(cx, cy + 5); ctx.lineTo(cx, cy + 14);
      ctx.stroke();
    }

    // blob clignote pendant l'invincibilité
    if (!(this.inv > 0 && Math.sin(this.time * 40) < 0)) this.blob.render(ctx);
    this.fx.drawWorld(ctx);
    this.fx.endWorld(ctx);

    // HUD
    UI.drawHUD(ctx, {
      accent: this.accent,
      score: this.score,
      extra: () => UI.txt(ctx, 'VIES', 28, 76, { size: 11, color: '#7c8698', mono: true }),
    });
    for (let i = 0; i < this.hp; i++) {
      ctx.fillStyle = this.accent;
      ctx.beginPath(); ctx.arc(34 + i * 30, 36, 9, 0, 6.2832); ctx.fill();
    }
    if (this.mult() > 1.01) {
      UI.txt(ctx, 'STREAK ×' + this.mult().toFixed(1), 28, 98, { size: 15, color: '#ffd166', mono: true });
    }
    this.drawCommon(ctx);
  }
}
