import { describe, expect, it } from 'vitest';
import { cornerAngle, edgeMidpoints, moveEdge, snapVertex } from './contourEdit';
import type { LngLat } from './types';

/** Local meters → lng/lat around (37.6, 55.7). */
const COS = Math.cos((55.7 * Math.PI) / 180);
const m = (x: number, y: number): LngLat => [37.6 + x / (111320 * COS), 55.7 + y / 110540];
const toM = (p: LngLat): [number, number] => [(p[0] - 37.6) * 111320 * COS, (p[1] - 55.7) * 110540];

/** A 10×6 m rectangle rotated by 30°. */
function rotatedRect(): LngLat[] {
  const a = (30 * Math.PI) / 180;
  return [[0, 0], [10, 0], [10, 6], [0, 6]].map(([x, y]) => m(x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)));
}

describe('snapVertex', () => {
  it('snaps back to the exact corner of a rotated rectangle (both neighbours right-angled)', () => {
    const rect = rotatedRect();
    const [x, y] = toM(rect[2]);
    const r = snapVertex(rect, 2, m(x + 0.4, y - 0.3), 1);
    expect(toM(r.point)[0]).toBeCloseTo(x, 3);
    expect(toM(r.point)[1]).toBeCloseTo(y, 3);
    expect(r.greenEdges.sort()).toEqual([1, 2]);
    const fixed = [...rect];
    fixed[2] = r.point;
    expect(cornerAngle(fixed, 1)).toBeCloseTo(90, 3);
    expect(cornerAngle(fixed, 3)).toBeCloseTo(90, 3);
  });

  it('holds the vertex on one right-angle line and releases it beyond the tolerance', () => {
    // Quadrilateral whose next neighbour cannot give a right angle near the cursor.
    const pts = [m(0, 0), m(10, 0), m(12, 7), m(0, 6)];
    const near = snapVertex(pts, 2, m(10.5, 8), 1); // close to x = 10 (right angle at corner 1), far from y = 6
    expect(near.greenEdges).toEqual([1]);
    expect(toM(near.point)[0]).toBeCloseTo(10, 3);
    const fixed = [...pts];
    fixed[2] = near.point;
    expect(cornerAngle(fixed, 1)).toBeCloseTo(90, 3);

    const far = snapVertex(pts, 2, m(13, 8), 1);
    expect(far.greenEdges).toEqual([]);
    expect(toM(far.point)[0]).toBeCloseTo(13, 6);
  });

  it('snaps to a right angle at the vertex itself (Thales circle)', () => {
    // Neighbours at (0,0) and (10,0); PP/NN chosen so that their own right-angle lines are far away.
    const pts = [m(0, 0), m(5, 4.8), m(10, 0), m(5, -9)];
    const r = snapVertex(pts, 1, m(5, 5.3), 0.6);
    expect(r.greenEdges.sort()).toEqual([0, 1]);
    const fixed = [...pts];
    fixed[1] = r.point;
    expect(cornerAngle(fixed, 1)).toBeCloseTo(90, 3);
  });
});

describe('moveEdge', () => {
  it('moves a wall of a rotated rectangle outwards keeping it a rectangle', () => {
    const rect = rotatedRect();
    const mid = toM(edgeMidpoints(rect)[1]);
    const a = (30 * Math.PI) / 180;
    // Normal of wall 1 (from corner 1 to corner 2) pointing out of the rectangle: rotated +x.
    const out: [number, number] = [Math.cos(a), Math.sin(a)];
    const moved = moveEdge(rect, 1, m(mid[0] + out[0] * 2, mid[1] + out[1] * 2));
    for (let i = 0; i < 4; i++) expect(cornerAngle(moved, i)).toBeCloseTo(90, 3);
    const width = Math.hypot(...(toM(moved[1]).map((v, k) => v - toM(moved[0])[k]) as [number, number]));
    expect(Math.abs(width - 12) < 1e-3 || Math.abs(width - 8) < 1e-3).toBe(true);
    // Opposite wall untouched.
    expect(moved[0]).toEqual(rect[0]);
    expect(moved[3]).toEqual(rect[3]);
  });

  it('slides the corners along the adjacent walls of a trapezoid', () => {
    const pts = [m(0, 0), m(10, 0), m(8, 6), m(2, 6)];
    const moved = moveEdge(pts, 2, m(5, 4)); // top wall moves down by 2 m
    expect(toM(moved[2])[1]).toBeCloseTo(4, 3);
    expect(toM(moved[3])[1]).toBeCloseTo(4, 3);
    // Still on the original side walls (slopes 3 m over 1 m).
    expect(toM(moved[2])[0]).toBeCloseTo(10 - (2 / 6) * 4, 3);
    expect(toM(moved[3])[0]).toBeCloseTo((2 / 6) * 4, 3);
  });
});
