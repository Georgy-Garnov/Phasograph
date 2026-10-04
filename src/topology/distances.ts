/** Line lengths and network distances computed from node coordinates. */
import type { LineKind, Scheme, SchemeLine } from '../model/types';
import { distanceMeters } from '../model/scheme';
import { wireKey, type TraceResult } from './trace';

/** 0.4 kV network lines used to compute the path to the substation. */
const NETWORK_KINDS: LineKind[] = ['line04', 'drop', 'lighting'];

export function lineLength(scheme: Scheme, line: SchemeLine): number {
  const a = scheme.nodes[line.from];
  const b = scheme.nodes[line.to];
  return a && b ? distanceMeters(a.coords, b.coords) : 0;
}

export interface KtpDistance {
  /** Path length along the wires to the nearest substation, m. */
  meters: number;
  ktpId: string;
}

/**
 * Shortest path over the 0.4 kV network from each node to the nearest substation (Dijkstra from all substations at once).
 * A house connected via a service entry gets the distance of its service entry.
 */
export function distancesToKtp(scheme: Scheme): Map<string, KtpDistance> {
  const adj = new Map<string, { to: string; w: number }[]>();
  const link = (a: string, b: string, w: number) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a)!.push({ to: b, w });
  };
  for (const line of Object.values(scheme.lines)) {
    if (!NETWORK_KINDS.includes(line.kind)) continue;
    const w = lineLength(scheme, line);
    link(line.from, line.to, w);
    link(line.to, line.from, w);
  }

  const result = new Map<string, KtpDistance>();
  const queue: { id: string; d: number; ktpId: string }[] = [];
  for (const n of Object.values(scheme.nodes)) {
    if (n.kind === 'ktp') queue.push({ id: n.id, d: 0, ktpId: n.id });
  }
  // For networks of hundreds of nodes a simple sorted queue is enough.
  while (queue.length) {
    queue.sort((x, y) => x.d - y.d);
    const cur = queue.shift()!;
    if (result.has(cur.id)) continue;
    result.set(cur.id, { meters: cur.d, ktpId: cur.ktpId });
    for (const e of adj.get(cur.id) ?? []) {
      if (!result.has(e.to)) queue.push({ id: e.to, d: cur.d + e.w, ktpId: cur.ktpId });
    }
  }

  for (const n of Object.values(scheme.nodes)) {
    if (n.kind !== 'entry' || !n.houseId) continue;
    const d = result.get(n.id);
    const cur = result.get(n.houseId);
    if (d && (!cur || d.meters < cur.meters)) result.set(n.houseId, d);
  }
  return result;
}

export interface FeederLength {
  /** Main line and lighting, m. */
  main: number;
  /** Service drops, m. */
  drops: number;
}

/** Line length of each feeder (based on tracing results). */
export function feederLengths(scheme: Scheme, trace: TraceResult): Map<string, FeederLength> {
  const result = new Map<string, FeederLength>();
  for (const line of Object.values(scheme.lines)) {
    const feeders = new Set(line.wires.flatMap((w) => trace.wires.get(wireKey(line.id, w.id))?.feeders ?? []));
    const len = lineLength(scheme, line);
    for (const f of feeders) {
      if (!result.has(f)) result.set(f, { main: 0, drops: 0 });
      const r = result.get(f)!;
      if (line.kind === 'drop') r.drops += len;
      else r.main += len;
    }
  }
  return result;
}

const cache = new WeakMap<Scheme, Map<string, KtpDistance>>();

/** Distances to the substation, cached per immutable scheme object. */
export function cachedDistances(scheme: Scheme): Map<string, KtpDistance> {
  let d = cache.get(scheme);
  if (!d) cache.set(scheme, (d = distancesToKtp(scheme)));
  return d;
}
