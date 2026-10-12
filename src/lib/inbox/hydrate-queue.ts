// ============================================================
// Relecturas de una conversación, una por vez y sin perder la última
// (rediseño, sesión E).
//
// `hydrate(id)` del store relee UNA fila de la base. Desde la sesión B
// tenía una guarda de "una sola relectura por conversación en vuelo":
// si llegaba otra mientras una corría, se descartaba. Con dos cambios
// de etiqueta seguidos (sacar y volver a poner "Reagendado"; el
// resultado de una llamada, que pone "Realizada" y el trigger saca la
// de fecha) la segunda relectura se perdía y la lista quedaba con el
// estado del medio hasta recargar.
//
// Regla: por conversación corre UNA relectura a la vez. Una pedida
// mientras otra corre no se descarta ni se duplica: queda anotada y
// corre apenas termina la actual (una sola más, aunque se hayan pedido
// diez, porque la base ya tiene todo lo último). Como las lecturas van
// en serie, la última respuesta aplicada es siempre la de la última
// lectura, y esa salió después del último cambio.
//
// Puro y testeable (hydrate-queue.test.ts); el store solo llama a
// `requestHydrate` antes de leer y a `finishHydrate` al terminar.
// ============================================================

export interface HydrateQueue {
  /** Conversaciones con una relectura en curso. */
  running: Set<string>;
  /** Conversaciones con una relectura pedida mientras otra corría. */
  pending: Set<string>;
}

export function createHydrateQueue(): HydrateQueue {
  return { running: new Set(), pending: new Set() };
}

/**
 * Se pide releer `id`. "run": no había nada en curso, leer ahora.
 * "queued": hay una en curso; al terminar correrá una más.
 */
export function requestHydrate(queue: HydrateQueue, id: string): "run" | "queued" {
  if (queue.running.has(id)) {
    queue.pending.add(id);
    return "queued";
  }
  queue.running.add(id);
  return "run";
}

/**
 * Terminó la relectura de `id`. "rerun": alguien pidió otra mientras
 * tanto, así que sigue en curso y hay que leer de nuevo (una vez).
 * "idle": no quedó nada pendiente.
 */
export function finishHydrate(queue: HydrateQueue, id: string): "rerun" | "idle" {
  if (queue.pending.has(id)) {
    queue.pending.delete(id);
    return "rerun";
  }
  queue.running.delete(id);
  return "idle";
}

export function isHydrating(queue: HydrateQueue, id: string): boolean {
  return queue.running.has(id);
}
