/**
 * Project exchange: GeoJSON (scheme only) or ZIP — project.geojson + photos/*.jpg.
 * In ZIP, scheme objects have properties.photos = [{ id, file, caption, createdAt }].
 */
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import type { MapView, Scheme } from '../model/types';
import { exportGeoJSON, importGeoJSON, type PhotoRef } from '../model/geojson';
import type { TraceResult } from '../topology/trace';
import type { PhotoRecord } from './db';

export const ARCHIVE_GEOJSON = 'project.geojson';

export interface ExportInput {
  name: string;
  scheme: Scheme;
  view: MapView;
  trace?: TraceResult;
}

export function exportGeoJSONText(input: ExportInput): string {
  return JSON.stringify(exportGeoJSON(input.scheme, input.trace, input.view, { name: input.name }), null, 2);
}

/** Project ZIP archive with photos. Photos of objects deleted from the scheme are not included. */
export async function exportZip(input: ExportInput, photos: PhotoRecord[]): Promise<Blob> {
  const files: Zippable = {};
  const refs = new Map<string, PhotoRef[]>();
  for (const p of photos) {
    if (!input.scheme.nodes[p.nodeId]) continue;
    const file = `photos/${p.id}.jpg`;
    // JPEG is already compressed — do not compress again.
    files[file] = [new Uint8Array(await p.blob.arrayBuffer()), { level: 0 }];
    if (!refs.has(p.nodeId)) refs.set(p.nodeId, []);
    refs.get(p.nodeId)!.push({ id: p.id, file, caption: p.caption, createdAt: p.createdAt });
  }
  const geojson = exportGeoJSON(input.scheme, input.trace, input.view, { name: input.name, photos: refs });
  files[ARCHIVE_GEOJSON] = strToU8(JSON.stringify(geojson, null, 2));
  const zipped = zipSync(files);
  return new Blob([zipped], { type: 'application/zip' });
}

export interface ImportedPhoto {
  id: string;
  nodeId: string;
  caption: string;
  createdAt: number;
  blob: Blob;
}

export interface ImportedArchive {
  scheme: Scheme;
  view?: MapView;
  name?: string;
  photos: ImportedPhoto[];
  warnings: string[];
}

const isZip = (bytes: Uint8Array) => bytes[0] === 0x50 && bytes[1] === 0x4b; // «PK»

/** Parses a project file: ZIP (scheme + photos) or GeoJSON. */
export function importArchive(bytes: Uint8Array): ImportedArchive {
  if (!isZip(bytes)) {
    const r = importGeoJSON(JSON.parse(strFromU8(bytes)));
    const warnings = [...r.warnings];
    if (r.photos.length) warnings.push(`photos-missing:${r.photos.length}`);
    return { scheme: r.scheme, view: r.view, name: r.name, photos: [], warnings };
  }
  const files = unzipSync(bytes);
  const geoName =
    Object.keys(files).find((f) => f === ARCHIVE_GEOJSON) ??
    Object.keys(files).find((f) => /\.(geo)?json$/i.test(f) && !f.startsWith('__MACOSX'));
  if (!geoName) throw new Error('no-geojson-in-zip');
  const r = importGeoJSON(JSON.parse(strFromU8(files[geoName])));
  const warnings = [...r.warnings];
  const photos: ImportedPhoto[] = [];
  for (const ref of r.photos) {
    const data = files[ref.file];
    if (!data) {
      warnings.push(`photo-not-found:${ref.file}`);
      continue;
    }
    photos.push({
      id: ref.id,
      nodeId: ref.nodeId,
      caption: ref.caption,
      createdAt: ref.createdAt,
      blob: new Blob([data], { type: 'image/jpeg' }),
    });
  }
  return { scheme: r.scheme, view: r.view, name: r.name, photos, warnings };
}
