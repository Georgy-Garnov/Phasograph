/**
 * IndexedDB storage: projects (scheme as GeoJSON) and photos (Blob).
 * No third-party libraries — a thin wrapper turning IDBRequest/IDBTransaction into promises.
 */
import type { MapView } from '../model/types';
import type { GeoCollection } from '../model/geojson';

/** Internal database name (since the first version). Do not change: it holds user projects. */
const DB_NAME = 'phasetrail';
const DB_VERSION = 1;

export interface ProjectSummary {
  poles: number;
  lines: number;
  houses: number;
  photos: number;
}

export interface ProjectRecord {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  view: MapView;
  /** Scheme in export format: on load it goes through the same migrations as import. */
  data: GeoCollection;
  summary: ProjectSummary;
}

export interface PhotoRecord {
  id: string;
  projectId: string;
  /** Scheme object (pole, substation, house) the photo is attached to. */
  nodeId: string;
  createdAt: number;
  caption: string;
  width: number;
  height: number;
  blob: Blob;
  thumb: Blob;
}

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('photos')) {
        const photos = db.createObjectStore('photos', { keyPath: 'id' });
        photos.createIndex('projectId', 'projectId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/** For tests: close the connection so the next test opens a clean database. */
export async function resetDbConnection(): Promise<void> {
  if (dbPromise) (await dbPromise).close();
  dbPromise = null;
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

type StoreName = 'projects' | 'photos';

export async function getAll<T>(store: StoreName): Promise<T[]> {
  const db = await openDb();
  return promisify(db.transaction(store).objectStore(store).getAll()) as Promise<T[]>;
}

export async function get<T>(store: StoreName, id: string): Promise<T | undefined> {
  const db = await openDb();
  return promisify(db.transaction(store).objectStore(store).get(id)) as Promise<T | undefined>;
}

export async function put<T>(store: StoreName, value: T): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value);
  await done(tx);
}

export async function putMany<T>(store: StoreName, values: T[]): Promise<void> {
  if (!values.length) return;
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  const s = tx.objectStore(store);
  values.forEach((v) => s.put(v));
  await done(tx);
}

export async function remove(store: StoreName, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  const s = tx.objectStore(store);
  ids.forEach((id) => s.delete(id));
  await done(tx);
}

export async function photosOfProject(projectId: string): Promise<PhotoRecord[]> {
  const db = await openDb();
  const index = db.transaction('photos').objectStore('photos').index('projectId');
  return promisify(index.getAll(projectId)) as Promise<PhotoRecord[]>;
}
