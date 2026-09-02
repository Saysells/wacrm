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
  y el trabajo de las secciones "Roles y permisos", "Bandeja" e
  "Integración Tally" de abajo (sesiones 2026-08-31 y 2026-09-01,
  pedidas explícitamente por Eze). También
  `src/components/settings/tag-manager.tsx`, del que se extrajo
  `PRESET_COLORS`, y `src/app/layout.tsx` +
  `src/components/layout/sidebar.tsx`, de los que salió el nombre de
  la app a `NEXT_PUBLIC_APP_NAME` (ver abajo).
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

# Integración Tally

Sesión 2026-09-01 (pedida por Eze). Sin SQL: `custom_fields`,
`contact_custom_values`, `tags` y `contact_tags` ya existían.

El embudo real de Kosmo: anuncio en Meta → kosmo.click → formulario de
Tally → página de gracias con botón de WhatsApp (texto prellenado) →
número de Kosmo. El objetivo es que, cuando el lead escribe, la ficha
ya tenga sus respuestas; y si nunca escribe, que el contacto exista
igual, etiquetado, para escribirle después con plantilla.

## Normalizador de teléfono argentino

`src/lib/phone/normalize-ar.ts` — `normalizeArgentinePhone(raw)`.

El formulario manda `+54 11 XXXX-XXXX` (468 de 522 envíos del export
vienen con código de país y SIN el 9); WhatsApp entrega el `wa_id`
como `549` + área + número. Es el mismo teléfono escrito de dos
formas, y sin unificarlas el lead del formulario y su primer mensaje
entrante terminan en **dos contactos**.

- Lleva todo a la forma canónica de WhatsApp: saca el `0` de larga
  distancia y el `15` (probando las tres longitudes de área: 2, 3 y 4
  dígitos), e inserta el `9` si falta.
- Lo que **no** se entiende como argentino sale como dígitos sin
  tocar: el doble chequeo de largo (10) y prefijo (`11`/`2`/`3`) evita
  convertir por accidente un doméstico de otro país. Nunca se adivina
  un país.
- Se usa en los **tres** caminos que crean o buscan contacto por
  teléfono: el webhook de Meta (`processMessage`, sobre `message.from`),
  `resolveConversationByPhone` / `findConversationByPhone` ("Nuevo
  mensaje") y el receptor de Tally. Que los tres coincidan es
  justamente lo que hace que sea un solo contacto.
- **No cambia ninguna llamada a Meta**: se aplica al camino de entrada
  y a lo que se guarda, no a cómo se envía.
- `findExistingContact` (dedupe.ts) ya toleraba la diferencia al
  BUSCAR (compara los últimos 8 dígitos), pero lo que se GUARDABA
  seguía siendo lo que vino y el índice único de `phone_normalized`
  (migración 022) es exacto. El normalizador canoniza al escribir.

## Receptor: `POST /api/integrations/tally`

`src/app/api/integrations/tally/route.ts` +
`src/lib/integrations/tally/{signature,payload,ingest}.ts`.

- **Firma** (`signature.ts`): `Tally-Signature` =
  `base64(HMAC-SHA256(TALLY_SIGNING_SECRET, cuerpo crudo))`. Se firma
  sobre el **body crudo** (`await request.text()`), nunca sobre el JSON
  reserializado — reserializar cambia el orden de las claves y los
  espacios, y la firma no da nunca. Sin firma o firma inválida → 401 y
  no se procesa nada. Falla cerrado si falta la variable, igual que
  `webhook-signature.ts` de Meta.
- **Idempotencia**: `data.responseId` se guarda como campo
  personalizado `tally_response_id`; antes de escribir nada se
  pregunta si ya existe un contacto con ese valor. Tally **reintenta**
  las entregas fallidas, así que el mismo envío llega más de una vez
  de forma normal, no excepcional. Un envío distinto del mismo
  teléfono sí actualiza (24 teléfonos repetidos en el export: el
  receptor actualiza, no duplica).
- **Acceso a la base**: cliente admin del servidor (service_role), el
  mismo que el webhook de Meta. No hay sesión — quien postea es Tally.
- **Cuenta destino**, en este orden: `TALLY_ACCOUNT_ID` si está; si no,
  la **única** fila de `whatsapp_config` (la misma que el webhook de
  Meta habría matcheado por `phone_number_id`, solo que sin necesitar
  el id para elegirla). Con 0 o ≥2 filas y sin la variable: error
  explícito. Adivinar sería meterle los leads de un cliente a otro.
- **Contacto**: find-or-create por el camino que ya existe
  (`findOrCreateContact` de `@/lib/api/v1/contacts`, mismo
  `findExistingContact` + backstop de unique que el webhook), así el
  contacto del formulario es indistinguible de uno creado por un
  mensaje entrante. Si ya existía, se pisa solo lo que el formulario
  trajo con contenido (un envío sin email no borra el que estaba; el
  nombre real del formulario sí le gana al nombre de perfil de
  WhatsApp).
- **Etiqueta** `origen_form`: se crea si no existe y se aplica con
  `addContactTagAndDispatch` — el camino compartido, que valida
  tenencia, trata el duplicado como no-op y dispara las
  automatizaciones de `tag_added`. No hay una segunda forma de
  escribir `contact_tags`.
- **Códigos**: 401 firma; 400 no es JSON o falta `data.responseId`;
  422 sin teléfono usable (**no se crea nada**); 200 procesado,
  duplicado, o `eventType` que no es `FORM_RESPONSE` (se contesta 200
  para que Tally no reintente eternamente).
- **Debug**: con `TALLY_DEBUG_PAYLOAD=1` se loguea UN payload crudo por
  proceso, para confirmar el formato contra un envío real. Apagalo
  apenas verificaste: el payload trae datos personales del lead.

## Mapeo de campos

La clave de unión es el **label** de la pregunta, no el `key`
(`question_XXXX`): el key cambia cuando se rehace la pregunta, el
label es lo que la persona ve y lo que quedó en el export. Los labels
se comparan normalizados (sin acentos, sin signos, minúscula, un solo
espacio), así que sacarle los `¿?` a una pregunta no rompe el mapeo.

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

- Se mapean **las dos versiones** del formulario (la actual y la de
  julio 2026) contra los mismos destinos.
- **"Nombre" está dos veces** en el formulario de Kosmo: el primero
  (por orden en `fields[]`) es la persona, el segundo es el CUIT/DNI
  (valores reales: `43228684`, `20-12345678-9`). Antes el segundo
  pisaba al primero y el contacto quedaba con nombre `43228684`.
  Además, como **guarda**, si lo que iría a `contacts.name` es solo
  dígitos, guiones, puntos o espacios (`looksLikeIdentifier`), no se usa como
  nombre —el contacto conserva el que tenga, o queda con el teléfono
  si es nuevo, igual que uno del webhook— y se guarda como `cuit_dni`.
  Mismo criterio para "Apellido". El segundo "Nombre" explícito le gana
  a la guarda si ambos aportan un valor.
- En preguntas de opción, `value` viene como **id** con el texto en
  `options[]`: se resuelve a texto (varias opciones se juntan con
  coma).
- Un label que **no** está en la tabla se ignora: el catálogo de
  campos personalizados de la cuenta no crece solo porque alguien
  agregó una pregunta al formulario.
- Las definiciones de `custom_fields` se crean si faltan, comparando
  sin mayúsculas (si alguien ya creó "Provincia" a mano, no se agrega
  un segundo "provincia"). Los valores van con `upsert` sobre la
  unique `(contact_id, custom_field_id)` de la migración 001.

## Variables de entorno

| Variable | Obligatoria | Para qué |
| --- | --- | --- |
| `TALLY_SIGNING_SECRET` | sí | Verificar la firma. Sin ella el receptor rechaza todo (falla cerrado). |
| `TALLY_ACCOUNT_ID` | solo con ≥2 cuentas | Cuenta destino de los leads. |
| `TALLY_DEBUG_PAYLOAD` | no | `1` loguea un payload crudo. Apagar después. |
| `NEXT_PUBLIC_APP_NAME` | no | Nombre de la app; default `CRM By Saysells`. |

## "Datos del formulario" en la Bandeja

`src/lib/inbox/contact-form-values.ts` + sección nueva en
`contact-sidebar.tsx`. Solo lectura: lista los
`contact_custom_values` del contacto (nombre del campo: valor) y se
**oculta entera** si no tiene ninguno. Editar valores sigue siendo
cosa de Contactos → Editar contacto; duplicar esa escritura acá sería
un segundo camino a la misma tabla.

- Parte pura (`pairFieldValues`) separada de la parte con red
  (`loadContactFormValues`), igual que `contact-tags.ts`.
- Ante un error de lectura el loader devuelve vacío: la sección se
  oculta sola en vez de romper el sidebar entero.
- Se muestra el `field_name` **tal cual**, sin prettificar: es el
  mismo string que un admin ve y edita en Configuración → Campos y
  etiquetas, y transformarlo acá haría que el sidebar llame distinto
  al mismo campo.
- **Se ocultan los campos `tally_*`** (`tally_response_id`,
  `tally_submitted_at`): son de sistema, para idempotencia y
  trazabilidad, no para quien atiende. Es un filtro por prefijo en el
  loader (`isSystemField`, dentro de `pairFieldValues`), sin SQL;
  siguen visibles en Contactos → Editar contacto.

## Nombre de la app por variable

`src/lib/app-name.ts` — `NEXT_PUBLIC_APP_NAME`, default
`CRM By Saysells`. Lo usan `layout.tsx` (metadata: título, template y
descripción) y el `Sidebar`. **Salió de los catálogos de i18n**
(`Sidebar.title` ya no existe en en/es/ko): es un nombre propio, no
una etiqueta de interfaz, así que no se traduce. `NEXT_PUBLIC_` porque
lo usa un componente de cliente; cambiarlo en Vercel pide **redeploy**,
no restart.

## Pendientes de esta sesión

- **Nada de esto se probó contra un envío real de Tally.** Los tests
  cubren firma, mapeo, idempotencia y escritura contra un Supabase en
  memoria; el formato exacto del payload está tomado de la
  documentación y del export, no de una entrega observada. Para eso
  está `TALLY_DEBUG_PAYLOAD=1` en el primer envío de prueba.
- `data.createdAt` como fecha del envío es lo esperado pero **no está
  verificado** contra un payload real; si no viene, `tally_submitted_at`
  simplemente no se escribe (no rompe nada).
- **No se importa el histórico del CSV** (522 envíos): es otra tarea.
  El receptor solo procesa envíos nuevos.
- El normalizador asume que un `+54` de 10 dígitos nacionales es
  móvil y le pone el `9`. Un fijo con WhatsApp Business quedaría con
  un `9` de más; no hay forma de distinguirlos por el número solo.
- Los campos de sistema se ocultan en el sidebar por **prefijo de
  nombre** (`tally_`), no por una marca en `custom_fields`. Si un
  admin crea a mano un campo que empiece con `tally_`, también se
  oculta en la Bandeja.
- La guarda de `looksLikeIdentifier` es por forma (dígitos, guiones,
  puntos, espacios). Un valor con letras nunca la dispara, así que un
  CUIT tipeado como "CUIT 20-12345678-9" quedaría como nombre.
- No hay unique `(account_id, field_name)` en `custom_fields`: dos
  entregas concurrentes de responseIds distintos podrían crear dos
  definiciones con el mismo nombre. La solución real es un índice
  único (SQL, fuera de esta sesión).
- Sin `@testing-library/react`, la sección nueva del sidebar no tiene
  test de DOM: lo verificado es la lógica de
  `src/lib/inbox/contact-form-values.ts`.

# API v1 · etiquetas por PATCH

Sesión 2026-09-02 (pedida por Eze). Bug en `setContactTags`
(`src/lib/api/v1/contacts.ts`): armaba el set `desired` con
`tagIdByKey.values()`, pero `resolveImportTagIds` devuelve en ese mapa
**todas** las etiquetas de la cuenta (carga el catálogo entero para
matchear por nombre), no solo las pedidas. Un
`PATCH /api/v1/contacts/{id}` con `tags: ["a"]` le ponía al contacto
todo el catálogo que le faltaba.

- **Regla**: `desired` se arma únicamente con los nombres recibidos en
  `tagNames`, buscados en el mapa con la misma normalización que usa
  el resolvedor (`trim` + minúsculas). El mapa es un índice de
  búsqueda, nunca la lista de lo que hay que aplicar.
- **Guarda**: `src/lib/api/v1/contacts.test.ts` tiene el caso (cuenta
  con a, b, c; PATCH con `["a"]`; el contacto queda solo con a). Si se
  vuelve a tomar `.values()` del mapa, ese test falla.
- Mismo día: la ficha del contacto en la Bandeja relee las etiquetas
  con `fetchContactData` después de agregar, sacar o crear-y-aplicar,
  porque el trigger `trg_single_etapa_tag` borra en la base la
  `etapa_*` anterior y la lista local no lo sabe. Y el `ScrollArea` de
  la ficha lleva `min-h-0` (issue #229, mismo defecto que la lista).

# Etiquetas de estado (`tags.grupo`)

Sesión 2026-09-02 (pedida por Eze). Migración **046** (aplicada):
`tags.grupo` es `'estado' | 'origen' | 'senal' | null` (CHECK en la
base). Las `etapa_*` ya no existen: las 13 etiquetas de **estado**
tienen nombre humano y siguen el embudo del setter, en este orden:
Nuevo, En gestión, No responde, Agendado a Paola, Agendado a Gustavo,
Agendada, No se presentó, Reagendado, Realizada, Propuesta,
En negociación, Ganada, Perdido. `origen_*` y `senal_*` (bot de Kosmo)
llevan grupo `origen` / `senal`; el resto queda en `null`.

- **La regla de "una sola de estado por contacto" vive en la base**
  (trigger `trg_single_etapa_tag`, ahora por `grupo = 'estado'`), y el
  aviso al CRM (`trg_notify_crm_on_etapa_tag`) también. El frontend no
  la replica: `withTagAttached` solo saca del estado local el estado
  anterior para que la ficha no muestre dos un instante, y después
  relee (`fetchContactData`).
- **Dónde se conoce el grupo**: `Tag.grupo` en `src/types/index.ts`;
  `src/lib/contacts/tag-groups.ts` (`ESTADO_FUNNEL`, `isEstadoTag`,
  `sortByFunnel`, `findEstadoTag`); `groupAssignableTags` y
  `orderAttachedTags` en `src/lib/inbox/contact-tags.ts`.
- **Bandeja**: la etiqueta de estado va primera en la ficha, como
  pastilla llena con rótulo "Estado" y **sin X** (se cambia eligiendo
  otra; dejar sin estado se hace desde Contactos). El popover se parte
  en "Estado" (orden de embudo) y "Otras" (alfabético). La lista de
  conversaciones muestra el estado como chip al lado del nombre; la
  ficha avisa a la página (`onTagsChange`) para que el chip no quede
  viejo.
- **Configuración → Etiquetas**: muestra el grupo, ofrece un selector
  "Grupo" al crear, y las de estado no se borran desde la UI (botón
  deshabilitado con tooltip).
- **API v1**: cada tag de `/contacts` y `/conversations` trae `grupo`
  (`serializeTag` en `src/lib/api/v1/contacts.ts`).
- ~~El gestor de etiquetas de Configuración filtra por `user_id`~~:
  desde la sesión de cierre filtra por `account_id`, como la ficha, así
  cualquier admin ve las 13 de estado (creadas a nombre del owner).

## Fecha de la llamada y realtime (sesión de cierre, 2026-09-02)

Migración **047** (aplicada): `contacts.fecha_llamada` (timestamptz) y
`tags.requiere_fecha` (true en Agendado a Paola, Agendado a Gustavo,
Agendada y Reagendado). `contact_tags` y `contacts` entran en la
publicación `supabase_realtime` (REPLICA IDENTITY FULL en
`contact_tags`). El trigger del puente manda `fecha_llamada` al CRM
junto con la etiqueta.

- **Primero la fecha, después la etiqueta. No es negociable.** El aviso
  al CRM sale del INSERT en `contact_tags` y lee
  `contacts.fecha_llamada`: si la etiqueta entrara antes, el CRM
  recibiría la fecha vieja. `scheduleWithDate`
  (`src/lib/inbox/fecha-llamada.ts`) guarda la fecha con un update
  directo (RLS `contacts_update`, agent+) y recién después llama a
  `attachTag`; si guardar falla, no aplica nada. Hay un test que fija
  ese orden.
- **Ficha**: al elegir una etiqueta con `requiere_fecha` se abre el
  modal "Fecha y hora de la llamada" (`datetime-local`; sugerida mañana
  10:00 hora local, o la del contacto si ya tiene). Cancelar no aplica
  la etiqueta. Al lado del estado se ve la fecha corta
  ("Jue 03/09 · 10:00") con un lápiz que solo corrige la fecha (no
  vuelve a aplicar la etiqueta ni dispara otro aviso).
- **API v1**: `PATCH /api/v1/contacts/{id}` acepta `fecha_llamada`
  (ISO 8601 válida, se normaliza a UTC, o null; otro tipo → 400) vía
  `parseContactUpdates`; `serializeContact` la expone. Es el camino de
  vuelta CRM → Bandeja.
- **Realtime de la ficha**: `subscribeToContactChanges`
  (`src/lib/inbox/contact-realtime.ts`) arma un canal por contacto
  (`contact_tags` INSERT/DELETE por `contact_id`, `contacts` UPDATE por
  `id`) y ante cualquier evento la ficha relee (`fetchContactData`).
  Se desuscribe al desmontar o cambiar de contacto. La lista se entera
  por `onTagsChange`, el mismo aviso que ya usaba.
- **Pendiente sin navegador**: nada de esto se probó contra Supabase
  real; lo verificado es la lógica pura y que la suscripción se arma
  con los filtros correctos (mock).

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
