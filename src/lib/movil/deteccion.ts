// ============================================================
// A donde manda la raiz: /m o /dashboard.
//
// La deteccion es POR ANCHO, no por user agent. Dos razones: el user
// agent miente (iPad pide el sitio de escritorio por default, y todo
// navegador tiene el interruptor de "solicitar version de escritorio"),
// y el ancho es lo que de verdad decide si la app de escritorio entra
// en la pantalla.
//
// Puro y sin `window` adentro, para poder probarlo.
// ============================================================

/**
 * Hasta aca se considera telefono. 820 px entra un iPhone en horizontal
 * (926 no, y ahi la de escritorio ya se usa) y deja afuera cualquier
 * ventana de escritorio razonable.
 */
export const ANCHO_MAXIMO_MOVIL = 820;

export function rutaSegunAncho(ancho: number): "/m" | "/dashboard" {
  return ancho <= ANCHO_MAXIMO_MOVIL ? "/m" : "/dashboard";
}
