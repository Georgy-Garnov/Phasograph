import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createLine, createNode, emptyScheme } from '../model/scheme';
import type { Scheme } from '../model/types';
import { resetDbConnection } from './db';
import {
  addPhoto,
  createProject,
  deleteOrphanPhotos,
  deleteProject,
  duplicateProject,
  listPhotos,
  listProjects,
  loadProject,
  migrateLegacyStorage,
  renameProject,
  saveProject,
} from './projects';
import { exportZip, importArchive } from './archive';
import { exportGeoJSON } from '../model/geojson';

function sampleScheme(): { scheme: Scheme; poleId: string } {
  const scheme = emptyScheme();
  const ktp = createNode('ktp', [37.6, 55.7]);
  const pole = createNode('pole04', [37.601, 55.7]);
  scheme.nodes[ktp.id] = ktp;
  scheme.nodes[pole.id] = pole;
  createLine(scheme, 'line04', ktp.id, pole.id, 'bare');
  return { scheme, poleId: pole.id };
}

const photoBytes = (seed: number) => new Uint8Array([0xff, 0xd8, seed, 1, 2, 3, 0xff, 0xd9]);
const photo = (projectId: string, nodeId: string, seed = 7) => ({
  projectId,
  nodeId,
  createdAt: 1_700_000_000_000 + seed,
  caption: `фото ${seed}`,
  width: 1920,
  height: 1080,
  blob: new Blob([photoBytes(seed)], { type: 'image/jpeg' }),
  thumb: new Blob([photoBytes(seed + 100)], { type: 'image/jpeg' }),
});

beforeEach(async () => {
  await resetDbConnection();
  indexedDB.deleteDatabase('phasetrail');
});

describe('projects in IndexedDB', () => {
  it('create, save, load, rename', async () => {
    const p = await createProject('Улица Садовая');
    const { scheme } = sampleScheme();
    await saveProject(p.id, scheme, { center: [37.6, 55.7], zoom: 18 });
    await renameProject(p.id, 'Садовая, 1-я очередь');

    const loaded = await loadProject(p.id);
    expect(loaded!.scheme).toEqual(scheme);
    expect(loaded!.view.zoom).toBe(18);
    const list = await listProjects();
    expect(list.map((x) => x.name)).toEqual(['Садовая, 1-я очередь']);
    expect(list[0].summary).toMatchObject({ poles: 1, lines: 1, houses: 0 });
  });

  it('duplicating a project copies photos, deleting removes photos', async () => {
    const { scheme, poleId } = sampleScheme();
    const p = await createProject('A', scheme);
    await addPhoto(photo(p.id, poleId));
    const copy = await duplicateProject(p.id, 'A (копия)');
    expect(await listPhotos(copy!.id)).toHaveLength(1);

    await deleteProject(p.id);
    expect(await listPhotos(p.id)).toHaveLength(0);
    expect(await listPhotos(copy!.id)).toHaveLength(1);
    expect((await listProjects()).map((x) => x.id)).toEqual([copy!.id]);
  });

  it('photos of deleted objects are purged', async () => {
    const { scheme, poleId } = sampleScheme();
    const p = await createProject('B', scheme);
    await addPhoto(photo(p.id, poleId, 1));
    await addPhoto(photo(p.id, 'gone-node', 2));
    expect(await deleteOrphanPhotos(p.id, scheme)).toBe(1);
    expect((await listPhotos(p.id)).map((x) => x.nodeId)).toEqual([poleId]);
  });

  it('migrates the scheme from localStorage into the first project', async () => {
    const { scheme } = sampleScheme();
    const storage = new Map<string, string>([['electro-grid-scheme-v1', JSON.stringify(exportGeoJSON(scheme))]]);
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => storage.get(k) ?? null,
      removeItem: (k: string) => void storage.delete(k),
    };
    const p = await migrateLegacyStorage('Мой проект');
    expect(p?.name).toBe('Мой проект');
    expect((await loadProject(p!.id))!.scheme).toEqual(scheme);
    expect(storage.has('electro-grid-scheme-v1')).toBe(false);
    expect(await migrateLegacyStorage('ещё раз')).toBeNull();
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });
});

describe('project ZIP archive', () => {
  it('export → import preserves the scheme and photos', async () => {
    const { scheme, poleId } = sampleScheme();
    const photos = [
      { ...photo('p', poleId, 1), id: 'ph1' },
      { ...photo('p', poleId, 2), id: 'ph2' },
      { ...photo('p', 'deleted-node', 3), id: 'ph3' }, // object does not exist — will not be archived
    ];
    const zip = await exportZip({ name: 'Садовая', scheme, view: { center: [37.6, 55.7], zoom: 17 } }, photos);
    const archive = importArchive(new Uint8Array(await zip.arrayBuffer()));

    expect(archive.name).toBe('Садовая');
    expect(archive.scheme).toEqual(scheme);
    expect(archive.warnings).toEqual([]);
    expect(archive.photos.map((p) => [p.id, p.nodeId, p.caption])).toEqual([
      ['ph1', poleId, 'фото 1'],
      ['ph2', poleId, 'фото 2'],
    ]);
    expect(new Uint8Array(await archive.photos[1].blob.arrayBuffer())).toEqual(photoBytes(2));
  });

  it('GeoJSON without photos is imported too', async () => {
    const { scheme } = sampleScheme();
    const text = JSON.stringify(exportGeoJSON(scheme, undefined, undefined, { name: 'Только схема' }));
    const archive = importArchive(new TextEncoder().encode(text));
    expect(archive.name).toBe('Только схема');
    expect(archive.scheme).toEqual(scheme);
    expect(archive.photos).toEqual([]);
  });
});
