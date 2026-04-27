/**
 * Date formatting utilities — todo en zona horaria Argentina (UTC-3).
 *
 * Usar estas funciones en vez de toLocaleString/toLocaleDateString/toLocaleTimeString
 * para garantizar que los horarios se muestren siempre en hora Argentina,
 * sin importar la zona del navegador.
 */

const TZ = "America/Argentina/Buenos_Aires";
const LOCALE = "es-AR";

/** "24 de abril de 2026" */
export function formatDateLong(dateStr: string | Date): string {
  const d = typeof dateStr === "string" ? new Date(dateStr) : dateStr;
  return d.toLocaleDateString(LOCALE, {
    timeZone: TZ,
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** "24/04/2026" */
export function formatDateShort(dateStr: string | Date): string {
  const d = typeof dateStr === "string" ? new Date(dateStr) : dateStr;
  return d.toLocaleDateString(LOCALE, {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/** "24 abr" */
export function formatDateCompact(dateStr: string | Date): string {
  const d = typeof dateStr === "string" ? new Date(dateStr) : dateStr;
  return d.toLocaleDateString(LOCALE, {
    timeZone: TZ,
    day: "numeric",
    month: "short",
  });
}

/** "10:28" (24h) */
export function formatTime24(dateStr: string | Date): string {
  const d = typeof dateStr === "string" ? new Date(dateStr) : dateStr;
  return d.toLocaleTimeString(LOCALE, {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** "10:28 a.m." → no usar, preferir 24h. Si se necesita: */
export function formatTime12(dateStr: string | Date): string {
  const d = typeof dateStr === "string" ? new Date(dateStr) : dateStr;
  return d.toLocaleTimeString(LOCALE, {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

/** "24/04/2026 10:28" */
export function formatDateTime(dateStr: string | Date): string {
  const d = typeof dateStr === "string" ? new Date(dateStr) : dateStr;
  return d.toLocaleString(LOCALE, {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** "24 abr 10:28" — compacto para mobile */
export function formatDateTimeCompact(dateStr: string | Date): string {
  return `${formatDateCompact(dateStr)} ${formatTime24(dateStr)}`;
}

/** "jueves" */
export function formatDayName(dateStr: string | Date): string {
  const d = typeof dateStr === "string" ? new Date(dateStr) : dateStr;
  return d.toLocaleDateString(LOCALE, {
    timeZone: TZ,
    weekday: "long",
  });
}

/** Date in Argentina timezone as YYYY-MM-DD string (for comparisons / API calls) */
export function todayAR(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ });
}

/** Current time in Argentina as Date object */
export function nowAR(): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: TZ }));
}
