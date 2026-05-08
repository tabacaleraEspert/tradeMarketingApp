import { useState } from "react";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Badge } from "../../components/ui/badge";
import { Modal, ConfirmModal } from "../../components/ui/modal";
import { Plus, Edit, Trash2, ChevronDown, ChevronRight, Info } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "../../components/ui/tooltip";
import { Textarea } from "../../components/ui/textarea";
import {
  useApiList,
  channelsApi,
  subchannelsApi,
} from "@/lib/api";
import { toast } from "sonner";
import { getCurrentUser } from "../../lib/auth";

export function ChannelManagement() {
  const currentUser = getCurrentUser();
  const canDelete = ["admin", "regional_manager", "territory_manager"].includes(currentUser.role);
  const { data: channels, refetch: refetchChannels } = useApiList(() =>
    channelsApi.listAll()
  );
  const [expandedChannelId, setExpandedChannelId] = useState<number | null>(null);
  const [channelModal, setChannelModal] = useState<"create" | "edit" | null>(null);
  const [subchannelModal, setSubchannelModal] = useState<"create" | "edit" | null>(null);
  const [selectedChannelId, setSelectedChannelId] = useState<number | null>(null);
  const [selectedSubchannel, setSelectedSubchannel] = useState<{
    SubChannelId: number;
    ChannelId: number;
    Name: string;
  } | null>(null);
  const [channelName, setChannelName] = useState("");
  const [channelDescription, setChannelDescription] = useState("");
  const [subchannelName, setSubchannelName] = useState("");
  const [subchannelDescription, setSubchannelDescription] = useState("");
  const [subchannelSubCategory2, setSubchannelSubCategory2] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ type: "channel" | "subchannel"; id: number } | null>(null);

  const { data: subchannels, refetch: refetchSubchannels } = useApiList(
    () =>
      expandedChannelId
        ? subchannelsApi.listAll(expandedChannelId)
        : Promise.resolve([]),
    [expandedChannelId]
  );

  const openCreateChannel = () => {
    setChannelName("");
    setChannelDescription("");
    setChannelModal("create");
  };

  const openEditChannel = (ch: { ChannelId: number; Name: string; Description: string | null }) => {
    setSelectedChannelId(ch.ChannelId);
    setChannelName(ch.Name);
    setChannelDescription(ch.Description || "");
    setChannelModal("edit");
  };

  const handleSaveChannel = async () => {
    if (!channelName.trim()) {
      toast.error("El nombre es obligatorio");
      return;
    }
    setSaving(true);
    try {
      if (channelModal === "create") {
        await channelsApi.create({ Name: channelName.trim(), Description: channelDescription.trim() || undefined });
        toast.success("Canal creado");
      } else if (selectedChannelId) {
        await channelsApi.update(selectedChannelId, { Name: channelName.trim(), Description: channelDescription.trim() || undefined });
        toast.success("Canal actualizado");
      }
      setChannelModal(null);
      refetchChannels();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteChannel = async (channelId: number) => {
    try {
      await channelsApi.delete(channelId);
      toast.success("Canal desactivado");
      refetchChannels();
      setExpandedChannelId(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al eliminar");
    }
  };

  const openCreateSubchannel = (channelId: number) => {
    setSelectedChannelId(channelId);
    setSelectedSubchannel(null);
    setSubchannelName("");
    setSubchannelDescription("");
    setSubchannelSubCategory2("");
    setSubchannelModal("create");
  };

  const openEditSubchannel = (sc: { SubChannelId: number; ChannelId: number; Name: string; Description?: string | null; SubCategory2?: string | null }) => {
    setSelectedSubchannel(sc);
    setSelectedChannelId(sc.ChannelId);
    setSubchannelName(sc.Name);
    setSubchannelDescription(sc.Description || "");
    setSubchannelSubCategory2(sc.SubCategory2 || "");
    setSubchannelModal("edit");
  };

  const handleSaveSubchannel = async () => {
    if (!subchannelName.trim() || selectedChannelId == null) {
      toast.error("El nombre y canal son obligatorios");
      return;
    }
    setSaving(true);
    try {
      if (subchannelModal === "create") {
        await subchannelsApi.create({
          ChannelId: selectedChannelId,
          Name: subchannelName.trim(),
          Description: subchannelDescription.trim() || undefined,
          SubCategory2: subchannelSubCategory2.trim() || undefined,
        });
        toast.success("Subcanal creado");
      } else if (selectedSubchannel) {
        await subchannelsApi.update(selectedSubchannel.SubChannelId, {
          Name: subchannelName.trim(),
          Description: subchannelDescription.trim() || undefined,
          SubCategory2: subchannelSubCategory2.trim() || undefined,
        });
        toast.success("Subcanal actualizado");
      }
      setSubchannelModal(null);
      refetchSubchannels();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSubchannel = async (subchannelId: number) => {
    try {
      await subchannelsApi.delete(subchannelId);
      toast.success("Subcanal desactivado");
      refetchSubchannels();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al eliminar");
    }
  };

  const handleConfirmDelete = () => {
    if (!confirmDelete) return;
    if (confirmDelete.type === "channel") {
      handleDeleteChannel(confirmDelete.id);
    } else {
      handleDeleteSubchannel(confirmDelete.id);
    }
    setConfirmDelete(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2">Canales y Subcanales</h1>
          <p className="text-muted-foreground">
            Gestiona los canales y subcanales disponibles para el alta de PDVs
          </p>
        </div>
        <Button onClick={openCreateChannel} className="gap-2">
          <Plus size={20} />
          Nuevo Canal
        </Button>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="space-y-2">
            {channels.map((ch) => (
              <div key={ch.ChannelId} className="border border-border rounded-lg overflow-hidden">
                <div
                  className="flex items-center justify-between p-4 bg-card hover:bg-muted cursor-pointer"
                  onClick={() =>
                    setExpandedChannelId(expandedChannelId === ch.ChannelId ? null : ch.ChannelId)
                  }
                >
                  <div className="flex items-center gap-3">
                    {expandedChannelId === ch.ChannelId ? (
                      <ChevronDown size={20} className="text-muted-foreground" />
                    ) : (
                      <ChevronRight size={20} className="text-muted-foreground" />
                    )}
                    <div>
                      <span className="font-semibold text-foreground">{ch.Name}</span>
                      {ch.Description && (
                        <p className="text-xs text-muted-foreground mt-0.5">{ch.Description}</p>
                      )}
                    </div>
                    {!ch.IsActive && (
                      <Badge variant="secondary">Inactivo</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openEditChannel(ch)}
                    >
                      <Edit size={16} />
                    </Button>
                    {canDelete && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-red-600"
                      onClick={() => setConfirmDelete({ type: "channel", id: ch.ChannelId })}
                    >
                      <Trash2 size={16} />
                    </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openCreateSubchannel(ch.ChannelId)}
                    >
                      <Plus size={16} className="mr-1" />
                      Subcanal
                    </Button>
                  </div>
                </div>

                {expandedChannelId === ch.ChannelId && (
                  <div className="border-t border-border bg-muted p-4 space-y-2">
                    {ch.ChannelId === expandedChannelId && subchannels.length === 0 && (
                      <p className="text-sm text-muted-foreground py-2">
                        No hay subcanales. Agrega uno con el botón "Subcanal".
                      </p>
                    )}
                    {ch.ChannelId === expandedChannelId &&
                      subchannels.map((sc) => (
                        <div
                          key={sc.SubChannelId}
                          className="flex items-center justify-between py-2 px-3 bg-card rounded border border-border"
                        >
                          <div>
                            <span className="text-sm font-medium text-foreground">{sc.Name}</span>
                            {sc.Description && (
                              <p className="text-xs text-muted-foreground mt-0.5">{sc.Description}</p>
                            )}
                          </div>
                          <div className="flex gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openEditSubchannel(sc)}
                            >
                              <Edit size={14} />
                            </Button>
                            {canDelete && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-red-600"
                              onClick={() => setConfirmDelete({ type: "subchannel", id: sc.SubChannelId })}
                            >
                              <Trash2 size={14} />
                            </Button>
                            )}
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Modal Canal */}
      <Modal
        isOpen={channelModal !== null}
        onClose={() => { setChannelModal(null); setChannelName(""); setChannelDescription(""); }}
        title={channelModal === "create" ? "Nuevo Canal" : "Editar Canal"}
        footer={
          <>
            <Button variant="outline" onClick={() => { setChannelModal(null); setChannelName(""); setChannelDescription(""); }}>
              Cancelar
            </Button>
            <Button onClick={handleSaveChannel} disabled={saving}>
              {saving ? "Guardando..." : "Guardar"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">Nombre</label>
            <Input
              value={channelName}
              onChange={(e) => setChannelName(e.target.value)}
              placeholder="Ej: Convenience, Grocery"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">Descripción</label>
            <Textarea
              value={channelDescription}
              onChange={(e) => setChannelDescription(e.target.value)}
              placeholder="Descripción visible como ayuda al dar de alta un PDV"
              rows={3}
            />
          </div>
        </div>
      </Modal>

      {/* Confirm Delete Modal */}
      <ConfirmModal
        isOpen={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        onConfirm={handleConfirmDelete}
        title={confirmDelete?.type === "channel" ? "Desactivar Canal" : "Desactivar Subcanal"}
        message={
          confirmDelete?.type === "channel"
            ? "¿Desactivar este canal? Los PDVs que lo usen seguirán mostrándolo."
            : "¿Desactivar este subcanal?"
        }
        confirmText="Desactivar"
        type="danger"
      />

      {/* Modal Subcanal */}
      <Modal
        isOpen={subchannelModal !== null}
        onClose={() => { setSubchannelModal(null); setSubchannelDescription(""); }}
        title={subchannelModal === "create" ? "Nuevo Subcanal" : "Editar Subcanal"}
        footer={
          <>
            <Button variant="outline" onClick={() => { setSubchannelModal(null); setSubchannelDescription(""); }}>
              Cancelar
            </Button>
            <Button onClick={handleSaveSubchannel} disabled={saving}>
              {saving ? "Guardando..." : "Guardar"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">Nombre</label>
            <Input
              value={subchannelName}
              onChange={(e) => setSubchannelName(e.target.value)}
              placeholder="Ej: Quiosco, Tabaquería"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">Descripción</label>
            <Textarea
              value={subchannelDescription}
              onChange={(e) => setSubchannelDescription(e.target.value)}
              placeholder="Descripción visible como ayuda al dar de alta un PDV"
              rows={3}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">Subcategoría 2 (opcional)</label>
            <Input
              value={subchannelSubCategory2}
              onChange={(e) => setSubchannelSubCategory2(e.target.value)}
              placeholder="Ej: Maxiquiosco, Autoservicio"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
