import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { ArrowLeft, Camera, Download, Filter, Megaphone, Package, Store, RefreshCw } from "lucide-react";
import { SearchInput } from "../../components/ui/search-input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/dialog";
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

const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Filtro por artículo: línea exacta + texto libre sobre código/nombre/línea/tipo
 *  (todas las palabras, sin acentos; "van kiff" matchea "Van Kiff_Totem"). */
export function filterByMaterial(rows: PopPlacementReportRow[], line: string, q: string) {
  const words = norm(q).replace(/[_-]/g, " ").split(/\s+/).filter(Boolean);
  return rows.filter((r) => {
    if (line && (r.Line ?? "") !== line) return false;
    if (words.length === 0) return true;
    const hay = norm([r.MaterialCode, r.MaterialName, r.Line, r.Type].filter(Boolean).join(" ")).replace(/[_-]/g, " ");
    return words.every((w) => hay.includes(w));
  });
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
  const [line, setLine] = useState<string>("");
  const [materialQ, setMaterialQ] = useState("");
  const [photoRow, setPhotoRow] = useState<PopPlacementReportRow | null>(null);

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

  const lines = useMemo(
    () => [...new Set(data.map((r) => r.Line).filter((l): l is string => !!l))].sort((a, b) => a.localeCompare(b, "es")),
    [data],
  );
  const rows = useMemo(() => filterByMaterial(data, line, materialQ), [data, line, materialQ]);
  const totalUnits = useMemo(() => rows.reduce((s, r) => s + (r.Quantity || 0), 0), [rows]);
  const pdvCount = useMemo(() => new Set(rows.map((r) => r.PdvId)).size, [rows]);
  const byMaterial = useMemo(() => summarizeByMaterial(rows), [rows]);

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
    if (rows.length === 0) { toast.error("No hay datos para exportar"); return; }
    const detail = rows.map((r) => ({
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
      Fotos: (r.Photos ?? []).length,
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
        <Button variant="outline" size="sm" onClick={handleExport} disabled={rows.length === 0} className="gap-1.5">
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
            <select value={line} onChange={(e) => setLine(e.target.value)} aria-label="Línea" className={selectCls}>
              <option value="">Todas las líneas</option>
              {lines.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
            <SearchInput value={materialQ} onChange={setMaterialQ} placeholder="Buscar artículo (ej: van kiff, MKT-000008)" className="w-full sm:w-72" />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-3 gap-2">
        <Card><CardContent className="p-3 text-center">
          <Megaphone size={16} className="mx-auto text-[#A48242] mb-1" />
          <p className="text-2xl font-bold tabular-nums">{rows.length}</p>
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
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            <Megaphone size={32} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">{data.length === 0 ? "No hay colocaciones en este periodo" : "Ningún artículo coincide con el filtro"}</p>
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
                    <Badge
                      key={m.Codigo || m.Material} variant="outline" className="text-[11px] font-normal cursor-pointer hover:bg-muted"
                      onClick={() => setMaterialQ(m.Codigo || m.Material)} title="Filtrar por este artículo"
                    >
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
                      <th className="text-center p-3 font-medium">Foto</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rows.map((r, i) => (
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
                        <td className="p-3 text-center">
                          {(r.Photos?.length ?? 0) > 0 ? (
                            <button onClick={() => setPhotoRow(r)} className="inline-flex items-center gap-1 text-xs text-[#A48242] hover:underline" aria-label="Ver fotos">
                              <Camera size={14} />{r.Photos!.length > 1 && r.Photos!.length}
                            </button>
                          ) : <span className="text-xs text-muted-foreground">-</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      <Dialog open={!!photoRow} onOpenChange={(o) => !o && setPhotoRow(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base">{photoRow?.PdvName}</DialogTitle>
            <p className="text-xs text-muted-foreground">
              {photoRow && formatDate(photoRow.Date)} · {photoRow?.UserName} · fotos de la colocación de la visita
            </p>
          </DialogHeader>
          <div className="grid gap-2 sm:grid-cols-2">
            {photoRow?.Photos?.map((url) => (
              <a key={url} href={url} target="_blank" rel="noreferrer">
                <img src={url} alt="Colocación POP" loading="lazy" className="w-full rounded-lg border border-border object-cover" />
              </a>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
