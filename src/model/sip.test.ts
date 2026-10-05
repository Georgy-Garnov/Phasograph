import { describe, expect, it } from 'vitest';
import { addInsulator, createLine, createNode, emptyScheme } from './scheme';
import { corePort, coreWithMarking, polePorts, setPortMark } from './sip';
import { setClampCores, setInsulatorKind, upgradeLegacySip } from './sipOps';
import { exportGeoJSON, importGeoJSON } from './geojson';
import type { HouseNode, KtpNode, PoleNode, Scheme, SchemeNode } from './types';
import { portKey, traceScheme } from '../topology/trace';

function add<T extends SchemeNode>(scheme: Scheme, node: SchemeNode, x: number): T {
  node.coords = [37 + x * 0.0003, 55];
  scheme.nodes[node.id] = node;
  return node as T;
}

const roleAt = (s: Scheme, pole: PoleNode, port: string | null) => traceScheme(s).ports.get(portKey(pole.id, port ?? ''))?.roles;
const clampOf = (pole: PoleNode) => pole.insulators.find((i) => i.type === 'sipClamp')!;
const core = (pole: PoleNode, m: '1' | '2' | '3' | '0' | '4') => coreWithMarking(clampOf(pole), m);

/** Substation → p1 → p2 laid as an ABC cable. */
function sipScheme() {
  const s = emptyScheme();
  const ktp = add<KtpNode>(s, createNode('ktp', [0, 0]), 0);
  const p1 = add<PoleNode>(s, createNode('pole04', [0, 0]), 1);
  const p2 = add<PoleNode>(s, createNode('pole04', [0, 0]), 2);
  createLine(s, 'line04', ktp.id, p1.id, 'sip');
  const span = createLine(s, 'line04', p1.id, p2.id, 'sip');
  return { s, ktp, p1, p2, span };
}

describe('ABC cable cores', () => {
  it('a cable from the substation gets one clamp per pole and every core keeps its phase', () => {
    const { s, p1, p2, span } = sipScheme();
    expect(p1.insulators).toHaveLength(1);
    expect(clampOf(p1).cores).toBe('3+N+L');
    expect(span.wires).toHaveLength(5);
    expect(roleAt(s, p2, core(p2, '1'))).toEqual(['A']);
    expect(roleAt(s, p2, core(p2, '3'))).toEqual(['C']);
    expect(roleAt(s, p2, core(p2, '0'))).toEqual(['N']);
    expect(roleAt(s, p2, core(p2, '4'))).toEqual(['L']);
  });

  it('a service drop attaches to specific cores and the house gets a definite phase', () => {
    const { s, p2 } = sipScheme();
    const house = add<HouseNode>(s, createNode('house', [0, 0]), 3);
    const drop = createLine(s, 'drop', p2.id, house.id, 'bare');
    // Neutral core is picked automatically, the phase core is left to the operator.
    expect(drop.wires.map((w) => w.fromPort)).toEqual([null, core(p2, '0')]);
    drop.wires[0].fromPort = core(p2, '2');
    const h = traceScheme(s).houses.get(house.id)!;
    expect(h.status).toBe('ok');
    expect(h.computedPhases).toEqual(['B']);
  });

  it('a single-phase cable gives the drop its phase core automatically', () => {
    const s = emptyScheme();
    const ktp = add<KtpNode>(s, createNode('ktp', [0, 0]), 0);
    ktp.feeders[0].outputs = ktp.feeders[0].outputs.filter((o) => o.role === 'B' || o.role === 'N');
    const p1 = add<PoleNode>(s, createNode('pole04', [0, 0]), 1);
    createLine(s, 'line04', ktp.id, p1.id, 'sip');
    expect(clampOf(p1).cores).toBe('1+N');
    const house = add<HouseNode>(s, createNode('house', [0, 0]), 2);
    createLine(s, 'drop', p1.id, house.id, 'bare');
    expect(traceScheme(s).houses.get(house.id)!.computedPhases).toEqual(['B']);
  });

  it('switching from bare wires to ABC on a pole adds jumpers from the insulators to the cores', () => {
    const s = emptyScheme();
    const ktp = add<KtpNode>(s, createNode('ktp', [0, 0]), 0);
    const p1 = add<PoleNode>(s, createNode('pole04', [0, 0]), 1);
    const p2 = add<PoleNode>(s, createNode('pole04', [0, 0]), 2);
    createLine(s, 'line04', ktp.id, p1.id, 'bare');
    const t = traceScheme(s);
    createLine(s, 'line04', p1.id, p2.id, 'sip', (node, port) => t.ports.get(portKey(node, port))?.roles[0] ?? null);
    expect(p1.jumpers).toHaveLength(5);
    expect(roleAt(s, p2, core(p2, '2'))).toEqual(['B']);
    expect(roleAt(s, p2, core(p2, '4'))).toEqual(['L']);
  });

  it('a jumper from an insulator to a core carries the phase into the cable', () => {
    const { s, p2 } = sipScheme();
    const pin = addInsulator(p2, 'L');
    p2.jumpers.push({ id: 'j', a: pin.id, b: core(p2, '3')! });
    expect(roleAt(s, p2, pin.id)).toEqual(['C']);
  });

  it('changing the core set applies to the whole cable run and keeps cores with the same marking', () => {
    const { s, p1, p2, span } = sipScheme();
    p2.lamps.push({ id: 'l', kind: 'led', powerW: '', phasePort: core(p2, '4'), neutralPort: core(p2, '0') });
    expect(setClampCores(s, p2.id, clampOf(p2).id, '3+N')).toBe(2);
    expect(clampOf(p1).cores).toBe('3+N');
    expect(span.wires).toHaveLength(4);
    expect(p2.lamps[0]).toMatchObject({ phasePort: null, neutralPort: core(p2, '0') });
    expect(roleAt(s, p2, core(p2, '0'))).toEqual(['N']);
    // And back: the lighting core is fed again from the substation output.
    setClampCores(s, p2.id, clampOf(p2).id, '3+N+L');
    expect(span.wires).toHaveLength(5);
    expect(roleAt(s, p2, core(p2, '4'))).toEqual(['L']);
  });

  it('turns a pin insulator into a clamp and back', () => {
    const s = emptyScheme();
    const ktp = add<KtpNode>(s, createNode('ktp', [0, 0]), 0);
    const p1 = add<PoleNode>(s, createNode('pole04', [0, 0]), 1);
    const line = createLine(s, 'line04', ktp.id, p1.id, 'bare');
    const first = p1.insulators[0].id;
    // All five wires onto one insulator turned into a cable clamp.
    for (const w of line.wires) w.toPort = first;
    p1.insulators = [p1.insulators[0]];
    setInsulatorKind(s, p1, first, '3+N+L');
    expect(line.wires.map((w) => w.toPort)).toEqual([0, 1, 2, 3, 4].map((k) => corePort(first, k)));
    expect(roleAt(s, p1, corePort(first, 3))).toEqual(['N']);
    setInsulatorKind(s, p1, first, 'pin');
    expect(line.wires.filter((w) => w.toPort === first)).toHaveLength(1);
  });

  it('upgrades legacy bundle clamps: wires are spread over the cores, the bundle span is expanded', () => {
    const s = emptyScheme();
    const ktp = add<KtpNode>(s, createNode('ktp', [0, 0]), 0);
    const p1 = add<PoleNode>(s, createNode('pole04', [0, 0]), 1);
    const p2 = add<PoleNode>(s, createNode('pole04', [0, 0]), 2);
    const house = add<HouseNode>(s, createNode('house', [0, 0]), 3);
    p1.insulators = [{ id: 'c1', side: 'R', position: 1, type: 'sipClamp' }];
    p2.insulators = [{ id: 'c2', side: 'R', position: 1, type: 'sipClamp' }];
    p2.lamps = [{ id: 'l', kind: 'led', powerW: '', phasePort: 'c2', neutralPort: 'c2' }];
    const outs = ktp.feeders[0].outputs;
    s.lines.a = { id: 'a', kind: 'line04', from: ktp.id, to: p1.id, suspension: 'sip', mark: '', conductor: null, note: '',
      wires: outs.map((o, k) => ({ id: `w${k}`, fromPort: o.id, toPort: 'c1' })) };
    s.lines.b = { id: 'b', kind: 'line04', from: p1.id, to: p2.id, suspension: 'sip', mark: '', conductor: null, note: '',
      wires: [{ id: 'w', fromPort: 'c1', toPort: 'c2' }] };
    s.lines.d = { id: 'd', kind: 'drop', from: p2.id, to: house.id, suspension: 'bare', mark: '', conductor: null, note: '',
      wires: [{ id: 'p', fromPort: 'c2', toPort: null }, { id: 'n', fromPort: 'c2', toPort: null }] };
    upgradeLegacySip(s);
    expect(clampOf(p2).cores).toBe('3+N+L');
    expect(s.lines.b.wires).toHaveLength(5);
    expect(roleAt(s, p2, core(p2, '2'))).toEqual(['B']);
    expect(s.lines.d.wires.map((w) => w.fromPort)).toEqual([null, core(p2, '0')]);
    expect(p2.lamps[0]).toMatchObject({ phasePort: core(p2, '4'), neutralPort: core(p2, '0') });
  });

  it('keeps core sets and core marks through GeoJSON, and a core mark is traced', () => {
    const { s, p2 } = sipScheme();
    const ins = addInsulator(p2, 'R', 'sipClamp');
    ins.cores = '1+N';
    setPortMark(p2, corePort(ins.id, 0), 'B');
    const back = importGeoJSON(JSON.parse(JSON.stringify(exportGeoJSON(s)))).scheme;
    const p = back.nodes[p2.id] as PoleNode;
    expect(polePorts(p)).toHaveLength(7);
    expect(p.insulators[1]).toMatchObject({ cores: '1+N', coreMarks: ['B', null] });
    expect(traceScheme(back).ports.get(portKey(p2.id, corePort(ins.id, 0)))?.roles).toEqual(['B']);
  });
});
