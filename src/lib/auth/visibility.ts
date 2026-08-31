// ============================================================
// Visibilidad de datos por permiso — pura, testeable, sin I/O.
//
// Desde los permisos granulares (migración 041) la regla ya no es
// "el rol agent ve menos": es el permiso efectivo `view_all_data`.
// Quien NO lo tiene ve conversaciones sin asignar o propias, y no
// ve contactos cuyo hilo pertenece a otro; quien lo tiene ve todo.
// Los defaults reproducen la sesión 1 (agent filtrado, el resto
// no), pero un override lo cambia por persona: un admin con
// view_all_data:false queda filtrado como un agent.
//
// El espejo server-side es can_view_by_assignment() (RLS de las
// migraciones 040/041): la base ya rechaza las filas ajenas; estos
// filtros evitan pedirlas y mantienen los contadores coherentes.
// ============================================================

import type { AccountRole } from "./roles";
import {
  effectivePermission,
  type PermissionOverrides,
} from "./permissions";

/** ¿`role` + `overrides` ven todos los datos de la cuenta? */
function viewsAllData(
  role: AccountRole,
  overrides: PermissionOverrides | null | undefined,
): boolean {
  return effectivePermission(role, overrides, "view_all_data");
}

/**
 * Cláusula `.or()` de PostgREST que restringe una query de
 * `conversations` a lo visible, o null cuando no aplica filtro.
 * Con rol null no filtra: los consumidores esperan a que el perfil
 * resuelva (profileLoading) antes de disparar la query.
 */
export function conversationVisibilityFilter(
  role: AccountRole | null,
  overrides: PermissionOverrides | null | undefined,
  userId: string,
): string | null {
  if (role === null || viewsAllData(role, overrides)) return null;
  return `assigned_agent_id.is.null,assigned_agent_id.eq.${userId}`;
}

/**
 * Contraparte client-side del filtro para filas que llegan FUERA de
 * la query filtrada — eventos realtime, hidrataciones. Falla abierta
 * con rol null: en el primer render todavía no hay rol confiable y
 * ocultar todo vaciaría la bandeja; la query filtrada del servidor
 * es la fuente autoritativa.
 */
export function canSeeConversation(
  role: AccountRole | null,
  overrides: PermissionOverrides | null | undefined,
  userId: string | null,
  assignedAgentId: string | null | undefined,
): boolean {
  if (role === null || viewsAllData(role, overrides)) return true;
  if (assignedAgentId == null) return true;
  return assignedAgentId === userId;
}

/**
 * Ids de contacto que un usuario filtrado NO debe ver, derivados de
 * filas de `conversations` (`contact_id` + `assigned_agent_id`).
 * La propiedad del contacto se deriva de su conversación — no hay
 * columna de asignación en `contacts`.
 */
export function hiddenContactIds(
  rows: Array<{ contact_id: string; assigned_agent_id: string | null }>,
  userId: string,
): string[] {
  return rows
    .filter(
      (r) => r.assigned_agent_id !== null && r.assigned_agent_id !== userId,
    )
    .map((r) => r.contact_id);
}

/**
 * Valor de PostgREST para `.not('id', 'in', ...)` excluyendo `ids`,
 * o null cuando no hay nada que excluir (el caller saltea el filtro).
 */
export function contactExclusionList(ids: string[]): string | null {
  if (ids.length === 0) return null;
  return `(${ids.join(",")})`;
}
