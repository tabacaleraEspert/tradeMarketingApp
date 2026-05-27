import { useState, useEffect } from "react";
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
  Phone,
  User,
  Check,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { pdvSuppliersApi, supplierTypesApi, supplierProductTypesApi } from "@/lib/api";
import { fetchWithCache, executeOrEnqueue } from "@/lib/offline";
import type { PdvSupplier, SupplierType, SupplierProductType } from "@/lib/api/types";
import { VisitStepIndicator } from "../components/VisitStepIndicator";
import { useVisitFlow } from "@/lib/VisitFlowContext";

interface SupplierForm {
  Name: string;
  Phone: string;
  SupplierTypeId: number | "";
  Products: string[];
}

const EMPTY_FORM: SupplierForm = { Name: "", Phone: "", SupplierTypeId: "", Products: [] };

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
  const [loading, setLoading] = useState(true);

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<SupplierForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [zoneSuppliers, setZoneSuppliers] = useState<PdvSupplier[]>([]);
  const [showZoneList, setShowZoneList] = useState(false);
  const [phoneSearch, setPhoneSearch] = useState("");

  const pdvId = Number(id);

  useEffect(() => {
    if (!pdvId) return;
    setLoading(true);
    Promise.all([
      fetchWithCache(`pdv_suppliers_${pdvId}`, () => pdvSuppliersApi.list(pdvId)).catch(() => []),
      flow.supplierTypes.length > 0 ? Promise.resolve(flow.supplierTypes) : fetchWithCache("supplier_types", () => supplierTypesApi.list()).catch(() => []),
      flow.supplierProductTypes.length > 0 ? Promise.resolve(flow.supplierProductTypes) : fetchWithCache("supplier_product_types", () => supplierProductTypesApi.list()).catch(() => []),
    ]).then(([s, st, pt]) => {
      setSuppliers(s);
      setSupplierTypes(st);
      setProductTypes(pt);
    }).finally(() => setLoading(false));
  }, [pdvId]);

  // Load zone suppliers when form opens
  useEffect(() => {
    if (showForm && pdvId) {
      pdvSuppliersApi.searchZone(pdvId).then(setZoneSuppliers).catch(() => {});
    }
  }, [showForm, pdvId]);

  // Auto-fill when phone matches an existing supplier
  useEffect(() => {
    if (!form.Phone || form.Phone.length < 6 || editingId) return;
    const match = zoneSuppliers.find((s) => s.Phone === form.Phone.trim());
    if (match && match.Name !== form.Name) {
      setForm((f) => ({
        ...f,
        Name: match.Name,
        SupplierTypeId: match.SupplierTypeId ?? "",
        Products: match.Products ?? [],
      }));
      toast.success(`Proveedor encontrado: ${match.Name}`);
    }
  }, [form.Phone, zoneSuppliers, editingId]);

  const toggleProduct = (name: string) => {
    setForm((f) => ({
      ...f,
      Products: f.Products.includes(name)
        ? f.Products.filter((p) => p !== name)
        : [...f.Products, name],
    }));
  };

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(false);
  };

  const handleSave = async () => {
    if (!form.Name.trim() || !form.Phone.trim()) {
      toast.error("Nombre y teléfono son obligatorios");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        Name: form.Name.trim(),
        Phone: form.Phone.trim(),
        SupplierTypeId: form.SupplierTypeId || undefined,
        Products: form.Products.length > 0 ? form.Products : undefined,
      };
      if (editingId) {
        const result = await executeOrEnqueue({
          kind: "pdv_supplier_update",
          method: "PATCH",
          url: `/pdvs/${pdvId}/suppliers/${editingId}`,
          body: payload,
          label: `Actualizar proveedor: ${payload.Name}`,
          _tempPdvId: pdvId < 0 ? pdvId : undefined,
        });
        if (!result.queued && result.data) {
          setSuppliers((prev) => prev.map((s) => (s.PdvSupplierId === editingId ? result.data as PdvSupplier : s)));
        }
        toast.success(result.queued ? "Proveedor guardado. Se sincronizará con conexión." : "Proveedor actualizado");
      } else {
        const result = await executeOrEnqueue({
          kind: "pdv_supplier_create",
          method: "POST",
          url: `/pdvs/${pdvId}/suppliers`,
          body: payload,
          label: `Nuevo proveedor: ${payload.Name}`,
          _tempPdvId: pdvId < 0 ? pdvId : undefined,
        });
        if (!result.queued && result.data) {
          setSuppliers((prev) => [...prev, result.data as PdvSupplier]);
        } else if (result.queued) {
          // Show locally even though not synced yet
          setSuppliers((prev) => [...prev, { PdvSupplierId: -(Date.now() % 1000000), PdvId: pdvId, ...payload, Products: payload.Products ?? [], CreatedAt: new Date().toISOString() } as any]);
        }
        toast.success(result.queued ? "Proveedor guardado. Se sincronizará con conexión." : "Proveedor agregado");
      }
      resetForm();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (s: PdvSupplier) => {
    setForm({
      Name: s.Name,
      Phone: s.Phone,
      SupplierTypeId: s.SupplierTypeId ?? "",
      Products: s.Products ?? [],
    });
    setEditingId(s.PdvSupplierId);
    setShowForm(true);
  };

  const handleDelete = async (supplierId: number) => {
    try {
      await pdvSuppliersApi.delete(pdvId, supplierId);
      setSuppliers((prev) => prev.filter((s) => s.PdvSupplierId !== supplierId));
      toast.success("Proveedor eliminado");
    } catch {
      toast.error("Error al eliminar");
    }
  };

  const getTypeName = (typeId: number | null) =>
    supplierTypes.find((t) => t.SupplierTypeId === typeId)?.Name ?? "-";

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
            {/* Existing suppliers */}
            {suppliers.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-[#A48242] uppercase tracking-wider flex items-center gap-1">
                  <Truck size={10} /> Proveedores registrados ({suppliers.length})
                </p>
                {suppliers.map((s) => (
                  <Card key={s.PdvSupplierId} className="overflow-hidden">
                    <CardContent className="p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-foreground truncate">{s.Name}</p>
                          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                            <Phone size={10} /> {s.Phone}
                          </p>
                          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                            <User size={10} /> {getTypeName(s.SupplierTypeId)}
                          </p>
                          {s.Products && s.Products.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {s.Products.map((p) => (
                                <span key={p} className="text-[10px] px-1.5 py-0.5 bg-muted rounded-full text-muted-foreground">{p}</span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="flex gap-1">
                          <button onClick={() => handleEdit(s)} className="p-1.5 hover:bg-muted rounded-lg text-muted-foreground">
                            <Pencil size={14} />
                          </button>
                          <button onClick={() => handleDelete(s.PdvSupplierId)} className="p-1.5 hover:bg-red-50 rounded-lg text-red-400">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {suppliers.length === 0 && !showForm && (
              <div className="text-center py-8">
                <Truck size={40} className="mx-auto text-muted-foreground mb-2" />
                <p className="text-muted-foreground font-medium">Sin proveedores registrados</p>
                <p className="text-sm text-muted-foreground mt-1">Agregá el primer proveedor de este PDV</p>
              </div>
            )}

            {/* Add/Edit form */}
            {showForm && (
              <Card className="border-[#A48242]/30">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold text-[#A48242] uppercase">
                      {editingId ? "Editar proveedor" : "Nuevo proveedor"}
                    </p>
                    <button onClick={resetForm} className="p-1 text-muted-foreground hover:text-foreground">
                      <X size={16} />
                    </button>
                  </div>

                  {/* Select from zone suppliers */}
                  {!editingId && zoneSuppliers.length > 0 && (
                    <div>
                      <button
                        type="button"
                        onClick={() => setShowZoneList(!showZoneList)}
                        className="w-full text-left px-3 py-2 rounded-lg bg-blue-50 border border-blue-200 text-xs font-semibold text-blue-700 flex items-center justify-between"
                      >
                        <span><Truck size={12} className="inline mr-1" /> Seleccionar de la zona ({zoneSuppliers.length})</span>
                        <span>{showZoneList ? "▲" : "▼"}</span>
                      </button>
                      {showZoneList && (
                        <div className="mt-1 max-h-40 overflow-y-auto border border-border rounded-lg divide-y divide-border bg-background">
                          {zoneSuppliers
                            .filter((s) => !suppliers.some((ex) => ex.Phone === s.Phone))
                            .map((s) => (
                            <button
                              key={s.PdvSupplierId}
                              type="button"
                              onClick={() => {
                                setForm({ Name: s.Name, Phone: s.Phone, SupplierTypeId: s.SupplierTypeId ?? "", Products: s.Products ?? [] });
                                setShowZoneList(false);
                              }}
                              className="w-full text-left px-3 py-2 hover:bg-muted/50 text-sm"
                            >
                              <span className="font-medium">{s.Name}</span>
                              <span className="text-muted-foreground ml-2 text-xs">{s.Phone}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="space-y-2">
                    <input
                      type="text"
                      placeholder="Nombre del proveedor *"
                      value={form.Name}
                      onChange={(e) => setForm({ ...form, Name: e.target.value })}
                      className="w-full h-10 px-3 border border-border rounded-lg text-sm bg-background"
                    />
                    <input
                      type="tel"
                      inputMode="numeric"
                      placeholder="Teléfono *"
                      value={form.Phone}
                      onChange={(e) => setForm({ ...form, Phone: e.target.value })}
                      className="w-full h-10 px-3 border border-border rounded-lg text-sm bg-background"
                    />
                    <select
                      value={form.SupplierTypeId}
                      onChange={(e) => setForm({ ...form, SupplierTypeId: e.target.value ? Number(e.target.value) : "" })}
                      className="w-full h-10 px-3 border border-border rounded-lg text-sm bg-background"
                    >
                      <option value="">Tipo de proveedor...</option>
                      {supplierTypes.map((t) => (
                        <option key={t.SupplierTypeId} value={t.SupplierTypeId}>{t.Name}</option>
                      ))}
                    </select>
                  </div>

                  {/* Product types multi-select */}
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground mb-1.5">Productos que trabaja</p>
                    <div className="flex flex-wrap gap-1.5">
                      {productTypes.map((pt) => {
                        const selected = form.Products.includes(pt.Name);
                        return (
                          <button
                            key={pt.SupplierProductTypeId}
                            type="button"
                            onClick={() => toggleProduct(pt.Name)}
                            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                              selected
                                ? "bg-[#A48242] text-white"
                                : "bg-muted text-muted-foreground hover:bg-muted/80"
                            }`}
                          >
                            {selected && <Check size={10} className="inline mr-1" />}
                            {pt.Name}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <Button
                    onClick={handleSave}
                    disabled={saving || !form.Name.trim() || !form.Phone.trim()}
                    className="w-full bg-[#A48242] hover:bg-[#8B6E38] text-white"
                  >
                    {saving ? "Guardando..." : editingId ? "Actualizar" : "Agregar proveedor"}
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Add button */}
            {!showForm && (
              <Button
                onClick={() => { resetForm(); setShowForm(true); }}
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
