import { useMemo, useState } from "react";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Badge } from "../../components/ui/badge";
import { Switch } from "../../components/ui/switch";
import { Modal, ConfirmModal } from "../../components/ui/modal";
import { Plus, Edit, Trash2, GitMerge, RotateCcw, Search } from "lucide-react";
import { useApiList, chainsApi, useUsers, type Channel, type ChainAdmin, type ChainKind } from "@/lib/api";
import { filterChains } from "@/lib/chains";
import { toast } from "sonner";
import { getCurrentUser } from "../../lib/auth";

const selectCls =
  "w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-espert-gold";

interface FormState {
  name: string;
  channelId: number | "";
  kind: ChainKind;
  isKeyAccount: boolean;
  accountManagerUserId: number | "";
  storeCount: string;
  aliases: string;
}

const emptyForm = (channelId: number | "" = ""): FormState => ({
  name: "", channelId, kind: "cadena", isKeyAccount: false, accountManagerUserId: "", storeCount: "", aliases: "",
});

/**
 * Gestión de cadenas y banderas (pestaña de Canales): a qué cadena pertenece un PDV es
 * un dato aparte del canal. Key account = atributo de la cadena. Alta/edición/baja:
 * territory manager o superior. Fusión: solo admin.
 */
export function ChainsSection({ channels }: { channels: Channel[] }) {
  const currentUser = getCurrentUser();
  const isAdmin = (currentUser.role || "").toLowerCase() === "admin";
  const { data: chains, refetch, loading } = useApiList<ChainAdmin>(() => chainsApi.listAll());
  const { data: users } = useUsers();

  const [channelFilter, setChannelFilter] = useState<string>("all");
  const [kindFilter, setKindFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [onlyKeyAccounts, setOnlyKeyAccounts] = useState(false);

  const [editing, setEditing] = useState<ChainAdmin | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [confirmOff, setConfirmOff] = useState<ChainAdmin | null>(null);
  const [mergeSrc, setMergeSrc] = useState<ChainAdmin | null>(null);
  const [mergeTarget, setMergeTarget] = useState<number | "">("");

  const activeUsers = useMemo(
    () => [...users].filter((u) => u.IsActive).sort((a, b) => a.DisplayName.localeCompare(b.DisplayName, "es")),
    [users]
  );

  const rows = useMemo(() => {
    let list = chains.filter((c) => showInactive || c.IsActive);
    if (channelFilter !== "all") list = list.filter((c) => c.ChannelId === Number(channelFilter));
    if (kindFilter !== "all") list = list.filter((c) => c.Kind === kindFilter);
    if (onlyKeyAccounts) list = list.filter((c) => c.IsKeyAccount);
    return filterChains(list, query) as ChainAdmin[];
  }, [chains, showInactive, channelFilter, kindFilter, onlyKeyAccounts, query]);

  const totals = useMemo(() => {
    const active = chains.filter((c) => c.IsActive);
    return {
      cadenas: active.filter((c) => c.Kind === "cadena").length,
      banderas: active.filter((c) => c.Kind === "bandera").length,
      keyAccounts: active.filter((c) => c.IsKeyAccount).length,
      pdvs: active.reduce((n, c) => n + c.PdvCount, 0),
    };
  }, [chains]);

  const mergeCandidates = useMemo(
    () =>
      mergeSrc
        ? chains
            .filter((c) => c.IsActive && c.ChainId !== mergeSrc.ChainId && c.ChannelId === mergeSrc.ChannelId && c.Kind === mergeSrc.Kind)
            .sort((a, b) => a.Name.localeCompare(b.Name, "es", { numeric: true }))
        : [],
    [chains, mergeSrc]
  );

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm(channelFilter !== "all" ? Number(channelFilter) : ""));
    setFormOpen(true);
  };

  const openEdit = (c: ChainAdmin) => {
    setEditing(c);
    setForm({
      name: c.Name, channelId: c.ChannelId, kind: c.Kind, isKeyAccount: c.IsKeyAccount,
      accountManagerUserId: c.AccountManagerUserId ?? "",
      storeCount: c.StoreCount != null ? String(c.StoreCount) : "",
      aliases: c.Aliases ?? "",
    });
    setFormOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.channelId) {
      toast.error("Nombre y canal son obligatorios");
      return;
    }
    const storeCount = form.storeCount.trim() === "" ? null : Number(form.storeCount);
    if (storeCount != null && (!Number.isInteger(storeCount) || storeCount < 0)) {
      toast.error("La cantidad de locales tiene que ser un número entero");
      return;
    }
    const data = {
      Name: form.name.trim(),
      Kind: form.kind,
      IsKeyAccount: form.isKeyAccount,
      AccountManagerUserId: form.accountManagerUserId ? Number(form.accountManagerUserId) : null,
      StoreCount: storeCount,
      Aliases: form.aliases.trim() || null,
    };
    setSaving(true);
    try {
      if (editing) {
        await chainsApi.update(editing.ChainId, data);
        toast.success("Cadena actualizada");
      } else {
        await chainsApi.create({ ...data, ChannelId: Number(form.channelId) });
        toast.success("Cadena creada");
      }
      setFormOpen(false);
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  const patch = async (c: ChainAdmin, data: Parameters<typeof chainsApi.update>[1], okMsg: string) => {
    setBusyId(c.ChainId);
    try {
      await chainsApi.update(c.ChainId, data);
      toast.success(okMsg);
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setBusyId(null);
    }
  };

  const handleDeactivate = async () => {
    if (!confirmOff) return;
    const c = confirmOff;
    setConfirmOff(null);
    try {
      await chainsApi.delete(c.ChainId);
      toast.success("Cadena desactivada");
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al desactivar");
    }
  };

  const handleMerge = async () => {
    if (!mergeSrc || !mergeTarget) return;
    setSaving(true);
    try {
      const res = await chainsApi.merge(mergeSrc.ChainId, Number(mergeTarget));
      toast.success(`Fusionada en ${res.Name} (${res.PdvCount} PDVs)`);
      setMergeSrc(null);
      setMergeTarget("");
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al fusionar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4" data-testid="chains-section">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground max-w-2xl">
          La cadena dice <strong>de quién es</strong> el PDV; el canal dice qué formato tiene. En los canales con
          cadenas el vendedor la elige de esta lista al dar de alta el PDV, y el subcanal (Chica / Mediana / Grande)
          sale solo de la cantidad de locales.
        </p>
        <Button onClick={openCreate} className="gap-2" data-testid="chain-new">
          <Plus size={18} />
          Nueva cadena
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          ["Cadenas", totals.cadenas],
          ["Banderas", totals.banderas],
          ["Key accounts", totals.keyAccounts],
          ["PDVs vinculados", totals.pdvs],
        ].map(([label, n]) => (
          <Card key={label as string}>
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-2xl font-bold text-foreground tabular-nums">{n}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar por nombre o alias…"
                className="pl-9"
                data-testid="chains-search"
              />
            </div>
            <select className={selectCls} value={channelFilter} onChange={(e) => setChannelFilter(e.target.value)} aria-label="Canal">
              <option value="all">Todos los canales</option>
              {channels.filter((ch) => chains.some((c) => c.ChannelId === ch.ChannelId)).map((ch) => (
                <option key={ch.ChannelId} value={String(ch.ChannelId)}>{ch.Name}</option>
              ))}
            </select>
            <select className={selectCls} value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} aria-label="Tipo">
              <option value="all">Cadenas y banderas</option>
              <option value="cadena">Solo cadenas</option>
              <option value="bandera">Solo banderas</option>
            </select>
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={onlyKeyAccounts} onChange={(e) => setOnlyKeyAccounts(e.target.checked)} />
                Key accounts
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} data-testid="chains-show-inactive" />
                Ver inactivas
              </label>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-border">
                  <th className="py-2 pr-3 font-medium">Cadena</th>
                  <th className="py-2 pr-3 font-medium">Canal</th>
                  <th className="py-2 pr-3 font-medium text-right">PDVs en la app</th>
                  <th className="py-2 pr-3 font-medium text-right">Locales reales</th>
                  <th className="py-2 pr-3 font-medium">Tamaño</th>
                  <th className="py-2 pr-3 font-medium">Key account</th>
                  <th className="py-2 pr-3 font-medium">Responsable</th>
                  <th className="py-2 font-medium text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr
                    key={c.ChainId}
                    className={`border-b border-border last:border-0 ${c.IsActive ? "" : "opacity-60"}`}
                    data-testid={`chain-row-${c.ChainId}`}
                  >
                    <td className="py-2.5 pr-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium text-foreground">{c.Name}</span>
                        {c.Kind === "bandera" && <Badge variant="outline" className="text-[10px]">Bandera</Badge>}
                        {!c.IsActive && <Badge variant="secondary" className="text-[10px]">Inactiva</Badge>}
                      </div>
                      {c.Aliases && <p className="text-xs text-muted-foreground mt-0.5">Alias: {c.Aliases}</p>}
                    </td>
                    <td className="py-2.5 pr-3 text-muted-foreground">{c.ChannelName ?? `#${c.ChannelId}`}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">{c.PdvCount}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">
                      {c.StoreCount != null ? c.StoreCount : <span className="text-muted-foreground" title="Sin cargar: se usa la cantidad de PDVs de la app">—</span>}
                    </td>
                    <td className="py-2.5 pr-3">{c.SizeBucket ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className="py-2.5 pr-3">
                      <Switch
                        checked={c.IsKeyAccount}
                        disabled={busyId === c.ChainId || !c.IsActive}
                        onCheckedChange={(v) => patch(c, { IsKeyAccount: v }, v ? "Marcada como key account" : "Ya no es key account")}
                        aria-label={`Key account ${c.Name}`}
                        data-testid={`chain-ka-${c.ChainId}`}
                      />
                    </td>
                    <td className="py-2.5 pr-3 text-muted-foreground">{c.AccountManagerName ?? "—"}</td>
                    <td className="py-2.5">
                      <div className="flex justify-end gap-1.5">
                        <Button variant="outline" size="sm" onClick={() => openEdit(c)} title="Editar" data-testid={`chain-edit-${c.ChainId}`}>
                          <Edit size={14} />
                        </Button>
                        {isAdmin && c.IsActive && (
                          <Button
                            variant="outline" size="sm" title="Fusionar dentro de otra cadena"
                            onClick={() => { setMergeSrc(c); setMergeTarget(""); }}
                            data-testid={`chain-merge-${c.ChainId}`}
                          >
                            <GitMerge size={14} />
                          </Button>
                        )}
                        {c.IsActive ? (
                          <Button
                            variant="outline" size="sm" className="text-red-600" title="Desactivar"
                            onClick={() => setConfirmOff(c)} data-testid={`chain-off-${c.ChainId}`}
                          >
                            <Trash2 size={14} />
                          </Button>
                        ) : (
                          <Button
                            variant="outline" size="sm" title="Reactivar" disabled={busyId === c.ChainId}
                            onClick={() => patch(c, { IsActive: true }, "Cadena reactivada")}
                          >
                            <RotateCcw size={14} />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && (
              <p className="text-sm text-muted-foreground py-6 text-center">
                {loading ? "Cargando…" : chains.length === 0
                  ? "Todavía no hay cadenas. Creá la primera con “Nueva cadena”."
                  : "Ninguna cadena coincide con los filtros."}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Alta / edición */}
      <Modal
        isOpen={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? "Editar cadena" : "Nueva cadena"}
        footer={
          <>
            <Button variant="outline" onClick={() => setFormOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving} data-testid="chain-save">
              {saving ? "Guardando..." : "Guardar"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">Nombre</label>
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Ej: Tommy Shop, YPF"
              maxLength={80}
              data-testid="chain-name"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">Canal</label>
              <select
                className={selectCls}
                value={form.channelId}
                onChange={(e) => setForm((f) => ({ ...f, channelId: e.target.value ? Number(e.target.value) : "" }))}
                disabled={!!editing}
                data-testid="chain-channel"
              >
                <option value="">Seleccionar canal</option>
                {channels.filter((ch) => ch.IsActive || ch.ChannelId === form.channelId).map((ch) => (
                  <option key={ch.ChannelId} value={ch.ChannelId}>{ch.Name}</option>
                ))}
              </select>
              {editing && <p className="text-xs text-muted-foreground mt-1">El canal de una cadena no se cambia.</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">Tipo</label>
              <select
                className={selectCls}
                value={form.kind}
                onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as ChainKind }))}
                data-testid="chain-kind"
              >
                <option value="cadena">Cadena (obligatoria en su canal)</option>
                <option value="bandera">Bandera (opcional)</option>
              </select>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium text-foreground">Key account</p>
              <p className="text-xs text-muted-foreground">Cuenta clave con gestión centralizada.</p>
            </div>
            <Switch
              checked={form.isKeyAccount}
              onCheckedChange={(v) => setForm((f) => ({ ...f, isKeyAccount: v }))}
              data-testid="chain-form-ka"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">Responsable de la cuenta</label>
              <select
                className={selectCls}
                value={form.accountManagerUserId}
                onChange={(e) => setForm((f) => ({ ...f, accountManagerUserId: e.target.value ? Number(e.target.value) : "" }))}
                data-testid="chain-manager"
              >
                <option value="">Sin responsable</option>
                {activeUsers.map((u) => (
                  <option key={u.UserId} value={u.UserId}>{u.DisplayName}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">Locales reales de la cadena</label>
              <Input
                type="number" min={0} inputMode="numeric"
                value={form.storeCount}
                onChange={(e) => setForm((f) => ({ ...f, storeCount: e.target.value }))}
                placeholder="Vacío = PDVs de la app"
                data-testid="chain-storecount"
              />
              <p className="text-xs text-muted-foreground mt-1">Define el tamaño: hasta 10 Chica · 11 a 30 Mediana · más de 30 Grande.</p>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">Alias (separados por coma)</label>
            <Input
              value={form.aliases}
              onChange={(e) => setForm((f) => ({ ...f, aliases: e.target.value }))}
              placeholder="Otras formas de escribirla: Tomyshop, Tommy's shop"
              maxLength={500}
              data-testid="chain-aliases"
            />
          </div>
        </div>
      </Modal>

      {/* Fusión */}
      <Modal
        isOpen={mergeSrc !== null}
        onClose={() => setMergeSrc(null)}
        title="Fusionar cadena"
        footer={
          <>
            <Button variant="outline" onClick={() => setMergeSrc(null)}>Cancelar</Button>
            <Button onClick={handleMerge} disabled={saving || !mergeTarget} data-testid="chain-merge-confirm">
              {saving ? "Fusionando..." : "Fusionar"}
            </Button>
          </>
        }
      >
        {mergeSrc && (
          <div className="space-y-4">
            <p className="text-sm text-foreground">
              Los <strong>{mergeSrc.PdvCount} PDVs</strong> de <strong>{mergeSrc.Name}</strong> pasan a la cadena que
              elijas. <strong>{mergeSrc.Name}</strong> queda inactiva y su nombre se guarda como alias de la otra.
            </p>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">Fusionar dentro de</label>
              <select
                className={selectCls}
                value={mergeTarget}
                onChange={(e) => setMergeTarget(e.target.value ? Number(e.target.value) : "")}
                data-testid="chain-merge-target"
              >
                <option value="">Seleccionar cadena destino</option>
                {mergeCandidates.map((c) => (
                  <option key={c.ChainId} value={c.ChainId}>{c.Name} ({c.PdvCount} PDVs)</option>
                ))}
              </select>
              {mergeCandidates.length === 0 && (
                <p className="text-xs text-muted-foreground mt-1">No hay otra cadena activa del mismo canal y tipo.</p>
              )}
            </div>
            <p className="text-xs text-muted-foreground">La fusión no se deshace desde acá. Queda registrada en la auditoría.</p>
          </div>
        )}
      </Modal>

      <ConfirmModal
        isOpen={confirmOff !== null}
        onClose={() => setConfirmOff(null)}
        onConfirm={handleDeactivate}
        title="Desactivar cadena"
        message={
          confirmOff
            ? `${confirmOff.Name} deja de ofrecerse en el alta de PDV. Sus ${confirmOff.PdvCount} PDVs conservan la cadena. Se puede reactivar.`
            : ""
        }
        confirmText="Desactivar"
        type="danger"
      />
    </div>
  );
}
