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
} from "lucide-react";
import { productsApi } from "@/lib/api";
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

export function ProductManagement() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [saving, setSaving] = useState(false);

  const [deleteProduct, setDeleteProduct] = useState<Product | null>(null);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await productsApi.list({ active_only: false });
      setProducts(data);
    } catch {
      toast.error("Error al cargar productos");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  // Derived data
  const allCategories = useMemo(() => {
    const cats = new Set(products.map((p) => p.Category));
    return Array.from(cats).sort();
  }, [products]);

  const filtered = useMemo(() => {
    let list = products;
    if (categoryFilter) {
      list = list.filter((p) => p.Category === categoryFilter);
    }
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      list = list.filter(
        (p) =>
          p.Name.toLowerCase().includes(term) ||
          (p.Manufacturer || "").toLowerCase().includes(term)
      );
    }
    return list;
  }, [products, categoryFilter, searchTerm]);

  const grouped = useMemo(() => {
    const map = new Map<string, Product[]>();
    for (const p of filtered) {
      const arr = map.get(p.Category) || [];
      arr.push(p);
      map.set(p.Category, arr);
    }
    // Sort each group by SortOrder then Name
    for (const [, arr] of map) {
      arr.sort((a, b) => a.SortOrder - b.SortOrder || a.Name.localeCompare(b.Name));
    }
    return map;
  }, [filtered]);

  // Stats
  const totalProducts = products.length;
  const activeProducts = products.filter((p) => p.IsActive).length;
  const ownProducts = products.filter((p) => p.IsOwn).length;
  const categoryCount = allCategories.length;

  // Form helpers
  const resetForm = () => {
    setForm(emptyForm);
    setEditingProduct(null);
  };

  const openCreate = () => {
    resetForm();
    setIsModalOpen(true);
  };

  const openEdit = (p: Product) => {
    setEditingProduct(p);
    const isPredefined = PREDEFINED_CATEGORIES.includes(p.Category);
    setForm({
      Name: p.Name,
      Category: isPredefined ? p.Category : "__custom__",
      CustomCategory: isPredefined ? "" : p.Category,
      Manufacturer: p.Manufacturer || "",
      IsOwn: p.IsOwn,
      SortOrder: p.SortOrder,
    });
    setIsModalOpen(true);
  };

  const getEffectiveCategory = (): string => {
    if (form.Category === "__custom__") {
      return form.CustomCategory.trim();
    }
    return form.Category;
  };

  const handleSave = async () => {
    const category = getEffectiveCategory();
    if (!form.Name.trim()) {
      toast.error("El nombre es obligatorio");
      return;
    }
    if (!category) {
      toast.error("La categoria es obligatoria");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        Name: form.Name.trim(),
        Category: category,
        Manufacturer: form.Manufacturer.trim() || null,
        IsOwn: form.IsOwn,
        SortOrder: form.SortOrder,
      };
      if (editingProduct) {
        await productsApi.update(editingProduct.ProductId, payload);
        toast.success("Producto actualizado");
      } else {
        await productsApi.create(payload);
        toast.success("Producto creado");
      }
      setIsModalOpen(false);
      resetForm();
      loadProducts();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (p: Product) => {
    try {
      await productsApi.update(p.ProductId, { IsActive: !p.IsActive });
      setProducts((prev) =>
        prev.map((x) =>
          x.ProductId === p.ProductId ? { ...x, IsActive: !x.IsActive } : x
        )
      );
      toast.success(p.IsActive ? "Producto desactivado" : "Producto activado");
    } catch {
      toast.error("Error al cambiar estado");
    }
  };

  const handleDelete = async () => {
    if (!deleteProduct) return;
    try {
      await productsApi.delete(deleteProduct.ProductId);
      toast.success("Producto desactivado");
      setDeleteProduct(null);
      loadProducts();
    } catch {
      toast.error("Error al eliminar producto");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground">Cargando productos...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-1">
            Gestion de Productos
          </h1>
          <p className="text-muted-foreground">
            Catalogo de productos propios y de la competencia
          </p>
        </div>
        <Button className="gap-2" onClick={openCreate}>
          <Plus size={16} />
          Nuevo Producto
        </Button>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-espert-gold/10 border-espert-gold/30">
          <CardContent className="p-4 text-center">
            <Package size={24} className="mx-auto text-espert-gold mb-1" />
            <p className="text-2xl font-bold text-foreground">{totalProducts}</p>
            <p className="text-xs text-espert-gold">Total</p>
          </CardContent>
        </Card>
        <Card className="bg-green-50 border-green-200">
          <CardContent className="p-4 text-center">
            <CheckCircle size={24} className="mx-auto text-green-600 mb-1" />
            <p className="text-2xl font-bold text-green-900">{activeProducts}</p>
            <p className="text-xs text-green-600">Activos</p>
          </CardContent>
        </Card>
        <Card className="bg-espert-gold/10 border-espert-gold/30">
          <CardContent className="p-4 text-center">
            <Award size={24} className="mx-auto text-espert-gold mb-1" />
            <p className="text-2xl font-bold text-foreground">{ownProducts}</p>
            <p className="text-xs text-espert-gold">Espert (propios)</p>
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

      {/* Search */}
      <div className="relative">
        <Search
          size={18}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          placeholder="Buscar por nombre o fabricante..."
          className="pl-10"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {/* Category filter chips */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setCategoryFilter(null)}
          className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
            categoryFilter === null
              ? "bg-[#A48242] text-white"
              : "text-muted-foreground hover:bg-muted border border-border"
          }`}
        >
          Todas
        </button>
        {allCategories.map((cat) => (
          <button
            key={cat}
            onClick={() => setCategoryFilter(categoryFilter === cat ? null : cat)}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              categoryFilter === cat
                ? "bg-[#A48242] text-white"
                : "text-muted-foreground hover:bg-muted border border-border"
            }`}
          >
            {categoryLabel(cat)}
            <span className="ml-1.5 text-xs opacity-75">
              ({products.filter((p) => p.Category === cat).length})
            </span>
          </button>
        ))}
      </div>

      {/* Product table grouped by category */}
      {Array.from(grouped.entries()).length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            No se encontraron productos
          </CardContent>
        </Card>
      ) : (
        Array.from(grouped.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([category, items]) => (
            <div key={category}>
              <h2 className="text-lg font-semibold text-foreground mb-2 flex items-center gap-2">
                {categoryLabel(category)}
                <Badge variant="secondary" className="text-xs">
                  {items.length}
                </Badge>
              </h2>
              <Card className="mb-4">
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-border bg-muted">
                          <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase">
                            Producto
                          </th>
                          <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase">
                            Fabricante
                          </th>
                          <th className="text-center py-3 px-4 text-xs font-semibold text-muted-foreground uppercase">
                            Tipo
                          </th>
                          <th className="text-center py-3 px-4 text-xs font-semibold text-muted-foreground uppercase">
                            Orden
                          </th>
                          <th className="text-center py-3 px-4 text-xs font-semibold text-muted-foreground uppercase">
                            Estado
                          </th>
                          <th className="text-center py-3 px-4 text-xs font-semibold text-muted-foreground uppercase">
                            Acciones
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((p) => (
                          <tr
                            key={p.ProductId}
                            className={`border-b border-border hover:bg-muted transition-colors ${
                              !p.IsActive ? "opacity-50" : ""
                            }`}
                          >
                            <td className="py-3 px-4">
                              <p className="font-semibold text-foreground">
                                {p.Name}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                ID: {p.ProductId}
                              </p>
                            </td>
                            <td className="py-3 px-4">
                              <span className="text-sm text-muted-foreground">
                                {p.Manufacturer || "-"}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-center">
                              {p.IsOwn ? (
                                <Badge className="bg-[#A48242]/15 text-[#A48242] border border-[#A48242]/30">
                                  ESPERT
                                </Badge>
                              ) : (
                                <Badge variant="secondary">COMPETENCIA</Badge>
                              )}
                            </td>
                            <td className="py-3 px-4 text-center">
                              <span className="text-sm text-muted-foreground">
                                {p.SortOrder}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-center">
                              <Switch
                                checked={p.IsActive}
                                onCheckedChange={() => handleToggleActive(p)}
                              />
                            </td>
                            <td className="py-3 px-4 text-center">
                              <div className="flex items-center justify-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => openEdit(p)}
                                >
                                  <Edit size={16} />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setDeleteProduct(p)}
                                >
                                  <Trash2 size={16} className="text-red-500" />
                                </Button>
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

      {/* Create/Edit Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          resetForm();
        }}
        title={editingProduct ? "Editar Producto" : "Nuevo Producto"}
        size="md"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => {
                setIsModalOpen(false);
                resetForm();
              }}
            >
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Guardando..." : editingProduct ? "Actualizar" : "Crear"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Nombre *
            </label>
            <Input
              placeholder="Ej: Philip Morris Box 20"
              value={form.Name}
              onChange={(e) => setForm((f) => ({ ...f, Name: e.target.value }))}
            />
          </div>

          {/* Category */}
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Categoria *
            </label>
            <select
              className="w-full h-10 px-3 border border-border rounded-md text-sm bg-background"
              value={form.Category}
              onChange={(e) =>
                setForm((f) => ({ ...f, Category: e.target.value }))
              }
            >
              {PREDEFINED_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {categoryLabel(cat)}
                </option>
              ))}
              <option value="__custom__">Otra (personalizada)</option>
            </select>
            {form.Category === "__custom__" && (
              <Input
                className="mt-2"
                placeholder="Nombre de la categoria"
                value={form.CustomCategory}
                onChange={(e) =>
                  setForm((f) => ({ ...f, CustomCategory: e.target.value }))
                }
              />
            )}
          </div>

          {/* Manufacturer */}
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Fabricante
            </label>
            <Input
              placeholder="Ej: Espert, Philip Morris, BAT"
              value={form.Manufacturer}
              onChange={(e) =>
                setForm((f) => ({ ...f, Manufacturer: e.target.value }))
              }
            />
          </div>

          {/* IsOwn toggle */}
          <div className="flex items-center gap-3 pt-1">
            <Switch
              checked={form.IsOwn}
              onCheckedChange={(v) => setForm((f) => ({ ...f, IsOwn: v }))}
            />
            <div>
              <label className="text-sm font-medium text-foreground">
                Producto Espert (propio)
              </label>
              <p className="text-xs text-muted-foreground">
                {form.IsOwn
                  ? "Se muestra como producto propio de Espert"
                  : "Se muestra como producto de la competencia"}
              </p>
            </div>
          </div>

          {/* SortOrder */}
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Orden
            </label>
            <Input
              type="number"
              min={0}
              placeholder="0"
              value={form.SortOrder}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  SortOrder: parseInt(e.target.value) || 0,
                }))
              }
            />
            <p className="text-xs text-muted-foreground mt-1">
              Los productos se ordenan de menor a mayor dentro de su categoria
            </p>
          </div>
        </div>
      </Modal>

      {/* Delete confirmation */}
      <ConfirmModal
        isOpen={!!deleteProduct}
        onClose={() => setDeleteProduct(null)}
        onConfirm={handleDelete}
        title="Desactivar Producto"
        message={`¿Desactivar "${deleteProduct?.Name}"? El producto dejara de aparecer en el catalogo activo.`}
        confirmText="Desactivar"
        type="danger"
      />
    </div>
  );
}
