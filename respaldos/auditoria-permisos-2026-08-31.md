# Auditoría de consistencia — permisos granulares (2026-08-31, sesión 2, bloque 3)

Alcance: lugares que todavía calculen **nav**, **view_all_data** o **export**
mirando el rol a secas, fuera de lo tocado en el bloque 1; y confirmar que el
fetch del profile trae `permission_overrides`. Un hallazgo por línea:
archivo · causa · severidad.

## Hallazgos corregidos en este bloque

- `src/app/api/account/members/route.ts` · el roster GET no traía `permission_overrides`, así que la UI de permisos por miembro no podría mostrar el valor efectivo · **media** → corregido: se devuelve solo a admin+ (misma regla que `email`), `AccountMember` actualizado en `src/types/index.ts`.

## Verificado sin acción necesaria

- `src/hooks/use-auth.tsx` · el fetch del perfil trae `permission_overrides` y lo expone como `permissionOverrides` (bloque 1) · ok.
- `src/lib/auth/account.ts` · `getCurrentAccount()` trae `permission_overrides` en el contexto de las rutas API (bloque 1) · ok.
- `src/lib/dashboard/queries.ts` y toda lectura account-wide del cliente · corren bajo el cliente del usuario, y el RLS de las migraciones 040/041 (`can_view_by_assignment` → `effective_permission`) ya filtra por `view_all_data` efectivo en la base · ok.
- Rutas API con `requireRole('agent'|'admin'|'owner')` (enviar mensajes, settings, api-keys, members, transfer-ownership, AI, automations, flows, quick-replies) · gatean **capacidades de acción** que no son ninguna de las 10 claves del motor; siguen por rol a propósito (regla 6: no inventar claves) · ok.
- `src/components/auth/require-role.tsx`, `useCan` (salvo `export-contacts`), `settings-*`, `members-tab` (gate admin+) · misma razón: capacidades fuera de las 10 claves · ok.
- `src/components/inbox/message-bubble.tsx`, `message-actions.tsx`, `message-thread.tsx` (`isAgent`, `actor_type === "agent"`) · es `sender_type` del mensaje (agente vs. contacto), no el rol de cuenta · ok.
- `GET /api/v1/*` (API pública) · autentica por API key de cuenta (solo admin+ puede crearlas); el acceso es account-wide por diseño de la API, no un cálculo por rol · ok.

## Observaciones (baja severidad, sin acción)

- `src/middleware.ts` (redirect post-login) · un usuario logueado que cae en `/login` va a `/dashboard` hardcodeado; si no tiene `nav_dashboard`, el gate lo rebota a `/inbox` (dos redirects encadenados, funciona) · **baja**.
- `src/lib/inbox/auto-assign.ts` · la auto-asignación al responder sigue decidiendo por rol (`agent`); no existe clave de permiso para eso entre las 10 y la regla 6 prohíbe inventarla — si Eze quiere "auto-asignar" como permiso, es una clave nueva en una sesión futura · **baja**.

## Veredicto

Un hallazgo real (roster de members), corregido acá. El resto del repo calcula
nav/visibilidad/export a través de `effectivePermission` (bloque 1) o del RLS
040/041; los chequeos por rol que quedan son capacidades fuera de las 10 claves.
