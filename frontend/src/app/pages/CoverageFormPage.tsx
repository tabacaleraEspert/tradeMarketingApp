import { useState, useEffect, useMemo, useCallback, useRef, memo } from "react";
import { useParams, useNavigate, useLocation } from "react-router";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import {
  ArrowLeft,
  ArrowRight,
  Package,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  CheckCircle2,
  Search,
  X as XIcon,
  Info,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { VisitStepIndicator } from "../components/VisitStepIndicator";
import { useVisitStep, useAutoSaveDraft, getDraft } from "@/lib/useVisitAutoSave";
import { executeOrEnqueue, fetchWithCache } from "@/lib/offline";
import { productsApi, visitCoverageApi, pdvProductCategoriesApi, ApiError } from "@/lib/api";
import type { Product, CoverageDiff } from "@/lib/api/types";
import { useVisitFlow } from "@/lib/VisitFlowContext";
import {
  type CoverageRow,
  type CoverageState,
  type BrandGroup,
  EMPTY_ROW,
  brandOf,
  groupByBrand,
  summarizeBrand,
  deriveCategoryState,
  categoryStateFromPdvStatus,
  initialRowFromDiff,
  isInheritedRow,
  normalizeDraftRow,
  normalizeDraftCategoryStatus,
  buildPersistItems,
  buildCategoryItems,
  brandsWithoutData,
  countStates,
} from "./coverage-utils";

// ---------------------------------------------------------------------------
// Control segmentado [Sí] [No] [—]  (— = sin dato). Mínimo 36px de alto.
// ---------------------------------------------------------------------------

interface SegmentedProps {
  value: CoverageState;
  onChange: (v: CoverageState) => void;
  /** Sin dato pero la marca/categoría está "abierta" (tocó Sí): resalta el Sí en tono suave. */
  softSi?: boolean;
  size?: "sm" | "md";
  label?: string;
}

const SEG_OPTIONS: Array<{ v: CoverageState; label: string; on: string }> = [
  { v: "si", label: "Sí", on: "bg-green-600 text-white" },
  { v: "no", label: "No", on: "bg-red-500 text-white" },
  { v: "sin_dato", label: "—", on: "bg-slate-500 text-white" },
];

function Segmented({ value, onChange, softSi, size = "md", label }: SegmentedProps) {
  const h = size === "sm" ? "h-9 min-w-[40px] text-xs" : "h-10 min-w-[44px] text-sm";
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex rounded-lg bg-muted p-0.5 shrink-0 select-none"
      onClick={(e) => e.stopPropagation()}
    >
      {SEG_OPTIONS.map((o) => {
        const active = value === o.v;
        const soft = !active && softSi && o.v === "si" && value === "sin_dato";
        return (
          <button
            key={o.v}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.v)}
            className={`${h} px-2.5 rounded-md font-semibold transition-colors ${
              active ? o.on : soft ? "bg-green-100 text-green-800" : "text-muted-foreground"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fila de variante / producto
// ---------------------------------------------------------------------------

interface ProductRowProps {
  product: Product;
  row: CoverageRow;
  diff: CoverageDiff | undefined;
  category: string;
  /** Variante anidada dentro de una marca (sin card propia, con indent). */
  nested?: boolean;
  onUpdate: (pid: number, field: keyof CoverageRow, value: string) => void;
}

const ProductRowMemo = memo(function ProductRow({ product, row, diff, category, nested, onUpdate }: ProductRowProps) {
  const works = row.State === "si";
  const priceChanged = works && diff && diff.PrevPrice != null && row.Price && Number(row.Price) !== Number(diff.PrevPrice);
  const newProduct = diff && diff.PrevWorks === null && !diff.HasCurrentData;
  const lostProduct = diff && diff.PrevWorks === true && row.State === "no";
  const isInherited = isInheritedRow(row, diff);

  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`text-sm font-medium text-foreground truncate ${row.State === "no" ? "text-muted-foreground line-through decoration-muted-foreground/50" : ""}`}>
              {product.Name}
            </span>
            {product.IsOwn && !nested && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#A48242]/10 text-[#A48242] font-semibold flex-shrink-0">
                ESPERT
              </span>
            )}
            {isInherited && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium flex-shrink-0">
                Visita ant.
              </span>
            )}
            {newProduct && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-medium flex-shrink-0">
                Nuevo
              </span>
            )}
            {lostProduct && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-medium flex-shrink-0">
                Dejó de trabajar
              </span>
            )}
          </div>
          {product.Manufacturer && !nested && (
            <p className="text-[11px] text-muted-foreground">{product.Manufacturer}</p>
          )}
        </div>
        <Segmented
          size="sm"
          label={product.Name}
          value={row.State}
          onChange={(v) => onUpdate(product.ProductId, "State", v)}
        />
      </div>

      {works && (
        <div className="flex items-center gap-2 mt-2.5 pt-2.5 border-t border-border flex-wrap">
          <div className="flex-1 min-w-[80px]">
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
              <Input
                type="number"
                inputMode="decimal"
                placeholder="Precio"
                value={row.Price}
                onChange={(e) => onUpdate(product.ProductId, "Price", e.target.value)}
                className="h-9 text-sm pl-6"
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
          {category.toLowerCase().includes("vape") && (
            <div className="w-20">
              <Input
                type="number"
                inputMode="numeric"
                placeholder="Puffs"
                value={row.Puffs}
                onChange={(e) => onUpdate(product.ProductId, "Puffs", e.target.value)}
                className="h-9 text-sm text-center"
              />
            </div>
          )}
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => onUpdate(product.ProductId, "Availability", "disponible")}
              className={`h-9 px-2.5 rounded text-[11px] font-medium transition-colors ${
                row.Availability === "disponible"
                  ? "bg-green-100 text-green-800 ring-1 ring-green-300"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              Disp.
            </button>
            <button
              type="button"
              onClick={() => onUpdate(product.ProductId, "Availability", "quiebre")}
              className={`h-9 px-2.5 rounded text-[11px] font-medium transition-colors ${
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
    </>
  );

  const ring = `${newProduct ? "ring-1 ring-blue-300" : ""} ${lostProduct ? "ring-1 ring-red-300" : ""} ${isInherited ? "bg-amber-50/40" : ""}`;

  if (nested) {
    return <div className={`py-2.5 px-3 border-t border-border/70 ${ring}`}>{body}</div>;
  }
  return (
    <Card className={`overflow-hidden transition-all ${product.IsOwn ? "border-l-4 border-l-[#A48242]" : ""} ${ring} ${isInherited ? "border-amber-200/60" : ""}`}>
      <CardContent className="p-3">{body}</CardContent>
    </Card>
  );
}, (prev, next) =>
  prev.product.ProductId === next.product.ProductId &&
  prev.row === next.row &&
  prev.diff === next.diff &&
  prev.nested === next.nested
);

// ---------------------------------------------------------------------------
// Grupo de marca (varias variantes)
// ---------------------------------------------------------------------------

interface BrandGroupProps {
  group: BrandGroup;
  rows: Record<number, CoverageRow>;
  diffs: CoverageDiff[];
  expanded: boolean;
  open: boolean;
  onToggle: () => void;
  onBrandState: (v: CoverageState) => void;
  onUpdate: (pid: number, field: keyof CoverageRow, value: string) => void;
}

function BrandGroupCard({ group, rows, diffs, expanded, open, onToggle, onBrandState, onUpdate }: BrandGroupProps) {
  const summary = summarizeBrand(group.products, rows);
  return (
    <Card className={`overflow-hidden ${group.isOwn ? "border-l-4 border-l-[#A48242]" : ""}`}>
      <div className="flex items-center justify-between gap-2 pr-3">
        <button
          type="button"
          onClick={onToggle}
          className="flex-1 min-w-0 text-left p-3 active:bg-muted/60"
          aria-expanded={expanded}
        >
          <div className="flex items-center gap-1.5 flex-wrap">
            {expanded ? <ChevronDown size={16} className="text-muted-foreground shrink-0" /> : <ChevronRight size={16} className="text-muted-foreground shrink-0" />}
            <span className={`text-sm font-semibold text-foreground truncate ${summary.state === "no" ? "text-muted-foreground line-through" : ""}`}>
              {group.brand}
            </span>
            {group.isOwn && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#A48242]/10 text-[#A48242] font-semibold shrink-0">
                ESPERT
              </span>
            )}
          </div>
          <p className={`text-[11px] pl-[22px] ${summary.withData === summary.total ? "text-green-700" : "text-muted-foreground"}`}>
            {summary.withData}/{summary.total} con dato
            {group.products[0]?.Manufacturer ? ` · ${group.products[0].Manufacturer}` : ""}
          </p>
        </button>
        <Segmented size="sm" label={group.brand} value={summary.state} softSi={open} onChange={onBrandState} />
      </div>
      {expanded && (
        <div className="bg-muted/20">
          {group.products.map((product) => {
            const row = rows[product.ProductId];
            if (!row) return null;
            return (
              <ProductRowMemo
                key={product.ProductId}
                product={product}
                row={row}
                diff={diffs.find((d) => d.ProductId === product.ProductId)}
                category={group.category}
                nested
                onUpdate={onUpdate}
              />
            );
          })}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

type OtherProducts = Record<string, { name: string; price: string }[]>;

export function CoverageFormPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const locState = (location.state as { routeDayId?: number; visitId?: number }) || {};
  const recovered = useVisitStep(Number(id) || undefined, "coverage", locState);
  const flow = useVisitFlow();
  const routeDayId = locState.routeDayId ?? recovered.routeDayId;
  const visitId = locState.visitId ?? recovered.visitId ?? flow.visitId;

  const [products, setProducts] = useState<Product[]>([]);
  const [rows, setRows] = useState<Record<number, CoverageRow>>({});
  const [diffs, setDiffs] = useState<CoverageDiff[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  /** Estado explícito por categoría (lo que tocó el usuario). El efectivo se deriva de los productos. */
  const [categoryStatus, setCategoryStatus] = useState<Record<string, CoverageState>>({});
  /** Marcas donde el usuario tocó "Sí" (quedan expandidas aunque ninguna variante tenga dato). */
  const [openBrands, setOpenBrands] = useState<Set<string>>(() => new Set());
  /** Expand/collapse manual de marcas (independiente del estado). */
  const [brandExpanded, setBrandExpanded] = useState<Record<string, boolean>>({});
  /**
   * Snapshot de las rows al terminar la carga inicial (con draft). Fija el orden
   * de marcas (Espert → con sin_dato → resto) para que no salten mientras se
   * completan. No cambia hasta remount.
   */
  const orderRowsRef = useRef<Record<number, CoverageRow>>({});
  // "Otros" custom products per category (name + price)
  const [otherProducts, setOtherProducts] = useState<OtherProducts>({});
  const [newOtherName, setNewOtherName] = useState<Record<string, string>>({});
  const [coverageReqs, setCoverageReqs] = useState<{
    ownRequired: boolean; competitorRequired: boolean; competitorEveryN: number; visitNumber: number; nextCompetitorAt: number;
  } | null>(null);

  // Load products + previous coverage + PDV categories
  useEffect(() => {
    if (!visitId) return;
    Promise.all([
      flow.products.length > 0 ? Promise.resolve(flow.products) : fetchWithCache("products_all", () => productsApi.list()),
      fetchWithCache(`visit_coverage_diff_${visitId}`, () => visitCoverageApi.diff(visitId)).catch(() => [] as CoverageDiff[]),
      id ? fetchWithCache(`pdv_categories_${id}`, () => pdvProductCategoriesApi.list(Number(id))).catch(() => []) : Promise.resolve([]),
      fetchWithCache(`visit_coverage_reqs_${visitId}`, () => visitCoverageApi.requirements(visitId)).catch(() => null),
    ]).then(([prods, diffData, pdvCats, reqs]) => {
      if (reqs) setCoverageReqs(reqs);
      const diffById = new Map(diffData.map((d) => [d.ProductId, d]));
      const hasCurrentData = diffData.some((d) => d.HasCurrentData);
      const hasPrevData = diffData.some((d) => d.PrevWorks != null);
      const isFirstVisit = (!reqs || reqs.visitNumber === 1) && !hasCurrentData;
      const inheritPrev = !isFirstVisit && hasPrevData;

      // Filas: dato actual → herencia visita anterior → sin_dato
      const initial: Record<number, CoverageRow> = {};
      for (const p of prods) {
        initial[p.ProductId] = initialRowFromDiff(p.ProductId, diffById.get(p.ProductId), inheritPrev);
      }

      // Estado explícito de categoría: lo guardado en PdvProductCategory (si existe).
      // El estado efectivo se deriva de las filas; esto solo pesa cuando nada tiene dato.
      const catStatus: Record<string, CoverageState> = {};
      for (const c of pdvCats as Array<{ Category: string; Status: string }>) {
        catStatus[c.Category] = categoryStateFromPdvStatus(c.Status);
      }

      // Overlay del draft local (lo más fresco): marcas/precios/categorías/otros que
      // quedaron sin "Continuar" (back, step indicator, hardware back, refresh).
      const draft = getDraft<{
        rows?: Record<number, unknown>;
        categoryStatus?: unknown;
        otherProducts?: OtherProducts;
        openBrands?: string[];
      }>(visitId, "coverage");
      if (draft?.rows) {
        for (const k of Object.keys(draft.rows)) {
          const pid = Number(k);
          if (!initial[pid]) continue;
          const norm = normalizeDraftRow(draft.rows[pid], pid);
          if (norm) initial[pid] = norm;
        }
      }
      if (draft?.categoryStatus) Object.assign(catStatus, normalizeDraftCategoryStatus(draft.categoryStatus));
      if (draft?.otherProducts) setOtherProducts(draft.otherProducts);
      if (Array.isArray(draft?.openBrands)) setOpenBrands(new Set(draft.openBrands));

      orderRowsRef.current = initial;
      setProducts(prods);
      setDiffs(diffData);
      setCategoryStatus(catStatus);
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

  const productsByCategory = useMemo(() => {
    const groups: Record<string, Product[]> = {};
    for (const p of products) {
      if (!groups[p.Category]) groups[p.Category] = [];
      groups[p.Category].push(p);
    }
    return groups;
  }, [products]);

  const filteredProducts = useMemo(() => {
    let filtered = products;
    if (filterCategory !== "all") {
      filtered = filtered.filter((p) => p.Category === filterCategory);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      filtered = filtered.filter(
        (p) =>
          p.Name.toLowerCase().includes(q) ||
          brandOf(p).toLowerCase().includes(q) ||
          (p.Manufacturer || "").toLowerCase().includes(q)
      );
    }
    return filtered;
  }, [products, filterCategory, search]);

  const groupedProducts = useMemo(() => {
    const groups: Record<string, Product[]> = {};
    for (const p of filteredProducts) {
      if (!groups[p.Category]) groups[p.Category] = [];
      groups[p.Category].push(p);
    }
    return groups;
  }, [filteredProducts]);

  /** Estado efectivo por categoría (derivado de TODOS sus productos, no solo los filtrados). */
  const effectiveCategoryState = useMemo(() => {
    const out: Record<string, CoverageState> = {};
    for (const cat of categories) {
      out[cat] = deriveCategoryState(
        productsByCategory[cat] || [],
        rows,
        categoryStatus[cat],
        (otherProducts[cat] || []).some((o) => o.name.trim()),
      );
    }
    return out;
  }, [categories, productsByCategory, rows, categoryStatus, otherProducts]);

  /** Grupos de marca por categoría (sobre los productos filtrados). Orden congelado al cargar. */
  const brandGroupsByCategory = useMemo(() => {
    const out: Record<string, BrandGroup[]> = {};
    for (const [cat, prods] of Object.entries(groupedProducts)) {
      out[cat] = groupByBrand(cat, prods, orderRowsRef.current, orderRowsRef.current);
    }
    return out;
    // `loading` en deps: el ref se llena justo antes de loading=false.
  }, [groupedProducts, loading]);

  const updateRow = useCallback((pid: number, field: keyof CoverageRow, value: string) => {
    setRows((prev) => ({
      ...prev,
      [pid]: { ...prev[pid], [field]: value },
    }));
  }, []);

  const setProductsState = useCallback((pids: number[], state: CoverageState) => {
    setRows((prev) => {
      const next = { ...prev };
      for (const pid of pids) next[pid] = { ...(prev[pid] ?? EMPTY_ROW(pid)), State: state };
      return next;
    });
  }, []);

  const handleBrandState = useCallback((group: BrandGroup, v: CoverageState) => {
    const pids = group.products.map((p) => p.ProductId);
    if (v === "si") {
      // Abre la marca; cada variante queda sin dato hasta que la toquen.
      setOpenBrands((prev) => new Set(prev).add(group.key));
      setBrandExpanded((prev) => ({ ...prev, [group.key]: true }));
      // La categoría queda "abierta" aunque ninguna variante tenga dato todavía.
      setCategoryStatus((prev) => (prev[group.category] === "si" ? prev : { ...prev, [group.category]: "si" }));
      return;
    }
    setOpenBrands((prev) => {
      if (!prev.has(group.key)) return prev;
      const next = new Set(prev);
      next.delete(group.key);
      return next;
    });
    setProductsState(pids, v);
    setBrandExpanded((prev) => ({ ...prev, [group.key]: false }));
  }, [setProductsState]);

  const handleCategoryState = useCallback((category: string, v: CoverageState) => {
    const pids = (productsByCategory[category] || []).map((p) => p.ProductId);
    setCategoryStatus((prev) => ({ ...prev, [category]: v }));
    if (v === "si") return; // productos intactos, solo expande
    setProductsState(pids, v);
    // "Otros" son Works=true: no tienen sentido en una categoría No / sin dato.
    setOtherProducts((prev) => {
      if (!(prev[category] || []).length) return prev;
      const next = { ...prev };
      delete next[category];
      return next;
    });
    // Todas las marcas de la categoría dejan de estar "abiertas".
    setOpenBrands((prev) => {
      const next = new Set([...prev].filter((k) => !k.startsWith(`${category}::`)));
      return next.size === prev.size ? prev : next;
    });
    setBrandExpanded((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(next)) if (k.startsWith(`${category}::`)) delete next[k];
      return next;
    });
  }, [productsByCategory, setProductsState]);

  const getDiff = (pid: number) => diffs.find((d) => d.ProductId === pid);

  // Persist every change to a local draft so nothing is lost when the user
  // leaves this step by ANY route (back arrow, step indicator, hardware back,
  // refresh). Gated on `!loading` so the empty initial state can't clobber it.
  const openBrandsList = useMemo(() => [...openBrands], [openBrands]);
  useAutoSaveDraft(visitId, "coverage", { rows, categoryStatus, otherProducts, openBrands: openBrandsList }, !loading);

  const persist = async (silent = false): Promise<boolean> => {
    if (!visitId) return false;
    setSaving(true);
    try {
      // Aviso (no bloqueante): marcas abiertas con "Sí" pero sin ninguna variante relevada.
      if (!silent) {
        const allGroups = categories.flatMap((cat) => groupByBrand(cat, productsByCategory[cat] || [], rows));
        const missing = brandsWithoutData(openBrands, allGroups, rows);
        if (missing.length > 0) {
          toast.warning(`Marcá al menos una variante de ${missing.join(", ")}`);
        }
      }

      // Solo filas con dato (si/no); sin_dato se omite.
      const items: unknown[] = buildPersistItems(rows);
      // "Otros": productos custom no listados, siempre Works=true.
      const otherItems = Object.entries(otherProducts).flatMap(([cat, others]) =>
        others.filter((o) => o.name.trim()).map((o) => ({
          ProductId: null,
          ProductName: o.name.trim(),
          Category: cat,
          Works: true,
          Price: o.price ? Number(o.price) : undefined,
          Availability: "disponible",
        }))
      );
      if (otherItems.length > 0) items.push(...otherItems);

      // Categorías: solo las que quedaron en si/no (trabaja/no_trabaja).
      const categoryItems = buildCategoryItems(effectiveCategoryState);
      const isTempVisit = visitId < 0;
      await Promise.all([
        executeOrEnqueue({
          kind: "visit_coverage",
          method: "PUT",
          url: `/visits/${visitId}/coverage`,
          body: { items },
          label: "Cobertura de productos",
          _tempVisitId: isTempVisit ? visitId : undefined,
        }),
        id && categoryItems.length > 0 ? executeOrEnqueue({
          kind: "pdv_categories",
          method: "PUT",
          url: `/pdvs/${id}/product-categories`,
          body: { categories: categoryItems },
          label: "Categorías del PDV",
          // Si el PDV fue creado offline (id negativo), el sync worker reescribe
          // la URL cuando se resuelve el pdv_create.
          _tempPdvId: Number(id) < 0 ? Number(id) : undefined,
        }).catch(() => {}) : Promise.resolve(),
      ]);
      if (!silent) toast.success("Cobertura guardada");
      return true;
    } catch (err) {
      if (!silent) toast.error(err instanceof ApiError ? err.message : "Error al guardar");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    await persist();
    navigate(`/pos/${id}/pop`, { state: { routeDayId, visitId } });
  };

  const handleBack = async () => {
    await persist(true);
    navigate(`/pos/${id}/survey`, { state: { routeDayId, visitId } });
  };

  const counts = useMemo(() => countStates(products, rows), [products, rows]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Cargando productos...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-28">
      {/* Header */}
      <div className="bg-card border-b border-border p-4 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button
            onClick={handleBack}
            className="p-2 hover:bg-muted rounded-lg transition-colors"
          >
            <ArrowLeft size={24} />
          </button>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-foreground">Cobertura y Precios</h1>
            <p className="text-xs text-muted-foreground">
              {counts.withData} de {counts.total} con dato &middot; {counts.ownSi} Espert
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
              placeholder="Buscar producto, marca o tabacalera..."
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
            className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
              filterCategory === "all"
                ? "bg-[#A48242] text-white"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            Todos
          </button>
          {categories.map((cat) => {
            const st = effectiveCategoryState[cat];
            return (
              <button
                key={cat}
                onClick={() => setFilterCategory(cat)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                  filterCategory === cat
                    ? "bg-[#A48242] text-white"
                    : st === "no"
                      ? "bg-muted text-muted-foreground opacity-50 line-through"
                      : st === "sin_dato"
                        ? "bg-muted text-muted-foreground opacity-70"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {cat}
              </button>
            );
          })}
        </div>

        {/* Product groups — Categoría → Marca → Variante */}
        {Object.entries(groupedProducts).map(([category, prods]) => {
          const st = effectiveCategoryState[category] ?? "sin_dato";
          const expanded = st === "si" || categoryStatus[category] === "si";
          const catCounts = countStates(productsByCategory[category] || [], rows);
          const groups = brandGroupsByCategory[category] || [];
          return (
          <div key={category} id={`cat-${category}`}>
            <div className="flex items-center justify-between gap-2 mb-2 mt-4">
              <div className="flex items-center gap-2 min-w-0">
                <Package size={16} className="text-[#A48242] shrink-0" />
                <h2 className="text-sm font-bold text-foreground uppercase tracking-wide truncate">{category}</h2>
                <Badge variant="secondary" className="text-[10px] shrink-0">{catCounts.withData}/{prods.length}</Badge>
              </div>
              <Segmented
                label={category}
                value={st}
                softSi={categoryStatus[category] === "si"}
                onChange={(v) => handleCategoryState(category, v)}
              />
            </div>

            {!expanded && st === "no" && (
              <div className="border-2 border-dashed border-border rounded-lg p-4 text-center">
                <p className="text-xs text-muted-foreground">Esta categoría está marcada como "No trabaja"</p>
              </div>
            )}
            {!expanded && st === "sin_dato" && (
              <button
                type="button"
                onClick={() => handleCategoryState(category, "si")}
                className="w-full border-2 border-dashed border-border rounded-lg p-4 text-center active:bg-muted/60"
              >
                <p className="text-xs text-muted-foreground">Sin dato · tocá <span className="font-semibold text-green-700">Sí</span> para relevar</p>
              </button>
            )}

            {expanded && <div className="space-y-2">
              {groups.map((group) => {
                if (group.products.length === 1) {
                  const product = group.products[0];
                  const row = rows[product.ProductId];
                  if (!row) return null;
                  return (
                    <ProductRowMemo
                      key={product.ProductId}
                      product={product}
                      row={row}
                      diff={getDiff(product.ProductId)}
                      category={category}
                      onUpdate={updateRow}
                    />
                  );
                }
                const isOpen = openBrands.has(group.key);
                const manual = brandExpanded[group.key];
                const brandState = summarizeBrand(group.products, rows).state;
                const isExpanded = manual ?? (isOpen || brandState === "si");
                return (
                  <BrandGroupCard
                    key={group.key}
                    group={group}
                    rows={rows}
                    diffs={diffs}
                    expanded={isExpanded}
                    open={isOpen}
                    onToggle={() => setBrandExpanded((prev) => ({ ...prev, [group.key]: !isExpanded }))}
                    onBrandState={(v) => handleBrandState(group, v)}
                    onUpdate={updateRow}
                  />
                );
              })}

              {/* Otros — productos custom no listados */}
              {(otherProducts[category] || []).map((op, idx) => (
                <Card key={`other-${idx}`} className="overflow-hidden border-l-4 border-l-violet-400">
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 flex-1 min-w-0">
                        <span className="text-sm font-medium text-foreground truncate">{op.name}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 font-medium shrink-0">OTRO</span>
                      </div>
                      <button onClick={() => setOtherProducts((prev) => ({ ...prev, [category]: (prev[category] || []).filter((_, i) => i !== idx) }))} className="p-2 hover:bg-muted rounded">
                        <XIcon size={14} className="text-muted-foreground" />
                      </button>
                    </div>
                    <div className="mt-2 pt-2 border-t border-border">
                      <div className="relative">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                        <Input
                          type="number"
                          inputMode="decimal"
                          placeholder="Precio"
                          value={op.price}
                          onChange={(e) => setOtherProducts((prev) => ({ ...prev, [category]: (prev[category] || []).map((o, i) => i === idx ? { ...o, price: e.target.value } : o) }))}
                          className="h-9 text-sm pl-6"
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}

              {/* Add "Otro" input */}
              <div className="flex gap-2 items-center">
                <Input
                  placeholder="Agregar otro producto..."
                  value={newOtherName[category] || ""}
                  onChange={(e) => setNewOtherName((prev) => ({ ...prev, [category]: e.target.value }))}
                  className="h-9 text-sm flex-1"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (newOtherName[category] || "").trim()) {
                      setOtherProducts((prev) => ({ ...prev, [category]: [...(prev[category] || []), { name: newOtherName[category].trim(), price: "" }] }));
                      setNewOtherName((prev) => ({ ...prev, [category]: "" }));
                    }
                  }}
                />
                <button
                  onClick={() => {
                    if (!(newOtherName[category] || "").trim()) return;
                    setOtherProducts((prev) => ({ ...prev, [category]: [...(prev[category] || []), { name: newOtherName[category].trim(), price: "" }] }));
                    setNewOtherName((prev) => ({ ...prev, [category]: "" }));
                  }}
                  className="h-9 px-3 rounded-lg bg-muted text-xs font-medium text-muted-foreground hover:bg-muted/80 shrink-0"
                >
                  + Otro
                </button>
              </div>
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
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <CheckCircle2 size={14} className="text-green-600" />
          <span className="text-xs text-muted-foreground">
            {counts.si} trabaja &middot; {counts.ownSi} Espert &middot; {counts.sinDato} sin dato
          </span>
          {counts.quiebres > 0 && (
            <span className="flex items-center gap-1 text-xs text-red-600">
              <AlertCircle size={12} />
              {counts.quiebres} quiebres
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
