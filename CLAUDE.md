@AGENTS.md

# Saysells · fork

- **Origen**: fork `Saysells/wacrm` de [ArnasDon/wacrm](https://github.com/ArnasDon/wacrm),
  commit base `6ed9191` (v0.8.x, 2026-08). Los cambios propios viven arriba de
  ese commit en `main`.
- **Idioma**: la beta sale en español rioplatense. `messages/es.json` es un
  espejo exacto de `messages/en.json` (mismas claves, placeholders, sintaxis
  ICU y etiquetas HTML; sin emojis). El locale NO se elige acá: lo fija el
  instalador de la carpeta padre vía `NEXT_PUBLIC_APP_LOCALE` en `.env.local`
  (ver `src/i18n/request.ts`; si el diccionario no existe cae a inglés en
  silencio).
- **Validador de catálogos**: `node scripts/i18n-check.mjs messages/en.json
  messages/es.json` debe terminar en 0 después de cualquier cambio en los
  mensajes. Sus pruebas: `node --test scripts/*.test.mjs` (en Node 25 el
  runner ya no acepta un directorio como argumento).
- **Qué no se toca**: `src/`, `supabase/`, `package.json` y
  `package-lock.json` no se modifican sin una sesión que lo pida
  explícitamente. Cambios propios hasta ahora: `messages/es.json`,
  `scripts/i18n-check.mjs`, `scripts/i18n-check.test.mjs`, este archivo,
  y el trabajo de la sección "Roles y permisos" de abajo (sesión
  2026-08-31, pedida explícitamente por Eze).
- **`.env.local`**: no existe en el repo y no se crea a mano; lo genera el
  instalador de la carpeta padre (`crm-whatsapp-instalador`).
- **Secretos**: la clave `service_role` de Supabase va SOLO en `.env.local` y
  en las variables del hosting; jamás en código, en el repo, en logs ni en un
  chat. Las variables dummy del CI (`.github/workflows/ci.yml`) se pasan
  inline en el comando cuando hace falta verificar localmente; nunca se
  escriben a un archivo.

# Roles y permisos

Sesión 1 (2026-08-31). Decisión de Eze: el rol `agent` (vendedores) ve una
app reducida — Bandeja, Notificaciones y Contactos — con asignación
automática al responder, contactos ajenos ocultos y exportación bloqueada.
Los roles ya venían del upstream (`owner`/`admin`/`agent`/`viewer` en
`src/lib/auth/roles.ts`, migración 017); esta sesión no agregó SQL.

## Qué se construyó

- **Navegación reducida** (`src/lib/auth/nav.ts`): el sidebar del agent
  muestra solo 3 entradas; el middleware redirige a `/inbox` cualquier ruta
  vedada (`/dashboard`, `/pipelines`, `/broadcasts`, `/automations`,
  `/flows`, `/agents`) consultando `profiles.account_role` solo en esas
  rutas. `/settings` queda accesible (perfil propio, vía menú de avatar)
  pero fuera del sidebar; sus secciones de cuenta ya se gatean solas.
- **Asignación automática** (`src/lib/inbox/auto-assign.ts` + route de
  envío): si un agent responde una conversación sin asignar, se la queda
  (el contacto se deriva de la conversación: NO hay columna de asignación
  en `contacts`). Nunca reasigna una asignada; owner/admin no capturan
  hilos al responder. El UPDATE va con guarda `.is('assigned_agent_id',
  null)` (carrera: gana el primero). La notificación sale gratis del
  trigger de la migración 027 (omite autoasignación).
- **Visibilidad** (`src/lib/auth/visibility.ts`): el agent ve
  conversaciones sin asignar o propias (query del inbox, realtime,
  hidratación y badge de no-leídos) y no ve contactos cuyo hilo es de otro
  agent. Owner/admin/viewer ven todo.
- **Export de contactos**: no existía ni botón ni endpoint. Se creó
  `GET /api/contacts/export` (CSV RFC 4180, paginado) gateado por el nuevo
  predicado `canExportContacts` (admin+; 403 para agent/viewer), y el botón
  "Exportar CSV" en Contactos visible solo para admin+ (claves i18n en
  en/es/ko).

## Decisiones tomadas

- La propiedad de un contacto se DERIVA de `conversations.assigned_agent_id`
  (relación 1:1 contacto↔conversación desde la migración 036). No se agregó
  columna a `contacts` porque requería SQL, prohibido en esta sesión.
- UI de navegación falla cerrada (rol sin resolver ⇒ menú reducido); el
  middleware falla abierto solo para perfiles pre-017 sin `account_role`
  (bloquearles /dashboard les rompería toda la app).
- El viewer conserva la vista completa (solo lectura); la reducción aplica
  únicamente al agent. Viewer tampoco puede exportar.

## Permisos granulares (sesión 2, 2026-08-31)

Eze tilda permisos POR PERSONA; el rol solo aporta defaults. Motor SQL:
`effective_permission(rol, overrides, clave)` + `profiles.permission_overrides`
(migración 041, aplicada). Espejo TS: `src/lib/auth/permissions.ts`
(`PERMISSION_KEYS`, `effectivePermission`) — **espejo EXACTO del CASE de la
041**: si cambia uno, cambia el otro en el mismo diff.

Las 10 claves (ninguna más; una clave nueva = migración + espejo):
`view_all_data`, `can_export_contacts`, `nav_dashboard`, `nav_notifications`,
`nav_contacts`, `nav_pipelines`, `nav_broadcasts`, `nav_automations`,
`nav_flows`, `nav_ai_agents`. Defaults: nav_notifications y nav_contacts
true para todos; can_export_contacts owner/admin; el resto owner/admin/viewer.
Override presente pisa el default; clave desconocida → false.

Dónde vive cada cosa:

- **Resolución**: `permissions.ts` (puro). Nadie lee claves del JSONB a mano.
- **Navegación**: `nav.ts` mapea sección → clave (`NAV_PERMISSION_BY_PREFIX`);
  `/inbox` siempre visible/accesible y `/settings` siempre accesible (no son
  claves). Sidebar filtra con `showsInNav(rol, overrides, href)`; el
  middleware bloquea la URL directa con `canAccessPath` consultando
  `profiles.account_role + permission_overrides` en toda ruta gobernada por
  una clave; `homePathFor` aterriza según `nav_dashboard` efectivo.
- **Visibilidad**: `visibility.ts` filtra por `view_all_data` efectivo (un
  admin con override false queda filtrado como agent; un agent con override
  true ve todo). El RLS 040/041 (`can_view_by_assignment`) aplica lo mismo
  en la base.
- **Export**: `GET /api/contacts/export` y el botón gatean por
  `can_export_contacts` efectivo (`useCan('export-contacts')`);
  `canExportContacts` se eliminó de `roles.ts`.
- **Overrides en contexto**: `use-auth.tsx` expone `permissionOverrides`;
  `getCurrentAccount()` lo trae para rutas API; el roster
  `GET /api/account/members` lo devuelve solo a admin+ (misma regla que
  email).
- **Escritura de overrides**: RPC `set_member_permission_override`
  (migración **042, generada y NO aplicada** — el RLS de profiles solo deja
  editar el propio perfil). La UI de Miembros + endpoint
  `PATCH /api/account/members/[userId]/permissions` quedaron en un **commit
  local sin push** (decisión de Eze): aplicar la 042 en Supabase y recién
  ahí `git push`.
- **Auditoría**: `respaldos/auditoria-permisos-2026-08-31.md`. Los
  `requireRole(...)` de acciones (enviar, settings, api-keys…) siguen por
  rol a propósito: no son ninguna de las 10 claves.

## Pendientes

- ~~RLS~~: resuelto por las migraciones 040/041 (`can_view_by_assignment`
  consulta `effective_permission`); los filtros de query del cliente quedan
  como optimización y para contadores coherentes.
- **Migración 042 sin aplicar**: hasta aplicarla, no hay forma de guardar
  overrides desde la UI; el bloque de UI de permisos espera en un commit
  local sin push.
- Con filtro de etiquetas activo, el total de contactos del agent puede
  sobrecontar (la RPC `filter_contacts_by_tags` no acepta exclusiones; la
  página filtra el resultado).
- La exclusión de contactos usa `.not('id','in',(...))`: con miles de
  contactos asignados a otros, la URL puede crecer demasiado. La solución
  real es la misma migración RLS.
- El export pagina de a 1000 sin límite superior; para cuentas enormes
  convendría streaming o un tope.
