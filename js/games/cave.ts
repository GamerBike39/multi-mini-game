// CAVE RACER — course hyperspeed VERTICALE dans un puits organique numérique.
// Direction CAVE_GAME_FEEL.md (P0) : le gameplay reste simple et déterministe,
// le rendu triche pour le spectacle. Le joueur est calé à ~72 % de la hauteur,
// le monde arrive du haut et s'écoule vers le bas, pilotage gauche/droite.
// Tunnel = vide découpé dans une matière cellulaire réactive ; la frontière de
// collision (Gameplay Edge) est redessinée nette au-dessus de tout le décor.
// Score = ratio distance/temps (vitesse moyenne) + bonus — métrique duel-ready.

import { BaseGame } from '../core/game';
import * as UI from '../core/ui';
import type { EngineLike, GameMeta, InputLike } from '../core/types';

const COL = 32;
const PY = 520; // y écran du joueur (~72 % de 720 : beaucoup de futur lisible)

// Réglages gameplay — un seul endroit pour tuner la courbe.
// Caméra éloignée (zoom ~0.86) : on voit plus de scène, la vitesse et les
// variations peuvent monter sans réduire le temps de réaction.
const BASE_SPEED = 400;
const MAX_SPEED = 1350;
const HARD_CAP = 1650;
const BOOST_MULT = 1.7;
const DRAIN_RATE = 0.55; // /s en boost
const REGEN_RATE = 0.22; // /s hors boost (le plein se fait aux gouttes)
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
const SECTION_LEN = 150; // indices (~4 800 px, ~6-8 s : alternance nerveuse)
const SECTION_BLEND = 26;
const SECTION_MULT = [1.1, 0.62, 1.05, 0.85];
const SECTION_NAMES = ['OUVERT', 'ÉTROIT', 'MEMBRANE', 'SLALOM'];

// Matière cellulaire (couche principale + couche profonde en parallaxe).
const CELL = 30;
const DEEP_CELL = 46;

export class CaveGame extends BaseGame {
  [key: string]: any;
  static version = '1.0.0';
  static meta: GameMeta = {
    id: 'cave', name: 'CAVE RACER', accent: '#818cf8', mood: 'cave',
    desc: 'Chute hyperspeed dans le puits', controls: 'Q D / Stick piloter · A turbo (fuel)',
    keys: "Q D / Flèches + Espace",
    hint: 'Gauche/droite = piloter · A = turbo · 6 rouges = +1 vie · 3 vies',
    unit: 'pts', ranks: [6000, 4000, 2200, 1000, 0],
  };

  constructor(engine: EngineLike) {
    super(engine);
    this.ph = [0, 0, 0, 0].map(() => this.rng.float(0, 100));
    this.blob.x = 640; this.blob.y = PY; this.blob.r = 17;
    this.blob.color = this.accent;
    this.blob.trailOn = true;
    this.blob.setEmotion('focused');
    this.worldY = 0;
    this.boost = 1; this.meter = 1;
    this.turboOn = false;
    this.prevTurbo = false;
    this.turboAge = 0;
    this.turboLock = false;
    this.overdoseT = 0;
    this.zoomSm = 0.80;
    this.lookSm = 40;
    this.kickX = 0;
    this.lookKick = 0;
    this.orbScore = 0; this.proxScore = 0; this.malusScore = 0; this.surgeScore = 0;
    this.pace = 0; // ratio distance/temps (px/s moyens) — métrique de base, duel-ready.
    this.fuelStep = 0; this.fuelT = 0;
    this.taken = new Set();
    this.proxT = 0; this.proxCd = 0;
    this.clearance = 1;
    this.wowT = 0;
    this.hitPoseT = 0;
    this.hitSide = 'gate';
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
    // Ondes d'impact dans la matière (near-miss, turbo, collision).
    this.impacts = [];
    this._pvx = 0; this._pvy = 0; this._biased = false;
    // Poussières : densité pilotée par la vitesse, intensité constante chacune.
    this.stars = [];
    for (let i = 0; i < 130; i++) this.stars.push({
      x: Math.random() * 1280, y: Math.random() * 760,
      z: 0.2 + Math.random() * 0.6, th: i / 130,
    });
    // Stries de vitesse verticales : révélées par la vitesse.
    this.streaks = [];
    for (let i = 0; i < 26; i++) this.streaks.push({
      x: Math.random() * 1280, y: Math.random() * 760,
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
    let c = 640 + 150 * Math.sin(i * 0.043 + this.ph[0]) + 90 * Math.sin(i * 0.011 + this.ph[1]) + 45 * Math.sin(i * 0.09 + this.ph[2]);
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
  clampC(i: number, g: number): number { return Math.max(90 + g, Math.min(1190 - g, this.center(i))); }

  speedBase(): number {
    const t = this.time;
    return Math.min(MAX_SPEED, BASE_SPEED * Math.exp(t * 0.009) + t * 2.6);
  }

  leftAt(wy: number): number {
    const i = wy / COL, i0 = Math.floor(i), f = i - i0;
    const g0 = this.gap(i0), g1 = this.gap(i0 + 1);
    const c0 = this.clampC(i0, g0), c1 = this.clampC(i0 + 1, g1);
    return (c0 - g0) * (1 - f) + (c1 - g1) * f;
  }
  rightAt(wy: number): number {
    const i = wy / COL, i0 = Math.floor(i), f = i - i0;
    const g0 = this.gap(i0), g1 = this.gap(i0 + 1);
    const c0 = this.clampC(i0, g0), c1 = this.clampC(i0 + 1, g1);
    return (c0 + g0) * (1 - f) + (c1 + g1) * f;
  }

  // Membrane HORIZONTALE barrant toute la largeur sauf une ouverture (sections MEMBRANE).
  gateAt(i: number): { y: number; h: number; openL: number; openR: number; left: number; right: number } | null {
    if (i < 160) return null;
    if (this.sectionType(i) !== 2) return null;
    if (i % 41 !== 20) return null;
    const diff = this.difficulty();
    const gy = i * COL;
    const left = this.leftAt(gy + 13), right = this.rightAt(gy + 13);
    const g = this.gap(i), c = this.clampC(i, g);
    const openHalf = Math.max(44, 76 - diff * 24);
    const rawX = c + Math.sin(i * 0.6 + this.ph[2]) * g * 0.38;
    const openX = Math.max(left + openHalf + 14, Math.min(right - openHalf - 14, rawX));
    return { y: gy, h: 26, openL: openX - openHalf, openR: openX + openHalf, left, right };
  }

  orbHiddenByGate(i: number, ox: number): boolean {
    const gate = this.gateAt(i);
    if (!gate) return false;
    return ox < gate.openL + 12 || ox > gate.openR - 12;
  }

  // Position déterministe de la k-ième pièce rouge d'une séquence (vague lisible).
  redX(base: number, k: number): { i: number; x: number } {
    const i = base + k * RED_SPACING;
    const g = this.gap(i), c = this.clampC(i, g);
    return { i, x: c + Math.sin(k * 0.9) * g * 0.3 };
  }

  // Position de l'item surge (blanc). false si piégé (membrane).
  surgePos(i: number): { x: number; ok: boolean } {
    const g = this.gap(i), c = this.clampC(i, g);
    const gate = this.gateAt(i);
    if (gate && (c < gate.openL + 16 || c > gate.openR - 16)) return { x: c, ok: false };
    return { x: c, ok: true };
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
    this.fx.text(this.blob.x, this.blob.y - 60, 'OVERDOSE', { color: '#ff5470', size: 20 });
    this.musicEvent('playerHit', 0.9);
    this.audio.miss();
    this.input.rumble(0.7, 0.3);
  }

  exit(): void {
    this.audio.turboSet(false);
    super.exit();
  }

  update(dt: number): void {
    if (this.baseUpdate(dt)) { this.audio.turboSet(false); return; }
    const b = this.blob, I = this.input as InputLike & { down(a: string): boolean; moveX: number; moveY: number };

    // Restaure la vélocité physique (le stretch avant est purement visuel).
    if (this._biased) {
      b.vx = this._pvx; b.vy = this._pvy;
      this._biased = false;
    }

    // --- timers ---
    this.proxCd = Math.max(0, this.proxCd - dt);
    this.wowT = Math.max(0, this.wowT - dt);
    this.invulnT = Math.max(0, this.invulnT - dt);
    this.rumbleT = Math.max(0, this.rumbleT - dt);
    for (let k = this.impacts.length - 1; k >= 0; k--) {
      this.impacts[k].t += dt;
      if (this.impacts[k].t > 0.55) this.impacts.splice(k, 1);
    }
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
        this.lookKick -= 5; // petit recul de caméra à la relâche
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

    // Chorégraphie turbo : compression (T+0) → micro-suspension → libération.
    if (this.turboOn && !this.prevTurbo) {
      this.turboAge = 0;
      b.punch(0.35);
      this.lookKick += 16; // kick caméra vers le bas = propulsion vers le haut
      this.fx.ring(b.x, b.y, { r0: 10, r1: 70, color: this.accent, life: 0.35 });
      this.fx.flash(this.accent, 0.08);
      this.impacts.push({ wy: this.worldY, t: 0 });
      this.musicEvent('powerUp', 0.4);
      this.audio.good();
      this.input.rumble(0.25, 0.12);
    } else if (!this.turboOn && this.prevTurbo) {
      b.punch(0.15);
    }
    this.prevTurbo = this.turboOn;
    if (this.turboOn) this.turboAge += dt;

    // Regen passive lente hors boost (le plein se fait aux gouttes).
    if (!this.turboOn && !overdosed) {
      this.meter = Math.min(1, this.meter + dt * REGEN_RATE);
    }

    // Échappement du turbo : traînée vers le bas (derrière le joueur).
    if (this.turboOn && Math.random() < 0.6) {
      this.fx.burst(b.x + (Math.random() - 0.5) * 16, b.y + 14, { n: 1, speed: [80, 200], colors: [this.accent, '#c7d2fe'], size: [2, 4], life: 0.3, ang: Math.PI / 2, spread: 0.7 });
    }

    // --- vitesse exponentielle ---
    const target = this.turboOn ? BOOST_MULT : 1;
    const rate = this.turboOn ? 3.5 : 2.0; // attaque / relâche douces
    this.boost += (target - this.boost) * Math.min(1, dt * rate);
    const speed = Math.min(HARD_CAP, this.speedBase() * this.boost * this.surgeMult);
    // Nappe turbo : monte en douceur avec le boost, coupée dès qu'on relâche.
    this.audio.turboSet(this.turboOn, Math.max(0, this.boost - 1));
    const prevWY = this.worldY;
    this.worldY += speed * dt;

    // pilotage gauche/droite (le y est fixe, la physique reste instantanée ;
    // l'animation créera l'impression d'inertie).
    this.steer(dt, b, I.moveX, 0, 520, 8);
    b.x += b.vx * dt;
    b.y = PY; b.vy = 0;

    const wy = this.worldY;
    const i0 = Math.floor(wy / COL);

    // Collisions désactivées pendant l'invincibilité (on traverse en clignotant).
    if (this.invulnT <= 0) {
      // collision parois (3 échantillons verticaux, hitbox inchangée)
      for (const oy of [-b.r * 0.7, 0, b.r * 0.7]) {
        const l = this.leftAt(wy + oy), r = this.rightAt(wy + oy);
        if (b.x - b.r < l || b.x + b.r > r) {
          const ci = Math.floor((wy + oy) / COL);
          this.die(b.x < this.clampC(ci, this.gap(ci)) ? 'left' : 'right');
          break;
        }
      }
      if (this.state === 'over') return;

      // membranes : plan traversé => dedans ou dehors de l'ouverture ?
      for (let i = i0 - 1; i <= i0 + 2; i++) {
        const gate = this.gateAt(i);
        if (!gate) continue;
        if (prevWY <= gate.y && wy >= gate.y) {
          if (b.x - b.r * 0.85 < gate.openL || b.x + b.r * 0.85 > gate.openR) { this.die('gate'); break; }
        }
      }
      if (this.state === 'over') return;
    }

    // Franchissement réussi d'une membrane : whoosh + contraction arrière.
    for (let i = i0 - 1; i <= i0 + 2; i++) {
      const gate = this.gateAt(i);
      if (!gate) continue;
      if (prevWY <= gate.y && wy >= gate.y && this.state === 'play') {
        if (b.x - b.r * 0.85 >= gate.openL && b.x + b.r * 0.85 <= gate.openR) {
          this.audio.whiff();
          this.lookKick += 5;
          this.impacts.push({ wy: gate.y, t: 0 });
          this.fx.burst(gate.openL, PY - 40, { n: 4, speed: [40, 160], colors: [this.accent], size: [1.5, 3], life: 0.3 });
          this.fx.burst(gate.openR, PY - 40, { n: 4, speed: [40, 160], colors: [this.accent], size: [1.5, 3], life: 0.3 });
        }
      }
    }

    // purge mémoire du Set (parties longues) — clés fuel (number) + surge ('s'+i)
    if (this.taken.size > 400) {
      for (const key of this.taken) {
        const idx = typeof key === 'string' ? Number(key.slice(1)) : (key as number);
        if (idx < i0 - 12) this.taken.delete(key);
        if (this.taken.size <= 320) break;
      }
    }

    // gouttes de carburant (orbes) — légère attraction dans les dernières frames
    for (let i = i0 - 6; i <= i0 + 30; i++) {
      if (i < 25 || i % 6 !== 2 || this.taken.has(i)) continue;
      const g = this.gap(i), c = this.clampC(i, g);
      let ox = c + Math.sin(i * 1.7) * g * 0.45;
      if (this.orbHiddenByGate(i, ox)) continue;
      const wyi = i * COL + 16;
      let sy = PY + wy - wyi;
      if (sy < -80 || sy > 800) continue;
      const dxm = b.x - ox, dym = PY - sy;
      const dm = Math.hypot(dxm, dym);
      if (dm < 70 && dm > 0.01) {
        const pull = (1 - dm / 70) * 20;
        ox += dxm / dm * pull; sy += dym / dm * pull;
      }
      if (Math.hypot(b.x - ox, PY - sy) < b.r + 14) {
        this.taken.add(i);
        if (this.overdoseT > 0) {
          // OVERDOSE : la goutte est toxique.
          this.malusScore += 50;
          this.musicEvent('playerHit', 0.5);
          this.audio.miss();
          b.punch(0.3);
          b.setEmotion('sad', 0.6);
          this.wowT = 0.6;
          this.fx.burst(ox, sy, { n: 10, speed: [50, 230], colors: ['#ff5470', '#ffffff'], life: 0.4 });
          this.fx.text(ox, sy - 18, '-50 TOXIQUE', { color: '#ff5470', size: 16, mono: true });
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
          this.fx.burst(ox, sy, { n: 10, speed: [50, 230], colors: [this.accent, '#ffffff'], life: 0.4 });
          this.fx.text(ox, sy - 18, '+' + gain + (this.fuelStep > 1 ? ' x' + this.fuelStep : ''), { color: '#c7d2fe', size: 16, mono: true });
          this.input.rumble(0.18, 0.05);
        }
      }
    }

    // gouttes blanches = surge de vitesse (+35 % pendant 3 s, lissé)
    for (let i = i0 - 6; i <= i0 + 30; i++) {
      if (i < 60 || i % 83 !== 40 || this.taken.has('s' + i)) continue;
      const sp = this.surgePos(i);
      if (!sp.ok) continue;
      const wyi = i * COL + 16;
      let sx = sp.x, sy = PY + wy - wyi;
      if (sy < -80 || sy > 800) continue;
      const dxm = b.x - sx, dym = PY - sy;
      const dm = Math.hypot(dxm, dym);
      if (dm < 70 && dm > 0.01) {
        const pull = (1 - dm / 70) * 20;
        sx += dxm / dm * pull; sy += dym / dm * pull;
      }
      if (Math.hypot(b.x - sx, PY - sy) < b.r + 16) {
        this.taken.add('s' + i);
        this.surgeT = SURGE_DUR;
        this.surgeScore += 50;
        this.musicEvent('powerUp', 0.8);
        this.audio.dash();
        b.punch(0.25);
        b.setEmotion('determined');
        this.fx.burst(sx, sy, { n: 14, speed: [80, 300], colors: ['#ffffff', this.accent], life: 0.45 });
        this.fx.ring(sx, sy, { r0: 10, r1: 80, color: '#ffffff', life: 0.4 });
        this.fx.text(sx, sy - 20, 'SURGE +50', { color: '#ffffff', size: 16, mono: true });
        this.input.rumble(0.3, 0.12);
      }
    }

    // Séquence rouge façon Mario : 6 pièces pour +1 vie.
    if (!this.redSeq && this.worldY >= this.nextRedAt) {
      this.redSeq = { base: i0 + 30, len: RED_LEN };
      this.redTaken = new Set();
      this.redStep = 0;
      this.audio.good();
      this.fx.text(b.x, b.y - 130, 'SÉQUENCE ROUGE · 6 = +1 VIE', { color: '#ffb3c1', size: 18 });
    }
    if (this.redSeq) {
      const base = this.redSeq.base, len = this.redSeq.len;
      for (let k = 0; k < len; k++) {
        const { i, x } = this.redX(base, k);
        if (this.redTaken.has(i)) continue;
        const wyi = i * COL + 16;
        let sx = x, sy = PY + wy - wyi;
        if (sy < -80 || sy > 800) continue;
        const dxm = b.x - sx, dym = PY - sy;
        const dm = Math.hypot(dxm, dym);
        if (dm < 70 && dm > 0.01) {
          const pull = (1 - dm / 70) * 20;
          sx += dxm / dm * pull; sy += dym / dm * pull;
        }
        if (Math.hypot(b.x - sx, PY - sy) < b.r + 16) {
          this.redTaken.add(i);
          this.redStep++;
          // Timbre triangle + graduation par tons : bien distinct du carré fuel.
          this.audio.red(this.redStep);
          this.musicEvent('powerUp', 0.6);
          b.punch(0.2);
          b.setEmotion('happy', 0.5);
          this.wowT = 0.5;
          this.fx.burst(sx, sy, { n: 12, speed: [60, 260], colors: ['#ff5d7a', '#ffffff'], life: 0.45 });
          this.fx.ring(sx, sy, { r0: 8, r1: 60, color: '#ff8a9a', life: 0.35 });
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
            this.nextRedAt = this.worldY + RED_EVERY_PX;
          } else {
            this.fx.text(sx, sy - 20, 'ROUGE ' + this.redStep + '/' + len, { color: '#ff8a9a', size: 16, mono: true });
          }
        }
      }
      // On a dépassé la dernière pièce sans tout prendre : séquence ratée.
      if (this.redSeq) {
        const lastWY = (base + (len - 1) * RED_SPACING) * COL + 16;
        if (wy > lastWY + 80) {
          this.audio.miss();
          this.fx.text(b.x, b.y - 110, 'SÉQUENCE RATÉE', { color: '#ff8a9a', size: 16 });
          this.redSeq = null;
          this.nextRedAt = this.worldY + RED_EVERY_PX;
        }
      }
    }

    // near-miss : raser recharge un peu et excite le blob.
    // Intensité pilotée par la distance : une valeur unique alimente paroi,
    // kick caméra, fragments, rumble, squash et son.
    const wd = Math.min(b.x - this.leftAt(wy), this.rightAt(wy) - b.x) - b.r;
    this.clearance = Math.max(0, Math.min(1, (wd + 8) / 92));
    if (wd < 15 && this.state === 'play' && this.overdoseT <= 0) this.proxT += dt;
    else this.proxT = Math.max(0, this.proxT - dt * 3);
    if (this.proxT > 0.22 && this.proxCd <= 0) {
      this.proxT = 0; this.proxCd = 1.1;
      const k = Math.max(0, Math.min(1, 1 - wd / 15)); // 0 = loin, 1 = collé
      const sideLeft = (b.x - this.leftAt(wy)) < (this.rightAt(wy) - b.x);
      this.proxScore += 25;
      this.meter = Math.min(1, this.meter + PROX_FUEL);
      if (this.turboLock && this.meter >= REARM_THRESHOLD) this.turboLock = false;
      this.musicEvent('nearMiss', 0.5 + k * 0.5);
      this.audio.good();
      b.punch(0.15 + k * 0.2);
      b.setEmotion('wow', 0.6);
      this.wowT = 0.6;
      // Filament énergétique + fragments arrachés à la paroi.
      const edgeX = sideLeft ? this.leftAt(wy) : this.rightAt(wy);
      this.fx.text(b.x, b.y - 60, 'PROX +25', { color: '#c7d2fe', size: 16 });
      this.fx.burst(edgeX, b.y, { n: Math.round(4 + k * 10), speed: [40, 200], colors: ['#c7d2fe', '#ffffff'], size: [1.5, 3.5], life: 0.35 });
      this.fx.ring(edgeX, b.y, { r0: 6, r1: 50 + k * 70, color: '#c7d2fe', life: 0.3 });
      this.kickX += (sideLeft ? 1 : -1) * (6 + k * 10); // kick loin de la paroi
      this.impacts.push({ wy, t: 0 });
      this.input.rumble(0.1 + k * 0.25, 0.07);
    }

    // Haptique progressif : la manette gronde de plus en plus fort à mesure
    // que les parois et les membranes se rapprochent (tick 90 ms, pas de spam).
    if (this.rumbleT <= 0 && this.state === 'play') {
      this.rumbleT = RUMBLE_TICK;
      const wallD = 1 - this.clearance;
      let threat = 0;
      for (let i = i0 - 1; i <= i0 + 10; i++) {
        const gate = this.gateAt(i);
        if (gate) {
          const ahead = gate.y - wy;
          if (ahead > -40 && ahead < 420) {
            const inGap = b.x > gate.openL && b.x < gate.openR;
            const edgeD = Math.min(Math.abs(b.x - gate.openL), Math.abs(b.x - gate.openR));
            const t = (1 - (ahead + 40) / 460) * (inGap ? (1 - Math.min(1, edgeD / 140)) * 0.7 + 0.3 : 1);
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
    this.pace = this.worldY / Math.max(1, this.time);
    this.score = Math.max(0, Math.floor(this.pace * 3) + this.orbScore + this.proxScore + this.surgeScore - this.malusScore);

    // Corps : noyau stable, enveloppe spectaculaire. Le stretch suit la course
    // (biais avant purement visuel) ; la pose gère compression turbo et
    // écrasement directionnel. La hitbox `r` ne bouge jamais.
    const speedN = Math.max(0, Math.min(1, (speed - BASE_SPEED) / (HARD_CAP - BASE_SPEED)));
    this._pvx = b.vx; this._pvy = b.vy;
    b.vx = this._pvx;
    b.vy = this._pvy + speed * 0.55;
    this._biased = true;
    let psx = 1, psy = 1;
    if (this.hitPoseT > 0) {
      this.hitPoseT -= dt;
      if (this.hitSide === 'gate') { psx = 1.35; psy = 0.6; }
      else { psx = 0.62; psy = 1.3; }
    } else if (this.turboOn && this.turboAge < 0.12) {
      psx = 1.28; psy = 0.68; // compression de lancement
    }
    b.setPose(psx, psy, Math.min(0.3, speedN * 0.28 + (this.turboOn ? 0.08 : 0)), 0);

    // le trail remonte (le blob est fixe, le monde s'écoule vers le bas)
    for (const p of this.blob.trail) p.y -= speed * dt;
    this.blob.update(dt);

    // Caméra : suivi latéral doux + look-ahead vertical + kicks (turbo, hit).
    this.camX = (b.x - 640) * 0.18;
    const lookTarget = 40 + (this.turboOn ? 14 : 0) + this.difficulty() * 8;
    this.lookSm += (lookTarget - this.lookSm) * Math.min(1, dt * 3.2);
    this.kickX *= Math.exp(-7 * dt);
    this.lookKick *= Math.exp(-6 * dt);
    // Zoom lissé : plus de saut d'échelle à l'enclenchement du turbo.
    const zoomTarget = 0.80 - (this.turboOn ? 0.05 : 0) - this.difficulty() * 0.03 + (this.overdoseT > 0 ? 0.015 : 0);
    this.zoomSm += (zoomTarget - this.zoomSm) * Math.min(1, dt * 3.2);
    this.fx.zoom = this.zoomSm;
    // Micro-tremblement de vitesse + kick directionnel (le shake fort reste
    // réservé aux collisions, morts et overdoses).
    this.fx.userSwayX = this.kickX + Math.sin(this.time * 43) * 2.4 * speedN * (this.turboOn ? 1.4 : 1);
    this.fx.userRot = Math.sin(this.time * 31) * 0.0022 * speedN;
    this.speedNow = speed;
  }

  die(side: 'left' | 'right' | 'gate' = 'gate'): void {
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
    this.fx.text(b.x, b.y - 60, 'AÏE ! -1 VIE', { color: '#ff8a9a', size: 20 });
    // Écrasement directionnel : la hitbox ne bouge pas, le rendu s'aplatit.
    this.hitPoseT = 0.3;
    this.hitSide = side;
    b.punch(0.5);
    b.setEmotion('sad', 1.0);
    this.wowT = 1.0;
    // Kick caméra dans le sens de l'impact + fragments arrachés à la paroi.
    if (side === 'left') this.kickX += 14;
    else if (side === 'right') this.kickX -= 14;
    this.lookKick += 12;
    this.impacts.push({ wy: this.worldY, t: 0 });
    // Recentrage au cœur du boyau pour éviter la re-mort immédiate.
    const i = Math.floor(this.worldY / COL);
    const g = this.gap(i);
    b.x = this.clampC(i, g);
    b.y = PY;
    b.vx = 0; b.vy = 0;
    this.meter = Math.max(this.meter, 0.4);
    this.invulnT = INVULN_DUR;
  }

  // Tracé de paroi lissé (courbes, pas de polygones visibles — bible §3).
  private wallEdge(left: boolean): { x: number; y: number }[] {
    const pts: { x: number; y: number }[] = [];
    // ~32 rangées : couvre tout l'écran avec la caméra éloignée.
    const i0 = Math.floor(this.worldY / COL) - 10;
    const breatheAmp = 2 + this.difficulty() * 2.5 + this.speedNorm() * 2;
    const breatheFreq = 2.2 + this.speedNorm() * 2.5;
    for (let i = i0; i <= i0 + 32; i++) {
      const g = this.gap(i), c = this.clampC(i, g);
      const breathe = Math.sin(this.time * breatheFreq + i * 0.35) * breatheAmp;
      const x = (left ? c - g : c + g) + breathe;
      pts.push({ x, y: PY + this.worldY - i * COL });
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

  // Une cellule de matière : état visuel pur, jamais de collision.
  private cellHash(i: number, col: number): number {
    const h = Math.sin(i * 12.9898 + col * 78.233) * 43758.5453;
    return h - Math.floor(h);
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#05060c';
    ctx.fillRect(0, 0, 1280, 720);

    this.fx.world(ctx);
    ctx.save();
    ctx.translate(-(this.camX || 0), (this.lookSm || 0) + (this.lookKick || 0));

    const speedN = this.speedNorm();
    const diff = this.difficulty();
    const wy = this.worldY;
    const i0 = Math.floor(wy / COL);
    // Budget décor : quand le danger monte, l'écran se nettoie subtilement.
    const deco = this.clearance < 0.3 ? 0.5 : 1;

    // --- couche profonde (parallaxe lente, masse sombre) ---
    for (let j = 0; j < 18; j++) {
      const Y = PY + wy * 0.55 - j * DEEP_CELL + (wy * 0.45 % DEEP_CELL);
      if (Y < -70 || Y > 790) continue;
      const approxI = Math.floor((wy + (PY - Y)) / COL);
      const dg = this.gap(approxI), dc = this.clampC(approxI, dg);
      const dl = dc - dg, dr = dc + dg;
      for (let col = 0; col < 28; col++) {
        const cx = col * DEEP_CELL + DEEP_CELL / 2 + (this.cellHash(j, col) - 0.5) * 10;
        if (cx > dl - 60 && cx < dr + 60) continue;
        const h1 = this.cellHash(j + 57, col);
        ctx.globalAlpha = (0.25 + h1 * 0.2) * deco;
        ctx.fillStyle = '#1b2340';
        const s = 30 + h1 * 10;
        const dShake = speedN > 0.45 ? (speedN - 0.45) / 0.55 : 0;
        const djx = (this.cellHash(j + 5, col + 11) - 0.5) * 2 * dShake * 2.5;
        const djy = (this.cellHash(j + 9, col + 2) - 0.5) * 2 * dShake * 2.5;
        ctx.fillRect(cx + djx - s / 2, Y + djy - s / 2, s, s);
      }
    }

    // --- matière cellulaire : le vide est découpé dans la masse ---
    for (let i = i0 - 10; i <= i0 + 22; i++) {
      const g = this.gap(i), c = this.clampC(i, g);
      const Y = PY + wy - i * COL;
      if (Y < -70 || Y > 790) continue;
      const left = c - g, right = c + g;
      const sect = this.sectionType(i);
      for (let col = 0; col < 43; col++) {
        const cx = col * CELL + CELL / 2 + (this.cellHash(i, col) - 0.5) * 8;
        const dist = cx < left ? left - cx : cx > right ? cx - right : -1;
        if (dist < 0) continue; // dans le vide : rien à dessiner
        const h1 = this.cellHash(i, col + 91);
        // Tremblement de la matière passé un seuil de vitesse : la grotte vibre,
        // la collision, elle, ne bouge jamais.
        const shakeK = speedN > 0.45 ? (speedN - 0.45) / 0.55 : 0;
        const jx = (this.cellHash(i + 13, col + 7) - 0.5) * 2 * shakeK * 7;
        const jy = (this.cellHash(i + 29, col + 3) - 0.5) * 2 * shakeK * 7;
        const px = cx + jx, py = Y + jy;
        const freq = sect === 1 ? 3.5 : 2.2; // ÉTROIT : pulsations plus rapides
        let wave = 0.7 + 0.3 * Math.sin(this.time * freq + h1 * 6.28);
        if (sect === 3) wave += Math.sin(this.time * 4 - i * COL * 0.008) * 0.12; // SLALOM : onde
        // Ondes d'impact : la matière réagit puis se reforme.
        let boost = 0;
        for (const im of this.impacts) {
          const d = Math.abs(i * COL - im.wy);
          if (d < 130) boost += (1 - d / 130) * (1 - im.t / 0.55) * 0.8;
        }
        if (dist < 70) {
          // Proche du bord : lumineux, réactif, étiré par la vitesse.
          ctx.globalAlpha = Math.min(1, (0.30 + h1 * 0.15) * wave + boost) * deco;
          ctx.fillStyle = '#818cf8';
          const s = 22 + h1 * 5;
          const h = s * (1 + speedN * 1.2);
          ctx.fillRect(px - s / 2, py - h / 2, s, h);
        } else if (dist < 220) {
          ctx.globalAlpha = Math.min(1, (0.10 + h1 * 0.08) * wave + boost * 0.5) * deco;
          ctx.fillStyle = '#4a5580';
          const s = 20 + h1 * 6;
          ctx.fillRect(px - s / 2, py - s / 2, s, s);
        } else {
          ctx.globalAlpha = (0.35 + h1 * 0.2) * deco;
          ctx.fillStyle = '#141a2e';
          const s = 22 + h1 * 6;
          ctx.fillRect(px - s / 2, py - s / 2, s, s);
        }
      }
    }
    ctx.globalAlpha = 1;

    // --- poussières : densité pilotée par la vitesse, chutes verticales ---
    ctx.lineCap = 'round';
    for (const s of this.stars) {
      if (s.th > speedN * 0.85 + 0.15 + (1 - deco) * 0.2) continue;
      const sy = ((s.y + wy * (0.15 + s.z * 0.3)) % 760) - 20;
      const len = (2 + s.z * 4) + speedN * (10 + s.z * 26);
      ctx.globalAlpha = (0.10 + s.z * 0.10) * deco;
      ctx.strokeStyle = '#aab6ff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(s.x, sy - len);
      ctx.lineTo(s.x, sy);
      ctx.stroke();
    }
    // --- speed streaks verticaux : plus longs en turbo ---
    for (const s of this.streaks) {
      if (s.th > speedN * 0.9 + 0.1 + (1 - deco) * 0.2) continue;
      const sy = ((s.y + wy * (0.5 + s.z * 0.5)) % 760) - 20;
      const len = 20 + s.z * 60 + (this.boost - 1) * 60;
      ctx.globalAlpha = (0.05 + s.z * 0.06) * deco;
      ctx.strokeStyle = (this.turboOn ? '#c7d2fe' : '#8b95c9');
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(s.x, sy - len);
      ctx.lineTo(s.x, sy);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // --- parois : halo large + ligne cœur (le décor, pas la frontière) ---
    const leftPts = this.wallEdge(true);
    const rightPts = this.wallEdge(false);
    for (const pts of [leftPts, rightPts]) {
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

    // --- repères de profondeur : traits filants verticaux ---
    ctx.save();
    ctx.globalAlpha = 0.09;
    ctx.strokeStyle = '#c7d2fe';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    for (let k = i0 - 4; k <= i0 + 20; k++) {
      const l = this.leftAt(k * COL), r = this.rightAt(k * COL);
      const cx = (l + r) / 2;
      const Y = PY + wy - k * COL;
      const len = 14 + speedN * 42;
      ctx.beginPath();
      ctx.moveTo(cx, Y - len / 2);
      ctx.lineTo(cx, Y + len / 2);
      ctx.stroke();
    }
    ctx.restore();

    // --- danger : vignette latérale respirante quand on rase trop ---
    if (this.clearance < 0.58) {
      const danger = (0.58 - this.clearance) / 0.58;
      const pulse = 0.55 + 0.45 * Math.sin(this.time * 12);
      ctx.save();
      ctx.globalAlpha = danger * pulse * 0.18;
      const left = ctx.createLinearGradient(0, 0, 150, 0);
      left.addColorStop(0, '#ff5470'); left.addColorStop(1, 'rgba(255,84,112,0)');
      ctx.fillStyle = left; ctx.fillRect(0, -100, 150, 920);
      const right = ctx.createLinearGradient(1280, 0, 1130, 0);
      right.addColorStop(0, '#ff5470'); right.addColorStop(1, 'rgba(255,84,112,0)');
      ctx.fillStyle = right; ctx.fillRect(1130, -100, 150, 920);
      ctx.restore();
    }

    // --- overdose : voile toxique subtil ---
    if (this.overdoseT > 0) {
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 9);
      ctx.save();
      ctx.globalAlpha = 0.10 + pulse * 0.06;
      ctx.fillStyle = '#ff5470';
      ctx.fillRect(-100, -200, 1480, 1120);
      ctx.restore();
    }

    const ri0 = i0 - 6;
    const ri1 = i0 + 30;
    const toxic = this.overdoseT > 0;

    // --- gouttes de fuel : rondes, halo accent (rouge toxique en overdose) ---
    for (let i = ri0; i <= ri1; i++) {
      if (i < 25 || i % 6 !== 2 || this.taken.has(i)) continue;
      const g = this.gap(i), c = this.clampC(i, g);
      const ox = c + Math.sin(i * 1.7) * g * 0.45;
      if (this.orbHiddenByGate(i, ox)) continue;
      const sy = PY + wy - (i * COL + 16);
      if (sy < -80 || sy > 800) continue;
      const r = 9 + Math.sin(i * 2.4 + this.time * 5) * 2;
      const col = toxic ? '#ff5470' : this.accent;
      const glow = toxic ? '#ff5470' : '#c7d2fe';
      ctx.save();
      ctx.shadowColor = glow; ctx.shadowBlur = 14;
      const grad = ctx.createRadialGradient(ox - r * 0.3, sy - r * 0.35, r * 0.1, ox, sy, r);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.35, col);
      grad.addColorStop(1, toxic ? '#7a1626' : '#3b4280');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(ox, sy, r, 0, 6.2832); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.ellipse(ox - r * 0.28, sy - r * 0.34, r * 0.28, r * 0.18, -0.5, 0, 6.2832);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fill();
      ctx.restore();
    }

    // --- gouttes blanches = surge : corps blanc chaud + anneau accent ---
    for (let i = ri0; i <= ri1; i++) {
      if (i < 60 || i % 83 !== 40 || this.taken.has('s' + i)) continue;
      const sp = this.surgePos(i);
      if (!sp.ok) continue;
      const sy = PY + wy - (i * COL + 16);
      if (sy < -80 || sy > 800) continue;
      const r = 10 + Math.sin(this.time * 6 + i) * 2;
      ctx.save();
      ctx.shadowColor = '#ffffff'; ctx.shadowBlur = 18;
      const sg = ctx.createRadialGradient(sp.x - r * 0.3, sy - r * 0.35, r * 0.1, sp.x, sy, r);
      sg.addColorStop(0, '#ffffff');
      sg.addColorStop(0.5, '#e6e9ff');
      sg.addColorStop(1, this.accent);
      ctx.fillStyle = sg;
      ctx.beginPath(); ctx.arc(sp.x, sy, r, 0, 6.2832); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = this.accent;
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(this.time * 6 + i);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(sp.x, sy, r + 6, 0, 6.2832); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    // --- pièces rouges : filament discret + corps rouge + anneau ---
    if (this.redSeq) {
      const base = this.redSeq.base, len = this.redSeq.len;
      let px = -1, py = -1;
      for (let k = 0; k < len; k++) {
        const { i, x } = this.redX(base, k);
        const sy = PY + wy - (i * COL + 16);
        const done = this.redTaken.has(i);
        if (!done && sy > -80 && sy < 800) {
          if (px >= 0) {
            ctx.save();
            ctx.globalAlpha = 0.18;
            ctx.strokeStyle = '#ff5d7a';
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(x, sy); ctx.stroke();
            ctx.restore();
          }
          px = x; py = sy;
          const r = 9 + Math.sin(this.time * 5 + k * 1.1) * 2;
          ctx.save();
          ctx.shadowColor = '#ff5d7a'; ctx.shadowBlur = 14;
          const rg = ctx.createRadialGradient(x - r * 0.3, sy - r * 0.35, r * 0.1, x, sy, r);
          rg.addColorStop(0, '#ffffff');
          rg.addColorStop(0.4, '#ff5d7a');
          rg.addColorStop(1, '#8f1d33');
          ctx.fillStyle = rg;
          ctx.beginPath(); ctx.arc(x, sy, r, 0, 6.2832); ctx.fill();
          ctx.shadowBlur = 0;
          ctx.strokeStyle = '#ff8a9a';
          ctx.globalAlpha = 0.55 + 0.35 * Math.sin(this.time * 5 + k * 1.1);
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(x, sy, r + 5, 0, 6.2832); ctx.stroke();
          ctx.globalAlpha = 1;
          ctx.restore();
        } else if (done) { px = -1; }
      }
    }

    // --- membranes HORIZONTALES : double capsule + lèvres télégraphiées ---
    for (let i = ri0; i <= ri1; i++) {
      const gate = this.gateAt(i);
      if (!gate) continue;
      const gy = PY + wy - gate.y;
      if (gy < -80 || gy > 800) continue;
      // Télégraphie : l'ouverture s'illumine à l'approche.
      const ahead = gate.y - wy;
      const glowK = Math.max(0, Math.min(1, 1 - ahead / 700));
      for (const [x0, x1] of [[gate.left - 30, gate.openL], [gate.openR, gate.right + 30]] as const) {
        const w = Math.max(8, x1 - x0);
        ctx.save();
        ctx.shadowColor = this.accent; ctx.shadowBlur = 12;
        ctx.fillStyle = '#141828';
        UI.roundRect(ctx, x0, gy - 13, w, gate.h, 10);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = this.accent;
        ctx.lineWidth = 2;
        UI.roundRect(ctx, x0, gy - 13, w, gate.h, 10);
        ctx.stroke();
        ctx.restore();
      }
      // Lèvres danger autour de l'ouverture, d'autant plus vives que c'est proche.
      ctx.save();
      ctx.strokeStyle = '#ff5470';
      ctx.lineWidth = 2 + glowK * 2;
      ctx.lineCap = 'round';
      ctx.globalAlpha = 0.35 + glowK * 0.65;
      ctx.shadowColor = '#ff5470'; ctx.shadowBlur = 4 + glowK * 10;
      ctx.beginPath(); ctx.moveTo(gate.openL, gy - 17); ctx.lineTo(gate.openL, gy + 17); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(gate.openR, gy - 17); ctx.lineTo(gate.openR, gy + 17); ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    // --- GAMEPLAY EDGE : la vraie frontière, fine et nette, au-dessus de tout ---
    ctx.save();
    ctx.strokeStyle = '#e8ecf2';
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    this.strokeSmooth(ctx, leftPts);
    ctx.stroke();
    ctx.beginPath();
    this.strokeSmooth(ctx, rightPts);
    ctx.stroke();
    ctx.restore();

    // --- joueur : noyau clair, clignotement fantôme en invincibilité ---
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
    UI.txt(ctx, Math.floor(this.worldY / 40) + ' m', 640, 52, { size: 30, align: 'center', mono: true, color: '#a5b4fc', shadow: true });
    const spd = Math.round(this.speedNow || 0);
    const sect = this.sectionName(Math.floor(this.worldY / COL));
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
