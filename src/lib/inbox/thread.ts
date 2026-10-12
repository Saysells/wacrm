// ============================================================
// Hilo de la Bandeja de escritorio (rediseño, sesión C).
//
// Parte PURA: ni red, ni React, ni DOM. El hilo arma su línea de
// tiempo con ESTAS funciones: mensajes y notas internas intercalados
// por fecha, con un separador por día ("Hoy", "Ayer", "Jueves 9 de
// octubre"), y la ventana de 24 h se calcula desde el último mensaje
// del cliente con la misma regla de la lista (`windowState`, sesión
// B). Prototipo: `thread()`, `dayLabel()`, `sameDay()`, `win()`.
//
// Del prototipo a los datos reales:
//   nota interna   contact_notes del contacto (la ve toda la cuenta)
//   "Bot"          messages.sender_type = 'bot'
//   "Plantilla ·"  messages.content_type = 'template' + template_name
//   ventana        24 h desde el último messages.sender_type='customer'
// ============================================================

import type { ContactNote, Message } from "@/types";
import { DAY_MS } from "./vistas";

/** Rótulo de un separador de día; el componente lo traduce. */
export type DayLabel =
  | { kind: "today" }
  | { kind: "yesterday" }
  | { kind: "date"; weekday: number; day: number; month: number; year: number; sameYear: boolean };

function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Como `dayLabel` del prototipo, recortado a lo que muestra el hilo. */
export function dayLabel(t: number, now: number): DayLabel {
  const diff = Math.round((startOfDay(now) - startOfDay(t)) / DAY_MS);
  if (diff === 0) return { kind: "today" };
  if (diff === 1) return { kind: "yesterday" };
  const d = new Date(t);
  return {
    kind: "date",
    weekday: d.getDay(),
    day: d.getDate(),
    month: d.getMonth(),
    year: d.getFullYear(),
    sameYear: d.getFullYear() === new Date(now).getFullYear(),
  };
}

export type ThreadItem =
  | { kind: "day"; key: string; at: number; label: DayLabel }
  | { kind: "message"; key: string; at: number; message: Message }
  | { kind: "note"; key: string; at: number; note: ContactNote };

function timeOf(iso: string): number {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Mensajes y notas intercalados por fecha, con un separador al cambiar
 * de día. Los mensajes llegan ordenados de la base; las notas se
 * mezclan acá. A igual instante el mensaje va antes que la nota.
 */
export function buildTimeline(
  messages: readonly Message[],
  notes: readonly ContactNote[],
  now: number,
): ThreadItem[] {
  const entries: ThreadItem[] = [];
  for (const message of messages) {
    entries.push({ kind: "message", key: `m:${message.id}`, at: timeOf(message.created_at), message });
  }
  for (const note of notes) {
    entries.push({ kind: "note", key: `n:${note.id}`, at: timeOf(note.created_at), note });
  }
  entries.sort((a, b) => {
    if (a.at !== b.at) return a.at - b.at;
    if (a.kind === b.kind) return 0;
    return a.kind === "message" ? -1 : 1;
  });

  const out: ThreadItem[] = [];
  let currentDay: number | null = null;
  for (const entry of entries) {
    const day = startOfDay(entry.at);
    if (day !== currentDay) {
      currentDay = day;
      out.push({ kind: "day", key: `d:${day}`, at: day, label: dayLabel(entry.at, now) });
    }
    out.push(entry);
  }
  return out;
}

/** `created_at` del último mensaje del cliente, o null si nunca escribió. */
export function lastCustomerMessageAt(messages: readonly Message[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].sender_type === "customer") return messages[i].created_at;
  }
  return null;
}

/** Nombre de pila para saludar: "Juan Pérez" → "Juan"; un teléfono no es un nombre. */
export function firstNameOf(name: string | null | undefined, phone?: string | null): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "";
  if (phone && trimmed.replace(/\D/g, "") === phone.replace(/\D/g, "") && trimmed.replace(/\D/g, "")) {
    return "";
  }
  return trimmed.split(/\s+/)[0];
}

/** Rótulo arriba de un mensaje saliente, o null si no lleva. */
export type OutgoingLabel = { kind: "bot" } | { kind: "template"; name: string | null };

export function outgoingLabel(message: Pick<Message, "sender_type" | "content_type" | "template_name">): OutgoingLabel | null {
  if (message.sender_type === "customer") return null;
  // El bot primero, como en el prototipo: una plantilla que mandó el bot
  // es, para quien atiende, un mensaje del bot.
  if (message.sender_type === "bot") return { kind: "bot" };
  if (message.content_type === "template") {
    return { kind: "template", name: message.template_name?.trim() || null };
  }
  return null;
}
