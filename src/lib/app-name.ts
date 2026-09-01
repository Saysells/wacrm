// ============================================================
// El nombre de la app, por variable de entorno.
//
// El mismo codigo corre en mas de una instancia: la de Kosmo se
// llama "Bandeja KOSMO" y la comercial tiene otro nombre. Antes el
// nombre estaba escrito en tres catalogos de i18n y en la metadata
// del layout, asi que cambiarlo era un fork.
//
// `NEXT_PUBLIC_` porque lo usa el Sidebar, que es un componente de
// cliente: Next lo reemplaza literalmente en el bundle en tiempo de
// build. Cambiarlo en Vercel pide un redeploy, no un restart.
//
// NO es traducible a proposito: es un nombre propio, no una etiqueta
// de interfaz. Por eso salio de `Sidebar.title` en los catalogos.
// ============================================================

export const DEFAULT_APP_NAME = 'CRM By Saysells';

/** Parte pura: la variable vacia o con solo espacios cae al default. */
export function resolveAppName(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed || DEFAULT_APP_NAME;
}

// La expresion `process.env.NEXT_PUBLIC_APP_NAME` tiene que quedar
// escrita entera para que Next la reemplace en el build del cliente.
export const APP_NAME = resolveAppName(process.env.NEXT_PUBLIC_APP_NAME);
