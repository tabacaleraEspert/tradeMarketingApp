import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { ArrowLeft, Download, Filter, Megaphone, Package, Store, RefreshCw } from "lucide-react";
import { popPlacementsReportApi, popMaterialsApi, zonesApi, usersApi, ApiError } from "@/lib/api";
import type { PopPlacementReportRow, Zone, User } from "@/lib/api/types";
import { exportToExcel } from "@/lib/exportExcel";
import { writeCache } from "@/lib/offline";
import { POP_MATERIALS_CACHE_KEY } from "@/lib/popMaterials";
import { getCurrentUser } from "../../lib/auth";
import { toast } from "sonner";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Resumen por artículo (para la 2da hoja del Excel y el top de la pantalla). */
export function summarizeByMaterial(rows: PopPlacementReportRow[]) {
  const m = new Map<string, { Code: string; Material: string; Linea: string; Tipo: string; Cantidad: number; PDVs: Set<number> }>();
  for (const r of rows) {
    const k = r.MaterialCode ?? `sin-codigo:${r.MaterialName}`;
    const cur = m.get(k) ?? { Code: r.MaterialCode ?? "", Material: r.MaterialName, Linea: r.Line ?? "", Tipo: r.Type ?? "", Cantidad: 0, PDVs: new Set<number>() };
    cur.Cantidad += r.Quantity || 0;
    cur.PDVs.add(r.PdvId);
    m.set(k, cur);
  }
  return [...m.values()]
    .map((x) => ({ Codigo: x.Code, Material: x.Material, Linea: x.Linea, Tipo: x.Tipo, Cantidad: x.Cantidad, PDVs: x.PDVs.size }))
    .sort((a, b) => b.Cantidad - a.Cantidad);
}

export function PopPlacementsReport() {
  const navigate = useNavigate();
  const isAdmin = getCurrentUser().role === "admin";
  const [data, setData] = useState<PopPlacementReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [zones, setZones] = useState<Zone[]>([]);
  const [users, setUsers] = useState<User[]>([]);

  const today = new Date().toISOString().slice(0, 10);
  const firstOfMonth = today.slice(0, 8) + "01";
  const [dateFrom, setDateFrom] = useState(firstOfMonth);
  const [dateTo, setDateTo] = useState(today);
  const [zoneId, setZoneId] = useState<string>("");
  const [userId, setUserId] = useState<string>("");

  useEffect(() => {
    zonesApi.list().then(setZones).catch(() => setZones([]));
    usersApi.list({ limit: 500 }).then(setUsers).catch(() => setUsers([]));
  }, []);

  useEffect(() => {
    setLoading(true);
    popPlacementsReportApi
      .list({
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        zone_id: zoneId ? Number(zoneId) : undefined,
        user_id: userId ? Number(userId) : undefined,
      })
      .then(setData)
      .catch(() => toast.error("Error al cargar colocaciones"))
      .finally(() => setLoading(false));
  }, [dateFrom, dateTo, zoneId, userId]);

  const visibleUsers = useMemo(
    () => users
      .filter((u) => u.IsActive && (!zoneId || u.ZoneId === Number(zoneId)))
      .sort((a, b) => a.DisplayName.localeCompare(b.DisplayName, "es")),
    [users, zoneId],
  );

  const totalUnits = useMemo(() => data.reduce((s, r) => s + (r.Quantity || 0), 0), [data]);
  const pdvCount = useMemo(() => new Set(data.map((r) => r.PdvId)).size, [data]);
  const byMaterial = useMemo(() => summarizeByMaterial(data), [data]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const r = await popMaterialsApi.sync();
      toast.success(`Catálogo sincronizado: ${r.Total} artículos (${r.Created} nuevos, ${r.Updated} actualizados, ${r.Deactivated} desactivados)`);
      // Refrescar el cache offline del catálogo en este dispositivo
      popMaterialsApi.list().then((m) => writeCache(POP_MATERIALS_CACHE_KEY, m)).catch(() => {});
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Error al sincronizar catálogo");
    } finally {
      setSyncing(false);
    }
  };

  const handleExport = () => {
    if (data.length === 0) { toast.error("No hay datos para exportar"); return; }
    const detail = data.map((r) => ({
      Fecha: formatDate(r.Date),
      Usuario: r.UserName,
      PDV: r.PdvName,
      Zona: r.ZoneName ?? "",
      Codigo: r.MaterialCode ?? "",
      Material: r.MaterialName,
      Linea: r.Line ?? "",
      Tipo: r.Type ?? "",
      Cantidad: r.Quantity,
      Ubicacion: r.Location ?? "",
      VisitaId: r.VisitId,
    }));
    exportToExcel(`Colocaciones_POP_${dateFrom}_${dateTo}`, [
      { name: "Colocaciones", data: detail },
      { name: "Por artículo", data: byMaterial },
    ]);
    toast.success("Excel descargado");
  };

  const selectCls = "h-9 px-2 border border-border rounded-lg text-sm bg-background max-w-full";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={() => navigate("/admin")} className="p-2 hover:bg-muted rounded-lg">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 min-w-[180px]">
          <h1 className="text-xl font-bold text-foreground">Colocaciones POP</h1>
          <p className="text-xs text-muted-foreground">Material POP colocado por artículo, trade y PDV</p>
        </div>
        {isAdmin && (
          <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing} className="gap-1.5">
            <RefreshCw size={14} className={syncing ? "animate-spin" : ""} /> {syncing ? "Sincronizando..." : "Sincronizar catálogo"}
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={handleExport} disabled={data.length === 0} className="gap-1.5">
          <Download size={14} /> Excel
        </Button>
      </div>

      <Card>
        <CardContent className="p-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Filter size={14} className="text-muted-foreground" />
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} aria-label="Desde" className={selectCls} />
            <span className="text-xs text-muted-foreground">a</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} aria-label="Hasta" className={selectCls} />
            <select value={zoneId} onChange={(e) => { setZoneId(e.target.value); setUserId(""); }} aria-label="Zona" className={selectCls}>
              <option value="">Todas las zonas</option>
              {zones.map((z) => <option key={z.ZoneId} value={z.ZoneId}>{z.Name}</option>)}
            </select>
            <select value={userId} onChange={(e) => setUserId(e.target.value)} aria-label="Usuario" className={selectCls}>
              <option value="">Todos los usuarios</option>
              {visibleUsers.map((u) => <option key={u.UserId} value={u.UserId}>{u.DisplayName}</option>)}
            </select>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-3 gap-2">
        <Card><CardContent className="p-3 text-center">
          <Megaphone size={16} className="mx-auto text-[#A48242] mb-1" />
          <p className="text-2xl font-bold tabular-nums">{data.length}</p>
          <p className="text-[10px] text-muted-foreground">Colocaciones</p>
        </CardContent></Card>
        <Card><CardContent className="p-3 text-center">
          <Package size={16} className="mx-auto text-emerald-500 mb-1" />
          <p className="text-2xl font-bold tabular-nums">{totalUnits}</p>
          <p className="text-[10px] text-muted-foreground">Piezas</p>
        </CardContent></Card>
        <Card><CardContent className="p-3 text-center">
          <Store size={16} className="mx-auto text-blue-500 mb-1" />
          <p className="text-2xl font-bold tabular-nums">{pdvCount}</p>
          <p className="text-[10px] text-muted-foreground">PDVs</p>
        </CardContent></Card>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-[#A48242] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : data.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            <Megaphone size={32} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">No hay colocaciones en este periodo</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {byMaterial.length > 0 && (
            <Card>
              <CardContent className="p-3">
                <p className="text-[10px] font-bold text-[#A48242] uppercase tracking-wider mb-2">Top artículos</p>
                <div className="flex gap-1.5 flex-wrap">
                  {byMaterial.slice(0, 8).map((m) => (
                    <Badge key={m.Codigo || m.Material} variant="outline" className="text-[11px] font-normal">
                      {m.Codigo || "s/código"} · {m.Material} <span className="font-bold ml-1">x{m.Cantidad}</span>
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs text-muted-foreground">
                      <th className="text-left p-3 font-medium">Fecha</th>
                      <th className="text-left p-3 font-medium">Usuario</th>
                      <th className="text-left p-3 font-medium">PDV</th>
                      <th className="text-left p-3 font-medium">Zona</th>
                      <th className="text-left p-3 font-medium">Material</th>
                      <th className="text-left p-3 font-medium">Ubicación</th>
                      <th className="text-right p-3 font-medium">Cant.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.map((r, i) => (
                      <tr key={`${r.VisitId}-${r.MaterialCode ?? r.MaterialName}-${i}`} className="hover:bg-muted/30">
                        <td className="p-3 whitespace-nowrap">{formatDate(r.Date)}</td>
                        <td className="p-3"><p className="truncate max-w-[140px]">{r.UserName}</p></td>
                        <td className="p-3"><p className="font-medium truncate max-w-[160px]">{r.PdvName}</p></td>
                        <td className="p-3"><Badge variant="outline" className="text-[10px]">{r.ZoneName || "-"}</Badge></td>
                        <td className="p-3">
                          <p className="text-xs font-medium truncate max-w-[220px]">{r.MaterialName}</p>
                          <p className="text-[10px] text-muted-foreground">{r.MaterialCode ?? "Sin código"}{r.Type ? ` · ${r.Type}` : ""}</p>
                        </td>
                        <td className="p-3"><p className="text-xs truncate max-w-[140px]">{r.Location || "-"}</p></td>
                        <td className="p-3 text-right font-bold tabular-nums">{r.Quantity}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
