import { describe, expect, it } from 'vitest';
import { contourCenter, cornerAngle, edgeMidpoints, moveEdge, rotateContour, snapVertex } from './contourEdit';
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

describe('rotateContour', () => {
  it('turns every corner around the fixed centre by the same angle and keeps the shape', () => {
    const rect = rotatedRect();
    const center = toM(contourCenter(rect));
    const grabbed = toM(rect[2]);
    // Pointer at the grabbed corner rotated by +40° around the centre.
    const a = (40 * Math.PI) / 180;
    const rel = [grabbed[0] - center[0], grabbed[1] - center[1]];
    const pointer = m(center[0] + rel[0] * Math.cos(a) - rel[1] * Math.sin(a), center[1] + rel[0] * Math.sin(a) + rel[1] * Math.cos(a));
    const turned = rotateContour(rect, 2, pointer);
    const c2 = toM(contourCenter(turned));
    expect(c2[0]).toBeCloseTo(center[0], 4);
    expect(c2[1]).toBeCloseTo(center[1], 4);
    for (let i = 0; i < 4; i++) {
      expect(cornerAngle(turned, i)).toBeCloseTo(90, 3);
      const before = toM(rect[i]);
      const after = toM(turned[i]);
      const ang = Math.atan2(after[1] - center[1], after[0] - center[0]) - Math.atan2(before[1] - center[1], before[0] - center[0]);
      expect(((ang * 180) / Math.PI + 360) % 360).toBeCloseTo(40, 3);
    }
    expect(toM(turned[2])[0]).toBeCloseTo(toM(pointer)[0], 3);
  });
});

describe('entries follow outline edits', () => {
  it('an entry on a wall keeps its wall and fraction after rotation and wall moves; others stay', async () => {
    const { applyHouseContour, createNode, emptyScheme } = await import('./scheme');
    const s = emptyScheme();
    const house = createNode('house', m(0, 0));
    const rect = rotatedRect();
    if (house.kind === 'house') house.contour = rect;
    s.nodes[house.id] = house;
    const onWall = createNode('entry', [rect[1][0] + (rect[2][0] - rect[1][0]) * 0.4, rect[1][1] + (rect[2][1] - rect[1][1]) * 0.4]);
    const far = createNode('entry', m(40, 40));
    for (const e of [onWall, far]) {
      if (e.kind === 'entry') e.houseId = house.id;
      s.nodes[e.id] = e;
    }

    const rotated = rotateContour(rect, 2, m(-3, 12));
    applyHouseContour(s, house.id, rotated);
    const expected = [rotated[1][0] + (rotated[2][0] - rotated[1][0]) * 0.4, rotated[1][1] + (rotated[2][1] - rotated[1][1]) * 0.4];
    expect(s.nodes[onWall.id].coords[0]).toBeCloseTo(expected[0], 9);
    expect(s.nodes[onWall.id].coords[1]).toBeCloseTo(expected[1], 9);
    expect(s.nodes[far.id].coords).toEqual(m(40, 40));

    // Move the entry's wall (edge 1) outwards: the entry rides along on the moved wall.
    const mid = edgeMidpoints(rotated)[1];
    const moved = moveEdge(rotated, 1, [mid[0] + 0.00003, mid[1]]);
    applyHouseContour(s, house.id, moved);
    const onMoved = [moved[1][0] + (moved[2][0] - moved[1][0]) * 0.4, moved[1][1] + (moved[2][1] - moved[1][1]) * 0.4];
    expect(s.nodes[onWall.id].coords[0]).toBeCloseTo(onMoved[0], 9);
    expect(s.nodes[onWall.id].coords[1]).toBeCloseTo(onMoved[1], 9);
  });
});
