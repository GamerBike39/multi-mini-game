// Le blob : goutte organique avec squash & stretch, yeux, trail, impulsions d'impact.
// Les jeux possèdent la physique ; le blob ne fait qu'intégrer le rendu à partir de (x, y, vx, vy).
// Hitbox `r`, punch(), setPose() et les coefficients de squash restent stables pour le gameplay.

const TAU = Math.PI * 2;

export type BlobEmotion =
  | 'idle'
  | 'happy'
  | 'focused'
  | 'determined'
  | 'wow'
  | 'scared'
  | 'sad'
  | 'sleepy';

interface EmotionFace {
  eyeScale: number;
  eyeOpen: number;
  pupilScale: number;
  brow: number;
  mouth: number;
  mouthWidth: number;
  mouthOpen: number;
  lookBiasY: number;
  blinkMul: number;
}

const EMOTIONS: Record<BlobEmotion, EmotionFace> = {
  idle: { eyeScale: 1, eyeOpen: 1, pupilScale: 1, brow: 0.04, mouth: 0.82, mouthWidth: 1.04, mouthOpen: 0, lookBiasY: -0.02, blinkMul: 1 },
  happy: { eyeScale: 1.02, eyeOpen: 0.92, pupilScale: 0.96, brow: 0.22, mouth: 1, mouthWidth: 1.12, mouthOpen: 0, lookBiasY: -0.03, blinkMul: 0.9 },
  focused: { eyeScale: 0.94, eyeOpen: 0.88, pupilScale: 0.86, brow: -0.18, mouth: 0.22, mouthWidth: 0.78, mouthOpen: 0, lookBiasY: 0.01, blinkMul: 1.15 },
  determined: { eyeScale: 0.98, eyeOpen: 0.9, pupilScale: 0.9, brow: -0.42, mouth: 0.35, mouthWidth: 0.86, mouthOpen: 0, lookBiasY: 0, blinkMul: 1.1 },
  wow: { eyeScale: 1.22, eyeOpen: 1.08, pupilScale: 0.78, brow: 0.55, mouth: 0, mouthWidth: 0.7, mouthOpen: 0.9, lookBiasY: -0.04, blinkMul: 1.4 },
  scared: { eyeScale: 1.28, eyeOpen: 1.1, pupilScale: 0.72, brow: 0.7, mouth: -0.15, mouthWidth: 0.62, mouthOpen: 0.55, lookBiasY: -0.02, blinkMul: 1.6 },
  sad: { eyeScale: 0.96, eyeOpen: 0.82, pupilScale: 1.05, brow: 0.38, mouth: -0.85, mouthWidth: 0.9, mouthOpen: 0, lookBiasY: 0.05, blinkMul: 0.75 },
  sleepy: { eyeScale: 1, eyeOpen: 0.42, pupilScale: 1.08, brow: 0.08, mouth: 0.28, mouthWidth: 0.82, mouthOpen: 0, lookBiasY: 0.04, blinkMul: 0.45 },
};

interface BlobOptions {
  x?: number;
  y?: number;
  r?: number;
  color?: string;
  trailOn?: boolean;
}

interface TrailPoint {
  x: number;
  y: number;
}

interface Vec2 {
  x: number;
  y: number;
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function parseRgb(hex: string): [number, number, number] {
  const raw = hex.replace('#', '').trim();
  if (raw.length === 3) {
    return [
      parseInt(raw[0] + raw[0], 16),
      parseInt(raw[1] + raw[1], 16),
      parseInt(raw[2] + raw[2], 16),
    ];
  }
  if (raw.length >= 6) {
    return [
      parseInt(raw.slice(0, 2), 16),
      parseInt(raw.slice(2, 4), 16),
      parseInt(raw.slice(4, 6), 16),
    ];
  }
  return [125, 211, 252];
}

function rgbCss(r: number, g: number, b: number, a = 1): string {
  const rr = Math.max(0, Math.min(255, Math.round(r)));
  const gg = Math.max(0, Math.min(255, Math.round(g)));
  const bb = Math.max(0, Math.min(255, Math.round(b)));
  if (a >= 1) return `rgb(${rr},${gg},${bb})`;
  return `rgba(${rr},${gg},${bb},${a})`;
}

function mixRgb(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  const k = clamp01(t);
  return [
    a[0] + (b[0] - a[0]) * k,
    a[1] + (b[1] - a[1]) * k,
    a[2] + (b[2] - a[2]) * k,
  ];
}

export class Blob {
  x: number;
  y: number;
  vx = 0;
  vy = 0;
  r: number;
  color: string;
  t = Math.random() * 10;
  jig = 0;
  trailOn = false;
  trail: TrailPoint[] = [];
  // Intensité du squash & stretch lié à la vitesse. Les jeux rapides peuvent
  // le réduire sans modifier la physique ni les autres déformations.
  speedMorph = 1;
  lookX = 0;
  lookY = 0;
  blink = 0;
  blinkT = 2 + Math.random() * 3;
  scared = false;
  dead = false;
  emotion: BlobEmotion = 'idle';
  private emotionHold = 0;
  hideTrail = false;
  poseX = 1;
  poseY = 1;
  liquid = 0;
  poseOffsetY = 0;
  // Suivi visuel du jig : plus doux, n'entre pas dans le squash gameplay.
  private jigSoft = 0;

  constructor({ x = 640, y = 360, r = 22, color = '#7dd3fc', trailOn = false }: BlobOptions = {}) {
    this.x = x;
    this.y = y;
    this.r = r;
    this.color = color;
    this.trailOn = trailOn;
  }

  punch(amount = 0.3): void {
    this.jig = Math.min(0.6, this.jig + amount);
  }

  // Déformation pilotée par un jeu (saut, duck, charge...). Elle reste
  // indépendante de la hitbox `r`, qui appartient toujours à la physique.
  setPose(scaleX = 1, scaleY = 1, liquid = 0, offsetY = 0): void {
    this.poseX = Math.max(0.2, scaleX);
    this.poseY = Math.max(0.2, scaleY);
    this.liquid = Math.max(0, Math.min(1, liquid));
    this.poseOffsetY = offsetY;
  }

  // Expression visuelle uniquement. hold=0 : reste jusqu'au prochain appel.
  // Les jeux peuvent continuer à n'utiliser que `scared` / `dead`.
  setEmotion(emotion: BlobEmotion, hold = 0): void {
    this.emotion = emotion;
    this.emotionHold = Math.max(0, hold);
  }

  resolvedEmotion(): BlobEmotion {
    if (this.scared) return 'scared';
    return this.emotion;
  }

  update(dt: number): void {
    this.t += dt;
    this.jig = Math.max(0, this.jig - dt * 4.5);
    this.jigSoft += (this.jig - this.jigSoft) * Math.min(1, dt * 16);
    if (this.emotionHold > 0) {
      this.emotionHold = Math.max(0, this.emotionHold - dt);
      if (this.emotionHold <= 0 && this.emotion !== 'idle') this.emotion = 'idle';
    }
    const face = EMOTIONS[this.resolvedEmotion()];
    this.blinkT -= dt * face.blinkMul;
    if (this.blinkT <= 0) {
      this.blink = 0.12;
      this.blinkT = 2.2 + Math.random() * 3.5;
    }
    if (this.blink > 0) this.blink -= dt;

    const sp = Math.hypot(this.vx, this.vy);
    if (sp > 30) {
      const tx = this.vx / sp;
      const ty = this.vy / sp;
      this.lookX += (tx - this.lookX) * Math.min(1, dt * 8);
      this.lookY += (ty - this.lookY) * Math.min(1, dt * 8);
    } else {
      this.lookX += (0 - this.lookX) * Math.min(1, dt * 2.4);
      this.lookY += (0 - this.lookY) * Math.min(1, dt * 2.4);
    }
    if (this.trailOn && !this.hideTrail) {
      this.trail.unshift({ x: this.x, y: this.y });
      if (this.trail.length > 14) this.trail.pop();
    } else if (this.trail.length) {
      this.trail.pop();
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    const r = this.r;
    const rgb = parseRgb(this.color);
    const light = mixRgb(rgb, [255, 255, 255], 0.42);
    const deep = mixRgb(rgb, [18, 28, 48], 0.38);

    if (this.trail.length > 2) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = this.trail.length - 1; i >= 1; i--) {
        const p = this.trail[i];
        const k = 1 - i / this.trail.length;
        const tr = r * (0.18 + k * 0.72);
        ctx.globalAlpha = k * 0.18;
        const tg = ctx.createRadialGradient(p.x, p.y, tr * 0.15, p.x, p.y, tr);
        tg.addColorStop(0, rgbCss(light[0], light[1], light[2], 0.85));
        tg.addColorStop(0.55, rgbCss(rgb[0], rgb[1], rgb[2], 0.35));
        tg.addColorStop(1, rgbCss(rgb[0], rgb[1], rgb[2], 0));
        ctx.fillStyle = tg;
        ctx.beginPath();
        ctx.arc(p.x, p.y, tr, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    const sp = Math.hypot(this.vx, this.vy);
    const k = this.dead ? 0 : Math.min(1, (sp / 620) * this.speedMorph);
    const angle = sp > 10 ? Math.atan2(this.vy, this.vx) : 0;
    // Coefficients inchangés : le runner recale le blob au sol avec la même formule.
    const sx = 1 + k * 0.30 + this.jig * 0.4;
    const sy = 1 - k * 0.18 - this.jig * 0.35;

    ctx.save();
    ctx.translate(this.x, this.y + (this.dead ? 0 : this.poseOffsetY));
    if (this.dead) {
      ctx.scale(1.5, 0.18);
    } else {
      ctx.rotate(angle);
      ctx.scale(sx, sy);
      ctx.rotate(-angle);
      // La pose de gameplay agit dans l'espace du monde : le saut s'écrase
      // verticalement même si la vitesse entraîne le blob en diagonale.
      ctx.scale(this.poseX, this.poseY);
    }

    const outline = this.organicPoints(r);
    this.fillOrganic(ctx, outline);
    ctx.shadowColor = rgbCss(rgb[0], rgb[1], rgb[2], 0.85);
    ctx.shadowBlur = 22;
    const body = ctx.createRadialGradient(-r * 0.28, -r * 0.34, r * 0.06, r * 0.08, r * 0.16, r * 1.12);
    body.addColorStop(0, rgbCss(light[0], light[1], light[2]));
    body.addColorStop(0.38, this.color);
    body.addColorStop(0.78, rgbCss(rgb[0], rgb[1], rgb[2]));
    body.addColorStop(1, rgbCss(deep[0], deep[1], deep[2]));
    ctx.fillStyle = body;
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.save();
    this.fillOrganic(ctx, outline);
    ctx.clip();

    // Volume bas : ombre douce, sans casser la rondeur.
    const shade = ctx.createRadialGradient(0, r * 0.42, r * 0.1, 0, r * 0.18, r * 1.05);
    shade.addColorStop(0, rgbCss(deep[0], deep[1], deep[2], 0.38));
    shade.addColorStop(1, rgbCss(deep[0], deep[1], deep[2], 0));
    ctx.fillStyle = shade;
    ctx.fillRect(-r * 1.4, -r * 1.4, r * 2.8, r * 2.8);

    // Reflet haut-gauche, elliptique.
    ctx.beginPath();
    ctx.ellipse(-r * 0.22, -r * 0.32, r * 0.42, r * 0.28, -0.45, 0, TAU);
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(-r * 0.30, -r * 0.40, r * 0.16, r * 0.11, -0.5, 0, TAU);
    ctx.fillStyle = 'rgba(255,255,255,0.42)';
    ctx.fill();

    // Liseré interne lumineux.
    ctx.strokeStyle = rgbCss(light[0], light[1], light[2], 0.28);
    ctx.lineWidth = Math.max(1.2, r * 0.06);
    this.strokeOrganic(ctx, outline);
    ctx.restore();

    if (!this.dead) {
      const face = EMOTIONS[this.resolvedEmotion()];
      this.drawEyes(ctx, r, face);
      this.drawBrows(ctx, r, face);
      this.drawMouth(ctx, r, face);
    } else {
      this.drawDeadEyes(ctx, r);
    }

    ctx.restore();
  }

  private organicRadius(angle: number, r: number): number {
    const t = this.t;
    const liq = this.liquid;
    const jig = this.jig;
    const jigS = this.jigSoft;
    // Respiration radiale : ne modifie pas le squash vertical du runner.
    const breath = 0.02 * Math.sin(t * 2.35);
    const lobe =
      0.036 * Math.sin(t * 1.55 + angle * 2)
      + 0.022 * Math.sin(t * 2.15 - angle * 3)
      + 0.012 * Math.sin(t * 3.4 + angle);
    const liquidWave = liq * (
      0.07 * Math.sin(t * 7.5 + angle * 3)
      + 0.035 * Math.sin(t * 13.5 - angle * 2)
    );
    const punchWave =
      jig * 0.22 * Math.sin(t * 18 + angle * 4)
      + jigS * 0.16 * Math.sin(t * 11 - angle * 2.2);
    const stretch = 1 + liq * 0.03 * Math.sin(t * 8 + angle);
    return r * (1 + breath + lobe + liquidWave + punchWave) * stretch;
  }

  private organicPoints(r: number): Vec2[] {
    const N = 28;
    const pts: Vec2[] = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU;
      const rr = this.organicRadius(a, r);
      pts.push({ x: Math.cos(a) * rr, y: Math.sin(a) * rr });
    }
    return pts;
  }

  private fillOrganic(ctx: CanvasRenderingContext2D, pts: Vec2[]): void {
    const n = pts.length;
    ctx.beginPath();
    ctx.moveTo((pts[n - 1].x + pts[0].x) * 0.5, (pts[n - 1].y + pts[0].y) * 0.5);
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % n];
      ctx.quadraticCurveTo(p.x, p.y, (p.x + q.x) * 0.5, (p.y + q.y) * 0.5);
    }
    ctx.closePath();
  }

  private strokeOrganic(ctx: CanvasRenderingContext2D, pts: Vec2[]): void {
    this.fillOrganic(ctx, pts);
    ctx.stroke();
  }

  private drawEyes(ctx: CanvasRenderingContext2D, r: number, face: EmotionFace): void {
    const ex = this.lookX * r * 0.22;
    const ey = this.lookY * r * 0.22 + face.lookBiasY * r;
    const blink = this.blink > 0 ? 0.14 : face.eyeOpen;
    const whiteR = r * 0.168 * face.eyeScale;
    const pupilR = r * 0.092 * face.pupilScale;
    const px = this.lookX * r * 0.055;
    const py = this.lookY * r * 0.055;

    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(ex + side * r * 0.30, ey - r * 0.10);
      ctx.scale(1, blink);

      ctx.beginPath();
      ctx.ellipse(0, 0, whiteR * 0.96, whiteR * 1.08, 0, 0, TAU);
      ctx.fillStyle = '#f4fbff';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(px, py + r * 0.02, pupilR, 0, TAU);
      ctx.fillStyle = '#0b0e14';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(px - pupilR * 0.32, py - pupilR * 0.38, pupilR * 0.28, 0, TAU);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fill();

      ctx.restore();
    }
  }

  private drawBrows(ctx: CanvasRenderingContext2D, r: number, face: EmotionFace): void {
    if (Math.abs(face.brow) < 0.08) return;
    const ex = this.lookX * r * 0.22;
    const ey = this.lookY * r * 0.22 + face.lookBiasY * r;
    ctx.strokeStyle = 'rgba(11,14,20,0.72)';
    ctx.lineWidth = Math.max(1.1, r * 0.055);
    ctx.lineCap = 'round';
    const lift = face.brow * r * 0.08;
    const tilt = face.brow * 0.55;
    for (const side of [-1, 1]) {
      const cx = ex + side * r * 0.30;
      const cy = ey - r * 0.28;
      const w = r * 0.13;
      ctx.beginPath();
      ctx.moveTo(cx - w, cy + side * tilt * r * 0.04 - lift * 0.15);
      ctx.quadraticCurveTo(cx, cy - lift, cx + w, cy - side * tilt * r * 0.04 - lift * 0.15);
      ctx.stroke();
    }
  }

  private drawMouth(ctx: CanvasRenderingContext2D, r: number, face: EmotionFace): void {
    const mx = this.lookX * r * 0.08;
    const my = r * 0.22 + face.lookBiasY * r * 0.4;
    const w = r * 0.20 * face.mouthWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (face.mouthOpen > 0.35) {
      ctx.beginPath();
      ctx.ellipse(mx, my + r * 0.02, w * 0.42, r * (0.05 + 0.07 * face.mouthOpen), 0, 0, TAU);
      ctx.fillStyle = '#0b0e14';
      ctx.fill();
      return;
    }
    ctx.strokeStyle = '#0b0e14';
    ctx.lineWidth = Math.max(1.15, r * 0.065);
    const curve = face.mouth * r * 0.13;
    ctx.beginPath();
    ctx.moveTo(mx - w, my);
    ctx.quadraticCurveTo(mx, my + curve, mx + w, my);
    ctx.stroke();
  }

  private drawDeadEyes(ctx: CanvasRenderingContext2D, r: number): void {
    ctx.strokeStyle = '#0b0e14';
    ctx.lineWidth = Math.max(2, r * 0.11);
    ctx.lineCap = 'round';
    for (const side of [-1, 1]) {
      const cx = side * r * 0.34;
      const cy = -r * 0.1;
      const s = Math.max(3.2, r * 0.16);
      ctx.beginPath();
      ctx.moveTo(cx - s, cy - s);
      ctx.lineTo(cx + s, cy + s);
      ctx.moveTo(cx + s, cy - s);
      ctx.lineTo(cx - s, cy + s);
      ctx.stroke();
    }
  }
}
