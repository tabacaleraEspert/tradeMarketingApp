/**
 * Persistencia del mapeo tempVisitId → realVisitId en IndexedDB.
 *
 * Cuando una visita se crea offline con un ID temporal negativo, el sync worker
 * obtiene el ID real del server al sincronizar. Este mapeo se persiste para que
 * si el flush se interrumpe (se cerró el browser, se cortó la conexión de nuevo),
 * las operaciones dependientes puedan resolverse en el próximo flush.
 *
 * Se usa un object store separado en la misma DB del queue offline.
 */

const DB_NAME = "espert-offline";
const DB_VERSION = 2; // bump de versión para agregar el nuevo store
const MAP_STORE = "visit_id_map";
const QUEUE_STORE = "operations";

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
      if (!db.objectStoreNames.contains(MAP_STORE)) {
        db.createObjectStore(MAP_STORE, { keyPath: "tempId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export async function saveVisitIdMapping(tempId: number, realId: number): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MAP_STORE, "readwrite");
    tx.objectStore(MAP_STORE).put({ tempId, realId, savedAt: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getVisitIdMapping(tempId: number): Promise<number | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MAP_STORE, "readonly");
    const req = tx.objectStore(MAP_STORE).get(tempId);
    req.onsuccess = () => resolve(req.result?.realId ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllVisitIdMappings(): Promise<Map<number, number>> {
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

export async function clearOldMappings(maxAgeDays = 7): Promise<void> {
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
