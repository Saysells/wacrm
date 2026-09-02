// ============================================================
// Reentrada: un contacto marcado "No responde" que vuelve a escribir.
//
// El bot de primer contacto cierra la corrida cuando pasan 24 horas sin
// respuesta y deja al contacto etiquetado "No responde". Si esa persona
// escribe tres días después, hasta ahora no pasaba nada: la etiqueta
// seguía mintiendo, la conversación quedaba abierta sin dueño y nadie
// se enteraba.
//
// Qué hace: le pone "En gestión", le saca "No responde" y deja la
// conversación pendiente, asignada al agente de reentrada de la cuenta.
// El bot NO vuelve a arrancar — su disparador es el primer mensaje
// entrante y este no lo es, así que no hay nada que impedir.
//
// **Dónde vive y por qué acá.** Es una regla del webhook, no una
// automatización ni un nodo de flujo:
//
//   - Como automatización habría que atarla al disparador
//     `new_message_received` con una condición por etiqueta, y ninguna
//     acción existente sabe "sacar la etiqueta anterior Y asignar la
//     conversación". Serían dos automatizaciones encadenadas por
//     `tag_added`, que es justo el lazo que el motor limita por
//     profundidad.
//   - Como nodo de flujo no puede ser: no hay corrida activa. La
//     anterior terminó por timeout; de eso se trata.
//
// El webhook ya tiene el contacto, la conversación y la cuenta en la
// mano, y ya corre `reopenClosedConversation` ahí mismo por una razón
// casi idéntica ("el cliente volvió a escribir"). Es una consulta más
// en el caso común (el contacto no tiene la etiqueta y salimos).
//
// La escritura de etiquetas va por el camino compartido
// (`addContactTagAndDispatch` / `removeContactTag`): valida tenencia,
// trata el duplicado como no-op y dispara las automatizaciones de
// `tag_added`. No hay una segunda forma de escribir `contact_tags`.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { addContactTagAndDispatch } from '@/lib/contacts/tag-events';
import { removeContactTag } from '@/lib/contacts/tag-write';

/** Los dos nombres del embudo que esta regla usa (migración 046). */
export const ETIQUETA_NO_RESPONDE = 'No responde';
export const ETIQUETA_EN_GESTION = 'En gestión';

/** Misma clave de comparación que el resto del catálogo de etiquetas. */
function claveNombre(name: string): string {
  return name.trim().toLocaleLowerCase();
}

/**
 * Fila de `contact_tags` con la etiqueta joineada. PostgREST devuelve
 * la relación como objeto o como array de uno según cómo infiera la
 * cardinalidad; se aceptan las dos formas.
 */
export interface FilaEtiquetaContacto {
  tag_id: string;
  tags:
    | { name: string; grupo: string | null }
    | { name: string; grupo: string | null }[]
    | null;
}

/**
 * ¿Alguna de las etiquetas del contacto es la de estado con ese
 * nombre? Devuelve su id. Se exige `grupo = 'estado'` para no
 * confundirla con una etiqueta que alguien haya llamado igual en otro
 * grupo.
 */
export function buscarEtiquetaDeEstado(
  filas: FilaEtiquetaContacto[],
  nombre: string
): string | null {
  const buscado = claveNombre(nombre);
  for (const fila of filas) {
    const tag = Array.isArray(fila.tags) ? fila.tags[0] : fila.tags;
    if (!tag || tag.grupo !== 'estado') continue;
    if (claveNombre(tag.name) === buscado) return fila.tag_id;
  }
  return null;
}

export interface ReentradaResult {
  applied: boolean;
  /** Por qué no se aplicó, cuando no se aplicó. */
  reason?: 'sin_etiqueta' | 'error';
}

/**
 * Aplica la reentrada si corresponde. Nunca lanza: un problema acá no
 * puede tumbar el webhook ni hacer que Meta reintente la entrega.
 */
export async function aplicarReentrada(
  db: SupabaseClient,
  input: { accountId: string; contactId: string; conversationId: string }
): Promise<ReentradaResult> {
  try {
    // Camino común: el contacto no está en "No responde" y salimos con
    // una sola consulta.
    const { data: filas, error } = await db
      .from('contact_tags')
      .select('tag_id, tags ( name, grupo )')
      .eq('contact_id', input.contactId);
    if (error) return { applied: false, reason: 'error' };

    const noResponde = buscarEtiquetaDeEstado(
      (filas ?? []) as FilaEtiquetaContacto[],
      ETIQUETA_NO_RESPONDE
    );
    if (!noResponde) return { applied: false, reason: 'sin_etiqueta' };

    const [enGestionRes, cuentaRes] = await Promise.all([
      db
        .from('tags')
        .select('id, name')
        .eq('account_id', input.accountId)
        .eq('grupo', 'estado')
        .eq('name', ETIQUETA_EN_GESTION)
        .maybeSingle(),
      db
        .from('accounts')
        .select('agente_reentrada')
        .eq('id', input.accountId)
        .maybeSingle(),
    ]);

    const enGestion = (enGestionRes.data as { id: string } | null)?.id ?? null;

    // Primero se pone la nueva. El trigger `trg_single_etapa_tag` borra
    // en la base la etiqueta de estado anterior, así que el DELETE de
    // abajo suele ser un no-op; se hace igual porque la regla no puede
    // depender de que el grupo esté bien cargado.
    if (enGestion) {
      await addContactTagAndDispatch({
        db,
        accountId: input.accountId,
        contactId: input.contactId,
        tagId: enGestion,
        context: { conversation_id: input.conversationId },
      });
    }
    await removeContactTag(db, {
      accountId: input.accountId,
      contactId: input.contactId,
      tagId: noResponde,
    }).catch(() => {});

    // Pendiente y con dueño. Se asigna aunque la conversación ya tenga
    // agente: un contacto en "No responde" es, por definición, uno que
    // nadie está atendiendo, y el punto de la regla es que alguien lo
    // vea hoy.
    const agente =
      (cuentaRes.data as { agente_reentrada?: string | null } | null)
        ?.agente_reentrada ?? null;
    await db
      .from('conversations')
      .update({
        status: 'pending',
        updated_at: new Date().toISOString(),
        ...(agente ? { assigned_agent_id: agente } : {}),
      })
      .eq('id', input.conversationId);

    return { applied: true };
  } catch (err) {
    console.error(
      '[reentrada] falló:',
      err instanceof Error ? err.message : err
    );
    return { applied: false, reason: 'error' };
  }
}
