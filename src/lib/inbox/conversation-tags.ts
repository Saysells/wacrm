// ============================================================
// Etiquetas en la LISTA de conversaciones de la Bandeja de escritorio.
//
// Hasta ahora cada fila mostraba una sola etiqueta, la de estado. El
// setter necesita distinguir de un vistazo los hilos que ademas tienen
// una etiqueta comun ("WhatsApp Mati", por ejemplo) sin abrirlos uno
// por uno.
//
// Aca vive SOLO la decision de que se muestra y en que orden; como se
// pinta (chips o puntitos) lo decide la lista segun el ancho que le
// deja la barra lateral. Parte pura, testeable sin DOM, igual que
// contact-tags.ts.
// ============================================================

import { isEstadoTag } from '@/lib/contacts/tag-groups';
import type { Tag } from '@/types';

/** Con la barra contraida entran cuatro chips; del quinto sale un "+N". */
export const MAX_TAG_CHIPS = 4;

export interface ConversationTagSplit {
  /**
   * La que va primera y siempre se ve entera: la de estado (grupo
   * 'estado', como maximo una por contacto — lo garantiza el trigger
   * trg_single_etapa_tag). Un contacto sin estado no se queda sin
   * pastilla: sube la primera secundaria.
   */
  principal: Tag | null;
  /** El resto, en el orden en que vinieron. Puede estar vacio. */
  secundarias: Tag[];
}

/**
 * Parte las etiquetas del contacto en la principal y las demas.
 *
 * El orden de `secundarias` es el de entrada a proposito: es el que
 * llega joineado en CONVERSATION_SELECT y el mismo que ve la ficha del
 * contacto, asi que los puntitos de la lista y las pastillas de la
 * ficha se corresponden fila por fila.
 */
export function splitConversationTags(
  tags: readonly Tag[] | undefined,
): ConversationTagSplit {
  if (!tags || tags.length === 0) return { principal: null, secundarias: [] };

  const estado = tags.find(isEstadoTag) ?? null;
  const resto = tags.filter((t) => !isEstadoTag(t));

  // Sin etiqueta de estado la fila no puede quedar muda: la primera
  // secundaria ocupa el lugar de la principal y el resto son puntitos.
  if (!estado) {
    return { principal: resto[0] ?? null, secundarias: resto.slice(1) };
  }

  return { principal: estado, secundarias: resto };
}

export interface VisibleChips {
  /** Las que se pintan como chip. Nunca mas de `MAX_TAG_CHIPS`. */
  chips: Tag[];
  /** Cuantas quedaron afuera; 0 cuando entraron todas. */
  extra: number;
}

/** Recorta la lista de chips al ancho disponible y cuenta el "+N". */
export function visibleChips(
  secundarias: readonly Tag[],
  max: number = MAX_TAG_CHIPS,
): VisibleChips {
  if (secundarias.length <= max) {
    return { chips: [...secundarias], extra: 0 };
  }
  return { chips: secundarias.slice(0, max), extra: secundarias.length - max };
}

/**
 * Fondo del chip: el color de la etiqueta al 15 %, para que el texto
 * vaya en el color pleno y se lea igual en claro y en oscuro.
 *
 * `color-mix` en vez de pegarle un alfa en hexa porque `tags.color` es
 * un string libre de la base: los ocho PRESET_COLORS son `#rrggbb`,
 * pero una etiqueta creada por API puede traer cualquier color CSS.
 */
export function tagTint(color: string): string {
  return `color-mix(in srgb, ${color} 15%, transparent)`;
}
