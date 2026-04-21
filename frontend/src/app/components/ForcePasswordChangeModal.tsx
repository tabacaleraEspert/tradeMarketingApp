import { useState, useEffect } from "react";
import { Modal } from "./ui/modal";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Lock, ShieldAlert, Eye, EyeOff } from "lucide-react";
import { authApi, ApiError } from "@/lib/api";
import { toast } from "sonner";

interface Props {
  isOpen: boolean;
  onSuccess: () => void;
}

export function ForcePasswordChangeModal({ isOpen, onSuccess }: Props) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setCurrent("");
      setNext("");
      setConfirm("");
    }
  }, [isOpen]);

  const handleSubmit = async () => {
    if (next.length < 8) {
      toast.error("La nueva contraseña debe tener al menos 8 caracteres");
      return;
    }
    if (next !== confirm) {
      toast.error("Las contraseñas no coinciden");
      return;
    }
    setSaving(true);
    try {
      await authApi.changePassword(current, next);
      toast.success("Contraseña actualizada");
      onSuccess();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Error al cambiar la contraseña");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => { /* no-op: es obligatorio */ }}
      title="Cambiá tu contraseña"
      size="md"
      footer={
        <Button
          onClick={handleSubmit}
          disabled={saving || !current || !next || !confirm}
          className="w-full"
        >
          {saving ? "Guardando..." : "Actualizar contraseña"}
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-50/70 border border-amber-200">
          <ShieldAlert size={20} className="text-amber-600/80 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-900">
              Tenés que cambiar tu contraseña antes de continuar
            </p>
            <p className="text-xs text-amber-800 mt-0.5">
              Esta es la primera vez que ingresás o el administrador requiere que la renueves.
            </p>
          </div>
        </div>

        <div>
          <Label htmlFor="pwd-current" className="text-sm font-medium">Contraseña actual</Label>
          <div className="relative mt-1">
            <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="pwd-current"
              type={showPassword ? "text" : "password"}
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              placeholder="La que usaste para entrar"
              className="pl-9 pr-9"
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
            >
              {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>

        <div>
          <Label htmlFor="pwd-next" className="text-sm font-medium">Nueva contraseña</Label>
          <div className="relative mt-1">
            <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="pwd-next"
              type={showPassword ? "text" : "password"}
              value={next}
              onChange={(e) => setNext(e.target.value)}
              placeholder="Mínimo 8 caracteres"
              className="pl-9 pr-9"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
            >
              {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>

        <div>
          <Label htmlFor="pwd-confirm" className="text-sm font-medium">Confirmar nueva contraseña</Label>
          <div className="relative mt-1">
            <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="pwd-confirm"
              type={showPassword ? "text" : "password"}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Repetí la nueva contraseña"
              className="pl-9 pr-9"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
            >
              {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
