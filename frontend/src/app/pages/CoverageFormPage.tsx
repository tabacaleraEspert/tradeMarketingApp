import { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate, useLocation } from "react-router";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { Switch } from "../components/ui/switch";
import {
  ArrowLeft,
  ArrowRight,
  Package,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  CheckCircle2,
  Search,
  Check,
  X as XIcon,
  Info,
} from "lucide-react";
import { toast } from "sonner";
import { VisitStepIndicator } from "../components/VisitStepIndicator";
import { productsApi, visitCoverageApi, pdvProductCategoriesApi, ApiError } from "@/lib/api";
import type { Product, CoverageDiff } from "@/lib/api/types";

interface CoverageRow {
  ProductId: number;
  Works: boolean;
  Price: string;
  Availability: string;
}

export function CoverageFormPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { routeDayId, visitId } = (location.state as { routeDayId?: number; visitId?: number }) || {};

  const [products, setProducts] = useState<Product[]>([]);
  const [rows, setRows] = useState<Record<number, CoverageRow>>({});
  const [diffs, setDiffs] = useState<CoverageDiff[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [categoryStatus, setCategoryStatus] = useState<Record<string, boolean>>({});
  const [coverageReqs, setCoverageReqs] = useState<{
    ownRequired: boolean; competitorRequired: boolean; competitorEveryN: number; visitNumber: number;
  } | null>(null);

  // Load products + previous coverage + PDV categories
  useEffect(() => {
    if (!visitId) return;
    Promise.all([
      productsApi.list(),
      visitCoverageApi.diff(visitId),
      id ? pdvProductCategoriesApi.list(Number(id)).catch(() => []) : Promise.resolve([]),
      visitCoverageApi.requirements(visitId).catch(() => null),
    ]).then(([prods, diffData, pdvCats, reqs]) => {
      if (reqs) setCoverageReqs(reqs);
      // Check if THIS visit already has saved coverage data (user filled and came back)
      const hasCurrentData = diffData.some((d) => d.Works === true);
      const hasPrevData = diffData.some((d) => d.PrevWorks != null);
      const isFirstVisit = (!reqs || reqs.visitNumber === 1) && !hasCurrentData;

      // Set category statuses
      // First visit: everything starts as "No Trabaja" so the rep opens categories as they go
      // Subsequent visits: use saved category status, or inherit from previous coverage
      const catStatus: Record<string, boolean> = {};
      for (const cat of [...new Set(prods.map((p) => p.Category))]) {
        const pdvCat = pdvCats.find((c: { Category: string }) => c.Category === cat);
        if (pdvCat) {
          catStatus[cat] = pdvCat.Status === "trabaja";
        } else if (isFirstVisit) {
          catStatus[cat] = false; // First visit: default "No Trabaja"
        } else {
          // Subsequent visit without saved status: infer from previous coverage
          const catProducts = prods.filter((p) => p.Category === cat);
          const anyPrevWorked = catProducts.some((p) => {
            const d = diffData.find((x) => x.ProductId === p.ProductId);
            return d?.PrevWorks === true;
          });
          catStatus[cat] = anyPrevWorked;
        }
      }
      setCategoryStatus(catStatus);
      setProducts(prods);
      setDiffs(diffData);

      // Build rows from diff data
      // Always use current saved data if available, then fall back to previous or empty
      const initial: Record<number, CoverageRow> = {};
      for (const p of prods) {
        const d = diffData.find((x) => x.ProductId === p.ProductId);
        if (d && (d.Works === true || d.Price != null)) {
          // Current visit has saved data for this product — use it
          initial[p.ProductId] = {
            ProductId: p.ProductId,
            Works: d.Works,
            Price: d.Price != null ? String(d.Price) : "",
            Availability: d.Availability || "disponible",
          };
        } else if (!isFirstVisit && hasPrevData && d) {
          // Subsequent visit: pre-load from previous
          initial[p.ProductId] = {
            ProductId: p.ProductId,
            Works: d.PrevWorks ?? false,
            Price: d.PrevPrice != null ? String(d.PrevPrice) : "",
            Availability: d.PrevAvailability || "disponible",
          };
        } else {
          // First visit or no data at all: start empty
          initial[p.ProductId] = {
            ProductId: p.ProductId,
            Works: false,
            Price: "",
            Availability: "disponible",
          };
        }
      }
      setRows(initial);
      setLoading(false);
    }).catch(() => {
      toast.error("Error al cargar productos");
      setLoading(false);
    });
  }, [visitId]);

  const categories = useMemo(() => {
    const cats = [...new Set(products.map((p) => p.Category))];
    return cats.sort();
  }, [products]);

  const filteredProducts = useMemo(() => {
    let filtered = products;
    if (filterCategory !== "all") {
      filtered = filtered.filter((p) => p.Category === filterCategory);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      filtered = filtered.filter(
        (p) => p.Name.toLowerCase().includes(q) || (p.Manufacturer || "").toLowerCase().includes(q)
      );
    }
    return filtered;
  }, [products, filterCategory, search, categoryStatus]);

  const groupedProducts = useMemo(() => {
    const groups: Record<string, Product[]> = {};
    for (const p of filteredProducts) {
      if (!groups[p.Category]) groups[p.Category] = [];
      groups[p.Category].push(p);
    }
    return groups;
  }, [filteredProducts]);

  const updateRow = (pid: number, field: keyof CoverageRow, value: string | boolean) => {
    setRows((prev) => ({
      ...prev,
      [pid]: { ...prev[pid], [field]: value },
    }));
  };

  const getDiff = (pid: number) => diffs.find((d) => d.ProductId === pid);

  const handleSave = async () => {
    if (!visitId) return;
    setSaving(true);
    try {
      const items = Object.values(rows)
        .filter((r) => r.Works || getDiff(r.ProductId)?.PrevWorks)
        .map((r) => ({
          ProductId: r.ProductId,
          Works: r.Works,
          Price: r.Works && r.Price ? Number(r.Price) : undefined,
          Availability: r.Works ? r.Availability : undefined,
        }));
      await visitCoverageApi.bulkSave(visitId, items);
      toast.success("Cobertura guardada");
      navigate(`/pos/${id}/pop`, { state: { routeDayId, visitId } });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  const workedCount = Object.values(rows).filter((r) => r.Works).length;
  const ownWorked = Object.values(rows).filter((r) => {
    const p = products.find((x) => x.ProductId === r.ProductId);
    return r.Works && p?.IsOwn;
  }).length;

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Cargando productos...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <div className="bg-card border-b border-border p-4 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(`/pos/${id}/survey`, { state: { routeDayId, visitId } })}
            className="p-2 hover:bg-muted rounded-lg transition-colors"
          >
            <ArrowLeft size={24} />
          </button>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-foreground">Cobertura y Precios</h1>
            <p className="text-xs text-muted-foreground">
              {workedCount} productos marcados &middot; {ownWorked} propios
            </p>
          </div>
          <VisitStepIndicator currentStep={2} />
        </div>
      </div>

      <div className="p-4 space-y-3">
        {/* Coverage requirements banner */}
        {coverageReqs && (
          <div className={`rounded-lg p-3 text-xs space-y-1 ${
            coverageReqs.competitorRequired ? "bg-amber-50 border border-amber-200" : "bg-blue-50 border border-blue-200"
          }`}>
            <p className="font-semibold">
              {coverageReqs.competitorRequired
                ? `Visita #${coverageReqs.visitNumber} — Cobertura propia + competencia obligatoria`
                : `Visita #${coverageReqs.visitNumber} — Solo cobertura propia obligatoria`}
            </p>
            <p className="text-muted-foreground">
              {coverageReqs.competitorRequired
                ? "Esta visita requiere relevar productos propios y de la competencia."
                : `Próxima cobertura de competencia en ${coverageReqs.nextCompetitorAt} visita${coverageReqs.nextCompetitorAt !== 1 ? "s" : ""} (cada ${coverageReqs.competitorEveryN}).`}
            </p>
          </div>
        )}

        {/* Inherited data banner */}
        {coverageReqs && coverageReqs.visitNumber > 1 && diffs.some((d) => d.PrevWorks != null) && (
          <div className="rounded-lg p-3 text-xs bg-amber-50/60 border border-amber-200/60 flex items-start gap-2">
            <Info size={14} className="text-amber-600 mt-0.5 shrink-0" />
            <p className="text-amber-800">
              Los datos marcados con <span className="inline-block px-1 py-0.5 rounded bg-amber-100 text-amber-700 font-medium text-[10px]">Visita ant.</span> vienen de la visita anterior. Revisalos y actualizá lo que haya cambiado.
            </p>
          </div>
        )}

        {/* Search + Filter */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar producto o tabacalera..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        {/* Category navigation pills */}
        <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-4 px-4">
          <button
            onClick={() => setFilterCategory("all")}
            className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
              filterCategory === "all"
                ? "bg-[#A48242] text-white"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            Todos
          </button>
          {categories.map((cat) => {
            const works = categoryStatus[cat] !== false;
            return (
              <button
                key={cat}
                onClick={() => setFilterCategory(cat)}
                className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                  filterCategory === cat
                    ? "bg-[#A48242] text-white"
                    : works
                      ? "bg-muted text-muted-foreground hover:bg-muted/80"
                      : "bg-muted text-muted-foreground opacity-50 line-through"
                }`}
              >
                {cat}
              </button>
            );
          })}
        </div>

        {/* Product groups — each with category on/off toggle */}
        {Object.entries(groupedProducts).map(([category, prods]) => {
          const works = categoryStatus[category] !== false;
          return (
          <div key={category} id={`cat-${category}`}>
            <div className="flex items-center justify-between mb-2 mt-4">
              <div className="flex items-center gap-2">
                <Package size={16} className="text-[#A48242]" />
                <h2 className="text-sm font-bold text-foreground uppercase tracking-wide">{category}</h2>
                <Badge variant="secondary" className="text-[10px]">{prods.length}</Badge>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-medium ${works ? "text-green-700" : "text-muted-foreground"}`}>
                  {works ? "Trabaja" : "No trabaja"}
                </span>
                <Switch
                  checked={works}
                  onCheckedChange={(v) => {
                    setCategoryStatus((prev) => ({ ...prev, [category]: v }));
                    if (id) {
                      pdvProductCategoriesApi.bulkUpsert(Number(id), [
                        { Category: category, Status: v ? "trabaja" : "no_trabaja" },
                      ]).catch(() => {});
                    }
                  }}
                />
              </div>
            </div>

            {!works && (
              <div className="border-2 border-dashed border-border rounded-lg p-4 text-center">
                <p className="text-xs text-muted-foreground">Esta categoría está marcada como "No trabaja"</p>
              </div>
            )}

            {works && <div className="space-y-2">
              {prods.map((product) => {
                const row = rows[product.ProductId];
                if (!row) return null;
                const diff = getDiff(product.ProductId);
                const priceChanged = diff && diff.PrevPrice != null && row.Price && Number(row.Price) !== Number(diff.PrevPrice);
                const newProduct = diff && diff.PrevWorks === null;
                const lostProduct = diff && diff.PrevWorks === true && !row.Works;
                // Inherited: data comes from previous visit (not yet confirmed in this visit)
                const isInherited = diff && diff.PrevWorks != null && !diff.Works && row.Works;

                return (
                  <Card
                    key={product.ProductId}
                    className={`overflow-hidden transition-all ${
                      product.IsOwn ? "border-l-4 border-l-[#A48242]" : ""
                    } ${newProduct ? "ring-1 ring-blue-300" : ""} ${lostProduct ? "ring-1 ring-red-300" : ""} ${isInherited ? "bg-amber-50/40 border-amber-200/60" : ""}`}
                  >
                    <CardContent className="p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-medium text-foreground truncate">{product.Name}</span>
                            {product.IsOwn && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#A48242]/10 text-[#A48242] font-semibold flex-shrink-0">
                                ESPERT
                              </span>
                            )}
                            {isInherited && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium flex-shrink-0">
                                Visita ant.
                              </span>
                            )}
                          </div>
                          {product.Manufacturer && (
                            <p className="text-[11px] text-muted-foreground">{product.Manufacturer}</p>
                          )}
                        </div>
                        <Switch
                          checked={row.Works}
                          onCheckedChange={(v) => updateRow(product.ProductId, "Works", v)}
                        />
                      </div>

                      {row.Works && (
                        <div className="flex items-center gap-2 mt-2.5 pt-2.5 border-t border-border">
                          <div className="flex-1">
                            <div className="relative">
                              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                              <Input
                                type="number"
                                placeholder="Precio"
                                value={row.Price}
                                onChange={(e) => updateRow(product.ProductId, "Price", e.target.value)}
                                className="h-8 text-sm pl-6"
                              />
                            </div>
                            {priceChanged && diff?.PrevPrice != null && (
                              <div className="flex items-center gap-1 mt-1">
                                {Number(row.Price) > Number(diff.PrevPrice) ? (
                                  <TrendingUp size={12} className="text-red-500" />
                                ) : (
                                  <TrendingDown size={12} className="text-green-500" />
                                )}
                                <span className="text-[10px] text-muted-foreground">
                                  Antes: ${Number(diff.PrevPrice).toLocaleString()}
                                </span>
                              </div>
                            )}
                          </div>
                          <div className="flex gap-1">
                            <button
                              onClick={() => updateRow(product.ProductId, "Availability", "disponible")}
                              className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                                row.Availability === "disponible"
                                  ? "bg-green-100 text-green-800 ring-1 ring-green-300"
                                  : "bg-muted text-muted-foreground"
                              }`}
                            >
                              Disp.
                            </button>
                            <button
                              onClick={() => updateRow(product.ProductId, "Availability", "quiebre")}
                              className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                                row.Availability === "quiebre"
                                  ? "bg-red-100 text-red-700 ring-1 ring-red-300"
                                  : "bg-muted text-muted-foreground"
                              }`}
                            >
                              Quiebre
                            </button>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>}
          </div>
        );
        })}

        {filteredProducts.length === 0 && (
          <Card className="border-dashed border-2">
            <CardContent className="p-8 text-center">
              <Package size={40} className="mx-auto text-muted-foreground mb-3 opacity-40" />
              <p className="text-muted-foreground text-sm">No se encontraron productos</p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Bottom CTA */}
      <div className="fixed bottom-0 left-0 right-0 bg-card border-t border-border p-3 pb-[env(safe-area-inset-bottom)] z-20">
        <div className="flex items-center gap-2 mb-2">
          <CheckCircle2 size={14} className="text-green-600" />
          <span className="text-xs text-muted-foreground">
            {workedCount} trabaja &middot; {ownWorked} Espert
          </span>
          {Object.values(rows).some((r) => r.Works && r.Availability === "quiebre") && (
            <span className="flex items-center gap-1 text-xs text-red-600">
              <AlertCircle size={12} />
              {Object.values(rows).filter((r) => r.Works && r.Availability === "quiebre").length} quiebres
            </span>
          )}
        </div>
        <Button
          onClick={handleSave}
          disabled={saving}
          className="w-full h-11 bg-[#A48242] hover:bg-[#8B6E38] text-white font-semibold"
        >
          {saving ? "Guardando..." : "Continuar a POP"}
          <ArrowRight size={16} className="ml-2" />
        </Button>
      </div>
    </div>
  );
}
