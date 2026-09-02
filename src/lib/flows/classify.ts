/**
 * Clasificador de respuestas libres.
 *
 * El bot de Kosmo no usa botones: el cliente escribe lo que quiere y
 * el nodo `classify_reply` tiene que decidir si eso fue un sí, un no,
 * o algo que no entendimos. Todo el criterio vive acá, puro y sin red,
 * para poder fijarlo con los ejemplos reales del guion.
 *
 * Dos decisiones que no son negociables:
 *
 *   1. **Se compara por palabra o frase completa, nunca por
 *      subcadena.** `"no"` dentro de `"nono"` o `"sino"` no es un no,
 *      y `"si"` dentro de `"sino"` no es un sí. El texto se parte en
 *      tokens y una entrada de varias palabras ("no puedo") matchea
 *      solo si aparece como secuencia contigua de tokens.
 *
 *   2. **El orden de evaluación es extra → negativo → positivo →
 *      desconocido.** El negativo va antes que el positivo porque
 *      "no me sirve" contiene "sirve" y "no puedo" convive con textos
 *      que también traen un "dale"; quien dice que no, dijo que no.
 *      El extra va antes que todo porque es la rama más específica
 *      (pide la lista / no puede la llamada) y suele venir mezclada
 *      con un negativo: "nunca compré, llamada no puedo, mejor por
 *      catálogo" tiene que ir a la rama de la lista, no al no.
 */

export type ClassifyOutcome = "extra" | "negative" | "positive" | "unknown";

/**
 * Minúsculas, sin acentos, sin signos, espacios simples.
 *
 * NFD descompone `ñ` en `n` + tilde combinante, así que la ñ queda
 * como `n`. Es intencional y simétrico: las listas de palabras pasan
 * por esta misma función, de modo que "mañana" y "manana" son el
 * mismo token de los dos lados.
 */
export function normalizeReply(raw: string): string {
  if (!raw) return "";
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Tokens normalizados del texto. */
export function tokenizeReply(raw: string): string[] {
  const norm = normalizeReply(raw);
  return norm.length === 0 ? [] : norm.split(" ");
}

/**
 * ¿Aparece `phrase` como secuencia contigua de tokens dentro de
 * `tokens`? Una entrada de una sola palabra es el caso degenerado
 * (ventana de largo 1), así que no hay dos caminos distintos.
 */
export function containsPhrase(tokens: string[], phrase: string): boolean {
  const needle = tokenizeReply(phrase);
  if (needle.length === 0 || needle.length > tokens.length) return false;
  for (let i = 0; i + needle.length <= tokens.length; i += 1) {
    let hit = true;
    for (let j = 0; j < needle.length; j += 1) {
      if (tokens[i + j] !== needle[j]) {
        hit = false;
        break;
      }
    }
    if (hit) return true;
  }
  return false;
}

/** ¿Alguna de las entradas de la lista aparece en el texto? */
export function matchesAny(tokens: string[], list: string[] | undefined): boolean {
  if (!list?.length) return false;
  return list.some((entry) => containsPhrase(tokens, entry));
}

export interface ClassifyLists {
  /** Rama específica opcional; se evalúa primero. */
  extra?: string[];
  negative?: string[];
  positive?: string[];
}

/**
 * Clasifica un texto libre del cliente. Ver el comentario de cabecera
 * por qué el orden es extra → negativo → positivo.
 */
export function classifyReply(
  text: string,
  lists: ClassifyLists,
): ClassifyOutcome {
  const tokens = tokenizeReply(text);
  if (tokens.length === 0) return "unknown";
  if (matchesAny(tokens, lists.extra)) return "extra";
  if (matchesAny(tokens, lists.negative)) return "negative";
  if (matchesAny(tokens, lists.positive)) return "positive";
  return "unknown";
}
