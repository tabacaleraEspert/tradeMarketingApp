/**
 * Persistencia del mapeo tempPdvId → realPdvId en IndexedDB.
 *
 * Misma lógica que visit-id-map.ts pero para PDVs creados offline.
 * El sync worker guarda el mapeo al sincronizar un pdv_create y lo usa
 * para resolver URLs de operaciones dependientes (fotos, notas).
 */

const DB_NAME = "espert-offline";
const DB_VERSION = 3;
const MAP_STORE = "pdv_id_map";
const QUEUE_STORE = "operations";
const VISIT_MAP_STORE = "visit_id_map";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        db.createObjectStore(QUEUE_STORE, { keyPath: "id", autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(VISIT_MAP_STORE)) {
        db.createObjectStore(VISIT_MAP_STORE, { keyPath: "tempId" });
      }
      if (!db.objectStoreNames.contains(MAP_STORE)) {
        db.createObjectStore(MAP_STORE, { keyPath: "tempId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export async function savePdvIdMapping(tempId: number, realId: number): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MAP_STORE, "readwrite");
    tx.objectStore(MAP_STORE).put({ tempId, realId, savedAt: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllPdvIdMappings(): Promise<Map<number, number>> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MAP_STORE, "readonly");
    const req = tx.objectStore(MAP_STORE).getAll();
    req.onsuccess = () => {
      const map = new Map<number, number>();
      for (const entry of req.result) {
        map.set(entry.tempId, entry.realId);
      }
      resolve(map);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function clearOldPdvMappings(maxAgeDays = 7): Promise<void> {
  const db = await openDb();
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MAP_STORE, "readwrite");
    const store = tx.objectStore(MAP_STORE);
    const req = store.getAll();
    req.onsuccess = () => {
      for (const entry of req.result) {
        if (entry.savedAt < cutoff) {
          store.delete(entry.tempId);
        }
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
