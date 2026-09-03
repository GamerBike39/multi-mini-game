import { SpatialHash } from './spatial-hash';
import { circleIntersectsAabb, circleIntersectsCircle } from './collisions';

export interface Aabb {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Shape =
  | { kind: 'circle'; radius: number }
  | { kind: 'aabb'; width: number; height: number };

export interface BodyDefinition {
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  shape: Shape;
  static?: boolean;
  gravity?: number;
  damping?: number;
  restitution?: number;
  layer?: number;
  mask?: number;
  userData?: unknown;
}

export interface PhysicsBody extends BodyDefinition {
  readonly id: number;
  vx: number;
  vy: number;
  static: boolean;
  gravity: number;
  damping: number;
  restitution: number;
  layer: number;
  mask: number;
}

export interface CollisionManifold {
  normalX: number;
  normalY: number;
  depth: number;
}

export interface CollisionEvent {
  a: PhysicsBody;
  b: PhysicsBody;
  manifold: CollisionManifold;
}

export type CollisionListener = (event: CollisionEvent) => void;

export interface PhysicsWorldLike {
  createBody(definition: BodyDefinition): PhysicsBody;
  destroyBody(body: PhysicsBody): void;
  step(dt: number): void;
  queryAabb(area: Aabb): readonly PhysicsBody[];
  queryCircle(x: number, y: number, radius: number): readonly PhysicsBody[];
  debugRender(ctx: CanvasRenderingContext2D): void;
}

function bodyBounds(body: PhysicsBody): Aabb {
  if (body.shape.kind === 'circle') {
    const r = Math.max(0, body.shape.radius);
    return { x: body.x - r, y: body.y - r, w: r * 2, h: r * 2 };
  }
  return {
    x: body.x - body.shape.width / 2,
    y: body.y - body.shape.height / 2,
    w: body.shape.width,
    h: body.shape.height,
  };
}

function aabbIntersects(a: Aabb, b: Aabb): boolean {
  return a.x <= b.x + b.w && a.x + a.w >= b.x
    && a.y <= b.y + b.h && a.y + a.h >= b.y;
}

function invert(manifold: CollisionManifold): CollisionManifold {
  return { normalX: -manifold.normalX, normalY: -manifold.normalY, depth: manifold.depth };
}

function circleCircle(a: PhysicsBody, b: PhysicsBody): CollisionManifold | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const radius = a.shape.kind === 'circle' ? a.shape.radius : 0;
  const otherRadius = b.shape.kind === 'circle' ? b.shape.radius : 0;
  const distanceSquared = dx * dx + dy * dy;
  const sum = radius + otherRadius;
  if (distanceSquared >= sum * sum) return null;
  if (distanceSquared < 1e-8) return { normalX: 1, normalY: 0, depth: sum };
  const distance = Math.sqrt(distanceSquared);
  return { normalX: dx / distance, normalY: dy / distance, depth: sum - distance };
}

function aabbAabb(a: PhysicsBody, b: PhysicsBody): CollisionManifold | null {
  const aw = a.shape.kind === 'aabb' ? a.shape.width : 0;
  const ah = a.shape.kind === 'aabb' ? a.shape.height : 0;
  const bw = b.shape.kind === 'aabb' ? b.shape.width : 0;
  const bh = b.shape.kind === 'aabb' ? b.shape.height : 0;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const overlapX = (aw + bw) / 2 - Math.abs(dx);
  const overlapY = (ah + bh) / 2 - Math.abs(dy);
  if (overlapX <= 0 || overlapY <= 0) return null;
  if (overlapX < overlapY) return { normalX: dx < 0 ? -1 : 1, normalY: 0, depth: overlapX };
  return { normalX: 0, normalY: dy < 0 ? -1 : 1, depth: overlapY };
}

function circleAabb(circle: PhysicsBody, box: PhysicsBody): CollisionManifold | null {
  const radius = circle.shape.kind === 'circle' ? circle.shape.radius : 0;
  const halfW = box.shape.kind === 'aabb' ? box.shape.width / 2 : 0;
  const halfH = box.shape.kind === 'aabb' ? box.shape.height / 2 : 0;
  const localX = circle.x - box.x;
  const localY = circle.y - box.y;
  const closestX = Math.max(-halfW, Math.min(halfW, localX));
  const closestY = Math.max(-halfH, Math.min(halfH, localY));
  const dx = localX - closestX;
  const dy = localY - closestY;
  const distanceSquared = dx * dx + dy * dy;
  if (distanceSquared > radius * radius) return null;
  if (distanceSquared > 1e-8) {
    const distance = Math.sqrt(distanceSquared);
    // Normale de A vers B (du cercle vers la boîte).
    return { normalX: -dx / distance, normalY: -dy / distance, depth: radius - distance };
  }

  const penX = halfW + radius - Math.abs(localX);
  const penY = halfH + radius - Math.abs(localY);
  if (penX < penY) return { normalX: localX < 0 ? 1 : -1, normalY: 0, depth: penX };
  return { normalX: 0, normalY: localY < 0 ? 1 : -1, depth: penY };
}

function detect(a: PhysicsBody, b: PhysicsBody): CollisionManifold | null {
  if (a.shape.kind === 'circle' && b.shape.kind === 'circle') return circleCircle(a, b);
  if (a.shape.kind === 'aabb' && b.shape.kind === 'aabb') return aabbAabb(a, b);
  if (a.shape.kind === 'circle' && b.shape.kind === 'aabb') return circleAabb(a, b);
  const manifold = circleAabb(b, a);
  return manifold ? invert(manifold) : null;
}

function canCollide(a: PhysicsBody, b: PhysicsBody): boolean {
  return (a.mask & b.layer) !== 0 && (b.mask & a.layer) !== 0;
}

export class PhysicsWorld implements PhysicsWorldLike {
  readonly bodies: PhysicsBody[] = [];
  readonly hash: SpatialHash<PhysicsBody>;
  readonly collisions: CollisionEvent[] = [];
  private readonly listeners: CollisionListener[] = [];
  private readonly candidateScratch: PhysicsBody[] = [];
  private readonly queryScratch: PhysicsBody[] = [];
  private readonly aabbQueryResults: PhysicsBody[] = [];
  private readonly circleQueryResults: PhysicsBody[] = [];
  private nextId = 1;
  private debug = false;
  private debugSpatialHash = false;
  private hashReady = false;

  constructor(cellSize = 64) {
    this.hash = new SpatialHash<PhysicsBody>(cellSize);
  }

  createBody(definition: BodyDefinition): PhysicsBody {
    const body: PhysicsBody = {
      ...definition,
      id: this.nextId++,
      vx: definition.vx ?? 0,
      vy: definition.vy ?? 0,
      static: definition.static ?? false,
      gravity: definition.gravity ?? 0,
      damping: definition.damping ?? 1,
      restitution: Math.max(0, Math.min(1, definition.restitution ?? 0.8)),
      layer: definition.layer ?? 1,
      mask: definition.mask ?? 0xffffffff,
    };
    this.bodies.push(body);
    this.hashReady = false;
    return body;
  }

  destroyBody(body: PhysicsBody): void {
    const index = this.bodies.indexOf(body);
    if (index < 0) return;
    this.hash.remove(body);
    this.hashReady = false;
    const last = this.bodies.pop();
    if (last && index < this.bodies.length) this.bodies[index] = last;
  }

  onCollision(listener: CollisionListener): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) this.listeners.splice(index, 1);
    };
  }

  step(dt: number): void {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    this.collisions.length = 0;
    for (const body of this.bodies) {
      if (body.static) continue;
      body.vy += body.gravity * dt;
      const damping = Math.pow(Math.max(0, Math.min(1, body.damping)), dt * 60);
      body.vx *= damping;
      body.vy *= damping;
      body.x += body.vx * dt;
      body.y += body.vy * dt;
    }

    this.rebuildHash();

    for (const body of this.bodies) {
      const bounds = bodyBounds(body);
      this.hash.queryAabb(bounds.x, bounds.y, bounds.x + bounds.w, bounds.y + bounds.h, this.candidateScratch);
      for (const other of this.candidateScratch) {
        if (other.id <= body.id || !canCollide(body, other)) continue;
        const manifold = detect(body, other);
        if (!manifold || manifold.depth <= 0) continue;
        this.resolve(body, other, manifold);
        const event = { a: body, b: other, manifold };
        this.collisions.push(event);
        for (const listener of this.listeners) listener(event);
      }
    }
  }

  private resolve(a: PhysicsBody, b: PhysicsBody, manifold: CollisionManifold): void {
    const aMove = a.static ? 0 : b.static ? 1 : 0.5;
    const bMove = b.static ? 0 : a.static ? 1 : 0.5;
    const correction = manifold.depth + 0.001;
    a.x -= manifold.normalX * correction * aMove;
    a.y -= manifold.normalY * correction * aMove;
    b.x += manifold.normalX * correction * bMove;
    b.y += manifold.normalY * correction * bMove;

    const rvx = b.vx - a.vx;
    const rvy = b.vy - a.vy;
    const velocityAlongNormal = rvx * manifold.normalX + rvy * manifold.normalY;
    if (velocityAlongNormal > 0) return;
    const restitution = Math.min(a.restitution, b.restitution);
    const inverseMass = (a.static ? 0 : 1) + (b.static ? 0 : 1);
    if (inverseMass <= 0) return;
    const impulse = -(1 + restitution) * velocityAlongNormal / inverseMass;
    const ix = impulse * manifold.normalX;
    const iy = impulse * manifold.normalY;
    if (!a.static) {
      a.vx -= ix;
      a.vy -= iy;
    }
    if (!b.static) {
      b.vx += ix;
      b.vy += iy;
    }
  }

  queryAabb(area: Aabb): readonly PhysicsBody[] {
    if (!this.hashReady) this.rebuildHash();
    const result = this.aabbQueryResults;
    result.length = 0;
    const candidates = this.hash.queryAabb(area.x, area.y, area.x + area.w, area.y + area.h, this.queryScratch);
    for (const body of candidates) {
      if (aabbIntersects(area, bodyBounds(body))) result.push(body);
    }
    return result;
  }

  queryCircle(x: number, y: number, radius: number): readonly PhysicsBody[] {
    if (!this.hashReady) this.rebuildHash();
    const result = this.circleQueryResults;
    result.length = 0;
    const safeRadius = Math.max(0, radius);
    const candidates = this.hash.queryAabb(x - safeRadius, y - safeRadius, x + safeRadius, y + safeRadius, this.queryScratch);
    const circle = { x, y, radius: safeRadius };
    for (const body of candidates) {
      if (body.shape.kind === 'circle') {
        if (circleIntersectsCircle(circle, { x: body.x, y: body.y, radius: body.shape.radius })) result.push(body);
      } else if (circleIntersectsAabb(circle, bodyBounds(body))) {
        result.push(body);
      }
    }
    return result;
  }

  private rebuildHash(): void {
    this.hash.clear();
    for (const body of this.bodies) {
      const bounds = bodyBounds(body);
      this.hash.insert(body, bounds.x, bounds.y, bounds.x + bounds.w, bounds.y + bounds.h);
    }
    this.hashReady = true;
  }

  setDebug(enabled: boolean, spatialHash = false): void {
    this.debug = enabled;
    this.debugSpatialHash = spatialHash;
  }

  debugRender(ctx: CanvasRenderingContext2D): void {
    if (!this.debug && !this.debugSpatialHash) return;
    ctx.save();
    if (this.debugSpatialHash) this.hash.debugRender(ctx);
    if (!this.debug) {
      ctx.restore();
      return;
    }
    ctx.lineWidth = 1.5;
    for (const body of this.bodies) {
      ctx.strokeStyle = body.static ? '#94a3b8aa' : '#34d399cc';
      if (body.shape.kind === 'circle') {
        ctx.beginPath();
        ctx.arc(body.x, body.y, body.shape.radius, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.strokeRect(body.x - body.shape.width / 2, body.y - body.shape.height / 2, body.shape.width, body.shape.height);
      }
      ctx.beginPath();
      ctx.moveTo(body.x, body.y);
      ctx.lineTo(body.x + body.vx * 0.08, body.y + body.vy * 0.08);
      ctx.stroke();
    }
    ctx.restore();
  }
}
