import { useEffect, useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "../../components/ui/modal";
import { Button } from "../../components/ui/button";
import { api } from "@/lib/api/client";

/** Traspaso masivo de PDVs entre trades (POST /routes/transfer-portfolio, solo admin). */

export interface TransferSummary {
  mode: "whole" | "partial";
  to_user_name: string;
  pdvs: number;
  already_owned: number;
  routes: { RouteId: number; Name: string; pdvs: number | null }[];
  future_days: number;
  dry_run: boolean;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Con ids = traspaso parcial de esos PDVs; null = cartera completa (se elige el origen). */
  pdvIds: number[] | null;
  users: { id: number; name: string }[];
  onDone: () => void;
}

const selectClass =
  "w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-espert-gold";

export function PortfolioTransferModal({ isOpen, onClose, pdvIds, users, onDone }: Props) {
  const whole = pdvIds === null;
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [summary, setSummary] = useState<TransferSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setFromId("");
      setToId("");
      setSummary(null);
      setError(null);
    }
  }, [isOpen]);

  const ready = !!toId && (whole ? !!fromId && fromId !== toId : (pdvIds?.length ?? 0) > 0);

  const body = (dryRun: boolean) => ({
    to_user_id: Number(toId),
    ...(whole ? { from_user_id: Number(fromId) } : { pdv_ids: pdvIds }),
    dry_run: dryRun,
  });

  // Resumen previo (simulación) cada vez que cambia origen/destino
  useEffect(() => {
    if (!isOpen || !ready) {
      setSummary(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .post<TransferSummary>("/routes/transfer-portfolio", body(true))
      .then((s) => !cancelled && setSummary(s))
      .catch((e) => {
        if (cancelled) return;
        setSummary(null);
        setError(e?.message || "No se pudo calcular el traspaso");
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, ready, fromId, toId, pdvIds]);

  const confirm = async () => {
    setSaving(true);
    try {
      const s = await api.post<TransferSummary>("/routes/transfer-portfolio", body(false));
      toast.success(`${s.pdvs} PDVs pasados a ${s.to_user_name}`);
      onDone();
      onClose();
    } catch (e: any) {
      toast.error(e?.message || "No se pudo hacer el traspaso");
    } finally {
      setSaving(false);
    }
  };

  const toMove = summary ? summary.pdvs - summary.already_owned : 0;

  return (
    <Modal
      isOpen={isOpen}
      onClose={saving ? () => {} : onClose}
      title={whole ? "Traspasar cartera completa" : `Pasar ${pdvIds?.length ?? 0} PDVs a otro trade`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={confirm} disabled={!summary || loading || saving || toMove === 0}>
            {saving ? "Pasando..." : "Confirmar traspaso"}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex items-end gap-3">
          {whole && (
            <>
              <div className="flex-1">
                <label className="block text-xs font-medium text-muted-foreground mb-1.5">Origen</label>
                <select value={fromId} onChange={(e) => setFromId(e.target.value)} className={selectClass}>
                  <option value="">Elegir trade...</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </div>
              <ArrowRight size={18} className="mb-2.5 text-muted-foreground shrink-0" />
            </>
          )}
          <div className="flex-1">
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Destino</label>
            <select value={toId} onChange={(e) => setToId(e.target.value)} className={selectClass}>
              <option value="">Elegir trade...</option>
              {users
                .filter((u) => String(u.id) !== fromId)
                .map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
            </select>
          </div>
        </div>

        {loading && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 size={14} className="animate-spin" /> Calculando...
          </p>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}

        {summary && !loading && (
          <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm space-y-2">
            <p>
              <span className="font-semibold">{toMove} PDVs</span> pasan a{" "}
              <span className="font-semibold">{summary.to_user_name}</span>.
              {summary.already_owned > 0 && ` ${summary.already_owned} ya eran suyos.`}
            </p>
            {whole ? (
              <p>
                {summary.routes.length === 0
                  ? "No tiene rutas regulares para pasar."
                  : (summary.routes.length === 1 ? "Su ruta pasa armada" : `Sus ${summary.routes.length} rutas pasan armadas`) +
                    (summary.future_days > 0 ? `, con ${summary.future_days} días ya planificados.` : ".")}{" "}
                Las rutas de campaña no cambian.
              </p>
            ) : summary.routes.length > 0 ? (
              <>
                <p>Salen de estas rutas y quedan en la cartera del destino, sin ruta:</p>
                <ul className="max-h-40 overflow-y-auto space-y-0.5 text-muted-foreground">
                  {summary.routes.map((r) => (
                    <li key={r.RouteId} className="flex justify-between gap-3">
                      <span className="truncate">{r.Name}</span>
                      <span className="shrink-0">{r.pdvs} PDVs</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p>Ninguno está en rutas de otro trade; solo cambia el dueño.</p>
            )}
            {whole && summary.routes.length > 0 && (
              <ul className="max-h-40 overflow-y-auto space-y-0.5 text-muted-foreground">
                {summary.routes.map((r) => (
                  <li key={r.RouteId} className="truncate">{r.Name}</li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">El historial de visitas queda a nombre de quien las hizo.</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
