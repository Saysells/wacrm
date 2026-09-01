// ============================================================
// Escritura del envío de Tally: contacto + campos personalizados +
// etiqueta de origen.
//
// Acceso a la base: el MISMO que el webhook de Meta — cliente admin
// del servidor (service_role). No hay sesión: quien postea es Tally,
// no una persona logueada, así que no hay RLS que aplicar y la ruta
// nunca corre en el navegador.
//
// Cuenta destino — cómo se resuelve, y por qué así:
//   El webhook de Meta saca la cuenta del `phone_number_id` que viene
//   en el payload: busca la fila de `whatsapp_config` con ese número y
//   usa su `account_id` (tenencia) y su `user_id` (auditoría). El
//   payload de Tally NO trae ningún identificador de cuenta, así que:
//     1. Si está `TALLY_ACCOUNT_ID`, esa es la cuenta. Es lo que hay
//        que cargar en cualquier instancia con más de una cuenta.
//     2. Si no, y hay exactamente UNA fila en `whatsapp_config`, se
//        usa esa — la misma fila que el webhook habría matcheado, solo
//        que sin necesitar el phone_number_id para elegirla.
//     3. Con 0 o ≥2 filas y sin la variable: error, y el log dice que
//        hay que cargar TALLY_ACCOUNT_ID. Adivinar cuenta sería
//        meterle los leads de un cliente a otro.
//
// Idempotencia: el `responseId` del envío se guarda como campo
// personalizado `tally_response_id`. Antes de escribir nada se
// pregunta si ya existe un contacto con ese valor; si sí, no se toca
// nada. Tally reintenta las entregas fallidas, así que el mismo envío
// llega más de una vez de forma normal, no excepcional.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { findOrCreateContact, resolveAuditUserId } from "@/lib/api/v1/contacts";
import { DEFAULT_TAG_COLOR } from "@/lib/contacts/tag-colors";
import { addContactTagAndDispatch } from "@/lib/contacts/tag-events";
import {
  TALLY_ORIGIN_TAG,
  TALLY_RESPONSE_ID_FIELD,
  type MappedSubmission,
} from "./payload";

export class TallyIngestError extends Error {
  readonly status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.name = "TallyIngestError";
    this.status = status;
  }
}

export interface TallyTarget {
  accountId: string;
  /** Sender-of-record para las filas con `user_id` NOT NULL. */
  auditUserId: string;
}

/** Ver el bloque de arriba: env primero, `whatsapp_config` única después. */
export async function resolveTallyTarget(
  db: SupabaseClient,
): Promise<TallyTarget> {
  const fromEnv = process.env.TALLY_ACCOUNT_ID?.trim();
  if (fromEnv) {
    return { accountId: fromEnv, auditUserId: await resolveAuditUserId(db, fromEnv) };
  }

  const { data: configs, error } = await db
    .from("whatsapp_config")
    .select("account_id, user_id");

  if (error) {
    throw new TallyIngestError("No se pudo resolver la cuenta destino", 500);
  }
  if (!configs || configs.length === 0) {
    throw new TallyIngestError(
      "No hay ninguna cuenta con WhatsApp conectado. Cargá TALLY_ACCOUNT_ID " +
        "con el id de la cuenta que recibe los leads del formulario.",
      500,
    );
  }
  if (configs.length > 1) {
    throw new TallyIngestError(
      `Hay ${configs.length} cuentas con WhatsApp conectado y el payload de ` +
        "Tally no dice a cuál va. Cargá TALLY_ACCOUNT_ID.",
      500,
    );
  }

  return {
    accountId: configs[0].account_id as string,
    auditUserId: configs[0].user_id as string,
  };
}

/** field_name → id, creando las definiciones que falten. */
async function ensureCustomFields(
  db: SupabaseClient,
  target: TallyTarget,
  names: string[],
): Promise<Map<string, string>> {
  const { data: existing, error } = await db
    .from("custom_fields")
    .select("id, field_name")
    .eq("account_id", target.accountId);

  if (error) {
    throw new TallyIngestError("No se pudieron leer los campos personalizados");
  }

  // Comparación sin mayúsculas: si alguien ya creó "Provincia" a mano
  // no se agrega un segundo "provincia" al lado.
  const byKey = new Map<string, string>();
  for (const row of existing ?? []) {
    byKey.set(String(row.field_name).trim().toLowerCase(), row.id as string);
  }

  const missing = names.filter((name) => !byKey.has(name.toLowerCase()));
  if (missing.length > 0) {
    const { data: created, error: insertError } = await db
      .from("custom_fields")
      .insert(
        missing.map((field_name) => ({
          account_id: target.accountId,
          user_id: target.auditUserId,
          field_name,
          field_type: "text",
        })),
      )
      .select("id, field_name");

    if (insertError || !created) {
      throw new TallyIngestError("No se pudieron crear los campos personalizados");
    }
    for (const row of created) {
      byKey.set(String(row.field_name).trim().toLowerCase(), row.id as string);
    }
  }

  return byKey;
}

/**
 * True si este `responseId` ya se procesó. Se apoya en el campo
 * `tally_response_id`: si la definición todavía no existe, no puede
 * haber ningún envío previo. El valor cuelga de un campo que ya está
 * limitado a la cuenta, así que no hace falta filtrar por contacto.
 */
async function alreadyIngested(
  db: SupabaseClient,
  target: TallyTarget,
  responseId: string,
): Promise<string | null> {
  const { data: field } = await db
    .from("custom_fields")
    .select("id")
    .eq("account_id", target.accountId)
    .eq("field_name", TALLY_RESPONSE_ID_FIELD)
    .maybeSingle();

  if (!field?.id) return null;

  const { data: rows } = await db
    .from("contact_custom_values")
    .select("contact_id")
    .eq("custom_field_id", field.id as string)
    .eq("value", responseId)
    .limit(1);

  return rows && rows.length > 0 ? (rows[0].contact_id as string) : null;
}

/** La etiqueta de origen, creándola si no existe. */
async function ensureOriginTag(
  db: SupabaseClient,
  target: TallyTarget,
): Promise<string> {
  const { data: existing } = await db
    .from("tags")
    .select("id, name")
    .eq("account_id", target.accountId)
    .ilike("name", TALLY_ORIGIN_TAG)
    .limit(1);

  if (existing && existing.length > 0) return existing[0].id as string;

  const { data: created, error } = await db
    .from("tags")
    .insert({
      account_id: target.accountId,
      user_id: target.auditUserId,
      name: TALLY_ORIGIN_TAG,
      color: DEFAULT_TAG_COLOR,
    })
    .select("id")
    .single();

  if (error || !created) {
    // 23505 = la unique de nombre por cuenta (migración 043) rechazó
    // una carrera: la fila ganadora ya está, se relee.
    const { data: raced } = await db
      .from("tags")
      .select("id")
      .eq("account_id", target.accountId)
      .ilike("name", TALLY_ORIGIN_TAG)
      .limit(1);
    if (raced && raced.length > 0) return raced[0].id as string;
    throw new TallyIngestError("No se pudo crear la etiqueta de origen");
  }

  return created.id as string;
}

export type TallyIngestOutcome = "created" | "updated" | "duplicate";

export interface TallyIngestResult {
  outcome: TallyIngestOutcome;
  contactId: string;
}

export async function ingestTallySubmission(
  db: SupabaseClient,
  target: TallyTarget,
  submission: MappedSubmission,
): Promise<TallyIngestResult> {
  const seen = await alreadyIngested(db, target, submission.responseId);
  if (seen) return { outcome: "duplicate", contactId: seen };

  // Find-or-create por el camino que ya existe (mismo `findExistingContact`
  // + backstop de unique que usan el webhook de Meta y la API pública),
  // así el contacto del formulario es indistinguible de uno creado por
  // un mensaje entrante. El teléfono ya viene normalizado.
  const contact = await findOrCreateContact(db, target.accountId, target.auditUserId, {
    phone: submission.phone!,
    name: submission.name,
    email: submission.email,
    company: submission.company,
  });

  // 24 de los 522 envíos del export repiten teléfono: el receptor
  // ACTUALIZA lo que el formulario trajo en vez de duplicar. Solo se
  // pisa lo que vino con contenido — un envío sin email no borra el
  // que ya estaba, y el nombre real del formulario sí le gana al
  // nombre de perfil de WhatsApp.
  if (!contact.created) {
    const patch: Record<string, string> = {};
    if (submission.name) patch.name = submission.name;
    if (submission.email) patch.email = submission.email;
    if (submission.company) patch.company = submission.company;
    if (Object.keys(patch).length > 0) {
      patch.updated_at = new Date().toISOString();
      const { error } = await db
        .from("contacts")
        .update(patch)
        .eq("id", contact.id)
        .eq("account_id", target.accountId);
      if (error) {
        throw new TallyIngestError("No se pudo actualizar el contacto");
      }
    }
  }

  // ---- campos personalizados ----------------------------------
  const names = Object.keys(submission.customValues);
  if (names.length > 0) {
    const fieldIds = await ensureCustomFields(db, target, names);
    const rows = names
      .map((name) => ({
        contact_id: contact.id,
        custom_field_id: fieldIds.get(name.toLowerCase()),
        value: submission.customValues[name],
      }))
      .filter((row) => Boolean(row.custom_field_id));

    if (rows.length > 0) {
      // UNIQUE(contact_id, custom_field_id) desde la 001: un reenvío
      // con respuestas corregidas pisa el valor viejo en vez de sumar
      // una segunda fila.
      const { error } = await db
        .from("contact_custom_values")
        .upsert(rows, { onConflict: "contact_id,custom_field_id" });
      if (error) {
        throw new TallyIngestError(
          `No se pudieron guardar las respuestas: ${error.message}`,
        );
      }
    }
  }

  // ---- etiqueta de origen -------------------------------------
  // Por el camino compartido: valida tenencia, trata el duplicado como
  // no-op y dispara las automatizaciones de tag_added. No hay una
  // segunda forma de escribir contact_tags.
  const tagId = await ensureOriginTag(db, target);
  await addContactTagAndDispatch({
    db,
    accountId: target.accountId,
    contactId: contact.id,
    tagId,
  });

  return {
    outcome: contact.created ? "created" : "updated",
    contactId: contact.id,
  };
}
