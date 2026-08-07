import { useCallback, useEffect, useState } from "react";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";
import { kpiApi, type ScoringCoverageRule } from "@/lib/api";
import { ObjetivosConfirmDialog } from "./ObjetivosConfirmDialog";
import { RULE_LEVELS, ruleLevelLabel } from "./objetivos-utils";

interface Props {
  isAdmin: boolean;
}

// Rúbrica de cobertura (marca × nivel -> MinSkus). Se administra en alcance global
// (ScopeType="global"): el motor de KPIs no diferencia scoring por zona/usuario hoy
// (ver comentario del router), así que no exponemos selector de alcance acá.
export function ObjetivosRubricaCobertura({ isAdmin }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [rules, setRules] = useState<ScoringCoverageRule[]>([]);

  const [newBrand, setNewBrand] = useState("");
  const [pendingEdit, setPendingEdit] = useState<{ brand: string; level: string; minSkus: number; before: number | null } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ScoringCoverageRule | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    setLoading(true);
    setError(false);
    kpiApi.scoringRules("coverage")
      .then((rows) => { setRules(rows as ScoringCoverageRule[]); setEdits({}); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const brands = Array.from(new Set(rules.map((r) => r.Brand))).sort();

  const ruleFor = (brand: string, level: string) => rules.find((r) => r.Brand === brand && r.Level === level) ?? null;
  const cellKey = (brand: string, level: string) => `${brand}::${level}`;

  const editValue = (brand: string, level: string) => {
    const key = cellKey(brand, level);
    if (edits[key] !== undefined) return edits[key];
    return String(ruleFor(brand, level)?.MinSkus ?? "");
  };

  const setEditValue = (brand: string, level: string, value: string) => {
    setEdits((prev) => ({ ...prev, [cellKey(brand, level)]: value }));
  };

  const openSaveConfirm = (brand: string, level: string) => {
    const value = editValue(brand, level);
    const minSkus = Number(value);
    if (!Number.isFinite(minSkus)) return;
    setPendingEdit({ brand, level, minSkus, before: ruleFor(brand, level)?.MinSkus ?? null });
  };

  const handleConfirmSave = async () => {
    if (!pendingEdit) return;
    await kpiApi.createScoringRule("coverage", {
      Brand: pendingEdit.brand,
      Level: pendingEdit.level,
      MinSkus: pendingEdit.minSkus,
      ScopeType: "global",
    });
    load();
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    await kpiApi.deleteScoringRule("coverage", pendingDelete.RuleId);
    load();
  };

  const handleAddBrand = () => {
    const brand = newBrand.trim();
    if (!brand || brands.includes(brand)) return;
    setNewBrand("");
    // Fila nueva: se muestra vacía en la tabla hasta que se guarde al menos un nivel.
    setRules((prev) => [...prev, { RuleId: -1, Brand: brand, Level: "__placeholder__", MinSkus: 0, ScopeType: "global", ScopeId: null, ValidFrom: "", ValidTo: null, CreatedByUserId: null, CreatedAt: "" }]);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-24">
        <div className="w-5 h-5 border-2 border-[#A48242] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center space-y-2 py-4">
        <p className="text-sm text-muted-foreground">No se pudo cargar la rúbrica de cobertura.</p>
        <button onClick={load} className="inline-flex items-center gap-1.5 text-xs font-semibold text-espert-gold hover:underline">
          <RefreshCw size={12} /> Reintentar
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-foreground">Cobertura — mínimo de SKUs por marca y nivel</h4>
      </div>

      {brands.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">Sin marcas configuradas.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 text-muted-foreground font-semibold">Marca</th>
                {RULE_LEVELS.map((lvl) => (
                  <th key={lvl} className="text-center py-2 text-muted-foreground font-semibold">{ruleLevelLabel(lvl)}</th>
                ))}
                {isAdmin && <th className="text-right py-2 text-muted-foreground font-semibold">Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {brands.map((brand) => (
                <tr key={brand} className="border-b border-border last:border-0">
                  <td className="py-2.5 font-medium text-foreground">{brand}</td>
                  {RULE_LEVELS.map((level) => {
                    const rule = ruleFor(brand, level);
                    return (
                      <td key={level} className="py-2.5 text-center">
                        {isAdmin ? (
                          <div className="flex items-center justify-center gap-1">
                            <Input
                              type="number"
                              min={0}
                              value={editValue(brand, level)}
                              onChange={(e) => setEditValue(brand, level, e.target.value)}
                              className="h-8 w-16 text-center"
                            />
                            <Button size="sm" variant="ghost" onClick={() => openSaveConfirm(brand, level)}>Guardar</Button>
                          </div>
                        ) : (
                          <span>{rule?.MinSkus ?? "—"}</span>
                        )}
                      </td>
                    );
                  })}
                  {isAdmin && (
                    <td className="py-2.5 text-right">
                      {RULE_LEVELS.map((level) => ruleFor(brand, level)).filter(Boolean).map((rule) => (
                        <Button key={rule!.RuleId} size="sm" variant="ghost" onClick={() => setPendingDelete(rule)} title={`Cerrar ${ruleLevelLabel(rule!.Level)}`}>
                          <Trash2 size={12} />
                        </Button>
                      ))}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isAdmin && (
        <div className="flex items-center gap-2">
          <Input
            placeholder="Nueva marca"
            value={newBrand}
            onChange={(e) => setNewBrand(e.target.value)}
            className="h-8 w-48"
          />
          <Button size="sm" variant="outline" onClick={handleAddBrand}>
            <Plus size={12} className="mr-1" /> Agregar marca
          </Button>
        </div>
      )}

      <ObjetivosConfirmDialog
        isOpen={pendingEdit != null}
        title="Confirmar mínimo de SKUs"
        confirmText="Guardar"
        onClose={() => setPendingEdit(null)}
        onConfirm={handleConfirmSave}
      >
        {pendingEdit && (
          <p>
            Marca <strong>{pendingEdit.brand}</strong>, nivel <strong>{ruleLevelLabel(pendingEdit.level)}</strong>:
            {" "}mínimo de SKUs {pendingEdit.before ?? "—"}→{pendingEdit.minSkus}.
          </p>
        )}
      </ObjetivosConfirmDialog>

      <ObjetivosConfirmDialog
        isOpen={pendingDelete != null}
        title="Cerrar regla"
        confirmText="Cerrar"
        onClose={() => setPendingDelete(null)}
        onConfirm={handleConfirmDelete}
      >
        {pendingDelete && (
          <p>
            Se va a cerrar la vigencia de <strong>{pendingDelete.Brand}</strong> / <strong>{ruleLevelLabel(pendingDelete.Level)}</strong> (mínimo {pendingDelete.MinSkus} SKUs).
          </p>
        )}
      </ObjetivosConfirmDialog>
    </div>
  );
}
