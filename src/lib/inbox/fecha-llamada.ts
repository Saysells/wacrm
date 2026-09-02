// ============================================================
// Fecha y hora de la llamada agendada (contacts.fecha_llamada, 047).
//
// Cuando el setter aplica una etiqueta con `requiere_fecha` (Agendado
// a Paola, Agendado a Gustavo, Agendada, Reagendado) carga fecha y
// hora ahi mismo. La parte pura (sugerida, precarga, formato, valor
// del <input type="datetime-local">) va separada de la parte con red,
// igual que contact-tags.ts.
//
// ORDEN NO NEGOCIABLE: primero se guarda la fecha en el contacto y
// recien despues se aplica la etiqueta. El aviso al CRM sale del
// trigger en el INSERT de contact_tags y lee contacts.fecha_llamada:
// si la etiqueta entrara antes, el CRM recibiria la fecha vieja (o
// ninguna).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { format, isValid } from 'date-fns';
import { es } from 'date-fns/locale';

import { attachTag } from '@/lib/inbox/contact-tags';
import type { Tag } from '@/types';

/** Sugerida al abrir el modal sin fecha previa: manana a las 10:00, hora local. */
export function suggestedCallDate(now: Date = new Date()): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 10, 0, 0, 0);
  return d;
}

/**
 * Con que fecha se abre el modal: la del contacto si tiene una valida,
 * si no la sugerida.
 */
export function initialCallDate(
  fechaLlamada: string | null | undefined,
  now: Date = new Date()
): Date {
  if (fechaLlamada) {
    const d = new Date(fechaLlamada);
    if (isValid(d)) return d;
  }
  return suggestedCallDate(now);
}

function two(n: number): string {
  return String(n).padStart(2, '0');
}

/** Valor para `<input type="datetime-local">`: "YYYY-MM-DDTHH:mm" en hora local. */
export function toDatetimeLocalValue(d: Date): string {
  return (
    `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}` +
    `T${two(d.getHours())}:${two(d.getMinutes())}`
  );
}

/**
 * Lo que devuelve el input, a Date local. Null si esta vacio o no es
 * una fecha (el navegador ya valida, pero el valor puede venir vacio
 * si la persona lo borro).
 */
export function fromDatetimeLocalValue(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value.trim());
  if (!m) return null;
  const d = new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    0,
    0
  );
  return isValid(d) ? d : null;
}

/**
 * Formato corto para la ficha: "Jue 04/09 · 10:00". Dia de la semana
 * en castellano con inicial mayuscula (date-fns lo da en minuscula).
 */
export function formatCallDateShort(fechaLlamada: string | Date): string {
  const d = typeof fechaLlamada === 'string' ? new Date(fechaLlamada) : fechaLlamada;
  if (!isValid(d)) return '';
  const raw = format(d, 'EEE dd/MM · HH:mm', { locale: es });
  const cleaned = raw.replace(/\./g, '');
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

// ------------------------------------------------------------
// Parte con red.
// ------------------------------------------------------------

/**
 * Guarda la fecha en el contacto. Update directo con el cliente de
 * Supabase, respetando RLS (`contacts_update` pide agent+, el mismo
 * rol que el endpoint de etiquetas), igual que hace el resto del
 * sidebar con notas y deals.
 */
export async function saveFechaLlamada(
  db: SupabaseClient,
  contactId: string,
  fecha: Date
): Promise<string> {
  const iso = fecha.toISOString();
  const { error } = await db
    .from('contacts')
    .update({ fecha_llamada: iso, updated_at: new Date().toISOString() })
    .eq('id', contactId);
  if (error) throw new Error(error.message || 'Failed to save call date');
  return iso;
}

export interface ScheduleWithDateInput {
  db: SupabaseClient;
  contactId: string;
  tag: Tag;
  fecha: Date;
  attached: Tag[];
}

export interface ScheduleWithDateResult {
  /** ISO guardado en contacts.fecha_llamada. */
  fechaLlamada: string;
  /** Pastillas del contacto, ya con la etiqueta nueva. */
  attached: Tag[];
}

/**
 * Primero la fecha, despues la etiqueta. Si guardar la fecha falla,
 * la etiqueta no se aplica (y el CRM no recibe nada).
 */
export async function scheduleWithDate(
  input: ScheduleWithDateInput
): Promise<ScheduleWithDateResult> {
  const fechaLlamada = await saveFechaLlamada(input.db, input.contactId, input.fecha);
  const attached = await attachTag(input.contactId, input.tag, input.attached);
  return { fechaLlamada, attached };
}
