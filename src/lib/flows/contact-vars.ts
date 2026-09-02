/**
 * Las variables del contacto que un flujo puede meter en un mensaje.
 *
 * Hasta ahora los textos solo interpolaban `{{vars.x}}` — lo que el
 * propio flujo había capturado. Un bot que abre con "Hola, te escribe
 * Kosmo" cuando el formulario ya trajo el nombre y el rubro está
 * tirando a la basura lo único que sabe de la persona.
 *
 * Tres variables, todas con un valor razonable cuando el dato falta,
 * porque el dato falta seguido:
 *
 *   `{{contact.nombre}}`        primera palabra de `contacts.name`
 *   `{{contact.nombre_coma}}`   " Juan," — el nombre con su coma
 *   `{{contact.tipo_negocio}}`  el campo de Tally, o "tu negocio"
 *
 * Además, cualquier `{{contact.<field_name>}}` que coincida con un
 * campo personalizado de la cuenta se resuelve solo: los valores ya
 * están cargados para `tipo_negocio`, así que exponer el resto no
 * cuesta una consulta más y evita tener que tocar el motor cada vez
 * que el formulario suma una pregunta.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** Lo que se pone cuando el contacto no tiene tipo de negocio. */
export const NEGOCIO_POR_DEFECTO = "tu negocio";

/**
 * True si el "nombre" es en realidad un número.
 *
 * Un contacto creado por el webhook de Meta se llama como su teléfono
 * ("5491122334455"), y "Hola 5491122334455, te escribe Kosmo" es peor
 * que no saludar por nombre. Mismo criterio que `looksLikeIdentifier`
 * en la integración de Tally, más el `+` del formato internacional.
 */
function esNumero(text: string): boolean {
  return /^[+\d\s().-]+$/.test(text) && /\d/.test(text);
}

/**
 * Primera palabra de `contacts.name`. Vacío si no hay nombre, si es un
 * teléfono, o si lo que hay son solo espacios.
 */
export function primerNombre(name: string | null | undefined): string {
  const clean = (name ?? "").trim();
  if (!clean || esNumero(clean)) return "";
  return clean.split(/\s+/)[0] ?? "";
}

export interface ContactVarsInput {
  name: string | null | undefined;
  /** Campos personalizados del contacto, indexados por `field_name`. */
  customValues: Record<string, string>;
}

export type ContactVars = Record<string, string>;

/**
 * Arma el diccionario que ve la interpolación. Puro: la parte con red
 * es `loadContactVars`.
 */
export function buildContactVars(input: ContactVarsInput): ContactVars {
  const vars: ContactVars = {};

  // Los campos personalizados van primero para que las tres variables
  // derivadas de abajo siempre le ganen a un campo que se llame igual.
  for (const [field, value] of Object.entries(input.customValues)) {
    const clean = (value ?? "").trim();
    if (clean) vars[field] = clean;
  }

  const nombre = primerNombre(input.name);
  vars.nombre = nombre;
  // Con nombre: " Juan,". Sin nombre: ",". Así "Hola{{contact.nombre_coma}}
  // te escribe Kosmo." sale "Hola Juan, te escribe Kosmo." o
  // "Hola, te escribe Kosmo." — las dos formas que pide el guion. La
  // coma se queda incluso sin nombre porque la alternativa ("Hola te
  // escribe Kosmo.") no es castellano.
  vars.nombre_coma = nombre ? ` ${nombre},` : ",";

  const negocio = (input.customValues.tipo_negocio ?? "").trim();
  vars.tipo_negocio = negocio ? negocio.toLocaleLowerCase("es-AR") : NEGOCIO_POR_DEFECTO;

  return vars;
}

/**
 * Lee el contacto y sus campos personalizados. Dos consultas simples
 * en vez de un select anidado: es el mismo patrón que
 * `loadContactFormValues` de la Bandeja, y ante un error devuelve lo
 * que pueda en vez de romper la corrida — un mensaje sin nombre se
 * entiende, una corrida caída no.
 */
export async function loadContactVars(
  db: SupabaseClient,
  contactId: string,
): Promise<ContactVars> {
  const [contactRes, valuesRes, fieldsRes] = await Promise.all([
    db.from("contacts").select("name").eq("id", contactId).maybeSingle(),
    db
      .from("contact_custom_values")
      .select("custom_field_id, value")
      .eq("contact_id", contactId),
    db.from("custom_fields").select("id, field_name"),
  ]);

  const nameById = new Map(
    ((fieldsRes.data ?? []) as { id: string; field_name: string }[]).map((f) => [
      f.id,
      f.field_name,
    ]),
  );
  const customValues: Record<string, string> = {};
  for (const row of (valuesRes.data ?? []) as {
    custom_field_id: string;
    value?: string | null;
  }[]) {
    const field = nameById.get(row.custom_field_id);
    if (!field) continue;
    customValues[field] = row.value ?? "";
  }

  return buildContactVars({
    name: (contactRes.data as { name?: string | null } | null)?.name ?? null,
    customValues,
  });
}
