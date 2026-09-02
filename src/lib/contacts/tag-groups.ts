// ============================================================
// Grupos de etiquetas (`tags.grupo`, migracion 046).
//
// Las 13 etiquetas de grupo 'estado' son el embudo del setter: marca
// en que punto esta cada conversacion. La regla de "una sola por
// contacto" vive en la base (trigger trg_single_etapa_tag); aca solo
// esta lo que hace falta para MOSTRARLA bien: reconocerla y ordenarla
// como embudo en vez de alfabeticamente.
// ============================================================

import type { Tag, TagGrupo } from '@/types';

export const TAG_GRUPOS: readonly TagGrupo[] = ['estado', 'origen', 'senal'];

/**
 * Orden del embudo, tal como lo recorre un lead. Son los nombres que
 * la migracion 046 deja en cada cuenta; una etiqueta de estado con un
 * nombre que no este aca (renombrada a mano) va al final, alfabetica.
 */
export const ESTADO_FUNNEL: readonly string[] = [
  'Nuevo',
  'En gestión',
  'No responde',
  'Agendado a Paola',
  'Agendado a Gustavo',
  'Agendada',
  'No se presentó',
  'Reagendado',
  'Realizada',
  'Propuesta',
  'En negociación',
  'Ganada',
  'Perdido',
];

/** Misma clave de comparacion que usa el resto del catalogo. */
function nameKey(name: string): string {
  return name.trim().toLocaleLowerCase();
}

const FUNNEL_RANK = new Map(ESTADO_FUNNEL.map((n, i) => [nameKey(n), i]));

export function isEstadoTag(tag: Pick<Tag, 'grupo'>): boolean {
  return tag.grupo === 'estado';
}

/** Posicion en el embudo; las desconocidas quedan despues de la ultima. */
export function estadoRank(name: string): number {
  return FUNNEL_RANK.get(nameKey(name)) ?? ESTADO_FUNNEL.length;
}

/** Ordena etiquetas de estado por embudo (no muta la entrada). */
export function sortByFunnel(tags: Tag[]): Tag[] {
  return [...tags].sort(
    (a, b) => estadoRank(a.name) - estadoRank(b.name) || a.name.localeCompare(b.name)
  );
}

/**
 * La etiqueta de estado que tiene el contacto, si tiene. La base
 * garantiza que es como maximo una; si por lo que sea llegan dos, se
 * muestra la primera y no se inventa nada.
 */
export function findEstadoTag(tags: readonly Tag[] | undefined): Tag | null {
  return tags?.find(isEstadoTag) ?? null;
}
