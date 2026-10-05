/**
 * House outline editing geometry: vertex snapping to right angles and moving a wall parallel to itself.
 * Calculations run in a local metric plane around the outline (short distances, equirectangular projection).
 * Edge j connects points[j] and points[(j + 1) % n].
 */
import type { LngLat } from './types';

type V = [number, number];

const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LNG = 111320;

function plane(origin: LngLat) {
  const cos = Math.cos((origin[1] * Math.PI) / 180);
  return {
    to: (p: LngLat): V => [(p[0] - origin[0]) * cos * M_PER_DEG_LNG, (p[1] - origin[1]) * M_PER_DEG_LAT],
    from: (v: V): LngLat => [origin[0] + v[0] / (cos * M_PER_DEG_LNG), origin[1] + v[1] / M_PER_DEG_LAT],
  };
}

const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1]];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1]];
const mul = (a: V, k: number): V => [a[0] * k, a[1] * k];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1];
const len = (a: V) => Math.hypot(a[0], a[1]);
const perp = (a: V): V => [-a[1], a[0]];

/** Projection of v onto the line through p with direction d. */
function projectOnLine(v: V, p: V, d: V): V {
  return add(p, mul(d, dot(sub(v, p), d) / dot(d, d)));
}

/** Intersection of two lines (p1 + t·d1, p2 + s·d2), or null if (nearly) parallel. */
function intersect(p1: V, d1: V, p2: V, d2: V): V | null {
  const cross = d1[0] * d2[1] - d1[1] * d2[0];
  if (Math.abs(cross) < 1e-9 * len(d1) * len(d2)) return null;
  const t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / cross;
  return add(p1, mul(d1, t));
}

export interface SnapResult {
  point: LngLat;
  /** Edges drawn green while dragging: a right angle was snapped at their far end or at the vertex itself. */
  greenEdges: number[];
}

/**
 * Snaps a dragged vertex to right-angle positions within `tolerance` meters:
 * - on the line where the previous (or next) corner becomes a right angle — the edge to that corner turns green;
 * - on the circle over the two neighbours (Thales), where the vertex itself is a right angle — both edges green;
 * - at the intersection of both neighbour lines when both are in reach — both edges green.
 */
export function snapVertex(points: LngLat[], index: number, candidate: LngLat, tolerance: number): SnapResult {
  const n = points.length;
  if (n < 3) return { point: candidate, greenEdges: [] };
  const pl = plane(points[index]);
  const at = (k: number) => pl.to(points[(k + n) % n]);
  const v = pl.to(candidate);
  const P = at(index - 1);
  const N = at(index + 1);
  const PP = at(index - 2);
  const NN = at(index + 2);
  const edgePrev = (index - 1 + n) % n;
  const edgeNext = index;

  // Lines on which the neighbouring corners become right angles.
  const dirP = perp(sub(P, PP));
  const dirN = perp(sub(NN, N));
  const options: { point: V; dist: number; green: number[] }[] = [];
  if (len(dirP) > 1e-9) {
    const q = projectOnLine(v, P, dirP);
    options.push({ point: q, dist: len(sub(v, q)), green: [edgePrev] });
  }
  if (len(dirN) > 1e-9) {
    const q = projectOnLine(v, N, dirN);
    options.push({ point: q, dist: len(sub(v, q)), green: [edgeNext] });
  }
  const linesInReach = options.filter((o) => o.dist <= tolerance);
  if (linesInReach.length === 2 && len(dirP) > 1e-9 && len(dirN) > 1e-9) {
    const x = intersect(P, dirP, N, dirN);
    if (x && len(sub(x, v)) <= tolerance * 2) return { point: pl.from(x), greenEdges: [edgePrev, edgeNext] };
  }

  // Thales circle: right angle at the vertex itself.
  const mid = mul(add(P, N), 0.5);
  const r = len(sub(N, P)) / 2;
  const fromMid = sub(v, mid);
  if (len(fromMid) > 1e-9 && r > 1e-9) {
    const q = add(mid, mul(fromMid, r / len(fromMid)));
    options.push({ point: q, dist: Math.abs(len(fromMid) - r), green: [edgePrev, edgeNext] });
  }

  const best = options.filter((o) => o.dist <= tolerance).sort((a, b) => a.dist - b.dist)[0];
  return best ? { point: pl.from(best.point), greenEdges: best.green } : { point: candidate, greenEdges: [] };
}

/**
 * Moves wall `edge` parallel to itself so that its middle follows `pointer` along the wall's normal.
 * Each of the two corners slides along its adjacent wall (or its extension beyond the outline).
 */
export function moveEdge(points: LngLat[], edge: number, pointer: LngLat): LngLat[] {
  const n = points.length;
  if (n < 3) return points;
  const ia = edge % n;
  const ib = (edge + 1) % n;
  const pl = plane(points[ia]);
  const A = pl.to(points[ia]);
  const B = pl.to(points[ib]);
  const prevA = pl.to(points[(ia - 1 + n) % n]);
  const nextB = pl.to(points[(ib + 1) % n]);
  const ab = sub(B, A);
  if (len(ab) < 1e-9) return points;
  const normal = mul(perp(ab), 1 / len(ab));
  const d = dot(sub(pl.to(pointer), mul(add(A, B), 0.5)), normal);

  const slide = (corner: V, neighbour: V): V => {
    const along = sub(corner, neighbour);
    const k = dot(along, normal);
    // Adjacent wall parallel to the moved one: fall back to a perpendicular shift.
    return Math.abs(k) < 1e-6 * len(along) ? add(corner, mul(normal, d)) : add(corner, mul(along, d / k));
  };

  const result = [...points];
  result[ia] = pl.from(slide(A, prevA));
  result[ib] = pl.from(slide(B, nextB));
  return result;
}

/** Middle of each edge (positions of the wall drag handles). */
export function edgeMidpoints(points: LngLat[]): LngLat[] {
  return points.map((p, i) => {
    const q = points[(i + 1) % points.length];
    return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2] as LngLat;
  });
}

/** Angle at a vertex in degrees (for tests and diagnostics). */
export function cornerAngle(points: LngLat[], index: number): number {
  const n = points.length;
  const pl = plane(points[index]);
  const a = sub(pl.to(points[(index - 1 + n) % n]), pl.to(points[index]));
  const b = sub(pl.to(points[(index + 1) % n]), pl.to(points[index]));
  return (Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (len(a) * len(b))))) * 180) / Math.PI;
}

/** Average of the outline vertices: the fixed centre of rotation. */
export function contourCenter(points: LngLat[]): LngLat {
  const s = points.reduce<[number, number]>((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0]);
  return [s[0] / points.length, s[1] / points.length];
}

/**
 * Rotates the whole outline around its centre by the angle between the grabbed corner and the pointer,
 * as seen from the centre; the centre stays in place and every vertex turns by the same angle.
 */
export function rotateContour(points: LngLat[], grabbed: number, pointer: LngLat): LngLat[] {
  const center = contourCenter(points);
  const pl = plane(center);
  const from = pl.to(points[grabbed]);
  const to = pl.to(pointer);
  if (len(from) < 1e-9 || len(to) < 1e-9) return points;
  const angle = Math.atan2(to[1], to[0]) - Math.atan2(from[1], from[0]);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return points.map((p) => {
    const [x, y] = pl.to(p);
    return pl.from([x * c - y * s, x * s + y * c]);
  });
}

export interface WallPosition {
  edge: number;
  /** 0…1 along the edge from points[edge] to points[edge + 1]. */
  t: number;
}

/** Where on the outline a point lies: the nearest wall and the fraction along it, if within `maxDist` meters. */
export function wallPosition(points: LngLat[], p: LngLat, maxDist: number): WallPosition | null {
  const pl = plane(p);
  const v: V = [0, 0];
  let best: (WallPosition & { dist: number }) | null = null;
  points.forEach((a, i) => {
    const A = pl.to(a);
    const B = pl.to(points[(i + 1) % points.length]);
    const ab = sub(B, A);
    const l2 = dot(ab, ab);
    const t = l2 > 0 ? Math.max(0, Math.min(1, dot(sub(v, A), ab) / l2)) : 0;
    const dist = len(sub(add(A, mul(ab, t)), v));
    if (!best || dist < best.dist) best = { edge: i, t, dist };
  });
  const found = best as (WallPosition & { dist: number }) | null;
  return found && found.dist <= maxDist ? { edge: found.edge, t: found.t } : null;
}

/** The point at a wall position of an outline (same vertex count as the one it was measured on). */
export function pointAtWall(points: LngLat[], pos: WallPosition): LngLat {
  const a = points[pos.edge % points.length];
  const b = points[(pos.edge + 1) % points.length];
  return [a[0] + (b[0] - a[0]) * pos.t, a[1] + (b[1] - a[1]) * pos.t];
}

/** Moves the whole outline so that its centre lands at `center` (shape and orientation unchanged). */
export function translateContour(points: LngLat[], center: LngLat): LngLat[] {
  const c = contourCenter(points);
  const dx = center[0] - c[0];
  const dy = center[1] - c[1];
  return points.map(([x, y]) => [x + dx, y + dy] as LngLat);
}
