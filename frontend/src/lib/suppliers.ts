/**
 * Lógica pura del catálogo de proveedores (proveedor por zona + vendedores).
 *
 * Usada por el censo (SupplierCensusPage) y el admin (/admin/suppliers).
 * Sin React ni red: todo testeable con vitest.
 *
 * IDs negativos = proveedor/vendedor creado en el cliente (offline) que todavía
 * no existe en el server. Al vincular, se mandan como NewSupplier/NewSeller y el
 * backend deduplica por nombre normalizado.
 */
import type { PdvSupplier, PdvSupplierLinkBody, Supplier, SupplierSeller } from "@/lib/api/types";

/** Cache offline del catálogo de la zona (GET /suppliers). */
export const ZONE_SUPPLIERS_CACHE_KEY = "zone_suppliers_v2";

/** Igual que el backend: minúsculas, sin tildes, espacios colapsados, trim. */
export function normalizeName(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

/**
 * Filtra por nombre de proveedor, nombre de vendedor o teléfono (contains,
 * sin tildes ni mayúsculas). El teléfono matchea por dígitos con 3+ dígitos
 * en la búsqueda. Orden: los que empiezan con la búsqueda primero, después
 * alfabético.
 */
export function filterSuppliers(list: Supplier[], query: string): Supplier[] {
  const q = normalizeName(query);
  const qDigits = digits(query);
  const byName = (a: Supplier, b: Supplier) => a.Name.localeCompare(b.Name, "es");
  if (!q) return [...list].sort(byName);
  const matches = list.filter((s) => {
    if (normalizeName(s.Name).includes(q)) return true;
    return (s.Sellers ?? []).some(
      (v) =>
        normalizeName(v.Name).includes(q) ||
        (qDigits.length >= 3 && digits(v.Phone).includes(qDigits)),
    );
  });
  return matches.sort((a, b) => {
    const sa = normalizeName(a.Name).startsWith(q) ? 0 : 1;
    const sb = normalizeName(b.Name).startsWith(q) ? 0 : 1;
    return sa - sb || byName(a, b);
  });
}

/**
 * Acota el catálogo a la zona del PDV (+ `alsoZoneId`: la del usuario no-admin,
 * que el backend también acepta al vincular). Solo se filtra si la lista
 * mezcla varias zonas (admin, o cache con proveedores de PDVs de otra zona).
 */
export function scopeSuppliersToZone(
  list: Supplier[],
  zoneId: number | null | undefined,
  alsoZoneId?: number | null,
): Supplier[] {
  if (zoneId == null) return list;
  const zones = new Set(list.map((s) => s.ZoneId));
  if (zones.size <= 1) return list;
  return list.filter((s) => s.ZoneId === zoneId || (alsoZoneId != null && s.ZoneId === alsoZoneId));
}

/**
 * Combina el catálogo cacheado con una respuesta fresca de GET /suppliers.
 * Las zonas cubiertas por la respuesta (las pedidas + las que vinieron) se
 * reemplazan enteras (así desaparecen unificados/inactivos y los temporales);
 * se conservan los proveedores reales de otras zonas (p.ej. de un PDV de otra
 * zona visitado antes), para que sigan disponibles offline.
 */
export function mergeFetchedZoneSuppliers(
  cached: Supplier[],
  fresh: Supplier[],
  requestedZoneIds: (number | null | undefined)[],
): Supplier[] {
  const covered = new Set<number | null>([
    ...requestedZoneIds.filter((z): z is number => z != null),
    ...fresh.map((s) => s.ZoneId),
  ]);
  const freshIds = new Set(fresh.map((s) => s.SupplierId));
  const kept = cached.filter((s) => s.SupplierId > 0 && !covered.has(s.ZoneId) && !freshIds.has(s.SupplierId));
  return [...fresh, ...kept];
}

export function findSupplierByName(list: Supplier[], name: string): Supplier | undefined {
  const n = normalizeName(name);
  if (!n) return undefined;
  return list.find((s) => s.IsActive !== false && normalizeName(s.Name) === n);
}

export function findSellerByName(supplier: Supplier, name: string): SupplierSeller | undefined {
  const n = normalizeName(name);
  if (!n) return undefined;
  return (supplier.Sellers ?? []).find((v) => v.IsActive !== false && normalizeName(v.Name) === n);
}

/** "Juan (11 5555-1234)" o "Juan". */
export function formatSeller(seller: { Name: string; Phone?: string | null }): string {
  const phone = seller.Phone?.trim();
  return phone ? `${seller.Name} (${phone})` : seller.Name;
}

/** Etiqueta de un vínculo PDV↔proveedor: "Proveedor · Vendedor (tel)". */
export function formatPdvSupplierLabel(s: Pick<PdvSupplier, "Name" | "Phone"> & {
  SellerName?: string | null;
  SellerPhone?: string | null;
}): string {
  if (s.SellerName) return `${s.Name} · ${formatSeller({ Name: s.SellerName, Phone: s.SellerPhone })}`;
  // Fila legacy (sin vendedor): el teléfono era del proveedor.
  const phone = s.Phone?.trim();
  return phone ? `${s.Name} (${phone})` : s.Name;
}

let tempSeq = 0;
/** ID negativo único para entidades creadas en el cliente. */
export function nextTempId(): number {
  tempSeq = (tempSeq + 1) % 1000;
  return -((Date.now() % 1_000_000_000) * 1000 + tempSeq);
}

/**
 * Body de POST /pdvs/{id}/suppliers/link. Proveedor/vendedor con ID negativo
 * (creado offline) viajan como NewSupplier/NewSeller.
 */
export function buildLinkBody(supplier: Supplier, seller: SupplierSeller | null): PdvSupplierLinkBody {
  const body: PdvSupplierLinkBody = {};
  const supplierIsReal = supplier.SupplierId > 0;
  if (supplierIsReal) {
    body.SupplierId = supplier.SupplierId;
  } else {
    body.NewSupplier = {
      Name: supplier.Name.trim(),
      ...(supplier.SupplierTypeId ? { SupplierTypeId: supplier.SupplierTypeId } : {}),
      ...(supplier.Products && supplier.Products.length > 0 ? { Products: supplier.Products } : {}),
    };
  }
  if (seller) {
    if (supplierIsReal && seller.SupplierSellerId > 0) {
      body.SupplierSellerId = seller.SupplierSellerId;
    } else {
      const phone = seller.Phone?.trim();
      body.NewSeller = { Name: seller.Name.trim(), ...(phone ? { Phone: phone } : {}) };
    }
  }
  return body;
}

/**
 * Agrega (o actualiza) en el catálogo cacheado el proveedor/vendedor de un
 * vínculo, para que un segundo PDV offline pueda elegirlos. Dedup por ID y
 * por nombre normalizado, igual que el backend.
 */
export function mergeIntoZoneSuppliers(
  list: Supplier[],
  supplier: Supplier,
  seller: SupplierSeller | null,
): Supplier[] {
  const idx = list.findIndex(
    (s) => s.SupplierId === supplier.SupplierId ||
      (s.ZoneId === supplier.ZoneId && normalizeName(s.Name) === normalizeName(supplier.Name)),
  );
  const base: Supplier = idx >= 0 ? list[idx] : { ...supplier, Sellers: [] };
  let sellers = base.Sellers ?? [];
  if (idx < 0) {
    sellers = (supplier.Sellers ?? []).filter((v) => !seller || v.SupplierSellerId !== seller.SupplierSellerId);
  }
  if (seller) {
    const sIdx = sellers.findIndex(
      (v) => v.SupplierSellerId === seller.SupplierSellerId || normalizeName(v.Name) === normalizeName(seller.Name),
    );
    if (sIdx >= 0) {
      const prev = sellers[sIdx];
      sellers = sellers.map((v, i) => (i === sIdx ? { ...prev, Phone: prev.Phone || seller.Phone || null } : v));
    } else {
      sellers = [...sellers, seller];
    }
  }
  const merged: Supplier = { ...base, Sellers: sellers };
  return idx >= 0 ? list.map((s, i) => (i === idx ? merged : s)) : [...list, merged];
}

/** Fila optimista para la lista del PDV mientras el vínculo está en cola. */
export function buildOptimisticPdvSupplier(
  pdvId: number,
  supplier: Supplier,
  seller: SupplierSeller | null,
): PdvSupplier {
  const now = new Date().toISOString();
  return {
    PdvSupplierId: nextTempId(),
    PdvId: pdvId,
    ZoneId: supplier.ZoneId,
    Name: supplier.Name,
    Phone: seller?.Phone ?? "",
    SupplierTypeId: supplier.SupplierTypeId,
    Products: supplier.Products ?? [],
    IsActive: true,
    CreatedAt: now,
    UpdatedAt: now,
    SupplierId: supplier.SupplierId,
    SupplierSellerId: seller?.SupplierSellerId ?? null,
    SellerName: seller?.Name ?? null,
    SellerPhone: seller?.Phone ?? null,
  };
}

/**
 * Inserta/reemplaza el vínculo en la lista del PDV: si ya había fila con el
 * mismo proveedor (por ID o nombre normalizado), se reemplaza. Igual que el
 * backend: actualiza el vendedor en vez de duplicar y adopta la fila legacy
 * (sin SupplierId) del mismo nombre.
 */
export function upsertPdvSupplier(list: PdvSupplier[], row: PdvSupplier): PdvSupplier[] {
  const same = (s: PdvSupplier) =>
    s.PdvSupplierId === row.PdvSupplierId ||
    (row.SupplierId != null && s.SupplierId === row.SupplierId) ||
    normalizeName(s.Name) === normalizeName(row.Name);
  const idx = list.findIndex(same);
  if (idx < 0) return [...list, row];
  return list.map((s, i) => (i === idx ? row : s)).filter((s, i) => i === idx || !same(s));
}

/**
 * Al vincular una fila legacy a un proveedor del catálogo: ¿hay que dar de baja
 * la fila vieja? El backend adopta la legacy del mismo nombre normalizado (no
 * hay que tocarla); solo si el nombre cambia queda una fila vieja suelta.
 */
export function shouldDeactivateLegacy(
  legacy: Pick<PdvSupplier, "PdvSupplierId" | "Name">,
  supplierName: string,
  linkedRowId?: number,
): boolean {
  if (legacy.PdvSupplierId <= 0) return false;
  if (linkedRowId != null && linkedRowId === legacy.PdvSupplierId) return false;
  return normalizeName(legacy.Name) !== normalizeName(supplierName);
}

/**
 * Al guardar la edición de un vínculo (fila vieja o ya vinculada): ¿hay que
 * dar de baja la fila original? Legacy → `shouldDeactivateLegacy`. Vinculada →
 * solo si se eligió OTRO proveedor (por ID si es real; si es nuevo/offline, por
 * nombre normalizado, porque el backend reusa el del mismo nombre en la zona).
 * Filas temporales (en cola) no se tocan.
 */
export function shouldDeactivateOriginal(
  original: Pick<PdvSupplier, "PdvSupplierId" | "Name" | "SupplierId">,
  supplier: Pick<Supplier, "SupplierId" | "Name">,
  linkedRowId?: number,
): boolean {
  if (original.SupplierId == null) return shouldDeactivateLegacy(original, supplier.Name, linkedRowId);
  if (original.PdvSupplierId <= 0) return false;
  if (linkedRowId != null && linkedRowId === original.PdvSupplierId) return false;
  if (supplier.SupplierId > 0) return supplier.SupplierId !== original.SupplierId;
  return normalizeName(original.Name) !== normalizeName(supplier.Name);
}
