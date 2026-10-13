// ============================================================
// Pantalla Contactos (rediseño, sesión F1), prototipo `contactos()`,
// el menú `cfilter` de `openMenu()`, `cfToggle`, `cfClear` y
// `openContact`.
//
// Parte PURA: ni red, ni React, ni DOM. Qué ofrece el filtro, qué ids
// manda a `filter_contacts_by_tags`, cómo se rotula el chip del filtro,
// qué columnas van según las etiquetas de la cuenta y a dónde lleva el
// clic en una fila. La página solo pide y pinta.
//
// Del prototipo a los datos reales:
//   grupo del filtro   los del embudo (`funnelGroups`, los mismos de la
//                      barra lateral); un grupo = todas sus etiquetas de
//                      estado (la RPC ya filtra por "cualquiera de")
//   otras etiquetas    las que no son de estado (manuales, origen y
//                      señal), rotuladas como en la ficha (`tagChipLabel`)
//   Estado (columna)   la etiqueta de estado del contacto → su grupo
//   Origen (columna)   `contactOrigin` (la primera etiqueta de origen)
//   Setter / Último    la conversación del contacto (una por contacto:
//                      índice único de la migración 036)
//   clic en la fila    la Bandeja con esa conversación; sin conversación,
//                      la ficha
// ============================================================

import type { Tag } from "@/types";
import { estadoGroupOf, funnelGroups, type FunnelGroup } from "@/lib/inbox/vistas";
import { findEstadoTag } from "@/lib/contacts/tag-groups";

function nameKey(name: string): string {
  return name.trim().toLocaleLowerCase();
}

// ------------------------------------------------------------
// Opciones del filtro
// ------------------------------------------------------------

export interface FilterGroup extends FunnelGroup {
  /** Ids de las etiquetas de estado que caen en este grupo. */
  tagIds: string[];
}

export interface FilterOptions {
  /** Grupos del embudo en orden, con sus etiquetas. Vacío sin etiquetas de estado. */
  groups: FilterGroup[];
  /** Las que no son de estado, por nombre. */
  others: Tag[];
}

/**
 * Lo que lista el menú "Filtro por estado": los grupos del embudo
 * (los mismos que la barra lateral) y, debajo, las demás etiquetas.
 */
export function filterOptions(accountTags: readonly Tag[]): FilterOptions {
  const groups = funnelGroups(accountTags).map((group) => ({
    ...group,
    tagIds: accountTags
      .filter((t) => t.grupo === "estado" && nameKey(estadoGroupOf(t)) === nameKey(group.name))
      .map((t) => t.id),
  }));
  const others = accountTags
    .filter((t) => t.grupo !== "estado")
    .sort((a, b) => a.name.localeCompare(b.name));
  return { groups, others };
}

/** Sin etiquetas en la cuenta (USA) el filtro no va. */
export function showsFilter(options: FilterOptions): boolean {
  return options.groups.length > 0 || options.others.length > 0;
}

// ------------------------------------------------------------
// Estado del filtro
// ------------------------------------------------------------

export interface ContactFilter {
  /** Nombres de grupo marcados, en el orden en que se marcaron. */
  groups: string[];
  /** Ids de "otras etiquetas" marcados, en el orden en que se marcaron. */
  tagIds: string[];
}

export const EMPTY_FILTER: ContactFilter = { groups: [], tagIds: [] };

export function isFilterEmpty(filter: ContactFilter): boolean {
  return filter.groups.length === 0 && filter.tagIds.length === 0;
}

/** Como `cfToggle` del prototipo: marca o desmarca un grupo. No muta. */
export function toggleGroup(filter: ContactFilter, group: string): ContactFilter {
  const key = nameKey(group);
  const has = filter.groups.some((g) => nameKey(g) === key);
  return {
    ...filter,
    groups: has ? filter.groups.filter((g) => nameKey(g) !== key) : [...filter.groups, group],
  };
}

export function toggleTag(filter: ContactFilter, tagId: string): ContactFilter {
  const has = filter.tagIds.includes(tagId);
  return {
    ...filter,
    tagIds: has ? filter.tagIds.filter((id) => id !== tagId) : [...filter.tagIds, tagId],
  };
}

export function hasGroup(filter: ContactFilter, group: string): boolean {
  const key = nameKey(group);
  return filter.groups.some((g) => nameKey(g) === key);
}

/**
 * Saca del filtro lo que ya no existe en la cuenta (un grupo sin
 * etiquetas, una etiqueta borrada), para que no quede filtrando por
 * algo invisible.
 */
export function pruneFilter(filter: ContactFilter, options: FilterOptions): ContactFilter {
  const groups = filter.groups.filter((g) =>
    options.groups.some((o) => nameKey(o.name) === nameKey(g)),
  );
  const tagIds = filter.tagIds.filter((id) => options.others.some((t) => t.id === id));
  if (groups.length === filter.groups.length && tagIds.length === filter.tagIds.length) {
    return filter;
  }
  return { groups, tagIds };
}

/**
 * Una sola lista de ids para `filter_contacts_by_tags` ("cualquiera
 * de"): un grupo aporta todas sus etiquetas de estado. Sin duplicados,
 * en el orden en que se marcó cada cosa.
 */
export function filterTagIds(filter: ContactFilter, options: FilterOptions): string[] {
  const out: string[] = [];
  const push = (id: string) => {
    if (!out.includes(id)) out.push(id);
  };
  for (const group of filter.groups) {
    const hit = options.groups.find((o) => nameKey(o.name) === nameKey(group));
    hit?.tagIds.forEach(push);
  }
  filter.tagIds.forEach(push);
  return out;
}

/** Rótulo del chip: "Estado", "Etiqueta" o "Estado o etiqueta". */
export type FilterKind = "estado" | "etiqueta" | "ambos";

export function filterKind(filter: ContactFilter): FilterKind | null {
  const hasGroups = filter.groups.length > 0;
  const hasTags = filter.tagIds.length > 0;
  if (hasGroups && hasTags) return "ambos";
  if (hasGroups) return "estado";
  if (hasTags) return "etiqueta";
  return null;
}

/** Las etiquetas marcadas (las "otras"), para rotular el chip. */
export function selectedOtherTags(filter: ContactFilter, options: FilterOptions): Tag[] {
  return filter.tagIds
    .map((id) => options.others.find((t) => t.id === id))
    .filter((t): t is Tag => !!t);
}

// ------------------------------------------------------------
// Columnas
// ------------------------------------------------------------

/** La columna Estado va solo si la cuenta tiene etiquetas de estado. */
export function showsEstadoColumn(accountTags: readonly Tag[]): boolean {
  return accountTags.some((t) => t.grupo === "estado");
}

/** La columna Origen va solo si la cuenta tiene etiquetas de origen. */
export function showsOrigenColumn(accountTags: readonly Tag[]): boolean {
  return accountTags.some((t) => t.grupo === "origen");
}

/** Grupo del embudo del contacto (su etiqueta de estado), o null. */
export function contactGroup(tags: readonly Tag[] | undefined): string | null {
  const estado = findEstadoTag(tags);
  return estado ? estadoGroupOf(estado) : null;
}

// ------------------------------------------------------------
// La conversación de cada contacto
// ------------------------------------------------------------

export interface ContactConversation {
  id: string;
  contact_id: string;
  status: string;
  assigned_agent_id: string | null;
  last_message_at: string | null;
}

/**
 * Una conversación por contacto (migración 036). Si por lo que sea
 * llegan dos, gana la de actividad más reciente.
 */
export function conversationsByContact(
  rows: readonly ContactConversation[],
): Map<string, ContactConversation> {
  const out = new Map<string, ContactConversation>();
  for (const row of rows) {
    const prev = out.get(row.contact_id);
    if (!prev || activityOf(row) > activityOf(prev)) out.set(row.contact_id, row);
  }
  return out;
}

function activityOf(row: ContactConversation): number {
  const t = row.last_message_at ? new Date(row.last_message_at).getTime() : 0;
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Como `openContact` del prototipo: la Bandeja con esa conversación.
 * "Todas" deja afuera las cerradas, así que una cerrada abre en
 * Cerradas. Null sin conversación: ahí se abre la ficha.
 */
export function conversationHref(conv: Pick<ContactConversation, "id" | "status"> | null | undefined): string | null {
  if (!conv) return null;
  const vista = conv.status === "closed" ? "cerradas" : "todas";
  return `/inbox?vista=${vista}&c=${encodeURIComponent(conv.id)}`;
}
