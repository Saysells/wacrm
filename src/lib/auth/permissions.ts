// ============================================================
// Permisos granulares por persona — espejo EXACTO de
// effective_permission() en la migración 041. Puro, sin I/O.
//
// Regla: un override presente en profiles.permission_overrides
// pisa el default del rol; ausente, vale el default del CASE.
// Claves desconocidas caen en false (fail-closed), igual que el
// ELSE del SQL. Si tocás los defaults acá, tocá la migración
// (o su sucesora) en el mismo diff — TS y SQL hablan el mismo
// idioma o esto deja de ser un espejo.
//
// Divergencia deliberada con el SQL: `(overrides->>key)::boolean`
// castea strings tipo "true"; acá solo se acepta un boolean real
// y cualquier otro tipo cae al default del rol. El endpoint que
// escribe overrides valida boolean, así que en la práctica no
// difieren.
// ============================================================

import type { AccountRole } from "./roles";

/** Las 10 claves del motor SQL. Ninguna más: agregar una es una
 *  migración + este archivo en el mismo diff. */
export const PERMISSION_KEYS = [
  "view_all_data",
  "can_export_contacts",
  "nav_dashboard",
  "nav_notifications",
  "nav_contacts",
  "nav_pipelines",
  "nav_broadcasts",
  "nav_automations",
  "nav_flows",
  "nav_ai_agents",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

/**
 * Forma laxa del JSONB `profiles.permission_overrides` tal como
 * llega del fetch: puede faltar (perfil viejo en caché), venir
 * vacío, o traer claves/valores basura que se ignoran.
 */
export type PermissionOverrides = Readonly<Record<string, unknown>>;

export function isPermissionKey(value: unknown): value is PermissionKey {
  return (
    typeof value === "string" &&
    (PERMISSION_KEYS as readonly string[]).includes(value)
  );
}

/** `target_role IN ('owner','admin','viewer')` del CASE. */
function isNotAgent(role: AccountRole): boolean {
  return role === "owner" || role === "admin" || role === "viewer";
}

/**
 * Espejo de `effective_permission(target_role, overrides, perm_key)`:
 * override explícito primero; si no, el default según rol; clave
 * desconocida → false.
 */
export function effectivePermission(
  role: AccountRole,
  overrides: PermissionOverrides | null | undefined,
  key: string,
): boolean {
  const override = overrides?.[key];
  if (typeof override === "boolean") return override;

  switch (key as PermissionKey) {
    case "view_all_data":
      return isNotAgent(role);
    case "can_export_contacts":
      return role === "owner" || role === "admin";
    case "nav_dashboard":
      return isNotAgent(role);
    case "nav_notifications":
      return true;
    case "nav_contacts":
      return true;
    case "nav_pipelines":
      return isNotAgent(role);
    case "nav_broadcasts":
      return isNotAgent(role);
    case "nav_automations":
      return isNotAgent(role);
    case "nav_flows":
      return isNotAgent(role);
    case "nav_ai_agents":
      return isNotAgent(role);
    default:
      return false;
  }
}
