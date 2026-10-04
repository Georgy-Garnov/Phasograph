/**
 * Voltage-drop calculation for 0.4 kV radial feeders with unbalanced single-phase loads.
 *
 * For every feeder a tree is built from the substation over the lines that carry this feeder (by tracing).
 * Each house load is placed on its phase (three-phase houses are split equally over A, B, C) as a current
 * phasor I = P / (U_nom · cos φ) lagging its phase voltage by φ. Branch currents are summed towards the
 * substation; the neutral carries the phasor sum of the phase currents. Phase-to-neutral voltage at the
 * downstream end of a span: V_k = V_k(up) − Z_phase · I_k − Z_neutral · I_N.
 */
import type { HouseNode, Phase, Scheme, SchemeLine } from '../model/types';
import { conductorOf } from '../model/conductors';
import { wireKey, type TraceResult } from './trace';
import { lineLength } from './distances';

export const NOMINAL_VOLTAGE = 230;
export const COS_PHI = 0.95;
/** Permitted deviation of the supply voltage: ±10% (GOST 32144). */
export const VOLTAGE_MIN = 207;
export const VOLTAGE_MAX = 253;

export type LoadMode = 'current' | 'design';

export interface HouseVoltage {
  /** Voltage on each phase the house uses, V. */
  phases: { phase: Phase; voltage: number }[];
  /** Lowest of them (shown on the voltmeter). */
  voltage: number;
  /** Drop relative to the substation busbar voltage, %. */
  dropPct: number;
  /** Load used in the calculation, kW. */
  loadKw: number;
  ok: boolean;
}

// ---------- Minimal complex arithmetic ----------

type C = [number, number];
const add = (a: C, b: C): C => [a[0] + b[0], a[1] + b[1]];
const sub = (a: C, b: C): C => [a[0] - b[0], a[1] - b[1]];
const mul = (a: C, b: C): C => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const polar = (mag: number, deg: number): C => [mag * Math.cos((deg * Math.PI) / 180), mag * Math.sin((deg * Math.PI) / 180)];
const abs = (a: C) => Math.hypot(a[0], a[1]);
const ZERO: C = [0, 0];

const PHASE_ANGLE: Record<Phase, number> = { A: 0, B: -120, C: 120 };
const PHASES: Phase[] = ['A', 'B', 'C'];
type Triple = Record<Phase, C>;
const zeroTriple = (): Triple => ({ A: ZERO, B: ZERO, C: ZERO });

export function parseKw(s: string): number {
  const v = Number(String(s).replace(',', '.'));
  return Number.isFinite(v) && v > 0 ? v : 0;
}

function houseLoadKw(house: HouseNode, mode: LoadMode): number {
  return parseKw(mode === 'design' ? house.designPowerKw : house.currentPowerKw);
}

/** Lines that carry a feeder: at least one of their wires is traced to it. */
function carriesFeeder(line: SchemeLine, feederId: string, trace: TraceResult): boolean {
  return line.wires.some((w) => trace.wires.get(wireKey(line.id, w.id))?.feeders.includes(feederId));
}

export function computeVoltages(scheme: Scheme, trace: TraceResult, mode: LoadMode): Map<string, HouseVoltage> {
  const result = new Map<string, HouseVoltage>();
  const phiDeg = (Math.acos(COS_PHI) * 180) / Math.PI;

  // Service entry → house, to attach houses fed through an entry point.
  const entriesOf = new Map<string, string[]>();
  for (const n of Object.values(scheme.nodes)) {
    if (n.kind === 'entry' && n.houseId) entriesOf.set(n.houseId, [...(entriesOf.get(n.houseId) ?? []), n.id]);
  }

  for (const ktp of Object.values(scheme.nodes)) {
    if (ktp.kind !== 'ktp') continue;
    const u0 = parseKw(ktp.busVoltage) || NOMINAL_VOLTAGE;

    for (const feeder of ktp.feeders) {
      const lines = Object.values(scheme.lines).filter(
        (l) => (l.kind === 'line04' || l.kind === 'drop') && carriesFeeder(l, feeder.id, trace),
      );
      if (!lines.length) continue;

      // Tree from the substation (BFS by length; spans are short, any spanning tree of a radial net is the net).
      const adj = new Map<string, { to: string; line: SchemeLine }[]>();
      for (const l of lines) {
        adj.set(l.from, [...(adj.get(l.from) ?? []), { to: l.to, line: l }]);
        adj.set(l.to, [...(adj.get(l.to) ?? []), { to: l.from, line: l }]);
      }
      const parent = new Map<string, { node: string; line: SchemeLine }>();
      const order: string[] = [ktp.id];
      const seen = new Set([ktp.id]);
      for (let i = 0; i < order.length; i++) {
        for (const e of adj.get(order[i]) ?? []) {
          if (seen.has(e.to)) continue;
          seen.add(e.to);
          parent.set(e.to, { node: order[i], line: e.line });
          order.push(e.to);
        }
      }

      // House loads on the tree node they are fed at.
      const loads = new Map<string, Triple>();
      const housesHere: { house: HouseNode; at: string; phases: Phase[]; kw: number }[] = [];
      for (const house of Object.values(scheme.nodes)) {
        if (house.kind !== 'house') continue;
        const ht = trace.houses.get(house.id);
        if (!ht?.feeders.includes(feeder.id)) continue;
        const at = [house.id, ...(entriesOf.get(house.id) ?? [])].find((id) => seen.has(id));
        if (!at) continue;
        const phases = house.phaseMode === '3' ? PHASES : ht.effectivePhases.slice(0, 1);
        if (!phases.length) continue;
        const kw = houseLoadKw(house, mode);
        housesHere.push({ house, at, phases, kw });
        const t = loads.get(at) ?? zeroTriple();
        for (const p of phases) {
          const amps = (kw * 1000) / phases.length / (NOMINAL_VOLTAGE * COS_PHI);
          t[p] = add(t[p], polar(amps, PHASE_ANGLE[p] - phiDeg));
        }
        loads.set(at, t);
      }

      // Branch currents: accumulate from the leaves towards the substation.
      const branch = new Map<string, Triple>();
      for (const id of order) branch.set(id, { ...(loads.get(id) ?? zeroTriple()) });
      for (let i = order.length - 1; i > 0; i--) {
        const id = order[i];
        const up = parent.get(id)!.node;
        const t = branch.get(id)!;
        const u = branch.get(up)!;
        for (const p of PHASES) u[p] = add(u[p], t[p]);
      }

      // Voltages: walk from the substation downwards.
      const volts = new Map<string, Triple>();
      volts.set(ktp.id, { A: polar(u0, 0), B: polar(u0, -120), C: polar(u0, 120) });
      for (let i = 1; i < order.length; i++) {
        const id = order[i];
        const { node: up, line } = parent.get(id)!;
        const cond = conductorOf(line);
        const km = lineLength(scheme, line) / 1000;
        const zPh: C = [cond.r * km, cond.x * km];
        const zN: C = [(cond.rN ?? cond.r) * km, cond.x * km];
        const i3 = branch.get(id)!;
        const iN = add(add(i3.A, i3.B), i3.C);
        const vUp = volts.get(up)!;
        const v = zeroTriple();
        for (const p of PHASES) v[p] = sub(sub(vUp[p], mul(zPh, i3[p])), mul(zN, iN));
        volts.set(id, v);
      }

      for (const { house, at, phases, kw } of housesHere) {
        const v = volts.get(at)!;
        const perPhase = phases.map((p) => ({ phase: p, voltage: abs(v[p]) }));
        const voltage = Math.min(...perPhase.map((x) => x.voltage));
        result.set(house.id, {
          phases: perPhase,
          voltage,
          dropPct: ((u0 - voltage) / NOMINAL_VOLTAGE) * 100,
          loadKw: kw,
          ok: voltage >= VOLTAGE_MIN && voltage <= VOLTAGE_MAX,
        });
      }
    }
  }
  return result;
}

const cache = new WeakMap<TraceResult, Partial<Record<LoadMode, Map<string, HouseVoltage>>>>();

/** Cached per trace result (a new trace is produced on every scheme change). */
export function cachedVoltages(scheme: Scheme, trace: TraceResult, mode: LoadMode): Map<string, HouseVoltage> {
  let entry = cache.get(trace);
  if (!entry) cache.set(trace, (entry = {}));
  return (entry[mode] ??= computeVoltages(scheme, trace, mode));
}
