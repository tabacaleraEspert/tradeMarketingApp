import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Modal } from "../../components/ui/modal";
import { Button } from "../../components/ui/button";

interface Props {
  isOpen: boolean;
  title: string;
  confirmText?: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  children: React.ReactNode;
  errorFormatter?: (err: unknown) => string;
}

// Diálogo de confirmación genérico para las escrituras de la pestaña Objetivos
// (config de KPIs paga compensación, por eso siempre se confirma antes de postear).
// A diferencia de ConfirmModal (ui/modal.tsx), este maneja el submit async: si
// `onConfirm` rechaza (ej. 422 por suma != 100), muestra el error y NO cierra.
export function ObjetivosConfirmDialog({
  isOpen,
  title,
  confirmText = "Confirmar",
  onClose,
  onConfirm,
  children,
  errorFormatter,
}: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleClose = () => {
    if (submitting) return;
    setError(null);
    onClose();
  };

  const handleConfirm = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm();
      setSubmitting(false);
      onClose();
    } catch (err) {
      setSubmitting(false);
      setError(
        errorFormatter
          ? errorFormatter(err)
          : err instanceof Error
            ? err.message
            : "No se pudo guardar el cambio."
      );
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={handleClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={submitting}>
            {submitting ? "Guardando..." : confirmText}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        {children}
        {error && (
          <div className="flex items-start gap-2 rounded-md bg-red-50 border border-red-200 p-3 text-red-700 text-xs">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </Modal>
  );
}
