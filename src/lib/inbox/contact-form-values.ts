// ============================================================
// Los campos personalizados del contacto, para el sidebar de la
// Bandeja.
//
// El sidebar mostraba oportunidades, notas y etiquetas, pero NO los
// valores de `contact_custom_values` — que es justo donde caen las
// respuestas del formulario de Tally. Con el embudo del formulario
// andando, quien atiende el hilo necesita ver "¿qué contestó esta
// persona?" sin salir de la conversación.
//
// Parte pura (`pairFieldValues`) separada de la parte con red
// (`loadContactFormValues`), igual que contact-tags.ts: el pareo
// —que es lo que puede romperse— se testea sin DOM y sin base.
//
// Es de SOLO LECTURA. Editar valores ya se hace en Contactos →
// Editar contacto, y duplicar esa escritura acá sería un segundo
// camino a la misma tabla.
//
// Los campos cuyo nombre empieza con `tally_` (`tally_response_id`,
// `tally_submitted_at`) son de sistema: los escribe la integración
// para la idempotencia y la trazabilidad, no para quien atiende. Se
// filtran acá, en el loader, y no en la base (marcarlos en
// `custom_fields` sería una columna nueva = SQL). Siguen visibles en
// Contactos → Editar contacto, que lista el catálogo completo.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import type { CustomField } from '@/types';

/** Prefijo de los campos de sistema que la integración de Tally escribe. */
const SYSTEM_FIELD_PREFIX = 'tally_';

/** True si el campo es de sistema y no debe mostrarse en la Bandeja. */
export function isSystemField(fieldName: string): boolean {
  return fieldName.trim().toLowerCase().startsWith(SYSTEM_FIELD_PREFIX);
}

export interface ContactFieldValue {
  fieldId: string;
  /** El `field_name` del catálogo, tal cual lo ve un admin en Configuración. */
  name: string;
  value: string;
}

/**
 * Cruza el catálogo de campos de la cuenta con los valores de este
 * contacto. Descarta los campos sin valor (y los valores en blanco):
 * la sección lista lo que la persona efectivamente contestó, no el
 * catálogo entero con huecos.
 *
 * Un valor cuyo campo ya no existe en el catálogo también se
 * descarta — sin nombre no hay nada que mostrar. Y los campos de
 * sistema (`tally_*`) se ocultan: ver el bloque de arriba.
 */
/** Fila de `contact_custom_values` tal como la devuelve la base:
 *  `value` es una columna nullable, aunque el tipo del front la
 *  declare solo opcional. */
interface CustomValueRow {
  custom_field_id: string;
  value?: string | null;
}

export function pairFieldValues(
  fields: Pick<CustomField, 'id' | 'field_name'>[],
  values: CustomValueRow[]
): ContactFieldValue[] {
  const nameById = new Map(fields.map((f) => [f.id, f.field_name]));

  return values
    .map((v) => ({
      fieldId: v.custom_field_id,
      name: nameById.get(v.custom_field_id) ?? '',
      value: (v.value ?? '').trim(),
    }))
    .filter((row) => row.name && row.value && !isSystemField(row.name))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Los valores del contacto, listos para pintar. Dos lecturas: el
 * catálogo (la RLS de `custom_fields` ya lo limita a la cuenta) y los
 * valores del contacto. Ante un error devuelve vacío — la sección se
 * oculta sola, que es mejor que romper el sidebar entero.
 */
export async function loadContactFormValues(
  db: SupabaseClient,
  contactId: string
): Promise<ContactFieldValue[]> {
  const [fieldsRes, valuesRes] = await Promise.all([
    db.from('custom_fields').select('id, field_name'),
    db
      .from('contact_custom_values')
      .select('custom_field_id, value')
      .eq('contact_id', contactId),
  ]);

  if (fieldsRes.error || valuesRes.error) return [];

  return pairFieldValues(fieldsRes.data ?? [], valuesRes.data ?? []);
}
