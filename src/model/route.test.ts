import { describe, expect, it } from 'vitest';
import { createLine, createNode, emptyScheme, routeLines } from './scheme';
import type { KtpNode, Scheme, SchemeNode } from './types';
import { traceScheme, wireKey } from '../topology/trace';

function node(s: Scheme, kind: SchemeNode['kind'], x: number, y = 0) {
  const n = createNode(kind, [37.6 + x * 0.001, 55 + y * 0.001]);
  s.nodes[n.id] = n;
  return n;
}

describe('routeLines', () => {
  it('follows the route through poles, keeps suspension types and feeders apart', () => {
    const s = emptyScheme();
    const ktp = node(s, 'ktp', 0) as KtpNode;
    ktp.feeders.push({ id: 'f2', name: 'F2', outputs: (['A', 'B', 'C', 'N'] as const).map((role, i) => ({ id: `o${i}`, index: i + 1, role })) });
    const [p1, p2, p3, p4, p5] = [1, 2, 3, 2, 4].map((x, i) => node(s, 'pole04', x, i === 3 ? 1 : 0));
    const a = createLine(s, 'line04', ktp.id, p1.id, 'bare');
    const b = createLine(s, 'line04', p1.id, p2.id, 'bare');
    const c = createLine(s, 'line04', p2.id, p3.id, 'bare');
    const branch = createLine(s, 'line04', p2.id, p4.id, 'bare');
    const sip = createLine(s, 'line04', p3.id, p5.id, 'sip');
    // A second feeder from the same substation towards the west.
    const west = node(s, 'pole04', -1);
    const other = createLine(s, 'line04', ktp.id, west.id, 'bare');

    const trace = traceScheme(s);
    const feedersOf = (l: { id: string; wires: { id: string }[] }) => [
      ...new Set(l.wires.flatMap((w) => trace.wires.get(wireKey(l.id, w.id))?.feeders ?? [])),
    ];
    const route = routeLines(s, b.id, feedersOf).sort();
    expect(route).toEqual([a.id, b.id, c.id, branch.id].sort());
    expect(route).not.toContain(sip.id);
    expect(route).not.toContain(other.id);
    expect(routeLines(s, sip.id, feedersOf)).toEqual([sip.id]);
  });
});
