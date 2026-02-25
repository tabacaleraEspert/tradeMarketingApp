import { useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { ArrowLeft, MapPin, Clock, CheckCircle2, AlertTriangle, Navigation2 } from "lucide-react";
import { pointsOfSale } from "../data/mockData";
import { toast } from "sonner";

export function CheckIn() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const routeDayId = (location.state as { routeDayId?: number } | null)?.routeDayId;
  const [isCheckedIn, setIsCheckedIn] = useState(false);
  const [gpsStatus] = useState<"ok" | "out-of-range">("ok");
  
  const pos = pointsOfSale.find((p) => p.id === id);
  const currentTime = new Date().toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
  });

  if (!pos) {
    return null;
  }

  const handleCheckIn = () => {
    setIsCheckedIn(true);
    toast.success("Check-in registrado correctamente");

    setTimeout(() => {
      navigate(`/pos/${id}/survey`, {
        state: routeDayId ? { routeDayId } : undefined,
      });
    }, 1500);
  };

  const handleCheckOut = () => {
    toast.success("Visita finalizada correctamente");
    navigate("/route");
  };

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
            <p className="text-sm text-slate-600">{pos.name}</p>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Location Card */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-start gap-3 mb-4">
              <div className="bg-blue-100 rounded-full p-3">
                <MapPin size={24} className="text-blue-600" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-slate-900 mb-1">{pos.name}</h3>
                <p className="text-sm text-slate-600">{pos.address}</p>
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
                  <span className="font-semibold text-slate-900">10:35 hs</span>
                </div>
                <div className="flex items-center justify-between text-sm mt-2">
                  <span className="text-slate-600">Duración de visita:</span>
                  <span className="font-semibold text-blue-600">15 minutos</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

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
              disabled={gpsStatus !== "ok"}
            >
              <CheckCircle2 className="mr-2" size={20} />
              Confirmar Check-in
            </Button>
          ) : (
            <>
              <Button
                className="w-full h-14 text-base font-semibold"
                size="lg"
                onClick={() =>
                  navigate(`/pos/${id}/survey`, {
                    state: routeDayId ? { routeDayId } : undefined,
                  })
                }
              >
                Continuar con Relevamiento
              </Button>
              <Button
                variant="outline"
                className="w-full h-12"
                onClick={handleCheckOut}
              >
                Cerrar Visita
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
