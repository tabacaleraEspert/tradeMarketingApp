/**
 * Persistencia del mapeo tempRouteId → realRouteId en IndexedDB.
 * Mismo patrón que pdv-id-map.ts y visit-id-map.ts.
 */

const DB_NAME = "espert-offline";
const DB_VERSION = 4;
const MAP_STORE = "route_id_map";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("operations")) {
        db.createObjectStore("operations", { keyPath: "id", autoIncrement: true });
      }
      if (!db.objectStoreNames.contains("visit_id_map")) {
        db.createObjectStore("visit_id_map", { keyPath: "tempId" });
      }
      if (!db.objectStoreNames.contains("pdv_id_map")) {
        db.createObjectStore("pdv_id_map", { keyPath: "tempId" });
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

export async function saveRouteIdMapping(tempId: number, realId: number): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MAP_STORE, "readwrite");
    tx.objectStore(MAP_STORE).put({ tempId, realId, savedAt: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllRouteIdMappings(): Promise<Map<number, number>> {
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

export async function clearOldRouteMappings(maxAgeDays = 7): Promise<void> {
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
