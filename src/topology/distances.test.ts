import { describe, expect, it } from 'vitest';
import { createLine, createNode, distanceMeters, emptyScheme } from '../model/scheme';
import type { LngLat, SchemeNode } from '../model/types';
import { traceScheme } from './trace';
import { distancesToKtp, feederLengths, lineLength } from './distances';

function node(s: ReturnType<typeof emptyScheme>, kind: SchemeNode['kind'], coords: LngLat) {
  const n = createNode(kind, coords);
  s.nodes[n.id] = n;
  return n;
}

describe('distances', () => {
  const s = emptyScheme();
  const ktp = node(s, 'ktp', [37.6, 55.7]);
  const p1 = node(s, 'pole04', [37.601, 55.7]);
  const p2 = node(s, 'pole04', [37.601, 55.7004]); // line turn
  const house = node(s, 'house', [37.6013, 55.7006]);
  const entry = node(s, 'entry', [37.6012, 55.7005]);
  if (entry.kind === 'entry') entry.houseId = house.id;
  const far = node(s, 'pole04', [37.7, 55.7]); // not connected to the network
  const span1 = createLine(s, 'line04', ktp.id, p1.id, 'bare');
  const span2 = createLine(s, 'line04', p1.id, p2.id, 'bare');
  const drop = createLine(s, 'drop', p2.id, entry.id, 'bare');
  createLine(s, 'fiber', ktp.id, far.id, 'bare'); // fiber does not count as a path to the substation

  it('span length is the distance between poles', () => {
    expect(lineLength(s, span1)).toBeCloseTo(distanceMeters(ktp.coords, p1.coords));
    expect(lineLength(s, span1)).toBeGreaterThan(60);
  });

  it('distance to the substation follows the wires, not a straight line', () => {
    const d = distancesToKtp(s);
    const viaLines = lineLength(s, span1) + lineLength(s, span2);
    expect(d.get(p2.id)!.meters).toBeCloseTo(viaLines);
    expect(d.get(p2.id)!.meters).toBeGreaterThan(distanceMeters(ktp.coords, p2.coords));
    expect(d.get(house.id)!.meters).toBeCloseTo(viaLines + lineLength(s, drop));
    expect(d.get(house.id)!.ktpId).toBe(ktp.id);
    expect(d.has(far.id)).toBe(false);
  });

  it('feeder length: main line and service drops', () => {
    const drop0 = s.lines[drop.id];
    drop0.wires[0].fromPort = p2.kind === 'pole04' ? p2.insulators[0].id : null;
    const len = feederLengths(s, traceScheme(s)).get((ktp as { feeders: { id: string }[] }).feeders[0].id)!;
    expect(len.main).toBeCloseTo(lineLength(s, span1) + lineLength(s, span2));
    expect(len.drops).toBeCloseTo(lineLength(s, drop));
  });
});
