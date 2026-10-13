// ============================================================
// Tablero de Configuración (rediseño, sesión F2), prototipo `config()`.
//
// Parte pura: qué tarjetas van, en qué orden, y cómo se arma el estado
// corto de cada una. El componente (`settings-overview.tsx`) solo pide
// los datos y pinta.
//
// Orden: primero las seis del prototipo (WhatsApp, Plantillas,
// Respuestas rápidas, Etiquetas, Miembros, Apariencia) y después las que
// hoy existen y el prototipo no dibuja (Tu perfil, Inicio de sesión y
// seguridad, Oportunidades y moneda, Claves de API).
//
// Permisos: HOY ninguna sección se oculta por rol en la página de
// Configuración; cada panel esconde adentro lo que el rol no puede hacer
// (invitar, crear claves, editar la moneda). `tableroCards` recibe el rol
// para dejar ese punto de decisión en un solo lugar, y por ahora devuelve
// las diez para todos.
// ============================================================

import type { AccountRole } from "@/lib/auth/roles";
import type { SettingsSection } from "@/components/settings/settings-sections";

export const TABLERO_ORDER: readonly Exclude<SettingsSection, "overview">[] = [
  "whatsapp",
  "templates",
  "quick-replies",
  "fields",
  "members",
  "appearance",
  "profile",
  "security",
  "deals",
  "api",
];

export type TableroCard = (typeof TABLERO_ORDER)[number];

/** Las tarjetas que ve un rol, en orden. Hoy: las diez para todos. */
export function tableroCards(role: AccountRole | null): readonly TableroCard[] {
  // Hoy ningún rol filtra; el parámetro queda para el día que alguno lo haga.
  void role;
  return TABLERO_ORDER;
}

export type WhatsappEstado = "notSetup" | "connected" | "needsReconnecting";

/** Estado corto de la tarjeta WhatsApp. `null` mientras carga. */
export function whatsappEstado(
  status: { configured: boolean; connected: boolean } | null,
): WhatsappEstado | null {
  if (!status) return null;
  if (!status.configured) return "notSetup";
  return status.connected ? "connected" : "needsReconnecting";
}

/** Une los pedazos del estado con " · ", saltando los vacíos. */
export function joinEstado(
  parts: ReadonlyArray<string | null | undefined | false | 0>,
): string {
  return parts.filter((p): p is string => typeof p === "string" && p.length > 0).join(" · ");
}

/** El `count` de una consulta `head: true` resuelta, o null si falló. */
export function countOf(
  res: PromiseSettledResult<{ count: number | null } | null | undefined>,
): number | null {
  if (res.status !== "fulfilled") return null;
  return res.value?.count ?? null;
}
