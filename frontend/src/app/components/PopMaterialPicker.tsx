import { useMemo, useState, useEffect } from "react";
import { Search, X, ImageIcon, CheckCircle2, Plus } from "lucide-react";
import type { PopMaterial } from "@/lib/api/types";
import { distinctValues, filterPopMaterials } from "@/lib/popMaterials";

interface Props {
  open: boolean;
  onClose: () => void;
  materials: PopMaterial[];
  loading?: boolean;
  onSelect: (m: PopMaterial) => void;
  /** Códigos ya agregados (se marcan con check, igual se pueden elegir si `allowRepeat`). */
  selectedCodes?: string[];
  allowRepeat?: boolean;
  /** Opción de texto libre (pieza vieja / sin código). */
  otherLabel?: string;
  onOther?: (name: string) => void;
  title?: string;
}

function Thumb({ url }: { url: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) {
    return (
      <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center shrink-0">
        <ImageIcon size={18} className="text-muted-foreground/60" />
      </div>
    );
  }
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className="w-12 h-12 rounded-lg object-cover border border-border bg-muted shrink-0"
    />
  );
}

function Chips({ values, value, onChange, allLabel }: { values: string[]; value: string | null; onChange: (v: string | null) => void; allLabel: string }) {
  if (values.length === 0) return null;
  const cls = (on: boolean) =>
    `shrink-0 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${on ? "bg-[#A48242] text-white" : "bg-muted text-muted-foreground"}`;
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
      <button type="button" onClick={() => onChange(null)} className={cls(value === null)}>{allLabel}</button>
      {values.map((v) => (
        <button type="button" key={v} onClick={() => onChange(value === v ? null : v)} className={cls(value === v)}>{v}</button>
      ))}
    </div>
  );
}

/**
 * Selector del catálogo de material POP (artículos MKT). Bottom sheet mobile-first:
 * búsqueda por código/descripción + chips por Línea y Tipo + miniatura. Muestra
 * todo el catálogo (el stock no filtra; se muestra de forma tenue).
 */
export function PopMaterialPicker({
  open, onClose, materials, loading, onSelect, selectedCodes = [], allowRepeat = false,
  otherLabel, onOther, title = "Elegir material POP",
}: Props) {
  const [query, setQuery] = useState("");
  const [line, setLine] = useState<string | null>(null);
  const [type, setType] = useState<string | null>(null);
  const [otherMode, setOtherMode] = useState(false);
  const [otherName, setOtherName] = useState("");

  useEffect(() => {
    if (!open) { setOtherMode(false); setOtherName(""); }
  }, [open]);

  const lines = useMemo(() => distinctValues(materials, "Line"), [materials]);
  const types = useMemo(() => distinctValues(materials, "Type"), [materials]);
  const filtered = useMemo(() => filterPopMaterials(materials, { query, line, type }), [materials, query, line, type]);
  const selected = useMemo(() => new Set(selectedCodes), [selectedCodes]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[1000] flex items-end justify-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-card rounded-t-2xl border-t border-border flex flex-col max-h-[88dvh] pb-[env(safe-area-inset-bottom)]">
        <div className="p-4 pb-2 space-y-2 border-b border-border">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-foreground">{title}</p>
            <button onClick={onClose} aria-label="Cerrar" className="p-1 text-muted-foreground hover:text-foreground"><X size={18} /></button>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por código o descripción"
              aria-label="Buscar material"
              className="w-full h-10 pl-8 pr-8 border border-border rounded-lg text-sm bg-background"
            />
            {query && (
              <button onClick={() => setQuery("")} aria-label="Limpiar búsqueda" className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground"><X size={14} /></button>
            )}
          </div>
          <Chips values={lines} value={line} onChange={setLine} allLabel="Todas las líneas" />
          <Chips values={types} value={type} onChange={setType} allLabel="Todos los tipos" />
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {onOther && (
            otherMode ? (
              <div className="p-2 mb-1 rounded-xl border border-dashed border-[#A48242]/50 space-y-2">
                <input
                  autoFocus
                  value={otherName}
                  onChange={(e) => setOtherName(e.target.value)}
                  placeholder="Describí la pieza (ej: cigarrera vieja Milenio)"
                  className="w-full h-10 px-3 border border-border rounded-lg text-sm bg-background"
                />
                <div className="flex gap-2">
                  <button type="button" onClick={() => setOtherMode(false)} className="flex-1 h-9 rounded-lg bg-muted text-xs font-semibold text-muted-foreground">Cancelar</button>
                  <button
                    type="button"
                    disabled={!otherName.trim()}
                    onClick={() => { onOther(otherName.trim()); setOtherMode(false); setOtherName(""); }}
                    className="flex-1 h-9 rounded-lg bg-[#A48242] text-white text-xs font-semibold disabled:opacity-50"
                  >Agregar</button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setOtherMode(true)} className="w-full mb-1 p-2.5 rounded-xl border border-dashed border-border flex items-center gap-3 text-left hover:bg-muted/50">
                <div className="w-12 h-12 rounded-lg bg-[#A48242]/10 flex items-center justify-center shrink-0"><Plus size={18} className="text-[#A48242]" /></div>
                <span className="text-sm font-medium text-foreground">{otherLabel ?? "Otro material (sin código)"}</span>
              </button>
            )
          )}

          {loading ? (
            <p className="text-center text-sm text-muted-foreground py-8">Cargando catálogo...</p>
          ) : materials.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-8">Catálogo no disponible. Conectate una vez para descargarlo.</p>
          ) : filtered.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-8">Sin resultados</p>
          ) : (
            <ul className="space-y-1">
              {filtered.map((m) => {
                const isSel = selected.has(m.Code);
                const disabled = isSel && !allowRepeat;
                return (
                  <li key={m.Code}>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onSelect(m)}
                      className={`w-full p-2 rounded-xl flex items-center gap-3 text-left transition-colors ${isSel ? "bg-[#A48242]/10" : "hover:bg-muted/50"} ${disabled ? "opacity-70" : ""}`}
                    >
                      <Thumb url={m.PhotoUrl} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground leading-tight line-clamp-2">{m.Description}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                          {m.Code}
                          {m.Year ? ` · ${m.Year}` : ""}
                          {m.Stock !== null && m.Stock !== undefined ? ` · stock ${m.Stock}` : ""}
                        </p>
                      </div>
                      {isSel && <CheckCircle2 size={16} className="text-[#A48242] shrink-0" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
