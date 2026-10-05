/**
 * Scheme operations on ABC (SIP) cables: laying a cable between poles, changing the core set of a clamp
 * (applied to the whole cable run), converting pin insulators and legacy bundle clamps to cored clamps.
 */
import type { Insulator, KtpNode, PoleNode, Role, Scheme, SchemeLine, SchemeNode, SipCores, Wire } from './types';
import { addInsulator, isPole, isWired, linesAt, pickFreeFeeder, sortInsulators, uid } from './scheme';
import {
  MARKING_ROLE,
  coreForRole,
  coreMarkings,
  coreMarkingsOf,
  corePort,
  coreWithMarking,
  coresForCount,
  insulatorPorts,
  portMarking,
  splitPort,
  type CoreMarking,
} from './sip';

/** Traced (or manually marked) role of a port, used to lay out jumpers and cores automatically. */
export type RoleOf = (nodeId: string, portId: string) => Role | null;

type End = 'from' | 'to';
const portAt = (w: Wire, end: End) => (end === 'from' ? w.fromPort : w.toPort);
function setPortAt(w: Wire, end: End, port: string | null) {
  if (end === 'from') w.fromPort = port;
  else w.toPort = port;
}
const opposite = (end: End): End => (end === 'from' ? 'to' : 'from');
const nodeAt = (scheme: Scheme, line: SchemeLine, end: End) => scheme.nodes[end === 'from' ? line.from : line.to];

export function addSipClamp(pole: PoleNode, cores: SipCores): Insulator {
  const ins = addInsulator(pole, 'R', 'sipClamp');
  ins.cores = cores;
  return ins;
}

/** Clamp that holds the cable on a pole: the first clamp with a known core set. */
export function cableClamp(pole: PoleNode): Insulator | undefined {
  return pole.insulators.find((i) => coreMarkings(i).length > 0);
}

/**
 * Rewrites references to the ports of one pole (span wire ends, jumpers, luminaires).
 * `map` returns the new port, null to detach, undefined to keep it as is.
 */
function remapPorts(scheme: Scheme, pole: PoleNode, map: (portId: string) => string | null | undefined) {
  for (const line of linesAt(scheme, pole.id)) {
    for (const w of line.wires) {
      for (const end of ['from', 'to'] as const) {
        const p = portAt(w, end);
        if (!p || (end === 'from' ? line.from : line.to) !== pole.id) continue;
        const next = map(p);
        if (next !== undefined) setPortAt(w, end, next);
      }
    }
  }
  const seen = new Set<string>();
  pole.jumpers = pole.jumpers.flatMap((j) => {
    const a = map(j.a);
    const b = map(j.b);
    const na = a === undefined ? j.a : a;
    const nb = b === undefined ? j.b : b;
    const key = [na, nb].sort().join('|');
    if (!na || !nb || na === nb || seen.has(key)) return [];
    seen.add(key);
    return [{ ...j, a: na, b: nb }];
  });
  for (const lamp of pole.lamps) {
    if (lamp.phasePort) {
      const p = map(lamp.phasePort);
      if (p !== undefined) lamp.phasePort = p;
    }
    if (lamp.neutralPort) {
      const p = map(lamp.neutralPort);
      if (p !== undefined) lamp.neutralPort = p;
    }
  }
}

/** Marking of a port if it is a core of a clamp. */
function markingAt(node: SchemeNode | undefined, port: string | null): CoreMarking | null {
  return isPole(node) && port ? portMarking(node, port) : null;
}

/** Service drop wire role by its index: phase + neutral, or A, B, C, N. */
function dropRole(count: number, i: number): Role | null {
  if (count === 4) return (['A', 'B', 'C', 'N'] as const)[i];
  if (count === 2) return i === 0 ? 'P' : 'N';
  return null;
}

const outputRole = (ktp: KtpNode, port: string | null) =>
  ktp.feeders.flatMap((f) => f.outputs).find((o) => o.id === port)?.role ?? null;

// ---------- Laying a cable ----------

/**
 * Jumpers from the pin insulators of a pole to the cores of a new clamp, by traced roles
 * (or the standard order A, B, C, N, L of an untraced crossarm): the usual switch from bare wires to ABC.
 */
function addTransitionJumpers(pole: PoleNode, clamp: Insulator, roleOf?: RoleOf) {
  const pins = sortInsulators(pole.insulators.filter((i) => i.type === 'pin'));
  if (pins.length < 2) return;
  const traced = new Map(pins.map((p) => [p.id, roleOf?.(pole.id, p.id) ?? null]));
  const anyTraced = [...traced.values()].some(Boolean);
  const order: Role[] = ['A', 'B', 'C', 'N', 'L'];
  const roleOfPin = (pin: Insulator, k: number) => (anyTraced ? traced.get(pin.id) : order[k]) ?? null;
  coreMarkings(clamp).forEach((m, k) => {
    const role = MARKING_ROLE[m];
    const single = coreMarkings(clamp).length === 2 && m === '1';
    const pin = pins.find((p, i) => {
      const r = roleOfPin(p, i);
      return single ? r === 'A' || r === 'B' || r === 'C' : r === role;
    });
    if (pin) pole.jumpers.push({ id: uid('j'), a: pin.id, b: corePort(clamp.id, k) });
  });
}

/**
 * Wires of a new ABC span: one per core, from the substation outputs (by role) or the cores of the cable
 * clamp on the start pole to the same cores on the end pole. Missing clamps are created; a clamp created on a
 * pole with bare wires is connected to them with jumpers.
 */
export function sipCableWires(scheme: Scheme, from: SchemeNode, to: PoleNode, roleOf?: RoleOf): Wire[] {
  let src: { port: string; marking: CoreMarking }[] = [];
  let cores: SipCores = cableClamp(to)?.cores ?? '3+N';
  if (from.kind === 'ktp') {
    const feeder = pickFreeFeeder(scheme, from);
    const bundle = feeder?.outputs.find((o) => o.role === 'SIP');
    if (bundle) {
      src = coreMarkingsOf(cores).map((marking) => ({ port: bundle.id, marking }));
    } else if (feeder) {
      const outs = feeder.outputs.filter((o) => o.role !== 'SIP' && o.role !== 'P');
      cores = coresForCount(new Set(outs.map((o) => o.role)).size);
      const probe: Insulator = { id: '', side: 'R', position: 0, type: 'sipClamp', cores };
      for (const o of outs) {
        const k = coreForRole(probe, o.role as Role);
        const marking = k === null ? null : coreMarkingsOf(cores)[splitPort(k).core!];
        if (marking && !src.some((s) => s.marking === marking)) src.push({ port: o.id, marking });
      }
    }
  } else if (isPole(from)) {
    let clamp = cableClamp(from);
    if (!clamp) {
      clamp = addSipClamp(from, coresForCount(from.insulators.filter((i) => i.type === 'pin').length || 4));
      addTransitionJumpers(from, clamp, roleOf);
    }
    cores = clamp.cores!;
    src = coreMarkings(clamp).map((marking, k) => ({ port: corePort(clamp.id, k), marking }));
  }
  const target = cableClamp(to) ?? addSipClamp(to, cores);
  return src.map((s) => ({ id: uid('w'), fromPort: s.port, toPort: coreWithMarking(target, s.marking) }));
}

/** Service drop ports on a pole where the cable is the only thing: phase core(s) and the neutral core. */
export function dropPortsFromCable(clamp: Insulator, count: number): (string | null)[] {
  return Array.from({ length: count }, (_, i) => coreForRole(clamp, dropRole(count, i)));
}

// ---------- Core set of a clamp ----------

/** Clamps joined core-to-core by spans: one physical cable run. */
export function sipRun(scheme: Scheme, poleId: string, insId: string): { poleId: string; insId: string }[] {
  const key = (p: string, i: string) => `${p}#${i}`;
  const found = new Map([[key(poleId, insId), { poleId, insId }]]);
  const queue = [{ poleId, insId }];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const line of linesAt(scheme, cur.poleId)) {
      if (line.kind === 'drop' || !isWired(line.kind)) continue;
      const end: End = line.from === cur.poleId ? 'from' : 'to';
      const other = nodeAt(scheme, line, opposite(end));
      if (!isPole(other)) continue;
      for (const w of line.wires) {
        const here = portAt(w, end);
        const there = portAt(w, opposite(end));
        if (!here || !there || splitPort(here).insId !== cur.insId || splitPort(here).core === null) continue;
        const { insId: otherIns, core } = splitPort(there);
        if (core === null || found.has(key(other.id, otherIns))) continue;
        found.set(key(other.id, otherIns), { poleId: other.id, insId: otherIns });
        queue.push({ poleId: other.id, insId: otherIns });
      }
    }
  }
  return [...found.values()];
}

/** Changes the core set of one clamp, keeping connections to cores with the same marking. */
function retypeClamp(scheme: Scheme, pole: PoleNode, ins: Insulator, cores: SipCores) {
  const old = coreMarkings(ins);
  const next = coreMarkingsOf(cores);
  const map = (p: string) => {
    const { insId, core } = splitPort(p);
    if (insId !== ins.id || core === null) return undefined;
    const k = next.indexOf(old[core]);
    return k < 0 ? null : corePort(ins.id, k);
  };
  // A span wire on a core that disappears goes away with the core; a service drop wire is just detached.
  for (const line of linesAt(scheme, pole.id)) {
    if (line.kind === 'drop') continue;
    const end: End = line.from === pole.id ? 'from' : 'to';
    line.wires = line.wires.filter((w) => {
      const p = portAt(w, end);
      return !p || map(p) !== null;
    });
  }
  remapPorts(scheme, pole, map);
  const marks = ins.coreMarks;
  ins.cores = cores;
  if (marks) ins.coreMarks = next.map((m) => marks[old.indexOf(m)] ?? null);
}

/**
 * Keeps an ABC span consistent with the clamps at its ends: adds a wire for every core present at both ends
 * (or fed by a free substation output of the same role).
 */
function syncCableWires(scheme: Scheme, line: SchemeLine) {
  const from = scheme.nodes[line.from];
  const to = scheme.nodes[line.to];
  if (!isPole(to) || line.kind === 'drop') return;
  const clampAt = (node: SchemeNode, end: End) => {
    if (!isPole(node)) return undefined;
    const ids = line.wires.map((w) => portAt(w, end)).filter((p): p is string => !!p && splitPort(p).core !== null);
    return ids.length ? node.insulators.find((i) => i.id === splitPort(ids[0]).insId) : undefined;
  };
  const a = clampAt(from, 'from');
  const b = clampAt(to, 'to');
  if (!b) return;
  const used = new Set(line.wires.map((w) => w.fromPort));
  const feederOuts = from.kind === 'ktp' ? from.feeders.find((f) => f.outputs.some((o) => used.has(o.id)))?.outputs ?? [] : [];
  coreMarkings(b).forEach((m, k) => {
    if (line.wires.some((w) => w.toPort === corePort(b.id, k))) return;
    let fromPort: string | null = null;
    if (a) fromPort = coreWithMarking(a, m);
    else if (from.kind === 'ktp') fromPort = feederOuts.find((o) => o.role === MARKING_ROLE[m] && !used.has(o.id))?.id ?? null;
    if (fromPort) line.wires.push({ id: uid('w'), fromPort, toPort: corePort(b.id, k) });
  });
}

/** Sets the core set of a clamp and of every clamp of the same cable run; returns the number of clamps changed. */
export function setClampCores(scheme: Scheme, poleId: string, insId: string, cores: SipCores): number {
  const run = sipRun(scheme, poleId, insId);
  const lines = new Set<SchemeLine>();
  for (const { poleId: pid, insId: iid } of run) {
    const pole = scheme.nodes[pid];
    const ins = isPole(pole) ? pole.insulators.find((i) => i.id === iid) : undefined;
    if (!isPole(pole) || !ins) continue;
    retypeClamp(scheme, pole, ins, cores);
    linesAt(scheme, pid).forEach((l) => lines.add(l));
  }
  lines.forEach((l) => syncCableWires(scheme, l));
  return run.length;
}

/**
 * Gives cores to a clamp whose connections reference the whole insulator (a legacy bundle clamp or a pin
 * turned into a clamp). Span wires are spread over the cores: by the core or substation output role at the other
 * end, otherwise in order; a single bundle wire to another clamp becomes one wire per core. Service drops take
 * the cores of their roles (the phase core only when the cable has a single phase), luminaires the lighting and
 * neutral cores. Jumpers to the whole clamp are removed: the core they used is unknown.
 */
export function convertToCores(scheme: Scheme, pole: PoleNode, ins: Insulator, cores: SipCores): void {
  ins.type = 'sipClamp';
  ins.cores = cores;
  delete ins.mark;
  delete ins.coreMarks;
  const markings = coreMarkingsOf(cores);
  for (const line of linesAt(scheme, pole.id)) {
    if (!isWired(line.kind)) continue;
    const end: End = line.from === pole.id ? 'from' : 'to';
    const far = opposite(end);
    const other = nodeAt(scheme, line, far);
    const refs = line.wires.filter((w) => portAt(w, end) === ins.id);
    if (!refs.length) continue;
    if (line.kind === 'drop') {
      for (const w of refs) setPortAt(w, end, coreForRole(ins, dropRole(line.wires.length, line.wires.indexOf(w))));
      continue;
    }
    const farPort = portAt(refs[0], far);
    const farIsClamp = isPole(other) && !!farPort && other.insulators.find((i) => i.id === splitPort(farPort).insId)?.type === 'sipClamp';
    const farIsBundle = other?.kind === 'ktp' && outputRole(other, farPort) === 'SIP';
    if (refs.length === 1 && (farIsClamp || farIsBundle)) {
      const farIns = isPole(other) && farPort ? other.insulators.find((i) => i.id === splitPort(farPort).insId) : undefined;
      const expanded = markings.map((m, k) => {
        const w: Wire = k === 0 ? refs[0] : { id: uid('w'), fromPort: null, toPort: null };
        setPortAt(w, end, corePort(ins.id, k));
        setPortAt(w, far, farIns && coreMarkings(farIns).length ? coreWithMarking(farIns, m) : farPort);
        return w;
      });
      line.wires.splice(line.wires.indexOf(refs[0]), 1, ...expanded);
      continue;
    }
    refs.forEach((w, k) => {
      const p = portAt(w, far);
      const m = markingAt(other, p);
      const role = other?.kind === 'ktp' ? outputRole(other, p) : null;
      let port: string | null;
      if (m) port = coreWithMarking(ins, m);
      else if (role && role !== 'SIP') port = coreForRole(ins, role);
      else port = k < markings.length ? corePort(ins.id, k) : null;
      setPortAt(w, end, port);
    });
  }
  for (const lamp of pole.lamps) {
    if (lamp.phasePort === ins.id) lamp.phasePort = coreForRole(ins, 'L');
    if (lamp.neutralPort === ins.id) lamp.neutralPort = coreForRole(ins, 'N');
  }
  remapPorts(scheme, pole, (p) => (p === ins.id ? null : undefined));
}

/** Turns a cored clamp back into a single-conductor insulator: every core reference goes to the insulator. */
function convertToPin(scheme: Scheme, pole: PoleNode, ins: Insulator) {
  const own = new Set(insulatorPorts(ins));
  for (const line of linesAt(scheme, pole.id)) {
    const end: End = line.from === pole.id ? 'from' : 'to';
    let first = true;
    for (const w of line.wires) {
      const p = portAt(w, end);
      if (!p || !own.has(p)) continue;
      setPortAt(w, end, first ? ins.id : null);
      first = false;
    }
  }
  remapPorts(scheme, pole, (p) => (own.has(p) ? ins.id : undefined));
  ins.type = 'pin';
  delete ins.cores;
  delete ins.coreMarks;
}

/** Insulator type picked in the pole card: a pin insulator or an ABC clamp with a core set. */
export function setInsulatorKind(scheme: Scheme, pole: PoleNode, insId: string, kind: 'pin' | SipCores): number {
  const ins = pole.insulators.find((i) => i.id === insId);
  if (!ins) return 0;
  if (kind === 'pin') {
    if (ins.type !== 'pin') convertToPin(scheme, pole, ins);
    return 1;
  }
  if (coreMarkings(ins).length) return setClampCores(scheme, pole.id, insId, kind);
  convertToCores(scheme, pole, ins, kind);
  return 1;
}

/**
 * Converts legacy bundle clamps (no core set) of an older project. The core set comes from the number of
 * conductors arriving at the clamp (5 → with lighting, 2 → single phase), spreads along clamp-to-clamp spans,
 * and defaults to 3+N.
 */
export function upgradeLegacySip(scheme: Scheme): void {
  const legacy: { pole: PoleNode; ins: Insulator }[] = [];
  for (const node of Object.values(scheme.nodes)) {
    if (!isPole(node)) continue;
    for (const ins of node.insulators) if (ins.type === 'sipClamp' && !ins.cores) legacy.push({ pole: node, ins });
  }
  if (!legacy.length) return;
  const isLegacy = new Set(legacy.map((l) => l.ins.id));
  const types = new Map<string, SipCores>();
  const neighbours = new Map<string, string[]>();
  for (const { pole, ins } of legacy) {
    let count = 0;
    for (const line of linesAt(scheme, pole.id)) {
      if (line.kind === 'drop' || !isWired(line.kind)) continue;
      const end: End = line.from === pole.id ? 'from' : 'to';
      const refs = line.wires.filter((w) => portAt(w, end) === ins.id);
      const other = nodeAt(scheme, line, opposite(end));
      const n =
        other?.kind === 'ktp'
          ? new Set(refs.map((w) => outputRole(other, portAt(w, opposite(end)))).filter((r) => r && r !== 'SIP')).size
          : refs.length;
      count = Math.max(count, n);
      for (const w of refs) {
        const far = portAt(w, opposite(end));
        if (far && isLegacy.has(far)) neighbours.set(ins.id, [...(neighbours.get(ins.id) ?? []), far]);
      }
    }
    if (count >= 2) types.set(ins.id, coresForCount(count));
  }
  const queue = [...types.keys()];
  while (queue.length) {
    const id = queue.shift()!;
    for (const n of [...(neighbours.get(id) ?? []), ...[...neighbours].filter(([, v]) => v.includes(id)).map(([k]) => k)]) {
      if (types.has(n)) continue;
      types.set(n, types.get(id)!);
      queue.push(n);
    }
  }
  for (const { pole, ins } of legacy) convertToCores(scheme, pole, ins, types.get(ins.id) ?? '3+N');
}
