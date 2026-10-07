import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Badge } from "../../components/ui/badge";
import { Modal, ConfirmModal } from "../../components/ui/modal";
import { SearchInput } from "../../components/ui/search-input";
import { Check, Edit, GitMerge, MapPin, Phone, Plus, Store, Truck, UserPlus, Users, X } from "lucide-react";
import { toast } from "sonner";
import {
  suppliersApi,
  supplierTypesApi,
  supplierProductTypesApi,
  zonesApi,
} from "@/lib/api";
import type { Supplier, SupplierProductType, SupplierSeller, SupplierType, Zone } from "@/lib/api/types";
import { filterSuppliers, formatSeller } from "@/lib/suppliers";

interface SupplierForm {
  Name: string;
  ZoneId: number | "";
  SupplierTypeId: number | "";
  Products: string[];
  IsActive: boolean;
}

const errMsg = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

export function SupplierManagement() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [types, setTypes] = useState<SupplierType[]>([]);
  const [productTypes, setProductTypes] = useState<SupplierProductType[]>([]);
  const [loading, setLoading] = useState(true);

  const [zoneFilter, setZoneFilter] = useState<number | "">("");
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // Alta / edición
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [form, setForm] = useState<SupplierForm>({ Name: "", ZoneId: "", SupplierTypeId: "", Products: [], IsActive: true });
  const [savingForm, setSavingForm] = useState(false);

  // Unificar
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeDestId, setMergeDestId] = useState<number | null>(null);
  const [confirmMerge, setConfirmMerge] = useState(false);
  const [merging, setMerging] = useState(false);

  useEffect(() => {
    Promise.all([
      zonesApi.list().catch(() => [] as Zone[]),
      supplierTypesApi.list().catch(() => [] as SupplierType[]),
      supplierProductTypesApi.list().catch(() => [] as SupplierProductType[]),
    ]).then(([z, t, p]) => {
      setZones(z);
      setTypes(t);
      setProductTypes(p);
    });
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    suppliersApi
      .list({
        ...(zoneFilter !== "" ? { zone_id: zoneFilter } : {}),
        ...(showInactive ? { include_inactive: true } : {}),
      })
      .then((data) => {
        setSuppliers(data);
        setSelectedIds((prev) => new Set([...prev].filter((id) => data.some((s) => s.SupplierId === id))));
      })
      .catch((e) => toast.error(errMsg(e, "No se pudieron cargar los proveedores")))
      .finally(() => setLoading(false));
  }, [zoneFilter, showInactive]);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(() => filterSuppliers(suppliers, search), [suppliers, search]);
  const selected = useMemo(() => suppliers.filter((s) => selectedIds.has(s.SupplierId)), [suppliers, selectedIds]);

  const replaceSupplier = (s: Supplier) => {
    setSuppliers((prev) => (prev.some((x) => x.SupplierId === s.SupplierId) ? prev.map((x) => (x.SupplierId === s.SupplierId ? s : x)) : [...prev, s]));
    setEditing((cur) => (cur && cur.SupplierId === s.SupplierId ? s : cur));
  };

  const toggleSelected = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ── Alta / edición de proveedor ──
  const openCreate = () => {
    setEditing(null);
    setForm({ Name: "", ZoneId: zoneFilter, SupplierTypeId: "", Products: [], IsActive: true });
    setIsFormOpen(true);
  };

  const openEdit = (s: Supplier) => {
    setEditing(s);
    setForm({
      Name: s.Name,
      ZoneId: s.ZoneId ?? "",
      SupplierTypeId: s.SupplierTypeId ?? "",
      Products: s.Products ?? [],
      IsActive: s.IsActive,
    });
    setIsFormOpen(true);
  };

  const closeForm = () => {
    setIsFormOpen(false);
    setEditing(null);
  };

  const handleSaveSupplier = async () => {
    if (!form.Name.trim()) {
      toast.error("El nombre es obligatorio");
      return;
    }
    if (form.ZoneId === "") {
      toast.error("Elegí la zona");
      return;
    }
    setSavingForm(true);
    try {
      const payload = {
        Name: form.Name.trim(),
        ZoneId: form.ZoneId,
        SupplierTypeId: form.SupplierTypeId === "" ? null : form.SupplierTypeId,
        // Sin productos y originalmente null → null (no convertir null en []).
        Products: form.Products.length === 0 && (!editing || editing.Products == null) ? null : form.Products,
      };
      if (editing) {
        const updated = await suppliersApi.update(editing.SupplierId, { ...payload, IsActive: form.IsActive });
        replaceSupplier(updated);
        toast.success("Proveedor actualizado");
        closeForm();
      } else {
        const created = await suppliersApi.create(payload);
        replaceSupplier(created);
        toast.success("Proveedor creado. Ahora podés agregarle vendedores.");
        // Queda abierto en modo edición para cargar vendedores.
        openEdit(created);
      }
    } catch (e) {
      toast.error(errMsg(e, "Error al guardar el proveedor"));
    } finally {
      setSavingForm(false);
    }
  };

  // ── Unificar ──
  const openMerge = () => {
    if (selected.length < 2) return;
    const dest = [...selected].sort((a, b) => b.PdvCount - a.PdvCount)[0];
    setMergeDestId(dest.SupplierId);
    setMergeOpen(true);
  };

  const mergeDest = selected.find((s) => s.SupplierId === mergeDestId) ?? null;
  const mergeSources = selected.filter((s) => s.SupplierId !== mergeDestId);
  const mergeZones = new Set(selected.map((s) => s.ZoneId));

  const doMerge = async () => {
    if (!mergeDest || mergeSources.length === 0) return;
    setMerging(true);
    try {
      await suppliersApi.merge(mergeDest.SupplierId, mergeSources.map((s) => s.SupplierId));
      const n = mergeSources.length;
      toast.success(`${n} ${n === 1 ? "proveedor unificado" : "proveedores unificados"} en «${mergeDest.Name}»`);
      setMergeOpen(false);
      setSelectedIds(new Set());
      load();
    } catch (e) {
      toast.error(errMsg(e, "Error al unificar"));
    } finally {
      setMerging(false);
    }
  };

  const totalSellers = suppliers.reduce((acc, s) => acc + s.Sellers.filter((v) => v.IsActive).length, 0);
  const zoneName = (id: number | null) => zones.find((z) => z.ZoneId === id)?.Name ?? null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-1">Proveedores</h1>
          <p className="text-muted-foreground">
            {suppliers.length} proveedores · {totalSellers} vendedores
          </p>
        </div>
        <Button className="gap-2" onClick={openCreate}>
          <Plus size={16} /> Nuevo proveedor
        </Button>
      </div>

      {/* Filtros */}
      <div className="flex flex-col sm:flex-row gap-2">
        <select
          value={zoneFilter}
          onChange={(e) => setZoneFilter(e.target.value ? Number(e.target.value) : "")}
          className="h-10 px-3 border border-border rounded-lg text-sm bg-background sm:w-56"
        >
          <option value="">Todas las zonas</option>
          {zones.map((z) => (
            <option key={z.ZoneId} value={z.ZoneId}>{z.Name}</option>
          ))}
        </select>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Buscar proveedor, vendedor o teléfono..."
          className="flex-1"
        />
        <label className="flex items-center gap-2 text-sm text-muted-foreground px-1 h-10 shrink-0">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Mostrar inactivos
        </label>
      </div>

      {/* Barra de selección */}
      {selected.length > 0 && (
        <div className="sticky top-16 z-20 flex items-center gap-2 flex-wrap p-3 rounded-lg border border-espert-gold/40 bg-espert-gold/10">
          <span className="text-sm font-semibold text-foreground">
            {selected.length} seleccionado{selected.length === 1 ? "" : "s"}
          </span>
          <span className="text-xs text-muted-foreground hidden sm:inline">
            {selected.length < 2 ? "Elegí 2 o más para unificar duplicados" : ""}
          </span>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setSelectedIds(new Set())}>
              Limpiar
            </Button>
            <Button size="sm" className="gap-1.5" disabled={selected.length < 2} onClick={openMerge}>
              <GitMerge size={14} /> Unificar
            </Button>
          </div>
        </div>
      )}

      {/* Listado */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <p className="text-muted-foreground">Cargando proveedores...</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="text-center py-16">
          <Truck size={40} className="mx-auto text-muted-foreground mb-2" />
          <p className="text-muted-foreground font-medium">
            {suppliers.length === 0 ? "No hay proveedores cargados" : "Ningún proveedor coincide con la búsqueda"}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((s) => {
            const isSel = selectedIds.has(s.SupplierId);
            const activeSellers = s.Sellers.filter((v) => v.IsActive);
            return (
              <Card key={s.SupplierId} className={`${isSel ? "border-espert-gold ring-1 ring-espert-gold/40" : ""} ${s.IsActive ? "" : "opacity-60"}`}>
                <CardContent className="p-3 sm:p-4">
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={isSel}
                      onChange={() => toggleSelected(s.SupplierId)}
                      className="mt-1 h-4 w-4 shrink-0 accent-[#A48242]"
                      aria-label={`Seleccionar ${s.Name}`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-foreground">{s.Name}</span>
                        {s.SupplierTypeName && <Badge variant="outline" className="text-[10px]">{s.SupplierTypeName}</Badge>}
                        {!s.IsActive && <Badge className="bg-muted text-muted-foreground text-[10px]">Inactivo</Badge>}
                      </div>
                      <div className="flex items-center gap-3 flex-wrap mt-1 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <MapPin size={11} /> {s.ZoneName ?? zoneName(s.ZoneId) ?? "Sin zona"}
                        </span>
                        <span className="inline-flex items-center gap-1 font-semibold text-espert-gold tabular-nums">
                          <Store size={11} /> {s.PdvCount} {s.PdvCount === 1 ? "PDV" : "PDVs"}
                        </span>
                        {s.Products && s.Products.length > 0 && (
                          <span className="truncate">{s.Products.join(" · ")}</span>
                        )}
                      </div>
                      {activeSellers.length > 0 ? (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {activeSellers.map((v) => (
                            <span key={v.SupplierSellerId} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 bg-muted rounded-full text-foreground">
                              <Users size={10} className="text-muted-foreground" /> {formatSeller(v)}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[11px] text-muted-foreground italic mt-1">Sin vendedores</p>
                      )}
                    </div>
                    <Button variant="outline" size="sm" className="gap-1 shrink-0" onClick={() => openEdit(s)}>
                      <Edit size={14} /> <span className="hidden sm:inline">Editar</span>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Modal alta / edición */}
      <Modal
        isOpen={isFormOpen}
        onClose={closeForm}
        title={editing ? "Editar proveedor" : "Nuevo proveedor"}
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={closeForm}>Cerrar</Button>
            <Button onClick={handleSaveSupplier} disabled={savingForm}>
              {savingForm ? "Guardando..." : editing ? "Guardar cambios" : "Crear proveedor"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground">Nombre *</label>
            <Input value={form.Name} onChange={(e) => setForm({ ...form, Name: e.target.value })} placeholder="Nombre del proveedor" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted-foreground">Zona *</label>
              <select
                value={form.ZoneId}
                onChange={(e) => setForm({ ...form, ZoneId: e.target.value ? Number(e.target.value) : "" })}
                className="w-full h-10 px-3 border border-border rounded-lg text-sm bg-background"
              >
                <option value="">Elegí la zona...</option>
                {zones.map((z) => (
                  <option key={z.ZoneId} value={z.ZoneId}>{z.Name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted-foreground">Tipo</label>
              <select
                value={form.SupplierTypeId}
                onChange={(e) => setForm({ ...form, SupplierTypeId: e.target.value ? Number(e.target.value) : "" })}
                className="w-full h-10 px-3 border border-border rounded-lg text-sm bg-background"
              >
                <option value="">Sin tipo</option>
                {types.map((t) => (
                  <option key={t.SupplierTypeId} value={t.SupplierTypeId}>{t.Name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground">Productos que trabaja</label>
            <div className="flex flex-wrap gap-1.5">
              {productTypes.map((pt) => {
                const on = form.Products.includes(pt.Name);
                return (
                  <button
                    key={pt.SupplierProductTypeId}
                    type="button"
                    onClick={() =>
                      setForm({ ...form, Products: on ? form.Products.filter((p) => p !== pt.Name) : [...form.Products, pt.Name] })
                    }
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                      on ? "bg-[#A48242] text-white" : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                  >
                    {on && <Check size={10} className="inline mr-1" />}
                    {pt.Name}
                  </button>
                );
              })}
            </div>
          </div>
          {editing && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.IsActive} onChange={(e) => setForm({ ...form, IsActive: e.target.checked })} />
              Activo
            </label>
          )}
          {editing && editing.PdvCount > 0 && (
            <p className="text-[11px] text-muted-foreground">
              Los cambios de nombre, zona, tipo y productos se aplican a los {editing.PdvCount} PDVs vinculados.
            </p>
          )}

          {editing && <SellersEditor supplier={editing} onChange={replaceSupplier} />}
        </div>
      </Modal>

      {/* Modal unificar */}
      <Modal
        isOpen={mergeOpen}
        onClose={() => setMergeOpen(false)}
        title="Unificar proveedores"
        size="md"
        footer={
          <>
            <Button variant="outline" onClick={() => setMergeOpen(false)}>Cancelar</Button>
            <Button className="gap-1.5" disabled={!mergeDest || merging} onClick={() => setConfirmMerge(true)}>
              <GitMerge size={14} /> {merging ? "Unificando..." : "Unificar"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Elegí el proveedor que queda. Los demás se desactivan y sus vendedores y PDVs pasan al elegido.
          </p>
          {mergeZones.size > 1 && (
            <p className="text-xs p-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-800">
              Ojo: los proveedores seleccionados son de zonas distintas.
            </p>
          )}
          <div className="space-y-1.5">
            {selected.map((s) => (
              <label
                key={s.SupplierId}
                className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer ${
                  mergeDestId === s.SupplierId ? "border-espert-gold bg-espert-gold/10" : "border-border"
                }`}
              >
                <input
                  type="radio"
                  name="merge-dest"
                  checked={mergeDestId === s.SupplierId}
                  onChange={() => setMergeDestId(s.SupplierId)}
                  className="mt-1 accent-[#A48242]"
                />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">{s.Name}</p>
                  <p className="text-xs text-muted-foreground">
                    {s.ZoneName ?? zoneName(s.ZoneId) ?? "Sin zona"} · {s.PdvCount} PDVs · {s.Sellers.filter((v) => v.IsActive).length} vendedores
                  </p>
                </div>
                {mergeDestId === s.SupplierId && (
                  <Badge className="ml-auto bg-espert-gold text-white text-[10px] shrink-0">Queda</Badge>
                )}
              </label>
            ))}
          </div>
        </div>
      </Modal>

      <ConfirmModal
        isOpen={confirmMerge}
        onClose={() => setConfirmMerge(false)}
        onConfirm={doMerge}
        title="Confirmar unificación"
        message={
          mergeDest
            ? `Se van a unificar ${mergeSources.map((s) => `«${s.Name}»`).join(", ")} en «${mergeDest.Name}». Los PDVs y vendedores pasan a «${mergeDest.Name}» y los demás quedan inactivos. No se puede deshacer desde la app.`
            : ""
        }
        confirmText="Sí, unificar"
        type="warning"
      />
    </div>
  );
}

/** Vendedores del proveedor: alta, edición inline y baja/alta lógica. */
function SellersEditor({ supplier, onChange }: { supplier: Supplier; onChange: (s: Supplier) => void }) {
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");

  const handleAdd = async () => {
    if (!newName.trim()) return;
    setAdding(true);
    try {
      const phone = newPhone.trim();
      const added = await suppliersApi.addSeller(supplier.SupplierId, { Name: newName.trim(), ...(phone ? { Phone: phone } : {}) });
      // POST devuelve solo vendedores activos: refetch con inactivos para que no desaparezcan.
      const full = await suppliersApi
        .list({ ...(added.ZoneId != null ? { zone_id: added.ZoneId } : {}), include_inactive: true })
        .then((list) => list.find((x) => x.SupplierId === added.SupplierId))
        .catch(() => undefined);
      onChange(full ?? added);
      setNewName("");
      setNewPhone("");
      toast.success("Vendedor agregado");
    } catch (e) {
      toast.error(errMsg(e, "Error al agregar el vendedor"));
    } finally {
      setAdding(false);
    }
  };

  const startEdit = (v: SupplierSeller) => {
    setEditId(v.SupplierSellerId);
    setEditName(v.Name);
    setEditPhone(v.Phone ?? "");
  };

  const handleSaveEdit = async (v: SupplierSeller) => {
    if (!editName.trim()) {
      toast.error("El nombre es obligatorio");
      return;
    }
    try {
      const updated = await suppliersApi.updateSeller(supplier.SupplierId, v.SupplierSellerId, {
        Name: editName.trim(),
        Phone: editPhone.trim() || null,
      });
      onChange(updated);
      setEditId(null);
      toast.success("Vendedor actualizado");
    } catch (e) {
      toast.error(errMsg(e, "Error al actualizar el vendedor"));
    }
  };

  const toggleActive = async (v: SupplierSeller) => {
    try {
      const updated = await suppliersApi.updateSeller(supplier.SupplierId, v.SupplierSellerId, { IsActive: !v.IsActive });
      onChange(updated);
      toast.success(v.IsActive ? "Vendedor desactivado" : "Vendedor reactivado");
    } catch (e) {
      toast.error(errMsg(e, "Error al cambiar el estado"));
    }
  };

  return (
    <div className="space-y-2 pt-3 border-t border-border">
      <p className="text-sm font-bold text-foreground flex items-center gap-1.5">
        <Users size={14} className="text-espert-gold" /> Vendedores
      </p>
      {supplier.Sellers.length === 0 && (
        <p className="text-xs text-muted-foreground italic">Sin vendedores cargados</p>
      )}
      <div className="space-y-1.5">
        {supplier.Sellers.map((v) =>
          editId === v.SupplierSellerId ? (
            <div key={v.SupplierSellerId} className="flex flex-col sm:flex-row gap-2 p-2 rounded-lg bg-muted/50">
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Nombre *" className="flex-1" />
              <Input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder="Teléfono (opcional)" type="tel" className="sm:w-44" />
              <div className="flex gap-1">
                <Button size="sm" onClick={() => handleSaveEdit(v)}><Check size={14} /></Button>
                <Button size="sm" variant="outline" onClick={() => setEditId(null)}><X size={14} /></Button>
              </div>
            </div>
          ) : (
            <div key={v.SupplierSellerId} className={`flex items-center gap-2 p-2 rounded-lg border border-border ${v.IsActive ? "" : "opacity-60"}`}>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{v.Name}</p>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Phone size={10} /> {v.Phone || <span className="italic">Sin teléfono</span>}
                  {!v.IsActive && <span className="ml-2 font-semibold">· Inactivo</span>}
                </p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => startEdit(v)} aria-label="Editar vendedor">
                <Edit size={14} />
              </Button>
              <Button size="sm" variant="outline" className="text-xs" onClick={() => toggleActive(v)}>
                {v.IsActive ? "Desactivar" : "Reactivar"}
              </Button>
            </div>
          ),
        )}
      </div>
      <div className="flex flex-col sm:flex-row gap-2 pt-1">
        <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nuevo vendedor *" className="flex-1"
          onKeyDown={(e) => e.key === "Enter" && handleAdd()} />
        <Input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="Teléfono (opcional)" type="tel" className="sm:w-44"
          onKeyDown={(e) => e.key === "Enter" && handleAdd()} />
        <Button onClick={handleAdd} disabled={adding || !newName.trim()} className="gap-1">
          <UserPlus size={14} /> Agregar
        </Button>
      </div>
    </div>
  );
}
