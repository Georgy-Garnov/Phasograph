import { describe, expect, it } from 'vitest';
import { createLine, createNode, emptyScheme } from './scheme';
import { exportGeoJSON, importGeoJSON } from './geojson';
import { traceScheme } from '../topology/trace';
import type { HouseNode } from './types';

describe('GeoJSON', () => {
  it('export → import preserves the scheme and links', () => {
    const s = emptyScheme();
    const ktp = createNode('ktp', [37.6, 55.7]);
    const pole = createNode('pole04', [37.601, 55.7]);
    const house = createNode('house', [37.602, 55.7]) as HouseNode;
    house.contour = [
      [37.6019, 55.6999],
      [37.6021, 55.6999],
      [37.6021, 55.7001],
    ];
    house.meterNumber = '12345';
    for (const n of [ktp, pole, house]) s.nodes[n.id] = n;
    createLine(s, 'line04', ktp.id, pole.id, 'bare');
    createLine(s, 'drop', pole.id, house.id, 'bare');

    const json = JSON.parse(JSON.stringify(exportGeoJSON(s, traceScheme(s))));
    expect(json.features.find((f: { id: string }) => f.id === house.id).geometry.type).toBe('Polygon');
    const { scheme, warnings } = importGeoJSON(json);
    expect(warnings).toEqual([]);
    expect(scheme).toEqual(s);
  });

  it('old "Lighting" checkbox becomes a luminaire', () => {
    const { scheme } = importGeoJSON({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', id: 'p', geometry: { type: 'Point', coordinates: [37, 55] }, properties: { kind: 'pole04', hasLighting: true } },
      ],
    });
    const pole = scheme.nodes.p as { lamps: unknown[]; hasLighting?: boolean };
    expect(pole.lamps).toHaveLength(1);
    expect(pole.hasLighting).toBeUndefined();
  });

  it('attaches lines without from/to to the nearest nodes', () => {
    const { scheme } = importGeoJSON({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', id: 'a', geometry: { type: 'Point', coordinates: [37, 55] }, properties: { kind: 'pole04' } },
        { type: 'Feature', id: 'b', geometry: { type: 'Point', coordinates: [37.001, 55] }, properties: { kind: 'pole04' } },
        {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [[37, 55], [37.001, 55]] },
          properties: { kind: 'line04' },
        },
      ],
    });
    const line = Object.values(scheme.lines)[0];
    expect([line.from, line.to]).toEqual(['a', 'b']);
  });
});
