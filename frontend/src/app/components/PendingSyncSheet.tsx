import { useEffect, useState } from "react";
import { Modal } from "./ui/modal";
import { Button } from "./ui/button";
import { Upload, X, RefreshCw, Trash2, AlertCircle, Camera, MapPin, MessageSquare, FileText, CheckCircle2 } from "lucide-react";
import { queue, subscribeQueueChanges, flushQueue, type QueuedOperation, type QueuedKind } from "@/lib/offline";
import { toast } from "sonner";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const KIND_META: Record<QueuedKind, { label: string; icon: typeof Camera; color: string }> = {
  visit_check: { label: "Check GPS", icon: MapPin, color: "text-blue-500" },
  visit_create: { label: "Inicio de visita", icon: FileText, color: "text-emerald-500" },
  visit_update: { label: "Cierre de visita", icon: CheckCircle2, color: "text-emerald-600" },
  visit_answers: { label: "Respuestas de form", icon: FileText, color: "text-purple-500" },
  visit_action_update: { label: "Acción de visita", icon: CheckCircle2, color: "text-blue-500" },
  photo_upload: { label: "Foto", icon: Camera, color: "text-amber-500" },
  pdv_create: { label: "Alta de PDV", icon: FileText, color: "text-indigo-500" },
  pdv_note_create: { label: "Nota de PDV", icon: MessageSquare, color: "text-rose-500" },
};

export function PendingSyncSheet({ isOpen, onClose }: Props) {
  const [items, setItems] = useState<QueuedOperation[]>([]);
  const [flushing, setFlushing] = useState(false);

  const refresh = () => {
    queue.list().then(setItems).catch(() => setItems([]));
  };

  useEffect(() => {
    if (!isOpen) return;
    refresh();
    const unsub = subscribeQueueChanges(refresh);
    return () => { unsub(); };
  }, [isOpen]);

  const handleFlush = async () => {
    if (!navigator.onLine) {
      toast.error("Sin conexión. Esperá a tener señal y reintentá.");
      return;
    }
    setFlushing(true);
    try {
      // Resetear intentos de todas las ops para que el flush las reintente
      const allOps = await queue.list();
      for (const op of allOps) {
        if (op.attempts > 0) {
          await queue.update({ ...op, attempts: 0, lastError: undefined });
        }
      }
      const result = await flushQueue();
      if (result.succeeded > 0) {
        toast.success(`${result.succeeded} operación(es) sincronizada(s)`);
      }
      if (result.failed > 0) {
        toast.error(`${result.failed} operación(es) fallaron. Revisá los detalles.`);
      }
      if (result.processed === 0 && allOps.length === 0) {
        toast.info("No hay nada para sincronizar");
      }
      refresh();
    } finally {
      setFlushing(false);
    }
  };

  const handleDiscard = async (id: number) => {
    if (!confirm("¿Descartar esta operación? No se va a sincronizar nunca.")) return;
    await queue.remove(id);
    toast.success("Operación descartada");
    refresh();
  };

  const handleDiscardAll = async () => {
    if (items.length === 0) return;
    if (!confirm(`¿Descartar las ${items.length} operaciones pendientes? Esta acción no se puede deshacer.`)) return;
    await queue.clear();
    toast.success("Cola vaciada");
    refresh();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Operaciones pendientes de sync"
      size="lg"
      footer={
        <div className="flex items-center justify-between w-full">
          <Button
            variant="outline"
            size="sm"
            onClick={handleDiscardAll}
            disabled={items.length === 0 || flushing}
            className="text-red-600 border-red-200 hover:bg-red-50"
          >
            Descartar todo
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Cerrar
            </Button>
            <Button onClick={handleFlush} disabled={items.length === 0 || flushing}>
              <RefreshCw size={14} className={`mr-1.5 ${flushing ? "animate-spin" : ""}`} />
              {flushing ? "Sincronizando..." : "Reintentar todo"}
            </Button>
          </div>
        </div>
      }
    >
      {items.length === 0 ? (
        <div className="text-center py-10 space-y-2">
          <CheckCircle2 size={36} className="mx-auto text-emerald-500/70" />
          <p className="font-semibold text-foreground">Sin operaciones pendientes</p>
          <p className="text-xs text-muted-foreground">Todo está sincronizado.</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[60vh] overflow-y-auto">
          <p className="text-xs text-muted-foreground mb-2">
            Estas operaciones se hicieron sin conexión y van a reintentarse automáticamente cuando vuelva la señal.
          </p>
          {items.map((op) => {
            const meta = KIND_META[op.kind] ?? { label: op.kind, icon: FileText, color: "text-muted-foreground" };
            const Icon = meta.icon;
            const ageMs = Date.now() - op.createdAt;
            const ageMin = Math.round(ageMs / 60000);
            const ageLabel = ageMin < 1 ? "ahora" : ageMin < 60 ? `hace ${ageMin}m` : `hace ${Math.round(ageMin / 60)}h`;
            return (
              <div
                key={op.id}
                className="flex items-start gap-3 p-3 border border-border rounded-lg bg-muted/30"
              >
                <div className="flex-shrink-0 p-2 rounded-lg bg-card">
                  <Icon size={18} className={meta.color} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                      {meta.label}
                    </span>
                    {op.attempts > 0 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                        {op.attempts} intento{op.attempts === 1 ? "" : "s"}
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-medium text-foreground truncate">{op.label}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{ageLabel}</p>
                  {op.lastError && (
                    <div className="mt-1.5 flex items-start gap-1 text-[11px] text-red-600">
                      <AlertCircle size={11} className="flex-shrink-0 mt-0.5" />
                      <span className="break-words">{op.lastError}</span>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => op.id && handleDiscard(op.id)}
                  className="flex-shrink-0 p-1.5 rounded hover:bg-red-50 text-muted-foreground hover:text-red-600"
                  title="Descartar"
                >
                  <X size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

/**
 * Indicador flotante en la esquina inferior que muestra cuántas operaciones
 * hay pendientes de sync. Click → abre el modal de detalles.
 *
 * Sólo aparece si hay >= 1 operación pendiente.
 */
export function PendingSyncIndicator() {
  const [count, setCount] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    queue.count().then(setCount).catch(() => setCount(0));
    const unsub = subscribeQueueChanges(() => {
      queue.count().then(setCount).catch(() => setCount(0));
    });
    return () => { unsub(); };
  }, []);

  if (count === 0 && !modalOpen) return null;

  return (
    <>
      {count > 0 && (
        <button
          onClick={() => setModalOpen(true)}
          className="fixed bottom-20 right-4 z-40 flex items-center gap-2 px-3 py-2 rounded-full bg-amber-500 text-white shadow-lg hover:bg-amber-600 transition-colors"
          title="Operaciones pendientes de sincronización"
        >
          <Upload size={16} />
          <span className="text-sm font-semibold">{count} pendiente{count === 1 ? "" : "s"}</span>
        </button>
      )}
      <PendingSyncSheet isOpen={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}
