import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { ArrowLeft, Download, Package, Repeat, Gift, Gamepad2, Filter } from "lucide-react";
import { api } from "@/lib/api/client";
import { exportToExcel } from "@/lib/exportExcel";
import { toast } from "sonner";

interface DeliveryRow {
  VisitActionId: number;
  VisitId: number;
  Date: string;
  UserName: string;
  UserEmail: string;
  PdvName: string;
  PdvAddress: string;
  ZoneName: string;
  ActionType: string;
  Description: string;
  Details: Record<string, unknown>;
}

const ACTION_LABELS: Record<string, string> = {
  canje_sueltos: "Canje",
  promo: "Promo",
  juego: "Juego",
};

const ACTION_ICONS: Record<string, typeof Package> = {
  canje_sueltos: Repeat,
  promo: Gift,
  juego: Gamepad2,
};

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

/** Extract a human-readable product summary from DetailsJson */
function summarizeProducts(row: DeliveryRow): string {
  const d = row.Details;
  if (row.ActionType === "canje_sueltos") {
    const entregados = d.entregados as Record<string, number> | undefined;
    if (entregados && Object.keys(entregados).length > 0) {
      return Object.entries(entregados)
        .filter(([, qty]) => qty > 0)
        .map(([name, qty]) => `${name}: ${qty}`)
        .join(", ");
    }
    return "-";
  }
  if (row.ActionType === "promo") {
    const productos = d.productos as { name: string; qty: number }[] | undefined;
    if (productos && productos.length > 0) {
      return productos.map((p) => `${p.name}: ${p.qty}`).join(", ");
    }
    return "-";
  }
  if (row.ActionType === "juego") {
    const premio = (d.premio as string) || "";
    const marca = (d.marcaPremio as string) || "";
    const cantidad = d.cantidad || "";
    return [marca, premio, cantidad ? `x${cantidad}` : ""].filter(Boolean).join(" ") || "-";
  }
  return "-";
}

/** Total units delivered for a row */
function totalUnits(row: DeliveryRow): number {
  const d = row.Details;
  if (row.ActionType === "canje_sueltos") {
    const entregados = d.entregados as Record<string, number> | undefined;
    if (entregados) return Object.values(entregados).reduce((s, v) => s + (v || 0), 0);
    return 0;
  }
  if (row.ActionType === "promo") {
    const productos = d.productos as { name: string; qty: number }[] | undefined;
    if (productos) return productos.reduce((s, p) => s + (p.qty || 0), 0);
    return 0;
  }
  if (row.ActionType === "juego") {
    return Number(d.cantidad) || 0;
  }
  return 0;
}

export function ProductDeliveries() {
  const navigate = useNavigate();
  const [data, setData] = useState<DeliveryRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const today = new Date().toISOString().slice(0, 10);
  const firstOfMonth = today.slice(0, 8) + "01";
  const [dateFrom, setDateFrom] = useState(firstOfMonth);
  const [dateTo, setDateTo] = useState(today);
  const [filterType, setFilterType] = useState<string>("");

  const fetchData = () => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;
    api.get<DeliveryRow[]>("/reports/product-deliveries", params)
      .then(setData)
      .catch(() => toast.error("Error al cargar entregas"))
      .finally(() => setLoading(false));
  };

  useEffect(fetchData, [dateFrom, dateTo]);

  const filtered = useMemo(() => {
    if (!filterType) return data;
    return data.filter((r) => r.ActionType === filterType);
  }, [data, filterType]);

  // KPIs
  const totalDeliveries = filtered.length;
  const totalAtados = useMemo(() => filtered.reduce((s, r) => s + totalUnits(r), 0), [filtered]);
  const byType = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of filtered) m[r.ActionType] = (m[r.ActionType] || 0) + 1;
    return m;
  }, [filtered]);

  const handleExport = () => {
    if (filtered.length === 0) { toast.error("No hay datos para exportar"); return; }
    const rows = filtered.map((r) => {
      const d = r.Details;
      let modalidad = "";
      let negociacion = "";
      let productosRecibidos = "";
      let productosEntregados = "";

      if (r.ActionType === "canje_sueltos") {
        modalidad = (d.modalidad as string) || "";
        negociacion = (d.negociacion as string) || "";
        const cantidades = d.cantidades as Record<string, number> | undefined;
        if (cantidades) productosRecibidos = Object.entries(cantidades).filter(([, v]) => v > 0).map(([k, v]) => `${k}: ${v}`).join(", ");
        const entregados = d.entregados as Record<string, number> | undefined;
        if (entregados) productosEntregados = Object.entries(entregados).filter(([, v]) => v > 0).map(([k, v]) => `${k}: ${v}`).join(", ");
      } else if (r.ActionType === "promo") {
        modalidad = (d.promoType as string) || "";
        const productos = d.productos as { name: string; qty: number }[] | undefined;
        if (productos) productosEntregados = productos.map((p) => `${p.name}: ${p.qty}`).join(", ");
      } else if (r.ActionType === "juego") {
        modalidad = (d.tipoJuego as string) || "";
        productosEntregados = [(d.marcaPremio as string), (d.premio as string), d.cantidad ? `x${d.cantidad}` : ""].filter(Boolean).join(" ");
      }

      return {
        Fecha: formatDate(r.Date),
        Hora: formatTime(r.Date),
        Usuario: r.UserName,
        Email: r.UserEmail,
        PDV: r.PdvName,
        Direccion: r.PdvAddress,
        Zona: r.ZoneName,
        "Tipo Accion": ACTION_LABELS[r.ActionType] || r.ActionType,
        Modalidad: modalidad,
        Negociacion: negociacion,
        "Productos recibidos": productosRecibidos,
        "Productos entregados": productosEntregados,
        "Cantidad total": totalUnits(r),
        Descripcion: r.Description,
      };
    });
    exportToExcel(`Entregas_${dateFrom}_${dateTo}`, [{ name: "Entregas", data: rows }]);
    toast.success("Excel descargado");
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate("/admin")} className="p-2 hover:bg-muted rounded-lg">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-foreground">Entregas de Producto</h1>
          <p className="text-xs text-muted-foreground">Canjes, promos y juegos con entrega de stock</p>
        </div>
        <Button variant="outline" size="sm" onClick={handleExport} disabled={filtered.length === 0} className="gap-1.5">
          <Download size={14} /> Excel
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Filter size={14} className="text-muted-foreground" />
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9 px-2 border border-border rounded-lg text-sm bg-background" />
            <span className="text-xs text-muted-foreground">a</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9 px-2 border border-border rounded-lg text-sm bg-background" />
            <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="h-9 px-2 border border-border rounded-lg text-sm bg-background">
              <option value="">Todos los tipos</option>
              <option value="canje_sueltos">Canje</option>
              <option value="promo">Promo</option>
              <option value="juego">Juego</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Card>
          <CardContent className="p-3 text-center">
            <Package size={16} className="mx-auto text-[#A48242] mb-1" />
            <p className="text-2xl font-bold">{totalDeliveries}</p>
            <p className="text-[10px] text-muted-foreground">Entregas</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 text-center">
            <Package size={16} className="mx-auto text-emerald-500 mb-1" />
            <p className="text-2xl font-bold">{totalAtados}</p>
            <p className="text-[10px] text-muted-foreground">Unidades entregadas</p>
          </CardContent>
        </Card>
        {Object.entries(byType).map(([type, count]) => {
          const Icon = ACTION_ICONS[type] || Package;
          return (
            <Card key={type}>
              <CardContent className="p-3 text-center">
                <Icon size={16} className="mx-auto text-blue-500 mb-1" />
                <p className="text-2xl font-bold">{count}</p>
                <p className="text-[10px] text-muted-foreground">{ACTION_LABELS[type] || type}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-[#A48242] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            <Package size={32} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">No hay entregas en este periodo</p>
          </CardContent>
        </Card>
      ) : (
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
                    <th className="text-left p-3 font-medium">Tipo</th>
                    <th className="text-left p-3 font-medium">Productos entregados</th>
                    <th className="text-right p-3 font-medium">Qty</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((r) => {
                    const Icon = ACTION_ICONS[r.ActionType] || Package;
                    return (
                      <tr key={r.VisitActionId} className="hover:bg-muted/30">
                        <td className="p-3 whitespace-nowrap">
                          <p className="font-medium">{formatDate(r.Date)}</p>
                          <p className="text-[10px] text-muted-foreground">{formatTime(r.Date)}</p>
                        </td>
                        <td className="p-3">
                          <p className="font-medium truncate max-w-[140px]">{r.UserName}</p>
                        </td>
                        <td className="p-3">
                          <p className="font-medium truncate max-w-[160px]">{r.PdvName}</p>
                          <p className="text-[10px] text-muted-foreground truncate max-w-[160px]">{r.PdvAddress}</p>
                        </td>
                        <td className="p-3">
                          <Badge variant="outline" className="text-[10px]">{r.ZoneName || "-"}</Badge>
                        </td>
                        <td className="p-3">
                          <div className="flex items-center gap-1.5">
                            <Icon size={14} className="text-[#A48242]" />
                            <span className="text-xs font-medium">{ACTION_LABELS[r.ActionType] || r.ActionType}</span>
                          </div>
                        </td>
                        <td className="p-3">
                          <p className="text-xs truncate max-w-[200px]">{summarizeProducts(r)}</p>
                        </td>
                        <td className="p-3 text-right font-bold tabular-nums">
                          {totalUnits(r) || "-"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
