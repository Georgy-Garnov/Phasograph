import { describe, expect, it } from 'vitest';
import { bearing, createLine, createNode, destination, emptyScheme, poleAzimuth } from './scheme';
import type { PoleNode } from './types';
import { exportGeoJSON, importGeoJSON } from './geojson';

describe('pole orientation', () => {
  it('bearing and destination are consistent', () => {
    const a: [number, number] = [37.6, 55.7];
    expect(bearing(a, destination(a, 90, 50))).toBe(90);
    expect(bearing(a, destination(a, 0, 50))).toBe(0);
    expect(bearing(a, destination(a, 225, 50))).toBe(225);
  });

  it('automatic azimuth follows the incoming span; manual azimuth wins', () => {
    const s = emptyScheme();
    const ktp = createNode('ktp', [37.6, 55.7]);
    const p1 = createNode('pole04', [37.6008, 55.7]) as PoleNode; // east of the substation
    const p2 = createNode('pole04', [37.6008, 55.7005]) as PoleNode; // then north
    for (const n of [ktp, p1, p2]) s.nodes[n.id] = n;
    createLine(s, 'line04', ktp.id, p1.id, 'bare');
    createLine(s, 'line04', p1.id, p2.id, 'bare');
    expect(poleAzimuth(s, p1)).toBe(90);
    expect(poleAzimuth(s, p2)).toBe(0);
    p2.azimuth = 135;
    expect(poleAzimuth(s, p2)).toBe(135);
  });

  it('azimuth and fiber box survive GeoJSON round trip', () => {
    const s = emptyScheme();
    const p = createNode('pole04', [37.6, 55.7]) as PoleNode;
    p.azimuth = 270;
    p.fiberBox = true;
    p.hasInternet = true;
    s.nodes[p.id] = p;
    const back = importGeoJSON(JSON.parse(JSON.stringify(exportGeoJSON(s)))).scheme.nodes[p.id] as PoleNode;
    expect([back.azimuth, back.fiberBox, back.hasInternet]).toEqual([270, true, true]);
  });
});
