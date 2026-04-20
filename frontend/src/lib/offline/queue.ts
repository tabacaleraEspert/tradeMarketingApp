/**
 * Cola persistente de operaciones pendientes en IndexedDB.
 *
 * Cada operación es un POST/PATCH/DELETE que el usuario quiso hacer mientras
 * estaba offline (o que falló por red). Se guarda completa (URL + body + headers
 * + tipo + metadata) y un worker la reintenta cuando vuelve la conexión.
 *
 * Por qué IndexedDB y no localStorage:
 *   - Soporta Blobs binarios (necesario para fotos)
 *   - Async (no bloquea el render)
 *   - Cuota mucho más grande (~50% del disco vs ~5MB)
 *
 * Vanilla IDB sin librería para no agregar otra dependencia. La API es verbosa
 * pero está encapsulada acá.
 *
 * Uso desde la consola del browser para testear:
 *
 *   const { queue } = await import("/src/lib/offline/queue.ts");
 *   await queue.add({ kind: "test", method: "POST", url: "/foo", body: { hi: 1 } });
 *   await queue.list();
 *   await queue.remove(1);
 *   await queue.clear();
 */

const DB_NAME = "espert-offline";
const DB_VERSION = 2; // v2: agrega store "visit_id_map" (ver visit-id-map.ts)
const STORE = "operations";

export type QueuedKind =
  | "visit_check"
  | "visit_create"
  | "visit_update"
  | "visit_answers"
  | "visit_action_update"
  | "photo_upload"
  | "pdv_create"
  | "pdv_note_create";

export interface QueuedOperation {
  /** Auto-incremental, asignado por IDB */
  id?: number;
  /** Tipo semántico de la operación, útil para UI */
  kind: QueuedKind;
  /** Método HTTP */
  method: "POST" | "PATCH" | "PUT" | "DELETE";
  /** Path del API (sin baseURL). Ej: /visits/123/checks */
  url: string;
  /** Body para JSON. Para multipart, usar `formParts` */
  body?: unknown;
  /** Para uploads multipart: lista de partes (cada una con name, value y filename opcional). value puede ser Blob o string. */
  formParts?: Array<{ name: string; value: Blob | string; filename?: string }>;
  /** Headers extra (sin Authorization, ese se agrega al ejecutar) */
  headers?: Record<string, string>;
  /** Etiqueta legible para mostrar en la UI */
  label: string;
  /** Cuándo se encoló */
  createdAt: number;
  /** Cuántos intentos llevamos */
  attempts: number;
  /** Último error si falló (para mostrar en la UI) */
  lastError?: string;
  /** Timestamp del último intento */
  lastAttemptAt?: number;
  /**
   * Si esta operación depende de una visita creada offline, este campo contiene
   * el tempId (negativo). El sync worker, al resolver el visit_create, reemplaza
   * este tempId por el real en el URL antes de ejecutar.
   */
  _tempVisitId?: number;
}


// ============================================================================
// Conexión a IndexedDB
// ============================================================================
let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      }
      if (!db.objectStoreNames.contains("visit_id_map")) {
        db.createObjectStore("visit_id_map", { keyPath: "tempId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const store = transaction.objectStore(STORE);
        const req = fn(store);
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
      })
  );
}

// ============================================================================
// API pública
// ============================================================================
export const queue = {
  /** Encola una operación. Devuelve el id asignado. */
  async add(op: Omit<QueuedOperation, "id" | "createdAt" | "attempts">): Promise<number> {
    const full: QueuedOperation = {
      ...op,
      createdAt: Date.now(),
      attempts: 0,
    };
    const id = await tx<IDBValidKey>("readwrite", (s) => s.add(full));
    notifyListeners();
    return Number(id);
  },

  /** Lista todas las operaciones encoladas, ordenadas por createdAt asc. */
  async list(): Promise<QueuedOperation[]> {
    const all = await tx<QueuedOperation[]>("readonly", (s) => s.getAll());
    return all.sort((a, b) => a.createdAt - b.createdAt);
  },

  /** Cantidad de operaciones pendientes (rápido). */
  async count(): Promise<number> {
    return tx<number>("readonly", (s) => s.count());
  },

  /** Devuelve una operación por id. */
  async get(id: number): Promise<QueuedOperation | undefined> {
    return tx<QueuedOperation | undefined>("readonly", (s) => s.get(id));
  },

  /** Actualiza una operación (típicamente para incrementar attempts/lastError). */
  async update(op: QueuedOperation): Promise<void> {
    await tx("readwrite", (s) => s.put(op));
    notifyListeners();
  },

  /** Borra una operación por id. */
  async remove(id: number): Promise<void> {
    await tx("readwrite", (s) => s.delete(id));
    notifyListeners();
  },

  /** Borra todas las operaciones (peligroso, sólo para debug). */
  async clear(): Promise<void> {
    await tx("readwrite", (s) => s.clear());
    notifyListeners();
  },
};


// ============================================================================
// Listeners (para que la UI reaccione a cambios en la queue)
// ============================================================================
type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeQueueChanges(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notifyListeners() {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* noop */
    }
  }
}

// Exponer en window para debug rápido desde consola
if (typeof window !== "undefined") {
  (window as unknown as { __espertQueue?: typeof queue }).__espertQueue = queue;
}
