// ============================================================
// Texto de los tiempos de la Bandeja (`rel`, `shortWhen`, `dur` del
// prototipo). Los descriptores salen de `vistas.ts`; acá se traducen
// con las claves de `Inbox.conversationList`, que son las mismas para
// la lista, la ficha, Contactos y Notificaciones (sesión F1): una sola
// manera de escribir "hace 3 h" en toda la app.
// ============================================================

import type { useTranslations } from "next-intl";

import type { DurationParts, RelativeTime, ShortWhen } from "./vistas";

/** `useTranslations("Inbox.conversationList")`. */
export type ListTranslator = ReturnType<typeof useTranslations>;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** "recién", "hace 9 min", "hace 3 h", "ayer", "hace 3 días", "30/09" y "30/09/2025" si es de otro año. */
export function formatRelative(rel: RelativeTime, t: ListTranslator): string {
  switch (rel.kind) {
    case "now":
      return t("timeNow");
    case "minutes":
      return t("timeMinutes", { n: rel.n });
    case "hours":
      return t("timeHours", { n: rel.n });
    case "yesterday":
      return t("timeYesterday");
    case "days":
      return t("timeDays", { n: rel.n });
    case "date":
      return rel.year === undefined
        ? `${pad2(rel.day)}/${pad2(rel.month)}`
        : `${pad2(rel.day)}/${pad2(rel.month)}/${rel.year}`;
  }
}

/** "hoy 16:00", "mañana 10:00", "jue 15, 17:30". */
export function formatShortWhen(when: ShortWhen, t: ListTranslator): string {
  switch (when.kind) {
    case "today":
      return t("whenToday", { time: when.time });
    case "tomorrow":
      return t("whenTomorrow", { time: when.time });
    case "other": {
      const weekdays = t("weekdays").split(",");
      return t("whenOther", {
        weekday: weekdays[when.weekday] ?? "",
        day: when.day,
        time: when.time,
      });
    }
  }
}

/** "1 h 20 min", "2 h", "5 min". */
export function formatDuration(d: DurationParts, t: ListTranslator): string {
  if (d.hours > 0 && d.minutes > 0) return t("durationHm", { h: d.hours, m: d.minutes });
  if (d.hours > 0) return t("durationH", { h: d.hours });
  return t("durationM", { m: d.minutes });
}
