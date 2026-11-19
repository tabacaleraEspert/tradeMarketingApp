/**
 * Lógica pura de cadenas / banderas (eje "de quién es el PDV", aparte de canal › subcanal).
 *
 * Usada por el alta y la edición de PDV y por Gestión. Sin React ni red: testeable con vitest.
 *
 * Reglas (las valida el server; acá solo se decide qué mostrar y qué mandar):
 *  - Canal con cadenas de tipo "cadena" activas → "Cadena" obligatoria y el subcanal se
 *    oculta (lo deriva el server del tamaño de la cadena).
 *  - Canal con "banderas" (estaciones de servicio) → "Bandera" opcional, salvo que el
 *    subcanal elegido sea "Independiente".
 *  - Los vendedores solo ELIGEN de la lista; las cadenas se crean en Canales › Cadenas.
 */
import type { Chain } from "@/lib/api/types";

/** Cache offline de GET /chains (misma mecánica que "channels"). */
export const CHAINS_CACHE_KEY = "chains";

export type ChainMode = "cadena" | "bandera" | "none";

export function normalizeChainText(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const byName = (a: Chain, b: Chain) => a.Name.localeCompare(b.Name, "es", { sensitivity: "base", numeric: true });

/** Qué selector de cadena corresponde para un canal (y subcanal) y con qué opciones. */
export function chainFieldFor(
  chains: Chain[],
  channelId: number | null | undefined | "",
  subChannelName?: string | null,
): { mode: ChainMode; options: Chain[] } {
  if (!channelId) return { mode: "none", options: [] };
  const ofChannel = chains.filter((c) => c.ChannelId === Number(channelId) && c.IsActive !== false);
  const cadenas = ofChannel.filter((c) => c.Kind === "cadena").sort(byName);
  if (cadenas.length > 0) return { mode: "cadena", options: cadenas };
  const banderas = ofChannel.filter((c) => c.Kind === "bandera").sort(byName);
  if (banderas.length > 0 && !normalizeChainText(subChannelName).startsWith("independiente")) {
    return { mode: "bandera", options: banderas };
  }
  return { mode: "none", options: [] };
}

/** Filtra por nombre o alias (contains, sin tildes / mayúsculas / signos). */
export function filterChains(chains: Chain[], query: string): Chain[] {
  const q = normalizeChainText(query);
  if (!q) return chains;
  const qTight = q.replace(/ /g, "");
  return chains.filter((c) => {
    const hay = [c.Name, ...(c.Aliases ?? "").split(",")].map(normalizeChainText);
    return hay.some((h) => h.includes(q) || h.replace(/ /g, "").includes(qTight));
  });
}

/**
 * Mensaje de error si falta la cadena obligatoria; null si está bien.
 * `allowEmpty`: edición de un PDV viejo que ya estaba en el canal sin cadena — el
 * server no la exige mientras no cambie de canal, así que no se bloquea el guardado.
 */
export function chainSelectionError(
  mode: ChainMode,
  chainId: number | "" | null | undefined,
  allowEmpty = false,
): string | null {
  return mode === "cadena" && !chainId && !allowEmpty ? "Elegí la cadena del PDV" : null;
}

/**
 * Fragmento del body para el ALTA (POST /pdvs).
 *
 * La clave `ChainId` solo viaja cuando hay una cadena elegida. Si este dispositivo no
 * conoce cadenas para el canal (cache offline anterior a que existieran) NO se manda la
 * clave: el server trata ese alta en modo tolerante y nunca la rechaza — un 422 en una
 * operación de la cola offline dejaría el PDV trabado en el teléfono.
 * En modo "cadena" el subcanal no se manda (lo deriva el server).
 */
export function chainCreateFields(
  mode: ChainMode,
  chainId: number | "" | null | undefined,
  subChannelId: number | "" | null | undefined,
): { ChainId?: number; SubChannelId?: number } {
  const out: { ChainId?: number; SubChannelId?: number } = {};
  if (mode !== "none" && chainId) out.ChainId = Number(chainId);
  if (mode !== "cadena" && subChannelId) out.SubChannelId = Number(subChannelId);
  return out;
}

/** Clasificación (canal › subcanal + cadena) con la que se CARGÓ el formulario de edición. */
export interface LoadedClassification {
  ChannelId?: number | null;
  SubChannelId?: number | null;
  ChainId?: number | null;
}

const idOrNull = (v: number | "" | null | undefined): number | null => (v ? Number(v) : null);

/**
 * Fragmento del body para la EDICIÓN (PATCH /pdvs/{id}): SOLO viaja lo que el usuario
 * cambió respecto del PDV con el que se cargó el formulario.
 *
 * Por qué: el formulario puede haberse cargado con datos viejos (cache offline, pestaña
 * abierta desde antes de la migración de cadenas). Si mandara siempre canal/subcanal/
 * cadena, guardar un teléfono devolvería el PDV a su clasificación anterior. Y un PDV
 * cuya cadena está inactiva (no aparece en el selector) la perdería al editar otra cosa.
 *
 *  - ChannelId: solo si cambió.
 *  - SubChannelId: solo si cambió (o cambió el canal). Nunca en modo "cadena": lo deriva
 *    el server del tamaño de la cadena.
 *  - ChainId: solo si cambió. Si cambia el canal viaja SIEMPRE (número o null): es la
 *    señal de "cambio deliberado" que el server exige para sacar un PDV de su cadena.
 *    Pasar a un subcanal sin bandera ("Independiente") la limpia.
 *  - `chainsKnown=false` (no cargó la lista de cadenas): la cadena no se toca salvo
 *    cambio de canal.
 */
export function chainUpdateFields(
  mode: ChainMode,
  form: { channelId: number | "" | null | undefined; subChannelId: number | "" | null | undefined; chainId: number | "" | null | undefined },
  loaded: LoadedClassification | null | undefined,
  chainsKnown = true,
): { ChannelId?: number; ChainId?: number | null; SubChannelId?: number | null } {
  const was = {
    channel: loaded?.ChannelId ?? null,
    sub: loaded?.SubChannelId ?? null,
    chain: loaded?.ChainId ?? null,
  };
  const channel = idOrNull(form.channelId);
  const sub = idOrNull(form.subChannelId);
  const channelChanged = channel !== null && channel !== was.channel;
  const subChanged = mode !== "cadena" && sub !== was.sub;
  // Sin selector visible la cadena solo se limpia si el usuario movió canal o subcanal
  const chain = mode === "none" ? (channelChanged || subChanged ? null : was.chain) : idOrNull(form.chainId);

  const out: { ChannelId?: number; ChainId?: number | null; SubChannelId?: number | null } = {};
  if (channelChanged) out.ChannelId = channel as number;
  if (mode !== "cadena" && (subChanged || channelChanged)) out.SubChannelId = sub;
  if (channelChanged || (chainsKnown && chain !== was.chain)) out.ChainId = chain;
  return out;
}

/** Datos de cadena para un PDV armado en el cliente (alta optimista / offline). */
export function chainInfoFor(chains: Chain[], chainId: number | null | undefined) {
  const c = chainId ? chains.find((x) => x.ChainId === Number(chainId)) : undefined;
  return {
    ChainId: c?.ChainId ?? null,
    ChainName: c?.Name ?? null,
    ChainKind: c?.Kind ?? null,
    IsKeyAccount: c?.IsKeyAccount ?? false,
  };
}
