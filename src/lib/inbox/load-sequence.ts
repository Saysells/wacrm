// ============================================================
// Secuencia de pedidos: gana la respuesta más nueva (rediseño, sesión B).
//
// La carga de la lista del store se dispara desde un efecto cuyas
// dependencias cambian más de una vez al arrancar (AuthProvider pide
// el perfil dos veces: `profileLoading` va y vuelve y
// `permission_overrides` llega como objeto nuevo). El guard anterior
// —"una sola consulta en vuelo" más el `cancelled` del cleanup—
// perdía la carga: el cleanup descartaba la consulta en vuelo y la
// corrida nueva volvía enseguida sin pedir nada, así que `loading`
// quedaba en true para siempre (6 de 8 cargas en la prueba).
//
// Regla: cada corrida del efecto pide SIEMPRE, con un número de
// pedido; al volver, solo se aplica la respuesta cuyo número sigue
// siendo el último. Nada se descarta sin que otro pedido lo
// reemplace, así la última corrida termina aplicando una respuesta.
// Puro y testeable (load-sequence.test.ts).
// ============================================================

export interface LoadSequence {
  /** Número del último pedido iniciado; 0 antes del primero. */
  latest: number;
}

export function createLoadSequence(): LoadSequence {
  return { latest: 0 };
}

/** Inicia un pedido y devuelve su número. */
export function beginLoad(seq: LoadSequence): number {
  seq.latest += 1;
  return seq.latest;
}

/** ¿La respuesta del pedido `id` es la más nueva y se aplica? */
export function shouldApply(seq: LoadSequence, id: number): boolean {
  return id === seq.latest;
}
