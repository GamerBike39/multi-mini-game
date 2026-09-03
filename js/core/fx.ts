// Kit d'effets partagé : particules, anneaux, textes flottants, screenshake (trauma),
// hitstop, slow-mo, flash. Chaque app (menu + jeux) possède sa propre instance.

const rand = (a: number, b: number): number => a + Math.random() * (b - a);

interface BurstOptions {
  n?: number;
  speed?: [number, number];
  size?: [number, number];
  life?: number;
  colors?: string[];
  ang?: number;
  spread?: number;
  drag?: number;
  grav?: number;
  shape?: string;
}

interface ImplodeOptions {
  n?: number;
  radius?: number;
  speed?: [number, number];
  size?: [number, number];
  life?: number;
  colors?: string[];
  drag?: number;
  grav?: number;
  shape?: string;
}

interface RingOptions {
  r0?: number;
  r1?: number;
  life?: number;
  color?: string;
  width?: number;
}

interface TextOptions {
  color?: string;
  size?: number;
  life?: number;
  vy?: number;
  mono?: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  drag: number;
  grav: number;
  shape: string;
  rot: number;
  vr: number;
}

interface Ring {
  x: number;
  y: number;
  r0: number;
  r1: number;
  life: number;
  maxLife: number;
  color: string;
  width: number;
}

interface FloatingText {
  x: number;
  y: number;
  str: string;
  color: string;
  size: number;
  life: number;
  maxLife: number;
  vy: number;
  mono: boolean;
}

export class Fx {
  readonly parts: Particle[] = [];
  readonly rings: Ring[] = [];
  readonly texts: FloatingText[] = [];
  trauma = 0;
  hitstop = 0;
  timeScale = 1;
  flashA = 0;
  flashC = '#ffffff';
  shakeX = 0;
  shakeY = 0;
  rot = 0;
  userRot = 0;
  userSwayX = 0;
  zoom = 1;
  t = 0;

  shake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  stop(seconds: number): void {
    this.hitstop = Math.max(this.hitstop, seconds);
  }

  flash(color = '#ffffff', alpha = 0.3): void {
    this.flashC = color;
    this.flashA = Math.max(this.flashA, alpha);
  }

  burst(x: number, y: number, options: BurstOptions = {}): void {
    const n = options.n ?? 14;
    const speed = options.speed ?? [60, 320];
    const size = options.size ?? [2, 5];
    const life = options.life ?? 0.6;
    const colors = options.colors ?? ['#ffffff'];

    for (let i = 0; i < n; i++) {
      const angle = options.ang !== undefined
        ? options.ang + (Math.random() - 0.5) * (options.spread ?? 1.2)
        : Math.random() * Math.PI * 2;
      const velocity = rand(speed[0], speed[1]);
      const particleLife = rand(life * 0.55, life);
      this.parts.push({
        x,
        y,
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity,
        life: particleLife,
        maxLife: particleLife,
        size: rand(size[0], size[1]),
        color: colors[(Math.random() * colors.length) | 0],
        drag: options.drag ?? 0.9,
        grav: options.grav ?? 0,
        shape: options.shape ?? 'dot',
        rot: Math.random() * 6.28,
        vr: (Math.random() - 0.5) * 10,
      });
    }
    if (this.parts.length > 700) this.parts.splice(0, this.parts.length - 700);
  }

  // Nuage de particules attiré vers un centre. Utile pour les implosions et
  // les charges d'énergie sans introduire de sprite ou de second système FX.
  implode(x: number, y: number, options: ImplodeOptions = {}): void {
    const n = options.n ?? 16;
    const radius = options.radius ?? 60;
    const speed = options.speed ?? [70, 240];
    const size = options.size ?? [1.5, 4];
    const life = options.life ?? 0.35;
    const colors = options.colors ?? ['#ffffff'];

    for (let i = 0; i < n; i++) {
      const angle = Math.random() * Math.PI * 2;
      const distance = rand(radius * 0.68, radius);
      const velocity = rand(speed[0], speed[1]);
      const tangent = (Math.random() - 0.5) * velocity * 0.24;
      const particleLife = rand(life * 0.55, life);
      const nx = Math.cos(angle), ny = Math.sin(angle);
      this.parts.push({
        x: x + nx * distance,
        y: y + ny * distance,
        vx: -nx * velocity - ny * tangent,
        vy: -ny * velocity + nx * tangent,
        life: particleLife,
        maxLife: particleLife,
        size: rand(size[0], size[1]),
        color: colors[(Math.random() * colors.length) | 0],
        drag: options.drag ?? 0.9,
        grav: options.grav ?? 0,
        shape: options.shape ?? 'dot',
        rot: Math.random() * 6.28,
        vr: (Math.random() - 0.5) * 10,
      });
    }
    if (this.parts.length > 700) this.parts.splice(0, this.parts.length - 700);
  }

  ring(x: number, y: number, options: RingOptions = {}): void {
    this.rings.push({
      x,
      y,
      r0: options.r0 ?? 8,
      r1: options.r1 ?? 70,
      life: options.life ?? 0.35,
      maxLife: options.life ?? 0.35,
      color: options.color ?? '#ffffff',
      width: options.width ?? 3,
    });
  }

  text(x: number, y: number, str: string, options: TextOptions = {}): void {
    this.texts.push({
      x,
      y,
      str,
      color: options.color ?? '#ffffff',
      size: options.size ?? 22,
      life: options.life ?? 0.8,
      maxLife: options.life ?? 0.8,
      vy: options.vy ?? -46,
      mono: options.mono ?? false,
    });
    if (this.texts.length > 40) this.texts.shift();
  }

  // Retourne le dt réel à passer au monde (0 pendant hitstop, ralenti via timeScale).
  consume(dt: number): number {
    if (this.hitstop > 0) {
      this.hitstop = Math.max(0, this.hitstop - dt);
      return 0;
    }
    return dt * this.timeScale;
  }

  update(dt: number): void {
    this.t += dt;
    const particles = this.parts;
    let write = 0;
    for (let i = 0; i < particles.length; i++) {
      const particle = particles[i];
      particle.life -= dt;
      if (particle.life <= 0) continue;
      const drag = Math.pow(particle.drag, dt * 60);
      particle.vx *= drag;
      particle.vy *= drag;
      particle.vy += particle.grav * dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.rot += particle.vr * dt;
      particles[write++] = particle;
    }
    particles.length = write;

    write = 0;
    for (let i = 0; i < this.rings.length; i++) {
      const ring = this.rings[i];
      ring.life -= dt;
      if (ring.life > 0) this.rings[write++] = ring;
    }
    this.rings.length = write;

    write = 0;
    for (let i = 0; i < this.texts.length; i++) {
      const floatingText = this.texts[i];
      floatingText.life -= dt;
      if (floatingText.life > 0) {
        floatingText.y += floatingText.vy * dt;
        this.texts[write++] = floatingText;
      }
    }
    this.texts.length = write;
  }

  cosmetic(dt: number): void {
    this.trauma = Math.max(0, this.trauma - dt * 1.7);
    this.flashA = Math.max(0, this.flashA - dt * 2.4);
    const magnitude = this.trauma * this.trauma;
    this.shakeX = (Math.random() * 2 - 1) * 17 * magnitude + this.userSwayX;
    this.shakeY = (Math.random() * 2 - 1) * 17 * magnitude;
    this.rot = (Math.random() * 2 - 1) * 0.02 * magnitude + this.userRot;
  }

  // À encadrer autour du rendu "monde" (soumis au shake/zoom/rotation).
  world(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.translate(640, 360);
    ctx.rotate(this.rot);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-640 + this.shakeX, -360 + this.shakeY);
  }

  endWorld(ctx: CanvasRenderingContext2D): void {
    ctx.restore();
  }

  drawWorld(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const ring of this.rings) {
      const k = ring.life / ring.maxLife;
      ctx.globalAlpha = k * 0.9;
      ctx.strokeStyle = ring.color;
      ctx.lineWidth = Math.max(0.5, ring.width * k);
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, ring.r0 + (ring.r1 - ring.r0) * (1 - k), 0, 6.2832);
      ctx.stroke();
    }

    for (const particle of this.parts) {
      const k = particle.life / particle.maxLife;
      ctx.globalAlpha = k;
      ctx.fillStyle = particle.color;
      if (particle.shape === 'spark') {
        ctx.strokeStyle = particle.color;
        ctx.lineWidth = Math.max(1, particle.size * 0.6);
        ctx.beginPath();
        ctx.moveTo(particle.x, particle.y);
        ctx.lineTo(particle.x - particle.vx * 0.035, particle.y - particle.vy * 0.035);
        ctx.stroke();
      } else if (particle.shape === 'sq') {
        ctx.save();
        ctx.translate(particle.x, particle.y);
        ctx.rotate(particle.rot);
        const size = particle.size * (0.5 + k * 0.5);
        ctx.fillRect(-size / 2, -size / 2, size, size);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, Math.max(0.4, particle.size * (0.4 + k * 0.6)), 0, 6.2832);
        ctx.fill();
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;

    for (const floatingText of this.texts) {
      const k = floatingText.life / floatingText.maxLife;
      const scale = k > 0.7 ? 1 + (k - 0.7) / 0.3 * 0.5 : 1;
      ctx.save();
      ctx.translate(floatingText.x, floatingText.y);
      ctx.scale(scale, scale);
      ctx.globalAlpha = Math.min(1, k * 3);
      ctx.font = `900 ${floatingText.size}px ${floatingText.mono ? 'Consolas, monospace' : '"Segoe UI", system-ui, sans-serif'}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#00000088';
      ctx.fillText(floatingText.str, 1.5, 1.5);
      ctx.fillStyle = floatingText.color;
      ctx.fillText(floatingText.str, 0, 0);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  drawFlash(ctx: CanvasRenderingContext2D): void {
    if (this.flashA <= 0.003) return;
    ctx.globalAlpha = this.flashA;
    ctx.fillStyle = this.flashC;
    ctx.fillRect(0, 0, 1280, 720);
    ctx.globalAlpha = 1;
  }
}
