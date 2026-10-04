/** Project export and import (GeoJSON / ZIP with photos). */
import { flushSave, store } from '../model/store';
import { traceScheme } from '../topology/trace';
import { exportGeoJSONText, exportZip, importArchive } from '../storage/archive';
import { makeThumb } from '../storage/photos';
import {
  DEFAULT_VIEW,
  addPhotos,
  createProject,
  listPhotos,
  loadProject,
  type PhotoRecord,
  type ProjectRecord,
} from '../storage/projects';
import { uid } from '../model/scheme';
import { t } from '../i18n';

export type ExportKind = 'geojson' | 'zip';

export function downloadBlob(name: string, blob: Blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function fileName(projectName: string, ext: string): string {
  const safe = projectName.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'phasograph';
  return `${safe}-${new Date().toISOString().slice(0, 10)}.${ext}`;
}

/** Export a project by id (from the project list or the open one). */
export async function exportProject(id: string, kind: ExportKind): Promise<void> {
  if (store.get().projectId === id) await flushSave();
  const loaded = await loadProject(id);
  if (!loaded) return;
  const input = { name: loaded.record.name, scheme: loaded.scheme, view: loaded.view, trace: traceScheme(loaded.scheme) };
  if (kind === 'geojson') {
    downloadBlob(fileName(input.name, 'geojson'), new Blob([exportGeoJSONText(input)], { type: 'application/geo+json' }));
  } else {
    downloadBlob(fileName(input.name, 'zip'), await exportZip(input, await listPhotos(id)));
  }
}

export interface ImportOutcome {
  project: ProjectRecord;
  photos: number;
  warnings: string[];
}

/** Import a file (GeoJSON or ZIP) as a new project. */
export async function importProjectFile(file: File): Promise<ImportOutcome> {
  const archive = importArchive(new Uint8Array(await file.arrayBuffer()));
  const name = archive.name || file.name.replace(/\.(zip|geojson|json)$/i, '') || t('projects.untitled');
  const project = await createProject(name, archive.scheme, archive.view ?? DEFAULT_VIEW);
  const photos: PhotoRecord[] = [];
  for (const p of archive.photos) {
    if (!archive.scheme.nodes[p.nodeId]) continue;
    try {
      const { thumb, width, height } = await makeThumb(p.blob);
      // New id: the same archive can be imported multiple times.
      photos.push({ id: uid('photo'), projectId: project.id, nodeId: p.nodeId, caption: p.caption, createdAt: p.createdAt, blob: p.blob, thumb, width, height });
    } catch (e) {
      archive.warnings.push(`photo-decode-failed:${p.id}`);
      console.warn(e);
    }
  }
  await addPhotos(photos);
  return { project, photos: photos.length, warnings: archive.warnings };
}
