/**
 * IndexedDB 持久化：项目 / 试验记录 / 扫描图 Blob。
 * 全部 Promise 化，结构化克隆直接存类型化数组与 Date 无关的纯对象。
 */
import type { DrumTestRecord, ProjectRecord } from '../core/types';

const DB_NAME = 'tread-studio-db';
const DB_VERSION = 1;
const STORE_PROJECTS = 'projects';
const STORE_TESTS = 'drumTests';
const STORE_BLOBS = 'blobs';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_TESTS)) db.createObjectStore(STORE_TESTS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_BLOBS)) db.createObjectStore(STORE_BLOBS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export const storage = {
  // ---- 项目 ----
  async listProjects(): Promise<ProjectRecord[]> {
    return tx(STORE_PROJECTS, 'readonly', (s) => s.getAll() as IDBRequest<ProjectRecord[]>);
  },
  async saveProject(p: ProjectRecord): Promise<void> {
    await tx(STORE_PROJECTS, 'readwrite', (s) => s.put(p));
  },
  async deleteProject(id: string): Promise<void> {
    await tx(STORE_PROJECTS, 'readwrite', (s) => s.delete(id));
  },

  // ---- 转鼓试验 ----
  async listTests(): Promise<DrumTestRecord[]> {
    return tx(STORE_TESTS, 'readonly', (s) => s.getAll() as IDBRequest<DrumTestRecord[]>);
  },
  async saveTest(t: DrumTestRecord): Promise<void> {
    await tx(STORE_TESTS, 'readwrite', (s) => s.put(t));
  },
  async deleteTest(id: string): Promise<void> {
    await tx(STORE_TESTS, 'readwrite', (s) => s.delete(id));
  },

  // ---- 扫描图 Blob ----
  async putBlob(id: string, blob: Blob): Promise<void> {
    await tx(STORE_BLOBS, 'readwrite', (s) => s.put(blob, id));
  },
  async getBlob(id: string): Promise<Blob | undefined> {
    return tx(STORE_BLOBS, 'readonly', (s) => s.get(id) as IDBRequest<Blob | undefined>);
  },
  async deleteBlob(id: string): Promise<void> {
    await tx(STORE_BLOBS, 'readwrite', (s) => s.delete(id));
  },
};
