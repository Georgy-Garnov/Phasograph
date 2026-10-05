import { useSyncExternalStore } from 'react';
import { produce, type Draft } from 'immer';
import type { LineKind, MapView, NodeKind, Scheme, Suspension, LngLat } from './types';
import { emptyScheme } from './scheme';
import { traceScheme, type TraceResult } from '../topology/trace';
import type { LoadMode } from '../topology/voltage';
import {
  DEFAULT_VIEW,
  addPhoto,
  deleteOrphanPhotos,
  deletePhoto,
  listPhotos,
  loadProject,
  renameProject,
  saveProject,
  updatePhotoCaption,
  type PhotoRecord,
} from '../storage/projects';

export type Tool =
  | { type: 'select' }
  | { type: 'node'; kind: Exclude<NodeKind, 'house'> }
  | { type: 'house' }
  | { type: 'houseContour' }
  /** Street lighting luminaire on a pole. */
  | { type: 'lamp' }
  | { type: 'line'; kind: LineKind };

export type MapProvider = 'leaflet' | 'yandex';
export type BaseLayer = 'osm' | 'satellite' | 'hybrid';
export type GeocoderProvider = 'nominatim' | 'yandex';
export type Lang = 'ru' | 'en' | 'hy';
export const LANGS: Lang[] = ['ru', 'en', 'hy'];

export interface Settings {
  mapProvider: MapProvider;
  /** Leaflet base layer. */
  baseLayer: BaseLayer;
  geocoder: GeocoderProvider;
  lang: Lang;
  /** Show the mini voltmeters next to houses. */
  showVoltage: boolean;
  /** Loads used in the voltage-drop calculation. */
  voltageMode: LoadMode;
}

const SETTINGS_KEY = 'electro-settings-v1';

function defaultLang(): Lang {
  try {
    const browser = navigator.language.toLowerCase().slice(0, 2);
    return (LANGS as string[]).includes(browser) ? (browser as Lang) : 'en';
  } catch {
    return 'ru';
  }
}

function loadSettings(): Settings {
  const defaults: Settings = {
    mapProvider: 'leaflet',
    baseLayer: 'osm',
    geocoder: 'nominatim',
    lang: defaultLang(),
    showVoltage: true,
    voltageMode: 'current',
  };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return defaults;
  }
}

export type Selection =
  | { type: 'node'; id: string }
  | { type: 'line'; id: string }
  | null;

/** In-memory photo: metadata and thumbnail URL (the full image is read from IndexedDB when viewed). */
export interface PhotoMeta {
  id: string;
  nodeId: string;
  createdAt: number;
  caption: string;
  width: number;
  height: number;
  thumbUrl: string;
}

export interface AppState {
  /** Open project; null — the project list is shown. */
  projectId: string | null;
  projectName: string;
  scheme: Scheme;
  trace: TraceResult;
  photos: PhotoMeta[];
  tool: Tool;
  /** Suspension type for new 0.4 kV spans. */
  suspension: Suspension;
  selection: Selection;
  /** Start node of the line being drawn. */
  lineStart: string | null;
  /** Vertices of the house outline being drawn. */
  contour: LngLat[];
  /** Selected luminaire on the selected pole (click on the luminaire icon): Del removes it, not the pole. */
  selectedLamp: string | null;
  /** Terminal from which the conductor is highlighted. */
  focusKey: string | null;
  /** House outline being edited: a draft, saved to the scheme only on "Finish editing". */
  contourEdit: { houseId: string; points: LngLat[] } | null;
  /** Live outline while a vertex or wall handle is dragged, with edges highlighted by the right-angle magnet. */
  contourPreview: { points: LngLat[]; green: number[] } | null;
  /** Live azimuth while the pole rotation handle is being dragged (not in undo history until dropped). */
  rotatePreview: { poleId: string; azimuth: number } | null;
  view: MapView;
  settings: Settings;
  /** Hint/message in the status bar. */
  hint: string | null;
  canUndo: boolean;
  canRedo: boolean;
}

const HISTORY_LIMIT = 200;
const SAVE_DELAY = 500;

const initialScheme = emptyScheme();
let state: AppState = {
  projectId: null,
  projectName: '',
  scheme: initialScheme,
  trace: traceScheme(initialScheme),
  photos: [],
  tool: { type: 'select' },
  suspension: 'bare',
  selection: null,
  lineStart: null,
  contour: [],
  focusKey: null,
  selectedLamp: null,
  rotatePreview: null,
  contourEdit: null,
  contourPreview: null,
  view: DEFAULT_VIEW,
  settings: loadSettings(),
  hint: null,
  canUndo: false,
  canRedo: false,
};

const past: Scheme[] = [];
const future: Scheme[] = [];
let lastCoalesce: { key: string; at: number } | null = null;
const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let dirty = false;

function emit() {
  listeners.forEach((l) => l());
}

/** Immediately writes unsaved changes to IndexedDB. */
export async function flushSave(): Promise<void> {
  clearTimeout(saveTimer);
  if (!dirty || !state.projectId) return;
  dirty = false;
  try {
    await saveProject(state.projectId, state.scheme, state.view);
  } catch (e) {
    dirty = true;
    console.warn('Failed to save project', e);
  }
}

function scheduleSave() {
  if (!state.projectId) return;
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void flushSave(), SAVE_DELAY);
}

// Save immediately before the tab is hidden/closed (especially on iPad).
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushSave();
  });
  window.addEventListener('pagehide', () => void flushSave());
}

function setScheme(scheme: Scheme, extra: Partial<AppState> = {}) {
  const selection = extra.selection !== undefined ? extra.selection : state.selection;
  const stillExists =
    !selection || (selection.type === 'node' ? scheme.nodes[selection.id] : scheme.lines[selection.id]);
  state = {
    ...state,
    ...extra,
    scheme,
    trace: traceScheme(scheme),
    selection: stillExists ? selection : null,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
  };
  scheduleSave();
  emit();
}

function toMeta(p: PhotoRecord): PhotoMeta {
  return {
    id: p.id,
    nodeId: p.nodeId,
    createdAt: p.createdAt,
    caption: p.caption,
    width: p.width,
    height: p.height,
    thumbUrl: URL.createObjectURL(p.thumb),
  };
}

function revokePhotos(photos: PhotoMeta[]) {
  photos.forEach((p) => URL.revokeObjectURL(p.thumbUrl));
}

export const store = {
  get: (): AppState => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  /** UI state update (no history). */
  set(patch: Partial<AppState>) {
    state = { ...state, ...patch };
    if (patch.view) scheduleSave();
    emit();
  },
  /**
   * Scheme change recorded in history.
   * coalesce — key for merging a series of edits (e.g. typing into a field) into a single undo step.
   */
  edit<T = void>(recipe: (draft: Draft<Scheme>) => T, opts: { coalesce?: string; patch?: Partial<AppState> } = {}): T {
    let result!: T;
    const next = produce(state.scheme, (d) => {
      result = recipe(d);
    });
    if (next === state.scheme) {
      if (opts.patch) store.set(opts.patch);
      return result;
    }
    const now = Date.now();
    const merge = opts.coalesce && lastCoalesce?.key === opts.coalesce && now - lastCoalesce.at < 1500;
    if (!merge) {
      past.push(state.scheme);
      if (past.length > HISTORY_LIMIT) past.shift();
    }
    lastCoalesce = opts.coalesce ? { key: opts.coalesce, at: now } : null;
    future.length = 0;
    setScheme(next, opts.patch);
    return result;
  },
  undo() {
    const prev = past.pop();
    if (!prev) return;
    future.push(state.scheme);
    lastCoalesce = null;
    setScheme(prev);
  },
  redo() {
    const next = future.pop();
    if (!next) return;
    past.push(state.scheme);
    lastCoalesce = null;
    setScheme(next);
  },
  setSettings(patch: Partial<Settings>) {
    const settings = { ...state.settings, ...patch };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    store.set({ settings });
  },
  /** Full scheme replacement (clearing) — also undoable. */
  replace(scheme: Scheme, view?: MapView) {
    past.push(state.scheme);
    future.length = 0;
    setScheme(scheme, { selection: null, lineStart: null, contour: [], focusKey: null, ...(view ? { view } : {}) });
  },

  // ---------- Projects ----------

  /** Opens a project: scheme, map view, photos. Undo history starts fresh. */
  async openProject(id: string): Promise<string[]> {
    await flushSave();
    const loaded = await loadProject(id);
    if (!loaded) throw new Error('project-not-found');
    await deleteOrphanPhotos(id, loaded.scheme);
    const photos = (await listPhotos(id)).map(toMeta);
    revokePhotos(state.photos);
    past.length = 0;
    future.length = 0;
    lastCoalesce = null;
    dirty = false;
    state = {
      ...state,
      projectId: id,
      projectName: loaded.record.name,
      scheme: loaded.scheme,
      trace: traceScheme(loaded.scheme),
      photos,
      view: loaded.view,
      selection: null,
      lineStart: null,
      contour: [],
      focusKey: null,
      selectedLamp: null,
      tool: { type: 'select' },
      hint: null,
      canUndo: false,
      canRedo: false,
    };
    emit();
    return loaded.warnings;
  },
  async closeProject() {
    await flushSave();
    revokePhotos(state.photos);
    state = { ...state, projectId: null, projectName: '', photos: [], selection: null, focusKey: null, selectedLamp: null };
    emit();
  },
  async renameCurrent(name: string) {
    if (!state.projectId) return;
    await renameProject(state.projectId, name);
    store.set({ projectName: name });
  },

  // ---------- Photos ----------

  async addPhoto(nodeId: string, photo: { blob: Blob; thumb: Blob; width: number; height: number }) {
    if (!state.projectId) return;
    const record = await addPhoto({ ...photo, projectId: state.projectId, nodeId, createdAt: Date.now(), caption: '' });
    store.set({ photos: [...state.photos, toMeta(record)] });
    scheduleSave(); // update the photo count in the project list
  },
  async deletePhoto(id: string) {
    await deletePhoto(id);
    const gone = state.photos.find((p) => p.id === id);
    if (gone) revokePhotos([gone]);
    store.set({ photos: state.photos.filter((p) => p.id !== id) });
    scheduleSave();
  },
  async setPhotoCaption(id: string, caption: string) {
    store.set({ photos: state.photos.map((p) => (p.id === id ? { ...p, caption } : p)) });
    await updatePhotoCaption(id, caption);
  },
};

export function useStore<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(state));
}
