/** Map click handling depending on the active tool. */
import { store, type Tool } from '../model/store';
import {
  addLamp,
  centroid,
  createLine,
  createNode,
  deleteLine,
  deleteNode,
  distanceMeters,
  houseOf,
  isPole,
  nearestNode,
  nearestPointOnContour,
  pointInPolygon,
} from '../model/scheme';
import type { HouseNode, LineKind, LngLat, NodeKind, Role, Scheme, SchemeNode } from '../model/types';
import { t, type MessageKey } from '../i18n';
import { lineKindLabel, nodeKindLabel } from '../i18n/labels';
import { highlightWires, portKey, type TraceResult } from '../topology/trace';
import { reverseGeocode } from './geocoder';
import type { FeatureTarget } from './scene';

const LINE_ENDPOINTS: Record<LineKind, { start: NodeKind[]; end: NodeKind[]; autoNode: NodeKind | null }> = {
  line10: { start: ['ktp', 'pole10'], end: ['ktp', 'pole10'], autoNode: 'pole10' },
  line04: { start: ['ktp', 'pole04', 'poleService'], end: ['ktp', 'pole04', 'poleService'], autoNode: 'pole04' },
  lighting: { start: ['ktp', 'pole04', 'poleService'], end: ['pole04', 'poleService'], autoNode: 'pole04' },
  fiber: {
    start: ['ktp', 'pole04', 'pole10', 'poleService', 'house', 'entry'],
    end: ['ktp', 'pole04', 'pole10', 'poleService', 'house', 'entry'],
    autoNode: 'pole04',
  },
  drop: { start: ['pole04', 'poleService'], end: ['poleService', 'entry', 'house'], autoNode: 'entry' },
};

/** Lines that enter a house through a service entry point on the wall. */
const CONSUMER_LINES: LineKind[] = ['drop', 'fiber'];

const TOOL_HINTS: Record<string, MessageKey> = {
  lamp: 'hint.lamp',
  select: 'hint.select',
  node: 'hint.node',
  house: 'hint.house',
  houseContour: 'hint.houseContour',
  line: 'hint.line',
  drop: 'hint.drop',
  lighting: 'hint.lighting',
  fiber: 'hint.fiber',
};

export function hintForTool(tool: Tool): string {
  if (tool.type === 'line' && TOOL_HINTS[tool.kind]) return t(TOOL_HINTS[tool.kind]);
  return t(TOOL_HINTS[tool.type]);
}

function hint(text: string | null) {
  store.set({ hint: text });
}

function geocodeHouse(houseId: string, coords: LngLat) {
  reverseGeocode(coords).then((address) => {
    if (!address) {
      hint(t('hint.geocodeFailed'));
      return;
    }
    store.edit((d) => {
      const h = d.nodes[houseId];
      if (h?.kind === 'house' && h.addressSource !== 'manual') {
        h.address = address;
        h.addressSource = 'geocoder';
      }
    });
  });
}

export function refreshAddress(houseId: string) {
  const h = store.get().scheme.nodes[houseId];
  if (h) geocodeHouse(houseId, h.coords);
}

/** Creates a node; a service entry is attached to the nearest house, a house gets its address looked up. */
function placeNode(d: Scheme, kind: NodeKind, coords: LngLat): SchemeNode {
  const node = createNode(kind, coords);
  if (node.kind === 'entry') {
    attachEntry(d, node);
    // This house already has a service entry at the same point: reuse it instead of creating duplicates.
    const existing = Object.values(d.nodes).find(
      (n) => n.kind === 'entry' && n.houseId === node.houseId && distanceMeters(n.coords, node.coords) < 1.5,
    );
    if (existing) return existing;
  }
  d.nodes[node.id] = node;
  return node;
}

/** Outline that contains the point or whose boundary is near it (within 3 m). */
function contourAt(d: Scheme, p: LngLat): HouseNode | null {
  for (const n of Object.values(d.nodes)) {
    if (n.kind !== 'house' || !n.contour) continue;
    if (pointInPolygon(p, n.contour) || distanceMeters(p, nearestPointOnContour(p, n.contour)) < 3) return n;
  }
  return null;
}

/** Attaches a service entry to a house: on an outline it snaps to the nearest wall, otherwise to the nearest house within 40 m. */
function attachEntry(d: Scheme, entry: SchemeNode) {
  if (entry.kind !== 'entry') return;
  const house = contourAt(d, entry.coords);
  if (house?.contour) {
    entry.coords = nearestPointOnContour(entry.coords, house.contour);
    entry.houseId = house.id;
  } else if (!entry.houseId || !d.nodes[entry.houseId]) {
    entry.houseId = nearestNode(d, entry.coords, ['house'], 40)?.id ?? null;
  }
}

function addHouse(coords: LngLat, contour: LngLat[] | null) {
  const id = store.edit((d) => {
    const h = placeNode(d, 'house', contour ? centroid(contour) : coords) as HouseNode;
    h.contour = contour;
    // Attach "dangling" service entries inside or near the outline.
    for (const n of Object.values(d.nodes)) {
      if (n.kind === 'entry' && !n.houseId && nearestNode(d, n.coords, ['house'], 40)?.id === h.id) n.houseId = h.id;
    }
    return h.id;
  });
  store.set({ selection: { type: 'node', id } });
  geocodeHouse(id, store.get().scheme.nodes[id].coords);
}

/** Initial service drop wire layout based on the pole tracing results. */
function autoPickDrop(d: Scheme, lineId: string, trace: TraceResult) {
  const line = d.lines[lineId];
  const pole = d.nodes[line.from];
  if (!isPole(pole) || line.wires.some((w) => w.fromPort)) return;
  const roleAt = (role: Role) =>
    pole.insulators.find((i) => {
      const t = trace.ports.get(portKey(pole.id, i.id));
      return t && !t.conflict && t.roles.length === 1 && t.roles[0] === role;
    })?.id ?? null;
  const house = houseOf(d, line.to);
  const roles: (Role | null)[] =
    line.wires.length >= 4 ? ['A', 'B', 'C', 'N'] : [house?.manualPhase ?? null, 'N'];
  line.wires.forEach((w, i) => {
    const r = roles[i];
    if (r) w.fromPort = roleAt(r);
  });
}

function finishLineTo(endId: string) {
  const s = store.get();
  const tool = s.tool;
  if (tool.type !== 'line' || !s.lineStart) return;
  const kind = tool.kind;
  const startId = s.lineStart;
  const suspension = kind === 'line04' ? s.suspension : 'bare';
  const lineId = store.edit((d) => {
    const line = createLine(d, kind, startId, endId, suspension);
    if (kind === 'drop') autoPickDrop(d, line.id, s.trace);
    return line.id;
  });
  const end = store.get().scheme.nodes[endId];
  if (kind === 'drop' && end.kind !== 'poleService') {
    store.set({ lineStart: null, selection: { type: 'line', id: lineId }, hint: t('hint.dropCreated') });
  } else {
    store.set({ lineStart: endId, selection: { type: 'line', id: lineId } });
  }
}

/** Wire role on a pole insulator: from tracing, otherwise from manual marking. */
function roleOfInsulator(poleId: string): (insId: string) => Role | null {
  const { trace, scheme } = store.get();
  const pole = scheme.nodes[poleId];
  return (insId) => {
    const t = trace.ports.get(portKey(poleId, insId));
    if (t && !t.conflict && t.roles.length === 1) return t.roles[0];
    return (isPole(pole) && pole.insulators.find((i) => i.id === insId)?.mark) || null;
  };
}

function hangLamp(poleId: string) {
  const roleOf = roleOfInsulator(poleId);
  store.edit((d) => {
    const pole = d.nodes[poleId];
    if (isPole(pole)) addLamp(pole, roleOf);
  });
  const pole = store.get().scheme.nodes[poleId];
  const lamp = isPole(pole) ? pole.lamps[pole.lamps.length - 1] : null;
  store.set({
    selection: { type: 'node', id: poleId },
    hint: lamp?.phasePort
      ? t('hint.lampConnected')
      : t('hint.lampUnconnected'),
  });
}

export function handleMapClick(coords: LngLat) {
  const s = store.get();
  const tool = s.tool;
  switch (tool.type) {
    case 'lamp': {
      const id = store.edit((d) => placeNode(d, 'pole04', coords).id);
      hangLamp(id);
      return;
    }
    case 'select':
      store.set({ selection: null, focusKey: null, selectedLamp: null });
      return;
    case 'node': {
      const id = store.edit((d) => placeNode(d, tool.kind, coords).id);
      store.set({ selection: { type: 'node', id } });
      return;
    }
    case 'house':
      addHouse(coords, null);
      return;
    case 'houseContour':
      store.set({ contour: [...s.contour, coords] });
      return;
    case 'line': {
      const rule = LINE_ENDPOINTS[tool.kind];
      if (!s.lineStart) {
        if (tool.kind === 'drop') {
          hint(t('hint.dropStart'));
          return;
        }
        const id = store.edit((d) => placeNode(d, rule.autoNode!, coords).id);
        store.set({ lineStart: id });
        return;
      }
      // Fiber brought to a house outline ends with a service entry on the wall, not a new pole.
      const kind = tool.kind === 'fiber' && contourAt(s.scheme, coords) ? 'entry' : rule.autoNode!;
      const endId = store.edit((d) => placeNode(d, kind, coords).id);
      finishLineTo(endId);
      return;
    }
  }
}

export function finishContour() {
  // A double click adds extra points to the outline, so remove coinciding adjacent vertices.
  const contour = store.get().contour.filter((p, i, arr) => i === 0 || distanceMeters(p, arr[i - 1]) > 0.3);
  if (contour.length >= 3) addHouse(contour[0], contour);
  else if (contour.length) hint(t('hint.contourMin'));
  store.set({ contour: [] });
}

export function handleNodeClick(id: string, part?: 'lamp') {
  const s = store.get();
  const tool = s.tool;
  const node = s.scheme.nodes[id];
  if (!node) return;
  if (tool.type === 'select' && part === 'lamp' && isPole(node) && node.lamps.length) {
    // Click on the luminaire icon: select the pole and its (first) luminaire, so Del removes the luminaire.
    store.set({ selection: { type: 'node', id }, focusKey: null, selectedLamp: node.lamps[0].id });
    return;
  }
  if (tool.type === 'lamp') {
    if (isPole(node)) hangLamp(id);
    else hint(t('hint.lampOnPole'));
    return;
  }
  if (tool.type !== 'line') {
    store.set({ selection: { type: 'node', id }, focusKey: null, selectedLamp: null });
    return;
  }
  const rule = LINE_ENDPOINTS[tool.kind];
  if (!s.lineStart) {
    if (!rule.start.includes(node.kind)) {
      hint(t('hint.lineBadStart', { line: lineKindLabel(tool.kind), node: nodeKindLabel(node.kind) }));
      return;
    }
    store.set({ lineStart: id, hint: null });
    return;
  }
  if (id === s.lineStart) {
    store.set({ lineStart: null });
    return;
  }
  if (!rule.end.includes(node.kind)) {
    hint(t('hint.lineBadEnd', { line: lineKindLabel(tool.kind), node: nodeKindLabel(node.kind) }));
    return;
  }
  if (CONSUMER_LINES.includes(tool.kind) && node.kind === 'house' && node.contour) {
    // For a house with an outline, the service drop/fiber arrives at a service entry on the wall nearest to the pole.
    const start = s.scheme.nodes[s.lineStart];
    const entryId = store.edit((d) => placeNode(d, 'entry', nearestPointOnContour(start.coords, node.contour!)).id);
    finishLineTo(entryId);
    return;
  }
  finishLineTo(id);
}

/**
 * Click on a line or outline on the map. In select mode it selects the object;
 * when placing objects it acts like a map click (a service entry can be placed on an outline, a pole under a line);
 * when drawing a service drop/fiber, a click on an outline creates a service entry at the click point (on the wall);
 * when drawing other lines, a click on an outline ends the line at the house.
 */
export function handleFeatureClick(target: FeatureTarget, coords: LngLat) {
  const tool = store.get().tool;
  if (tool.type === 'select') {
    if (target.type === 'line') handleLineClick(target.id, target.wireId);
    else handleNodeClick(target.id);
  } else if (tool.type === 'line' && !CONSUMER_LINES.includes(tool.kind) && target.type === 'node') {
    handleNodeClick(target.id);
  } else {
    handleMapClick(coords);
  }
}

export function handleLineClick(lineId: string, wireId: string | null) {
  const s = store.get();
  if (s.tool.type !== 'select') return;
  const line = s.scheme.lines[lineId];
  if (!line) return;
  let focusKey: string | null = null;
  const wire = wireId ? line.wires.find((w) => w.id === wireId) : undefined;
  if (wire) {
    if (wire.fromPort) focusKey = portKey(line.from, wire.fromPort);
    else if (wire.toPort) focusKey = portKey(line.to, wire.toPort);
  }
  store.set({ selection: { type: 'line', id: lineId }, focusKey });
}

export function moveNode(id: string, coords: LngLat) {
  store.edit((d) => {
    const n = d.nodes[id];
    if (!n) return;
    if (n.kind === 'house' && n.contour) {
      const dx = coords[0] - n.coords[0];
      const dy = coords[1] - n.coords[1];
      n.contour = n.contour.map(([x, y]) => [x + dx, y + dy]);
    }
    n.coords = coords;
    if (n.kind === 'entry') attachEntry(d, n);
  });
}

export function setTool(tool: Tool) {
  // The status bar takes the tool hint from hintForTool, in the current language.
  store.set({ tool, lineStart: null, contour: [], hint: null });
}

/** Deletes the selection. If a luminaire on a pole is selected (and deleting the object itself was not requested), only the luminaire. */
export function deleteSelection(objectOnly = false) {
  const { selection, selectedLamp, scheme } = store.get();
  if (!selection) return;
  const pole = selection.type === 'node' ? scheme.nodes[selection.id] : undefined;
  if (!objectOnly && selectedLamp && isPole(pole) && pole.lamps.some((l) => l.id === selectedLamp)) {
    removeLamp(pole.id, selectedLamp);
    return;
  }
  store.edit(
    (d) => {
      if (selection.type === 'node') deleteNode(d, selection.id);
      else deleteLine(d, selection.id);
    },
    { patch: { selection: null, focusKey: null } },
  );
}

export function removeLamp(poleId: string, lampId: string) {
  store.edit(
    (d) => {
      const p = d.nodes[poleId];
      if (isPole(p)) p.lamps = p.lamps.filter((l) => l.id !== lampId);
    },
    { patch: { selectedLamp: null, hint: t('hint.lampRemoved') } },
  );
}

export function focusedWires(): Set<string> {
  const { focusKey, trace } = store.get();
  return focusKey ? highlightWires(trace, focusKey) : new Set();
}
