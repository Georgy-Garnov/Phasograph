/**
 * Scene: a provider-independent description of what to draw on the map.
 * Adapters (Leaflet, Yandex) just apply it by comparing object "signatures".
 */
import type { AppState } from '../model/store';
import type { LngLat, SchemeLine, SchemeNode, Wire } from '../model/types';
import { COLOR_BUNDLE, COLOR_CONFLICT, COLOR_UNTRACED, LINE_STYLES, ROLE_COLORS } from '../model/constants';
import { isPole, isWired, sortInsulators } from '../model/scheme';
import { wireKey, type ConductorTrace, type TraceResult } from '../topology/trace';
import { metersPerPixel, offsetSegment } from './geo';
import { t } from '../i18n';

/** Below this zoom parallel wires are drawn closer together. */
const DENSE_ZOOM = 16;

export interface Stroke {
  color: string;
  width: number;
  dash?: number[];
  opacity?: number;
}

export type FeatureTarget = { type: 'line'; id: string; wireId: string | null } | { type: 'node'; id: string };

export interface FeatureSpec {
  geometry: { type: 'LineString'; coordinates: LngLat[] } | { type: 'Polygon'; coordinates: LngLat[][] };
  stroke: Stroke;
  fill?: string;
  /** Draw order: higher is on top. */
  zIndex: number;
  /** Object selected by click; null — non-interactive. */
  target: FeatureTarget | null;
}

export interface MarkerSpec {
  id: string;
  coords: LngLat;
  className: string;
  html: string;
  title: string;
  draggable: boolean;
  zIndex: number;
}

export interface Scene {
  markers: MarkerSpec[];
  features: Map<string, FeatureSpec>;
}

export function conductorColor(t: ConductorTrace | undefined): string {
  if (!t) return COLOR_UNTRACED;
  if (t.conflict) return COLOR_CONFLICT;
  if (t.roles.length === 1) return ROLE_COLORS[t.roles[0]];
  if (t.bundledRoles.length) return COLOR_BUNDLE;
  return COLOR_UNTRACED;
}

const NODE_ICONS: Partial<Record<SchemeNode['kind'], string>> = {
  ktp: '<svg viewBox="0 0 24 24"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>',
  house: '<svg viewBox="0 0 24 24"><path d="M12 3 2 12h3v8h6v-6h2v6h6v-8h3z"/></svg>',
};

export function buildScene(state: AppState, highlighted: Set<string>, zoom: number): Scene {
  const features = new Map<string, FeatureSpec>();
  collectLines(state, highlighted, zoom, features);
  collectContours(state, features);
  return { markers: buildMarkers(state), features };
}

/** Temporary drawing objects: rubber-band line and house outline. */
export function buildPreview(state: AppState, cursor: LngLat | null): Map<string, FeatureSpec> {
  const specs = new Map<string, FeatureSpec>();
  const stroke: Stroke = { color: '#008cff', width: 2, dash: [4, 4] };
  const start = state.lineStart ? state.scheme.nodes[state.lineStart] : null;
  if (start && cursor) {
    specs.set('preview:line', {
      geometry: { type: 'LineString', coordinates: [start.coords, cursor] },
      stroke,
      zIndex: 300,
      target: null,
    });
  }
  if (state.contour.length) {
    const pts = cursor ? [...state.contour, cursor] : state.contour;
    specs.set('preview:contour', {
      geometry: { type: 'LineString', coordinates: [...pts, pts[0]] },
      stroke,
      zIndex: 300,
      target: null,
    });
  }
  return specs;
}

function buildMarkers(state: AppState): MarkerSpec[] {
  const { scheme, selection, lineStart, tool, trace } = state;
  const photoCounts = new Map<string, number>();
  for (const p of state.photos ?? []) photoCounts.set(p.nodeId, (photoCounts.get(p.nodeId) ?? 0) + 1);
  return Object.values(scheme.nodes).map((node) => {
    const classes = ['node', `node-${node.kind}`];
    if (selection?.type === 'node' && selection.id === node.id) classes.push('selected');
    if (lineStart === node.id) classes.push('line-start');
    let badge = '';
    if (node.kind === 'house') {
      const h = trace.houses.get(node.id);
      const phases = h?.effectivePhases ?? [];
      if (node.phaseMode === '3') badge = t('scene.three');
      else if (phases.length === 1) {
        badge = phases[0];
        classes.push(`phase-${phases[0]}`);
      } else badge = '?';
      if (h?.status === 'conflict') classes.push('conflict');
      if (h && h.status !== 'ok' && h.computedPhases.length === 0) classes.push('manual');
    }
    if (isPole(node) && node.number) badge = node.number;
    let lampHtml = '';
    if (isPole(node) && node.lamps.length) {
      const off = node.lamps.some((l) => trace.lamps.get(l.id)?.status !== 'ok');
      classes.push('has-lamp');
      lampHtml = `<span class="lamp${off ? ' lamp-off' : ''}" title="${escapeHtml(t('scene.lamps', { n: node.lamps.length }))}">✹${node.lamps.length > 1 ? node.lamps.length : ''}</span>`;
    }
    const photoCount = photoCounts.get(node.id) ?? 0;
    const photoHtml = photoCount
      ? `<span class="photo-mark" title="${escapeHtml(t('scene.photos', { n: photoCount }))}">📷</span>`
      : '';
    return {
      id: node.id,
      coords: node.coords,
      className: classes.join(' '),
      html: `${NODE_ICONS[node.kind] ?? ''}${badge ? `<span class="badge">${escapeHtml(badge)}</span>` : ''}${lampHtml}${photoHtml}`,
      title: node.kind === 'house' ? node.address || node.name : node.name,
      draggable: tool.type === 'select',
      zIndex: node.kind === 'house' ? 10 : 20,
    };
  });
}

function collectLines(state: AppState, highlighted: Set<string>, zoom: number, specs: Map<string, FeatureSpec>) {
  const { scheme, selection, trace } = state;
  const dim = highlighted.size > 0;
  for (const line of Object.values(scheme.lines)) {
    const a = scheme.nodes[line.from];
    const b = scheme.nodes[line.to];
    if (!a || !b) continue;
    const base = LINE_STYLES[line.kind];
    const selected = selection?.type === 'line' && selection.id === line.id;
    const target: FeatureTarget = { type: 'line', id: line.id, wireId: null };
    const coords: LngLat[] = [a.coords, b.coords];

    // Invisible wide line for easier click hits + selection highlight.
    specs.set(`hit:${line.id}`, {
      geometry: { type: 'LineString', coordinates: coords },
      stroke: { color: selected ? 'rgba(0,140,255,0.35)' : 'rgba(0,0,0,0.004)', width: base.width + 14 },
      zIndex: 100,
      target,
    });

    // Separate wires (crossarm) are always drawn as parallel lines; ABC as one thick line.
    const split = isWired(line.kind) && line.suspension === 'bare' && line.wires.length > 1;
    if (!split) {
      const empty = isWired(line.kind) && line.wires.length === 0;
      const lit = line.wires.some((w) => highlighted.has(wireKey(line.id, w.id)));
      specs.set(`line:${line.id}`, {
        geometry: { type: 'LineString', coordinates: coords },
        stroke: {
          color: empty ? COLOR_UNTRACED : wholeLineColor(line, trace),
          width: line.suspension === 'sip' ? base.width + 2 : base.width + (lit ? 3 : 0),
          // A line without wires is dashed: it needs to be configured in the span card.
          dash: empty ? [6, 6] : base.dash,
          opacity: dim && !lit ? 0.3 : 1,
        },
        zIndex: line.kind === 'drop' ? 210 : 200,
        target,
      });
      continue;
    }

    const ordered = orderWires(line, a, b);
    const px = line.kind === 'drop' ? 3 : zoom >= DENSE_ZOOM ? 5 : 2;
    const spacing = px * metersPerPixel(zoom, a.coords[1]);
    const width = line.kind === 'drop' ? 2 : 3;
    ordered.forEach((w, i) => {
      const wk = wireKey(line.id, w.id);
      const lit = highlighted.has(wk);
      const offset = ((ordered.length - 1) / 2 - i) * spacing;
      specs.set(`wire:${wk}`, {
        geometry: { type: 'LineString', coordinates: offsetSegment(a.coords, b.coords, offset) },
        stroke: {
          color: conductorColor(trace.wires.get(wk)),
          width: lit ? width + 2 : width,
          // Dashed: a wire with no insulator set on one of its ends.
          dash: isDangling(w, a, b) ? [3, 3] : base.dash,
          opacity: dim && !lit ? 0.3 : 1,
        },
        zIndex: lit ? 260 : 220,
        target: { type: 'line', id: line.id, wireId: w.id },
      });
    });
  }
}

/**
 * Wire order across the line: left insulators (top to bottom), then right ones.
 * Taken from the pole at the span start; if the start is a substation, from the pole at the end, so wires do not cross.
 */
function orderWires(line: SchemeLine, from: SchemeNode, to: SchemeNode) {
  const pole = isPole(from) ? from : isPole(to) ? to : null;
  const portOf = (w: Wire) => (pole === from ? w.fromPort : w.toPort) ?? '';
  const rank = new Map<string, number>();
  if (pole) {
    const left = sortInsulators(pole.insulators.filter((i) => i.side === 'L')).reverse();
    const center = sortInsulators(pole.insulators.filter((i) => i.side === 'C' || i.side === 'B'));
    const right = sortInsulators(pole.insulators.filter((i) => i.side === 'R'));
    [...left, ...center, ...right].forEach((ins, i) => rank.set(ins.id, i));
  }
  return [...line.wires].sort((x, y) => (rank.get(portOf(x)) ?? 999) - (rank.get(portOf(y)) ?? 999));
}

function wholeLineColor(line: SchemeLine, trace: TraceResult): string {
  const base = LINE_STYLES[line.kind].color;
  if (!isWired(line.kind) || line.wires.length === 0) return base;
  const traces = line.wires.map((w) => trace.wires.get(wireKey(line.id, w.id)));
  if (line.suspension === 'sip') {
    return traces.some((t) => t && (t.roles.length || t.bundledRoles.length)) ? COLOR_BUNDLE : COLOR_UNTRACED;
  }
  if (traces.length === 1) return conductorColor(traces[0]);
  // Single-phase service drop (phase + neutral): color by phase.
  const phases = new Set(traces.flatMap((t) => t?.roles ?? []).filter((r) => r !== 'N'));
  if (phases.size === 1) return ROLE_COLORS[[...phases][0]];
  return traces.some((t) => t?.roles.length) ? base : COLOR_UNTRACED;
}

function collectContours(state: AppState, specs: Map<string, FeatureSpec>) {
  for (const node of Object.values(state.scheme.nodes)) {
    if (node.kind !== 'house' || !node.contour) continue;
    const selected = state.selection?.type === 'node' && state.selection.id === node.id;
    specs.set(`contour:${node.id}`, {
      geometry: { type: 'Polygon', coordinates: [[...node.contour, node.contour[0]]] },
      fill: selected ? 'rgba(0,140,255,0.25)' : 'rgba(255,170,0,0.18)',
      stroke: { color: selected ? '#008cff' : '#d08a00', width: 2 },
      zIndex: 50,
      target: { type: 'node', id: node.id },
    });
  }
}

function isDangling(w: Wire, a: SchemeNode, b: SchemeNode): boolean {
  const needsPort = (n: SchemeNode) => isPole(n) || n.kind === 'ktp';
  return (needsPort(a) && !w.fromPort) || (needsPort(b) && !w.toPort);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
