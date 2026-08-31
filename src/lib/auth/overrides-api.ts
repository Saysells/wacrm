// ============================================================
// Cliente del endpoint de overrides por miembro. La parte pura
// (qué valor escribir) vive separada de la parte con red (el
// PATCH) para que ambas sean testeables sin DOM: tocar un
// checkbox = nextOverrideValue() → saveMemberPermissionOverride().
// ============================================================

import type { AccountRole } from "./roles";
import {
  effectivePermission,
  type PermissionKey,
  type PermissionOverrides,
} from "./permissions";

/**
 * Valor a escribir cuando se toca el checkbox de `key`: el opuesto
 * del valor EFECTIVO actual (lo que el usuario ve tildado), no del
 * override crudo — si no hay override, tocar el tilde crea uno que
 * invierte el default del rol.
 */
export function nextOverrideValue(
  role: AccountRole,
  overrides: PermissionOverrides | null | undefined,
  key: PermissionKey,
): boolean {
  return !effectivePermission(role, overrides, key);
}

/**
 * Persiste un override puntual (o lo borra con value: null → el
 * permiso vuelve al default del rol). Lanza Error con el mensaje
 * del servidor si el PATCH falla — el caller revierte su update
 * optimista y muestra el toast.
 */
export async function saveMemberPermissionOverride(
  userId: string,
  key: PermissionKey,
  value: boolean | null,
): Promise<void> {
  const res = await fetch(
    `/api/account/members/${encodeURIComponent(userId)}/permissions`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    },
  );
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(payload.error || "Failed to update permission");
  }
}
