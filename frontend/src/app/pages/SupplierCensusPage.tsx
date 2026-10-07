import { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate, useLocation } from "react-router";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import {
  ArrowLeft,
  ArrowRight,
  Plus,
  Trash2,
  Pencil,
  Truck,
  User,
  Check,
  X,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { pdvSuppliersApi, supplierTypesApi, supplierProductTypesApi, suppliersApi } from "@/lib/api";
import { fetchWithCache, executeOrEnqueue, readCache, writeCache } from "@/lib/offline";
import type { PdvSupplier, Supplier, SupplierSeller, SupplierType, SupplierProductType } from "@/lib/api/types";
import { VisitStepIndicator } from "../components/VisitStepIndicator";
import { useVisitFlow } from "@/lib/VisitFlowContext";
import { getCurrentUser } from "../lib/auth";
import {
  ZONE_SUPPLIERS_CACHE_KEY,
  buildLinkBody,
  buildOptimisticPdvSupplier,
  filterSuppliers,
  findSellerByName,
  findSupplierByName,
  formatPdvSupplierLabel,
  formatSeller,
  mergeFetchedZoneSuppliers,
  mergeIntoZoneSuppliers,
  nextTempId,
  scopeSuppliersToZone,
  shouldDeactivateOriginal,
  upsertPdvSupplier,
} from "@/lib/suppliers";

/** Paso del alta: buscar → proveedor existente (elegir vendedor) | proveedor nuevo. */
type Mode = "search" | "existing" | "new";

/** null = sin vendedor; "new" = vendedor nuevo; number = SupplierSellerId. */
type SellerChoice = number | "new" | null;

interface NewSupplierForm {
  Name: string;
  SupplierTypeId: number | "";
  Products: string[];
}

const EMPTY_NEW_SUPPLIER: NewSupplierForm = { Name: "", SupplierTypeId: "", Products: [] };
const EMPTY_SELLER = { Name: "", Phone: "" };

export function SupplierCensusPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const locState = (location.state as { routeDayId?: number; visitId?: number }) || {};
  const flow = useVisitFlow();
  const routeDayId = locState.routeDayId ?? flow.routeDayId;
  const visitId = locState.visitId ?? flow.visitId;

  const [suppliers, setSuppliers] = useState<PdvSupplier[]>([]);
  const [supplierTypes, setSupplierTypes] = useState<SupplierType[]>([]);
  const [productTypes, setProductTypes] = useState<SupplierProductType[]>([]);
  const [zoneAll, setZoneAll] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);

  // Alta / edición de vínculo
  const [mode, setMode] = useState<Mode | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Supplier | null>(null);
  const [sellerChoice, setSellerChoice] = useState<SellerChoice>(null);
  const [newSeller, setNewSeller] = useState(EMPTY_SELLER);
  const [newSupplier, setNewSupplier] = useState<NewSupplierForm>(EMPTY_NEW_SUPPLIER);
  /** Fila que se está editando (vieja sin SupplierId o ya vinculada). Si al
   *  guardar queda apuntando a otro proveedor, se da de baja. */
  const [originalRow, setOriginalRow] = useState<PdvSupplier | null>(null);
  const legacyRow = originalRow?.SupplierId == null ? originalRow : null;
  const [saving, setSaving] = useState(false);

  const pdvId = Number(id);

  // Zona del PDV (los proveedores nuevos quedan en esa zona; el backend hace lo mismo).
  const pdvZoneId: number | null = useMemo(() => {
    const pdv = flow.pdv ?? readCache<{ ZoneId?: number | null }>(`pdv_${pdvId}`);
    return pdv?.ZoneId ?? getCurrentUser().zoneId ?? null;
  }, [flow.pdv, pdvId]);

  const currentUser = getCurrentUser();
  const userZoneId = currentUser.zoneId ?? null;
  const isAdmin = currentUser.role?.toLowerCase() === "admin";
  const zoneSuppliers = useMemo(
    () => scopeSuppliersToZone(zoneAll, pdvZoneId, isAdmin ? null : userZoneId),
    [zoneAll, pdvZoneId, isAdmin, userZoneId],
  );

  /** GET /suppliers (su zona + la del PDV si el PDV es real) mergeado con el cache. */
  const fetchZoneSuppliers = () =>
    suppliersApi.list(pdvId > 0 ? { pdv_id: pdvId } : undefined).then((fresh) =>
      mergeFetchedZoneSuppliers(
        readCache<Supplier[]>(ZONE_SUPPLIERS_CACHE_KEY) ?? [],
        fresh,
        [userZoneId, pdvId > 0 ? pdvZoneId : null],
      ),
    );
  const filtered = useMemo(() => filterSuppliers(zoneSuppliers, query), [zoneSuppliers, query]);
  const exactMatch = useMemo(() => findSupplierByName(zoneSuppliers, query), [zoneSuppliers, query]);
  const linkedSupplierIds = useMemo(
    () => new Set(suppliers.map((s) => s.SupplierId).filter((x): x is number => x != null)),
    [suppliers],
  );

  // Mantener el cache offline alineado con la lista: si al volver a esta pantalla
  // el fetch falla (señal mala), fetchWithCache sirve el cache y sin esto
  // el proveedor recién cargado "desaparecía" y lo volvían a cargar.
  const updateSuppliers = (fn: (prev: PdvSupplier[]) => PdvSupplier[]) => {
    setSuppliers((prev) => {
      const next = fn(prev);
      writeCache(`pdv_suppliers_${pdvId}`, next);
      return next;
    });
  };

  const updateZoneAll = (fn: (prev: Supplier[]) => Supplier[]) => {
    setZoneAll((prev) => {
      const next = fn(prev);
      writeCache(ZONE_SUPPLIERS_CACHE_KEY, next);
      return next;
    });
  };

  useEffect(() => {
    if (!pdvId) return;
    setLoading(true);
    Promise.all([
      fetchWithCache(`pdv_suppliers_${pdvId}`, () => pdvSuppliersApi.list(pdvId)).catch(() => []),
      flow.supplierTypes.length > 0 ? Promise.resolve(flow.supplierTypes) : fetchWithCache("supplier_types", () => supplierTypesApi.list()).catch(() => []),
      flow.supplierProductTypes.length > 0 ? Promise.resolve(flow.supplierProductTypes) : fetchWithCache("supplier_product_types", () => supplierProductTypesApi.list()).catch(() => []),
      // Catálogo de la zona: también sirve offline / para PDVs temporales (no depende del PDV).
      fetchWithCache(ZONE_SUPPLIERS_CACHE_KEY, fetchZoneSuppliers).catch(
        () => readCache<Supplier[]>(ZONE_SUPPLIERS_CACHE_KEY) ?? [],
      ),
    ]).then(([s, st, pt, zs]) => {
      setSuppliers(s);
      setSupplierTypes(st);
      setProductTypes(pt);
      setZoneAll(zs);
    }).finally(() => setLoading(false));
  }, [pdvId]);

  const resetForm = () => {
    setMode(null);
    setQuery("");
    setSelected(null);
    setSellerChoice(null);
    setNewSeller(EMPTY_SELLER);
    setNewSupplier(EMPTY_NEW_SUPPLIER);
    setOriginalRow(null);
  };

  const pickSupplier = (s: Supplier, preselectSellerId: number | null = null) => {
    setSelected(s);
    setSellerChoice(preselectSellerId);
    setNewSeller(EMPTY_SELLER);
    setMode("existing");
  };

  const startNewSupplier = () => {
    const name = query.trim();
    if (exactMatch) {
      pickSupplier(exactMatch);
      return;
    }
    setNewSupplier({
      Name: name,
      SupplierTypeId: legacyRow?.SupplierTypeId ?? "",
      Products: legacyRow?.Products ?? [],
    });
    setSellerChoice(null);
    setNewSeller(EMPTY_SELLER);
    setMode("new");
  };

  const toggleProduct = (name: string) => {
    setNewSupplier((f) => ({
      ...f,
      Products: f.Products.includes(name) ? f.Products.filter((p) => p !== name) : [...f.Products, name],
    }));
  };

  /** Resuelve proveedor + vendedor concretos (con IDs negativos si son nuevos). */
  const resolveSelection = (): { supplier: Supplier; seller: SupplierSeller | null } | null => {
    let supplier: Supplier;
    if (mode === "new") {
      const name = newSupplier.Name.trim();
      if (!name) {
        toast.error("El nombre del proveedor es obligatorio");
        return null;
      }
      const existing = findSupplierByName(zoneSuppliers, name);
      supplier = existing ?? {
        SupplierId: nextTempId(),
        ZoneId: pdvZoneId,
        ZoneName: null,
        Name: name,
        SupplierTypeId: newSupplier.SupplierTypeId || null,
        SupplierTypeName: supplierTypes.find((t) => t.SupplierTypeId === newSupplier.SupplierTypeId)?.Name ?? null,
        Products: newSupplier.Products.length > 0 ? newSupplier.Products : null,
        IsActive: true,
        PdvCount: 0,
        Sellers: [],
      };
    } else if (selected) {
      supplier = selected;
    } else {
      return null;
    }

    let seller: SupplierSeller | null = null;
    if (sellerChoice === "new") {
      const name = newSeller.Name.trim();
      const phone = newSeller.Phone.trim();
      if (!name) {
        toast.error("El nombre del vendedor es obligatorio");
        return null;
      }
      const existing = findSellerByName(supplier, name);
      // Si ya existe pero sin teléfono y ahora lo cargan, va como NewSeller:
      // el backend lo reusa y completa el teléfono.
      seller = existing && (existing.Phone || !phone)
        ? existing
        : { SupplierSellerId: nextTempId(), Name: existing?.Name ?? name, Phone: phone || null, IsActive: true };
    } else if (typeof sellerChoice === "number") {
      seller = supplier.Sellers.find((v) => v.SupplierSellerId === sellerChoice) ?? null;
    }
    return { supplier, seller };
  };

  const handleSave = async () => {
    const sel = resolveSelection();
    if (!sel) return;
    const { supplier, seller } = sel;
    const original = originalRow;
    setSaving(true);
    try {
      const result = await executeOrEnqueue<PdvSupplier>({
        kind: "pdv_supplier_link",
        method: "POST",
        url: `/pdvs/${pdvId}/suppliers/link`,
        body: buildLinkBody(supplier, seller),
        label: `Proveedor: ${supplier.Name}${seller ? ` · ${seller.Name}` : ""}`,
        _tempPdvId: pdvId < 0 ? pdvId : undefined,
      });

      // Catálogo local: que un segundo PDV (aún offline) pueda elegir lo recién creado.
      updateZoneAll((prev) => mergeIntoZoneSuppliers(prev, supplier, seller));

      if (!result.queued && result.data) {
        updateSuppliers((prev) => upsertPdvSupplier(prev, result.data));
        // Refrescar el catálogo con los IDs reales (en segundo plano).
        fetchZoneSuppliers().then((zs) => updateZoneAll(() => zs)).catch(() => {});
      } else {
        updateSuppliers((prev) => upsertPdvSupplier(prev, buildOptimisticPdvSupplier(pdvId, supplier, seller)));
      }

      // Fila original reemplazada por otro proveedor (vieja sin catálogo, o
      // vinculada y cambiada con "Cambiar"): se da de baja para no duplicar.
      // (Fila vieja con el mismo nombre: el backend ya la adoptó, no se toca.)
      if (original && shouldDeactivateOriginal(original, supplier, result.queued ? undefined : result.data?.PdvSupplierId)) {
        await executeOrEnqueue({
          kind: "pdv_supplier_update",
          method: "PATCH",
          url: `/pdvs/${pdvId}/suppliers/${original.PdvSupplierId}`,
          body: { IsActive: false },
          label: `Reemplazar proveedor: ${original.Name}`,
          _tempPdvId: pdvId < 0 ? pdvId : undefined,
        }).catch(() => {});
        updateSuppliers((prev) => prev.filter((s) => s.PdvSupplierId !== original.PdvSupplierId));
      }

      toast.success(result.queued ? "Proveedor guardado. Se sincronizará con conexión." : "Proveedor guardado");
      resetForm();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (row: PdvSupplier) => {
    resetForm();
    setOriginalRow(row);
    if (row.SupplierId == null) {
      // Fila vieja: buscarla en el catálogo para vincularla.
      const match = findSupplierByName(zoneSuppliers, row.Name);
      if (match) {
        pickSupplier(match);
      } else {
        setQuery(row.Name);
        setMode("search");
      }
      return;
    }
    const match = zoneAll.find((s) => s.SupplierId === row.SupplierId);
    const supplier: Supplier = match ?? {
      SupplierId: row.SupplierId,
      ZoneId: row.ZoneId,
      ZoneName: null,
      Name: row.Name,
      SupplierTypeId: row.SupplierTypeId,
      SupplierTypeName: null,
      Products: row.Products,
      IsActive: true,
      PdvCount: 0,
      Sellers: row.SupplierSellerId && row.SellerName
        ? [{ SupplierSellerId: row.SupplierSellerId, Name: row.SellerName, Phone: row.SellerPhone ?? null, IsActive: true }]
        : [],
    };
    pickSupplier(supplier, row.SupplierSellerId ?? null);
  };

  const handleDelete = async (supplierId: number) => {
    if (supplierId < 0) {
      toast.info("Todavía se está sincronizando. Podés eliminarlo cuando tengas conexión.");
      return;
    }
    try {
      await pdvSuppliersApi.delete(pdvId, supplierId);
      updateSuppliers((prev) => prev.filter((s) => s.PdvSupplierId !== supplierId));
      toast.success("Proveedor eliminado");
    } catch {
      toast.error("Error al eliminar");
    }
  };

  const getTypeName = (typeId: number | null) =>
    supplierTypes.find((t) => t.SupplierTypeId === typeId)?.Name ?? null;

  /** Vendedor: chips de los existentes + "Sin vendedor" + "Agregar vendedor". */
  const renderSellerPicker = (sellers: SupplierSeller[]) => (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-muted-foreground">Vendedor (opcional)</p>
      <div className="flex flex-wrap gap-1.5">
        <Chip active={sellerChoice === null} onClick={() => setSellerChoice(null)}>Sin vendedor</Chip>
        {sellers.filter((v) => v.IsActive !== false).map((v) => (
          <Chip key={v.SupplierSellerId} active={sellerChoice === v.SupplierSellerId} onClick={() => setSellerChoice(v.SupplierSellerId)}>
            {formatSeller(v)}
          </Chip>
        ))}
        <Chip active={sellerChoice === "new"} onClick={() => setSellerChoice("new")} dashed>
          <Plus size={10} className="inline mr-0.5" /> Agregar vendedor
        </Chip>
      </div>
      {sellerChoice === "new" && (
        <div className="space-y-2 pt-1">
          <input
            type="text"
            placeholder="Nombre del vendedor *"
            value={newSeller.Name}
            onChange={(e) => setNewSeller({ ...newSeller, Name: e.target.value })}
            className="w-full h-10 px-3 border border-border rounded-lg text-sm bg-background"
            autoFocus
          />
          <input
            type="tel"
            inputMode="tel"
            placeholder="Teléfono (opcional)"
            value={newSeller.Phone}
            onChange={(e) => setNewSeller({ ...newSeller, Phone: e.target.value })}
            className="w-full h-10 px-3 border border-border rounded-lg text-sm bg-background"
          />
        </div>
      )}
    </div>
  );

  const canSave =
    !saving &&
    (mode === "existing" ? !!selected : mode === "new" ? !!newSupplier.Name.trim() : false) &&
    (sellerChoice !== "new" || !!newSeller.Name.trim());

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background border-b border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(`/pos/${id}/pop`, { state: { routeDayId, visitId } })} className="p-2 hover:bg-muted rounded-lg">
            <ArrowLeft size={24} />
          </button>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-foreground">Censo Proveedores</h1>
            <p className="text-xs text-muted-foreground">Registrá los proveedores de este PDV</p>
          </div>
          <VisitStepIndicator currentStep={4} />
        </div>
      </div>

      <div className="p-4 space-y-4">
        {loading ? (
          <div className="text-center py-8 text-muted-foreground">Cargando...</div>
        ) : (
          <>
            {/* Proveedores del PDV */}
            {suppliers.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-[#A48242] uppercase tracking-wider flex items-center gap-1">
                  <Truck size={10} /> Proveedores registrados ({suppliers.length})
                </p>
                {suppliers.map((s) => {
                  const typeName = getTypeName(s.SupplierTypeId);
                  return (
                    <Card key={s.PdvSupplierId} className="overflow-hidden">
                      <CardContent className="p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-foreground break-words">{formatPdvSupplierLabel(s)}</p>
                            {typeName && (
                              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                                <User size={10} /> {typeName}
                              </p>
                            )}
                            {s.PdvSupplierId < 0 && (
                              <p className="text-[10px] text-amber-600 mt-0.5">Pendiente de sincronizar</p>
                            )}
                            {s.SupplierId == null && s.PdvSupplierId > 0 && (
                              <p className="text-[10px] text-muted-foreground italic mt-0.5">Carga anterior · tocá el lápiz para vincularlo</p>
                            )}
                            {s.Products && s.Products.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1.5">
                                {s.Products.map((p) => (
                                  <span key={p} className="text-[10px] px-1.5 py-0.5 bg-muted rounded-full text-muted-foreground">{p}</span>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="flex gap-1">
                            <button onClick={() => handleEdit(s)} className="p-1.5 hover:bg-muted rounded-lg text-muted-foreground" aria-label="Editar">
                              <Pencil size={14} />
                            </button>
                            <button onClick={() => handleDelete(s.PdvSupplierId)} className="p-1.5 hover:bg-red-50 rounded-lg text-red-400" aria-label="Eliminar">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}

            {suppliers.length === 0 && !mode && (
              <div className="text-center py-8">
                <Truck size={40} className="mx-auto text-muted-foreground mb-2" />
                <p className="text-muted-foreground font-medium">Sin proveedores registrados</p>
                <p className="text-sm text-muted-foreground mt-1">Agregá el primer proveedor de este PDV</p>
              </div>
            )}

            {mode && (
              <Card className="border-[#A48242]/30">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold text-[#A48242] uppercase">
                      {mode === "new" ? "Nuevo proveedor" : legacyRow ? "Vincular proveedor" : originalRow ? "Editar proveedor" : "Agregar proveedor"}
                    </p>
                    <button onClick={resetForm} className="p-1 text-muted-foreground hover:text-foreground" aria-label="Cerrar">
                      <X size={16} />
                    </button>
                  </div>

                  {/* 1. Buscar proveedor de la zona */}
                  {mode === "search" && (
                    <>
                      <div className="relative">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                        <input
                          type="text"
                          placeholder="Buscá el proveedor (nombre, vendedor o teléfono)"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          className="w-full h-10 pl-8 pr-3 border border-border rounded-lg text-sm bg-background"
                          autoFocus
                        />
                      </div>

                      {query.trim() && !exactMatch && (
                        <button
                          type="button"
                          onClick={startNewSupplier}
                          className="w-full text-left px-3 py-2.5 rounded-lg bg-[#A48242]/10 border border-[#A48242]/30 text-sm font-semibold text-[#A48242] flex items-center gap-1.5"
                        >
                          <Plus size={14} /> Nuevo proveedor «{query.trim()}»
                        </button>
                      )}

                      {zoneSuppliers.length === 0 ? (
                        <p className="text-xs text-muted-foreground px-1">
                          Todavía no hay proveedores cargados en la zona. Escribí el nombre para crearlo.
                        </p>
                      ) : (
                        <div className="max-h-[50vh] overflow-y-auto border border-border rounded-lg divide-y divide-border bg-background">
                          {filtered.length === 0 && (
                            <p className="px-3 py-2 text-xs text-muted-foreground">Ningún proveedor de la zona coincide</p>
                          )}
                          {filtered.map((s) => {
                            const linked = linkedSupplierIds.has(s.SupplierId);
                            const activeSellers = s.Sellers.filter((v) => v.IsActive !== false);
                            return (
                              <button
                                key={s.SupplierId}
                                type="button"
                                onClick={() => pickSupplier(s)}
                                className="w-full text-left px-3 py-2.5 hover:bg-muted/50"
                              >
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium text-foreground">{s.Name}</span>
                                  {linked && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-semibold">ya cargado</span>
                                  )}
                                  {s.SupplierTypeName && (
                                    <span className="text-[10px] text-muted-foreground ml-auto shrink-0">{s.SupplierTypeName}</span>
                                  )}
                                </div>
                                {activeSellers.length > 0 && (
                                  <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                                    {activeSellers.map((v) => formatSeller(v)).join(" · ")}
                                  </p>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      )}
                      <p className="text-[11px] text-muted-foreground px-1">
                        {zoneSuppliers.length} proveedores en la zona
                      </p>
                    </>
                  )}

                  {/* 2. Proveedor existente: elegir vendedor */}
                  {mode === "existing" && selected && (
                    <>
                      <div className="flex items-start justify-between gap-2 p-3 rounded-lg bg-muted/50">
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-foreground">{selected.Name}</p>
                          {(selected.SupplierTypeName || getTypeName(selected.SupplierTypeId)) && (
                            <p className="text-xs text-muted-foreground">{selected.SupplierTypeName || getTypeName(selected.SupplierTypeId)}</p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => { setSelected(null); setMode("search"); }}
                          className="text-xs font-semibold text-[#A48242] shrink-0"
                        >
                          Cambiar
                        </button>
                      </div>
                      {renderSellerPicker(selected.Sellers)}
                    </>
                  )}

                  {/* 3. Proveedor nuevo */}
                  {mode === "new" && (
                    <>
                      <div className="space-y-2">
                        <input
                          type="text"
                          placeholder="Nombre del proveedor *"
                          value={newSupplier.Name}
                          onChange={(e) => setNewSupplier({ ...newSupplier, Name: e.target.value })}
                          className="w-full h-10 px-3 border border-border rounded-lg text-sm bg-background"
                        />
                        {findSupplierByName(zoneSuppliers, newSupplier.Name) && (
                          <p className="text-[11px] text-amber-700">
                            Ya existe en la zona: se va a usar el existente.
                          </p>
                        )}
                        <select
                          value={newSupplier.SupplierTypeId}
                          onChange={(e) => setNewSupplier({ ...newSupplier, SupplierTypeId: e.target.value ? Number(e.target.value) : "" })}
                          className="w-full h-10 px-3 border border-border rounded-lg text-sm bg-background"
                        >
                          <option value="">Tipo de proveedor...</option>
                          {supplierTypes.map((t) => (
                            <option key={t.SupplierTypeId} value={t.SupplierTypeId}>{t.Name}</option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <p className="text-xs font-semibold text-muted-foreground mb-1.5">Productos que trabaja</p>
                        <div className="flex flex-wrap gap-1.5">
                          {productTypes.map((pt) => {
                            const isSel = newSupplier.Products.includes(pt.Name);
                            return (
                              <button
                                key={pt.SupplierProductTypeId}
                                type="button"
                                onClick={() => toggleProduct(pt.Name)}
                                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                                  isSel ? "bg-[#A48242] text-white" : "bg-muted text-muted-foreground hover:bg-muted/80"
                                }`}
                              >
                                {isSel && <Check size={10} className="inline mr-1" />}
                                {pt.Name}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {renderSellerPicker([])}

                      <button
                        type="button"
                        onClick={() => { setQuery(newSupplier.Name); setMode("search"); }}
                        className="text-xs font-semibold text-[#A48242]"
                      >
                        ← Volver a buscar
                      </button>
                    </>
                  )}

                  {mode !== "search" && (
                    <Button
                      onClick={handleSave}
                      disabled={!canSave}
                      className="w-full bg-[#A48242] hover:bg-[#8B6E38] text-white"
                    >
                      {saving ? "Guardando..." : "Guardar proveedor"}
                    </Button>
                  )}
                </CardContent>
              </Card>
            )}

            {!mode && (
              <Button
                onClick={() => { resetForm(); setMode("search"); }}
                variant="outline"
                className="w-full border-dashed border-2"
              >
                <Plus size={16} className="mr-2" /> Agregar proveedor
              </Button>
            )}
          </>
        )}
      </div>

      {/* Bottom navigation */}
      <div className="fixed bottom-0 left-0 right-0 bg-background border-t border-border p-4 flex gap-3">
        <Button
          variant="outline"
          className="flex-1"
          onClick={() => navigate(`/pos/${id}/pop`, { state: { routeDayId, visitId } })}
        >
          <ArrowLeft size={16} className="mr-2" /> Anterior
        </Button>
        <Button
          className="flex-1 bg-[#A48242] hover:bg-[#8B6E38] text-white"
          onClick={() => navigate(`/pos/${id}/actions`, { state: { routeDayId, visitId } })}
        >
          Siguiente <ArrowRight size={16} className="ml-2" />
        </Button>
      </div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  dashed,
  children,
}: {
  active: boolean;
  onClick: () => void;
  dashed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors border ${
        active
          ? "bg-[#A48242] text-white border-[#A48242]"
          : `bg-muted text-muted-foreground border-transparent hover:bg-muted/80 ${dashed ? "border-dashed border-[#A48242]/50" : ""}`
      }`}
    >
      {active && <Check size={10} className="inline mr-1" />}
      {children}
    </button>
  );
}
