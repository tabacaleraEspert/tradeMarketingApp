import { KPICard } from "../../components/ui/kpi-card";
import { Card, CardContent } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  TrendingUp,
  MapPin,
  Camera,
  Award,
  Download,
  Calendar,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";

export function Reports() {
  const vendorPerformance = [
    {
      rank: 1,
      name: "Carlos Martínez",
      zone: "Zona Norte",
      visits: 127,
      planned: 130,
      coverage: 98,
      compliance: 95,
      withGPS: 127,
      withPhoto: 125,
      avgTime: 25,
    },
    {
      rank: 2,
      name: "María González",
      zone: "Zona Sur",
      visits: 118,
      planned: 125,
      coverage: 94,
      compliance: 92,
      withGPS: 118,
      withPhoto: 116,
      avgTime: 28,
    },
    {
      rank: 3,
      name: "Roberto Silva",
      zone: "Zona Centro",
      visits: 115,
      planned: 120,
      coverage: 96,
      compliance: 88,
      withGPS: 113,
      withPhoto: 110,
      avgTime: 32,
    },
    {
      rank: 4,
      name: "Ana Torres",
      zone: "Zona Oeste",
      visits: 110,
      planned: 115,
      coverage: 96,
      compliance: 90,
      withGPS: 110,
      withPhoto: 108,
      avgTime: 27,
    },
    {
      rank: 5,
      name: "Luis Ramírez",
      zone: "Zona Este",
      visits: 105,
      planned: 120,
      coverage: 88,
      compliance: 85,
      withGPS: 102,
      withPhoto: 100,
      avgTime: 30,
    },
  ];

  const channelCoverage = [
    { channel: "Kioscos", total: 450, visited: 398, coverage: 88, gps: 396, photo: 390 },
    { channel: "Autoservicios", total: 280, visited: 256, coverage: 91, gps: 255, photo: 250 },
    { channel: "Mayoristas", total: 180, visited: 155, coverage: 86, gps: 152, photo: 148 },
    { channel: "Supermercados", total: 120, visited: 110, coverage: 92, gps: 110, photo: 108 },
  ];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">Reportes de Cumplimiento</h1>
          <p className="text-slate-600">Análisis de cobertura, visitas y desempeño</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="gap-2">
            <Calendar size={16} />
            Feb 2026
          </Button>
          <Button className="gap-2">
            <Download size={16} />
            Exportar
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Cobertura Total"
          value="89%"
          subtitle="919 de 1,030 PDV visitados"
          icon={<MapPin size={20} />}
          color="blue"
          trend={{ value: 3, isPositive: true }}
        />
        <KPICard
          title="Cumplimiento Promedio"
          value="90%"
          subtitle="Meta: 85%"
          icon={<CheckCircle2 size={20} />}
          color="green"
          trend={{ value: 5, isPositive: true }}
        />
        <KPICard
          title="Visitas con GPS"
          value="98%"
          subtitle="902 de 919 visitas"
          icon={<MapPin size={20} />}
          color="purple"
        />
        <KPICard
          title="Visitas con Foto"
          value="96%"
          subtitle="882 de 919 visitas"
          icon={<Camera size={20} />}
          color="yellow"
        />
      </div>

      {/* Ranking de Vendedores */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <Award size={24} className="text-yellow-500" />
              Ranking de Vendedores
            </h2>
            <Badge variant="outline">Febrero 2026</Badge>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-3 px-2 text-xs font-semibold text-slate-600 uppercase">
                    Rank
                  </th>
                  <th className="text-left py-3 px-2 text-xs font-semibold text-slate-600 uppercase">
                    Vendedor
                  </th>
                  <th className="text-center py-3 px-2 text-xs font-semibold text-slate-600 uppercase">
                    Visitas
                  </th>
                  <th className="text-center py-3 px-2 text-xs font-semibold text-slate-600 uppercase">
                    Cobertura
                  </th>
                  <th className="text-center py-3 px-2 text-xs font-semibold text-slate-600 uppercase">
                    Cumplimiento
                  </th>
                  <th className="text-center py-3 px-2 text-xs font-semibold text-slate-600 uppercase">
                    Con GPS
                  </th>
                  <th className="text-center py-3 px-2 text-xs font-semibold text-slate-600 uppercase">
                    Con Foto
                  </th>
                  <th className="text-center py-3 px-2 text-xs font-semibold text-slate-600 uppercase">
                    Tiempo Prom.
                  </th>
                </tr>
              </thead>
              <tbody>
                {vendorPerformance.map((vendor) => (
                  <tr
                    key={vendor.rank}
                    className="border-b border-slate-100 hover:bg-slate-50 transition-colors"
                  >
                    <td className="py-3 px-2">
                      <div
                        className={`flex items-center justify-center w-8 h-8 rounded-full font-bold text-sm ${
                          vendor.rank === 1
                            ? "bg-yellow-100 text-yellow-700"
                            : vendor.rank === 2
                            ? "bg-slate-200 text-slate-700"
                            : vendor.rank === 3
                            ? "bg-orange-100 text-orange-700"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {vendor.rank}
                      </div>
                    </td>
                    <td className="py-3 px-2">
                      <p className="font-semibold text-slate-900">{vendor.name}</p>
                      <p className="text-xs text-slate-500">{vendor.zone}</p>
                    </td>
                    <td className="py-3 px-2 text-center">
                      <p className="font-semibold text-slate-900">{vendor.visits}</p>
                      <p className="text-xs text-slate-500">de {vendor.planned}</p>
                    </td>
                    <td className="py-3 px-2 text-center">
                      <Badge
                        variant={vendor.coverage >= 95 ? "default" : "secondary"}
                        className="font-semibold"
                      >
                        {vendor.coverage}%
                      </Badge>
                    </td>
                    <td className="py-3 px-2 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <span
                          className={`font-semibold ${
                            vendor.compliance >= 90
                              ? "text-green-600"
                              : vendor.compliance >= 80
                              ? "text-yellow-600"
                              : "text-red-600"
                          }`}
                        >
                          {vendor.compliance}%
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-2 text-center">
                      <div className="flex items-center justify-center gap-1">
                        {vendor.withGPS === vendor.visits ? (
                          <CheckCircle2 size={16} className="text-green-600" />
                        ) : (
                          <AlertCircle size={16} className="text-yellow-600" />
                        )}
                        <span className="text-sm font-semibold text-slate-700">
                          {vendor.withGPS}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-2 text-center">
                      <div className="flex items-center justify-center gap-1">
                        {vendor.withPhoto >= vendor.visits * 0.95 ? (
                          <CheckCircle2 size={16} className="text-green-600" />
                        ) : (
                          <AlertCircle size={16} className="text-yellow-600" />
                        )}
                        <span className="text-sm font-semibold text-slate-700">
                          {vendor.withPhoto}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-2 text-center">
                      <span className="text-sm font-semibold text-slate-700">
                        {vendor.avgTime} min
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Cobertura por Canal */}
      <Card>
        <CardContent className="p-6">
          <h2 className="text-xl font-bold text-slate-900 mb-4">Cobertura por Canal</h2>

          <div className="space-y-6">
            {channelCoverage.map((channel) => (
              <div key={channel.channel}>
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <h3 className="font-semibold text-slate-900">{channel.channel}</h3>
                    <p className="text-sm text-slate-600">
                      {channel.visited} de {channel.total} PDV visitados
                    </p>
                  </div>
                  <Badge
                    variant={channel.coverage >= 90 ? "default" : "secondary"}
                    className="text-lg px-3 py-1"
                  >
                    {channel.coverage}%
                  </Badge>
                </div>

                <div className="w-full bg-slate-200 rounded-full h-3 mb-3">
                  <div
                    className={`h-3 rounded-full transition-all ${
                      channel.coverage >= 90
                        ? "bg-green-500"
                        : channel.coverage >= 80
                        ? "bg-blue-500"
                        : "bg-yellow-500"
                    }`}
                    style={{ width: `${channel.coverage}%` }}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="flex items-center gap-2 text-sm">
                    <MapPin size={16} className="text-purple-600" />
                    <span className="text-slate-600">Con GPS:</span>
                    <span className="font-semibold text-slate-900">
                      {channel.gps} ({Math.round((channel.gps / channel.visited) * 100)}%)
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Camera size={16} className="text-blue-600" />
                    <span className="text-slate-600">Con Foto:</span>
                    <span className="font-semibold text-slate-900">
                      {channel.photo} ({Math.round((channel.photo / channel.visited) * 100)}%)
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
