// BLOB PÊCHE — lancer chargé en cloche, hameçon piloté au stick, ferrade réflexe,
// remorque à gérer à la tension (le poisson tire ∝ poids, à-coups périodiques).
// 3 bandes de profondeur (léger/haut → lourd/bas), ~4 % de légendaires dorés.
// 90 s, score en grammes, plus haut = mieux.

import { BaseGame } from '../core/game.ts';
import * as UI from '../core/ui.ts';

const SURFACE = 110;                    // y de la mer
const BX = 130, BY = 78;                // blob pêcheur sur sa bouée
const HOOK_X0 = 60, HOOK_X1 = 1220;     // bornes horizontales de l'hameçon
const HOOK_YMAX = 686;                  // fond visible

// bandes : plage y, poids (g), vitesse (px/s), teinte, probabilité de spawn
const BANDS = [
  { y0: 128, y1: 260, w0: 60, w1: 250, s0: 90, s1: 150, col: '#8fd8ea', p: 0.54 },
  { y0: 300, y1: 460, w0: 300, w1: 900, s0: 60, s1: 100, col: '#5fa8cf', p: 0.31 },
  { y0: 500, y1: 660, w0: 1000, w1: 4000, s0: 30, s1: 55, col: '#3b6d92', p: 0.15 },
];
const LEGEND_P = 0.04, LEGEND_W = 8000, GOLD = '#ffd166';

const rand = (a, b) => a + Math.random() * (b - a);
const ri = (a, b) => Math.floor(rand(a, b + 1));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class FishingGame extends BaseGame {
  static meta = {
    id: 'fish', name: 'BLOB PÊCHE', accent: '#38bdf8', mood: 'menu',
    desc: 'Lance, ferris, remorque', controls: 'A lancer/ferrer · Stick G hameçon',
    keys: "Espace + ZQSD",
    hint: 'Maintiens A pour lancer loin · ! = ferrade · tiens A pour remonter, lâche si ça chauffe',
    unit: 'g', ranks: [12000, 7000, 3500, 1500, 0],
  };

  constructor(engine) {
    super(engine);
    this.blob.x = BX; this.blob.y = BY; this.blob.r = 20;
    this.timeLeft = 90;
    this.phase = 'idle';   // idle|charge|cast|sink|drown|strike|reel|caught|return
    this.gauge = 0; this.gaugeDir = 1;
    this.hook = { x: BX + 40, y: 122 };
    this.depthY = 0;       // cible de plongée (y absolu)
    this.castT = 0; this.castDur = 0; this.castFrom = { x: 0, y: 0 }; this.castTo = 0;
    this.strikeT = 0;
    this.tension = 0; this.jerk = 0; this.jerkT = 1;
    this.hooked = null;
    this.caughtFish = null; this.caughtFrom = { x: 0, y: 0 }; this.caughtT = 0;
    this.bestCatch = 0;
    this.sadT = 0; this.bubT = 0; this.spawnT = 0.6;
    this.fishes = []; this.stars = []; this.bubbles = [];
    for (let i = 0; i < 26; i++) this.stars.push({ x: Math.random() * 1280, y: rand(6, 96), z: rand(0.3, 1), ph: Math.random() * 6.28 });
    for (let i = 0; i < 22; i++) this.bubbles.push({ x: Math.random() * 1280, y: rand(130, 716), r: rand(1.4, 3.4), sp: rand(24, 56), ph: Math.random() * 6.28 });
    for (let i = 0; i < 7; i++) this.fishes.push(this.makeFish(rand(240, 1320)));
  }

  makeFish(x = 1330) {
    let r = Math.random(), band = BANDS[BANDS.length - 1];
    for (const b of BANDS) { if (r < b.p) { band = b; break; } r -= b.p; }
    const legend = Math.random() < LEGEND_P;
    const w = legend ? LEGEND_W : ri(band.w0, band.w1);
    const baseY = legend ? rand(520, 650) : rand(band.y0, band.y1);
    return {
      x, state: 'swim', legend, w,
      sp: legend ? rand(26, 40) : rand(band.s0, band.s1),
      baseY, y: baseY, col: legend ? GOLD : band.col,
      r: clamp(9 + Math.sqrt(w) * 0.16, 9, 24),
      amp: rand(10, 24), ph: Math.random() * 6.28, phSp: rand(1.4, 2.8),
      fleeT: 0, tilt: 0, jx: 0, jy: 0, dead: false,
    };
  }

  rodTip() {
    const ang = clamp(Math.atan2(this.hook.y - BY, this.hook.x - BX), -0.55, 1.25);
    return { x: BX + 8 + Math.cos(ang) * 34, y: BY - 6 + Math.sin(ang) * 34 };
  }

  // éclaboussure d'entrée/sortie d'eau : bruit filtré + gerbe + anneau
  splash(x, y, power = 1) {
    this.fx.burst(x, y, {
      n: Math.round(12 * power) + 6, speed: [70, 200 * power + 80], ang: -1.5708, spread: 1.3,
      colors: ['#bfe3ff', '#ffffff', '#7dd3fc'], size: [1.5, 4], life: 0.5, grav: 420,
    });
    this.fx.ring(x, y, { r0: 4, r1: 40 * power + 16, color: '#bfe3ff', life: 0.35 });
    this.audio.noise({ dur: 0.22, f: 1100, f1: 220, type: 'lowpass', vol: 0.26 });
    this.audio.thump(0.18, { f0: 180, f1: 60, dur: 0.12 });
    this.input.rumble(0.15, 0.07);
  }

  launchCast() {
    const tip = this.rodTip();
    this.castFrom = { x: tip.x, y: tip.y };
    this.castTo = clamp(tip.x + 200 + 880 * this.gauge, 180, 1230);
    this.castDur = 0.5 + 0.4 * this.gauge;
    this.castT = 0;
    this.phase = 'cast';
    this.audio.dash();
    this.blob.punch(0.35);
    this.input.rumble(0.25, 0.09);
  }

  startStrike(f) {
    f.state = 'hooked';
    this.hooked = f;
    this.phase = 'strike';
    this.strikeT = 0.65;
    this.audio.good();
    this.input.rumble(0.3, 0.1);
    this.blob.punch(0.25);
    this.fx.ring(f.x, f.y, { r0: 4, r1: 30, color: '#ffffff', life: 0.25, width: 2 });
    this.fx.burst(f.x, f.y, { n: 8, speed: [40, 160], colors: ['#ffffff', '#bfe3ff'], size: [1.5, 3], life: 0.35 });
    this.fx.text(f.x, f.y - f.r - 16, '!', { color: GOLD, size: 30, life: 0.7 });
  }

  startReel() {
    this.phase = 'reel';
    this.tension = 0.15;
    this.jerk = 0; this.jerkT = rand(0.8, 1.5);
    this.hooked.state = 'reel';
    this.audio.hitEnemy();
    this.input.rumble(0.2, 0.08);
  }

  breakLine() {
    const f = this.hooked;
    this.audio.miss();
    this.fx.shake(0.5);
    this.fx.text(this.hook.x, this.hook.y - 30, 'ROMPUE !', { color: '#ff5470', size: 26 });
    this.input.rumble(0.8, 0.3);
    this.blob.scared = true; this.sadT = 1;
    this.fx.burst(this.hook.x, this.hook.y, { n: 12, speed: [60, 240], colors: ['#dbe9ff', '#8fd8ea'], size: [1.5, 3], life: 0.4 });
    f.state = 'flee'; f.fleeT = 1.6; f.baseY = clamp(f.y, 130, 660);
    this.hooked = null;
    this.tension = 0;
    this.phase = 'return';
  }

  capture() {
    const f = this.hooked;
    const sx = clamp(this.hook.x, 40, 1240);
    this.splash(sx, SURFACE, 1.2);
    this.audio.explode(0.6);
    this.input.rumble(0.5, 0.15);
    this.fx.shake(0.16);
    this.blob.punch(0.5);
    this.score += f.w;
    this.fx.text(sx, SURFACE - 36, '+' + UI.fmt(f.w) + ' g', { color: GOLD, size: 24, mono: true, life: 1.1 });
    if (f.legend) this.fx.text(sx, SURFACE - 70, 'LÉGENDAIRE !', { color: GOLD, size: 30, life: 1.4 });
    if (f.w > this.bestCatch) {
      this.bestCatch = f.w;
      this.audio.milestone();
      this.fx.text(sx, SURFACE - 100, 'RECORD !', { color: this.accent, size: 18, life: 1.2 });
    }
    f.state = 'caught';
    this.caughtFish = f; this.caughtFrom = { x: f.x, y: f.y }; this.caughtT = 0;
    this.fishes = this.fishes.filter((ff) => ff !== f);
    this.hooked = null;
    this.tension = 0;
    this.phase = 'caught';
  }

  update(dt) {
    if (this.baseUpdate(dt)) return;
    const I = this.input, b = this.blob;

    // bulles ambiantes
    for (const bu of this.bubbles) {
      bu.y -= bu.sp * dt;
      bu.x += Math.sin(this.time * 1.8 + bu.ph) * 12 * dt;
      if (bu.y < SURFACE + 10) { bu.y = 730; bu.x = Math.random() * 1280; }
    }

    // --- machine à états du hameçon ---
    if (this.phase === 'idle' || this.phase === 'charge') {
      this.hook.x = BX + 40 + Math.sin(this.time * 1.4) * 3;
      this.hook.y = 122 + Math.sin(this.time * 2.1) * 2;
      if (this.phase === 'idle') {
        if (I.down('a')) { this.phase = 'charge'; this.gauge = 0; this.gaugeDir = 1; }
      } else {
        // jauge ping-pong 0↔1 (1,2 s par aller)
        this.gauge += this.gaugeDir * dt / 1.2;
        if (this.gauge >= 1) { this.gauge = 1; this.gaugeDir = -1; }
        else if (this.gauge <= 0) { this.gauge = 0; this.gaugeDir = 1; }
        if (!I.down('a')) this.launchCast();
      }
    } else if (this.phase === 'cast') {
      // cloche parabolique depuis le bout de canne
      this.castT += dt;
      const t = Math.min(1, this.castT / this.castDur);
      const apex = 24 + 46 * this.gauge;
      this.hook.x = this.castFrom.x + (this.castTo - this.castFrom.x) * t;
      this.hook.y = Math.max(10, this.castFrom.y + (SURFACE - this.castFrom.y) * t - apex * Math.sin(Math.PI * t));
      if (t >= 1) {
        this.hook.x = clamp(this.hook.x, HOOK_X0, HOOK_X1);
        this.hook.y = SURFACE + 4;
        this.depthY = Math.min(HOOK_YMAX, SURFACE + 120 + 520 * this.gauge);
        this.splash(this.hook.x, SURFACE, 0.55 + 0.5 * this.gauge);
        this.phase = 'sink';
      }
    } else if (this.phase === 'sink') {
      this.hook.y += 120 * dt;
      if (Math.random() < 0.3) {
        this.fx.burst(this.hook.x + rand(-3, 3), this.hook.y - 6, { n: 1, speed: [16, 40], ang: -1.5708, spread: 0.5, colors: ['#bfe3ff'], size: [1.2, 2.4], life: 0.8, grav: -50, drag: 0.99 });
      }
      if (this.hook.y >= this.depthY) { this.hook.y = this.depthY; this.phase = 'drown'; this.audio.good(); }
    } else if (this.phase === 'drown') {
      // dérive horizontale au stick G / ZQSD, profondeur conservée
      this.hook.x = clamp(this.hook.x + I.moveX * 260 * dt, HOOK_X0, HOOK_X1);
      // contact poisson → ferrade
      let best = null, bd = 1e9;
      for (const f of this.fishes) {
        if (f.state !== 'swim') continue;
        const d = Math.hypot(f.x - this.hook.x, f.y - this.hook.y);
        if (d < 22 + f.r * 0.2 && d < bd) { bd = d; best = f; }
      }
      if (best) this.startStrike(best);
    } else if (this.phase === 'strike') {
      // 0,65 s pour ferrer
      this.strikeT -= dt;
      if (I.pressed('a')) this.startReel();
      else if (this.strikeT <= 0) {
        this.audio.whiff();
        const f = this.hooked;
        f.state = 'swim'; f.baseY = clamp(f.y, 130, 660);
        this.hooked = null;
        this.phase = 'drown';
      }
    } else if (this.phase === 'reel') {
      const f = this.hooked;
      const sq = Math.sqrt(f.w / 1000);
      const pull = 30 + 30 * sq; // force du poisson (∝ poids)
      // à-coups périodiques, télégraphiés par le tremblement du fil
      if (this.jerk > 0) this.jerk -= dt;
      else {
        this.jerkT -= dt;
        if (this.jerkT <= 0) {
          this.jerk = 0.35; this.jerkT = rand(0.8, 1.5);
          this.audio.tone({ f: 220, f1: 140, type: 'sawtooth', dur: 0.1, vol: 0.09 });
          this.input.rumble(0.24, 0.09);
          b.punch(0.15);
        }
      }
      const jk = this.jerk > 0 ? 1 : 0;
      if (I.down('a')) {
        this.hook.y -= 140 * dt; // remonter
        this.tension += dt * (0.22 + 0.13 * sq + jk * 0.5);
      } else {
        this.hook.y += (24 + pull * 0.5) * dt; // redescend doucement
        this.tension -= dt * 0.55;
      }
      if (jk) { this.hook.y += pull * 0.7 * dt; this.hook.x -= 40 * dt; } // coup de tête
      this.hook.x += I.moveX * 70 * dt - (12 + 8 * sq) * dt;              // traction vers la gauche
      this.tension = clamp(this.tension, 0, 1);
      this.hook.x = clamp(this.hook.x, HOOK_X0, HOOK_X1);
      this.hook.y = Math.min(this.hook.y, HOOK_YMAX);
      if (this.tension >= 1) this.breakLine();
      else if (this.hook.y - SURFACE < 90) this.capture();
    } else if (this.phase === 'caught') {
      // hissage : le poisson rentre vers le blob, l'hameçon se reprécise
      this.caughtT += dt;
      this.hook.x += ((BX + 40) - this.hook.x) * Math.min(1, dt * 8);
      this.hook.y += (122 - this.hook.y) * Math.min(1, dt * 8);
      if (Math.random() < 0.4) {
        this.fx.burst(this.hook.x, this.hook.y, { n: 1, speed: [20, 90], colors: [this.caughtFish.legend ? GOLD : '#bfe3ff', '#ffffff'], size: [1.5, 3], life: 0.4 });
      }
      if (this.caughtT >= 0.5) { this.caughtFish = null; this.phase = 'idle'; }
    } else if (this.phase === 'return') {
      // ligne rompue : l'hameçon remonte vide
      this.hook.y -= 220 * dt;
      this.hook.x += ((BX + 40) - this.hook.x) * Math.min(1, dt * 3);
      if (this.hook.y <= 122) { this.hook.y = 122; this.phase = 'idle'; }
    }

    // --- poissons ---
    this.spawnT -= dt;
    if (this.fishes.length < 10 && this.spawnT <= 0) { this.fishes.push(this.makeFish()); this.spawnT = rand(0.4, 1.2); }
    if (this.fishes.length < 6) this.fishes.push(this.makeFish());
    for (const f of this.fishes) {
      f.jx = 0; f.jy = 0;
      if (f.state === 'swim' || f.state === 'flee') {
        const sp = f.sp * (f.state === 'flee' ? 2.1 : 1);
        f.x -= sp * dt;
        f.ph += dt * f.phSp * (f.state === 'flee' ? 1.8 : 1);
        f.y = f.baseY + Math.sin(f.ph) * f.amp;
        if (f.state === 'flee') { f.fleeT -= dt; if (f.fleeT <= 0) f.state = 'swim'; }
        if (f.x < -80) f.dead = true;
      } else if (f.state === 'hooked') {
        f.jx = rand(-1.2, 1.2); f.jy = rand(-1.2, 1.2); // tremble sur place
      } else if (f.state === 'reel') {
        f.ph += dt * 14; // collé à l'hameçon, combat
        f.x = this.hook.x - 12 + Math.sin(f.ph) * 3;
        f.y = this.hook.y + 16 + Math.cos(f.ph * 1.3) * 3;
      }
      // inclinaison : le nez suit la sinusoïde
      let tt = 0;
      if (f.state === 'swim' || f.state === 'flee') {
        const vyE = Math.cos(f.ph) * f.amp * f.phSp * (f.state === 'flee' ? 1.8 : 1);
        tt = clamp(Math.atan2(-vyE, f.sp), -0.35, 0.35);
      } else if (f.state === 'reel') tt = Math.sin(this.time * 22) * 0.3;
      f.tilt += (tt - f.tilt) * Math.min(1, dt * 8);
    }
    this.fishes = this.fishes.filter((f) => !f.dead);

    // bulles de l'hameçon immergé
    this.bubT -= dt;
    if (this.hook.y > SURFACE + 8 && this.bubT <= 0 && this.phase !== 'caught') {
      this.bubT = 0.13;
      this.fx.burst(this.hook.x + rand(-3, 3), this.hook.y - 4, { n: 1, speed: [16, 44], ang: -1.5708, spread: 0.5, colors: ['#bfe3ff'], size: [1.2, 2.6], life: 0.8, grav: -50, drag: 0.99 });
    }

    // le pêcheur suit l'hameçon du regard, triste 1 s après une casse
    const lx = this.hook.x - b.x, ly = this.hook.y - b.y, ll = Math.hypot(lx, ly) || 1;
    const k = Math.min(1, dt * 6);
    b.lookX += (lx / ll - b.lookX) * k;
    b.lookY += (ly / ll - b.lookY) * k;
    if (this.sadT > 0) this.sadT -= dt;
    b.scared = this.sadT > 0;
    b.update(dt);

    // timer
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) { this.timeLeft = 0; this.over(this.score >= 5000); }
  }

  // ---------- rendu ----------

  drawFish(ctx, f) {
    const r = f.r * (f.legend ? 1.6 : 1);
    ctx.save();
    ctx.translate(f.x + f.jx, f.y + f.jy);
    ctx.rotate(f.tilt + (f.state === 'reel' ? Math.sin(this.time * 24) * 0.2 : 0));
    if (f.legend) { ctx.shadowColor = GOLD; ctx.shadowBlur = 18 + Math.sin(this.time * 6) * 6; }
    const tail = Math.sin(this.time * 10 + f.ph) * r * 0.18;
    // queue triangulaire
    ctx.fillStyle = f.col;
    ctx.beginPath();
    ctx.moveTo(r * 0.7, 0);
    ctx.lineTo(r * 1.5, -r * 0.55 + tail);
    ctx.lineTo(r * 1.5, r * 0.55 + tail);
    ctx.closePath();
    ctx.fill();
    // corps
    ctx.beginPath();
    ctx.ellipse(0, 0, r, r * 0.6, 0, 0, 6.2832);
    ctx.fill();
    ctx.shadowBlur = 0;
    // ventre
    ctx.beginPath();
    ctx.ellipse(-r * 0.08, r * 0.18, r * 0.62, r * 0.28, 0, 0, 6.2832);
    ctx.fillStyle = '#ffffff2b';
    ctx.fill();
    // œil
    ctx.beginPath();
    ctx.arc(-r * 0.45, -r * 0.14, Math.max(1.6, r * 0.16), 0, 6.2832);
    ctx.fillStyle = '#eaf6ff';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-r * 0.5, -r * 0.14, Math.max(0.8, r * 0.08), 0, 6.2832);
    ctx.fillStyle = '#0b0e14';
    ctx.fill();
    // marqueur de ferrade
    if (f.state === 'hooked' || f.state === 'reel') {
      ctx.fillStyle = GOLD;
      ctx.font = '900 26px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('!', 0, -r - 10);
    }
    ctx.restore();
  }

  drawCaught(ctx) {
    const f = this.caughtFish;
    const ease = 1 - Math.pow(1 - Math.min(1, this.caughtT / 0.5), 2);
    const x = this.caughtFrom.x + ((BX + 16) - this.caughtFrom.x) * ease;
    const y = this.caughtFrom.y + ((BY + 10) - this.caughtFrom.y) * ease;
    const r = f.r * (f.legend ? 1.6 : 1) * (1 - ease * 0.7);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ease * 2.4);
    ctx.globalAlpha = 1 - ease * 0.5;
    ctx.fillStyle = f.col;
    ctx.beginPath();
    ctx.ellipse(0, 0, r, r * 0.6, 0, 0, 6.2832);
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  drawLine(ctx) {
    const tip = this.rodTip(), h = this.hook;
    // canne
    ctx.strokeStyle = '#5b4636';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(BX + 6, BY - 2);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();
    // fil : mou → tendu (teinte rouge avec la tension), tremble pendant les à-coups
    const tr = this.tension;
    const sag = (this.phase === 'idle' || this.phase === 'charge' || this.phase === 'caught') ? 20 : 8 * (1 - tr);
    const jx = this.jerk > 0 ? rand(-2.5, 2.5) : 0;
    const jy = this.jerk > 0 ? rand(-2.5, 2.5) : 0;
    ctx.strokeStyle = `rgba(${Math.round(216 + 39 * tr)}, ${Math.round(233 - 149 * tr)}, ${Math.round(255 - 143 * tr)}, 0.55)`;
    ctx.lineWidth = 1.4;
    ctx.setLineDash([4, 6]);
    ctx.lineDashOffset = -this.time * 26;
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.quadraticCurveTo((tip.x + h.x) / 2 + jx, (tip.y + h.y) / 2 + sag + jy, h.x, h.y);
    ctx.stroke();
    ctx.setLineDash([]);
    // hameçon
    ctx.shadowColor = '#bfe3ff';
    ctx.shadowBlur = 8;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(h.x, h.y, 5, 0, 6.2832);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(h.x, h.y + 4, 3, 0, Math.PI);
    ctx.stroke();
  }

  drawWaves(ctx) {
    const rows = [[0, 1.5, 4, 'rgba(125,211,252,0.5)', 2.5], [5, -1.05, 3, 'rgba(56,189,248,0.28)', 2]];
    for (const [off, sp, amp, col, w] of rows) {
      ctx.beginPath();
      for (let x = 0; x <= 1280; x += 16) {
        const y = SURFACE + off + Math.sin(x * 0.02 + this.time * sp) * amp;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.strokeStyle = col;
      ctx.lineWidth = w;
      ctx.stroke();
    }
  }

  drawBuoy(ctx) {
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(BX, 103, 26, 16, 0, 0, 6.2832);
    ctx.fillStyle = '#d9483f';
    ctx.fill();
    ctx.clip();
    ctx.fillStyle = '#f2f5f7';
    ctx.fillRect(BX - 28, 98, 56, 7);
    ctx.restore();
    ctx.beginPath();
    ctx.ellipse(BX - 7, 94, 9, 4, -0.3, 0, 6.2832);
    ctx.fillStyle = '#ffffff33';
    ctx.fill();
  }

  drawCastGauge(ctx) {
    const gx = BX - 46, gy = 40, gw = 12, gh = 74;
    UI.panel(ctx, gx - 4, gy - 4, gw + 8, gh + 8, { radius: 8, fill: 'rgba(8,11,18,0.78)', stroke: '#ffffff2e' });
    const hFill = gh * this.gauge;
    ctx.fillStyle = this.accent;
    ctx.fillRect(gx, gy + gh - hFill, gw, hFill);
    UI.txt(ctx, 'PORTÉE', gx + gw / 2, gy + gh + 18, { size: 9, align: 'center', color: '#7c8698' });
  }

  drawTension(ctx) {
    const bw = 260, bx = 640 - bw / 2, by = 684, bh = 10;
    UI.panel(ctx, bx - 5, by - 5, bw + 10, bh + 10, { radius: 9, fill: 'rgba(8,11,18,0.78)', stroke: '#ffffff2e' });
    const t = this.tension;
    const col = t < 0.5 ? '#4ade80' : t < 0.78 ? '#facc15' : '#ff5470';
    ctx.fillStyle = col;
    ctx.fillRect(bx, by, bw * t, bh);
    if (t > 0.78 && Math.sin(this.time * 26) > 0) {
      ctx.strokeStyle = '#ff5470';
      ctx.lineWidth = 2;
      ctx.strokeRect(bx - 2, by - 2, bw + 4, bh + 4);
    }
    UI.txt(ctx, 'TENSION' + (t > 0.78 ? ' !' : ''), 640, by - 11, { size: 11, align: 'center', color: col, mono: true });
  }

  render(ctx) {
    // ciel + mer
    const sky = ctx.createLinearGradient(0, 0, 0, SURFACE + 2);
    sky.addColorStop(0, '#05070d');
    sky.addColorStop(1, '#0d1524');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, 1280, SURFACE + 2);
    const sea = ctx.createLinearGradient(0, SURFACE, 0, 720);
    sea.addColorStop(0, '#0b2036');
    sea.addColorStop(1, '#04070f');
    ctx.fillStyle = sea;
    ctx.fillRect(0, SURFACE, 1280, 720 - SURFACE);

    this.fx.world(ctx);

    // étoiles scintillantes
    for (const s of this.stars) {
      ctx.globalAlpha = 0.2 + 0.55 * (0.5 + 0.5 * Math.sin(this.time * s.z * 2 + s.ph));
      ctx.fillStyle = '#cfe0ff';
      const sz = s.z > 0.8 ? 2 : 1.4;
      ctx.fillRect(s.x, s.y, sz, sz);
    }
    ctx.globalAlpha = 1;

    // bulles ambiantes
    ctx.strokeStyle = 'rgba(170,215,255,0.22)';
    ctx.lineWidth = 1;
    for (const bu of this.bubbles) {
      ctx.beginPath();
      ctx.arc(bu.x, bu.y, bu.r, 0, 6.2832);
      ctx.stroke();
    }

    // poissons + prise hissée
    for (const f of this.fishes) this.drawFish(ctx, f);
    if (this.caughtFish) this.drawCaught(ctx);

    // fil + hameçon, puis vagues par-dessus, puis bouée + pêcheur
    this.drawLine(ctx);
    this.drawWaves(ctx);
    this.drawBuoy(ctx);
    this.blob.render(ctx);
    if (this.phase === 'charge') this.drawCastGauge(ctx);

    this.fx.drawWorld(ctx);
    this.fx.endWorld(ctx);

    // HUD
    UI.drawHUD(ctx, {
      accent: this.accent,
      score: this.score,
      unit: this.meta.unit,
      time: this.timeLeft,
      extra: () => UI.txt(ctx, 'PRISE ' + UI.fmt(this.bestCatch) + ' g', 28, 70, { size: 12, mono: true, color: '#7c8698' }),
    });
    if (this.phase === 'reel') this.drawTension(ctx);

    this.drawCommon(ctx);
  }
}
