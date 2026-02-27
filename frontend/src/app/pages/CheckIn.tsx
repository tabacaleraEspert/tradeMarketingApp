import { useState, useEffect } from "react";
import { useNavigate, useParams, useLocation } from "react-router";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Textarea } from "../components/ui/textarea";
import { Label } from "../components/ui/label";
import { ArrowLeft, MapPin, Clock, CheckCircle2, AlertTriangle, Navigation2, MessageSquare } from "lucide-react";
import { pdvsApi, visitsApi } from "@/lib/api";
import { getCurrentUser } from "../lib/auth";
import { toast } from "sonner";

export function CheckIn() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const routeDayId = (location.state as { routeDayId?: number; visitId?: number } | null)?.routeDayId;
  const visitIdFromState = (location.state as { visitId?: number } | null)?.visitId;

  const [pdv, setPdv] = useState<Awaited<ReturnType<typeof pdvsApi.get>> | null>(null);
  const [lastReminder, setLastReminder] = useState<string | null>(null);
  const [isCheckedIn, setIsCheckedIn] = useState(false);
  const [currentVisitId, setCurrentVisitId] = useState<number | null>(visitIdFromState ?? null);
  const [reminderForNext, setReminderForNext] = useState("");
  const [gpsStatus] = useState<"ok" | "out-of-range">("ok");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const currentUser = getCurrentUser();
  const currentTime = new Date().toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
  });

  useEffect(() => {
    if (!id) return;
    const pdvId = Number(id);
    pdvsApi.get(pdvId).then(setPdv).catch(() => setPdv(null));

    visitsApi
      .list({ pdv_id: pdvId, status: "CLOSED" })
      .then((visits) => {
        const last = visits[0];
        setLastReminder(last?.CloseReason || null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  const handleCheckIn = async () => {
    if (!id || !pdv) return;
    setSaving(true);
    try {
      const visit = await visitsApi.create({
        PdvId: Number(id),
        UserId: Number(currentUser.id),
        RouteDayId: routeDayId ?? undefined,
        Status: "OPEN",
      });
      setCurrentVisitId(visit.VisitId);
      setIsCheckedIn(true);
      toast.success("Check-in registrado correctamente");

      setTimeout(() => {
        navigate(`/pos/${id}/survey`, {
          state: { routeDayId, visitId: visit.VisitId },
        });
      }, 1500);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al registrar check-in");
    } finally {
      setSaving(false);
    }
  };

  const handleCheckOut = async () => {
    if (!currentVisitId) {
      toast.error("No hay visita activa para cerrar");
      return;
    }
    setSaving(true);
    try {
      await visitsApi.update(currentVisitId, {
        Status: "CLOSED",
        CloseReason: reminderForNext.trim() || undefined,
      });
      toast.success("Visita finalizada correctamente");
      navigate("/route");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al cerrar visita");
    } finally {
      setSaving(false);
    }
  };

  if (loading || !pdv) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-slate-600">{loading ? "Cargando..." : "PDV no encontrado"}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 p-4 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(`/pos/${id}`)}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <ArrowLeft size={24} />
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-slate-900">
              {isCheckedIn ? "Check-out" : "Check-in"}
            </h1>
            <p className="text-sm text-slate-600">{pdv.Name}</p>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Recordatorio próxima visita - mostrado al entrar */}
        {!isCheckedIn && lastReminder && (
          <Card className="bg-amber-50 border-amber-200">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <MessageSquare size={22} className="text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-semibold text-amber-900 mb-1">Recordatorio próxima visita</h3>
                  <p className="text-sm text-amber-800">{lastReminder}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Location Card */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-start gap-3 mb-4">
              <div className="bg-blue-100 rounded-full p-3">
                <MapPin size={24} className="text-blue-600" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-slate-900 mb-1">{pdv.Name}</h3>
                <p className="text-sm text-slate-600">{pdv.Address || pdv.City || "-"}</p>
              </div>
            </div>

            {/* GPS Status */}
            <div
              className={`flex items-center gap-2 p-3 rounded-lg ${
                gpsStatus === "ok"
                  ? "bg-green-50 border border-green-200"
                  : "bg-red-50 border border-red-200"
              }`}
            >
              {gpsStatus === "ok" ? (
                <>
                  <Navigation2 size={20} className="text-green-600" />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-green-900">Ubicación Confirmada</p>
                    <p className="text-xs text-green-700">GPS dentro del perímetro</p>
                  </div>
                  <CheckCircle2 size={20} className="text-green-600" />
                </>
              ) : (
                <>
                  <AlertTriangle size={20} className="text-red-600" />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-red-900">Fuera de Rango</p>
                    <p className="text-xs text-red-700">Ubicación fuera del perímetro del PDV</p>
                  </div>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Time Card */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="bg-purple-100 rounded-full p-3">
                <Clock size={24} className="text-purple-600" />
              </div>
              <div className="flex-1">
                <p className="text-sm text-slate-500">Hora Actual</p>
                <p className="text-2xl font-bold text-slate-900">{currentTime}</p>
              </div>
            </div>

            {isCheckedIn && (
              <div className="pt-3 border-t border-slate-100">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-600">Check-in realizado:</span>
                  <span className="font-semibold text-slate-900">{currentTime}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recordatorio al cerrar - campo para dejar comentario */}
        {isCheckedIn && (
          <Card>
            <CardContent className="p-4">
              <Label className="text-sm font-semibold text-slate-900 mb-2 block">
                Recordatorio próxima visita
              </Label>
              <Textarea
                placeholder="Deja un comentario o tarea para la próxima visita (ej: Verificar stock de producto X, Pedir reposición de material POP...)"
                value={reminderForNext}
                onChange={(e) => setReminderForNext(e.target.value)}
                rows={3}
                className="resize-none"
              />
            </CardContent>
          </Card>
        )}

        {/* Visit Info */}
        {!isCheckedIn && (
          <Card className="bg-blue-50 border-blue-200">
            <CardContent className="p-4">
              <h3 className="font-semibold text-blue-900 mb-2">Información de Visita</h3>
              <ul className="space-y-2 text-sm text-blue-800">
                <li className="flex items-start gap-2">
                  <span className="text-blue-600 font-bold">•</span>
                  <span>Asegúrate de estar dentro del perímetro del punto de venta</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-600 font-bold">•</span>
                  <span>La hora de check-in será registrada automáticamente</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-600 font-bold">•</span>
                  <span>Después del check-in podrás completar el relevamiento</span>
                </li>
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Actions */}
        <div className="space-y-3 pb-4">
          {!isCheckedIn ? (
            <Button
              className="w-full h-14 text-base font-semibold"
              size="lg"
              onClick={handleCheckIn}
              disabled={gpsStatus !== "ok" || saving}
            >
              <CheckCircle2 className="mr-2" size={20} />
              {saving ? "Registrando..." : "Confirmar Check-in"}
            </Button>
          ) : (
            <>
              <Button
                className="w-full h-14 text-base font-semibold"
                size="lg"
                onClick={() =>
                  navigate(`/pos/${id}/survey`, {
                    state: { routeDayId, visitId: currentVisitId },
                  })
                }
              >
                Continuar con Relevamiento
              </Button>
              <Button
                variant="outline"
                className="w-full h-12"
                onClick={handleCheckOut}
                disabled={saving}
              >
                {saving ? "Cerrando..." : "Cerrar Visita"}
              </Button>
            </>
          )}

          {gpsStatus !== "ok" && (
            <p className="text-center text-sm text-red-600">
              Debes estar dentro del perímetro del PDV para hacer check-in
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
