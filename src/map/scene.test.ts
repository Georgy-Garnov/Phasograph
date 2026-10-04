import { describe, expect, it } from 'vitest';
import { createLine, createNode, emptyScheme } from '../model/scheme';
import { traceScheme, wireKey } from '../topology/trace';
import { ROLE_COLORS } from '../model/constants';
import type { AppState } from '../model/store';
import { buildPreview, buildScene } from './scene';

function state() {
  const scheme = emptyScheme();
  const ktp = createNode('ktp', [37.6, 55.7]);
  const pole = createNode('pole04', [37.601, 55.7]);
  scheme.nodes[ktp.id] = ktp;
  scheme.nodes[pole.id] = pole;
  const line = createLine(scheme, 'line04', ktp.id, pole.id, 'bare');
  const s = {
    scheme,
    trace: traceScheme(scheme),
    tool: { type: 'select' },
    selection: null,
    lineStart: ktp.id,
    contour: [],
    focusKey: null,
  } as unknown as AppState;
  return { s, line, ktp };
}

describe('buildScene', () => {
  it('draws each wire in its own color at high zoom', () => {
    const { s, line } = state();
    const scene = buildScene(s, new Set(), 18);
    const wires = line.wires.map((w) => scene.features.get(`wire:${wireKey(line.id, w.id)}`)!);
    expect(wires.map((w) => w.stroke.color)).toEqual(['A', 'B', 'C', 'N', 'L'].map((r) => ROLE_COLORS[r as 'A']));
    // Wires are offset in parallel, so all have different coordinates.
    expect(new Set(wires.map((w) => JSON.stringify(w.geometry.coordinates))).size).toBe(5);
    expect(scene.markers).toHaveLength(2);
  });

  it('separate wires are parallel at any zoom, ABC is a single line', () => {
    const { s, line } = state();
    expect([...buildScene(s, new Set(), 14).features.keys()].filter((k) => k.startsWith('wire:'))).toHaveLength(5);
    (line as { suspension: string }).suspension = 'sip';
    const sip = buildScene(s, new Set(), 18);
    expect(sip.features.has(`line:${line.id}`)).toBe(true);
    expect([...sip.features.keys()].some((k) => k.startsWith('wire:'))).toBe(false);
  });

  it('dims other wires when highlighting', () => {
    const { s, line } = state();
    const lit = wireKey(line.id, line.wires[0].id);
    const scene = buildScene(s, new Set([lit]), 18);
    expect(scene.features.get(`wire:${lit}`)!.stroke.opacity).toBe(1);
    expect(scene.features.get(`wire:${wireKey(line.id, line.wires[1].id)}`)!.stroke.opacity).toBe(0.3);
  });

  it('rubber-band line from the start node to the cursor', () => {
    const { s, ktp } = state();
    const preview = buildPreview(s, [37.602, 55.7]);
    expect(preview.get('preview:line')!.geometry.coordinates[0]).toEqual(ktp.coords);
  });
});
