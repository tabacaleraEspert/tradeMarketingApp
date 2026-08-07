import { useCallback, useEffect, useState } from "react";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";
import { kpiApi, type ScoringCommunicationRule } from "@/lib/api";
import { ObjetivosConfirmDialog } from "./ObjetivosConfirmDialog";
import { RULE_LEVELS, ruleLevelLabel } from "./objetivos-utils";

interface Props {
  isAdmin: boolean;
}

// Rúbrica de comunicación (tipo de material × nivel -> elementos mínimos). Igual que
// cobertura, se administra en alcance global (no hay scoping por zona/usuario en el
// motor hoy). El motor lee principalmente MaterialType="total" (ver kpi_engine.py).
export function ObjetivosRubricaComunicacion({ isAdmin }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [rules, setRules] = useState<ScoringCommunicationRule[]>([]);

  const [newMaterialType, setNewMaterialType] = useState("");
  const [pendingEdit, setPendingEdit] = useState<{ materialType: string; level: string; minElements: number; before: number | null } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ScoringCommunicationRule | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    setLoading(true);
    setError(false);
    kpiApi.scoringRules("communication")
      .then((rows) => { setRules(rows as ScoringCommunicationRule[]); setEdits({}); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const materialTypes = Array.from(new Set(rules.map((r) => r.MaterialType))).sort();

  const ruleFor = (materialType: string, level: string) =>
    rules.find((r) => r.MaterialType === materialType && r.Level === level) ?? null;
  const cellKey = (materialType: string, level: string) => `${materialType}::${level}`;

  const editValue = (materialType: string, level: string) => {
    const key = cellKey(materialType, level);
    if (edits[key] !== undefined) return edits[key];
    return String(ruleFor(materialType, level)?.MinElements ?? "");
  };

  const setEditValue = (materialType: string, level: string, value: string) => {
    setEdits((prev) => ({ ...prev, [cellKey(materialType, level)]: value }));
  };

  const openSaveConfirm = (materialType: string, level: string) => {
    const value = editValue(materialType, level);
    const minElements = Number(value);
    if (!Number.isFinite(minElements)) return;
    setPendingEdit({ materialType, level, minElements, before: ruleFor(materialType, level)?.MinElements ?? null });
  };

  const handleConfirmSave = async () => {
    if (!pendingEdit) return;
    await kpiApi.createScoringRule("communication", {
      MaterialType: pendingEdit.materialType,
      Level: pendingEdit.level,
      MinElements: pendingEdit.minElements,
      ScopeType: "global",
    });
    load();
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    await kpiApi.deleteScoringRule("communication", pendingDelete.RuleId);
    load();
  };

  const handleAddMaterialType = () => {
    const materialType = newMaterialType.trim();
    if (!materialType || materialTypes.includes(materialType)) return;
    setNewMaterialType("");
    setRules((prev) => [
      ...prev,
      { RuleId: -1, MaterialType: materialType, Level: "__placeholder__", Required: null, MinElements: null, ScopeType: "global", ScopeId: null, ValidFrom: "", ValidTo: null, CreatedByUserId: null, CreatedAt: "" },
    ]);
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
        <p className="text-sm text-muted-foreground">No se pudo cargar la rúbrica de comunicación.</p>
        <button onClick={load} className="inline-flex items-center gap-1.5 text-xs font-semibold text-espert-gold hover:underline">
          <RefreshCw size={12} /> Reintentar
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-foreground">Comunicación — elementos mínimos por tipo de material y nivel</h4>
      </div>

      {materialTypes.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">Sin tipos de material configurados.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 text-muted-foreground font-semibold">Tipo de material</th>
                {RULE_LEVELS.map((lvl) => (
                  <th key={lvl} className="text-center py-2 text-muted-foreground font-semibold">{ruleLevelLabel(lvl)}</th>
                ))}
                {isAdmin && <th className="text-right py-2 text-muted-foreground font-semibold">Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {materialTypes.map((materialType) => (
                <tr key={materialType} className="border-b border-border last:border-0">
                  <td className="py-2.5 font-medium text-foreground">{materialType}</td>
                  {RULE_LEVELS.map((level) => {
                    const rule = ruleFor(materialType, level);
                    return (
                      <td key={level} className="py-2.5 text-center">
                        {isAdmin ? (
                          <div className="flex items-center justify-center gap-1">
                            <Input
                              type="number"
                              min={0}
                              value={editValue(materialType, level)}
                              onChange={(e) => setEditValue(materialType, level, e.target.value)}
                              className="h-8 w-16 text-center"
                            />
                            <Button size="sm" variant="ghost" onClick={() => openSaveConfirm(materialType, level)}>Guardar</Button>
                          </div>
                        ) : (
                          <span>{rule?.MinElements ?? "—"}</span>
                        )}
                      </td>
                    );
                  })}
                  {isAdmin && (
                    <td className="py-2.5 text-right">
                      {RULE_LEVELS.map((level) => ruleFor(materialType, level)).filter(Boolean).map((rule) => (
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
            placeholder="Nuevo tipo de material"
            value={newMaterialType}
            onChange={(e) => setNewMaterialType(e.target.value)}
            className="h-8 w-48"
          />
          <Button size="sm" variant="outline" onClick={handleAddMaterialType}>
            <Plus size={12} className="mr-1" /> Agregar tipo
          </Button>
        </div>
      )}

      <ObjetivosConfirmDialog
        isOpen={pendingEdit != null}
        title="Confirmar elementos mínimos"
        confirmText="Guardar"
        onClose={() => setPendingEdit(null)}
        onConfirm={handleConfirmSave}
      >
        {pendingEdit && (
          <p>
            Tipo de material <strong>{pendingEdit.materialType}</strong>, nivel <strong>{ruleLevelLabel(pendingEdit.level)}</strong>:
            {" "}mínimo de elementos {pendingEdit.before ?? "—"}→{pendingEdit.minElements}.
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
            Se va a cerrar la vigencia de <strong>{pendingDelete.MaterialType}</strong> / <strong>{ruleLevelLabel(pendingDelete.Level)}</strong> (mínimo {pendingDelete.MinElements ?? 0} elementos).
          </p>
        )}
      </ObjetivosConfirmDialog>
    </div>
  );
}
