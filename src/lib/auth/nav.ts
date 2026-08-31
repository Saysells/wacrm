// ============================================================
// Política de navegación — pura, testeable, sin I/O.
//
// Desde la sesión de permisos granulares (2026-08-31, bloque 2)
// la navegación ya no depende del rol a secas: cada sección
// mapea a una clave nav_* del motor de permisos (migración 041 /
// src/lib/auth/permissions.ts) y se resuelve con
// effectivePermission(rol, overrides, clave). Un agent con
// override nav_dashboard:true ve el Panel; un admin con
// nav_broadcasts:false deja de verlo.
//
// Dos secciones quedan FUERA del motor (no son claves de las 10):
//   - /inbox: siempre visible y accesible — es el corazón de la app.
//   - /settings: siempre accesible (perfil propio); en el sidebar
//     solo para roles no-agent, como en la sesión 1.
//
// Consumidores: sidebar.tsx y middleware.ts. Cambiar qué puede
// abrir alguien es un diff acá o un override en su perfil.
// ============================================================

import type { AccountRole } from "./roles";
import {
  effectivePermission,
  type PermissionKey,
  type PermissionOverrides,
} from "./permissions";

/**
 * Clave de permiso que gobierna cada sección del dashboard.
 * /inbox y /settings no aparecen a propósito (ver header).
 */
export const NAV_PERMISSION_BY_PREFIX: Readonly<
  Record<string, PermissionKey>
> = {
  "/dashboard": "nav_dashboard",
  "/notifications": "nav_notifications",
  "/contacts": "nav_contacts",
  "/pipelines": "nav_pipelines",
  "/broadcasts": "nav_broadcasts",
  "/automations": "nav_automations",
  "/flows": "nav_flows",
  "/agents": "nav_ai_agents",
};

/**
 * Todas las secciones autenticadas. El redirect a /login del
 * middleware itera esta lista; mantenela al día cuando aparezca
 * una sección nueva.
 */
export const DASHBOARD_PREFIXES = [
  "/dashboard",
  "/inbox",
  "/notifications",
  "/contacts",
  "/pipelines",
  "/broadcasts",
  "/automations",
  "/flows",
  "/agents",
  "/settings",
] as const;

/** Prefix match que no da falso positivo con p.ej. /inbox-archive. */
function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** True cuando `pathname` pertenece al dashboard autenticado. */
export function isDashboardPath(pathname: string): boolean {
  return DASHBOARD_PREFIXES.some((p) => matchesPrefix(pathname, p));
}

/**
 * Clave nav_* que gatea `pathname`, o null si la ruta no está
 * gobernada por el motor (no-dashboard, /inbox, /settings). El
 * middleware la usa para saber cuándo vale la pena consultar el
 * perfil.
 */
export function navPermissionKeyFor(pathname: string): PermissionKey | null {
  for (const [prefix, key] of Object.entries(NAV_PERMISSION_BY_PREFIX)) {
    if (matchesPrefix(pathname, prefix)) return key;
  }
  return null;
}

/**
 * Rol efectivo para decidir navegación cuando el perfil todavía no
 * resolvió: 'agent' (el tier default más restringido) — la UI falla
 * cerrada mientras carga, igual que useCan.
 */
function effRole(role: AccountRole | null): AccountRole {
  return role ?? "agent";
}

/**
 * ¿`role` + `overrides` pueden ABRIR `pathname`? Rutas fuera del
 * dashboard siempre sí (login, /join, marketing — no son asunto de
 * este módulo); /inbox y /settings siempre sí.
 */
export function canAccessPath(
  role: AccountRole | null,
  overrides: PermissionOverrides | null | undefined,
  pathname: string,
): boolean {
  if (!isDashboardPath(pathname)) return true;
  const key = navPermissionKeyFor(pathname);
  if (!key) return true; // /inbox, /settings
  return effectivePermission(effRole(role), overrides, key);
}

/**
 * ¿La entrada de sidebar que apunta a `href` se muestra? Igual que
 * canAccessPath salvo /settings: abrible por todos pero con fila
 * solo para roles no-agent (decisión de la sesión 1 — el agent
 * llega por el menú del avatar).
 */
export function showsInNav(
  role: AccountRole | null,
  overrides: PermissionOverrides | null | undefined,
  href: string,
): boolean {
  if (matchesPrefix(href, "/settings")) {
    return role !== "agent" && role !== null;
  }
  if (matchesPrefix(href, "/inbox")) return true;
  const key = navPermissionKeyFor(href);
  if (!key) return true;
  return effectivePermission(effRole(role), overrides, key);
}

/**
 * Página de aterrizaje: el Panel si el permiso nav_dashboard lo
 * habilita, si no la Bandeja (siempre accesible).
 */
export function homePathFor(
  role: AccountRole | null,
  overrides: PermissionOverrides | null | undefined,
): string {
  return effectivePermission(effRole(role), overrides, "nav_dashboard")
    ? "/dashboard"
    : "/inbox";
}
