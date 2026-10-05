/**
 * Scene: a provider-independent description of what to draw on the map.
 * Adapters (Leaflet, Yandex) just apply it by comparing object "signatures".
 */
import type { AppState } from '../model/store';
import type { Scheme, LngLat, SchemeLine, SchemeNode, Wire } from '../model/types';
import { COLOR_BUNDLE, COLOR_CONFLICT, COLOR_UNTRACED, LINE_STYLES, ROLE_COLORS } from '../model/constants';
import { bearing, destination, entriesOnNewContour, isPole, isWired, poleAzimuth, sortInsulators } from '../model/scheme';
import { wireKey, type ConductorTrace, type TraceResult } from '../topology/trace';
import { metersPerPixel, offsetSegment } from './geo';
import { contourCenter, edgeMidpoints } from '../model/contourEdit';
import { VOLTAGE_MAX, VOLTAGE_MIN, cachedVoltages, type HouseVoltage, type KtpReading } from '../topology/voltage';
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
  const moved = draftEntryPositions(state);
  collectLines(state, highlighted, zoom, features, moved);
  collectContours(state, features);
  return {
    markers: [...buildMarkers(state, moved), ...buildOrientation(state, zoom), ...buildContourHandles(state)],
    features,
  };
}

/**
 * While an outline is being edited, the house's entries on its walls follow the draft (and their drops are drawn
 * to the new positions) before the draft is saved.
 */
function draftEntryPositions(state: AppState): Map<string, LngLat> {
  const edit = state.contourEdit;
  const house = edit ? state.scheme.nodes[edit.houseId] : undefined;
  if (!edit || house?.kind !== 'house' || !house.contour) return new Map();
  return entriesOnNewContour(state.scheme, edit.houseId, house.contour, state.contourPreview?.points ?? edit.points);
}

/**
 * Drag handles of the outline being edited: corners (`cv:<houseId>:<i>`) and wall middles (`ce:<houseId>:<i>`).
 * They sit at the draft positions, so re-renders during a drag do not move the handle being dragged.
 */
function buildContourHandles(state: AppState): MarkerSpec[] {
  const edit = state.contourEdit;
  if (!edit) return [];
  const rotate = edit.mode === 'rotate';
  // Centre handle: click toggles reshape (✥) ⇄ rotate (↻). It stays where the outline centre is.
  const center: MarkerSpec = {
    id: `cc:${edit.houseId}`,
    coords: contourCenter(edit.points),
    className: rotate ? 'contour-center rotate' : 'contour-center',
    html: rotate ? '↻' : '✥',
    title: t(rotate ? 'contour.centerRotate' : 'contour.centerShape'),
    draggable: false,
    zIndex: 41,
  };
  const corners = edit.points.map((p, i) => ({
    id: `cv:${edit.houseId}:${i}`,
    coords: p,
    className: rotate ? 'contour-vertex rotate' : 'contour-vertex',
    html: '',
    title: t(rotate ? 'contour.vertexRotateTitle' : 'contour.vertexTitle'),
    draggable: true,
    zIndex: 40,
  }));
  if (rotate) return [center, ...corners];
  const walls = edgeMidpoints(edit.points).map((p, i) => ({
    id: `ce:${edit.houseId}:${i}`,
    coords: p,
    className: 'contour-edge-handle',
    html: '',
    title: t('contour.edgeTitle'),
    draggable: true,
    zIndex: 39,
  }));
  return [center, ...corners, ...walls];
}

/** Distance of the rotation handle from the pole, in screen pixels. */
const ROTATE_HANDLE_PX = 34;

/**
 * Orientation of the selected pole: a disc split into a blue left half and a red right half with a
 * "forward" arrow, plus a draggable handle to rotate the pole. Marker ids: `orient:<poleId>`, `rot:<poleId>`.
 */
function buildOrientation(state: AppState, zoom: number): MarkerSpec[] {
  const sel = state.selection;
  const pole = sel?.type === 'node' ? state.scheme.nodes[sel.id] : undefined;
  if (!isPole(pole)) return [];
  const committed = poleAzimuth(state.scheme, pole);
  const preview = state.rotatePreview?.poleId === pole.id ? state.rotatePreview.azimuth : committed;
  const draggable = state.tool.type === 'select';
  const handleAt = destination(pole.coords, committed, ROTATE_HANDLE_PX * metersPerPixel(zoom, pole.coords[1]));
  const markers: MarkerSpec[] = [
    {
      id: `orient:${pole.id}`,
      coords: pole.coords,
      className: 'pole-orient',
      html: `<span class="pole-orient-disc" style="transform: translate(-50%, -50%) rotate(${preview}deg)"><i></i></span>`,
      title: '',
      draggable: false,
      zIndex: 5,
    },
  ];
  if (draggable) {
    markers.push({
      id: `rot:${pole.id}`,
      // While dragging, the handle keeps its committed position so re-renders do not fight the drag.
      coords: handleAt,
      className: 'pole-rotate-handle',
      html: '↻',
      title: t('pole.rotateHandle'),
      draggable: true,
      zIndex: 30,
    });
  }
  return markers;
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

/** Mini digital voltmeter under a house: three digits in a frame, red when out of the ±10% range. */
function voltmeter(v: HouseVoltage): string {
  const title = v.phases.map((p) => `${p.phase}: ${p.voltage.toFixed(1)} ${t('unit.v')}`).join(', ');
  return `<span class="voltmeter${v.ok ? '' : ' bad'}" title="${escapeHtml(title)}">${Math.round(v.voltage)}</span>`;
}

const lcd = (text: string, bad = false, phase?: string) =>
  `<i class="lcd${bad ? ' bad' : ''}${phase ? ` ph-${phase}` : ''}">${escapeHtml(text)}</i>`;
const num = (v: number, digits: number) => v.toFixed(digits);

/**
 * Substation instrument panel: busbar voltages and currents per phase, transformer load (kVA, %),
 * HV voltage (kV) and HV current (A) — the same mini digital displays as the house voltmeters.
 */
function ktpPanel(r: KtpReading): string {
  const ph = ['A', 'B', 'C'] as const;
  const amps = (a: number) => num(a, a < 10 ? 1 : 0);
  const row = (label: string, title: string, cells: string) =>
    `<span class="ktp-row" title="${escapeHtml(title)}"><b>${escapeHtml(label)}</b>${cells}</span>`;
  const overload = r.loadingPct !== null && r.loadingPct > 100;
  return `<span class="ktp-panel">${[
    row(t('scene.ktpU'), t('ktp.busbars'), ph.map((p) => lcd(num(r.voltages[p], 0), r.voltages[p] < VOLTAGE_MIN || r.voltages[p] > VOLTAGE_MAX, p)).join('')),
    row(t('scene.ktpI'), t('ktp.currents'), ph.map((p) => lcd(amps(r.currents[p]), false, p)).join('')),
    row(
      t('scene.ktpS'),
      t('ktp.loading'),
      lcd(num(r.apparentVa / 1000, 1)) + (r.loadingPct !== null ? lcd(`${num(r.loadingPct, 0)}%`, overload) : ''),
    ),
    row(t('scene.ktpHv'), t('ktp.hvReading'), lcd(num(r.hvVoltage / 1000, 2)) + lcd(num(r.hvCurrent, 1))),
  ].join('')}</span>`;
}

function buildMarkers(state: AppState, moved: Map<string, LngLat>): MarkerSpec[] {
  const { scheme, selection, lineStart, tool, trace } = state;
  const calc = state.settings?.showVoltage ? cachedVoltages(scheme, trace, state.settings.voltageMode) : null;
  const voltages = calc?.houses ?? null;
  const photoCounts = new Map<string, number>();
  for (const p of state.photos ?? []) photoCounts.set(p.nodeId, (photoCounts.get(p.nodeId) ?? 0) + 1);
  return Object.values(scheme.nodes).map((node) => {
    const classes = ['node', `node-${node.kind}`];
    if (selection?.type === 'node' && selection.id === node.id) classes.push('selected');
    if (lineStart === node.id) classes.push('line-start');
    let badge = '';
    let voltmeterHtml = '';
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
      const v = voltages?.get(node.id);
      if (v) voltmeterHtml = voltmeter(v);
    }
    if (isPole(node) && node.number) badge = node.number;
    if (node.kind === 'ktp') {
      const reading = calc?.ktps.get(node.id);
      if (reading) voltmeterHtml = ktpPanel(reading);
    }
    let lampHtml = '';
    if (isPole(node) && node.lamps.length) {
      const off = node.lamps.some((l) => trace.lamps.get(l.id)?.status !== 'ok');
      classes.push('has-lamp');
      lampHtml = `<span class="lamp${off ? ' lamp-off' : ''}" title="${escapeHtml(t('scene.lamps', { n: node.lamps.length }))}">✹${node.lamps.length > 1 ? node.lamps.length : ''}</span>`;
    }
    const fiberHtml =
      isPole(node) && node.fiberBox ? `<span class="fiber-mark" title="${escapeHtml(t('pole.fiberBox'))}"></span>` : '';
    const photoCount = photoCounts.get(node.id) ?? 0;
    const photoHtml = photoCount
      ? `<span class="photo-mark" title="${escapeHtml(t('scene.photos', { n: photoCount }))}">📷</span>`
      : '';
    return {
      id: node.id,
      coords: moved.get(node.id) ?? node.coords,
      className: classes.join(' '),
      html: `${NODE_ICONS[node.kind] ?? ''}${badge ? `<span class="badge">${escapeHtml(badge)}</span>` : ''}${lampHtml}${photoHtml}${fiberHtml}${voltmeterHtml}`,
      title: node.kind === 'house' ? node.address || node.name : node.name,
      draggable: tool.type === 'select',
      zIndex: node.kind === 'house' ? 10 : 20,
    };
  });
}

function collectLines(
  state: AppState,
  highlighted: Set<string>,
  zoom: number,
  specs: Map<string, FeatureSpec>,
  moved: Map<string, LngLat>,
) {
  const { scheme, selection, trace } = state;
  const dim = highlighted.size > 0;
  const at = (id: string) => {
    const n = scheme.nodes[id];
    const c = moved.get(id);
    return n && c ? { ...n, coords: c } : n;
  };
  for (const line of Object.values(scheme.lines)) {
    const a = at(line.from);
    const b = at(line.to);
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

    const ordered = orderWires(scheme, line, a, b);
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
function orderWires(scheme: Scheme, line: SchemeLine, from: SchemeNode, to: SchemeNode) {
  const pole = isPole(from) ? from : isPole(to) ? to : null;
  // If the pole faces against the span's direction of travel, its left side is on the travel's right.
  const facingAgainst = pole ? angleDiff(poleAzimuth(scheme, pole), bearing(from.coords, to.coords)) > 90 : false;
  const portOf = (w: Wire) => (pole === from ? w.fromPort : w.toPort) ?? '';
  const rank = new Map<string, number>();
  if (pole) {
    const left = sortInsulators(pole.insulators.filter((i) => i.side === 'L')).reverse();
    const center = sortInsulators(pole.insulators.filter((i) => i.side === 'C' || i.side === 'B'));
    const right = sortInsulators(pole.insulators.filter((i) => i.side === 'R'));
    [...left, ...center, ...right].forEach((ins, i) => rank.set(ins.id, i));
  }
  const sorted = [...line.wires].sort((x, y) => (rank.get(portOf(x)) ?? 999) - (rank.get(portOf(y)) ?? 999));
  return facingAgainst ? sorted.reverse() : sorted;
}

/** Smallest absolute difference between two bearings, 0..180°. */
function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
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
  const edit = state.contourEdit;
  if (edit) {
    // Outline being edited: the live preview (while dragging) or the draft; every wall is its own line so the
    // right-angle magnet can paint it green.
    const pts = state.contourPreview?.points ?? edit.points;
    const green = new Set(state.contourPreview?.green ?? []);
    specs.set(`contour-edit:${edit.houseId}`, {
      geometry: { type: 'Polygon', coordinates: [[...pts, pts[0]]] },
      fill: 'rgba(0,140,255,0.12)',
      stroke: { color: 'rgba(0,0,0,0)', width: 0 },
      zIndex: 280,
      // Clicking inside the draft selects the house being edited (its card holds Finish/Cancel).
      target: { type: 'node', id: edit.houseId },
    });
    pts.forEach((p, i) => {
      specs.set(`contour-edge:${i}`, {
        geometry: { type: 'LineString', coordinates: [p, pts[(i + 1) % pts.length]] },
        stroke: { color: green.has(i) ? '#1f9d3a' : '#008cff', width: green.has(i) ? 4 : 2.5 },
        zIndex: 290,
        target: null,
      });
    });
  }
  for (const node of Object.values(state.scheme.nodes)) {
    if (node.kind !== 'house' || !node.contour || node.id === edit?.houseId) continue;
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
