import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Badge } from "../../components/ui/badge";
import { Modal, ConfirmModal } from "../../components/ui/modal";
import { Switch } from "../../components/ui/switch";
import {
  Search,
  Plus,
  Edit,
  Trash2,
  Package,
  CheckCircle,
  Award,
  LayoutGrid,
  Settings,
  BarChart3,
  TrendingUp,
  MapPin,
  AlertTriangle,
  ArrowUpDown,
} from "lucide-react";
import { productsApi, reportsApi } from "@/lib/api";
import type { Product } from "@/lib/api";
import { toast } from "sonner";

const PREDEFINED_CATEGORIES = [
  "cigarrillos",
  "tabacos",
  "vapers",
  "pouches",
  "papelillos",
  "accesorios",
];

const CATEGORY_LABELS: Record<string, string> = {
  cigarrillos: "Cigarrillos",
  tabacos: "Tabacos",
  vapers: "Vapers",
  pouches: "Pouches",
  papelillos: "Papelillos",
  accesorios: "Accesorios",
};

function categoryLabel(cat: string): string {
  return CATEGORY_LABELS[cat] || cat.charAt(0).toUpperCase() + cat.slice(1);
}

interface ProductForm {
  Name: string;
  Category: string;
  CustomCategory: string;
  Manufacturer: string;
  IsOwn: boolean;
  SortOrder: number;
}

const emptyForm: ProductForm = {
  Name: "",
  Category: "cigarrillos",
  CustomCategory: "",
  Manufacturer: "",
  IsOwn: true,
  SortOrder: 0,
};

type ProductAnalytics = Awaited<ReturnType<typeof reportsApi.productAnalytics>>;

// ─── Analytics Tab ─────────────────────────────────────────────────

function AnalyticsView({ analytics, loading }: { analytics: ProductAnalytics | null; loading: boolean }) {
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState<string | null>(null);
  const [ownFilter, setOwnFilter] = useState<"all" | "own" | "competitor">("all");
  const [sortField, setSortField] = useState<string>("worksCount");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  if (loading) return <div className="py-12 text-center text-muted-foreground">Cargando analytics...</div>;
  if (!analytics) return <div className="py-12 text-center text-muted-foreground">Sin datos de cobertura disponibles</div>;

  const { byProduct, byCategory, totalPdvsWithCoverage, totalVisitsWithCoverage } = analytics;

  const avgCoverage = byProduct.length > 0
    ? Math.round(byProduct.reduce((s, p) => s + p.worksCount, 0) / Math.max(byProduct.reduce((s, p) => s + p.pdvCount, 0), 1) * 100)
    : 0;
  const avgPrice = (() => {
    const prices = byProduct.filter((p) => p.avgPrice != null).map((p) => p.avgPrice!);
    return prices.length > 0 ? Math.round(prices.reduce((s, v) => s + v, 0) / prices.length) : 0;
  })();

  const categories = [...new Set(byProduct.map((p) => p.Category))].sort();

  const filtered = byProduct
    .filter((p) => {
      if (catFilter && p.Category !== catFilter) return false;
      if (ownFilter === "own" && !p.IsOwn) return false;
      if (ownFilter === "competitor" && p.IsOwn) return false;
      if (search) {
        const t = search.toLowerCase();
        if (!p.Name.toLowerCase().includes(t) && !(p.Manufacturer || "").toLowerCase().includes(t)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const av = (a as any)[sortField] ?? 0;
      const bv = (b as any)[sortField] ?? 0;
      return sortDir === "asc" ? av - bv : bv - av;
    });

  const SortHeader = ({ field, children }: { field: string; children: React.ReactNode }) => (
    <th
      className="py-3 px-3 text-xs font-semibold text-muted-foreground uppercase cursor-pointer hover:text-foreground select-none"
      onClick={() => { if (sortField === field) setSortDir((d) => d === "asc" ? "desc" : "asc"); else { setSortField(field); setSortDir("desc"); } }}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {sortField === field && <ArrowUpDown size={10} className="text-[#A48242]" />}
      </span>
    </th>
  );

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-[#A48242]/10 border-[#A48242]/30">
          <CardContent className="p-4 text-center">
            <Package size={24} className="mx-auto text-[#A48242] mb-1" />
            <p className="text-2xl font-bold text-foreground">{byProduct.length}</p>
            <p className="text-xs text-[#A48242]">Productos con datos</p>
          </CardContent>
        </Card>
        <Card className="bg-green-50 border-green-200">
          <CardContent className="p-4 text-center">
            <TrendingUp size={24} className="mx-auto text-green-600 mb-1" />
            <p className="text-2xl font-bold text-green-900">{avgCoverage}%</p>
            <p className="text-xs text-green-600">Cobertura promedio</p>
          </CardContent>
        </Card>
        <Card className="bg-blue-50 border-blue-200">
          <CardContent className="p-4 text-center">
            <MapPin size={24} className="mx-auto text-blue-600 mb-1" />
            <p className="text-2xl font-bold text-blue-900">{totalPdvsWithCoverage}</p>
            <p className="text-xs text-blue-600">PDVs censados</p>
          </CardContent>
        </Card>
        <Card className="bg-amber-50 border-amber-200">
          <CardContent className="p-4 text-center">
            <BarChart3 size={24} className="mx-auto text-amber-600 mb-1" />
            <p className="text-2xl font-bold text-amber-900">${avgPrice}</p>
            <p className="text-xs text-amber-600">Precio promedio</p>
          </CardContent>
        </Card>
      </div>

      {/* Category coverage summary */}
      {byCategory.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <h3 className="text-sm font-bold text-muted-foreground uppercase mb-3">Cobertura por Categoria</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {byCategory.map((c) => (
                <div key={c.Category} className="text-center p-2 bg-muted rounded-lg">
                  <p className="text-xs font-semibold text-muted-foreground">{c.Category}</p>
                  <p className="text-lg font-bold text-foreground">{c.avgCoverage}%</p>
                  <p className="text-[10px] text-muted-foreground">{c.productCount} productos</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Buscar producto o fabricante..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select value={catFilter || ""} onChange={(e) => setCatFilter(e.target.value || null)} className="h-10 px-3 border border-border rounded-lg text-sm bg-background">
          <option value="">Todas las categorias</option>
          {categories.map((c) => <option key={c} value={c}>{categoryLabel(c)}</option>)}
        </select>
        <select value={ownFilter} onChange={(e) => setOwnFilter(e.target.value as any)} className="h-10 px-3 border border-border rounded-lg text-sm bg-background">
          <option value="all">Todos</option>
          <option value="own">Propios</option>
          <option value="competitor">Competencia</option>
        </select>
      </div>

      {/* Analytics table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted">
                  <th className="text-left py-3 px-3 text-xs font-semibold text-muted-foreground uppercase">Producto</th>
                  <SortHeader field="pdvCount">PDVs</SortHeader>
                  <SortHeader field="worksCount">Trabaja</SortHeader>
                  <SortHeader field="avgPrice">$ Prom</SortHeader>
                  <SortHeader field="medianPrice">$ Mediana</SortHeader>
                  <SortHeader field="minPrice">$ Min</SortHeader>
                  <SortHeader field="maxPrice">$ Max</SortHeader>
                  <SortHeader field="stdDev">Desvio</SortHeader>
                  <SortHeader field="outOfStockCount">Quiebre</SortHeader>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const worksPercent = p.pdvCount > 0 ? Math.round(p.worksCount / p.pdvCount * 100) : 0;
                  const quiebrePercent = p.worksCount > 0 ? Math.round(p.outOfStockCount / p.worksCount * 100) : 0;
                  return (
                    <tr key={p.ProductId} className="border-b border-border hover:bg-muted/50 transition-colors">
                      <td className="py-2.5 px-3">
                        <p className="font-semibold text-foreground">{p.Name}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {p.Manufacturer || "-"} · {p.IsOwn ? "Espert" : "Competencia"} · {categoryLabel(p.Category)}
                        </p>
                      </td>
                      <td className="py-2.5 px-3 text-center font-medium">{p.pdvCount}</td>
                      <td className="py-2.5 px-3 text-center">
                        <span className={`font-bold ${worksPercent >= 70 ? "text-green-600" : worksPercent >= 40 ? "text-amber-600" : "text-red-500"}`}>
                          {worksPercent}%
                        </span>
                        <span className="text-[10px] text-muted-foreground ml-1">({p.worksCount})</span>
                      </td>
                      <td className="py-2.5 px-3 text-center font-medium">{p.avgPrice != null ? `$${p.avgPrice}` : "-"}</td>
                      <td className="py-2.5 px-3 text-center text-muted-foreground">{p.medianPrice != null ? `$${p.medianPrice}` : "-"}</td>
                      <td className="py-2.5 px-3 text-center text-muted-foreground">{p.minPrice != null ? `$${p.minPrice}` : "-"}</td>
                      <td className="py-2.5 px-3 text-center text-muted-foreground">{p.maxPrice != null ? `$${p.maxPrice}` : "-"}</td>
                      <td className="py-2.5 px-3 text-center text-muted-foreground">{p.stdDev != null ? `$${p.stdDev}` : "-"}</td>
                      <td className="py-2.5 px-3 text-center">
                        {quiebrePercent > 0 ? (
                          <span className="inline-flex items-center gap-0.5 text-red-500 font-medium">
                            <AlertTriangle size={12} /> {quiebrePercent}%
                          </span>
                        ) : (
                          <span className="text-green-600">0%</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filtered.length === 0 && (
            <p className="text-center py-8 text-muted-foreground">Sin resultados</p>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground text-center">
        Basado en {totalVisitsWithCoverage} visitas con cobertura · {totalPdvsWithCoverage} PDVs censados
      </p>
    </div>
  );
}

// ─── Config Tab (lo que existía antes) ─────────────────────────────

function ConfigView({
  products, allCategories, filtered, grouped,
  totalProducts, activeProducts, ownProducts, categoryCount,
  searchTerm, setSearchTerm, categoryFilter, setCategoryFilter,
  openCreate, openEdit, handleToggleActive, setDeleteProduct,
}: {
  products: Product[]; allCategories: string[]; filtered: Product[];
  grouped: Map<string, Product[]>;
  totalProducts: number; activeProducts: number; ownProducts: number; categoryCount: number;
  searchTerm: string; setSearchTerm: (v: string) => void;
  categoryFilter: string | null; setCategoryFilter: (v: string | null) => void;
  openCreate: () => void; openEdit: (p: Product) => void;
  handleToggleActive: (p: Product) => void; setDeleteProduct: (p: Product) => void;
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <Button className="gap-2" onClick={openCreate}>
          <Plus size={16} /> Nuevo Producto
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-[#A48242]/10 border-[#A48242]/30">
          <CardContent className="p-4 text-center">
            <Package size={24} className="mx-auto text-[#A48242] mb-1" />
            <p className="text-2xl font-bold text-foreground">{totalProducts}</p>
            <p className="text-xs text-[#A48242]">Total</p>
          </CardContent>
        </Card>
        <Card className="bg-green-50 border-green-200">
          <CardContent className="p-4 text-center">
            <CheckCircle size={24} className="mx-auto text-green-600 mb-1" />
            <p className="text-2xl font-bold text-green-900">{activeProducts}</p>
            <p className="text-xs text-green-600">Activos</p>
          </CardContent>
        </Card>
        <Card className="bg-[#A48242]/10 border-[#A48242]/30">
          <CardContent className="p-4 text-center">
            <Award size={24} className="mx-auto text-[#A48242] mb-1" />
            <p className="text-2xl font-bold text-foreground">{ownProducts}</p>
            <p className="text-xs text-[#A48242]">Espert (propios)</p>
          </CardContent>
        </Card>
        <Card className="bg-amber-50 border-amber-200">
          <CardContent className="p-4 text-center">
            <LayoutGrid size={24} className="mx-auto text-amber-600 mb-1" />
            <p className="text-2xl font-bold text-amber-900">{categoryCount}</p>
            <p className="text-xs text-amber-600">Categorias</p>
          </CardContent>
        </Card>
      </div>

      <div className="relative">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Buscar por nombre o fabricante..." className="pl-10" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => setCategoryFilter(null)} className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${categoryFilter === null ? "bg-[#A48242] text-white" : "text-muted-foreground hover:bg-muted border border-border"}`}>
          Todas
        </button>
        {allCategories.map((cat) => (
          <button key={cat} onClick={() => setCategoryFilter(categoryFilter === cat ? null : cat)} className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${categoryFilter === cat ? "bg-[#A48242] text-white" : "text-muted-foreground hover:bg-muted border border-border"}`}>
            {categoryLabel(cat)} <span className="ml-1.5 text-xs opacity-75">({products.filter((p) => p.Category === cat).length})</span>
          </button>
        ))}
      </div>

      {Array.from(grouped.entries()).length === 0 ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground">No se encontraron productos</CardContent></Card>
      ) : (
        Array.from(grouped.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([category, items]) => (
          <div key={category}>
            <h2 className="text-lg font-semibold text-foreground mb-2 flex items-center gap-2">
              {categoryLabel(category)} <Badge variant="secondary" className="text-xs">{items.length}</Badge>
            </h2>
            <Card className="mb-4">
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border bg-muted">
                        <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase">Producto</th>
                        <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase">Fabricante</th>
                        <th className="text-center py-3 px-4 text-xs font-semibold text-muted-foreground uppercase">Tipo</th>
                        <th className="text-center py-3 px-4 text-xs font-semibold text-muted-foreground uppercase">Orden</th>
                        <th className="text-center py-3 px-4 text-xs font-semibold text-muted-foreground uppercase">Estado</th>
                        <th className="text-center py-3 px-4 text-xs font-semibold text-muted-foreground uppercase">Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((p) => (
                        <tr key={p.ProductId} className={`border-b border-border hover:bg-muted transition-colors ${!p.IsActive ? "opacity-50" : ""}`}>
                          <td className="py-3 px-4"><p className="font-semibold text-foreground">{p.Name}</p><p className="text-xs text-muted-foreground">ID: {p.ProductId}</p></td>
                          <td className="py-3 px-4"><span className="text-sm text-muted-foreground">{p.Manufacturer || "-"}</span></td>
                          <td className="py-3 px-4 text-center">{p.IsOwn ? <Badge className="bg-[#A48242]/15 text-[#A48242] border border-[#A48242]/30">ESPERT</Badge> : <Badge variant="secondary">COMPETENCIA</Badge>}</td>
                          <td className="py-3 px-4 text-center"><span className="text-sm text-muted-foreground">{p.SortOrder}</span></td>
                          <td className="py-3 px-4 text-center"><Switch checked={p.IsActive} onCheckedChange={() => handleToggleActive(p)} /></td>
                          <td className="py-3 px-4 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <Button variant="ghost" size="sm" onClick={() => openEdit(p)}><Edit size={16} /></Button>
                              <Button variant="ghost" size="sm" onClick={() => setDeleteProduct(p)}><Trash2 size={16} className="text-red-500" /></Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
        ))
      )}
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────

export function ProductManagement() {
  const [activeTab, setActiveTab] = useState<"data" | "config">("data");

  // Config state
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteProduct, setDeleteProduct] = useState<Product | null>(null);

  // Analytics state
  const [analytics, setAnalytics] = useState<ProductAnalytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try { setProducts(await productsApi.list({ active_only: false })); }
    catch { toast.error("Error al cargar productos"); }
    finally { setLoading(false); }
  }, []);

  const loadAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    try { setAnalytics(await reportsApi.productAnalytics()); }
    catch { /* silently fail — data tab will show empty state */ }
    finally { setAnalyticsLoading(false); }
  }, []);

  useEffect(() => { loadProducts(); loadAnalytics(); }, [loadProducts, loadAnalytics]);

  // Derived
  const allCategories = useMemo(() => Array.from(new Set(products.map((p) => p.Category))).sort(), [products]);
  const filtered = useMemo(() => {
    let list = products;
    if (categoryFilter) list = list.filter((p) => p.Category === categoryFilter);
    if (searchTerm.trim()) { const t = searchTerm.toLowerCase(); list = list.filter((p) => p.Name.toLowerCase().includes(t) || (p.Manufacturer || "").toLowerCase().includes(t)); }
    return list;
  }, [products, categoryFilter, searchTerm]);
  const grouped = useMemo(() => {
    const map = new Map<string, Product[]>();
    for (const p of filtered) { const arr = map.get(p.Category) || []; arr.push(p); map.set(p.Category, arr); }
    for (const [, arr] of map) arr.sort((a, b) => a.SortOrder - b.SortOrder || a.Name.localeCompare(b.Name));
    return map;
  }, [filtered]);
  const totalProducts = products.length;
  const activeProducts = products.filter((p) => p.IsActive).length;
  const ownProducts = products.filter((p) => p.IsOwn).length;
  const categoryCount = allCategories.length;

  const resetForm = () => { setForm(emptyForm); setEditingProduct(null); };
  const openCreate = () => { resetForm(); setIsModalOpen(true); };
  const openEdit = (p: Product) => {
    setEditingProduct(p);
    const isPredefined = PREDEFINED_CATEGORIES.includes(p.Category);
    setForm({ Name: p.Name, Category: isPredefined ? p.Category : "__custom__", CustomCategory: isPredefined ? "" : p.Category, Manufacturer: p.Manufacturer || "", IsOwn: p.IsOwn, SortOrder: p.SortOrder });
    setIsModalOpen(true);
  };
  const getEffectiveCategory = () => form.Category === "__custom__" ? form.CustomCategory.trim() : form.Category;

  const handleSave = async () => {
    const category = getEffectiveCategory();
    if (!form.Name.trim()) { toast.error("El nombre es obligatorio"); return; }
    if (!category) { toast.error("La categoria es obligatoria"); return; }
    setSaving(true);
    try {
      const payload = { Name: form.Name.trim(), Category: category, Manufacturer: form.Manufacturer.trim() || null, IsOwn: form.IsOwn, SortOrder: form.SortOrder };
      if (editingProduct) { await productsApi.update(editingProduct.ProductId, payload); toast.success("Producto actualizado"); }
      else { await productsApi.create(payload); toast.success("Producto creado"); }
      setIsModalOpen(false); resetForm(); loadProducts();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Error al guardar"); }
    finally { setSaving(false); }
  };

  const handleToggleActive = async (p: Product) => {
    try {
      await productsApi.update(p.ProductId, { IsActive: !p.IsActive });
      setProducts((prev) => prev.map((x) => x.ProductId === p.ProductId ? { ...x, IsActive: !x.IsActive } : x));
      toast.success(p.IsActive ? "Producto desactivado" : "Producto activado");
    } catch { toast.error("Error al cambiar estado"); }
  };

  const handleDelete = async () => {
    if (!deleteProduct) return;
    try { await productsApi.delete(deleteProduct.ProductId); toast.success("Producto desactivado"); setDeleteProduct(null); loadProducts(); }
    catch { toast.error("Error al eliminar producto"); }
  };

  if (loading) return <div className="flex items-center justify-center py-20"><p className="text-muted-foreground">Cargando productos...</p></div>;

  return (
    <div className="space-y-6">
      {/* Header with tab toggle */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-1">Productos</h1>
          <p className="text-muted-foreground">{activeTab === "data" ? "Analytics y cobertura de productos" : "Configurar catalogo de productos"}</p>
        </div>
        <div className="flex items-center gap-2 bg-muted rounded-lg p-1">
          <button
            onClick={() => setActiveTab("data")}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === "data" ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            <BarChart3 size={16} /> Datos
          </button>
          <button
            onClick={() => setActiveTab("config")}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === "config" ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            <Settings size={16} /> Configuracion
          </button>
        </div>
      </div>

      {/* Tab content */}
      {activeTab === "data" ? (
        <AnalyticsView analytics={analytics} loading={analyticsLoading} />
      ) : (
        <ConfigView
          products={products} allCategories={allCategories} filtered={filtered} grouped={grouped}
          totalProducts={totalProducts} activeProducts={activeProducts} ownProducts={ownProducts} categoryCount={categoryCount}
          searchTerm={searchTerm} setSearchTerm={setSearchTerm}
          categoryFilter={categoryFilter} setCategoryFilter={setCategoryFilter}
          openCreate={openCreate} openEdit={openEdit}
          handleToggleActive={handleToggleActive} setDeleteProduct={setDeleteProduct}
        />
      )}

      {/* Modals (shared) */}
      <Modal isOpen={isModalOpen} onClose={() => { setIsModalOpen(false); resetForm(); }} title={editingProduct ? "Editar Producto" : "Nuevo Producto"} size="md"
        footer={<><Button variant="outline" onClick={() => { setIsModalOpen(false); resetForm(); }}>Cancelar</Button><Button onClick={handleSave} disabled={saving}>{saving ? "Guardando..." : editingProduct ? "Actualizar" : "Crear"}</Button></>}>
        <div className="space-y-4">
          <div><label className="block text-sm font-medium text-muted-foreground mb-1">Nombre *</label><Input placeholder="Ej: Philip Morris Box 20" value={form.Name} onChange={(e) => setForm((f) => ({ ...f, Name: e.target.value }))} /></div>
          <div><label className="block text-sm font-medium text-muted-foreground mb-1">Categoria *</label>
            <select className="w-full h-10 px-3 border border-border rounded-md text-sm bg-background" value={form.Category} onChange={(e) => setForm((f) => ({ ...f, Category: e.target.value }))}>
              {PREDEFINED_CATEGORIES.map((cat) => <option key={cat} value={cat}>{categoryLabel(cat)}</option>)}
              <option value="__custom__">Otra (personalizada)</option>
            </select>
            {form.Category === "__custom__" && <Input className="mt-2" placeholder="Nombre de la categoria" value={form.CustomCategory} onChange={(e) => setForm((f) => ({ ...f, CustomCategory: e.target.value }))} />}
          </div>
          <div><label className="block text-sm font-medium text-muted-foreground mb-1">Fabricante</label><Input placeholder="Ej: Espert, Philip Morris, BAT" value={form.Manufacturer} onChange={(e) => setForm((f) => ({ ...f, Manufacturer: e.target.value }))} /></div>
          <div className="flex items-center gap-3 pt-1"><Switch checked={form.IsOwn} onCheckedChange={(v) => setForm((f) => ({ ...f, IsOwn: v }))} /><div><label className="text-sm font-medium text-foreground">Producto Espert (propio)</label><p className="text-xs text-muted-foreground">{form.IsOwn ? "Se muestra como producto propio de Espert" : "Se muestra como producto de la competencia"}</p></div></div>
          <div><label className="block text-sm font-medium text-muted-foreground mb-1">Orden</label><Input type="number" min={0} placeholder="0" value={form.SortOrder} onChange={(e) => setForm((f) => ({ ...f, SortOrder: parseInt(e.target.value) || 0 }))} /><p className="text-xs text-muted-foreground mt-1">Los productos se ordenan de menor a mayor dentro de su categoria</p></div>
        </div>
      </Modal>

      <ConfirmModal isOpen={!!deleteProduct} onClose={() => setDeleteProduct(null)} onConfirm={handleDelete} title="Desactivar Producto" message={`¿Desactivar "${deleteProduct?.Name}"? El producto dejara de aparecer en el catalogo activo.`} confirmText="Desactivar" type="danger" />
    </div>
  );
}
