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

import type { SupabaseClient } from "@supabase/supabase-js";

import { addContactTag, deleteContactTag } from "@/lib/contacts/tag-api";
import { isEstadoTag, sortByFunnel } from "@/lib/contacts/tag-groups";
import type { Tag } from "@/types";

/**
 * Etiquetas de la cuenta que el contacto todavia no tiene — lo que
 * ofrece el popover "+ Agregar etiqueta".
 */
export function assignableTags(all: Tag[], attached: Tag[]): Tag[] {
  const taken = new Set(attached.map((t) => t.id));
  return all.filter((t) => !taken.has(t.id));
}

export interface AssignableTagGroups {
  /** Grupo 'estado' que el contacto no tiene, en orden de embudo. */
  estado: Tag[];
  /** El resto, alfabetico. */
  otras: Tag[];
}

/**
 * Lo mismo que `assignableTags`, partido en los dos grupos que muestra
 * el popover: el setter elige un estado (en el orden en que un lead
 * los recorre, no alfabetico) o una etiqueta comun.
 */
export function groupAssignableTags(
  all: Tag[],
  attached: Tag[],
): AssignableTagGroups {
  const available = assignableTags(all, attached);
  return {
    estado: sortByFunnel(available.filter(isEstadoTag)),
    otras: available
      .filter((t) => !isEstadoTag(t))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/**
 * Pastillas de la ficha: la de estado primera (es lo que el setter
 * mira de un vistazo), las demas en el orden en que vinieron.
 */
export function orderAttachedTags(attached: Tag[]): Tag[] {
  const estado = attached.filter(isEstadoTag);
  if (estado.length === 0) return attached;
  return [...estado, ...attached.filter((t) => !isEstadoTag(t))];
}

/**
 * La pastilla se identifica por `tag.id`, no por el id de la fila de
 * contact_tags: la unique (contact_id, tag_id) garantiza como maximo
 * una fila por par, asi que el tag id ya es unico dentro del contacto
 * — y lo tenemos en mano sin releer la tabla despues de escribir.
 *
 * Si la etiqueta nueva es de estado, la de estado anterior sale de la
 * lista en el mismo paso. No es la regla (esa vive en la base, trigger
 * trg_single_etapa_tag): es su espejo para que la ficha no muestre dos
 * estados durante el instante que tarda la relectura.
 */
export function withTagAttached(attached: Tag[], tag: Tag): Tag[] {
  if (attached.some((t) => t.id === tag.id)) return attached;
  const kept = isEstadoTag(tag)
    ? attached.filter((t) => !isEstadoTag(t))
    : attached;
  return [...kept, tag];
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

// ============================================================
// Crear una etiqueta sin salir de la Bandeja.
//
// Insert directo a `tags`, el mismo patron que tag-manager.tsx
// (Configuracion → Campos y etiquetas): la tabla tiene RLS propia
// (`tags_insert` pide admin+, migracion 017) asi que no hace falta
// —ni conviene— una API route dedicada.
//
// El paso es UNO solo: crear y quedar aplicada. La asociacion sale
// por `attachTag`, el mismo camino que usar una etiqueta ya
// existente; no hay una segunda forma de escribir contact_tags.
// ============================================================

export type TagCreateFailure = "empty_name" | "duplicate_name" | "attach_failed";

export class TagCreateError extends Error {
  readonly code: TagCreateFailure;
  /**
   * La etiqueta que SI llego a crearse (solo en `attach_failed`).
   * La fila ya existe en `tags`, asi que el caller la suma igual al
   * catalogo en memoria en vez de perderla hasta el proximo fetch.
   */
  readonly tag?: Tag;

  constructor(code: TagCreateFailure, message: string, tag?: Tag) {
    super(message);
    this.name = "TagCreateError";
    this.code = code;
    this.tag = tag;
  }
}

/** Clave de comparacion de nombres: sin espacios de borde y sin mayusculas. */
function nameKey(name: string): string {
  return name.trim().toLocaleLowerCase();
}

export interface CreateAndAttachTagInput {
  db: SupabaseClient;
  accountId: string;
  userId: string;
  contactId: string;
  name: string;
  color: string;
  /** Catalogo de la cuenta tal como lo tiene el sidebar. */
  accountTags: Tag[];
  /** Pastillas actuales del contacto. */
  attached: Tag[];
}

export interface CreateAndAttachTagResult {
  tag: Tag;
  /** Pastillas del contacto, ya con la nueva. */
  attached: Tag[];
  /** Catalogo en memoria, ya con la nueva y ordenado por nombre. */
  accountTags: Tag[];
}

export async function createAndAttachTag(
  input: CreateAndAttachTagInput,
): Promise<CreateAndAttachTagResult> {
  const name = input.name.trim();
  if (!name) {
    throw new TagCreateError("empty_name", "Tag name is required");
  }

  // Duplicado: se chequea contra el catalogo que el sidebar ya tiene
  // (RLS lo trae completo para la cuenta). No hay unique (account_id,
  // name) en la base — agregarla es SQL, ver los pendientes del
  // CLAUDE.md — asi que dos personas creando el mismo nombre a la vez
  // todavia pueden dejar dos filas.
  const key = nameKey(name);
  if (input.accountTags.some((t) => nameKey(t.name) === key)) {
    throw new TagCreateError("duplicate_name", `Tag "${name}" already exists`);
  }

  // account_id es obligatorio en todo insert con scope de cuenta
  // (NOT NULL + RLS, sin default en la base) — igual que handleCreate
  // en tag-manager.tsx. `.select().single()` porque necesitamos el id
  // para aplicarla en el mismo paso.
  const { data, error } = await input.db
    .from("tags")
    .insert({
      account_id: input.accountId,
      user_id: input.userId,
      name,
      color: input.color,
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(error?.message || "Failed to create tag");
  }

  const tag = data as Tag;
  const accountTags = [...input.accountTags, tag].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  let attached: Tag[];
  try {
    attached = await attachTag(input.contactId, tag, input.attached);
  } catch (err) {
    throw new TagCreateError(
      "attach_failed",
      err instanceof Error ? err.message : "Failed to apply tag",
      tag,
    );
  }

  return { tag, attached, accountTags };
}
