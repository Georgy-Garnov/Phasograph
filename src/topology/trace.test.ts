import { describe, expect, it } from 'vitest';
import {
  addInsulator,
  addLamp,
  removeInsulator,
  createLine,
  createNode,
  emptyScheme,
  insulatorLabel,
  isZigzag,
  layoutZigzag,
  mapWiresByPosition,
  sortInsulators,
} from '../model/scheme';
import type { HouseNode, KtpNode, PoleNode, Scheme, SchemeNode } from '../model/types';
import { highlightWires, portKey, traceScheme, wireKey } from './trace';

function add<T extends SchemeNode>(scheme: Scheme, node: SchemeNode, x: number): T {
  node.coords = [37 + x * 0.0003, 55];
  scheme.nodes[node.id] = node;
  return node as T;
}

/** Substation → pole1 → pole2 (bare wire, 5 wires: A B C N L). */
function baseScheme() {
  const s = emptyScheme();
  const ktp = add<KtpNode>(s, createNode('ktp', [0, 0]), 0);
  const p1 = add<PoleNode>(s, createNode('pole04', [0, 0]), 1);
  const p2 = add<PoleNode>(s, createNode('pole04', [0, 0]), 2);
  createLine(s, 'line04', ktp.id, p1.id, 'bare');
  createLine(s, 'line04', p1.id, p2.id, 'bare');
  return { s, ktp, p1, p2 };
}

/** Pole insulator on which the role was traced. */
function insulatorWithRole(s: Scheme, pole: PoleNode, role: string): string {
  const t = traceScheme(s);
  const ins = pole.insulators.find((i) => t.ports.get(portKey(pole.id, i.id))?.roles.includes(role as never));
  if (!ins) throw new Error(`no insulator with role ${role}`);
  return ins.id;
}

function addHouse(s: Scheme, x: number, phaseMode: '1' | '3' = '1'): HouseNode {
  const h = add<HouseNode>(s, createNode('house', [0, 0]), x);
  h.phaseMode = phaseMode;
  return h;
}

describe('traceScheme', () => {
  it('copies the insulator layout to new poles', () => {
    const { p1, p2 } = baseScheme();
    expect(p1.insulators).toHaveLength(5);
    expect(sortInsulators(p2.insulators).map((i) => `${i.side}${i.position}`)).toEqual(
      sortInsulators(p1.insulators).map((i) => `${i.side}${i.position}`),
    );
  });

  it('computes the phase of a single-phase house from the service drop insulator', () => {
    const { s, p2 } = baseScheme();
    const house = addHouse(s, 3);
    const drop = createLine(s, 'drop', p2.id, house.id, 'bare');
    expect(drop.wires).toHaveLength(2);
    drop.wires[0].fromPort = insulatorWithRole(s, p2, 'B');
    drop.wires[1].fromPort = insulatorWithRole(s, p2, 'N');

    const t = traceScheme(s);
    const h = t.houses.get(house.id)!;
    expect(h.status).toBe('ok');
    expect(h.computedPhases).toEqual(['B']);
    expect(h.hasNeutral).toBe(true);
    expect(t.feederStats[0].single.B).toBe(1);
  });

  it('handles wire transposition at a branch (L2 → R1)', () => {
    const { s, p1, p2 } = baseScheme();
    const p3 = add<PoleNode>(s, createNode('pole04', [0, 0]), 3);
    p3.insulators = [
      { id: 'x1', side: 'R', position: 1, type: 'pin' },
      { id: 'x2', side: 'R', position: 2, type: 'pin' },
    ];
    // The phase C wire running from pole 1 to pole 2 continues to insulator R1 of pole 3; neutral goes to R2.
    const span = createLine(s, 'line04', p2.id, p3.id, 'bare');
    span.wires = [
      { id: 'w1', fromPort: insulatorWithRole(s, p2, 'C'), toPort: 'x1' },
      { id: 'w2', fromPort: insulatorWithRole(s, p2, 'N'), toPort: 'x2' },
    ];
    const house = addHouse(s, 4);
    const drop = createLine(s, 'drop', p3.id, house.id, 'bare');
    drop.wires[0].fromPort = 'x1';
    drop.wires[1].fromPort = 'x2';

    const t = traceScheme(s);
    expect(t.houses.get(house.id)!.computedPhases).toEqual(['C']);
    expect(t.wires.get(wireKey(span.id, 'w1'))!.roles).toEqual(['C']);
    expect(p1.insulators.length).toBe(5);
  });

  it('passes through a jumper on a pole', () => {
    const { s, p2 } = baseScheme();
    const extra = { id: 'j_ins', side: 'R' as const, position: 9, type: 'pin' as const };
    p2.insulators.push(extra);
    p2.jumpers.push({ id: 'j', a: insulatorWithRole(s, p2, 'A'), b: extra.id });
    expect(traceScheme(s).ports.get(portKey(p2.id, extra.id))!.roles).toEqual(['A']);
  });

  it('several feeders on one span diverge to different poles', () => {
    const s = emptyScheme();
    const ktp = add<KtpNode>(s, createNode('ktp', [0, 0]), 0);
    ktp.feeders.push({
      id: 'f2',
      name: 'Фидер 2',
      outputs: (['A', 'B', 'C', 'N'] as const).map((role, i) => ({ id: `f2o${i}`, index: i + 1, role })),
    });
    const shared = add<PoleNode>(s, createNode('pole04', [0, 0]), 1);
    createLine(s, 'line04', ktp.id, shared.id, 'bare'); // feeder 1
    const second = createLine(s, 'line04', ktp.id, shared.id, 'bare'); // free feeder 2
    expect(second.wires.map((w) => w.fromPort)).toEqual(['f2o0', 'f2o1', 'f2o2', 'f2o3']);
    expect(shared.insulators).toHaveLength(9);

    // Feeder 2 goes to another pole: the phase A wire of feeder 2.
    const branch = add<PoleNode>(s, createNode('pole04', [0, 0]), 2);
    branch.insulators = [{ id: 'b1', side: 'L', position: 1, type: 'pin' }];
    const t0 = traceScheme(s);
    const f2a = shared.insulators.find((i) => {
      const p = t0.ports.get(portKey(shared.id, i.id));
      return p?.feeders.includes('f2') && p.roles.includes('A');
    })!;
    const span = createLine(s, 'line04', shared.id, branch.id, 'bare');
    span.wires = [{ id: 'w', fromPort: f2a.id, toPort: 'b1' }];
    const t = traceScheme(s);
    expect(t.ports.get(portKey(branch.id, 'b1'))).toMatchObject({ roles: ['A'], feeders: ['f2'] });
    expect(t.issues.filter((i) => i.level === 'error')).toEqual([]);
  });

  it('reports a short circuit when two phases meet on one insulator', () => {
    const { s, p2 } = baseScheme();
    p2.jumpers.push({ id: 'j', a: insulatorWithRole(s, p2, 'A'), b: insulatorWithRole(s, p2, 'B') });
    const t = traceScheme(s);
    expect(t.issues.some((i) => i.level === 'error' && i.targetId === p2.id)).toBe(true);
  });

  it('for ABC the feeder is determined but not the phase', () => {
    const s = emptyScheme();
    const ktp = add<KtpNode>(s, createNode('ktp', [0, 0]), 0);
    const p1 = add<PoleNode>(s, createNode('pole04', [0, 0]), 1);
    createLine(s, 'line04', ktp.id, p1.id, 'sip');
    expect(p1.insulators).toEqual([expect.objectContaining({ type: 'sipClamp' })]);
    const house = addHouse(s, 2);
    const drop = createLine(s, 'drop', p1.id, house.id, 'bare');
    expect(drop.wires.every((w) => w.fromPort === p1.insulators[0].id)).toBe(true);

    let h = traceScheme(s).houses.get(house.id)!;
    expect(h.status).toBe('sip');
    expect(h.effectivePhases).toEqual([]);
    expect(h.feeders).toEqual([ktp.feeders[0].id]);

    house.manualPhase = 'C';
    h = traceScheme(s).houses.get(house.id)!;
    expect(h.effectivePhases).toEqual(['C']);
  });

  it('three-phase house and house via a service entry', () => {
    const { s, p2 } = baseScheme();
    const house = addHouse(s, 3, '3');
    const entry = add<SchemeNode>(s, createNode('entry', [0, 0]), 3);
    if (entry.kind === 'entry') entry.houseId = house.id;
    const drop = createLine(s, 'drop', p2.id, entry.id, 'bare');
    expect(drop.wires).toHaveLength(4);
    (['A', 'B', 'C', 'N'] as const).forEach((r, i) => (drop.wires[i].fromPort = insulatorWithRole(s, p2, r)));
    const h = traceScheme(s).houses.get(house.id)!;
    expect(h.status).toBe('ok');
    expect(h.computedPhases).toEqual(['A', 'B', 'C']);
  });

  it('main line from an empty pole gets a default crossarm and is traced once the substation is connected', () => {
    const s = emptyScheme();
    const p1 = add<PoleNode>(s, createNode('pole04', [0, 0]), 1);
    const p2 = add<PoleNode>(s, createNode('pole04', [0, 0]), 2);
    const span = createLine(s, 'line04', p1.id, p2.id, 'bare');
    expect(span.wires).toHaveLength(5);
    expect(span.wires.every((w) => w.fromPort && w.toPort)).toBe(true);
    const ktp = add<KtpNode>(s, createNode('ktp', [0, 0]), 0);
    createLine(s, 'line04', ktp.id, p1.id, 'bare');
    const roles = sortInsulators(p2.insulators).map((i) => traceScheme(s).ports.get(portKey(p2.id, i.id))?.roles[0]);
    expect(roles).toEqual(['A', 'B', 'C', 'N', 'L']);
  });

  it('zigzag renumbering preserves phasing', () => {
    const { s, p2 } = baseScheme();
    p2.insulators = p2.insulators.map((i, k) => ({ ...i, side: k < 3 ? 'L' : 'R', position: k < 3 ? k + 1 : k - 2 }));
    const before = traceScheme(s);
    const rolesBefore = p2.insulators.map((i) => before.ports.get(portKey(p2.id, i.id))?.roles[0]);
    expect(isZigzag(p2)).toBe(false);
    layoutZigzag(p2);
    expect(isZigzag(p2)).toBe(true);
    expect(sortInsulators(p2.insulators).map((i) => `${i.side}${i.position}`)).toEqual(['L1', 'R2', 'L3', 'R4', 'L5']);
    const after = traceScheme(s);
    expect(p2.insulators.map((i) => after.ports.get(portKey(p2.id, i.id))?.roles[0])).toEqual(rolesBefore);
  });

  it('T-shaped pole: branch from the center insulators via jumpers', () => {
    const { s, p2 } = baseScheme();
    // The main line continues, and pole 2 has a branch from the center insulators.
    const c1 = addInsulator(p2, 'C');
    const c2 = addInsulator(p2, 'C');
    expect([insulatorLabel(c1), insulatorLabel(c2)]).toEqual(['Ц6', 'Ц7']);
    p2.jumpers.push({ id: 'j1', a: insulatorWithRole(s, p2, 'C'), b: c1.id });
    p2.jumpers.push({ id: 'j2', a: insulatorWithRole(s, p2, 'N'), b: c2.id });
    const branch = add<PoleNode>(s, createNode('pole04', [0, 0]), 3);
    const span = createLine(s, 'line04', p2.id, branch.id, 'bare');
    span.wires = [
      { id: 'b1', fromPort: c1.id, toPort: null },
      { id: 'b2', fromPort: c2.id, toPort: null },
    ];
    mapWiresByPosition(s, span); // matching center insulators (positions 6 and 7) are created on the branch pole
    const house = addHouse(s, 4);
    const drop = createLine(s, 'drop', branch.id, house.id, 'bare');
    drop.wires[0].fromPort = span.wires[0].toPort;
    drop.wires[1].fromPort = span.wires[1].toPort;

    const t = traceScheme(s);
    expect(t.houses.get(house.id)).toMatchObject({ status: 'ok', computedPhases: ['C'], hasNeutral: true });
    expect(t.issues.filter((i) => i.level === 'error')).toEqual([]);
    // The zigzag of side insulators is not broken by the center ones.
    expect(isZigzag(p2)).toBe(true);
  });

  it('back insulators: labelled, sorted between center and right, ignored by zigzag', () => {
    const { s, p2 } = baseScheme();
    const back = addInsulator(p2, 'B');
    expect(insulatorLabel(back)).toBe('З6');
    expect(isZigzag(p2)).toBe(true);
    const front = addInsulator(p2, 'C');
    front.position = back.position;
    expect(sortInsulators(p2.insulators).slice(-2).map((i) => i.side)).toEqual(['C', 'B']);
    // A jumper to a back insulator carries the phase like any other.
    p2.jumpers.push({ id: 'jb', a: insulatorWithRole(s, p2, 'B'), b: back.id });
    expect(traceScheme(s).ports.get(portKey(p2.id, back.id))!.roles).toEqual(['B']);
    layoutZigzag(p2);
    expect(back.side).toBe('B');
  });

  describe('luminaires', () => {
    const roleOf = (s: Scheme, pole: PoleNode) => (id: string) => traceScheme(s).ports.get(portKey(pole.id, id))?.roles[0] ?? null;

    it('auto-connects to the lighting wire and neutral', () => {
      const { s, p2 } = baseScheme();
      const lamp = addLamp(p2, roleOf(s, p2));
      expect(lamp.phasePort).toBe(insulatorWithRole(s, p2, 'L'));
      expect(lamp.neutralPort).toBe(insulatorWithRole(s, p2, 'N'));
      expect(traceScheme(s).lamps.get(lamp.id)).toMatchObject({ status: 'ok', supply: 'L' });
    });

    it('power from neutral is an error, missing neutral is a warning', () => {
      const { s, p2 } = baseScheme();
      const lamp = addLamp(p2, roleOf(s, p2));
      lamp.phasePort = insulatorWithRole(s, p2, 'N');
      let t = traceScheme(s);
      expect(t.lamps.get(lamp.id)!.status).toBe('wrong');
      expect(t.issues.some((i) => i.level === 'error' && i.key === 'issue.lampFromNeutral')).toBe(true);
      lamp.phasePort = insulatorWithRole(s, p2, 'A');
      lamp.neutralPort = null;
      t = traceScheme(s);
      expect(t.lamps.get(lamp.id)).toMatchObject({ status: 'noNeutral', supply: 'A' });
    });

    it('deleting an insulator detaches the luminaire', () => {
      const { s, p2 } = baseScheme();
      const lamp = addLamp(p2, roleOf(s, p2));
      removeInsulator(s, p2, lamp.phasePort!);
      expect(lamp.phasePort).toBeNull();
      expect(traceScheme(s).lamps.get(lamp.id)!.status).toBe('noPower');
    });
  });

  describe('manual marking', () => {
    /** Two poles without a substation, a house with a service drop from the second one. */
    function standalone() {
      const s = emptyScheme();
      const p1 = add<PoleNode>(s, createNode('pole04', [0, 0]), 1);
      const p2 = add<PoleNode>(s, createNode('pole04', [0, 0]), 2);
      createLine(s, 'line04', p1.id, p2.id, 'bare');
      const house = addHouse(s, 3);
      const drop = createLine(s, 'drop', p2.id, house.id, 'bare');
      const [i1, i2, , i4] = sortInsulators(p2.insulators);
      drop.wires[0].fromPort = i1.id;
      drop.wires[1].fromPort = i4.id;
      return { s, p1, p2, house, i1, i2, i4 };
    }
    const at = (s: Scheme, pole: PoleNode, ins: string) => traceScheme(s).ports.get(portKey(pole.id, ins));

    it('propagates along the wire and gives a phase to a house without a substation', () => {
      const { s, p1, p2, house } = standalone();
      const [m1, , , m4] = sortInsulators(p1.insulators);
      m1.mark = 'B'; // marking on the neighboring pole
      m4.mark = 'N';
      const t = traceScheme(s);
      expect(t.ports.get(portKey(p2.id, sortInsulators(p2.insulators)[0].id))!.roles).toEqual(['B']);
      expect(t.houses.get(house.id)).toMatchObject({ status: 'ok', computedPhases: ['B'], hasNeutral: true, feeders: [] });
      expect(t.issues.filter((i) => i.level === 'error')).toEqual([]);
    });

    it('"unknown phase" is resolved by tracing from the substation', () => {
      const { s, p1, p2, i1 } = standalone();
      i1.mark = 'P';
      expect(at(s, p2, i1.id)!.roles).toEqual(['P']);
      const ktp = add<KtpNode>(s, createNode('ktp', [0, 0]), 0);
      createLine(s, 'line04', ktp.id, p1.id, 'bare');
      expect(at(s, p2, i1.id)!.roles).toEqual(['A']);
      expect(traceScheme(s).issues.some((i) => i.key === 'issue.markMismatch')).toBe(false);
    });

    it('a conflict between marking and tracing is reported by the check', () => {
      const { s, p1, p2, i2 } = standalone();
      i2.mark = 'N'; // actually phase B is there
      const ktp = add<KtpNode>(s, createNode('ktp', [0, 0]), 0);
      createLine(s, 'line04', ktp.id, p1.id, 'bare');
      const issues = traceScheme(s).issues;
      expect(issues.some((i) => i.targetId === p2.id && i.key === 'issue.markMismatch' && i.params.mark === 'N')).toBe(true);
    });

    it('a single-phase house on "phase ?" requires manual assignment', () => {
      const { s, house, i1 } = standalone();
      i1.mark = 'P';
      expect(traceScheme(s).houses.get(house.id)!.status).toBe('phaseUnknown');
    });
  });

  it('highlights the phase along its entire length', () => {
    const { s, ktp } = baseScheme();
    const outA = ktp.feeders[0].outputs.find((o) => o.role === 'A')!;
    const t = traceScheme(s);
    expect(highlightWires(t, portKey(ktp.id, outA.id)).size).toBe(2);
  });
});
