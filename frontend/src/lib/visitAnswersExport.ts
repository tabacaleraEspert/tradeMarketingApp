/** Consolidado de respuestas de formularios (GET /visits/answers-export) → hojas de Excel. */

export interface AnswerValue {
  QType: string;
  ValueText: string | null;
  ValueNumber: number | null;
  ValueBool: boolean | null;
  ValueJson: string | null;
}

export interface AnswersExport {
  questions: {
    key: string;
    FormId: number;
    FormName: string;
    Label: string;
    QType: string;
    SortOrder: number;
    /** valor guardado → etiqueta (select / radio / checkbox) */
    Options?: Record<string, string>;
  }[];
  visits: {
    VisitId: number;
    UserId: number;
    Status: string;
    OpenedAt: string | null;
    ClosedAt: string | null;
    PdvName: string;
    PdvAddress: string | null;
    UserName: string;
    answers: Record<string, AnswerValue>;
  }[];
  truncated: boolean;
}

type Row = Record<string, unknown>;
type ExportVisit = AnswersExport["visits"][number];
type ExportQuestion = AnswersExport["questions"][number];
export interface AnswerSheet { name: string; data: Row[] }

/** `options` (valor → etiqueta) traduce los valores guardados de select / radio / checkbox. */
export function renderAnswerValue(
  a: Omit<AnswerValue, "QType"> & { QType?: string },
  options: Record<string, string> = {},
): string {
  const label = (v: unknown) => options[String(v)] ?? String(v);
  if (a.ValueJson) {
    try {
      const parsed = JSON.parse(a.ValueJson);
      if (typeof parsed === "object" && !Array.isArray(parsed)) {
        // checkbox_price: { brand: price }
        return Object.entries(parsed)
          .filter(([, v]) => v !== null && v !== false)
          .map(([k, v]) => `${label(k)}: ${v === true ? "Si" : `$${v}`}`)
          .join(", ") || "-";
      }
      if (Array.isArray(parsed)) return parsed.map(label).join(", ");
      return String(parsed);
    } catch { return a.ValueJson; }
  }
  if (a.ValueBool !== null) return a.ValueBool ? "Si" : "No";
  if (a.ValueNumber !== null) return String(a.ValueNumber);
  return a.ValueText ? label(a.ValueText) : "-";
}

const AR = "America/Argentina/Buenos_Aires";
const STATUS: Record<string, string> = { OPEN: "Abierta", IN_PROGRESS: "En curso", CLOSED: "Cerrada", COMPLETED: "Cerrada" };

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("es-AR", { timeZone: AR, day: "2-digit", month: "2-digit", year: "numeric" }) : "";
const time = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("es-AR", { timeZone: AR, hour: "2-digit", minute: "2-digit", hour12: false }) : "";

// Solo preguntas numéricas: las fotos también guardan un número (cantidad) y no se suman.
const isNumber = (a: AnswerValue) => a.QType === "number" && a.ValueNumber !== null;

/** true / false si la respuesta es un sí/no (booleano o texto "Sí"/"No"); null si no lo es. */
function yesNo(a: AnswerValue): boolean | null {
  if (a.ValueBool !== null) return a.ValueBool;
  const t = (a.ValueText || "").trim().toLowerCase();
  if (t === "si" || t === "sí") return true;
  if (t === "no") return false;
  return null;
}

/** Opciones elegidas en una respuesta de select / radio / checkbox / checkbox_price. */
function choices(a: AnswerValue): string[] {
  if (a.ValueJson) {
    try {
      const parsed = JSON.parse(a.ValueJson);
      if (Array.isArray(parsed)) return parsed.map(String);
      if (parsed && typeof parsed === "object") {
        return Object.entries(parsed).filter(([, v]) => v !== null && v !== false).map(([k]) => k);
      }
    } catch { /* texto libre */ }
    return [];
  }
  return a.ValueText ? [a.ValueText] : [];
}

/**
 * Hojas: "Visitas" (una fila por visita, una columna por pregunta), "Por vendedor" y
 * "Por vendedor y día" (visitas, PDVs, suma de las preguntas numéricas, cantidad de "Sí" y
 * cantidad por opción en las preguntas de opciones).
 * `search` aplica el mismo filtro de texto que la pantalla.
 */
export function buildAnswerSheets(data: AnswersExport, search = ""): AnswerSheet[] {
  const s = search.trim().toLowerCase();
  const visits = s
    ? data.visits.filter((v) => [v.PdvName, v.UserName, v.PdvAddress].some((x) => x?.toLowerCase().includes(s)))
    : data.visits;
  if (visits.length === 0) return [];

  // Solo preguntas con alguna respuesta; si dos formularios repiten etiqueta, se antepone el formulario.
  const used = data.questions.filter((q) => visits.some((v) => q.key in v.answers));
  const repeated = new Set(used.map((q) => q.Label).filter((l, i, all) => all.indexOf(l) !== i));
  const header = (q: ExportQuestion) => (repeated.has(q.Label) ? `${q.FormName} · ${q.Label}` : q.Label);

  const detail = visits.map((v) => {
    const row: Row = {
      Vendedor: v.UserName, PDV: v.PdvName, "Dirección": v.PdvAddress || "",
      Fecha: day(v.OpenedAt), Hora: time(v.OpenedAt), Estado: STATUS[v.Status] || v.Status,
    };
    for (const q of used) {
      const a = v.answers[q.key];
      row[header(q)] = !a ? "" : isNumber(a) ? a.ValueNumber : renderAnswerValue(a, q.Options);
    }
    return row;
  });

  const answersOf = (q: ExportQuestion) => visits.map((v) => v.answers[q.key]).filter(Boolean);
  const sums = used.filter((q) => answersOf(q).some(isNumber));
  const yeses = used.filter((q) => !sums.includes(q) && answersOf(q).some((a) => yesNo(a) !== null));
  // Preguntas de opciones (no sí/no): una columna por opción elegida al menos una vez.
  const optionCols = used
    .filter((q) => !sums.includes(q) && !yeses.includes(q) && Object.keys(q.Options || {}).length > 0)
    .flatMap((q) => {
      const chosen = new Set(answersOf(q).flatMap(choices));
      return Object.entries(q.Options || {})
        .filter(([value]) => chosen.has(value))
        .map(([value, label]) => ({ q, value, name: `${header(q)}: ${label}` }));
    });

  const summarize = (keyOf: (v: ExportVisit) => string, base: (v: ExportVisit) => Row) => {
    const groups = new Map<string, { row: Row; pdvs: Set<string> }>();
    const add = (row: Row, col: string, n: number) => { row[col] = (row[col] as number) + n; };
    for (const v of visits) {
      const k = keyOf(v);
      let g = groups.get(k);
      if (!g) {
        g = { row: { ...base(v), Visitas: 0, PDVs: 0 }, pdvs: new Set() };
        for (const q of sums) g.row[header(q)] = 0;
        for (const q of yeses) g.row[`${header(q)} (Sí)`] = 0;
        for (const c of optionCols) g.row[c.name] = 0;
        groups.set(k, g);
      }
      add(g.row, "Visitas", 1);
      g.pdvs.add(v.PdvName + "|" + (v.PdvAddress || ""));
      g.row.PDVs = g.pdvs.size;
      for (const q of sums) {
        const a = v.answers[q.key];
        if (a && isNumber(a)) add(g.row, header(q), a.ValueNumber as number);
      }
      for (const q of yeses) {
        const a = v.answers[q.key];
        if (a && yesNo(a)) add(g.row, `${header(q)} (Sí)`, 1);
      }
      for (const c of optionCols) {
        const a = v.answers[c.q.key];
        if (a && choices(a).includes(c.value)) add(g.row, c.name, 1);
      }
    }
    return [...groups.values()].map((g) => g.row);
  };

  const byUser = summarize((v) => String(v.UserId), (v) => ({ Vendedor: v.UserName }))
    .sort((a, b) => String(a.Vendedor).localeCompare(String(b.Vendedor)));
  // Las visitas llegan de la más nueva a la más vieja: se conserva ese orden por día.
  const byUserDay = summarize((v) => `${v.UserId}|${day(v.OpenedAt)}`, (v) => ({ Vendedor: v.UserName, Fecha: day(v.OpenedAt) }));

  return [
    { name: "Visitas", data: detail },
    { name: "Por vendedor", data: byUser },
    { name: "Por vendedor y día", data: byUserDay },
  ];
}
