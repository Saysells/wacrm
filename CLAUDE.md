@AGENTS.md

# Saysells · fork

- **Origen**: fork `Saysells/wacrm` de [ArnasDon/wacrm](https://github.com/ArnasDon/wacrm),
  commit base `6ed9191` (v0.8.x, 2026-08). Los cambios propios viven arriba de
  ese commit en `main`; el rediseño vive en la rama `rediseno` (ver abajo).
- **Idioma**: la beta sale en español rioplatense. `messages/es.json` es un
  espejo exacto de `messages/en.json` (mismas claves, placeholders, sintaxis
  ICU y etiquetas HTML; sin emojis). El locale NO se elige acá: lo fija el
  instalador de la carpeta padre vía `NEXT_PUBLIC_APP_LOCALE` en `.env.local`
  (ver `src/i18n/request.ts`; si el diccionario no existe cae a inglés en
  silencio).
- **Validador de catálogos**: `node scripts/i18n-check.mjs messages/en.json
  messages/es.json` debe terminar en 0 después de cualquier cambio en los
  mensajes. Sus pruebas: `node --test scripts/*.test.mjs` (en Node 25 el
  runner ya no acepta un directorio como argumento). `ko.json` se mantiene en
  paridad de claves con `en.json`: lo exige `src/i18n/messages.test.ts`.
- **Qué no se toca sin una sesión que lo pida explícitamente**: `supabase/`,
  `package.json` y `package-lock.json`; el webhook, el envío y las plantillas
  de WhatsApp del lado del servidor (`src/app/api/`); el puente con el CRM;
  los flujos; `src/lib/auth/` (roles y permisos); la vista del celular
  (`src/app/(movil)/`). Sin dependencias nuevas.
- **Matías tiene dos identidades y no se mezclan**: en la Bandeja
  (esta base) es `saysellsmatias@gmail.com`, y en el CRM Saysells, que
  es **otra** base, es `matias@saysells.com`. Las migraciones de este
  repo resuelven la cuenta y los traspasos por el **primero**.
- **Las migraciones están partidas en dos**: `supabase/migrations/` es el
  producto y va en toda instancia; `supabase/cuentas/<cuenta>/` es de una
  cuenta sola (flujos, crons, datos suyos) y la aplica `npm run migrar` según
  `CUENTA` en `credenciales.env`. Nada específico de una cuenta —un email, una
  URL, un flujo— vuelve nunca a `migrations/`: ahí revienta la instancia nueva.
- **Numeración**: producto y cuentas comparten el espacio de versiones, porque
  las aplicadas se registran por número (`schema_migrations.version`), no por
  ruta. Entonces: `migrations/` sigue **desde 055** y los números **050 a 054 no
  se reutilizan nunca**; las carpetas `cuentas/<cuenta>/` de instancias nuevas se
  numeran **desde 900**. Kosmo conserva 050–054 porque esas versiones ya están en
  su `schema_migrations` y renumerarlas obligaría a reaplicar la 050, que es
  destructiva. Si dos archivos comparten número, `npm run migrar` avisa: el
  segundo no va a correr nunca.
- **`.env.local`**: no existe en el repo y no se crea a mano; lo genera el
  instalador de la carpeta padre (`crm-whatsapp-instalador`). Tiene secretos:
  no se abre, no se imprime, no se copia.
- **Secretos**: la clave `service_role` de Supabase va SOLO en `.env.local` y
  en las variables del hosting; jamás en código, en el repo, en logs ni en un
  chat. Las variables dummy del CI (`.github/workflows/ci.yml`) se pasan
  inline en el comando cuando hace falta verificar localmente; nunca se
  escriben a un archivo.
- **Cierre de toda sesión**: `npm run typecheck`, `npm run lint` (0 errores y
  no más warnings que la línea base: 35), `TZ=UTC npm test` (los 3 rojos de
  `currency.test.ts` ya estaban), el validador de mensajes y `npm run build`.

Historia (quién pidió qué, archivos tocados por sesión):
`respaldos/claude-md-historia-2026-10-12.md`, sección «Saysells · fork».

# Reglas de código

- **base-ui**: todo `DropdownMenuLabel` va dentro de un `DropdownMenuGroup`
  (es el `Menu.GroupLabel` y tira error suelto: issue #336) y todo
  `SelectLabel` dentro de un `SelectGroup`. `src/components/ui/
  menu-label-grouping.test.ts` recorre los `.tsx` de `src/` y falla si no.
  Revisar cada menú, popover o diálogo nuevo contra lo que pide base-ui.
- **Realtime**: un canal por instancia, nombre único por llamada
  (`uniqueChannelName` en `src/lib/realtime/channel-name.ts`). Nunca un
  nombre fijo en un hook que pueda vivir en dos lugares:
  `supabase.channel(nombre)` devuelve el canal existente y
  `.on("postgres_changes")` tira error si ya se está uniendo.
- **Cargas**: cada corrida pide siempre y gana la respuesta más nueva por
  número de pedido (`src/lib/inbox/load-sequence.ts`); nunca un guard que
  pueda descartar una respuesta sin que otro pedido la reemplace. Para
  relecturas por conversación, `src/lib/inbox/hydrate-queue.ts`: una lectura a
  la vez y, si se pidió otra mientras tanto, una sola más al terminar.
- **Lógica nueva en funciones puras** de `src/lib/` con pruebas (vitest);
  los componentes solo piden y pintan. Sin `@testing-library/react` en el
  repo, no hay tests de DOM.
- **Una sola forma de escribir cada tabla**: `contact_tags` solo por
  `POST/DELETE /api/contacts/[id]/tags` (`src/lib/contacts/tag-api.ts`);
  `tags` por insert directo con RLS (admin+); notas con el insert de
  `contact_notes`.
- **Sistema de diseño** (rediseño): cero emojis, íconos de lucide-react.
  Estados y etiquetas en rectángulos de 5 px, nunca pastillas. Navy para la
  acción principal, celeste para lo seleccionado, naranja solo para lo que
  espera respuesta. Filtros como desplegables estilo Attio. Nada de
  `window.prompt`, `confirm` ni `alert`: modales con cruz visible y clic
  afuera bloqueado. Textos en español rioplatense con voseo, en
  `messages/es.json` con espejo en `en.json` y `ko.json`.

# Bandeja

## Etiquetas desde la ficha del contacto

La ficha (hoy `side-panel.tsx`) lista las etiquetas del contacto, aplica
las que faltan con un popover y las saca con una cruz.

- **Escritura**: reusa `POST/DELETE /api/contacts/[id]/tags` tal cual
  (vía `src/lib/contacts/tag-api.ts`). Ese endpoint ya valida tenencia
  de contacto y tag, trata el duplicado como no-op (unique
  `(contact_id, tag_id)`) y dispara los eventos `tag_added` de
  automatizaciones. **No hay una segunda forma de escribir
  `contact_tags`** y no debe haberla.
- **Lógica**: `src/lib/inbox/contact-tags.ts` — parte pura
  (`assignableTags`, `withTagAttached`, `withTagDetached`,
  `groupAssignableTags`, `orderAttachedTags`) separada de la parte con red
  (`attachTag`, `detachTag`, `createAndAttachTag`).
- **Gate**: aplicar pide `canSendMessages` (agent+, el mismo rol del
  endpoint). **Crear** una etiqueta desde el popover pide `canEditSettings`
  (admin+): la RLS `tags_insert` de la migración 017 pide
  `is_account_member(account_id, 'admin')`. Es un solo paso (insert en
  `tags` con `.select().single()` y después `attachTag`); si la asociación
  falla, `TagCreateError` viaja con `code: 'attach_failed'` y la etiqueta
  creada entra igual al catálogo en memoria.
- `PRESET_COLORS` y `DEFAULT_TAG_COLOR` viven en
  `src/lib/contacts/tag-colors.ts` (los usan `tag-manager.tsx` y la ficha);
  las claves i18n de los colores se derivan de `name`
  (`Settings.tagsAndFields.colors.*`).
- Duplicados: el chequeo de nombre es del lado del cliente contra
  `accountTags` (no hay unique `(account_id, name)` en `tags`).

## "Nuevo mensaje" — arrancar un hilo con un número que no escribió

Botón de la barra lateral (`canSendMessages`); diálogo
`src/components/inbox/new-message-dialog.tsx`.

- **Regla de Meta, no nuestra**: si el número nunca escribió primero,
  el primer mensaje TIENE que ser una plantilla aprobada, nunca texto
  libre. Si en Plantillas no hay ninguna aprobada, el selector sale
  vacío: eso es lo esperado, no un bug.
- **Ruta**: `POST /api/inbox/conversations/resolve`
  (`requireRole('agent')`, bucket de rate limit propio
  `resolve-conv:<userId>`). `{ phone }` **solo mira**
  (`findConversationByPhone`, no escribe nada) y
  `{ phone, name?, create: true }` hace find-or-create con el
  `resolveConversationByPhone` compartido con el webhook de entrada y
  la API pública (un contacto, un hilo). El lookup no crea para que
  escribir un número y arrepentirse no deje un contacto huérfano.
- **`findConversationByPhone`** (`src/lib/whatsapp/resolve-conversation.ts`):
  read-only, reusa `findExistingContact` y el mismo lookup oldest-first
  (`findConversationRow`) que find-or-create y el reintento de la carrera
  unique.
- **Cliente**: `src/lib/inbox/new-conversation.ts` — `isSendablePhone`
  (`sanitizePhoneForMeta` + `isValidE164`), `nextStepAfterLookup`,
  `canSendNewMessage` y `startConversation` (un solo resolve; si falla no
  se manda nada). El `TemplatePicker` se reusa; mientras está abierto el
  diálogo se **oculta**, no se desmonta.
- El popover de etiquetas no tiene buscador; "Nuevo mensaje" no expone el
  `name` que la ruta acepta (el contacto queda con el número como nombre).

Historia: `respaldos/claude-md-historia-2026-10-12.md`, sección «Bandeja».

# Integración Tally

El embudo real de Kosmo: anuncio en Meta → kosmo.click → formulario de
Tally → página de gracias con botón de WhatsApp → número de Kosmo. Cuando
el lead escribe, la ficha ya tiene sus respuestas; si nunca escribe, el
contacto existe igual, etiquetado, para escribirle con plantilla.

## Normalizador de teléfono argentino

`src/lib/phone/normalize-ar.ts` — `normalizeArgentinePhone(raw)`. El
formulario manda `+54 11 XXXX-XXXX` sin el 9; WhatsApp entrega `549` +
área + número. Lleva todo a la forma canónica de WhatsApp: saca el `0`
de larga distancia y el `15` (probando áreas de 2, 3 y 4 dígitos) e
inserta el `9` si falta. Lo que no se entiende como argentino sale como
dígitos sin tocar (doble chequeo de largo 10 y prefijo `11`/`2`/`3`);
nunca se adivina un país. Se usa en los **tres** caminos que crean o
buscan contacto por teléfono (webhook de Meta, "Nuevo mensaje" y el
receptor de Tally) y **no cambia ninguna llamada a Meta**. Asume que un
`+54` de 10 dígitos es móvil: un fijo con WhatsApp Business quedaría con
un `9` de más.

## Receptor: `POST /api/integrations/tally`

`src/app/api/integrations/tally/route.ts` +
`src/lib/integrations/tally/{signature,payload,ingest}.ts`.

- **Firma**: `Tally-Signature` = `base64(HMAC-SHA256(TALLY_SIGNING_SECRET,
  cuerpo crudo))`, sobre el **body crudo** (`await request.text()`), nunca
  sobre el JSON reserializado. Sin firma o inválida → 401. Falla cerrado
  si falta la variable.
- **Idempotencia**: `data.responseId` se guarda como campo personalizado
  `tally_response_id`; Tally **reintenta**, así que el mismo envío llega
  más de una vez de forma normal. Un envío distinto del mismo teléfono
  actualiza, no duplica.
- **Base**: cliente admin del servidor (service_role), el mismo que el
  webhook de Meta. **Cuenta destino**: `TALLY_ACCOUNT_ID` si está; si no,
  la **única** fila de `whatsapp_config`; con 0 o ≥2 filas y sin la
  variable, error explícito.
- **Contacto**: find-or-create por `findOrCreateContact` de
  `@/lib/api/v1/contacts`. Si ya existía, se pisa solo lo que el
  formulario trajo con contenido. **Etiqueta** `origen_form`: se crea si
  no existe y se aplica con `addContactTagAndDispatch`.
- **Códigos**: 401 firma; 400 no es JSON o falta `data.responseId`;
  422 sin teléfono usable (no se crea nada); 200 procesado, duplicado o
  `eventType` que no es `FORM_RESPONSE`.
- **Debug**: `TALLY_DEBUG_PAYLOAD=1` loguea UN payload crudo por proceso.
  Apagarlo apenas verificado: trae datos personales.

## Mapeo de campos

La clave de unión es el **label** de la pregunta, no el `key`, comparado
normalizado (sin acentos, sin signos, minúscula, un solo espacio).

| Label (formulario) | Destino |
| --- | --- |
| `Nombre` (1.ª ocurrencia) + `Apellido` (1.ª) | `contacts.name` |
| `Nombre` (2.ª ocurrencia, en el CSV "Nombre (2)") | campo `cuit_dni` |
| `WhatsApp` | `contacts.phone` (normalizado) |
| `Email` | `contacts.email` |
| `Nombre de tu tienda` *(versión vieja)* | `contacts.company` |
| `¿Vendés por tienda online?` | campo `tienda_online` |
| `¿Qué volumen invertís en restock por mes?` | campo `volumen_restock` |
| `¿En qué provincia estás?` | campo `provincia` |
| `¿Qué tipo de negocio tenés?` | campo `tipo_negocio` |
| `Contanos brevemente de tu local` *(versión vieja)* | campo `descripcion_local` |
| `utm_source` / `utm_medium` / `utm_campaign` / `utm_content` | campos homónimos |
| *(derivados)* | `tally_response_id`, `tally_submitted_at` |

- **"Nombre" está dos veces**: el primero (por orden en `fields[]`) es la
  persona, el segundo es el CUIT/DNI. Como guarda, si lo que iría a
  `contacts.name` es solo dígitos, guiones, puntos o espacios
  (`looksLikeIdentifier`) no se usa como nombre y se guarda como
  `cuit_dni`. Mismo criterio para "Apellido".
- En preguntas de opción, `value` viene como **id** con el texto en
  `options[]`: se resuelve a texto. Un label que **no** está en la tabla
  se ignora. Las definiciones de `custom_fields` se crean si faltan
  (comparando sin mayúsculas); los valores van con `upsert` sobre la
  unique `(contact_id, custom_field_id)`.

## Variables de entorno

| Variable | Obligatoria | Para qué |
| --- | --- | --- |
| `TALLY_SIGNING_SECRET` | sí | Verificar la firma. Sin ella el receptor rechaza todo (falla cerrado). |
| `TALLY_ACCOUNT_ID` | solo con ≥2 cuentas | Cuenta destino de los leads. |
| `TALLY_DEBUG_PAYLOAD` | no | `1` loguea un payload crudo. Apagar después. |
| `NEXT_PUBLIC_APP_NAME` | no | Nombre de la app; default `CRM By Saysells`. |
| `SELECTOR_BANDEJAS` | no | `Nombre\|URL\|Grupo,Nombre\|URL` (URL vacía = próximamente; Grupo opcional). Sin ella no hay selector de bandejas. Ver "Rediseño". |
| `SELECTOR_EQUIPO` | no | Mails separados por coma que ven el selector y el lanzador. Sin ella nadie los ve. |

## "Datos del formulario" en la ficha

`src/lib/inbox/contact-form-values.ts` (`pairFieldValues` puro,
`loadContactFormValues` con red). Solo lectura: lista los
`contact_custom_values` del contacto y se oculta si no tiene ninguno;
ante un error de lectura devuelve vacío. Se muestra el `field_name` tal
cual. **Se ocultan los campos `tally_*`** por prefijo (`isSystemField`);
siguen visibles en Contactos → Editar contacto.

## Nombre de la app por variable

`src/lib/app-name.ts` — `NEXT_PUBLIC_APP_NAME`, default `CRM By Saysells`.
Lo usan `layout.tsx` (metadata) y la barra. No se traduce (`Sidebar.title`
ya no existe en los catálogos). Cambiarlo en Vercel pide **redeploy**.

Historia y pendientes: `respaldos/claude-md-historia-2026-10-12.md`,
sección «Integración Tally».

# API v1 · etiquetas por PATCH

`setContactTags` (`src/lib/api/v1/contacts.ts`): `desired` se arma
únicamente con los nombres recibidos en `tagNames`, buscados en el mapa
de `resolveImportTagIds` con la misma normalización (`trim` + minúsculas).
El mapa trae **todas** las etiquetas de la cuenta: es un índice de
búsqueda, nunca la lista de lo que hay que aplicar. Guarda:
`src/lib/api/v1/contacts.test.ts`.

Historia: `respaldos/claude-md-historia-2026-10-12.md`, sección «API v1».

# Etiquetas de estado (`tags.grupo`)

Migración **046**: `tags.grupo` es `'estado' | 'origen' | 'senal' | null`
(CHECK en la base). Las 13 etiquetas de **estado** siguen el embudo del
setter: Nuevo, En gestión, No responde, Agendado a Paola, Agendado a
Gustavo, Agendada, No se presentó, Reagendado, Realizada, Propuesta,
En negociación, Ganada, Perdido. `origen_*` y `senal_*` (bot de Kosmo)
llevan grupo `origen` / `senal`; el resto queda en `null`.

- **La regla de "una sola de estado por contacto" vive en la base**
  (trigger `trg_single_etapa_tag`, por `grupo = 'estado'`), y el aviso al
  CRM (`trg_notify_crm_on_etapa_tag`) también. El frontend no la replica:
  `withTagAttached` saca del estado local el estado anterior y después
  relee.
- **Dónde se conoce el grupo**: `Tag.grupo` en `src/types/index.ts`;
  `src/lib/contacts/tag-groups.ts` (`ESTADO_FUNNEL`, `isEstadoTag`,
  `sortByFunnel`, `findEstadoTag`, `estadoRank`).
- **Configuración → Etiquetas**: muestra el grupo, ofrece un selector al
  crear, las de estado no se borran desde la UI, y filtra por
  `account_id` (cualquier admin ve las 13 de estado).
- **API v1**: cada tag de `/contacts` y `/conversations` trae `grupo`
  (`serializeTag`).

## Fecha de la llamada y realtime

Migración **047**: `contacts.fecha_llamada` (timestamptz) y
`tags.requiere_fecha` (true en Agendado a Paola, Agendado a Gustavo,
Agendada y Reagendado). `contact_tags` y `contacts` entran en la
publicación `supabase_realtime`. El trigger del puente manda
`fecha_llamada` al CRM junto con la etiqueta.

- **Primero la fecha, después la etiqueta. No es negociable.** El aviso
  al CRM sale del INSERT en `contact_tags` y lee `contacts.fecha_llamada`.
  `scheduleWithDate` (`src/lib/inbox/fecha-llamada.ts`) guarda la fecha
  con un update directo (RLS `contacts_update`, agent+) y recién después
  llama a `attachTag`; si guardar falla, no aplica nada. Hay un test que
  fija ese orden. El modal de hoy es "Agendar llamada" (ver Rediseño).
- **API v1**: `PATCH /api/v1/contacts/{id}` acepta `fecha_llamada`
  (ISO 8601, se normaliza a UTC, o null; otro tipo → 400) vía
  `parseContactUpdates`; `serializeContact` la expone. Es el camino de
  vuelta CRM → Bandeja.
- **Realtime de la ficha**: `subscribeToContactChanges`
  (`src/lib/inbox/contact-realtime.ts`) arma un canal por contacto
  (`contact_tags` INSERT/DELETE, `contacts` UPDATE). Desde el rediseño la
  ficha lee la fila del store, que tiene su propio canal.

Historia: `respaldos/claude-md-historia-2026-10-12.md`, sección
«Etiquetas de estado».

# Roles y permisos

Los roles vienen del upstream (`owner`/`admin`/`agent`/`viewer` en
`src/lib/auth/roles.ts`, migración 017). Decisión de Eze: el `agent`
(vendedores) ve una app reducida, con asignación automática al responder,
contactos ajenos ocultos y exportación bloqueada.

- **Navegación** (`src/lib/auth/nav.ts`): `NAV_PERMISSION_BY_PREFIX` mapea
  sección → clave; `/inbox` siempre visible y `/settings` siempre
  accesible. La barra filtra con `showsInNav(rol, overrides, href)`; el
  middleware bloquea la URL directa con `canAccessPath` y `homePathFor`
  aterriza según `nav_dashboard`. La UI falla cerrada (rol sin resolver ⇒
  menú reducido); el middleware falla abierto solo para perfiles pre-017.
- **Asignación automática** (`src/lib/inbox/auto-assign.ts` + route de
  envío): si un agent responde una conversación sin asignar, se la queda;
  nunca reasigna una asignada; owner/admin no capturan. El UPDATE va con
  guarda `.is('assigned_agent_id', null)`. La notificación sale del
  trigger de la migración 027.
- **Visibilidad** (`src/lib/auth/visibility.ts`): filtra por
  `view_all_data` efectivo; el agent ve conversaciones sin asignar o
  propias y no ve contactos cuyo hilo es de otro (la propiedad se DERIVA
  de `conversations.assigned_agent_id`, 1:1 desde la migración 036). El
  RLS 040/041 (`can_view_by_assignment`) aplica lo mismo en la base.
- **Export**: `GET /api/contacts/export` (CSV RFC 4180, paginado de a
  1000) gateado por `can_export_contacts` efectivo (`useCan('export-contacts')`).

## Permisos granulares

Eze tilda permisos POR PERSONA; el rol solo aporta defaults. Motor SQL:
`effective_permission(rol, overrides, clave)` + `profiles.permission_overrides`
(migración 041). Espejo TS: `src/lib/auth/permissions.ts`
(`PERMISSION_KEYS`, `effectivePermission`) — **espejo EXACTO del CASE de la
041**: si cambia uno, cambia el otro en el mismo diff.

Las 10 claves (ninguna más; una clave nueva = migración + espejo):
`view_all_data`, `can_export_contacts`, `nav_dashboard`, `nav_notifications`,
`nav_contacts`, `nav_pipelines`, `nav_broadcasts`, `nav_automations`,
`nav_flows`, `nav_ai_agents`. Defaults: nav_notifications y nav_contacts
true para todos; can_export_contacts owner/admin; el resto owner/admin/viewer.
Override presente pisa el default; clave desconocida → false. Nadie lee
claves del JSONB a mano. `use-auth.tsx` expone `permissionOverrides`;
`getCurrentAccount()` lo trae para rutas API; el roster
`GET /api/account/members` lo devuelve solo a admin+. Los
`requireRole(...)` de acciones siguen por rol a propósito.

- **Escritura de overrides**: RPC `set_member_permission_override`
  (migración **042, generada y NO aplicada**). La UI de Miembros + endpoint
  `PATCH /api/account/members/[userId]/permissions` esperan en un commit
  local sin push: aplicar la 042 y recién ahí `git push`.
- Con filtro de etiquetas, el total de contactos del agent puede
  sobrecontar (la RPC `filter_contacts_by_tags` no acepta exclusiones).

Historia: `respaldos/claude-md-historia-2026-10-12.md`, sección «Roles y
permisos».

# Flujos · nodos, timeout y el bot de Kosmo

Migraciones **048** (nodos + cola), **049** (reentrada + beta), **050** (el
flujo de Kosmo), **052** y **053** (seguimiento del catálogo). El bot de
primer contacto está en producción desde el 02/09/2026.

## Nodos

- **`wait`** (`{ seconds, next_node_key }`): suspende la corrida N segundos.
  **No es un `setTimeout`**: la espera se encola en `flow_pending_resumes`
  y la drena el cron (`/api/flows/cron`, cada minuto por pg_cron). La
  corrida queda estacionada en el propio nodo `wait`. Capado a 1 hora
  (`MAX_WAIT_SECONDS` en `validate.ts`); para pausas largas, el timeout.
- **`classify_reply`**: interpreta texto libre y ramifica
  (`src/lib/flows/classify.ts`, puro). Compara **por palabra o frase
  completa**; evalúa **extra → negativo → positivo → desconocido**; el
  desconocido tiene su propia salida (`unknown_next`). Con `prompt_text`
  pregunta y espera; sin él clasifica el último mensaje del cliente.
- **`handoff` con `next_node_key`**: traspasa igual (asignación, nota,
  conversación pendiente, evento) pero la corrida queda **activa** y avanza
  a ese nodo; sin la clave cierra como siempre (`handed_off`). En el canvas
  muestra handle de salida solo con destino. Sin formulario: se carga por
  JSONB, igual que el `timeout` por nodo.
- **Archivos en medio del guion** viajan como `kind: 'media'` y una corrida
  activa que recibe uno traspasa con la nota "Mandó un archivo".

## Variables del contacto

`{{contact.nombre}}`, `{{contact.nombre_coma}}` (" Juan," / ","),
`{{contact.coma_nombre}}` (", Juan" / ""), `{{contact.tipo_negocio}}`
(minúscula, o "tu negocio"), y cualquier `{{contact.<field_name>}}` de un
campo personalizado de la cuenta. Un contacto que **se llama como su
teléfono** NO tiene nombre. La lectura es perezosa; `handoff.note`
interpola como cualquier texto (`src/lib/flows/interpolate.ts`).

## Timeout

`fallback_policy.on_timeout` = `{ action: 'tag_and_end' | 'handoff' |
'goto', tag_id?, note?, next_node_key? }`. Default `tag_and_end` sin
etiqueta. Cada nodo que espera puede sobreescribirlo con `timeout: {
hours, action, tag_id?, note?, next_node_key? }`, campo por campo. **`goto`
es la única que no cierra la corrida**: avanza a `next_node_key` y la deja
`active`; un `goto` sin destino se degrada a la acción de la política
(`resolveTimeoutAction`, `resolveTimeout`). El validador exige que el
destino exista. `applyFlowTimeout` **clava primero el estado final** con
la precondición `status='active'` y recién después hace los efectos
visibles, para que dos pasadas del cron no etiqueten dos veces.

## Reentrada tras "No responde"

`src/lib/inbox/reentrada.ts`, desde el webhook al lado de
`reopenClosedConversation`. Un contacto marcado "No responde" que vuelve
a escribir: se le pone "En gestión" **antes** de sacar "No responde" (el
trigger borra la anterior al insertar), y la conversación vuelve a
pendiente asignada a `accounts.agente_reentrada` (en NULL queda sin
dueño), aunque ya tuviera agente. Cuesta una consulta en el caso común.
El bot no se reinicia: su disparador es el primer mensaje entrante.

## El flujo de Kosmo y el seguimiento del catálogo

19 nodos: `wait` 25 s → "En gestión" → los cuatro pasos del guion. Las
etiquetas se resuelven **por nombre dentro de la cuenta** y Matías **por
email**; ningún UUID a mano. Idempotente y **no destructiva**: si el flujo
existe por nombre se reemplaza su contenido conservando la fila (los
`node_key` no cambian). **Ojo con el orden**: la 050 borra y reinserta
TODOS los nodos, así que si se vuelve a correr hay que correr detrás la
052 y la 053.

Rama de la lista:

```
paso3_no (senal_prefiere_chat) → paso3_lista_msg
  → traspaso_lista   handoff a Matías, next_node_key: lista_cierre — SIGUE
  → lista_cierre     "Cualquier duda o consulta me avisás."
       cualquier respuesta → fin_lista (end)
       24 h de silencio    → timeout goto → seguimiento
  → seguimiento      "Hola{{contact.nombre_coma}} ¿pudiste ver el catálogo?…"
       sí                  → paso4 (el rango horario, ya existía)
       no / no se entiende → traspaso_no_quiere
       24 h de silencio    → timeout handoff, "No respondió al seguimiento
                             del catálogo"
  → traspaso_no_quiere  handoff a Matías, "Vio el catálogo, no quiere
                        llamada". Terminal.
```

- Si Matías contesta en esas 24 horas, la corrida pasa a `paused_by_agent`
  (`send-message.ts`) y el seguimiento no sale (hay test). El seguimiento
  sale una sola vez; un lead que no contesta tiene la corrida viva ~48 h
  ocupando el índice de una-corrida-por-contacto.
- `src/lib/flows/flujo-kosmo.test.ts` y `seguimiento-catalogo.test.ts`
  **parsean el SQL** (050, 052, 053 en orden) y verifican que toda
  referencia entre nodos cierre y que el grafo pase el validador.
- La señal `senal_lead_grande` del formulario no es parte del bot: es una
  automatización por `tag_added`.

Historia: `respaldos/claude-md-historia-2026-10-12.md`, secciones «Flujos»
y «Seguimiento del catálogo».

# Marca · acento Saysells e íconos

## El acento `saysells`

Sexto acento de `src/lib/themes.ts` y **`DEFAULT_THEME`**; los otros cinco
siguen en el selector (el boot script de `layout.tsx` filtra por
`THEME_IDS`). Es el único acento que cambia con el modo. Desde el
rediseño, `:root` siembra claro + saysells y el acento quedó al revés:
navy plano `#1C2B48` como base, navy elevado como override de
`data-mode="dark"`.

| Token | Oscuro | Claro (default) |
| --- | --- | --- |
| `--primary` | `oklch(0.55 0.15 263)` navy elevado | `oklch(0.291 0.057 262.6)` navy `#1C2B48` |
| `--primary-foreground` | blanco, **4.75:1** | casi blanco, **13.5:1** |
| `--primary-hover` | `oklch(0.62 0.14 263)` | `oklch(0.36 0.062 262.6)` |
| `--primary-soft` / `-2` | celeste `/0.12` y `/0.22` | navy `/0.1` y `/0.18` |
| `--ring`, `--sidebar-ring` | celeste `#8EB1D1` | navy |
| `--chart-2` | naranja `#E84419` | naranja `#E84419` |

- El navy `#1C2B48` no sirve de relleno en oscuro (desaparece sobre las
  superficies negras) y el celeste tampoco como primario (deja las
  burbujas enviadas en pastel): el celeste queda en `--primary-soft` y el
  anillo de foco. El naranja aterriza solo en `--chart-2`. `--background`
  es un token de MODO, compartido por los seis acentos.
- ACCENT y MODE escriben variables disjuntas (`globals.css`); el bloque
  `html[data-mode][data-theme="saysells"]` toca tokens de acento nada más.

## `WhatsAppGlyph` y favicon

`src/components/brand/whatsapp-glyph.tsx`: una sola definición del glifo
(bocadillo con cola y tubo calado con `fill-rule: evenodd`), pintado con
`currentColor`; el tubo es un agujero, así que el mismo marcado sirve
sobre cualquier fondo sin nombrar un color. `src/app/icon.tsx` importa el
path (`WHATSAPP_GLYPH_PATH`), no el componente: `ImageResponse` renderiza
por satori. Cuadrado navy `#1C2B48` hardcodeado a propósito (es un PNG de
build). La versión de contorno no sirve a 32×32. `MessageSquare` sigue en
la barra como ícono de la Bandeja, no como marca.

Historia: `respaldos/claude-md-historia-2026-10-12.md`, sección «Marca».

# Rediseño

Rama `rediseno`, salida de `main`; se publica solo en la Bandeja USA
hasta el merge final. Referencia: `docs/rediseno/prototipo-v1.html`
(aprobado el 12/10/2026). Regla: **cambia el frontend, la lógica no**
(ver "Qué no se toca"). Sesiones A (base y barra), B (navegación y lista),
C (conversación), D (ficha y agendar), E (closer y teclado), F1
(Contactos, Notificaciones, diferencias) y F2 (el resto de las pantallas,
13/10/2026) hechas: queda el merge a `main`.

## Base y tokens

- **Outfit** por `next/font/google` (`layout.tsx`), variable `--font-sans`.
  **Modo claro por defecto** (`DEFAULT_MODE`); quien ya eligió uno lo
  conserva. El modo oscuro anda pero no se rediseñó; las clases `dark:`
  de shadcn siguen sin aplicar (`.dark` nadie lo pone).
- **Tokens semánticos** en los dos modos, mapeados a Tailwind: `selected`
  / `selected-strong` (celeste suave), `hover` / `hover-strong`, `pending`
  (naranja, **solo** lo que espera respuesta), `unread`, `success` /
  `warning` / `danger` / `info` / `neutral` con su `-soft`, `bubble-in`;
  `shadow-menu` y `shadow-card`. Modo claro: fondo `#F4F6F8`, tarjeta
  blanca, línea `#E5E9EF`, tinta navy.
- **Estructura** (`src/app/(dashboard)/dashboard-shell.tsx`): grilla
  `4rem + 1fr`; barra lateral sobre el fondo gris sin panel; el contenido
  de cada pantalla en **una tarjeta blanca de 16 px** que scrollea
  (`main` con `p-4 sm:p-6`). Bandeja, Contactos y Notificaciones ocupan la
  tarjeta entera con `-m-4 h-[calc(100%+2rem)] sm:-m-6 sm:h-[calc(100%+3rem)]`.
  A la derecha, el riel (`side-rail.tsx`, 56 px, solo `lg`).
- **`src/components/ui/`**: botón de 38 px navy con hover (`sm` 34);
  **badge en rectángulo de 5 px** con variantes `success` / `warning` /
  `danger` / `info` / `selected` / `pending`; campos de 40 px con foco
  celeste sin halo; menús, select y popover con panel de 14 px,
  `shadow-menu`, sin padding y filas de borde a borde; **modales**
  (`dialog`, `sheet`) de 20 px con cruz visible de 40 px y **clic afuera
  bloqueado** (`disablePointerDismissal` por defecto; el velo sacude el
  modal con `.modal-shake`). Escape cierra. `DialogFooter` sangra `-mx-6`.
- Chips de estado: tinta de `GROUP_COLORS` sobre `tagTint` (color-mix al
  15 %, porque `tags.color` es un string libre). Avatares: `avatarColors`
  / `initialsOf` (`vistas.ts`) y los componentes `NameAvatar`,
  `MiniAvatar`, `UnassignedMark` de `src/components/inbox/avatars.tsx`.

## Barra superior y selector (`top-bar.tsx`)

Reemplazó a `header.tsx` y `mode-toggle.tsx` (i18n `TopBar`). Menú (mobile
abre el cajón, escritorio pliega la barra: `useSidebarCollapsed`, store
externo en `localStorage` `wacrm:layout:sidebar-collapsed` leído con
`useSyncExternalStore`), marca, **selector de bandeja**, buscador
(en la Bandeja filtra mientras se escribe vía `useInboxSearch`; desde otra
pantalla Enter → `/inbox?q=`; Contactos lee su `?q=` con `useSearchParams`
bajo `Suspense` y `key={q}`), "Atajos de teclado", campana con contador,
lanzador de 9 puntos (`SAYSELLS_APPS`; Bandejas abre el selector, las
demás en otra pestaña) y avatar con el menú de siempre más modo claro /
oscuro.

- **Quién ve el selector**: `GET /api/saysells/selector` lee el mail de la
  sesión y devuelve `{ visible, bandejas }` (401 sin sesión). Variables de
  **servidor** `SELECTOR_BANDEJAS` y `SELECTOR_EQUIPO`; falta cualquiera o
  el mail no está ⇒ oculto. Parseo puro en `src/lib/saysells/selector.ts`
  con tests; `useSaysellsSelector` es un store de módulo (un fetch por
  persona aunque lo monten la barra y el riel).
- **Grupos** (F1): `Nombre|URL|Grupo`; `groupBandejas` arma un
  `DropdownMenuGroup` con su `DropdownMenuLabel` por grupo en orden de
  aparición y las sin grupo al final bajo "Bandejas". Sin grupos, un solo
  bloque.
- **Número** (F1): debajo del nombre va el número de WhatsApp.
  `useWhatsAppNumber(enabled)` lo pide **una vez por pestaña**
  (`sessionStorage` `wacrm:selector:whatsapp-number`) a
  `GET /api/whatsapp/config`, solo con el selector visible; `displayNumberFrom`
  lo saca de `phone_info.display_phone_number` con `connected: true`. Mientras
  carga, sin conexión o con error: el dominio.
- Iniciales y color del cuadrado por hash del nombre (`bandejaColor`). Al
  elegir otra bandeja: "Abriendo dominio…" y `window.location.assign`.
  No van: el pie "apps.saysells.com" (el dominio no existe) ni "Vista: Todos".

## Barra lateral (`sidebar.tsx`)

248 / 76 px plegada, filas de 36 px **sin espacio entre ellas** (F1,
prototipo `.ni`), activo celeste, no leídos en naranja, contador como
número. "Nuevo mensaje" (celeste, `canSendMessages`), vistas con contador,
Embudo con cuadrado de color, Herramientas con las entradas de siempre
menos "Bandeja" (`nav.ts` intacto). Plegada: íconos con `title` y
`aria-label`, contadores `lg:absolute` sobre el ícono. Lee `?vista=` /
`?embudo=` bajo un `Suspense` del shell. Con muchos grupos y herramientas
pide scroll: no se cambia la estructura.

## El store compartido (`src/hooks/use-inbox-store.tsx`)

`InboxStoreProvider` en el shell; `useInboxStore()`: **una** lista de
conversaciones para toda la app (la barra cuenta sobre ella, la Bandeja la
filtra, Contactos y Notificaciones leen `memberNames`). Se carga una vez
cuando el perfil resuelve, con `conversationVisibilityFilter`, y trae en la
misma consulta el último mensaje (`last_msg`) y el último del cliente
(`last_customer_msg`) embebidos (`INBOX_CONVERSATION_SELECT` en
`src/lib/inbox/inbox-conversation.ts`). Nunca una consulta por fila.

- **Un canal de realtime, nombre único**: `messages` INSERT,
  `conversations` *, `contact_tags` INSERT/DELETE (relee ESA conversación)
  y `contacts` UPDATE. Cada evento toca su fila; solo una fila desconocida
  se hidrata, deduplicada por id. Reconexión y pestaña visible → una
  recarga.
- `hydrate(conversationId)` va por `hydrate-queue.ts`; la página copia al
  store (`patch`, `patchContact`) lo que el hilo y la ficha cambian; el
  store sabe cuál es el hilo abierto (`setActiveConversationId`) y avisa
  por `subscribeConversationUpdates`. `tags` y `memberNames` (`profiles`
  acotado por RLS) salen del mismo store.
- **Tope**: la consulta no pagina y Supabase corta en 1000; con más
  conversaciones visibles las más viejas no entran ni en la lista ni en
  los contadores.

## Vistas, embudo y lista (`src/lib/inbox/vistas.ts`, puro, con tests)

| Vista | Datos | Cuenta cerradas |
| --- | --- | --- |
| Mis llamadas | solo closer: llamadas a su nombre o sin closer | no |
| Para mí | `assigned_agent_id = yo` | no |
| Sin tomar | `assigned_agent_id IS NULL` (contador en naranja) | no |
| Agendadas | estado con `requiere_fecha` + `contacts.fecha_llamada` (solo si la cuenta tiene una etiqueta así) | no |
| Por vencer | ventana con menos de 2 h (24 h desde el último mensaje del cliente) | no |
| Todas | todo lo no cerrado | no |
| Cerradas | `status = 'closed'` (sin contador) | sí |

- **Embudo**: grupo = nombre de la etiqueta de estado, salvo que pida
  fecha → "Agendada" (`estadoGroupOf`); orden por `ESTADO_FUNNEL` con
  "Agendada" y cualquier "Agendado a …" donde van las de Paola y Gustavo
  (`groupRank`); nombre desconocido al final, gris neutro (`groupColor`).
  `funnelGroups(tags)` da los grupos de la cuenta. **Closer** = lo que
  sigue a "Agendado a " (`closerFromTag`). **Ventana** (`windowState`):
  abierta, por vencer (< 2 h), cerrada (> 24 h; no se muestra en Ganada ni
  Perdido) o sin mensajes del cliente.
- **Tiempos**: `relativeTime` ("recién", "hace N min", "hace N h", "ayer",
  "hace N días", "dd/mm" desde los 7 días, y "dd/mm/aaaa" si no es de
  este año), `shortWhen` para el futuro ("hoy 16:00", "mañana 10:00",
  "jue 15, 17:30"), `pastWhen` para el pasado ("hoy 16:00", "ayer 10:00",
  "12 oct, 17:30", "12 oct 2025"), `durationParts`. Devuelven
  descriptores; el texto lo pone `src/lib/inbox/time-text.ts`
  (`formatRelative`, `formatShortWhen`, `formatPastWhen`,
  `formatDuration`, claves de `Inbox.conversationList`) y los componentes
  los recalculan con `useNow()` (un reloj por minuto).
- **URL**: `/inbox?vista=mis-llamadas|para-mi|sin-tomar|agendadas|por-vencer|todas|cerradas`,
  `/inbox?embudo=<grupo>`, `/inbox?q=<texto>`, `/inbox?c=<id>` (hilo abierto).
  Sin vista: Mis llamadas para el closer, Para mí para el agent, Todas para
  los demás (`defaultVista`).
- **Búsqueda**: nombre, empresa, teléfono por dígitos y texto de los
  mensajes (una consulta `ilike` con `escapeLike`, 300 ms entre teclas,
  tope 1000 filas, cruzada con la lista visible). **Tomar siguiente**
  (solo Para mí, `canSendMessages`): la sin tomar más antigua por
  `created_at` con `.is('assigned_agent_id', null)`; si otra persona la
  tomó primero, sigue con la próxima.
- **Lista** (`conversation-list.tsx`, 350 px): no carga nada; la página
  filtra una vez con `filterConversations` (búsqueda > grupo > vista, más
  los filtros del desplegable) y esa lista es la que recorren J y K.
  Secciones "Sin leer" / "Leídas" solo en Para mí y Todas. Fila de tres
  líneas: nombre y hora relativa; vista previa con "Vos:" / "Bot:" y
  contador en naranja; estado, llamada ("Manuel · hoy 16:00"), ventana,
  setter (iniciales de 22 px) o sin tomar, y las etiquetas secundarias
  (`splitConversationTags` / `visibleChips` de `conversation-tags.ts`:
  secundaria es solo `grupo IS NULL`; chips con la barra plegada, puntitos
  abierta; la lista pasa a `lg:w-96` plegada).

## Hilo y cuadro de mensaje (sesión C)

- **Hilo** (`message-thread.tsx`, `message-bubble.tsx`): encabezado de
  72 px con avatar, nombre, "empresa · teléfono"; acción principal
  (`primaryAction`: Agendar / Reagendar, "Crear propuesta" para un closer
  con llamada suya, "Reabrir" con `status = 'closed'`), cerrar
  (`CircleCheck`, toast con Deshacer; el UPDATE de `status` vive en la
  página: botón y tecla E van por `onSetStatus` / `onCloseConversation`)
  y menú "Más" (abierta / pendiente, Actualizar, Copiar teléfono).
  Mensajes sobre `bg-card`; burbuja `.bb` 14.5 px radio 20, entrante
  `bg-bubble-in`, saliente `bg-primary` con hora y tildes adentro; rótulos
  "Bot" / "Plantilla · nombre" arriba (`outgoingLabel` en
  `src/lib/inbox/thread.ts`). Separadores de día y notas internas salen
  de `buildTimeline` (puro); las notas **no son realtime** (se releen con
  el hilo y con Actualizar). La ventana de 24 h es `null` hasta que
  cargaron los mensajes de ESA conversación. El menú flotante de cada
  mensaje (`message-actions.tsx`) va con `bottom-full`: apoyado en el
  borde de arriba del bloque sin pisar el rótulo (F1).
- **Cuadro** (`message-composer.tsx`, con `key` por conversación):
  pestañas Responder / Nota interna; indicador de la ventana (verde
  abierta, amarillo < 2 h, rojo cerrada o sin respuesta). **Ventana
  cerrada o sin respuesta ⇒ `TemplatePanel`** en lugar del cuadro
  (reusa `useApprovedTemplates`, `collectVariableSlots` y
  `renderBodyPreview` exportados de `template-picker.tsx`). Borradores por
  conversación en `src/lib/inbox/composer-drafts.ts` (`prefillReplyDraft`
  + suscripción); órdenes del teclado por `composer-commands.ts`. Crece de
  46 a 180 px. Barra: adjuntar, grabar, respuestas rápidas ("/"),
  plantillas, interactivo, "Sugerir respuesta" (`/api/ai/draft`), ayuda y
  el botón redondo navy; **en Nota interna solo la ayuda y guardar**.
  Nota interna: cuadro amarillo, Enter guarda con el insert de
  `contact_notes`, deshabilitada para el viewer. **Respuestas rápidas con
  "/"**: `src/lib/inbox/quick-replies.ts` (`slashQuery`,
  `filterQuickReplies`, `moveSelection`); `quick-reply-picker.tsx` se
  borró. "Guardar como respuesta rápida" pide el nombre en un Dialog.
  Donde el nombre de una plantilla se corta hay `title` con el entero (F1).
- **Cortes de ancho del cuadro** (es un `@container`; las consultas `@[…]`
  miden el contenido sin los 24 px de padding por lado). Medido: barra
  lateral 248, lista 350, panel 280 ⇒ el hilo mide 290 px a 1180, 390 a
  1280, 476 a 1366, 550 a 1440, 646 a 1536 y 790 a 1680. Texto de
  "Sugerir respuesta" desde 410 px (abajo, ícono solo), indicador largo
  de la ventana desde 420 (abajo, la versión corta), panel de plantillas a
  dos columnas desde 440, ayuda "Enter envía…" desde 620. Pestañas y barra
  con `flex-wrap`.
- No hay reintento del mensaje fallido (la burbuja queda en "fallido").

## Riel, ficha y agendar (sesión D)

- **Riel** (`side-rail.tsx`): Ficha, Llamadas (solo con `hasScheduling`),
  Notas y Propuestas (solo `useSaysellsSelector().visible`). Estado en
  `src/hooks/use-side-panel.ts` (misma clave de localStorage para
  abierto/cerrado; sin nada guardado arranca abierto desde 1380 px);
  lógica en `src/lib/inbox/side-panel.ts` (`togglePanelTab`,
  `tabAfterOpeningConversation`, `effectiveSideTab`).
- **Panel** (`side-panel.tsx`, 330 px): **la ficha lee la fila VIVA del
  store** (`activeRow`) y después de escribir hace `patchContact` +
  `hydrate`. Lo único que pide aparte son oportunidades y datos del
  formulario. Notas las carga la página (`inbox/page.tsx`) y las comparten
  hilo y ficha; autor por `memberNames`; fechas de notas y primer mensaje
  con `pastWhen`. Etiquetas: la fila Estado del grupo Embudo lista las de
  estado en orden de embudo; el grupo Etiquetas muestra las que NO son de
  estado con cruz y "Agregar" (`ficha.ts`: `nonEstadoTags`,
  `tagChipLabel` —"Origen: anuncio" / "Origen: formulario"—,
  `contactOrigin`, `upcomingCalls`). "Asignar a…" vive acá (UPDATE de
  `assigned_agent_id`). `usePresence` usa `uniqueChannelName("presence")`.
- **Agendar llamada**: `src/lib/inbox/agendar.ts` (puro, con pruebas) +
  `schedule-call-dialog.tsx` (780 px, calendario propio, horarios
  09:00–12:30 y 14:00–18:30). Siempre **primero la fecha, después la
  etiqueta** (`applySchedule` → `saveFechaLlamada` → `attachTag`).
  `resolveScheduleTag` (decisión de Emi del 12/10): agendar sin llamada
  vigente → "Agendado a <closer>" (sin closers, la de estado con fecha
  que no es "Reagendado"); reagendar → "Reagendado", o "Agendado a
  <nuevo>" si cambia el closer; desde Estado, "Agendado a X" abre con X
  marcado y "Agendada" / "Reagendado" aplican esa (`fixedTag`); si el
  contacto ya tiene la etiqueta, se saca y se vuelve a poner
  (`needsReattach`) para que el aviso al CRM salga del INSERT. Ocupados:
  misma hora, mismo closer, mismo día sobre el store (`busySlots`,
  `daysWithCalls`, `callsNextWeek`). Casilla "Dejarlo listo en el
  composer" (`prefillReplyDraft`) solo con ventana abierta o por vencer.
  USA y Star Energy no tienen etiquetas con fecha: ahí no hay Agendar, ni
  fila Llamada, ni pestaña Llamadas.

## Closer y teclado (sesión E)

- **Closer** (`src/lib/inbox/closer.ts` + `use-closer.ts`): quien tiene
  como nombre de pila (`firstNameKey`) el de una etiqueta "Agendado a
  <nombre>" de la cuenta (`closerNameOf`); si dos miembros lo comparten,
  ninguno. **Mis llamadas** (`?vista=mis-llamadas`): pendientes a su
  nombre y sin closer (chip "Sin closer"), por hora y agrupadas por día
  (`groupByDay`, `callDayHeading`, `callRow`, `callStatus`); contador "N
  por hacer". **Tarjeta de la llamada** en el panel (`showsCallCard`):
  Realizada, Reagendar, No se presentó y Propuesta (`outcomeTag`: cada
  resultado es `attachTag` de la etiqueta de estado con ese nombre;
  Propuesta abre propuestas.saysells.com para el equipo de Saysells).
  "Crear propuesta" como acción principal (`showsProposalAction`).
- **Teclado** (`src/lib/inbox/shortcuts.ts`: `shortcutFor`,
  `isTypingTarget`, `neighborId`, `SHORTCUT_HELP`; un solo `keydown` en
  `inbox/page.tsx`). Nunca escribiendo en un campo, con un modal, menú o
  popover abierto (`role="dialog"` / `"menu"` / `"listbox"`) ni con Cmd,
  Ctrl o Alt. J / K mueven por la lista a la vista; A toma la abierta o
  Tomar siguiente; L abre Agendar / Reagendar; E cierra con Deshacer; N y
  / mandan una orden al cuadro (Nota interna, o Responder con "/"); ?
  abre el modal "Atajos de teclado" (`shortcuts-dialog.tsx`, estado en
  `use-shortcuts-help.ts`; también desde la barra superior). El viewer
  solo J, K y ?. En esta versión de lucide `CircleHelp` se llama
  `CircleQuestionMark` y `FileSignature` no existe (se usa `FilePen`).

## Contactos (sesión F1)

`src/app/(dashboard)/contacts/page.tsx`, prototipo `contactos()`; lógica
en `src/lib/contacts/contactos.ts` (puro, con pruebas).

- **Encabezado**: "Contactos" con el contador de la consulta; a la
  derecha Campos personalizados (botón de ícono con `title`, solo
  `canEditSettings`), Importar y Nuevo contacto (`canEdit`, abre
  `ContactForm`) y Exportar (`canExport`).
- **Barra**: un solo filtro, "Filtro por estado" (`.ddb`), que abre el
  menú "Estado es cualquiera de" con los grupos del embudo
  (`filterOptions`: los mismos de la barra lateral, cada uno con su chip)
  y debajo "Otras etiquetas" (las que no son de estado, rotuladas con
  `tagChipLabel`). Casillas (`DropdownMenuCheckboxItem`, no cierran al
  marcar) con el cuadrado `.cb` a la izquierda. **Un solo disparador
  estable**: al marcar, el botón se convierte en el chip `.fchip`
  ("Estado" / "Etiqueta" / "Estado o etiqueta" · "es cualquiera de" · lo
  marcado · X) sin desmontarse, así base-ui no pierde el ancla. Lo marcado
  arma **una lista de ids** para `filter_contacts_by_tags`
  (`filterTagIds`: un grupo = todas sus etiquetas de estado), que ya
  filtra por "cualquiera de" y trae total y página. Sin etiquetas en la
  cuenta (USA) el filtro no va. Buscador a la derecha (nombre, teléfono y
  email, y el `?q=` de la barra superior).
- **Columnas**: Nombre (avatar de 28 px, semibold; "Sin nombre"),
  Teléfono, Estado (chip del grupo; solo si hay etiquetas de estado),
  Origen ("Anuncio" / "Formulario" / nombre, `contactOrigin`; solo si hay
  etiquetas de origen), Setter (`assigned_agent_id` de su conversación:
  mini avatar y nombre, o "Sin tomar") y Último mensaje (`last_message_at`
  con `formatRelative`). Una sola consulta más por página a
  `conversations` con los ids de la página, en la misma corrida y con su
  `fetchSeq` (`conversationsByContact`). Sin conversación, Setter y
  Último mensaje vacíos. Orden por fecha de alta (ordenar por último
  mensaje necesita la base).
- **Clic en la fila** (`conversationHref`): `/inbox?vista=todas&c=<id>`,
  o `vista=cerradas` si está cerrada; sin conversación, la ficha
  (`ContactDetailView`). Se quedan, con el diseño nuevo: la casilla de
  cada fila y la barra para borrar varios, el menú Más (Ver ficha,
  Editar, Eliminar), la paginación de a 25, el vacío sin contactos y lo
  que ve un agent (`hiddenContactIds`). Vacío con filtro o búsqueda:
  "Sin contactos con este filtro."

## Notificaciones (sesión F1)

`src/app/(dashboard)/notifications/page.tsx`; lógica en
`src/lib/inbox/notificaciones.ts` (puro, con pruebas); i18n en el
namespace `Notifications`.

- Encabezado como Contactos: "Notificaciones" con "N sin leer" y "Marcar
  todas como leídas". Filas como las de la lista: ícono de 42, texto,
  hora con `formatRelative`, sin leer en negrita con punto naranja y hora
  en navy. Click: la marca leída y abre `/inbox?c=`.
- **El texto se arma en el navegador**: la base escribe título y texto en
  inglés (`notify_conversation_assigned`, migración 027) y eso no se toca.
  `notificationText`: "<nombre de pila> te asignó la conversación con
  <contacto>" (actor de `store.memberNames`, `firstNameOf`) o "Te
  asignaron la conversación con <contacto>" sin `actor_user_id`; el
  contacto sale de una consulta a `contacts` con los `contact_id` que
  faltan (`missingContactIds`, también para las que llegan en vivo), "un
  contacto" si no está. Otro tipo: título y texto de la fila.
- Vacío: "No tenés notificaciones" / "Cuando alguien te asigne una
  conversación, aparece acá." Canal de realtime con `uniqueChannelName`.

## Piezas comunes y el resto de las pantallas (sesión F2)

- **Encabezado** `PageHeader` (`src/components/ui/page-header.tsx`,
  prototipo `.ctop`): título de 22 px, `meta` al lado (contador, chip o
  el selector de embudo), `actions` a la derecha, `note` gris debajo,
  `back` a la izquierda; `padded` para las pantallas que ocupan la
  tarjeta entera. Lo usan todas las pantallas, Contactos y Notificaciones
  incluidas.
- **Vacío** `EmptyState` (`empty-state.tsx`, `.empty`: cuadro celeste de
  56 px, título, texto, `action`; `compact` adentro de una tarjeta).
  `src/components/dashboard/empty-state.tsx` lo envuelve. **Filtro**
  `FilterButton` / `ddbClassName` (`filter-button.tsx`, `.ddb` de 32 px).
  **Tabla** `table.tsx` con las medidas de `.tbl` y `tableHeadClass` /
  `tableCellClass` para las armadas a mano. **Casilla**: base-ui renderiza
  un `span`, así que `checkbox.tsx` lleva `inline-flex` (cuadrado de 16 px).
- **Select plano** `SimpleSelect` (`simple-select.tsx`: opciones
  `{ value, label, group? }`, el `""` viaja como centinela) para los
  formularios con listas; **selector de fecha** `DatePicker`
  (`date-picker.tsx`, el calendario de Agendar en un popover; valor
  `YYYY-MM-DD`; lógica en `src/lib/dates/iso-day.ts`). Nunca `<select>` ni
  `type="date"` nativos.
- **`GatedButton`**: el tooltip sale de `Common.readOnly`; `gateReason`
  queda como documentación. Namespaces nuevos: `Common`, `Agents`,
  `Interactive`, `Flows.header`, `Automations.templates`.
- **Estados en `Badge`**: `src/lib/broadcast-status.ts` y
  `src/lib/template-status.ts` mapean a **variantes** (`success`,
  `warning`, `danger`, `info`, `selected`, `secondary`), no a clases;
  `SettingsChip` es un `Badge`. Colores crudos de Tailwind (ámbar, verde,
  rojo, azul…) reemplazados por los tokens en todas las pantallas de la
  sesión; los gráficos van en navy y celeste (`chart-colors.ts` tiene
  `navy` y `celeste`). Sin `window.confirm`: borrar pide un `Dialog`.
- **Configuración**: el Resumen es el tablero de `config()`
  (`settings-overview.tsx`): tarjetas `.hc.t` en tres columnas, primero
  WhatsApp, Plantillas, Respuestas rápidas, Etiquetas, Miembros y
  Apariencia, después Tu perfil, Inicio de sesión y seguridad,
  Oportunidades y moneda y Claves de API. Orden y estados en
  `src/lib/settings/tablero.ts` (`tableroCards(rol)`: hoy las diez para
  todos; los permisos siguen adentro de cada panel). Encabezado con el
  nombre de la cuenta (`useAuth().account.name`). Respuestas rápidas tiene
  su namespace (`Settings.quickReplies`).
- **Menú flotante de cada mensaje** (`message-actions.tsx`): al costado
  de la burbuja, centrado en el alto del bloque, del lado libre. Para que
  entre a 1180 px el padding de los mensajes es por container query
  (`px-4 @[520px]:px-10` en el hilo), ya no por ventana.
- **Automatizaciones**: el disparador se nombra con
  `Automations.builder.triggers.*` y el chip lo colorea la página; la
  tabla del motor (`src/lib/automations/trigger-meta.ts`) no se toca. Las
  plantillas para arrancar leen `Automations.templates.<slug>`; los textos
  que cargan (`templates.ts`) están en español. **Flujos**: la
  confirmación de borrar vive en `header.tsx`; `deleteFlow` solo borra. El
  lienzo (`FlowNodeCard`, `FlowCanvasInner`) no se tocó.

## Pendientes del rediseño

- **Nada se vio en un navegador** desde esta base: la revisión con
  navegador la hace el chat de dirección contra una Supabase falsa y la
  visual, Emi en USA.
- Quedan en inglés: los mensajes del validador de mensajes interactivos
  (`src/lib/whatsapp/interactive.ts`) y del validador de flujos
  (`src/lib/flows/validate.ts`), que son del lado del servidor; las
  pantallas de entrada (`(auth)`, `join`) no eran de la sesión. Los
  colores por tipo de nodo del lienzo (`flows/shared.tsx`) siguen en la
  paleta de Tailwind porque el lienzo no se toca.
- Del prototipo no van: "Ver como", las líneas de evento, el resultado
  guardado en la llamada, "Vista: Todos" (no hay tabla para vistas
  guardadas) y el pie "apps.saysells.com".
- Las notas de otras personas llegan al actualizar (realtime de
  `contact_notes` es SQL). El panel y el riel son de escritorio.
- Los colores de los chips de estado son la tinta de `GROUP_COLORS` al
  15 %, no los pares pastel exactos del prototipo. El chip del selector
  de temas (`ThemeMeta.swatch`) muestra el primario de oscuro.
- Barra plegada: anchos fijos (`lg:w-[76px]`, lista `lg:w-96`); la
  preferencia es por dispositivo, no por usuario.

Historia de las sesiones A a F2 (fechas, commits, incidentes, conteos de
warnings): `respaldos/claude-md-historia-2026-10-12.md`, secciones
«Rediseño · sesión A» a «Rediseño · sesión E», «Bandeja de escritorio ·
más de una etiqueta por fila» y «Marca».
