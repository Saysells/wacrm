// ============================================================
// Días en formato ISO corto (`YYYY-MM-DD`), como los guarda
// `deals.expected_close_date`. Parte pura del selector de fecha propio
// (`src/components/ui/date-picker.tsx`, rediseño sesión F2): parsear,
// serializar y moverse de mes sin depender de la zona horaria.
// ============================================================

export interface IsoDay {
  year: number;
  /** 0 a 11, como `Date#getMonth`. */
  month: number;
  day: number;
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `"2026-10-13"` → `{ year: 2026, month: 9, day: 13 }`; otra cosa → null. */
export function parseIsoDay(value: string | null | undefined): IsoDay | null {
  if (!value) return null;
  const m = ISO_DAY.exec(value.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  if (month < 0 || month > 11) return null;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  if (day < 1 || day > daysInMonth) return null;
  return { year, month, day };
}

/** `{ 2026, 9, 13 }` → `"2026-10-13"`. */
export function toIsoDay(d: IsoDay): string {
  const mm = String(d.month + 1).padStart(2, "0");
  const dd = String(d.day).padStart(2, "0");
  return `${d.year}-${mm}-${dd}`;
}

/** El día de hoy (hora local) como `IsoDay`. */
export function todayIsoDay(now: number): IsoDay {
  const d = new Date(now);
  return { year: d.getFullYear(), month: d.getMonth(), day: d.getDate() };
}

/** Año y mes que se muestran al abrir: el del valor, o el de hoy. */
export function initialMonth(value: string | null | undefined, now: number): { year: number; month: number } {
  const parsed = parseIsoDay(value);
  if (parsed) return { year: parsed.year, month: parsed.month };
  const t = todayIsoDay(now);
  return { year: t.year, month: t.month };
}

/** Un mes antes o después, con el cambio de año resuelto. */
export function shiftMonthOf(
  view: { year: number; month: number },
  delta: number,
): { year: number; month: number } {
  const d = new Date(view.year, view.month + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

export function sameIsoDay(a: IsoDay | null, b: IsoDay | null): boolean {
  return !!a && !!b && a.year === b.year && a.month === b.month && a.day === b.day;
}

/** Texto corto para mostrar el valor elegido en el idioma pedido. */
export function formatIsoDay(value: string | null | undefined, locale: string): string {
  const parsed = parseIsoDay(value);
  if (!parsed) return "";
  return new Date(parsed.year, parsed.month, parsed.day).toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
