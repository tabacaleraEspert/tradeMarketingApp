import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Card, CardContent } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { ArrowLeft, Calendar, User, TrendingUp, Camera, ChevronRight, Filter } from "lucide-react";
import { pointsOfSale, visits } from "../data/mockData";

export function History() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [dateFilter, setDateFilter] = useState("all");
  
  const pos = pointsOfSale.find((p) => p.id === id);
  const posVisits = visits
    .filter((v) => v.posId === id)
    .sort((a, b) => new Date(b.checkInTime).getTime() - new Date(a.checkInTime).getTime());

  if (!pos) {
    return null;
  }

  const calculateFrequency = () => {
    if (posVisits.length === 0) return "Sin datos";
    if (posVisits.length === 1) return "Primera visita";
    return `${posVisits.length} visitas en el mes`;
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 p-4 sticky top-0 z-10">
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={() => navigate(`/pos/${id}`)}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <ArrowLeft size={24} />
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-slate-900">Histórico</h1>
            <p className="text-sm text-slate-600">{pos.name}</p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 overflow-x-auto">
          <Button
            size="sm"
            variant={dateFilter === "all" ? "default" : "outline"}
            onClick={() => setDateFilter("all")}
          >
            Todas
          </Button>
          <Button
            size="sm"
            variant={dateFilter === "month" ? "default" : "outline"}
            onClick={() => setDateFilter("month")}
          >
            Este Mes
          </Button>
          <Button
            size="sm"
            variant={dateFilter === "quarter" ? "default" : "outline"}
            onClick={() => setDateFilter("quarter")}
          >
            Último Trimestre
          </Button>
          <Button size="sm" variant="outline">
            <Filter size={16} />
          </Button>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Summary Stats */}
        <Card className="bg-gradient-to-r from-blue-600 to-blue-700 text-white">
          <CardContent className="p-4">
            <h3 className="font-semibold mb-4">Resumen Histórico</h3>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-blue-100 text-xs mb-1">Frecuencia</p>
                <p className="text-lg font-bold">{calculateFrequency()}</p>
              </div>
              <div>
                <p className="text-blue-100 text-xs mb-1">Cumplimiento</p>
                <div className="flex items-center gap-1">
                  <TrendingUp size={16} />
                  <p className="text-lg font-bold">{pos.compliance}%</p>
                </div>
              </div>
              <div>
                <p className="text-blue-100 text-xs mb-1">Incidencias</p>
                <p className="text-lg font-bold">{pos.recentIssues || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Comparison Card */}
        {posVisits.length >= 2 && (
          <Card>
            <CardContent className="p-4">
              <h3 className="font-semibold text-slate-900 mb-3">
                Comparación: Última vs Anterior
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-slate-500 mb-1">Última Visita</p>
                  <Badge variant="secondary" className="mb-2">
                    Score: {posVisits[0].score || "N/A"}
                  </Badge>
                  <p className="text-xs text-slate-600">
                    {new Date(posVisits[0].checkInTime).toLocaleDateString("es-AR")}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-1">Anterior</p>
                  <Badge variant="outline" className="mb-2">
                    Score: {posVisits[1].score || "N/A"}
                  </Badge>
                  <p className="text-xs text-slate-600">
                    {new Date(posVisits[1].checkInTime).toLocaleDateString("es-AR")}
                  </p>
                </div>
              </div>

              <div className="mt-3 pt-3 border-t border-slate-100">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-600">Variación</span>
                  <span className="font-semibold text-green-600">
                    {posVisits[0].score && posVisits[1].score
                      ? `+${posVisits[0].score - posVisits[1].score} puntos`
                      : "N/A"}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Timeline */}
        <div>
          <h3 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
            <Calendar size={18} />
            Timeline de Visitas ({posVisits.length})
          </h3>

          {posVisits.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <p className="text-slate-500">No hay visitas registradas</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {posVisits.map((visit, index) => (
                <Card
                  key={visit.id}
                  className="cursor-pointer hover:shadow-md transition-shadow"
                >
                  <CardContent className="p-4">
                    {/* Date */}
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className="bg-blue-600 text-white rounded-full w-8 h-8 flex items-center justify-center text-xs font-bold">
                          {index + 1}
                        </div>
                        <div>
                          <p className="font-semibold text-slate-900">
                            {new Date(visit.checkInTime).toLocaleDateString("es-AR", {
                              day: "numeric",
                              month: "long",
                              year: "numeric",
                            })}
                          </p>
                          <p className="text-xs text-slate-500">
                            {new Date(visit.checkInTime).toLocaleTimeString("es-AR", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </p>
                        </div>
                      </div>
                      <Badge
                        variant={
                          visit.status === "completed" ? "secondary" : "default"
                        }
                      >
                        {visit.status === "completed" ? "Completa" : "En Curso"}
                      </Badge>
                    </div>

                    {/* User */}
                    <div className="flex items-center gap-2 mb-3 text-sm text-slate-600">
                      <User size={14} />
                      <span>{visit.userName}</span>
                    </div>

                    {/* Stats */}
                    {visit.status === "completed" && (
                      <div className="grid grid-cols-3 gap-3 mb-3 p-3 bg-slate-50 rounded-lg">
                        {visit.score && (
                          <div className="text-center">
                            <p className="text-xs text-slate-500 mb-0.5">Score</p>
                            <p className="text-lg font-bold text-slate-900">{visit.score}</p>
                          </div>
                        )}
                        {visit.duration && (
                          <div className="text-center">
                            <p className="text-xs text-slate-500 mb-0.5">Duración</p>
                            <p className="text-sm font-semibold text-slate-900">
                              {visit.duration} min
                            </p>
                          </div>
                        )}
                        {visit.photos && (
                          <div className="text-center">
                            <p className="text-xs text-slate-500 mb-0.5">Fotos</p>
                            <p className="text-sm font-semibold text-slate-900">
                              {visit.photos.length}
                            </p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Observations */}
                    {visit.observations && (
                      <p className="text-sm text-slate-600 mb-3 italic">
                        "{visit.observations}"
                      </p>
                    )}

                    {/* Photos */}
                    {visit.photos && visit.photos.length > 0 && (
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <Camera size={14} className="text-slate-500" />
                          <span className="text-xs text-slate-500 font-medium">
                            Evidencia Fotográfica
                          </span>
                        </div>
                        <div className="flex gap-2 overflow-x-auto">
                          {visit.photos.map((photo) => (
                            <img
                              key={photo.id}
                              src={photo.url}
                              alt="Foto de visita"
                              className="w-20 h-20 object-cover rounded-lg flex-shrink-0"
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* View Details */}
                    <button className="w-full mt-3 pt-3 border-t border-slate-100 flex items-center justify-center gap-2 text-sm text-blue-600 font-medium hover:text-blue-700">
                      Ver Detalle Completo
                      <ChevronRight size={16} />
                    </button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
