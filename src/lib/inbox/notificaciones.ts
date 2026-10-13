// ============================================================
// Notificaciones (rediseño, sesión F1).
//
// Parte PURA: el texto de cada fila se arma en el navegador. La base
// escribe `title` y `body` en inglés (`notify_conversation_assigned`,
// migración 027) y eso no se toca: para `conversation_assigned` la
// fila dice "<nombre de pila> te asignó la conversación con <contacto>",
// o "Te asignaron la conversación con <contacto>" cuando no hay
// `actor_user_id` (una automatización). El actor sale de los nombres
// del store (`profiles`), el contacto de una consulta a `contacts` con
// los ids de la lista. Cualquier otro tipo muestra título y texto tal
// cual llegan.
// ============================================================

import type { Notification } from "@/types";
import { firstNameOf } from "./thread";

export type NotificationText =
  /** Alguien del equipo la asignó: "{actor} te asignó la conversación con {contact}". */
  | { kind: "assignedBy"; actor: string; contact: string | null }
  /** Sin actor (automatización): "Te asignaron la conversación con {contact}". */
  | { kind: "assigned"; contact: string | null }
  /** Otro tipo: lo que trae la fila. */
  | { kind: "raw"; title: string; body: string | null };

/**
 * `contact` es null cuando el contacto no está en el mapa (todavía no
 * cargó, o se borró): la fila dice "un contacto".
 */
export function notificationText(
  n: Pick<Notification, "type" | "actor_user_id" | "contact_id" | "title" | "body">,
  memberNames: ReadonlyMap<string, string>,
  contactNames: ReadonlyMap<string, string>,
): NotificationText {
  if (n.type !== "conversation_assigned") {
    return { kind: "raw", title: n.title, body: n.body?.trim() || null };
  }
  const contact = (n.contact_id && contactNames.get(n.contact_id)) || null;
  const actor = n.actor_user_id ? firstNameOf(memberNames.get(n.actor_user_id)) : "";
  return actor ? { kind: "assignedBy", actor, contact } : { kind: "assigned", contact };
}

/** Nombre para mostrar de un contacto: el nombre o, si no tiene, el teléfono. */
export function contactDisplayName(c: {
  name?: string | null;
  phone?: string | null;
}): string | null {
  return c.name?.trim() || c.phone?.trim() || null;
}

/** Ids de contacto de la lista que todavía no están en el mapa, sin repetir. */
export function missingContactIds(
  notifications: readonly Pick<Notification, "contact_id">[],
  known: ReadonlyMap<string, string>,
): string[] {
  const out: string[] = [];
  for (const n of notifications) {
    const id = n.contact_id;
    if (id && !known.has(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

/** Suma un mapa de nombres al que había, sin pisar lo conocido con nada. */
export function withContactNames(
  prev: ReadonlyMap<string, string>,
  rows: readonly { id: string; name?: string | null; phone?: string | null }[],
): Map<string, string> {
  const next = new Map(prev);
  for (const row of rows) {
    const name = contactDisplayName(row);
    if (name) next.set(row.id, name);
  }
  return next;
}

/** Un INSERT de realtime entra arriba, una sola vez; una fila que ya estaba no se duplica. */
export function prependNotification(
  prev: readonly Notification[] | null,
  row: Notification,
): Notification[] {
  if (!prev) return [row];
  if (prev.some((n) => n.id === row.id)) return [...prev];
  return [row, ...prev];
}

export function unreadCount(notifications: readonly Pick<Notification, "read_at">[] | null): number {
  return notifications?.filter((n) => !n.read_at).length ?? 0;
}
