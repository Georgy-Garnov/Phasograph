import type {
  Feeder,
  HouseNode,
  Insulator,
  Lamp,
  InsulatorType,
  KtpNode,
  LineKind,
  LngLat,
  NodeKind,
  PoleNode,
  Role,
  Scheme,
  SchemeLine,
  SchemeNode,
  Side,
  Suspension,
  Wire,
} from './types';
import { WIRED_LINE_KINDS } from './constants';

let counter = 0;
export function uid(prefix: string): string {
  counter = (counter + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function emptyScheme(): Scheme {
  return { nodes: {}, lines: {} };
}

export function isPole(node: SchemeNode | undefined): node is PoleNode {
  return !!node && (node.kind === 'pole04' || node.kind === 'pole10' || node.kind === 'poleService');
}

export function isWired(kind: LineKind): boolean {
  return WIRED_LINE_KINDS.includes(kind);
}

export function makeFeeder(index: number): Feeder {
  const roles: Role[] = ['A', 'B', 'C', 'N', 'L'];
  return {
    id: uid('f'),
    name: `Фидер ${index}`,
    outputs: roles.map((role, i) => ({ id: uid('out'), index: i + 1, role })),
  };
}

export function createNode(kind: NodeKind, coords: LngLat): SchemeNode {
  const base = { id: uid(kind), coords, name: '', note: '' };
  switch (kind) {
    case 'ktp':
      return { ...base, kind, powerKva: '', feeders: [makeFeeder(1)] };
    case 'pole04':
    case 'pole10':
    case 'poleService':
      return { ...base, kind, number: '', insulators: [], jumpers: [], lamps: [], hasInternet: false };
    case 'entry':
      return { ...base, kind, houseId: null };
    case 'house':
      return {
        ...base,
        kind,
        contour: null,
        address: '',
        addressSource: null,
        meterNumber: '',
        phaseMode: '1',
        manualPhase: null,
      };
  }
}

// ---------- Geometry ----------

const EARTH_R = 6371008.8;

export function distanceMeters(a: LngLat, b: LngLat): number {
  const toRad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toRad;
  const dLng = (b[0] - a[0]) * toRad;
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * toRad) * Math.cos(b[1] * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(s));
}

export function centroid(points: LngLat[]): LngLat {
  const n = points.length;
  const sum = points.reduce<[number, number]>((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0]);
  return [sum[0] / n, sum[1] / n];
}

export function pointInPolygon(p: LngLat, poly: LngLat[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Closest position on the outline boundary to a point (for a service entry on the facade). */
export function nearestPointOnContour(p: LngLat, poly: LngLat[]): LngLat {
  const cos = Math.cos((p[1] * Math.PI) / 180);
  let best: LngLat = poly[0];
  let bestD = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    // Projection in a local planar system (longitude scaled by cos of latitude).
    const ax = a[0] * cos, ay = a[1], bx = b[0] * cos, by = b[1], px = p[0] * cos, py = p[1];
    const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / len2)) : 0;
    const q: LngLat = [(ax + t * (bx - ax)) / cos, ay + t * (by - ay)];
    const d = distanceMeters(p, q);
    if (d < bestD) {
      bestD = d;
      best = q;
    }
  }
  return best;
}

export function nearestNode(
  scheme: Scheme,
  coords: LngLat,
  kinds: NodeKind[],
  maxMeters: number,
): SchemeNode | null {
  let best: SchemeNode | null = null;
  let bestD = maxMeters;
  for (const node of Object.values(scheme.nodes)) {
    if (!kinds.includes(node.kind)) continue;
    if (node.kind === 'house' && node.contour && pointInPolygon(coords, node.contour)) return node;
    const d = distanceMeters(coords, node.coords);
    if (d <= bestD) {
      bestD = d;
      best = node;
    }
  }
  return best;
}

// ---------- Ports (insulators / substation outputs) ----------

const SIDE_ORDER: Record<Side, number> = { L: 0, C: 1, R: 2 };
/** Default side letters (Russian); the UI passes letters for the current language. */
export const SIDE_LETTERS: Record<Side, string> = { L: 'Л', C: 'Ц', R: 'П' };

/** Bottom to top; at the same height — left, center, right. */
export function sortInsulators(list: Insulator[]): Insulator[] {
  return [...list].sort((a, b) => a.position - b.position || SIDE_ORDER[a.side] - SIDE_ORDER[b.side]);
}

/** "L3" — side and number from the bottom. The type (ABC clamp) is shown separately by the UI. */
export function insulatorLabel(ins: Insulator, letters: Record<Side, string> = SIDE_LETTERS): string {
  return `${letters[ins.side]}${ins.position}`;
}

/**
 * The bottom-up number is shared by both sides of the pole: in a zigzag layout insulators go L1, R2, L3, R4, L5 —
 * each one higher than the previous. The same number on the left and right means a crossarm.
 */
export function nextPosition(pole: PoleNode): number {
  return pole.insulators.reduce((m, i) => Math.max(m, i.position), 0) + 1;
}

export function addInsulator(pole: PoleNode, side: Side, type: InsulatorType = 'pin'): Insulator {
  const ins: Insulator = { id: uid('ins'), side, position: nextPosition(pole), type };
  pole.insulators.push(ins);
  return ins;
}

/** Removes an insulator and detaches wires and jumpers from it. */
export function removeInsulator(scheme: Scheme, pole: PoleNode, insId: string): void {
  pole.insulators = pole.insulators.filter((i) => i.id !== insId);
  pole.jumpers = pole.jumpers.filter((j) => j.a !== insId && j.b !== insId);
  for (const lamp of pole.lamps) {
    if (lamp.phasePort === insId) lamp.phasePort = null;
    if (lamp.neutralPort === insId) lamp.neutralPort = null;
  }
  detachPort(scheme, pole.id, insId);
}

export function detachPort(scheme: Scheme, nodeId: string, portId: string): void {
  for (const line of Object.values(scheme.lines)) {
    for (const w of line.wires) {
      if (line.from === nodeId && w.fromPort === portId) w.fromPort = null;
      if (line.to === nodeId && w.toPort === portId) w.toPort = null;
    }
  }
}

export function linesAt(scheme: Scheme, nodeId: string): SchemeLine[] {
  return Object.values(scheme.lines).filter((l) => l.from === nodeId || l.to === nodeId);
}

/** House the node belongs to (the house itself or the house of a service entry). */
export function houseOf(scheme: Scheme, nodeId: string): HouseNode | null {
  const node = scheme.nodes[nodeId];
  if (!node) return null;
  if (node.kind === 'house') return node;
  if (node.kind === 'entry' && node.houseId) {
    const h = scheme.nodes[node.houseId];
    return h?.kind === 'house' ? h : null;
  }
  return null;
}

// ---------- Deletion ----------

export function deleteNode(scheme: Scheme, id: string): void {
  delete scheme.nodes[id];
  for (const line of Object.values(scheme.lines)) {
    if (line.from === id || line.to === id) delete scheme.lines[line.id];
  }
  for (const node of Object.values(scheme.nodes)) {
    if (node.kind === 'entry' && node.houseId === id) node.houseId = null;
  }
}

export function deleteLine(scheme: Scheme, id: string): void {
  delete scheme.lines[id];
}

// ---------- Line creation with automatic wire layout ----------

function usedKtpOutputs(scheme: Scheme, ktpId: string): Set<string> {
  const used = new Set<string>();
  for (const line of linesAt(scheme, ktpId)) {
    for (const w of line.wires) {
      if (line.from === ktpId && w.fromPort) used.add(w.fromPort);
      if (line.to === ktpId && w.toPort) used.add(w.toPort);
    }
  }
  return used;
}

/** Picks the first substation feeder whose outputs are not yet used by lines. */
export function pickFreeFeeder(scheme: Scheme, ktp: KtpNode): Feeder | undefined {
  const used = usedKtpOutputs(scheme, ktp.id);
  return ktp.feeders.find((f) => f.outputs.every((o) => !used.has(o.id))) ?? ktp.feeders[0];
}

/** Source ports on the start node of a new line. */
function sourcePorts(scheme: Scheme, kind: LineKind, suspension: Suspension, from: SchemeNode): (string | null)[] {
  if (from.kind === 'ktp') {
    const feeder = pickFreeFeeder(scheme, from);
    if (!feeder) return [];
    if (kind === 'lighting') return feeder.outputs.filter((o) => o.role === 'L').map((o) => o.id);
    const sip = feeder.outputs.filter((o) => o.role === 'SIP');
    if (suspension === 'sip' && sip.length) return sip.map((o) => o.id);
    return feeder.outputs.filter((o) => o.role !== 'SIP').map((o) => o.id);
  }
  if (!isPole(from)) return [];
  if (kind === 'lighting') {
    // Continue the lighting wire from the same insulator the lighting line arrived on.
    const ports = new Set<string>();
    for (const l of linesAt(scheme, from.id)) {
      if (l.kind !== 'lighting') continue;
      for (const w of l.wires) {
        const p = l.from === from.id ? w.fromPort : w.toPort;
        if (p) ports.add(p);
      }
    }
    // Separate lighting wire: a new insulator on the right (connected to the luminaire phase by a jumper).
    return ports.size ? [...ports] : [addInsulator(from, 'R').id];
  }
  if (suspension === 'sip') {
    const clamp = from.insulators.find((i) => i.type === 'sipClamp') ?? addInsulator(from, 'R', 'sipClamp');
    return [clamp.id];
  }
  const pins = sortInsulators(from.insulators.filter((i) => i.type === 'pin'));
  // The main line starts from an "empty" pole: place a standard crossarm (A, B, C, N, lighting).
  return pins.length ? pins.map((i) => i.id) : addDefaultPins(from, DEFAULT_WIRE_COUNT);
}

/** Standard wire count of a 0.4 kV overhead line: three phases, neutral and lighting. */
export const DEFAULT_WIRE_COUNT = 5;

/** Lays out n insulators in a zigzag: L1, R2, L3, R4, L5… */
export function addDefaultPins(pole: PoleNode, n: number): string[] {
  return Array.from({ length: n }, (_, i) => addInsulator(pole, zigzagSide(i)).id);
}

const zigzagSide = (i: number): Side => (i % 2 === 0 ? 'L' : 'R');

function dropWireCount(scheme: Scheme, toId: string): number {
  const house = houseOf(scheme, toId);
  return house?.phaseMode === '3' ? 4 : 2;
}

/**
 * Creates a span/service drop between two nodes and lays out the wires:
 * copies the insulator arrangement from the previous pole (or the substation feeder outputs),
 * creating missing insulators on the end pole.
 */
export function createLine(
  scheme: Scheme,
  kind: LineKind,
  fromId: string,
  toId: string,
  suspension: Suspension,
): SchemeLine {
  // The substation is always at the start of the line — this keeps tracing and the UI simpler.
  if (scheme.nodes[toId]?.kind === 'ktp' && scheme.nodes[fromId]?.kind !== 'ktp') [fromId, toId] = [toId, fromId];
  const from = scheme.nodes[fromId];
  const to = scheme.nodes[toId];
  const line: SchemeLine = { id: uid('ln'), kind, from: fromId, to: toId, suspension, wires: [], mark: '', note: '' };
  scheme.lines[line.id] = line;
  if (!isWired(kind) || !from || !to) return line;

  let src: (string | null)[];
  if (kind === 'drop') {
    const n = dropWireCount(scheme, toId);
    if (isPole(from) && from.insulators.length && from.insulators.every((i) => i.type === 'sipClamp')) {
      src = Array(n).fill(from.insulators[0].id);
    } else if (from.kind === 'poleService' && from.insulators.length) {
      src = sortInsulators(from.insulators).map((i) => i.id);
    } else {
      src = Array(n).fill(null); // the operator will pick insulators in the service drop editor
    }
  } else {
    src = sourcePorts(scheme, kind, suspension, from);
  }

  const targetPorts = mapTargetPorts(scheme, from, to, src, suspension, kind);
  line.wires = src.map((fromPort, i) => ({ id: uid('w'), fromPort, toPort: targetPorts[i] }));
  return line;
}

function mapTargetPorts(
  scheme: Scheme,
  from: SchemeNode,
  to: SchemeNode,
  src: (string | null)[],
  suspension: Suspension,
  kind: LineKind,
): (string | null)[] {
  if (!isPole(to)) return src.map(() => null);

  if (suspension === 'sip' && kind !== 'drop') {
    const clamp = to.insulators.find((i) => i.type === 'sipClamp') ?? addInsulator(to, 'R', 'sipClamp');
    return src.map(() => clamp.id);
  }

  // Insulators already used by parallel lines between the same nodes (shared suspension of feeders).
  const occupied = new Set<string>();
  for (const l of Object.values(scheme.lines)) {
    const same = (l.from === from.id && l.to === to.id) || (l.from === to.id && l.to === from.id);
    if (!same || !isWired(l.kind)) continue;
    for (const w of l.wires) {
      const p = l.to === to.id ? w.toPort : w.fromPort;
      if (p) occupied.add(p);
    }
  }
  const pins = sortInsulators(to.insulators.filter((i) => i.type === 'pin' && !occupied.has(i.id)));
  const srcIns = (p: string | null): Insulator | undefined =>
    isPole(from) && p ? from.insulators.find((i) => i.id === p) : undefined;

  if (pins.length === 0) {
    // Create insulators mirroring the previous pole (or laying out substation outputs in a zigzag).
    const fresh = to.insulators.length === 0;
    return src.map((p, i) => {
      const s = srcIns(p);
      const side: Side = s?.side ?? zigzagSide(i);
      let position = s?.position ?? i + 1;
      if (!fresh || to.insulators.some((x) => x.side === side && x.position === position)) {
        position = nextPosition(to);
      }
      const ins: Insulator = { id: uid('ins'), side, position, type: 'pin' };
      to.insulators.push(ins);
      return ins.id;
    });
  }

  // The pole already has insulators: match by side/number first, otherwise by order.
  const taken = new Set<string>();
  const result = src.map((p) => {
    const s = srcIns(p);
    const match = s && pins.find((i) => i.side === s.side && i.position === s.position && !taken.has(i.id));
    if (match) taken.add(match.id);
    return match ? match.id : null;
  });
  if (pins.length === src.length) {
    const free = pins.filter((i) => !taken.has(i.id));
    return result.map((r) => r ?? free.shift()?.id ?? null);
  }
  return result;
}

export function addWire(line: SchemeLine): Wire {
  const w: Wire = { id: uid('w'), fromPort: null, toPort: null };
  line.wires.push(w);
  return w;
}

/**
 * Lays out span wires "by position": a wire from insulator L2 of the start pole
 * arrives at L2 of the end pole. Missing insulators on the end pole are created.
 */
export function mapWiresByPosition(scheme: Scheme, line: SchemeLine): void {
  const from = scheme.nodes[line.from];
  const to = scheme.nodes[line.to];
  if (!isPole(to)) return;
  for (const w of line.wires) {
    const src = isPole(from) ? from.insulators.find((i) => i.id === w.fromPort) : undefined;
    if (!src) continue;
    let target = to.insulators.find((i) => i.side === src.side && i.position === src.position);
    if (!target) {
      target = { id: uid('ins'), side: src.side, position: src.position, type: src.type };
      to.insulators.push(target);
    }
    w.toPort = target.id;
  }
}

/** Reassigns the starts of span wires from the substation to the outputs of the given feeder (in order). */
export function assignFeeder(scheme: Scheme, line: SchemeLine, feederId: string): void {
  const ktp = scheme.nodes[line.from];
  if (ktp?.kind !== 'ktp') return;
  const feeder = ktp.feeders.find((f) => f.id === feederId);
  if (!feeder) return;
  const outs = feeder.outputs.filter((o) => (line.suspension === 'sip' ? true : o.role !== 'SIP'));
  outs.forEach((o, i) => {
    const w = line.wires[i] ?? addWire(line);
    w.fromPort = o.id;
  });
}

/**
 * Renumbers pole insulators in a zigzag: L1, R2, L3, R4, L5…
 * Order is "left ones bottom to top, then right ones" — that is how poles were laid out in the old format
 * (L1–L3 = A, B, C; R1–R2 = N, lighting). Wires stay on the same insulators. ABC clamps are placed above.
 */
export function layoutZigzag(pole: PoleNode): void {
  const legacyOrder = (list: Insulator[]) =>
    [...list].sort((a, b) => (a.side === b.side ? a.position - b.position : a.side === 'L' ? -1 : 1));
  // Center insulators (a branch on a T-pole) are left untouched.
  const sideIns = pole.insulators.filter((i) => i.side !== 'C');
  const pins = legacyOrder(sideIns.filter((i) => i.type === 'pin'));
  const clamps = legacyOrder(sideIns.filter((i) => i.type === 'sipClamp'));
  pins.forEach((ins, i) => {
    ins.side = zigzagSide(i);
    ins.position = i + 1;
  });
  clamps.forEach((ins, i) => {
    ins.position = pins.length + i + 1;
  });
}

/** Side insulators of the pole are already in a zigzag (no two at the same height); center ones are ignored. */
export function isZigzag(pole: PoleNode): boolean {
  const levels = pole.insulators.filter((i) => i.side !== 'C').map((i) => i.position);
  return new Set(levels).size === levels.length;
}

/**
 * Adds a luminaire to a pole. The connection is chosen by insulator roles (tracing or manual marking):
 * supply — from the lighting wire (L), otherwise unset; neutral — from the N insulator.
 */
export function addLamp(pole: PoleNode, roleOf: (insulatorId: string) => Role | null): Lamp {
  const find = (role: Role) => pole.insulators.find((i) => roleOf(i.id) === role)?.id ?? null;
  const lamp: Lamp = { id: uid('lamp'), kind: 'led', powerW: '', phasePort: find('L'), neutralPort: find('N') };
  pole.lamps.push(lamp);
  return lamp;
}
