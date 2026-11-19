import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import type { Chain } from "@/lib/api/types";
import { filterChains, type ChainMode } from "@/lib/chains";

const NONE = "__none__";
const SEARCH_FROM = 8; // con pocas opciones el buscador estorba

interface Props {
  /** "cadena" = obligatoria · "bandera" = opcional (ofrece "Sin bandera"). */
  mode: Exclude<ChainMode, "none">;
  options: Chain[];
  value: number | "" | null;
  onChange: (chainId: number | "") => void;
  /** Cadena actual del PDV que ya no está en `options` (inactiva): se muestra igual. */
  current?: { ChainId: number; Name: string } | null;
  disabled?: boolean;
  id?: string;
}

/**
 * Selector de cadena / bandera. Usa el MISMO Select que canal y subcanal (Radix,
 * portaleado con z-[1100]: funciona dentro del modal de edición) y le suma un buscador
 * arriba que filtra las opciones por nombre o alias. Solo se elige de la lista: las
 * cadenas se administran en Canales › Cadenas.
 */
export function ChainSelect({ mode, options, value, onChange, current, disabled, id }: Props) {
  const [query, setQuery] = useState("");
  const noun = mode === "cadena" ? "cadena" : "bandera";

  const visible = useMemo(() => {
    let list = filterChains(options, query);
    // La elegida nunca desaparece de la lista aunque el filtro no la matchee
    const selected = options.find((c) => c.ChainId === Number(value));
    if (selected && !list.includes(selected)) list = [selected, ...list];
    return list;
  }, [options, query, value]);

  const orphan = current && value === current.ChainId && !options.some((c) => c.ChainId === current.ChainId)
    ? current
    : null;

  return (
    <div className="space-y-2">
      {options.length >= SEARCH_FROM && (
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Buscar ${noun}…`}
            className="h-9 pl-8 text-sm"
            disabled={disabled}
            aria-label={`Buscar ${noun}`}
            data-testid={`chain-search-${mode}`}
          />
        </div>
      )}
      <Select
        value={value ? String(value) : mode === "bandera" ? NONE : ""}
        onValueChange={(v) => onChange(v && v !== NONE ? Number(v) : "")}
        disabled={disabled}
      >
        <SelectTrigger id={id} data-testid={`chain-select-${mode}`}>
          <SelectValue placeholder={`Seleccionar ${noun}`} />
        </SelectTrigger>
        <SelectContent>
          {mode === "bandera" && <SelectItem value={NONE}>Sin bandera</SelectItem>}
          {orphan && (
            <SelectItem value={String(orphan.ChainId)}>
              <span>{orphan.Name} (inactiva)</span>
            </SelectItem>
          )}
          {visible.map((c) => (
            <SelectItem key={c.ChainId} value={String(c.ChainId)}>
              <span>{c.Name}</span>
            </SelectItem>
          ))}
          {visible.length === 0 && !orphan && (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              Ninguna {noun} coincide con “{query}”.
            </div>
          )}
        </SelectContent>
      </Select>
      {query && options.length >= SEARCH_FROM && (
        <p className="text-xs text-muted-foreground">
          {visible.length} de {options.length} {noun}s
        </p>
      )}
      {mode === "cadena" && (
        <p className="text-xs text-muted-foreground">
          ¿No está en la lista? Avisale a tu supervisor para que la agregue.
        </p>
      )}
    </div>
  );
}
