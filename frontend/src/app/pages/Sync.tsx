import { useState } from "react";
import { useNavigate } from "react-router";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Progress } from "../components/ui/progress";
import {
  ArrowLeft,
  RefreshCw,
  Wifi,
  WifiOff,
  FileText,
  Camera,
  CheckCircle2,
  Clock,
  AlertCircle,
} from "lucide-react";
import { syncStatus } from "../data/mockData";
import { toast } from "sonner";

export function Sync() {
  const navigate = useNavigate();
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);

  const handleSync = () => {
    setIsSyncing(true);
    setSyncProgress(0);

    // Simulate sync progress
    const interval = setInterval(() => {
      setSyncProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          setIsSyncing(false);
          toast.success("Sincronización completada");
          return 100;
        }
        return prev + 10;
      });
    }, 300);
  };

  const formatLastSync = (date: string) => {
    const now = new Date();
    const syncDate = new Date(date);
    const diffMinutes = Math.floor((now.getTime() - syncDate.getTime()) / (1000 * 60));

    if (diffMinutes < 60) {
      return `Hace ${diffMinutes} minutos`;
    } else if (diffMinutes < 1440) {
      const hours = Math.floor(diffMinutes / 60);
      return `Hace ${hours} ${hours === 1 ? "hora" : "horas"}`;
    } else {
      return syncDate.toLocaleDateString("es-AR", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 p-4 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/")}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <ArrowLeft size={24} />
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-slate-900">Sincronización</h1>
            <p className="text-sm text-slate-600">Estado de datos offline/online</p>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Connection Status */}
        <Card
          className={
            syncStatus.isOnline
              ? "bg-green-50 border-green-200"
              : "bg-red-50 border-red-200"
          }
        >
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div
                className={`rounded-full p-3 ${
                  syncStatus.isOnline ? "bg-green-600" : "bg-red-600"
                }`}
              >
                {syncStatus.isOnline ? (
                  <Wifi size={24} className="text-white" />
                ) : (
                  <WifiOff size={24} className="text-white" />
                )}
              </div>
              <div className="flex-1">
                <p
                  className={`font-semibold ${
                    syncStatus.isOnline ? "text-green-900" : "text-red-900"
                  }`}
                >
                  {syncStatus.isOnline ? "Conectado" : "Sin Conexión"}
                </p>
                <p
                  className={`text-sm ${
                    syncStatus.isOnline ? "text-green-700" : "text-red-700"
                  }`}
                >
                  {syncStatus.isOnline
                    ? "Datos sincronizados en tiempo real"
                    : "Trabajando en modo offline"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Last Sync */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="bg-blue-100 rounded-full p-3">
                <Clock size={24} className="text-blue-600" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-slate-900">Última Sincronización</p>
                <p className="text-sm text-slate-600">
                  {formatLastSync(syncStatus.lastSync)}
                </p>
              </div>
              <Badge variant="secondary">
                {new Date(syncStatus.lastSync).toLocaleTimeString("es-AR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </Badge>
            </div>

            {isSyncing && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-600">Sincronizando...</span>
                  <span className="font-semibold text-blue-600">{syncProgress}%</span>
                </div>
                <Progress value={syncProgress} />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pending Items */}
        <div className="space-y-3">
          <h3 className="font-semibold text-slate-900">Datos Pendientes de Sincronización</h3>

          {/* Pending Records */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="bg-yellow-100 rounded-full p-2.5">
                  <FileText size={20} className="text-yellow-600" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-slate-900">Registros de Relevamiento</p>
                  <p className="text-sm text-slate-600">
                    Formularios y datos de visitas
                  </p>
                </div>
                <Badge
                  variant={syncStatus.pendingRecords > 0 ? "default" : "secondary"}
                  className="text-base px-3 py-1"
                >
                  {syncStatus.pendingRecords}
                </Badge>
              </div>
            </CardContent>
          </Card>

          {/* Pending Photos */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="bg-purple-100 rounded-full p-2.5">
                  <Camera size={20} className="text-purple-600" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-slate-900">Fotos Pendientes</p>
                  <p className="text-sm text-slate-600">
                    Evidencia fotográfica sin subir
                  </p>
                </div>
                <Badge
                  variant={syncStatus.pendingPhotos > 0 ? "default" : "secondary"}
                  className="text-base px-3 py-1"
                >
                  {syncStatus.pendingPhotos}
                </Badge>
              </div>
            </CardContent>
          </Card>

          {/* Summary */}
          <Card className="bg-slate-50">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertCircle size={18} className="text-slate-500" />
                  <span className="text-sm text-slate-700">Total pendiente</span>
                </div>
                <span className="text-lg font-bold text-slate-900">
                  {syncStatus.pendingRecords + syncStatus.pendingPhotos} items
                </span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sync Button */}
        <Button
          className="w-full h-14 text-base font-semibold"
          size="lg"
          onClick={handleSync}
          disabled={
            isSyncing ||
            !syncStatus.isOnline ||
            (syncStatus.pendingRecords === 0 && syncStatus.pendingPhotos === 0)
          }
        >
          <RefreshCw size={20} className={`mr-2 ${isSyncing ? "animate-spin" : ""}`} />
          {isSyncing
            ? "Sincronizando..."
            : syncStatus.pendingRecords === 0 && syncStatus.pendingPhotos === 0
            ? "Todo Sincronizado"
            : "Sincronizar Ahora"}
        </Button>

        {/* Info Cards */}
        <Card className="bg-blue-50 border-blue-200">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 size={20} className="text-blue-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-semibold text-blue-900 mb-2">Modo Offline</p>
                <ul className="space-y-1 text-sm text-blue-800">
                  <li className="flex items-start gap-2">
                    <span className="text-blue-600 font-bold">•</span>
                    <span>Todos los datos se guardan localmente en tu dispositivo</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-600 font-bold">•</span>
                    <span>Se sincronizarán automáticamente al recuperar conexión</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-600 font-bold">•</span>
                    <span>Puedes continuar trabajando sin interrupciones</span>
                  </li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>

        {!syncStatus.isOnline && (
          <Card className="bg-yellow-50 border-yellow-200">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <AlertCircle size={20} className="text-yellow-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-semibold text-yellow-900 mb-1">Sin Conexión</p>
                  <p className="text-sm text-yellow-800">
                    Estás trabajando en modo offline. Conéctate a WiFi o datos móviles para sincronizar tus cambios.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
