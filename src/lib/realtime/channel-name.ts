// ============================================================
// Nombres de canal de realtime únicos por instancia.
//
// `RealtimeClient.channel(nombre)` (@supabase/realtime-js 2.108)
// DEVUELVE EL CANAL EXISTENTE si el nombre se repite, y
// `RealtimeChannel.on("postgres_changes")` tira error si ese canal ya
// está uniéndose o unido. Un hook con nombre fijo que se monta en dos
// lugares a la vez (la barra lateral y la barra superior, sesión A del
// rediseño) le pide callbacks a un canal que el otro ya suscribió, y
// el error sale del `useEffect` y tira la página entera. Además
// `removeChannel` es asíncrono: hasta un remontaje del mismo componente
// puede encontrar el canal anterior todavía en la lista.
//
// Regla: un canal por instancia, nombre único por llamada. Nunca un
// nombre fijo en un hook que pueda vivir en dos lugares.
// ============================================================

let seq = 0;

/** `uniqueChannelName("x")` → `"x:1"`, `"x:2"`, … Nunca repite dentro del proceso. */
export function uniqueChannelName(prefix: string): string {
  seq += 1;
  return `${prefix}:${seq}`;
}
