/**
 * Scheme import/export in GeoJSON.
 *
 * Each node is a Feature with Point geometry (a house with an outline — Polygon),
 * each line is a LineString between the coordinates of its nodes.
 * Links and attributes are stored in properties:
 *   node:  { kind, id, ...node attributes }      (for a house with an outline — also anchor: [lng, lat])
 *   line:  { kind, id, from, to, suspension, wires: [{id, fromPort, toPort}], mark }
 * Tracing results are exported to properties.trace (ignored on import).
 */
import type { LineKind, LngLat, MapView, NodeKind, Role, Scheme, SchemeLine, SchemeNode } from './types';
import { centroid, createNode, distanceMeters, emptyScheme, normalizeAngle } from './scheme';
import type { TraceResult } from '../topology/trace';
import { wireKey } from '../topology/trace';

export const FORMAT = 'electro-grid-scheme';
export const FORMAT_VERSION = 1;

const ROLES: Role[] = ['A', 'B', 'C', 'N', 'L', 'P'];
const NODE_KINDS: NodeKind[] = ['ktp', 'pole10', 'pole04', 'poleService', 'entry', 'house'];
const LINE_KINDS: LineKind[] = ['line10', 'line04', 'drop', 'lighting', 'fiber'];

type Json = Record<string, unknown>;

interface GeoFeature {
  type: 'Feature';
  id: string;
  geometry:
    | { type: 'Point'; coordinates: LngLat }
    | { type: 'LineString'; coordinates: LngLat[] }
    | { type: 'Polygon'; coordinates: LngLat[][] };
  properties: Json;
}

export interface GeoCollection {
  type: 'FeatureCollection';
  format: string;
  version: number;
  /** Project name. */
  name?: string;
  view?: MapView;
  features: GeoFeature[];
}

/** Reference to an object photo in the ZIP archive: properties.photos = [{ id, file, caption, createdAt }]. */
export interface PhotoRef {
  id: string;
  /** Path inside the archive, e.g. "photos/photo_1.jpg". */
  file: string;
  caption: string;
  createdAt: number;
}

export interface ExportOptions {
  trace?: TraceResult;
  view?: MapView;
  name?: string;
  /** Photos by object id — ZIP archive only. */
  photos?: Map<string, PhotoRef[]>;
}

export function exportGeoJSON(scheme: Scheme, trace?: TraceResult, view?: MapView, extra: Omit<ExportOptions, 'trace' | 'view'> = {}): GeoCollection {
  const features: GeoFeature[] = [];
  for (const node of Object.values(scheme.nodes)) {
    const { coords, ...props } = node;
    const properties: Json = { ...props };
    const photos = extra.photos?.get(node.id);
    if (photos?.length) properties.photos = photos;
    if (node.kind === 'house') {
      delete properties.contour;
      const h = trace?.houses.get(node.id);
      if (h) properties.trace = h;
    }
    const geometry: GeoFeature['geometry'] =
      node.kind === 'house' && node.contour && node.contour.length >= 3
        ? { type: 'Polygon', coordinates: [[...node.contour, node.contour[0]]] }
        : { type: 'Point', coordinates: coords };
    if (geometry.type === 'Polygon') properties.anchor = coords;
    features.push({ type: 'Feature', id: node.id, geometry, properties });
  }
  for (const line of Object.values(scheme.lines)) {
    const a = scheme.nodes[line.from];
    const b = scheme.nodes[line.to];
    if (!a || !b) continue;
    const properties: Json = { ...line };
    if (trace) {
      properties.wires = line.wires.map((w) => ({ ...w, trace: trace.wires.get(wireKey(line.id, w.id)) }));
    }
    features.push({
      type: 'Feature',
      id: line.id,
      geometry: { type: 'LineString', coordinates: [a.coords, b.coords] },
      properties,
    });
  }
  return { type: 'FeatureCollection', format: FORMAT, version: FORMAT_VERSION, name: extra.name, view, features };
}

const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : v == null ? d : String(v));
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const isLngLat = (v: unknown): v is LngLat =>
  Array.isArray(v) && v.length >= 2 && typeof v[0] === 'number' && typeof v[1] === 'number';

export interface ImportResult {
  scheme: Scheme;
  view?: MapView;
  name?: string;
  /** Object photo references (from the ZIP archive). */
  photos: (PhotoRef & { nodeId: string })[];
  warnings: string[];
}

/** Parses GeoJSON. Accepts both the native format and "foreign" points/lines with properties.kind. */
export function importGeoJSON(input: unknown): ImportResult {
  const warnings: string[] = [];
  const scheme = emptyScheme();
  const data = input as Partial<GeoCollection>;
  if (!data || data.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
    throw new Error('Expected a GeoJSON FeatureCollection');
  }
  const pendingLines: { f: GeoFeature; p: Json }[] = [];
  const photos: ImportResult['photos'] = [];

  for (const f of data.features as GeoFeature[]) {
    const p = (f.properties ?? {}) as Json;
    const kind = p.kind as string;
    if (LINE_KINDS.includes(kind as LineKind) && f.geometry?.type === 'LineString') {
      pendingLines.push({ f, p });
      continue;
    }
    if (!NODE_KINDS.includes(kind as NodeKind)) {
      warnings.push(`Skipped object ${f.id ?? ''}: unknown kind "${kind}"`);
      continue;
    }
    let coords: LngLat | null = null;
    let contour: LngLat[] | null = null;
    if (f.geometry?.type === 'Point' && isLngLat(f.geometry.coordinates)) coords = f.geometry.coordinates;
    if (f.geometry?.type === 'Polygon') {
      const ring = arr<LngLat>(f.geometry.coordinates[0]).filter(isLngLat);
      if (ring.length > 3) contour = ring.slice(0, -1);
      coords = isLngLat(p.anchor) ? p.anchor : contour ? centroid(contour) : null;
    }
    if (!coords) {
      warnings.push(`Skipped object ${f.id ?? ''}: no coordinates`);
      continue;
    }
    const base = createNode(kind as NodeKind, coords);
    const id = str(p.id ?? f.id, base.id);
    const { trace: _t, anchor: _a, photos: rawPhotos, ...rest } = p;
    const node = { ...base, ...rest, id, kind, coords } as SchemeNode;
    if (node.kind === 'house') node.contour = contour;
    sanitizeNode(node);
    scheme.nodes[id] = node;
    for (const ph of arr<Json>(rawPhotos)) {
      if (typeof ph.file !== 'string') continue;
      photos.push({
        nodeId: id,
        id: str(ph.id, `photo_${photos.length + 1}`),
        file: ph.file,
        caption: str(ph.caption),
        createdAt: Number(ph.createdAt) || Date.now(),
      });
    }
  }

  for (const { f, p } of pendingLines) {
    const coords = arr<LngLat>((f.geometry as { coordinates: LngLat[] }).coordinates).filter(isLngLat);
    let from = str(p.from);
    let to = str(p.to);
    if (!scheme.nodes[from] && coords.length) from = snap(scheme, coords[0]) ?? '';
    if (!scheme.nodes[to] && coords.length) to = snap(scheme, coords[coords.length - 1]) ?? '';
    if (!from || !to || from === to) {
      warnings.push(`Skipped line ${f.id ?? ''}: ends are not attached to nodes`);
      continue;
    }
    const id = str(p.id ?? f.id) || `ln_${Object.keys(scheme.lines).length + 1}`;
    const line: SchemeLine = {
      id,
      kind: p.kind as LineKind,
      from,
      to,
      suspension: p.suspension === 'sip' ? 'sip' : 'bare',
      wires: arr<Json>(p.wires).map((w, i) => ({
        id: str(w.id, `w${i + 1}`),
        fromPort: w.fromPort == null ? null : str(w.fromPort),
        toPort: w.toPort == null ? null : str(w.toPort),
      })),
      mark: str(p.mark),
      note: str(p.note),
    };
    scheme.lines[id] = line;
  }
  const view = data.view && isLngLat(data.view.center) ? data.view : undefined;
  return { scheme, view, name: typeof data.name === 'string' ? data.name : undefined, photos, warnings };
}

function snap(scheme: Scheme, c: LngLat): string | null {
  let best: string | null = null;
  let bestD = 3;
  for (const n of Object.values(scheme.nodes)) {
    const d = distanceMeters(n.coords, c);
    if (d < bestD) {
      bestD = d;
      best = n.id;
    }
  }
  return best;
}

function sanitizeNode(node: SchemeNode): void {
  node.name = str(node.name);
  node.note = str(node.note);
  switch (node.kind) {
    case 'ktp':
      node.feeders = arr<Json>(node.feeders).map((f, fi) => ({
        id: str(f.id, `f${fi + 1}`),
        name: str(f.name, `Фидер ${fi + 1}`),
        outputs: arr<Json>(f.outputs).map((o, oi) => ({
          id: str(o.id, `f${fi + 1}o${oi + 1}`),
          index: Number(o.index) || oi + 1,
          role: (['A', 'B', 'C', 'N', 'L', 'SIP'].includes(o.role as string) ? o.role : 'N') as never,
        })),
      }));
      break;
    case 'pole04':
    case 'pole10':
    case 'poleService':
      node.number = str(node.number);
      node.insulators = arr<Json>(node.insulators).map((i, k) => ({
        id: str(i.id, `ins${k + 1}`),
        side: i.side === 'R' || i.side === 'C' || i.side === 'B' ? i.side : 'L',
        position: Number(i.position) || k + 1,
        type: i.type === 'sipClamp' ? 'sipClamp' : 'pin',
        ...(ROLES.includes(i.mark as Role) ? { mark: i.mark as Role } : {}),
      }));
      node.jumpers = arr<Json>(node.jumpers).map((j, k) => ({ id: str(j.id, `j${k + 1}`), a: str(j.a), b: str(j.b) }));
      node.lamps = arr<Json>(node.lamps).map((l, k) => ({
        id: str(l.id, `lamp${k + 1}`),
        kind: (['led', 'dnat', 'drl', 'other'] as const).find((x) => x === l.kind) ?? 'other',
        powerW: str(l.powerW),
        phasePort: l.phasePort ? str(l.phasePort) : null,
        neutralPort: l.neutralPort ? str(l.neutralPort) : null,
      }));
      // Old format: the "Lighting" checkbox → a single luminaire without a connection.
      if ((node as unknown as Json).hasLighting && node.lamps.length === 0) {
        node.lamps.push({ id: `${node.id}_lamp`, kind: 'other', powerW: '', phasePort: null, neutralPort: null });
      }
      delete (node as unknown as Json).hasLighting;
      node.hasInternet = !!node.hasInternet;
      node.fiberBox = !!node.fiberBox;
      node.azimuth = Number.isFinite(Number(node.azimuth)) && node.azimuth !== null ? normalizeAngle(Number(node.azimuth)) : null;
      break;
    case 'entry':
      node.houseId = node.houseId ? str(node.houseId) : null;
      break;
    case 'house':
      node.address = str(node.address);
      node.meterNumber = str(node.meterNumber);
      node.phaseMode = node.phaseMode === '3' ? '3' : '1';
      node.manualPhase = (['A', 'B', 'C'] as const).find((p) => p === node.manualPhase) ?? null;
      node.addressSource = node.addressSource === 'geocoder' || node.addressSource === 'manual' ? node.addressSource : null;
      break;
  }
}
