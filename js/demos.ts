interface DemoImpl {
  update(dt: number): void;
  draw(ctx: CanvasRenderingContext2D): void;
}

// Démos simulées (attract mode) : une petite scène autonome par jeu, en boucle,
// dessinée en fond de la fiche du menu. Zéro logique de jeu réelle : ce sont des
// vignettes scriptées qui reprennent le langage visuel de chaque jeu (blobs, accents).

import { Blob } from './core/blob';
import { bloomApplyMove, bloomEmptyGrid, bloomLegalMoves, bloomOpponent } from './games/bloom';

const TAU = Math.PI * 2;
const rand = (a: number, b: number): number => a + Math.random() * (b - a);
const pick = (arr: readonly any[]): any => arr[(Math.random() * arr.length) | 0];

// palette de jeu : accent + dérivées
function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${Math.round(((n >> 16) & 255) * f)},${Math.round(((n >> 8) & 255) * f)},${Math.round((n & 255) * f)})`;
}

// mini-kit de particules (indépendant du Fx des jeux, plus léger)
class Puffs {
  ps: any[] = [];
  constructor() { this.ps = []; }
  burst(x: number, y: number, cols: string[], n = 12, sp: [number, number] = [50, 240], life = 0.55, grav = 0): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, v = rand(sp[0], sp[1]);
      this.ps.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(life * 0.5, life), ml: life, r: rand(1.5, 4), c: pick(cols), grav });
    }
  }
  update(dt: number): void {
    let w = 0;
    for (const p of this.ps) {
      p.life -= dt;
      if (p.life <= 0) continue;
      const d = Math.pow(0.9, dt * 60);
      p.vx *= d; p.vy *= d;
      p.vy += p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      this.ps[w++] = p;
    }
    this.ps.length = w;
  }
  draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.ps) {
      ctx.globalAlpha = Math.max(0, p.life / p.ml);
      ctx.fillStyle = p.c;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}

// ---------------- BLOB BEAT : notes qui tombent sur 4 couloirs ----------------
function demoBeat(accent: string): DemoImpl {
  const X0 = 512, LW = 92, HIT_Y = 528, SPAWN_Y = 158;
  const laneCol = (i: number): string => `hsl(${192 + i * 36}, 85%, 66%)`;
  const s: any = {
    notes: [], spawnT: 0.4, hitT: [-9, -9, -9, -9],
    blob: new Blob({ x: X0 + 1.5 * LW, y: HIT_Y, r: 14, color: accent }),
    puffs: new Puffs(),
  };
  return {
    update(dt: number): void {
      s.spawnT -= dt;
      if (s.spawnT <= 0) {
        s.spawnT = rand(0.32, 0.6);
        s.notes.push({ lane: (Math.random() * 4) | 0, y: SPAWN_Y, v: rand(300, 380) });
      }
      for (let i = s.notes.length - 1; i >= 0; i--) {
        const n = s.notes[i];
        n.y += n.v * dt;
        if (n.y >= HIT_Y) {
          const lx = X0 + n.lane * LW;
          s.puffs.burst(lx, HIT_Y, [laneCol(n.lane), '#ffffff'], 14, [60, 300], 0.45);
          s.hitT[n.lane] = 0.32;
          s.blob.x = lx;
          s.blob.punch(0.4);
          s.notes.splice(i, 1);
        }
      }
      for (let i = 0; i < 4; i++) s.hitT[i] -= dt;
      s.blob.update(dt);
      s.puffs.update(dt);
    },
    draw(ctx: CanvasRenderingContext2D): void {
      for (let i = 0; i < 4; i++) {
        const lx = X0 + i * LW;
        ctx.globalAlpha = 0.1;
        ctx.strokeStyle = '#7dd3fc';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(lx, SPAWN_Y - 10); ctx.lineTo(lx, HIT_Y + 40); ctx.stroke();
        // récepteur
        const k = Math.max(0, s.hitT[i]) / 0.32;
        ctx.globalAlpha = 0.35 + k * 0.65;
        ctx.strokeStyle = laneCol(i);
        ctx.lineWidth = 2.5 + k * 2;
        ctx.beginPath(); ctx.arc(lx, HIT_Y, 20 + k * 12, 0, TAU); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      for (const n of s.notes) {
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = laneCol(n.lane);
        ctx.shadowColor = laneCol(n.lane);
        ctx.shadowBlur = 14;
        ctx.beginPath(); ctx.arc(X0 + n.lane * LW, n.y, 10, 0, TAU); ctx.fill();
        ctx.shadowBlur = 0;
      }
      ctx.globalAlpha = 1;
      s.blob.render(ctx);
      s.puffs.draw(ctx);
    },
  };
}

// ---------------- SURVIBLOB : esquive + dash à travers les chasseurs ----------------
function demoSurv(accent: string): DemoImpl {
  const s: any = {
    blob: new Blob({ x: 680, y: 380, r: 17, color: accent, trailOn: true }),
    enemies: [], t: 0, wanderT: 0, dashT: 1.2, dash: null, puffs: new Puffs(),
    tx: 680, ty: 380,
  };
  const edge = () => {
    const a = Math.random() * TAU;
    return { x: 680 + Math.cos(a) * 320, y: 380 + Math.sin(a) * 220 };
  };
  return {
    update(dt: number): void {
      s.t += dt; s.wanderT -= dt; s.dashT -= dt;
      if (s.wanderT <= 0) { s.wanderT = rand(0.7, 1.3); s.tx = 680 + rand(-170, 170); s.ty = 380 + rand(-130, 130); }
      if (s.dashT <= 0 && !s.dash) {
        s.dashT = rand(1.5, 2.3);
        const a = Math.random() * TAU;
        s.dash = { fx: s.blob.x, fy: s.blob.y, tx: s.blob.x + Math.cos(a) * rand(180, 260), ty: s.blob.y + Math.sin(a) * rand(120, 180), t: 0.16, from: { x: s.blob.x, y: s.blob.y } };
        s.puffs.burst(s.blob.x, s.blob.y, [accent, '#ffffff'], 16, [80, 340], 0.4);
      }
      if (s.dash) {
        s.dash.t -= dt;
        const k = 1 - Math.max(0, s.dash.t) / 0.16;
        s.blob.x = s.dash.fx + (s.dash.tx - s.dash.fx) * k;
        s.blob.y = s.dash.fy + (s.dash.ty - s.dash.fy) * k;
        s.blob.vx = (s.dash.tx - s.dash.fx) / 0.16;
        s.blob.vy = (s.dash.ty - s.dash.fy) / 0.16;
        for (let i = s.enemies.length - 1; i >= 0; i--) {
          const e = s.enemies[i];
          const dx = e.x - s.blob.x, dy = e.y - s.blob.y;
          if (dx * dx + dy * dy < 52 * 52) {
            s.puffs.burst(e.x, e.y, ['#ffffff', accent], 16, [60, 300], 0.5);
            s.enemies.splice(i, 1);
          }
        }
        if (s.dash.t <= 0) s.dash = null;
      } else {
        s.blob.vx += ((s.tx - s.blob.x) * 2.2 - s.blob.vx) * Math.min(1, dt * 3);
        s.blob.vy += ((s.ty - s.blob.y) * 2.2 - s.blob.vy) * Math.min(1, dt * 3);
        s.blob.x += s.blob.vx * dt; s.blob.y += s.blob.vy * dt;
      }
      if (s.t > 0.5 && s.enemies.length < 11 && Math.random() < dt * 2.1) {
        const p = edge();
        s.enemies.push({ x: p.x, y: p.y, ph: Math.random() * TAU, life: 11 });
      }
      for (let i = s.enemies.length - 1; i >= 0; i--) {
        const e = s.enemies[i];
        e.life -= dt;
        const dx = s.blob.x - e.x, dy = s.blob.y - e.y, d = Math.hypot(dx, dy) || 1;
        e.x += (dx / d) * 130 * dt;
        e.y += (dy / d) * 130 * dt;
        if (e.life <= 0 || d < 14) {
          if (d < 14) s.puffs.burst(e.x, e.y, ['#ff5470', '#ffffff'], 10, [40, 200], 0.4);
          s.enemies.splice(i, 1);
        }
      }
      s.blob.update(dt);
      s.puffs.update(dt);
    },
    draw(ctx: CanvasRenderingContext2D): void {
      for (const e of s.enemies) {
        const a = Math.atan2(s.blob.y - e.y, s.blob.x - e.x) + Math.PI / 2;
        ctx.save();
        ctx.translate(e.x, e.y);
        ctx.rotate(a);
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = '#ff5470';
        ctx.beginPath();
        ctx.moveTo(0, -13); ctx.lineTo(10, 9); ctx.lineTo(-10, 9);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      s.blob.render(ctx);
      s.puffs.draw(ctx);
    },
  };
}

// ---------------- BLOBBLASTER : twin-stick, ennemis qui poppent ----------------
function demoShoot(accent: string): DemoImpl {
  const s: any = {
    blob: new Blob({ x: 620, y: 460, r: 17, color: accent }),
    enemies: [], bullets: [], fireT: 0.4, spawnT: 0.3, t: 0, aim: -TAU / 4, puffs: new Puffs(),
  };
  return {
    update(dt: number): void {
      s.t += dt;
      s.spawnT -= dt;
      if (s.spawnT <= 0) {
        s.spawnT = rand(0.5, 0.9);
        const side = Math.random() < 0.5;
        s.enemies.push({
          x: side ? rand(520, 860) : 900,
          y: side ? 170 : rand(180, 540),
          vx: rand(-40, 40), vy: rand(20, 60), r: rand(10, 16), ph: Math.random() * TAU, life: 14,
        });
      }
      // visée : ennemi le plus proche
      let best = null, bd = 1e9;
      for (const e of s.enemies) {
        const d = Math.hypot(e.x - s.blob.x, e.y - s.blob.y);
        if (d < bd) { bd = d; best = e; }
      }
      if (best) s.aim = Math.atan2(best.y - s.blob.y, best.x - s.blob.x);
      s.blob.x = 620 + Math.sin(s.t * 0.9) * 70;
      s.blob.y = 460 + Math.sin(s.t * 1.4) * 26;
      s.blob.vx = Math.cos(s.t * 0.9) * 63; s.blob.vy = Math.cos(s.t * 1.4) * 36;
      s.fireT -= dt;
      if (s.fireT <= 0 && best && bd < 480) {
        s.fireT = 0.2;
        const mx = s.blob.x + Math.cos(s.aim) * 22, my = s.blob.y + Math.sin(s.aim) * 22;
        s.bullets.push({ x: mx, y: my, vx: Math.cos(s.aim) * 540, vy: Math.sin(s.aim) * 540 });
        s.puffs.burst(mx, my, ['#ffffff'], 3, [30, 120], 0.16);
      }
      for (let i = s.bullets.length - 1; i >= 0; i--) {
        const b = s.bullets[i];
        b.x += b.vx * dt; b.y += b.vy * dt;
        if (b.x < 440 || b.x > 940 || b.y < 140 || b.y > 620) { s.bullets.splice(i, 1); continue; }
        for (let j = s.enemies.length - 1; j >= 0; j--) {
          const e = s.enemies[j];
          if (Math.hypot(e.x - b.x, e.y - b.y) < e.r + 6) {
            s.puffs.burst(e.x, e.y, [accent, '#ffffff', '#ffd166'], 18, [50, 320], 0.55);
            s.enemies.splice(j, 1);
            s.bullets.splice(i, 1);
            break;
          }
        }
      }
      for (let i = s.enemies.length - 1; i >= 0; i--) {
        const e = s.enemies[i];
        e.life -= dt;
        e.x += e.vx * dt; e.y += e.vy * dt;
        if (e.life <= 0 || e.x < 440 || e.x > 940 || e.y > 620) s.enemies.splice(i, 1);
      }
      s.blob.update(dt);
      s.puffs.update(dt);
    },
    draw(ctx: CanvasRenderingContext2D): void {
      // ligne de visée
      ctx.globalAlpha = 0.16;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 8]);
      ctx.beginPath();
      ctx.moveTo(s.blob.x, s.blob.y);
      ctx.lineTo(s.blob.x + Math.cos(s.aim) * 300, s.blob.y + Math.sin(s.aim) * 300);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      for (const e of s.enemies) {
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = '#fb923c';
        ctx.beginPath();
        const wob = Math.sin(s.t * 7 + e.ph) * 1.6;
        ctx.arc(e.x, e.y, e.r + wob, 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#0b0e14';
        ctx.beginPath(); ctx.arc(e.x - 4, e.y - 3, 2.4, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(e.x + 4, e.y - 3, 2.4, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
      for (const b of s.bullets) {
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = accent; ctx.shadowBlur = 8;
        ctx.beginPath(); ctx.arc(b.x, b.y, 3.6, 0, TAU); ctx.fill();
        ctx.shadowBlur = 0;
      }
      s.blob.render(ctx);
      s.puffs.draw(ctx);
    },
  };
}

// ---------------- BLOB RUN : auto-runner, sauts sur scies et pics ----------------
function demoRun(accent: string): DemoImpl {
  const GY = 560, PX = 570;
  const s: any = {
    blob: new Blob({ x: PX, y: GY - 22, r: 19, color: accent }),
    obs: [], spawnT: 1, scroll: 300, vy: 0, t: 0, puffs: new Puffs(), dots: [],
  };
  for (let i = 0; i < 14; i++) s.dots.push({ x: rand(440, 940), y: rand(200, 520), z: rand(0.3, 1) });
  return {
    update(dt: number): void {
      s.t += dt;
      s.spawnT -= dt;
      if (s.spawnT <= 0) {
        s.spawnT = rand(0.75, 1.35);
        s.obs.push({ type: Math.random() < 0.6 ? 'spike' : 'saw', x: 930, rot: 0 });
      }
      // saute le premier obstacle proche
      const next = s.obs.find((o: any) => o.x > PX);
      const grounded = s.blob.y >= GY - 22 - 0.5;
      if (grounded && next && next.x - PX < 150) {
        s.vy = -940;
        s.puffs.burst(PX, GY, ['#ffffff', accent], 6, [40, 160], 0.3);
      }
      s.vy += 2750 * dt;
      s.blob.y += s.vy * dt;
      if (s.blob.y >= GY - 22) {
        if (s.vy > 250) s.puffs.burst(PX, GY, ['#ffffff88'], 6, [30, 140], 0.3);
        s.blob.y = GY - 22;
        s.vy = 0;
      }
      s.blob.vx = s.scroll; s.blob.vy = s.vy;
      for (let i = s.obs.length - 1; i >= 0; i--) {
        const o = s.obs[i];
        o.x -= s.scroll * dt;
        o.rot += dt * 9;
        if (o.x < 430) s.obs.splice(i, 1);
      }
      for (const d of s.dots) {
        d.x -= s.scroll * d.z * 0.5 * dt;
        if (d.x < 430) d.x = 940;
      }
      s.blob.update(dt);
      s.puffs.update(dt);
    },
    draw(ctx: CanvasRenderingContext2D): void {
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = '#7dd3fc';
      for (const d of s.dots) { ctx.beginPath(); ctx.arc(d.x, d.y, d.z * 2, 0, TAU); ctx.fill(); }
      ctx.globalAlpha = 1;
      // sol
      ctx.strokeStyle = accent + '88';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(430, GY + 22); ctx.lineTo(950, GY + 22); ctx.stroke();
      ctx.globalAlpha = 0.3;
      for (let i = 0; i < 10; i++) {
        const x = 430 + ((i * 60 - (s.t * s.scroll) % 60 + 60) % 520);
        ctx.beginPath(); ctx.moveTo(x, GY + 26); ctx.lineTo(x - 12, GY + 38); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      for (const o of s.obs) {
        if (o.type === 'spike') {
          ctx.fillStyle = '#ff5470';
          ctx.beginPath();
          ctx.moveTo(o.x, GY - 2); ctx.lineTo(o.x + 16, GY + 22); ctx.lineTo(o.x - 16, GY + 22);
          ctx.closePath(); ctx.fill();
        } else {
          ctx.save();
          ctx.translate(o.x, GY + 2);
          ctx.rotate(o.rot);
          ctx.strokeStyle = '#e2e8f0';
          ctx.lineWidth = 3;
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * TAU;
            ctx.beginPath();
            ctx.moveTo(Math.cos(a) * 10, Math.sin(a) * 10);
            ctx.lineTo(Math.cos(a) * 18, Math.sin(a) * 18);
            ctx.stroke();
          }
          ctx.beginPath(); ctx.arc(0, 0, 10, 0, TAU);
          ctx.fillStyle = '#94a3b8'; ctx.fill();
          ctx.restore();
        }
      }
      s.blob.render(ctx);
      s.puffs.draw(ctx);
    },
  };
}

// ---------------- CAVE RACER : tunnel qui respire, near-miss ----------------
function demoCave(accent: string): DemoImpl {
  const s: any = { wx: 0, blob: new Blob({ x: 590, y: 370, r: 15, color: accent, trailOn: true }), puffs: new Puffs(), boost: 0 };
  const cy = (x: number): number => 372 + Math.sin((s.wx + x * 0.55) * 0.011) * 96 + Math.sin((s.wx + x * 0.55) * 0.027) * 30;
  const ch = (x: number): number => 118 + Math.sin((s.wx + x * 0.55) * 0.006 + 2) * 36;
  return {
    update(dt: number): void {
      s.wx += 250 * dt;
      s.boost -= dt;
      if (s.boost <= -rand(2, 3.4)) { s.boost = 0.5; }
      const target = cy(590);
      s.blob.y += (target - s.blob.y) * Math.min(1, dt * 3.2);
      s.blob.vx = 250; s.blob.vy = (target - s.blob.y) * 3;
      const gap = ch(590);
      if (Math.abs(Math.abs(s.blob.y - cy(590)) - gap) < 26) {
        s.puffs.burst(590 + rand(-8, 8), s.blob.y + Math.sign(s.blob.y - cy(590)) * gap * 0.9, ['#ffffff', accent], 2, [20, 100], 0.25);
      }
      s.blob.update(dt);
      s.puffs.update(dt);
    },
    draw(ctx: CanvasRenderingContext2D): void {
      const x0 = 440, x1 = 950;
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = '#0d1220';
      for (let x = x0; x < x1; x += 20) {
        const c = cy(x), h = ch(x);
        ctx.fillRect(x, 0, 21, c - h);
        ctx.fillRect(x, c + h, 21, 720 - c - h);
      }
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let x = x0; x <= x1; x += 14) { const y = cy(x) - ch(x); x === x0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
      ctx.stroke();
      ctx.beginPath();
      for (let x = x0; x <= x1; x += 14) { const y = cy(x) + ch(x); x === x0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
      ctx.stroke();
      ctx.globalAlpha = 1;
      if (s.boost > 0) {
        ctx.globalAlpha = s.boost * 0.5;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        for (let i = 0; i < 4; i++) {
          const y = s.blob.y + rand(-30, 30);
          ctx.beginPath(); ctx.moveTo(s.blob.x - 24, y); ctx.lineTo(s.blob.x - 24 - rand(30, 70), y); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      s.blob.render(ctx);
      s.puffs.draw(ctx);
    },
  };
}

// ---------------- BLOB SIMON : séquence de pads allumés ----------------
function demoSimon(accent: string): DemoImpl {
  const P = [[0, -64], [-64, 0], [64, 0], [0, 64]];
  const cols = ['#f97316', '#38bdf8', '#a3e635', '#fb7185'];
  const s: any = { seq: [], ptr: 0, stepT: 0.8, lit: -1, litT: 0, mode: 'add', cx: 680, cy: 360, t: 0 };
  return {
    update(dt: number): void {
      s.t += dt;
      s.litT -= dt;
      s.stepT -= dt;
      if (s.stepT <= 0) {
        if (s.mode === 'add') {
          s.seq.push((Math.random() * 4) | 0);
          if (s.seq.length >= 6) { s.mode = 'replay'; s.ptr = 0; }
          else { s.mode = 'watch'; s.ptr = 0; }
          s.stepT = 0.34;
        } else {
          if (s.ptr >= s.seq.length) {
            if (s.mode === 'watch') { s.mode = 'add'; s.stepT = 0.6; s.lit = -1; return; }
            // replay fini → reset de la séquence
            s.seq = [];
            s.mode = 'add';
            s.stepT = 0.8;
            s.lit = -1;
            return;
          }
          s.lit = s.seq[s.ptr++];
          s.litT = 0.3;
          s.stepT = s.mode === 'watch' ? 0.44 : 0.34;
        }
      }
    },
    draw(ctx: CanvasRenderingContext2D): void {
      // losange de liaison
      ctx.globalAlpha = 0.14;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(s.cx + P[0][0], s.cy + P[0][1]);
      for (let i = 1; i < 4; i++) ctx.lineTo(s.cx + P[i][0], s.cy + P[i][1]);
      ctx.closePath();
      ctx.stroke();
      ctx.globalAlpha = 1;
      for (let i = 0; i < 4; i++) {
        const on = s.lit === i && s.litT > 0;
        const k = on ? Math.max(0, s.litT) / 0.3 : 0;
        const r = 26 + k * 7;
        ctx.globalAlpha = 0.3 + k * 0.7;
        ctx.fillStyle = cols[i];
        ctx.shadowColor = cols[i];
        ctx.shadowBlur = on ? 30 : 6;
        ctx.beginPath();
        ctx.arc(s.cx + P[i][0], s.cy + P[i][1], r, 0, TAU);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
      ctx.globalAlpha = 1;
    },
  };
}

// ---------------- BLOB SNAKE : serpent IA qui croque des lucioles ----------------
function demoSnake(accent: string): DemoImpl {
  const CELL = 27, OX = 512, OY = 212, COLS = 14, ROWS = 12;
  const px = (c: number): number => OX + (c + 0.5) * CELL;
  let s: any;
  const reset = () => {
    s = {
      cells: [{ x: 6, y: 6 }, { x: 5, y: 6 }, { x: 4, y: 6 }],
      dir: [1, 0], stepT: 0, step: 0.13, food: null, puffs: new Puffs(),
      blob: new Blob({ x: 0, y: 0, r: 11, color: accent, trailOn: true }),
      eaten: 0, t: 0,
    };
    spawn();
    sync();
  };
  const spawn = () => {
    let c: { x: number; y: number };
    do { c = { x: (Math.random() * COLS) | 0, y: (Math.random() * ROWS) | 0 }; }
    while (s.cells.some((p: { x: number; y: number }) => p.x === c.x && p.y === c.y));
    s.food = c;
  };
  const sync = () => {
    s.blob.x = px(s.cells[0].x); s.blob.y = px(s.cells[0].y);
  };
  reset();
  return {
    update(dt: number): void {
      s.t += dt;
      s.stepT += dt;
      while (s.stepT >= s.step) {
        s.stepT -= s.step;
        const head = s.cells[0];
        const f = s.food;
        // candidats : tout droit, gauche, droite — filtrés contre murs + corps
        const dirs: number[][] = [s.dir, [-s.dir[1], s.dir[0]], [s.dir[1], -s.dir[0]]];
        const ok = dirs.filter((d: number[]) => {
          const nx = head.x + d[0], ny = head.y + d[1];
          if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) return false;
          return !s.cells.some((cell: { x: number; y: number }, i: number) => i < s.cells.length - 1 && cell.x === nx && cell.y === ny);
        });
        if (!ok.length) { s.puffs.burst(s.blob.x, s.blob.y, [accent, '#ffffff'], 20, [60, 300], 0.5); reset(); return; }
        // glouton : on suit l'axe le plus éloigné de la luciole
        let best = ok[0], bd = 1e9;
        for (const d of ok) {
          const nx = head.x + d[0], ny = head.y + d[1];
          const dist = Math.abs(nx - f.x) + Math.abs(ny - f.y);
          if (dist < bd) { bd = dist; best = d; }
        }
        s.dir = best;
        const nx = head.x + best[0], ny = head.y + best[1];
        s.cells.unshift({ x: nx, y: ny });
        if (nx === f.x && ny === f.y) {
          s.eaten++;
          s.puffs.burst(px(f.x), px(f.y), ['#fde047', '#ffffff'], 14, [50, 260], 0.45);
          s.blob.punch(0.35);
          if (s.cells.length > 13) s.cells.pop();
          spawn();
        } else s.cells.pop();
        const spd = CELL / s.step;
        s.blob.vx = s.dir[0] * spd; s.blob.vy = s.dir[1] * spd;
        sync();
      }
      s.blob.update(dt);
      s.puffs.update(dt);
    },
    draw(ctx: CanvasRenderingContext2D): void {
      ctx.globalAlpha = 0.09;
      ctx.strokeStyle = '#7dd3fc';
      ctx.lineWidth = 1;
      for (let x = 0; x <= COLS; x++) { ctx.beginPath(); ctx.moveTo(OX + x * CELL, OY); ctx.lineTo(OX + x * CELL, OY + ROWS * CELL); ctx.stroke(); }
      for (let y = 0; y <= ROWS; y++) { ctx.beginPath(); ctx.moveTo(OX, OY + y * CELL); ctx.lineTo(OX + COLS * CELL, OY + y * CELL); ctx.stroke(); }
      ctx.globalAlpha = 1;
      // luciole
      ctx.fillStyle = '#fde047';
      ctx.shadowColor = '#fde047';
      ctx.shadowBlur = 14;
      ctx.globalAlpha = 0.7 + 0.3 * Math.sin(s.t * 5);
      ctx.beginPath(); ctx.arc(px(s.food.x), px(s.food.y), 7, 0, TAU); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      // corps
      const dark = shade(accent, 0.6);
      for (let i = s.cells.length - 1; i >= 1; i--) {
        const c = s.cells[i];
        ctx.globalAlpha = 1 - (i / s.cells.length) * 0.6;
        ctx.fillStyle = dark;
        ctx.beginPath(); ctx.arc(px(c.x), px(c.y), 10 - (i / s.cells.length) * 4.5, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
      s.blob.render(ctx);
      s.puffs.draw(ctx);
    },
  };
}

// ---------------- BLOB BREAKER : balle, paddle, briques ----------------
function demoBreaker(accent: string): DemoImpl {
  const RX0 = 496, RX1 = 872, RY0 = 190, PAD_Y = 548;
  let s: any;
  const build = () => {
    s.bricks = [];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) {
      s.bricks.push({ x: RX0 + 22 + c * 56, y: RY0 + 16 + r * 25, w: 50, h: 18, alive: true, row: r });
    }
  };
  const resetBall = () => {
    s.ball = { x: s.pad.x, y: PAD_Y - 14, vx: rand(-120, 120), vy: -360, stuck: 0.6 };
  };
  s = {
    pad: { x: 660 }, ball: null, puffs: new Puffs(),
    blob: new Blob({ x: 660, y: PAD_Y - 8, r: 12, color: accent }),
  };
  build();
  resetBall();
  return {
    update(dt: number): void {
      const b = s.ball;
      if (b.stuck > 0) {
        b.stuck -= dt;
        b.x = s.pad.x; b.y = PAD_Y - 14;
        if (b.stuck <= 0) { b.vx = rand(-140, 140); b.vy = -390; }
      } else {
        b.x += b.vx * dt; b.y += b.vy * dt;
        if (b.x < RX0 + 8) { b.x = RX0 + 8; b.vx = Math.abs(b.vx); }
        if (b.x > RX1 - 8) { b.x = RX1 - 8; b.vx = -Math.abs(b.vx); }
        if (b.y < RY0 + 8) { b.y = RY0 + 8; b.vy = Math.abs(b.vy); }
        // paddle
        if (b.vy > 0 && b.y > PAD_Y - 12 && b.y < PAD_Y + 6 && Math.abs(b.x - s.pad.x) < 52) {
          b.vy = -Math.abs(b.vy);
          b.vx += (b.x - s.pad.x) * 4;
          s.blob.punch(0.3);
        }
        // briques
        for (const br of s.bricks) {
          if (!br.alive) continue;
          if (b.x > br.x - 5 && b.x < br.x + br.w + 5 && b.y > br.y - 5 && b.y < br.y + br.h + 5) {
            br.alive = false;
            b.vy = -b.vy;
            s.puffs.burst(br.x + br.w / 2, br.y + br.h / 2, [accent, '#ffffff', '#ffd166'], 12, [40, 240], 0.45);
            break;
          }
        }
        if (b.y > 620) resetBall();
        if (!s.bricks.some((br: any) => br.alive)) { build(); resetBall(); }
      }
      s.pad.x += (b.x - s.pad.x) * Math.min(1, dt * 5);
      s.pad.x = Math.max(RX0 + 52, Math.min(RX1 - 52, s.pad.x));
      s.blob.x = s.pad.x; s.blob.y = PAD_Y - 8;
      s.blob.update(dt);
      s.puffs.update(dt);
    },
    draw(ctx: CanvasRenderingContext2D): void {
      ctx.globalAlpha = 0.2;
      ctx.strokeStyle = accent;
      ctx.strokeRect(RX0, RY0, RX1 - RX0, 620 - RY0);
      ctx.globalAlpha = 1;
      for (const br of s.bricks) {
        if (!br.alive) continue;
        ctx.fillStyle = shade(accent, 1 - br.row * 0.18);
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(br.x, br.y, br.w, br.h, 5); else ctx.rect(br.x, br.y, br.w, br.h);
        ctx.fill();
      }
      // balle
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = accent; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.arc(s.ball.x, s.ball.y, 7, 0, TAU); ctx.fill();
      ctx.shadowBlur = 0;
      // paddle
      ctx.fillStyle = accent;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(s.pad.x - 50, PAD_Y - 4, 100, 10, 5); else ctx.rect(s.pad.x - 50, PAD_Y - 4, 100, 10);
      ctx.fill();
      s.blob.render(ctx);
      s.puffs.draw(ctx);
    },
  };
}

// ---------------- BLOB GOLF : trajectoire, drapeau, trou ----------------
function demoGolf(accent: string): DemoImpl {
  const s: any = { seed: 0, t: 0, phase: 'aim', ct: 0, ball: { x: 500, y: 0, vx: 0, vy: 0 }, hole: { x: 880 }, puffs: new Puffs(), landT: 0 };
  const gy = (x: number): number => 505 + Math.sin(x * 0.008 + s.seed * 7) * 34 + Math.sin(x * 0.021 + s.seed * 13) * 13;
  const place = () => {
    s.seed = Math.random() * 100;
    s.ball.x = 500; s.ball.y = gy(500) - 7;
    s.hole.x = rand(790, 900);
    s.hole.y = gy(s.hole.x);
    s.phase = 'aim';
    s.ct = 0;
    s.landT = 0;
  };
  place();
  return {
    update(dt: number): void {
      s.t += dt;
      const b = s.ball;
      if (s.phase === 'aim') {
        s.ct += dt;
        if (s.ct > 0.9) {
          s.phase = 'fly';
          const T = 1.05, g = 1150;
          b.vx = (s.hole.x + rand(-10, 10) - b.x) / T;
          b.vy = -(0.5 * g * T - (s.hole.y - b.y) / T);
        }
      } else if (s.phase === 'fly') {
        b.vy += 1150 * dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        const floor = gy(b.x) - 7;
        if (b.y >= floor) {
          b.y = floor;
          if (Math.abs(b.vy) < 40 || s.landT > 2.5) {
            // roulé jusqu'au trou ?
            if (Math.abs(b.x - s.hole.x) < 18) {
              s.phase = 'in';
              s.puffs.burst(s.hole.x, s.hole.y, ['#ffd166', '#ffffff', accent], 24, [60, 320], 0.7);
              s.inT = 1.4;
            } else if (Math.abs(b.vx) > 30) {
              b.vx *= 0.55; b.vy = 0;
              s.landT += 1;
            } else { s.landT = 0; place(); return; }
          } else {
            b.vy = -Math.abs(b.vy) * 0.42;
            s.puffs.burst(b.x, floor + 7, ['#ffffff88'], 4, [20, 100], 0.3);
          }
        }
      } else if (s.phase === 'in') {
        s.inT -= dt;
        s.ball.y = Math.min(gy(s.hole.x) + 14, s.ball.y + 40 * dt);
        if (s.inT <= 0) { s.landT = 0; place(); return; }
      }
      s.puffs.update(dt);
    },
    draw(ctx: CanvasRenderingContext2D): void {
      // terrain
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#0d1424';
      ctx.beginPath();
      ctx.moveTo(430, 720);
      for (let x = 430; x <= 950; x += 14) ctx.lineTo(x, gy(x));
      ctx.lineTo(950, 720);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 0.8;
      ctx.strokeStyle = accent + 'aa';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let x = 430; x <= 950; x += 14) { const y = gy(x); x === 430 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
      ctx.stroke();
      ctx.globalAlpha = 1;
      // trou + drapeau
      ctx.fillStyle = '#05070d';
      ctx.beginPath(); ctx.ellipse(s.hole.x, s.hole.y + 3, 13, 5, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(s.hole.x, s.hole.y); ctx.lineTo(s.hole.x, s.hole.y - 44); ctx.stroke();
      const wave = Math.sin(s.t * 4) * 3;
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.moveTo(s.hole.x, s.hole.y - 44);
      ctx.lineTo(s.hole.x + 24, s.hole.y - 38 + wave);
      ctx.lineTo(s.hole.x, s.hole.y - 30);
      ctx.closePath(); ctx.fill();
      // visée
      if (s.phase === 'aim') {
        ctx.globalAlpha = 0.4 + 0.2 * Math.sin(s.t * 6);
        ctx.strokeStyle = '#ffffff';
        ctx.setLineDash([5, 9]);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(s.ball.x, s.ball.y);
        ctx.quadraticCurveTo((s.ball.x + s.hole.x) / 2, Math.min(s.ball.y, s.hole.y) - 60, s.hole.x, s.hole.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
      // balle = mini blob blanc
      if (s.phase !== 'in' || s.ball.y < gy(s.hole.x) + 12) {
        ctx.fillStyle = '#f1f5f9';
        ctx.shadowColor = '#ffffff88'; ctx.shadowBlur = 8;
        ctx.beginPath(); ctx.arc(s.ball.x, s.ball.y, 7, 0, TAU); ctx.fill();
        ctx.shadowBlur = 0;
      }
      s.puffs.draw(ctx);
    },
  };
}

// ---------------- BLOB PÊCHE : lancer, touche, remorquage ----------------
function demoFish(accent: string): DemoImpl {
  const WATER = 386, TIP = { x: 556, y: 252 };
  const s: any = {
    phase: 'idle', t: 0, bob: { x: TIP.x, y: TIP.y }, fish: { x: 880, y: 470, ph: 0 },
    fisher: new Blob({ x: 508, y: 306, r: 17, color: accent }),
    puffs: new Puffs(), jig: 0, text: null, textT: 0, waveT: 0,
  };
  const cast = () => { s.phase = 'cast'; s.t = 0; };
  return {
    update(dt: number): void {
      s.t += dt;
      s.waveT += dt;
      s.textT -= dt;
      s.fisher.update(dt);
      if (s.phase === 'idle' && s.t > 1.1) { cast(); s.puffs.burst(TIP.x, TIP.y, ['#ffffff'], 5, [30, 140], 0.3); }
      else if (s.phase === 'cast') {
        const k = Math.min(1, s.t / 0.55);
        s.bob.x = TIP.x + (735 - TIP.x) * k;
        s.bob.y = TIP.y + (WATER - TIP.y) * k * k + Math.sin(k * Math.PI) * -70;
        if (k >= 1) {
          s.phase = 'sink'; s.t = 0;
          s.puffs.burst(s.bob.x, WATER, ['#7dd3fc', '#ffffff'], 14, [30, 200], 0.5);
        }
      } else if (s.phase === 'sink') {
        s.bob.y = Math.min(474, WATER + 12 + s.t * 46);
        if (s.bob.y >= 474) { s.phase = 'wait'; s.t = 0; s.fish.x = 900; s.fish.y = 468 + rand(-16, 16); }
      } else if (s.phase === 'wait') {
        // le poisson s'approche
        s.fish.x += (s.bob.x + 34 - s.fish.x) * Math.min(1, dt * 1.6);
        s.fish.ph += dt * 6;
        s.bob.y = 474 + Math.sin(s.t * 2.4) * 3;
        if (s.t > 1.6) { s.phase = 'bite'; s.t = 0; s.jig = 0; }
      } else if (s.phase === 'bite') {
        s.bob.y = 474 + Math.sin(s.t * 26) * 5;
        if (s.t > 0.7) {
          s.phase = 'hook'; s.t = 0;
          s.puffs.burst(s.bob.x, s.bob.y, ['#ffffff', '#7dd3fc'], 10, [40, 200], 0.4);
        }
      } else if (s.phase === 'hook') {
        s.bob.y = 482;
        if (s.t > 0.4) { s.phase = 'reel'; s.t = 0; }
      } else if (s.phase === 'reel') {
        const k = Math.min(1, s.t / 1.1);
        s.bob.x = 735 + (TIP.x - 735) * k;
        s.bob.y = 482 + (TIP.y - 482) * (k * k);
        s.fish.x = s.bob.x + 30 - k * 12;
        s.fish.y = s.bob.y + 12;
        s.fish.ph += dt * 16;   // se débat
        if (Math.abs(s.bob.y - WATER) < 8 && !s._splashed) {
          s._splashed = true;
          s.puffs.burst(s.bob.x, WATER, ['#7dd3fc', '#ffffff'], 16, [40, 240], 0.5);
        }
        if (k >= 1) {
          s.phase = 'idle'; s.t = 0; s._splashed = false;
          s.text = '+' + (rand(0.6, 3.4)).toFixed(1) + ' kg';
          s.textT = 1.4;
        }
      }
      s.puffs.update(dt);
    },
    draw(ctx: CanvasRenderingContext2D): void {
      // ponton
      ctx.fillStyle = '#3b2f22';
      ctx.fillRect(430, 318, 118, 12);
      ctx.fillStyle = '#2a2118';
      ctx.fillRect(446, 330, 8, 26);
      ctx.fillRect(522, 330, 8, 26);
      s.fisher.render(ctx);
      // canne + fil
      ctx.strokeStyle = '#c8d2e0';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(516, 302); ctx.quadraticCurveTo(542, 262, TIP.x, TIP.y); ctx.stroke();
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(TIP.x, TIP.y); ctx.lineTo(s.bob.x, s.bob.y); ctx.stroke();
      ctx.globalAlpha = 1;
      // eau
      ctx.globalAlpha = 0.35;
      const g = ctx.createLinearGradient(0, WATER, 0, 640);
      g.addColorStop(0, '#0c2a3f');
      g.addColorStop(1, '#071522');
      ctx.fillStyle = g;
      ctx.fillRect(430, WATER, 520, 720 - WATER);
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = '#7dd3fc';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let x = 430; x <= 950; x += 10) {
        const y = WATER + Math.sin(x * 0.05 + s.waveT * 2.2) * 2.5;
        x === 430 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      // poisson (visible sous l'eau ou pendu au fil)
      const underwater = s.phase === 'wait' || s.phase === 'sink' || s.phase === 'bite' || s.phase === 'hook' || (s.phase === 'reel' && s.fish.y > WATER);
      if (underwater) ctx.globalAlpha = 0.5;
      const flap = Math.sin(s.fish.ph) * 0.35;
      ctx.save();
      ctx.translate(s.fish.x, s.fish.y);
      ctx.rotate(flap * 0.3);
      ctx.fillStyle = '#fb7185';
      ctx.beginPath(); ctx.ellipse(0, 0, 17, 9, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-15, 0); ctx.lineTo(-26, -8 + flap * 8); ctx.lineTo(-26, 8 + flap * 8); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#0b0e14';
      ctx.beginPath(); ctx.arc(9, -2, 1.8, 0, TAU); ctx.fill();
      ctx.restore();
      ctx.globalAlpha = 1;
      // bouchon
      ctx.fillStyle = '#ff5470';
      ctx.beginPath(); ctx.arc(s.bob.x, s.bob.y, 6, Math.PI, TAU); ctx.fill();
      ctx.fillStyle = '#f8fafc';
      ctx.beginPath(); ctx.arc(s.bob.x, s.bob.y, 6, 0, Math.PI); ctx.fill();
      // "!" à la touche
      if (s.phase === 'bite') {
        ctx.font = '900 26px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffd166';
        ctx.fillText('!', s.bob.x, s.bob.y - 18);
      }
      if (s.textT > 0) {
        ctx.globalAlpha = Math.min(1, s.textT);
        ctx.font = '800 20px Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#7dd3fc';
        ctx.fillText(s.text, TIP.x + 60, 220 - (1.4 - s.textT) * 26);
        ctx.globalAlpha = 1;
      }
      s.puffs.draw(ctx);
    },
  };
}

// ---------------- DR BLOB : trio qui tombe, groupes qui éclatent ----------------
function demoColumns(accent: string): DemoImpl {
  const COLS = 6, ROWS = 9, CELL = 34, OX = 512, OY = 190;
  const cols = ['#f472b6', '#22d3ee', '#22c55e', '#fbbf24', '#c084fc'];
  const px = (c: number): number => OX + (c + 0.5) * CELL;
  const py = (r: number): number => OY + (r + 0.5) * CELL;
  let s: any;
  const trio = (): number[] => [0, 1, 2].map(() => (Math.random() * cols.length) | 0);
  const reset = () => {
    const grid: number[][] = [];
    for (let r = 0; r < ROWS; r++) grid.push(new Array(COLS).fill(-1));
    // socle bas prédéfini avec un trou stratégique pour la démo
    for (let c = 0; c < COLS; c++) {
      grid[ROWS - 1][c] = (c * 2 + 1) % cols.length;
      if (c !== 2) grid[ROWS - 2][c] = (c + 2) % cols.length;
    }
    grid[ROWS - 1][2] = 1;
    grid[ROWS - 2][2] = 1;
    grid[ROWS - 3][2] = 1;
    s = {
      grid, active: { c: 2, r: -2, colors: [1, 1, 2] }, fallT: 0,
      clear: null as null | { cells: any[]; t: number },
      puffs: new Puffs(), t: 0,
      blob: new Blob({ x: 0, y: 0, r: 13, color: accent }),
    };
  };
  // Même règle que le jeu : groupes liés orthogonaux de 4+, diagonales ignorées.
  const matches = (): any[] => {
    const out: any[] = [];
    const seen = new Set<number>();
    const todo: any[] = [];
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const v = s.grid[r][c];
      if (v < 0 || seen.has(r * COLS + c)) continue;
      const group: any[] = [];
      todo.length = 0;
      todo.push({ r, c });
      seen.add(r * COLS + c);
      while (todo.length) {
        const cur = todo.pop();
        group.push(cur);
        for (const [dr, dc] of dirs) {
          const nr = cur.r + dr, nc = cur.c + dc;
          if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
          if (s.grid[nr][nc] !== v || seen.has(nr * COLS + nc)) continue;
          seen.add(nr * COLS + nc);
          todo.push({ r: nr, c: nc });
        }
      }
      if (group.length >= 4) for (const cell of group) out.push(cell);
    }
    return out;
  };
  const gravity = () => {
    for (let c = 0; c < COLS; c++) {
      let w = ROWS - 1;
      for (let r = ROWS - 1; r >= 0; r--) {
        if (s.grid[r][c] >= 0) { s.grid[w][c] = s.grid[r][c]; if (w !== r) s.grid[r][c] = -1; w--; }
      }
      for (let r = w; r >= 0; r--) s.grid[r][c] = -1;
    }
  };
  reset();
  return {
    update(dt: number): void {
      s.t += dt;
      if (s.clear) {
        s.clear.t -= dt;
        if (s.clear.t <= 0) {
          for (const cell of s.clear.cells) {
            s.puffs.burst(px(cell.c), py(cell.r), [cols[s.grid[cell.r][cell.c]] || '#fff', '#ffffff'], 10, [50, 260], 0.45);
            s.grid[cell.r][cell.c] = -1;
          }
          gravity();
          const m = matches();
          s.clear = m.length ? { cells: m, t: 0.4 } : null;
          if (!m.length && Math.random() < 0.25) reset();
        }
        s.puffs.update(dt);
        return;
      }
      if (!s.active) {
        s.active = { c: (Math.random() * COLS) | 0, r: -2, colors: trio() };
        s.fallT = 0;
        return;
      }
      s.fallT += dt;
      const step = 0.16;
      // petit pilotage : vise la colonne 2 pour boucler une démo lisible
      if (Math.random() < dt * 3 && s.active.c !== 2) s.active.c += Math.sign(2 - s.active.c);
      while (s.fallT >= step) {
        s.fallT -= step;
        let blocked = false;
        for (let i = 0; i < 3; i++) {
          const rr = s.active.r + i + 1, cc = s.active.c;
          if (rr >= ROWS || (rr >= 0 && s.grid[rr][cc] >= 0)) { blocked = true; break; }
        }
        if (blocked) {
          for (let i = 0; i < 3; i++) {
            const rr = s.active.r + i;
            if (rr >= 0) s.grid[rr][s.active.c] = s.active.colors[i];
          }
          s.active = null;
          const m = matches();
          if (m.length) s.clear = { cells: m, t: 0.4 };
          break;
        } else s.active.r++;
      }
      // recycle si ça déborde
      if (s.grid[0].some((v: number) => v >= 0) && s.grid[1].some((v: number) => v >= 0)) reset();
      s.blob.update(dt);
      s.puffs.update(dt);
    },
    draw(ctx: CanvasRenderingContext2D): void {
      ctx.globalAlpha = 0.25;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(OX, OY, COLS * CELL, ROWS * CELL);
      ctx.globalAlpha = 1;
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        const v = s.grid[r][c];
        if (v < 0) continue;
        const hot = s.clear && s.clear.cells.some((cell: any) => cell.r === r && cell.c === c);
        ctx.globalAlpha = hot ? 0.6 + 0.4 * Math.sin(s.t * 30) : 1;
        ctx.fillStyle = cols[v];
        ctx.shadowColor = cols[v];
        ctx.shadowBlur = hot ? 22 : 8;
        ctx.beginPath(); ctx.arc(px(c), py(r), hot ? 15 : 13, 0, TAU); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.beginPath(); ctx.arc(px(c) - 4, py(r) - 5, 3.4, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (s.active) {
        for (let i = 0; i < 3; i++) {
          const rr = s.active.r + i;
          if (rr < 0) continue;
          ctx.fillStyle = cols[s.active.colors[i]];
          ctx.shadowColor = cols[s.active.colors[i]];
          ctx.shadowBlur = 12;
          ctx.beginPath(); ctx.arc(px(s.active.c), py(rr), 13, 0, TAU); ctx.fill();
          ctx.shadowBlur = 0;
        }
      }
      s.puffs.draw(ctx);
    },
  };
}

// ---------------- BLOB POP : tir de bulles sur grappe hexagonale ----------------
function demoBubble(accent: string): DemoImpl {
  const COLS = 8, ROWS = 7, R = 26, RH = R * 1.732;
  const OX = 540, OY = 210, SX = 690, SY = 590;
  const cols = ['#f472b6', '#22d3ee', '#22c55e', '#fbbf24', '#c084fc'];
  const cc = (r: number, c: number): { x: number; y: number } => ({
    x: OX + c * 2 * R + (r % 2 === 1 ? R : 0),
    y: OY + r * RH,
  });
  const s: any = { grid: [], shots: [], fireT: 0.5, t: 0, aim: 0, puffs: new Puffs() };
  const refill = () => {
    s.grid = [];
    for (let r = 0; r < ROWS; r++) {
      const row: number[] = [];
      for (let c = 0; c < COLS; c++) row.push(r < 4 ? (Math.random() * cols.length) | 0 : -1);
      s.grid.push(row);
    }
  };
  const neighbors = (r: number, c: number): any[] => {
    const odd = r % 2 === 1;
    const ds = odd ? [[1, 0], [-1, 0], [1, -1], [0, -1], [1, 1], [0, 1]] : [[1, 0], [-1, 0], [0, -1], [-1, -1], [0, 1], [-1, 1]];
    return ds.map(([dc, dr]) => ({ r: r + dr, c: c + dc }))
      .filter((p: any) => p.r >= 0 && p.r < ROWS && p.c >= 0 && p.c < COLS);
  };
  const flood = (r: number, c: number): any[] => {
    const v = s.grid[r][c];
    if (v < 0) return [];
    const seen = new Set([r * 100 + c]);
    const stack = [{ r, c }];
    while (stack.length) {
      const cur = stack.pop() as { r: number; c: number };
      for (const nb of neighbors(cur.r, cur.c)) {
        const k = nb.r * 100 + nb.c;
        if (!seen.has(k) && s.grid[nb.r][nb.c] === v) { seen.add(k); stack.push(nb); }
      }
    }
    return Array.from(seen).map((k: any) => ({ r: Math.floor(k / 100), c: k % 100 }));
  };
  refill();
  return {
    update(dt: number): void {
      s.t += dt;
      s.aim = Math.sin(s.t * 0.8) * 0.7;
      s.fireT -= dt;
      if (s.fireT <= 0 && s.shots.length < 3) {
        s.fireT = 0.9;
        s.shots.push({ x: SX, y: SY - 30, vx: Math.sin(s.aim) * 520, vy: -Math.cos(s.aim) * 520, color: (Math.random() * cols.length) | 0 });
      }
      for (let i = s.shots.length - 1; i >= 0; i--) {
        const b = s.shots[i];
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        if (b.x < OX - R + 8) { b.x = OX - R + 8; b.vx = Math.abs(b.vx); }
        if (b.x > OX + COLS * 2 * R - 8) { b.x = OX + COLS * 2 * R - 8; b.vx = -Math.abs(b.vx); }
        if (b.y <= OY + 20 || Math.random() < dt * 0.8) {
          // colle : cherche la cellule libre la plus proche
          let best = null, bd = 1e9;
          for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
            if (s.grid[r][c] >= 0) continue;
            const p = cc(r, c);
            const d = (p.x - b.x) * (p.x - b.x) + (p.y - b.y) * (p.y - b.y);
            if (d < bd) { bd = d; best = { r, c }; }
          }
          if (best) {
            s.grid[best.r][best.c] = b.color;
            const group = flood(best.r, best.c);
            if (group.length >= 3) {
              for (const cell of group) {
                const p = cc(cell.r, cell.c);
                s.puffs.burst(p.x, p.y, [cols[s.grid[cell.r][cell.c]], '#ffffff'], 12, [60, 300], 0.5);
                s.grid[cell.r][cell.c] = -1;
              }
            }
          }
          s.shots.splice(i, 1);
        }
      }
      // recycle : la grappe se régénère en boucle pour l'attract mode
      let filled = 0;
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (s.grid[r][c] >= 0) filled++;
      if (filled < 8) refill();
      s.puffs.update(dt);
    },
    draw(ctx: CanvasRenderingContext2D): void {
      ctx.globalAlpha = 0.25;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(OX - R - 6, OY - R - 6, COLS * 2 * R + 12, ROWS * RH + 12);
      ctx.globalAlpha = 1;
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        const v = s.grid[r][c];
        if (v < 0) continue;
        const p = cc(r, c);
        ctx.fillStyle = cols[v];
        ctx.shadowColor = cols[v];
        ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.arc(p.x, p.y, R - 3, 0, TAU); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.beginPath(); ctx.arc(p.x - 6, p.y - 8, 5, 0, TAU); ctx.fill();
      }
      // canon + viseur
      ctx.strokeStyle = '#ffffff88';
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.moveTo(SX, SY - 30);
      ctx.lineTo(SX + Math.sin(s.aim) * 130, SY - 30 - Math.cos(s.aim) * 130);
      ctx.stroke();
      ctx.setLineDash([]);
      for (const b of s.shots) {
        ctx.fillStyle = cols[b.color];
        ctx.shadowColor = cols[b.color];
        ctx.shadowBlur = 14;
        ctx.beginPath(); ctx.arc(b.x, b.y, R - 3, 0, TAU); ctx.fill();
        ctx.shadowBlur = 0;
      }
      s.puffs.draw(ctx);
    },
  };
}

// ---------------- fallback : blobs flottants ----------------
function demoFallback(accent: string): DemoImpl {
  const s: any = { blobs: [], t: 0 };
  for (let i = 0; i < 5; i++) {
    const b = new Blob({ x: rand(500, 900), y: rand(200, 560), r: rand(12, 26), color: accent });
    b.vx = rand(-60, 60); b.vy = rand(-60, 60);
    s.blobs.push(b);
  }
  return {
    update(dt: number): void {
      s.t += dt;
      for (const b of s.blobs) {
        b.x += b.vx * dt; b.y += b.vy * dt;
        if (b.x < 470 || b.x > 920) b.vx *= -1;
        if (b.y < 170 || b.y > 590) b.vy *= -1;
        b.update(dt);
      }
    },
    draw(ctx: CanvasRenderingContext2D): void { for (const b of s.blobs) b.render(ctx); },
  };
}

// ---------------- BLOB TRI : le centre distribue vers quatre garages ----------------
function demoSort(accent: string): DemoImpl {
  const colors = ['#facc15', '#38bdf8', '#fb7185', '#4ade80'];
  const targets = [[640, 205], [420, 365], [860, 365], [640, 535]] as const;
  const s: any = {
    t: 0,
    wait: 0.35,
    index: 0,
    intruder: false,
    blob: new Blob({ x: 640, y: 365, r: 28, color: colors[0], trailOn: true }),
    parked: [[], [], [], []],
    puffs: new Puffs(),
  };
  const reset = (): void => {
    s.index = (s.index + 1) % 5;
    s.intruder = s.index === 4;
    const colorIndex = s.index % 4;
    s.blob = new Blob({ x: 640, y: 365, r: 28, color: s.intruder ? '#a8b0be' : colors[colorIndex], trailOn: true });
    s.blob.setEmotion(s.intruder ? 'determined' : 'focused');
    s.fromX = 640; s.fromY = 365;
    s.toX = s.intruder ? 640 : targets[colorIndex][0];
    s.toY = s.intruder ? 100 : targets[colorIndex][1];
    s.t = 0;
    s.wait = 0;
  };
  return {
    update(dt: number): void {
      if (s.wait > 0) {
        s.wait -= dt;
        s.blob.update(dt);
        if (s.wait <= 0) reset();
        return;
      }
      s.t += dt / 0.65;
      const k = Math.min(1, s.t);
      const e = 1 - Math.pow(1 - k, 3);
      s.blob.x = s.fromX + (s.toX - s.fromX) * e;
      s.blob.y = s.fromY + (s.toY - s.fromY) * e;
      s.blob.vx = (s.toX - s.fromX) * 2;
      s.blob.vy = (s.toY - s.fromY) * 2;
      s.blob.update(dt);
      s.puffs.update(dt);
      if (k >= 1) {
        if (!s.intruder) {
          const parked = new Blob({ x: s.toX + rand(-28, 28), y: s.toY + rand(-16, 16), r: 9, color: s.blob.color });
          parked.setEmotion('happy');
          s.parked[s.index].push(parked);
          if (s.parked[s.index].length > 8) s.parked[s.index].shift();
        }
        s.puffs.burst(s.toX, s.toY, [s.blob.color, '#ffffff'], 12, [50, 220], 0.45);
        s.wait = 0.3;
      }
      for (const group of s.parked) for (const blob of group) blob.update(dt);
    },
    draw(ctx: CanvasRenderingContext2D): void {
      ctx.save();
      ctx.strokeStyle = accent + '28';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 8]);
      for (let i = 0; i < 4; i++) {
        const [x, y] = targets[i];
        ctx.strokeRect(x - 72, y - 42, 144, 84);
        ctx.fillStyle = colors[i] + '18';
        ctx.fillRect(x - 72, y - 42, 144, 84);
        ctx.fillStyle = colors[i];
        ctx.globalAlpha = 0.8;
        ctx.beginPath(); ctx.arc(x, y, 5, 0, TAU); ctx.fill();
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      for (const group of s.parked) for (const blob of group) blob.render(ctx);
      s.blob.render(ctx);
      if (s.intruder) {
        ctx.strokeStyle = '#10131c'; ctx.lineWidth = 5; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(s.blob.x - 11, s.blob.y - 11); ctx.lineTo(s.blob.x + 11, s.blob.y + 11);
        ctx.moveTo(s.blob.x + 11, s.blob.y - 11); ctx.lineTo(s.blob.x - 11, s.blob.y + 11); ctx.stroke();
      }
      s.puffs.draw(ctx);
      ctx.restore();
    },
  };
}

// ---------------- BLOB TRACE : chemin mémorisé puis parcouru ----------------
function demoPath(accent: string): DemoImpl {
  const path = [
    [0, 3], [1, 3], [1, 2], [2, 2], [2, 3], [3, 3],
    [3, 2], [4, 2], [4, 1], [3, 1], [3, 0], [4, 0],
  ] as const;
  const cell = 76;
  const left = 640 - cell * 2.5;
  const top = 350 - cell * 2;
  const center = (p: readonly [number, number]): { x: number; y: number } => ({ x: left + (p[0] + 0.5) * cell, y: top + (p[1] + 0.5) * cell });
  const s: any = {
    t: 0,
    phase: 'reveal',
    index: 0,
    blob: new Blob({ ...center(path[0]), r: 18, color: accent, trailOn: true }),
    puffs: new Puffs(),
  };
  return {
    update(dt: number): void {
      s.t += dt;
      if (s.phase === 'reveal') {
        if (s.t > 2.1) { s.phase = 'walk'; s.t = 0; s.index = 0; }
      } else {
        const span = 0.3;
        const k = Math.min(1, s.t / span);
        const a = center(path[s.index]);
        const b = center(path[Math.min(path.length - 1, s.index + 1)]);
        const e = 1 - Math.pow(1 - k, 3);
        s.blob.x = a.x + (b.x - a.x) * e;
        s.blob.y = a.y + (b.y - a.y) * e - Math.sin(k * Math.PI) * 8;
        s.blob.vx = (b.x - a.x) * 5;
        s.blob.vy = (b.y - a.y) * 5;
        if (k >= 1) {
          s.index++;
          s.t = 0;
          s.blob.punch(0.22);
          s.puffs.burst(b.x, b.y, [accent, '#ffffff'], 6, [25, 120], 0.35);
          if (s.index >= path.length - 1) {
            s.phase = 'reveal'; s.t = 0; s.index = 0;
            const start = center(path[0]); s.blob.x = start.x; s.blob.y = start.y;
          }
        }
      }
      s.blob.update(dt);
      s.puffs.update(dt);
    },
    draw(ctx: CanvasRenderingContext2D): void {
      ctx.save();
      ctx.strokeStyle = '#ffffff12';
      ctx.lineWidth = 1;
      for (let i = 0; i <= 5; i++) {
        ctx.beginPath(); ctx.moveTo(left + i * cell, top); ctx.lineTo(left + i * cell, top + 4 * cell); ctx.stroke();
      }
      for (let i = 0; i <= 4; i++) {
        ctx.beginPath(); ctx.moveTo(left, top + i * cell); ctx.lineTo(left + 5 * cell, top + i * cell); ctx.stroke();
      }
      const visible = s.phase === 'reveal' ? Math.ceil((path.length - 1) * Math.min(1, s.t / 1.25)) : s.index;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 9;
      ctx.lineCap = 'round';
      ctx.shadowColor = accent;
      ctx.shadowBlur = 17;
      for (let i = 0; i < visible; i++) {
        const a = center(path[i]); const b = center(path[i + 1]);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      ctx.shadowBlur = 0;
      const start = center(path[0]); const end = center(path[path.length - 1]);
      ctx.fillStyle = '#4ade80'; ctx.beginPath(); ctx.arc(start.x, start.y, 7, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fef08a'; ctx.beginPath(); ctx.arc(end.x, end.y, 9, 0, TAU); ctx.fill();
      s.blob.render(ctx);
      s.puffs.draw(ctx);
      ctx.restore();
    },
  };
}

// ---------------- BLOB FROGGER : route + rivière, hops vers les alcôves ----------------
function demoFrog(accent: string): DemoImpl {
  const L = 480, CW = 64, ROWS = 7, TOP = 190;
  const cy = (r: number): number => TOP + (r + 0.5) * ((590 - TOP) / ROWS);
  const cx = (c: number): number => L + (c + 0.5) * CW;
  const s: any = {
    t: 0, hopT: 0, c: 3, r: 6,
    fx: 0, fy: 0, tx: 0, ty: 0, hopping: false,
    blob: new Blob({ x: 0, y: 0, r: 14, color: accent }),
    cars: [
      { r: 4, x: 500, w: 70, v: 130, col: '#ff5470' },
      { r: 4, x: 780, w: 70, v: 130, col: '#fbbf24' },
      { r: 3, x: 650, w: 110, v: -170, col: '#c084fc' },
    ],
    logs: [
      { r: 1, x: 560, w: 150, v: -70 },
      { r: 2, x: 720, w: 130, v: 95 },
    ],
    puffs: new Puffs(),
  };
  s.blob.x = cx(3); s.blob.y = cy(6);
  return {
    update(dt: number): void {
      s.t += dt;
      for (const c of s.cars) {
        c.x += c.v * dt;
        if (c.x > 960) c.x = 440;
        if (c.x + c.w < 440) c.x = 950 - c.w;
      }
      for (const l of s.logs) {
        l.x += l.v * dt;
        if (l.x > 950) l.x = 440 - l.w;
        if (l.x + l.w < 440) l.x = 950;
      }
      if (s.hopping) {
        s.hopT += dt / 0.16;
        const k = Math.min(1, s.hopT);
        const e = 1 - Math.pow(1 - k, 3);
        s.blob.x = s.fx + (s.tx - s.fx) * e;
        s.blob.y = s.fy + (s.ty - s.fy) * e - Math.sin(k * Math.PI) * 10;
        if (k >= 1) {
          s.hopping = false;
          s.blob.punch(0.25);
          s.puffs.burst(s.tx, s.ty + 10, [accent, '#ffffff'], 5, [30, 130], 0.3);
          if (s.r === 0) {
            s.puffs.burst(s.tx, s.ty, ['#fef08a', accent, '#ffffff'], 20, [60, 300], 0.6);
            s.c = 3; s.r = 6;
            s.blob.x = cx(3); s.blob.y = cy(6);
          }
        }
      } else {
        // ride sur rondin ?
        if (s.r === 1 || s.r === 2) {
          const lane = s.r === 1 ? s.logs[0] : s.logs[1];
          s.blob.x += lane.v * dt * 0.9;
        }
        s.hopCd = (s.hopCd || 0) - dt;
        if ((s.hopCd || 0) <= 0) {
          s.hopCd = 0.42;
          let nc = s.c, nr = s.r - 1;
          if (nr < 0) { nr = 6; nc = 3; }
          if (Math.random() < 0.3) nc = Math.max(0, Math.min(6, nc + (Math.random() < 0.5 ? -1 : 1)));
          s.fx = s.blob.x; s.fy = s.blob.y;
          s.tx = cx(nc); s.ty = cy(nr);
          s.c = nc; s.r = nr;
          s.hopping = true; s.hopT = 0;
          s.blob.punch(0.3);
        }
      }
      s.blob.update(dt);
      s.puffs.update(dt);
    },
    draw(ctx: CanvasRenderingContext2D): void {
      // eau (2 rangées) + route (2 rangées)
      ctx.fillStyle = '#06283a';
      ctx.fillRect(440, cy(1) - 26, 510, 108);
      ctx.fillStyle = '#161a24';
      ctx.fillRect(440, cy(3) - 26, 510, 108);
      ctx.fillStyle = 'rgba(250,204,21,0.35)';
      for (let x = 450; x < 940; x += 44) ctx.fillRect(x, cy(3) + cy(4) - cy(3) - 28, 22, 3);
      ctx.strokeStyle = '#5eead455';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let x = 440; x <= 950; x += 10) {
        const y = cy(1) + Math.sin(x * 0.04 + s.t * 3) * 3;
        x === 440 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
      for (const l of s.logs) {
        ctx.fillStyle = '#7a5230';
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(l.x, cy(l.r) - 13, l.w, 26, 12); else ctx.rect(l.x, cy(l.r) - 13, l.w, 26);
        ctx.fill();
        ctx.fillStyle = '#a97a4a';
        ctx.fillRect(l.x + 6, cy(l.r) - 10, l.w - 12, 5);
      }
      for (const c of s.cars) {
        ctx.fillStyle = c.col;
        ctx.shadowColor = c.col; ctx.shadowBlur = 10;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(c.x, cy(c.r) - 13, c.w, 26, 10); else ctx.rect(c.x, cy(c.r) - 13, c.w, 26);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#0b1220';
        ctx.fillRect(c.x + c.w / 2 - 14, cy(c.r) - 8, 28, 16);
      }
      // alcôves
      for (let i = 0; i < 3; i++) {
        const hx = cx(i * 2 + 1);
        ctx.fillStyle = '#02040a';
        ctx.beginPath(); ctx.ellipse(hx, cy(0), 24, 15, 0, 0, TAU); ctx.fill();
        ctx.strokeStyle = accent + '88'; ctx.lineWidth = 2; ctx.stroke();
      }
      s.blob.render(ctx);
      s.puffs.draw(ctx);
    },
  };
}

// ---------------- FLAPPY BLOB : pilote auto à travers les arches ----------------
function demoFlap(accent: string): DemoImpl {
  const BX = 620, GY = 590;
  const s: any = {
    t: 0, vy: 0, y: 360,
    blob: new Blob({ x: BX, y: 360, r: 15, color: accent }),
    pipes: [
      { x: 780, gapY: 330, gapH: 190 },
      { x: 780 + 330, gapY: 430, gapH: 190 },
    ],
    puffs: new Puffs(),
  };
  return {
    update(dt: number): void {
      s.t += dt;
      // IA : bat quand le blob passe sous le centre de la prochaine arche.
      const next = s.pipes.find((p: any) => p.x + 50 > BX - 15) || s.pipes[0];
      if (s.y > next.gapY + 12) {
        s.vy = -640;
        s.blob.punch(0.35);
        s.puffs.burst(BX - 6, s.y + 14, [accent, '#ffffff'], 5, [40, 180], 0.3);
      }
      s.vy = Math.min(880, s.vy + 2300 * dt);
      s.y += s.vy * dt;
      if (s.y > GY - 15) { s.y = GY - 15; s.vy = -640; }
      if (s.y < 190) { s.y = 190; s.vy = Math.max(0, s.vy); }
      for (const p of s.pipes) {
        const before = p.x;
        p.x -= 240 * dt;
        if (!p.scored && before + 50 >= BX - 15 && p.x + 50 < BX - 15) {
          p.scored = true;
          s.puffs.burst(BX + 50, s.y, ['#f2c94c', accent, '#ffffff'], 12, [60, 260], 0.45);
        }
        if (p.x + 50 < 430) {
          p.x = 950;
          p.gapY = rand(280, 480);
          p.scored = false;
        }
      }
      s.blob.x = BX;
      s.blob.y = s.y;
      s.blob.vx = 90;
      s.blob.vy = s.vy;
      s.blob.update(dt);
      s.puffs.update(dt);
    },
    draw(ctx: CanvasRenderingContext2D): void {
      ctx.fillStyle = '#131a12';
      ctx.fillRect(430, GY, 520, 720 - GY);
      ctx.fillStyle = '#4ade80';
      ctx.fillRect(430, GY, 520, 2);
      for (const p of s.pipes) {
        ctx.fillStyle = '#1c2942';
        ctx.fillRect(p.x, 150, 100, p.gapY - p.gapH / 2 - 150);
        ctx.fillRect(p.x, p.gapY + p.gapH / 2, 100, GY - (p.gapY + p.gapH / 2));
        ctx.fillStyle = accent;
        ctx.fillRect(p.x - 5, p.gapY - p.gapH / 2 - 20, 110, 20);
        ctx.fillRect(p.x - 5, p.gapY + p.gapH / 2, 110, 20);
      }
      s.blob.render(ctx);
      s.puffs.draw(ctx);
    },
  };
}

// ---------------- BLOB DIGGER : le mineur creuse, un rocher guette ----------------
function demoDig(accent: string): DemoImpl {
  const X0 = 560, CELL = 62, TOP = 210;
  const cx = (c: number): number => X0 + (c + 0.5) * CELL;
  const cy = (r: number): number => TOP + (r + 0.5) * CELL;
  const s: any = {
    t: 0, stepT: 0, r: 0,
    blob: new Blob({ x: cx(3), y: cy(0), r: 16, color: accent }),
    dug: [true, false, false, false, false, false],
    rockY: cy(1), rockFalling: false, rockT: 0,
    gemTaken: false, gemT: 0,
    puffs: new Puffs(),
  };
  return {
    update(dt: number): void {
      s.t += dt;
      s.stepT += dt;
      // Descente scriptée : creuse une case toutes les 0.5 s, boucle en bas.
      if (s.stepT > 0.5 && s.r < 5) {
        s.stepT = 0;
        s.r += 1;
        s.dug[s.r] = true;
        s.blob.punch(0.35);
        s.puffs.burst(cx(3), cy(s.r), ['#8a5a33', '#c98d54', '#ffffff'], 8, [40, 200], 0.4);
        if (s.r === 4 && !s.gemTaken) {
          s.gemTaken = true;
          s.gemT = 0;
          s.puffs.burst(cx(4), cy(4), ['#22d3ee', '#ffffff'], 16, [60, 300], 0.6);
        }
        if (s.r === 2 && !s.rockFalling) {
          s.rockFalling = true;
          s.rockT = 0;
        }
      }
      if (s.r >= 5) {
        s.r = 0;
        s.dug = [true, false, false, false, false, false];
        s.rockFalling = false;
        s.rockY = cy(1);
        s.gemTaken = false;
      }
      // Le rocher éventré dégringole une fois le mineur passé dessous.
      if (s.rockFalling && s.rockY < cy(4)) {
        s.rockT += dt;
        s.rockY = Math.min(cy(4), cy(1) + s.rockT * s.rockT * 900);
      }
      const ty = cy(s.r);
      s.blob.x += (cx(3) - s.blob.x) * Math.min(1, dt * 10);
      s.blob.y += (ty - s.blob.y) * Math.min(1, dt * 10);
      s.blob.vx = 0;
      s.blob.vy = 200;
      s.blob.update(dt);
      s.puffs.update(dt);
    },
    draw(ctx: CanvasRenderingContext2D): void {
      for (let r = 0; r < 6; r++) {
        for (let c = 1; c < 6; c++) {
          const dug = (c === 3 && s.dug[r]) || (r === 4 && c === 4 && s.gemTaken);
          ctx.fillStyle = dug ? '#0b0906' : '#6b4226';
          ctx.fillRect(X0 + c * CELL, TOP + r * CELL, CELL - 2, CELL - 2);
          if (!dug) {
            ctx.fillStyle = 'rgba(201,141,84,0.5)';
            ctx.beginPath();
            ctx.arc(X0 + c * CELL + 14, TOP + r * CELL + 18, 3, 0, TAU);
            ctx.fill();
          }
        }
      }
      // Mur indestructible à gauche.
      ctx.fillStyle = '#232a3a';
      ctx.fillRect(X0, TOP, 22, 6 * CELL);
      ctx.fillStyle = '#94a3b8';
      for (let r = 0; r < 6; r++) {
        ctx.beginPath();
        ctx.arc(X0 + 11, TOP + r * CELL + 20, 2.4, 0, TAU);
        ctx.fill();
      }
      // Rocher + diamant.
      ctx.fillStyle = '#6e7683';
      ctx.beginPath();
      ctx.arc(cx(4), s.rockFalling ? s.rockY : cy(1), 22, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#a8b0bd';
      ctx.beginPath();
      ctx.arc(cx(4) - 6, (s.rockFalling ? s.rockY : cy(1)) - 7, 6, 0, TAU);
      ctx.fill();
      if (!s.gemTaken) {
        ctx.save();
        ctx.shadowColor = '#22d3ee';
        ctx.shadowBlur = 12;
        ctx.fillStyle = '#67e8f9';
        ctx.beginPath();
        ctx.moveTo(cx(4), cy(4) - 13);
        ctx.lineTo(cx(4) + 10, cy(4) - 2);
        ctx.lineTo(cx(4), cy(4) + 13);
        ctx.lineTo(cx(4) - 10, cy(4) - 2);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      s.blob.render(ctx);
      s.puffs.draw(ctx);
    },
  };
}

// ---------------- BLOB CYCLES : deux filaments orthogonaux qui se croisent ----------------
function demoCycle(accent: string): DemoImpl {
  const cols = [accent, '#f472b6'];
  const s: any = {
    t: 0,
    riders: [
      { pts: [{ x: 480, y: 300 }], dir: 0, stepT: 0, color: cols[0], blob: new Blob({ x: 480, y: 300, r: 12, color: cols[0] }) },
      { pts: [{ x: 900, y: 500 }], dir: 1, stepT: 0, color: cols[1], blob: new Blob({ x: 900, y: 500, r: 12, color: cols[1] }) },
    ],
    puffs: new Puffs(),
  };
  const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  const SPEED = 200;
  return {
    update(dt: number): void {
      s.t += dt;
      for (const r of s.riders) {
        r.stepT += dt;
        if (r.stepT > rand(0.5, 1.1)) {
          r.stepT = 0;
          const left = (r.dir + 3) % 4;
          const right = (r.dir + 1) % 4;
          r.dir = Math.random() < 0.5 ? left : right;
          const head = r.pts[r.pts.length - 1];
          r.pts.push({ x: head.x, y: head.y });
          r.blob.punch(0.4);
          s.puffs.burst(head.x, head.y, [r.color, '#ffffff'], 5, [40, 180], 0.3);
        }
        const head = r.pts[r.pts.length - 1];
        head.x += DIRS[r.dir][0] * SPEED * dt;
        head.y += DIRS[r.dir][1] * SPEED * dt;
        // Rebond vitrine dans le cadre démo.
        if (head.x < 450 || head.x > 940 || head.y < 170 || head.y > 600) {
          r.dir = (r.dir + 2) % 4;
          head.x = Math.max(450, Math.min(940, head.x));
          head.y = Math.max(170, Math.min(600, head.y));
          r.pts.push({ x: head.x, y: head.y });
          r.pts.splice(0, Math.max(0, r.pts.length - 14));
        }
        if (r.pts.length > 26) r.pts.splice(0, r.pts.length - 26);
        r.blob.x = head.x;
        r.blob.y = head.y;
        r.blob.vx = DIRS[r.dir][0] * SPEED;
        r.blob.vy = DIRS[r.dir][1] * SPEED;
        r.blob.update(dt);
      }
      s.puffs.update(dt);
    },
    draw(ctx: CanvasRenderingContext2D): void {
      ctx.strokeStyle = '#ffffff22';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(450, 170, 490, 430);
      for (const r of s.riders) {
        ctx.save();
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.25;
        ctx.strokeStyle = r.color;
        ctx.lineWidth = 12;
        ctx.beginPath();
        ctx.moveTo(r.pts[0].x, r.pts[0].y);
        for (let i = 1; i < r.pts.length; i++) ctx.lineTo(r.pts[i].x, r.pts[i].y);
        ctx.stroke();
        ctx.restore();
        ctx.save();
        ctx.strokeStyle = r.color;
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.shadowColor = r.color;
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.moveTo(r.pts[0].x, r.pts[0].y);
        for (let i = 1; i < r.pts.length; i++) ctx.lineTo(r.pts[i].x, r.pts[i].y);
        ctx.stroke();
        ctx.restore();
        r.blob.render(ctx);
      }
      s.puffs.draw(ctx);
    },
  };
}

// ---------------- BLOB BLOOM : contamination Othello en boucle ----------------
function demoBloom(accent: string): DemoImpl {
  const CELL = 34, OX = 554, OY = 226;
  const cx = (c: number): number => OX + (c + 0.5) * CELL;
  const cy = (r: number): number => OY + (r + 0.5) * CELL;
  const cols = [accent, '#38bdf8'];
  let s: any;
  const setup = () => {
    const grid = bloomEmptyGrid();
    grid[3][3] = 2; grid[4][4] = 2; grid[3][4] = 1; grid[4][3] = 1;
    s = {
      grid, turn: 1, waitT: 0.8, overT: 0,
      waves: [] as any[],
      conv: new Map<number, number>(),
      blobs: [
        new Blob({ x: 490, y: 360, r: 22, color: cols[0] }),
        new Blob({ x: 900, y: 360, r: 22, color: cols[1] }),
      ],
      puffs: new Puffs(),
    };
  };
  setup();
  return {
    update(dt: number): void {
      if (s.overT > 0) {
        s.overT -= dt;
        if (s.overT <= 0) setup();
      } else {
        s.waitT -= dt;
        if (s.waitT <= 0) {
          const moves = bloomLegalMoves(s.grid, s.turn);
          if (moves.length === 0) {
            const foe = bloomLegalMoves(s.grid, bloomOpponent(s.turn));
            if (foe.length === 0) { s.overT = 2.2; }
            else { s.turn = bloomOpponent(s.turn); s.waitT = 0.4; }
          } else {
            const m = moves[(Math.random() * moves.length) | 0];
            const res = bloomApplyMove(s.grid, s.turn, m.x, m.y);
            if (res) {
              s.grid = res.grid;
              s.waves.push({ x: cx(m.x), y: cy(m.y), r: 10, color: cols[s.turn - 1], life: 0.6 });
              for (const f of res.flips) {
                s.conv.set(f.y * 8 + f.x, 0.3);
                if (Math.random() < 0.5) s.puffs.burst(cx(f.x), cy(f.y), [cols[s.turn - 1], '#ffffff'], 4, [30, 140], 0.35);
              }
              s.blobs[s.turn - 1].punch(0.35);
              s.turn = bloomOpponent(s.turn);
            }
            s.waitT = 0.85;
          }
        }
      }
      for (let i = s.waves.length - 1; i >= 0; i--) {
        const w = s.waves[i];
        w.life -= dt;
        w.r += dt * 320;
        if (w.life <= 0) s.waves.splice(i, 1);
      }
      for (const [k, t] of s.conv) {
        if (t <= dt) s.conv.delete(k);
        else s.conv.set(k, t - dt);
      }
      for (const b of s.blobs) b.update(dt);
      s.puffs.update(dt);
    },
    draw(ctx: CanvasRenderingContext2D): void {
      const g = ctx.createRadialGradient(640, 360, 40, 640, 360, 420);
      g.addColorStop(0, 'rgba(74,222,128,0.10)');
      g.addColorStop(0.5, 'rgba(56,189,248,0.06)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(480, 180, 320, 360);
      ctx.strokeStyle = '#ffffff18';
      ctx.lineWidth = 2;
      if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(OX - 6, OY - 6, CELL * 8 + 12, CELL * 8 + 12, 16);
        ctx.stroke();
      } else {
        ctx.strokeRect(OX, OY, CELL * 8, CELL * 8);
      }
      for (const w of s.waves) {
        ctx.globalAlpha = Math.max(0, w.life / 0.6) * 0.8;
        ctx.strokeStyle = w.color;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(w.x, w.y, w.r, 0, TAU); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const v = s.grid[y][x];
        if (!v) continue;
        const pop = s.conv.get(y * 8 + x);
        const r = pop !== undefined ? 8 + (0.3 - pop) * 28 : 13;
        ctx.fillStyle = cols[v - 1];
        ctx.shadowColor = cols[v - 1];
        ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.arc(cx(x), cy(y), r, 0, TAU); ctx.fill();
        ctx.shadowBlur = 0;
        if (v === 1) {
          ctx.fillStyle = '#f9a8d4';
          for (let i = 0; i < 5; i++) {
            const a = (i / 5) * TAU + s.blobs[0].t;
            ctx.beginPath(); ctx.arc(cx(x) + Math.cos(a) * r * 0.62, cy(y) + Math.sin(a) * r * 0.62, 3.4, 0, TAU); ctx.fill();
          }
        } else {
          ctx.strokeStyle = '#e0f2fe';
          ctx.lineWidth = 1.5;
          const d = r * 0.7;
          ctx.beginPath();
          ctx.moveTo(cx(x), cy(y) - d); ctx.lineTo(cx(x) + d * 0.7, cy(y));
          ctx.lineTo(cx(x), cy(y) + d); ctx.lineTo(cx(x) - d * 0.7, cy(y));
          ctx.closePath(); ctx.stroke();
        }
      }
      for (const b of s.blobs) b.render(ctx);
      s.puffs.draw(ctx);
    },
  };
}

const BUILDERS: Record<string, (accent: string) => DemoImpl> = {
  beat: demoBeat,
  surv: demoSurv,
  shoot: demoShoot,
  run: demoRun,
  cave: demoCave,
  simon: demoSimon,
  snake: demoSnake,
  breaker: demoBreaker,
  golf: demoGolf,
  fish: demoFish,
  columns: demoColumns,
  bubble: demoBubble,
  sort: demoSort,
  path: demoPath,
  frog: demoFrog,
  flap: demoFlap,
  dig: demoDig,
  cycle: demoCycle,
  bloom: demoBloom,
};

export class Demo {
  impl!: DemoImpl;

  constructor(id: string, accent: string) { this.reset(id, accent); }
  reset(id: string, accent: string): void {
    const f = BUILDERS[id] || demoFallback;
    this.impl = f(accent);
  }
  update(dt: number): void { this.impl.update(dt); }
  draw(ctx: CanvasRenderingContext2D): void { this.impl.draw(ctx); }
}
