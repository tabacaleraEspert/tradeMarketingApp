/**
 * Reportes por mail — ABM de destinatarios del resumen de comportamiento de
 * los trades (semanal los lunes, mensual el día 1; 07:00).
 *
 * Cada destinatario elige qué trades recibe: todos, el equipo de un jefe (se
 * actualiza solo) o una lista. Los jefes con vendedores a cargo aparecen solos
 * ("Automático"), desactivados hasta que se los active acá.
 */
import { useMemo, useState } from "react";
import { CheckCircle2, Eye, History, Mail, Pencil, Plus, Send, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";
import {
  behaviorReportsApi,
  useApiList,
  type BehaviorReportKind,
  type BehaviorReportOptions,
  type BehaviorReportRow,
  type BehaviorReportScope,
  type BehaviorReportSubscription,
  type BehaviorReportSubscriptionInput,
} from "@/lib/api";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { ConfirmModal, Modal } from "../../components/ui/modal";
import { Switch } from "../../components/ui/switch";

const EMPTY: BehaviorReportSubscriptionInput = {
  Email: "",
  Name: "",
  Scope: "custom",
  ScopeUserId: null,
  TradeIds: [],
  WeeklyEnabled: true,
  MonthlyEnabled: true,
  IsActive: true,
};

const KIND_LABEL: Record<string, string> = { weekly: "Semanal", monthly: "Mensual", test: "Prueba" };

const fmtDateTime = (iso: string) =>
  new Date(iso.endsWith("Z") ? iso : iso + "Z").toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
const fmtDate = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};

function toInput(s: BehaviorReportSubscription): BehaviorReportSubscriptionInput {
  return {
    Email: s.email,
    Name: s.name,
    Scope: s.scope,
    ScopeUserId: s.scopeUserId,
    TradeIds: s.scope === "custom" ? s.tradeIds : [],
    WeeklyEnabled: s.weeklyEnabled,
    MonthlyEnabled: s.monthlyEnabled,
    IsActive: s.isActive,
  };
}

function scopeText(s: BehaviorReportSubscription) {
  const n = s.tradeIds.length;
  const trades = `${n} trade${n === 1 ? "" : "s"}`;
  if (s.scope === "all") return `Todos los trades (${n})`;
  if (s.scope === "team") return `Equipo de ${s.scopeUserName ?? "—"} · ${trades}`;
  return `Trades elegidos · ${trades}`;
}

export function MailReports() {
  const { data: subs, loading, refetch } = useApiList(() => behaviorReportsApi.list(), []);
  const [options, setOptions] = useState<BehaviorReportOptions | null>(null);
  const [editing, setEditing] = useState<{ id: number | null; form: BehaviorReportSubscriptionInput } | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [preview, setPreview] = useState<{ sub: BehaviorReportSubscription; kind: BehaviorReportKind; html: string | null } | null>(null);
  const [testing, setTesting] = useState<{ sub: BehaviorReportSubscription; kind: BehaviorReportKind; to: string; sending: boolean } | null>(null);
  const [history, setHistory] = useState<{ sub: BehaviorReportSubscription; rows: BehaviorReportRow[] | null } | null>(null);

  const ensureOptions = async () => {
    if (options) return;
    try {
      setOptions(await behaviorReportsApi.options());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudieron cargar los trades");
    }
  };

  const openEditor = (sub: BehaviorReportSubscription | null) => {
    void ensureOptions();
    setEditing({ id: sub?.subscriptionId ?? null, form: sub ? toInput(sub) : { ...EMPTY } });
  };

  const save = async (id: number | null, form: BehaviorReportSubscriptionInput) => {
    try {
      if (id == null) await behaviorReportsApi.create(form);
      else await behaviorReportsApi.update(id, form);
      toast.success(id == null ? "Destinatario creado" : "Cambios guardados");
      setEditing(null);
      await refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al guardar");
    }
  };

  const toggle = async (sub: BehaviorReportSubscription, patch: Partial<BehaviorReportSubscriptionInput>) => {
    try {
      await behaviorReportsApi.update(sub.subscriptionId, { ...toInput(sub), ...patch });
      await refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al guardar");
    }
  };

  const openPreview = async (sub: BehaviorReportSubscription, kind: BehaviorReportKind) => {
    setPreview({ sub, kind, html: null });
    try {
      const html = await behaviorReportsApi.previewHtml(sub.subscriptionId, kind);
      setPreview({ sub, kind, html });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
      setPreview(null);
    }
  };

  const sendTest = async () => {
    if (!testing) return;
    setTesting({ ...testing, sending: true });
    try {
      const r = await behaviorReportsApi.sendTest(testing.sub.subscriptionId, testing.kind, testing.to.trim() || undefined);
      if (r.sendError) toast.error(`No se pudo enviar: ${r.sendError}`);
      else toast.success(`Prueba enviada a ${r.email}`);
      setTesting(null);
      await refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
      setTesting({ ...testing, sending: false });
    }
  };

  const openHistory = async (sub: BehaviorReportSubscription) => {
    setHistory({ sub, rows: null });
    try {
      setHistory({ sub, rows: await behaviorReportsApi.history(sub.subscriptionId) });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
      setHistory(null);
    }
  };

  const remove = async (id: number) => {
    try {
      await behaviorReportsApi.delete(id);
      toast.success("Destinatario eliminado");
      await refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    }
  };

  const activos = subs.filter((s) => s.isActive).length;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2">Reportes por mail</h1>
          <p className="text-muted-foreground max-w-2xl">
            Resumen del comportamiento de los trades: <strong>semanal</strong> los lunes (semana anterior) y{" "}
            <strong>mensual</strong> el día 1 (mes anterior), a las 07:00. El mail trae los KPIs, las anomalías
            destacadas y un link al reporte completo (sin usuario, vence a los 30 días).
          </p>
        </div>
        <Button onClick={() => openEditor(null)} className="gap-2">
          <Plus size={18} /> Nuevo destinatario
        </Button>
      </div>

      {!loading && subs.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {activos} de {subs.length} destinatarios activos. Los jefes con equipo se agregan solos (desactivados).
        </p>
      )}

      {loading ? (
        <p className="text-muted-foreground">Cargando...</p>
      ) : subs.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Mail size={48} className="mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground mb-4">Todavía no hay destinatarios</p>
            <Button onClick={() => openEditor(null)}>Agregar el primero</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {subs.map((s) => (
            <Card key={s.subscriptionId} className={s.isActive ? "" : "opacity-70"}>
              <CardContent className="p-4 sm:p-5">
                <div className="flex items-start gap-4 flex-wrap">
                  <Switch
                    checked={s.isActive}
                    onCheckedChange={(v) => void toggle(s, { IsActive: v })}
                    aria-label={s.isActive ? "Desactivar" : "Activar"}
                    className="mt-1"
                  />
                  <div className="flex-1 min-w-[220px]">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold text-foreground">{s.name}</h3>
                      {s.autoCreated && <Badge variant="outline">Automático</Badge>}
                      {!s.isActive && <Badge variant="secondary">Inactivo</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground break-all">{s.email}</p>
                    <p className="text-sm text-foreground mt-1">{scopeText(s)}</p>
                    <div className="flex items-center gap-4 mt-2 text-sm">
                      <label className="inline-flex items-center gap-2">
                        <Switch checked={s.weeklyEnabled} onCheckedChange={(v) => void toggle(s, { WeeklyEnabled: v })} />
                        Semanal
                      </label>
                      <label className="inline-flex items-center gap-2">
                        <Switch checked={s.monthlyEnabled} onCheckedChange={(v) => void toggle(s, { MonthlyEnabled: v })} />
                        Mensual
                      </label>
                    </div>
                    {s.lastReport && <LastReport r={s.lastReport} />}
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <Button variant="outline" size="sm" onClick={() => void openPreview(s, "weekly")} title="Vista previa del mail">
                      <Eye size={16} />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setTesting({ sub: s, kind: "weekly", to: "", sending: false })}
                      title="Enviar prueba"
                    >
                      <Send size={16} />
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => void openHistory(s)} title="Historial de envíos">
                      <History size={16} />
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => openEditor(s)} title="Editar">
                      <Pencil size={16} />
                    </Button>
                    {!s.autoCreated && (
                      <Button variant="outline" size="sm" onClick={() => setDeleteId(s.subscriptionId)} title="Eliminar">
                        <Trash2 size={16} className="text-red-600" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {editing && (
        <SubscriptionEditor
          id={editing.id}
          initial={editing.form}
          options={options}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      )}

      <Modal
        isOpen={preview !== null}
        onClose={() => setPreview(null)}
        title={preview ? `Vista previa — ${preview.sub.name}` : ""}
        size="xl"
      >
        {preview && (
          <div className="space-y-3">
            <KindPicker value={preview.kind} onChange={(k) => void openPreview(preview.sub, k)} />
            {preview.html == null ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Generando...</p>
            ) : (
              <iframe title="Vista previa del mail" srcDoc={preview.html} className="w-full h-[70vh] rounded-lg border border-border bg-white" />
            )}
            <p className="text-xs text-muted-foreground">Con los datos de hoy (último período cerrado). El link de la vista previa no funciona.</p>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={testing !== null}
        onClose={() => setTesting(null)}
        title="Enviar prueba"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setTesting(null)}>
              Cancelar
            </Button>
            <Button disabled={testing?.sending} onClick={() => void sendTest()}>
              {testing?.sending ? "Enviando..." : "Enviar"}
            </Button>
          </>
        }
      >
        {testing && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Manda ahora un &quot;Resumen de prueba&quot; del último período cerrado con los trades de{" "}
              <strong>{testing.sub.name}</strong>. No cuenta como el envío programado.
            </p>
            <KindPicker value={testing.kind} onChange={(k) => setTesting({ ...testing, kind: k })} />
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">Enviar a</label>
              <Input
                type="email"
                placeholder={testing.sub.email}
                value={testing.to}
                onChange={(e) => setTesting({ ...testing, to: e.target.value })}
              />
              <p className="text-xs text-muted-foreground mt-1">Vacío = al mail del destinatario.</p>
            </div>
          </div>
        )}
      </Modal>

      <Modal isOpen={history !== null} onClose={() => setHistory(null)} title={history ? `Envíos — ${history.sub.name}` : ""} size="lg">
        {history &&
          (history.rows == null ? (
            <p className="text-sm text-muted-foreground">Cargando...</p>
          ) : history.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no se le envió nada.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {history.rows.map((r) => (
                <li key={r.reportId} className="py-2 flex items-center gap-3 flex-wrap">
                  <Badge variant="outline">{KIND_LABEL[r.kind]}</Badge>
                  <span>
                    {fmtDate(r.from)} → {fmtDate(r.to)}
                  </span>
                  <span className="text-muted-foreground break-all">{r.email}</span>
                  <span className="ml-auto inline-flex items-center gap-2">
                    {r.sentAt ? (
                      <span className="text-green-700 dark:text-green-400 inline-flex items-center gap-1">
                        <CheckCircle2 size={14} /> {fmtDateTime(r.sentAt)}
                      </span>
                    ) : (
                      <span className="text-red-600 inline-flex items-center gap-1" title={r.sendError ?? ""}>
                        <XCircle size={14} /> {r.sendError ? "Error" : "Pendiente"}
                      </span>
                    )}
                    <a href={r.url} target="_blank" rel="noreferrer" className="text-espert-gold font-semibold hover:underline">
                      Abrir
                    </a>
                  </span>
                </li>
              ))}
            </ul>
          ))}
      </Modal>

      <ConfirmModal
        isOpen={deleteId !== null}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteId != null && void remove(deleteId)}
        title="Eliminar destinatario"
        message="Deja de recibir el reporte y los links que ya se le enviaron dejan de funcionar."
        confirmText="Eliminar"
        type="danger"
      />
    </div>
  );
}

function LastReport({ r }: { r: BehaviorReportRow }) {
  return (
    <p className="text-xs text-muted-foreground mt-2">
      Último envío ({KIND_LABEL[r.kind].toLowerCase()}, {fmtDate(r.from)} → {fmtDate(r.to)}):{" "}
      {r.sentAt ? (
        <span className="text-green-700 dark:text-green-400">enviado {fmtDateTime(r.sentAt)}</span>
      ) : (
        <span className="text-red-600" title={r.sendError ?? ""}>
          {r.sendError ? `falló — ${r.sendError.slice(0, 80)}` : "pendiente"}
        </span>
      )}
    </p>
  );
}

function KindPicker({ value, onChange }: { value: BehaviorReportKind; onChange: (k: BehaviorReportKind) => void }) {
  return (
    <div className="inline-flex rounded-full bg-muted p-1 text-xs font-semibold">
      {(["weekly", "monthly"] as const).map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => onChange(k)}
          className={`px-3 py-1 rounded-full ${value === k ? "bg-espert-gold text-white" : "text-muted-foreground"}`}
        >
          {KIND_LABEL[k]}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

const SCOPES: { v: BehaviorReportScope; l: string; d: string }[] = [
  { v: "all", l: "Todos los trades", d: "Todos los vendedores activos." },
  { v: "team", l: "Equipo de un jefe", d: "Su sub-árbol completo; la gente nueva entra sola." },
  { v: "custom", l: "Elegir trades", d: "Una lista fija." },
];

function SubscriptionEditor({
  id,
  initial,
  options,
  onClose,
  onSave,
}: {
  id: number | null;
  initial: BehaviorReportSubscriptionInput;
  options: BehaviorReportOptions | null;
  onClose: () => void;
  onSave: (id: number | null, form: BehaviorReportSubscriptionInput) => Promise<void>;
}) {
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");
  const set = (patch: Partial<BehaviorReportSubscriptionInput>) => setForm((f) => ({ ...f, ...patch }));

  const trades = useMemo(() => {
    const all = options?.trades ?? [];
    const term = q.trim().toLowerCase();
    return term ? all.filter((t) => t.name.toLowerCase().includes(term)) : all;
  }, [options, q]);
  const selected = new Set(form.TradeIds);
  const manager = options?.managers.find((m) => m.userId === form.ScopeUserId);

  const valid =
    form.Name.trim() &&
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.Email.trim()) &&
    (form.Scope !== "team" || form.ScopeUserId != null) &&
    (form.Scope !== "custom" || form.TradeIds.length > 0);

  const submit = async () => {
    setSaving(true);
    await onSave(id, { ...form, Email: form.Email.trim(), Name: form.Name.trim() });
    setSaving(false);
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={id == null ? "Nuevo destinatario" : "Editar destinatario"}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={!valid || saving} onClick={() => void submit()}>
            {saving ? "Guardando..." : "Guardar"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">Nombre *</label>
            <Input value={form.Name} onChange={(e) => set({ Name: e.target.value })} placeholder="Ej: Gerencia comercial" />
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">Email *</label>
            <Input type="email" value={form.Email} onChange={(e) => set({ Email: e.target.value })} placeholder="nombre@tabacaleraespert.com" />
          </div>
        </div>

        <div className="flex items-center gap-6 text-sm flex-wrap">
          <label className="inline-flex items-center gap-2">
            <Switch checked={form.WeeklyEnabled} onCheckedChange={(v) => set({ WeeklyEnabled: v })} /> Semanal
          </label>
          <label className="inline-flex items-center gap-2">
            <Switch checked={form.MonthlyEnabled} onCheckedChange={(v) => set({ MonthlyEnabled: v })} /> Mensual
          </label>
          <label className="inline-flex items-center gap-2">
            <Switch checked={form.IsActive} onCheckedChange={(v) => set({ IsActive: v })} /> Activo
          </label>
        </div>

        <div>
          <p className="text-sm font-medium text-muted-foreground mb-2">¿Qué trades recibe?</p>
          <div className="grid sm:grid-cols-3 gap-2">
            {SCOPES.map((s) => (
              <button
                key={s.v}
                type="button"
                onClick={() => set({ Scope: s.v })}
                className={`text-left rounded-lg border p-3 transition-colors ${
                  form.Scope === s.v ? "border-espert-gold bg-espert-gold/10" : "border-border hover:bg-muted/50"
                }`}
              >
                <p className="text-sm font-semibold">{s.l}</p>
                <p className="text-xs text-muted-foreground">{s.d}</p>
              </button>
            ))}
          </div>
        </div>

        {!options && form.Scope !== "all" && <p className="text-sm text-muted-foreground">Cargando trades...</p>}

        {options && form.Scope === "team" && (
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">Jefe</label>
            <select
              value={form.ScopeUserId ?? ""}
              onChange={(e) => set({ ScopeUserId: e.target.value ? Number(e.target.value) : null })}
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Elegí un jefe…</option>
              {options.managers.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name} ({m.tradeIds.length} trades)
                </option>
              ))}
            </select>
            {manager && (
              <p className="text-xs text-muted-foreground mt-1">
                Hoy: {manager.tradeIds.map((id) => options.trades.find((t) => t.userId === id)?.name ?? id).join(", ")}
              </p>
            )}
          </div>
        )}

        {options && form.Scope === "custom" && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar trade…" className="flex-1" />
              <span className="text-xs text-muted-foreground whitespace-nowrap">{form.TradeIds.length} elegidos</span>
            </div>
            <div className="max-h-64 overflow-y-auto rounded-lg border border-border divide-y divide-border">
              {trades.map((t) => (
                <label key={t.userId} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-muted/50">
                  <input
                    type="checkbox"
                    checked={selected.has(t.userId)}
                    onChange={(e) =>
                      set({
                        TradeIds: e.target.checked
                          ? [...form.TradeIds, t.userId]
                          : form.TradeIds.filter((x) => x !== t.userId),
                      })
                    }
                    className="accent-[#A48242]"
                  />
                  {t.name}
                </label>
              ))}
              {trades.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">Sin resultados</p>}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
