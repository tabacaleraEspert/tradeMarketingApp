import { useEffect, useState } from "react";
import { Modal } from "./ui/modal";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Plus, Trash2, User as UserIcon } from "lucide-react";
import { pdvsApi, ApiError } from "@/lib/api";
import type { Pdv } from "@/lib/api";
import { toast } from "sonner";

interface ContactDraft {
  ContactName: string;
  ContactPhone?: string;
  ContactRole?: string;
  DecisionPower?: string;
  Birthday?: string;
  Notes?: string;
  ProfileNotes?: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  pdv: Pdv | null;
  onSaved: (updated: Pdv) => void;
}

/**
 * Modal compacto para editar los contactos del PDV durante una visita.
 * Pensado para ser invocado desde CheckIn / VisitSummaryPage / PDV detail
 * sin perder el contexto de la pantalla actual.
 */
export function QuickContactsModal({ isOpen, onClose, pdv, onSaved }: Props) {
  const [contacts, setContacts] = useState<ContactDraft[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen || !pdv) return;
    if (pdv.Contacts && pdv.Contacts.length > 0) {
      setContacts(
        pdv.Contacts.map((c) => ({
          ContactName: c.ContactName,
          ContactPhone: c.ContactPhone || "",
          ContactRole: c.ContactRole || "",
          DecisionPower: c.DecisionPower || "",
          Birthday: c.Birthday || "",
          Notes: c.Notes || "",
          ProfileNotes: c.ProfileNotes || "",
        }))
      );
    } else {
      setContacts([{ ContactName: pdv.ContactName || "", ContactPhone: pdv.ContactPhone || "" }]);
    }
  }, [isOpen, pdv]);

  if (!pdv) return null;

  const updateContact = (i: number, patch: Partial<ContactDraft>) => {
    setContacts((prev) => prev.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  };

  const addContact = () => {
    setContacts((prev) => [...prev, { ContactName: "" }]);
  };

  const removeContact = (i: number) => {
    setContacts((prev) => prev.filter((_, j) => j !== i));
  };

  const handleSave = async () => {
    const valid = contacts.filter((c) => c.ContactName.trim());
    setSaving(true);
    try {
      const updated = await pdvsApi.update(pdv.PdvId, {
        Contacts: valid.map((c) => ({
          ContactName: c.ContactName.trim(),
          ContactPhone: c.ContactPhone?.trim() || undefined,
          ContactRole: c.ContactRole?.trim() || undefined,
          DecisionPower: c.DecisionPower?.trim() || undefined,
          Birthday: c.Birthday || undefined,
          Notes: c.Notes?.trim() || undefined,
          ProfileNotes: c.ProfileNotes?.trim() || undefined,
        })),
      });
      onSaved(updated);
      toast.success("Contactos actualizados");
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Editar contactos del PDV"
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Guardando..." : "Guardar"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {contacts.map((c, i) => (
          <div key={i} className="p-3 border border-border rounded-lg space-y-2 bg-muted/30">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <UserIcon size={14} className="text-[#A48242]" />
                Contacto {i + 1}
              </div>
              {contacts.length > 1 && (
                <button
                  onClick={() => removeContact(i)}
                  className="p-1.5 rounded hover:bg-red-50 text-red-600"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input
                placeholder="Nombre"
                value={c.ContactName}
                onChange={(e) => updateContact(i, { ContactName: e.target.value })}
              />
              <Input
                placeholder="Teléfono"
                value={c.ContactPhone || ""}
                onChange={(e) => updateContact(i, { ContactPhone: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <select
                value={c.ContactRole || ""}
                onChange={(e) => updateContact(i, { ContactRole: e.target.value })}
                className="h-9 px-2 text-xs border border-input bg-background rounded-md"
              >
                <option value="">Rol...</option>
                <option value="dueño">Dueño</option>
                <option value="empleado">Empleado</option>
                <option value="encargado">Encargado</option>
              </select>
              <select
                value={c.DecisionPower || ""}
                onChange={(e) => updateContact(i, { DecisionPower: e.target.value })}
                className="h-9 px-2 text-xs border border-input bg-background rounded-md"
              >
                <option value="">Decisión...</option>
                <option value="alto">Alto</option>
                <option value="medio">Medio</option>
                <option value="bajo">Bajo</option>
              </select>
              <Input
                type="date"
                value={c.Birthday || ""}
                onChange={(e) => updateContact(i, { Birthday: e.target.value })}
                className="text-xs"
              />
            </div>
            <div>
              <label className="block text-[10px] font-medium text-muted-foreground mb-1 uppercase tracking-wide">
                Observaciones
              </label>
              <textarea
                placeholder="Notas operativas"
                value={c.Notes || ""}
                onChange={(e) => updateContact(i, { Notes: e.target.value })}
                rows={2}
                className="w-full text-xs px-3 py-2 border border-border rounded-md resize-none"
              />
            </div>
            <div>
              <label className="block text-[10px] font-medium text-muted-foreground mb-1 uppercase tracking-wide">
                Perfil del contacto
              </label>
              <textarea
                placeholder="Preferencias / qué evitar (no hablar de política, hincha de…)"
                value={c.ProfileNotes || ""}
                onChange={(e) => updateContact(i, { ProfileNotes: e.target.value })}
                rows={2}
                className="w-full text-xs px-3 py-2 border border-border rounded-md resize-none"
              />
            </div>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={addContact} className="w-full gap-1">
          <Plus size={14} />
          Agregar otro contacto
        </Button>
      </div>
    </Modal>
  );
}
