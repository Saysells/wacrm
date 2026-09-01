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
  y el trabajo de las secciones "Roles y permisos" y "Bandeja" de
  abajo (sesiones 2026-08-31 y 2026-09-01, pedidas explícitamente
  por Eze). También `src/components/settings/tag-manager.tsx`, del que
  se extrajo `PRESET_COLORS` (ver abajo).
- **`.env.local`**: no existe en el repo y no se crea a mano; lo genera el
  instalador de la carpeta padre (`crm-whatsapp-instalador`).
- **Secretos**: la clave `service_role` de Supabase va SOLO en `.env.local` y
  en las variables del hosting; jamás en código, en el repo, en logs ni en un
  chat. Las variables dummy del CI (`.github/workflows/ci.yml`) se pasan
  inline en el comando cuando hace falta verificar localmente; nunca se
  escriben a un archivo.

# Bandeja

Sesión 2026-09-01 (pedida por Eze). Dos atajos que faltaban en la
Bandeja. Sin SQL: `contact_tags` y las tablas de plantillas ya existían.

## Etiquetas directas desde el sidebar de contacto

El sidebar solo LISTABA tags; poner una obligaba a ir a Contactos y
abrir "Editar contacto". Ahora la sección Tags tiene un popover
compacto "+ Agregar etiqueta" con las etiquetas de la cuenta que el
contacto todavía no tiene, y cada pastilla trae una X para sacarla.

- **Escritura**: reusa `POST/DELETE /api/contacts/[id]/tags` tal cual
  (vía `src/lib/contacts/tag-api.ts`). Ese endpoint ya valida tenencia
  de contacto y tag, trata el duplicado como no-op (unique
  `(contact_id, tag_id)`) y dispara los eventos `tag_added` de
  automatizaciones. **No hay una segunda forma de escribir
  `contact_tags`** y no debe haberla.
- **Lógica**: `src/lib/inbox/contact-tags.ts` — parte pura
  (`assignableTags`, `withTagAttached`, `withTagDetached`) separada de
  la parte con red (`attachTag`, `detachTag`), testeable sin DOM igual
  que `overrides-api.ts`.
- **Decisión**: la pastilla se identifica por `tag.id`, no por el id de
  la fila de `contact_tags`. La unique del par lo hace único dentro del
  contacto y lo tenemos en mano sin releer la tabla después de escribir.
- **Gate**: el control aparece solo con `canSendMessages` (agent+), el
  mismo rol que exige el endpoint, para que un viewer no vea un botón
  que le va a dar 403.

### Crear una etiqueta desde el mismo popover (sesión 2, 2026-09-01)

Debajo de la lista, un mini-formulario (nombre + los ocho
`PRESET_COLORS` + "Crear y aplicar"). Es **un solo paso**: la fila
queda en `tags` y la etiqueta queda aplicada al contacto abierto.

- **Escritura**: insert directo a `tags` con `account_id`, `user_id`,
  `name` y `color`, el mismo patrón que `handleCreate` de
  `tag-manager.tsx`. La tabla tiene RLS propia, así que **no hay ni
  debe haber** una API route dedicada. Se agrega `.select().single()`
  porque necesitamos el id para aplicarla en el mismo paso.
- **Aplicación**: sale por `attachTag`, el mismo camino que usar una
  etiqueta ya existente. No hay un segundo camino a `contact_tags`.
- **Gate distinto al de aplicar**: crear pide
  `canEditSettings` (**admin+**), porque la RLS `tags_insert` de la
  migración 017 pide `is_account_member(account_id, 'admin')`. Un
  agent puede aplicar las que existen pero no inventar una nueva; si
  el formulario estuviera gateado con `canSendMessages` el insert
  volvería rechazado por la base.
- **`PRESET_COLORS` extraído** a `src/lib/contacts/tag-colors.ts` (con
  `DEFAULT_TAG_COLOR`) e importado por `tag-manager.tsx` y por el
  sidebar: los dos lugares donde se crea una etiqueta ofrecen la misma
  paleta y ninguno la copia. Las claves i18n de los colores se derivan
  de `name` (`Settings.tagsAndFields.colors.*`), que el sidebar reusa
  en vez de duplicar los ocho nombres en tres idiomas.
- **Validación**: nombre vacío no inserta nada; nombre que ya existe en
  la cuenta (comparación sin espacios de borde y sin mayúsculas contra
  `accountTags`) tampoco, y avisa corto. El catálogo se actualiza en
  memoria y ordenado por nombre, así que el próximo contacto ya la ve
  sin recargar.
- **Si la creación anda pero la asociación falla**, `TagCreateError`
  viaja con `code: 'attach_failed'` y la etiqueta creada: la fila ya
  existe en `tags`, así que entra igual al catálogo en memoria en vez
  de perderse hasta el próximo fetch.

## "Nuevo mensaje" — arrancar un hilo con un número que no escribió

Botón en el encabezado de la Bandeja, al lado del buscador
(`conversation-list.tsx`), mismo gate `canSendMessages`.

- **Regla de Meta, no nuestra**: si el número nunca escribió primero,
  el primer mensaje TIENE que ser una plantilla aprobada, nunca texto
  libre. Si en Plantillas no hay ninguna aprobada, el selector sale
  vacío: eso es lo esperado, no un bug.
- **Ruta nueva**: `POST /api/inbox/conversations/resolve`
  (`requireRole('agent')`, bucket de rate limit propio
  `resolve-conv:<userId>`). Dos modos en una ruta porque comparten
  validación de teléfono y gate de tenencia: `{ phone }` **solo mira**
  (`findConversationByPhone`, no escribe nada) y
  `{ phone, name?, create: true }` hace find-or-create con el
  `resolveConversationByPhone` compartido con el webhook de entrada y
  la API pública (un contacto, un hilo). La versión con API key
  (`/api/v1/messages`) queda intacta.
- **Por qué el lookup no crea**: escribir un número y arrepentirse no
  debe dejar un contacto huérfano ni una conversación vacía. El
  `create: true` sale recién al enviar.
- **`findConversationByPhone`** (nuevo, en
  `src/lib/whatsapp/resolve-conversation.ts`): read-only, reusa
  `findExistingContact` y el mismo lookup oldest-first
  (`findConversationRow`, extraído y compartido por las tres rutas:
  lookup, find-or-create y el reintento de la carrera unique) para que
  todos coincidan en qué significa "ya tiene hilo".
- **Flujo cliente**: `src/lib/inbox/new-conversation.ts` —
  `isSendablePhone` (misma regla que la ruta: `sanitizePhoneForMeta` +
  `isValidE164`), `nextStepAfterLookup` (con hilo ⇒ abrir, sin hilo ⇒
  plantilla), `canSendNewMessage` (sin plantilla elegida no hay envío)
  y `startConversation` (un solo resolve, y el envío reusa ese
  `conversation_id`; si el resolve falla no se manda nada).
- **UI**: `src/components/inbox/new-message-dialog.tsx`. El
  `TemplatePicker` se reusa tal cual; mientras está abierto el diálogo
  de Nuevo mensaje se **oculta** (`open && !pickerOpen`), no se
  desmonta, para no apilar dos modales — el estado vive en el padre.
- **Apertura del hilo**: `handleOpenConversationId` en
  `inbox/page.tsx` trae la fila con `CONVERSATION_SELECT` (contacto
  joineado) si no está en la lista y la selecciona; el INSERT de
  realtime que llegue después dedupea contra `knownConvIdsRef`.

## Pendientes de esta sesión

- Ninguno de los dos flujos se probó en el navegador contra Meta real;
  los tests cubren la lógica, no el render ni el envío efectivo.
- El popover de etiquetas no tiene buscador: con cientos de etiquetas
  en la cuenta la lista se hace larga (scrollea, pero no filtra).
- **No hay unique `(account_id, name)` en `tags`** (agregarla es SQL,
  prohibido en estas sesiones). El chequeo de duplicados es del lado
  del cliente contra `accountTags`, así que dos personas creando el
  mismo nombre al mismo tiempo todavía pueden dejar dos filas. La
  solución real es un índice único + un 23505 tratado como
  "ya existe".
- El catálogo del sidebar (`accountTags`) se refresca al cambiar de
  contacto: una etiqueta que otra persona crea mientras tanto no
  aparece hasta ese momento.
- "Nuevo mensaje" no ofrece cargar un nombre para el contacto nuevo
  (la ruta acepta `name`, la UI todavía no lo expone); el contacto
  queda con el número como nombre, igual que los del webhook.
- Sin `@testing-library/react` en el repo (regla de no sumar librerías),
  los componentes nuevos no tienen test de DOM: lo verificado es la
  lógica extraída a `src/lib/inbox/*`.

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
