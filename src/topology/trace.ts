/**
 * Topological analysis of the scheme: tracing conductors from substation outputs
 * through span wires and pole jumpers to house service entries.
 *
 * Graph: vertices are "terminals" (pole insulator or ABC cable core, substation output, wire end at a service entry/house),
 * edges are span/service drop wires and pole jumpers.
 * A breadth-first search with a {feeder, role} label runs from each substation output.
 * A clamp with a known core set exposes every core as a terminal, so phases pass through ABC unchanged.
 * A legacy clamp without cores (and an ABC-type substation output) merges all cores of the bundle: labels passing
 * through it are marked as bundled — the feeder is known, but the specific phase is not.
 */
import type { Phase, Role, Scheme, SchemeLine, SchemeNode } from '../model/types';
import { isPole, isWired } from '../model/scheme';
import { coreMarkings, hasPolePort, polePorts, portMark } from '../model/sip';
import type { MessageKey } from '../i18n';

export interface Label {
  feederId: string;
  role: Role;
  /** The label passed through an ABC bundle: the phase is ambiguous. */
  bundled: boolean;
}

export interface ConductorTrace {
  /** Unambiguously traced roles (not passing through ABC). */
  roles: Role[];
  /** Roles that arrived only through an ABC bundle. */
  bundledRoles: Role[];
  feeders: string[];
  /** Different unambiguous roles reached the conductor — short circuit / scheme error. */
  conflict: boolean;
}

export type HouseStatus = 'ok' | 'sip' | 'phaseUnknown' | 'unconnected' | 'untraced' | 'conflict' | 'incomplete';

/** Pseudo-"feeder" for labels originating from manual insulator marking. */
export const MANUAL_FEEDER = '~manual';

export interface HouseTrace {
  status: HouseStatus;
  /** Phases unambiguously computed by tracing. */
  computedPhases: Phase[];
  /** Resulting phases: computed or set manually. */
  effectivePhases: Phase[];
  hasNeutral: boolean;
  feeders: string[];
  dropCount: number;
}

export type IssueLevel = 'error' | 'warning' | 'info';
export interface Issue {
  level: IssueLevel;
  /** Message key in the dictionary; the text is built at display time in the current language (see ui/issues.ts). */
  key: MessageKey;
  /**
   * Parameters. Special ones: node/from/to — node ids (replaced with the name), ins — insulator id of node `node`,
   * lineKind — line type. The rest are substituted as is.
   */
  params: Record<string, string | number>;
  targetId: string;
}

export interface FeederInfo {
  id: string;
  name: string;
  ktpId: string;
  ktpName: string;
}

export interface FeederStats {
  feeder: FeederInfo;
  single: Record<Phase, number>;
  three: number;
  unknown: number;
}

export type LampStatus = 'ok' | 'noPower' | 'noNeutral' | 'wrong';

export interface LampTrace {
  status: LampStatus;
  /** Role of the supply wire: L (lighting), a phase or "phase ?"; null — undetermined. */
  supply: Role | null;
  feeders: string[];
}

export interface TraceResult {
  ports: Map<string, ConductorTrace>;
  lamps: Map<string, LampTrace>;
  wires: Map<string, ConductorTrace>;
  houses: Map<string, HouseTrace>;
  feeders: Map<string, FeederInfo>;
  feederStats: FeederStats[];
  issues: Issue[];
  /** Terminal adjacency (for highlighting connected wires). */
  adjacency: Map<string, Edge[]>;
}

export interface Edge {
  to: string;
  /** Wire key `${lineId}/${wireId}`; null for a jumper. */
  wireKey: string | null;
}

export const portKey = (nodeId: string, portId: string): string => `${nodeId}#${portId}`;
export const wireKey = (lineId: string, wireId: string): string => `${lineId}/${wireId}`;
const consumerKey = (nodeId: string, lineId: string, wireId: string): string => `${nodeId}#~${lineId}~${wireId}`;

const PHASE_ORDER: Phase[] = ['A', 'B', 'C'];

function hasPort(node: SchemeNode, portId: string): boolean {
  if (node.kind === 'ktp') return node.feeders.some((f) => f.outputs.some((o) => o.id === portId));
  if (isPole(node)) return hasPolePort(node, portId);
  return false;
}

/** Terminal of the wire end, or null if the end is not attached. */
function endKey(node: SchemeNode, line: SchemeLine, wireId: string, portId: string | null): string | null {
  if (node.kind === 'entry' || node.kind === 'house') return consumerKey(node.id, line.id, wireId);
  if (portId === null || !hasPort(node, portId)) return null;
  return portKey(node.id, portId);
}

function summarize(labels: Label[] | undefined): ConductorTrace {
  const roles = new Set<Role>();
  const bundled = new Set<Role>();
  const feeders = new Set<string>();
  for (const l of labels ?? []) {
    (l.bundled ? bundled : roles).add(l.role);
    if (l.feederId !== MANUAL_FEEDER) feeders.add(l.feederId);
  }
  // "Unknown phase" is resolved if a specific phase reached the same wire.
  for (const set of [roles, bundled]) if (set.has('P') && PHASE_ORDER.some((p) => set.has(p))) set.delete('P');
  return {
    roles: [...roles],
    bundledRoles: [...bundled].filter((r) => !roles.has(r)),
    feeders: [...feeders],
    conflict: roles.size > 1,
  };
}

export function traceScheme(scheme: Scheme): TraceResult {
  const issues: Issue[] = [];
  const adjacency = new Map<string, Edge[]>();
  const bundlePorts = new Set<string>();
  const addEdge = (a: string, b: string, wk: string | null) => {
    if (!adjacency.has(a)) adjacency.set(a, []);
    if (!adjacency.has(b)) adjacency.set(b, []);
    adjacency.get(a)!.push({ to: b, wireKey: wk });
    adjacency.get(b)!.push({ to: a, wireKey: wk });
  };

  // --- Pole terminals and jumpers ---
  for (const node of Object.values(scheme.nodes)) {
    if (!isPole(node)) continue;
    for (const ins of node.insulators) {
      if (ins.type === 'sipClamp' && !coreMarkings(ins).length) bundlePorts.add(portKey(node.id, ins.id));
    }
    for (const j of node.jumpers) {
      if (!hasPort(node, j.a) || !hasPort(node, j.b)) continue;
      addEdge(portKey(node.id, j.a), portKey(node.id, j.b), null);
    }
  }

  // --- Wires ---
  const wireEnds = new Map<string, [string | null, string | null]>();
  const consumerEnds = new Map<string, string[]>(); // nodeId (service entry/house) -> terminals
  for (const line of Object.values(scheme.lines)) {
    const from = scheme.nodes[line.from];
    const to = scheme.nodes[line.to];
    if (!from || !to) {
      issues.push({ level: 'error', key: 'issue.lineNoNode', params: { lineKind: line.kind }, targetId: line.id });
      continue;
    }
    if (!isWired(line.kind)) continue;
    if (line.wires.length === 0) {
      issues.push({ level: 'warning', key: 'issue.lineNoWires', params: { lineKind: line.kind }, targetId: line.id });
    }
    let dangling = 0;
    for (const w of line.wires) {
      const a = endKey(from, line, w.id, w.fromPort);
      const b = endKey(to, line, w.id, w.toPort);
      const wk = wireKey(line.id, w.id);
      wireEnds.set(wk, [a, b]);
      for (const [node, key] of [[from, a], [to, b]] as const) {
        if (key && (node.kind === 'entry' || node.kind === 'house')) {
          if (!consumerEnds.has(node.id)) consumerEnds.set(node.id, []);
          consumerEnds.get(node.id)!.push(key);
        }
      }
      if (a && b) addEdge(a, b, wk);
      else dangling++;
    }
    if (dangling) {
      issues.push({
        level: 'warning',
        key: 'issue.danglingWires',
        params: { lineKind: line.kind, from: from.id, to: to.id, n: dangling },
        targetId: line.id,
      });
    }
  }

  // --- Traversal from substation outputs ---
  const feeders = new Map<string, FeederInfo>();
  const labels = new Map<string, Map<string, Label>>();
  const queue: [string, Label][] = [];
  const visit = (key: string, label: Label) => {
    const l = bundlePorts.has(key) && !label.bundled ? { ...label, bundled: true } : label;
    const id = `${l.feederId}|${l.role}|${l.bundled ? 1 : 0}`;
    let set = labels.get(key);
    if (!set) labels.set(key, (set = new Map()));
    if (set.has(id)) return;
    set.set(id, l);
    queue.push([key, l]);
  };

  for (const node of Object.values(scheme.nodes)) {
    if (node.kind !== 'ktp') continue;
    for (const f of node.feeders) {
      feeders.set(f.id, { id: f.id, name: f.name, ktpId: node.id, ktpName: node.name });
      for (const out of f.outputs) {
        const key = portKey(node.id, out.id);
        if (out.role === 'SIP') {
          bundlePorts.add(key);
          for (const role of ['A', 'B', 'C', 'N'] as Role[]) visit(key, { feederId: f.id, role, bundled: true });
        } else {
          visit(key, { feederId: f.id, role: out.role, bundled: false });
        }
      }
    }
  }
  // Manual marking: the insulator is an extra label source; the label propagates along the whole wire.
  const marks: { node: SchemeNode; insId: string; key: string; mark: Role }[] = [];
  for (const node of Object.values(scheme.nodes)) {
    if (!isPole(node)) continue;
    for (const portId of polePorts(node)) {
      const mark = portMark(node, portId);
      if (!mark) continue;
      const key = portKey(node.id, portId);
      marks.push({ node, insId: portId, key, mark });
      visit(key, { feederId: MANUAL_FEEDER, role: mark, bundled: false });
    }
  }

  while (queue.length) {
    const [key, label] = queue.shift()!;
    for (const e of adjacency.get(key) ?? []) visit(e.to, label);
  }

  const labelList = (key: string | null) => (key ? [...(labels.get(key)?.values() ?? [])] : []);

  // --- Terminals and wires ---
  const ports = new Map<string, ConductorTrace>();
  for (const key of labels.keys()) ports.set(key, summarize(labelList(key)));

  const wires = new Map<string, ConductorTrace>();
  for (const [wk, [a, b]] of wireEnds) wires.set(wk, summarize([...labelList(a), ...labelList(b)]));

  // Conflicts on poles: one report per node.
  for (const node of Object.values(scheme.nodes)) {
    if (!isPole(node) && node.kind !== 'ktp') continue;
    const shorts: string[] = [];
    const mixedFeeders = new Set<string>();
    const portIds = node.kind === 'ktp' ? node.feeders.flatMap((f) => f.outputs.map((o) => o.id)) : polePorts(node);
    for (const pid of portIds) {
      const key = portKey(node.id, pid);
      if (bundlePorts.has(key)) continue;
      const t = ports.get(key);
      if (!t) continue;
      if (t.conflict) shorts.push(t.roles.join('+'));
      const definite = labelList(key).filter((l) => !l.bundled && l.feederId !== MANUAL_FEEDER);
      const fs = new Set(definite.map((l) => l.feederId));
      if (fs.size > 1) fs.forEach((f) => mixedFeeders.add(feeders.get(f)?.name ?? f));
    }
    if (shorts.length) {
      issues.push({
        level: 'error',
        key: 'issue.short',
        params: { node: node.id, roles: [...new Set(shorts)].join(', ') },
        targetId: node.id,
      });
    }
    if (mixedFeeders.size) {
      issues.push({
        level: 'warning',
        key: 'issue.feedersMeet',
        params: { node: node.id, feeders: [...mixedFeeders].join(' + ') },
        targetId: node.id,
      });
    }
  }

  // Marking that contradicts tracing from the substation.
  for (const { node, insId, key, mark } of marks) {
    const traced = new Set(
      labelList(key)
        .filter((l) => l.feederId !== MANUAL_FEEDER && !l.bundled)
        .map((l) => l.role),
    );
    const agrees = traced.has(mark) || (mark === 'P' && PHASE_ORDER.some((p) => traced.has(p)));
    if (traced.size && !agrees) {
      issues.push({
        level: 'warning',
        key: 'issue.markMismatch',
        params: { node: node.id, ins: insId, mark, traced: [...traced].join(', ') },
        targetId: node.id,
      });
    }
  }

  // --- Luminaires ---
  const lamps = new Map<string, LampTrace>();
  for (const node of Object.values(scheme.nodes)) {
    if (!isPole(node)) continue;
    for (const lamp of node.lamps) {
      const supplyT = lamp.phasePort && hasPort(node, lamp.phasePort) ? ports.get(portKey(node.id, lamp.phasePort)) : undefined;
      const neutralT =
        lamp.neutralPort && hasPort(node, lamp.neutralPort) ? ports.get(portKey(node.id, lamp.neutralPort)) : undefined;
      const supply = supplyT && !supplyT.conflict && supplyT.roles.length === 1 ? supplyT.roles[0] : null;
      const hasN = !!neutralT && (neutralT.roles.includes('N') || neutralT.bundledRoles.includes('N'));
      const bundledSupply = !!supplyT && supplyT.roles.length === 0 && supplyT.bundledRoles.length > 0;
      let status: LampStatus;
      if (supply === 'N') status = 'wrong';
      else if (!supply && !bundledSupply) status = 'noPower';
      else if (!hasN) status = 'noNeutral';
      else status = 'ok';
      lamps.set(lamp.id, { status, supply, feeders: supplyT?.feeders ?? [] });
      if (status === 'wrong') {
        issues.push({ level: 'error', key: 'issue.lampFromNeutral', params: { node: node.id }, targetId: node.id });
      } else if (status === 'noPower') {
        issues.push({
          level: 'warning',
          key: lamp.phasePort ? 'issue.lampNoSupply' : 'issue.lampNotConnected',
          params: { node: node.id },
          targetId: node.id,
        });
      } else if (status === 'noNeutral') {
        issues.push({ level: 'warning', key: 'issue.lampNoNeutral', params: { node: node.id }, targetId: node.id });
      }
    }
  }

  // --- Houses ---
  const houses = new Map<string, HouseTrace>();
  const entriesOf = new Map<string, string[]>();
  for (const node of Object.values(scheme.nodes)) {
    if (node.kind !== 'entry') continue;
    if (!node.houseId || scheme.nodes[node.houseId]?.kind !== 'house') {
      issues.push({ level: 'warning', key: 'issue.entryNoHouse', params: {}, targetId: node.id });
      continue;
    }
    if (!entriesOf.has(node.houseId)) entriesOf.set(node.houseId, []);
    entriesOf.get(node.houseId)!.push(node.id);
  }

  const stats = new Map<string, FeederStats>();
  const statFor = (fid: string): FeederStats | null => {
    const info = feeders.get(fid);
    if (!info) return null;
    if (!stats.has(fid)) stats.set(fid, { feeder: info, single: { A: 0, B: 0, C: 0 }, three: 0, unknown: 0 });
    return stats.get(fid)!;
  };

  for (const house of Object.values(scheme.nodes)) {
    if (house.kind !== 'house') continue;
    const nodeIds = [house.id, ...(entriesOf.get(house.id) ?? [])];
    const keys = nodeIds.flatMap((id) => consumerEnds.get(id) ?? []);
    const dropCount = new Set(
      Object.values(scheme.lines)
        .filter((l) => l.kind === 'drop' && (nodeIds.includes(l.from) || nodeIds.includes(l.to)))
        .map((l) => l.id),
    ).size;
    const all = keys.flatMap(labelList);
    const t = summarize(all);
    const definite = PHASE_ORDER.filter((p) => t.roles.includes(p));
    const bundledPhases = PHASE_ORDER.filter((p) => t.bundledRoles.includes(p));
    const hasNeutral = t.roles.includes('N') || t.bundledRoles.includes('N');
    const title = house.id;
    const manual = house.manualPhase ? [house.manualPhase] : [];

    let status: HouseStatus;
    let effective: Phase[];
    if (dropCount === 0) {
      status = 'unconnected';
      effective = house.phaseMode === '3' ? [...PHASE_ORDER] : manual;
      issues.push({ level: 'info', key: 'issue.houseNoDrop', params: { node: title }, targetId: house.id });
    } else if (all.length === 0) {
      status = 'untraced';
      effective = house.phaseMode === '3' ? [...PHASE_ORDER] : manual;
      issues.push({ level: 'warning', key: 'issue.houseUntraced', params: { node: title }, targetId: house.id });
    } else if (house.phaseMode === '1') {
      if (definite.length === 1) {
        status = 'ok';
        effective = definite;
        if (house.manualPhase && house.manualPhase !== definite[0]) {
          issues.push({
            level: 'warning',
            key: 'issue.houseManualMismatch',
            params: { node: title, manual: house.manualPhase, traced: definite[0] },
            targetId: house.id,
          });
        }
      } else if (definite.length > 1) {
        status = 'conflict';
        effective = definite;
        issues.push({
          level: 'error',
          key: 'issue.houseSinglePhaseMulti',
          params: { node: title, phases: definite.join(', ') },
          targetId: house.id,
        });
      } else if (bundledPhases.length) {
        status = 'sip';
        effective = manual;
        if (!manual.length) {
          issues.push({ level: 'info', key: 'issue.houseSip', params: { node: title }, targetId: house.id });
        }
      } else if (t.roles.includes('P')) {
        status = 'phaseUnknown';
        effective = manual;
        if (!manual.length) {
          issues.push({ level: 'info', key: 'issue.housePhaseUnknown', params: { node: title }, targetId: house.id });
        }
      } else {
        status = 'untraced';
        effective = manual;
        issues.push({ level: 'warning', key: 'issue.houseNoPhase', params: { node: title }, targetId: house.id });
      }
    } else {
      effective = [...PHASE_ORDER];
      if (definite.length === 3) status = 'ok';
      else if (definite.length > 0) {
        status = 'incomplete';
        issues.push({
          level: 'warning',
          key: 'issue.houseIncomplete',
          params: { node: title, phases: definite.join(', ') },
          targetId: house.id,
        });
      } else if (bundledPhases.length) status = 'sip';
      else if (t.roles.includes('P')) status = 'phaseUnknown';
      else {
        status = 'untraced';
        issues.push({ level: 'warning', key: 'issue.houseNoPhase', params: { node: title }, targetId: house.id });
      }
    }
    if (all.length && !hasNeutral) {
      issues.push({ level: 'warning', key: 'issue.houseNoNeutral', params: { node: title }, targetId: house.id });
    }

    houses.set(house.id, {
      status,
      computedPhases: status === 'ok' || status === 'conflict' || status === 'incomplete' ? definite : [],
      effectivePhases: effective,
      hasNeutral,
      feeders: t.feeders,
      dropCount,
    });

    const fid = t.feeders[0];
    const s = fid ? statFor(fid) : null;
    if (s) {
      if (house.phaseMode === '3') s.three++;
      else if (effective.length === 1) s.single[effective[0]]++;
      else s.unknown++;
    }
  }

  const order: Record<IssueLevel, number> = { error: 0, warning: 1, info: 2 };
  issues.sort((a, b) => order[a.level] - order[b.level]);

  return {
    ports,
    lamps,
    wires,
    houses,
    feeders,
    feederStats: [...stats.values()],
    issues,
    adjacency,
  };
}

/**
 * Wires to highlight when a terminal is selected:
 * if the terminal is traced — all wires with the same phase of the same feeder along the entire length;
 * otherwise — the whole connected component of the terminal.
 */
export function highlightWires(trace: TraceResult, key: string): Set<string> {
  const result = new Set<string>();
  const t = trace.ports.get(key);
  // A manually marked wire not connected to a substation (unknown feeder) is highlighted by connectivity.
  if (t && t.roles.length && !t.conflict && t.feeders.length) {
    for (const [wk, wt] of trace.wires) {
      if (wt.roles.some((r) => t.roles.includes(r)) && wt.feeders.some((f) => t.feeders.includes(f))) result.add(wk);
    }
    return result;
  }
  const seen = new Set<string>([key]);
  const stack = [key];
  while (stack.length) {
    const k = stack.pop()!;
    for (const e of trace.adjacency.get(k) ?? []) {
      if (e.wireKey) result.add(e.wireKey);
      if (!seen.has(e.to)) {
        seen.add(e.to);
        stack.push(e.to);
      }
    }
  }
  return result;
}
