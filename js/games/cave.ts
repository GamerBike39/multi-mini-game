// CAVE RACER — boyau nerveux déterministe (somme de sinus + sections de tension).
// Boucle : vitesse exponentielle, turbo = fuel, overdose toxique si réservoir cramé.
// Les gouttes indigo rechargent le turbo ; à 0 on passe en OVERDOSE : boost bloqué,
// les gouttes deviennent des malus pendant quelques secondes.
// Items : gouttes blanches = surge de vitesse, séquence de 6 pièces rouges = +1 vie.
// 3 vies, invincibilité + recentrage après chaque touche. Haptique progressif
// selon la proximité des parois et des membranes. Score = ratio distance/temps
// (vitesse moyenne) + bonus de pilotage — métrique duel-ready. Zoom et squash lissés.

import { BaseGame } from '../core/game';
import * as UI from '../core/ui';
import type { EngineLike, GameMeta, InputLike } from '../core/types';

const COL = 32;

// Réglages gameplay — un seul endroit pour tuner la courbe.
// Caméra éloignée (zoom ~0.86) : on voit ~16 % de scène en plus,
// la vitesse et les variations peuvent donc monter d'un cran.
const BASE_SPEED = 400;
const MAX_SPEED = 1350;
const HARD_CAP = 1650;
const BOOST_MULT = 1.7;
const DRAIN_RATE = 0.55; // /s en boost
const REGEN_RATE = 0.22; // /s hors boost (volontairement lent : le fuel vient des gouttes)
const ENTER_THRESHOLD = 0.15; // meter mini pour enclencher le boost
const REARM_THRESHOLD = 0.35; // meter à ré-atteindre après un réservoir cramé
const OVERDOSE_DUR = 4.5;
const FUEL_GAIN = 0.11;
const PROX_FUEL = 0.04;
const FUEL_WINDOW = 1.6;

// Vies et items — un seul endroit pour tuner.
const START_LIVES = 3;
const MAX_LIVES = 5;
const INVULN_DUR = 2.0;
const SURGE_MULT = 1.35;
const SURGE_DUR = 3.0;
const RED_LEN = 6;
const RED_SPACING = 7;
const RED_EVERY_PX = 24000;
const RED_FIRST_PX = 9000;
const RUMBLE_TICK = 0.09;

// Sections de tension : alternance lisible (large / étroit / membrane / slalom).
const SECTION_LEN = 150; // indices (~4 800 px, ~6-8 s : alternance plus nerveuse)
const SECTION_BLEND = 26;
const SECTION_MULT = [1.1, 0.62, 1.05, 0.85];
const SECTION_NAMES = ['OUVERT', 'ÉTROIT', 'MEMBRANE', 'SLALOM'];

export class CaveGame extends BaseGame {
  [key: string]: any;
  static meta: GameMeta = {
    id: 'cave', name: 'CAVE RACER', accent: '#818cf8', mood: 'cave',
    desc: 'Le boyau se resserre', controls: 'Stick piloter · A turbo (fuel)',
    keys: "ZQSD / Flèches + Espace",
    hint: 'Indigo = fuel · Blanc = surge · 6 rouges = +1 vie · 3 vies',
    unit: 'pts', ranks: [6000, 4000, 2200, 1000, 0],
  };

  constructor(engine: EngineLike) {
    super(engine);
    this.ph = [0, 0, 0, 0].map(() => this.rng.float(0, 100));
    this.blob.x = 300; this.blob.y = 360; this.blob.r = 17;
    this.blob.color = this.accent;
    this.blob.trailOn = true;
    this.blob.setEmotion('focused');
    this.worldX = 0;
    this.boost = 1; this.meter = 1;
    this.turboOn = false;
    this.prevTurbo = false;
    this.turboLock = false;
    this.overdoseT = 0;
    this.zoomSm = 0.86;
    this.orbScore = 0; this.proxScore = 0; this.malusScore = 0; this.surgeScore = 0;
    this.pace = 0; // ratio distance/temps (px/s moyens) — métrique de base, duel-ready.
    this.fuelStep = 0; this.fuelT = 0;
    this.taken = new Set();
    this.proxT = 0; this.proxCd = 0;
    this.clearance = 1;
    this.wowT = 0;
    // Vies : 3 au départ, +1 par séquence rouge, max 5.
    this.lives = START_LIVES;
    this.maxLives = MAX_LIVES;
    this.invulnT = 0;
    this.rumbleT = 0;
    // Surge de vitesse (gouttes blanches) : multiplicateur lissé, pas de pop.
    this.surgeT = 0;
    this.surgeMult = 1;
    // Séquence rouge façon pièces rouges Mario : 6 pour +1 vie.
    this.redSeq = null;
    this.redTaken = new Set();
    this.redStep = 0;
    this.nextRedAt = RED_FIRST_PX;
    this._pvx = 0; this._pvy = 0; this._biased = false;
    // Étoiles : densité pilotée par la vitesse, intensité constante par étoile.
    // Plage 1700 : la caméra éloignée montre plus large que 1280.
    this.stars = [];
    for (let i = 0; i < 130; i++) this.stars.push({
      x: Math.random() * 1700, y: 40 + Math.random() * 640,
      z: 0.2 + Math.random() * 0.6, th: i / 130,
    });
    // Stries de vitesse : que des lignes, révélées par la vitesse.
    this.streaks = [];
    for (let i = 0; i < 26; i++) this.streaks.push({
      x: Math.random() * 1700, y: 60 + Math.random() * 600,
      z: 0.25 + Math.random() * 0.75, th: i / 26,
    });
  }

  sectionOf(i: number): number {
    return Math.floor(i / SECTION_LEN);
  }
  sectionType(i: number): number {
    const s = this.sectionOf(i);
    return ((s % 4) + 4) % 4;
  }
  sectionName(i: number): string {
    return SECTION_NAMES[this.sectionType(i)];
  }
  sectionMult(i: number): number {
    const s = this.sectionOf(i);
    const local = i - s * SECTION_LEN;
    const cur = SECTION_MULT[this.sectionType(i)];
    if (local < SECTION_BLEND && s > 0) {
      const prev = SECTION_MULT[(((s - 1) % 4) + 4) % 4];
      const t = local / SECTION_BLEND;
      const k = t * t * (3 - 2 * t); // smoothstep, pas de cassure de paroi
      return prev + (cur - prev) * k;
    }
    return cur;
  }

  center(i: number): number {
    let c = 360 + 150 * Math.sin(i * 0.043 + this.ph[0]) + 90 * Math.sin(i * 0.011 + this.ph[1]) + 45 * Math.sin(i * 0.09 + this.ph[2]);
    // Slalom : ondulation supplémentaire marquée, lissée par l'interpolation.
    if (this.sectionType(i) === 3) c += 55 * Math.sin(i * 0.085 + this.ph[1]);
    return c;
  }
  difficulty(): number {
    // 0 -> 1 sur ~90 s, pilote le resserrement et la nervosité visuelle.
    return Math.max(0, Math.min(1, this.time / 90));
  }
  speedNorm(): number {
    const s = this.speedNow || this.speedBase();
    return Math.max(0, Math.min(1, (s - BASE_SPEED) / (HARD_CAP - BASE_SPEED)));
  }
  gap(i: number): number {
    const diff = this.difficulty();
    // Boyau étroit + variations intenses : 205 -> 70 de base, modulé par section.
    const base = 205 - Math.min(135, i * 0.095 + this.time * 0.55);
    const g = Math.max(62, base * this.sectionMult(i) * (1 + (0.08 + diff * 0.06) * Math.sin(i * 0.05 + this.ph[3])));
    return Math.min(g, 225);
  }
  clampC(i: number, g: number): number { return Math.max(60 + g, Math.min(660 - g, this.center(i))); }

  speedBase(): number {
    const t = this.time;
    return Math.min(MAX_SPEED, BASE_SPEED * Math.exp(t * 0.009) + t * 2.6);
  }

  topAt(wx: number): number {
    const i = wx / COL, i0 = Math.floor(i), f = i - i0;
    const g0 = this.gap(i0), g1 = this.gap(i0 + 1);
    const c0 = this.clampC(i0, g0), c1 = this.clampC(i0 + 1, g1);
    return (c0 - g0) * (1 - f) + (c1 - g1) * f;
  }
  botAt(wx: number): number {
    const i = wx / COL, i0 = Math.floor(i), f = i - i0;
    const g0 = this.gap(i0), g1 = this.gap(i0 + 1);
    const c0 = this.clampC(i0, g0), c1 = this.clampC(i0 + 1, g1);
    return (c0 + g0) * (1 - f) + (c1 + g1) * f;
  }

  // Membrane verticale barrant toute la hauteur sauf une ouverture (sections MEMBRANE).
  gateAt(i: number): { x: number; w: number; openTop: number; openBot: number; top: number; bot: number } | null {
    if (i < 160) return null;
    if (this.sectionType(i) !== 2) return null;
    if (i % 41 !== 20) return null;
    const diff = this.difficulty();
    const gx = i * COL;
    const top = this.topAt(gx + 13), bot = this.botAt(gx + 13);
    const g = this.gap(i), c = this.clampC(i, g);
    const openHalf = Math.max(44, 76 - diff * 24);
    const rawY = c + Math.sin(i * 0.6 + this.ph[2]) * g * 0.38;
    const openY = Math.max(top + openHalf + 14, Math.min(bot - openHalf - 14, rawY));
    return { x: gx, w: 26, openTop: openY - openHalf, openBot: openY + openHalf, top, bot };
  }

  orbHiddenByGate(i: number, oy: number): boolean {
    const gate = this.gateAt(i);
    if (!gate) return false;
    return oy < gate.openTop + 12 || oy > gate.openBot - 12;
  }

  // Position déterministe de la k-ième pièce rouge d'une séquence (vague lisible).
  redY(base: number, k: number): { i: number; y: number } {
    const i = base + k * RED_SPACING;
    const g = this.gap(i), c = this.clampC(i, g);
    return { i, y: c + Math.sin(k * 0.9) * g * 0.3 };
  }

  // Position centrale de l'item surge (blanc). false si piégé (membrane).
  surgePos(i: number): { y: number; ok: boolean } {
    const g = this.gap(i), c = this.clampC(i, g);
    const gate = this.gateAt(i);
    if (gate && (c < gate.openTop + 16 || c > gate.openBot - 16)) return { y: c, ok: false };
    return { y: c, ok: true };
  }

  // Mini-blob de vie (HUD) : même famille que le breaker, teinté de l'accent cave.
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

  enter(): void {
    super.enter();
    this.blob.setEmotion('focused');
    this.fx.userSwayX = 0; this.fx.userRot = 0;
  }

  triggerOverdose(): void {
    this.overdoseT = OVERDOSE_DUR;
    this.turboOn = false;
    this.turboLock = true;
    this.meter = 0;
    this.fuelStep = 0; this.fuelT = 0;
    this.blob.punch(0.45);
    this.blob.setEmotion('sad', 1.2);
    this.fx.shake(0.5);
    this.fx.ring(this.blob.x, this.blob.y, { r0: 12, r1: 130, color: '#ff5470', life: 0.5 });
    this.fx.text(this.blob.x, this.blob.y - 44, 'OVERDOSE', { color: '#ff5470', size: 20 });
    this.musicEvent('playerHit', 0.9);
    this.audio.miss();
    this.input.rumble(0.7, 0.3);
  }

  update(dt: number): void {
    if (this.baseUpdate(dt)) return;
    const b = this.blob, I = this.input as InputLike & { down(a: string): boolean; moveX: number; moveY: number };

    // Restaure la vélocité physique (le biais avant est purement visuel).
    if (this._biased) {
      b.vx = this._pvx; b.vy = this._pvy;
      this._biased = false;
    }

    // --- timers ---
    this.proxCd = Math.max(0, this.proxCd - dt);
    this.wowT = Math.max(0, this.wowT - dt);
    this.invulnT = Math.max(0, this.invulnT - dt);
    this.rumbleT = Math.max(0, this.rumbleT - dt);
    if (this.fuelT > 0) {
      this.fuelT -= dt;
      if (this.fuelT <= 0) this.fuelStep = 0;
    }
    if (this.surgeT > 0) this.surgeT = Math.max(0, this.surgeT - dt);
    this.surgeMult += ((this.surgeT > 0 ? SURGE_MULT : 1) - this.surgeMult) * Math.min(1, dt * 2.5);

    const overdosed = this.overdoseT > 0;
    if (overdosed) this.overdoseT = Math.max(0, this.overdoseT - dt);
    const justCured = overdosed && this.overdoseT <= 0;

    // Fin d'overdose : on ré-arme à mi-jauge, pas à 0 (anti-yoyo immédiat).
    if (justCured) {
      this.meter = REARM_THRESHOLD;
      this.blob.setEmotion('focused');
      this.musicEvent('waveComplete', 0.5);
      this.audio.good();
    }

    // --- turbo à hystérésis : 3 états (ready / boost / lock) ---
    const want = (I.down('a') as boolean) && !overdosed;
    if (this.turboLock) {
      this.turboOn = false;
      // Ré-armement uniquement quand la jauge a vraiment repris.
      if (this.meter >= REARM_THRESHOLD && !overdosed) this.turboLock = false;
    } else if (this.turboOn) {
      if (!want) {
        this.turboOn = false; // relâche propre, sans lock
      } else {
        this.meter -= dt * DRAIN_RATE;
        if (this.meter <= 0) {
          this.meter = 0;
          this.triggerOverdose();
        }
      }
    } else {
      // Enclenchement seulement avec un vrai fond de jauge (pas à 2%).
      if (want && this.meter > ENTER_THRESHOLD) this.turboOn = true;
    }

    // Transition turbo lisible : impulsion + anneau, pas un simple scale.
    if (this.turboOn && !this.prevTurbo) {
      b.punch(0.3);
      this.fx.ring(b.x, b.y, { r0: 10, r1: 70, color: this.accent, life: 0.35 });
      this.musicEvent('powerUp', 0.4);
      this.audio.good();
      this.input.rumble(0.25, 0.12);
    } else if (!this.turboOn && this.prevTurbo) {
      b.punch(0.15);
    }
    this.prevTurbo = this.turboOn;

    // Regen passive lente hors boost (le plein se fait aux gouttes).
    if (!this.turboOn && !overdosed) {
      this.meter = Math.min(1, this.meter + dt * REGEN_RATE);
    }

    if (this.turboOn && Math.random() < 0.6) {
      this.fx.burst(b.x - 14, b.y + (Math.random() - 0.5) * 16, { n: 1, speed: [80, 200], colors: [this.accent, '#c7d2fe'], size: [2, 4], life: 0.3, ang: Math.PI, spread: 0.7 });
    }

    // --- vitesse exponentielle ---
    const target = this.turboOn ? BOOST_MULT : 1;
    const rate = this.turboOn ? 3.5 : 2.0; // attaque / relâche douces
    this.boost += (target - this.boost) * Math.min(1, dt * rate);
    const speed = Math.min(HARD_CAP, this.speedBase() * this.boost * this.surgeMult);
    this.worldX += speed * dt;
    b.x = 300;

    // pilotage (vélocité physique, sans le biais avant) — relevé pour suivre
    // la vitesse avant : contrôle plus fluide malgré le boyau plus intense.
    this.steer(dt, b, I.moveX, I.moveY, 500, 8);
    b.y += b.vy * dt;

    const wx = this.worldX + 300;
    const i0 = Math.floor(wx / COL);

    // Collisions désactivées pendant l'invincibilité (on traverse en clignotant).
    if (this.invulnT <= 0) {
      // collision parois (3 échantillons horizontaux, hitbox inchangée)
      for (const ox of [-b.r * 0.7, 0, b.r * 0.7]) {
        const t = this.topAt(wx + ox), bt = this.botAt(wx + ox);
        if (b.y - b.r < t || b.y + b.r > bt) { this.die(); break; }
      }
      if (this.state === 'over') return;

      // membranes (ouverture obligatoire)
      for (let i = i0 - 1; i <= i0 + 2; i++) {
        const gate = this.gateAt(i);
        if (!gate) continue;
        const gx = gate.x - this.worldX;
        if (b.x + b.r * 0.9 > gx && b.x - b.r * 0.9 < gx + gate.w) {
          if (b.y - b.r * 0.85 < gate.openTop || b.y + b.r * 0.85 > gate.openBot) { this.die(); break; }
        }
      }
      if (this.state === 'over') return;
    }

    // purge mémoire du Set (parties longues) — clés fuel (number) + surge ('s'+i)
    if (this.taken.size > 400) {
      for (const key of this.taken) {
        const idx = typeof key === 'string' ? Number(key.slice(1)) : (key as number);
        if (idx < i0 - 10) this.taken.delete(key);
        if (this.taken.size <= 320) break;
      }
    }

    // gouttes de carburant (orbes)
    for (let i = i0 - 2; i <= i0 + 22; i++) {
      if (i < 25 || i % 6 !== 2 || this.taken.has(i)) continue;
      const g = this.gap(i), c = this.clampC(i, g);
      const ox = i * COL + 16 - this.worldX;
      const oy = c + Math.sin(i * 1.7) * g * 0.45;
      if (this.orbHiddenByGate(i, oy)) continue;
      if (Math.hypot(b.x - ox, b.y - oy) < b.r + 14) {
        this.taken.add(i);
        if (this.overdoseT > 0) {
          // OVERDOSE : la goutte est toxique.
          this.malusScore += 50;
          this.musicEvent('playerHit', 0.5);
          this.audio.miss();
          b.punch(0.3);
          b.setEmotion('sad', 0.6);
          this.wowT = 0.6;
          this.fx.burst(ox, oy, { n: 10, speed: [50, 230], colors: ['#ff5470', '#ffffff'], life: 0.4 });
          this.fx.text(ox, oy - 18, '-50 TOXIQUE', { color: '#ff5470', size: 16, mono: true });
          this.fx.shake(0.25);
          this.input.rumble(0.4, 0.12);
        } else {
          this.fuelStep++;
          this.fuelT = FUEL_WINDOW;
          const gain = 25 + Math.min(75, (this.fuelStep - 1) * 10);
          this.orbScore += gain;
          this.meter = Math.min(1, this.meter + FUEL_GAIN);
          // Sortie de lock anticipée si le fuel a bien remonté.
          if (this.turboLock && this.meter >= REARM_THRESHOLD) this.turboLock = false;
          this.musicEvent('powerUp', 0.5);
          this.audio.coin(this.fuelStep);
          b.punch(0.18);
          if (this.fuelStep >= 3) {
            b.setEmotion('wow', 0.6);
            this.wowT = 0.6;
          } else {
            b.setEmotion('happy', 0.45);
            this.wowT = 0.45;
          }
          this.fx.burst(ox, oy, { n: 10, speed: [50, 230], colors: [this.accent, '#ffffff'], life: 0.4 });
          this.fx.text(ox, oy - 18, '+' + gain + (this.fuelStep > 1 ? ' x' + this.fuelStep : ''), { color: '#c7d2fe', size: 16, mono: true });
          this.input.rumble(0.18, 0.05);
        }
      }
    }

    // gouttes blanches = surge de vitesse (+35 % pendant 3 s, lissé)
    for (let i = i0 - 2; i <= i0 + 22; i++) {
      if (i < 60 || i % 83 !== 40 || this.taken.has('s' + i)) continue;
      const sp = this.surgePos(i);
      if (!sp.ok) continue;
      const ox = i * COL + 16 - this.worldX;
      if (Math.hypot(b.x - ox, b.y - sp.y) < b.r + 16) {
        this.taken.add('s' + i);
        this.surgeT = SURGE_DUR;
        this.surgeScore += 50;
        this.musicEvent('powerUp', 0.8);
        this.audio.dash();
        b.punch(0.25);
        b.setEmotion('determined');
        this.fx.burst(ox, sp.y, { n: 14, speed: [80, 300], colors: ['#ffffff', this.accent], life: 0.45 });
        this.fx.ring(ox, sp.y, { r0: 10, r1: 80, color: '#ffffff', life: 0.4 });
        this.fx.text(ox, sp.y - 20, 'SURGE +50', { color: '#ffffff', size: 16, mono: true });
        this.input.rumble(0.3, 0.12);
      }
    }

    // Séquence rouge façon Mario : 6 pièces pour +1 vie.
    if (!this.redSeq && this.worldX >= this.nextRedAt) {
      this.redSeq = { base: i0 + 34, len: RED_LEN };
      this.redTaken = new Set();
      this.redStep = 0;
      this.audio.good();
      this.fx.text(b.x + 260, b.y - 70, 'SÉQUENCE ROUGE · 6 = +1 VIE', { color: '#ffb3c1', size: 18 });
    }
    if (this.redSeq) {
      const base = this.redSeq.base, len = this.redSeq.len;
      for (let k = 0; k < len; k++) {
        const { i, y } = this.redY(base, k);
        if (this.redTaken.has(i)) continue;
        const ox = i * COL + 16 - this.worldX;
        if (ox < -80 || ox > 1600) continue;
        if (Math.hypot(b.x - ox, b.y - y) < b.r + 16) {
          this.redTaken.add(i);
          this.redStep++;
          // Pitch montant bien distinct de la chaîne fuel (offset +10).
          this.audio.coin(10 + this.redStep * 2);
          this.musicEvent('powerUp', 0.6);
          b.punch(0.2);
          b.setEmotion('happy', 0.5);
          this.wowT = 0.5;
          this.fx.burst(ox, y, { n: 12, speed: [60, 260], colors: ['#ff5d7a', '#ffffff'], life: 0.45 });
          this.fx.ring(ox, y, { r0: 8, r1: 60, color: '#ff8a9a', life: 0.35 });
          this.input.rumble(0.22, 0.07);
          if (this.redStep >= len) {
            this.lives = Math.min(this.maxLives, this.lives + 1);
            this.audio.milestone();
            this.musicEvent('waveComplete', 0.9);
            b.punch(0.4);
            b.setEmotion('happy', 1.0);
            this.wowT = 1.0;
            this.fx.burst(b.x, b.y, { n: 22, speed: [80, 380], colors: [this.accent, '#ffffff', '#ff8a9a'], life: 0.6 });
            this.fx.ring(b.x, b.y, { r0: 12, r1: 140, color: this.accent, life: 0.5 });
            this.fx.text(b.x, b.y - 52, '+1 VIE', { color: '#ffffff', size: 26 });
            this.input.rumble(0.6, 0.25);
            this.redSeq = null;
            this.nextRedAt = this.worldX + RED_EVERY_PX;
          } else {
            this.fx.text(ox, y - 20, 'ROUGE ' + this.redStep + '/' + len, { color: '#ff8a9a', size: 16, mono: true });
          }
        }
      }
      // On a dépassé la dernière pièce sans tout prendre : séquence ratée.
      if (this.redSeq) {
        const lastI = base + (len - 1) * RED_SPACING;
        if (wx > lastI * COL + 16 + 80) {
          this.audio.miss();
          this.fx.text(b.x + 120, b.y - 60, 'SÉQUENCE RATÉE', { color: '#ff8a9a', size: 16 });
          this.redSeq = null;
          this.nextRedAt = this.worldX + RED_EVERY_PX;
        }
      }
    }

    // near-miss : raser recharge un peu et excite le blob
    const wd = Math.min(b.y - this.topAt(wx), this.botAt(wx) - b.y) - b.r;
    this.clearance = Math.max(0, Math.min(1, (wd + 8) / 92));
    if (wd < 15 && this.state === 'play' && this.overdoseT <= 0) this.proxT += dt;
    else this.proxT = Math.max(0, this.proxT - dt * 3);
    if (this.proxT > 0.22 && this.proxCd <= 0) {
      this.proxT = 0; this.proxCd = 1.1;
      this.proxScore += 25;
      this.meter = Math.min(1, this.meter + PROX_FUEL);
      if (this.turboLock && this.meter >= REARM_THRESHOLD) this.turboLock = false;
      this.musicEvent('nearMiss', 0.7);
      this.audio.good();
      b.punch(0.22);
      b.setEmotion('wow', 0.6);
      this.wowT = 0.6;
      this.fx.text(b.x, b.y - 34, 'PROX +25', { color: '#c7d2fe', size: 16 });
      this.fx.burst(b.x, b.y + (b.y < 360 ? b.r + 6 : -b.r - 6), { n: 6, speed: [40, 160], colors: ['#c7d2fe'], size: [1.5, 3], life: 0.3 });
      this.input.rumble(0.12, 0.05);
    }

    // Haptique progressif : la manette gronde de plus en plus fort à mesure
    // que les parois et les obstacles se rapprochent (tick 90 ms, pas de spam).
    if (this.rumbleT <= 0 && this.state === 'play') {
      this.rumbleT = RUMBLE_TICK;
      const wallD = 1 - this.clearance;
      let threat = 0;
      const px = this.worldX + 300;
      for (let i = i0 - 1; i <= i0 + 4; i++) {
        const gate = this.gateAt(i);
        if (gate) {
          const gx = gate.x + 13 - px;
          if (Math.abs(gx) < 340) {
            const inGap = b.y > gate.openTop && b.y < gate.openBot;
            const edgeD = Math.min(Math.abs(b.y - gate.openTop), Math.abs(b.y - gate.openBot));
            const t = (1 - Math.abs(gx) / 340) * (inGap ? (1 - Math.min(1, edgeD / 120)) * 0.7 + 0.3 : 1);
            threat = Math.max(threat, t);
          }
        }
      }
      threat = Math.max(0, Math.min(1, threat));
      const speedN2 = Math.max(0, Math.min(1, (speed - BASE_SPEED) / (HARD_CAP - BASE_SPEED)));
      const intensity = Math.max(0, Math.min(0.9, 0.05 + wallD * 0.3 + threat * 0.45 + (this.turboOn ? 0.06 : 0) + speedN2 * 0.05));
      if (intensity > 0.12) this.input.rumble(intensity, 0.08);
    }

    // visage : dead > scared > emotion (cf bible blob)
    b.scared = this.clearance < 0.28 && this.state === 'play';
    if (this.wowT <= 0 && !b.scared) {
      if (this.overdoseT > 0) {
        if (b.emotion !== 'sad') b.setEmotion('sad');
      } else if (this.turboOn) {
        if (b.emotion !== 'determined') b.setEmotion('determined');
      } else if (b.emotion !== 'focused' && b.emotion !== 'happy') {
        b.setEmotion('focused');
      }
    }

    // Score fondé sur le ratio distance/temps (vitesse moyenne) + bonus de pilotage.
    // Métrique duel-ready : à temps égal, le plus rapide gagne ; à distance égale,
    // le plus véloce aussi. Les bonus récompensent le style, pas le farming.
    this.pace = this.worldX / Math.max(1, this.time);
    this.score = Math.max(0, Math.floor(this.pace * 3) + this.orbScore + this.proxScore + this.surgeScore - this.malusScore);

    // Biais avant purement visuel : le blob s'étire dans le sens de la course,
    // la physique (steer) repart de la vélocité latérale pure à la frame suivante.
    const speedN = Math.max(0, Math.min(1, (speed - BASE_SPEED) / (HARD_CAP - BASE_SPEED)));
    this._pvx = b.vx; this._pvy = b.vy;
    b.vx = this._pvx + speed * 0.55;
    b.liquid = Math.min(0.3, speedN * 0.28 + (this.turboOn ? 0.08 : 0));
    this._biased = true;

    // le trail défile vers l'arrière (le blob est fixe à l'écran, le monde bouge)
    for (const p of this.blob.trail) p.x -= speed * dt;
    this.blob.update(dt);

    // caméra verticale douce
    this.camY = (b.y - 360) * 0.2;
    // Caméra éloignée + zoom lissé : on gagne en anticipation, la vitesse
    // peut monter sans réduire le temps de réaction. Pas de saut d'échelle.
    const zoomTarget = 0.86 - (this.turboOn ? 0.06 : 0) - this.difficulty() * 0.03 + (this.overdoseT > 0 ? 0.015 : 0);
    this.zoomSm += (zoomTarget - this.zoomSm) * Math.min(1, dt * 3.2);
    this.fx.zoom = this.zoomSm;
    // Micro-tremblement de vitesse : la caméra vibre subtilement, de plus en
    // plus fort avec la vitesse (les gros chocs passent par shake/trauma).
    const swayN = Math.max(0, Math.min(1, (speed - BASE_SPEED) / (HARD_CAP - BASE_SPEED)));
    this.fx.userSwayX = Math.sin(this.time * 43) * 2.4 * swayN * (this.turboOn ? 1.4 : 1);
    this.fx.userRot = Math.sin(this.time * 31) * 0.0022 * swayN;
    this.speedNow = speed;
  }

  die(): void {
    if (this.state === 'over') return;
    if (this.invulnT > 0) return;
    const b = this.blob;
    this.lives--;
    if (this.lives <= 0) {
      // Dernière vie : mort définitive, pancake + game over.
      this.audio.explode(1.4);
      this.input.rumble(1, 0.4);
      this.fx.shake(1.0);
      this.fx.stop(0.13);
      this.fx.flash('#ff5470', 0.3);
      this.fx.userSwayX = 0; this.fx.userRot = 0;
      // Effluves : gouttes de gelée + pixels carrés + double anneau.
      this.fx.burst(b.x, b.y, { n: 26, speed: [100, 500], colors: [this.accent, '#ffffff', '#c7d2fe'], size: [2, 6], life: 0.7 });
      this.fx.burst(b.x, b.y, { n: 16, speed: [60, 320], colors: [this.accent, '#ff5470', '#ffffff'], size: [2, 5], life: 0.8, shape: 'sq' });
      this.fx.ring(b.x, b.y, { r0: 10, r1: 110, color: this.accent, life: 0.4 });
      this.fx.ring(b.x, b.y, { r0: 6, r1: 70, color: '#ff5470', life: 0.35 });
      b.dead = true;
      this.over();
      return;
    }
    // Touche ! On perd une vie mais on repart : recentrage + invincibilité.
    this.audio.hurt();
    this.musicEvent('playerHit', 0.8);
    this.input.rumble(0.85, 0.3);
    this.fx.shake(0.85);
    this.fx.stop(0.08);
    this.fx.flash('#ff5470', 0.2);
    // Effluves : gelée accent/blanc + pixels qui claquent + anneau rouge.
    this.fx.burst(b.x, b.y, { n: 18, speed: [80, 380], colors: [this.accent, '#ffffff', '#ff8a9a'], size: [2, 5], life: 0.6 });
    this.fx.burst(b.x, b.y, { n: 12, speed: [60, 300], colors: [this.accent, '#ff5470', '#ffffff'], size: [2, 4.5], life: 0.6, shape: 'sq' });
    this.fx.ring(b.x, b.y, { r0: 10, r1: 100, color: '#ff5470', life: 0.4 });
    this.fx.ring(b.x, b.y, { r0: 8, r1: 60, color: '#ffffff', life: 0.3 });
    this.fx.text(b.x, b.y - 44, 'AÏE ! -1 VIE', { color: '#ff8a9a', size: 20 });
    b.punch(0.5);
    b.setEmotion('sad', 1.0);
    this.wowT = 1.0;
    // Recentrage au cœur du boyau pour éviter la re-mort immédiate.
    const wx = this.worldX + 300;
    const i = Math.floor(wx / COL);
    const g = this.gap(i);
    b.y = this.clampC(i, g);
    b.vx = 0; b.vy = 0;
    this.meter = Math.max(this.meter, 0.4);
    this.invulnT = INVULN_DUR;
  }

  // Tracé de paroi lissé (courbes, pas de polygones visibles — bible §3).
  private wallEdge(top: boolean): { x: number; y: number }[] {
    const pts: { x: number; y: number }[] = [];
    // 56 colonnes : la caméra éloignée montre plus large que 1280.
    const i0 = Math.floor(this.worldX / COL) - 2;
    const breatheAmp = 2 + this.difficulty() * 2.5 + this.speedNorm() * 2;
    const breatheFreq = 2.2 + this.speedNorm() * 2.5;
    for (let i = i0; i <= i0 + 56; i++) {
      const g = this.gap(i), c = this.clampC(i, g);
      const breathe = Math.sin(this.time * breatheFreq + i * 0.35) * breatheAmp;
      const y = (top ? c - g : c + g) + breathe;
      pts.push({ x: i * COL - this.worldX, y });
    }
    return pts;
  }

  private strokeSmooth(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[]): void {
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2;
      const my = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#05060c';
    ctx.fillRect(0, 0, 1280, 720);

    this.fx.world(ctx);
    ctx.save();
    ctx.translate(0, -(this.camY || 0));

    const speedN = this.speedNorm();
    // Densité d'étoiles pilotée par la vitesse ; chaque étoile garde sa luminosité.
    ctx.lineCap = 'round';
    for (const s of this.stars) {
      if (s.th > speedN * 0.85 + 0.15) continue;
      const sx = (((s.x - this.worldX * (0.15 + s.z * 0.3)) % 1700) + 1700) % 1700 - 200;
      const len = (2 + s.z * 4) + speedN * (10 + s.z * 26);
      ctx.globalAlpha = 0.10 + s.z * 0.10;
      ctx.strokeStyle = '#aab6ff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(sx - len, s.y);
      ctx.lineTo(sx, s.y);
      ctx.stroke();
    }
    // Stries de vitesse : lignes révélées par la vitesse, alpha fixe par strie.
    for (const s of this.streaks) {
      if (s.th > speedN * 0.9 + 0.1) continue;
      const sx = (((s.x - this.worldX * (0.5 + s.z * 0.5)) % 1700) + 1700) % 1700 - 200;
      const len = 20 + s.z * 60 + (this.boost - 1) * 60;
      ctx.globalAlpha = 0.05 + s.z * 0.06;
      ctx.strokeStyle = (this.turboOn ? '#c7d2fe' : '#8b95c9');
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx - len, s.y);
      ctx.lineTo(sx, s.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    const diff = this.difficulty();
    const topPts = this.wallEdge(true);
    const botPts = this.wallEdge(false);

    // Boyau = que des lignes : pas de remplissage extérieur (fini les "nuages").
    for (const pts of [topPts, botPts]) {
      ctx.beginPath();
      this.strokeSmooth(ctx, pts);
      ctx.strokeStyle = this.accent + '44';
      ctx.lineWidth = 9;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.beginPath();
      this.strokeSmooth(ctx, pts);
      ctx.strokeStyle = this.accent;
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.shadowColor = this.accent;
      ctx.shadowBlur = 14 + diff * 10;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // Repères de profondeur : traits filants, longueur proportionnelle à la vitesse.
    ctx.save();
    ctx.globalAlpha = 0.09;
    ctx.strokeStyle = '#c7d2fe';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    for (let x = -80; x < 1360; x += 128) {
      const wx = this.worldX + 300 + x;
      const top = this.topAt(wx), bot = this.botAt(wx);
      const cy = (top + bot) / 2;
      const len = 14 + speedN * 42;
      ctx.beginPath();
      ctx.moveTo(x, cy);
      ctx.lineTo(x + len, cy);
      ctx.stroke();
    }
    ctx.restore();

    // Danger : vignette rouge respirante quand on rase trop
    if (this.clearance < 0.58) {
      const danger = (0.58 - this.clearance) / 0.58;
      const pulse = 0.55 + 0.45 * Math.sin(this.time * 12);
      ctx.save();
      ctx.globalAlpha = danger * pulse * 0.18;
      const left = ctx.createLinearGradient(0, 0, 150, 0);
      left.addColorStop(0, '#ff5470'); left.addColorStop(1, 'rgba(255,84,112,0)');
      ctx.fillStyle = left; ctx.fillRect(0, 0, 150, 720);
      const right = ctx.createLinearGradient(1280, 0, 1130, 0);
      right.addColorStop(0, '#ff5470'); right.addColorStop(1, 'rgba(255,84,112,0)');
      ctx.fillStyle = right; ctx.fillRect(1130, 0, 150, 720);
      ctx.restore();
    }

    // overdose : voile toxique subtil
    if (this.overdoseT > 0) {
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 9);
      ctx.save();
      ctx.globalAlpha = 0.10 + pulse * 0.06;
      ctx.fillStyle = '#ff5470';
      ctx.fillRect(0, 0, 1280, 720);
      ctx.restore();
    }

    // gouttes de fuel : rondes, halo accent (rouge toxique en overdose)
    const i0 = Math.floor(this.worldX / COL) - 2;
    const i1 = i0 + 56;
    const toxic = this.overdoseT > 0;
    for (let i = i0; i <= i1; i++) {
      if (i < 25 || i % 6 !== 2 || this.taken.has(i)) continue;
      const g = this.gap(i), c = this.clampC(i, g);
      const ox = i * COL + 16 - this.worldX;
      const oy = c + Math.sin(i * 1.7) * g * 0.45;
      if (this.orbHiddenByGate(i, oy)) continue;
      const r = 9 + Math.sin(i * 2.4 + this.time * 5) * 2;
      const col = toxic ? '#ff5470' : this.accent;
      const glow = toxic ? '#ff5470' : '#c7d2fe';
      ctx.save();
      ctx.shadowColor = glow; ctx.shadowBlur = 14;
      const grad = ctx.createRadialGradient(ox - r * 0.3, oy - r * 0.35, r * 0.1, ox, oy, r);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.35, col);
      grad.addColorStop(1, toxic ? '#7a1626' : '#3b4280');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(ox, oy, r, 0, 6.2832); ctx.fill();
      ctx.shadowBlur = 0;
      // reflet goutte haut-gauche
      ctx.beginPath();
      ctx.ellipse(ox - r * 0.28, oy - r * 0.34, r * 0.28, r * 0.18, -0.5, 0, 6.2832);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fill();
      ctx.restore();
    }

    // gouttes blanches = surge : corps blanc chaud + anneau accent pulsant
    for (let i = i0; i <= i1; i++) {
      if (i < 60 || i % 83 !== 40 || this.taken.has('s' + i)) continue;
      const sp = this.surgePos(i);
      if (!sp.ok) continue;
      const ox = i * COL + 16 - this.worldX;
      if (ox < -60 || ox > 1560) continue;
      const r = 10 + Math.sin(this.time * 6 + i) * 2;
      ctx.save();
      ctx.shadowColor = '#ffffff'; ctx.shadowBlur = 18;
      const sg = ctx.createRadialGradient(ox - r * 0.3, sp.y - r * 0.35, r * 0.1, ox, sp.y, r);
      sg.addColorStop(0, '#ffffff');
      sg.addColorStop(0.5, '#e6e9ff');
      sg.addColorStop(1, this.accent);
      ctx.fillStyle = sg;
      ctx.beginPath(); ctx.arc(ox, sp.y, r, 0, 6.2832); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = this.accent;
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(this.time * 6 + i);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(ox, sp.y, r + 6, 0, 6.2832); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    // pièces rouges : corps rouge vif + reflet blanc + anneau (séquence +1 vie)
    if (this.redSeq) {
      const base = this.redSeq.base, len = this.redSeq.len;
      for (let k = 0; k < len; k++) {
        const { i, y } = this.redY(base, k);
        if (this.redTaken.has(i)) continue;
        const ox = i * COL + 16 - this.worldX;
        if (ox < -60 || ox > 1560) continue;
        const r = 9 + Math.sin(this.time * 5 + k * 1.1) * 2;
        ctx.save();
        ctx.shadowColor = '#ff5d7a'; ctx.shadowBlur = 14;
        const rg = ctx.createRadialGradient(ox - r * 0.3, y - r * 0.35, r * 0.1, ox, y, r);
        rg.addColorStop(0, '#ffffff');
        rg.addColorStop(0.4, '#ff5d7a');
        rg.addColorStop(1, '#8f1d33');
        ctx.fillStyle = rg;
        ctx.beginPath(); ctx.arc(ox, y, r, 0, 6.2832); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#ff8a9a';
        ctx.globalAlpha = 0.55 + 0.35 * Math.sin(this.time * 5 + k * 1.1);
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(ox, y, r + 5, 0, 6.2832); ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.restore();
      }
    }

    // membranes : double capsule arrondie + lèvre rouge côté ouverture
    for (let i = i0; i <= i1; i++) {
      const gate = this.gateAt(i);
      if (!gate) continue;
      const gx = gate.x - this.worldX;
      for (const [y0, y1] of [[gate.top - 30, gate.openTop], [gate.openBot, gate.bot + 30]] as const) {
        const h = Math.max(8, y1 - y0);
        ctx.save();
        ctx.shadowColor = this.accent; ctx.shadowBlur = 12;
        ctx.fillStyle = '#141828';
        UI.roundRect(ctx, gx, y0, gate.w, h, 10);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = this.accent;
        ctx.lineWidth = 2;
        UI.roundRect(ctx, gx, y0, gate.w, h, 10);
        ctx.stroke();
        ctx.restore();
      }
      // lèvres danger autour de l'ouverture
      ctx.save();
      ctx.strokeStyle = '#ff5470';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.shadowColor = '#ff5470'; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.moveTo(gx - 4, gate.openTop); ctx.lineTo(gx + gate.w + 4, gate.openTop); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(gx - 4, gate.openBot); ctx.lineTo(gx + gate.w + 4, gate.openBot); ctx.stroke();
      ctx.restore();
    }

    // Clignotement d'invincibilité : on traverse les parois en fantôme.
    if (this.invulnT > 0 && Math.floor(this.time * 12) % 2 === 0) {
      ctx.save();
      ctx.globalAlpha = 0.35;
      this.blob.render(ctx);
      ctx.restore();
    } else {
      this.blob.render(ctx);
    }
    ctx.restore();

    this.fx.drawWorld(ctx);
    this.fx.endWorld(ctx);

    // HUD
    UI.drawHUD(ctx, {
      accent: this.accent,
      score: this.score,
      extra: () => {
        for (let li = 0; li < this.maxLives; li++) {
          this.lifeBlob(ctx, 30 + li * 24, 40 + Math.sin(this.time * 3 + li) * 1.2, li < this.lives);
        }
        UI.txt(ctx, 'MARGE ' + Math.round(this.clearance * 100) + '%', 28, 88, {
          size: 12,
          mono: true,
          color: this.clearance < 0.42 ? '#ff8a9a' : '#7c8698',
        });
        if (this.redSeq) {
          UI.txt(ctx, 'ROUGE ' + this.redStep + '/' + this.redSeq.len, 28, 108, {
            size: 12, mono: true, color: '#ff8a9a',
          });
        }
        if (this.surgeT > 0) {
          UI.txt(ctx, 'SURGE ' + this.surgeT.toFixed(1) + 's', 28, this.redSeq ? 128 : 108, {
            size: 12, mono: true, color: '#ffffff',
          });
        }
      },
    });
    UI.txt(ctx, Math.floor(this.worldX / 40) + ' m', 640, 52, { size: 30, align: 'center', mono: true, color: '#a5b4fc', shadow: true });
    const spd = Math.round(this.speedNow || 0);
    const sect = this.sectionName(Math.floor((this.worldX + 300) / COL));
    UI.txt(ctx, spd + ' px/s · MOY ' + Math.round(this.pace || 0) + ' · ' + sect + (this.turboOn ? ' · TURBO' : '') + (this.overdoseT > 0 ? ' · OVERDOSE ' + Math.ceil(this.overdoseT) + 's' : ''), 640, 74, {
      size: 12, align: 'center', mono: true,
      color: this.overdoseT > 0 ? '#ff8a9a' : this.turboOn ? '#c7d2fe' : '#5d6480',
    });

    // jauge fuel / turbo : pilule, jamais un rectangle cru
    const bw = 220, bx = 640 - bw / 2, by = 682;
    const toxicNow = this.overdoseT > 0;
    const lowFuel = !toxicNow && (this.turboLock || this.meter < REARM_THRESHOLD);
    UI.panel(ctx, bx - 14, by - 12, bw + 28, 44, {
      radius: 22,
      fill: 'rgba(7, 8, 18, 0.66)',
      stroke: toxicNow ? '#ff547088' : lowFuel ? '#ff547066' : this.accent + '55',
      lineWidth: 1.25,
    });
    // rail arrondi
    UI.roundRect(ctx, bx, by, bw, 8, 4);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fill();
    // remplissage arrondi (clip à la largeur meter)
    if (this.meter > 0.01) {
      ctx.save();
      UI.roundRect(ctx, bx, by, bw, 8, 4);
      ctx.clip();
      const pulse = toxicNow ? 0.6 + 0.4 * Math.sin(this.time * 10) : 1;
      ctx.globalAlpha = pulse;
      ctx.fillStyle = toxicNow ? '#ff5470' : lowFuel ? '#fb7185' : this.accent;
      ctx.fillRect(bx, by, bw * Math.max(0, Math.min(1, this.meter)), 8);
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    // seuil de ré-armement : petite encoche lisible (anti-2%)
    const rearmX = bx + bw * REARM_THRESHOLD;
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillRect(rearmX, by - 2, 2, 12);
    const label = toxicNow
      ? 'OVERDOSE · GOUTTES TOXIQUES'
      : this.turboLock
        ? 'FUEL VIDE · RECHARGE AUX GOUTTES'
        : this.turboOn
          ? (this.fuelStep > 1 ? 'TURBO · FUEL x' + this.fuelStep : 'TURBO · FUEL')
          : 'A · TURBO — GOUTTES = FUEL';
    UI.txt(ctx, label, 640, 712, {
      size: 11, align: 'center',
      color: toxicNow ? '#ff8a9a' : '#5d6480',
    });

    this.drawCommon(ctx);
  }
}
