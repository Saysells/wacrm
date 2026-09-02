// ============================================================
// La ficha se entera sola de lo que cambia el CRM.
//
// El puente CRM → Bandeja escribe por `PATCH /api/v1/contacts/{id}`
// (etiquetas y fecha_llamada) con service_role: la ficha abierta no se
// entera salvo que relea. La migracion 047 puso `contact_tags` y
// `contacts` en la publicacion `supabase_realtime` (con REPLICA
// IDENTITY FULL en contact_tags para que el DELETE traiga el
// contact_id y pase el filtro). Mismo patron que use-realtime.ts:
// un canal por contacto, y se saca al desmontar o cambiar de contacto.
//
// Separado del componente para poder probar con un mock del cliente
// que la suscripcion se arma con el filtro correcto y se limpia.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

export function contactChannelName(contactId: string): string {
  return `contact:${contactId}`;
}

/**
 * Se suscribe a los cambios del contacto y devuelve la funcion que
 * desuscribe. `onChange` se llama ante cualquier evento; quien lo usa
 * relee todo (`fetchContactData`) en vez de aplicar el payload: la
 * base es la fuente de verdad y el payload de un DELETE no trae la
 * etiqueta joineada.
 */
export function subscribeToContactChanges(
  db: SupabaseClient,
  contactId: string,
  onChange: () => void
): () => void {
  const byContact = `contact_id=eq.${contactId}`;
  const channel = db
    .channel(contactChannelName(contactId))
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'contact_tags', filter: byContact },
      () => onChange()
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'contact_tags', filter: byContact },
      () => onChange()
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'contacts', filter: `id=eq.${contactId}` },
      () => onChange()
    )
    .subscribe();

  return () => {
    void db.removeChannel(channel);
  };
}
