import { describe, expect, it } from 'vitest';
import { createLine, createNode, emptyScheme, setPerPhaseLoads, setPhaseLoad } from '../model/scheme';
import { exportGeoJSON, importGeoJSON } from '../model/geojson';
import type { HouseNode, KtpNode, PoleNode, Role, Scheme } from '../model/types';
import { portKey, traceScheme } from './trace';
import { COS_PHI, computeVoltages } from './voltage';
import { LV_NOMINAL_PHASE, noLoadPhaseVoltage, transformerImpedance, transformerData } from '../model/transformers';

const SIN_PHI = Math.sqrt(1 - COS_PHI ** 2);

/** Point `m` meters east of the origin (latitude 55°). */
const east = (m: number): [number, number] => [37.6 + m / (111320 * Math.cos((55 * Math.PI) / 180)), 55];

function grid(polesAt: number[]) {
  const s: Scheme = emptyScheme();
  const ktp = createNode('ktp', east(0)) as KtpNode;
  s.nodes[ktp.id] = ktp;
  let prev: string = ktp.id;
  const poles = polesAt.map((m) => {
    const p = createNode('pole04', east(m)) as PoleNode;
    s.nodes[p.id] = p;
    createLine(s, 'line04', prev, p.id, 'bare'); // default conductor A-35
    prev = p.id;
    return p;
  });
  return { s, ktp, poles };
}

/** House 20 m north of the pole with a SIP-4 drop (default) on the given phase. */
function house(s: Scheme, pole: PoleNode, phase: Role | '3', kw: number): HouseNode {
  const h = createNode('house', [pole.coords[0], pole.coords[1] + 20 / 110540]) as HouseNode;
  h.phaseMode = phase === '3' ? '3' : '1';
  h.currentPowerKw = String(kw);
  h.designPowerKw = String(kw * 2);
  s.nodes[h.id] = h;
  const drop = createLine(s, 'drop', pole.id, h.id, 'bare');
  const t = traceScheme(s);
  const ins = (r: Role) => pole.insulators.find((i) => t.ports.get(portKey(pole.id, i.id))?.roles[0] === r)!.id;
  const roles: Role[] = phase === '3' ? ['A', 'B', 'C', 'N'] : [phase, 'N'];
  drop.wires.forEach((w, i) => (w.fromPort = ins(roles[i])));
  return h;
}

describe('voltage drop', () => {
  it('single-phase load matches the hand formula (phase + neutral)', () => {
    const { s, poles } = grid([50]);
    const h = house(s, poles[0], 'A', 5);
    const v = computeVoltages(s, traceScheme(s), 'current').houses.get(h.id)!;
    const amps = 5000 / (230 * COS_PHI);
    const drop = (km: number, r: number, x: number) => amps * 2 * km * (r * COS_PHI + x * SIN_PHI);
    // No transformer rating → ideal source at the no-load voltage 400/√3.
    const expected = LV_NOMINAL_PHASE - drop(0.05, 0.83, 0.31) - drop(0.02, 1.91, 0.09); // A-35 span + SIP-4 2x16 drop
    expect(v.voltage).toBeCloseTo(expected, 1);
    expect(v.ok).toBe(true);
    expect(v.phases.map((p) => p.phase)).toEqual(['A']);
  });

  it('balanced three-phase load has no neutral current, so the drop is smaller', () => {
    const one = grid([50]);
    const single = house(one.s, one.poles[0], 'A', 5);
    const three = grid([50]);
    const balanced = house(three.s, three.poles[0], '3', 15); // 5 kW per phase
    const v1 = computeVoltages(one.s, traceScheme(one.s), 'current').houses.get(single.id)!;
    const v3 = computeVoltages(three.s, traceScheme(three.s), 'current').houses.get(balanced.id)!;
    expect(LV_NOMINAL_PHASE - v3.voltage).toBeLessThan((LV_NOMINAL_PHASE - v1.voltage) * 0.6);
  });

  it('a downstream house sees the drop caused by upstream loads; design mode uses design power', () => {
    const { s, poles } = grid([40, 80]);
    const near = house(s, poles[0], 'A', 3);
    const far = house(s, poles[1], 'A', 3);
    const t = traceScheme(s);
    const cur = computeVoltages(s, t, 'current').houses;
    expect(cur.get(far.id)!.voltage).toBeLessThan(cur.get(near.id)!.voltage);
    const design = computeVoltages(s, t, 'design').houses;
    expect(design.get(far.id)!.voltage).toBeLessThan(cur.get(far.id)!.voltage);
    expect(design.get(far.id)!.loadKw).toBe(6);
  });

  it('an unbalanced load shifts the neutral and changes the other phases', () => {
    const { s, poles } = grid([60]);
    house(s, poles[0], 'A', 10);
    const onB = house(s, poles[0], 'B', 0);
    const v = computeVoltages(s, traceScheme(s), 'current').houses.get(onB.id)!;
    expect(Math.abs(v.voltage - LV_NOMINAL_PHASE)).toBeGreaterThan(1);
  });
});

describe('three-phase house with per-phase loads', () => {
  it('splits the total equally, keeps the total equal to the sum, and loads each phase separately', () => {
    const { s, ktp, poles } = grid([60]);
    const h = house(s, poles[0], '3', 12);
    setPerPhaseLoads(h, true);
    expect(h.phaseLoads!.current).toEqual({ A: '4', B: '4', C: '4' });
    setPhaseLoad(h, 'current', 'A', '9');
    setPhaseLoad(h, 'current', 'C', '0,5');
    expect(h.currentPowerKw).toBe('13.5');

    const r = computeVoltages(s, traceScheme(s), 'current');
    const v = r.houses.get(h.id)!;
    expect(v.phases.map((p) => p.loadKw)).toEqual([9, 4, 0.5]);
    expect(v.loadKw).toBe(13.5);
    const [a, b, c] = v.phases.map((p) => p.voltage);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
    expect(r.ktps.get(ktp.id)!.currents.A).toBeCloseTo(9000 / (230 * COS_PHI), 6);

    // Back to one total: split equally again.
    setPerPhaseLoads(h, false);
    const even = computeVoltages(s, traceScheme(s), 'current').houses.get(h.id)!;
    expect(even.phases.map((p) => p.loadKw)).toEqual([4.5, 4.5, 4.5]);
  });

  it('per-phase loads survive GeoJSON export and import', () => {
    const { s, poles } = grid([30]);
    const h = house(s, poles[0], '3', 6);
    setPerPhaseLoads(h, true);
    setPhaseLoad(h, 'design', 'B', '7');
    const back = importGeoJSON(JSON.parse(JSON.stringify(exportGeoJSON(s)))).scheme.nodes[h.id] as HouseNode;
    expect(back.phaseLoads).toEqual(h.phaseLoads);
  });
});

describe('transformer', () => {
  it('no-load voltage follows the HV supply and the tap position', () => {
    const ktp = { hvKv: 6 as const, hvActualV: '5500', tapPct: -5 };
    expect(noLoadPhaseVoltage(ktp)).toBeCloseTo((LV_NOMINAL_PHASE * 5500) / 6000 / 0.95, 6);
    expect(noLoadPhaseVoltage({ hvKv: 10, hvActualV: '', tapPct: 0 })).toBeCloseTo(230.94, 2);
    expect(noLoadPhaseVoltage({ hvKv: 10, hvActualV: '', tapPct: 5 })).toBeLessThan(LV_NOMINAL_PHASE);
  });

  it('busbar voltage drops on the transformer impedance; loading and HV current are reported', () => {
    const { s, ktp, poles } = grid([50]);
    ktp.powerKva = '25'; // small transformer → visible internal drop
    house(s, poles[0], '3', 15);
    const r = computeVoltages(s, traceScheme(s), 'current');
    const k = r.ktps.get(ktp.id)!;
    const amps = 5000 / (230 * COS_PHI);
    const [rt, xt] = transformerImpedance(transformerData(ktp)!);
    const expectedBus = LV_NOMINAL_PHASE - amps * (rt * COS_PHI + xt * SIN_PHI);
    expect(k.voltages.A).toBeCloseTo(expectedBus, 0);
    expect(k.currents.B).toBeCloseTo(amps, 6);
    expect(k.loadingPct!).toBeCloseTo((k.apparentVa / 25000) * 100, 6);
    expect(k.hvCurrent).toBeCloseTo(k.apparentVa / (Math.sqrt(3) * 10000), 6);
  });
});
