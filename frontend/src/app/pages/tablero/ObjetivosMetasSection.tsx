import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Save, Trash2 } from "lucide-react";
import { Card, CardContent } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import {
  kpiApi,
  zonesApi,
  usersApi,
  type KpiDefinition,
  type KpiConfig,
  type Zone,
  type User,
} from "@/lib/api";
import { ObjetivosConfirmDialog } from "./ObjetivosConfirmDialog";
import { parseKpi422, scopeLabel } from "./objetivos-utils";

interface Props {
  isAdmin: boolean;
}

type ScopeType = "global" | "zone" | "user";

interface PendingSaveItem {
  definition: KpiDefinition;
  weight: number;
  target: number;
  beforeWeight: number | null;
  beforeTarget: number | null;
}

interface PendingDelete {
  config: KpiConfig;
  definition: KpiDefinition | undefined;
}

export function ObjetivosMetasSection({ isAdmin }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [definitions, setDefinitions] = useState<KpiDefinition[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [globalConfigs, setGlobalConfigs] = useState<KpiConfig[]>([]);
  const [scopedConfigs, setScopedConfigs] = useState<KpiConfig[]>([]);

  const [scopeType, setScopeType] = useState<ScopeType>("global");
  const [scopeId, setScopeId] = useState<number | null>(null);

  const [edits, setEdits] = useState<Record<number, { weight: string; target: string }>>({});
  const [pendingSave, setPendingSave] = useState<PendingSaveItem[] | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);

  const zoneNameById = useMemo(() => new Map(zones.map((z) => [z.ZoneId, z.Name])), [zones]);
  const userNameById = useMemo(() => new Map(users.map((u) => [u.UserId, u.DisplayName])), [users]);

  const load = useCallback(() => {
    setLoading(true);
    setError(false);
    Promise.all([
      kpiApi.definitions(),
      zonesApi.list(),
      usersApi.list(),
      kpiApi.config({ scope_type: "global" }),
      scopeType === "global" || scopeId == null
        ? Promise.resolve<KpiConfig[]>([])
        : kpiApi.config({ scope_type: scopeType, scope_id: scopeId }),
    ])
      .then(([defs, zoneList, userList, globalCfg, scopedCfg]) => {
        setDefinitions(defs);
        setZones(zoneList);
        setUsers(userList);
        setGlobalConfigs(globalCfg);
        setScopedConfigs(scopedCfg);
        setEdits({});
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [scopeType, scopeId]);

  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => {
    return definitions.map((def) => {
      const base = globalConfigs.find((c) => c.KpiDefinitionId === def.KpiDefinitionId) ?? null;
      const own =
        scopeType === "global"
          ? base
          : scopedConfigs.find((c) => c.KpiDefinitionId === def.KpiDefinitionId) ?? null;
      const current = own ?? base;
      const isInherited = scopeType !== "global" && own == null && base != null;
      return { def, base, own, current, isInherited };
    });
  }, [definitions, globalConfigs, scopedConfigs, scopeType]);

  const editFor = (defId: number, fallback: { weight: string; target: string }) =>
    edits[defId] ?? fallback;

  const setEditField = (defId: number, field: "weight" | "target", value: string, fallback: { weight: string; target: string }) => {
    setEdits((prev) => ({
      ...prev,
      [defId]: { ...editFor(defId, fallback), [field]: value },
    }));
  };

  // Filas "dirty": el valor editado difiere del vigente (heredado o propio). Se
  // compara como string para no marcar dirty por un simple round-trip numérico
  // (ej. "30" -> 30 -> "30").
  const dirtyItems = useMemo(() => {
    return rows.flatMap(({ def, current }) => {
      const edit = edits[def.KpiDefinitionId];
      if (!edit) return [];
      const fallback = { weight: String(current?.Weight ?? 0), target: String(current?.Target ?? 0) };
      if (edit.weight === fallback.weight && edit.target === fallback.target) return [];
      const weight = Number(edit.weight);
      const target = Number(edit.target);
      if (!Number.isFinite(weight) || !Number.isFinite(target)) return [];
      const item: PendingSaveItem = {
        definition: def,
        weight,
        target,
        beforeWeight: current?.Weight ?? null,
        beforeTarget: current?.Target ?? null,
      };
      return [item];
    });
  }, [rows, edits]);

  // Suma en vivo de los pesos tal como quedarían: editados (aunque no sean válidos
  // todavía) + heredados/propios no tocados. Guía al usuario antes de guardar (el
  // backend valida esto mismo, pero recién al confirmar el lote).
  const liveWeightSum = useMemo(() => {
    return rows.reduce((acc, { def, current }) => {
      const edit = edits[def.KpiDefinitionId];
      const weight = edit ? Number(edit.weight) : current?.Weight ?? 0;
      return acc + (Number.isFinite(weight) ? weight : 0);
    }, 0);
  }, [rows, edits]);

  const sumIsOk = liveWeightSum === 100;

  const discardEdits = () => setEdits({});

  const openBulkSaveConfirm = () => {
    if (dirtyItems.length === 0 || !sumIsOk) return;
    setPendingSave(dirtyItems);
  };

  const handleConfirmSave = async () => {
    if (!pendingSave || pendingSave.length === 0) return;
    await kpiApi.createConfigBulk({
      ScopeType: scopeType,
      ScopeId: scopeType === "global" ? null : scopeId,
      items: pendingSave.map((p) => ({
        KpiDefinitionId: p.definition.KpiDefinitionId,
        Weight: p.weight,
        Target: p.target,
      })),
    });
    setEdits({});
    load();
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    await kpiApi.deleteConfig(pendingDelete.config.KpiConfigId);
    load();
  };

  const formatKpi422 = (err: unknown) => {
    const detail = parseKpi422(err);
    if (!detail) return err instanceof Error ? err.message : "No se pudo guardar el cambio.";
    if (detail.users.length === 0) return detail.message;
    const list = detail.users
      .map((u) => `${userNameById.get(u.userId) ?? `#${u.userId}`} (${u.total}%)`)
      .join(", ");
    return `${detail.message}: ${list}`;
  };

  const currentScopeLabel = scopeLabel(scopeType, scopeType === "global" ? null : scopeId, zoneNameById, userNameById);

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-center h-32">
            <div className="w-6 h-6 border-2 border-[#A48242] border-t-transparent rounded-full animate-spin" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="p-6 text-center space-y-3">
          <p className="text-sm text-muted-foreground">No se pudo cargar la configuración de metas y pesos.</p>
          <button onClick={load} className="inline-flex items-center gap-1.5 text-xs font-semibold text-espert-gold hover:underline">
            <RefreshCw size={12} /> Reintentar
          </button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h3 className="text-base font-semibold text-foreground">Metas y pesos</h3>
            <p className="text-xs text-muted-foreground">Peso y meta vigentes por alcance. Sin override, se hereda de Global.</p>
          </div>
          {!isAdmin && <Badge variant="secondary">Solo lectura</Badge>}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Select
            value={scopeType}
            onValueChange={(v) => { setScopeType(v as ScopeType); setScopeId(null); }}
          >
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="global">Global</SelectItem>
              <SelectItem value="zone">Zona</SelectItem>
              <SelectItem value="user">Usuario</SelectItem>
            </SelectContent>
          </Select>

          {scopeType === "zone" && (
            <Select value={scopeId != null ? String(scopeId) : ""} onValueChange={(v) => setScopeId(Number(v))}>
              <SelectTrigger className="w-[220px]"><SelectValue placeholder="Elegí una zona" /></SelectTrigger>
              <SelectContent>
                {zones.map((z) => (
                  <SelectItem key={z.ZoneId} value={String(z.ZoneId)}>{z.Name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {scopeType === "user" && (
            <Select value={scopeId != null ? String(scopeId) : ""} onValueChange={(v) => setScopeId(Number(v))}>
              <SelectTrigger className="w-[260px]"><SelectValue placeholder="Elegí un usuario" /></SelectTrigger>
              <SelectContent>
                {[...users].sort((a, b) => a.DisplayName.localeCompare(b.DisplayName)).map((u) => (
                  <SelectItem key={u.UserId} value={String(u.UserId)}>{u.DisplayName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {(scopeType !== "global" && scopeId == null) ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Elegí {scopeType === "zone" ? "una zona" : "un usuario"} para ver su configuración.</p>
        ) : (
          <>
            {isAdmin && (
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <Badge
                  variant="outline"
                  className={sumIsOk ? "border-green-200 bg-green-100 text-green-700" : "border-red-200 bg-red-100 text-red-700"}
                >
                  Suma: {liveWeightSum}%{!sumIsOk && " — debe dar 100"}
                </Badge>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={discardEdits} disabled={dirtyItems.length === 0}>
                    Descartar
                  </Button>
                  <Button
                    size="sm"
                    onClick={openBulkSaveConfirm}
                    disabled={dirtyItems.length === 0 || !sumIsOk}
                    title={!sumIsOk ? `La suma de pesos debe dar 100% (hoy: ${liveWeightSum}%)` : undefined}
                  >
                    <Save size={12} className="mr-1" /> Guardar cambios
                  </Button>
                </div>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 text-muted-foreground font-semibold">KPI</th>
                  <th className="text-center py-2 text-muted-foreground font-semibold">Peso (%)</th>
                  <th className="text-center py-2 text-muted-foreground font-semibold">Meta (%)</th>
                  <th className="text-left py-2 text-muted-foreground font-semibold">Alcance</th>
                  {isAdmin && <th className="text-right py-2 text-muted-foreground font-semibold">Acciones</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ def, own, current, isInherited }) => {
                  const fallback = { weight: String(current?.Weight ?? 0), target: String(current?.Target ?? 0) };
                  const edit = editFor(def.KpiDefinitionId, fallback);
                  const isDirty = edit.weight !== fallback.weight || edit.target !== fallback.target;
                  return (
                    <tr
                      key={def.KpiDefinitionId}
                      className={`border-b border-border last:border-0 ${isDirty ? "bg-amber-50/60" : ""}`}
                    >
                      <td className="py-2.5 font-medium text-foreground">{def.Name}</td>
                      <td className="py-2.5 text-center">
                        {isAdmin ? (
                          <Input
                            type="number"
                            min={0}
                            max={100}
                            value={edit.weight}
                            onChange={(e) => setEditField(def.KpiDefinitionId, "weight", e.target.value, fallback)}
                            className="h-8 w-20 mx-auto text-center"
                          />
                        ) : (
                          <span className={isInherited ? "text-muted-foreground" : "text-foreground"}>{current?.Weight ?? "—"}</span>
                        )}
                      </td>
                      <td className="py-2.5 text-center">
                        {isAdmin ? (
                          <Input
                            type="number"
                            min={0}
                            max={100}
                            step="0.01"
                            value={edit.target}
                            onChange={(e) => setEditField(def.KpiDefinitionId, "target", e.target.value, fallback)}
                            className="h-8 w-20 mx-auto text-center"
                          />
                        ) : (
                          <span className={isInherited ? "text-muted-foreground" : "text-foreground"}>{current?.Target ?? "—"}</span>
                        )}
                      </td>
                      <td className="py-2.5">
                        {isInherited ? (
                          <Badge variant="outline" className="text-muted-foreground">heredado de global</Badge>
                        ) : (
                          <Badge variant="secondary">{currentScopeLabel}</Badge>
                        )}
                      </td>
                      {isAdmin && (
                        <td className="py-2.5 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {own && (
                              <Button size="sm" variant="ghost" onClick={() => setPendingDelete({ config: own, definition: def })}>
                                <Trash2 size={12} className="mr-1" /> Quitar override
                              </Button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>

      <ObjetivosConfirmDialog
        isOpen={pendingSave != null && pendingSave.length > 0}
        title="Confirmar cambios de metas y pesos"
        confirmText="Guardar"
        onClose={() => setPendingSave(null)}
        onConfirm={handleConfirmSave}
        errorFormatter={formatKpi422}
      >
        {pendingSave && (
          <p>
            {pendingSave.map((p) => {
              const parts: string[] = [];
              if (p.beforeWeight !== p.weight) parts.push(`peso ${p.beforeWeight ?? "—"}→${p.weight}`);
              if (p.beforeTarget !== p.target) parts.push(`meta ${p.beforeTarget ?? "—"}→${p.target}`);
              return `${p.definition.Name}: ${parts.join(", ")}`;
            }).join(" · ")}
            {" "}· alcance <strong>{currentScopeLabel}</strong>.
            {" "}Esta config afecta el cálculo de la variable por compensación.
          </p>
        )}
      </ObjetivosConfirmDialog>

      <ObjetivosConfirmDialog
        isOpen={pendingDelete != null}
        title="Quitar override"
        confirmText="Quitar"
        onClose={() => setPendingDelete(null)}
        onConfirm={handleConfirmDelete}
        errorFormatter={formatKpi422}
      >
        {pendingDelete && (
          <p>
            Se va a quitar el override de <strong>{pendingDelete.definition?.Name ?? "este KPI"}</strong> para {currentScopeLabel}.
            {scopeType !== "global" ? " Va a volver a heredar de Global." : ""}
          </p>
        )}
      </ObjetivosConfirmDialog>
    </Card>
  );
}
