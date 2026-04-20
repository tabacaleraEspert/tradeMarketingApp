import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import {
  TrendingUp, MapPin, Camera, Award, Clock, CheckCircle2, AlertCircle,
  Users, BarChart3, Download, Target, Navigation, TrendingDown,
} from "lucide-react";
import { reportsApi, formsApi } from "@/lib/api";
import { toast } from "sonner";
import { exportToExcel } from "@/lib/exportExcel";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, Legend, RadarChart, Radar, PolarGrid,
  PolarAngleAxis, PolarRadiusAxis,
} from "recharts";

const MONTH_NAMES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const COLORS = ["#A48242", "#2563eb", "#dc2626", "#16a34a", "#9333ea", "#ea580c", "#0891b2"];

interface Summary { year: number; month: number; totalVisits: number; closedVisits: number; totalPdvs: number; pdvsVisited: number; coverage: number; visitsWithGps: number; visitsWithPhoto: number; avgDurationMin: number; }
interface VendorRow { rank: number; userId: number; name: string; zone: string; visits: number; planned: number; closed: number; pdvsVisited: number; compliance: number; withGps: number; withPhoto: number; avgTimeMin: number; }
interface ChannelRow { channelId: number; channel: string; total: number; visited: number; coverage: number; gps: number; photo: number; }

export function Reports() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [loading, setLoading] = useState(true);

  const [summary, setSummary] = useState<Summary | null>(null);
  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [trending, setTrending] = useState<any[]>([]);
  const [perfectStore, setPerfectStore] = useState<any>(null);
  const [avgTimeByTmPdv, setAvgTimeByTmPdv] = useState<Array<{ userId: number; userName: string; pdvId: number; pdvName: string; visitCount: number; avgMinutes: number }>>([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = { year, month };
      const [s, v, c, t, ps, atp] = await Promise.all([
        reportsApi.summary(params),
        reportsApi.vendorRanking(params),
        reportsApi.channelCoverage(params),
        reportsApi.trending({ months: 6 }),
        reportsApi.perfectStore(),
        reportsApi.avgTimeByTmPdv({ days: 90 }),
      ]);
      setSummary(s); setVendors(v); setChannels(c); setTrending(t); setPerfectStore(ps); setAvgTimeByTmPdv(atp);
    } catch { toast.error("Error al cargar reportes"); }
    finally { setLoading(false); }
  }, [year, month]);

  useEffect(() => { loadData(); }, [loadData]);

  const gpsPercent = summary?.totalVisits ? Math.round((summary.visitsWithGps / summary.totalVisits) * 100) : 0;
  const years = Array.from({ length: 3 }, (_, i) => now.getFullYear() - i);

  const handleExport = () => {
    const vendorData = vendors.map((v) => ({ "#": v.rank, "Nombre": v.name, "Zona": v.zone, "Visitas": v.visits, "Cumplimiento %": v.compliance, "GPS": v.withGps, "Tiempo (min)": v.avgTimeMin }));
    const channelData = channels.map((c) => ({ "Canal": c.channel, "Total": c.total, "Visitados": c.visited, "Cobertura %": c.coverage }));
    exportToExcel(`Reportes_${MONTH_NAMES[month - 1]}_${year}`, [
      ...(vendorData.length ? [{ name: "Ranking", data: vendorData }] : []),
      ...(channelData.length ? [{ name: "Canales", data: channelData }] : []),
    ]);
    toast.success("Exportado");
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-1">Reportes</h1>
          <p className="text-muted-foreground text-sm">Análisis de cobertura, visitas y desempeño</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
            <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
            <SelectContent>{MONTH_NAMES.map((n, i) => <SelectItem key={i} value={String(i + 1)}>{n}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="w-[90px]"><SelectValue /></SelectTrigger>
            <SelectContent>{years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
          </Select>
          <Button variant="outline" className="gap-2" onClick={handleExport} disabled={loading}>
            <Download size={16} /> Excel
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="py-20 text-center text-muted-foreground">Cargando reportes...</div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="bg-gradient-to-br from-black to-[#1a1a18] text-white">
              <CardContent className="p-4">
                <Target size={16} className="text-[#A48242] mb-2" />
                <p className="text-3xl font-black">{summary?.coverage ?? 0}%</p>
                <p className="text-[10px] text-white/60">Cobertura · {summary?.pdvsVisited}/{summary?.totalPdvs} PDVs</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <MapPin size={16} className="text-blue-600 mb-2" />
                <p className="text-3xl font-black text-foreground">{summary?.totalVisits ?? 0}</p>
                <p className="text-[10px] text-muted-foreground">Visitas totales · {summary?.closedVisits} cerradas</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <Navigation size={16} className="text-green-600 mb-2" />
                <p className="text-3xl font-black text-foreground">{gpsPercent}%</p>
                <p className="text-[10px] text-muted-foreground">GPS verificado · {summary?.visitsWithGps} de {summary?.totalVisits}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <Clock size={16} className="text-[#A48242] mb-2" />
                <p className="text-3xl font-black text-foreground">{summary?.avgDurationMin ?? 0}m</p>
                <p className="text-[10px] text-muted-foreground">Tiempo promedio por visita</p>
              </CardContent>
            </Card>
          </div>

          {/* Charts Row 1: Trending + Channel Pie */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Trending line chart */}
            <Card className="lg:col-span-2">
              <CardContent className="p-4">
                <h3 className="font-bold text-foreground mb-4 flex items-center gap-2">
                  <TrendingUp size={16} /> Tendencia de Visitas
                </h3>
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={trending}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="visits" name="Visitas" stroke="#A48242" strokeWidth={2.5} dot={{ fill: "#A48242", r: 4 }} />
                    <Line type="monotone" dataKey="coverage" name="Cobertura %" stroke="#16a34a" strokeWidth={2} strokeDasharray="5 5" dot={{ fill: "#16a34a", r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Channel pie */}
            <Card>
              <CardContent className="p-4">
                <h3 className="font-bold text-foreground mb-4 flex items-center gap-2">
                  <BarChart3 size={16} /> Cobertura por Canal
                </h3>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={channels} dataKey="visited" nameKey="channel" cx="50%" cy="50%" outerRadius={75} label={({ channel, coverage }) => `${coverage}%`} labelLine={false}>
                      {channels.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v: number, name: string) => [`${v} PDVs visitados`, name]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-wrap gap-2 mt-2 justify-center">
                  {channels.map((ch, i) => (
                    <span key={ch.channelId} className="flex items-center gap-1 text-[10px]">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                      {ch.channel}
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Charts Row 2: Vendor bar chart + Channel coverage bars */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Vendor ranking bar chart */}
            <Card>
              <CardContent className="p-4">
                <h3 className="font-bold text-foreground mb-4 flex items-center gap-2">
                  <Award size={16} className="text-[#A48242]" /> Ranking de Vendedores
                </h3>
                <ResponsiveContainer width="100%" height={Math.max(200, vendors.length * 40)}>
                  <BarChart data={vendors.slice(0, 10)} layout="vertical" margin={{ left: 80 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis type="number" tick={{ fontSize: 10 }} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={75} />
                    <Tooltip />
                    <Bar dataKey="visits" name="Visitas" fill="#A48242" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Channel coverage horizontal bars */}
            <Card>
              <CardContent className="p-4">
                <h3 className="font-bold text-foreground mb-4 flex items-center gap-2">
                  <Target size={16} /> Cobertura Detallada
                </h3>
                <div className="space-y-3">
                  {channels.map((ch, i) => (
                    <div key={ch.channelId}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-foreground">{ch.channel}</span>
                        <span className={`text-xs font-bold ${ch.coverage >= 80 ? "text-green-600" : ch.coverage >= 60 ? "text-amber-600" : "text-red-600"}`}>
                          {ch.coverage}%
                        </span>
                      </div>
                      <div className="w-full bg-muted rounded-full h-3">
                        <div className="h-3 rounded-full transition-all" style={{ width: `${ch.coverage}%`, backgroundColor: COLORS[i % COLORS.length] }} />
                      </div>
                      <div className="flex justify-between text-[9px] text-muted-foreground mt-0.5">
                        <span>{ch.visited}/{ch.total} PDVs</span>
                        <span>{ch.gps} GPS</span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Perfect Store radar */}
          {perfectStore && (
            <Card>
              <CardContent className="p-4">
                <h3 className="font-bold text-foreground mb-4 flex items-center gap-2">
                  <Award size={16} className="text-[#A48242]" /> Perfect Store — Score por Canal
                </h3>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <ResponsiveContainer width="100%" height={280}>
                    <RadarChart data={perfectStore.byChannel.filter((c: any) => c.count >= 2)}>
                      <PolarGrid stroke="#e5e7eb" />
                      <PolarAngleAxis dataKey="channel" tick={{ fontSize: 10 }} />
                      <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 9 }} />
                      <Radar name="Score" dataKey="avgScore" stroke="#A48242" fill="#A48242" fillOpacity={0.3} strokeWidth={2} />
                    </RadarChart>
                  </ResponsiveContainer>
                  <div>
                    <div className="grid grid-cols-2 gap-2 mb-3">
                      <div className="bg-gradient-to-br from-black to-[#1a1a18] text-white rounded-xl p-3 text-center">
                        <p className="text-2xl font-black">{perfectStore.summary.avgScore}</p>
                        <p className="text-[9px] text-white/60">Score promedio</p>
                      </div>
                      <div className="bg-green-50 rounded-xl p-3 text-center">
                        <p className="text-2xl font-bold text-green-700">{perfectStore.summary.perfect}</p>
                        <p className="text-[9px] text-green-600">Perfectos (90+)</p>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      {perfectStore.byChannel.filter((c: any) => c.count >= 2).map((ch: any) => (
                        <div key={ch.channel} className="flex items-center justify-between p-2 border border-border rounded-lg text-xs">
                          <span className="font-medium">{ch.channel} <span className="text-muted-foreground">({ch.count})</span></span>
                          <span className={`font-bold ${ch.avgScore >= 80 ? "text-green-600" : ch.avgScore >= 60 ? "text-amber-600" : "text-red-600"}`}>
                            {ch.avgScore}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Vendor Table */}
          <Card>
            <CardContent className="p-4">
              <h3 className="font-bold text-foreground mb-3 flex items-center gap-2">
                <Users size={16} /> Detalle por Vendedor
                <Badge variant="outline" className="text-[10px] ml-auto">{MONTH_NAMES[month - 1]} {year}</Badge>
              </h3>
              {vendors.length === 0 ? (
                <p className="text-muted-foreground py-4 text-center text-sm">Sin datos</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-2 px-1.5 font-semibold text-muted-foreground">#</th>
                        <th className="text-left py-2 px-1.5 font-semibold text-muted-foreground">Vendedor</th>
                        <th className="text-center py-2 px-1.5 font-semibold text-muted-foreground">Visitas</th>
                        <th className="text-center py-2 px-1.5 font-semibold text-muted-foreground">PDVs</th>
                        <th className="text-center py-2 px-1.5 font-semibold text-muted-foreground">Cumpl.</th>
                        <th className="text-center py-2 px-1.5 font-semibold text-muted-foreground">GPS</th>
                        <th className="text-center py-2 px-1.5 font-semibold text-muted-foreground">Tiempo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {vendors.map((v) => (
                        <tr key={v.userId} className="border-b border-border hover:bg-muted/30">
                          <td className="py-2 px-1.5">
                            <span className={`w-6 h-6 inline-flex items-center justify-center rounded-full text-[10px] font-bold ${
                              v.rank === 1 ? "bg-amber-100 text-amber-700" : v.rank === 2 ? "bg-gray-200 text-gray-700" : v.rank === 3 ? "bg-orange-100 text-orange-700" : "bg-muted text-muted-foreground"
                            }`}>{v.rank}</span>
                          </td>
                          <td className="py-2 px-1.5">
                            <p className="font-semibold text-foreground">{v.name}</p>
                            <p className="text-[10px] text-muted-foreground">{v.zone}</p>
                          </td>
                          <td className="py-2 px-1.5 text-center font-semibold">{v.visits}</td>
                          <td className="py-2 px-1.5 text-center">{v.pdvsVisited}</td>
                          <td className="py-2 px-1.5 text-center">
                            <span className={`font-semibold ${v.compliance >= 80 ? "text-green-600" : v.compliance >= 50 ? "text-amber-600" : "text-red-600"}`}>
                              {v.compliance}%
                            </span>
                          </td>
                          <td className="py-2 px-1.5 text-center">{v.withGps}</td>
                          <td className="py-2 px-1.5 text-center">{v.avgTimeMin}m</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Tiempo promedio por TM Rep en cada PDV (últimos 90 días) */}
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                    <Clock size={18} />
                    Tiempo promedio por TM Rep en cada PDV
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">Últimos 90 días — sólo visitas cerradas</p>
                </div>
                <Badge variant="outline" className="text-xs">{avgTimeByTmPdv.length} combinaciones</Badge>
              </div>

              {avgTimeByTmPdv.length === 0 ? (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  Sin visitas cerradas en los últimos 90 días
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-2 px-1.5 font-semibold text-muted-foreground">TM Rep</th>
                        <th className="text-left py-2 px-1.5 font-semibold text-muted-foreground">PDV</th>
                        <th className="text-center py-2 px-1.5 font-semibold text-muted-foreground">Visitas</th>
                        <th className="text-right py-2 px-1.5 font-semibold text-muted-foreground">Tiempo prom.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {avgTimeByTmPdv.slice(0, 100).map((row) => (
                        <tr key={`${row.userId}-${row.pdvId}`} className="border-b border-border hover:bg-muted/30">
                          <td className="py-2 px-1.5 font-medium text-foreground">{row.userName}</td>
                          <td className="py-2 px-1.5 text-foreground truncate max-w-xs">{row.pdvName}</td>
                          <td className="py-2 px-1.5 text-center">{row.visitCount}</td>
                          <td className="py-2 px-1.5 text-right">
                            <span className={`font-semibold ${row.avgMinutes <= 15 ? "text-green-600" : row.avgMinutes <= 30 ? "text-amber-600" : "text-red-600"}`}>
                              {row.avgMinutes} min
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {avgTimeByTmPdv.length > 100 && (
                    <p className="text-[10px] text-muted-foreground text-center mt-2">
                      Mostrando 100 de {avgTimeByTmPdv.length} resultados
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
