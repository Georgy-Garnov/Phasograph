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
 *
 * Repeated earthing: when poles bond the neutral to their own earth electrodes, part of the neutral current returns
 * through the earth to the transformer neutral electrode. The neutral potentials (relative to remote earth) then come
 * from a nodal analysis of the neutral network: span neutral impedances between nodes, electrode resistances to
 * earth at the substation and the re-earthed poles, load neutral currents injected at the houses. Phase conductor
 * potentials keep following the phase currents; a house gets the difference of the two.
 */
import type { HouseNode, Phase, Scheme, SchemeLine } from '../model/types';
import { conductorOf } from '../model/conductors';
import { wireKey, type TraceResult } from './trace';
import { lineLength } from './distances';
import { hvActualV, noLoadPhaseVoltage, transformerData, transformerImpedance } from '../model/transformers';
import { KTP_GROUND_OHM, REGROUND_OHM, positiveOr } from '../model/earthing';
import { isPole } from '../model/scheme';

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
  /** Potential of the neutral at the entry relative to earth, V (the neutral shift seen from the ground). */
  neutralV: number;
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
  /** Current through the transformer neutral earth electrode, A (0 without repeated earthing). */
  groundAmps: number;
  /** Potential of the transformer neutral relative to earth, V. */
  neutralV: number;
}

/** Repeated earthing on a pole under load. */
export interface GroundReading {
  /** Current through the pole's earth electrode, A. */
  amps: number;
  /** Potential of the neutral on the pole relative to earth, V. */
  neutralV: number;
}

export interface VoltageResult {
  houses: Map<string, HouseVoltage>;
  ktps: Map<string, KtpReading>;
  /** Re-earthed poles fed by a substation. */
  grounds: Map<string, GroundReading>;
}

interface FeederTree {
  order: string[];
  parent: Map<string, { node: string; line: SchemeLine }>;
  branch: Map<string, Triple>;
  feederId: string;
  houses: { house: HouseNode; at: string; phases: Phase[]; kw: number; perPhase: Record<Phase, number> }[];
}

export function computeVoltages(scheme: Scheme, trace: TraceResult, mode: LoadMode): VoltageResult {
  const houses = new Map<string, HouseVoltage>();
  const ktps = new Map<string, KtpReading>();
  const grounds = new Map<string, GroundReading>();
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
      trees.push({ order, parent, branch, feederId: feeder.id, houses: feederHouses });
    }

    // 2. Transformer: total current of all feeders, busbar voltage behind the short-circuit impedance.
    const iBus = zeroTriple();
    for (const tree of trees) for (const p of PHASES) iBus[p] = add(iBus[p], tree.branch.get(ktp.id)![p]);
    const u0 = noLoadPhaseVoltage(ktp);
    const data = transformerData(ktp);
    const zT: C = data ? transformerImpedance(data) : ZERO;
    const bus: Triple = { A: ZERO, B: ZERO, C: ZERO };
    for (const p of PHASES) bus[p] = sub(polar(u0, PHASE_ANGLE[p]), mul(zT, iBus[p]));

    // 3. Neutral potentials relative to earth (nodal analysis when poles re-earth the neutral).
    const neutral = neutralPotentials(scheme, ktp.id, trees);
    const nKtp = neutral.get(ktp.id) ?? ZERO;

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
      groundAmps: abs(nKtp) / positiveOr(ktp.groundOhm, KTP_GROUND_OHM),
      neutralV: abs(nKtp),
    });

    // 4. Feeders: phase conductor potentials walk down from the busbars; the house sees phase minus neutral.
    for (const { order, parent, branch, feederId, houses: feederHouses } of trees) {
      const key = neutralKey(scheme, ktp.id, feederId);
      const phase = new Map<string, Triple>([[ktp.id, { A: add(bus.A, nKtp), B: add(bus.B, nKtp), C: add(bus.C, nKtp) }]]);
      for (let i = 1; i < order.length; i++) {
        const id = order[i];
        const { node: up, line } = parent.get(id)!;
        const zPh = lineImpedance(scheme, line).phase;
        const i3 = branch.get(id)!;
        const vUp = phase.get(up)!;
        phase.set(id, { A: sub(vUp.A, mul(zPh, i3.A)), B: sub(vUp.B, mul(zPh, i3.B)), C: sub(vUp.C, mul(zPh, i3.C)) });
      }
      for (const id of order) {
        const node = scheme.nodes[id];
        if (isPole(node) && node.reGround) {
          const vn = neutral.get(key(id)) ?? ZERO;
          grounds.set(id, { neutralV: abs(vn), amps: abs(vn) / positiveOr(node.reGroundOhm, REGROUND_OHM) });
        }
      }

      for (const { house, at, phases, kw, perPhase } of feederHouses) {
        const vp = phase.get(at)!;
        const vn = neutral.get(key(at)) ?? ZERO;
        const readings = phases.map((p) => ({ phase: p, voltage: abs(sub(vp[p], vn)), loadKw: perPhase[p] }));
        const voltage = Math.min(...readings.map((x) => x.voltage));
        houses.set(house.id, {
          phases: readings,
          voltage,
          dropPct: ((u0 - voltage) / NOMINAL_VOLTAGE) * 100,
          loadKw: kw,
          ok: readings.every((x) => x.voltage >= VOLTAGE_MIN && x.voltage <= VOLTAGE_MAX),
          neutralV: abs(vn),
        });
      }
    }
  }
  return { houses, ktps, grounds };
}

const cache = new WeakMap<TraceResult, Partial<Record<LoadMode, VoltageResult>>>();

/** Cached per trace result (a new trace is produced on every scheme change). */
export function cachedVoltages(scheme: Scheme, trace: TraceResult, mode: LoadMode): VoltageResult {
  let entry = cache.get(trace);
  if (!entry) cache.set(trace, (entry = {}));
  return (entry[mode] ??= computeVoltages(scheme, trace, mode));
}

/** Phase and neutral impedance of a line, Ω. */
function lineImpedance(scheme: Scheme, line: SchemeLine): { phase: C; neutral: C } {
  const cond = conductorOf(line);
  const km = lineLength(scheme, line) / 1000;
  return { phase: [cond.r * km, cond.x * km], neutral: [(cond.rN ?? cond.r) * km, cond.x * km] };
}

/**
 * Key of a neutral node: feeders have separate neutrals, except at the substation (common star point) and on
 * re-earthed poles (every neutral on the pole is bonded to the same electrode).
 */
function neutralKey(scheme: Scheme, ktpId: string, feederId: string) {
  return (id: string) => {
    const node = scheme.nodes[id];
    return id === ktpId || (isPole(node) && node.reGround) ? id : `${feederId}|${id}`;
  };
}

/**
 * Neutral potentials relative to earth for every neutral node of a substation's feeders.
 * Without repeated earthing no current flows in the earth: the star point stays at earth potential and each node
 * rises by the neutral current times the neutral impedance on the way back. Otherwise the neutral network with its
 * electrodes to earth is solved as a nodal system Y·V = I.
 */
function neutralPotentials(scheme: Scheme, ktpId: string, trees: FeederTree[]): Map<string, C> {
  const result = new Map<string, C>([[ktpId, ZERO]]);
  const reEarthed = trees.some((t) => t.order.some((id) => {
    const n = scheme.nodes[id];
    return isPole(n) && n.reGround;
  }));
  const sum3 = (t: Triple) => add(add(t.A, t.B), t.C);

  if (!reEarthed) {
    for (const { order, parent, branch, feederId } of trees) {
      const key = neutralKey(scheme, ktpId, feederId);
      for (let i = 1; i < order.length; i++) {
        const { node: up, line } = parent.get(order[i])!;
        const zN = lineImpedance(scheme, line).neutral;
        result.set(key(order[i]), add(result.get(key(up))!, mul(zN, sum3(branch.get(order[i])!))));
      }
    }
    return result;
  }

  // Nodal analysis: unknown potentials of all neutral nodes, the earth is the reference.
  const index = new Map<string, number>();
  const idx = (k: string) => {
    if (!index.has(k)) index.set(k, index.size);
    return index.get(k)!;
  };
  idx(ktpId);
  const edges: [number, number, C][] = [];
  const injections = new Map<number, C>();
  const inject = (i: number, c: C) => injections.set(i, add(injections.get(i) ?? ZERO, c));
  const shunts = new Map<number, number>();
  const ktp = scheme.nodes[ktpId];
  shunts.set(0, 1 / positiveOr(ktp?.kind === 'ktp' ? ktp.groundOhm : '', KTP_GROUND_OHM));
  for (const { order, parent, branch, feederId } of trees) {
    const key = neutralKey(scheme, ktpId, feederId);
    for (const id of order) {
      const node = scheme.nodes[id];
      const i = idx(key(id));
      if (isPole(node) && node.reGround) shunts.set(i, 1 / positiveOr(node.reGroundOhm, REGROUND_OHM));
      if (id === ktpId) continue;
      const { node: up, line } = parent.get(id)!;
      const zN = lineImpedance(scheme, line).neutral;
      // A zero-length span would make the admittance infinite: give it a tiny impedance.
      edges.push([i, idx(key(up)), invert(abs(zN) > 1e-6 ? zN : [1e-6, 0])]);
      // Each branch current enters the neutral at its node and leaves at the parent: the net at a node is its own
      // load current, and the star point takes back the total phase current of all feeders.
      inject(i, sum3(branch.get(id)!));
      inject(idx(key(up)), mul([-1, 0], sum3(branch.get(id)!)));
    }
  }
  const n = index.size;
  const y: C[][] = Array.from({ length: n }, () => Array.from({ length: n }, () => ZERO));
  for (const [a, b, adm] of edges) {
    y[a][a] = add(y[a][a], adm);
    y[b][b] = add(y[b][b], adm);
    y[a][b] = sub(y[a][b], adm);
    y[b][a] = sub(y[b][a], adm);
  }
  for (const [i, g] of shunts) y[i][i] = add(y[i][i], [g, 0]);
  const rhs: C[] = Array.from({ length: n }, (_, i) => injections.get(i) ?? ZERO);
  const v = solveComplex(y, rhs);
  for (const [k, i] of index) result.set(k, v[i]);
  return result;
}

function invert(a: C): C {
  const d = a[0] * a[0] + a[1] * a[1];
  return [a[0] / d, -a[1] / d];
}

/** Gaussian elimination with partial pivoting for a complex linear system. */
function solveComplex(a: C[][], b: C[]): C[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (abs(m[r][col]) > abs(m[pivot][col])) pivot = r;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    const inv = invert(m[col][col]);
    for (let r = col + 1; r < n; r++) {
      const f = mul(m[r][col], inv);
      if (f[0] === 0 && f[1] === 0) continue;
      for (let c = col; c <= n; c++) m[r][c] = sub(m[r][c], mul(f, m[col][c]));
    }
  }
  const x: C[] = Array.from({ length: n }, () => ZERO);
  for (let r = n - 1; r >= 0; r--) {
    let acc = m[r][n];
    for (let c = r + 1; c < n; c++) acc = sub(acc, mul(m[r][c], x[c]));
    x[r] = mul(acc, invert(m[r][r]));
  }
  return x;
}
