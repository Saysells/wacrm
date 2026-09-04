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
  la app a `NEXT_PUBLIC_APP_NAME` (ver abajo). La sesión 2026-09-03
  sumó `src/lib/themes.ts`, `src/app/globals.css`, `src/app/icon.tsx`,
  `src/components/brand/whatsapp-glyph.tsx` (nuevo) y las tres
  pantallas de `src/app/(auth)/` (ver "Marca" abajo).
- **Matías tiene dos identidades y no se mezclan**: en la Bandeja
  (esta base) es `saysellsmatias@gmail.com`, y en el CRM Saysells, que
  es **otra** base, es `matias@saysells.com`. Las migraciones de este
  repo resuelven la cuenta y los traspasos por el **primero**.
- **Las migraciones están partidas en dos**: `supabase/migrations/` es el
  producto y va en toda instancia; `supabase/cuentas/<cuenta>/` es de una
  cuenta sola (flujos, crons, datos suyos) y la aplica `npm run migrar` según
  `CUENTA` en `credenciales.env`. Nada específico de una cuenta —un email, una
  URL, un flujo— vuelve nunca a `migrations/`: ahí revienta la instancia nueva.
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

# Flujos · nodos nuevos, timeout y el bot de Kosmo

Sesión 2026-09-02 (pedida por Eze). El motor de Flujos tenía todo para
un bot de botones y le faltaba todo para uno de texto libre. Tres
migraciones nuevas: **048** (nodos + cola), **049** (reentrada + beta)
y **050** (el flujo). Ninguna aplicada — las aplica Emi con
`npm run migrar` desde el instalador.

El flujo quedó en la **050 y no en la 048** como decía el pedido: el
`CHECK` de `flow_nodes.node_type` y el flag de beta tienen que estar
aplicados ANTES de que el flujo inserte un nodo `wait`, así que las dos
migraciones de las que depende se llevaron los números de adelante.

## Nodos nuevos

- **`wait`** (`{ seconds, next_node_key }`): suspende la corrida N
  segundos y sigue sola. **No es un `setTimeout`** y no puede serlo: el
  proceso que atiende el webhook se apaga apenas contesta el 200 a
  Meta. La espera se encola en `flow_pending_resumes` (migración 048,
  misma forma que `automation_pending_executions`) y la drena el cron.
  La corrida queda estacionada en el propio nodo `wait`, no en el
  siguiente, para que un mensaje que llegue durante la espera se
  reconozca como "todavía esperando" (se consume, no repregunta).
  **Consecuencia operativa: el cron de flujos ahora conviene correrlo
  cada minuto.** La cola no pierde nada si se atrasa, pero la
  frecuencia del cron *es* la precisión de la espera: con el cron cada
  10 minutos, un `wait` de 25 segundos puede tardar 10 minutos.

- **`classify_reply`**: interpreta texto libre y ramifica. El criterio
  está en `src/lib/flows/classify.ts`, puro:
  - Compara **por palabra o frase completa**, nunca por subcadena: el
    "no" adentro de "nono" o de "sino" no es un no.
  - Evalúa **extra → negativo → positivo → desconocido**. El negativo
    antes que el positivo porque quien dice que no dijo que no; el
    extra antes que todo porque suele venir mezclado con un negativo
    ("nunca compré, llamada no puedo, mejor por catálogo" pide la
    lista, no es un no a secas).
  - El desconocido **tiene su propia salida** (`unknown_next`), no cae
    en la política de fallback: el guion decide si repregunta o
    traspasa.
  - Con `prompt_text` pregunta y espera; sin él clasifica el último
    mensaje del cliente.

Los dos están en el editor (formulario, canvas, validador, i18n en las
tres lenguas). Lo que el editor **no** expone todavía es el `timeout`
por nodo: se carga por JSONB, como el flujo de Kosmo.

- **`handoff` con `next_node_key`** (sesión 2026-09-02, seguimiento):
  el traspaso se hace igual —asignación, nota, conversación pendiente,
  evento `handoff`— pero la corrida queda **activa** y avanza a ese
  nodo. Sin la clave, cierra como siempre (`handed_off`). El evento se
  registra en los dos casos. Lo pide el seguimiento del catálogo: la
  conversación ya es de Matías y el bot todavía tiene algo que
  preguntar 24 horas después. En el canvas el traspaso muestra handle
  de salida **solo** cuando ya tiene destino: el terminal, que es el
  caso normal, sigue sin ninguno. Tampoco tiene formulario: se carga
  por JSONB, como el `timeout`.

## Variables del contacto

`{{contact.nombre}}`, `{{contact.nombre_coma}}` (" Juan," / ","),
`{{contact.coma_nombre}}` (", Juan" / ""), `{{contact.tipo_negocio}}`
(minúscula, o "tu negocio"), y cualquier `{{contact.<field_name>}}` que
coincida con un campo personalizado de la cuenta.

- Las **dos formas del nombre** existen porque en el guion aparece de
  las dos maneras ("Hola{{nombre_coma}} te escribe" y "...con el
  asesor{{coma_nombre}}? Sí o no."). Sin la segunda no hay forma de
  poner el nombre al final de una frase y que cierre bien sin él.
- Un contacto que **se llama como su teléfono** (los que crea el
  webhook de Meta) NO tiene nombre: "Hola 5491122334455" es peor que no
  saludar.
- La lectura es perezosa: un texto sin `{{contact.` no paga consulta.
- `handoff.note` interpola como cualquier otro texto (`interpolate`,
  salido de `engine.ts` a `src/lib/flows/interpolate.ts`).

## Timeout

`fallback_policy.on_timeout` = `{ action: 'tag_and_end' | 'handoff' |
'goto', tag_id?, note?, next_node_key? }`. Default `tag_and_end` sin
etiqueta, que es exactamente lo que hacía el barrido antes (cerrar y
nada más), así que toda política vieja se sigue comportando igual.

Cada nodo que espera puede sobreescribirlo con `timeout: { hours,
action, tag_id?, note?, next_node_key? }`, **campo por campo**. Lo
necesita el paso 4 del bot: quien ya dijo que quiere la llamada y solo
no mandó el horario no es "No responde", es un traspaso.

**`goto` (sesión 2026-09-02, seguimiento) es la única de las tres que
no cierra la corrida**: al vencer, avanza a `next_node_key` y la deja
`active`. Con eso el silencio deja de ser solo un final posible y pasa
a poder disparar el paso siguiente del guion — 24 horas después de
mandar el catálogo es exactamente cuando corresponde preguntar si lo
pudo ver. Un `goto` sin destino **no es un `goto`**: se degrada a la
acción de la política (`resolveTimeoutAction`, `resolveTimeout`) en vez
de dejar una corrida viva apuntando a la nada. El destino es una
arista real del grafo aunque la recorra el cron y no el cliente, así
que el validador exige que exista y la reachability la sigue.

`applyFlowTimeout` **clava primero el estado final de la corrida** con
la precondición `status='active'` y recién después hace los efectos
visibles (etiqueta, conversación pendiente), para que dos pasadas
solapadas del cron no etiqueten dos veces al mismo contacto. En el
`goto` el claim es el propio movimiento del puntero, condicionado a que
la corrida siga parada donde se la leyó.

## Reentrada tras "No responde"

`src/lib/inbox/reentrada.ts`, llamado desde el webhook al lado de
`reopenClosedConversation`. Un contacto marcado "No responde" que
vuelve a escribir: se le pone "En gestión", se le saca "No responde" y
la conversación vuelve a pendiente asignada a
`accounts.agente_reentrada` (columna nueva; en NULL queda pendiente sin
dueño).

**Por qué ahí y no en una automatización**: ninguna acción existente
sabe "sacar la etiqueta anterior Y asignar la conversación" — serían
dos encadenadas por `tag_added`, justo el lazo que el motor limita por
profundidad. Y no puede ser un nodo de flujo porque no hay corrida: la
anterior murió por timeout, de eso se trata. Cuesta **una consulta** en
el caso común. El bot no se reinicia: su disparador es el primer
mensaje entrante y este no lo es.

Se pone "En gestión" **antes** de sacar "No responde": el trigger
`trg_single_etapa_tag` borra la anterior al insertar la nueva, y al
revés el contacto quedaría un instante sin estado.

## Archivos en medio del guion

Una foto, un audio o un documento llegaban al motor como
`{ kind: 'text', text: '' }`, así que el bot los leía como "no entendí"
y repreguntaba. Ahora viajan como `kind: 'media'` y una corrida activa
que recibe uno **traspasa** con la nota "Mandó un archivo".

## El flujo de Kosmo (migración 050)

19 nodos: `wait` 25 s → "En gestión" → los cuatro pasos del guion. Las
cuatro etiquetas se resuelven **por nombre dentro de la cuenta** y
Matías **por email** (`saysellsmatias@gmail.com`); no hay un solo UUID
pegado a mano, y hay un test que lo verifica.

Idempotente y **no destructiva**: si el flujo ya existe por nombre se
reemplaza su contenido conservando la fila (se actualizan los campos,
se borran los nodos y se reinsertan). Borrar el flujo entero se
llevaría puestas las corridas y su historial (`flow_runs` cascadea).
Como los `node_key` no cambian, una corrida en curso sigue funcionando
después de correr la migración.

`src/lib/flows/flujo-kosmo.test.ts` **parsea el SQL** en vez de duplicar
el grafo en TypeScript, y verifica que toda referencia entre nodos
cierre y que el grafo pase el validador de activación. Un
`'positive_next', 'paso_3'` donde el nodo se llama `paso3` no lo
detecta ni Postgres (es JSONB) ni el editor: se descubriría con un lead
real, cuando la corrida muere a mitad del guion.

## Pendientes de esta sesión

- **Nada se probó contra Meta ni contra Supabase reales.** No hay
  Postgres local: las tres migraciones no se ejecutaron nunca. Lo
  verificado es la lógica pura, el motor contra un Supabase falso y la
  integridad del grafo leyendo el SQL.
- **El cron tiene que pasar a cada minuto** o el `wait` de 25 segundos
  se va a sentir como varios minutos. Es un cambio de configuración del
  pinger, fuera del repo.
- El `timeout` por nodo **no tiene UI**: se carga por JSONB.
- Un `wait` está capado a 1 hora (`MAX_WAIT_SECONDS` en `validate.ts`)
  porque mantiene la corrida activa ocupando el índice único de
  una-corrida-por-contacto. Para pausas largas, la herramienta es el
  timeout.
- La señal `senal_lead_grande` del formulario (`volumen_restock` >
  USD 3.000) del guion **no** está: es una automatización por
  `tag_added`, no parte del bot.
- La reentrada asigna la conversación **aunque ya tenga agente**. Un
  contacto en "No responde" es, por definición, uno que nadie está
  atendiendo, pero si eso molesta el cambio es una condición.

# Seguimiento del catálogo (migración 053)

Sesión 2026-09-02 (pedida por Eze). El bot de primer contacto ya está
**en producción y probado de punta a punta** (02/09: apertura,
calificación, rama de la lista y traspaso a Matías). Lo que faltaba era
qué pasa después con el lead que pidió el catálogo y no dijo nada más:
la rama de la lista terminaba en el traspaso y ahí se acababa todo.

Migración **053, no aplicada** — la aplica Emi con `npm run migrar`.
Es un parche sobre el flujo que ya está cargado: idempotente
(`ON CONFLICT (flow_id, node_key) DO UPDATE`) y no destructiva. **Ojo
con el orden**: la 050 borra y reinserta TODOS los nodos del flujo, así
que si alguna vez se vuelve a correr hay que correr detrás la 052 y la
053.

## El mapa de la rama de la lista

Antes:

```
paso3_no (senal_prefiere_chat) → paso3_lista_msg → traspaso_lista (cierra)
```

Ahora:

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

- **Las tres salidas de `lista_cierre` van al mismo `end`** a
  propósito: cualquier cosa que conteste ahí significa que hay
  conversación, y donde hay conversación el bot se corre. Lo que ese
  nodo aporta no es la ramificación sino el reloj.
- **El silencio del `seguimiento` es un traspaso, no un "No
  responde"**: a esa persona ya le mandamos el catálogo y su
  conversación es de Matías. La política de la cuenta diría lo otro y
  estaría mal, por eso el nodo se la sobreescribe.
- **Si Matías contesta en cualquier momento de esas 24 horas**, la
  corrida pasa a `paused_by_agent` (`send-message.ts`, cerca de la
  línea 515) y el seguimiento no sale. Eso es lo buscado, no un efecto
  colateral: hay test.
- Las 24 horas las cuenta el barrido de `/api/flows/cron`, que corre
  cada minuto por pg_cron. Para una espera de un día, sobra.
- Nada hardcodeado: la cuenta sale del perfil `saysellsmatias@gmail.com`
  y el flujo de su nombre (`Bot de primer contacto`), igual que la 050.
- `src/lib/flows/seguimiento-catalogo.test.ts` arma el grafo leyendo
  **las tres migraciones en orden** (050 carga, 052 saca el `espera`,
  053 cuelga el seguimiento) y verifica que toda referencia cierre y
  que pase el validador de activación sin una sola advertencia.

## Pendientes de esta sesión

- **La 053 no se corrió nunca**: no hay Postgres local. Lo verificado
  es la lógica pura, el motor contra un Supabase falso y la integridad
  del grafo leyendo el SQL.
- Ni el `next_node_key` del traspaso ni el `timeout` por nodo tienen
  formulario en el editor: se cargan por JSONB.
- El seguimiento sale **una sola vez**. Si el lead tampoco contesta
  eso, es un traspaso y ahí queda; no hay una segunda insistencia.
- Un lead que reciba el catálogo y no conteste nada tiene la corrida
  viva ~48 horas (24 del cierre + 24 del seguimiento) ocupando el
  índice único de una-corrida-por-contacto. En ese lapso no se le puede
  disparar otro flujo.

# Marca · acento Saysells e íconos

Sesión 2026-09-03 (pedida por Eze). La Bandeja se servía con la marca
del template original: violeta Hostinger y un bocadillo de chat
genérico. Entraron los colores de marca y el glifo de WhatsApp, y
nada más — ni un layout, ni un espaciado, ni un componente. Sin SQL.

## El acento `saysells`

Sexto acento del catálogo de `src/lib/themes.ts`, y **el nuevo
`DEFAULT_THEME`**. Los otros cinco siguen en el selector: el boot
script de `layout.tsx` filtra por `THEME_IDS`, así que quien ya eligió
uno lo conserva y el default solo aplica a cuentas nuevas y a quien
nunca eligió. `:root` pasó de sembrar violet a sembrar saysells, para
que el fallback previo a JS sea el default real.

**Es el único acento que cambia con el modo**, y por eso es el único
que agrega un `html[data-mode="light"][data-theme="saysells"]` encima
de su bloque base. El resto de los acentos son ciegos al modo: el
encabezado de `globals.css` dice que ACCENT y MODE escriben variables
disjuntas, y eso se mantiene — el bloque extra toca tokens de acento
nada más.

| Token | Oscuro (default) | Claro |
| --- | --- | --- |
| `--primary` | `oklch(0.55 0.15 263)` navy elevado | `oklch(0.291 0.057 262.6)` navy `#1C2B48` |
| `--primary-foreground` | blanco, **4.75:1** | casi blanco, **13.5:1** |
| `--primary-hover` | `oklch(0.62 0.14 263)` | `oklch(0.36 0.062 262.6)` |
| `--primary-soft` / `-2` | celeste `/0.12` y `/0.22` | navy `/0.1` y `/0.18` |
| `--ring`, `--sidebar-ring` | celeste `#8EB1D1` | navy |
| `--chart-2` | naranja `#E84419` | naranja `#E84419` |

- **El navy `#1C2B48` no puede ser el relleno de los botones en
  oscuro**: es `oklch(0.291 …)` y desaparece sobre las superficies
  negras. En oscuro va un navy **elevado**, que es el tono del navy de
  marca con la luminosidad y el croma que hacen legible a cobalt.
- **El celeste tampoco puede ser el primario en oscuro**, aunque sea
  la tentación obvia: `oklch(0.746 …)` es casi blanco, y como
  `bg-primary` deja las **burbujas de mensaje enviado de la Bandeja**
  en pastel con tinta oscura, que no se leen como enviadas. Se probó y
  se revirtió en la misma sesión. El celeste se queda con lo que un
  pastel hace bien: los dos `--primary-soft` y el anillo de foco,
  donde va **sobre** una superficie oscura en vez de debajo de tinta
  oscura (8.4:1 sobre `card`).
- **El naranja `#E84419` es `--chart-2`**, el único lugar donde
  aterriza. Los otros cinco temas eligen ahí un tono vecino; este
  tenía un color de marca esperando el puesto, y una segunda serie de
  gráfico es exactamente el "acento puntual" que el naranja es en la
  paleta.
- **El fondo claro `#F4F6F8` no se usa**: `--background` es un token
  de MODO, compartido por los seis acentos. Escribirlo desde el bloque
  de un acento rompería esa separación.
- `text-primary` sobre `card` en oscuro da **3.80:1**. No es un
  defecto del tema: violet da 3.08:1 y cobalt 4.45:1 en la misma
  medición. Subir eso es una decisión que afecta a los seis.

## `WhatsAppGlyph` — una sola definición del glifo

`src/components/brand/whatsapp-glyph.tsx`. Antes el bocadillo aparecía
en cinco lugares con **dos dibujos distintos**: el favicon tenía path
propio y el sidebar más las tres pantallas de auth usaban el
`MessageSquare` de lucide. Es la marca real de WhatsApp (bocadillo con
cola y el tubo adentro), no un bocadillo genérico.

- **Un solo color, a propósito**: el bocadillo se pinta con
  `currentColor` y el tubo se cala con `fill-rule: evenodd`, así que
  el tubo es un **agujero** que deja ver lo que hay detrás. Con eso el
  mismo marcado sirve sobre el `bg-primary` del sidebar, sobre el
  `bg-primary/10` de las pantallas de auth y sobre el navy plano del
  favicon **sin nombrar un color en el componente**: lo decide el
  tema. No hay un color de marca suelto en ningún componente.
- **`icon.tsx` importa el path (`WHATSAPP_GLYPH_PATH`), no el
  componente**: `ImageResponse` renderiza por satori, que no entiende
  clases de Tailwind y quiere `width`/`height` explícitos.
- **El cuadrado del sidebar sigue siendo `bg-primary` con tinta
  `text-primary-foreground`**, no un navy fijo. Hardcodearlo le pondría
  el cuadrado navy también a quien elige emerald o rose. Consecuencia
  a tener presente: con saysells da navy + blanco en claro, pero
  **celeste + navy en oscuro**, que es el modo por defecto.
- `MessageSquare` sigue importado en `sidebar.tsx`: es el ícono de la
  entrada "Bandeja" del nav, que no es la marca.
- El `UsersRound` de las invitaciones (login, signup, `join/[token]`)
  no se tocó: ese no es el glifo de marca.

## Favicon

`src/app/icon.tsx` lo genera con `ImageResponse` en runtime **edge** —
no es un `.ico` en disco, y no puede traer assets ni imágenes: por eso
el glifo es path inline. Cuadrado navy `#1C2B48` con el bocadillo
blanco y el tubo calado, o sea la marca real invertida.

- **El navy queda hardcodeado a propósito**: es un PNG de build, no ve
  las variables CSS, y un favicon no puede seguir el acento de cada
  usuario. Espeja el navy que hay detrás del `--primary` del tema.
- **La versión de contorno no sirve a 32×32**: el aro queda por debajo
  del píxel y el tubo se hace papilla. Se comprobó renderizando el
  ícono a tamaño real y mirándolo, no por deducción.

## Pendientes de esta sesión

- **Nada se vio en un navegador.** Lo verificado es: el favicon
  renderizado de verdad a 32×32 y mirado, la cascada CSS resuelta para
  los 6 temas × 2 modos (sin variables faltantes, y los otros cinco
  resolviendo igual que antes), los contrastes calculados, la lógica
  del boot script ejercitada y `npm run build` completo con las
  variables dummy del CI.
- **El chip del selector de temas es un solo string** (`ThemeMeta.swatch`)
  y muestra el primario de oscuro. En modo claro el tema aplica el navy
  plano, así que ahí el chip no coincide. Arreglarlo pide un campo más
  y tocar el panel de Apariencia.
- El glifo del sidebar quedó en `h-4 w-4`, el tamaño que ya tenía. Al
  ser relleno y no trazo ocupa un poco menos que la proporción del
  favicon (22/32); subirlo a `h-5` lo emparejaría, pero es un cambio
  de tamaño que esta sesión no tenía permitido hacer.
- Ningún test cubre el catálogo de temas ni el CSS: no había pruebas
  de eso antes y no se agregaron.
