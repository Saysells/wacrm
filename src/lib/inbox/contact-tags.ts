// ============================================================
// Etiquetas del contacto desde la Bandeja.
//
// El sidebar de la Bandeja hasta ahora solo LISTABA las etiquetas:
// para poner una habia que ir a Contactos y abrir "Editar contacto".
// Este modulo es el atajo — la parte pura (que pastillas quedan) va
// separada de la parte con red (POST/DELETE) para que las dos sean
// testeables sin DOM, igual que overrides-api.ts.
//
// La escritura reusa `/api/contacts/[id]/tags` tal cual (via
// tag-api.ts): ese endpoint ya valida tenencia de contacto y tag,
// trata el duplicado como no-op (unique (contact_id, tag_id)) y
// dispara los eventos de automatizacion tag_added. No hay una
// segunda forma de escribir contact_tags.
// ============================================================

import { addContactTag, deleteContactTag } from "@/lib/contacts/tag-api";
import type { Tag } from "@/types";

/**
 * Etiquetas de la cuenta que el contacto todavia no tiene — lo que
 * ofrece el popover "+ Agregar etiqueta".
 */
export function assignableTags(all: Tag[], attached: Tag[]): Tag[] {
  const taken = new Set(attached.map((t) => t.id));
  return all.filter((t) => !taken.has(t.id));
}

/**
 * La pastilla se identifica por `tag.id`, no por el id de la fila de
 * contact_tags: la unique (contact_id, tag_id) garantiza como maximo
 * una fila por par, asi que el tag id ya es unico dentro del contacto
 * — y lo tenemos en mano sin releer la tabla despues de escribir.
 */
export function withTagAttached(attached: Tag[], tag: Tag): Tag[] {
  if (attached.some((t) => t.id === tag.id)) return attached;
  return [...attached, tag];
}

export function withTagDetached(attached: Tag[], tagId: string): Tag[] {
  return attached.filter((t) => t.id !== tagId);
}

/**
 * Persiste la etiqueta y devuelve la lista de pastillas ya
 * actualizada. Si el endpoint falla lanza (con el mensaje del
 * servidor) y el caller deja su estado como estaba.
 */
export async function attachTag(
  contactId: string,
  tag: Tag,
  attached: Tag[],
): Promise<Tag[]> {
  await addContactTag(contactId, tag.id);
  return withTagAttached(attached, tag);
}

export async function detachTag(
  contactId: string,
  tagId: string,
  attached: Tag[],
): Promise<Tag[]> {
  await deleteContactTag(contactId, tagId);
  return withTagDetached(attached, tagId);
}
