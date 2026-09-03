import type { Aabb } from './physics';

export interface CircleShape {
  x: number;
  y: number;
  radius: number;
}

export interface SegmentShape {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function circleIntersectsCircle(a: CircleShape, b: CircleShape): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const radius = Math.max(0, a.radius) + Math.max(0, b.radius);
  return dx * dx + dy * dy <= radius * radius;
}

export function circleIntersectsAabb(circle: CircleShape, box: Aabb): boolean {
  const closestX = Math.max(box.x, Math.min(box.x + box.w, circle.x));
  const closestY = Math.max(box.y, Math.min(box.y + box.h, circle.y));
  const dx = circle.x - closestX;
  const dy = circle.y - closestY;
  return dx * dx + dy * dy <= Math.max(0, circle.radius) ** 2;
}

/** Test de segment contre rectangle par la méthode des slabs. */
export function segmentIntersectsAabb(segment: SegmentShape, box: Aabb): boolean {
  let tMin = 0;
  let tMax = 1;
  const dx = segment.x1 - segment.x0;
  const dy = segment.y1 - segment.y0;
  const axes: readonly [number, number, number, number][] = [
    [segment.x0, dx, box.x, box.x + box.w],
    [segment.y0, dy, box.y, box.y + box.h],
  ];
  for (const [origin, delta, min, max] of axes) {
    if (Math.abs(delta) < 1e-12) {
      if (origin < min || origin > max) return false;
      continue;
    }
    let t0 = (min - origin) / delta;
    let t1 = (max - origin) / delta;
    if (t0 > t1) [t0, t1] = [t1, t0];
    tMin = Math.max(tMin, t0);
    tMax = Math.min(tMax, t1);
    if (tMin > tMax) return false;
  }
  return true;
}
