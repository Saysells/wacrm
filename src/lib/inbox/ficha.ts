// ============================================================
// Ficha del contacto en el panel lateral (rediseño, sesión D).
//
// Parte PURA: qué etiquetas van en el grupo "Etiquetas" (todas menos la
// de estado, que tiene su fila en "Embudo"), cómo se rotulan las de
// origen ("Origen: anuncio" / "Origen: formulario", como en el
// prototipo), qué dice la fila "Llegó por" y qué llamadas lista la
// pestaña Llamadas. Prototipo: `side()`, `c.origin`, el filtro
// `x.call && !x.call.result` ordenado por `call.at`.
//
// Del prototipo a los datos reales:
//   origen        etiquetas con grupo 'origen': `origen_ads` es el
//                 anuncio, `origen_form` el formulario de Tally
//   llamadas      estado con requiere_fecha + contacts.fecha_llamada
//                 (`scheduledCall`), de conversaciones no cerradas
// ============================================================

import { isEstadoTag } from "@/lib/contacts/tag-groups";
import type { Tag } from "@/types";
import type { InboxConversation } from "./inbox-conversation";
import { isClosed, scheduledCall, type ScheduledCall } from "./vistas";

function nameKey(name: string): string {
  return name.trim().toLocaleLowerCase();
}

/** Las etiquetas del contacto que no son de estado, en el orden en que vinieron. */
export function nonEstadoTags(tags: readonly Tag[] | undefined): Tag[] {
  return (tags ?? []).filter((t) => !isEstadoTag(t));
}

export type OriginKind = "ads" | "form" | "other";

export interface ContactOrigin {
  kind: OriginKind;
  /** Nombre de la etiqueta tal cual, para las de origen que no son las dos conocidas. */
  name: string;
}

export function originOfTag(tag: Pick<Tag, "name">): ContactOrigin {
  const key = nameKey(tag.name);
  if (key === "origen_ads") return { kind: "ads", name: tag.name };
  if (key === "origen_form") return { kind: "form", name: tag.name };
  return { kind: "other", name: tag.name.replace(/^origen[_\s]+/i, "").trim() || tag.name };
}

/**
 * La fila "Llegó por": la primera etiqueta de grupo 'origen' del
 * contacto, o null si no tiene ninguna (y la fila no se muestra).
 */
export function contactOrigin(tags: readonly Tag[] | undefined): ContactOrigin | null {
  const origin = (tags ?? []).find((t) => t.grupo === "origen");
  return origin ? originOfTag(origin) : null;
}

/** Cómo se rotula un chip del grupo Etiquetas: las de origen llevan el prefijo. */
export type TagChipLabel =
  | { kind: "plain"; name: string }
  | { kind: "origin"; origin: ContactOrigin };

export function tagChipLabel(tag: Pick<Tag, "name" | "grupo">): TagChipLabel {
  if (tag.grupo === "origen") return { kind: "origin", origin: originOfTag(tag) };
  return { kind: "plain", name: tag.name };
}

export interface UpcomingCall {
  conversation: InboxConversation;
  call: ScheduledCall;
}

/**
 * Pestaña Llamadas: toda llamada agendada de una conversación no
 * cerrada, por hora (la más próxima primero). Incluye las que ya
 * pasaron y nadie resolvió: siguen agendadas hasta que alguien les
 * cambie el estado, igual que en la vista Agendadas.
 */
export function upcomingCalls(convs: readonly InboxConversation[]): UpcomingCall[] {
  const out: UpcomingCall[] = [];
  for (const conversation of convs) {
    if (isClosed(conversation)) continue;
    const call = scheduledCall(conversation);
    if (call) out.push({ conversation, call });
  }
  return out.sort((a, b) => a.call.at - b.call.at);
}

/** El botón Email de la ficha se habilita solo con un email con contenido. */
export function hasEmail(email: string | null | undefined): email is string {
  return typeof email === "string" && email.trim().length > 0;
}
