import { useState, useEffect } from "react";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Badge } from "../../components/ui/badge";
import { Plus, Edit, Trash2, Truck, Package, MapPin, BarChart3, Settings, Users, Search } from "lucide-react";
import {
  useApiList,
  supplierTypesApi,
  supplierProductTypesApi,
  zonesApi,
  reportsApi,
} from "@/lib/api";
import { toast } from "sonner";

function LookupSection({
  title,
  icon: Icon,
  items,
  onAdd,
  onUpdate,
  onDelete,
  idKey,
}: {
  title: string;
  icon: React.ElementType;
  items: Array<{ Name: string; IsActive: boolean; [k: string]: unknown }>;
  onAdd: (name: string) => Promise<void>;
  onUpdate: (id: number, data: { Name?: string; IsActive?: boolean }) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  idKey: string;
}) {
  const [newName, setNewName] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [adding, setAdding] = useState(false);

  const handleAdd = async () => {
    if (!newName.trim()) return;
    setAdding(true);
    try {
      await onAdd(newName.trim());
      setNewName("");
      toast.success("Agregado");
    } catch { toast.error("Error al agregar"); }
    setAdding(false);
  };

  const handleSaveEdit = async (id: number) => {
    if (!editName.trim()) return;
    try {
      await onUpdate(id, { Name: editName.trim() });
      setEditId(null);
      toast.success("Actualizado");
    } catch { toast.error("Error al actualizar"); }
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Icon size={18} className="text-[#A48242]" />
          <h2 className="text-lg font-bold text-foreground">{title}</h2>
          <Badge variant="outline" className="ml-auto">{items.length}</Badge>
        </div>

        {/* Add form */}
        <div className="flex gap-2">
          <Input
            placeholder="Nuevo nombre..."
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          />
          <Button onClick={handleAdd} disabled={adding || !newName.trim()} size="sm" className="bg-[#A48242] hover:bg-[#8B6E38] text-white">
            <Plus size={16} />
          </Button>
        </div>

        {/* List */}
        <div className="divide-y divide-border">
          {items.map((item) => {
            const itemId = item[idKey] as number;
            return (
              <div key={itemId} className="flex items-center gap-2 py-2">
                {editId === itemId ? (
                  <>
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSaveEdit(itemId)}
                      className="flex-1"
                      autoFocus
                    />
                    <Button size="sm" variant="outline" onClick={() => handleSaveEdit(itemId)}>OK</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditId(null)}>X</Button>
                  </>
                ) : (
                  <>
                    <span className={`flex-1 text-sm ${!item.IsActive ? "line-through text-muted-foreground" : "text-foreground"}`}>
                      {item.Name}
                    </span>
                    {!item.IsActive && <Badge variant="secondary" className="text-[10px]">Inactivo</Badge>}
                    <button onClick={() => { setEditId(itemId); setEditName(item.Name); }} className="p-1.5 hover:bg-muted rounded text-muted-foreground">
                      <Edit size={14} />
                    </button>
                    <button
                      onClick={async () => {
                        if (item.IsActive) {
                          await onDelete(itemId);
                          toast.success("Desactivado");
                        } else {
                          await onUpdate(itemId, { IsActive: true });
                          toast.success("Reactivado");
                        }
                      }}
                      className={`p-1.5 rounded ${item.IsActive ? "hover:bg-red-50 text-red-400" : "hover:bg-green-50 text-green-600"}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function ZoneSection() {
  const { data: zones, refetch } = useApiList(() => zonesApi.list());
  const [newName, setNewName] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [adding, setAdding] = useState(false);

  const handleAdd = async () => {
    if (!newName.trim()) return;
    setAdding(true);
    try {
      await zonesApi.create({ Name: newName.trim() });
      setNewName("");
      toast.success("Zona creada");
      refetch();
    } catch { toast.error("Error al crear zona"); }
    setAdding(false);
  };

  const handleSaveEdit = async (id: number) => {
    if (!editName.trim()) return;
    try {
      await zonesApi.update(id, { Name: editName.trim() });
      setEditId(null);
      toast.success("Zona actualizada");
      refetch();
    } catch { toast.error("Error al actualizar"); }
  };

  const handleDelete = async (id: number) => {
    try {
      await zonesApi.delete(id);
      toast.success("Zona eliminada");
      refetch();
    } catch { toast.error("No se puede eliminar (puede tener PDVs o usuarios asignados)"); }
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <MapPin size={18} className="text-[#A48242]" />
          <h2 className="text-lg font-bold text-foreground">Zonas</h2>
          <Badge variant="outline" className="ml-auto">{zones.length}</Badge>
        </div>

        <div className="flex gap-2">
          <Input
            placeholder="Nueva zona..."
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          />
          <Button onClick={handleAdd} disabled={adding || !newName.trim()} size="sm" className="bg-[#A48242] hover:bg-[#8B6E38] text-white">
            <Plus size={16} />
          </Button>
        </div>

        <div className="divide-y divide-border">
          {zones.map((zone) => (
            <div key={zone.ZoneId} className="flex items-center gap-2 py-2">
              {editId === zone.ZoneId ? (
                <>
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSaveEdit(zone.ZoneId)}
                    className="flex-1"
                    autoFocus
                  />
                  <Button size="sm" variant="outline" onClick={() => handleSaveEdit(zone.ZoneId)}>OK</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditId(null)}>X</Button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm text-foreground">{zone.Name}</span>
                  <button onClick={() => { setEditId(zone.ZoneId); setEditName(zone.Name); }} className="p-1.5 hover:bg-muted rounded text-muted-foreground">
                    <Edit size={14} />
                  </button>
                  <button onClick={() => handleDelete(zone.ZoneId)} className="p-1.5 rounded hover:bg-red-50 text-red-400">
                    <Trash2 size={14} />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

type SupplierAnalytics = Awaited<ReturnType<typeof reportsApi.supplierAnalytics>>;

function AnalyticsView({ analytics, loading }: { analytics: SupplierAnalytics | null; loading: boolean }) {
  const [search, setSearch] = useState("");

  if (loading) return <div className="py-12 text-center text-muted-foreground">Cargando analytics...</div>;
  if (!analytics) return <div className="py-12 text-center text-muted-foreground">Sin datos de proveedores</div>;

  const filteredTop = analytics.topSuppliers.filter((s) =>
    !search || s.name.toLowerCase().includes(search.toLowerCase()) || s.phone.includes(search)
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-[#A48242]/10 border-[#A48242]/30">
          <CardContent className="p-4 text-center">
            <Truck size={24} className="mx-auto text-[#A48242] mb-1" />
            <p className="text-2xl font-bold text-foreground">{analytics.totalSuppliers}</p>
            <p className="text-xs text-[#A48242]">Proveedores censados</p>
          </CardContent>
        </Card>
        <Card className="bg-blue-50 border-blue-200">
          <CardContent className="p-4 text-center">
            <MapPin size={24} className="mx-auto text-blue-600 mb-1" />
            <p className="text-2xl font-bold text-blue-900">{analytics.totalPdvsWithSuppliers}</p>
            <p className="text-xs text-blue-600">PDVs con proveedores</p>
          </CardContent>
        </Card>
        <Card className="bg-green-50 border-green-200">
          <CardContent className="p-4 text-center">
            <Users size={24} className="mx-auto text-green-600 mb-1" />
            <p className="text-2xl font-bold text-green-900">{analytics.byType.length}</p>
            <p className="text-xs text-green-600">Tipos de proveedor</p>
          </CardContent>
        </Card>
        <Card className="bg-amber-50 border-amber-200">
          <CardContent className="p-4 text-center">
            <Package size={24} className="mx-auto text-amber-600 mb-1" />
            <p className="text-2xl font-bold text-amber-900">{analytics.byProduct.length}</p>
            <p className="text-xs text-amber-600">Categorias de producto</p>
          </CardContent>
        </Card>
      </div>

      {/* Distribution cards */}
      <div className="grid md:grid-cols-3 gap-4">
        {analytics.byType.length > 0 && (
          <Card><CardContent className="p-4">
            <h3 className="text-sm font-bold text-muted-foreground uppercase mb-3">Por tipo</h3>
            {analytics.byType.map((t) => (
              <div key={t.type} className="flex justify-between py-1.5 border-b border-border last:border-0">
                <span className="text-sm">{t.type}</span><Badge variant="secondary">{t.count}</Badge>
              </div>
            ))}
          </CardContent></Card>
        )}
        {analytics.byZone.length > 0 && (
          <Card><CardContent className="p-4">
            <h3 className="text-sm font-bold text-muted-foreground uppercase mb-3">Por zona</h3>
            {analytics.byZone.map((z) => (
              <div key={z.zone} className="flex justify-between py-1.5 border-b border-border last:border-0">
                <span className="text-sm">{z.zone}</span><Badge variant="secondary">{z.count}</Badge>
              </div>
            ))}
          </CardContent></Card>
        )}
        {analytics.byProduct.length > 0 && (
          <Card><CardContent className="p-4">
            <h3 className="text-sm font-bold text-muted-foreground uppercase mb-3">Por producto</h3>
            {analytics.byProduct.map((p) => (
              <div key={p.product} className="flex justify-between py-1.5 border-b border-border last:border-0">
                <span className="text-sm">{p.product}</span><Badge variant="secondary">{p.count}</Badge>
              </div>
            ))}
          </CardContent></Card>
        )}
      </div>

      {/* Top suppliers table */}
      {analytics.topSuppliers.length > 0 && (
        <div>
          <div className="relative mb-3">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Buscar proveedor..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Card><CardContent className="p-0">
            <table className="w-full text-sm">
              <thead><tr className="border-b bg-muted">
                <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase">Proveedor</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase">Telefono</th>
                <th className="text-center py-3 px-4 text-xs font-semibold text-muted-foreground uppercase">Tipo</th>
                <th className="text-center py-3 px-4 text-xs font-semibold text-muted-foreground uppercase">PDVs</th>
              </tr></thead>
              <tbody>
                {filteredTop.map((s, i) => (
                  <tr key={i} className="border-b hover:bg-muted/50">
                    <td className="py-2.5 px-4 font-medium">{s.name}</td>
                    <td className="py-2.5 px-4 text-muted-foreground">{s.phone}</td>
                    <td className="py-2.5 px-4 text-center"><Badge variant="outline">{s.type}</Badge></td>
                    <td className="py-2.5 px-4 text-center font-bold">{s.pdvCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent></Card>
        </div>
      )}
    </div>
  );
}

export function SupplierConfig() {
  const [activeTab, setActiveTab] = useState<"data" | "config">("data");
  const { data: types, refetch: refetchTypes } = useApiList(() => supplierTypesApi.listAll());
  const { data: productTypes, refetch: refetchProducts } = useApiList(() => supplierProductTypesApi.listAll());
  const [analytics, setAnalytics] = useState<SupplierAnalytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  useEffect(() => {
    setAnalyticsLoading(true);
    reportsApi.supplierAnalytics().then(setAnalytics).catch(() => {}).finally(() => setAnalyticsLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-1">Proveedores</h1>
          <p className="text-muted-foreground">{activeTab === "data" ? "Analytics y distribucion de proveedores" : "Configurar zonas, tipos y productos"}</p>
        </div>
        <div className="flex items-center gap-2 bg-muted rounded-lg p-1">
          <button onClick={() => setActiveTab("data")} className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === "data" ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            <BarChart3 size={16} /> Datos
          </button>
          <button onClick={() => setActiveTab("config")} className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === "config" ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            <Settings size={16} /> Configuracion
          </button>
        </div>
      </div>

      {activeTab === "data" ? (
        <AnalyticsView analytics={analytics} loading={analyticsLoading} />
      ) : (
        <div className="max-w-2xl mx-auto space-y-6">
          <ZoneSection />
          <LookupSection title="Tipos de Proveedor" icon={Truck} items={types} idKey="SupplierTypeId"
            onAdd={async (name) => { await supplierTypesApi.create({ Name: name }); refetchTypes(); }}
            onUpdate={async (id, data) => { await supplierTypesApi.update(id, data); refetchTypes(); }}
            onDelete={async (id) => { await supplierTypesApi.delete(id); refetchTypes(); }}
          />
          <LookupSection title="Productos de Proveedor" icon={Package} items={productTypes} idKey="SupplierProductTypeId"
            onAdd={async (name) => { await supplierProductTypesApi.create({ Name: name }); refetchProducts(); }}
            onUpdate={async (id, data) => { await supplierProductTypesApi.update(id, data); refetchProducts(); }}
            onDelete={async (id) => { await supplierProductTypesApi.delete(id); refetchProducts(); }}
          />
        </div>
      )}
    </div>
  );
}
