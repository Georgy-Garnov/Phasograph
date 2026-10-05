/**
 * Voltage-drop calculation for 0.4 kV radial feeders with unbalanced single-phase loads.
 *
 * The busbar voltage comes from the transformer: no-load voltage set by the actual HV supply and the
 * off-circuit tap position, minus the drop on the transformer short-circuit impedance caused by the sum of
 * all feeder currents.
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
import { hvActualV, noLoadPhaseVoltage, transformerData, transformerImpedance } from '../model/transformers';

export const NOMINAL_VOLTAGE = 230;
export const COS_PHI = 0.95;
/** Permitted deviation of the supply voltage: ±10% (GOST 32144). */
export const VOLTAGE_MIN = 207;
export const VOLTAGE_MAX = 253;

export type LoadMode = 'current' | 'design';

export interface HouseVoltage {
  /** Voltage and load on each phase the house uses, V and kW. */
  phases: { phase: Phase; voltage: number; loadKw: number }[];
  /** Lowest of them (the single-phase voltmeter; three-phase houses show one per phase). */
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

/** Instrument readings of a substation (transformer) for the current load. */
export interface KtpReading {
  /** Busbar phase voltages A, B, C, V. */
  voltages: Record<Phase, number>;
  /** Phase currents A, B, C, A. */
  currents: Record<Phase, number>;
  /** Apparent power drawn from the transformer, VA. */
  apparentVa: number;
  /** Loading relative to the rated power, % (null when the rating is unknown). */
  loadingPct: number | null;
  /** Actual high voltage, V. */
  hvVoltage: number;
  /** High-voltage line current, A. */
  hvCurrent: number;
  /** No-load LV phase voltage set by the HV supply and the tap position, V. */
  noLoadVoltage: number;
}

export interface VoltageResult {
  houses: Map<string, HouseVoltage>;
  ktps: Map<string, KtpReading>;
}

interface FeederTree {
  order: string[];
  parent: Map<string, { node: string; line: SchemeLine }>;
  branch: Map<string, Triple>;
  houses: { house: HouseNode; at: string; phases: Phase[]; kw: number; perPhase: Record<Phase, number> }[];
}

export function computeVoltages(scheme: Scheme, trace: TraceResult, mode: LoadMode): VoltageResult {
  const houses = new Map<string, HouseVoltage>();
  const ktps = new Map<string, KtpReading>();
  const phiDeg = (Math.acos(COS_PHI) * 180) / Math.PI;

  // Service entry → house, to attach houses fed through an entry point.
  const entriesOf = new Map<string, string[]>();
  for (const n of Object.values(scheme.nodes)) {
    if (n.kind === 'entry' && n.houseId) entriesOf.set(n.houseId, [...(entriesOf.get(n.houseId) ?? []), n.id]);
  }

  for (const ktp of Object.values(scheme.nodes)) {
    if (ktp.kind !== 'ktp') continue;

    // 1. Feeder trees and branch currents (loads are currents at nominal voltage, so no iteration needed).
    const trees: FeederTree[] = [];
    for (const feeder of ktp.feeders) {
      const lines = Object.values(scheme.lines).filter(
        (l) => (l.kind === 'line04' || l.kind === 'drop') && carriesFeeder(l, feeder.id, trace),
      );
      if (!lines.length) continue;

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

      const loads = new Map<string, Triple>();
      const feederHouses: FeederTree['houses'] = [];
      for (const house of Object.values(scheme.nodes)) {
        if (house.kind !== 'house') continue;
        const ht = trace.houses.get(house.id);
        if (!ht?.feeders.includes(feeder.id)) continue;
        const at = [house.id, ...(entriesOf.get(house.id) ?? [])].find((id) => seen.has(id));
        if (!at) continue;
        const phases = house.phaseMode === '3' ? PHASES : ht.effectivePhases.slice(0, 1);
        if (!phases.length) continue;
        const kw = houseLoadKw(house, mode);
        // A three-phase house with per-phase loads; otherwise the total is split equally.
        const split = house.phaseMode === '3' ? house.phaseLoads?.[mode] : undefined;
        const perPhase = { A: 0, B: 0, C: 0 };
        for (const p of phases) perPhase[p] = split ? parseKw(split[p]) : kw / phases.length;
        feederHouses.push({ house, at, phases, kw: split ? perPhase.A + perPhase.B + perPhase.C : kw, perPhase });
        const t = loads.get(at) ?? zeroTriple();
        for (const p of phases) {
          const amps = (perPhase[p] * 1000) / (NOMINAL_VOLTAGE * COS_PHI);
          t[p] = add(t[p], polar(amps, PHASE_ANGLE[p] - phiDeg));
        }
        loads.set(at, t);
      }

      const branch = new Map<string, Triple>();
      for (const id of order) branch.set(id, { ...(loads.get(id) ?? zeroTriple()) });
      for (let i = order.length - 1; i > 0; i--) {
        const t = branch.get(order[i])!;
        const u = branch.get(parent.get(order[i])!.node)!;
        for (const p of PHASES) u[p] = add(u[p], t[p]);
      }
      trees.push({ order, parent, branch, houses: feederHouses });
    }

    // 2. Transformer: total current of all feeders, busbar voltage behind the short-circuit impedance.
    const iBus = zeroTriple();
    for (const tree of trees) for (const p of PHASES) iBus[p] = add(iBus[p], tree.branch.get(ktp.id)![p]);
    const u0 = noLoadPhaseVoltage(ktp);
    const data = transformerData(ktp);
    const zT: C = data ? transformerImpedance(data) : ZERO;
    const bus: Triple = { A: ZERO, B: ZERO, C: ZERO };
    for (const p of PHASES) bus[p] = sub(polar(u0, PHASE_ANGLE[p]), mul(zT, iBus[p]));

    const voltages = { A: abs(bus.A), B: abs(bus.B), C: abs(bus.C) };
    const currents = { A: abs(iBus.A), B: abs(iBus.B), C: abs(iBus.C) };
    const apparentVa = PHASES.reduce((sum, p) => sum + voltages[p] * currents[p], 0);
    const hvVoltage = hvActualV(ktp);
    ktps.set(ktp.id, {
      voltages,
      currents,
      apparentVa,
      loadingPct: data ? (apparentVa / (data.kva * 1000)) * 100 : null,
      hvVoltage,
      // Losses are neglected: the HV side delivers the same apparent power.
      hvCurrent: apparentVa / (Math.sqrt(3) * hvVoltage),
      noLoadVoltage: u0,
    });

    // 3. Feeders: walk from the busbars downwards.
    for (const { order, parent, branch, houses: feederHouses } of trees) {
      const volts = new Map<string, Triple>([[ktp.id, bus]]);
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

      for (const { house, at, phases, kw, perPhase } of feederHouses) {
        const v = volts.get(at)!;
        const readings = phases.map((p) => ({ phase: p, voltage: abs(v[p]), loadKw: perPhase[p] }));
        const voltage = Math.min(...readings.map((x) => x.voltage));
        houses.set(house.id, {
          phases: readings,
          voltage,
          dropPct: ((u0 - voltage) / NOMINAL_VOLTAGE) * 100,
          loadKw: kw,
          ok: readings.every((x) => x.voltage >= VOLTAGE_MIN && x.voltage <= VOLTAGE_MAX),
        });
      }
    }
  }
  return { houses, ktps };
}

const cache = new WeakMap<TraceResult, Partial<Record<LoadMode, VoltageResult>>>();

/** Cached per trace result (a new trace is produced on every scheme change). */
export function cachedVoltages(scheme: Scheme, trace: TraceResult, mode: LoadMode): VoltageResult {
  let entry = cache.get(trace);
  if (!entry) cache.set(trace, (entry = {}));
  return (entry[mode] ??= computeVoltages(scheme, trace, mode));
}
