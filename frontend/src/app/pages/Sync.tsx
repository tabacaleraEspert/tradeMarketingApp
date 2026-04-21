import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import {
  ArrowLeft,
  RefreshCw,
  Wifi,
  WifiOff,
  CheckCircle2,
  Clock,
  AlertCircle,
  AlertTriangle,
  Trash2,
} from "lucide-react";
import { queue, subscribeQueueChanges, type QueuedOperation } from "@/lib/offline/queue";
import { flushQueue } from "@/lib/offline/sync-worker";
import { toast } from "sonner";

const KIND_LABELS: Record<string, string> = {
  visit_check: "Check de visita",
  visit_create: "Crear visita",
  visit_update: "Actualizar visita",
  visit_answers: "Respuestas formulario",
  visit_action_update: "Acción de visita",
  photo_upload: "Subir foto",
  pdv_create: "Crear PDV",
  pdv_note_create: "Nota de PDV",
};

function formatAge(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "Ahora";
  if (diffMin < 60) return `Hace ${diffMin} min`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `Hace ${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  return `Hace ${diffDays}d`;
}

export function Sync() {
  const navigate = useNavigate();
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isSyncing, setIsSyncing] = useState(false);
  const [operations, setOperations] = useState<QueuedOperation[]>([]);

  const refreshQueue = useCallback(async () => {
    try {
      const ops = await queue.list();
      setOperations(ops);
    } catch {
      /* IDB not available */
    }
  }, []);

  // Load queue on mount and subscribe to changes
  useEffect(() => {
    refreshQueue();
    const unsub = subscribeQueueChanges(() => {
      refreshQueue();
    });
    return unsub;
  }, [refreshQueue]);

  // Track online/offline status
  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  const handleSync = async () => {
    if (isSyncing || !isOnline) return;
    setIsSyncing(true);
    try {
      const result = await flushQueue();
      await refreshQueue();
      if (result.succeeded > 0 && result.failed === 0) {
        toast.success(`Sincronización completada: ${result.succeeded} operaciones enviadas`);
      } else if (result.succeeded > 0 && result.failed > 0) {
        toast.warning(
          `Parcial: ${result.succeeded} enviadas, ${result.failed} fallaron`
        );
      } else if (result.processed === 0 && operations.length === 0) {
        toast.info("No hay operaciones pendientes");
      } else if (result.failed > 0) {
        toast.error(`${result.failed} operaciones fallaron. Se reintentarán luego.`);
      }
    } catch (e) {
      toast.error("Error al sincronizar");
      console.error("[Sync] flushQueue error:", e);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleClearQueue = async () => {
    if (!confirm("¿Eliminar todas las operaciones pendientes? Esta acción no se puede deshacer.")) return;
    await queue.clear();
    await refreshQueue();
    toast.success("Cola vaciada");
  };

  const pendingCount = operations.length;
  const deadOps = operations.filter((op) => op.attempts >= 5);
  const activeOps = operations.filter((op) => op.attempts < 5);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b border-border p-4 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/")}
            className="p-2 hover:bg-muted rounded-lg transition-colors"
          >
            <ArrowLeft size={24} />
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-foreground">Sincronización</h1>
            <p className="text-sm text-muted-foreground">Estado de datos offline/online</p>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Connection Status */}
        <Card
          className={
            isOnline
              ? "bg-green-50 border-green-200"
              : "bg-red-50 border-red-200"
          }
        >
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div
                className={`rounded-full p-3 ${
                  isOnline ? "bg-green-600" : "bg-red-600"
                }`}
              >
                {isOnline ? (
                  <Wifi size={24} className="text-white" />
                ) : (
                  <WifiOff size={24} className="text-white" />
                )}
              </div>
              <div className="flex-1">
                <p
                  className={`font-semibold ${
                    isOnline ? "text-green-900" : "text-red-900"
                  }`}
                >
                  {isOnline ? "Conectado" : "Sin Conexión"}
                </p>
                <p
                  className={`text-sm ${
                    isOnline ? "text-green-700" : "text-red-700"
                  }`}
                >
                  {isOnline
                    ? "Datos sincronizados en tiempo real"
                    : "Trabajando en modo offline"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Queue Summary */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="bg-espert-gold/10 rounded-full p-3">
                <Clock size={24} className="text-espert-gold" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-foreground">Operaciones Pendientes</p>
                <p className="text-sm text-muted-foreground">
                  {pendingCount === 0
                    ? "Todo sincronizado"
                    : `${pendingCount} operacion${pendingCount === 1 ? "" : "es"} en cola`}
                </p>
              </div>
              <Badge
                variant={pendingCount > 0 ? "default" : "secondary"}
                className="text-base px-3 py-1"
              >
                {pendingCount}
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* Pending Operations List */}
        {activeOps.length > 0 && (
          <div className="space-y-3">
            <h3 className="font-semibold text-foreground">En Cola</h3>
            {activeOps.map((op) => (
              <Card key={op.id}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-foreground truncate">
                        {op.label || KIND_LABELS[op.kind] || op.kind}
                      </p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                        <span>{KIND_LABELS[op.kind] || op.kind}</span>
                        <span>·</span>
                        <span>{formatAge(op.createdAt)}</span>
                        {op.attempts > 0 && (
                          <>
                            <span>·</span>
                            <span className="text-yellow-600">
                              {op.attempts} intento{op.attempts > 1 ? "s" : ""}
                            </span>
                          </>
                        )}
                      </div>
                      {op.lastError && (
                        <p className="text-xs text-red-500 mt-1 truncate">{op.lastError}</p>
                      )}
                    </div>
                    <Badge variant="secondary" className="text-xs shrink-0">
                      {op.method}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Dead Operations (>= 5 attempts) */}
        {deadOps.length > 0 && (
          <div className="space-y-3">
            <h3 className="font-semibold text-red-600 flex items-center gap-2">
              <AlertTriangle size={18} />
              Operaciones Fallidas ({deadOps.length})
            </h3>
            {deadOps.map((op) => (
              <Card key={op.id} className="border-red-200">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-foreground truncate">
                        {op.label || KIND_LABELS[op.kind] || op.kind}
                      </p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                        <span>{KIND_LABELS[op.kind] || op.kind}</span>
                        <span>·</span>
                        <span>{formatAge(op.createdAt)}</span>
                        <span>·</span>
                        <span className="text-red-500">{op.attempts} intentos fallidos</span>
                      </div>
                      {op.lastError && (
                        <p className="text-xs text-red-500 mt-1 truncate">{op.lastError}</p>
                      )}
                    </div>
                    <Badge variant="destructive" className="text-xs shrink-0">
                      Error
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Empty State */}
        {pendingCount === 0 && (
          <Card className="bg-green-50 border-green-200">
            <CardContent className="p-6 text-center">
              <CheckCircle2 size={40} className="text-green-600 mx-auto mb-2" />
              <p className="font-semibold text-green-900">Todo sincronizado</p>
              <p className="text-sm text-green-700 mt-1">
                No hay operaciones pendientes
              </p>
            </CardContent>
          </Card>
        )}

        {/* Sync Button */}
        <Button
          className="w-full h-14 text-base font-semibold"
          size="lg"
          onClick={handleSync}
          disabled={isSyncing || !isOnline || pendingCount === 0}
        >
          <RefreshCw size={20} className={`mr-2 ${isSyncing ? "animate-spin" : ""}`} />
          {isSyncing
            ? "Sincronizando..."
            : pendingCount === 0
            ? "Todo Sincronizado"
            : `Sincronizar Ahora (${pendingCount})`}
        </Button>

        {/* Clear Queue (only show when there are items) */}
        {pendingCount > 0 && (
          <Button
            variant="outline"
            className="w-full text-red-600 border-red-200 hover:bg-red-50"
            onClick={handleClearQueue}
          >
            <Trash2 size={16} className="mr-2" />
            Vaciar Cola
          </Button>
        )}

        {/* Info Card */}
        <Card className="bg-espert-gold/10 border-espert-gold/30">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 size={20} className="text-espert-gold mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-semibold text-foreground mb-2">Modo Offline</p>
                <ul className="space-y-1 text-sm text-espert-gold">
                  <li className="flex items-start gap-2">
                    <span className="text-espert-gold font-bold">·</span>
                    <span>Todos los datos se guardan localmente en tu dispositivo</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-espert-gold font-bold">·</span>
                    <span>Se sincronizarán automáticamente al recuperar conexión</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-espert-gold font-bold">·</span>
                    <span>Puedes continuar trabajando sin interrupciones</span>
                  </li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>

        {!isOnline && (
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
