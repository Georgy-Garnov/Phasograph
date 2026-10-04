/** Projects and photos: operations on top of IndexedDB. */
import type { LngLat, MapView, Scheme } from '../model/types';
import { emptyScheme, isPole, uid } from '../model/scheme';
import { exportGeoJSON, importGeoJSON } from '../model/geojson';
import {
  get,
  getAll,
  photosOfProject,
  put,
  putMany,
  remove,
  type PhotoRecord,
  type ProjectRecord,
  type ProjectSummary,
} from './db';

export type { PhotoRecord, ProjectRecord, ProjectSummary };

export const DEFAULT_VIEW: MapView = { center: [37.6176, 55.7558] as LngLat, zoom: 17 };

/** Key under which the scheme was stored in localStorage before projects existed. */
const LEGACY_KEY = 'electro-grid-scheme-v1';

function summarize(scheme: Scheme, photos: number): ProjectSummary {
  const nodes = Object.values(scheme.nodes);
  return {
    poles: nodes.filter((n) => isPole(n)).length,
    houses: nodes.filter((n) => n.kind === 'house').length,
    lines: Object.keys(scheme.lines).length,
    photos,
  };
}

export async function listProjects(): Promise<ProjectRecord[]> {
  const all = await getAll<ProjectRecord>('projects');
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function createProject(name: string, scheme: Scheme = emptyScheme(), view: MapView = DEFAULT_VIEW): Promise<ProjectRecord> {
  const now = Date.now();
  const record: ProjectRecord = {
    id: uid('prj'),
    name,
    createdAt: now,
    updatedAt: now,
    view,
    data: exportGeoJSON(scheme, undefined, view),
    summary: summarize(scheme, 0),
  };
  await put('projects', record);
  return record;
}

export interface LoadedProject {
  record: ProjectRecord;
  scheme: Scheme;
  view: MapView;
  warnings: string[];
}

export async function loadProject(id: string): Promise<LoadedProject | null> {
  const record = await get<ProjectRecord>('projects', id);
  if (!record) return null;
  const { scheme, view, warnings } = importGeoJSON(record.data);
  return { record, scheme, view: view ?? record.view, warnings };
}

export async function saveProject(id: string, scheme: Scheme, view: MapView): Promise<void> {
  const record = await get<ProjectRecord>('projects', id);
  if (!record) return;
  const photos = (await photosOfProject(id)).length;
  await put<ProjectRecord>('projects', {
    ...record,
    view,
    updatedAt: Date.now(),
    data: exportGeoJSON(scheme, undefined, view),
    summary: summarize(scheme, photos),
  });
}

export async function renameProject(id: string, name: string): Promise<void> {
  const record = await get<ProjectRecord>('projects', id);
  if (record) await put('projects', { ...record, name, updatedAt: Date.now() });
}

export async function deleteProject(id: string): Promise<void> {
  const photos = await photosOfProject(id);
  await remove('photos', photos.map((p) => p.id));
  await remove('projects', [id]);
}

/** Copy of a project together with its photos. */
export async function duplicateProject(id: string, name: string): Promise<ProjectRecord | null> {
  const record = await get<ProjectRecord>('projects', id);
  if (!record) return null;
  const now = Date.now();
  const copy: ProjectRecord = { ...record, id: uid('prj'), name, createdAt: now, updatedAt: now };
  await put('projects', copy);
  const photos = await photosOfProject(id);
  await putMany(
    'photos',
    photos.map((p) => ({ ...p, id: uid('photo'), projectId: copy.id })),
  );
  return copy;
}

// ---------- Photos ----------

export async function addPhoto(photo: Omit<PhotoRecord, 'id'>): Promise<PhotoRecord> {
  const record: PhotoRecord = { ...photo, id: uid('photo') };
  await put('photos', record);
  return record;
}

export async function addPhotos(photos: PhotoRecord[]): Promise<void> {
  await putMany('photos', photos);
}

export const listPhotos = photosOfProject;

export async function getPhoto(id: string): Promise<PhotoRecord | undefined> {
  return get<PhotoRecord>('photos', id);
}

export async function updatePhotoCaption(id: string, caption: string): Promise<void> {
  const p = await get<PhotoRecord>('photos', id);
  if (p) await put('photos', { ...p, caption });
}

export async function deletePhoto(id: string): Promise<void> {
  await remove('photos', [id]);
}

/** Removes photos of objects no longer in the scheme (on project open — after objects were deleted). */
export async function deleteOrphanPhotos(projectId: string, scheme: Scheme): Promise<number> {
  const orphans = (await photosOfProject(projectId)).filter((p) => !scheme.nodes[p.nodeId]);
  await remove('photos', orphans.map((p) => p.id));
  return orphans.length;
}

/**
 * Migrates the scheme from localStorage (versions before projects existed) into the first project.
 * Returns the created project, or null if there is nothing to migrate.
 */
export async function migrateLegacyStorage(name: string): Promise<ProjectRecord | null> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(LEGACY_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const { scheme, view } = importGeoJSON(JSON.parse(raw));
    const record = await createProject(name, scheme, view ?? DEFAULT_VIEW);
    localStorage.removeItem(LEGACY_KEY);
    return record;
  } catch (e) {
    console.warn('Failed to migrate legacy scheme', e);
    return null;
  }
}
