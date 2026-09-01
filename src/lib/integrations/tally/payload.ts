// ============================================================
// Mapeo del payload de Tally → contacto + campos personalizados.
//
// Parte PURA: no toca la base ni la red, así el mapeo (que es lo que
// se rompe cuando alguien edita el formulario) se testea con un
// payload de ejemplo y nada más.
//
// La clave de unión es el LABEL de la pregunta, no el `key`
// (`question_XXXX`): el key cambia cuando se rehace la pregunta, el
// label es lo que la persona ve y lo que quedó en el export. Por eso
// se mapean las DOS versiones del formulario — la de julio de 2026
// ("Contanos brevemente de tu local", "Nombre de tu tienda") y la
// actual — contra el mismo destino.
//
// Los labels se comparan normalizados (sin acentos, sin signos, en
// minúscula) para que un "¿Qué tipo de negocio tenés?" siga
// mapeando aunque alguien le saque los signos de pregunta.
//
// Un label que no está en la tabla se IGNORA: el catálogo de campos
// personalizados de la cuenta no crece solo porque alguien agregó
// una pregunta al formulario.
//
// "Nombre" aparece DOS veces en el formulario de Kosmo: la primera
// es el nombre de la persona, la segunda es el CUIT/DNI (en el export
// CSV figura como "Nombre (2)"). Se resuelve por orden en `fields[]`:
// la primera ocurrencia va al nombre, las siguientes a `cuit_dni`.
// Y como guarda, un valor que iría a `contacts.name` pero es solo
// dígitos, guiones, puntos o espacios tampoco se usa como nombre (el contacto
// conserva el que tenga) y se guarda como `cuit_dni`. Mismo criterio
// para "Apellido".
// ============================================================

import { normalizeArgentinePhone } from "@/lib/phone/normalize-ar";
import { isValidE164 } from "@/lib/whatsapp/phone-utils";

export interface TallyFieldOption {
  id?: string;
  text?: string;
}

export interface TallyField {
  key?: string;
  label?: string;
  type?: string;
  value?: unknown;
  /** Presente en preguntas de opción: `value` trae ids, no texto. */
  options?: TallyFieldOption[];
}

export interface TallyPayload {
  eventType?: string;
  createdAt?: string;
  data?: {
    responseId?: string;
    submissionId?: string;
    createdAt?: string;
    fields?: TallyField[];
  };
}

// Destinos que van a columnas de `contacts`, no a campos
// personalizados. El prefijo `@` no puede chocar con un field_name.
const FIRST_NAME = "@first_name";
const LAST_NAME = "@last_name";
const PHONE = "@phone";
const EMAIL = "@email";
const COMPANY = "@company";

/**
 * Campos personalizados que crea/actualiza la integración, en el
 * orden en que se documentan. Los dos últimos son derivados (no son
 * preguntas del formulario) y sirven para la idempotencia y para
 * saber de qué envío salió la ficha.
 */
export const TALLY_CUSTOM_FIELDS = [
  "cuit_dni",
  "tienda_online",
  "volumen_restock",
  "provincia",
  "tipo_negocio",
  "descripcion_local",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "tally_response_id",
  "tally_submitted_at",
] as const;

/** Campo personalizado donde va el CUIT o DNI (segundo "Nombre"). */
export const TALLY_CUIT_DNI_FIELD = "cuit_dni";

/** Campo personalizado donde vive el id del envío (idempotencia). */
export const TALLY_RESPONSE_ID_FIELD = "tally_response_id";
export const TALLY_SUBMITTED_AT_FIELD = "tally_submitted_at";

/** Etiqueta que se le pone a todo contacto que entra por el formulario. */
export const TALLY_ORIGIN_TAG = "origen_form";

/**
 * Label normalizado → destino. Las dos versiones del formulario
 * conviven acá: una fila por label real visto en el export.
 */
const DESTINATION_BY_LABEL: Record<string, string> = {
  // ---- versión actual (export del 01/09/2026) ----
  nombre: FIRST_NAME,
  apellido: LAST_NAME,
  whatsapp: PHONE,
  email: EMAIL,
  "vendes por tienda online": "tienda_online",
  "que volumen invertis en restock por mes": "volumen_restock",
  "en que provincia estas": "provincia",
  "que tipo de negocio tenes": "tipo_negocio",
  "utm source": "utm_source",
  "utm medium": "utm_medium",
  "utm campaign": "utm_campaign",
  "utm content": "utm_content",
  // ---- versión vieja (julio 2026) ----
  "contanos brevemente de tu local": "descripcion_local",
  "nombre de tu tienda": COMPANY,
};

/**
 * Clave de comparación de labels: sin acentos, sin signos (¿? incluidos),
 * en minúscula y con un solo espacio entre palabras. `utm_source` y
 * `utm-source` caen en la misma clave que "utm source".
 */
export function normalizeLabel(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Un valor de opción múltiple llega como id (`"a1b2…"`) con el texto
 * en `options`. Se resuelve a texto; si no hay opción que matchee, se
 * devuelve tal cual (una respuesta libre ya es su propio texto).
 */
function resolveOption(field: TallyField, raw: unknown): string {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  const option = field.options?.find((o) => o.id === text);
  if (!option) return text;
  return String(option.text ?? "").trim();
}

/**
 * True si el texto es solo dígitos, guiones, puntos o espacios: un CUIT
 * (`20-12345678-9`), un DNI (`43228684`, `43.228.684`) o cualquier
 * identificador numérico, pero nunca el nombre de una persona.
 * "Local 3 Hermanos" tiene letras y sigue siendo un nombre.
 */
export function looksLikeIdentifier(text: string): boolean {
  return /^[\d\s.-]+$/.test(text) && /\d/.test(text);
}

/** El valor de un campo, ya como texto plano listo para guardar. */
export function fieldValueToText(field: TallyField): string {
  const value = field.value;
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (Array.isArray(value)) {
    return value
      .map((item) => resolveOption(field, item))
      .filter(Boolean)
      .join(", ");
  }
  // Formas que no mapeamos (subida de archivos, matrices): se ignoran
  // en vez de guardar "[object Object]".
  if (typeof value === "object") return "";
  return resolveOption(field, value);
}

export interface MappedSubmission {
  responseId: string;
  /** ISO del envío según Tally, o null si el payload no lo trae. */
  submittedAt: string | null;
  /** Ya normalizado a la forma de WhatsApp; null si no es usable. */
  phone: string | null;
  /**
   * Nombre + Apellido, o null. Null también cuando lo que vino como
   * nombre era un identificador numérico: el contacto conserva el que
   * tenga (o queda con el teléfono, igual que uno del webhook).
   */
  name: string | null;
  email: string | null;
  company: string | null;
  /** field_name → valor, solo con lo que efectivamente vino. */
  customValues: Record<string, string>;
}

export class TallyPayloadError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "TallyPayloadError";
    this.status = status;
  }
}

/**
 * Traduce un `FORM_RESPONSE` de Tally a lo que hay que escribir.
 *
 * Lanza `TallyPayloadError` 400 si el sobre no es el esperado (sin
 * responseId no hay idempotencia posible) y 422 si el envío no trae
 * un teléfono usable — sin teléfono no hay contacto que crear.
 */
export function mapTallySubmission(payload: TallyPayload): MappedSubmission {
  const responseId = String(payload?.data?.responseId ?? "").trim();
  if (!responseId) {
    throw new TallyPayloadError("data.responseId is required", 400);
  }

  const fields = Array.isArray(payload?.data?.fields)
    ? (payload.data!.fields as TallyField[])
    : [];

  let firstName = "";
  let lastName = "";
  let email = "";
  let company = "";
  let rawPhone = "";
  let cuitDni = "";
  // Cuántos campos ya cayeron en cada parte del nombre: la segunda
  // ocurrencia de "Nombre" (o de "Apellido") no es un nombre, es el
  // CUIT/DNI.
  let firstNameSeen = 0;
  let lastNameSeen = 0;
  const customValues: Record<string, string> = {};

  // Un valor que iría al nombre pero no parece un nombre. Va a
  // cuit_dni SOLO si no hay un candidato mejor: el segundo "Nombre"
  // explícito le gana.
  const keepAsIdentifier = (text: string) => {
    if (!cuitDni) cuitDni = text;
  };

  for (const field of fields) {
    const destination = DESTINATION_BY_LABEL[normalizeLabel(field?.label ?? "")];
    if (!destination) continue;

    const text = fieldValueToText(field);
    if (!text) continue;

    switch (destination) {
      case FIRST_NAME:
        if (firstNameSeen++ > 0) {
          cuitDni = text;
        } else if (looksLikeIdentifier(text)) {
          keepAsIdentifier(text);
        } else {
          firstName = text;
        }
        break;
      case LAST_NAME:
        if (lastNameSeen++ > 0) {
          cuitDni = text;
        } else if (looksLikeIdentifier(text)) {
          keepAsIdentifier(text);
        } else {
          lastName = text;
        }
        break;
      case PHONE:
        rawPhone = text;
        break;
      case EMAIL:
        email = text;
        break;
      case COMPANY:
        company = text;
        break;
      default:
        customValues[destination] = text;
    }
  }

  const phone = normalizeArgentinePhone(rawPhone);
  if (!phone || !isValidE164(phone)) {
    throw new TallyPayloadError(
      `Submission ${responseId} has no usable phone number`,
      422,
    );
  }

  const submittedAt =
    typeof payload?.data?.createdAt === "string" && payload.data.createdAt
      ? payload.data.createdAt
      : typeof payload?.createdAt === "string" && payload.createdAt
        ? payload.createdAt
        : null;

  if (cuitDni) customValues[TALLY_CUIT_DNI_FIELD] = cuitDni;

  // Derivados: el id del envío es la clave de idempotencia y queda a
  // la vista en la ficha; la fecha dice de cuándo es la respuesta.
  customValues[TALLY_RESPONSE_ID_FIELD] = responseId;
  if (submittedAt) customValues[TALLY_SUBMITTED_AT_FIELD] = submittedAt;

  const name = [firstName, lastName].filter(Boolean).join(" ").trim();

  return {
    responseId,
    submittedAt,
    phone,
    name: name || null,
    email: email || null,
    company: company || null,
    customValues,
  };
}
