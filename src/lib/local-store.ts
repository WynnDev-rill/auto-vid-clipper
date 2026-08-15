const DB_NAME = "clipforge-local-v4";
const DB_VERSION = 1;
const JOBS = "jobs";
const SOURCES = "sources";

type SourceRecord = { id: string; name: string; type: string; size: number; blob: Blob; createdAt: number };

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(JOBS)) db.createObjectStore(JOBS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(SOURCES)) db.createObjectStore(SOURCES, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open local ClipForge storage"));
  });
}

function tx<T>(storeName: string, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then((db) => new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const request = run(transaction.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Local storage operation failed"));
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => { db.close(); reject(transaction.error ?? new Error("Local storage transaction failed")); };
  }));
}

export async function putJob<T extends { id: string }>(job: T) { await tx(JOBS, "readwrite", (store) => store.put(job)); return job; }
export async function getStoredJob<T>(id: string) { return (await tx(JOBS, "readonly", (store) => store.get(id))) as T | undefined; }
export async function deleteStoredJob(id: string) { await tx(JOBS, "readwrite", (store) => store.delete(id)); }
export async function listStoredJobs<T>() { return (await tx(JOBS, "readonly", (store) => store.getAll())) as T[]; }

export async function putSource(record: SourceRecord) { await tx(SOURCES, "readwrite", (store) => store.put(record)); return record; }
export async function getSource(id: string) { return (await tx(SOURCES, "readonly", (store) => store.get(id))) as SourceRecord | undefined; }
export async function deleteSource(id: string) { await tx(SOURCES, "readwrite", (store) => store.delete(id)); }
